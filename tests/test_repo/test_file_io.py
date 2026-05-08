"""File-read, file-write, and per-path write-mutex behaviour."""

from __future__ import annotations

import asyncio
import base64
from pathlib import Path

import pytest

from ac_dc.repo import Repo, RepoError

from .conftest import _run_git


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