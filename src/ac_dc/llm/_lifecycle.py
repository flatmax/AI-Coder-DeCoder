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

    Files rejected as binary (xlsx, pdf, png, zip, etc.)
    are additionally surfaced to the frontend via a
    ``binaryFilesSkipped`` server-push event so the user
    sees a toast naming the dropped files. Without this
    broadcast the rejection is invisible — the file stays
    checked in the picker but the LLM never sees its
    content, leading to confusing "I can't find that file"
    responses. See specs4/5-webapp/file-picker.md
    § Binary File Selection.

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

    # Track binary-rejected paths so we can fire one
    # toast at the end rather than one per file.
    binary_skipped: list[str] = []

    # Track externally-deleted paths so we can broadcast
    # filesChanged once after the loop completes. Under
    # D36, files deleted from disk get pruned from the
    # tracker by update_stability's existing_files sweep
    # (tracker.update → _remove_stale drops their file:
    # entries). The bug this fixes is upstream: without
    # this trim, FileContext keeps the file's pre-deletion
    # bytes AND scope.selected_files keeps the path, so
    # update_stability re-registers file:<path> in
    # active_items every turn and prompt assembly renders
    # stale content for a file that no longer exists.
    deleted_from_disk: list[str] = []

    # Add newly-selected files.
    for path in selected - current:
        if service._repo is None:
            continue
        try:
            file_context.add_file(path)
        except Exception as exc:
            # The repo layer signals binary rejection with
            # a specific message prefix; we match on it
            # rather than introducing a new exception type
            # because RepoError is already widely caught
            # and we don't want to narrow that contract.
            if "Binary file cannot be read as text" in str(exc):
                binary_skipped.append(path)
            logger.warning(
                "Selected file %s could not be loaded "
                "into context: %s. The LLM will NOT see "
                "this file's content until the error is "
                "resolved.",
                path, exc,
            )

    # Refresh content for files that stayed selected across
    # turns. Without this step, externally-edited files
    # (changes made outside the webapp — another editor,
    # a script, a `git checkout`) are never re-read: the
    # membership-only diff above sees them in both `current`
    # and `selected` and skips them. The cached L3 copy then
    # stays stale until the user deselects + reselects, which
    # the picker forbids while the file is dirty.
    #
    # We re-read every selected file every turn and let
    # FileContext.add_file overwrite the in-memory copy. The
    # tracker's hash-mismatch demotion in _update_stability
    # then naturally invalidates the cached entry.
    #
    # Cost: one disk read per selected file per turn. Cheap
    # next to LLM round-trip; revisit with mtime gating if
    # large selections become a hotspot. The repo layer
    # already enforces binary rejection, so the same
    # exception path applies.
    for path in selected & current:
        if service._repo is None:
            continue
        # Probe disk before attempting to read. file_exists
        # is a cheap stat (no content read) and gives us a
        # clean signal for "user removed this file outside
        # the app" — distinct from binary rejection or
        # transient read errors. Without this probe, a
        # missing file would raise RepoError from add_file,
        # the exception handler would log a warning, and
        # FileContext would keep its pre-deletion snapshot
        # — leaving the prompt stale until session restart.
        if not service._repo.file_exists(path):
            deleted_from_disk.append(path)
            file_context.remove_file(path)
            logger.warning(
                "Selected file %s was deleted from disk "
                "outside the application; clearing from "
                "context. The stability tracker will "
                "transition its entry to a deletion "
                "marker on the next update cycle.",
                path,
            )
            continue
        try:
            old_content = file_context.get_content(path)
            file_context.add_file(path)
            new_content = file_context.get_content(path)
            if old_content != new_content:
                logger.debug(
                    "Refreshed disk content for selected "
                    "file %s (size %d -> %d)",
                    path,
                    len(old_content) if old_content else 0,
                    len(new_content) if new_content else 0,
                )
        except Exception as exc:
            if "Binary file cannot be read as text" in str(exc):
                binary_skipped.append(path)
            logger.warning(
                "Selected file %s could not be refreshed "
                "from disk: %s. The LLM may see a stale "
                "version of this file.",
                path, exc,
            )

    if deleted_from_disk:
        # Mirror the binary-skip path: trim the deleted
        # paths from scope.selected_files so the picker
        # checkbox clears and update_stability stops
        # seeing the path in its active_items build.
        # The tracker's _remove_stale runs against the
        # fresh existing_files set computed by
        # update_stability and transitions the entry to
        # a deletion marker. With selected_files no
        # longer carrying the path, the next turn's
        # active_items dict won't re-register it, so
        # the marker survives in the tracker and prompt
        # assembly renders the marker text instead of
        # stale FileContext content.
        for path in deleted_from_disk:
            try:
                scope.selected_files.remove(path)
            except ValueError:
                pass

        broadcast_event(
            service,
            "filesChanged",
            list(scope.selected_files),
        )
        # Reuse the binaryFilesSkipped channel for the
        # toast. The frontend's app-shell handler renders
        # a generic "files removed from context" message;
        # we extend the payload with a kind hint so the
        # shell can differentiate the wording. Keeping
        # the channel shared avoids a second event type
        # for what's structurally the same UX: "these
        # paths just left your selection, here's why".
        broadcast_event(
            service,
            "binaryFilesSkipped",
            {
                "paths": sorted(deleted_from_disk),
                "kind": "deleted",
            },
        )

    if binary_skipped:
        # Trim the rejected paths from the scope's
        # selection list so the picker's checkboxes
        # clear and the LLM stops seeing them as
        # "selected but missing". The mutation is
        # in-place via list.remove rather than
        # rebinding, so any caller holding a reference
        # to the same list (notably service._selected_files
        # for the main scope, which default_scope passes
        # by reference) sees the update too.
        #
        # Agent scopes have their own selected_files
        # list — the trim is local to the agent and
        # doesn't touch the user-facing selection.
        # Spec: specs4/3-llm/context-model.md
        # § Binary file rejection at sync time
        for path in binary_skipped:
            try:
                scope.selected_files.remove(path)
            except ValueError:
                # Already absent (concurrent removal,
                # or path normalisation drift between
                # selection and FileContext). Harmless
                # — the broadcast still goes out with
                # whatever the current selection is.
                pass

        # Broadcast the trimmed selection so the picker
        # checkbox clears. Fires before the toast event
        # so the visual update lands first; the toast
        # then explains why.
        broadcast_event(
            service,
            "filesChanged",
            list(scope.selected_files),
        )
        # Toast event with the rejected paths.
        broadcast_event(
            service,
            "binaryFilesSkipped",
            {"paths": sorted(binary_skipped)},
        )


# ---------------------------------------------------------------------------
# Post-response housekeeping
# ---------------------------------------------------------------------------


async def post_response(
    service: "LLMService",
    request_id: str,
    turn_id: str,
    scope: "ConversationScope | None" = None,
    request_usage: dict[str, Any] | None = None,
) -> None:
    """Stability tracker update, compaction, terminal HUD.

    See :meth:`LLMService._post_response` for the full prose
    describing the order of operations. Summary:

    1. ``_update_stability`` — builds the full active items
       list and runs the tracker update cycle.
    2. Print terminal HUD — five sections per spec.
       ``request_usage`` is forwarded so the HUD can show a
       "Last Request" section alongside session totals;
       None on cancelled/error paths suppresses that
       section.
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
    service._print_post_response_hud(request_usage)

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

    # Post-response work has settled — tier state is final,
    # any compaction has completed, and downstream consumers
    # can now read consistent breakdown data. Fire a
    # dedicated event so the Context tab knows when to
    # refetch.
    #
    # ``streamComplete`` fires earlier (in
    # :func:`stream_chat`) for snappy chat-panel UX — the
    # user sees their response finalised the moment the
    # LLM call returns. But that broadcast races
    # ``_update_stability``: if the Context tab refetches
    # on ``streamComplete``, it reads pre-update tracker
    # state and shows stale tiers. The user then has to
    # click Refresh to see the new state, which is what
    # they reported.
    #
    # ``postResponseComplete`` is the "everything is now
    # consistent" signal. The Context tab listens to it
    # for tier/breakdown refreshes; the chat panel
    # continues to use ``streamComplete`` for response
    # finalisation. Two events with two distinct purposes,
    # neither one blocking the other's UX.
    await service._broadcast_event_async(
        "postResponseComplete", request_id,
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