"""
History store for persisting conversation history.

Stores messages in JSONL format for easy appending and searching.
"""

import json
import os
import time
import uuid
from pathlib import Path
from typing import Optional


class HistoryStore:
    """
    Persistent storage for conversation history.
    
    Stores messages in .aicoder/history.jsonl in the repo root.
    """
    
    def __init__(self, repo_root: str):
        """
        Initialize the history store.
        
        Args:
            repo_root: Path to the repository root
        """
        self.repo_root = Path(repo_root)
        self.aicoder_dir = self.repo_root / '.aicoder'
        self.history_file = self.aicoder_dir / 'history.jsonl'
        self._current_session_id: Optional[str] = None
        
        # Ensure .aicoder directory exists
        self._ensure_directory()
    
    def _ensure_directory(self):
        """Create .aicoder directory if it doesn't exist."""
        self.aicoder_dir.mkdir(exist_ok=True)
    
    def _generate_id(self) -> str:
        """Generate a unique message ID."""
        return f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"
    
    def _generate_session_id(self) -> str:
        """Generate a new session ID."""
        return f"sess_{int(time.time() * 1000)}_{uuid.uuid4().hex[:6]}"
    
    @property
    def session_id(self) -> str:
        """Get or create the current session ID."""
        if self._current_session_id is None:
            self._current_session_id = self._generate_session_id()
        return self._current_session_id
    
    def new_session(self) -> str:
        """Start a new session and return the session ID."""
        self._current_session_id = self._generate_session_id()
        return self._current_session_id
    
    def append(
        self,
        role: str,
        content: str,
        images: Optional[list] = None,
        files: Optional[list] = None,
        files_modified: Optional[list] = None,
        edit_results: Optional[list] = None
    ) -> dict:
        """
        Append a message to the history.
        
        Args:
            role: 'user' or 'assistant'
            content: The message content
            images: Optional list of image references (not the actual data)
            files: Optional list of files in context (for user messages)
            files_modified: Optional list of files modified (for assistant messages)
            
        Returns:
            The stored message dict
        """
        from datetime import datetime, timezone
        
        message = {
            "id": self._generate_id(),
            "session_id": self.session_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "role": role,
            "content": content
        }
        
        if images:
            # Store image count/names, not actual data
            message["images"] = len(images)
        
        if files:
            message["files"] = files
        
        if files_modified:
            message["files_modified"] = files_modified
        
        if edit_results:
            message["edit_results"] = edit_results
        
        # Append to file
        self._ensure_directory()
        with open(self.history_file, 'a', encoding='utf-8') as f:
            f.write(json.dumps(message) + '\n')
        
        return message
    
    def search(
        self,
        query: str,
        role: Optional[str] = None,
        limit: int = 100
    ) -> list:
        """
        Search messages by text content.
        
        Args:
            query: Search string (case-insensitive substring match)
            role: Optional filter by role ('user' or 'assistant')
            limit: Maximum results to return
            
        Returns:
            List of matching messages with session context
        """
        if not self.history_file.exists():
            return []
        
        query_lower = query.lower()
        results = []
        
        with open(self.history_file, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    msg = json.loads(line)
                    
                    # Filter by role if specified
                    if role and msg.get('role') != role:
                        continue
                    
                    # Search in content
                    content = msg.get('content', '')
                    if query_lower in content.lower():
                        results.append(msg)
                        if len(results) >= limit:
                            break
                except json.JSONDecodeError:
                    continue
        
        return results
    
    def get_session(self, session_id: str) -> list:
        """
        Get all messages from a specific session.
        
        Args:
            session_id: The session ID to retrieve
            
        Returns:
            List of messages in chronological order
        """
        if not self.history_file.exists():
            return []
        
        messages = []
        
        with open(self.history_file, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    msg = json.loads(line)
                    if msg.get('session_id') == session_id:
                        messages.append(msg)
                except json.JSONDecodeError:
                    continue
        
        return messages
    
    def list_sessions(self, limit: int = 50) -> list:
        """
        List recent sessions with preview.
        
        Args:
            limit: Maximum number of sessions to return
            
        Returns:
            List of session summaries, most recent first
        """
        if not self.history_file.exists():
            return []
        
        # Collect sessions
        sessions = {}  # session_id -> {first_msg, last_msg, count}
        
        with open(self.history_file, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    msg = json.loads(line)
                    sid = msg.get('session_id')
                    if not sid:
                        continue
                    
                    if sid not in sessions:
                        sessions[sid] = {
                            'session_id': sid,
                            'first_message': msg,
                            'last_message': msg,
                            'message_count': 1,
                            'timestamp': msg.get('timestamp')
                        }
                    else:
                        sessions[sid]['last_message'] = msg
                        sessions[sid]['message_count'] += 1
                except json.JSONDecodeError:
                    continue
        
        # Sort by timestamp (most recent first) and limit
        session_list = sorted(
            sessions.values(),
            key=lambda s: s.get('timestamp', ''),
            reverse=True
        )[:limit]
        
        # Build preview for each session
        result = []
        for sess in session_list:
            first_msg = sess['first_message']
            preview = first_msg.get('content', '')[:100]
            if len(first_msg.get('content', '')) > 100:
                preview += '...'
            
            result.append({
                'session_id': sess['session_id'],
                'timestamp': sess['timestamp'],
                'message_count': sess['message_count'],
                'preview': preview,
                'first_role': first_msg.get('role')
            })
        
        return result
    
    def get_history_path(self) -> str:
        """Get the path to the history file."""
        return str(self.history_file)
