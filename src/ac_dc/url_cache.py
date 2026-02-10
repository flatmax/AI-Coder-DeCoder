"""Filesystem-based URL content cache with TTL expiration.

Stores fetched URL content as JSON files keyed by URL hash.
"""

import hashlib
import json
import logging
import tempfile
import time
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)


def _url_hash(url: str) -> str:
    """Compute cache key from URL — first 16 chars of SHA-256."""
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]


class URLCache:
    """Filesystem TTL cache for fetched URL content.

    Each entry is a JSON file named by URL hash. Entries expire
    after ttl_hours and are cleaned up on access.
    """

    def __init__(self, cache_dir: str = "", ttl_hours: int = 24):
        if cache_dir:
            self._dir = Path(cache_dir)
        else:
            self._dir = Path(tempfile.gettempdir()) / "ac-dc-url-cache"
        self._ttl_seconds = ttl_hours * 3600
        self._dir.mkdir(parents=True, exist_ok=True)

    @property
    def cache_dir(self) -> Path:
        return self._dir

    def get(self, url: str) -> Optional[dict]:
        """Return cached content if present and not expired."""
        path = self._path_for(url)
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            fetched_at = data.get("fetched_at", 0)
            if time.time() - fetched_at > self._ttl_seconds:
                path.unlink(missing_ok=True)
                log.debug("Cache expired for %s", url)
                return None
            return data
        except (json.JSONDecodeError, OSError) as e:
            log.warning("Corrupt cache entry for %s: %s", url, e)
            path.unlink(missing_ok=True)
            return None

    def set(self, url: str, content: dict):
        """Write content to cache with current timestamp."""
        content["fetched_at"] = time.time()
        content["url"] = url
        path = self._path_for(url)
        try:
            self._dir.mkdir(parents=True, exist_ok=True)
            path.write_text(
                json.dumps(content, ensure_ascii=False, default=str),
                encoding="utf-8",
            )
        except OSError as e:
            log.warning("Failed to write cache for %s: %s", url, e)

    def invalidate(self, url: str):
        """Remove a single cached entry."""
        self._path_for(url).unlink(missing_ok=True)

    def clear(self):
        """Remove all cached entries."""
        if not self._dir.exists():
            return
        for f in self._dir.glob("*.json"):
            f.unlink(missing_ok=True)

    def cleanup_expired(self) -> int:
        """Scan and delete expired entries. Returns count removed."""
        if not self._dir.exists():
            return 0
        removed = 0
        now = time.time()
        for path in self._dir.glob("*.json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if now - data.get("fetched_at", 0) > self._ttl_seconds:
                    path.unlink()
                    removed += 1
            except (json.JSONDecodeError, OSError):
                path.unlink(missing_ok=True)
                removed += 1
        return removed

    def _path_for(self, url: str) -> Path:
        return self._dir / f"{_url_hash(url)}.json"
