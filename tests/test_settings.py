"""Tests for ac_dc.settings.Settings — Layer 1 (deferred) + 4.4.2.

Covers the RPC surface defined in
specs4/1-foundation/rpc-inventory.md#service-settings-browser--server
plus the collaboration restriction pattern from
specs4/1-foundation/communication-layer.md.

Strategy mirrors ``test_collab_restrictions.py``:

- Real :class:`ConfigManager` against an isolated user config dir
  (via the ``AC_DC_CONFIG_HOME`` env var — the documented test hook).
- Stub collab with a configurable ``is_caller_localhost`` return,
  reusing the same pattern from the repo restriction tests.
- Two scenarios per write method — localhost allowed, non-localhost
  rejected with the specific error shape.

Reads are unguarded — we test that they work regardless of collab
state (single-user path AND non-localhost path) because specs4
explicitly allows non-localhost participants to "browse, search,
view."
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from ac_dc.config import CONFIG_TYPES, ConfigManager
from ac_dc.settings import Settings


# ---------------------------------------------------------------------------
# Stub collab (same shape as test_collab_restrictions.py)
# ---------------------------------------------------------------------------


class _StubCollab:
    """Minimal collab with a configurable localhost flag."""

    def __init__(self, is_localhost: bool = True) -> None:
        self._is_localhost = is_localhost
        self.call_count = 0

    def is_caller_localhost(self) -> bool:
        self.call_count += 1
        return self._is_localhost


class _RaisingCollab:
    """Collab that raises — used to verify fail-closed behaviour."""

    def is_caller_localhost(self) -> bool:
        raise RuntimeError("collab check failed")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def isolated_config_dir(tmp_path, monkeypatch):
    """Redirect user config dir to tmp. Matches test_config.py's fixture."""
    home = tmp_path / "ac-dc-config"
    monkeypatch.setenv("AC_DC_CONFIG_HOME", str(home))
    return home


@pytest.fixture
def config(isolated_config_dir):
    """A freshly-installed ConfigManager (triggers first-install flow)."""
    return ConfigManager()


@pytest.fixture
def settings(config):
    """A Settings service with no collab attached (single-user mode)."""
    return Settings(config)


# ---------------------------------------------------------------------------
# Shared assertion helper
# ---------------------------------------------------------------------------


def _assert_restricted(result: Any) -> None:
    """Assert ``result`` matches the specs4 restricted-error shape."""
    assert isinstance(result, dict)
    assert result.get("error") == "restricted"
    reason = result.get("reason")
    assert isinstance(reason, str) and reason


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------


class TestConstruction:
    def test_holds_config_reference(self, config):
        svc = Settings(config)
        assert svc._config is config

    def test_collab_starts_none(self, settings):
        assert settings._collab is None


# ---------------------------------------------------------------------------
# Whitelist
# ---------------------------------------------------------------------------


class TestWhitelist:
    def test_all_whitelisted_types_resolve(self, settings):
        for type_key in CONFIG_TYPES.keys():
            assert settings._resolve_filename(type_key) is not None

    def test_unknown_type_returns_none(self, settings):
        assert settings._resolve_filename("bogus") is None

    def test_internal_prompts_not_whitelisted(self, settings):
        # commit.md and system_reminder.md are loaded internally but
        # not exposed for UI editing — specs4 pins this.
        assert settings._resolve_filename("commit") is None
        assert settings._resolve_filename("system_reminder") is None


# ---------------------------------------------------------------------------
# get_config_content — read, always allowed
# ---------------------------------------------------------------------------


class TestGetConfigContent:
    def test_reads_shipped_llm_config(self, settings):
        result = settings.get_config_content("litellm")
        assert result["type"] == "litellm"
        # Bundled llm.json is a valid JSON object — parse it to
        # confirm we got real content, not a truncated read.
        parsed = json.loads(result["content"])
        assert "/" in parsed["model"]

    def test_reads_shipped_system_prompt(self, settings):
        result = settings.get_config_content("system")
        assert result["type"] == "system"
        assert "expert coding agent" in result["content"]

    def test_unknown_type_returns_error(self, settings):
        result = settings.get_config_content("bogus")
        assert "error" in result
        assert "bogus" in result["error"]

    def test_commit_prompt_not_readable_via_rpc(self, settings):
        # commit.md is intentionally not in the whitelist — even
        # though the file exists, the RPC can't reach it.
        result = settings.get_config_content("commit")
        assert "error" in result

    def test_missing_user_file_returns_empty_content(
        self, settings, isolated_config_dir, config
    ):
        # Delete the file from the user dir AND suppress the
        # upgrade re-copy by seeding the version marker.
        (isolated_config_dir / "system_extra.md").unlink(missing_ok=True)
        (isolated_config_dir / ".bundled_version").write_text(
            "seeded", encoding="utf-8"
        )
        # Rebuild ConfigManager against the marker so upgrade is a
        # no-op — the file stays missing.
        from unittest.mock import patch
        with patch("ac_dc.config._bundled_version", return_value="seeded"):
            fresh_config = ConfigManager()
        fresh_settings = Settings(fresh_config)
        result = fresh_settings.get_config_content("system_extra")
        # Empty content — not an error. The Settings UI opens a
        # blank editor for this case; a next save creates the
        # file, a next startup re-copies the bundle default.
        assert result == {"type": "system_extra", "content": ""}

    def test_read_allowed_for_non_localhost(self, settings):
        # Reads are always allowed, regardless of collab state.
        settings._collab = _StubCollab(is_localhost=False)
        result = settings.get_config_content("litellm")
        assert "error" not in result or result.get("error") != "restricted"

    def test_read_allowed_when_collab_raises(self, settings):
        # Reads don't call _check_localhost_only, so even a raising
        # collab doesn't affect them.
        settings._collab = _RaisingCollab()
        result = settings.get_config_content("system")
        assert "content" in result


# ---------------------------------------------------------------------------
# get_config_info — read, always allowed
# ---------------------------------------------------------------------------


class TestGetConfigInfo:
    def test_returns_model_names_and_dir(
        self, settings, isolated_config_dir
    ):
        info = settings.get_config_info()
        assert "/" in info["model"]
        assert "/" in info["smaller_model"]
        assert info["config_dir"] == str(isolated_config_dir)

    def test_allowed_for_non_localhost(self, settings):
        settings._collab = _StubCollab(is_localhost=False)
        info = settings.get_config_info()
        assert "model" in info  # Not restricted.


# ---------------------------------------------------------------------------
# Snippet reads — always allowed
# ---------------------------------------------------------------------------


class TestSnippets:
    def test_get_snippets_returns_code_mode(self, settings):
        snips = settings.get_snippets()
        assert isinstance(snips, list)
        assert len(snips) > 0
        for s in snips:
            assert "icon" in s
            assert "tooltip" in s
            assert "message" in s

    def test_get_review_snippets_returns_review_mode(self, settings):
        snips = settings.get_review_snippets()
        assert isinstance(snips, list)
        assert len(snips) > 0

    def test_snippets_allowed_for_non_localhost(self, settings):
        settings._collab = _StubCollab(is_localhost=False)
        # Not restricted.
        assert isinstance(settings.get_snippets(), list)
        assert isinstance(settings.get_review_snippets(), list)


# ---------------------------------------------------------------------------
# save_config_content — localhost-only
# ---------------------------------------------------------------------------


class TestSaveConfigContent:
    def test_save_overwrites_file(
        self, settings, isolated_config_dir
    ):
        new_content = "# Custom system prompt\n\nBe concise.\n"
        result = settings.save_config_content("system", new_content)
        assert result == {"status": "ok", "type": "system"}
        on_disk = (isolated_config_dir / "system.md").read_text(
            encoding="utf-8"
        )
        assert on_disk == new_content

    def test_save_creates_directory_if_missing(
        self, settings, isolated_config_dir
    ):
        # Simulate a vanished config dir (rare but possible — manual
        # rm, filesystem corruption). The save path should re-create.
        import shutil
        shutil.rmtree(isolated_config_dir)
        result = settings.save_config_content("system", "recreated")
        assert result["status"] == "ok"
        assert (isolated_config_dir / "system.md").read_text(
            encoding="utf-8"
        ) == "recreated"

    def test_save_unknown_type_rejected(self, settings):
        result = settings.save_config_content("bogus", "content")
        assert "error" in result
        assert result["error"] != "restricted"
        assert "bogus" in result["error"]

    def test_save_commit_prompt_rejected(self, settings):
        # commit.md not in whitelist — save refuses.
        result = settings.save_config_content("commit", "content")
        assert "error" in result

    def test_save_valid_json_no_warning(
        self, settings, isolated_config_dir
    ):
        content = json.dumps({"model": "custom/model", "env": {}})
        result = settings.save_config_content("litellm", content)
        assert result == {"status": "ok", "type": "litellm"}

    def test_save_invalid_json_warns_but_writes(
        self, settings, isolated_config_dir
    ):
        broken = "{not valid json"
        result = settings.save_config_content("litellm", broken)
        # File was written despite the parse error.
        assert result["status"] == "ok"
        assert "warning" in result
        assert "JSON" in result["warning"]
        on_disk = (isolated_config_dir / "llm.json").read_text(
            encoding="utf-8"
        )
        assert on_disk == broken

    def test_save_markdown_never_json_warns(
        self, settings, isolated_config_dir
    ):
        # Non-JSON files don't trigger JSON validation.
        result = settings.save_config_content(
            "system", "# heading\n\nnot json but not flagged as such"
        )
        assert "warning" not in result

    def test_save_localhost_allowed(self, settings):
        settings._collab = _StubCollab(is_localhost=True)
        result = settings.save_config_content("system", "content")
        assert result["status"] == "ok"

    def test_save_non_localhost_rejected(
        self, settings, isolated_config_dir
    ):
        original = (isolated_config_dir / "system.md").read_text(
            encoding="utf-8"
        )
        settings._collab = _StubCollab(is_localhost=False)
        result = settings.save_config_content(
            "system", "would-be-new-content"
        )
        _assert_restricted(result)
        # File content unchanged — the write never fired.
        assert (isolated_config_dir / "system.md").read_text(
            encoding="utf-8"
        ) == original

    def test_save_collab_raises_fails_closed(
        self, settings, isolated_config_dir
    ):
        original = (isolated_config_dir / "system.md").read_text(
            encoding="utf-8"
        )
        settings._collab = _RaisingCollab()
        result = settings.save_config_content("system", "new")
        _assert_restricted(result)
        # File unchanged.
        assert (isolated_config_dir / "system.md").read_text(
            encoding="utf-8"
        ) == original


# ---------------------------------------------------------------------------
# reload_llm_config — localhost-only
# ---------------------------------------------------------------------------


class TestReloadLlmConfig:
    def test_reload_picks_up_on_disk_changes(
        self, settings, isolated_config_dir, config
    ):
        original_model = config.model
        # Edit llm.json directly (simulating a manual edit OR the
        # frontend's "Reload" button being clicked after a save).
        llm_json = isolated_config_dir / "llm.json"
        data = json.loads(llm_json.read_text(encoding="utf-8"))
        data["model"] = "custom/reloaded-model"
        llm_json.write_text(json.dumps(data), encoding="utf-8")
        # Before reload — cached value.
        assert config.model == original_model
        # Reload.
        result = settings.reload_llm_config()
        assert result == {"status": "ok"}
        assert config.model == "custom/reloaded-model"

    def test_reload_localhost_allowed(self, settings):
        settings._collab = _StubCollab(is_localhost=True)
        result = settings.reload_llm_config()
        assert result == {"status": "ok"}

    def test_reload_non_localhost_rejected(self, settings):
        settings._collab = _StubCollab(is_localhost=False)
        result = settings.reload_llm_config()
        _assert_restricted(result)

    def test_reload_collab_raises_fails_closed(self, settings):
        settings._collab = _RaisingCollab()
        result = settings.reload_llm_config()
        _assert_restricted(result)


# ---------------------------------------------------------------------------
# reload_app_config — localhost-only
# ---------------------------------------------------------------------------


class TestReloadAppConfig:
    def test_reload_picks_up_on_disk_changes(
        self, settings, isolated_config_dir, config
    ):
        original = config.compaction_config["compaction_trigger_tokens"]
        app_json = isolated_config_dir / "app.json"
        data = json.loads(app_json.read_text(encoding="utf-8"))
        data["history_compaction"]["compaction_trigger_tokens"] = 55555
        app_json.write_text(json.dumps(data), encoding="utf-8")
        assert config.compaction_config["compaction_trigger_tokens"] == original
        result = settings.reload_app_config()
        assert result == {"status": "ok"}
        assert config.compaction_config["compaction_trigger_tokens"] == 55555

    def test_reload_localhost_allowed(self, settings):
        settings._collab = _StubCollab(is_localhost=True)
        assert settings.reload_app_config() == {"status": "ok"}

    def test_reload_non_localhost_rejected(self, settings):
        settings._collab = _StubCollab(is_localhost=False)
        _assert_restricted(settings.reload_app_config())

    def test_reload_collab_raises_fails_closed(self, settings):
        settings._collab = _RaisingCollab()
        _assert_restricted(settings.reload_app_config())


# ---------------------------------------------------------------------------
# is_reloadable — static helper
# ---------------------------------------------------------------------------


class TestIsReloadable:
    def test_llm_and_app_are_reloadable(self):
        assert Settings.is_reloadable("litellm") is True
        assert Settings.is_reloadable("app") is True

    def test_prompts_and_snippets_not_reloadable(self):
        # Prompts are read fresh on each use; snippets loaded on demand.
        for t in (
            "system", "system_extra", "system_doc",
            "review", "compaction", "snippets",
        ):
            assert Settings.is_reloadable(t) is False, t

    def test_unknown_type_not_reloadable(self):
        assert Settings.is_reloadable("bogus") is False