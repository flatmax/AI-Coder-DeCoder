"""Configuration management for AC⚡DC.

Handles loading, caching, and resolution of config files:
- LLM config (provider settings)
- App config (application settings)
- System prompts
- Prompt snippets
"""

import json
import logging
import os
import platform
import shutil
from pathlib import Path

logger = logging.getLogger(__name__)

# Config directory relative to this file (development mode)
_CONFIG_DIR = Path(__file__).parent / "config"

# Platform-specific user config directory
def _get_user_config_dir():
    system = platform.system()
    if system == "Windows":
        base = os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")
        return Path(base) / "ac-dc"
    elif system == "Darwin":
        return Path.home() / "Library" / "Application Support" / "ac-dc"
    else:
        xdg = os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")
        return Path(xdg) / "ac-dc"


def _is_packaged():
    """Check if running from a PyInstaller bundle."""
    return getattr(os.sys, 'frozen', False)


def _get_bundled_config_dir():
    """Get config dir from PyInstaller bundle."""
    if _is_packaged():
        return Path(os.sys._MEIPASS) / "ac_dc" / "config"
    return None


class ConfigManager:
    """Manages all configuration files for the application."""

    # Whitelisted config types
    CONFIG_TYPES = {
        "litellm": {"file": "llm.json", "format": "json"},
        "app": {"file": "app.json", "format": "json"},
        "system": {"file": "system.md", "format": "markdown"},
        "system_extra": {"file": "system_extra.md", "format": "markdown"},
        "compaction": {"file": "compaction.md", "format": "markdown"},
        "snippets": {"file": "snippets.json", "format": "json"},
    }

    def __init__(self, repo_root=None):
        self._repo_root = Path(repo_root) if repo_root else None
        self._config_dir = self._resolve_config_dir()
        self._llm_config = None
        self._app_config = None

        # Ensure .ac-dc directory exists in repo
        if self._repo_root:
            self._init_ac_dc_dir()

        # Load configs
        self._llm_config = self._load_llm_config()
        self._app_config = self._load_app_config()

    def _resolve_config_dir(self):
        """Resolve config directory based on running mode."""
        if _is_packaged():
            user_dir = _get_user_config_dir()
            bundled_dir = _get_bundled_config_dir()
            if not user_dir.exists():
                user_dir.mkdir(parents=True, exist_ok=True)
                if bundled_dir and bundled_dir.exists():
                    for f in bundled_dir.iterdir():
                        dest = user_dir / f.name
                        if not dest.exists():
                            shutil.copy2(f, dest)
            else:
                # Copy only new files from updates
                if bundled_dir and bundled_dir.exists():
                    for f in bundled_dir.iterdir():
                        dest = user_dir / f.name
                        if not dest.exists():
                            shutil.copy2(f, dest)
            return user_dir
        return _CONFIG_DIR

    def _init_ac_dc_dir(self):
        """Create .ac-dc/ directory and add to .gitignore."""
        ac_dc_dir = self._repo_root / ".ac-dc"
        ac_dc_dir.mkdir(exist_ok=True)
        (ac_dc_dir / "images").mkdir(exist_ok=True)

        gitignore = self._repo_root / ".gitignore"
        entry = ".ac-dc/"
        if gitignore.exists():
            content = gitignore.read_text()
            if entry not in content.splitlines():
                with open(gitignore, "a") as f:
                    if not content.endswith("\n"):
                        f.write("\n")
                    f.write(entry + "\n")
        else:
            gitignore.write_text(entry + "\n")

    def _load_json(self, filename):
        """Load a JSON config file."""
        path = self._config_dir / filename
        if not path.exists():
            return {}
        try:
            return json.loads(path.read_text())
        except (json.JSONDecodeError, OSError) as e:
            logger.warning(f"Failed to load {filename}: {e}")
            return {}

    def _load_text(self, filename):
        """Load a text config file."""
        path = self._config_dir / filename
        if not path.exists():
            return ""
        try:
            return path.read_text()
        except OSError as e:
            logger.warning(f"Failed to load {filename}: {e}")
            return ""

    def _load_llm_config(self):
        """Load LLM configuration and apply env vars."""
        config = self._load_json("llm.json")
        # Apply environment variables
        for key, value in config.get("env", {}).items():
            if value:
                os.environ[key] = value
        return config

    def _load_app_config(self):
        """Load application configuration."""
        return self._load_json("app.json")

    @property
    def llm_config(self):
        return self._llm_config

    @property
    def app_config(self):
        return self._app_config

    @property
    def model(self):
        return self._llm_config.get("model", "anthropic/claude-sonnet-4-20250514")

    @property
    def smaller_model(self):
        return self._llm_config.get("smaller_model", "anthropic/claude-haiku-4-20250414")

    @property
    def cache_min_tokens(self):
        return self._llm_config.get("cache_min_tokens", 1024)

    @property
    def cache_buffer_multiplier(self):
        return self._llm_config.get("cache_buffer_multiplier", 1.5)

    @property
    def cache_target_tokens(self):
        return int(self.cache_min_tokens * self.cache_buffer_multiplier)

    @property
    def compaction_config(self):
        return self._app_config.get("history_compaction", {
            "enabled": True,
            "compaction_trigger_tokens": 24000,
            "verbatim_window_tokens": 4000,
            "summary_budget_tokens": 500,
            "min_verbatim_exchanges": 2,
        })

    @property
    def url_cache_config(self):
        return self._app_config.get("url_cache", {
            "path": "/tmp/ac-dc-url-cache",
            "ttl_hours": 24,
        })

    @property
    def repo_root(self):
        return self._repo_root

    @property
    def config_dir(self):
        return self._config_dir

    def get_system_prompt(self):
        """Assemble system prompt from files."""
        main = self._load_text("system.md")
        extra = self._load_text("system_extra.md")
        if extra.strip():
            return main + "\n\n" + extra
        return main

    def get_compaction_prompt(self):
        """Load compaction skill prompt."""
        return self._load_text("compaction.md")

    def get_snippets(self):
        """Load prompt snippets with two-location fallback."""
        # Try repo-local first
        if self._repo_root:
            local_path = self._repo_root / ".ac-dc" / "snippets.json"
            if local_path.exists():
                try:
                    data = json.loads(local_path.read_text())
                    return data.get("snippets", [])
                except (json.JSONDecodeError, OSError):
                    pass

        # Fall back to config directory
        data = self._load_json("snippets.json")
        return data.get("snippets", [])

    def get_config_content(self, config_type):
        """Read a config file by type."""
        if config_type not in self.CONFIG_TYPES:
            raise ValueError(f"Invalid config type: {config_type}")
        info = self.CONFIG_TYPES[config_type]
        path = self._config_dir / info["file"]
        if not path.exists():
            return ""
        return path.read_text()

    def save_config_content(self, config_type, content):
        """Write a config file by type."""
        if config_type not in self.CONFIG_TYPES:
            raise ValueError(f"Invalid config type: {config_type}")
        info = self.CONFIG_TYPES[config_type]
        path = self._config_dir / info["file"]
        path.write_text(content)

    def reload_llm_config(self):
        """Hot-reload LLM configuration."""
        self._llm_config = self._load_llm_config()
        return {"model": self.model, "smaller_model": self.smaller_model}

    def reload_app_config(self):
        """Hot-reload application configuration."""
        self._app_config = self._load_app_config()
        return self._app_config

    def get_config_info(self):
        """Return current model names and config paths."""
        return {
            "model": self.model,
            "smaller_model": self.smaller_model,
            "config_dir": str(self._config_dir),
            "repo_root": str(self._repo_root) if self._repo_root else None,
        }
