"""
Chat history mixin for AiderChat.

Handles conversation history, token budgets, and summarization.
"""

import os


class ChatHistoryMixin:
    """Mixin for chat history and token operations."""
    
    def clear_history(self):
        """Clear conversation history."""
        self.messages = []
        if self._context_manager:
            self._context_manager.clear_history()
    
    def get_token_budget(self, messages=None):
        """Get token budget information."""
        if self._context_manager:
            return self._context_manager.get_budget(messages)
        return {"used": 0, "max_input": 128000, "remaining": 128000}
    
    def get_token_report(self, read_only_files=None):
        """
        Get detailed token usage report (like aider's /tokens command).
        
        Args:
            read_only_files: Optional list of read-only file paths
            
        Returns:
            Formatted string with token breakdown, or error message if no context manager
        """
        if not self._context_manager:
            return "Token report unavailable: no repository configured"
        
        # Build system prompt
        system_prompt = self.editor.get_system_prompt()
        system_prompt += "\n\n" + self.editor.get_system_reminder()
        
        # Get chat files as absolute paths
        chat_files = []
        if self.repo:
            repo_root = self.repo.get_repo_root()
            for fpath in self.editor.get_file_list():
                chat_files.append(os.path.join(repo_root, fpath))
        
        # Convert read_only_files to absolute paths if provided
        abs_read_only = []
        if read_only_files and self.repo:
            repo_root = self.repo.get_repo_root()
            for fpath in read_only_files:
                if os.path.isabs(fpath):
                    abs_read_only.append(fpath)
                else:
                    abs_read_only.append(os.path.join(repo_root, fpath))
        
        return self._context_manager.print_tokens(
            system_prompt=system_prompt,
            chat_files=chat_files,
            read_only_files=abs_read_only,
        )
    
    def check_history_size(self):
        """Check if history needs summarization."""
        if self._context_manager:
            return self._context_manager.history_too_big()
        return False
    
    def get_summarization_split(self):
        """Get messages split for summarization."""
        if self._context_manager:
            return self._context_manager.get_summarization_split()
        return [], self.messages.copy()
    
    def set_summarized_history(self, summary, tail):
        """Set history after summarization."""
        new_history = [
            {"role": "user", "content": f"Summary of previous conversation:\n{summary}"},
            {"role": "assistant", "content": "Ok, I understand the context."}
        ] + tail
        
        self.messages = new_history
        if self._context_manager:
            self._context_manager.set_history(new_history)
