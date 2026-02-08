"""
Streaming mixin for LiteLLM chat operations.
"""

import asyncio
import threading
import litellm as _litellm

from ..prompts import build_system_prompt
from ..edit_parser import EditParser, EditStatus
from ..symbol_index.compact_format import (
    get_legend,
    format_symbol_blocks_by_tier,
    compute_file_block_hash,
    _compute_path_aliases,
)
from .context_builder import TIER_THRESHOLDS, TIER_ORDER, CACHE_TIERS


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
            summarized = False  # History compaction runs post-response
            
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
                        if self._is_error_response(content):
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
            messages, user_text, context_map_tokens, tier_info = self._build_streaming_messages(
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
            
            # Flush any pending chunk coroutines scheduled from the thread
            await asyncio.sleep(0)
            
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
            hud_breakdown = self._print_streaming_hud(messages, file_paths, context_map_tokens, symbol_map_info, tier_info)
            
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
                
                # Invalidate symbol index cache for modified files so references get rebuilt
                if apply_result.files_modified:
                    si = self._get_symbol_index()
                    for modified_file in apply_result.files_modified:
                        si.invalidate_file(modified_file)
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
            edit_results = result.get("edit_results")
            self.store_assistant_message(
                content=full_content,
                files_modified=files_modified if files_modified else None,
                edit_results=edit_results if edit_results else None
            )
            
            # Update cache stability tracking after response (files AND symbol entries)
            if self._context_manager and self._context_manager.cache_stability:
                self._update_cache_stability(file_paths, files_modified)
            
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
                
                # Add history token info for HUD
                if self._context_manager:
                    history_tokens = self._context_manager.history_token_count()
                    compaction_config = self.get_compaction_config() if hasattr(self, 'get_compaction_config') else {}
                    trigger_threshold = compaction_config.get('compaction_trigger_tokens', 6000)
                    result["token_usage"]["history_tokens"] = history_tokens
                    result["token_usage"]["history_threshold"] = trigger_threshold
                
                # Include promotions/demotions from stability tracker
                if self._context_manager and self._context_manager.cache_stability:
                    stability = self._context_manager.cache_stability
                    result["token_usage"]["promotions"] = stability.get_last_promotions()
                    result["token_usage"]["demotions"] = stability.get_last_demotions()
            
            await self._send_stream_complete(request_id, result)
            
            # Run compaction AFTER response is complete (non-blocking for user)
            await self._run_post_response_compaction(request_id)
            
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
        Build messages for streaming using unified cache stability tracking.
        
        Uses a single StabilityTracker for both symbol map entries AND context files.
        Content is organized into 5 tiers:
        - L0: Most stable (12+ responses unchanged) - cached
        - L1: Very stable (9+ responses unchanged) - cached  
        - L2: Stable (6+ responses unchanged) - cached
        - L3: Moderately stable (3+ responses unchanged) - cached
        - active: Recently changed - not cached
        
        Symbol map entries for files in active context are excluded (full content replaces them).
        
        Args:
            user_prompt: The user's message
            file_paths: List of file paths to include as context
            images: Optional list of base64 encoded images
            use_repo_map: Whether to include the symbol map
            url_context: Optional list of URLResult objects to include
            
        Returns:
            Tuple of (messages, user_text, context_map_tokens, tier_info)
            where tier_info is a dict with per-tier token counts and content summaries
        """
        messages = []
        context_map_tokens = 0
        
        # Track per-tier information for HUD
        tier_info = self._make_tier_info()
        
        # Get stability tracker
        stability = self._get_stability_tracker()
        
        # Determine which files are in active context (full content will be included)
        # Normalize paths to ensure consistent matching
        active_context_files = set(str(p).replace('\\', '/') for p in file_paths) if file_paths else set()
        
        # Get file tiers from stability tracker (use mixin method)
        file_tiers = self._get_file_tiers(file_paths)
        
        # Log tier distribution for files
        if file_paths:
            tier_counts = []
            for tier in CACHE_TIERS:
                count = len(file_tiers.get(tier, []))
                if count > 0:
                    tier_counts.append(f"{count} {tier}")
            active_count = len(file_tiers.get('active', []))
            if active_count > 0:
                tier_counts.append(f"{active_count} active")
            if tier_counts:
                print(f"📁 Files: {', '.join(tier_counts)}")
        
        # Build system prompt
        system_text = build_system_prompt()
        
        # Get symbol map data using shared mixin method
        symbol_map_content, symbol_files_by_tier, legend, _ = self._get_symbol_map_data(
            active_context_files, file_paths
        )
        
        # Log symbol tier distribution
        if symbol_files_by_tier:
            tier_counts = []
            for tier in CACHE_TIERS:
                count = len(symbol_files_by_tier.get(tier, []))
                if count > 0:
                    tier_counts.append(f"{count} {tier}")
            if tier_counts:
                print(f"📦 Symbol map: {', '.join(tier_counts)}")
        
        # Build cache blocks by tier
        # Block 1 (L0): system + legend + L0 symbols + L0 files (cached)
        l0_content = system_text
        tier_info['L0']['has_system'] = True
        tier_info['L0']['tokens'] += self._safe_count_tokens(system_text)
        
        if legend:
            l0_content += "\n\n" + REPO_MAP_HEADER + legend + "\n"
            tier_info['L0']['has_legend'] = True
            legend_tokens = self._safe_count_tokens(REPO_MAP_HEADER + legend)
            tier_info['L0']['tokens'] += legend_tokens
            context_map_tokens += legend_tokens
        
        if symbol_map_content.get('L0'):
            l0_content += "\n" + symbol_map_content['L0']
            tier_info['L0']['symbols'] = len(symbol_files_by_tier.get('L0', []))
            l0_symbol_tokens = self._safe_count_tokens(symbol_map_content['L0'])
            tier_info['L0']['tokens'] += l0_symbol_tokens
            context_map_tokens += l0_symbol_tokens
        
        # Add L0 files to the L0 block
        if file_tiers.get('L0'):
            l0_files_content = self._format_files_for_cache(file_tiers['L0'], FILES_L0_HEADER)
            if l0_files_content:
                l0_content += "\n\n" + l0_files_content
                tier_info['L0']['files'] = len(file_tiers['L0'])
                tier_info['L0']['tokens'] += self._safe_count_tokens(l0_files_content)
        
        # Get history message tier assignments
        history_tiers = self._get_history_tiers()
        
        # Build L0 history as native message pairs
        l0_history_messages = []
        if history_tiers.get('L0'):
            l0_history_messages = self._build_history_messages_for_tier(history_tiers['L0'])
            if l0_history_messages:
                tier_info['L0']['history'] = len(history_tiers['L0'])
                for msg in l0_history_messages:
                    tier_info['L0']['tokens'] += self._safe_count_tokens(msg.get('content', ''))
        
        if l0_history_messages:
            # L0 has history: system message WITHOUT cache_control,
            # then native history pairs, cache_control on last history message
            messages.append({
                "role": "system",
                "content": l0_content,
            })
            messages.extend(l0_history_messages)
            self._apply_cache_control(messages[-1])
        else:
            # L0 without history: system message WITH cache_control (original behavior)
            messages.append({
                "role": "system",
                "content": [
                    {
                        "type": "text",
                        "text": l0_content,
                        "cache_control": {"type": "ephemeral"}
                    }
                ]
            })
        
        # Blocks 2-4 (L1, L2, L3): symbols + files per tier (cached)
        # Each tier emits: symbols/files pair + native history pairs
        # cache_control goes on the LAST message in the tier's sequence
        tier_file_headers = {
            'L1': FILES_L1_HEADER,
            'L2': FILES_L2_HEADER,
            'L3': FILES_L3_HEADER,
        }
        for tier in ['L1', 'L2', 'L3']:
            result = self._build_tier_cache_block(
                tier, symbol_map_content, symbol_files_by_tier,
                file_tiers, tier_info, tier_file_headers[tier],
                history_tiers=history_tiers
            )
            if result:
                tier_messages = result['messages'] + result['history_messages']
                if tier_messages:
                    # Place cache_control on the last message in this tier
                    self._apply_cache_control(tier_messages[-1])
                    messages.extend(tier_messages)
                context_map_tokens += result['symbol_tokens']
            else:
                tier_info['empty_tiers'] += 1
        
        # Add file tree (in active block for now - could be stability tracked later)
        if use_repo_map and self.repo:
            file_tree = self.get_file_tree_for_context()
            if file_tree:
                tree_content = FILE_TREE_HEADER + file_tree
                messages.append({"role": "user", "content": tree_content})
                messages.append({"role": "assistant", "content": "Ok."})
        
        # Add URL context if provided (active, not cached)
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
                tier_info['active']['has_urls'] = True
                tier_info['active']['tokens'] += self._safe_count_tokens(url_message)
        
        # Active files (recently changed) - not cached
        if file_tiers.get('active'):
            active_content = self._format_files_for_cache(file_tiers['active'], FILES_ACTIVE_HEADER)
            if active_content:
                messages.append({"role": "user", "content": active_content})
                messages.append({"role": "assistant", "content": "Ok."})
                tier_info['active']['files'] = len(file_tiers['active'])
                tier_info['active']['tokens'] += self._safe_count_tokens(active_content)
        
        # Add conversation history - only active (uncached) messages as raw pairs
        active_history_indices = set(history_tiers.get('active', []))
        cached_history_count = sum(
            len(indices) for tier, indices in history_tiers.items() if tier != 'active'
        )
        
        if self.conversation_history:
            for i, msg in enumerate(self.conversation_history):
                if i in active_history_indices:
                    messages.append(msg)
                    tier_info['active']['tokens'] += self._safe_count_tokens(msg.get('content', ''))
            
            if active_history_indices:
                tier_info['active']['has_history'] = True
                tier_info['active']['history'] = len(active_history_indices)
            
            if cached_history_count > 0:
                print(f"💬 History: {cached_history_count} cached, {len(active_history_indices)} active")
        
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
        
        # Update session empty tier count
        self._session_empty_tier_count += tier_info['empty_tiers']
        
        return messages, user_prompt, context_map_tokens, tier_info
    
    def _format_files_for_cache(self, file_paths: list[str], header: str) -> str:
        """Format files for inclusion in a cache block."""
        parts = [header]
        for path in file_paths:
            content = self._get_file_content_safe(path)
            if content:
                parts.append(f"{path}\n```\n{content}\n```")
        
        # Return empty string if only header (no files added)
        if len(parts) == 1:
            return ""
        return "\n\n".join(parts)
    
    def _build_history_messages_for_tier(self, message_indices: list[int]) -> list[dict]:
        """Build native user/assistant message pairs for a cached tier.
        
        History messages are always sent as native pairs — the LLM sees real
        conversation turns, maintaining its assistant persona. This is better
        than formatting as markdown strings inside a wrapper message.
        
        Args:
            message_indices: Indices into self.conversation_history
            
        Returns:
            List of message dicts (native user/assistant pairs)
        """
        history = self.conversation_history
        if not message_indices or not history:
            return []
        
        messages = []
        for idx in message_indices:
            if idx >= len(history):
                continue
            msg = history[idx]
            messages.append({
                "role": msg.get("role", "user"),
                "content": msg.get("content", ""),
            })
        
        return messages
    
    @staticmethod
    def _apply_cache_control(message: dict) -> None:
        """Apply cache_control to the last message in a tier sequence.
        
        Wraps the message content in structured format with cache_control
        if not already structured. Works for both user and assistant messages.
        
        Args:
            message: Message dict to modify in-place
        """
        content = message.get("content", "")
        if isinstance(content, list):
            # Already structured — add cache_control to last text block
            for item in reversed(content):
                if isinstance(item, dict) and item.get("type") == "text":
                    item["cache_control"] = {"type": "ephemeral"}
                    break
        else:
            # Plain string — wrap in structured format
            message["content"] = [
                {
                    "type": "text",
                    "text": content,
                    "cache_control": {"type": "ephemeral"}
                }
            ]
    
    def _get_history_tiers(self) -> dict[str, list[int]]:
        """Get history message indices organized by stability tier.
        
        Returns:
            Dict mapping tier names to lists of message indices
        """
        from ..context.stability_tracker import TIER_ORDER
        
        history = self.conversation_history
        tiers = {tier: [] for tier in TIER_ORDER}
        
        if not history or not self._context_manager or not self._context_manager.cache_stability:
            tiers['active'] = list(range(len(history))) if history else []
            return tiers
        
        stability = self._context_manager.cache_stability
        history_items = [f"history:{i}" for i in range(len(history))]
        tracked = stability.get_items_by_tier(history_items)
        
        for tier in TIER_ORDER:
            tier_items = tracked.get(tier, [])
            for item in tier_items:
                if item.startswith("history:"):
                    idx = int(item.split(":")[1])
                    if idx < len(history):
                        tiers[tier].append(idx)
            # Sort indices to maintain message order
            tiers[tier].sort()
        
        # Any untracked messages go to active
        tracked_indices = set()
        for indices in tiers.values():
            tracked_indices.update(indices)
        for i in range(len(history)):
            if i not in tracked_indices:
                tiers['active'].append(i)
        tiers['active'].sort()
        
        return tiers
    
    def _build_tier_cache_block(self, tier, symbol_map_content, symbol_files_by_tier,
                                file_tiers, tier_info, file_header,
                                history_tiers=None):
        """Build a cache block for a single tier (L1/L2/L3).
        
        Returns symbols/files as a user+assistant pair, plus native history
        message pairs. The caller places cache_control on the last message
        in the combined sequence.
        
        Args:
            tier: Tier name ('L1', 'L2', 'L3')
            symbol_map_content: Dict of tier -> formatted symbol content
            symbol_files_by_tier: Dict of tier -> file path lists
            file_tiers: Dict of tier -> file path lists (full content files)
            tier_info: Mutable dict tracking per-tier token counts
            file_header: Header string for the file section
            history_tiers: Optional dict of tier -> message index lists
            
        Returns:
            Dict with 'messages', 'history_messages', and 'symbol_tokens',
            or None if tier is empty
        """
        parts = []
        symbol_tokens = 0
        
        if symbol_map_content.get(tier):
            sym_content = REPO_MAP_CONTINUATION + symbol_map_content[tier]
            parts.append(sym_content)
            tier_info[tier]['symbols'] = len(symbol_files_by_tier.get(tier, []))
            sym_tokens = self._safe_count_tokens(sym_content)
            tier_info[tier]['tokens'] += sym_tokens
            symbol_tokens += sym_tokens
        
        if file_tiers.get(tier):
            files_content = self._format_files_for_cache(file_tiers[tier], file_header)
            if files_content:
                parts.append(files_content)
                tier_info[tier]['files'] = len(file_tiers[tier])
                tier_info[tier]['tokens'] += self._safe_count_tokens(files_content)
        
        # Build native history message pairs for this tier
        history_messages = []
        if history_tiers and history_tiers.get(tier):
            history_messages = self._build_history_messages_for_tier(history_tiers[tier])
            if history_messages:
                tier_info[tier]['history'] = len(history_tiers[tier])
                for msg in history_messages:
                    tier_info[tier]['tokens'] += self._safe_count_tokens(msg.get('content', ''))
        
        if not parts and not history_messages:
            return None
        
        messages = []
        if parts:
            combined = "\n\n".join(parts)
            messages = [
                {"role": "user", "content": combined},
                {"role": "assistant", "content": "Ok."},
            ]
        
        return {
            'messages': messages,
            'history_messages': history_messages,
            'symbol_tokens': symbol_tokens,
        }
    
    def _update_cache_stability(self, file_paths, files_modified):
        """Update cache stability tracking after a response.
        
        Implements controlled graduation for history messages:
        - Files and symbol entries leave/enter active normally
        - History messages accumulate N while active but only graduate to L3 when:
          a) Piggybacking on a file/symbol ripple (zero additional cost), or
          b) Eligible history tokens exceed cache_target_tokens (standalone graduation)
        - This prevents per-request ripple churn from history in long conversations
        
        Also detects stale items (deleted files) and removes them from cached
        tiers, marking those tiers as broken for the cascade.
        
        Args:
            file_paths: Files in active context this request
            files_modified: Files that were edited by the assistant
        """
        stability = self._context_manager.cache_stability
        tc = self._context_manager.token_counter
        history = self._context_manager.get_history()
        
        # --- Phase 0: Remove stale items (deleted/missing files) ---
        # Files that are tracked but no longer exist in the repo should be
        # removed. Their tiers are marked as broken for the cascade.
        stale_broken_tiers = set()
        try:
            all_repo_files = set(self._get_all_trackable_files())
            stale_items = []
            for item_key in list(stability._stability.keys()):
                if item_key.startswith("history:"):
                    continue  # History cleanup handled by compaction
                
                file_path = item_key.replace("symbol:", "") if item_key.startswith("symbol:") else item_key
                
                if file_path not in all_repo_files:
                    stale_items.append(item_key)
            
            if stale_items:
                for item_key in stale_items:
                    tier = stability.get_tier(item_key)
                    if tier != 'active':
                        stale_broken_tiers.add(tier)
                    del stability._stability[item_key]
                
                # Also clean from last_active_items
                stale_set = set(stale_items)
                stability._last_active_items -= stale_set
                
                if stale_broken_tiers:
                    print(f"🗑️ Removed {len(stale_items)} stale items from tiers: {', '.join(sorted(stale_broken_tiers))}")
        except Exception as e:
            # Don't let stale detection failure block the rest of stability tracking
            print(f"⚠️ Stale item detection error: {e}")
        
        # --- Build content/token callbacks (shared by both phases) ---
        
        def get_item_content(item):
            """Get content for stability hashing - files, symbol blocks, or history."""
            if item.startswith("history:"):
                idx = int(item.split(":")[1])
                if idx < len(history):
                    msg = history[idx]
                    return f"{msg.get('role', '')}:{msg.get('content', '')}"
                return None
            elif item.startswith("symbol:"):
                file_path = item.replace("symbol:", "")
                try:
                    si = self._get_symbol_index()
                    symbols = si.get_symbols(file_path)
                    if symbols:
                        return compute_file_block_hash(file_path, symbols)
                except Exception:
                    pass
                return None
            else:
                return self._get_file_content_safe(item)
        
        def get_item_tokens(item):
            """Get token count for an item - files, symbol blocks, or history."""
            if item.startswith("history:"):
                idx = int(item.split(":")[1])
                if idx < len(history):
                    msg = history[idx]
                    content = msg.get('content', '')
                    role = msg.get('role', '')
                    formatted = f"### {role.title()}\n{content}\n\n"
                    return tc.count(formatted) if formatted else 0
                return 0
            elif item.startswith("symbol:"):
                file_path = item.replace("symbol:", "")
                try:
                    si = self._get_symbol_index()
                    symbols = si.get_symbols(file_path)
                    if symbols:
                        from ..symbol_index.compact_format import format_file_symbol_block
                        ref_index = getattr(si, '_reference_index', None)
                        file_refs_data = {}
                        file_imports_data = {}
                        references_data = {}
                        if ref_index:
                            file_refs_data[file_path] = ref_index.get_files_referencing(file_path)
                            file_imports_data[file_path] = ref_index.get_file_dependencies(file_path)
                            references_data[file_path] = ref_index.get_references_to_file(file_path)
                        
                        block = format_file_symbol_block(
                            file_path=file_path,
                            symbols=symbols,
                            references=references_data,
                            file_refs=file_refs_data,
                            file_imports=file_imports_data,
                        )
                        return tc.count(block) if block else 0
                except Exception:
                    pass
                return 0
            else:
                content = self._get_file_content_safe(item)
                if content:
                    return tc.count(f"{item}\n```\n{content}\n```\n")
                return 0
        
        # --- Phase 1: Detect file/symbol churn for piggybacking ---
        
        file_symbol_items = set(file_paths or []) | {f"symbol:{f}" for f in (file_paths or [])}
        has_file_symbol_ripple = (
            self._last_active_file_symbol_items != file_symbol_items
        )
        self._last_active_file_symbol_items = file_symbol_items.copy()
        
        # --- Phase 2: Controlled graduation (files, symbols, history) ---
        # Items with N >= 3 that are still in active tier can graduate to L3.
        # For files/symbols: always graduate eligible items (stable files should cache).
        # For history: graduate on piggyback (ripple) or when token threshold is met.
        
        all_history = [f"history:{i}" for i in range(len(history))]
        cache_target = stability.get_cache_target_tokens()
        
        # Graduate eligible files and symbols (always - no reason to hold them back)
        active_file_symbols = set()
        for item in file_symbol_items:
            n_val = stability.get_n_value(item)
            tier = stability.get_tier(item)
            if n_val >= 3 and tier == 'active':
                # Eligible: exclude from active so it leaves and enters L3
                pass
            else:
                active_file_symbols.add(item)
        
        if not cache_target:
            # Graduation disabled — all history stays active (original behavior)
            active_history = all_history
        else:
            # Find eligible history: any history still in active tier.
            # History messages are immutable (content never changes), so unlike
            # files/symbols there's no need to wait for N >= 3 to confirm stability.
            eligible = [
                h for h in all_history
                if stability.get_tier(h) == 'active'
            ]
            
            # File/symbol graduation counts as a ripple for piggybacking
            has_graduation_ripple = has_file_symbol_ripple or (
                active_file_symbols != file_symbol_items
            )
            
            if has_graduation_ripple and eligible:
                # Piggyback: ripple already happening from file/symbol churn,
                # graduate all eligible history at zero additional cache cost
                graduated = set(eligible)
                active_history = [h for h in all_history if h not in graduated]
            elif eligible:
                # Check token threshold for standalone graduation
                eligible_tokens = sum(get_item_tokens(item) for item in eligible)
                if eligible_tokens >= cache_target:
                    # Graduate oldest, keeping recent cache_target worth active
                    graduated = self._select_history_to_graduate(
                        eligible, get_item_tokens, cache_target
                    )
                    active_history = [h for h in all_history if h not in graduated]
                else:
                    # Not enough tokens to justify a cache block
                    active_history = all_history
            else:
                # Nothing eligible yet
                active_history = all_history
        
        # --- Phase 3: Build active items list and update tracker ---
        
        active_items = list(active_file_symbols) + active_history
        
        # Determine modified items (files that were edited)
        modified_items = list(files_modified) if files_modified else []
        modified_items.extend([f"symbol:{f}" for f in (files_modified or [])])
        
        stability.update_after_response(
            items=active_items,
            get_content=get_item_content,
            modified=modified_items,
            get_tokens=get_item_tokens,
            broken_tiers=stale_broken_tiers,
        )
        
        # --- Phase 4: Log promotions and demotions ---
        
        promotions = stability.get_last_promotions()
        demotions = stability.get_last_demotions()
        
        if promotions:
            promoted_display = []
            for item, tier in promotions:
                if item.startswith("symbol:"):
                    display_name = f"📦 {item[7:]}"
                elif item.startswith("history:"):
                    display_name = f"💬 msg {item[8:]}"
                else:
                    display_name = item
                promoted_display.append(f"{display_name}→{tier}")
            print(f"📈 Promoted: {', '.join(promoted_display)}")
        
        if demotions:
            demoted_display = []
            for item, tier in demotions:
                if item.startswith("symbol:"):
                    display_name = f"📦 {item[7:]}"
                elif item.startswith("history:"):
                    display_name = f"💬 msg {item[8:]}"
                else:
                    display_name = item
                demoted_display.append(f"{display_name}→{tier}")
            print(f"📉 Demoted: {', '.join(demoted_display)}")
    
    def _select_history_to_graduate(self, eligible, get_tokens, keep_tokens):
        """Select which eligible history messages to graduate from active.
        
        Keeps the most recent `keep_tokens` worth of eligible messages in
        active (they're most likely to be referenced by the LLM). Graduates
        the rest (older messages) so they enter L3 via ripple promotion.
        
        Args:
            eligible: History item keys sorted by index ascending (oldest first)
            get_tokens: Callable to get token count for an item
            keep_tokens: Token budget to keep in active
            
        Returns:
            Set of items to graduate (exclude from active_items)
        """
        kept_tokens = 0
        keep_set = set()
        
        # Walk from newest to oldest, accumulating a "keep" budget
        for item in reversed(eligible):
            item_tokens = get_tokens(item)
            if kept_tokens + item_tokens <= keep_tokens:
                kept_tokens += item_tokens
                keep_set.add(item)
            else:
                break  # Budget exhausted, graduate the rest
        
        return set(eligible) - keep_set
    
    def _fire_stream_chunk(self, request_id, content, loop):
        """Fire stream chunk send (non-blocking, fire-and-forget).
        
        Each chunk carries the full accumulated content, so dropped or
        reordered chunks are harmless — the next chunk supersedes it.
        Only streamComplete needs reliable delivery.
        
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
    
    def _print_streaming_hud(self, messages, file_paths, context_map_tokens=0, symbol_map_info=None, tier_info=None):
        """Print HUD after streaming completes and return breakdown for frontend."""
        try:
            if not self._context_manager:
                return None
            
            ctx = self._context_manager
            
            # Count tokens in different parts (fallback if tier_info not available)
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
            
            # Get cache hit info for percentage calculation
            cache_hit = 0
            cache_write = 0
            if hasattr(self, '_last_request_tokens') and self._last_request_tokens:
                cache_hit = self._last_request_tokens.get('cache_hit', 0)
                cache_write = self._last_request_tokens.get('cache_write', 0)
            
            # Print cache blocks HUD if tier_info available
            if tier_info:
                self._print_cache_blocks(tier_info, cache_hit, total_tokens)
            
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
            result = {
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
            
            # Add tier info if available
            if tier_info:
                result["tier_info"] = tier_info
            
            return result
                
        except Exception as e:
            import traceback
            print(f"⚠️ HUD error: {e}")
            traceback.print_exc()
            return None
    
    def _print_cache_blocks(self, tier_info, cache_hit_tokens, total_tokens):
        """Print the unified cache blocks display.
        
        Args:
            tier_info: Dict with per-tier token counts and content summaries
            cache_hit_tokens: Tokens that hit the cache
            total_tokens: Total tokens in the request
        """
        # Calculate totals
        cached_tokens = sum(tier_info[t]['tokens'] for t in CACHE_TIERS)
        
        # Calculate cache hit percentage
        cache_pct = 0
        if total_tokens > 0 and cache_hit_tokens > 0:
            cache_pct = min(100, int(cache_hit_tokens * 100 / total_tokens))
        
        # Print header
        print(f"\n╭─ Cache Blocks {'─' * 38}╮")
        
        # Print each tier
        for tier in TIER_ORDER:
            info = tier_info[tier]
            tokens = info['tokens']
            
            # Build contents description
            contents = []
            if tier == 'L0':
                if info.get('has_system'):
                    contents.append('system')
                if info.get('has_legend'):
                    contents.append('legend')
            
            if info['symbols'] > 0:
                contents.append(f"{info['symbols']} symbols")
            if info['files'] > 0:
                contents.append(f"{info['files']} file{'s' if info['files'] != 1 else ''}")
            if info.get('history', 0) > 0:
                contents.append(f"{info['history']} history msg{'s' if info['history'] != 1 else ''}")
            if info.get('has_tree'):
                contents.append('tree')
            if info.get('has_urls'):
                contents.append('urls')
            if info.get('has_history'):
                contents.append('history')
            
            # Format tier line
            if tier == 'active':
                tier_label = "active"
                cached_str = ""
            else:
                threshold = TIER_THRESHOLDS[tier]
                tier_label = f"{tier} ({threshold}+)"
                cached_str = " [cached]"
            
            # Skip empty non-L0 tiers in display (but track them)
            if tokens == 0 and tier != 'L0':
                continue
            
            # Print tier header
            print(f"│ {tier_label:<12} {tokens:>6,} tokens{cached_str:<10} │")
            
            # Print contents if any
            if contents:
                contents_str = ' + '.join(contents)
                # Truncate if too long
                if len(contents_str) > 45:
                    contents_str = contents_str[:42] + '...'
                print(f"│   └─ {contents_str:<46} │")
        
        # Print separator and totals
        print(f"├{'─' * 53}┤")
        
        # Calculate total and show cache hit info
        all_tokens = sum(tier_info[t]['tokens'] for t in TIER_ORDER)
        print(f"│ Total: {all_tokens:,} tokens | Cache hit: {cache_pct}%{' ' * (24 - len(str(all_tokens)) - len(str(cache_pct)))}│")
        
        # Show empty tiers if any
        empty_this = tier_info.get('empty_tiers', 0)
        empty_session = self._session_empty_tier_count
        if empty_this > 0 or empty_session > 0:
            print(f"│ Empty tiers skipped: {empty_this} (session total: {empty_session}){' ' * (14 - len(str(empty_this)) - len(str(empty_session)))}│")
        
        print(f"╰{'─' * 53}╯")
    
    async def _send_compaction_event(self, request_id, event, loop):
        """Send compaction event to the client."""
        try:
            if hasattr(self, 'get_call'):
                call = self.get_call()
                if call and 'PromptView.compactionEvent' in call:
                    await asyncio.wait_for(
                        call['PromptView.compactionEvent'](request_id, event),
                        timeout=5.0
                    )
        except asyncio.TimeoutError:
            print(f"⚠️ compactionEvent timed out for {request_id}")
        except Exception as e:
            print(f"Error sending compaction event: {e}")

    async def _send_stream_complete(self, request_id, result):
        """Send stream completion to the client."""
        try:
            if hasattr(self, 'get_call'):
                call = self.get_call()
                if call and 'PromptView.streamComplete' in call:
                    await asyncio.wait_for(
                        call['PromptView.streamComplete'](request_id, result),
                        timeout=5.0
                    )
        except asyncio.TimeoutError:
            print(f"⚠️ streamComplete timed out for {request_id}")
        except Exception as e:
            print(f"Error sending stream complete: {e}")
            import traceback
            traceback.print_exc()

    async def _run_post_response_compaction(self, request_id):
        """
        Run history compaction after response is complete.
        
        This runs compaction during "idle" time after the user has received
        their response, so it doesn't block the main request. The compacted
        history will benefit the next request.
        """
        if not self._context_manager:
            return
        
        if not self._context_manager.should_compact():
            return
        
        try:
            # Give frontend time to process streamComplete before starting compaction
            await asyncio.sleep(0.5)
            
            # Notify frontend that compaction is starting
            await self._send_compaction_event(request_id, {
                'type': 'compaction_start',
                'message': '🗜️ Compacting history...'
            }, asyncio.get_running_loop())
            
            # Run compaction in executor to not block the event loop
            loop = asyncio.get_running_loop()
            compaction_result = await loop.run_in_executor(
                None,
                self._context_manager.compact_history_if_needed_sync
            )
            
            if compaction_result and compaction_result.case != "none":
                print(f"📝 History compacted: {compaction_result.case} "
                      f"({compaction_result.tokens_before}→{compaction_result.tokens_after} tokens)")
                
                # Re-register history items after compaction
                # Old history:* entries are purged, new ones will register on next request
                if self._context_manager:
                    self._context_manager.reregister_history_items()
                
                # Build the compacted messages for the frontend
                # Format: list of {role, content} dicts
                frontend_messages = []
                for msg in compaction_result.compacted_messages:
                    frontend_messages.append({
                        'role': msg.get('role', 'user'),
                        'content': msg.get('content', '')
                    })
                
                await self._send_compaction_event(request_id, {
                    'type': 'compaction_complete',
                    'case': compaction_result.case,
                    'tokens_before': compaction_result.tokens_before,
                    'tokens_after': compaction_result.tokens_after,
                    'tokens_saved': compaction_result.tokens_before - compaction_result.tokens_after,
                    'topic_detected': compaction_result.topic_detected,
                    'boundary_index': compaction_result.boundary_index,
                    'truncated_count': compaction_result.truncated_count,
                    'compacted_messages': frontend_messages,
                }, loop)
            else:
                # Compaction wasn't needed after all
                await self._send_compaction_event(request_id, {
                    'type': 'compaction_complete',
                    'case': 'none',
                    'tokens_before': 0,
                    'tokens_after': 0,
                    'tokens_saved': 0,
                }, loop)
                
        except Exception as e:
            print(f"⚠️ History compaction failed: {e}")
            import traceback
            traceback.print_exc()
            
            await self._send_compaction_event(request_id, {
                'type': 'compaction_error',
                'error': str(e),
            }, asyncio.get_running_loop())
