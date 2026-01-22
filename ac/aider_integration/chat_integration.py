"""
Integration of AiderEditor with LiteLLM chat.

Provides a high-level interface for requesting code changes via LLM
and applying them using aider's search/replace format.
"""

import litellm as _litellm

from .editor import AiderEditor


class AiderChat:
    """
    High-level interface for LLM-based code editing using aider's format.
    
    Combines LiteLLM for LLM calls with AiderEditor for parsing and applying edits.
    """
    
    def __init__(self, model="gpt-4", repo=None):
        """
        Initialize the chat interface.
        
        Args:
            model: The LiteLLM model identifier
            repo: Optional Repo instance for file access
        """
        self.model = model
        self.repo = repo
        self.editor = AiderEditor()
        self.messages = []  # conversation history
    
    def add_file(self, filepath):
        """Add a file to the editing context."""
        if self.repo:
            content = self.repo.get_file_content(filepath)
            if isinstance(content, dict) and 'error' in content:
                raise FileNotFoundError(content['error'])
            self.editor.add_file_content(filepath, content)
        else:
            self.editor.add_file(filepath)
    
    def add_file_content(self, filepath, content):
        """Add a file with provided content."""
        self.editor.add_file_content(filepath, content)
    
    def get_files(self):
        """Get list of files in context."""
        return self.editor.get_file_list()
    
    def clear_files(self):
        """Clear all files from context."""
        self.editor.clear_files()
    
    def clear_history(self):
        """Clear conversation history."""
        self.messages = []
    
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
            # Handle both string content and list content (multimodal)
            if isinstance(content, list):
                # For multimodal content, check if there's any non-empty text
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
        
        # Build multimodal content
        content = [{"type": "text", "text": text}]
        
        for img in images:
            if isinstance(img, dict):
                data = img.get('data', '')
                mime_type = img.get('mime_type', 'image/png')
            else:
                # Assume it's base64 string
                data = img
                mime_type = 'image/png'
            
            content.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:{mime_type};base64,{data}"
                }
            })
        
        return content
    
    def request_changes(self, user_request, include_examples=True, images=None):
        """
        Send a request to the LLM and parse the response for edits.
        
        Args:
            user_request: The user's request for changes
            include_examples: Whether to include few-shot examples
            images: Optional list of image dicts with 'data' and 'mime_type'
            
        Returns:
            Dict with:
            - file_edits: List of (filename, original, updated) tuples
            - shell_commands: List of shell command strings
            - response: The raw LLM response text
        """
        # Build messages
        messages = []
        
        # System prompt
        system_content = self.editor.get_system_prompt()
        system_content += "\n\n" + self.editor.get_system_reminder()
        messages.append({"role": "system", "content": system_content})
        
        # Add conversation history first (before new user message)
        if self.messages:
            messages.extend(self.messages)
        
        # Optional few-shot examples (only if no history yet)
        if include_examples and not self.messages:
            example_messages = self.editor.get_example_messages()
            # Filter out any empty examples
            example_messages = self._filter_empty_messages(example_messages)
            messages.extend(example_messages)
        
        # File context
        file_context = self.editor.format_files_for_prompt()
        
        # User request with file context
        if file_context:
            user_text = f"Here are the files:\n\n{file_context}\n\n{user_request}"
        else:
            user_text = user_request
        
        # Build user content (with images if provided)
        user_content = self._build_user_content(user_text, images)
        messages.append({"role": "user", "content": user_content})
        
        # Final filter to ensure no empty messages
        messages = self._filter_empty_messages(messages)
        
        # Call LiteLLM
        response = _litellm.completion(
            model=self.model,
            messages=messages,
        )
        
        assistant_content = response.choices[0].message.content
        
        # Store in conversation history (store text version for history)
        self.messages.append({"role": "user", "content": user_text})
        self.messages.append({"role": "assistant", "content": assistant_content})
        
        # Parse the response for edits
        file_edits, shell_commands = self.editor.parse_response(assistant_content)
        
        return {
            "file_edits": file_edits,
            "shell_commands": shell_commands,
            "response": assistant_content
        }
    
    def apply_edits(self, edits, dry_run=False):
        """
        Apply edits to files.
        
        Args:
            edits: List of (filename, original, updated) tuples
            dry_run: If True, don't actually write files
            
        Returns:
            Dict with 'passed', 'failed', and 'content'
        """
        return self.editor.apply_edits(edits, dry_run=dry_run)
    
    def request_and_apply(self, user_request, dry_run=False, include_examples=True, images=None):
        """
        Request changes and apply them in one step.
        
        Args:
            user_request: The user's request for changes
            dry_run: If True, don't actually write files
            include_examples: Whether to include few-shot examples
            images: Optional list of image dicts with 'data' and 'mime_type'
            
        Returns:
            Dict with:
            - file_edits: List of edits that were requested
            - shell_commands: List of shell commands
            - response: Raw LLM response
            - passed: List of successfully applied edits
            - failed: List of failed edits
            - content: Dict of new file contents
        """
        result = self.request_changes(user_request, include_examples, images=images)
        
        if result["file_edits"]:
            apply_result = self.apply_edits(result["file_edits"], dry_run=dry_run)
            result.update(apply_result)
        else:
            result["passed"] = []
            result["failed"] = []
            result["content"] = {}
        
        return result
