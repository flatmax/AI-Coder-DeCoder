"""get_current_state shape and copy-discipline.

Covers :class:`TestStateSnapshot` — the snapshot surface read by
the frontend on connect and after broadcasts. Verifies the full
set of documented keys and that returned lists are independent
copies.
"""

from __future__ import annotations

from pathlib import Path

from ac_dc.llm_service import LLMService


class TestStateSnapshot:
    """get_current_state returns the documented shape."""

    def test_snapshot_shape(
        self, service: LLMService
    ) -> None:
        """Required fields are present."""
        state = service.get_current_state()
        assert set(state.keys()) == {
            "messages",
            "selected_files",
            "streaming_active",
            "session_id",
            "repo_name",
            "init_complete",
            "mode",
            "cross_ref_enabled",
            "enrichment_status",
            "review_state",
            "excluded_index_files",
            "doc_convert_available",
        }

    def test_messages_is_copy(
        self, service: LLMService
    ) -> None:
        """Mutating returned messages doesn't affect state."""
        state = service.get_current_state()
        state["messages"].append({"role": "user", "content": "fake"})
        assert service.get_current_state()["messages"] == []

    def test_selected_files_is_copy(
        self,
        service: LLMService,
        repo_dir: Path,
    ) -> None:
        """Mutating returned selected_files doesn't affect state."""
        (repo_dir / "a.md").write_text("x")
        service.set_selected_files(["a.md"])
        state = service.get_current_state()
        state["selected_files"].append("fake.md")
        assert service.get_current_state()["selected_files"] == ["a.md"]