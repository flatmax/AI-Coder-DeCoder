"""Git staging and rename operations.

Extracted from :mod:`ac_dc.repo`. See ``specs4/1-foundation/repository.md``
for the governing contract.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from .errors import RepoError


class StagingMixin:
    """Git staging operations and rename plumbing.

    Mixed into :class:`Repo`. Read operations are synchronous;
    operations that touch the filesystem (discard, rename) are
    async because they take per-path write locks.
    """

    _root: Path
    _write_locks: dict[str, asyncio.Lock]

    # Forward declarations from sibling mixins.
    def _validate_rel_path(self, path: str | Path) -> Path: ...  # type: ignore[empty-body]
    def _normalise_rel_path(self, path: str | Path) -> str: ...  # type: ignore[empty-body]
    def _check_localhost_only(self) -> dict[str, Any] | None: ...  # type: ignore[empty-body]
    def _get_write_lock(self, path: str | Path) -> asyncio.Lock: ...  # type: ignore[empty-body]
    def _fire_post_write(self, path: str | Path) -> None: ...  # type: ignore[empty-body]
    def _run_git(self, args: list[str], **kwargs: Any) -> Any: ...  # type: ignore[empty-body]

    # ------------------------------------------------------------------
    # Git staging
    # ------------------------------------------------------------------

    def stage_files(self, paths: list[str | Path]) -> dict[str, str]:
        """Stage one or more files for commit (``git add``).

        Handles both file additions/modifications and deletions —
        ``git add`` with a path that no longer exists stages the
        deletion, which is what callers want for a ``delete_file``
        + ``stage_files`` sequence.

        Parameters
        ----------
        paths:
            List of relative paths. Empty list is a no-op.

        Returns
        -------
        dict
            ``{"status": "ok"}`` on success.

        Raises
        ------
        RepoError
            If any path is invalid (traversal, absolute). Each path
            is validated before the git call; we prefer to fail the
            whole batch than stage some files and leave others out
            — that's more predictable for the caller.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted  # type: ignore[return-value]
        if not paths:
            return {"status": "ok"}
        # Validate every path before invoking git. --literal-pathspecs
        # ensures git treats our strings as literal paths, not as
        # pathspec patterns (which could otherwise be exploited to
        # stage files we didn't intend).
        validated = [self._normalise_rel_path(p) for p in paths]
        for p in paths:
            self._validate_rel_path(p)
        # ``git add -A`` on individual paths handles adds, modifies,
        # and deletes uniformly. Safer than ``git add`` alone, which
        # (depending on git version and config) may ignore deletions.
        self._run_git(
            ["add", "-A", "--", *validated],
            check=True,
        )
        return {"status": "ok"}

    def unstage_files(self, paths: list[str | Path]) -> dict[str, str]:
        """Remove files from the staging area (``git reset HEAD -- paths``).

        Matches what ``git reset`` with no ``--hard`` does: the
        working tree is untouched, only the index changes. For
        tracked files, the staged changes move back to "modified
        but unstaged"; for newly-added files, they become
        "untracked".

        Parameters
        ----------
        paths:
            List of relative paths. Empty list is a no-op.

        Returns
        -------
        dict
            ``{"status": "ok"}`` on success.

        Raises
        ------
        RepoError
            If any path is invalid. Non-zero git exit is NOT raised
            — ``git reset`` returns 1 when files have unstaged
            changes, which isn't an error for our purposes (the
            operation still succeeded).
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted  # type: ignore[return-value]
        if not paths:
            return {"status": "ok"}
        validated = [self._normalise_rel_path(p) for p in paths]
        for p in paths:
            self._validate_rel_path(p)
        # Don't pass check=True — git reset exits non-zero when there
        # are unstaged changes remaining, but the reset itself still
        # happened. Silence the spurious error by ignoring exit code.
        result = self._run_git(["reset", "HEAD", "--", *validated])
        # An actual failure (e.g., no HEAD on a brand new repo) has
        # stderr but no stdout. Detect and surface those.
        if result.returncode != 0 and "fatal:" in (result.stderr or ""):
            raise RepoError(
                f"git reset failed: {result.stderr.strip()}"
            )
        return {"status": "ok"}

    async def discard_changes(
        self, paths: list[str | Path]
    ) -> dict[str, str]:
        """Discard working-tree changes.

        Semantics per path:

        - Tracked file with changes → ``git checkout -- path``
          restores the HEAD version.
        - Untracked file → deleted from the filesystem (matches
          ``git clean -f`` behaviour without the scary flag).
        - Missing file → silently skipped (idempotent).

        Async because it can delete files — we take each file's
        write lock so concurrent edits don't race with the discard.

        Parameters
        ----------
        paths:
            List of relative paths.

        Returns
        -------
        dict
            ``{"status": "ok"}`` on success.

        Raises
        ------
        RepoError
            If any path is invalid.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted  # type: ignore[return-value]
        if not paths:
            return {"status": "ok"}
        # Validate everything first.
        for p in paths:
            self._validate_rel_path(p)

        # Split into tracked vs untracked so we can use the right
        # mechanism for each. ``git ls-files --error-unmatch`` per
        # path is the canonical way to probe tracked status — exit
        # code 0 means tracked, non-zero means untracked.
        tracked: list[str] = []
        untracked: list[str] = []
        for p in paths:
            rel = self._normalise_rel_path(p)
            result = self._run_git(
                ["ls-files", "--error-unmatch", "--", rel],
            )
            if result.returncode == 0:
                tracked.append(rel)
            else:
                untracked.append(rel)

        # Tracked files — restore from HEAD.
        if tracked:
            self._run_git(
                ["checkout", "HEAD", "--", *tracked],
                check=True,
            )

        # Untracked files — delete. Uses our write mutex per path so
        # a concurrent write doesn't race with the unlink.
        for rel in untracked:
            absolute = self._root / rel
            if not absolute.exists():
                continue  # already gone — idempotent
            lock = self._get_write_lock(rel)
            async with lock:
                if absolute.is_file():
                    try:
                        absolute.unlink()
                    except OSError as exc:
                        raise RepoError(
                            f"Failed to discard {rel}: {exc}"
                        ) from exc
                    self._write_locks.pop(rel, None)
                # Directories are left alone — callers that want to
                # discard an untracked directory should use a shell
                # ``rm -rf`` or ``git clean -fd`` deliberately.

        return {"status": "ok"}

    def stage_all(self) -> dict[str, str]:
        """Stage every change in the working tree (``git add -A``).

        Equivalent to ``stage_files`` over every changed path, but
        expressed as a single git call so large repos don't enumerate
        thousands of paths through Python.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted  # type: ignore[return-value]
        self._run_git(["add", "-A"], check=True)
        return {"status": "ok"}

    # ------------------------------------------------------------------
    # Rename operations
    # ------------------------------------------------------------------

    async def rename_file(
        self,
        old_path: str | Path,
        new_path: str | Path,
    ) -> dict[str, str]:
        """Rename or move a single file.

        Uses ``git mv`` for tracked files (preserves history) and a
        filesystem rename for untracked files. Parent directories
        of the destination are created automatically.

        Parameters
        ----------
        old_path:
            Existing relative path.
        new_path:
            Destination relative path. Must not already exist.

        Returns
        -------
        dict
            ``{"status": "ok"}`` on success.

        Raises
        ------
        RepoError
            If either path is invalid, the source doesn't exist or
            isn't a regular file, or the destination already exists.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted  # type: ignore[return-value]
        src_abs = self._validate_rel_path(old_path)
        dst_abs = self._validate_rel_path(new_path)

        if not src_abs.exists():
            raise RepoError(f"Source file not found: {old_path}")
        if src_abs.is_dir():
            raise RepoError(
                f"Source is a directory (use rename_directory): {old_path}"
            )
        if dst_abs.exists():
            raise RepoError(f"Destination already exists: {new_path}")

        # Probe tracked status. Same technique as discard_changes —
        # ls-files --error-unmatch is the canonical probe.
        src_rel = self._normalise_rel_path(old_path)
        dst_rel = self._normalise_rel_path(new_path)
        probe = self._run_git(
            ["ls-files", "--error-unmatch", "--", src_rel],
        )
        is_tracked = probe.returncode == 0

        # Acquire both write locks to serialise against concurrent
        # edits on either side of the rename. Lock-acquisition order
        # is by sorted key so two simultaneous renames that happen
        # to swap paths can't deadlock — each picks up the lower
        # key first.
        lock_a, lock_b = sorted(
            [src_rel, dst_rel], key=str
        )
        async with self._get_write_lock(lock_a), self._get_write_lock(lock_b):
            # Parent directory for the destination.
            dst_abs.parent.mkdir(parents=True, exist_ok=True)

            if is_tracked:
                # git mv handles both filesystem move and index
                # update in one step, preserving history.
                self._run_git(
                    ["mv", "--", src_rel, dst_rel],
                    check=True,
                )
            else:
                try:
                    src_abs.rename(dst_abs)
                except OSError as exc:
                    raise RepoError(
                        f"Failed to rename {old_path} -> {new_path}: {exc}"
                    ) from exc
            # Drop the source-path lock entry — any future writes
            # target the new path.
            self._write_locks.pop(src_rel, None)

        self._fire_post_write(new_path)
        return {"status": "ok"}

    async def rename_directory(
        self,
        old_path: str | Path,
        new_path: str | Path,
    ) -> dict[str, str]:
        """Rename or move a directory.

        Uses ``git mv`` for directories containing tracked files;
        otherwise a filesystem rename. Parent directories of the
        destination are created automatically.

        Parameters
        ----------
        old_path:
            Existing relative directory path.
        new_path:
            Destination relative directory path. Must not exist.

        Returns
        -------
        dict
            ``{"status": "ok"}`` on success.

        Raises
        ------
        RepoError
            If either path is invalid, the source isn't an existing
            directory, or the destination already exists.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted  # type: ignore[return-value]
        src_abs = self._validate_rel_path(old_path)
        dst_abs = self._validate_rel_path(new_path)

        if not src_abs.exists():
            raise RepoError(f"Source directory not found: {old_path}")
        if not src_abs.is_dir():
            raise RepoError(f"Source is not a directory: {old_path}")
        if dst_abs.exists():
            raise RepoError(f"Destination already exists: {new_path}")

        src_rel = self._normalise_rel_path(old_path)
        dst_rel = self._normalise_rel_path(new_path)

        # Probe whether the directory contains any tracked files.
        # ``git ls-files`` takes a pathspec — a trailing slash on
        # the directory name works as a directory pathspec on all
        # git versions we care about.
        probe = self._run_git(
            ["ls-files", "--", f"{src_rel}/"],
        )
        has_tracked = bool(probe.stdout and probe.stdout.strip())

        # Directory-level locks — we don't track per-directory
        # locks (the map is per-file), so we serialise the rename
        # itself by not holding any file-specific lock. Concurrent
        # file writes during a directory rename would be a caller
        # bug; the per-path mutex only guarantees serial writes to
        # the same path, not serial-against-parent-rename.
        dst_abs.parent.mkdir(parents=True, exist_ok=True)
        if has_tracked:
            self._run_git(
                ["mv", "--", src_rel, dst_rel],
                check=True,
            )
        else:
            try:
                src_abs.rename(dst_abs)
            except OSError as exc:
                raise RepoError(
                    f"Failed to rename directory "
                    f"{old_path} -> {new_path}: {exc}"
                ) from exc

        return {"status": "ok"}