"""Base cache — mtime-based, in-memory caching for parsed file data.

Shared by SymbolCache (code) and DocCache (documents).
"""

import hashlib


class BaseCache:
    """Abstract mtime-based cache for per-file parsed data."""

    def __init__(self):
        self._cache = {}  # path -> {mtime, data, content_hash, ...}

    def get(self, path, mtime):
        """Get cached data if mtime matches."""
        entry = self._cache.get(path)
        if entry and entry["mtime"] == mtime:
            return entry["data"]
        return None

    def put(self, path, mtime, data, content_hash=None, **extra):
        """Store data with mtime. Subclasses provide content_hash."""
        if content_hash is None:
            content_hash = self._compute_hash(data)
        entry = {
            "mtime": mtime,
            "data": data,
            "content_hash": content_hash,
        }
        entry.update(extra)
        self._cache[path] = entry

    def get_hash(self, path):
        """Get content hash for a cached file."""
        entry = self._cache.get(path)
        if entry:
            return entry.get("content_hash")
        return None

    def get_extra(self, path, key):
        """Get an extra field from a cached entry."""
        entry = self._cache.get(path)
        if entry:
            return entry.get(key)
        return None

    def invalidate(self, path):
        """Remove entry from cache."""
        self._cache.pop(path, None)

    def clear(self):
        """Clear all entries."""
        self._cache.clear()

    @property
    def cached_files(self):
        """Set of cached file paths."""
        return set(self._cache.keys())

    def _compute_hash(self, data):
        """Compute deterministic hash. Subclasses should override."""
        return hashlib.sha256(repr(data).encode()).hexdigest()[:16]