"""
Streaming mixin for LiteLLM chat operations.
"""

import asyncio
import threading
import litellm as _litellm

from ..aider_integration.prompts import build_edit_system_prompt
from .chat import REPO_MAP_HEADER


class StreamingMixin:
    """Mixin for streaming chat operations."""
    
    # Class-level set to track cancelled requests (thread-safe)
    _cancelled_requests = set()
    _cancelled_lock = threading.Lock()
    
    def cancel_streaming(self, request_id):
        """
        Cancel an in-progress streaming request.
        
        Args:
            request_id: The request ID to cancel
            
        Returns:
            Dict with status
        """
        with self._cancelled_lock:
            self._cancelled_requests.add(request_id)
        return {"status": "cancelled", "request_id": request_id}
    
    def _is_cancelled(self, request_id):
        """Check if a request has been cancelled."""
        with self._cancelled_lock:
            return request_id in self._cancelled_requests
    
    def _clear_cancelled(self, request_id):
        """Remove a request from the cancelled set."""
        with self._cancelled_lock:
            self._cancelled_requests.discard(request_id)
    
    def chat_streaming(self, request_id, user_prompt, file_paths=None, images=None,
                       use_smaller_model=False, dry_run=False, use_repo_map=True):
        """
        Send a chat message with streaming response.
        
        The response will be streamed via callbacks to the client:
        - PromptView.streamChunk(request_id, content) - accumulated content
        - PromptView.streamComplete(request_id, result) - final result with edits
        
        Args:
            request_id: Unique ID for this request (for correlating callbacks)
            user_prompt: The user's message
            file_paths: Optional list of file paths to include as context
            images: Optional list of base64 encoded images
            use_smaller_model: Whether to use the smaller/faster model
            dry_run: If True, don't write changes to disk
            use_repo_map: If True, include intelligent repo map in context
        
        Returns:
            Dict with status: "started" or error
        """
        # Store user message in history immediately
        self.store_user_message(
            content=user_prompt,
            images=images,
            files=file_paths
        )
        
        # Start streaming in background task
        asyncio.create_task(self._stream_chat(
            request_id, user_prompt, file_paths, images,
            use_smaller_model, dry_run, use_repo_map
        ))
        
        return {"status": "started", "request_id": request_id}
    
    async def _stream_chat(self, request_id, user_prompt, file_paths, images,
                           use_smaller_model, dry_run, use_repo_map):
        """Background task that streams the chat response."""
        try:
            aider_chat = self.get_aider_chat()
            model = self.smaller_model if use_smaller_model else self.model
            aider_chat.model = model
            aider_chat.clear_files()
            
            # Check/handle summarization
            summarized = False
            if self.check_history_needs_summarization():
                summary_result = self.summarize_history()
                if summary_result.get("status") == "summarized":
                    summarized = True
            
            # Load files into aider context (for edit parsing)
            if file_paths:
                for path in file_paths:
                    try:
                        aider_chat.add_file(path)
                    except FileNotFoundError as e:
                        await self._send_stream_complete(request_id, {
                            "error": str(e),
                            "response": "",
                            "summarized": summarized
                        })
                        return
            
            # Build messages using symbol map for context
            messages, user_text, context_map_tokens = self._build_streaming_messages(
                user_prompt, file_paths, images, use_repo_map
            )
            
            # Capture the event loop BEFORE running in executor
            loop = asyncio.get_running_loop()
            
            # Run the synchronous streaming in a thread to not block the event loop
            full_content, was_cancelled = await loop.run_in_executor(
                None,
                self._run_streaming_completion,
                request_id,
                model,
                messages,
                loop  # Pass the loop to the thread
            )
            
            # If cancelled, send completion with cancelled flag and return early
            if was_cancelled:
                # Still store the partial assistant message
                self.store_assistant_message(
                    content=full_content + "\n\n*[stopped]*",
                    files_modified=None
                )
                
                await self._send_stream_complete(request_id, {
                    "response": full_content,
                    "cancelled": True,
                    "summarized": summarized,
                    "file_edits": [],
                    "shell_commands": [],
                    "passed": [],
                    "failed": [],
                    "content": {},
                    "token_usage": self.get_token_usage()
                })
                return
            
            # Store in conversation history (for aider's edit context)
            aider_chat.messages.append({"role": "user", "content": user_text})
            aider_chat.messages.append({"role": "assistant", "content": full_content})
            
            # Also store in our conversation history for persistence
            self.conversation_history.append({"role": "user", "content": user_text})
            self.conversation_history.append({"role": "assistant", "content": full_content})
            
            # Update symbol map with current context files
            symbol_map_info = self._auto_save_symbol_map()
            
            # Print token usage HUD
            self._print_streaming_hud(messages, file_paths, context_map_tokens, symbol_map_info)
            
            # Parse and apply edits
            file_edits, shell_commands = aider_chat.editor.parse_response(full_content)
            
            result = {
                "file_edits": file_edits,
                "shell_commands": shell_commands,
                "response": full_content,
                "summarized": summarized,
                "token_usage": self.get_token_usage()
            }
            
            if file_edits and not dry_run:
                apply_result = aider_chat.editor.apply_edits(file_edits, dry_run=dry_run)
                result.update(apply_result)
            else:
                result["passed"] = []
                result["failed"] = []
                result["content"] = {}
            
            # Store assistant message in history
            files_modified = [edit[0] for edit in result.get("passed", [])]
            self.store_assistant_message(
                content=full_content,
                files_modified=files_modified if files_modified else None
            )
            
            await self._send_stream_complete(request_id, result)
            
        except Exception as e:
            import traceback
            traceback.print_exc()
            await self._send_stream_complete(request_id, {
                "error": str(e),
                "response": "",
                "summarized": False
            })
    
    def _run_streaming_completion(self, request_id, model, messages, loop):
        """
        Run the streaming completion synchronously in a thread.
        Sends chunks via fire-and-forget to avoid blocking.
        
        Args:
            request_id: The request ID for correlation
            model: The model to use
            messages: The messages to send
            loop: The asyncio event loop from the main thread
            
        Returns:
            Tuple of (full_content, was_cancelled)
        """
        response = _litellm.completion(
            model=model,
            messages=messages,
            stream=True,
            stream_options={"include_usage": True}
        )
        
        full_content = ""
        was_cancelled = False
        
        final_chunk = None
        try:
            for chunk in response:
                # Check for cancellation
                if self._is_cancelled(request_id):
                    was_cancelled = True
                    break
                
                final_chunk = chunk
                delta = chunk.choices[0].delta.content or ""
                if delta:
                    full_content += delta
                    # Fire-and-forget: schedule the send on the main event loop
                    self._fire_stream_chunk(request_id, full_content, loop)
        finally:
            if hasattr(response, 'close'):
                response.close()
            # Clean up cancelled state
            self._clear_cancelled(request_id)
        
        # Track token usage from the final chunk if available
        if final_chunk and hasattr(final_chunk, 'usage') and final_chunk.usage:
            self.track_token_usage(final_chunk)
        
        return full_content, was_cancelled
    
    def _build_streaming_messages(self, user_prompt, file_paths, images, use_repo_map):
        """
        Build messages for streaming using symbol map for context.
        
        Args:
            user_prompt: The user's message
            file_paths: List of file paths to include as context
            images: Optional list of base64 encoded images
            use_repo_map: Whether to include the symbol map
            
        Returns:
            Tuple of (messages, user_text, context_map_tokens)
        """
        messages = []
        context_map_tokens = 0
        
        # System prompt with search/replace instructions
        messages.append({"role": "system", "content": build_edit_system_prompt()})
        
        # Add symbol map context if requested
        if use_repo_map and self.repo:
            context_map = self.get_context_map(chat_files=file_paths, include_references=True)
            if context_map:
                map_content = REPO_MAP_HEADER + context_map
                messages.append({
                    "role": "user",
                    "content": map_content
                })
                messages.append({
                    "role": "assistant", 
                    "content": "Ok."
                })
                # Count tokens in the map
                try:
                    aider_chat = self.get_aider_chat()
                    if aider_chat._context_manager:
                        context_map_tokens = aider_chat._context_manager.count_tokens(map_content)
                except Exception:
                    pass
        
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
        
        return messages, user_prompt, context_map_tokens
    
    def _fire_stream_chunk(self, request_id, content, loop):
        """Fire-and-forget stream chunk send.
        
        Args:
            request_id: The request ID
            content: The accumulated content
            loop: The asyncio event loop to schedule on
        """
        try:
            if hasattr(self, 'get_call'):
                call = self.get_call()
                if call and 'PromptView.streamChunk' in call:
                    # Schedule the coroutine on the main event loop from this thread
                    asyncio.run_coroutine_threadsafe(
                        call['PromptView.streamChunk'](request_id, content),
                        loop
                    )
        except Exception as e:
            print(f"Error firing stream chunk: {e}")
    
    def _print_streaming_hud(self, messages, file_paths, context_map_tokens=0, symbol_map_info=None):
        """Print HUD after streaming completes."""
        try:
            aider_chat = self.get_aider_chat()
            ctx = aider_chat._context_manager
            
            if not ctx:
                return
            
            # Count tokens in different parts
            total_tokens = 0
            system_tokens = 0
            history_tokens = 0
            file_tokens = 0
            
            for msg in messages:
                content = msg.get("content", "")
                if isinstance(content, list):
                    # Handle image messages - just count text parts
                    text_parts = [p.get("text", "") for p in content if p.get("type") == "text"]
                    content = " ".join(text_parts)
                tokens = ctx.count_tokens(content)
                total_tokens += tokens
                
                role = msg.get("role", "")
                if role == "system":
                    system_tokens += tokens
                elif role == "user" and content.startswith("Here are the files:"):
                    file_tokens += tokens
                elif role in ("user", "assistant") and not content.startswith("# Repository Structure"):
                    # Skip the symbol map exchange, count as history
                    if content != "Ok.":
                        history_tokens += tokens
            
            # Get model info
            model_name = aider_chat.model if hasattr(aider_chat, 'model') else 'unknown'
            
            # Get token limit
            try:
                import litellm
                model_info = litellm.get_model_info(model_name)
                max_tokens = model_info.get('max_input_tokens', 128000)
            except Exception:
                max_tokens = 128000
            
            # Print compact HUD
            print(f"\n{'─' * 50}")
            print(f"📊 {model_name}")
            print(f"{'─' * 50}")
            print(f"  System:          {system_tokens:,}")
            print(f"  Symbol Map:      {context_map_tokens:,}")
            print(f"  Files:           {file_tokens:,}")
            print(f"  History:         {history_tokens:,}")
            print(f"{'─' * 50}")
            print(f"  Total:           {total_tokens:,} / {max_tokens:,}")
            
            # Show last request token usage if available
            if hasattr(self, '_last_request_tokens') and self._last_request_tokens:
                req = self._last_request_tokens
                cache_info = ""
                if req.get('cache_hit', 0) > 0:
                    cache_info = f" (cache hit: {req['cache_hit']:,})"
                print(f"  Last request:    {req.get('prompt', 0):,} in, {req.get('completion', 0):,} out{cache_info}")
            print(f"{'─' * 50}\n")
                
        except Exception as e:
            import traceback
            print(f"⚠️ HUD error: {e}")
            traceback.print_exc()
    
    async def _send_stream_complete(self, request_id, result):
        """Send stream completion to the client."""
        try:
            if hasattr(self, 'get_call'):
                call = self.get_call()
                if call and 'PromptView.streamComplete' in call:
                    await call['PromptView.streamComplete'](request_id, result)
        except Exception as e:
            print(f"Error sending stream complete: {e}")
