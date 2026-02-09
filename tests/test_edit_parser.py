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

new content
═══════ REPL
new content
