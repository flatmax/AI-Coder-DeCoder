"""
Context-aware message building mixin.

Builds messages using symbol index for repository context.
"""

import os

from .message_utils import filter_empty_messages, build_user_content


REPO_MAP_HEADER = """# Repository Structure

Below is a map of the repository showing classes, functions, and their relationships.
Use this to understand the codebase structure and find relevant code.

"""


class MessageContextMixin:
    """Mixin for building messages with symbol index context."""
    
    def _get_system_prompt(self):
        """Get combined system prompt from editor."""
        system_content = self.editor.get_system_prompt()
        system_content += "\n\n" + self.editor.get_system_reminder()
        return system_content
    
    def _get_chat_files_absolute(self):
        """Get chat files as absolute paths."""
        chat_files = []
        if self.repo:
            repo_root = self.repo.get_repo_root()
            for fpath in self.editor.get_file_list():
                full_path = os.path.join(repo_root, fpath)
                chat_files.append(full_path)
        return chat_files
    
    def _build_file_context_message(self):
        """Build file context as a separate message (not stored in history)."""
        file_context = self.editor.format_files_for_prompt()
        if file_context:
            return f"Here are the files:\n\n{file_context}"
        return None
    
    def _add_examples_if_needed(self, messages, include_examples):
        """Add few-shot examples if no history exists."""
        if include_examples and not self.messages:
            example_messages = self.editor.get_example_messages()
            example_messages = filter_empty_messages(example_messages)
            messages.extend(example_messages)
    
    def _get_symbol_map(self, chat_files):
        """Get symbol map using the token tracker's indexer."""
        if not self.token_tracker or not hasattr(self.token_tracker, 'get_context_map'):
            return None
        return self.token_tracker.get_context_map(
            chat_files=chat_files,
            include_references=True
        )
    
    def _build_messages_with_context(self, user_request, images=None, include_examples=True):
        """Build messages using symbol index for repository context."""
        system_content = self._get_system_prompt()
        chat_files = self._get_chat_files_absolute()
        
        messages = [{"role": "system", "content": system_content}]
        
        # Add symbol map if available
        symbol_map = self._get_symbol_map(chat_files)
        if symbol_map:
            messages.append({"role": "user", "content": REPO_MAP_HEADER + symbol_map})
            messages.append({"role": "assistant", "content": "Ok."})
        
        self._add_examples_if_needed(messages, include_examples)
        
        # Add conversation history (does NOT include file contents)
        messages.extend(self._context_manager.get_history())
        
        # Add file context as a separate message (not stored in history)
        file_context_msg = self._build_file_context_message()
        if file_context_msg:
            messages.append({"role": "user", "content": file_context_msg})
            messages.append({"role": "assistant", "content": "Ok, I see the files."})
        
        # Build user content (with images if provided)
        user_content = build_user_content(user_request, images)
        messages.append({"role": "user", "content": user_content})
        
        messages = filter_empty_messages(messages)
        
        return messages, user_request
