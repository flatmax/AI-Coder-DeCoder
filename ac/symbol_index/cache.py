"""File-level caching with mtime-based invalidation."""

import os
from dataclasses import dataclass
from typing import Dict, List, Optional
from pathlib import Path

from .models import Symbol


@dataclass
class CacheEntry:
    """Cache entry for a single file."""
    symbols: List[Symbol]
    mtime: float


class SymbolCache:
    """File-level symbol cache with mtime invalidation."""
    
    def __init__(self, repo_root: str = None):
        self.repo_root = Path(repo_root) if repo_root else Path.cwd()
        self._cache: Dict[str, CacheEntry] = {}
    
    def _get_abs_path(self, file_path: str) -> Path:
        """Get absolute path for a file."""
        path = Path(file_path)
        if not path.is_absolute():
            path = self.repo_root / path
        return path
    
    def _get_mtime(self, file_path: str) -> Optional[float]:
        """Get file modification time, or None if file doesn't exist."""
        try:
            return os.path.getmtime(self._get_abs_path(file_path))
        except OSError:
            return None
    
    def get(self, file_path: str) -> Optional[List[Symbol]]:
        """Get cached symbols if still valid (mtime unchanged).
        
        Args:
            file_path: Path to the file
            
        Returns:
            List of symbols if cache hit, None if miss or stale
        """
        entry = self._cache.get(file_path)
        if entry is None:
            return None
        
        current_mtime = self._get_mtime(file_path)
        if current_mtime is None or current_mtime != entry.mtime:
            # File changed or deleted, invalidate cache
            del self._cache[file_path]
            return None
        
        return entry.symbols
    
    def set(self, file_path: str, symbols: List[Symbol]):
        """Cache symbols for a file.
        
        Args:
            file_path: Path to the file
            symbols: Symbols extracted from the file
        """
        mtime = self._get_mtime(file_path)
        if mtime is not None:
            self._cache[file_path] = CacheEntry(symbols=symbols, mtime=mtime)
    
    def invalidate(self, file_path: str):
        """Invalidate cache for a specific file."""
        self._cache.pop(file_path, None)
    
    def clear(self):
        """Clear all cached entries."""
        self._cache.clear()
    
    def get_cached_files(self) -> List[str]:
        """Get list of files currently in cache."""
        return list(self._cache.keys())
    
    def is_valid(self, file_path: str) -> bool:
        """Check if cache entry for file is still valid."""
        return self.get(file_path) is not None
