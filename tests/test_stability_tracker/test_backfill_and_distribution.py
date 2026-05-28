"""Dir-block seeding — primary init and cross-reference append.

Under D36 the legacy backfill_l0_after_measurement and
distribute_keys_by_clustering mechanisms are gone. Cache
initialisation is now mtime-based via initialize_dir_blocks;
cross-reference activation appends opposite-index dir-blocks
via cross_ref_seed_dir_blocks. Both place items at placeholder
tokens / hash; the membrane controller rebalances over
subsequent request cycles.

Seed direction is **edit-cost-aware** (inverted from the
intuitive "hot → L0" reading): hot directories seed *cooler*
tiers because they are most likely to be edited again soon,
and an edit teleports the affected block to Active —
invalidating its current tier. Tearing down a small L3 cache
block is cheap; tearing down L0 is expensive. Cold content
sits at L0 where the cache block survives across many turns.

Governing spec: specs-reference/3-llm/cache-tiering
§ Initialization, § Cross-Reference Activation.
"""

from __future__ import annotations

from ac_dc.stability_tracker import (
    StabilityTracker,
    Tier,
    TrackedItem,
    _PLACEHOLDER_HASH,
    _PLACEHOLDER_TOKENS,
)


class TestInitializeDirBlocks:
    """``initialize_dir_blocks`` quartile-splits hottest → L3.

    Hot directories (recently-modified) seed cooler tiers so
    the cheapest cache block (L3) absorbs the churn when an
    edit teleports them to Active. Cold directories seed
    warmer tiers up to L0 because they are unlikely to be
    edited soon — L0's expensive cache block survives.
    Membrane controller rebalances after a few request cycles.
    """

    def test_empty_input_is_noop(self) -> None:
        """No keys → no side effects."""
        tracker = StabilityTracker()
        tracker.initialize_dir_blocks([])
        assert tracker.get_all_items() == {}

    def test_single_key_lands_in_l3(self) -> None:
        """A single dir-block goes to L3 (quartile 0, hottest)."""
        tracker = StabilityTracker()
        tracker.initialize_dir_blocks([("symbols:src", 1000.0)])
        item = tracker.get_all_items()["symbols:src"]
        assert item.tier == Tier.L3

    def test_hottest_lands_in_l3_coldest_in_l0(self) -> None:
        """Quartile split: hottest → L3, coolest → L0."""
        tracker = StabilityTracker()
        # Four directories, decreasing mtimes (hottest first).
        tracker.initialize_dir_blocks(
            [
                ("symbols:hot", 1000.0),
                ("symbols:warm", 500.0),
                ("symbols:cool", 100.0),
                ("symbols:cold", 10.0),
            ]
        )
        items = tracker.get_all_items()
        assert items["symbols:hot"].tier == Tier.L3
        assert items["symbols:warm"].tier == Tier.L2
        assert items["symbols:cool"].tier == Tier.L1
        assert items["symbols:cold"].tier == Tier.L0

    def test_mtime_tiebreak_by_key(self) -> None:
        """Equal mtimes → tie-break by key ascending."""
        tracker = StabilityTracker()
        tracker.initialize_dir_blocks(
            [
                ("symbols:b", 100.0),
                ("symbols:a", 100.0),
                ("symbols:d", 100.0),
                ("symbols:c", 100.0),
            ]
        )
        items = tracker.get_all_items()
        # Sorted by key (a, b, c, d) → split across quartiles
        # hottest-first: a → L3, b → L2, c → L1, d → L0.
        assert items["symbols:a"].tier == Tier.L3
        assert items["symbols:b"].tier == Tier.L2
        assert items["symbols:c"].tier == Tier.L1
        assert items["symbols:d"].tier == Tier.L0

    def test_placeholder_hash_and_tokens(self) -> None:
        """Seeded items carry placeholder content state.

        Phase 1 of the next update cycle accepts the first
        real hash without demoting.
        """
        tracker = StabilityTracker()
        tracker.initialize_dir_blocks([("symbols:src", 1000.0)])
        item = tracker.get_all_items()["symbols:src"]
        assert item.content_hash == _PLACEHOLDER_HASH
        assert item.tokens == _PLACEHOLDER_TOKENS

    def test_entry_n_matches_tier(self) -> None:
        """Each item enters at its tier's entry_n."""
        tracker = StabilityTracker()
        tracker.initialize_dir_blocks(
            [
                ("symbols:a", 1000.0),
                ("symbols:b", 500.0),
                ("symbols:c", 100.0),
                ("symbols:d", 10.0),
            ]
        )
        items = tracker.get_all_items()
        # entry_n: L0=12, L1=9, L2=6, L3=3
        # Hottest-first: a → L3, b → L2, c → L1, d → L0.
        assert items["symbols:a"].n_value == 3
        assert items["symbols:b"].n_value == 6
        assert items["symbols:c"].n_value == 9
        assert items["symbols:d"].n_value == 12

    def test_mixed_key_prefixes_supported(self) -> None:
        """``symbols:``, ``docs:``, ``plain_files:`` all valid."""
        tracker = StabilityTracker()
        tracker.initialize_dir_blocks(
            [
                ("symbols:src", 1000.0),
                ("docs:specs", 500.0),
                ("plain_files:assets", 100.0),
            ]
        )
        items = tracker.get_all_items()
        assert "symbols:src" in items
        assert "docs:specs" in items
        assert "plain_files:assets" in items


class TestCrossRefSeedDirBlocks:
    """``cross_ref_seed_dir_blocks`` distributes new keys across L1-L3.

    Cross-reference activation seeds opposite-index dir-blocks
    into cached tiers without touching primary-index entries.
    Mirrors :meth:`initialize_dir_blocks` direction: hottest
    → L3 (cheapest to invalidate), middle → L2, coolest → L1.
    L0 stays reserved for primary content so the secondary
    index has one membrane of climbing to do before competing
    for the top slot.
    """

    def test_empty_input_is_noop(self) -> None:
        """No keys → no side effects."""
        tracker = StabilityTracker()
        tracker.cross_ref_seed_dir_blocks([])
        assert tracker.get_all_items() == {}

    def test_skips_keys_already_in_tracker(self) -> None:
        """Pre-existing tracked keys are preserved verbatim.

        Cross-ref enable must not overwrite tier/N state on
        keys that a prior pass already placed.
        """
        tracker = StabilityTracker()
        tracker._items["docs:guide"] = TrackedItem(
            "docs:guide", Tier.L0, n_value=15,
            content_hash="earned", tokens=500,
        )
        tracker.cross_ref_seed_dir_blocks([("docs:guide", 1000.0)])
        item = tracker.get_all_items()["docs:guide"]
        assert item.tier == Tier.L0
        assert item.n_value == 15
        assert item.content_hash == "earned"
        assert item.tokens == 500

    def test_new_keys_never_land_in_l0(self) -> None:
        """Fresh keys distribute across L1/L2/L3 only.

        L0 is reserved for primary index content; cross-ref
        seeding targets L1/L2/L3 explicitly.
        """
        tracker = StabilityTracker()
        tracker.cross_ref_seed_dir_blocks(
            [
                ("docs:a", 1000.0),
                ("docs:b", 500.0),
                ("docs:c", 100.0),
            ]
        )
        for item in tracker.get_all_items().values():
            assert item.tier in (Tier.L1, Tier.L2, Tier.L3)

    def test_thirds_split_hottest_to_l3(self) -> None:
        """Three keys → one per L1/L2/L3, hottest → L3."""
        tracker = StabilityTracker()
        tracker.cross_ref_seed_dir_blocks(
            [
                ("docs:hot", 1000.0),
                ("docs:warm", 500.0),
                ("docs:cool", 100.0),
            ]
        )
        items = tracker.get_all_items()
        assert items["docs:hot"].tier == Tier.L3
        assert items["docs:warm"].tier == Tier.L2
        assert items["docs:cool"].tier == Tier.L1

    def test_placeholder_hash_and_tokens(self) -> None:
        """Seeded items get placeholder state, not real counts."""
        tracker = StabilityTracker()
        tracker.cross_ref_seed_dir_blocks([("docs:guide", 1000.0)])
        item = tracker.get_all_items()["docs:guide"]
        assert item.content_hash == _PLACEHOLDER_HASH
        assert item.tokens == _PLACEHOLDER_TOKENS

    def test_marks_destination_tiers_broken(self) -> None:
        """Tiers receiving content are marked broken.

        Without this the next request's cache breakpoints
        would be computed against stale tier state.
        """
        tracker = StabilityTracker()
        tracker._broken_tiers.clear()
        tracker.cross_ref_seed_dir_blocks(
            [
                ("docs:a", 1000.0),
                ("docs:b", 500.0),
                ("docs:c", 100.0),
            ]
        )
        assert Tier.L1 in tracker._broken_tiers
        assert Tier.L2 in tracker._broken_tiers
        assert Tier.L3 in tracker._broken_tiers

    def test_mixed_pre_existing_and_new(self) -> None:
        """Pre-existing key stays; new key distributes."""
        tracker = StabilityTracker()
        tracker._items["docs:old"] = TrackedItem(
            "docs:old", Tier.L0, n_value=12,
            content_hash="old-hash", tokens=200,
        )
        tracker.cross_ref_seed_dir_blocks(
            [
                ("docs:old", 100.0),
                ("docs:new", 1000.0),
            ]
        )
        old = tracker.get_all_items()["docs:old"]
        assert old.tier == Tier.L0
        assert old.content_hash == "old-hash"
        new = tracker.get_all_items()["docs:new"]
        assert new.tier in (Tier.L1, Tier.L2, Tier.L3)

    def test_all_keys_pre_existing_is_noop(self) -> None:
        """Every input key already tracked → no side effects."""
        tracker = StabilityTracker()
        tracker._items["docs:a"] = TrackedItem(
            "docs:a", Tier.L2, n_value=6,
            content_hash="h1", tokens=100,
        )
        tracker._broken_tiers.clear()
        tracker.cross_ref_seed_dir_blocks([("docs:a", 1000.0)])
        assert len(tracker.get_all_items()) == 1
        assert tracker._broken_tiers == set()
