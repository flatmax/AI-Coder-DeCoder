"""Shared pytest fixtures for URL handler tests."""

import pytest
from datetime import datetime
from pathlib import Path

from ac.url_handler.cache import URLCache
from ac.url_handler.config import URLConfig, URLCacheConfig
from ac.url_handler.fetcher import URLFetcher
from ac.url_handler.models import URLContent, URLType
from ac.context.stability_tracker import StabilityTracker, StabilityInfo


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


# ========== Stability Tracker Fixtures ==========

@pytest.fixture
def stability_path(tmp_path):
    """Create path for stability tracker persistence."""
    return tmp_path / "stability.json"


@pytest.fixture
def stability_tracker(stability_path):
    """Create StabilityTracker with 4-tier Bedrock config."""
    return StabilityTracker(
        persistence_path=stability_path,
        thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
    )


@pytest.fixture
def make_stability_info():
    """Factory for StabilityInfo objects."""
    def _make(content_hash="test", n_value=0, tier='active'):
        return StabilityInfo(
            content_hash=content_hash,
            n_value=n_value,
            tier=tier
        )
    return _make


@pytest.fixture
def tracker_with_items(stability_tracker, make_stability_info):
    """Factory to create tracker with pre-set items.
    
    Usage:
        tracker = tracker_with_items({
            "a.py": (5, 'L3'),  # n_value=5, tier='L3'
            "b.py": (8, 'L2'),
        })
    """
    def _create(items_config, last_active=None):
        for path, (n_value, tier) in items_config.items():
            stability_tracker._stability[path] = make_stability_info(
                content_hash=path, n_value=n_value, tier=tier
            )
        if last_active is not None:
            stability_tracker._last_active_items = set(last_active)
        return stability_tracker
    return _create


@pytest.fixture
def make_url_content():
    """Factory for URLContent with sensible defaults."""
    def _make(url="https://example.com", url_type=URLType.GENERIC_WEB, **kwargs):
        if 'fetched_at' not in kwargs:
            kwargs['fetched_at'] = datetime.now()
        return URLContent(url=url, url_type=url_type, **kwargs)
    return _make


# ========== Symbol Index Test Fixtures ==========

from ac.symbol_index.models import Symbol, Range, CallSite


@pytest.fixture
def make_symbol():
    """Factory for Symbol objects with sensible defaults.
    
    Usage:
        symbol = make_symbol("foo")
        symbol = make_symbol("MyClass", kind="class", children=[...])
        symbol = make_symbol("fetch", call_sites=[...])
    """
    def _make(name, kind="function", line=1, file_path="test.py", 
              children=None, call_sites=None, parameters=None):
        r = Range(start_line=line, start_col=0, end_line=line, end_col=10)
        return Symbol(
            name=name,
            kind=kind,
            file_path=file_path,
            range=r,
            selection_range=r,
            children=children or [],
            call_sites=call_sites or [],
            parameters=parameters or [],
        )
    return _make


@pytest.fixture
def make_call_site():
    """Factory for CallSite objects.
    
    Usage:
        call = make_call_site("helper", target_file="utils.py")
    """
    def _make(name, target_file=None, target_symbol=None, line=1):
        return CallSite(
            name=name,
            target_file=target_file,
            target_symbol=target_symbol,
            line=line,
        )
    return _make
