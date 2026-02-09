"""Configuration loading, resolution, and settings service."""

import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Optional

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default configs baked into the source
# ---------------------------------------------------------------------------

DEFAULT_LLM_CONFIG = {
    "env": {},
    "model": "anthropic/claude-sonnet-4-20250514",
    "smaller_model": "anthropic/claude-haiku-3",
    "cache_min_tokens": 1024,
    "cache_buffer_multiplier": 1.5,
}

DEFAULT_APP_CONFIG = {
    "url_cache": {
        "path": "",  # empty = system temp
        "ttl_hours": 24,
    },
    "history_compaction": {
        "enabled": True,
        "compaction_trigger_tokens": 24000,
        "verbatim_window_tokens": 4000,
        "summary_budget_tokens": 500,
        "min_verbatim_exchanges": 2,
    },
}

DEFAULT_SNIPPETS = {
    "snippets": [
        {"icon": "✂️", "tooltip": "Continue truncated edit", "message": "Your last edit was truncated, please continue from where you left off."},
        {"icon": "🔍", "tooltip": "Check context", "message": "Please re-read the files in context before making changes."},
        {"icon": "✏️", "tooltip": "Fix edit blocks", "message": "Your last edit block was malformed. Please retry with the correct EDIT/REPLACE format."},
        {"icon": "⏸️", "tooltip": "Pause before implementing", "message": "Before implementing, explain your plan and wait for confirmation."},
        {"icon": "✅", "tooltip": "Verify tests", "message": "Please verify that existing tests still pass with these changes."},
        {"icon": "📦", "tooltip": "Pre-commit checklist", "message": "Review all changes, ensure nothing is broken, and prepare a commit."},
        {"icon": "🏁", "tooltip": "Complete plan", "message": "Complete the remaining items from the plan, then prepare a commit."},
    ]
}


def _platform_config_dir() -> Path:
    """Return platform-specific user config directory."""
    if sys.platform == "win32":
        base = os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")
        return Path(base) / "ac-dc"
    elif sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "ac-dc"
    else:
        base = os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")
        return Path(base) / "ac-dc"


class ConfigManager:
    """Manages loading and caching of all configuration files."""

    # Maps type keys to filenames
    FILE_MAP = {
        "litellm": "litellm_config.json",
        "app": "app_config.json",
        "snippets": "snippets.json",
        "system": "system.md",
        "system_extra": "system_extra.md",
        "compaction": "compaction_skill.md",
    }

    def __init__(self, repo_root: Path, dev_mode: bool = False):
        self.repo_root = repo_root
        self.dev_mode = dev_mode

        # Resolve config directory
        if dev_mode:
            self.config_dir = Path(__file__).parent / "config"
        else:
            self.config_dir = _platform_config_dir()
            self._ensure_user_configs()

        # Repo-local .ac-dc directory
        self.ac_dc_dir = repo_root / ".ac-dc"
        self._ensure_ac_dc_dir()

        # In-memory caches
        self._llm_config: Optional[dict] = None
        self._app_config: Optional[dict] = None

    def _ensure_ac_dc_dir(self):
        """Create .ac-dc/ and add to .gitignore if needed."""
        self.ac_dc_dir.mkdir(exist_ok=True)
        gitignore = self.repo_root / ".gitignore"
        marker = ".ac-dc/"
        if gitignore.exists():
            content = gitignore.read_text()
            if marker not in content:
                with open(gitignore, "a") as f:
                    if not content.endswith("\n"):
                        f.write("\n")
                    f.write(f"{marker}\n")
        else:
            gitignore.write_text(f"{marker}\n")

    def _ensure_user_configs(self):
        """Copy bundled configs to user dir on first run."""
        self.config_dir.mkdir(parents=True, exist_ok=True)
        bundled = Path(__file__).parent / "config"
        if not bundled.exists():
            return
        for fname in bundled.iterdir():
            dest = self.config_dir / fname.name
            if not dest.exists():
                dest.write_bytes(fname.read_bytes())
                log.info("Copied default config: %s", dest)

    def _config_path(self, type_key: str) -> Path:
        if type_key not in self.FILE_MAP:
            raise ValueError(f"Unknown config type: {type_key}")
        return self.config_dir / self.FILE_MAP[type_key]

    # ------------------------------------------------------------------
    # JSON config loading
    # ------------------------------------------------------------------

    def _load_json(self, path: Path, defaults: dict) -> dict:
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    return data
            except (json.JSONDecodeError, OSError) as e:
                log.warning("Failed to load %s: %s — using defaults", path, e)
        return dict(defaults)

    def get_llm_config(self, force_reload: bool = False) -> dict:
        if self._llm_config is None or force_reload:
            path = self._config_path("litellm")
            self._llm_config = self._load_json(path, DEFAULT_LLM_CONFIG)
            # Apply env vars
            for key, val in self._llm_config.get("env", {}).items():
                os.environ[key] = str(val)
            log.info("Loaded LLM config: model=%s", self._llm_config.get("model"))
        return self._llm_config

    def get_app_config(self, force_reload: bool = False) -> dict:
        if self._app_config is None or force_reload:
            path = self._config_path("app")
            self._app_config = self._load_json(path, DEFAULT_APP_CONFIG)
        return self._app_config

    def get_snippets(self) -> dict:
        """Load snippets with two-location fallback: repo-local then app config."""
        repo_snippets = self.ac_dc_dir / "snippets.json"
        if repo_snippets.exists():
            data = self._load_json(repo_snippets, DEFAULT_SNIPPETS)
            if data.get("snippets"):
                return data
        path = self._config_path("snippets")
        return self._load_json(path, DEFAULT_SNIPPETS)

    def get_system_prompt(self) -> str:
        """Assemble system prompt from main + extra files."""
        main_path = self._config_path("system")
        extra_path = self._config_path("system_extra")
        parts = []
        if main_path.exists():
            parts.append(main_path.read_text(encoding="utf-8"))
        if extra_path.exists():
            parts.append(extra_path.read_text(encoding="utf-8"))
        return "\n\n".join(parts)

    def get_compaction_prompt(self) -> str:
        path = self._config_path("compaction")
        if path.exists():
            return path.read_text(encoding="utf-8")
        return ""

    @property
    def cache_target_tokens(self) -> int:
        cfg = self.get_llm_config()
        return int(cfg.get("cache_min_tokens", 1024) * cfg.get("cache_buffer_multiplier", 1.5))

    # ------------------------------------------------------------------
    # Settings RPC methods
    # ------------------------------------------------------------------

    def get_config_content(self, type_key: str) -> dict:
        """Read a config file by type key."""
        if type_key not in self.FILE_MAP:
            return {"error": f"Unknown config type: {type_key}"}
        path = self._config_path(type_key)
        if not path.exists():
            return {"content": "", "path": str(path)}
        try:
            return {"content": path.read_text(encoding="utf-8"), "path": str(path)}
        except OSError as e:
            return {"error": str(e)}

    def save_config_content(self, type_key: str, content: str) -> dict:
        """Write a config file by type key."""
        if type_key not in self.FILE_MAP:
            return {"error": f"Unknown config type: {type_key}"}
        path = self._config_path(type_key)
        try:
            path.write_text(content, encoding="utf-8")
            return {"ok": True, "path": str(path)}
        except OSError as e:
            return {"error": str(e)}

    def reload_llm_config(self) -> dict:
        cfg = self.get_llm_config(force_reload=True)
        return {"model": cfg.get("model"), "smaller_model": cfg.get("smaller_model")}

    def reload_app_config(self) -> dict:
        self.get_app_config(force_reload=True)
        return {"ok": True}

    def get_config_info(self) -> dict:
        llm = self.get_llm_config()
        return {
            "model": llm.get("model"),
            "smaller_model": llm.get("smaller_model"),
            "config_dir": str(self.config_dir),
            "ac_dc_dir": str(self.ac_dc_dir),
        }
