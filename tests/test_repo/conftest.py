"""Shared fixtures for the ``test_repo`` package.

Every test file in this package gets a fresh git repo via the
``repo_dir`` fixture and a :class:`Repo` wrapping it via ``repo``.
The ``_run_git`` helper is exported for tests that need to drive
the test fixture's git directly (independent of the
subject-under-test's own git calls).
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from ac_dc.repo import Repo


def _run_git(cwd: Path, *args: str) -> subprocess.CompletedProcess:
    """Run git inside a test repo, failing loudly if git exits non-zero.

    Keeps test setup readable by hiding subprocess boilerplate. Never
    used for the subject-under-test's own git calls — those go through
    :meth:`Repo._run_git`.
    """
    result = subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, (
        f"git {' '.join(args)!r} failed:\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )
    return result


@pytest.fixture
def repo_dir(tmp_path: Path) -> Path:
    """A fresh git repo rooted at ``tmp_path/repo``.

    Sets user.email and user.name locally so commits work regardless
    of whether the CI runner has a global git identity configured.
    """
    root = tmp_path / "repo"
    root.mkdir()
    _run_git(root, "init", "-q")
    # Local identity — avoids "Please tell me who you are" errors on
    # CI runners without a global git config.
    _run_git(root, "config", "user.email", "test@example.com")
    _run_git(root, "config", "user.name", "Test User")
    # Default branch name — older git versions default to "master",
    # newer to "main". Force "main" for predictability.
    _run_git(root, "config", "init.defaultBranch", "main")
    _run_git(root, "checkout", "-q", "-b", "main")
    return root


@pytest.fixture
def repo(repo_dir: Path) -> Repo:
    """A :class:`Repo` instance wrapping the fresh test repo."""
    return Repo(repo_dir)