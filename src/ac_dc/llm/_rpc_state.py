"""State-mutating RPC handlers — mode, selection, session, agent lifecycle.

Extracted from :mod:`ac_dc.llm_service` to keep that module
focused on construction and the streaming entry point. These
are the RPCs the frontend calls to drive UI state changes:

- :func:`set_selected_files` / :func:`get_selected_files` —
  main-tab file picker state.
- :func:`set_excluded_index_files` — three-state checkbox
  exclusions. Removes matching entries from every mode's
  tracker so stale entries don't linger in the cache viewer.
- :func:`switch_mode` — code ↔ doc transition. Swaps system
  prompt, stability tracker, and records a system event.
- :func:`set_cross_reference` — enable/disable the opposite-
  index overlay. Readiness-gated on ``_doc_index_ready``.
- :func:`new_session` — wipe conversation, clear agent
  registry, broadcast sessionChanged.
- :func:`close_agent_context` / :func:`set_agent_selected_files`
  — per-agent lifecycle (C1b).
- :func:`refresh_system_prompt` — re-read prompt from config
  after a settings reload, respecting review mode.

Every function takes :class:`LLMService` as first argument.
The service's public methods stay as thin delegators so
callers (tests, JRPC-OO surface) continue to call
``service.switch_mode(...)``.

Governing specs:
:doc:`specs4/3-llm/modes`,
:doc:`specs4/5-webapp/file-picker`,
:doc:`specs4/5-webapp/agent-browser`.
"""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING, Any

from ac_dc.context_manager import Mode
from ac_dc.stability_tracker import StabilityTracker

if TYPE_CHECKING:
    from ac_dc.llm_service import LLMService

logger = logging.getLogger("ac_dc.llm_service")


# ---------------------------------------------------------------------------
# File selection
# ---------------------------------------------------------------------------


def set_selected_files(
    service: "LLMService",
    files: list[str],
) -> list[str] | dict[str, Any]:
    """Replace the selected-files list.

    Stored as a copy so caller mutations don't leak.
    Filters non-existent files when a repo is attached —
    the selection should never contain a phantom path.
    Broadcasts ``filesChanged`` to all connected clients.
    """
    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted
    if service._repo is not None:
        valid = [
            p for p in files
            if isinstance(p, str) and service._repo.file_exists(p)
        ]
    else:
        valid = [p for p in files if isinstance(p, str)]
    service._selected_files = valid
    service._broadcast_event("filesChanged", valid)
    return list(service._selected_files)


def get_selected_files(service: "LLMService") -> list[str]:
    """Return a copy of the selected-files list."""
    return list(service._selected_files)


# ---------------------------------------------------------------------------
# Excluded index files
# ---------------------------------------------------------------------------


def set_excluded_index_files(
    service: "LLMService",
    files: list[str],
    invalidate_l0: bool = False,
) -> list[str] | dict[str, Any]:
    """Store the set of files excluded from the index.

    Excluded files have no content, no index block, and no
    tracker item. Removes matching entries from EVERY mode's
    tracker — without this, excluding files in one mode
    leaves stale entries in the other mode's tracker,
    visible in the cache viewer after a mode switch.

    L0 invalidation is asymmetric:

    - **Inclusions** (a previously-excluded file removed
      from the exclusion list): always refreeze. The
      aggregate map gains the file's structural block; the
      user expects to see it in context immediately.
    - **Exclusions** (a file added to the exclusion list):
      only refreeze when ``invalidate_l0=True``. Mid-session
      exclusion is uncommon and an L0 refresh costs a full
      cache write. The webapp prompts the user with
      "Invalidate L0 cache to apply now, or leave the cache
      stale until the next L0-invalidating event?" and
      passes the user's choice via ``invalidate_l0``.

    See specs4/3-llm/cache-tiering.md § What invalidates L0
    (items 7 and 8) for the full semantics.
    """
    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted

    old_excluded = set(service._excluded_index_files)
    new_excluded = set(files)
    has_inclusions = bool(old_excluded - new_excluded)
    has_exclusions = bool(new_excluded - old_excluded)

    service._excluded_index_files = list(files)
    for tracker in service._trackers.values():
        for path in files:
            for prefix in ("symbol:", "doc:", "file:"):
                key = prefix + path
                if tracker.has_item(key):
                    all_items = tracker.get_all_items()
                    item = all_items.get(key)
                    if item is not None:
                        tracker._items.pop(key, None)
                        tracker.mark_broken(
                            item.tier, "user excluded file"
                        )

    # L0 invalidation policy. Inclusions always refreeze
    # (file's block must appear in the map now); exclusions
    # only refreeze when the caller opted in.
    should_refreeze = has_inclusions or (
        has_exclusions and bool(invalidate_l0)
    )
    if should_refreeze:
        service._freeze_l0_snapshot()

    service._broadcast_event(
        "filesChanged", list(service._selected_files)
    )
    return list(service._excluded_index_files)


# ---------------------------------------------------------------------------
# Mode switching
# ---------------------------------------------------------------------------


def switch_mode(
    service: "LLMService",
    mode: str,
) -> dict[str, Any]:
    """Switch between code and document mode.

    See :meth:`LLMService.switch_mode` for full prose.
    Sequence: validate → reset cross-ref → lazy-construct
    target tracker → swap prompt → swap tracker → update
    mode flag → initialize if first entry → record system
    event → broadcast.
    """
    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted
    try:
        target = Mode(mode)
    except ValueError:
        return {
            "error": (
                f"Unknown mode {mode!r}; expected 'code' or 'doc'"
            )
        }

    current = service._context.mode
    if target == current:
        return {
            "mode": target.value,
            "message": f"Already in {target.value} mode",
        }

    # Cross-reference resets on mode switch. Remove cross-ref
    # items from the CURRENT tracker before swapping so the
    # removal runs against the right prefix.
    if service._cross_ref_enabled:
        service._remove_cross_reference_items()
        service._cross_ref_enabled = False

    if target not in service._trackers:
        service._trackers[target] = StabilityTracker(
            cache_target_tokens=(
                service._config.cache_target_tokens_for_model()
            ),
        )

    if target == Mode.DOC:
        new_prompt = service._config.get_doc_system_prompt()
    else:
        new_prompt = service._config.get_system_prompt()
    service._context.set_system_prompt(new_prompt)

    service._stability_tracker = service._trackers[target]
    service._context.set_stability_tracker(service._stability_tracker)
    service._context.set_mode(target)

    # Init target mode's tracker if this is the first entry.
    service._try_initialize_stability()

    # Refreeze L0 — system prompt swapped, primary index
    # swapped from symbol→doc (or vice versa). L0's bytes
    # change wholesale; cache write is unavoidable here
    # but bounded (one per mode switch, not one per turn).
    # See specs4/3-llm/cache-tiering.md § What invalidates L0.
    service._freeze_l0_snapshot()

    event_text = f"Switched to {target.value} mode."
    service._context.add_message(
        "user", event_text, system_event=True
    )
    if service._history_store is not None:
        service._history_store.append_message(
            session_id=service._session_id,
            role="user",
            content=event_text,
            system_event=True,
        )

    service._broadcast_event("modeChanged", {"mode": target.value})
    return {"mode": target.value}


def set_cross_reference(
    service: "LLMService",
    enabled: bool,
) -> dict[str, Any]:
    """Toggle cross-reference mode.

    Enable requires ``_doc_index_ready``; disable is always
    allowed. Seeds/removes cross-ref items so content changes
    apply on the very next request.
    """
    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted
    new_state = bool(enabled)
    if new_state == service._cross_ref_enabled:
        return {
            "status": "ok",
            "cross_ref_enabled": new_state,
        }

    if new_state and not service._doc_index_ready:
        return {
            "error": "cross-reference not ready",
            "reason": (
                "Doc index is still building; try again "
                "in a moment"
            ),
        }

    service._cross_ref_enabled = new_state
    if new_state:
        service._seed_cross_reference_items()
    else:
        service._remove_cross_reference_items()

    # Refreeze L0 — secondary aggregate map and legend
    # added (enable) or removed (disable). L0's bytes
    # change in either direction. See
    # specs4/3-llm/cache-tiering.md § What invalidates L0.
    service._freeze_l0_snapshot()

    service._broadcast_event(
        "modeChanged",
        {
            "mode": service._context.mode.value,
            "cross_ref_enabled": new_state,
        },
    )
    return {
        "status": "ok",
        "cross_ref_enabled": new_state,
    }


# ---------------------------------------------------------------------------
# System prompt refresh
# ---------------------------------------------------------------------------


def refresh_system_prompt(service: "LLMService") -> dict[str, Any]:
    """Re-read the current mode's system prompt from config.

    Called by Settings after a successful ``reload_app_config``
    so app-config changes that affect prompt composition take
    effect on the next LLM request. Respects review mode —
    skips the refresh when review is active so the review
    prompt isn't clobbered.

    Also re-registers the prompt with the stability tracker so
    the cache viewer's ``system:<hash>`` entry reflects the
    new content immediately, without waiting for the next
    ``_post_response`` cycle. Includes the symbol-index legend
    in the hash exactly like :func:`try_initialize_stability`
    and :func:`update_stability` do, so the hash matches what
    those paths would produce on the next turn — otherwise
    we'd churn the cache one extra time.
    """
    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted
    if service._review_active:
        return {
            "status": "skipped",
            "reason": "review mode active",
        }
    if service._context.mode == Mode.DOC:
        prompt = service._config.get_doc_system_prompt()
    else:
        prompt = service._config.get_system_prompt()
    has_appendix = "Agent-Spawn Capability" in prompt

    # Capture old prompt BEFORE setting new one, so we can
    # detect whether the bytes actually changed. Settings
    # reloads that don't touch the system prompt (e.g., a
    # save that only edits compaction config) must NOT
    # invalidate L0 — that would force a 315K cache write
    # for nothing. Per specs4/3-llm/cache-tiering.md § What
    # invalidates L0: settings reloads that leave the
    # prompt bytes unchanged do NOT invalidate L0.
    old_prompt = service._context.get_system_prompt()
    prompt_changed = (old_prompt != prompt)
    service._context.set_system_prompt(prompt)

    # Re-register with the tracker so the cache viewer's
    # system:<hash> row updates immediately. Must hash the
    # same combined prompt+legend string that the stability
    # paths hash, or we'll mint a different key here than
    # update_stability will mint on the next turn and
    # trigger an unnecessary L0 churn.
    import hashlib
    if service._context.mode == Mode.DOC:
        legend = service._doc_index.get_legend()
    else:
        legend = ""
        if service._symbol_index is not None:
            try:
                legend = service._symbol_index.get_legend()
            except Exception:
                legend = ""
    combined = prompt + ("\n\n" + legend if legend else "")
    prompt_hash = hashlib.sha256(combined.encode()).hexdigest()
    tokens = service._counter.count(combined)
    try:
        service._stability_tracker.register_system_prompt(
            prompt_hash, tokens
        )
    except Exception as exc:
        logger.warning(
            "refresh_system_prompt: tracker update failed: %s",
            exc,
        )

    # Refreeze L0 only when the prompt bytes actually
    # changed. A no-op refresh (Settings reload that didn't
    # touch the prompt) must skip the freeze; otherwise
    # every "Save" in the Settings tab would force a full
    # L0 cache write.
    if prompt_changed:
        service._freeze_l0_snapshot()

    return {
        "status": "ok",
        "mode": service._context.mode.value,
        "prompt_len": len(prompt),
        "appendix_present": has_appendix,
        "prompt_changed": prompt_changed,
    }


# ---------------------------------------------------------------------------
# Session lifecycle
# ---------------------------------------------------------------------------


def new_session(service: "LLMService") -> dict[str, Any]:
    """Start a fresh session — close all live agents and reset state.

    Per the "Agents as first-class persistent entities" plan
    (Increment 2 in IMPLEMENTATION_NOTES.md), ``new_session``
    is "the entire conversation thread of the session goes
    with it — including agents". This supersedes the earlier
    "agents survive new_session" policy: the frontend
    rendered the new-session button on every tab including
    agents but only ever reset main, producing the
    "I clicked new session and nothing happened" UX bug.

    Sequence (order matters for frontend coherence):

    1. Generate a fresh session id and clear main's history,
       URL context, and fetched URLs.
    2. Cancel any in-flight agent streams by clearing
       ``_active_agent_streams``. The streaming loop checks
       this set per-chunk; clearing it signals stop.
    3. Snapshot the current agent ids, clear
       ``_agent_contexts`` to free memory and tracker state.
    4. Broadcast ``agentClosed`` per snapshot id so the
       frontend dissolves each tab. The frontend's existing
       handler removes the tab and frees per-tab state.
    5. Broadcast ``sessionChanged`` last so the chat panel
       reloads main's empty history after the agents have
       gone.

    Per-agent archive files on disk survive — closing an
    agent frees memory; the transcript stays readable via
    :meth:`LLMService.get_turn_archive`.
    """
    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted
    if service._history_store is not None:
        from ac_dc.history_store import HistoryStore
        service._session_id = HistoryStore.new_session_id()
    else:
        service._session_id = (
            f"sess_{int(time.time() * 1000)}_nostore"
        )
    service._context.clear_history()
    # Wipe URL state alongside chat history. Without this,
    # _fetched URLs and the prompt's url_context survive
    # across sessions — the user starts a "fresh" session
    # but every turn still carries the previous session's
    # URL content (and the HUD chips still list them).
    # Filesystem cache is preserved; only this session's
    # active URL context is cleared.
    service._context.clear_url_context()
    if service._url_service is not None:
        service._url_service.clear_fetched()
    # Cancel any in-flight agent streams. The streaming
    # loop checks this set per chunk; clearing it signals
    # the agent task to stop. Doing this BEFORE clearing
    # _agent_contexts avoids a race where the agent task
    # finishes a chunk, looks up its scope to write to the
    # archive, and finds nothing.
    closed_agent_ids = list(service._agent_contexts.keys())
    service._active_agent_streams.clear()
    # Drop scopes — frees ContextManager + StabilityTracker
    # + file_context for each agent. Archive files on disk
    # survive (per-turn archive paths are independent of
    # the in-memory registry).
    service._agent_contexts.clear()
    # Broadcast per-agent close events so the frontend's
    # existing tab-removal path runs for each. Order is
    # before sessionChanged because the frontend's
    # sessionChanged handler reloads main's history; if the
    # agent tabs were still around at that point they'd
    # briefly show as live with empty histories before the
    # close events arrived.
    for agent_id in closed_agent_ids:
        service._broadcast_event(
            "agentClosed", {"agent_id": agent_id}
        )
    service._broadcast_event(
        "sessionChanged",
        {"session_id": service._session_id, "messages": []},
    )
    return {"session_id": service._session_id}


# ---------------------------------------------------------------------------
# Agent lifecycle (C1b)
# ---------------------------------------------------------------------------


def close_agent_context(
    service: "LLMService",
    agent_id: str,
) -> dict[str, Any]:
    """Free an agent's ContextManager + tracker + file_context.

    Called when the user clicks ✕ on an agent tab. Identifies
    the agent by its LLM-chosen id (the same id used in
    ``🟧🟧🟧 AGENT`` blocks). Idempotent — unknown id returns
    ``closed: False`` rather than raising. Archive files on
    disk survive; transcripts remain readable via
    :meth:`LLMService.get_turn_archive` for any turn this
    agent participated in.
    """
    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted
    if not isinstance(agent_id, str) or not agent_id:
        return {"status": "ok", "closed": False}
    scope = service._agent_contexts.pop(agent_id, None)
    if scope is None:
        return {"status": "ok", "closed": False}
    return {"status": "ok", "closed": True}


def set_agent_selected_files(
    service: "LLMService",
    agent_id: str,
    files: list[str],
) -> list[str] | dict[str, Any]:
    """Replace an agent's selected-files list.

    Per-agent analogue of :func:`set_selected_files`. Identifies
    the agent by its LLM-chosen id. Replaces in-place so the
    scope's stored list identity is preserved — downstream code
    holds references to ``scope.selected_files``. No
    ``filesChanged`` broadcast — agent selection is per-tab; a
    broadcast would overwrite other clients' main-tab or
    different-agent-tab state.
    """
    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted
    if not isinstance(agent_id, str) or not agent_id:
        return {"error": "agent not found"}
    scope = service._agent_contexts.get(agent_id)
    if scope is None:
        return {"error": "agent not found"}
    if service._repo is not None:
        valid = [
            p for p in files
            if isinstance(p, str) and service._repo.file_exists(p)
        ]
    else:
        valid = [p for p in files if isinstance(p, str)]
    scope.selected_files.clear()
    scope.selected_files.extend(valid)
    return list(scope.selected_files)


def set_agent_excluded_index_files(
    service: "LLMService",
    agent_id: str,
    files: list[str],
) -> list[str] | dict[str, Any]:
    """Replace an agent's excluded-index-files list.

    Per-agent analogue of :func:`set_excluded_index_files`.
    Identifies the agent by its LLM-chosen id. Excluded files
    have no content, no index block, and no tracker item in
    the agent's scope. Mirrors the selection RPC shape:
    ``{error: "agent not found"}`` when the tab has been
    closed, otherwise returns the canonical list.

    Unlike the main-conversation version, this does NOT remove
    stale tracker entries from every mode's tracker — agent
    scopes carry a single StabilityTracker with no mode switch,
    so there's nothing to purge beyond the active tracker.
    No ``filesChanged`` broadcast — agent-tab state is not
    shared across clients.
    """
    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted
    if not isinstance(agent_id, str) or not agent_id:
        return {"error": "agent not found"}
    scope = service._agent_contexts.get(agent_id)
    if scope is None:
        return {"error": "agent not found"}
    valid = [p for p in files if isinstance(p, str)]
    scope.excluded_index_files = list(valid)
    # Drop matching entries from the agent's tracker so stale
    # rows don't linger in the cache viewer's per-agent view.
    tracker = scope.tracker
    for path in valid:
        for prefix in ("symbol:", "doc:", "file:"):
            key = prefix + path
            if tracker.has_item(key):
                all_items = tracker.get_all_items()
                item = all_items.get(key)
                if item is not None:
                    tracker._items.pop(key, None)
                    tracker.mark_broken(
                        item.tier, "agent excluded file"
                    )
    return list(valid)


# ---------------------------------------------------------------------------
# Per-agent mode and cross-reference (Increment 4a)
# ---------------------------------------------------------------------------


# Valid mode strings — same set the parser and history store
# accept. Kept as a module-level constant rather than a per-
# function literal so a future mode addition is a single edit.
_VALID_AGENT_MODES = frozenset(
    {"code", "doc", "code+xref", "doc+xref"}
)


def _parse_agent_mode_string(
    mode: str,
) -> tuple[Mode, bool] | None:
    """Decompose a mode string into ``(Mode, cross_ref)``.

    Returns ``None`` when the input isn't one of the four
    valid mode strings. Used by :func:`switch_agent_mode` to
    flatten the wire format (a single string carrying both
    axes) back into the two ContextManager fields.
    """
    if mode == "code":
        return Mode.CODE, False
    if mode == "doc":
        return Mode.DOC, False
    if mode == "code+xref":
        return Mode.CODE, True
    if mode == "doc+xref":
        return Mode.DOC, True
    return None


def _format_agent_mode(
    mode: Mode, cross_ref: bool,
) -> str:
    """Inverse of :func:`_parse_agent_mode_string`.

    Used to render the agent's current mode for archive
    system events and broadcast payloads. Mirrors the
    format ``_format_mode`` in ``_agents.py`` produces for
    the descriptor / spawn payload.
    """
    base = "doc" if mode == Mode.DOC else "code"
    return f"{base}+xref" if cross_ref else base


def _rebuild_agent_tracker(
    service: "LLMService",
    scope: Any,
) -> None:
    """Replace the agent's tracker with a fresh instance.

    Called by :func:`switch_agent_mode` and
    :func:`set_agent_cross_reference` after a mode/xref
    change. The existing tier placements were valid for the
    old prompt + index combination; the new combination
    invalidates every cached prefix, so a fresh tracker is
    the correct starting state for the next turn.

    The agent's conversation history, file context, and
    selection are preserved — they live on the
    ``ContextManager``, not the tracker. Provider cache
    warmth is lost (all four tiers cold on next call); that
    cost is the unavoidable price of switching the agent's
    repo-view shape.
    """
    new_tracker = StabilityTracker(
        cache_target_tokens=(
            service._config.cache_target_tokens_for_model()
        ),
    )
    scope.tracker = new_tracker
    scope.context.set_stability_tracker(new_tracker)


def switch_agent_mode(
    service: "LLMService",
    agent_id: str,
    mode: str,
) -> dict[str, Any]:
    """Switch a specific agent's mode.

    Per-agent analogue of :func:`switch_mode`. Identifies
    the agent by its LLM-chosen id. Accepts the four
    combined mode strings used elsewhere on the wire —
    ``code`` / ``doc`` / ``code+xref`` / ``doc+xref`` — and
    flattens them into the agent's ContextManager's two
    axes (``mode`` + ``cross_reference_enabled``).

    Mid-stream changes are rejected: an agent with an entry
    in :attr:`LLMService._active_agent_streams` is currently
    executing, and switching mode mid-flight would leave the
    cached tier prefix mismatched against the new prompt.
    Frontend renders the agent's tab with a flashing-cyan
    LED in this state; the rejection toast tells the user
    to wait for the stream to finish.

    Sequence:

    1. Validate id and mode shape; check guard slot.
    2. Resolve the existing scope and its current
       (mode, cross_ref) pair.
    3. Compute the new pair from ``mode``. Same as current
       → no-op return.
    4. Update the ContextManager.
    5. Rebuild the stability tracker (every tier
       invalidated by the prompt/index change).
    6. Write a mode-change system event to the agent's
       archive via ``scope.archival_append``. Survives
       across server restarts so reconstruction (Increment
       5) can replay the change history to arrive at the
       agent's final mode.
    7. Broadcast ``agentModeChanged`` so the frontend
       updates the tab's tooltip and any LED state.

    Returns ``{status: "ok", agent_id: str, mode: str}`` on
    success. ``mode`` in the response carries the combined
    string (mirrors the input format).

    Per :doc:`specs4/7-future/parallel-agents` § Per-agent
    state descriptor — the orchestrator's prompt-time
    descriptor reads each agent's current mode from its
    ``ContextManager``, so a successful switch is visible
    to the orchestrator on its very next turn without any
    further wiring.
    """
    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted
    if not isinstance(agent_id, str) or not agent_id:
        return {"error": "agent not found"}
    scope = service._agent_contexts.get(agent_id)
    if scope is None:
        return {"error": "agent not found"}
    if not isinstance(mode, str) or mode not in _VALID_AGENT_MODES:
        return {
            "error": "invalid mode",
            "reason": (
                f"Mode must be one of {sorted(_VALID_AGENT_MODES)}; "
                f"got {mode!r}"
            ),
        }
    # Mid-stream rejection. The frontend should hide the
    # toggle while the LED is cyan, but the backend guards
    # defensively against a stale click.
    if agent_id in service._active_agent_streams:
        return {
            "error": "agent stream active",
            "reason": (
                "Wait for the agent to finish its current "
                "response before changing mode."
            ),
        }
    parsed = _parse_agent_mode_string(mode)
    if parsed is None:
        # Unreachable given the _VALID_AGENT_MODES check
        # above; defensive belt-and-braces.
        return {"error": "invalid mode"}
    new_mode, new_xref = parsed
    cm = scope.context
    old_mode = cm.mode
    old_xref = cm.cross_reference_enabled
    if old_mode == new_mode and old_xref == new_xref:
        return {
            "status": "ok",
            "agent_id": agent_id,
            "mode": mode,
            "message": "Already in that mode",
        }
    # Apply the change.
    cm.set_mode(new_mode)
    cm.set_cross_reference_enabled(new_xref)
    _rebuild_agent_tracker(service, scope)
    # Archive the change as a system event so reconstruction
    # (Increment 5) can replay mode transitions.
    old_str = _format_agent_mode(old_mode, old_xref)
    new_str = _format_agent_mode(new_mode, new_xref)
    event_text = (
        f"Mode changed: {old_str} → {new_str}."
    )
    if scope.archival_append is not None:
        try:
            scope.archival_append(
                "user", event_text, system_event=True,
            )
        except Exception as exc:
            # Defensive — a sink failure shouldn't roll back
            # the in-memory mode change. Matches the same
            # discipline ContextManager._invoke_archival_sink
            # uses for normal message appends.
            logger.warning(
                "Agent mode-change archive write failed for "
                "%s: %s",
                agent_id, exc,
            )
    service._broadcast_event(
        "agentModeChanged",
        {
            "agent_id": agent_id,
            "mode": new_str,
            "cross_reference_enabled": new_xref,
        },
    )
    return {
        "status": "ok",
        "agent_id": agent_id,
        "mode": new_str,
    }


def set_agent_cross_reference(
    service: "LLMService",
    agent_id: str,
    enabled: bool,
) -> dict[str, Any]:
    """Toggle cross-reference for a specific agent.

    Per-agent analogue of :func:`set_cross_reference`. The
    agent's primary mode (code or doc) stays the same; only
    the cross-reference axis flips. Same mid-stream
    rejection, archive event, and broadcast as
    :func:`switch_agent_mode`.

    Returns ``{status: "ok", agent_id: str,
    cross_reference_enabled: bool}`` on success.

    Note — unlike the main conversation, agent cross-ref
    enable does NOT gate on ``_doc_index_ready``. Agents
    inherit doc-index readiness from the orchestrator's
    state at spawn time; if the doc index isn't ready when
    an agent tries to enable cross-ref, the descriptor and
    prompt assembly handle the empty-index case
    gracefully. This matches how the existing
    :func:`switch_agent_mode` accepts ``doc+xref`` without
    consulting the readiness flag.
    """
    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted
    if not isinstance(agent_id, str) or not agent_id:
        return {"error": "agent not found"}
    scope = service._agent_contexts.get(agent_id)
    if scope is None:
        return {"error": "agent not found"}
    new_xref = bool(enabled)
    if agent_id in service._active_agent_streams:
        return {
            "error": "agent stream active",
            "reason": (
                "Wait for the agent to finish its current "
                "response before changing cross-reference."
            ),
        }
    cm = scope.context
    old_xref = cm.cross_reference_enabled
    if old_xref == new_xref:
        return {
            "status": "ok",
            "agent_id": agent_id,
            "cross_reference_enabled": new_xref,
            "message": "Already in that state",
        }
    cm.set_cross_reference_enabled(new_xref)
    _rebuild_agent_tracker(service, scope)
    old_str = _format_agent_mode(cm.mode, old_xref)
    new_str = _format_agent_mode(cm.mode, new_xref)
    event_text = (
        f"Mode changed: {old_str} → {new_str}."
    )
    if scope.archival_append is not None:
        try:
            scope.archival_append(
                "user", event_text, system_event=True,
            )
        except Exception as exc:
            logger.warning(
                "Agent xref-toggle archive write failed for "
                "%s: %s",
                agent_id, exc,
            )
    service._broadcast_event(
        "agentModeChanged",
        {
            "agent_id": agent_id,
            "mode": new_str,
            "cross_reference_enabled": new_xref,
        },
    )
    return {
        "status": "ok",
        "agent_id": agent_id,
        "cross_reference_enabled": new_xref,
    }