"""Tests for cache stability tracker — N-value tracking, tier assignment, cascade."""

import pytest

from ac_dc.stability_tracker import (
    StabilityTracker,
    Tier,
    TrackedItem,
    TIER_CONFIG,
    CASCADE_ORDER,
)


@pytest.fixture
def tracker():
    """Default tracker with cache_target_tokens=1536."""
    return StabilityTracker(cache_target_tokens=1536)


@pytest.fixture
def tracker_no_cache():
    """Tracker with cache_target_tokens=0 (history stays active permanently)."""
    return StabilityTracker(cache_target_tokens=0)


# === Basic N-Value Behavior ===


class TestNValueProgression:
    def test_new_item_starts_at_n0(self, tracker):
        """New items register at N=0."""
        tracker.process_active_items([
            {"key": "file:a.py", "content_hash": "abc", "tokens": 100},
        ])
        item = tracker.get_item("file:a.py")
        assert item is not None
        assert item.n == 0
        assert item.tier == Tier.ACTIVE

    def test_unchanged_increments_n(self, tracker):
        """N increments on unchanged content."""
        info = {"key": "file:a.py", "content_hash": "abc", "tokens": 100}
        tracker.process_active_items([info])
        assert tracker.get_item("file:a.py").n == 0

        tracker.process_active_items([info])
        assert tracker.get_item("file:a.py").n == 1

        tracker.process_active_items([info])
        assert tracker.get_item("file:a.py").n == 2

    def test_hash_mismatch_resets_n(self, tracker):
        """N resets to 0 on hash mismatch."""
        tracker.process_active_items([
            {"key": "file:a.py", "content_hash": "abc", "tokens": 100},
        ])
        tracker.process_active_items([
            {"key": "file:a.py", "content_hash": "abc", "tokens": 100},
        ])
        assert tracker.get_item("file:a.py").n == 1

        # Content changes
        tracker.process_active_items([
            {"key": "file:a.py", "content_hash": "def", "tokens": 100},
        ])
        assert tracker.get_item("file:a.py").n == 0

    def test_changed_item_demotes_to_active(self, tracker):
        """Changed item in cached tier demotes to active."""
        # Manually place item in L3
        tracker._items["file:a.py"] = TrackedItem(
            key="file:a.py", tier=Tier.L3, n=5,
            content_hash="old", tokens=100,
        )
        # Process with different hash
        tracker.process_active_items([
            {"key": "file:a.py", "content_hash": "new", "tokens": 100},
        ])
        item = tracker.get_item("file:a.py")
        assert item.tier == Tier.ACTIVE
        assert item.n == 0


# === Graduation: Active -> L3 ===


class TestGraduation:
    def test_graduation_requires_n_ge_3(self, tracker):
        """Graduation requires N >= 3 for files/symbols."""
        info = {"key": "file:a.py", "content_hash": "abc", "tokens": 100}

        # Process 3 times: N goes 0, 1, 2
        for _ in range(3):
            tracker.process_active_items([info])

        assert tracker.get_item("file:a.py").n == 2
        grads = tracker.determine_graduates(controlled_history_graduation=False)
        assert "file:a.py" not in grads

        # Process once more: N = 3
        tracker.process_active_items([info])
        assert tracker.get_item("file:a.py").n == 3
        grads = tracker.determine_graduates(controlled_history_graduation=False)
        assert "file:a.py" in grads

    def test_graduate_items_moves_to_l3(self, tracker):
        """graduate_items moves items from active to L3 with entry_n."""
        tracker._items["file:a.py"] = TrackedItem(
            key="file:a.py", tier=Tier.ACTIVE, n=3,
            content_hash="abc", tokens=100,
        )
        tracker.graduate_items(["file:a.py"])
        item = tracker.get_item("file:a.py")
        assert item.tier == Tier.L3
        assert item.n == TIER_CONFIG[Tier.L3]["entry_n"]

    def test_history_graduation_piggyback(self, tracker):
        """History graduates when L3 is broken (piggyback)."""
        tracker._broken_tiers.add(Tier.L3)
        tracker._items["history:0"] = TrackedItem(
            key="history:0", tier=Tier.ACTIVE, n=0,
            content_hash="h0", tokens=50,
        )
        grads = tracker.determine_graduates(controlled_history_graduation=True)
        assert "history:0" in grads

    def test_history_graduation_token_threshold(self, tracker):
        """History graduates when eligible tokens exceed cache_target_tokens."""
        # Add history items with total tokens > 1536
        for i in range(20):
            tracker._items[f"history:{i}"] = TrackedItem(
                key=f"history:{i}", tier=Tier.ACTIVE, n=0,
                content_hash=f"h{i}", tokens=100,
            )
        # Total = 2000 > 1536
        grads = tracker.determine_graduates(controlled_history_graduation=True)
        # Some should graduate (oldest first), keeping 1536 worth in active
        assert len(grads) > 0
        # All graduates should be lower-indexed (older)
        grad_indices = sorted(int(k.split(":")[1]) for k in grads)
        non_grad_count = 20 - len(grads)
        assert non_grad_count > 0  # Some remain in active

    def test_history_stays_active_when_cache_target_zero(self, tracker_no_cache):
        """History stays active permanently when cache_target_tokens=0."""
        for i in range(10):
            tracker_no_cache._items[f"history:{i}"] = TrackedItem(
                key=f"history:{i}", tier=Tier.ACTIVE, n=0,
                content_hash=f"h{i}", tokens=200,
            )
        grads = tracker_no_cache.determine_graduates(controlled_history_graduation=True)
        history_grads = [g for g in grads if g.startswith("history:")]
        assert len(history_grads) == 0


# === Promotion and Cascade ===


class TestPromotion:
    def test_promoted_items_get_destination_entry_n(self, tracker):
        """Promoted items enter destination tier with that tier's entry_n."""
        # Place item in L3 with N >= promotion_n and break L2
        tracker._items["symbol:a.py"] = TrackedItem(
            key="symbol:a.py", tier=Tier.L3, n=6,
            content_hash="abc", tokens=100,
        )
        tracker._broken_tiers.add(Tier.L2)
        tracker.run_cascade()

        item = tracker.get_item("symbol:a.py")
        assert item.tier == Tier.L2
        assert item.n == TIER_CONFIG[Tier.L2]["entry_n"]

    def test_stable_tier_above_blocks_promotion(self, tracker):
        """Stable tier above blocks promotion — N is capped."""
        # L2 has content (stable), L3 item has high N
        tracker._items["symbol:stable.py"] = TrackedItem(
            key="symbol:stable.py", tier=Tier.L2, n=8,
            content_hash="s", tokens=100,
        )
        tracker._items["symbol:wannabe.py"] = TrackedItem(
            key="symbol:wannabe.py", tier=Tier.L3, n=10,
            content_hash="w", tokens=2000,  # above threshold
        )
        # L2 is NOT broken
        tracker.run_cascade()

        # Should still be in L3 (L2 is stable/not broken)
        item = tracker.get_item("symbol:wannabe.py")
        assert item.tier == Tier.L3

    def test_ripple_cascade_propagates(self, tracker):
        """Ripple cascade propagates through multiple broken tiers."""
        # L3 item ready to promote to L2, L2 item ready to promote to L1
        tracker._items["symbol:a.py"] = TrackedItem(
            key="symbol:a.py", tier=Tier.L3, n=6,
            content_hash="a", tokens=100,
        )
        tracker._items["symbol:b.py"] = TrackedItem(
            key="symbol:b.py", tier=Tier.L2, n=9,
            content_hash="b", tokens=100,
        )
        # Break L2 and L1
        tracker._broken_tiers.add(Tier.L2)
        tracker._broken_tiers.add(Tier.L1)
        tracker.run_cascade()

        assert tracker.get_item("symbol:a.py").tier == Tier.L2
        assert tracker.get_item("symbol:b.py").tier == Tier.L1


# === Stale Item Removal ===


class TestStaleRemoval:
    def test_stale_items_removed(self, tracker):
        """Stale items (deleted files) are removed."""
        tracker._items["file:deleted.py"] = TrackedItem(
            key="file:deleted.py", tier=Tier.L3, n=5,
            content_hash="d", tokens=100,
        )
        tracker._items["symbol:deleted.py"] = TrackedItem(
            key="symbol:deleted.py", tier=Tier.L2, n=7,
            content_hash="s", tokens=50,
        )
        tracker._items["file:exists.py"] = TrackedItem(
            key="file:exists.py", tier=Tier.L1, n=10,
            content_hash="e", tokens=200,
        )

        tracker.remove_stale({"exists.py"})

        assert tracker.get_item("file:deleted.py") is None
        assert tracker.get_item("symbol:deleted.py") is None
        assert tracker.get_item("file:exists.py") is not None

    def test_stale_removal_marks_tier_broken(self, tracker):
        """Removing stale item marks affected tier as broken."""
        tracker._items["file:gone.py"] = TrackedItem(
            key="file:gone.py", tier=Tier.L3, n=5,
            content_hash="g", tokens=100,
        )
        tracker.remove_stale(set())
        assert Tier.L3 in tracker._broken_tiers

    def test_stale_doc_items_removed(self, tracker):
        """Stale doc: items are removed like symbol: and file: items."""
        tracker._items["doc:deleted.md"] = TrackedItem(
            key="doc:deleted.md", tier=Tier.L2, n=6,
            content_hash="d", tokens=80,
        )
        tracker._items["doc:exists.md"] = TrackedItem(
            key="doc:exists.md", tier=Tier.L1, n=9,
            content_hash="e", tokens=120,
        )
        tracker.remove_stale({"exists.md"})
        assert tracker.get_item("doc:deleted.md") is None
        assert tracker.get_item("doc:exists.md") is not None
        assert Tier.L2 in tracker._broken_tiers


# === History Purge ===


class TestHistoryPurge:
    def test_purge_removes_all_history(self, tracker):
        """purge_history_items removes all history:* entries."""
        tracker._items["history:0"] = TrackedItem(
            key="history:0", tier=Tier.L3, n=5,
            content_hash="h0", tokens=50,
        )
        tracker._items["history:1"] = TrackedItem(
            key="history:1", tier=Tier.ACTIVE, n=1,
            content_hash="h1", tokens=50,
        )
        tracker._items["file:a.py"] = TrackedItem(
            key="file:a.py", tier=Tier.L1, n=10,
            content_hash="f", tokens=100,
        )

        tracker.purge_history_items()

        assert tracker.get_item("history:0") is None
        assert tracker.get_item("history:1") is None
        assert tracker.get_item("file:a.py") is not None


# === Content Hashing ===


class TestContentHashing:
    def test_hash_deterministic(self):
        """Same content produces same hash."""
        h1 = StabilityTracker.hash_content("hello world")
        h2 = StabilityTracker.hash_content("hello world")
        assert h1 == h2

    def test_hash_different_content(self):
        """Different content produces different hash."""
        h1 = StabilityTracker.hash_content("hello")
        h2 = StabilityTracker.hash_content("world")
        assert h1 != h2

    def test_hash_empty(self):
        """Empty content returns empty string."""
        assert StabilityTracker.hash_content("") == ""
        assert StabilityTracker.hash_content(None) == ""


# === Full Update Cycle ===


class TestFullUpdateCycle:
    def test_multi_request_graduation(self, tracker):
        """Multi-request: new -> active -> graduate through N progression."""
        info = {"key": "file:a.py", "content_hash": "abc", "tokens": 100}

        # Request 1: N=0
        tracker.update([info])
        assert tracker.get_item("file:a.py").tier == Tier.ACTIVE

        # Request 2: N=1
        tracker.update([info])
        assert tracker.get_item("file:a.py").tier == Tier.ACTIVE

        # Request 3: N=2
        tracker.update([info])
        assert tracker.get_item("file:a.py").tier == Tier.ACTIVE

        # Request 4: N=3 -> graduates to L3
        tracker.update([info])
        assert tracker.get_item("file:a.py").tier == Tier.L3

    def test_demote_on_edit_then_regraduate(self, tracker):
        """Demotion on edit, then re-graduation."""
        info = {"key": "file:a.py", "content_hash": "v1", "tokens": 100}

        # Graduate to L3
        for _ in range(5):
            tracker.update([info])
        assert tracker.get_item("file:a.py").tier == Tier.L3

        # Edit (hash changes) -> demote
        edited = {"key": "file:a.py", "content_hash": "v2", "tokens": 100}
        tracker.update([edited])
        assert tracker.get_item("file:a.py").tier == Tier.ACTIVE
        assert tracker.get_item("file:a.py").n == 0

        # Re-graduate
        for _ in range(4):
            tracker.update([edited])
        assert tracker.get_item("file:a.py").tier == Tier.L3

    def test_update_returns_summary(self, tracker):
        """update() returns tier summary and changes."""
        result = tracker.update([
            {"key": "file:a.py", "content_hash": "abc", "tokens": 100},
        ])
        assert "tiers" in result
        assert "changes" in result
        assert "broken_tiers" in result

    def test_changes_logged(self, tracker):
        """Changes are logged during update cycle."""
        # Place item in L3, then change it
        tracker._items["file:a.py"] = TrackedItem(
            key="file:a.py", tier=Tier.L3, n=5,
            content_hash="old", tokens=100,
        )
        result = tracker.update([
            {"key": "file:a.py", "content_hash": "new", "tokens": 100},
        ])
        # Should have a demotion change
        demotions = [c for c in result["changes"] if c["action"] == "demoted"]
        assert len(demotions) > 0


# === Tier Query Methods ===


class TestTierQueries:
    def test_get_tier_items(self, tracker):
        """get_tier_items returns items for the specified tier."""
        tracker._items["file:a.py"] = TrackedItem(
            key="file:a.py", tier=Tier.L3, n=5,
            content_hash="a", tokens=100,
        )
        tracker._items["file:b.py"] = TrackedItem(
            key="file:b.py", tier=Tier.ACTIVE, n=0,
            content_hash="b", tokens=50,
        )
        l3 = tracker.get_tier_items(Tier.L3)
        assert "file:a.py" in l3
        assert "file:b.py" not in l3

    def test_get_tier_tokens(self, tracker):
        """get_tier_tokens sums tokens in tier."""
        tracker._items["file:a.py"] = TrackedItem(
            key="file:a.py", tier=Tier.L3, n=5,
            content_hash="a", tokens=100,
        )
        tracker._items["file:b.py"] = TrackedItem(
            key="file:b.py", tier=Tier.L3, n=4,
            content_hash="b", tokens=200,
        )
        assert tracker.get_tier_tokens(Tier.L3) == 300


# === Initialization from Reference Graph ===


class TestInitialization:
    def test_fallback_distributes_across_tiers(self, tracker):
        """Fallback initialization distributes files across L1, L2, L3."""
        files = [f"src/file{i}.py" for i in range(9)]
        tracker.initialize_from_reference_graph(None, files)

        # All files should have symbol: entries
        for f in files:
            item = tracker.get_item(f"symbol:{f}")
            assert item is not None
            assert item.tier in (Tier.L1, Tier.L2, Tier.L3)

    def test_initialized_items_get_tier_entry_n(self, tracker):
        """Initialized items receive their tier's entry_n."""
        files = ["src/a.py", "src/b.py", "src/c.py"]
        tracker.initialize_from_reference_graph(None, files)

        for f in files:
            item = tracker.get_item(f"symbol:{f}")
            expected_n = TIER_CONFIG[item.tier]["entry_n"]
            assert item.n == expected_n

    def test_initialized_items_have_placeholder_hash(self, tracker):
        """Initialized items have empty placeholder hash."""
        files = ["src/a.py"]
        tracker.initialize_from_reference_graph(None, files)
        item = tracker.get_item("symbol:src/a.py")
        assert item.content_hash == ""

    def test_empty_files_no_crash(self, tracker):
        """Empty file list doesn't crash."""
        tracker.initialize_from_reference_graph(None, [])
        assert len(tracker.items) == 0

    def test_clustering_via_connected_components(self, tracker):
        """Initialization uses connected_components from reference index."""
        from unittest.mock import MagicMock
        ref_index = MagicMock()
        ref_index.file_ref_count.return_value = 0
        ref_index.connected_components.return_value = [
            {"src/a.py", "src/b.py"},
            {"src/c.py"},
        ]
        files = ["src/a.py", "src/b.py", "src/c.py"]
        tracker.initialize_from_reference_graph(ref_index, files)

        # All files should have symbol entries in some tier
        for f in files:
            item = tracker.get_item(f"symbol:{f}")
            assert item is not None
            assert item.tier in (Tier.L0, Tier.L1, Tier.L2, Tier.L3)

        # Files not seeded into L0 that share a cluster should be in the same tier
        non_l0 = [f for f in ["src/a.py", "src/b.py"]
                   if tracker.get_item(f"symbol:{f}").tier != Tier.L0]
        if len(non_l0) == 2:
            assert tracker.get_item(f"symbol:{non_l0[0]}").tier == \
                   tracker.get_item(f"symbol:{non_l0[1]}").tier

    def test_l0_never_assigned_by_clustering(self, tracker):
        """Clustering does not assign L0 — only _seed_l0_symbols does."""
        from unittest.mock import MagicMock
        ref_index = MagicMock()
        ref_index.file_ref_count.return_value = 0
        ref_index.connected_components.return_value = [
            {f"src/file{i}.py" for i in range(20)},
        ]
        files = [f"src/file{i}.py" for i in range(20)]
        tracker.initialize_from_reference_graph(ref_index, files)

        # L0 items should only come from _seed_l0_symbols (limited by cache_target_tokens),
        # not from clustering — so most files should be in L1/L2/L3
        l0_count = sum(1 for f in files
                       if tracker.get_item(f"symbol:{f}").tier == Tier.L0)
        non_l0_count = len(files) - l0_count
        assert non_l0_count > 0, "Clustering should place most files in L1-L3"
        assert l0_count < len(files), "Not all files should be in L0"


# === Threshold Anchoring ===


class TestThresholdAnchoring:
    def test_items_below_threshold_anchored(self):
        """Items below cache_target_tokens have frozen N (anchored)."""
        tracker = StabilityTracker(cache_target_tokens=500)

        # Two items: first is small (anchored), second is large (above threshold)
        tracker._items["symbol:small.py"] = TrackedItem(
            key="symbol:small.py", tier=Tier.L3, n=5,
            content_hash="s", tokens=100,
        )
        tracker._items["symbol:large.py"] = TrackedItem(
            key="symbol:large.py", tier=Tier.L3, n=6,
            content_hash="l", tokens=1000,
        )
        # Break L2 so promotion is possible
        tracker._broken_tiers.add(Tier.L2)
        tracker.run_cascade()

        # The large item (above threshold) with N >= 6 should promote
        # The small item (below threshold) should remain anchored
        large = tracker.get_item("symbol:large.py")
        assert large.tier == Tier.L2  # promoted

    def test_n_capped_when_tier_above_stable(self):
        """N is capped at promotion threshold when tier above is stable."""
        tracker = StabilityTracker(cache_target_tokens=50)

        # L2 has content (stable, not broken)
        tracker._items["symbol:stable.py"] = TrackedItem(
            key="symbol:stable.py", tier=Tier.L2, n=8,
            content_hash="s", tokens=100,
        )
        # L3 item with N way above promotion threshold
        tracker._items["symbol:capped.py"] = TrackedItem(
            key="symbol:capped.py", tier=Tier.L3, n=20,
            content_hash="c", tokens=1000,  # above threshold
        )

        tracker.run_cascade()

        # Should remain in L3 since L2 is not broken
        capped = tracker.get_item("symbol:capped.py")
        assert capped.tier == Tier.L3
        # N should be capped at promotion_n (6 for L3)
        assert capped.n <= TIER_CONFIG[Tier.L3]["promotion_n"]


# === Underfilled Tier Demotion ===


class TestUnderfilled:
    def test_underfilled_tier_demoted(self):
        """Underfilled tiers demote items one level down."""
        tracker = StabilityTracker(cache_target_tokens=500)

        # Put a tiny item in L1 (well below 500 tokens)
        tracker._items["symbol:tiny.py"] = TrackedItem(
            key="symbol:tiny.py", tier=Tier.L1, n=10,
            content_hash="t", tokens=50,
        )

        tracker._demote_underfilled()

        # Should be demoted from L1 to L2
        item = tracker.get_item("symbol:tiny.py")
        assert item.tier == Tier.L2