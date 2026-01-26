"""
Prompt building utilities for AiderEditor.

Handles construction of system prompts and example messages using aider's templates.
"""

from pathlib import Path

from aider.coders.editblock_prompts import EditBlockPrompts


def _load_prompt_file(filename):
    """Load a prompt file from the repo root."""
    path = Path(__file__).parent.parent.parent / filename
    if path.exists():
        print(f"Loading prompt file: {path}")
        return path.read_text().strip()
    return ""


class PromptMixin:
    """Mixin for prompt building operations."""
    
    _custom_system_prompt = None
    
    def _init_prompts(self):
        """Initialize the prompts instance."""
        self.prompts = EditBlockPrompts()
        # Load custom system prompt if available
        main_prompt = _load_prompt_file("sys_prompt.md")
        extra_prompt = _load_prompt_file("sys_prompt_extra.md")
        if main_prompt:
            self._custom_system_prompt = main_prompt
            if extra_prompt:
                self._custom_system_prompt += "\n\n" + extra_prompt
    
    def get_system_prompt(self):
        """Build the system prompt, using custom if available."""
        if self._custom_system_prompt:
            return self._custom_system_prompt
        system = self.prompts.main_system.format(
            language="the same language the user uses",
            final_reminders="",
            shell_cmd_prompt="",
        )
        return system
    
    def get_system_reminder(self):
        """Build the system reminder with rules."""
        reminder = self.prompts.system_reminder.format(
            fence=self.fence,
            quad_backtick_reminder="",
            rename_with_shell="",
            go_ahead_tip=self.prompts.go_ahead_tip,
            final_reminders="",
            shell_cmd_reminder="",
        )
        return reminder
    
    def get_example_messages(self):
        """Build the few-shot example messages."""
        examples = []
        for msg in self.prompts.example_messages:
            content = msg["content"].format(fence=self.fence)
            examples.append({
                "role": msg["role"],
                "content": content
            })
        return examples
