"""
Shared application configuration loader.

Loads config/app.json and provides access to all app-level settings.
"""

import json
import os
import shutil
import sys
from pathlib import Path
from typing import Optional


# Cached config to avoid re-reading file
_cached_config: Optional[dict] = None
_config_path: Optional[str] = None


def get_user_config_dir() -> Path:
    """Get the persistent user config directory for frozen executables.
    
    Returns platform-appropriate path:
    - Linux/macOS: ~/.config/ac-dc/
    - Windows: %APPDATA%/ac-dc/
    """
    if sys.platform == 'win32':
        base = Path(os.environ.get('APPDATA', Path.home() / 'AppData' / 'Roaming'))
    else:
        base = Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config'))
    return base / 'ac-dc'


def get_bundled_config_dir() -> Path:
    """Get the bundled config directory inside PyInstaller bundle."""
    if hasattr(sys, '_MEIPASS'):
        return Path(sys._MEIPASS) / 'config'
    return Path(sys.executable).parent / 'config'


def ensure_user_config() -> None:
    """Copy bundled defaults to user config dir if not present (frozen only).
    
    This is called once at startup for frozen executables to ensure
    user has editable config files in a persistent location.
    """
    if not getattr(sys, 'frozen', False):
        return  # Dev mode - nothing to do
    
    user_dir = get_user_config_dir()
    bundled_dir = get_bundled_config_dir()
    
    if not user_dir.exists():
        # First run - copy all bundled configs
        shutil.copytree(bundled_dir, user_dir)
    else:
        # Ensure any new config files from updates are copied
        # (but don't overwrite user's existing files)
        for bundled_file in bundled_dir.rglob('*'):
            if bundled_file.is_file():
                rel_path = bundled_file.relative_to(bundled_dir)
                user_file = user_dir / rel_path
                if not user_file.exists():
                    user_file.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(bundled_file, user_file)


def get_config_dir() -> Path:
    """Get the config directory, handling both frozen and dev execution.
    
    - Frozen: Returns persistent user config dir (~/.config/ac-dc/)
    - Dev: Returns repo's config/ directory
    """
    if getattr(sys, 'frozen', False):
        return get_user_config_dir()
    else:
        return Path(os.path.dirname(__file__)).parent / 'config'


def _get_default_config_path() -> str:
    """Get default path to config/app.json."""
    return str(get_config_dir() / 'app.json')


def load_app_config(config_path: Optional[str] = None, force_reload: bool = False) -> dict:
    """
    Load application configuration from config/app.json.
    
    Args:
        config_path: Optional path to config file. If None, uses default.
        force_reload: If True, reload even if already cached.
        
    Returns:
        Dict with configuration data. Empty sections use defaults.
    """
    global _cached_config, _config_path
    
    if config_path is None:
        config_path = _get_default_config_path()
    
    # Return cached if available and same path
    if not force_reload and _cached_config is not None and _config_path == config_path:
        return _cached_config
    
    config_data = {}
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            config_data = json.load(f)
    except FileNotFoundError:
        pass  # Use defaults
    except json.JSONDecodeError as e:
        print(f"Warning: Error parsing {config_path}: {e}")
    
    # Only cache if using default path (don't cache test paths)
    if config_path == _get_default_config_path():
        _cached_config = config_data
        _config_path = config_path
    
    return config_data


def get_url_cache_config() -> dict:
    """Get URL cache configuration section."""
    config = load_app_config()
    defaults = {
        'path': '/tmp/ac_url_cache',
        'ttl_hours': 24,
    }
    defaults.update(config.get('url_cache', {}))
    return defaults


def get_history_compaction_config() -> dict:
    """Get history compaction configuration section."""
    config = load_app_config()
    defaults = {
        'enabled': True,
        'compaction_trigger_tokens': 6000,
        'verbatim_window_tokens': 3000,
        'summary_budget_tokens': 500,
        'min_verbatim_exchanges': 2,
    }
    defaults.update(config.get('history_compaction', {}))
    return defaults


def is_compaction_enabled() -> bool:
    """Check if history compaction is enabled."""
    return get_history_compaction_config().get('enabled', True)
