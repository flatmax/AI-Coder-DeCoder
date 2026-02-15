"""LLM service — streaming handler, state management, and RPC interface.

Manages the full lifecycle of LLM interactions:
- Streaming chat with chunk delivery
- Cancellation support
- Edit block parsing and application
- Commit message generation
- Session and file selection state
"""

import asyncio
import hashlib
import logging
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor

import litellm

from .context import ContextManager
from .edit_parser import (
    EditResult,
    EditStatus,
    apply_edits_to_repo,
    detect_shell_commands,
    parse_edit_blocks,
)
from .history_store import HistoryStore
from .stability_tracker import TIER_CONFIG, StabilityTracker, Tier
from .token_counter import TokenCounter
from .url_cache import URLCache
from .url_handler import URLService

logger = logging.getLogger(__name__)

# Commit message system prompt
COMMIT_PROMPT = (
    "You are an expert software engineer. Generate a git commit message for the "
    "following diff. Use conventional commit style with a type prefix (feat, fix, "
    "refactor, docs, test, chore, etc.). Use imperative mood. Subject line max 50 "
    "characters, body wrap at 72 characters. Output ONLY the commit message, no "
    "commentary or explanation."
)

# System reminder for edit format reinforcement (code constant, not loaded from file)
SYSTEM_REMINDER = (
    "Remember: use the edit block format exactly as specified. "
    "path/to/file.ext\\n"
    "\\u00ab\\u00ab\\u00ab EDIT\\n"
    "[old text]\\n"
    "\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550 REPL\\n"
    "[new text]\\n"
    "\\u00bb\\u00bb\\u00bb EDIT END"
)


def _extract_token_usage(response_or_chunk):
    """Extract token usage from LLM response, handling multiple provider formats.

    Uses dual-mode getter (attribute + key access) with fallback chains.
    """
    usage = {}

    def _get(obj, *keys):
        """Try multiple keys with both attribute and dict access."""
        for key in keys:
            # Attribute access
            val = getattr(obj, key, None)
            if val is not None:
                return val
            # Dict access
            if isinstance(obj, dict):
                val = obj.get(key)
                if val is not None:
                    return val
        return None

    # Try to find usage data
    usage_obj = _get(response_or_chunk, "usage")
    if usage_obj is None:
        return usage

    # Input tokens
    input_tokens = _get(usage_obj, "prompt_tokens", "input_tokens")
    if input_tokens is not None:
        usage["input_tokens"] = input_tokens

    # Output tokens
    output_tokens = _get(usage_obj, "completion_tokens", "output_tokens")
    if output_tokens is not None:
        usage["output_tokens"] = output_tokens

    # Cache read tokens — provider-specific fallback chain
    cache_read = _get(usage_obj, "cache_read_input_tokens", "cache_read_tokens")
    if cache_read is None:
        # Bedrock/OpenAI nested format
        details = _get(usage_obj, "prompt_tokens_details")
        if details:
            cache_read = _get(details, "cached_tokens")
    if cache_read is not None:
        usage["cache_read_tokens"] = cache_read

    # Cache write tokens
    cache_write = _get(usage_obj, "cache_creation_input_tokens", "cache_creation_tokens")
    if cache_write is not None:
        usage["cache_write_tokens"] = cache_write

    return usage


class LLMService:
    """RPC service for LLM interactions.

    Public methods are exposed as LLM.method_name RPC endpoints.
    """

    def __init__(self, config_manager, repo=None, symbol_index=None,
                 chunk_callback=None, event_callback=None):
        """Initialize LLM service.

        Args:
            config_manager: ConfigManager instance
            repo: Repo instance (optional)
            symbol_index: SymbolIndex instance (optional)
            chunk_callback: async fn(request_id, content) for streaming chunks
            event_callback: async fn(event_name, data) for lifecycle events
        """
        self._config = config_manager
        self._repo = repo
        self._symbol_index = symbol_index
        self._chunk_callback = chunk_callback
        self._event_callback = event_callback

        # Context manager
        self._context = ContextManager(
            model_name=config_manager.model,
            repo_root=str(repo.root) if repo else None,
            cache_target_tokens=config_manager.cache_target_tokens,
            compaction_config=config_manager.compaction_config,
            system_prompt=config_manager.get_system_prompt(),
        )

        # History store (persistent)
        self._history_store = None
        if repo:
            try:
                self._history_store = HistoryStore(str(repo.root))
            except Exception as e:
                logger.warning(f"Failed to initialize history store: {e}")

        # State
        self._selected_files = []
        self._streaming_active = False
        self._current_request_id = None
        self._cancelled_requests = set()
        self._session_id = self._new_session_id()
        self._executor = ThreadPoolExecutor(max_workers=2)

        # Stability tracker
        self._stability_tracker = StabilityTracker(
            cache_target_tokens=config_manager.cache_target_tokens,
        )
        self._context.set_stability_tracker(self._stability_tracker)
        self._stability_initialized = False

        # URL service
        self._url_service = self._init_url_service()

        # Session totals
        self._session_totals = {
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_read_tokens": 0,
            "cache_write_tokens": 0,
        }

        # Review mode state
        self._review_active = False
        self._saved_system_prompt = None  # original system prompt, saved during review
        self._review_branch = None
        self._review_branch_tip = None
        self._review_base_commit = None
        self._review_parent = None
        self._review_original_branch = None
        self._review_commits = []
        self._review_changed_files = []
        self._review_stats = {}
        self._symbol_map_before = None

    @staticmethod
    def _new_session_id():
        return f"sess_{int(time.time() * 1000)}_{uuid.uuid4().hex[:6]}"

    # === State Management (RPC) ===

    def get_current_state(self):
        """Return current session state."""
        return {
            "messages": self._context.get_history(),
            "selected_files": list(self._selected_files),
            "streaming_active": self._streaming_active,
            "session_id": self._session_id,
            "repo_name": self._repo.root.name if self._repo else None,
        }

    def set_selected_files(self, files):
        """Update selected file list. Returns copy."""
        self._selected_files = list(files)
        return list(self._selected_files)

    def get_selected_files(self):
        """Return independent copy of selected files."""
        return list(self._selected_files)

    def new_session(self):
        """Start a new session — clears history and generates new session ID."""
        self._context.clear_history()
        self._session_id = self._new_session_id()
        # Don't reset stability_initialized — symbol tiers persist across sessions
        # Only history items are purged (done by clear_history -> purge_history_items)
        return {"session_id": self._session_id}

    # === Streaming Chat (RPC) ===

    async def chat_streaming(self, request_id, message, files=None, images=None):
        """Start a streaming LLM chat.

        Args:
            request_id: unique request ID for callback correlation
            message: user message text
            files: list of file paths to include
            images: list of base64 image data URIs

        Returns:
            {status: "started"} immediately; results via streamComplete callback
        """
        if self._streaming_active:
            return {"error": "Another stream is active"}

        self._streaming_active = True
        self._current_request_id = request_id

        # Store the main event loop so callbacks can schedule on it
        self._main_loop = asyncio.get_event_loop()

        # Launch background task on the main event loop (not a nested one)
        asyncio.ensure_future(
            self._stream_chat(request_id, message, files or [], images or [])
        )

        return {"status": "started"}

    async def _stream_chat(self, request_id, message, files, images):
        """Background streaming task.

        Validates files, assembles prompt, streams response, parses edits.
        """
        result = {}
        full_content = ""

        try:
            # Validate and load files
            binary_files = []
            invalid_files = []

            # Remove files from context that are no longer selected
            current_context_files = set(self._context.file_context.get_files())
            selected_set = set(files)
            for path in current_context_files - selected_set:
                self._context.file_context.remove_file(path)

            for path in files:
                if self._repo and self._repo.is_binary_file(path):
                    binary_files.append(path)
                    continue
                if self._repo and not self._repo.file_exists(path):
                    invalid_files.append(path)
                    continue
                self._context.file_context.add_file(path)

            if binary_files or invalid_files:
                result["binary_files"] = binary_files
                result["invalid_files"] = invalid_files

            # Get symbol map and file tree
            symbol_map = ""
            symbol_legend = ""
            file_tree = ""

            if self._symbol_index:
                self._symbol_index.index_repo(
                    self._repo.get_flat_file_list() if self._repo else None
                )

                # Initialize stability tracker from reference graph on first request
                if not self._stability_initialized:
                    try:
                        ref_index = self._symbol_index.reference_index
                        all_files = list(self._symbol_index._all_symbols.keys())
                        self._stability_tracker.initialize_from_reference_graph(
                            ref_index, all_files, counter=self._context.counter,
                        )
                        self._stability_initialized = True
                        logger.info(f"Stability tracker initialized with {len(self._stability_tracker.items)} items")
                    except Exception as e:
                        logger.warning(f"Failed to initialize stability tracker: {e}")
                        self._stability_initialized = True  # don't retry

                symbol_map = self._symbol_index.get_symbol_map(
                    exclude_files=set(self._selected_files)
                )
                symbol_legend = self._symbol_index.get_legend()

            if self._repo:
                flat_files = self._repo.get_flat_file_list()
                file_tree = f"# File Tree ({len(flat_files)} files)\n\n" + "\n".join(flat_files)

            # Detect and fetch URLs from prompt (up to 3 per message)
            try:
                detected = self._url_service.detect_urls(message)
                urls_fetched = 0
                for url_info in detected:
                    if urls_fetched >= 3:
                        break
                    url = url_info["url"]
                    display = url_info.get("display_name", url)
                    # Skip already-fetched URLs
                    existing = self._url_service.get_url_content(url)
                    if existing.error == "URL not yet fetched":
                        # Notify client about fetch progress
                        if self._event_callback:
                            try:
                                await self._event_callback(
                                    "compactionEvent", request_id,
                                    {"stage": "url_fetch", "message": f"Fetching {display}..."},
                                )
                            except Exception:
                                pass
                        await self._url_service.fetch_url(
                            url, use_cache=True, summarize=True,
                            user_text=message,
                        )
                        urls_fetched += 1
                        if self._event_callback:
                            try:
                                await self._event_callback(
                                    "compactionEvent", request_id,
                                    {"stage": "url_ready", "message": f"Fetched {display}"},
                                )
                            except Exception:
                                pass
                # Update URL context on the context manager
                url_context_text = self._url_service.format_url_context()
                if url_context_text:
                    self._context.set_url_context(
                        [url_context_text]
                    )
            except Exception as e:
                logger.warning(f"URL detection/fetch failed: {e}")

            # Persist user message
            if self._history_store:
                try:
                    self._history_store.append_message(
                        session_id=self._session_id,
                        role="user",
                        content=message,
                        files=files if files else None,
                        images=images if images else None,
                    )
                except Exception as e:
                    logger.warning(f"Failed to persist user message: {e}")

            # Build and inject review context if review mode is active
            if self._review_active:
                try:
                    review_context = self._build_review_context()
                    if review_context:
                        self._context.set_review_context(review_context)
                except Exception as e:
                    logger.warning(f"Failed to build review context: {e}")

            # Budget enforcement
            shed = self._context.shed_files_if_needed()
            if shed:
                result["shed_files"] = shed

            # Assemble messages
            assembled = self._context.assemble_messages(
                user_prompt=message,
                images=images if images else None,
                symbol_map=symbol_map,
                symbol_legend=symbol_legend,
                file_tree=file_tree,
            )

            # Stream LLM completion
            full_content, was_cancelled, usage = await self._run_llm_stream(
                request_id, assembled
            )

            if was_cancelled:
                result["cancelled"] = True
                full_content = full_content + "\n\n[stopped]" if full_content else "[stopped]"

            # Add exchange to context
            self._context.add_exchange(message, full_content)

            # Update session totals
            for key in self._session_totals:
                self._session_totals[key] += usage.get(key, 0)

            # Estimate output tokens if not reported
            if "output_tokens" not in usage and full_content:
                usage["output_tokens"] = max(1, len(full_content) // 4)

            result["response"] = full_content
            result["token_usage"] = usage

            # Parse edit blocks
            blocks = parse_edit_blocks(full_content)
            if blocks:
                result["edit_blocks"] = [
                    {"file": b.file_path, "is_create": b.is_create}
                    for b in blocks
                ]

                # Apply edits (skipped in review mode — read-only)
                if self._repo and not was_cancelled and not self._review_active:
                    # Separate blocks by context membership
                    selected_set = set(self._selected_files)
                    in_context_blocks = []
                    not_in_context_blocks = []

                    for block in blocks:
                        # Create blocks are always attempted (no existing content needed)
                        if block.is_create:
                            in_context_blocks.append(block)
                        elif block.file_path in selected_set:
                            in_context_blocks.append(block)
                        else:
                            not_in_context_blocks.append(block)

                    # Apply in-context edits normally
                    edit_results = apply_edits_to_repo(
                        in_context_blocks, str(self._repo.root)
                    ) if in_context_blocks else []

                    # Mark not-in-context edits without attempting them
                    for block in not_in_context_blocks:
                        edit_results.append(EditResult(
                            file_path=block.file_path,
                            status=EditStatus.NOT_IN_CONTEXT,
                            message="File not in active context — added for next request",
                        ))

                    # Stage modified files
                    modified = []
                    for er in edit_results:
                        if er.status == EditStatus.APPLIED:
                            modified.append(er.file_path)
                            try:
                                self._repo.stage_files([er.file_path])
                            except Exception:
                                pass

                    # Invalidate symbol cache for modified files
                    if self._symbol_index:
                        for path in modified:
                            self._symbol_index.invalidate_file(path)

                    # Auto-add not-in-context files to selected files
                    files_auto_added = []
                    if not_in_context_blocks:
                        for block in not_in_context_blocks:
                            if block.file_path not in selected_set:
                                self._selected_files.append(block.file_path)
                                selected_set.add(block.file_path)
                                files_auto_added.append(block.file_path)

                        # Broadcast updated selection to browser
                        if files_auto_added and self._event_callback:
                            try:
                                await self._event_callback(
                                    "filesChanged", list(self._selected_files)
                                )
                            except Exception as e:
                                logger.warning(f"Failed to broadcast filesChanged: {e}")

                    result["files_modified"] = modified
                    result["passed"] = sum(1 for r in edit_results if r.status == EditStatus.APPLIED)
                    result["failed"] = sum(1 for r in edit_results if r.status == EditStatus.FAILED)
                    result["skipped"] = sum(1 for r in edit_results if r.status == EditStatus.SKIPPED)
                    result["not_in_context"] = sum(1 for r in edit_results if r.status == EditStatus.NOT_IN_CONTEXT)
                    if files_auto_added:
                        result["files_auto_added"] = files_auto_added
                    result["edit_results"] = [
                        {
                            "file": r.file_path,
                            "status": r.status.value,
                            "message": r.message,
                        }
                        for r in edit_results
                    ]

            # Persist assistant message
            if self._history_store:
                try:
                    self._history_store.append_message(
                        session_id=self._session_id,
                        role="assistant",
                        content=full_content,
                        files_modified=result.get("files_modified"),
                        edit_results=result.get("edit_results"),
                    )
                except Exception as e:
                    logger.warning(f"Failed to persist assistant message: {e}")

            # Update cache stability
            try:
                self._update_stability()
            except Exception as e:
                logger.warning(f"Stability update failed: {e}")

            # Detect shell commands
            shell_cmds = detect_shell_commands(full_content)
            if shell_cmds:
                result["shell_commands"] = shell_cmds

            # Save symbol map
            if self._symbol_index and self._repo:
                try:
                    ac_dc_dir = self._repo.root / ".ac-dc"
                    ac_dc_dir.mkdir(exist_ok=True)
                    self._symbol_index.save_symbol_map(
                        ac_dc_dir / "symbol_map.txt",
                        exclude_files=set(self._selected_files),
                    )
                except Exception as e:
                    logger.warning(f"Failed to save symbol map: {e}")

            # Print terminal HUD
            self._print_hud(usage)

        except Exception as e:
            logger.error(f"Streaming error: {traceback.format_exc()}")
            result["error"] = str(e)
            result["response"] = full_content

        finally:
            self._streaming_active = False
            self._current_request_id = None
            self._cancelled_requests.discard(request_id)

            # Send streamComplete
            if self._event_callback:
                try:
                    await self._event_callback("streamComplete", request_id, result)
                except Exception as e:
                    logger.error(f"streamComplete callback failed: {e}")

            # Post-response compaction
            try:
                await self._context.compact_history_if_needed()
            except Exception as e:
                logger.warning(f"Compaction failed: {e}")

    async def _run_llm_stream(self, request_id, messages):
        """Run LLM completion with streaming in a thread pool.

        Returns (full_content, was_cancelled, usage).
        """
        full_content = ""
        was_cancelled = False
        usage = {}

        loop = self._main_loop

        def _stream_sync():
            nonlocal full_content, was_cancelled, usage
            try:
                response = litellm.completion(
                    model=self._config.model,
                    messages=messages,
                    stream=True,
                    stream_options={"include_usage": True},
                )

                for chunk in response:
                    # Check cancellation
                    if request_id in self._cancelled_requests:
                        was_cancelled = True
                        break

                    # Extract content delta
                    delta = None
                    if hasattr(chunk, "choices") and chunk.choices:
                        choice = chunk.choices[0]
                        if hasattr(choice, "delta") and choice.delta:
                            delta = getattr(choice.delta, "content", None)

                    if delta:
                        full_content += delta

                        # Fire chunk callback (full accumulated content)
                        if self._chunk_callback:
                            try:
                                asyncio.run_coroutine_threadsafe(
                                    self._chunk_callback(request_id, full_content),
                                    loop,
                                )
                            except Exception:
                                pass

                    # Track usage from any chunk that has it
                    chunk_usage = _extract_token_usage(chunk)
                    if chunk_usage:
                        usage.update(chunk_usage)

            except Exception as e:
                logger.error(f"LLM stream error: {e}")
                raise

        await loop.run_in_executor(self._executor, _stream_sync)
        return full_content, was_cancelled, usage

    def cancel_streaming(self, request_id):
        """Cancel an active stream."""
        if self._current_request_id == request_id:
            self._cancelled_requests.add(request_id)
            return {"success": True}
        return {"error": f"No active stream with request_id {request_id}"}

    # === Stability Update ===

    def _update_stability(self):
        """Run the per-request stability update cycle.

        Builds the active items list and calls tracker.update() to drive
        N-value progression, graduation, and cascade.
        """
        if not self._stability_tracker:
            return

        counter = self._context.counter
        active_items = []

        # File entries for selected files
        for path in self._selected_files:
            content = self._context.file_context.get_content(path)
            if content is not None:
                active_items.append({
                    "key": f"file:{path}",
                    "content_hash": StabilityTracker.hash_content(content),
                    "tokens": counter.count(content),
                })

        # Symbol entries for selected files
        if self._symbol_index:
            for path in self._selected_files:
                block = self._symbol_index.get_file_symbol_block(path)
                if block:
                    active_items.append({
                        "key": f"symbol:{path}",
                        "content_hash": StabilityTracker.hash_content(block),
                        "tokens": counter.count(block),
                    })

        # History entries
        history = self._context.get_history()
        for i, msg in enumerate(history):
            content_str = f"{msg['role']}:{msg.get('content', '')}"
            active_items.append({
                "key": f"history:{i}",
                "content_hash": StabilityTracker.hash_content(content_str),
                "tokens": counter.count_message(msg),
            })

        # Existing files for stale removal
        existing_files = None
        if self._repo:
            try:
                existing_files = set(self._repo.get_flat_file_list())
            except Exception:
                pass

        # Run update cycle
        result = self._stability_tracker.update(active_items, existing_files)

        # Log tier changes
        for change in result.get("changes", []):
            action = change.get("action", "")
            key = change.get("key", "")
            if action in ("promoted", "graduated"):
                logger.info(f"📈 {change.get('from', '?')} → {change.get('to', '?')}: {key}")
            elif action in ("demoted", "demoted_underfilled"):
                logger.info(f"📉 {change.get('from', '?')} → {change.get('to', '?')}: {key}")

    # === Commit Message Generation (RPC) ===

    def generate_commit_message(self, diff_text):
        """Generate a commit message from a diff using a non-streaming LLM call.

        Uses smaller_model if configured, falling back to primary model.

        Args:
            diff_text: git diff text

        Returns:
            {message: str} or {error: str}
        """
        if not diff_text or not diff_text.strip():
            return {"error": "Empty diff"}

        try:
            model = self._config.smaller_model or self._config.model
            response = litellm.completion(
                model=model,
                messages=[
                    {"role": "system", "content": COMMIT_PROMPT},
                    {"role": "user", "content": diff_text},
                ],
                stream=False,
            )
            message = response.choices[0].message.content.strip()
            return {"message": message}
        except Exception as e:
            logger.error(f"Commit message generation failed: {e}")
            return {"error": str(e)}

    # === Context Breakdown (RPC) ===

    @staticmethod
    def _tier_content_breakdown(tier_items):
        """Break down tier items into individual entries with N values and thresholds.

        Returns list of per-item dicts with {type, name, path, tokens, n, threshold}.
        """
        contents = []
        for key, item in tier_items.items():
            if key.startswith("file:"):
                item_type = "files"
                path = key.split(":", 1)[1]
                name = path
            elif key.startswith("symbol:"):
                item_type = "symbols"
                path = key.split(":", 1)[1]
                name = path
            elif key.startswith("history:"):
                item_type = "history"
                path = None
                name = f"Message {key.split(':', 1)[1]}"
            else:
                item_type = "other"
                path = None
                name = key

            # Get promotion threshold for this item's tier
            tier_config = TIER_CONFIG.get(item.tier)
            threshold = tier_config["promotion_n"] if tier_config else None

            contents.append({
                "type": item_type,
                "name": name,
                "path": path,
                "tokens": item.tokens,
                "n": item.n,
                "threshold": threshold,
            })

        # Sort: symbols first, then files, then history, then other; within each by name
        type_order = {"symbols": 0, "files": 1, "history": 2, "other": 3}
        contents.sort(key=lambda c: (type_order.get(c["type"], 99), c["name"] or ""))
        return contents

    def get_context_breakdown(self):
        """Return token breakdown for current context.

        Syncs FileContext with current selected files before computing,
        so the breakdown reflects what the next request would look like.

        Returns detailed per-item data for each category:
        - Per-file paths and token counts
        - Per-URL title and token counts
        - Symbol map chunk details
        - History message count and tokens
        """
        # Sync FileContext with current selection
        if self._repo:
            current_context_files = set(self._context.file_context.get_files())
            selected_set = set(self._selected_files)
            for path in current_context_files - selected_set:
                self._context.file_context.remove_file(path)
            for path in selected_set:
                if path not in current_context_files:
                    if not self._repo.is_binary_file(path) and self._repo.file_exists(path):
                        self._context.file_context.add_file(path)

        counter = self._context.counter

        system_tokens = counter.count(self._config.get_system_prompt())
        legend_tokens = 0
        if self._symbol_index:
            legend = self._symbol_index.get_legend()
            if legend:
                legend_tokens = counter.count(legend)

        symbol_map_tokens = 0
        symbol_map_chunks = []
        if self._symbol_index:
            sm = self._symbol_index.get_symbol_map(
                exclude_files=set(self._selected_files)
            )
            if sm:
                symbol_map_tokens = counter.count(sm)
            # Get chunked symbol map for per-chunk detail breakdown
            try:
                sm_chunks_raw = self._symbol_index.get_symbol_map(
                    exclude_files=set(self._selected_files),
                    chunks=4,
                )
                if sm_chunks_raw and isinstance(sm_chunks_raw, list):
                    for i, chunk in enumerate(sm_chunks_raw):
                        if not chunk:
                            continue
                        chunk_tokens = counter.count(chunk)
                        # Estimate file count from path-like lines
                        lines = chunk.strip().split('\n')
                        file_count = sum(
                            1 for line in lines
                            if line and not line.startswith(' ') and not line.startswith('#')
                            and ':' in line
                        )
                        symbol_map_chunks.append({
                            "name": f"Chunk {i + 1} ({file_count} files)",
                            "tokens": chunk_tokens,
                        })
            except Exception as e:
                logger.debug(f"Symbol map chunking failed: {e}")

        # Per-file token counts
        file_tokens = self._context.file_context.count_tokens(counter)
        file_details = []
        tokens_by_file = self._context.file_context.get_tokens_by_file(counter)
        for path in sorted(tokens_by_file.keys()):
            file_details.append({
                "name": path,
                "path": path,
                "tokens": tokens_by_file[path],
            })

        # Per-URL token counts
        url_tokens = 0
        url_details = []
        if self._url_service:
            for url_content in self._url_service.get_fetched_urls():
                if url_content.error:
                    continue
                formatted = url_content.format_for_prompt(max_length=50000)
                tok = counter.count(formatted) if formatted else 0
                url_tokens += tok
                url_details.append({
                    "name": url_content.title or url_content.url,
                    "url": url_content.url,
                    "tokens": tok,
                })

        # History details
        history_tokens = self._context.history_token_count()
        history = self._context.get_history()
        history_msg_count = len(history)

        total = system_tokens + symbol_map_tokens + file_tokens + url_tokens + history_tokens

        # Cache tier blocks for HUD visualization
        blocks = []
        cached_tokens = 0
        tracker = self._context._stability_tracker
        if tracker:
            for tier in [Tier.L0, Tier.L1, Tier.L2, Tier.L3]:
                tier_items = tracker.get_tier_items(tier)
                if tier_items:
                    tier_tokens = sum(i.tokens for i in tier_items.values())
                    contents = self._tier_content_breakdown(tier_items)
                    blocks.append({
                        "name": tier.name,
                        "tier": tier.name,
                        "tokens": tier_tokens,
                        "count": len(tier_items),
                        "cached": True,
                        "contents": contents,
                    })
                    cached_tokens += tier_tokens
            active_items = tracker.get_tier_items(Tier.ACTIVE)
            if active_items:
                active_tokens = sum(i.tokens for i in active_items.values())
                contents = self._tier_content_breakdown(active_items)
                blocks.append({
                    "name": "active",
                    "tier": "active",
                    "tokens": active_tokens,
                    "count": len(active_items),
                    "cached": False,
                    "contents": contents,
                })

        # If no tracker, build a simple active block from known data
        if not blocks:
            contents = []
            if system_tokens:
                contents.append({"type": "system", "name": "System + Legend",
                                 "path": None,
                                 "tokens": system_tokens + legend_tokens,
                                 "n": None, "threshold": None})
            if symbol_map_tokens:
                contents.append({"type": "symbols", "name": "Symbol Map",
                                 "path": None,
                                 "tokens": symbol_map_tokens,
                                 "n": None, "threshold": None})
            if file_tokens:
                for fd in file_details:
                    contents.append({"type": "files", "name": fd["name"],
                                     "path": fd.get("path"),
                                     "tokens": fd["tokens"],
                                     "n": None, "threshold": None})
            if url_tokens:
                for ud in url_details:
                    contents.append({"type": "urls", "name": ud["name"],
                                     "path": ud.get("url"),
                                     "tokens": ud["tokens"],
                                     "n": None, "threshold": None})
            if history_tokens:
                contents.append({"type": "history", "name": f"History ({history_msg_count} msgs)",
                                 "path": None,
                                 "tokens": history_tokens,
                                 "n": None, "threshold": None})
            blocks.append({
                "name": "active",
                "tier": "active",
                "tokens": total,
                "count": 0,
                "cached": False,
                "contents": contents,
            })

        cache_hit_rate = cached_tokens / total if total > 0 else 0

        # Tier changes — group by direction
        promotions = []
        demotions = []
        if tracker:
            # Group changes by (action, from, to)
            grouped = {}
            for c in tracker.changes:
                action = c.get("action", "")
                direction = "promotion" if action in ("promoted", "graduated") else "demotion"
                group_key = (direction, c.get("from", "?"), c.get("to", "?"))
                if group_key not in grouped:
                    grouped[group_key] = []
                grouped[group_key].append(c["key"])

            for (direction, from_tier, to_tier), keys in grouped.items():
                desc = f"{from_tier} → {to_tier}: {len(keys)} items — {', '.join(keys)}"
                if direction == "promotion":
                    promotions.append(desc)
                else:
                    demotions.append(desc)

        # Session totals in HUD-friendly format
        st = self._session_totals
        session_totals = {
            "prompt": st["input_tokens"],
            "completion": st["output_tokens"],
            "total": sum(st.values()),
            "cache_hit": st["cache_read_tokens"],
            "cache_write": st["cache_write_tokens"],
        }

        return {
            "model": counter.model_name,
            "total_tokens": total,
            "max_input_tokens": counter.max_input_tokens,
            "cache_hit_rate": cache_hit_rate,
            "blocks": blocks,
            "breakdown": {
                "system": system_tokens,
                "legend": legend_tokens,
                "symbol_map": symbol_map_tokens,
                "symbol_map_chunks": symbol_map_chunks,
                "symbol_map_files": len(tokens_by_file),
                "files": file_tokens,
                "file_count": len(file_details),
                "file_details": file_details,
                "urls": url_tokens,
                "url_details": url_details,
                "history": history_tokens,
                "history_messages": history_msg_count,
            },
            "session_totals": session_totals,
            "promotions": promotions,
            "demotions": demotions,
        }

    # === Terminal HUD ===

    def _print_hud(self, usage):
        """Print terminal HUD after response.

        Three reports: Cache Blocks (boxed with sub-items), Token Usage, Tier Changes.
        Uses logger.info for structured output.
        """
        counter = self._context.counter
        tracker = self._context._stability_tracker

        # Gather provider-reported usage
        input_tokens = usage.get("input_tokens", 0)
        output_tokens = usage.get("output_tokens", 0)
        cache_read = usage.get("cache_read_tokens", 0)
        cache_write = usage.get("cache_write_tokens", 0)

        # Gather per-tier data
        system_tokens = counter.count(self._config.get_system_prompt())
        legend_tokens = 0
        if self._symbol_index:
            legend = self._symbol_index.get_legend()
            if legend:
                legend_tokens = counter.count(legend)

        tier_data = []  # list of (name, tokens, is_cached, contents)
        cached_tokens = 0
        total = 0

        if tracker:
            for tier in [Tier.L0, Tier.L1, Tier.L2, Tier.L3]:
                tier_items = tracker.get_tier_items(tier)
                if tier_items:
                    tier_tokens = sum(i.tokens for i in tier_items.values())
                    contents = self._tier_content_breakdown(tier_items)
                    # For L0, add system + legend as a special sub-item
                    if tier == Tier.L0:
                        contents.insert(0, {
                            "type": "system",
                            "name": "System + Legend",
                            "path": None,
                            "tokens": system_tokens + legend_tokens,
                            "n": None,
                            "threshold": None,
                        })
                        tier_tokens += system_tokens + legend_tokens
                    tier_data.append((tier.name, tier_tokens, True, contents))
                    cached_tokens += tier_tokens
                    total += tier_tokens
                elif tier == Tier.L0:
                    # L0 always has system prompt even without tracked items
                    sys_tok = system_tokens + legend_tokens
                    if sys_tok > 0:
                        contents = [{"type": "system", "name": "System + Legend",
                                     "path": None, "tokens": sys_tok,
                                     "n": None, "threshold": None}]
                        tier_data.append((tier.name, sys_tok, True, contents))
                        cached_tokens += sys_tok
                        total += sys_tok

            active_items = tracker.get_tier_items(Tier.ACTIVE)
            if active_items:
                active_tokens = sum(i.tokens for i in active_items.values())
                contents = self._tier_content_breakdown(active_items)
                tier_data.append(("active", active_tokens, False, contents))
                total += active_tokens
        else:
            # No tracker — show everything as active
            symbol_map_tokens = 0
            if self._symbol_index:
                sm = self._symbol_index.get_symbol_map(
                    exclude_files=set(self._selected_files)
                )
                if sm:
                    symbol_map_tokens = counter.count(sm)
            file_tokens = self._context.file_context.count_tokens(counter)
            history_tokens = self._context.history_token_count()
            total = system_tokens + symbol_map_tokens + file_tokens + history_tokens
            contents = []
            if system_tokens:
                contents.append({"type": "system", "name": "System + Legend",
                                 "path": None,
                                 "tokens": system_tokens + legend_tokens,
                                 "n": None, "threshold": None})
            if symbol_map_tokens:
                contents.append({"type": "symbols", "name": "Symbol Map",
                                 "path": None,
                                 "tokens": symbol_map_tokens,
                                 "n": None, "threshold": None})
            if file_tokens:
                contents.append({"type": "files", "name": "Files",
                                 "path": None,
                                 "tokens": file_tokens,
                                 "n": None, "threshold": None})
            if history_tokens:
                contents.append({"type": "history", "name": "History",
                                 "path": None,
                                 "tokens": history_tokens,
                                 "n": None, "threshold": None})
            tier_data.append(("active", total, False, contents))

        # --- Cache Blocks Report (boxed with sub-items) ---
        cache_hit = round(cached_tokens / total * 100) if total > 0 else 0

        # Build lines
        box_lines = []
        for name, tokens, is_cached, contents in tier_data:
            cached_tag = " [cached]" if is_cached else ""
            box_lines.append(f"│ {name:<6} {tokens:>8,} tokens{cached_tag}")
            # Group sub-items by type for compact terminal display
            type_groups = {}
            for c in contents:
                ctype = c["type"]
                if ctype not in type_groups:
                    type_groups[ctype] = {"count": 0, "tokens": 0}
                type_groups[ctype]["count"] += 1
                type_groups[ctype]["tokens"] += c["tokens"]
            for ctype, info in type_groups.items():
                ctokens = info["tokens"]
                ccount = info["count"]
                if ctype == "system":
                    box_lines.append(f"│   └─ system + legend ({ctokens:,} tok)")
                elif ctype == "symbols":
                    box_lines.append(f"│   └─ {ccount} symbols ({ctokens:,} tok)")
                elif ctype == "files":
                    box_lines.append(f"│   └─ {ccount} files ({ctokens:,} tok)")
                elif ctype == "history":
                    box_lines.append(f"│   └─ {ccount} history msgs ({ctokens:,} tok)")
                else:
                    box_lines.append(f"│   └─ {ccount} {ctype} ({ctokens:,} tok)")

        footer = f"│ Total: {total:,} | Cache hit: {cache_hit}%"
        content_width = max((len(line) for line in box_lines + [footer]), default=40)
        box_width = content_width + 2

        hud_lines = [f"╭─ Cache Blocks {'─' * max(1, box_width - 15)}╮"]
        for line in box_lines:
            hud_lines.append(f"{line:<{box_width}}│")
        hud_lines.append(f"├{'─' * box_width}┤")
        hud_lines.append(f"{footer:<{box_width}}│")
        hud_lines.append(f"╰{'─' * box_width}╯")

        for line in hud_lines:
            logger.info(line)

        # --- Token Usage (compact) ---
        logger.info(f"Model: {counter.model_name}")
        if input_tokens or output_tokens:
            logger.info(f"Last request: {input_tokens:,} in, {output_tokens:,} out")
        if cache_read or cache_write:
            parts = []
            if cache_read:
                parts.append(f"read: {cache_read:,}")
            if cache_write:
                parts.append(f"write: {cache_write:,}")
            logger.info(f"Cache: {', '.join(parts)}")
        session_total = sum(self._session_totals.values())
        if session_total:
            logger.info(f"Session total: {session_total:,}")

        # --- Tier Changes (grouped) ---
        if tracker:
            changes = tracker.changes
            # Group by (action_type, from, to)
            grouped = {}
            for c in changes:
                action = c.get("action", "")
                direction = "📈" if action in ("promoted", "graduated") else "📉"
                group_key = (direction, c.get("from", "?"), c.get("to", "?"))
                if group_key not in grouped:
                    grouped[group_key] = []
                grouped[group_key].append(c["key"])

            # Print promotions first, then demotions
            for (icon, from_t, to_t), keys in sorted(grouped.items(), key=lambda x: x[0][0]):
                logger.info(f"{icon} {from_t} → {to_t}: {len(keys)} items — {', '.join(keys)}")

    # === Review Mode (RPC) ===

    def check_review_ready(self):
        """Check if working tree is clean for review."""
        if not self._repo:
            return {"clean": False, "message": "No repository available"}
        if self._repo.is_clean():
            return {"clean": True}
        return {
            "clean": False,
            "message": (
                "Cannot enter review mode: working tree has uncommitted changes.\n"
                "Please commit, stash, or discard changes first:\n"
                "  git stash\n"
                "  git commit -am \"wip\"\n"
                "  git checkout -- <file>"
            ),
        }

    def get_commit_graph(self, limit=100, offset=0, include_remote=False):
        """Get commit graph for the review selector. Delegates to repo."""
        if not self._repo:
            return {"error": "No repository available"}
        return self._repo.get_commit_graph(limit=limit, offset=offset,
                                           include_remote=include_remote)

    async def start_review(self, branch, base_commit):
        """Enter review mode.

        Full entry sequence:
        1. checkout_review_parent → build symbol_map_before
        2. setup_review_soft_reset → rebuild symbol index
        """
        if not self._repo:
            return {"error": "No repository available"}

        if self._review_active:
            return {"error": "Review already active. End current review first."}

        # Phase 1: Checkout parent
        checkout_result = self._repo.checkout_review_parent(branch, base_commit)
        if "error" in checkout_result:
            return checkout_result

        branch_tip = checkout_result["branch_tip"]
        parent_commit = checkout_result["parent_commit"]
        original_branch = checkout_result["original_branch"]

        # Phase 2: Build symbol_map_before (at parent commit state)
        symbol_map_before = ""
        if self._symbol_index:
            try:
                file_list = self._repo.get_flat_file_list()
                self._symbol_index.index_repo(file_list)
                symbol_map_before = self._symbol_index.get_symbol_map() or ""
            except Exception as e:
                logger.warning(f"Failed to build symbol_map_before: {e}")

        # Phase 3: Setup soft reset
        setup_result = self._repo.setup_review_soft_reset(branch_tip, parent_commit)
        if "error" in setup_result:
            # Recovery: try to exit
            try:
                self._repo.exit_review_mode(branch_tip, original_branch)
            except Exception:
                pass
            return setup_result

        # Phase 4: Rebuild symbol index for branch tip state
        if self._symbol_index:
            try:
                file_list = self._repo.get_flat_file_list()
                self._symbol_index.index_repo(file_list)
            except Exception as e:
                logger.warning(f"Failed to rebuild symbol index: {e}")

        # Get review metadata
        commits = self._repo.get_commit_log(base_commit, branch_tip)
        changed_files = self._repo.get_review_changed_files()
        total_additions = sum(f.get("additions", 0) for f in changed_files)
        total_deletions = sum(f.get("deletions", 0) for f in changed_files)

        # Store review state
        self._review_active = True
        self._review_branch = branch
        self._review_branch_tip = branch_tip
        self._review_base_commit = base_commit
        self._review_parent = parent_commit
        self._review_original_branch = original_branch
        self._review_commits = commits if isinstance(commits, list) else []
        self._review_changed_files = changed_files
        self._review_stats = {
            "commit_count": len(self._review_commits),
            "files_changed": len(changed_files),
            "additions": total_additions,
            "deletions": total_deletions,
        }
        self._symbol_map_before = symbol_map_before

        # Swap system prompt to review-specific instructions
        self._saved_system_prompt = self._context.get_system_prompt()
        review_prompt = self._config.get_review_prompt()
        if review_prompt.strip():
            self._context.set_system_prompt(review_prompt)

        # Clear file selection so review starts with a clean slate —
        # prevents stale selections from before review including all diffs
        self._selected_files = []

        logger.info(f"Review mode entered: {branch} ({base_commit[:7]} → {branch_tip[:7]})")

        return {
            "status": "review_active",
            "branch": branch,
            "base_commit": base_commit,
            "commits": self._review_commits,
            "changed_files": self._review_changed_files,
            "stats": self._review_stats,
        }

    async def end_review(self):
        """Exit review mode and restore repository."""
        if not self._review_active:
            return {"error": "No active review"}

        if not self._repo:
            return {"error": "No repository available"}

        branch_tip = self._review_branch_tip
        original_branch = self._review_original_branch

        # Exit review mode in git
        result = self._repo.exit_review_mode(branch_tip, original_branch)

        # Restore original system prompt
        if self._saved_system_prompt is not None:
            self._context.set_system_prompt(self._saved_system_prompt)
            self._saved_system_prompt = None

        # Clear review state regardless
        self._review_active = False
        self._review_branch = None
        self._review_branch_tip = None
        self._review_base_commit = None
        self._review_parent = None
        self._review_original_branch = None
        self._review_commits = []
        self._review_changed_files = []
        self._review_stats = {}
        self._symbol_map_before = None
        self._context.clear_review_context()

        # Rebuild symbol index
        if self._symbol_index:
            try:
                file_list = self._repo.get_flat_file_list()
                self._symbol_index.index_repo(file_list)
            except Exception as e:
                logger.warning(f"Failed to rebuild symbol index after review: {e}")

        # Re-initialize stability tracker
        if self._symbol_index and self._stability_tracker:
            try:
                ref_index = self._symbol_index.reference_index
                all_files = list(self._symbol_index._all_symbols.keys())
                self._stability_tracker.initialize_from_reference_graph(
                    ref_index, all_files, counter=self._context.counter,
                )
            except Exception as e:
                logger.warning(f"Failed to reinitialize stability tracker: {e}")

        logger.info("Review mode exited")
        return result

    def get_review_state(self):
        """Get current review state."""
        if not self._review_active:
            return {"active": False}
        return {
            "active": True,
            "branch": self._review_branch,
            "base_commit": self._review_base_commit,
            "branch_tip": self._review_branch_tip,
            "commits": self._review_commits,
            "changed_files": self._review_changed_files,
            "stats": self._review_stats,
        }

    def get_review_file_diff(self, path):
        """Get reverse diff for a file during review."""
        if not self._review_active:
            return {"error": "No active review"}
        if not self._repo:
            return {"error": "No repository available"}
        return self._repo.get_review_file_diff(path)

    def get_snippets(self):
        """Return snippets appropriate for the current mode.

        In review mode, returns review-specific snippets.
        Otherwise, returns standard coding snippets.
        """
        if self._review_active:
            return self._config.get_review_snippets()
        return self._config.get_snippets()

    def _build_review_context(self):
        """Build review context string for prompt injection.

        Includes: review summary, commit log, pre-change symbol map,
        and reverse diffs for selected files.
        """
        if not self._review_active:
            return None

        parts = []

        # Review summary
        parent_short = self._review_parent[:7] if self._review_parent else "?"
        tip_short = self._review_branch_tip[:7] if self._review_branch_tip else "?"
        stats = self._review_stats
        parts.append(
            f"## Review: {self._review_branch} ({parent_short} → {tip_short})\n"
            f"{stats.get('commit_count', 0)} commits, "
            f"{stats.get('files_changed', 0)} files changed, "
            f"+{stats.get('additions', 0)} -{stats.get('deletions', 0)}\n"
        )

        # Commit log
        if self._review_commits:
            parts.append("## Commits")
            for i, c in enumerate(self._review_commits, 1):
                date = c.get("date", "")
                parts.append(
                    f"{i}. {c.get('short_sha', '?')} {c.get('message', '')} "
                    f"({c.get('author', '?')}, {date})"
                )
            parts.append("")

        # Pre-change symbol map
        if self._symbol_map_before:
            parts.append(
                "## Pre-Change Symbol Map\n"
                "Symbol map from the parent commit (before the reviewed changes).\n"
                "Compare against the current symbol map in the repository structure above.\n"
            )
            parts.append(self._symbol_map_before)
            parts.append("")

        # Reverse diffs for selected files that exist on disk
        # (excludes deleted files — they have no current content to review)
        changed_paths = {f["path"] for f in self._review_changed_files}
        selected_and_changed = [
            p for p in self._selected_files
            if p in changed_paths and self._repo and self._repo.file_exists(p)
        ]

        if selected_and_changed and self._repo:
            parts.append(
                "## Reverse Diffs (selected files)\n"
                "These diffs show what would revert each file to the pre-review state.\n"
                "The full current content is in the working files above.\n"
            )
            for path in selected_and_changed:
                diff_result = self._repo.get_review_file_diff(path)
                diff_text = diff_result.get("diff", "")
                # Get stats for this file
                file_info = next(
                    (f for f in self._review_changed_files if f["path"] == path),
                    {}
                )
                adds = file_info.get("additions", 0)
                dels = file_info.get("deletions", 0)
                parts.append(f"### {path} (+{adds} -{dels})")
                if diff_text:
                    parts.append(f"```diff\n{diff_text}```")
                else:
                    parts.append("*(no diff available)*")
                parts.append("")

        return "\n".join(parts)

    # === History RPC Methods ===

    def history_search(self, query, role=None, limit=50):
        """Search conversation history.

        Searches persistent store first, falls back to in-memory history.
        """
        if not query:
            return []

        # Try persistent store first
        if self._history_store:
            results = self._history_store.search(query, role=role, limit=limit)
            if results:
                return results

        # Fall back to in-memory history
        results = []
        for msg in self._context.get_history():
            if role and msg["role"] != role:
                continue
            if query.lower() in msg.get("content", "").lower():
                results.append(msg)
                if len(results) >= limit:
                    break
        return results

    def history_get_session(self, session_id):
        """Get all messages from a session."""
        if self._history_store:
            return self._history_store.get_session_messages(session_id)
        return []

    def history_list_sessions(self, limit=None):
        """List recent sessions, newest first."""
        if self._history_store:
            return self._history_store.list_sessions(limit=limit)
        return []

    def history_new_session(self):
        """Start new session — alias for new_session."""
        return self.new_session()

    def load_session_into_context(self, session_id):
        """Load a previous session into active context.

        Clears current history, reads messages from store,
        adds each to context manager, and sets session ID.
        """
        if not self._history_store:
            return {"error": "No history store available"}

        msgs = self._history_store.get_session_messages_for_context(session_id)
        if not msgs:
            return {"error": "Session not found or empty"}

        self._context.clear_history()
        for msg in msgs:
            self._context.add_message(msg["role"], msg["content"])

        # Build frontend messages with reconstructed images
        frontend_messages = []
        for msg in msgs:
            entry = {"role": msg["role"], "content": msg["content"]}
            if msg.get("_images"):
                entry["images"] = msg["_images"]
            frontend_messages.append(entry)

        self._session_id = session_id
        return {
            "session_id": session_id,
            "message_count": len(msgs),
            "messages": frontend_messages,
        }

    def get_history_status(self):
        """Return history status for the history bar.

        Includes token counts and compaction status.
        """
        return {
            **self._context.get_compaction_status(),
            "session_id": self._session_id,
            "message_count": len(self._context.get_history()),
        }

    # === URL Handling (RPC) ===

    def _init_url_service(self):
        """Initialize the URL service with cache and model."""
        cache = None
        try:
            url_config = self._config.url_cache_config or {}
            cache_dir = url_config.get("path")
            ttl_hours = url_config.get("ttl_hours", 24)
            cache = URLCache(cache_dir=cache_dir, ttl_hours=ttl_hours)
        except Exception as e:
            logger.warning(f"Failed to initialize URL cache: {e}")

        model = self._config.smaller_model or self._config.model

        # Pass SymbolIndex class so GitHub repo fetches generate symbol maps
        from .symbol_index.index import SymbolIndex
        return URLService(cache=cache, model=model, symbol_index_cls=SymbolIndex)

    def detect_urls(self, text):
        """Find and classify URLs in text. (RPC)"""
        return self._url_service.detect_urls(text)

    async def fetch_url(self, url, use_cache=True, summarize=True,
                        summary_type=None, user_text=""):
        """Fetch URL content, cache, and optionally summarize. (RPC)"""
        result = await self._url_service.fetch_url(
            url, use_cache=use_cache, summarize=summarize,
            summary_type=summary_type, user_text=user_text,
        )
        return result.to_dict()

    async def detect_and_fetch(self, text, use_cache=True, summarize=True):
        """Detect and fetch all URLs in text. (RPC)"""
        results = await self._url_service.detect_and_fetch(
            text, use_cache=use_cache, summarize=summarize,
            user_text=text,
        )
        return [r.to_dict() for r in results]

    def get_url_content(self, url):
        """Get cached/fetched content for a URL. (RPC)"""
        result = self._url_service.get_url_content(url)
        return result.to_dict()

    def invalidate_url_cache(self, url):
        """Remove URL from cache. (RPC)"""
        self._url_service.invalidate_url_cache(url)
        return {"success": True}

    def remove_fetched_url(self, url):
        """Remove URL from active context but keep in cache. (RPC)"""
        self._url_service.remove_fetched(url)
        return {"success": True}

    def clear_url_cache(self):
        """Clear all cached URLs. (RPC)"""
        self._url_service.clear_url_cache()
        return {"success": True}