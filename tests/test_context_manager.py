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
    """Tests for compaction support (replaced legacy summarization)."""
    
    def test_should_compact_empty(self):
        mgr = ContextManager("gpt-4")
        assert mgr.should_compact() is False
    
    def test_should_compact_small(self):
        mgr = ContextManager("gpt-4")
        mgr.add_message("user", "Short message")
        assert mgr.should_compact() is False
    
    def test_should_compact_disabled_by_default(self):
        mgr = ContextManager("gpt-4")
        # Add large content - but compaction is disabled without config
        large_content = "word " * 2000
        for i in range(10):
            mgr.add_message("user", large_content)
        
        # should_compact returns False when compaction is disabled
        assert mgr.should_compact() is False


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


class TestContextManagerCompaction:
    """Tests for history compaction integration."""
    
    def test_compaction_disabled_by_default_without_config(self):
        """Compaction is disabled when no config provided."""
        mgr = ContextManager("gpt-4")
        assert mgr._compaction_enabled is False
        assert mgr._compactor is None
    
    def test_compaction_enabled_with_config(self):
        """Compaction is enabled when config provided."""
        config = {
            "enabled": True,
            "compaction_trigger_tokens": 5000,
            "verbatim_window_tokens": 2000,
            "detection_model": "gpt-4o-mini",
        }
        mgr = ContextManager("gpt-4", compaction_config=config)
        assert mgr._compaction_enabled is True
        assert mgr._compactor is not None
        assert mgr._compactor.config.compaction_trigger_tokens == 5000
        assert mgr._compactor.config.verbatim_window_tokens == 2000
    
    def test_compaction_disabled_in_config(self):
        """Compaction can be explicitly disabled in config."""
        config = {"enabled": False}
        mgr = ContextManager("gpt-4", compaction_config=config)
        assert mgr._compaction_enabled is False
        assert mgr._compactor is None
    
    def test_should_compact_false_when_disabled(self):
        """should_compact returns False when compaction disabled."""
        mgr = ContextManager("gpt-4")
        mgr.add_message("user", "x" * 10000)  # Large message
        assert mgr.should_compact() is False
    
    def test_should_compact_false_when_under_threshold(self):
        """should_compact returns False when history under threshold."""
        config = {
            "enabled": True,
            "compaction_trigger_tokens": 10000,
            "detection_model": "gpt-4o-mini",
        }
        mgr = ContextManager("gpt-4", compaction_config=config)
        mgr.add_message("user", "Hello")  # Small message
        assert mgr.should_compact() is False
    
    def test_should_compact_true_when_over_threshold(self):
        """should_compact returns True when history exceeds threshold."""
        config = {
            "enabled": True,
            "compaction_trigger_tokens": 50,  # Very low threshold
            "detection_model": "gpt-4o-mini",
        }
        mgr = ContextManager("gpt-4", compaction_config=config)
        # Add enough content to exceed 50 tokens
        mgr.add_message("user", " ".join(["word"] * 100))
        assert mgr.should_compact() is True
    
    def test_get_compaction_status_disabled(self):
        """get_compaction_status returns disabled status."""
        mgr = ContextManager("gpt-4")
        status = mgr.get_compaction_status()
        assert status["enabled"] is False
        assert status["trigger_threshold"] == 0
    
    def test_get_compaction_status_enabled(self):
        """get_compaction_status returns current status."""
        config = {
            "enabled": True,
            "compaction_trigger_tokens": 1000,
            "detection_model": "gpt-4o-mini",
        }
        mgr = ContextManager("gpt-4", compaction_config=config)
        mgr.add_message("user", "Hello world")
        
        status = mgr.get_compaction_status()
        assert status["enabled"] is True
        assert status["trigger_threshold"] == 1000
        assert status["history_tokens"] > 0
        assert 0 <= status["percent_used"] <= 100
    
    def test_compact_history_if_needed_sync_returns_none_when_not_needed(self):
        """compact_history_if_needed_sync returns None when no compaction needed."""
        config = {
            "enabled": True,
            "compaction_trigger_tokens": 10000,
            "detection_model": "gpt-4o-mini",
        }
        mgr = ContextManager("gpt-4", compaction_config=config)
        mgr.add_message("user", "Hello")
        
        result = mgr.compact_history_if_needed_sync()
        assert result is None
    
    def test_compact_history_if_needed_sync_returns_none_when_disabled(self):
        """compact_history_if_needed_sync returns None when compaction disabled."""
        mgr = ContextManager("gpt-4")
        mgr.add_message("user", " ".join(["word"] * 1000))
        
        result = mgr.compact_history_if_needed_sync()
        assert result is None
    
    def test_compact_history_if_needed_sync_compacts_when_needed(self):
        """compact_history_if_needed_sync actually compacts history."""
        from unittest.mock import patch, MagicMock
        from ac.history.compactor import CompactionResult
        
        config = {
            "enabled": True,
            "compaction_trigger_tokens": 50,  # Low threshold
            "detection_model": "gpt-4o-mini",
        }
        mgr = ContextManager("gpt-4", compaction_config=config)
        
        # Add messages exceeding threshold
        mgr.add_message("user", " ".join(["word"] * 100))
        mgr.add_message("assistant", " ".join(["reply"] * 100))
        
        original_history_len = len(mgr.get_history())
        assert original_history_len == 2
        
        # Mock the compactor to return a compacted result
        mock_result = CompactionResult(
            compacted_messages=[{"role": "user", "content": "compacted"}],
            summary_message={"role": "system", "content": "summary"},
            truncated_count=1,
            tokens_before=200,
            tokens_after=50,
            case="summarize"
        )
        
        with patch.object(mgr._compactor, 'compact_sync', return_value=mock_result):
            result = mgr.compact_history_if_needed_sync()
        
        assert result is not None
        assert result.case == "summarize"
        assert result.truncated_count == 1
        # History should be updated to compacted version
        assert len(mgr.get_history()) == 1
        assert mgr.get_history()[0]["content"] == "compacted"
    
    def test_compact_history_preserves_history_when_case_none(self):
        """History unchanged when compaction returns case='none'."""
        from unittest.mock import patch
        from ac.history.compactor import CompactionResult
        
        config = {
            "enabled": True,
            "compaction_trigger_tokens": 50,
            "detection_model": "gpt-4o-mini",
        }
        mgr = ContextManager("gpt-4", compaction_config=config)
        
        mgr.add_message("user", " ".join(["word"] * 100))
        original_history = mgr.get_history()
        
        # Mock compactor returning "none" case (no compaction needed)
        mock_result = CompactionResult(
            compacted_messages=original_history,
            tokens_before=100,
            tokens_after=100,
            case="none"
        )
        
        with patch.object(mgr._compactor, 'compact_sync', return_value=mock_result):
            result = mgr.compact_history_if_needed_sync()
        
        assert result is not None
        assert result.case == "none"
        # History should be unchanged
        assert mgr.get_history() == original_history


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
