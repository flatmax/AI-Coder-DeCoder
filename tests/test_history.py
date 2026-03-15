"""Tests for history store and compaction."""

import json
import time
from pathlib import Path

import pytest

from ac_dc.context.history_store import HistoryStore
from ac_dc.context.topic_detector import (
    TopicBoundary, SAFE_BOUNDARY,
    format_messages_for_detection, parse_detection_result,
)
from ac_dc.context.history_compactor import HistoryCompactor, CompactionResult


# ── History Store ─────────────────────────────────────────────────

class TestHistoryStore:
    def test_append_and_retrieve(self, tmp_path):
        store = HistoryStore(tmp_path)
        sid = store.current_session_id
        store.append_message(sid, "user", "Hello")
        store.append_message(sid, "assistant", "Hi there")

        msgs = store.get_session_messages(sid)
        assert len(msgs) == 2
        assert msgs[0]["role"] == "user"
        assert msgs[1]["content"] == "Hi there"

    def test_session_grouping(self, tmp_path):
        store = HistoryStore(tmp_path)
        s1 = store.new_session()
        store.append_message(s1, "user", "Session 1")
        s2 = store.new_session()
        store.append_message(s2, "user", "Session 2")

        msgs1 = store.get_session_messages(s1)
        msgs2 = store.get_session_messages(s2)
        assert len(msgs1) == 1
        assert len(msgs2) == 1

    def test_list_sessions(self, tmp_path):
        store = HistoryStore(tmp_path)
        s1 = store.new_session()
        store.append_message(s1, "user", "First session")
        time.sleep(0.01)
        s2 = store.new_session()
        store.append_message(s2, "user", "Second session")

        sessions = store.list_sessions()
        assert len(sessions) >= 2
        assert sessions[0]["message_count"] >= 1
        assert sessions[0]["preview"]

    def test_list_sessions_respects_limit(self, tmp_path):
        store = HistoryStore(tmp_path)
        for _ in range(5):
            sid = store.new_session()
            store.append_message(sid, "user", "msg")
        sessions = store.list_sessions(limit=2)
        assert len(sessions) == 2

    def test_search(self, tmp_path):
        store = HistoryStore(tmp_path)
        sid = store.current_session_id
        store.append_message(sid, "user", "Fix the authentication bug")
        store.append_message(sid, "assistant", "I'll look at auth.py")
        store.append_message(sid, "user", "Now work on the database")

        results = store.search("authentication")
        assert len(results) >= 1

    def test_search_role_filter(self, tmp_path):
        store = HistoryStore(tmp_path)
        sid = store.current_session_id
        store.append_message(sid, "user", "keyword here")
        store.append_message(sid, "assistant", "keyword here too")

        results = store.search("keyword", role="user")
        for r in results:
            for m in r["messages"]:
                assert m["role"] == "user"

    def test_search_empty_returns_empty(self, tmp_path):
        store = HistoryStore(tmp_path)
        assert store.search("") == []

    def test_persistence(self, tmp_path):
        store1 = HistoryStore(tmp_path)
        sid = store1.current_session_id
        store1.append_message(sid, "user", "Persisted message")

        store2 = HistoryStore(tmp_path)
        sessions = store2.list_sessions()
        assert any(s["preview"].startswith("Persisted") for s in sessions)

    def test_corrupt_line_skipped(self, tmp_path):
        # Write a valid line then a corrupt line
        jsonl = tmp_path / "history.jsonl"
        valid = json.dumps({
            "id": "1-abc", "session_id": "s1",
            "timestamp": "2025-01-01T00:00:00Z",
            "role": "user", "content": "valid",
        })
        jsonl.write_text(valid + "\n{corrupt json\n")

        store = HistoryStore(tmp_path)
        sessions = store.list_sessions()
        assert len(sessions) >= 1

    def test_message_has_required_fields(self, tmp_path):
        store = HistoryStore(tmp_path)
        sid = store.current_session_id
        msg = store.append_message(sid, "user", "test", files=["a.py"])
        assert "id" in msg
        assert "timestamp" in msg
        assert "session_id" in msg
        assert "files" in msg

    def test_get_session_for_context(self, tmp_path):
        store = HistoryStore(tmp_path)
        sid = store.current_session_id
        store.append_message(sid, "user", "test", files=["a.py"])
        ctx = store.get_session_messages_for_context(sid)
        assert len(ctx) == 1
        assert "role" in ctx[0]
        assert "content" in ctx[0]
        assert "files" not in ctx[0]  # No metadata

    def test_empty_session(self, tmp_path):
        store = HistoryStore(tmp_path)
        msgs = store.get_session_messages("nonexistent_session")
        assert msgs == []

    def test_message_id_format(self, tmp_path):
        store = HistoryStore(tmp_path)
        sid = store.current_session_id
        msg = store.append_message(sid, "user", "test")
        assert "-" in msg["id"]  # epoch-uuid format

    def test_session_id_format(self, tmp_path):
        store = HistoryStore(tmp_path)
        sid = store.new_session()
        assert sid.startswith("sess_")

    def test_unique_ids(self, tmp_path):
        store = HistoryStore(tmp_path)
        sid = store.current_session_id
        ids = set()
        for _ in range(100):
            msg = store.append_message(sid, "user", "test")
            ids.add(msg["id"])
        assert len(ids) == 100


# ── Topic Detector ────────────────────────────────────────────────

class TestTopicDetector:
    def test_empty_messages(self):
        from ac_dc.context.topic_detector import TopicDetector
        detector = TopicDetector(model=None)
        result = detector.detect([])
        assert result.boundary_index is None
        assert result.confidence == 0.0

    def test_no_model(self):
        from ac_dc.context.topic_detector import TopicDetector
        detector = TopicDetector(model=None)
        result = detector.detect([{"role": "user", "content": "test"}])
        assert result is SAFE_BOUNDARY

    def test_format_messages(self):
        msgs = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there"},
        ]
        formatted = format_messages_for_detection(msgs)
        assert "[0] USER: Hello" in formatted
        assert "[1] ASSISTANT: Hi there" in formatted

    def test_format_truncation(self):
        msgs = [{"role": "user", "content": "x" * 5000}]
        formatted = format_messages_for_detection(msgs, max_chars=100)
        assert "..." in formatted

    def test_parse_clean_json(self):
        text = '{"boundary_index": 5, "confidence": 0.8, "boundary_reason": "topic shift", "summary": "Discussed auth"}'
        result = parse_detection_result(text)
        assert result.boundary_index == 5
        assert result.confidence == 0.8

    def test_parse_null_boundary(self):
        text = '{"boundary_index": null, "confidence": 0.1, "boundary_reason": "", "summary": ""}'
        result = parse_detection_result(text)
        assert result.boundary_index is None

    def test_parse_fenced_json(self):
        text = 'Here is my analysis:\n```json\n{"boundary_index": 3, "confidence": 0.9, "boundary_reason": "shift", "summary": "test"}\n```'
        result = parse_detection_result(text)
        assert result.boundary_index == 3

    def test_parse_regex_fallback(self):
        text = 'Partial response "boundary_index": 7, "confidence": 0.6, other text'
        result = parse_detection_result(text)
        assert result.boundary_index == 7
        assert result.confidence == 0.6

    def test_parse_invalid(self):
        result = parse_detection_result("completely invalid text")
        assert result.boundary_index is None
        assert result.confidence == 0.0


# ── History Compactor ─────────────────────────────────────────────

class TestHistoryCompactor:
    def _make_counter(self):
        """Simple mock counter."""
        class MockCounter:
            def count(self, data):
                if isinstance(data, str):
                    return len(data) // 4
                if isinstance(data, dict):
                    return len(data.get("content", "")) // 4
                if isinstance(data, list):
                    return sum(self.count(m) for m in data)
                return 0
        return MockCounter()

    def test_below_trigger(self):
        config = {"enabled": True, "compaction_trigger_tokens": 99999}
        compactor = HistoryCompactor(config)
        assert not compactor.should_compact(100)

    def test_above_trigger(self):
        config = {"enabled": True, "compaction_trigger_tokens": 10}
        compactor = HistoryCompactor(config)
        assert compactor.should_compact(100)

    def test_disabled(self):
        config = {"enabled": False}
        compactor = HistoryCompactor(config)
        assert not compactor.should_compact(999999)

    def test_empty_messages(self):
        config = {"enabled": True, "compaction_trigger_tokens": 10}
        compactor = HistoryCompactor(config)
        result = compactor.compact([], self._make_counter())
        assert result.case == "none"

    def test_compact_reduces_count(self):
        config = {
            "enabled": True,
            "compaction_trigger_tokens": 10,
            "verbatim_window_tokens": 5,
            "summary_budget_tokens": 50,
            "min_verbatim_exchanges": 1,
        }
        compactor = HistoryCompactor(config, detection_model=None)
        messages = [
            {"role": "user", "content": "x" * 200},
            {"role": "assistant", "content": "y" * 200},
            {"role": "user", "content": "a" * 200},
            {"role": "assistant", "content": "b" * 200},
            {"role": "user", "content": "Recent question"},
            {"role": "assistant", "content": "Recent answer"},
        ]
        result = compactor.compact(messages, self._make_counter())
        assert result.case in ("truncate", "summarize")
        assert len(result.messages) <= len(messages)

    def test_none_case_unchanged(self):
        config = {"enabled": True, "compaction_trigger_tokens": 999999}
        compactor = HistoryCompactor(config)
        messages = [{"role": "user", "content": "short"}]
        result = compactor.compact(messages, self._make_counter())
        assert result.case == "none"
        assert result.messages == messages

    def test_min_verbatim_preserved(self):
        config = {
            "enabled": True,
            "compaction_trigger_tokens": 5,
            "verbatim_window_tokens": 1,
            "min_verbatim_exchanges": 2,
        }
        compactor = HistoryCompactor(config, detection_model=None)
        messages = [
            {"role": "user", "content": "x" * 200},
            {"role": "assistant", "content": "y" * 200},
            {"role": "user", "content": "q1"},
            {"role": "assistant", "content": "a1"},
            {"role": "user", "content": "q2"},
            {"role": "assistant", "content": "a2"},
        ]
        result = compactor.compact(messages, self._make_counter())
        user_msgs = [m for m in result.messages
                     if m.get("role") == "user"
                     and not m.get("content", "").startswith("[History")]
        assert len(user_msgs) >= 2