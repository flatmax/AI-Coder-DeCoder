"""File I/O mixin for :class:`Repo`.

Extracted from ``src/ac_dc/repo.py`` as part of the package split.
Contains read and write methods. The async write/create/delete
methods serialise per-path via :meth:`_get_write_lock` (provided
by ``LocksMixin``) so a future parallel-agent mode (D10) can
safely have N agents generating edits concurrently.
"""

from __future__ import annotations

import asyncio
import base64
from pathlib import Path
from typing import Any

from .errors import BINARY_PROBE_BYTES, RepoError


class FilesMixin:
    """File I/O — read, write, create, delete.

    Mixed into :class:`Repo`. The async write/create/delete methods
    serialise per-path via :meth:`_get_write_lock` (LocksMixin) so
    a future parallel-agent mode (D10) can safely have N agents
    generating edits concurrently.
    """

    _root: Path
    _write_locks: dict[str, asyncio.Lock]

    # Forward declarations from sibling mixins.
    def _validate_rel_path(self, path: str | Path) -> Path: ...  # type: ignore[empty-body]
    def _normalise_rel_path(self, path: str | Path) -> str: ...  # type: ignore[empty-body]
    @staticmethod
    def _is_binary_bytes(data: bytes) -> bool: ...  # type: ignore[empty-body]
    @staticmethod
    def _detect_mime(path: Path) -> str: ...  # type: ignore[empty-body]
    def _check_localhost_only(self) -> dict[str, Any] | None: ...  # type: ignore[empty-body]
    def _get_write_lock(self, path: str | Path) -> asyncio.Lock: ...  # type: ignore[empty-body]
    def _fire_post_write(self, path: str | Path) -> None: ...  # type: ignore[empty-body]
    def _run_git(self, args: list[str], **kwargs: Any) -> Any: ...  # type: ignore[empty-body]

    # ------------------------------------------------------------------
    # File read operations
    # ------------------------------------------------------------------

    def file_exists(self, path: str | Path) -> bool:
        """Check whether a file exists in the repo.

        Returns False for invalid paths, missing files, and paths
        that refer to directories. Matches what a user would expect
        from ``test -f`` at the shell.
        """
        try:
            absolute = self._validate_rel_path(path)
        except RepoError:
            return False
        return absolute.is_file()

    def get_file_content(
        self,
        path: str | Path,
        version: str | None = None,
    ) -> str:
        """Read a file's content as text.

        Parameters
        ----------
        path:
            Relative path to the file.
        version:
            Optional git ref (e.g. ``"HEAD"``, a branch name, or a
            commit SHA). When provided, the file content is read from
            that ref via ``git show`` rather than from the working
            tree. When None, the working-tree copy is read.

        Returns
        -------
        str
            The file's content, decoded as UTF-8 with replacement of
            invalid sequences.

        Raises
        ------
        RepoError
            If the path is invalid, the file is binary, the file is
            missing (working tree), or the ref does not exist.
        """
        absolute = self._validate_rel_path(path)

        if version is None:
            # Working-tree read. Binary check is explicit — refusing
            # to return binary content as text prevents the LLM
            # streaming layer from getting decode errors or mojibake.
            if not absolute.is_file():
                raise RepoError(f"File not found: {path}")
            with absolute.open("rb") as fh:
                probe = fh.read(BINARY_PROBE_BYTES)
            if self._is_binary_bytes(probe):
                raise RepoError(
                    f"Binary file cannot be read as text: {path}"
                )
            # Debug-log working-tree reads so a segfault during
            # preview rendering can be correlated against the
            # specific file the viewer was loading. Stays at
            # debug to keep the steady-state log quiet.
            import logging as _lg
            _lg.getLogger("ac_dc.repo").debug(
                "get_file_content: working-tree read path=%s "
                "size=%d",
                path, absolute.stat().st_size,
            )
            return absolute.read_text(encoding="utf-8", errors="replace")

        # Versioned read via ``git show``. The ``ref:path`` syntax is
        # git's object-name spelling for "this file at this ref"; it
        # handles renames and deletes across history correctly. We
        # use ``--`` as a safety delimiter so a pathological ref
        # name can't be mistaken for an option.
        normalised = self._normalise_rel_path(path)
        spec = f"{version}:{normalised}"
        result = self._run_git(
            ["show", spec],
            text=False,
        )
        if result.returncode != 0:
            # git's stderr is the useful diagnostic — pass it through
            # so callers see "fatal: invalid object name" or "exists
            # on disk, but not in <ref>" directly.
            stderr = (result.stderr or b"").decode(
                "utf-8", errors="replace"
            ).strip()
            # Log at warning so the failed call is visible even
            # if the caller swallows the RepoError. The bare
            # "Failed: git show ..." line that previously appeared
            # on stderr came from jrpc-oo printing the exception
            # text directly; this log gives us a properly-
            # timestamped record in the ac_dc.repo logger that
            # can be correlated with subsequent segfaults.
            import logging as _lg
            _lg.getLogger("ac_dc.repo").warning(
                "git show %s failed (rc=%d): %s",
                spec, result.returncode,
                stderr or "unknown error",
            )
            raise RepoError(
                f"git show {spec!r} failed: {stderr or 'unknown error'}"
            )
        if self._is_binary_bytes(result.stdout):
            raise RepoError(
                f"Binary file cannot be read as text: {path}@{version}"
            )
        return result.stdout.decode("utf-8", errors="replace")

    def get_file_base64(self, path: str | Path) -> dict[str, str]:
        """Read a file as a base64 data URI.

        Used by the SVG viewer and by the diff-viewer markdown
        preview to resolve relative image references without proxying
        every image fetch through the webapp server.

        Parameters
        ----------
        path:
            Relative path to the file.

        Returns
        -------
        dict
            ``{"data_uri": "data:<mime>;base64,<payload>"}``. The
            MIME type is detected from the filename extension, with
            a fallback to ``application/octet-stream`` so the
            returned value is always a valid data URI.

        Raises
        ------
        RepoError
            If the path is invalid or the file doesn't exist.
        """
        absolute = self._validate_rel_path(path)
        if not absolute.is_file():
            raise RepoError(f"File not found: {path}")
        mime = self._detect_mime(absolute)
        payload = base64.b64encode(absolute.read_bytes()).decode("ascii")
        return {"data_uri": f"data:{mime};base64,{payload}"}

    # ------------------------------------------------------------------
    # File write operations
    # ------------------------------------------------------------------

    async def write_file(
        self,
        path: str | Path,
        content: str,
    ) -> dict[str, str]:
        """Write text content to a file, creating parent directories.

        Overwrites any existing file. Parent directories are created
        with default permissions — we don't try to match any existing
        permission scheme. Serialised against concurrent writes to the
        same path via :meth:`_get_write_lock` (D10 contract).

        Parameters
        ----------
        path:
            Relative path to the file.
        content:
            Text content to write. Encoded as UTF-8; invalid sequences
            are replaced rather than raising, matching the read-side
            behaviour and keeping this method total.

        Returns
        -------
        dict
            ``{"status": "ok"}`` on success. The extra wrapping lets
            callers distinguish a successful write from a raised
            error consistently.

        Raises
        ------
        RepoError
            If the path is invalid or the write fails. Write failures
            (disk full, permission denied) are not recoverable here —
            we bubble up with a clear message and let the RPC layer
            convert to an error response.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted  # type: ignore[return-value]
        absolute = self._validate_rel_path(path)
        lock = self._get_write_lock(path)
        async with lock:
            try:
                absolute.parent.mkdir(parents=True, exist_ok=True)
                absolute.write_text(content, encoding="utf-8", errors="replace")
            except OSError as exc:
                raise RepoError(f"Failed to write {path}: {exc}") from exc
        self._fire_post_write(path)
        return {"status": "ok"}

    async def create_file(
        self,
        path: str | Path,
        content: str = "",
    ) -> dict[str, str]:
        """Create a new file, failing if it already exists.

        Distinct from :meth:`write_file` because edit-protocol "create"
        blocks must not silently clobber an existing file — that would
        conceal a plan mismatch between the LLM and the on-disk state.
        Opens with ``x`` mode so the creation and existence check are
        atomic from the perspective of this process.

        Parameters
        ----------
        path:
            Relative path to the new file.
        content:
            Initial content. Empty string by default — convenient for
            the "touch this file" case that sometimes appears in
            edit-protocol create blocks.

        Returns
        -------
        dict
            ``{"status": "ok"}`` on success.

        Raises
        ------
        RepoError
            If the path is invalid, the file already exists, or the
            write fails.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted  # type: ignore[return-value]
        absolute = self._validate_rel_path(path)
        lock = self._get_write_lock(path)
        async with lock:
            if absolute.exists():
                raise RepoError(f"File already exists: {path}")
            try:
                absolute.parent.mkdir(parents=True, exist_ok=True)
                # Use 'x' mode for atomic create-or-fail semantics.
                # Even though we checked existence above, another
                # process (or agent thread, once D10 is in play)
                # could have created the file in the intervening
                # microseconds.
                with absolute.open("x", encoding="utf-8") as fh:
                    fh.write(content)
            except FileExistsError as exc:
                raise RepoError(f"File already exists: {path}") from exc
            except OSError as exc:
                raise RepoError(f"Failed to create {path}: {exc}") from exc
        self._fire_post_write(path)
        return {"status": "ok"}

    async def delete_file(self, path: str | Path) -> dict[str, str]:
        """Delete a file from the working tree.

        Does NOT run ``git rm`` — this is a filesystem operation
        only. For tracked files, the next status check will report
        the file as deleted-but-unstaged; the user (or a subsequent
        ``stage_files`` call) stages the deletion explicitly. This
        mirrors how text-editor deletes behave and keeps the repo
        layer free of git-index side effects.

        Parameters
        ----------
        path:
            Relative path to the file.

        Returns
        -------
        dict
            ``{"status": "ok"}`` on success.

        Raises
        ------
        RepoError
            If the path is invalid, the file doesn't exist, or the
            path refers to a directory.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted  # type: ignore[return-value]
        absolute = self._validate_rel_path(path)
        lock = self._get_write_lock(path)
        async with lock:
            if not absolute.exists():
                raise RepoError(f"File not found: {path}")
            if absolute.is_dir():
                raise RepoError(
                    f"Path is a directory (use rename_directory for dirs): {path}"
                )
            try:
                absolute.unlink()
            except OSError as exc:
                raise RepoError(f"Failed to delete {path}: {exc}") from exc
            # Drop the lock entry — no further callers will contend on
            # this path until a new file is created under the same
            # name (which will create a fresh lock on demand).
            self._write_locks.pop(self._normalise_rel_path(path), None)
        return {"status": "ok"}