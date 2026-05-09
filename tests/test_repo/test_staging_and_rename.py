"""Staging operations and rename/move helpers."""

from __future__ import annotations

import pytest

from ac_dc.repo import Repo, RepoError

from .conftest import _run_git


class TestStaging:
    """stage_files, unstage_files, stage_all, discard_changes."""

    def test_stage_files_adds_new_file(self, repo: Repo) -> None:
        """stage_files on a new file stages it for commit."""
        (repo.root / "new.md").write_text("hello", encoding="utf-8")
        result = repo.stage_files(["new.md"])
        assert result == {"status": "ok"}
        # Confirm via porcelain — status 'A' means staged addition.
        status = _run_git(repo.root, "status", "--porcelain").stdout
        assert "A  new.md" in status

    def test_stage_files_stages_modification(self, repo: Repo) -> None:
        """Modifications to tracked files also stage correctly."""
        # Commit an initial version.
        (repo.root / "tracked.md").write_text("v1", encoding="utf-8")
        _run_git(repo.root, "add", "tracked.md")
        _run_git(repo.root, "commit", "-q", "-m", "add tracked")
        # Modify and stage.
        (repo.root / "tracked.md").write_text("v2", encoding="utf-8")
        repo.stage_files(["tracked.md"])
        status = _run_git(repo.root, "status", "--porcelain").stdout
        # 'M ' (staged modification, no unstaged changes) expected.
        assert status.startswith("M  tracked.md")

    def test_stage_files_stages_deletion(self, repo: Repo) -> None:
        """git add -A on a removed file stages its deletion."""
        (repo.root / "doomed.md").write_text("bye", encoding="utf-8")
        _run_git(repo.root, "add", "doomed.md")
        _run_git(repo.root, "commit", "-q", "-m", "add doomed")
        (repo.root / "doomed.md").unlink()
        repo.stage_files(["doomed.md"])
        status = _run_git(repo.root, "status", "--porcelain").stdout
        assert "D  doomed.md" in status

    def test_stage_files_empty_list_noop(self, repo: Repo) -> None:
        """Empty input returns ok without invoking git."""
        assert repo.stage_files([]) == {"status": "ok"}

    def test_stage_files_multiple_paths(self, repo: Repo) -> None:
        """Multi-path staging works."""
        (repo.root / "a.md").write_text("a", encoding="utf-8")
        (repo.root / "b.md").write_text("b", encoding="utf-8")
        repo.stage_files(["a.md", "b.md"])
        status = _run_git(repo.root, "status", "--porcelain").stdout
        assert "A  a.md" in status
        assert "A  b.md" in status

    def test_stage_files_rejects_invalid_path(self, repo: Repo) -> None:
        """Traversal attempts raise before git is invoked."""
        with pytest.raises(RepoError, match="traversal"):
            repo.stage_files(["../escape.txt"])

    def test_unstage_files_removes_from_index(self, repo: Repo) -> None:
        """unstage_files reverses a stage_files."""
        # Establish a HEAD so reset has something to reset to.
        (repo.root / "seed.md").write_text("seed", encoding="utf-8")
        _run_git(repo.root, "add", "seed.md")
        _run_git(repo.root, "commit", "-q", "-m", "seed")
        # Now stage a new file, then unstage.
        (repo.root / "new.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "new.md")
        repo.unstage_files(["new.md"])
        status = _run_git(repo.root, "status", "--porcelain").stdout
        # Should now appear as untracked (??).
        assert "?? new.md" in status

    def test_unstage_files_empty_list_noop(self, repo: Repo) -> None:
        """Empty input returns ok."""
        assert repo.unstage_files([]) == {"status": "ok"}

    def test_unstage_files_rejects_invalid_path(self, repo: Repo) -> None:
        """Traversal attempts raise."""
        with pytest.raises(RepoError, match="traversal"):
            repo.unstage_files(["../escape.txt"])

    def test_stage_all_picks_up_every_change(self, repo: Repo) -> None:
        """stage_all stages adds, modifies, and deletes in one go."""
        # Pre-existing tracked file.
        (repo.root / "tracked.md").write_text("v1", encoding="utf-8")
        _run_git(repo.root, "add", "tracked.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        # Make all three kinds of change.
        (repo.root / "tracked.md").write_text("v2", encoding="utf-8")  # modify
        (repo.root / "new.md").write_text("hi", encoding="utf-8")  # add
        (repo.root / "tracked.md")  # keep reference for after
        # (delete case)
        (repo.root / "doomed.md").write_text("bye", encoding="utf-8")
        _run_git(repo.root, "add", "doomed.md")
        _run_git(repo.root, "commit", "-q", "-m", "add doomed")
        (repo.root / "doomed.md").unlink()
        repo.stage_all()
        status = _run_git(repo.root, "status", "--porcelain").stdout
        assert "M  tracked.md" in status
        assert "A  new.md" in status
        assert "D  doomed.md" in status

    async def test_discard_changes_restores_tracked(self, repo: Repo) -> None:
        """Tracked files are restored from HEAD."""
        (repo.root / "file.md").write_text("original", encoding="utf-8")
        _run_git(repo.root, "add", "file.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        # Modify.
        (repo.root / "file.md").write_text("modified", encoding="utf-8")
        await repo.discard_changes(["file.md"])
        assert (repo.root / "file.md").read_text(encoding="utf-8") == "original"

    async def test_discard_changes_deletes_untracked(self, repo: Repo) -> None:
        """Untracked files are deleted from the filesystem."""
        (repo.root / "fresh.md").write_text("hi", encoding="utf-8")
        # No git add — still untracked.
        await repo.discard_changes(["fresh.md"])
        assert not (repo.root / "fresh.md").exists()

    async def test_discard_changes_missing_file_is_idempotent(
        self, repo: Repo
    ) -> None:
        """Missing files don't raise — matches the method's contract."""
        # Establish HEAD first so checkout has something to restore to.
        (repo.root / "seed.md").write_text("seed", encoding="utf-8")
        _run_git(repo.root, "add", "seed.md")
        _run_git(repo.root, "commit", "-q", "-m", "seed")
        # gone.md doesn't exist. Method should treat as no-op.
        result = await repo.discard_changes(["gone.md"])
        assert result == {"status": "ok"}

    async def test_discard_changes_empty_list_noop(self, repo: Repo) -> None:
        """Empty input returns ok."""
        assert await repo.discard_changes([]) == {"status": "ok"}

    async def test_discard_changes_rejects_invalid_path(
        self, repo: Repo
    ) -> None:
        """Traversal attempts raise."""
        with pytest.raises(RepoError, match="traversal"):
            await repo.discard_changes(["../escape.txt"])

    async def test_discard_changes_drops_untracked_lock_entry(
        self, repo: Repo
    ) -> None:
        """After deleting an untracked file, its lock entry is removed.

        Matches delete_file's lock-map hygiene — the map shouldn't
        retain entries for paths that no longer exist.
        """
        (repo.root / "fresh.md").write_text("hi", encoding="utf-8")
        # Touch the lock so it exists in the map.
        repo._get_write_lock("fresh.md")
        assert "fresh.md" in repo._write_locks
        await repo.discard_changes(["fresh.md"])
        assert "fresh.md" not in repo._write_locks


class TestRename:
    """rename_file and rename_directory."""

    async def test_rename_file_tracked_uses_git_mv(self, repo: Repo) -> None:
        """Tracked files move via git mv, preserving history.

        We can't easily verify "history preserved" from a test
        harness without diffing log --follow output, but we can
        verify that git now knows the new path is tracked and the
        old one is gone from the index.
        """
        (repo.root / "old.md").write_text("content", encoding="utf-8")
        _run_git(repo.root, "add", "old.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        await repo.rename_file("old.md", "new.md")
        # Old gone from disk and index; new present in both.
        assert not (repo.root / "old.md").exists()
        assert (repo.root / "new.md").is_file()
        ls = _run_git(repo.root, "ls-files").stdout.splitlines()
        assert "new.md" in ls
        assert "old.md" not in ls

    async def test_rename_file_untracked_uses_filesystem(
        self, repo: Repo
    ) -> None:
        """Untracked files move without git mv.

        Verifies the filesystem-rename branch. After the rename,
        the new path is still untracked (wasn't in the index before,
        isn't now).
        """
        (repo.root / "old.md").write_text("hi", encoding="utf-8")
        await repo.rename_file("old.md", "new.md")
        assert not (repo.root / "old.md").exists()
        assert (repo.root / "new.md").read_text(encoding="utf-8") == "hi"
        # Still untracked.
        status = _run_git(repo.root, "status", "--porcelain").stdout
        assert "?? new.md" in status

    async def test_rename_file_creates_destination_parent(
        self, repo: Repo
    ) -> None:
        """Missing parent directories on the destination are created."""
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        await repo.rename_file("a.md", "deep/nested/b.md")
        assert (repo.root / "deep" / "nested" / "b.md").is_file()

    async def test_rename_file_missing_source_raises(self, repo: Repo) -> None:
        """Renaming a non-existent file raises."""
        with pytest.raises(RepoError, match="not found"):
            await repo.rename_file("nope.md", "somewhere.md")

    async def test_rename_file_source_is_directory_raises(
        self, repo: Repo
    ) -> None:
        """Renaming a directory via rename_file raises — use rename_directory."""
        (repo.root / "subdir").mkdir()
        with pytest.raises(RepoError, match="directory"):
            await repo.rename_file("subdir", "other")

    async def test_rename_file_destination_exists_raises(
        self, repo: Repo
    ) -> None:
        """Refusing to clobber — the destination must not already exist."""
        (repo.root / "a.md").write_text("a", encoding="utf-8")
        (repo.root / "b.md").write_text("b", encoding="utf-8")
        with pytest.raises(RepoError, match="already exists"):
            await repo.rename_file("a.md", "b.md")
        # Both files unchanged.
        assert (repo.root / "a.md").read_text(encoding="utf-8") == "a"
        assert (repo.root / "b.md").read_text(encoding="utf-8") == "b"

    async def test_rename_file_rejects_invalid_source(self, repo: Repo) -> None:
        """Traversal in the source path is rejected."""
        with pytest.raises(RepoError, match="traversal"):
            await repo.rename_file("../outside.md", "inside.md")

    async def test_rename_file_rejects_invalid_destination(
        self, repo: Repo
    ) -> None:
        """Traversal in the destination path is rejected."""
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        with pytest.raises(RepoError, match="traversal"):
            await repo.rename_file("a.md", "../escape.md")

    async def test_rename_file_drops_source_lock_entry(self, repo: Repo) -> None:
        """After rename, the source path's lock entry is dropped.

        Mirrors delete_file's hygiene — lock map shouldn't accrete
        stale entries for paths that no longer exist.
        """
        (repo.root / "old.md").write_text("hi", encoding="utf-8")
        # Touch the lock so it exists in the map.
        await repo.write_file("old.md", "hi")
        assert "old.md" in repo._write_locks
        await repo.rename_file("old.md", "new.md")
        assert "old.md" not in repo._write_locks

    async def test_rename_directory_tracked_uses_git_mv(self, repo: Repo) -> None:
        """Directories with tracked files move via git mv."""
        (repo.root / "src").mkdir()
        (repo.root / "src" / "a.md").write_text("a", encoding="utf-8")
        _run_git(repo.root, "add", "src/a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        await repo.rename_directory("src", "lib")
        assert not (repo.root / "src").exists()
        assert (repo.root / "lib" / "a.md").is_file()
        ls = _run_git(repo.root, "ls-files").stdout.splitlines()
        assert "lib/a.md" in ls

    async def test_rename_directory_untracked_uses_filesystem(
        self, repo: Repo
    ) -> None:
        """Directories with only untracked files use filesystem rename."""
        (repo.root / "scratch").mkdir()
        (repo.root / "scratch" / "tmp.md").write_text("hi", encoding="utf-8")
        await repo.rename_directory("scratch", "workspace")
        assert not (repo.root / "scratch").exists()
        assert (repo.root / "workspace" / "tmp.md").is_file()

    async def test_rename_directory_missing_source_raises(
        self, repo: Repo
    ) -> None:
        """Missing source directory raises."""
        with pytest.raises(RepoError, match="not found"):
            await repo.rename_directory("nope", "somewhere")

    async def test_rename_directory_source_is_file_raises(
        self, repo: Repo
    ) -> None:
        """A file passed to rename_directory raises — use rename_file."""
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        with pytest.raises(RepoError, match="not a directory"):
            await repo.rename_directory("a.md", "b.md")

    async def test_rename_directory_destination_exists_raises(
        self, repo: Repo
    ) -> None:
        """Destination directory must not already exist."""
        (repo.root / "a").mkdir()
        (repo.root / "b").mkdir()
        with pytest.raises(RepoError, match="already exists"):
            await repo.rename_directory("a", "b")