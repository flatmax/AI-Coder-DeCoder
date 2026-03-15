"""Tests for the edit protocol — parsing, validation, application."""

import subprocess
from pathlib import Path

import pytest

from ac_dc.edit_parser import (
    EditBlock, EditResult, EditStatus,
    parse_edit_blocks, validate_edit, apply_edit,
    apply_edits_to_repo, detect_shell_commands,
    EDIT_START, EDIT_SEPARATOR, EDIT_END,
)


# ── Parsing ───────────────────────────────────────────────────────

class TestParsing:
    def test_basic_edit_block(self):
        text = f"""Some text before.

src/app.py
{EDIT_START}
def old():
    pass
{EDIT_SEPARATOR}
def new():
    pass
{EDIT_END}

Some text after.
"""
        blocks = parse_edit_blocks(text)
        assert len(blocks) == 1
        assert blocks[0].file_path == "src/app.py"
        assert any("def old" in line for line in blocks[0].old_lines)
        assert any("def new" in line for line in blocks[0].new_lines)

    def test_create_file(self):
        text = f"""src/new_module.py
{EDIT_START}
{EDIT_SEPARATOR}
def hello():
    print("Hello!")
{EDIT_END}
"""
        blocks = parse_edit_blocks(text)
        assert len(blocks) == 1
        assert blocks[0].is_create
        assert len(blocks[0].old_lines) == 0
        assert len(blocks[0].new_lines) > 0

    def test_insert_after(self):
        text = f"""src/utils.py
{EDIT_START}
import os
{EDIT_SEPARATOR}
import os
import sys
{EDIT_END}
"""
        blocks = parse_edit_blocks(text)
        assert len(blocks) == 1
        assert len(blocks[0].old_lines) == 1

    def test_delete_lines(self):
        text = f"""src/utils.py
{EDIT_START}
import os
import deprecated
import sys
{EDIT_SEPARATOR}
import os
import sys
{EDIT_END}
"""
        blocks = parse_edit_blocks(text)
        assert len(blocks) == 1
        assert len(blocks[0].old_lines) == 3
        assert len(blocks[0].new_lines) == 2

    def test_multiple_blocks(self):
        text = f"""src/a.py
{EDIT_START}
old_a
{EDIT_SEPARATOR}
new_a
{EDIT_END}

src/b.py
{EDIT_START}
old_b
{EDIT_SEPARATOR}
new_b
{EDIT_END}
"""
        blocks = parse_edit_blocks(text)
        assert len(blocks) == 2
        assert blocks[0].file_path == "src/a.py"
        assert blocks[1].file_path == "src/b.py"

    def test_single_filename(self):
        text = f"""utils.py
{EDIT_START}
old
{EDIT_SEPARATOR}
new
{EDIT_END}
"""
        blocks = parse_edit_blocks(text)
        assert len(blocks) == 1
        assert blocks[0].file_path == "utils.py"

    def test_comment_not_file_path(self):
        text = f"""# This is a comment
src/app.py
{EDIT_START}
old
{EDIT_SEPARATOR}
new
{EDIT_END}
"""
        blocks = parse_edit_blocks(text)
        assert len(blocks) == 1
        assert blocks[0].file_path == "src/app.py"


# ── Validation ────────────────────────────────────────────────────

class TestValidation:
    def test_valid_edit(self):
        block = EditBlock(
            file_path="test.py",
            old_lines=["def old():", "    pass"],
            new_lines=["def new():", "    return True"],
        )
        content = "# header\ndef old():\n    pass\n# footer\n"
        result = validate_edit(block, content)
        assert result.status == EditStatus.VALIDATED.value
        assert result.error_type == ""

    def test_anchor_not_found(self):
        block = EditBlock(
            file_path="test.py",
            old_lines=["nonexistent line"],
            new_lines=["replacement"],
        )
        content = "# just some content\n"
        result = validate_edit(block, content)
        assert result.status == EditStatus.FAILED.value
        assert result.error_type == "anchor_not_found"

    def test_ambiguous_anchor(self):
        block = EditBlock(
            file_path="test.py",
            old_lines=["    pass"],
            new_lines=["    return True"],
        )
        content = "def a():\n    pass\ndef b():\n    pass\n"
        result = validate_edit(block, content)
        assert result.status == EditStatus.FAILED.value
        assert result.error_type == "ambiguous_anchor"

    def test_create_always_valid(self):
        block = EditBlock(
            file_path="new.py",
            old_lines=[],
            new_lines=["print('hi')"],
            is_create=True,
        )
        result = validate_edit(block, "")
        assert result.status == EditStatus.VALIDATED.value
        assert result.error_type == ""

    def test_whitespace_mismatch(self):
        block = EditBlock(
            file_path="test.py",
            old_lines=["    indented"],  # 4 spaces
            new_lines=["    fixed"],
        )
        content = "\tindented\n"  # tab instead
        result = validate_edit(block, content)
        assert result.status == EditStatus.FAILED.value
        assert "whitespace" in result.message.lower() or "not found" in result.message.lower()

    def test_old_text_mismatch(self):
        """Anchor (common prefix) found but remaining old lines don't match."""
        block = EditBlock(
            file_path="test.py",
            old_lines=["def process():", "    old_body()"],
            new_lines=["def process():", "    new_body()"],
        )
        # Anchor "def process():" exists, but next line differs
        content = "def process():\n    different_body()\n"
        result = validate_edit(block, content)
        assert result.status == EditStatus.FAILED.value
        assert result.error_type == "old_text_mismatch"

# ── Application ───────────────────────────────────────────────────

class TestApplication:
    def test_basic_replacement(self):
        block = EditBlock(
            file_path="test.py",
            old_lines=["old_line"],
            new_lines=["new_line"],
        )
        content = "before\nold_line\nafter\n"
        new_content, result = apply_edit(block, content)
        assert result.status == EditStatus.APPLIED.value
        assert "new_line" in new_content
        assert "old_line" not in new_content
        assert "before" in new_content
        assert "after" in new_content

    def test_create_file(self):
        block = EditBlock(
            file_path="new.py",
            old_lines=[],
            new_lines=["def hello():", "    pass"],
            is_create=True,
        )
        new_content, result = apply_edit(block, "")
        assert result.status == EditStatus.APPLIED.value
        assert "def hello" in new_content

    def test_insert_after_anchor(self):
        block = EditBlock(
            file_path="test.py",
            old_lines=["import os"],
            new_lines=["import os", "import sys"],
        )
        content = "import os\nfrom pathlib import Path\n"
        new_content, result = apply_edit(block, content)
        assert result.status == EditStatus.APPLIED.value
        assert "import sys" in new_content

    def test_failed_apply_unchanged(self):
        block = EditBlock(
            file_path="test.py",
            old_lines=["nonexistent"],
            new_lines=["replacement"],
        )
        content = "original content\n"
        new_content, result = apply_edit(block, content)
        assert result.status == EditStatus.FAILED.value
        assert new_content == content

    def test_repo_application(self, tmp_git_repo):
        (tmp_git_repo / "src").mkdir(exist_ok=True)
        (tmp_git_repo / "src" / "app.py").write_text(
            "def main():\n    print('hello')\n"
        )

        blocks = [EditBlock(
            file_path="src/app.py",
            old_lines=["    print('hello')"],
            new_lines=["    print('world')"],
        )]
        results = apply_edits_to_repo(blocks, tmp_git_repo)
        assert results[0].status == EditStatus.APPLIED.value

        content = (tmp_git_repo / "src" / "app.py").read_text()
        assert "world" in content

    def test_create_makes_dirs(self, tmp_git_repo):
        blocks = [EditBlock(
            file_path="new/deep/file.py",
            old_lines=[],
            new_lines=["# new file"],
            is_create=True,
        )]
        results = apply_edits_to_repo(blocks, tmp_git_repo)
        assert results[0].status == EditStatus.APPLIED.value
        assert (tmp_git_repo / "new" / "deep" / "file.py").exists()

    def test_dry_run(self, tmp_git_repo):
        (tmp_git_repo / "test.py").write_text("original\n")
        blocks = [EditBlock(
            file_path="test.py",
            old_lines=["original"],
            new_lines=["modified"],
        )]
        results = apply_edits_to_repo(blocks, tmp_git_repo, dry_run=True)
        assert results[0].status == EditStatus.VALIDATED.value
        # File unchanged
        assert (tmp_git_repo / "test.py").read_text() == "original\n"

    def test_path_escape_blocked(self, tmp_git_repo):
        blocks = [EditBlock(
            file_path="../../../etc/passwd",
            old_lines=["root"],
            new_lines=["hack"],
        )]
        results = apply_edits_to_repo(blocks, tmp_git_repo)
        assert results[0].status == EditStatus.SKIPPED.value
        assert results[0].error_type == "validation_error"

    def test_binary_file_skipped(self, tmp_git_repo):
        (tmp_git_repo / "bin.dat").write_bytes(b"\x00\x01\x02\xff")
        blocks = [EditBlock(
            file_path="bin.dat",
            old_lines=["content"],
            new_lines=["modified"],
        )]
        results = apply_edits_to_repo(blocks, tmp_git_repo)
        assert results[0].status == EditStatus.SKIPPED.value
        assert results[0].error_type == "validation_error"

    def test_missing_file_fails(self, tmp_git_repo):
        blocks = [EditBlock(
            file_path="nonexistent.py",
            old_lines=["content"],
            new_lines=["modified"],
        )]
        results = apply_edits_to_repo(blocks, tmp_git_repo)
        assert results[0].status == EditStatus.FAILED.value
        assert results[0].error_type == "file_not_found"

    def test_multiple_edits_same_file(self, tmp_git_repo):
        (tmp_git_repo / "multi.py").write_text(
            "line1\nline2\nline3\n"
        )
        blocks = [
            EditBlock(file_path="multi.py", old_lines=["line1"], new_lines=["LINE1"]),
            EditBlock(file_path="multi.py", old_lines=["line3"], new_lines=["LINE3"]),
        ]
        results = apply_edits_to_repo(blocks, tmp_git_repo)
        assert all(r.status == EditStatus.APPLIED.value for r in results)
        content = (tmp_git_repo / "multi.py").read_text()
        assert "LINE1" in content
        assert "LINE3" in content


# ── Not-In-Context Handling ───────────────────────────────────────

class TestNotInContext:
    def test_not_in_context_status(self, tmp_git_repo):
        (tmp_git_repo / "other.py").write_text("content\n")
        blocks = [EditBlock(
            file_path="other.py",
            old_lines=["content"],
            new_lines=["modified"],
        )]
        results = apply_edits_to_repo(
            blocks, tmp_git_repo, in_context_files={"main.py"},
        )
        assert results[0].status == EditStatus.NOT_IN_CONTEXT.value

    def test_in_context_applied(self, tmp_git_repo):
        (tmp_git_repo / "main.py").write_text("content\n")
        blocks = [EditBlock(
            file_path="main.py",
            old_lines=["content"],
            new_lines=["modified"],
        )]
        results = apply_edits_to_repo(
            blocks, tmp_git_repo, in_context_files={"main.py"},
        )
        assert results[0].status == EditStatus.APPLIED.value

    def test_create_bypasses_context_check(self, tmp_git_repo):
        blocks = [EditBlock(
            file_path="brand_new.py",
            old_lines=[],
            new_lines=["# new"],
            is_create=True,
        )]
        results = apply_edits_to_repo(
            blocks, tmp_git_repo, in_context_files=set(),
        )
        assert results[0].status == EditStatus.APPLIED.value

    def test_mixed_response(self, tmp_git_repo):
        (tmp_git_repo / "in_ctx.py").write_text("old\n")
        (tmp_git_repo / "out_ctx.py").write_text("old\n")
        blocks = [
            EditBlock(file_path="in_ctx.py", old_lines=["old"], new_lines=["new"]),
            EditBlock(file_path="out_ctx.py", old_lines=["old"], new_lines=["new"]),
        ]
        results = apply_edits_to_repo(
            blocks, tmp_git_repo, in_context_files={"in_ctx.py"},
        )
        assert results[0].status == EditStatus.APPLIED.value
        assert results[1].status == EditStatus.NOT_IN_CONTEXT.value


# ── Shell Command Detection ───────────────────────────────────────

class TestShellCommands:
    def test_bash_block(self):
        text = "Run this:\n```bash\npip install foo\nnpm test\n```\n"
        cmds = detect_shell_commands(text)
        assert "pip install foo" in cmds
        assert "npm test" in cmds

    def test_dollar_prefix(self):
        text = "Execute:\n$ git status\n$ git add .\n"
        cmds = detect_shell_commands(text)
        assert "git status" in cmds
        assert "git add ." in cmds

    def test_comments_skipped(self):
        text = "```bash\n# This is a comment\nactual_command\n```\n"
        cmds = detect_shell_commands(text)
        assert "actual_command" in cmds
        assert not any("comment" in c for c in cmds)

    def test_no_commands(self):
        text = "Just regular text with no commands."
        cmds = detect_shell_commands(text)
        assert cmds == []