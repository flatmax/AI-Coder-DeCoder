"""Graduation into L3 and cascade promotion through cached tiers.

Extracted from the original monolithic ``test_stability_tracker.py``.
"""

from __future__ import annotations

from ac_dc.stability_tracker import (
    StabilityTracker,
    Tier,
    TrackedItem,
)

from .conftest import _active_item


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

    def test_promotion_terminates_at_l1(self) -> None:
        """Item reaches L1 and stops — L0 is content-typed.

        Under the L0-content-typed model (D27), cascade-mobile
        content (``file:``, ``url:``, ``history:``) is
        ineligible for L0. The cascade processes L3 → L2 → L1
        and stops. An item that stays unchanged across many
        cycles graduates to L3, promotes to L2, promotes to
        L1, and then sits at L1 with N growing — but never
        promotes into L0.

        Spec: ``specs4/3-llm/cache-tiering.md`` § Tier
        Structure and § L0 Stability Contract.
        """
        tracker = StabilityTracker()
        # Many cycles — far more than enough to reach L0 under
        # the old model. Under the new model the item lands
        # at L1 and stays.
        for _ in range(20):
            tracker.update({"file:a.py": _active_item("h1")})
        item = tracker.get_all_items()["file:a.py"]
        assert item.tier == Tier.L1

    def test_blocked_by_stable_upper_tier(self) -> None:
        """Items do NOT promote past a stable upper tier.

        Per spec § Ripple Promotion: "Only promote into
        broken tiers — if a tier is stable, nothing promotes
        into it and tiers below remain cached." One external
        invalidation opens exactly one upward promotion path;
        without invalidation, veteran items sit at their
        promote_n and wait for their turn.

        Setup: pin items at L0, L1, L2 so those tiers are
        stable (not empty, not broken). Drive a.py through 7
        unchanged cycles with no external invalidation. a.py
        graduates to L3 at cycle 4 and reaches L3's promote_n
        at cycle 7 — but L2 is stable, so the promotion is
        blocked. a.py stays at L3.

        Regression guard for the chain-cascade bug: previously
        the code would mark L2 broken as a side effect of
        other tier mutations, letting a.py promote upward
        without any legitimate invalidation. Snapshot-based
        gating in _run_cascade prevents this.

        Note: the L0 pin is irrelevant to the test mechanics
        under the L0-content-typed model — the cascade can't
        promote into L0 regardless. The pin is kept so the
        test setup mirrors the original (and surfaces clearly
        if the cascade ever tries to mutate L0).
        """
        tracker = StabilityTracker()
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
        for _ in range(7):
            tracker.update(
                {
                    "file:a.py": _active_item("h1"),
                    "file:stable.py": _active_item("h1"),
                    "file:l1_pin.py": _active_item("h1"),
                    "file:l0_pin.py": _active_item("h1"),
                }
            )
        # a.py graduated to L3 at cycle 4 (N=3), then N grew
        # 4→5→6 at cycles 5/6/7. At cycle 7 with N=6 it wanted
        # to promote to L2 — but L2 is stable (has the pin
        # item, not in broken_tiers). Spec says stable tiers
        # block promotion. a.py stays at L3.
        a = tracker.get_all_items()["file:a.py"]
        assert a.tier == Tier.L3
        # Stable pins haven't moved either.
        assert (
            tracker.get_all_items()["file:stable.py"].tier == Tier.L2
        )
        assert (
            tracker.get_all_items()["file:l1_pin.py"].tier == Tier.L1
        )
        assert (
            tracker.get_all_items()["file:l0_pin.py"].tier == Tier.L0
        )

    def test_primed_cache_l1_deselect_ripples_full_chain(self) -> None:
        """End-to-end: L1 deselect drains L1, ripples up, graduates active.

        Reproduces the HUD-observed scenario: every cached
        tier is primed with residents at promote_n, plus
        active items that have reached the graduation
        threshold. User deselects a file in L1, which removes
        the L1 entry and marks L1 broken. Expected full chain:

        - active → L3: items at N ≥ 3 graduate (normal Phase 2)
        - L3 → L2: L3 residents at promote_n flow upward
          because L2 becomes structurally broken when L2→L1
          drains it
        - L2 → L1: L2 residents at promote_n flow into the
          externally-broken L1
        - L0 untouched: no L0-side invalidation

        Regression guard against the bug where the cascade's
        broken-tiers snapshot was frozen too strictly and
        only external invalidations propagated — structural
        invalidations (from promotion drainage) were ignored,
        leaving L3 veterans stranded at L3 even though L2
        had just been drained.
        """
        tracker = StabilityTracker(cache_target_tokens=0)
        # Seed every cached tier with one resident at its
        # promote_n so the cache is "primed for promotion".
        tracker._items["file:l0_resident.py"] = TrackedItem(
            "file:l0_resident.py", Tier.L0, n_value=12,
            content_hash="h1", tokens=100,
        )
        tracker._items["file:l1_resident.py"] = TrackedItem(
            "file:l1_resident.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=100,
        )
        tracker._items["file:l2_resident.py"] = TrackedItem(
            "file:l2_resident.py", Tier.L2, n_value=9,
            content_hash="h1", tokens=100,
        )
        tracker._items["file:l3_resident.py"] = TrackedItem(
            "file:l3_resident.py", Tier.L3, n_value=6,
            content_hash="h1", tokens=100,
        )
        # Seed an active item ready to graduate (N=3 after
        # the next unchanged-cycle increment will reach the
        # active promote_n threshold; starting at N=2 so the
        # Phase 1 increment lands it at 3).
        tracker._items["file:active_item.py"] = TrackedItem(
            "file:active_item.py", Tier.ACTIVE, n_value=2,
            content_hash="h1", tokens=100,
        )

        # Simulate L1 deselect: the orchestrator removes the
        # L1 entry and marks L1 broken. Exactly what
        # set_selected_files does when a file leaves the
        # selection set.
        tracker._items.pop("file:l1_resident.py")
        tracker._broken_tiers.add(Tier.L1)

        # Drive one update with every surviving item still
        # present and unchanged. This is the "next request"
        # after the deselect.
        tracker.update(
            {
                "file:l0_resident.py": _active_item("h1", 100),
                "file:l2_resident.py": _active_item("h1", 100),
                "file:l3_resident.py": _active_item("h1", 100),
                "file:active_item.py": _active_item("h1", 100),
            }
        )

        items = tracker.get_all_items()
        # L0 untouched — no L0 invalidation.
        assert items["file:l0_resident.py"].tier == Tier.L0, (
            "L0 must not be drained by an L1-scope "
            "invalidation"
        )
        # L2 veteran rode up into externally-broken L1.
        assert items["file:l2_resident.py"].tier == Tier.L1, (
            "L2 resident should promote into L1 "
            "(external invalidation)"
        )
        # L3 veteran rode up into structurally-broken L2.
        # This is the regression-guard assertion: without the
        # structural-invalidation propagation fix, the L3
        # resident stays at L3 because L2 wasn't marked
        # broken at cascade entry.
        assert items["file:l3_resident.py"].tier == Tier.L2, (
            "L3 resident should promote into L2 — L2 became "
            "structurally broken when its resident promoted "
            "to L1. This is the Ripple Promotion chain that "
            "must propagate through cascade iterations."
        )
        # Active item graduated into structurally-broken L3.
        assert items["file:active_item.py"].tier == Tier.L3, (
            "Active item at graduation threshold should "
            "graduate into L3 (Phase 2 graduation marks L3 "
            "broken independently, so this path works even "
            "without structural propagation — but verify "
            "end-to-end behaviour completes the chain)."
        )

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

    def test_l1_invalidation_ripples_up_through_structural_breaks(self) -> None:
        """Ripple Promotion: invalidation propagates via structural drain.

        Per spec § Ripple Promotion: "As items graduate and
        populate tiers, they ripple upward through the stable
        tiers." And Threshold-Aware Cascade: promotion happens
        every turn for every eligible item.

        The spec distinguishes two kinds of invalidation that
        behave differently:

        - **External** invalidation (hash change, deselection,
          orchestrator-marked tier) opens exactly one upward
          path — drain must not reach above the invalidated
          tier uninvited.
        - **Structural** invalidation (a tier loses residents
          because they promoted upward into a broken tier) is
          a genuine cache-block rebuild and DOES chain. The
          newly-drained tier can accept content from below.

        Setup: seed L0/L1/L2/L3 with eligible items. Externally
        invalidate L1. Expected chain:

        - L2→L1: L1 was externally broken at entry, L2 item
          at promote_n → promotes.
        - L3→L2: L2 is now structurally broken (lost its
          resident), L3 item at promote_n → promotes.
        - L0 stays put: under the L0-content-typed model the
          cascade does not promote into L0 at all. The L0
          resident is irrelevant to the chain — it's there
          to verify the cascade leaves L0 untouched.

        Regression guard for two invariants: (1) external L1
        invalidation does NOT drain L0 (destination-mark
        contract), and (2) the cascade respects the L0
        content-type policy (no promotions into L0 from below).

        Spec: ``specs4/3-llm/cache-tiering.md`` § Tier
        Structure and § Ripple Promotion.
        """
        tracker = StabilityTracker(cache_target_tokens=0)
        # L0 resident — stable, N maxed out.
        tracker._items["file:l0_item.py"] = TrackedItem(
            "file:l0_item.py", Tier.L0, n_value=12,
            content_hash="h1", tokens=100,
        )
        # L1 resident — will be the victim of external
        # invalidation, removed below.
        tracker._items["file:l1_item.py"] = TrackedItem(
            "file:l1_item.py", Tier.L1, n_value=9,
            content_hash="h1", tokens=100,
        )
        # L2 resident — at L2's promote_n (9). Should promote
        # into L1 because L1 is externally broken.
        tracker._items["file:l2_item.py"] = TrackedItem(
            "file:l2_item.py", Tier.L2, n_value=9,
            content_hash="h1", tokens=100,
        )
        # L3 resident — at L3's promote_n (6). Should promote
        # into L2 because L2 becomes structurally broken
        # after L2→L1 drains it.
        tracker._items["file:l3_item.py"] = TrackedItem(
            "file:l3_item.py", Tier.L3, n_value=6,
            content_hash="h1", tokens=100,
        )

        # External invalidation of L1: simulate by removing
        # the L1 resident and marking L1 broken (the pattern
        # that set_selected_files and hash-demotion use).
        tracker._items.pop("file:l1_item.py")
        tracker._broken_tiers.add(Tier.L1)

        tracker.update(
            {
                "file:l0_item.py": _active_item("h1", 100),
                "file:l2_item.py": _active_item("h1", 100),
                "file:l3_item.py": _active_item("h1", 100),
            }
        )

        items = tracker.get_all_items()
        # Ripple chain fires through structural invalidation:
        assert items["file:l2_item.py"].tier == Tier.L1, (
            "L2 item should have promoted into externally-"
            "broken L1"
        )
        assert items["file:l3_item.py"].tier == Tier.L2, (
            "L3 item should have promoted into structurally-"
            "broken L2 (L2 drained when its resident promoted "
            "to L1). This is the Ripple Promotion the spec "
            "describes — invalidations propagate upward "
            "through tier drainage."
        )
        # L0 stays put — no external L0 invalidation, and the
        # destination-mark contract prevents the chain from
        # reaching L0 via L1 drain (L1 was the external
        # invalidation target, not a new source of one).
        assert items["file:l0_item.py"].tier == Tier.L0, (
            "L0 must NOT be drained. External L1 invalidation "
            "opens L2→L1; L1 was the destination, not a "
            "source of structural invalidation, so L1 never "
            "feeds back into the gate and L0 stays cached."
        )