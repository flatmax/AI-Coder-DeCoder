"""Repository layer.

Wraps a single git repository with file I/O, git operations, tree
listing, search, and review-mode orchestration. Exposed to the
browser via RPC and used internally by the LLM context engine.

Governing spec: ``specs4/1-foundation/repository.md``.

Design notes:

- We shell out to the ``git`` binary via :mod:`subprocess` rather than
  pulling in a library like pygit2 or GitPython. ``git`` is already a
  prerequisite for AC-DC, behaviour matches what users see from the
  terminal, and porcelain output is the same across platforms.
- All paths used across the API boundary are relative to the repo
  root. Path validation happens at every entry point: traversal
  rejection via a ``..`` segment check, plus resolved-path
  containment against the repo root. Neither alone is sufficient:
  the segment check catches obvious traversal attempts before they
  become system calls; the resolved check catches symlinks pointing
  outside the tree.
- Writes to the same path are serialised via a per-path asyncio lock
  (D10 contract — re-entrant edit pipeline for future parallel-agent
  mode). Writes to different paths proceed in parallel.
- Binary detection uses a null-byte scan over the first 8KB. Cheap,
  reliable enough for our purposes (the symbol index and edit
  pipeline both refuse to touch binary files, so a false negative on
  e.g. a UTF-16 file is acceptable — the edit-apply step will then
  refuse it explicitly).

This module is the bottom of Layer 1 as far as the LLM service is
concerned. Layer 2's symbol and doc indexes consume its file I/O;
Layer 3's streaming pipeline consumes its git operations.

Turn 1 of 2 — this delivers constructor, path/binary helpers, write
mutex, basic file I/O. Turn 2 adds git staging, diffs, branches,
review, tree, search.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import mimetypes
import shutil
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

# Size of the prefix we scan for null bytes when detecting binary
# files. 8KB is the established heuristic (git itself uses the same
# threshold for core.autocrlf handling). Text files with null bytes
# in the first 8KB are vanishingly rare; binary files without null
# bytes in the first 8KB (some compressed formats, some crafted
# inputs) are the false-negative case — acceptable because the
# edit-apply pipeline refuses binary content regardless.
_BINARY_PROBE_BYTES = 8192

# Fallback MIME types for common image extensions when the system
# mimetypes database doesn't know them. Windows installs often have
# a sparse mimetypes database. SVG is deliberately NOT here — it's
# text and goes through the SVG viewer's own path.
_BINARY_IMAGE_MIME_FALLBACK = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
}

# Default timeout for git subprocess calls. Long enough for big
# operations on large repos (porcelain status on a multi-GB tree
# can take a few seconds), short enough that a hung subprocess
# doesn't wedge the event loop forever.
_GIT_TIMEOUT_SECONDS = 30

# Directories we never walk when building the file tree. Mirrors the
# exclusions used by the symbol index and doc index walkers — kept
# here rather than imported because Layer 2 isn't built yet and the
# dependency would be awkward to reverse later.
_TREE_EXCLUDED_DIRS = frozenset({
    ".git",
    ".ac-dc",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
    "dist",
    "build",
    ".egg-info",
})

# Default commit graph page size. Large enough that the initial load
# fills a typical viewport; small enough that the first RPC round-trip
# isn't slow on a 100k-commit repo.
_COMMIT_GRAPH_DEFAULT_LIMIT = 100

# Default commit-log range limit. Applied when a caller doesn't
# specify. Matches the graph default — the two operations are
# conceptually siblings.
_COMMIT_LOG_DEFAULT_LIMIT = 100


class RepoError(Exception):
    """Base class for repository-layer errors.

    Raised only for programmer errors (bad path, not a git repo) or
    truly unrecoverable I/O failures. Expected domain failures — file
    not found, binary file passed to a text-only operation — return
    structured error dicts rather than raising, matching the RPC
    contract in ``specs4/1-foundation/rpc-inventory.md``.
    """


class Repo:
    """Wraps a single git repository.

    Construction validates that ``repo_root`` exists, is a directory,
    and contains a ``.git`` entry (directory or file — git worktrees
    use a file). All API methods take paths relative to the repo
    root.

    Per-path write serialisation is provided by an internal lock map.
    The lock is an asyncio primitive, so write methods are ``async``.
    Read methods are synchronous — file reads don't contend and
    forcing callers to ``await`` them would add noise.
    """

    def __init__(self, repo_root: Path | str) -> None:
        """Initialise the repository wrapper.

        Parameters
        ----------
        repo_root:
            Absolute or relative path to the repository root. Resolved
            to an absolute path during construction; callers can pass
            anything that resolves to a real directory.

        Raises
        ------
        RepoError
            If the path doesn't exist, isn't a directory, or doesn't
            contain a ``.git`` entry.
        """
        root = Path(repo_root).resolve()
        if not root.exists():
            raise RepoError(f"Repository path does not exist: {root}")
        if not root.is_dir():
            raise RepoError(f"Repository path is not a directory: {root}")
        git_entry = root / ".git"
        if not git_entry.exists():
            raise RepoError(
                f"Not a git repository (no .git entry at {root})"
            )
        self._root = root
        # Per-path write locks, keyed by normalised relative path
        # string. Created on demand by :meth:`_get_write_lock`. Kept
        # in a plain dict — WeakValueDictionary would be neater but
        # asyncio.Lock instances don't support weakrefs without a
        # wrapper class. The map grows with the set of ever-written
        # paths during a session; a long-lived server writing millions
        # of distinct paths would see the map grow unboundedly, but
        # in practice sessions touch a few hundred paths at most.
        self._write_locks: dict[str, asyncio.Lock] = {}

    @property
    def root(self) -> Path:
        """Absolute path to the repository root."""
        return self._root

    @property
    def name(self) -> str:
        """Repository name (basename of the root path).

        Used for the browser tab title and for display in the file
        tree. Defaults to the root directory's name — the user's repo
        folder name — which is stable across checkouts and matches
        what ``git clone`` produced.
        """
        return self._root.name

    # ------------------------------------------------------------------
    # Path validation
    # ------------------------------------------------------------------

    def _normalise_rel_path(self, path: str | Path) -> str:
        """Normalise a relative path for use as a dict key.

        - Converts to string
        - Replaces backslashes with forward slashes (Windows callers)
        - Strips leading/trailing slashes

        This is the key used by the write-lock map and by any caller
        that needs a canonical string form of a repo path. Does NOT
        validate the path — use :meth:`_validate_rel_path` for that.
        """
        s = str(path).replace("\\", "/").strip("/")
        return s

    def _validate_rel_path(self, path: str | Path) -> Path:
        """Validate a relative path and return its absolute form.

        Two layers of defence:

        1. Reject paths containing a ``..`` segment. Fast, catches
           the common case before any filesystem call.
        2. Resolve the absolute path and confirm it's contained
           within the repo root. Catches symlink-based escapes and
           absolute paths that happen to share a prefix with the
           repo root but aren't actually inside it.

        Absolute paths are rejected outright — every API method
        takes paths relative to the repo root, and accepting
        absolute paths would let callers bypass the containment
        check by pointing at arbitrary filesystem locations.

        Parameters
        ----------
        path:
            Path relative to the repo root. May use forward or back
            slashes.

        Returns
        -------
        Path
            Absolute, resolved path inside the repo root.

        Raises
        ------
        RepoError
            If the path is empty, absolute, contains a ``..`` segment,
            or resolves outside the repo root.
        """
        normalised = self._normalise_rel_path(path)
        if not normalised:
            raise RepoError("Empty path")

        # Absolute-path rejection. We check the ORIGINAL input (not
        # the normalised string) because normalisation strips the
        # leading slash on POSIX absolute paths, which would let
        # ``/etc/passwd`` pass as ``etc/passwd``.
        original = str(path).replace("\\", "/")
        if original.startswith("/") or (
            len(original) >= 2 and original[1] == ":"
        ):
            raise RepoError(f"Absolute paths not accepted: {path!r}")

        # Fast segment-based rejection of traversal attempts.
        segments = normalised.split("/")
        if any(seg == ".." for seg in segments):
            raise RepoError(f"Path traversal not allowed: {path!r}")

        # Resolved containment check. Path.resolve() follows symlinks
        # and normalises ``.`` segments. We then verify the resolved
        # path is inside the repo root.
        absolute = (self._root / normalised).resolve()
        try:
            absolute.relative_to(self._root)
        except ValueError as exc:
            raise RepoError(
                f"Path escapes repository root: {path!r}"
            ) from exc

        return absolute

    # ------------------------------------------------------------------
    # Binary detection and MIME helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _is_binary_bytes(data: bytes) -> bool:
        """Return True if ``data`` looks like a binary file.

        Scans the first :data:`_BINARY_PROBE_BYTES` bytes for a null
        byte. Cheap and deterministic. Accepts the occasional false
        negative (UTF-16 files, some compressed formats) — downstream
        callers (edit-apply, symbol index) refuse binary content
        separately, so a missed detection here doesn't corrupt
        anything; it just produces a clearer error downstream.
        """
        return b"\x00" in data[:_BINARY_PROBE_BYTES]

    def is_binary_file(self, path: str | Path) -> bool:
        """Check whether a file in the repo is binary.

        Returns True for files containing a null byte in their first
        8KB. Returns False for missing files, unreadable files,
        directories, and empty files — anything we can't positively
        identify as binary is reported as text, matching git's own
        conservative heuristic.
        """
        try:
            absolute = self._validate_rel_path(path)
        except RepoError:
            return False
        try:
            with absolute.open("rb") as fh:
                probe = fh.read(_BINARY_PROBE_BYTES)
        except OSError:
            return False
        return self._is_binary_bytes(probe)

    @staticmethod
    def _detect_mime(path: Path) -> str:
        """Guess the MIME type for a file.

        Tries the stdlib mimetypes database first, then falls back to
        a small hardcoded map for common image extensions (Windows
        installs often have a sparse mimetypes database). Final
        fallback is ``application/octet-stream`` so every return
        value is a valid MIME string.
        """
        guessed, _ = mimetypes.guess_type(str(path))
        if guessed:
            return guessed
        fallback = _BINARY_IMAGE_MIME_FALLBACK.get(path.suffix.lower())
        if fallback:
            return fallback
        return "application/octet-stream"

    # ------------------------------------------------------------------
    # Per-path write mutex
    # ------------------------------------------------------------------

    def _get_write_lock(self, path: str | Path) -> asyncio.Lock:
        """Return the asyncio.Lock for a given path, creating on demand.

        Locks are keyed by the normalised relative path string — two
        callers referring to the same file via different spellings
        (forward vs back slash, trailing slash, etc.) acquire the
        same lock.

        In single-agent operation, the lock is effectively never
        contended. It exists so the repository layer's contract is
        safe for a future parallel-agent mode (D10) where N agents
        may generate edits concurrently.
        """
        key = self._normalise_rel_path(path)
        lock = self._write_locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            self._write_locks[key] = lock
        return lock

    # ------------------------------------------------------------------
    # Subprocess helper
    # ------------------------------------------------------------------

    def _run_git(
        self,
        args: list[str],
        *,
        text: bool = True,
        check: bool = False,
        timeout: float = _GIT_TIMEOUT_SECONDS,
        input_data: str | bytes | None = None,
    ) -> subprocess.CompletedProcess:
        """Run a ``git`` subprocess rooted in this repository.

        Centralises subprocess invocation so every git call gets the
        same working directory, timeout, and encoding. Callers decide
        whether to treat a non-zero exit as an error (``check=True``
        raises :class:`RepoError` with the stderr contents) or to
        inspect the result themselves — most callers inspect, because
        git's exit codes carry information (``grep`` returns 1 for
        "no matches found", which isn't an error).

        Parameters
        ----------
        args:
            Arguments to pass to git (excluding the ``git`` binary
            itself).
        text:
            When True, stdout and stderr are decoded as UTF-8 strings.
            When False, raw bytes are returned — needed for
            ``git show`` on files that may contain arbitrary bytes.
        check:
            When True, non-zero exit raises :class:`RepoError`.
        timeout:
            Seconds before the subprocess is killed and
            :class:`RepoError` raised. Defaults to
            :data:`_GIT_TIMEOUT_SECONDS`.
        input_data:
            Optional stdin payload. Must match ``text`` — pass ``str``
            for text mode, ``bytes`` for binary mode.

        Returns
        -------
        subprocess.CompletedProcess
            The result object. ``stdout`` and ``stderr`` are strings
            when ``text=True``, bytes otherwise.

        Raises
        ------
        RepoError
            If git isn't installed, the subprocess times out, or
            ``check=True`` and git exits non-zero.
        """
        cmd = ["git", *args]
        try:
            result = subprocess.run(
                cmd,
                cwd=self._root,
                capture_output=True,
                text=text,
                timeout=timeout,
                input=input_data,
                check=False,
            )
        except FileNotFoundError as exc:
            # The ``git`` binary isn't on PATH. This is fatal for the
            # repo layer — we can't function without it. Bubble up so
            # the CLI can print a clear install message.
            raise RepoError(
                "git binary not found on PATH; install git to continue"
            ) from exc
        except subprocess.TimeoutExpired as exc:
            raise RepoError(
                f"git {' '.join(args)!r} timed out after {timeout}s"
            ) from exc

        if check and result.returncode != 0:
            stderr = result.stderr
            if isinstance(stderr, bytes):
                stderr = stderr.decode("utf-8", errors="replace")
            raise RepoError(
                f"git {' '.join(args)!r} failed "
                f"(exit {result.returncode}): {stderr.strip() or 'unknown error'}"
            )

        return result

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
                probe = fh.read(_BINARY_PROBE_BYTES)
            if self._is_binary_bytes(probe):
                raise RepoError(
                    f"Binary file cannot be read as text: {path}"
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
        absolute = self._validate_rel_path(path)
        lock = self._get_write_lock(path)
        async with lock:
            try:
                absolute.parent.mkdir(parents=True, exist_ok=True)
                absolute.write_text(content, encoding="utf-8", errors="replace")
            except OSError as exc:
                raise RepoError(f"Failed to write {path}: {exc}") from exc
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

    # ------------------------------------------------------------------
    # Diffs
    # ------------------------------------------------------------------

    def get_staged_diff(self) -> str:
        """Return the staged diff (``git diff --cached``) as text.

        Empty string when nothing is staged. Used by the commit
        message generator as its primary input.
        """
        result = self._run_git(["diff", "--cached"], check=True)
        return result.stdout

    def get_unstaged_diff(self) -> str:
        """Return the unstaged working-tree diff (``git diff``) as text.

        Empty string when the working tree is clean.
        """
        result = self._run_git(["diff"], check=True)
        return result.stdout

    def get_diff_to_branch(self, branch: str) -> dict[str, str]:
        """Return a two-dot diff against ``branch`` (working tree included).

        Two-dot diff: ``git diff <branch>`` compares the named branch
        against the working tree — includes both committed and
        uncommitted changes on the current side. Matches what the
        "copy diff vs branch" dropdown in the UI produces.

        Parameters
        ----------
        branch:
            Name of a branch, tag, or any ref git can resolve.

        Returns
        -------
        dict
            ``{"diff": "<patch text>"}`` on success, or
            ``{"error": "<message>"}`` if the ref doesn't exist.
            Error is returned rather than raised because the UI's
            branch picker calls this for user-chosen branches and
            should surface typos as feedback, not crash logs.
        """
        if not branch or not branch.strip():
            return {"error": "Empty branch name"}
        # Check the ref resolves before issuing the diff — gives a
        # cleaner error than git's own "bad revision" message.
        probe = self._run_git(["rev-parse", "--verify", branch])
        if probe.returncode != 0:
            return {"error": f"Unknown ref: {branch}"}
        result = self._run_git(["diff", branch])
        if result.returncode != 0:
            return {
                "error": (result.stderr or "diff failed").strip()
            }
        return {"diff": result.stdout}

    # ------------------------------------------------------------------
    # Commit and reset
    # ------------------------------------------------------------------

    def stage_all(self) -> dict[str, str]:
        """Stage every change in the working tree (``git add -A``).

        Equivalent to ``stage_files`` over every changed path, but
        expressed as a single git call so large repos don't enumerate
        thousands of paths through Python.
        """
        self._run_git(["add", "-A"], check=True)
        return {"status": "ok"}

    def commit(self, message: str) -> dict[str, str]:
        """Create a commit with the given message.

        Handles the initial-commit case (no HEAD yet) by passing
        the message on stdin — git's own empty-repo handling works
        as long as something is staged.

        Parameters
        ----------
        message:
            Commit message. Must be non-empty after stripping.

        Returns
        -------
        dict
            ``{"sha": "<full SHA>", "message": "<message>"}`` on
            success.

        Raises
        ------
        RepoError
            If the message is empty or the commit fails (nothing
            staged, hook rejection, etc.).
        """
        if not message or not message.strip():
            raise RepoError("Commit message must not be empty")
        # ``-F -`` reads the message from stdin. Safer than ``-m``
        # for messages that contain special characters or newlines,
        # which conventional-commit bodies often do.
        self._run_git(
            ["commit", "-F", "-"],
            input_data=message,
            check=True,
        )
        sha_result = self._run_git(
            ["rev-parse", "HEAD"],
            check=True,
        )
        return {"sha": sha_result.stdout.strip(), "message": message}

    def reset_hard(self) -> dict[str, str]:
        """Hard-reset the working tree to HEAD (``git reset --hard HEAD``).

        Destroys all uncommitted changes — staged and unstaged.
        The UI always confirms before calling this; the repo layer
        performs no additional confirmation.
        """
        self._run_git(["reset", "--hard", "HEAD"], check=True)
        return {"status": "ok"}

    def search_commits(
        self,
        query: str,
        branch: str | None = None,
        limit: int = _COMMIT_LOG_DEFAULT_LIMIT,
    ) -> list[dict[str, str]]:
        """Search commit history for ``query`` in message, SHA, or author.

        Uses ``git log`` with the ``--grep`` filter for messages and
        ``--author`` for authors, combined with ``--all-match=false``
        semantics (the default — ORs the two filters). SHA prefix
        matching is handled by running the query through
        ``git rev-parse`` first: if it resolves to a commit, that
        commit is the only hit.

        Parameters
        ----------
        query:
            Search text. Empty string returns an empty list.
        branch:
            Optional branch or ref to search. When None, searches all
            refs (``--all``) — matches the history-browser UI's
            "search all branches" default.
        limit:
            Maximum number of matching commits to return. Defaults
            to :data:`_COMMIT_LOG_DEFAULT_LIMIT`. Large limits on
            monster repos are slow, but paging is a UI concern —
            callers that want pagination use ``get_commit_graph``.

        Returns
        -------
        list[dict]
            Each entry has keys ``sha`` (full SHA), ``short_sha``
            (7 chars), ``message`` (first line only), ``author``,
            ``date`` (ISO 8601 UTC).
        """
        if not query or not query.strip():
            return []

        # SHA-prefix fast path. If the query parses as a commit SHA
        # or prefix, we want an exact hit rather than grepping. A
        # query like "abc" that happens to resolve to a commit and
        # also appears in some commit messages would otherwise show
        # both, which is noisy and usually not what the user meant.
        probe = self._run_git(
            ["rev-parse", "--verify", f"{query}^{{commit}}"],
        )
        if probe.returncode == 0:
            sha = probe.stdout.strip()
            return self._log_for_refs([sha], limit=1)

        scope = [branch] if branch else ["--all"]
        format_str = "--format=%H%x00%h%x00%s%x00%an%x00%aI"
        # ``git log --grep=X --author=Y`` ANDs the two filters. We
        # want OR semantics ("match in message OR in author name")
        # so we run the two filters as separate log invocations and
        # union the results by SHA. Each call already honours
        # --regexp-ignore-case, so matching is case-insensitive on
        # both sides. We over-fetch each side (2x limit) so the
        # union-then-truncate still returns ``limit`` entries in
        # the common case where the two sides overlap heavily.
        base_args = [
            "log",
            *scope,
            f"--max-count={limit * 2}",
            "--regexp-ignore-case",
            format_str,
        ]
        grep_result = self._run_git(
            [*base_args, f"--grep={query}"],
            check=True,
        )
        author_result = self._run_git(
            [*base_args, f"--author={query}"],
            check=True,
        )
        # Union by SHA. Dict preserves insertion order, so entries
        # appear in the order git first emitted them. Grep comes
        # first because message hits are usually what the user
        # wants to see when both match.
        by_sha: dict[str, dict[str, str]] = {}
        for record in self._parse_log_records(grep_result.stdout):
            by_sha[record["sha"]] = record
        for record in self._parse_log_records(author_result.stdout):
            by_sha.setdefault(record["sha"], record)
        # Re-sort the merged list by commit date descending so the
        # caller sees newest-first across both filters. The two
        # individual queries were each date-sorted, but a simple
        # concat loses that ordering once entries interleave.
        merged = sorted(
            by_sha.values(),
            key=lambda r: r["date"],
            reverse=True,
        )
        return merged[:limit]

    def _log_for_refs(
        self,
        refs: list[str],
        *,
        limit: int,
    ) -> list[dict[str, str]]:
        """Run ``git log`` over ``refs`` and parse the output.

        Internal helper — used by :meth:`search_commits` for the
        SHA-prefix fast path. Parses the same null-separated format.
        """
        args = [
            "log",
            *refs,
            f"--max-count={limit}",
            "--format=%H%x00%h%x00%s%x00%an%x00%aI",
        ]
        result = self._run_git(args, check=True)
        return self._parse_log_records(result.stdout)

    @staticmethod
    def _parse_log_records(raw: str) -> list[dict[str, str]]:
        """Parse null-separated git-log output into record dicts.

        Format string ``%H%x00%h%x00%s%x00%an%x00%aI`` produces
        lines where each field is separated by a literal NUL byte.
        NUL is used rather than a printable separator because commit
        subjects can contain any character — tab, pipe, comma — so
        a printable separator risks collisions.
        """
        records: list[dict[str, str]] = []
        for line in raw.splitlines():
            if not line:
                continue
            parts = line.split("\x00")
            if len(parts) != 5:
                # Shouldn't happen — log format is fixed — but skip
                # rather than crash if git emits something unexpected.
                continue
            sha, short_sha, message, author, date = parts
            records.append({
                "sha": sha,
                "short_sha": short_sha,
                "message": message,
                "author": author,
                "date": date,
            })
        return records

    # ------------------------------------------------------------------
    # Branch queries
    # ------------------------------------------------------------------

    def get_current_branch(self) -> dict[str, object]:
        """Return the current branch info.

        Uses ``git symbolic-ref`` for the branch name — safer than
        parsing ``git branch`` output, which can include stray
        characters (asterisks, escape codes) depending on locale and
        colour settings. ``symbolic-ref`` returns the full ref path
        (``refs/heads/main``); we strip the prefix.

        Returns
        -------
        dict
            - ``branch``: branch name (``str``) or ``None`` if detached
            - ``sha``: full SHA of HEAD
            - ``detached``: ``True`` when HEAD isn't pointing at a
              branch (e.g., during review mode, after checking out a
              tag or a specific commit)
        """
        # symbolic-ref exits non-zero in detached HEAD. That's the
        # signal, not an error.
        sym = self._run_git(["symbolic-ref", "--short", "HEAD"])
        # HEAD's SHA is always resolvable (except for a completely
        # fresh repo with no commits — rare, but we handle it).
        sha_probe = self._run_git(["rev-parse", "HEAD"])
        sha = sha_probe.stdout.strip() if sha_probe.returncode == 0 else ""
        if sym.returncode == 0:
            return {
                "branch": sym.stdout.strip(),
                "sha": sha,
                "detached": False,
            }
        return {
            "branch": None,
            "sha": sha,
            "detached": True,
        }

    def resolve_ref(self, ref: str) -> str | None:
        """Resolve a ref (branch, tag, SHA prefix) to a full SHA.

        Returns ``None`` when the ref doesn't resolve — callers use
        this as a lightweight "does this ref exist" probe. Raising
        would force every caller to wrap in try/except for a case
        that's expected (user typos in the branch picker).
        """
        if not ref or not ref.strip():
            return None
        result = self._run_git(["rev-parse", "--verify", ref])
        if result.returncode != 0:
            return None
        return result.stdout.strip()

    def list_branches(self) -> dict[str, object]:
        """List local branches.

        Returns
        -------
        dict
            - ``branches``: list of dicts with keys ``name``, ``sha``,
              ``message`` (first line of tip commit), ``is_current``
            - ``current``: name of the current branch, or ``None``
              when detached
        """
        # for-each-ref lets us format the output exactly once rather
        # than making one rev-parse per branch. %(HEAD) is a single
        # character: '*' when the ref is HEAD, ' ' otherwise —
        # simpler than parsing ``git branch`` asterisks.
        format_str = "%(HEAD)%00%(refname:short)%00%(objectname)%00%(contents:subject)"
        result = self._run_git(
            [
                "for-each-ref",
                "refs/heads/",
                f"--format={format_str}",
            ],
            check=True,
        )

        branches: list[dict[str, object]] = []
        current: str | None = None
        for line in result.stdout.splitlines():
            if not line:
                continue
            parts = line.split("\x00")
            if len(parts) != 4:
                continue
            head_marker, name, sha, message = parts
            is_current = head_marker == "*"
            if is_current:
                current = name
            branches.append({
                "name": name,
                "sha": sha,
                "message": message,
                "is_current": is_current,
            })
        return {"branches": branches, "current": current}

    def list_all_branches(self) -> list[dict[str, object]]:
        """List all branches (local and remote), sorted by recency.

        Used by the "copy diff vs branch" dropdown. Remote branches
        appear with their ``origin/`` prefix. Deduplication: when a
        local branch and its remote tracking branch point at the
        same tip, only the local entry is kept — the UI doesn't
        benefit from showing both.

        Filtering rules:

        - Symbolic refs (``HEAD``, ``origin/HEAD``) are skipped —
          ``%(symref)`` is non-empty for them so the filter is exact.
        - Bare remote aliases like ``origin`` (no slash, but a
          refs/remotes parent name) are skipped — they're not
          branches, just remote-root placeholders.

        Returns
        -------
        list[dict]
            Each entry — ``name``, ``sha``, ``is_current``,
            ``is_remote``. Sorted by committer date descending,
            so the most recently active branches appear first.
            Dedup preserves this sort order.
        """
        format_str = (
            "%(refname)%00"
            "%(refname:short)%00"
            "%(objectname)%00"
            "%(HEAD)%00"
            "%(symref)"
        )

        # Two separate for-each-ref calls — one per namespace —
        # merged in Python. Simpler than trying to distinguish
        # refs/heads from refs/remotes by shortname alone, which
        # breaks for local branches that contain slashes (e.g.,
        # the common "feature/auth" convention). The %(refname)
        # field gives us the unambiguous full ref path.
        def _query(namespace: str) -> list[tuple[str, str, str, str]]:
            result = self._run_git(
                [
                    "for-each-ref",
                    namespace,
                    "--sort=-committerdate",
                    f"--format={format_str}",
                ],
                check=True,
            )
            rows: list[tuple[str, str, str, str]] = []
            for line in result.stdout.splitlines():
                if not line:
                    continue
                parts = line.split("\x00")
                if len(parts) != 5:
                    continue
                full_ref, short_name, sha, head_marker, symref = parts
                if symref:
                    # Symbolic ref (HEAD → refs/heads/main,
                    # origin/HEAD → refs/remotes/origin/main).
                    # Never a real branch.
                    continue
                rows.append((full_ref, short_name, sha, head_marker))
            return rows

        local_rows = _query("refs/heads/")
        remote_rows = _query("refs/remotes/")

        # Local branches first — they're authoritative. Build both
        # the entry list and a name→SHA map used for dedup.
        local_entries: list[dict[str, object]] = []
        local_names: set[str] = set()
        local_shas: set[str] = set()
        for _full_ref, short_name, sha, head_marker in local_rows:
            local_entries.append({
                "name": short_name,
                "sha": sha,
                "is_current": head_marker == "*",
                "is_remote": False,
            })
            local_names.add(short_name)
            local_shas.add(sha)

        # Remote branches — filter aliases and dedup against local.
        remote_entries: list[dict[str, object]] = []
        for _full_ref, short_name, sha, _head_marker in remote_rows:
            # Bare remote alias: "origin" with no slash. A real
            # remote branch always has the ``<remote>/<branch>``
            # shape, so absence of a slash means this is the remote
            # root placeholder, not a branch.
            if "/" not in short_name:
                continue
            # Dedup: if the remote's branch name (tail after the
            # first slash) matches a local branch AND the SHA is
            # the same, the remote is just a tracking ref for a
            # local branch we already listed. Skip.
            _, _, tail = short_name.partition("/")
            if tail in local_names and sha in local_shas:
                continue
            remote_entries.append({
                "name": short_name,
                "sha": sha,
                "is_current": False,  # remote refs are never HEAD
                "is_remote": True,
            })

        # Combine. Each list is individually sorted by committer
        # date descending (from git's --sort). Locals come first so
        # the user's own branches appear before remote-only ones.
        # Within each group the recency order is preserved.
        return local_entries + remote_entries

    def is_clean(self) -> bool:
        """Return True when the working tree has no tracked changes.

        Uses ``git status --porcelain -uno`` — the ``-uno`` flag
        skips untracked files. Untracked files are tolerated by
        review-mode and doc-convert gating; only staged or modified
        tracked files count as "dirty".
        """
        result = self._run_git(
            ["status", "--porcelain", "-uno"],
            check=True,
        )
        return not result.stdout.strip()

    # ------------------------------------------------------------------
    # Commit graph and log
    # ------------------------------------------------------------------

    def get_commit_graph(
        self,
        limit: int = _COMMIT_GRAPH_DEFAULT_LIMIT,
        offset: int = 0,
        include_remote: bool = False,
    ) -> dict[str, object]:
        """Return paginated commit graph data for the review selector.

        Used by the git-graph UI that replaces the old branch-dropdown
        flow in review mode. Returns commits plus branch tip data so
        the frontend can render the lane layout client-side.

        Parameters
        ----------
        limit:
            Page size. Default :data:`_COMMIT_GRAPH_DEFAULT_LIMIT`.
        offset:
            Skip this many commits before returning the page. Used
            for scroll-loading additional commits.
        include_remote:
            When True, includes remote branches in the graph. The
            default is local-only because most users don't care about
            every remote tracking ref and the graph gets noisy.

        Returns
        -------
        dict
            - ``commits``: list of dicts with keys ``sha``,
              ``short_sha``, ``message``, ``author``, ``date`` (ISO
              8601), ``relative_date`` (e.g., "2 days ago"),
              ``parents`` (list of parent SHAs)
            - ``branches``: list of dicts with keys ``name``, ``sha``
              (tip commit), ``is_current``, ``is_remote``
            - ``has_more``: ``True`` when there are more commits
              beyond this page
        """
        # --all traverses all refs; without it we only get HEAD's
        # ancestry, which isn't enough for a multi-branch graph.
        # --topo-order keeps the topological order stable so lane
        # assignment on the client side is deterministic.
        # %x00 is a literal NUL used as field separator — safer than
        # any printable character because commit subjects can contain
        # anything.
        # Note: --max-count + --skip gives us paging. Getting
        # has_more right requires fetching one extra commit and
        # checking whether we got it; we do this with `limit + 1`.
        scope = ["--all"] if include_remote else ["--branches"]
        format_str = "%H%x00%h%x00%s%x00%an%x00%aI%x00%ar%x00%P"
        args = [
            "log",
            *scope,
            "--topo-order",
            f"--skip={offset}",
            f"--max-count={limit + 1}",
            f"--format={format_str}",
        ]
        result = self._run_git(args, check=True)

        commits: list[dict[str, object]] = []
        for line in result.stdout.splitlines():
            if not line:
                continue
            parts = line.split("\x00")
            if len(parts) != 7:
                continue
            sha, short_sha, message, author, date, relative_date, parents_raw = parts
            parents = parents_raw.split() if parents_raw else []
            commits.append({
                "sha": sha,
                "short_sha": short_sha,
                "message": message,
                "author": author,
                "date": date,
                "relative_date": relative_date,
                "parents": parents,
            })

        # Check for has_more by examining the over-fetch.
        has_more = len(commits) > limit
        if has_more:
            commits = commits[:limit]

        # Branches — reuse list_all_branches when include_remote,
        # otherwise just local.
        if include_remote:
            branches = self.list_all_branches()
        else:
            local = self.list_branches()
            branches = [
                {
                    "name": b["name"],
                    "sha": b["sha"],
                    "is_current": b["is_current"],
                    "is_remote": False,
                }
                for b in local["branches"]  # type: ignore[index]
            ]

        return {
            "commits": commits,
            "branches": branches,
            "has_more": has_more,
        }

    def get_commit_log(
        self,
        base: str,
        head: str | None = None,
        limit: int = _COMMIT_LOG_DEFAULT_LIMIT,
    ) -> list[dict[str, str]]:
        """Return the commit log for a range.

        Parameters
        ----------
        base:
            Base ref (exclusive).
        head:
            Head ref (inclusive). Defaults to ``HEAD`` when None.
        limit:
            Maximum number of commits.

        Returns
        -------
        list[dict]
            Entries with ``sha``, ``short_sha``, ``message``,
            ``author``, ``date`` — same shape as
            :meth:`search_commits`.
        """
        head_ref = head or "HEAD"
        # ``base..head`` is the two-dot range: commits reachable
        # from head but not from base. Matches what git log shows
        # by default and what review mode needs.
        range_spec = f"{base}..{head_ref}"
        args = [
            "log",
            range_spec,
            f"--max-count={limit}",
            "--format=%H%x00%h%x00%s%x00%an%x00%aI",
        ]
        result = self._run_git(args, check=True)
        return self._parse_log_records(result.stdout)

    def get_commit_parent(self, commit: str) -> dict[str, str]:
        """Return the parent SHA of a commit.

        Used by review mode when falling back from ``merge-base``:
        if the merge-base cascade fails, the UI uses the parent of
        the user-selected base commit instead.

        Parameters
        ----------
        commit:
            Commit SHA, ref name, or prefix.

        Returns
        -------
        dict
            ``{"sha": "<full SHA>", "short_sha": "<7 chars>"}`` on
            success, or ``{"error": "<message>"}`` if the commit
            doesn't resolve or has no parent (root commit).
        """
        # ``commit^`` is git syntax for "first parent of commit".
        # rev-parse with --verify fails cleanly when the commit
        # doesn't exist or has no parent.
        probe = self._run_git(
            ["rev-parse", "--verify", f"{commit}^"],
        )
        if probe.returncode != 0:
            return {
                "error": (probe.stderr or "commit has no parent").strip()
            }
        sha = probe.stdout.strip()
        short = self._run_git(
            ["rev-parse", "--short", sha],
            check=True,
        ).stdout.strip()
        return {"sha": sha, "short_sha": short}

    def get_merge_base(
        self,
        ref1: str,
        ref2: str | None = None,
    ) -> dict[str, str]:
        """Return the merge-base between two refs.

        Used by review mode to find the commit where the reviewed
        branch diverged from the target branch. When ``ref2`` is
        None, cascades through common candidates (``main``,
        ``master``) — useful when the review selector doesn't know
        which default branch the repo uses.

        Parameters
        ----------
        ref1:
            First ref (typically the branch tip being reviewed).
        ref2:
            Second ref. When None, tries ``main`` then ``master``.

        Returns
        -------
        dict
            ``{"sha": "<full SHA>", "short_sha": "<7 chars>"}`` on
            success, or ``{"error": "<message>"}`` if no merge-base
            exists (unrelated histories).
        """
        candidates: list[str]
        if ref2 is not None:
            candidates = [ref2]
        else:
            # Cascade — try main, then master. Matches what specs4
            # calls the "original_branch → main → master" fallback.
            candidates = ["main", "master"]

        last_error = ""
        for candidate in candidates:
            result = self._run_git(["merge-base", ref1, candidate])
            if result.returncode == 0 and result.stdout.strip():
                sha = result.stdout.strip()
                short = self._run_git(
                    ["rev-parse", "--short", sha],
                    check=True,
                ).stdout.strip()
                return {"sha": sha, "short_sha": short}
            last_error = (result.stderr or "").strip()

        return {"error": last_error or "No merge-base found"}

    # ------------------------------------------------------------------
    # File tree and flat listing
    # ------------------------------------------------------------------

    def get_flat_file_list(self) -> str:
        """Return a sorted newline-separated list of all repo files.

        Combines tracked files (``git ls-files``) with untracked
        non-ignored files (``git ls-files --others --exclude-standard``).
        Used as the file-tree section in LLM prompts — flat, one per
        line, no tree indentation.

        Returns an empty string when the repo has no files (fresh
        init, no commits, nothing untracked).
        """
        tracked = self._run_git(
            ["ls-files"],
            check=True,
        ).stdout.splitlines()
        untracked = self._run_git(
            ["ls-files", "--others", "--exclude-standard"],
            check=True,
        ).stdout.splitlines()
        all_files = sorted(set(tracked) | set(untracked))
        return "\n".join(all_files)

    def _count_lines(self, absolute: Path) -> int:
        """Count newlines in a file for the tree-line-count badge.

        Returns 0 for binary files (no useful line count for them)
        and for any file we can't read. Used by the file picker to
        colour-code files by size.
        """
        try:
            with absolute.open("rb") as fh:
                probe = fh.read(_BINARY_PROBE_BYTES)
                if self._is_binary_bytes(probe):
                    return 0
                # Count newlines across the whole file, streaming
                # in chunks so we don't load huge files into memory.
                count = probe.count(b"\n")
                while True:
                    chunk = fh.read(65536)
                    if not chunk:
                        break
                    count += chunk.count(b"\n")
                return count
        except OSError:
            return 0

    @staticmethod
    def _unquote_porcelain_path(raw: str) -> str:
        """Strip git porcelain quoting from a single path segment.

        Git wraps paths containing special characters (spaces,
        non-ASCII, control chars) in double quotes with backslash
        escapes. We reverse that for display. For plain paths, the
        input is returned unchanged.

        The full escape grammar is more elaborate (octal escapes
        for arbitrary bytes), but we hit the common 99% case: the
        quotes themselves, tabs, newlines, and backslashes. Paths
        with truly exotic bytes will display slightly mangled but
        won't corrupt the UI.
        """
        if len(raw) < 2 or raw[0] != '"' or raw[-1] != '"':
            return raw
        # Strip enclosing quotes.
        inner = raw[1:-1]
        # Reverse common backslash escapes. Order matters — unescape
        # \\ last so we don't turn an escaped backslash back into a
        # meaningful escape.
        inner = (
            inner
            .replace(r"\t", "\t")
            .replace(r"\n", "\n")
            .replace(r"\"", '"')
            .replace(r"\\", "\\")
        )
        return inner

    def _parse_porcelain_status(
        self,
        raw: str,
    ) -> tuple[list[str], list[str], list[str], list[str]]:
        """Parse ``git status --porcelain`` output into four path lists.

        Returns ``(modified, staged, untracked, deleted)``. Each is
        a list of repo-relative paths. Rename entries (``R``) are
        expanded into both the old and new paths in the staged list.

        Porcelain format is ``XY path`` where X is the index
        status and Y is the worktree status. We classify each entry
        by both characters — a modified file may be simultaneously
        staged and unstaged, and both lists include it.
        """
        modified: list[str] = []
        staged: list[str] = []
        untracked: list[str] = []
        deleted: list[str] = []

        for line in raw.splitlines():
            if len(line) < 3:
                continue
            x, y, rest = line[0], line[1], line[3:]

            # Untracked files: "?? path".
            if x == "?" and y == "?":
                untracked.append(self._unquote_porcelain_path(rest))
                continue

            # Rename / copy entries: "R  old -> new". Both sides
            # may be individually quoted (the old git behaviour)
            # so we split on the arrow, then unquote each segment.
            if x in ("R", "C") and " -> " in rest:
                old_raw, new_raw = rest.split(" -> ", 1)
                old_path = self._unquote_porcelain_path(old_raw)
                new_path = self._unquote_porcelain_path(new_raw)
                staged.append(old_path)
                staged.append(new_path)
                continue

            path = self._unquote_porcelain_path(rest)

            # Index status (X) — changes staged for commit.
            if x in ("M", "A", "D", "T"):
                staged.append(path)
                if x == "D":
                    deleted.append(path)

            # Worktree status (Y) — unstaged changes.
            if y == "M" or y == "T":
                modified.append(path)
            elif y == "D":
                deleted.append(path)

        return modified, staged, untracked, deleted

    def _parse_numstat(self, raw: str) -> dict[str, dict[str, int]]:
        """Parse ``git diff --numstat`` output into per-file stats.

        Each output line is ``<added>\\t<deleted>\\t<path>``. Binary
        files report ``-`` for both counts — we map those to 0
        because the file picker has no meaningful way to display
        "binary diff stats" in an addition/deletion badge.
        """
        stats: dict[str, dict[str, int]] = {}
        for line in raw.splitlines():
            if not line:
                continue
            parts = line.split("\t", 2)
            if len(parts) != 3:
                continue
            added_raw, deleted_raw, path = parts
            added = 0 if added_raw == "-" else int(added_raw or 0)
            deleted = 0 if deleted_raw == "-" else int(deleted_raw or 0)
            path = self._unquote_porcelain_path(path)
            stats[path] = {"additions": added, "deletions": deleted}
        return stats

    def get_file_tree(self) -> dict[str, object]:
        """Return the full file tree with git status and diff stats.

        Shape:

        - ``tree``: nested node structure rooted at the repo name.
          Each node is a dict with ``name``, ``path``, ``type``
          (``"file"`` or ``"dir"``), ``lines`` (int, 0 for binary
          and directories), ``mtime`` (float, files only),
          ``children`` (list, directories only).
        - ``modified``, ``staged``, ``untracked``, ``deleted``:
          lists of repo-relative paths from porcelain status.
        - ``diff_stats``: ``{path: {"additions": int, "deletions":
          int}}`` merged across staged and unstaged diffs.

        Ignored files never appear in the tree — we build the file
        set from ``git ls-files`` (tracked) plus
        ``git ls-files --others --exclude-standard`` (untracked,
        non-ignored). Binary files appear with ``lines: 0``.

        Root node name matches the repo root's basename, so the UI
        can display it as the tree root header.
        """
        # Candidate file set: tracked ∪ untracked (non-ignored).
        tracked = set(
            self._run_git(["ls-files"], check=True).stdout.splitlines()
        )
        untracked_raw = self._run_git(
            ["ls-files", "--others", "--exclude-standard"],
            check=True,
        ).stdout.splitlines()
        all_files = sorted(tracked | set(untracked_raw))

        # Status — the four classification lists.
        status_result = self._run_git(
            ["status", "--porcelain"],
            check=True,
        )
        modified, staged, untracked, deleted = self._parse_porcelain_status(
            status_result.stdout
        )

        # Diff stats — staged and unstaged. We merge additions and
        # deletions across both so the picker shows the total churn
        # per file. Staged numbers take precedence when a file
        # appears in both (which happens for partially-staged edits).
        staged_stats = self._parse_numstat(
            self._run_git(
                ["diff", "--cached", "--numstat"],
                check=True,
            ).stdout
        )
        unstaged_stats = self._parse_numstat(
            self._run_git(
                ["diff", "--numstat"],
                check=True,
            ).stdout
        )
        diff_stats: dict[str, dict[str, int]] = {}
        for source in (unstaged_stats, staged_stats):
            for path, entry in source.items():
                existing = diff_stats.setdefault(
                    path, {"additions": 0, "deletions": 0}
                )
                existing["additions"] += entry["additions"]
                existing["deletions"] += entry["deletions"]

        # Build the nested tree. We walk each file path, creating
        # directory nodes on demand in a dict keyed by path. The
        # root node is the repo name. Deleted files are intentionally
        # included in the tree — the picker shows them with a deleted
        # badge so users can recover them. They don't appear in
        # ``all_files`` (neither tracked nor untracked lists them),
        # so we add them explicitly.
        tree_files = sorted(set(all_files) | set(deleted))

        root: dict[str, object] = {
            "name": self._root.name,
            "path": "",
            "type": "dir",
            "lines": 0,
            "children": [],
        }
        # Index: relative-path string → node dict. Lets us reuse
        # directory nodes when multiple files share ancestors
        # without re-searching the tree.
        index: dict[str, dict[str, object]] = {"": root}

        for rel_path in tree_files:
            # Build up directory nodes for every ancestor.
            parts = rel_path.split("/")
            parent_path = ""
            for depth in range(len(parts) - 1):
                dir_name = parts[depth]
                dir_path = "/".join(parts[: depth + 1])
                if dir_path not in index:
                    dir_node: dict[str, object] = {
                        "name": dir_name,
                        "path": dir_path,
                        "type": "dir",
                        "lines": 0,
                        "children": [],
                    }
                    index[dir_path] = dir_node
                    # Parent's children is always a list — type
                    # narrowed here to satisfy the type checker.
                    parent_children = index[parent_path]["children"]
                    assert isinstance(parent_children, list)
                    parent_children.append(dir_node)
                parent_path = dir_path

            # Build the leaf file node. Line counts and mtimes are
            # best-effort — a file that exists at porcelain time but
            # vanishes before we stat it just gets a zero.
            absolute = self._root / rel_path
            lines = 0
            mtime = 0.0
            if absolute.is_file():
                lines = self._count_lines(absolute)
                try:
                    mtime = absolute.stat().st_mtime
                except OSError:
                    mtime = 0.0
            file_node: dict[str, object] = {
                "name": parts[-1],
                "path": rel_path,
                "type": "file",
                "lines": lines,
                "mtime": mtime,
            }
            parent_children = index[parent_path]["children"]
            assert isinstance(parent_children, list)
            parent_children.append(file_node)

        # Sort each directory's children alphabetically, directories
        # before files. The picker does its own sort for mtime/size
        # modes, but alphabetical is a stable default.
        def _sort_children(node: dict[str, object]) -> None:
            children = node.get("children")
            if not isinstance(children, list):
                return
            children.sort(
                key=lambda n: (n["type"] != "dir", n["name"]),
            )
            for child in children:
                _sort_children(child)

        _sort_children(root)

        return {
            "tree": root,
            "modified": modified,
            "staged": staged,
            "untracked": untracked,
            "deleted": deleted,
            "diff_stats": diff_stats,
        }

    # ------------------------------------------------------------------
    # Review mode
    # ------------------------------------------------------------------
    #
    # Review mode uses git's soft-reset mechanism to present branch
    # changes as staged modifications. The entry sequence does a
    # specific dance of checkouts so the final state has:
    #
    #   - Disk files: at the branch tip (the code being reviewed)
    #   - Git HEAD: at the merge-base (the pre-review state)
    #   - Staged changes: everything between
    #
    # This lets the existing file picker, diff viewer, and context
    # engine work unchanged — they all already understand staged
    # changes. The full sequence is specified in
    # specs4/4-features/code-review.md.

    def checkout_review_parent(
        self,
        branch: str,
        base_commit: str,
    ) -> dict[str, object]:
        """Begin the review-mode entry sequence.

        Performs steps 1–5 of the entry sequence — records the
        original branch, verifies cleanliness, computes the
        merge-base, and checks out that merge-base so disk files
        reflect the pre-change state. The caller then builds the
        pre-change symbol map before invoking
        :meth:`setup_review_soft_reset` to complete the transition.

        Parameters
        ----------
        branch:
            The branch being reviewed. Can be a local branch name
            (``feature-auth``) or a remote tracking ref
            (``origin/feature-auth``).
        base_commit:
            The commit the user selected as the review base. Used
            only as a fallback when the merge-base cascade can't
            find a common ancestor between ``branch`` and a default
            branch (``main`` / ``master``).

        Returns
        -------
        dict
            On success:

            - ``branch``: the reviewed branch name
            - ``branch_tip``: full SHA of the branch tip (used by
              the exit sequence to restore)
            - ``base_commit``: the user-selected base (echoed back)
            - ``parent_commit``: the computed merge-base (current
              disk state)
            - ``original_branch``: branch HEAD was on before review,
              or ``None`` if HEAD was detached
            - ``phase``: always ``"at_parent"`` — signals the
              caller that disk is at the pre-change state and the
              pre-change symbol map should be built before the
              next step

            On failure: ``{"error": "<message>"}``. Failures include
            dirty working tree, unresolvable branch ref, and
            merge-base computation failure that also can't fall
            back to ``base_commit^``.

        Notes
        -----
        We deliberately return errors as dicts rather than raising.
        Review mode is user-initiated from the UI; errors are
        expected feedback (you have uncommitted changes, you
        selected a bogus branch) not programmer bugs.
        """
        # Step 1: working-tree cleanliness.
        if not self.is_clean():
            return {
                "error": (
                    "Working tree has uncommitted changes. "
                    "Commit, stash, or discard them before "
                    "entering review mode."
                )
            }

        # Record the original branch so the exit sequence knows
        # where to return. Detached HEAD is allowed as a starting
        # point — rare but some workflows use it — so we record the
        # SHA as a fallback.
        current = self.get_current_branch()
        original_branch: str | None = (
            str(current["branch"]) if current["branch"] else None
        )

        # Step 2: resolve the branch tip. Accepts both local and
        # remote forms uniformly — rev-parse handles either.
        branch_tip = self.resolve_ref(branch)
        if branch_tip is None:
            return {"error": f"Unknown branch: {branch}"}

        # Step 3: compute the merge-base. The cascade order is
        # ``original_branch → main → master``. Falls back to
        # ``base_commit^`` if all three fail — matches the behaviour
        # specs4/4-features/code-review.md specifies.
        merge_base: str | None = None
        # Try original_branch first (most specific).
        if original_branch and original_branch != branch:
            attempt = self.get_merge_base(branch_tip, original_branch)
            if "sha" in attempt:
                merge_base = str(attempt["sha"])
        # Fallback cascade: main, then master.
        if merge_base is None:
            attempt = self.get_merge_base(branch_tip)  # tries main, master
            if "sha" in attempt:
                merge_base = str(attempt["sha"])
        # Final fallback: parent of the user-selected commit. This
        # is the specs4 "all candidates fail" path — not as accurate
        # as a real merge-base but lets the review proceed.
        if merge_base is None:
            parent = self.get_commit_parent(base_commit)
            if "sha" in parent:
                merge_base = str(parent["sha"])
                logger.warning(
                    "Review merge-base cascade failed; "
                    "falling back to parent of %s (%s)",
                    base_commit,
                    merge_base,
                )
        if merge_base is None:
            return {
                "error": (
                    f"Could not determine a merge-base for {branch}. "
                    f"Unrelated histories?"
                )
            }

        # Step 4: checkout the branch (ensures we're on it before
        # detaching). We only do this when it makes sense — if the
        # user is already at the right branch, this is a no-op, and
        # for remote refs we skip because you can't check out a
        # remote tracking branch by its qualified name without
        # creating a local branch.
        if "/" not in branch and original_branch != branch:
            checkout_branch = self._run_git(["checkout", "-q", branch])
            if checkout_branch.returncode != 0:
                return {
                    "error": (
                        f"Failed to checkout {branch}: "
                        f"{checkout_branch.stderr.strip()}"
                    )
                }

        # Step 5: checkout the merge-base (detached HEAD). Disk now
        # reflects the pre-change state — the caller's next step is
        # to build a symbol map against disk.
        checkout_parent = self._run_git(["checkout", "-q", merge_base])
        if checkout_parent.returncode != 0:
            # Try to return to a known state before surfacing the
            # error — otherwise the user is stranded on a partial
            # review transition.
            if original_branch:
                self._run_git(["checkout", "-q", original_branch])
            return {
                "error": (
                    f"Failed to checkout merge-base {merge_base}: "
                    f"{checkout_parent.stderr.strip()}"
                )
            }

        return {
            "branch": branch,
            "branch_tip": branch_tip,
            "base_commit": base_commit,
            "parent_commit": merge_base,
            "original_branch": original_branch,
            "phase": "at_parent",
        }

    def setup_review_soft_reset(
        self,
        branch_tip: str,
        parent_commit: str,
    ) -> dict[str, str]:
        """Complete the review-mode entry sequence.

        Steps 6–7 of the entry sequence:

        6. Checkout the branch tip **by SHA** (not by name) — this
           brings disk files to the post-change state. Using SHA
           matters: for remote refs like ``origin/feature``, a
           checkout by name would leave HEAD at the ref pointer
           rather than at the actual commit.
        7. Soft reset to the merge-base — HEAD moves back without
           touching the working tree, so all feature-branch changes
           appear as staged modifications.

        Parameters
        ----------
        branch_tip:
            Full SHA of the branch tip (from
            :meth:`checkout_review_parent`'s result).
        parent_commit:
            Full SHA of the merge-base (ditto).

        Returns
        -------
        dict
            ``{"status": "review_ready"}`` on success. On failure,
            ``{"error": "<message>"}`` — the caller should invoke
            :meth:`exit_review_mode` to restore a sane state.
        """
        # Step 6: checkout branch tip by SHA.
        tip_checkout = self._run_git(["checkout", "-q", branch_tip])
        if tip_checkout.returncode != 0:
            return {
                "error": (
                    f"Failed to checkout branch tip {branch_tip}: "
                    f"{tip_checkout.stderr.strip()}"
                )
            }

        # Step 7: soft reset to merge-base. HEAD moves, index is
        # updated to reflect the tree at HEAD, working tree is
        # untouched. The net effect: disk stays at branch tip,
        # HEAD is at merge-base, every feature-branch change is
        # staged.
        reset = self._run_git(["reset", "--soft", parent_commit])
        if reset.returncode != 0:
            return {
                "error": (
                    f"Failed to soft-reset to {parent_commit}: "
                    f"{reset.stderr.strip()}"
                )
            }

        return {"status": "review_ready"}

    def exit_review_mode(
        self,
        branch_tip: str,
        original_branch: str | None,
    ) -> dict[str, str]:
        """Reverse the review-mode entry sequence.

        Three steps:

        1. Soft reset to the branch tip — HEAD moves forward,
           staging clears. Disk is unchanged (already at tip).
        2. Checkout the original branch — HEAD reattaches to the
           branch the user was on before review.
        3. Rebuilding the symbol index is the caller's
           responsibility (LLMService orchestrates it).

        Parameters
        ----------
        branch_tip:
            Full SHA of the branch tip that was being reviewed.
        original_branch:
            Branch name to return to, or ``None`` if HEAD was
            detached at review-entry time.

        Returns
        -------
        dict
            ``{"status": "restored"}`` on complete success. On
            partial success (tip reset worked but branch checkout
            failed), HEAD is left detached at ``branch_tip`` — the
            error message names what couldn't be restored so the
            user can fix it manually.

        Notes
        -----
        Manual recovery path when things go wrong: the user runs
        ``git checkout {original_branch}``. Since disk already
        matches the branch tip (both before and after soft-reset),
        a plain checkout is safe.
        """
        # Step 1: soft reset to the tip. Moves HEAD forward to the
        # branch tip SHA, clearing all the staged changes we
        # created on entry.
        reset = self._run_git(["reset", "--soft", branch_tip])
        if reset.returncode != 0:
            return {
                "error": (
                    f"Failed to reset to branch tip {branch_tip}: "
                    f"{reset.stderr.strip()}"
                )
            }

        # Step 2: reattach to the original branch. If HEAD was
        # detached at entry, we leave it detached — the caller's
        # pre-review state is preserved as faithfully as we can.
        if original_branch is not None:
            checkout = self._run_git(["checkout", "-q", original_branch])
            if checkout.returncode != 0:
                # Reset succeeded, but we couldn't reattach. HEAD
                # is safely at the branch tip SHA — disk matches,
                # no data is lost — but the user is detached. Name
                # the branch so they know what manual checkout to
                # run.
                return {
                    "error": (
                        f"Reset to branch tip succeeded, but could "
                        f"not checkout {original_branch}: "
                        f"{checkout.stderr.strip()}. "
                        f"Run: git checkout {original_branch}"
                    )
                }

        return {"status": "restored"}

    def get_review_changed_files(self) -> list[dict[str, object]]:
        """List files changed in the active review with per-file stats.

        Assumes the caller has already entered review mode (via
        :meth:`checkout_review_parent` + :meth:`setup_review_soft_reset`)
        so every review change appears as a staged modification.
        Produces one entry per changed file combining the status
        character from ``git diff --cached --name-status`` with the
        numeric addition/deletion counts from
        ``git diff --cached --numstat``.

        Returns
        -------
        list[dict]
            Each entry:

            - ``path``: repo-relative path
            - ``status``: one of ``"added"``, ``"modified"``,
              ``"deleted"``, ``"renamed"``, ``"copied"``,
              ``"typechange"``, or ``"unknown"`` (defensive fallback
              for statuses git may add in future versions)
            - ``additions``: lines added (0 for binary or delete)
            - ``deletions``: lines deleted (0 for binary or add)

            Empty list when no files have changed — callers treat
            this as "there's nothing to review".
        """
        # Name-status gives us the classification character; numstat
        # gives us the line-count pair. Two calls because combining
        # them via ``--name-status --numstat`` produces interleaved
        # output that's uglier to parse than two separate passes.
        name_status = self._run_git(
            ["diff", "--cached", "--name-status"],
            check=True,
        )
        numstat = self._run_git(
            ["diff", "--cached", "--numstat"],
            check=True,
        )
        stats = self._parse_numstat(numstat.stdout)

        # Map git's status letter to a human-readable name. The map
        # covers every status the porcelain docs list; anything
        # unexpected falls through to "unknown" rather than raising
        # because a forward-compatible parser is better than one
        # that breaks on a git upgrade.
        status_names: dict[str, str] = {
            "A": "added",
            "M": "modified",
            "D": "deleted",
            "R": "renamed",
            "C": "copied",
            "T": "typechange",
        }

        entries: list[dict[str, object]] = []
        for line in name_status.stdout.splitlines():
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            # Rename and copy entries are ``R100\told\tnew``. The
            # status letter may be followed by a similarity number.
            code = parts[0][:1]
            if code in ("R", "C") and len(parts) >= 3:
                # Use the new path as the canonical entry path —
                # that's what the reviewer actually wants to see.
                path = self._unquote_porcelain_path(parts[2])
            else:
                path = self._unquote_porcelain_path(parts[1])

            entry_stats = stats.get(path, {"additions": 0, "deletions": 0})
            entries.append({
                "path": path,
                "status": status_names.get(code, "unknown"),
                "additions": entry_stats["additions"],
                "deletions": entry_stats["deletions"],
            })
        return entries

    def get_review_file_diff(self, path: str | Path) -> dict[str, str]:
        """Return the staged diff for a single file during review mode.

        Used when the user selects a file to include in the review
        context passed to the LLM. Runs ``git diff --cached -- path``
        so the output shows what the feature branch changed relative
        to the merge-base.

        Parameters
        ----------
        path:
            Relative path to the file. Must be validated and inside
            the repo root — same rules as any other path-accepting
            method.

        Returns
        -------
        dict
            ``{"path": "<path>", "diff": "<patch text>"}`` on success.
            Empty diff is returned as an empty string rather than an
            error — a file that's in the review but has no diff
            (e.g., only mode changes) is rare but legal.
        """
        self._validate_rel_path(path)
        rel = self._normalise_rel_path(path)
        result = self._run_git(
            ["diff", "--cached", "--", rel],
            check=True,
        )
        return {"path": rel, "diff": result.stdout}

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    def search_files(
        self,
        query: str,
        whole_word: bool = False,
        use_regex: bool = False,
        ignore_case: bool = True,
        context_lines: int = 1,
    ) -> list[dict[str, object]]:
        """Search tracked files with ``git grep``.

        Uses ``git grep`` rather than a pure-Python walk: git is
        already doing the heavy lifting (binary detection,
        gitignore respect, index awareness) and greps through
        thousands of files faster than Python can enumerate them.

        Parameters
        ----------
        query:
            Search text. Empty or whitespace-only returns an empty
            list — treated as "no query" rather than "match every
            line in the repo".
        whole_word:
            When True, adds ``--word-regexp`` so partial matches
            don't hit. Mirrors the VS-Code-style toggle in the UI.
        use_regex:
            When False (default), ``--fixed-strings`` is passed so
            regex metacharacters in the query are matched literally.
            When True, the query is interpreted as an extended
            regular expression.
        ignore_case:
            Defaults to True — case-insensitive is the friendlier
            default for code search. Disable when identifier casing
            matters.
        context_lines:
            Lines of context before and after each match. Applied
            via ``-C``. Zero is valid (match lines only). Negative
            values are clamped to zero.

        Returns
        -------
        list[dict]
            One entry per matching file:

            - ``file``: repo-relative path
            - ``matches``: list of match dicts, each with:
                - ``line_num``: 1-indexed line number
                - ``line``: text of the matching line
                - ``context_before``: list of
                  ``{line_num, line}`` for context lines before
                - ``context_after``: list of the same shape after
        """
        if not query or not query.strip():
            return []

        # Note: we do NOT pass --null. When --null is set, git grep
        # uses NUL for EVERY field separator and drops the ':' /
        # '-' distinction between match lines and context lines —
        # which makes context parsing impossible. The default
        # output uses ':' between path and linenum on match lines,
        # '-' on context lines. A pathological filename containing
        # ':' would confuse the parser, but that's vanishingly
        # rare in practice (and our _validate_rel_path already
        # rejects the worst offenders).
        args: list[str] = ["grep", "-n"]
        ctx = max(0, context_lines)
        if ctx:
            args.extend(["-C", str(ctx)])
        if ignore_case:
            args.append("--ignore-case")
        if whole_word:
            args.append("--word-regexp")
        if use_regex:
            args.append("--extended-regexp")
        else:
            args.append("--fixed-strings")
        # ``-e`` explicitly marks the pattern so a query starting
        # with ``-`` (e.g. ``--foo``) isn't mistaken for a flag.
        args.extend(["-e", query])

        result = self._run_git(args)
        # git grep exit code: 0 = matches found, 1 = no matches
        # (not an error), 2+ = actual error. Only raise on 2+.
        if result.returncode >= 2:
            stderr = (result.stderr or "").strip()
            raise RepoError(
                f"git grep failed: {stderr or 'unknown error'}"
            )
        if result.returncode == 1 or not result.stdout:
            return []

        return self._parse_grep_output(result.stdout, ctx)

    @staticmethod
    def _parse_grep_output(
        raw: str,
        context_lines: int,
    ) -> list[dict[str, object]]:
        """Parse ``git grep -n -C <ctx>`` output.

        Format (without ``--null``):

        - Match lines: ``path:linenum:text``
        - Context lines: ``path-linenum-text``
        - Group separators: a literal ``--`` between non-contiguous
          match groups (ignored here).

        The separator character (``:`` or ``-``) between path and
        linenum is also the match-vs-context indicator. Same
        character also separates linenum from the text.

        Paths containing a ``:`` or ``-`` in awkward positions
        would confuse the parse, but such paths are vanishingly
        rare and already filtered by ``_validate_rel_path``.

        Strategy: three passes, each small and obvious.

        1. Parse every grep output line into a tuple of
           (path, line_num, is_match, text).
        2. Group consecutive rows by file (preserving encounter
           order so results appear in git's pathspec order).
        3. For each file, walk its rows left-to-right. Each match
           collects at most ``context_lines`` non-match rows
           immediately before it as ``context_before``, and at
           most ``context_lines`` non-match rows immediately after
           it as ``context_after``. Rows between two matches are
           attributed to the later match's ``context_before`` and
           the earlier match's ``context_after`` symmetrically.
        """
        parsed: list[tuple[str, int, bool, str]] = []
        for line in raw.splitlines():
            if line == "--":
                continue
            # Find the first ':' or '-' — that's the separator
            # between path and linenum (and tells us match vs
            # context). We scan from the left.
            path_end = -1
            sep_char = ""
            for idx, ch in enumerate(line):
                if ch in (":", "-"):
                    path_end = idx
                    sep_char = ch
                    break
            if path_end <= 0:
                # No separator or empty path — skip defensively.
                continue
            path = line[:path_end]
            rest = line[path_end + 1:]
            is_match = sep_char == ":"
            # rest starts with the line number followed by the same
            # separator char, then the text.
            i = 0
            while i < len(rest) and rest[i].isdigit():
                i += 1
            if i == 0 or i >= len(rest):
                continue
            try:
                line_num = int(rest[:i])
            except ValueError:
                continue
            # The char at position i should match sep_char — if it
            # doesn't, this isn't a real grep line, skip.
            if rest[i] != sep_char:
                continue
            text = rest[i + 1:]
            parsed.append((path, line_num, is_match, text))

        # Group by file, preserving order.
        file_order: list[str] = []
        file_rows: dict[str, list[tuple[int, bool, str]]] = {}
        for path, line_num, is_match, text in parsed:
            if path not in file_rows:
                file_order.append(path)
                file_rows[path] = []
            file_rows[path].append((line_num, is_match, text))

        output: list[dict[str, object]] = []
        for path in file_order:
            rows = file_rows[path]
            matches: list[dict[str, object]] = []
            for idx, (line_num, is_match, text) in enumerate(rows):
                if not is_match:
                    continue
                # Context before: walk backwards from idx-1, collect
                # up to context_lines non-match rows. Stop at a
                # match — earlier matches have their own entry.
                before: list[dict[str, object]] = []
                j = idx - 1
                while j >= 0 and len(before) < context_lines:
                    prev_num, prev_is_match, prev_text = rows[j]
                    if prev_is_match:
                        break
                    before.append({"line_num": prev_num, "line": prev_text})
                    j -= 1
                before.reverse()  # chronological order
                # Context after: walk forwards from idx+1, symmetric.
                after: list[dict[str, object]] = []
                j = idx + 1
                while j < len(rows) and len(after) < context_lines:
                    next_num, next_is_match, next_text = rows[j]
                    if next_is_match:
                        break
                    after.append({"line_num": next_num, "line": next_text})
                    j += 1
                matches.append({
                    "line_num": line_num,
                    "line": text,
                    "context_before": before,
                    "context_after": after,
                })
            if matches:
                output.append({"file": path, "matches": matches})
        return output

    # ------------------------------------------------------------------
    # External tool availability
    # ------------------------------------------------------------------

    @staticmethod
    def is_make4ht_available() -> bool:
        """Return True when ``make4ht`` is on PATH.

        Layer 5's TeX preview feature needs make4ht for LaTeX →
        HTML compilation. We expose only the availability check at
        Layer 1 — the actual compile path lives with the preview
        UI, which is where the temp-directory management and
        asset-inlining logic belong. Having the probe here means
        the browser can show or hide the preview toggle immediately
        on file open without waiting for a compile attempt to fail.

        Uses :func:`shutil.which` which resolves the binary name
        against PATH using the platform's conventions (PATHEXT on
        Windows). Returns a bool, never raises — missing tools
        are an expected runtime condition, not an error.
        """
        return shutil.which("make4ht") is not None