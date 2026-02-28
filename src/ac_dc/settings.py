"""Settings RPC service for webapp config access."""

import logging

logger = logging.getLogger(__name__)


class Settings:
    """RPC service for configuration read/write/reload.

    Public methods are exposed as Settings.method_name RPC endpoints.
    """

    def __init__(self, config_manager):
        self._config = config_manager
        self._collab = None  # Set by main.py when --collab is passed

    def _check_localhost_only(self):
        """Return error dict if caller is a non-localhost remote, else None."""
        if self._collab and not self._collab._is_caller_localhost():
            return {"error": "restricted", "reason": "Participants cannot perform this action"}
        return None

    def get_config_content(self, config_type):
        """Read a config file by type."""
        try:
            return {"content": self._config.get_config_content(config_type)}
        except ValueError as e:
            return {"error": str(e)}

    def save_config_content(self, config_type, content):
        """Write a config file by type."""
        restricted = self._check_localhost_only()
        if restricted:
            return restricted
        try:
            self._config.save_config_content(config_type, content)
            return {"success": True}
        except ValueError as e:
            return {"error": str(e)}

    def reload_llm_config(self):
        """Hot-reload LLM config and apply."""
        restricted = self._check_localhost_only()
        if restricted:
            return restricted
        result = self._config.reload_llm_config()
        logger.info(f"LLM config reloaded: {result}")
        return result

    def reload_app_config(self):
        """Hot-reload app config."""
        restricted = self._check_localhost_only()
        if restricted:
            return restricted
        result = self._config.reload_app_config()
        logger.info("App config reloaded")
        return result

    def get_config_info(self):
        """Current model names and config paths."""
        return self._config.get_config_info()

    def get_snippets(self):
        """Load prompt snippets (all modes — unified file)."""
        return self._config.get_snippets()

    def get_review_snippets(self):
        """Load review-specific prompt snippets."""
        return self._config.get_review_snippets()
