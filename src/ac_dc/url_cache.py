"""URL cache — filesystem-based TTL cache for fetched URL content.

Stores fetched URL content as JSON files keyed by URL hash.
Supports configurable TTL and cleanup of expired entries.
"""

import hashlib
import json
import logging
import os
import time
from pathlib import Path

logger = logging.getLogger(__name__)


def url_hash(url):
    """Deterministic 16-char hash of a URL for cache keys."""
    return hashlib.sha256(url.encode()).hexdigest()[:16]


class URLCache:
    """Filesystem-based TTL cache for URL content.

    Each entry is a JSON file named by URL hash.

    Args:
        cache_dir: directory for cache files (created if missing)
        ttl_hours: time-to-live in hours (default 24)
    """

    def __init__(self, cache_dir=None, ttl_hours=24):
        if cache_dir is None:
            import tempfile
            cache_dir = os.path.join(tempfile.gettempdir(), "ac-dc-url-cache")
        self._cache_dir = Path(cache_dir)
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        self._ttl_seconds = ttl_hours * 3600

    @property
    def cache_dir(self):
        return self._cache_dir

    def _path_for(self, url):
        """Get cache file path for a URL."""
        return self._cache_dir / f"{url_hash(url)}.json"

    def get(self, url):
        """Return cached content dict if valid, None if miss or expired."""
        path = self._path_for(url)
        if not path.exists():
            return None

        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            # Corrupt entry — clean up
            try:
                path.unlink()
            except OSError:
                pass
            return None

        # Check TTL
        cached_at = data.get("_cached_at", 0)
        if time.time() - cached_at > self._ttl_seconds:
            return None

        return data

    def set(self, url, content):
        """Write content dict to cache with timestamp.

        Sets fetched_at if not already present in the content.
        """
        path = self._path_for(url)
        data = dict(content)
        data["_cached_at"] = time.time()
        if "fetched_at" not in data or data["fetched_at"] is None:
            data["fetched_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        try:
            path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        except OSError as e:
            logger.warning(f"Failed to write URL cache: {e}")

    def invalidate(self, url):
        """Delete single cache entry. Returns whether entry was found."""
        path = self._path_for(url)
        try:
            if path.exists():
                path.unlink()
                return True
        except OSError:
            pass
        return False

    def clear(self):
        """Delete all cache entries. Returns count of removed."""
        count = 0
        try:
            for f in self._cache_dir.glob("*.json"):
                try:
                    f.unlink()
                    count += 1
                except OSError:
                    pass
        except OSError:
            pass
        return count

    def cleanup_expired(self):
        """Scan and delete expired entries. Returns count of removed."""
        removed = 0
        now = time.time()
        try:
            for f in self._cache_dir.glob("*.json"):
                try:
                    data = json.loads(f.read_text(encoding="utf-8"))
                    cached_at = data.get("_cached_at", 0)
                    if now - cached_at > self._ttl_seconds:
                        f.unlink()
                        removed += 1
                except (json.JSONDecodeError, OSError):
                    f.unlink()
                    removed += 1
        except OSError:
            pass
        return removed