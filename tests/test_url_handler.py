"""Tests for URL cache and URL handler."""

import json
import os
import time
from pathlib import Path
from unittest.mock import MagicMock, patch, AsyncMock

import pytest

from ac_dc.url_cache import URLCache, url_hash
from ac_dc.url_handler import (
    URLContent,
    URLType,
    SummaryType,
    GitHubInfo,
    URLService,
    classify_url,
    detect_urls,
    display_name,
    extract_html_content,
    select_summary_type,
)


# ============================================================
# URL Cache Tests
# ============================================================


class TestURLCacheBasic:
    def test_set_get_roundtrip(self, tmp_path):
        """Set/get round-trip works."""
        cache = URLCache(cache_dir=tmp_path / "cache")
        cache.set("https://example.com", {"title": "Example", "content": "Hello"})
        result = cache.get("https://example.com")
        assert result is not None
        assert result["title"] == "Example"
        assert result["content"] == "Hello"

    def test_miss_returns_none(self, tmp_path):
        """Cache miss returns None."""
        cache = URLCache(cache_dir=tmp_path / "cache")
        assert cache.get("https://nonexistent.com") is None

    def test_expired_returns_none(self, tmp_path):
        """Expired entry returns None."""
        cache = URLCache(cache_dir=tmp_path / "cache", ttl_hours=0)
        cache.set("https://example.com", {"title": "Old"})
        # TTL is 0 hours = 0 seconds, so it's immediately expired
        time.sleep(0.01)
        assert cache.get("https://example.com") is None

    def test_invalidate_removes_entry(self, tmp_path):
        """Invalidate removes single entry."""
        cache = URLCache(cache_dir=tmp_path / "cache")
        cache.set("https://example.com", {"title": "X"})
        cache.invalidate("https://example.com")
        assert cache.get("https://example.com") is None

    def test_clear_removes_all(self, tmp_path):
        """Clear removes all entries."""
        cache = URLCache(cache_dir=tmp_path / "cache")
        cache.set("https://a.com", {"a": 1})
        cache.set("https://b.com", {"b": 2})
        cache.clear()
        assert cache.get("https://a.com") is None
        assert cache.get("https://b.com") is None

    def test_cleanup_expired_returns_count(self, tmp_path):
        """cleanup_expired returns count of removed entries."""
        cache = URLCache(cache_dir=tmp_path / "cache", ttl_hours=0)
        cache.set("https://a.com", {"a": 1})
        cache.set("https://b.com", {"b": 2})
        time.sleep(0.01)
        removed = cache.cleanup_expired()
        assert removed == 2

    def test_corrupt_json_handled(self, tmp_path):
        """Corrupt JSON entry handled (cleaned up, returns None)."""
        cache = URLCache(cache_dir=tmp_path / "cache")
        # Write corrupt JSON
        h = url_hash("https://corrupt.com")
        corrupt_path = cache.cache_dir / f"{h}.json"
        corrupt_path.write_text("{corrupt json", encoding="utf-8")
        result = cache.get("https://corrupt.com")
        assert result is None
        # File should be cleaned up
        assert not corrupt_path.exists()


class TestURLHash:
    def test_deterministic(self):
        """URL hash is deterministic."""
        h1 = url_hash("https://example.com")
        h2 = url_hash("https://example.com")
        assert h1 == h2

    def test_16_chars(self):
        """URL hash is 16 chars."""
        h = url_hash("https://example.com")
        assert len(h) == 16

    def test_different_urls_different_hashes(self):
        """Different URLs produce different hashes."""
        h1 = url_hash("https://example.com")
        h2 = url_hash("https://other.com")
        assert h1 != h2


class TestURLCacheDefaultDir:
    def test_default_cache_dir_created(self):
        """Default cache dir created automatically."""
        cache = URLCache()
        assert cache.cache_dir.exists()


# ============================================================
# URL Detection Tests
# ============================================================


class TestURLDetection:
    def test_basic_detection(self):
        """Basic URL detection."""
        results = detect_urls("Check https://example.com for info")
        assert len(results) == 1
        assert results[0]["url"] == "https://example.com"

    def test_multiple_urls(self):
        """Multiple URLs detected."""
        text = "See https://a.com and https://b.com"
        results = detect_urls(text)
        assert len(results) == 2

    def test_deduplication(self):
        """Duplicate URLs deduplicated."""
        text = "Visit https://example.com twice: https://example.com"
        results = detect_urls(text)
        assert len(results) == 1

    def test_trailing_punctuation_stripped(self):
        """Trailing punctuation stripped."""
        results = detect_urls("See https://example.com.")
        assert results[0]["url"] == "https://example.com"

    def test_trailing_comma_stripped(self):
        """Trailing comma stripped."""
        results = detect_urls("Check https://example.com, thanks")
        assert results[0]["url"] == "https://example.com"

    def test_no_urls_returns_empty(self):
        """No URLs returns empty list."""
        results = detect_urls("No URLs here")
        assert results == []

    def test_http_supported(self):
        """http:// supported."""
        results = detect_urls("Try http://example.com")
        assert len(results) == 1
        assert results[0]["url"] == "http://example.com"

    def test_file_protocol_rejected(self):
        """file:// rejected."""
        results = detect_urls("Open file:///etc/passwd")
        assert len(results) == 0

    def test_empty_input(self):
        """Empty input returns empty."""
        assert detect_urls("") == []
        assert detect_urls(None) == []


# ============================================================
# URL Classification Tests
# ============================================================


class TestURLClassification:
    def test_github_repo(self):
        """GitHub repo classified correctly."""
        assert classify_url("https://github.com/owner/repo") == URLType.GITHUB_REPO

    def test_github_repo_trailing_slash(self):
        """GitHub repo with trailing slash."""
        assert classify_url("https://github.com/owner/repo/") == URLType.GITHUB_REPO

    def test_github_repo_git_suffix(self):
        """GitHub repo with .git suffix."""
        assert classify_url("https://github.com/owner/repo.git") == URLType.GITHUB_REPO

    def test_github_file(self):
        """GitHub file: owner/repo/branch/path."""
        url = "https://github.com/owner/repo/blob/main/src/app.py"
        assert classify_url(url) == URLType.GITHUB_FILE

    def test_github_issue(self):
        """GitHub issue (#N)."""
        url = "https://github.com/owner/repo/issues/42"
        assert classify_url(url) == URLType.GITHUB_ISSUE

    def test_github_pr(self):
        """GitHub PR."""
        url = "https://github.com/owner/repo/pull/99"
        assert classify_url(url) == URLType.GITHUB_PR

    def test_documentation_known_domain(self):
        """Known documentation domain."""
        assert classify_url("https://docs.python.org/3/library/os.html") == URLType.DOCUMENTATION

    def test_documentation_readthedocs(self):
        """ReadTheDocs domain."""
        assert classify_url("https://myproject.readthedocs.io/en/latest/") == URLType.DOCUMENTATION

    def test_documentation_docs_path(self):
        """Path with /docs/."""
        assert classify_url("https://example.com/docs/getting-started") == URLType.DOCUMENTATION

    def test_documentation_api_path(self):
        """Path with /api/."""
        assert classify_url("https://example.com/api/reference") == URLType.DOCUMENTATION

    def test_generic_fallback(self):
        """Unrecognized URLs classified as generic."""
        assert classify_url("https://random-site.com/page") == URLType.GENERIC


# ============================================================
# Display Name Tests
# ============================================================


class TestDisplayName:
    def test_github_repo_display(self):
        """GitHub repo: owner/repo."""
        name = display_name("https://github.com/owner/repo", URLType.GITHUB_REPO)
        assert name == "owner/repo"

    def test_github_file_display(self):
        """GitHub file: owner/repo/filename."""
        url = "https://github.com/owner/repo/blob/main/src/deep/app.py"
        name = display_name(url, URLType.GITHUB_FILE)
        assert name == "owner/repo/app.py"

    def test_github_issue_display(self):
        """GitHub issue: owner/repo#N."""
        url = "https://github.com/owner/repo/issues/42"
        name = display_name(url, URLType.GITHUB_ISSUE)
        assert name == "owner/repo#42"

    def test_github_pr_display(self):
        """GitHub PR: owner/repo!N."""
        url = "https://github.com/owner/repo/pull/99"
        name = display_name(url, URLType.GITHUB_PR)
        assert name == "owner/repo!99"

    def test_generic_hostname_path(self):
        """Generic: hostname/path."""
        name = display_name("https://example.com/page", URLType.GENERIC)
        assert name == "example.com/page"

    def test_long_url_truncated(self):
        """Long URLs truncated to 40 chars."""
        url = "https://example.com/" + "a" * 100
        name = display_name(url, URLType.GENERIC)
        assert len(name) <= 40
        assert name.endswith("...")

    def test_root_url_strips_trailing_slash(self):
        """Root URL strips trailing slash."""
        name = display_name("https://example.com/", URLType.GENERIC)
        assert name == "example.com"


# ============================================================
# Summary Type Selection Tests
# ============================================================


class TestSummaryTypeSelection:
    def test_github_repo_with_symbols(self):
        """GitHub repo with symbol map -> ARCHITECTURE."""
        st = select_summary_type(URLType.GITHUB_REPO, has_symbol_map=True)
        assert st == SummaryType.ARCHITECTURE

    def test_github_repo_without_symbols(self):
        """GitHub repo without symbol map -> BRIEF."""
        st = select_summary_type(URLType.GITHUB_REPO, has_symbol_map=False)
        assert st == SummaryType.BRIEF

    def test_documentation(self):
        """Documentation -> USAGE."""
        st = select_summary_type(URLType.DOCUMENTATION)
        assert st == SummaryType.USAGE

    def test_generic(self):
        """Generic -> BRIEF."""
        st = select_summary_type(URLType.GENERIC)
        assert st == SummaryType.BRIEF

    def test_user_hint_how_to(self):
        """User hint 'how to' -> USAGE."""
        st = select_summary_type(URLType.GENERIC, user_text="how to use this library")
        assert st == SummaryType.USAGE

    def test_user_hint_api(self):
        """User hint 'api' -> API."""
        st = select_summary_type(URLType.GENERIC, user_text="what's the api?")
        assert st == SummaryType.API

    def test_user_hint_architecture(self):
        """User hint 'architecture' -> ARCHITECTURE."""
        st = select_summary_type(URLType.GENERIC, user_text="describe the architecture")
        assert st == SummaryType.ARCHITECTURE

    def test_user_hint_compare(self):
        """User hint 'compare' -> EVALUATION."""
        st = select_summary_type(URLType.GENERIC, user_text="compare with alternatives")
        assert st == SummaryType.EVALUATION


# ============================================================
# URLContent Tests
# ============================================================


class TestURLContent:
    def test_format_for_prompt_with_summary(self):
        """format_for_prompt: summary preferred over raw content."""
        uc = URLContent(
            url="https://example.com",
            title="Example",
            content="Raw content here",
            summary="Short summary",
        )
        text = uc.format_for_prompt()
        assert "https://example.com" in text
        assert "Example" in text
        assert "Short summary" in text
        # Summary preferred, raw content not included when summary exists
        assert "Raw content here" not in text

    def test_format_for_prompt_readme_fallback(self):
        """format_for_prompt: readme fallback when no summary."""
        uc = URLContent(
            url="https://github.com/owner/repo",
            readme="# Project\nReadme content",
        )
        text = uc.format_for_prompt()
        assert "Readme content" in text

    def test_format_for_prompt_symbol_map_appended(self):
        """format_for_prompt: symbol map appended."""
        uc = URLContent(
            url="https://example.com",
            content="Content",
            symbol_map="c MyClass:10",
        )
        text = uc.format_for_prompt()
        assert "Symbol Map" in text
        assert "c MyClass:10" in text

    def test_format_for_prompt_truncation(self):
        """format_for_prompt: truncation with ellipsis."""
        uc = URLContent(
            url="https://example.com",
            content="x" * 100000,
        )
        text = uc.format_for_prompt(max_length=1000)
        assert "truncated" in text

    def test_roundtrip_serialization(self):
        """Round-trip serialization (to_dict/from_dict) preserves all fields."""
        original = URLContent(
            url="https://github.com/owner/repo",
            url_type="github_repo",
            title="My Repo",
            description="A repo",
            content="Content",
            symbol_map="f main:1",
            readme="# Readme",
            github_info=GitHubInfo(owner="owner", repo="repo", branch="main"),
            fetched_at="2025-01-15T00:00:00Z",
            summary="A summary",
            summary_type="BRIEF",
        )
        d = original.to_dict()
        restored = URLContent.from_dict(d)
        assert restored.url == original.url
        assert restored.url_type == original.url_type
        assert restored.title == original.title
        assert restored.content == original.content
        assert restored.symbol_map == original.symbol_map
        assert restored.readme == original.readme
        assert restored.summary == original.summary
        assert restored.github_info.owner == "owner"
        assert restored.github_info.repo == "repo"
        assert restored.github_info.branch == "main"

    def test_format_includes_url_header_and_title(self):
        """format_for_prompt includes URL header and title."""
        uc = URLContent(url="https://example.com", title="Example Site", content="Body")
        text = uc.format_for_prompt()
        assert "## https://example.com" in text
        assert "**Example Site**" in text


# ============================================================
# HTML Extraction Tests
# ============================================================


class TestHTMLExtraction:
    def test_extracts_title(self):
        """Extracts title from HTML."""
        html_text = "<html><head><title>My Page</title></head><body><p>Content</p></body></html>"
        title, content = extract_html_content(html_text)
        assert title == "My Page"

    def test_strips_scripts_and_styles(self):
        """Strips scripts and styles."""
        html_text = (
            "<html><body>"
            "<script>alert('xss')</script>"
            "<style>.x{color:red}</style>"
            "<p>Real content</p>"
            "</body></html>"
        )
        title, content = extract_html_content(html_text)
        assert content is not None
        assert "alert" not in content
        assert "color:red" not in content
        assert "Real content" in content

    def test_cleans_whitespace(self):
        """Cleans excessive whitespace."""
        html_text = "<html><body><p>  word1   word2  </p></body></html>"
        _, content = extract_html_content(html_text)
        assert content is not None
        # Should not have excessive spaces
        assert "   " not in content


# ============================================================
# URL Service Tests
# ============================================================


class TestURLService:
    def test_detect_urls_returns_classified(self):
        """detect_urls returns classified results."""
        svc = URLService()
        results = svc.detect_urls("Check https://github.com/owner/repo")
        assert len(results) == 1
        assert results[0]["url_type"] == "github_repo"

    def test_get_url_content_error_for_unfetched(self):
        """get_url_content returns error for unfetched URL."""
        svc = URLService()
        result = svc.get_url_content("https://unfetched.com")
        assert result.error is not None

    def test_invalidate_cache(self, tmp_path):
        """Invalidate and clear cache operations."""
        cache = URLCache(cache_dir=tmp_path / "cache")
        svc = URLService(cache=cache)
        # Manually populate
        cache.set("https://example.com", {"url": "https://example.com", "content": "x"})
        svc.invalidate_url_cache("https://example.com")
        assert cache.get("https://example.com") is None

    def test_clear_url_cache(self, tmp_path):
        """Clear URL cache."""
        cache = URLCache(cache_dir=tmp_path / "cache")
        svc = URLService(cache=cache)
        cache.set("https://a.com", {"url": "https://a.com"})
        svc._fetched["https://a.com"] = URLContent(url="https://a.com")
        svc.clear_url_cache()
        assert cache.get("https://a.com") is None
        assert len(svc.get_fetched_urls()) == 0

    def test_get_fetched_urls_empty_initially(self):
        """get_fetched_urls empty initially."""
        svc = URLService()
        assert svc.get_fetched_urls() == []

    def test_remove_fetched(self):
        """remove_fetched removes from in-memory dict."""
        svc = URLService()
        svc._fetched["https://a.com"] = URLContent(url="https://a.com")
        svc.remove_fetched("https://a.com")
        assert len(svc.get_fetched_urls()) == 0

    def test_clear_fetched(self):
        """clear_fetched clears in-memory dict."""
        svc = URLService()
        svc._fetched["https://a.com"] = URLContent(url="https://a.com")
        svc._fetched["https://b.com"] = URLContent(url="https://b.com")
        svc.clear_fetched()
        assert len(svc.get_fetched_urls()) == 0

    def test_format_url_context_joins(self):
        """format_url_context joins multiple URLs with separator."""
        svc = URLService()
        svc._fetched["https://a.com"] = URLContent(
            url="https://a.com", content="Content A"
        )
        svc._fetched["https://b.com"] = URLContent(
            url="https://b.com", content="Content B"
        )
        text = svc.format_url_context()
        assert "Content A" in text
        assert "Content B" in text
        assert "---" in text

    def test_format_url_context_excludes_specified(self):
        """format_url_context excludes specified URLs."""
        svc = URLService()
        svc._fetched["https://a.com"] = URLContent(
            url="https://a.com", content="Content A"
        )
        svc._fetched["https://b.com"] = URLContent(
            url="https://b.com", content="Content B"
        )
        text = svc.format_url_context(excluded={"https://a.com"})
        assert "Content A" not in text
        assert "Content B" in text

    def test_format_url_context_skips_errors(self):
        """format_url_context skips error results."""
        svc = URLService()
        svc._fetched["https://a.com"] = URLContent(
            url="https://a.com", error="fetch failed"
        )
        svc._fetched["https://b.com"] = URLContent(
            url="https://b.com", content="Content B"
        )
        text = svc.format_url_context()
        assert "Content B" in text
        # Error URL should not appear in output
        assert "fetch failed" not in text

    @pytest.mark.asyncio
    async def test_fetch_uses_cache(self, tmp_path):
        """Fetch uses cache when available."""
        cache = URLCache(cache_dir=tmp_path / "cache")
        cache.set("https://example.com", {
            "url": "https://example.com",
            "url_type": "generic",
            "title": "Cached",
            "content": "Cached content",
        })
        svc = URLService(cache=cache)
        result = await svc.fetch_url("https://example.com", summarize=False)
        assert result.title == "Cached"
        assert result.content == "Cached content"

    @pytest.mark.asyncio
    @patch("ac_dc.url_handler.urlopen")
    async def test_web_page_fetch(self, mock_urlopen, tmp_path):
        """Web page fetch via mocked urlopen."""
        mock_resp = MagicMock()
        mock_resp.read.return_value = b"<html><head><title>Test</title></head><body>Hello world</body></html>"
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        cache = URLCache(cache_dir=tmp_path / "cache")
        svc = URLService(cache=cache)
        result = await svc.fetch_url("https://example.com/page", use_cache=False, summarize=False)
        assert result.title == "Test"
        assert result.error is None

    @pytest.mark.asyncio
    @patch("ac_dc.url_handler.urlopen")
    async def test_github_file_fetch(self, mock_urlopen, tmp_path):
        """GitHub file fetch."""
        mock_resp = MagicMock()
        mock_resp.read.return_value = b"def main():\n    print('hello')\n"
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        cache = URLCache(cache_dir=tmp_path / "cache")
        svc = URLService(cache=cache)
        url = "https://github.com/owner/repo/blob/main/src/app.py"
        result = await svc.fetch_url(url, use_cache=False, summarize=False)
        assert result.error is None
        assert "def main()" in result.content

    @pytest.mark.asyncio
    async def test_error_results_not_cached(self, tmp_path):
        """Error results not cached."""
        cache = URLCache(cache_dir=tmp_path / "cache")
        svc = URLService(cache=cache)

        # Fetch a URL that will fail (no mock, no real network)
        with patch("ac_dc.url_handler.urlopen", side_effect=Exception("network error")):
            result = await svc.fetch_url("https://failing.com", use_cache=False, summarize=False)

        assert result.error is not None
        # Should not be cached
        assert cache.get("https://failing.com") is None

    @pytest.mark.asyncio
    @patch("ac_dc.url_handler.litellm")
    @patch("ac_dc.url_handler.urlopen")
    async def test_summarization_via_mocked_llm(self, mock_urlopen, mock_litellm, tmp_path):
        """Summarization via mocked LLM appends summary to result."""
        # Mock web fetch
        mock_resp = MagicMock()
        mock_resp.read.return_value = b"<html><body>Some detailed content about Python</body></html>"
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        # Mock LLM summarization
        mock_llm_resp = MagicMock()
        mock_llm_resp.choices = [MagicMock()]
        mock_llm_resp.choices[0].message.content = "A brief summary of the content."
        mock_litellm.completion.return_value = mock_llm_resp

        cache = URLCache(cache_dir=tmp_path / "cache")
        svc = URLService(cache=cache, model="test-model")
        result = await svc.fetch_url(
            "https://example.com/article",
            use_cache=False,
            summarize=True,
        )
        assert result.summary == "A brief summary of the content."
        assert result.error is None