"""Tests for ac_dc.config.ConfigManager.
Layer 1 scope — covers:
- Config directory resolution (AC_DC_CONFIG_HOME override,
  platform-specific paths)
- Version-aware upgrade (first install, upgrade with backup, same-version
  no-op, user file preservation)
- Accessor read-through (hot-reload changes are observed without
  reconstruction)
- Model-aware cache target computation (Opus vs Sonnet minimums)
- Snippet fallback chain (per-repo override precedence, legacy flat
  format, nested format)
- Per-repo working directory creation and .gitignore wiring
- Prompt assembly (concatenation with system_extra, reading from user
  dir not bundle)
Uses tmp_path + AC_DC_CONFIG_HOME env var to redirect config to
isolated temp dirs. Avoids monkeypatching sys.platform etc. — the
override env var is the designated test hook.
"""
from __future__ import annotations
import json
import os
import sys
from pathlib import Path
from unittest.mock import patch
import pytest
from ac_dc.config import (
    CONFIG_TYPES,
    ConfigManager,
    _bundled_config_dir,
    _bundled_version,
    _model_min_cacheable_tokens,
    _user_config_dir,
)
# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture
def isolated_config_dir(tmp_path, monkeypatch):
    """Redirect the user config dir to an isolated tmp path.
    Uses the AC_DC_CONFIG_HOME env var — the documented test hook —
    rather than patching platform detection. Yields the dir path so
    tests can inspect its contents.
    """
    config_home = tmp_path / "ac-dc-config"
    monkeypatch.setenv("AC_DC_CONFIG_HOME", str(config_home))
    yield config_home
@pytest.fixture
def repo_root(tmp_path):
    """A fresh tmp dir acting as a git repo root.
    No actual git init — ConfigManager doesn't care. The .gitignore
    wiring is driven purely by file presence/content.
    """
    repo = tmp_path / "repo"
    repo.mkdir()
    return repo
# ---------------------------------------------------------------------------
# _user_config_dir resolution
# ---------------------------------------------------------------------------
def test_user_config_dir_respects_override_env(tmp_path, monkeypatch):
    """AC_DC_CONFIG_HOME overrides platform detection."""
    override = tmp_path / "override"
    monkeypatch.setenv("AC_DC_CONFIG_HOME", str(override))
    assert _user_config_dir() == override
def test_user_config_dir_linux(monkeypatch):
    """Linux path honours XDG_CONFIG_HOME, then falls back to ~/.config."""
    monkeypatch.delenv("AC_DC_CONFIG_HOME", raising=False)
    monkeypatch.setattr(sys, "platform", "linux")
    # With XDG_CONFIG_HOME set.
    monkeypatch.setenv("XDG_CONFIG_HOME", "/custom/xdg")
    assert _user_config_dir() == Path("/custom/xdg/ac-dc")
    # Without it, falls back to ~/.config.
    monkeypatch.delenv("XDG_CONFIG_HOME", raising=False)
    assert _user_config_dir() == Path.home() / ".config" / "ac-dc"
def test_user_config_dir_macos(monkeypatch):
    """macOS path is under ~/Library/Application Support."""
    monkeypatch.delenv("AC_DC_CONFIG_HOME", raising=False)
    monkeypatch.setattr(sys, "platform", "darwin")
    expected = Path.home() / "Library" / "Application Support" / "ac-dc"
    assert _user_config_dir() == expected
def test_user_config_dir_windows(monkeypatch):
    """Windows path is under %APPDATA%."""
    monkeypatch.delenv("AC_DC_CONFIG_HOME", raising=False)
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setenv("APPDATA", "C:\\Users\\test\\AppData\\Roaming")
    result = _user_config_dir()
    assert result.name == "ac-dc"
    assert "Roaming" in str(result)
# ---------------------------------------------------------------------------
# Model-aware cache minimums
# ---------------------------------------------------------------------------
def test_model_min_cacheable_tokens_opus_high_minimum():
    """Opus 4.5 and 4.6 require 4096-token minimum."""
    assert _model_min_cacheable_tokens("anthropic/claude-opus-4-5") == 4096
    assert _model_min_cacheable_tokens("anthropic/claude-opus-4.5") == 4096
    assert _model_min_cacheable_tokens("anthropic/claude-opus-4-6") == 4096
    assert _model_min_cacheable_tokens("bedrock/anthropic.claude-opus-4-6") == 4096
def test_model_min_cacheable_tokens_haiku_45_high_minimum():
    """Haiku 4.5 requires 4096 — matches Opus family."""
    assert _model_min_cacheable_tokens("anthropic/claude-haiku-4-5") == 4096
    assert _model_min_cacheable_tokens("anthropic/claude-haiku-4.5") == 4096
def test_model_min_cacheable_tokens_sonnet_default():
    """Sonnet family uses the default 1024-token minimum."""
    assert _model_min_cacheable_tokens("anthropic/claude-sonnet-4-5") == 1024
    assert _model_min_cacheable_tokens("anthropic/claude-sonnet-4-20250514") == 1024
def test_model_min_cacheable_tokens_non_claude_default():
    """Non-Claude models get the default minimum."""
    assert _model_min_cacheable_tokens("openai/gpt-4") == 1024
    assert _model_min_cacheable_tokens("anthropic/claude-haiku-3-5") == 1024
# ---------------------------------------------------------------------------
# _bundled_version
# ---------------------------------------------------------------------------
def test_bundled_version_reads_version_file():
    """_bundled_version reads the shipped VERSION file."""
    version = _bundled_version()
    # Source tree ships 'dev'; release builds bake a timestamp+SHA.
    # Either way, it's a non-None string.
    assert isinstance(version, str)
# ---------------------------------------------------------------------------
# First-install upgrade flow
# ---------------------------------------------------------------------------
def test_first_install_copies_all_files(isolated_config_dir):
    """On first install, all bundled files are copied to user dir."""
    assert not isolated_config_dir.exists()
    ConfigManager()
    assert isolated_config_dir.is_dir()
    # Every managed + user file is present.
    for filename in (
        "system.md",
        "system_doc.md",
        "review.md",
        "commit.md",
        "compaction.md",
        "system_reminder.md",
        "app.json",
        "snippets.json",
        "llm.json",
    ):
        assert (isolated_config_dir / filename).is_file(), f"missing {filename}"
def test_first_install_writes_version_marker_for_release_builds(
    isolated_config_dir,
):
    """Release builds write a .bundled_version marker on first install."""
    # Simulate a release build by patching _bundled_version.
    with patch("ac_dc.config._bundled_version", return_value="2025.01.15-a1b2c3d4"):
        ConfigManager()
    marker = isolated_config_dir / ".bundled_version"
    assert marker.exists()
    assert marker.read_text(encoding="utf-8").strip() == "2025.01.15-a1b2c3d4"
def test_first_install_writes_dev_marker(isolated_config_dir):
    """Source installs with version='dev' write 'dev' as the marker.
    The code writes any truthy version. A dev install records 'dev',
    and the next real release mismatches it and triggers upgrade.
    """
    with patch("ac_dc.config._bundled_version", return_value="dev"):
        ConfigManager()
    marker = isolated_config_dir / ".bundled_version"
    assert marker.exists()
    assert marker.read_text(encoding="utf-8").strip() == "dev"
def test_first_install_skips_marker_when_version_empty(isolated_config_dir):
    """Empty version (VERSION file unreadable) skips marker write.
    We can't record a version we don't know, so the next run treats
    everything as new again.
    """
    with patch("ac_dc.config._bundled_version", return_value=""):
        ConfigManager()
    marker = isolated_config_dir / ".bundled_version"
    assert not marker.exists()
# ---------------------------------------------------------------------------
# Same-version no-op
# ---------------------------------------------------------------------------
def test_same_version_startup_is_noop(isolated_config_dir):
    """Second startup with matching version doesn't modify files."""
    version = "2025.01.15-a1b2c3d4"
    with patch("ac_dc.config._bundled_version", return_value=version):
        # First install.
        ConfigManager()
        # User modifies a managed file.
        system_md = isolated_config_dir / "system.md"
        system_md.write_text("user-edited content", encoding="utf-8")
        # Second startup — same version.
        ConfigManager()
        # User edit preserved.
        assert system_md.read_text(encoding="utf-8") == "user-edited content"
# ---------------------------------------------------------------------------
# Upgrade flow
# ---------------------------------------------------------------------------
def test_upgrade_backs_up_and_overwrites_managed_files(isolated_config_dir):
    """On version bump, managed files are backed up and overwritten."""
    # Install at version A.
    with patch("ac_dc.config._bundled_version", return_value="2025.01.01-aaaaaaaa"):
        ConfigManager()
    # User customises a managed file.
    system_md = isolated_config_dir / "system.md"
    system_md.write_text("user-hacked system prompt", encoding="utf-8")
    # Startup at version B — triggers upgrade.
    with patch("ac_dc.config._bundled_version", return_value="2025.02.01-bbbbbbbb"):
        ConfigManager()
    # Original content was backed up somewhere.
    backups = list(isolated_config_dir.glob("system.md.*"))
    assert len(backups) == 1
    assert "user-hacked system prompt" in backups[0].read_text(encoding="utf-8")
    # Managed file was overwritten with the bundled version.
    current = system_md.read_text(encoding="utf-8")
    assert "user-hacked" not in current
    # Bundled system.md starts with "You are an expert coding agent".
    assert "expert coding agent" in current

    # Marker updated to the new version.
    marker = isolated_config_dir / ".bundled_version"
    assert marker.read_text(encoding="utf-8").strip() == "2025.02.01-bbbbbbbb"
def test_upgrade_preserves_user_files(isolated_config_dir):
    """User files (llm.json, system_extra.md) are never overwritten."""
    # Install at version A.
    with patch("ac_dc.config._bundled_version", return_value="2025.01.01-aaaaaaaa"):
        ConfigManager()
    # User edits llm.json — this is a user file.
    llm_json = isolated_config_dir / "llm.json"
    custom = {
        "model": "custom/my-model",
        "env": {"MY_API_KEY": "secret"},
    }
    llm_json.write_text(json.dumps(custom), encoding="utf-8")
    # Upgrade to version B.
    with patch("ac_dc.config._bundled_version", return_value="2025.02.01-bbbbbbbb"):
        ConfigManager()
    # User file preserved exactly.
    preserved = json.loads(llm_json.read_text(encoding="utf-8"))
    assert preserved["model"] == "custom/my-model"
    assert preserved["env"]["MY_API_KEY"] == "secret"
    # And no backup file was created for user files.
    user_backups = list(isolated_config_dir.glob("llm.json.*"))
    assert user_backups == []
def test_backup_name_with_version(isolated_config_dir):
    """Backup filename includes the OLD installed version."""
    with patch("ac_dc.config._bundled_version", return_value="2025.01.01-aaaaaaaa"):
        ConfigManager()
    # Modify a managed file so it gets backed up.
    (isolated_config_dir / "system.md").write_text("v1 content", encoding="utf-8")
    with patch("ac_dc.config._bundled_version", return_value="2025.02.01-bbbbbbbb"):
        ConfigManager()
    backups = list(isolated_config_dir.glob("system.md.*"))
    assert len(backups) == 1
    # Backup name contains the OLD version, not the new one.
    assert "2025.01.01-aaaaaaaa" in backups[0].name
    assert "2025.02.01-bbbbbbbb" not in backups[0].name
def test_backup_name_without_version(isolated_config_dir):
    """Backup filename falls back to timestamp-only when no installed version."""
    # First install with empty version — no marker written.
    with patch("ac_dc.config._bundled_version", return_value=""):
        ConfigManager()
    # User customises a managed file.
    (isolated_config_dir / "system.md").write_text("custom", encoding="utf-8")
    # Upgrade to a real version — no installed version to stamp into backup.
    with patch("ac_dc.config._bundled_version", return_value="2025.02.01-bbbbbbbb"):
        ConfigManager()
    backups = list(isolated_config_dir.glob("system.md.*"))
    assert len(backups) == 1
    # Backup name has a timestamp but no trailing -sha.
    # Format: system.md.YYYY.MM.DD-HH.MM
    import re
    assert re.match(
        r"^system\.md\.\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}$",
        backups[0].name,
    ), f"unexpected backup name: {backups[0].name}"
# ---------------------------------------------------------------------------
# Accessor read-through
# ---------------------------------------------------------------------------
def test_llm_config_defaults(isolated_config_dir):
    """Accessor properties return bundled defaults on a fresh install."""
    cfg = ConfigManager()
    # The bundled llm.json has these values.
    assert cfg.model.startswith("anthropic/")
    assert cfg.smaller_model.startswith("anthropic/")
    assert cfg.cache_min_tokens == 1024
    assert cfg.cache_buffer_multiplier == pytest.approx(1.1)
def test_llm_config_hot_reload(isolated_config_dir):
    """Editing llm.json and calling reload_llm_config reflects changes.
    Core contract — accessor properties are read-through, not
    snapshots at construction time.
    """
    cfg = ConfigManager()
    original_model = cfg.model
    # User edits llm.json on disk.
    llm_json = isolated_config_dir / "llm.json"
    data = json.loads(llm_json.read_text(encoding="utf-8"))
    data["model"] = "custom/new-model"
    llm_json.write_text(json.dumps(data), encoding="utf-8")
    # Before reload — cached snapshot still in effect.
    assert cfg.model == original_model
    # After reload — new value visible.
    cfg.reload_llm_config()
    assert cfg.model == "custom/new-model"
def test_smaller_model_accepts_camelcase(isolated_config_dir):
    """smaller_model accessor honours both snake_case and camelCase keys."""
    llm_json = isolated_config_dir / "llm.json"
    # Pre-seed with only the camelCase variant.
    llm_json.parent.mkdir(parents=True, exist_ok=True)
    llm_json.write_text(
        json.dumps({"model": "anthropic/foo", "smallerModel": "anthropic/bar"}),
        encoding="utf-8",
    )
    # First-install logic would overwrite our seed only if the user file
    # doesn't exist, so create the marker to indicate same-version startup.
    with patch("ac_dc.config._bundled_version", return_value="seeded-version"):
        (isolated_config_dir / ".bundled_version").write_text(
            "seeded-version", encoding="utf-8"
        )
        cfg = ConfigManager()
    assert cfg.smaller_model == "anthropic/bar"
def test_cache_target_tokens_for_opus(isolated_config_dir):
    """Opus model: max(1024, 4096) × 1.1 = 4505."""
    cfg = ConfigManager()
    target = cfg.cache_target_tokens_for_model("anthropic/claude-opus-4-6")
    assert target == int(4096 * 1.1)  # 4505
def test_cache_target_tokens_for_sonnet(isolated_config_dir):
    """Sonnet model: max(1024, 1024) × 1.1 = 1126."""
    cfg = ConfigManager()
    target = cfg.cache_target_tokens_for_model("anthropic/claude-sonnet-4-5")
    assert target == int(1024 * 1.1)  # 1126
def test_cache_target_tokens_fallback(isolated_config_dir):
    """cache_target_tokens (no model) uses cache_min × multiplier."""
    cfg = ConfigManager()
    assert cfg.cache_target_tokens == int(1024 * 1.1)
def test_cache_target_respects_user_override(isolated_config_dir):
    """User can raise cache_min_tokens above the provider minimum."""
    llm_json = isolated_config_dir / "llm.json"
    llm_json.parent.mkdir(parents=True, exist_ok=True)
    llm_json.write_text(
        json.dumps({
            "model": "anthropic/claude-sonnet-4-5",
            "cache_min_tokens": 8000,
            "cache_buffer_multiplier": 1.2,
        }),
        encoding="utf-8",
    )
    with patch("ac_dc.config._bundled_version", return_value="seeded"):
        (isolated_config_dir / ".bundled_version").write_text("seeded", encoding="utf-8")
        cfg = ConfigManager()
    # Sonnet's provider min is 1024, but user set 8000. max = 8000.
    target = cfg.cache_target_tokens_for_model("anthropic/claude-sonnet-4-5")
    assert target == int(8000 * 1.2)  # 9600
# ---------------------------------------------------------------------------
# App config accessors
# ---------------------------------------------------------------------------
def test_compaction_config_defaults(isolated_config_dir):
    """compaction_config returns all required keys with sensible values."""
    cfg = ConfigManager()
    cc = cfg.compaction_config
    assert cc["enabled"] is True
    assert cc["compaction_trigger_tokens"] > 0
    assert cc["verbatim_window_tokens"] > 0
    assert cc["summary_budget_tokens"] > 0
    assert cc["min_verbatim_exchanges"] >= 1
def test_doc_convert_config_defaults(isolated_config_dir):
    """doc_convert_config returns extensions list and size limit."""
    cfg = ConfigManager()
    dcc = cfg.doc_convert_config
    assert dcc["enabled"] is True
    assert ".docx" in dcc["extensions"]
    assert ".pdf" in dcc["extensions"]
    assert dcc["max_source_size_mb"] > 0
def test_doc_index_config_defaults(isolated_config_dir):
    """doc_index_config returns all keyword-enricher fields."""
    cfg = ConfigManager()
    dic = cfg.doc_index_config
    assert isinstance(dic["keyword_model"], str)
    assert dic["keyword_model"]
    assert dic["keywords_enabled"] is True
    assert dic["keywords_top_n"] > 0
    assert dic["keywords_ngram_range"] == [1, 2]
    assert 0.0 <= dic["keywords_min_score"] <= 1.0
    assert 0.0 <= dic["keywords_diversity"] <= 1.0
    assert 0.0 <= dic["keywords_max_doc_freq"] <= 1.0
def test_url_cache_config_defaults(isolated_config_dir):
    """url_cache_config returns path (possibly None) and ttl_hours."""
    cfg = ConfigManager()
    ucc = cfg.url_cache_config
    assert "path" in ucc
    assert ucc["ttl_hours"] > 0
def test_app_config_hot_reload(isolated_config_dir):
    """Editing app.json and calling reload_app_config reflects changes."""
    cfg = ConfigManager()
    original_trigger = cfg.compaction_config["compaction_trigger_tokens"]
    # User edits app.json on disk.

    app_json = isolated_config_dir / "app.json"
    data = json.loads(app_json.read_text(encoding="utf-8"))
    data["history_compaction"]["compaction_trigger_tokens"] = 99999
    app_json.write_text(json.dumps(data), encoding="utf-8")
    # Before reload — cached.
    assert cfg.compaction_config["compaction_trigger_tokens"] == original_trigger
    # After reload — new value.
    cfg.reload_app_config()
    assert cfg.compaction_config["compaction_trigger_tokens"] == 99999
# ---------------------------------------------------------------------------
# Corrupt-config resilience
# ---------------------------------------------------------------------------
def test_corrupt_llm_json_returns_empty_dict(isolated_config_dir):
    """Malformed JSON doesn't crash construction — logs and falls back."""
    # Install normally.
    ConfigManager()
    # Overwrite with garbage.
    (isolated_config_dir / "llm.json").write_text(
        "{not valid json", encoding="utf-8"
    )
    cfg = ConfigManager()
    # Properties fall back to their hard-coded defaults.
    assert cfg.model.startswith("anthropic/")
    assert cfg.cache_min_tokens == 1024
def test_non_dict_json_root_falls_back(isolated_config_dir):
    """A JSON root that's not an object logs and falls back."""
    ConfigManager()
    (isolated_config_dir / "app.json").write_text("[]", encoding="utf-8")
    cfg = ConfigManager()
    # Accessors return their defaults despite the broken file.
    assert cfg.compaction_config["enabled"] is True
# ---------------------------------------------------------------------------
# apply_llm_env
# ---------------------------------------------------------------------------
def test_apply_llm_env_exports_variables(isolated_config_dir, monkeypatch):
    """apply_llm_env() exports env vars from llm.json into os.environ."""
    # Ensure the var isn't already set.
    monkeypatch.delenv("MY_TEST_API_KEY", raising=False)
    ConfigManager()
    llm_json = isolated_config_dir / "llm.json"
    data = json.loads(llm_json.read_text(encoding="utf-8"))
    data["env"] = {"MY_TEST_API_KEY": "secret-value"}
    llm_json.write_text(json.dumps(data), encoding="utf-8")
    cfg = ConfigManager()
    cfg.apply_llm_env()
    assert os.environ["MY_TEST_API_KEY"] == "secret-value"
def test_apply_llm_env_stringifies_non_string_values(
    isolated_config_dir, monkeypatch
):
    """Numeric env values get stringified — os.environ requires strings."""
    monkeypatch.delenv("MY_NUMERIC_VAR", raising=False)
    ConfigManager()
    llm_json = isolated_config_dir / "llm.json"
    data = json.loads(llm_json.read_text(encoding="utf-8"))
    data["env"] = {"MY_NUMERIC_VAR": 42}
    llm_json.write_text(json.dumps(data), encoding="utf-8")
    cfg = ConfigManager()
    cfg.apply_llm_env()
    assert os.environ["MY_NUMERIC_VAR"] == "42"
def test_apply_llm_env_handles_non_dict(isolated_config_dir):
    """Malformed env value (not a dict) logs and is a no-op."""
    ConfigManager()
    llm_json = isolated_config_dir / "llm.json"
    llm_json.write_text(
        json.dumps({"model": "anthropic/foo", "env": "not a dict"}),
        encoding="utf-8",
    )
    with patch("ac_dc.config._bundled_version", return_value="seeded"):
        (isolated_config_dir / ".bundled_version").write_text(
            "seeded", encoding="utf-8"
        )
        cfg = ConfigManager()
    # Should not raise.
    cfg.apply_llm_env()
def test_reload_llm_config_reapplies_env(isolated_config_dir, monkeypatch):
    """reload_llm_config re-applies env vars after reading new llm.json."""
    monkeypatch.delenv("RELOAD_TEST_KEY", raising=False)
    cfg = ConfigManager()
    # Initially no env var.
    assert "RELOAD_TEST_KEY" not in os.environ
    # User edits llm.json to add an env var.
    llm_json = isolated_config_dir / "llm.json"
    data = json.loads(llm_json.read_text(encoding="utf-8"))
    data["env"] = {"RELOAD_TEST_KEY": "new-secret"}
    llm_json.write_text(json.dumps(data), encoding="utf-8")
    cfg.reload_llm_config()
    assert os.environ["RELOAD_TEST_KEY"] == "new-secret"
# ---------------------------------------------------------------------------
# Per-repo .ac-dc/ working directory
# ---------------------------------------------------------------------------
def test_ac_dc_dir_not_created_without_repo(isolated_config_dir):
    """No repo_root argument → no per-repo directory created."""
    cfg = ConfigManager()
    assert cfg.ac_dc_dir is None
    assert cfg.repo_root is None
def test_ac_dc_dir_created_with_repo(isolated_config_dir, repo_root):
    """When repo_root is given, .ac-dc/ and .ac-dc/images/ are created."""
    cfg = ConfigManager(repo_root=repo_root)
    assert cfg.repo_root == repo_root
    assert cfg.ac_dc_dir == repo_root / ".ac-dc"
    assert cfg.ac_dc_dir.is_dir()
    assert (cfg.ac_dc_dir / "images").is_dir()
def test_ac_dc_dir_creation_is_idempotent(isolated_config_dir, repo_root):
    """Calling ConfigManager twice doesn't fail if .ac-dc/ already exists."""
    ConfigManager(repo_root=repo_root)
    # Add a file inside to prove it isn't re-created (which would delete it).
    marker = repo_root / ".ac-dc" / "marker.txt"
    marker.write_text("preserve me", encoding="utf-8")
    ConfigManager(repo_root=repo_root)
    assert marker.read_text(encoding="utf-8") == "preserve me"
def test_gitignore_created_when_absent(isolated_config_dir, repo_root):
    """A fresh repo gets a .gitignore containing the .ac-dc/ entry."""
    assert not (repo_root / ".gitignore").exists()
    ConfigManager(repo_root=repo_root)
    gitignore = (repo_root / ".gitignore").read_text(encoding="utf-8")
    assert ".ac-dc/" in gitignore
def test_gitignore_entry_appended_when_present(isolated_config_dir, repo_root):
    """Existing .gitignore gets the entry appended, existing content preserved."""
    gitignore = repo_root / ".gitignore"
    gitignore.write_text("*.pyc\n__pycache__/\n", encoding="utf-8")
    ConfigManager(repo_root=repo_root)
    content = gitignore.read_text(encoding="utf-8")
    assert "*.pyc" in content
    assert "__pycache__/" in content
    assert ".ac-dc/" in content
def test_gitignore_not_duplicated(isolated_config_dir, repo_root):
    """Running twice doesn't append .ac-dc/ twice."""
    ConfigManager(repo_root=repo_root)
    ConfigManager(repo_root=repo_root)
    content = (repo_root / ".gitignore").read_text(encoding="utf-8")
    assert content.count(".ac-dc/") == 1
def test_gitignore_recognises_trailing_slashless_entry(
    isolated_config_dir, repo_root
):
    """An existing '.ac-dc' entry (no slash) is recognised and not duplicated."""
    gitignore = repo_root / ".gitignore"
    gitignore.write_text(".ac-dc\n", encoding="utf-8")
    ConfigManager(repo_root=repo_root)
    content = gitignore.read_text(encoding="utf-8")
    # The original '.ac-dc' line remains; no new '.ac-dc/' line added.
    assert ".ac-dc\n" in content
    assert ".ac-dc/" not in content
def test_gitignore_handles_missing_trailing_newline(
    isolated_config_dir, repo_root
):
    """Appends correctly even when existing .gitignore has no trailing newline."""
    gitignore = repo_root / ".gitignore"
    gitignore.write_text("*.pyc", encoding="utf-8")  # no trailing \n
    ConfigManager(repo_root=repo_root)
    content = gitignore.read_text(encoding="utf-8")
    # Appended entry is on its own line.
    lines = content.splitlines()
    assert "*.pyc" in lines
    assert ".ac-dc/" in lines
# ---------------------------------------------------------------------------
# Snippets — fallback chain and format support
# ---------------------------------------------------------------------------
def test_get_snippets_nested_format(isolated_config_dir):
    """Default bundled snippets.json uses nested format with all three modes."""
    cfg = ConfigManager()
    for mode in ("code", "review", "doc"):
        snippets = cfg.get_snippets(mode)
        assert isinstance(snippets, list)
        assert len(snippets) > 0
        for snip in snippets:
            assert "icon" in snip
            assert "tooltip" in snip
            assert "message" in snip
def test_get_snippets_unknown_mode_returns_empty(isolated_config_dir):
    """Unknown mode returns empty list, not an error."""
    cfg = ConfigManager()
    assert cfg.get_snippets("nonexistent") == []
def test_get_snippets_legacy_flat_format(isolated_config_dir):
    """Legacy flat format ({snippets: [...]}) is still parsed."""
    snippets_json = isolated_config_dir / "snippets.json"
    snippets_json.parent.mkdir(parents=True, exist_ok=True)
    legacy = {
        "snippets": [
            {"icon": "A", "tooltip": "t1", "message": "m1", "mode": "code"},
            {"icon": "B", "tooltip": "t2", "message": "m2", "mode": "review"},
            {"icon": "C", "tooltip": "t3", "message": "m3", "mode": "doc"},
            # No mode field — defaults to code.
            {"icon": "D", "tooltip": "t4", "message": "m4"},
        ]
    }
    snippets_json.write_text(json.dumps(legacy), encoding="utf-8")
    # Seed the marker so construction doesn't overwrite our file.
    (isolated_config_dir / ".bundled_version").write_text(
        "seeded", encoding="utf-8"
    )
    with patch("ac_dc.config._bundled_version", return_value="seeded"):
        cfg = ConfigManager()
    code = cfg.get_snippets("code")
    # Two code entries — explicit and default.
    icons = {s["icon"] for s in code}
    assert icons == {"A", "D"}
    review = cfg.get_snippets("review")
    assert [s["icon"] for s in review] == ["B"]
    doc = cfg.get_snippets("doc")
    assert [s["icon"] for s in doc] == ["C"]
def test_get_snippets_missing_user_file_falls_back_to_bundle(
    isolated_config_dir,
):
    """Missing user snippets.json falls back to the bundled copy.

    Contract: ``_read_user_file`` falls back to the bundled copy for
    any file absent from the user dir. This keeps quick-insert
    buttons working if a user accidentally deletes ``snippets.json``
    — a silently empty drawer would be worse UX than the default set.

    The test seeds a version marker so the upgrade pass doesn't
    re-copy the bundle into the user dir. Without the marker-seed,
    ``_run_upgrade`` would see the missing file, treat it as new,
    and copy it back — masking the fallback path this test is about.
    """
    ConfigManager()
    # Delete the snippets file after install, then seed the marker so
    # the next ConfigManager construction skips the upgrade pass.
    (isolated_config_dir / "snippets.json").unlink()
    (isolated_config_dir / ".bundled_version").write_text(
        "seeded", encoding="utf-8"
    )
    with patch("ac_dc.config._bundled_version", return_value="seeded"):
        cfg = ConfigManager()
    # Upgrade was skipped, so the file is still absent from user dir.
    assert not (isolated_config_dir / "snippets.json").exists()
    # But ``get_snippets`` still returns the bundled defaults via the
    # ``_read_user_file`` fallback.
    code_snippets = cfg.get_snippets("code")
    assert len(code_snippets) > 0
    for snip in code_snippets:
        assert "icon" in snip
        assert "tooltip" in snip
        assert "message" in snip
def test_get_snippets_corrupt_file_returns_empty(isolated_config_dir):
    """Malformed snippets.json logs a warning and returns []."""
    ConfigManager()
    (isolated_config_dir / "snippets.json").write_text(
        "{not json", encoding="utf-8"
    )
    with patch("ac_dc.config._bundled_version", return_value="seeded"):
        (isolated_config_dir / ".bundled_version").write_text(
            "seeded", encoding="utf-8"
        )
        cfg = ConfigManager()
    # Must not raise — a broken snippets file cannot break the chat UI.
    assert cfg.get_snippets("code") == []
def test_get_snippets_per_repo_override_takes_precedence(
    isolated_config_dir, repo_root
):
    """Per-repo snippets.json is consulted before the user config dir."""
    cfg = ConfigManager(repo_root=repo_root)
    # Write a per-repo override with distinctive content.
    override_path = repo_root / ".ac-dc" / "snippets.json"
    override = {
        "code": [
            {"icon": "REPO", "tooltip": "repo-specific", "message": "from repo"}
        ],
    }
    override_path.write_text(json.dumps(override), encoding="utf-8")
    result = cfg.get_snippets("code")
    assert len(result) == 1
    assert result[0]["icon"] == "REPO"
    # User-config-dir snippets still exist and remain unread.
    user_result_for_review = cfg.get_snippets("review")
    # The override only defined "code"; "review" falls through to user dir?
    # No — the per-repo file is consulted as a complete replacement when it
    # parses. If the user wants review-mode snippets, they must include them
    # in the override. This is the contract specs4/1-foundation/configuration.md
    # establishes ("two-location fallback" — first file that exists and parses wins).
    assert user_result_for_review == []
def test_get_snippets_per_repo_corrupt_falls_through(
    isolated_config_dir, repo_root
):
    """Corrupt per-repo snippets.json falls through to user config dir.
    Contract: the per-repo override is a convenience, not a replacement.
    If it's unparseable the chat UI must still work with the user's
    global snippets.
    """
    cfg = ConfigManager(repo_root=repo_root)
    # Write garbage to the per-repo override.
    override_path = repo_root / ".ac-dc" / "snippets.json"
    override_path.write_text("{not valid json", encoding="utf-8")
    # User-config snippets still deliver defaults for code mode.
    result = cfg.get_snippets("code")
    assert len(result) > 0
def test_get_snippets_per_repo_non_object_falls_through(
    isolated_config_dir, repo_root
):
    """Per-repo snippets.json whose root is not an object falls through."""
    cfg = ConfigManager(repo_root=repo_root)
    override_path = repo_root / ".ac-dc" / "snippets.json"
    # Valid JSON, but the root is a list — snippets expect a dict.
    override_path.write_text("[]", encoding="utf-8")
    # Falls through to the bundled defaults.
    result = cfg.get_snippets("code")
    assert len(result) > 0
# ---------------------------------------------------------------------------
# Prompt assembly
# ---------------------------------------------------------------------------
def test_get_system_prompt_concatenates_with_extra(isolated_config_dir):
    """system.md + blank line + system_extra.md.
    The bundled system_extra.md is empty, so we write a marker into it
    to prove concatenation works.
    """
    cfg = ConfigManager()
    extra_file = isolated_config_dir / "system_extra.md"
    extra_file.write_text("PROJECT-SPECIFIC-MARKER-XYZ", encoding="utf-8")
    prompt = cfg.get_system_prompt()
    assert "PROJECT-SPECIFIC-MARKER-XYZ" in prompt
    # The main prompt is still present.
    assert "expert coding agent" in prompt
    # Separator is a blank line between main and extra.
    assert "\n\nPROJECT-SPECIFIC-MARKER-XYZ" in prompt
def test_get_system_prompt_empty_extra_returns_main_only(isolated_config_dir):
    """Empty system_extra.md produces just the main prompt, no trailing whitespace."""
    cfg = ConfigManager()
    # Ensure extra is empty.
    extra_file = isolated_config_dir / "system_extra.md"
    extra_file.write_text("", encoding="utf-8")
    prompt = cfg.get_system_prompt()
    main_only = (isolated_config_dir / "system.md").read_text(encoding="utf-8")
    assert prompt == main_only
def test_get_system_prompt_reads_fresh_every_call(isolated_config_dir):
    """Edits to system.md take effect on the next get_system_prompt() call.
    Prompts are intentionally NOT cached — users can edit prompt files
    and see the change on the next LLM request without an explicit
    reload call.
    """
    cfg = ConfigManager()
    first = cfg.get_system_prompt()
    # Append a marker to system.md.
    system_file = isolated_config_dir / "system.md"
    original = system_file.read_text(encoding="utf-8")
    system_file.write_text(original + "\nHOT-RELOAD-MARKER", encoding="utf-8")
    second = cfg.get_system_prompt()
    assert "HOT-RELOAD-MARKER" in second
    assert second != first
def test_get_doc_system_prompt_uses_doc_main(isolated_config_dir):
    """get_doc_system_prompt concatenates system_doc.md + extra."""
    cfg = ConfigManager()
    extra_file = isolated_config_dir / "system_extra.md"
    extra_file.write_text("DOC-EXTRA-MARKER", encoding="utf-8")
    prompt = cfg.get_doc_system_prompt()
    # Doc-mode prompt uses documentation-focused content.
    lower = prompt.lower()
    assert "document" in lower
    # Extra is appended.
    assert "DOC-EXTRA-MARKER" in prompt
def test_get_review_prompt_uses_review_main(isolated_config_dir):
    """get_review_prompt concatenates review.md + extra."""
    cfg = ConfigManager()
    extra_file = isolated_config_dir / "system_extra.md"
    extra_file.write_text("REVIEW-EXTRA-MARKER", encoding="utf-8")
    prompt = cfg.get_review_prompt()
    lower = prompt.lower()
    # review.md is explicit about read-only review mode.
    assert "read-only" in lower or "read only" in lower
    assert "REVIEW-EXTRA-MARKER" in prompt
def test_get_compaction_prompt_loads_as_is(isolated_config_dir):
    """Compaction prompt is loaded without extra-prompt concatenation.
    The compactor is an auxiliary LLM call with a rigid JSON output
    format — user extras would corrupt it.
    """
    cfg = ConfigManager()
    # Even if system_extra.md has content, it's not applied here.
    (isolated_config_dir / "system_extra.md").write_text(
        "SHOULD-NOT-APPEAR", encoding="utf-8"
    )
    prompt = cfg.get_compaction_prompt()
    assert "SHOULD-NOT-APPEAR" not in prompt
    # Still returns real content from compaction.md.
    assert "boundary_index" in prompt
def test_get_commit_prompt_loads_as_is(isolated_config_dir):
    """Commit prompt is loaded without extra-prompt concatenation."""
    cfg = ConfigManager()
    (isolated_config_dir / "system_extra.md").write_text(
        "SHOULD-NOT-APPEAR", encoding="utf-8"
    )
    prompt = cfg.get_commit_prompt()
    assert "SHOULD-NOT-APPEAR" not in prompt
    # Still returns real content.
    assert "conventional" in prompt.lower() or "imperative" in prompt.lower()
def test_get_system_reminder_has_leading_newlines(isolated_config_dir):
    """get_system_reminder returns content prefixed with \\n\\n.
    Callers append this to the user's message text directly; the
    leading blank line separates it from the message content.
    """
    cfg = ConfigManager()
    reminder = cfg.get_system_reminder()
    assert reminder.startswith("\n\n")
    # Body is non-empty (shipped reminder always has content).
    assert reminder.strip()
def test_get_system_reminder_empty_file_returns_empty(isolated_config_dir):
    """Empty system_reminder.md produces an empty string, not \\n\\n.

    Callers concatenate the reminder onto the user's message text; an
    empty file should contribute literally nothing rather than two
    stray newlines that would leave trailing whitespace on every turn.
    """
    cfg = ConfigManager()
    (isolated_config_dir / "system_reminder.md").write_text("", encoding="utf-8")
    assert cfg.get_system_reminder() == ""


def test_get_system_reminder_whitespace_only_returns_empty(isolated_config_dir):
    """A whitespace-only reminder file is treated as empty."""
    cfg = ConfigManager()
    (isolated_config_dir / "system_reminder.md").write_text(
        "   \n\n  \t\n", encoding="utf-8"
    )
    assert cfg.get_system_reminder() == ""


# ---------------------------------------------------------------------------
# CONFIG_TYPES whitelist
# ---------------------------------------------------------------------------


def test_config_types_covers_editable_files():
    """CONFIG_TYPES whitelist includes every file the Settings UI edits.

    specs4/1-foundation/configuration.md#settings-service names these
    as the RPC-exposed config types. Adding a new editable file
    requires adding it here.
    """
    expected_keys = {
        "litellm",
        "app",
        "snippets",
        "system",
        "system_extra",
        "compaction",
        "review",
        "system_doc",
    }
    assert set(CONFIG_TYPES.keys()) == expected_keys


def test_config_types_excludes_internal_prompts():
    """commit.md and system_reminder.md are NOT in the whitelist.

    Per D10 / specs4 — these are managed files loaded internally but
    intentionally not exposed for UI editing. commit.md has a rigid
    JSON-adjacent output contract; system_reminder.md appends to every
    user turn and a malformed edit would break every subsequent
    request. Users who need to customise them can edit the files on
    disk directly.
    """
    whitelisted_files = set(CONFIG_TYPES.values())
    assert "commit.md" not in whitelisted_files
    assert "system_reminder.md" not in whitelisted_files


def test_config_types_values_are_real_files(isolated_config_dir):
    """Every whitelisted type maps to a real shipped file."""
    ConfigManager()  # Trigger install so files exist in user dir.
    for type_name, filename in CONFIG_TYPES.items():
        # system_extra may be absent or empty; the others must exist.
        if type_name == "system_extra":
            continue
        path = isolated_config_dir / filename
        assert path.is_file(), f"{type_name!r} → {filename!r} not installed"


# ---------------------------------------------------------------------------
# _bundled_config_dir resolution
# ---------------------------------------------------------------------------


def test_bundled_config_dir_uses_module_relative_path():
    """Outside PyInstaller, config dir is next to the ac_dc module."""
    # sys._MEIPASS is unset in normal test runs.
    if hasattr(sys, "_MEIPASS"):
        pytest.skip("running inside PyInstaller bundle")
    bundled = _bundled_config_dir()
    assert bundled.is_dir()
    assert bundled.name == "config"
    # Parent should be the ac_dc package dir.
    assert bundled.parent.name == "ac_dc"


def test_bundled_config_dir_prefers_meipass_when_present(monkeypatch, tmp_path):
    """Inside a PyInstaller bundle, _MEIPASS takes precedence.

    We simulate the bundle layout by creating ``<meipass>/ac_dc/config/``
    and setting sys._MEIPASS to point at it.
    """
    fake_meipass = tmp_path / "meipass"
    fake_config = fake_meipass / "ac_dc" / "config"
    fake_config.mkdir(parents=True)
    # Drop a sentinel file so we can verify we actually read this dir
    # (not the real one next to the module).
    (fake_config / "sentinel.txt").write_text("from meipass", encoding="utf-8")

    monkeypatch.setattr(sys, "_MEIPASS", str(fake_meipass), raising=False)
    resolved = _bundled_config_dir()
    assert resolved == fake_config
    assert (resolved / "sentinel.txt").read_text(encoding="utf-8") == "from meipass"


def test_bundled_config_dir_falls_back_when_meipass_missing_config(
    monkeypatch, tmp_path, caplog
):
    """If _MEIPASS is set but doesn't contain ac_dc/config, fall back.

    Pathological-but-real case — a malformed PyInstaller bundle or a
    misconfigured test harness setting _MEIPASS incorrectly. We log a
    warning and use the module-relative path so the app still works.
    """
    empty_meipass = tmp_path / "empty-meipass"
    empty_meipass.mkdir()
    monkeypatch.setattr(sys, "_MEIPASS", str(empty_meipass), raising=False)

    with caplog.at_level("WARNING", logger="ac_dc.config"):
        resolved = _bundled_config_dir()
    # Fell back to the module-relative dir.
    assert resolved.parent.name == "ac_dc"
    assert resolved.is_dir()
    # Logged the fallback so operators can see why.
    assert any("MEIPASS" in r.message for r in caplog.records)