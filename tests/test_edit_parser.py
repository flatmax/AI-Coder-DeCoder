"""Tests for edit block parsing and application."""

import pytest
from ac_dc.edit_parser import (
    parse_edit_blocks, apply_edit, validate_edit,
    apply_edits_to_repo, EditStatus,
)


class TestParsing:
    """Test edit block extraction from LLM text."""

    def test_basic_edit_block(self):
        text = """Here's the fix:

src/math.py
<<<< EDIT
def multiply(a, b):
    return a + b  # BUG
==== REPLACE
def multiply(a, b):
    return a * b
>>>> EDIT END

That should work.
"""
        blocks = parse_edit_blocks(text)
        assert len(blocks) == 1
        b = blocks[0]
        assert b.file_path == "src/math.py"
        assert b.anchor_lines == ["def multiply(a, b):"]
        assert b.old_only == ["    return a + b  # BUG"]
        assert b.new_only == ["    return a * b"]

    def test_create_file(self):
        text = """
src/new.py
<<<< EDIT
==== REPLACE
def hello():
    print("Hello")
>>>> EDIT END
"""
        blocks = parse_edit_blocks(text)
        assert len(blocks) == 1
        assert blocks[0].is_create is True
        assert blocks[0].new_lines == ['def hello():', '    print("Hello")']

    def test_insert_after(self):
        text = """
src/utils.py
<<<< EDIT
import os
==== REPLACE
import os
import sys
>>>> EDIT END
"""
        blocks = parse_edit_blocks(text)
        assert len(blocks) == 1
        b = blocks[0]
        assert b.anchor_lines == ["import os"]
        assert b.old_only == []
        assert b.new_only == ["import sys"]

    def test_multiple_blocks(self):
        text = """
src/a.py
<<<< EDIT
old_a
==== REPLACE
new_a
>>>> EDIT END

src/b.py
<<<< EDIT
old_b
==== REPLACE
new_b
>>>> EDIT END
"""
        blocks = parse_edit_blocks(text)
        assert len(blocks) == 2
        assert blocks[0].file_path == "src/a.py"
        assert blocks[1].file_path == "src/b.py"

    def test_path_without_separator(self):
        """Single filename with extension should be recognized."""
        text = """
config.yaml
<<<< EDIT
old: value
==== REPLACE
new: value
>>>> EDIT END
"""
        blocks = parse_edit_blocks(text)
        assert len(blocks) == 1
        assert blocks[0].file_path == "config.yaml"

    def test_non_path_lines_ignored(self):
        """Lines starting with comment prefixes aren't treated as paths."""
        text = """Here's what to change:

# This is a comment about the file
src/fix.py
<<<< EDIT
broken
==== REPLACE
fixed
>>>> EDIT END
"""
        blocks = parse_edit_blocks(text)
        assert len(blocks) == 1
        assert blocks[0].file_path == "src/fix.py"

    def test_delete_lines(self):
        text = """
src/utils.py
<<<< EDIT
import os
import deprecated_module
import sys
==== REPLACE
import os
import sys
>>>> EDIT END
"""
        blocks = parse_edit_blocks(text)
        assert len(blocks) == 1
        b = blocks[0]
        assert b.anchor_lines == ["import os"]
        assert b.old_only == ["import deprecated_module", "import sys"]
        assert b.new_only == ["import sys"]


class TestValidation:
    """Test edit block validation against file content."""

    def test_valid_edit(self):
        block = parse_edit_blocks("""
src/app.py
<<<< EDIT
def hello():
    print("old")
==== REPLACE
def hello():
    print("new")
>>>> EDIT END
""")[0]
        content = 'def hello():\n    print("old")\n'
        error = validate_edit(block, content)
        assert error is None

    def test_anchor_not_found(self):
        block = parse_edit_blocks("""
src/app.py
<<<< EDIT
def nonexistent():
    pass
==== REPLACE
def nonexistent():
    return True
>>>> EDIT END
""")[0]
        content = "def hello():\n    pass\n"
        error = validate_edit(block, content)
        assert error is not None
        assert "not found" in error.lower() or "Anchor" in error

    def test_ambiguous_match(self):
        block = parse_edit_blocks("""
src/app.py
<<<< EDIT
    pass
==== REPLACE
    return None
>>>> EDIT END
""")[0]
        content = "def a():\n    pass\ndef b():\n    pass\n"
        error = validate_edit(block, content)
        assert error is not None
        assert "mbiguous" in error or "2" in error

    def test_create_always_valid(self):
        block = parse_edit_blocks("""
src/new.py
<<<< EDIT
==== REPLACE
print("hello")
>>>> EDIT END
""")[0]
        error = validate_edit(block, "anything")
        assert error is None

    def test_whitespace_mismatch_diagnosed(self):
        block = parse_edit_blocks("""
src/app.py
<<<< EDIT
\tdef hello():
==== REPLACE
\tdef hello_world():
>>>> EDIT END
""")[0]
        content = "def hello():\n    pass\n"
        error = validate_edit(block, content)
        assert error is not None
        assert "hitespace" in error or "near" in error.lower()


class TestApplication:
    """Test applying edit blocks to file content."""

    def test_basic_replacement(self):
        block = parse_edit_blocks("""
src/app.py
<<<< EDIT
def greet():
    return "hello"
==== REPLACE
def greet():
    return "goodbye"
>>>> EDIT END
""")[0]
        content = 'def greet():\n    return "hello"\n\ndef other():\n    pass'
        new_content, error = apply_edit(block, content)
        assert error is None
        assert 'return "goodbye"' in new_content
        assert "def other():" in new_content

    def test_create_file(self):
        block = parse_edit_blocks("""
src/new.py
<<<< EDIT
==== REPLACE
print("created")
>>>> EDIT END
""")[0]
        new_content, error = apply_edit(block, "")
        assert error is None
        assert new_content == 'print("created")'

    def test_insert_line(self):
        block = parse_edit_blocks("""
src/app.py
<<<< EDIT
import os
==== REPLACE
import os
import sys
>>>> EDIT END
""")[0]
        content = "import os\nimport json\n"
        new_content, error = apply_edit(block, content)
        assert error is None
        assert "import os\nimport sys\nimport json" in new_content

    def test_failed_apply_returns_original(self):
        block = parse_edit_blocks("""
src/app.py
<<<< EDIT
nonexistent line
==== REPLACE
replacement
>>>> EDIT END
""")[0]
        content = "actual content\n"
        new_content, error = apply_edit(block, content)
        assert error is not None
        assert new_content == content


class TestRepoApplication:
    """Test applying edits to actual files on disk."""

    def test_apply_to_file(self, tmp_path):
        (tmp_path / "src").mkdir()
        (tmp_path / "src" / "app.py").write_text("def hello():\n    pass\n")

        blocks = parse_edit_blocks("""
src/app.py
<<<< EDIT
def hello():
    pass
==== REPLACE
def hello():
    return True
>>>> EDIT END
""")
        results = apply_edits_to_repo(blocks, tmp_path)
        assert len(results) == 1
        assert results[0].status == EditStatus.APPLIED
        assert "return True" in (tmp_path / "src" / "app.py").read_text()

    def test_create_new_file(self, tmp_path):
        blocks = parse_edit_blocks("""
src/new_module.py
<<<< EDIT
==== REPLACE
def new_func():
    pass
>>>> EDIT END
""")
        results = apply_edits_to_repo(blocks, tmp_path)
        assert results[0].status == EditStatus.APPLIED
        assert (tmp_path / "src" / "new_module.py").exists()

    def test_dry_run(self, tmp_path):
        (tmp_path / "app.py").write_text("old content\n")

        blocks = parse_edit_blocks("""
app.py
<<<< EDIT
old content
==== REPLACE
new content
>>>> EDIT END
""")
        results = apply_edits_to_repo(blocks, tmp_path, dry_run=True)
        assert results[0].status == EditStatus.VALIDATED
        # File unchanged
        assert (tmp_path / "app.py").read_text() == "old content\n"

    def test_path_escape_blocked(self, tmp_path):
        blocks = parse_edit_blocks("""
../../etc/passwd
<<<< EDIT
==== REPLACE
hacked
>>>> EDIT END
""")
        results = apply_edits_to_repo(blocks, tmp_path)
        assert results[0].status == EditStatus.SKIPPED

    def test_binary_file_skipped(self, tmp_path):
        (tmp_path / "data.bin").write_bytes(b"\x00\x01\x02\x03" * 100)

        blocks = parse_edit_blocks("""
data.bin
<<<< EDIT
something
==== REPLACE
other
>>>> EDIT END
""")
        results = apply_edits_to_repo(blocks, tmp_path)
        assert results[0].status == EditStatus.SKIPPED

    def test_missing_file_fails(self, tmp_path):
        blocks = parse_edit_blocks("""
nonexistent.py
<<<< EDIT
old
==== REPLACE
new
>>>> EDIT END
""")
        results = apply_edits_to_repo(blocks, tmp_path)
        assert results[0].status == EditStatus.FAILED

    def test_multiple_edits_sequential(self, tmp_path):
        (tmp_path / "app.py").write_text("line1\nline2\nline3\n")

        blocks = parse_edit_blocks("""
app.py
<<<< EDIT
line1
==== REPLACE
LINE1
>>>> EDIT END

app.py
<<<< EDIT
line3
==== REPLACE
LINE3
>>>> EDIT END
""")
        results = apply_edits_to_repo(blocks, tmp_path)
        assert all(r.status == EditStatus.APPLIED for r in results)
        content = (tmp_path / "app.py").read_text()
        assert "LINE1" in content
        assert "LINE3" in content
