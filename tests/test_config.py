"""Tests for configuration loading."""

import json
import pytest
from pathlib import Path
from ac_dc.config import ConfigManager


@pytest.fixture
def tmp_repo(tmp_path):
    """Create a minimal git repo for testing."""
    (tmp_path / ".git").mkdir()
    return tmp_path


class TestConfigManager:

    def test_creates_ac_dc_dir(self, tmp_repo):
        cm = ConfigManager(tmp_repo, dev_mode=True)
        assert (tmp_repo / ".ac-dc").exists()

    def test_adds_gitignore_entry(self, tmp_repo):
        ConfigManager(tmp_repo, dev_mode=True)
        content = (tmp_repo / ".gitignore").read_text()
        assert ".ac-dc/" in content

    def test_does_not_duplicate_gitignore(self, tmp_repo):
        (tmp_repo / ".gitignore").write_text(".ac-dc/\n")
        ConfigManager(tmp_repo, dev_mode=True)
        content = (tmp_repo / ".gitignore").read_text()
        assert content.count(".ac-dc/") == 1

    def test_default_llm_config(self, tmp_repo):
        cm = ConfigManager(tmp_repo, dev_mode=True)
        cfg = cm.get_llm_config()
        assert "model" in cfg

    def test_default_app_config(self, tmp_repo):
        cm = ConfigManager(tmp_repo, dev_mode=True)
        cfg = cm.get_app_config()
        assert "history_compaction" in cfg

    def test_get_set_config(self, tmp_repo):
        cm = ConfigManager(tmp_repo, dev_mode=True)
        # Save
        result = cm.save_config_content("litellm", '{"model": "test/model"}')
        assert result.get("ok")
        # Read back
        result = cm.get_config_content("litellm")
        assert "test/model" in result["content"]

    def test_invalid_type_rejected(self, tmp_repo):
        cm = ConfigManager(tmp_repo, dev_mode=True)
        result = cm.get_config_content("arbitrary_path")
        assert "error" in result

    def test_cache_target_tokens(self, tmp_repo):
        cm = ConfigManager(tmp_repo, dev_mode=True)
        # default: 1024 * 1.5 = 1536
        assert cm.cache_target_tokens == 1536

    def test_snippets_fallback(self, tmp_repo):
        cm = ConfigManager(tmp_repo, dev_mode=True)
        snippets = cm.get_snippets()
        assert "snippets" in snippets
        assert len(snippets["snippets"]) > 0

    def test_system_prompt_assembly(self, tmp_repo):
        cm = ConfigManager(tmp_repo, dev_mode=True)
        prompt = cm.get_system_prompt()
        # Should at least be non-empty from bundled config
        assert isinstance(prompt, str)
