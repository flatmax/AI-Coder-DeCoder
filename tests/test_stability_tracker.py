"""Tests for the StabilityTracker with ripple promotion."""

import json
import pytest
from pathlib import Path

from ac.context.stability_tracker import StabilityTracker, StabilityInfo, TIER_CONFIG


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


class TestStabilityTrackerRippleBasics:
    """Tests for basic ripple promotion behavior."""
    
    def test_new_item_starts_active(self, tmp_path):
        """New items in Active context start with tier='active', N=0."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        content = {"test.py": "print('hello')"}
        tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x]
        )
        
        assert tracker.get_tier("test.py") == 'active'
        assert tracker.get_n_value("test.py") == 0
    
    def test_item_leaving_active_enters_l3(self, tmp_path):
        """When item leaves Active context, it enters L3 with N=3."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        content = {"a.py": "a", "b.py": "b"}
        
        # Round 1: Both in Active
        tracker.update_after_response(
            items=["a.py", "b.py"],
            get_content=lambda x: content[x]
        )
        assert tracker.get_tier("a.py") == 'active'
        assert tracker.get_tier("b.py") == 'active'
        
        # Round 2: Only a.py in Active (b.py leaves)
        tracker.update_after_response(
            items=["a.py"],
            get_content=lambda x: content[x]
        )
        
        assert tracker.get_tier("a.py") == 'active'
        assert tracker.get_tier("b.py") == 'L3'
        assert tracker.get_n_value("b.py") == 3
    
    def test_modified_cached_item_returns_to_active(self, tmp_path):
        """Modified item in cache tier returns to Active with N=0."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        content = {"a.py": "a", "b.py": "b"}
        
        # Round 1: Both in Active
        tracker.update_after_response(
            items=["a.py", "b.py"],
            get_content=lambda x: content[x]
        )
        
        # Round 2: b.py leaves Active, enters L3
        tracker.update_after_response(
            items=["a.py"],
            get_content=lambda x: content[x]
        )
        assert tracker.get_tier("b.py") == 'L3'
        
        # Round 3: b.py modified (back in Active)
        content["b.py"] = "b modified"
        tracker.update_after_response(
            items=["a.py", "b.py"],
            get_content=lambda x: content[x]
        )
        
        assert tracker.get_tier("b.py") == 'active'
        assert tracker.get_n_value("b.py") == 0
    
    def test_legacy_compute_tier_still_works(self, tmp_path):
        """Legacy _compute_tier method works for backwards compatibility."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        assert tracker._compute_tier(0) == 'active'
        assert tracker._compute_tier(3) == 'L3'
        assert tracker._compute_tier(6) == 'L2'
        assert tracker._compute_tier(9) == 'L1'
        assert tracker._compute_tier(12) == 'L0'


class TestStabilityTrackerRipplePromotion:
    """Tests for ripple promotion cascading."""
    
    def test_entry_triggers_n_increment(self, tmp_path):
        """When item enters a tier, existing items get N++."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        content = {"a.py": "a", "b.py": "b", "c.py": "c"}
        
        # Round 1: All in Active
        tracker.update_after_response(
            items=["a.py", "b.py", "c.py"],
            get_content=lambda x: content[x]
        )
        
        # Round 2: b.py leaves Active, enters L3 (no existing items)
        tracker.update_after_response(
            items=["a.py", "c.py"],
            get_content=lambda x: content[x]
        )
        assert tracker.get_tier("b.py") == 'L3'
        assert tracker.get_n_value("b.py") == 3
        
        # Round 3: c.py leaves Active, enters L3 (b.py is there)
        tracker.update_after_response(
            items=["a.py"],
            get_content=lambda x: content[x]
        )
        assert tracker.get_tier("c.py") == 'L3'
        assert tracker.get_n_value("c.py") == 3
        # b.py should have gotten N++ when c.py entered
        assert tracker.get_n_value("b.py") == 4
    
    def test_promotion_at_threshold(self, tmp_path):
        """Item promotes when N reaches promotion threshold."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        # Use manual setup to avoid complexity of Active N++ behavior
        # Set up: 0.py is veteran in L3 with N=5 (one away from promotion)
        #         1.py is veteran in L3 with N=4
        #         trigger.py is in Active, will leave and enter L3
        tracker._stability = {
            "0.py": StabilityInfo(content_hash="0", n_value=5, tier='L3'),
            "1.py": StabilityInfo(content_hash="1", n_value=4, tier='L3'),
            "trigger.py": StabilityInfo(content_hash="t", n_value=0, tier='active'),
        }
        tracker._last_active_items = {"trigger.py"}
        
        content = {"0.py": "0", "1.py": "1", "trigger.py": "t", "other.py": "o"}
        
        # trigger.py leaves Active, enters L3
        # Veterans (0.py, 1.py) get N++
        # 0.py: N=6 -> reaches threshold, promotes to L2
        # 1.py: N=5
        tracker.update_after_response(
            items=["other.py"],
            get_content=lambda x: content[x]
        )
        
        assert tracker.get_tier("0.py") == 'L2'
        assert tracker.get_n_value("0.py") == 6
        assert tracker.get_tier("1.py") == 'L3'
        assert tracker.get_n_value("1.py") == 5
        assert tracker.get_tier("trigger.py") == 'L3'
        assert tracker.get_n_value("trigger.py") == 3
    
    def test_cascade_promotion(self, tmp_path):
        """Promotions cascade through tiers when veterans reach thresholds."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        # Manually set up items close to promotion thresholds
        # trigger.py must be in _stability to be tracked when leaving active
        tracker._stability = {
            "trigger.py": StabilityInfo(content_hash="trigger", n_value=0, tier='active'),
            "l3_item.py": StabilityInfo(content_hash="a", n_value=5, tier='L3'),  # N=5, promotes at 6
            "l2_item.py": StabilityInfo(content_hash="b", n_value=8, tier='L2'),  # N=8, promotes at 9
            "l1_item.py": StabilityInfo(content_hash="c", n_value=11, tier='L1'), # N=11, promotes at 12
        }
        tracker._last_active_items = {"trigger.py"}
        
        content = {"trigger.py": "trigger", "other.py": "other"}
        
        # Round: trigger.py leaves Active, enters L3 with N=3
        # - l3_item is veteran in L3, gets N++ -> N=6, promotes to L2
        # - l3_item entering L2 makes l2_item a veteran, gets N++ -> N=9, promotes to L1
        # - l2_item entering L1 makes l1_item a veteran, gets N++ -> N=12, promotes to L0
        tracker.update_after_response(
            items=["other.py"],
            get_content=lambda x: content.get(x, "")
        )
        
        # Check cascade results
        assert tracker.get_tier("trigger.py") == 'L3'
        assert tracker.get_n_value("trigger.py") == 3
        
        assert tracker.get_tier("l3_item.py") == 'L2'
        assert tracker.get_n_value("l3_item.py") == 6
        
        assert tracker.get_tier("l2_item.py") == 'L1'
        assert tracker.get_n_value("l2_item.py") == 9
        
        assert tracker.get_tier("l1_item.py") == 'L0'
        assert tracker.get_n_value("l1_item.py") == 12


class TestStabilityTrackerUpdate:
    """Tests for update_after_response."""
    
    def test_update_new_item_starts_active(self, tmp_path):
        """New items in Active context start as active."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        content = {"test.py": "print('hello')"}
        changes = tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x]
        )
        
        assert "test.py" in changes
        assert changes["test.py"] == 'active'
        assert tracker.get_tier("test.py") == 'active'
        assert tracker.get_n_value("test.py") == 0
    
    def test_update_item_leaves_active_enters_l3(self, tmp_path):
        """Items leaving Active enter L3 with N=3."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        content = {"test.py": "print('hello')", "other.py": "other"}
        
        # First update - test.py is active
        tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x]
        )
        assert tracker.get_tier("test.py") == 'active'
        
        # Second update - test.py leaves Active (not in items list)
        changes = tracker.update_after_response(
            items=["other.py"],
            get_content=lambda x: content[x]
        )
        
        assert tracker.get_tier("test.py") == 'L3'
        assert tracker.get_n_value("test.py") == 3
    
    def test_update_modified_item_demotes(self, tmp_path):
        """Modified items are demoted to active."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        # Set up item in L3
        tracker._stability = {
            "test.py": StabilityInfo(content_hash=tracker.compute_hash("original"), n_value=3, tier='L3')
        }
        tracker._last_active_items = set()
        
        content = {"test.py": "modified"}
        changes = tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x]
        )
        
        assert changes["test.py"] == 'active'
        assert tracker.get_tier("test.py") == 'active'
        assert tracker.get_n_value("test.py") == 0
    
    def test_update_with_modified_hint(self, tmp_path):
        """Modified hint forces demotion even if hash unchanged."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        content = {"test.py": "print('hello')"}
        
        # Set up item in L3
        tracker._stability = {
            "test.py": StabilityInfo(content_hash=tracker.compute_hash("print('hello')"), n_value=5, tier='L3')
        }
        tracker._last_active_items = set()
        
        # Mark as modified even though content hash is same
        changes = tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x],
            modified=["test.py"]
        )
        
        assert changes["test.py"] == 'active'
        assert tracker.get_n_value("test.py") == 0


class TestStabilityTrackerPromotionDemotion:
    """Tests for promotion/demotion tracking."""
    
    def test_track_promotions_on_tier_entry(self, tmp_path):
        """Promotions are tracked when items enter cache tiers."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        content = {"test.py": "hello", "other.py": "other"}
        
        # Round 1: test.py in Active
        tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x]
        )
        
        # Round 2: test.py leaves Active, enters L3
        tracker.update_after_response(
            items=["other.py"],
            get_content=lambda x: content[x]
        )
        
        promotions = tracker.get_last_promotions()
        assert len(promotions) == 1
        assert promotions[0] == ("test.py", "L3")
    
    def test_track_demotions(self, tmp_path):
        """Demotions are tracked when cached items are modified."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        # Set up item in L3
        tracker._stability = {
            "test.py": StabilityInfo(content_hash=tracker.compute_hash("original"), n_value=5, tier='L3')
        }
        tracker._last_active_items = set()
        
        content = {"test.py": "modified"}
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
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        # Set up items in different tiers
        tracker._stability = {
            "a.py": StabilityInfo(content_hash="a", n_value=3, tier='L3'),
            "b.py": StabilityInfo(content_hash="b", n_value=6, tier='L2'),
            "c.py": StabilityInfo(content_hash="c", n_value=0, tier='active'),
        }
        
        result = tracker.get_items_by_tier()
        assert result['L3'] == ["a.py"]
        assert result['L2'] == ["b.py"]
        assert result['active'] == ["c.py"]
    
    def test_get_items_by_tier_filtered(self, tmp_path):
        """Can filter to specific items."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        tracker._stability = {
            "a.py": StabilityInfo(content_hash="a", n_value=3, tier='L3'),
            "b.py": StabilityInfo(content_hash="b", n_value=4, tier='L3'),
            "c.py": StabilityInfo(content_hash="c", n_value=5, tier='L3'),
        }
        
        # Only ask about a.py and b.py
        result = tracker.get_items_by_tier(items=["a.py", "b.py"])
        assert set(result['L3']) == {"a.py", "b.py"}
        assert "c.py" not in result['L3']
    
    def test_get_items_by_tier_sorted_by_n_value(self, tmp_path):
        """Items within a tier are sorted by n_value descending."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        tracker._stability = {
            "a.py": StabilityInfo(content_hash="a", n_value=5, tier='L3'),
            "b.py": StabilityInfo(content_hash="b", n_value=3, tier='L3'),
        }
        
        result = tracker.get_items_by_tier()
        # a.py should come first (higher n_value)
        assert result['L3'] == ["a.py", "b.py"]


class TestStabilityTrackerPersistence:
    """Tests for save/load functionality."""
    
    def test_save_and_load(self, tmp_path):
        """Data persists across tracker instances."""
        path = tmp_path / "stability.json"
        
        # Create and populate tracker
        tracker1 = StabilityTracker(
            persistence_path=path,
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        tracker1._stability = {
            "test.py": StabilityInfo(content_hash="abc", n_value=5, tier='L3')
        }
        tracker1._last_active_items = {"other.py"}
        tracker1._response_count = 10
        tracker1.save()
        
        # Create new tracker from same path
        tracker2 = StabilityTracker(
            persistence_path=path,
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        assert tracker2.get_tier("test.py") == 'L3'
        assert tracker2.get_n_value("test.py") == 5
        assert tracker2._response_count == 10
        assert "other.py" in tracker2._last_active_items
    
    def test_clear_removes_file(self, tmp_path):
        """Clear removes persistence file."""
        path = tmp_path / "stability.json"
        
        tracker = StabilityTracker(
            persistence_path=path,
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        tracker._stability = {
            "test.py": StabilityInfo(content_hash="abc", n_value=3, tier='L3')
        }
        tracker.save()
        
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
    
    def test_load_migrates_old_format(self, tmp_path):
        """Old format with stable_count/current_tier is migrated."""
        path = tmp_path / "stability.json"
        
        # Write old format
        old_data = {
            "response_count": 5,
            "last_reorg_response": 0,
            "items": {
                "test.py": {
                    "content_hash": "abc123",
                    "stable_count": 7,
                    "current_tier": "L2",
                    "tier_entry_response": 3
                }
            }
        }
        path.write_text(json.dumps(old_data))
        
        tracker = StabilityTracker(
            persistence_path=path,
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        # Should have migrated
        assert tracker.get_tier("test.py") == 'L2'
        assert tracker.get_n_value("test.py") == 7


class TestStabilityTrackerHeuristicInit:
    """Tests for heuristic initialization from refs."""
    
    def test_initialize_from_refs_empty_tracker(self, tmp_path):
        """Heuristic init distributes files across tiers by ref count."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        # 10 files with varying ref counts
        files_with_refs = [
            ("core/models.py", 20),      # Top 20% -> L1
            ("core/utils.py", 15),       # Top 20% -> L1
            ("lib/handler.py", 10),      # Next 30% -> L2
            ("lib/parser.py", 8),        # Next 30% -> L2
            ("lib/formatter.py", 6),     # Next 30% -> L2
            ("features/a.py", 4),        # Bottom 50% -> L3
            ("features/b.py", 3),        # Bottom 50% -> L3
            ("tests/test_a.py", 1),      # Bottom 50% -> L3
            ("tests/test_b.py", 0),      # Bottom 50% -> L3
            ("scripts/run.py", 0),       # Bottom 50% -> L3
        ]
        
        assignments = tracker.initialize_from_refs(files_with_refs)
        
        # Top 20% (2 files) -> L1
        assert assignments["core/models.py"] == 'L1'
        assert assignments["core/utils.py"] == 'L1'
        assert tracker.get_n_value("core/models.py") == 9
        
        # Next 30% (3 files) -> L2
        assert assignments["lib/handler.py"] == 'L2'
        assert assignments["lib/parser.py"] == 'L2'
        assert assignments["lib/formatter.py"] == 'L2'
        assert tracker.get_n_value("lib/handler.py") == 6
        
        # Bottom 50% (5 files) -> L3
        assert assignments["features/a.py"] == 'L3'
        assert assignments["tests/test_a.py"] == 'L3'
        assert tracker.get_n_value("tests/test_a.py") == 3
    
    def test_initialize_from_refs_skips_if_data_exists(self, tmp_path):
        """Heuristic init is skipped if tracker already has data."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        # Pre-populate with some data
        tracker._stability["existing.py"] = StabilityInfo(
            content_hash="abc", n_value=5, tier='L3'
        )
        
        files_with_refs = [("new.py", 100)]
        assignments = tracker.initialize_from_refs(files_with_refs)
        
        # Should return empty - no initialization happened
        assert assignments == {}
        assert "new.py" not in tracker._stability
    
    def test_initialize_from_refs_excludes_active(self, tmp_path):
        """Active files are excluded from heuristic placement."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        files_with_refs = [
            ("a.py", 10),
            ("b.py", 5),
            ("c.py", 1),
        ]
        
        assignments = tracker.initialize_from_refs(
            files_with_refs,
            exclude_active={"a.py"}
        )
        
        assert "a.py" not in assignments
        assert "b.py" in assignments
        assert "c.py" in assignments
    
    def test_initialize_from_refs_persists(self, tmp_path):
        """Heuristic initialization is persisted to disk."""
        path = tmp_path / "stability.json"
        
        tracker1 = StabilityTracker(
            persistence_path=path,
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        # Need enough files for meaningful percentile distribution
        files_with_refs = [
            ("core.py", 100),
            ("mid1.py", 50),
            ("mid2.py", 25),
            ("leaf1.py", 5),
            ("leaf2.py", 0),
        ]
        tracker1.initialize_from_refs(files_with_refs)
        
        # Create new tracker from same path
        tracker2 = StabilityTracker(
            persistence_path=path,
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        # Top 20% (1 file) -> L1
        assert tracker2.get_tier("core.py") == 'L1'
        # Bottom 50% -> L3
        assert tracker2.get_tier("leaf2.py") == 'L3'
    
    def test_initialize_from_refs_empty_list(self, tmp_path):
        """Empty file list returns empty assignments."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        assignments = tracker.initialize_from_refs([])
        assert assignments == {}
    
    def test_initialize_from_refs_unsorted_input(self, tmp_path):
        """Input need not be sorted - method sorts internally."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        # Deliberately unsorted - need 5+ files for top 20% to get L1
        files_with_refs = [
            ("low.py", 1),
            ("high.py", 100),
            ("mid.py", 10),
            ("leaf1.py", 0),
            ("leaf2.py", 0),
        ]
        
        assignments = tracker.initialize_from_refs(files_with_refs)
        
        # High refs should be L1 regardless of input order (top 20% of 5 = 1 file)
        assert assignments["high.py"] == 'L1'
    
    def test_initialize_no_l0_assignment(self, tmp_path):
        """L0 is never assigned heuristically."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        # Create enough files to have meaningful distribution
        files_with_refs = [
            ("super_core.py", 1000),
            ("core.py", 500),
            ("mid1.py", 100),
            ("mid2.py", 50),
            ("leaf1.py", 10),
            ("leaf2.py", 5),
            ("leaf3.py", 1),
            ("leaf4.py", 0),
            ("leaf5.py", 0),
            ("leaf6.py", 0),
        ]
        assignments = tracker.initialize_from_refs(files_with_refs)
        
        # Highest refs file should be L1 (top 20%), never L0
        assert assignments["super_core.py"] == 'L1'
        # L0 should never be assigned heuristically
        assert 'L0' not in assignments.values()
    
    def test_is_initialized(self, tmp_path):
        """is_initialized reflects whether tracker has data."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        assert tracker.is_initialized() is False
        
        tracker.initialize_from_refs([("a.py", 5)])
        
        assert tracker.is_initialized() is True


class TestStabilityTrackerScenarios:
    """Integration tests for realistic scenarios."""
    
    def test_scenario_from_plan(self, tmp_path):
        """Test the example scenario from the plan."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        content = {"A": "a", "B": "b", "C": "c", "D": "d"}
        
        # Round 1: User adds files A, B, C to context
        tracker.update_after_response(
            items=["A", "B", "C"],
            get_content=lambda x: content[x]
        )
        assert tracker.get_tier("A") == 'active'
        assert tracker.get_tier("B") == 'active'
        assert tracker.get_tier("C") == 'active'
        assert tracker.get_n_value("A") == 0
        assert tracker.get_n_value("B") == 0
        assert tracker.get_n_value("C") == 0
        
        # Round 2: User only references A (B, C leave Active, enter L3)
        tracker.update_after_response(
            items=["A"],
            get_content=lambda x: content[x]
        )
        assert tracker.get_tier("A") == 'active'
        assert tracker.get_n_value("A") == 1  # Veteran in Active, gets N++
        assert tracker.get_tier("B") == 'L3'
        assert tracker.get_tier("C") == 'L3'
        # Both B and C enter L3 this cycle with entry_n=3
        # Neither is a veteran in L3 yet (they just entered), so N=3
        assert tracker.get_n_value("B") == 3
        assert tracker.get_n_value("C") == 3
        
        # Round 3: User references A, model edits B (B returns to Active)
        content["B"] = "b modified"
        tracker.update_after_response(
            items=["A", "B"],
            get_content=lambda x: content[x],
            modified=["B"]
        )
        assert tracker.get_tier("A") == 'active'
        assert tracker.get_n_value("A") == 2  # Still veteran in Active, N++
        assert tracker.get_tier("B") == 'active'
        assert tracker.get_n_value("B") == 0  # Reset due to modification
        assert tracker.get_tier("C") == 'L3'  # C stays in L3, no entries so no N++
        assert tracker.get_n_value("C") == 3  # No change - no items entered L3 this round
    
    def test_demote_from_l0_to_active(self, tmp_path):
        """Modified L0 item drops to active."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        # Set up item in L0
        tracker._stability = {
            "test.py": StabilityInfo(content_hash=tracker.compute_hash("original"), n_value=15, tier='L0')
        }
        tracker._last_active_items = set()
        
        content = {"test.py": "modified!"}
        tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x]
        )
        
        assert tracker.get_tier("test.py") == 'active'
        assert tracker.get_n_value("test.py") == 0
        
        demotions = tracker.get_last_demotions()
        assert ("test.py", "active") in demotions
    
    def test_multiple_items_entering_same_tier(self, tmp_path):
        """Multiple items entering a tier - veterans get N++ once per cycle."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        content = {"existing.py": "e", "new1.py": "1", "new2.py": "2", "other.py": "o"}
        
        # Set up existing item in L3, and new items in active (must be in _stability)
        tracker._stability = {
            "existing.py": StabilityInfo(content_hash="e", n_value=3, tier='L3'),
            "new1.py": StabilityInfo(content_hash="1", n_value=0, tier='active'),
            "new2.py": StabilityInfo(content_hash="2", n_value=0, tier='active'),
        }
        tracker._last_active_items = {"new1.py", "new2.py"}
        
        # Both new1.py and new2.py leave Active, enter L3
        tracker.update_after_response(
            items=["other.py"],
            get_content=lambda x: content[x]
        )
        
        # Veterans get N++ once per cycle (not once per entering item)
        # existing.py is the only veteran in L3, gets N++ once: N=3 -> N=4
        assert tracker.get_tier("existing.py") == 'L3'
        assert tracker.get_n_value("existing.py") == 4
        
        # The two new items enter L3 with N=3 (entry_n)
        # They are not veterans this cycle (they just entered), so N stays at entry_n
        assert tracker.get_tier("new1.py") == 'L3'
        assert tracker.get_n_value("new1.py") == 3
        assert tracker.get_tier("new2.py") == 'L3'
        assert tracker.get_n_value("new2.py") == 3
