"""Path validation and binary detection.

Every path crossing the API boundary lands here for normalisation
and validation. Two layers of defence — segment-based traversal
rejection plus resolved-path containment — because either alone is
insufficient (segment check misses symlink escapes; resolved check
misses absolute-path-with-shared-prefix attacks).
"""

from __future__ import annotations

import mimetypes
from pathlib import Path

from .errors import (
    BINARY_IMAGE_MIME_FALLBACK,
    BINARY_PROBE_BYTES,
    RepoError,
)


class PathMixin:
    """Path validation and binary detection.

    Mixed into :class:`Repo`. Reads ``self._root``.
    """

    _root: Path

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

        Scans the first :data:`BINARY_PROBE_BYTES` bytes for a null
        byte. Cheap and deterministic. Accepts the occasional false
        negative (UTF-16 files, some compressed formats) — downstream
        callers (edit-apply, symbol index) refuse binary content
        separately, so a missed detection here doesn't corrupt
        anything; it just produces a clearer error downstream.
        """
        return b"\x00" in data[:BINARY_PROBE_BYTES]

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
                probe = fh.read(BINARY_PROBE_BYTES)
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
        fallback = BINARY_IMAGE_MIME_FALLBACK.get(path.suffix.lower())
        if fallback:
            return fallback
        return "application/octet-stream"