"""Tests for ConfigManager."""

import json
import os
from pathlib import Path

import pytest

from ac_dc.config_manager import ConfigManager, CONFIG_TYPES, _get_min_cacheable_tokens


@pytest.fixture
def config_mgr(tmp_git_repo):
    """ConfigManager backed by a temp git repo."""
    return ConfigManager(tmp_git_repo)


class TestDirectorySetup:
    def test_ac_dc_dir_created(self, config_mgr):
        assert config_mgr.ac_dc_dir.is_dir()

    def test_gitignore_entry_added(self, config_mgr):
        gitignore = config_mgr.repo_root / ".gitignore"
        content = gitignore.read_text()
        assert ".ac-dc/" in content

    def test_no_duplicate_gitignore_entries(self, config_mgr):
        """Creating a second ConfigManager doesn't add a duplicate entry."""
        _ = ConfigManager(config_mgr.repo_root)
        content = (config_mgr.repo_root / ".gitignore").read_text()
        count = content.count(".ac-dc/")
        assert count == 1


class TestLLMConfig:
    def test_default_model(self, config_mgr):
        assert "claude" in config_mgr.model.lower() or "anthropic" in config_mgr.model.lower()

    def test_default_llm_config_has_expected_keys(self, config_mgr):
        cfg = config_mgr.llm_config
        assert "model" in cfg
        assert "cache_min_tokens" in cfg
        assert "cache_buffer_multiplier" in cfg

    def test_reload_llm_config(self, config_mgr, tmp_git_repo):
        """Save modified config, reload, verify change."""
        new_config = {
            "env": {},
            "model": "openai/gpt-4",
            "cache_min_tokens": 2048,
            "cache_buffer_multiplier": 1.5,
        }
        config_mgr.save_config_content(
            "litellm", json.dumps(new_config, indent=2)
        )
        config_mgr.reload_llm_config()
        assert config_mgr.model == "openai/gpt-4"

    def test_smaller_model_camel_case_alias(self, config_mgr):
        """'smallerModel' key is normalized to 'smaller_model'."""
        new_config = {
            "env": {},
            "model": "test/model",
            "smallerModel": "test/small",
            "cache_min_tokens": 1024,
            "cache_buffer_multiplier": 1.1,
        }
        config_mgr.save_config_content(
            "litellm", json.dumps(new_config, indent=2)
        )
        config_mgr.reload_llm_config()
        assert config_mgr.smaller_model == "test/small"

    def test_env_vars_applied(self, tmp_git_repo):
        """Env vars from llm.json are set in os.environ."""
        new_config = {
            "env": {"AC_DC_TEST_ENV_VAR_2": "applied_value"},
            "model": "test/model",
            "cache_min_tokens": 1024,
            "cache_buffer_multiplier": 1.1,
        }
        mgr = ConfigManager(tmp_git_repo)
        mgr.save_config_content(
            "litellm", json.dumps(new_config, indent=2)
        )
        mgr.reload_llm_config()
        assert os.environ.get("AC_DC_TEST_ENV_VAR_2") == "applied_value"
        # Cleanup
        os.environ.pop("AC_DC_TEST_ENV_VAR_2", None)


class TestAppConfig:
    def test_default_app_config_has_expected_keys(self, config_mgr):
        cfg = config_mgr.app_config
        assert "history_compaction" in cfg
        assert "doc_convert" in cfg
        assert "doc_index" in cfg

    def test_reload_app_config(self, config_mgr):
        # Verify default is enabled
        assert config_mgr.history_compaction_config.get("enabled") is True
        # Override to disabled
        new_config = {"history_compaction": {"enabled": False}}
        config_mgr.save_config_content(
            "app", json.dumps(new_config, indent=2)
        )
        config_mgr.reload_app_config()
        assert config_mgr.history_compaction_config.get("enabled") is False

    def test_partial_app_config_merges_defaults(self, config_mgr):
        """A partial app.json still has all default keys via deep merge."""
        partial = {"history_compaction": {"enabled": False}}
        config_mgr.save_config_content("app", json.dumps(partial))
        config_mgr.reload_app_config()
        # doc_index should still have defaults
        di = config_mgr.doc_index_config
        assert "keywords_enabled" in di
        assert di["keywords_enabled"] is True
        # doc_convert should still have defaults
        dc = config_mgr.doc_convert_config
        assert "extensions" in dc
        # history_compaction override should be applied
        assert config_mgr.history_compaction_config["enabled"] is False
        # but other history_compaction defaults should survive
        assert "compaction_trigger_tokens" in config_mgr.history_compaction_config


class TestCacheTargetTokens:
    def test_fallback_no_model(self, config_mgr):
        """Default: 1024 × 1.1 = 1126."""
        tokens = config_mgr.cache_target_tokens
        assert tokens == 1126

    def test_model_aware_opus(self, config_mgr):
        """Opus: max(1024, 4096) × 1.1 = 4505."""
        tokens = config_mgr.get_cache_target_tokens("anthropic/claude-opus-4-20250514")
        assert tokens == 4505

    def test_model_aware_sonnet(self, config_mgr):
        """Sonnet: max(1024, 1024) × 1.1 = 1126."""
        tokens = config_mgr.get_cache_target_tokens("anthropic/claude-sonnet-4-20250514")
        assert tokens == 1126

    def test_min_cacheable_tokens_helper(self):
        assert _get_min_cacheable_tokens("opus-4") == 4096
        assert _get_min_cacheable_tokens("haiku-4.5") == 4096
        assert _get_min_cacheable_tokens("sonnet-4") == 1024
        assert _get_min_cacheable_tokens("unknown-model") == 1024


class TestSystemPrompts:
    def test_system_prompt_nonempty(self, config_mgr):
        prompt = config_mgr.get_system_prompt()
        assert len(prompt) > 100
        assert "expert" in prompt.lower()

    def test_system_prompt_includes_extra(self, config_mgr):
        """system_extra.md content is appended."""
        config_mgr.save_config_content("system_extra", "# Custom project rules\nAlways use type hints.")
        prompt = config_mgr.get_system_prompt()
        assert "Custom project rules" in prompt

    def test_doc_system_prompt_nonempty(self, config_mgr):
        prompt = config_mgr.get_doc_system_prompt()
        assert len(prompt) > 50
        assert "document" in prompt.lower()

    def test_commit_prompt(self, config_mgr):
        prompt = config_mgr.get_commit_prompt()
        assert "commit" in prompt.lower()
        assert "imperative" in prompt.lower()

    def test_system_reminder(self, config_mgr):
        reminder = config_mgr.get_system_reminder()
        assert "IMPORTANT" in reminder or "Edit block" in reminder

    def test_review_prompt(self, config_mgr):
        prompt = config_mgr.get_review_prompt()
        assert "review" in prompt.lower()


class TestSnippets:
    def test_code_snippets_nonempty(self, config_mgr):
        snippets = config_mgr.get_snippets("code")
        assert len(snippets) > 0
        assert all("icon" in s and "message" in s for s in snippets)

    def test_review_snippets(self, config_mgr):
        snippets = config_mgr.get_snippets("review")
        assert len(snippets) > 0

    def test_doc_snippets(self, config_mgr):
        snippets = config_mgr.get_snippets("doc")
        assert len(snippets) > 0

    def test_repo_local_snippets_override(self, config_mgr):
        """Repo-local .ac-dc/snippets.json takes priority."""
        local_snippets = {
            "code": [{"icon": "🚀", "tooltip": "Custom", "message": "Custom snippet"}],
            "review": [],
            "doc": [],
        }
        snippets_path = config_mgr.ac_dc_dir / "snippets.json"
        snippets_path.write_text(json.dumps(local_snippets))

        result = config_mgr.get_snippets("code")
        assert len(result) == 1
        assert result[0]["icon"] == "🚀"

    def test_unknown_mode_returns_empty(self, config_mgr):
        snippets = config_mgr.get_snippets("nonexistent")
        assert snippets == []


class TestConfigReadWrite:
    def test_save_and_read_roundtrip(self, config_mgr):
        config_mgr.save_config_content("system_extra", "Hello world")
        content = config_mgr.get_config_content("system_extra")
        assert content == "Hello world"

    def test_invalid_type_rejected(self, config_mgr):
        with pytest.raises(ValueError, match="Invalid config type"):
            config_mgr.get_config_content("arbitrary_file")

    def test_invalid_type_rejected_on_write(self, config_mgr):
        with pytest.raises(ValueError, match="Invalid config type"):
            config_mgr.save_config_content("../../etc/passwd", "hack")

    def test_all_config_types_readable(self, config_mgr):
        """Every whitelisted config type should be readable without error."""
        for key in CONFIG_TYPES:
            content = config_mgr.get_config_content(key)
            assert isinstance(content, str)