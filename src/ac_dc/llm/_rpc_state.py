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
) -> list[str] | dict[str, Any]:
    """Store the set of files excluded from the index.

    Excluded files have no content, no index block, and no
    tracker item. Removes matching entries from EVERY mode's
    tracker — without this, excluding files in one mode
    leaves stale entries in the other mode's tracker,
    visible in the cache viewer after a mode switch.
    """
    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted
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
                        tracker._broken_tiers.add(item.tier)
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
    service._context.set_system_prompt(prompt)
    return {
        "status": "ok",
        "mode": service._context.mode.value,
        "prompt_len": len(prompt),
        "appendix_present": has_appendix,
    }


# ---------------------------------------------------------------------------
# Session lifecycle
# ---------------------------------------------------------------------------


def new_session(service: "LLMService") -> dict[str, Any]:
    """Start a fresh session — clear history, purge tracker, wipe agents."""
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
    # Drop every agent ContextManager from the prior session.
    service._agent_contexts.clear()
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
    turn_id: str,
    agent_idx: int,
) -> dict[str, Any]:
    """Free an agent's ContextManager + tracker + file_context.

    Called when the user clicks ✕ on an agent tab. Idempotent —
    unknown turn_id or agent_idx returns ``closed: False`` rather
    than raising. Archive file on disk stays; transcript is still
    readable via :meth:`LLMService.get_turn_archive`.
    """
    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted
    turn_bucket = service._agent_contexts.get(turn_id)
    if turn_bucket is None:
        return {"status": "ok", "closed": False}
    scope = turn_bucket.pop(agent_idx, None)
    if scope is None:
        return {"status": "ok", "closed": False}
    # Drop the outer key when empty so the registry doesn't
    # accumulate empty buckets over long sessions.
    if not turn_bucket:
        service._agent_contexts.pop(turn_id, None)
    return {"status": "ok", "closed": True}


def set_agent_selected_files(
    service: "LLMService",
    turn_id: str,
    agent_idx: int,
    files: list[str],
) -> list[str] | dict[str, Any]:
    """Replace an agent's selected-files list.

    Per-agent analogue of :func:`set_selected_files`. Replaces
    in-place so the scope's stored list identity is preserved —
    downstream code holds references to ``scope.selected_files``.
    No filesChanged broadcast — agent selection is per-tab; a
    broadcast would overwrite other clients' main-tab or
    different-agent-tab state.
    """
    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted
    turn_bucket = service._agent_contexts.get(turn_id)
    if turn_bucket is None:
        return {"error": "agent not found"}
    scope = turn_bucket.get(agent_idx)
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
    turn_id: str,
    agent_idx: int,
    files: list[str],
) -> list[str] | dict[str, Any]:
    """Replace an agent's excluded-index-files list.

    Per-agent analogue of :func:`set_excluded_index_files`.
    Excluded files have no content, no index block, and no
    tracker item in the agent's scope. Mirrors the selection
    RPC shape: `{error: "agent not found"}` when the tab has
    been closed, otherwise returns the canonical list.

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
    turn_bucket = service._agent_contexts.get(turn_id)
    if turn_bucket is None:
        return {"error": "agent not found"}
    scope = turn_bucket.get(agent_idx)
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
                    tracker._broken_tiers.add(item.tier)
    return list(valid)