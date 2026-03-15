"""URL cache — filesystem-based with TTL."""

import json
import logging
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from ac_dc.url_service.models import URLContent, url_hash

logger = logging.getLogger(__name__)


class URLCache:
    """Filesystem cache for fetched URL content.

    Each entry is a JSON file keyed by SHA-256 prefix of the URL.
    """

    def __init__(self, cache_dir: Optional[str] = None, ttl_hours: int = 24):
        if cache_dir:
            self._dir = Path(cache_dir)
        else:
            self._dir = Path(tempfile.gettempdir()) / "ac_dc_url_cache"
        self._ttl_seconds = ttl_hours * 3600
        self._dir.mkdir(parents=True, exist_ok=True)

    def _entry_path(self, url: str) -> Path:
        return self._dir / f"{url_hash(url)}.json"

    def get(self, url: str) -> Optional[URLContent]:
        """Return cached content if not expired. Deletes expired/corrupt entries."""
        path = self._entry_path(url)
        if not path.exists():
            return None

        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            # Corrupt entry
            try:
                path.unlink()
            except OSError:
                pass
            return None

        # Check TTL
        fetched_at = data.get("fetched_at")
        if fetched_at:
            try:
                fetched = datetime.fromisoformat(fetched_at)
                now = datetime.now(timezone.utc)
                if fetched.tzinfo is None:
                    from datetime import timezone as tz
                    fetched = fetched.replace(tzinfo=tz.utc)
                age = (now - fetched).total_seconds()
                if age > self._ttl_seconds:
                    try:
                        path.unlink()
                    except OSError:
                        pass
                    return None
            except (ValueError, TypeError):
                pass

        return URLContent.from_dict(data)

    def set(self, url: str, content: URLContent):
        """Write entry with timestamp."""
        if content.fetched_at is None:
            content.fetched_at = datetime.now(timezone.utc)
        data = content.to_dict()
        path = self._entry_path(url)
        try:
            self._dir.mkdir(parents=True, exist_ok=True)
            path.write_text(
                json.dumps(data, separators=(",", ":")),
                encoding="utf-8",
            )
        except OSError as e:
            logger.warning(f"Cannot write URL cache for {url}: {e}")

    def invalidate(self, url: str) -> bool:
        """Delete single entry. Returns whether it existed."""
        path = self._entry_path(url)
        if path.exists():
            try:
                path.unlink()
                return True
            except OSError:
                pass
        return False

    def clear(self) -> int:
        """Delete all entries. Returns count."""
        count = 0
        if self._dir.exists():
            for f in self._dir.glob("*.json"):
                try:
                    f.unlink()
                    count += 1
                except OSError:
                    pass
        return count

    def cleanup_expired(self) -> int:
        """Scan and delete expired/corrupt entries. Returns count removed."""
        count = 0
        if not self._dir.exists():
            return 0

        now = datetime.now(timezone.utc)
        for f in self._dir.glob("*.json"):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                fetched_at = data.get("fetched_at")
                if fetched_at:
                    fetched = datetime.fromisoformat(fetched_at)
                    if fetched.tzinfo is None:
                        fetched = fetched.replace(tzinfo=timezone.utc)
                    age = (now - fetched).total_seconds()
                    if age > self._ttl_seconds:
                        f.unlink()
                        count += 1
                        continue
            except (json.JSONDecodeError, ValueError, TypeError, OSError):
                # Corrupt — remove
                try:
                    f.unlink()
                    count += 1
                except OSError:
                    pass

        return count