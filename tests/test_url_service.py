"""Tests for ac_dc.url_service.service — Layer 4.1.5.

Scope:

- Construction with / without cache / smaller model /
  symbol-index class injection.
- ``detect_urls`` — wire-format output shape (url / type / display_name).
- ``fetch_url`` pipeline — cache check, classification, handler
  dispatch (web / GitHub file / GitHub repo / GitHub issue / PR),
  cache write on success, summary generation, in-memory store.
- Cached-with-summary-requested update-in-place path.
- ``detect_and_fetch`` — multiple URLs, already-fetched skip,
  max-URLs limit.
- ``get_url_content`` — in-memory first, cache fallback,
  sentinel on miss, cache hit hoists into in-memory dict.
- Cache management — invalidate (both), clear (both), remove
  fetched (in-memory only), clear fetched (in-memory only).
- ``format_url_context`` — default-all, explicit list,
  exclusions, errored-record skipping, cache fallback.
- ``_parse_github_info`` helper — every GitHub URL shape.

Strategy:

- Per-test temp directory for the URLCache so no real filesystem
  state leaks between tests.
- Fetchers mocked at module boundary — we don't exercise real
  HTTP or git.
- Summarizer mocked via sys.modules fake litellm, same pattern
  as test_url_summarizer.py.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from ac_dc.url_service.cache import URLCache
from ac_dc.url_service.detection import URLType
from ac_dc.url_service.models import GitHubInfo, URLContent
from ac_dc.url_service.service import (
    URLService,
    _parse_github_info,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def cache_dir(tmp_path: Path) -> Path:
    d = tmp_path / "url_cache"
    return d


@pytest.fixture
def cache(cache_dir: Path) -> URLCache:
    return URLCache(cache_dir, ttl_hours=24)


class _FakeLiteLLM:
    """Fake litellm for summarize tests. Installed via sys.modules."""

    def __init__(self) -> None:
        self.reply_text = "summary text"
        self.completion_calls: list[dict[str, Any]] = []

    def completion(self, **kwargs: Any) -> Any:
        self.completion_calls.append(kwargs)

        class _Msg:
            def __init__(self, t: str) -> None:
                self.content = t

        class _Choice:
            def __init__(self, t: str) -> None:
                self.message = _Msg(t)

        class _Resp:
            def __init__(self, t: str) -> None:
                self.choices = [_Choice(t)]

        return _Resp(self.reply_text)


@pytest.fixture
def fake_litellm(monkeypatch: pytest.MonkeyPatch) -> _FakeLiteLLM:
    fake = _FakeLiteLLM()
    monkeypatch.setitem(sys.modules, "litellm", fake)
    return fake


class _FakeSymbolIndex:
    """Stub matching SymbolIndex.__init__(repo_root=Path) shape."""

    def __init__(self, repo_root: Path) -> None:
        self.repo_root = repo_root

    def index_repo(self, files: list[str]) -> None:
        pass

    def get_symbol_map(self) -> str:
        return "fake symbol map"


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------


class TestConstruction:
    """Constructor wiring."""

    def test_default_construction(self) -> None:
        service = URLService()
        assert service._cache is None
        assert service._smaller_model is None
        assert service._symbol_index_cls is None
        assert service._fetched == {}

    def test_with_cache(self, cache: URLCache) -> None:
        service = URLService(cache=cache)
        assert service._cache is cache

    def test_with_smaller_model(self) -> None:
        service = URLService(smaller_model="fake/model")
        assert service._smaller_model == "fake/model"

    def test_with_symbol_index_cls(self) -> None:
        service = URLService(symbol_index_cls=_FakeSymbolIndex)
        assert service._symbol_index_cls is _FakeSymbolIndex

    def test_full_construction(self, cache: URLCache) -> None:
        service = URLService(
            cache=cache,
            smaller_model="fake/model",
            symbol_index_cls=_FakeSymbolIndex,
        )
        assert service._cache is cache
        assert service._smaller_model == "fake/model"
        assert service._symbol_index_cls is _FakeSymbolIndex


# ---------------------------------------------------------------------------
# _parse_github_info
# ---------------------------------------------------------------------------


class TestParseGitHubInfo:
    """URL → GitHubInfo extraction."""

    def test_repo_url(self) -> None:
        info = _parse_github_info(
            "https://github.com/octo/hello",
            URLType.GITHUB_REPO,
        )
        assert info.owner == "octo"
        assert info.repo == "hello"

    def test_repo_url_with_git_suffix(self) -> None:
        info = _parse_github_info(
            "https://github.com/octo/hello.git",
            URLType.GITHUB_REPO,
        )
        assert info.repo == "hello"

    def test_file_url(self) -> None:
        info = _parse_github_info(
            "https://github.com/octo/hello/blob/main/src/app.py",
            URLType.GITHUB_FILE,
        )
        assert info.owner == "octo"
        assert info.repo == "hello"
        assert info.branch == "main"
        assert info.path == "src/app.py"

    def test_file_url_deep_path(self) -> None:
        info = _parse_github_info(
            "https://github.com/octo/hello/blob/main/a/b/c/d.py",
            URLType.GITHUB_FILE,
        )
        assert info.path == "a/b/c/d.py"

    def test_raw_url(self) -> None:
        info = _parse_github_info(
            "https://raw.githubusercontent.com/octo/hello/main/README.md",
            URLType.GITHUB_FILE,
        )
        assert info.owner == "octo"
        assert info.repo == "hello"
        assert info.branch == "main"
        assert info.path == "README.md"

    def test_issue_url(self) -> None:
        info = _parse_github_info(
            "https://github.com/octo/hello/issues/42",
            URLType.GITHUB_ISSUE,
        )
        assert info.owner == "octo"
        assert info.repo == "hello"
        assert info.issue_number == 42

    def test_pr_url(self) -> None:
        info = _parse_github_info(
            "https://github.com/octo/hello/pull/99",
            URLType.GITHUB_PR,
        )
        assert info.pr_number == 99


# ---------------------------------------------------------------------------
# detect_urls
# ---------------------------------------------------------------------------


class TestDetectUrls:
    """Wire-format output for the detect-urls RPC."""

    def test_empty_text(self) -> None:
        service = URLService()
        assert service.detect_urls("") == []

    def test_single_url(self) -> None:
        service = URLService()
        result = service.detect_urls("see https://example.com")
        assert len(result) == 1
        entry = result[0]
        assert entry["url"] == "https://example.com"
        assert entry["type"] == "generic"
        assert entry["display_name"] == "example.com"

    def test_multiple_urls(self) -> None:
        service = URLService()
        result = service.detect_urls(
            "https://github.com/a/b and https://docs.python.org/3/"
        )
        assert len(result) == 2
        assert result[0]["type"] == "github_repo"
        assert result[1]["type"] == "documentation"

    def test_github_repo_display_name(self) -> None:
        service = URLService()
        result = service.detect_urls("https://github.com/octo/hello")
        assert result[0]["display_name"] == "octo/hello"


# ---------------------------------------------------------------------------
# fetch_url dispatch
# ---------------------------------------------------------------------------


class TestFetchUrlDispatch:
    """Each URL type reaches the correct fetcher."""

    def test_generic_url_routes_to_web_fetcher(self) -> None:
        with patch(
            "ac_dc.url_service.service.fetch_web_page",
            return_value=URLContent(
                url="https://example.com",
                url_type="generic",
                content="body",
            ),
        ) as mock_web:
            service = URLService()
            result = service.fetch_url(
                "https://example.com", use_cache=False
            )
        mock_web.assert_called_once_with("https://example.com")
        assert result.content == "body"

    def test_github_repo_routes_to_repo_fetcher(self) -> None:
        with patch(
            "ac_dc.url_service.service.fetch_github_repo",
            return_value=URLContent(
                url="https://github.com/octo/hello",
                url_type="github_repo",
                readme="# Hi",
            ),
        ) as mock_repo:
            service = URLService(symbol_index_cls=_FakeSymbolIndex)
            result = service.fetch_url(
                "https://github.com/octo/hello", use_cache=False
            )
        # Called with url + info + symbol_index_cls.
        mock_repo.assert_called_once()
        args = mock_repo.call_args
        assert args.args[0] == "https://github.com/octo/hello"
        assert isinstance(args.args[1], GitHubInfo)
        assert args.args[1].owner == "octo"
        assert args.kwargs["symbol_index_cls"] is _FakeSymbolIndex
        assert result.readme == "# Hi"

    def test_github_file_routes_to_file_fetcher(self) -> None:
        with patch(
            "ac_dc.url_service.service.fetch_github_file",
            return_value=URLContent(
                url="https://github.com/octo/hello/blob/main/f.py",
                url_type="github_file",
                content="code",
            ),
        ) as mock_file:
            service = URLService()
            result = service.fetch_url(
                "https://github.com/octo/hello/blob/main/f.py",
                use_cache=False,
            )
        mock_file.assert_called_once()
        info = mock_file.call_args.args[1]
        assert info.owner == "octo"
        assert info.path == "f.py"
        assert result.content == "code"

    def test_documentation_routes_to_web_fetcher(self) -> None:
        """Doc URLs go through the web fetcher with type overwritten."""
        with patch(
            "ac_dc.url_service.service.fetch_web_page",
            return_value=URLContent(
                url="https://docs.python.org/3/",
                url_type="generic",  # web fetcher default
                content="docs",
            ),
        ):
            service = URLService()
            result = service.fetch_url(
                "https://docs.python.org/3/", use_cache=False
            )
        # Service overwrites to documentation type.
        assert result.url_type == "documentation"

    def test_github_issue_routes_to_web_fetcher_with_info(self) -> None:
        """Issue URLs go through web fetcher but carry github_info."""
        with patch(
            "ac_dc.url_service.service.fetch_web_page",
            return_value=URLContent(
                url="https://github.com/octo/hello/issues/42",
                url_type="generic",
                content="issue body",
            ),
        ):
            service = URLService()
            result = service.fetch_url(
                "https://github.com/octo/hello/issues/42",
                use_cache=False,
            )
        assert result.url_type == "github_issue"
        assert result.github_info is not None
        assert result.github_info.issue_number == 42


# ---------------------------------------------------------------------------
# Cache interactions
# ---------------------------------------------------------------------------


class TestFetchUrlCache:
    """Cache check, cache write, and cached-summary update."""

    def test_cache_hit_returns_cached(self, cache: URLCache) -> None:
        """Pre-populated cache entry returned without fetching."""
        cached_content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="cached body",
        )
        cache.set("https://example.com", cached_content.to_dict())

        with patch(
            "ac_dc.url_service.service.fetch_web_page",
        ) as mock_web:
            service = URLService(cache=cache)
            result = service.fetch_url("https://example.com")
        # No fetch because cache hit.
        mock_web.assert_not_called()
        assert result.content == "cached body"
        # Stored in memory too.
        assert "https://example.com" in service._fetched

    def test_cache_miss_fetches_and_writes(
        self, cache: URLCache
    ) -> None:
        """Fresh URL triggers fetch, writes to cache."""
        with patch(
            "ac_dc.url_service.service.fetch_web_page",
            return_value=URLContent(
                url="https://example.com",
                url_type="generic",
                content="fresh body",
            ),
        ):
            service = URLService(cache=cache)
            service.fetch_url("https://example.com")
        # Cache now populated.
        cached = cache.get("https://example.com")
        assert cached is not None
        assert cached["content"] == "fresh body"

    def test_use_cache_false_bypasses_cache(
        self, cache: URLCache
    ) -> None:
        """use_cache=False skips both check and write."""
        cached_content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="stale",
        )
        cache.set("https://example.com", cached_content.to_dict())

        with patch(
            "ac_dc.url_service.service.fetch_web_page",
            return_value=URLContent(
                url="https://example.com",
                url_type="generic",
                content="fresh",
            ),
        ) as mock_web:
            service = URLService(cache=cache)
            result = service.fetch_url(
                "https://example.com", use_cache=False
            )
        # Fetch happened despite cached entry.
        mock_web.assert_called_once()
        assert result.content == "fresh"

    def test_error_fetch_not_cached(self, cache: URLCache) -> None:
        """Error records are refused by the cache."""
        with patch(
            "ac_dc.url_service.service.fetch_web_page",
            return_value=URLContent(
                url="https://example.com",
                url_type="generic",
                error="HTTP 500",
            ),
        ):
            service = URLService(cache=cache)
            service.fetch_url("https://example.com")
        assert cache.get("https://example.com") is None

    def test_cache_hit_with_summary_requested_updates_in_place(
        self, cache: URLCache, fake_litellm: _FakeLiteLLM
    ) -> None:
        """Cached entry lacking summary gets updated, not re-fetched."""
        cached_content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="body",
        )
        cache.set("https://example.com", cached_content.to_dict())

        with patch(
            "ac_dc.url_service.service.fetch_web_page",
        ) as mock_web:
            service = URLService(
                cache=cache, smaller_model="fake/model"
            )
            result = service.fetch_url(
                "https://example.com", summarize=True
            )
        # Did NOT re-fetch.
        mock_web.assert_not_called()
        # Summary generated.
        assert result.summary == "summary text"
        # Cache updated with the summary.
        cached_now = cache.get("https://example.com")
        assert cached_now["summary"] == "summary text"

    def test_cache_hit_with_existing_summary_no_llm_call(
        self, cache: URLCache, fake_litellm: _FakeLiteLLM
    ) -> None:
        """Cached entry already has summary — no LLM call."""
        cached_content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="body",
            summary="existing summary",
            summary_type="brief",
        )
        cache.set("https://example.com", cached_content.to_dict())

        with patch("ac_dc.url_service.service.fetch_web_page"):
            service = URLService(
                cache=cache, smaller_model="fake/model"
            )
            result = service.fetch_url(
                "https://example.com", summarize=True
            )
        assert result.summary == "existing summary"
        # No LLM call — cache already had the summary.
        assert len(fake_litellm.completion_calls) == 0


# ---------------------------------------------------------------------------
# Summarization integration
# ---------------------------------------------------------------------------


class TestFetchUrlSummarize:
    """fetch_url with summarize=True runs the summarizer."""

    def test_summarize_runs_llm(
        self, fake_litellm: _FakeLiteLLM
    ) -> None:
        with patch(
            "ac_dc.url_service.service.fetch_web_page",
            return_value=URLContent(
                url="https://example.com",
                url_type="generic",
                content="body",
            ),
        ):
            service = URLService(smaller_model="fake/model")
            result = service.fetch_url(
                "https://example.com",
                use_cache=False,
                summarize=True,
            )
        assert result.summary == "summary text"
        assert len(fake_litellm.completion_calls) == 1

    def test_summarize_skipped_without_smaller_model(
        self, fake_litellm: _FakeLiteLLM
    ) -> None:
        """summarize=True with no model configured — silent no-op."""
        with patch(
            "ac_dc.url_service.service.fetch_web_page",
            return_value=URLContent(
                url="https://example.com",
                url_type="generic",
                content="body",
            ),
        ):
            service = URLService(smaller_model=None)
            result = service.fetch_url(
                "https://example.com",
                use_cache=False,
                summarize=True,
            )
        assert result.summary is None
        # No LLM call attempted.
        assert len(fake_litellm.completion_calls) == 0

    def test_summarize_not_called_on_error_fetch(
        self, fake_litellm: _FakeLiteLLM
    ) -> None:
        """Error records are not summarized."""
        with patch(
            "ac_dc.url_service.service.fetch_web_page",
            return_value=URLContent(
                url="https://example.com",
                url_type="generic",
                error="HTTP 500",
            ),
        ):
            service = URLService(smaller_model="fake/model")
            result = service.fetch_url(
                "https://example.com",
                use_cache=False,
                summarize=True,
            )
        assert result.error == "HTTP 500"
        assert len(fake_litellm.completion_calls) == 0

    def test_summarize_updates_cache(
        self, cache: URLCache, fake_litellm: _FakeLiteLLM
    ) -> None:
        """After summarize, cache entry has summary."""
        with patch(
            "ac_dc.url_service.service.fetch_web_page",
            return_value=URLContent(
                url="https://example.com",
                url_type="generic",
                content="body",
            ),
        ):
            service = URLService(
                cache=cache, smaller_model="fake/model"
            )
            service.fetch_url(
                "https://example.com", summarize=True
            )
        cached = cache.get("https://example.com")
        assert cached["summary"] == "summary text"


# ---------------------------------------------------------------------------
# In-memory fetched dict
# ---------------------------------------------------------------------------


class TestInMemoryFetched:
    """Fetched dict populated on every fetch regardless of result."""

    def test_successful_fetch_stored(self) -> None:
        with patch(
            "ac_dc.url_service.service.fetch_web_page",
            return_value=URLContent(
                url="https://example.com",
                url_type="generic",
                content="body",
            ),
        ):
            service = URLService()
            service.fetch_url(
                "https://example.com", use_cache=False
            )
        assert "https://example.com" in service._fetched

    def test_error_fetch_stored(self) -> None:
        """Even error records are stored in memory."""
        with patch(
            "ac_dc.url_service.service.fetch_web_page",
            return_value=URLContent(
                url="https://example.com",
                url_type="generic",
                error="HTTP 500",
            ),
        ):
            service = URLService()
            service.fetch_url(
                "https://example.com", use_cache=False
            )
        # Stored so the caller can inspect the error without
        # re-issuing the fetch.
        assert "https://example.com" in service._fetched
        assert service._fetched["https://example.com"].error == "HTTP 500"


# ---------------------------------------------------------------------------
# detect_and_fetch
# ---------------------------------------------------------------------------


class TestDetectAndFetch:
    """Multi-URL detection + sequential fetch convenience wrapper."""

    def test_empty_text(self) -> None:
        service = URLService()
        assert service.detect_and_fetch("") == []

    def test_fetches_all_detected_urls(self) -> None:
        def side_effect(url: str) -> URLContent:
            return URLContent(
                url=url, url_type="generic", content=f"body of {url}"
            )

        with patch(
            "ac_dc.url_service.service.fetch_web_page",
            side_effect=side_effect,
        ):
            service = URLService()
            results = service.detect_and_fetch(
                "see https://a.example.com and https://b.example.com"
            )
        assert len(results) == 2
        assert results[0].content == "body of https://a.example.com"
        assert results[1].content == "body of https://b.example.com"

    def test_max_urls_caps_fetches(self) -> None:
        with patch(
            "ac_dc.url_service.service.fetch_web_page",
            return_value=URLContent(
                url="x", url_type="generic", content="y"
            ),
        ) as mock_web:
            service = URLService()
            results = service.detect_and_fetch(
                "https://a.example.com https://b.example.com "
                "https://c.example.com",
                max_urls=2,
            )
        assert len(results) == 2
        # Only two fetch calls despite three URLs in text.
        assert mock_web.call_count == 2

    def test_already_fetched_url_reused(self) -> None:
        """URL present in _fetched from earlier turn is reused."""
        cached_result = URLContent(
            url="https://example.com",
            url_type="generic",
            content="from earlier",
        )
        service = URLService()
        service._fetched["https://example.com"] = cached_result

        with patch(
            "ac_dc.url_service.service.fetch_web_page",
        ) as mock_web:
            results = service.detect_and_fetch(
                "see https://example.com again"
            )
        assert results == [cached_result]
        mock_web.assert_not_called()


# ---------------------------------------------------------------------------
# get_url_content
# ---------------------------------------------------------------------------


class TestGetUrlContent:
    """Content retrieval for display — memory first, cache fallback."""

    def test_in_memory_hit(self) -> None:
        service = URLService()
        content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="body",
        )
        service._fetched["https://example.com"] = content
        assert service.get_url_content("https://example.com") is content

    def test_filesystem_cache_fallback(
        self, cache: URLCache
    ) -> None:
        """URL in cache but not in memory is hoisted in."""
        cached = URLContent(
            url="https://example.com",
            url_type="generic",
            content="from disk",
        )
        cache.set("https://example.com", cached.to_dict())

        service = URLService(cache=cache)
        result = service.get_url_content("https://example.com")
        assert result.content == "from disk"
        # Hoisted into memory so subsequent calls are O(1).
        assert "https://example.com" in service._fetched

    def test_sentinel_on_miss(self) -> None:
        """URL in neither memory nor cache returns sentinel error."""
        service = URLService()
        result = service.get_url_content("https://example.com")
        assert result.error == "URL not yet fetched"
        assert result.url == "https://example.com"

    def test_sentinel_with_cache_miss(self, cache: URLCache) -> None:
        """Cache present but URL absent still returns sentinel."""
        service = URLService(cache=cache)
        result = service.get_url_content("https://unknown.example.com")
        assert result.error == "URL not yet fetched"


# ---------------------------------------------------------------------------
# Cache and in-memory management
# ---------------------------------------------------------------------------


class TestInvalidateUrlCache:
    """Remove from both cache and in-memory dict."""

    def test_removes_from_both_stores(self, cache: URLCache) -> None:
        content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="body",
        )
        cache.set("https://example.com", content.to_dict())
        service = URLService(cache=cache)
        service._fetched["https://example.com"] = content

        result = service.invalidate_url_cache("https://example.com")
        assert result["status"] == "ok"
        assert result["cache_removed"] is True
        assert result["fetched_removed"] is True
        assert cache.get("https://example.com") is None
        assert "https://example.com" not in service._fetched

    def test_idempotent_on_unknown_url(self) -> None:
        service = URLService()
        result = service.invalidate_url_cache("https://unknown.example.com")
        assert result["status"] == "ok"
        assert result["fetched_removed"] is False

    def test_no_cache_still_works(self) -> None:
        """Service without a cache still clears in-memory entry."""
        service = URLService()
        service._fetched["https://example.com"] = URLContent(
            url="https://example.com"
        )
        result = service.invalidate_url_cache("https://example.com")
        assert result["fetched_removed"] is True
        assert result["cache_removed"] is False


class TestClearUrlCache:
    """Clear everything."""

    def test_clears_both_stores(self, cache: URLCache) -> None:
        for i in range(3):
            url = f"https://ex{i}.com"
            cache.set(url, {"url": url, "url_type": "generic"})

        service = URLService(cache=cache)
        service._fetched["https://a.com"] = URLContent(url="https://a.com")
        service._fetched["https://b.com"] = URLContent(url="https://b.com")

        result = service.clear_url_cache()
        assert result["status"] == "ok"
        assert result["cache_cleared"] == 3
        assert service._fetched == {}

    def test_no_cache_still_clears_fetched(self) -> None:
        service = URLService()
        service._fetched["https://a.com"] = URLContent(url="https://a.com")
        result = service.clear_url_cache()
        assert result["cache_cleared"] == 0
        assert service._fetched == {}


class TestRemoveFetched:
    """Remove from in-memory only; cache preserved."""

    def test_removes_from_memory_only(self, cache: URLCache) -> None:
        content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="body",
        )
        cache.set("https://example.com", content.to_dict())
        service = URLService(cache=cache)
        service._fetched["https://example.com"] = content

        result = service.remove_fetched("https://example.com")
        assert result["status"] == "ok"
        assert result["removed"] is True
        assert "https://example.com" not in service._fetched
        # Cache preserved.
        assert cache.get("https://example.com") is not None

    def test_unknown_url(self) -> None:
        service = URLService()
        result = service.remove_fetched("https://unknown.example.com")
        assert result["removed"] is False


class TestClearFetched:
    """Clear in-memory only; cache preserved."""

    def test_clears_only_memory(self, cache: URLCache) -> None:
        content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="body",
        )
        cache.set("https://example.com", content.to_dict())
        service = URLService(cache=cache)
        service._fetched["https://example.com"] = content
        service._fetched["https://other.com"] = URLContent(
            url="https://other.com"
        )

        result = service.clear_fetched()
        assert result["cleared"] == 2
        assert service._fetched == {}
        # Cache preserved.
        assert cache.get("https://example.com") is not None


# ---------------------------------------------------------------------------
# get_fetched_urls
# ---------------------------------------------------------------------------


class TestGetFetchedUrls:
    """In-memory URL list for UI chip rendering."""

    def test_empty_initially(self) -> None:
        service = URLService()
        assert service.get_fetched_urls() == []

    def test_returns_all_fetched(self) -> None:
        service = URLService()
        c1 = URLContent(url="https://a.com", url_type="generic")
        c2 = URLContent(url="https://b.com", url_type="generic")
        service._fetched["https://a.com"] = c1
        service._fetched["https://b.com"] = c2
        result = service.get_fetched_urls()
        assert result == [c1, c2]

    def test_returns_list_not_view(self) -> None:
        """Returned list is independent — caller mutations don't leak."""
        service = URLService()
        service._fetched["https://a.com"] = URLContent(url="a")
        result = service.get_fetched_urls()
        result.clear()
        # Internal dict unaffected.
        assert "https://a.com" in service._fetched


# ---------------------------------------------------------------------------
# format_url_context
# ---------------------------------------------------------------------------


class TestFormatUrlContext:
    """Prompt injection formatting."""

    def test_empty_when_no_urls(self) -> None:
        service = URLService()
        assert service.format_url_context() == ""

    def test_all_fetched_by_default(self) -> None:
        service = URLService()
        service._fetched["https://a.com"] = URLContent(
            url="https://a.com",
            url_type="generic",
            content="body A",
        )
        service._fetched["https://b.com"] = URLContent(
            url="https://b.com",
            url_type="generic",
            content="body B",
        )
        result = service.format_url_context()
        assert "## https://a.com" in result
        assert "## https://b.com" in result
        assert "body A" in result
        assert "body B" in result

    def test_separator_between_urls(self) -> None:
        service = URLService()
        service._fetched["https://a.com"] = URLContent(
            url="https://a.com",
            url_type="generic",
            content="A",
        )
        service._fetched["https://b.com"] = URLContent(
            url="https://b.com",
            url_type="generic",
            content="B",
        )
        result = service.format_url_context()
        assert "\n---\n" in result

    def test_explicit_urls_list(self) -> None:
        service = URLService()
        service._fetched["https://a.com"] = URLContent(
            url="https://a.com",
            url_type="generic",
            content="A",
        )
        service._fetched["https://b.com"] = URLContent(
            url="https://b.com",
            url_type="generic",
            content="B",
        )
        result = service.format_url_context(urls=["https://a.com"])
        assert "https://a.com" in result
        assert "https://b.com" not in result

    def test_excluded_urls_skipped(self) -> None:
        service = URLService()
        service._fetched["https://a.com"] = URLContent(
            url="https://a.com",
            url_type="generic",
            content="A",
        )
        service._fetched["https://b.com"] = URLContent(
            url="https://b.com",
            url_type="generic",
            content="B",
        )
        result = service.format_url_context(
            excluded={"https://b.com"}
        )
        assert "https://a.com" in result
        assert "https://b.com" not in result

    def test_error_records_skipped(self) -> None:
        service = URLService()
        service._fetched["https://a.com"] = URLContent(
            url="https://a.com",
            url_type="generic",
            content="A",
        )
        service._fetched["https://b.com"] = URLContent(
            url="https://b.com",
            url_type="generic",
            error="HTTP 500",
        )
        result = service.format_url_context()
        assert "https://a.com" in result
        assert "https://b.com" not in result

    def test_all_excluded_returns_empty(self) -> None:
        service = URLService()
        service._fetched["https://a.com"] = URLContent(
            url="https://a.com",
            url_type="generic",
            content="A",
        )
        result = service.format_url_context(
            excluded={"https://a.com"}
        )
        assert result == ""

    def test_falls_back_to_cache_for_explicit_url_not_in_memory(
        self, cache: URLCache
    ) -> None:
        """Explicit URL list with a cache-only URL still renders."""
        cached = URLContent(
            url="https://example.com",
            url_type="generic",
            content="from cache",
        )
        cache.set("https://example.com", cached.to_dict())
        service = URLService(cache=cache)

        result = service.format_url_context(
            urls=["https://example.com"]
        )
        assert "from cache" in result

    def test_max_length_passed_through(self) -> None:
        """Per-URL max_length is respected by URLContent.format_for_prompt."""
        service = URLService()
        long_body = "x" * 1000
        service._fetched["https://a.com"] = URLContent(
            url="https://a.com",
            url_type="generic",
            content=long_body,
        )
        result = service.format_url_context(max_length=100)
        # Truncation marker should be present.
        assert "truncated" in result