"""Tests for URL service — detection, cache, classification, fetching, service."""

import json
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from ac_dc.url_service.models import (
    URLContent, URLType, GitHubInfo, url_hash, display_name,
)
from ac_dc.url_service.detector import detect_urls, classify_url, select_summary_type
from ac_dc.url_service.cache import URLCache
from ac_dc.url_service.service import URLService


# ── URL Cache ─────────────────────────────────────────────────────

class TestURLCache:
    def test_set_get_roundtrip(self, tmp_path):
        cache = URLCache(str(tmp_path), ttl_hours=24)
        content = URLContent(
            url="https://example.com",
            url_type=URLType.GENERIC_WEB,
            title="Example",
            content="Hello world",
        )
        cache.set("https://example.com", content)
        result = cache.get("https://example.com")
        assert result is not None
        assert result.title == "Example"
        assert result.content == "Hello world"

    def test_miss_returns_none(self, tmp_path):
        cache = URLCache(str(tmp_path), ttl_hours=24)
        assert cache.get("https://nonexistent.com") is None

    def test_expired_returns_none(self, tmp_path):
        cache = URLCache(str(tmp_path), ttl_hours=0)  # 0 hours = immediate expiry
        content = URLContent(
            url="https://example.com",
            url_type=URLType.GENERIC_WEB,
            fetched_at=datetime.now(timezone.utc) - timedelta(seconds=10),
        )
        cache.set("https://example.com", content)
        assert cache.get("https://example.com") is None

    def test_invalidate(self, tmp_path):
        cache = URLCache(str(tmp_path), ttl_hours=24)
        content = URLContent(url="https://example.com", url_type=URLType.GENERIC_WEB)
        cache.set("https://example.com", content)
        found = cache.invalidate("https://example.com")
        assert found is True
        assert cache.get("https://example.com") is None

    def test_invalidate_not_found(self, tmp_path):
        cache = URLCache(str(tmp_path), ttl_hours=24)
        assert cache.invalidate("https://nonexistent.com") is False

    def test_clear(self, tmp_path):
        cache = URLCache(str(tmp_path), ttl_hours=24)
        cache.set("https://a.com", URLContent(url="https://a.com", url_type=URLType.GENERIC_WEB))
        cache.set("https://b.com", URLContent(url="https://b.com", url_type=URLType.GENERIC_WEB))
        count = cache.clear()
        assert count == 2

    def test_cleanup_expired(self, tmp_path):
        cache = URLCache(str(tmp_path), ttl_hours=0)
        old = URLContent(
            url="https://old.com", url_type=URLType.GENERIC_WEB,
            fetched_at=datetime.now(timezone.utc) - timedelta(hours=2),
        )
        cache.set("https://old.com", old)
        count = cache.cleanup_expired()
        assert count >= 1

    def test_corrupt_entry_cleaned(self, tmp_path):
        cache = URLCache(str(tmp_path), ttl_hours=24)
        # Write corrupt JSON
        h = url_hash("https://corrupt.com")
        (tmp_path / f"{h}.json").write_text("{corrupt json", encoding="utf-8")
        assert cache.get("https://corrupt.com") is None

    def test_url_hash_deterministic(self):
        h1 = url_hash("https://example.com")
        h2 = url_hash("https://example.com")
        assert h1 == h2
        assert len(h1) == 16

    def test_url_hash_different(self):
        h1 = url_hash("https://a.com")
        h2 = url_hash("https://b.com")
        assert h1 != h2

    def test_default_cache_dir_created(self):
        cache = URLCache()
        assert cache._dir.exists()

    def test_summary_added_without_refetch(self, tmp_path):
        cache = URLCache(str(tmp_path), ttl_hours=24)
        content = URLContent(
            url="https://example.com", url_type=URLType.GENERIC_WEB,
            content="Some content",
        )
        cache.set("https://example.com", content)
        # Retrieve and add summary
        cached = cache.get("https://example.com")
        cached.summary = "A summary"
        cached.summary_type = "brief"
        cache.set("https://example.com", cached)
        result = cache.get("https://example.com")
        assert result.summary == "A summary"


# ── URL Detection ─────────────────────────────────────────────────

class TestURLDetection:
    def test_basic_detection(self):
        text = "Check out https://example.com for details."
        results = detect_urls(text)
        assert len(results) == 1
        assert results[0]["url"] == "https://example.com"

    def test_multiple_urls(self):
        text = "See https://a.com and https://b.com"
        results = detect_urls(text)
        assert len(results) == 2

    def test_deduplication(self):
        text = "Visit https://example.com twice: https://example.com"
        results = detect_urls(text)
        assert len(results) == 1

    def test_trailing_punctuation_stripped(self):
        text = "See https://example.com/path."
        results = detect_urls(text)
        assert results[0]["url"] == "https://example.com/path"

    def test_trailing_comma_stripped(self):
        text = "See https://example.com/path, and more"
        results = detect_urls(text)
        assert results[0]["url"] == "https://example.com/path"

    def test_no_urls(self):
        assert detect_urls("No URLs here.") == []

    def test_http_supported(self):
        results = detect_urls("http://example.com")
        assert len(results) == 1

    def test_raw_githubusercontent(self):
        url = "https://raw.githubusercontent.com/owner/repo/main/file.py"
        results = detect_urls(f"See {url}")
        assert len(results) == 1
        assert results[0]["type"] == "github_file"


# ── URL Classification ───────────────────────────────────────────

class TestURLClassification:
    def test_github_repo(self):
        t, info = classify_url("https://github.com/owner/repo")
        assert t == URLType.GITHUB_REPO
        assert info.owner == "owner"
        assert info.repo == "repo"

    def test_github_repo_trailing_slash(self):
        t, _ = classify_url("https://github.com/owner/repo/")
        assert t == URLType.GITHUB_REPO

    def test_github_repo_dot_git(self):
        t, info = classify_url("https://github.com/owner/repo.git")
        assert t == URLType.GITHUB_REPO
        assert info.repo == "repo"

    def test_github_file(self):
        t, info = classify_url(
            "https://github.com/owner/repo/blob/main/src/app.py"
        )
        assert t == URLType.GITHUB_FILE
        assert info.branch == "main"
        assert info.path == "src/app.py"

    def test_github_issue(self):
        t, info = classify_url(
            "https://github.com/owner/repo/issues/42"
        )
        assert t == URLType.GITHUB_ISSUE
        assert info.issue_number == 42

    def test_github_pr(self):
        t, info = classify_url(
            "https://github.com/owner/repo/pull/17"
        )
        assert t == URLType.GITHUB_PR
        assert info.pr_number == 17

    def test_documentation_known_domain(self):
        t, _ = classify_url("https://docs.python.org/3/library/json.html")
        assert t == URLType.DOCUMENTATION

    def test_documentation_readthedocs(self):
        t, _ = classify_url("https://mylib.readthedocs.io/en/latest/")
        assert t == URLType.DOCUMENTATION

    def test_documentation_path_pattern(self):
        t, _ = classify_url("https://example.com/docs/api-guide")
        assert t == URLType.DOCUMENTATION

    def test_documentation_api_path(self):
        t, _ = classify_url("https://example.com/api/reference")
        assert t == URLType.DOCUMENTATION

    def test_generic_web(self):
        t, _ = classify_url("https://example.com/blog/post")
        assert t == URLType.GENERIC_WEB

    def test_unknown_scheme(self):
        t, _ = classify_url("ftp://example.com/file")
        assert t == URLType.UNKNOWN

    def test_raw_github_as_file(self):
        t, info = classify_url(
            "https://raw.githubusercontent.com/owner/repo/main/README.md"
        )
        assert t == URLType.GITHUB_FILE
        assert info.owner == "owner"
        assert info.path == "README.md"


# ── Display Name ──────────────────────────────────────────────────

class TestDisplayName:
    def test_github_repo(self):
        info = GitHubInfo(owner="flatmax", repo="jrpc-oo")
        assert display_name("", URLType.GITHUB_REPO, info) == "flatmax/jrpc-oo"

    def test_github_file(self):
        info = GitHubInfo(owner="o", repo="r", path="src/main.py")
        assert display_name("", URLType.GITHUB_FILE, info) == "o/r/main.py"

    def test_github_issue(self):
        info = GitHubInfo(owner="o", repo="r", issue_number=42)
        assert display_name("", URLType.GITHUB_ISSUE, info) == "o/r#42"

    def test_github_pr(self):
        info = GitHubInfo(owner="o", repo="r", pr_number=17)
        assert display_name("", URLType.GITHUB_PR, info) == "o/r!17"

    def test_generic_web(self):
        name = display_name("https://example.com/blog/post", URLType.GENERIC_WEB)
        assert "example.com" in name

    def test_long_url_truncated(self):
        url = "https://example.com/" + "a" * 100
        name = display_name(url, URLType.GENERIC_WEB)
        assert len(name) <= 40

    def test_root_url(self):
        name = display_name("https://example.com/", URLType.GENERIC_WEB)
        assert "example.com" in name


# ── Summary Type Selection ────────────────────────────────────────

class TestSummaryTypeSelection:
    def test_github_repo_with_symbols(self):
        assert select_summary_type(URLType.GITHUB_REPO, has_symbol_map=True) == "architecture"

    def test_github_repo_without_symbols(self):
        assert select_summary_type(URLType.GITHUB_REPO, has_symbol_map=False) == "brief"

    def test_documentation(self):
        assert select_summary_type(URLType.DOCUMENTATION) == "usage"

    def test_generic(self):
        assert select_summary_type(URLType.GENERIC_WEB) == "brief"

    def test_user_hint_howto(self):
        assert select_summary_type(URLType.GENERIC_WEB, user_text="how to use this") == "usage"

    def test_user_hint_api(self):
        assert select_summary_type(URLType.GENERIC_WEB, user_text="show me the api") == "api"

    def test_user_hint_architecture(self):
        assert select_summary_type(URLType.GENERIC_WEB, user_text="architecture overview") == "architecture"

    def test_user_hint_evaluate(self):
        assert select_summary_type(URLType.GENERIC_WEB, user_text="compare with alternatives") == "evaluation"


# ── URLContent ────────────────────────────────────────────────────

class TestURLContent:
    def test_format_for_prompt_summary(self):
        c = URLContent(
            url="https://example.com",
            title="Example",
            summary="A brief summary.",
        )
        prompt = c.format_for_prompt()
        assert "example.com" in prompt
        assert "Example" in prompt
        assert "brief summary" in prompt

    def test_format_for_prompt_readme_fallback(self):
        c = URLContent(
            url="https://github.com/owner/repo",
            readme="# My Project\nDescription here.",
        )
        prompt = c.format_for_prompt()
        assert "My Project" in prompt

    def test_format_for_prompt_symbol_map(self):
        c = URLContent(
            url="https://example.com",
            content="Content",
            symbol_map="c MyClass\n  m method",
        )
        prompt = c.format_for_prompt()
        assert "MyClass" in prompt

    def test_format_truncation(self):
        c = URLContent(
            url="https://example.com",
            content="x" * 10000,
        )
        prompt = c.format_for_prompt(max_length=100)
        assert len(prompt) < 500  # Header + truncated content

    def test_roundtrip_serialization(self):
        c = URLContent(
            url="https://github.com/o/r",
            url_type=URLType.GITHUB_REPO,
            title="Test",
            content="Content",
            summary="Summary",
            summary_type="brief",
            github_info=GitHubInfo(owner="o", repo="r", branch="main"),
            fetched_at=datetime(2025, 1, 1, tzinfo=timezone.utc),
        )
        d = c.to_dict()
        c2 = URLContent.from_dict(d)
        assert c2.url == c.url
        assert c2.url_type == c.url_type
        assert c2.title == c.title
        assert c2.summary == c.summary
        assert c2.github_info.owner == "o"
        assert c2.github_info.branch == "main"


# ── HTML Extraction ───────────────────────────────────────────────

class TestHTMLExtraction:
    def test_title_extraction(self):
        from ac_dc.url_service.fetcher import _extract_fallback
        html = "<html><head><title>My Page</title></head><body>Content</body></html>"
        title, desc, content = _extract_fallback(html)
        assert title == "My Page"

    def test_meta_description(self):
        from ac_dc.url_service.fetcher import _extract_fallback
        html = '<html><head><meta name="description" content="A description"></head></html>'
        _, desc, _ = _extract_fallback(html)
        assert desc == "A description"

    def test_scripts_stripped(self):
        from ac_dc.url_service.fetcher import _extract_fallback
        html = "<html><body><script>evil()</script>Real content</body></html>"
        _, _, content = _extract_fallback(html)
        assert "evil" not in content
        assert "Real content" in content

    def test_charset_detection(self):
        from ac_dc.url_service.fetcher import _decode_entities
        assert _decode_entities("&amp;") == "&"
        assert _decode_entities("&lt;") == "<"


# ── URL Service ───────────────────────────────────────────────────

class TestURLService:
    def test_detect_urls(self):
        svc = URLService()
        results = svc.detect_urls("See https://example.com for info")
        assert len(results) == 1

    def test_get_url_content_unfetched(self):
        svc = URLService()
        content = svc.get_url_content("https://unfetched.com")
        assert content.error is not None

    def test_get_url_content_fetched(self, tmp_path):
        svc = URLService(cache_dir=str(tmp_path))
        # Manually add to fetched dict
        svc._fetched["https://test.com"] = URLContent(
            url="https://test.com", url_type=URLType.GENERIC_WEB,
            content="Test content",
        )
        result = svc.get_url_content("https://test.com")
        assert result.content == "Test content"

    def test_get_url_content_cache_fallback(self, tmp_path):
        svc = URLService(cache_dir=str(tmp_path))
        # Put in cache but not in fetched dict
        cached = URLContent(
            url="https://cached.com", url_type=URLType.GENERIC_WEB,
            content="Cached content",
        )
        svc._cache.set("https://cached.com", cached)
        result = svc.get_url_content("https://cached.com")
        assert result.content == "Cached content"

    def test_invalidate(self, tmp_path):
        svc = URLService(cache_dir=str(tmp_path))
        svc._fetched["https://x.com"] = URLContent(
            url="https://x.com", url_type=URLType.GENERIC_WEB,
        )
        svc._cache.set("https://x.com", svc._fetched["https://x.com"])
        svc.invalidate_url_cache("https://x.com")
        assert "https://x.com" not in svc._fetched
        assert svc._cache.get("https://x.com") is None

    def test_remove_fetched(self, tmp_path):
        svc = URLService(cache_dir=str(tmp_path))
        content = URLContent(url="https://x.com", url_type=URLType.GENERIC_WEB)
        svc._fetched["https://x.com"] = content
        svc._cache.set("https://x.com", content)
        svc.remove_fetched("https://x.com")
        assert "https://x.com" not in svc._fetched
        # Cache preserved
        assert svc._cache.get("https://x.com") is not None

    def test_clear(self, tmp_path):
        svc = URLService(cache_dir=str(tmp_path))
        svc._fetched["https://x.com"] = URLContent(
            url="https://x.com", url_type=URLType.GENERIC_WEB,
        )
        svc.clear_url_cache()
        assert len(svc._fetched) == 0

    def test_get_fetched_urls_empty(self):
        svc = URLService()
        assert svc.get_fetched_urls() == []

    def test_remove_fetched_and_clear_fetched(self, tmp_path):
        svc = URLService(cache_dir=str(tmp_path))
        svc._fetched["https://a.com"] = URLContent(url="https://a.com", url_type=URLType.GENERIC_WEB)
        svc._fetched["https://b.com"] = URLContent(url="https://b.com", url_type=URLType.GENERIC_WEB)
        svc.remove_fetched("https://a.com")
        assert len(svc.get_fetched_urls()) == 1
        svc.clear_fetched()
        assert len(svc.get_fetched_urls()) == 0

    def test_format_url_context(self, tmp_path):
        svc = URLService(cache_dir=str(tmp_path))
        svc._fetched["https://a.com"] = URLContent(
            url="https://a.com", url_type=URLType.GENERIC_WEB,
            title="A", content="Content A",
        )
        svc._fetched["https://b.com"] = URLContent(
            url="https://b.com", url_type=URLType.GENERIC_WEB,
            title="B", content="Content B",
        )
        result = svc.format_url_context()
        assert "Content A" in result
        assert "Content B" in result
        assert "---" in result

    def test_format_url_context_excludes(self, tmp_path):
        svc = URLService(cache_dir=str(tmp_path))
        svc._fetched["https://a.com"] = URLContent(
            url="https://a.com", url_type=URLType.GENERIC_WEB,
            content="A",
        )
        result = svc.format_url_context(excluded={"https://a.com"})
        assert "A" not in result

    def test_format_url_context_skips_errors(self, tmp_path):
        svc = URLService(cache_dir=str(tmp_path))
        svc._fetched["https://err.com"] = URLContent(
            url="https://err.com", url_type=URLType.GENERIC_WEB,
            error="Failed",
        )
        result = svc.format_url_context()
        assert result == ""

    def test_fetch_uses_cache(self, tmp_path):
        svc = URLService(cache_dir=str(tmp_path))
        cached = URLContent(
            url="https://example.com", url_type=URLType.GENERIC_WEB,
            content="Cached", title="Cached Page",
        )
        svc._cache.set("https://example.com", cached)
        result = svc.fetch_url("https://example.com", use_cache=True)
        assert result.content == "Cached"

    @patch("ac_dc.url_service.fetcher.urlopen")
    def test_web_page_fetch(self, mock_urlopen, tmp_path):
        mock_resp = MagicMock()
        mock_resp.read.return_value = b"<html><head><title>Test</title></head><body>Hello</body></html>"
        mock_resp.headers = {"Content-Type": "text/html; charset=utf-8"}
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        svc = URLService(cache_dir=str(tmp_path))
        result = svc.fetch_url("https://example.com/page", use_cache=False)
        assert result.title == "Test"
        assert result.error is None

    def test_error_results_not_cached(self, tmp_path):
        svc = URLService(cache_dir=str(tmp_path))
        # Simulate a failed fetch by directly adding error content
        err = URLContent(
            url="https://fail.com", url_type=URLType.GENERIC_WEB,
            error="Connection refused",
        )
        # Error results should not be in cache
        assert svc._cache.get("https://fail.com") is None

    @patch("ac_dc.url_service.service.URLService._summarize")
    def test_summarization(self, mock_summarize, tmp_path):
        mock_summarize.return_value = "A nice summary"
        svc = URLService(cache_dir=str(tmp_path), model="test/model")
        # Pre-cache content
        content = URLContent(
            url="https://example.com", url_type=URLType.GENERIC_WEB,
            content="Long content here",
        )
        svc._cache.set("https://example.com", content)
        result = svc.fetch_url(
            "https://example.com", use_cache=True, summarize=True,
        )
        assert result.summary == "A nice summary"

    def test_detect_and_fetch(self, tmp_path):
        svc = URLService(cache_dir=str(tmp_path))
        # Pre-cache URLs
        for url in ["https://a.com", "https://b.com"]:
            svc._cache.set(url, URLContent(
                url=url, url_type=URLType.GENERIC_WEB,
                content=f"Content of {url}",
            ))
        results = svc.detect_and_fetch(
            "See https://a.com and https://b.com",
            use_cache=True,
        )
        assert len(results) == 2

    def test_readme_search_priority(self):
        from ac_dc.url_service.fetcher import _README_NAMES
        assert _README_NAMES[0] == "README.md"
        assert "README.rst" in _README_NAMES
        assert "README.txt" in _README_NAMES
        assert "README" in _README_NAMES

    @patch("ac_dc.url_service.fetcher.urlopen")
    def test_github_file_main_master_fallback(self, mock_urlopen, tmp_path):
        from urllib.error import HTTPError
        call_count = {"n": 0}

        def side_effect(req, timeout=None):
            call_count["n"] += 1
            url = req.full_url if hasattr(req, "full_url") else str(req)
            if "/main/" in url:
                raise HTTPError(url, 404, "Not Found", {}, None)
            mock_resp = MagicMock()
            mock_resp.read.return_value = b"file content from master"
            mock_resp.headers = {"Content-Type": "text/plain"}
            mock_resp.__enter__ = lambda s: s
            mock_resp.__exit__ = MagicMock(return_value=False)
            return mock_resp

        mock_urlopen.side_effect = side_effect

        svc = URLService(cache_dir=str(tmp_path))
        result = svc.fetch_url(
            "https://github.com/owner/repo/blob/main/file.py",
            use_cache=False,
        )
        assert result.content == "file content from master"
        assert call_count["n"] == 2  # main failed, master succeeded