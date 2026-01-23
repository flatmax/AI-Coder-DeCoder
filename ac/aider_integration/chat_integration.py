"""
Integration of AiderEditor with LiteLLM chat.

Provides a high-level interface for requesting code changes via LLM
and applying them using aider's search/replace format.
"""

from .editor import AiderEditor
from .message_builder import MessageBuilderMixin
from .context_manager import AiderContextManager
from .file_management_mixin import FileManagementMixin
from .chat_history_mixin import ChatHistoryMixin
from .request_mixin import RequestMixin


class AiderChat(MessageBuilderMixin, FileManagementMixin, ChatHistoryMixin, RequestMixin):
    """
    High-level interface for LLM-based code editing using aider's format.
    
    Combines LiteLLM for LLM calls with AiderEditor for parsing and applying edits.
    Uses AiderContextManager for repo map and token management.
    """
    
    def __init__(self, model="gpt-4", repo=None, token_tracker=None):
        """
        Initialize the chat interface.
        
        Args:
            model: The LiteLLM model identifier
            repo: Optional Repo instance for file access
            token_tracker: Optional object with track_token_usage(completion) method
        """
        self.model = model
        self.repo = repo
        self.token_tracker = token_tracker
        self.editor = AiderEditor(repo=repo)
        self.messages = []
        
        # Initialize context manager if we have a repo
        self._context_manager = None
        if repo:
            self._init_context_manager()
    
    def _init_context_manager(self):
        """Initialize the context manager for repo map support."""
        try:
            self._context_manager = AiderContextManager(
                repo_root=self.repo.get_repo_root(),
                model_name=self.model,
                token_tracker=self.token_tracker
            )
            print(f"📊 Context manager initialized for: {self.repo.get_repo_name()}")
        except Exception as e:
            print(f"Warning: Could not initialize context manager: {e}")
    
    @property
    def context_manager(self):
        """Get the context manager, creating if needed."""
        return self._context_manager
