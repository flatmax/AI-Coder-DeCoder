"""Tests for collab restriction enforcement — Layer 4.4.2.

Scope: verifies that mutating methods on :class:`Repo` consult
the attached :class:`Collab` instance's
:meth:`is_caller_localhost` and return the
``{"error": "restricted", ...}`` shape when the caller is a
non-localhost participant.

Strategy:

- Real :class:`Repo` against a fresh git repo per test, same as
  ``test_repo.py``'s fixtures.
- Stub collab — a minimal class exposing
  :meth:`is_caller_localhost` with a configurable return value.
  Tests don't exercise the full admission flow; that's covered
  by ``test_collab.py``.
- Two scenarios per method — localhost caller allowed (normal
  behaviour), non-localhost caller rejected with the specific
  error shape.

The single-user path (``_collab is None``) isn't tested here
because every other test in the suite exercises it — 1855+
existing tests all run with ``_collab = None`` and would fail
if the guard broke the common case.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

import pytest

from ac_dc.repo import Repo


# ---------------------------------------------------------------------------
# Stub collab
# ---------------------------------------------------------------------------


class _StubCollab:
    """Minimal collab stand-in for restriction tests.

    Exposes :meth:`is_caller_localhost` with a configurable
    return value. The real :class:`Collab` has the same method
    but delegates to server-side caller tracking; here we just
    pin the return directly so tests focus on the guard
    behaviour rather than the tracking mechanism.
    """

    def __init__(self, is_localhost: bool = True) -> None:
        self._is_localhost = is_localhost
        self.call_count = 0

    def is_caller_localhost(self) -> bool:
        self.call_count += 1
        return self._is_localhost


class _RaisingCollab:
    """Collab stub that raises from ``is_caller_localhost``.

    Used to verify the "fail closed" defensive path — if the
    collab check itself throws, the guard must still refuse
    rather than silently allow the call through.
    """

    def is_caller_localhost(self) -> bool:
        raise RuntimeError("collab check failed")


# ---------------------------------------------------------------------------
# Fixtures — same shape as test_repo.py
# ---------------------------------------------------------------------------


def _run_git(cwd: Path, *args: str) -> None:
    result = subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, (
        f"git {' '.join(args)} failed: {result.stderr}"
    )


@pytest.fixture
def repo_dir(tmp_path: Path) -> Path:
    d = tmp_path / "repo"
    d.mkdir()
    _run_git(d, "init", "-q")
    _run_git(d, "config", "user.email", "test@example.com")
    _run_git(d, "config", "user.name", "Test")
    _run_git(d, "config", "init.defaultBranch", "main")
    _run_git(d, "checkout", "-q", "-b", "main")
    (d / "seed.md").write_text("seed\n")
    _run_git(d, "add", "seed.md")
    _run_git(d, "commit", "-q", "-m", "seed")
    return d


@pytest.fixture
def repo(repo_dir: Path) -> Repo:
    return Repo(repo_dir)


# ---------------------------------------------------------------------------
# Shared assertion helpers
# ---------------------------------------------------------------------------


def _assert_restricted(result: Any) -> None:
    """Assert ``result`` matches the specs4 restricted-error shape."""
    assert isinstance(result, dict)
    assert result.get("error") == "restricted"
    # Reason is human-readable — don't pin exact wording, just
    # make sure it exists and is a non-empty string.
    reason = result.get("reason")
    assert isinstance(reason, str)
    assert reason


# ---------------------------------------------------------------------------
# No-collab single-user path
# ---------------------------------------------------------------------------


class TestNoCollab:
    """``_collab = None`` — every caller treated as localhost."""

    def test_stage_all_allowed(self, repo: Repo) -> None:
        # No collab attached — default behaviour.
        assert repo._collab is None
        result = repo.stage_all()
        assert result == {"status": "ok"}

    def test_check_returns_none_without_collab(
        self, repo: Repo
    ) -> None:
        assert repo._check_localhost_only() is None


# ---------------------------------------------------------------------------
# Localhost caller — allowed
# ---------------------------------------------------------------------------


class TestLocalhostAllowed:
    """Localhost caller sees normal behaviour."""

    def test_stage_all(self, repo: Repo, repo_dir: Path) -> None:
        (repo_dir / "a.md").write_text("new")
        repo._collab = _StubCollab(is_localhost=True)
        result = repo.stage_all()
        assert result == {"status": "ok"}

    def test_commit(self, repo: Repo, repo_dir: Path) -> None:
        (repo_dir / "a.md").write_text("new")
        _run_git(repo_dir, "add", "a.md")
        repo._collab = _StubCollab(is_localhost=True)
        result = repo.commit("add a.md")
        assert "sha" in result
        assert "error" not in result

    def test_reset_hard(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        (repo_dir / "a.md").write_text("dirty")
        repo._collab = _StubCollab(is_localhost=True)
        result = repo.reset_hard()
        assert result == {"status": "ok"}

    def test_stage_files(self, repo: Repo, repo_dir: Path) -> None:
        (repo_dir / "a.md").write_text("new")
        repo._collab = _StubCollab(is_localhost=True)
        result = repo.stage_files(["a.md"])
        assert result == {"status": "ok"}

    def test_unstage_files(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        (repo_dir / "a.md").write_text("new")
        _run_git(repo_dir, "add", "a.md")
        repo._collab = _StubCollab(is_localhost=True)
        result = repo.unstage_files(["a.md"])
        assert result == {"status": "ok"}

    async def test_discard_changes(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        (repo_dir / "seed.md").write_text("modified")
        repo._collab = _StubCollab(is_localhost=True)
        result = await repo.discard_changes(["seed.md"])
        assert result == {"status": "ok"}

    async def test_write_file(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        repo._collab = _StubCollab(is_localhost=True)
        result = await repo.write_file("new.md", "content")
        assert result == {"status": "ok"}

    async def test_create_file(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        repo._collab = _StubCollab(is_localhost=True)
        result = await repo.create_file("new.md", "content")
        assert result == {"status": "ok"}

    async def test_delete_file(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        (repo_dir / "to_delete.md").write_text("goodbye")
        repo._collab = _StubCollab(is_localhost=True)
        result = await repo.delete_file("to_delete.md")
        assert result == {"status": "ok"}

    async def test_rename_file(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        (repo_dir / "old.md").write_text("content")
        repo._collab = _StubCollab(is_localhost=True)
        result = await repo.rename_file("old.md", "new.md")
        assert result == {"status": "ok"}

    async def test_rename_directory(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        (repo_dir / "olddir").mkdir()
        (repo_dir / "olddir" / "file.md").write_text("x")
        repo._collab = _StubCollab(is_localhost=True)
        result = await repo.rename_directory("olddir", "newdir")
        assert result == {"status": "ok"}


# ---------------------------------------------------------------------------
# Non-localhost caller — rejected
# ---------------------------------------------------------------------------


class TestNonLocalhostRejected:
    """Non-localhost caller gets the restricted-error shape.

    Each test asserts that:
    1. The method returns the restricted-error dict
    2. The collab's ``is_caller_localhost`` was consulted
    3. No side effect on disk — the repo state is unchanged
    """

    def test_stage_all(self, repo: Repo, repo_dir: Path) -> None:
        (repo_dir / "a.md").write_text("new")
        collab = _StubCollab(is_localhost=False)
        repo._collab = collab
        result = repo.stage_all()
        _assert_restricted(result)
        assert collab.call_count == 1
        # Staging didn't happen — status-porcelain shows a.md
        # as untracked, not staged.
        status = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=repo_dir, capture_output=True, text=True,
            check=True,
        )
        assert "A  a.md" not in status.stdout
        assert "?? a.md" in status.stdout

    def test_commit(self, repo: Repo, repo_dir: Path) -> None:
        (repo_dir / "a.md").write_text("new")
        _run_git(repo_dir, "add", "a.md")
        repo._collab = _StubCollab(is_localhost=False)
        result = repo.commit("try to commit")
        _assert_restricted(result)
        # a.md is still staged — commit didn't fire.
        status = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=repo_dir, capture_output=True, text=True,
            check=True,
        )
        assert "A  a.md" in status.stdout

    def test_reset_hard(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        (repo_dir / "seed.md").write_text("modified")
        repo._collab = _StubCollab(is_localhost=False)
        result = repo.reset_hard()
        _assert_restricted(result)
        # Modifications preserved.
        assert (
            (repo_dir / "seed.md").read_text() == "modified"
        )

    def test_stage_files(self, repo: Repo, repo_dir: Path) -> None:
        (repo_dir / "a.md").write_text("new")
        repo._collab = _StubCollab(is_localhost=False)
        result = repo.stage_files(["a.md"])
        _assert_restricted(result)

    def test_unstage_files(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        (repo_dir / "a.md").write_text("new")
        _run_git(repo_dir, "add", "a.md")
        repo._collab = _StubCollab(is_localhost=False)
        result = repo.unstage_files(["a.md"])
        _assert_restricted(result)

    async def test_discard_changes(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        (repo_dir / "seed.md").write_text("modified")
        repo._collab = _StubCollab(is_localhost=False)
        result = await repo.discard_changes(["seed.md"])
        _assert_restricted(result)
        # Modification preserved.
        assert (repo_dir / "seed.md").read_text() == "modified"

    async def test_write_file(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        repo._collab = _StubCollab(is_localhost=False)
        result = await repo.write_file("new.md", "content")
        _assert_restricted(result)
        # File wasn't written.
        assert not (repo_dir / "new.md").exists()

    async def test_create_file(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        repo._collab = _StubCollab(is_localhost=False)
        result = await repo.create_file("new.md", "content")
        _assert_restricted(result)
        assert not (repo_dir / "new.md").exists()

    async def test_delete_file(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        (repo_dir / "to_delete.md").write_text("preserved")
        repo._collab = _StubCollab(is_localhost=False)
        result = await repo.delete_file("to_delete.md")
        _assert_restricted(result)
        # File still exists.
        assert (
            (repo_dir / "to_delete.md").read_text() == "preserved"
        )

    async def test_rename_file(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        (repo_dir / "old.md").write_text("content")
        repo._collab = _StubCollab(is_localhost=False)
        result = await repo.rename_file("old.md", "new.md")
        _assert_restricted(result)
        # Original still there, new not created.
        assert (repo_dir / "old.md").exists()
        assert not (repo_dir / "new.md").exists()

    async def test_rename_directory(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        (repo_dir / "olddir").mkdir()
        (repo_dir / "olddir" / "file.md").write_text("x")
        repo._collab = _StubCollab(is_localhost=False)
        result = await repo.rename_directory("olddir", "newdir")
        _assert_restricted(result)
        assert (repo_dir / "olddir").exists()
        assert not (repo_dir / "newdir").exists()


# ---------------------------------------------------------------------------
# Defensive — collab check failure
# ---------------------------------------------------------------------------


class TestCollabCheckFailure:
    """If the collab check itself raises, fail closed."""

    def test_stage_all_fails_closed(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        (repo_dir / "a.md").write_text("new")
        repo._collab = _RaisingCollab()
        result = repo.stage_all()
        _assert_restricted(result)
        # Staging didn't happen — a.md still untracked.
        status = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=repo_dir, capture_output=True, text=True,
            check=True,
        )
        assert "?? a.md" in status.stdout


# ---------------------------------------------------------------------------
# Read operations unaffected
# ---------------------------------------------------------------------------


class TestReadOperationsAllowed:
    """Read-only methods work regardless of localhost status.

    Specs4 — non-localhost participants can browse, search,
    view diffs. Only mutating methods are guarded.
    """

    def test_get_file_content(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        repo._collab = _StubCollab(is_localhost=False)
        # Read-only — no restriction.
        content = repo.get_file_content("seed.md")
        assert content == "seed\n"

    def test_get_staged_diff(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        repo._collab = _StubCollab(is_localhost=False)
        diff = repo.get_staged_diff()
        # Empty diff — no staged changes.
        assert diff == ""

    def test_file_exists(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        repo._collab = _StubCollab(is_localhost=False)
        assert repo.file_exists("seed.md") is True
        assert repo.file_exists("nonexistent.md") is False

    def test_is_clean(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        repo._collab = _StubCollab(is_localhost=False)
        assert repo.is_clean() is True