"""
Prompt building utilities for AiderEditor.

Handles construction of system prompts and example messages using aider's templates.
"""

from aider.coders.editblock_prompts import EditBlockPrompts


class PromptMixin:
    """Mixin for prompt building operations."""
    
    def _init_prompts(self):
        """Initialize the prompts instance."""
        self.prompts = EditBlockPrompts()
    
    def get_system_prompt(self):
        """Build the system prompt from EditBlockPrompts."""
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
