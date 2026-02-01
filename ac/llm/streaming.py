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
    
    # Session-level tracking for empty tier statistics
    _session_empty_tier_count = 0
    
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
                    indexer = self._get_indexer()
                    symbol_index = indexer._get_symbol_index()
                    for modified_file in apply_result.files_modified:
                        symbol_index.invalidate_file(modified_file)
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
                stability = self._context_manager.cache_stability
                tc = self._context_manager.token_counter
                
                # Collect items currently in Active context:
                # - Files explicitly in file_paths
                # - Symbol entries ONLY for files in file_paths (not all indexed files)
                # 
                # Symbol entries for files NOT in active context should NOT be in items list.
                # They were registered during _build_streaming_messages and will "leave" Active
                # when not included here, triggering ripple promotion.
                active_items = []
                
                # Add file paths that are in active context
                if file_paths:
                    active_items.extend(file_paths)
                    # Add symbol entries only for files in active context
                    active_items.extend([f"symbol:{f}" for f in file_paths])
                
                def get_item_content(item):
                    """Get content for stability hashing - files or symbol blocks."""
                    if item.startswith("symbol:"):
                        # Symbol entry - compute hash from symbols
                        file_path = item.replace("symbol:", "")
                        try:
                            indexer = self._get_indexer()
                            symbols = indexer._get_symbol_index().get_symbols(file_path)
                            if symbols:
                                return compute_file_block_hash(file_path, symbols)
                        except Exception:
                            pass
                        return None
                    else:
                        # Regular file
                        return self.repo.get_file_content(item, version='working')
                
                def get_item_tokens(item):
                    """Get token count for an item - files or symbol blocks."""
                    if item.startswith("symbol:"):
                        # Symbol entry - count tokens in formatted block
                        file_path = item.replace("symbol:", "")
                        try:
                            indexer = self._get_indexer()
                            symbol_index = indexer._get_symbol_index()
                            symbols = symbol_index.get_symbols(file_path)
                            if symbols:
                                from ..symbol_index.compact_format import format_file_symbol_block
                                # Get reference data for formatting
                                ref_index = getattr(symbol_index, '_reference_index', None)
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
                        # Regular file - count tokens in formatted content
                        try:
                            content = self.repo.get_file_content(item, version='working')
                            if content and not (isinstance(content, dict) and 'error' in content):
                                return tc.count(f"{item}\n```\n{content}\n```\n")
                        except Exception:
                            pass
                        return 0
                
                # Determine modified items (files that were edited)
                modified_items = list(files_modified) if files_modified else []
                # Symbol entries for modified files are also considered modified
                modified_items.extend([f"symbol:{f}" for f in (files_modified or [])])
                
                # Pass only active context items - the tracker will:
                # 1. Keep these items as 'active' with N=0
                # 2. Move previously-active items that aren't in this list to L3
                # 3. Trigger ripple promotions for existing L3/L2/L1 items
                # 4. With cache_target_tokens > 0: use threshold-aware promotion
                tier_changes = stability.update_after_response(
                    items=active_items,
                    get_content=get_item_content,
                    modified=modified_items,
                    get_tokens=get_item_tokens,
                )
                
                # Log promotions and demotions
                promotions = stability.get_last_promotions()
                demotions = stability.get_last_demotions()
                
                if promotions:
                    # Format nicely, stripping symbol: prefix for display
                    promoted_display = []
                    for item, tier in promotions:
                        display_name = item.replace("symbol:", "📦 ") if item.startswith("symbol:") else item
                        promoted_display.append(f"{display_name}→{tier}")
                    print(f"📈 Promoted: {', '.join(promoted_display)}")
                
                if demotions:
                    demoted_display = []
                    for item, tier in demotions:
                        display_name = item.replace("symbol:", "📦 ") if item.startswith("symbol:") else item
                        demoted_display.append(f"{display_name}→{tier}")
                    print(f"📉 Demoted: {', '.join(demoted_display)}")
            
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
                
                # Include promotions/demotions from stability tracker
                if self._context_manager and self._context_manager.cache_stability:
                    stability = self._context_manager.cache_stability
                    result["token_usage"]["promotions"] = stability.get_last_promotions()
                    result["token_usage"]["demotions"] = stability.get_last_demotions()
            
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
        tier_info = {
            'L0': {'tokens': 0, 'symbols': 0, 'files': 0, 'has_system': False, 'has_legend': False, 'has_tree': False},
            'L1': {'tokens': 0, 'symbols': 0, 'files': 0, 'has_tree': False},
            'L2': {'tokens': 0, 'symbols': 0, 'files': 0, 'has_tree': False},
            'L3': {'tokens': 0, 'symbols': 0, 'files': 0, 'has_tree': False},
            'active': {'tokens': 0, 'symbols': 0, 'files': 0, 'has_tree': False, 'has_urls': False, 'has_history': False},
            'empty_tiers': 0,
        }
        
        # Get stability tracker
        stability = None
        if self._context_manager:
            stability = self._context_manager.cache_stability
        
        # Determine which files are in active context (full content will be included)
        # Normalize paths to ensure consistent matching
        active_context_files = set(str(p).replace('\\', '/') for p in file_paths) if file_paths else set()
        
        # Get file tiers from stability tracker
        file_tiers = {'L0': [], 'L1': [], 'L2': [], 'L3': [], 'active': []}
        if file_paths and stability:
            file_tiers = stability.get_items_by_tier(file_paths)
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
        
        # Log tier distribution for files
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
        
        # Build system prompt
        system_text = build_system_prompt()
        
        # Get symbol map data with per-file stability tracking
        symbol_map_content = {}  # tier -> content string
        legend = ""
        symbol_files_by_tier = {}  # tier -> list of file paths
        
        if use_repo_map and self.repo:
            # Get all trackable files and their symbols
            all_files = self._get_all_trackable_files()
            if all_files:
                indexer = self._get_indexer()
                symbols_by_file = indexer.index_files(all_files)
                
                # Build references for cross-file information
                indexer.build_references(all_files)
                symbol_index = indexer._get_symbol_index()
                
                # Get reference data
                file_refs = {}
                file_imports = {}
                references = {}
                if hasattr(symbol_index, '_reference_index') and symbol_index._reference_index:
                    ref_index = symbol_index._reference_index
                    for f in all_files:
                        file_refs[f] = ref_index.get_files_referencing(f)
                        file_imports[f] = ref_index.get_file_dependencies(f)
                        references[f] = ref_index.get_references_to_file(f)
                
                # Initialize stability tracker from refs if fresh start
                if stability and not stability.is_initialized():
                    # Build files_with_refs from file_refs counts with token information
                    # Format: (path, ref_count, tokens)
                    tc = self._context_manager.token_counter
                    
                    files_with_refs = []
                    for f in all_files:
                        ref_count = len(file_refs.get(f, set()))
                        # Estimate tokens for file (will be refined on first access)
                        try:
                            content = self.repo.get_file_content(f, version='working')
                            if content and not (isinstance(content, dict) and 'error' in content):
                                tokens = tc.count(f"{f}\n```\n{content}\n```\n")
                            else:
                                tokens = 0
                        except Exception:
                            tokens = 0
                        files_with_refs.append((f, ref_count, tokens))
                    
                    # Also include symbol entries with their formatted block tokens
                    for f in symbols_by_file.keys():
                        ref_count = len(file_refs.get(f, set()))
                        try:
                            from ..symbol_index.compact_format import format_file_symbol_block
                            block = format_file_symbol_block(
                                file_path=f,
                                symbols=symbols_by_file[f],
                                references=references,
                                file_refs=file_refs,
                                file_imports=file_imports,
                                aliases=aliases,
                            )
                            tokens = tc.count(block) if block else 0
                        except Exception:
                            tokens = 0
                        files_with_refs.append((f"symbol:{f}", ref_count, tokens))
                    
                    # Exclude currently active context files
                    tier_assignments = stability.initialize_from_refs(
                        files_with_refs,
                        exclude_active=active_context_files,
                        target_tokens=stability.get_cache_target_tokens(),
                    )
                    if tier_assignments:
                        print(f"📊 Initialized {len(tier_assignments)} items from ref counts")
                
                # Compute path aliases for the legend
                aliases = _compute_path_aliases(references, file_refs)
                
                # Get legend (goes in L0, static)
                legend = get_legend(aliases)
                
                # Get symbol entry tiers from stability tracker
                # Symbol entries use "symbol:" prefix to distinguish from file paths
                symbol_items = [f"symbol:{f}" for f in symbols_by_file.keys()]
                symbol_tiers = {'L0': [], 'L1': [], 'L2': [], 'L3': [], 'active': []}
                
                if stability:
                    symbol_tiers = stability.get_items_by_tier(symbol_items)
                    for tier in ['L0', 'L1', 'L2', 'L3', 'active']:
                        if tier not in symbol_tiers:
                            symbol_tiers[tier] = []
                    
                    # Any symbols not yet tracked go to L3 (initial tier)
                    tracked = set()
                    for tier_items in symbol_tiers.values():
                        tracked.update(tier_items)
                    for item in symbol_items:
                        if item not in tracked:
                            symbol_tiers['L3'].append(item)
                else:
                    # No stability tracker - all symbols go to L3
                    symbol_tiers['L3'] = symbol_items
                
                # Convert symbol item keys back to file paths for formatting
                symbol_files_by_tier = {}
                for tier, items in symbol_tiers.items():
                    symbol_files_by_tier[tier] = [
                        item.replace("symbol:", "") for item in items
                        if item.startswith("symbol:")
                    ]
                
                # Exclude symbol entries for files that are in active context
                # (their full content will be included instead)
                for tier in symbol_files_by_tier:
                    symbol_files_by_tier[tier] = [
                        f for f in symbol_files_by_tier[tier]
                        if f not in active_context_files
                    ]
                
                # Format symbol blocks by tier
                symbol_map_content = format_symbol_blocks_by_tier(
                    symbols_by_file=symbols_by_file,
                    file_tiers=symbol_files_by_tier,
                    references=references,
                    file_refs=file_refs,
                    file_imports=file_imports,
                    aliases=aliases,
                    exclude_files=active_context_files,
                )
                
                # Log symbol tier distribution
                tier_counts = []
                for tier in ['L0', 'L1', 'L2', 'L3']:
                    count = len(symbol_files_by_tier.get(tier, []))
                    if count > 0:
                        tier_counts.append(f"{count} {tier}")
                if tier_counts:
                    print(f"📦 Symbol map: {', '.join(tier_counts)}")
        
        # Build cache blocks by tier
        # Block 1 (L0): system + legend + L0 symbols + L0 files (cached)
        l0_content = system_text
        tier_info['L0']['has_system'] = True
        if self._context_manager:
            try:
                tier_info['L0']['tokens'] += self._context_manager.count_tokens(system_text)
            except Exception:
                pass
        
        if legend:
            l0_content += "\n\n" + REPO_MAP_HEADER + legend + "\n"
            tier_info['L0']['has_legend'] = True
            if self._context_manager:
                try:
                    legend_tokens = self._context_manager.count_tokens(REPO_MAP_HEADER + legend)
                    tier_info['L0']['tokens'] += legend_tokens
                    context_map_tokens += legend_tokens
                except Exception:
                    pass
        
        if symbol_map_content.get('L0'):
            l0_content += "\n" + symbol_map_content['L0']
            tier_info['L0']['symbols'] = len(symbol_files_by_tier.get('L0', []))
            if self._context_manager:
                try:
                    l0_symbol_tokens = self._context_manager.count_tokens(symbol_map_content['L0'])
                    tier_info['L0']['tokens'] += l0_symbol_tokens
                    context_map_tokens += l0_symbol_tokens
                except Exception:
                    pass
        
        # Add L0 files to the L0 block
        if file_tiers.get('L0'):
            l0_files_content = self._format_files_for_cache(file_tiers['L0'], FILES_L0_HEADER)
            if l0_files_content:
                l0_content += "\n\n" + l0_files_content
                tier_info['L0']['files'] = len(file_tiers['L0'])
                if self._context_manager:
                    try:
                        tier_info['L0']['tokens'] += self._context_manager.count_tokens(l0_files_content)
                    except Exception:
                        pass
        
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
        
        # Block 2 (L1): L1 symbols + L1 files (cached)
        l1_parts = []
        if symbol_map_content.get('L1'):
            l1_parts.append(REPO_MAP_CONTINUATION + symbol_map_content['L1'])
            tier_info['L1']['symbols'] = len(symbol_files_by_tier.get('L1', []))
            if self._context_manager:
                try:
                    l1_symbol_tokens = self._context_manager.count_tokens(REPO_MAP_CONTINUATION + symbol_map_content['L1'])
                    tier_info['L1']['tokens'] += l1_symbol_tokens
                    context_map_tokens += l1_symbol_tokens
                except Exception:
                    pass
        if file_tiers.get('L1'):
            l1_files = self._format_files_for_cache(file_tiers['L1'], FILES_L1_HEADER)
            if l1_files:
                l1_parts.append(l1_files)
                tier_info['L1']['files'] = len(file_tiers['L1'])
                if self._context_manager:
                    try:
                        tier_info['L1']['tokens'] += self._context_manager.count_tokens(l1_files)
                    except Exception:
                        pass
        
        if l1_parts:
            l1_content = "\n\n".join(l1_parts)
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
        else:
            tier_info['empty_tiers'] += 1
        
        # Block 3 (L2): L2 symbols + L2 files (cached)
        l2_parts = []
        if symbol_map_content.get('L2'):
            l2_parts.append(REPO_MAP_CONTINUATION + symbol_map_content['L2'])
            tier_info['L2']['symbols'] = len(symbol_files_by_tier.get('L2', []))
            if self._context_manager:
                try:
                    l2_symbol_tokens = self._context_manager.count_tokens(REPO_MAP_CONTINUATION + symbol_map_content['L2'])
                    tier_info['L2']['tokens'] += l2_symbol_tokens
                    context_map_tokens += l2_symbol_tokens
                except Exception:
                    pass
        if file_tiers.get('L2'):
            l2_files = self._format_files_for_cache(file_tiers['L2'], FILES_L2_HEADER)
            if l2_files:
                l2_parts.append(l2_files)
                tier_info['L2']['files'] = len(file_tiers['L2'])
                if self._context_manager:
                    try:
                        tier_info['L2']['tokens'] += self._context_manager.count_tokens(l2_files)
                    except Exception:
                        pass
        
        if l2_parts:
            l2_content = "\n\n".join(l2_parts)
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
        else:
            tier_info['empty_tiers'] += 1
        
        # Block 4 (L3): L3 symbols + L3 files (cached)
        l3_parts = []
        if symbol_map_content.get('L3'):
            l3_parts.append(REPO_MAP_CONTINUATION + symbol_map_content['L3'])
            tier_info['L3']['symbols'] = len(symbol_files_by_tier.get('L3', []))
            if self._context_manager:
                try:
                    l3_symbol_tokens = self._context_manager.count_tokens(REPO_MAP_CONTINUATION + symbol_map_content['L3'])
                    tier_info['L3']['tokens'] += l3_symbol_tokens
                    context_map_tokens += l3_symbol_tokens
                except Exception:
                    pass
        if file_tiers.get('L3'):
            l3_files = self._format_files_for_cache(file_tiers['L3'], FILES_L3_HEADER)
            if l3_files:
                l3_parts.append(l3_files)
                tier_info['L3']['files'] = len(file_tiers['L3'])
                if self._context_manager:
                    try:
                        tier_info['L3']['tokens'] += self._context_manager.count_tokens(l3_files)
                    except Exception:
                        pass
        
        if l3_parts:
            l3_content = "\n\n".join(l3_parts)
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
                if self._context_manager:
                    try:
                        tier_info['active']['tokens'] += self._context_manager.count_tokens(url_message)
                    except Exception:
                        pass
        
        # Active files (recently changed) - not cached
        if file_tiers.get('active'):
            active_content = self._format_files_for_cache(file_tiers['active'], FILES_ACTIVE_HEADER)
            if active_content:
                messages.append({"role": "user", "content": active_content})
                messages.append({"role": "assistant", "content": "Ok."})
                tier_info['active']['files'] = len(file_tiers['active'])
                if self._context_manager:
                    try:
                        tier_info['active']['tokens'] += self._context_manager.count_tokens(active_content)
                    except Exception:
                        pass
        
        # Add conversation history
        if self.conversation_history:
            tier_info['active']['has_history'] = True
            if self._context_manager:
                try:
                    for msg in self.conversation_history:
                        tier_info['active']['tokens'] += self._context_manager.count_tokens(msg.get('content', ''))
                except Exception:
                    pass
        
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
        
        # Update session empty tier count
        StreamingMixin._session_empty_tier_count += tier_info['empty_tiers']
        
        return messages, user_prompt, context_map_tokens, tier_info
    
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
        # Tier thresholds for display
        thresholds = {'L0': 12, 'L1': 9, 'L2': 6, 'L3': 3}
        
        # Calculate totals
        cached_tokens = sum(tier_info[t]['tokens'] for t in ['L0', 'L1', 'L2', 'L3'])
        
        # Calculate cache hit percentage
        cache_pct = 0
        if total_tokens > 0 and cache_hit_tokens > 0:
            cache_pct = min(100, int(cache_hit_tokens * 100 / total_tokens))
        
        # Print header
        print(f"\n╭─ Cache Blocks {'─' * 38}╮")
        
        # Print each tier
        for tier in ['L0', 'L1', 'L2', 'L3', 'active']:
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
                threshold = thresholds[tier]
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
        all_tokens = sum(tier_info[t]['tokens'] for t in ['L0', 'L1', 'L2', 'L3', 'active'])
        print(f"│ Total: {all_tokens:,} tokens | Cache hit: {cache_pct}%{' ' * (24 - len(str(all_tokens)) - len(str(cache_pct)))}│")
        
        # Show empty tiers if any
        empty_this = tier_info.get('empty_tiers', 0)
        empty_session = StreamingMixin._session_empty_tier_count
        if empty_this > 0 or empty_session > 0:
            print(f"│ Empty tiers skipped: {empty_this} (session total: {empty_session}){' ' * (14 - len(str(empty_this)) - len(str(empty_session)))}│")
        
        print(f"╰{'─' * 53}╯")
    
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
