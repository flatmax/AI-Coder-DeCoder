"""History browsing and session-management RPC surface.

Extracted from :mod:`ac_dc.llm_service` to keep that module
focused on construction and the streaming entry point.
Covers:

- **History browsing** — :func:`history_search`,
  :func:`history_list_sessions`, :func:`history_get_session`,
  :func:`get_turn_archive`. All read-only; no localhost gate.
- **Session management** — :func:`load_session_into_context`,
  :func:`get_history_status`. The load-into-context path
  mutates state (replaces history + session ID) and is
  localhost-gated.

Every function takes :class:`LLMService` as first argument.
When no history store is attached (tests that skip
persistence), the read paths return empty results rather
than raising.

Governing spec: :doc:`specs4/3-llm/history`.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from ac_dc.context_manager import Mode

if TYPE_CHECKING:
    from ac_dc.llm_service import LLMService

logger = logging.getLogger("ac_dc.llm_service")


# ---------------------------------------------------------------------------
# History browsing — read-only
# ---------------------------------------------------------------------------


def history_search(
    service: "LLMService",
    query: str,
    role: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Search conversation history across all sessions."""
    if service._history_store is None:
        return []
    return service._history_store.search_messages(
        query, role=role, limit=limit
    )


def history_list_sessions(
    service: "LLMService",
    limit: int | None = None,
) -> list[dict[str, Any]]:
    """Return recent sessions for the history browser."""
    if service._history_store is None:
        return []
    sessions = service._history_store.list_sessions(limit=limit)
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
    service: "LLMService",
    session_id: str,
) -> list[dict[str, Any]]:
    """Return all messages for a session (full metadata)."""
    if service._history_store is None:
        return []
    return service._history_store.get_session_messages(session_id)


def get_turn_archive(
    service: "LLMService",
    turn_id: str,
) -> list[dict[str, Any]]:
    """Return the per-agent archive for a turn.

    Reads ``.ac-dc4/agents/{turn_id}/agent-NN.jsonl`` files
    and returns one entry per agent, ordered by agent index.
    Empty list when the turn didn't spawn agents or the
    archive was deleted.
    """
    if service._history_store is None:
        return []
    return service._history_store.get_turn_archive(turn_id)


# ---------------------------------------------------------------------------
# Session management
# ---------------------------------------------------------------------------


def load_session_into_context(
    service: "LLMService",
    session_id: str,
) -> dict[str, Any]:
    """Load a previous session into the active context.

    Clears current history, loads the target session's
    messages, and reuses that session's ID so subsequent
    messages persist to the same session. Broadcasts
    ``sessionChanged`` to all clients.
    """
    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted
    if service._history_store is None:
        return {"error": "No history store available"}
    messages = (
        service._history_store.get_session_messages_for_context(
            session_id
        )
    )
    if not messages:
        return {"error": f"Session {session_id} not found or empty"}
    service._context.clear_history()
    service._context.set_history(messages)
    service._session_id = session_id

    # Reconstruct agents that participated in this session.
    # Per spec specs4/3-llm/history.md § Session-Load
    # Reconstruction: walk the session's full records for
    # assistant entries carrying agent_blocks, group by
    # agent id (latest record wins on retask), rebuild a
    # live writable ContextManager per surviving id.
    # Idempotent against partial registration — a single
    # agent's reconstruction raising leaves the others
    # reachable.
    #
    # Note: passes session_id rather than the loaded
    # ``messages`` list because `get_session_messages_for_context`
    # strips ``agent_blocks`` (it returns the minimal
    # role/content/turn_id/images shape that feeds the
    # ContextManager's history). Reconstruction needs the
    # full record shape, which `get_session_messages`
    # returns. Keeping the LLM-facing context shape minimal
    # is the right tradeoff — agent_blocks doesn't belong
    # in the prompt's message history.
    _reconstruct_agents_from_session(service, session_id)

    service._broadcast_event(
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


def _reconstruct_agents_from_session(
    service: "LLMService",
    session_id: str,
) -> None:
    """Rebuild agent scopes from a just-loaded session's records.

    Per spec specs4/3-llm/history.md § Session-Load
    Reconstruction (steps 2-8). Fetches the session's full
    records via :meth:`HistoryStore.get_session_messages`
    (NOT the context-shape via
    ``get_session_messages_for_context`` — that strips the
    ``agent_blocks`` field) and walks them for assistant
    records carrying both ``turn_id`` and a non-empty
    ``agent_blocks``. Groups by agent ``id`` — when the
    orchestrator retasked the same id across multiple
    turns, the latest record's ``agent_blocks`` entry wins
    as the spawn-time baseline; earlier turns contribute
    archive content but not mode state.

    For each surviving id:

    1. Read ``get_turn_archive(turn_id)`` filtered to the
       agent's ``agent_idx`` for every turn the id appeared
       in. Concatenate in chronological order.
    2. Resolve mode + cross_ref from the latest
       ``agent_blocks`` entry (Commit 1 baseline; Commit 2
       will replay archive system events on top).
    3. Call :func:`reconstruct_agent_scope` to build the
       ContextManager + tracker and register in
       ``service._agent_contexts``.

    Defensive: a single agent's reconstruction raising
    leaves the others reachable. Errors are logged at
    WARNING and the loop continues.

    Records predating Increment A (no ``turn_id``,
    no ``agent_blocks``) are silently skipped — sessions
    saved before agent persistence existed cannot
    reconstruct agents and shouldn't fail to load.
    """
    if service._history_store is None:
        return

    # Fetch the FULL records, not the context-load shape.
    # The context-load shape strips agent_blocks; we need
    # the persisted-record shape that preserves it.
    messages = service._history_store.get_session_messages(
        session_id
    )

    # Walk messages building (id → latest record info).
    # Order matters: later records overwrite earlier ones,
    # so the final dict carries the latest spawn record per
    # id. We also collect (id → list of (turn_id,
    # agent_idx)) so step 4 of the spec algorithm can
    # concatenate archive content from every turn.
    latest_record_by_id: dict[str, dict[str, Any]] = {}
    turn_appearances_by_id: dict[
        str, list[tuple[str, int]]
    ] = {}

    for msg in messages:
        if not isinstance(msg, dict):
            continue
        if msg.get("role") != "assistant":
            continue
        turn_id = msg.get("turn_id")
        agent_blocks = msg.get("agent_blocks")
        if not isinstance(turn_id, str) or not turn_id:
            continue
        if (
            not isinstance(agent_blocks, list)
            or not agent_blocks
        ):
            continue
        for entry in agent_blocks:
            if not isinstance(entry, dict):
                continue
            agent_id = entry.get("id")
            agent_idx = entry.get("agent_idx")
            if (
                not isinstance(agent_id, str)
                or not agent_id
            ):
                continue
            if (
                not isinstance(agent_idx, int)
                or isinstance(agent_idx, bool)
                or agent_idx < 0
            ):
                continue
            # Latest record wins on retask. Each iteration
            # overwrites the previous; final state after the
            # walk is per-id latest.
            latest_record_by_id[agent_id] = {
                "turn_id": turn_id,
                "agent_idx": agent_idx,
                "mode": entry.get("mode"),
                "cross_reference_enabled": entry.get(
                    "cross_reference_enabled"
                ),
                "model": entry.get("model"),
            }
            turn_appearances_by_id.setdefault(
                agent_id, []
            ).append((turn_id, agent_idx))

    if not latest_record_by_id:
        return

    # Reconstruct each surviving id. A single agent failing
    # to reconstruct must not block the rest — hence
    # per-agent try/except.
    for agent_id, latest in latest_record_by_id.items():
        try:
            _reconstruct_one_agent(
                service,
                agent_id=agent_id,
                latest=latest,
                turn_appearances=(
                    turn_appearances_by_id[agent_id]
                ),
            )
        except Exception as exc:
            logger.warning(
                "Failed to reconstruct agent %r on "
                "session-load: %s. Skipping; other agents "
                "continue.",
                agent_id,
                exc,
            )


def _reconstruct_one_agent(
    service: "LLMService",
    *,
    agent_id: str,
    latest: dict[str, Any],
    turn_appearances: list[tuple[str, int]],
) -> None:
    """Reconstruct one agent across all turns it participated in.

    Helper extracted so the per-agent path is small enough
    to read end-to-end. Raises on failure; the caller
    catches and logs.
    """
    # Lazy import to avoid a cycle: _agents imports from
    # _types which is fine, but _rpc_history pulling _agents
    # at module top would create a longer chain.
    from ac_dc.llm._agents import reconstruct_agent_scope

    # Step 4: concatenate archive messages across every turn
    # the agent appeared in, in chronological order.
    # turn_appearances was built by walking messages in
    # chronological order, so it's already sorted.
    concatenated: list[dict[str, Any]] = []
    for turn_id, agent_idx in turn_appearances:
        archive = service._history_store.get_turn_archive(turn_id)
        if not archive:
            # Archive directory missing or empty — turn
            # contributes nothing. Continue with whatever
            # other turns produced.
            continue
        # archive shape: list of {agent_idx, messages}
        for entry in archive:
            if not isinstance(entry, dict):
                continue
            if entry.get("agent_idx") != agent_idx:
                continue
            entry_messages = entry.get("messages")
            if isinstance(entry_messages, list):
                concatenated.extend(entry_messages)

    # Resolve mode + cross_ref from the latest record's
    # agent_blocks entry. This is the spawn-time baseline
    # per Commit 1; Commit 2 will replay archive system
    # events on top of this.
    mode_str = latest.get("mode")
    if isinstance(mode_str, str) and mode_str == "doc":
        mode = Mode.DOC
    elif (
        isinstance(mode_str, str)
        and mode_str.startswith("doc")
    ):
        # "doc+xref" → doc mode with xref on
        mode = Mode.DOC
    else:
        # "code", "code+xref", missing, or unrecognised →
        # default to CODE. The spec's defensive contract:
        # records predating Increment 3a have no mode
        # field; reconstruction should still succeed.
        mode = Mode.CODE

    # cross_reference_enabled has two possible sources:
    # explicit bool field (Increment 3a), or inferred from
    # the mode string's "+xref" suffix. Strict bool check
    # rejects truthy ints — matches the persistence-side
    # validation in HistoryStore.append_message.
    xref_field = latest.get("cross_reference_enabled")
    if isinstance(xref_field, bool):
        cross_ref = xref_field
    elif (
        isinstance(mode_str, str)
        and mode_str.endswith("+xref")
    ):
        cross_ref = True
    else:
        cross_ref = False

    reconstruct_agent_scope(
        service,
        agent_id=agent_id,
        turn_id=latest["turn_id"],
        agent_idx=latest["agent_idx"],
        model=latest.get("model"),
        mode=mode,
        cross_ref=cross_ref,
        archive_messages=concatenated,
    )


def get_history_status(service: "LLMService") -> dict[str, Any]:
    """Return history token counts and compaction status.

    Used by the dialog's history bar to show usage percentage.
    """
    budget = service._context.get_token_budget()
    compaction = service._context.get_compaction_status()
    return {
        "session_id": service._session_id,
        "history_tokens": budget["history_tokens"],
        "max_history_tokens": budget["max_history_tokens"],
        "remaining": budget["remaining"],
        "needs_compaction": budget["needs_compaction"],
        "compaction_enabled": compaction["enabled"],
        "compaction_trigger": compaction["trigger_tokens"],
        "compaction_percent": compaction["percent"],
    }