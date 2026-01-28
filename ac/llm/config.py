import json
import os


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
