"""
Code editor for prompt management and file context.

Provides prompt templates and file context management for LLM-based editing.
"""

from .prompt_mixin import PromptMixin
from .file_context_mixin import FileContextMixin


class AiderEditor(PromptMixin, FileContextMixin):
    """
    Editor for managing prompts and file context.
    
    This class provides prompt templates and file context management.
    Edit parsing and application is handled by EditParser.
    """
    
    def __init__(self, fence=None, repo=None):
        """
        Initialize the editor.
        
        Args:
            fence: Tuple of (open_fence, close_fence), defaults to ("```", "```")
            repo: Optional Repo instance for git operations
        """
        self.fence = fence or ("```", "```")
        self.repo = repo
        self._init_prompts()
        self._init_files()
