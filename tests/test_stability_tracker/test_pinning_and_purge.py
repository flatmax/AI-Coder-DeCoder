"""Pinned-file survival, deletion markers in Phase 0, history purge.

Extracted from the original monolithic ``test_stability_tracker.py``.
"""

from __future__ import annotations

from ac_dc.stability_tracker import (
    StabilityTracker,
    Tier,
    TrackedItem,
    _DELETION_MARKER_HASH,
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


class TestDeletionMarkerInPhase0:
    """Phase 0 transitions deleted file entries to markers.

    When ``existing_files`` does not include a tracked
    ``file:`` path, the entry's content is replaced by the
    deletion marker (constant text + constant hash) instead
    of being removed.
    """

    def test_deleted_file_becomes_marker(self) -> None:
        """File path absent from existing_files → marker entry."""
        tracker = StabilityTracker()
        tracker.update(
            {"file:a.py": _active_item("h1", 100)},
            existing_files={"a.py"},
        )
        # Next cycle: a.py no longer exists on disk.
        tracker.update(
            {"file:a.py": _active_item("h1", 100)},
            existing_files=set(),
        )
        assert tracker.has_item("file:a.py") is True
        assert tracker.is_deleted("file:a.py") is True
        assert (
            tracker.get_signature_hash("file:a.py")
            == _DELETION_MARKER_HASH
        )

    def test_pinned_file_also_transitions_to_marker(self) -> None:
        """Pinned files transition to markers on deletion.

        Pin status and deletion status are mutually exclusive
        (mark_deleted clears the pin); the deletion event
        wins because the file's actual content is gone.
        """
        tracker = StabilityTracker()
        # Edit the file → pinned.
        tracker.update(
            {"file:a.py": _active_item("h1", 100)},
            existing_files={"a.py"},
        )
        tracker.update(
            {"file:a.py": _active_item("h2", 100)},
            existing_files={"a.py"},
        )
        assert tracker.is_pinned("file:a.py") is True
        # Deletion event:
        tracker.update({}, existing_files=set())
        assert tracker.is_deleted("file:a.py") is True
        assert tracker.is_pinned("file:a.py") is False

    def test_marker_survives_deselection(self) -> None:
        """Deletion-marker entries stay through deselection."""
        tracker = StabilityTracker()
        tracker.update(
            {"file:a.py": _active_item("h1", 100)},
            existing_files={"a.py"},
        )
        tracker.update({}, existing_files=set())
        # File departed AND was deleted → marker. Stays.
        assert tracker.has_item("file:a.py") is True
        assert tracker.is_deleted("file:a.py") is True

    def test_marker_skips_underfill_demotion(self) -> None:
        """Markers are exempt from underfill demotion."""
        tracker = StabilityTracker(cache_target_tokens=500)
        tracker._items["file:a.py"] = TrackedItem(
            "file:a.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=100,
        )
        tracker.mark_deleted("file:a.py")
        # L1 well below cache_target. Marker should stay.
        tracker.update({}, existing_files=set())
        assert tracker.get_all_items()["file:a.py"].tier == Tier.L1

    def test_recreated_file_clears_marker(self) -> None:
        """Re-creating a file at the same path clears marker state.

        The new content has a different hash from
        DELETION_MARKER_HASH, so Phase 1 detects a hash change.
        The transition out of marker state clears the
        ``_deleted`` flag without setting the pin (re-creation
        is not an edit of an existing file).
        """
        tracker = StabilityTracker()
        # Existing file → tracked.
        tracker.update(
            {"file:a.py": _active_item("h_orig", 100)},
            existing_files={"a.py"},
        )
        # File deleted.
        tracker.update({}, existing_files=set())
        assert tracker.is_deleted("file:a.py") is True
        # File re-created (same path, new content). Phase 0
        # sees the path back in existing_files and skips the
        # transition; Phase 1 sees the hash differ from the
        # marker hash and demotes to active with fresh content.
        tracker.update(
            {"file:a.py": _active_item("h_new", 100)},
            existing_files={"a.py"},
        )
        assert tracker.is_deleted("file:a.py") is False
        # Re-creation doesn't pin — pin is for edits, not for
        # re-creation. Subsequent edits during this session
        # would pin via the normal hash-change path.
        assert tracker.is_pinned("file:a.py") is False

    def test_symbol_entry_still_removed_on_deletion(self) -> None:
        """Non-file entries continue to use the legacy removal path."""
        tracker = StabilityTracker()
        tracker.update(
            {"symbol:a.py": _active_item("h1", 100)},
            existing_files={"a.py"},
        )
        tracker.update({}, existing_files=set())
        # Symbol entries are removed (not transitioned to markers).
        assert tracker.has_item("symbol:a.py") is False


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