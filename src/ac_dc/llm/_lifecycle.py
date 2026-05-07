"""Per-request lifecycle helpers and event broadcast.

Extracted from :mod:`ac_dc.llm_service` to keep that module
focused on the service class and its RPC surface. Contains:

- :func:`sync_file_context` — reconcile the scope's
  :class:`FileContext` with the scope's selected-files list.
  Loads newly-selected files from the repo, removes
  deselected ones. Failures log at WARNING so a silently
  unreachable selected file surfaces in the operator log.
- :func:`post_response` — runs after every successful chat
  turn. Stability tracker update, terminal HUD, compaction
  gating + execution. Compaction appends a system event in
  both the context manager and the scope's archival sink.
- :func:`broadcast_event` / :func:`broadcast_event_async` —
  event dispatch helpers. The sync form is fire-and-forget
  from the event loop thread; the async form awaits the
  callback so callers can control ordering (e.g.,
  streamComplete must fire before post-response work).
- :func:`broadcast_enrichment_status` — piggyback on the
  ``modeChanged`` channel so the frontend's one-time
  unavailable toast can fire even when the status flips
  mid-session.

Every function takes the :class:`LLMService` as first
argument. Per-conversation state (context manager,
tracker, session_id, archival sink) flows via
:class:`ConversationScope`; shared infrastructure stays
on ``self``.

Governing spec: :doc:`specs4/3-llm/streaming` § Post-Response.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

from ac_dc.llm._helpers import _build_compaction_event_text

if TYPE_CHECKING:
    from ac_dc.llm._types import ConversationScope
    from ac_dc.llm_service import LLMService

logger = logging.getLogger("ac_dc.llm_service")


# ---------------------------------------------------------------------------
# File context sync
# ---------------------------------------------------------------------------


def sync_file_context(
    service: "LLMService",
    scope: "ConversationScope | None" = None,
) -> None:
    """Reconcile file context with the current selection.

    Adds newly-selected files, removes deselected ones.
    Binary and missing files skip with a WARNING log —
    historical DEBUG-level logging here hid a class of bug
    where a file appeared in the picker and cache viewer
    but never reached the LLM's prompt because its content
    couldn't be read.

    See :meth:`LLMService._sync_file_context` for the full
    invalidation-contract discussion. Summary: this method
    only adds files in ``selected - current`` and removes
    files in ``current - selected``. Content refresh for
    already-present files is driven by two other paths:
    post-edit refresh in ``build_completion_result`` and
    assimilation refresh in ``assimilate_agent_changes``.
    External-editor edits are NOT currently refreshed (known
    hole; workaround is deselect + reselect).
    """
    if scope is None:
        scope = service._default_scope()
    file_context = scope.context.file_context
    current = set(file_context.get_files())
    selected = set(scope.selected_files)

    # Remove files no longer selected.
    for path in current - selected:
        file_context.remove_file(path)

    # Add newly-selected files.
    for path in selected - current:
        if service._repo is None:
            continue
        try:
            file_context.add_file(path)
        except Exception as exc:
            logger.warning(
                "Selected file %s could not be loaded "
                "into context: %s. The LLM will NOT see "
                "this file's content until the error is "
                "resolved.",
                path, exc,
            )


# ---------------------------------------------------------------------------
# Post-response housekeeping
# ---------------------------------------------------------------------------


async def post_response(
    service: "LLMService",
    request_id: str,
    turn_id: str,
    scope: "ConversationScope | None" = None,
) -> None:
    """Stability tracker update, compaction, terminal HUD.

    See :meth:`LLMService._post_response` for the full prose
    describing the order of operations. Summary:

    1. ``_update_stability`` — builds the full active items
       list and runs the tracker update cycle.
    2. Print terminal HUD — three sections per spec.
    3. Compaction — gated on current history token count.
       Emits ``compactionEvent`` progress callbacks. On
       success, appends a system event in both the context
       manager's in-memory history AND the scope's archival
       sink so browsers reloading a prior session see the
       event in their scrollback.

    ``turn_id`` is threaded from :func:`stream_chat` so any
    system event fired during post-response work (compaction
    in particular) inherits the turn's ID. Per
    specs4/3-llm/history.md § Turns, every record produced
    by a user request shares the turn ID.
    """
    if scope is None:
        scope = service._default_scope()

    # Stability update — per-conversation state via scope.
    service._update_stability(scope)

    # Terminal HUD — diagnostic output, reads shared state.
    service._print_post_response_hud()

    # Compaction — gated on current history token count.
    tokens = scope.context.history_token_count()
    if service._compactor.should_compact(tokens):
        await service._broadcast_event_async(
            "compactionEvent",
            request_id,
            {"stage": "compacting"},
        )
        try:
            result = service._compactor.compact_history_if_needed(
                scope.context.get_history(),
                already_checked=True,
            )
        except Exception as exc:
            logger.exception("Compaction failed: %s", exc)
            await service._broadcast_event_async(
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
                scope.context.get_history()
            )
            # Replace history + purge tracker history entries
            # (compacted messages re-enter as fresh active
            # items on the next request).
            scope.context.set_history(result.messages)
            scope.tracker.purge_history()
            # Append a system-event message so users see the
            # compaction in their chat scrollback, and the
            # history browser can search + display past
            # compactions.
            try:
                tokens_after = (
                    scope.context.history_token_count()
                )
                event_text = _build_compaction_event_text(
                    result,
                    tokens_before=tokens,
                    tokens_after=tokens_after,
                    messages_before_count=messages_before_count,
                    messages_after_count=len(result.messages),
                )
                scope.context.add_message(
                    "user", event_text,
                    system_event=True,
                    turn_id=turn_id,
                )
                if scope.archival_append is not None:
                    scope.archival_append(
                        "user",
                        event_text,
                        session_id=scope.session_id,
                        system_event=True,
                        turn_id=turn_id,
                    )
            except Exception:
                logger.exception(
                    "Failed to append compaction system event"
                )
            # Re-read the final message list from context so
            # the broadcast includes the system event we just
            # appended.
            await service._broadcast_event_async(
                "compactionEvent",
                request_id,
                {
                    "stage": "compacted",
                    "case": result.case,
                    "messages": scope.context.get_history(),
                },
            )


# ---------------------------------------------------------------------------
# Event broadcast
# ---------------------------------------------------------------------------


def broadcast_event(
    service: "LLMService",
    event_name: str,
    *args: Any,
) -> None:
    """Fire-and-forget event dispatch from the event loop thread.

    Schedules the async callback if one is attached, otherwise
    drops silently. Never raises — event broadcast is a
    best-effort channel.

    If called from the event loop thread with a running loop,
    ensure_futures the coroutine. If called from a worker
    thread or with no loop, the coroutine is closed cleanly
    to avoid a "was never awaited" warning.
    """
    if service._event_callback is None:
        return
    try:
        coro = service._event_callback(event_name, *args)
    except Exception as exc:
        logger.warning(
            "Event callback construction failed for %s: %s",
            event_name, exc,
        )
        return
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.ensure_future(coro)
        else:
            coro.close()
    except RuntimeError:
        coro.close()


async def broadcast_event_async(
    service: "LLMService",
    event_name: str,
    *args: Any,
) -> None:
    """Await the event callback directly.

    Used from within async code paths where we want to wait
    for the callback to complete before proceeding (e.g.,
    streamComplete ordering before post-response work).
    """
    if service._event_callback is None:
        return
    try:
        await service._event_callback(event_name, *args)
    except Exception as exc:
        logger.warning(
            "Event callback failed for %s: %s",
            event_name, exc,
        )


def broadcast_enrichment_status(service: "LLMService") -> None:
    """Broadcast a modeChanged event with enrichment status.

    Piggybacks on the existing modeChanged channel so the
    frontend's one-time "unavailable" toast can fire even
    when the status flips mid-session (e.g., the user
    reloads the browser during a build that subsequently
    fails at the model-load step).

    The payload carries the current mode and cross-reference
    state alongside the enrichment status, so the frontend's
    modeChanged handler sees a consistent snapshot. No mode
    change actually occurs — the handler's same-mode
    short-circuit applies, so cross-reference state is
    preserved.
    """
    broadcast_event(
        service,
        "modeChanged",
        {
            "mode": service._context.mode.value,
            "cross_ref_enabled": service._cross_ref_enabled,
            "enrichment_status": service._enrichment_status,
        },
    )