"""Tests for ac/prompts/ module"""

import pytest
from pathlib import Path

from ac.prompts import (
    load_system_prompt,
    load_extra_prompt,
    build_system_prompt,
)


class TestPromptLoader:
    """Tests for prompt file loading."""
    
    def test_load_system_prompt_exists(self):
        """System prompt should load from repo root."""
        prompt = load_system_prompt()
        assert len(prompt) > 0
        assert isinstance(prompt, str)
    
    def test_load_system_prompt_has_content(self):
        """System prompt should have substantial content."""
        prompt = load_system_prompt()
        # Should be a meaningful prompt, not just a few words
        assert len(prompt) > 100
    
    def test_load_extra_prompt_optional(self):
        """Extra prompt returns None or string."""
        result = load_extra_prompt()
        assert result is None or isinstance(result, str)
    
    def test_load_system_prompt_missing(self, tmp_path, monkeypatch):
        """Missing prompt files raise FileNotFoundError."""
        import ac.prompts.loader as loader_module
        monkeypatch.setattr(loader_module, '_get_repo_root', lambda: tmp_path)
        
        with pytest.raises(FileNotFoundError):
            load_system_prompt()


class TestBuildSystemPrompt:
    """Tests for build_system_prompt function."""
    
    def test_build_includes_main_prompt(self):
        prompt = build_system_prompt()
        # Should include content from the loaded system prompt
        assert len(prompt) > 100
    
    def test_build_has_edit_format_info(self):
        """Prompt should explain the edit format."""
        prompt = build_system_prompt()
        # The sys_prompt_v2.md should contain edit format markers
        assert "EDIT" in prompt
