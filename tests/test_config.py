"""Tests for configuration management."""

import json
import os
import tempfile
from pathlib import Path

import pytest

from ac_dc.config import ConfigManager


@pytest.fixture
def temp_repo(tmp_path):
    """Create a temporary git repo for testing."""
    repo = tmp_path / "test_repo"
    repo.mkdir()
    import subprocess
    subprocess.run(["git", "init", str(repo)], capture_output=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.email", "test@test.com"], capture_output=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.name", "Test"], capture_output=True)
    return repo


def test_init_creates_ac_dc_dir(temp_repo):
    """Creates .ac-dc/ directory and .gitignore entry on init."""
    config = ConfigManager(repo_root=temp_repo)
    assert (temp_repo / ".ac-dc").is_dir()
    assert (temp_repo / ".ac-dc" / "images").is_dir()
    gitignore = (temp_repo / ".gitignore").read_text()
    assert ".ac-dc/" in gitignore


def test_no_duplicate_gitignore_entries(temp_repo):
    """No duplicate .ac-dc/ entries in .gitignore."""
    ConfigManager(repo_root=temp_repo)
    ConfigManager(repo_root=temp_repo)
    content = (temp_repo / ".gitignore").read_text()
    assert content.count(".ac-dc/") == 1


def test_default_llm_config_has_expected_keys():
    """Default LLM config contains expected keys."""
    config = ConfigManager()
    assert config.model is not None
    assert config.smaller_model is not None
    assert config.cache_min_tokens > 0
    assert config.cache_buffer_multiplier > 0


def test_default_app_config_has_expected_keys():
    """Default app config contains expected keys."""
    config = ConfigManager()
    assert "enabled" in config.compaction_config
    assert "compaction_trigger_tokens" in config.compaction_config
    assert "ttl_hours" in config.url_cache_config


def test_cache_target_tokens():
    """Cache target tokens computed from defaults."""
    config = ConfigManager()
    expected = int(config.cache_min_tokens * config.cache_buffer_multiplier)
    assert config.cache_target_tokens == expected


def test_save_and_read_round_trip(temp_repo):
    """Save and read-back round-trip for config content."""
    config = ConfigManager(repo_root=temp_repo)
    # Use a temp config dir so we don't overwrite the real llm.json
    config._config_dir = temp_repo / ".ac-dc"
    test_content = '{"test": "value"}'
    config.save_config_content("litellm", test_content)
    result = config.get_config_content("litellm")
    assert result == test_content


def test_invalid_config_type_rejected():
    """Invalid config type key rejected with error."""
    config = ConfigManager()
    with pytest.raises(ValueError, match="Invalid config type"):
        config.get_config_content("nonexistent")
    with pytest.raises(ValueError, match="Invalid config type"):
        config.save_config_content("nonexistent", "content")


def test_snippets_fallback_returns_non_empty():
    """Snippets fallback returns non-empty list."""
    config = ConfigManager()
    snippets = config.get_snippets()
    assert len(snippets) > 0
    assert "icon" in snippets[0]
    assert "message" in snippets[0]


def test_system_prompt_returns_non_empty():
    """System prompt assembly returns non-empty string."""
    config = ConfigManager()
    prompt = config.get_system_prompt()
    assert len(prompt) > 0
    assert "edit" in prompt.lower() or "Edit" in prompt


def test_get_config_info():
    """get_config_info returns model names and paths."""
    config = ConfigManager()
    info = config.get_config_info()
    assert "model" in info
    assert "config_dir" in info


def test_reload_llm_config():
    """Reload returns updated config."""
    config = ConfigManager()
    result = config.reload_llm_config()
    assert "model" in result


def test_compaction_prompt():
    """Compaction prompt loads."""
    config = ConfigManager()
    prompt = config.get_compaction_prompt()
    assert len(prompt) > 0


def test_commit_prompt():
    """Commit prompt loads from commit.md."""
    config = ConfigManager()
    prompt = config.get_commit_prompt()
    assert len(prompt) > 0
    assert "commit" in prompt.lower()


def test_system_reminder():
    """System reminder loads from system_reminder.md."""
    config = ConfigManager()
    reminder = config.get_system_reminder()
    assert len(reminder) > 0
    assert "edit" in reminder.lower() or "Edit" in reminder


# === Settings Wrapper Tests ===


def test_settings_get_config_content():
    """Settings.get_config_content returns dict with content key."""
    from ac_dc.settings import Settings
    config = ConfigManager()
    s = Settings(config)
    result = s.get_config_content("litellm")
    assert isinstance(result, dict)
    assert "content" in result
    assert len(result["content"]) > 0


def test_settings_save_and_read(temp_repo):
    """Settings save and read round-trip."""
    from ac_dc.settings import Settings
    config = ConfigManager(repo_root=temp_repo)
    s = Settings(config)
    s.save_config_content("system_extra", "# Custom extra\n")
    result = s.get_config_content("system_extra")
    assert isinstance(result, dict)
    assert "Custom extra" in result["content"]


def test_settings_reload_llm_config():
    """Settings.reload_llm_config returns result."""
    from ac_dc.settings import Settings
    config = ConfigManager()
    s = Settings(config)
    result = s.reload_llm_config()
    assert result is not None


def test_settings_get_config_info():
    """Settings.get_config_info returns model and paths."""
    from ac_dc.settings import Settings
    config = ConfigManager()
    s = Settings(config)
    info = s.get_config_info()
    assert "model" in info


def test_settings_get_snippets():
    """Settings.get_snippets returns list."""
    from ac_dc.settings import Settings
    config = ConfigManager()
    s = Settings(config)
    snippets = s.get_snippets()
    assert isinstance(snippets, list)


def test_settings_get_review_snippets():
    """Settings.get_review_snippets returns list."""
    from ac_dc.settings import Settings
    config = ConfigManager()
    s = Settings(config)
    snippets = s.get_review_snippets()
    assert isinstance(snippets, list)


def test_settings_invalid_config_type():
    """Settings returns error for invalid config type."""
    from ac_dc.settings import Settings
    config = ConfigManager()
    s = Settings(config)
    result = s.get_config_content("invalid_type")
    assert isinstance(result, (dict, str))
    if isinstance(result, dict):
        # Settings wraps the error — check for error key or empty content
        assert "error" in result or result.get("content", "") == ""
    result2 = s.save_config_content("invalid_type", "data")
    assert isinstance(result2, (dict, str))
    if isinstance(result2, dict):
        assert "error" in result2 or result2.get("content", "") == ""
