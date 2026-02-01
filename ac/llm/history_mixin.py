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
        files_modified: Optional[list] = None,
        edit_results: Optional[list] = None
    ) -> Optional[dict]:
        """
        Store an assistant message in history.
        
        Args:
            content: The message content
            files_modified: Optional list of files that were modified
            edit_results: Optional list of edit results with status info
            
        Returns:
            The stored message dict, or None if no history store
        """
        if not self._history_store:
            return None
        
        return self._history_store.append(
            role='assistant',
            content=content,
            files_modified=files_modified,
            edit_results=edit_results
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
    
    def load_session_into_context(self, session_id: str) -> list:
        """
        Load a session into the active context.
        
        This both retrieves the messages AND populates the ContextManager's
        history so token counting works correctly. Also sets the current
        session ID so new messages continue in this session.
        
        Args:
            session_id: The session ID to load
            
        Returns:
            List of messages from the session
        """
        messages = self.history_get_session(session_id)
        
        if messages and self._context_manager:
            # Clear existing history and populate with loaded messages
            self._context_manager.clear_history()
            for msg in messages:
                role = msg.get('role')
                content = msg.get('content', '')
                if role and content:
                    self._context_manager.add_message(role, content)
        
        # Set current session ID so new messages continue in this session
        if self._history_store and session_id:
            self._history_store._current_session_id = session_id
        
        return messages
