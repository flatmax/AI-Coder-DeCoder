"""Shared pytest fixtures for URL handler tests."""

import pytest
from datetime import datetime
from pathlib import Path

from ac.url_handler.cache import URLCache
from ac.url_handler.config import URLConfig, URLCacheConfig
from ac.url_handler.fetcher import URLFetcher
from ac.url_handler.models import URLContent, URLType


# ========== URL Handler Fixtures ==========

@pytest.fixture
def cache_dir(tmp_path):
    """Create a temporary cache directory."""
    return tmp_path / "url_cache"


@pytest.fixture
def url_config(cache_dir):
    """Create URLConfig with temp cache directory."""
    return URLConfig(
        cache=URLCacheConfig(path=str(cache_dir), ttl_hours=24)
    )


@pytest.fixture
def url_cache(url_config):
    """Create URLCache instance with temp directory."""
    return URLCache(url_config)


@pytest.fixture
def url_fetcher(url_config):
    """Create URLFetcher with temp cache."""
    return URLFetcher(config=url_config)


@pytest.fixture
def sample_url_content():
    """Create sample URLContent for testing."""
    return URLContent(
        url="https://github.com/owner/repo",
        url_type=URLType.GITHUB_REPO,
        title="Test Repo",
        description="A test repository",
        content="README content here",
        fetched_at=datetime.now(),
    )


@pytest.fixture
def sample_web_content():
    """Create sample web page URLContent."""
    return URLContent(
        url="https://example.com/page",
        url_type=URLType.GENERIC_WEB,
        title="Example Page",
        content="Page content here",
        fetched_at=datetime.now(),
    )
