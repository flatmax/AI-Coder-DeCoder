"""Tests for URL handling: detection, classification, caching, and fetching."""

import json
import time
import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch
from ac_dc.url_cache import URLCache, _url_hash
from ac_dc.url_handler import (
    detect_urls, classify_url, URLType, GitHubInfo, URLContent,
    URLService, SummaryType, _select_summary_type, _display_name,
    _basic_html_extract, _fetch_web_page, _fetch_github_file,
)


# ======================================================================
# URL Cache tests
# ======================================================================

class TestURLCache:

    @pytest.fixture
    def cache(self, tmp_path):
        return URLCache(str(tmp_path / "cache"), ttl_hours=1)

    def test_set_and_get(self, cache):
        cache.set("https://example.com", {"title": "Example"})
        result = cache.get("https://example.com")
        assert result is not None
        assert result["title"] == "Example"
        assert "fetched_at" in result

    def test_miss_returns_none(self, cache):
        assert cache.get("https://nonexistent.com") is None

    def test_expired_returns_none(self, cache, tmp_path):
        # Create cache with very short TTL
        short_cache = URLCache(str(tmp_path / "short"), ttl_hours=0)
        short_cache._ttl_seconds = 0  # Expire immediately
        short_cache.set("https://example.com", {"title": "test"})
        # Entry should be expired
        time.sleep(0.1)
        assert short_cache.get("https://example.com") is None

    def test_invalidate(self, cache):
        cache.set("https://example.com", {"title": "test"})
        cache.invalidate("https://example.com")
        assert cache.get("https://example.com") is None

    def test_clear(self, cache):
        cache.set("https://a.com", {"a": 1})
        cache.set("https://b.com", {"b": 2})
        cache.clear()
        assert cache.get("https://a.com") is None
        assert cache.get("https://b.com") is None

    def test_cleanup_expired(self, tmp_path):
        cache = URLCache(str(tmp_path / "exp"), ttl_hours=0)
        cache._ttl_seconds = 0
        cache.set("https://a.com", {"a": 1})
        cache.set("https://b.com", {"b": 2})
        time.sleep(0.1)
        removed = cache.cleanup_expired()
        assert removed == 2

    def test_corrupt_entry_handled(self, cache):
        # Write corrupt JSON
        path = cache._path_for("https://example.com")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("not json", encoding="utf-8")
        assert cache.get("https://example.com") is None
        # Should have been cleaned up
        assert not path.exists()

    def test_url_hash_deterministic(self):
        h1 = _url_hash("https://example.com")
        h2 = _url_hash("https://example.com")
        assert h1 == h2
        assert len(h1) == 16

    def test_url_hash_different(self):
        assert _url_hash("https://a.com") != _url_hash("https://b.com")

    def test_default_cache_dir(self):
        cache = URLCache()
        assert cache.cache_dir.exists()
        assert "ac-dc-url-cache" in str(cache.cache_dir)


# ======================================================================
# URL Detection tests
# ======================================================================

class TestDetectURLs:

    def test_basic_detection(self):
        text = "Check out https://example.com for more info."
        results = detect_urls(text)
        assert len(results) == 1
        assert results[0]["url"] == "https://example.com"

    def test_multiple_urls(self):
        text = "See https://a.com and https://b.com for details."
        results = detect_urls(text)
        assert len(results) == 2

    def test_deduplication(self):
        text = "Visit https://example.com. Again: https://example.com"
        results = detect_urls(text)
        assert len(results) == 1

    def test_trailing_punctuation_stripped(self):
        text = "Go to https://example.com/path."
        results = detect_urls(text)
        assert results[0]["url"] == "https://example.com/path"

    def test_trailing_comma_stripped(self):
        text = "Links: https://a.com, https://b.com."
        results = detect_urls(text)
        assert results[0]["url"] == "https://a.com"
        assert results[1]["url"] == "https://b.com"

    def test_no_urls(self):
        assert detect_urls("no urls here") == []

    def test_http_supported(self):
        results = detect_urls("http://insecure.example.com")
        assert len(results) == 1

    def test_file_scheme_rejected(self):
        results = detect_urls("file:///etc/passwd")
        assert len(results) == 0


# ======================================================================
# URL Classification tests
# ======================================================================

class TestClassifyURL:

    def test_github_repo(self):
        url_type, info = classify_url("https://github.com/owner/repo")
        assert url_type == URLType.GITHUB_REPO
        assert info.owner == "owner"
        assert info.repo == "repo"

    def test_github_repo_trailing_slash(self):
        url_type, info = classify_url("https://github.com/owner/repo/")
        assert url_type == URLType.GITHUB_REPO

    def test_github_repo_dot_git(self):
        url_type, info = classify_url("https://github.com/owner/repo.git")
        assert url_type == URLType.GITHUB_REPO
        assert info.repo == "repo"

    def test_github_file(self):
        url_type, info = classify_url(
            "https://github.com/owner/repo/blob/main/src/app.py"
        )
        assert url_type == URLType.GITHUB_FILE
        assert info.owner == "owner"
        assert info.repo == "repo"
        assert info.branch == "main"
        assert info.path == "src/app.py"

    def test_github_issue(self):
        url_type, info = classify_url(
            "https://github.com/owner/repo/issues/42"
        )
        assert url_type == URLType.GITHUB_ISSUE
        assert info.issue_number == 42

    def test_github_pr(self):
        url_type, info = classify_url(
            "https://github.com/owner/repo/pull/99"
        )
        assert url_type == URLType.GITHUB_PR
        assert info.pr_number == 99

    def test_documentation_domain(self):
        url_type, info = classify_url("https://docs.python.org/3/library/os.html")
        assert url_type == URLType.DOCUMENTATION
        assert info is None

    def test_readthedocs(self):
        url_type, _ = classify_url("https://myproject.readthedocs.io/en/latest/")
        assert url_type == URLType.DOCUMENTATION

    def test_docs_path(self):
        url_type, _ = classify_url("https://example.com/docs/getting-started")
        assert url_type == URLType.DOCUMENTATION

    def test_api_path(self):
        url_type, _ = classify_url("https://example.com/api/reference")
        assert url_type == URLType.DOCUMENTATION

    def test_generic_url(self):
        url_type, info = classify_url("https://example.com/page")
        assert url_type == URLType.GENERIC
        assert info is None


# ======================================================================
# Display Name tests
# ======================================================================

class TestDisplayName:

    def test_github_repo(self):
        name = _display_name(
            "https://github.com/owner/repo",
            URLType.GITHUB_REPO,
            GitHubInfo(owner="owner", repo="repo"),
        )
        assert name == "owner/repo"

    def test_github_file(self):
        name = _display_name(
            "https://github.com/owner/repo/blob/main/src/deep/file.py",
            URLType.GITHUB_FILE,
            GitHubInfo(owner="owner", repo="repo", path="src/deep/file.py"),
        )
        assert name == "owner/repo/file.py"

    def test_github_issue(self):
        name = _display_name(
            "https://github.com/owner/repo/issues/42",
            URLType.GITHUB_ISSUE,
            GitHubInfo(owner="owner", repo="repo", issue_number=42),
        )
        assert name == "owner/repo#42"

    def test_github_pr(self):
        name = _display_name(
            "https://github.com/owner/repo/pull/7",
            URLType.GITHUB_PR,
            GitHubInfo(owner="owner", repo="repo", pr_number=7),
        )
        assert name == "owner/repo!7"

    def test_generic_short(self):
        name = _display_name("https://example.com/path", URLType.GENERIC, None)
        assert name == "example.com/path"

    def test_generic_long_truncated(self):
        long_url = "https://example.com/" + "a" * 100
        name = _display_name(long_url, URLType.GENERIC, None)
        assert len(name) == 40
        assert name.endswith("...")

    def test_generic_root(self):
        name = _display_name("https://example.com/", URLType.GENERIC, None)
        assert name == "example.com"


# ======================================================================
# Summary Type Selection tests
# ======================================================================

class TestSummaryTypeSelection:

    def test_github_repo_with_symbols(self):
        stype = _select_summary_type(URLType.GITHUB_REPO, True)
        assert stype == SummaryType.ARCHITECTURE

    def test_github_repo_without_symbols(self):
        stype = _select_summary_type(URLType.GITHUB_REPO, False)
        assert stype == SummaryType.BRIEF

    def test_documentation(self):
        stype = _select_summary_type(URLType.DOCUMENTATION, False)
        assert stype == SummaryType.USAGE

    def test_generic(self):
        stype = _select_summary_type(URLType.GENERIC, False)
        assert stype == SummaryType.BRIEF

    def test_user_hint_howto(self):
        stype = _select_summary_type(URLType.GENERIC, False, "how to use this")
        assert stype == SummaryType.USAGE

    def test_user_hint_api(self):
        stype = _select_summary_type(URLType.GENERIC, False, "what's the api")
        assert stype == SummaryType.API

    def test_user_hint_architecture(self):
        stype = _select_summary_type(URLType.GENERIC, False, "describe the architecture")
        assert stype == SummaryType.ARCHITECTURE

    def test_user_hint_compare(self):
        stype = _select_summary_type(URLType.GENERIC, False, "compare alternatives")
        assert stype == SummaryType.EVALUATION


# ======================================================================
# URLContent tests
# ======================================================================

class TestURLContent:

    def test_format_for_prompt_basic(self):
        c = URLContent(
            url="https://example.com",
            title="Example",
            content="Some page content here.",
        )
        prompt = c.format_for_prompt()
        assert "## https://example.com" in prompt
        assert "**Example**" in prompt
        assert "Some page content" in prompt

    def test_format_for_prompt_summary_preferred(self):
        c = URLContent(
            url="https://example.com",
            content="raw content",
            summary="summarized version",
        )
        prompt = c.format_for_prompt()
        assert "summarized version" in prompt
        # Summary takes priority
        assert "raw content" not in prompt

    def test_format_for_prompt_readme_fallback(self):
        c = URLContent(url="https://github.com/x/y", readme="# README")
        prompt = c.format_for_prompt()
        assert "# README" in prompt

    def test_format_for_prompt_with_symbol_map(self):
        c = URLContent(
            url="https://example.com",
            content="stuff",
            symbol_map="c MyClass:10",
        )
        prompt = c.format_for_prompt()
        assert "### Symbol Map" in prompt
        assert "MyClass" in prompt

    def test_format_for_prompt_truncation(self):
        c = URLContent(url="https://example.com", content="x" * 10000)
        prompt = c.format_for_prompt(max_length=100)
        assert "..." in prompt

    def test_round_trip_serialization(self):
        original = URLContent(
            url="https://github.com/owner/repo",
            url_type=URLType.GITHUB_REPO,
            title="Test",
            content="content",
            symbol_map="symbols",
            readme="readme",
            github_info=GitHubInfo(owner="owner", repo="repo"),
            summary="summary",
            summary_type="brief",
        )
        d = original.to_dict()
        restored = URLContent.from_dict(d)
        assert restored.url == original.url
        assert restored.url_type == original.url_type
        assert restored.title == original.title
        assert restored.content == original.content
        assert restored.github_info.owner == "owner"
        assert restored.summary == "summary"

    def test_from_dict_no_github(self):
        d = {"url": "https://example.com", "url_type": "generic"}
        c = URLContent.from_dict(d)
        assert c.github_info is None
        assert c.url_type == URLType.GENERIC


# ======================================================================
# Basic HTML extraction tests
# ======================================================================

class TestBasicHTMLExtract:

    def test_extracts_title(self):
        html = "<html><head><title>My Page</title></head><body>Hello</body></html>"
        text, title = _basic_html_extract(html)
        assert title == "My Page"
        assert "Hello" in text

    def test_strips_scripts(self):
        html = "<p>Before</p><script>alert('xss')</script><p>After</p>"
        text, _ = _basic_html_extract(html)
        assert "alert" not in text
        assert "Before" in text
        assert "After" in text

    def test_strips_styles(self):
        html = "<style>.foo{color:red}</style><p>Content</p>"
        text, _ = _basic_html_extract(html)
        assert "color" not in text
        assert "Content" in text

    def test_cleans_whitespace(self):
        html = "<p>Hello</p>    \n\n\n\n   <p>World</p>"
        text, _ = _basic_html_extract(html)
        assert "\n\n\n" not in text


# ======================================================================
# URL Service tests
# ======================================================================

class TestURLService:

    @pytest.fixture
    def service(self, tmp_path):
        return URLService(
            cache_config={"path": str(tmp_path / "cache"), "ttl_hours": 1},
            smaller_model="",
        )

    def test_detect_urls(self, service):
        results = service.detect_urls("See https://example.com")
        assert len(results) == 1
        assert results[0]["url"] == "https://example.com"

    def test_get_url_content_not_fetched(self, service):
        result = service.get_url_content("https://nonexistent.com")
        assert "error" in result

    def test_invalidate_cache(self, service):
        service._cache.set("https://example.com", {"title": "test"})
        service.invalidate_url_cache("https://example.com")
        assert service._cache.get("https://example.com") is None

    def test_clear_cache(self, service):
        service._cache.set("https://a.com", {"a": 1})
        service.clear_url_cache()
        assert service._cache.get("https://a.com") is None

    def test_get_fetched_urls_empty(self, service):
        assert service.get_fetched_urls() == []

    def test_remove_fetched(self, service):
        service._fetched["https://example.com"] = URLContent(url="https://example.com")
        service.remove_fetched("https://example.com")
        assert "https://example.com" not in service._fetched

    def test_clear_fetched(self, service):
        service._fetched["https://a.com"] = URLContent(url="https://a.com")
        service._fetched["https://b.com"] = URLContent(url="https://b.com")
        service.clear_fetched()
        assert len(service._fetched) == 0

    def test_format_url_context(self, service):
        service._fetched["https://a.com"] = URLContent(
            url="https://a.com", title="A", content="Content A",
        )
        service._fetched["https://b.com"] = URLContent(
            url="https://b.com", title="B", content="Content B",
        )
        result = service.format_url_context(["https://a.com", "https://b.com"])
        assert "Content A" in result
        assert "Content B" in result
        assert "---" in result

    def test_format_url_context_excludes(self, service):
        service._fetched["https://a.com"] = URLContent(
            url="https://a.com", content="A",
        )
        service._fetched["https://b.com"] = URLContent(
            url="https://b.com", content="B",
        )
        result = service.format_url_context(
            ["https://a.com", "https://b.com"],
            excluded={"https://a.com"},
        )
        assert "A" not in result.split("---")[0] if "---" in result else "A" not in result
        assert "B" in result

    def test_format_url_context_skips_errors(self, service):
        service._fetched["https://bad.com"] = URLContent(
            url="https://bad.com", error="failed",
        )
        result = service.format_url_context(["https://bad.com"])
        assert result == ""

    def test_fetch_uses_cache(self, service):
        # Pre-populate cache
        cached_data = URLContent(
            url="https://example.com",
            url_type=URLType.GENERIC,
            title="Cached",
            content="cached content",
        ).to_dict()
        cached_data["fetched_at"] = time.time()
        service._cache.set("https://example.com", cached_data)

        result = service.fetch_url("https://example.com", summarize=False)
        assert result["title"] == "Cached"
        assert result["content"] == "cached content"

    @patch("ac_dc.url_handler.urllib.request.urlopen")
    def test_fetch_web_page(self, mock_urlopen, service):
        mock_resp = MagicMock()
        mock_resp.read.return_value = b"<html><head><title>Test</title></head><body><p>Hello World</p></body></html>"
        mock_resp.headers = {"Content-Type": "text/html; charset=utf-8"}
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        result = service.fetch_url(
            "https://example.com/page",
            use_cache=False,
            summarize=False,
        )
        assert result.get("title") == "Test"
        assert "Hello World" in result.get("content", "")

    @patch("ac_dc.url_handler.urllib.request.urlopen")
    def test_fetch_github_file(self, mock_urlopen, service):
        mock_resp = MagicMock()
        mock_resp.read.return_value = b"def hello():\n    print('hi')\n"
        mock_resp.headers = {}
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        result = service.fetch_url(
            "https://github.com/owner/repo/blob/main/src/hello.py",
            use_cache=False,
            summarize=False,
        )
        assert result["url_type"] == "github_file"
        assert "def hello" in result.get("content", "")

    def test_fetch_error_not_cached(self, service):
        # Fetching a bad URL should not cache the error
        with patch("ac_dc.url_handler._fetch_web_page") as mock_fetch:
            mock_fetch.return_value = URLContent(
                url="https://bad.com",
                error="connection refused",
            )
            result = service.fetch_url(
                "https://bad.com",
                use_cache=False,
                summarize=False,
            )
        assert result.get("error") == "connection refused"
        assert service._cache.get("https://bad.com") is None


class TestURLServiceWithSummarization:

    @patch("ac_dc.url_handler.litellm", create=True)
    def test_fetch_with_summary(self, mock_litellm):
        with patch.dict("sys.modules", {"litellm": mock_litellm}):
            mock_response = MagicMock()
            mock_response.choices = [MagicMock()]
            mock_response.choices[0].message.content = "This is a summary."
            mock_litellm.completion.return_value = mock_response

            import tempfile
            with tempfile.TemporaryDirectory() as tmpdir:
                service = URLService(
                    cache_config={"path": tmpdir, "ttl_hours": 1},
                    smaller_model="test/model",
                )
                # Pre-populate cache with content
                cached = URLContent(
                    url="https://example.com",
                    content="Long content here",
                ).to_dict()
                cached["fetched_at"] = time.time()
                service._cache.set("https://example.com", cached)

                result = service.fetch_url(
                    "https://example.com",
                    summarize=True,
                )
                assert result.get("summary") == "This is a summary."
