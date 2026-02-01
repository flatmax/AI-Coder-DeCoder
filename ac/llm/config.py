import json
import os


# Default cache configuration values
DEFAULT_CACHE_MIN_TOKENS = 1024
DEFAULT_CACHE_BUFFER_MULTIPLIER = 1.5

# Default history compaction configuration
DEFAULT_COMPACTION_CONFIG = {
    "enabled": True,
    "compaction_trigger_tokens": 6000,
    "verbatim_window_tokens": 3000,
    "summary_budget_tokens": 500,
    "min_verbatim_exchanges": 2,
}


class ConfigMixin:
    """Mixin for configuration loading and management."""
    
    def _load_config(self, config_path=None):
        """
        Load configuration from config/llm.json file.
        
        Args:
            config_path: Optional path to config file
        
        Returns:
            Dict with configuration settings
        """
        if config_path is None:
            # Look for config/llm.json in the repo root (three levels up from llm/config.py)
            # Path: ac/llm/config.py -> ac/llm/ -> ac/ -> repo root
            config_path = os.path.join(os.path.dirname(__file__), '..', '..', 'config', 'llm.json')
        
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
        """Get history compaction configuration."""
        defaults = DEFAULT_COMPACTION_CONFIG.copy()
        
        # First check for nested 'history_compaction' section
        config_section = self.config.get('history_compaction', {})
        defaults.update(config_section)
        
        # Also check root level for backward compatibility
        # (allows putting compaction_trigger_tokens directly in llm.json)
        for key in DEFAULT_COMPACTION_CONFIG.keys():
            if key in self.config:
                defaults[key] = self.config[key]
        
        return defaults
    
    def is_compaction_enabled(self) -> bool:
        """Check if history compaction is enabled."""
        return self.get_compaction_config().get('enabled', True)
