"""Anchoring, underfill demotion, L0 content-type invariants.

Extracted from the original monolithic ``test_stability_tracker.py``.
"""

from __future__ import annotations

from ac_dc.stability_tracker import (
    StabilityTracker,
    Tier,
    TrackedItem,
)

from .conftest import _active_item, xfail_legacy_cascade


class TestStaticUnderfillDoesNotDrainL1:
    """Regression guard: static L0 underfill does not chain-drain.

    The original bug: the cascade's L0 backfill probe used to
    run unconditionally — every turn it checked whether L0
    was below cache_target_tokens and, if so, marked L0
    broken. That opened L1 → L0, which (via structural-
    invalidation propagation) opened L2 → L1, which opened
    L3 → L2. A long-lived stable conversation that happened
    to leave L0 sitting a bit below cache_target would see
    mass promotions on every turn.

    The first fix gated the probe on
    ``had_external_invalidation``. The second (D27, the
    L0-content-typed model) removed the probe entirely:
    the cascade no longer touches L0. L0 population is
    handled exclusively by init / rebuild / cross-reference
    seeding paths, and the per-turn cascade is concerned
    only with L1/L2/L3 dynamics.

    These tests still pass under the stricter regime — they
    asserted "L0 underfill must not chain-drain L1", and the
    stricter answer is "L0 cannot drain L1 from any source,
    underfill or otherwise". Kept as regression guards
    against any future regression that would re-introduce
    cascade → L0 paths.
    """

    def test_underfilled_l0_does_not_drain_l1_when_no_invalidation(self) -> None:
        """L0 below target + L1 veterans + nothing broken = no drain.

        Setup: L0 has 100 tokens (well below cache_target=10000).
        L1 has 5 veterans at promote_n with substantial tokens.
        L2 and L3 are empty. No external invalidation, no hash
        changes. Drive one update with all items unchanged.

        Expectation: nothing moves. L0 stays at 100 tokens, L1
        stays full. The cascade must not invent an L0
        invalidation to chase the underfill — that would chain-
        drain L1 every single turn the user is in this state.
        """
        tracker = StabilityTracker(cache_target_tokens=10_000)
        # L0 with one small resident — well below cache_target.
        tracker._items["system:prompt"] = TrackedItem(
            "system:prompt", Tier.L0, n_value=12,
            content_hash="h_sys", tokens=100,
        )
        # L1 with five veterans at promote_n (12), so they
        # WOULD promote if the gate let them. Total tokens
        # well above cache_target so anchoring rules apply
        # normally (some anchored, some not).
        for i in range(5):
            tracker._items[f"file:l1_{i}.py"] = TrackedItem(
                f"file:l1_{i}.py", Tier.L1, n_value=12,
                content_hash="h1", tokens=3000,
            )
        # Drive one update with every item unchanged. No hash
        # change, no deselection, no rebuild — the cascade has
        # zero external invalidations to piggyback on.
        active = {
            "system:prompt": _active_item("h_sys", 100),
        }
        for i in range(5):
            active[f"file:l1_{i}.py"] = _active_item("h1", 3000)
        tracker.update(active)

        items = tracker.get_all_items()
        # L0 unchanged — system prompt stays at L0 (n_value
        # may increment via Phase 1, that's fine; tier is the
        # contract).
        assert items["system:prompt"].tier == Tier.L0
        # Every L1 resident still in L1. Nothing promoted.
        # This is the regression assertion: even with veterans
        # AT promote_n and L0 underfilled, the cascade must
        # not invent an L0 invalidation to drain L1.
        for i in range(5):
            assert items[f"file:l1_{i}.py"].tier == Tier.L1, (
                f"file:l1_{i}.py promoted to L0 despite no "
                f"L0 invalidation. The cascade must not chase "
                f"static underfill — that's "
                f"backfill_l0_after_measurement's job."
            )

    def test_l1_invalidation_does_not_drain_to_l0(self) -> None:
        """L1 invalidation never promotes into L0.

        Under the L0-content-typed model (D27), the cascade
        does not promote ``file:`` (or ``url:`` or
        ``history:``) entries into L0. L0 is reserved for
        structural content (system prompt, aggregate maps)
        plus optional cross-reference seeded items.

        Same setup as the previous test (L1 invalidated, L1
        residents at promote_n, L0 underfilled), but the
        outcome inverts: nothing flows into L0. The L1
        residents that are eligible for promotion stay at
        L1, because L1's "tier above" is None under the
        new ``_TIER_ABOVE`` map.

        Regression guard against the legacy "L0 backfill
        probe" path that previously fired during the
        per-cycle cascade. That probe is removed; L0
        population happens only through init / rebuild /
        cross-reference seed.

        Spec: ``specs4/3-llm/cache-tiering.md`` § L0 Stability
        Contract.
        """
        tracker = StabilityTracker(cache_target_tokens=10_000)
        tracker._items["system:prompt"] = TrackedItem(
            "system:prompt", Tier.L0, n_value=12,
            content_hash="h_sys", tokens=100,
        )
        for i in range(5):
            tracker._items[f"file:l1_{i}.py"] = TrackedItem(
                f"file:l1_{i}.py", Tier.L1, n_value=12,
                content_hash="h1", tokens=5000,
            )
        # External L1 invalidation: simulate deselect by
        # removing one L1 resident and marking L1 broken.
        tracker._items.pop("file:l1_0.py")
        tracker._broken_tiers.add(Tier.L1)

        active = {
            "system:prompt": _active_item("h_sys", 100),
        }
        for i in range(1, 5):
            active[f"file:l1_{i}.py"] = _active_item("h1", 5000)
        tracker.update(active)

        items = tracker.get_all_items()
        # L0 stays at exactly its original size — only the
        # system prompt.
        l0_keys = {
            key for key, item in items.items()
            if item.tier == Tier.L0
        }
        assert l0_keys == {"system:prompt"}, (
            f"L0 should contain only system:prompt; got: {l0_keys}. "
            "The cascade must not promote file: entries into L0 "
            "under the L0-content-typed model."
        )
        # Every surviving L1 resident stays at L1 — promotion
        # is unavailable because L1 has no destination tier.
        for i in range(1, 5):
            assert items[f"file:l1_{i}.py"].tier == Tier.L1, (
                f"file:l1_{i}.py should stay at L1; "
                "no promotion target exists under the "
                "L0-content-typed model."
            )


class TestAnchoring:
    """Items below cache target have N frozen in the cascade.

    All tests use ``cache_target_tokens=500`` and per-item token
    counts that add up to exceed that threshold. Items with
    lower N get anchored first (sorted by N ascending), so the
    freshly-arrived items keep promoting while the older ones
    hold the tier above the cache floor.
    """

    @xfail_legacy_cascade
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

    @xfail_legacy_cascade
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

    def test_anchored_stay_unanchored_blocked_by_stable_upper(self) -> None:
        """Non-anchored veterans stay put when the upper tier is stable.

        Anchor math: items in a tier are sorted by N asc and
        accumulated until cumulative tokens reach cache_target.
        Items consumed before the threshold are anchored (N
        frozen, cannot promote). Items past the threshold are
        unanchored and eligible to promote — but still gated
        on the destination tier being broken or empty.

        Setup: cache_target=500; three L3 items at 300 tokens
        each (total 900). First two anchored (accumulated 600,
        above target so anchoring stops with only the first two
        in). Actually — re-reading the anchoring rule: items
        are consumed until accumulated reaches the target. So
        the first item (300, accumulated=300<500) is anchored,
        the second (accumulated=600>=500) is above the line,
        not anchored. Tie-broken by key, so a.py is anchored,
        b.py and c.py are unanchored.

        Seed L2 with a stable resident so L2 is NOT broken at
        cascade entry. Unanchored L3 items (b, c) reach
        promote_n but the destination is stable → gate blocks
        promotion. They stay at L3 with their incremented N
        (capped at promote_n by _process_tier_veterans when
        upper is stable).
        """
        tracker = StabilityTracker(cache_target_tokens=500)
        # Seed L2 with a stable item so L2 isn't broken or
        # empty.
        tracker._items["file:stable.py"] = TrackedItem(
            "file:stable.py", Tier.L2, n_value=6,
            content_hash="h1", tokens=600,
        )
        # Seed L3 with three items totalling 900 tokens. Sorted
        # ascending by (N, key): a(N=3), b(N=3), c(N=100).
        tracker._items["file:a.py"] = TrackedItem(
            "file:a.py", Tier.L3, n_value=3,
            content_hash="h1", tokens=300,
        )
        tracker._items["file:b.py"] = TrackedItem(
            "file:b.py", Tier.L3, n_value=3,
            content_hash="h1", tokens=300,
        )
        tracker._items["file:c.py"] = TrackedItem(
            "file:c.py", Tier.L3, n_value=100,  # well past promote_n
            content_hash="h1", tokens=300,
        )
        tracker.update(
            {
                "file:stable.py": _active_item("h1", 600),
                "file:a.py": _active_item("h1", 300),
                "file:b.py": _active_item("h1", 300),
                "file:c.py": _active_item("h1", 300),
            }
        )
        # L2 is stable — promotion from L3 to L2 blocked.
        # All L3 items stay at L3.
        assert tracker.get_all_items()["file:a.py"].tier == Tier.L3
        assert tracker.get_all_items()["file:b.py"].tier == Tier.L3
        assert tracker.get_all_items()["file:c.py"].tier == Tier.L3
        # Stable resident unchanged.
        assert (
            tracker.get_all_items()["file:stable.py"].tier == Tier.L2
        )


class TestUnderfillDemotion:
    """Tiers below cache target demote one level."""

    @xfail_legacy_cascade
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

    @xfail_legacy_cascade
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


class TestL0ContentTypedCascade:
    """Cascade respects L0's content-type policy (D27).

    Under the new model, the cascade never promotes items
    into L0. L0 holds the system prompt and aggregate
    structural maps; cascade-mobile content (file:, url:,
    history:) is ineligible. Only init / rebuild / cross-
    reference seeding can place items in L0.
    """

    def test_l1_item_at_promote_n_stays_at_l1(self) -> None:
        """An L1 item with N way past promote_n does not promote.

        Pre-seed an L1 entry with N=20 (well past promote_n
        which is 12 for L1). Run an update where the entry is
        unchanged. The item must stay at L1 — no L0 promotion
        path exists for cascade-mobile content.
        """
        tracker = StabilityTracker(cache_target_tokens=0)
        tracker._items["file:a.py"] = TrackedItem(
            "file:a.py", Tier.L1, n_value=20,
            content_hash="h1", tokens=100,
        )
        tracker.update({"file:a.py": _active_item("h1", 100)})
        assert tracker.get_all_items()["file:a.py"].tier == Tier.L1

    def test_url_at_l1_promote_n_stays_at_l1(self) -> None:
        """URL entries also cannot promote past L1."""
        tracker = StabilityTracker(cache_target_tokens=0)
        tracker._items["url:abc"] = TrackedItem(
            "url:abc", Tier.L1, n_value=20,
            content_hash="h1", tokens=100,
        )
        tracker.update({"url:abc": _active_item("h1", 100)})
        assert tracker.get_all_items()["url:abc"].tier == Tier.L1

    def test_l0_resident_unchanged_by_cascade(self) -> None:
        """L0 entries do not move during cascade.

        L0 is content-typed: its contents are governed by
        init / rebuild paths, not the cascade. An update
        cycle must not touch L0's tier assignments.
        """
        tracker = StabilityTracker(cache_target_tokens=500)
        tracker._items["system:prompt"] = TrackedItem(
            "system:prompt", Tier.L0, n_value=12,
            content_hash="h_sys", tokens=100,
        )
        # Drive an update with the system prompt active. Even
        # though L0 is below cache_target (100 < 500), the
        # cascade must not demote it — L0 is exempt from
        # underfill demotion under the L0-content-typed model.
        tracker.update({"system:prompt": _active_item("h_sys", 100)})
        assert (
            tracker.get_all_items()["system:prompt"].tier
            == Tier.L0
        )

    @xfail_legacy_cascade
    def test_active_item_with_high_n_graduates_to_l3_only(self) -> None:
        """Active item with high N reaches L1 over many cycles.

        Drive an item from active for 20 cycles. It graduates
        to L3 (cycle 4), promotes to L2 (cycle 7), promotes
        to L1 (cycle 10), and from there N grows but tier is
        terminal. Verifies the full cascade-mobile life cycle
        respects the L1 ceiling.
        """
        tracker = StabilityTracker(cache_target_tokens=0)
        for _ in range(20):
            tracker.update({"file:a.py": _active_item("h1", 100)})
        item = tracker.get_all_items()["file:a.py"]
        assert item.tier == Tier.L1
        # N has grown well past L1's promote_n (12) since the
        # item has nowhere else to go.
        assert item.n_value >= 12