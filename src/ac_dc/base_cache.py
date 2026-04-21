"""Base class for mtime-based per-file caches.

Shared between :class:`~ac_dc.symbol_index.cache.SymbolCache` and
the future ``DocCache`` (Layer 2.7). Both caches map a repo-relative
file path to an extracted representation of that file, invalidated
when the file's modification time changes.

Design notes pinned by specs4/2-indexing:

- **Storage-mechanism abstraction.** :class:`BaseCache` exposes
  ``get``/``put``/``invalidate``/``clear`` with identical semantics
  for in-memory and on-disk backings. Subclasses override
  ``_persist`` and ``_load_all`` to add disk sidecars. The symbol
  cache leaves both as no-ops; the doc cache implements them.

- **Mtime, not content hash.** Cache invalidation is driven by
  file modification time — cheap to check, correct in the
  overwhelming majority of cases. Mtime false positives (mtime
  bumped by a retab) just trigger a re-parse; correctness is
  preserved.

- **Signature hash for stability tracking.** A separate hash over
  the *extracted* representation (not the raw file) is computed
  on put and exposed via ``get_signature_hash``. The stability
  tracker (Layer 3.5) uses this to detect "structurally
  meaningful" changes — a whitespace edit changes mtime but not
  the signature, so the stability tier doesn't demote.

- **Thread safety not required.** The orchestrator (Layer 2.7)
  drives all cache access from a single executor.

- **Missing mtime is not an error.** ``get`` accepts an mtime
  argument rather than stat-ing the file itself — callers that
  walk the repo already have the mtime in hand. Passing ``None``
  is handled by returning None (cache miss).

Governing specs:

- ``specs4/2-indexing/symbol-index.md#caching``
- ``specs4/2-indexing/document-index.md#disk-persistence``
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Generic, TypeVar

logger = logging.getLogger(__name__)


# Type variable for the cached-value type. SymbolCache stores
# FileSymbols; DocCache stores DocOutline. BaseCache is generic
# over the entry type so both subclasses get type-safe accessors.
T = TypeVar("T")


class BaseCache(Generic[T]):
    """Abstract base for mtime-based per-file caches.

    Stores one entry per repo-relative path. Each entry wraps the
    extracted value with the file's mtime at extraction time and a
    signature hash over the value's structural representation.

    Subclasses that want disk persistence override ``_persist`` and
    ``_load_all``. The defaults are no-ops, giving the symbol cache
    pure in-memory behaviour without conditional logic in the base.
    """

    def __init__(self) -> None:
        """Initialise the in-memory store."""
        # Per-path entry store. Key is the normalised relative
        # path. Value is a dict with ``value``, ``mtime``,
        # ``signature_hash``. A dict rather than a dataclass so
        # subclasses can stash extra fields (doc cache adds
        # ``keyword_model``) without forcing a base schema change.
        self._entries: dict[str, dict[str, Any]] = {}

    @staticmethod
    def _normalise_path(path: str | Path) -> str:
        """Return a canonical key for a path.

        Matches :meth:`ac_dc.repo.Repo._normalise_rel_path` so paths
        from either layer collide on the same key.
        """
        return str(path).replace("\\", "/").strip("/")

    # ------------------------------------------------------------------
    # Core API
    # ------------------------------------------------------------------

    def get(self, path: str | Path, mtime: float | None) -> T | None:
        """Return the cached value if mtime matches, else None.

        When ``mtime`` is None (caller couldn't stat), treated as
        a cache miss — a stat-failed file shouldn't return stale
        data. Floating-point equality works because ``getmtime``
        returns the same value for an unchanged file across calls
        on POSIX and Windows NTFS.

        A stale entry is not evicted on mismatch — the next
        ``put`` overwrites it. Eviction-on-miss would let a rapid
        check-then-stat-again race drop the entry temporarily.
        """
        if mtime is None:
            return None
        key = self._normalise_path(path)
        entry = self._entries.get(key)
        if entry is None:
            return None
        if entry.get("mtime") != mtime:
            return None
        return entry.get("value")  # type: ignore[no-any-return]

    def put(self, path: str | Path, mtime: float, value: T) -> None:
        """Store a value for a path.

        Computes the signature hash via
        :meth:`_compute_signature_hash` and persists via
        :meth:`_persist` (no-op in the base).
        """
        key = self._normalise_path(path)
        signature_hash = self._compute_signature_hash(value)
        entry: dict[str, Any] = {
            "value": value,
            "mtime": mtime,
            "signature_hash": signature_hash,
        }
        # Subclass hook — decorate with extra fields (e.g. doc
        # cache's keyword_model) before storing.
        self._decorate_entry(entry, path, value)
        self._entries[key] = entry
        try:
            self._persist(key, entry)
        except OSError as exc:
            # Disk writes are best-effort. A failed persist leaves
            # the in-memory cache correct; the next session will
            # re-extract. Log so the user sees it; don't raise.
            logger.warning(
                "Failed to persist cache entry for %s: %s", path, exc
            )

    def invalidate(self, path: str | Path) -> bool:
        """Remove an entry. Returns True if it existed.

        Also invokes :meth:`_remove_persisted` so subclasses can
        clean up sidecar files. Persisted removal is best-effort
        — a disk error is logged but doesn't fail the invalidation.
        """
        key = self._normalise_path(path)
        existed = key in self._entries
        self._entries.pop(key, None)
        try:
            self._remove_persisted(key)
        except OSError as exc:
            logger.warning(
                "Failed to remove persisted cache entry for %s: %s",
                path,
                exc,
            )
        return existed

    def clear(self) -> None:
        """Drop all entries, including any persisted sidecars."""
        self._entries.clear()
        try:
            self._clear_persisted()
        except OSError as exc:
            logger.warning(
                "Failed to clear persisted cache: %s", exc
            )

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    @property
    def cached_paths(self) -> set[str]:
        """Set of currently-cached repo-relative paths.

        Used by the orchestrator's stale-entry cleanup pass to
        diff against the current repo file list.
        """
        return set(self._entries.keys())

    def get_signature_hash(self, path: str | Path) -> str | None:
        """Return the signature hash for a cached entry.

        The stability tracker uses this to decide whether a
        structural change has occurred — a new hash means demote,
        an unchanged hash means keep the tier.

        Returns None if no entry exists. Callers must not
        interpret "missing" as "unchanged"; they should re-extract
        and call ``put`` to get a fresh hash.
        """
        key = self._normalise_path(path)
        entry = self._entries.get(key)
        if entry is None:
            return None
        return entry.get("signature_hash")

    def has(self, path: str | Path) -> bool:
        """Return True if an entry exists for ``path``.

        Independent of mtime — a stale entry still counts. Useful
        for the orchestrator's stale-removal pass which wants to
        know "is this path tracked at all?" rather than "is it
        valid right now?".
        """
        return self._normalise_path(path) in self._entries

    # ------------------------------------------------------------------
    # Hook points for subclasses
    # ------------------------------------------------------------------

    def _compute_signature_hash(self, value: T) -> str:
        """Hash the structural representation of ``value``.

        Default returns empty string — enough for tests that don't
        exercise the stability tracker. Concrete subclasses
        override with a shape-specific hasher.

        The hash is used to detect structural changes between
        cached entries. A whitespace-only edit changes mtime (so
        the raw cache invalidates) but typically produces the
        same signature hash (so the stability tracker doesn't
        demote).
        """
        del value  # unused in the base
        return ""

    def _decorate_entry(
        self,
        entry: dict[str, Any],
        path: str | Path,
        value: T,
    ) -> None:
        """Hook for subclasses to add extra fields to the entry.

        Default — no-op. DocCache will override to add
        ``keyword_model`` so a model change invalidates previously
        enriched outlines.
        """
        del entry, path, value  # unused in the base
        return None

    def _persist(self, key: str, entry: dict[str, Any]) -> None:
        """Write ``entry`` to disk. Default — no-op.

        Called by ``put`` after the in-memory store has been
        updated. OSError from this method is caught by the caller
        and logged; the in-memory state is always authoritative.
        """
        del key, entry
        return None

    def _remove_persisted(self, key: str) -> None:
        """Remove the on-disk sidecar for ``key``. Default — no-op.

        Called by ``invalidate``. OSError is caught and logged.
        Missing files are not an error — the subclass should
        tolerate a "remove something that doesn't exist" call
        without raising.
        """
        del key
        return None

    def _clear_persisted(self) -> None:
        """Remove all on-disk sidecars. Default — no-op.

        Called by ``clear``. Subclasses that persist to disk
        should remove their sidecar directory's contents here.
        """
        return None

    def _load_all(self) -> None:
        """Populate ``_entries`` from disk. Default — no-op.

        Called by subclass constructors after ``super().__init__``.
        Subclasses that persist should walk their sidecar
        directory and populate ``self._entries``. Corrupt sidecars
        should be logged and skipped (not raise); a partial cache
        is better than no cache.
        """
        return None