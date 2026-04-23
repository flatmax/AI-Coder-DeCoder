"""Tests for ac_dc.url_service.models and cache — Layer 4.1.2.

Scope:

- URLContent and GitHubInfo dataclasses — defaults, to_dict /
  from_dict round-trip, format_for_prompt with every body
  priority and truncation.
- URLCache — set / get round-trip, miss, expiry, corrupt
  entry handling, invalidate, clear, cleanup_expired,
  timestamp injection, error-record refusal.

Strategy:

- Dataclass tests are pure (no I/O).
- Cache tests use tmp_path for isolation. Small TTLs (fractional
  hours) used to exercise expiry without real wall-clock waits.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from ac_dc.url_service.cache import URLCache, url_hash
from ac_dc.url_service.models import GitHubInfo, URLContent


# ---------------------------------------------------------------------------
# GitHubInfo
# ---------------------------------------------------------------------------


class TestGitHubInfo:
    """GitHubInfo serialisation and defaults."""

    def test_defaults_all_empty(self) -> None:
        gh = GitHubInfo()
        assert gh.owner == ""
        assert gh.repo == ""
        assert gh.branch is None
        assert gh.path is None
        assert gh.issue_number is None
        assert gh.pr_number is None

    def test_roundtrip_full_repo_info(self) -> None:
        gh = GitHubInfo(owner="foo", repo="bar")
        restored = GitHubInfo.from_dict(gh.to_dict())
        assert restored == gh

    def test_roundtrip_file_info(self) -> None:
        gh = GitHubInfo(
            owner="foo", repo="bar",
            branch="main", path="src/app.py",
        )
        restored = GitHubInfo.from_dict(gh.to_dict())
        assert restored == gh

    def test_roundtrip_issue_info(self) -> None:
        gh = GitHubInfo(owner="foo", repo="bar", issue_number=42)
        restored = GitHubInfo.from_dict(gh.to_dict())
        assert restored.issue_number == 42

    def test_from_dict_ignores_unknown_keys(self) -> None:
        """Schema-permissive — future fields don't break old readers."""
        data = {
            "owner": "foo",
            "repo": "bar",
            "future_field": "some_value",
        }
        gh = GitHubInfo.from_dict(data)
        assert gh.owner == "foo"
        assert gh.repo == "bar"
        # No AttributeError from the unknown field.

    def test_from_dict_missing_fields_use_defaults(self) -> None:
        gh = GitHubInfo.from_dict({"owner": "foo"})
        assert gh.owner == "foo"
        assert gh.repo == ""
        assert gh.branch is None


# ---------------------------------------------------------------------------
# URLContent — basic shape and serialisation
# ---------------------------------------------------------------------------


class TestURLContent:
    """URLContent defaults, round-trip, nested github_info."""

    def test_defaults(self) -> None:
        c = URLContent()
        assert c.url == ""
        assert c.url_type == "generic"
        assert c.title is None
        assert c.content is None
        assert c.readme is None
        assert c.symbol_map is None
        assert c.github_info is None
        assert c.fetched_at is None
        assert c.error is None
        assert c.summary is None
        assert c.summary_type is None

    def test_roundtrip_minimal(self) -> None:
        c = URLContent(
            url="https://example.com",
            url_type="generic",
            content="page content",
        )
        restored = URLContent.from_dict(c.to_dict())
        assert restored == c

    def test_roundtrip_with_github_info(self) -> None:
        """Nested GitHubInfo survives round-trip as a real dataclass."""
        c = URLContent(
            url="https://github.com/foo/bar",
            url_type="github_repo",
            readme="# Bar\n\nProject description.",
            github_info=GitHubInfo(owner="foo", repo="bar"),
            fetched_at="2025-01-01T00:00:00Z",
        )
        restored = URLContent.from_dict(c.to_dict())
        assert restored.github_info == GitHubInfo(
            owner="foo", repo="bar",
        )
        assert restored == c

    def test_from_dict_strips_cached_at(self) -> None:
        """Cache-internal fields don't leak into the dataclass."""
        data = {
            "url": "https://example.com",
            "url_type": "generic",
            "content": "hi",
            "_cached_at": 1234567890,
        }
        c = URLContent.from_dict(data)
        assert c.url == "https://example.com"
        assert c.content == "hi"
        # The leading-underscore field is silently ignored.

    def test_from_dict_ignores_unknown_keys(self) -> None:
        """Forward-compatible — new fields from future versions ignored."""
        data = {
            "url": "https://example.com",
            "url_type": "generic",
            "future_field": "ignored",
        }
        c = URLContent.from_dict(data)
        assert c.url == "https://example.com"

    def test_from_dict_github_info_none_preserved(self) -> None:
        """None github_info round-trips correctly."""
        c = URLContent(url="https://example.com", github_info=None)
        restored = URLContent.from_dict(c.to_dict())
        assert restored.github_info is None


# ---------------------------------------------------------------------------
# URLContent.format_for_prompt
# ---------------------------------------------------------------------------


class TestFormatForPrompt:
    """Prompt-rendering logic — body priority, truncation, shape."""

    def test_empty_url_only_returns_header(self) -> None:
        c = URLContent(url="https://example.com")
        result = c.format_for_prompt()
        assert result == "## https://example.com"

    def test_title_rendered_when_present(self) -> None:
        c = URLContent(
            url="https://example.com",
            title="Example Domain",
        )
        result = c.format_for_prompt()
        assert "**Example Domain**" in result

    def test_body_prefers_summary_over_readme(self) -> None:
        """Summary is more token-efficient, wins over readme."""
        c = URLContent(
            url="https://github.com/foo/bar",
            summary="SUMMARY",
            readme="FULL README",
            content="raw",
        )
        result = c.format_for_prompt()
        assert "SUMMARY" in result
        assert "FULL README" not in result
        assert "raw" not in result

    def test_body_prefers_readme_over_content(self) -> None:
        c = URLContent(
            url="https://github.com/foo/bar",
            readme="README",
            content="CONTENT",
        )
        result = c.format_for_prompt()
        assert "README" in result
        assert "CONTENT" not in result

    def test_body_falls_back_to_content(self) -> None:
        c = URLContent(
            url="https://example.com",
            content="CONTENT",
        )
        result = c.format_for_prompt()
        assert "CONTENT" in result

    def test_truncation_applied_to_long_body(self) -> None:
        long_body = "A" * 100_000
        c = URLContent(url="https://example.com", content=long_body)
        result = c.format_for_prompt(max_length=50_000)
        assert "... (truncated)" in result
        assert len(result) < len(long_body)

    def test_no_truncation_under_limit(self) -> None:
        c = URLContent(url="https://example.com", content="short")
        result = c.format_for_prompt(max_length=50_000)
        assert "... (truncated)" not in result
        assert "short" in result

    def test_symbol_map_appended_when_present(self) -> None:
        c = URLContent(
            url="https://github.com/foo/bar",
            readme="README",
            symbol_map="module.py:\n  c Foo",
        )
        result = c.format_for_prompt()
        assert "### Symbol Map" in result
        assert "module.py" in result

    def test_symbol_map_not_rendered_when_missing(self) -> None:
        c = URLContent(
            url="https://github.com/foo/bar",
            readme="README",
        )
        result = c.format_for_prompt()
        assert "Symbol Map" not in result

    def test_error_record_returns_empty(self) -> None:
        """Failed fetches contribute nothing to the prompt."""
        c = URLContent(
            url="https://example.com",
            error="fetch failed",
        )
        assert c.format_for_prompt() == ""

    def test_parts_joined_with_blank_lines(self) -> None:
        c = URLContent(
            url="https://example.com",
            title="Title",
            content="body",
        )
        result = c.format_for_prompt()
        # URL, title, body all separated by blank lines.
        assert "\n\n" in result


# ---------------------------------------------------------------------------
# url_hash helper
# ---------------------------------------------------------------------------


class TestUrlHash:
    """url_hash() determinism and distinctness."""

    def test_deterministic(self) -> None:
        u = "https://example.com/foo"
        assert url_hash(u) == url_hash(u)

    def test_distinct_for_different_urls(self) -> None:
        assert url_hash("https://a.example.com") != url_hash(
            "https://b.example.com"
        )

    def test_fixed_length(self) -> None:
        h = url_hash("https://example.com")
        assert len(h) == 16
        # All hex chars.
        int(h, 16)


# ---------------------------------------------------------------------------
# URLCache — get/set round-trip
# ---------------------------------------------------------------------------


@pytest.fixture
def cache_dir(tmp_path: Path) -> Path:
    """Dedicated URL cache directory per test."""
    d = tmp_path / "url_cache"
    # Explicitly NOT creating — the cache should create on init.
    return d


class TestCacheConstruction:
    """Cache directory creation and basic properties."""

    def test_creates_directory_if_missing(self, cache_dir: Path) -> None:
        assert not cache_dir.exists()
        URLCache(cache_dir, ttl_hours=1)
        assert cache_dir.is_dir()

    def test_existing_directory_tolerated(
        self, cache_dir: Path,
    ) -> None:
        cache_dir.mkdir()
        cache = URLCache(cache_dir, ttl_hours=1)
        assert cache.directory == cache_dir

    def test_ttl_seconds_computed(self, cache_dir: Path) -> None:
        cache = URLCache(cache_dir, ttl_hours=2)
        assert cache.ttl_seconds == 7200.0

    def test_accepts_string_path(self, tmp_path: Path) -> None:
        d = tmp_path / "string_cache"
        URLCache(str(d), ttl_hours=1)
        assert d.is_dir()


class TestCacheGetSet:
    """Core cache operations."""

    def test_set_then_get_round_trip(self, cache_dir: Path) -> None:
        cache = URLCache(cache_dir, ttl_hours=1)
        content = {
            "url": "https://example.com",
            "url_type": "generic",
            "content": "hello",
        }
        assert cache.set("https://example.com", content) is True
        got = cache.get("https://example.com")
        assert got is not None
        assert got["url"] == "https://example.com"
        assert got["content"] == "hello"

    def test_get_miss_returns_none(self, cache_dir: Path) -> None:
        cache = URLCache(cache_dir, ttl_hours=1)
        assert cache.get("https://never-cached.com") is None

    def test_set_refuses_error_records(self, cache_dir: Path) -> None:
        """Error records never hit disk."""
        cache = URLCache(cache_dir, ttl_hours=1)
        content = {
            "url": "https://example.com",
            "error": "fetch failed",
        }
        assert cache.set("https://example.com", content) is False
        assert cache.get("https://example.com") is None

    def test_set_injects_cached_at(self, cache_dir: Path) -> None:
        """Cache adds _cached_at for TTL tracking."""
        cache = URLCache(cache_dir, ttl_hours=1)
        before = time.time()
        cache.set("https://example.com", {"url": "https://example.com"})
        got = cache.get("https://example.com")
        after = time.time()
        assert got is not None
        assert "_cached_at" in got
        assert before <= got["_cached_at"] <= after

    def test_set_injects_fetched_at_when_missing(
        self, cache_dir: Path,
    ) -> None:
        """Fetchers that forget fetched_at are rescued by the cache."""
        cache = URLCache(cache_dir, ttl_hours=1)
        cache.set("https://example.com", {"url": "https://example.com"})
        got = cache.get("https://example.com")
        assert got is not None
        assert got["fetched_at"] is not None
        assert got["fetched_at"].endswith("Z")

    def test_set_preserves_existing_fetched_at(
        self, cache_dir: Path,
    ) -> None:
        """Already-set fetched_at is not overwritten."""
        cache = URLCache(cache_dir, ttl_hours=1)
        cache.set("https://example.com", {
            "url": "https://example.com",
            "fetched_at": "2025-01-01T00:00:00Z",
        })
        got = cache.get("https://example.com")
        assert got is not None
        assert got["fetched_at"] == "2025-01-01T00:00:00Z"

    def test_set_overwrites_existing(self, cache_dir: Path) -> None:
        """Re-setting replaces the entry atomically."""
        cache = URLCache(cache_dir, ttl_hours=1)
        cache.set("https://example.com", {
            "url": "https://example.com",
            "content": "v1",
        })
        cache.set("https://example.com", {
            "url": "https://example.com",
            "content": "v2",
        })
        got = cache.get("https://example.com")
        assert got is not None
        assert got["content"] == "v2"

    def test_set_with_summary_overwrites(self, cache_dir: Path) -> None:
        """Summary-update path — same URL, new content with summary."""
        cache = URLCache(cache_dir, ttl_hours=1)
        cache.set("https://example.com", {
            "url": "https://example.com",
            "content": "body",
        })
        # Simulates the summarizer updating the cached entry.
        cache.set("https://example.com", {
            "url": "https://example.com",
            "content": "body",
            "summary": "A summary.",
            "summary_type": "BRIEF",
        })
        got = cache.get("https://example.com")
        assert got is not None
        assert got["summary"] == "A summary."
        assert got["summary_type"] == "BRIEF"

    def test_caller_dict_not_mutated(self, cache_dir: Path) -> None:
        """Set copies input; caller's dict stays untouched."""
        cache = URLCache(cache_dir, ttl_hours=1)
        caller = {"url": "https://example.com"}
        cache.set("https://example.com", caller)
        assert "_cached_at" not in caller
        assert "fetched_at" not in caller


class TestCacheExpiry:
    """TTL-based expiration."""

    def test_get_expired_returns_none(self, cache_dir: Path) -> None:
        """Expired entries disappear from get."""
        # 0.001 hours = 3.6 seconds, but we use a custom cached_at
        # so we don't need to wait.
        cache = URLCache(cache_dir, ttl_hours=1)
        cache.set("https://example.com", {"url": "https://example.com"})
        # Rewrite the file with a stale timestamp.
        path = cache_dir / f"{url_hash('https://example.com')}.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        data["_cached_at"] = time.time() - 7200  # 2 hours ago
        path.write_text(json.dumps(data), encoding="utf-8")
        # Now the entry is older than the 1-hour TTL.
        assert cache.get("https://example.com") is None

    def test_zero_ttl_expires_immediately(self, cache_dir: Path) -> None:
        """ttl_hours=0 effectively disables the cache."""
        cache = URLCache(cache_dir, ttl_hours=0)
        cache.set("https://example.com", {"url": "https://example.com"})
        # Age is ~0 but TTL is 0, so it's always expired.
        # ``age > ttl_seconds`` when both are 0.something ≈ 0
        # — our implementation uses strict ``>``, so technically
        # a fresh entry could still be visible for a microsecond.
        # That's acceptable and the test shouldn't depend on it.
        # What we CAN assert: aging the entry by any non-zero
        # amount makes it expire.
        path = cache_dir / f"{url_hash('https://example.com')}.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        data["_cached_at"] = time.time() - 1  # 1 second ago
        path.write_text(json.dumps(data), encoding="utf-8")
        assert cache.get("https://example.com") is None

    def test_expired_entry_not_auto_deleted(
        self, cache_dir: Path,
    ) -> None:
        """Expired entries stay on disk until cleanup_expired."""
        cache = URLCache(cache_dir, ttl_hours=1)
        cache.set("https://example.com", {"url": "https://example.com"})
        path = cache_dir / f"{url_hash('https://example.com')}.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        data["_cached_at"] = time.time() - 7200
        path.write_text(json.dumps(data), encoding="utf-8")
        # get() returns None but the file still exists.
        assert cache.get("https://example.com") is None
        assert path.is_file()


class TestCacheCorruption:
    """Corrupt entry handling."""

    def test_invalid_json_returns_none_and_deletes(
        self, cache_dir: Path,
    ) -> None:
        cache = URLCache(cache_dir, ttl_hours=1)
        path = cache_dir / f"{url_hash('https://x.com')}.json"
        path.write_text("not valid json {", encoding="utf-8")
        assert cache.get("https://x.com") is None
        # Delete on read.
        assert not path.exists()

    def test_non_dict_json_returns_none_and_deletes(
        self, cache_dir: Path,
    ) -> None:
        cache = URLCache(cache_dir, ttl_hours=1)
        path = cache_dir / f"{url_hash('https://x.com')}.json"
        path.write_text('["array", "not", "dict"]', encoding="utf-8")
        assert cache.get("https://x.com") is None
        assert not path.exists()

    def test_missing_cached_at_returns_none(
        self, cache_dir: Path,
    ) -> None:
        """Entry without timestamp treated as expired (not deleted)."""
        cache = URLCache(cache_dir, ttl_hours=1)
        path = cache_dir / f"{url_hash('https://x.com')}.json"
        path.write_text('{"url": "https://x.com"}', encoding="utf-8")
        assert cache.get("https://x.com") is None
        # No cached_at is different from corrupt — we don't
        # delete; cleanup_expired will handle it. See that
        # test below.

    def test_non_numeric_cached_at_returns_none(
        self, cache_dir: Path,
    ) -> None:
        cache = URLCache(cache_dir, ttl_hours=1)
        path = cache_dir / f"{url_hash('https://x.com')}.json"
        path.write_text(
            '{"_cached_at": "not a number"}', encoding="utf-8"
        )
        assert cache.get("https://x.com") is None


class TestCacheInvalidate:
    """Single-entry removal."""

    def test_invalidate_present_entry(self, cache_dir: Path) -> None:
        cache = URLCache(cache_dir, ttl_hours=1)
        cache.set("https://example.com", {"url": "https://example.com"})
        assert cache.invalidate("https://example.com") is True
        assert cache.get("https://example.com") is None

    def test_invalidate_missing_entry(self, cache_dir: Path) -> None:
        cache = URLCache(cache_dir, ttl_hours=1)
        assert cache.invalidate("https://never-cached.com") is False

    def test_invalidate_only_removes_target(
        self, cache_dir: Path,
    ) -> None:
        cache = URLCache(cache_dir, ttl_hours=1)
        cache.set("https://a.example.com", {"url": "https://a.example.com"})
        cache.set("https://b.example.com", {"url": "https://b.example.com"})
        cache.invalidate("https://a.example.com")
        assert cache.get("https://a.example.com") is None
        assert cache.get("https://b.example.com") is not None


class TestCacheClear:
    """Bulk removal."""

    def test_clear_empty_cache_returns_zero(
        self, cache_dir: Path,
    ) -> None:
        cache = URLCache(cache_dir, ttl_hours=1)
        assert cache.clear() == 0

    def test_clear_removes_all_entries(self, cache_dir: Path) -> None:
        cache = URLCache(cache_dir, ttl_hours=1)
        for i in range(3):
            cache.set(
                f"https://{i}.example.com",
                {"url": f"https://{i}.example.com"},
            )
        assert cache.clear() == 3
        assert cache.get("https://0.example.com") is None

    def test_clear_leaves_non_cache_files_alone(
        self, cache_dir: Path,
    ) -> None:
        """Foreign files in the cache directory are not deleted."""
        cache = URLCache(cache_dir, ttl_hours=1)
        cache.set("https://example.com", {"url": "https://example.com"})
        # Add a stray file that isn't a cache entry.
        stray = cache_dir / "README.txt"
        stray.write_text("hands off")
        cache.clear()
        assert stray.is_file()

    def test_clear_leaves_directory_intact(self, cache_dir: Path) -> None:
        cache = URLCache(cache_dir, ttl_hours=1)
        cache.set("https://example.com", {"url": "https://example.com"})
        cache.clear()
        assert cache_dir.is_dir()


class TestCacheCleanupExpired:
    """Periodic cleanup pass."""

    def test_cleanup_empty_cache(self, cache_dir: Path) -> None:
        cache = URLCache(cache_dir, ttl_hours=1)
        assert cache.cleanup_expired() == 0

    def test_cleanup_removes_expired_entries(
        self, cache_dir: Path,
    ) -> None:
        cache = URLCache(cache_dir, ttl_hours=1)
        # Fresh entry.
        cache.set("https://fresh.com", {"url": "https://fresh.com"})
        # Expired entry — manually age it.
        cache.set("https://stale.com", {"url": "https://stale.com"})
        stale_path = cache_dir / f"{url_hash('https://stale.com')}.json"
        data = json.loads(stale_path.read_text(encoding="utf-8"))
        data["_cached_at"] = time.time() - 7200  # 2 hours ago
        stale_path.write_text(json.dumps(data), encoding="utf-8")

        removed = cache.cleanup_expired()
        assert removed == 1
        assert cache.get("https://fresh.com") is not None
        assert not stale_path.exists()

    def test_cleanup_removes_corrupt_entries(
        self, cache_dir: Path,
    ) -> None:
        cache = URLCache(cache_dir, ttl_hours=1)
        corrupt = cache_dir / "abc1234567890def.json"
        corrupt.write_text("not json", encoding="utf-8")
        assert cache.cleanup_expired() == 1
        assert not corrupt.exists()

    def test_cleanup_removes_missing_timestamp(
        self, cache_dir: Path,
    ) -> None:
        """Entries without _cached_at are treated as stale."""
        cache = URLCache(cache_dir, ttl_hours=1)
        path = cache_dir / "abc1234567890def.json"
        path.write_text('{"url": "https://x.com"}', encoding="utf-8")
        assert cache.cleanup_expired() == 1
        assert not path.exists()

    def test_cleanup_leaves_non_cache_files_alone(
        self, cache_dir: Path,
    ) -> None:
        cache = URLCache(cache_dir, ttl_hours=1)
        stray = cache_dir / "README.md"
        stray.write_text("hands off")
        cache.cleanup_expired()
        assert stray.is_file()