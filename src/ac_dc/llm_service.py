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
Numeric reference: ``specs-reference/3-llm/streaming.md``.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import random
import re
import time
from concurrent.futures import ThreadPoolExecutor
from typing import TYPE_CHECKING, Any, Awaitable, Callable, Optional

from ac_dc.context_manager import ContextManager, Mode
from ac_dc.doc_index.index import DocIndex
from ac_dc.doc_index.keyword_enricher import (
    EnrichmentConfig,
    KeywordEnricher,
)
from ac_dc.edit_pipeline import EditPipeline
from ac_dc.edit_protocol import (
    EditResult,
    EditStatus,
    detect_shell_commands,
    parse_text,
)
from ac_dc.file_context import FileContext
from ac_dc.history_compactor import HistoryCompactor, TopicBoundary
from ac_dc.stability_tracker import StabilityTracker, Tier, _TIER_CONFIG
from ac_dc.token_counter import TokenCounter
from ac_dc.url_service import URLCache, URLService

# Tier config lookup for get_context_breakdown — maps Tier enum to
# the entry_n / promote_n config dict. Imported from the tracker
# module so the numbers stay in sync.
_TIER_CONFIG_LOOKUP: dict[Tier, dict[str, int]] = _TIER_CONFIG

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

# Per-message URL fetch limit. Up to this many URLs are fetched
# during streaming; extra URLs are silently skipped (still appear
# as chips via the UI's independent detection pass, but aren't
# injected into the LLM context). Matches specs4/4-features/
# url-content.md — "Up to a small number of URLs per message are
# detected and fetched during streaming."
_URL_PER_MESSAGE_LIMIT = 3


def _resolve_max_output_tokens(
    config: "ConfigManager",
    counter: TokenCounter,
) -> int:
    """Resolve the effective ``max_tokens`` for an LLM call.

    Two-level fallback chain per specs-reference/3-llm/
    streaming.md § Max-tokens resolution:

    1. ``config.max_output_tokens`` — user override in ``llm.json``
    2. ``counter.max_output_tokens`` — per-model ceiling

    The config value may lower the ceiling but cannot raise it —
    a user configuring 200K on a model that only supports 64K
    would produce a provider 400. We clamp against the counter
    ceiling as a safety net.

    Returned value is always a positive int. Used by every
    :func:`litellm.completion` call site so no path can silently
    inherit the provider default (which varies across providers
    and led to 4096-token truncation before this was wired up).
    """
    ceiling = counter.max_output_tokens
    override = config.max_output_tokens
    if override is None:
        return ceiling
    return min(override, ceiling)


def _extract_finish_reason(chunk: Any) -> str | None:
    """Extract the ``finish_reason`` from a streaming chunk.

    Provider chunks use the OpenAI-compatible shape via litellm:
    ``chunk.choices[0].finish_reason`` — non-null on the final
    chunk, None on intermediates. Dict-form chunks come from some
    providers; we accept both attribute and key access.

    Returns None on any extraction failure (malformed chunk,
    empty choices array, missing attribute). Non-None means the
    stream is terminating — the worker should capture the value
    and propagate it into the completion result.

    Values we see in the wild, documented in
    specs-reference/3-llm/streaming.md § Finish reason values:

    - ``"stop"`` — natural end of generation
    - ``"end_turn"`` — Anthropic passthrough (also natural)
    - ``"length"`` — hit ``max_tokens``; response truncated
    - ``"content_filter"`` — safety filter triggered
    - ``"tool_calls"`` / ``"function_call"`` — model wants a tool

    The UI treats ``stop``/``end_turn`` as natural (muted badge)
    and everything else as abnormal (red badge + toast).
    """
    try:
        choices = getattr(chunk, "choices", None)
        if choices is None and isinstance(chunk, dict):
            choices = chunk.get("choices")
        if not choices:
            return None
        first = choices[0]
        reason = getattr(first, "finish_reason", None)
        if reason is None and isinstance(first, dict):
            reason = first.get("finish_reason")
        if reason is None:
            return None
        return str(reason)
    except (AttributeError, IndexError, KeyError, TypeError):
        return None


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


def _build_compaction_event_text(
    result: Any,
    tokens_before: int,
    tokens_after: int,
    messages_before_count: int,
    messages_after_count: int,
) -> str:
    """Build the system-event message text for a successful compaction.

    Three-part format per IMPLEMENTATION_NOTES.md's compaction UI
    plan:

      **History compacted** — {case}

      {boundary reason or fallback}

      Removed N messages • Mtokens → Ntokens

    For summarize cases, appends a ``<details>/<summary>`` block
    carrying the detector's summary text so the LLM can see what
    was summarized on session reload, and users can expand it in
    the chat panel (marked.js passes through HTML tags with gfm
    enabled).

    Returns the raw markdown string. The caller wraps it in an
    ``add_message`` / ``append_message`` pair with
    ``system_event=True`` so the chat panel renders it with the
    system-event styling.

    ``result`` is typed Any rather than CompactionResult to avoid
    a circular dependency concern at the top of this module; the
    caller always passes a CompactionResult instance.
    """
    case_name = result.case
    # Boundary line — truncate uses the detected reason, summarize
    # falls back to a generic "no clear boundary" line when the
    # detector couldn't find one. result.boundary is always
    # populated for truncate, and often for summarize; defensive
    # getattr keeps us safe if a future code path produces None.
    boundary = getattr(result, "boundary", None)
    if case_name == "truncate" and boundary:
        reason = getattr(boundary, "boundary_reason", "") or "topic boundary"
        confidence = getattr(boundary, "confidence", 0.0) or 0.0
        boundary_line = (
            f"Boundary: {reason} (confidence {confidence:.2f})"
        )
    elif case_name == "summarize":
        if boundary and getattr(boundary, "boundary_reason", ""):
            boundary_line = (
                f"Boundary reason: {boundary.boundary_reason}"
            )
        else:
            boundary_line = (
                "No clear topic boundary detected; summarized "
                "earlier context."
            )
    else:
        # "none" case shouldn't reach here (caller only runs this
        # on truncate/summarize) but handle defensively so a future
        # code path doesn't produce a malformed message.
        boundary_line = "History compacted"

    messages_removed = max(
        0, messages_before_count - messages_after_count
    )
    stats_line = (
        f"Removed {messages_removed} messages • "
        f"{tokens_before} → {tokens_after} tokens"
    )

    parts = [
        f"**History compacted** — {case_name}",
        "",
        boundary_line,
        "",
        stats_line,
    ]

    # Summarize case gets an expandable details block with the
    # actual summary text. Truncate doesn't — the reason line
    # already explains what happened, and there's no separate
    # summary body to show (truncate keeps full text).
    summary_text = getattr(result, "summary", "") or ""
    if case_name == "summarize" and summary_text.strip():
        parts.extend([
            "",
            "<details>",
            "<summary>Summary</summary>",
            "",
            summary_text.strip(),
            "",
            "</details>",
        ])

    return "\n".join(parts)


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
        # Topic-detector responses are small (short JSON), but we
        # still pass max_tokens so the call is consistent with
        # the rest of the LLM surface and so a provider that
        # defaults to a tiny ceiling (e.g. 512) doesn't truncate
        # mid-JSON and produce an unparseable reply.
        detector_counter = TokenCounter(model)
        max_output = _resolve_max_output_tokens(
            config, detector_counter
        )
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
                max_tokens=max_output,
            )
        except Exception as exc:
            # Classify for richer log output. Topic detection
            # always degrades to a safe default on failure —
            # we don't propagate structured errors upward
            # because the compactor's caller isn't equipped to
            # react to them (no UI surface for "detection
            # failed due to rate limit" — the compaction just
            # falls through to summarize mode).
            info = LLMService._classify_litellm_error(
                litellm, exc
            )
            logger.warning(
                "Topic detection LLM call failed: "
                "type=%s provider=%s msg=%s",
                info.get("error_type"),
                info.get("provider"),
                info.get("message"),
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
        # Doc index is never optional — construction is cheap
        # (no tree-sitter grammars, no heavyweight dependencies)
        # so we always build one. Empty until the background
        # build populates it via complete_deferred_init (2.8.2b).
        # When repo is None, DocIndex runs in memory-only mode.
        #
        # Keyword enricher is wired optionally. Construction
        # here is cheap — the enricher's internal KeyBERT model
        # is lazy-loaded on first ensure_loaded call. When
        # KeyBERT isn't installed (stripped-down releases), the
        # enricher's availability probe returns False and
        # enrich_single_file degrades to a no-op. Enrichment
        # config is built from the config manager's doc_index
        # section so hot-reloaded thresholds take effect on
        # next request.
        enrichment_config = self._build_enrichment_config()
        self._enricher = KeywordEnricher(
            model_name=self._config.doc_index_config.get(
                "keyword_model", "BAAI/bge-small-en-v1.5"
            ),
        )
        self._doc_index = DocIndex(
            repo_root=repo.root if repo is not None else None,
            enricher=self._enricher,
            enrichment_config=enrichment_config,
        )
        # Readiness flags — flip during the background build
        # (2.8.2b). Cross-reference toggle gates on
        # _doc_index_ready per specs4/3-llm/modes.md.
        self._doc_index_ready = False
        self._doc_index_building = False
        # Enrichment flag — always False in 2.8.2; flips in
        # 2.8.4 when keyword enrichment lands.
        self._doc_index_enriched = False
        # Tristate enrichment status. Four values per
        # IMPLEMENTATION_NOTES.md § "Keyword enrichment UX
        # completion plan" Step 1:
        #
        # - "pending" — background build hasn't reached the
        #   enrichment phase yet (initial state, or structural
        #   extraction still running)
        # - "building" — enrichment loop is actively processing
        #   files
        # - "complete" — all queued files enriched
        # - "unavailable" — KeyBERT probe failed or model load
        #   failed; structural outlines work but no keywords
        #
        # The frontend distinguishes "unavailable" from "pending"
        # to know whether to show a warning toast vs. wait for
        # the background build. The `doc_index_enriched` boolean
        # stays as a backwards-compatibility shim — it maps to
        # `enrichment_status == "complete"`.
        self._enrichment_status = "pending"
        self._event_callback = event_callback
        self._history_store = history_store

        # Token counter shared with the context manager and
        # compactor. Model is read through the config so hot reloads
        # would pick up a new model — but we capture the name at
        # construction for the counter (TokenCounter doesn't support
        # model-switch post-construction). Users who change their
        # model should restart; matches specs3 behaviour.
        self._counter = TokenCounter(config.model)

        # Context manager — owns conversation history, system prompt,
        # URL context, review context, mode. It constructs its own
        # FileContext internally; we alias `self._file_context` to
        # that instance so both `LLMService._file_context` and
        # `ContextManager._file_context` are the same object.
        #
        # Why aliasing, not two instances: `ContextManager` reads
        # its own `_file_context` in `_format_active_files` (the
        # "Working Files" section of tiered assembly) and in
        # `estimate_request_tokens` / `shed_files_if_needed`.
        # `LLMService._sync_file_context` writes to `self._file_context`
        # on every request. Two separate instances meant the writes
        # went to one copy and the reads came from the empty copy,
        # silently dropping every selected file from tiered prompts.
        # Flat assembly (which reads `self._file_context` on
        # `LLMService`) happened to work, masking the bug.
        self._context = ContextManager(
            model_name=config.model,
            repo=repo,
            cache_target_tokens=config.cache_target_tokens_for_model(),
            compaction_config=config.compaction_config,
            system_prompt=config.get_system_prompt(),
        )

        # File context — alias to the ContextManager's instance.
        # Single source of truth; see the comment block above.
        self._file_context = self._context.file_context

        # Per-mode stability trackers. Each mode keeps its own
        # tier state so switching between code and doc mode is
        # instant (specs4/3-llm/modes.md — "each mode maintains
        # an independent tracker instance; switching back
        # preserves state"). The active tracker is whichever
        # matches the context manager's current mode; the
        # inactive instance retains its state for when the user
        # switches back.
        #
        # We construct the CODE tracker eagerly because the
        # session starts in code mode. The DOC tracker is
        # created lazily on first switch — it costs nothing
        # while the session stays in code mode.
        cache_target = config.cache_target_tokens_for_model()
        self._trackers: dict[Mode, StabilityTracker] = {
            Mode.CODE: StabilityTracker(cache_target_tokens=cache_target),
        }
        # Point the context manager at the current mode's tracker.
        # _stability_tracker is kept as a backwards-compatible
        # alias referring to the ACTIVE tracker; callers that
        # read ``service._stability_tracker`` get whichever
        # tracker is live. switch_mode updates both the alias
        # and the context manager's attachment in lockstep.
        self._stability_tracker = self._trackers[Mode.CODE]
        self._context.set_stability_tracker(self._stability_tracker)

        # Cross-reference toggle. When True, the other mode's
        # index items are added to the active tracker so the
        # LLM sees both structural maps at once. Always reset
        # to False on mode switch (specs4/3-llm/modes.md — the
        # toggle is mode-scoped UI state, not a persistent
        # preference). The doc index hasn't landed yet; when
        # it does, enabling cross-ref will populate the active
        # tracker with items from the opposite index.
        self._cross_ref_enabled = False

        # Per-mode stability initialization flags. Each mode's
        # tracker needs its own init pass — the first time we
        # switch INTO a mode, that tracker's tier assignments
        # have to be seeded from the appropriate reference
        # graph. Shared state with a single flag would either
        # (a) re-initialize the current tracker every switch
        # (expensive and wrong — its state should persist
        # across switches) or (b) leave the new tracker empty
        # until the user clicks Rebuild (bug observed 2025).
        #
        # Keyed by Mode. Missing key == not yet initialized.
        # switch_mode checks the target mode and calls
        # _try_initialize_stability when the flag is missing.
        self._stability_initialized: dict[Mode, bool] = {}

        # Edit pipeline — validates and applies edit blocks parsed
        # from the LLM response. Constructed only when a repo is
        # attached; without one there's nothing to write to.
        # The pipeline is stateless across invocations, so we
        # build it once and reuse.
        self._edit_pipeline: EditPipeline | None = (
            EditPipeline(repo) if repo is not None else None
        )

        # Review-mode flag — set by start_review, cleared by
        # end_review. Gates edit application in _stream_chat
        # (review mode is read-only — edits parse for UI
        # display but are never applied).
        self._review_active = False

        # Review state. Populated by start_review; cleared by
        # end_review. All fields None when review is inactive.
        # Held as a dict rather than individual attributes so
        # get_review_state() can return it as a single shape
        # without assembling.
        self._review_state: dict[str, Any] = {
            "active": False,
            "branch": None,
            "branch_tip": None,
            "base_commit": None,
            "parent_commit": None,
            "original_branch": None,
            "commits": [],
            "changed_files": [],
            "stats": {},
            "pre_change_symbol_map": "",
        }

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

        # URL service — detects, fetches, caches, summarizes URLs
        # mentioned in user prompts. Constructed from config values
        # so hot-reloaded cache paths and model names take effect
        # on the next request. SymbolIndex class injected (not an
        # instance) so the GitHub repo fetcher can produce symbol
        # maps for cloned repos without paying the tree-sitter
        # import cost at service construction time.
        self._url_service = self._build_url_service()

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

        # Excluded index files — files the user has explicitly
        # excluded from the index via the file picker's three-state
        # checkbox. These files get no content, no index block, and
        # no tracker item.
        self._excluded_index_files: list[str] = []

        # Session-totals accumulator. The token HUD reads this for
        # cumulative display. Several fields beyond the basic
        # input/output pair:
        #
        # - ``reasoning_tokens`` — subset of completion_tokens that
        #   the provider spent on hidden reasoning (Claude extended
        #   thinking, o1/o3 reasoning). Already billed inside
        #   output_tokens; tracked separately so the Context tab
        #   can show "of your 40K output tokens this session,
        #   30K were reasoning".
        # - ``prompt_cached_tokens`` — OpenAI-shaped prompt cache
        #   read count. Distinct from ``cache_read_tokens`` (which
        #   accepts both Anthropic ``cache_read_input_tokens`` and
        #   OpenAI ``prompt_tokens_details.cached_tokens``) —
        #   merged into the unified cache_read_tokens field so
        #   downstream consumers get one number regardless of
        #   provider. Kept as its own key here for diagnostics.
        # - ``cost_usd`` — cumulative USD cost when LiteLLM reports
        #   it. None-valued responses (unpriced models) don't add
        #   to this; the Context tab renders "—" when zero but
        #   request count is nonzero.
        # - ``priced_request_count`` / ``unpriced_request_count`` —
        #   lets the UI show "(partial)" when some requests were
        #   unpriced, so an accumulated $0.12 isn't misread as
        #   "total session cost" when half the requests had no
        #   price data.
        self._session_totals: dict[str, Any] = {
            "input_tokens": 0,
            "output_tokens": 0,
            "reasoning_tokens": 0,
            "cache_read_tokens": 0,
            "cache_write_tokens": 0,
            "prompt_cached_tokens": 0,
            "cost_usd": 0.0,
            "priced_request_count": 0,
            "unpriced_request_count": 0,
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

        # Side channel for structured LLM error information
        # from the most recent completion attempt. Populated by
        # :meth:`_run_completion_sync` when a LiteLLM exception
        # is raised; consumed by :meth:`_build_completion_result`
        # and cleared after. Fixed-shape tuple returns from the
        # worker don't accommodate an extra field cleanly — the
        # single-stream guard means only one completion is in
        # flight at a time, so a single-slot attribute is safe.
        #
        # Shape when populated: ``{"error_type": str,
        # "message": str, "retry_after": float | None,
        # "status_code": int | None, "provider": str | None,
        # "model": str | None}``. ``error_type`` values documented
        # in :meth:`_classify_litellm_error`. None when no error
        # occurred or after the last error was consumed.
        self._last_error_info: dict[str, Any] | None = None

        # Readiness flag. When deferred_init=True, chat_streaming
        # rejects with a friendly message until
        # complete_deferred_init fires.
        self._init_complete = not deferred_init

        # Whether the most recent _restore_last_session call
        # actually loaded messages. complete_deferred_init reads
        # this to decide whether to broadcast a sessionChanged
        # event — the event cannot fire from __init__ because no
        # event loop is running yet, but by the time deferred
        # init completes the loop is up and subscribers
        # (Context tab, TokenHUD, ChatPanel) are mounted. False
        # when no history store is attached, or when no prior
        # session existed.
        self._restored_on_startup = False

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

        Attempts eager stability initialization — if it succeeds,
        the cache tab shows populated tiers from the first page
        load, not only after the first chat message. If it fails,
        lazy initialization on the first chat request catches it.

        Attempts to schedule the doc index background build
        when a running event loop is reachable from the caller's
        thread. Production callers (main.py) run this method via
        ``run_in_executor`` — no loop is running on the worker
        thread, so the scheduling attempt fails and the caller
        must invoke :meth:`schedule_doc_index_build` explicitly
        from the event loop thread afterwards. Test callers
        (pytest-asyncio) run this method directly on the event
        loop thread, so the scheduling attempt succeeds inline
        and no extra call is needed.

        The distinction matters because ``asyncio.get_event_loop``
        on a worker thread (Python 3.10+) returns a fresh dead
        loop rather than raising, and tasks scheduled on it
        never run — producing the confusing "no progress
        events, no error" failure mode. Using
        ``asyncio.get_running_loop`` here rather than
        ``get_event_loop`` makes the worker-thread case raise
        cleanly (surfaced by schedule_doc_index_build's return
        value).
        """
        if self._init_complete and self._symbol_index is not None:
            return
        self._symbol_index = symbol_index
        self._init_complete = True
        logger.info("Deferred init complete; chat is ready")

        # Attempt eager stability initialization. Non-blocking —
        # failure is logged and the lazy path catches it on the
        # first chat request.
        self._try_initialize_stability()

        # If __init__ restored a prior session, broadcast
        # sessionChanged now so the frontend's Context tab and
        # TokenHUD refresh their token-budget displays from the
        # restored history. This cannot happen from __init__
        # itself (no event loop yet); by the time deferred init
        # completes the loop is up and broadcast targets are
        # mounted. ChatPanel already gets messages via
        # get_current_state on reconnect, but the other tabs
        # have no equivalent path and would otherwise show
        # stale empty-budget displays until the user sends a
        # message.
        if self._restored_on_startup:
            self._broadcast_event(
                "sessionChanged",
                {
                    "session_id": self._session_id,
                    "messages": self._context.get_history(),
                },
            )

        # Best-effort inline doc-index scheduling. Works when
        # called from the event loop thread (test path); fails
        # silently when called from a worker thread (production
        # path via run_in_executor). Production callers must
        # invoke schedule_doc_index_build() separately.
        self.schedule_doc_index_build()

    def schedule_doc_index_build(self) -> bool:
        """Schedule the doc index background build on the current loop.

        Must be called from the event loop thread — invokes
        ``asyncio.ensure_future`` against the currently-running
        loop. When called from a worker thread,
        ``asyncio.get_running_loop()`` raises and this method
        returns False without scheduling (the caller can retry
        from the correct thread).

        Returns True when the build was scheduled or was
        already running / complete. Returns False when no
        running loop was found on the calling thread (build
        skipped; doc index stays empty and
        ``_doc_index_ready`` stays False).

        Idempotent — calling when the build is already running
        or already complete is a no-op that returns True (so
        the caller doesn't retry).
        """
        if self._doc_index_ready or self._doc_index_building:
            return True
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            logger.debug(
                "schedule_doc_index_build called without a "
                "running event loop; build not scheduled"
            )
            return False
        self._main_loop = loop
        asyncio.ensure_future(self._build_doc_index_background())
        logger.info("Doc index background build scheduled")
        return True

    async def _build_doc_index_background(self) -> None:
        """Structurally extract every doc-index-eligible file.

        Runs in the aux executor so the blocking per-file parsing
        doesn't starve the event loop. Emits startupProgress
        events as it walks. Flips `_doc_index_ready` on success
        so cross-reference toggle can activate.

        Non-fatal — failures log and leave `_doc_index_ready`
        False. The doc index stays empty; doc mode produces no
        content; cross-reference stays disabled. No error
        propagates to the user's chat session.

        Per specs4/2-indexing/document-index.md § Two-Phase
        Principle: this is the structural pass only. Keyword
        enrichment (2.8.4) is a separate background task that
        runs after this completes.
        """
        if self._doc_index_building:
            # Already running. Should never happen given the
            # guard in complete_deferred_init, but defensive
            # against a future caller that invokes this directly.
            return

        self._doc_index_building = True
        try:
            # Discover files. Use the repo's flat file list when
            # available so we respect .gitignore and excluded
            # directories; fall back to the doc index's own
            # walker when no repo is attached.
            file_list: list[str] = []
            if self._repo is not None:
                try:
                    flat = self._repo.get_flat_file_list()
                    file_list = [f for f in flat.split("\n") if f]
                except Exception as exc:
                    logger.warning(
                        "Doc index: failed to fetch file list "
                        "from repo: %s; falling back to walker",
                        exc,
                    )
                    file_list = []

            # Filter to files the doc index has an extractor
            # for. Done here rather than letting index_repo do
            # it so we can emit accurate progress events (total
            # count is known up front).
            doc_files = [
                f for f in file_list
                if self._doc_index._extension_of(f)
                in self._doc_index._extractors
            ]

            total = len(doc_files)
            if total == 0:
                # No doc files. Still flip the ready flag — an
                # empty doc index is a valid state (repo has no
                # markdown). Cross-reference in code mode with
                # an empty doc index is a no-op that produces
                # no entries; the toggle works but doesn't
                # surface any content.
                logger.info(
                    "Doc index: no eligible files found; "
                    "marking ready with empty outlines"
                )
                self._doc_index_ready = True
                return

            logger.info(
                "Doc index: starting background build for %d files",
                total,
            )

            # Send an initial progress event so the shell's
            # dialog header progress bar appears at 0%.
            await self._send_doc_index_progress(
                stage="doc_index",
                message=f"Indexing documentation ({total} files)",
                percent=0,
            )

            # Run the full index_repo pass in the aux executor.
            # index_repo handles the per-file loop internally;
            # we don't currently get per-file progress events
            # during the run. Future work can add a callback
            # parameter to DocIndex.index_repo for finer-grained
            # progress; for 2.8.2b, start-and-end events are
            # sufficient.
            assert self._main_loop is not None
            loop = self._main_loop
            await loop.run_in_executor(
                self._aux_executor,
                self._doc_index.index_repo,
                doc_files,
            )

            # Build complete. Flip readiness flag; the frontend's
            # next get_mode call will see doc_index_ready=True
            # and enable the cross-reference toggle.
            self._doc_index_ready = True
            logger.info(
                "Doc index: background build complete — %d "
                "outlines in memory",
                len(self._doc_index._all_outlines),
            )

            # Send a final progress event at 100% so the dialog
            # header progress bar fades out cleanly.
            await self._send_doc_index_progress(
                stage="doc_index",
                message="Documentation indexing complete",
                percent=100,
            )

            # Chain keyword enrichment. Fire-and-forget — the
            # enrichment loop emits its own progress events
            # and flips _doc_index_enriched on completion.
            # We schedule rather than await so the _building
            # flag flips off promptly (structural extraction
            # IS complete at this point) while enrichment
            # runs in the background. A user who switches to
            # doc mode mid-enrichment sees unenriched outlines
            # via the cache's structure-only lookup; the
            # enriched versions land on the next chat request
            # after their per-file enrichment completes.
            assert self._main_loop is not None
            asyncio.ensure_future(
                self._run_enrichment_background()
            )
        except Exception as exc:
            # Background-build failure. Log; leave readiness
            # False; emit a compaction-error-style event so the
            # frontend can surface a toast if it wants to.
            logger.exception(
                "Doc index: background build failed: %s", exc
            )
            try:
                await self._send_doc_index_progress(
                    stage="doc_index_error",
                    message=f"Documentation indexing failed: {exc}",
                    percent=0,
                )
            except Exception:
                # If even the error event can't be sent, we've
                # done all we can. Swallow and continue.
                pass
        finally:
            self._doc_index_building = False

    def _build_enrichment_config(self) -> EnrichmentConfig:
        """Build an EnrichmentConfig from the config manager.

        Delegates to :meth:`EnrichmentConfig.from_dict` so the
        config dict shape stays owned by the dataclass. Called
        on construction; a future hot-reload pathway could
        re-read and swap the config on the enricher instance
        without reconstructing.

        ``keyword_model`` and ``keywords_enabled`` live in the
        config dict but not on :class:`EnrichmentConfig` — the
        caller reads those separately from
        :attr:`ConfigManager.doc_index_config`.
        """
        return EnrichmentConfig.from_dict(self._config.doc_index_config)

    async def _run_enrichment_background(self) -> None:
        """Enrich every queued doc-index file in the aux executor.

        Called by _build_doc_index_background after structural
        extraction completes. Per-file operation:

        1. Read source text (disk I/O — batched with the GIL-
           heavy extraction in the same executor task).
        2. Call :meth:`DocIndex.enrich_single_file` with the
           source text.
        3. Emit a progress event so the frontend's dialog
           header bar advances.

        Yields to the event loop between files via
        ``await asyncio.sleep(0)`` so WebSocket traffic flows
        during long enrichment runs (specs4 — "background
        enrichment splits work into per-file executor calls
        so the event loop stays responsive").

        Eager model load happens before the loop starts so the
        first file doesn't pay the model-download cost (can be
        10+ seconds on a fresh install). Failure to load the
        model (KeyBERT missing, no network, invalid model
        name) flips the enricher's availability flag and the
        loop exits cleanly — structural doc index still works.

        Progress event stages per specs4/2-indexing/
        keyword-enrichment.md § "Progress Feedback":

        - ``doc_enrichment_queued`` — fired once at the top
          with the total count so the bar can size itself
        - ``doc_enrichment_file_done`` — fired per file with
          per-file progress + current filename
        - ``doc_enrichment_complete`` — fired on completion;
          the bar fades out

        Sets ``_doc_index_enriched = True`` on completion so
        ``get_mode`` reports the new state. Non-fatal — if
        enrichment fails mid-loop, the flag stays False and
        the structural outlines remain fully functional.
        """
        if self._enricher is None:
            # Shouldn't happen given we construct one in
            # __init__, but defensive against future refactors
            # that make the field optional.
            return
        if not self._enricher.is_available():
            logger.info(
                "Keyword enrichment disabled — KeyBERT not "
                "available. Structural doc outlines remain "
                "fully functional."
            )
            self._enrichment_status = "unavailable"
            self._broadcast_enrichment_status()
            return

        # Eager model load. Failure is non-fatal — the enricher
        # flips its availability flag internally and subsequent
        # enrich calls become no-ops.
        assert self._main_loop is not None
        loop = self._main_loop
        loaded = await loop.run_in_executor(
            self._aux_executor,
            self._enricher.ensure_loaded,
        )
        if not loaded:
            logger.warning(
                "Keyword enrichment model failed to load. "
                "Structural outlines remain functional."
            )
            self._enrichment_status = "unavailable"
            self._broadcast_enrichment_status()
            return

        queue = self._doc_index.queue_enrichment()
        if not queue:
            # No files need enrichment (rare but possible —
            # every file was already enriched in a prior
            # session and the disk cache carried over). Flip
            # the flag and emit the completion event anyway
            # so the UI can show "enriched" rather than
            # "building".
            self._doc_index_enriched = True
            self._enrichment_status = "complete"
            await self._send_doc_index_progress(
                stage="doc_enrichment_complete",
                message="Keyword enrichment complete",
                percent=100,
            )
            return

        total = len(queue)
        logger.info(
            "Keyword enrichment: %d files queued", total
        )
        # Flip to "building" after the queued event so the
        # frontend's progress overlay can show a determinate
        # bar. "pending" → "building" is the normal transition;
        # a direct "pending" → "complete" is possible when the
        # queue is empty (handled above).
        self._enrichment_status = "building"
        await self._send_doc_index_progress(
            stage="doc_enrichment_queued",
            message=f"Enriching {total} documents",
            percent=0,
        )

        # Per-file loop. Each iteration runs the read + enrich
        # in the aux executor, emits a progress event, and
        # yields to the event loop via sleep(0) so the
        # WebSocket heartbeat and any chat traffic keep
        # flowing. Per-file failures are logged but don't
        # abort — one corrupt file shouldn't block enrichment
        # for the rest of the repo.
        for idx, rel_path in enumerate(queue, start=1):
            try:
                await loop.run_in_executor(
                    self._aux_executor,
                    self._enrich_one_file_sync,
                    rel_path,
                )
            except Exception as exc:
                logger.warning(
                    "Enrichment failed for %s: %s",
                    rel_path, exc,
                )
                # Continue — next file.

            percent = int((idx / total) * 100)
            await self._send_doc_index_progress(
                stage="doc_enrichment_file_done",
                message=f"Enriched {rel_path}",
                percent=percent,
            )
            # Yield so other coroutines (chat streaming,
            # WebSocket pings) get scheduling time.
            await asyncio.sleep(0)

        self._doc_index_enriched = True
        self._enrichment_status = "complete"
        logger.info("Keyword enrichment: complete")
        await self._send_doc_index_progress(
            stage="doc_enrichment_complete",
            message="Keyword enrichment complete",
            percent=100,
        )

    def _enrich_one_file_sync(self, rel_path: str) -> None:
        """Read source text and run enrichment. Executor-side.

        Split out as a named method so ``run_in_executor`` has
        something to call without a closure. The read + enrich
        pair runs on a single worker thread so the disk I/O
        is adjacent to the GIL-heavy extraction work rather
        than ping-ponging across threads.

        Missing files (deleted between structural extraction
        and enrichment) are handled by the enricher itself —
        :meth:`DocIndex.enrich_single_file` returns None when
        the file's mtime can't be stat'd. We don't distinguish
        here; missing files get "enriched" as no-ops, which
        leaves them in the unenriched state and a future
        index_repo pass will prune them.
        """
        if self._repo is None:
            # Can't resolve the path without a repo.
            return
        try:
            source_text = self._repo.get_file_content(rel_path)
        except Exception as exc:
            # File vanished, turned binary, or became
            # unreadable. Skip silently — next index_repo
            # pass will clean up the stale cache entry.
            logger.debug(
                "Enrichment source read failed for %s: %s",
                rel_path, exc,
            )
            return
        self._doc_index.enrich_single_file(
            rel_path, source_text=source_text
        )

    def _on_doc_file_written(self, rel_path: str) -> None:
        """Post-write hook — invalidate + re-extract + enqueue.

        Wired to :attr:`Repo._post_write_callback` by
        ``main.py``. Fires after every successful write,
        create, or rename. This method decides whether the
        path is interesting and whether the current mode
        cares about doc-index freshness.

        Gating rules (spec: specs4/2-indexing/
        document-index.md § Triggers — "LLM edits a doc
        file" and "User edits in viewer"):

        1. Path extension must be registered with the doc
           index (``.md`` today; ``.svg`` when Layer 2.8.3
           lands).
        2. Service must be in doc mode OR cross-reference
           must be enabled. In code mode without cross-ref,
           doc outlines are never consulted, so refreshing
           them on save is wasted work. This also avoids
           enrichment load when the user is purely doing
           code work and happens to touch a markdown file.
        3. Doc index background build must have completed
           (``_doc_index_ready``). If it's still running,
           the background pass will re-walk and pick up
           this file's new mtime naturally — triggering a
           second pass now would race with the ongoing one.

        When gates pass:

        - Invalidate the cache sidecar (drops keyword tag
          so structure-only lookup forces a re-parse).
        - Call ``index_file`` — this picks up the new
          mtime and produces an unenriched outline, which
          becomes immediately available for tier assembly
          and cross-reference rendering.
        - Schedule enrichment via the aux executor. The
          schedule call requires a running event loop; we
          only have one when called from an event-loop
          thread. The RPC entry points
          (:meth:`Repo.write_file` etc.) are awaited from
          the event-loop thread, so the callback fires
          there too — safe to call ``ensure_future``.

        Never raises — the caller (``Repo._fire_post_write``)
        already swallows exceptions, but defensive wrapping
        here surfaces a clearer log message tied to the
        enrichment layer rather than a generic repo-layer
        "callback failed" entry.
        """
        try:
            # Extension gate — cheap, first.
            extension = self._doc_index._extension_of(rel_path)
            if extension not in self._doc_index._extractors:
                return
            # Mode gate. Doc mode always cares; code mode
            # only cares when cross-reference is pulling
            # doc outlines into prompts.
            if (
                self._context.mode != Mode.DOC
                and not self._cross_ref_enabled
            ):
                return
            # Readiness gate. If the background build is
            # still walking, let it finish; it'll pick up
            # the new mtime on its own.
            if not self._doc_index_ready:
                return
            # Invalidate + re-extract. index_file handles
            # the cache miss (we just invalidated) and
            # produces a structural outline from the new
            # content. repo_files=None is fine — markdown
            # extraction doesn't use the repo set today.
            self._doc_index.invalidate_file(rel_path)
            keyword_model = (
                self._enricher.model_name
                if self._enricher is not None
                else None
            )
            outline = self._doc_index.index_file(
                rel_path,
                keyword_model=keyword_model,
            )
            if outline is None:
                # Extraction failed (unlikely for a file
                # we just wrote, but defensive). Nothing
                # more to do.
                return
            # Schedule enrichment. Only meaningful when
            # we have an enricher AND the outline has
            # enrichable units. DocIndex.enrich_single_file
            # degrades to a no-op otherwise, so we don't
            # gate here — ensure_future is cheap.
            if self._enricher is None:
                return
            if not self._doc_index.needs_enrichment(outline):
                return
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                # Callback fired from a thread without a
                # running loop (shouldn't happen via
                # Repo.write_file, but guard defensively).
                # The next chat turn's _stream_chat will
                # call queue_enrichment and pick this file
                # up; no harm in skipping immediate
                # enrichment here.
                logger.debug(
                    "Doc file %s written outside event loop; "
                    "enrichment deferred to next chat turn",
                    rel_path,
                )
                return
            # Fire-and-forget enrichment on the aux
            # executor. The coroutine reads the file,
            # runs the enricher, replaces the cache
            # entry. Matches the post-LLM-edit deferred
            # enrichment pattern.
            asyncio.ensure_future(
                self._enrich_written_file(rel_path),
                loop=loop,
            )
        except Exception as exc:
            logger.warning(
                "Doc-file post-write hook failed for %s: %s",
                rel_path, exc,
            )

    async def _enrich_written_file(self, rel_path: str) -> None:
        """Enrich a single file in the aux executor.

        Coroutine wrapper so the post-write hook can
        ``ensure_future`` without constructing a lambda.
        Delegates to :meth:`_enrich_one_file_sync` which
        reads the file and runs the enricher on the
        worker thread (enricher is GIL-bound; the sync
        helper batches the read + extract so both happen
        on the same thread).
        """
        if self._main_loop is None:
            # No loop captured yet — shouldn't happen
            # when called from ensure_future, but
            # defensive. Fall back to the current
            # running loop.
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                return
        else:
            loop = self._main_loop
        try:
            await loop.run_in_executor(
                self._aux_executor,
                self._enrich_one_file_sync,
                rel_path,
            )
        except Exception as exc:
            logger.warning(
                "Deferred enrichment failed for %s: %s",
                rel_path, exc,
            )

    async def _send_doc_index_progress(
        self,
        stage: str,
        message: str,
        percent: int,
    ) -> None:
        """Send a startupProgress event for doc index builds.

        Thin wrapper over the event callback. Matches the
        signature the startup orchestrator uses for its own
        progress events, so the shell's event router handles
        both uniformly.

        Stage is intercepted by the shell per shell.md § "Doc
        Index Stage Filtering" and routed to the dialog header
        rather than the startup overlay. Percent below 100
        indicates in-progress; percent == 100 indicates
        completion.
        """
        if self._event_callback is None:
            return
        try:
            await self._event_callback(
                "startupProgress",
                stage,
                message,
                percent,
            )
        except Exception as exc:
            logger.debug(
                "Doc index progress event failed for %s: %s",
                stage, exc,
            )

    def shutdown(self) -> None:
        """Release executor resources. Called on server shutdown."""
        # wait=False so shutdown doesn't block on in-flight work;
        # the event loop is typically already stopping at this point.
        self._stream_executor.shutdown(wait=False)
        self._aux_executor.shutdown(wait=False)

    # ------------------------------------------------------------------
    # Collaboration restriction enforcement
    # ------------------------------------------------------------------

    def _check_localhost_only(self) -> dict[str, Any] | None:
        """Return a restricted-error dict when the caller is non-localhost.

        Matches the pattern on :class:`Repo` — returns None when
        the caller is allowed (no collab attached, or a localhost
        caller), otherwise returns the specs4-mandated
        ``{"error": "restricted", "reason": ...}`` shape. Mutating
        RPC methods return this dict verbatim; the frontend's
        RpcMixin surfaces it as a restricted error and hides the
        UI affordance that triggered the call.

        Fails closed — an exception from the collab check itself
        is treated as a denial rather than silently allowing the
        mutation. Better to reject a legitimate call than to let
        an unauthenticated caller mutate state because the
        identity check errored out.

        The ``_collab`` attribute is set by ``main.py`` after
        constructing the service, when collaboration mode is
        active. In single-user operation it stays None and this
        helper always returns None.
        """
        collab = getattr(self, "_collab", None)
        if collab is None:
            return None
        try:
            is_local = collab.is_caller_localhost()
        except Exception as exc:
            logger.warning(
                "Collab localhost check raised: %s; denying",
                exc,
            )
            return {
                "error": "restricted",
                "reason": (
                    "Internal error checking caller identity"
                ),
            }
        if is_local:
            return None
        return {
            "error": "restricted",
            "reason": (
                "Participants cannot perform this action"
            ),
        }

    def _build_url_service(self) -> URLService:
        """Construct the URL service from config values.

        Wires the filesystem cache (from ``url_cache`` app config),
        the smaller model name, and the SymbolIndex class. When
        the config omits a cache path, the cache uses a
        system-temp-directory default. When the symbol index
        isn't available (pre-deferred-init or tests that skip
        it), the GitHub repo fetcher still works but produces
        content without a symbol map.
        """
        cache_config = self._config.url_cache_config
        cache_path = cache_config.get("path")
        ttl_hours = cache_config.get("ttl_hours", 24)
        if cache_path:
            from pathlib import Path as _Path
            cache = URLCache(_Path(cache_path), ttl_hours=ttl_hours)
        else:
            # Fall back to a per-user temp dir. URLCache creates
            # the directory if missing.
            import tempfile
            from pathlib import Path as _Path
            default_path = _Path(tempfile.gettempdir()) / "ac-dc-url-cache"
            cache = URLCache(default_path, ttl_hours=ttl_hours)

        # Lazy symbol-index class import — avoids paying the
        # tree-sitter grammar load cost when the URL service
        # doesn't actually hit a GitHub repo URL. The URLService
        # accepts None for symbol_index_cls and the repo fetcher
        # degrades gracefully (no symbol map field on the result).
        symbol_index_cls = None
        try:
            from ac_dc.symbol_index.index import SymbolIndex
            symbol_index_cls = SymbolIndex
        except ImportError:
            logger.debug(
                "SymbolIndex not available; URL service will fetch "
                "GitHub repos without symbol maps"
            )

        return URLService(
            cache=cache,
            smaller_model=self._config.smaller_model,
            symbol_index_cls=symbol_index_cls,
        )

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
        self._restored_on_startup = True
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
        init flag, mode, cross-reference state, review state,
        excluded files, doc convert availability.
        """
        # Check doc convert availability dynamically — not cached
        # at startup since optional deps may be installed later.
        doc_convert_available = False
        try:
            from ac_dc.doc_convert import DocConvert
            doc_convert_available = DocConvert._probe_import("markitdown")
        except Exception:
            pass

        return {
            "messages": self._context.get_history(),
            "selected_files": list(self._selected_files),
            "excluded_index_files": list(self._excluded_index_files),
            "streaming_active": self._active_user_request is not None,
            "session_id": self._session_id,
            "repo_name": self._repo.name if self._repo else "",
            "init_complete": self._init_complete,
            "mode": self._context.mode.value,
            "cross_ref_enabled": self._cross_ref_enabled,
            "enrichment_status": self._enrichment_status,
            "review_state": self.get_review_state(),
            "doc_convert_available": doc_convert_available,
        }

    # ------------------------------------------------------------------
    # URL service RPC surface
    # ------------------------------------------------------------------
    #
    # Thin delegations to the URL service so the browser can drive
    # the URL chip UI (detect on input, fetch on click, view
    # content in a modal, remove/invalidate). The frontend calls
    # these via jrpc-oo; the service methods themselves are pure
    # delegations.

    def detect_urls(self, text: str) -> list[dict[str, Any]]:
        """Return detected URLs with classification and display names.

        Shape: ``[{url, type, display_name}, ...]``. ``type`` is the
        string form of :class:`URLType` so the frontend doesn't
        need to unwrap an enum.
        """
        return self._url_service.detect_urls(text)

    async def fetch_url(
        self,
        url: str,
        use_cache: bool = True,
        summarize: bool = True,
        user_text: str | None = None,
    ) -> dict[str, Any]:
        """Fetch a URL with optional summarization.

        Runs in the aux executor so the blocking HTTP / git-clone
        / LLM summarization doesn't starve the event loop. The
        returned dict is the URLContent dataclass's ``to_dict``
        form — frontend consumes the same fields regardless of
        whether it came from a fresh fetch or a cache hit.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted
        assert self._main_loop is not None
        loop = self._main_loop
        content = await loop.run_in_executor(
            self._aux_executor,
            lambda: self._url_service.fetch_url(
                url,
                use_cache=use_cache,
                summarize=summarize,
                user_text=user_text,
            ),
        )
        return content.to_dict()

    async def detect_and_fetch(
        self,
        text: str,
        use_cache: bool = True,
        summarize: bool = True,
    ) -> list[dict[str, Any]] | dict[str, Any]:
        """Detect and fetch all URLs in text.

        Convenience wrapper for the frontend's "fetch all" button
        on the URL chips panel. Sequential per-URL, capped by
        the URL service's ``max_urls`` parameter (None here,
        since the frontend already decides how many to fetch).
        Runs in the aux executor for the same reason as
        :meth:`fetch_url`.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted
        assert self._main_loop is not None
        loop = self._main_loop
        results = await loop.run_in_executor(
            self._aux_executor,
            lambda: self._url_service.detect_and_fetch(
                text,
                use_cache=use_cache,
                summarize=summarize,
            ),
        )
        return [c.to_dict() for c in results]

    def get_url_content(self, url: str) -> dict[str, Any]:
        """Return the stored content for a URL (or a sentinel error).

        Checks in-memory first, falls back to filesystem cache.
        Returns a URLContent dict; the frontend checks the
        ``error`` field to distinguish fetched content from
        "not yet fetched" (sentinel) vs "fetch failed" (real
        error).
        """
        content = self._url_service.get_url_content(url)
        return content.to_dict()

    def invalidate_url_cache(self, url: str) -> dict[str, Any]:
        """Remove a URL from both cache and in-memory dict.

        Used by the "refresh this URL" action on the chip UI —
        forces the next fetch to hit the network.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted
        return self._url_service.invalidate_url_cache(url)

    def remove_fetched_url(self, url: str) -> dict[str, Any]:
        """Remove a URL from the in-memory fetched dict only.

        Preserves the filesystem cache — a later re-fetch will
        hit the cache. Used by the "remove from this conversation"
        action on the chip UI.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted
        return self._url_service.remove_fetched(url)

    def clear_url_cache(self) -> dict[str, Any]:
        """Clear all cached and fetched URLs.

        Used by the "clear URL cache" RPC in the settings UI.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted
        return self._url_service.clear_url_cache()

    # ------------------------------------------------------------------
    # Public RPC — code review mode
    # ------------------------------------------------------------------
    #
    # Review mode presents a feature branch's changes as staged
    # modifications via git soft reset. The file picker, diff
    # viewer, and context engine all work unchanged — edits are
    # disabled (read-only contract), the system prompt swaps to
    # a review-focused variant, and a pre-change symbol map is
    # injected so the LLM can compare pre- and post-change
    # codebase topology.
    #
    # See specs4/4-features/code-review.md for the full git
    # state machine.

    def check_review_ready(self) -> dict[str, Any]:
        """Return whether the working tree is clean enough for review.

        Called by the review selector before rendering the git
        graph — a dirty tree surfaces a clear error inline
        rather than letting the user select a base commit that
        would fail at start_review time.

        Shape — ``{clean: bool, message?: str}``. Message is
        only present when clean is False, explaining what the
        user needs to do.
        """
        if self._repo is None:
            return {
                "clean": False,
                "message": "No repository attached.",
            }
        if self._repo.is_clean():
            return {"clean": True}
        return {
            "clean": False,
            "message": (
                "Working tree has uncommitted changes. "
                "Commit, stash, or discard them before entering "
                "review mode."
            ),
        }

    def get_commit_graph(
        self,
        limit: int = 100,
        offset: int = 0,
        include_remote: bool = False,
    ) -> dict[str, Any]:
        """Return commit graph data for the review selector.

        Thin delegation to the repo. Exposed here so the browser
        can drive the selector via a single service class
        rather than needing a separate Repo registration.
        """
        if self._repo is None:
            return {"commits": [], "branches": [], "has_more": False}
        return self._repo.get_commit_graph(
            limit=limit,
            offset=offset,
            include_remote=include_remote,
        )

    def start_review(
        self,
        branch: str,
        base_commit: str,
    ) -> dict[str, Any]:
        """Enter review mode for ``branch`` starting at ``base_commit``.

        Runs the full entry sequence:

        1. Clean-tree check (rejects if dirty)
        2. Repo-level checkout_review_parent — computes the
           merge-base, records the original branch, and
           checks out the merge-base (disk at pre-change state)
        3. Build pre-change symbol map (if a symbol index is
           attached) — happens HERE, with disk at the
           pre-change state
        4. Repo-level setup_review_soft_reset — checks out the
           branch tip by SHA, soft-resets to the merge-base
           (all feature-branch changes now appear staged)
        5. Get commit log + changed files + stats from the
           repo, cache in _review_state
        6. Rebuild the symbol index (disk now at the post-
           change state — the current symbol map reflects
           reviewed code)
        7. Swap system prompt to the review variant
        8. Clear file selection (review starts with no files
           — user adds them deliberately via the picker or
           via file mentions)
        9. Mark review active, record a system event in
           context and history

        On any failure, attempts to roll back to a clean
        state (via exit_review_mode) and returns an error.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted
        # Basic validation.
        if self._repo is None:
            return {"error": "No repository attached."}
        if self._review_active:
            return {
                "error": (
                    "Review mode is already active. Exit the "
                    "current review first."
                )
            }

        # Step 1 — clean tree.
        clean = self.check_review_ready()
        if not clean["clean"]:
            return {"error": clean.get("message", "Tree not clean")}

        # Step 2 — checkout review parent (merge-base).
        parent_result = self._repo.checkout_review_parent(
            branch, base_commit
        )
        if "error" in parent_result:
            return {"error": parent_result["error"]}

        branch_tip = parent_result["branch_tip"]
        parent_commit = parent_result["parent_commit"]
        original_branch = parent_result["original_branch"]

        # Step 3 — build pre-change symbol map. Disk is at the
        # merge-base, so indexing now captures the pre-change
        # state. Best-effort: if the symbol index isn't
        # attached (tests without it, or deferred init not
        # yet complete), skip this and proceed with an empty
        # pre-change map.
        pre_change_symbol_map = ""
        if self._symbol_index is not None:
            try:
                file_list = self._repo.get_flat_file_list().split("\n")
                file_list = [f for f in file_list if f]
                self._symbol_index.index_repo(file_list)
                pre_change_symbol_map = (
                    self._symbol_index.get_symbol_map()
                )
            except Exception as exc:
                logger.warning(
                    "Pre-change symbol map build failed: %s", exc
                )

        # Step 4 — setup soft reset. Disk moves to branch tip,
        # HEAD stays at merge-base, all changes appear staged.
        reset_result = self._repo.setup_review_soft_reset(
            branch_tip, parent_commit
        )
        if "error" in reset_result:
            # Partial state — try to recover.
            self._repo.exit_review_mode(
                branch_tip, original_branch
            )
            return {"error": reset_result["error"]}

        # Step 5 — gather commits, changed files, stats.
        try:
            commits = self._repo.get_commit_log(
                base=parent_commit,
                head=branch_tip,
                limit=100,
            )
            changed_files = self._repo.get_review_changed_files()
            stats = self._compute_review_stats(
                commits, changed_files
            )
        except Exception as exc:
            logger.exception(
                "Failed to gather review metadata: %s", exc
            )
            self._repo.exit_review_mode(
                branch_tip, original_branch
            )
            return {"error": f"Review setup failed: {exc}"}

        # Step 6 — rebuild symbol index against post-change
        # disk. Best-effort — same as step 3.
        if self._symbol_index is not None:
            try:
                file_list = self._repo.get_flat_file_list().split("\n")
                file_list = [f for f in file_list if f]
                self._symbol_index.index_repo(file_list)
            except Exception as exc:
                logger.warning(
                    "Post-change symbol index rebuild failed: %s",
                    exc,
                )

        # Step 7 — swap system prompt. save_and_replace_system_prompt
        # stashes the current prompt so end_review can restore it.
        review_prompt = self._config.get_review_prompt()
        self._context.save_and_replace_system_prompt(review_prompt)

        # Step 8 — clear file selection. Defense in depth: we
        # clear both _selected_files (authoritative server
        # state) AND broadcast via filesChanged so the picker
        # updates. The frontend also clears its own selection
        # on the review-started event.
        self._selected_files = []
        self._file_context.clear()
        self._broadcast_event("filesChanged", [])

        # Store review state.
        self._review_state = {
            "active": True,
            "branch": branch,
            "branch_tip": branch_tip,
            "base_commit": base_commit,
            "parent_commit": parent_commit,
            "original_branch": original_branch,
            "commits": commits,
            "changed_files": changed_files,
            "stats": stats,
            "pre_change_symbol_map": pre_change_symbol_map,
        }
        self._review_active = True

        # Broadcast review state to all clients. Payload
        # matches what get_review_state() returns —
        # active=True, branch, commits, changed_files,
        # stats, etc. The pre_change_symbol_map is
        # stripped (large, server-only) by the helper.
        # Without this event, the frontend's review
        # banner never appears — files-tab listens on
        # a window event that the app-shell only
        # dispatches in response to the corresponding
        # server-push RPC.
        self._broadcast_event(
            "reviewStarted", self.get_review_state()
        )

        # Step 9 — system event.
        event_text = (
            f"Entered review mode for `{branch}` "
            f"({len(commits)} commits, "
            f"{stats.get('files_changed', 0)} files changed)."
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
            "status": "review_active",
            "branch": branch,
            "base_commit": base_commit,
            "commits": commits,
            "changed_files": changed_files,
            "stats": stats,
        }

    def end_review(self) -> dict[str, Any]:
        """Exit review mode, restoring the pre-review git state.

        Runs the exit sequence:

        1. Repo-level exit_review_mode — soft resets to branch
           tip (disk unchanged), checks out the original branch
        2. Rebuild the symbol index against the restored disk
           state
        3. Restore the original system prompt
        4. Clear review state
        5. Record a system event

        If the repo-level exit fails (original branch was
        deleted, etc.), HEAD remains detached at the branch
        tip. The error is surfaced with guidance; review state
        is still cleared so the user isn't stuck in the
        client-side review UI.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted
        if not self._review_active:
            return {"error": "Review mode is not active."}
        if self._repo is None:
            return {"error": "No repository attached."}

        branch_tip = self._review_state["branch_tip"]
        original_branch = self._review_state["original_branch"]

        # Step 1 — exit at the repo level.
        exit_result = self._repo.exit_review_mode(
            branch_tip, original_branch
        )
        exit_error = exit_result.get("error")

        # Step 2 — rebuild symbol index. Best-effort even on
        # partial failure.
        if self._symbol_index is not None:
            try:
                file_list = self._repo.get_flat_file_list().split("\n")
                file_list = [f for f in file_list if f]
                self._symbol_index.index_repo(file_list)
            except Exception as exc:
                logger.warning(
                    "Symbol index rebuild after review failed: %s",
                    exc,
                )

        # Step 3 — restore system prompt.
        self._context.restore_system_prompt()

        # Step 4 — clear review state regardless of repo-level
        # success. Leaving review_active=True after a failed
        # exit would mean the user can't retry without manual
        # intervention.
        self._review_state = {
            "active": False,
            "branch": None,
            "branch_tip": None,
            "base_commit": None,
            "parent_commit": None,
            "original_branch": None,
            "commits": [],
            "changed_files": [],
            "stats": {},
            "pre_change_symbol_map": "",
        }
        self._review_active = False
        # Clear review context that was injected into prompts.
        self._context.clear_review_context()

        # Broadcast the exit so frontend clients clear
        # their review UI (banner, commit-button gate).
        # The get_review_state() payload is the empty-
        # state shape — active=False with null fields —
        # matching what the initial snapshot carries
        # before any review has started.
        self._broadcast_event(
            "reviewEnded", self.get_review_state()
        )

        # Step 5 — system event. Different phrasing depending
        # on whether exit succeeded cleanly.
        if exit_error:
            event_text = (
                f"Exited review mode with issues: {exit_error}"
            )
        else:
            event_text = "Exited review mode."
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

        if exit_error:
            return {"error": exit_error, "status": "partial"}
        return {"status": "restored"}

    def get_review_state(self) -> dict[str, Any]:
        """Return the current review state.

        Exposed as an RPC so the browser can sync review-mode
        UI on connect and after each state-changing operation
        (start, end). Returns a copy — caller mutations don't
        affect stored state.

        The ``pre_change_symbol_map`` field is excluded from
        the returned dict because it can be large (whole
        repo's worth of text) and isn't needed by the
        frontend — it's consumed server-side when assembling
        the review context for LLM requests.
        """
        state = dict(self._review_state)
        state.pop("pre_change_symbol_map", None)
        # Defensive copies of mutable sub-fields.
        state["commits"] = list(state.get("commits") or [])
        state["changed_files"] = list(state.get("changed_files") or [])
        state["stats"] = dict(state.get("stats") or {})
        return state

    def get_review_file_diff(self, path: str) -> dict[str, Any]:
        """Return the reverse diff for a single file during review.

        Thin delegation to the repo. The repo's
        ``get_review_file_diff`` runs ``git diff --cached -- path``
        which produces the staged-changes diff — matches
        specs4's "reverse diff" semantics (shows what would
        revert the file to the pre-review state).

        Returns ``{path, diff}`` on success or
        ``{error: ...}`` when review isn't active or the
        path isn't valid.
        """
        if not self._review_active:
            return {"error": "Review mode is not active."}
        if self._repo is None:
            return {"error": "No repository attached."}
        try:
            return self._repo.get_review_file_diff(path)
        except Exception as exc:
            return {"error": str(exc)}

    @staticmethod
    def _compute_review_stats(
        commits: list[dict[str, Any]],
        changed_files: list[dict[str, Any]],
    ) -> dict[str, int]:
        """Compute aggregate stats for the review state.

        Returns counts used by the review status bar and the
        LLM's review context header.
        """
        additions = sum(
            int(f.get("additions", 0) or 0) for f in changed_files
        )
        deletions = sum(
            int(f.get("deletions", 0) or 0) for f in changed_files
        )
        return {
            "commit_count": len(commits),
            "files_changed": len(changed_files),
            "additions": additions,
            "deletions": deletions,
        }

    def _build_and_set_review_context(self) -> None:
        """Build the review context block and attach to context manager.

        Called from ``_stream_chat`` on every request during
        review mode. Rebuilds from scratch so the reverse-diff
        set reflects the CURRENT file selection.

        Block structure:

        1. Review summary — branch, commit range, file/line stats
        2. Commits list — ordered, each with short SHA + message +
           author + relative date
        3. Pre-change symbol map header + the cached map
        4. Reverse diffs for every selected file that's also in
           the review's changed file set — per-file diff fetched
           via ``Repo.get_review_file_diff``

        Unchanged files and files absent from the review's
        changed-files list contribute no diff. A file can appear
        in the selected set without being in the review
        (e.g., the user selected it for reference but it wasn't
        touched by the feature branch) — such files render as
        full content in the active "Working Files" section via
        the normal tier assembly, not here.
        """
        state = self._review_state
        if not state.get("active") or self._repo is None:
            return

        parts: list[str] = []

        # 1. Summary block.
        branch = state.get("branch") or "(unknown)"
        parent = (state.get("parent_commit") or "")[:7]
        tip = (state.get("branch_tip") or "")[:7]
        stats = state.get("stats") or {}
        commit_count = stats.get("commit_count", 0)
        files_changed = stats.get("files_changed", 0)
        additions = stats.get("additions", 0)
        deletions = stats.get("deletions", 0)
        summary_line = (
            f"## Review: {branch} (merge-base {parent} → {tip})\n"
            f"{commit_count} commits, "
            f"{files_changed} files changed, "
            f"+{additions} -{deletions}"
        )
        parts.append(summary_line)

        # 2. Commits list. Rendered oldest → newest in the
        # order the repo returned them; we iterate in reverse
        # so the newest commit appears first (matches how
        # `git log` presents history and what the LLM expects
        # to see at the top).
        commits = state.get("commits") or []
        if commits:
            commit_lines = ["## Commits"]
            for i, commit in enumerate(commits, start=1):
                short = commit.get("short_sha") or (
                    (commit.get("sha") or "")[:7]
                )
                msg = (
                    (commit.get("message") or "")
                    .split("\n", 1)[0]
                )
                author = commit.get("author") or "?"
                date = (
                    commit.get("relative_date")
                    or commit.get("date")
                    or ""
                )
                commit_lines.append(
                    f"{i}. {short} {msg} ({author}, {date})"
                )
            parts.append("\n".join(commit_lines))

        # 3. Pre-change symbol map. May be empty — indexing could
        # have failed on entry, or the repo was empty at the
        # merge-base. Emit the header unconditionally so the LLM
        # sees the structural comparison affordance even when the
        # map is missing.
        pre_map = state.get("pre_change_symbol_map") or ""
        if pre_map:
            parts.append(
                "## Pre-Change Symbol Map\n"
                "Symbol map from the parent commit (before the "
                "reviewed changes). Compare against the current "
                "symbol map in the repository structure above.\n\n"
                + pre_map
            )

        # 4. Reverse diffs for every selected file that's also
        # in the review's changed-files set. Selected-but-
        # unchanged files contribute no diff — they render as
        # normal working files via the tier assembler.
        changed_files_entries = state.get("changed_files") or []
        changed_paths = {
            f.get("path"): f for f in changed_files_entries
            if f.get("path")
        }
        diff_blocks: list[str] = []
        for path in self._selected_files:
            if path not in changed_paths:
                continue
            try:
                diff_result = self._repo.get_review_file_diff(path)
            except Exception as exc:
                logger.debug(
                    "Review diff fetch failed for %s: %s",
                    path, exc,
                )
                continue
            diff_text = diff_result.get("diff") or ""
            if not diff_text:
                continue
            entry = changed_paths[path]
            add_ct = entry.get("additions", 0)
            del_ct = entry.get("deletions", 0)
            diff_blocks.append(
                f"### {path} (+{add_ct} -{del_ct})\n"
                "```diff\n"
                f"{diff_text}"
                "\n```"
            )
        if diff_blocks:
            parts.append(
                "## Reverse Diffs (selected files)\n"
                "These diffs show what would revert each file "
                "to the pre-review state. The full current "
                "content is in the working files above.\n\n"
                + "\n\n".join(diff_blocks)
            )

        # Install on the context manager. The tiered assembler
        # renders this as a uncached user/assistant pair between
        # URL context and active files (see
        # specs4/3-llm/prompt-assembly.md).
        review_text = "\n\n".join(parts)
        self._context.set_review_context(review_text)

    # ------------------------------------------------------------------
    # Public RPC — snippets
    # ------------------------------------------------------------------

    def get_snippets(self) -> list[dict[str, str]]:
        """Return snippets appropriate for the current mode.

        Priority:

        1. Review mode active → review snippets
        2. Document mode → doc snippets
        3. Otherwise (code mode) → code snippets

        The frontend calls this unconditionally on RPC ready,
        on review state change, and on mode change — it doesn't
        need to know which mode or state produced the result.
        """
        if self._review_active:
            return self._config.get_snippets("review")
        if self._context.mode == Mode.DOC:
            return self._config.get_snippets("doc")
        return self._config.get_snippets("code")

    # ------------------------------------------------------------------
    # Public RPC — file selection
    # ------------------------------------------------------------------

    def set_selected_files(
        self, files: list[str]
    ) -> list[str] | dict[str, Any]:
        """Replace the selected-files list.

        Stored as a copy so caller mutations don't leak. Broadcast
        to all connected clients via ``filesChanged`` so each
        client's picker updates. Returns the canonical list on
        success, or a restricted-error dict when the caller is a
        non-localhost participant in collaboration mode.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted
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
    # Public RPC — navigation broadcast
    # ------------------------------------------------------------------

    def navigate_file(self, path: str) -> dict[str, Any]:
        """Broadcast file navigation to all connected clients.

        Called when a client navigates to a file (file picker click,
        search result, edit block anchor). All clients open the same
        file in their viewer. The frontend's ``_fromNav`` flag
        prevents echo loops.
        """
        self._broadcast_event("navigateFile", {"path": path})
        return {"status": "ok", "path": path}

    # ------------------------------------------------------------------
    # Public RPC — excluded index files
    # ------------------------------------------------------------------

    def set_excluded_index_files(
        self, files: list[str]
    ) -> list[str]:
        """Store the set of files excluded from the index.

        Excluded files have no content, no index block, and no
        tracker item in the stability system. Used by the file
        picker's three-state checkbox (shift+click to exclude).

        Returns the canonical excluded list.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted  # type: ignore[return-value]
        self._excluded_index_files = list(files)
        # Remove excluded items from EVERY mode's tracker,
        # not just the currently-active one. Without this,
        # excluding files in one mode leaves stale entries
        # in the other mode's tracker — visible in the cache
        # viewer after a mode switch. `_update_stability`
        # step 0a eventually cleans them up on the next chat
        # request, but the Context tab's breakdown call
        # doesn't trigger that path, so users see excluded
        # files rendered as cached tier entries in the UI.
        for tracker in self._trackers.values():
            for path in files:
                for prefix in ("symbol:", "doc:", "file:"):
                    key = prefix + path
                    if tracker.has_item(key):
                        all_items = tracker.get_all_items()
                        item = all_items.get(key)
                        if item is not None:
                            tracker._items.pop(key, None)
                            tracker._broken_tiers.add(item.tier)
        self._broadcast_event("filesChanged", list(self._selected_files))
        return list(self._excluded_index_files)

    def get_excluded_index_files(self) -> list[str]:
        """Return the current excluded-files list."""
        return list(getattr(self, "_excluded_index_files", []))

    # ------------------------------------------------------------------
    # Public RPC — history browsing and session management
    # ------------------------------------------------------------------

    def history_search(
        self,
        query: str,
        role: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Search conversation history across all sessions."""
        if self._history_store is None:
            return []
        return self._history_store.search_messages(
            query, role=role, limit=limit
        )

    def history_list_sessions(
        self, limit: int | None = None
    ) -> list[dict[str, Any]]:
        """Return recent sessions for the history browser."""
        if self._history_store is None:
            return []
        sessions = self._history_store.list_sessions(limit=limit)
        return [
            {
                "session_id": s.session_id,
                "timestamp": s.timestamp,
                "message_count": s.message_count,
                "preview": s.preview,
                "first_role": s.first_role,
            }
            for s in sessions
        ]

    def history_get_session(
        self, session_id: str
    ) -> list[dict[str, Any]]:
        """Return all messages for a session (full metadata)."""
        if self._history_store is None:
            return []
        return self._history_store.get_session_messages(session_id)

    def load_session_into_context(
        self, session_id: str
    ) -> dict[str, Any]:
        """Load a previous session into the active context.

        Clears current history, loads the target session's
        messages, and reuses that session's ID so subsequent
        messages persist to the same session.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted
        if self._history_store is None:
            return {"error": "No history store available"}
        messages = self._history_store.get_session_messages_for_context(
            session_id
        )
        if not messages:
            return {"error": f"Session {session_id} not found or empty"}
        # Clear and replace.
        self._context.clear_history()
        self._context.set_history(messages)
        self._session_id = session_id
        # Broadcast to all clients so collaborators see the loaded
        # conversation.
        self._broadcast_event(
            "sessionChanged",
            {
                "session_id": session_id,
                "messages": messages,
            },
        )
        return {
            "session_id": session_id,
            "messages": messages,
        }

    def history_new_session(self) -> dict[str, Any]:
        """Create a new history session (alias for new_session)."""
        return self.new_session()

    def get_history_status(self) -> dict[str, Any]:
        """Return history token counts and compaction status.

        Used by the dialog's history bar to show usage percentage.
        """
        budget = self._context.get_token_budget()
        compaction = self._context.get_compaction_status()
        return {
            "session_id": self._session_id,
            "history_tokens": budget["history_tokens"],
            "max_history_tokens": budget["max_history_tokens"],
            "remaining": budget["remaining"],
            "needs_compaction": budget["needs_compaction"],
            "compaction_enabled": compaction["enabled"],
            "compaction_trigger": compaction["trigger_tokens"],
            "compaction_percent": compaction["percent"],
        }

    # ------------------------------------------------------------------
    # Public RPC — TeX preview
    # ------------------------------------------------------------------

    def is_tex_preview_available(self) -> dict[str, Any]:
        """Check if TeX preview dependencies are installed.

        Two-stage probe: ``make4ht`` binary on PATH, and the
        ``tex4ht.sty`` package resolvable via ``kpsewhich``. Both
        must be present for compilation to succeed — a common
        failure mode is ``make4ht`` installed standalone (e.g.
        from ``luatex`` on a minimal TeX install) but the
        ``tex4ht`` package missing, which produces a confusing
        mid-compile LaTeX error about ``tex4ht.sty`` rather than
        an upfront "not installed" message.

        Returns ``{"available": True}`` when both present, or
        ``{"available": False, "install_hint": "..."}`` with a
        targeted hint naming the specific missing piece so the
        user knows which package to install.
        """
        from ac_dc.repo import Repo
        if not Repo.is_make4ht_available():
            return {
                "available": False,
                "install_hint": (
                    "make4ht not found on PATH. "
                    "Install TeX Live or MiKTeX with make4ht. "
                    "On Ubuntu/Debian: sudo apt install texlive-full"
                ),
            }
        if not Repo.is_tex4ht_package_available():
            return {
                "available": False,
                "install_hint": (
                    "make4ht is installed, but the tex4ht package "
                    "is missing. "
                    "On Ubuntu/Debian: "
                    "sudo apt install texlive-plain-generic "
                    "(or texlive-full for everything)."
                ),
            }
        return {"available": True}

    def compile_tex_preview(
        self,
        content: str,
        file_path: str | None = None,
    ) -> dict[str, Any]:
        """Compile TeX source to HTML for live preview.

        Delegates to :meth:`Repo.compile_tex_preview`. Returns
        ``{"html": "..."}`` on success or ``{"error": "..."}``
        on failure.
        """
        if self._repo is None:
            return {"error": "No repository attached"}
        return self._repo.compile_tex_preview(content, file_path)

    # ------------------------------------------------------------------
    # Public RPC — cache viewer / map block
    # ------------------------------------------------------------------

    def get_file_map_block(
        self, path: str
    ) -> dict[str, Any]:
        """Return the index block for a file or special key.

        Used by the cache viewer's item-click-to-view feature.
        Dispatches based on a priority chain:

        1. Special keys — ``system:prompt`` returns the system
           prompt + legend for the current mode.
        2. Current mode's index tried first.
        3. Cross-mode fallback — if primary has no data, try the
           other index (handles cross-reference mode).
        4. Error if neither has data.
        """
        # Special key: system prompt. Pick the mode-
        # appropriate prompt + legend so the cache viewer
        # shows whatever is actually going to the LLM this
        # turn. In doc mode, that's the doc system prompt
        # plus the doc index's legend; otherwise the code
        # system prompt plus the symbol index's legend.
        if path == "system:prompt":
            if self._context.mode == Mode.DOC:
                prompt = self._config.get_doc_system_prompt()
                legend = self._doc_index.get_legend()
            else:
                prompt = self._config.get_system_prompt()
                legend = ""
                if self._symbol_index is not None:
                    try:
                        legend = self._symbol_index.get_legend()
                    except Exception:
                        pass
            return {
                "path": "system:prompt",
                "content": prompt + (
                    "\n\n" + legend if legend else ""
                ),
                "mode": self._context.mode.value,
            }

        # Synthetic meta:* keys — sections of the assembled
        # prompt that aren't individual tracker entries. The
        # cache viewer surfaces these as rows per
        # specs4/5-webapp/viewers-hud.md § "Synthetic Meta
        # Rows"; clicking them opens this modal, which must
        # return the aggregate content that would have gone
        # into the prompt for that section.
        if path.startswith("meta:"):
            return self._get_meta_block(path)

        # Prefix dispatch. The tracker uses three path-bearing
        # prefixes and each represents a different KIND of
        # content in the prompt:
        #
        #   - file:{path}   — full file bytes, rendered under
        #     FILES_L{N}_HEADER in the file's cached tier (or
        #     the active "Working Files" section if
        #     ungraduated). Modal should show the same full
        #     content.
        #   - symbol:{path} — compact symbol-index block (the
        #     ``i,c,f,v`` summary from the symbol map).
        #     Rendered under TIER_SYMBOLS_HEADER.
        #   - doc:{path}    — compact doc-index block (heading
        #     outline, section refs). Also under
        #     TIER_SYMBOLS_HEADER in doc mode.
        #
        # Callers may also pass a bare path without a prefix;
        # that falls through to the mode-based dispatch below
        # (compact block via the primary index).
        if path.startswith("file:"):
            file_path = path[len("file:"):]
            content = self._file_context.get_content(file_path)
            if content is not None:
                return {
                    "path": file_path,
                    "content": content,
                    "mode": self._context.mode.value,
                }
            # Selected file ungraduated but not loaded into
            # the context yet (rare — normally _sync_file_context
            # loads every selected file before every request).
            # Fall back to reading from disk so the modal
            # shows something useful. If the read fails the
            # caller sees the generic "no index data found"
            # error below.
            if self._repo is not None:
                try:
                    disk_content = self._repo.get_file_content(
                        file_path
                    )
                    return {
                        "path": file_path,
                        "content": disk_content,
                        "mode": self._context.mode.value,
                    }
                except Exception:
                    pass
            return {
                "error": (
                    f"File content for {file_path} not "
                    "available (not in file context, not "
                    "readable from disk)"
                ),
                "path": path,
            }
        # symbol: and doc: strip the prefix and fall through
        # to the compact-block dispatch below.
        for prefix in ("symbol:", "doc:"):
            if path.startswith(prefix):
                path = path[len(prefix):]
                break

        # Dispatch by current mode. In code mode, symbol
        # index is primary; doc index is a fallback for
        # cross-reference items that landed in the tracker.
        # In doc mode, the order flips.
        if self._context.mode == Mode.DOC:
            primary = self._doc_index.get_file_doc_block(path)
            if primary:
                return {
                    "path": path,
                    "content": primary,
                    "mode": "doc",
                }
            # Cross-reference fallback — a symbol: entry may
            # be in the tracker while in doc mode.
            if self._symbol_index is not None:
                secondary = self._symbol_index.get_file_symbol_block(
                    path
                )
                if secondary:
                    return {
                        "path": path,
                        "content": secondary,
                        "mode": "code",
                    }
        else:
            if self._symbol_index is not None:
                primary = self._symbol_index.get_file_symbol_block(
                    path
                )
                if primary:
                    return {
                        "path": path,
                        "content": primary,
                        "mode": "code",
                    }
            # Cross-reference fallback — a doc: entry may
            # be in the tracker while in code mode.
            secondary = self._doc_index.get_file_doc_block(path)
            if secondary:
                return {
                    "path": path,
                    "content": secondary,
                    "mode": "doc",
                }

        return {
            "error": f"No index data found for {path}",
            "path": path,
        }

    def _wide_map_exclude_set(self) -> set[str]:
        """Compute the wide exclusion set for aggregate map bodies.

        The aggregate symbol-map or doc-map body (rendered in L0's
        system message) must exclude every path whose full content
        or compact block already appears elsewhere in the prompt.
        Without this exclusion, files that have graduated into
        cached tiers would render twice — once as a compact block
        in the aggregate map, and once under their tier's
        TIER_SYMBOLS_HEADER or FILES_L{N}_HEADER section — wasting
        tokens and confusing the model about which view is
        authoritative.

        The exclusion set is the union of:

        1. Selected files — their full content renders in the
           active "Working Files" section (if ungraduated) or in
           a cached tier's FILES_L{N}_HEADER block (if graduated
           as ``file:``)
        2. User-excluded index files — no representation in the
           prompt at all, so the aggregate map must also skip them
        3. Every path graduated into any cached tier as ``file:``,
           ``symbol:``, or ``doc:`` — all three prefixes represent
           content that's already in a cached tier's section

        All three tier-item prefixes contribute because each
        represents a file whose content (full or compact) appears
        in a cached tier's TIER_SYMBOLS_HEADER / FILES_L{N}_HEADER
        block. A ``symbol:{path}`` entry in L2 means that file's
        compact block is in L2's content body; rendering the same
        block in the aggregate L0 map would be duplicate prompt
        content.

        Per specs-reference/3-llm/prompt-assembly.md § "Symbol map
        exclusions". Three call sites must agree on this
        computation: ``_assemble_tiered`` (what the LLM receives),
        ``_get_meta_block`` (modal content for click-to-view), and
        ``get_context_breakdown`` (token counts for cache viewer
        rows). A divergence between any two surfaces the same-row/
        different-count bug documented in the spec.

        This helper is the canonical source for the computation.
        ``_assemble_tiered`` derives its exclusion set from a
        different source (the tiered_content dict's
        ``graduated_files`` lists, computed at build time); the
        two paths converge on the same exclusion set but via
        different inputs, which is fine. The two meta-related
        surfaces (``_get_meta_block``, ``get_context_breakdown``)
        both call this helper.
        """
        from ac_dc.stability_tracker import Tier

        exclude: set[str] = set(self._selected_files)
        exclude.update(
            getattr(self, "_excluded_index_files", None) or ()
        )
        for tier in (Tier.L0, Tier.L1, Tier.L2, Tier.L3):
            for item_key in self._stability_tracker.get_tier_items(tier):
                for prefix in ("file:", "symbol:", "doc:"):
                    if item_key.startswith(prefix):
                        exclude.add(item_key[len(prefix):])
                        break
        return exclude

    def _get_meta_block(self, key: str) -> dict[str, Any]:
        """Return the content for a synthetic meta:* cache row.

        The cache viewer emits meta:* rows for sections of the
        prompt that aren't individual tracker entries — the
        aggregate repo/doc map, the file tree, fetched URLs,
        review context, and active files. Clicking a meta row
        opens the map-block modal, which routes here rather
        than through the file-path dispatch in
        get_file_map_block.

        Each sub-key produces the same text the assembler
        would inject into the prompt this turn. For the
        aggregate map, that means re-running the map builder
        with the same exclusions the assembler uses; for URLs
        and review context we return the formatted block
        directly.
        """
        # meta:repo_map / meta:doc_map — aggregate index map
        # body for the current mode. Matches what
        # _assemble_tiered feeds into the L0 system message.
        if key in ("meta:repo_map", "meta:doc_map"):
            # Wide exclusion set — see _wide_map_exclude_set for
            # the rationale. The same exclusion must be applied
            # in get_context_breakdown so the row's token count
            # matches the modal content this branch produces.
            exclude = self._wide_map_exclude_set()
            if self._context.mode == Mode.DOC:
                content = self._doc_index.get_doc_map(
                    exclude_files=exclude
                )
                mode = "doc"
            else:
                content = ""
                if self._symbol_index is not None:
                    try:
                        content = self._symbol_index.get_symbol_map(
                            exclude_files=exclude
                        )
                    except Exception as exc:
                        logger.warning(
                            "Aggregate symbol map fetch failed: %s",
                            exc,
                        )
                mode = "code"
            if not content:
                return {
                    "error": (
                        "Aggregate map is empty — every indexed "
                        "file has graduated to a cached tier."
                    ),
                    "path": key,
                }
            return {
                "path": key,
                "content": content,
                "mode": mode,
            }

        # meta:file_tree — flat repo file listing.
        if key == "meta:file_tree":
            if self._repo is None:
                return {"error": "No repository attached", "path": key}
            try:
                content = self._repo.get_flat_file_list()
            except Exception as exc:
                return {"error": str(exc), "path": key}
            return {
                "path": key,
                "content": content or "(empty)",
                "mode": "code",
            }

        # meta:url:{url} — individual fetched URL body.
        if key.startswith("meta:url:"):
            url = key[len("meta:url:"):]
            content_obj = self._url_service.get_url_content(url)
            if content_obj.error and content_obj.error != "":
                # "URL not yet fetched" is the sentinel shape —
                # surface it as an error so the user knows why
                # the row is empty.
                return {
                    "error": content_obj.error,
                    "path": key,
                }
            formatted = content_obj.format_for_prompt()
            return {
                "path": key,
                "content": formatted or "(empty)",
                "mode": self._context.mode.value,
            }

        # meta:review_context — review mode's injected block.
        if key == "meta:review_context":
            review_text = self._context.get_review_context()
            if not review_text:
                return {
                    "error": "Review context is empty",
                    "path": key,
                }
            return {
                "path": key,
                "content": review_text,
                "mode": self._context.mode.value,
            }

        # meta:active_file:{path} — an active (non-graduated)
        # selected file. Returns the file content as it would
        # appear in the "Working Files" section.
        if key.startswith("meta:active_file:"):
            file_path = key[len("meta:active_file:"):]
            content = self._file_context.get_content(file_path)
            if content is None:
                return {
                    "error": (
                        f"File {file_path} is not currently "
                        "loaded into context."
                    ),
                    "path": key,
                }
            return {
                "path": key,
                "content": content,
                "mode": self._context.mode.value,
            }

        return {
            "error": f"Unknown meta key: {key}",
            "path": key,
        }

    # ------------------------------------------------------------------
    # Public RPC — LSP delegation
    # ------------------------------------------------------------------

    def lsp_get_hover(
        self,
        path: str,
        line: int,
        col: int,
    ) -> dict[str, Any] | None:
        """Delegate to SymbolIndex.lsp_get_hover."""
        if self._symbol_index is None:
            return None
        return self._symbol_index.lsp_get_hover(path, line, col)

    def lsp_get_definition(
        self,
        path: str,
        line: int,
        col: int,
    ) -> dict[str, Any] | None:
        """Delegate to SymbolIndex.lsp_get_definition."""
        if self._symbol_index is None:
            return None
        return self._symbol_index.lsp_get_definition(path, line, col)

    def lsp_get_references(
        self,
        path: str,
        line: int,
        col: int,
    ) -> list[dict[str, Any]]:
        """Delegate to SymbolIndex.lsp_get_references."""
        if self._symbol_index is None:
            return []
        return self._symbol_index.lsp_get_references(path, line, col)

    def lsp_get_completions(
        self,
        path: str,
        line: int,
        col: int,
        prefix: str = "",
    ) -> list[dict[str, Any]]:
        """Delegate to SymbolIndex.lsp_get_completions."""
        if self._symbol_index is None:
            return []
        return self._symbol_index.lsp_get_completions(
            path, line, col, prefix
        )

    # ------------------------------------------------------------------
    # Public RPC — mode and cross-reference
    # ------------------------------------------------------------------

    def get_mode(self) -> dict[str, Any]:
        """Return current mode and cross-reference state.

        The frontend polls this to re-sync on reconnect and to
        gate the cross-reference toggle on doc-index readiness.

        Readiness flags reflect the two-phase principle from
        specs4/2-indexing/document-index.md § Two-Phase:

        - ``doc_index_ready`` — structural extraction complete;
          cross-reference toggle can activate.
        - ``doc_index_building`` — structural extraction in
          progress; UI can show a progress indicator.
        - ``doc_index_enriched`` — keyword enrichment complete.
          Backwards-compatibility boolean; maps to
          ``enrichment_status == "complete"``. Prefer
          ``enrichment_status`` for new callers — it
          distinguishes "unavailable" from "pending".
        - ``enrichment_status`` — tristate keyword-enrichment
          state. Values:

          - ``"pending"`` — background build hasn't started
            enrichment yet (or the service just started and
            the build is running structural extraction).
          - ``"building"`` — enrichment loop is active.
            Frontend shows a progress overlay.
          - ``"complete"`` — all files enriched. Overlay fades
            out.
          - ``"unavailable"`` — KeyBERT or sentence-transformers
            not installed, or the model failed to load.
            Frontend shows a one-time warning toast pointing
            at ``pip install 'ac-dc[docs]'``.
        - ``cross_ref_ready`` — currently mirrors
          ``doc_index_ready``. Structural extraction is the
          minimum readiness for cross-reference to produce
          content; enrichment improves the quality of the
          output but isn't a gate.

        Returned shape matches the specs4 RPC contract and is
        stable across both code and doc modes.
        """
        return {
            "mode": self._context.mode.value,
            "doc_index_ready": self._doc_index_ready,
            "doc_index_building": self._doc_index_building,
            "doc_index_enriched": self._doc_index_enriched,
            "enrichment_status": self._enrichment_status,
            "cross_ref_ready": self._doc_index_ready,
            "cross_ref_enabled": self._cross_ref_enabled,
        }

    def switch_mode(self, mode: str) -> dict[str, Any]:
        """Switch between code and document mode.

        Matches specs4/3-llm/modes.md:

        - Reset cross-reference to OFF (mode-scoped UI state)
        - Swap system prompt (code → doc or doc → code)
        - Swap stability tracker (each mode has its own; lazy
          construction for the DOC tracker on first switch)
        - Insert system-event message into conversation history
          so the LLM sees the mode change
        - Broadcast ``modeChanged`` to collaborators

        Rejects unknown mode strings. Switching to the
        already-active mode is a no-op that still returns the
        current mode — matches idempotence expectations of the
        frontend's mode-refresh flow.

        Doc mode currently works only with an empty doc index;
        once Layer 2's doc-index sub-layer lands, doc mode will
        feed doc outlines into context. Switching is still
        meaningful today because the system prompt swap changes
        the LLM's behaviour.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted
        # Validate the mode string. Mode(mode) raises ValueError
        # on unknown inputs — we catch and return a clean RPC
        # error rather than propagating.
        try:
            target = Mode(mode)
        except ValueError:
            return {
                "error": (
                    f"Unknown mode {mode!r}; expected 'code' or 'doc'"
                )
            }

        current = self._context.mode
        if target == current:
            # Already in the requested mode. Return the current
            # state without side effects — matches the
            # frontend's mode-refresh auto-switch logic which
            # may call switch_mode redundantly.
            return {
                "mode": target.value,
                "message": f"Already in {target.value} mode",
            }

        # Cross-reference toggle resets to OFF on mode switch.
        # If it was on, remove cross-ref items from the current
        # tracker BEFORE swapping so the removal runs against
        # the right prefix (code-mode tracker removes doc:*,
        # doc-mode tracker removes symbol:*).
        if self._cross_ref_enabled:
            self._remove_cross_reference_items()
            self._cross_ref_enabled = False

        # Lazy-construct the target mode's tracker on first use.
        if target not in self._trackers:
            self._trackers[target] = StabilityTracker(
                cache_target_tokens=(
                    self._config.cache_target_tokens_for_model()
                ),
            )

        # Swap prompts. The context manager's save/replace
        # saves the CURRENT prompt and installs the new one, so
        # a switch back restores the saved prompt. But we want
        # the new prompt to persist across another switch —
        # set_system_prompt (non-saving) is the right primitive.
        if target == Mode.DOC:
            new_prompt = self._config.get_doc_system_prompt()
        else:
            new_prompt = self._config.get_system_prompt()
        self._context.set_system_prompt(new_prompt)

        # Swap trackers.
        self._stability_tracker = self._trackers[target]
        self._context.set_stability_tracker(self._stability_tracker)

        # Update the context manager's mode flag.
        self._context.set_mode(target)

        # Initialize the target mode's tracker if this is the
        # first time we've switched into it. Without this, the
        # new mode's tracker starts empty — the cache viewer
        # shows nothing until the user clicks Rebuild (which
        # bypasses the flag via _rebuild_cache_impl). Running
        # init here produces the expected behaviour: switching
        # modes immediately surfaces that mode's index entries
        # in the tracker. _try_initialize_stability checks its
        # own readiness gates (symbol index attached for code
        # mode, doc index ready for doc mode) and is a no-op
        # when the per-mode flag is already set.
        self._try_initialize_stability()

        # Record a system event so the LLM sees the transition
        # in its next request. The streaming handler will
        # persist this to JSONL on the next append cycle via
        # the standard system-event flag.
        event_text = f"Switched to {target.value} mode."
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

        # Broadcast to collaborators. Fire-and-forget per the
        # general event-callback contract.
        self._broadcast_event("modeChanged", {"mode": target.value})

        return {"mode": target.value}

    def set_cross_reference(self, enabled: bool) -> dict[str, Any]:
        """Toggle cross-reference mode.

        When enabled, the opposite index's items are added to
        the active tracker. In code mode that means ``doc:*``
        items; in doc mode that means ``symbol:*`` items.

        Readiness gate — enabling cross-reference requires
        structural doc-index extraction to be complete
        (``_doc_index_ready`` flipped True via 2.8.2b's
        background build). Enabling before readiness returns
        an error rather than silently producing an empty
        secondary index. Disable is always allowed (it's the
        cleanup path; gating it would leave users stuck).

        On enable, seeds the active tracker with cross-ref
        items from the reference graph so content appears on
        the VERY NEXT request rather than waiting one full
        cycle for ``_update_stability`` to discover them. On
        disable, removes all cross-ref items from the tracker
        and marks their tiers broken so the next cascade
        rebalances cleanly.

        Both paths broadcast ``modeChanged`` to collaborators
        with the new state.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted
        new_state = bool(enabled)
        if new_state == self._cross_ref_enabled:
            return {
                "status": "ok",
                "cross_ref_enabled": new_state,
            }

        # Enable requires readiness. Disable doesn't — the
        # caller may be cleaning up after a failed enable or
        # after a mode switch that left stale items.
        if new_state and not self._doc_index_ready:
            return {
                "error": "cross-reference not ready",
                "reason": (
                    "Doc index is still building; try again "
                    "in a moment"
                ),
            }

        self._cross_ref_enabled = new_state
        if new_state:
            self._seed_cross_reference_items()
        else:
            self._remove_cross_reference_items()

        # Broadcast so collaborators see the state update.
        self._broadcast_event(
            "modeChanged",
            {
                "mode": self._context.mode.value,
                "cross_ref_enabled": new_state,
            },
        )
        return {
            "status": "ok",
            "cross_ref_enabled": new_state,
        }

    def _seed_cross_reference_items(self) -> None:
        """Add opposite-index items to the active tracker.

        Iterates the non-primary index's files (doc outlines in
        code mode, symbol files in doc mode) and creates
        tracker entries at ACTIVE with N=0. The next
        ``_update_stability`` cycle promotes them via the
        standard N-value machinery.

        Selected files are excluded — they carry content via
        ``file:`` entries and the cross-ref entry would be
        redundant. Missing blocks (outline not yet loaded,
        symbol index empty) are skipped silently.
        """
        from ac_dc.stability_tracker import Tier, TrackedItem

        tracker = self._stability_tracker
        selected_set = set(self._selected_files)
        affected_tiers: set[Tier] = set()

        if self._context.mode == Mode.CODE:
            # Code mode primary → add doc: entries as secondary.
            for path in list(self._doc_index._all_outlines.keys()):
                if path in selected_set:
                    continue
                block = self._doc_index.get_file_doc_block(path)
                if not block:
                    continue
                sig_hash = self._doc_index.get_signature_hash(path)
                key = f"doc:{path}"
                if key in tracker._items:
                    # Already tracked (from a prior enable that
                    # wasn't fully cleaned up, or from a mode
                    # switch edge case). Leave it alone.
                    continue
                tracker._items[key] = TrackedItem(
                    key=key,
                    tier=Tier.ACTIVE,
                    n_value=0,
                    content_hash=sig_hash or "",
                    tokens=self._counter.count(block),
                )
                affected_tiers.add(Tier.ACTIVE)
        else:
            # Doc mode primary → add symbol: entries as secondary.
            if self._symbol_index is None:
                return
            for path in list(self._symbol_index._all_symbols.keys()):
                if path in selected_set:
                    continue
                block = self._symbol_index.get_file_symbol_block(path)
                if not block:
                    continue
                sig_hash = self._symbol_index.get_signature_hash(path)
                key = f"symbol:{path}"
                if key in tracker._items:
                    continue
                tracker._items[key] = TrackedItem(
                    key=key,
                    tier=Tier.ACTIVE,
                    n_value=0,
                    content_hash=sig_hash or "",
                    tokens=self._counter.count(block),
                )
                affected_tiers.add(Tier.ACTIVE)

        # Mark affected tiers broken so the next cascade can
        # reconsider placement.
        for tier in affected_tiers:
            tracker._broken_tiers.add(tier)

    def _remove_cross_reference_items(self) -> None:
        """Strip opposite-index items from the active tracker.

        Called when cross-reference is disabled (explicitly or
        via mode switch reset). Walks the tracker and removes
        every entry whose prefix is the OPPOSITE of the current
        mode's primary — ``doc:*`` in code mode, ``symbol:*``
        in doc mode.

        Selected files' ``file:`` entries are always preserved
        regardless of mode — they're primary content, not
        cross-reference data. Same for ``system:``, ``url:``,
        and ``history:`` entries.

        Marks every tier that held removed items as broken so
        the next cascade rebalances cleanly (items may promote
        upward to fill gaps).
        """
        from ac_dc.stability_tracker import Tier

        tracker = self._stability_tracker
        if self._context.mode == Mode.CODE:
            target_prefix = "doc:"
        else:
            target_prefix = "symbol:"

        to_remove: list[str] = []
        affected_tiers: set[Tier] = set()
        all_items = tracker.get_all_items()
        for key, item in all_items.items():
            if key.startswith(target_prefix):
                to_remove.append(key)
                affected_tiers.add(item.tier)

        for key in to_remove:
            tracker._items.pop(key, None)

        for tier in affected_tiers:
            tracker._broken_tiers.add(tier)

    # ------------------------------------------------------------------
    # Public RPC — manual cache rebuild
    # ------------------------------------------------------------------

    def rebuild_cache(self) -> dict[str, Any]:
        """Wipe and redistribute all tier assignments from scratch.

        User-initiated via the cache viewer's Rebuild button.
        One-shot disruptive operation for cases where the normal
        N-value graduation flow would take many request cycles
        to reach a sensible distribution (e.g., just after
        selecting a large working set).

        Governing spec: specs-reference/3-llm/cache-tiering.md
        § Manual Cache Rebuild.

        Sequence (atomic from the RPC caller's perspective):

        1. Preserve ``history:*`` entries in the current tracker
        2. Wipe everything else (system/symbol/doc/file/url)
        3. Mark all tiers broken (so any follow-up _update_stability
           can freely rebalance — though we don't run one here)
        4. Load content for selected files into file context so
           real hashes and token counts can be computed
        5. Re-initialize from the reference graph (places every
           indexed file as a ``symbol:{path}`` or ``doc:{path}``
           entry across L0-L3 via clustering)
        6. Measure tokens to fill in real counts (replacing the
           placeholder tokens from init)
        7. Swap selected files: ``symbol:``/``doc:`` → ``file:``
           at the same tier they landed in (selected files get
           full-content entries in cached tiers, not ACTIVE)
        8. Distribute orphan selected files (those not in the
           primary index — ``.md``, ``.json``, images, etc.)
           across L1/L2/L3 via bin-packing. Without this step,
           orphans would default to ACTIVE and defeat the
           purpose of rebuild
        9. Re-seed ``system:prompt`` into L0
        10. Re-seed cross-reference items if cross-ref mode is
            active (matches the set_cross_reference(True) flow)
        11. Graduate history via piggyback: newest messages
            totalling up to ``cache_target_tokens`` stay in
            ACTIVE (verbatim window); older messages graduate
            to L3 with that tier's entry_n
        12. Mark trackers as initialized so subsequent chat
            requests skip the lazy-init path

        Notably does NOT call ``_update_stability()``. The
        deterministic placement IS the final state. A follow-up
        cascade would demote underfilled tiers, undoing the
        careful placement. The next real chat request runs
        ``_update_stability()`` normally and tiers behave like
        any other post-init state.

        Returns a status dict with per-tier counts and a
        human-readable summary. On failure returns ``{error: ...}``
        with no side effects beyond whatever partial state the
        failure left (the next chat request's _update_stability
        will repair it).

        Localhost-only. Remote collaborators get the restricted
        error shape — the rebuild affects shared LLM cache state
        for the whole session.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted

        if self._symbol_index is None or self._repo is None:
            return {
                "error": (
                    "Cache rebuild requires a repository and "
                    "symbol index"
                )
            }

        try:
            return self._rebuild_cache_impl()
        except Exception as exc:
            logger.exception("Cache rebuild failed: %s", exc)
            return {"error": f"Cache rebuild failed: {exc}"}

    def _rebuild_cache_impl(self) -> dict[str, Any]:
        """The actual rebuild pipeline — see rebuild_cache docstring."""
        from ac_dc.stability_tracker import Tier, TrackedItem

        assert self._symbol_index is not None
        assert self._repo is not None

        tracker = self._stability_tracker
        mode = self._context.mode

        items_before = len(tracker.get_all_items())

        # Step 1-2: preserve history, wipe everything else.
        # We snapshot the history items and reinstate them after
        # init. Everything else (system, symbol, doc, file, url)
        # gets cleared.
        history_items = {
            key: item
            for key, item in tracker.get_all_items().items()
            if key.startswith("history:")
        }
        tracker._items.clear()
        # Re-install history items at their previous tier/N so
        # they carry through the rebuild unchanged.
        for key, item in history_items.items():
            tracker._items[key] = item

        # Step 3: mark all tiers broken. Defensive — ensures any
        # follow-up pass can freely rebalance. We don't run an
        # update ourselves, so this mostly matters if something
        # upstream inspects broken_tiers between rebuild and the
        # next chat.
        tracker._broken_tiers = {
            Tier.L0, Tier.L1, Tier.L2, Tier.L3, Tier.ACTIVE,
        }
        tracker._changes = []

        # Step 4: load content for all selected files into
        # the file context. Without this, the file: entries we
        # construct later would have no content to hash or
        # count tokens against.
        for path in self._selected_files:
            if not self._file_context.has_file(path):
                try:
                    self._file_context.add_file(path)
                except Exception as exc:
                    # Non-fatal — a file might fail to load
                    # (binary, permissions). It just won't get a
                    # file: entry; it may still become a symbol:
                    # or orphan entry below.
                    logger.debug(
                        "Could not load %s during rebuild: %s",
                        path, exc,
                    )

        # Step 5: re-initialize from the reference graph. This
        # places every indexed file as a symbol: (code mode) or
        # doc: (doc mode) entry distributed across L0-L3 via
        # clustering. Keys use the mode-appropriate prefix.
        #
        # Filter the full repo file list to only files the
        # active mode's index recognized. In code mode, that's
        # the symbol index's _all_symbols. In doc mode, it will
        # be the doc index's recognized files once Layer 2's
        # doc-index sub-layer lands; for now doc mode produces
        # an empty init list (no spurious doc: entries for .py,
        # .js, etc.) and subsequent init + cascade leave the
        # tracker empty until the doc index arrives.
        ref_index = self._symbol_index._ref_index
        file_list_raw = self._repo.get_flat_file_list()
        file_list = [f for f in file_list_raw.split("\n") if f]
        cache_target = self._config.cache_target_tokens_for_model()
        tracker.set_cache_target_tokens(cache_target)

        if mode == Mode.DOC:
            prefix = "doc:"
            # Doc index populated by the background build
            # (2.8.2b). Rebuild iterates the outlines dict
            # directly rather than filtering the repo file
            # list, because the doc index may include files
            # that aren't in the repo's flat listing (e.g.,
            # when the repo walker and doc index walker
            # disagree on a hidden directory edge case).
            # Using _all_outlines as the authoritative source
            # matches how code mode uses _all_symbols.
            indexed_files: list[str] = list(
                self._doc_index._all_outlines.keys()
            )
        else:
            prefix = "symbol:"
            indexed_files = [
                path for path in file_list
                if path in self._symbol_index._all_symbols
            ]
        keys = [f"{prefix}{path}" for path in indexed_files]
        tracker.initialize_with_keys(
            ref_index,
            keys=keys,
            files=indexed_files,
            l0_target_tokens=cache_target,
        )

        # Step 5b: if cross-reference is enabled, also place
        # items from the OPPOSITE index so the cache holds
        # both structural views spread across L1-L3. Without
        # this, rebuild wipes everything in step 1-2 and then
        # only re-seeds the primary — losing the cross-ref
        # items the user just enabled.
        #
        # Pass l0_target_tokens=0 so the secondary doesn't
        # compete with the primary for L0 slots. L0 is earned
        # by the primary mode's most-connected files;
        # cross-ref enhances L1-L3 but shouldn't dilute L0.
        # Secondary items distribute across L1/L2/L3 via the
        # same clustering algorithm as the primary.
        if self._cross_ref_enabled:
            if mode == Mode.DOC:
                # Doc mode primary + cross-ref → also place
                # symbol: entries.
                secondary_prefix = "symbol:"
                secondary_files = [
                    p for p in file_list
                    if p in self._symbol_index._all_symbols
                ]
                secondary_ref = self._symbol_index._ref_index
            else:
                # Code mode primary + cross-ref → also place
                # doc: entries.
                secondary_prefix = "doc:"
                secondary_files = list(
                    self._doc_index._all_outlines.keys()
                )
                secondary_ref = self._doc_index._ref_index
            secondary_keys = [
                f"{secondary_prefix}{p}" for p in secondary_files
            ]
            if secondary_keys:
                tracker.initialize_with_keys(
                    secondary_ref,
                    keys=secondary_keys,
                    files=secondary_files,
                    l0_target_tokens=0,
                )

        # Step 6: measure real token counts for the just-placed
        # index entries. _measure_tracker_tokens already handles
        # the prefix dispatch (doc: vs symbol:) correctly — it
        # iterates all items and skips mismatched prefixes.
        self._measure_tracker_tokens()

        # Step 7: swap selected files — for each selected file
        # that landed as a symbol: or doc: entry, replace it
        # with a file: entry at the same tier and with the same
        # N value. This enforces the "never appears twice"
        # invariant — selected files get full-content file:
        # entries in cached tiers rather than both symbol: and
        # as full content in ACTIVE.
        #
        # Cross-reference awareness: when step 5b seeded the
        # opposite-prefix entry for a selected file (e.g., a
        # file present in both symbol and doc indexes while
        # cross-ref is enabled), that secondary entry must
        # also be removed. Without this, the tracker holds
        # both file:{path} AND the secondary-prefix entry,
        # and _build_tiered_content would render both the full
        # file content AND the cross-reference index block —
        # violating the uniqueness invariant.
        if prefix == "symbol:":
            secondary_prefix = "doc:"
        else:
            secondary_prefix = "symbol:"
        selected_set = set(self._selected_files)
        swapped_paths: set[str] = set()
        for path in list(selected_set):
            index_key = f"{prefix}{path}"
            existing = tracker._items.get(index_key)
            if existing is None:
                continue
            # Compute file-entry hash and tokens from the loaded
            # content. Fall back to the symbol entry's data if
            # the file couldn't be loaded in step 4.
            content = self._file_context.get_content(path)
            if content is None:
                continue
            import hashlib
            file_hash = hashlib.sha256(
                content.encode("utf-8")
            ).hexdigest()
            file_tokens = self._counter.count(content)
            # Remove the index entry and install a file: entry
            # at the same tier with the same N. Anchoring state
            # is transient per-cascade and doesn't need
            # preservation.
            tracker._items.pop(index_key, None)
            # Also remove any cross-reference entry for the
            # same path. Mark its tier broken so the next
            # cascade (on the first real chat request) can
            # rebalance — rebuild itself doesn't run a cascade.
            secondary_key = f"{secondary_prefix}{path}"
            secondary_existing = tracker._items.pop(secondary_key, None)
            if secondary_existing is not None:
                tracker._broken_tiers.add(secondary_existing.tier)
            tracker._items[f"file:{path}"] = TrackedItem(
                key=f"file:{path}",
                tier=existing.tier,
                n_value=existing.n_value,
                content_hash=file_hash,
                tokens=file_tokens,
            )
            swapped_paths.add(path)

        # Step 8: distribute orphan selected files. These are
        # selected files that aren't in the primary index
        # (non-source files — .md, .json, images, config). They
        # didn't land as symbol: entries in step 5 and weren't
        # swapped in step 7. Without this step they'd default to
        # ACTIVE on the next _update_stability pass, which
        # defeats the purpose of rebuild.
        orphan_paths = [
            path for path in self._selected_files
            if path not in swapped_paths
            and self._file_context.has_file(path)
        ]
        if orphan_paths:
            self._distribute_orphan_files(orphan_paths)

        # Step 9: re-seed system prompt into L0. Matches the
        # _try_initialize_stability flow.
        import hashlib as _hashlib
        if mode == Mode.DOC:
            system_prompt = self._config.get_doc_system_prompt()
        else:
            system_prompt = self._config.get_system_prompt()
        if system_prompt:
            legend = self._symbol_index.get_legend()
            prompt_hash = _hashlib.sha256(
                system_prompt.encode("utf-8")
            ).hexdigest()
            prompt_tokens = self._counter.count(system_prompt + legend)
            tracker.register_system_prompt(prompt_hash, prompt_tokens)

        # Step 10: re-seed cross-reference items if active.
        # The doc index hasn't landed yet so this is currently
        # a no-op (matches the comment in set_cross_reference),
        # but we preserve the flag so when doc index lands, a
        # rebuild while cross-ref is on does the right thing.
        # (No explicit action needed today.)

        # Step 11: graduate history via piggyback. Specs3 says
        # rebuild is a disruptive event equivalent to "L3 is
        # already being rebuilt this cycle", which unlocks the
        # piggyback path. The newest messages totalling up to
        # cache_target_tokens stay in ACTIVE as the verbatim
        # window; everything older graduates to L3.
        self._rebuild_graduate_history(cache_target)

        # Step 12: mark initialized for the current mode so
        # subsequent chat requests skip the lazy-init path.
        # Per-mode flag — rebuild in code mode doesn't mark doc
        # mode as initialized (and vice versa), so a subsequent
        # switch into the other mode runs its own init pass.
        self._stability_initialized[mode] = True

        # Assemble the result dict.
        items_after = len(tracker.get_all_items())
        all_items = tracker.get_all_items()
        tier_counts: dict[str, int] = {
            t.value: 0 for t in (Tier.L0, Tier.L1, Tier.L2, Tier.L3, Tier.ACTIVE)
        }
        file_tier_counts: dict[str, int] = {
            t.value: 0 for t in (Tier.L0, Tier.L1, Tier.L2, Tier.L3, Tier.ACTIVE)
        }
        for item in all_items.values():
            tier_counts[item.tier.value] += 1
            if item.key.startswith("file:"):
                file_tier_counts[item.tier.value] += 1

        files_distributed = sum(file_tier_counts.values())

        # Short summary string for the toast.
        tier_summary = " ".join(
            f"{name}={count}"
            for name, count in tier_counts.items()
            if count > 0
        )
        message = (
            f"Cache rebuild ({mode.value}): "
            f"{items_before} → {items_after} items | {tier_summary}"
        )

        logger.info(message)

        return {
            "status": "rebuilt",
            "mode": mode.value,
            "items_before": items_before,
            "items_after": items_after,
            "files_distributed": files_distributed,
            "tier_counts": tier_counts,
            "file_tier_counts": file_tier_counts,
            "message": message,
        }

    def _distribute_orphan_files(
        self, orphan_paths: list[str]
    ) -> None:
        """Bin-pack orphan selected files across L1/L2/L3.

        Called by rebuild for files that are selected but aren't
        in the primary index (non-source files — ``.md``,
        ``.json``, images, etc.). Without this they'd land in
        ACTIVE on the next update pass.

        Uses a simple greedy bin-pack by current tier token
        count: each orphan is placed in whichever of L1/L2/L3
        currently holds the fewest tokens. Produces a balanced
        distribution without needing a global clustering pass.

        L0 is excluded as a target — L0 must be earned via
        promotion or explicit seeding (the system prompt and
        high-connectivity index entries). Dropping orphans into
        L0 would dilute the most-stable tier.
        """
        from ac_dc.stability_tracker import Tier, TrackedItem
        import hashlib

        tracker = self._stability_tracker
        target_tiers = (Tier.L1, Tier.L2, Tier.L3)

        # Initial tier token counts from currently-placed items.
        tier_tokens: dict[Tier, int] = {t: 0 for t in target_tiers}
        for item in tracker.get_all_items().values():
            if item.tier in tier_tokens:
                tier_tokens[item.tier] += item.tokens

        # Sort orphans by token size descending so the larger
        # files get placed first — improves bin-pack balance.
        orphans_with_tokens: list[tuple[str, int, str]] = []
        for path in orphan_paths:
            content = self._file_context.get_content(path)
            if content is None:
                continue
            tokens = self._counter.count(content)
            file_hash = hashlib.sha256(
                content.encode("utf-8")
            ).hexdigest()
            orphans_with_tokens.append((path, tokens, file_hash))
        orphans_with_tokens.sort(key=lambda x: (-x[1], x[0]))

        for path, tokens, file_hash in orphans_with_tokens:
            # Pick the tier with the smallest current token
            # count. Ties broken by tier value ordering (L1 < L2
            # < L3 lexicographically) for determinism.
            target_tier = min(
                target_tiers,
                key=lambda t: (tier_tokens[t], t.value),
            )
            entry_n = _TIER_CONFIG_LOOKUP[target_tier]["entry_n"]
            tracker._items[f"file:{path}"] = TrackedItem(
                key=f"file:{path}",
                tier=target_tier,
                n_value=entry_n,
                content_hash=file_hash,
                tokens=tokens,
            )
            tier_tokens[target_tier] += tokens

    def _rebuild_graduate_history(
        self, cache_target_tokens: int
    ) -> None:
        """Graduate older history to L3, keeping a verbatim window.

        Called by rebuild as step 11. Walks history messages
        newest → oldest, accumulating tokens until the next
        message would exceed ``cache_target_tokens``. Everything
        newer stays in ACTIVE as the verbatim window; everything
        older graduates to L3 with that tier's entry_n.

        No-op when ``cache_target_tokens == 0`` (history stays
        in ACTIVE permanently per the cache-target=0 contract).
        """
        from ac_dc.stability_tracker import Tier

        if cache_target_tokens <= 0:
            return

        tracker = self._stability_tracker
        history_len = len(self._context.get_history())
        if history_len == 0:
            return

        # Walk newest → oldest, accumulating tokens. The first
        # message whose inclusion would exceed cache_target
        # becomes the graduation boundary — everything from it
        # backward (older) graduates to L3, everything forward
        # (newer) stays in ACTIVE.
        accumulated = 0
        verbatim_start = 0  # inclusive index of first verbatim msg
        for idx in range(history_len - 1, -1, -1):
            key = f"history:{idx}"
            item = tracker._items.get(key)
            if item is None:
                continue
            if accumulated + item.tokens > cache_target_tokens:
                # Adding this message would overflow the verbatim
                # window; it becomes the first to graduate.
                verbatim_start = idx + 1
                break
            accumulated += item.tokens
        else:
            # Loop completed without breaking — all messages fit
            # in the verbatim window. Nothing graduates.
            return

        # Graduate everything before verbatim_start to L3.
        l3_entry_n = _TIER_CONFIG_LOOKUP[Tier.L3]["entry_n"]
        for idx in range(verbatim_start):
            key = f"history:{idx}"
            item = tracker._items.get(key)
            if item is None:
                continue
            item.tier = Tier.L3
            item.n_value = l3_entry_n


    # ------------------------------------------------------------------
    # Public RPC — session management
    # ------------------------------------------------------------------

    def new_session(self) -> dict[str, Any]:
        """Start a fresh session — clear history, purge tracker."""
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted
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

    def _is_child_request(self, request_id: str) -> bool:
        """Return True when ``request_id`` is a child of the active parent.

        Per specs4/7-future/parallel-agents.md § Transport, agent
        streams spawned under a user-initiated turn carry request
        IDs of the form ``{parent_id}-agent-N`` — the parent's ID
        as a prefix followed by a dash and a child suffix. This
        helper is the single place the child-vs-user
        classification happens; the single-stream guard uses it
        to let child streams through.

        Returns False when no user-initiated stream is active
        (nothing to be a child of). Returns False when the
        request ID is the parent ID itself — a reconnect or
        duplicate that matches the parent exactly is treated as
        a conflicting user-initiated request, not a child.

        Today no code path produces child request IDs, so this
        method always returns False in practice. Landing it now
        keeps the guard's shape correct for when agent spawning
        arrives; the guard is a single-line diff instead of a
        gate rewrite.
        """
        parent = self._active_user_request
        if parent is None:
            return False
        if request_id == parent:
            return False
        return request_id.startswith(parent + "-")

    async def chat_streaming(
        self,
        request_id: str,
        message: str,
        files: list[str] | None = None,
        images: list[str] | None = None,
        excluded_urls: list[str] | None = None,
    ) -> dict[str, Any]:
        """Start a streaming chat request.

        Returns synchronously with ``{"status": "started"}``. The
        actual streaming runs as a background task; chunks and the
        completion arrive via the event callback.

        Rejects if the service isn't fully initialised, or if
        another user-initiated stream is active.

        ``excluded_urls`` carries the set of fetched URLs the user
        has unchecked in the chip UI. These URLs stay in the URL
        service's session-scoped ``_fetched`` dict (so the chip
        remains visible and can be re-included on a later turn)
        but are omitted from this turn's injected URL context.
        See specs4/4-features/url-content.md § URL Chips UI.
        """
        # Capture event loop on the RPC thread — this is the
        # event-loop thread. D10 contract: the capture happens
        # HERE, not inside the background task.
        self._main_loop = asyncio.get_event_loop()

        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted

        if not self._init_complete:
            return {
                "error": (
                    "Server is still initializing — please wait "
                    "a moment"
                )
            }
        # User-initiated single-stream guard. Per
        # specs4/7-future/parallel-agents.md § Foundation
        # Requirements ("Single-stream guard gates user-
        # initiated requests only"), the guard blocks a second
        # USER-initiated stream but must allow internal streams
        # that share an active parent's request ID prefix.
        # Today no code path produces child request IDs, so the
        # ``_is_child_request`` branch never fires; when agent
        # spawning lands, each agent's request ID will be
        # ``{parent_id}-agent-N`` and pass this gate naturally.
        if (
            self._active_user_request is not None
            and not self._is_child_request(request_id)
        ):
            return {
                "error": (
                    f"Another stream is active (request "
                    f"{self._active_user_request})"
                )
            }

        # Register the active request. Cleared in the background
        # task's finally block. Only user-initiated requests
        # register here — child requests share their parent's
        # slot and don't overwrite it. A future agent-spawning
        # path will track child streams in a separate
        # per-request accumulator; this slot stays the
        # authoritative "is a user-initiated stream active?"
        # signal for the guard itself.
        if not self._is_child_request(request_id):
            self._active_user_request = request_id

        # Launch the background task. ensure_future rather than
        # await so we return {"status": "started"} immediately.
        asyncio.ensure_future(
            self._stream_chat(
                request_id,
                message,
                files or [],
                images or [],
                excluded_urls or [],
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
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted
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
        excluded_urls: list[str] | None = None,
    ) -> None:
        """Background task — the actual streaming logic.

        ``excluded_urls`` is the per-turn exclusion list passed
        in from :meth:`chat_streaming`. Threaded through to
        :meth:`_detect_and_fetch_urls` so
        :meth:`URLService.format_url_context` can omit them from
        the prompt's URL section while leaving the chip state
        untouched.
        """
        error: str | None = None
        full_content = ""
        cancelled = False
        finish_reason: str | None = None
        # Matches the empty_usage shape in _run_completion_sync
        # so the frontend sees a stable set of keys regardless
        # of which code path populated the dict. cost_usd
        # defaults to None so early-exit errors don't misreport
        # as "free".
        request_usage: dict[str, Any] = {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "reasoning_tokens": 0,
            "cache_read_tokens": 0,
            "cache_write_tokens": 0,
            "prompt_cached_tokens": 0,
            "cost_usd": None,
        }
        try:
            # File context sync — remove deselected files, load
            # selected ones. Defensive: skip files that don't exist
            # or that the repo can't read.
            self._sync_file_context()

            # Re-index on every chat request so deletions
            # propagate. Per specs4/2-indexing/document-index.md
            # § Triggers and specs4/2-indexing/symbol-index.md
            # § Indexing Pipeline, the full repo walk must run
            # each turn so _prune_stale drops entries for files
            # that no longer exist on disk (git rm, user delete,
            # branch switch). The mtime cache makes unchanged
            # files free — the real cost is just the prune walk.
            # Without this, _all_outlines / _all_symbols grows
            # only and map rendering includes stale entries,
            # wasting tokens and misleading the LLM about the
            # current repo shape.
            if self._repo is not None:
                try:
                    file_list_raw = self._repo.get_flat_file_list()
                    file_list = [
                        f for f in file_list_raw.split("\n") if f
                    ]
                    if self._symbol_index is not None:
                        self._symbol_index.index_repo(file_list)
                    if self._doc_index_ready:
                        doc_files = [
                            f for f in file_list
                            if self._doc_index._extension_of(f)
                            in self._doc_index._extractors
                        ]
                        self._doc_index.index_repo(doc_files)
                except Exception as exc:
                    # Non-fatal — indexing failure shouldn't
                    # block the chat. Stale entries remain but
                    # the request proceeds with whatever state
                    # the indexes were in.
                    logger.warning(
                        "Per-request re-index failed: %s",
                        exc,
                    )

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

            # URL detection and fetching. Detects URLs in the user
            # prompt, skips already-fetched ones (session-level
            # memoisation in the URL service), fetches new ones
            # via the injected cache + fetchers + summarizer,
            # and injects formatted content into the context
            # manager's URL context section.
            #
            # The per-message cap of 3 URLs is pinned by specs4 —
            # prevents a URL-heavy message from blowing out the
            # prompt budget or hammering upstream. Fetches run
            # sequentially via the aux executor so the event loop
            # stays free for WebSocket I/O during the fetch.
            #
            # ``excluded_urls`` is the chip-level exclusion set
            # the user unchecked in the UI before send. The URL
            # service's format_url_context honours it when
            # building the prompt section; the URLs stay in the
            # session-scoped fetched dict so chips remain visible
            # and the user can re-include on a later turn.
            await self._detect_and_fetch_urls(
                request_id, message, excluded_urls or []
            )

            # Review context injection. When review mode is
            # active, build a block with the review summary,
            # commit log, pre-change symbol map, and reverse
            # diffs for selected files, and attach it via the
            # context manager. Re-built on every request so the
            # reverse-diff set reflects the CURRENT file
            # selection (user may have added or removed files
            # since the last turn). See
            # specs4/4-features/code-review.md.
            if self._review_active:
                self._build_and_set_review_context()
            else:
                # Defensive: ensure review context is cleared
                # when review mode isn't active. Normally
                # end_review clears it, but this guard protects
                # against a crashed exit that left stale
                # context on the manager.
                self._context.clear_review_context()

            # Lazy stability initialization — if eager init
            # during startup (or mode-switch init) failed, try
            # again on the first chat request. The per-mode
            # flag prevents re-runs once the current mode's
            # tracker is populated.
            if not self._stability_initialized.get(
                self._context.mode, False
            ):
                self._try_initialize_stability()

            # Assemble the message array. Tiered assembly is the
            # primary path — it returns None only when the
            # stability tracker hasn't been initialised yet
            # (narrow startup window). Fall back to flat in that
            # case so early requests still work.
            tiered_content = self._build_tiered_content()
            if tiered_content is None:
                # Diagnose why we're falling back. A persistent
                # fall-back-to-flat condition usually means the
                # symbol index never attached or stability init
                # silently failed — neither is visible to the
                # user otherwise.
                mode = self._context.mode
                initialised = self._stability_initialized.get(
                    mode, False
                )
                tracker_items = len(
                    self._stability_tracker.get_all_items()
                )
                logger.warning(
                    "Using flat assembly (tracker empty). "
                    "mode=%s init_flag=%s tracker_items=%d "
                    "symbol_index=%s doc_index_ready=%s "
                    "init_complete=%s",
                    mode.value,
                    initialised,
                    tracker_items,
                    self._symbol_index is not None,
                    self._doc_index_ready,
                    self._init_complete,
                )
                messages = self._assemble_messages_flat(
                    message, images
                )
            else:
                messages = self._assemble_tiered(
                    message, images, tiered_content
                )

            # Run the LLM call in the stream executor.
            assert self._main_loop is not None
            loop = self._main_loop
            (
                full_content,
                cancelled,
                finish_reason,
                request_usage,
            ) = await loop.run_in_executor(
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

        # Build the completion result. Edit parsing and apply
        # happen only when the stream completed normally — errors
        # and cancellations skip the apply step so partial
        # assistant output doesn't silently touch the filesystem.
        # Review mode is read-only (specs4/4-features/code-review.md);
        # we parse for UI display but skip application.
        #
        # finish_reason is set when the stream completed (even if
        # cancelled mid-way — the provider may have reported a
        # reason on the last chunk before our cancel took
        # effect). Left None when the try-block raised before
        # _run_completion_sync returned.
        result = await self._build_completion_result(
            full_content=full_content,
            user_message=message,
            cancelled=cancelled,
            error=error,
            finish_reason=finish_reason if error is None else None,
            request_usage=request_usage,
        )

        # Fire completion event.
        await self._broadcast_event_async(
            "streamComplete", request_id, result
        )

        # Broadcast filesChanged if the apply step auto-added
        # files (not-in-context edits) or created new ones.
        # Clients update their file picker to reflect the new
        # selection so the user sees which files were added —
        # for retry on the next request (auto-added) or for
        # iteration (newly created).
        if (
            result.get("files_auto_added")
            or result.get("files_created")
        ):
            self._broadcast_event(
                "filesChanged", list(self._selected_files)
            )

        # Broadcast filesModified whenever apply wrote to disk,
        # regardless of whether any auto-add happened. Without
        # this, newly-created files (e.g., an LLM-authored
        # architecture diagram) land in the working tree but
        # the picker never reloads its tree — it has no signal
        # that disk state changed. specs4/5-webapp/file-picker.md
        # § "Files Tab Orchestration" pins this as the refresh
        # trigger: the files tab listens for files-modified and
        # re-fetches the tree via Repo.get_file_tree, which
        # picks up untracked files and refreshed git-status
        # badges.
        #
        # Fires for modify, create, and delete alike — the
        # file tree RPC does the status parsing, so the
        # browser just needs to know "reload now".
        modified_paths = result.get("files_modified") or []
        if modified_paths:
            self._broadcast_event(
                "filesModified", list(modified_paths)
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

    async def _detect_and_fetch_urls(
        self,
        request_id: str,
        message: str,
        excluded_urls: list[str] | None = None,
    ) -> None:
        """Detect URLs in the user message and fetch new ones.

        Runs before prompt assembly so fetched URL content lands
        in the context manager's URL section by the time the
        message array is built. Sequential per-URL — the spec's
        per-message cap (3 URLs) keeps this bounded at a few
        hundred milliseconds in the worst case.

        ``excluded_urls`` is the user's chip-level exclusion set
        for this turn. Passed through to
        :meth:`URLService.format_url_context` so unchecked URLs
        stay out of the LLM's prompt. The URLs themselves remain
        in the service's session-scoped fetched dict — the chip
        UI still shows them and the user can re-include on the
        next turn by checking the box.

        Progress events fire for each URL that actually gets
        fetched (not for cache-hit / already-fetched skips):

        - ``compactionEvent(request_id, {stage: "url_fetch",
          url: display_name})`` before fetching.
        - ``compactionEvent(request_id, {stage: "url_ready",
          url: display_name})`` after successful fetch.

        The frontend renders these as transient toast
        notifications so the user sees what's being fetched.

        After all URLs are processed (successfully or with
        errors), the URL service's formatted context is attached
        to the context manager via ``set_url_context``. Error
        records are skipped by ``format_url_context``, so failed
        fetches don't pollute the LLM's view — they appear in
        the URL chip UI with an error state instead.
        """
        from ac_dc.url_service import detect_urls as _detect_urls
        from ac_dc.url_service import display_name as _display_name

        urls = _detect_urls(message)

        # Cap per-message. Extra URLs are silently skipped — the
        # UI chip rendering covers them via the detected-chips
        # path, which is independent of the streaming fetch.
        urls = urls[:_URL_PER_MESSAGE_LIMIT]

        # Fetch loop only runs when the current message contains
        # URLs. But the format-and-attach step at the end runs
        # every turn regardless — URLs fetched via the frontend
        # chip's Fetch button (a separate RPC path that doesn't
        # go through _stream_chat) need to be surfaced to the
        # LLM on the next turn even if the user's follow-up
        # message has no URL text in it. Without this, chip-
        # fetched content silently stays in _url_service._fetched
        # without ever reaching the prompt — the Budget UI
        # shows the URL's tokens (because it reads from _fetched
        # directly) but the LLM never sees the content.
        assert self._main_loop is not None
        loop = self._main_loop

        for url in urls:
            # Skip already-fetched URLs (session-level memoisation).
            # The URL service's fetch_url would short-circuit on
            # cache hit anyway, but by checking here we also
            # suppress the progress-event notifications.
            existing = self._url_service.get_url_content(url)
            if existing.error != "URL not yet fetched":
                continue

            name = _display_name(url)

            # Fire fetch-start event.
            await self._broadcast_event_async(
                "compactionEvent",
                request_id,
                {"stage": "url_fetch", "url": name},
            )

            # Blocking fetch runs in the aux executor so the event
            # loop stays responsive. The URL service's fetch_url
            # is synchronous by design; we wrap it here.
            try:
                await loop.run_in_executor(
                    self._aux_executor,
                    self._fetch_url_sync,
                    url,
                )
            except Exception as exc:
                logger.warning(
                    "URL fetch raised for %s: %s", url, exc
                )
                # The URL service catches most errors and returns
                # error records; this branch is a belt-and-braces
                # for something truly unexpected. No notification
                # fires — the URL just ends up unfetched for this
                # request.
                continue

            # Fire fetch-ready event.
            await self._broadcast_event_async(
                "compactionEvent",
                request_id,
                {"stage": "url_ready", "url": name},
            )

        # Attach the formatted URL context to the context manager.
        # Runs every turn (not gated on `urls` being non-empty)
        # so chip-fetched URLs and URLs carried over from prior
        # turns continue to appear in the prompt. format_url_context
        # with no args uses all fetched URLs and skips error
        # records; the ``excluded`` set drops URLs the user
        # unchecked in the chip UI for this turn. A blank result
        # clears the URL section cleanly.
        excluded_set = (
            set(excluded_urls) if excluded_urls else None
        )
        url_context = self._url_service.format_url_context(
            excluded=excluded_set
        )
        if url_context:
            self._context.set_url_context([url_context])
        else:
            self._context.clear_url_context()

    def _fetch_url_sync(self, url: str) -> None:
        """Blocking fetch — called from the aux executor.

        Split out as a named method so ``run_in_executor`` has
        something to call without constructing a lambda (which
        would close over ``self`` and ``url`` silently — the
        named method makes the argument binding explicit).

        Uses ``summarize=True`` so the smaller model produces a
        summary alongside the raw content. The user's prompt is
        passed as ``user_text`` so the summary-type selector can
        pick an appropriate angle (e.g., "how to use this" →
        USAGE summary).
        """
        self._url_service.fetch_url(
            url,
            use_cache=True,
            summarize=True,
            user_text=None,  # per-URL summary doesn't get full prompt
        )

    async def _build_completion_result(
        self,
        full_content: str,
        user_message: str,
        cancelled: bool,
        error: str | None,
        finish_reason: str | None = None,
        request_usage: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Parse the response, apply edits, build the result dict.

        The result shape matches what the frontend expects in
        ``streamComplete.result``. Edit parsing happens even for
        cancelled streams (so partial assistant output renders
        pending cards for the user), but apply is gated on
        ``error is None and not cancelled and not _review_active``.

        ``finish_reason`` is the provider's stop reason from the
        stream's final chunk. Passed through to the frontend so
        it can badge truncated responses (``length``) distinctly
        from natural stops. None when the stream raised before
        completion or when the provider didn't report one.

        Order of operations:

        1. Parse the full response via :func:`parse_text` —
           produces completed blocks, incomplete blocks, and
           shell commands.
        2. If apply is gated off, return a result with the parsed
           blocks and zero counts.
        3. Otherwise, run the pipeline against the current
           selected-files set. Auto-added files are appended to
           ``_selected_files`` so the next request's file sync
           includes them.
        4. Populate aggregate counts and files_* lists from the
           pipeline's :class:`ApplyReport`.
        """
        # Parse the response. We do this even for cancelled /
        # error streams — the frontend renders incomplete blocks
        # as pending cards, and shell-command detection on a
        # partial response is still useful.
        parse_result = parse_text(full_content)

        # Convert parsed blocks into the frontend's "edit_blocks"
        # shape — file path plus is_create flag. Full old/new
        # text lives on the per-block result, not this summary.
        edit_blocks_summary = [
            {
                "file": b.file_path,
                "is_create": b.is_create,
            }
            for b in parse_result.blocks
        ]

        # Default result — apply step skipped.
        # token_usage carries per-request counts from the
        # provider. The frontend's TokenHUD reads this for its
        # "This Request" section. Falls through to a zero-valued
        # dict when the caller didn't supply usage (error/early-
        # exit paths) — renders as all-zero rather than undefined
        # so the HUD shape stays stable. ``cost_usd`` defaults to
        # None (not 0.0) so "unknown cost" is distinct from
        # "free request".
        usage_dict = dict(request_usage) if request_usage else {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "reasoning_tokens": 0,
            "cache_read_tokens": 0,
            "cache_write_tokens": 0,
            "prompt_cached_tokens": 0,
            "cost_usd": None,
        }
        result: dict[str, Any] = {
            "response": full_content,
            "token_usage": usage_dict,
            "edit_blocks": edit_blocks_summary,
            "shell_commands": parse_result.shell_commands,
            "passed": 0,
            "already_applied": 0,
            "failed": 0,
            "skipped": 0,
            "not_in_context": 0,
            "files_modified": [],
            "edit_results": [],
            "files_auto_added": [],
            "files_created": [],
            "user_message": user_message,
            "finish_reason": finish_reason,
        }
        if cancelled:
            result["cancelled"] = True
        if error is not None:
            result["error"] = error
            # Attach the structured error dict from the worker
            # thread's side channel, if populated. Consumed and
            # cleared so a subsequent request doesn't inherit
            # stale classification. Absent when the exception
            # path didn't run through _run_completion_sync
            # (e.g., the try block raised earlier during
            # _sync_file_context or _build_tiered_content) —
            # in those cases the frontend sees `error` without
            # `error_info` and falls back to the generic toast.
            error_info = getattr(self, "_last_error_info", None)
            if error_info is not None:
                result["error_info"] = error_info
                self._last_error_info = None

        # Gate the apply step. Three conditions must hold:
        # - No error occurred during streaming
        # - Stream wasn't cancelled mid-way
        # - Review mode isn't active (read-only contract)
        # - We have a pipeline (repo was attached)
        # - There are blocks to apply
        if (
            error is not None
            or cancelled
            or self._review_active
            or self._edit_pipeline is None
            or not parse_result.blocks
        ):
            return result

        # Apply the blocks. The pipeline expects a set of
        # currently-selected files so it can mark not-in-context
        # edits. We pass a copy — the pipeline doesn't mutate
        # its input, but the defensive copy means a concurrent
        # mutation of _selected_files can't affect apply
        # results mid-loop.
        in_context = set(self._selected_files)
        try:
            report = await self._edit_pipeline.apply_edits(
                parse_result.blocks,
                in_context_files=in_context,
            )
        except Exception as exc:
            # Defensive — the pipeline itself shouldn't raise
            # (per-block errors are captured in results), but
            # if it does we surface it as a stream error rather
            # than crashing the post-response flow.
            logger.exception("Edit pipeline raised: %s", exc)
            result["error"] = (
                f"Edit application failed: {exc}"
            )
            return result

        # Auto-add files to the selection so the next request
        # has them in context. Two sources:
        #
        # - files_auto_added — modifies where the LLM guessed
        #   at old-text from the index block; user will retry
        #   (auto-populated retry prompt on the frontend).
        # - files_created — brand-new files the LLM just wrote;
        #   no retry needed, but the user expects them to
        #   appear in the selection so they can iterate.
        #
        # The frontend receives the union via the filesChanged
        # broadcast (fired by the caller after streamComplete).
        # Only files_auto_added drives the retry-prompt; that
        # gating happens on the frontend, which reads the two
        # lists separately from the result payload.
        paths_to_add = list(report.files_auto_added) + [
            p for p in report.files_created
            if p not in report.files_auto_added
        ]
        if paths_to_add:
            added: list[str] = []
            for path in paths_to_add:
                if path not in self._selected_files:
                    self._selected_files.append(path)
                    added.append(path)
            # Load the newly-selected files into the file
            # context so the next request's assembly has their
            # content. Silently skip files that fail to load
            # (binary, missing) — matches the file_sync
            # policy.
            for path in added:
                try:
                    self._file_context.add_file(path)
                except Exception as exc:
                    logger.debug(
                        "Auto-added file %s could not be "
                        "loaded: %s",
                        path, exc,
                    )

        # Refresh file-context content for EVERY modified file,
        # not just auto-added ones. Without this, files that
        # were already in context keep their pre-edit snapshot
        # indefinitely — the pipeline writes the new content to
        # disk, but _file_context is a write-once cache for
        # already-present entries (see _sync_file_context: it
        # only calls add_file for files in `selected - current`,
        # so files already present are never re-read).
        #
        # Symptom when this is missing: the LLM keeps seeing the
        # pre-edit version of every file it modifies, producing
        # "phantom parallel version" edits that target code the
        # user already changed. The stability tracker's
        # content-hash check in _update_stability DOES notice
        # the disk change (it hashes raw file content), but
        # that only rebalances tier placement — it doesn't
        # refresh the FileContext content the assembler reads
        # from.
        #
        # Runs AFTER the auto-add loop above so auto-added
        # files (also in files_modified) get loaded exactly
        # once with the post-edit content rather than being
        # loaded then immediately re-loaded.
        for path in report.files_modified:
            if not self._file_context.has_file(path):
                # Auto-added files already loaded above, or
                # the file was removed from selection between
                # edit and here. Either way, nothing to
                # refresh.
                continue
            try:
                # add_file with no explicit content re-reads
                # from the repo. Calling add_file on an
                # already-present path updates its content
                # in place and preserves insertion order
                # (FileContext contract).
                self._file_context.add_file(path)
            except Exception as exc:
                # File became unreadable post-edit (binary
                # conversion? permission flip?). Log at
                # WARNING — the next turn's assembler will
                # use whatever stale content was there,
                # which is still better than crashing the
                # completion result build, but the user
                # needs to see the problem.
                logger.warning(
                    "Failed to refresh file context for "
                    "modified file %s: %s. LLM will see "
                    "stale content on next turn.",
                    path, exc,
                )

        # Serialise the per-block results for the JSON
        # response. Each EditResult is a dataclass; we emit a
        # plain dict matching the frontend contract.
        result["edit_results"] = [
            self._serialise_edit_result(r) for r in report.results
        ]
        result["passed"] = report.passed
        result["already_applied"] = report.already_applied
        result["failed"] = report.failed
        result["skipped"] = report.skipped
        result["not_in_context"] = report.not_in_context
        result["files_modified"] = list(report.files_modified)
        result["files_auto_added"] = list(report.files_auto_added)
        result["files_created"] = list(report.files_created)

        return result

    @staticmethod
    def _serialise_edit_result(r: EditResult) -> dict[str, Any]:
        """Convert an EditResult dataclass to the RPC dict shape.

        Status is serialised as its string value (the enum
        subclasses str, so ``r.status.value`` is explicit about
        intent). Error type is always present as a string —
        empty for success.
        """
        return {
            "file": r.file_path,
            "status": r.status.value,
            "message": r.message,
            "error_type": r.error_type,
            "old_preview": r.old_preview,
            "new_preview": r.new_preview,
        }

    def _run_completion_sync(
        self,
        request_id: str,
        messages: list[dict[str, Any]],
        loop: asyncio.AbstractEventLoop,
    ) -> tuple[str, bool, str | None, dict[str, Any]]:
        """Blocking LLM call — runs in a worker thread.

        Returns ``(full_content, was_cancelled, finish_reason,
        usage_dict)``. Schedules chunk callbacks onto the main
        event loop via ``run_coroutine_threadsafe``.

        ``usage_dict`` carries the per-request token counts plus
        cost as a plain dict. Keys:

        - ``prompt_tokens`` / ``completion_tokens`` — top-line
          input/output counts. ``completion_tokens`` INCLUDES
          reasoning tokens (the provider bills for both visible
          output and hidden reasoning under the same field).
        - ``reasoning_tokens`` — subset of ``completion_tokens``
          that went to hidden reasoning (Claude extended
          thinking, o1/o3). Zero when the model doesn't reason
          or when the provider doesn't report the breakdown.
        - ``cache_read_tokens`` / ``cache_write_tokens`` — unified
          across Anthropic's ``cache_read_input_tokens`` shape and
          OpenAI's ``prompt_tokens_details.cached_tokens`` shape.
          Whichever the provider reports, we surface here.
        - ``prompt_cached_tokens`` — OpenAI-shaped cache read
          count, kept as its own key for diagnostics. Merged
          into ``cache_read_tokens`` above so downstream
          consumers get one number; exposed separately for
          operators debugging cache hit rates across providers.
        - ``cost_usd`` — LiteLLM's computed cost for this request
          in USD. ``None`` when the model isn't in LiteLLM's
          price table (self-hosted, brand-new releases). The
          frontend renders ``None`` as "—" rather than $0.00 so
          an unknown price isn't mistaken for a free request.

        The worker extracts from whatever shape the provider
        returned (dict or attribute-style object) and normalises
        here so the event-loop thread never has to touch the
        provider's native types. Session-total accumulation uses
        the same normalised view.

        Empty dict shape (with zero-valued fields and
        ``cost_usd=None``) when the provider reported no usage
        — rare but possible with some providers on cancellation.
        """
        empty_usage: dict[str, Any] = {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "reasoning_tokens": 0,
            "cache_read_tokens": 0,
            "cache_write_tokens": 0,
            "prompt_cached_tokens": 0,
            "cost_usd": None,
        }
        try:
            import litellm
        except ImportError:
            logger.error("litellm not available; streaming disabled")
            return (
                "litellm is not installed on this server",
                False,
                None,
                dict(empty_usage),
            )

        full_content = ""
        was_cancelled = False

        # Resolve effective max_tokens. Specs3 calls this out
        # explicitly — without it providers apply their own
        # default (4096 for many), which silently truncates
        # long edit responses. The counter's per-model ceiling
        # is the safe upper bound; user config can lower it.
        max_output = _resolve_max_output_tokens(
            self._config, self._counter
        )

        # Debug hook — when AC_DC_DUMP_PROMPT is set, pretty-
        # print the assembled message array to stderr before
        # the completion call. Lets operators diagnose "why
        # is my prompt so large" without adding live Python
        # exec. Values: "1"/"true"/"yes" → full JSON dump;
        # "summary" → per-message role + token count only
        # (lighter, useful for category-drift debugging);
        # anything else → no dump. Off by default so the
        # hook costs nothing in production.
        import os as _os
        dump_mode = _os.environ.get("AC_DC_DUMP_PROMPT", "").lower()
        if dump_mode in ("1", "true", "yes", "full"):
            import json as _json
            import sys as _sys
            print(
                f"\n=== AC_DC_DUMP_PROMPT request={request_id} ===",
                file=_sys.stderr,
            )
            print(
                _json.dumps(messages, indent=2, default=str),
                file=_sys.stderr,
            )
            print(
                "=== end dump ===\n",
                file=_sys.stderr,
            )
        elif dump_mode == "summary":
            import sys as _sys
            print(
                f"\n=== AC_DC_DUMP_PROMPT summary "
                f"request={request_id} ===",
                file=_sys.stderr,
            )
            for i, msg in enumerate(messages):
                role = msg.get("role", "?")
                content = msg.get("content", "")
                if isinstance(content, str):
                    tokens = self._counter.count(content)
                    preview = content[:80].replace("\n", " ")
                    print(
                        f"[{i:3d}] {role:10s} {tokens:7d} tok "
                        f"| {preview}",
                        file=_sys.stderr,
                    )
                elif isinstance(content, list):
                    tokens = self._counter.count(msg)
                    kinds = ",".join(
                        b.get("type", "?") for b in content
                        if isinstance(b, dict)
                    )
                    print(
                        f"[{i:3d}] {role:10s} {tokens:7d} tok "
                        f"| multimodal [{kinds}]",
                        file=_sys.stderr,
                    )
            print(
                "=== end summary ===\n",
                file=_sys.stderr,
            )

        try:
            stream = litellm.completion(
                model=self._config.model,
                messages=messages,
                stream=True,
                stream_options={"include_usage": True},
                max_tokens=max_output,
            )
        except Exception as exc:
            # LiteLLM raises a small catalogue of typed
            # exceptions that carry far more actionable info
            # than a stringified message. We classify here and
            # stash the structured error on ``self`` for
            # ``_build_completion_result`` to pick up — the
            # worker-thread return tuple is fixed-shape, so we
            # use a thread-local attribute for the side
            # channel. A future pass could widen the tuple,
            # but single-stream operation makes this simpler.
            #
            # Classes tried in order of specificity. Unknown
            # exception types fall through to the catch-all
            # "llm_error" classification with the original
            # string message. Callers (frontend toast) render
            # the same message either way; the classification
            # enables per-type UX (countdown for RateLimit,
            # "trigger compaction" for ContextWindowExceeded,
            # etc.).
            logger.exception("litellm.completion raised")
            self._last_error_info = self._classify_litellm_error(
                litellm, exc
            )
            return (
                f"LLM call failed: {exc}",
                False,
                None,
                dict(empty_usage),
            )

        usage: dict[str, Any] | None = None
        finish_reason: str | None = None
        # Full response object — needed for _hidden_params /
        # litellm.completion_cost fallback. Stream chunks don't
        # carry _hidden_params directly; the cost lives on the
        # stream object itself (which litellm populates as
        # chunks arrive) OR on the final chunk's response
        # attribute. Capture whichever surfaces.
        cost_source: Any = stream

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

            # Capture finish_reason from whichever chunk first
            # reports a non-null value (typically the final
            # chunk). Earlier chunks report None and fall through.
            reason = _extract_finish_reason(chunk)
            if reason is not None and finish_reason is None:
                finish_reason = reason

            # Usage is typically on the final chunk.
            chunk_usage = getattr(chunk, "usage", None)
            if chunk_usage is not None:
                usage = chunk_usage

        # Normalise usage into a plain dict for the return
        # value. Mirrors the provider-variant handling in
        # _accumulate_usage so the event-loop thread receives
        # a shape it can serialise to JSON directly without
        # touching attribute-style provider objects.
        request_usage = dict(empty_usage)
        if usage is not None:
            def _get(name: str, source: Any = usage) -> int:
                if isinstance(source, dict):
                    val = source.get(name)
                else:
                    val = getattr(source, name, None)
                try:
                    return int(val) if val is not None else 0
                except (TypeError, ValueError):
                    return 0

            def _get_nested(
                parent_name: str, child_name: str
            ) -> int:
                """Read a nested field like completion_tokens_details.reasoning_tokens.

                Handles both attribute-style (OpenAI/Anthropic
                Pydantic objects) and dict-style (older providers,
                tests). Returns 0 when the parent or child is
                missing rather than raising — a provider that
                doesn't report reasoning shouldn't crash the
                pipeline.
                """
                if isinstance(usage, dict):
                    parent = usage.get(parent_name)
                else:
                    parent = getattr(usage, parent_name, None)
                if parent is None:
                    return 0
                return _get(child_name, source=parent)

            request_usage["prompt_tokens"] = _get("prompt_tokens")
            request_usage["completion_tokens"] = _get(
                "completion_tokens"
            )
            # Reasoning tokens — subset of completion_tokens. Live
            # inside completion_tokens_details for providers that
            # report them (o1, o3, Claude extended thinking via
            # Anthropic or Bedrock). Absent for regular models;
            # nested access degrades to 0.
            request_usage["reasoning_tokens"] = _get_nested(
                "completion_tokens_details", "reasoning_tokens"
            )
            # OpenAI-shaped prompt cache read. Kept as its own
            # field for diagnostics; also folded into the unified
            # cache_read_tokens below.
            prompt_cached = _get_nested(
                "prompt_tokens_details", "cached_tokens"
            )
            request_usage["prompt_cached_tokens"] = prompt_cached
            # Unified cache read — pick the max across Anthropic's
            # cache_read_input_tokens, the legacy cache_read_tokens
            # name, and OpenAI's prompt_tokens_details.cached_tokens.
            # Provider reports only one of the three, so max()
            # produces the correct value regardless of shape.
            request_usage["cache_read_tokens"] = max(
                _get("cache_read_input_tokens"),
                _get("cache_read_tokens"),
                prompt_cached,
            )
            request_usage["cache_write_tokens"] = max(
                _get("cache_creation_input_tokens"),
                _get("cache_creation_tokens"),
            )

        # Cost extraction. LiteLLM exposes per-request cost in two
        # places depending on the call mode:
        #
        # - Non-streaming: ``response._hidden_params["response_cost"]``
        #   on the response object.
        # - Streaming: ``stream._hidden_params["response_cost"]``
        #   on the stream iterator itself, populated as chunks
        #   arrive. Some providers also attach it to the final
        #   chunk's response attribute.
        #
        # Fallback: ``litellm.completion_cost(completion_response)``
        # computes from the usage dict when ``_hidden_params`` is
        # missing. Returns None when the model isn't in LiteLLM's
        # price table — self-hosted models, brand-new releases
        # before LiteLLM's model_prices_and_context_window.json
        # catches up. None propagates through as None; the
        # frontend renders it as "—" not $0.00.
        request_cost = self._extract_response_cost(
            cost_source, litellm, usage
        )
        request_usage["cost_usd"] = request_cost

        # Accumulate session totals from usage. Must happen AFTER
        # request_usage is built so the accumulator uses the same
        # normalised view as the return value — otherwise the HUD
        # (reads request_usage) and Context tab (reads session
        # totals) disagree on cache_read_tokens for OpenAI calls.
        if usage is not None:
            self._accumulate_usage(usage)
        # Cost accumulates separately — it's not part of the
        # provider's usage dict.
        self._accumulate_cost(request_cost)

        # Log non-natural finish reasons at WARNING so operators
        # can diagnose truncation without grep-spelunking through
        # debug logs. Natural stops (``stop``/``end_turn``) log
        # at INFO — still visible in verbose mode but not
        # alarming.
        if finish_reason is not None:
            if finish_reason in ("stop", "end_turn"):
                logger.info(
                    "LLM finish_reason=%r", finish_reason
                )
            else:
                logger.warning(
                    "LLM finish_reason=%r "
                    "(non-natural stop — response may be incomplete)",
                    finish_reason,
                )

        return full_content, was_cancelled, finish_reason, request_usage

    def _accumulate_usage(self, usage: Any) -> None:
        """Fold a per-request usage record into session totals.

        Handles the full normalised shape including nested
        reasoning + OpenAI-cached fields so session totals and
        per-request numbers stay consistent. ``cost_usd`` is
        accumulated separately by :meth:`_accumulate_cost`
        because it isn't part of the provider's usage dict —
        it comes from LiteLLM's pricing table.
        """
        # Dual-mode accessor — provider responses may be either
        # attribute-style objects or plain dicts.
        def _get(name: str, source: Any = usage, default: int = 0) -> int:
            if isinstance(source, dict):
                val = source.get(name, default)
            else:
                val = getattr(source, name, default)
            try:
                return int(val) if val is not None else default
            except (TypeError, ValueError):
                return default

        def _get_nested(parent_name: str, child_name: str) -> int:
            if isinstance(usage, dict):
                parent = usage.get(parent_name)
            else:
                parent = getattr(usage, parent_name, None)
            if parent is None:
                return 0
            return _get(child_name, source=parent)

        self._session_totals["input_tokens"] += _get("prompt_tokens")
        self._session_totals["output_tokens"] += _get(
            "completion_tokens"
        )
        # Reasoning tokens — subset of completion_tokens.
        # Accumulated independently so the UI can show
        # "of your X output tokens, Y were reasoning".
        self._session_totals["reasoning_tokens"] += _get_nested(
            "completion_tokens_details", "reasoning_tokens"
        )
        # OpenAI-shaped prompt cache read. Tracked separately
        # for diagnostics AND folded into cache_read_tokens.
        prompt_cached = _get_nested(
            "prompt_tokens_details", "cached_tokens"
        )
        self._session_totals["prompt_cached_tokens"] += prompt_cached
        # Cache field names vary by provider; accept all three.
        self._session_totals["cache_read_tokens"] += max(
            _get("cache_read_input_tokens"),
            _get("cache_read_tokens"),
            prompt_cached,
        )
        self._session_totals["cache_write_tokens"] += max(
            _get("cache_creation_input_tokens"),
            _get("cache_creation_tokens"),
        )

    def _accumulate_cost(self, cost: float | None) -> None:
        """Fold a per-request cost into session totals.

        ``cost`` is None when LiteLLM couldn't price the call
        (unknown model, missing pricing entry). We increment
        the unpriced counter in that case so the UI can show
        a "(partial)" indicator — an accumulated $0.12 with
        5 unpriced requests means "at least $0.12; true total
        is higher by the unpriced requests' cost".
        """
        if cost is None:
            self._session_totals["unpriced_request_count"] += 1
            return
        try:
            cost_float = float(cost)
        except (TypeError, ValueError):
            # Defensive — a non-numeric cost shouldn't crash the
            # pipeline. Count it as unpriced.
            self._session_totals["unpriced_request_count"] += 1
            return
        self._session_totals["cost_usd"] += cost_float
        self._session_totals["priced_request_count"] += 1

    @staticmethod
    def _extract_response_cost(
        cost_source: Any,
        litellm_module: Any,
        usage: Any,
    ) -> float | None:
        """Pull the USD cost for a completion from LiteLLM.

        Tries three locations in order:

        1. ``cost_source._hidden_params["response_cost"]`` — the
           primary location. LiteLLM populates this on the
           response object (non-streaming) and on the stream
           wrapper (streaming) as it receives usage.
        2. ``cost_source.response_cost`` — some provider
           integrations expose it as a direct attribute.
        3. ``litellm.completion_cost(completion_response=cost_source)``
           — computes from the usage dict using LiteLLM's
           pricing table. Final fallback when the hidden-params
           path didn't populate.

        Returns None when none of the paths produced a numeric
        cost. Callers treat None as "unknown"; the frontend
        renders it as "—".
        """
        # Path 1 — _hidden_params["response_cost"].
        try:
            hidden = getattr(cost_source, "_hidden_params", None)
            if isinstance(hidden, dict):
                raw = hidden.get("response_cost")
                if raw is not None:
                    return float(raw)
        except (TypeError, ValueError, AttributeError):
            pass

        # Path 2 — direct attribute.
        try:
            raw = getattr(cost_source, "response_cost", None)
            if raw is not None:
                return float(raw)
        except (TypeError, ValueError, AttributeError):
            pass

        # Path 3 — litellm.completion_cost(). The function
        # signature varies slightly across LiteLLM versions;
        # pass the response object positionally as the primary
        # arg and accept any of the supported shapes. Failures
        # (unknown model, missing pricing, malformed response)
        # return None — we don't want pricing to abort a stream.
        try:
            cost_fn = getattr(litellm_module, "completion_cost", None)
            if cost_fn is not None and cost_source is not None:
                raw = cost_fn(completion_response=cost_source)
                if raw is not None:
                    return float(raw)
        except Exception as exc:
            # LiteLLM raises various pricing-related exceptions
            # (NotFoundError for unknown models,
            # BadRequestError for malformed usage). Log at
            # debug — unknown models are a normal case, not
            # an error the user needs to see.
            logger.debug(
                "litellm.completion_cost failed: %s", exc
            )

        return None

    @staticmethod
    def _classify_litellm_error(
        litellm_module: Any,
        exc: BaseException,
    ) -> dict[str, Any]:
        """Map a LiteLLM exception to a structured error dict.

        LiteLLM's exception hierarchy normalises provider errors
        into a small set of typed classes — each carrying
        ``status_code``, ``model``, ``llm_provider``, and
        sometimes ``response`` with a ``Retry-After`` header.
        This classifier reads those attributes into a flat dict
        the frontend can dispatch on.

        Recognised types and their intended UX:

        - ``context_window_exceeded`` — the prompt (including
          history) exceeds the model's input window. Actionable:
          trigger compaction or drop files. Frontend shows a
          toast with a "Compact now" action.
        - ``rate_limit`` — provider throttled the request.
          Actionable: wait and retry. Frontend shows a countdown
          toast using the ``retry_after`` field when populated
          (LiteLLM surfaces the ``Retry-After`` header on the
          exception's ``response`` attribute).
        - ``authentication`` — API key invalid or missing.
          Actionable: edit LLM config. Frontend shows a toast
          with a "Open Settings" action.
        - ``bad_request`` — malformed request (usually a schema
          mismatch between AC⚡DC's request shape and the
          provider's expectations). Actionable: file a bug;
          frontend shows the raw provider message.
        - ``api_connection`` — network/transport failure before
          the request reached the provider. Actionable: check
          internet / corporate proxy.
        - ``service_unavailable`` — provider reported 503 or
          equivalent. Actionable: wait; may retry.
        - ``timeout`` — request took longer than LiteLLM's
          configured timeout.
        - ``not_found`` — model identifier doesn't exist for
          the configured provider. Actionable: verify the
          model name in LLM config.
        - ``llm_error`` — catch-all for exceptions not matching
          any recognised LiteLLM subclass. Original exception
          type name captured in ``original_type`` for debugging.

        The classification tries the most specific types first.
        LiteLLM's class hierarchy has
        ``ContextWindowExceededError`` as a subclass of
        ``BadRequestError`` (400 with specific error code), so
        checking the window error BEFORE the generic bad-request
        matters — otherwise every context overflow would be
        mis-tagged.

        Returns a dict with at minimum ``error_type`` and
        ``message``. Additional fields populated when present on
        the exception object.
        """
        info: dict[str, Any] = {
            "error_type": "llm_error",
            "message": str(exc),
            "retry_after": None,
            "status_code": None,
            "provider": None,
            "model": None,
            "original_type": type(exc).__name__,
        }

        # Pull common metadata first — present on most LiteLLM
        # exception types. Guarded access because not every
        # exception in the chain carries these attributes
        # (wrapped third-party errors sometimes don't).
        info["status_code"] = getattr(exc, "status_code", None)
        info["model"] = getattr(exc, "model", None)
        info["provider"] = getattr(exc, "llm_provider", None)

        # Classification. Each branch uses getattr on the module
        # so a LiteLLM version that drops one of these classes
        # doesn't crash classification — the attribute lookup
        # returns None and isinstance(exc, None) is False, so
        # the branch is skipped.
        exceptions_mod = getattr(litellm_module, "exceptions", None)

        def _cls(name: str) -> type | None:
            """Locate a LiteLLM exception class by name.

            Some versions expose classes on the top-level
            module, others nest them under ``litellm.exceptions``.
            Check both; return None if neither has it.
            """
            cls = getattr(litellm_module, name, None)
            if cls is None and exceptions_mod is not None:
                cls = getattr(exceptions_mod, name, None)
            if isinstance(cls, type):
                return cls
            return None

        ctx_cls = _cls("ContextWindowExceededError")
        rate_cls = _cls("RateLimitError")
        auth_cls = _cls("AuthenticationError")
        not_found_cls = _cls("NotFoundError")
        bad_req_cls = _cls("BadRequestError")
        conn_cls = _cls("APIConnectionError")
        unavail_cls = _cls("ServiceUnavailableError")
        timeout_cls = _cls("Timeout")

        # Order matters: more-specific subclasses first.
        if ctx_cls is not None and isinstance(exc, ctx_cls):
            info["error_type"] = "context_window_exceeded"
        elif rate_cls is not None and isinstance(exc, rate_cls):
            info["error_type"] = "rate_limit"
            # Retry-After extraction. LiteLLM attaches the
            # original httpx/requests response as .response on
            # some exception types; the header is
            # "retry-after" (lowercase in httpx, case-insensitive
            # lookup). Parse as float seconds; fall back to
            # None on any shape mismatch.
            resp = getattr(exc, "response", None)
            if resp is not None:
                headers = getattr(resp, "headers", None)
                if headers is not None:
                    try:
                        raw = headers.get("retry-after") or headers.get(
                            "Retry-After"
                        )
                        if raw is not None:
                            info["retry_after"] = float(raw)
                    except (TypeError, ValueError, AttributeError):
                        pass
        elif auth_cls is not None and isinstance(exc, auth_cls):
            info["error_type"] = "authentication"
        elif not_found_cls is not None and isinstance(exc, not_found_cls):
            info["error_type"] = "not_found"
        elif bad_req_cls is not None and isinstance(exc, bad_req_cls):
            # Checked AFTER ContextWindowExceededError because
            # the latter is a subclass of BadRequestError.
            info["error_type"] = "bad_request"
        elif conn_cls is not None and isinstance(exc, conn_cls):
            info["error_type"] = "api_connection"
        elif unavail_cls is not None and isinstance(exc, unavail_cls):
            info["error_type"] = "service_unavailable"
        elif timeout_cls is not None and isinstance(exc, timeout_cls):
            info["error_type"] = "timeout"

        return info

    # ------------------------------------------------------------------
    # Stability tracker initialization
    # ------------------------------------------------------------------

    def _try_initialize_stability(self) -> None:
        """Seed the stability tracker from the reference graph.

        Called eagerly during deferred startup (Phase 2) or lazily
        on the first chat request if eager init failed. Runs
        index_repo on the full file list, builds the reference
        graph, initializes tier assignments (including L0 seeding),
        measures real token counts for all tier items, and seeds
        the system prompt into L0.

        Mode-aware dispatch — in code mode the primary index is
        the symbol index and entries use the ``symbol:`` prefix;
        in doc mode the primary index is the doc index and
        entries use the ``doc:`` prefix. The two paths share the
        same clustering algorithm via
        ``initialize_with_keys``; the only differences are which
        index contributes the file list and which prefix the
        tracker keys get.

        In doc mode, if the doc index isn't ready yet
        (``_doc_index_ready is False`` — the background build
        hasn't completed), this method bails without setting
        ``_stability_initialized = True``. The next chat request's
        lazy-init retry will try again; once structural extraction
        completes, initialization succeeds on the retry. Users
        who switch to code mode in the interim get normal code-
        mode init on the switch.

        Safe to call multiple times — sets the per-mode
        initialized flag on the first successful run.
        Subsequent calls for the same mode are no-ops;
        subsequent calls for a DIFFERENT mode (after a
        switch_mode) initialize that mode's tracker fresh.
        """
        mode = self._context.mode
        if self._stability_initialized.get(mode, False):
            return
        if self._repo is None:
            return

        # Mode dispatch — doc mode needs the doc index ready;
        # code mode needs the symbol index attached.
        mode = self._context.mode
        if mode == Mode.DOC:
            if not self._doc_index_ready:
                # Doc index still building. Skip init; the next
                # request's retry catches it, or a mode switch
                # to code picks up the code-mode path.
                return
        else:
            if self._symbol_index is None:
                return

        try:
            # Step 1: Index the repository. In code mode we
            # re-run the symbol index's incremental pass (cheap
            # thanks to mtime caching — unchanged files return
            # from cache). In doc mode, the background build
            # (2.8.2b) has already indexed every doc file; we
            # don't need to re-walk.
            file_list_raw = self._repo.get_flat_file_list()
            file_list = [f for f in file_list_raw.split("\n") if f]
            if mode == Mode.CODE:
                assert self._symbol_index is not None
                self._symbol_index.index_repo(file_list)

            # Step 2: Initialize tier assignments from reference
            # graph. The tracker's key prefix must match the
            # content type — ``symbol:`` for code mode, ``doc:``
            # for doc mode. Passing the raw repo file list would
            # prefix every unrelated file (.json, images, config)
            # with the wrong marker, producing spurious entries
            # in the cache viewer and polluting cross-reference
            # mode down the line. We intersect the repo file
            # list with the mode-appropriate index's authoritative
            # set to produce the init list.
            cache_target = self._config.cache_target_tokens_for_model()
            self._stability_tracker.set_cache_target_tokens(cache_target)
            if mode == Mode.DOC:
                # Doc index is authoritative for which files
                # have outlines. Use _all_outlines directly
                # rather than intersecting with file_list — the
                # background build already applied the
                # doc-specific walker rules (hidden-dir exclusion
                # except .github, extension filter) and those
                # may not match what the repo's flat listing
                # produces.
                indexed_files = list(
                    self._doc_index._all_outlines.keys()
                )
                ref_index = self._doc_index._ref_index
                prefix = "doc:"
            else:
                assert self._symbol_index is not None
                indexed_files = [
                    path for path in file_list
                    if path in self._symbol_index._all_symbols
                ]
                ref_index = self._symbol_index._ref_index
                prefix = "symbol:"

            # Use initialize_with_keys so we can pass the
            # mode-appropriate prefix explicitly. The older
            # initialize_from_reference_graph hardcodes the
            # ``symbol:`` prefix — fine for code mode callers
            # but wrong for doc mode.
            keys = [f"{prefix}{path}" for path in indexed_files]
            self._stability_tracker.initialize_with_keys(
                ref_index,
                keys=keys,
                files=indexed_files,
                l0_target_tokens=cache_target,
            )

            # Step 3: Seed system prompt into L0. Use the
            # mode-appropriate prompt — switching modes later
            # demotes-and-reinstalls the prompt cleanly, so
            # initializing with the current mode's prompt is
            # correct even when the user has just loaded a
            # session that started in the other mode.
            import hashlib
            if mode == Mode.DOC:
                system_prompt = self._config.get_doc_system_prompt()
            else:
                system_prompt = self._config.get_system_prompt()
            # Legend: doc mode uses the doc index's legend;
            # code mode uses the symbol index's. Both are empty
            # strings when the index is empty, which is fine —
            # register_system_prompt just adds the token count
            # to the system: entry.
            if mode == Mode.DOC:
                legend = self._doc_index.get_legend()
            else:
                assert self._symbol_index is not None
                legend = self._symbol_index.get_legend()
            prompt_hash = hashlib.sha256(
                system_prompt.encode("utf-8")
            ).hexdigest()
            prompt_tokens = self._counter.count(system_prompt + legend)
            self._stability_tracker.register_system_prompt(
                prompt_hash, prompt_tokens
            )

            # Step 4: Measure real token counts for all tier items,
            # replacing placeholders from initialization.
            self._measure_tracker_tokens()

            self._stability_initialized[mode] = True
            logger.info(
                "Stability tracker initialized (%s mode): %d items",
                mode.value,
                len(self._stability_tracker.get_all_items()),
            )

            # Print a startup init HUD to the terminal.
            self._print_init_hud()

        except Exception as exc:
            logger.warning(
                "Stability tracker initialization failed: %s", exc
            )

    def _measure_tracker_tokens(self) -> None:
        """Replace placeholder token counts with real measured values.

        Iterates all symbol: and doc: items and replaces their
        placeholder tokens (from ``initialize_with_keys``) with
        the actual token count of the formatted block. Skips
        items whose index isn't attached or whose path doesn't
        resolve to a block — those keep the placeholder, which
        the next update cycle will refresh from the measured
        active-items data.

        Both prefixes are handled so doc-mode init gets real
        token counts too (2.8.2i). A tracker may hold items of
        both kinds simultaneously (cross-reference mode), and
        each prefix dispatches to its own index.
        """
        all_items = self._stability_tracker.get_all_items()
        for key in all_items:
            if key.startswith("symbol:"):
                if self._symbol_index is None:
                    continue
                path = key[len("symbol:"):]
                block = self._symbol_index.get_file_symbol_block(path)
                if block:
                    tokens = self._counter.count(block)
                    self._stability_tracker.measure_tokens(key, tokens)
            elif key.startswith("doc:"):
                path = key[len("doc:"):]
                block = self._doc_index.get_file_doc_block(path)
                if block:
                    tokens = self._counter.count(block)
                    self._stability_tracker.measure_tokens(key, tokens)

    def _print_init_hud(self) -> None:
        """Print the one-time startup tier distribution to stderr."""
        all_items = self._stability_tracker.get_all_items()
        tier_counts: dict[str, int] = {}
        for item in all_items.values():
            tier_name = item.tier.value
            tier_counts[tier_name] = tier_counts.get(tier_name, 0) + 1

        if not tier_counts:
            return

        import sys
        lines = ["╭─ Initial Tier Distribution ─╮"]
        total = 0
        for tier in (Tier.L0, Tier.L1, Tier.L2, Tier.L3, Tier.ACTIVE):
            count = tier_counts.get(tier.value, 0)
            if count > 0:
                lines.append(f"│ {tier.value:<10} {count:>4} items{' ' * 11}│")
                total += count
        lines.append("├─────────────────────────────┤")
        lines.append(f"│ Total: {total:<4} items{' ' * 12}│")
        lines.append("╰─────────────────────────────╯")
        print("\n".join(lines), file=sys.stderr)

    def _print_post_response_hud(self) -> None:
        """Print the three-section terminal HUD after each response.

        Sections per specs-reference/5-webapp/viewers-hud.md:
        1. Cache blocks (boxed) — per-tier token counts + cache hit %
        2. Token usage — model, per-category, total, last request, session
        3. Tier changes — promotions and demotions
        """
        import sys

        all_items = self._stability_tracker.get_all_items()
        if not all_items:
            return

        # Section 1: Cache Blocks
        tier_data: list[tuple[str, int, int, bool]] = []  # (name, entry_n, tokens, cached)
        tier_order = [Tier.L0, Tier.L1, Tier.L2, Tier.L3, Tier.ACTIVE]
        total_tokens = 0
        cached_tokens = 0
        for tier in tier_order:
            items = [it for it in all_items.values() if it.tier == tier]
            if not items:
                continue
            tokens = sum(it.tokens for it in items)
            total_tokens += tokens
            is_cached = tier != Tier.ACTIVE
            if is_cached:
                cached_tokens += tokens
            entry_n = _TIER_CONFIG.get(tier, {}).get("entry_n", 0)
            tier_data.append((tier.value, entry_n, tokens, is_cached))

        if tier_data:
            cache_pct = (
                round(cached_tokens / total_tokens * 100)
                if total_tokens > 0
                else 0
            )
            # Compute max line width for the box.
            content_lines: list[str] = []
            for name, entry_n, tokens, cached in tier_data:
                if cached:
                    line = f"│ {name:<10} ({entry_n}+) {tokens:>8,} tokens [cached] │"
                else:
                    line = f"│ {name:<10}       {tokens:>8,} tokens          │"
                content_lines.append(line)

            max_width = max(len(l) for l in content_lines) if content_lines else 40
            header = f"╭─ Cache Blocks {'─' * (max_width - 17)}╮"
            separator = f"├{'─' * (max_width - 2)}┤"
            footer_text = f"│ Total: {total_tokens:,} | Cache hit: {cache_pct}%"
            footer_text = footer_text.ljust(max_width - 1) + "│"
            bottom = f"╰{'─' * (max_width - 2)}╯"

            lines = [header, *content_lines, separator, footer_text, bottom]
            print("\n".join(lines), file=sys.stderr)

        # Section 2: Token Usage
        st = self._session_totals
        model = self._config.model
        system_tokens = self._counter.count(
            self._context.get_system_prompt()
        )
        symbol_map_tokens = 0
        if self._symbol_index is not None:
            try:
                smap = self._symbol_index.get_symbol_map(
                    exclude_files=set(self._selected_files)
                )
                symbol_map_tokens = self._counter.count(smap) if smap else 0
            except Exception:
                pass
        files_tokens = self._file_context.count_tokens(self._counter)
        # URL tokens — match the Budget sub-view's computation.
        # Prefer the context manager's live URL context
        # (matches what the assembler injects into THIS prompt),
        # fall back to the sum across fetched URLs when the
        # context is empty (URLs fetched in earlier turns that
        # are in cached tiers).
        url_tokens = 0
        url_context_parts = self._context.get_url_context()
        if url_context_parts:
            url_tokens = self._counter.count(
                "\n---\n".join(url_context_parts)
            )
        else:
            try:
                for content in self._url_service.get_fetched_urls():
                    if content.error:
                        continue
                    rendered = content.format_for_prompt()
                    if rendered:
                        url_tokens += self._counter.count(rendered)
            except Exception:
                pass
        history_tokens = self._context.history_token_count()
        total_est = (
            system_tokens + symbol_map_tokens + files_tokens
            + url_tokens + history_tokens
        )
        max_input = self._counter.max_input_tokens

        usage_lines = [
            f"Model: {model}",
            f"System:    {system_tokens:>10,}",
            f"Symbol Map:{symbol_map_tokens:>10,}",
            f"Files:     {files_tokens:>10,}",
        ]
        # Only show URL line when non-zero — keeps the HUD tidy
        # in the common case (no URLs fetched this session).
        if url_tokens > 0:
            usage_lines.append(f"URLs:      {url_tokens:>10,}")
        usage_lines.extend([
            f"History:   {history_tokens:>10,}",
            f"Total:     {total_est:>10,} / {max_input:,}",
        ])
        input_tok = st.get("input_tokens", 0)
        output_tok = st.get("output_tokens", 0)
        if input_tok or output_tok:
            usage_lines.append(
                f"Last request: {input_tok:,} in, {output_tok:,} out"
            )
        cache_read = st.get("cache_read_tokens", 0)
        cache_write = st.get("cache_write_tokens", 0)
        if cache_read or cache_write:
            usage_lines.append(
                f"Cache:     read: {cache_read:,}, write: {cache_write:,}"
            )
        session_total = sum(st.values())
        if session_total:
            usage_lines.append(f"Session total: {session_total:,}")
        print("\n".join(usage_lines), file=sys.stderr)

        # Section 3: Tier Changes
        changes = self._stability_tracker.get_changes()
        if changes:
            for change in changes:
                if "promoted" in change:
                    print(f"📈 {change}", file=sys.stderr)
                elif "active" in change:
                    print(f"📉 {change}", file=sys.stderr)
                else:
                    print(f"   {change}", file=sys.stderr)

    # ------------------------------------------------------------------
    # Context breakdown (RPC)
    # ------------------------------------------------------------------

    def get_context_breakdown(self) -> dict[str, Any]:
        """Return the full context/token/tier breakdown for the UI.

        Called by the Context tab (Budget + Cache sub-views) and
        the Token HUD. Synchronizes the in-memory FileContext with
        the current selected-files list before computing so the
        breakdown reflects what the next LLM request would look like.

        Shape matches specs-reference/5-webapp/viewers-hud.md.
        """
        import hashlib
        from ac_dc.stability_tracker import Tier

        # Sync file context with current selection so the breakdown
        # reflects the next request's state, not a stale snapshot.
        self._sync_file_context()

        mode = self._context.mode.value
        model = self._config.model

        # System prompt tokens — mode-aware.
        if self._context.mode == Mode.DOC:
            system_prompt = self._config.get_doc_system_prompt()
        else:
            system_prompt = self._config.get_system_prompt()
        system_tokens = self._counter.count(system_prompt)

        # Legend tokens.
        legend = ""
        if self._symbol_index is not None:
            try:
                legend = self._symbol_index.get_legend()
            except Exception:
                pass
        legend_tokens = self._counter.count(legend) if legend else 0

        # Symbol map tokens + per-file details for the Budget
        # expand. Mode-aware: code mode iterates the symbol
        # index's ``_all_symbols``, doc mode iterates the doc
        # index's ``_all_outlines``. Selected files and
        # user-excluded files are filtered out — their content
        # flows via ``file:`` entries (or is dropped entirely
        # for excluded paths), so including them in the map
        # details would double-count.
        symbol_map = ""
        symbol_map_files = 0
        symbol_map_details: list[dict[str, Any]] = []
        selected_set = set(self._selected_files)
        excluded_set = set(
            getattr(self, "_excluded_index_files", None) or ()
        )
        try:
            if self._context.mode == Mode.DOC:
                # Doc mode primary: iterate doc outlines.
                all_paths = list(
                    self._doc_index._all_outlines.keys()
                )
                symbol_map_files = len(all_paths)
                for path in all_paths:
                    if path in selected_set or path in excluded_set:
                        continue
                    block = self._doc_index.get_file_doc_block(path)
                    if not block:
                        continue
                    name = (
                        path.rsplit("/", 1)[-1]
                        if "/" in path
                        else path
                    )
                    symbol_map_details.append({
                        "name": name,
                        "path": path,
                        "tokens": self._counter.count(block),
                    })
                # Aggregate map for the Budget bar — use the
                # formatter's output rather than summing
                # per-file details (the formatter adds alias
                # headers and separators). Wide exclusion set
                # shared with _get_meta_block so this row's
                # token count matches the modal content.
                symbol_map = self._doc_index.get_doc_map(
                    exclude_files=self._wide_map_exclude_set()
                )
            else:
                # Code mode primary: iterate symbol index.
                if self._symbol_index is not None:
                    all_paths = list(
                        self._symbol_index._all_symbols.keys()
                    )
                    symbol_map_files = len(all_paths)
                    for path in all_paths:
                        if (
                            path in selected_set
                            or path in excluded_set
                        ):
                            continue
                        block = (
                            self._symbol_index.get_file_symbol_block(
                                path
                            )
                        )
                        if not block:
                            continue
                        name = (
                            path.rsplit("/", 1)[-1]
                            if "/" in path
                            else path
                        )
                        symbol_map_details.append({
                            "name": name,
                            "path": path,
                            "tokens": self._counter.count(block),
                        })
                    # Wide exclusion set shared with
                    # _get_meta_block so this row's token count
                    # matches the modal content.
                    symbol_map = self._symbol_index.get_symbol_map(
                        exclude_files=self._wide_map_exclude_set()
                    )
        except Exception as exc:
            # Defensive — malformed index state shouldn't
            # prevent breakdown rendering. Log at debug.
            logger.debug(
                "Symbol map details enumeration failed: %s", exc
            )
        symbol_map_tokens = (
            self._counter.count(symbol_map) if symbol_map else 0
        )

        # File tokens — per-file detail.
        file_details: list[dict[str, Any]] = []
        files_tokens = 0
        for path in self._file_context.get_files():
            content = self._file_context.get_content(path)
            if content:
                tokens = self._counter.count(content)
                files_tokens += tokens
                name = path.rsplit("/", 1)[-1] if "/" in path else path
                file_details.append({
                    "name": name,
                    "path": path,
                    "tokens": tokens,
                })

        # URL tokens + per-URL details for the Budget expand.
        # Read from the URL service's in-memory fetched dict
        # (session-scoped) so the details reflect the URLs that
        # will contribute to the next request, matching what the
        # chip UI shows. Error records are skipped — their
        # ``format_for_prompt()`` returns the empty string, and
        # including them with zero tokens would confuse the
        # Budget UI (a "0 tokens" URL still renders a row).
        url_details: list[dict[str, Any]] = []
        url_tokens = 0
        try:
            from ac_dc.url_service.detection import (
                display_name as _url_display_name,
            )
            for content in self._url_service.get_fetched_urls():
                if content.error:
                    continue
                rendered = content.format_for_prompt()
                if not rendered:
                    continue
                tokens = self._counter.count(rendered)
                url_details.append({
                    "name": _url_display_name(content.url),
                    "url": content.url,
                    "tokens": tokens,
                })
        except Exception as exc:
            # Defensive — a malformed URLContent shouldn't
            # prevent the whole breakdown from rendering. Log
            # at debug so operators can find it if needed.
            logger.debug(
                "URL details enumeration failed: %s", exc
            )
        # Aggregate url_tokens — prefer the context manager's
        # live URL context when attached (matches what the
        # assembler injects into THIS request's prompt), falling
        # back to the sum of per-URL details when the context is
        # empty. The fallback path matters because the URL
        # service's fetched dict persists across turns — URLs
        # fetched in an earlier turn are still in cached tiers
        # (as meta:url:* rows) and contribute tokens to the
        # prompt via the cached blocks, but get_url_context()
        # may return empty between turns. Without the fallback
        # the Budget view shows 0 URL tokens whenever the
        # context was cleared between requests, which is
        # confusing because the Cache sub-view shows the same
        # URLs consuming tokens in L1/L2/L3.
        url_context = self._context.get_url_context()
        if url_context:
            joined = "\n---\n".join(url_context)
            url_tokens = self._counter.count(joined)
        elif url_details:
            url_tokens = sum(d.get("tokens", 0) for d in url_details)

        # History tokens.
        history = self._context.get_history()
        history_tokens = self._context.history_token_count()

        # Total.
        total_tokens = (
            system_tokens + legend_tokens + symbol_map_tokens
            + files_tokens + url_tokens + history_tokens
        )
        max_input = self._counter.max_input_tokens

        # Cache hit rate from tier data.
        cached_tokens = 0
        all_tier_tokens = 0
        all_items = self._stability_tracker.get_all_items()
        for item in all_items.values():
            all_tier_tokens += item.tokens
            if item.tier not in (Tier.ACTIVE,):
                cached_tokens += item.tokens
        cache_hit_rate = (
            cached_tokens / all_tier_tokens if all_tier_tokens > 0 else 0.0
        )

        # Provider cache rate from session totals.
        st = self._session_totals
        provider_cache_rate = None
        total_input = st.get("input_tokens", 0)
        cache_read = st.get("cache_read_tokens", 0)
        if total_input > 0:
            provider_cache_rate = cache_read / total_input

        # Per-tier blocks with contents detail.
        blocks: list[dict[str, Any]] = []
        for tier in (Tier.L0, Tier.L1, Tier.L2, Tier.L3, Tier.ACTIVE):
            tier_items = self._stability_tracker.get_tier_items(tier)
            if not tier_items:
                continue
            tier_tokens = sum(it.tokens for it in tier_items.values())
            contents: list[dict[str, Any]] = []
            for key, item in sorted(tier_items.items()):
                entry: dict[str, Any] = {
                    "name": key,
                    "path": key.split(":", 1)[1] if ":" in key else key,
                    "tokens": item.tokens,
                }
                # Classify type from prefix.
                if key.startswith("system:"):
                    entry["type"] = "system"
                elif key.startswith("symbol:"):
                    entry["type"] = "symbols"
                elif key.startswith("doc:"):
                    entry["type"] = "doc_symbols"
                elif key.startswith("file:"):
                    entry["type"] = "files"
                elif key.startswith("url:"):
                    entry["type"] = "urls"
                elif key.startswith("history:"):
                    entry["type"] = "history"
                else:
                    entry["type"] = "other"
                # N value and promotion threshold.
                entry["n"] = item.n_value
                promote_n = None
                tier_cfg = _TIER_CONFIG_LOOKUP.get(item.tier)
                if tier_cfg is not None:
                    promote_n = tier_cfg.get("promote_n")
                entry["threshold"] = promote_n
                contents.append(entry)

            # Synthetic meta rows — sections of the prompt that
            # aren't individual tracker entries but DO contribute
            # tokens to this tier's cached block. Per user
            # request: every distinct section of the assembled
            # prompt should appear as a visible row so the cache
            # viewer is a literal inventory of what the LLM sees.
            #
            # L0 is the only cached tier that receives a meta
            # row today — the aggregate repo/doc map body, which
            # lives in the system message but isn't represented
            # by any tracker key. Per-file symbol/doc entries
            # already render as symbol:*/doc:* rows; this synthetic
            # row captures the residual aggregate that spans
            # ungraduated files.
            if tier == Tier.L0 and symbol_map:
                map_token_count = self._counter.count(symbol_map)
                if map_token_count > 0:
                    contents.append({
                        "name": (
                            "meta:doc_map" if self._context.mode == Mode.DOC
                            else "meta:repo_map"
                        ),
                        "path": (
                            "Document structure map"
                            if self._context.mode == Mode.DOC
                            else "Repository structure map"
                        ),
                        "tokens": map_token_count,
                        "type": (
                            "doc_symbols" if self._context.mode == Mode.DOC
                            else "symbols"
                        ),
                    })
                    tier_tokens += map_token_count

            blocks.append({
                "name": tier.value,
                "tier": tier.value,
                "tokens": tier_tokens,
                "count": len(contents),
                "cached": tier != Tier.ACTIVE,
                "contents": contents,
            })

        # Uncached tail — sections that always appear in the
        # prompt after the last cache breakpoint. These have no
        # tracker representation because they're rebuilt on
        # every request, but the user expects to see them in
        # the cache viewer for a complete accounting of what
        # the LLM received.
        #
        # Per specs-reference/3-llm/prompt-assembly.md §
        # "Message array structure", the uncached tail contains:
        # file tree, URL context, review context, active files
        # section, active history, current user message.
        #
        # Active history is already rendered as history:*
        # entries in the active tier; we don't duplicate it
        # here. The current user message is transient (it IS
        # the current request) and not worth a row.
        file_tree = ""
        if self._repo is not None:
            try:
                file_tree = self._repo.get_flat_file_list()
            except Exception as exc:
                # Non-fatal — a breakdown call shouldn't crash
                # just because the git subprocess hiccuped.
                # The row just won't appear.
                logger.debug(
                    "File tree fetch for breakdown failed: %s",
                    exc,
                )

        uncached_contents: list[dict[str, Any]] = []
        if file_tree:
            ft_tokens = self._counter.count(file_tree)
            if ft_tokens > 0:
                uncached_contents.append({
                    "name": "meta:file_tree",
                    "path": "Repository file listing",
                    "tokens": ft_tokens,
                    "type": "files",
                })
        for url_entry in url_details:
            uncached_contents.append({
                "name": f"meta:url:{url_entry['url']}",
                "path": url_entry["name"],
                "tokens": url_entry["tokens"],
                "type": "urls",
            })
        review_ctx = self._context.get_review_context()
        if review_ctx:
            rv_tokens = self._counter.count(review_ctx)
            if rv_tokens > 0:
                uncached_contents.append({
                    "name": "meta:review_context",
                    "path": "Code review context",
                    "tokens": rv_tokens,
                    "type": "other",
                })
        # Active files section — files currently in the file
        # context but not graduated to any cached tier. These
        # render in the uncached "Working Files" section of
        # the prompt.
        # Every file: tracker entry — active OR cached — already
        # represents a prompt section (working files if active,
        # cached tier block if graduated). Adding a
        # meta:active_file: row for the same path would
        # double-count it in the viewer. Walk all tiers
        # including active to dedupe against the file: entries.
        represented_file_paths: set[str] = set()
        for b in blocks:
            for c in b.get("contents", ()):
                if c.get("type") == "files":
                    # c["path"] for file:* entries is the file path
                    represented_file_paths.add(c.get("path") or "")
        for fd in file_details:
            if fd["path"] in represented_file_paths:
                continue
            uncached_contents.append({
                "name": f"meta:active_file:{fd['path']}",
                "path": fd["path"],
                "tokens": fd["tokens"],
                "type": "files",
            })

        if uncached_contents:
            uncached_tokens = sum(c["tokens"] for c in uncached_contents)
            blocks.append({
                "name": "uncached",
                "tier": "uncached",
                "tokens": uncached_tokens,
                "count": len(uncached_contents),
                "cached": False,
                "contents": uncached_contents,
            })

        # Promotions and demotions from the most recent update.
        changes = self._stability_tracker.get_changes()
        promotions = [c for c in changes if "promoted" in c or "→ L" in c]
        demotions = [c for c in changes if "active" in c and "→" in c and "promoted" not in c]

        return {
            "model": model,
            "mode": mode,
            "cross_ref_enabled": self._cross_ref_enabled,
            "total_tokens": total_tokens,
            "max_input_tokens": max_input,
            "cache_hit_rate": cache_hit_rate,
            "provider_cache_rate": provider_cache_rate,
            "blocks": blocks,
            "breakdown": {
                "system": system_tokens,
                "legend": legend_tokens,
                "symbol_map": symbol_map_tokens,
                "symbol_map_files": symbol_map_files,
                "symbol_map_details": symbol_map_details,
                "files": files_tokens,
                "file_count": len(file_details),
                "file_details": file_details,
                "urls": url_tokens,
                "url_details": url_details,
                "history": history_tokens,
                "history_messages": len(history),
            },
            "promotions": promotions,
            "demotions": demotions,
            "session_totals": {
                "prompt": st.get("input_tokens", 0),
                "completion": st.get("output_tokens", 0),
                "reasoning": st.get("reasoning_tokens", 0),
                "total": (
                    st.get("input_tokens", 0)
                    + st.get("output_tokens", 0)
                ),
                "cache_hit": st.get("cache_read_tokens", 0),
                "cache_write": st.get("cache_write_tokens", 0),
                "prompt_cached": st.get("prompt_cached_tokens", 0),
                # Cost fields — always present for shape
                # stability. cost_usd is a float (0.0 when no
                # priced requests have accumulated); priced_count
                # and unpriced_count let the UI show "(partial)"
                # when some requests were unpriced.
                "cost_usd": float(st.get("cost_usd", 0.0)),
                "priced_request_count": st.get(
                    "priced_request_count", 0
                ),
                "unpriced_request_count": st.get(
                    "unpriced_request_count", 0
                ),
            },
        }

    # ------------------------------------------------------------------
    # Tiered content builder
    # ------------------------------------------------------------------

    def _build_tiered_content(
        self,
    ) -> dict[str, dict[str, Any]] | None:
        """Walk the stability tracker and build per-tier content dicts.

        Returns ``None`` when the tracker has no items yet —
        the streaming handler uses that as the signal to fall
        back to flat assembly. An empty-but-initialised tracker
        returns an empty-but-non-None dict (all tiers with empty
        content lists), so the fallback only fires during a
        narrow pre-init window.

        Each tier entry has keys:

        - ``symbols`` — concatenated symbol/doc index blocks for
          files in this tier
        - ``files`` — concatenated fenced file contents for
          ``file:`` items in this tier
        - ``history`` — history message dicts graduated to this
          tier (in original index order)
        - ``graduated_files`` — file paths whose full content is
          in this tier (used for active-files exclusion)
        - ``graduated_history_indices`` — history message indices
          in this tier (used for active-history exclusion)

        Key-prefix dispatch:

        - ``symbol:{path}`` — symbol index block for the file
        - ``doc:{path}`` — doc index block (Layer 3.10+; currently
          skipped since the doc index hasn't landed)
        - ``file:{path}`` — full file content as a fenced block
        - ``history:{N}`` — history message at index N
        - ``system:*``, ``url:*`` — skipped (system prompt is
          handled by the assembler directly; URL tier entry is
          deferred to Layer 4.1)

        Items whose key references a user-excluded path are
        skipped defensively — the tracker's own exclusion pass
        should have removed them, but this belt-and-suspenders
        check prevents leakage if the two passes ever
        desynchronise.
        """
        if self._stability_tracker is None:
            return None
        all_items = self._stability_tracker.get_all_items()
        if not all_items:
            return None

        # Result skeleton — every tier gets an entry even when
        # empty, so the assembler's `tiered_content.get(tier) or
        # {}` fallback always finds the right shape.
        result: dict[str, dict[str, Any]] = {
            tier: {
                "symbols": "",
                "files": "",
                "history": [],
                "graduated_files": [],
                "graduated_history_indices": [],
            }
            for tier in ("L0", "L1", "L2", "L3")
        }

        history = self._context.get_history()

        # Walk items once, dispatching by tier + prefix. Each
        # tier builds lists of fragments first, then joins at
        # the end so the fragment ordering is deterministic
        # (we sort by key for stability).
        tier_symbol_fragments: dict[str, list[str]] = {
            t: [] for t in ("L0", "L1", "L2", "L3")
        }
        tier_file_fragments: dict[str, list[str]] = {
            t: [] for t in ("L0", "L1", "L2", "L3")
        }
        tier_history_entries: dict[str, list[tuple[int, dict[str, Any]]]] = {
            t: [] for t in ("L0", "L1", "L2", "L3")
        }

        # Defensive filter sets per specs-reference/3-llm/
        # prompt-assembly.md § Uniqueness invariants. A file's
        # index block must never coexist with its full content
        # in any form — upstream (Step 2 of _update_stability,
        # set_excluded_index_files, _rebuild_cache_impl) is
        # responsible for removing stale entries, but belt-and-
        # suspenders checks here catch any leakage from races,
        # cross-reference rebuild edge cases, or future code
        # paths that forget the invariant.
        selected_set = set(self._selected_files)
        excluded_set = set(getattr(self, "_excluded_index_files", []))

        for key in sorted(all_items.keys()):
            item = all_items[key]
            # The tracker's Tier enum subclasses str — its value
            # is the tier name. Skip items in the active tier
            # (they don't go into cached blocks) and unknown
            # tiers.
            tier_name = getattr(item.tier, "value", str(item.tier))
            if tier_name not in ("L0", "L1", "L2", "L3"):
                continue

            # Extract the path once for defensive filters below.
            # None for system:/history:/url: keys (no path
            # component); those are never filtered by these sets.
            path_suffix: str | None = None
            for prefix in ("symbol:", "doc:", "file:"):
                if key.startswith(prefix):
                    path_suffix = key[len(prefix):]
                    break

            # Defensive: skip user-excluded paths regardless of
            # prefix. Applies to symbol:, doc:, and file: keys.
            if path_suffix is not None and path_suffix in excluded_set:
                logger.debug(
                    "Tier content: skipping %s (excluded from "
                    "index by user); tracker entry will be "
                    "cleaned up on next update cycle",
                    key,
                )
                continue

            # Defensive: skip symbol:/doc: for selected files.
            # Their full content renders via the file: entry
            # (cached tier) or the active Working Files section,
            # so the index block would be a duplicate of the
            # same file's content in another slot.
            if (
                key.startswith(("symbol:", "doc:"))
                and path_suffix is not None
                and path_suffix in selected_set
            ):
                logger.debug(
                    "Tier content: skipping %s (full content "
                    "present via selection); tracker entry "
                    "will be cleaned up on next update cycle",
                    key,
                )
                continue

            if key.startswith("symbol:"):
                path = key[len("symbol:"):]
                if self._symbol_index is None:
                    continue
                block = self._symbol_index.get_file_symbol_block(path)
                if block:
                    tier_symbol_fragments[tier_name].append(block)
                    # Track this path as graduated so the
                    # aggregate symbol map in L0's system
                    # message doesn't ALSO render this file's
                    # compact block. Without this, every
                    # symbol-graduated file's block appears
                    # twice in the prompt — once here under
                    # the tier's TIER_SYMBOLS_HEADER, and
                    # once in the aggregate map body. The
                    # `graduated_files` list is consumed by
                    # `_assemble_tiered` to build the
                    # exclude_files set passed to
                    # `get_symbol_map()`.
                    result[tier_name]["graduated_files"].append(path)
            elif key.startswith("doc:"):
                # Doc blocks share the tier's `symbols` field
                # with symbol blocks — both render under the
                # TIER_SYMBOLS_HEADER ("Repository Structure
                # (continued)") in the same content section per
                # specs4/3-llm/prompt-assembly.md § "L1–L3
                # Blocks". Treating them uniformly means
                # cross-reference mode (where a tier holds items
                # from both indexes) produces one coherent block
                # rather than two separate headers. Fragment
                # ordering is deterministic via the sorted()
                # walk above, so symbol and doc blocks interleave
                # by path rather than by source index.
                path = key[len("doc:"):]
                block = self._doc_index.get_file_doc_block(path)
                if block:
                    tier_symbol_fragments[tier_name].append(block)
                    # Same deduplication reasoning as the
                    # symbol: branch above. Doc-graduated
                    # paths also need to be excluded from
                    # the aggregate map (which in doc mode
                    # is the doc map, in cross-ref mode
                    # could be either).
                    result[tier_name]["graduated_files"].append(path)
            elif key.startswith("file:"):
                path = key[len("file:"):]
                content = self._file_context.get_content(path)
                if content is None:
                    # Tracker has an entry for this file but the
                    # file context doesn't. Most common cause:
                    # a stale entry from a previous request
                    # where content WAS loaded, but the file
                    # now fails to read (deleted, turned binary,
                    # permissions changed). The stale entry
                    # will clear on the next tracker update
                    # pass (Phase 1 drops file: entries not in
                    # active_items). Skip silently for this
                    # request — the WARNING from
                    # _sync_file_context already told the user
                    # the underlying reason.
                    logger.debug(
                        "Tier content for %s skipped: no "
                        "content in file context (stale "
                        "tracker entry, cleanup on next cycle)",
                        key,
                    )
                    continue
                tier_file_fragments[tier_name].append(
                    f"{path}\n```\n{content}\n```"
                )
                result[tier_name]["graduated_files"].append(path)
            elif key.startswith("history:"):
                try:
                    idx = int(key[len("history:"):])
                except ValueError:
                    continue
                if 0 <= idx < len(history):
                    tier_history_entries[tier_name].append(
                        (idx, dict(history[idx]))
                    )
                    result[tier_name]["graduated_history_indices"].append(idx)
            # system:*, url:* — intentionally skipped.

        # Finalise each tier. Symbols and files join with blank
        # lines between fragments. History is sorted by original
        # index so multi-message tier content reads in
        # conversation order.
        for tier_name in ("L0", "L1", "L2", "L3"):
            result[tier_name]["symbols"] = "\n\n".join(
                tier_symbol_fragments[tier_name]
            )
            result[tier_name]["files"] = "\n\n".join(
                tier_file_fragments[tier_name]
            )
            tier_history_entries[tier_name].sort(key=lambda p: p[0])
            result[tier_name]["history"] = [
                msg for _idx, msg in tier_history_entries[tier_name]
            ]

        return result

    # ------------------------------------------------------------------
    # Message assembly — tiered (primary path, 3.8)
    # ------------------------------------------------------------------

    def _assemble_tiered(
        self,
        user_prompt: str,
        images: list[str],
        tiered_content: dict[str, dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Build the tiered message array.

        Computes the symbol map with tier-aware exclusions (two-
        pass: exclude selected files from the map, then exclude
        tier-graduated file paths too) and delegates message
        assembly to the context manager.

        System reminder is appended to the user prompt here so
        the tier assembler doesn't need to know about it.
        """
        # Append the system reminder before assembly so it lands
        # at the end of the user's text — closest to where the
        # model generates.
        reminder = self._config.get_system_reminder()
        augmented_prompt = user_prompt + (reminder or "")

        # Build the exclusion set: selected files (full content
        # present in the active "Working Files" section, so the
        # index block would be redundant) plus every path that
        # has graduated into a cached tier as a file: item (full
        # content present in that tier, so neither the active
        # section NOR the main symbol map should render it).
        exclude_files: set[str] = set(self._selected_files)
        for tier_name in ("L0", "L1", "L2", "L3"):
            tier = tiered_content.get(tier_name) or {}
            for path in tier.get("graduated_files", ()) or ():
                exclude_files.add(path)

        symbol_map = ""
        symbol_legend = ""
        if self._symbol_index is not None:
            symbol_map = self._symbol_index.get_symbol_map(
                exclude_files=exclude_files
            )
            symbol_legend = self._symbol_index.get_legend()

        # Doc legend — emitted when the doc index contributes to
        # the prompt. Two cases per specs4/3-llm/modes.md and
        # specs4/3-llm/prompt-assembly.md § "Cross-Reference
        # Legend Headers":
        #
        # - Doc mode (primary): legend flows to the context
        #   manager as the *primary* legend via symbol_legend.
        #   The context manager's assembler picks the mode-
        #   appropriate header (DOC_MAP_HEADER) based on
        #   self._context.mode.
        # - Code mode + cross-reference: doc is the *secondary*
        #   index; the assembler places it under the opposite
        #   mode's header (DOC_MAP_HEADER).
        #
        # We compute doc_legend unconditionally when the doc
        # index has any outlines, but only pass it through when
        # doc mode is active or cross-reference is enabled. In
        # code mode without cross-ref, the doc legend would be
        # noise — suppress it.
        #
        # In doc mode, the context manager's mode flag causes
        # the assembler to use DOC_MAP_HEADER for symbol_legend
        # (which is misnamed historically but correct in the
        # primary slot). The doc legend goes to doc_legend only
        # for cross-ref scenarios.
        doc_legend = ""
        if self._context.mode == Mode.DOC:
            # Doc mode primary: swap the legends so the primary
            # slot carries the doc legend.
            doc_legend_text = self._doc_index.get_legend()
            symbol_legend = doc_legend_text
            # In cross-reference mode, the symbol index's legend
            # becomes the *secondary* and goes to doc_legend
            # (which the assembler routes under REPO_MAP_HEADER,
            # the opposite of the current mode's primary).
            if self._cross_ref_enabled and self._symbol_index is not None:
                doc_legend = self._symbol_index.get_legend()
        elif self._cross_ref_enabled:
            # Code mode + cross-ref: symbol legend stays primary;
            # doc legend is secondary.
            doc_legend = self._doc_index.get_legend()

        # File tree — the flat repo listing, rendered in its own
        # uncached user/assistant pair by the assembler.
        file_tree = ""
        if self._repo is not None:
            try:
                file_tree = self._repo.get_flat_file_list()
            except Exception as exc:
                logger.warning(
                    "Failed to fetch file tree for prompt: %s", exc
                )

        return self._context.assemble_tiered_messages(
            user_prompt=augmented_prompt,
            images=images if images else None,
            symbol_map=symbol_map,
            symbol_legend=symbol_legend,
            doc_legend=doc_legend,
            file_tree=file_tree,
            tiered_content=tiered_content,
        )

    # ------------------------------------------------------------------
    # Message assembly (flat — fallback during startup window)
    # ------------------------------------------------------------------

    def _assemble_messages_flat(
        self,
        user_prompt: str,
        images: list[str],
    ) -> list[dict[str, Any]]:
        """Build a flat message array for the LLM call.

        Fallback path used when the stability tracker hasn't
        been initialised yet. Produces a system prompt + repo
        context + history + user prompt sequence with no
        cache-control markers.

        This path must still include the user's selected-file
        content, the symbol map, the file tree, and URL/review
        context — otherwise an uninitialised tracker (no symbol
        index attached, or init failed silently) produces a
        context-free prompt and the LLM has no view of the repo.
        Without this the user's selection is silently dropped
        on every flat-mode request.
        """
        system_prompt = self._context.get_system_prompt()
        reminder = self._config.get_system_reminder()
        augmented_prompt = user_prompt + (reminder or "")

        # Assemble a repo-context block: system prompt followed
        # by map/legend, file tree, URL/review context, and
        # active-file contents. All uncached (flat path has no
        # tier structure) and concatenated into a single system-
        # message body.
        system_parts: list[str] = [system_prompt]

        # Symbol map + legend (mode-aware header).
        if self._symbol_index is not None:
            try:
                legend = self._symbol_index.get_legend()
                symbol_map = self._symbol_index.get_symbol_map(
                    exclude_files=set(self._selected_files)
                )
                if legend or symbol_map:
                    from ac_dc.context_manager import (
                        DOC_MAP_HEADER,
                        REPO_MAP_HEADER,
                    )
                    header = (
                        DOC_MAP_HEADER
                        if self._context.mode == Mode.DOC
                        else REPO_MAP_HEADER
                    )
                    system_parts.append(header + legend)
                    if symbol_map:
                        system_parts.append(symbol_map)
            except Exception as exc:
                logger.warning(
                    "Flat assembly: symbol map fetch failed: %s",
                    exc,
                )

        # File tree.
        if self._repo is not None:
            try:
                file_tree = self._repo.get_flat_file_list()
                if file_tree:
                    from ac_dc.context_manager import FILE_TREE_HEADER
                    system_parts.append(FILE_TREE_HEADER + file_tree)
            except Exception as exc:
                logger.warning(
                    "Flat assembly: file tree fetch failed: %s",
                    exc,
                )

        # URL context.
        url_parts = self._context.get_url_context()
        if url_parts:
            from ac_dc.context_manager import URL_CONTEXT_HEADER
            system_parts.append(
                URL_CONTEXT_HEADER + "\n---\n".join(url_parts)
            )

        # Review context.
        review = self._context.get_review_context()
        if review:
            from ac_dc.context_manager import REVIEW_CONTEXT_HEADER
            system_parts.append(REVIEW_CONTEXT_HEADER + review)

        # Active files — full content of everything the user
        # selected. This is the load-bearing piece that was
        # missing. Without it, flat mode silently forgets the
        # selection every request.
        file_body = self._file_context.format_for_prompt()
        if file_body:
            from ac_dc.context_manager import FILES_ACTIVE_HEADER
            system_parts.append(FILES_ACTIVE_HEADER + file_body)

        combined_system = "\n\n".join(p for p in system_parts if p)

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": combined_system},
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
        and missing files are skipped — but NOT silently. Each
        failure logs at WARNING so the user can see which files
        their selection isn't actually getting.

        Historical note: failures here used to log at DEBUG,
        which hid a common class of bug where a file appeared
        in the file picker AND in the cache viewer (because an
        earlier request's stale `file:` tracker entry lingered)
        but never reached the LLM's prompt because its content
        couldn't be read. The silent-debug behaviour made the
        divergence invisible — user sees "file is in context"
        everywhere in the UI, LLM sees nothing. Surface the
        reason at WARNING so the log tells the true story.

        Invalidation contract: this method only adds files in
        ``selected - current`` and removes files in ``current -
        selected``. It does NOT refresh content for files
        already present. Refresh happens in two places:

        - After our own edits: ``_build_completion_result``
          re-reads every file in ``report.files_modified`` so
          the next turn sees post-edit content.
        - After external edits (user edits in another editor,
          saves, then asks the model to continue): currently
          NOT handled. The stability tracker's content-hash
          check in ``_update_stability`` detects the disk
          change and rebalances tiers, but the ``FileContext``
          cache keeps the pre-edit snapshot. Known hole;
          workaround is to deselect + reselect the file, which
          forces a re-read via ``selected - current``.
        """
        current = set(self._file_context.get_files())
        selected = set(self._selected_files)

        # Remove files no longer selected.
        for path in current - selected:
            self._file_context.remove_file(path)

        # Add newly-selected files. Use the Repo to read. Errors
        # are logged at WARNING rather than silently swallowed —
        # a user whose selected file isn't reaching the LLM
        # deserves to see why in the terminal.
        for path in selected - current:
            if self._repo is None:
                continue
            try:
                self._file_context.add_file(path)
            except Exception as exc:
                logger.warning(
                    "Selected file %s could not be loaded "
                    "into context: %s. The LLM will NOT see "
                    "this file's content until the error is "
                    "resolved.",
                    path, exc,
                )

    # ------------------------------------------------------------------
    # Post-response processing
    # ------------------------------------------------------------------

    async def _post_response(self, request_id: str) -> None:
        """Stability tracker update, compaction, terminal HUD."""
        # Stability update — builds the full active items list
        # and runs the tracker update cycle.
        self._update_stability()

        # Print terminal HUD — three sections per specs3.
        self._print_post_response_hud()

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
                # Capture pre-compaction message count BEFORE
                # set_history replaces the list so the system
                # event can report "removed N messages". The
                # pre-compaction token count is `tokens` from
                # the top of this method.
                messages_before_count = len(
                    self._context.get_history()
                )
                # Replace history + purge tracker history entries
                # (compacted messages re-enter as fresh active
                # items on the next request).
                self._context.set_history(result.messages)
                self._stability_tracker.purge_history()
                # Append a system-event message so users see the
                # compaction in their chat scrollback, and the
                # history browser can search + display past
                # compactions. Mirrors the commit_all / reset flow
                # — context first (so the LLM's next request sees
                # it as part of history), then history store
                # (JSONL persistence), then broadcast (frontend
                # gets the compacted list with the event already
                # attached).
                try:
                    tokens_after = (
                        self._context.history_token_count()
                    )
                    event_text = _build_compaction_event_text(
                        result,
                        tokens_before=tokens,
                        tokens_after=tokens_after,
                        messages_before_count=messages_before_count,
                        messages_after_count=len(result.messages),
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
                except Exception:
                    logger.exception(
                        "Failed to append compaction system event"
                    )
                # Re-read the final message list from context so
                # the broadcast includes the system event we just
                # appended. Without this, the frontend would
                # receive the pre-event list and the event would
                # only appear on next session reload.
                await self._broadcast_event_async(
                    "compactionEvent",
                    request_id,
                    {
                        "stage": "compacted",
                        "case": result.case,
                        "messages": self._context.get_history(),
                    },
                )

    def _update_stability(self) -> None:
        """Build active items and run the tracker update.

        Full implementation per specs4/3-llm/streaming.md —
        _update_stability pseudocode. Builds the active-items dict
        from all content categories (system prompt, selected files,
        index entries for non-selected files, cross-reference items,
        history messages), removes user-excluded items, and runs
        the tracker update with the current repo file set for
        stale-removal.

        Order of operations (from specs-reference/3-llm/
        streaming.md § Order of Operations (Per Request)):

        0a. Defensive removal of user-excluded files from the
            tracker. set_excluded_index_files does a one-shot
            removal when the exclusion set changes, but the
            file could be re-indexed in the interim (index
            repo walk, rebuild, cross-ref enable). Running
            the removal at the top of every cycle catches
            that drift and honours the specs3 belt-and-
            suspenders contract.
        0b. System prompt + legend — always present, should
           stabilize to L0. Hash only the prompt text (not legend)
           for stability — the legend includes path aliases that
           change with exclude_files. Token count includes both.
        1. Selected files — full content hash.
        2. Remove symbol/doc entries for selected files from the
           tracker (full content present → index block redundant).
        3. Index entries for ALL indexed files NOT in selected
           files (tracked for stability; appear in the main
           symbol map or in cached tiers).
        4. Cross-reference items when cross-ref mode is enabled.
        5. History messages.
        6. Run tracker.update().
        """
        # Step 0a — defensive excluded-files removal. Runs
        # BEFORE active_items construction so an excluded file
        # can't be re-registered as a fresh active entry below.
        excluded = getattr(self, "_excluded_index_files", None) or ()
        for path in excluded:
            for prefix in ("symbol:", "doc:", "file:"):
                entry_key = prefix + path
                existing = self._stability_tracker._items.get(entry_key)
                if existing is not None:
                    self._stability_tracker._broken_tiers.add(existing.tier)
                    self._stability_tracker._items.pop(entry_key, None)

        active_items: dict[str, dict[str, Any]] = {}

        # Step 0 — System prompt + legend.
        # Hash only the system prompt text for stability (legend
        # includes path aliases that change when file selections
        # change, which would prevent the prompt from stabilizing).
        # Token count includes both prompt + legend.
        if self._context.mode == Mode.DOC:
            system_prompt = self._config.get_doc_system_prompt()
        else:
            system_prompt = self._config.get_system_prompt()
        if system_prompt:
            legend = ""
            if self._symbol_index is not None:
                try:
                    legend = self._symbol_index.get_legend()
                except Exception:
                    pass
            system_content = system_prompt + legend
            prompt_hash = hashlib.sha256(
                system_prompt.encode("utf-8")
            ).hexdigest()
            active_items["system:prompt"] = {
                "hash": prompt_hash,
                "tokens": self._counter.count(system_content),
            }

        # Step 1 — Selected files: full content hash.
        for path in self._selected_files:
            content = self._file_context.get_content(path)
            if content:
                h = hashlib.sha256(
                    content.encode("utf-8")
                ).hexdigest()
                active_items[f"file:{path}"] = {
                    "hash": h,
                    "tokens": self._counter.count(content),
                }

        # Step 2 — Remove symbol/doc entries for selected files
        # from the tracker. Selected files have full content in
        # context — their index blocks are redundant. Both symbol:
        # and doc: entries are removed (handles cross-reference
        # mode correctly). Affected tiers are marked as broken.
        for path in self._selected_files:
            for prefix in ("symbol:", "doc:"):
                entry_key = prefix + path
                if self._stability_tracker.has_item(entry_key):
                    # Get the item's tier before removing it.
                    all_items = self._stability_tracker.get_all_items()
                    item = all_items.get(entry_key)
                    if item is not None:
                        tier = item.tier
                        # Remove by directly manipulating the
                        # tracker's internal state. The tracker
                        # doesn't expose a remove method, so we
                        # use the same approach as the test suite:
                        # delete from _items and mark tier broken.
                        self._stability_tracker._items.pop(entry_key, None)
                        self._stability_tracker._broken_tiers.add(tier)

        # Step 3 — Primary index entries for ALL indexed files
        # NOT in selected files AND NOT in excluded files. These
        # are symbol/doc blocks for the structural map. They are
        # tracked for stability but NOT rendered separately —
        # they appear in the main symbol map or are in cached
        # tiers.
        #
        # Mode dispatch: code mode → symbol: entries, doc mode →
        # doc: entries. Both modes use the same tracker slot for
        # the primary index; cross-reference (step 4) adds the
        # opposite mode's entries on top.
        #
        # Use signature hash (from raw data) rather than hashing
        # the formatted block — formatted output changes when
        # path aliases or exclude_files change, causing spurious
        # hash mismatches.
        selected_set = set(self._selected_files)
        excluded_set = set(excluded)
        if self._context.mode == Mode.DOC:
            # Doc mode primary: iterate doc index outlines.
            for path in list(self._doc_index._all_outlines.keys()):
                if path in selected_set or path in excluded_set:
                    continue
                block = self._doc_index.get_file_doc_block(path)
                if not block:
                    continue
                sig_hash = self._doc_index.get_signature_hash(path)
                active_items[f"doc:{path}"] = {
                    "hash": sig_hash or hashlib.sha256(
                        block.encode("utf-8")
                    ).hexdigest(),
                    "tokens": self._counter.count(block),
                }
        else:
            # Code mode primary: iterate symbol index.
            if self._symbol_index is not None:
                for path in list(self._symbol_index._all_symbols.keys()):
                    if path in selected_set or path in excluded_set:
                        continue
                    block = self._symbol_index.get_file_symbol_block(path)
                    if not block:
                        continue
                    sig_hash = self._symbol_index.get_signature_hash(path)
                    active_items[f"symbol:{path}"] = {
                        "hash": sig_hash or hashlib.sha256(
                            block.encode("utf-8")
                        ).hexdigest(),
                        "tokens": self._counter.count(block),
                    }

        # Step 4 — Cross-reference items (when cross-ref enabled).
        # Adds the *opposite* index's entries so both indexes
        # contribute to the prompt. The tier dispatch (already
        # in place) renders doc: and symbol: items uniformly in
        # their tier's `symbols` field; this step just ensures
        # both prefixes end up in active_items so the tracker
        # updates stability counts for them.
        #
        # In code mode + cross-ref: add doc: entries (doc index
        # becomes the secondary index).
        # In doc mode + cross-ref: add symbol: entries (symbol
        # index becomes the secondary).
        # Selected files excluded from both to honour the
        # "never appears twice" invariant — their full content
        # is already in the active "Working Files" section.
        if self._cross_ref_enabled:
            if self._context.mode == Mode.CODE:
                # Add doc: entries as secondary.
                for path in list(
                    self._doc_index._all_outlines.keys()
                ):
                    if path in selected_set or path in excluded_set:
                        continue
                    block = self._doc_index.get_file_doc_block(path)
                    if not block:
                        continue
                    sig_hash = self._doc_index.get_signature_hash(path)
                    active_items[f"doc:{path}"] = {
                        "hash": sig_hash or hashlib.sha256(
                            block.encode("utf-8")
                        ).hexdigest(),
                        "tokens": self._counter.count(block),
                    }
            else:
                # Doc mode + cross-ref: add symbol: as secondary.
                if self._symbol_index is not None:
                    for path in list(
                        self._symbol_index._all_symbols.keys()
                    ):
                        if path in selected_set or path in excluded_set:
                            continue
                        block = self._symbol_index.get_file_symbol_block(
                            path
                        )
                        if not block:
                            continue
                        sig_hash = self._symbol_index.get_signature_hash(
                            path
                        )
                        active_items[f"symbol:{path}"] = {
                            "hash": sig_hash or hashlib.sha256(
                                block.encode("utf-8")
                            ).hexdigest(),
                            "tokens": self._counter.count(block),
                        }

        # Step 5 — History messages (all — the tracker handles
        # graduated history internally via its own tier checks).
        history = self._context.get_history()
        for i, msg in enumerate(history):
            role = msg.get("role", "user")
            content = msg.get("content", "") or ""
            if not isinstance(content, str):
                content = str(content)
            h = hashlib.sha256(
                f"{role}:{content}".encode("utf-8")
            ).hexdigest()
            active_items[f"history:{i}"] = {
                "hash": h,
                "tokens": self._counter.count(msg),
            }

        # Step 6 — Run tracker update. Pass existing_files so
        # Phase 0 stale removal works. (Defensive excluded-
        # files removal now happens in step 0a above; nothing
        # further needed here.)
        existing_files: set[str] | None = None
        if self._repo is not None:
            try:
                flat = self._repo.get_flat_file_list()
                existing_files = set(flat.split("\n")) if flat else set()
            except Exception:
                pass
        self._stability_tracker.update(
            active_items, existing_files=existing_files
        )

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
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted
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

            # Signal the picker to reload. A commit doesn't
            # touch working-tree content but flips every
            # staged file's status badge (S → clean), and
            # previously-clean files may have become
            # untracked if the commit wasn't `stage_all`.
            # The picker's tree reload via Repo.get_file_tree
            # is the only way to surface the new status.
            self._broadcast_event("filesModified", [])
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

        # Smaller model gets its own counter for ceiling lookup —
        # its max_output_tokens differs from the primary model's
        # (smaller Claude family members have the same 64K
        # ceiling as larger ones, but older auxiliary models
        # could have smaller ceilings in future). The config
        # override applies across all calls.
        aux_counter = TokenCounter(self._config.smaller_model)
        max_output = _resolve_max_output_tokens(
            self._config, aux_counter
        )

        def _call() -> str:
            try:
                response = litellm.completion(
                    model=self._config.smaller_model,
                    messages=[
                        {"role": "system", "content": prompt},
                        {"role": "user", "content": diff},
                    ],
                    stream=False,
                    max_tokens=max_output,
                )
                return response.choices[0].message.content or ""
            except Exception as exc:
                # Aux calls fail silently with an empty string —
                # the outer caller substitutes a default commit
                # message. Classify the error for the log line
                # so operators can see WHY the aux call failed
                # (rate-limit vs auth vs context overflow all
                # manifest as "generation failed" without this).
                info = LLMService._classify_litellm_error(
                    litellm, exc
                )
                logger.warning(
                    "Commit message generation failed: "
                    "type=%s provider=%s model=%s msg=%s",
                    info.get("error_type"),
                    info.get("provider"),
                    info.get("model"),
                    info.get("message"),
                )
                return ""

        return await loop.run_in_executor(self._aux_executor, _call)

    def reset_to_head(self) -> dict[str, Any]:
        """Discard uncommitted changes, record a system event."""
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted
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

        # Every staged / modified / untracked file reverted
        # to HEAD or was deleted. The picker must reload to
        # reflect the wholesale status change — without this,
        # modified-file badges linger on files that are now
        # clean on disk.
        self._broadcast_event("filesModified", [])

        return {
            "status": "ok",
            "system_event_message": event_text,
        }

    # ------------------------------------------------------------------
    # Event broadcast
    # ------------------------------------------------------------------

    def _broadcast_enrichment_status(self) -> None:
        """Broadcast a modeChanged event with the current enrichment status.

        Piggybacks on the existing modeChanged channel so the
        frontend's one-time "unavailable" toast can fire even
        when the status flips mid-session (e.g., the user
        reloads the browser during a build that subsequently
        fails at the model-load step).

        The payload carries the current mode and cross-reference
        state alongside the enrichment status, so the frontend's
        modeChanged handler (which also routes this event) sees
        a consistent snapshot. No mode change actually occurs —
        the handler's same-mode short-circuit applies, so
        cross-reference state is preserved.
        """
        self._broadcast_event(
            "modeChanged",
            {
                "mode": self._context.mode.value,
                "cross_ref_enabled": self._cross_ref_enabled,
                "enrichment_status": self._enrichment_status,
            },
        )

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

    def get_session_totals(self) -> dict[str, Any]:
        """Return a copy of cumulative session token usage and cost.

        Value types are mixed — token counts are ints, cost is
        a float, and the priced/unpriced counts are ints.
        Callers receive a defensive copy.
        """
        return dict(self._session_totals)