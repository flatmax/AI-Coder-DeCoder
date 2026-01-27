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
