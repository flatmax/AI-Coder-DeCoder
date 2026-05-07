"""Type aliases, dataclasses, and module constants for LLMService.

Extracted from :mod:`ac_dc.llm_service` to keep that module
focused on the service class itself. Nothing here depends on
:class:`LLMService`; everything here may be imported by the
service and its helpers.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from ac_dc.stability_tracker import Tier, _TIER_CONFIG


# ---------------------------------------------------------------------------
# Tier config lookup
# ---------------------------------------------------------------------------
#
# Maps Tier enum to the entry_n / promote_n config dict. Imported
# from the tracker module so the numbers stay in sync with the
# cascade algorithm.

_TIER_CONFIG_LOOKUP: dict[Tier, dict[str, int]] = _TIER_CONFIG


# ---------------------------------------------------------------------------
# Type aliases
# ---------------------------------------------------------------------------


# Event callback — dispatches a server-push event to the browser.
# Signature: (event_name: str, *args) -> awaitable. Different events
# take different argument shapes (streamChunk(request_id, content),
# filesChanged(files_list)), so we use *args rather than a fixed
# schema. Returns a coroutine the caller awaits.
EventCallback = Callable[..., Awaitable[Any]]


# Archival append callable — wraps :meth:`HistoryStore.append_message`
# for the main conversation, or
# :meth:`HistoryStore.append_agent_message` for an agent
# conversation (via the closure in
# :func:`ac_dc.agent_factory.build_agent_context_manager`).
#
# The signature is intentionally loose (``*args, **kwargs``) so the
# same type covers both append methods. The scope carries None when
# no history store is attached — a tests-that-skip-persistence case
# — and callers check for None before invoking.
ArchivalAppend = Callable[..., Any]


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


# ---------------------------------------------------------------------------
# Conversation scope
# ---------------------------------------------------------------------------


@dataclass
class ConversationScope:
    """Per-conversation state bundle threaded through ``_stream_chat``.

    A ``_stream_chat`` call operates on exactly one conversation.
    In single-agent operation that's the main user-facing
    session; in future parallel-agent mode
    (``specs4/7-future/parallel-agents.md``) each spawned agent
    runs its own ``_stream_chat`` call with its own scope.

    Bundling the per-conversation fields into one parameter:

    - Makes the dependency graph explicit. A reader of
      ``_stream_chat``'s signature sees exactly which state is
      per-conversation without chasing ``self.`` reads.
    - Keeps the refactor to agent-spawning a field swap, not a
      parameter plumbing job. The main-conversation path builds a
      default scope from ``self``; agent spawning builds scopes
      from :func:`ac_dc.agent_factory.build_agent_context_manager`
      plus per-agent tracker and selection state.
    - Separates per-conversation state from shared infrastructure
      (``_url_service``, ``_symbol_index``, ``_doc_index``,
      ``_repo``, ``_config``, executors, event callback,
      cancellation/guard state). The shared fields continue to
      live on ``LLMService`` and are read via ``self`` from within
      ``_stream_chat``.

    **What the scope does NOT carry:**

    - ``turn_id`` — generated per-request inside ``_stream_chat``
      or passed as an argument by future agent-spawning code. A
      single ContextManager handles many turns; turn_id is
      mid-flight state, not scope-lifetime state.
    - ``_review_active`` / ``_review_state`` — review mode is
      main-conversation-only per
      ``specs4/4-features/code-review.md``. Agents never review.
      ``_stream_chat`` continues to read these from ``self``.
    - Guard state (``_committing``, ``_active_user_request``,
      ``_cancelled_requests``, ``_request_accumulators``) —
      multiplexing primitives shared across all conversations.
    - Mode-tracker management (``_trackers``,
      ``_stability_initialized``) — shared bookkeeping;
      ``scope.tracker`` points at whichever entry is live for
      this scope.

    **Field semantics:**

    ``context`` owns the ContextManager and its embedded
    FileContext. Callers should use ``scope.context.file_context``
    rather than storing a separate reference; the two must not
    drift (historical bug: see the aliasing note in
    :meth:`LLMService.__init__`).

    ``tracker`` is the StabilityTracker for this conversation.
    In single-agent operation it's whichever entry of
    ``LLMService._trackers`` is currently active; in future
    parallel-agent mode each agent has its own instance.

    ``session_id`` partitions the history store. The main
    conversation persists to a user session ID; agents persist
    to a per-turn archive path, which the ``archival_append``
    closure knows how to target. The ``session_id`` field is
    still carried on scope because some audit paths (compaction
    system event persistence for the main conversation) call
    into ``HistoryStore.append_message`` directly with a
    session_id. Agents' ``archival_append`` ignores the field —
    their closure already bakes in the turn_id and agent_idx.

    ``selected_files`` is the file picker state. In single-agent
    operation this is ``LLMService._selected_files``; per D21 the
    frontend will eventually scope this per-tab, and agents will
    own their own list.

    ``archival_append`` is the callable that writes a message to
    persistent storage. For the main conversation it wraps
    :meth:`HistoryStore.append_message`; for an agent it wraps
    :meth:`HistoryStore.append_agent_message` via the closure in
    :func:`ac_dc.agent_factory.build_agent_context_manager`. None
    when no history store is attached (tests that skip
    persistence); callers check for None before invoking.
    """

    context: Any  # ContextManager — quoted to avoid forward-ref dance
    tracker: Any  # StabilityTracker
    session_id: str
    selected_files: list[str] = field(default_factory=list)
    excluded_index_files: list[str] = field(default_factory=list)
    archival_append: ArchivalAppend | None = None