"""LLM service — orchestration layer for Layer 3.

Wires ContextManager + FileContext + HistoryStore + StabilityTracker +
HistoryCompactor + SymbolIndex + Repo into a single entry point. The
streaming handler's `chat_streaming` method is the user-facing RPC that
the browser calls; this class owns the full lifecycle of a streaming
request.

Design points pinned by specs4/3-llm/streaming.md and the project's
D10 contracts:

- **Captured event loop reference.** The main event loop is captured
  at the RPC entry point (on the event-loop thread) and passed into
  the worker thread. Worker callbacks schedule via
  ``run_coroutine_threadsafe(coro, loop)`` — never
  ``asyncio.get_event_loop()`` inside the worker, which would either
  fail on recent Python or return an unusable loop. The capture
  happens in ``chat_streaming`` itself and is stored on ``self`` for
  the background task to read; capturing inside the background task
  is too late.

- **User-initiated single-stream guard.** Only one user-initiated
  stream is active at a time (D10). A future parallel-agent mode
  will spawn internal streams under a parent request ID; those share
  the parent's ID prefix and are not blocked by this guard. The
  guard stores the active user-initiated request ID; internal
  streams (when added) compare against the prefix, not exact match.

- **Request ID is the multiplexing primitive.** All server-push
  events (streamChunk, streamComplete, compactionEvent, userMessage)
  carry the exact request ID they belong to. The browser-side router
  keys state by request ID. The transport never assumes a singleton
  stream.

- **Event callback injection.** The service takes an
  ``event_callback`` at construction — a callable ``(event_name,
  *args) -> awaitable`` that dispatches to the appropriate browser
  RPC method (``AcApp.streamChunk``, etc). Tests inject a recording
  stub; the real backend wires it to ``call['AcApp.X']``. Not a
  shared singleton — each service instance has its own callback,
  matching the D10 per-context-manager scoping for future
  parallel-agent mode.

- **Topic detector construction.** The service builds a
  ``detect_topic_boundary`` closure over ``config.get_compaction_prompt()``
  and ``config.smaller_model``, invoking ``litellm.completion`` and
  parsing the JSON response. The closure is injected into the
  HistoryCompactor. Falls back to a safe-default TopicBoundary on
  any failure (LLM timeout, bad JSON, empty response).

- **Session-ID capture for background tasks.** ``commit_all`` captures
  ``self._session_id`` synchronously in ``commit_all`` itself
  (before launching the background task) and passes it as a parameter
  to the background coroutine. Never read ``self._session_id`` inside
  the background task — a concurrent ``_restore_last_session`` during
  a hypothetical reconnect could replace it, causing commit events
  to persist to the wrong session. This is the same pattern flagged
  in specs3 commit-flow.

- **Auto-restore on startup.** The constructor calls
  ``_restore_last_session`` synchronously (NOT deferred) so the first
  ``get_current_state`` call returns previous-session messages
  immediately. Deferred init only skips the symbol-index wiring;
  session restore always happens at construction.

- **Event-loop capture in every async RPC that spawns executor work.**
  Any ``async def`` RPC method that eventually calls
  ``run_in_executor`` (directly or via a background task) must
  capture ``self._main_loop = asyncio.get_event_loop()`` on its
  first line. ``chat_streaming`` and ``commit_all`` both do this.
  Capturing inside the background task is too late — the task may
  run on a different thread where ``get_event_loop()`` returns an
  unusable loop. This is a per-RPC capture rather than a one-time
  construction-time capture because the event loop may not exist
  when the service is constructed (Layer 6's startup sequence
  constructs the service before the server's loop is fully up).

- **Deferred init support.** When ``deferred_init=True``, the
  constructor skips symbol-index attachment and ``_init_complete``
  starts False. Streaming rejects with a friendly message until
  ``complete_deferred_init(symbol_index)`` fires. Matches the Layer 6
  startup sequence where the WebSocket server comes up before
  heavyweight indexing completes.

Governing spec: ``specs4/3-llm/streaming.md``.
Numeric reference: ``specs3/3-llm-engine/streaming_lifecycle.md``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import re
import time
from concurrent.futures import ThreadPoolExecutor
from typing import TYPE_CHECKING, Any, Awaitable, Callable, Optional

from ac_dc.context_manager import ContextManager, Mode
from ac_dc.file_context import FileContext
from ac_dc.history_compactor import HistoryCompactor, TopicBoundary
from ac_dc.stability_tracker import StabilityTracker
from ac_dc.token_counter import TokenCounter

if TYPE_CHECKING:
    from ac_dc.config import ConfigManager
    from ac_dc.history_store import HistoryStore
    from ac_dc.repo import Repo
    from ac_dc.symbol_index.index import SymbolIndex

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Type aliases
# ---------------------------------------------------------------------------


# Event callback — dispatches a server-push event to the browser.
# Signature: (event_name: str, *args) -> awaitable. Different events
# take different argument shapes (streamChunk(request_id, content),
# filesChanged(files_list)), so we use *args rather than a fixed
# schema. Returns a coroutine the caller awaits.
EventCallback = Callable[..., Awaitable[Any]]


# ---------------------------------------------------------------------------
# Module constants
# ---------------------------------------------------------------------------


# Executor for running the blocking litellm.completion call off the
# event loop. Single-worker because only one user-initiated stream
# runs at a time in single-agent operation. Future parallel-agent
# mode will want a larger pool — trivial to bump.
_STREAM_EXECUTOR_WORKERS = 4

# Separate executor for commit message generation and topic detection
# — non-streaming LLM calls that can overlap with an active stream.
# Keeps the streaming executor free from auxiliary work. (Commit-
# message generation specifically must not block a concurrent stream.)
_AUX_EXECUTOR_WORKERS = 2

# Fallback summary character cap for topic detector prompts. The
# detector prompt references `summary_budget_tokens` from config,
# but we also truncate very long messages going IN to the detector
# to keep the prompt tractable. One message shouldn't exceed this.
_DETECTOR_MSG_TRUNCATE_CHARS = 1000

# Max messages passed to the detector. Newer history gets priority;
# if the list is longer we keep the tail.
_DETECTOR_MAX_MESSAGES = 50


# ---------------------------------------------------------------------------
# Request ID generation
# ---------------------------------------------------------------------------


def _generate_request_id() -> str:
    """Generate a request ID — ``{epoch_ms}-{6-char-alnum}``.

    Format matches specs3's frontend convention so request IDs are
    interchangeable across the boundary. Epoch prefix gives stable
    chronological ordering; random suffix handles same-millisecond
    ties (rare but possible).
    """
    epoch_ms = int(time.time() * 1000)
    alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
    suffix = "".join(random.choices(alphabet, k=6))
    return f"{epoch_ms}-{suffix}"


# ---------------------------------------------------------------------------
# Topic detector closure factory
# ---------------------------------------------------------------------------


def _build_topic_detector(
    config: "ConfigManager",
    aux_executor: ThreadPoolExecutor,
) -> Callable[[list[dict[str, Any]]], TopicBoundary]:
    """Build the detector callable injected into HistoryCompactor.

    The returned callable:
    1. Formats messages as indexed blocks
    2. Truncates long messages and caps total count
    3. Calls ``litellm.completion`` with the compaction system prompt
    4. Parses the JSON response (with tolerance for markdown fences)
    5. Returns a TopicBoundary — or the safe default on any failure

    Called from the compactor synchronously. The compactor wraps the
    call in its own try/except, so even if this helper raises the
    result is safe-defaulted. But we return the safe default
    internally too for clarity.
    """

    def _format_for_detector(messages: list[dict[str, Any]]) -> str:
        """Produce the ``[N] ROLE: content`` block format."""
        # Cap to recent messages — older ones are already
        # summarized in practice, and a huge prompt wastes tokens.
        tail = messages[-_DETECTOR_MAX_MESSAGES:]
        # Preserve original indices so the detector's
        # boundary_index is meaningful in the full message list.
        start_idx = len(messages) - len(tail)
        lines: list[str] = []
        for i, msg in enumerate(tail):
            idx = start_idx + i
            role = msg.get("role", "user").upper()
            content = msg.get("content", "") or ""
            if not isinstance(content, str):
                content = str(content)
            if len(content) > _DETECTOR_MSG_TRUNCATE_CHARS:
                content = (
                    content[:_DETECTOR_MSG_TRUNCATE_CHARS]
                    + "... (truncated)"
                )
            lines.append(f"[{idx}] {role}: {content}")
        return "\n\n".join(lines)

    def _parse_detector_response(text: str) -> TopicBoundary:
        """Parse the JSON detector response.

        Tolerates markdown fences — LLMs sometimes wrap JSON in
        ``` even when told not to. Returns safe defaults on any
        parse failure.
        """
        # Strip code fences if present.
        stripped = text.strip()
        # Match ``` optionally followed by a language tag on the first
        # line, and ``` on the last. Pull out the interior.
        fence_match = re.match(
            r"^```(?:json)?\s*\n(.*)\n```\s*$",
            stripped,
            re.DOTALL,
        )
        if fence_match:
            stripped = fence_match.group(1).strip()
        try:
            data = json.loads(stripped)
        except json.JSONDecodeError:
            logger.warning(
                "Topic detector returned unparseable JSON: %r",
                text[:200],
            )
            return TopicBoundary(None, "unparseable", 0.0, "")
        if not isinstance(data, dict):
            return TopicBoundary(None, "unexpected shape", 0.0, "")
        boundary_index = data.get("boundary_index")
        if boundary_index is not None and not isinstance(
            boundary_index, int
        ):
            boundary_index = None
        reason = data.get("boundary_reason", "")
        if not isinstance(reason, str):
            reason = ""
        try:
            confidence = float(data.get("confidence", 0.0))
        except (TypeError, ValueError):
            confidence = 0.0
        confidence = max(0.0, min(1.0, confidence))
        summary = data.get("summary", "")
        if not isinstance(summary, str):
            summary = ""
        return TopicBoundary(
            boundary_index=boundary_index,
            boundary_reason=reason,
            confidence=confidence,
            summary=summary,
        )

    def _detect(messages: list[dict[str, Any]]) -> TopicBoundary:
        """The callable handed to HistoryCompactor."""
        # Import litellm lazily — it's a heavyweight import and we
        # want the service module to load cleanly in tests that
        # don't exercise the detector path.
        try:
            import litellm
        except ImportError:
            logger.warning(
                "litellm not available; topic detection disabled"
            )
            return TopicBoundary(None, "litellm missing", 0.0, "")

        system_prompt = config.get_compaction_prompt()
        if not system_prompt:
            return TopicBoundary(None, "prompt missing", 0.0, "")

        user_prompt = _format_for_detector(messages)
        if not user_prompt:
            return TopicBoundary(None, "no messages", 0.0, "")

        model = config.smaller_model
        try:
            # Non-streaming call — we want the full JSON response
            # before parsing.
            response = litellm.completion(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                stream=False,
            )
        except Exception as exc:
            logger.warning(
                "Topic detection LLM call failed: %s", exc
            )
            return TopicBoundary(None, "llm failure", 0.0, "")

        # litellm returns an OpenAI-shaped response object.
        try:
            content = response.choices[0].message.content
        except (AttributeError, IndexError, KeyError):
            logger.warning(
                "Topic detection response had unexpected shape"
            )
            return TopicBoundary(None, "bad response", 0.0, "")

        if not isinstance(content, str) or not content.strip():
            return TopicBoundary(None, "empty response", 0.0, "")

        return _parse_detector_response(content)

    # aux_executor is accepted but unused at the moment — the
    # detector call happens inside the compactor's synchronous
    # context (post-response housekeeping). If a future revision
    # wants to pre-empt the detector call onto the aux pool to
    # overlap with other post-response work, the handle is here.
    del aux_executor

    return _detect


# ---------------------------------------------------------------------------
# LLMService
# ---------------------------------------------------------------------------


class LLMService:
    """Top-level orchestration for chat streaming and session state.

    Construct once per backend process. Register via
    ``server.add_class(service)`` so the public methods become
    RPC-callable from the browser.

    Not thread-safe for concurrent method calls on the same instance;
    the backend drives calls from a single asyncio event loop. Worker
    threads (spawned for LLM completion) use the captured loop
    reference to schedule callbacks back.
    """

    def __init__(
        self,
        config: "ConfigManager",
        repo: Optional["Repo"] = None,
        symbol_index: Optional["SymbolIndex"] = None,
        event_callback: EventCallback | None = None,
        history_store: Optional["HistoryStore"] = None,
        deferred_init: bool = False,
    ) -> None:
        """Construct the service.

        Parameters
        ----------
        config:
            The ConfigManager. Read live for model names, prompts,
            compaction settings. Hot-reloaded config values take
            effect on the next request without restart.
        repo:
            Optional Repo instance. Used for file content loads,
            commit/reset, git queries. When None, file-loading
            operations will fail — useful for tests that don't
            exercise the file pipeline.
        symbol_index:
            Optional SymbolIndex. When supplied, ``_update_stability``
            extracts current-request items from it. When None (e.g.,
            ``deferred_init=True``), the tracker runs with an empty
            item set until ``complete_deferred_init`` attaches an
            index.
        event_callback:
            Callable ``(event_name, *args) -> awaitable`` for pushing
            events to the browser. When None, events are silently
            dropped — useful for tests that don't exercise the
            browser-push path.
        history_store:
            Persistent conversation storage. When None, no history
            is persisted and session restore is a no-op. Normal
            construction passes the real store.
        deferred_init:
            When True, skip symbol-index attachment and mark the
            service as not-yet-ready for chat. Layer 6's startup
            sequence uses this to get the WebSocket server up
            before heavy indexing completes.
        """
        self._config = config
        self._repo = repo
        self._symbol_index = symbol_index
        self._event_callback = event_callback
        self._history_store = history_store

        # Token counter shared with the context manager and
        # compactor. Model is read through the config so hot reloads
        # would pick up a new model — but we capture the name at
        # construction for the counter (TokenCounter doesn't support
        # model-switch post-construction). Users who change their
        # model should restart; matches specs3 behaviour.
        self._counter = TokenCounter(config.model)

        # File context — tracks which files are in full-content
        # context. Uses the Repo for reading file content.
        self._file_context = FileContext(repo=repo)

        # Context manager — owns conversation history, system prompt,
        # URL context, review context, mode.
        self._context = ContextManager(
            model_name=config.model,
            repo=repo,
            cache_target_tokens=config.cache_target_tokens_for_model(),
            compaction_config=config.compaction_config,
            system_prompt=config.get_system_prompt(),
        )

        # Stability tracker — attached to context manager. One
        # instance per context manager (D10). Cache-target tokens
        # match the model-aware value.
        self._stability_tracker = StabilityTracker(
            cache_target_tokens=config.cache_target_tokens_for_model(),
        )
        self._context.set_stability_tracker(self._stability_tracker)

        # Executors. Streaming gets its own pool so aux work doesn't
        # starve it. Aux pool handles commit-message generation and
        # topic detection — both blocking LLM calls that should run
        # off the event loop but can overlap with a stream.
        self._stream_executor = ThreadPoolExecutor(
            max_workers=_STREAM_EXECUTOR_WORKERS,
            thread_name_prefix="ac-dc-stream",
        )
        self._aux_executor = ThreadPoolExecutor(
            max_workers=_AUX_EXECUTOR_WORKERS,
            thread_name_prefix="ac-dc-aux",
        )

        # History compactor — with an injected topic detector that
        # uses the smaller model and the compaction prompt.
        self._compactor = HistoryCompactor(
            config_manager=config,
            token_counter=self._counter,
            detect_topic_boundary=_build_topic_detector(
                config, self._aux_executor
            ),
        )
        self._context.set_compactor(self._compactor)

        # Session management. New session ID generated on
        # construction; auto-restore may replace it with the most
        # recent prior session's ID so new messages persist to the
        # same session.
        if self._history_store is not None:
            from ac_dc.history_store import HistoryStore  # local for type

            assert isinstance(self._history_store, HistoryStore)
            self._session_id = HistoryStore.new_session_id()
        else:
            self._session_id = f"sess_{int(time.time() * 1000)}_nostore"

        # Selected files — the user's picker state. Persisted on
        # the service (not in the context manager) because it's a
        # UI state synchronized across clients, not a history-layer
        # concern.
        self._selected_files: list[str] = []

        # Session-totals accumulator. The token HUD reads this for
        # cumulative display.
        self._session_totals: dict[str, int] = {
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_read_tokens": 0,
            "cache_write_tokens": 0,
        }

        # Active stream tracking. The guard is a SET (not a single
        # ID) so internal streams under a parent request ID can
        # coexist in future parallel-agent mode. For now only
        # user-initiated streams register; the guard checks that
        # no USER-initiated stream is active, not that the set is
        # empty.
        self._active_user_request: str | None = None
        # Cancellation flags keyed by request ID. Populated by
        # cancel_streaming; the worker thread polls and breaks out
        # when it finds its ID.
        self._cancelled_requests: set[str] = set()

        # Commit background task guard. Prevents concurrent commits.
        self._committing = False

        # Captured event loop reference. Set on the first
        # chat_streaming call — but accessed from the worker thread
        # via _main_loop. See D10.
        self._main_loop: asyncio.AbstractEventLoop | None = None

        # Readiness flag. When deferred_init=True, chat_streaming
        # rejects with a friendly message until
        # complete_deferred_init fires.
        self._init_complete = not deferred_init

        # Auto-restore the last session. This happens
        # UNCONDITIONALLY at construction (not deferred) so the
        # first get_current_state call returns previous messages
        # immediately. If deferred_init is True, the symbol index
        # wiring is what's deferred — session messages are
        # independent.
        if self._history_store is not None:
            self._restore_last_session()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def complete_deferred_init(
        self, symbol_index: "SymbolIndex"
    ) -> None:
        """Attach the symbol index and flip the init-complete flag.

        Called by the Layer 6 startup sequence after heavy indexing
        finishes. Does NOT re-run session restore — that happened
        at construction. Safe to call multiple times; subsequent
        calls are no-ops.
        """
        if self._init_complete and self._symbol_index is not None:
            return
        self._symbol_index = symbol_index
        self._init_complete = True
        logger.info("Deferred init complete; chat is ready")

    def shutdown(self) -> None:
        """Release executor resources. Called on server shutdown."""
        # wait=False so shutdown doesn't block on in-flight work;
        # the event loop is typically already stopping at this point.
        self._stream_executor.shutdown(wait=False)
        self._aux_executor.shutdown(wait=False)

    # ------------------------------------------------------------------
    # Session restore
    # ------------------------------------------------------------------

    def _restore_last_session(self) -> None:
        """Load the most recent session's messages into context.

        Called from __init__. If no sessions exist, is a no-op.
        If loading fails for any reason, logs and starts fresh —
        never blocks construction.
        """
        if self._history_store is None:
            return
        try:
            sessions = self._history_store.list_sessions(limit=1)
        except Exception as exc:  # defensive
            logger.warning(
                "Failed to list sessions during restore: %s", exc
            )
            return
        if not sessions:
            return
        target = sessions[0]
        try:
            messages = self._history_store.get_session_messages_for_context(
                target.session_id
            )
        except Exception as exc:
            logger.warning(
                "Failed to load session %s during restore: %s",
                target.session_id, exc,
            )
            return
        if not messages:
            return
        # Replace the session ID so future messages persist to the
        # same session. Reuses the session ID rather than creating
        # a new one — specs3 calls this out explicitly.
        self._session_id = target.session_id
        # Add each message to the context manager's working copy.
        # set_history copies each entry so caller mutations don't
        # leak.
        self._context.set_history(messages)
        logger.info(
            "Restored session %s with %d messages",
            target.session_id, len(messages),
        )

    # ------------------------------------------------------------------
    # Public RPC — state snapshot
    # ------------------------------------------------------------------

    def get_current_state(self) -> dict[str, Any]:
        """Return the state snapshot for browser reconnect.

        Called by the browser on WebSocket connect. Returns the
        minimal set of fields needed to rebuild the UI — messages,
        selected files, streaming status, session ID, repo name,
        init flag, mode.
        """
        return {
            "messages": self._context.get_history(),
            "selected_files": list(self._selected_files),
            "streaming_active": self._active_user_request is not None,
            "session_id": self._session_id,
            "repo_name": self._repo.name if self._repo else "",
            "init_complete": self._init_complete,
            "mode": self._context.mode.value,
        }

    # ------------------------------------------------------------------
    # Public RPC — file selection
    # ------------------------------------------------------------------

    def set_selected_files(self, files: list[str]) -> list[str]:
        """Replace the selected-files list.

        Stored as a copy so caller mutations don't leak. Broadcast
        to all connected clients via ``filesChanged`` so each
        client's picker updates. Returns the canonical list.
        """
        # Defensive: filter non-existent files when a repo is
        # attached. Matches the specs3 deleted-file cleanup rule —
        # the selection should never contain a phantom path.
        if self._repo is not None:
            valid = [
                p for p in files
                if isinstance(p, str) and self._repo.file_exists(p)
            ]
        else:
            valid = [p for p in files if isinstance(p, str)]
        self._selected_files = valid
        # Broadcast. Fire-and-forget: if the callback fails we log
        # but don't raise, since file-selection state isn't
        # critical-path.
        self._broadcast_event("filesChanged", valid)
        return list(self._selected_files)

    def get_selected_files(self) -> list[str]:
        """Return a copy of the selected-files list."""
        return list(self._selected_files)

    # ------------------------------------------------------------------
    # Public RPC — session management
    # ------------------------------------------------------------------

    def new_session(self) -> dict[str, Any]:
        """Start a fresh session — clear history, purge tracker."""
        if self._history_store is not None:
            from ac_dc.history_store import HistoryStore
            self._session_id = HistoryStore.new_session_id()
        else:
            self._session_id = f"sess_{int(time.time() * 1000)}_nostore"
        # clear_history on the context manager also purges the
        # tracker's history items via the attachment point.
        self._context.clear_history()
        # Broadcast sessionChanged so collaborator clients clear
        # their chat panels too.
        self._broadcast_event(
            "sessionChanged",
            {"session_id": self._session_id, "messages": []},
        )
        return {"session_id": self._session_id}

    # ------------------------------------------------------------------
    # Public RPC — streaming
    # ------------------------------------------------------------------

    async def chat_streaming(
        self,
        request_id: str,
        message: str,
        files: list[str] | None = None,
        images: list[str] | None = None,
    ) -> dict[str, Any]:
        """Start a streaming chat request.

        Returns synchronously with ``{"status": "started"}``. The
        actual streaming runs as a background task; chunks and the
        completion arrive via the event callback.

        Rejects if the service isn't fully initialised, or if
        another user-initiated stream is active.
        """
        # Capture event loop on the RPC thread — this is the
        # event-loop thread. D10 contract: the capture happens
        # HERE, not inside the background task.
        self._main_loop = asyncio.get_event_loop()

        if not self._init_complete:
            return {
                "error": (
                    "Server is still initializing — please wait "
                    "a moment"
                )
            }
        if self._active_user_request is not None:
            return {
                "error": (
                    f"Another stream is active (request "
                    f"{self._active_user_request})"
                )
            }

        # Register the active request. Cleared in the background
        # task's finally block.
        self._active_user_request = request_id

        # Launch the background task. ensure_future rather than
        # await so we return {"status": "started"} immediately.
        asyncio.ensure_future(
            self._stream_chat(
                request_id, message, files or [], images or []
            )
        )
        return {"status": "started"}

    def cancel_streaming(self, request_id: str) -> dict[str, Any]:
        """Signal a streaming request to abort.

        The worker thread polls the cancellation set on each chunk
        and breaks out when it finds its ID. The background task's
        finally handler clears the active-request flag and fires
        streamComplete with cancelled=True.
        """
        if request_id != self._active_user_request:
            return {
                "error": (
                    f"Request {request_id} is not the active stream"
                )
            }
        self._cancelled_requests.add(request_id)
        return {"status": "cancelling"}

    async def _stream_chat(
        self,
        request_id: str,
        message: str,
        files: list[str],
        images: list[str],
    ) -> None:
        """Background task — the actual streaming logic."""
        error: str | None = None
        full_content = ""
        cancelled = False
        try:
            # File context sync — remove deselected files, load
            # selected ones. Defensive: skip files that don't exist
            # or that the repo can't read.
            self._sync_file_context()

            # Persist user message BEFORE the LLM call. Matches
            # specs4 — mid-stream crash preserves user intent.
            if self._history_store is not None:
                self._history_store.append_message(
                    session_id=self._session_id,
                    role="user",
                    content=message,
                    files=list(self._selected_files) or None,
                    images=images if images else None,
                )
            self._context.add_message(
                "user", message, files=list(self._selected_files) or None
            )

            # Broadcast user message to all clients (collaborator
            # sync). The sending client ignores this broadcast
            # (checks _currentRequestId) per specs4; we send it
            # unconditionally.
            self._broadcast_event(
                "userMessage", {"content": message}
            )

            # Assemble the message array. 3.7 uses a FLAT assembly:
            # system prompt + history + current user prompt with
            # system reminder appended. Tiered assembly lands with
            # 3.8 and will replace this.
            messages = self._assemble_messages_flat(message, images)

            # Run the LLM call in the stream executor.
            assert self._main_loop is not None
            loop = self._main_loop
            full_content, cancelled = await loop.run_in_executor(
                self._stream_executor,
                self._run_completion_sync,
                request_id, messages, loop,
            )

            # Add assistant response to context and persist.
            if full_content or cancelled:
                content_to_store = full_content
                if cancelled and not content_to_store:
                    content_to_store = "[stopped]"
                self._context.add_message(
                    "assistant", content_to_store
                )
                if self._history_store is not None:
                    self._history_store.append_message(
                        session_id=self._session_id,
                        role="assistant",
                        content=content_to_store,
                    )
        except Exception as exc:
            logger.exception(
                "Streaming request %s failed", request_id
            )
            error = str(exc)

        # Build the completion result. 3.7 ships a minimal shape —
        # 3.9 (edit protocol) will populate edit_blocks,
        # edit_results, files_modified, files_auto_added.
        result: dict[str, Any] = {
            "response": full_content,
            "token_usage": {
                "prompt_tokens": 0,
                "completion_tokens": 0,
            },
            "edit_blocks": [],
            "shell_commands": [],
            "passed": 0,
            "already_applied": 0,
            "failed": 0,
            "skipped": 0,
            "not_in_context": 0,
            "files_modified": [],
            "edit_results": [],
            "files_auto_added": [],
            "user_message": message,
        }
        if cancelled:
            result["cancelled"] = True
        if error is not None:
            result["error"] = error

        # Fire completion event.
        await self._broadcast_event_async(
            "streamComplete", request_id, result
        )

        # Clear active-request flag BEFORE post-response work, so a
        # concurrent cancel check doesn't hold on to a stale ID.
        self._active_user_request = None
        self._cancelled_requests.discard(request_id)

        # Post-response housekeeping — update stability, run
        # compaction. Only runs when the stream completed normally
        # (not error, not cancelled).
        if error is None and not cancelled:
            try:
                await self._post_response(request_id)
            except Exception as exc:
                logger.exception(
                    "Post-response processing for %s failed: %s",
                    request_id, exc,
                )

    def _run_completion_sync(
        self,
        request_id: str,
        messages: list[dict[str, Any]],
        loop: asyncio.AbstractEventLoop,
    ) -> tuple[str, bool]:
        """Blocking LLM call — runs in a worker thread.

        Returns ``(full_content, was_cancelled)``. Schedules chunk
        callbacks onto the main event loop via
        ``run_coroutine_threadsafe``.
        """
        try:
            import litellm
        except ImportError:
            logger.error("litellm not available; streaming disabled")
            return ("litellm is not installed on this server", False)

        full_content = ""
        was_cancelled = False

        try:
            stream = litellm.completion(
                model=self._config.model,
                messages=messages,
                stream=True,
                stream_options={"include_usage": True},
            )
        except Exception as exc:
            logger.exception("litellm.completion raised")
            return (f"LLM call failed: {exc}", False)

        usage: dict[str, Any] | None = None

        for chunk in stream:
            if request_id in self._cancelled_requests:
                was_cancelled = True
                break

            # Extract delta content.
            try:
                choices = chunk.choices
                if choices:
                    delta = choices[0].delta
                    if delta and getattr(delta, "content", None):
                        full_content += delta.content
                        # Fire chunk callback with FULL accumulated
                        # content, not delta (specs4 contract).
                        asyncio.run_coroutine_threadsafe(
                            self._broadcast_event_async(
                                "streamChunk",
                                request_id,
                                full_content,
                            ),
                            loop,
                        )
            except (AttributeError, IndexError):
                pass  # malformed chunk — skip

            # Usage is typically on the final chunk.
            chunk_usage = getattr(chunk, "usage", None)
            if chunk_usage is not None:
                usage = chunk_usage

        # Accumulate session totals from usage.
        if usage is not None:
            self._accumulate_usage(usage)

        return full_content, was_cancelled

    def _accumulate_usage(self, usage: Any) -> None:
        """Fold a per-request usage record into session totals."""
        # Dual-mode accessor — provider responses may be either
        # attribute-style objects or plain dicts.
        def _get(name: str, default: int = 0) -> int:
            if isinstance(usage, dict):
                val = usage.get(name, default)
            else:
                val = getattr(usage, name, default)
            try:
                return int(val) if val is not None else default
            except (TypeError, ValueError):
                return default

        self._session_totals["input_tokens"] += _get("prompt_tokens")
        self._session_totals["output_tokens"] += _get(
            "completion_tokens"
        )
        # Cache field names vary by provider; accept the most common.
        self._session_totals["cache_read_tokens"] += max(
            _get("cache_read_input_tokens"),
            _get("cache_read_tokens"),
        )
        self._session_totals["cache_write_tokens"] += max(
            _get("cache_creation_input_tokens"),
            _get("cache_creation_tokens"),
        )

    # ------------------------------------------------------------------
    # Message assembly (flat — 3.8 will replace with tiered)
    # ------------------------------------------------------------------

    def _assemble_messages_flat(
        self,
        user_prompt: str,
        images: list[str],
    ) -> list[dict[str, Any]]:
        """Build a flat message array for the LLM call.

        Layer 3.7 placeholder — no tiered cache content, no
        symbol map, no file tree, no URL context. Just system
        prompt + history + user prompt with system reminder
        appended.
        """
        system_prompt = self._context.get_system_prompt()
        reminder = self._config.get_system_reminder()
        augmented_prompt = user_prompt + (reminder or "")

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
        ]

        # Active history — already includes the user message we
        # just added via add_message. Strip it off before appending
        # so we don't duplicate; we add the current prompt with
        # images as the final message.
        history = self._context.get_history()
        if history and history[-1].get("role") == "user":
            history = history[:-1]
        messages.extend(history)

        # Current user message — with images attached as content
        # blocks if any.
        if images:
            content_blocks: list[dict[str, Any]] = [
                {"type": "text", "text": augmented_prompt}
            ]
            for uri in images:
                if isinstance(uri, str) and uri.startswith("data:"):
                    content_blocks.append({
                        "type": "image_url",
                        "image_url": {"url": uri},
                    })
            messages.append(
                {"role": "user", "content": content_blocks}
            )
        else:
            messages.append(
                {"role": "user", "content": augmented_prompt}
            )
        return messages

    # ------------------------------------------------------------------
    # File context sync
    # ------------------------------------------------------------------

    def _sync_file_context(self) -> None:
        """Reconcile file context with the current selection.

        Adds newly-selected files, removes deselected ones. Binary
        and missing files are skipped silently (matches specs4
        limitation note — streaming will produce warnings downstream
        when 3.9 lands).
        """
        current = set(self._file_context.get_files())
        selected = set(self._selected_files)

        # Remove files no longer selected.
        for path in current - selected:
            self._file_context.remove_file(path)

        # Add newly-selected files. Use the Repo to read; errors
        # (binary, missing) are swallowed per the specs4 limitation.
        for path in selected - current:
            if self._repo is None:
                continue
            try:
                self._file_context.add_file(path)
            except Exception as exc:
                logger.debug(
                    "Skipping file %s during context sync: %s",
                    path, exc,
                )

    # ------------------------------------------------------------------
    # Post-response processing
    # ------------------------------------------------------------------

    async def _post_response(self, request_id: str) -> None:
        """Stability tracker update, compaction, event dispatch."""
        # Stability update — build the active items list and run
        # the tracker. 3.7's minimal build only tracks history
        # messages; 3.8/3.10 will add file, symbol, doc, url items.
        self._update_stability()

        # Compaction — runs after the response, gated on the
        # current history token count. Events communicate progress
        # to the frontend.
        tokens = self._context.history_token_count()
        if self._compactor.should_compact(tokens):
            await self._broadcast_event_async(
                "compactionEvent",
                request_id,
                {"stage": "compacting"},
            )
            try:
                result = self._compactor.compact_history_if_needed(
                    self._context.get_history(),
                    already_checked=True,
                )
            except Exception as exc:
                logger.exception("Compaction failed: %s", exc)
                await self._broadcast_event_async(
                    "compactionEvent",
                    request_id,
                    {"stage": "compaction_error", "error": str(exc)},
                )
                return

            if result is not None and result.case != "none":
                # Replace history + purge tracker history entries
                # (compacted messages re-enter as fresh active
                # items on the next request).
                self._context.set_history(result.messages)
                self._stability_tracker.purge_history()
                await self._broadcast_event_async(
                    "compactionEvent",
                    request_id,
                    {
                        "stage": "compacted",
                        "case": result.case,
                        "messages": result.messages,
                    },
                )

    def _update_stability(self) -> None:
        """Build active items and run the tracker update.

        3.7 minimal build — only history items. File/symbol/doc/url
        items land with 3.8 (prompt assembly) and 3.10 (modes).
        """
        active_items: dict[str, dict[str, Any]] = {}

        # History items. Each message is hashed on role+content
        # (stable — same text produces same hash).
        history = self._context.get_history()
        for i, msg in enumerate(history):
            role = msg.get("role", "user")
            content = msg.get("content", "") or ""
            if not isinstance(content, str):
                content = str(content)
            import hashlib
            h = hashlib.sha256(
                f"{role}:{content}".encode("utf-8")
            ).hexdigest()
            active_items[f"history:{i}"] = {
                "hash": h,
                "tokens": self._counter.count(msg),
            }

        # Existing files — tell the tracker which paths still exist
        # so stale removal works. Only relevant when tier items
        # reference files; in 3.7 they don't, so passing None is
        # fine. Left here as a hook for 3.8.
        self._stability_tracker.update(active_items)

    # ------------------------------------------------------------------
    # Commit and reset
    # ------------------------------------------------------------------

    async def commit_all(self) -> dict[str, Any]:
        """Stage all changes, generate a commit message, and commit.

        Returns ``{"status": "started"}`` immediately. The actual
        work runs in a background task. On completion, a
        commitResult event is broadcast. The session ID is captured
        synchronously HERE (not in the background task) per specs3
        — a concurrent _restore_last_session could otherwise replace
        the session ID and the commit event would persist to the
        wrong session.
        """
        if self._committing:
            return {"error": "A commit is already in progress"}
        if self._repo is None:
            return {"error": "No repository attached"}

        # Capture the event loop reference on the RPC thread. The
        # background task's _generate_commit_message step will
        # schedule a blocking litellm call via run_in_executor
        # against this loop. Same D10 capture pattern as
        # chat_streaming — any async RPC that spawns executor work
        # must capture the loop here, not inside the background
        # task (where asyncio.get_event_loop() is unreliable).
        self._main_loop = asyncio.get_event_loop()

        # Capture session ID on the event loop thread, before the
        # background task runs. This value is immutable for the
        # lifetime of the task.
        session_id = self._session_id
        self._committing = True

        asyncio.ensure_future(self._commit_all_background(session_id))
        return {"status": "started"}

    async def _commit_all_background(
        self, session_id: str
    ) -> None:
        """The commit pipeline — stage, generate, commit, record."""
        assert self._repo is not None
        try:
            # Stage all changes first.
            self._repo.stage_all()
            diff = self._repo.get_staged_diff()
            if not diff.strip():
                self._committing = False
                await self._broadcast_event_async(
                    "commitResult",
                    {"error": "No staged changes to commit"},
                )
                return

            # Generate commit message via the smaller model.
            message = await self._generate_commit_message(diff)
            if not message:
                message = "chore: update files"

            # Commit.
            result = self._repo.commit(message)

            # Record a system event message in context and history.
            event_text = (
                f"**Committed** `{result['sha'][:7]}`\n\n"
                f"```\n{result['message']}\n```"
            )
            # Context manager: add_message with system_event flag.
            # add_message takes system_event as a dedicated arg.
            self._context.add_message(
                "user", event_text, system_event=True
            )
            # History store: persist with the CAPTURED session_id,
            # not self._session_id.
            if self._history_store is not None:
                self._history_store.append_message(
                    session_id=session_id,
                    role="user",
                    content=event_text,
                    system_event=True,
                )

            # Broadcast to all clients.
            await self._broadcast_event_async(
                "commitResult",
                {
                    "sha": result["sha"],
                    "short_sha": result["sha"][:7],
                    "message": result["message"],
                    "system_event_message": event_text,
                },
            )
        except Exception as exc:
            logger.exception("Commit failed: %s", exc)
            await self._broadcast_event_async(
                "commitResult", {"error": str(exc)}
            )
        finally:
            self._committing = False

    async def _generate_commit_message(self, diff: str) -> str:
        """Generate a commit message via the smaller model."""
        try:
            import litellm
        except ImportError:
            return ""

        prompt = self._config.get_commit_prompt()
        assert self._main_loop is not None
        loop = self._main_loop

        def _call() -> str:
            try:
                response = litellm.completion(
                    model=self._config.smaller_model,
                    messages=[
                        {"role": "system", "content": prompt},
                        {"role": "user", "content": diff},
                    ],
                    stream=False,
                )
                return response.choices[0].message.content or ""
            except Exception as exc:
                logger.warning(
                    "Commit message generation failed: %s", exc
                )
                return ""

        return await loop.run_in_executor(self._aux_executor, _call)

    def reset_to_head(self) -> dict[str, Any]:
        """Discard uncommitted changes, record a system event."""
        if self._repo is None:
            return {"error": "No repository attached"}
        try:
            self._repo.reset_hard()
        except Exception as exc:
            return {"error": str(exc)}

        event_text = (
            "**Reset to HEAD** — all uncommitted changes have "
            "been discarded."
        )
        self._context.add_message(
            "user", event_text, system_event=True
        )
        if self._history_store is not None:
            self._history_store.append_message(
                session_id=self._session_id,
                role="user",
                content=event_text,
                system_event=True,
            )
        return {
            "status": "ok",
            "system_event_message": event_text,
        }

    # ------------------------------------------------------------------
    # Event broadcast
    # ------------------------------------------------------------------

    def _broadcast_event(
        self, event_name: str, *args: Any
    ) -> None:
        """Fire-and-forget event dispatch from the event loop thread.

        Schedules the async callback if one is attached, otherwise
        drops silently. Never raises — event broadcast is a
        best-effort channel.
        """
        if self._event_callback is None:
            return
        try:
            coro = self._event_callback(event_name, *args)
        except Exception as exc:
            logger.warning(
                "Event callback construction failed for %s: %s",
                event_name, exc,
            )
            return
        # If we're on the event loop thread, ensure_future the
        # coroutine directly. If we're on a worker thread the
        # caller should use _broadcast_event_async with
        # run_coroutine_threadsafe.
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.ensure_future(coro)
            else:
                # No running loop — close the coroutine to avoid
                # a "was never awaited" warning.
                coro.close()
        except RuntimeError:
            # No loop at all — drop it.
            coro.close()

    async def _broadcast_event_async(
        self, event_name: str, *args: Any
    ) -> None:
        """Await the event callback directly.

        Used from within async code paths where we want to wait
        for the callback to complete before proceeding (e.g.,
        streamComplete ordering before post-response work).
        """
        if self._event_callback is None:
            return
        try:
            await self._event_callback(event_name, *args)
        except Exception as exc:
            logger.warning(
                "Event callback failed for %s: %s",
                event_name, exc,
            )

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    def get_session_totals(self) -> dict[str, int]:
        """Return a copy of cumulative token usage for this session."""
        return dict(self._session_totals)