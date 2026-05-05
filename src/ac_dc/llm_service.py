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
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Awaitable, Callable, Optional

from ac_dc.agent_factory import build_agent_context_manager
from ac_dc.context_manager import ContextManager, Mode
from ac_dc.doc_index.index import DocIndex
from ac_dc.doc_index.keyword_enricher import (
    EnrichmentConfig,
    KeywordEnricher,
)
from ac_dc.edit_pipeline import EditPipeline
from ac_dc.edit_protocol import (
    AgentBlock,
    EditResult,
    EditStatus,
    detect_shell_commands,
    parse_text,
)
from ac_dc.file_context import FileContext
from ac_dc.history_compactor import HistoryCompactor, TopicBoundary
from ac_dc.llm._helpers import (
    _build_compaction_event_text,
    _build_topic_detector,
    _classify_litellm_error,
    _extract_finish_reason,
    _extract_response_cost,
    _generate_request_id,
    _parse_agent_tag,
    _resolve_max_output_tokens,
)
from ac_dc.llm._types import (
    ArchivalAppend,
    ConversationScope,
    EventCallback,
    _AUX_EXECUTOR_WORKERS,
    _DETECTOR_MAX_MESSAGES,
    _DETECTOR_MSG_TRUNCATE_CHARS,
    _STREAM_EXECUTOR_WORKERS,
    _TIER_CONFIG_LOOKUP,
    _URL_PER_MESSAGE_LIMIT,
)
from ac_dc.stability_tracker import StabilityTracker, Tier, _TIER_CONFIG
from ac_dc.token_counter import TokenCounter
from ac_dc.url_service import URLCache, URLService

if TYPE_CHECKING:
    from ac_dc.config import ConfigManager
    from ac_dc.history_store import HistoryStore
    from ac_dc.repo import Repo
    from ac_dc.symbol_index.index import SymbolIndex

logger = logging.getLogger(__name__)


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
        # Per-agent active stream tracking (C1c). Keyed by the
        # ``(turn_id, agent_idx)`` tuple that tags an agent-
        # conversation stream. An entry being present means that
        # agent currently has a stream in flight; a second
        # ``chat_streaming`` call with the same agent_tag while
        # this entry is set returns the "another stream is
        # active" error (per-agent, not per-session).
        #
        # Lives alongside ``_active_user_request`` rather than
        # replacing it because the two slots enforce different
        # mutual-exclusion rules:
        #
        # - ``_active_user_request`` — single-stream guard for the
        #   main user-facing session. Untagged ``chat_streaming``
        #   calls gate on this.
        # - ``_active_agent_streams`` — per-agent single-stream
        #   guard. Agent-tagged calls gate on this instead, so a
        #   user typing into the main tab AND an agent tab sees
        #   both streams proceed in parallel.
        #
        # Cleared in the background task's finally block, same
        # pattern as ``_active_user_request``.
        self._active_agent_streams: set[tuple[str, int]] = set()
        # Cancellation flags keyed by request ID. Populated by
        # cancel_streaming; the worker thread polls and breaks out
        # when it finds its ID.
        self._cancelled_requests: set[str] = set()
        # Per-request accumulated response content, keyed by
        # request ID. The worker thread populates this on every
        # chunk so the event loop thread (or a future agent-
        # spawning path) can read an in-flight stream's current
        # output without racing against the worker's local
        # ``full_content`` variable. Cleared in the background
        # task's finally block.
        #
        # Per specs4/7-future/parallel-agents.md § Foundation
        # Requirements ("Chunk routing keyed by request ID, not
        # by singleton flag"), the accumulator must be keyed by
        # request ID so N concurrent streams — one main LLM
        # stream plus any child agent streams — can coexist.
        # Today only the main LLM stream populates an entry; when
        # agent spawning lands, each agent's child request gets
        # its own slot and the main LLM's synthesis step reads
        # them all via this dict.
        #
        # Entries outlive ``_run_completion_sync`` by a short
        # window — the worker returns via run_in_executor and
        # then ``_stream_chat`` builds the completion result,
        # persists the assistant message, and runs post-response
        # work. The finally block clears the slot at the same
        # point that clears ``_active_user_request``, so the
        # accumulator's lifetime matches the "stream is active"
        # signal.
        self._request_accumulators: dict[str, str] = {}

        # Agent context registry — per-turn, per-agent
        # ConversationScope storage so the scopes outlive the
        # spawn's ``asyncio.gather`` and remain reachable for
        # follow-up user replies to the agent tab.
        #
        # Keyed ``{turn_id: {agent_idx: ConversationScope}}``.
        # Nested shape (rather than flat tuple keys) makes
        # per-turn invalidation cleanly expressible —
        # ``new_session()`` wipes the whole dict, and
        # ``close_agent_context(turn_id, agent_idx)`` pops the
        # inner entry plus the outer dict when it empties.
        #
        # Populated in :meth:`_build_agent_scope` — the single
        # chokepoint for agent scope construction. Today the
        # spawn path (:meth:`_spawn_agents_for_turn`) builds a
        # scope and immediately feeds it to
        # :attr:`_agent_stream_impl`; the scope becomes
        # garbage-collectable when the gathered task returns.
        # Registering here keeps a reference alive so the main
        # LLM's follow-up turns can route user replies back to
        # the same ContextManager + StabilityTracker + file
        # context — the agent's conversation state stays warm,
        # the provider cache stays warm, and iteration within
        # the turn is cheap.
        #
        # Cleared wholesale by :meth:`new_session`. Agents from
        # prior sessions have no meaningful way to continue
        # into a new session's conversation, so the whole
        # registry resets. Per-entry removal is C1b's
        # ``close_agent_context`` RPC (agent-tab close button).
        self._agent_contexts: dict[
            str, dict[int, ConversationScope]
        ] = {}

        # Agent streaming impl — points at :meth:`_stream_chat`
        # so each spawned agent runs through the full pipeline
        # (LLM call, edit parse, edit apply, persistence,
        # post-response stability update). Tests can override
        # this attribute to install a recorder or a stub for
        # observability without patching `asyncio.ensure_future`
        # or the worker executor. Must be an async callable
        # matching ``_stream_chat``'s signature.
        #
        # Step 3 of the agent-spawning plan flipped this from
        # the stub (:meth:`_stream_chat_stub`) to the real
        # streaming method. The stub remains in the codebase
        # for tests that want a trivial no-op impl; production
        # paths never reach it.
        self._agent_stream_impl: Callable[..., Awaitable[Any]] = (
            self._stream_chat
        )

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
        """Delegate to :func:`ac_dc.llm._doc_index_background.build_doc_index_background`."""
        from ac_dc.llm._doc_index_background import (
            build_doc_index_background,
        )
        await build_doc_index_background(self)

    def _build_enrichment_config(self) -> EnrichmentConfig:
        """Delegate to :func:`ac_dc.llm._doc_index_background.build_enrichment_config`."""
        from ac_dc.llm._doc_index_background import (
            build_enrichment_config,
        )
        return build_enrichment_config(self)

    async def _run_enrichment_background(self) -> None:
        """Delegate to :func:`ac_dc.llm._doc_index_background.run_enrichment_background`."""
        from ac_dc.llm._doc_index_background import (
            run_enrichment_background,
        )
        await run_enrichment_background(self)

    def _enrich_one_file_sync(self, rel_path: str) -> None:
        """Delegate to :func:`ac_dc.llm._doc_index_background.enrich_one_file_sync`."""
        from ac_dc.llm._doc_index_background import (
            enrich_one_file_sync,
        )
        enrich_one_file_sync(self, rel_path)

    def _on_doc_file_written(self, rel_path: str) -> None:
        """Delegate to :func:`ac_dc.llm._doc_index_background.on_doc_file_written`."""
        from ac_dc.llm._doc_index_background import (
            on_doc_file_written,
        )
        on_doc_file_written(self, rel_path)

    async def _enrich_written_file(self, rel_path: str) -> None:
        """Delegate to :func:`ac_dc.llm._doc_index_background.enrich_written_file`."""
        from ac_dc.llm._doc_index_background import (
            enrich_written_file,
        )
        await enrich_written_file(self, rel_path)

    async def _send_doc_index_progress(
        self,
        stage: str,
        message: str,
        percent: int,
    ) -> None:
        """Delegate to :func:`ac_dc.llm._doc_index_background.send_doc_index_progress`."""
        from ac_dc.llm._doc_index_background import (
            send_doc_index_progress,
        )
        await send_doc_index_progress(self, stage, message, percent)

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
        """Delegate to :func:`ac_dc.llm._construction.build_url_service`."""
        from ac_dc.llm._construction import build_url_service
        return build_url_service(self)

    # ------------------------------------------------------------------
    # Session restore
    # ------------------------------------------------------------------

    def _restore_last_session(self) -> None:
        """Delegate to :func:`ac_dc.llm._construction.restore_last_session`."""
        from ac_dc.llm._construction import restore_last_session
        restore_last_session(self)

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
        """Delegate to :func:`ac_dc.llm._rpc_urls.detect_urls`."""
        from ac_dc.llm._rpc_urls import detect_urls
        return detect_urls(self, text)

    async def fetch_url(
        self,
        url: str,
        use_cache: bool = True,
        summarize: bool = True,
        user_text: str | None = None,
    ) -> dict[str, Any]:
        """Delegate to :func:`ac_dc.llm._rpc_urls.fetch_url`."""
        from ac_dc.llm._rpc_urls import fetch_url
        return await fetch_url(
            self, url, use_cache, summarize, user_text
        )

    async def detect_and_fetch(
        self,
        text: str,
        use_cache: bool = True,
        summarize: bool = True,
    ) -> list[dict[str, Any]] | dict[str, Any]:
        """Delegate to :func:`ac_dc.llm._rpc_urls.detect_and_fetch`."""
        from ac_dc.llm._rpc_urls import detect_and_fetch
        return await detect_and_fetch(
            self, text, use_cache, summarize
        )

    def get_url_content(self, url: str) -> dict[str, Any]:
        """Delegate to :func:`ac_dc.llm._rpc_urls.get_url_content`."""
        from ac_dc.llm._rpc_urls import get_url_content
        return get_url_content(self, url)

    def invalidate_url_cache(self, url: str) -> dict[str, Any]:
        """Delegate to :func:`ac_dc.llm._rpc_urls.invalidate_url_cache`."""
        from ac_dc.llm._rpc_urls import invalidate_url_cache
        return invalidate_url_cache(self, url)

    def remove_fetched_url(self, url: str) -> dict[str, Any]:
        """Delegate to :func:`ac_dc.llm._rpc_urls.remove_fetched_url`."""
        from ac_dc.llm._rpc_urls import remove_fetched_url
        return remove_fetched_url(self, url)

    def clear_url_cache(self) -> dict[str, Any]:
        """Delegate to :func:`ac_dc.llm._rpc_urls.clear_url_cache`."""
        from ac_dc.llm._rpc_urls import clear_url_cache
        return clear_url_cache(self)

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
        """Return whether the working tree is clean enough for review."""
        from ac_dc.llm._review import check_review_ready
        return check_review_ready(self)

    def get_commit_graph(
        self,
        limit: int = 100,
        offset: int = 0,
        include_remote: bool = False,
    ) -> dict[str, Any]:
        """Return commit graph data for the review selector."""
        from ac_dc.llm._review import get_commit_graph
        return get_commit_graph(
            self,
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

        Runs the full entry sequence; delegates to
        :func:`ac_dc.llm._review.start_review` which owns the
        step-by-step pipeline.
        """
        from ac_dc.llm._review import start_review
        return start_review(self, branch, base_commit)

    def end_review(self) -> dict[str, Any]:
        """Exit review mode, restoring the pre-review git state."""
        from ac_dc.llm._review import end_review
        return end_review(self)

    def get_review_state(self) -> dict[str, Any]:
        """Return the current review state (copy, no symbol map)."""
        from ac_dc.llm._review import get_review_state
        return get_review_state(self)

    def get_review_file_diff(self, path: str) -> dict[str, Any]:
        """Return the reverse diff for a single file during review."""
        from ac_dc.llm._review import get_review_file_diff
        return get_review_file_diff(self, path)

    @staticmethod
    def _compute_review_stats(
        commits: list[dict[str, Any]],
        changed_files: list[dict[str, Any]],
    ) -> dict[str, int]:
        """Compute aggregate stats for the review state."""
        from ac_dc.llm._review import _compute_review_stats
        return _compute_review_stats(commits, changed_files)

    def _build_and_set_review_context(
        self,
        scope: ConversationScope | None = None,
    ) -> None:
        """Build the review context block and attach to context manager."""
        from ac_dc.llm._review import build_and_set_review_context
        build_and_set_review_context(self, scope)

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
        """Delegate to :func:`ac_dc.llm._rpc_state.set_selected_files`."""
        from ac_dc.llm._rpc_state import set_selected_files
        return set_selected_files(self, files)

    def get_selected_files(self) -> list[str]:
        """Delegate to :func:`ac_dc.llm._rpc_state.get_selected_files`."""
        from ac_dc.llm._rpc_state import get_selected_files
        return get_selected_files(self)

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
    ) -> list[str] | dict[str, Any]:
        """Delegate to :func:`ac_dc.llm._rpc_state.set_excluded_index_files`."""
        from ac_dc.llm._rpc_state import set_excluded_index_files
        return set_excluded_index_files(self, files)

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
        """Delegate to :func:`ac_dc.llm._rpc_history.history_search`."""
        from ac_dc.llm._rpc_history import history_search
        return history_search(self, query, role, limit)

    def history_list_sessions(
        self, limit: int | None = None
    ) -> list[dict[str, Any]]:
        """Delegate to :func:`ac_dc.llm._rpc_history.history_list_sessions`."""
        from ac_dc.llm._rpc_history import history_list_sessions
        return history_list_sessions(self, limit)

    def history_get_session(
        self, session_id: str
    ) -> list[dict[str, Any]]:
        """Delegate to :func:`ac_dc.llm._rpc_history.history_get_session`."""
        from ac_dc.llm._rpc_history import history_get_session
        return history_get_session(self, session_id)

    def get_turn_archive(
        self, turn_id: str
    ) -> list[dict[str, Any]]:
        """Delegate to :func:`ac_dc.llm._rpc_history.get_turn_archive`."""
        from ac_dc.llm._rpc_history import get_turn_archive
        return get_turn_archive(self, turn_id)

    def load_session_into_context(
        self, session_id: str
    ) -> dict[str, Any]:
        """Delegate to :func:`ac_dc.llm._rpc_history.load_session_into_context`."""
        from ac_dc.llm._rpc_history import load_session_into_context
        return load_session_into_context(self, session_id)

    def history_new_session(self) -> dict[str, Any]:
        """Create a new history session (alias for new_session)."""
        return self.new_session()

    def get_history_status(self) -> dict[str, Any]:
        """Delegate to :func:`ac_dc.llm._rpc_history.get_history_status`."""
        from ac_dc.llm._rpc_history import get_history_status
        return get_history_status(self)

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
        """Delegate to :func:`ac_dc.llm._breakdown.get_file_map_block`.

        Public RPC surface — the browser's cache viewer
        calls this via jrpc-oo when the user clicks a row.
        """
        from ac_dc.llm._breakdown import get_file_map_block
        return get_file_map_block(self, path)

    def _wide_map_exclude_set(self) -> set[str]:
        """Delegate to :func:`ac_dc.llm._breakdown.wide_map_exclude_set`.

        Kept as a thin method so internal callers
        (``_get_meta_block``, ``get_context_breakdown``,
        ``_assemble_tiered``) continue to use the familiar
        ``self._wide_map_exclude_set()`` form.
        """
        from ac_dc.llm._breakdown import wide_map_exclude_set
        return wide_map_exclude_set(self)

    def _get_meta_block(self, key: str) -> dict[str, Any]:
        """Delegate to :func:`ac_dc.llm._breakdown.get_meta_block`.

        Internal-only method; called from ``get_file_map_block``
        when the requested path starts with the ``meta:`` prefix.
        """
        from ac_dc.llm._breakdown import get_meta_block
        return get_meta_block(self, key)

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

    def refresh_system_prompt(self) -> dict[str, Any]:
        """Delegate to :func:`ac_dc.llm._rpc_state.refresh_system_prompt`."""
        from ac_dc.llm._rpc_state import refresh_system_prompt
        return refresh_system_prompt(self)

    def switch_mode(self, mode: str) -> dict[str, Any]:
        """Delegate to :func:`ac_dc.llm._rpc_state.switch_mode`."""
        from ac_dc.llm._rpc_state import switch_mode
        return switch_mode(self, mode)

    def set_cross_reference(self, enabled: bool) -> dict[str, Any]:
        """Delegate to :func:`ac_dc.llm._rpc_state.set_cross_reference`."""
        from ac_dc.llm._rpc_state import set_cross_reference
        return set_cross_reference(self, enabled)

    def _seed_cross_reference_items(self) -> None:
        """Delegate to :func:`ac_dc.llm._stability.seed_cross_reference_items`."""
        from ac_dc.llm._stability import seed_cross_reference_items
        seed_cross_reference_items(self)

    def _remove_cross_reference_items(self) -> None:
        """Delegate to :func:`ac_dc.llm._stability.remove_cross_reference_items`."""
        from ac_dc.llm._stability import remove_cross_reference_items
        remove_cross_reference_items(self)

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
        from ac_dc.llm._rebuild import rebuild_cache
        return rebuild_cache(self)

    def _rebuild_cache_impl(self) -> dict[str, Any]:
        """Delegate to :func:`ac_dc.llm._rebuild.rebuild_cache_impl`."""
        from ac_dc.llm._rebuild import rebuild_cache_impl
        return rebuild_cache_impl(self)

    def _distribute_orphan_files(
        self, orphan_paths: list[str]
    ) -> None:
        """Delegate to :func:`ac_dc.llm._rebuild.distribute_orphan_files`."""
        from ac_dc.llm._rebuild import distribute_orphan_files
        distribute_orphan_files(self, orphan_paths)

    def _rebuild_graduate_history(
        self, cache_target_tokens: int
    ) -> None:
        """Delegate to :func:`ac_dc.llm._rebuild.rebuild_graduate_history`."""
        from ac_dc.llm._rebuild import rebuild_graduate_history
        rebuild_graduate_history(self, cache_target_tokens)


    # ------------------------------------------------------------------
    # Public RPC — session management
    # ------------------------------------------------------------------

    def new_session(self) -> dict[str, Any]:
        """Delegate to :func:`ac_dc.llm._rpc_state.new_session`."""
        from ac_dc.llm._rpc_state import new_session
        return new_session(self)

    # ------------------------------------------------------------------
    # Public RPC — agent context lifecycle (C1b)
    # ------------------------------------------------------------------

    def close_agent_context(
        self,
        turn_id: str,
        agent_idx: int,
    ) -> dict[str, Any]:
        """Delegate to :func:`ac_dc.llm._rpc_state.close_agent_context`."""
        from ac_dc.llm._rpc_state import close_agent_context
        return close_agent_context(self, turn_id, agent_idx)

    def set_agent_selected_files(
        self,
        turn_id: str,
        agent_idx: int,
        files: list[str],
    ) -> list[str] | dict[str, Any]:
        """Delegate to :func:`ac_dc.llm._rpc_state.set_agent_selected_files`."""
        from ac_dc.llm._rpc_state import set_agent_selected_files
        return set_agent_selected_files(
            self, turn_id, agent_idx, files
        )

    # ------------------------------------------------------------------
    # Conversation scope construction
    # ------------------------------------------------------------------

    def _default_scope(self) -> ConversationScope:
        """Build a scope pointing at the main-conversation state.

        The main user-facing session's state lives on ``self``.
        Every entry point that runs ``_stream_chat`` for the main
        conversation (today: ``chat_streaming``) builds a default
        scope via this helper and threads it through.

        Future parallel-agent mode will NOT call this — each
        spawned agent constructs its own scope from
        :func:`ac_dc.agent_factory.build_agent_context_manager`
        plus a per-agent tracker and a per-agent selection list.

        The ``archival_append`` closure wraps
        :meth:`HistoryStore.append_message` so the scope can
        invoke it without caring whether the backing target is
        the main JSONL or a per-turn archive. When no history
        store is attached (tests that skip persistence), the
        field is None and callers check before invoking.
        """
        archival: ArchivalAppend | None
        if self._history_store is not None:
            store = self._history_store  # closure capture

            def _append_to_main_store(
                role: str,
                content: str,
                *,
                session_id: str,
                **kwargs: Any,
            ) -> Any:
                """Wrap HistoryStore.append_message.

                The main-store method takes ``session_id`` as a
                keyword argument and accepts a small fixed set of
                optional kwargs (files, images, files_modified,
                edit_results, system_event, turn_id). Callers at
                the streaming-handler level already know the
                right keyword shape — we pass through verbatim.
                """
                return store.append_message(
                    session_id=session_id,
                    role=role,
                    content=content,
                    **kwargs,
                )

            archival = _append_to_main_store
        else:
            archival = None

        return ConversationScope(
            context=self._context,
            tracker=self._stability_tracker,
            session_id=self._session_id,
            selected_files=self._selected_files,
            archival_append=archival,
        )

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

    def _filter_dispatchable_agents(
        self,
        agent_blocks: list[AgentBlock],
        parent_request_id: str,
        turn_id: str,
    ) -> list[AgentBlock]:
        """Delegate to :func:`ac_dc.llm._agents.filter_dispatchable_agents`."""
        from ac_dc.llm._agents import filter_dispatchable_agents
        return filter_dispatchable_agents(
            self, agent_blocks, parent_request_id, turn_id
        )

    async def _stream_chat_stub(
        self,
        request_id: str,
        message: str,
        files: list[str],
        images: list[str],
        excluded_urls: list[str] | None = None,
        *,
        scope: ConversationScope | None = None,
    ) -> None:
        """No-op stand-in for ``_stream_chat`` during Step 2.

        Step 2 of ``docs/agent-spawning-plan.md`` verifies the
        per-agent infrastructure (ContextManager construction,
        archive directory creation, scope copying) without
        actually running any LLM calls. Each agent's scope is
        constructed by :meth:`_spawn_agents_for_turn` and
        handed to whichever callable is currently assigned to
        :attr:`_agent_stream_impl`; in Step 2 that's this
        stub, in Step 3 it flips to :meth:`_stream_chat`.

        Tests can override ``_agent_stream_impl`` directly to
        observe invocations without patching the streaming
        machinery. The stub's signature matches
        :meth:`_stream_chat` so the swap is a one-line change
        when Step 3 lands.

        Logs at INFO so operators running with agent mode
        enabled during the pre-Step-3 window see evidence the
        plumbing worked without thinking something broke when
        no LLM call fired.
        """
        del files, images, excluded_urls  # unused in stub
        task_preview = message[:60].replace("\n", " ")
        logger.info(
            "Agent stream stub: request=%s task=%r (scope=%s). "
            "Execution plane not yet implemented — Step 3 "
            "replaces this stub with _stream_chat.",
            request_id,
            task_preview,
            "present" if scope is not None else "missing",
        )

    async def _spawn_agents_for_turn(
        self,
        agent_blocks: list[AgentBlock],
        parent_scope: ConversationScope,
        parent_request_id: str,
        turn_id: str,
    ) -> None:
        """Delegate to :func:`ac_dc.llm._agents.spawn_agents_for_turn`."""
        from ac_dc.llm._agents import spawn_agents_for_turn
        await spawn_agents_for_turn(
            self,
            agent_blocks,
            parent_scope,
            parent_request_id,
            turn_id,
        )

    async def _assimilate_agent_changes(
        self,
        agent_results: list[Any],
        parent_scope: ConversationScope,
    ) -> None:
        """Delegate to :func:`ac_dc.llm._agents.assimilate_agent_changes`."""
        from ac_dc.llm._agents import assimilate_agent_changes
        await assimilate_agent_changes(
            self, agent_results, parent_scope
        )

    def _build_agent_scope(
        self,
        block: AgentBlock,
        agent_idx: int,
        parent_scope: ConversationScope,
        turn_id: str,
    ) -> ConversationScope:
        """Delegate to :func:`ac_dc.llm._agents.build_agent_scope`."""
        from ac_dc.llm._agents import build_agent_scope
        return build_agent_scope(
            self, block, agent_idx, parent_scope, turn_id
        )

    async def chat_streaming(
        self,
        request_id: str,
        message: str,
        files: list[str] | None = None,
        images: list[str] | None = None,
        excluded_urls: list[str] | None = None,
        agent_tag: tuple[str, int] | list[Any] | None = None,
    ) -> dict[str, Any]:
        """Start a streaming chat request.

        Returns synchronously with ``{"status": "started"}``. The
        actual streaming runs as a background task; chunks and the
        completion arrive via the event callback.

        Rejects if the service isn't fully initialised, or if
        another stream is active for the same scope (main
        conversation OR the tagged agent).

        ``excluded_urls`` carries the set of fetched URLs the user
        has unchecked in the chip UI. These URLs stay in the URL
        service's session-scoped ``_fetched`` dict (so the chip
        remains visible and can be re-included on a later turn)
        but are omitted from this turn's injected URL context.
        See specs4/4-features/url-content.md § URL Chips UI.

        ``agent_tag`` routes the call to an agent conversation
        when present (C1c). Shape is ``(turn_id, agent_idx)`` —
        the frontend's agent tab derives this from its
        ``{turn_id}/agent-NN`` tab ID. The scope is looked up in
        :attr:`_agent_contexts`; a stale tab ID (agent already
        closed, or the session rolled over via
        :meth:`new_session`) produces an ``agent not found``
        error rather than silently falling back to the main
        conversation, which would append to the main history in
        confusing ways.

        Single-stream guard scoping:

        - Untagged calls gate on :attr:`_active_user_request`
          (the main user-facing session's slot).
        - Tagged calls gate on :attr:`_active_agent_streams`
          keyed by ``(turn_id, agent_idx)`` — per-agent
          mutual exclusion. A user typing in the main tab
          AND an agent tab sees both streams proceed in
          parallel; typing again in the same agent tab while
          a stream is active returns the active-stream error.

        JRPC-OO delivers array args as lists, so ``agent_tag``
        may arrive as ``[turn_id, agent_idx]``. The tuple form
        is accepted for test convenience and direct Python
        callers; both shapes coerce to the ``(turn_id, agent_idx)``
        tuple used as the registry key.
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

        # Resolve the scope. Three cases:
        #
        # 1. agent_tag is None → default scope (main conversation).
        # 2. agent_tag is well-formed and points at a registered
        #    agent → use the registered scope.
        # 3. agent_tag is well-formed but the agent isn't
        #    registered (stale tab) → error.
        #
        # Malformed agent_tag (wrong shape, non-string turn_id,
        # non-integer agent_idx) falls through to the error
        # path with a different message so the frontend can
        # distinguish "my tab is stale, close it" from "my RPC
        # payload was malformed, file a bug".
        agent_key: tuple[str, int] | None = None
        scope: ConversationScope
        if agent_tag is None:
            scope = self._default_scope()
        else:
            # Accept both tuple and list shapes. JRPC-OO
            # serialises Python tuples to JS arrays, so the
            # frontend always sends a two-element array; tests
            # and direct callers use the tuple form. Either way
            # we normalise to a tuple for the registry key.
            parsed = self._parse_agent_tag(agent_tag)
            if parsed is None:
                return {
                    "error": (
                        "Malformed agent_tag — expected "
                        "[turn_id, agent_idx] or "
                        "(turn_id, agent_idx)"
                    )
                }
            agent_key = parsed
            turn_id_part, agent_idx_part = agent_key
            turn_bucket = self._agent_contexts.get(turn_id_part)
            agent_scope = (
                turn_bucket.get(agent_idx_part)
                if turn_bucket is not None
                else None
            )
            if agent_scope is None:
                return {"error": "agent not found"}
            scope = agent_scope

        # Single-stream guard. Tagged calls gate on the
        # per-agent set; untagged calls gate on the main-
        # session slot. A tagged call does NOT consult
        # ``_active_user_request`` — the main session's guard
        # is for the main tab; an agent tab is its own
        # conversation and can stream in parallel with it.
        if agent_key is not None:
            if agent_key in self._active_agent_streams:
                return {
                    "error": (
                        f"Another stream is active for agent "
                        f"{agent_key[0]}/agent-{agent_key[1]:02d}"
                    )
                }
            # Register the agent slot. Cleared in the background
            # task's finally block.
            self._active_agent_streams.add(agent_key)
        else:
            # Main-tab untagged path — unchanged from pre-C1c.
            # User-initiated single-stream guard per
            # specs4/7-future/parallel-agents.md § Foundation
            # Requirements. Blocks a second user-initiated
            # stream but allows child streams that share an
            # active parent's request ID prefix.
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
            # Register the active request. Only user-initiated
            # requests register here — child requests share
            # their parent's slot and don't overwrite it.
            if not self._is_child_request(request_id):
                self._active_user_request = request_id

        # Launch the background task. ensure_future rather than
        # await so we return {"status": "started"} immediately.
        #
        # For the untagged path, the default scope points at the
        # main-conversation state on ``self``. For the tagged
        # path, the scope is the registered agent's scope from
        # ``_agent_contexts`` — its own ContextManager,
        # StabilityTracker, and archival sink. ``_stream_chat``
        # doesn't distinguish between the two; it just threads
        # scope through.
        asyncio.ensure_future(
            self._stream_chat(
                request_id,
                message,
                files or [],
                images or [],
                excluded_urls or [],
                scope=scope,
                agent_key=agent_key,
            )
        )
        return {"status": "started"}

    @staticmethod
    def _parse_agent_tag(
        agent_tag: Any,
    ) -> tuple[str, int] | None:
        """Coerce an incoming agent_tag into a ``(turn_id, agent_idx)`` tuple.

        JRPC-OO serialises tuples to JS arrays on the wire;
        tests and direct callers use the tuple form. Both
        shapes are accepted. Returns None when the payload
        is structurally malformed (wrong length, wrong types).

        Kept as a ``@staticmethod`` so it's trivially testable
        without constructing a service.
        """
        if not isinstance(agent_tag, (list, tuple)):
            return None
        if len(agent_tag) != 2:
            return None
        turn_id_raw, agent_idx_raw = agent_tag
        if not isinstance(turn_id_raw, str) or not turn_id_raw:
            return None
        # Accept int or int-compatible. Reject bool because
        # ``bool`` is a subclass of ``int`` and True/False
        # silently matching agent_idx 1/0 would mask bugs in
        # upstream code that forgot to parse a string.
        if isinstance(agent_idx_raw, bool):
            return None
        if not isinstance(agent_idx_raw, int):
            return None
        if agent_idx_raw < 0:
            return None
        return (turn_id_raw, agent_idx_raw)

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
        *,
        scope: ConversationScope | None = None,
        agent_key: tuple[str, int] | None = None,
    ) -> dict[str, Any]:
        """Delegate to :func:`ac_dc.llm._streaming.stream_chat`.

        Per-conversation reads — history, file_context,
        tracker, session_id, selected_files — go through
        ``scope.*``. Shared infrastructure (repo, config,
        indexes, URL service, executors, guard state, review
        mode) stays on ``self``. Returns the completion result
        dict so agent spawning's ``asyncio.gather`` can collect
        ``files_modified`` / ``files_created`` for assimilation
        — the main-conversation caller (``chat_streaming`` via
        ``ensure_future``) doesn't await the return value and
        ignores it.
        """
        from ac_dc.llm._streaming import stream_chat
        return await stream_chat(
            self, request_id, message, files, images,
            excluded_urls, scope=scope, agent_key=agent_key,
        )

    async def _detect_and_fetch_urls(
        self,
        request_id: str,
        message: str,
        excluded_urls: list[str] | None = None,
        scope: ConversationScope | None = None,
    ) -> None:
        """Delegate to :func:`ac_dc.llm._streaming.detect_and_fetch_urls`."""
        from ac_dc.llm._streaming import detect_and_fetch_urls
        await detect_and_fetch_urls(
            self, request_id, message, excluded_urls, scope
        )

    def _fetch_url_sync(self, url: str) -> None:
        """Delegate to :func:`ac_dc.llm._streaming.fetch_url_sync`."""
        from ac_dc.llm._streaming import fetch_url_sync
        fetch_url_sync(self, url)

    async def _build_completion_result(
        self,
        full_content: str,
        user_message: str,
        cancelled: bool,
        error: str | None,
        finish_reason: str | None = None,
        request_usage: dict[str, Any] | None = None,
        scope: ConversationScope | None = None,
        turn_id: str | None = None,
    ) -> dict[str, Any]:
        """Delegate to :func:`ac_dc.llm._streaming.build_completion_result`."""
        from ac_dc.llm._streaming import build_completion_result
        return await build_completion_result(
            self,
            full_content=full_content,
            user_message=user_message,
            cancelled=cancelled,
            error=error,
            finish_reason=finish_reason,
            request_usage=request_usage,
            scope=scope,
            turn_id=turn_id,
        )

    @staticmethod
    def _serialise_edit_result(r: EditResult) -> dict[str, Any]:
        """Delegate to :func:`ac_dc.llm._streaming.serialise_edit_result`."""
        from ac_dc.llm._streaming import serialise_edit_result
        return serialise_edit_result(r)

    def _run_completion_sync(
        self,
        request_id: str,
        messages: list[dict[str, Any]],
        loop: asyncio.AbstractEventLoop,
    ) -> tuple[str, bool, str | None, dict[str, Any]]:
        """Delegate to :func:`ac_dc.llm._streaming.run_completion_sync`."""
        from ac_dc.llm._streaming import run_completion_sync
        return run_completion_sync(self, request_id, messages, loop)

    def _accumulate_usage(self, usage: Any) -> None:
        """Delegate to :func:`ac_dc.llm._streaming.accumulate_usage`."""
        from ac_dc.llm._streaming import accumulate_usage
        accumulate_usage(self, usage)

    def _accumulate_cost(self, cost: float | None) -> None:
        """Delegate to :func:`ac_dc.llm._streaming.accumulate_cost`."""
        from ac_dc.llm._streaming import accumulate_cost
        accumulate_cost(self, cost)

    @staticmethod
    def _extract_response_cost(
        cost_source: Any,
        litellm_module: Any,
        usage: Any,
    ) -> float | None:
        """Pull the USD cost for a completion from LiteLLM.

        Thin delegation to
        :func:`ac_dc.llm._helpers._extract_response_cost`.
        See the helper module for the three-location fallback
        chain.
        """
        return _extract_response_cost(
            cost_source, litellm_module, usage
        )

    @staticmethod
    def _classify_litellm_error(
        litellm_module: Any,
        exc: BaseException,
    ) -> dict[str, Any]:
        """Map a LiteLLM exception to a structured error dict.

        Thin delegation to
        :func:`ac_dc.llm._helpers._classify_litellm_error`;
        exposed as a static method so callers using
        ``LLMService._classify_litellm_error(...)`` continue to
        work. See the helper module for the full classification
        rules and recognised error types.
        """
        return _classify_litellm_error(litellm_module, exc)

    # ------------------------------------------------------------------
    # Stability tracker initialization
    # ------------------------------------------------------------------

    def _try_initialize_stability(self) -> None:
        """Delegate to :func:`ac_dc.llm._stability.try_initialize_stability`."""
        from ac_dc.llm._stability import try_initialize_stability
        try_initialize_stability(self)

    def _measure_tracker_tokens(self) -> None:
        """Delegate to :func:`ac_dc.llm._stability.measure_tracker_tokens`."""
        from ac_dc.llm._stability import measure_tracker_tokens
        measure_tracker_tokens(self)

    def _print_init_hud(self) -> None:
        """Delegate to :func:`ac_dc.llm._breakdown.print_init_hud`.

        Internal-only method; called from
        ``_try_initialize_stability`` after a successful tier
        seed to print the one-time startup HUD to stderr.
        """
        from ac_dc.llm._breakdown import print_init_hud
        print_init_hud(self)

    def _print_post_response_hud(self) -> None:
        """Delegate to :func:`ac_dc.llm._breakdown.print_post_response_hud`.

        Internal-only method; called from ``_post_response``
        after every completed chat turn to print the
        three-section terminal HUD to stderr.
        """
        from ac_dc.llm._breakdown import print_post_response_hud
        print_post_response_hud(self)

    # ------------------------------------------------------------------
    # Context breakdown (RPC)
    # ------------------------------------------------------------------

    def get_context_breakdown(self) -> dict[str, Any]:
        """Delegate to :func:`ac_dc.llm._breakdown.get_context_breakdown`.

        Public RPC — Context tab + TokenHUD consume this on
        every stream-complete + mode/session change.
        """
        from ac_dc.llm._breakdown import get_context_breakdown
        return get_context_breakdown(self)

    # ------------------------------------------------------------------
    # Tiered content builder
    # ------------------------------------------------------------------

    def _build_tiered_content(
        self,
        scope: ConversationScope | None = None,
    ) -> dict[str, dict[str, Any]] | None:
        """Delegate to :func:`ac_dc.llm._assembly.build_tiered_content`."""
        from ac_dc.llm._assembly import build_tiered_content
        return build_tiered_content(self, scope)

    # ------------------------------------------------------------------
    # Message assembly — tiered (primary path, 3.8)
    # ------------------------------------------------------------------

    def _assemble_tiered(
        self,
        user_prompt: str,
        images: list[str],
        tiered_content: dict[str, dict[str, Any]],
        scope: ConversationScope | None = None,
    ) -> list[dict[str, Any]]:
        """Delegate to :func:`ac_dc.llm._assembly.assemble_tiered`."""
        from ac_dc.llm._assembly import assemble_tiered
        return assemble_tiered(
            self, user_prompt, images, tiered_content, scope
        )

    # ------------------------------------------------------------------
    # Message assembly (flat — fallback during startup window)
    # ------------------------------------------------------------------

    def _assemble_messages_flat(
        self,
        user_prompt: str,
        images: list[str],
        scope: ConversationScope | None = None,
    ) -> list[dict[str, Any]]:
        """Delegate to :func:`ac_dc.llm._assembly.assemble_messages_flat`."""
        from ac_dc.llm._assembly import assemble_messages_flat
        return assemble_messages_flat(
            self, user_prompt, images, scope
        )

    # ------------------------------------------------------------------
    # File context sync
    # ------------------------------------------------------------------

    def _sync_file_context(
        self,
        scope: ConversationScope | None = None,
    ) -> None:
        """Delegate to :func:`ac_dc.llm._lifecycle.sync_file_context`."""
        from ac_dc.llm._lifecycle import sync_file_context
        sync_file_context(self, scope)

    # ------------------------------------------------------------------
    # Post-response processing
    # ------------------------------------------------------------------

    async def _post_response(
        self,
        request_id: str,
        turn_id: str,
        scope: ConversationScope | None = None,
    ) -> None:
        """Delegate to :func:`ac_dc.llm._lifecycle.post_response`."""
        from ac_dc.llm._lifecycle import post_response
        await post_response(self, request_id, turn_id, scope)

    def _update_stability(
        self,
        scope: ConversationScope | None = None,
    ) -> None:
        """Delegate to :func:`ac_dc.llm._stability.update_stability`."""
        from ac_dc.llm._stability import update_stability
        update_stability(self, scope)

    # ------------------------------------------------------------------
    # Commit and reset
    # ------------------------------------------------------------------

    async def commit_all(self) -> dict[str, Any]:
        """Delegate to :func:`ac_dc.llm._commit.commit_all`."""
        from ac_dc.llm._commit import commit_all
        return await commit_all(self)

    async def _commit_all_background(
        self, session_id: str
    ) -> None:
        """Delegate to :func:`ac_dc.llm._commit.commit_all_background`."""
        from ac_dc.llm._commit import commit_all_background
        await commit_all_background(self, session_id)

    async def _generate_commit_message(self, diff: str) -> str:
        """Delegate to :func:`ac_dc.llm._commit.generate_commit_message`."""
        from ac_dc.llm._commit import generate_commit_message
        return await generate_commit_message(self, diff)

    def reset_to_head(self) -> dict[str, Any]:
        """Delegate to :func:`ac_dc.llm._commit.reset_to_head`."""
        from ac_dc.llm._commit import reset_to_head
        return reset_to_head(self)

    # ------------------------------------------------------------------
    # Event broadcast
    # ------------------------------------------------------------------

    def _broadcast_enrichment_status(self) -> None:
        """Delegate to :func:`ac_dc.llm._lifecycle.broadcast_enrichment_status`."""
        from ac_dc.llm._lifecycle import broadcast_enrichment_status
        broadcast_enrichment_status(self)

    def _broadcast_event(
        self, event_name: str, *args: Any
    ) -> None:
        """Delegate to :func:`ac_dc.llm._lifecycle.broadcast_event`."""
        from ac_dc.llm._lifecycle import broadcast_event
        broadcast_event(self, event_name, *args)

    async def _broadcast_event_async(
        self, event_name: str, *args: Any
    ) -> None:
        """Delegate to :func:`ac_dc.llm._lifecycle.broadcast_event_async`."""
        from ac_dc.llm._lifecycle import broadcast_event_async
        await broadcast_event_async(self, event_name, *args)

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