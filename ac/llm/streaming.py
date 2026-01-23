"""
Streaming mixin for LiteLLM chat operations.
"""

import asyncio
import litellm as _litellm


class StreamingMixin:
    """Mixin for streaming chat operations."""
    
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
            aider_chat.model = self.smaller_model if use_smaller_model else self.model
            aider_chat.clear_files()
            
            # Check/handle summarization
            summarized = False
            if self.check_history_needs_summarization():
                summary_result = self.summarize_history()
                if summary_result.get("status") == "summarized":
                    summarized = True
            
            # Load files into context
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
            
            # Build messages
            messages, user_text = aider_chat._build_messages(
                user_prompt, images, include_examples=True, use_repo_map=use_repo_map
            )
            
            # Capture the event loop BEFORE running in executor
            loop = asyncio.get_running_loop()
            
            # Run the synchronous streaming in a thread to not block the event loop
            full_content = await loop.run_in_executor(
                None,
                self._run_streaming_completion,
                request_id,
                aider_chat.model,
                messages,
                loop  # Pass the loop to the thread
            )
            
            # Store in conversation history
            aider_chat.messages.append({"role": "user", "content": user_text})
            aider_chat.messages.append({"role": "assistant", "content": full_content})
            
            if aider_chat._context_manager:
                aider_chat._context_manager.add_exchange(user_text, full_content)
            
            # Print HUD after streaming completes
            if aider_chat._context_manager:
                aider_chat._context_manager.print_hud(messages)
            
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
        """
        response = _litellm.completion(
            model=model,
            messages=messages,
            stream=True,
            stream_options={"include_usage": True}
        )
        
        full_content = ""
        
        final_chunk = None
        try:
            for chunk in response:
                final_chunk = chunk
                delta = chunk.choices[0].delta.content or ""
                if delta:
                    full_content += delta
                    # Fire-and-forget: schedule the send on the main event loop
                    self._fire_stream_chunk(request_id, full_content, loop)
        finally:
            if hasattr(response, 'close'):
                response.close()
        
        # Track token usage from the final chunk if available
        if final_chunk and hasattr(final_chunk, 'usage') and final_chunk.usage:
            self.track_token_usage(final_chunk)
        
        return full_content
    
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
    
    async def _send_stream_complete(self, request_id, result):
        """Send stream completion to the client."""
        try:
            if hasattr(self, 'get_call'):
                call = self.get_call()
                if call and 'PromptView.streamComplete' in call:
                    await call['PromptView.streamComplete'](request_id, result)
        except Exception as e:
            print(f"Error sending stream complete: {e}")
