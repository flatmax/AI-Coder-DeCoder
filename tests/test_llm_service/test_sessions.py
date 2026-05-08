"""File selection and session lifecycle.

Covers:

- :class:`TestSelectedFiles` — :meth:`LLMService.set_selected_files`
  and :meth:`LLMService.get_selected_files` — existence filtering,
  broadcast side effect, stored-copy discipline.
- :class:`TestNewSession` — :meth:`LLMService.new_session` — fresh
  session ID, history cleared, ``sessionChanged`` broadcast.
- :class:`TestBinaryFileRejection` — turn-start sync drops binary
  files from FileContext and broadcasts ``binaryFilesSkipped`` so
  the frontend can render a toast.
"""

from __future__ import annotations

from pathlib import Path

from ac_dc.history_store import HistoryStore
from ac_dc.llm_service import LLMService
from ac_dc.url_service.models import URLContent

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

    def test_clears_url_context(
        self, service: LLMService
    ) -> None:
        """new_session wipes the prompt's URL context block.

        Regression: prior to the fix, _url_context survived
        new_session, so every turn in the new session still
        carried the previous session's URL content.
        """
        service._context.set_url_context(
            ["[example.com]\nhello world"]
        )
        assert service._context.get_url_context()
        service.new_session()
        assert service._context.get_url_context() == []

    def test_clears_fetched_urls(
        self, service: LLMService
    ) -> None:
        """new_session wipes URLService._fetched.

        Regression: prior to the fix, the in-memory fetched
        dict survived new_session, so the HUD chip list and
        format_url_context() kept showing stale URLs.
        Filesystem cache is intentionally preserved — only
        the session-active dict is cleared.
        """
        service._url_service._fetched["https://example.com"] = (
            URLContent(url="https://example.com", content="hi")
        )
        assert service._url_service.get_fetched_urls()
        service.new_session()
        assert service._url_service.get_fetched_urls() == []


# ---------------------------------------------------------------------------
# Binary file rejection at sync time
# ---------------------------------------------------------------------------


class TestBinaryFileRejection:
    """sync_file_context drops binary files and broadcasts.

    The file picker accepts binary selections (selection-time
    rejection would require an 8KB read per click and surprise
    users). Binary files are caught at turn start when their
    content is materialised — the repo layer refuses to decode
    binary bytes as text, sync_file_context catches the error,
    drops the file from FileContext, and broadcasts
    ``binaryFilesSkipped`` so the frontend can render a toast.
    """

    def _make_binary_file(self, repo_dir: Path, name: str) -> str:
        """Write a file with a null byte in the first 8KB."""
        # ZIP archive header — what xlsx/docx/pptx all start with.
        # The null byte after PK\x03\x04 fires the binary heuristic.
        path = repo_dir / name
        path.write_bytes(b"PK\x03\x04\x00\x00\x00\x00" + b"x" * 100)
        return name

    def test_binary_file_dropped_from_file_context(
        self,
        service: LLMService,
        repo_dir: Path,
    ) -> None:
        """Binary file's content never reaches FileContext.

        Both FileContext and the scope selection are
        trimmed: the LLM doesn't see the file's bytes,
        and the picker checkbox clears on the next
        filesChanged broadcast.
        """
        bin_path = self._make_binary_file(repo_dir, "data.xlsx")
        service.set_selected_files([bin_path])
        # set_selected_files accepts the path (existence check
        # only — no content read).
        assert service.get_selected_files() == [bin_path]
        # sync_file_context runs at turn start; invoke directly
        # to avoid spinning the whole streaming pipeline.
        scope = service._default_scope()
        service._sync_file_context(scope)
        # FileContext is empty AND the selection is trimmed.
        # The binary file is now invisible to both the LLM
        # and the picker.
        assert scope.context.file_context.get_files() == []
        assert service.get_selected_files() == []
        # The trim writes through to the service-level list
        # (default_scope shares the reference).
        assert service._selected_files == []

    def test_binary_skip_broadcasts_files_changed_with_trimmed_list(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """filesChanged fires with the post-trim selection."""
        (repo_dir / "good.md").write_text("hello")
        bin_path = self._make_binary_file(repo_dir, "data.xlsx")
        service.set_selected_files(["good.md", bin_path])
        # Drain the events from set_selected_files so we
        # only inspect what sync produces.
        event_cb.events.clear()
        service._sync_file_context(service._default_scope())
        files_changed = [
            args for name, args in event_cb.events
            if name == "filesChanged"
        ]
        assert len(files_changed) == 1
        # Payload is the trimmed selection — text file remains,
        # binary is gone.
        assert files_changed[0][0] == ["good.md"]

    def test_binary_skip_broadcasts_in_order(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """filesChanged fires before binaryFilesSkipped.

        Visual update lands first; the toast then explains
        why. The order matters because a toast appearing
        before the checkbox clears would suggest the user
        needs to manually deselect — exactly the broken
        UX this change exists to prevent.
        """
        bin_path = self._make_binary_file(repo_dir, "data.xlsx")
        service.set_selected_files([bin_path])
        event_cb.events.clear()
        service._sync_file_context(service._default_scope())
        # Find the indices of each broadcast.
        names = [name for name, _ in event_cb.events]
        assert "filesChanged" in names
        assert "binaryFilesSkipped" in names
        assert names.index("filesChanged") < names.index(
            "binaryFilesSkipped"
        )

    def test_binary_skip_broadcasts_event(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """binaryFilesSkipped fires with the rejected paths."""
        bin1 = self._make_binary_file(repo_dir, "a.xlsx")
        bin2 = self._make_binary_file(repo_dir, "b.pdf")
        service.set_selected_files([bin1, bin2])
        service._sync_file_context(service._default_scope())
        skipped = [
            args for name, args in event_cb.events
            if name == "binaryFilesSkipped"
        ]
        assert len(skipped) == 1
        payload = skipped[0][0]
        assert sorted(payload["paths"]) == ["a.xlsx", "b.pdf"]

    def test_text_files_do_not_trigger_event(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """Text-file selection alone never fires the event."""
        (repo_dir / "good.md").write_text("hello")
        service.set_selected_files(["good.md"])
        service._sync_file_context(service._default_scope())
        assert not [
            args for name, args in event_cb.events
            if name == "binaryFilesSkipped"
        ]

    def test_empty_selection_no_event(
        self,
        service: LLMService,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """No selection means no broadcast."""
        service._sync_file_context(service._default_scope())
        assert not [
            args for name, args in event_cb.events
            if name == "binaryFilesSkipped"
        ]

    def test_mixed_selection_only_lists_binaries(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """Text files in the same selection are not in the payload."""
        (repo_dir / "good.md").write_text("hello")
        bin_path = self._make_binary_file(repo_dir, "data.xlsx")
        service.set_selected_files(["good.md", bin_path])
        service._sync_file_context(service._default_scope())
        skipped = [
            args for name, args in event_cb.events
            if name == "binaryFilesSkipped"
        ]
        assert len(skipped) == 1
        assert skipped[0][0]["paths"] == ["data.xlsx"]
        # The text file made it through.
        scope = service._default_scope()
        assert "good.md" in scope.context.file_context.get_files()