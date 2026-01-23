"""
Message building utilities for AiderChat.

Handles construction of LLM messages including multimodal content.

Expected attributes on the host class:
- editor: AiderEditor instance
- repo: Optional Repo instance
- messages: List of conversation history messages
- _context_manager: Optional AiderContextManager instance
"""

from .message_utils import filter_empty_messages, build_user_content
from .message_context import MessageContextMixin
from .message_simple import MessageSimpleMixin


class MessageBuilderMixin(MessageContextMixin, MessageSimpleMixin):
    """Mixin for building LLM messages."""
    
    @staticmethod
    def _filter_empty_messages(messages):
        return filter_empty_messages(messages)
    
    def _build_user_content(self, text, images=None):
        return build_user_content(text, images)
    
    def _build_messages(self, user_request, images=None, include_examples=True, use_repo_map=True):
        """
        Build the complete message list for an LLM request.
        
        Args:
            user_request: The user's request text
            images: Optional list of image dicts
            include_examples: Whether to include few-shot examples
            use_repo_map: Whether to include repo map
            
        Returns:
            Tuple of (messages list, user_text for history)
        """
        if self._context_manager and use_repo_map:
            return self._build_messages_with_context(user_request, images, include_examples)
        return self._build_messages_simple(user_request, images, include_examples)
