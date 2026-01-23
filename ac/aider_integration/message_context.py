"""
Context-aware message building mixin.

Builds messages using the context manager for repo map support.
"""

import os

from .message_utils import filter_empty_messages, build_user_content


class MessageContextMixin:
    """Mixin for building messages with context manager."""
    
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
    
    def _build_messages_with_context(self, user_request, images=None, include_examples=True):
        """Build messages using the context manager for repo map."""
        system_content = self._get_system_prompt()
        chat_files = self._get_chat_files_absolute()
        
        messages = [{"role": "system", "content": system_content}]
        
        # Add repo map if available
        repo_map = self._context_manager.get_repo_map(
            chat_files=chat_files,
            mentioned_fnames=set(),
            mentioned_idents=set()
        )
        if repo_map:
            messages.append({"role": "user", "content": f"Repository map:\n{repo_map}"})
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
