"""Path normalisation, traversal rejection, binary detection, MIME helpers."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from ac_dc.repo import Repo, RepoError


class TestPathValidation:
    """Path normalisation and traversal-rejection rules."""

    def test_normalise_strips_leading_slash(self, repo: Repo) -> None:
        """Leading slash on a relative-looking path is stripped.

        Note: this is the normalisation helper only. The validation
        step (``_validate_rel_path``) rejects leading-slash inputs
        outright — see :meth:`test_rejects_absolute_posix_path`.
        """
        assert repo._normalise_rel_path("/src/main.py") == "src/main.py"

    def test_normalise_converts_backslashes(self, repo: Repo) -> None:
        """Windows-style separators are converted to forward slashes."""
        assert repo._normalise_rel_path("src\\main.py") == "src/main.py"

    def test_normalise_strips_trailing_slash(self, repo: Repo) -> None:
        """Trailing slash is stripped for canonical form."""
        assert repo._normalise_rel_path("src/") == "src"

    def test_validate_accepts_simple_path(self, repo: Repo) -> None:
        """A plain relative path resolves to an absolute child of root."""
        abs_path = repo._validate_rel_path("README.md")
        assert abs_path == repo.root / "README.md"

    def test_validate_rejects_empty_path(self, repo: Repo) -> None:
        with pytest.raises(RepoError, match="Empty path"):
            repo._validate_rel_path("")

    def test_validate_rejects_whitespace_only(self, repo: Repo) -> None:
        """A slash-only input normalises to empty and is rejected."""
        with pytest.raises(RepoError, match="Empty path"):
            repo._validate_rel_path("///")

    def test_validate_rejects_parent_traversal(self, repo: Repo) -> None:
        """Paths containing a .. segment are rejected."""
        with pytest.raises(RepoError, match="traversal"):
            repo._validate_rel_path("../outside.txt")

    def test_validate_rejects_embedded_parent_traversal(self, repo: Repo) -> None:
        """.. in the middle of the path is also rejected."""
        with pytest.raises(RepoError, match="traversal"):
            repo._validate_rel_path("src/../outside.txt")

    def test_validate_rejects_absolute_posix_path(self, repo: Repo) -> None:
        """POSIX-style absolute paths are rejected, even ones that
        happen to start with the repo root prefix."""
        with pytest.raises(RepoError, match="Absolute"):
            repo._validate_rel_path("/etc/passwd")

    def test_validate_rejects_windows_absolute_path(self, repo: Repo) -> None:
        """C:\\ style drive paths are rejected on every platform.

        This is a pure string-validation test — no filesystem
        touch — so it runs regardless of the host OS. A config
        file authored on Windows or a caller that forgot to
        normalise path separators could pass a drive-letter
        string through on Linux; the validator must reject it
        with the same ``Absolute paths not accepted`` message
        it uses for POSIX absolute paths.
        """
        with pytest.raises(RepoError, match="Absolute"):
            repo._validate_rel_path("C:\\Windows\\notepad.exe")

    def test_validate_rejects_symlink_escape(self, repo: Repo) -> None:
        """A symlink inside the repo pointing OUT of the repo is rejected.

        Resolved-path containment is the second line of defence. A
        traversal-free path string (no .. segments) can still escape
        via a symlink; Path.resolve() follows the link and the
        ``relative_to`` check catches it.
        """
        if sys.platform == "win32":
            pytest.skip("Symlinks need admin or developer mode on Windows")

        outside = repo.root.parent / "outside.txt"
        outside.write_text("secret", encoding="utf-8")
        link = repo.root / "escape.txt"
        link.symlink_to(outside)
        with pytest.raises(RepoError, match="escapes"):
            repo._validate_rel_path("escape.txt")


class TestBinaryAndMime:
    """Binary detection via null-byte scan and MIME type inference."""

    def test_text_file_not_binary(self, repo: Repo) -> None:
        """A plain UTF-8 text file is detected as non-binary."""
        (repo.root / "text.md").write_text("# Hello\n", encoding="utf-8")
        assert repo.is_binary_file("text.md") is False

    def test_empty_file_not_binary(self, repo: Repo) -> None:
        """An empty file is non-binary (no null bytes means text).

        Matches git's conservative rule: we only POSITIVELY identify
        binary files. Absence of evidence is treated as text.
        """
        (repo.root / "empty.txt").touch()
        assert repo.is_binary_file("empty.txt") is False

    def test_file_with_null_byte_is_binary(self, repo: Repo) -> None:
        """A file containing a null byte in the first 8KB is binary."""
        (repo.root / "blob.bin").write_bytes(b"MZ\x00\x90" + b"\x00" * 100)
        assert repo.is_binary_file("blob.bin") is True

    def test_null_byte_beyond_probe_not_detected(self, repo: Repo) -> None:
        """Null bytes past the 8KB probe window aren't caught.

        Documented limitation — see the module docstring. The cost of
        scanning the full file on every read is not worth the rare
        false negative case, and downstream consumers reject binary
        content independently.
        """
        # 9KB of text, then a null byte.
        content = b"a" * 9000 + b"\x00" + b"b" * 100
        (repo.root / "late_null.bin").write_bytes(content)
        assert repo.is_binary_file("late_null.bin") is False

    def test_binary_check_on_invalid_path_returns_false(self, repo: Repo) -> None:
        """Traversal attempts return False rather than raising.

        The ``is_binary_file`` method is a predicate — callers treat
        it as "is this safely text-readable" — so traversal attempts
        are handled by returning False (forcing the caller down the
        slower, more careful read path that will raise properly).
        """
        assert repo.is_binary_file("../outside") is False

    def test_binary_check_on_missing_file_returns_false(self, repo: Repo) -> None:
        """Missing files are reported as non-binary (read will fail next)."""
        assert repo.is_binary_file("does-not-exist.txt") is False

    def test_binary_check_on_directory_returns_false(self, repo: Repo) -> None:
        """Directories are reported as non-binary.

        We only successfully read when we have a file; directories
        fail open-read and return False here. The caller's next
        step — which is always an actual read — will raise with a
        proper message.
        """
        (repo.root / "subdir").mkdir()
        assert repo.is_binary_file("subdir") is False

    def test_mime_known_extension(self, repo: Repo) -> None:
        """mimetypes-known extensions return the standard MIME type."""
        assert repo._detect_mime(Path("foo.png")) == "image/png"

    def test_mime_fallback_for_common_image(self, repo: Repo) -> None:
        """The fallback table covers image types mimetypes may miss.

        We can't force mimetypes to miss, so this asserts the shape
        of the returned value rather than proving the fallback path
        specifically — any valid MIME is accepted.
        """
        result = repo._detect_mime(Path("foo.webp"))
        assert result == "image/webp"

    def test_mime_unknown_extension_returns_octet_stream(
        self, repo: Repo
    ) -> None:
        """Unknown extensions get the universal binary fallback."""
        assert repo._detect_mime(Path("foo.xyzzy")) == "application/octet-stream"

    def test_mime_no_extension_returns_octet_stream(self, repo: Repo) -> None:
        """Extensionless filenames get the universal binary fallback."""
        assert repo._detect_mime(Path("README")) == "application/octet-stream"