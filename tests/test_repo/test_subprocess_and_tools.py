"""Internal git subprocess helper and external-tool availability probes."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

from ac_dc.repo import Repo, RepoError


class TestGitSubprocess:
    """The internal ``_run_git`` helper used by every git-backed method."""

    def test_run_git_returns_completed_process(self, repo: Repo) -> None:
        """Successful git command returns a CompletedProcess."""
        result = repo._run_git(["status", "--porcelain"])
        assert isinstance(result, subprocess.CompletedProcess)
        assert result.returncode == 0

    def test_run_git_captures_stdout_as_text(self, repo: Repo) -> None:
        """With text=True (default), stdout is a string."""
        result = repo._run_git(["rev-parse", "--is-inside-work-tree"])
        assert isinstance(result.stdout, str)
        assert result.stdout.strip() == "true"

    def test_run_git_captures_stdout_as_bytes_when_text_false(
        self, repo: Repo
    ) -> None:
        """text=False returns raw bytes — needed for binary show."""
        result = repo._run_git(
            ["rev-parse", "--is-inside-work-tree"],
            text=False,
        )
        assert isinstance(result.stdout, bytes)

    def test_run_git_non_zero_exit_returned_not_raised(
        self, repo: Repo
    ) -> None:
        """Non-zero exit is returned so callers can inspect it.

        ``git grep`` exits 1 for "no matches"; that's information,
        not an error. Callers that want raise-on-failure behaviour
        pass ``check=True``.
        """
        # Bogus ref name — git rev-parse fails with non-zero.
        result = repo._run_git(["rev-parse", "no-such-ref"])
        assert result.returncode != 0

    def test_run_git_check_true_raises_on_failure(self, repo: Repo) -> None:
        """check=True turns non-zero exit into a RepoError."""
        with pytest.raises(RepoError, match="failed"):
            repo._run_git(["rev-parse", "no-such-ref"], check=True)

    def test_run_git_error_includes_stderr_content(self, repo: Repo) -> None:
        """The RepoError message includes git's own stderr.

        Callers (and users reading logs) benefit from seeing git's
        diagnostic verbatim rather than a generic "command failed".
        """
        try:
            repo._run_git(["rev-parse", "no-such-ref"], check=True)
        except RepoError as exc:
            message = str(exc)
        else:  # pragma: no cover — test asserts failure above
            pytest.fail("expected RepoError")
        # git's actual error text mentions "unknown revision" or
        # "ambiguous argument" — either is fine.
        lowered = message.lower()
        assert (
            "unknown" in lowered
            or "ambiguous" in lowered
            or "bad revision" in lowered
        )

    def test_run_git_timeout_raises_repo_error(self, repo: Repo) -> None:
        """Subprocess timeout raises RepoError, not TimeoutExpired.

        Uses a trivially-short timeout on ``git status``. On a tiny
        fresh repo this should complete in ms, so we choose a
        timeout so small (1 microsecond) it's nearly always exceeded.
        Test is still race-sensitive — if it becomes flaky on fast
        hardware, we can swap in a git command that genuinely blocks.
        """
        with pytest.raises(RepoError, match="timed out"):
            repo._run_git(["status"], timeout=0.000001)

    def test_run_git_missing_binary_raises(
        self, repo: Repo, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """If the ``git`` binary can't be found, raise a clear error.

        We simulate this by clearing PATH for the duration of the
        call. ``subprocess.run`` raises FileNotFoundError which the
        helper translates into a RepoError with install instructions.
        """
        monkeypatch.setenv("PATH", "")
        # On Windows, subprocess also consults PATHEXT; clear both
        # to cover the platform.
        if sys.platform == "win32":
            monkeypatch.setenv("PATHEXT", "")
        with pytest.raises(RepoError, match="git binary not found"):
            repo._run_git(["status"])

    def test_run_git_cwd_is_repo_root(self, repo: Repo) -> None:
        """Every git call runs with cwd=repo.root.

        The helper's job is to ensure the right working directory is
        passed. We prove this by asking git for its own view of the
        work tree root and comparing to our root.
        """
        result = repo._run_git(
            ["rev-parse", "--show-toplevel"],
            check=True,
        )
        # git may canonicalise the path (e.g., remove trailing slash,
        # normalise case on macOS). Compare by resolve().
        reported = Path(result.stdout.strip()).resolve()
        assert reported == repo.root

    def test_run_git_accepts_stdin_input(self, repo: Repo) -> None:
        """input_data is forwarded to git's stdin.

        We use ``git hash-object --stdin`` — a canonical way to see
        that stdin was piped through. The hash returned is
        deterministic for a given input.
        """
        result = repo._run_git(
            ["hash-object", "--stdin"],
            input_data="hello\n",
            check=True,
        )
        # Git's SHA-1 of the blob "hello\n" is a known constant.
        assert result.stdout.strip() == "ce013625030ba8dba906f756967f9e9ca394464a"


class TestToolAvailability:
    """The ``is_make4ht_available`` probe used by the TeX preview UI."""

    def test_is_make4ht_available_returns_bool(self) -> None:
        """Probe always returns a bool, never raises.

        We don't assume whether make4ht is installed on the test
        machine — we only verify the probe's shape. The method is a
        static call so it doesn't need a repo instance.
        """
        result = Repo.is_make4ht_available()
        assert isinstance(result, bool)

    def test_is_make4ht_available_returns_false_without_path(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Clearing PATH makes the probe return False.

        shutil.which consults PATH; with no PATH, no binary is
        findable. This exercises the not-installed branch without
        depending on the test machine's installed packages.
        """
        monkeypatch.setenv("PATH", "")
        # Windows additionally consults PATHEXT for binary lookup.
        if sys.platform == "win32":
            monkeypatch.setenv("PATHEXT", "")
        assert Repo.is_make4ht_available() is False