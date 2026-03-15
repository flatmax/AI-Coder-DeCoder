"""LLM Service — central orchestrator for chat, streaming, context, and features.

Registered via jrpc-oo as LLMService.* RPC endpoints.
Coordinates: context manager, symbol index, doc index, URL service,
history store, stability tracker, edit parser, and review mode.
"""

import asyncio
import hashlib
import logging
import traceback
from enum import Enum
from typing import Optional

from ac_dc.config_manager import ConfigManager
from ac_dc.context.context_manager import ContextManager
from ac_dc.context.history_compactor import HistoryCompactor
from ac_dc.context.history_store import HistoryStore
from ac_dc.context.stability_tracker import StabilityTracker, Tier
from ac_dc.edit_parser import (
    EditStatus, apply_edits_to_repo, detect_shell_commands, parse_edit_blocks,
)
from ac_dc.repo import Repo

logger = logging.getLogger(__name__)


class Mode(Enum):
    CODE = "code"
    DOC = "doc"


class LLMService:
    """Central LLM service — exposed via jrpc-oo as LLMService.* RPC endpoints.

    All public methods (not prefixed with _) are automatically exposed.
    """

    def __init__(
        self,
        config_manager: ConfigManager,
        repo: Repo,
        symbol_index=None,
        doc_index=None,
        deferred_init: bool = False,
    ):
        self._config = config_manager
        self._repo = repo
        self._symbol_index = symbol_index
        self._doc_index = doc_index

        # Mode
        self._mode = Mode.CODE
        self._cross_ref_enabled = False

        # Context engine
        self._context = ContextManager(
            model_name=self._config.model,
            repo_root=str(self._repo.root),
            cache_target_tokens=self._config.cache_target_tokens,
            compaction_config=self._config.history_compaction_config,
        )
        self._context.set_system_prompt(self._config.get_system_prompt())

        # History store
        self._history_store = HistoryStore(self._config.ac_dc_dir)

        # Session
        self._session_id = self._history_store.current_session_id

        # URL service (lazy — may not be needed)
        self._url_service = None

        # Stability trackers (one per mode)
        self._code_tracker: Optional[StabilityTracker] = None
        self._doc_tracker: Optional[StabilityTracker] = None
        self._stability_initialized = False

        # Selected files
        self._selected_files: list[str] = []
        self._excluded_index_files: set[str] = set()

        # Streaming state
        self._streaming_active = False
        self._active_request_id: Optional[str] = None
        self._cancelled_requests: set[str] = set()

        # Session token totals
        self._session_totals = {
            "prompt": 0,
            "completion": 0,
            "total": 0,
            "cache_hit": 0,
            "cache_write": 0,
        }

        # Review state
        self._review_active = False
        self._review_branch: Optional[str] = None
        self._review_branch_tip: Optional[str] = None
        self._review_base_commit: Optional[str] = None
        self._review_parent: Optional[str] = None
        self._review_original_branch: Optional[str] = None
        self._review_commits: list[dict] = []
        self._review_changed_files: list[dict] = []
        self._review_stats: dict = {}
        self._symbol_map_before: str = ""

        # Callbacks (wired in main.py)
        self._event_callback = None
        self._chunk_callback = None

        # Collaboration (wired in main.py if --collab)
        self._collab = None

        # Deferred init
        self._init_complete = not deferred_init

    # ── Deferred Initialization ───────────────────────────────────

    def complete_deferred_init(self, symbol_index=None):
        """Complete initialization after startup (wires symbol index)."""
        if symbol_index:
            self._symbol_index = symbol_index
        self._init_complete = True

    def _restore_last_session(self):
        """Auto-restore the most recent session into context."""
        try:
            sessions = self._history_store.list_sessions(limit=1)
            if not sessions:
                return
            sid = sessions[0]["session_id"]
            messages = self._history_store.get_session_messages_for_context(sid)
            if not messages:
                return
            for msg in messages:
                self._context.add_message(msg["role"], msg["content"])
            self._session_id = sid
            self._history_store.current_session_id = sid
            logger.info(f"Restored session {sid} with {len(messages)} messages")
        except Exception as e:
            logger.warning(f"Failed to restore last session: {e}")

    # ── State Queries ─────────────────────────────────────────────

    def get_current_state(self) -> dict:
        """Full state snapshot for browser on connect/reconnect."""
        return {
            "messages": self._context.get_history(),
            "selected_files": list(self._selected_files),
            "excluded_index_files": list(self._excluded_index_files),
            "streaming_active": self._streaming_active,
            "session_id": self._session_id,
            "repo_name": self._repo.root.name,
            "cross_ref_enabled": self._cross_ref_enabled,
            "mode": self._mode.value,
            "init_complete": self._init_complete,
        }

    # ── File Selection ────────────────────────────────────────────

    def set_selected_files(self, files: list[str]) -> list[str]:
        """Update the selected files list. Returns the new list."""
        if err := self._check_localhost_only():
            return err
        self._selected_files = list(files)
        return list(self._selected_files)

    def get_selected_files(self) -> list[str]:
        """Return a copy of the current selection."""
        return list(self._selected_files)

    def set_excluded_index_files(self, files: list[str]) -> list[str]:
        """Set files excluded from index/map."""
        if err := self._check_localhost_only():
            return err
        old_excluded = self._excluded_index_files
        self._excluded_index_files = set(files)

        # Remove tracker items for newly excluded files
        newly_excluded = self._excluded_index_files - old_excluded
        tracker = self._get_active_tracker()
        if tracker and newly_excluded:
            for path in newly_excluded:
                tracker.remove_item(f"sym:{path}")
                tracker.remove_item(f"doc:{path}")

        return list(self._excluded_index_files)

    def get_excluded_index_files(self) -> list[str]:
        return list(self._excluded_index_files)

    # ── Mode ──────────────────────────────────────────────────────

    def get_mode(self) -> dict:
        """Return current mode and cross-ref state."""
        return {
            "mode": self._mode.value,
            "cross_ref_enabled": self._cross_ref_enabled,
        }

    def switch_mode(self, mode: str) -> dict:
        """Switch between code and document mode."""
        if err := self._check_localhost_only():
            return err

        new_mode = Mode.DOC if mode == "doc" else Mode.CODE

        if new_mode == self._mode:
            return {"status": "unchanged", "mode": self._mode.value}

        old_mode = self._mode
        self._mode = new_mode

        # Reset cross-reference
        if self._cross_ref_enabled:
            self._cross_ref_enabled = False
            tracker = self._get_active_tracker()
            if tracker:
                prefix = "doc:" if old_mode == Mode.CODE else "sym:"
                tracker.remove_items_by_prefix(prefix)

        # Clear file context
        self._selected_files = []
        self._context.file_context.clear()

        # Swap system prompt
        if new_mode == Mode.DOC:
            self._context.set_system_prompt(self._config.get_doc_system_prompt())
        else:
            self._context.set_system_prompt(self._config.get_system_prompt())

        # Update stability with current context
        tracker = self._get_active_tracker()
        if tracker:
            self._update_stability(tracker)

        # Insert mode switch message
        mode_label = "document" if new_mode == Mode.DOC else "code"
        self._context.add_message(
            "assistant", f"Switched to {mode_label} mode."
        )

        # Broadcast
        if self._event_callback:
            asyncio.ensure_future(
                self._event_callback("filesChanged", self._selected_files)
            )
            asyncio.ensure_future(
                self._event_callback("modeChanged", {"mode": self._mode.value})
            )

        result = {"status": "switched", "mode": self._mode.value}

        # Check keyword availability for doc mode
        if new_mode == Mode.DOC and self._doc_index:
            if not self._doc_index.keywords_available:
                result["keywords_available"] = False
                result["keywords_message"] = (
                    "Keyword enrichment is not available. "
                    "Install with: pip install ac-dc[docs]"
                )

        return result

    def set_cross_reference(self, enabled: bool) -> dict:
        """Enable/disable cross-reference mode."""
        if err := self._check_localhost_only():
            return err

        if enabled == self._cross_ref_enabled:
            return {"status": "unchanged", "cross_ref_enabled": self._cross_ref_enabled}

        self._cross_ref_enabled = enabled
        tracker = self._get_active_tracker()

        if enabled and tracker:
            # Initialize cross-ref items from the other index
            self._init_cross_ref_items(tracker)
        elif not enabled and tracker:
            # Remove cross-ref items
            prefix = "doc:" if self._mode == Mode.CODE else "sym:"
            tracker.remove_items_by_prefix(prefix)

        # Broadcast mode change with cross-ref state
        if self._event_callback:
            asyncio.ensure_future(
                self._event_callback("modeChanged", {
                    "mode": self._mode.value,
                    "cross_ref_enabled": self._cross_ref_enabled,
                })
            )

        return {
            "status": "enabled" if enabled else "disabled",
            "cross_ref_enabled": self._cross_ref_enabled,
        }

    # ── Streaming Chat ────────────────────────────────────────────

    def chat_streaming(
        self,
        request_id: str,
        message: str,
        files: Optional[list[str]] = None,
        images: Optional[list[str]] = None,
    ) -> dict:
        """Start a streaming chat request. Returns immediately."""
        if err := self._check_localhost_only():
            return err

        if not self._init_complete:
            return {"error": "Server is still initializing — please wait a moment"}

        if self._streaming_active:
            return {"error": "Another stream is already active"}

        self._streaming_active = True
        self._active_request_id = request_id

        # Persist user message
        self._history_store.append_message(
            session_id=self._session_id,
            role="user",
            content=message,
            files=files or None,
            images=images if images else None,
        )

        # Broadcast user message to all clients
        if self._event_callback:
            asyncio.ensure_future(
                self._event_callback("userMessage", {"content": message})
            )

        # Launch background streaming task
        asyncio.ensure_future(self._stream_chat(request_id, message, files, images))

        return {"status": "started"}

    def cancel_streaming(self, request_id: str) -> dict:
        """Cancel an active streaming request."""
        if request_id == self._active_request_id:
            self._cancelled_requests.add(request_id)
            return {"status": "cancelling"}
        return {"error": "Request ID does not match active stream"}

    async def _stream_chat(
        self,
        request_id: str,
        message: str,
        files: Optional[list[str]],
        images: Optional[list[str]],
    ):
        """Background task for streaming chat."""
        result = {}
        token_usage = {}
        try:
            # Get event loop for executor calls
            loop = asyncio.get_running_loop()

            # Sync file context with selected files
            self._sync_file_context(files)

            # Initialize stability tracker if needed
            if not self._stability_initialized:
                self._try_initialize_stability()

            # Re-extract doc structures if in doc mode (mtime-based, instant)
            if self._mode == Mode.DOC and self._doc_index:
                try:
                    repo_files = set(self._repo.get_flat_file_list().splitlines())
                    await loop.run_in_executor(
                        None, self._doc_index.index_repo, repo_files,
                    )
                except Exception as e:
                    logger.debug(f"Doc re-extraction failed: {e}")

            # Detect and fetch URLs (up to 3)
            url_context = await self._fetch_urls_from_message(request_id, message)
            if url_context:
                self._context.set_url_context(url_context)

            # Build review context if active
            review_context = ""
            if self._review_active:
                review_context = self._build_review_context()

            # Append system reminder
            system_reminder = self._config.get_system_reminder()

            # Build tiered content from stability tracker
            tracker = self._get_active_tracker()
            tiered_content = self._build_tiered_content(tracker) if tracker else None

            # Determine exclusions for symbol map
            symbol_map_exclude = set(self._selected_files) | self._excluded_index_files
            if tracker:
                for key, item in tracker.get_all_items().items():
                    if item.tier != Tier.ACTIVE:
                        if key.startswith(("sym:", "doc:", "file:")):
                            symbol_map_exclude.add(key.split(":", 1)[1])

            # Get appropriate index map and legend
            symbol_map, symbol_legend, doc_legend = self._get_maps_and_legends(
                symbol_map_exclude
            )

            # Get file tree
            file_tree = self._repo.get_flat_file_list()

            # Assemble messages
            msgs = self._context.assemble_tiered_messages(
                user_prompt=message,
                images=images,
                symbol_map=symbol_map,
                symbol_legend=symbol_legend,
                doc_legend=doc_legend if self._cross_ref_enabled else None,
                file_tree=file_tree,
                tiered_content=tiered_content,
                review_context=review_context,
                system_reminder=system_reminder,
            )

            # Run LLM completion in thread pool
            full_content, was_cancelled, token_usage = await loop.run_in_executor(
                None, self._run_llm_streaming, request_id, msgs, loop,
            )

            if was_cancelled:
                full_content = (full_content or "") + "\n\n[stopped]"
                result["cancelled"] = True

            # Add exchange to context
            self._context.add_exchange(message, full_content)

            # Parse and apply edit blocks (skip in review mode)
            edit_results = []
            files_modified = []
            files_auto_added = []
            deferred_enrichment = []
            if not self._review_active and full_content:
                blocks = parse_edit_blocks(full_content)
                if blocks:
                    in_context = set(self._selected_files)
                    edit_results_raw = apply_edits_to_repo(
                        blocks, self._repo.root,
                        in_context_files=in_context,
                    )
                    edit_results = [r.to_dict() for r in edit_results_raw]

                    # Collect results
                    for r in edit_results_raw:
                        if r.status == EditStatus.APPLIED.value:
                            files_modified.append(r.file_path)
                        elif r.status == EditStatus.NOT_IN_CONTEXT.value:
                            if r.file_path not in self._selected_files:
                                self._selected_files.append(r.file_path)
                                files_auto_added.append(r.file_path)

                    # Invalidate caches for modified files
                    for path in files_modified:
                        if self._symbol_index:
                            self._symbol_index.invalidate_file(path)
                        if self._doc_index:
                            self._doc_index.invalidate_file(path)
                            self._doc_index.index_file_structure_only(path)

                    # Queue modified doc files for deferred enrichment
                    if self._doc_index and files_modified:
                        deferred_enrichment = self._doc_index.queue_enrichment(
                            files_modified
                        )

                    # Broadcast file changes if auto-added
                    if files_auto_added and self._event_callback:
                        await self._event_callback(
                            "filesChanged", self._selected_files
                        )

            # Persist assistant message
            self._history_store.append_message(
                session_id=self._session_id,
                role="assistant",
                content=full_content,
                files_modified=files_modified or None,
                edit_results=edit_results or None,
            )

            # Update session totals
            if token_usage:
                self._session_totals["prompt"] += token_usage.get("prompt_tokens", 0)
                self._session_totals["completion"] += token_usage.get("completion_tokens", 0)
                self._session_totals["cache_hit"] += token_usage.get("cache_read_tokens", 0)
                self._session_totals["cache_write"] += token_usage.get("cache_write_tokens", 0)
                self._session_totals["total"] = (
                    self._session_totals["prompt"]
                    + self._session_totals["completion"]
                    + self._session_totals["cache_hit"]
                    + self._session_totals["cache_write"]
                )

            # Update stability
            if tracker:
                self._update_stability(tracker)

            # Save symbol map
            if self._symbol_index:
                self._symbol_index.save_symbol_map(self._config.ac_dc_dir)

            # Shell commands
            shell_commands = detect_shell_commands(full_content) if full_content else []

            # Count results
            passed = sum(1 for r in edit_results if r.get("status") == "applied")
            failed = sum(1 for r in edit_results if r.get("status") == "failed")
            skipped = sum(1 for r in edit_results if r.get("status") == "skipped")
            not_in_ctx = sum(1 for r in edit_results if r.get("status") == "not_in_context")

            result.update({
                "response": full_content,
                "token_usage": token_usage,
                "edit_results": edit_results,
                "shell_commands": shell_commands,
                "passed": passed,
                "failed": failed,
                "skipped": skipped,
                "not_in_context": not_in_ctx,
                "files_modified": files_modified,
                "files_auto_added": files_auto_added,
                "_deferred_enrichment": deferred_enrichment,
            })

        except Exception as e:
            logger.error(f"Streaming error: {e}\n{traceback.format_exc()}")
            result["error"] = str(e)

        finally:
            self._streaming_active = False
            self._active_request_id = None
            self._cancelled_requests.discard(request_id)

        # Send stream complete
        deferred_enrichment = result.pop("_deferred_enrichment", [])
        if self._event_callback:
            await self._event_callback("streamComplete", request_id, result)

        # Deferred doc enrichment (after streamComplete, non-blocking)
        if deferred_enrichment and self._doc_index:
            await asyncio.sleep(0)  # Flush WebSocket frame
            asyncio.ensure_future(
                self._run_deferred_enrichment(request_id, deferred_enrichment)
            )

        # Post-response compaction (with delay)
        await asyncio.sleep(0.5)
        await self._post_response_compaction(request_id)

    def _run_llm_streaming(
        self, request_id: str, messages: list[dict],
        loop: Optional[asyncio.AbstractEventLoop] = None,
    ) -> tuple[str, bool, dict]:
        """Run LLM completion in a thread (blocking).

        Returns (content, was_cancelled, token_usage).
        """
        token_usage = {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "cache_read_tokens": 0,
            "cache_write_tokens": 0,
        }
        try:
            import litellm
            response = litellm.completion(
                model=self._config.model,
                messages=messages,
                stream=True,
                stream_options={"include_usage": True},
            )

            full_content = ""
            for chunk in response:
                if request_id in self._cancelled_requests:
                    return full_content, True, token_usage

                delta = chunk.choices[0].delta if chunk.choices else None
                if delta and delta.content:
                    full_content += delta.content
                    # Fire chunk callback (thread-safe via call_soon_threadsafe)
                    if self._chunk_callback and loop:
                        loop.call_soon_threadsafe(
                            self._chunk_callback, request_id, full_content,
                        )

                # Extract usage from any chunk that has it
                usage = getattr(chunk, "usage", None)
                if usage:
                    token_usage["prompt_tokens"] = getattr(usage, "prompt_tokens", 0) or 0
                    token_usage["completion_tokens"] = getattr(usage, "completion_tokens", 0) or 0
                    # Cache tokens — multiple provider field names
                    token_usage["cache_read_tokens"] = (
                        getattr(usage, "cache_read_input_tokens", 0)
                        or getattr(usage, "cache_read_tokens", 0)
                        or 0
                    )
                    token_usage["cache_write_tokens"] = (
                        getattr(usage, "cache_creation_input_tokens", 0)
                        or getattr(usage, "cache_creation_tokens", 0)
                        or 0
                    )

            # Estimate completion tokens if not reported
            if not token_usage["completion_tokens"] and full_content:
                token_usage["completion_tokens"] = len(full_content) // 4

            return full_content, False, token_usage

        except Exception as e:
            logger.error(f"LLM streaming error: {e}")
            raise

    # ── Session Management ────────────────────────────────────────

    def new_session(self) -> dict:
        """Start a new conversation session."""
        if err := self._check_localhost_only():
            return err
        self._context.clear_history()
        tracker = self._get_active_tracker()
        if tracker:
            tracker.purge_history()
        self._session_id = self._history_store.new_session()
        self._session_totals = {
            "prompt": 0, "completion": 0, "total": 0,
            "cache_hit": 0, "cache_write": 0,
        }

        # Broadcast to collaborators
        if self._event_callback:
            asyncio.ensure_future(
                self._event_callback("sessionChanged", {
                    "session_id": self._session_id,
                    "messages": [],
                })
            )

        return {"session_id": self._session_id}

    def load_session_into_context(self, session_id: str) -> dict:
        """Load a previous session into active context."""
        if err := self._check_localhost_only():
            return err
        self._context.clear_history()
        tracker = self._get_active_tracker()
        if tracker:
            tracker.purge_history()

        messages = self._history_store.get_session_messages_for_context(session_id)
        for msg in messages:
            self._context.add_message(msg["role"], msg["content"])

        self._session_id = session_id
        self._history_store.current_session_id = session_id

        # Get messages with images for frontend
        full_messages = self._history_store.get_session_messages(session_id)

        # Broadcast to collaborators
        if self._event_callback:
            asyncio.ensure_future(
                self._event_callback("sessionChanged", {
                    "session_id": session_id,
                    "messages": self._context.get_history(),
                })
            )

        return {
            "session_id": session_id,
            "messages": self._context.get_history(),
        }

    # ── History ───────────────────────────────────────────────────

    def history_search(self, query: str, role: Optional[str] = None,
                       limit: int = 50) -> list[dict]:
        """Search across conversation history."""
        results = self._history_store.search(query, role=role, limit=limit)
        if not results:
            # Fallback to in-memory
            lower = query.lower()
            matches = []
            for msg in self._context.get_history():
                if role and msg.get("role") != role:
                    continue
                if lower in msg.get("content", "").lower():
                    matches.append(msg)
            if matches:
                return [{"session_id": self._session_id, "messages": matches[:limit]}]
        return results

    def history_get_session(self, session_id: str) -> list[dict]:
        """Get all messages from a session (full metadata)."""
        return self._history_store.get_session_messages(session_id)

    def history_list_sessions(self, limit: Optional[int] = None) -> list[dict]:
        """List recent sessions."""
        return self._history_store.list_sessions(limit=limit)

    def history_new_session(self) -> dict:
        """Start new history session."""
        if err := self._check_localhost_only():
            return err
        return self.new_session()

    def get_history_status(self) -> dict:
        """History bar data — token counts, session info."""
        budget = self._context.get_token_budget()
        compaction = self._context.get_compaction_status()
        return {
            "tokens": budget["history_tokens"],
            "max": budget["max_history_tokens"],
            "percent": (
                budget["history_tokens"] / budget["max_history_tokens"] * 100
                if budget["max_history_tokens"] > 0 else 0
            ),
            "session_id": self._session_id,
            "compaction": compaction,
        }

    # ── Context Breakdown ─────────────────────────────────────────

    def get_context_breakdown(self) -> dict:
        """Token/tier breakdown for context viewer and HUD."""
        tc = self._context.token_counter

        # Sync file context before computing
        self._sync_file_context_for_breakdown()

        # System prompt
        if self._mode == Mode.DOC:
            system_text = self._config.get_doc_system_prompt()
        else:
            system_text = self._config.get_system_prompt()
        system_tokens = tc.count(system_text)

        # Legend
        legend_tokens = 0
        if self._mode == Mode.CODE and self._symbol_index:
            legend_tokens = tc.count(self._symbol_index.get_legend())
        elif self._mode == Mode.DOC and self._doc_index:
            legend_tokens = tc.count(self._doc_index.get_legend())

        # Symbol map / doc map
        map_exclude = set(self._selected_files) | self._excluded_index_files
        map_tokens = 0
        map_files = 0
        if self._mode == Mode.CODE and self._symbol_index:
            sm = self._symbol_index.get_symbol_map(exclude_files=map_exclude)
            map_tokens = tc.count(sm)
            map_files = len(self._symbol_index._all_symbols)
        elif self._mode == Mode.DOC and self._doc_index:
            dm = self._doc_index.get_doc_map(exclude_files=map_exclude)
            map_tokens = tc.count(dm)
            map_files = len(self._doc_index._all_outlines)

        # Files
        file_tokens = self._context.file_context.count_tokens(tc)
        file_details = [
            {"name": p.rsplit("/", 1)[-1], "path": p, "tokens": t}
            for p, t in self._context.file_context.get_tokens_by_file(tc).items()
        ]

        # URLs
        url_tokens = 0
        url_details = []
        if self._url_service:
            for uc in self._url_service.get_fetched_urls():
                if uc.error:
                    continue
                formatted = uc.format_for_prompt()
                if formatted:
                    tokens = tc.count(formatted)
                    url_tokens += tokens
                    url_details.append({
                        "name": uc.title or uc.url[:40],
                        "url": uc.url,
                        "tokens": tokens,
                    })

        # History
        history_tokens = self._context.history_token_count()

        total = system_tokens + legend_tokens + map_tokens + file_tokens + url_tokens + history_tokens

        # Build cache blocks from stability tracker
        blocks = self._build_cache_blocks(tc)
        promotions = []
        demotions = []
        tracker = self._get_active_tracker()
        if tracker:
            for change in tracker.get_changes():
                if "📈" in change:
                    promotions.append(change)
                elif "📉" in change:
                    demotions.append(change)

        return {
            "model": self._config.model,
            "mode": self._mode.value,
            "cross_ref_enabled": self._cross_ref_enabled,
            "total_tokens": total,
            "max_input_tokens": tc.max_input_tokens,
            "cache_hit_rate": 0.0,
            "blocks": blocks,
            "promotions": promotions,
            "demotions": demotions,
            "breakdown": {
                "system": system_tokens,
                "legend": legend_tokens,
                "symbol_map": map_tokens,
                "symbol_map_files": map_files,
                "files": file_tokens,
                "file_count": len(self._selected_files),
                "file_details": file_details,
                "urls": url_tokens,
                "url_details": url_details,
                "history": history_tokens,
                "history_messages": len(self._context.get_history()),
            },
            "session_totals": dict(self._session_totals),
        }

    # ── Snippets ──────────────────────────────────────────────────

    def get_snippets(self) -> list[dict]:
        """Mode-aware snippets."""
        if self._review_active:
            return self._config.get_snippets("review")
        if self._mode == Mode.DOC:
            return self._config.get_snippets("doc")
        return self._config.get_snippets("code")

    # ── Commit ────────────────────────────────────────────────────

    def commit_all(self) -> dict:
        """Stage all, generate message, commit. Result via commitResult broadcast."""
        if err := self._check_localhost_only():
            return err
        asyncio.ensure_future(self._do_commit())
        return {"status": "started"}

    async def _do_commit(self):
        """Background commit task."""
        try:
            self._repo.stage_all()
            diff = self._repo.get_staged_diff()
            if not diff or not diff.strip():
                result = {"error": "Nothing to commit (no staged changes)"}
            else:
                loop = asyncio.get_running_loop()
                commit_msg = await loop.run_in_executor(
                    None, self._generate_commit_message, diff,
                )
                commit_result = self._repo.commit(commit_msg)
                result = commit_result
                if "sha" in result:
                    # Add to chat
                    self._context.add_message(
                        "assistant",
                        f"Committed: {result['sha'][:7]} {commit_msg}",
                    )
        except Exception as e:
            result = {"error": str(e)}

        if self._event_callback:
            await self._event_callback("commitResult", result)

    def _generate_commit_message(self, diff_text: str) -> str:
        """Generate commit message via LLM (synchronous, runs in executor)."""
        import litellm
        model = self._config.smaller_model
        prompt = self._config.get_commit_prompt()

        response = litellm.completion(
            model=model,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": diff_text},
            ],
            temperature=0.3,
            max_tokens=500,
        )
        return response.choices[0].message.content.strip()

    def generate_commit_message(self, diff_text: str) -> str:
        """RPC-exposed commit message generation."""
        if err := self._check_localhost_only():
            return err
        if not diff_text or not diff_text.strip():
            return {"error": "Empty diff"}
        return self._generate_commit_message(diff_text)

    # ── Review Mode ───────────────────────────────────────────────

    def check_review_ready(self) -> dict:
        """Check if working tree is clean for review."""
        if self._repo.is_clean():
            return {"clean": True}
        return {
            "clean": False,
            "message": (
                "Cannot enter review mode: working tree has uncommitted changes. "
                "Please commit, stash, or discard changes first."
            ),
        }

    def start_review(self, branch: str, base_commit: str) -> dict:
        """Enter review mode."""
        if err := self._check_localhost_only():
            return err

        if self._review_active:
            return {"error": "Review already active"}

        # Step 1-3: Checkout parent
        checkout_result = self._repo.checkout_review_parent(branch, base_commit)
        if "error" in checkout_result:
            return checkout_result

        branch_tip = checkout_result["branch_tip"]
        parent_commit = checkout_result["parent_commit"]
        original_branch = checkout_result["original_branch"]

        try:
            # Step 4: Build symbol_map_before
            if self._symbol_index:
                self._symbol_index.index_repo()
                self._symbol_map_before = self._symbol_index.get_symbol_map()

            # Step 5-6: Setup soft reset
            setup_result = self._repo.setup_review_soft_reset(branch_tip, parent_commit)
            if "error" in setup_result:
                self._repo.exit_review_mode(branch_tip, original_branch)
                return setup_result

            # Step 7: Clear file selection
            self._selected_files = []
            self._context.file_context.clear()

            # Rebuild symbol index for current (reviewed) code
            if self._symbol_index:
                self._symbol_index.index_repo()

            # Get review info
            commits = self._repo.get_commit_log(base_commit, branch_tip)
            changed_files = self._repo.get_review_changed_files()

            stats = {
                "commit_count": len(commits),
                "files_changed": len(changed_files),
                "additions": sum(f.get("additions", 0) for f in changed_files),
                "deletions": sum(f.get("deletions", 0) for f in changed_files),
            }

            # Store review state
            self._review_active = True
            self._review_branch = branch
            self._review_branch_tip = branch_tip
            self._review_base_commit = base_commit
            self._review_parent = parent_commit
            self._review_original_branch = original_branch
            self._review_commits = commits
            self._review_changed_files = changed_files
            self._review_stats = stats

            # Swap system prompt to review mode
            self._context.set_system_prompt(self._config.get_review_prompt())

            return {
                "status": "review_active",
                "branch": branch,
                "base_commit": base_commit,
                "commits": commits,
                "changed_files": changed_files,
                "stats": stats,
            }

        except Exception as e:
            # Error recovery
            self._repo.exit_review_mode(branch_tip, original_branch)
            return {"error": str(e)}

    def end_review(self) -> dict:
        """Exit review mode."""
        if err := self._check_localhost_only():
            return err

        if not self._review_active:
            return {"error": "No active review"}

        result = self._repo.exit_review_mode(
            self._review_branch_tip, self._review_original_branch,
        )

        # Clear review state
        self._review_active = False
        self._review_branch = None
        self._review_branch_tip = None
        self._review_base_commit = None
        self._review_parent = None
        self._review_original_branch = None
        self._review_commits = []
        self._review_changed_files = []
        self._review_stats = {}
        self._symbol_map_before = ""

        # Restore system prompt
        if self._mode == Mode.DOC:
            self._context.set_system_prompt(self._config.get_doc_system_prompt())
        else:
            self._context.set_system_prompt(self._config.get_system_prompt())

        # Rebuild symbol index
        if self._symbol_index:
            self._symbol_index.index_repo()

        return result

    def get_review_state(self) -> dict:
        """Current review mode state."""
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

    def get_review_file_diff(self, path: str) -> dict:
        """Single file review diff."""
        return self._repo.get_review_file_diff(path)

    def get_commit_graph(self, limit: int = 100, offset: int = 0,
                         include_remote: bool = False) -> dict:
        """Delegates to repo for review selector."""
        return self._repo.get_commit_graph(limit, offset, include_remote)

    # ── URL Handling ──────────────────────────────────────────────

    def detect_urls(self, text: str) -> list[dict]:
        return self._get_url_service().detect_urls(text)

    def fetch_url(self, url: str, use_cache: bool = True,
                  summarize: bool = False, summary_type: Optional[str] = None,
                  user_text: Optional[str] = None) -> dict:
        result = self._get_url_service().fetch_url(
            url, use_cache=use_cache, summarize=summarize,
            summary_type=summary_type, user_text=user_text,
        )
        return result.to_dict()

    def detect_and_fetch(self, text: str, use_cache: bool = True,
                         summarize: bool = False) -> list[dict]:
        results = self._get_url_service().detect_and_fetch(
            text, use_cache=use_cache, summarize=summarize,
        )
        return [r.to_dict() for r in results]

    def get_url_content(self, url: str) -> dict:
        return self._get_url_service().get_url_content(url).to_dict()

    def invalidate_url_cache(self, url: str) -> dict:
        return self._get_url_service().invalidate_url_cache(url)

    def remove_fetched_url(self, url: str) -> dict:
        return self._get_url_service().remove_fetched(url)

    def clear_url_cache(self) -> dict:
        return self._get_url_service().clear_url_cache()

    # ── LSP ───────────────────────────────────────────────────────

    def lsp_get_hover(self, path: str, line: int, col: int) -> Optional[dict]:
        if self._symbol_index:
            return self._symbol_index.lsp_get_hover(path, line, col)
        return None

    def lsp_get_definition(self, path: str, line: int, col: int) -> Optional[dict]:
        if self._symbol_index:
            return self._symbol_index.lsp_get_definition(path, line, col)
        return None

    def lsp_get_references(self, path: str, line: int, col: int) -> list[dict]:
        if self._symbol_index:
            return self._symbol_index.lsp_get_references(path, line, col)
        return []

    def lsp_get_completions(self, path: str, line: int, col: int,
                            prefix: Optional[str] = None) -> list[dict]:
        if self._symbol_index:
            return self._symbol_index.lsp_get_completions(path, line, col, prefix)
        return []

    # ── File Navigation ───────────────────────────────────────────

    def navigate_file(self, path: str) -> dict:
        """Broadcast file navigation to all clients."""
        if self._event_callback:
            asyncio.ensure_future(
                self._event_callback("navigateFile", {"path": path})
            )
        return {"status": "ok", "path": path}

    # ── Private Helpers ───────────────────────────────────────────

    def _check_localhost_only(self):
        """Returns None if allowed, or error dict if restricted."""
        if self._collab and not self._collab._is_caller_localhost():
            return {"error": "restricted", "reason": "Participants cannot perform this action"}
        return None

    def _get_active_tracker(self) -> Optional[StabilityTracker]:
        """Get the tracker for the current mode."""
        if self._mode == Mode.CODE:
            return self._code_tracker
        return self._doc_tracker

    def _get_url_service(self):
        """Lazily create URL service."""
        if self._url_service is None:
            from ac_dc.url_service.service import URLService
            url_config = self._config.app_config.get("url_cache", {})
            self._url_service = URLService(
                cache_dir=url_config.get("path") or None,
                ttl_hours=url_config.get("ttl_hours", 24),
                model=self._config.smaller_model,
            )
        return self._url_service

    def _sync_file_context(self, files: Optional[list[str]] = None):
        """Sync file context with selected files, removing deselected."""
        if files is not None:
            self._selected_files = list(files)

        current = set(self._context.file_context.get_files())
        selected = set(self._selected_files)

        # Remove deselected
        for path in current - selected:
            self._context.file_context.remove_file(path)

        # Add newly selected
        binary_files = []
        invalid_files = []
        for path in selected - current:
            if self._repo.is_binary_file(path):
                binary_files.append(path)
                continue
            if not self._repo.file_exists(path):
                invalid_files.append(path)
                continue
            content = self._repo.get_file_content(path)
            if isinstance(content, dict) and "error" in content:
                invalid_files.append(path)
                continue
            self._context.file_context.add_file(path, content)

    def _build_cache_blocks(self, tc) -> list[dict]:
        """Build cache block info for the cache viewer."""
        tracker = self._get_active_tracker()
        if not tracker:
            return []

        blocks = []
        for tier in (Tier.L0, Tier.L1, Tier.L2, Tier.L3, Tier.ACTIVE):
            tier_items = tracker.get_tier_items(tier)
            if not tier_items and tier != Tier.ACTIVE:
                continue

            contents = []
            tier_tokens = 0
            for key, item in tier_items.items():
                entry = {
                    "type": key.split(":")[0],
                    "name": key.split(":", 1)[1] if ":" in key else key,
                    "tokens": item.tokens,
                }
                if key.startswith(("sym:", "doc:", "file:")):
                    entry["path"] = key.split(":", 1)[1]
                if item.tier != Tier.ACTIVE:
                    promo_n = None
                    from ac_dc.context.stability_tracker import TIER_CONFIG
                    cfg = TIER_CONFIG.get(item.tier)
                    if cfg:
                        promo_n = cfg.get("promotion_n")
                    entry["n"] = item.n
                    entry["threshold"] = promo_n
                tier_tokens += item.tokens
                contents.append(entry)

            blocks.append({
                "name": tier.value,
                "tier": tier.value,
                "tokens": tier_tokens,
                "count": len(tier_items),
                "cached": tier != Tier.ACTIVE,
                "contents": contents,
            })

        return blocks

    def _sync_file_context_for_breakdown(self):
        """Sync file context for breakdown computation (silent)."""
        current = set(self._context.file_context.get_files())
        selected = set(self._selected_files)

        for path in current - selected:
            self._context.file_context.remove_file(path)

        for path in selected - current:
            if self._repo.is_binary_file(path):
                continue
            if not self._repo.file_exists(path):
                continue
            content = self._repo.get_file_content(path)
            if isinstance(content, dict):
                continue
            self._context.file_context.add_file(path, content)

    def _try_initialize_stability(self):
        """Initialize stability tracker from reference graph."""
        try:
            if self._symbol_index and not self._code_tracker:
                self._symbol_index.index_repo()
                ref_index = self._symbol_index.ref_index
                all_files = list(self._symbol_index._all_symbols.keys())

                self._code_tracker = StabilityTracker(
                    cache_target_tokens=self._config.get_cache_target_tokens(
                        self._config.model
                    ),
                )
                self._code_tracker.initialize_from_reference_graph(
                    file_ref_counts={
                        f: ref_index.file_ref_count(f) for f in all_files
                    },
                    connected_components=ref_index.connected_components(),
                    all_files=all_files,
                    key_prefix="sym:",
                )

                # Measure real tokens
                self._measure_tracker_tokens(self._code_tracker)

                self._stability_initialized = True
                logger.info(
                    f"Stability initialized: {self._code_tracker.get_tier_counts()}"
                )

        except Exception as e:
            logger.warning(f"Stability initialization failed: {e}")

    def _measure_tracker_tokens(self, tracker: StabilityTracker):
        """Replace placeholder tokens with real measurements."""
        tc = self._context.token_counter
        for key, item in tracker.get_all_items().items():
            if key.startswith("sym:"):
                path = key.split(":", 1)[1]
                if self._symbol_index:
                    block = self._symbol_index.get_file_symbol_block(path)
                    if block:
                        item.tokens = tc.count(block)
                        from ac_dc.symbol_index.cache import SymbolCache
                        item.content_hash = (
                            self._symbol_index.cache.get_content_hash(path) or ""
                        )
            elif key.startswith("doc:"):
                path = key.split(":", 1)[1]
                if self._doc_index:
                    block = self._doc_index.get_file_doc_block(path)
                    if block:
                        item.tokens = tc.count(block)

    def _update_stability(self, tracker: StabilityTracker):
        """Build active items and run tracker update."""
        if not tracker:
            return

        tc = self._context.token_counter
        active_items = {}

        # Selected files
        for path in self._selected_files:
            if path in self._excluded_index_files:
                continue
            content = self._context.file_context.get_content(path)
            if content:
                h = hashlib.sha256(content.encode()).hexdigest()[:16]
                active_items[f"file:{path}"] = {
                    "hash": h,
                    "tokens": tc.count(content),
                }

            # Index entries for selected files
            prefix = "sym:" if self._mode == Mode.CODE else "doc:"
            idx = self._symbol_index if self._mode == Mode.CODE else self._doc_index
            if idx:
                block_method = (
                    idx.get_file_symbol_block if self._mode == Mode.CODE
                    else idx.get_file_doc_block
                )
                block = block_method(path)
                if block:
                    bh = hashlib.sha256(block.encode()).hexdigest()[:16]
                    active_items[f"{prefix}{path}"] = {
                        "hash": bh,
                        "tokens": tc.count(block),
                    }

        # History
        history = self._context.get_history()
        for i, msg in enumerate(history):
            key = f"history:{i}"
            if not tracker.is_graduated(key):
                h = hashlib.sha256(
                    f"{msg['role']}:{msg['content']}".encode()
                ).hexdigest()[:16]
                active_items[key] = {
                    "hash": h,
                    "tokens": tc.count(msg),
                }

        # Fetched URL content
        if self._url_service:
            from ac_dc.url_service.models import url_hash as compute_url_hash
            for uc in self._url_service.get_fetched_urls():
                if uc.error:
                    continue
                uh = compute_url_hash(uc.url)
                formatted = uc.format_for_prompt()
                if formatted:
                    h = hashlib.sha256(formatted.encode()).hexdigest()[:16]
                    active_items[f"url:{uh}"] = {
                        "hash": h,
                        "tokens": tc.count(formatted),
                    }

        # Run update
        file_list_str = self._repo.get_flat_file_list()
        existing = set(file_list_str.splitlines()) if file_list_str else set()
        tracker.update(active_items, existing_files=existing)

    def _build_tiered_content(self, tracker: StabilityTracker) -> dict:
        """Build tiered_content dict from stability tracker state."""
        if not tracker:
            return {}

        tiered = {}
        for tier in (Tier.L0, Tier.L1, Tier.L2, Tier.L3, Tier.ACTIVE):
            tier_items = tracker.get_tier_items(tier)
            symbols_text = ""
            files_text = ""
            history_messages = []

            for key, item in tier_items.items():
                if key.startswith("sym:"):
                    path = key.split(":", 1)[1]
                    if self._symbol_index:
                        block = self._symbol_index.get_file_symbol_block(path)
                        if block:
                            symbols_text += block + "\n"
                elif key.startswith("doc:"):
                    path = key.split(":", 1)[1]
                    if self._doc_index:
                        block = self._doc_index.get_file_doc_block(path)
                        if block:
                            symbols_text += block + "\n"
                elif key.startswith("file:"):
                    path = key.split(":", 1)[1]
                    content = self._context.file_context.get_content(path)
                    if content:
                        files_text += f"{path}\n```\n{content}\n```\n\n"
                elif key.startswith("url:"):
                    url_hash = key.split(":", 1)[1]
                    url_svc = self._get_url_service()
                    for uc in url_svc.get_fetched_urls():
                        from ac_dc.url_service.models import url_hash as compute_hash
                        if compute_hash(uc.url) == url_hash:
                            formatted = uc.format_for_prompt()
                            if formatted:
                                files_text += "\n---\n" + formatted + "\n"
                            break
                elif key.startswith("history:"):
                    idx_str = key.split(":", 1)[1]
                    try:
                        idx = int(idx_str)
                        history = self._context.get_history()
                        if 0 <= idx < len(history):
                            history_messages.append(history[idx])
                    except (ValueError, IndexError):
                        pass

            tiered[tier.value] = {
                "symbols": symbols_text.rstrip(),
                "files": files_text.rstrip(),
                "history": history_messages,
            }

        return tiered

    def _get_maps_and_legends(
        self, exclude: set[str],
    ) -> tuple[str, str, Optional[str]]:
        """Get symbol map/doc map and legends based on current mode."""
        symbol_map = ""
        symbol_legend = ""
        doc_legend = None

        if self._mode == Mode.CODE:
            if self._symbol_index:
                symbol_map = self._symbol_index.get_symbol_map(exclude_files=exclude)
                symbol_legend = self._symbol_index.get_legend()
            if self._cross_ref_enabled and self._doc_index:
                doc_legend = self._doc_index.get_legend()
        else:
            if self._doc_index:
                symbol_map = self._doc_index.get_doc_map(exclude_files=exclude)
                symbol_legend = self._doc_index.get_legend()
            if self._cross_ref_enabled and self._symbol_index:
                doc_legend = self._symbol_index.get_legend()

        return symbol_map, symbol_legend, doc_legend

    def _init_cross_ref_items(self, tracker: StabilityTracker):
        """Initialize cross-reference items from the other index."""
        if self._mode == Mode.CODE and self._doc_index:
            ref_index = self._doc_index.ref_index
            all_files = list(self._doc_index._all_outlines.keys())
            if all_files:
                tracker.initialize_from_reference_graph(
                    file_ref_counts={
                        f: ref_index.file_ref_count(f) for f in all_files
                    },
                    connected_components=ref_index.connected_components(),
                    all_files=all_files,
                    key_prefix="doc:",
                )
        elif self._mode == Mode.DOC and self._symbol_index:
            ref_index = self._symbol_index.ref_index
            all_files = list(self._symbol_index._all_symbols.keys())
            if all_files:
                tracker.initialize_from_reference_graph(
                    file_ref_counts={
                        f: ref_index.file_ref_count(f) for f in all_files
                    },
                    connected_components=ref_index.connected_components(),
                    all_files=all_files,
                    key_prefix="sym:",
                )

    def _build_review_context(self) -> str:
        """Build review context block for LLM prompt."""
        if not self._review_active:
            return ""

        parts = []

        # Summary
        parent_short = (self._review_parent or "")[:7]
        tip_short = (self._review_branch_tip or "")[:7]
        parts.append(
            f"## Review: {self._review_branch} ({parent_short} → {tip_short})\n"
            f"{self._review_stats.get('commit_count', 0)} commits, "
            f"{self._review_stats.get('files_changed', 0)} files changed, "
            f"+{self._review_stats.get('additions', 0)} "
            f"-{self._review_stats.get('deletions', 0)}"
        )

        # Commits
        if self._review_commits:
            parts.append("\n## Commits")
            for i, c in enumerate(self._review_commits, 1):
                parts.append(
                    f"{i}. {c.get('short_sha', '')} {c.get('message', '')} "
                    f"({c.get('author', '')})"
                )

        # Pre-change symbol map
        if self._symbol_map_before:
            parts.append(
                "\n## Pre-Change Symbol Map\n"
                "Symbol map from the parent commit (before the reviewed changes).\n"
                "Compare against the current symbol map in the repository structure above.\n"
            )
            parts.append(self._symbol_map_before)

        # Reverse diffs for selected files
        changed_paths = {f["path"] for f in self._review_changed_files}
        selected_changed = [p for p in self._selected_files if p in changed_paths]
        if selected_changed:
            parts.append("\n## Reverse Diffs (selected files)")
            parts.append(
                "These diffs show what would revert each file to the pre-review state."
            )
            for path in selected_changed:
                diff_result = self._repo.get_review_file_diff(path)
                diff_text = diff_result.get("diff", "")
                if diff_text:
                    parts.append(f"\n### {path}\n```diff\n{diff_text}\n```")

        return "\n".join(parts)

    async def _fetch_urls_from_message(
        self, request_id: str, message: str,
    ) -> str:
        """Detect and fetch up to 3 URLs from the user message."""
        url_svc = self._get_url_service()
        detected = url_svc.detect_urls(message)

        fetched_urls = url_svc.get_fetched_urls()
        already_fetched = {c.url for c in fetched_urls}

        count = 0
        for d in detected:
            if count >= 3:
                break
            url = d["url"]
            if url in already_fetched:
                continue

            # Notify client
            if self._event_callback:
                await self._event_callback("compactionEvent", request_id, {
                    "stage": "url_fetch",
                    "message": f"Fetching {d['display_name']}...",
                })

            try:
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(
                    None, url_svc.fetch_url, url, True, True,
                )
                count += 1

                if self._event_callback:
                    await self._event_callback("compactionEvent", request_id, {
                        "stage": "url_ready",
                        "message": f"Fetched {d['display_name']}",
                    })
            except Exception as e:
                logger.warning(f"URL fetch failed for {url}: {e}")

        # Format URL context
        return url_svc.format_url_context()

    async def _run_deferred_enrichment(self, request_id: str, paths: list[str]):
        """Run keyword enrichment for modified doc files (non-blocking background)."""
        try:
            enrichable = self._doc_index.queue_enrichment(paths)
            if not enrichable:
                return

            if self._event_callback:
                await self._event_callback("compactionEvent", request_id, {
                    "stage": "doc_enrichment_queued",
                    "files": enrichable,
                })

            loop = asyncio.get_running_loop()
            for path in enrichable:
                try:
                    await loop.run_in_executor(
                        None, self._doc_index.enrich_single_file, path,
                    )
                    await asyncio.sleep(0)  # Yield for pings

                    if self._event_callback:
                        await self._event_callback("compactionEvent", request_id, {
                            "stage": "doc_enrichment_file_done",
                            "file": path,
                        })
                except Exception as e:
                    logger.warning(f"Deferred enrichment failed for {path}: {e}")
                    if self._event_callback:
                        await self._event_callback("compactionEvent", request_id, {
                            "stage": "doc_enrichment_failed",
                            "file": path,
                            "error": str(e),
                        })

            if self._event_callback:
                await self._event_callback("compactionEvent", request_id, {
                    "stage": "doc_enrichment_complete",
                })
        except Exception as e:
            logger.warning(f"Deferred enrichment error: {e}")

    async def _post_response_compaction(self, request_id: str):
        """Run history compaction after response if threshold exceeded."""
        config = self._config.history_compaction_config
        if not config.get("enabled", True):
            return
        if not self._context.should_compact():
            return

        # Notify start
        if self._event_callback:
            await self._event_callback("compactionEvent", request_id, {
                "stage": "compaction_start",
            })

        try:
            compactor = HistoryCompactor(
                config=config,
                detection_model=self._config.smaller_model,
                skill_prompt=self._config.get_compaction_prompt(),
            )
            history = self._context.get_history()
            result = compactor.compact(history, self._context.token_counter)

            if result.case != "none":
                self._context.set_history(result.messages)
                self._context.reregister_history_items()
                tracker = self._get_active_tracker()
                if tracker:
                    tracker.purge_history()

            if self._event_callback:
                await self._event_callback("compactionEvent", request_id, {
                    "stage": "compaction_complete",
                    "case": result.case,
                })

        except Exception as e:
            logger.warning(f"Compaction failed: {e}")
            if self._event_callback:
                await self._event_callback("compactionEvent", request_id, {
                    "stage": "compaction_error",
                    "message": str(e),
                })