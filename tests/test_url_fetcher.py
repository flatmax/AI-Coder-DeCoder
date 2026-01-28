"""Tests for URL fetcher orchestrator."""

import pytest
from unittest.mock import Mock, patch
from datetime import datetime

from ac.url_handler.fetcher import URLFetcher
from ac.url_handler.config import URLConfig, URLCacheConfig
from ac.url_handler.models import URLContent, URLType, URLResult, SummaryType


@pytest.fixture
def config(tmp_path):
    """Create config with temp cache directory."""
    return URLConfig(
        cache=URLCacheConfig(path=str(tmp_path / "url_cache"), ttl_hours=24)
    )


@pytest.fixture
def fetcher(config):
    """Create fetcher with temp cache."""
    return URLFetcher(config=config)


class TestURLFetcherInit:
    def test_init_creates_components(self, fetcher):
        assert fetcher.cache is not None
        assert fetcher.github_handler is not None
        assert fetcher.web_handler is not None
        assert fetcher.summarizer is not None


class TestURLFetcherRouting:
    def test_routes_github_repo(self, fetcher):
        with patch.object(fetcher.github_handler, 'fetch_repo') as mock:
            mock.return_value = URLContent(
                url="https://github.com/owner/repo",
                url_type=URLType.GITHUB_REPO,
                fetched_at=datetime.now(),
            )
            
            result = fetcher.fetch("https://github.com/owner/repo", summarize=False)
            
            assert mock.called
            assert result.content.url_type == URLType.GITHUB_REPO

    def test_routes_github_file(self, fetcher):
        with patch.object(fetcher.github_handler, 'fetch_file') as mock:
            mock.return_value = URLContent(
                url="https://github.com/owner/repo/blob/main/file.py",
                url_type=URLType.GITHUB_FILE,
                fetched_at=datetime.now(),
            )
            
            result = fetcher.fetch(
                "https://github.com/owner/repo/blob/main/file.py",
                summarize=False
            )
            
            assert mock.called
            assert result.content.url_type == URLType.GITHUB_FILE

    def test_routes_web_page(self, fetcher):
        with patch.object(fetcher.web_handler, 'fetch_page') as mock:
            mock.return_value = URLContent(
                url="https://example.com/page",
                url_type=URLType.GENERIC_WEB,
                fetched_at=datetime.now(),
            )
            
            result = fetcher.fetch("https://example.com/page", summarize=False)
            
            assert mock.called
            assert result.content.url_type == URLType.GENERIC_WEB

    def test_routes_documentation(self, fetcher):
        with patch.object(fetcher.web_handler, 'fetch_documentation') as mock:
            mock.return_value = URLContent(
                url="https://docs.python.org/3/",
                url_type=URLType.DOCUMENTATION,
                fetched_at=datetime.now(),
            )
            
            result = fetcher.fetch("https://docs.python.org/3/", summarize=False)
            
            assert mock.called


class TestURLFetcherCaching:
    def test_uses_cache_on_hit(self, fetcher):
        url = "https://example.com/cached"
        cached_content = URLContent(
            url=url,
            url_type=URLType.GENERIC_WEB,
            content="Cached content",
            fetched_at=datetime.now(),
        )
        fetcher.cache.set(url, cached_content)
        
        with patch.object(fetcher.web_handler, 'fetch_page') as mock:
            result = fetcher.fetch(url, use_cache=True, summarize=False)
            
            assert not mock.called
            assert result.cached is True
            assert result.content.content == "Cached content"

    def test_bypasses_cache_when_disabled(self, fetcher):
        url = "https://example.com/nocache"
        cached_content = URLContent(
            url=url,
            url_type=URLType.GENERIC_WEB,
            content="Cached content",
            fetched_at=datetime.now(),
        )
        fetcher.cache.set(url, cached_content)
        
        with patch.object(fetcher.web_handler, 'fetch_page') as mock:
            mock.return_value = URLContent(
                url=url,
                url_type=URLType.GENERIC_WEB,
                content="Fresh content",
                fetched_at=datetime.now(),
            )
            
            result = fetcher.fetch(url, use_cache=False, summarize=False)
            
            assert mock.called
            assert result.cached is False

    def test_caches_successful_fetch(self, fetcher):
        url = "https://example.com/new"
        
        with patch.object(fetcher.web_handler, 'fetch_page') as mock:
            mock.return_value = URLContent(
                url=url,
                url_type=URLType.GENERIC_WEB,
                content="New content",
                fetched_at=datetime.now(),
            )
            
            fetcher.fetch(url, use_cache=True, summarize=False)
            
            # Should be cached now
            cached = fetcher.cache.get(url)
            assert cached is not None
            assert cached.content == "New content"

    def test_does_not_cache_errors(self, fetcher):
        url = "https://example.com/error"
        
        with patch.object(fetcher.web_handler, 'fetch_page') as mock:
            mock.return_value = URLContent(
                url=url,
                url_type=URLType.GENERIC_WEB,
                error="Fetch failed",
                fetched_at=datetime.now(),
            )
            
            fetcher.fetch(url, use_cache=True, summarize=False)
            
            # Should not be cached
            cached = fetcher.cache.get(url)
            assert cached is None


class TestURLFetcherSummarization:
    def test_summarizes_when_requested(self, fetcher):
        url = "https://example.com/summarize"
        
        with patch.object(fetcher.web_handler, 'fetch_page') as fetch_mock:
            fetch_mock.return_value = URLContent(
                url=url,
                url_type=URLType.GENERIC_WEB,
                content="Long content to summarize...",
                fetched_at=datetime.now(),
            )
            
            with patch.object(fetcher.summarizer, 'summarize') as sum_mock:
                sum_mock.return_value = "Brief summary"
                
                result = fetcher.fetch(url, summarize=True, summary_type=SummaryType.BRIEF)
                
                assert sum_mock.called
                assert result.summary == "Brief summary"
                assert result.summary_type == SummaryType.BRIEF

    def test_contextual_summarization(self, fetcher):
        url = "https://example.com/context"
        
        with patch.object(fetcher.web_handler, 'fetch_page') as fetch_mock:
            fetch_mock.return_value = URLContent(
                url=url,
                url_type=URLType.GENERIC_WEB,
                content="Content for context...",
                fetched_at=datetime.now(),
            )
            
            with patch.object(fetcher.summarizer, 'summarize_for_context') as sum_mock:
                sum_mock.return_value = "Contextual summary"
                
                result = fetcher.fetch(
                    url,
                    summarize=True,
                    context="How do I install this?"
                )
                
                assert sum_mock.called
                assert result.summary == "Contextual summary"

    def test_no_summary_on_error(self, fetcher):
        url = "https://example.com/error"
        
        with patch.object(fetcher.web_handler, 'fetch_page') as mock:
            mock.return_value = URLContent(
                url=url,
                url_type=URLType.GENERIC_WEB,
                error="Fetch failed",
                fetched_at=datetime.now(),
            )
            
            with patch.object(fetcher.summarizer, 'summarize') as sum_mock:
                result = fetcher.fetch(url, summarize=True)
                
                assert not sum_mock.called
                assert result.summary is None


class TestURLFetcherMultiple:
    def test_fetch_multiple(self, fetcher):
        urls = ["https://example.com/1", "https://example.com/2"]
        
        with patch.object(fetcher.web_handler, 'fetch_page') as mock:
            mock.return_value = URLContent(
                url="https://example.com",
                url_type=URLType.GENERIC_WEB,
                fetched_at=datetime.now(),
            )
            
            results = fetcher.fetch_multiple(urls, summarize=False)
            
            assert len(results) == 2
            assert mock.call_count == 2

    def test_detect_and_fetch(self, fetcher):
        text = "Check out https://example.com/a and https://example.com/b"
        
        with patch.object(fetcher.web_handler, 'fetch_page') as mock:
            mock.return_value = URLContent(
                url="https://example.com",
                url_type=URLType.GENERIC_WEB,
                fetched_at=datetime.now(),
            )
            
            results = fetcher.detect_and_fetch(text, summarize=False)
            
            assert len(results) == 2

    def test_detect_and_fetch_no_urls(self, fetcher):
        text = "No URLs in this text"
        
        results = fetcher.detect_and_fetch(text)
        
        assert results == []


class TestURLFetcherCacheManagement:
    def test_invalidate_cache(self, fetcher):
        url = "https://example.com/invalidate"
        fetcher.cache.set(url, URLContent(
            url=url,
            url_type=URLType.GENERIC_WEB,
            fetched_at=datetime.now(),
        ))
        
        result = fetcher.invalidate_cache(url)
        
        assert result is True
        assert fetcher.cache.get(url) is None

    def test_clear_cache(self, fetcher):
        for i in range(3):
            fetcher.cache.set(f"https://example.com/{i}", URLContent(
                url=f"https://example.com/{i}",
                url_type=URLType.GENERIC_WEB,
                fetched_at=datetime.now(),
            ))
        
        count = fetcher.clear_cache()
        
        assert count == 3
