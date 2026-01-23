import litellm as _litellm


COMMIT_SYSTEM_PROMPT = """You are an expert software engineer that generates Git commit messages based on the provided diffs.

Generate a commit message with this structure:

<type>: <subject>

<body>

Rules:
- <type> is one of: fix, feat, build, chore, ci, docs, style, refactor, perf, test
- <subject>: imperative mood, max 50 chars, no period
- Blank line between subject and body
- <body>: explain WHAT changed and WHY (not how), wrap at 72 chars
- For breaking changes, add "BREAKING CHANGE: <description>" in the body

Reply only with the commit message, no additional commentary."""


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
            - summarized: Whether history was summarized before this request
            - token_usage: Accumulated token usage statistics
        """
        print(f"🔍 DEBUG: chat() called")
        
        aider_chat = self.get_aider_chat()
        aider_chat.model = self.smaller_model if use_smaller_model else self.model
        aider_chat.clear_files()
        
        # Check if history needs summarization before making the request
        summarized = False
        needs_summary = self.check_history_needs_summarization()
        print(f"🔍 DEBUG: check_history_needs_summarization() returned: {needs_summary}")
        
        if needs_summary:
            print("📝 History too large, summarizing...")
            summary_result = self.summarize_history()
            print(f"🔍 DEBUG: summarize_history() returned: {summary_result.get('status')}")
            if summary_result.get("status") == "summarized":
                summarized = True
                print(f"✓ History summarized successfully")
            elif summary_result.get("status") == "error":
                print(f"⚠️ Summarization failed: {summary_result.get('error')}")
        
        # Load files into aider context
        if file_paths:
            for path in file_paths:
                try:
                    aider_chat.add_file(path)
                except FileNotFoundError as e:
                    return {"error": str(e), "response": "", "summarized": summarized}
        
        if auto_apply:
            result = aider_chat.request_and_apply(
                user_prompt, dry_run=dry_run, images=images, use_repo_map=use_repo_map
            )
        else:
            result = aider_chat.request_changes(
                user_prompt, images=images, use_repo_map=use_repo_map
            )
        
        result["summarized"] = summarized
        result["token_usage"] = self.get_token_usage()
        return result
    
    def get_commit_message(self, diff=None):
        """
        Generate a commit message from staged changes or provided diff.
        
        Tries the smaller/weaker model first, falls back to main model on failure.
        
        Args:
            diff: Optional diff string. If None, gets staged diff from repo.
            
        Returns:
            Dict with:
            - message: The generated commit message
            - model_used: Which model was used
            - error: Error message if failed
        """
        # Get diff from repo if not provided
        if diff is None:
            if not self.repo:
                return {"error": "No repository configured"}
            diff = self.repo.get_staged_diff()
            if isinstance(diff, dict) and 'error' in diff:
                return diff
            if not diff or not diff.strip():
                return {"error": "No staged changes to commit"}
        
        messages = [
            {"role": "system", "content": COMMIT_SYSTEM_PROMPT},
            {"role": "user", "content": f"Generate a commit message for these changes:\n\n{diff}"}
        ]
        
        # Try smaller model first
        models_to_try = [self.smaller_model, self.model]
        
        for model in models_to_try:
            try:
                print(f"🤖 Generating commit message with {model}...")
                response = _litellm.completion(
                    model=model,
                    messages=messages,
                )
                
                # Track token usage
                self.track_token_usage(response)
                
                commit_message = response.choices[0].message.content.strip()
                print(f"✓ Commit message generated")
                
                return {
                    "message": commit_message,
                    "model_used": model
                }
            except Exception as e:
                print(f"⚠️ Failed with {model}: {e}")
                if model == models_to_try[-1]:
                    return {"error": f"Failed to generate commit message: {e}"}
                continue
        
        return {"error": "Failed to generate commit message with all models"}
    
    def get_token_budget(self):
        """Get current token budget information."""
        aider_chat = self.get_aider_chat()
        return aider_chat.get_token_budget()
    
    def check_history_needs_summarization(self):
        """Check if conversation history needs summarization."""
        aider_chat = self.get_aider_chat()
        result = aider_chat.check_history_size()
        print(f"🔍 DEBUG: aider_chat.check_history_size() = {result}")
        if aider_chat._context_manager:
            cm = aider_chat._context_manager
            history_tokens = cm.count_tokens(cm.done_messages) if cm.done_messages else 0
            print(f"🔍 DEBUG: history_tokens={history_tokens}, max_history_tokens={cm.max_history_tokens}, done_messages count={len(cm.done_messages)}")
        return result
    
    def summarize_history(self):
        """
        Summarize conversation history if it's too large.
        
        Returns:
            Dict with status and new token count
        """
        aider_chat = self.get_aider_chat()
        
        if not aider_chat.check_history_size():
            print("🔍 DEBUG: summarize_history() - check_history_size() returned False")
            return {"status": "not_needed", "message": "History size is within limits"}
        
        head, tail = aider_chat.get_summarization_split()
        print(f"🔍 DEBUG: summarize_history() - head={len(head)} messages, tail={len(tail)} messages")
        
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
            print(f"🤖 Calling {self.smaller_model} for summarization...")
            response = _litellm.completion(
                model=self.smaller_model,
                messages=[
                    {"role": "system", "content": "You are a helpful assistant that summarizes conversations concisely. Focus on: 1) What files were discussed/modified, 2) Key decisions made, 3) Important context for continuing the conversation."},
                    {"role": "user", "content": summary_prompt}
                ]
            )
            
            # Track token usage from summarization
            self.track_token_usage(response)
            
            summary = response.choices[0].message.content
            
            # Update history with summary
            aider_chat.set_summarized_history(summary, tail)
            
            new_budget = aider_chat.get_token_budget()
            print(f"✓ History reduced to {new_budget.get('history_tokens', 0)} tokens")
            
            return {
                "status": "summarized",
                "summary": summary,
                "token_budget": new_budget
            }
        except Exception as e:
            print(f"🔍 DEBUG: summarize_history() exception: {e}")
            return {"status": "error", "error": str(e)}
