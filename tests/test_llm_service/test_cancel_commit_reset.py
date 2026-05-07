"""Cancellation, commit, and reset flows.

Covers:

- :class:`TestCancellation` — :meth:`LLMService.cancel_streaming`
  rejects wrong IDs and adds active IDs to the cancelled set.
- :class:`TestCommitFlow` — :meth:`LLMService.commit_all` guards
  (concurrent commit, no repo) and the session-ID-at-launch
  invariant.
- :class:`TestResetFlow` — :meth:`LLMService.reset_to_head` records
  a system event in both context and history store.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from ac_dc.config import ConfigManager
from ac_dc.history_store import HistoryStore
from ac_dc.llm_service import LLMService

from .conftest import _FakeLiteLLM


# ---------------------------------------------------------------------------
# cancel_streaming
# ---------------------------------------------------------------------------


class TestCancellation:
    """cancel_streaming aborts the in-flight stream.

    The cancel RPC accepts any request id from a localhost
    caller and adds it to ``_cancelled_requests``. The worker
    thread's per-chunk membership check is the authoritative
    consumer; a stale id sitting in the set is harmless.

    The previous "wrong id rejected" guard blocked
    cancellation on agent tabs, where the frontend sends the
    child request id ``{parent}-agent-NN`` and
    ``_active_user_request`` holds the parent (or None once
    the parent finished). See ``_rpc_streaming.cancel_streaming``
    for the full prose.
    """

    def test_active_request_added_to_cancelled_set(
        self, service: LLMService
    ) -> None:
        """Active main-tab cancellation registers the ID."""
        service._active_user_request = "r1"
        service.cancel_streaming("r1")
        assert "r1" in service._cancelled_requests

    def test_child_request_added_to_cancelled_set(
        self, service: LLMService
    ) -> None:
        """Agent-tab cancel (child id) reaches the worker.

        The cancel RPC no longer gates on
        ``_active_user_request`` — it just adds the id to the
        set. The worker thread checks membership per chunk
        and breaks out when its id appears.
        """
        service._active_user_request = "parent-id"
        child_id = "parent-id-agent-00"
        result = service.cancel_streaming(child_id)
        assert result == {"status": "cancelling"}
        assert child_id in service._cancelled_requests

    def test_unknown_id_added_harmlessly(
        self, service: LLMService
    ) -> None:
        """Stale or unknown ids land in the set without error.

        The worker's membership check is the authoritative
        consumer; an id that doesn't match any live stream is
        harmless noise. Pinning this contract so a future
        guard re-introduction breaks the test loudly.
        """
        service._active_user_request = "actual"
        result = service.cancel_streaming("different")
        assert result == {"status": "cancelling"}
        assert "different" in service._cancelled_requests

    def test_no_active_request_still_accepted(
        self, service: LLMService
    ) -> None:
        """Cancel works even when no main stream is active.

        Agent streams outlive their parent — once the main
        LLM completes, ``_active_user_request`` is None but
        agent streams are still running.
        """
        assert service._active_user_request is None
        service.cancel_streaming("some-id")
        assert "some-id" in service._cancelled_requests


# ---------------------------------------------------------------------------
# Commit flow
# ---------------------------------------------------------------------------


class TestCommitFlow:
    """commit_all pipeline — session ID capture, message recording."""

    async def test_rejects_when_already_committing(
        self, service: LLMService
    ) -> None:
        """Concurrent commits are rejected."""
        service._committing = True
        result = await service.commit_all()
        assert "in progress" in result.get("error", "")

    async def test_no_repo_rejected(
        self,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """No repo attached → commit_all returns error."""
        svc = LLMService(config=config, repo=None)
        result = await svc.commit_all()
        assert "repository" in result.get("error", "").lower()

    async def test_session_id_captured_synchronously(
        self,
        service: LLMService,
        repo_dir: Path,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Session ID used in the commit message is the one
        captured at launch time, not whatever self._session_id is
        later.

        Critical race-prevention contract from specs3.
        """
        # Make a change so commit has something to stage.
        (repo_dir / "new.md").write_text("content")
        fake_litellm.set_non_streaming_reply(
            "feat: add new.md"
        )

        captured_session = service.get_current_state()["session_id"]

        result = await service.commit_all()
        assert result == {"status": "started"}

        # Simulate a session swap RIGHT after launch — the
        # background task must use the captured value, not the new.
        service._session_id = "sess_different"

        await asyncio.sleep(0.3)

        # The commit-event should have been persisted under the
        # ORIGINAL session ID.
        assert service._history_store is not None
        persisted_old = service._history_store.get_session_messages(
            captured_session
        )
        commit_entries = [
            m for m in persisted_old
            if m.get("system_event")
            and "Committed" in m.get("content", "")
        ]
        assert commit_entries, (
            "commit event not persisted to captured session"
        )


# ---------------------------------------------------------------------------
# Reset flow
# ---------------------------------------------------------------------------


class TestResetFlow:
    """reset_to_head records a system event."""

    def test_no_repo_rejected(
        self, config: ConfigManager, fake_litellm: _FakeLiteLLM
    ) -> None:
        svc = LLMService(config=config, repo=None)
        result = svc.reset_to_head()
        assert "repository" in result.get("error", "").lower()

    def test_system_event_recorded(
        self,
        service: LLMService,
        history_store: HistoryStore,
    ) -> None:
        """Reset records a system event message in context + history."""
        result = service.reset_to_head()
        assert result["status"] == "ok"
        assert "Reset to HEAD" in result["system_event_message"]

        # In-memory history has the system event.
        history = service.get_current_state()["messages"]
        assert any(
            m.get("system_event")
            and "Reset to HEAD" in m.get("content", "")
            for m in history
        )
        # Persistent history has it too.
        sid = service.get_current_state()["session_id"]
        persisted = history_store.get_session_messages(sid)
        assert any(
            m.get("system_event")
            and "Reset to HEAD" in m.get("content", "")
            for m in persisted
        )