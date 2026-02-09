"""Tests for the stability tracker and cache tiering system."""

import pytest
from ac_dc.stability_tracker import (
    StabilityTracker, Tier, ItemType, TrackedItem, TierChange,
    TIER_CONFIG, _hash_content, cluster_for_tiers,
)


class TestHashContent:

    def test_deterministic(self):
        assert _hash_content("hello") == _hash_content("hello")

    def test_different_content(self):
        assert _hash_content("hello") != _hash_content("world")

    def test_length(self):
        assert len(_hash_content("test")) == 16


class TestTierConfig:

    def test_all_tiers_configured(self):
        for tier in Tier:
            assert tier in TIER_CONFIG

    def test_entry_n_ordering(self):
        assert TIER_CONFIG[Tier.L0]["entry_n"] > TIER_CONFIG[Tier.L1]["entry_n"]
        assert TIER_CONFIG[Tier.L1]["entry_n"] > TIER_CONFIG[Tier.L2]["entry_n"]
        assert TIER_CONFIG[Tier.L2]["entry_n"] > TIER_CONFIG[Tier.L3]["entry_n"]
        assert TIER_CONFIG[Tier.L3]["entry_n"] > TIER_CONFIG[Tier.ACTIVE]["entry_n"]

    def test_l0_no_promotion(self):
        assert TIER_CONFIG[Tier.L0]["promotion_n"] is None


class TestTrackedItem:

    def test_defaults(self):
        item = TrackedItem(key="file:test.py", item_type=ItemType.FILE)
        assert item.tier == Tier.ACTIVE
        assert item.n == 0
        assert item.content_hash == ""
        assert item.token_estimate == 0


class TestTierChange:

    def test_promotion(self):
        tc = TierChange("k", "file", Tier.L3, Tier.L2)
        assert tc.is_promotion
        assert not tc.is_demotion

    def test_demotion(self):
        tc = TierChange("k", "file", Tier.L2, Tier.ACTIVE)
        assert not tc.is_promotion
        assert tc.is_demotion


class TestStabilityTrackerBasics:

    def test_empty_tracker(self):
        st = StabilityTracker()
        assert st.item_count == 0
        assert st.get_tier_items(Tier.ACTIVE) == []
        assert st.get_tier_tokens(Tier.L0) == 0

    def test_register_new_item(self):
        st = StabilityTracker()
        st.register_item("file:a.py", ItemType.FILE, "hash1", 100)
        item = st.get_item("file:a.py")
        assert item is not None
        assert item.tier == Tier.ACTIVE
        assert item.content_hash == "hash1"
        assert item.token_estimate == 100

    def test_register_updates_hash(self):
        st = StabilityTracker()
        st.register_item("file:a.py", ItemType.FILE, "hash1", 100)
        st.register_item("file:a.py", ItemType.FILE, "hash2", 100)
        # Content changed — should demote
        item = st.get_item("file:a.py")
        assert item.tier == Tier.ACTIVE
        assert item.n == 0

    def test_register_same_hash_no_change(self):
        st = StabilityTracker()
        st.register_item("file:a.py", ItemType.FILE, "hash1", 100)
        st.register_item("file:a.py", ItemType.FILE, "hash1", 100)
        item = st.get_item("file:a.py")
        assert item.content_hash == "hash1"

    def test_get_changes_consumed(self):
        st = StabilityTracker()
        changes = st.get_changes()
        assert changes == []


class TestPhase0Stale:

    def test_removes_stale_files(self):
        st = StabilityTracker()
        st.register_item("file:a.py", ItemType.FILE, "h", 100)
        st.register_item("file:b.py", ItemType.FILE, "h", 100)

        st.update_after_response(
            active_items={},
            modified_files=[],
            all_repo_files={"a.py"},  # b.py no longer exists
        )
        assert st.get_item("file:b.py") is None
        assert st.get_item("file:a.py") is not None

    def test_removes_stale_symbols(self):
        st = StabilityTracker()
        st.register_item("symbol:a.py", ItemType.SYMBOL, "h", 100)

        st.update_after_response(
            active_items={},
            modified_files=[],
            all_repo_files=set(),  # a.py gone
        )
        assert st.get_item("symbol:a.py") is None


class TestPhase1ActiveProcessing:

    def test_new_item_registered(self):
        st = StabilityTracker()
        st.update_after_response(
            active_items={
                "file:a.py": {"hash": "h1", "tokens": 100, "type": ItemType.FILE},
            },
            modified_files=[],
            all_repo_files={"a.py"},
        )
        item = st.get_item("file:a.py")
        assert item is not None
        assert item.tier == Tier.ACTIVE
        assert item.n == 0

    def test_unchanged_increments_n(self):
        st = StabilityTracker()
        active = {"file:a.py": {"hash": "h1", "tokens": 100, "type": ItemType.FILE}}

        # First request
        st.update_after_response(active, [], {"a.py"})
        assert st.get_item("file:a.py").n == 0

        # Second request — same hash
        st.update_after_response(active, [], {"a.py"})
        assert st.get_item("file:a.py").n == 1

        # Third
        st.update_after_response(active, [], {"a.py"})
        assert st.get_item("file:a.py").n == 2

    def test_content_change_resets_n(self):
        st = StabilityTracker()
        st.update_after_response(
            {"file:a.py": {"hash": "h1", "tokens": 100, "type": ItemType.FILE}},
            [], {"a.py"},
        )
        st.update_after_response(
            {"file:a.py": {"hash": "h1", "tokens": 100, "type": ItemType.FILE}},
            [], {"a.py"},
        )
        assert st.get_item("file:a.py").n == 1

        # Content changed
        st.update_after_response(
            {"file:a.py": {"hash": "h2", "tokens": 100, "type": ItemType.FILE}},
            [], {"a.py"},
        )
        assert st.get_item("file:a.py").n == 0

    def test_modified_file_demotes(self):
        st = StabilityTracker()
        # Put item in L3 via initialization
        st.initialize_from_reference_graph(
            [(Tier.L3, ["symbol:a.py"])],
            {"symbol:a.py": 100},
        )
        assert st.get_item("symbol:a.py").tier == Tier.L3

        # Modified file should demote
        st.update_after_response(
            {"symbol:a.py": {"hash": "h1", "tokens": 100, "type": ItemType.SYMBOL}},
            modified_files=["a.py"],
            all_repo_files={"a.py"},
        )
        assert st.get_item("symbol:a.py").tier == Tier.ACTIVE
        assert st.get_item("symbol:a.py").n == 0


class TestPhase2Graduation:

    def test_item_graduates_on_leaving_active(self):
        st = StabilityTracker()
        active = {"file:a.py": {"hash": "h1", "tokens": 100, "type": ItemType.FILE}}

        # Build up N ≥ 3
        for _ in range(4):
            st.update_after_response(active, [], {"a.py"})

        assert st.get_item("file:a.py").n == 3
        assert st.get_item("file:a.py").tier == Tier.ACTIVE

        # Now remove from active list — should graduate to L3
        st.update_after_response({}, [], {"a.py"})
        item = st.get_item("file:a.py")
        assert item.tier == Tier.L3
        assert item.n == TIER_CONFIG[Tier.L3]["entry_n"]

    def test_item_stays_active_while_selected(self):
        """Items don't auto-graduate while still in active list, even at high N."""
        st = StabilityTracker()
        active = {"file:a.py": {"hash": "h1", "tokens": 100, "type": ItemType.FILE}}

        for _ in range(20):
            st.update_after_response(active, [], {"a.py"})

        # Still in active despite high N
        assert st.get_item("file:a.py").tier == Tier.ACTIVE

    def test_low_n_does_not_graduate(self):
        st = StabilityTracker()
        active = {"file:a.py": {"hash": "h1", "tokens": 100, "type": ItemType.FILE}}

        # Only 2 unchanged appearances (N=1)
        st.update_after_response(active, [], {"a.py"})
        st.update_after_response(active, [], {"a.py"})

        # Remove from active — N < 3, should NOT graduate
        st.update_after_response({}, [], {"a.py"})
        item = st.get_item("file:a.py")
        assert item.tier == Tier.ACTIVE


class TestHistoryGraduation:

    def test_history_piggybacks_on_l3_break(self):
        """History graduates when L3 is already broken."""
        st = StabilityTracker()

        # Create a file that will graduate to L3, breaking it
        file_active = {"file:a.py": {"hash": "h1", "tokens": 100, "type": ItemType.FILE}}
        hist_active = {"history:0": {"hash": "hh", "tokens": 50, "type": ItemType.HISTORY}}
        combined = {**file_active, **hist_active}

        # Build up N for file
        for _ in range(4):
            st.update_after_response(combined, [], {"a.py"})

        # Now remove file from active (graduates to L3, breaking it)
        # History should piggyback
        st.update_after_response(hist_active, [], {"a.py"})

        # History should have graduated
        hist_item = st.get_item("history:0")
        assert hist_item.tier == Tier.L3

    def test_history_token_threshold_graduation(self):
        """History graduates when eligible tokens exceed cache_target_tokens."""
        st = StabilityTracker(cache_target_tokens=100)

        # Create enough history to exceed threshold
        active = {}
        for i in range(10):
            active[f"history:{i}"] = {
                "hash": f"h{i}", "tokens": 50, "type": ItemType.HISTORY,
            }

        # First request — register all
        st.update_after_response(active, [], set())

        # Second request with fewer history items (some "left")
        # Keep only recent ones in active
        small_active = {f"history:{i}": active[f"history:{i}"] for i in range(8, 10)}
        st.update_after_response(small_active, [], set())

        # Oldest history items should have graduated
        graduated = [
            k for k, it in st.get_all_items().items()
            if it.item_type == ItemType.HISTORY and it.tier == Tier.L3
        ]
        assert len(graduated) > 0

    def test_history_no_graduation_when_disabled(self):
        """No history graduation when cache_target_tokens=0."""
        st = StabilityTracker(cache_target_tokens=0)

        active = {"history:0": {"hash": "h", "tokens": 50, "type": ItemType.HISTORY}}
        st.update_after_response(active, [], set())
        st.update_after_response({}, [], set())

        hist = st.get_item("history:0")
        assert hist.tier == Tier.ACTIVE


class TestPurgeHistory:

    def test_purge_removes_all_history(self):
        st = StabilityTracker()
        st.register_item("history:0", ItemType.HISTORY, "h", 50)
        st.register_item("history:1", ItemType.HISTORY, "h", 50)
        st.register_item("file:a.py", ItemType.FILE, "h", 100)

        st.purge_history_items()

        assert st.get_item("history:0") is None
        assert st.get_item("history:1") is None
        assert st.get_item("file:a.py") is not None


class TestInitialization:

    def test_initialize_from_clusters(self):
        st = StabilityTracker()
        st.initialize_from_reference_graph(
            [
                (Tier.L1, ["symbol:a.py", "symbol:b.py"]),
                (Tier.L2, ["symbol:c.py"]),
            ],
            {"symbol:a.py": 100, "symbol:b.py": 200, "symbol:c.py": 150},
        )

        assert st.get_item("symbol:a.py").tier == Tier.L1
        assert st.get_item("symbol:a.py").n == TIER_CONFIG[Tier.L1]["entry_n"]
        assert st.get_item("symbol:b.py").tier == Tier.L1
        assert st.get_item("symbol:c.py").tier == Tier.L2
        assert st.get_item("symbol:c.py").n == TIER_CONFIG[Tier.L2]["entry_n"]

    def test_initialize_sets_token_estimate(self):
        st = StabilityTracker()
        st.initialize_from_reference_graph(
            [(Tier.L1, ["symbol:a.py"])],
            {"symbol:a.py": 500},
        )
        assert st.get_item("symbol:a.py").token_estimate == 500


class TestCascade:

    def test_basic_graduation_to_l3(self):
        """Items entering L3 get the tier's entry_n."""
        st = StabilityTracker(cache_target_tokens=0)
        active = {"file:a.py": {"hash": "h1", "tokens": 100, "type": ItemType.FILE}}

        # Build up N
        for _ in range(4):
            st.update_after_response(active, [], {"a.py"})

        # Graduate
        st.update_after_response({}, [], {"a.py"})
        item = st.get_item("file:a.py")
        assert item.tier == Tier.L3
        assert item.n == TIER_CONFIG[Tier.L3]["entry_n"]

    def test_promotion_l3_to_l2(self):
        """Item in L3 with sufficient N promotes to L2 when L2 is broken."""
        st = StabilityTracker(cache_target_tokens=0)

        # Initialize an item directly in L3 with high N
        st._items["symbol:a.py"] = TrackedItem(
            key="symbol:a.py", item_type=ItemType.SYMBOL,
            tier=Tier.L3, n=5, content_hash="h", token_estimate=100,
        )
        # Break L2 by having an item there that we'll remove
        st._items["symbol:b.py"] = TrackedItem(
            key="symbol:b.py", item_type=ItemType.SYMBOL,
            tier=Tier.L2, n=6, content_hash="h", token_estimate=100,
        )

        # Update: b.py is gone (stale), which breaks L2
        # a.py should promote from L3 to L2
        st.update_after_response(
            active_items={},
            modified_files=[],
            all_repo_files={"a.py"},  # b.py is gone
        )

        item_a = st.get_item("symbol:a.py")
        # a.py should have been processed in the cascade
        # It needs promotion_n=6 to promote from L3 to L2
        # After N increment in cascade: 5 → 6 ≥ 6, so it promotes
        assert item_a.tier == Tier.L2

    def test_cascade_ripples_downward(self):
        """Promotion cascades: L3→L2 breaks L3, allowing active→L3."""
        st = StabilityTracker(cache_target_tokens=0)

        # L2 has an item that will be removed (breaking L2)
        st._items["symbol:gone.py"] = TrackedItem(
            key="symbol:gone.py", item_type=ItemType.SYMBOL,
            tier=Tier.L2, n=9, content_hash="h", token_estimate=100,
        )
        # L3 has a veteran ready to promote
        st._items["symbol:stable.py"] = TrackedItem(
            key="symbol:stable.py", item_type=ItemType.SYMBOL,
            tier=Tier.L3, n=5, content_hash="h", token_estimate=100,
        )
        # Active has an item ready to graduate
        active_item = {"file:grad.py": {"hash": "h", "tokens": 100, "type": ItemType.FILE}}
        st._items["file:grad.py"] = TrackedItem(
            key="file:grad.py", item_type=ItemType.FILE,
            tier=Tier.ACTIVE, n=5, content_hash="h", token_estimate=100,
        )
        st._prev_active_keys = {"file:grad.py"}

        # gone.py removed → L2 breaks → stable.py promotes L3→L2 → L3 breaks
        # → grad.py graduates active→L3
        st.update_after_response(
            active_items={},
            modified_files=[],
            all_repo_files={"stable.py", "grad.py"},
        )

        assert st.get_item("symbol:stable.py").tier == Tier.L2
        assert st.get_item("file:grad.py").tier == Tier.L3

    def test_no_promotion_into_stable_tier(self):
        """Items don't promote into a tier that isn't broken."""
        st = StabilityTracker(cache_target_tokens=0)

        # L2 has content and is not broken
        st._items["symbol:l2.py"] = TrackedItem(
            key="symbol:l2.py", item_type=ItemType.SYMBOL,
            tier=Tier.L2, n=6, content_hash="h", token_estimate=100,
        )
        # L3 has item with high N
        st._items["symbol:l3.py"] = TrackedItem(
            key="symbol:l3.py", item_type=ItemType.SYMBOL,
            tier=Tier.L3, n=10, content_hash="h", token_estimate=100,
        )

        st.update_after_response(
            active_items={},
            modified_files=[],
            all_repo_files={"l2.py", "l3.py"},
        )

        # L3 item should NOT promote because L2 is stable
        assert st.get_item("symbol:l3.py").tier == Tier.L3


class TestDemoteUnderfilled:

    def test_underfilled_tier_demotes(self):
        st = StabilityTracker(cache_target_tokens=500)

        # Put a tiny item in L2
        st._items["symbol:tiny.py"] = TrackedItem(
            key="symbol:tiny.py", item_type=ItemType.SYMBOL,
            tier=Tier.L2, n=6, content_hash="h", token_estimate=10,  # Way under 500
        )

        st.update_after_response({}, [], {"tiny.py"})

        # Should have been demoted to L3 (one tier down)
        assert st.get_item("symbol:tiny.py").tier == Tier.L3


class TestNValueCapping:

    def test_n_capped_when_tier_above_stable(self):
        """N is capped at promotion threshold when destination tier is stable."""
        st = StabilityTracker(cache_target_tokens=0)

        # L1 is stable (has content, not broken)
        st._items["symbol:l1.py"] = TrackedItem(
            key="symbol:l1.py", item_type=ItemType.SYMBOL,
            tier=Tier.L1, n=9, content_hash="h", token_estimate=100,
        )
        # L2 item at promotion threshold
        st._items["symbol:l2.py"] = TrackedItem(
            key="symbol:l2.py", item_type=ItemType.SYMBOL,
            tier=Tier.L2, n=8, content_hash="h", token_estimate=100,
        )

        st.update_after_response({}, [], {"l1.py", "l2.py"})

        # L2 item's N should be capped at promotion_n (9) since L1 is stable
        l2_item = st.get_item("symbol:l2.py")
        assert l2_item.n <= TIER_CONFIG[Tier.L2]["promotion_n"]
        assert l2_item.tier == Tier.L2  # Did NOT promote


class TestThresholdAnchoring:

    def test_anchored_items_n_frozen(self):
        """Items below the cache_target_tokens threshold have frozen N."""
        st = StabilityTracker(cache_target_tokens=200)

        # Two items in L3, one small (anchored), one large
        st._items["symbol:small.py"] = TrackedItem(
            key="symbol:small.py", item_type=ItemType.SYMBOL,
            tier=Tier.L3, n=3, content_hash="h", token_estimate=100,
        )
        st._items["symbol:large.py"] = TrackedItem(
            key="symbol:large.py", item_type=ItemType.SYMBOL,
            tier=Tier.L3, n=3, content_hash="h", token_estimate=500,
        )

        st.update_after_response({}, [], {"small.py", "large.py"})

        # small.py (100 tokens) fills the 200 threshold first → anchored (N frozen)
        # large.py (500 tokens) is past threshold → N incremented
        small = st.get_item("symbol:small.py")
        large = st.get_item("symbol:large.py")
        assert small.n == 3  # Frozen
        assert large.n == 4  # Incremented


class TestMultiRequestSequence:

    def test_full_lifecycle(self):
        """Simulate a multi-request lifecycle."""
        st = StabilityTracker(cache_target_tokens=0)

        # Request 1: File selected
        active1 = {"file:a.py": {"hash": "h1", "tokens": 100, "type": ItemType.FILE}}
        st.update_after_response(active1, [], {"a.py"})
        assert st.get_item("file:a.py").n == 0

        # Request 2-4: Same file, unchanged
        for _ in range(3):
            st.update_after_response(active1, [], {"a.py"})
        assert st.get_item("file:a.py").n == 3

        # Request 5: File deselected → graduates to L3
        st.update_after_response({}, [], {"a.py"})
        assert st.get_item("file:a.py").tier == Tier.L3

        # Request 6-10: File stays deselected, accumulating N in L3
        for _ in range(5):
            st.update_after_response({}, [], {"a.py"})

        # Request 11: File re-selected (content unchanged)
        st.update_after_response(active1, [], {"a.py"})
        # Should still be in L3 (being in active list doesn't demote)
        item = st.get_item("file:a.py")
        assert item.tier in (Tier.L3, Tier.L2, Tier.L1)  # May have promoted

    def test_content_change_resets_everything(self):
        """Content change demotes from any tier."""
        st = StabilityTracker(cache_target_tokens=0)

        # Initialize in L1
        st.initialize_from_reference_graph(
            [(Tier.L1, ["symbol:a.py"])],
            {"symbol:a.py": 100},
        )
        assert st.get_item("symbol:a.py").tier == Tier.L1

        # Content change
        st.update_after_response(
            {"symbol:a.py": {"hash": "new_hash", "tokens": 100, "type": ItemType.SYMBOL}},
            [], {"a.py"},
        )
        assert st.get_item("symbol:a.py").tier == Tier.ACTIVE
        assert st.get_item("symbol:a.py").n == 0


class TestClusterForTiers:
    """Test reference graph clustering for tier initialization."""

    def test_empty_index(self):
        """No symbols = no clusters."""
        from unittest.mock import MagicMock

        ref_index = MagicMock()
        ref_index.connected_components.return_value = []

        symbol_index = MagicMock()
        symbol_index.all_symbols = {}
        symbol_index.get_file_block.return_value = ""

        result = cluster_for_tiers(ref_index, symbol_index, 1536)
        assert result == []

    def test_basic_clustering(self):
        from unittest.mock import MagicMock

        ref_index = MagicMock()
        ref_index.connected_components.return_value = [
            {"a.py", "b.py"},
            {"c.py", "d.py"},
        ]

        symbol_index = MagicMock()
        symbol_index.all_symbols = {
            "a.py": None, "b.py": None, "c.py": None,
            "d.py": None, "e.py": None,
        }
        symbol_index.get_file_block.return_value = "x" * 400  # ~100 tokens each

        result = cluster_for_tiers(ref_index, symbol_index, 100)
        assert len(result) > 0

        # All files should be assigned somewhere
        all_keys = set()
        for tier, keys in result:
            all_keys.update(keys)
        assert len(all_keys) == 5  # All 5 files

    def test_singletons_included(self):
        """Files not in any component are included as singletons."""
        from unittest.mock import MagicMock

        ref_index = MagicMock()
        ref_index.connected_components.return_value = []

        symbol_index = MagicMock()
        symbol_index.all_symbols = {"solo.py": None}
        symbol_index.get_file_block.return_value = "x" * 400

        result = cluster_for_tiers(ref_index, symbol_index, 100)
        all_keys = set()
        for _, keys in result:
            all_keys.update(keys)
        assert "symbol:solo.py" in all_keys
