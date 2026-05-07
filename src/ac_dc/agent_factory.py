"""Agent ContextManager factory — Slice 5 of parallel-agents foundation.

Composes :class:`HistoryStore` and :class:`ContextManager` to
produce a ready-to-use agent ContextManager whose archival sink
persists every message to
``.ac-dc4/agents/{turn_id}/agent-NN.jsonl``.

Governing spec: ``specs4/7-future/parallel-agents.md`` § Turn
ID Propagation.

This module is pure composition — no side effects, no state,
no class. A single function :func:`build_agent_context_manager`
takes the identity pieces (``turn_id``, ``agent_idx``), the
shared collaborators (history store, model name, optional
repo/config/prompt), and returns a wired
:class:`ContextManager` ready to stream LLM calls into.

## Design Decisions Pinned Here

- **Standalone function, not a method.** Keeping the factory out
  of :class:`LLMService` means it can be tested without
  constructing a service; keeping it out of :class:`ContextManager`
  preserves that module's independence from the history store
  (the main user-facing ContextManager has no history-store
  dependency, and the streaming handler is what wires them
  together for the main session).

- **Closure owns ``turn_id`` and ``agent_idx``.** The sink the
  ContextManager invokes receives only the per-message fields
  (``role``, ``content``, ``system_event``, extras); the factory
  bakes the identity pair into the closure so downstream sink
  callers never need to juggle them. Matches the spec's
  "sink closes over turn_id and agent_idx" contract in
  ``specs4/7-future/parallel-agents.md``.

- **Extras routing.** :meth:`HistoryStore.append_agent_message`
  has three first-class keyword fields beyond role/content/
  system_event: ``session_id``, ``image_refs``, and ``extra``
  (the catch-all dict). The closure routes recognised kwargs
  to their named slots and funnels everything else into
  ``extra`` — otherwise a caller passing ``files_modified`` or
  ``edit_results`` would hit ``append_agent_message``'s
  unexpected-keyword-argument error.

- **Validation is cheap and eager.** Empty ``turn_id`` or
  negative ``agent_idx`` are programmer errors that should
  surface at factory-call time, not when the first message is
  appended. Raising :class:`ValueError` here gives a clean
  stack trace at the spawn site rather than buried inside a
  sink invocation.

- **No registry, no side effects.** This function constructs
  and returns; it does not add the ContextManager to any
  running-agents list. The agent executor (future Slice 6)
  owns agent lifecycle tracking.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from ac_dc.context_manager import ContextManager

if TYPE_CHECKING:
    from ac_dc.history_store import HistoryStore
    from ac_dc.repo import Repo

logger = logging.getLogger(__name__)


# Kwargs that :meth:`HistoryStore.append_agent_message` accepts
# as first-class keyword arguments. Everything else the sink
# receives in its ``**extras`` gets funneled into the
# ``extra={...}`` dict so the store's reserved-field filter
# handles them correctly.
#
# Kept as a module-level frozenset so the closure's hot path
# is a cheap membership test, not a per-call set construction.
_RECOGNISED_EXTRAS: frozenset[str] = frozenset({
    "session_id",
    "image_refs",
})


def build_agent_context_manager(
    turn_id: str,
    agent_idx: int,
    *,
    model_name: str,
    history_store: "HistoryStore",
    repo: "Repo | None" = None,
    cache_target_tokens: int | None = None,
    compaction_config: dict[str, Any] | None = None,
    system_prompt: str = "",
) -> ContextManager:
    """Construct an agent ContextManager wired to the archive.

    Produces a fully-wired :class:`ContextManager` whose
    ``archival_sink`` closure persists every
    :meth:`~ContextManager.add_message` /
    :meth:`~ContextManager.add_exchange` append to
    ``.ac-dc4/agents/{turn_id}/agent-NN.jsonl`` via
    :meth:`HistoryStore.append_agent_message`.

    Parameters
    ----------
    turn_id:
        Parent turn identifier from
        :meth:`HistoryStore.new_turn_id`. Must be non-empty —
        agent archives are keyed by turn ID, and an empty key
        would corrupt the directory structure. Raises
        :class:`ValueError` when empty.
    agent_idx:
        Zero-based agent index within the turn. Stable across
        iterations — agent 0 in iteration 2 writes to the same
        ``agent-00.jsonl`` file as agent 0 in iteration 1. Must
        be non-negative; raises :class:`ValueError` otherwise.
    model_name:
        Provider-qualified model identifier (e.g.
        ``"anthropic/claude-sonnet-4-5"``). Passed through to the
        ContextManager's constructor for its token counter.
    history_store:
        The :class:`HistoryStore` instance whose
        ``append_agent_message`` method the sink will invoke.
        Typically the same store the main user-facing
        ContextManager uses — agents share the ``.ac-dc4/``
        root but write to their own subdirectory.
    repo:
        Optional :class:`Repo` reference. When supplied, the
        agent's :class:`FileContext` can load files via
        ``add_file(path)`` without explicit content. Agents
        navigating the repo need this; agents with pre-loaded
        content can omit it.
    cache_target_tokens:
        Optional cache-target value. Forwarded to the
        ContextManager; the stability tracker (if attached
        later) reads it.
    compaction_config:
        Optional compaction config dict. Forwarded to the
        ContextManager; Layer 3.6's compactor reads it if a
        compactor is attached to this agent.
    system_prompt:
        Initial system prompt text. Agents typically receive a
        task-specific prompt composed by the spawning code;
        defaults to empty.

    Returns
    -------
    ContextManager
        A ready-to-use agent ContextManager with ``turn_id`` and
        ``archival_sink`` set. The returned instance carries no
        external lifecycle obligations — callers that construct
        it don't need to register it anywhere; letting it fall
        out of scope is a legitimate cleanup path.

    Raises
    ------
    ValueError
        If ``turn_id`` is empty or ``agent_idx`` is negative.
        These are programmer errors in the spawning code; raising
        at factory time gives a clean stack trace at the spawn
        site rather than at the first message append.
    """
    if not turn_id:
        raise ValueError("turn_id must be non-empty")
    if agent_idx < 0:
        raise ValueError(
            f"agent_idx must be non-negative, got {agent_idx}"
        )

    def _sink(
        role: str,
        content: str,
        *,
        system_event: bool = False,
        **kwargs: Any,
    ) -> None:
        """Persist one message to the per-agent archive.

        Closure over ``history_store``, ``turn_id``, and
        ``agent_idx``. Invoked by the ContextManager after every
        successful in-memory append; the ContextManager's own
        error-isolation wrapper (:meth:`_invoke_archival_sink`)
        swallows exceptions raised here, so a crashed store or
        a bad kwarg combination doesn't propagate into the
        streaming pipeline.

        Extras routing — kwargs recognised by
        :meth:`HistoryStore.append_agent_message` as first-class
        keyword arguments are passed through directly; everything
        else lands in the ``extra`` dict. Without this split, a
        caller passing ``files_modified`` (a valid
        ContextManager extra) would trigger
        ``append_agent_message``'s "unexpected keyword argument"
        TypeError and the whole sink would raise.
        """
        # Split extras into named kwargs vs the catch-all dict.
        named: dict[str, Any] = {}
        extra: dict[str, Any] = {}
        for key, value in kwargs.items():
            if key in _RECOGNISED_EXTRAS:
                named[key] = value
            else:
                extra[key] = value

        history_store.append_agent_message(
            turn_id,
            agent_idx,
            role,
            content,
            system_event=system_event,
            extra=extra if extra else None,
            **named,
        )

    return ContextManager(
        model_name=model_name,
        repo=repo,
        cache_target_tokens=cache_target_tokens,
        compaction_config=compaction_config,
        system_prompt=system_prompt,
        turn_id=turn_id,
        archival_sink=_sink,
    )