"""Tests for the edit block parser."""

import tempfile
from pathlib import Path

import pytest

from ac_dc.edit_parser import (
    EditBlock,
    EditStatus,
    apply_edit,
    apply_edits_to_repo,
    detect_shell_commands,
    parse_edit_blocks,
    validate_edit,
)


class TestParsing:
    """Edit block parsing tests."""

    def test_basic_edit_extraction(self):
        """Basic edit block extraction from prose text."""
        text = """
Here's the fix:

src/math.py
««« EDIT
def multiply(a, b):
    return a + b  # BUG
═══════ REPL
def multiply(a, b):
    return a * b
»»» EDIT END

That should fix the issue.
"""
        blocks = parse_edit_blocks(text)
        assert len(blocks) == 1
        assert blocks[0].file_path == "src/math.py"
        assert blocks[0].anchor_lines == ["def multiply(a, b):"]
        assert blocks[0].old_only == ["    return a + b  # BUG"]
        assert blocks[0].new_only == ["    return a * b"]

    def test_create_file(self):
        """Create file (empty EDIT section)."""
        text = """
src/new_module.py
««« EDIT
═══════ REPL
def hello():
    print("Hello, world!")
»»» EDIT END
"""
        blocks = parse_edit_blocks(text)
        assert len(blocks) == 1
        assert blocks[0].is_create is True
        assert len(blocks[0].new_lines) == 2

    def test_insert_after(self):
        """Insert after anchor line."""
        text = """
src/utils.py
««« EDIT
import os
═══════ REPL
import os
import sys
»»» EDIT END
"""
        blocks = parse_edit_blocks(text)
        assert len(blocks) == 1
        assert blocks[0].anchor_lines == ["import os"]
        assert blocks[0].old_only == []
        assert blocks[0].new_only == ["import sys"]

    def test_delete_lines(self):
        """Delete lines (lines in EDIT absent from REPL)."""
        text = """
src/utils.py
««« EDIT
import os
import deprecated_module
import sys
═══════ REPL
import os
import sys
»»» EDIT END
"""
        blocks = parse_edit_blocks(text)
        assert len(blocks) == 1
        assert blocks[0].anchor_lines == ["import os"]
        assert blocks[0].old_only == ["import deprecated_module", "import sys"]
        assert blocks[0].new_only == ["import sys"]

    def test_multiple_blocks(self):
        """Multiple blocks from one response."""
        text = """
src/a.py
««« EDIT
x = 1
═══════ REPL
x = 2
»»» EDIT END

src/b.py
««« EDIT
y = 3
═══════ REPL
y = 4
»»» EDIT END
"""
        blocks = parse_edit_blocks(text)
        assert len(blocks) == 2
        assert blocks[0].file_path == "src/a.py"
        assert blocks[1].file_path == "src/b.py"

    def test_single_filename_without_separator(self):
        """Single filename without path separator recognized."""
        text = """
Makefile
««« EDIT
old_target:
═══════ REPL
new_target:
»»» EDIT END
"""
        blocks = parse_edit_blocks(text)
        assert len(blocks) == 1
        assert blocks[0].file_path == "Makefile"

    def test_comment_not_treated_as_path(self):
        """Comment-prefixed lines not treated as file paths."""
        text = """
# This is a comment about the file
// Another comment
src/real.py
««« EDIT
old
═══════ REPL
new
»»» EDIT END
"""
        blocks = parse_edit_blocks(text)
        assert len(blocks) == 1
        assert blocks[0].file_path == "src/real.py"


class TestValidation:
    """Edit block validation tests."""

    def test_valid_edit_passes(self):
        """Valid edit passes (anchor found, old text matches)."""
        block = EditBlock(
            file_path="test.py",
            old_lines=["def foo():", "    return 1"],
            new_lines=["def foo():", "    return 2"],
            anchor_lines=["def foo():"],
            old_only=["    return 1"],
            new_only=["    return 2"],
        )
        content = "import os\n\ndef foo():\n    return 1\n\ndef bar():\n    pass"
        valid, error = validate_edit(block, content)
        assert valid is True
        assert error == ""

    def test_anchor_not_found(self):
        """Anchor not found returns error."""
        block = EditBlock(
            file_path="test.py",
            old_lines=["def nonexistent():"],
            new_lines=["def renamed():"],
            anchor_lines=["def nonexistent():"],
            old_only=[],
            new_only=[],
        )
        content = "def foo():\n    pass"
        valid, error = validate_edit(block, content)
        assert valid is False
        assert "not found" in error.lower()

    def test_ambiguous_match(self):
        """Ambiguous match (multiple locations) returns error."""
        block = EditBlock(
            file_path="test.py",
            old_lines=["    pass"],
            new_lines=["    return None"],
            anchor_lines=["    pass"],
            old_only=[],
            new_only=[],
        )
        content = "def a():\n    pass\n\ndef b():\n    pass"
        valid, error = validate_edit(block, content)
        assert valid is False
        assert "ambiguous" in error.lower()

    def test_create_always_valid(self):
        """Create blocks always valid."""
        block = EditBlock(
            file_path="new.py",
            old_lines=[],
            new_lines=["print('hello')"],
            anchor_lines=[],
            old_only=[],
            new_only=["print('hello')"],
            is_create=True,
        )
        valid, error = validate_edit(block, None)
        assert valid is True

    def test_whitespace_mismatch(self):
        """Whitespace mismatch diagnosed."""
        block = EditBlock(
            file_path="test.py",
            old_lines=["def foo():  ", "    return 1"],
            new_lines=["def foo():  ", "    return 2"],
            anchor_lines=["def foo():  "],
            old_only=["    return 1"],
            new_only=["    return 2"],
        )
        content = "def foo():\n    return 1"
        valid, error = validate_edit(block, content)
        assert valid is False


class TestApplication:
    """Edit block application tests."""

    def test_basic_replacement(self):
        """Basic replacement preserves surrounding content."""
        block = EditBlock(
            file_path="test.py",
            old_lines=["def foo():", "    return 1"],
            new_lines=["def foo():", "    return 2"],
            anchor_lines=["def foo():"],
            old_only=["    return 1"],
            new_only=["    return 2"],
        )
        content = "import os\n\ndef foo():\n    return 1\n\ndef bar():\n    pass"
        new_content, result = apply_edit(block, content)
        assert result.status == EditStatus.APPLIED
        assert "return 2" in new_content
        assert "import os" in new_content
        assert "def bar()" in new_content

    def test_create_writes_new_file(self):
        """Create writes new file."""
        block = EditBlock(
            file_path="new.py",
            old_lines=[],
            new_lines=["print('hello')"],
            anchor_lines=[],
            old_only=[],
            new_only=["print('hello')"],
            is_create=True,
        )
        new_content, result = apply_edit(block, None)
        assert result.status == EditStatus.APPLIED
        assert new_content == "print('hello')"

    def test_insert_adds_line(self):
        """Insert adds line after anchor."""
        block = EditBlock(
            file_path="test.py",
            old_lines=["import os"],
            new_lines=["import os", "import sys"],
            anchor_lines=["import os"],
            old_only=[],
            new_only=["import sys"],
        )
        content = "import os\n\ndef main():\n    pass"
        new_content, result = apply_edit(block, content)
        assert result.status == EditStatus.APPLIED
        assert "import sys" in new_content

    def test_failed_apply_returns_original(self):
        """Failed apply returns original content unchanged."""
        block = EditBlock(
            file_path="test.py",
            old_lines=["nonexistent"],
            new_lines=["replacement"],
            anchor_lines=["nonexistent"],
            old_only=[],
            new_only=[],
        )
        content = "actual content"
        new_content, result = apply_edit(block, content)
        assert result.status == EditStatus.FAILED
        assert new_content == content

    def test_repo_application(self, tmp_path):
        """Repo application writes to disk."""
        test_file = tmp_path / "test.py"
        test_file.write_text("def foo():\n    return 1")

        block = EditBlock(
            file_path="test.py",
            old_lines=["def foo():", "    return 1"],
            new_lines=["def foo():", "    return 2"],
            anchor_lines=["def foo():"],
            old_only=["    return 1"],
            new_only=["    return 2"],
        )
        results = apply_edits_to_repo([block], str(tmp_path))
        assert results[0].status == EditStatus.APPLIED
        assert "return 2" in test_file.read_text()

    def test_create_makes_parent_dirs(self, tmp_path):
        """Create makes parent directories."""
        block = EditBlock(
            file_path="deep/nested/new.py",
            old_lines=[],
            new_lines=["content"],
            anchor_lines=[],
            old_only=[],
            new_only=["content"],
            is_create=True,
        )
        results = apply_edits_to_repo([block], str(tmp_path))
        assert results[0].status == EditStatus.APPLIED
        assert (tmp_path / "deep" / "nested" / "new.py").exists()

    def test_dry_run_validates_without_writing(self, tmp_path):
        """Dry run validates without writing."""
        test_file = tmp_path / "test.py"
        test_file.write_text("def foo():\n    return 1")

        block = EditBlock(
            file_path="test.py",
            old_lines=["def foo():", "    return 1"],
            new_lines=["def foo():", "    return 2"],
            anchor_lines=["def foo():"],
            old_only=["    return 1"],
            new_only=["    return 2"],
        )
        results = apply_edits_to_repo([block], str(tmp_path), dry_run=True)
        assert results[0].status == EditStatus.VALIDATED
        # File unchanged
        assert "return 1" in test_file.read_text()

    def test_path_traversal_blocked(self, tmp_path):
        """Path escape (../) blocked."""
        block = EditBlock(
            file_path="../../../etc/passwd",
            old_lines=["root"],
            new_lines=["hacked"],
            anchor_lines=["root"],
            old_only=[],
            new_only=[],
        )
        results = apply_edits_to_repo([block], str(tmp_path))
        assert results[0].status == EditStatus.SKIPPED

    def test_binary_file_skipped(self, tmp_path):
        """Binary file skipped."""
        bin_file = tmp_path / "data.bin"
        bin_file.write_bytes(b"text\x00binary")

        block = EditBlock(
            file_path="data.bin",
            old_lines=["text"],
            new_lines=["new"],
            anchor_lines=["text"],
            old_only=[],
            new_only=[],
        )
        results = apply_edits_to_repo([block], str(tmp_path))
        assert results[0].status == EditStatus.SKIPPED

    def test_missing_file_fails(self, tmp_path):
        """Missing file fails."""
        block = EditBlock(
            file_path="nonexistent.py",
            old_lines=["code"],
            new_lines=["new code"],
            anchor_lines=["code"],
            old_only=[],
            new_only=[],
        )
        results = apply_edits_to_repo([block], str(tmp_path))
        assert results[0].status == EditStatus.FAILED

    def test_multiple_sequential_edits_same_file(self, tmp_path):
        """Multiple sequential edits to same file."""
        test_file = tmp_path / "test.py"
        test_file.write_text("a = 1\nb = 2\nc = 3")

        blocks = [
            EditBlock(
                file_path="test.py",
                old_lines=["a = 1"],
                new_lines=["a = 10"],
                anchor_lines=[],
                old_only=["a = 1"],
                new_only=["a = 10"],
            ),
            EditBlock(
                file_path="test.py",
                old_lines=["c = 3"],
                new_lines=["c = 30"],
                anchor_lines=[],
                old_only=["c = 3"],
                new_only=["c = 30"],
            ),
        ]
        results = apply_edits_to_repo(blocks, str(tmp_path))
        assert all(r.status == EditStatus.APPLIED for r in results)
        content = test_file.read_text()
        assert "a = 10" in content
        assert "c = 30" in content


class TestShellCommands:
    """Shell command detection tests."""

    def test_bash_block_extraction(self):
        """Extracts from ```bash blocks."""
        text = "Try this:\n```bash\npip install foo\nnpm run build\n```"
        cmds = detect_shell_commands(text)
        assert "pip install foo" in cmds
        assert "npm run build" in cmds

    def test_dollar_prefix(self):
        """Extracts $ prefix lines."""
        text = "Run:\n$ pip install foo"
        cmds = detect_shell_commands(text)
        assert "pip install foo" in cmds

    def test_comments_skipped(self):
        """Comments in bash blocks skipped."""
        text = "```bash\n# This is a comment\npip install foo\n```"
        cmds = detect_shell_commands(text)
        assert len(cmds) == 1
        assert "pip install foo" in cmds

    def test_non_command_text_empty(self):
        """Non-command text returns empty."""
        text = "Here is some explanation about the code."
        cmds = detect_shell_commands(text)
        assert len(cmds) == 0
