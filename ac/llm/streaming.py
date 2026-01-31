"""
Streaming mixin for LiteLLM chat operations.
"""

import asyncio
import threading
import litellm as _litellm

from ..prompts import build_system_prompt
from ..edit_parser import EditParser, EditStatus


REPO_MAP_HEADER = """# Repository Structure

Below is a map of the repository showing classes, functions, and their relationships.
Use this to understand the codebase structure and find relevant code.

"""

REPO_MAP_CONTINUATION = """# Repository Structure (continued)

"""

FILE_TREE_HEADER = """# Repository Files

Complete list of files in the repository:

"""

URL_CONTEXT_HEADER = """# URL Context

The following content was fetched from URLs mentioned in the conversation:

"""

FILES_L0_HEADER = """# Reference Files (Stable)

These files are included for reference:

"""

FILES_L1_HEADER = """# Reference Files

These files are included for reference:

"""

FILES_L2_HEADER = """# Reference Files (L2)

These files are included for reference:

"""

FILES_L3_HEADER = """# Reference Files (L3)

These files are included for reference:

"""

FILES_ACTIVE_HEADER = """# Working Files

Here are the files:

"""


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
            model = self.smaller_model if use_smaller_model else self.model
            
            # Check/handle summarization using new context manager
            summarized = False
            if self._context_manager and self._context_manager.history_needs_summary():
                summary_result = self.summarize_history()
                if summary_result.get("status") == "summarized":
                    summarized = True
            
            # Load files into context manager
            if self._context_manager:
                self._context_manager.file_context.clear()
            
            if file_paths:
                # Validate all files upfront before processing
                invalid_files = []
                binary_files = []
                
                for path in file_paths:
                    if self.repo:
                        if not self.repo.file_exists(path):
                            invalid_files.append(path)
                        elif self.repo.is_binary_file(path):
                            binary_files.append(path)
                
                # Report all problematic files at once
                if invalid_files or binary_files:
                    error_parts = []
                    if binary_files:
                        error_parts.append(f"Binary files cannot be included: {', '.join(binary_files)}")
                    if invalid_files:
                        error_parts.append(f"Files not found: {', '.join(invalid_files)}")
                    
                    await self._send_stream_complete(request_id, {
                        "error": "\n".join(error_parts),
                        "response": "",
                        "summarized": summarized,
                        "invalid_files": invalid_files,
                        "binary_files": binary_files
                    })
                    return
                
                # All files valid, now load them
                for path in file_paths:
                    if self._context_manager and self.repo:
                        content = self.repo.get_file_content(path)
                        if isinstance(content, dict) and 'error' in content:
                            # Shouldn't happen after validation, but handle gracefully
                            await self._send_stream_complete(request_id, {
                                "error": content['error'],
                                "response": "",
                                "summarized": summarized
                            })
                            return
                        self._context_manager.file_context.add_file(path, content)
            
            # Detect and fetch URLs from user prompt
            url_context = None
            if hasattr(self, '_get_url_fetcher'):
                try:
                    from ..url_handler import URLDetector
                    urls = URLDetector.find_urls(user_prompt)
                    if urls:
                        fetcher = self._get_url_fetcher()
                        url_context = [
                            fetcher.fetch(url, use_cache=True, summarize=True, context=user_prompt)
                            for url in urls[:3]  # Limit to 3 URLs per message
                        ]
                except Exception as e:
                    print(f"⚠️ URL fetch error: {e}")
            
            # Build messages using symbol map for context
            messages, user_text, context_map_tokens = self._build_streaming_messages(
                user_prompt, file_paths, images, use_repo_map, url_context
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
            
            # Store in conversation history (context manager is single source of truth)
            if self._context_manager:
                self._context_manager.add_exchange(user_text, full_content)
            
            # Update symbol map with current context files
            symbol_map_info = self._auto_save_symbol_map()
            
            # Print token usage HUD and get breakdown for frontend
            hud_breakdown = self._print_streaming_hud(messages, file_paths, context_map_tokens, symbol_map_info)
            
            # Parse and apply edits using v3 format
            edit_parser = EditParser()
            
            result = {
                "response": full_content,
                "summarized": summarized,
                "token_usage": self.get_token_usage(),
                "edit_format": "edit_v3"
            }
            
            # Use v3 anchored edit format
            blocks = edit_parser.parse_response(full_content)
            shell_commands = edit_parser.detect_shell_suggestions(full_content)
            
            result["shell_commands"] = shell_commands
            result["file_edits"] = []  # Legacy format for compatibility
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
                result["content"] = {}  # New parser writes directly
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
            
            # Store assistant message in history
            # Handle both new format (files_modified list) and legacy format (passed tuples)
            files_modified = result.get("files_modified") or [edit[0] for edit in result.get("passed", [])]
            self.store_assistant_message(
                content=full_content,
                files_modified=files_modified if files_modified else None
            )
            
            # Update file stability tracking after response
            if file_paths and self._context_manager and self._context_manager.file_stability:
                stability = self._context_manager.file_stability
                tier_changes = stability.update_after_response(
                    items=file_paths,
                    get_content=lambda p: self.repo.get_file_content(p, version='working'),
                    modified=files_modified
                )
                
                # Log promotions and demotions
                promotions = stability.get_last_promotions()
                demotions = stability.get_last_demotions()
                
                if promotions:
                    promoted_items = [f"{item}→{tier}" for item, tier in promotions]
                    print(f"📈 Promoted: {', '.join(promoted_items)}")
                
                if demotions:
                    demoted_items = [f"{item}→{tier}" for item, tier in demotions]
                    print(f"📉 Demoted: {', '.join(demoted_items)}")
            
            # Add last request token usage for the HUD (not cumulative)
            if hasattr(self, '_last_request_tokens') and self._last_request_tokens:
                result["token_usage"] = {
                    "prompt_tokens": self._last_request_tokens.get('prompt', 0),
                    "completion_tokens": self._last_request_tokens.get('completion', 0),
                    "total_tokens": self._last_request_tokens.get('prompt', 0) + self._last_request_tokens.get('completion', 0),
                    "cache_hit_tokens": self._last_request_tokens.get('cache_hit', 0),
                    "cache_write_tokens": self._last_request_tokens.get('cache_write', 0),
                }
                # Include context breakdown if available
                if hud_breakdown:
                    result["token_usage"].update(hud_breakdown)
            
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
            
            # Send final chunk (non-blocking, streamComplete will ensure ordering)
            if full_content:
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
    
    def _build_streaming_messages(self, user_prompt, file_paths, images, use_repo_map, url_context=None):
        """
        Build messages for streaming using symbol map for context.
        
        Uses tiered file caching: L0 (most stable) and L1 (moderately stable) files
        get cache_control for better prompt caching, while active files are uncached.
        
        Args:
            user_prompt: The user's message
            file_paths: List of file paths to include as context
            images: Optional list of base64 encoded images
            use_repo_map: Whether to include the symbol map
            url_context: Optional list of URLResult objects to include
            
        Returns:
            Tuple of (messages, user_text, context_map_tokens)
        """
        messages = []
        context_map_tokens = 0
        
        # Get file tiers from stability tracker
        file_tiers = {'L0': [], 'L1': [], 'L2': [], 'L3': [], 'active': []}
        if file_paths and self._context_manager and self._context_manager.file_stability:
            file_tiers = self._context_manager.file_stability.get_items_by_tier(file_paths)
            # Ensure all tier keys exist
            for tier in ['L0', 'L1', 'L2', 'L3', 'active']:
                if tier not in file_tiers:
                    file_tiers[tier] = []
            # Any files not yet tracked go to active
            tracked = set()
            for tier_files in file_tiers.values():
                tracked.update(tier_files)
            for path in file_paths:
                if path not in tracked:
                    file_tiers['active'].append(path)
        elif file_paths:
            # No stability tracker - all files are active
            file_tiers['active'] = list(file_paths)
        
        # Log tier distribution
        if file_paths:
            tier_counts = []
            for tier in ['L0', 'L1', 'L2', 'L3']:
                count = len(file_tiers.get(tier, []))
                if count > 0:
                    tier_counts.append(f"{count} {tier}")
            active_count = len(file_tiers.get('active', []))
            if active_count > 0:
                tier_counts.append(f"{active_count} active")
            if tier_counts:
                print(f"📁 Files: {', '.join(tier_counts)}")
        
        # System prompt with edit instructions
        # Use cache_control for providers that support prompt caching (Anthropic, Bedrock)
        system_text = build_system_prompt()

        # Get symbol map chunks - we'll combine first chunk with system prompt
        # Block allocation (4 total):
        #   Block 1: system + symbol map part 1 (cached)
        #   Block 2: symbol map part 2 (cached)
        #   Block 3: L0 files (cached)
        #   Block 4: L1 files (cached)
        context_map_chunks = []
        if use_repo_map and self.repo:
            context_map_chunks = self.get_context_map_chunked(
                chat_files=file_paths,
                include_references=True,
                num_chunks=2,  # 2 chunks: first goes in system, second in user message
                return_metadata=True
            )
            if context_map_chunks:
                # Diagnostic: show chunk info
                print(f"📦 Symbol map: {len(context_map_chunks)} chunks")
                for i, chunk in enumerate(context_map_chunks):
                    content = chunk['content']
                    file_count = len(chunk['files'])
                    lines = content.count('\n')
                    cached = "🔒"  # Both chunks end up cached
                    print(f"  {cached} Chunk {i}: {len(content):,} chars, ~{len(content)//4:,} tokens, {lines} lines, {file_count} files")

        # Combine system prompt with first symbol map chunk (Block 1)
        system_and_map1 = system_text
        if context_map_chunks:
            system_and_map1 += "\n\n" + REPO_MAP_HEADER + context_map_chunks[0]['content']
            if self._context_manager:
                try:
                    context_map_tokens += self._context_manager.count_tokens(context_map_chunks[0]['content'])
                except Exception:
                    pass

        messages.append({
            "role": "system",
            "content": [
                {
                    "type": "text",
                    "text": system_and_map1,
                    "cache_control": {"type": "ephemeral"}
                }
            ]
        })

        # Add second symbol map chunk as separate user message (Block 2)
        if len(context_map_chunks) > 1:
            map_content = REPO_MAP_CONTINUATION + context_map_chunks[1]['content']
            messages.append({
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": map_content,
                        "cache_control": {"type": "ephemeral"}
                    }
                ]
            })
            messages.append({
                "role": "assistant",
                "content": "Ok."
            })
            if self._context_manager:
                try:
                    context_map_tokens += self._context_manager.count_tokens(map_content)
                except Exception:
                    pass
        
        # Add file tree (uncached - changes more frequently than symbol map)
        if use_repo_map and self.repo:
            file_tree = self.get_file_tree_for_context()
            if file_tree:
                tree_content = FILE_TREE_HEADER + file_tree
                messages.append({"role": "user", "content": tree_content})
                messages.append({"role": "assistant", "content": "Ok."})
        
        # Add URL context if provided
        if url_context:
            url_parts = []
            for result in url_context:
                if result.content.error:
                    continue
                
                url_part = result.content.format_for_prompt(summary=result.summary)
                url_parts.append(url_part)
            
            if url_parts:
                url_message = URL_CONTEXT_HEADER + "\n---\n".join(url_parts)
                messages.append({"role": "user", "content": url_message})
                messages.append({"role": "assistant", "content": "Ok, I've reviewed the URL content."})
        
        # Add tiered file contents
        # L0 files (most stable, 12+ responses unchanged) - cached
        if file_tiers.get('L0'):
            l0_content = self._format_files_for_cache(file_tiers['L0'], FILES_L0_HEADER)
            if l0_content:
                messages.append({
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": l0_content,
                            "cache_control": {"type": "ephemeral"}
                        }
                    ]
                })
                messages.append({"role": "assistant", "content": "Ok."})
        
        # L1 files (very stable, 9+ responses unchanged) - cached
        if file_tiers.get('L1'):
            l1_content = self._format_files_for_cache(file_tiers['L1'], FILES_L1_HEADER)
            if l1_content:
                messages.append({
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": l1_content,
                            "cache_control": {"type": "ephemeral"}
                        }
                    ]
                })
                messages.append({"role": "assistant", "content": "Ok."})
        
        # L2 files (stable, 6+ responses unchanged) - cached
        if file_tiers.get('L2'):
            l2_content = self._format_files_for_cache(file_tiers['L2'], FILES_L2_HEADER)
            if l2_content:
                messages.append({
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": l2_content,
                            "cache_control": {"type": "ephemeral"}
                        }
                    ]
                })
                messages.append({"role": "assistant", "content": "Ok."})
        
        # L3 files (moderately stable, 3+ responses unchanged) - cached
        if file_tiers.get('L3'):
            l3_content = self._format_files_for_cache(file_tiers['L3'], FILES_L3_HEADER)
            if l3_content:
                messages.append({
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": l3_content,
                            "cache_control": {"type": "ephemeral"}
                        }
                    ]
                })
                messages.append({"role": "assistant", "content": "Ok."})
        
        # Active files (recently changed) - not cached
        if file_tiers.get('active'):
            active_content = self._format_files_for_cache(file_tiers['active'], FILES_ACTIVE_HEADER)
            if active_content:
                messages.append({"role": "user", "content": active_content})
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
    
    def _format_files_for_cache(self, file_paths: list[str], header: str) -> str:
        """Format files for inclusion in a cache block."""
        parts = [header]
        for path in file_paths:
            try:
                content = self.repo.get_file_content(path, version='working')
                if isinstance(content, dict) and 'error' in content:
                    continue
                if content:
                    parts.append(f"{path}\n```\n{content}\n```")
            except Exception as e:
                print(f"⚠️ Could not read {path}: {e}")
        
        # Return empty string if only header (no files added)
        if len(parts) == 1:
            return ""
        return "\n\n".join(parts)
    
    def _fire_stream_chunk(self, request_id, content, loop):
        """Fire stream chunk send (non-blocking).
        
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
        """Print HUD after streaming completes and return breakdown for frontend."""
        try:
            if not self._context_manager:
                return None
            
            ctx = self._context_manager
            
            # Count tokens in different parts
            total_tokens = 0
            system_tokens = 0
            history_tokens = 0
            file_tokens = 0
            
            for msg in messages:
                content = msg.get("content", "")
                if isinstance(content, list):
                    # Handle structured content (images, cache_control blocks)
                    text_parts = [p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text"]
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
            model_name = self.model
            
            # Get token limit
            max_tokens = ctx.token_counter.max_input_tokens
            
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
                print(f"  Last request:    {req.get('prompt', 0):,} in, {req.get('completion', 0):,} out")
                
                # Show cache details if any caching occurred
                cache_hit = req.get('cache_hit', 0)
                cache_write = req.get('cache_write', 0)
                if cache_hit or cache_write:
                    cache_parts = []
                    if cache_hit:
                        cache_parts.append(f"hit: {cache_hit:,}")
                    if cache_write:
                        cache_parts.append(f"write: {cache_write:,}")
                    
                    # Estimate what was cached (system + symbol map are the cacheable prefix)
                    cacheable_estimate = system_tokens + context_map_tokens
                    if cache_hit and cacheable_estimate:
                        pct = min(100, int(cache_hit * 100 / cacheable_estimate))
                        cache_parts.append(f"~{pct}% of sys+map")
                    
                    print(f"  Cache:           {', '.join(cache_parts)}")
            
            # Show session totals
            print(f"{'─' * 50}")
            print(f"  Session in:      {self._total_prompt_tokens:,}")
            print(f"  Session out:     {self._total_completion_tokens:,}")
            print(f"  Session total:   {self._total_prompt_tokens + self._total_completion_tokens:,}")
            print(f"{'─' * 50}\n")
            
            # Return breakdown for frontend HUD
            return {
                "system_tokens": system_tokens,
                "symbol_map_tokens": context_map_tokens,
                "file_tokens": file_tokens,
                "history_tokens": history_tokens,
                "context_total_tokens": total_tokens,
                "max_input_tokens": max_tokens,
                "session_prompt_tokens": self._total_prompt_tokens,
                "session_completion_tokens": self._total_completion_tokens,
                "session_total_tokens": self._total_prompt_tokens + self._total_completion_tokens,
            }
                
        except Exception as e:
            import traceback
            print(f"⚠️ HUD error: {e}")
            traceback.print_exc()
            return None
    
    async def _send_stream_complete(self, request_id, result):
        """Send stream completion to the client."""
        try:
            # Small delay to ensure final streamChunk is delivered first
            await asyncio.sleep(0.05)
            if hasattr(self, 'get_call'):
                call = self.get_call()
                if call and 'PromptView.streamComplete' in call:
                    await call['PromptView.streamComplete'](request_id, result)
        except Exception as e:
            print(f"Error sending stream complete: {e}")
