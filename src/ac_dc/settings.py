"""Settings RPC service — thin wrapper around ConfigManager."""

import logging
from typing import Any

from .config import ConfigManager

log = logging.getLogger(__name__)


class Settings:
    """Settings service exposed via RPC.

    All public methods become remotely callable as Settings.<method_name>.
    """

    def __init__(self, config: ConfigManager):
        self._config = config

    def get_config_content(self, type_key: str) -> dict:
        return self._config.get_config_content(type_key)

    def save_config_content(self, type_key: str, content: str) -> dict:
        return self._config.save_config_content(type_key, content)

    def reload_llm_config(self) -> dict:
        return self._config.reload_llm_config()

    def reload_app_config(self) -> dict:
        return self._config.reload_app_config()

    def get_config_info(self) -> dict:
        return self._config.get_config_info()

    def get_snippets(self) -> dict:
        return self._config.get_snippets()
