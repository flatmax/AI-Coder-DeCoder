"""Configuration handling for URL handler."""

from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass
class URLCacheConfig:
    """Configuration for URL cache."""
    path: str = "/tmp/ac_url_cache"
    ttl_hours: int = 24


@dataclass 
class URLConfig:
    """Configuration for URL handling."""
    cache: URLCacheConfig
    
    @classmethod
    def load(cls, config_path: Optional[str] = None) -> 'URLConfig':
        """
        Load configuration from config/app.json file.
        
        Args:
            config_path: Optional path to config file.
                        If None, looks in repo root.
        
        Returns:
            URLConfig instance with loaded or default values.
        """
        from ..config import load_app_config
        config = load_app_config(config_path)
        cache_data = config.get('url_cache', {})
        cache = URLCacheConfig(
            path=cache_data.get('path', URLCacheConfig.path),
            ttl_hours=cache_data.get('ttl_hours', URLCacheConfig.ttl_hours),
        )
        return cls(cache=cache)
    
    def to_dict(self) -> dict:
        """Convert to dictionary for serialization."""
        return {
            'url_cache': {
                'path': self.cache.path,
                'ttl_hours': self.cache.ttl_hours,
            }
        }
    
    @classmethod
    def _from_dict(cls, data: dict) -> 'URLConfig':
        """Create config from dictionary (for testing)."""
        cache_data = data.get('url_cache', {})
        cache = URLCacheConfig(
            path=cache_data.get('path', URLCacheConfig.path),
            ttl_hours=cache_data.get('ttl_hours', URLCacheConfig.ttl_hours),
        )
        return cls(cache=cache)
    
    def ensure_cache_dir(self) -> Path:
        """
        Ensure cache directory exists.
        
        Returns:
            Path to cache directory.
        """
        cache_path = Path(self.cache.path)
        cache_path.mkdir(parents=True, exist_ok=True)
        return cache_path
