"""File selection and session lifecycle.

Covers:

- :class:`TestSelectedFiles` — :meth:`LLMService.set_selected_files`
  and :meth:`LLMService.get_selected_files` — existence filtering,
  broadcast side effect, stored-copy discipline.
- :class:`TestNewSession` — :meth:`LLMService.new_session` — fresh
  session ID, history cleared, ``sessionChanged`` broadcast.
"""

from __future__ import annotations

from pathlib import Path

from ac_dc.history_store import HistoryStore
from ac_dc.llm_service import LLMService

from .conftest import _FakeLiteLLM, _RecordingEventCallback


# ---------------------------------------------------------------------------
# File selection
# ---------------------------------------------------------------------------


class TestSelectedFiles:
    """set_selected_files / get_selected_files behaviour."""

    def test_set_returns_canonical_list(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """set_selected_files stores and broadcasts."""
        # Create a real file so the existence filter keeps it.
        (repo_dir / "a.md").write_text("hello")
        result = service.set_selected_files(["a.md"])
        assert result == ["a.md"]
        assert service.get_selected_files() == ["a.md"]
        # filesChanged broadcast emitted.
        assert any(
            name == "filesChanged" for name, _ in event_cb.events
        )

    def test_missing_files_filtered(
        self, service: LLMService
    ) -> None:
        """Paths pointing at nonexistent files are dropped."""
        result = service.set_selected_files(["does-not-exist.md"])
        assert result == []

    def test_stored_list_is_a_copy(
        self,
        service: LLMService,
        repo_dir: Path,
    ) -> None:
        """Caller mutating the input doesn't affect stored state."""
        (repo_dir / "a.md").write_text("x")
        inp = ["a.md"]
        service.set_selected_files(inp)
        inp.append("b.md")
        assert service.get_selected_files() == ["a.md"]


# ---------------------------------------------------------------------------
# new_session
# ---------------------------------------------------------------------------


class TestNewSession:
    """new_session resets state."""

    def test_generates_new_session_id(
        self, service: LLMService
    ) -> None:
        """Session ID changes on new_session."""
        old = service.get_current_state()["session_id"]
        result = service.new_session()
        assert result["session_id"] != old
        assert service.get_current_state()["session_id"] == (
            result["session_id"]
        )

    def test_clears_history(
        self,
        service: LLMService,
        history_store: HistoryStore,
    ) -> None:
        """new_session empties the context manager's history."""
        # Seed some history via the context manager.
        service._context.add_message("user", "old")
        service._context.add_message("assistant", "reply")
        assert len(service.get_current_state()["messages"]) == 2
        service.new_session()
        assert service.get_current_state()["messages"] == []

    def test_broadcasts_session_changed(
        self,
        service: LLMService,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """sessionChanged event fires with the new session ID."""
        service.new_session()
        sessions_changed = [
            args
            for name, args in event_cb.events
            if name == "sessionChanged"
        ]
        assert sessions_changed
        payload = sessions_changed[-1][0]
        assert payload["session_id"] == service.get_current_state()[
            "session_id"
        ]
        assert payload["messages"] == []