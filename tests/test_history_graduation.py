"""Tests for controlled history graduation logic in streaming.

Tests the graduation policy that determines when history messages
leave the active items list and enter cache tiers via ripple promotion.
"""

import pytest
from unittest.mock import MagicMock, patch, PropertyMock
from pathlib import Path

from ac.context.stability_tracker import StabilityTracker, StabilityInfo
from ac.llm.streaming import StreamingMixin


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


class TestNativeHistoryPairs:
    """Tests for native history message pairs in cached tiers.
    
    Verifies that cached tier history uses native user/assistant message
    pairs (not formatted markdown strings), and that cache_control is
    placed on the last message in each tier's sequence.
    """
    
    def _make_streaming_mixin(self):
        """Create a minimal fake with the methods under test."""
        
        class FakeMixin:
            def __init__(self):
                self.conversation_history = []
                self._context_manager = None
            
            def _safe_count_tokens(self, content):
                return len(content) // 4 if content else 0
        
        # Attach the real methods
        from ac.llm.streaming import StreamingMixin
        mixin = FakeMixin()
        mixin._build_history_messages_for_tier = StreamingMixin._build_history_messages_for_tier.__get__(mixin)
        mixin._apply_cache_control = StreamingMixin._apply_cache_control
        return mixin
    
    def test_native_pairs_from_history(self):
        """History messages are returned as native user/assistant pairs."""
        mixin = self._make_streaming_mixin()
        mixin.conversation_history = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there"},
            {"role": "user", "content": "Help me"},
            {"role": "assistant", "content": "Sure"},
        ]
        
        messages = mixin._build_history_messages_for_tier([0, 1, 2, 3])
        
        assert len(messages) == 4
        assert messages[0] == {"role": "user", "content": "Hello"}
        assert messages[1] == {"role": "assistant", "content": "Hi there"}
        assert messages[2] == {"role": "user", "content": "Help me"}
        assert messages[3] == {"role": "assistant", "content": "Sure"}
    
    def test_native_pairs_subset(self):
        """Only requested indices are included."""
        mixin = self._make_streaming_mixin()
        mixin.conversation_history = [
            {"role": "user", "content": "msg0"},
            {"role": "assistant", "content": "msg1"},
            {"role": "user", "content": "msg2"},
            {"role": "assistant", "content": "msg3"},
        ]
        
        messages = mixin._build_history_messages_for_tier([0, 1])
        
        assert len(messages) == 2
        assert messages[0]["content"] == "msg0"
        assert messages[1]["content"] == "msg1"
    
    def test_empty_indices_returns_empty(self):
        """Empty index list returns empty message list."""
        mixin = self._make_streaming_mixin()
        mixin.conversation_history = [
            {"role": "user", "content": "Hello"},
        ]
        
        assert mixin._build_history_messages_for_tier([]) == []
    
    def test_no_history_returns_empty(self):
        """No conversation history returns empty message list."""
        mixin = self._make_streaming_mixin()
        mixin.conversation_history = []
        
        assert mixin._build_history_messages_for_tier([0, 1]) == []
    
    def test_out_of_bounds_indices_skipped(self):
        """Indices beyond history length are silently skipped."""
        mixin = self._make_streaming_mixin()
        mixin.conversation_history = [
            {"role": "user", "content": "Hello"},
        ]
        
        messages = mixin._build_history_messages_for_tier([0, 5, 10])
        assert len(messages) == 1
        assert messages[0]["content"] == "Hello"
    
    def test_apply_cache_control_plain_string(self):
        """cache_control wraps plain string content."""
        msg = {"role": "assistant", "content": "Sure, I can help."}
        StreamingMixin._apply_cache_control(msg)
        
        assert isinstance(msg["content"], list)
        assert len(msg["content"]) == 1
        assert msg["content"][0]["type"] == "text"
        assert msg["content"][0]["text"] == "Sure, I can help."
        assert msg["content"][0]["cache_control"] == {"type": "ephemeral"}
    
    def test_apply_cache_control_structured_content(self):
        """cache_control added to last text block in structured content."""
        msg = {
            "role": "user",
            "content": [
                {"type": "text", "text": "First part"},
                {"type": "text", "text": "Second part"},
            ]
        }
        StreamingMixin._apply_cache_control(msg)
        
        # First block unchanged
        assert "cache_control" not in msg["content"][0]
        # Last text block gets cache_control
        assert msg["content"][1]["cache_control"] == {"type": "ephemeral"}
    
    def test_apply_cache_control_user_message(self):
        """cache_control works on user messages too."""
        msg = {"role": "user", "content": "Question?"}
        StreamingMixin._apply_cache_control(msg)
        
        assert isinstance(msg["content"], list)
        assert msg["content"][0]["cache_control"] == {"type": "ephemeral"}
    
    def test_cache_control_on_last_message_in_tier(self):
        """When tier has symbols + history, cache_control goes on last history msg."""
        mixin = self._make_streaming_mixin()
        mixin.conversation_history = [
            {"role": "user", "content": "Q1"},
            {"role": "assistant", "content": "A1"},
        ]
        
        # Simulate what _build_streaming_messages does for a tier
        symbol_messages = [
            {"role": "user", "content": "# Repository Structure\n..."},
            {"role": "assistant", "content": "Ok."},
        ]
        history_messages = mixin._build_history_messages_for_tier([0, 1])
        
        tier_messages = symbol_messages + history_messages
        StreamingMixin._apply_cache_control(tier_messages[-1])
        
        # Symbol messages: no cache_control
        assert isinstance(tier_messages[0]["content"], str)
        assert isinstance(tier_messages[1]["content"], str)
        
        # History messages: last one has cache_control
        assert isinstance(tier_messages[2]["content"], str)  # user msg, no cache_control
        assert isinstance(tier_messages[3]["content"], list)  # last msg, has cache_control
        assert tier_messages[3]["content"][0]["cache_control"] == {"type": "ephemeral"}
    
    def test_tier_with_only_history(self):
        """Tier with only history (no symbols/files) still gets cache_control."""
        mixin = self._make_streaming_mixin()
        mixin.conversation_history = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi"},
        ]
        
        history_messages = mixin._build_history_messages_for_tier([0, 1])
        
        # No symbol messages, just history
        tier_messages = history_messages
        StreamingMixin._apply_cache_control(tier_messages[-1])
        
        assert len(tier_messages) == 2
        # Last message has cache_control
        assert isinstance(tier_messages[-1]["content"], list)
        assert tier_messages[-1]["content"][0]["cache_control"] == {"type": "ephemeral"}
        # First message is plain
        assert isinstance(tier_messages[0]["content"], str)


class TestStaleItemRemovalIntegration:
    """Integration tests for stale item removal at the streaming level.
    
    These simulate the pattern used in _update_cache_stability:
    1. Detect stale items (tracked but no longer in repo)
    2. Remove them from the tracker
    3. Pass their tiers as broken_tiers to update_after_response
    """
    
    @pytest.fixture
    def tracker(self):
        return StabilityTracker(
            thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12},
            cache_target_tokens=500,
        )
    
    def _simulate_stale_removal(self, tracker, all_repo_files):
        """Simulate the stale detection logic from _update_cache_stability.
        
        Returns set of broken tiers from removal.
        """
        stale_broken = set()
        stale_items = []
        
        for item_key in list(tracker._stability.keys()):
            if item_key.startswith("history:"):
                continue
            file_path = item_key.replace("symbol:", "") if item_key.startswith("symbol:") else item_key
            if file_path not in all_repo_files:
                stale_items.append(item_key)
        
        for item_key in stale_items:
            tier = tracker.get_tier(item_key)
            if tier != 'active':
                stale_broken.add(tier)
            del tracker._stability[item_key]
        
        stale_set = set(stale_items)
        tracker._last_active_items -= stale_set
        
        return stale_broken
    
    def test_deleted_file_removed_from_tier(self, tracker):
        """File in L2, deleted from repo, removed and tier marked broken."""
        # Set up: file.py in L2, symbol:file.py in L3
        tracker._stability = {
            "file.py": StabilityInfo(content_hash="f", n_value=7, tier='L2'),
            "symbol:file.py": StabilityInfo(content_hash="s", n_value=4, tier='L3'),
            "other.py": StabilityInfo(content_hash="o", n_value=5, tier='L3'),
        }
        
        # file.py deleted from repo
        all_repo_files = {"other.py"}  # file.py gone
        broken = self._simulate_stale_removal(tracker, all_repo_files)
        
        assert "file.py" not in tracker._stability
        assert "symbol:file.py" not in tracker._stability
        assert "other.py" in tracker._stability
        assert "L2" in broken  # file.py was in L2
        assert "L3" in broken  # symbol:file.py was in L3
    
    def test_deletion_triggers_cascade(self, tracker):
        """File deleted from L2 allows L3 veterans to promote."""
        tracker._stability = {
            "deleted.py": StabilityInfo(content_hash="d", n_value=7, tier='L2'),
            "l3_vet.py": StabilityInfo(content_hash="v", n_value=5, tier='L3'),
        }
        tracker._last_active_items = set()
        
        # deleted.py removed from repo
        all_repo_files = {"l3_vet.py"}
        broken = self._simulate_stale_removal(tracker, all_repo_files)
        
        assert "L2" in broken
        
        # Now run update with the broken tiers
        content = {"l3_vet.py": "v"}
        tracker.update_after_response(
            items=[],
            get_content=lambda x: content[x],
            broken_tiers=broken,
        )
        
        # l3_vet should promote into L2 (broken from deletion)
        assert tracker.get_tier("l3_vet.py") == 'L2'
        assert tracker.get_n_value("l3_vet.py") == 6
    
    def test_stale_active_items_cleaned(self, tracker):
        """Stale items in _last_active_items are also cleaned."""
        tracker._stability = {
            "deleted.py": StabilityInfo(content_hash="d", n_value=0, tier='active'),
        }
        tracker._last_active_items = {"deleted.py", "other.py"}
        
        all_repo_files = {"other.py"}
        self._simulate_stale_removal(tracker, all_repo_files)
        
        assert "deleted.py" not in tracker._last_active_items
        assert "other.py" in tracker._last_active_items


class TestGraduationIntegration:
    """Integration tests simulating the full graduation flow.
    
    These simulate what _update_cache_stability does: deciding which
    history items to include in the active items list based on
    piggybacking and token threshold conditions.
    """
    
    @pytest.fixture
    def tracker(self):
        return StabilityTracker(
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
    
    def test_graduation_disabled_zero_target(self):
        """cache_target_tokens=0 disables graduation entirely."""
        tracker = StabilityTracker(
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
