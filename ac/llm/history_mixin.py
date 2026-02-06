"""
History mixin for LiteLLM.

Provides persistent history storage and retrieval.
"""

from typing import Optional


class HistoryMixin:
    """Mixin for history storage operations.
    
    All public methods safely return None/[] when no history store is available.
    """
    
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
    
    def _with_store(self, method_name: str, *args, default=None, **kwargs):
        """Call a method on the history store, returning default if unavailable."""
        if not self._history_store:
            return default
        return getattr(self._history_store, method_name)(*args, **kwargs)
    
    def store_user_message(self, content: str, images: Optional[list] = None,
                           files: Optional[list] = None) -> Optional[dict]:
        """Store a user message in history."""
        return self._with_store('append', role='user', content=content,
                                images=images, files=files)
    
    def store_assistant_message(self, content: str, files_modified: Optional[list] = None,
                                edit_results: Optional[list] = None) -> Optional[dict]:
        """Store an assistant message in history."""
        return self._with_store('append', role='assistant', content=content,
                                files_modified=files_modified, edit_results=edit_results)
    
    def history_search(self, query: str, role: Optional[str] = None, limit: int = 100) -> list:
        """Search message history."""
        return self._with_store('search', query, role, limit, default=[])
    
    def history_get_session(self, session_id: str) -> list:
        """Get all messages from a session."""
        return self._with_store('get_session', session_id, default=[])
    
    def history_list_sessions(self, limit: int = 50) -> list:
        """List recent sessions."""
        return self._with_store('list_sessions', limit, default=[])
    
    def history_new_session(self) -> Optional[str]:
        """Start a new history session."""
        return self._with_store('new_session')
    
    def history_get_current_session_id(self) -> Optional[str]:
        """Get the current session ID."""
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
        print(f"🔍 load_session_into_context: session={session_id}, messages={len(messages) if messages else 0}")
        
        if messages and self._context_manager:
            # Clear existing history and populate with loaded messages
            self._context_manager.clear_history()
            for msg in messages:
                role = msg.get('role')
                content = msg.get('content', '')
                if role and content:
                    self._context_manager.add_message(role, content)
            print(f"🔍 load_session_into_context: loaded {len(self._context_manager.get_history())} messages into context manager")
        
        # Set current session ID so new messages continue in this session
        if self._history_store and session_id:
            self._history_store._current_session_id = session_id
        
        return messages
