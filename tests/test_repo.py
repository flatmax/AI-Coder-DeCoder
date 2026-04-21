"""Tests for ac_dc.repo.Repo — Turn 1 (Layer 1.3).

Scope: construction, path validation, binary detection, MIME helpers,
per-path write mutex, basic file I/O (exists, read, base64, write,
create, delete), and the git subprocess helper.

Turn 2 adds tests for staging, diffs, branches, review, tree, search.

Test strategy:

- Throwaway git repos via ``subprocess`` + ``tmp_path``. No
  pytest-git dependency — the subprocess-driven setup is stable,
  matches what users see from the terminal, and has zero new
  install weight.
- Each test gets its own repo via the ``repo`` fixture so tests
  never contaminate each other.
- Async tests use pytest-asyncio (auto mode is enabled in
  pyproject.toml, so no per-test decorators needed).
"""

from __future__ import annotations

import asyncio
import base64
import subprocess
import sys
from pathlib import Path

import pytest

from ac_dc.repo import Repo, RepoError


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Constructor
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Path validation
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Binary detection and MIME helpers
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# File read operations
# ---------------------------------------------------------------------------


class TestFileRead:
    """Synchronous file-reading methods: exists, get_content, base64."""

    def test_exists_true_for_present_file(self, repo: Repo) -> None:
        """file_exists returns True for a regular file."""
        (repo.root / "a.txt").write_text("hi", encoding="utf-8")
        assert repo.file_exists("a.txt") is True

    def test_exists_false_for_missing_file(self, repo: Repo) -> None:
        """file_exists returns False for a path that isn't there."""
        assert repo.file_exists("nope.txt") is False

    def test_exists_false_for_directory(self, repo: Repo) -> None:
        """file_exists treats directories as not-a-file, returning False."""
        (repo.root / "subdir").mkdir()
        assert repo.file_exists("subdir") is False

    def test_exists_false_for_invalid_path(self, repo: Repo) -> None:
        """Traversal attempts return False, not raise."""
        assert repo.file_exists("../outside.txt") is False

    def test_get_content_working_tree(self, repo: Repo) -> None:
        """Reads the working-tree copy when no version is specified."""
        (repo.root / "hello.md").write_text(
            "# Hello\nworld\n", encoding="utf-8"
        )
        assert repo.get_file_content("hello.md") == "# Hello\nworld\n"

    def test_get_content_decodes_utf8(self, repo: Repo) -> None:
        """Non-ASCII UTF-8 content round-trips correctly."""
        content = "héllo — wörld 🎉\n"
        (repo.root / "unicode.md").write_text(content, encoding="utf-8")
        assert repo.get_file_content("unicode.md") == content

    def test_get_content_replaces_invalid_bytes(self, repo: Repo) -> None:
        """Invalid UTF-8 sequences are replaced, not raised.

        The read path uses ``errors="replace"`` so a partially
        corrupt text file still produces a string the LLM can look
        at. Streaming with decode errors would be strictly worse UX.
        """
        # Valid UTF-8 header + lone 0xFF continuation byte.
        (repo.root / "mixed.txt").write_bytes(b"hello \xff world")
        content = repo.get_file_content("mixed.txt")
        assert "hello" in content
        assert "world" in content

    def test_get_content_missing_file_raises(self, repo: Repo) -> None:
        """Missing working-tree files raise with a clear message."""
        with pytest.raises(RepoError, match="File not found"):
            repo.get_file_content("nope.txt")

    def test_get_content_rejects_binary(self, repo: Repo) -> None:
        """Binary files refuse to return as text."""
        (repo.root / "blob.bin").write_bytes(b"MZ\x00\x90" + b"\x00" * 100)
        with pytest.raises(RepoError, match="Binary file"):
            repo.get_file_content("blob.bin")

    def test_get_content_rejects_invalid_path(self, repo: Repo) -> None:
        """Traversal attempts raise, matching the write-path behaviour."""
        with pytest.raises(RepoError, match="traversal"):
            repo.get_file_content("../outside")

    def test_get_content_at_head(self, repo: Repo) -> None:
        """Versioned read returns the HEAD copy, not the working tree."""
        (repo.root / "tracked.md").write_text("v1\n", encoding="utf-8")
        _run_git(repo.root, "add", "tracked.md")
        _run_git(repo.root, "commit", "-q", "-m", "add tracked")
        # Mutate working tree.
        (repo.root / "tracked.md").write_text("v2 WIP\n", encoding="utf-8")
        # Working-tree read sees v2.
        assert repo.get_file_content("tracked.md") == "v2 WIP\n"
        # HEAD read sees v1.
        assert repo.get_file_content("tracked.md", version="HEAD") == "v1\n"

    def test_get_content_at_nonexistent_ref_raises(self, repo: Repo) -> None:
        """A versioned read against a bogus ref raises with git's error."""
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        with pytest.raises(RepoError, match="git show"):
            repo.get_file_content("a.md", version="no-such-ref")

    def test_get_content_at_ref_missing_file_raises(self, repo: Repo) -> None:
        """Versioned read for a file that doesn't exist at that ref raises."""
        # Commit a.md but never add b.md.
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        with pytest.raises(RepoError, match="git show"):
            repo.get_file_content("b.md", version="HEAD")

    def test_get_file_base64_returns_data_uri(self, repo: Repo) -> None:
        """Binary read returns a well-formed data URI."""
        # 1x1 PNG — smallest valid PNG.
        png_bytes = bytes.fromhex(
            "89504e470d0a1a0a0000000d49484452000000010000000108060000001f"
            "15c4890000000d49444154789c6200010000000500010d0a2db40000"
            "000049454e44ae426082"
        )
        (repo.root / "pixel.png").write_bytes(png_bytes)
        result = repo.get_file_base64("pixel.png")
        assert isinstance(result, dict)
        assert set(result.keys()) == {"data_uri"}
        uri = result["data_uri"]
        assert uri.startswith("data:image/png;base64,")
        # Round-trip: decode the payload and compare to source bytes.
        payload = uri.split(",", 1)[1]
        assert base64.b64decode(payload) == png_bytes

    def test_get_file_base64_unknown_extension_uses_octet_stream(
        self, repo: Repo
    ) -> None:
        """Unknown extensions fall back to application/octet-stream."""
        (repo.root / "data.xyzzy").write_bytes(b"arbitrary")
        uri = repo.get_file_base64("data.xyzzy")["data_uri"]
        assert uri.startswith("data:application/octet-stream;base64,")

    def test_get_file_base64_missing_file_raises(self, repo: Repo) -> None:
        """Missing files raise rather than returning an empty data URI."""
        with pytest.raises(RepoError, match="File not found"):
            repo.get_file_base64("nope.png")

    def test_get_file_base64_rejects_invalid_path(self, repo: Repo) -> None:
        """Traversal attempts raise."""
        with pytest.raises(RepoError, match="traversal"):
            repo.get_file_base64("../secret")


# ---------------------------------------------------------------------------
# File write operations (async)
# ---------------------------------------------------------------------------


class TestFileWrite:
    """Async file-writing methods: write, create, delete."""

    async def test_write_file_creates_new(self, repo: Repo) -> None:
        """write_file creates a file that didn't exist."""
        result = await repo.write_file("new.md", "hello\n")
        assert result == {"status": "ok"}
        assert (repo.root / "new.md").read_text(encoding="utf-8") == "hello\n"

    async def test_write_file_overwrites_existing(self, repo: Repo) -> None:
        """write_file overwrites an existing file."""
        (repo.root / "a.md").write_text("old", encoding="utf-8")
        await repo.write_file("a.md", "new")
        assert (repo.root / "a.md").read_text(encoding="utf-8") == "new"

    async def test_write_file_creates_parent_directories(
        self, repo: Repo
    ) -> None:
        """write_file creates parent dirs automatically."""
        await repo.write_file("deeply/nested/path/file.md", "hi")
        assert (
            repo.root / "deeply" / "nested" / "path" / "file.md"
        ).read_text(encoding="utf-8") == "hi"

    async def test_write_file_rejects_invalid_path(self, repo: Repo) -> None:
        """Traversal attempts raise."""
        with pytest.raises(RepoError, match="traversal"):
            await repo.write_file("../outside.txt", "nope")

    async def test_write_file_replaces_invalid_utf8(self, repo: Repo) -> None:
        """Text with characters that can't encode round-trip via replace.

        The ``errors="replace"`` path means writes are total — no
        encoding exception surfaces to the caller. This matches the
        read side's lenience.
        """
        # Lone surrogate — not encodable as UTF-8.
        await repo.write_file("weird.md", "ok \ud800 fine")
        # File exists and was written without raising.
        assert (repo.root / "weird.md").is_file()

    async def test_create_file_creates_new(self, repo: Repo) -> None:
        """create_file creates a fresh file."""
        result = await repo.create_file("new.md", "content")
        assert result == {"status": "ok"}
        assert (repo.root / "new.md").read_text(encoding="utf-8") == "content"

    async def test_create_file_default_empty_content(self, repo: Repo) -> None:
        """create_file with no content creates an empty file."""
        await repo.create_file("empty.md")
        assert (repo.root / "empty.md").read_text(encoding="utf-8") == ""

    async def test_create_file_fails_if_exists(self, repo: Repo) -> None:
        """create_file refuses to clobber an existing file."""
        (repo.root / "a.md").write_text("original", encoding="utf-8")
        with pytest.raises(RepoError, match="already exists"):
            await repo.create_file("a.md", "new")
        # Original content preserved.
        assert (repo.root / "a.md").read_text(encoding="utf-8") == "original"

    async def test_create_file_creates_parent_directories(
        self, repo: Repo
    ) -> None:
        """create_file creates parent dirs like write_file."""
        await repo.create_file("deep/dir/path/new.md", "hi")
        assert (
            repo.root / "deep" / "dir" / "path" / "new.md"
        ).read_text(encoding="utf-8") == "hi"

    async def test_create_file_rejects_invalid_path(self, repo: Repo) -> None:
        """Traversal attempts raise."""
        with pytest.raises(RepoError, match="traversal"):
            await repo.create_file("../escape.txt", "nope")

    async def test_delete_file_removes_existing(self, repo: Repo) -> None:
        """delete_file removes a regular file."""
        target = repo.root / "doomed.md"
        target.write_text("bye", encoding="utf-8")
        result = await repo.delete_file("doomed.md")
        assert result == {"status": "ok"}
        assert not target.exists()

    async def test_delete_file_missing_raises(self, repo: Repo) -> None:
        """delete_file on a missing file raises with a clear message."""
        with pytest.raises(RepoError, match="File not found"):
            await repo.delete_file("nope.md")

    async def test_delete_file_directory_raises(self, repo: Repo) -> None:
        """delete_file refuses to delete a directory."""
        (repo.root / "subdir").mkdir()
        with pytest.raises(RepoError, match="directory"):
            await repo.delete_file("subdir")
        # Directory still present.
        assert (repo.root / "subdir").is_dir()

    async def test_delete_file_rejects_invalid_path(self, repo: Repo) -> None:
        """Traversal attempts raise."""
        with pytest.raises(RepoError, match="traversal"):
            await repo.delete_file("../outside.txt")

    async def test_delete_file_drops_write_lock_entry(self, repo: Repo) -> None:
        """After deletion, the lock-map entry is removed.

        Documented in delete_file — lock map shouldn't grow
        unboundedly with the set of ever-written paths. A fresh
        create under the same name creates a new lock on demand.
        """
        target = repo.root / "temp.md"
        target.write_text("hi", encoding="utf-8")
        # Touch the lock so it gets created.
        await repo.write_file("temp.md", "modified")
        key = repo._normalise_rel_path("temp.md")
        assert key in repo._write_locks
        await repo.delete_file("temp.md")
        assert key not in repo._write_locks


# ---------------------------------------------------------------------------
# Per-path write mutex
# ---------------------------------------------------------------------------


class TestWriteMutex:
    """D10 contract — per-path serialisation, per-path-pair parallelism."""

    def test_same_path_returns_same_lock(self, repo: Repo) -> None:
        """Repeated calls for one path return the same lock instance."""
        lock_a = repo._get_write_lock("file.md")
        lock_b = repo._get_write_lock("file.md")
        assert lock_a is lock_b

    def test_different_paths_return_different_locks(self, repo: Repo) -> None:
        """Distinct paths get distinct locks — they can proceed in parallel."""
        lock_a = repo._get_write_lock("a.md")
        lock_b = repo._get_write_lock("b.md")
        assert lock_a is not lock_b

    def test_lock_key_uses_normalised_path(self, repo: Repo) -> None:
        """Different spellings of the same path share a lock.

        Forward vs back slash, trailing slash, leading slash — all
        collapse to the same canonical key via ``_normalise_rel_path``.
        """
        lock_forward = repo._get_write_lock("src/file.md")
        lock_back = repo._get_write_lock("src\\file.md")
        lock_trailing = repo._get_write_lock("src/file.md/")
        assert lock_forward is lock_back is lock_trailing

    async def test_concurrent_same_path_writes_serialise(
        self, repo: Repo
    ) -> None:
        """Two tasks writing the same path run strictly serially.

        We prove serialisation by having each writer sleep inside its
        critical section and asserting total elapsed time ≥ 2× the
        sleep duration. If writes were parallel, elapsed would be ≈
        one sleep. Time-based tests are usually flaky, but this is
        about lower bounds (ordering preserves minimum duration),
        not upper bounds (which would be flaky under CI load).
        """
        import time

        sleep_s = 0.05
        target = repo.root / "contended.md"
        target.write_text("seed", encoding="utf-8")

        async def slow_write(marker: str) -> None:
            lock = repo._get_write_lock("contended.md")
            async with lock:
                await asyncio.sleep(sleep_s)
                # Write directly — bypasses the method's own lock
                # acquisition so we can observe the lock without
                # double-acquiring.
                target.write_text(marker, encoding="utf-8")

        start = time.monotonic()
        await asyncio.gather(slow_write("a"), slow_write("b"))
        elapsed = time.monotonic() - start
        # Lower bound: two sleeps must have happened sequentially.
        # Small fudge factor (0.9×) tolerates scheduling jitter.
        assert elapsed >= sleep_s * 2 * 0.9, (
            f"writes ran in parallel: elapsed={elapsed:.3f}s "
            f"(expected ≥ {sleep_s * 2:.3f}s)"
        )

    async def test_concurrent_different_path_writes_parallelise(
        self, repo: Repo
    ) -> None:
        """Writes to distinct paths proceed in parallel.

        Upper bound this time — if the locks were shared, elapsed
        would be ≥ 2× sleep. We assert elapsed is meaningfully less
        than that to prove parallelism. Fudge factor is generous
        (1.7×) to absorb scheduler noise without masking a real
        serialisation bug.
        """
        import time

        sleep_s = 0.05

        async def slow_write(path: str) -> None:
            await repo.write_file(path, "hi")
            # Sleep inside the call boundary so we exercise the
            # method's own lock, not a standalone sleep.
            lock = repo._get_write_lock(path)
            async with lock:
                await asyncio.sleep(sleep_s)

        start = time.monotonic()
        await asyncio.gather(slow_write("a.md"), slow_write("b.md"))
        elapsed = time.monotonic() - start
        # Upper bound: should be under 1.7 × single-sleep duration.
        # If serialised, it'd be ≥ 2× — plenty of margin.
        assert elapsed < sleep_s * 1.7, (
            f"writes ran serially when they should have parallelised: "
            f"elapsed={elapsed:.3f}s (expected < {sleep_s * 1.7:.3f}s)"
        )


# ---------------------------------------------------------------------------
# Git staging
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Rename operations
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Diffs
# ---------------------------------------------------------------------------


class TestDiffs:
    """get_staged_diff, get_unstaged_diff, get_diff_to_branch."""

    def test_get_staged_diff_empty_when_nothing_staged(self, repo: Repo) -> None:
        """Clean working tree produces empty staged diff."""
        assert repo.get_staged_diff() == ""

    def test_get_staged_diff_shows_staged_changes(self, repo: Repo) -> None:
        """Staged additions appear in the diff output."""
        (repo.root / "a.md").write_text("hello\nworld\n", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        diff = repo.get_staged_diff()
        # The diff header mentions the path and the content lines
        # appear as additions.
        assert "a.md" in diff
        assert "+hello" in diff
        assert "+world" in diff

    def test_get_unstaged_diff_empty_when_clean(self, repo: Repo) -> None:
        """Clean working tree produces empty unstaged diff."""
        assert repo.get_unstaged_diff() == ""

    def test_get_unstaged_diff_shows_working_tree_changes(
        self, repo: Repo
    ) -> None:
        """Modifications to tracked files appear in the unstaged diff."""
        (repo.root / "a.md").write_text("v1\n", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        (repo.root / "a.md").write_text("v2\n", encoding="utf-8")
        diff = repo.get_unstaged_diff()
        assert "a.md" in diff
        assert "-v1" in diff
        assert "+v2" in diff

    def test_get_unstaged_diff_excludes_staged_changes(
        self, repo: Repo
    ) -> None:
        """Staged-only changes don't appear in the unstaged diff."""
        (repo.root / "a.md").write_text("hello\n", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        # Nothing in the working tree beyond the staged addition —
        # the staged diff shows it, the unstaged one does not.
        assert "+hello" in repo.get_staged_diff()
        assert repo.get_unstaged_diff() == ""

    def test_get_diff_to_branch_returns_diff_for_existing_branch(
        self, repo: Repo
    ) -> None:
        """Diff vs an existing branch returns patch text under 'diff'."""
        # Initial commit on main.
        (repo.root / "a.md").write_text("v1\n", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        # Create a feature branch with a divergent commit.
        _run_git(repo.root, "checkout", "-q", "-b", "feature")
        (repo.root / "a.md").write_text("v2\n", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "v2")
        # Back to main and compare vs feature.
        _run_git(repo.root, "checkout", "-q", "main")
        result = repo.get_diff_to_branch("feature")
        assert "diff" in result
        assert "error" not in result
        assert "a.md" in result["diff"]

    def test_get_diff_to_branch_includes_working_tree_changes(
        self, repo: Repo
    ) -> None:
        """Two-dot diff covers working-tree changes, not just committed.

        specs4/1-foundation/repository.md documents this explicitly —
        ``git diff <branch>`` shows the branch tip vs the working
        tree, so uncommitted edits on the current side appear.
        """
        (repo.root / "a.md").write_text("v1\n", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        _run_git(repo.root, "checkout", "-q", "-b", "feature")
        _run_git(repo.root, "checkout", "-q", "main")
        # Uncommitted working-tree change on main.
        (repo.root / "a.md").write_text("wip\n", encoding="utf-8")
        result = repo.get_diff_to_branch("feature")
        # The working-tree edit shows as a difference.
        assert "wip" in result["diff"]

    def test_get_diff_to_branch_rejects_empty_name(self, repo: Repo) -> None:
        """Empty branch name produces a structured error, not a raise."""
        result = repo.get_diff_to_branch("")
        assert "error" in result
        assert "diff" not in result

    def test_get_diff_to_branch_whitespace_rejected(self, repo: Repo) -> None:
        """Whitespace-only branch names are also rejected."""
        result = repo.get_diff_to_branch("   ")
        assert "error" in result

    def test_get_diff_to_branch_unknown_ref_returns_error(
        self, repo: Repo
    ) -> None:
        """An unresolvable ref returns a structured error naming it.

        The method does its own rev-parse probe so users see a
        clear "unknown ref" rather than git's raw "bad revision"
        message from the diff call.
        """
        # Need at least one commit so rev-parse doesn't fail for a
        # different reason.
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        result = repo.get_diff_to_branch("definitely-not-a-branch")
        assert "error" in result
        assert "definitely-not-a-branch" in result["error"]


# ---------------------------------------------------------------------------
# Commit and reset
# ---------------------------------------------------------------------------


class TestCommit:
    """commit, stage_all, reset_hard, search_commits."""

    def test_commit_creates_commit_and_returns_sha(self, repo: Repo) -> None:
        """commit stages and creates a commit; returns full SHA and message."""
        (repo.root / "a.md").write_text("hello", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        result = repo.commit("init: add a.md")
        assert set(result.keys()) == {"sha", "message"}
        # SHA-1 is 40 hex characters.
        assert len(result["sha"]) == 40
        assert all(c in "0123456789abcdef" for c in result["sha"])
        assert result["message"] == "init: add a.md"

    def test_commit_uses_stdin_for_multiline_message(self, repo: Repo) -> None:
        """Multi-line messages with special characters round-trip correctly.

        ``git commit -F -`` reads from stdin — safer than ``-m`` for
        messages containing newlines, quotes, or conventional-commit
        bodies.
        """
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        message = (
            'feat(x): add "quoted" thing\n'
            "\n"
            "This body spans multiple lines\n"
            "and has $special chars."
        )
        result = repo.commit(message)
        # Verify git stored the message verbatim.
        stored = _run_git(
            repo.root, "log", "-1", "--format=%B"
        ).stdout.rstrip("\n")
        assert stored == message
        assert result["message"] == message

    def test_commit_rejects_empty_message(self, repo: Repo) -> None:
        """Empty commit messages are rejected before invoking git."""
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        with pytest.raises(RepoError, match="must not be empty"):
            repo.commit("")

    def test_commit_rejects_whitespace_message(self, repo: Repo) -> None:
        """Whitespace-only messages count as empty."""
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        with pytest.raises(RepoError, match="must not be empty"):
            repo.commit("   \n  ")

    def test_commit_with_nothing_staged_raises(self, repo: Repo) -> None:
        """Commit with an empty index fails — check=True surfaces it."""
        with pytest.raises(RepoError):
            repo.commit("noop")

    def test_commit_handles_initial_commit(self, repo: Repo) -> None:
        """First commit on a fresh repo works (no parent).

        The fresh-repo fixture has no HEAD; this exercises the
        initial-commit path where git has to create the history from
        scratch.
        """
        (repo.root / "readme.md").write_text("# hello", encoding="utf-8")
        _run_git(repo.root, "add", "readme.md")
        result = repo.commit("initial commit")
        # Verify: log should now show exactly one commit.
        log = _run_git(repo.root, "log", "--oneline").stdout.splitlines()
        assert len(log) == 1
        assert result["sha"] != ""

    def test_reset_hard_discards_staged_and_unstaged(self, repo: Repo) -> None:
        """reset_hard wipes both staged and unstaged changes.

        Sets up a committed file, makes one staged modification and
        one unstaged modification, then verifies both revert after
        reset_hard.
        """
        (repo.root / "a.md").write_text("original\n", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        # Staged modification.
        (repo.root / "a.md").write_text("staged\n", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        # Further unstaged modification on top.
        (repo.root / "a.md").write_text("unstaged\n", encoding="utf-8")
        result = repo.reset_hard()
        assert result == {"status": "ok"}
        # File is back to committed state.
        assert (repo.root / "a.md").read_text(encoding="utf-8") == "original\n"
        # Working tree is clean.
        status = _run_git(repo.root, "status", "--porcelain").stdout
        assert status.strip() == ""

    def test_reset_hard_leaves_untracked_alone(self, repo: Repo) -> None:
        """Untracked files survive reset --hard — matches git's semantics.

        Users rely on this to keep editor scratch files during a
        reset. We verify that ``reset_hard`` doesn't add ``-x`` or
        otherwise clean up untracked content.
        """
        (repo.root / "tracked.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "tracked.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        (repo.root / "scratch.md").write_text("draft", encoding="utf-8")
        repo.reset_hard()
        assert (repo.root / "scratch.md").is_file()
        assert (repo.root / "scratch.md").read_text(encoding="utf-8") == "draft"

    @staticmethod
    def _seed_search_history(repo: Repo) -> list[str]:
        """Create three commits with distinct messages and authors.

        Returns the list of full SHAs in creation order. Callers
        assert against that order. Uses per-commit identity
        overrides so tests don't depend on a fixture-wide author.
        """
        shas: list[str] = []
        entries = [
            ("a.md", "feat: add login form", "Alice", "alice@example.com"),
            ("b.md", "fix: handle empty password", "Bob", "bob@example.com"),
            ("c.md", "docs: note the login flow", "Alice", "alice@example.com"),
        ]
        for i, (filename, message, author_name, author_email) in enumerate(
            entries
        ):
            (repo.root / filename).write_text(
                f"content {i}", encoding="utf-8"
            )
            _run_git(repo.root, "add", filename)
            _run_git(
                repo.root,
                "-c", f"user.name={author_name}",
                "-c", f"user.email={author_email}",
                "commit", "-q", "-m", message,
            )
            sha = _run_git(
                repo.root, "rev-parse", "HEAD"
            ).stdout.strip()
            shas.append(sha)
        return shas

    def test_search_commits_by_message_substring(self, repo: Repo) -> None:
        """Substring match in the commit message hits."""
        self._seed_search_history(repo)
        results = repo.search_commits("login")
        # "login" appears in the feat (a.md) and docs (c.md) commits.
        messages = [r["message"] for r in results]
        assert any("login form" in m for m in messages)
        assert any("login flow" in m for m in messages)
        # The fix commit does not mention login.
        assert not any("handle empty password" in m for m in messages)

    def test_search_commits_is_case_insensitive(self, repo: Repo) -> None:
        """Case-insensitive search — "LOGIN" matches "login"."""
        self._seed_search_history(repo)
        results = repo.search_commits("LOGIN")
        assert len(results) == 2

    def test_search_commits_by_author(self, repo: Repo) -> None:
        """Author name match — --author is OR'd with --grep."""
        self._seed_search_history(repo)
        results = repo.search_commits("Bob")
        # Only Bob's fix commit.
        assert len(results) == 1
        assert "fix" in results[0]["message"]

    def test_search_commits_empty_query_returns_empty(
        self, repo: Repo
    ) -> None:
        """Empty or whitespace-only query returns [] without invoking git."""
        self._seed_search_history(repo)
        assert repo.search_commits("") == []
        assert repo.search_commits("   ") == []

    def test_search_commits_no_matches_returns_empty(self, repo: Repo) -> None:
        """Query with no hits returns an empty list, not an error."""
        self._seed_search_history(repo)
        assert repo.search_commits("zzz-never-appears-in-any-commit") == []

    def test_search_commits_sha_prefix_fast_path(self, repo: Repo) -> None:
        """A query that resolves as a commit SHA returns only that commit.

        The fast-path branch avoids grepping when the query is
        unambiguously a commit — a 7-char SHA prefix like "abc1234"
        that happens to appear in some commit message would
        otherwise produce noisy hits.
        """
        shas = self._seed_search_history(repo)
        short = shas[1][:7]  # prefix of the fix commit
        results = repo.search_commits(short)
        assert len(results) == 1
        assert results[0]["sha"] == shas[1]

    def test_search_commits_result_shape(self, repo: Repo) -> None:
        """Each entry has the documented keys with correct types."""
        self._seed_search_history(repo)
        results = repo.search_commits("login")
        assert len(results) > 0
        entry = results[0]
        assert set(entry.keys()) == {
            "sha", "short_sha", "message", "author", "date",
        }
        assert len(entry["sha"]) == 40
        assert len(entry["short_sha"]) >= 7
        # ISO 8601 date contains 'T' between date and time.
        assert "T" in entry["date"]

    def test_search_commits_respects_limit(self, repo: Repo) -> None:
        """limit caps the number of matches."""
        self._seed_search_history(repo)
        # "login" matches 2 commits; limit=1 truncates.
        results = repo.search_commits("login", limit=1)
        assert len(results) == 1

    def test_search_commits_branch_filter(self, repo: Repo) -> None:
        """branch parameter restricts the search to that branch.

        ``--orphan`` creates a new branch with an empty index but
        leaves the old working-tree files in place. After committing
        the one orphan file, we delete the leftover main-branch
        files from the working tree so the checkout back to main
        can restore them without "would be overwritten" errors.
        """
        self._seed_search_history(repo)
        # Create an orphan branch with a unique commit message.
        _run_git(repo.root, "checkout", "-q", "--orphan", "side")
        _run_git(repo.root, "rm", "-rf", "--cached", ".")
        # Remove the untracked files main left behind before
        # switching back, otherwise checkout refuses the switch.
        for leftover in ("a.md", "b.md", "c.md"):
            (repo.root / leftover).unlink(missing_ok=True)
        (repo.root / "side.md").write_text("side", encoding="utf-8")
        _run_git(repo.root, "add", "side.md")
        _run_git(repo.root, "commit", "-q", "-m", "side: unique marker xyzzy")
        _run_git(repo.root, "checkout", "-q", "main")
        # Without branch, finds xyzzy.
        assert len(repo.search_commits("xyzzy")) >= 1
        # With branch=main, does not.
        assert repo.search_commits("xyzzy", branch="main") == []


# ---------------------------------------------------------------------------
# Branch queries
# ---------------------------------------------------------------------------


class TestBranches:
    """get_current_branch, resolve_ref, list_branches, list_all_branches,
    is_clean."""

    def test_get_current_branch_on_new_branch_reports_name(
        self, repo: Repo
    ) -> None:
        """Regular branch — ``branch`` is set, ``detached`` is False."""
        # Need at least one commit so HEAD resolves.
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        result = repo.get_current_branch()
        assert result["branch"] == "main"
        assert result["detached"] is False
        assert len(result["sha"]) == 40

    def test_get_current_branch_detached_head(self, repo: Repo) -> None:
        """Detached HEAD returns branch=None and detached=True."""
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        sha = _run_git(repo.root, "rev-parse", "HEAD").stdout.strip()
        # Detach by checking out the SHA directly.
        _run_git(repo.root, "checkout", "-q", sha)
        result = repo.get_current_branch()
        assert result["branch"] is None
        assert result["detached"] is True
        assert result["sha"] == sha

    def test_get_current_branch_empty_repo(self, repo: Repo) -> None:
        """Fresh repo with no commits — HEAD doesn't resolve yet.

        We still return a structured dict rather than raising, so
        callers (e.g., the branch badge in the file picker) can
        render a placeholder on first launch of a brand-new repo.
        The fixture already set init.defaultBranch=main and ran a
        ``checkout -b main``, so symbolic-ref should still see
        HEAD pointing at refs/heads/main even without any commits.
        """
        result = repo.get_current_branch()
        # Branch name comes from symbolic-ref, which works even
        # before the first commit as long as HEAD points at a ref.
        assert result["branch"] == "main"
        assert result["detached"] is False
        # No commits yet — rev-parse HEAD fails, so sha is empty.
        assert result["sha"] == ""

    def test_resolve_ref_branch_name(self, repo: Repo) -> None:
        """Branch names resolve to the full tip SHA."""
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        sha = _run_git(repo.root, "rev-parse", "HEAD").stdout.strip()
        assert repo.resolve_ref("main") == sha

    def test_resolve_ref_short_sha(self, repo: Repo) -> None:
        """Short SHA prefixes resolve to the full SHA."""
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        sha = _run_git(repo.root, "rev-parse", "HEAD").stdout.strip()
        short = sha[:7]
        assert repo.resolve_ref(short) == sha

    def test_resolve_ref_tag(self, repo: Repo) -> None:
        """Tag names resolve to the tagged commit's SHA."""
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        _run_git(repo.root, "tag", "v1.0")
        sha = _run_git(repo.root, "rev-parse", "HEAD").stdout.strip()
        assert repo.resolve_ref("v1.0") == sha

    def test_resolve_ref_unknown_returns_none(self, repo: Repo) -> None:
        """Unresolvable refs return None, not raise.

        Callers use this as a lightweight existence probe — raising
        would force every call site into try/except for a case
        that's expected (user typos).
        """
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        assert repo.resolve_ref("no-such-ref") is None

    def test_resolve_ref_empty_returns_none(self, repo: Repo) -> None:
        """Empty or whitespace-only input returns None without invoking git."""
        assert repo.resolve_ref("") is None
        assert repo.resolve_ref("   ") is None

    def test_list_branches_single_branch(self, repo: Repo) -> None:
        """Freshly-committed repo reports exactly one branch, main, current."""
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        result = repo.list_branches()
        assert result["current"] == "main"
        branches = result["branches"]
        assert len(branches) == 1
        entry = branches[0]
        assert entry["name"] == "main"
        assert entry["is_current"] is True
        assert len(entry["sha"]) == 40
        assert entry["message"] == "init"

    def test_list_branches_multiple_branches(self, repo: Repo) -> None:
        """Multiple branches are listed, current flag is exclusive."""
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        _run_git(repo.root, "checkout", "-q", "-b", "feature")
        (repo.root / "b.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "b.md")
        _run_git(repo.root, "commit", "-q", "-m", "feature work")
        _run_git(repo.root, "checkout", "-q", "main")
        result = repo.list_branches()
        names = {b["name"] for b in result["branches"]}
        assert names == {"main", "feature"}
        assert result["current"] == "main"
        # Exactly one branch is marked current.
        current_flags = [b["is_current"] for b in result["branches"]]
        assert current_flags.count(True) == 1

    def test_list_branches_detached_head(self, repo: Repo) -> None:
        """Detached HEAD — branches still listed, current is None.

        Verifies the ``current`` field is None and no branch entry
        has ``is_current=True`` when HEAD is detached. Matches
        ``get_current_branch`` behaviour.
        """
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        sha = _run_git(repo.root, "rev-parse", "HEAD").stdout.strip()
        _run_git(repo.root, "checkout", "-q", sha)
        result = repo.list_branches()
        assert result["current"] is None
        assert all(b["is_current"] is False for b in result["branches"])
        # Main is still listed — being on a detached HEAD doesn't
        # hide the branches that point at commits we're ancestors of.
        names = {b["name"] for b in result["branches"]}
        assert "main" in names

    def test_list_branches_empty_repo(self, repo: Repo) -> None:
        """Fresh repo with no commits — no branches exist yet."""
        result = repo.list_branches()
        assert result["branches"] == []
        # current is None because symbolic-ref resolves to a ref
        # that has no tip commit — for-each-ref emits nothing.
        assert result["current"] is None

    def test_list_all_branches_local_only(self, repo: Repo) -> None:
        """Without any remotes, list_all_branches returns local branches.

        Verifies the local-only path: no remotes configured, only
        local entries come back. All entries have is_remote=False.
        """
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        _run_git(repo.root, "checkout", "-q", "-b", "feature")
        _run_git(repo.root, "commit", "-q", "--allow-empty", "-m", "feat")
        _run_git(repo.root, "checkout", "-q", "main")
        result = repo.list_all_branches()
        names = {b["name"] for b in result}
        assert names == {"main", "feature"}
        # Every entry is local.
        assert all(b["is_remote"] is False for b in result)
        # Exactly one entry is current.
        assert sum(1 for b in result if b["is_current"]) == 1

    def test_list_all_branches_entry_shape(self, repo: Repo) -> None:
        """Each entry has name, sha, is_current, is_remote keys."""
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        result = repo.list_all_branches()
        assert len(result) >= 1
        entry = result[0]
        assert set(entry.keys()) == {"name", "sha", "is_current", "is_remote"}
        assert isinstance(entry["name"], str)
        assert len(entry["sha"]) == 40
        assert isinstance(entry["is_current"], bool)
        assert isinstance(entry["is_remote"], bool)

    def test_list_all_branches_dedups_remote_tracking_branches(
        self, repo: Repo, tmp_path: Path
    ) -> None:
        """Remote tracking branches that match local branches are dropped.

        Sets up a second repo as a bare remote named ``origin``,
        pushes to it, and fetches back. After fetch,
        ``refs/remotes/origin/main`` tracks the local ``main``; the
        list_all_branches dedup should collapse these into a single
        local entry rather than returning both.
        """
        # Bare repo to act as the remote.
        remote_root = tmp_path / "origin.git"
        remote_root.mkdir()
        _run_git(remote_root, "init", "-q", "--bare")

        # Commit in the working repo then push to the fake remote.
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        _run_git(repo.root, "remote", "add", "origin", str(remote_root))
        _run_git(repo.root, "push", "-q", "-u", "origin", "main")

        # Remote tracking ref now exists.
        refs = _run_git(
            repo.root, "for-each-ref", "refs/remotes/", "--format=%(refname)"
        ).stdout
        assert "refs/remotes/origin/main" in refs

        result = repo.list_all_branches()
        names = [b["name"] for b in result]
        # Exactly one entry named "main"; "origin/main" was deduped out.
        assert names.count("main") == 1
        assert "origin/main" not in names

    def test_list_all_branches_includes_distinct_remote_branches(
        self, repo: Repo, tmp_path: Path
    ) -> None:
        """Remote branches without a local counterpart are included.

        When the remote has a branch that doesn't exist locally, it
        shows up as a remote entry (``is_remote=True``) with its
        fully-qualified ``origin/<name>`` label.
        """
        remote_root = tmp_path / "origin.git"
        remote_root.mkdir()
        _run_git(remote_root, "init", "-q", "--bare")

        # Local main + push.
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        _run_git(repo.root, "remote", "add", "origin", str(remote_root))
        _run_git(repo.root, "push", "-q", "-u", "origin", "main")

        # Create a second local branch, push it, then delete the
        # local copy so only the remote tracking ref remains.
        _run_git(repo.root, "checkout", "-q", "-b", "feature")
        _run_git(repo.root, "commit", "-q", "--allow-empty", "-m", "feat")
        _run_git(repo.root, "push", "-q", "-u", "origin", "feature")
        _run_git(repo.root, "checkout", "-q", "main")
        _run_git(repo.root, "branch", "-q", "-D", "feature")

        result = repo.list_all_branches()
        # "feature" gone locally; "origin/feature" should remain.
        names = {b["name"] for b in result}
        assert "feature" not in names
        assert "origin/feature" in names
        # And the entry for origin/feature is marked remote.
        remote_entry = next(b for b in result if b["name"] == "origin/feature")
        assert remote_entry["is_remote"] is True
        assert remote_entry["is_current"] is False

    def test_list_all_branches_filters_bare_remote_alias(
        self, repo: Repo, tmp_path: Path
    ) -> None:
        """``origin`` (no slash) is a remote alias, not a branch — filtered.

        ``git remote add origin <url>`` followed by a fetch can
        produce ``refs/remotes/origin/HEAD`` pointing at the remote's
        default branch, plus the underlying ``refs/remotes/origin/main``.
        Our filter drops ``origin/HEAD`` (symref) but must never emit
        a bare ``origin`` entry either.
        """
        remote_root = tmp_path / "origin.git"
        remote_root.mkdir()
        _run_git(remote_root, "init", "-q", "--bare")
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        _run_git(repo.root, "remote", "add", "origin", str(remote_root))
        _run_git(repo.root, "push", "-q", "-u", "origin", "main")

        result = repo.list_all_branches()
        names = [b["name"] for b in result]
        # No entry is exactly "origin" — that would be the alias.
        assert "origin" not in names
        # And no entry is "origin/HEAD" — that's a symref, filtered.
        assert "origin/HEAD" not in names

    def test_is_clean_on_clean_working_tree(self, repo: Repo) -> None:
        """Freshly-committed repo with no working-tree changes is clean."""
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        assert repo.is_clean() is True

    def test_is_clean_false_with_staged_changes(self, repo: Repo) -> None:
        """Staged modifications make the working tree dirty."""
        (repo.root / "a.md").write_text("v1", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        (repo.root / "a.md").write_text("v2", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        assert repo.is_clean() is False

    def test_is_clean_false_with_unstaged_changes(self, repo: Repo) -> None:
        """Unstaged modifications also count as dirty."""
        (repo.root / "a.md").write_text("v1", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        (repo.root / "a.md").write_text("v2", encoding="utf-8")
        assert repo.is_clean() is False

    def test_is_clean_ignores_untracked_files(self, repo: Repo) -> None:
        """Untracked files don't make the tree dirty — ``-uno`` is passed.

        Users run AC-DC in repos that routinely have editor scratch
        files and ``.ac-dc/`` itself lives in the working tree.
        Review-mode and doc-convert gating would be unusable if every
        untracked file tripped them.
        """
        (repo.root / "tracked.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "tracked.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        (repo.root / "scratch.md").write_text("draft", encoding="utf-8")
        assert repo.is_clean() is True


# ---------------------------------------------------------------------------
# Commit graph and log
# ---------------------------------------------------------------------------


class TestCommitGraph:
    """get_commit_graph, get_commit_log, get_commit_parent, get_merge_base."""

    @staticmethod
    def _seed_linear_history(repo: Repo, count: int = 3) -> list[str]:
        """Create ``count`` linear commits on main.

        Returns the SHAs in creation order (oldest first).
        """
        shas: list[str] = []
        for i in range(count):
            path = repo.root / f"f{i}.md"
            path.write_text(f"content {i}\n", encoding="utf-8")
            _run_git(repo.root, "add", f"f{i}.md")
            _run_git(repo.root, "commit", "-q", "-m", f"commit {i}")
            sha = _run_git(
                repo.root, "rev-parse", "HEAD"
            ).stdout.strip()
            shas.append(sha)
        return shas

    def test_get_commit_graph_returns_expected_shape(self, repo: Repo) -> None:
        """Result has commits, branches, and has_more keys."""
        self._seed_linear_history(repo, count=3)
        result = repo.get_commit_graph()
        assert set(result.keys()) == {"commits", "branches", "has_more"}
        assert isinstance(result["commits"], list)
        assert isinstance(result["branches"], list)
        assert isinstance(result["has_more"], bool)

    def test_get_commit_graph_commit_entries_have_all_fields(
        self, repo: Repo
    ) -> None:
        """Each commit entry has every documented field."""
        self._seed_linear_history(repo, count=3)
        result = repo.get_commit_graph()
        entry = result["commits"][0]
        assert set(entry.keys()) == {
            "sha",
            "short_sha",
            "message",
            "author",
            "date",
            "relative_date",
            "parents",
        }
        assert len(entry["sha"]) == 40
        assert len(entry["short_sha"]) >= 7
        assert isinstance(entry["parents"], list)
        # ISO 8601 contains 'T' between date and time.
        assert "T" in entry["date"]

    def test_get_commit_graph_orders_newest_first(self, repo: Repo) -> None:
        """Commits come back with the most recent first.

        Reverse of the seed order — seed returns oldest-first
        because that's the creation order; the graph returns
        newest-first because that's what users want to see.
        """
        shas = self._seed_linear_history(repo, count=3)
        result = repo.get_commit_graph()
        result_shas = [c["sha"] for c in result["commits"]]
        assert result_shas == list(reversed(shas))

    def test_get_commit_graph_captures_parent_shas(self, repo: Repo) -> None:
        """Each commit's parents list matches git's actual parentage.

        Linear history: each commit has exactly one parent (the
        previous one). The root has zero parents.
        """
        shas = self._seed_linear_history(repo, count=3)
        result = repo.get_commit_graph()
        # commits[0] is the tip (shas[2]); its parent is shas[1].
        # commits[1] is shas[1]; its parent is shas[0].
        # commits[2] is shas[0]; no parent (root commit).
        assert result["commits"][0]["parents"] == [shas[1]]
        assert result["commits"][1]["parents"] == [shas[0]]
        assert result["commits"][2]["parents"] == []

    def test_get_commit_graph_captures_merge_parent(self, repo: Repo) -> None:
        """A merge commit has two parents; both appear in the list."""
        self._seed_linear_history(repo, count=1)
        # Branch off, add a commit, merge back.
        _run_git(repo.root, "checkout", "-q", "-b", "feature")
        (repo.root / "feature.md").write_text("feat", encoding="utf-8")
        _run_git(repo.root, "add", "feature.md")
        _run_git(repo.root, "commit", "-q", "-m", "feature work")
        _run_git(repo.root, "checkout", "-q", "main")
        _run_git(
            repo.root, "merge", "--no-ff", "-q", "feature",
            "-m", "merge feature",
        )
        result = repo.get_commit_graph()
        merge_commit = result["commits"][0]
        # Merge has exactly two parents.
        assert len(merge_commit["parents"]) == 2

    def test_get_commit_graph_respects_limit(self, repo: Repo) -> None:
        """limit caps the number of commits returned."""
        self._seed_linear_history(repo, count=5)
        result = repo.get_commit_graph(limit=2)
        assert len(result["commits"]) == 2
        # has_more is True because we fetched fewer than available.
        assert result["has_more"] is True

    def test_get_commit_graph_has_more_false_when_exhausted(
        self, repo: Repo
    ) -> None:
        """has_more is False when limit >= total commits."""
        self._seed_linear_history(repo, count=3)
        result = repo.get_commit_graph(limit=10)
        assert len(result["commits"]) == 3
        assert result["has_more"] is False

    def test_get_commit_graph_respects_offset(self, repo: Repo) -> None:
        """offset skips the first N commits.

        With 5 commits and offset=2, we see the 3 oldest (in
        newest-first order: commits[2], [1], [0] of the seed list).
        """
        shas = self._seed_linear_history(repo, count=5)
        result = repo.get_commit_graph(limit=10, offset=2)
        result_shas = [c["sha"] for c in result["commits"]]
        # Expected: shas[2], shas[1], shas[0] (newest of the skipped-past batch).
        assert result_shas == [shas[2], shas[1], shas[0]]

    def test_get_commit_graph_empty_repo_returns_empty_commits(
        self, repo: Repo
    ) -> None:
        """Repo with no commits returns an empty commits list.

        ``git log`` on an empty repo exits non-zero, but the graph
        method handles that cleanly — has_more is False, commits
        is empty, branches is empty.
        """
        # No _seed_linear_history call — repo is freshly initialised.
        result = repo.get_commit_graph()
        assert result["commits"] == []
        assert result["has_more"] is False

    def test_get_commit_graph_branches_local_only_by_default(
        self, repo: Repo
    ) -> None:
        """Default branches list is local-only (is_remote all False)."""
        self._seed_linear_history(repo, count=1)
        _run_git(repo.root, "checkout", "-q", "-b", "feature")
        _run_git(repo.root, "commit", "-q", "--allow-empty", "-m", "feat")
        _run_git(repo.root, "checkout", "-q", "main")
        result = repo.get_commit_graph()
        names = {b["name"] for b in result["branches"]}
        assert "main" in names
        assert "feature" in names
        # Every entry has is_remote=False because include_remote
        # defaults to False.
        assert all(b["is_remote"] is False for b in result["branches"])

    def test_get_commit_graph_include_remote_adds_remote_branches(
        self, repo: Repo, tmp_path: Path
    ) -> None:
        """include_remote=True adds remote-only branches to the list.

        Sets up a bare remote, pushes a distinct branch, deletes
        the local copy. With include_remote=True the ``origin/*``
        form shows up in the graph's branches list.
        """
        remote_root = tmp_path / "origin.git"
        remote_root.mkdir()
        _run_git(remote_root, "init", "-q", "--bare")

        self._seed_linear_history(repo, count=1)
        _run_git(repo.root, "remote", "add", "origin", str(remote_root))
        _run_git(repo.root, "push", "-q", "-u", "origin", "main")

        # Create a branch, push, delete locally.
        _run_git(repo.root, "checkout", "-q", "-b", "feature")
        _run_git(repo.root, "commit", "-q", "--allow-empty", "-m", "feat")
        _run_git(repo.root, "push", "-q", "-u", "origin", "feature")
        _run_git(repo.root, "checkout", "-q", "main")
        _run_git(repo.root, "branch", "-q", "-D", "feature")

        result = repo.get_commit_graph(include_remote=True)
        names = {b["name"] for b in result["branches"]}
        assert "origin/feature" in names

    def test_get_commit_log_returns_range_exclusive_of_base(
        self, repo: Repo
    ) -> None:
        """base..head returns commits reachable from head but not from base.

        Three commits; log from shas[0] to HEAD yields shas[2] and
        shas[1] (newest first) — exactly what ``git log base..head``
        normally shows.
        """
        shas = self._seed_linear_history(repo, count=3)
        results = repo.get_commit_log(base=shas[0])
        result_shas = [r["sha"] for r in results]
        # Two commits returned — shas[2] newest, then shas[1].
        assert result_shas == [shas[2], shas[1]]

    def test_get_commit_log_explicit_head(self, repo: Repo) -> None:
        """Passing head explicitly overrides the HEAD default."""
        shas = self._seed_linear_history(repo, count=3)
        # base=shas[0], head=shas[1]: only shas[1] is in the range.
        results = repo.get_commit_log(base=shas[0], head=shas[1])
        result_shas = [r["sha"] for r in results]
        assert result_shas == [shas[1]]

    def test_get_commit_log_respects_limit(self, repo: Repo) -> None:
        """limit caps the number of commits returned."""
        shas = self._seed_linear_history(repo, count=5)
        results = repo.get_commit_log(base=shas[0], limit=2)
        assert len(results) == 2

    def test_get_commit_log_entry_shape(self, repo: Repo) -> None:
        """Each entry has the documented keys with correct types."""
        shas = self._seed_linear_history(repo, count=2)
        results = repo.get_commit_log(base=shas[0])
        assert len(results) == 1
        entry = results[0]
        assert set(entry.keys()) == {
            "sha", "short_sha", "message", "author", "date",
        }
        assert len(entry["sha"]) == 40

    def test_get_commit_log_empty_range(self, repo: Repo) -> None:
        """When head is at base, the range is empty.

        This is the "nothing to review" case — user picked a base
        commit at the very tip of the branch.
        """
        shas = self._seed_linear_history(repo, count=2)
        # base=HEAD means no commits reachable beyond it.
        results = repo.get_commit_log(base=shas[1], head=shas[1])
        assert results == []

    def test_get_commit_parent_returns_parent_sha(self, repo: Repo) -> None:
        """Parent SHA is returned with full and short forms."""
        shas = self._seed_linear_history(repo, count=3)
        result = repo.get_commit_parent(shas[2])
        assert "error" not in result
        assert result["sha"] == shas[1]
        assert len(result["short_sha"]) >= 7
        # short_sha is a prefix of the full sha.
        assert shas[1].startswith(result["short_sha"])

    def test_get_commit_parent_accepts_ref_name(self, repo: Repo) -> None:
        """Parent resolution works for ref names, not just SHAs."""
        shas = self._seed_linear_history(repo, count=2)
        result = repo.get_commit_parent("HEAD")
        # HEAD's parent is shas[0] (the root commit).
        assert result["sha"] == shas[0]

    def test_get_commit_parent_of_root_returns_error(self, repo: Repo) -> None:
        """The root commit has no parent — structured error, not raise."""
        shas = self._seed_linear_history(repo, count=1)
        result = repo.get_commit_parent(shas[0])
        assert "error" in result
        assert "sha" not in result

    def test_get_commit_parent_unknown_ref_returns_error(
        self, repo: Repo
    ) -> None:
        """Unresolvable commit reference returns a structured error."""
        self._seed_linear_history(repo, count=1)
        result = repo.get_commit_parent("no-such-commit")
        assert "error" in result

    def test_get_merge_base_linear_history_returns_older_commit(
        self, repo: Repo
    ) -> None:
        """With two refs on a linear chain, the older commit is the base.

        ``git merge-base A B`` returns the best common ancestor. On
        a linear history where B is an ancestor of A, the answer is
        just B itself. This is the simplest case that exercises the
        explicit two-ref path.
        """
        shas = self._seed_linear_history(repo, count=3)
        # shas[0] is ancestor of shas[2]; merge-base is shas[0].
        result = repo.get_merge_base(shas[2], shas[0])
        assert "error" not in result
        assert result["sha"] == shas[0]
        assert len(result["short_sha"]) >= 7
        assert shas[0].startswith(result["short_sha"])

    def test_get_merge_base_diverged_branches(self, repo: Repo) -> None:
        """Branches that diverged return their common ancestor.

        This is the shape review mode sees: a feature branch forked
        from main, each adds commits independently. merge-base is
        the fork point.
        """
        shas = self._seed_linear_history(repo, count=2)
        fork_sha = shas[1]
        # Branch off at HEAD and add a commit.
        _run_git(repo.root, "checkout", "-q", "-b", "feature")
        (repo.root / "feat.md").write_text("feat", encoding="utf-8")
        _run_git(repo.root, "add", "feat.md")
        _run_git(repo.root, "commit", "-q", "-m", "feat work")
        # Return to main and add a commit there too.
        _run_git(repo.root, "checkout", "-q", "main")
        (repo.root / "main_more.md").write_text("more", encoding="utf-8")
        _run_git(repo.root, "add", "main_more.md")
        _run_git(repo.root, "commit", "-q", "-m", "main work")
        # merge-base of the two tips is the fork point.
        result = repo.get_merge_base("feature", "main")
        assert result["sha"] == fork_sha

    def test_get_merge_base_cascade_finds_main(self, repo: Repo) -> None:
        """With no explicit ref₂, the cascade finds ``main`` first.

        Review mode calls ``get_merge_base(branch_tip)`` and expects
        the method to probe common target-branch names (main, then
        master) until one succeeds.
        """
        shas = self._seed_linear_history(repo, count=2)
        fork_sha = shas[1]
        _run_git(repo.root, "checkout", "-q", "-b", "feature")
        _run_git(repo.root, "commit", "-q", "--allow-empty", "-m", "feat")
        # ref₂ omitted — cascade kicks in, finds main.
        result = repo.get_merge_base("feature")
        assert result["sha"] == fork_sha

    def test_get_merge_base_cascade_falls_through_to_master(
        self, repo: Repo
    ) -> None:
        """When main is absent, the cascade tries master next.

        Some repos still use ``master`` as the default branch. We
        rename the seeded branch from main→master and verify the
        cascade's second candidate succeeds.
        """
        shas = self._seed_linear_history(repo, count=2)
        fork_sha = shas[1]
        # Rename main to master.
        _run_git(repo.root, "branch", "-m", "main", "master")
        _run_git(repo.root, "checkout", "-q", "-b", "feature")
        _run_git(repo.root, "commit", "-q", "--allow-empty", "-m", "feat")
        result = repo.get_merge_base("feature")
        assert result["sha"] == fork_sha

    def test_get_merge_base_cascade_exhausted_returns_error(
        self, repo: Repo
    ) -> None:
        """When no cascade candidate resolves, a structured error is returned.

        Rename ``main`` to something outside the cascade's candidate
        list (``main`` → ``development``). With no ``main`` and no
        ``master`` present, cascade has nothing to match against.
        """
        shas = self._seed_linear_history(repo, count=1)
        _run_git(repo.root, "branch", "-m", "main", "development")
        result = repo.get_merge_base(shas[0])
        assert "error" in result
        assert "sha" not in result

    def test_get_merge_base_unrelated_histories_returns_error(
        self, repo: Repo
    ) -> None:
        """Two histories that share no ancestor return a structured error.

        Two orphan branches created with ``--orphan`` share no
        history whatsoever — no common ancestor exists for git
        merge-base to return. Our explicit two-ref path surfaces
        this as ``{"error": ...}`` rather than raising.
        """
        # One commit on main.
        self._seed_linear_history(repo, count=1)
        # Orphan branch with no shared history.
        _run_git(repo.root, "checkout", "-q", "--orphan", "detached")
        _run_git(repo.root, "rm", "-rf", "--cached", ".")
        # Orphan leaves previous working-tree files in place — clear
        # them so the orphan commit has a clean slate.
        for leftover in ("f0.md",):
            (repo.root / leftover).unlink(missing_ok=True)
        (repo.root / "detached.md").write_text("orphan", encoding="utf-8")
        _run_git(repo.root, "add", "detached.md")
        _run_git(repo.root, "commit", "-q", "-m", "orphan root")
        # Explicit two-ref call — no cascade. main and detached
        # share no history, so merge-base returns nothing.
        result = repo.get_merge_base("detached", "main")
        assert "error" in result
        assert "sha" not in result


# ---------------------------------------------------------------------------
# File tree and flat listing
# ---------------------------------------------------------------------------


class TestFileTree:
    """get_flat_file_list and get_file_tree — porcelain-driven tree build."""

    def test_get_flat_file_list_empty_repo_returns_empty_string(
        self, repo: Repo
    ) -> None:
        """Fresh repo with no files returns the empty string.

        Prompt assembly just concatenates this into the file-tree
        section; an empty string is the cleanest representation of
        "there are no files yet".
        """
        assert repo.get_flat_file_list() == ""

    def test_get_flat_file_list_tracked_files_appear_sorted(
        self, repo: Repo
    ) -> None:
        """Tracked files come back one per line, sorted alphabetically."""
        (repo.root / "b.md").write_text("b", encoding="utf-8")
        (repo.root / "a.md").write_text("a", encoding="utf-8")
        (repo.root / "c.md").write_text("c", encoding="utf-8")
        _run_git(repo.root, "add", "a.md", "b.md", "c.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        assert repo.get_flat_file_list() == "a.md\nb.md\nc.md"

    def test_get_flat_file_list_includes_untracked(self, repo: Repo) -> None:
        """Untracked, non-ignored files are listed alongside tracked."""
        (repo.root / "tracked.md").write_text("t", encoding="utf-8")
        _run_git(repo.root, "add", "tracked.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        (repo.root / "new.md").write_text("n", encoding="utf-8")
        lines = repo.get_flat_file_list().splitlines()
        assert "tracked.md" in lines
        assert "new.md" in lines

    def test_get_flat_file_list_respects_gitignore(self, repo: Repo) -> None:
        """Ignored files never appear in the flat list."""
        (repo.root / ".gitignore").write_text("*.log\n", encoding="utf-8")
        _run_git(repo.root, "add", ".gitignore")
        _run_git(repo.root, "commit", "-q", "-m", "add gitignore")
        (repo.root / "debug.log").write_text("noise", encoding="utf-8")
        (repo.root / "keep.md").write_text("keep", encoding="utf-8")
        lines = repo.get_flat_file_list().splitlines()
        assert "debug.log" not in lines
        assert "keep.md" in lines
        assert ".gitignore" in lines

    def test_get_flat_file_list_dedups_tracked_and_untracked_sets(
        self, repo: Repo
    ) -> None:
        """Files that appear in both tracked and untracked sets are deduped.

        Edge case: ``ls-files --others`` can surface tracked files
        during some index states. The method unions the two sets
        rather than concatenating, so no duplicates slip through.
        """
        (repo.root / "a.md").write_text("a", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        lines = repo.get_flat_file_list().splitlines()
        assert lines.count("a.md") == 1

    def test_get_file_tree_returns_documented_shape(self, repo: Repo) -> None:
        """Result has the six documented keys with correct types."""
        (repo.root / "a.md").write_text("a", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        result = repo.get_file_tree()
        assert set(result.keys()) == {
            "tree",
            "modified",
            "staged",
            "untracked",
            "deleted",
            "diff_stats",
        }
        assert isinstance(result["tree"], dict)
        assert isinstance(result["modified"], list)
        assert isinstance(result["staged"], list)
        assert isinstance(result["untracked"], list)
        assert isinstance(result["deleted"], list)
        assert isinstance(result["diff_stats"], dict)

    def test_get_file_tree_root_matches_repo_name(self, repo: Repo) -> None:
        """The tree root's name matches the repo directory basename.

        The file picker uses this as the display label at the top of
        the tree. Fixture creates the repo at ``tmp_path / "repo"``
        so the basename is ``"repo"``.
        """
        root = repo.get_file_tree()["tree"]
        assert root["name"] == repo.name
        assert root["path"] == ""
        assert root["type"] == "dir"

    def test_get_file_tree_empty_repo_has_no_children(self, repo: Repo) -> None:
        """Fresh repo's tree root has an empty children list.

        All four status arrays are empty too. Confirms the method
        handles the no-files-yet case without crashing on empty
        porcelain output.
        """
        result = repo.get_file_tree()
        assert result["tree"]["children"] == []
        assert result["modified"] == []
        assert result["staged"] == []
        assert result["untracked"] == []
        assert result["deleted"] == []
        assert result["diff_stats"] == {}

    def test_get_file_tree_single_file(self, repo: Repo) -> None:
        """A single tracked file appears as one child of the root."""
        (repo.root / "readme.md").write_text(
            "hello\nworld\n", encoding="utf-8"
        )
        _run_git(repo.root, "add", "readme.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        root = repo.get_file_tree()["tree"]
        assert len(root["children"]) == 1
        child = root["children"][0]
        assert child["name"] == "readme.md"
        assert child["path"] == "readme.md"
        assert child["type"] == "file"
        # Two lines, both newline-terminated → 2 newlines counted.
        assert child["lines"] == 2
        # mtime is populated for files.
        assert "mtime" in child
        assert isinstance(child["mtime"], float)
        assert child["mtime"] > 0

    def test_get_file_tree_creates_directory_nodes(self, repo: Repo) -> None:
        """Files inside nested directories create intermediate dir nodes.

        Verifies ``src/utils/helpers.py`` produces:
          root → src/ → utils/ → helpers.py
        """
        (repo.root / "src" / "utils").mkdir(parents=True)
        (repo.root / "src" / "utils" / "helpers.py").write_text(
            "def foo():\n    pass\n", encoding="utf-8"
        )
        _run_git(repo.root, "add", "src/utils/helpers.py")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        root = repo.get_file_tree()["tree"]
        # src/
        assert len(root["children"]) == 1
        src_node = root["children"][0]
        assert src_node["name"] == "src"
        assert src_node["path"] == "src"
        assert src_node["type"] == "dir"
        # Directory line counts are 0.
        assert src_node["lines"] == 0
        # utils/
        assert len(src_node["children"]) == 1
        utils_node = src_node["children"][0]
        assert utils_node["name"] == "utils"
        assert utils_node["path"] == "src/utils"
        assert utils_node["type"] == "dir"
        # helpers.py
        assert len(utils_node["children"]) == 1
        file_node = utils_node["children"][0]
        assert file_node["name"] == "helpers.py"
        assert file_node["path"] == "src/utils/helpers.py"
        assert file_node["type"] == "file"
        assert file_node["lines"] == 2

    def test_get_file_tree_sorts_dirs_before_files(self, repo: Repo) -> None:
        """Directories sort before files within each level, alphabetical within type.

        File-picker UI expectation — dirs bubble to the top so users
        can navigate down the tree without hunting past files first.
        Within each type (dir/file) the order is alphabetical.
        """
        # Name the file "aaa.md" and the dir "zzz" — alphabetically
        # the file would come first, but our sort must put the dir
        # first regardless.
        (repo.root / "aaa.md").write_text("file", encoding="utf-8")
        (repo.root / "zzz").mkdir()
        (repo.root / "zzz" / "inner.md").write_text("x", encoding="utf-8")
        _run_git(repo.root, "add", "aaa.md", "zzz/inner.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        root = repo.get_file_tree()["tree"]
        children = root["children"]
        assert len(children) == 2
        # Dir comes first.
        assert children[0]["name"] == "zzz"
        assert children[0]["type"] == "dir"
        # File comes second.
        assert children[1]["name"] == "aaa.md"
        assert children[1]["type"] == "file"

    def test_get_file_tree_sorts_within_type_alphabetically(
        self, repo: Repo
    ) -> None:
        """Within dirs or within files, entries sort alphabetically."""
        (repo.root / "banana.md").write_text("b", encoding="utf-8")
        (repo.root / "apple.md").write_text("a", encoding="utf-8")
        (repo.root / "cherry.md").write_text("c", encoding="utf-8")
        _run_git(repo.root, "add", "apple.md", "banana.md", "cherry.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        root = repo.get_file_tree()["tree"]
        names = [c["name"] for c in root["children"]]
        assert names == ["apple.md", "banana.md", "cherry.md"]

    def test_get_file_tree_binary_file_has_zero_lines(self, repo: Repo) -> None:
        """Binary files report lines: 0 — no useful count for the badge.

        File picker colour-codes line counts for text files; for
        binary content there's nothing meaningful to count, so the
        method returns 0 and the UI shows no badge.
        """
        # A few null bytes → detected as binary by the 8KB probe.
        (repo.root / "blob.bin").write_bytes(b"MZ\x00\x90" + b"\x00" * 50)
        _run_git(repo.root, "add", "blob.bin")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        root = repo.get_file_tree()["tree"]
        assert len(root["children"]) == 1
        blob_node = root["children"][0]
        assert blob_node["type"] == "file"
        assert blob_node["lines"] == 0

    def test_get_file_tree_directory_nodes_have_no_mtime_field(
        self, repo: Repo
    ) -> None:
        """Directory nodes do not carry an mtime — files only.

        specs4/1-foundation/repository.md lists mtime as a file-only
        property. Directories aggregate timestamps of their children;
        a directory-level mtime wouldn't convey anything actionable
        for the file picker, so we omit it entirely.
        """
        (repo.root / "src").mkdir()
        (repo.root / "src" / "a.md").write_text("a", encoding="utf-8")
        _run_git(repo.root, "add", "src/a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        root = repo.get_file_tree()["tree"]
        src_node = root["children"][0]
        assert src_node["type"] == "dir"
        assert "mtime" not in src_node
        file_node = src_node["children"][0]
        assert file_node["type"] == "file"
        assert "mtime" in file_node

    def test_get_file_tree_classifies_modified_file(self, repo: Repo) -> None:
        """Tracked file with unstaged modification appears in 'modified'."""
        (repo.root / "a.md").write_text("v1", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        (repo.root / "a.md").write_text("v2", encoding="utf-8")
        result = repo.get_file_tree()
        assert result["modified"] == ["a.md"]
        assert result["staged"] == []
        assert result["untracked"] == []
        assert result["deleted"] == []

    def test_get_file_tree_classifies_staged_add(self, repo: Repo) -> None:
        """Newly-staged addition appears in 'staged'."""
        # Seed commit so HEAD resolves (some edge cases differ for
        # the initial-commit state).
        (repo.root / "seed.md").write_text("s", encoding="utf-8")
        _run_git(repo.root, "add", "seed.md")
        _run_git(repo.root, "commit", "-q", "-m", "seed")
        (repo.root / "new.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "new.md")
        result = repo.get_file_tree()
        assert "new.md" in result["staged"]
        # new.md is staged and not modified in the working tree, so
        # 'modified' stays empty.
        assert result["modified"] == []

    def test_get_file_tree_classifies_untracked(self, repo: Repo) -> None:
        """A file never added to the index appears in 'untracked'."""
        (repo.root / "seed.md").write_text("s", encoding="utf-8")
        _run_git(repo.root, "add", "seed.md")
        _run_git(repo.root, "commit", "-q", "-m", "seed")
        (repo.root / "scratch.md").write_text("draft", encoding="utf-8")
        result = repo.get_file_tree()
        assert "scratch.md" in result["untracked"]
        # And it also shows up in the tree under the root.
        names = {c["name"] for c in result["tree"]["children"]}
        assert "scratch.md" in names

    def test_get_file_tree_classifies_deleted(self, repo: Repo) -> None:
        """A removed tracked file appears in 'deleted' only.

        Porcelain reports deleted-but-unstaged tracked files with
        ``X=' '`` (index unchanged) and ``Y='D'`` (worktree deleted).
        The parser routes Y='D' into the ``deleted`` list
        exclusively — the file-picker UI shows a single 'deleted'
        badge on the tree node, not 'deleted+modified'. The
        modified list is for Y='M'/'T' only (content edits, type
        changes), which is a genuinely different visual state.
        """
        (repo.root / "doomed.md").write_text("bye", encoding="utf-8")
        _run_git(repo.root, "add", "doomed.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        (repo.root / "doomed.md").unlink()
        result = repo.get_file_tree()
        assert result["deleted"] == ["doomed.md"]
        # Not in modified — the two lists are disjoint for delete entries.
        assert "doomed.md" not in result["modified"]

    def test_get_file_tree_includes_deleted_files_in_tree(
        self, repo: Repo
    ) -> None:
        """Deleted files still appear as nodes in the tree.

        Picker shows them with a 'deleted' badge so users can recover
        them via 'discard changes'. If we filtered them out of the
        tree, users would have no UI to click on.
        """
        (repo.root / "doomed.md").write_text("bye", encoding="utf-8")
        _run_git(repo.root, "add", "doomed.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        (repo.root / "doomed.md").unlink()
        root = repo.get_file_tree()["tree"]
        names = {c["name"] for c in root["children"]}
        assert "doomed.md" in names

    def test_get_file_tree_rename_appears_in_staged_list(
        self, repo: Repo
    ) -> None:
        """``R  old -> new`` porcelain entries stage both paths.

        The porcelain parser expands rename entries so both the
        source and destination are recorded as staged. Matches the
        spec: "Each path is added to the staged array. Each path
        segment may be individually quoted."
        """
        (repo.root / "old.md").write_text("content", encoding="utf-8")
        _run_git(repo.root, "add", "old.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        _run_git(repo.root, "mv", "old.md", "new.md")
        result = repo.get_file_tree()
        # Both old and new paths appear in staged.
        assert "old.md" in result["staged"]
        assert "new.md" in result["staged"]

    def test_get_file_tree_diff_stats_for_unstaged_modification(
        self, repo: Repo
    ) -> None:
        """Unstaged line changes are captured in diff_stats."""
        (repo.root / "a.md").write_text(
            "line1\nline2\nline3\n", encoding="utf-8"
        )
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        # Remove one line, add two → +2 -1 in numstat.
        (repo.root / "a.md").write_text(
            "line1\nnew2\nnew2b\nline3\n", encoding="utf-8"
        )
        result = repo.get_file_tree()
        assert "a.md" in result["diff_stats"]
        stats = result["diff_stats"]["a.md"]
        assert stats["additions"] == 2
        assert stats["deletions"] == 1

    def test_get_file_tree_diff_stats_merges_staged_and_unstaged(
        self, repo: Repo
    ) -> None:
        """Per-file diff_stats sum additions/deletions across both sides.

        File picker shows total churn per file. When a file has both
        staged and unstaged edits, numstat entries from both sources
        merge. This test exercises the merging branch in the parser.
        """
        (repo.root / "a.md").write_text("x\n", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        # Stage a change: +1 -0.
        (repo.root / "a.md").write_text("x\ny\n", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        # Further unstaged change on top: +1 -0.
        (repo.root / "a.md").write_text("x\ny\nz\n", encoding="utf-8")
        result = repo.get_file_tree()
        stats = result["diff_stats"]["a.md"]
        # Merged: 2 additions total, 0 deletions.
        assert stats["additions"] == 2
        assert stats["deletions"] == 0

    def test_get_file_tree_diff_stats_binary_file_zero_counts(
        self, repo: Repo
    ) -> None:
        """Binary diffs (numstat reports '-') produce 0/0 counts.

        numstat emits ``-`` for both counts on binary files. The
        parser maps those to 0 rather than raising — the file picker
        has no useful way to render "binary diff stats".
        """
        # Initial binary blob.
        blob_a = b"MZ\x00\x90" + b"\x00" * 100
        (repo.root / "blob.bin").write_bytes(blob_a)
        _run_git(repo.root, "add", "blob.bin")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        # Modify the binary content.
        blob_b = b"MZ\x00\x91" + b"\xff" * 100
        (repo.root / "blob.bin").write_bytes(blob_b)
        result = repo.get_file_tree()
        stats = result["diff_stats"].get("blob.bin")
        # Entry exists but both counts are 0.
        assert stats == {"additions": 0, "deletions": 0}

    def test_get_file_tree_diff_stats_empty_when_clean(self, repo: Repo) -> None:
        """Clean working tree has no entries in diff_stats."""
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        assert repo.get_file_tree()["diff_stats"] == {}

    def test_get_file_tree_excludes_gitignored_files(self, repo: Repo) -> None:
        """Ignored files never appear in the tree or any status list.

        File tree is built from ``git ls-files`` (tracked) +
        ``git ls-files --others --exclude-standard`` (untracked,
        non-ignored). Gitignore matches are dropped from both.
        """
        (repo.root / ".gitignore").write_text("*.log\n", encoding="utf-8")
        _run_git(repo.root, "add", ".gitignore")
        _run_git(repo.root, "commit", "-q", "-m", "add gitignore")
        # Tracked, ignored file — shouldn't appear even though it
        # exists on disk.
        (repo.root / "debug.log").write_text("noise", encoding="utf-8")
        (repo.root / "keep.md").write_text("keep", encoding="utf-8")
        result = repo.get_file_tree()
        names = {c["name"] for c in result["tree"]["children"]}
        assert "debug.log" not in names
        assert "keep.md" in names
        assert ".gitignore" in names
        # Also not in any status list.
        assert "debug.log" not in result["untracked"]
        assert "debug.log" not in result["modified"]
        assert "debug.log" not in result["staged"]

    def test_get_file_tree_unquotes_paths_with_spaces(self, repo: Repo) -> None:
        """Paths with spaces are unquoted from porcelain output.

        Git wraps paths containing special characters (spaces,
        non-ASCII) in double quotes with backslash escapes. The
        parser reverses that before emitting the tree node and
        status-list entries, so the UI never sees literal quotes
        around filenames.
        """
        weird_name = "has space.md"
        (repo.root / weird_name).write_text("hi", encoding="utf-8")
        result = repo.get_file_tree()
        # Untracked list — quotes stripped.
        assert weird_name in result["untracked"]
        # Tree node — also unquoted.
        names = {c["name"] for c in result["tree"]["children"]}
        assert weird_name in names

    def test_get_file_tree_classifies_nested_modified_file(
        self, repo: Repo
    ) -> None:
        """Status classification works for files in subdirectories.

        The tree builder and porcelain parser agree on repo-relative
        path format (forward slash separators, no leading dot-slash).
        Status lists contain these paths verbatim, and the tree node
        corresponding to the file is findable by walking children.
        """
        (repo.root / "src").mkdir()
        (repo.root / "src" / "a.md").write_text("v1", encoding="utf-8")
        _run_git(repo.root, "add", "src/a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        (repo.root / "src" / "a.md").write_text("v2", encoding="utf-8")
        result = repo.get_file_tree()
        # Status list uses the nested path as-is.
        assert result["modified"] == ["src/a.md"]
        # And the tree has a src/ node containing a.md.
        root = result["tree"]
        src = next(c for c in root["children"] if c["name"] == "src")
        assert src["type"] == "dir"
        file_node = next(
            c for c in src["children"] if c["name"] == "a.md"
        )
        assert file_node["path"] == "src/a.md"

    def test_get_file_tree_nested_gitignore_excludes_subdirectory_files(
        self, repo: Repo
    ) -> None:
        """A .gitignore in a subdirectory excludes files under that subdir.

        Files like ``src/debug.log`` are caught by the subdirectory's
        own gitignore rule; they must not leak into the tree or any
        status list.
        """
        (repo.root / "src").mkdir()
        (repo.root / ".gitignore").write_text("*.log\n", encoding="utf-8")
        _run_git(repo.root, "add", ".gitignore")
        _run_git(repo.root, "commit", "-q", "-m", "add gitignore")
        # File in a subdirectory matching the parent-level rule.
        (repo.root / "src" / "debug.log").write_text("noise", encoding="utf-8")
        (repo.root / "src" / "keep.md").write_text("keep", encoding="utf-8")
        result = repo.get_file_tree()
        # The src/ dir node is present (because keep.md is).
        root = result["tree"]
        src = next((c for c in root["children"] if c["name"] == "src"), None)
        assert src is not None
        names_in_src = {c["name"] for c in src["children"]}
        assert "keep.md" in names_in_src
        assert "debug.log" not in names_in_src
        # Also absent from status lists.
        assert "src/debug.log" not in result["untracked"]


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------


class TestSearch:
    """search_files — git grep wrapper with regex/word/case/context flags."""

    @staticmethod
    def _seed_corpus(repo: Repo) -> None:
        """Commit a small grep-able corpus.

        Three files with deliberately varied content — different
        casing, shared substrings, and lines that are suitable
        context neighbours for the context-lines tests.
        """
        (repo.root / "README.md").write_text(
            "Welcome to the project.\n"
            "This is AC-DC.\n"
            "Enjoy.\n",
            encoding="utf-8",
        )
        (repo.root / "src.py").write_text(
            "def hello():\n"
            "    return 'hello world'\n"
            "\n"
            "def farewell():\n"
            "    return 'goodbye'\n",
            encoding="utf-8",
        )
        (repo.root / "notes.txt").write_text(
            "hello again\n"
            "HELLO in caps\n"
            "nothing to see\n",
            encoding="utf-8",
        )
        _run_git(repo.root, "add", "README.md", "src.py", "notes.txt")
        _run_git(repo.root, "commit", "-q", "-m", "seed corpus")

    def test_empty_query_returns_empty(self, repo: Repo) -> None:
        """Empty or whitespace-only query returns [] without invoking git."""
        self._seed_corpus(repo)
        assert repo.search_files("") == []
        assert repo.search_files("   ") == []

    def test_simple_match_fixed_string_default(self, repo: Repo) -> None:
        """Plain substring match — default mode is fixed-string.

        Regex metacharacters in the query are NOT interpreted when
        ``use_regex=False`` (the default). The query 'hello' hits
        every file that literally contains that substring.
        """
        self._seed_corpus(repo)
        results = repo.search_files("hello")
        files = {r["file"] for r in results}
        # 'hello' appears in src.py and notes.txt, plus HELLO
        # (case-insensitive default). README says neither.
        assert "src.py" in files
        assert "notes.txt" in files
        assert "README.md" not in files

    def test_no_match_returns_empty(self, repo: Repo) -> None:
        """Query with no hits returns an empty list, not an error."""
        self._seed_corpus(repo)
        assert repo.search_files("xyzzy-never-appears") == []

    def test_case_sensitive_mode(self, repo: Repo) -> None:
        """``ignore_case=False`` excludes mismatched-case hits.

        The corpus has ``hello`` (lowercase) in src.py and notes.txt,
        and ``HELLO`` (uppercase) in notes.txt. Case-sensitive
        search for 'hello' should still match both source files
        (both contain the lowercase form) but NOT match the HELLO
        line specifically.
        """
        self._seed_corpus(repo)
        results = repo.search_files("hello", ignore_case=False)
        # Collect all matched line texts across files.
        all_match_texts = [
            m["line"]
            for r in results
            for m in r["matches"]
        ]
        # "HELLO in caps" should NOT be among the matches.
        assert not any("HELLO in caps" == t for t in all_match_texts)
        # Lowercase forms should still match.
        assert any("hello" in t and "HELLO" not in t for t in all_match_texts)

    def test_case_insensitive_default_matches_both_cases(self, repo: Repo) -> None:
        """The default (``ignore_case=True``) hits both cases.

        Counter-test to ``test_case_sensitive_mode``: confirms that
        without the flag, HELLO and hello both match.
        """
        self._seed_corpus(repo)
        results = repo.search_files("hello")
        all_texts = [m["line"] for r in results for m in r["matches"]]
        assert any("HELLO in caps" == t for t in all_texts)
        assert any("hello again" == t for t in all_texts)

    def test_whole_word_rejects_substring_match(self, repo: Repo) -> None:
        """``whole_word=True`` requires word boundaries on both sides.

        'hell' is a substring of 'hello' but not a whole word.
        Without the flag, 'hell' would hit 'hello'; with it, the
        hit is rejected. The corpus has no standalone 'hell' token,
        so results should be empty.
        """
        self._seed_corpus(repo)
        results = repo.search_files("hell", whole_word=True)
        assert results == []
        # Sanity check — without whole_word, 'hell' does hit.
        substr_results = repo.search_files("hell", whole_word=False)
        assert len(substr_results) > 0

    def test_whole_word_accepts_standalone_token(self, repo: Repo) -> None:
        """Whole-word mode still matches when the token IS a whole word.

        'hello' appears as a standalone token in 'hello again' and
        'hello world'. Whole-word mode should still find those.
        """
        self._seed_corpus(repo)
        results = repo.search_files("hello", whole_word=True)
        files = {r["file"] for r in results}
        assert "src.py" in files
        assert "notes.txt" in files

    def test_regex_mode_interprets_metacharacters(self, repo: Repo) -> None:
        """``use_regex=True`` treats the query as an extended regex.

        ``hel+o`` means 'he', one or more 'l', 'o'. Matches 'hello'
        and 'hellllo' if it existed. Without regex mode this would
        be a literal string that appears nowhere.
        """
        self._seed_corpus(repo)
        regex_results = repo.search_files("hel+o", use_regex=True)
        # Should find 'hello' in src.py (and HELLO case-insensitively
        # in notes.txt).
        files = {r["file"] for r in regex_results}
        assert "src.py" in files
        # Without regex — the literal string 'hel+o' doesn't exist.
        literal_results = repo.search_files("hel+o", use_regex=False)
        assert literal_results == []

    def test_regex_metacharacters_literal_by_default(self, repo: Repo) -> None:
        """Default fixed-string mode escapes regex metacharacters.

        A query like '[.]' would be a char-class containing a dot
        in regex, but as a literal string it's four characters.
        Neither matches the corpus, but the test proves the search
        doesn't crash and returns empty cleanly — verifying
        --fixed-strings is in effect (a regex parse error would
        surface differently).
        """
        self._seed_corpus(repo)
        # Query that's regex-invalid in some engines but a fine
        # literal string: unbalanced bracket.
        results = repo.search_files("[unclosed")
        assert results == []

    def test_query_starting_with_dash_is_not_treated_as_flag(
        self, repo: Repo
    ) -> None:
        """A query like ``--foo`` is treated as content, not a git option.

        The ``-e`` flag in the invocation explicitly marks the
        query as a pattern, preventing git from mistaking a
        leading-dash query for an option (which would error or —
        worse — silently do something unexpected).
        """
        (repo.root / "flags.md").write_text(
            "running with --foo enabled\nother content\n",
            encoding="utf-8",
        )
        _run_git(repo.root, "add", "flags.md")
        _run_git(repo.root, "commit", "-q", "-m", "add flags")
        results = repo.search_files("--foo")
        files = {r["file"] for r in results}
        assert "flags.md" in files

    def test_result_shape_per_file_entry(self, repo: Repo) -> None:
        """Each per-file entry has ``file`` and ``matches`` keys."""
        self._seed_corpus(repo)
        results = repo.search_files("hello")
        assert len(results) > 0
        entry = results[0]
        assert set(entry.keys()) == {"file", "matches"}
        assert isinstance(entry["file"], str)
        assert isinstance(entry["matches"], list)

    def test_result_shape_per_match_entry(self, repo: Repo) -> None:
        """Each match has line_num, line, context_before, context_after."""
        self._seed_corpus(repo)
        results = repo.search_files("hello")
        # Pick any non-empty match list.
        match = next(m for r in results for m in r["matches"])
        assert set(match.keys()) == {
            "line_num",
            "line",
            "context_before",
            "context_after",
        }
        assert isinstance(match["line_num"], int)
        assert match["line_num"] >= 1
        assert isinstance(match["line"], str)
        assert isinstance(match["context_before"], list)
        assert isinstance(match["context_after"], list)

    def test_context_before_contains_preceding_line(self, repo: Repo) -> None:
        """With ``context_lines=1``, the match for 'hello world' (line 2
        of src.py) has 'def hello():' (line 1) as a match of its own.

        Actually — 'def hello():' ALSO contains 'hello', so it's a
        match too, not a context line. We need a test corpus where
        the context lines don't themselves match. Use the README,
        which has 'AC-DC' on line 2 surrounded by non-matching lines.
        """
        self._seed_corpus(repo)
        results = repo.search_files("AC-DC", context_lines=1)
        # Should find one file (README.md) with one match.
        assert len(results) == 1
        assert results[0]["file"] == "README.md"
        matches = results[0]["matches"]
        assert len(matches) == 1
        match = matches[0]
        # The match is on line 2.
        assert match["line_num"] == 2
        assert "AC-DC" in match["line"]
        # context_before: one entry (line 1, "Welcome to the project.").
        assert len(match["context_before"]) == 1
        before = match["context_before"][0]
        assert before["line_num"] == 1
        assert "Welcome" in before["line"]
        # context_after: one entry (line 3, "Enjoy.").
        assert len(match["context_after"]) == 1
        after = match["context_after"][0]
        assert after["line_num"] == 3
        assert "Enjoy" in after["line"]

    def test_context_lines_zero_produces_no_context(self, repo: Repo) -> None:
        """``context_lines=0`` → empty context_before and context_after."""
        self._seed_corpus(repo)
        results = repo.search_files("AC-DC", context_lines=0)
        match = results[0]["matches"][0]
        assert match["context_before"] == []
        assert match["context_after"] == []

    def test_negative_context_clamped_to_zero(self, repo: Repo) -> None:
        """Negative context_lines is silently clamped to zero.

        Defensive behaviour — caller bugs or UI sliders that
        momentarily produce ``-1`` shouldn't crash the search. The
        method clamps with ``max(0, context_lines)``.
        """
        self._seed_corpus(repo)
        results = repo.search_files("AC-DC", context_lines=-5)
        match = results[0]["matches"][0]
        assert match["context_before"] == []
        assert match["context_after"] == []

    def test_context_does_not_cross_match_boundary(self, repo: Repo) -> None:
        """Context lines stop at the next match — matches don't share context.

        When two matches are adjacent (say line 1 and line 2 both
        match), the line between them isn't double-counted. Each
        match's ``context_before`` stops at the previous match; each
        ``context_after`` stops at the next match.

        In notes.txt, lines 1–2 both match 'hello' (case-insensitive).
        So match on line 1 should have no context_before (beginning
        of file) and no context_after (line 2 is also a match).
        """
        self._seed_corpus(repo)
        results = repo.search_files("hello", context_lines=3)
        notes_entry = next(r for r in results if r["file"] == "notes.txt")
        line1_match = next(
            m for m in notes_entry["matches"] if m["line_num"] == 1
        )
        # No context_before — we're at the top of the file.
        assert line1_match["context_before"] == []
        # No context_after — line 2 is itself a match, not a
        # context line.
        assert line1_match["context_after"] == []


# ---------------------------------------------------------------------------
# Git subprocess helper
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# External tool availability
# ---------------------------------------------------------------------------


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