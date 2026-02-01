"""Tests for URL content cache."""

import json
import pytest
from datetime import datetime, timedelta
from pathlib import Path

from ac.url_handler.cache import URLCache
from ac.url_handler.config import URLConfig, URLCacheConfig
from ac.url_handler.models import URLContent, URLType


# Use shared fixtures from conftest.py:
# - cache_dir, url_config, url_cache, sample_url_content

@pytest.fixture
def config(url_config):
    """Alias for backward compatibility."""
    return url_config


@pytest.fixture
def cache(url_cache):
    """Alias for backward compatibility."""
    return url_cache


@pytest.fixture
def sample_content(sample_url_content):
    """Alias for backward compatibility."""
    return sample_url_content


class TestURLCacheInit:
    def test_init_with_config(self, config):
        cache = URLCache(config)
        assert cache.config == config

    def test_init_default_config(self, tmp_path, monkeypatch):
        # Monkeypatch to avoid loading real config
        monkeypatch.setattr(
            'ac.url_handler.cache.URLConfig.load',
            lambda: URLConfig(cache=URLCacheConfig(path=str(tmp_path)))
        )
        cache = URLCache()
        assert cache._cache_dir == tmp_path


class TestURLCacheCacheKey:
    def test_cache_key_consistent(self, cache):
        url = "https://example.com/test"
        key1 = cache._get_cache_key(url)
        key2 = cache._get_cache_key(url)
        assert key1 == key2

    def test_cache_key_different_urls(self, cache):
        key1 = cache._get_cache_key("https://example.com/a")
        key2 = cache._get_cache_key("https://example.com/b")
        assert key1 != key2

    def test_cache_key_length(self, cache):
        key = cache._get_cache_key("https://example.com")
        assert len(key) == 16


class TestURLCacheGetSet:
    def test_get_nonexistent(self, cache):
        result = cache.get("https://nonexistent.com")
        assert result is None

    def test_set_and_get(self, cache, sample_content):
        cache.set(sample_content.url, sample_content)
        
        result = cache.get(sample_content.url)
        assert result is not None
        assert result.url == sample_content.url
        assert result.title == sample_content.title
        assert result.url_type == sample_content.url_type

    def test_set_creates_directory(self, cache, cache_dir, sample_content):
        assert not cache_dir.exists()
        cache.set(sample_content.url, sample_content)
        assert cache_dir.exists()

    def test_set_without_fetched_at(self, cache):
        content = URLContent(
            url="https://example.com",
            url_type=URLType.GENERIC_WEB,
            fetched_at=None,
        )
        cache.set(content.url, content)
        
        result = cache.get(content.url)
        assert result is not None
        assert result.fetched_at is not None

    def test_get_creates_cache_file(self, cache, cache_dir, sample_content):
        cache.set(sample_content.url, sample_content)
        
        cache_files = list(cache_dir.glob("*.json"))
        assert len(cache_files) == 1


class TestURLCacheExpiration:
    def test_expired_content_returns_none(self, cache, cache_dir):
        # Create content that's already expired
        old_time = datetime.now() - timedelta(hours=25)
        content = URLContent(
            url="https://example.com/old",
            url_type=URLType.GENERIC_WEB,
            fetched_at=old_time,
        )
        cache.set(content.url, content)
        
        result = cache.get(content.url)
        assert result is None

    def test_expired_content_removes_file(self, cache, cache_dir):
        old_time = datetime.now() - timedelta(hours=25)
        content = URLContent(
            url="https://example.com/old",
            url_type=URLType.GENERIC_WEB,
            fetched_at=old_time,
        )
        cache.set(content.url, content)
        
        # File exists after set
        assert len(list(cache_dir.glob("*.json"))) == 1
        
        # Get triggers expiration check and removal
        cache.get(content.url)
        assert len(list(cache_dir.glob("*.json"))) == 0

    def test_fresh_content_not_expired(self, cache, sample_content):
        cache.set(sample_content.url, sample_content)
        
        result = cache.get(sample_content.url)
        assert result is not None


class TestURLCacheInvalidate:
    def test_invalidate_existing(self, cache, sample_content):
        cache.set(sample_content.url, sample_content)
        
        result = cache.invalidate(sample_content.url)
        assert result is True
        assert cache.get(sample_content.url) is None

    def test_invalidate_nonexistent(self, cache):
        result = cache.invalidate("https://nonexistent.com")
        assert result is False


class TestURLCacheClear:
    def test_clear_empty(self, cache):
        count = cache.clear()
        assert count == 0

    def test_clear_with_entries(self, cache):
        for i in range(3):
            content = URLContent(
                url=f"https://example.com/{i}",
                url_type=URLType.GENERIC_WEB,
                fetched_at=datetime.now(),
            )
            cache.set(content.url, content)
        
        count = cache.clear()
        assert count == 3

    def test_clear_removes_all_files(self, cache, cache_dir):
        for i in range(3):
            content = URLContent(
                url=f"https://example.com/{i}",
                url_type=URLType.GENERIC_WEB,
                fetched_at=datetime.now(),
            )
            cache.set(content.url, content)
        
        cache.clear()
        assert len(list(cache_dir.glob("*.json"))) == 0


class TestURLCacheCleanupExpired:
    def test_cleanup_removes_expired(self, cache):
        # Add fresh content
        fresh = URLContent(
            url="https://example.com/fresh",
            url_type=URLType.GENERIC_WEB,
            fetched_at=datetime.now(),
        )
        cache.set(fresh.url, fresh)
        
        # Add expired content
        old_time = datetime.now() - timedelta(hours=25)
        expired = URLContent(
            url="https://example.com/expired",
            url_type=URLType.GENERIC_WEB,
            fetched_at=old_time,
        )
        cache.set(expired.url, expired)
        
        count = cache.cleanup_expired()
        assert count == 1
        
        # Fresh still accessible
        assert cache.get(fresh.url) is not None

    def test_cleanup_handles_corrupted(self, cache, cache_dir):
        cache_dir.mkdir(parents=True, exist_ok=True)
        
        # Create corrupted cache file
        corrupted_path = cache_dir / "corrupted.json"
        corrupted_path.write_text("not valid json {{{")
        
        count = cache.cleanup_expired()
        assert count == 1
        assert not corrupted_path.exists()


class TestURLCacheGetCachedUrls:
    def test_empty_cache(self, cache):
        urls = cache.get_cached_urls()
        assert urls == []

    def test_with_entries(self, cache, sample_content):
        cache.set(sample_content.url, sample_content)
        
        urls = cache.get_cached_urls()
        assert len(urls) == 1
        assert urls[0] == cache._get_cache_key(sample_content.url)


class TestURLCacheCorruptedFiles:
    def test_corrupted_json_returns_none(self, cache, cache_dir):
        cache_dir.mkdir(parents=True, exist_ok=True)
        
        url = "https://example.com/test"
        cache_path = cache._get_cache_path(url)
        cache_path.write_text("invalid json")
        
        result = cache.get(url)
        assert result is None

    def test_corrupted_json_removed(self, cache, cache_dir):
        cache_dir.mkdir(parents=True, exist_ok=True)
        
        url = "https://example.com/test"
        cache_path = cache._get_cache_path(url)
        cache_path.write_text("invalid json")
        
        cache.get(url)
        assert not cache_path.exists()
