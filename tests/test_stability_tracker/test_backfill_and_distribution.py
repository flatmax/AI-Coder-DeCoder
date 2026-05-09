"""Post-measurement L0 backfill and key distribution.

Extracted from the original monolithic ``test_stability_tracker.py``.
"""

from __future__ import annotations

import pytest

from ac_dc.stability_tracker import (
    StabilityTracker,
    Tier,
    TrackedItem,
)

from .conftest import _FakeRefIndex, _active_item


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