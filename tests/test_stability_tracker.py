"""Tests for the StabilityTracker with 4-tier support."""

import json
import pytest
from pathlib import Path

from ac.context.stability_tracker import StabilityTracker, StabilityInfo


class TestStabilityTrackerInit:
    """Tests for StabilityTracker initialization."""
    
    def test_init_with_default_thresholds(self, tmp_path):
        """Default thresholds use legacy 2-tier mode."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json"
        )
        # Legacy mode: L1=3, L0=5
        assert tracker.get_thresholds() == {'L1': 3, 'L0': 5}
        assert tracker.get_tier_order() == ['L1', 'L0']
    
    def test_init_with_custom_thresholds(self, tmp_path):
        """Custom thresholds override legacy parameters."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        assert tracker.get_thresholds() == {'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        # Tier order is ascending by threshold
        assert tracker.get_tier_order() == ['L3', 'L2', 'L1', 'L0']
    
    def test_init_with_4_tier_bedrock_config(self, tmp_path):
        """4-tier Bedrock-optimized configuration."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12},
            initial_tier='L3'
        )
        assert len(tracker.get_thresholds()) == 4
        assert tracker._initial_tier == 'L3'
    
    def test_init_creates_parent_directory(self, tmp_path):
        """Persistence path parent directory is created on save."""
        nested_path = tmp_path / "subdir" / "stability.json"
        tracker = StabilityTracker(persistence_path=nested_path)
        tracker.save()
        assert nested_path.parent.exists()


class TestStabilityTrackerTierComputation:
    """Tests for tier computation logic."""
    
    def test_compute_tier_active(self, tmp_path):
        """Items with 0 stability are active."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        assert tracker._compute_tier(0) == 'active'
        assert tracker._compute_tier(1) == 'active'
        assert tracker._compute_tier(2) == 'active'
    
    def test_compute_tier_l3(self, tmp_path):
        """Items at L3 threshold get L3 tier."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        assert tracker._compute_tier(3) == 'L3'
        assert tracker._compute_tier(4) == 'L3'
        assert tracker._compute_tier(5) == 'L3'
    
    def test_compute_tier_l2(self, tmp_path):
        """Items at L2 threshold get L2 tier."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        assert tracker._compute_tier(6) == 'L2'
        assert tracker._compute_tier(7) == 'L2'
        assert tracker._compute_tier(8) == 'L2'
    
    def test_compute_tier_l1(self, tmp_path):
        """Items at L1 threshold get L1 tier."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        assert tracker._compute_tier(9) == 'L1'
        assert tracker._compute_tier(10) == 'L1'
        assert tracker._compute_tier(11) == 'L1'
    
    def test_compute_tier_l0(self, tmp_path):
        """Items at L0 threshold get L0 tier."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        assert tracker._compute_tier(12) == 'L0'
        assert tracker._compute_tier(100) == 'L0'
    
    def test_compute_tier_legacy_2_tier(self, tmp_path):
        """Legacy 2-tier mode works correctly."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            l1_threshold=3,
            l0_threshold=5
        )
        assert tracker._compute_tier(0) == 'active'
        assert tracker._compute_tier(2) == 'active'
        assert tracker._compute_tier(3) == 'L1'
        assert tracker._compute_tier(4) == 'L1'
        assert tracker._compute_tier(5) == 'L0'
        assert tracker._compute_tier(10) == 'L0'


class TestStabilityTrackerInitialization:
    """Tests for new item initialization."""
    
    def test_initialize_item_l3_tier(self, tmp_path):
        """New items start in L3 with greedy initialization."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12},
            initial_tier='L3'
        )
        info = tracker._initialize_item("test.py", "abc123")
        assert info.current_tier == 'L3'
        assert info.stable_count == 3  # L3 threshold
    
    def test_initialize_item_active_tier(self, tmp_path):
        """Items can start in active tier."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12},
            initial_tier='active'
        )
        info = tracker._initialize_item("test.py", "abc123")
        assert info.current_tier == 'active'
        assert info.stable_count == 0
    
    def test_initialize_item_l1_tier(self, tmp_path):
        """Items can start in L1 tier."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12},
            initial_tier='L1'
        )
        info = tracker._initialize_item("test.py", "abc123")
        assert info.current_tier == 'L1'
        assert info.stable_count == 9  # L1 threshold


class TestStabilityTrackerUpdate:
    """Tests for update_after_response."""
    
    def test_update_new_item(self, tmp_path):
        """New items are added and initialized."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12},
            initial_tier='L3'
        )
        
        content = {"test.py": "print('hello')"}
        changes = tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x]
        )
        
        assert "test.py" in changes
        assert changes["test.py"] == 'L3'
        assert tracker.get_tier("test.py") == 'L3'
    
    def test_update_unchanged_item_promotes(self, tmp_path):
        """Unchanged items get promoted over time."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12},
            initial_tier='L3'
        )
        
        content = {"test.py": "print('hello')"}
        
        # First update - initializes at L3 with count=3
        tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x]
        )
        assert tracker.get_tier("test.py") == 'L3'
        assert tracker.get_stable_count("test.py") == 3
        
        # 3 more updates to reach L2 threshold (6)
        for _ in range(3):
            tracker.update_after_response(
                items=["test.py"],
                get_content=lambda x: content[x]
            )
        
        assert tracker.get_tier("test.py") == 'L2'
        assert tracker.get_stable_count("test.py") == 6
    
    def test_update_modified_item_demotes(self, tmp_path):
        """Modified items are demoted to active."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12},
            initial_tier='L3'
        )
        
        content = {"test.py": "print('hello')"}
        
        # Initialize
        tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x]
        )
        assert tracker.get_tier("test.py") == 'L3'
        
        # Modify content
        content["test.py"] = "print('world')"
        changes = tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x]
        )
        
        assert changes["test.py"] == 'active'
        assert tracker.get_tier("test.py") == 'active'
        assert tracker.get_stable_count("test.py") == 0
    
    def test_update_with_modified_hint(self, tmp_path):
        """Modified hint forces demotion even if hash unchanged."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12},
            initial_tier='L3'
        )
        
        content = {"test.py": "print('hello')"}
        
        # Initialize
        tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x]
        )
        
        # Mark as modified even though content is same
        changes = tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x],
            modified=["test.py"]
        )
        
        assert changes["test.py"] == 'active'


class TestStabilityTrackerPromotionDemotion:
    """Tests for promotion/demotion tracking."""
    
    def test_track_promotions(self, tmp_path):
        """Promotions are tracked."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12},
            initial_tier='L3'
        )
        
        content = {"test.py": "print('hello')"}
        
        # Initialize at L3
        tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x]
        )
        
        # Promote to L2 (need 3 more updates)
        for _ in range(3):
            tracker.update_after_response(
                items=["test.py"],
                get_content=lambda x: content[x]
            )
        
        promotions = tracker.get_last_promotions()
        assert len(promotions) == 1
        assert promotions[0] == ("test.py", "L2")
    
    def test_track_demotions(self, tmp_path):
        """Demotions are tracked."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12},
            initial_tier='L3'
        )
        
        content = {"test.py": "print('hello')"}
        
        # Initialize
        tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x]
        )
        
        # Modify to demote
        content["test.py"] = "print('world')"
        tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x]
        )
        
        demotions = tracker.get_last_demotions()
        assert len(demotions) == 1
        assert demotions[0] == ("test.py", "active")
    
    def test_is_promotion(self, tmp_path):
        """_is_promotion correctly identifies promotions."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        # Promotions
        assert tracker._is_promotion('active', 'L3') is True
        assert tracker._is_promotion('L3', 'L2') is True
        assert tracker._is_promotion('L2', 'L1') is True
        assert tracker._is_promotion('L1', 'L0') is True
        
        # Demotions
        assert tracker._is_promotion('L0', 'L1') is False
        assert tracker._is_promotion('L3', 'active') is False
        assert tracker._is_promotion('L0', 'active') is False
        
        # Same tier
        assert tracker._is_promotion('L1', 'L1') is False


class TestStabilityTrackerGetItemsByTier:
    """Tests for get_items_by_tier."""
    
    def test_get_items_by_tier_empty(self, tmp_path):
        """Empty tracker returns empty tiers."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        result = tracker.get_items_by_tier()
        assert result == {'active': [], 'L3': [], 'L2': [], 'L1': [], 'L0': []}
    
    def test_get_items_by_tier_with_items(self, tmp_path):
        """Items are grouped by their tier."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12},
            initial_tier='L3'
        )
        
        content = {
            "a.py": "a",
            "b.py": "b",
            "c.py": "c"
        }
        
        # Initialize all at L3
        tracker.update_after_response(
            items=["a.py", "b.py", "c.py"],
            get_content=lambda x: content[x]
        )
        
        result = tracker.get_items_by_tier()
        assert set(result['L3']) == {"a.py", "b.py", "c.py"}
        assert result['active'] == []
    
    def test_get_items_by_tier_filtered(self, tmp_path):
        """Can filter to specific items."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12},
            initial_tier='L3'
        )
        
        content = {"a.py": "a", "b.py": "b", "c.py": "c"}
        
        tracker.update_after_response(
            items=["a.py", "b.py", "c.py"],
            get_content=lambda x: content[x]
        )
        
        # Only ask about a.py and b.py
        result = tracker.get_items_by_tier(items=["a.py", "b.py"])
        assert set(result['L3']) == {"a.py", "b.py"}
        assert "c.py" not in result['L3']
    
    def test_get_items_by_tier_sorted_by_stability(self, tmp_path):
        """Items within a tier are sorted by stable_count descending."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12},
            initial_tier='L3'
        )
        
        content = {"a.py": "a", "b.py": "b"}
        
        # Initialize both
        tracker.update_after_response(
            items=["a.py", "b.py"],
            get_content=lambda x: content[x]
        )
        
        # Update only a.py to increase its count
        tracker.update_after_response(
            items=["a.py"],
            get_content=lambda x: content[x]
        )
        
        result = tracker.get_items_by_tier(items=["a.py", "b.py"])
        # a.py should come first (higher count)
        assert result['L3'][0] == "a.py"


class TestStabilityTrackerPersistence:
    """Tests for save/load functionality."""
    
    def test_save_and_load(self, tmp_path):
        """Data persists across tracker instances."""
        path = tmp_path / "stability.json"
        
        # Create and populate tracker
        tracker1 = StabilityTracker(
            persistence_path=path,
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12},
            initial_tier='L3'
        )
        
        content = {"test.py": "print('hello')"}
        tracker1.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x]
        )
        
        # Create new tracker from same path
        tracker2 = StabilityTracker(
            persistence_path=path,
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12},
            initial_tier='L3'
        )
        
        assert tracker2.get_tier("test.py") == 'L3'
        assert tracker2.get_stable_count("test.py") == 3
    
    def test_clear_removes_file(self, tmp_path):
        """Clear removes persistence file."""
        path = tmp_path / "stability.json"
        
        tracker = StabilityTracker(
            persistence_path=path,
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        content = {"test.py": "hello"}
        tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x]
        )
        
        assert path.exists()
        
        tracker.clear()
        
        assert not path.exists()
        assert tracker.get_tier("test.py") == 'active'
    
    def test_load_handles_corrupted_file(self, tmp_path):
        """Corrupted persistence file is handled gracefully."""
        path = tmp_path / "stability.json"
        path.write_text("not valid json {{{")
        
        # Should not raise, just start fresh
        tracker = StabilityTracker(
            persistence_path=path,
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        assert tracker._response_count == 0
        assert len(tracker._stability) == 0


class TestStabilityTrackerFullPromotion:
    """Integration tests for full promotion path."""
    
    def test_promote_through_all_tiers(self, tmp_path):
        """Item promotes from L3 through L0."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12},
            initial_tier='L3'
        )
        
        content = {"test.py": "stable content"}
        
        # Initialize - should be L3 with count=3
        tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x]
        )
        assert tracker.get_tier("test.py") == 'L3'
        
        # 3 more updates -> L2 (count=6)
        for _ in range(3):
            tracker.update_after_response(
                items=["test.py"],
                get_content=lambda x: content[x]
            )
        assert tracker.get_tier("test.py") == 'L2'
        
        # 3 more updates -> L1 (count=9)
        for _ in range(3):
            tracker.update_after_response(
                items=["test.py"],
                get_content=lambda x: content[x]
            )
        assert tracker.get_tier("test.py") == 'L1'
        
        # 3 more updates -> L0 (count=12)
        for _ in range(3):
            tracker.update_after_response(
                items=["test.py"],
                get_content=lambda x: content[x]
            )
        assert tracker.get_tier("test.py") == 'L0'
        assert tracker.get_stable_count("test.py") == 12
    
    def test_demote_from_l0_to_active(self, tmp_path):
        """Modified L0 item drops to active."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12},
            initial_tier='L3'
        )
        
        content = {"test.py": "stable content"}
        
        # Promote to L0
        tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x]
        )
        for _ in range(9):  # 3+9=12 total
            tracker.update_after_response(
                items=["test.py"],
                get_content=lambda x: content[x]
            )
        assert tracker.get_tier("test.py") == 'L0'
        
        # Modify - should drop to active
        content["test.py"] = "changed!"
        tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x]
        )
        
        assert tracker.get_tier("test.py") == 'active'
        assert tracker.get_stable_count("test.py") == 0
        
        demotions = tracker.get_last_demotions()
        assert ("test.py", "active") in demotions
