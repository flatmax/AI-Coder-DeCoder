"""
History mixin for LiteLLM.

Provides persistent history storage and retrieval.
"""

from typing import Optional


class HistoryMixin:
    """Mixin for history storage operations."""
    
    def _init_history_store(self):
        """Initialize the history store if we have a repo."""
        self._history_store = None
        if self.repo:
            try:
                from ac.history import HistoryStore
                self._history_store = HistoryStore(self.repo.get_repo_root())
                print(f"📜 History store initialized: {self._history_store.history_file}")
            except Exception as e:
                print(f"Warning: Could not initialize history store: {e}")
    
    def store_user_message(
        self,
        content: str,
        images: Optional[list] = None,
        files: Optional[list] = None
    ) -> Optional[dict]:
        """
        Store a user message in history.
        
        Args:
            content: The message content
            images: Optional list of images
            files: Optional list of files in context
            
        Returns:
            The stored message dict, or None if no history store
        """
        if not self._history_store:
            return None
        
        return self._history_store.append(
            role='user',
            content=content,
            images=images,
            files=files
        )
    
    def store_assistant_message(
        self,
        content: str,
        files_modified: Optional[list] = None
    ) -> Optional[dict]:
        """
        Store an assistant message in history.
        
        Args:
            content: The message content
            files_modified: Optional list of files that were modified
            
        Returns:
            The stored message dict, or None if no history store
        """
        if not self._history_store:
            return None
        
        return self._history_store.append(
            role='assistant',
            content=content,
            files_modified=files_modified
        )
    
    def history_search(self, query: str, role: Optional[str] = None, limit: int = 100) -> list:
        """
        Search message history.
        
        Args:
            query: Search string
            role: Optional filter by role
            limit: Maximum results
            
        Returns:
            List of matching messages
        """
        if not self._history_store:
            return []
        return self._history_store.search(query, role, limit)
    
    def history_get_session(self, session_id: str) -> list:
        """
        Get all messages from a session.
        
        Args:
            session_id: The session ID
            
        Returns:
            List of messages
        """
        if not self._history_store:
            return []
        return self._history_store.get_session(session_id)
    
    def history_list_sessions(self, limit: int = 50) -> list:
        """
        List recent sessions.
        
        Args:
            limit: Maximum sessions to return
            
        Returns:
            List of session summaries
        """
        if not self._history_store:
            return []
        return self._history_store.list_sessions(limit)
    
    def history_new_session(self) -> Optional[str]:
        """
        Start a new history session.
        
        Returns:
            The new session ID, or None if no history store
        """
        if not self._history_store:
            return None
        return self._history_store.new_session()
    
    def history_get_current_session_id(self) -> Optional[str]:
        """
        Get the current session ID.
        
        Returns:
            The session ID, or None if no history store
        """
        if not self._history_store:
            return None
        return self._history_store.session_id
