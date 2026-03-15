"""Tests for Settings service."""

import json

import pytest

from ac_dc.config_manager import ConfigManager
from ac_dc.settings import Settings


@pytest.fixture
def settings(tmp_git_repo):
    config = ConfigManager(tmp_git_repo)
    return Settings(config)


class TestSettingsRPC:
    def test_get_config_content(self, settings):
        content = settings.get_config_content("system")
        assert isinstance(content, str)
        assert len(content) > 0

    def test_get_config_content_invalid(self, settings):
        result = settings.get_config_content("invalid_type")
        assert isinstance(result, dict)
        assert "error" in result

    def test_save_and_reload(self, settings):
        settings.save_config_content("system_extra", "Custom instructions")
        content = settings.get_config_content("system_extra")
        assert content == "Custom instructions"

    def test_reload_llm_config(self, settings):
        result = settings.reload_llm_config()
        assert result["status"] == "reloaded"
        assert "model" in result

    def test_reload_app_config(self, settings):
        result = settings.reload_app_config()
        assert result["status"] == "reloaded"

    def test_get_config_info(self, settings):
        info = settings.get_config_info()
        assert "model" in info
        assert "smaller_model" in info
        assert "config_dir" in info

    def test_get_snippets(self, settings):
        snippets = settings.get_snippets()
        assert isinstance(snippets, list)
        assert len(snippets) > 0

    def test_get_review_snippets(self, settings):
        snippets = settings.get_review_snippets()
        assert isinstance(snippets, list)
        assert len(snippets) > 0