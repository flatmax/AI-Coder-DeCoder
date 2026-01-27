"""
Tests for the prompt templates.
"""

import pytest
from pathlib import Path


class TestEditBlockPrompts:
    """Tests for EditBlockPrompts class."""
    
    def test_has_required_attributes(self):
        """Verify EditBlockPrompts has all required attributes."""
        from ac.aider_integration.prompts import EditBlockPrompts
        prompts = EditBlockPrompts()
        assert hasattr(prompts, 'main_system')
        assert hasattr(prompts, 'system_reminder')
        assert hasattr(prompts, 'example_messages')
        assert hasattr(prompts, 'go_ahead_tip')
    
    def test_system_reminder_has_placeholders(self):
        """Verify system_reminder has required format placeholders."""
        from ac.aider_integration.prompts import EditBlockPrompts
        prompts = EditBlockPrompts()
        # v3 format only uses {go_ahead_tip} placeholder (no {fence} needed)
        assert '{go_ahead_tip}' in prompts.system_reminder
    
    def test_system_reminder_formats_correctly(self):
        """Verify system_reminder can be formatted."""
        from ac.aider_integration.prompts import EditBlockPrompts
        prompts = EditBlockPrompts()
        formatted = prompts.system_reminder.format(go_ahead_tip='')
        assert '{go_ahead_tip}' not in formatted
        assert 'EDIT' in formatted
        assert 'REPL' in formatted
    
    def test_example_messages_format(self):
        """Verify example_messages have correct structure."""
        from ac.aider_integration.prompts import EditBlockPrompts
        prompts = EditBlockPrompts()
        assert isinstance(prompts.example_messages, list)
        assert len(prompts.example_messages) > 0
        for msg in prompts.example_messages:
            assert 'role' in msg
            assert 'content' in msg
            assert msg['role'] in ('user', 'assistant')
    
    def test_example_messages_contain_edit_blocks(self):
        """Verify assistant examples contain EDIT/REPL blocks (v3 format)."""
        from ac.aider_integration.prompts import EditBlockPrompts
        prompts = EditBlockPrompts()
        assistant_msgs = [m for m in prompts.example_messages if m['role'] == 'assistant']
        assert len(assistant_msgs) > 0
        for msg in assistant_msgs:
            content = msg['content']
            assert '««« EDIT' in content
            assert '═══════ REPL' in content
            assert '»»» EDIT END' in content
    
    def test_example_messages_have_no_placeholders(self):
        """Verify example_messages have no format placeholders."""
        from ac.aider_integration.prompts import EditBlockPrompts
        prompts = EditBlockPrompts()
        for msg in prompts.example_messages:
            # v3 format doesn't use {fence} or {go_ahead_tip} placeholders
            # Note: {name} etc. may appear as f-string examples in code
            assert '{fence}' not in msg['content']
            assert '{go_ahead_tip}' not in msg['content']


class TestPromptMixin:
    """Tests for PromptMixin class."""
    
    def test_get_system_reminder_includes_rules(self):
        """Verify get_system_reminder includes EDIT/REPL rules."""
        from ac.aider_integration.editor import AiderEditor
        editor = AiderEditor()
        reminder = editor.get_system_reminder()
        assert 'EDIT' in reminder
        assert 'REPL' in reminder
    
    def test_get_example_messages_returns_list(self):
        """Verify get_example_messages returns formatted list."""
        from ac.aider_integration.editor import AiderEditor
        editor = AiderEditor()
        examples = editor.get_example_messages()
        assert isinstance(examples, list)
        assert len(examples) > 0
        for msg in examples:
            assert 'role' in msg
            assert 'content' in msg
    
    def test_get_system_prompt_returns_content(self):
        """Verify get_system_prompt returns sys_prompt.md content."""
        from ac.aider_integration.editor import AiderEditor
        editor = AiderEditor()
        prompt = editor.get_system_prompt()
        assert len(prompt) > 100  # Should have substantial content
        # Should contain something from sys_prompt.md
        assert 'EDIT' in prompt or 'Symbol Map' in prompt


class TestMissingSysPrompt:
    """Tests for missing sys_prompt.md handling."""
    
    def test_missing_sys_prompt_raises_error(self, tmp_path, monkeypatch):
        """Verify missing sys_prompt.md raises FileNotFoundError."""
        from ac.aider_integration import prompt_mixin
        
        # Point to a directory without sys_prompt.md
        monkeypatch.setattr(prompt_mixin, '_get_repo_root', lambda: tmp_path)
        
        from ac.aider_integration.prompts import EditBlockPrompts
        
        # Create a minimal class using PromptMixin
        class TestEditor(prompt_mixin.PromptMixin):
            def __init__(self):
                self.fence = ('```', '```')
                self._init_prompts()
        
        with pytest.raises(FileNotFoundError) as exc_info:
            TestEditor()
        
        assert 'sys_prompt.md' in str(exc_info.value)
