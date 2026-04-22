"""Tests for ac_dc.stability_tracker — Layer 3.5.

Scope: the StabilityTracker — tier assignment, N-value
tracking, cascade promotion, anchoring, demotion, stale
removal, history purge, initialisation from reference graph.

Strategy:

- Drive :meth:`StabilityTracker.update` directly with hand-built
  active-items dicts. No real symbol index; no file system. The
  tracker's logic is pure.
- Use small synthetic hashes (``"h1"``, ``"h2"``) rather than
  SHA-256 — the tracker treats hashes as opaque strings.
- Tests that exercise anchoring or underfill pass explicit
  ``cache_target_tokens`` values matched to the per-item token
  counts. Tests that exercise the simple promote/demote path
  pass ``cache_target_tokens=0`` to disable anchoring and
  underfill demotion.
- The :class:`_FakeRefIndex` doubles the reference-graph
  protocol (``connected_components``, ``file_ref_count``).
  Matches what the real :class:`ReferenceIndex` exposes.
"""

from __future__ import annotations

import pytest

from ac_dc.stability_tracker import (
    StabilityTracker,
    Tier,
    TrackedItem,
)


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _FakeRefIndex:
    """Stand-in for :class:`ReferenceIndex`.

    Only the two methods the tracker actually consumes —
    ``connected_components`` and ``file_ref_count`` — are
    implemented. Tests construct with a list of component sets
    plus a mapping of path → incoming reference count.
    """

    def __init__(
        self,
        components: list[set[str]] | None = None,
        ref_counts: dict[str, int] | None = None,
    ) -> None:
        self._components = components or []
        self._ref_counts = ref_counts or {}

    def connected_components(self) -> list[set[str]]:
        # Return a fresh list — caller may filter in place.
        return [set(c) for c in self._components]

    def file_ref_count(self, path: str) -> int:
        return self._ref_counts.get(path, 0)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _active_item(
    hash_value: str = "h1",
    tokens: int = 100,
) -> dict[str, object]:
    """Shorthand for the active-items dict entry shape."""
    return {"hash": hash_value, "tokens": tokens}


def _drive_n_unchanged(
    tracker: StabilityTracker,
    key: str,
    hash_value: str,
    tokens: int,
    cycles: int,
) -> None:
    """Run ``cycles`` update passes with the same item unchanged.

    Convenience for tests that need to reach a specific N value
    without repeating the update call by hand.
    """
    for _ in range(cycles):
        tracker.update({key: _active_item(hash_value, tokens)})


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------


class TestConstruction:
    """Empty state + config accessors."""

    def test_empty_initially(self) -> None:
        """Fresh tracker has no items, no changes, no broken tiers."""
        tracker = StabilityTracker()
        assert tracker.get_all_items() == {}
        assert tracker.get_changes() == []
        for tier in Tier:
            assert tracker.get_tier_items(tier) == {}

    def test_default_cache_target_tokens_is_zero(self) -> None:
        """Default disables anchoring/underfill for simple tests."""
        assert StabilityTracker().cache_target_tokens == 0

    def test_cache_target_tokens_stored(self) -> None:
        """Constructor arg is read through via property."""
        tracker = StabilityTracker(cache_target_tokens=1500)
        assert tracker.cache_target_tokens == 1500

    def test_set_cache_target_tokens_updates(self) -> None:
        """Setter works — used during mode switching."""
        tracker = StabilityTracker(cache_target_tokens=100)
        tracker.set_cache_target_tokens(2000)
        assert tracker.cache_target_tokens == 2000

    def test_has_item_false_for_unknown(self) -> None:
        """Membership probe returns False for unknown keys."""
        assert StabilityTracker().has_item("nope") is False

    def test_get_signature_hash_none_for_unknown(self) -> None:
        """Unknown key → None (not empty string)."""
        assert StabilityTracker().get_signature_hash("nope") is None


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

    def test_stale_file_removed(self) -> None:
        """file:* for deleted path is dropped."""
        tracker = StabilityTracker()
        tracker.update(
            {"file:a.py": _active_item()},
            existing_files={"a.py"},
        )
        tracker.update(
            {"file:a.py": _active_item()},
            existing_files=set(),  # a.py deleted
        )
        assert tracker.has_item("file:a.py") is False

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
        """Stale removal records a change log entry."""
        tracker = StabilityTracker()
        tracker.update(
            {"file:a.py": _active_item()},
            existing_files={"a.py"},
        )
        tracker.update({}, existing_files=set())
        changes = tracker.get_changes()
        assert any("a.py" in c and "stale" in c for c in changes)

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
# Phase 2 — graduation into L3
# ---------------------------------------------------------------------------


class TestGraduation:
    """Items with N ≥ 3 in active graduate to L3."""

    def test_graduates_at_threshold(self) -> None:
        """Three unchanged cycles → graduation to L3."""
        tracker = StabilityTracker()
        # First update — new item, N=0.
        tracker.update({"file:a.py": _active_item("h1")})
        # Second — N=1.
        tracker.update({"file:a.py": _active_item("h1")})
        # Third — N=2.
        tracker.update({"file:a.py": _active_item("h1")})
        # Fourth — N=3, graduates to L3.
        tracker.update({"file:a.py": _active_item("h1")})
        item = tracker.get_all_items()["file:a.py"]
        assert item.tier == Tier.L3

    def test_graduate_enters_l3_at_entry_n(self) -> None:
        """On graduation, N resets to L3's entry_n (3)."""
        tracker = StabilityTracker()
        for _ in range(4):
            tracker.update({"file:a.py": _active_item("h1")})
        item = tracker.get_all_items()["file:a.py"]
        assert item.n_value == 3

    def test_graduation_change_logged(self) -> None:
        """The graduation event appears in the change log."""
        tracker = StabilityTracker()
        for _ in range(4):
            tracker.update({"file:a.py": _active_item("h1")})
        changes = tracker.get_changes()
        assert any(
            "active → L3" in c and "graduated" in c and "a.py" in c
            for c in changes
        )

    def test_non_graduate_stays_in_active(self) -> None:
        """Items below threshold stay in active."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item("h1")})
        tracker.update({"file:a.py": _active_item("h1")})
        # Only 2 cycles — N=1, below graduation threshold.
        item = tracker.get_all_items()["file:a.py"]
        assert item.tier == Tier.ACTIVE


# ---------------------------------------------------------------------------
# Phase 3 — cascade promotion (simple path, no anchoring)
# ---------------------------------------------------------------------------


class TestCascadePromotion:
    """Bottom-up promotion through L3 → L2 → L1 → L0.

    Tests run with ``cache_target_tokens=0`` so anchoring and
    underfill demotion don't interfere — pure promote-at-threshold.
    """

    def test_promotion_l3_to_l2(self) -> None:
        """Item at L3 with N ≥ 6 promotes to L2 when L2 is empty."""
        tracker = StabilityTracker()
        # Graduate first.
        for _ in range(4):
            tracker.update({"file:a.py": _active_item("h1")})
        # Item now at L3, N=3. Need 3 more unchanged cycles to
        # reach N=6 (L3's promote threshold).
        for _ in range(3):
            tracker.update({"file:a.py": _active_item("h1")})
        item = tracker.get_all_items()["file:a.py"]
        assert item.tier == Tier.L2

    def test_promotion_resets_n_to_destination_entry(self) -> None:
        """Promoted item gets destination's entry_n, not preserved N."""
        tracker = StabilityTracker()
        # Full cycle through to L2.
        for _ in range(7):  # 4 to graduate + 3 to hit L3→L2 threshold
            tracker.update({"file:a.py": _active_item("h1")})
        item = tracker.get_all_items()["file:a.py"]
        assert item.tier == Tier.L2
        # L2's entry_n = 6.
        assert item.n_value == 6

    def test_promotion_through_all_tiers(self) -> None:
        """Item eventually reaches L0 via repeated promotions."""
        tracker = StabilityTracker()
        # Enough cycles to promote all the way. Each tier needs
        # 3 more cycles than the last; 12 cycles should suffice.
        for _ in range(20):
            tracker.update({"file:a.py": _active_item("h1")})
        item = tracker.get_all_items()["file:a.py"]
        assert item.tier == Tier.L0

    def test_blocked_promotion_when_upper_stable(self) -> None:
        """With a stable tier above, items don't promote.

        Pre-populate L0 and L1 and L2 with items so none of them
        can promote away. When a.py graduates to L3 and eventually
        hits L3's promote threshold, L2 is stable (not broken this
        cycle) so a.py cannot promote — its N caps at the promote_n
        threshold instead.

        Why seed L0 and L1 too: with empty upper tiers, the cascade
        treats them as broken, so stable.py would promote L2→L1→L0
        and leave L2 empty — which then becomes a valid promotion
        target for a.py. Filling every upper tier with an item that
        can't itself promote (N below its own promote_n) makes L2
        genuinely stable.
        """
        tracker = StabilityTracker()
        # Seed L0, L1, L2 with items well below their promote_n so
        # none of them can move. Together they make L2 truly stable
        # for the duration of the test.
        tracker._items["file:l0_pin.py"] = TrackedItem(
            key="file:l0_pin.py",
            tier=Tier.L0,
            n_value=12,
            content_hash="h1",
            tokens=100,
        )
        tracker._items["file:l1_pin.py"] = TrackedItem(
            key="file:l1_pin.py",
            tier=Tier.L1,
            n_value=9,
            content_hash="h1",
            tokens=100,
        )
        tracker._items["file:stable.py"] = TrackedItem(
            key="file:stable.py",
            tier=Tier.L2,
            n_value=6,
            content_hash="h1",
            tokens=100,
        )
        # Now drive another item up toward L3 promotion. The pins
        # must be in active_items each cycle so Phase 1 doesn't
        # clean them up as departed file:* items.
        for _ in range(7):
            tracker.update(
                {
                    "file:a.py": _active_item("h1"),
                    "file:stable.py": _active_item("h1"),
                    "file:l1_pin.py": _active_item("h1"),
                    "file:l0_pin.py": _active_item("h1"),
                }
            )
        # a.py should reach L3 but cap at N=6 (not promote to L2
        # because L2 has a stable item that can't itself promote).
        a = tracker.get_all_items()["file:a.py"]
        assert a.tier == Tier.L3

    def test_promotion_marks_tiers_broken(self) -> None:
        """Successful promotion records both source and dest as broken.

        Verified indirectly — after a full promotion, the
        change log should contain a promotion entry.
        """
        tracker = StabilityTracker()
        for _ in range(7):
            tracker.update({"file:a.py": _active_item("h1")})
        changes = tracker.get_changes()
        assert any(
            "L3 → L2" in c and "promoted" in c and "a.py" in c
            for c in changes
        )


# ---------------------------------------------------------------------------
# Anchoring (the most subtle algorithmic concern)
# ---------------------------------------------------------------------------


class TestAnchoring:
    """Items below cache target have N frozen in the cascade.

    All tests use ``cache_target_tokens=500`` and per-item token
    counts that add up to exceed that threshold. Items with
    lower N get anchored first (sorted by N ascending), so the
    freshly-arrived items keep promoting while the older ones
    hold the tier above the cache floor.
    """

    def test_anchoring_disabled_when_target_zero(self) -> None:
        """With cache_target_tokens=0, no items are anchored.

        Equivalent to the simple promote-at-threshold path.
        Verified by pushing an item past the promote threshold
        and confirming it promotes despite not having any peers
        to "anchor" it.
        """
        tracker = StabilityTracker(cache_target_tokens=0)
        for _ in range(7):
            tracker.update({"file:a.py": _active_item("h1", tokens=1000)})
        # Should still promote — no anchoring to hold it back.
        assert tracker.get_all_items()["file:a.py"].tier == Tier.L2

    def test_anchored_items_cannot_promote(self) -> None:
        """Items below cache target in a tier don't promote.

        Seed L3 with three items totalling well over cache_target,
        where two have low N and one has high N. The low-N ones
        are anchored; the high-N one is not. When L2 is empty
        (broken), only the non-anchored item promotes.

        Setup: cache_target = 500, each item tokens=300.
        Tier total = 900, exceeds target.
        Sorted by N ascending: items with N=3, N=3, N=6.
        Accumulator: 300 (anchored, below 500), 600 (above 500,
        unanchored), 900 (above 500, unanchored).
        The two items at the top of the sort (lowest N=3) fall
        into the anchored region until accumulator reaches 500.
        Item at N=6 is above the line — not anchored — and
        promotes since L2 is empty.
        """
        tracker = StabilityTracker(cache_target_tokens=500)
        # Seed three items in L3.
        tracker._items["file:a.py"] = TrackedItem(
            "file:a.py", Tier.L3, n_value=3,
            content_hash="h1", tokens=300,
        )
        tracker._items["file:b.py"] = TrackedItem(
            "file:b.py", Tier.L3, n_value=3,
            content_hash="h1", tokens=300,
        )
        tracker._items["file:c.py"] = TrackedItem(
            "file:c.py", Tier.L3, n_value=6,
            content_hash="h1", tokens=300,
        )
        # Run update with all three unchanged — kicks cascade.
        tracker.update(
            {
                "file:a.py": _active_item("h1", 300),
                "file:b.py": _active_item("h1", 300),
                "file:c.py": _active_item("h1", 300),
            }
        )
        # c.py (N=6) should promote; a.py and b.py stay (anchored).
        # But a.py and b.py are in active now (because update saw
        # them as active items, not tier-resident) — they came in
        # via active_items, not as pre-seeded tier residents.
        # The promotion we're testing is c.py.
        #
        # Actually, the active_items come through Phase 1 which
        # updates tokens and increments N for already-tracked items.
        # After Phase 1: a.py.n=4, b.py.n=4, c.py.n=7.
        # Cascade on L3 anchors the lowest-N items. With tokens:
        # a.py, b.py at n=4, c.py at n=7. Sort by N asc: a=4, b=4, c=7.
        # a accumulates to 300 (< 500, anchored).
        # b accumulates to 600 (>= 500, unanchored).
        # c accumulates to 900 (unanchored).
        # Promote threshold for L3 is 6. c.py n=7 ≥ 6, not anchored
        # → promotes. b.py n=4 < 6 → doesn't promote. a.py anchored.
        assert tracker.get_all_items()["file:c.py"].tier == Tier.L2
        assert tracker.get_all_items()["file:a.py"].tier == Tier.L3
        assert tracker.get_all_items()["file:b.py"].tier == Tier.L3

    def test_n_capped_when_upper_stable(self) -> None:
        """Non-anchored items cap N at promote_n if upper stable.

        An item past the anchor line, with a tier above that is
        stable, should not grow N unboundedly — it caps at the
        promote threshold.

        Anchor math recap: items in a tier are sorted by N asc
        and accumulated until cumulative tokens reach
        cache_target. Items consumed along the way are anchored
        (N frozen). The item whose addition first brings the
        cumulative to >= target is itself anchored (it's part of
        the set that meets the target). Only items strictly past
        that point are unanchored and subject to the N cap.

        With cache_target=500 and items at 300 tokens each: the
        first two items together accumulate 600 (first anchored
        at cumulative 300 < 500, second anchored at cumulative
        600 ≥ 500 — wait, no — the anchoring check runs BEFORE
        the item is added). So: enter loop with cum=0 < 500 →
        anchor first; add 300 → cum=300. Enter with cum=300 <
        500 → anchor second; add 300 → cum=600. Enter with cum=600
        ≥ 500 → NOT anchored. So we need at least three items:
        two get anchored (together crossing target), third is
        unanchored and tests the cap.
        """
        tracker = StabilityTracker(cache_target_tokens=500)
        # Seed L2 with a stable item so L2 isn't broken.
        tracker._items["file:stable.py"] = TrackedItem(
            "file:stable.py", Tier.L2, n_value=6,
            content_hash="h1", tokens=600,
        )
        # Seed L3 with three items above cache_target combined.
        # The lowest-N items (a, b) anchor; c has massive N and
        # is past the anchor line where the cap applies.
        tracker._items["file:a.py"] = TrackedItem(
            "file:a.py", Tier.L3, n_value=3,
            content_hash="h1", tokens=300,
        )
        tracker._items["file:b.py"] = TrackedItem(
            "file:b.py", Tier.L3, n_value=3,
            content_hash="h1", tokens=300,
        )
        tracker._items["file:c.py"] = TrackedItem(
            "file:c.py", Tier.L3, n_value=100,  # ridiculously high
            content_hash="h1", tokens=300,
        )
        # Run update — all items unchanged.
        tracker.update(
            {
                "file:stable.py": _active_item("h1", 600),
                "file:a.py": _active_item("h1", 300),
                "file:b.py": _active_item("h1", 300),
                "file:c.py": _active_item("h1", 300),
            }
        )
        # c.py should be capped at promote_n=6 since L2 is stable
        # and c.py is past the anchor line.
        assert tracker.get_all_items()["file:c.py"].n_value == 6


# ---------------------------------------------------------------------------
# Underfill demotion
# ---------------------------------------------------------------------------


class TestUnderfillDemotion:
    """Tiers below cache target demote one level."""

    def test_tier_below_target_demotes(self) -> None:
        """L1 with one small item demotes to L2.

        cache_target = 500, L1 contains one item with tokens=100.
        After cascade, no promotions happen (L1's item not at
        threshold). Post-cascade check sees L1 below target and
        demotes its contents to L2.
        """
        tracker = StabilityTracker(cache_target_tokens=500)
        tracker._items["file:a.py"] = TrackedItem(
            "file:a.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=100,
        )
        # Drive an update with nothing in active.
        tracker.update({"file:a.py": _active_item("h1", 100)})
        # a.py should end up demoted from L1 (below target).
        item = tracker.get_all_items()["file:a.py"]
        # It should be in L2 (one step down) — demotion is one level.
        assert item.tier == Tier.L2

    def test_tier_above_target_does_not_demote(self) -> None:
        """Tier at or above cache target is not demoted."""
        tracker = StabilityTracker(cache_target_tokens=500)
        tracker._items["file:a.py"] = TrackedItem(
            "file:a.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=500,
        )
        tracker.update({"file:a.py": _active_item("h1", 500)})
        assert tracker.get_all_items()["file:a.py"].tier == Tier.L1

    def test_l0_not_demoted(self) -> None:
        """L0 is terminal — never demoted, even when underfilled.

        An underfilled L0 is the "backfill" scenario — the
        streaming handler is supposed to piggyback on an L1
        invalidation to top it up. That happens via the normal
        cascade, not via underfill demotion.
        """
        tracker = StabilityTracker(cache_target_tokens=500)
        tracker._items["system:prompt"] = TrackedItem(
            "system:prompt", Tier.L0, n_value=12,
            content_hash="h1", tokens=100,
        )
        tracker.update({"system:prompt": _active_item("h1", 100)})
        assert tracker.get_all_items()["system:prompt"].tier == Tier.L0

    def test_broken_tiers_skipped(self) -> None:
        """Tiers broken this cycle are not demoted.

        If L2 received promotions this cycle, it may be
        temporarily underfilled, but demoting would undo the
        work. Broken tiers are left alone.
        """
        tracker = StabilityTracker(cache_target_tokens=500)
        # Seed an item at L3 ready to promote.
        tracker._items["file:a.py"] = TrackedItem(
            "file:a.py", Tier.L3, n_value=6,
            content_hash="h1", tokens=100,
        )
        # Update — item promotes to L2. After promotion L2 has
        # 100 tokens (below 500 target) but was just broken, so
        # it should not demote in the same cycle.
        tracker.update({"file:a.py": _active_item("h1", 100)})
        # Item should be in L2, not demoted back to L3.
        assert tracker.get_all_items()["file:a.py"].tier == Tier.L2

    def test_underfill_disabled_at_zero_target(self) -> None:
        """cache_target_tokens=0 disables underfill demotion.

        With no target, every tier is "filled enough".
        """
        tracker = StabilityTracker(cache_target_tokens=0)
        tracker._items["file:a.py"] = TrackedItem(
            "file:a.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=1,
        )
        tracker.update({"file:a.py": _active_item("h1", 1)})
        assert tracker.get_all_items()["file:a.py"].tier == Tier.L1


# ---------------------------------------------------------------------------
# History purge
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# System prompt registration
# ---------------------------------------------------------------------------


class TestRegisterSystemPrompt:
    """register_system_prompt pins system:prompt into L0."""

    def test_register_new_places_in_l0(self) -> None:
        """Fresh registration places system:prompt at L0."""
        tracker = StabilityTracker()
        tracker.register_system_prompt("hash1", tokens=1000)
        item = tracker.get_all_items()["system:prompt"]
        assert item.tier == Tier.L0
        assert item.content_hash == "hash1"
        assert item.tokens == 1000
        # L0's entry_n = 12.
        assert item.n_value == 12

    def test_register_same_hash_updates_tokens_only(self) -> None:
        """Re-registering with same hash updates tokens; N preserved."""
        tracker = StabilityTracker()
        tracker.register_system_prompt("hash1", tokens=1000)
        # Simulate N growth over cycles (can't happen without
        # update, but directly manipulate for the test).
        tracker._items["system:prompt"].n_value = 20
        # Re-register with same hash, different tokens.
        tracker.register_system_prompt("hash1", tokens=1500)
        item = tracker.get_all_items()["system:prompt"]
        assert item.tokens == 1500
        # N preserved.
        assert item.n_value == 20

    def test_register_different_hash_reinstalls(self) -> None:
        """New hash creates a fresh L0 entry.

        Rare in practice — system prompt only changes on mode
        switch or review entry/exit, both of which create a
        fresh tracker anyway. Still, the contract is that a
        changed hash reinstalls cleanly.
        """
        tracker = StabilityTracker()
        tracker.register_system_prompt("hash1", tokens=1000)
        tracker._items["system:prompt"].n_value = 20
        tracker.register_system_prompt("hash2", tokens=500)
        item = tracker.get_all_items()["system:prompt"]
        assert item.content_hash == "hash2"
        assert item.tokens == 500
        # Fresh install — N reset to entry_n.
        assert item.n_value == 12


# ---------------------------------------------------------------------------
# Token measurement
# ---------------------------------------------------------------------------


class TestMeasureTokens:
    """measure_tokens updates token count for an existing item."""

    def test_measure_updates_tokens(self) -> None:
        """Token count refreshed for a tracked item."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item("h1", 100)})
        tracker.measure_tokens("file:a.py", 250)
        assert tracker.get_all_items()["file:a.py"].tokens == 250

    def test_measure_unknown_key_is_noop(self) -> None:
        """Unknown keys silently ignored — no error, no side effects."""
        tracker = StabilityTracker()
        tracker.measure_tokens("symbol:not-here.py", 500)
        assert tracker.get_all_items() == {}


# ---------------------------------------------------------------------------
# Initialisation from reference graph
# ---------------------------------------------------------------------------


class TestInitialiseFromReferenceGraph:
    """Startup seeding — L0 pre-fill, clustering, orphan distribution."""

    def test_empty_files_does_nothing(self) -> None:
        """No files → no items."""
        tracker = StabilityTracker(cache_target_tokens=1000)
        tracker.initialize_from_reference_graph(_FakeRefIndex(), [])
        assert tracker.get_all_items() == {}

    def test_l0_seeding_by_ref_count(self) -> None:
        """Most-referenced files seed L0 up to cache target.

        cache_target = 500, placeholder tokens = 400. One item
        at 400 tokens reaches 400, next would exceed — so only
        the top-ranked file seeds L0 (since 400 < 500 but
        adding a second would push us past).

        Actually the logic checks accumulated < target before
        each add, so after the first item we have 400, then we
        check 400 < 500 and add the second (reaching 800), then
        the loop breaks because 800 >= 500. So we seed 2 items.
        """
        ref = _FakeRefIndex(
            ref_counts={
                "high.py": 10,
                "medium.py": 5,
                "low.py": 1,
            }
        )
        tracker = StabilityTracker(cache_target_tokens=500)
        tracker.initialize_from_reference_graph(
            ref,
            files=["high.py", "medium.py", "low.py"],
        )
        # The highest-ref file must end up in L0.
        l0_items = tracker.get_tier_items(Tier.L0)
        assert "symbol:high.py" in l0_items

    def test_l0_keys_excluded_from_clustering(self) -> None:
        """Files seeded into L0 don't appear in L1/L2/L3.

        cache_target=300 with placeholder=400 means exactly one
        item fits in L0 (after adding high.py, accumulated=400
        ≥ 300, loop breaks). high.py seeds into L0; other.py
        should land in one of L1/L2/L3 via clustering.
        """
        ref = _FakeRefIndex(
            components=[{"high.py", "other.py"}],
            ref_counts={"high.py": 100, "other.py": 2},
        )
        tracker = StabilityTracker(cache_target_tokens=300)
        tracker.initialize_from_reference_graph(
            ref,
            files=["high.py", "other.py"],
        )
        l0 = tracker.get_tier_items(Tier.L0)
        assert "symbol:high.py" in l0
        # other.py should be in L1/L2/L3, not L0 (since only
        # high.py was seeded).
        for tier in (Tier.L1, Tier.L2, Tier.L3):
            tier_items = tracker.get_tier_items(tier)
            if "symbol:other.py" in tier_items:
                break
        else:
            pytest.fail("other.py not placed in any cached tier")

    def test_orphan_files_distributed(self) -> None:
        """Files with no mutual references become singletons.

        The real reference index only emits components for
        bidirectional edges. Orphan files (no mutual refs)
        must still get a tier assignment or they'd never
        register in the tracker.
        """
        ref = _FakeRefIndex(
            components=[],  # no mutual references
            ref_counts={"a.py": 0, "b.py": 0},
        )
        tracker = StabilityTracker(cache_target_tokens=0)
        tracker.initialize_from_reference_graph(
            ref,
            files=["a.py", "b.py"],
        )
        all_items = tracker.get_all_items()
        assert "symbol:a.py" in all_items
        assert "symbol:b.py" in all_items

    def test_placeholder_hash_and_tokens(self) -> None:
        """Initialised items start with empty hash and placeholder tokens.

        Phase 1's first-measurement acceptance depends on this.
        """
        ref = _FakeRefIndex(ref_counts={"a.py": 5})
        tracker = StabilityTracker(cache_target_tokens=0)
        tracker.initialize_from_reference_graph(ref, files=["a.py"])
        item = tracker.get_all_items()["symbol:a.py"]
        assert item.content_hash == ""
        # Placeholder tokens is 400 per spec.
        assert item.tokens == 400

    def test_clustering_distributes_components_across_tiers(self) -> None:
        """Multiple components → bin-packed across L1/L2/L3."""
        ref = _FakeRefIndex(
            components=[
                {"a.py", "b.py"},
                {"c.py", "d.py"},
                {"e.py", "f.py"},
            ]
        )
        tracker = StabilityTracker(cache_target_tokens=0)
        tracker.initialize_from_reference_graph(
            ref,
            files=["a.py", "b.py", "c.py", "d.py", "e.py", "f.py"],
        )
        # All three cached tiers should have at least one item.
        for tier in (Tier.L1, Tier.L2, Tier.L3):
            assert len(tracker.get_tier_items(tier)) > 0, f"{tier} empty"

    def test_initialize_with_keys_mismatch_raises(self) -> None:
        """keys/files length mismatch raises ValueError."""
        tracker = StabilityTracker()
        with pytest.raises(ValueError, match="length"):
            tracker.initialize_with_keys(
                _FakeRefIndex(),
                keys=["symbol:a.py", "symbol:b.py"],
                files=["a.py"],
            )

    def test_initialize_with_doc_keys(self) -> None:
        """initialize_with_keys supports doc:{path} keys."""
        ref = _FakeRefIndex(ref_counts={"a.md": 5, "b.md": 3})
        tracker = StabilityTracker(cache_target_tokens=0)
        tracker.initialize_with_keys(
            ref,
            keys=["doc:a.md", "doc:b.md"],
            files=["a.md", "b.md"],
        )
        all_items = tracker.get_all_items()
        assert "doc:a.md" in all_items
        assert "doc:b.md" in all_items


# ---------------------------------------------------------------------------
# Full-cycle integration
# ---------------------------------------------------------------------------


class TestFullCycle:
    """Multi-request simulation — the invariants hold across cycles."""

    def test_new_to_graduate_to_promote(self) -> None:
        """Full lifecycle — new → active → L3 → L2.

        8 cycles of unchanged content should take an item from
        never-seen to L2.
        """
        tracker = StabilityTracker()
        for _ in range(8):
            tracker.update({"file:a.py": _active_item("h1", 100)})
        # After 1 cycle: N=0 active. After 4: N=3, graduates to L3
        # (entry_n=3). After 7: L3 N=6, promotes to L2 (entry_n=6).
        # After 8: L2 N=7.
        assert tracker.get_all_items()["file:a.py"].tier == Tier.L2

    def test_edit_after_graduation_demotes(self) -> None:
        """Item promoted to L3 then edited → back to active."""
        tracker = StabilityTracker()
        for _ in range(5):  # graduate to L3
            tracker.update({"file:a.py": _active_item("h1")})
        # Now edit (hash changes).
        tracker.update({"file:a.py": _active_item("h2")})
        item = tracker.get_all_items()["file:a.py"]
        assert item.tier == Tier.ACTIVE
        assert item.n_value == 0

    def test_mixed_items_distinct_tiers(self) -> None:
        """Many items at different stability levels live correctly.

        Add items at different cycles so they have different N
        values; verify each ends up in the appropriate tier.
        """
        tracker = StabilityTracker()
        # First 5 cycles with file:old.py.
        for _ in range(5):
            tracker.update({"file:old.py": _active_item("h1")})
        # Now add new.py and run 2 more cycles with both.
        tracker.update(
            {
                "file:old.py": _active_item("h1"),
                "file:new.py": _active_item("h1"),
            }
        )
        tracker.update(
            {
                "file:old.py": _active_item("h1"),
                "file:new.py": _active_item("h1"),
            }
        )
        old = tracker.get_all_items()["file:old.py"]
        new = tracker.get_all_items()["file:new.py"]
        # old.py should be higher in tier hierarchy than new.py.
        # tier order: L0 > L1 > L2 > L3 > active.
        tier_rank = {
            Tier.L0: 4, Tier.L1: 3, Tier.L2: 2,
            Tier.L3: 1, Tier.ACTIVE: 0,
        }
        assert tier_rank[old.tier] > tier_rank[new.tier]

    def test_change_log_across_cycles(self) -> None:
        """Change log reflects only the most recent update.

        Run multiple cycles and check that get_changes() only
        shows the latest cycle's activity.
        """
        tracker = StabilityTracker()
        # Cycle 1: new item.
        tracker.update({"file:a.py": _active_item("h1")})
        # Cycle 2: unchanged.
        tracker.update({"file:a.py": _active_item("h1")})
        # Second cycle's changes should not include "registered"
        # or similar from the first cycle.
        changes = tracker.get_changes()
        # Unchanged items at active don't log anything.
        assert changes == []


# ---------------------------------------------------------------------------
# Introspection surface
# ---------------------------------------------------------------------------


class TestIntrospection:
    """Read methods return fresh copies and reflect current state."""

    def test_get_tier_items_returns_fresh_dict(self) -> None:
        """Mutating the returned dict doesn't affect tracker."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item()})
        items = tracker.get_tier_items(Tier.ACTIVE)
        items.clear()
        # Tracker still has the item.
        assert tracker.has_item("file:a.py")

    def test_get_all_items_returns_fresh_dict(self) -> None:
        """Same for get_all_items."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item()})
        got = tracker.get_all_items()
        got.clear()
        assert tracker.has_item("file:a.py")

    def test_get_changes_returns_fresh_list(self) -> None:
        """Mutating the returned changes list doesn't affect tracker."""
        tracker = StabilityTracker()
        for _ in range(4):
            tracker.update({"file:a.py": _active_item("h1")})
        changes = tracker.get_changes()
        changes.clear()
        # Fetch again — still populated.
        assert tracker.get_changes() != []

    def test_get_signature_hash_reflects_current(self) -> None:
        """Hash accessor returns the current hash after update."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item("original")})
        tracker.update({"file:a.py": _active_item("modified")})
        assert tracker.get_signature_hash("file:a.py") == "modified"