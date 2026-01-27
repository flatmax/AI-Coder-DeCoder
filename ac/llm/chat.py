import litellm as _litellm

from ..edit_parser import EditParser, EditStatus, ApplyResult

REPO_MAP_HEADER = """# Repository Structure

Below is a map of the repository showing classes, functions, and their relationships.
Use this to understand the codebase structure and find relevant code.

"""

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
             dry_run=False, auto_apply=True, use_repo_map=True, use_aider=False,
             auto_add_files=False, max_rounds=3):
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
            auto_add_files: If True, automatically add files the LLM mentions and retry
            max_rounds: Maximum retry rounds when auto-adding files (default 3)
        
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
            - mentioned_files: Files mentioned but not in context
            - files_added: Files that were auto-added (if auto_add_files=True)
        """
        aider_chat = self.get_aider_chat()
        aider_chat.model = self.smaller_model if use_smaller_model else self.model
        aider_chat.clear_files()
        
        # Check if history needs summarization before making the request
        summarized = False
        needs_summary = self.check_history_needs_summarization()
        
        if needs_summary:
            print("📝 History too large, summarizing...")
            summary_result = self.summarize_history()
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
        
        # Make the request (always get raw response first for dual-format detection)
        result = aider_chat.request_changes(
            user_prompt, images=images, use_repo_map=use_repo_map,
            auto_add_files=auto_add_files, max_rounds=max_rounds
        )
        
        # Check which edit format was used
        response_text = result.get("response", "")
        edit_parser = EditParser()
        format_type = edit_parser.detect_format(response_text)
        result["edit_format"] = format_type
        
        if auto_apply and response_text:
            # Use v3 anchored edit format
            blocks = edit_parser.parse_response(response_text)
            shell_commands = edit_parser.detect_shell_suggestions(response_text)
            
            result["shell_commands"] = shell_commands
            result["edit_blocks"] = [
                {
                    "file_path": b.file_path,
                    "anchor": b.anchor[:100] if b.anchor else "",
                    "old_lines": b.old_lines[:200] if b.old_lines else "",
                    "new_lines": b.new_lines[:200] if b.new_lines else "",
                }
                for b in blocks
            ]
            
            if blocks and not dry_run:
                apply_result = edit_parser.apply_edits(blocks, self.repo, dry_run=dry_run)
                
                # Convert to legacy format for compatibility
                result["passed"] = [
                    (r.file_path, r.old_preview, r.new_preview)
                    for r in apply_result.results if r.status == EditStatus.APPLIED
                ]
                result["failed"] = [
                    (r.file_path, r.reason, "")
                    for r in apply_result.results if r.status == EditStatus.FAILED
                ]
                result["skipped"] = [
                    (r.file_path, r.reason, "")
                    for r in apply_result.results if r.status == EditStatus.SKIPPED
                ]
                result["content"] = {}
                result["files_modified"] = apply_result.files_modified
                
                # Detailed results for UI
                result["edit_results"] = [
                    {
                        "file_path": r.file_path,
                        "status": r.status.value,
                        "reason": r.reason,
                        "estimated_line": r.estimated_line,
                        "anchor_preview": r.anchor_preview,
                        "old_preview": r.old_preview,
                        "new_preview": r.new_preview,
                    }
                    for r in apply_result.results
                ]
            else:
                result["passed"] = []
                result["failed"] = []
                result["skipped"] = []
                result["content"] = {}
                result["files_modified"] = []
                result["edit_results"] = []
        
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
    
    def _build_messages_with_symbol_map(self, user_prompt, file_paths=None, images=None, 
                                         system_prompt=None, include_repo_map=True):
        """
        Build messages for LLM using symbol map for context.
        
        Args:
            user_prompt: The user's message
            file_paths: List of file paths to include as context
            images: Optional list of base64 encoded images
            system_prompt: Optional custom system prompt
            include_repo_map: Whether to include the symbol map
            
        Returns:
            Tuple of (messages, user_text) where messages is the list for LLM
        """
        from ..aider_integration.prompts import build_edit_system_prompt
        
        messages = []
        
        # System prompt
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        else:
            messages.append({"role": "system", "content": build_edit_system_prompt()})
        
        # Add repo map context if requested
        if include_repo_map and self.repo:
            context_map = self.get_context_map(chat_files=file_paths, include_references=True)
            if context_map:
                messages.append({
                    "role": "user",
                    "content": REPO_MAP_HEADER + context_map
                })
                messages.append({
                    "role": "assistant", 
                    "content": "Ok."
                })
        
        # Add file contents
        if file_paths:
            file_content_parts = []
            for path in file_paths:
                try:
                    content = self.repo.get_file_content(path, version='working')
                    if content:
                        file_content_parts.append(f"{path}\n```\n{content}\n```")
                except Exception as e:
                    print(f"⚠️ Could not read {path}: {e}")
            
            if file_content_parts:
                files_message = "Here are the files:\n\n" + "\n\n".join(file_content_parts)
                messages.append({"role": "user", "content": files_message})
                messages.append({"role": "assistant", "content": "Ok."})
        
        # Add conversation history
        for msg in self.conversation_history:
            messages.append(msg)
        
        # Build user message with images if provided
        if images:
            content = [{"type": "text", "text": user_prompt}]
            for img in images:
                content.append({
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{img.get('mime_type', 'image/png')};base64,{img['data']}"
                    }
                })
            user_message = {"role": "user", "content": content}
        else:
            user_message = {"role": "user", "content": user_prompt}
        
        messages.append(user_message)
        
        return messages, user_prompt
    
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
            return {"status": "error", "error": str(e)}
