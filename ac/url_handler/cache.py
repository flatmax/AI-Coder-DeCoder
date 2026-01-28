"""URL content caching with TTL-based invalidation."""

import hashlib
import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from .config import URLConfig
from .models import URLContent


class URLCache:
    """URL content cache with TTL invalidation."""
    
    def __init__(self, config: Optional[URLConfig] = None):
        """
        Initialize URL cache.
        
        Args:
            config: URL configuration. If None, loads default config.
        """
        self.config = config or URLConfig.load()
        self._cache_dir = Path(self.config.cache.path)
    
    def _get_cache_key(self, url: str) -> str:
        """Generate cache key from URL."""
        return hashlib.sha256(url.encode('utf-8')).hexdigest()[:16]
    
    def _get_cache_path(self, url: str) -> Path:
        """Get file path for cached URL content."""
        return self._cache_dir / f"{self._get_cache_key(url)}.json"
    
    def _is_expired(self, fetched_at: Optional[datetime]) -> bool:
        """Check if cached content has expired based on TTL."""
        if fetched_at is None:
            return True
        
        ttl = timedelta(hours=self.config.cache.ttl_hours)
        return datetime.now() - fetched_at > ttl
    
    def get(self, url: str) -> Optional[URLContent]:
        """
        Get cached content for URL if still valid.
        
        Args:
            url: The URL to look up.
            
        Returns:
            URLContent if cache hit and not expired, None otherwise.
        """
        cache_path = self._get_cache_path(url)
        
        if not cache_path.exists():
            return None
        
        try:
            with open(cache_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            content = URLContent.from_dict(data)
            
            if self._is_expired(content.fetched_at):
                # Expired, remove stale cache file
                cache_path.unlink(missing_ok=True)
                return None
            
            return content
            
        except (json.JSONDecodeError, KeyError, ValueError):
            # Corrupted cache file, remove it
            cache_path.unlink(missing_ok=True)
            return None
    
    def set(self, url: str, content: URLContent) -> None:
        """
        Cache content for a URL.
        
        Args:
            url: The URL being cached.
            content: The content to cache.
        """
        # Ensure cache directory exists
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        
        # Ensure fetched_at is set
        if content.fetched_at is None:
            content.fetched_at = datetime.now()
        
        cache_path = self._get_cache_path(url)
        
        with open(cache_path, 'w', encoding='utf-8') as f:
            json.dump(content.to_dict(), f, indent=2)
    
    def invalidate(self, url: str) -> bool:
        """
        Invalidate cache for a specific URL.
        
        Args:
            url: The URL to invalidate.
            
        Returns:
            True if cache entry was removed, False if not found.
        """
        cache_path = self._get_cache_path(url)
        if cache_path.exists():
            cache_path.unlink()
            return True
        return False
    
    def clear(self) -> int:
        """
        Clear all cached entries.
        
        Returns:
            Number of entries cleared.
        """
        if not self._cache_dir.exists():
            return 0
        
        count = 0
        for cache_file in self._cache_dir.glob("*.json"):
            cache_file.unlink()
            count += 1
        
        return count
    
    def get_cached_urls(self) -> list[str]:
        """
        Get list of cache keys currently stored.
        
        Note: Returns cache keys (hashes), not original URLs.
        Original URLs are not stored separately.
        
        Returns:
            List of cache key strings.
        """
        if not self._cache_dir.exists():
            return []
        
        return [f.stem for f in self._cache_dir.glob("*.json")]
    
    def cleanup_expired(self) -> int:
        """
        Remove all expired cache entries.
        
        Returns:
            Number of entries removed.
        """
        if not self._cache_dir.exists():
            return 0
        
        count = 0
        for cache_file in self._cache_dir.glob("*.json"):
            try:
                with open(cache_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                content = URLContent.from_dict(data)
                
                if self._is_expired(content.fetched_at):
                    cache_file.unlink()
                    count += 1
                    
            except (json.JSONDecodeError, KeyError, ValueError):
                # Corrupted file, remove it
                cache_file.unlink()
                count += 1
        
        return count
