"""Per-path write mutex and post-write callback.

Tiny but critical. Every write/create/rename method acquires the
per-path lock for serialisation (D10 contract — re-entrant edit
pipeline for future parallel-agent mode), then fires the post-write
callback after the lock releases so the callback's enrichment work
doesn't block further writes to the same path.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Callable

logger = logging.getLogger(__name__)


class LocksMixin:
    """Write-mutex and post-write callback plumbing.

    Mixed into :class:`Repo`. Reads ``self._write_locks`` and
    ``self._post_write_callback``. Calls ``self._normalise_rel_path``.
    """

    _write_locks: dict[str, asyncio.Lock]
    _post_write_callback: "Callable[[str], None] | None"

    def _normalise_rel_path(self, path: str | Path) -> str:  # noqa: D401
        """Forward-declared — implemented in PathMixin."""
        ...  # type: ignore[empty-body]

    def _get_write_lock(self, path: str | Path) -> asyncio.Lock:
        """Return the asyncio.Lock for a given path, creating on demand.

        Locks are keyed by the normalised relative path string — two
        callers referring to the same file via different spellings
        (forward vs back slash, trailing slash, etc.) acquire the
        same lock.

        In single-agent operation, the lock is effectively never
        contended. It exists so the repository layer's contract is
        safe for a future parallel-agent mode (D10) where N agents
        may generate edits concurrently.
        """
        key = self._normalise_rel_path(path)
        lock = self._write_locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            self._write_locks[key] = lock
        return lock

    def _fire_post_write(self, path: str | Path) -> None:
        """Invoke the post-write callback, swallowing any exception.

        Fired by every successful write / create / rename path
        after the filesystem operation commits and after the
        per-path write lock releases. The callback on the other
        side is responsible for deciding whether the path is
        interesting (extension match, current mode) — we
        unconditionally forward every path so the callback's
        gating logic is the single source of truth.

        Errors are logged and swallowed. A bug in the callback
        (indexing failure, enrichment crash) must not turn a
        successful write into a user-visible write error. The
        user saved their file successfully; that contract is
        preserved regardless of what happens downstream.
        """
        callback = self._post_write_callback
        if callback is None:
            return
        try:
            callback(self._normalise_rel_path(path))
        except Exception as exc:
            logger.warning(
                "Post-write callback raised for %s: %s",
                path, exc,
            )