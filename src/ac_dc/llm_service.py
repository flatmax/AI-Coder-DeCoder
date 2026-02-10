"""LLM service — orchestrates context, streaming, and edit application."""

import asyncio
import concurrent.futures
import logging
import re
import threading
import time
import traceback
import uuid
from pathlib import Path
from typing import Any, Optional

from .config import ConfigManager
from .context import ContextManager, COMMIT_MSG_SYSTEM
from .edit_parser import parse_edit_blocks, apply_edits_to_repo, EditStatus
from .history_store import HistoryStore
from .repo import Repo
from .stability_tracker import Tier, ItemType, _hash_content
from .token_counter import TokenCounter

log = logging.getLogger(__name__)

# Thread pool for blocking LLM calls
_executor = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix="llm")


def _init_symbol_index(repo_root: Path):
    """Initialize symbol index, returning None if tree-sitter unavailable."""
    try:
        from .symbol_index import SymbolIndex
        idx = SymbolIndex(repo_root)
        if idx.available:
            return idx
        log.warning("Tree-sitter not available — symbol index disabled")
    except Exception as e:
        log.warning("Symbol index init failed: %s", e)
    return None


def _detect_shell_commands(text: str) -> list[str]:
    """Extract shell command suggestions from LLM response."""
    commands = []
    # Match: ```bash/sh/shell blocks
    for m in re.finditer(r"```(?:bash|sh|shell)\n(.*?)```", text, re.DOTALL):
        for line in m.group(1).strip().splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                commands.append(line)
    # Match: $ command or > command at line start
    for m in re.finditer(r"^[>$]\s+(.+)$", text, re.MULTILINE):
        cmd = m.group(1).strip()
        if cmd:
            commands.append(cmd)
    return commands


class LLM:
    """LLM service exposed via RPC.

    All public methods become remotely callable as LLM.<method_name>.
    """

    def __init__(self, config: ConfigManager, repo: Repo):
        self._config = config
        self._repo = repo
        self._model = config.get_llm_config().get("model", "")
        self._smaller_model = config.get_llm_config().get("smaller_model", "")
        self._counter = TokenCounter(self._model)

        # Context manager
        compaction_config = config.get_app_config().get("history_compaction", {})
        self._context = ContextManager(
            model_name=self._model,
            repo_root=repo.root,
            cache_target_tokens=config.cache_target_tokens,
            compaction_config=compaction_config,
        )

        # Initialize compactor with detection model
        skill_prompt = config.get_compaction_prompt()
        if self._smaller_model and skill_prompt and compaction_config.get("enabled", True):
            self._context.init_compactor(self._smaller_model, skill_prompt)

        # History store (persistent JSONL)
        self._history_store = HistoryStore(config.ac_dc_dir)

        # Symbol index
        self._symbol_index = _init_symbol_index(repo.root)
        if self._symbol_index:
            self._build_symbol_index()
            self._init_stability()

        # Session state
        self._session_id = self._new_session_id()
        self._selected_files: list[str] = []
        self._streaming_active = False
        self._active_request_id: Optional[str] = None
        self._cancelled: set[str] = set()  # Thread-safe via GIL for simple set ops

        # Server reference — set by main.py after server creation
        self._server = None

        # Session token totals
        self._session_totals = {
            "prompt": 0, "completion": 0, "total": 0,
            "cache_hit": 0, "cache_write": 0,
        }

    def _new_session_id(self) -> str:
        return f"sess_{int(time.time() * 1000)}_{uuid.uuid4().hex[:6]}"

    # ------------------------------------------------------------------
    # State management
    # ------------------------------------------------------------------

    def get_current_state(self) -> dict:
        """Return current session state for client reconnection."""
        return {
            "messages": self._context.get_history(),
            "selected_files": list(self._selected_files),
            "streaming_active": self._streaming_active,
            "session_id": self._session_id,
        }

    def set_selected_files(self, files: list[str]) -> dict:
        """Update selected files list."""
        self._selected_files = list(files)
        return {"ok": True, "selected_files": self._selected_files}

    def get_selected_files(self) -> list[str]:
        return list(self._selected_files)

    # ------------------------------------------------------------------
    # Chat streaming
    # ------------------------------------------------------------------

    def chat_streaming(self, request_id: str, message: str,
                       files: list[str] = None, images: list[str] = None) -> dict:
        """Start a streaming chat request."""
        if self._streaming_active:
            return {"error": "A stream is already active"}

        self._streaming_active = True
        self._active_request_id = request_id

        # Launch background task
        loop = asyncio.get_event_loop()
        loop.create_task(self._stream_chat(request_id, message, files or [], images or []))

        return {"status": "started"}

    def cancel_streaming(self, request_id: str) -> dict:
        """Cancel an active streaming request."""
        if self._active_request_id == request_id:
            self._cancelled.add(request_id)
            return {"ok": True}
        return {"error": "No matching active stream"}

    async def _stream_chat(self, request_id: str, message: str,
                           files: list[str], images: list[str]):
        """Background task: assemble prompt, stream LLM, apply edits."""
        result = {
            "response": "",
            "token_usage": {},
            "edit_blocks": [],
            "shell_commands": [],
            "passed": [],
            "failed": [],
            "skipped": [],
            "files_modified": [],
            "edit_results": [],
            "binary_files": [],
            "invalid_files": [],
        }

        try:
            # -- Validate files --
            valid_files: list[str] = []
            for fpath in files:
                if self._repo.is_binary_file(fpath):
                    result["binary_files"].append(fpath)
                elif not self._repo.file_exists(fpath):
                    result["invalid_files"].append(fpath)
                else:
                    valid_files.append(fpath)

            if result["binary_files"] or result["invalid_files"]:
                err_parts = []
                if result["binary_files"]:
                    err_parts.append(f"Binary files rejected: {', '.join(result['binary_files'])}")
                if result["invalid_files"]:
                    err_parts.append(f"Files not found: {', '.join(result['invalid_files'])}")
                result["error"] = "; ".join(err_parts)

            # -- Load files into context --
            self._context.file_context.clear()
            for fpath in valid_files:
                self._context.file_context.add_file(fpath)

            # -- Rebuild symbol index before request --
            if self._symbol_index:
                try:
                    self._symbol_index.index_repo()
                    self._save_symbol_map()
                except Exception as e:
                    log.warning("Symbol index rebuild failed: %s", e)

            # -- Assemble prompt --
            system_prompt = self._config.get_system_prompt()
            file_tree = self._repo.get_flat_file_list()

            # Pre-request shedding (Layer 3 defense)
            symbol_map = ""
            if self._symbol_index:
                symbol_map = self._symbol_index.get_symbol_map(
                    exclude_files=set(valid_files),
                )
            shed = self._context.shed_files_if_needed(
                message, system_prompt, symbol_map, file_tree,
            )
            if shed:
                result["shed_files"] = shed
                log.warning("Shed files due to budget: %s", shed)

            # Emergency truncation (Layer 2 defense)
            self._context.emergency_truncate()

            # Build messages — tiered if stability tracker has content
            if self._context.has_tiered_content and self._symbol_index:
                symbol_blocks, file_contents = self._gather_tiered_content(valid_files)
                legend = self._symbol_index.get_legend()
                messages = self._context.assemble_tiered_messages(
                    user_prompt=message,
                    system_prompt=system_prompt,
                    symbol_map_legend=legend,
                    symbol_blocks=symbol_blocks,
                    file_contents=file_contents,
                    file_tree=file_tree,
                    images=images or None,
                )
            else:
                messages = self._context.assemble_messages(
                    user_prompt=message,
                    system_prompt=system_prompt,
                    symbol_map=symbol_map,
                    file_tree=file_tree,
                    images=images or None,
                )

            # -- Persist user message --
            self._history_store.append_message(
                session_id=self._session_id,
                role="user",
                content=message,
                files=valid_files or None,
                images=len(images) if images else 0,
            )

            # -- Stream LLM completion --
            full_content, was_cancelled, usage = await self._run_llm_stream(
                request_id, messages,
            )

            result["response"] = full_content
            result["token_usage"] = usage

            if was_cancelled:
                result["cancelled"] = True
                full_content += "\n\n[stopped]"
                self._context.add_exchange(message, full_content)
                # Persist cancelled response
                self._history_store.append_message(
                    session_id=self._session_id,
                    role="assistant",
                    content=full_content,
                )
            else:
                # -- Add exchange to context --
                self._context.add_exchange(message, full_content)

                # -- Parse and apply edit blocks --
                blocks = parse_edit_blocks(full_content)
                result["shell_commands"] = _detect_shell_commands(full_content)

                if blocks:
                    result["edit_blocks"] = [
                        {"file": b.file_path, "is_create": b.is_create}
                        for b in blocks
                    ]

                    edit_results = apply_edits_to_repo(blocks, self._repo.root)
                    files_modified = []

                    for er in edit_results:
                        er_dict = {
                            "file_path": er.file_path,
                            "status": er.status.name.lower(),
                            "error": er.error,
                        }
                        result["edit_results"].append(er_dict)

                        if er.status == EditStatus.APPLIED:
                            result["passed"].append(er.file_path)
                            files_modified.append(er.file_path)
                        elif er.status == EditStatus.FAILED:
                            result["failed"].append({
                                "file": er.file_path,
                                "error": er.error,
                            })
                        elif er.status == EditStatus.SKIPPED:
                            result["skipped"].append(er.file_path)

                    result["files_modified"] = files_modified

                    # Stage modified files
                    if files_modified:
                        self._repo.stage_files(files_modified)

                    # Invalidate symbol cache for modified files
                    if files_modified and self._symbol_index:
                        self._symbol_index.invalidate_files(files_modified)

                # -- Persist assistant message --
                self._history_store.append_message(
                    session_id=self._session_id,
                    role="assistant",
                    content=full_content,
                    files_modified=result.get("files_modified") or None,
                    edit_results=result.get("edit_results") or None,
                )

            # -- Update stability tracker --
            self._update_stability(valid_files, result.get("files_modified", []))

            # -- Save symbol map --
            self._save_symbol_map()

            # -- Update session totals --
            if usage:
                self._session_totals["prompt"] += usage.get("prompt_tokens", 0)
                self._session_totals["completion"] += usage.get("completion_tokens", 0)
                self._session_totals["total"] += usage.get("total_tokens", 0)
                self._session_totals["cache_hit"] += usage.get("cache_read_tokens", 0)
                self._session_totals["cache_write"] += usage.get("cache_creation_tokens", 0)

            # -- Print terminal report --
            self._print_usage_report(result)

        except Exception as e:
            log.error("Streaming error: %s\n%s", e, traceback.format_exc())
            result["error"] = str(e)

        finally:
            self._streaming_active = False
            self._active_request_id = None
            self._cancelled.discard(request_id)

            # Send completion
            await self._send_stream_complete(request_id, result)

            # Post-response compaction (non-blocking)
            if not result.get("cancelled") and not result.get("error"):
                await self._post_response_compaction(request_id)

    async def _run_llm_stream(
        self, request_id: str, messages: list[dict],
    ) -> tuple[str, bool, dict]:
        """Run LLM streaming in a thread. Returns (content, cancelled, usage)."""
        loop = asyncio.get_event_loop()

        full_content = ""
        was_cancelled = False
        usage = {}

        def _blocking_stream():
            nonlocal full_content, was_cancelled, usage
            try:
                import litellm
                response = litellm.completion(
                    model=self._model,
                    messages=messages,
                    stream=True,
                )

                for chunk in response:
                    if request_id in self._cancelled:
                        was_cancelled = True
                        break

                    delta = chunk.choices[0].delta if chunk.choices else None
                    if delta and delta.content:
                        full_content += delta.content
                        # Fire chunk callback (fire-and-forget)
                        asyncio.run_coroutine_threadsafe(
                            self._send_chunk(request_id, full_content),
                            loop,
                        )

                    # Capture usage from final chunk
                    if hasattr(chunk, "usage") and chunk.usage:
                        usage = {
                            "prompt_tokens": getattr(chunk.usage, "prompt_tokens", 0) or 0,
                            "completion_tokens": getattr(chunk.usage, "completion_tokens", 0) or 0,
                            "total_tokens": getattr(chunk.usage, "total_tokens", 0) or 0,
                            "cache_read_tokens": getattr(chunk.usage, "cache_read_input_tokens", 0) or 0,
                            "cache_creation_tokens": getattr(chunk.usage, "cache_creation_input_tokens", 0) or 0,
                        }

            except Exception as e:
                log.error("LLM call failed: %s", e)
                if not full_content:
                    full_content = f"[Error: {e}]"

        await loop.run_in_executor(_executor, _blocking_stream)
        return full_content, was_cancelled, usage

    async def _send_chunk(self, request_id: str, content: str):
        """Send a streaming chunk to the client via RPC callback."""
        if self._server is None:
            return
        try:
            await asyncio.wait_for(
                self._server.call["streamChunk"](request_id, content),
                timeout=5.0,
            )
        except Exception as e:
            log.debug("Chunk send failed: %s", e)

    async def _send_stream_complete(self, request_id: str, result: dict):
        """Send stream completion to the client."""
        if self._server is None:
            return
        try:
            await asyncio.wait_for(
                self._server.call["streamComplete"](request_id, result),
                timeout=5.0,
            )
        except Exception as e:
            log.warning("streamComplete send failed: %s", e)

    # ------------------------------------------------------------------
    # Commit message generation
    # ------------------------------------------------------------------

    def generate_commit_message(self, diff: str) -> dict:
        """Generate a commit message from a diff using a smaller/cheaper model."""
        if not diff or not diff.strip():
            return {"error": "No diff provided"}

        smaller_model = self._config.get_llm_config().get("smaller_model", self._model)
        messages = [
            {"role": "system", "content": COMMIT_MSG_SYSTEM},
            {"role": "user", "content": f"Generate a commit message for this diff:\n\n{diff}"},
        ]

        try:
            import litellm
            response = litellm.completion(
                model=smaller_model,
                messages=messages,
                stream=False,
            )
            msg = response.choices[0].message.content.strip()
            # Track usage
            if hasattr(response, "usage") and response.usage:
                self._session_totals["prompt"] += getattr(response.usage, "prompt_tokens", 0) or 0
                self._session_totals["completion"] += getattr(response.usage, "completion_tokens", 0) or 0
                self._session_totals["total"] += getattr(response.usage, "total_tokens", 0) or 0
            return {"message": msg}
        except Exception as e:
            log.error("Commit message generation failed: %s", e)
            return {"error": str(e)}

    # ------------------------------------------------------------------
    # History
    # ------------------------------------------------------------------

    def history_new_session(self) -> dict:
        self._session_id = self._new_session_id()
        self._context.clear_history()
        return {"session_id": self._session_id}

    def history_list_sessions(self, limit: int = 20) -> list[dict]:
        return self._history_store.list_sessions(limit)

    def history_get_session(self, session_id: str) -> list[dict]:
        return self._history_store.get_session(session_id)

    def history_search(self, query: str, role: str = None, limit: int = 50) -> list[dict]:
        return self._history_store.search(query, role, limit)

    def load_session_into_context(self, session_id: str) -> dict:
        """Load a previous session into the active context."""
        messages = self._history_store.get_session_messages_for_context(session_id)
        if not messages:
            return {"error": f"Session not found: {session_id}"}
        self._context.clear_history()
        self._session_id = session_id
        for msg in messages:
            self._context.add_message(msg["role"], msg["content"])
        return {"ok": True, "message_count": len(messages), "session_id": session_id}

    # ------------------------------------------------------------------
    # Post-response compaction
    # ------------------------------------------------------------------

    async def _post_response_compaction(self, request_id: str):
        """Run compaction after response delivery if needed."""
        if not self._context.should_compact():
            return

        try:
            # Brief pause to let frontend process completion
            await asyncio.sleep(0.5)

            # Notify start
            await self._send_compaction_event(request_id, {
                "type": "compaction_start",
            })

            # Run compaction (may involve LLM call — run in executor)
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                _executor,
                self._context.compact_history_if_needed,
            )

            if result is None or result.get("case") == "none":
                await self._send_compaction_event(request_id, {
                    "type": "compaction_complete",
                    "case": "none",
                })
                return

            # Track compaction LLM usage in session totals
            # (topic detection usage is internal to the detector)

            await self._send_compaction_event(request_id, {
                "type": "compaction_complete",
                "case": result["case"],
                "messages_before": result.get("messages_before", 0),
                "messages_after": result.get("messages_after", 0),
                "tokens_before": result.get("tokens_before", 0),
                "tokens_after": result.get("tokens_after", 0),
                "summary": result.get("summary", ""),
                "messages": self._context.get_history(),
            })

            log.info(
                "Compaction complete: %s, %d → %d messages",
                result["case"],
                result.get("messages_before", 0),
                result.get("messages_after", 0),
            )

        except Exception as e:
            log.error("Compaction error: %s", e)
            await self._send_compaction_event(request_id, {
                "type": "compaction_error",
                "error": str(e),
            })

    async def _send_compaction_event(self, request_id: str, event: dict):
        """Send a compaction event to the client."""
        if self._server is None:
            return
        try:
            await asyncio.wait_for(
                self._server.call["compactionEvent"](request_id, event),
                timeout=5.0,
            )
        except Exception as e:
            log.debug("Compaction event send failed: %s", e)

    # ------------------------------------------------------------------
    # Context info
    # ------------------------------------------------------------------

    def get_context_breakdown(self, selected_files: list[str] = None,
                               included_urls: list[str] = None) -> dict:
        """Return context breakdown for the UI viewers."""
        system_prompt = self._config.get_system_prompt()
        system_tokens = self._counter.count(system_prompt)

        symbol_map_tokens = 0
        symbol_files = 0
        if self._symbol_index:
            sm = self._symbol_index.get_symbol_map(
                exclude_files=set(selected_files or self._selected_files),
            )
            symbol_map_tokens = self._counter.count(sm) if sm else 0
            symbol_files = len(self._symbol_index.all_symbols)

        file_tokens = self._context.file_context.count_tokens(self._counter)
        file_items = []
        for path, tokens in self._context.file_context.get_tokens_by_file(self._counter).items():
            file_items.append({"path": path, "tokens": tokens})

        history_tokens = self._context.history_token_count()

        total = system_tokens + symbol_map_tokens + file_tokens + history_tokens

        # Build cache tier blocks for the cache viewer
        blocks = self._build_tier_blocks()

        # Compute cache stats
        cached_tokens = 0
        for block in blocks:
            if block.get("cached"):
                cached_tokens += block.get("tokens", 0)
        cache_hit_rate = int(cached_tokens / max(1, total) * 100) if total > 0 else 0

        # Get tier changes
        changes = self._context.stability.get_changes()
        promotions = [
            {"key": c.key, "from": c.old_tier.name, "to": c.new_tier.name}
            for c in changes if c.is_promotion
        ]
        demotions = [
            {"key": c.key, "from": c.old_tier.name, "to": c.new_tier.name}
            for c in changes if c.is_demotion
        ]

        return {
            "blocks": blocks,
            "breakdown": {
                "system": {"tokens": system_tokens},
                "symbol_map": {"tokens": symbol_map_tokens, "files": symbol_files, "chunks": []},
                "files": {"tokens": file_tokens, "items": file_items},
                "urls": {"tokens": 0, "items": []},
                "history": {
                    "tokens": history_tokens,
                    "needs_summary": self._context.should_compact(),
                    "max_tokens": self._context.max_history_tokens,
                },
            },
            "total_tokens": total,
            "cached_tokens": cached_tokens,
            "cache_hit_rate": cache_hit_rate,
            "max_input_tokens": self._counter.max_input_tokens,
            "model": self._model,
            "promotions": promotions,
            "demotions": demotions,
            "session_totals": dict(self._session_totals),
        }

    # ------------------------------------------------------------------
    # Terminal reports
    # ------------------------------------------------------------------

    def _build_tier_blocks(self) -> list[dict]:
        """Build tier block info for the cache viewer."""
        blocks = []
        from .stability_tracker import Tier, TIER_CONFIG

        for tier in [Tier.L0, Tier.L1, Tier.L2, Tier.L3, Tier.ACTIVE]:
            items = self._context.stability.get_tier_items(tier)
            if not items and tier != Tier.L0:
                continue

            tokens = self._context.stability.get_tier_tokens(tier)
            config = TIER_CONFIG[tier]

            # Group by type
            contents = []
            symbol_items = [it for it in items if it.item_type == "symbol"]
            file_items = [it for it in items if it.item_type == "file"]
            history_items = [it for it in items if it.item_type == "history"]

            if symbol_items:
                contents.append({
                    "type": "symbols",
                    "count": len(symbol_items),
                    "tokens": sum(it.token_estimate for it in symbol_items),
                    "items": [
                        {
                            "key": it.key,
                            "tokens": it.token_estimate,
                            "n": it.n,
                            "threshold": config.get("promotion_n", config["entry_n"]),
                        }
                        for it in symbol_items
                    ],
                })
            if file_items:
                contents.append({
                    "type": "files",
                    "count": len(file_items),
                    "tokens": sum(it.token_estimate for it in file_items),
                    "items": [
                        {
                            "key": it.key,
                            "tokens": it.token_estimate,
                            "n": it.n,
                            "threshold": config.get("promotion_n", config["entry_n"]),
                        }
                        for it in file_items
                    ],
                })
            if history_items:
                contents.append({
                    "type": "history",
                    "count": len(history_items),
                    "tokens": sum(it.token_estimate for it in history_items),
                })

            blocks.append({
                "tier": config["name"],
                "name": config["name"],
                "tokens": tokens,
                "cached": tier != Tier.ACTIVE and tokens > 0,
                "threshold": self._context.cache_target_tokens,
                "contents": contents,
            })

        return blocks

    def _print_usage_report(self, result: dict):
        """Print token usage and edit results to terminal."""
        usage = result.get("token_usage", {})
        if not usage:
            return

        prompt = usage.get("prompt_tokens", 0)
        completion = usage.get("completion_tokens", 0)
        cache_read = usage.get("cache_read_tokens", 0)
        cache_write = usage.get("cache_creation_tokens", 0)

        log.info(
            "Model: %s | Prompt: %d | Completion: %d | Cache read: %d | Cache write: %d",
            self._model, prompt, completion, cache_read, cache_write,
        )

        # Edit results
        passed = result.get("passed", [])
        failed = result.get("failed", [])
        skipped = result.get("skipped", [])
        if passed or failed or skipped:
            log.info(
                "Edits: %d applied, %d failed, %d skipped",
                len(passed), len(failed), len(skipped),
            )
            for f in failed:
                if isinstance(f, dict):
                    log.warning("  FAILED %s: %s", f.get("file", "?"), f.get("error", "?"))

    # ------------------------------------------------------------------
    # Symbol index
    # ------------------------------------------------------------------

    def _init_stability(self):
        """Initialize stability tracker from the reference graph."""
        if self._symbol_index is None:
            return
        try:
            self._context.initialize_stability(
                self._symbol_index,
                self._symbol_index.reference_index,
            )
        except Exception as e:
            log.warning("Stability initialization failed: %s", e)

    def _update_stability(self, selected_files: list[str], modified_files: list[str]):
        """Update stability tracker after a response."""
        if self._symbol_index is None:
            return
        try:
            # Build symbol blocks for selected files
            symbol_blocks = {}
            for fpath in self._symbol_index.all_symbols:
                key = f"symbol:{fpath}"
                block = self._symbol_index.get_file_block(fpath)
                if block:
                    symbol_blocks[key] = block

            # Build active items
            active_items = self._context.build_active_items(
                selected_files, symbol_blocks,
            )

            # Register unselected symbol entries that aren't already tracked
            for fpath in self._symbol_index.all_symbols:
                key = f"symbol:{fpath}"
                if key not in active_items:
                    item = self._context.stability.get_item(key)
                    if item is None:
                        block = self._symbol_index.get_file_block(fpath)
                        if block:
                            self._context.stability.register_item(
                                key, ItemType.SYMBOL,
                                _hash_content(block),
                                max(1, len(block) // 4),
                            )

            # Get all repo files
            r = self._repo.get_file_tree()
            all_files = set()
            if "tree" in r:
                self._collect_file_paths(r["tree"], all_files)

            # Run the update
            changes = self._context.stability.update_after_response(
                active_items, modified_files, all_files,
            )

            # Log tier changes
            for change in changes:
                if change.is_promotion:
                    log.info("📈 %s → %s: %s",
                             change.old_tier.name, change.new_tier.name, change.key)
                else:
                    log.info("📉 %s → %s: %s",
                             change.old_tier.name, change.new_tier.name, change.key)

        except Exception as e:
            log.warning("Stability update failed: %s", e)

    def _gather_tiered_content(self, selected_files: list[str]) -> tuple[dict, dict]:
        """Gather symbol blocks and file contents for tiered assembly.

        Returns (symbol_blocks, file_contents) keyed by tracker keys.
        """
        symbol_blocks: dict[str, str] = {}
        file_contents: dict[str, str] = {}

        if self._symbol_index is None:
            return symbol_blocks, file_contents

        # Symbol blocks for all files NOT in selected (those are in active context)
        excluded = set(selected_files)
        for fpath, fsyms in self._symbol_index.all_symbols.items():
            if fpath not in excluded:
                key = f"symbol:{fpath}"
                block = self._symbol_index.get_file_block(fpath)
                if block:
                    symbol_blocks[key] = block

        # File contents for files in cached tiers
        from .stability_tracker import Tier
        for tier in [Tier.L0, Tier.L1, Tier.L2, Tier.L3]:
            for item in self._context.stability.get_tier_items(tier):
                if item.item_type == ItemType.FILE:
                    path = item.key.split(":", 1)[1] if ":" in item.key else item.key
                    r = self._repo.get_file_content(path)
                    if "content" in r:
                        file_contents[item.key] = r["content"]

        return symbol_blocks, file_contents

    @staticmethod
    def _collect_file_paths(tree_node: dict, paths: set[str]):
        """Recursively collect file paths from a tree node."""
        if tree_node.get("type") == "file" and tree_node.get("path"):
            paths.add(tree_node["path"])
        for child in tree_node.get("children", []):
            LLM._collect_file_paths(child, paths)

    def _build_symbol_index(self):
        """Build the symbol index from repo files."""
        if self._symbol_index is None:
            return
        try:
            self._symbol_index.index_repo()
            self._save_symbol_map()
        except Exception as e:
            log.warning("Symbol index build failed: %s", e)

    def _save_symbol_map(self):
        """Save symbol map to .ac-dc/symbol_map.txt."""
        if self._symbol_index is None:
            return
        try:
            out_path = self._config.ac_dc_dir / "symbol_map.txt"
            symbol_map = self._symbol_index.get_symbol_map(
                exclude_files=set(self._selected_files),
            )
            out_path.write_text(symbol_map, encoding="utf-8")
        except Exception as e:
            log.warning("Failed to save symbol map: %s", e)

    def rebuild_symbol_index(self) -> dict:
        """Rebuild the symbol index (e.g. after file changes)."""
        if self._symbol_index is None:
            return {"error": "Symbol index not available"}
        self._build_symbol_index()
        return {"ok": True}

    def invalidate_symbol_files(self, file_paths: list[str]):
        """Invalidate symbol cache for modified files."""
        if self._symbol_index:
            self._symbol_index.invalidate_files(file_paths)

    def get_symbol_map(self) -> str:
        """Return the current symbol map text."""
        if self._symbol_index is None:
            return ""
        return self._symbol_index.get_symbol_map(
            exclude_files=set(self._selected_files),
        )

    def get_symbol_map_chunks(self, num_chunks: int = 3) -> list[dict]:
        """Get symbol map split into chunks for cache tier distribution."""
        if self._symbol_index is None:
            return []
        return self._symbol_index.get_symbol_map_chunks(
            exclude_files=set(self._selected_files),
            num_chunks=num_chunks,
        )

    # ------------------------------------------------------------------
    # LSP
    # ------------------------------------------------------------------

    def lsp_get_hover(self, path: str, line: int, col: int) -> str:
        if self._symbol_index is None:
            return ""
        return self._symbol_index.get_hover_info(path, line, col)

    def lsp_get_definition(self, path: str, line: int, col: int) -> Optional[dict]:
        if self._symbol_index is None:
            return None
        return self._symbol_index.get_definition(path, line, col)

    def lsp_get_references(self, path: str, line: int, col: int) -> list[dict]:
        if self._symbol_index is None:
            return []
        return self._symbol_index.get_references(path, line, col)

    def lsp_get_completions(self, path: str, line: int, col: int) -> list[dict]:
        if self._symbol_index is None:
            return []
        try:
            file_result = self._repo.get_file_content(path)
            content = file_result.get("content", "")
            lines = content.splitlines()
            if 0 < line <= len(lines):
                line_text = lines[line - 1]
                prefix = ""
                if col > 0 and col <= len(line_text):
                    i = col - 1
                    while i >= 0 and (line_text[i].isalnum() or line_text[i] == "_"):
                        i -= 1
                    prefix = line_text[i + 1:col]
                return self._symbol_index.get_completions(path, line, col, prefix)
        except Exception:
            pass
        return self._symbol_index.get_completions(path, line, col)
