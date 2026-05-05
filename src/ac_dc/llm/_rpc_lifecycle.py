"""Lifecycle and state-snapshot RPCs extracted from :mod:`ac_dc.llm_service`.

Covers the methods that don't fit the streaming, review, commit,
or RPC-state groupings but still need to leave the service module
so the class body stays focused on construction:

- :func:`complete_deferred_init` — flip the init-complete flag,
  attach the symbol index, broadcast restored session, schedule
  the doc-index background build.
- :func:`schedule_doc_index_build` — event-loop-thread-only
  scheduler for the doc-index background task.
- :func:`shutdown` — release executor resources.
- :func:`check_localhost_only` — the fail-closed collaboration
  guard used by every mutating RPC.
- :func:`default_scope` — build a :class:`ConversationScope`
  pointing at the main-conversation state.
- :func:`get_current_state` — the reconnect-state snapshot RPC.
- :func:`get_mode` — mode + cross-reference state + readiness
  flags.
- :func:`get_snippets` — mode- and review-aware snippet
  retrieval.
- :func:`navigate_file` — broadcast file navigation.
- :func:`is_tex_preview_available` / :func:`compile_tex_preview`
  — TeX-preview probes and delegation.

Every function takes :class:`LLMService` as first argument. The
service's public methods stay as delegators so callers continue
to reach these through the familiar ``service.X(...)`` surface.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

from ac_dc.context_manager import Mode
from ac_dc.llm._types import ArchivalAppend, ConversationScope

if TYPE_CHECKING:
    from ac_dc.llm_service import LLMService
    from ac_dc.symbol_index.index import SymbolIndex

logger = logging.getLogger("ac_dc.llm_service")


# ---------------------------------------------------------------------------
# Deferred init
# ---------------------------------------------------------------------------


def complete_deferred_init(
    service: "LLMService",
    symbol_index: "SymbolIndex",
) -> None:
    """Attach the symbol index and flip the init-complete flag.

    See :meth:`LLMService.complete_deferred_init` for the full
    prose. Idempotent — subsequent calls are no-ops.
    """
    if service._init_complete and service._symbol_index is not None:
        return
    service._symbol_index = symbol_index
    service._init_complete = True
    logger.info("Deferred init complete; chat is ready")

    # Eager stability init; failure falls through to lazy path.
    service._try_initialize_stability()

    # Broadcast restored session now that the event loop is up
    # and frontend subscribers are mounted.
    if service._restored_on_startup:
        service._broadcast_event(
            "sessionChanged",
            {
                "session_id": service._session_id,
                "messages": service._context.get_history(),
            },
        )

    # Best-effort inline doc-index scheduling. Works from the
    # event loop thread; fails silently from a worker thread
    # (production callers must invoke schedule_doc_index_build
    # separately from the main loop).
    schedule_doc_index_build(service)


def schedule_doc_index_build(service: "LLMService") -> bool:
    """Schedule the doc index background build on the current loop.

    Must be called from the event loop thread. Returns True when
    the build was scheduled or is already running/complete;
    False when no running loop was found on the calling thread.
    """
    if service._doc_index_ready or service._doc_index_building:
        return True
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.debug(
            "schedule_doc_index_build called without a "
            "running event loop; build not scheduled"
        )
        return False
    service._main_loop = loop
    asyncio.ensure_future(service._build_doc_index_background())
    logger.info("Doc index background build scheduled")
    return True


def shutdown(service: "LLMService") -> None:
    """Release executor resources. Called on server shutdown."""
    # wait=False so shutdown doesn't block on in-flight work;
    # the event loop is typically already stopping at this point.
    service._stream_executor.shutdown(wait=False)
    service._aux_executor.shutdown(wait=False)


# ---------------------------------------------------------------------------
# Collaboration guard
# ---------------------------------------------------------------------------


def check_localhost_only(
    service: "LLMService",
) -> dict[str, Any] | None:
    """Return a restricted-error dict when the caller is non-localhost.

    Matches the pattern on :class:`Repo` — returns None when the
    caller is allowed (no collab attached, or a localhost caller),
    otherwise returns the specs4-mandated ``{"error":
    "restricted", "reason": ...}`` shape.

    Fails closed — an exception from the collab check itself
    becomes a denial rather than silently allowing the mutation.
    """
    collab = getattr(service, "_collab", None)
    if collab is None:
        return None
    try:
        is_local = collab.is_caller_localhost()
    except Exception as exc:
        logger.warning(
            "Collab localhost check raised: %s; denying", exc
        )
        return {
            "error": "restricted",
            "reason": "Internal error checking caller identity",
        }
    if is_local:
        return None
    return {
        "error": "restricted",
        "reason": "Participants cannot perform this action",
    }


# ---------------------------------------------------------------------------
# Conversation scope construction
# ---------------------------------------------------------------------------


def default_scope(service: "LLMService") -> ConversationScope:
    """Build a scope pointing at the main-conversation state.

    The main user-facing session's state lives on ``self``. Every
    entry point that runs ``_stream_chat`` for the main
    conversation builds a default scope via this helper and
    threads it through. Future parallel-agent mode constructs
    per-agent scopes directly, bypassing this helper.
    """
    archival: ArchivalAppend | None
    if service._history_store is not None:
        store = service._history_store

        def _append_to_main_store(
            role: str,
            content: str,
            *,
            session_id: str,
            **kwargs: Any,
        ) -> Any:
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
        context=service._context,
        tracker=service._stability_tracker,
        session_id=service._session_id,
        selected_files=service._selected_files,
        archival_append=archival,
    )


# ---------------------------------------------------------------------------
# State snapshot
# ---------------------------------------------------------------------------


def get_current_state(service: "LLMService") -> dict[str, Any]:
    """Return the state snapshot for browser reconnect.

    Called by the browser on WebSocket connect. Returns the
    minimal set of fields needed to rebuild the UI.
    """
    doc_convert_available = False
    try:
        from ac_dc.doc_convert import DocConvert
        doc_convert_available = DocConvert._probe_import("markitdown")
    except Exception:
        pass

    return {
        "messages": service._context.get_history(),
        "selected_files": list(service._selected_files),
        "excluded_index_files": list(service._excluded_index_files),
        "streaming_active": service._active_user_request is not None,
        "session_id": service._session_id,
        "repo_name": service._repo.name if service._repo else "",
        "init_complete": service._init_complete,
        "mode": service._context.mode.value,
        "cross_ref_enabled": service._cross_ref_enabled,
        "enrichment_status": service._enrichment_status,
        "review_state": service.get_review_state(),
        "doc_convert_available": doc_convert_available,
    }


# ---------------------------------------------------------------------------
# Mode + readiness
# ---------------------------------------------------------------------------


def get_mode(service: "LLMService") -> dict[str, Any]:
    """Return current mode, cross-reference state, and readiness flags."""
    return {
        "mode": service._context.mode.value,
        "doc_index_ready": service._doc_index_ready,
        "doc_index_building": service._doc_index_building,
        "doc_index_enriched": service._doc_index_enriched,
        "enrichment_status": service._enrichment_status,
        "cross_ref_ready": service._doc_index_ready,
        "cross_ref_enabled": service._cross_ref_enabled,
    }


# ---------------------------------------------------------------------------
# Snippets
# ---------------------------------------------------------------------------


def get_snippets(service: "LLMService") -> list[dict[str, str]]:
    """Return snippets appropriate for the current mode.

    Priority: review > doc > code. The frontend calls this
    unconditionally on RPC ready, review state change, and
    mode change.
    """
    if service._review_active:
        return service._config.get_snippets("review")
    if service._context.mode == Mode.DOC:
        return service._config.get_snippets("doc")
    return service._config.get_snippets("code")


# ---------------------------------------------------------------------------
# Navigation broadcast
# ---------------------------------------------------------------------------


def navigate_file(
    service: "LLMService",
    path: str,
) -> dict[str, Any]:
    """Broadcast file navigation to all connected clients."""
    service._broadcast_event("navigateFile", {"path": path})
    return {"status": "ok", "path": path}


# ---------------------------------------------------------------------------
# TeX preview
# ---------------------------------------------------------------------------


def is_tex_preview_available(
    service: "LLMService",
) -> dict[str, Any]:
    """Check if TeX preview dependencies are installed.

    Two-stage probe: ``make4ht`` binary on PATH, and the
    ``tex4ht.sty`` package resolvable via ``kpsewhich``. Both
    must be present for compilation to succeed. Returns a
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
    service: "LLMService",
    content: str,
    file_path: str | None = None,
) -> dict[str, Any]:
    """Compile TeX source to HTML for live preview."""
    if service._repo is None:
        return {"error": "No repository attached"}
    return service._repo.compile_tex_preview(content, file_path)