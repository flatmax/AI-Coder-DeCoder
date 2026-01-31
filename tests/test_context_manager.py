"""Tests for ac/context/manager.py"""

import pytest
from ac.context import ContextManager, TokenCounter


class TestContextManagerInit:
    """Tests for ContextManager initialization."""
    
    def test_init_creates_token_counter(self):
        mgr = ContextManager("gpt-4")
        assert mgr.token_counter is not None
        assert mgr.token_counter.model_name == "gpt-4"
    
    def test_init_creates_file_context(self):
        mgr = ContextManager("gpt-4")
        assert mgr.file_context is not None
    
    def test_init_empty_history(self):
        mgr = ContextManager("gpt-4")
        assert mgr.get_history() == []
    
    def test_init_sets_max_history_tokens(self):
        mgr = ContextManager("gpt-4")
        # Should be 1/16 of max input
        expected = mgr.token_counter.max_input_tokens // 16
        assert mgr.max_history_tokens == expected


class TestContextManagerHistory:
    """Tests for history management."""
    
    def test_add_message(self):
        mgr = ContextManager("gpt-4")
        mgr.add_message("user", "Hello")
        
        history = mgr.get_history()
        assert len(history) == 1
        assert history[0] == {"role": "user", "content": "Hello"}
    
    def test_add_exchange(self):
        mgr = ContextManager("gpt-4")
        mgr.add_exchange("Hello", "Hi there!")
        
        history = mgr.get_history()
        assert len(history) == 2
        assert history[0] == {"role": "user", "content": "Hello"}
        assert history[1] == {"role": "assistant", "content": "Hi there!"}
    
    def test_get_history_returns_copy(self):
        mgr = ContextManager("gpt-4")
        mgr.add_message("user", "Test")
        
        history1 = mgr.get_history()
        history1.append({"role": "user", "content": "Modified"})
        history2 = mgr.get_history()
        
        assert len(history2) == 1  # Original unchanged
    
    def test_set_history(self):
        mgr = ContextManager("gpt-4")
        mgr.add_message("user", "Original")
        
        new_history = [{"role": "user", "content": "New"}]
        mgr.set_history(new_history)
        
        assert mgr.get_history() == new_history
    
    def test_set_history_copies(self):
        mgr = ContextManager("gpt-4")
        new_history = [{"role": "user", "content": "Test"}]
        mgr.set_history(new_history)
        
        new_history.append({"role": "assistant", "content": "Modified"})
        
        assert len(mgr.get_history()) == 1  # Original unchanged
    
    def test_clear_history(self):
        mgr = ContextManager("gpt-4")
        mgr.add_message("user", "Hello")
        mgr.add_message("assistant", "Hi")
        
        mgr.clear_history()
        
        assert mgr.get_history() == []
    
    def test_history_token_count_empty(self):
        mgr = ContextManager("gpt-4")
        assert mgr.history_token_count() == 0
    
    def test_history_token_count_with_messages(self):
        mgr = ContextManager("gpt-4")
        mgr.add_message("user", "Hello, this is a test message.")
        
        count = mgr.history_token_count()
        assert count > 0


class TestContextManagerSummarization:
    """Tests for summarization support."""
    
    def test_history_needs_summary_empty(self):
        mgr = ContextManager("gpt-4")
        assert mgr.history_needs_summary() is False
    
    def test_history_needs_summary_small(self):
        mgr = ContextManager("gpt-4")
        mgr.add_message("user", "Short message")
        assert mgr.history_needs_summary() is False
    
    def test_history_needs_summary_large(self):
        mgr = ContextManager("gpt-4")
        # Add enough messages to exceed budget
        large_content = "word " * 2000  # ~2000 tokens
        for i in range(10):
            mgr.add_message("user", large_content)
        
        assert mgr.history_needs_summary() is True
    
    def test_get_summarization_split_not_needed(self):
        mgr = ContextManager("gpt-4")
        mgr.add_message("user", "Small message")
        
        head, tail = mgr.get_summarization_split()
        
        assert head == []
        assert tail == mgr.get_history()
    
    def test_get_summarization_split_returns_tuples(self):
        mgr = ContextManager("gpt-4")
        # Add enough to trigger summarization
        large_content = "word " * 2000
        for i in range(10):
            mgr.add_message("user", large_content)
            mgr.add_message("assistant", large_content)
        
        head, tail = mgr.get_summarization_split()
        
        assert isinstance(head, list)
        assert isinstance(tail, list)
        assert len(head) + len(tail) == len(mgr.get_history())


class TestContextManagerTokenCounting:
    """Tests for token counting."""
    
    def test_count_tokens_string(self):
        mgr = ContextManager("gpt-4")
        count = mgr.count_tokens("Hello, world!")
        assert count > 0
    
    def test_count_tokens_message(self):
        mgr = ContextManager("gpt-4")
        count = mgr.count_tokens({"role": "user", "content": "Hello"})
        assert count > 0
    
    def test_get_token_budget(self):
        mgr = ContextManager("gpt-4")
        mgr.add_message("user", "Test message")
        
        budget = mgr.get_token_budget()
        
        assert "history_tokens" in budget
        assert "max_history_tokens" in budget
        assert "max_input_tokens" in budget
        assert "remaining" in budget
        assert "needs_summary" in budget
        assert budget["history_tokens"] > 0
        assert budget["needs_summary"] is False


class TestContextManagerTokenReport:
    """Tests for token report generation."""
    
    def test_get_token_report_empty(self):
        mgr = ContextManager("gpt-4")
        report = mgr.get_token_report()
        
        assert "gpt-4" in report
        assert "tokens" in report.lower()
    
    def test_get_token_report_with_system(self):
        mgr = ContextManager("gpt-4")
        report = mgr.get_token_report(system_prompt="You are a helpful assistant.")
        
        assert "system" in report.lower()
    
    def test_get_token_report_with_history(self):
        mgr = ContextManager("gpt-4")
        mgr.add_message("user", "Hello")
        mgr.add_message("assistant", "Hi there!")
        
        report = mgr.get_token_report()
        
        assert "history" in report.lower()
    
    def test_get_token_report_with_files(self):
        mgr = ContextManager("gpt-4")
        mgr.file_context.add_file("test.py", "print('hello')")
        
        report = mgr.get_token_report()
        
        assert "test.py" in report
    
    def test_get_token_report_shows_remaining(self):
        mgr = ContextManager("gpt-4")
        report = mgr.get_token_report()
        
        assert "remaining" in report.lower()


class TestContextManagerCacheStability:
    """Tests for unified cache stability tracking."""
    
    def test_cache_stability_initialized_with_repo_root(self, tmp_path):
        """cache_stability tracker is created when repo_root is provided."""
        mgr = ContextManager("gpt-4", repo_root=str(tmp_path))
        assert mgr.cache_stability is not None
    
    def test_cache_stability_not_initialized_without_repo_root(self):
        """cache_stability is None when no repo_root provided."""
        mgr = ContextManager("gpt-4")
        assert mgr.cache_stability is None
    
    def test_cache_stability_uses_4_tier_thresholds(self, tmp_path):
        """cache_stability uses L0-L3 thresholds for Bedrock compatibility."""
        mgr = ContextManager("gpt-4", repo_root=str(tmp_path))
        thresholds = mgr.cache_stability.get_thresholds()
        
        assert thresholds == {'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
    
    def test_cache_stability_initial_tier_is_active(self, tmp_path):
        """New items in Active context start as 'active' tier."""
        mgr = ContextManager("gpt-4", repo_root=str(tmp_path))
        
        # Track a new item - items in Active context start as 'active'
        mgr.cache_stability.update_after_response(
            items=["test.py"],
            get_content=lambda x: "print('hello')"
        )
        
        assert mgr.cache_stability.get_tier("test.py") == 'active'
        assert mgr.cache_stability.get_n_value("test.py") == 0
    
    def test_cache_stability_persists_to_file(self, tmp_path):
        """Stability data is persisted to .aicoder/cache_stability.json."""
        mgr = ContextManager("gpt-4", repo_root=str(tmp_path))
        
        mgr.cache_stability.update_after_response(
            items=["test.py"],
            get_content=lambda x: "print('hello')"
        )
        
        stability_file = tmp_path / ".aicoder" / "cache_stability.json"
        assert stability_file.exists()
    
    def test_cache_stability_tracks_symbol_entries(self, tmp_path):
        """Symbol entries use 'symbol:' prefix to distinguish from files."""
        mgr = ContextManager("gpt-4", repo_root=str(tmp_path))
        
        # Track both a file and a symbol entry - they start as active
        mgr.cache_stability.update_after_response(
            items=["test.py", "symbol:test.py"],
            get_content=lambda x: "content" if x == "test.py" else "symbol_hash_123"
        )
        
        # Items in Active context start as 'active' tier
        assert mgr.cache_stability.get_tier("test.py") == 'active'
        assert mgr.cache_stability.get_tier("symbol:test.py") == 'active'
        
        # When they leave Active, they move to L3
        mgr.cache_stability.update_after_response(
            items=[],  # Both items leave Active
            get_content=lambda x: "content" if x == "test.py" else "symbol_hash_123"
        )
        
        assert mgr.cache_stability.get_tier("test.py") == 'L3'
        assert mgr.cache_stability.get_tier("symbol:test.py") == 'L3'
    
    def test_cache_stability_get_items_by_tier(self, tmp_path):
        """get_items_by_tier returns items grouped by stability tier."""
        mgr = ContextManager("gpt-4", repo_root=str(tmp_path))
        
        # Track items - they start as active
        mgr.cache_stability.update_after_response(
            items=["a.py", "b.py"],
            get_content=lambda x: f"content_{x}"
        )
        
        tiers = mgr.cache_stability.get_items_by_tier(["a.py", "b.py"])
        
        assert 'L0' in tiers
        assert 'L1' in tiers
        assert 'L2' in tiers
        assert 'L3' in tiers
        assert 'active' in tiers
        # Items in Active context are in 'active' tier
        assert set(tiers['active']) == {"a.py", "b.py"}
        
        # After they leave Active, they move to L3
        mgr.cache_stability.update_after_response(
            items=[],  # Both items leave Active
            get_content=lambda x: f"content_{x}"
        )
        
        tiers = mgr.cache_stability.get_items_by_tier(["a.py", "b.py"])
        assert set(tiers['L3']) == {"a.py", "b.py"}


class TestContextManagerHUD:
    """Tests for HUD output (just verify they don't crash)."""
    
    def test_print_hud_no_crash(self, capsys):
        mgr = ContextManager("gpt-4")
        mgr.add_message("user", "Test")
        
        mgr.print_hud(system_tokens=100, symbol_map_tokens=50)
        
        captured = capsys.readouterr()
        assert "gpt-4" in captured.out
        assert "CONTEXT HUD" in captured.out
    
    def test_print_compact_hud_no_crash(self, capsys):
        mgr = ContextManager("gpt-4")
        mgr.add_message("user", "Test")
        
        mgr.print_compact_hud()
        
        captured = capsys.readouterr()
        assert "History" in captured.out
