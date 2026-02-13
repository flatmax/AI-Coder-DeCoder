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
from .url_handler import URLService

log = logging.getLogger(__name__)

# Thread pool for blocking LLM calls
_executor = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix="llm")

# Review context header
REVIEW_CONTEXT_HEADER = "# Code Review Context\n\n"


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

        # URL service
        url_config = config.get_app_config().get("url_cache", {})
        self._url_service = URLService(url_config, self._smaller_model)

        # Session state (must be before symbol index build, which uses _selected_files)
        self._session_id = self._new_session_id()
        self._selected_files: list[str] = []
        self._streaming_active = False

        # Symbol index
        self._symbol_index = _init_symbol_index(repo.root)
        if self._symbol_index:
            self._build_symbol_index()
            self._init_stability()
        self._active_request_id: Optional[str] = None
        self._cancelled: set[str] = set()  # Thread-safe via GIL for simple set ops

        # Session token totals
        self._session_totals = {
            "prompt": 0, "completion": 0, "total": 0,
            "cache_hit": 0, "cache_write": 0,
        }

        # Review mode state
        self._review_active = False
        self._review_branch = ""
        self._review_branch_tip = ""
        self._review_base_commit = ""
        self._review_parent = ""
        self._review_commits: list[dict] = []
        self._review_changed_files: list[dict] = []
        self._review_stats: dict = {}
        self._symbol_map_before = ""

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

    @property
    def call(self):
        """Get the jrpc-oo call proxy for calling browser-side methods.
        Returns None if no client is connected."""
        try:
            result = self.get_call()
            return result
        except Exception as e:
            log.debug("get_call() failed: %s", e)
            return None

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
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
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

            # -- Build URL context --
            url_context = ""
            fetched_urls = self._url_service.get_fetched_urls()
            if fetched_urls:
                active_urls = [
                    u["url"] for u in fetched_urls if not u.get("error")
                ]
                url_context = self._url_service.format_url_context(active_urls)

            # Build review context if in review mode
            review_context = ""
            if self._review_active:
                review_context = self._format_review_context()

            # Pre-request shedding (Layer 3 defense)
            symbol_map = ""
            if self._symbol_index:
                symbol_map = self._symbol_index.get_symbol_map(
                    exclude_files=set(valid_files),
                )
            shed = self._context.shed_files_if_needed(
                message, system_prompt, symbol_map, file_tree, url_context,
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
                    url_context=url_context,
                    review_context=review_context,
                    images=images or None,
                )
            else:
                messages = self._context.assemble_messages(
                    user_prompt=message,
                    system_prompt=system_prompt,
                    symbol_map=symbol_map,
                    file_tree=file_tree,
                    url_context=url_context,
                    review_context=review_context,
                    images=images or None,
                )

            # -- Persist user message --
            self._history_store.append_message(
                session_id=self._session_id,
                role="user",
                content=message,
                files=valid_files or None,
                images=images if images else None,
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
            tier_changes = self._update_stability(valid_files, result.get("files_modified", []))

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
            self._print_usage_report(result, tier_changes=tier_changes)

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

        def _extract_usage(chunk) -> dict:
            """Extract token usage from a streaming chunk or response.

            Handles multiple provider formats:
            - OpenAI: chunk.usage with prompt_tokens/completion_tokens
            - Anthropic direct: cache_read_input_tokens/cache_creation_input_tokens
            - Bedrock Anthropic: prompt_tokens_details.cached_tokens (dict or object)
            - litellm unified: maps provider-specific fields to common names

            The usage object may be an object with attributes OR a dict,
            depending on provider and litellm version.
            """
            u = getattr(chunk, "usage", None)
            if not u:
                return {}

            def _get(obj, key, default=0):
                """Get a value from an object or dict."""
                if isinstance(obj, dict):
                    return obj.get(key, default)
                return getattr(obj, key, default)

            prompt = _get(u, "prompt_tokens", 0) or 0
            completion = _get(u, "completion_tokens", 0) or 0
            total = _get(u, "total_tokens", 0) or 0

            # Extract cache read tokens — try multiple field names/locations
            cache_read = _get(u, "cache_read_input_tokens", 0) or 0
            if not cache_read:
                # Bedrock/OpenAI: prompt_tokens_details.cached_tokens
                details = _get(u, "prompt_tokens_details", None)
                if details:
                    cache_read = _get(details, "cached_tokens", 0) or 0
            if not cache_read:
                # Some litellm versions use this field name
                cache_read = _get(u, "cache_read_tokens", 0) or 0

            # Extract cache write tokens
            cache_write = _get(u, "cache_creation_input_tokens", 0) or 0
            if not cache_write:
                cache_write = _get(u, "cache_creation_tokens", 0) or 0

            extracted = {
                "prompt_tokens": prompt,
                "completion_tokens": completion,
                "total_tokens": total,
                "cache_read_tokens": cache_read,
                "cache_creation_tokens": cache_write,
            }
            # Compute total if provider didn't supply it
            if not extracted["total_tokens"] and (prompt or completion):
                extracted["total_tokens"] = prompt + completion
            return extracted

        def _blocking_stream():
            nonlocal full_content, was_cancelled, usage
            try:
                import litellm

                # Build stream kwargs — some providers don't support stream_options
                stream_kwargs = {
                    "model": self._model,
                    "messages": messages,
                    "stream": True,
                }
                # Only add stream_options for providers known to support it
                model_lower = (self._model or "").lower()
                is_bedrock = "bedrock" in model_lower or model_lower.startswith("global.")
                is_anthropic_direct = model_lower.startswith("anthropic/") or model_lower.startswith("claude")
                if not is_bedrock:
                    stream_kwargs["stream_options"] = {"include_usage": True}

                # For Bedrock streaming, request usage in the final message
                # Bedrock Anthropic models return usage via the stream's
                # message_stop event when stream_usage is enabled.
                if is_bedrock:
                    stream_kwargs["stream_options"] = {"include_usage": True}

                response = litellm.completion(**stream_kwargs)

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

                    # Capture usage from any chunk that has it (last chunk typically)
                    chunk_usage = _extract_usage(chunk)
                    if chunk_usage:
                        usage = chunk_usage

                # For Bedrock/Anthropic: also check response-level attributes
                if hasattr(response, "usage") and response.usage:
                    resp_usage = _extract_usage(response)
                    if resp_usage:
                        # Merge: prefer chunk-level but fill in missing fields
                        for k, v in resp_usage.items():
                            if v and not usage.get(k):
                                usage[k] = v

                # Estimate completion tokens from content if provider didn't report
                if full_content and not usage.get("completion_tokens"):
                    estimated = max(1, len(full_content) // 4)
                    if usage:
                        usage["completion_tokens"] = estimated
                        usage["total_tokens"] = usage.get("prompt_tokens", 0) + estimated
                    # If no usage at all, leave empty — don't fabricate prompt tokens

            except Exception as e:
                log.error("LLM call failed: %s", e)
                if not full_content:
                    full_content = f"[Error: {e}]"

        await loop.run_in_executor(_executor, _blocking_stream)
        return full_content, was_cancelled, usage

    async def _send_chunk(self, request_id: str, content: str):
        """Send a streaming chunk to the client via RPC callback."""
        if not self.call:
            return
        try:
            await asyncio.wait_for(
                self.call["AcApp.streamChunk"](request_id, content),
                timeout=5.0,
            )
        except Exception as e:
            log.debug("Chunk send failed: %s", e)

    async def _send_stream_complete(self, request_id: str, result: dict):
        """Send stream completion to the client."""
        if not self.call:
            return
        try:
            await asyncio.wait_for(
                self.call["AcApp.streamComplete"](request_id, result),
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
        """Get session messages with images reconstructed for display."""
        msgs = self._history_store.get_session(session_id)
        for msg in msgs:
            images = self._history_store._reconstruct_images(msg)
            if images:
                msg["images"] = images
        return msgs

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
        return {
            "ok": True,
            "message_count": len(messages),
            "session_id": session_id,
            "messages": messages,
        }

    # ------------------------------------------------------------------
    # URL handling
    # ------------------------------------------------------------------

    def detect_urls(self, text: str) -> list[dict]:
        """Find and classify URLs in text."""
        return self._url_service.detect_urls(text)

    def fetch_url(self, url: str, use_cache: bool = True,
                  summarize: bool = True, user_hint: str = "") -> dict:
        """Fetch URL content with caching and optional summarization."""
        return self._url_service.fetch_url(url, use_cache, summarize, user_hint)

    def get_url_content(self, url: str) -> dict:
        """Get previously fetched content for display."""
        return self._url_service.get_url_content(url)

    def invalidate_url_cache(self, url: str) -> dict:
        """Remove a URL from the cache."""
        return self._url_service.invalidate_url_cache(url)

    def clear_url_cache(self) -> dict:
        """Clear all cached URLs."""
        return self._url_service.clear_url_cache()

    def get_history_status(self) -> dict:
        """Return history token usage for the history bar."""
        return self._context.get_compaction_status()

    # ------------------------------------------------------------------
    # Code review
    # ------------------------------------------------------------------

    def start_review(self, branch: str, base_commit: str) -> dict:
        """Enter code review mode.

        Performs the full entry sequence:
        1. Verify clean tree, checkout parent
        2. Build symbol_map_before from pre-review state
        3. Checkout branch, soft reset to parent
        4. Compute structural symbol diff
        """
        if self._review_active:
            return {"error": "A review is already active. End it first."}

        # Step 1-3: Enter review mode (checkout parent for symbol map capture)
        entry = self._repo.enter_review_mode(branch, base_commit)
        if "error" in entry:
            return entry

        # Step 4: Build symbol map from pre-review state (disk = parent commit)
        self._symbol_map_before = ""
        if self._symbol_index:
            try:
                self._symbol_index.invalidate_files(
                    list(self._symbol_index.all_symbols.keys())
                )
                self._symbol_index.index_repo()
                self._symbol_map_before = self._symbol_index.get_symbol_map()
            except Exception as e:
                log.warning("Failed to build pre-review symbol map: %s", e)

        # Step 5-6: Complete setup (checkout branch, soft reset)
        setup = self._repo.complete_review_setup(
            entry["branch"], entry["parent_commit"],
        )
        if "error" in setup:
            # Try to recover
            self._repo.exit_review_mode(branch, entry["branch_tip"])
            return setup

        # Rebuild symbol index from reviewed code (disk = branch tip)
        if self._symbol_index:
            try:
                self._symbol_index.invalidate_files(
                    list(self._symbol_index.all_symbols.keys())
                )
                self._symbol_index.index_repo()
                self._save_symbol_map()
            except Exception as e:
                log.warning("Failed to rebuild symbol index for review: %s", e)

        # Get commit log and changed files
        commits = self._repo.get_commit_log(entry["parent_commit"], entry["branch_tip"])
        changed_files = self._repo.get_review_changed_files()

        # Compute stats
        total_additions = sum(f.get("additions", 0) for f in changed_files)
        total_deletions = sum(f.get("deletions", 0) for f in changed_files)
        stats = {
            "commit_count": len(commits),
            "files_changed": len(changed_files),
            "additions": total_additions,
            "deletions": total_deletions,
        }

        # Store review state
        self._review_active = True
        self._review_branch = branch
        self._review_branch_tip = entry["branch_tip"]
        self._review_base_commit = base_commit
        self._review_parent = entry["parent_commit"]
        self._review_commits = commits
        self._review_changed_files = changed_files
        self._review_stats = stats

        return {
            "status": "review_active",
            "branch": branch,
            "base_commit": base_commit,
            "commits": commits,
            "changed_files": changed_files,
            "stats": stats,
        }

    def end_review(self) -> dict:
        """Exit code review mode and restore the branch."""
        if not self._review_active:
            return {"error": "No review is active"}

        result = self._repo.exit_review_mode(
            self._review_branch, self._review_branch_tip,
        )

        # Clear review state regardless of result
        self._review_active = False
        self._review_branch = ""
        self._review_branch_tip = ""
        self._review_base_commit = ""
        self._review_parent = ""
        self._review_commits = []
        self._review_changed_files = []
        self._review_stats = {}
        self._symbol_map_before = ""

        # Rebuild symbol index
        if self._symbol_index:
            try:
                self._symbol_index.invalidate_files(
                    list(self._symbol_index.all_symbols.keys())
                )
                self._symbol_index.index_repo()
                self._save_symbol_map()
                self._init_stability()
            except Exception as e:
                log.warning("Failed to rebuild symbol index after review: %s", e)

        if "error" in result:
            return result
        return {"status": "restored"}

    def get_review_state(self) -> dict:
        """Get current review mode state."""
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
        """Get the diff for a specific file in review mode."""
        if not self._review_active:
            return {"error": "No review is active"}
        diff_text = self._repo.get_review_file_diff(path)
        return {"path": path, "diff": diff_text}

    def _compute_symbol_diff(self) -> dict:
        """Compare symbol_map_before against current symbol map.

        Returns structured diff: {added: [], removed: [], modified: []}
        """
        if not self._symbol_map_before or not self._symbol_index:
            return {"added": [], "removed": [], "modified": [], "text": ""}

        before_files = self._parse_symbol_map_files(self._symbol_map_before)
        after_files = {}
        for fpath, fsyms in self._symbol_index.all_symbols.items():
            symbols = set()
            for sym in fsyms.all_symbols_flat:
                symbols.add(sym.signature)
            after_files[fpath] = symbols

        added = []
        removed = []
        modified = []

        # Files only in after (new files)
        for fpath in sorted(set(after_files.keys()) - set(before_files.keys())):
            file_entry = {"path": fpath, "status": "added", "symbols": []}
            fsyms = self._symbol_index.all_symbols.get(fpath)
            if fsyms:
                for sym in fsyms.symbols:
                    file_entry["symbols"].append({
                        "name": sym.name,
                        "kind": sym.kind.value,
                        "signature": sym.signature,
                        "action": "added",
                    })
            added.append(file_entry)

        # Files only in before (deleted files)
        for fpath in sorted(set(before_files.keys()) - set(after_files.keys())):
            ref_count = 0
            if self._symbol_index and self._symbol_index.reference_index:
                ref_count = self._symbol_index.reference_index.file_ref_count(fpath)
            removed.append({
                "path": fpath,
                "status": "deleted",
                "ref_count": ref_count,
            })

        # Files in both — check for symbol changes
        for fpath in sorted(set(before_files.keys()) & set(after_files.keys())):
            before_sigs = before_files[fpath]
            after_sigs = after_files[fpath]
            if before_sigs == after_sigs:
                continue
            added_sigs = after_sigs - before_sigs
            removed_sigs = before_sigs - after_sigs
            if added_sigs or removed_sigs:
                file_entry = {"path": fpath, "status": "modified", "changes": []}
                for sig in sorted(added_sigs):
                    file_entry["changes"].append({"signature": sig, "action": "added"})
                for sig in sorted(removed_sigs):
                    file_entry["changes"].append({"signature": sig, "action": "removed"})
                modified.append(file_entry)

        # Build text representation
        text = self._format_symbol_diff_text(added, removed, modified)

        return {
            "added": added,
            "removed": removed,
            "modified": modified,
            "text": text,
        }

    @staticmethod
    def _parse_symbol_map_files(symbol_map_text: str) -> dict[str, set[str]]:
        """Parse a symbol map text into {file_path: set_of_signatures}.

        Simple parser that identifies file blocks by the header pattern
        (path ending with :) and collects symbol lines within.
        """
        files: dict[str, set[str]] = {}
        current_file = None
        for line in symbol_map_text.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            # File header: ends with : or : ←N
            if (not line.startswith(" ") and not line.startswith("\t")
                    and ":" in stripped and not stripped.startswith("i ")
                    and not stripped.startswith("i→")):
                # Extract path (before the colon, excluding ←refs)
                path = stripped.split(":")[0].strip()
                # Skip alias definitions
                if path.startswith("@") and "=" in path:
                    continue
                if "/" in path or "." in path:
                    current_file = path
                    files[current_file] = set()
            elif current_file and stripped:
                # Symbol line — add the whole trimmed line as a signature
                if any(stripped.startswith(p) for p in
                       ("c ", "m ", "f ", "af ", "am ", "v ", "p ")):
                    files[current_file].add(stripped)
        return files

    @staticmethod
    def _format_symbol_diff_text(added: list, removed: list, modified: list) -> str:
        """Format symbol diff as human-readable text for the LLM."""
        lines = []

        for file_entry in added:
            lines.append(f"+ {file_entry['path']} (new file)")
            for sym in file_entry.get("symbols", []):
                lines.append(f"    + {sym.get('signature', sym.get('name', '?'))}")

        for file_entry in modified:
            lines.append(f"~ {file_entry['path']} (modified)")
            for change in file_entry.get("changes", []):
                prefix = "+" if change["action"] == "added" else "-"
                lines.append(f"    {prefix} {change['signature']}")

        for file_entry in removed:
            ref_info = ""
            if file_entry.get("ref_count", 0) > 0:
                ref_info = f" (was ←{file_entry['ref_count']} refs)"
            lines.append(f"- {file_entry['path']} ← deleted{ref_info}")

        return "\n".join(lines)

    def _format_review_context(self, included_files: list[str] = None) -> str:
        """Build the review context text for prompt injection."""
        if not self._review_active:
            return ""

        parts = [REVIEW_CONTEXT_HEADER]

        # Review summary
        stats = self._review_stats
        parent_short = self._review_parent[:8] if self._review_parent else "?"
        tip_short = self._review_branch_tip[:8] if self._review_branch_tip else "HEAD"
        parts.append(
            f"## Review: {self._review_branch} ({parent_short} → {tip_short})\n"
            f"{stats.get('commit_count', 0)} commits, "
            f"{stats.get('files_changed', 0)} files changed, "
            f"+{stats.get('additions', 0)} -{stats.get('deletions', 0)}\n"
        )

        # Commits
        if self._review_commits:
            parts.append("## Commits")
            for i, c in enumerate(self._review_commits, 1):
                parts.append(
                    f"{i}. {c.get('short_sha', '?')} {c.get('message', '')} "
                    f"({c.get('author', '?')}, {c.get('date', '?')})"
                )
            parts.append("")

        # Pre-change symbol map
        if self._symbol_map_before:
            parts.append("## Pre-Change Symbol Map")
            parts.append(
                "Symbol map from the parent commit (before the reviewed changes).\n"
                "Compare against the current symbol map in the repository structure above.\n"
            )
            parts.append(self._symbol_map_before)
            parts.append("")

        # Reverse diffs for selected files
        files_to_include = included_files or [
            f["path"] for f in self._review_changed_files
            if f["path"] in set(self._selected_files)
        ]
        if files_to_include:
            parts.append("## Reverse Diffs (selected files)")
            parts.append(
                "These diffs show what would revert each file to the pre-review state.\n"
                "The full current content is in the working files above.\n"
            )
            for fpath in files_to_include:
                diff = self._get_reverse_diff(fpath)
                if diff:
                    # Get stats for this file
                    finfo = next(
                        (f for f in self._review_changed_files if f["path"] == fpath),
                        None,
                    )
                    stat_str = ""
                    if finfo:
                        stat_str = f" (+{finfo.get('additions', 0)} -{finfo.get('deletions', 0)})"
                    parts.append(f"### {fpath}{stat_str}")
                    parts.append(f"```diff\n{diff}\n```")
                    parts.append("")

        return "\n".join(parts)

    def _get_reverse_diff(self, path: str) -> str:
        """Get the reverse diff for a file: current → parent commit state."""
        if not self._review_active:
            return ""
        return self._repo.get_reverse_review_file_diff(path)

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
        if not self.call:
            return
        try:
            await asyncio.wait_for(
                self.call["AcApp.compactionEvent"](request_id, event),
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

        # URL context tokens
        url_tokens = 0
        url_items = []
        fetched = self._url_service.get_fetched_urls()
        for u in fetched:
            if not u.get("error"):
                content_obj = self._url_service._fetched.get(u["url"])
                if content_obj:
                    prompt_text = content_obj.format_for_prompt()
                    t = self._counter.count(prompt_text)
                    url_tokens += t
                    url_items.append({
                        "url": u["url"],
                        "title": u.get("title", ""),
                        "tokens": t,
                        "display_name": u.get("display_name", u["url"]),
                    })

        history_tokens = self._context.history_token_count()

        total = system_tokens + symbol_map_tokens + file_tokens + url_tokens + history_tokens

        # Build cache tier blocks for the cache viewer
        blocks = self._build_tier_blocks()

        # Cache stats from real provider-reported session totals
        cached_tokens = self._session_totals.get("cache_hit", 0)
        total_prompt = self._session_totals.get("prompt", 0)
        cache_hit_rate = int(cached_tokens / max(1, total_prompt) * 100) if total_prompt > 0 else 0

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
                "urls": {"tokens": url_tokens, "items": url_items},
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

            # L0 always has system prompt + legend as fixed content
            if tier == Tier.L0:
                system_prompt = self._config.get_system_prompt()
                system_tokens = self._counter.count(system_prompt) if system_prompt else 0
                legend_tokens = 0
                if self._symbol_index:
                    legend = self._symbol_index.get_legend()
                    legend_tokens = self._counter.count(legend) if legend else 0
                if system_tokens or legend_tokens:
                    contents.append({
                        "type": "system",
                        "count": 1,
                        "tokens": system_tokens + legend_tokens,
                    })
                    tokens += system_tokens + legend_tokens

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

            cached = tier != Tier.ACTIVE and tokens > 0
            blocks.append({
                "tier": config["name"],
                "name": config["name"],
                "tokens": tokens,
                "cached": cached,
                "threshold": self._context.cache_target_tokens,
                "contents": contents,
            })

        return blocks

    def _print_usage_report(self, result: dict, tier_changes: list = None):
        """Print token usage, cache blocks, and edit results to terminal."""
        usage = result.get("token_usage", {})

        # ── Cache Blocks Report ──
        try:
            blocks = self._build_tier_blocks()
            if blocks:
                lines = ["╭─ Cache Blocks ─────────────────────────╮"]
                total_tokens = 0
                cached_tokens = 0
                for block in blocks:
                    tokens = block.get("tokens", 0)
                    total_tokens += tokens
                    cached = block.get("cached", False)
                    if cached:
                        cached_tokens += tokens
                    tag = " [cached]" if cached else ""
                    name = block.get("name", "?")
                    lines.append(f"│ {name:<14} {tokens:>6,} tokens{tag:<10}│")
                    # Summarize contents
                    for content in block.get("contents", []):
                        ctype = content.get("type", "?")
                        count = content.get("count", 0)
                        ctokens = content.get("tokens", 0)
                        if ctype == "system":
                            lines.append(f"│   └─ system + legend ({ctokens:,} tok)        │"[:43] + "│")
                        elif ctype == "symbols":
                            lines.append(f"│   └─ {count} symbols ({ctokens:,} tok)            │"[:43] + "│")
                        elif ctype == "files":
                            lines.append(f"│   └─ {count} files ({ctokens:,} tok)              │"[:43] + "│")
                        elif ctype == "history":
                            lines.append(f"│   └─ {count} history msgs ({ctokens:,} tok)       │"[:43] + "│")
                lines.append("├────────────────────────────────────────┤")
                usage = result.get("token_usage", {})
                real_cache_read = usage.get("cache_read_tokens", 0)
                real_prompt = usage.get("prompt_tokens", 0)
                hit_rate = int(real_cache_read / real_prompt * 100) if real_prompt > 0 else 0
                lines.append(f"│ Total: {total_tokens:,} | Cache hit: {hit_rate}%{' ' * max(0, 14 - len(str(total_tokens)) - len(str(hit_rate)))}│")
                lines.append("╰────────────────────────────────────────╯")
                for line in lines:
                    log.info(line)
        except Exception as e:
            log.debug("Cache blocks report failed: %s", e)

        # ── Token Usage Report ──
        if usage:
            prompt = usage.get("prompt_tokens", 0)
            completion = usage.get("completion_tokens", 0)
            cache_read = usage.get("cache_read_tokens", 0)
            cache_write = usage.get("cache_creation_tokens", 0)
            max_input = self._counter.max_input_tokens

            log.info("Model: %s", self._model)
            log.info("Last request: %s in, %s out", f"{prompt:,}", f"{completion:,}")
            if cache_read:
                log.info("Cache: read: %s", f"{cache_read:,}")
            if cache_write:
                log.info("Cache: write: %s", f"{cache_write:,}")
            log.info("Session total: %s", f"{self._session_totals['total']:,}")

        # ── Tier Change Notifications ──
        try:
            changes = tier_changes if tier_changes is not None else []
            if changes:
                # Group changes by (direction, old_tier, new_tier)
                groups: dict[tuple, list] = {}
                for change in changes:
                    direction = "📈" if change.is_promotion else "📉"
                    key = (direction, change.old_tier.name, change.new_tier.name)
                    groups.setdefault(key, []).append(change.key)
                for (direction, old_name, new_name), keys in sorted(groups.items()):
                    items_str = ", ".join(keys)
                    log.info("%s %s → %s: %d items — %s",
                             direction, old_name, new_name, len(keys), items_str)
        except Exception as e:
            log.debug("Tier change report failed: %s", e)

        # ── Edit Results ──
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

    def _update_stability(self, selected_files: list[str], modified_files: list[str]) -> list:
        """Update stability tracker after a response. Returns tier changes."""
        if self._symbol_index is None:
            return []
        try:
            # Remove file entries for deselected files from the stability tracker.
            # When a file is deselected, its full content should no longer be in
            # any cached tier — only its symbol block should remain.
            selected_set = set(selected_files)
            to_remove = []
            for key, item in self._context.stability.get_all_items().items():
                if item.item_type == ItemType.FILE:
                    path = key.split(":", 1)[1] if ":" in key else key
                    if path not in selected_set:
                        to_remove.append(key)
            for key in to_remove:
                item = self._context.stability.get_item(key)
                if item and item.tier != Tier.ACTIVE:
                    self._context.stability._tier_broken[item.tier] = True
                self._context.stability._items.pop(key, None)

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
            return changes

        except Exception as e:
            log.warning("Stability update failed: %s", e)
            return []

    def _gather_tiered_content(self, selected_files: list[str]) -> tuple[dict, dict]:
        """Gather symbol blocks and file contents for tiered assembly.

        Returns (symbol_blocks, file_contents) keyed by tracker keys.

        Also removes file entries for deselected files from the stability
        tracker *before* assembly, so their full content is never sent in
        cached tier blocks after deselection.
        """
        symbol_blocks: dict[str, str] = {}
        file_contents: dict[str, str] = {}

        if self._symbol_index is None:
            return symbol_blocks, file_contents

        # Remove file entries for deselected files immediately so they don't
        # appear in cached tier blocks this request (not just after the response).
        selected_set = set(selected_files)
        to_remove = []
        for key, item in self._context.stability.get_all_items().items():
            if item.item_type == ItemType.FILE:
                path = key.split(":", 1)[1] if ":" in key else key
                if path not in selected_set:
                    to_remove.append(key)
        for key in to_remove:
            item = self._context.stability.get_item(key)
            if item and item.tier != Tier.ACTIVE:
                self._context.stability._tier_broken[item.tier] = True
            self._context.stability._items.pop(key, None)

        # Determine which selected files have graduated to cached tiers
        # (their content goes in the tier block, not in active files)
        graduated_files = set()
        for fpath in selected_files:
            file_key = f"file:{fpath}"
            item = self._context.stability.get_item(file_key)
            if item and item.tier != Tier.ACTIVE:
                graduated_files.add(fpath)

        # Symbol blocks for all files NOT in selected (those are in active context),
        # UNLESS they've graduated to a cached tier
        excluded = set(selected_files) - graduated_files

        # Also exclude files whose full content is already in a cached tier —
        # including the symbol block would be redundant
        files_with_cached_content = set()
        for tier in [Tier.L0, Tier.L1, Tier.L2, Tier.L3]:
            for item in self._context.stability.get_tier_items(tier):
                if item.item_type == ItemType.FILE:
                    path = item.key.split(":", 1)[1] if ":" in item.key else item.key
                    files_with_cached_content.add(path)

        for fpath, fsyms in self._symbol_index.all_symbols.items():
            if fpath not in excluded and fpath not in files_with_cached_content:
                key = f"symbol:{fpath}"
                block = self._symbol_index.get_file_block(fpath)
                if block:
                    symbol_blocks[key] = block

        # File contents for files in cached tiers (including graduated selected files)
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