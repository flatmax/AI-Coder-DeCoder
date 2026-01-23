import litellm as _litellm


class ChatMixin:
    """Mixin for chat operations using aider's edit format."""
    
    def chat(self, user_prompt, file_paths=None, images=None, system_prompt=None, 
             file_version='working', stream=False, use_smaller_model=False,
             dry_run=False, auto_apply=True, use_repo_map=True):
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
            use_repo_map: If True, include intelligent repo map in context
        
        Returns:
            Dict with:
            - response: Raw LLM response text
            - file_edits: List of (filename, original, updated) tuples
            - shell_commands: List of shell command strings
            - passed: List of successfully applied edits (if auto_apply)
            - failed: List of failed edits (if auto_apply)
            - content: Dict of new file contents
            - token_budget: Token usage information
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
        
        if auto_apply:
            return aider_chat.request_and_apply(
                user_prompt, dry_run=dry_run, images=images, use_repo_map=use_repo_map
            )
        else:
            return aider_chat.request_changes(
                user_prompt, images=images, use_repo_map=use_repo_map
            )
    
    def get_token_budget(self):
        """Get current token budget information."""
        aider_chat = self.get_aider_chat()
        return aider_chat.get_token_budget()
    
    def check_history_needs_summarization(self):
        """Check if conversation history needs summarization."""
        aider_chat = self.get_aider_chat()
        return aider_chat.check_history_size()
    
    def summarize_history(self):
        """
        Summarize conversation history if it's too large.
        
        Returns:
            Dict with status and new token count
        """
        aider_chat = self.get_aider_chat()
        
        if not aider_chat.check_history_size():
            return {"status": "not_needed", "message": "History size is within limits"}
        
        head, tail = aider_chat.get_summarization_split()
        
        if not head:
            return {"status": "not_needed", "message": "No messages to summarize"}
        
        # Build summarization prompt
        summary_prompt = "Please provide a concise summary of the following conversation, focusing on key decisions, code changes made, and important context:\n\n"
        for msg in head:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            if isinstance(content, str):
                summary_prompt += f"{role.upper()}: {content[:500]}...\n\n" if len(content) > 500 else f"{role.upper()}: {content}\n\n"
        
        # Call LLM for summarization using smaller model
        try:
            response = _litellm.completion(
                model=self.smaller_model,
                messages=[
                    {"role": "system", "content": "You are a helpful assistant that summarizes conversations concisely."},
                    {"role": "user", "content": summary_prompt}
                ]
            )
            summary = response.choices[0].message.content
            
            # Update history with summary
            aider_chat.set_summarized_history(summary, tail)
            
            return {
                "status": "summarized",
                "summary": summary,
                "token_budget": aider_chat.get_token_budget()
            }
        except Exception as e:
            return {"status": "error", "error": str(e)}
