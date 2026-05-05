"""Streaming RPC entry-point logic extracted from :mod:`ac_dc.llm_service`.

Three functions:

- :func:`chat_streaming` — the public RPC the browser calls.
  Validates init-complete, parses the agent_tag, resolves the
  conversation scope, checks the single-stream guard, registers
  the active request, and fires the background streaming task.
- :func:`cancel_streaming` — mark a request for cancellation.
  The worker thread polls the cancellation set and breaks out
  on the next chunk.
- :func:`is_child_request` — classify a request ID as a child
  of the active user-initiated parent, per the
  ``{parent}-agent-N`` convention. Used by the single-stream
  guard to let child streams through.

The actual streaming pipeline (``_stream_chat``) lives in
:mod:`ac_dc.llm._streaming`; this module is the entry-point
wrapper that decides *whether* streaming should happen and
*which scope* it runs against.

Governing specs:
:doc:`specs4/3-llm/streaming`,
:doc:`specs4/7-future/parallel-agents`.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

from ac_dc.llm._types import ConversationScope

if TYPE_CHECKING:
    from ac_dc.llm_service import LLMService

logger = logging.getLogger("ac_dc.llm_service")


# ---------------------------------------------------------------------------
# Child request classification
# ---------------------------------------------------------------------------


def is_child_request(
    service: "LLMService",
    request_id: str,
) -> bool:
    """Return True when ``request_id`` is a child of the active parent.

    Per specs4/7-future/parallel-agents.md § Transport, agent
    streams carry request IDs of the form
    ``{parent_id}-agent-N``. The single-stream guard uses this
    classifier to let child streams through while blocking
    genuinely-concurrent user streams.

    Returns False when no user-initiated stream is active, and
    False when the request ID is the parent ID itself — an
    exact-match duplicate is treated as a conflict.
    """
    parent = service._active_user_request
    if parent is None:
        return False
    if request_id == parent:
        return False
    return request_id.startswith(parent + "-")


# ---------------------------------------------------------------------------
# Streaming entry point
# ---------------------------------------------------------------------------


async def chat_streaming(
    service: "LLMService",
    request_id: str,
    message: str,
    files: list[str] | None = None,
    images: list[str] | None = None,
    excluded_urls: list[str] | None = None,
    agent_tag: str | None = None,
) -> dict[str, Any]:
    """Start a streaming chat request.

    Returns ``{"status": "started"}`` synchronously; chunks and
    the completion arrive via the event callback. Rejects if
    the service isn't fully initialised, if the ``agent_tag``
    is malformed or stale, or if another stream is active for
    the same scope (main conversation OR the tagged agent).

    ``agent_tag`` is the agent's LLM-chosen id (a non-empty
    string) when routing to an agent scope, or None for the
    main conversation. Empty strings and non-string values
    are rejected as malformed. Unknown ids return
    ``{"error": "agent not found"}`` — distinct from
    malformed so the frontend can surface different toasts
    for "tab is stale" vs "frontend bug".

    See :meth:`LLMService.chat_streaming` for the full prose
    on single-stream guard scoping and agent_tag semantics.
    """
    # Capture event loop on the RPC thread — this is the
    # event-loop thread. D10 contract: the capture happens
    # HERE, not inside the background task.
    service._main_loop = asyncio.get_event_loop()

    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted

    if not service._init_complete:
        return {
            "error": (
                "Server is still initializing — please wait "
                "a moment"
            )
        }

    # Resolve the scope.
    agent_key: str | None = None
    scope: ConversationScope
    if agent_tag is None:
        scope = service._default_scope()
    else:
        # Validate shape: non-empty string. Reject everything
        # else as malformed so callers get the actionable
        # error message rather than a confusing "agent not
        # found" for what's actually a frontend bug.
        if not isinstance(agent_tag, str) or not agent_tag:
            return {
                "error": (
                    "Malformed agent_tag — expected a "
                    "non-empty agent id string"
                )
            }
        agent_scope = service._agent_contexts.get(agent_tag)
        if agent_scope is None:
            return {"error": "agent not found"}
        agent_key = agent_tag
        scope = agent_scope

    # Single-stream guard. Per-agent for tagged calls; main-
    # session slot for untagged calls.
    if agent_key is not None:
        if agent_key in service._active_agent_streams:
            return {
                "error": (
                    f"Another stream is active for agent "
                    f"{agent_key}"
                )
            }
        service._active_agent_streams.add(agent_key)
    else:
        if (
            service._active_user_request is not None
            and not service._is_child_request(request_id)
        ):
            return {
                "error": (
                    f"Another stream is active (request "
                    f"{service._active_user_request})"
                )
            }
        if not service._is_child_request(request_id):
            service._active_user_request = request_id

    # Launch the background task.
    asyncio.ensure_future(
        service._stream_chat(
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


# ---------------------------------------------------------------------------
# Cancellation
# ---------------------------------------------------------------------------


def cancel_streaming(
    service: "LLMService",
    request_id: str,
) -> dict[str, Any]:
    """Signal a streaming request to abort.

    The worker thread polls the cancellation set on each chunk
    and breaks out when it finds its ID. The background task's
    finally handler clears the active-request flag and fires
    streamComplete with cancelled=True.

    Accepts any request id from a localhost caller without
    checking it against the active main request. Three classes
    of id legitimately need to be cancellable:

    1. The main user-initiated request id, when it's the
       currently-active stream.
    2. Child agent request ids of shape ``{parent}-agent-NN``,
       which are running concurrently while the parent main
       LLM finalises (or after it has completed — agent streams
       outlive their parent).
    3. Stale/unknown ids — the worker's membership check
       (``request_id in service._cancelled_requests``) is the
       authoritative consumer; an id that doesn't match any
       live stream is harmless noise in the set.

    The previous guard rejected (2) outright because the child
    id never equals ``_active_user_request``. With the guard
    removed, ``Stop`` on an agent tab now reaches the worker.
    """
    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted
    service._cancelled_requests.add(request_id)
    return {"status": "cancelling"}