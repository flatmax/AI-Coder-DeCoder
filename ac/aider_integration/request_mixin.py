"""
Request mixin for AiderChat.

Handles LLM requests and edit application.
"""

import litellm as _litellm


class RequestMixin:
    """Mixin for LLM request and edit operations."""
    
    def request_changes(self, user_request, include_examples=True, images=None, use_repo_map=True,
                        auto_add_files=False, max_rounds=3):
        """
        Send a request to the LLM and parse the response for edits.
        
        Args:
            user_request: The user's request for changes
            include_examples: Whether to include few-shot examples
            images: Optional list of image dicts with 'data' and 'mime_type'
            use_repo_map: Whether to include repo map in context
            auto_add_files: If True, automatically add mentioned files and retry
            max_rounds: Maximum number of retry rounds when auto-adding files
            
        Returns:
            Dict with:
            - file_edits: List of (filename, original, updated) tuples
            - shell_commands: List of shell command strings
            - response: The raw LLM response text
            - token_budget: Token usage information
            - mentioned_files: Set of files mentioned but not in context
            - files_added: List of files that were auto-added (if auto_add_files=True)
        """
        files_added = []
        
        for round_num in range(max_rounds):
            messages, user_text = self._build_messages(
                user_request, images, include_examples, use_repo_map
            )
            
            print(f"🚀 Sending request to {self.model}..." + (f" (round {round_num + 1})" if round_num > 0 else ""))
            
            response = _litellm.completion(
                model=self.model,
                messages=messages,
            )
            
            # Track token usage if tracker is available
            if self.token_tracker and hasattr(self.token_tracker, 'track_token_usage'):
                self.token_tracker.track_token_usage(response)
            
            assistant_content = response.choices[0].message.content
            
            # Print response stats
            usage = getattr(response, 'usage', None)
            if usage:
                print(f"✓ Response received: {usage.completion_tokens} tokens generated")
            
            # Check for file mentions using aider's approach
            file_check = self.check_for_file_requests(assistant_content)
            mentioned_files = file_check.get("mentioned_files", set())
            
            if mentioned_files:
                print(f"📄 Detected {len(mentioned_files)} file mention(s): {', '.join(mentioned_files)}")
            
            # If auto-adding files and LLM needs files, add them and retry
            if auto_add_files and mentioned_files and round_num < max_rounds - 1:
                print(f"📁 Auto-adding mentioned files and retrying...")
                for fpath in mentioned_files:
                    try:
                        self.add_file(fpath)
                        files_added.append(fpath)
                        print(f"  ✓ Added: {fpath}")
                    except FileNotFoundError as e:
                        print(f"  ✗ Could not add: {fpath} ({e})")
                # Continue to next round
                continue
            
            # Store in conversation history (text version only)
            self.messages.append({"role": "user", "content": user_text})
            self.messages.append({"role": "assistant", "content": assistant_content})
            
            # Also update context manager history and print HUD
            if self._context_manager:
                self._context_manager.add_exchange(user_text, assistant_content)
                self._context_manager.print_hud(messages)
            
            file_edits, shell_commands = self.editor.parse_response(assistant_content)
            
            if file_edits:
                print(f"📝 Parsed {len(file_edits)} edit(s)")
            if shell_commands:
                print(f"🖥️  Parsed {len(shell_commands)} shell command(s)")
            
            return {
                "file_edits": file_edits,
                "shell_commands": shell_commands,
                "response": assistant_content,
                "token_budget": self.get_token_budget(messages),
                "mentioned_files": mentioned_files,
                "files_added": files_added
            }
        
        # If we exhausted all rounds
        return {
            "file_edits": [],
            "shell_commands": [],
            "response": assistant_content,
            "token_budget": self.get_token_budget(messages),
            "mentioned_files": mentioned_files,
            "files_added": files_added,
            "max_rounds_reached": True
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
        result = self.editor.apply_edits(edits, dry_run=dry_run)
        
        if result["passed"]:
            print(f"✓ Applied {len(result['passed'])} edit(s)")
        if result["failed"]:
            print(f"✗ Failed {len(result['failed'])} edit(s)")
        
        return result
    
    def request_and_apply(self, user_request, dry_run=False, include_examples=True, 
                          images=None, use_repo_map=True, auto_add_files=False, max_rounds=3):
        """
        Request changes and apply them in one step.
        
        Args:
            user_request: The user's request for changes
            dry_run: If True, don't actually write files
            include_examples: Whether to include few-shot examples
            images: Optional list of image dicts with 'data' and 'mime_type'
            use_repo_map: Whether to include repo map in context
            auto_add_files: If True, automatically add mentioned files and retry
            max_rounds: Maximum number of retry rounds when auto-adding files
            
        Returns:
            Dict with:
            - file_edits: List of edits that were requested
            - shell_commands: List of shell commands
            - response: Raw LLM response
            - passed: List of successfully applied edits
            - failed: List of failed edits
            - content: Dict of new file contents
            - token_budget: Token usage information
            - mentioned_files: Set of files mentioned but not in context
            - files_added: List of files that were auto-added
        """
        result = self.request_changes(
            user_request, include_examples, images=images, use_repo_map=use_repo_map,
            auto_add_files=auto_add_files, max_rounds=max_rounds
        )
        
        if result["file_edits"]:
            apply_result = self.apply_edits(result["file_edits"], dry_run=dry_run)
            result.update(apply_result)
        else:
            result["passed"] = []
            result["failed"] = []
            result["content"] = {}
        
        return result
