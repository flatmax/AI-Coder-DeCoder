"""URL content cache — Layer 4.1.2.

Filesystem-backed cache with TTL, one JSON sidecar per URL.
Keyed by a hash prefix of the URL string so filenames are short
and predictable regardless of URL structure. Entries include an
embedded ``_cached_at`` timestamp (not filesystem mtime) so the
cache survives file moves and backups.

Why a filesystem cache rather than in-memory or SQLite:

- **Survives server restart.** URLs fetched in one session
  remain available in the next. Critical for GitHub repo
  content — shallow cloning a 100 MB repo per session would
  be absurd.
- **One file per entry.** Corrupt entries are isolated —
  one bad write can't invalidate the whole cache. The spec's
  "delete corrupt entries silently" rule lets us self-heal.
- **No schema migrations.** The stored JSON is the dataclass
  `to_dict()` output, with extra internal fields. Schema
  evolution via the permissive `from_dict()`.

Scope decisions pinned by specs4/4-features/url-content.md:

- **Error results are never cached.** A URLContent with a
  non-None ``error`` field is refused by ``set()`` — retrying
  a failed fetch should not hit a stale error. Documented in
  the method docstring.
- **Summaries added in place.** The summarizer calls ``set()``
  again with the populated ``summary`` field; the cache
  overwrites. No separate "update-summary" method.
- **TTL is per-cache, not per-entry.** One ``ttl_hours``
  value set at construction. Matches the ``url_cache.ttl_hours``
  config field.
- **fetched_at injected if missing.** Convenience for fetchers
  — they don't all remember to set the timestamp.
- **Cleanup-expired is explicit.** Called on startup or via
  RPC. No background task — the cache is bounded by URLs the
  user actually fetches, which is tiny compared to filesystem
  capacity.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Module constants
# ---------------------------------------------------------------------------


# Length of the hex prefix used for cache filenames. 16 hex
# characters = 64 bits. At realistic URL-fetch volumes (a few
# thousand distinct URLs per user per year), collision
# probability is astronomically small. Using a shorter prefix
# would risk collisions; longer would just make filenames less
# readable during debugging.
_HASH_PREFIX_LEN = 16

# File extension for cached entries. Kept short and explicit
# rather than ``.cache`` so developers inspecting the directory
# can immediately tell the format.
_CACHE_SUFFIX = ".json"

# Default TTL when construction doesn't specify. 24 hours
# matches the spec's app-config default. Cache consumers (the
# URL service) will pass an explicit value from
# :meth:`ConfigManager.url_cache_config`.
_DEFAULT_TTL_HOURS = 24


# ---------------------------------------------------------------------------
# URLCache
# ---------------------------------------------------------------------------


def url_hash(url: str) -> str:
    """Return the cache-key hash for a URL.

    Deterministic — the same URL always produces the same hash.
    Exposed as a module-level function (not a method) so
    callers that just want to build a cache path can do so
    without instantiating a cache. Used by the service's
    in-memory fetched dict to key by the same hash the cache
    uses.

    Length is :data:`_HASH_PREFIX_LEN` hex chars (16 by
    default, giving 64 bits of collision resistance — plenty
    for realistic URL volumes).
    """
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[
        :_HASH_PREFIX_LEN
    ]


class URLCache:
    """Filesystem cache for :class:`URLContent` records.

    Construct with a directory path (created if missing) and a
    TTL. Operations: ``get`` (None on miss or expiry),
    ``set`` (refuses error records, injects cache timestamp),
    ``invalidate`` (remove single entry), ``clear`` (remove
    all entries), ``cleanup_expired`` (scan and remove stale).

    Thread-safety — not thread-safe. The URL service drives
    cache access from a single executor; concurrent access
    from multiple threads is out of scope.

    Stored entries are plain dicts — the URL cache doesn't
    import :class:`URLContent` to keep the module dependency
    graph minimal (fetchers that don't use the cache don't
    need to pay for URLContent's import cost). Callers convert
    dict ↔ URLContent at the boundary via
    :meth:`URLContent.to_dict` / :meth:`URLContent.from_dict`.
    """

    def __init__(
        self,
        cache_dir: Path | str,
        ttl_hours: int | float = _DEFAULT_TTL_HOURS,
    ) -> None:
        """Initialise against a cache directory.

        Parameters
        ----------
        cache_dir:
            Directory to store cache files. Created if missing
            (parents included). Callers typically get this
            from :meth:`ConfigManager.url_cache_config`.
        ttl_hours:
            Hours after which a cached entry is treated as
            expired. Fractional hours accepted for test
            convenience (a test that wants "expire after 100
            ms" passes ``100 / 3600 / 1000``). Zero or negative
            values mean every entry is immediately expired —
            effectively disables the cache without removing it.
        """
        self._dir = Path(cache_dir)
        # Create directory up-front rather than lazily. Errors
        # here should surface at construction so the caller can
        # fall back to an alternative cache location.
        self._dir.mkdir(parents=True, exist_ok=True)
        self._ttl_seconds = float(ttl_hours) * 3600.0

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    @property
    def directory(self) -> Path:
        """Cache directory path. Stable for the lifetime of the cache."""
        return self._dir

    @property
    def ttl_seconds(self) -> float:
        """Current TTL in seconds. Exposed for tests and diagnostics."""
        return self._ttl_seconds

    def _path_for(self, url: str) -> Path:
        """Return the filesystem path for a URL's cache entry."""
        return self._dir / f"{url_hash(url)}{_CACHE_SUFFIX}"

    # ------------------------------------------------------------------
    # Core operations
    # ------------------------------------------------------------------

    def get(self, url: str) -> dict[str, Any] | None:
        """Return the cached dict for ``url`` or None.

        Miss, expired, or corrupt entries return None. Corrupt
        entries are deleted as a side effect — the next fetch
        will re-populate. Expired entries are NOT deleted here
        (that's :meth:`cleanup_expired`'s job); they are just
        invisible to ``get``.

        Rationale for not auto-deleting expired entries:
        leaving stale data in place costs nothing until
        ``cleanup_expired`` runs (on startup), and avoids
        churn on the filesystem when the same expired URL is
        repeatedly queried (e.g., a user hovering the chip).
        """
        path = self._path_for(url)
        if not path.is_file():
            return None
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError as exc:
            logger.debug(
                "URL cache read failed for %s: %s", url, exc
            )
            return None
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            # Corrupt entry — delete and return miss. Per
            # specs4: "Delete corrupt entries (bad JSON)".
            logger.warning(
                "URL cache entry corrupt for %s: %s (removing)",
                url, exc,
            )
            try:
                path.unlink()
            except OSError:
                # Can't delete either — log and move on.
                # The next write will overwrite.
                logger.debug(
                    "Failed to unlink corrupt cache entry %s",
                    path,
                )
            return None
        if not isinstance(data, dict):
            # JSON parsed but not a dict — treat as corrupt.
            logger.warning(
                "URL cache entry shape wrong for %s (got %s)",
                url, type(data).__name__,
            )
            try:
                path.unlink()
            except OSError:
                pass
            return None

        cached_at = data.get("_cached_at")
        if not isinstance(cached_at, (int, float)):
            # Missing timestamp — legacy or corrupt. Treat as
            # expired so it gets re-fetched.
            logger.debug(
                "URL cache entry missing _cached_at for %s",
                url,
            )
            return None

        age = time.time() - cached_at
        if age > self._ttl_seconds:
            return None

        return data

    def set(
        self,
        url: str,
        content: dict[str, Any],
    ) -> bool:
        """Store ``content`` for ``url``, returning success.

        Refuses to cache error records — ``content`` with a
        non-empty ``error`` field returns False without
        writing. Callers don't need to check this themselves;
        the cache enforces it.

        Injects ``_cached_at`` (current unix time) for TTL
        tracking. Also injects ``fetched_at`` as an ISO 8601
        UTC string if missing or explicitly None — convenience
        so fetchers don't all have to set it.

        Returns False on write failure (disk full, permission
        denied). Caller decides whether to retry or surface
        the error — the in-memory fetched dict still works
        without a cache hit.

        Overwrites existing entries — summary updates and
        re-fetches both go through this single path.
        """
        if content.get("error"):
            # Error records aren't cached. Retrying should hit
            # the network, not a stale failure.
            return False

        # Copy so we don't mutate the caller's dict. Fetchers
        # may still need the original record after caching.
        to_write = dict(content)
        to_write["_cached_at"] = time.time()
        if not to_write.get("fetched_at"):
            # Set fetched_at if missing or explicitly None.
            # The fetcher usually sets this, but the cache is
            # the last line of defence for records that
            # arrive without it (e.g., from summary-only
            # updates of older entries).
            to_write["fetched_at"] = (
                datetime.now(timezone.utc)
                .strftime("%Y-%m-%dT%H:%M:%SZ")
            )

        path = self._path_for(url)
        try:
            # json.dumps first, then atomic write — avoids
            # leaving a truncated file if the write is
            # interrupted. Temp file + rename is the POSIX
            # atomic-write idiom; on Windows, rename is
            # atomic too as long as the target exists or
            # doesn't exist at the start (Python 3.3+ uses
            # ReplaceFile under the hood via Path.replace).
            payload = json.dumps(to_write, ensure_ascii=False)
            tmp_path = path.with_suffix(
                path.suffix + ".tmp"
            )
            tmp_path.write_text(payload, encoding="utf-8")
            tmp_path.replace(path)
            return True
        except OSError as exc:
            logger.warning(
                "URL cache write failed for %s: %s", url, exc
            )
            return False

    def invalidate(self, url: str) -> bool:
        """Remove the cache entry for ``url``.

        Returns True if an entry existed and was removed,
        False if there was no entry to remove. Missing files
        are NOT an error — the outcome (no cache entry) is
        the same whether we deleted one or never had one.
        Matches :meth:`BaseCache.invalidate`'s contract from
        Layer 2.
        """
        path = self._path_for(url)
        if not path.exists():
            return False
        try:
            path.unlink()
            return True
        except OSError as exc:
            logger.warning(
                "URL cache invalidate failed for %s: %s",
                url, exc,
            )
            return False

    def clear(self) -> int:
        """Remove every cached entry. Returns count removed.

        Used by the "clear URL cache" RPC. Does not remove the
        cache directory itself — just its contents. Walks the
        directory and removes every file with the cache suffix;
        non-cache files (if any got in there) are left alone.
        """
        count = 0
        try:
            for entry in self._dir.iterdir():
                if not entry.is_file():
                    continue
                if entry.suffix != _CACHE_SUFFIX:
                    continue
                try:
                    entry.unlink()
                    count += 1
                except OSError as exc:
                    logger.debug(
                        "URL cache clear: failed to unlink %s: %s",
                        entry, exc,
                    )
        except OSError as exc:
            logger.warning(
                "URL cache clear iteration failed: %s", exc
            )
        return count

    def cleanup_expired(self) -> int:
        """Remove expired and corrupt entries. Returns count removed.

        Called explicitly (typically on startup or via an
        admin RPC). Walks the cache directory and removes any
        entry older than the TTL, plus any entry that fails to
        parse or has a missing timestamp.

        Reads only the ``_cached_at`` field — doesn't need to
        parse the full URLContent shape, so it's cheap even on
        large caches.
        """
        count = 0
        now = time.time()
        try:
            entries = list(self._dir.iterdir())
        except OSError as exc:
            logger.warning(
                "URL cache cleanup iteration failed: %s", exc
            )
            return 0

        for entry in entries:
            if not entry.is_file():
                continue
            if entry.suffix != _CACHE_SUFFIX:
                continue
            if self._entry_is_stale(entry, now):
                try:
                    entry.unlink()
                    count += 1
                except OSError as exc:
                    logger.debug(
                        "URL cache cleanup: unlink %s failed: %s",
                        entry, exc,
                    )
        return count

    def _entry_is_stale(self, path: Path, now: float) -> bool:
        """Return True if ``path`` is expired or corrupt.

        Corrupt = can't read, can't parse, wrong shape, or
        missing ``_cached_at``. Stale = age exceeds TTL.
        Either way, the caller unlinks.
        """
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError:
            return True
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return True
        if not isinstance(data, dict):
            return True
        cached_at = data.get("_cached_at")
        if not isinstance(cached_at, (int, float)):
            return True
        return (now - cached_at) > self._ttl_seconds