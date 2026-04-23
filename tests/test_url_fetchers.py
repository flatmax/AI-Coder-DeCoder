"""Tests for ac_dc.url_service.fetchers — Layer 4.1.3.

Scope:

- Web page fetcher — title extraction, content extraction via
  trafilatura (with stdlib fallback), HTTP error handling,
  timeout handling.
- GitHub file fetcher — raw URL construction, main→master
  fallback for implicit default branch, error records for
  404s with explicit branches.
- GitHub repo fetcher — SSH-first clone with HTTPS fallback
  (D13), README discovery (exact + case-insensitive), symbol
  map generation via injected stub, temp directory cleanup.

Strategy:

- Mock :func:`urllib.request.urlopen` and
  :func:`subprocess.run` to avoid real network or git calls.
- Use ``_FakeSymbolIndex`` stub to prove the injection
  pattern without pulling in the real symbol index class.
- Real ``tempfile.mkdtemp`` — the directory gets cleaned up
  by the fetcher's ``finally`` block; we just verify the
  cleanup happened.
"""

from __future__ import annotations

import subprocess
import urllib.error
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from ac_dc.url_service.fetchers import (
    _extract_title,
    _find_readme,
    _generate_symbol_map,
    _https_clone_attempt,
    _ssh_clone_attempt,
    _strip_html_tags,
    fetch_github_file,
    fetch_github_repo,
    fetch_web_page,
)
from ac_dc.url_service.models import GitHubInfo


# ---------------------------------------------------------------------------
# Title extraction
# ---------------------------------------------------------------------------


class TestExtractTitle:
    """Stdlib title regex handles the cases trafilatura misses."""

    def test_simple_title(self) -> None:
        html = "<html><head><title>Hello</title></head></html>"
        assert _extract_title(html) == "Hello"

    def test_title_with_attributes(self) -> None:
        html = '<title lang="en">Hello</title>'
        assert _extract_title(html) == "Hello"

    def test_multiline_title_collapsed(self) -> None:
        html = "<title>\n  Multi\n  Line\n</title>"
        assert _extract_title(html) == "Multi Line"

    def test_no_title_returns_none(self) -> None:
        assert _extract_title("<html><body>no title</body></html>") is None

    def test_empty_title_returns_none(self) -> None:
        assert _extract_title("<title></title>") is None

    def test_whitespace_only_title_returns_none(self) -> None:
        assert _extract_title("<title>   </title>") is None

    def test_case_insensitive(self) -> None:
        assert _extract_title("<TITLE>Hello</TITLE>") == "Hello"


# ---------------------------------------------------------------------------
# HTML tag stripping (stdlib fallback)
# ---------------------------------------------------------------------------


class TestStripHtmlTags:
    """Fallback used when trafilatura isn't available or returns nothing."""

    def test_strips_tags(self) -> None:
        assert _strip_html_tags("<p>Hello <b>world</b></p>") == (
            "Hello world"
        )

    def test_strips_scripts(self) -> None:
        html = "<p>Before</p><script>evil()</script><p>After</p>"
        result = _strip_html_tags(html)
        assert "evil" not in result
        assert "Before" in result
        assert "After" in result

    def test_strips_styles(self) -> None:
        html = "<p>Text</p><style>body { color: red; }</style>"
        result = _strip_html_tags(html)
        assert "color" not in result

    def test_decodes_entities(self) -> None:
        assert _strip_html_tags("<p>&amp; &lt; &gt;</p>") == "& < >"

    def test_collapses_whitespace(self) -> None:
        html = "<p>  many\n\n  spaces  </p>"
        assert _strip_html_tags(html) == "many spaces"


# ---------------------------------------------------------------------------
# Web page fetcher
# ---------------------------------------------------------------------------


class TestFetchWebPage:
    """High-level fetcher behaviour. HTTP mocked."""

    def _mock_response(self, body: bytes):
        """Build a mock urlopen context manager returning body."""
        response = MagicMock()
        response.read.return_value = body
        response.__enter__ = MagicMock(return_value=response)
        response.__exit__ = MagicMock(return_value=None)
        return response

    def test_successful_fetch(self) -> None:
        html = (
            b"<html><head><title>Page Title</title></head>"
            b"<body><p>Main content here</p></body></html>"
        )
        with patch(
            "ac_dc.url_service.fetchers.urllib.request.urlopen",
            return_value=self._mock_response(html),
        ):
            result = fetch_web_page("https://example.com")
        assert result.error is None
        assert result.title == "Page Title"
        assert result.content is not None
        assert "Main content" in result.content
        assert result.url == "https://example.com"
        assert result.url_type == "generic"
        assert result.fetched_at is not None

    def test_http_error_returns_error_record(self) -> None:
        http_err = urllib.error.HTTPError(
            url="https://example.com",
            code=404,
            msg="Not Found",
            hdrs=None,
            fp=None,
        )
        with patch(
            "ac_dc.url_service.fetchers.urllib.request.urlopen",
            side_effect=http_err,
        ):
            result = fetch_web_page("https://example.com")
        assert result.error is not None
        assert "404" in result.error
        assert result.content is None

    def test_url_error_returns_error_record(self) -> None:
        with patch(
            "ac_dc.url_service.fetchers.urllib.request.urlopen",
            side_effect=urllib.error.URLError("connection refused"),
        ):
            result = fetch_web_page("https://example.com")
        assert result.error is not None
        assert "URL error" in result.error

    def test_generic_exception_returns_error_record(self) -> None:
        with patch(
            "ac_dc.url_service.fetchers.urllib.request.urlopen",
            side_effect=RuntimeError("boom"),
        ):
            result = fetch_web_page("https://example.com")
        assert result.error is not None
        assert "boom" in result.error

    def test_latin1_fallback_on_invalid_utf8(self) -> None:
        """Invalid UTF-8 bytes decode as latin-1 rather than raise."""
        # 0xFF isn't valid UTF-8 start byte.
        body = b"<html><title>OK</title><body>\xff byte</body></html>"
        with patch(
            "ac_dc.url_service.fetchers.urllib.request.urlopen",
            return_value=self._mock_response(body),
        ):
            result = fetch_web_page("https://example.com")
        assert result.error is None
        assert result.title == "OK"


# ---------------------------------------------------------------------------
# GitHub file fetcher
# ---------------------------------------------------------------------------


class TestFetchGitHubFile:
    """Raw URL construction + branch fallback."""

    def _mock_response(self, body: str):
        response = MagicMock()
        response.read.return_value = body.encode("utf-8")
        response.__enter__ = MagicMock(return_value=response)
        response.__exit__ = MagicMock(return_value=None)
        return response

    def test_successful_fetch(self) -> None:
        info = GitHubInfo(
            owner="octo", repo="hello",
            branch="main", path="README.md",
        )
        with patch(
            "ac_dc.url_service.fetchers.urllib.request.urlopen",
            return_value=self._mock_response("# Hello\n"),
        ) as mock_open:
            result = fetch_github_file(
                "https://github.com/octo/hello/blob/main/README.md",
                info,
            )
        assert result.error is None
        assert result.content == "# Hello\n"
        assert result.title == "README.md"
        # Verify we hit the raw URL.
        call_args = mock_open.call_args[0][0]
        assert "raw.githubusercontent.com" in call_args.full_url
        assert "octo/hello/main/README.md" in call_args.full_url

    def test_no_path_returns_error(self) -> None:
        info = GitHubInfo(owner="octo", repo="hello")
        result = fetch_github_file("https://github.com/octo/hello", info)
        assert result.error is not None
        assert "No file path" in result.error

    def test_implicit_main_falls_back_to_master(self) -> None:
        """When info.branch is None, 404 on main retries master."""
        info = GitHubInfo(
            owner="octo", repo="hello",
            branch=None,  # implicit default
            path="README.md",
        )
        # First call (main) raises 404, second (master) succeeds.
        http_404 = urllib.error.HTTPError(
            url="https://raw.githubusercontent.com/...",
            code=404, msg="Not Found",
            hdrs=None, fp=None,
        )
        success = self._mock_response("master content")
        with patch(
            "ac_dc.url_service.fetchers.urllib.request.urlopen",
            side_effect=[http_404, success],
        ) as mock_open:
            result = fetch_github_file(
                "https://github.com/octo/hello/blob/main/README.md",
                info,
            )
        assert result.error is None
        assert result.content == "master content"
        # Two calls — first main, then master.
        assert mock_open.call_count == 2
        second_url = mock_open.call_args_list[1][0][0].full_url
        assert "/master/" in second_url

    def test_explicit_branch_does_not_fall_back(self) -> None:
        """Explicit branch name — 404 surfaces, no retry."""
        info = GitHubInfo(
            owner="octo", repo="hello",
            branch="feature-x",  # explicit
            path="README.md",
        )
        http_404 = urllib.error.HTTPError(
            url="x", code=404, msg="Not Found",
            hdrs=None, fp=None,
        )
        with patch(
            "ac_dc.url_service.fetchers.urllib.request.urlopen",
            side_effect=http_404,
        ) as mock_open:
            result = fetch_github_file(
                "https://github.com/octo/hello/blob/feature-x/README.md",
                info,
            )
        assert result.error is not None
        assert "404" in result.error
        # Only one call — no master fallback.
        assert mock_open.call_count == 1


# ---------------------------------------------------------------------------
# Clone attempt helpers
# ---------------------------------------------------------------------------


class TestCloneAttempts:
    """SSH and HTTPS attempt parameter construction."""

    def test_ssh_attempt_url(self) -> None:
        info = GitHubInfo(owner="octo", repo="hello")
        attempt = _ssh_clone_attempt(info)
        assert attempt.url == "git@github.com:octo/hello.git"

    def test_ssh_attempt_batch_mode(self) -> None:
        """BatchMode=yes fails fast rather than prompting."""
        info = GitHubInfo(owner="octo", repo="hello")
        attempt = _ssh_clone_attempt(info)
        assert "BatchMode=yes" in attempt.env["GIT_SSH_COMMAND"]
        assert "accept-new" in attempt.env["GIT_SSH_COMMAND"]
        assert attempt.env["GIT_TERMINAL_PROMPT"] == "0"

    def test_https_attempt_url(self) -> None:
        info = GitHubInfo(owner="octo", repo="hello")
        attempt = _https_clone_attempt(info)
        assert attempt.url == "https://github.com/octo/hello.git"

    def test_https_attempt_disables_all_auth(self) -> None:
        """Every credential source explicitly disabled."""
        info = GitHubInfo(owner="octo", repo="hello")
        attempt = _https_clone_attempt(info)
        assert attempt.env["GIT_TERMINAL_PROMPT"] == "0"
        assert attempt.env["GIT_ASKPASS"] == "/bin/true"
        assert attempt.env["SSH_ASKPASS"] == "/bin/true"
        assert attempt.env["GIT_CONFIG_GLOBAL"] == "/dev/null"
        assert attempt.env["GIT_CONFIG_SYSTEM"] == "/dev/null"


# ---------------------------------------------------------------------------
# README discovery
# ---------------------------------------------------------------------------


class TestFindReadme:
    """Two-pass README search."""

    def test_exact_match_readme_md(self, tmp_path: Path) -> None:
        (tmp_path / "README.md").write_text("# Hello\n")
        result = _find_readme(tmp_path)
        assert result is not None
        assert result[0] == "README.md"
        assert result[1] == "# Hello\n"

    def test_priority_order_prefers_md(self, tmp_path: Path) -> None:
        """README.md wins over README.rst when both present."""
        (tmp_path / "README.md").write_text("md content")
        (tmp_path / "README.rst").write_text("rst content")
        result = _find_readme(tmp_path)
        assert result is not None
        assert result[0] == "README.md"

    def test_rst_fallback(self, tmp_path: Path) -> None:
        (tmp_path / "README.rst").write_text("rst content")
        result = _find_readme(tmp_path)
        assert result is not None
        assert result[0] == "README.rst"

    def test_no_extension_readme(self, tmp_path: Path) -> None:
        (tmp_path / "README").write_text("plain content")
        result = _find_readme(tmp_path)
        assert result is not None
        assert result[0] == "README"

    def test_case_insensitive_fallback(self, tmp_path: Path) -> None:
        """README.MD not in explicit list — found via pass 2."""
        (tmp_path / "README.MD").write_text("all caps ext")
        result = _find_readme(tmp_path)
        assert result is not None
        assert result[1] == "all caps ext"

    def test_no_readme_returns_none(self, tmp_path: Path) -> None:
        (tmp_path / "something_else.txt").write_text("not a readme")
        assert _find_readme(tmp_path) is None

    def test_empty_directory(self, tmp_path: Path) -> None:
        assert _find_readme(tmp_path) is None


# ---------------------------------------------------------------------------
# Symbol map generation
# ---------------------------------------------------------------------------


class _FakeSymbolIndex:
    """Stub matching the SymbolIndex class shape for fetcher use.

    The fetcher calls:
        index = symbol_index_cls(repo_root=...)
        index.index_repo(files)
        index.get_symbol_map()

    The stub records these calls for verification.
    """

    def __init__(self, repo_root: Path) -> None:
        self.repo_root = repo_root
        self.indexed_files: list[str] | None = None

    def index_repo(self, files: list[str]) -> None:
        self.indexed_files = list(files)

    def get_symbol_map(self) -> str:
        return f"fake map for {self.repo_root.name}"


class _FailingSymbolIndex:
    """Raises on construction — proves error-path resilience."""

    def __init__(self, repo_root: Path) -> None:
        raise RuntimeError("index construction failed")


class TestGenerateSymbolMap:
    """Injected symbol-index class integration."""

    def test_successful_generation(self, tmp_path: Path) -> None:
        (tmp_path / "file.py").write_text("x = 1\n")
        result = _generate_symbol_map(tmp_path, _FakeSymbolIndex)
        assert result is not None
        assert "fake map" in result

    def test_walks_files_skipping_git(self, tmp_path: Path) -> None:
        """``.git`` directory excluded from file list."""
        (tmp_path / "code.py").write_text("x = 1\n")
        git_dir = tmp_path / ".git"
        git_dir.mkdir()
        (git_dir / "HEAD").write_text("ref: refs/heads/main")

        # Capture the file list by spying on the stub.
        captured: list[str] = []

        class Spy:
            def __init__(self, repo_root: Path) -> None:
                pass

            def index_repo(self, files: list[str]) -> None:
                captured.extend(files)

            def get_symbol_map(self) -> str:
                return "ok"

        _generate_symbol_map(tmp_path, Spy)
        # code.py should be present, .git/HEAD absent.
        assert "code.py" in captured
        assert not any(".git" in f for f in captured)

    def test_construction_failure_returns_none(self, tmp_path: Path) -> None:
        result = _generate_symbol_map(tmp_path, _FailingSymbolIndex)
        assert result is None

    def test_indexing_failure_returns_none(self, tmp_path: Path) -> None:
        class ThrowingIndex:
            def __init__(self, repo_root: Path) -> None:
                pass

            def index_repo(self, files: list[str]) -> None:
                raise RuntimeError("indexing failed")

            def get_symbol_map(self) -> str:
                return "never reached"

        result = _generate_symbol_map(tmp_path, ThrowingIndex)
        assert result is None


# ---------------------------------------------------------------------------
# GitHub repo fetcher — full flow with mocked subprocess
# ---------------------------------------------------------------------------


class TestFetchGitHubRepo:
    """End-to-end repo fetch with SSH/HTTPS fallback (D13)."""

    def _mock_successful_clone(self, readme_content: str = "# Hello\n"):
        """Build a subprocess.run mock that simulates successful clone.

        The mock writes a README to the target directory that the
        clone command would have received as its second-to-last
        argument.
        """
        def side_effect(args, **kwargs) -> subprocess.CompletedProcess:
            # args[-2] is the URL, args[-1] is target dir.
            target = Path(args[-1])
            target.mkdir(parents=True, exist_ok=True)
            (target / "README.md").write_text(readme_content)
            return subprocess.CompletedProcess(
                args=args, returncode=0, stdout=b"", stderr=b"",
            )
        return side_effect

    def test_ssh_success_on_first_attempt(self) -> None:
        """D13 first-attempt-success path."""
        info = GitHubInfo(owner="octo", repo="hello")
        with patch(
            "ac_dc.url_service.fetchers.subprocess.run",
            side_effect=self._mock_successful_clone("# SSH success\n"),
        ) as mock_run:
            result = fetch_github_repo(
                "https://github.com/octo/hello", info,
            )
        assert result.error is None
        assert result.readme == "# SSH success\n"
        assert result.title == "octo/hello"
        assert result.github_info == info
        # Exactly one clone call — SSH worked, no fallback.
        assert mock_run.call_count == 1
        # First arg is the command list; the URL is at index 4
        # (after "git", "clone", "--depth", "1", "--quiet").
        clone_url = mock_run.call_args[0][0][5]
        assert clone_url == "git@github.com:octo/hello.git"

    def test_ssh_failure_https_success(self) -> None:
        """D13 fallback path — SSH fails, HTTPS succeeds."""
        info = GitHubInfo(owner="octo", repo="hello")
        call_count = [0]

        def side_effect(args, **kwargs):
            call_count[0] += 1
            if call_count[0] == 1:
                # First call (SSH) fails.
                return subprocess.CompletedProcess(
                    args=args, returncode=128,
                    stdout=b"", stderr=b"Permission denied",
                )
            # Second call (HTTPS) succeeds.
            target = Path(args[-1])
            target.mkdir(parents=True, exist_ok=True)
            (target / "README.md").write_text("# HTTPS success\n")
            return subprocess.CompletedProcess(
                args=args, returncode=0, stdout=b"", stderr=b"",
            )

        with patch(
            "ac_dc.url_service.fetchers.subprocess.run",
            side_effect=side_effect,
        ) as mock_run:
            result = fetch_github_repo(
                "https://github.com/octo/hello", info,
            )
        assert result.error is None
        assert result.readme == "# HTTPS success\n"
        # Two clone calls.
        assert mock_run.call_count == 2
        # Second call used HTTPS URL.
        second_url = mock_run.call_args_list[1][0][0][5]
        assert second_url == "https://github.com/octo/hello.git"

    def test_both_attempts_fail_returns_error(self) -> None:
        """D13 combined-failure case."""
        info = GitHubInfo(owner="octo", repo="private")
        with patch(
            "ac_dc.url_service.fetchers.subprocess.run",
            return_value=subprocess.CompletedProcess(
                args=[], returncode=128,
                stdout=b"", stderr=b"Repository not found",
            ),
        ) as mock_run:
            result = fetch_github_repo(
                "https://github.com/octo/private", info,
            )
        assert result.error is not None
        # User-facing message per D13.
        assert "private" in result.error.lower() or "access" in result.error.lower()
        # Both attempts made.
        assert mock_run.call_count == 2

    def test_timeout_treated_as_failure(self) -> None:
        """Clone timeout doesn't crash the fetcher."""
        info = GitHubInfo(owner="octo", repo="hello")
        with patch(
            "ac_dc.url_service.fetchers.subprocess.run",
            side_effect=subprocess.TimeoutExpired(cmd="git", timeout=120),
        ):
            result = fetch_github_repo(
                "https://github.com/octo/hello", info,
            )
        assert result.error is not None

    def test_git_binary_missing(self) -> None:
        info = GitHubInfo(owner="octo", repo="hello")
        with patch(
            "ac_dc.url_service.fetchers.subprocess.run",
            side_effect=FileNotFoundError("git not found"),
        ):
            result = fetch_github_repo(
                "https://github.com/octo/hello", info,
            )
        assert result.error is not None

    def test_missing_owner_returns_error(self) -> None:
        info = GitHubInfo(owner="", repo="hello")
        result = fetch_github_repo("https://github.com/", info)
        assert result.error is not None
        assert "owner" in result.error.lower() or "repo" in result.error.lower()

    def test_no_readme_returns_content_without_readme(self) -> None:
        """Clone succeeds but repo has no README — readme field is None."""
        info = GitHubInfo(owner="octo", repo="hello")

        def side_effect(args, **kwargs):
            target = Path(args[-1])
            target.mkdir(parents=True, exist_ok=True)
            # No README file written.
            (target / "code.py").write_text("x = 1")
            return subprocess.CompletedProcess(
                args=args, returncode=0, stdout=b"", stderr=b"",
            )

        with patch(
            "ac_dc.url_service.fetchers.subprocess.run",
            side_effect=side_effect,
        ):
            result = fetch_github_repo(
                "https://github.com/octo/hello", info,
            )
        assert result.error is None
        assert result.readme is None
        assert result.title == "octo/hello"

    def test_symbol_map_generation(self) -> None:
        """Injected class produces the symbol map."""
        info = GitHubInfo(owner="octo", repo="hello")

        def side_effect(args, **kwargs):
            target = Path(args[-1])
            target.mkdir(parents=True, exist_ok=True)
            (target / "README.md").write_text("# Hi")
            (target / "app.py").write_text("def foo(): pass")
            return subprocess.CompletedProcess(
                args=args, returncode=0, stdout=b"", stderr=b"",
            )

        with patch(
            "ac_dc.url_service.fetchers.subprocess.run",
            side_effect=side_effect,
        ):
            result = fetch_github_repo(
                "https://github.com/octo/hello",
                info,
                symbol_index_cls=_FakeSymbolIndex,
            )
        assert result.symbol_map is not None
        assert "fake map" in result.symbol_map

    def test_no_symbol_index_cls_omits_map(self) -> None:
        """Without an injected class, symbol_map stays None."""
        info = GitHubInfo(owner="octo", repo="hello")
        with patch(
            "ac_dc.url_service.fetchers.subprocess.run",
            side_effect=self._mock_successful_clone(),
        ):
            result = fetch_github_repo(
                "https://github.com/octo/hello",
                info,
                symbol_index_cls=None,
            )
        assert result.symbol_map is None

    def test_temp_directory_cleaned_up(self, tmp_path: Path) -> None:
        """Successful clone — temp dir removed in finally block."""
        info = GitHubInfo(owner="octo", repo="hello")
        captured_dirs: list[Path] = []

        def side_effect(args, **kwargs):
            target = Path(args[-1])
            # Parent of target is the temp dir.
            captured_dirs.append(target.parent)
            target.mkdir(parents=True, exist_ok=True)
            (target / "README.md").write_text("# Hi")
            return subprocess.CompletedProcess(
                args=args, returncode=0, stdout=b"", stderr=b"",
            )

        with patch(
            "ac_dc.url_service.fetchers.subprocess.run",
            side_effect=side_effect,
        ):
            fetch_github_repo("https://github.com/octo/hello", info)

        # Temp dir cleaned up after fetch returns.
        assert len(captured_dirs) == 1
        assert not captured_dirs[0].exists()

    def test_temp_directory_cleaned_up_on_failure(self) -> None:
        """Failed clone — temp dir still removed in finally block."""
        info = GitHubInfo(owner="octo", repo="hello")
        captured_dirs: list[Path] = []

        def side_effect(args, **kwargs):
            target = Path(args[-1])
            captured_dirs.append(target.parent)
            return subprocess.CompletedProcess(
                args=args, returncode=128, stdout=b"", stderr=b"failed",
            )

        with patch(
            "ac_dc.url_service.fetchers.subprocess.run",
            side_effect=side_effect,
        ):
            fetch_github_repo("https://github.com/octo/hello", info)

        assert len(captured_dirs) >= 1
        for d in captured_dirs:
            assert not d.exists()