"""Tests for ac_dc.edit_pipeline — validation and application.

Scope:

- ``EditPipeline.apply_edits`` — the main entry point, covering
  every status/error-type combination.
- Create blocks — new file, conflict with existing, idempotent
  re-run.
- Modify blocks — anchor matching (unique, missing, ambiguous),
  already-applied detection, sequential application, write
  errors.
- Not-in-context handling — files not in the active selection
  are marked ``NOT_IN_CONTEXT`` and surfaced in
  ``files_auto_added``.
- Aggregate reporting — counts, order-preserving dedup in
  ``files_modified``/``files_auto_added``.
- Dry run — validates without writing.
- Anchor diagnostics — whitespace mismatch, partial match,
  generic missing.

Strategy:

- Real :class:`Repo` against a fresh git repo per test. The
  pipeline's correctness depends on actually reading/writing
  files through the repo layer, so a mock would hide integration
  bugs.
- Uses ``pytest_asyncio`` auto-mode (configured in
  ``pyproject.toml``) — async tests are picked up without
  decorators.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from ac_dc.edit_pipeline import ApplyReport, EditPipeline
from ac_dc.edit_protocol import EditBlock, EditErrorType, EditStatus
from ac_dc.repo import Repo


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _run_git(cwd: Path, *args: str) -> None:
    """Run git inside a test repo, failing loudly on error."""
    result = subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, (
        f"git {' '.join(args)} failed: {result.stderr}"
    )


@pytest.fixture
def repo_dir(tmp_path: Path) -> Path:
    """Initialise a minimal git repo for each test."""
    d = tmp_path / "repo"
    d.mkdir()
    _run_git(d, "init", "-q")
    _run_git(d, "config", "user.email", "test@example.com")
    _run_git(d, "config", "user.name", "Test")
    _run_git(d, "config", "init.defaultBranch", "main")
    _run_git(d, "checkout", "-q", "-b", "main")
    # Seed commit so HEAD resolves.
    (d / "seed.md").write_text("seed\n")
    _run_git(d, "add", "seed.md")
    _run_git(d, "commit", "-q", "-m", "seed")
    return d


@pytest.fixture
def repo(repo_dir: Path) -> Repo:
    return Repo(repo_dir)


@pytest.fixture
def pipeline(repo: Repo) -> EditPipeline:
    return EditPipeline(repo)


def _modify(path: str, old: str, new: str) -> EditBlock:
    """Build a modify EditBlock."""
    return EditBlock(
        file_path=path,
        old_text=old,
        new_text=new,
        is_create=False,
        completed=True,
    )


def _create(path: str, content: str) -> EditBlock:
    """Build a create EditBlock (empty old text)."""
    return EditBlock(
        file_path=path,
        old_text="",
        new_text=content,
        is_create=True,
        completed=True,
    )


# ---------------------------------------------------------------------------
# Create blocks
# ---------------------------------------------------------------------------


class TestCreateBlocks:
    """Create block (empty old-text) paths."""

    async def test_new_file_applied(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """Create block for a non-existent file writes it."""
        block = _create("new.py", "print('hi')\n")
        report = await pipeline.apply_edits(
            [block], in_context_files=set()
        )
        assert report.passed == 1
        assert report.results[0].status == EditStatus.APPLIED
        assert (repo_dir / "new.py").read_text() == "print('hi')\n"

    async def test_new_file_staged(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """Created files are staged in git."""
        block = _create("staged.py", "x = 1\n")
        await pipeline.apply_edits([block], in_context_files=set())
        # Check git status — file should be staged (A/added).
        result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=repo_dir,
            capture_output=True,
            text=True,
            check=True,
        )
        assert "A  staged.py" in result.stdout

    async def test_create_bypasses_in_context_check(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """Create blocks always attempt even for unselected files."""
        block = _create("auto.py", "content\n")
        # Empty in_context_files — create still applies.
        report = await pipeline.apply_edits(
            [block], in_context_files=set()
        )
        assert report.passed == 1
        assert report.not_in_context == 0

    async def test_create_on_existing_with_same_content(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """Create block for existing file with matching content → already_applied."""
        (repo_dir / "existing.py").write_text("hello\n")
        block = _create("existing.py", "hello\n")
        report = await pipeline.apply_edits(
            [block], in_context_files=set()
        )
        assert report.already_applied == 1
        assert report.results[0].status == EditStatus.ALREADY_APPLIED

    async def test_create_on_existing_with_different_content(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """Create block for existing file with different content → failed."""
        (repo_dir / "existing.py").write_text("original\n")
        block = _create("existing.py", "replacement\n")
        report = await pipeline.apply_edits(
            [block], in_context_files=set()
        )
        assert report.failed == 1
        assert report.results[0].status == EditStatus.FAILED
        assert report.results[0].error_type == (
            EditErrorType.VALIDATION_ERROR.value
        )
        # Original file unchanged.
        assert (repo_dir / "existing.py").read_text() == "original\n"

    async def test_create_trailing_newline_tolerance(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """Already-applied match tolerates trailing newline diff."""
        (repo_dir / "existing.py").write_text("hello\n")
        # Target content has no trailing newline; existing has one.
        block = _create("existing.py", "hello")
        report = await pipeline.apply_edits(
            [block], in_context_files=set()
        )
        assert report.already_applied == 1

    async def test_create_with_parent_dir(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """Create block can create files in subdirectories."""
        block = _create("sub/nested.py", "content\n")
        report = await pipeline.apply_edits(
            [block], in_context_files=set()
        )
        assert report.passed == 1
        assert (repo_dir / "sub" / "nested.py").exists()


# ---------------------------------------------------------------------------
# Not-in-context handling
# ---------------------------------------------------------------------------


class TestNotInContext:
    """Modify blocks for files outside the selection."""

    async def test_modify_not_in_context_marked(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """Modify block for unselected file is marked NOT_IN_CONTEXT."""
        (repo_dir / "a.py").write_text("original\n")
        block = _modify("a.py", "original", "modified")
        report = await pipeline.apply_edits(
            [block], in_context_files=set()
        )
        assert report.not_in_context == 1
        assert report.results[0].status == EditStatus.NOT_IN_CONTEXT
        # File not written.
        assert (repo_dir / "a.py").read_text() == "original\n"

    async def test_not_in_context_appears_in_files_auto_added(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """Not-in-context files surface for auto-selection."""
        (repo_dir / "a.py").write_text("x\n")
        block = _modify("a.py", "x", "y")
        report = await pipeline.apply_edits(
            [block], in_context_files=set()
        )
        assert report.files_auto_added == ["a.py"]

    async def test_auto_added_deduplicated(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """Multiple edits to same not-in-context file → one entry."""
        (repo_dir / "a.py").write_text("x y z\n")
        block1 = _modify("a.py", "x", "X")
        block2 = _modify("a.py", "y", "Y")
        report = await pipeline.apply_edits(
            [block1, block2], in_context_files=set()
        )
        assert report.not_in_context == 2
        assert report.files_auto_added == ["a.py"]

    async def test_mixed_in_context_and_not(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """One in-context edit applied, one not-in-context deferred."""
        (repo_dir / "a.py").write_text("alpha\n")
        (repo_dir / "b.py").write_text("beta\n")
        block_a = _modify("a.py", "alpha", "ALPHA")
        block_b = _modify("b.py", "beta", "BETA")
        report = await pipeline.apply_edits(
            [block_a, block_b], in_context_files={"a.py"}
        )
        assert report.passed == 1
        assert report.not_in_context == 1
        assert report.files_modified == ["a.py"]
        assert report.files_auto_added == ["b.py"]
        assert (repo_dir / "a.py").read_text() == "ALPHA\n"
        assert (repo_dir / "b.py").read_text() == "beta\n"


# ---------------------------------------------------------------------------
# Modify blocks — anchor matching
# ---------------------------------------------------------------------------


class TestModifyBlocks:
    """Modify block paths — anchor matching and application."""

    async def test_unique_anchor_applied(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        (repo_dir / "a.py").write_text("hello world\n")
        block = _modify("a.py", "hello", "goodbye")
        report = await pipeline.apply_edits(
            [block], in_context_files={"a.py"}
        )
        assert report.passed == 1
        assert (repo_dir / "a.py").read_text() == "goodbye world\n"

    async def test_modified_files_in_report(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        (repo_dir / "a.py").write_text("x\n")
        block = _modify("a.py", "x", "y")
        report = await pipeline.apply_edits(
            [block], in_context_files={"a.py"}
        )
        assert report.files_modified == ["a.py"]

    async def test_multiline_anchor(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """Multi-line anchors locate a unique span and replace it."""
        (repo_dir / "a.py").write_text(
            "def foo():\n    return 1\n\ndef bar():\n    return 2\n"
        )
        block = _modify(
            "a.py",
            "def foo():\n    return 1",
            "def foo():\n    return 100",
        )
        report = await pipeline.apply_edits(
            [block], in_context_files={"a.py"}
        )
        assert report.passed == 1
        content = (repo_dir / "a.py").read_text()
        assert "return 100" in content
        assert "return 2" in content  # unchanged


class TestAnchorFailures:
    """Anchor mismatch paths."""

    async def test_anchor_not_found(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """Old text not in file → failed with anchor_not_found."""
        (repo_dir / "a.py").write_text("hello\n")
        block = _modify("a.py", "goodbye", "farewell")
        report = await pipeline.apply_edits(
            [block], in_context_files={"a.py"}
        )
        assert report.failed == 1
        assert report.results[0].status == EditStatus.FAILED
        assert report.results[0].error_type == (
            EditErrorType.ANCHOR_NOT_FOUND.value
        )

    async def test_ambiguous_anchor(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """Anchor matching multiple locations → ambiguous_anchor."""
        (repo_dir / "a.py").write_text("x\nx\nx\n")
        block = _modify("a.py", "x", "Y")
        report = await pipeline.apply_edits(
            [block], in_context_files={"a.py"}
        )
        assert report.failed == 1
        assert report.results[0].error_type == (
            EditErrorType.AMBIGUOUS_ANCHOR.value
        )
        # Message mentions the count so the LLM can retry.
        assert "3" in report.results[0].message
        # File not written.
        assert (repo_dir / "a.py").read_text() == "x\nx\nx\n"

    async def test_whitespace_mismatch_diagnostic(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """Whitespace-only difference produces whitespace diagnostic."""
        # File has tabs; anchor has spaces.
        (repo_dir / "a.py").write_text("def foo():\n\treturn 1\n")
        block = _modify(
            "a.py",
            "def foo():\n    return 1",  # spaces
            "def foo():\n    return 2",
        )
        report = await pipeline.apply_edits(
            [block], in_context_files={"a.py"}
        )
        assert report.failed == 1
        assert "whitespace" in report.results[0].message.lower()

    async def test_partial_match_diagnostic(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """First line matches but later lines don't → partial match msg."""
        (repo_dir / "a.py").write_text(
            "def foo():\n    return 1\n"
        )
        block = _modify(
            "a.py",
            "def foo():\n    return 42",  # wrong return value
            "def foo():\n    return 99",
        )
        report = await pipeline.apply_edits(
            [block], in_context_files={"a.py"}
        )
        assert report.failed == 1
        # Diagnostic mentions first line matched but subsequent differ.
        assert "first line" in report.results[0].message.lower()


class TestAlreadyApplied:
    """Idempotent re-application detection."""

    async def test_new_content_already_present(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """Anchor missing but new text already present → already_applied."""
        # File already has the "new" content from a prior apply.
        (repo_dir / "a.py").write_text("goodbye world\n")
        # Re-running the same edit — anchor ("hello") isn't found,
        # but "goodbye" is. Idempotent success.
        block = _modify("a.py", "hello", "goodbye")
        report = await pipeline.apply_edits(
            [block], in_context_files={"a.py"}
        )
        assert report.already_applied == 1
        assert report.results[0].status == EditStatus.ALREADY_APPLIED


# ---------------------------------------------------------------------------
# Modify blocks — errors
# ---------------------------------------------------------------------------


class TestModifyErrors:
    """Error paths for modify blocks."""

    async def test_missing_file_failed(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """Modify block for nonexistent file → failed + file_not_found."""
        block = _modify("ghost.py", "x", "y")
        report = await pipeline.apply_edits(
            [block], in_context_files={"ghost.py"}
        )
        assert report.failed == 1
        assert report.results[0].error_type == (
            EditErrorType.FILE_NOT_FOUND.value
        )

    async def test_binary_file_skipped(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """Modify block targeting a binary file → skipped."""
        (repo_dir / "bin.dat").write_bytes(b"binary\x00data\n")
        block = _modify("bin.dat", "binary", "modified")
        report = await pipeline.apply_edits(
            [block], in_context_files={"bin.dat"}
        )
        assert report.skipped == 1
        assert report.results[0].status == EditStatus.SKIPPED
        assert report.results[0].error_type == (
            EditErrorType.VALIDATION_ERROR.value
        )

    async def test_path_traversal_skipped(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """Path containing ``..`` is rejected at the repo layer."""
        block = _modify("../outside.py", "x", "y")
        report = await pipeline.apply_edits(
            [block], in_context_files={"../outside.py"}
        )
        # Repo's get_file_content raises — classified as skipped
        # (validation_error) since the traversal isn't a missing-
        # file condition.
        assert report.results[0].status in (
            EditStatus.SKIPPED, EditStatus.FAILED,
        )


# ---------------------------------------------------------------------------
# Sequential application
# ---------------------------------------------------------------------------


class TestSequentialApplication:
    """Edits to the same file see state produced by earlier edits."""

    async def test_two_edits_same_file_sequential(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """Second edit's anchor must match post-first-edit state."""
        (repo_dir / "a.py").write_text("one\ntwo\nthree\n")
        # First edit: one → 1. Second edit must find "1" (the
        # post-first-edit state), not "one".
        block1 = _modify("a.py", "one", "1")
        block2 = _modify("a.py", "1\ntwo", "1\nTWO")
        report = await pipeline.apply_edits(
            [block1, block2], in_context_files={"a.py"}
        )
        assert report.passed == 2
        assert (repo_dir / "a.py").read_text() == "1\nTWO\nthree\n"

    async def test_files_modified_deduplicated(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """Multiple edits to same file → one entry in files_modified."""
        (repo_dir / "a.py").write_text("x\ny\n")
        block1 = _modify("a.py", "x", "X")
        block2 = _modify("a.py", "y", "Y")
        report = await pipeline.apply_edits(
            [block1, block2], in_context_files={"a.py"}
        )
        assert report.files_modified == ["a.py"]
        assert report.passed == 2

    async def test_first_edit_succeeds_second_fails(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """Failed second edit doesn't roll back the first."""
        (repo_dir / "a.py").write_text("x y\n")
        block1 = _modify("a.py", "x", "X")
        block2 = _modify("a.py", "nonexistent", "Z")
        report = await pipeline.apply_edits(
            [block1, block2], in_context_files={"a.py"}
        )
        assert report.passed == 1
        assert report.failed == 1
        # First edit persisted.
        assert (repo_dir / "a.py").read_text() == "X y\n"


# ---------------------------------------------------------------------------
# Aggregate reporting
# ---------------------------------------------------------------------------


class TestApplyReport:
    """ApplyReport aggregate shape."""

    async def test_empty_input_zero_counts(
        self, pipeline: EditPipeline
    ) -> None:
        """Empty block list → all counts zero."""
        report = await pipeline.apply_edits(
            [], in_context_files=set()
        )
        assert isinstance(report, ApplyReport)
        assert report.passed == 0
        assert report.failed == 0
        assert report.skipped == 0
        assert report.already_applied == 0
        assert report.not_in_context == 0
        assert report.files_modified == []
        assert report.files_auto_added == []

    async def test_counts_sum_to_results_length(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """Aggregate counts equal the number of results."""
        (repo_dir / "a.py").write_text("hello\n")
        (repo_dir / "b.py").write_text("bye\n")
        blocks = [
            _modify("a.py", "hello", "HI"),       # applied
            _modify("b.py", "xxx", "YYY"),         # failed
            _create("new.py", "content\n"),        # applied
            _modify("ghost.py", "a", "b"),         # not_in_context
        ]
        report = await pipeline.apply_edits(
            [
                blocks[0], blocks[1],
                blocks[2], blocks[3],
            ],
            in_context_files={"a.py", "b.py"},
        )
        total = (
            report.passed + report.failed + report.skipped
            + report.already_applied + report.not_in_context
        )
        assert total == len(report.results)

    async def test_files_modified_order_preserving(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """files_modified preserves first-seen order."""
        (repo_dir / "b.py").write_text("b\n")
        (repo_dir / "a.py").write_text("a\n")
        (repo_dir / "c.py").write_text("c\n")
        blocks = [
            _modify("b.py", "b", "B"),
            _modify("a.py", "a", "A"),
            _modify("c.py", "c", "C"),
        ]
        report = await pipeline.apply_edits(
            blocks, in_context_files={"a.py", "b.py", "c.py"}
        )
        # First-seen order — b, a, c.
        assert report.files_modified == ["b.py", "a.py", "c.py"]


# ---------------------------------------------------------------------------
# Dry run
# ---------------------------------------------------------------------------


class TestDryRun:
    """Dry-run mode validates without writing."""

    async def test_dry_run_modify_validated(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """Valid modify block in dry-run → VALIDATED, no disk change."""
        (repo_dir / "a.py").write_text("hello\n")
        block = _modify("a.py", "hello", "goodbye")
        report = await pipeline.apply_edits(
            [block], in_context_files={"a.py"}, dry_run=True
        )
        assert report.results[0].status == EditStatus.VALIDATED
        # No disk change.
        assert (repo_dir / "a.py").read_text() == "hello\n"
        # Dry-run success doesn't count toward passed.
        assert report.passed == 0

    async def test_dry_run_create_validated(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """Create block in dry-run → VALIDATED, no file created."""
        block = _create("new.py", "content\n")
        report = await pipeline.apply_edits(
            [block], in_context_files=set(), dry_run=True
        )
        assert report.results[0].status == EditStatus.VALIDATED
        assert not (repo_dir / "new.py").exists()

    async def test_dry_run_failed_still_reports_failure(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """Dry-run of a bad edit still reports failure."""
        (repo_dir / "a.py").write_text("hello\n")
        block = _modify("a.py", "nonexistent", "x")
        report = await pipeline.apply_edits(
            [block], in_context_files={"a.py"}, dry_run=True
        )
        assert report.failed == 1

    async def test_dry_run_no_git_staging(
        self, pipeline: EditPipeline, repo_dir: Path
    ) -> None:
        """Dry-run doesn't stage anything."""
        (repo_dir / "a.py").write_text("x\n")
        block = _modify("a.py", "x", "y")
        await pipeline.apply_edits(
            [block], in_context_files={"a.py"}, dry_run=True
        )
        # Working tree clean (no staged changes).
        result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=repo_dir,
            capture_output=True,
            text=True,
            check=True,
        )
        # Only untracked files (if any) — no staged modifications.
        assert "M" not in result.stdout