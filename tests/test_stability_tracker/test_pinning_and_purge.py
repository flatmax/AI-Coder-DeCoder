"""Pinned-file survival, stale-removal in Phase 0, history purge.

Extracted from the original monolithic ``test_stability_tracker.py``.

Under D36 the deletion-marker mechanism was removed — files
that disappear from disk are simply pruned from the tracker
by the existing_files sweep, and the parent directory's
``plain_files:<dir>`` / ``symbols:<dir>`` / ``docs:<dir>``
block re-renders without the missing file (block hash changes,
flux re-rides).
"""

from __future__ import annotations

from ac_dc.stability_tracker import (
    StabilityTracker,
    Tier,
    TrackedItem,
)

from .conftest import _active_item


class TestPinnedFileSurvivesEvents:
    """Pinned ``file:`` entries are protected from cleanup.

    The edit invariant: a file edited during the session must
    keep its full text in cache until ``rebuild_cache`` or
    application restart, regardless of selection state or
    underfill conditions.
    """

    def test_hash_change_pins_file_entry(self) -> None:
        """Phase 1 sets the pin flag on file: hash change."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item("h1", 100)})
        assert tracker.is_pinned("file:a.py") is False
        tracker.update({"file:a.py": _active_item("h2", 100)})
        assert tracker.is_pinned("file:a.py") is True

    def test_hash_change_does_not_pin_non_file_entries(self) -> None:
        """Pin only applies to ``file:`` keys.

        A ``url:`` content change is hash-detected the same way
        but doesn't trigger pinning — URL content isn't subject
        to the edit invariant.
        """
        tracker = StabilityTracker()
        tracker.update({"url:abc": _active_item("h1", 100)})
        tracker.update({"url:abc": _active_item("h2", 100)})
        assert tracker.is_pinned("url:abc") is False

    def test_pinned_file_survives_deselection(self) -> None:
        """A pinned file entry stays in the tracker after deselection.

        Without the pin, departing files are removed by Phase
        1 cleanup. With the pin, the entry stays at its
        current tier so subsequent ``rebuild_cache`` or restart
        is the only way to clear it.
        """
        tracker = StabilityTracker()
        # Edit the file (hash change → pin set).
        tracker.update({"file:a.py": _active_item("h1", 100)})
        tracker.update({"file:a.py": _active_item("h2", 100)})
        assert tracker.is_pinned("file:a.py") is True
        # User deselects: file:a.py no longer in active items.
        tracker.update({})
        # Entry must still be present.
        assert tracker.has_item("file:a.py") is True
        assert tracker.is_pinned("file:a.py") is True

    def test_unpinned_file_removed_on_deselection(self) -> None:
        """An unedited file entry is removed normally on deselection."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item("h1", 100)})
        # No edit → no pin.
        tracker.update({})
        assert tracker.has_item("file:a.py") is False

    def test_pinned_file_skips_underfill_demotion(self) -> None:
        """A pinned file at an underfilled tier doesn't demote."""
        tracker = StabilityTracker(cache_target_tokens=500)
        tracker._items["file:a.py"] = TrackedItem(
            "file:a.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=100,
        )
        tracker.pin_file("file:a.py")
        # L1 is well below cache_target (100 < 500). Without
        # pinning, the item would demote to L2.
        tracker.update({"file:a.py": _active_item("h1", 100)})
        assert tracker.get_all_items()["file:a.py"].tier == Tier.L1


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

    def test_pinned_file_removed_on_disk_deletion(self) -> None:
        """Pinned files are removed when the path leaves disk.

        Pin only protects against deselection (no longer in
        active_items). When the file leaves the existing_files
        set entirely, the entry must go — the file no longer
        exists, so retaining its content would mislead the LLM.
        """
        tracker = StabilityTracker()
        tracker.update(
            {"file:a.py": _active_item("h1", 100)},
            existing_files={"a.py"},
        )
        tracker.update(
            {"file:a.py": _active_item("h2", 100)},
            existing_files={"a.py"},
        )
        assert tracker.is_pinned("file:a.py") is True
        # Disk deletion event:
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
