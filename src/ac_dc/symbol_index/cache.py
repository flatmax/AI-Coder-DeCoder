"""Symbol cache with mtime-based invalidation."""

import logging
import hashlib
from pathlib import Path
from typing import Optional

from .models import FileSymbols

log = logging.getLogger(__name__)


class SymbolCache:
    """In-memory per-file symbol cache with mtime invalidation."""

    def __init__(self):
        # file_path -> (mtime, FileSymbols)
        self._cache: dict[str, tuple[float, FileSymbols]] = {}
        # file_path -> content_hash (for change detection)
        self._hashes: dict[str, str] = {}

    def get(self, file_path: str, mtime: float) -> Optional[FileSymbols]:
        """Get cached symbols if mtime matches."""
        entry = self._cache.get(file_path)
        if entry and entry[0] == mtime:
            return entry[1]
        return None

    def put(self, file_path: str, mtime: float, symbols: FileSymbols):
        """Store symbols with mtime."""
        self._cache[file_path] = (mtime, symbols)

    def invalidate(self, file_path: str):
        """Remove a single file from cache."""
        self._cache.pop(file_path, None)
        self._hashes.pop(file_path, None)

    def invalidate_all(self):
        """Clear entire cache."""
        self._cache.clear()
        self._hashes.clear()

    def has(self, file_path: str) -> bool:
        return file_path in self._cache

    def get_content_hash(self, file_path: str) -> Optional[str]:
        """Get stored content hash for change detection."""
        return self._hashes.get(file_path)

    def set_content_hash(self, file_path: str, content_hash: str):
        """Store content hash."""
        self._hashes[file_path] = content_hash

    @staticmethod
    def compute_hash(content: str) -> str:
        """Compute SHA256 hash of content."""
        return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]

    @property
    def cached_files(self) -> set[str]:
        """Return set of cached file paths."""
        return set(self._cache.keys())
