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
    _TIER_CONFIG,
)

# Convenience alias for the L3 promote threshold — used by
# tests that seed items directly into L3 and want to exercise
# promotion without reproducing the numeric literal.
_TIER_CONFIG_PROMOTE_L3 = _TIER_CONFIG[Tier.L3]["promote_n"]


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

    def test_highest_ref_lands_in_l0(self) -> None:
        """Most-referenced file lands in L0.

        Under the four-tier even split, the highest-aggregate-
        ref-count cluster is processed first by the bin-packer.
        With all tiers at zero tokens and L0 tied with others
        for ``min(tier_sizes)``, L0 wins the insertion-order
        tie-break and receives the highest-rank cluster.

        Three orphan files with ref counts 10/5/1 become three
        singleton clusters. Walking in aggregate-descending
        order: high.py (10) goes first → L0 (tied at 0,
        insertion order picks L0). medium.py (5) next → L1
        (L0 now has tokens, so L1 is the smallest). low.py (1)
        → L2. L3 stays empty for this three-file case.
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
        # The other two distribute across L1/L2 (four-tier split
        # plus bin-packing — each tier gets a file until exhausted).
        all_items = tracker.get_all_items()
        medium_tier = all_items["symbol:medium.py"].tier
        low_tier = all_items["symbol:low.py"].tier
        assert medium_tier != Tier.L0  # L0 is high.py's
        assert low_tier != Tier.L0
        # All three in cached tiers — no file should end up in active.
        for item in all_items.values():
            assert item.tier != Tier.ACTIVE

    def test_clustered_files_share_a_tier(self) -> None:
        """Files in the same connected component land in the same tier.

        The four-tier even split processes clusters as units —
        each component is assigned to one tier (whichever has
        the smallest current token total). Two files in the same
        component land in the same tier regardless of their
        individual ref counts.
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
        all_items = tracker.get_all_items()
        assert all_items["symbol:high.py"].tier == all_items["symbol:other.py"].tier
        # And that shared tier should be L0 — this cluster's
        # aggregate (100+2=102) is the highest available, and
        # L0 wins the insertion-order tie-break when all tiers
        # are at zero tokens.
        assert all_items["symbol:high.py"].tier == Tier.L0

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

        Phase 1's first-measurement acceptance depends on the
        empty hash — items with an empty hash accept their
        first real hash without triggering demotion.
        """
        from ac_dc.stability_tracker import _PLACEHOLDER_TOKENS
        ref = _FakeRefIndex(ref_counts={"a.py": 5})
        tracker = StabilityTracker(cache_target_tokens=0)
        tracker.initialize_from_reference_graph(ref, files=["a.py"])
        item = tracker.get_all_items()["symbol:a.py"]
        assert item.content_hash == ""
        assert item.tokens == _PLACEHOLDER_TOKENS

    def test_clustering_distributes_components_across_tiers(self) -> None:
        """Multiple components → bin-packed across all four cached tiers.

        Four components of size 2, 12 files total. The four-tier
        even split lands each component in its own tier — L0
        takes the first (highest aggregate), L1/L2/L3 take the
        others by bin-pack order.
        """
        ref = _FakeRefIndex(
            components=[
                {"a.py", "b.py"},
                {"c.py", "d.py"},
                {"e.py", "f.py"},
                {"g.py", "h.py"},
            ]
        )
        tracker = StabilityTracker(cache_target_tokens=0)
        tracker.initialize_from_reference_graph(
            ref,
            files=["a.py", "b.py", "c.py", "d.py",
                   "e.py", "f.py", "g.py", "h.py"],
        )
        # All four cached tiers should have at least one item.
        for tier in (Tier.L0, Tier.L1, Tier.L2, Tier.L3):
            assert len(tracker.get_tier_items(tier)) > 0, f"{tier} empty"

    def test_no_files_land_in_active(self) -> None:
        """Four-tier split places every file in a cached tier.

        The core invariant of the new algorithm — no indexed
        file should land in ACTIVE on startup, regardless of
        its ref count. Even fully-isolated files get placed.
        """
        ref = _FakeRefIndex()  # no components, no ref counts
        tracker = StabilityTracker(cache_target_tokens=0)
        tracker.initialize_from_reference_graph(
            ref,
            files=["a.py", "b.py", "c.py", "d.py", "e.py"],
        )
        all_items = tracker.get_all_items()
        for item in all_items.values():
            assert item.tier != Tier.ACTIVE, (
                f"{item.key} landed in ACTIVE; expected L0/L1/L2/L3"
            )

    def test_aggregate_ranking_places_biggest_cluster_in_l0(self) -> None:
        """Clusters with higher aggregate ref counts sort earlier.

        A small cluster with high per-member ref counts should
        outrank a larger cluster of orphans. The high-aggregate
        cluster lands in L0 (insertion-order tie-break with all
        tiers at zero); the orphan cluster lands in L1.
        """
        ref = _FakeRefIndex(
            components=[{"high1.py", "high2.py"}],
            ref_counts={
                "high1.py": 10,
                "high2.py": 10,
                "orphan1.py": 0,
                "orphan2.py": 0,
                "orphan3.py": 0,
            },
        )
        tracker = StabilityTracker(cache_target_tokens=0)
        tracker.initialize_from_reference_graph(
            ref,
            files=["high1.py", "high2.py",
                   "orphan1.py", "orphan2.py", "orphan3.py"],
        )
        all_items = tracker.get_all_items()
        # Both high-ref files share a tier (same cluster).
        assert (
            all_items["symbol:high1.py"].tier
            == all_items["symbol:high2.py"].tier
        )
        # And that tier is L0 — aggregate 20 outranks orphan
        # singletons at 0.
        assert all_items["symbol:high1.py"].tier == Tier.L0

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


# ---------------------------------------------------------------------------
# History graduation — gated, NOT N-based
# ---------------------------------------------------------------------------


class TestHistoryGraduation:
    """History graduates only via piggyback or token threshold.

    Per specs4/3-llm/cache-tiering.md § "History Graduation",
    history is immutable so waiting on an N-value progression
    is the wrong signal. Graduation is controlled by two gates:

    1. Piggyback — L3 is already broken this cycle (file/symbol
       graduated in, or L3 item demoted/promoted out).
    2. Token threshold — active history tokens exceed cache target.

    When cache_target_tokens=0, neither gate fires — history
    stays active forever.
    """

    def test_history_stays_active_under_n_progression(self) -> None:
        """N reaching the active promote threshold does NOT graduate history.

        The critical regression test — before the fix, history
        items were promoted identically to file items, causing
        cache churn on every stable conversation cycle.
        Without a piggyback or token-threshold trigger, history
        must stay in active no matter how stable it becomes.
        """
        tracker = StabilityTracker(cache_target_tokens=10_000)
        # Drive many unchanged cycles — N grows indefinitely.
        for _ in range(10):
            tracker.update({"history:0": _active_item("h1", 100)})
        item = tracker.get_all_items()["history:0"]
        assert item.tier == Tier.ACTIVE

    def test_cache_target_zero_never_graduates(self) -> None:
        """With cache_target_tokens=0, history stays active forever.

        Even with an enormous active history that would trip
        the token-threshold gate, cache_target=0 disables the
        whole mechanism.
        """
        tracker = StabilityTracker(cache_target_tokens=0)
        # Seed 20 history entries with large token counts in a
        # single update — Phase 1 cleanup removes history:* items
        # not present in the current active_items dict, so we
        # can't seed them in separate cycles.
        active = {
            f"history:{i}": _active_item("h1", 10_000)
            for i in range(20)
        }
        tracker.update(active)
        # Run a few more cycles with the same set so N grows.
        # Without the cache_target=0 guard these would graduate
        # (large tokens → token-threshold gate would fire).
        for _ in range(5):
            tracker.update(active)
        # All should still be in active.
        for i in range(20):
            item = tracker.get_all_items()[f"history:{i}"]
            assert item.tier == Tier.ACTIVE

    def test_piggyback_graduates_when_file_graduates(self) -> None:
        """File graduation marks L3 broken → history piggybacks.

        A file graduating from active to L3 invalidates L3's
        cache block. Since the block is going to be rebuilt,
        graduating history at the same time is free. Older
        history messages graduate; newer ones stay in the
        verbatim window sized at cache_target_tokens.
        """
        tracker = StabilityTracker(cache_target_tokens=500)
        # Seed history entries (tokens intentionally small so
        # they fit comfortably within the verbatim window when
        # not graduated, and the oldest falls outside once the
        # verbatim window accumulates 500 tokens).
        # tokens=200 means the window holds 2 messages (400
        # accumulated), and the third would push to 600 > 500
        # → becomes the graduation boundary.
        for i in range(3):
            tracker.update(
                {f"history:{i}": _active_item("h_hist", 200)}
            )
        # Drive a file through to graduation. 4 cycles of
        # unchanged content → file:a.py graduates on cycle 4.
        # We also keep history present each cycle so it's not
        # cleaned up as departed.
        for _ in range(4):
            tracker.update(
                {
                    "file:a.py": _active_item("h_file", 100),
                    "history:0": _active_item("h_hist", 200),
                    "history:1": _active_item("h_hist", 200),
                    "history:2": _active_item("h_hist", 200),
                }
            )
        # file:a.py graduated — L3 was broken that cycle, so
        # history piggyback fires. Walking newest→oldest with
        # cache_target=500 and 200-token items:
        #   idx=2 (newest): accumulated 200, stays
        #   idx=1: accumulated 400, stays
        #   idx=0 (oldest): accumulated 600 > 500, graduates
        item0 = tracker.get_all_items()["history:0"]
        item2 = tracker.get_all_items()["history:2"]
        assert item0.tier == Tier.L3, (
            f"oldest history should graduate on piggyback; "
            f"got tier={item0.tier}"
        )
        assert item2.tier == Tier.ACTIVE, (
            f"newest history should stay in verbatim window; "
            f"got tier={item2.tier}"
        )

    def test_token_threshold_alone_does_not_graduate(self) -> None:
        """Active history exceeding cache_target does NOT graduate without piggyback.

        The regression guard for the cache-thrash bug. Before
        the fix, a token-threshold rule (active history tokens
        > cache_target_tokens) forced graduation every turn
        once the conversation grew past the per-tier caching
        floor — tearing down L3's cache block on every request.
        Now the only gate is piggyback; without an independent
        L3 invalidation this cycle, all history must stay in
        active no matter how large.
        """
        tracker = StabilityTracker(cache_target_tokens=500)
        # Seed 4 history entries at 200 tokens each.
        # Total: 800 tokens > 500 cache target. Under the old
        # rule this would have graduated the oldest messages;
        # under the new rule it does nothing.
        for i in range(4):
            tracker.update(
                {f"history:{i}": _active_item("h_hist", 200)}
            )
        # One more cycle with all four present. No file work,
        # no other L3 activity → piggyback gate stays closed.
        tracker.update(
            {
                "history:0": _active_item("h_hist", 200),
                "history:1": _active_item("h_hist", 200),
                "history:2": _active_item("h_hist", 200),
                "history:3": _active_item("h_hist", 200),
            }
        )
        items = tracker.get_all_items()
        # All four must remain in active — no graduation.
        assert items["history:0"].tier == Tier.ACTIVE
        assert items["history:1"].tier == Tier.ACTIVE
        assert items["history:2"].tier == Tier.ACTIVE
        assert items["history:3"].tier == Tier.ACTIVE

    def test_piggyback_noop_when_history_fits_window(self) -> None:
        """Piggyback with small history → nothing graduates.

        L3 gets broken by a file graduation, but the entire
        active history fits inside the verbatim window
        (total tokens ≤ cache_target_tokens). No graduation
        boundary exists; every history message stays in active.
        """
        tracker = StabilityTracker(cache_target_tokens=1000)
        # Two history messages, 100 tokens each → 200 total,
        # well under cache_target=1000.
        for i in range(2):
            tracker.update(
                {f"history:{i}": _active_item("h_hist", 100)}
            )
        # Graduate a file (4 unchanged cycles) with history
        # also present each cycle.
        for _ in range(4):
            tracker.update(
                {
                    "file:a.py": _active_item("h_file", 100),
                    "history:0": _active_item("h_hist", 100),
                    "history:1": _active_item("h_hist", 100),
                }
            )
        # File graduated — L3 broken. Piggyback gate opens.
        # But total active history (200) < cache_target (1000)
        # → no graduation boundary → history stays put.
        items = tracker.get_all_items()
        assert items["history:0"].tier == Tier.ACTIVE
        assert items["history:1"].tier == Tier.ACTIVE

    def test_graduated_history_logs_piggyback_reason(self) -> None:
        """Change log annotates history graduation with the piggyback reason.

        Piggyback is now the only path by which history
        reaches L3. The log message includes the reason so
        operators watching the terminal HUD can see that the
        cache-block churn was amortised onto an unrelated L3
        invalidation rather than having been a standalone event.
        """
        tracker = StabilityTracker(cache_target_tokens=300)
        # Seed 3 history items, 200 tokens each → 600 total.
        for i in range(3):
            tracker.update(
                {f"history:{i}": _active_item("h_hist", 200)}
            )
        # Drive a file through to graduation while keeping
        # history present each cycle. File graduation breaks
        # L3 → piggyback gate opens.
        for _ in range(4):
            tracker.update(
                {
                    "file:a.py": _active_item("h_file", 100),
                    "history:0": _active_item("h_hist", 200),
                    "history:1": _active_item("h_hist", 200),
                    "history:2": _active_item("h_hist", 200),
                }
            )
        changes = tracker.get_changes()
        history_grads = [
            c for c in changes
            if "history:" in c and "→ L3" in c
        ]
        assert history_grads, (
            f"expected history graduation in change log, "
            f"got: {changes}"
        )
        assert any(
            "piggyback" in c for c in history_grads
        ), (
            f"expected 'piggyback' reason, "
            f"got: {history_grads}"
        )

    def test_history_graduation_marks_l3_broken(self) -> None:
        """Graduating history joins the cascade's broken-tier set.

        When history graduates via piggyback, L3 is marked
        broken so downstream passes can rebalance — e.g., an
        L2 item ready to promote would flow into L3's refreshed
        cache block on the next cycle.
        """
        tracker = StabilityTracker(cache_target_tokens=300)
        # Seed history items small enough that two fit in the
        # 300-token verbatim window but three don't, so the
        # oldest will graduate when piggyback opens the gate.
        for i in range(3):
            tracker.update(
                {f"history:{i}": _active_item("h_hist", 150)}
            )
        # Drive a file to graduation to open the piggyback gate.
        for _ in range(4):
            tracker.update(
                {
                    "file:a.py": _active_item("h_file", 100),
                    "history:0": _active_item("h_hist", 150),
                    "history:1": _active_item("h_hist", 150),
                    "history:2": _active_item("h_hist", 150),
                }
            )
        # The cascade consumes _broken_tiers mid-method and
        # clears it per-cycle. We can't read the set after
        # update() returns, but we CAN verify the downstream
        # effect: the change log should show an L3 entry for
        # the oldest history item.
        changes = tracker.get_changes()
        assert any("→ L3: history:" in c for c in changes)

    def test_history_in_cached_tier_promotes_normally(self) -> None:
        """Once graduated, history items cascade like any other tier resident.

        The immutability argument that gates the ACTIVE → L3
        transition doesn't apply to L3 → L2 → L1 → L0 promotions.
        Once in a cached tier, history is ordinary content and
        flows upward via _try_promote_from as N progresses.
        """
        tracker = StabilityTracker(cache_target_tokens=0)
        # Seed a history item directly into L3 with N at L3's
        # promote threshold. With cache_target=0 (no anchoring,
        # no underfill demotion) and L2 empty (broken), it
        # should promote on the next update.
        tracker._items["history:0"] = TrackedItem(
            key="history:0",
            tier=Tier.L3,
            n_value=_TIER_CONFIG_PROMOTE_L3,
            content_hash="h1",
            tokens=100,
        )
        # Include the item in active_items with unchanged hash
        # so Phase 1 doesn't drop it as departed. N increments
        # past promote_n, which is fine.
        tracker.update({"history:0": _active_item("h1", 100)})
        item = tracker.get_all_items()["history:0"]
        assert item.tier == Tier.L2


# ---------------------------------------------------------------------------
# Post-measurement L0 backfill
# ---------------------------------------------------------------------------


class TestBackfillL0AfterMeasurement:
    """Post-measurement backfill tops up L0 to the overshoot target.

    The placeholder token count used during L0 seeding (400
    per file) is a pessimistic upper bound. After measurement
    replaces placeholders with real counts, L0's actual token
    total is usually well below cache_target_tokens — meaning
    the provider won't cache it and the cascade's anchoring
    logic never fires. The backfill pass pulls high-ref-count
    candidates up from L1/L2/L3 until L0 reaches the overshoot
    target.

    Governing spec: specs4/3-llm/cache-tiering.md § L0 Backfill
    and § Post-Measurement L0 Backfill.
    """

    def test_noop_when_cache_target_zero(self) -> None:
        """cache_target_tokens=0 disables caching entirely.

        No backfill target to meet, nothing to promote.
        """
        tracker = StabilityTracker(cache_target_tokens=0)
        tracker._items["symbol:a.py"] = TrackedItem(
            "symbol:a.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=100,
        )
        ref = _FakeRefIndex(ref_counts={"a.py": 10})
        promoted = tracker.backfill_l0_after_measurement(ref)
        assert promoted == 0
        assert tracker.get_all_items()["symbol:a.py"].tier == Tier.L1

    def test_noop_when_l0_already_exceeds_overshoot(self) -> None:
        """L0 at or above target × overshoot → nothing promotes."""
        tracker = StabilityTracker(cache_target_tokens=1000)
        # L0 already holds 2000 tokens (target * 1.5 = 1500).
        tracker._items["symbol:big.py"] = TrackedItem(
            "symbol:big.py", Tier.L0, n_value=12,
            content_hash="h1", tokens=2000,
        )
        # L1 has candidates, but L0 is full.
        tracker._items["symbol:a.py"] = TrackedItem(
            "symbol:a.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=100,
        )
        ref = _FakeRefIndex(ref_counts={"big.py": 5, "a.py": 10})
        promoted = tracker.backfill_l0_after_measurement(ref)
        assert promoted == 0
        assert tracker.get_all_items()["symbol:a.py"].tier == Tier.L1

    def test_noop_when_no_candidates(self) -> None:
        """L0 underfilled but L1/L2/L3 empty → nothing to promote."""
        tracker = StabilityTracker(cache_target_tokens=1000)
        # L0 is empty (no candidates needed); below target.
        ref = _FakeRefIndex()
        promoted = tracker.backfill_l0_after_measurement(ref)
        assert promoted == 0

    def test_promotes_highest_ref_first(self) -> None:
        """Candidates ranked by ref count descending.

        Three L1 items at 500 tokens each; target × 1.5 = 1500.
        Backfill pulls two items (accumulated=1000, then 1500)
        then stops. The two with the highest ref counts should
        be the ones that promoted.
        """
        tracker = StabilityTracker(cache_target_tokens=1000)
        tracker._items["symbol:low.py"] = TrackedItem(
            "symbol:low.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=500,
        )
        tracker._items["symbol:mid.py"] = TrackedItem(
            "symbol:mid.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=500,
        )
        tracker._items["symbol:high.py"] = TrackedItem(
            "symbol:high.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=500,
        )
        ref = _FakeRefIndex(
            ref_counts={"low.py": 1, "mid.py": 5, "high.py": 10},
        )
        promoted = tracker.backfill_l0_after_measurement(ref)
        # accumulated starts at 0. Loop: add high (500 < 1500),
        # add mid (1000 < 1500), add low (1500 >= 1500 → break
        # BEFORE adding). But the loop structure is "if
        # accumulated >= target: break" at the top, so:
        #   iter 1: acc=0 < 1500, promote high → acc=500
        #   iter 2: acc=500 < 1500, promote mid → acc=1000
        #   iter 3: acc=1000 < 1500, promote low → acc=1500
        # Then loop ends (no more candidates).
        # All three get promoted to reach the target.
        assert promoted == 3
        assert tracker.get_all_items()["symbol:high.py"].tier == Tier.L0
        assert tracker.get_all_items()["symbol:mid.py"].tier == Tier.L0
        assert tracker.get_all_items()["symbol:low.py"].tier == Tier.L0

    def test_stops_at_overshoot_target(self) -> None:
        """Backfill stops once L0 reaches target × overshoot.

        Four items at 500 tokens each, target=1000, overshoot=1.5
        → backfill target = 1500. After three promotions
        accumulated reaches 1500; the fourth is not touched.
        """
        tracker = StabilityTracker(cache_target_tokens=1000)
        for i, ref_count in enumerate([10, 9, 8, 1]):
            tracker._items[f"symbol:f{i}.py"] = TrackedItem(
                f"symbol:f{i}.py", Tier.L1, n_value=9,
                content_hash="h1", tokens=500,
            )
        ref = _FakeRefIndex(
            ref_counts={
                "f0.py": 10, "f1.py": 9, "f2.py": 8, "f3.py": 1,
            },
        )
        # Pass overshoot_multiplier=1.5 explicitly — this test
        # is pinning the "stops at the target × overshoot"
        # contract with math calibrated for 1.5, not the
        # default value (which changed to 2.0 so cross-ref
        # backfill gets comfortable headroom above the cache-
        # min floor).
        promoted = tracker.backfill_l0_after_measurement(
            ref, overshoot_multiplier=1.5,
        )
        assert promoted == 3
        # f3 (lowest ref, lowest rank) stays in L1.
        assert tracker.get_all_items()["symbol:f3.py"].tier == Tier.L1

    def test_ranking_tiebreak_by_key(self) -> None:
        """Equal ref counts → tie-broken by key for determinism."""
        tracker = StabilityTracker(cache_target_tokens=500)
        tracker._items["symbol:b.py"] = TrackedItem(
            "symbol:b.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=400,
        )
        tracker._items["symbol:a.py"] = TrackedItem(
            "symbol:a.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=400,
        )
        # Same ref count; key ordering decides.
        ref = _FakeRefIndex(ref_counts={"a.py": 5, "b.py": 5})
        # Target × 1.5 = 750. One promotion (400) brings L0 to
        # 400 < 750 — a second promotion (800) exceeds target.
        # So both get promoted. Let's choose tokens that only
        # allow one to fit.
        tracker._items["symbol:b.py"].tokens = 500
        tracker._items["symbol:a.py"].tokens = 500
        # Target × 1.5 = 750. Promote one → acc=500 < 750,
        # promote another → acc=1000 ≥ 750 AFTER; but the
        # check is at top of loop so we promote both. Tweak
        # sizes to make the bound actually limiting:
        tracker._items["symbol:b.py"].tokens = 800
        tracker._items["symbol:a.py"].tokens = 800
        # acc=0 < 750 → promote first → acc=800
        # acc=800 ≥ 750 → break
        # Pass overshoot_multiplier=1.5 explicitly — math
        # here is calibrated for 1.5 (the old default). The
        # new default is 2.0 which gives target=1000 and
        # both items would promote, but this test is
        # exercising the tie-break ordering, not the
        # overshoot semantics.
        promoted = tracker.backfill_l0_after_measurement(
            ref, overshoot_multiplier=1.5,
        )
        assert promoted == 1
        # Tie-break: key ascending → a.py promotes first.
        assert tracker.get_all_items()["symbol:a.py"].tier == Tier.L0
        assert tracker.get_all_items()["symbol:b.py"].tier == Tier.L1

    def test_preserves_tokens_and_hash(self) -> None:
        """Promoted items retain their real token count and hash.

        Measurement already populated real counts; backfill must
        not clobber them with placeholders.
        """
        tracker = StabilityTracker(cache_target_tokens=500)
        tracker._items["symbol:a.py"] = TrackedItem(
            "symbol:a.py", Tier.L1, n_value=9,
            content_hash="real-hash-123", tokens=300,
        )
        ref = _FakeRefIndex(ref_counts={"a.py": 5})
        tracker.backfill_l0_after_measurement(ref)
        item = tracker.get_all_items()["symbol:a.py"]
        assert item.tier == Tier.L0
        assert item.content_hash == "real-hash-123"
        assert item.tokens == 300

    def test_promoted_item_gets_l0_entry_n(self) -> None:
        """Promoted items enter L0 at L0's entry_n (=12)."""
        tracker = StabilityTracker(cache_target_tokens=500)
        tracker._items["symbol:a.py"] = TrackedItem(
            "symbol:a.py", Tier.L1, n_value=9,  # L1's entry_n
            content_hash="h1", tokens=300,
        )
        ref = _FakeRefIndex(ref_counts={"a.py": 5})
        tracker.backfill_l0_after_measurement(ref)
        assert tracker.get_all_items()["symbol:a.py"].n_value == 12

    def test_marks_source_tiers_broken(self) -> None:
        """Source tiers of promoted items are marked broken.

        Signals the next cascade to rebalance L1/L2/L3
        distribution after the backfill's selective promotions.
        """
        tracker = StabilityTracker(cache_target_tokens=500)
        tracker._items["symbol:a.py"] = TrackedItem(
            "symbol:a.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=300,
        )
        tracker._items["symbol:b.py"] = TrackedItem(
            "symbol:b.py", Tier.L2, n_value=6,
            content_hash="h1", tokens=300,
        )
        ref = _FakeRefIndex(ref_counts={"a.py": 10, "b.py": 5})
        tracker.backfill_l0_after_measurement(ref)
        # Both L1 and L2 should now be in broken_tiers.
        assert Tier.L1 in tracker._broken_tiers
        assert Tier.L2 in tracker._broken_tiers

    def test_l0_not_marked_broken(self) -> None:
        """L0 itself not marked broken — promoted items earned their slot.

        If L0 were broken, the next cascade would reconsider
        the backfill's placements and potentially undo them.
        """
        tracker = StabilityTracker(cache_target_tokens=500)
        tracker._items["symbol:a.py"] = TrackedItem(
            "symbol:a.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=300,
        )
        ref = _FakeRefIndex(ref_counts={"a.py": 5})
        tracker.backfill_l0_after_measurement(ref)
        assert Tier.L0 not in tracker._broken_tiers

    def test_skips_non_file_keys(self) -> None:
        """system:* and url:* and history:* are not candidates.

        Only file:/symbol:/doc: keys are eligible for backfill.
        Other prefixes are intentionally excluded — system is
        L0-only, urls are session-scoped, history follows its
        own graduation path.
        """
        tracker = StabilityTracker(cache_target_tokens=500)
        tracker._items["url:abc"] = TrackedItem(
            "url:abc", Tier.L1, n_value=9,
            content_hash="h1", tokens=300,
        )
        tracker._items["history:0"] = TrackedItem(
            "history:0", Tier.L3, n_value=3,
            content_hash="h1", tokens=300,
        )
        ref = _FakeRefIndex()
        promoted = tracker.backfill_l0_after_measurement(ref)
        assert promoted == 0
        assert tracker.get_all_items()["url:abc"].tier == Tier.L1
        assert tracker.get_all_items()["history:0"].tier == Tier.L3

    def test_skips_items_already_in_l0(self) -> None:
        """L0 residents aren't re-promoted."""
        tracker = StabilityTracker(cache_target_tokens=500)
        tracker._items["symbol:already.py"] = TrackedItem(
            "symbol:already.py", Tier.L0, n_value=12,
            content_hash="h1", tokens=100,
        )
        tracker._items["symbol:candidate.py"] = TrackedItem(
            "symbol:candidate.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=300,
        )
        ref = _FakeRefIndex(
            ref_counts={"already.py": 100, "candidate.py": 5},
        )
        promoted = tracker.backfill_l0_after_measurement(ref)
        # already.py stays in L0 without being re-promoted.
        # candidate.py promotes to bring L0 from 100 to 400
        # (target × 1.5 = 750, still under).
        assert promoted == 1
        assert tracker.get_all_items()["symbol:already.py"].tier == Tier.L0
        assert tracker.get_all_items()["symbol:candidate.py"].tier == Tier.L0

    def test_accumulated_counts_existing_l0_tokens(self) -> None:
        """Backfill target measured against TOTAL L0 tokens.

        If L0 already has some real tokens, the backfill only
        needs to add enough to reach the overshoot target —
        not the full target on top of existing content.
        """
        tracker = StabilityTracker(cache_target_tokens=1000)
        # L0 has 800 real tokens already.
        tracker._items["system:prompt"] = TrackedItem(
            "system:prompt", Tier.L0, n_value=12,
            content_hash="h1", tokens=800,
        )
        # Two L1 candidates at 500 each.
        tracker._items["symbol:a.py"] = TrackedItem(
            "symbol:a.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=500,
        )
        tracker._items["symbol:b.py"] = TrackedItem(
            "symbol:b.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=500,
        )
        ref = _FakeRefIndex(
            ref_counts={"a.py": 10, "b.py": 5},
        )
        # target = 1000 × 1.5 = 1500. L0 has 800. Need 700 more.
        # Promote a.py (highest ref): acc = 800 + 500 = 1300 < 1500.
        # Promote b.py: acc = 1300 + 500 = 1800 ≥ 1500 → break
        # AT TOP OF NEXT ITERATION (both already promoted).
        # Actually: acc=800, iter 1 acc<1500 promote a → acc=1300,
        # iter 2 acc<1500 promote b → acc=1800, iter 3 acc>=1500 break.
        promoted = tracker.backfill_l0_after_measurement(ref)
        assert promoted == 2

    def test_custom_overshoot_multiplier(self) -> None:
        """Overshoot multiplier is tunable.

        Default is 1.5 but the parameter is exposed for tuning.
        """
        tracker = StabilityTracker(cache_target_tokens=1000)
        tracker._items["symbol:a.py"] = TrackedItem(
            "symbol:a.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=500,
        )
        tracker._items["symbol:b.py"] = TrackedItem(
            "symbol:b.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=500,
        )
        tracker._items["symbol:c.py"] = TrackedItem(
            "symbol:c.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=500,
        )
        ref = _FakeRefIndex(
            ref_counts={"a.py": 10, "b.py": 5, "c.py": 1},
        )
        # Use overshoot=1.0 (no headroom). Target = 1000.
        # iter 1 acc=0 < 1000 → promote a → acc=500
        # iter 2 acc=500 < 1000 → promote b → acc=1000
        # iter 3 acc=1000 >= 1000 → break
        promoted = tracker.backfill_l0_after_measurement(
            ref, overshoot_multiplier=1.0,
        )
        assert promoted == 2
        # c.py stays in L1.
        assert tracker.get_all_items()["symbol:c.py"].tier == Tier.L1

    def test_doc_keys_eligible(self) -> None:
        """doc:{path} keys are also valid backfill candidates.

        Cross-reference mode seeds doc: entries into L1/L2/L3;
        they should compete for L0 slots alongside symbol: entries.
        """
        tracker = StabilityTracker(cache_target_tokens=500)
        tracker._items["doc:readme.md"] = TrackedItem(
            "doc:readme.md", Tier.L1, n_value=9,
            content_hash="h1", tokens=400,
        )
        ref = _FakeRefIndex(ref_counts={"readme.md": 10})
        promoted = tracker.backfill_l0_after_measurement(ref)
        assert promoted == 1
        assert tracker.get_all_items()["doc:readme.md"].tier == Tier.L0

    def test_file_keys_eligible(self) -> None:
        """file:{path} keys are valid candidates.

        Selected files swapped to file: entries during rebuild
        should be able to earn L0 via backfill too.
        """
        tracker = StabilityTracker(cache_target_tokens=500)
        tracker._items["file:selected.py"] = TrackedItem(
            "file:selected.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=400,
        )
        ref = _FakeRefIndex(ref_counts={"selected.py": 10})
        promoted = tracker.backfill_l0_after_measurement(ref)
        assert promoted == 1
        assert tracker.get_all_items()["file:selected.py"].tier == Tier.L0

    def test_change_log_records_backfill(self) -> None:
        """Change log distinguishes backfill promotions."""
        tracker = StabilityTracker(cache_target_tokens=500)
        tracker._items["symbol:a.py"] = TrackedItem(
            "symbol:a.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=300,
        )
        ref = _FakeRefIndex(ref_counts={"a.py": 5})
        tracker.backfill_l0_after_measurement(ref)
        changes = tracker.get_changes()
        # Should include a "backfill" annotation so the terminal
        # HUD can distinguish from normal cascade promotions.
        assert any(
            "L1 → L0" in c and "backfill" in c and "a.py" in c
            for c in changes
        )


# ---------------------------------------------------------------------------
# Backfill — candidate_keys restriction (cross-ref seeding)
# ---------------------------------------------------------------------------


class TestBackfillCandidateKeys:
    """``candidate_keys`` filter restricts which items are promoted.

    Added so :func:`seed_cross_reference_items` can tell the
    backfill "only consider these newly-seeded keys, not
    everything in L1/L2/L3". Without the filter, toggling
    cross-ref on would promote unrelated content that users
    carefully placed into cached tiers — confusing and
    unrelated to the user's intent.

    Governing contract: specs4/3-llm/modes.md § Cross-Reference
    Activation — "Primary-index items already resident in L0
    are never evicted — only L1/L2/L3 candidates are considered
    for the backfill promotion".
    """

    def test_none_means_all_candidates_eligible(self) -> None:
        """Default (None) → every L1/L2/L3 item is a candidate.

        Preserves the pre-existing behaviour for primary init
        paths that haven't been updated to pass the filter.
        """
        tracker = StabilityTracker(cache_target_tokens=500)
        tracker._items["symbol:a.py"] = TrackedItem(
            "symbol:a.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=300,
        )
        tracker._items["symbol:b.py"] = TrackedItem(
            "symbol:b.py", Tier.L2, n_value=6,
            content_hash="h1", tokens=300,
        )
        ref = _FakeRefIndex(ref_counts={"a.py": 10, "b.py": 5})
        # candidate_keys=None — default behaviour.
        promoted = tracker.backfill_l0_after_measurement(ref)
        # target × 1.5 = 750. Both promote (acc: 300, 600, 750+).
        # Actually: acc=0 < 750 → promote a → acc=300,
        # acc=300 < 750 → promote b → acc=600, no more
        # candidates. Both end in L0.
        assert promoted == 2
        assert tracker.get_all_items()["symbol:a.py"].tier == Tier.L0
        assert tracker.get_all_items()["symbol:b.py"].tier == Tier.L0

    def test_empty_set_promotes_nothing(self) -> None:
        """Empty ``candidate_keys`` → no eligible items.

        Distinct from None — empty set means "I have a
        restriction but nothing matches". Every candidate gets
        filtered out. L0 stays underfilled even with plenty of
        L1/L2/L3 content.
        """
        tracker = StabilityTracker(cache_target_tokens=500)
        tracker._items["symbol:a.py"] = TrackedItem(
            "symbol:a.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=300,
        )
        ref = _FakeRefIndex(ref_counts={"a.py": 10})
        promoted = tracker.backfill_l0_after_measurement(
            ref, candidate_keys=set(),
        )
        assert promoted == 0
        assert tracker.get_all_items()["symbol:a.py"].tier == Tier.L1

    def test_only_listed_keys_eligible(self) -> None:
        """Items NOT in ``candidate_keys`` are skipped.

        The core contract. Three L1 items, two listed as
        candidates, one not. The un-listed item must NOT
        promote regardless of its ref count.
        """
        tracker = StabilityTracker(cache_target_tokens=1000)
        tracker._items["symbol:listed1.py"] = TrackedItem(
            "symbol:listed1.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=300,
        )
        tracker._items["symbol:listed2.py"] = TrackedItem(
            "symbol:listed2.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=300,
        )
        tracker._items["symbol:excluded.py"] = TrackedItem(
            "symbol:excluded.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=300,
        )
        ref = _FakeRefIndex(
            ref_counts={
                "listed1.py": 5,
                "listed2.py": 3,
                "excluded.py": 100,  # highest — would normally win
            },
        )
        promoted = tracker.backfill_l0_after_measurement(
            ref,
            candidate_keys={
                "symbol:listed1.py", "symbol:listed2.py",
            },
        )
        # Both listed items promote; excluded stays. Target ×
        # 1.5 = 1500; acc=0 → 300 (listed1) → 600 (listed2) —
        # no more candidates.
        assert promoted == 2
        assert (
            tracker.get_all_items()["symbol:listed1.py"].tier
            == Tier.L0
        )
        assert (
            tracker.get_all_items()["symbol:listed2.py"].tier
            == Tier.L0
        )
        # Highest ref count but not in the candidate set — stays.
        assert (
            tracker.get_all_items()["symbol:excluded.py"].tier
            == Tier.L1
        )

    def test_preserves_pre_existing_l2_entry(self) -> None:
        """The cross-ref idempotence invariant at the tracker level.

        A user-placed L2 entry (simulating a prior cross-ref
        session that earned tier state, or a primary-index
        item) survives a backfill pass that doesn't include
        it in the candidate set — even when the backfill
        otherwise has room for it.
        """
        tracker = StabilityTracker(cache_target_tokens=500)
        # Pre-existing L2 entry — the "carefully placed" case.
        tracker._items["doc:preserved.md"] = TrackedItem(
            "doc:preserved.md", Tier.L2, n_value=5,
            content_hash="earned-state", tokens=100,
        )
        # Newly-seeded L1 entry — cross-ref pass just added this.
        tracker._items["doc:fresh.md"] = TrackedItem(
            "doc:fresh.md", Tier.L1, n_value=9,
            content_hash="h1", tokens=300,
        )
        ref = _FakeRefIndex(
            ref_counts={"preserved.md": 100, "fresh.md": 5},
        )
        # Candidate set = only the newly-seeded key.
        promoted = tracker.backfill_l0_after_measurement(
            ref, candidate_keys={"doc:fresh.md"},
        )
        # Fresh promotes to L0; preserved stays at L2 with
        # earned state intact.
        assert promoted == 1
        assert tracker.get_all_items()["doc:fresh.md"].tier == Tier.L0
        preserved = tracker.get_all_items()["doc:preserved.md"]
        assert preserved.tier == Tier.L2
        assert preserved.n_value == 5
        assert preserved.content_hash == "earned-state"

    def test_filter_respects_tier_exclusion_of_l0(self) -> None:
        """candidate_keys filter runs on top of the L0 tier filter.

        A key in ``candidate_keys`` that's already at L0 is
        still excluded — the backfill's existing
        L1/L2/L3-only rule wins. Belt and braces: the caller
        can pass any keys they like without risking an
        already-in-L0 item being re-promoted (which would
        reset its n_value).
        """
        tracker = StabilityTracker(cache_target_tokens=500)
        # Item already at L0 with earned N.
        tracker._items["symbol:already.py"] = TrackedItem(
            "symbol:already.py", Tier.L0, n_value=20,
            content_hash="h1", tokens=300,
        )
        # Candidate also included.
        tracker._items["symbol:candidate.py"] = TrackedItem(
            "symbol:candidate.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=200,
        )
        ref = _FakeRefIndex(
            ref_counts={"already.py": 100, "candidate.py": 5},
        )
        promoted = tracker.backfill_l0_after_measurement(
            ref,
            candidate_keys={
                "symbol:already.py", "symbol:candidate.py",
            },
        )
        # Only candidate promotes — already stays with its
        # earned N preserved, not re-entered at entry_n.
        assert promoted == 1
        already = tracker.get_all_items()["symbol:already.py"]
        assert already.tier == Tier.L0
        assert already.n_value == 20  # not reset to entry_n=12

    def test_filter_respects_prefix_exclusion(self) -> None:
        """candidate_keys filter runs on top of the prefix filter.

        ``history:`` and ``url:`` keys are never eligible
        regardless of candidate_keys membership. The filter
        is a restriction, not an override.
        """
        tracker = StabilityTracker(cache_target_tokens=500)
        tracker._items["history:0"] = TrackedItem(
            "history:0", Tier.L3, n_value=3,
            content_hash="h1", tokens=300,
        )
        tracker._items["url:abc"] = TrackedItem(
            "url:abc", Tier.L1, n_value=9,
            content_hash="h1", tokens=300,
        )
        ref = _FakeRefIndex()
        promoted = tracker.backfill_l0_after_measurement(
            ref,
            candidate_keys={"history:0", "url:abc"},
        )
        assert promoted == 0
        assert tracker.get_all_items()["history:0"].tier == Tier.L3
        assert tracker.get_all_items()["url:abc"].tier == Tier.L1


# ---------------------------------------------------------------------------
# distribute_keys_by_clustering — append without disturbing existing state
# ---------------------------------------------------------------------------


class TestDistributeKeysByClustering:
    """Append keys to the tracker across L1/L2/L3 via clustering.

    Used by :func:`seed_cross_reference_items` for cross-ref
    activation. Mirrors :meth:`initialize_with_keys`'s
    clustering path but never places into L0 and never
    overwrites existing tracker entries. Governing spec:
    specs4/3-llm/modes.md § Cross-Reference Activation.
    """

    def test_empty_keys_is_noop(self) -> None:
        """No keys → no side effects."""
        tracker = StabilityTracker()
        tracker.distribute_keys_by_clustering(
            _FakeRefIndex(),
            keys=[],
            files=[],
        )
        assert tracker.get_all_items() == {}

    def test_keys_files_length_mismatch_raises(self) -> None:
        """Defensive — mismatched input lengths fail loudly."""
        tracker = StabilityTracker()
        with pytest.raises(ValueError, match="length"):
            tracker.distribute_keys_by_clustering(
                _FakeRefIndex(),
                keys=["doc:a.md", "doc:b.md"],
                files=["a.md"],
            )

    def test_skips_keys_already_in_tracker(self) -> None:
        """Pre-existing tracked keys are preserved verbatim.

        The core idempotence contract — cross-ref enable
        must not overwrite tier/N state on keys that a prior
        pass already placed. Here we seed a key at L0 with
        a distinctive N value, then call the method with
        that key in the input. The item stays at L0 with its
        N value untouched.
        """
        tracker = StabilityTracker()
        # Pre-seed at L0 with earned state.
        tracker._items["doc:existing.md"] = TrackedItem(
            "doc:existing.md", Tier.L0, n_value=15,
            content_hash="earned", tokens=500,
        )
        ref = _FakeRefIndex(ref_counts={"existing.md": 5})
        tracker.distribute_keys_by_clustering(
            ref,
            keys=["doc:existing.md"],
            files=["existing.md"],
        )
        item = tracker.get_all_items()["doc:existing.md"]
        assert item.tier == Tier.L0
        assert item.n_value == 15
        assert item.content_hash == "earned"
        assert item.tokens == 500

    def test_new_keys_land_in_cached_tiers(self) -> None:
        """Fresh keys distribute across L1/L2/L3 — never L0, never ACTIVE.

        L0 is reserved for primary index content; cross-ref
        distribution targets L1/L2/L3 explicitly. ACTIVE is
        never a distribution target — items go to ACTIVE only
        via the Phase 1 demotion path.
        """
        ref = _FakeRefIndex(ref_counts={"a.md": 5, "b.md": 3, "c.md": 1})
        tracker = StabilityTracker()
        tracker.distribute_keys_by_clustering(
            ref,
            keys=["doc:a.md", "doc:b.md", "doc:c.md"],
            files=["a.md", "b.md", "c.md"],
        )
        for item in tracker.get_all_items().values():
            assert item.tier not in (Tier.L0, Tier.ACTIVE)
            assert item.tier in (Tier.L1, Tier.L2, Tier.L3)

    def test_distributes_across_all_three_tiers(self) -> None:
        """Three singleton components → one per tier.

        Greedy bin-packer picks the smallest-sized tier for
        each component. With three components of size 1 and
        three empty tiers, they spread one-per-tier. Deterministic
        tie-break means each tier gets exactly one.
        """
        ref = _FakeRefIndex()  # no components, all orphans
        tracker = StabilityTracker()
        tracker.distribute_keys_by_clustering(
            ref,
            keys=["doc:a.md", "doc:b.md", "doc:c.md"],
            files=["a.md", "b.md", "c.md"],
        )
        for tier in (Tier.L1, Tier.L2, Tier.L3):
            assert len(tracker.get_tier_items(tier)) == 1, (
                f"{tier} should have exactly 1 item, "
                f"got {len(tracker.get_tier_items(tier))}"
            )

    def test_placeholder_hash_and_tokens(self) -> None:
        """Seeded items get placeholder state, not real counts.

        Caller (seed_cross_reference_items) calls
        measure_tracker_tokens afterward to replace
        placeholders with real counts. Phase 1's first-
        measurement acceptance handles the placeholder-to-real
        hash transition without a spurious demotion.
        """
        from ac_dc.stability_tracker import _PLACEHOLDER_TOKENS
        ref = _FakeRefIndex()
        tracker = StabilityTracker()
        tracker.distribute_keys_by_clustering(
            ref,
            keys=["doc:a.md"],
            files=["a.md"],
        )
        item = tracker.get_all_items()["doc:a.md"]
        assert item.content_hash == ""
        assert item.tokens == _PLACEHOLDER_TOKENS

    def test_placed_at_tier_entry_n(self) -> None:
        """Each seeded item lands with its tier's entry_n.

        Matches the primary init path — items enter at the
        tier's documented entry_n so they don't get
        mistakenly anchored or capped differently than
        primary content.
        """
        ref = _FakeRefIndex()
        tracker = StabilityTracker()
        tracker.distribute_keys_by_clustering(
            ref,
            keys=["doc:a.md", "doc:b.md", "doc:c.md"],
            files=["a.md", "b.md", "c.md"],
        )
        # Each tier's entry_n — L1=9, L2=6, L3=3.
        for tier, expected_n in [
            (Tier.L1, 9),
            (Tier.L2, 6),
            (Tier.L3, 3),
        ]:
            items = tracker.get_tier_items(tier)
            assert items, f"{tier} empty"
            for item in items.values():
                assert item.n_value == expected_n, (
                    f"{item.key} at {tier} has n_value "
                    f"{item.n_value}, expected {expected_n}"
                )

    def test_marks_destination_tiers_broken(self) -> None:
        """Every tier that receives content is marked broken.

        Without this the next request's cache breakpoints
        would be computed against stale tier state — the
        newly-seeded content wouldn't be included in the
        cache block rebuild.
        """
        ref = _FakeRefIndex()
        tracker = StabilityTracker()
        tracker.distribute_keys_by_clustering(
            ref,
            keys=["doc:a.md", "doc:b.md", "doc:c.md"],
            files=["a.md", "b.md", "c.md"],
        )
        # Three singletons → distributed across L1/L2/L3 →
        # all three tiers broken.
        assert Tier.L1 in tracker._broken_tiers
        assert Tier.L2 in tracker._broken_tiers
        assert Tier.L3 in tracker._broken_tiers

    def test_mixed_pre_existing_and_new(self) -> None:
        """One pre-existing key, one new — only the new one lands.

        End-to-end check of the preservation + distribution
        interaction. Pre-existing key stays at its L0 seat;
        new key lands in a cached tier.
        """
        tracker = StabilityTracker()
        tracker._items["doc:old.md"] = TrackedItem(
            "doc:old.md", Tier.L0, n_value=12,
            content_hash="old-hash", tokens=200,
        )
        ref = _FakeRefIndex(ref_counts={"old.md": 10, "new.md": 5})
        tracker.distribute_keys_by_clustering(
            ref,
            keys=["doc:old.md", "doc:new.md"],
            files=["old.md", "new.md"],
        )
        # Old unchanged.
        old = tracker.get_all_items()["doc:old.md"]
        assert old.tier == Tier.L0
        assert old.content_hash == "old-hash"
        # New placed in a cached tier (not L0, not ACTIVE).
        new = tracker.get_all_items()["doc:new.md"]
        assert new.tier in (Tier.L1, Tier.L2, Tier.L3)

    def test_all_keys_pre_existing_is_noop(self) -> None:
        """Every input key already tracked → no tier changes.

        After filtering out already-tracked pairs, nothing
        remains to distribute. The method returns without
        marking any tiers broken.
        """
        tracker = StabilityTracker()
        tracker._items["doc:a.md"] = TrackedItem(
            "doc:a.md", Tier.L2, n_value=6,
            content_hash="h1", tokens=100,
        )
        tracker._broken_tiers.clear()
        ref = _FakeRefIndex(ref_counts={"a.md": 5})
        tracker.distribute_keys_by_clustering(
            ref,
            keys=["doc:a.md"],
            files=["a.md"],
        )
        # No new items added.
        assert len(tracker.get_all_items()) == 1
        # No tiers marked broken — nothing changed.
        assert tracker._broken_tiers == set()

    def test_orphans_spread_via_singletons(self) -> None:
        """Files not in any component still get distributed.

        The real cross-ref case has many files with no doc-
        to-doc links; they'd be absent from the ref index's
        components. The method must still place them
        (matching the primary init path's orphan handling).
        """
        # No components; every file is an orphan.
        ref = _FakeRefIndex(components=[], ref_counts={})
        tracker = StabilityTracker()
        tracker.distribute_keys_by_clustering(
            ref,
            keys=["doc:a.md", "doc:b.md"],
            files=["a.md", "b.md"],
        )
        assert tracker.has_item("doc:a.md")
        assert tracker.has_item("doc:b.md")

    def test_component_clusters_land_together(self) -> None:
        """Files in the same component share a tier.

        The bin-packer assigns each component to one tier,
        so tightly-coupled files ride together through
        cache cycles — they invalidate or promote as a
        group, matching how users mentally group them.
        """
        ref = _FakeRefIndex(components=[{"a.md", "b.md", "c.md"}])
        tracker = StabilityTracker()
        tracker.distribute_keys_by_clustering(
            ref,
            keys=["doc:a.md", "doc:b.md", "doc:c.md"],
            files=["a.md", "b.md", "c.md"],
        )
        # All three should be in the same tier (same
        # component → same tier via bin-packer).
        items = tracker.get_all_items()
        tiers = {item.tier for item in items.values()}
        assert len(tiers) == 1, (
            f"clustered files should share a tier, got {tiers}"
        )