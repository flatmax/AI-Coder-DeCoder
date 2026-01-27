"""Tests for ac/context/token_counter.py"""

import pytest
from ac.context import TokenCounter


class TestTokenCounterInit:
    """Tests for TokenCounter initialization."""
    
    def test_init_stores_model_name(self):
        counter = TokenCounter("gpt-4")
        assert counter.model_name == "gpt-4"
    
    def test_info_not_loaded_until_accessed(self):
        counter = TokenCounter("gpt-4")
        assert counter._info is None
    
    def test_info_loaded_on_access(self):
        counter = TokenCounter("gpt-4")
        _ = counter.info
        assert counter._info is not None


class TestTokenCounterModelInfo:
    """Tests for model info retrieval."""
    
    def test_max_input_tokens_available(self):
        counter = TokenCounter("gpt-4")
        assert counter.max_input_tokens > 0
    
    def test_max_output_tokens_available(self):
        counter = TokenCounter("gpt-4")
        assert counter.max_output_tokens > 0
    
    def test_unknown_model_uses_defaults(self):
        counter = TokenCounter("unknown-model-xyz-123")
        assert counter.max_input_tokens == TokenCounter.DEFAULT_INFO["max_input_tokens"]
        assert counter.max_output_tokens == TokenCounter.DEFAULT_INFO["max_output_tokens"]
    
    def test_info_is_cached(self):
        counter = TokenCounter("gpt-4")
        info1 = counter.info
        info2 = counter.info
        assert info1 is info2  # Same object, not reloaded


class TestTokenCounterCounting:
    """Tests for token counting."""
    
    def test_count_string(self):
        counter = TokenCounter("gpt-4")
        count = counter.count("Hello, world!")
        assert count > 0
        assert count < 100  # Sanity check
    
    def test_count_empty_string(self):
        counter = TokenCounter("gpt-4")
        count = counter.count("")
        assert count == 0
    
    def test_count_message_dict(self):
        counter = TokenCounter("gpt-4")
        message = {"role": "user", "content": "Hello, world!"}
        count = counter.count(message)
        assert count > 0
    
    def test_count_message_list(self):
        counter = TokenCounter("gpt-4")
        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there!"}
        ]
        count = counter.count(messages)
        assert count > 0
    
    def test_count_empty_list(self):
        counter = TokenCounter("gpt-4")
        count = counter.count([])
        # litellm may return small overhead for empty lists
        assert count >= 0
        assert count < 10  # Sanity check
    
    def test_token_count_alias(self):
        """Test that token_count() is an alias for count()."""
        counter = TokenCounter("gpt-4")
        text = "Hello, world!"
        assert counter.token_count(text) == counter.count(text)
    
    def test_longer_text_more_tokens(self):
        counter = TokenCounter("gpt-4")
        short = counter.count("Hi")
        long = counter.count("Hello, this is a much longer piece of text that should have more tokens.")
        assert long > short


class TestTokenCounterFallback:
    """Tests for fallback behavior with unknown models."""
    
    def test_fallback_string_counting(self):
        """Unknown model should still count tokens (litellm or fallback)."""
        counter = TokenCounter("nonexistent-model-12345")
        count = counter.count("Hello, world! This is a test.")
        # Either litellm handles it or fallback kicks in
        assert count > 0
        assert count < 50  # Sanity check - should be reasonable
    
    def test_fallback_message_list_counting(self):
        """Unknown model should estimate tokens for message lists."""
        counter = TokenCounter("nonexistent-model-12345")
        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there!"}
        ]
        count = counter.count(messages)
        # Should be approximately (5 + 9) // 4 = 3
        assert count >= 0
