import json
import os
import sys
from pathlib import Path

from ..config import get_config_dir


# Default cache configuration values
DEFAULT_CACHE_MIN_TOKENS = 1024
DEFAULT_CACHE_BUFFER_MULTIPLIER = 1.5


def _get_config_dir() -> Path:
    """Get the config directory, handling both normal and frozen (PyInstaller) execution.
    
    This is a wrapper around the shared get_config_dir() for backwards compatibility.
    """
    return get_config_dir()


class ConfigMixin:
    """Mixin for configuration loading and management."""
    
    def _load_config(self, config_path=None):
        """
        Load configuration from config/litellm.json file.
        
        Args:
            config_path: Optional path to config file
        
        Returns:
            Dict with configuration settings
        """
        if config_path is None:
            config_path = _get_config_dir() / 'litellm.json'
        
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except FileNotFoundError:
            print(f"Config file not found: {config_path}, using defaults")
            return {}
        except json.JSONDecodeError as e:
            print(f"Error parsing config file: {e}, using defaults")
            return {}
    
    def _apply_env_vars(self):
        """Apply environment variables from config."""
        env_vars = self.config.get('env', {})
        for key, value in env_vars.items():
            os.environ[key] = value
            print(f"Set environment variable: {key}={value}")
    
    def get_cache_min_tokens(self) -> int:
        """Get minimum tokens required for a cache block."""
        return self.config.get('cacheMinTokens', DEFAULT_CACHE_MIN_TOKENS)
    
    def get_cache_buffer_multiplier(self) -> float:
        """Get buffer multiplier for cache threshold (safety margin)."""
        return self.config.get('cacheBufferMultiplier', DEFAULT_CACHE_BUFFER_MULTIPLIER)
    
    def get_cache_target_tokens(self) -> int:
        """Get target tokens per cache block (min * multiplier)."""
        return int(self.get_cache_min_tokens() * self.get_cache_buffer_multiplier())
    
    def get_compaction_config(self) -> dict:
        """Get history compaction configuration from app.json."""
        from ..config import get_history_compaction_config
        return get_history_compaction_config()
    
    def is_compaction_enabled(self) -> bool:
        """Check if history compaction is enabled."""
        from ..config import is_compaction_enabled
        return is_compaction_enabled()
