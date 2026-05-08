"""Construction-time validation of the repo root."""

from __future__ import annotations

from pathlib import Path

import pytest

from ac_dc.repo import Repo, RepoError


class TestConstructor:
    """Construction-time validation of the repo root."""

    def test_accepts_valid_repo(self, repo_dir: Path) -> None:
        """A real git repo constructs cleanly."""
        r = Repo(repo_dir)
        assert r.root == repo_dir.resolve()

    def test_accepts_string_path(self, repo_dir: Path) -> None:
        """String paths are accepted and resolved."""
        r = Repo(str(repo_dir))
        assert r.root == repo_dir.resolve()

    def test_accepts_relative_path(
        self, repo_dir: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Relative paths resolve against cwd."""
        monkeypatch.chdir(repo_dir.parent)
        r = Repo(repo_dir.name)
        assert r.root == repo_dir.resolve()

    def test_rejects_missing_path(self, tmp_path: Path) -> None:
        """Non-existent paths raise RepoError."""
        with pytest.raises(RepoError, match="does not exist"):
            Repo(tmp_path / "nope")

    def test_rejects_file_path(self, tmp_path: Path) -> None:
        """A path that exists but isn't a directory is rejected."""
        file_path = tmp_path / "file.txt"
        file_path.write_text("hi", encoding="utf-8")
        with pytest.raises(RepoError, match="not a directory"):
            Repo(file_path)

    def test_rejects_non_git_directory(self, tmp_path: Path) -> None:
        """A directory without a .git entry is rejected."""
        plain = tmp_path / "plain"
        plain.mkdir()
        with pytest.raises(RepoError, match="Not a git repository"):
            Repo(plain)

    def test_accepts_worktree_style_git_file(self, tmp_path: Path) -> None:
        """Worktrees use a .git FILE rather than a directory.

        We accept the file form — the existence check is ``.git``
        exists, not specifically ``.git`` is a directory. Contract
        documented in the constructor docstring.
        """
        worktree = tmp_path / "worktree"
        worktree.mkdir()
        (worktree / ".git").write_text(
            "gitdir: /some/main/repo/.git/worktrees/wt\n",
            encoding="utf-8",
        )
        r = Repo(worktree)
        assert r.root == worktree.resolve()

    def test_root_property_is_absolute(self, repo_dir: Path) -> None:
        """The root property always returns an absolute path."""
        r = Repo(repo_dir)
        assert r.root.is_absolute()

    def test_name_property_returns_basename(self, repo_dir: Path) -> None:
        """The name property returns the directory basename."""
        r = Repo(repo_dir)
        assert r.name == "repo"