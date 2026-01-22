"""
Aider-based code editor using search/replace blocks.

Uses aider's battle-tested search/replace implementation for reliable code edits.
"""

from .prompt_mixin import PromptMixin
from .file_context_mixin import FileContextMixin
from .edit_applier_mixin import EditApplierMixin


class AiderEditor(PromptMixin, FileContextMixin, EditApplierMixin):
    """
    Code editor using aider's search/replace block format.
    
    This class provides methods to parse LLM responses containing search/replace
    blocks and apply them to files.
    """
    
    def __init__(self, fence=None):
        """
        Initialize the editor.
        
        Args:
            fence: Tuple of (open_fence, close_fence), defaults to ("```", "```")
        """
        self.fence = fence or ("```", "```")
        self._init_prompts()
        self._init_files()
