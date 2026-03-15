"""Settings service — RPC-exposed config read/write/reload."""

import logging
from typing import Any

from ac_dc.config_manager import CONFIG_TYPES, ConfigManager

logger = logging.getLogger(__name__)


class Settings:
    """RPC-exposed settings service.

    Provides whitelisted access to configuration files.
    All public methods are exposed via jrpc-oo as Settings.* RPC endpoints.
    """

    def __init__(self, config_manager: ConfigManager):
        self._config = config_manager

    def get_config_content(self, config_type: str) -> str | dict:
        """Read a config file by type key."""
        try:
            return self._config.get_config_content(config_type)
        except ValueError as e:
            return {"error": str(e)}

    def save_config_content(self, config_type: str, content: str) -> dict:
        """Write a config file by type key."""
        try:
            self._config.save_config_content(config_type, content)
            return {"status": "saved"}
        except ValueError as e:
            return {"error": str(e)}

    def reload_llm_config(self) -> dict:
        """Hot-reload LLM config and apply env vars."""
        self._config.reload_llm_config()
        return {"status": "reloaded", "model": self._config.model}

    def reload_app_config(self) -> dict:
        """Hot-reload app config."""
        self._config.reload_app_config()
        return {"status": "reloaded"}

    def get_config_info(self) -> dict:
        """Current model names and config paths."""
        return {
            "model": self._config.model,
            "smaller_model": self._config.smaller_model,
            "config_dir": str(self._config.config_dir),
        }

    def get_snippets(self) -> list[dict]:
        """Load prompt snippets (code mode — backwards compatible)."""
        return self._config.get_snippets("code")

    def get_review_snippets(self) -> list[dict]:
        """Load review-specific prompt snippets."""
        return self._config.get_snippets("review")