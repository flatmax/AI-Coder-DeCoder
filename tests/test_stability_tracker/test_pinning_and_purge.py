"""Stale-removal in Phase 0, history purge.

Extracted from the original monolithic ``test_stability_tracker.py``.

Under the membrane / flux cache model, deselected files are
simply pruned from the tracker by the existing-files sweep
or the file:/history: departure cleanup, and the parent
directory's ``plain_files:<dir>`` / ``symbols:<dir>`` /
``docs:<dir>`` block continues to represent the file's
structural presence.
"""

from __future__ import annotations

from ac_dc.stability_tracker import StabilityTracker, Tier

from .conftest import _active_item


class TestDeselectionRemovesFileEntries:
    """File entries are removed on deselection regardless of edit history.

    Under the membrane / flux cache model, deselected files
    no longer need pin protection — the parent directory's
    dir-block continues to carry the file's structural
    presence, and re-selection brings the full text back.
    """

    def test_unedited_file_removed_on_deselection(self) -> None:
        """An unedited file entry is removed on deselection."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item("h1", 100)})
        tracker.update({})
        assert tracker.has_item("file:a.py") is False

    def test_edited_file_also_removed_on_deselection(self) -> None:
        """An edited file is also removed on deselection.

        Pre-membrane, a hash change auto-pinned the entry so
        it survived deselection. The membrane model retires
        that protection — symbol/doc dir-blocks cover
        structural presence and the user can re-select to
        bring full content back.
        """
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item("h1", 100)})
        tracker.update({"file:a.py": _active_item("h2", 100)})
        assert tracker.has_item("file:a.py") is True
        tracker.update({})
        assert tracker.has_item("file:a.py") is False


class TestStaleRemovalInPhase0:
    """Phase 0 prunes ``file:`` entries when the path leaves disk.

    Under D36 there's no deletion-marker text — the file
    entry simply leaves the tracker, and its parent
    directory's dir-block (``plain_files:<dir>`` /
    ``symbols:<dir>`` / ``docs:<dir>``) re-renders without
    the missing file's signature on the next turn.
    """

    def test_deleted_file_removed_from_tracker(self) -> None:
        """File path absent from existing_files → entry removed."""
        tracker = StabilityTracker()
        tracker.update(
            {"file:a.py": _active_item("h1", 100)},
            existing_files={"a.py"},
        )
        assert tracker.has_item("file:a.py") is True
        # Next cycle: a.py no longer exists on disk and isn't
        # passed in active items either.
        tracker.update({}, existing_files=set())
        assert tracker.has_item("file:a.py") is False

    def test_dir_block_entry_persists_when_absent_from_active(self) -> None:
        """Dir-block entries persist across cycles regardless of active_items.

        Under D36 dir-blocks represent repo structure and are
        intentionally NOT subject to the file:/history:
        departure-cleanup path. They stay in their earned tier
        and re-render their content live at assembly time.
        """
        tracker = StabilityTracker()
        tracker.update({"symbols:src": _active_item("h1", 100)})
        assert tracker.has_item("symbols:src") is True
        # Empty active items → dir-block stays put.
        tracker.update({})
        assert tracker.has_item("symbols:src") is True


class TestPurgeHistory:
    """purge_history removes all history:* items."""

    def test_purges_all_history_items(self) -> None:
        """Every history:* entry is removed."""
        tracker = StabilityTracker()
        tracker.update(
            {
                "history:0": _active_item(),
                "history:1": _active_item(),
                "history:2": _active_item(),
                "file:a.py": _active_item(),
            }
        )
        tracker.purge_history()
        # History gone.
        assert not any(
            key.startswith("history:") for key in tracker.get_all_items()
        )
        # File unaffected.
        assert tracker.has_item("file:a.py")

    def test_purge_empty_tracker_is_safe(self) -> None:
        """Purging with no history items is a no-op — no error."""
        tracker = StabilityTracker()
        tracker.purge_history()  # must not raise
        assert tracker.get_all_items() == {}

    def test_purge_marks_tiers_broken(self) -> None:
        """Purge marks tiers that had history as broken.

        Verified indirectly — the next update cycle should
        reflect the broken state via cascade behaviour.
        Difficult to test without more setup; here we just pin
        that purge doesn't error.
        """
        tracker = StabilityTracker()
        tracker.update({"history:0": _active_item()})
        tracker.purge_history()
        # No error, history entry gone.
        assert not tracker.has_item("history:0")
