"""Tests for the StabilityTracker with ripple promotion."""

import json
import pytest
from pathlib import Path

from ac.context.stability_tracker import StabilityTracker, StabilityInfo, TIER_CONFIG


# Note: stability_tracker, stability_path, make_stability_info, and 
# tracker_with_items fixtures are defined in conftest.py


class TestStabilityTrackerInit:
    """Tests for StabilityTracker initialization."""
    
    def test_init_with_default_thresholds(self, stability_path):
        """Default thresholds use legacy 2-tier mode."""
        tracker = StabilityTracker(persistence_path=stability_path)
        # Legacy mode: L1=3, L0=5
        assert tracker.get_thresholds() == {'L1': 3, 'L0': 5}
        assert tracker.get_tier_order() == ['L1', 'L0']
    
    def test_init_with_custom_thresholds(self, stability_tracker):
        """Custom thresholds override legacy parameters."""
        assert stability_tracker.get_thresholds() == {'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        # Tier order is ascending by threshold
        assert stability_tracker.get_tier_order() == ['L3', 'L2', 'L1', 'L0']
    
    def test_init_with_4_tier_bedrock_config(self, stability_tracker):
        """4-tier Bedrock-optimized configuration."""
        assert len(stability_tracker.get_thresholds()) == 4
        assert stability_tracker._initial_tier == 'L3'
    
    def test_init_creates_parent_directory(self, tmp_path):
        """Persistence path parent directory is created on save."""
        nested_path = tmp_path / "subdir" / "stability.json"
        tracker = StabilityTracker(persistence_path=nested_path)
        tracker.save()
        assert nested_path.parent.exists()


class TestStabilityTrackerRippleBasics:
    """Tests for basic ripple promotion behavior."""
    
    def test_new_item_starts_active(self, stability_tracker):
        """New items in Active context start with tier='active', N=0."""
        content = {"test.py": "print('hello')"}
        stability_tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x]
        )
        
        assert stability_tracker.get_tier("test.py") == 'active'
        assert stability_tracker.get_n_value("test.py") == 0
    
    def test_item_leaving_active_enters_l3(self, stability_tracker):
        """When item leaves Active context, it enters L3 with N=3."""
        content = {"a.py": "a", "b.py": "b"}
        
        # Round 1: Both in Active
        stability_tracker.update_after_response(
            items=["a.py", "b.py"],
            get_content=lambda x: content[x]
        )
        assert stability_tracker.get_tier("a.py") == 'active'
        assert stability_tracker.get_tier("b.py") == 'active'
        
        # Round 2: Only a.py in Active (b.py leaves)
        stability_tracker.update_after_response(
            items=["a.py"],
            get_content=lambda x: content[x]
        )
        
        assert stability_tracker.get_tier("a.py") == 'active'
        assert stability_tracker.get_tier("b.py") == 'L3'
        assert stability_tracker.get_n_value("b.py") == 3
    
    def test_modified_cached_item_returns_to_active(self, stability_tracker):
        """Modified item in cache tier returns to Active with N=0."""
        content = {"a.py": "a", "b.py": "b"}
        
        # Round 1: Both in Active
        stability_tracker.update_after_response(
            items=["a.py", "b.py"],
            get_content=lambda x: content[x]
        )
        
        # Round 2: b.py leaves Active, enters L3
        stability_tracker.update_after_response(
            items=["a.py"],
            get_content=lambda x: content[x]
        )
        assert stability_tracker.get_tier("b.py") == 'L3'
        
        # Round 3: b.py modified (back in Active)
        content["b.py"] = "b modified"
        stability_tracker.update_after_response(
            items=["a.py", "b.py"],
            get_content=lambda x: content[x]
        )
        
        assert stability_tracker.get_tier("b.py") == 'active'
        assert stability_tracker.get_n_value("b.py") == 0
    
    def test_compute_tier_from_n(self, stability_tracker):
        """_compute_tier_from_n correctly maps N values to tiers."""
        assert stability_tracker._compute_tier_from_n(0) == 'active'
        assert stability_tracker._compute_tier_from_n(3) == 'L3'
        assert stability_tracker._compute_tier_from_n(6) == 'L2'
        assert stability_tracker._compute_tier_from_n(9) == 'L1'
        assert stability_tracker._compute_tier_from_n(12) == 'L0'


class TestStabilityTrackerRipplePromotion:
    """Tests for ripple promotion cascading."""
    
    def test_entry_triggers_n_increment(self, stability_tracker):
        """When item enters a tier, existing items get N++."""
        content = {"a.py": "a", "b.py": "b", "c.py": "c"}
        
        # Round 1: All in Active
        stability_tracker.update_after_response(
            items=["a.py", "b.py", "c.py"],
            get_content=lambda x: content[x]
        )
        
        # Round 2: b.py leaves Active, enters L3 (no existing items)
        stability_tracker.update_after_response(
            items=["a.py", "c.py"],
            get_content=lambda x: content[x]
        )
        assert stability_tracker.get_tier("b.py") == 'L3'
        assert stability_tracker.get_n_value("b.py") == 3
        
        # Round 3: c.py leaves Active, enters L3 (b.py is there)
        stability_tracker.update_after_response(
            items=["a.py"],
            get_content=lambda x: content[x]
        )
        assert stability_tracker.get_tier("c.py") == 'L3'
        assert stability_tracker.get_n_value("c.py") == 3
        # b.py should have gotten N++ when c.py entered
        assert stability_tracker.get_n_value("b.py") == 4
    
    def test_promotion_at_threshold(self, tracker_with_items):
        """Item promotes when N reaches promotion threshold."""
        # Set up: 0.py is veteran in L3 with N=5 (one away from promotion)
        #         1.py is veteran in L3 with N=4
        #         trigger.py is in Active, will leave and enter L3
        tracker = tracker_with_items({
            "0.py": (5, 'L3'),
            "1.py": (4, 'L3'),
            "trigger.py": (0, 'active'),
        }, last_active={"trigger.py"})
        
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
    
    def test_cascade_promotion(self, tracker_with_items):
        """Promotions cascade through tiers when veterans reach thresholds."""
        # Set up items close to promotion thresholds
        tracker = tracker_with_items({
            "trigger.py": (0, 'active'),
            "l3_item.py": (5, 'L3'),   # N=5, promotes at 6
            "l2_item.py": (8, 'L2'),   # N=8, promotes at 9
            "l1_item.py": (11, 'L1'),  # N=11, promotes at 12
        }, last_active={"trigger.py"})
        
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
    
    def test_update_new_item_starts_active(self, stability_tracker):
        """New items in Active context start as active."""
        content = {"test.py": "print('hello')"}
        changes = stability_tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x]
        )
        
        assert "test.py" in changes
        assert changes["test.py"] == 'active'
        assert stability_tracker.get_tier("test.py") == 'active'
        assert stability_tracker.get_n_value("test.py") == 0
    
    def test_update_item_leaves_active_enters_l3(self, stability_tracker):
        """Items leaving Active enter L3 with N=3."""
        content = {"test.py": "print('hello')", "other.py": "other"}
        
        # First update - test.py is active
        stability_tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x]
        )
        assert stability_tracker.get_tier("test.py") == 'active'
        
        # Second update - test.py leaves Active (not in items list)
        changes = stability_tracker.update_after_response(
            items=["other.py"],
            get_content=lambda x: content[x]
        )
        
        assert stability_tracker.get_tier("test.py") == 'L3'
        assert stability_tracker.get_n_value("test.py") == 3
    
    def test_update_modified_item_demotes(self, stability_tracker):
        """Modified items are demoted to active."""
        # Set up item in L3
        stability_tracker._stability = {
            "test.py": StabilityInfo(
                content_hash=stability_tracker.compute_hash("original"),
                n_value=3,
                tier='L3'
            )
        }
        stability_tracker._last_active_items = set()
        
        content = {"test.py": "modified"}
        changes = stability_tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x]
        )
        
        assert changes["test.py"] == 'active'
        assert stability_tracker.get_tier("test.py") == 'active'
        assert stability_tracker.get_n_value("test.py") == 0
    
    def test_update_with_modified_hint(self, stability_tracker):
        """Modified hint forces demotion even if hash unchanged."""
        content = {"test.py": "print('hello')"}
        
        # Set up item in L3
        stability_tracker._stability = {
            "test.py": StabilityInfo(
                content_hash=stability_tracker.compute_hash("print('hello')"),
                n_value=5,
                tier='L3'
            )
        }
        stability_tracker._last_active_items = set()
        
        # Mark as modified even though content hash is same
        changes = stability_tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x],
            modified=["test.py"]
        )
        
        assert changes["test.py"] == 'active'
        assert stability_tracker.get_n_value("test.py") == 0


class TestStabilityTrackerPromotionDemotion:
    """Tests for promotion/demotion tracking."""
    
    def test_track_promotions_on_tier_entry(self, stability_tracker):
        """Promotions are tracked when items enter cache tiers."""
        content = {"test.py": "hello", "other.py": "other"}
        
        # Round 1: test.py in Active
        stability_tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x]
        )
        
        # Round 2: test.py leaves Active, enters L3
        stability_tracker.update_after_response(
            items=["other.py"],
            get_content=lambda x: content[x]
        )
        
        promotions = stability_tracker.get_last_promotions()
        assert len(promotions) == 1
        assert promotions[0] == ("test.py", "L3")
    
    def test_track_demotions(self, stability_tracker):
        """Demotions are tracked when cached items are modified."""
        # Set up item in L3
        stability_tracker._stability = {
            "test.py": StabilityInfo(
                content_hash=stability_tracker.compute_hash("original"),
                n_value=5,
                tier='L3'
            )
        }
        stability_tracker._last_active_items = set()
        
        content = {"test.py": "modified"}
        stability_tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x]
        )
        
        demotions = stability_tracker.get_last_demotions()
        assert len(demotions) == 1
        assert demotions[0] == ("test.py", "active")
    
    def test_is_promotion(self, stability_tracker):
        """_is_promotion correctly identifies promotions."""
        # Promotions
        assert stability_tracker._is_promotion('active', 'L3') is True
        assert stability_tracker._is_promotion('L3', 'L2') is True
        assert stability_tracker._is_promotion('L2', 'L1') is True
        assert stability_tracker._is_promotion('L1', 'L0') is True
        
        # Demotions
        assert stability_tracker._is_promotion('L0', 'L1') is False
        assert stability_tracker._is_promotion('L3', 'active') is False
        assert stability_tracker._is_promotion('L0', 'active') is False
        
        # Same tier
        assert stability_tracker._is_promotion('L1', 'L1') is False


class TestStabilityTrackerGetItemsByTier:
    """Tests for get_items_by_tier."""
    
    def test_get_items_by_tier_empty(self, stability_tracker):
        """Empty tracker returns empty tiers."""
        result = stability_tracker.get_items_by_tier()
        assert result == {'active': [], 'L3': [], 'L2': [], 'L1': [], 'L0': []}
    
    def test_get_items_by_tier_with_items(self, tracker_with_items):
        """Items are grouped by their tier."""
        tracker = tracker_with_items({
            "a.py": (3, 'L3'),
            "b.py": (6, 'L2'),
            "c.py": (0, 'active'),
        })
        
        result = tracker.get_items_by_tier()
        assert result['L3'] == ["a.py"]
        assert result['L2'] == ["b.py"]
        assert result['active'] == ["c.py"]
    
    def test_get_items_by_tier_filtered(self, tracker_with_items):
        """Can filter to specific items."""
        tracker = tracker_with_items({
            "a.py": (3, 'L3'),
            "b.py": (4, 'L3'),
            "c.py": (5, 'L3'),
        })
        
        # Only ask about a.py and b.py
        result = tracker.get_items_by_tier(items=["a.py", "b.py"])
        assert set(result['L3']) == {"a.py", "b.py"}
        assert "c.py" not in result['L3']
    
    def test_get_items_by_tier_sorted_by_n_value(self, tracker_with_items):
        """Items within a tier are sorted by n_value descending."""
        tracker = tracker_with_items({
            "a.py": (5, 'L3'),
            "b.py": (3, 'L3'),
        })
        
        result = tracker.get_items_by_tier()
        # a.py should come first (higher n_value)
        assert result['L3'] == ["a.py", "b.py"]


class TestStabilityTrackerPersistence:
    """Tests for save/load functionality."""
    
    def test_save_and_load(self, stability_path):
        """Data persists across tracker instances."""
        # Create and populate tracker
        tracker1 = StabilityTracker(
            persistence_path=stability_path,
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
            persistence_path=stability_path,
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        assert tracker2.get_tier("test.py") == 'L3'
        assert tracker2.get_n_value("test.py") == 5
        assert tracker2._response_count == 10
        assert "other.py" in tracker2._last_active_items
    
    def test_clear_removes_file(self, stability_tracker, stability_path):
        """Clear removes persistence file."""
        stability_tracker._stability = {
            "test.py": StabilityInfo(content_hash="abc", n_value=3, tier='L3')
        }
        stability_tracker.save()
        
        assert stability_path.exists()
        
        stability_tracker.clear()
        
        assert not stability_path.exists()
        assert stability_tracker.get_tier("test.py") == 'active'
    
    def test_load_handles_corrupted_file(self, stability_path):
        """Corrupted persistence file is handled gracefully."""
        stability_path.write_text("not valid json {{{")
        
        # Should not raise, just start fresh
        tracker = StabilityTracker(
            persistence_path=stability_path,
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        assert tracker._response_count == 0
        assert len(tracker._stability) == 0
    
    def test_load_migrates_old_format(self, stability_path):
        """Old format with stable_count/current_tier is migrated."""
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
        stability_path.write_text(json.dumps(old_data))
        
        tracker = StabilityTracker(
            persistence_path=stability_path,
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        # Should have migrated
        assert tracker.get_tier("test.py") == 'L2'
        assert tracker.get_n_value("test.py") == 7


class TestStabilityTrackerHeuristicInit:
    """Tests for heuristic initialization from refs."""
    
    def test_initialize_from_refs_empty_tracker(self, stability_tracker):
        """Heuristic init distributes files across tiers by ref count."""
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
        
        assignments = stability_tracker.initialize_from_refs(files_with_refs)
        
        # Top 20% (2 files) -> L1
        assert assignments["core/models.py"] == 'L1'
        assert assignments["core/utils.py"] == 'L1'
        assert stability_tracker.get_n_value("core/models.py") == 9
        
        # Next 30% (3 files) -> L2
        assert assignments["lib/handler.py"] == 'L2'
        assert assignments["lib/parser.py"] == 'L2'
        assert assignments["lib/formatter.py"] == 'L2'
        assert stability_tracker.get_n_value("lib/handler.py") == 6
        
        # Bottom 50% (5 files) -> L3
        assert assignments["features/a.py"] == 'L3'
        assert assignments["tests/test_a.py"] == 'L3'
        assert stability_tracker.get_n_value("tests/test_a.py") == 3
    
    def test_initialize_from_refs_skips_if_data_exists(self, stability_tracker, make_stability_info):
        """Heuristic init is skipped if tracker already has data."""
        # Pre-populate with some data
        stability_tracker._stability["existing.py"] = make_stability_info(
            content_hash="abc", n_value=5, tier='L3'
        )
        
        files_with_refs = [("new.py", 100)]
        assignments = stability_tracker.initialize_from_refs(files_with_refs)
        
        # Should return empty - no initialization happened
        assert assignments == {}
        assert "new.py" not in stability_tracker._stability
    
    def test_initialize_from_refs_excludes_active(self, stability_tracker):
        """Active files are excluded from heuristic placement."""
        files_with_refs = [
            ("a.py", 10),
            ("b.py", 5),
            ("c.py", 1),
        ]
        
        assignments = stability_tracker.initialize_from_refs(
            files_with_refs,
            exclude_active={"a.py"}
        )
        
        assert "a.py" not in assignments
        assert "b.py" in assignments
        assert "c.py" in assignments
    
    def test_initialize_from_refs_persists(self, stability_path):
        """Heuristic initialization is persisted to disk."""
        tracker1 = StabilityTracker(
            persistence_path=stability_path,
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
            persistence_path=stability_path,
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        
        # Top 20% (1 file) -> L1
        assert tracker2.get_tier("core.py") == 'L1'
        # Bottom 50% -> L3
        assert tracker2.get_tier("leaf2.py") == 'L3'
    
    def test_initialize_from_refs_empty_list(self, stability_tracker):
        """Empty file list returns empty assignments."""
        assignments = stability_tracker.initialize_from_refs([])
        assert assignments == {}
    
    def test_initialize_from_refs_unsorted_input(self, stability_tracker):
        """Input need not be sorted - method sorts internally."""
        # Deliberately unsorted - need 5+ files for top 20% to get L1
        files_with_refs = [
            ("low.py", 1),
            ("high.py", 100),
            ("mid.py", 10),
            ("leaf1.py", 0),
            ("leaf2.py", 0),
        ]
        
        assignments = stability_tracker.initialize_from_refs(files_with_refs)
        
        # High refs should be L1 regardless of input order (top 20% of 5 = 1 file)
        assert assignments["high.py"] == 'L1'
    
    def test_initialize_no_l0_assignment(self, stability_tracker):
        """L0 is never assigned heuristically."""
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
        assignments = stability_tracker.initialize_from_refs(files_with_refs)
        
        # Highest refs file should be L1 (top 20%), never L0
        assert assignments["super_core.py"] == 'L1'
        # L0 should never be assigned heuristically
        assert 'L0' not in assignments.values()
    
    def test_is_initialized(self, stability_tracker):
        """is_initialized reflects whether tracker has data."""
        assert stability_tracker.is_initialized() is False
        
        stability_tracker.initialize_from_refs([("a.py", 5)])
        
        assert stability_tracker.is_initialized() is True


class TestStabilityTrackerScenarios:
    """Integration tests for realistic scenarios."""
    
    def test_scenario_from_plan(self, stability_tracker):
        """Test the example scenario from the plan."""
        content = {"A": "a", "B": "b", "C": "c", "D": "d"}
        
        # Round 1: User adds files A, B, C to context
        stability_tracker.update_after_response(
            items=["A", "B", "C"],
            get_content=lambda x: content[x]
        )
        assert stability_tracker.get_tier("A") == 'active'
        assert stability_tracker.get_tier("B") == 'active'
        assert stability_tracker.get_tier("C") == 'active'
        assert stability_tracker.get_n_value("A") == 0
        assert stability_tracker.get_n_value("B") == 0
        assert stability_tracker.get_n_value("C") == 0
        
        # Round 2: User only references A (B, C leave Active, enter L3)
        stability_tracker.update_after_response(
            items=["A"],
            get_content=lambda x: content[x]
        )
        assert stability_tracker.get_tier("A") == 'active'
        assert stability_tracker.get_n_value("A") == 1  # Veteran in Active, gets N++
        assert stability_tracker.get_tier("B") == 'L3'
        assert stability_tracker.get_tier("C") == 'L3'
        # Both B and C enter L3 this cycle with entry_n=3
        # Neither is a veteran in L3 yet (they just entered), so N=3
        assert stability_tracker.get_n_value("B") == 3
        assert stability_tracker.get_n_value("C") == 3
        
        # Round 3: User references A, model edits B (B returns to Active)
        content["B"] = "b modified"
        stability_tracker.update_after_response(
            items=["A", "B"],
            get_content=lambda x: content[x],
            modified=["B"]
        )
        assert stability_tracker.get_tier("A") == 'active'
        assert stability_tracker.get_n_value("A") == 2  # Still veteran in Active, N++
        assert stability_tracker.get_tier("B") == 'active'
        assert stability_tracker.get_n_value("B") == 0  # Reset due to modification
        assert stability_tracker.get_tier("C") == 'L3'  # C stays in L3, no entries so no N++
        assert stability_tracker.get_n_value("C") == 3  # No change - no items entered L3 this round
    
    def test_demote_from_l0_to_active(self, stability_tracker):
        """Modified L0 item drops to active."""
        # Set up item in L0
        stability_tracker._stability = {
            "test.py": StabilityInfo(
                content_hash=stability_tracker.compute_hash("original"),
                n_value=15,
                tier='L0'
            )
        }
        stability_tracker._last_active_items = set()
        
        content = {"test.py": "modified!"}
        stability_tracker.update_after_response(
            items=["test.py"],
            get_content=lambda x: content[x]
        )
        
        assert stability_tracker.get_tier("test.py") == 'active'
        assert stability_tracker.get_n_value("test.py") == 0
        
        demotions = stability_tracker.get_last_demotions()
        assert ("test.py", "active") in demotions
    
    def test_multiple_items_entering_same_tier(self, tracker_with_items):
        """Multiple items entering a tier - veterans get N++ once per cycle."""
        content = {"existing.py": "e", "new1.py": "1", "new2.py": "2", "other.py": "o"}
        
        # Set up existing item in L3, and new items in active (must be in _stability)
        tracker = tracker_with_items({
            "existing.py": (3, 'L3'),
            "new1.py": (0, 'active'),
            "new2.py": (0, 'active'),
        }, last_active={"new1.py", "new2.py"})
        
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
