"""Settings management for config file editing and reloading."""

import os
import platform
import subprocess
from pathlib import Path
from typing import TYPE_CHECKING

from ac.config import load_app_config

if TYPE_CHECKING:
    from ac.llm import LiteLLM

# Whitelist of allowed config types -> relative paths from config dir
ALLOWED_CONFIGS = {
    'llm': 'llm.json',
    'app': 'app.json',
    'snippets': 'prompt-snippets.json',
    'system': 'prompts/system.md',
    'system_extra': 'prompts/system_extra.md',
    'compaction': 'prompts/skills/compaction.md',
}


def _get_config_dir() -> Path:
    """Get the config directory path."""
    # Config is bundled with the package
    return Path(__file__).parent.parent / 'config'


def open_in_editor(file_path: Path) -> dict:
    """Open file in OS default editor.
    
    Args:
        file_path: Path to the file to open
        
    Returns:
        dict with 'success' bool and either 'path' or 'error'
    """
    if not file_path.exists():
        return {"success": False, "error": f"File not found: {file_path}"}
    
    system = platform.system()
    try:
        if system == 'Darwin':  # macOS
            subprocess.Popen(['open', '-t', str(file_path)])  # -t forces text editor
        elif system == 'Windows':
            if hasattr(os, 'startfile'):
                os.startfile(str(file_path))
            else:
                return {"success": False, "error": "os.startfile not available"}
        else:  # Linux/Unix
            # Check VISUAL first (GUI editor), then EDITOR, then try common editors
            editor = os.environ.get('VISUAL') or os.environ.get('EDITOR')
            if editor:
                subprocess.Popen([editor, str(file_path)])
            else:
                # Try common GUI editors in order of preference
                editors = ['code', 'gedit', 'kate', 'xed', 'pluma', 'mousepad', 'leafpad', 'nano', 'vim']
                for ed in editors:
                    if subprocess.run(['which', ed], capture_output=True).returncode == 0:
                        subprocess.Popen([ed, str(file_path)])
                        break
                else:
                    # Fall back to xdg-open as last resort
                    subprocess.Popen(['xdg-open', str(file_path)])
        return {"success": True, "path": str(file_path)}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_config_paths() -> dict[str, str]:
    """Get paths to all config files.
    
    Returns:
        dict mapping config type to absolute file path
    """
    config_dir = _get_config_dir()
    return {
        config_type: str(config_dir / rel_path)
        for config_type, rel_path in ALLOWED_CONFIGS.items()
    }


class Settings:
    """Settings management for config file editing and reloading.
    
    This class is registered with JRPC to provide config management
    operations to the webapp.
    """
    
    def __init__(self, llm: 'LiteLLM'):
        """Initialize Settings with reference to LiteLLM instance.
        
        Args:
            llm: The LiteLLM instance for config reloading
        """
        self._llm = llm
    
    def open_config_file(self, config_type: str) -> dict:
        """Open a config file in OS default editor.
        
        Args:
            config_type: One of the whitelisted config types
                         (llm, app, snippets, system, system_extra, compaction)
                         
        Returns:
            dict with 'success' bool and either 'path' or 'error'
        """
        if config_type not in ALLOWED_CONFIGS:
            return {"success": False, "error": f"Unknown config type: {config_type}"}
        
        config_dir = _get_config_dir()
        file_path = config_dir / ALLOWED_CONFIGS[config_type]
        
        return open_in_editor(file_path)
    
    def reload_llm_config(self) -> dict:
        """Reload LLM configuration from llm.json.
        
        Returns:
            dict with 'success' bool and either config info or 'error'
        """
        return self._llm.reload_config()
    
    def reload_app_config(self) -> dict:
        """Reload app configuration from app.json.
        
        Returns:
            dict with 'success' bool and message
        """
        try:
            load_app_config(force_reload=True)
            return {
                "success": True,
                "message": "App config reloaded. Note: Some settings may require restart."
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def get_config_info(self) -> dict:
        """Get current configuration info for display.
        
        Returns:
            dict with current config values and file paths
        """
        config_paths = get_config_paths()
        
        return {
            "success": True,
            "model": self._llm.get_model(),
            "smaller_model": self._llm.get_smaller_model(),
            "config_paths": config_paths,
        }
