"""Construction-time helpers for :class:`LLMService`.

Extracted from :mod:`ac_dc.llm_service` to keep the service
module's ``__init__`` readable. These functions run at or
shortly after construction:

- :func:`restore_last_session` — auto-restore the most recent
  session's history. Called from ``__init__``. Non-fatal on
  failure; starts fresh when anything goes wrong.
- :func:`build_url_service` — assemble the URL service from
  config values. Wires the filesystem cache, the smaller
  model name, and the SymbolIndex class (lazy-imported to
  avoid the tree-sitter cost when the URL service doesn't
  actually hit a GitHub repo).

Every function takes :class:`LLMService` as first argument.
Kept as module-level helpers rather than static methods so
the service module's class body stays focused on the public
surface.
"""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING

from ac_dc.url_service import URLCache, URLService

if TYPE_CHECKING:
    from ac_dc.llm_service import LLMService

logger = logging.getLogger("ac_dc.llm_service")


# ---------------------------------------------------------------------------
# URL service construction
# ---------------------------------------------------------------------------


def build_url_service(service: "LLMService") -> URLService:
    """Construct the URL service from config values.

    Wires the filesystem cache (from ``url_cache`` app config),
    the smaller model name, and the SymbolIndex class. When
    the config omits a cache path, the cache uses a
    system-temp-directory default. When the symbol index
    isn't available (pre-deferred-init or tests that skip
    it), the GitHub repo fetcher still works but produces
    content without a symbol map.
    """
    cache_config = service._config.url_cache_config
    cache_path = cache_config.get("path")
    ttl_hours = cache_config.get("ttl_hours", 24)
    if cache_path:
        cache = URLCache(Path(cache_path), ttl_hours=ttl_hours)
    else:
        default_path = Path(tempfile.gettempdir()) / "ac-dc-url-cache"
        cache = URLCache(default_path, ttl_hours=ttl_hours)

    # Lazy symbol-index class import — avoids paying the
    # tree-sitter grammar load cost when the URL service
    # doesn't actually hit a GitHub repo URL. URLService
    # accepts None for symbol_index_cls and the repo fetcher
    # degrades gracefully (no symbol map on the result).
    symbol_index_cls = None
    try:
        from ac_dc.symbol_index.index import SymbolIndex
        symbol_index_cls = SymbolIndex
    except ImportError:
        logger.debug(
            "SymbolIndex not available; URL service will fetch "
            "GitHub repos without symbol maps"
        )

    return URLService(
        cache=cache,
        smaller_model=service._config.smaller_model,
        symbol_index_cls=symbol_index_cls,
    )


# ---------------------------------------------------------------------------
# Session restore
# ---------------------------------------------------------------------------


def restore_last_session(service: "LLMService") -> None:
    """Load the most recent session's messages into context.

    Called from ``__init__``. If no sessions exist, is a no-op.
    If loading fails for any reason, logs and starts fresh —
    never blocks construction. On success, updates
    ``service._session_id`` and ``service._restored_on_startup``
    so :meth:`complete_deferred_init` can fire the deferred
    ``sessionChanged`` broadcast.
    """
    if service._history_store is None:
        return
    try:
        sessions = service._history_store.list_sessions(limit=1)
    except Exception as exc:
        logger.warning(
            "Failed to list sessions during restore: %s", exc
        )
        return
    if not sessions:
        return
    target = sessions[0]
    try:
        messages = (
            service._history_store.get_session_messages_for_context(
                target.session_id
            )
        )
    except Exception as exc:
        logger.warning(
            "Failed to load session %s during restore: %s",
            target.session_id, exc,
        )
        return
    if not messages:
        return
    service._session_id = target.session_id
    service._context.set_history(messages)
    service._restored_on_startup = True
    logger.info(
        "Restored session %s with %d messages",
        target.session_id, len(messages),
    )