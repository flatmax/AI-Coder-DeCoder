"""Configuration handling for URL handler."""

import json
import os
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
        Load configuration from ac-dc.json file.
        
        Args:
            config_path: Optional path to config file.
                        If None, looks in repo root.
        
        Returns:
            URLConfig instance with loaded or default values.
        """
        if config_path is None:
            # Look for ac-dc.json in the repo root (three levels up from url_handler/config.py)
            # Path: ac/url_handler/config.py -> ac/url_handler/ -> ac/ -> repo root
            config_path = os.path.join(
                os.path.dirname(__file__), 
                '..', 
                '..',
                'ac-dc.json'
            )
        
        config_data = {}
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                config_data = json.load(f)
        except FileNotFoundError:
            pass  # Use defaults
        except json.JSONDecodeError as e:
            print(f"Warning: Error parsing {config_path}: {e}")
        
        return cls._from_dict(config_data)
    
    @classmethod
    def _from_dict(cls, data: dict) -> 'URLConfig':
        """Create config from dictionary."""
        cache_data = data.get('url_cache', {})
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
    
    def ensure_cache_dir(self) -> Path:
        """
        Ensure cache directory exists.
        
        Returns:
            Path to cache directory.
        """
        cache_path = Path(self.cache.path)
        cache_path.mkdir(parents=True, exist_ok=True)
        return cache_path
