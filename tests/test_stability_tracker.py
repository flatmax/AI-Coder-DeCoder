"""Tests for the StabilityTracker with ripple promotion and threshold-aware caching."""

import json
import pytest
from pathlib import Path

from ac.context.stability_tracker import StabilityTracker, StabilityInfo, TIER_CONFIG, TIER_THRESHOLDS, TIER_NAMES, TIER_ORDER, CACHE_TIERS


# Note: stability_tracker, stability_path, make_stability_info, and 
# tracker_with_items fixtures are defined in conftest.py


class TestStabilityTrackerInit:
    """Tests for StabilityTracker initialization."""
    
    def test_init_with_default_thresholds(self, stability_path):
        """Default thresholds use 4-tier config."""
        tracker = StabilityTracker(persistence_path=stability_path)
        assert tracker.get_thresholds() == {'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        assert tracker.get_tier_order() == ['L3', 'L2', 'L1', 'L0']
    
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


class TestTierConstants:
    """Tests that derived tier constants are consistent with TIER_CONFIG."""
    
    def test_thresholds_match_tier_config(self):
        """TIER_THRESHOLDS should be derived from TIER_CONFIG entry_n values."""
        expected = {k: v['entry_n'] for k, v in TIER_CONFIG.items()}
        assert TIER_THRESHOLDS == expected
    
    def test_tier_order_includes_all_tiers_and_active(self):
        """TIER_ORDER should include all cache tiers plus active."""
        assert set(TIER_ORDER) == set(CACHE_TIERS) | {'active'}
    
    def test_cache_tiers_excludes_active(self):
        """CACHE_TIERS should not include 'active'."""
        assert 'active' not in CACHE_TIERS
        assert set(CACHE_TIERS) == set(TIER_CONFIG.keys())
    
    def test_tier_names_covers_all_tiers(self):
        """TIER_NAMES should have entries for all tiers including active."""
        assert set(TIER_NAMES.keys()) == set(TIER_ORDER)
    
    def test_context_builder_reexports_match(self):
        """context_builder re-exports should be the same objects."""
        from ac.llm.context_builder import (
            TIER_THRESHOLDS as CB_THRESHOLDS,
            TIER_NAMES as CB_NAMES,
            TIER_ORDER as CB_ORDER,
            CACHE_TIERS as CB_CACHE,
        )
        assert CB_THRESHOLDS is TIER_THRESHOLDS
        assert CB_NAMES is TIER_NAMES
        assert CB_ORDER is TIER_ORDER
        assert CB_CACHE is CACHE_TIERS


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


class TestStabilityTrackerThresholdAware:
    """Tests for threshold-aware promotion behavior."""
    
    def test_threshold_disabled_by_default(self, stability_tracker):
        """By default, threshold-aware promotion is disabled."""
        assert stability_tracker.get_cache_target_tokens() == 0
    
    def test_threshold_can_be_set(self, stability_tracker):
        """Cache target tokens can be set after initialization."""
        stability_tracker.set_cache_target_tokens(1536)
        assert stability_tracker.get_cache_target_tokens() == 1536
    
    def test_veterans_anchor_below_threshold(self, stability_tracker_with_threshold):
        """Veterans below token threshold anchor tier (no N++)."""
        tracker = stability_tracker_with_threshold
        
        # Set up: veteran A in L3 with N=5 (500 tokens)
        #         veteran B in L3 with N=4 (400 tokens)
        #         entering item E (400 tokens)
        # Target: 1000 tokens
        # 
        # After entry: accumulated=400 (E)
        # Process A: accumulated(400) < 1000 → add 500 → accumulated=900, no N++
        # Process B: accumulated(900) < 1000 → add 400 → accumulated=1300, no N++ wait threshold met!
        # Actually: A anchors (no N++), B is past threshold (gets N++)
        
        tracker._stability = {
            "A": StabilityInfo(content_hash="a", n_value=5, tier='L3'),
            "B": StabilityInfo(content_hash="b", n_value=4, tier='L3'),
            "E": StabilityInfo(content_hash="e", n_value=0, tier='active'),
        }
        tracker._last_active_items = {"E"}
        
        content = {"A": "a", "B": "b", "E": "e", "other": "o"}
        token_counts = {"A": 500, "B": 400, "E": 400, "other": 100}
        
        # E leaves Active, enters L3
        tracker.update_after_response(
            items=["other"],
            get_content=lambda x: content[x],
            get_tokens=lambda x: token_counts.get(x, 0),
        )
        
        # E entered L3 with N=3
        assert tracker.get_tier("E") == 'L3'
        assert tracker.get_n_value("E") == 3
        
        # Veterans sorted by N: B(N=4), A(N=5)
        # accumulated starts at 400 (E's tokens)
        # B: 400 < 1000 → add 400 → accumulated=800, B anchors (no N++)
        # A: 800 < 1000 → add 500 → accumulated=1300, A anchors (no N++)
        # Threshold met after processing, but no veterans past threshold point
        # 
        # Actually the algorithm checks BEFORE adding each veteran's tokens:
        # accumulated=400 (from E)
        # B(N=4): 400 < 1000 → B anchors, accumulated += 400 = 800
        # A(N=5): 800 < 1000 → A anchors, accumulated += 500 = 1300
        # Both anchor, neither gets N++
        assert tracker.get_n_value("B") == 4  # No N++ (anchored)
        assert tracker.get_n_value("A") == 5  # No N++ (anchored)
    
    def test_veterans_promote_past_threshold(self, stability_tracker_with_threshold):
        """Veterans past token threshold get N++ and can promote."""
        tracker = stability_tracker_with_threshold
        
        # Set up: veteran A in L3 with N=5 (large - 800 tokens)
        #         veteran B in L3 with N=5 (small - 100 tokens)
        #         entering item E (200 tokens)
        # Target: 1000 tokens
        
        tracker._stability = {
            "A": StabilityInfo(content_hash="a", n_value=5, tier='L3'),
            "B": StabilityInfo(content_hash="b", n_value=5, tier='L3'),
            "E": StabilityInfo(content_hash="e", n_value=0, tier='active'),
        }
        tracker._last_active_items = {"E"}
        
        content = {"A": "a", "B": "b", "E": "e", "other": "o"}
        token_counts = {"A": 800, "B": 100, "E": 200, "other": 100}
        
        # E leaves Active, enters L3
        tracker.update_after_response(
            items=["other"],
            get_content=lambda x: content[x],
            get_tokens=lambda x: token_counts.get(x, 0),
        )
        
        # E entered L3 with N=3
        assert tracker.get_tier("E") == 'L3'
        assert tracker.get_n_value("E") == 3
        
        # Veterans sorted by N (both N=5, order may vary)
        # accumulated=200 (E's tokens)
        # First veteran: 200 < 1000 → anchors, accumulated increases
        # Second veteran: depends on accumulated
        # 
        # If A processed first: 200 < 1000 → A anchors, accumulated=1000
        # Then B: 1000 >= 1000 → B gets N++ → N=6, promotes to L2
        # 
        # If B processed first: 200 < 1000 → B anchors, accumulated=300
        # Then A: 300 < 1000 → A anchors, accumulated=1100
        # Neither promotes
        # 
        # Since both have same N, order is not guaranteed. Let's set different N values.
        pass  # This test needs refinement - see next test
    
    def test_threshold_aware_promotion_deterministic(self, stability_tracker_with_threshold):
        """Threshold-aware promotion with deterministic ordering."""
        tracker = stability_tracker_with_threshold
        
        # Set up with clear N ordering:
        # veteran A in L3 with N=4 (first to be processed - lowest N)
        # veteran B in L3 with N=5 (second)
        # veteran C in L3 with N=5 (third - same N as B, but will be past threshold)
        # entering item E (200 tokens)
        # Target: 1000 tokens
        
        tracker._stability = {
            "A": StabilityInfo(content_hash="a", n_value=4, tier='L3'),
            "B": StabilityInfo(content_hash="b", n_value=5, tier='L3'),
            "C": StabilityInfo(content_hash="c", n_value=5, tier='L3'),
            "E": StabilityInfo(content_hash="e", n_value=0, tier='active'),
        }
        tracker._last_active_items = {"E"}
        
        content = {"A": "a", "B": "b", "C": "c", "E": "e", "other": "o"}
        token_counts = {"A": 400, "B": 500, "C": 300, "E": 200, "other": 100}
        
        # E leaves Active, enters L3
        tracker.update_after_response(
            items=["other"],
            get_content=lambda x: content[x],
            get_tokens=lambda x: token_counts.get(x, 0),
        )
        
        # E entered with N=3
        assert tracker.get_tier("E") == 'L3'
        assert tracker.get_n_value("E") == 3
        
        # Veterans sorted by N ascending: A(N=4), B(N=5), C(N=5)
        # accumulated=200 (E's tokens)
        # A(N=4): 200 < 1000 → A anchors, accumulated=200+400=600
        # B(N=5): 600 < 1000 → B anchors, accumulated=600+500=1100
        # C(N=5): 1100 >= 1000 → threshold met! C gets N++ → N=6, promotes to L2
        
        assert tracker.get_n_value("A") == 4  # Anchored, no N++
        assert tracker.get_n_value("B") == 5  # Anchored, no N++
        assert tracker.get_tier("C") == 'L2'  # Promoted!
        assert tracker.get_n_value("C") == 6  # N++ triggered promotion
    
    def test_threshold_aware_cascade_promotion(self, stability_tracker_with_threshold):
        """Threshold-aware promotion cascades through tiers."""
        tracker = stability_tracker_with_threshold
        
        # Set up items close to promotion in multiple tiers
        tracker._stability = {
            "trigger": StabilityInfo(content_hash="t", n_value=0, tier='active'),
            "l3_anchor": StabilityInfo(content_hash="l3a", n_value=4, tier='L3'),  # Will anchor
            "l3_promote": StabilityInfo(content_hash="l3p", n_value=5, tier='L3'),  # Will promote to L2
            "l2_anchor": StabilityInfo(content_hash="l2a", n_value=7, tier='L2'),  # Will anchor
            "l2_promote": StabilityInfo(content_hash="l2p", n_value=8, tier='L2'),  # Will promote to L1
        }
        tracker._last_active_items = {"trigger"}
        
        content = {k: k for k in tracker._stability}
        content["other"] = "other"
        # Token counts designed to have one anchor and one promoter per tier
        token_counts = {
            "trigger": 200,
            "l3_anchor": 900,   # This alone will meet threshold
            "l3_promote": 100,  # Past threshold, will get N++ and promote
            "l2_anchor": 900,   # This alone will meet threshold  
            "l2_promote": 100,  # Past threshold, will get N++ and promote
            "other": 100,
        }
        
        tracker.update_after_response(
            items=["other"],
            get_content=lambda x: content[x],
            get_tokens=lambda x: token_counts.get(x, 0),
        )
        
        # trigger → L3 with N=3
        assert tracker.get_tier("trigger") == 'L3'
        
        # L3: l3_anchor(N=4) anchors, l3_promote(N=5) gets N++→6, promotes
        assert tracker.get_n_value("l3_anchor") == 4  # Anchored
        assert tracker.get_tier("l3_promote") == 'L2'  # Promoted!
        assert tracker.get_n_value("l3_promote") == 6
        
        # L2: l2_anchor(N=7) anchors, l2_promote(N=8) gets N++→9, promotes
        # Note: l3_promote enters L2, triggering veteran processing
        assert tracker.get_n_value("l2_anchor") == 7  # Anchored
        assert tracker.get_tier("l2_promote") == 'L1'  # Promoted!
        assert tracker.get_n_value("l2_promote") == 9
    
    def test_without_get_tokens_uses_original_behavior(self, stability_tracker_with_threshold):
        """When get_tokens not provided, uses original (non-threshold) behavior."""
        tracker = stability_tracker_with_threshold
        
        # Even with cache_target_tokens set, if no get_tokens callback,
        # all veterans get N++ (original behavior)
        tracker._stability = {
            "A": StabilityInfo(content_hash="a", n_value=5, tier='L3'),
            "B": StabilityInfo(content_hash="b", n_value=4, tier='L3'),
            "E": StabilityInfo(content_hash="e", n_value=0, tier='active'),
        }
        tracker._last_active_items = {"E"}
        
        content = {"A": "a", "B": "b", "E": "e", "other": "o"}
        
        # E leaves Active, enters L3 - no get_tokens provided
        tracker.update_after_response(
            items=["other"],
            get_content=lambda x: content[x],
            # get_tokens not provided
        )
        
        # All veterans should get N++ (original behavior)
        assert tracker.get_n_value("A") == 6  # N++ applied
        assert tracker.get_n_value("B") == 5  # N++ applied
        # A promotes to L2 (N=6 >= promotion threshold of 6)
        assert tracker.get_tier("A") == 'L2'


class TestStabilityTrackerThresholdAwareInit:
    """Tests for threshold-aware initialization from refs."""
    
    def test_init_with_tokens_fills_tiers(self, stability_tracker_with_threshold):
        """Threshold-aware init fills tiers to meet token target."""
        tracker = stability_tracker_with_threshold
        
        # Files with refs and token counts
        # Target: 1000 tokens per tier
        files_with_refs = [
            ("core.py", 100, 600),    # High refs, 600 tokens
            ("utils.py", 80, 500),    # High refs, 500 tokens → L1 filled (1100 tokens)
            ("handler.py", 50, 400),  # Mid refs, 400 tokens
            ("parser.py", 40, 700),   # Mid refs, 700 tokens → L2 filled (1100 tokens)
            ("leaf1.py", 10, 200),    # Low refs
            ("leaf2.py", 5, 300),     # Low refs
            ("leaf3.py", 0, 100),     # No refs → all go to L3
        ]
        
        assignments = tracker.initialize_from_refs(
            files_with_refs,
            target_tokens=1000,
        )
        
        # L1 should have core.py and utils.py (1100 tokens meets 1000 target)
        assert assignments["core.py"] == 'L1'
        assert assignments["utils.py"] == 'L1'
        
        # L2 should have handler.py and parser.py (1100 tokens meets target)
        assert assignments["handler.py"] == 'L2'
        assert assignments["parser.py"] == 'L2'
        
        # L3 absorbs the rest
        assert assignments["leaf1.py"] == 'L3'
        assert assignments["leaf2.py"] == 'L3'
        assert assignments["leaf3.py"] == 'L3'
    
    def test_init_without_tokens_uses_percentile(self, stability_tracker_with_threshold):
        """Without token info, uses percentile-based initialization."""
        tracker = stability_tracker_with_threshold
        
        # Files without token counts (2-tuples)
        files_with_refs = [
            ("a.py", 100),
            ("b.py", 80),
            ("c.py", 50),
            ("d.py", 40),
            ("e.py", 10),
        ]
        
        assignments = tracker.initialize_from_refs(files_with_refs)
        
        # Top 20% (1 file) → L1
        assert assignments["a.py"] == 'L1'
        # Next 30% (1-2 files) → L2
        assert assignments["b.py"] == 'L2'
        # Bottom 50% → L3
        assert assignments["e.py"] == 'L3'
    
    def test_init_uses_tracker_target_if_not_specified(self, stability_tracker_with_threshold):
        """Uses tracker's cache_target_tokens if target_tokens not passed."""
        tracker = stability_tracker_with_threshold
        assert tracker.get_cache_target_tokens() == 1000
        
        files_with_refs = [
            ("a.py", 100, 600),
            ("b.py", 80, 500),
            ("c.py", 50, 400),
        ]
        
        # Don't pass target_tokens - should use tracker's 1000
        assignments = tracker.initialize_from_refs(files_with_refs)
        
        # Should fill L1 to ~1000 tokens
        assert assignments["a.py"] == 'L1'
        assert assignments["b.py"] == 'L1'  # 600 + 500 = 1100 >= 1000
        assert assignments["c.py"] == 'L2'


class TestStabilityTrackerRemoveByPrefix:
    """Tests for remove_by_prefix method."""
    
    def test_remove_by_prefix_basic(self, tracker_with_items):
        """Remove all items matching a prefix."""
        tracker = tracker_with_items({
            "history:0": (3, 'L3'),
            "history:1": (5, 'L3'),
            "history:2": (0, 'active'),
            "file.py": (6, 'L2'),
        })
        
        removed = tracker.remove_by_prefix("history:")
        
        assert set(removed) == {"history:0", "history:1", "history:2"}
        assert tracker.get_tier("history:0") == 'active'  # Gone, returns default
        assert tracker.get_tier("history:1") == 'active'
        assert tracker.get_tier("file.py") == 'L2'  # Untouched
    
    def test_remove_by_prefix_cleans_last_active(self, tracker_with_items):
        """Prefix removal also cleans _last_active_items."""
        tracker = tracker_with_items({
            "history:0": (0, 'active'),
            "history:1": (0, 'active'),
            "file.py": (0, 'active'),
        }, last_active={"history:0", "history:1", "file.py"})
        
        tracker.remove_by_prefix("history:")
        
        assert "history:0" not in tracker._last_active_items
        assert "history:1" not in tracker._last_active_items
        assert "file.py" in tracker._last_active_items
    
    def test_remove_by_prefix_no_matches(self, stability_tracker):
        """No-op when prefix matches nothing."""
        stability_tracker._stability["file.py"] = StabilityInfo(
            content_hash="abc", n_value=3, tier='L3'
        )
        
        removed = stability_tracker.remove_by_prefix("history:")
        
        assert removed == []
        assert "file.py" in stability_tracker._stability
    
    def test_remove_by_prefix_persists(self, stability_path):
        """Removal is persisted to disk."""
        tracker = StabilityTracker(
            persistence_path=stability_path,
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        tracker._stability = {
            "history:0": StabilityInfo(content_hash="a", n_value=5, tier='L3'),
            "file.py": StabilityInfo(content_hash="b", n_value=6, tier='L2'),
        }
        tracker.save()
        
        tracker.remove_by_prefix("history:")
        
        # Reload from disk
        tracker2 = StabilityTracker(
            persistence_path=stability_path,
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
        )
        assert "history:0" not in tracker2._stability
        assert "file.py" in tracker2._stability
    
    def test_remove_by_prefix_empty_tracker(self, stability_tracker):
        """Works on empty tracker without error."""
        removed = stability_tracker.remove_by_prefix("history:")
        assert removed == []


class TestStabilityTrackerHistoryItems:
    """Tests for history items tracked via ripple promotion."""
    
    def test_history_items_start_active(self, stability_tracker):
        """History items start in active like any other item."""
        content = {"history:0": "user:Hello", "history:1": "assistant:Hi"}
        stability_tracker.update_after_response(
            items=["history:0", "history:1"],
            get_content=lambda x: content[x]
        )
        
        assert stability_tracker.get_tier("history:0") == 'active'
        assert stability_tracker.get_tier("history:1") == 'active'
    
    def test_history_items_promote_to_l3(self, stability_tracker):
        """History items promote to L3 when they leave active context."""
        content = {
            "history:0": "user:Hello",
            "history:1": "assistant:Hi",
            "history:2": "user:New question",
        }
        
        # Round 1: Two history messages in active
        stability_tracker.update_after_response(
            items=["history:0", "history:1"],
            get_content=lambda x: content[x]
        )
        
        # Round 2: New message added, old ones still present
        # All three are "active" - they're all in the items list
        stability_tracker.update_after_response(
            items=["history:0", "history:1", "history:2"],
            get_content=lambda x: content[x]
        )
        
        # history:0 and history:1 are veterans, get N++
        assert stability_tracker.get_n_value("history:0") == 1
        assert stability_tracker.get_n_value("history:1") == 1
        assert stability_tracker.get_n_value("history:2") == 0
    
    def test_history_items_never_modified(self, stability_tracker):
        """History items never change content, so N always increases."""
        content = {"history:0": "user:Hello"}
        
        # Simulate several rounds with same history item always present
        for _ in range(4):
            stability_tracker.update_after_response(
                items=["history:0"],
                get_content=lambda x: content[x]
            )
        
        # N should be 3 (first round N=0, then 3 increments)
        assert stability_tracker.get_n_value("history:0") == 3
        # Items stay active while in the active items list — caller controls graduation
        assert stability_tracker.get_tier("history:0") == 'active'
    
    def test_history_coexists_with_files(self, stability_tracker):
        """History items and file items tracked independently."""
        content = {
            "history:0": "user:Hello",
            "test.py": "print('hello')",
        }
        
        stability_tracker.update_after_response(
            items=["history:0", "test.py"],
            get_content=lambda x: content[x]
        )
        
        assert stability_tracker.get_tier("history:0") == 'active'
        assert stability_tracker.get_tier("test.py") == 'active'
        
        tiers = stability_tracker.get_items_by_tier(["history:0", "test.py"])
        assert "history:0" in tiers['active']
        assert "test.py" in tiers['active']
    
    def test_history_cascade_promotion(self, tracker_with_items):
        """History items participate in cascade promotion like any item."""
        tracker = tracker_with_items({
            "history:0": (5, 'L3'),  # One away from promotion
            "history:1": (0, 'active'),
        }, last_active={"history:1"})
        
        content = {"history:0": "user:old", "history:1": "assistant:old", "other": "x"}
        
        # history:1 leaves active, enters L3
        # history:0 is veteran in L3, gets N++ → N=6, promotes to L2
        tracker.update_after_response(
            items=["other"],
            get_content=lambda x: content.get(x, "x")
        )
        
        assert tracker.get_tier("history:0") == 'L2'
        assert tracker.get_n_value("history:0") == 6
        assert tracker.get_tier("history:1") == 'L3'
        assert tracker.get_n_value("history:1") == 3
    
    def test_history_clear_removes_all_history(self, tracker_with_items):
        """Clearing history removes all history:* items."""
        tracker = tracker_with_items({
            "history:0": (9, 'L1'),
            "history:1": (6, 'L2'),
            "history:2": (3, 'L3'),
            "file.py": (6, 'L2'),
        })
        
        removed = tracker.remove_by_prefix("history:")
        
        assert len(removed) == 3
        assert tracker.get_tier("file.py") == 'L2'  # Untouched
        assert tracker.get_tier("history:0") == 'active'  # Gone
    
    def test_history_reregistration_after_compaction(self, stability_tracker):
        """After compaction, old history is removed and new history starts fresh."""
        content = {
            "history:0": "user:old message",
            "history:1": "assistant:old reply",
            "other": "x",
        }
        
        # Build up some stability while in active items list
        for _ in range(4):
            stability_tracker.update_after_response(
                items=["history:0", "history:1"],
                get_content=lambda x: content[x]
            )
        
        # Items stay active while in items list (caller controls graduation)
        assert stability_tracker.get_n_value("history:0") == 3
        
        # Now let them leave active to enter L3
        stability_tracker.update_after_response(
            items=["other"],
            get_content=lambda x: content[x]
        )
        assert stability_tracker.get_tier("history:0") == 'L3'
        
        # Simulate compaction: remove old entries
        stability_tracker.remove_by_prefix("history:")
        
        # Re-register with compacted content
        compacted = {"history:0": "system:Summary of conversation"}
        stability_tracker.update_after_response(
            items=["history:0"],
            get_content=lambda x: compacted[x]
        )
        
        # Should start fresh at active
        assert stability_tracker.get_tier("history:0") == 'active'
        assert stability_tracker.get_n_value("history:0") == 0


class TestStabilityTrackerHistoryGraduation:
    """Tests for controlled history graduation logic.
    
    These test the graduation policy that would be called by streaming.py.
    The policy is: history stays active until piggybacking on a file/symbol
    ripple, or until eligible history tokens exceed cache_target_tokens.
    """
    
    def test_short_conversation_no_graduation(self, stability_tracker_with_threshold):
        """In a short conversation, all history stays active — zero ripple."""
        tracker = stability_tracker_with_threshold  # cache_target_tokens=1000
        
        # Simulate 3 exchanges, all history always in active items
        content = {}
        for round_num in range(3):
            items = []
            for i in range(round_num + 1):
                key = f"history:{i}"
                content[key] = f"user:message {i}"
                items.append(key)
            
            tracker.update_after_response(
                items=items,
                get_content=lambda x: content[x],
                get_tokens=lambda x: 100,  # 100 tokens each
            )
        
        # All history should still be active (300 tokens < 1000 target)
        for i in range(3):
            assert tracker.get_tier(f"history:{i}") == 'active'
    
    def test_eligible_history_stays_active_below_threshold(self, stability_tracker_with_threshold):
        """History with N >= 3 stays active if total tokens below threshold."""
        tracker = stability_tracker_with_threshold  # cache_target_tokens=1000
        
        content = {"history:0": "user:hello", "history:1": "assistant:hi"}
        
        # Run enough rounds for N to reach 3
        for _ in range(4):
            tracker.update_after_response(
                items=["history:0", "history:1"],
                get_content=lambda x: content[x],
                get_tokens=lambda x: 100,
            )
        
        # N should be 3 (first round N=0, then 3 increments)
        assert tracker.get_n_value("history:0") == 3
        assert tracker.get_n_value("history:1") == 3
        
        # But they should still be in active because we kept them in items list
        # (the caller's graduation logic would keep them active since 200 < 1000)
        assert tracker.get_tier("history:0") == 'active'
        assert tracker.get_tier("history:1") == 'active'
    
    def test_history_graduates_when_excluded_from_items(self, stability_tracker_with_threshold):
        """History graduates to L3 when excluded from the active items list."""
        tracker = stability_tracker_with_threshold
        
        content = {"history:0": "user:hello", "history:1": "assistant:hi", "other": "x"}
        
        # Build up N to 3
        for _ in range(4):
            tracker.update_after_response(
                items=["history:0", "history:1"],
                get_content=lambda x: content[x],
                get_tokens=lambda x: 100,
            )
        
        assert tracker.get_n_value("history:0") == 3
        assert tracker.get_tier("history:0") == 'active'
        
        # Now exclude history:0 from items (simulating graduation decision)
        tracker.update_after_response(
            items=["history:1", "other"],
            get_content=lambda x: content[x],
            get_tokens=lambda x: 100,
        )
        
        # history:0 left active, should enter L3
        assert tracker.get_tier("history:0") == 'L3'
        assert tracker.get_n_value("history:0") == 3
    
    def test_file_leaving_active_triggers_ripple(self, stability_tracker_with_threshold):
        """When a file leaves active, it causes a ripple that history can piggyback on."""
        tracker = stability_tracker_with_threshold
        
        content = {
            "file.py": "content",
            "history:0": "user:hello",
            "history:1": "assistant:hi",
            "other": "x",
        }
        
        # Round 1: file and history in active
        tracker.update_after_response(
            items=["file.py", "history:0", "history:1"],
            get_content=lambda x: content[x],
            get_tokens=lambda x: 200,
        )
        
        # Rounds 2-4: same items, building N
        for _ in range(3):
            tracker.update_after_response(
                items=["file.py", "history:0", "history:1"],
                get_content=lambda x: content[x],
                get_tokens=lambda x: 200,
            )
        
        # N should be 3 for all items
        assert tracker.get_n_value("history:0") == 3
        assert tracker.get_n_value("file.py") == 3
        
        # Round 5: file.py leaves active (simulating piggybacking -
        # caller would also exclude eligible history from items)
        tracker.update_after_response(
            items=["other"],  # Both file and history excluded
            get_content=lambda x: content[x],
            get_tokens=lambda x: 200,
        )
        
        # Both file and history should be in L3
        assert tracker.get_tier("file.py") == 'L3'
        assert tracker.get_tier("history:0") == 'L3'
        assert tracker.get_tier("history:1") == 'L3'


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
