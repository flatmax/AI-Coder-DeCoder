import litellm as _litellm


class ChatMixin:
    """Mixin for chat operations using aider's edit format."""
    
    def chat(self, user_prompt, file_paths=None, images=None, system_prompt=None, 
             file_version='working', stream=False, use_smaller_model=False,
             dry_run=False, auto_apply=True):
        """
        Send a chat message using aider's search/replace format.
        
        Args:
            user_prompt: The user's message
            file_paths: Optional list of file paths to include as context
            images: Optional list of base64 encoded images or dicts with 'data' and 'mime_type'
            system_prompt: Optional system prompt (currently unused, aider provides its own)
            file_version: Version of files to load ('working', 'HEAD', or commit hash)
            stream: Whether to stream the response (not yet implemented)
            use_smaller_model: Whether to use the smaller/faster model
            dry_run: If True, don't write changes to disk
            auto_apply: If True, automatically apply edits; if False, just return parsed edits
        
        Returns:
            Dict with:
            - response: Raw LLM response text
            - file_edits: List of (filename, original, updated) tuples
            - shell_commands: List of shell command strings
            - passed: List of successfully applied edits (if auto_apply)
            - failed: List of failed edits (if auto_apply)
            - content: Dict of new file contents
        """
        aider_chat = self.get_aider_chat()
        aider_chat.model = self.smaller_model if use_smaller_model else self.model
        aider_chat.clear_files()
        
        # Load files into aider context
        if file_paths:
            for path in file_paths:
                try:
                    aider_chat.add_file(path)
                except FileNotFoundError as e:
                    return {"error": str(e), "response": ""}
        
        # Handle images by appending to prompt
        if images:
            # Note: aider doesn't natively support images, so we note them in the prompt
            image_note = f"\n[{len(images)} image(s) provided - image analysis not yet supported in edit mode]"
            user_prompt = user_prompt + image_note
        
        if auto_apply:
            return aider_chat.request_and_apply(user_prompt, dry_run=dry_run)
        else:
            return aider_chat.request_changes(user_prompt)
