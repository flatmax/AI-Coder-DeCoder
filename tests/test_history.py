"""Tests for history store, topic detector, and history compactor."""

import json
import os
import subprocess
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ac_dc.history_store import (
    HistoryStore,
    _generate_message_id,
    _generate_session_id,
)
from ac_dc.topic_detector import (
    SAFE_BOUNDARY,
    detect_topic_boundary,
    format_messages_for_detection,
    parse_detection_response,
)
from ac_dc.history_compactor import HistoryCompactor


@pytest.fixture
def temp_repo(tmp_path):
    """Create a temporary directory with .ac-dc structure."""
    repo = tmp_path / "test_repo"
    repo.mkdir()
    return repo


@pytest.fixture
def store(temp_repo):
    """Create a HistoryStore instance."""
    return HistoryStore(temp_repo)


# ============================================================
# History Store Tests
# ============================================================


class TestHistoryStoreBasic:
    def test_append_and_retrieve(self, store):
        """Append and retrieve messages by session."""
        sid = "sess_test_001"
        store.append_message(sid, "user", "hello")
        store.append_message(sid, "assistant", "hi there")

        msgs = store.get_session_messages(sid)
        assert len(msgs) == 2
        assert msgs[0]["role"] == "user"
        assert msgs[0]["content"] == "hello"
        assert msgs[1]["role"] == "assistant"
        assert msgs[1]["content"] == "hi there"

    def test_session_grouping(self, store):
        """Session grouping isolates messages."""
        store.append_message("sess_a", "user", "session A message")
        store.append_message("sess_b", "user", "session B message")

        msgs_a = store.get_session_messages("sess_a")
        msgs_b = store.get_session_messages("sess_b")
        assert len(msgs_a) == 1
        assert len(msgs_b) == 1
        assert msgs_a[0]["content"] == "session A message"
        assert msgs_b[0]["content"] == "session B message"

    def test_list_sessions(self, store):
        """list_sessions returns all sessions with preview and message_count."""
        store.append_message("sess_1", "user", "First session message")
        store.append_message("sess_1", "assistant", "Response 1")
        store.append_message("sess_2", "user", "Second session message")

        sessions = store.list_sessions()
        assert len(sessions) == 2

        # Check structure
        for s in sessions:
            assert "session_id" in s
            assert "timestamp" in s
            assert "message_count" in s
            assert "preview" in s
            assert "first_role" in s

    def test_list_sessions_respects_limit(self, store):
        """list_sessions respects limit parameter."""
        for i in range(5):
            store.append_message(f"sess_{i}", "user", f"msg {i}")

        sessions = store.list_sessions(limit=3)
        assert len(sessions) == 3

    def test_search_case_insensitive(self, store):
        """Search: case-insensitive substring match."""
        store.append_message("sess_1", "user", "How to use PYTHON decorators?")
        store.append_message("sess_1", "assistant", "Python decorators wrap functions.")

        results = store.search("python")
        assert len(results) == 2

    def test_search_role_filter(self, store):
        """Search respects role filter."""
        store.append_message("sess_1", "user", "Python question")
        store.append_message("sess_1", "assistant", "Python answer")

        results = store.search("python", role="user")
        assert len(results) == 1
        assert results[0]["role"] == "user"

    def test_search_empty_query(self, store):
        """Empty query returns empty."""
        store.append_message("sess_1", "user", "content")
        results = store.search("")
        assert results == []

    def test_persistence(self, temp_repo):
        """New HistoryStore instance reads previously written messages."""
        store1 = HistoryStore(temp_repo)
        store1.append_message("sess_1", "user", "persistent message")

        store2 = HistoryStore(temp_repo)
        msgs = store2.get_session_messages("sess_1")
        assert len(msgs) == 1
        assert msgs[0]["content"] == "persistent message"

    def test_corrupt_jsonl_skipped(self, temp_repo):
        """Corrupt JSONL line skipped (partial write recovery)."""
        store = HistoryStore(temp_repo)
        store.append_message("sess_1", "user", "good message")

        # Inject corrupt line
        history_file = temp_repo / ".ac-dc" / "history.jsonl"
        with open(history_file, "a") as f:
            f.write("{corrupt json\n")

        store.append_message("sess_1", "assistant", "another good message")

        msgs = store.get_session_messages("sess_1")
        assert len(msgs) == 2

    def test_message_required_fields(self, store):
        """Message has required fields (id, timestamp, session_id, files, images)."""
        msg = store.append_message(
            "sess_1", "user", "content",
            files=["a.py"],
            images=2,  # legacy int
        )
        assert "id" in msg
        assert "timestamp" in msg
        assert "session_id" in msg
        assert msg["files"] == ["a.py"]
        assert msg["images"] == 2

    def test_get_session_messages_for_context(self, store):
        """get_session_messages_for_context returns only role/content."""
        store.append_message("sess_1", "user", "question", files=["a.py"])
        store.append_message("sess_1", "assistant", "answer")

        msgs = store.get_session_messages_for_context("sess_1")
        assert len(msgs) == 2
        assert set(msgs[0].keys()) - {"_images"} == {"role", "content"}
        assert msgs[0]["content"] == "question"

    def test_empty_session_returns_empty(self, store):
        """Empty/nonexistent session returns empty list."""
        assert store.get_session_messages("nonexistent") == []
        assert store.get_session_messages_for_context("nonexistent") == []


class TestMessageIdGeneration:
    def test_message_id_format(self):
        """Format: {epoch_ms}-{uuid8}."""
        mid = _generate_message_id()
        parts = mid.split("-")
        assert len(parts) == 2
        assert parts[0].isdigit()
        assert len(parts[1]) == 8

    def test_session_id_format(self):
        """Session format: sess_{epoch_ms}_{uuid6}."""
        sid = _generate_session_id()
        assert sid.startswith("sess_")
        parts = sid.split("_")
        assert len(parts) == 3
        assert parts[1].isdigit()
        assert len(parts[2]) == 6

    def test_uniqueness(self):
        """100 generated IDs are unique."""
        ids = {_generate_message_id() for _ in range(100)}
        assert len(ids) == 100

        sids = {_generate_session_id() for _ in range(100)}
        assert len(sids) == 100


class TestImagePersistence:
    def test_save_and_load_image(self, store):
        """Images saved and reconstructed via image_refs."""
        import base64
        # Create a small PNG-like data URI
        data = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
        data_uri = f"data:image/png;base64,{base64.b64encode(data).decode()}"

        msg = store.append_message(
            "sess_1", "user", "look at this",
            images=[data_uri],
        )

        assert "image_refs" in msg
        assert len(msg["image_refs"]) == 1

        # Retrieve and check reconstruction
        msgs = store.get_session_messages("sess_1")
        assert "_images" in msgs[0]
        assert len(msgs[0]["_images"]) == 1
        assert msgs[0]["_images"][0].startswith("data:image/png;base64,")

    def test_legacy_int_images(self, store):
        """Legacy int images stored as-is."""
        msg = store.append_message("sess_1", "user", "msg", images=3)
        assert msg["images"] == 3
        assert "image_refs" not in msg


class TestImageUtilities:
    def test_parse_data_uri(self):
        """_parse_data_uri extracts mime type and raw bytes."""
        import base64
        from ac_dc.history_store import _parse_data_uri
        img_data = base64.b64encode(b"hello").decode()
        data_uri = f"data:image/png;base64,{img_data}"
        result = _parse_data_uri(data_uri)
        assert result is not None
        mime, raw = result
        assert mime == "image/png"
        assert raw == b"hello"

    def test_parse_data_uri_invalid(self):
        """_parse_data_uri returns (None, None) for non-data URIs."""
        from ac_dc.history_store import _parse_data_uri
        result = _parse_data_uri("not-a-data-uri")
        assert result == (None, None)

    def test_data_uri_hash_deterministic(self):
        """_data_uri_hash is deterministic."""
        from ac_dc.history_store import _data_uri_hash
        h1 = _data_uri_hash("data:image/png;base64,abc123")
        h2 = _data_uri_hash("data:image/png;base64,abc123")
        assert h1 == h2

    def test_data_uri_hash_different_inputs(self):
        """_data_uri_hash differs for different inputs."""
        from ac_dc.history_store import _data_uri_hash
        h1 = _data_uri_hash("data:image/png;base64,abc")
        h2 = _data_uri_hash("data:image/png;base64,xyz")
        assert h1 != h2


# ============================================================
# Topic Detector Tests
# ============================================================


class TestTopicDetectorFormat:
    def test_messages_formatted(self):
        """Messages formatted as [N] ROLE: content."""
        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there"},
        ]
        result = format_messages_for_detection(messages)
        assert "[0] USER: Hello" in result
        assert "[1] ASSISTANT: Hi there" in result

    def test_truncation(self):
        """Long content truncated at max_chars."""
        messages = [{"role": "user", "content": "x" * 2000}]
        result = format_messages_for_detection(messages, max_chars=100)
        assert "..." in result
        assert len(result) < 2000


class TestTopicDetectorParse:
    def test_clean_json(self):
        """Clean JSON parsed correctly."""
        text = json.dumps({
            "boundary_index": 5,
            "boundary_reason": "topic switch",
            "confidence": 0.8,
            "summary": "Discussed auth module",
        })
        result = parse_detection_response(text)
        assert result["boundary_index"] == 5
        assert result["confidence"] == 0.8
        assert result["summary"] == "Discussed auth module"

    def test_null_boundary(self):
        """Null boundary parsed correctly."""
        text = json.dumps({
            "boundary_index": None,
            "confidence": 0.0,
            "boundary_reason": "no change",
            "summary": "",
        })
        result = parse_detection_response(text)
        assert result["boundary_index"] is None
        assert result["confidence"] == 0.0

    def test_markdown_fenced_json(self):
        """Markdown-fenced JSON parsed."""
        text = '```json\n{"boundary_index": 3, "confidence": 0.7, "boundary_reason": "shift", "summary": "summary"}\n```'
        result = parse_detection_response(text)
        assert result["boundary_index"] == 3
        assert result["confidence"] == 0.7

    def test_partial_regex_fallback(self):
        """Partial regex fallback extracts fields."""
        text = 'Some preamble "boundary_index": 4, "confidence": 0.6 trailing text'
        result = parse_detection_response(text)
        assert result["boundary_index"] == 4
        assert result["confidence"] == 0.6

    def test_completely_invalid(self):
        """Completely invalid returns null/0.0."""
        result = parse_detection_response("just random gibberish")
        assert result["boundary_index"] is None
        assert result["confidence"] == 0.0


class TestTopicDetectorLLM:
    @pytest.mark.asyncio
    async def test_empty_messages(self):
        """Empty messages return SAFE_BOUNDARY."""
        result = await detect_topic_boundary([])
        assert result["boundary_index"] is None
        assert result["confidence"] == 0.0

    @pytest.mark.asyncio
    async def test_no_model(self):
        """No model returns SAFE_BOUNDARY."""
        result = await detect_topic_boundary(
            [{"role": "user", "content": "hello"}],
            model=None,
        )
        assert result == SAFE_BOUNDARY

    @pytest.mark.asyncio
    @patch("ac_dc.topic_detector.litellm")
    async def test_successful_detection(self, mock_litellm):
        """Successful LLM detection returns boundary_index and confidence."""
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = json.dumps({
            "boundary_index": 4,
            "boundary_reason": "topic shift",
            "confidence": 0.85,
            "summary": "Worked on auth",
        })
        mock_litellm.completion.return_value = mock_response

        result = await detect_topic_boundary(
            [{"role": "user", "content": "msg"}] * 6,
            model="test-model",
        )
        assert result["boundary_index"] == 4
        assert result["confidence"] == 0.85

    @pytest.mark.asyncio
    @patch("ac_dc.topic_detector.litellm")
    async def test_llm_failure(self, mock_litellm):
        """LLM failure returns SAFE_BOUNDARY."""
        mock_litellm.completion.side_effect = Exception("API error")

        result = await detect_topic_boundary(
            [{"role": "user", "content": "msg"}],
            model="test-model",
        )
        assert result["boundary_index"] is None
        assert result["confidence"] == 0.0


# ============================================================
# History Compactor Tests
# ============================================================


def _make_messages(n_exchanges, content_size=50):
    """Helper: create n user/assistant exchange pairs."""
    msgs = []
    for i in range(n_exchanges):
        msgs.append({"role": "user", "content": f"User message {i} " * content_size})
        msgs.append({"role": "assistant", "content": f"Assistant response {i} " * content_size})
    return msgs


class TestHistoryCompactorBasic:
    def test_below_trigger_should_compact_false(self):
        """Below trigger: should_compact false."""
        compactor = HistoryCompactor(
            {"enabled": True, "compaction_trigger_tokens": 100000},
            model="test-model",
        )
        msgs = [{"role": "user", "content": "short"}]
        assert compactor.should_compact(msgs) is False

    def test_above_trigger_should_compact_true(self):
        """Above trigger: should_compact true."""
        compactor = HistoryCompactor(
            {"enabled": True, "compaction_trigger_tokens": 10},
            model="test-model",
        )
        msgs = _make_messages(20)
        assert compactor.should_compact(msgs) is True

    @pytest.mark.asyncio
    async def test_empty_messages_case_none(self):
        """Empty messages: case = none."""
        compactor = HistoryCompactor(
            {"enabled": True, "compaction_trigger_tokens": 10},
            model="test-model",
        )
        result = await compactor.compact([])
        assert result["case"] == "none"

    def test_disabled_never_triggers(self):
        """Disabled compactor never triggers."""
        compactor = HistoryCompactor(
            {"enabled": False, "compaction_trigger_tokens": 10},
            model="test-model",
        )
        msgs = _make_messages(20)
        assert compactor.should_compact(msgs) is False

    def test_apply_compaction_none(self):
        """apply_compaction with case=none returns messages unchanged."""
        compactor = HistoryCompactor({"enabled": True})
        msgs = [{"role": "user", "content": "hello"}]
        result = compactor.apply_compaction(msgs, {"case": "none", "messages": msgs})
        assert len(result) == 1

    def test_apply_compaction_reduces(self):
        """apply_compaction reduces message count."""
        compactor = HistoryCompactor({"enabled": True})
        original = _make_messages(10)
        compacted = original[10:]  # half
        result = compactor.apply_compaction(
            original,
            {"case": "truncate", "messages": compacted},
        )
        assert len(result) < len(original)


class TestHistoryCompactorStrategies:
    @pytest.mark.asyncio
    @patch("ac_dc.history_compactor.detect_topic_boundary")
    async def test_high_confidence_boundary_truncates(self, mock_detect):
        """High-confidence boundary in or after verbatim window -> truncate."""
        msgs = _make_messages(20)  # 40 messages total

        compactor = HistoryCompactor(
            {
                "enabled": True,
                "compaction_trigger_tokens": 10,
                "verbatim_window_tokens": 100,
                "min_verbatim_exchanges": 2,
            },
            model="test-model",
            detection_model="detect-model",
        )

        # Compute actual verbatim_start so boundary is deterministically valid
        verbatim_start = compactor._find_verbatim_start(msgs)

        # Boundary at or past verbatim_start with high confidence -> truncate
        mock_detect.return_value = {
            "boundary_index": max(verbatim_start, 1),
            "boundary_reason": "topic shift",
            "confidence": 0.9,
            "summary": "Previous work",
        }

        result = await compactor.compact(msgs)
        assert result["case"] == "truncate"
        assert len(result["messages"]) < len(msgs)

    @pytest.mark.asyncio
    @patch("ac_dc.history_compactor.detect_topic_boundary")
    async def test_low_confidence_summarizes(self, mock_detect):
        """Low-confidence boundary -> summarize."""
        msgs = _make_messages(20)

        compactor = HistoryCompactor(
            {
                "enabled": True,
                "compaction_trigger_tokens": 10,
                "verbatim_window_tokens": 500,
                "min_verbatim_exchanges": 2,
            },
            model="test-model",
            detection_model="detect-model",
        )

        # Low confidence always triggers summarize regardless of position
        mock_detect.return_value = {
            "boundary_index": 5,
            "boundary_reason": "maybe",
            "confidence": 0.3,
            "summary": "Worked on various tasks",
        }

        result = await compactor.compact(msgs)
        assert result["case"] == "summarize"
        # Should have summary message
        assert any("[History Summary]" in m.get("content", "") for m in result["messages"])

    @pytest.mark.asyncio
    @patch("ac_dc.history_compactor.detect_topic_boundary")
    async def test_high_confidence_before_verbatim_summarizes(self, mock_detect):
        """High-confidence boundary before verbatim window -> summarize."""
        msgs = _make_messages(20)  # 40 messages total

        compactor = HistoryCompactor(
            {
                "enabled": True,
                "compaction_trigger_tokens": 10,
                "verbatim_window_tokens": 100,
                "min_verbatim_exchanges": 2,
            },
            model="test-model",
            detection_model="detect-model",
        )

        # Compute verbatim_start and place boundary well before it
        verbatim_start = compactor._find_verbatim_start(msgs)

        mock_detect.return_value = {
            "boundary_index": max(0, verbatim_start - 10),
            "boundary_reason": "shift",
            "confidence": 0.9,
            "summary": "Previous work summary",
        }

        result = await compactor.compact(msgs)
        assert result["case"] == "summarize"
        assert any("[History Summary]" in m.get("content", "") for m in result["messages"])

    @pytest.mark.asyncio
    @patch("ac_dc.history_compactor.detect_topic_boundary")
    async def test_summarize_preserves_verbatim(self, mock_detect):
        """Summarize preserves verbatim window messages."""
        msgs = _make_messages(20)

        compactor = HistoryCompactor(
            {
                "enabled": True,
                "compaction_trigger_tokens": 10,
                "verbatim_window_tokens": 2000,
                "min_verbatim_exchanges": 2,
            },
            model="test-model",
            detection_model="detect-model",
        )

        # Low confidence to guarantee summarize path
        mock_detect.return_value = {
            "boundary_index": 5,
            "boundary_reason": "shift",
            "confidence": 0.3,
            "summary": "Previous work summary",
        }

        result = await compactor.compact(msgs)
        assert result["case"] == "summarize"
        # Last messages should still be present
        last_original = msgs[-1]["content"]
        assert any(m["content"] == last_original for m in result["messages"])

    @pytest.mark.asyncio
    @patch("ac_dc.history_compactor.detect_topic_boundary")
    async def test_min_verbatim_exchanges_preserved(self, mock_detect):
        """min_verbatim_exchanges preserved after compaction."""
        msgs = _make_messages(20)  # 40 messages total

        compactor = HistoryCompactor(
            {
                "enabled": True,
                "compaction_trigger_tokens": 10,
                "verbatim_window_tokens": 100,
                "min_verbatim_exchanges": 3,
            },
            model="test-model",
            detection_model="detect-model",
        )

        # Boundary near the very end to truncate most messages
        mock_detect.return_value = {
            "boundary_index": 38,
            "boundary_reason": "at end",
            "confidence": 0.9,
            "summary": "",
        }

        result = await compactor.compact(msgs)
        # Regardless of truncate or summarize, min exchanges must be preserved
        user_msgs = [m for m in result["messages"] if m["role"] == "user"]
        assert len(user_msgs) >= 3


# ============================================================
# Context Manager Compaction Integration
# ============================================================


class TestCompactionIntegration:
    def test_init_compactor_creates(self):
        """init_compactor attaches compactor."""
        from ac_dc.context import ContextManager
        ctx = ContextManager()
        compactor = HistoryCompactor({"enabled": True}, model="test")
        ctx.init_compactor(compactor)
        assert ctx._compactor is compactor

    @pytest.mark.asyncio
    async def test_compact_below_trigger_returns_none(self):
        """compact_history_if_needed returns None below trigger."""
        from ac_dc.context import ContextManager
        ctx = ContextManager(compaction_config={
            "enabled": True,
            "compaction_trigger_tokens": 100000,
        })
        compactor = HistoryCompactor(
            {"enabled": True, "compaction_trigger_tokens": 100000},
            model="test",
        )
        ctx.init_compactor(compactor)
        ctx.add_message("user", "short")
        result = await ctx.compact_history_if_needed()
        assert result is None

    def test_should_compact_without_compactor(self):
        """should_compact works without compactor instance."""
        from ac_dc.context import ContextManager
        ctx = ContextManager(compaction_config={"enabled": True})
        assert ctx.should_compact() is False

    @pytest.mark.asyncio
    @patch("ac_dc.history_compactor.detect_topic_boundary")
    async def test_compaction_purges_stability_items(self, mock_detect):
        """Compaction purges stability history items."""
        from ac_dc.context import ContextManager
        from ac_dc.stability_tracker import StabilityTracker

        mock_detect.return_value = {
            "boundary_index": None,
            "confidence": 0.0,
            "boundary_reason": "",
            "summary": "summary",
        }

        ctx = ContextManager(compaction_config={
            "enabled": True,
            "compaction_trigger_tokens": 10,
        })
        tracker = StabilityTracker(cache_target_tokens=0)
        ctx.set_stability_tracker(tracker)

        compactor = HistoryCompactor(
            {
                "enabled": True,
                "compaction_trigger_tokens": 10,
                "verbatim_window_tokens": 100,
                "min_verbatim_exchanges": 1,
            },
            model="test",
            detection_model="detect-model",
        )
        ctx.init_compactor(compactor)

        # Add enough history to trigger
        for i in range(20):
            ctx.add_exchange(f"Question {i} " * 50, f"Answer {i} " * 50)

        # Register some history items in tracker
        tracker.process_active_items([
            {"key": "history:0", "content_hash": "h1", "tokens": 100},
            {"key": "history:1", "content_hash": "h2", "tokens": 100},
        ])

        result = await ctx.compact_history_if_needed()
        # After compaction, history items should be purged from tracker
        assert tracker.get_item("history:0") is None
        assert tracker.get_item("history:1") is None