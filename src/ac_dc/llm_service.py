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
    EditStatus,
    apply_edits_to_repo,
    detect_shell_commands,
    parse_edit_blocks,
)
from .history_store import HistoryStore
from .stability_tracker import TIER_CONFIG, Tier
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

        # URL service
        self._url_service = self._init_url_service()

        # Session totals
        self._session_totals = {
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_read_tokens": 0,
            "cache_write_tokens": 0,
        }

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

        # Launch background task
        asyncio.get_event_loop().run_in_executor(
            None,
            lambda: asyncio.run(
                self._stream_chat(request_id, message, files or [], images or [])
            )
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
                symbol_map = self._symbol_index.get_symbol_map(
                    exclude_files=set(self._selected_files)
                )
                symbol_legend = self._symbol_index.get_legend()

            if self._repo:
                flat_files = self._repo.get_flat_file_list()
                file_tree = f"# File Tree ({len(flat_files)} files)\n\n" + "\n".join(flat_files)

            # Detect and fetch URLs from prompt
            try:
                detected = self._url_service.detect_urls(message)
                for url_info in detected:
                    url = url_info["url"]
                    # Skip already-fetched URLs
                    existing = self._url_service.get_url_content(url)
                    if existing.error == "URL not yet fetched":
                        await self._url_service.fetch_url(
                            url, use_cache=True, summarize=True,
                            user_text=message,
                        )
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

                # Apply edits
                if self._repo and not was_cancelled:
                    edit_results = apply_edits_to_repo(blocks, str(self._repo.root))

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

                    result["files_modified"] = modified
                    result["passed"] = sum(1 for r in edit_results if r.status == EditStatus.APPLIED)
                    result["failed"] = sum(1 for r in edit_results if r.status == EditStatus.FAILED)
                    result["skipped"] = sum(1 for r in edit_results if r.status == EditStatus.SKIPPED)
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
                    await self._event_callback("streamComplete", result)
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

        loop = asyncio.get_event_loop()

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

    # === Commit Message Generation (RPC) ===

    def generate_commit_message(self, diff_text):
        """Generate a commit message from a diff using a non-streaming LLM call.

        Args:
            diff_text: git diff text

        Returns:
            {message: str} or {error: str}
        """
        if not diff_text or not diff_text.strip():
            return {"error": "Empty diff"}

        try:
            response = litellm.completion(
                model=self._config.model,
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

    def get_context_breakdown(self):
        """Return token breakdown for current context."""
        counter = self._context.counter

        system_tokens = counter.count(self._config.get_system_prompt())

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

        return {
            "system": system_tokens,
            "symbol_map": symbol_map_tokens,
            "files": file_tokens,
            "history": history_tokens,
            "total_tokens": total,
            "max_input_tokens": counter.max_input_tokens,
            "model": counter.model_name,
            "session_totals": dict(self._session_totals),
        }

    # === Terminal HUD ===

    def _print_hud(self, usage):
        """Print terminal HUD after response.

        Two reports: Cache Blocks (boxed) and Token Usage.
        """
        counter = self._context.counter

        # Gather token counts
        system_tokens = counter.count(self._config.get_system_prompt())
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

        input_tokens = usage.get("input_tokens", 0)
        output_tokens = usage.get("output_tokens", 0)
        cache_read = usage.get("cache_read_tokens", 0)
        cache_write = usage.get("cache_write_tokens", 0)

        # --- Cache Blocks Report (boxed) ---
        tracker = self._context._stability_tracker
        cache_lines = []
        cached_tokens = 0
        if tracker:
            for tier in [Tier.L0, Tier.L1, Tier.L2, Tier.L3]:
                tier_items = tracker.get_tier_items(tier)
                if tier_items:
                    tier_tokens = sum(i.tokens for i in tier_items.values())
                    entry_n = TIER_CONFIG[tier]["entry_n"]
                    cache_lines.append(
                        f"│ {tier.name:<10} ({entry_n}+) {tier_tokens:>8,} tokens [cached]"
                    )
                    cached_tokens += tier_tokens
            active_items = tracker.get_tier_items(Tier.ACTIVE)
            if active_items:
                active_tokens = sum(i.tokens for i in active_items.values())
                cache_lines.append(
                    f"│ active     {active_tokens:>14,} tokens"
                )

        if cache_lines:
            cache_hit = round(cached_tokens / total * 100) if total > 0 else 0
            # Compute box width
            content_width = max(len(line) for line in cache_lines)
            footer = f"│ Total: {total:,} | Cache hit: {cache_hit}%"
            content_width = max(content_width, len(footer))
            box_width = content_width + 2  # padding

            print()
            print(f"╭─ Cache Blocks {'─' * (box_width - 15)}╮")
            for line in cache_lines:
                print(f"{line:<{box_width}}│")
            print(f"├{'─' * box_width}┤")
            print(f"{footer:<{box_width}}│")
            print(f"╰{'─' * box_width}╯")

        # --- Token Usage Report ---
        print(f"\nModel: {counter.model_name}")
        print(f"System:     {system_tokens:>8,}")
        print(f"Symbol Map: {symbol_map_tokens:>8,}")
        print(f"Files:      {file_tokens:>8,}")
        print(f"History:    {history_tokens:>8,}")
        print(f"Total:      {total:>8,} / {counter.max_input_tokens:,}")
        if input_tokens or output_tokens:
            print(f"Last request: {input_tokens:,} in, {output_tokens:,} out")
        if cache_read or cache_write:
            parts = []
            if cache_read:
                parts.append(f"read: {cache_read:,}")
            if cache_write:
                parts.append(f"write: {cache_write:,}")
            print(f"Cache:      {', '.join(parts)}")
        session_total = sum(self._session_totals.values())
        if session_total:
            print(f"Session total: {session_total:,}")

        # --- Tier Changes ---
        if tracker:
            changes = tracker.changes
            promotions = [c for c in changes if c["action"] == "promoted"]
            demotions = [c for c in changes if c["action"] in ("demoted", "demoted_underfilled")]
            if promotions:
                for p in promotions:
                    print(f"📈 {p.get('from', '?')} → {p.get('to', '?')}: {p['key']}")
            if demotions:
                for d in demotions:
                    print(f"📉 {d.get('from', '?')} → {d.get('to', '?')}: {d['key']}")

        print()

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

        self._session_id = session_id
        return {
            "session_id": session_id,
            "message_count": len(msgs),
            "messages": self._context.get_history(),
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
        return URLService(cache=cache, model=model)

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

    def get_url_content(self, url):
        """Get cached/fetched content for a URL. (RPC)"""
        result = self._url_service.get_url_content(url)
        return result.to_dict()

    def invalidate_url_cache(self, url):
        """Remove URL from cache. (RPC)"""
        self._url_service.invalidate_url_cache(url)
        return {"success": True}

    def clear_url_cache(self):
        """Clear all cached URLs. (RPC)"""
        self._url_service.clear_url_cache()
        return {"success": True}