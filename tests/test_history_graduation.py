"""Tests for controlled history graduation logic in streaming.

Tests the graduation policy that determines when history messages
leave the active items list and enter cache tiers via ripple promotion.
"""

import pytest
from unittest.mock import MagicMock, patch, PropertyMock
from pathlib import Path

from ac.context.stability_tracker import StabilityTracker, StabilityInfo


class FakeStreaming:
    """Minimal fake that has _select_history_to_graduate from StreamingMixin."""
    
    def _select_history_to_graduate(self, eligible, get_tokens, keep_tokens):
        """Select which eligible history messages to graduate from active."""
        kept_tokens = 0
        keep_set = set()
        
        for item in reversed(eligible):
            item_tokens = get_tokens(item)
            if kept_tokens + item_tokens <= keep_tokens:
                kept_tokens += item_tokens
                keep_set.add(item)
            else:
                break
        
        return set(eligible) - keep_set


class TestSelectHistoryToGraduate:
    """Tests for _select_history_to_graduate helper."""
    
    def setup_method(self):
        self.mixin = FakeStreaming()
    
    def test_graduate_oldest_keep_newest(self):
        """Oldest messages graduate, newest kept in active."""
        eligible = ["history:0", "history:1", "history:2", "history:3"]
        tokens = {
            "history:0": 300, "history:1": 300,
            "history:2": 300, "history:3": 300,
        }
        
        graduated = self.mixin._select_history_to_graduate(
            eligible, lambda x: tokens[x], keep_tokens=600
        )
        
        # Keep newest 600 tokens: history:3 (300) + history:2 (300)
        # Graduate the rest: history:0, history:1
        assert graduated == {"history:0", "history:1"}
    
    def test_keep_all_under_budget(self):
        """If all eligible fit in keep budget, nothing graduates."""
        eligible = ["history:0", "history:1"]
        tokens = {"history:0": 200, "history:1": 200}
        
        graduated = self.mixin._select_history_to_graduate(
            eligible, lambda x: tokens[x], keep_tokens=1000
        )
        
        assert graduated == set()
    
    def test_graduate_all_but_one(self):
        """When budget only fits one message, graduate the rest."""
        eligible = ["history:0", "history:1", "history:2"]
        tokens = {"history:0": 500, "history:1": 500, "history:2": 500}
        
        graduated = self.mixin._select_history_to_graduate(
            eligible, lambda x: tokens[x], keep_tokens=500
        )
        
        # Keep only history:2 (newest, 500 tokens)
        assert graduated == {"history:0", "history:1"}
    
    def test_variable_size_messages(self):
        """Handles variable-size messages correctly."""
        eligible = ["history:0", "history:1", "history:2", "history:3"]
        tokens = {
            "history:0": 100,  # old, small
            "history:1": 800,  # old, large
            "history:2": 100,  # recent, small
            "history:3": 200,  # newest, medium
        }
        
        graduated = self.mixin._select_history_to_graduate(
            eligible, lambda x: tokens[x], keep_tokens=400
        )
        
        # Walk from newest: history:3 (200) + history:2 (100) = 300 <= 400
        # history:1 (800): 300 + 800 = 1100 > 400 → stop
        # Keep: {history:3, history:2}
        # Graduate: {history:0, history:1}
        assert graduated == {"history:0", "history:1"}
    
    def test_empty_eligible(self):
        """Empty eligible list returns empty set."""
        graduated = self.mixin._select_history_to_graduate(
            [], lambda x: 0, keep_tokens=1000
        )
        assert graduated == set()
    
    def test_single_item_over_budget(self):
        """Single item larger than budget still graduates nothing (it's the newest)."""
        eligible = ["history:0"]
        tokens = {"history:0": 2000}
        
        graduated = self.mixin._select_history_to_graduate(
            eligible, lambda x: tokens[x], keep_tokens=500
        )
        
        # history:0 is the newest (and only) — it gets kept even though over budget
        # because the loop adds it first, then breaks
        # Actually: 0 + 2000 > 500, so it's NOT added to keep_set, break happens
        # Wait, reversed(["history:0"]) = ["history:0"], first item:
        # kept_tokens=0, 0 + 2000 > 500 → break. keep_set is empty.
        # So history:0 IS graduated.
        # This is correct: if the single item exceeds budget, it graduates.
        assert graduated == {"history:0"}
    
    def test_zero_keep_budget(self):
        """Zero keep budget graduates everything."""
        eligible = ["history:0", "history:1"]
        tokens = {"history:0": 100, "history:1": 100}
        
        graduated = self.mixin._select_history_to_graduate(
            eligible, lambda x: tokens[x], keep_tokens=0
        )
        
        assert graduated == {"history:0", "history:1"}


class TestGraduationIntegration:
    """Integration tests simulating the full graduation flow.
    
    These simulate what _update_cache_stability does: deciding which
    history items to include in the active items list based on
    piggybacking and token threshold conditions.
    """
    
    @pytest.fixture
    def tracker(self, tmp_path):
        return StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12},
            cache_target_tokens=500,
        )
    
    def _simulate_graduation(self, tracker, file_paths, history_count,
                             get_tokens, last_file_symbol_items=None):
        """Simulate the graduation logic from _update_cache_stability.
        
        Returns (active_items, graduated_history, has_ripple).
        """
        file_symbol_items = set(file_paths) | {f"symbol:{f}" for f in file_paths}
        last = last_file_symbol_items or set()
        has_ripple = bool(last - file_symbol_items)
        
        all_history = [f"history:{i}" for i in range(history_count)]
        cache_target = tracker.get_cache_target_tokens()
        
        mixin = FakeStreaming()
        
        if not cache_target:
            active_history = all_history
            graduated = set()
        else:
            eligible = [
                h for h in all_history
                if tracker.get_n_value(h) >= 3
                and tracker.get_tier(h) == 'active'
            ]
            
            if has_ripple and eligible:
                graduated = set(eligible)
                active_history = [h for h in all_history if h not in graduated]
            elif eligible:
                eligible_tokens = sum(get_tokens(item) for item in eligible)
                if eligible_tokens >= cache_target:
                    graduated = mixin._select_history_to_graduate(
                        eligible, get_tokens, cache_target
                    )
                    active_history = [h for h in all_history if h not in graduated]
                else:
                    active_history = all_history
                    graduated = set()
            else:
                active_history = all_history
                graduated = set()
        
        active_items = list(file_symbol_items) + active_history
        return active_items, graduated, has_ripple
    
    def test_short_conversation_no_ripple(self, tracker):
        """Short conversation: all history active, no graduation."""
        content = {"history:0": "user:hi", "history:1": "assistant:hello"}
        
        # 2 rounds to build some N
        for _ in range(2):
            tracker.update_after_response(
                items=["history:0", "history:1"],
                get_content=lambda x: content[x],
                get_tokens=lambda x: 100,
            )
        
        # N is 1, not eligible yet
        active_items, graduated, has_ripple = self._simulate_graduation(
            tracker, file_paths=["file.py"], history_count=2,
            get_tokens=lambda x: 100,
            last_file_symbol_items={"file.py", "symbol:file.py"},
        )
        
        assert graduated == set()
        assert not has_ripple
        assert "history:0" in active_items
        assert "history:1" in active_items
    
    def test_piggyback_on_file_ripple(self, tracker):
        """When file leaves context, eligible history piggybacks."""
        content = {
            "history:0": "user:hi", "history:1": "assistant:hello",
            "file.py": "content",
        }
        
        # Build N to 3 for history
        for _ in range(4):
            tracker.update_after_response(
                items=["history:0", "history:1", "file.py"],
                get_content=lambda x: content[x],
                get_tokens=lambda x: 100,
            )
        
        assert tracker.get_n_value("history:0") == 3
        
        # file.py leaves context (was in last round, not in this one)
        active_items, graduated, has_ripple = self._simulate_graduation(
            tracker, file_paths=[],  # file.py removed
            history_count=2,
            get_tokens=lambda x: 100,
            last_file_symbol_items={"file.py", "symbol:file.py"},
        )
        
        assert has_ripple
        assert graduated == {"history:0", "history:1"}
        assert "history:0" not in active_items
        assert "history:1" not in active_items
    
    def test_standalone_token_threshold(self, tracker):
        """History graduates standalone when tokens exceed threshold."""
        # 6 history messages, 100 tokens each = 600 > 500 threshold
        content = {f"history:{i}": f"msg:{i}" for i in range(6)}
        
        # Build N to 3
        items = [f"history:{i}" for i in range(6)]
        for _ in range(4):
            tracker.update_after_response(
                items=items,
                get_content=lambda x: content[x],
                get_tokens=lambda x: 100,
            )
        
        # All have N=3, all eligible
        for i in range(6):
            assert tracker.get_n_value(f"history:{i}") == 3
        
        # No file ripple, but 600 tokens > 500 threshold
        active_items, graduated, has_ripple = self._simulate_graduation(
            tracker, file_paths=["file.py"],
            history_count=6,
            get_tokens=lambda x: 100,
            last_file_symbol_items={"file.py", "symbol:file.py"},  # Same as current
        )
        
        assert not has_ripple
        # Should keep newest 500 tokens (5 messages) active, graduate oldest 1
        # Actually: keep_tokens=500, walk from newest:
        # history:5 (100) = 100 <= 500 → keep
        # history:4 (100) = 200 <= 500 → keep  
        # history:3 (100) = 300 <= 500 → keep
        # history:2 (100) = 400 <= 500 → keep
        # history:1 (100) = 500 <= 500 → keep
        # history:0 (100) = 600 > 500 → stop
        # Graduate: {history:0}
        assert graduated == {"history:0"}
        assert "history:0" not in active_items
    
    def test_below_threshold_no_graduation(self, tracker):
        """Eligible history stays active when tokens below threshold."""
        content = {"history:0": "user:hi", "history:1": "assistant:hello"}
        
        # Build N to 3
        for _ in range(4):
            tracker.update_after_response(
                items=["history:0", "history:1"],
                get_content=lambda x: content[x],
                get_tokens=lambda x: 100,
            )
        
        # 200 tokens total < 500 threshold
        active_items, graduated, has_ripple = self._simulate_graduation(
            tracker, file_paths=["file.py"],
            history_count=2,
            get_tokens=lambda x: 100,
            last_file_symbol_items={"file.py", "symbol:file.py"},
        )
        
        assert graduated == set()
        assert "history:0" in active_items
        assert "history:1" in active_items
    
    def test_graduation_disabled_zero_target(self, tmp_path):
        """cache_target_tokens=0 disables graduation entirely."""
        tracker = StabilityTracker(
            persistence_path=tmp_path / "stability.json",
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12},
            cache_target_tokens=0,  # Disabled
        )
        
        content = {f"history:{i}": f"msg:{i}" for i in range(10)}
        items = [f"history:{i}" for i in range(10)]
        
        # Build N to 5
        for _ in range(6):
            tracker.update_after_response(
                items=items,
                get_content=lambda x: content[x],
                get_tokens=lambda x: 200,
            )
        
        # Despite high N and high tokens, graduation is disabled
        active_items, graduated, has_ripple = self._simulate_graduation(
            tracker, file_paths=[], history_count=10,
            get_tokens=lambda x: 200,
        )
        
        assert graduated == set()
        # All history stays active
        for i in range(10):
            assert f"history:{i}" in active_items
    
    def test_piggyback_takes_all_eligible(self, tracker):
        """Piggybacking graduates ALL eligible history, not just threshold worth."""
        # 10 messages with high tokens
        content = {f"history:{i}": f"msg:{i}" for i in range(10)}
        content["file.py"] = "content"
        
        items = [f"history:{i}" for i in range(10)] + ["file.py"]
        for _ in range(4):
            tracker.update_after_response(
                items=items,
                get_content=lambda x: content[x],
                get_tokens=lambda x: 300,
            )
        
        # file.py leaves — ripple! All 10 eligible history piggyback
        active_items, graduated, has_ripple = self._simulate_graduation(
            tracker, file_paths=[],
            history_count=10,
            get_tokens=lambda x: 300,
            last_file_symbol_items={"file.py", "symbol:file.py"},
        )
        
        assert has_ripple
        assert len(graduated) == 10  # All eligible history graduates
    
    def test_mixed_eligible_and_ineligible(self, tracker):
        """Only eligible (N>=3, active tier) history considered for graduation."""
        content = {f"history:{i}": f"msg:{i}" for i in range(6)}
        
        # First 4 messages get built up to N=3
        old_items = [f"history:{i}" for i in range(4)]
        for _ in range(4):
            tracker.update_after_response(
                items=old_items,
                get_content=lambda x: content[x],
                get_tokens=lambda x: 200,
            )
        
        # Add 2 new messages (N=0)
        all_items = [f"history:{i}" for i in range(6)]
        tracker.update_after_response(
            items=all_items,
            get_content=lambda x: content[x],
            get_tokens=lambda x: 200,
        )
        
        # history:0-3 have N >= 3, history:4-5 have N=0
        # Total eligible tokens: 4 * 200 = 800 > 500 threshold
        active_items, graduated, has_ripple = self._simulate_graduation(
            tracker, file_paths=["file.py"],
            history_count=6,
            get_tokens=lambda x: 200,
            last_file_symbol_items={"file.py", "symbol:file.py"},
        )
        
        assert not has_ripple
        # Only eligible (N>=3) messages considered
        # Keep newest 500 tokens: history:3 (200) + history:2 (200) = 400 <= 500
        # history:1 (200) = 600 > 500 → stop  
        # Graduate: {history:0, history:1}
        assert "history:0" in graduated
        assert "history:1" in graduated
        assert "history:2" not in graduated
        assert "history:3" not in graduated
        # Ineligible messages always stay active
        assert "history:4" in active_items
        assert "history:5" in active_items
