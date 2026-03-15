"""Base cache with mtime-based invalidation — shared by symbol and doc indexes."""

import hashlib
from typing import Any, Optional


class BaseCache:
    """In-memory mtime-based cache for parsed file data.

    Subclasses store language-specific parse results (FileSymbols, DocOutline, etc.).
    """

    def __init__(self):
        self._cache: dict[str, dict] = {}  # path -> {mtime, data, content_hash}

    def get(self, path: str, mtime: float) -> Optional[Any]:
        """Return cached data if path exists and mtime matches."""
        entry = self._cache.get(path)
        if entry and entry["mtime"] == mtime:
            return entry["data"]
        return None

    def put(self, path: str, mtime: float, data: Any, content_hash: Optional[str] = None):
        """Store data with mtime. Optionally store a content hash."""
        if content_hash is None:
            content_hash = self._compute_hash(data)
        self._cache[path] = {
            "mtime": mtime,
            "data": data,
            "content_hash": content_hash,
        }

    def invalidate(self, path: str):
        """Remove a single entry."""
        self._cache.pop(path, None)

    def clear(self):
        """Remove all entries."""
        self._cache.clear()

    def get_content_hash(self, path: str) -> Optional[str]:
        """Return the content hash for a cached path, or None."""
        entry = self._cache.get(path)
        if entry:
            return entry["content_hash"]
        return None

    @property
    def cached_files(self) -> set[str]:
        """Set of all cached file paths."""
        return set(self._cache.keys())

    def _compute_hash(self, data: Any) -> str:
        """Compute a deterministic hash from data. Override for custom hashing."""
        raw = repr(data)
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]