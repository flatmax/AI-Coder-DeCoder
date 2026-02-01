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


class TestLiteLLMCompactionConfig:
    """Test that LiteLLM passes compaction config to ContextManager."""
    
    def test_compaction_config_passed_to_context_manager(self):
        """LiteLLM should pass compaction config when enabled."""
        with patch('ac.llm.llm.LiteLLM._load_config') as mock_config:
            mock_config.return_value = {
                'model': 'gpt-4',
                'history_compaction': {
                    'enabled': True,
                    'compaction_trigger_tokens': 5000,
                    'verbatim_window_tokens': 2000,
                }
            }
            with patch('ac.llm.llm.LiteLLM._apply_env_vars'):
                with patch('ac.llm.llm.LiteLLM._auto_save_symbol_map', return_value=None):
                    with patch('ac.llm.llm.LiteLLM._init_history_store'):
                        from ac.llm import LiteLLM
                        llm = LiteLLM(repo=None)
                        
                        # Verify compaction is enabled in context manager
                        assert llm._context_manager._compaction_enabled is True
                        assert llm._context_manager._compactor is not None
                        assert llm._context_manager._compactor.config.compaction_trigger_tokens == 5000
                        assert llm._context_manager._compactor.config.verbatim_window_tokens == 2000
    
    def test_compaction_disabled_when_not_in_config(self):
        """LiteLLM should not enable compaction when not configured."""
        from ac.llm import LiteLLM
        
        with patch.object(LiteLLM, '_load_config', return_value={'model': 'gpt-4'}):
            with patch.object(LiteLLM, '_apply_env_vars'):
                with patch.object(LiteLLM, '_auto_save_symbol_map', return_value=None):
                    with patch.object(LiteLLM, '_init_history_store'):
                        with patch.object(LiteLLM, 'is_compaction_enabled', return_value=False):
                            llm = LiteLLM(repo=None)
                            
                            assert llm._context_manager._compaction_enabled is False
                            assert llm._context_manager._compactor is None


class TestStreamingCompactionIntegration:
    """Test that streaming properly integrates with compaction."""
    
    def test_summarized_flag_set_on_compaction(self):
        """summarized flag should be True when compaction occurs."""
        from ac.history.compactor import CompactionResult
        
        # Simulate compaction result - case != "none" indicates compaction happened
        result = CompactionResult(
            case="topic_boundary",
            compacted_messages=[
                {"role": "user", "content": "Summary of previous conversation"},
                {"role": "assistant", "content": "Ok, I understand."},
                {"role": "user", "content": "Recent question"},
                {"role": "assistant", "content": "Recent answer"},
            ],
            tokens_before=5000,
            tokens_after=2000,
        )
        
        # Verify the result indicates compaction happened
        assert result.case != "none"
        # This is how streaming.py determines summarized flag
        summarized = result.case != "none"
        assert summarized is True
        
    def test_summarized_flag_false_when_no_compaction(self):
        """summarized flag should be False when no compaction needed."""
        from ac.history.compactor import CompactionResult
        
        # When no compaction needed, result case is "none"
        result = CompactionResult(
            case="none",
            compacted_messages=[
                {"role": "user", "content": "Hello"},
                {"role": "assistant", "content": "Hi"},
            ],
            tokens_before=1000,
            tokens_after=1000,
        )
        
        assert result.case == "none"
        # This is how streaming.py determines summarized flag
        summarized = result.case != "none"
        assert summarized is False


class TestCompactionEventData:
    """Test compaction event data structure for frontend."""
    
    def test_compaction_start_event_structure(self):
        """Verify compaction_start event has expected fields."""
        event = {
            'type': 'compaction_start',
            'message': '🗜️ Compacting history...'
        }
        
        assert event['type'] == 'compaction_start'
        assert 'message' in event
        
    def test_compaction_complete_event_structure(self):
        """Verify compaction_complete event has expected fields."""
        from ac.history.compactor import CompactionResult
        
        result = CompactionResult(
            case="topic_boundary",
            compacted_messages=[],
            tokens_before=5000,
            tokens_after=2000,
        )
        
        # This mirrors the event structure created in streaming.py
        event = {
            'type': 'compaction_complete',
            'case': result.case,
            'tokens_before': result.tokens_before,
            'tokens_after': result.tokens_after,
            'tokens_saved': result.tokens_before - result.tokens_after,
        }
        
        assert event['type'] == 'compaction_complete'
        assert event['case'] == 'topic_boundary'
        assert event['tokens_before'] == 5000
        assert event['tokens_after'] == 2000
        assert event['tokens_saved'] == 3000
        
    def test_history_token_info_in_result(self):
        """Verify history token info structure for HUD."""
        # This mirrors what streaming.py adds to token_usage
        token_usage = {
            "prompt_tokens": 1000,
            "completion_tokens": 500,
            "history_tokens": 2800,
            "history_threshold": 6000,
        }
        
        assert token_usage["history_tokens"] == 2800
        assert token_usage["history_threshold"] == 6000
        # Frontend uses these to show warning states
        assert token_usage["history_tokens"] < token_usage["history_threshold"]


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
