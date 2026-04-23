"""Tests for ac_dc.url_service.detection — Layer 4.1.1.

Scope:

- URL detection via regex — simple case, multiple URLs per text,
  dedupe, trailing-punctuation trim.
- Classification — GitHub shapes (repo / file / issue / PR), raw
  content URLs, documentation domains and path markers, generic
  fallback.
- Display names — every GitHub shape plus generic truncation.

Strategy: pure functions, no I/O, no mocks. Each test feeds a
known input and asserts on the structural output.
"""

from __future__ import annotations

from ac_dc.url_service.detection import (
    URLType,
    classify_url,
    detect_urls,
    display_name,
)


# ---------------------------------------------------------------------------
# detect_urls
# ---------------------------------------------------------------------------


class TestDetectUrls:
    """Regex-based URL finding with dedupe and trimming."""

    def test_empty_text_returns_empty(self) -> None:
        assert detect_urls("") == []

    def test_no_urls_returns_empty(self) -> None:
        assert detect_urls("just prose with no links") == []

    def test_single_url(self) -> None:
        assert detect_urls("see https://example.com") == [
            "https://example.com"
        ]

    def test_http_scheme_also_detected(self) -> None:
        assert detect_urls("http://example.com/foo") == [
            "http://example.com/foo"
        ]

    def test_multiple_urls_preserved_in_order(self) -> None:
        text = (
            "First https://one.example.com then "
            "https://two.example.com and finally "
            "https://three.example.com"
        )
        assert detect_urls(text) == [
            "https://one.example.com",
            "https://two.example.com",
            "https://three.example.com",
        ]

    def test_duplicates_deduped_first_seen_wins(self) -> None:
        text = (
            "check https://example.com and again "
            "https://example.com twice"
        )
        assert detect_urls(text) == ["https://example.com"]

    def test_trailing_period_stripped(self) -> None:
        """URL at end of sentence — period is prose, not URL."""
        assert detect_urls("visit https://example.com.") == [
            "https://example.com"
        ]

    def test_trailing_comma_stripped(self) -> None:
        assert detect_urls("https://a.example.com, https://b.example.com") == [
            "https://a.example.com",
            "https://b.example.com",
        ]

    def test_trailing_parenthesis_stripped(self) -> None:
        """Parenthesised URL — the closing paren isn't part of the URL."""
        assert detect_urls("(see https://example.com)") == [
            "https://example.com"
        ]

    def test_trailing_semicolon_stripped(self) -> None:
        assert detect_urls("https://example.com; more") == [
            "https://example.com"
        ]

    def test_url_with_query_string(self) -> None:
        """Query strings are part of the URL, not trimmed."""
        assert detect_urls("https://example.com/search?q=foo") == [
            "https://example.com/search?q=foo"
        ]

    def test_url_with_fragment(self) -> None:
        assert detect_urls("https://example.com#section") == [
            "https://example.com#section"
        ]

    def test_url_inside_brackets(self) -> None:
        """Markdown-style `[text](url)` — regex excludes brackets."""
        text = "see [docs](https://example.com/docs)"
        assert detect_urls(text) == ["https://example.com/docs"]

    def test_url_with_internal_punctuation(self) -> None:
        """Internal dots/dashes in path are kept."""
        assert detect_urls("https://example.com/a.b-c_d/e") == [
            "https://example.com/a.b-c_d/e"
        ]

    def test_ftp_not_detected(self) -> None:
        """Non-HTTP schemes ignored."""
        assert detect_urls("ftp://example.com/file") == []

    def test_file_scheme_not_detected(self) -> None:
        assert detect_urls("file:///etc/passwd") == []

    def test_url_in_angle_brackets(self) -> None:
        """Angle-bracket-wrapped URLs — delimiter is prose."""
        assert detect_urls("<https://example.com>") == [
            "https://example.com"
        ]


# ---------------------------------------------------------------------------
# classify_url
# ---------------------------------------------------------------------------


class TestClassifyUrl:
    """URL → URLType dispatch."""

    # GitHub repo shapes.
    def test_github_repo_basic(self) -> None:
        assert classify_url("https://github.com/owner/repo") == (
            URLType.GITHUB_REPO
        )

    def test_github_repo_trailing_slash(self) -> None:
        assert classify_url("https://github.com/owner/repo/") == (
            URLType.GITHUB_REPO
        )

    def test_github_repo_dot_git(self) -> None:
        assert classify_url("https://github.com/owner/repo.git") == (
            URLType.GITHUB_REPO
        )

    def test_github_repo_with_www(self) -> None:
        """``www.github.com`` is not matched — hosts are exact."""
        # urlparse preserves the www; we only accept bare github.com.
        assert classify_url(
            "https://www.github.com/owner/repo"
        ) == URLType.GENERIC

    # GitHub file shapes.
    def test_github_file_blob(self) -> None:
        assert classify_url(
            "https://github.com/owner/repo/blob/main/src/app.py"
        ) == URLType.GITHUB_FILE

    def test_github_file_branch_with_dash(self) -> None:
        assert classify_url(
            "https://github.com/owner/repo/blob/feat-branch/file.md"
        ) == URLType.GITHUB_FILE

    def test_github_file_deep_path(self) -> None:
        assert classify_url(
            "https://github.com/owner/repo/blob/main/a/b/c/d.py"
        ) == URLType.GITHUB_FILE

    def test_raw_githubusercontent_file(self) -> None:
        """Raw content host → GitHub file type."""
        assert classify_url(
            "https://raw.githubusercontent.com/owner/repo/main/file.py"
        ) == URLType.GITHUB_FILE

    # GitHub issue shapes.
    def test_github_issue(self) -> None:
        assert classify_url(
            "https://github.com/owner/repo/issues/42"
        ) == URLType.GITHUB_ISSUE

    def test_github_issue_trailing_slash(self) -> None:
        assert classify_url(
            "https://github.com/owner/repo/issues/42/"
        ) == URLType.GITHUB_ISSUE

    # GitHub PR shapes.
    def test_github_pr(self) -> None:
        assert classify_url(
            "https://github.com/owner/repo/pull/99"
        ) == URLType.GITHUB_PR

    # GitHub weird / unclassified paths fall to generic.
    def test_github_actions_page_is_generic(self) -> None:
        assert classify_url(
            "https://github.com/owner/repo/actions"
        ) == URLType.GENERIC

    def test_github_settings_page_is_generic(self) -> None:
        assert classify_url(
            "https://github.com/settings/profile"
        ) == URLType.GENERIC

    # Documentation domains.
    def test_python_docs_is_documentation(self) -> None:
        assert classify_url(
            "https://docs.python.org/3/library/functools.html"
        ) == URLType.DOCUMENTATION

    def test_mdn_is_documentation(self) -> None:
        assert classify_url(
            "https://developer.mozilla.org/en-US/docs/Web/CSS"
        ) == URLType.DOCUMENTATION

    def test_readthedocs_subdomain(self) -> None:
        assert classify_url(
            "https://somelib.readthedocs.io/en/stable/"
        ) == URLType.DOCUMENTATION

    def test_readthedocs_org_subdomain(self) -> None:
        assert classify_url(
            "https://other.readthedocs.org/page"
        ) == URLType.DOCUMENTATION

    # Path markers.
    def test_docs_path_marker(self) -> None:
        assert classify_url(
            "https://example.com/docs/api.html"
        ) == URLType.DOCUMENTATION

    def test_documentation_path_marker(self) -> None:
        assert classify_url(
            "https://example.com/documentation/quickstart"
        ) == URLType.DOCUMENTATION

    def test_api_path_marker(self) -> None:
        assert classify_url(
            "https://example.com/api/v2/users"
        ) == URLType.DOCUMENTATION

    def test_reference_path_marker(self) -> None:
        assert classify_url(
            "https://example.com/reference/standard-library"
        ) == URLType.DOCUMENTATION

    # Generic.
    def test_arbitrary_website_is_generic(self) -> None:
        assert classify_url(
            "https://example.com/about"
        ) == URLType.GENERIC

    def test_malformed_url_is_generic(self) -> None:
        """urlparse failure falls through to generic."""
        # urlparse is very permissive — this is a contrived test to
        # prove the defensive path exists.
        assert classify_url("https://") == URLType.GENERIC


# ---------------------------------------------------------------------------
# display_name
# ---------------------------------------------------------------------------


class TestDisplayName:
    """Compact display names for UI chips."""

    def test_github_repo_owner_slash_repo(self) -> None:
        assert display_name(
            "https://github.com/owner/repo"
        ) == "owner/repo"

    def test_github_repo_dot_git_stripped(self) -> None:
        assert display_name(
            "https://github.com/owner/repo.git"
        ) == "owner/repo"

    def test_github_repo_trailing_slash_tolerated(self) -> None:
        assert display_name(
            "https://github.com/owner/repo/"
        ) == "owner/repo"

    def test_github_file_shows_owner_repo_filename(self) -> None:
        assert display_name(
            "https://github.com/owner/repo/blob/main/src/app.py"
        ) == "owner/repo/app.py"

    def test_github_file_deep_path_shows_tail_only(self) -> None:
        assert display_name(
            "https://github.com/owner/repo/blob/main/a/b/c/file.md"
        ) == "owner/repo/file.md"

    def test_github_issue_owner_repo_hash_number(self) -> None:
        assert display_name(
            "https://github.com/owner/repo/issues/42"
        ) == "owner/repo#42"

    def test_github_pr_owner_repo_bang_number(self) -> None:
        assert display_name(
            "https://github.com/owner/repo/pull/99"
        ) == "owner/repo!99"

    def test_generic_url_host_path(self) -> None:
        assert display_name(
            "https://example.com/about"
        ) == "example.com/about"

    def test_generic_url_root_path_omits_slash(self) -> None:
        assert display_name("https://example.com/") == "example.com"

    def test_generic_url_no_path(self) -> None:
        assert display_name("https://example.com") == "example.com"

    def test_documentation_url_host_path(self) -> None:
        assert display_name(
            "https://docs.python.org/3/library/functools.html"
        ) == "docs.python.org/3/library/functools.ht..."

    def test_long_generic_url_truncated(self) -> None:
        url = "https://example.com/" + "a" * 100
        result = display_name(url)
        assert len(result) <= 40
        assert result.endswith("...")

    def test_pre_classified_type_respected(self) -> None:
        """Caller's pre-classification avoids re-parsing."""
        assert display_name(
            "https://github.com/owner/repo",
            url_type=URLType.GITHUB_REPO,
        ) == "owner/repo"

    def test_raw_githubusercontent_falls_through_to_generic(self) -> None:
        """Raw URLs classify as file but display as host/path."""
        # Raw host doesn't match the GH_FILE_RE (which requires
        # github.com), so display falls through to host/path.
        result = display_name(
            "https://raw.githubusercontent.com/owner/repo/main/file.py"
        )
        assert "raw.githubusercontent.com" in result