"""
History browser mixin for LiteLLM.

Parses .aider.chat.history.md files and provides session browsing functionality.
"""

import os
import re
from datetime import datetime


class HistoryBrowserMixin:
    """Mixin for browsing chat history from .aider.chat.history.md files."""
    
    def _get_history_file_path(self):
        """Get the path to the history file."""
        if not self.repo:
            return None
        return os.path.join(self.repo.get_repo_root(), '.aider.chat.history.md')
    
    def _parse_history_file(self):
        """
        Parse the history file into sessions.
        
        Returns:
            List of session dicts with 'timestamp', 'messages', 'raw_content'
        """
        history_path = self._get_history_file_path()
        if not history_path or not os.path.exists(history_path):
            return []
        
        try:
            with open(history_path, 'r', encoding='utf-8') as f:
                content = f.read()
        except Exception as e:
            print(f"Error reading history file: {e}")
            return []
        
        # Split by session headers: # aider chat started at <timestamp>
        session_pattern = r'^# aider chat started at (.+)$'
        parts = re.split(session_pattern, content, flags=re.MULTILINE)
        
        sessions = []
        # parts[0] is content before first header (usually empty)
        # parts[1], parts[2] = timestamp1, content1
        # parts[3], parts[4] = timestamp2, content2, etc.
        
        i = 1
        while i < len(parts) - 1:
            timestamp_str = parts[i].strip()
            session_content = parts[i + 1] if i + 1 < len(parts) else ''
            
            # Parse timestamp
            try:
                timestamp = datetime.strptime(timestamp_str, '%Y-%m-%d %H:%M:%S')
            except ValueError:
                timestamp = None
            
            # Parse messages from session content
            messages = self._parse_session_messages(session_content)
            
            sessions.append({
                'timestamp': timestamp_str,
                'timestamp_dt': timestamp,
                'messages': messages,
                'raw_content': session_content.strip()
            })
            
            i += 2
        
        return sessions
    
    def _parse_session_messages(self, content):
        """
        Parse session content into user/assistant messages.
        
        User messages are prefixed with #### 
        Assistant messages have no prefix.
        
        Returns:
            List of {'role': 'user'|'assistant', 'content': str}
        """
        if not content.strip():
            return []
        
        messages = []
        lines = content.split('\n')
        
        current_role = None
        current_content = []
        
        for line in lines:
            if line.startswith('#### '):
                # Save previous message if exists
                if current_role and current_content:
                    messages.append({
                        'role': current_role,
                        'content': '\n'.join(current_content).strip()
                    })
                
                # Start new user message
                current_role = 'user'
                # Remove the #### prefix
                user_line = line[5:]  # Remove "#### "
                current_content = [user_line]
                
            elif current_role == 'user' and not line.startswith('#### '):
                # Transition from user to assistant
                if current_content:
                    messages.append({
                        'role': current_role,
                        'content': '\n'.join(current_content).strip()
                    })
                current_role = 'assistant'
                current_content = [line]
                
            elif current_role == 'assistant':
                current_content.append(line)
            
            elif current_role is None and line.strip():
                # Content before any user message - treat as assistant
                current_role = 'assistant'
                current_content = [line]
        
        # Save last message
        if current_role and current_content:
            content_str = '\n'.join(current_content).strip()
            if content_str:
                messages.append({
                    'role': current_role,
                    'content': content_str
                })
        
        return messages
    
    def get_chat_sessions(self):
        """
        Get list of chat sessions from history file.
        
        Returns:
            List of session metadata dicts:
            {
                'id': int,
                'timestamp': str,
                'preview': str (first user message),
                'message_count': int
            }
        """
        sessions = self._parse_history_file()
        
        result = []
        for idx, session in enumerate(sessions):
            # Get preview from first user message
            preview = ''
            for msg in session['messages']:
                if msg['role'] == 'user':
                    preview = msg['content'][:100]
                    if len(msg['content']) > 100:
                        preview += '...'
                    break
            
            result.append({
                'id': idx,
                'timestamp': session['timestamp'],
                'preview': preview or '(no user messages)',
                'message_count': len(session['messages'])
            })
        
        return result
    
    def get_session_messages(self, session_id):
        """
        Get all messages for a specific session.
        
        Args:
            session_id: The session index
            
        Returns:
            List of {'role': str, 'content': str} or error dict
        """
        sessions = self._parse_history_file()
        
        if session_id < 0 or session_id >= len(sessions):
            return {'error': f'Invalid session ID: {session_id}'}
        
        return sessions[session_id]['messages']
    
    def load_session(self, session_id):
        """
        Load a session into the current conversation, replacing existing history.
        
        Args:
            session_id: The session index
            
        Returns:
            Dict with status and message count
        """
        sessions = self._parse_history_file()
        
        if session_id < 0 or session_id >= len(sessions):
            return {'error': f'Invalid session ID: {session_id}'}
        
        messages = sessions[session_id]['messages']
        
        # Clear current history
        self.clear_history()
        
        # Load messages into aider chat context
        aider_chat = self.get_aider_chat()
        
        for msg in messages:
            if aider_chat._context_manager:
                aider_chat._context_manager.add_message(msg['role'], msg['content'])
            aider_chat.messages.append(msg)
        
        return {
            'status': 'loaded',
            'message_count': len(messages),
            'timestamp': sessions[session_id]['timestamp']
        }
    
    def search_history(self, query):
        """
        Search across all sessions for matching content.
        
        Args:
            query: Search string (case-insensitive)
            
        Returns:
            List of matching sessions with highlighted snippets
        """
        if not query:
            return []
        
        sessions = self._parse_history_file()
        query_lower = query.lower()
        
        results = []
        for idx, session in enumerate(sessions):
            matches = []
            
            for msg in session['messages']:
                content = msg['content']
                if query_lower in content.lower():
                    # Find the matching snippet
                    pos = content.lower().find(query_lower)
                    start = max(0, pos - 50)
                    end = min(len(content), pos + len(query) + 50)
                    
                    snippet = content[start:end]
                    if start > 0:
                        snippet = '...' + snippet
                    if end < len(content):
                        snippet = snippet + '...'
                    
                    matches.append({
                        'role': msg['role'],
                        'snippet': snippet
                    })
            
            if matches:
                # Get preview
                preview = ''
                for msg in session['messages']:
                    if msg['role'] == 'user':
                        preview = msg['content'][:100]
                        break
                
                results.append({
                    'id': idx,
                    'timestamp': session['timestamp'],
                    'preview': preview,
                    'message_count': len(session['messages']),
                    'matches': matches[:3]  # Limit matches shown
                })
        
        return results
