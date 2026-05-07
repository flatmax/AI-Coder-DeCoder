"""Turn archive RPC — :meth:`LLMService.get_turn_archive`.

Covers :class:`TestGetTurnArchiveRPC` — the thin wrapper over
:meth:`HistoryStore.get_turn_archive`. Per specs4/3-llm/history.md
§ User-Visible Agent Browsing, the frontend calls this RPC
lazily as the user scrolls the chat.

Tests pin the delegation, the no-history-store fallback, and
the ordered multi-agent shape.
"""

from __future__ import annotations

from ac_dc.config import ConfigManager
from ac_dc.history_store import HistoryStore
from ac_dc.llm_service import LLMService
from ac_dc.repo import Repo

from .conftest import _FakeLiteLLM


class TestGetTurnArchiveRPC:
    """LLMService.get_turn_archive exposes the history-store method.

    Slice 2 of the parallel-agents foundation — per
    specs4/3-llm/history.md § User-Visible Agent Browsing, the
    frontend calls this RPC lazily as the user scrolls the chat.
    The wrapper is a thin delegation to
    :meth:`HistoryStore.get_turn_archive`; tests verify the
    delegation, the no-history-store fallback, and the ordered
    multi-agent shape.
    """

    def test_empty_when_no_history_store(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """No history store attached → empty list, no crash.

        Tests that skip the store should still be able to call
        this RPC without errors. Matches the pattern used by
        ``history_list_sessions`` / ``history_get_session``.
        """
        svc = LLMService(
            config=config, repo=repo, history_store=None
        )
        assert svc.get_turn_archive("turn_anything") == []

    def test_missing_archive_returns_empty(
        self,
        service: LLMService,
    ) -> None:
        """Turn ID with no archive directory returns empty."""
        tid = HistoryStore.new_turn_id()
        result = service.get_turn_archive(tid)
        assert result == []

    def test_returns_archive_when_present(
        self,
        service: LLMService,
        history_store: HistoryStore,
    ) -> None:
        """Archive populated via the store surfaces through the RPC."""
        tid = HistoryStore.new_turn_id()
        history_store.append_agent_message(
            tid, 0, "user", "task for agent zero"
        )
        history_store.append_agent_message(
            tid, 0, "assistant", "done"
        )
        history_store.append_agent_message(
            tid, 1, "user", "task for agent one"
        )

        result = service.get_turn_archive(tid)
        assert len(result) == 2
        assert result[0]["agent_idx"] == 0
        assert len(result[0]["messages"]) == 2
        assert result[1]["agent_idx"] == 1

    def test_preserves_agent_order(
        self,
        service: LLMService,
        history_store: HistoryStore,
    ) -> None:
        """Agents returned in index-ascending order.

        The frontend renders one column per agent left-to-right;
        the RPC must preserve the order so the UI doesn't need
        to re-sort.
        """
        tid = HistoryStore.new_turn_id()
        # Append out of order.
        history_store.append_agent_message(tid, 2, "user", "a2")
        history_store.append_agent_message(tid, 0, "user", "a0")
        history_store.append_agent_message(tid, 1, "user", "a1")

        result = service.get_turn_archive(tid)
        assert [entry["agent_idx"] for entry in result] == [
            0, 1, 2,
        ]

    def test_record_metadata_preserved_through_rpc(
        self,
        service: LLMService,
        history_store: HistoryStore,
    ) -> None:
        """Records arrive at the frontend with full metadata.

        Pins the contract that the RPC is lossless: everything
        the store persisted is visible through the wrapper.
        The agent-browser UI needs file-mention detection in
        the transcripts, which depends on seeing the
        ``files_modified`` field.
        """
        tid = HistoryStore.new_turn_id()
        sid = HistoryStore.new_session_id()
        history_store.append_agent_message(
            tid, 0, "assistant", "edited the files",
            session_id=sid,
            extra={
                "files_modified": ["src/auth.py"],
                "edit_results": [
                    {"file": "src/auth.py", "status": "applied"},
                ],
            },
        )

        result = service.get_turn_archive(tid)
        msg = result[0]["messages"][0]
        assert msg["turn_id"] == tid
        assert msg["session_id"] == sid
        assert msg["files_modified"] == ["src/auth.py"]
        assert msg["edit_results"][0]["status"] == "applied"