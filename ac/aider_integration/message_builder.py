"""
Message building utilities for AiderChat.

Handles construction of LLM messages including multimodal content.
"""


class MessageBuilderMixin:
    """Mixin for building LLM messages."""
    
    def _filter_empty_messages(self, messages):
        """
        Filter out messages with empty content that some providers reject.
        
        Args:
            messages: List of message dicts
            
        Returns:
            Filtered list with no empty content fields
        """
        filtered = []
        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, list):
                has_content = any(
                    (part.get("type") == "text" and part.get("text", "").strip()) or
                    part.get("type") == "image_url"
                    for part in content
                )
                if has_content:
                    filtered.append(msg)
            elif content and content.strip():
                filtered.append(msg)
        return filtered
    
    def _build_user_content(self, text, images=None):
        """
        Build user message content, optionally with images.
        
        Args:
            text: The text content
            images: Optional list of image dicts with 'data' and 'mime_type'
            
        Returns:
            String for text-only, or list for multimodal content
        """
        if not images:
            return text
        
        content = [{"type": "text", "text": text}]
        
        for img in images:
            if isinstance(img, dict):
                data = img.get('data', '')
                mime_type = img.get('mime_type', 'image/png')
            else:
                data = img
                mime_type = 'image/png'
            
            content.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:{mime_type};base64,{data}"
                }
            })
        
        return content
    
    def _build_messages(self, user_request, images=None, include_examples=True):
        """
        Build the complete message list for an LLM request.
        
        Args:
            user_request: The user's request text
            images: Optional list of image dicts
            include_examples: Whether to include few-shot examples
            
        Returns:
            Tuple of (messages list, user_text for history)
        """
        messages = []
        
        # System prompt
        system_content = self.editor.get_system_prompt()
        system_content += "\n\n" + self.editor.get_system_reminder()
        messages.append({"role": "system", "content": system_content})
        
        # Add conversation history
        if self.messages:
            messages.extend(self.messages)
        
        # Few-shot examples (only if no history yet)
        if include_examples and not self.messages:
            example_messages = self.editor.get_example_messages()
            example_messages = self._filter_empty_messages(example_messages)
            messages.extend(example_messages)
        
        # File context
        file_context = self.editor.format_files_for_prompt()
        
        # Build user text
        if file_context:
            user_text = f"Here are the files:\n\n{file_context}\n\n{user_request}"
        else:
            user_text = user_request
        
        # Build user content (with images if provided)
        user_content = self._build_user_content(user_text, images)
        messages.append({"role": "user", "content": user_content})
        
        # Final filter
        messages = self._filter_empty_messages(messages)
        
        return messages, user_text
