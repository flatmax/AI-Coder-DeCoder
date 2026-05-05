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

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ac_dc.llm_service import LLMService


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