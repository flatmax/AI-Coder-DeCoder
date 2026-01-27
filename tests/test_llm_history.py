"""Tests for LiteLLM history management."""

import pytest
from unittest.mock import MagicMock, patch


class TestLiteLLMHistoryProperty:
    """Test that conversation_history property works correctly."""
    
    def test_history_empty_initially(self):
        """History should be empty when LiteLLM is created."""
        with patch('ac.llm.llm.LiteLLM._load_config', return_value={}):
            with patch('ac.llm.llm.LiteLLM._apply_env_vars'):
                with patch('ac.llm.llm.LiteLLM._auto_save_symbol_map', return_value=None):
                    with patch('ac.llm.llm.LiteLLM._init_history_store'):
                        from ac.llm import LiteLLM
                        llm = LiteLLM(repo=None)
                        assert llm.conversation_history == []
    
    def test_history_property_reads_from_context_manager(self):
        """History property should read from context manager."""
        with patch('ac.llm.llm.LiteLLM._load_config', return_value={}):
            with patch('ac.llm.llm.LiteLLM._apply_env_vars'):
                with patch('ac.llm.llm.LiteLLM._auto_save_symbol_map', return_value=None):
                    with patch('ac.llm.llm.LiteLLM._init_history_store'):
                        from ac.llm import LiteLLM
                        llm = LiteLLM(repo=None)
                        
                        # Add messages via context manager
                        llm._context_manager.add_message('user', 'Hello')
                        llm._context_manager.add_message('assistant', 'Hi there')
                        
                        # Property should return them
                        history = llm.conversation_history
                        assert len(history) == 2
                        assert history[0]['role'] == 'user'
                        assert history[0]['content'] == 'Hello'
    
    def test_history_property_setter(self):
        """Setting history property should update context manager."""
        with patch('ac.llm.llm.LiteLLM._load_config', return_value={}):
            with patch('ac.llm.llm.LiteLLM._apply_env_vars'):
                with patch('ac.llm.llm.LiteLLM._auto_save_symbol_map', return_value=None):
                    with patch('ac.llm.llm.LiteLLM._init_history_store'):
                        from ac.llm import LiteLLM
                        llm = LiteLLM(repo=None)
                        
                        new_history = [
                            {'role': 'user', 'content': 'Test message'},
                            {'role': 'assistant', 'content': 'Test response'}
                        ]
                        llm.conversation_history = new_history
                        
                        # Should be reflected in context manager
                        assert len(llm._context_manager.get_history()) == 2


class TestLiteLLMClearHistory:
    """Test clear_history functionality."""
    
    def test_clear_history_clears_context_manager(self):
        """clear_history should clear the context manager."""
        with patch('ac.llm.llm.LiteLLM._load_config', return_value={}):
            with patch('ac.llm.llm.LiteLLM._apply_env_vars'):
                with patch('ac.llm.llm.LiteLLM._auto_save_symbol_map', return_value=None):
                    with patch('ac.llm.llm.LiteLLM._init_history_store'):
                        from ac.llm import LiteLLM
                        llm = LiteLLM(repo=None)
                        llm._history_store = None  # Set attribute that _init_history_store would create
                        
                        # Add some history
                        llm._context_manager.add_exchange('Hello', 'Hi')
                        assert len(llm.conversation_history) == 2
                        
                        # Clear it
                        llm.clear_history()
                        assert len(llm.conversation_history) == 0


class TestContextManagerHistoryIntegration:
    """Test that context manager properly tracks history."""
    
    def test_add_exchange(self):
        """add_exchange should add both user and assistant messages."""
        from ac.context import ContextManager
        
        cm = ContextManager(model_name='gpt-4', repo_root=None)
        cm.add_exchange('User question', 'Assistant answer')
        
        history = cm.get_history()
        assert len(history) == 2
        assert history[0] == {'role': 'user', 'content': 'User question'}
        assert history[1] == {'role': 'assistant', 'content': 'Assistant answer'}
    
    def test_add_message(self):
        """add_message should add a single message."""
        from ac.context import ContextManager
        
        cm = ContextManager(model_name='gpt-4', repo_root=None)
        cm.add_message('user', 'Hello')
        
        history = cm.get_history()
        assert len(history) == 1
        assert history[0] == {'role': 'user', 'content': 'Hello'}
    
    def test_set_history(self):
        """set_history should replace history."""
        from ac.context import ContextManager
        
        cm = ContextManager(model_name='gpt-4', repo_root=None)
        cm.add_message('user', 'Original')
        
        cm.set_history([{'role': 'user', 'content': 'Replaced'}])
        
        history = cm.get_history()
        assert len(history) == 1
        assert history[0]['content'] == 'Replaced'
    
    def test_get_history_returns_copy(self):
        """get_history should return a copy, not the original."""
        from ac.context import ContextManager
        
        cm = ContextManager(model_name='gpt-4', repo_root=None)
        cm.add_message('user', 'Test')
        
        history = cm.get_history()
        history.append({'role': 'assistant', 'content': 'Modified'})
        
        # Original should be unchanged
        assert len(cm.get_history()) == 1
    
    def test_clear_history(self):
        """clear_history should empty the history."""
        from ac.context import ContextManager
        
        cm = ContextManager(model_name='gpt-4', repo_root=None)
        cm.add_exchange('Q', 'A')
        assert len(cm.get_history()) == 2
        
        cm.clear_history()
        assert len(cm.get_history()) == 0
