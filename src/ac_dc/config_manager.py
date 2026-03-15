"""Configuration manager — loading, caching, and directory resolution."""

import json
import logging
import os
import platform
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Files overwritten on upgrade; old version backed up
MANAGED_FILES = [
    "system.md",
    "system_doc.md",
    "compaction.md",
    "commit.md",
    "system_reminder.md",
    "review.md",
    "app.json",
    "snippets.json",
]

# Never overwritten; only created if missing
USER_FILES = [
    "llm.json",
    "system_extra.md",
]

# Whitelist for Settings RPC — only these types can be read/written
CONFIG_TYPES = {
    "litellm": "llm.json",
    "app": "app.json",
    "snippets": "snippets.json",
    "system": "system.md",
    "system_extra": "system_extra.md",
    "compaction": "compaction.md",
    "review": "review.md",
    "system_doc": "system_doc.md",
}

# Anthropic per-model minimum cacheable tokens
_MODEL_MIN_CACHEABLE = {
    "opus": 4096,
    "haiku": 4096,
}
_DEFAULT_MIN_CACHEABLE = 1024


def _get_min_cacheable_tokens(model_name: str) -> int:
    """Get minimum cacheable tokens for a model (Anthropic-specific)."""
    if not model_name:
        return _DEFAULT_MIN_CACHEABLE
    lower = model_name.lower()
    for key, tokens in _MODEL_MIN_CACHEABLE.items():
        if key in lower:
            return tokens
    return _DEFAULT_MIN_CACHEABLE


class ConfigManager:
    """Manages configuration files for AC⚡DC.

    Handles:
    - Config directory resolution (dev vs packaged)
    - File loading and caching
    - LLM config with env var application
    - App config with defaults
    - System prompt assembly
    - Snippet loading (nested, two-location fallback, per-mode)
    - Cache target tokens computation (model-aware)
    - Version-aware upgrade for packaged builds
    - .ac-dc/ directory creation and .gitignore management
    """

    def __init__(self, repo_root: str | Path):
        self._repo_root = Path(repo_root).resolve()
        self._bundled_config_dir = self._find_bundled_config_dir()
        self._config_dir = self._resolve_config_dir()
        self._llm_config: Optional[dict] = None
        self._app_config: Optional[dict] = None

        # Ensure .ac-dc/ exists and is gitignored
        self._ensure_ac_dc_dir()

        # For packaged builds, handle version-aware config copy
        if self._is_packaged():
            self._handle_packaged_config()

        # Load configs eagerly
        self._llm_config = self._load_llm_config()
        self._app_config = self._load_app_config()

    # ── Directory Resolution ──────────────────────────────────────

    def _find_bundled_config_dir(self) -> Path:
        """Find the bundled config directory (shipped with the app)."""
        # PyInstaller bundle
        if hasattr(sys, "_MEIPASS"):
            p = Path(sys._MEIPASS) / "ac_dc" / "config"
            if p.is_dir():
                return p

        # Source tree — relative to this file
        p = Path(__file__).parent / "config"
        if p.is_dir():
            return p

        raise FileNotFoundError("Cannot find bundled config directory")

    def _resolve_config_dir(self) -> Path:
        """Resolve the active config directory.

        - Packaged builds: user config directory (platform-specific)
        - Development: bundled config directory (source tree)
        """
        if self._is_packaged():
            return self._get_user_config_dir()
        return self._bundled_config_dir

    def _is_packaged(self) -> bool:
        """Check if running from a PyInstaller bundle."""
        return hasattr(sys, "_MEIPASS")

    def _get_user_config_dir(self) -> Path:
        """Get platform-specific user config directory."""
        system = platform.system()
        if system == "Windows":
            base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
        elif system == "Darwin":
            base = Path.home() / "Library" / "Application Support"
        else:
            base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
        return base / "ac-dc"

    # ── .ac-dc/ Directory ─────────────────────────────────────────

    @property
    def ac_dc_dir(self) -> Path:
        """Per-repository working directory."""
        return self._repo_root / ".ac-dc"

    def _ensure_ac_dc_dir(self):
        """Create .ac-dc/ and add to .gitignore if needed."""
        self.ac_dc_dir.mkdir(exist_ok=True)

        gitignore = self._repo_root / ".gitignore"
        entry = ".ac-dc/"

        if gitignore.exists():
            content = gitignore.read_text(encoding="utf-8")
            # Check for exact line match (not just substring)
            lines = content.splitlines()
            if entry not in lines and ".ac-dc" not in lines:
                # Append with newline safety
                if content and not content.endswith("\n"):
                    content += "\n"
                content += entry + "\n"
                gitignore.write_text(content, encoding="utf-8")
        else:
            gitignore.write_text(entry + "\n", encoding="utf-8")

    # ── Packaged Build Config Management ──────────────────────────

    def _handle_packaged_config(self):
        """Handle config copying and upgrades for packaged builds."""
        user_dir = self._config_dir
        user_dir.mkdir(parents=True, exist_ok=True)

        bundled_version = self._get_bundled_version()
        installed_version = self._get_installed_version()

        if bundled_version and bundled_version == installed_version:
            # Same version — no changes needed
            return

        # First install or upgrade
        for filename in MANAGED_FILES:
            src = self._bundled_config_dir / filename
            dst = user_dir / filename
            if not src.exists():
                continue
            if dst.exists():
                # Backup before overwriting
                backup_name = self._make_backup_name(filename, installed_version)
                backup_path = user_dir / backup_name
                shutil.copy2(dst, backup_path)
                logger.info(f"Backed up {filename} → {backup_name}")
            shutil.copy2(src, dst)

        for filename in USER_FILES:
            src = self._bundled_config_dir / filename
            dst = user_dir / filename
            if not dst.exists() and src.exists():
                shutil.copy2(src, dst)

        # Write version marker
        if bundled_version:
            (user_dir / ".bundled_version").write_text(
                bundled_version, encoding="utf-8"
            )

    def _get_bundled_version(self) -> Optional[str]:
        """Read VERSION from the bundle."""
        for candidate in [
            Path(getattr(sys, "_MEIPASS", "")) / "ac_dc" / "VERSION",
            Path(__file__).parent / "VERSION",
        ]:
            if candidate.exists():
                return candidate.read_text(encoding="utf-8").strip()
        return None

    def _get_installed_version(self) -> Optional[str]:
        """Read version marker from user config directory."""
        marker = self._config_dir / ".bundled_version"
        if marker.exists():
            return marker.read_text(encoding="utf-8").strip()
        return None

    def _make_backup_name(self, filename: str, version: Optional[str]) -> str:
        """Generate backup filename for a managed config file."""
        ts = datetime.now(timezone.utc).strftime("%Y.%m.%d-%H.%M")
        if version:
            return f"{filename}.{version}"
        return f"{filename}.{ts}"

    # ── Config Loading ────────────────────────────────────────────

    def _read_config_file(self, filename: str) -> str:
        """Read a config file from the active config directory."""
        path = self._config_dir / filename
        if path.exists():
            return path.read_text(encoding="utf-8")
        # Fall back to bundled
        bundled = self._bundled_config_dir / filename
        if bundled.exists():
            return bundled.read_text(encoding="utf-8")
        return ""

    def _write_config_file(self, filename: str, content: str):
        """Write a config file to the active config directory."""
        path = self._config_dir / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def _load_llm_config(self) -> dict:
        """Load LLM config and apply env vars."""
        text = self._read_config_file("llm.json")
        if not text:
            return self._default_llm_config()
        try:
            config = json.loads(text)
        except json.JSONDecodeError:
            logger.warning("Invalid llm.json, using defaults")
            return self._default_llm_config()

        # Apply env vars
        env_vars = config.get("env", {})
        for key, value in env_vars.items():
            if value:
                os.environ[key] = str(value)

        # Normalize smaller_model / smallerModel
        if "smallerModel" in config and "smaller_model" not in config:
            config["smaller_model"] = config.pop("smallerModel")

        return config

    def _load_app_config(self) -> dict:
        """Load app config with defaults.

        Deep-merges loaded config over defaults so missing keys
        get default values rather than being silently absent.
        """
        text = self._read_config_file("app.json")
        if not text:
            return self._default_app_config()
        try:
            config = json.loads(text)
        except json.JSONDecodeError:
            logger.warning("Invalid app.json, using defaults")
            return self._default_app_config()
        return self._deep_merge(self._default_app_config(), config)

    @staticmethod
    def _deep_merge(defaults: dict, overrides: dict) -> dict:
        """Recursively merge overrides into defaults."""
        result = dict(defaults)
        for key, value in overrides.items():
            if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                result[key] = ConfigManager._deep_merge(result[key], value)
            else:
                result[key] = value
        return result

    def _default_llm_config(self) -> dict:
        return {
            "env": {},
            "model": "anthropic/claude-sonnet-4-20250514",
            "smaller_model": "anthropic/claude-sonnet-4-20250514",
            "cache_min_tokens": 1024,
            "cache_buffer_multiplier": 1.1,
        }

    def _default_app_config(self) -> dict:
        return {
            "url_cache": {"path": "", "ttl_hours": 24},
            "history_compaction": {
                "enabled": True,
                "compaction_trigger_tokens": 24000,
                "verbatim_window_tokens": 4000,
                "summary_budget_tokens": 500,
                "min_verbatim_exchanges": 2,
            },
            "doc_convert": {
                "enabled": True,
                "extensions": [
                    ".docx", ".pdf", ".pptx", ".xlsx",
                    ".csv", ".rtf", ".odt", ".odp",
                ],
                "max_source_size_mb": 50,
            },
            "doc_index": {
                "keyword_model": "BAAI/bge-small-en-v1.5",
                "keywords_enabled": True,
                "keywords_top_n": 3,
                "keywords_ngram_range": [1, 2],
                "keywords_min_section_chars": 50,
                "keywords_min_score": 0.3,
                "keywords_diversity": 0.5,
                "keywords_tfidf_fallback_chars": 150,
                "keywords_max_doc_freq": 0.6,
            },
        }

    # ── Public Properties ─────────────────────────────────────────

    @property
    def repo_root(self) -> Path:
        return self._repo_root

    @property
    def config_dir(self) -> Path:
        return self._config_dir

    @property
    def model(self) -> str:
        return self._llm_config.get("model", "anthropic/claude-sonnet-4-20250514")

    @property
    def smaller_model(self) -> str:
        return self._llm_config.get(
            "smaller_model",
            self._llm_config.get("model", "anthropic/claude-sonnet-4-20250514"),
        )

    @property
    def llm_config(self) -> dict:
        return self._llm_config

    @property
    def app_config(self) -> dict:
        return self._app_config

    @property
    def history_compaction_config(self) -> dict:
        return self._app_config.get("history_compaction", {})

    @property
    def doc_index_config(self) -> dict:
        return self._app_config.get("doc_index", {})

    @property
    def doc_convert_config(self) -> dict:
        return self._app_config.get("doc_convert", {})

    # ── Cache Target Tokens ───────────────────────────────────────

    @property
    def cache_target_tokens(self) -> int:
        """Compute cache_target_tokens without model reference.

        cache_min_tokens × cache_buffer_multiplier
        """
        min_tokens = self._llm_config.get("cache_min_tokens", 1024)
        multiplier = self._llm_config.get("cache_buffer_multiplier", 1.1)
        return int(min_tokens * multiplier)

    def get_cache_target_tokens(self, model_name: Optional[str] = None) -> int:
        """Compute model-aware cache_target_tokens.

        max(cache_min_tokens, min_cacheable_tokens) × cache_buffer_multiplier
        """
        min_tokens = self._llm_config.get("cache_min_tokens", 1024)
        multiplier = self._llm_config.get("cache_buffer_multiplier", 1.1)
        if model_name:
            min_cacheable = _get_min_cacheable_tokens(model_name)
            effective_min = max(min_tokens, min_cacheable)
        else:
            effective_min = min_tokens
        return int(effective_min * multiplier)

    # ── System Prompts ────────────────────────────────────────────

    def get_system_prompt(self) -> str:
        """Assemble system prompt: system.md + system_extra.md."""
        main = self._read_config_file("system.md")
        extra = self._read_config_file("system_extra.md")
        if extra and extra.strip():
            return main + "\n\n" + extra
        return main

    def get_doc_system_prompt(self) -> str:
        """Assemble document mode system prompt: system_doc.md + system_extra.md."""
        main = self._read_config_file("system_doc.md")
        extra = self._read_config_file("system_extra.md")
        if extra and extra.strip():
            return main + "\n\n" + extra
        return main

    def get_commit_prompt(self) -> str:
        """Load commit message generation prompt."""
        return self._read_config_file("commit.md")

    def get_system_reminder(self) -> str:
        """Load system reminder (appended to each user prompt)."""
        content = self._read_config_file("system_reminder.md")
        if content and content.strip():
            return "\n\n" + content
        return ""

    def get_compaction_prompt(self) -> str:
        """Load compaction skill prompt."""
        return self._read_config_file("compaction.md")

    def get_review_prompt(self) -> str:
        """Load review system prompt: review.md + system_extra.md."""
        main = self._read_config_file("review.md")
        extra = self._read_config_file("system_extra.md")
        if extra and extra.strip():
            return main + "\n\n" + extra
        return main

    # ── Snippets ──────────────────────────────────────────────────

    def get_snippets(self, mode: str = "code") -> list[dict]:
        """Load snippets for the given mode.

        Two-location fallback:
        1. {repo_root}/.ac-dc/snippets.json
        2. Config directory snippets.json

        Supports nested format: {"code": [...], "review": [...], "doc": [...]}
        and legacy flat format: {"snippets": [{mode: "code", ...}, ...]}
        """
        # Try repo-local first
        repo_snippets = self._repo_root / ".ac-dc" / "snippets.json"
        text = None
        if repo_snippets.exists():
            try:
                text = repo_snippets.read_text(encoding="utf-8")
            except OSError:
                pass

        if not text:
            text = self._read_config_file("snippets.json")

        if not text:
            return []

        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            logger.warning("Invalid snippets.json")
            return []

        return self._extract_snippets(data, mode)

    def _extract_snippets(self, data: dict, mode: str) -> list[dict]:
        """Extract snippets for a mode from either nested or flat format."""
        # Nested format: {"code": [...], "review": [...], "doc": [...]}
        if mode in data and isinstance(data[mode], list):
            return data[mode]

        # Legacy flat format: {"snippets": [{mode: "code", ...}, ...]}
        if "snippets" in data and isinstance(data["snippets"], list):
            return [
                s for s in data["snippets"]
                if s.get("mode", "code") == mode
            ]

        # If data is a dict with list values, try as nested
        for key in ("code", "review", "doc"):
            if key in data and isinstance(data[key], list):
                if key == mode:
                    return data[key]

        return []

    # ── Config Read/Write for Settings RPC ────────────────────────

    def get_config_content(self, config_type: str) -> str:
        """Read a config file by type key. Raises ValueError for invalid types."""
        filename = CONFIG_TYPES.get(config_type)
        if not filename:
            raise ValueError(f"Invalid config type: {config_type}")
        return self._read_config_file(filename)

    def save_config_content(self, config_type: str, content: str):
        """Write a config file by type key. Raises ValueError for invalid types."""
        filename = CONFIG_TYPES.get(config_type)
        if not filename:
            raise ValueError(f"Invalid config type: {config_type}")
        self._write_config_file(filename, content)

    # ── Hot Reload ────────────────────────────────────────────────

    def reload_llm_config(self):
        """Hot-reload LLM config from disk."""
        self._llm_config = self._load_llm_config()

    def reload_app_config(self):
        """Hot-reload app config from disk."""
        self._app_config = self._load_app_config()