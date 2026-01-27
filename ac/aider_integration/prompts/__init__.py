"""
Prompt templates for EDIT/REPL code editing (v3 format).

Replaces aider's EditBlockPrompts with our own implementation.
"""

from pathlib import Path

from .system_reminder import SYSTEM_REMINDER
from .example_messages import EXAMPLE_MESSAGES


class EditBlockPrompts:
    """
    Drop-in replacement for aider's EditBlockPrompts.

    Provides templates for the EDIT/REPL edit format (v3).
    The main system prompt comes from sys_prompt.md (loaded by PromptMixin).
    """

    def __init__(self):
        # Not used - sys_prompt.md is loaded directly by PromptMixin
        self.main_system = ""

        # EDIT/REPL format rules with {go_ahead_tip} placeholder
        self.system_reminder = SYSTEM_REMINDER
        
        # Few-shot examples for the edit format
        self.example_messages = EXAMPLE_MESSAGES
        
        # Tip shown after examples (not needed with our prompts)
        self.go_ahead_tip = ""


# --- Moved from prompts.py to avoid module/package naming conflict ---

def _load_prompt_file(filename):
    """Load a prompt file from the repo root."""
    # __file__ is ac/aider_integration/prompts/__init__.py
    # Go up 3 levels: prompts -> aider_integration -> ac -> repo_root
    path = Path(__file__).parent.parent.parent.parent / filename
    if path.exists():
        return path.read_text().strip()
    return ""


SEARCH_REPLACE_INSTRUCTIONS = """
To make changes to files, use SEARCH/REPLACE blocks.

Every SEARCH/REPLACE block must use this exact format:

path/to/file.ext
<<<<<<< SEARCH
exact lines to find
=======
replacement lines
>>>>>>> REPLACE

Rules:
1. The SEARCH section must EXACTLY match the existing file content, including whitespace and indentation
2. Include enough context lines to uniquely identify the location
3. You can have multiple SEARCH/REPLACE blocks for the same file
4. To delete code, leave the REPLACE section empty
5. To create a new file, use an empty SEARCH section
6. Always show the complete file path

Example - Adding a docstring:

myfile.py
<<<<<<< SEARCH
def hello(name):
    print(f"Hello {name}")
=======
def hello(name):
    \"\"\"Greet someone by name.\"\"\"
    print(f"Hello {name}")
>>>>>>> REPLACE
"""


CONCISE_EDIT_PROMPT = """
Make the requested changes using SEARCH/REPLACE blocks.
Be precise - the SEARCH must exactly match existing code.
Only show the blocks needed for the changes, not the entire file.
"""


def build_edit_system_prompt(include_instructions=True):
    """Build a system prompt for edit mode."""
    # Check for v3 prompt first (EDIT/REPL format), then v2, then fall back to v1 (SEARCH/REPLACE)
    main_prompt = _load_prompt_file("sys_prompt_v3.md") or _load_prompt_file("sys_prompt_v2.md") or _load_prompt_file("sys_prompt.md")
    if main_prompt:
        prompt = main_prompt
    else:
        prompt = "You are an expert software developer. Make changes to code using SEARCH/REPLACE blocks."
        if include_instructions:
            prompt += "\n\n" + SEARCH_REPLACE_INSTRUCTIONS
    
    extra = _load_prompt_file("sys_prompt_extra.md")
    if extra:
        prompt += "\n\n" + extra
    
    return prompt


__all__ = [
    'EditBlockPrompts',
    'SYSTEM_REMINDER',
    'EXAMPLE_MESSAGES',
    'SEARCH_REPLACE_INSTRUCTIONS',
    'CONCISE_EDIT_PROMPT',
    'build_edit_system_prompt',
]
