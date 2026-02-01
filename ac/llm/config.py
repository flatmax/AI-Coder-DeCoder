import json
import os


# Default cache configuration values
DEFAULT_CACHE_MIN_TOKENS = 1024
DEFAULT_CACHE_BUFFER_MULTIPLIER = 1.5


class ConfigMixin:
    """Mixin for configuration loading and management."""
    
    def _load_config(self, config_path=None):
        """
        Load configuration from llm.json file.
        
        Args:
            config_path: Optional path to config file
        
        Returns:
            Dict with configuration settings
        """
        if config_path is None:
            # Look for llm.json in the repo root (three levels up from llm/config.py)
            # Path: ac/llm/config.py -> ac/llm/ -> ac/ -> repo root
            config_path = os.path.join(os.path.dirname(__file__), '..', '..', 'llm.json')
        
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
