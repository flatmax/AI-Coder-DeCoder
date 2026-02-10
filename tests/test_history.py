"""Tests for Phase 5: History store, topic detector, and history compactor."""

import json
import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch
from ac_dc.history_store import HistoryStore, _make_message_id, _make_session_id
from ac_dc.topic_detector import (
    TopicDetector, TopicBoundary, SAFE_BOUNDARY,
    _format_messages_for_detection, _parse_boundary_response,
)
from ac_dc.history_compactor import HistoryCompactor, CompactionResult
from ac_dc.token_counter import TokenCounter


# ======================================================================
# History Store tests
# ======================================================================

class TestHistoryStore:

    @pytest.fixture
    def store(self, tmp_path):
        ac_dc_dir = tmp_path / ".ac-dc"
        ac_dc_dir.mkdir()
        return HistoryStore(ac_dc_dir)

    def test_append_and_retrieve(self, store):
        store.append_message("sess1", "user", "hello")
        store.append_message("sess1", "assistant", "world")
        msgs = store.get_session("sess1")
        assert len(msgs) == 2
        assert msgs[0]["role"] == "user"
        assert msgs[0]["content"] == "hello"
        assert msgs[1]["role"] == "assistant"

    def test_session_grouping(self, store):
        store.append_message("sess1", "user", "q1")
        store.append_message("sess2", "user", "q2")
        assert len(store.get_session("sess1")) == 1
        assert len(store.get_session("sess2")) == 1

    def test_list_sessions(self, store):
        store.append_message("sess1", "user", "first session")
        store.append_message("sess2", "user", "second session")
        sessions = store.list_sessions()
        assert len(sessions) == 2
        assert sessions[0]["session_id"] in ("sess1", "sess2")
        assert "preview" in sessions[0]
        assert "message_count" in sessions[0]

    def test_list_sessions_limit(self, store):
        for i in range(5):
            store.append_message(f"sess{i}", "user", f"msg {i}")
        sessions = store.list_sessions(limit=3)
        assert len(sessions) == 3

    def test_search(self, store):
        store.append_message("s1", "user", "fix the parser bug")
        store.append_message("s1", "assistant", "I found the issue")
        store.append_message("s1", "user", "now work on the API")
        results = store.search("parser")
        assert len(results) == 1
        assert "parser" in results[0]["content"]

    def test_search_case_insensitive(self, store):
        store.append_message("s1", "user", "Fix The Parser")
        results = store.search("fix the parser")
        assert len(results) == 1

    def test_search_with_role_filter(self, store):
        store.append_message("s1", "user", "parser question")
        store.append_message("s1", "assistant", "parser answer")
        results = store.search("parser", role="user")
        assert len(results) == 1
        assert results[0]["role"] == "user"

    def test_search_empty_query(self, store):
        store.append_message("s1", "user", "hello")
        assert store.search("") == []

    def test_persistence(self, tmp_path):
        ac_dc_dir = tmp_path / ".ac-dc"
        ac_dc_dir.mkdir()

        # Write
        store1 = HistoryStore(ac_dc_dir)
        store1.append_message("s1", "user", "persisted msg")

        # Read in new instance
        store2 = HistoryStore(ac_dc_dir)
        msgs = store2.get_session("s1")
        assert len(msgs) == 1
        assert msgs[0]["content"] == "persisted msg"

    def test_corrupt_line_skipped(self, tmp_path):
        ac_dc_dir = tmp_path / ".ac-dc"
        ac_dc_dir.mkdir()
        path = ac_dc_dir / "history.jsonl"
        path.write_text(
            '{"session_id":"s1","role":"user","content":"good"}\n'
            'this is not json\n'
            '{"session_id":"s1","role":"assistant","content":"also good"}\n'
        )
        store = HistoryStore(ac_dc_dir)
        msgs = store.get_session("s1")
        assert len(msgs) == 2

    def test_message_has_required_fields(self, store):
        msg = store.append_message("s1", "user", "test", files=["a.py"], images=2)
        assert "id" in msg
        assert "timestamp" in msg
        assert msg["session_id"] == "s1"
        assert msg["files"] == ["a.py"]
        assert msg["images"] == 2

    def test_get_session_messages_for_context(self, store):
        store.append_message("s1", "user", "q1")
        store.append_message("s1", "assistant", "a1")
        ctx_msgs = store.get_session_messages_for_context("s1")
        assert len(ctx_msgs) == 2
        assert ctx_msgs[0] == {"role": "user", "content": "q1"}
        assert ctx_msgs[1] == {"role": "assistant", "content": "a1"}
        # Should NOT have extra fields like id, timestamp
        assert "id" not in ctx_msgs[0]

    def test_empty_session(self, store):
        assert store.get_session("nonexistent") == []

    def test_nonexistent_file(self, tmp_path):
        ac_dc_dir = tmp_path / ".ac-dc"
        ac_dc_dir.mkdir()
        store = HistoryStore(ac_dc_dir)
        assert store.list_sessions() == []
        assert store.get_session("x") == []


class TestMessageIdGeneration:

    def test_message_id_format(self):
        mid = _make_message_id()
        parts = mid.split("-")
        assert len(parts) == 2
        assert parts[0].isdigit()
        assert len(parts[1]) == 8

    def test_session_id_format(self):
        sid = _make_session_id()
        assert sid.startswith("sess_")
        parts = sid.split("_")
        assert len(parts) == 3

    def test_ids_unique(self):
        ids = {_make_message_id() for _ in range(100)}
        assert len(ids) == 100


# ======================================================================
# Topic Detector tests
# ======================================================================

class TestFormatMessages:

    def test_basic_format(self):
        msgs = [
            {"role": "user", "content": "fix the bug"},
            {"role": "assistant", "content": "I see the issue"},
        ]
        result = _format_messages_for_detection(msgs)
        assert "[0] USER: fix the bug" in result
        assert "[1] ASSISTANT: I see the issue" in result

    def test_truncation(self):
        msgs = [{"role": "user", "content": "x" * 5000}]
        result = _format_messages_for_detection(msgs, max_chars=100)
        assert "..." in result
        assert len(result) < 5000

    def test_multimodal_content(self):
        msgs = [{
            "role": "user",
            "content": [
                {"type": "text", "text": "describe this"},
                {"type": "image_url", "image_url": {"url": "data:..."}},
            ],
        }]
        result = _format_messages_for_detection(msgs)
        assert "describe this" in result


class TestParseBoundaryResponse:

    def test_clean_json(self):
        text = json.dumps({
            "boundary_index": 5,
            "boundary_reason": "topic changed",
            "confidence": 0.8,
            "summary": "discussed parser fixes",
        })
        result = _parse_boundary_response(text)
        assert result.boundary_index == 5
        assert result.confidence == 0.8
        assert result.summary == "discussed parser fixes"

    def test_null_boundary(self):
        text = '{"boundary_index": null, "confidence": 0.2, "summary": "", "boundary_reason": "one topic"}'
        result = _parse_boundary_response(text)
        assert result.boundary_index is None

    def test_markdown_fenced(self):
        text = '```json\n{"boundary_index": 3, "confidence": 0.9, "summary": "stuff", "boundary_reason": "shift"}\n```'
        result = _parse_boundary_response(text)
        assert result.boundary_index == 3
        assert result.confidence == 0.9

    def test_partial_regex_fallback(self):
        text = 'Some text "boundary_index": 7, "confidence": 0.6 more text'
        result = _parse_boundary_response(text)
        assert result.boundary_index == 7
        assert result.confidence == 0.6

    def test_completely_invalid(self):
        result = _parse_boundary_response("garbage text with no json")
        assert result.boundary_index is None
        assert result.confidence == 0.0


class TestTopicDetector:

    def test_empty_messages(self):
        detector = TopicDetector("test/model", "skill prompt")
        result = detector.detect([])
        assert result == SAFE_BOUNDARY

    def test_no_model(self):
        detector = TopicDetector("", "skill prompt")
        result = detector.detect([{"role": "user", "content": "hello"}])
        assert result == SAFE_BOUNDARY

    @patch("ac_dc.topic_detector.litellm", create=True)
    def test_successful_detection(self, mock_litellm):
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = json.dumps({
            "boundary_index": 2,
            "boundary_reason": "topic shift",
            "confidence": 0.85,
            "summary": "first discussed A, then B",
        })
        with patch.dict("sys.modules", {"litellm": mock_litellm}):
            mock_litellm.completion.return_value = mock_response
            detector = TopicDetector("test/model", "detect boundaries")
            msgs = [
                {"role": "user", "content": "work on A"},
                {"role": "assistant", "content": "ok A"},
                {"role": "user", "content": "now work on B"},
                {"role": "assistant", "content": "ok B"},
            ]
            result = detector.detect(msgs)

        assert result.boundary_index == 2
        assert result.confidence == 0.85

    @patch("ac_dc.topic_detector.litellm", create=True)
    def test_llm_failure_returns_safe(self, mock_litellm):
        with patch.dict("sys.modules", {"litellm": mock_litellm}):
            mock_litellm.completion.side_effect = RuntimeError("API down")
            detector = TopicDetector("test/model", "prompt")
            result = detector.detect([{"role": "user", "content": "hello"}])

        assert result == SAFE_BOUNDARY


# ======================================================================
# History Compactor tests
# ======================================================================

class TestHistoryCompactor:

    @pytest.fixture
    def counter(self):
        return TokenCounter("")

    @pytest.fixture
    def config(self):
        return {
            "enabled": True,
            "compaction_trigger_tokens": 200,
            "verbatim_window_tokens": 50,
            "summary_budget_tokens": 100,
            "min_verbatim_exchanges": 2,
        }

    @pytest.fixture
    def compactor(self, counter, config):
        return HistoryCompactor(counter, config)

    def _make_messages(self, n_exchanges, content_size=50):
        """Create n user/assistant exchange pairs."""
        msgs = []
        for i in range(n_exchanges):
            msgs.append({"role": "user", "content": f"Question {i} " + "x" * content_size})
            msgs.append({"role": "assistant", "content": f"Answer {i} " + "y" * content_size})
        return msgs

    def test_below_trigger_no_compact(self, compactor):
        msgs = [{"role": "user", "content": "short"}]
        assert not compactor.should_compact(msgs)

    def test_above_trigger_should_compact(self, compactor):
        msgs = self._make_messages(20, content_size=100)
        assert compactor.should_compact(msgs)

    def test_compact_returns_result(self, compactor):
        msgs = self._make_messages(20, content_size=100)
        result = compactor.compact(msgs)
        assert result.case in ("truncate", "summarize")
        assert result.messages_after < result.messages_before

    def test_compact_empty(self, compactor):
        result = compactor.compact([])
        assert result.case == "none"

    def test_apply_summarize(self, compactor):
        msgs = self._make_messages(20, content_size=100)
        result = compactor.compact(msgs)
        new_msgs = compactor.apply_compaction(msgs, result)
        assert len(new_msgs) < len(msgs)
        # First message should be user
        if new_msgs:
            assert new_msgs[0]["role"] == "user"

    def test_apply_none_unchanged(self, compactor):
        msgs = [{"role": "user", "content": "short"}]
        result = CompactionResult(case="none", messages_before=1, messages_after=1)
        new_msgs = compactor.apply_compaction(msgs, result)
        assert new_msgs == msgs

    def test_min_exchanges_preserved(self, counter, config):
        config["min_verbatim_exchanges"] = 3
        compactor = HistoryCompactor(counter, config)
        msgs = self._make_messages(20, content_size=100)
        result = compactor.compact(msgs)
        new_msgs = compactor.apply_compaction(msgs, result)
        user_count = sum(1 for m in new_msgs if m.get("role") == "user")
        assert user_count >= 3

    def test_disabled_compactor(self, counter):
        config = {"enabled": False}
        compactor = HistoryCompactor(counter, config)
        msgs = self._make_messages(100, content_size=200)
        assert not compactor.should_compact(msgs)

    def test_apply_truncate(self, counter, config):
        compactor = HistoryCompactor(counter, config)
        msgs = self._make_messages(10, content_size=100)
        result = CompactionResult(
            case="truncate",
            messages_before=20,
            messages_after=10,
            boundary_index=10,
        )
        new_msgs = compactor.apply_compaction(msgs, result)
        assert len(new_msgs) <= len(msgs)

    def test_apply_summarize_with_summary_text(self, counter, config):
        compactor = HistoryCompactor(counter, config)
        msgs = self._make_messages(10, content_size=100)
        result = CompactionResult(
            case="summarize",
            messages_before=20,
            messages_after=5,
            summary="Previously discussed parser fixes.",
        )
        new_msgs = compactor.apply_compaction(msgs, result)
        # Should contain the summary message
        assert any("History Summary" in m.get("content", "") for m in new_msgs)

    def test_apply_summarize_no_summary_text(self, counter, config):
        compactor = HistoryCompactor(counter, config)
        msgs = self._make_messages(10, content_size=100)
        result = CompactionResult(
            case="summarize",
            messages_before=20,
            messages_after=5,
            summary="",
        )
        new_msgs = compactor.apply_compaction(msgs, result)
        # No summary message when summary is empty
        assert not any("History Summary" in m.get("content", "") for m in new_msgs)


class TestCompactorWithDetector:
    """Test compactor with a mocked topic detector."""

    @pytest.fixture
    def counter(self):
        return TokenCounter("")

    @pytest.fixture
    def config(self):
        return {
            "enabled": True,
            "compaction_trigger_tokens": 200,
            "verbatim_window_tokens": 50,
            "summary_budget_tokens": 100,
            "min_verbatim_exchanges": 2,
        }

    @patch("ac_dc.history_compactor.TopicDetector")
    def test_truncate_on_high_confidence_boundary(self, MockDetector, counter, config):
        mock_detector = MockDetector.return_value
        # Boundary at message index 16 (near the end, in verbatim window)
        mock_detector.detect.return_value = TopicBoundary(
            boundary_index=16,
            boundary_reason="topic shift",
            confidence=0.9,
            summary="old topic summary",
        )

        compactor = HistoryCompactor(
            counter, config,
            detection_model="test/model",
            skill_prompt="detect",
        )
        compactor._detector = mock_detector

        msgs = []
        for i in range(10):
            msgs.append({"role": "user", "content": f"Q{i} " + "x" * 100})
            msgs.append({"role": "assistant", "content": f"A{i} " + "y" * 100})

        result = compactor.compact(msgs)
        # With boundary at 16 (near end) and high confidence, should truncate
        assert result.case == "truncate"
        assert result.boundary_index == 16

    @patch("ac_dc.history_compactor.TopicDetector")
    def test_summarize_on_low_confidence(self, MockDetector, counter, config):
        mock_detector = MockDetector.return_value
        mock_detector.detect.return_value = TopicBoundary(
            boundary_index=5,
            boundary_reason="maybe",
            confidence=0.3,
            summary="discussed various things",
        )

        compactor = HistoryCompactor(
            counter, config,
            detection_model="test/model",
            skill_prompt="detect",
        )
        compactor._detector = mock_detector

        msgs = []
        for i in range(10):
            msgs.append({"role": "user", "content": f"Q{i} " + "x" * 100})
            msgs.append({"role": "assistant", "content": f"A{i} " + "y" * 100})

        result = compactor.compact(msgs)
        assert result.case == "summarize"


# ======================================================================
# Context Manager compaction integration tests
# ======================================================================

class TestContextCompaction:

    def test_init_compactor(self):
        from ac_dc.context import ContextManager
        cm = ContextManager(compaction_config={
            "enabled": True,
            "compaction_trigger_tokens": 100,
        })
        cm.init_compactor("test/model", "skill prompt")
        assert cm._compactor is not None

    def test_compact_history_if_needed_below_trigger(self):
        from ac_dc.context import ContextManager
        cm = ContextManager(compaction_config={
            "enabled": True,
            "compaction_trigger_tokens": 100000,
        })
        cm.init_compactor("test/model", "skill prompt")
        cm.add_exchange("short", "msg")
        result = cm.compact_history_if_needed()
        assert result is None

    def test_compact_history_purges_stability(self):
        from ac_dc.context import ContextManager
        from ac_dc.stability_tracker import ItemType
        cm = ContextManager(compaction_config={
            "enabled": True,
            "compaction_trigger_tokens": 10,  # Very low to force trigger
        })
        cm.init_compactor("", "")  # No model = no detector, will summarize

        # Add messages to exceed trigger
        for i in range(20):
            cm.add_exchange(f"question {i} " * 20, f"answer {i} " * 20)

        # Register some history stability items
        cm.stability.register_item("history:0", ItemType.HISTORY, "h", 50)

        result = cm.compact_history_if_needed()
        if result and result.get("case") != "none":
            # History items should be purged
            assert cm.stability.get_item("history:0") is None

    def test_should_compact_with_compactor(self):
        from ac_dc.context import ContextManager
        cm = ContextManager(compaction_config={
            "enabled": True,
            "compaction_trigger_tokens": 10,
        })
        cm.init_compactor("", "")
        for i in range(20):
            cm.add_exchange(f"q{i} " * 20, f"a{i} " * 20)
        assert cm.should_compact()

    def test_should_compact_without_compactor(self):
        from ac_dc.context import ContextManager
        cm = ContextManager(compaction_config={
            "enabled": True,
            "compaction_trigger_tokens": 10,
        })
        for i in range(20):
            cm.add_exchange(f"q{i} " * 20, f"a{i} " * 20)
        assert cm.should_compact()


# ======================================================================
# LLM Service history integration tests
# ======================================================================

class TestLLMServiceHistory:

    @pytest.fixture
    def git_repo(self, tmp_path):
        import subprocess
        subprocess.run(["git", "init", str(tmp_path)], capture_output=True)
        subprocess.run(["git", "config", "user.email", "test@test.com"],
                       cwd=str(tmp_path), capture_output=True)
        subprocess.run(["git", "config", "user.name", "Test"],
                       cwd=str(tmp_path), capture_output=True)
        (tmp_path / "README.md").write_text("# Test\n")
        subprocess.run(["git", "add", "-A"], cwd=str(tmp_path), capture_output=True)
        subprocess.run(["git", "commit", "-m", "init"],
                       cwd=str(tmp_path), capture_output=True)
        return tmp_path

    @pytest.fixture
    def llm_service(self, git_repo):
        from ac_dc.config import ConfigManager
        from ac_dc.repo import Repo
        from ac_dc.llm_service import LLM
        config = ConfigManager(git_repo, dev_mode=True)
        repo = Repo(git_repo)
        return LLM(config, repo)

    def test_has_history_store(self, llm_service):
        assert llm_service._history_store is not None

    def test_list_sessions_initially_empty(self, llm_service):
        sessions = llm_service.history_list_sessions()
        assert sessions == []

    def test_search_initially_empty(self, llm_service):
        results = llm_service.history_search("test")
        assert results == []

    def test_load_session_nonexistent(self, llm_service):
        result = llm_service.load_session_into_context("nonexistent")
        assert "error" in result

    def test_new_session_clears_history(self, llm_service):
        llm_service._context.add_exchange("q", "a")
        result = llm_service.history_new_session()
        assert "session_id" in result
        assert llm_service._context.get_history() == []
