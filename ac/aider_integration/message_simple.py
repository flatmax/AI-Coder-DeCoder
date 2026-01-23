"""
Simple message building mixin.

Builds messages without context manager (fallback behavior).
"""

from .message_utils import filter_empty_messages, build_user_content


class MessageSimpleMixin:
    """Mixin for building messages without context manager."""
    
    def _build_messages_simple(self, user_request, images=None, include_examples=True):
        """Build messages without context manager (original behavior)."""
        system_content = self._get_system_prompt()
        
        messages = [{"role": "system", "content": system_content}]
        
        # Add conversation history
        if self.messages:
            messages.extend(self.messages)
        
        # Few-shot examples (only if no history yet)
        self._add_examples_if_needed(messages, include_examples)
        
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
