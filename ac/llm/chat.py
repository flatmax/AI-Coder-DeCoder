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
    """Mixin for commit message generation and history management."""
    
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
        if self._context_manager:
            return self._context_manager.get_token_budget()
        return {"used": 0, "max_input": 128000, "remaining": 128000}
    
    def check_history_needs_summarization(self):
        """Check if conversation history needs summarization."""
        if self._context_manager:
            return self._context_manager.history_needs_summary()
        return False
    
    def summarize_history(self):
        """
        Summarize conversation history if it's too large.
        
        Returns:
            Dict with status and new token count
        """
        if not self._context_manager:
            return {"status": "not_needed", "message": "No context manager"}
        
        if not self._context_manager.history_needs_summary():
            return {"status": "not_needed", "message": "History size is within limits"}
        
        head, tail = self._context_manager.get_summarization_split()
        
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
            new_history = [
                {"role": "user", "content": f"Summary of previous conversation:\n{summary}"},
                {"role": "assistant", "content": "Ok, I understand the context."}
            ] + tail
            
            self._context_manager.set_history(new_history)
            self.conversation_history = new_history
            
            new_budget = self._context_manager.get_token_budget()
            print(f"✓ History reduced to {new_budget.get('history_tokens', 0)} tokens")
            
            return {
                "status": "summarized",
                "summary": summary,
                "token_budget": new_budget
            }
        except Exception as e:
            return {"status": "error", "error": str(e)}
