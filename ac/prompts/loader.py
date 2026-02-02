"""
Prompt file loading utilities.

Loads system prompts from markdown files in the repository root.
"""

from pathlib import Path
from typing import Optional


def _get_repo_root() -> Path:
    """Get the repository root directory."""
    import sys
    
    if getattr(sys, 'frozen', False):
        # Running as PyInstaller bundle
        if hasattr(sys, '_MEIPASS'):
            return Path(sys._MEIPASS)
        return Path(sys.executable).parent
    
    # Go up from ac/prompts/ to repo root
    return Path(__file__).parent.parent.parent


def _load_prompt_file(filename: str) -> str:
    """Load a prompt file, returning empty string if not found."""
    path = _get_repo_root() / filename
    if path.exists():
        return path.read_text(encoding='utf-8').strip()
    return ""


def load_system_prompt() -> str:
    """
    Load the main system prompt.
    
    Looks for config/prompts/system.md
    
    Returns:
        System prompt content
        
    Raises:
        FileNotFoundError: If no prompt file exists
    """
    content = _load_prompt_file("config/prompts/system.md")
    if content:
        return content
    
    repo_root = _get_repo_root()
    raise FileNotFoundError(
        f"No system prompt found. Create config/prompts/system.md in {repo_root}"
    )


def load_extra_prompt() -> Optional[str]:
    """
    Load optional extra prompt content.
    
    Returns:
        Extra prompt content, or None if file doesn't exist
    """
    content = _load_prompt_file("config/prompts/system_extra.md")
    return content if content else None


def build_system_prompt() -> str:
    """
    Build complete system prompt for LLM calls.
    
    Loads main prompt and appends extra prompt if present.
    
    Returns:
        Complete system prompt string
    """
    prompt = load_system_prompt()
    
    extra = load_extra_prompt()
    if extra:
        prompt += "\n\n" + extra
    
    return prompt
