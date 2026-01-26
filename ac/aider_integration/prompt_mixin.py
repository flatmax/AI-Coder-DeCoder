"""
Prompt building utilities for AiderEditor.

Handles construction of system prompts and example messages.
"""

from pathlib import Path

from .prompts import EditBlockPrompts


def _get_repo_root():
    """Get the repository root directory."""
    return Path(__file__).parent.parent.parent


def _load_prompt_file(filename, required=False):
    """
    Load a prompt file from the repo root.
    
    Args:
        filename: Name of the file to load
        required: If True, raise FileNotFoundError if missing
        
    Returns:
        File contents as string, or empty string if not found and not required
        
    Raises:
        FileNotFoundError: If required=True and file doesn't exist
    """
    path = _get_repo_root() / filename
    if path.exists():
        print(f"Loading prompt file: {path}")
        return path.read_text().strip()
    if required:
        raise FileNotFoundError(
            f"Required prompt file not found: {path}\n"
            f"Please create {filename} in the repository root."
        )
    return ""


class PromptMixin:
    """Mixin for prompt building operations."""
    
    _system_prompt = None
    
    def _init_prompts(self):
        """
        Initialize the prompts.
        
        Raises:
            FileNotFoundError: If sys_prompt.md is missing
        """
        self.prompts = EditBlockPrompts()
        
        # Load required system prompt
        main_prompt = _load_prompt_file("sys_prompt.md", required=True)
        self._system_prompt = main_prompt
        
        # Append optional extra prompt
        extra_prompt = _load_prompt_file("sys_prompt_extra.md", required=False)
        if extra_prompt:
            self._system_prompt += "\n\n" + extra_prompt
    
    def get_system_prompt(self):
        """Get the system prompt loaded from sys_prompt.md."""
        return self._system_prompt
    
    def get_system_reminder(self):
        """Build the system reminder with SEARCH/REPLACE rules."""
        fence = self.fence[0] if isinstance(self.fence, tuple) else self.fence
        reminder = self.prompts.system_reminder.format(
            fence=fence,
            go_ahead_tip=self.prompts.go_ahead_tip,
        )
        return reminder
    
    def get_example_messages(self):
        """Build the few-shot example messages."""
        fence = self.fence[0] if isinstance(self.fence, tuple) else self.fence
        examples = []
        for msg in self.prompts.example_messages:
            content = msg["content"].format(fence=fence)
            examples.append({
                "role": msg["role"],
                "content": content
            })
        return examples
