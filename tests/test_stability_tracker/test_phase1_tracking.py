"""Phase 1 hash tracking, cleanup, stale removal, first measurement.

Extracted from the original monolithic ``test_stability_tracker.py``.
"""

from __future__ import annotations

from ac_dc.stability_tracker import (
    StabilityTracker,
    Tier,
    TrackedItem,
)

from .conftest import _active_item, _drive_n_unchanged, xfail_legacy_cascade


# ---------------------------------------------------------------------------
# Phase 1 — hash-based N tracking
# ---------------------------------------------------------------------------


class TestActiveItemTracking:
    """New items, hash changes, unchanged increments."""

    def test_new_item_starts_in_active_with_n_zero(self) -> None:
        """First appearance → active, N=0."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item("h1", 100)})
        items = tracker.get_tier_items(Tier.ACTIVE)
        assert "file:a.py" in items
        item = items["file:a.py"]
        assert item.n_value == 0
        assert item.content_hash == "h1"
        assert item.tokens == 100

    def test_unchanged_item_increments_n(self) -> None:
        """Same hash across cycles increments N each time."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item("h1")})
        tracker.update({"file:a.py": _active_item("h1")})
        tracker.update({"file:a.py": _active_item("h1")})
        # After 3 unchanged cycles, N should have incremented.
        # Item may have been promoted (N=3 graduates to L3), so
        # check both possibilities.
        item = tracker.get_all_items()["file:a.py"]
        assert item.n_value >= 2 or item.tier == Tier.L3

    def test_hash_change_resets_n_and_demotes(self) -> None:
        """Changed hash → N=0, item back in active."""
        tracker = StabilityTracker()
        # Cycle a few times to push it up.
        _drive_n_unchanged(tracker, "file:a.py", "h1", 100, cycles=3)
        # Now change the hash.
        tracker.update({"file:a.py": _active_item("h2", 100)})
        item = tracker.get_all_items()["file:a.py"]
        assert item.n_value == 0
        assert item.tier == Tier.ACTIVE
        assert item.content_hash == "h2"

    def test_tokens_update_on_every_cycle(self) -> None:
        """Token count refreshes even without hash change.

        Tokens may change due to re-rendering (symbol map
        formatting changes with path aliases, for example) without
        a structural change. The tracker keeps them fresh.
        """
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item("h1", 100)})
        tracker.update({"file:a.py": _active_item("h1", 150)})
        assert tracker.get_all_items()["file:a.py"].tokens == 150

    @xfail_legacy_cascade
    def test_change_log_records_demotion(self) -> None:
        """Hash change after graduation is recorded in change log."""
        tracker = StabilityTracker()
        # 4 cycles with unchanged hash → item graduates to L3 at N=3.
        _drive_n_unchanged(tracker, "file:a.py", "h1", 100, cycles=4)
        # Now it's in L3. Change the hash — should demote back to
        # active and log the tier change with "hash changed".
        tracker.update({"file:a.py": _active_item("h2", 100)})
        changes = tracker.get_changes()
        assert any("a.py" in c and "hash changed" in c for c in changes)

    def test_changes_cleared_between_updates(self) -> None:
        """Change log only reflects the most recent update."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item("h1")})
        tracker.update({"file:a.py": _active_item("h1")})
        # Second update should have no changes (item was already
        # registered; just incremented N silently).
        assert tracker.get_changes() == []


# ---------------------------------------------------------------------------
# Phase 1 — file/history cleanup
# ---------------------------------------------------------------------------


class TestDepartedItemCleanup:
    """file:* and history:* items removed when not in active."""

    def test_file_item_removed_when_not_in_active(self) -> None:
        """Deselected file vanishes from the tracker."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item()})
        # Next cycle — empty active items.
        tracker.update({})
        assert tracker.has_item("file:a.py") is False

    def test_history_item_removed_when_not_in_active(self) -> None:
        """Compacted history entry vanishes from the tracker."""
        tracker = StabilityTracker()
        tracker.update({"history:0": _active_item()})
        tracker.update({})
        assert tracker.has_item("history:0") is False

    def test_symbol_item_persists_when_not_in_active(self) -> None:
        """symbol:* entries are repo structure — they persist.

        A symbol entry represents the file's indexed structure.
        The streaming handler lists it in active items while the
        file's index block is in the prompt; when the block moves
        into a cached tier, the key leaves active but the symbol
        entry must stay in the tracker at its earned tier.
        """
        tracker = StabilityTracker()
        tracker.update({"symbol:a.py": _active_item()})
        # Next cycle — not in active anymore.
        tracker.update({})
        assert tracker.has_item("symbol:a.py") is True

    def test_doc_item_persists_when_not_in_active(self) -> None:
        """doc:* entries are repo structure too — persist same as symbol."""
        tracker = StabilityTracker()
        tracker.update({"doc:a.md": _active_item()})
        tracker.update({})
        assert tracker.has_item("doc:a.md") is True

    def test_system_item_persists_when_not_in_active(self) -> None:
        """system:* entries are pinned — never auto-removed."""
        tracker = StabilityTracker()
        tracker.update({"system:prompt": _active_item()})
        tracker.update({})
        assert tracker.has_item("system:prompt") is True

    def test_url_item_persists_when_not_in_active(self) -> None:
        """url:* lifecycle is caller-managed, not auto-cleanup."""
        tracker = StabilityTracker()
        tracker.update({"url:abc123": _active_item()})
        tracker.update({})
        assert tracker.has_item("url:abc123") is True

    def test_cleanup_change_logged(self) -> None:
        """Removal from tracker logged in the change log."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item()})
        tracker.update({})
        changes = tracker.get_changes()
        assert any("a.py" in c and "not in active" in c for c in changes)


# ---------------------------------------------------------------------------
# Phase 0 — stale removal
# ---------------------------------------------------------------------------


class TestStaleRemoval:
    """Items whose file no longer exists are dropped."""

    def test_stale_file_becomes_marker(self) -> None:
        """file:* for deleted path transitions to a deletion marker.

        Under the L0-content-typed model (D27), ``file:``
        entries don't disappear on disk-deletion — they
        become deletion markers so the LLM continues to see
        a representation of the file (the constant marker
        text) until the next ``rebuild_cache`` re-extracts
        L0's aggregate maps. Dedicated coverage of the
        marker contract lives in
        :class:`TestDeletionMarkerInPhase0`; this test pins
        the membership half of the invariant — the entry
        stays present after Phase 0 sees the deletion.
        """
        tracker = StabilityTracker()
        tracker.update(
            {"file:a.py": _active_item()},
            existing_files={"a.py"},
        )
        tracker.update(
            {"file:a.py": _active_item()},
            existing_files=set(),  # a.py deleted
        )
        assert tracker.has_item("file:a.py") is True
        assert tracker.is_deleted("file:a.py") is True

    def test_stale_symbol_removed(self) -> None:
        """symbol:* for deleted path is dropped."""
        tracker = StabilityTracker()
        tracker.update(
            {"symbol:a.py": _active_item()},
            existing_files={"a.py"},
        )
        tracker.update({}, existing_files=set())
        assert tracker.has_item("symbol:a.py") is False

    def test_stale_doc_removed(self) -> None:
        """doc:* for deleted path is dropped."""
        tracker = StabilityTracker()
        tracker.update(
            {"doc:a.md": _active_item()},
            existing_files={"a.md"},
        )
        tracker.update({}, existing_files=set())
        assert tracker.has_item("doc:a.md") is False

    def test_system_key_not_affected_by_stale_check(self) -> None:
        """system:* keys have no file path; stale check skips them."""
        tracker = StabilityTracker()
        tracker.update(
            {"system:prompt": _active_item()},
            existing_files=set(),  # empty — but system still stays
        )
        assert tracker.has_item("system:prompt") is True

    def test_url_key_not_affected_by_stale_check(self) -> None:
        """url:* keys have no file path; stale check skips them."""
        tracker = StabilityTracker()
        tracker.update(
            {"url:abc": _active_item()},
            existing_files=set(),
        )
        assert tracker.has_item("url:abc") is True

    def test_history_key_not_affected_by_stale_check(self) -> None:
        """history:* keys have no file path; stale check skips them."""
        tracker = StabilityTracker()
        tracker.update(
            {"history:0": _active_item()},
            existing_files=set(),
        )
        assert tracker.has_item("history:0") is True

    def test_stale_removal_change_logged(self) -> None:
        """Stale-handling fires a change-log entry.

        For ``symbol:`` / ``doc:`` entries the legacy
        "removed (stale)" wording is preserved; ``file:``
        entries log the marker transition instead. We assert
        the symbol-removal wording here since this test sits
        in the legacy-removal class. Marker-specific log
        content is covered by
        :class:`TestDeletionMarkerInPhase0`.
        """
        tracker = StabilityTracker()
        tracker.update(
            {"symbol:a.py": _active_item()},
            existing_files={"a.py"},
        )
        tracker.update({}, existing_files=set())
        changes = tracker.get_changes()
        assert any(
            "a.py" in c and "stale" in c for c in changes
        )

    def test_none_existing_files_skips_phase_0(self) -> None:
        """Passing None for existing_files skips stale removal.

        Tests and callers that don't want to simulate file
        deletions pass None. Matches the default.
        """
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item()})
        # existing_files=None → Phase 0 skipped, item stays.
        tracker.update(
            {"file:a.py": _active_item()},
            existing_files=None,
        )
        assert tracker.has_item("file:a.py") is True


# ---------------------------------------------------------------------------
# First-measurement acceptance (initialisation placeholder hash)
# ---------------------------------------------------------------------------


class TestFirstMeasurement:
    """Items with empty-string hash accept first real hash.

    Items initialised from the reference graph start with an
    empty content hash (placeholder). On the first update they
    receive a real hash — this must not be treated as a
    hash-change demotion, or every initialised item would be
    demoted on the first request after startup.
    """

    def test_empty_to_real_hash_not_treated_as_change(self) -> None:
        """Placeholder → real hash accepts without demotion."""
        tracker = StabilityTracker()
        # Manually seed an item at L2 with placeholder hash.
        tracker._items["symbol:a.py"] = TrackedItem(
            "symbol:a.py", Tier.L2, n_value=6,
            content_hash="",  # placeholder
            tokens=100,
        )
        # Update with a real hash.
        tracker.update({"symbol:a.py": _active_item("real-hash", 100)})
        item = tracker.get_all_items()["symbol:a.py"]
        # Should still be in L2, not demoted.
        assert item.tier == Tier.L2
        # Hash should now be the real one.
        assert item.content_hash == "real-hash"
        # N should have incremented (normal unchanged-cycle behaviour).
        assert item.n_value == 7

    def test_real_to_different_hash_demotes(self) -> None:
        """After first-measurement, subsequent hash changes demote."""
        tracker = StabilityTracker()
        tracker._items["symbol:a.py"] = TrackedItem(
            "symbol:a.py", Tier.L2, n_value=6,
            content_hash="",
            tokens=100,
        )
        # First update — accepts real hash.
        tracker.update({"symbol:a.py": _active_item("h1", 100)})
        # Second update — hash changes, should demote.
        tracker.update({"symbol:a.py": _active_item("h2", 100)})
        item = tracker.get_all_items()["symbol:a.py"]
        assert item.tier == Tier.ACTIVE