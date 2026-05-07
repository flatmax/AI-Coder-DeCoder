"""Streaming with edit block parsing, apply, and token usage.

Covers:

- :class:`TestStreamingWithEdits` — end-to-end streaming paired
  with edit block parsing and application. Exercises modify,
  create, not-in-context, cancellation, review mode, and the
  auto-add + filesChanged broadcast contracts.
- :class:`TestCompletionResultAgentBlocks` — the ``agent_blocks``
  field in the stream-complete result. Pins the shape the
  frontend's C2a spawn handler reads.
- :class:`TestStreamingRequestUsage` — per-request ``token_usage``
  in the stream-complete result. Regression guard for the HUD
  "This Request" section.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest

from ac_dc.config import ConfigManager
from ac_dc.history_store import HistoryStore
from ac_dc.llm_service import LLMService

from .conftest import _FakeLiteLLM, _RecordingEventCallback


class TestStreamingWithEdits:
    """End-to-end streaming with edit block parsing and application.

    Exercises the full `_stream_chat` → `_build_completion_result`
    → `EditPipeline.apply_edits` path. The fake litellm streams
    responses containing edit blocks; tests assert on the
    resulting `streamComplete` payload and on disk state.
    """

    # Marker constants — re-declared here (not imported) so that
    # any accidental drift in the module's constants surfaces as
    # a test failure rather than a silent byte-level mismatch.
    # Matches the same discipline used in test_edit_protocol.py.
    EDIT_MARK = "🟧🟧🟧 EDIT"
    REPL_MARK = "🟨🟨🟨 REPL"
    END_MARK = "🟩🟩🟩 END"

    def _build_edit_block(
        self, path: str, old: str, new: str
    ) -> str:
        """Assemble one well-formed edit block as response text."""
        return (
            f"{path}\n{self.EDIT_MARK}\n"
            f"{old}\n{self.REPL_MARK}\n"
            f"{new}\n{self.END_MARK}\n"
        )

    def _last_complete_result(
        self, event_cb: _RecordingEventCallback
    ) -> dict:
        """Extract the most recent streamComplete result dict."""
        completes = [
            args for name, args in event_cb.events
            if name == "streamComplete"
        ]
        assert completes, "No streamComplete event observed"
        # args = (request_id, result_dict)
        return completes[-1][1]

    async def test_modify_edit_applied_end_to_end(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """LLM emits an edit block → file on disk is updated."""
        # Seed a file in the repo and put it in selection.
        (repo_dir / "a.py").write_text("hello world\n")
        service.set_selected_files(["a.py"])

        # LLM streams a response containing one edit block.
        response = (
            "Here's the change:\n\n"
            + self._build_edit_block("a.py", "hello", "goodbye")
        )
        # Split across two chunks to exercise the accumulation
        # path — the final chunk still carries the full content.
        mid = len(response) // 2
        fake_litellm.set_streaming_chunks([
            response[:mid],
            response[mid:],
        ])

        await service.chat_streaming(
            request_id="r1", message="rename hello"
        )
        await asyncio.sleep(0.3)

        # File was modified on disk.
        assert (repo_dir / "a.py").read_text() == "goodbye world\n"

        # Result carries the edit metadata.
        result = self._last_complete_result(event_cb)
        assert result["passed"] == 1
        assert result["failed"] == 0
        assert result["files_modified"] == ["a.py"]
        assert len(result["edit_blocks"]) == 1
        assert result["edit_blocks"][0]["file"] == "a.py"
        assert result["edit_blocks"][0]["is_create"] is False

    async def test_edit_results_serialised_shape(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """edit_results entries carry every documented field."""
        (repo_dir / "a.py").write_text("x\n")
        service.set_selected_files(["a.py"])

        response = (
            "Change:\n\n"
            + self._build_edit_block("a.py", "x", "y")
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="change"
        )
        await asyncio.sleep(0.3)

        result = self._last_complete_result(event_cb)
        assert len(result["edit_results"]) == 1
        entry = result["edit_results"][0]
        # Required fields.
        assert entry["file"] == "a.py"
        assert entry["status"] == "applied"
        assert entry["error_type"] == ""
        # Previews populated even on success.
        assert "x" in entry["old_preview"]
        assert "y" in entry["new_preview"]
        assert "message" in entry

    async def test_multiple_edits_in_one_response(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Two edits in the same response both apply sequentially."""
        (repo_dir / "a.py").write_text("alpha\n")
        (repo_dir / "b.py").write_text("beta\n")
        service.set_selected_files(["a.py", "b.py"])

        response = (
            self._build_edit_block("a.py", "alpha", "ALPHA")
            + self._build_edit_block("b.py", "beta", "BETA")
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="uppercase"
        )
        await asyncio.sleep(0.3)

        assert (repo_dir / "a.py").read_text() == "ALPHA\n"
        assert (repo_dir / "b.py").read_text() == "BETA\n"

        result = self._last_complete_result(event_cb)
        assert result["passed"] == 2
        # files_modified preserves first-seen order.
        assert result["files_modified"] == ["a.py", "b.py"]

    async def test_create_block_during_streaming(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Create block (empty old text) creates a new file on disk."""
        # Create block has empty old text — just REPL and END.
        response = (
            f"Creating:\n\n"
            f"new.py\n{self.EDIT_MARK}\n"
            f"{self.REPL_MARK}\n"
            f"print('hi')\n{self.END_MARK}\n"
        )
        fake_litellm.set_streaming_chunks([response])

        # Empty selection — create bypasses the in-context check.
        await service.chat_streaming(
            request_id="r1", message="make new file"
        )
        await asyncio.sleep(0.3)

        # Parser joins content lines with "\n"; a single-line
        # body produces no trailing newline. If the LLM wants
        # one it emits a blank line before the END marker.
        assert (repo_dir / "new.py").read_text() == "print('hi')"

        result = self._last_complete_result(event_cb)
        assert result["passed"] == 1
        assert result["edit_blocks"][0]["is_create"] is True
        assert result["files_modified"] == ["new.py"]

    async def test_create_block_auto_adds_to_selection(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Successful create adds the new file to the selection.

        Pinned by specs4/3-llm/edit-protocol.md § "Created
        File Handling": creates auto-add so the next turn has
        the new file's content in context and the user sees it
        in the picker.
        """
        response = (
            f"new.py\n{self.EDIT_MARK}\n"
            f"{self.REPL_MARK}\n"
            f"print('hi')\n{self.END_MARK}\n"
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="create"
        )
        await asyncio.sleep(0.3)

        # File added to selected-files list.
        assert "new.py" in service.get_selected_files()

        # Result surfaces the created file separately from
        # auto-added modifies — the frontend uses this split
        # to decide whether to fire a retry prompt (creates
        # don't).
        result = self._last_complete_result(event_cb)
        assert result["files_created"] == ["new.py"]
        assert result["files_auto_added"] == []

    async def test_created_file_content_loaded_into_file_context(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Created file's content is loaded so the next turn sees it.

        Without this the LLM would see the file path in the
        selected list but the file context wouldn't have the
        content — the next turn's prompt assembly would either
        re-read from disk on-demand or silently drop the file.
        Pinning explicit loading ensures consistency with how
        auto-added modify targets are handled.
        """
        response = (
            f"helper.py\n{self.EDIT_MARK}\n"
            f"{self.REPL_MARK}\n"
            f"def helper(): pass\n{self.END_MARK}\n"
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="create helper"
        )
        await asyncio.sleep(0.3)

        # File context has the content.
        assert service._file_context.has_file("helper.py")
        content = service._file_context.get_content("helper.py")
        assert content is not None
        assert "def helper()" in content

    async def test_create_broadcasts_files_changed(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Successful create fires filesChanged after streamComplete.

        Collaborator clients rely on this broadcast to refresh
        their picker checkbox state. Without it, the server's
        selection mutates but remote clients still see the
        pre-create selection.
        """
        response = (
            f"new.py\n{self.EDIT_MARK}\n"
            f"{self.REPL_MARK}\n"
            f"x = 1\n{self.END_MARK}\n"
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="create"
        )
        await asyncio.sleep(0.3)

        # filesChanged fires AFTER streamComplete, carrying the
        # new selection.
        event_names = [name for name, _ in event_cb.events]
        complete_idx = event_names.index("streamComplete")
        post_complete = event_names[complete_idx + 1:]
        assert "filesChanged" in post_complete

        # Payload includes the newly-created file.
        files_changed_events = [
            args for name, args in event_cb.events
            if name == "filesChanged"
        ]
        assert files_changed_events
        last_payload = files_changed_events[-1][0]
        assert "new.py" in last_payload

    async def test_create_adds_to_selection_without_duplication(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Path already in selection isn't duplicated by create auto-add.

        Edge case: the LLM creates a file that's somehow
        already in the selection (unlikely in practice, but
        defensive against list-as-set mutation bugs).
        """
        # Pre-create the file so the create path hits
        # already_applied. This is the cleanest way to exercise
        # the "path might already be in selection" case without
        # needing an out-of-band manipulation.
        (repo_dir / "existing.py").write_text("pre-existing\n")
        service.set_selected_files(["existing.py"])

        response = (
            f"existing.py\n{self.EDIT_MARK}\n"
            f"{self.REPL_MARK}\n"
            f"pre-existing\n{self.END_MARK}\n"
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="re-create"
        )
        await asyncio.sleep(0.3)

        # Already-applied doesn't populate files_created (so
        # no auto-add attempt), and existing selection stays
        # unchanged.
        selected = service.get_selected_files()
        assert selected.count("existing.py") == 1

    async def test_create_and_not_in_context_modify_mixed(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Response with one create and one not-in-context modify.

        Both files should land in the selection via their
        respective auto-add paths. The result separates them
        so the frontend knows a retry prompt is warranted for
        the modify but not for the create.
        """
        # An existing file, not selected, so a modify against
        # it goes through the not-in-context path.
        (repo_dir / "old.py").write_text("original\n")

        response = (
            # Create block.
            f"new.py\n{self.EDIT_MARK}\n"
            f"{self.REPL_MARK}\n"
            f"created\n{self.END_MARK}\n"
            # Modify block for a file not in selection.
            f"\nold.py\n{self.EDIT_MARK}\n"
            f"original\n{self.REPL_MARK}\n"
            f"modified\n{self.END_MARK}\n"
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="mixed"
        )
        await asyncio.sleep(0.3)

        result = self._last_complete_result(event_cb)
        # Separated by source — create in files_created,
        # not-in-context modify in files_auto_added.
        assert result["files_created"] == ["new.py"]
        assert result["files_auto_added"] == ["old.py"]

        # Both landed in the selection.
        selected = service.get_selected_files()
        assert "new.py" in selected
        assert "old.py" in selected

    async def test_create_in_review_mode_skipped(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Review mode is read-only — creates don't apply, don't auto-add.

        Pinned by specs4/3-llm/edit-protocol.md § "Review
        Mode Read-Only": the entire apply step is skipped, so
        no files are created on disk and no auto-add happens.
        Regression guard against a future refactor that
        special-cases creates into the review path.
        """
        service._review_active = True
        response = (
            f"new.py\n{self.EDIT_MARK}\n"
            f"{self.REPL_MARK}\n"
            f"content\n{self.END_MARK}\n"
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="create during review"
        )
        await asyncio.sleep(0.3)

        # File not written.
        assert not (repo_dir / "new.py").exists()
        # Selection not mutated.
        assert "new.py" not in service.get_selected_files()
        # Block still surfaced in edit_blocks for UI display.
        result = self._last_complete_result(event_cb)
        assert len(result["edit_blocks"]) == 1
        # But no apply activity.
        assert result["passed"] == 0
        assert result["files_created"] == []

    async def test_not_in_context_edit_auto_adds_file(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Edit for unselected file → NOT_IN_CONTEXT + auto-added to selection."""
        (repo_dir / "a.py").write_text("content\n")
        # Deliberately empty selection.
        service.set_selected_files([])

        response = self._build_edit_block(
            "a.py", "content", "updated"
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="edit a.py"
        )
        await asyncio.sleep(0.3)

        # File NOT modified (not-in-context skips application).
        assert (repo_dir / "a.py").read_text() == "content\n"

        result = self._last_complete_result(event_cb)
        assert result["not_in_context"] == 1
        assert result["passed"] == 0
        assert result["files_auto_added"] == ["a.py"]

        # Service auto-added the file to its selection.
        assert "a.py" in service.get_selected_files()

    async def test_not_in_context_broadcasts_files_changed(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Auto-added files trigger filesChanged broadcast after completion."""
        (repo_dir / "a.py").write_text("x\n")
        service.set_selected_files([])

        response = self._build_edit_block("a.py", "x", "y")
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="edit"
        )
        await asyncio.sleep(0.3)

        # filesChanged events — we expect at least one AFTER
        # streamComplete (the auto-add broadcast).
        event_names = [name for name, _ in event_cb.events]
        complete_idx = event_names.index("streamComplete")
        post_complete = event_names[complete_idx + 1:]
        assert "filesChanged" in post_complete

    async def test_auto_added_files_loaded_into_file_context(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Auto-added files have their content loaded for the next request."""
        (repo_dir / "a.py").write_text("alpha content\n")
        service.set_selected_files([])

        response = self._build_edit_block("a.py", "alpha", "ALPHA")
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="edit"
        )
        await asyncio.sleep(0.3)

        # File context should have loaded a.py so the next
        # request's prompt assembly sees its content.
        assert service._file_context.has_file("a.py")
        assert service._file_context.get_content("a.py") == (
            "alpha content\n"
        )

    async def test_cancelled_stream_skips_apply(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Cancelled streams don't apply edits, even if blocks are complete."""
        (repo_dir / "a.py").write_text("original\n")
        service.set_selected_files(["a.py"])

        response = self._build_edit_block(
            "a.py", "original", "modified"
        )
        fake_litellm.set_streaming_chunks([response])

        # Simulate cancellation by pre-registering the request ID
        # in the cancelled set BEFORE the stream runs. The worker
        # thread checks on each chunk iteration.
        service._cancelled_requests.add("r1")

        await service.chat_streaming(
            request_id="r1", message="edit"
        )
        await asyncio.sleep(0.3)

        # File unchanged — apply was gated by the cancellation.
        assert (repo_dir / "a.py").read_text() == "original\n"

        # Result marked cancelled, apply fields zero.
        result = self._last_complete_result(event_cb)
        assert result.get("cancelled") is True
        assert result["passed"] == 0
        assert result["failed"] == 0

    async def test_review_mode_skips_apply(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Review mode is read-only — edits parse but don't apply."""
        (repo_dir / "a.py").write_text("original\n")
        service.set_selected_files(["a.py"])

        # Turn on the review-active flag directly (Layer 4.3
        # wires the entry/exit flow).
        service._review_active = True

        response = self._build_edit_block(
            "a.py", "original", "modified"
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="review"
        )
        await asyncio.sleep(0.3)

        # File unchanged.
        assert (repo_dir / "a.py").read_text() == "original\n"

        # Edit block still parsed and surfaced for UI display.
        result = self._last_complete_result(event_cb)
        assert len(result["edit_blocks"]) == 1
        # But no aggregate counts — apply was skipped entirely.
        assert result["passed"] == 0
        assert result["failed"] == 0
        assert result["edit_results"] == []

    async def test_no_repo_skips_apply_gracefully(
        self,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """No repo attached → no pipeline → apply skipped without error."""
        # Construct service without a repo.
        svc = LLMService(
            config=config,
            repo=None,
            event_callback=event_cb,
        )

        response = self._build_edit_block("a.py", "old", "new")
        fake_litellm.set_streaming_chunks([response])

        await svc.chat_streaming(
            request_id="r1", message="edit"
        )
        await asyncio.sleep(0.3)

        result = self._last_complete_result(event_cb)
        # Blocks parsed, but no apply attempted.
        assert len(result["edit_blocks"]) == 1
        assert result["passed"] == 0
        assert result["edit_results"] == []
        assert "error" not in result  # no spurious error

    async def test_shell_commands_detected_in_result(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Shell commands in the response populate result.shell_commands."""
        response = (
            "Run these:\n\n"
            "```bash\n"
            "npm install\n"
            "npm test\n"
            "```\n"
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="setup"
        )
        await asyncio.sleep(0.3)

        result = self._last_complete_result(event_cb)
        assert result["shell_commands"] == [
            "npm install", "npm test",
        ]

    async def test_response_with_no_edits_has_empty_edit_fields(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """A plain-prose response produces zero-count edit fields."""
        fake_litellm.set_streaming_chunks([
            "Just some prose with no edit blocks.",
        ])

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.3)

        result = self._last_complete_result(event_cb)
        assert result["edit_blocks"] == []
        assert result["edit_results"] == []
        assert result["files_modified"] == []
        assert result["files_auto_added"] == []
        assert result["passed"] == 0
        assert result["failed"] == 0

    async def test_mixed_in_context_and_not_in_same_response(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """In-context edit applies; not-in-context edit defers."""
        (repo_dir / "selected.py").write_text("one\n")
        (repo_dir / "unselected.py").write_text("two\n")
        service.set_selected_files(["selected.py"])

        response = (
            self._build_edit_block("selected.py", "one", "ONE")
            + self._build_edit_block(
                "unselected.py", "two", "TWO"
            )
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="both"
        )
        await asyncio.sleep(0.3)

        # Selected file modified, unselected untouched.
        assert (repo_dir / "selected.py").read_text() == "ONE\n"
        assert (repo_dir / "unselected.py").read_text() == "two\n"

        result = self._last_complete_result(event_cb)
        assert result["passed"] == 1
        assert result["not_in_context"] == 1
        assert result["files_modified"] == ["selected.py"]
        assert result["files_auto_added"] == ["unselected.py"]

    async def test_failed_edit_reports_anchor_not_found(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Edit with non-matching anchor → failed + anchor_not_found."""
        (repo_dir / "a.py").write_text("real content\n")
        service.set_selected_files(["a.py"])

        response = self._build_edit_block(
            "a.py", "imagined content", "replacement"
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="bad edit"
        )
        await asyncio.sleep(0.3)

        # File unchanged.
        assert (repo_dir / "a.py").read_text() == "real content\n"

        result = self._last_complete_result(event_cb)
        assert result["failed"] == 1
        assert result["passed"] == 0
        assert result["edit_results"][0]["error_type"] == (
            "anchor_not_found"
        )


class TestCompletionResultAgentBlocks:
    """C2a — ``agent_blocks`` field in the stream-complete result.

    The frontend's C2a spawn handler reads ``result.agent_blocks``
    to create agent tabs. Each entry carries ``id``, ``task``,
    and ``agent_idx``. Invalid blocks (missing id or task) are
    filtered so the frontend can trust the field's contents
    without re-validating; its ordering matches the backend's
    spawn path so ``agent_idx`` values line up with archive
    paths and child request IDs.

    Empty field on responses without agent blocks — frontend
    checks ``result.agent_blocks.length > 0`` before opening
    tabs, so an always-present empty array is friendlier than
    an optional key.
    """

    AGENT_MARK = "🟧🟧🟧 AGENT"
    AGEND_MARK = "🟩🟩🟩 AGEND"

    def _build_agent_block(self, id_: str, task: str) -> str:
        """Assemble one well-formed agent block."""
        return (
            f"{self.AGENT_MARK}\n"
            f"id: {id_}\n"
            f"task: {task}\n"
            f"{self.AGEND_MARK}\n"
        )

    def _last_complete_result(
        self, event_cb: _RecordingEventCallback
    ) -> dict:
        completes = [
            args for name, args in event_cb.events
            if name == "streamComplete"
        ]
        assert completes, "No streamComplete event observed"
        return completes[-1][1]

    async def test_no_agent_blocks_field_always_present(
        self,
        service: LLMService,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Plain response → empty list, not missing key."""
        fake_litellm.set_streaming_chunks(["Hello."])

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.2)

        result = self._last_complete_result(event_cb)
        assert "agent_blocks" in result
        assert result["agent_blocks"] == []

    async def test_single_valid_block_surfaces(
        self,
        service: LLMService,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Response with one well-formed agent block surfaces it."""
        response = (
            "I'll delegate.\n\n"
            + self._build_agent_block("agent-0", "refactor auth")
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="please"
        )
        await asyncio.sleep(0.2)

        result = self._last_complete_result(event_cb)
        assert len(result["agent_blocks"]) == 1
        block = result["agent_blocks"][0]
        assert block["id"] == "agent-0"
        assert block["task"] == "refactor auth"
        assert block["agent_idx"] == 0

    async def test_multiple_blocks_get_sequential_indices(
        self,
        service: LLMService,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """agent_idx enumerates 0..N-1 in source order.

        The frontend uses agent_idx to derive tab IDs matching
        the backend's archive path convention. If the ordering
        diverged between backend spawn (which enumerates
        ``_spawn_agents_for_turn``'s input list) and the result
        field, tab IDs would point at wrong archive files.
        """
        response = (
            self._build_agent_block("agent-0", "task zero")
            + self._build_agent_block("agent-1", "task one")
            + self._build_agent_block("agent-2", "task two")
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="decompose"
        )
        await asyncio.sleep(0.2)

        blocks = self._last_complete_result(event_cb)["agent_blocks"]
        assert [b["agent_idx"] for b in blocks] == [0, 1, 2]
        assert [b["id"] for b in blocks] == [
            "agent-0", "agent-1", "agent-2",
        ]
        assert [b["task"] for b in blocks] == [
            "task zero", "task one", "task two",
        ]

    async def test_invalid_blocks_filtered_from_result(
        self,
        service: LLMService,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Blocks missing id or task don't reach the frontend.

        Matches the filter applied by the backend's spawn path
        (``_filter_dispatchable_agents``). A stale or malformed
        block that wouldn't produce an actual agent stream
        shouldn't produce a ghost tab either.
        """
        # First block valid; second missing task; third valid.
        invalid_no_task = (
            f"{self.AGENT_MARK}\n"
            f"id: agent-1\n"
            f"{self.AGEND_MARK}\n"
        )
        response = (
            self._build_agent_block("agent-0", "first")
            + invalid_no_task
            + self._build_agent_block("agent-2", "third")
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="mixed"
        )
        await asyncio.sleep(0.2)

        blocks = self._last_complete_result(event_cb)["agent_blocks"]
        assert len(blocks) == 2
        assert [b["id"] for b in blocks] == ["agent-0", "agent-2"]

    async def test_agent_blocks_preserved_when_mixed_with_edits(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Response with both agent and edit blocks surfaces both.

        Parse order in the response doesn't affect either
        field's ordering — agents enumerate by agent block
        order, edits by edit block order.
        """
        (repo_dir / "a.py").write_text("original\n")
        service.set_selected_files(["a.py"])
        response = (
            "Mixed work:\n\n"
            + self._build_agent_block("agent-0", "handle ui")
            + "\na.py\n🟧🟧🟧 EDIT\noriginal\n"
            + "🟨🟨🟨 REPL\nmodified\n🟩🟩🟩 END\n"
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="mixed"
        )
        await asyncio.sleep(0.3)

        result = self._last_complete_result(event_cb)
        assert len(result["agent_blocks"]) == 1
        assert result["agent_blocks"][0]["id"] == "agent-0"
        assert len(result["edit_blocks"]) == 1
        assert result["edit_blocks"][0]["file"] == "a.py"


class TestStreamingRequestUsage:
    """Per-request token_usage in the stream-complete result.

    Regression guard for the HUD "This Request" section. The
    `_FakeLiteLLM` emits a final chunk with ``prompt_tokens=10``,
    ``completion_tokens=5``; those numbers must make it through
    ``_run_completion_sync`` → ``_stream_chat`` →
    ``_build_completion_result`` → ``result["token_usage"]`` to
    reach the frontend HUD.

    Before the fix, ``_build_completion_result`` initialised
    ``token_usage`` to zero and never wrote to it — the
    per-request section in the HUD always showed zero even
    though session totals climbed. The fix threads a
    normalised usage dict from the worker thread back out as
    a 4th tuple element.
    """

    async def _last_complete_result(
        self,
        event_cb: _RecordingEventCallback,
    ) -> dict[str, Any]:
        """Extract the most recent streamComplete result dict.

        Async helper so callers can `await asyncio.sleep(...)`
        before invoking it — matches the usage pattern in the
        neighbouring streaming test classes.
        """
        completes = [
            args for name, args in event_cb.events
            if name == "streamComplete"
        ]
        assert completes, "No streamComplete event observed"
        # args = (request_id, result_dict)
        return completes[-1][1]

    async def test_token_usage_populated_when_provider_reports(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """Provider-reported usage threads through to the HUD contract."""
        fake_litellm.set_streaming_chunks(["reply"])

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.2)

        result = await self._last_complete_result(event_cb)
        usage = result.get("token_usage")
        assert usage is not None
        # Fake injects 10/5; the worker normalises provider
        # field-name variations but plain prompt/completion
        # round-trip unchanged.
        assert usage["prompt_tokens"] == 10
        assert usage["completion_tokens"] == 5
        # Cache fields present even when provider didn't report
        # them (normalised to zero).
        assert usage["cache_read_tokens"] == 0
        assert usage["cache_write_tokens"] == 0

    async def test_token_usage_shape_stable_on_error(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Errors produce an all-zero usage dict, not missing field.

        The frontend HUD reads token_usage unconditionally; a
        missing key would render as undefined/NaN. The backend
        always emits a dict with all four keys — zeros on the
        error path. Pinning the shape stops a future refactor
        from silently dropping the field on error exits.
        """
        # Force an error in the executor.
        def _raise(*args: Any, **kwargs: Any) -> None:
            raise RuntimeError("simulated LLM failure")
        monkeypatch.setattr(
            service, "_run_completion_sync", _raise
        )

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.2)

        result = await self._last_complete_result(event_cb)
        assert "error" in result
        # Shape preserved even on error.
        usage = result.get("token_usage")
        assert usage is not None
        assert usage["prompt_tokens"] == 0
        assert usage["completion_tokens"] == 0
        assert usage["cache_read_tokens"] == 0
        assert usage["cache_write_tokens"] == 0

    async def test_session_totals_match_request_usage(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """Session totals reflect the same per-request numbers.

        Before the fix, per-request was zero and session totals
        climbed — the two views disagreed. After the fix they
        agree: one request's usage shows up in both places.
        """
        fake_litellm.set_streaming_chunks(["reply"])

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.2)

        result = await self._last_complete_result(event_cb)
        request_usage = result["token_usage"]
        totals = service.get_session_totals()

        # Session totals accumulate; after one request they
        # equal the request's usage.
        assert totals["input_tokens"] == (
            request_usage["prompt_tokens"]
        )
        assert totals["output_tokens"] == (
            request_usage["completion_tokens"]
        )