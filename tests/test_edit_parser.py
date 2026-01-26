"""
Tests for the anchored edit block parser (v2).
"""

import pytest
from ac.edit_parser import EditParser, EditBlock, EditStatus, EditResult, ApplyResult


class TestEditParserParse:
    """Tests for EditParser.parse_response()"""
    
    def test_parse_single_block(self):
        """Basic single edit block parsing."""
        parser = EditParser()
        response = """Here's the fix:

src/math.py
««« EDIT
def multiply(a, b):
───────
    return a + b  # BUG
═══════
    return a * b
───────
    
def other():
»»»

Done!"""
        
        blocks = parser.parse_response(response)
        assert len(blocks) == 1
        block = blocks[0]
        assert block.file_path == "src/math.py"
        assert block.leading_anchor == "def multiply(a, b):"
        assert block.old_lines == "    return a + b  # BUG"
        assert block.new_lines == "    return a * b"
        assert block.trailing_anchor == "    \ndef other():"
    
    def test_parse_multiple_blocks(self):
        """Multiple edit blocks in one response."""
        parser = EditParser()
        response = """I'll fix both files.

src/a.py
««« EDIT
def foo():
───────
    return 1
═══════
    return 2
───────
»»»

src/b.py
««« EDIT
def bar():
───────
    return "a"
═══════
    return "b"
───────
»»»
"""
        
        blocks = parser.parse_response(response)
        assert len(blocks) == 2
        assert blocks[0].file_path == "src/a.py"
        assert blocks[1].file_path == "src/b.py"
    
    def test_parse_with_surrounding_text(self):
        """Edit blocks surrounded by markdown explanation."""
        parser = EditParser()
        response = """## Analysis

The bug is in the calculation.

### Fix

src/calc.py
««« EDIT
───────
old = 1
═══════
new = 2
───────
»»»

This should resolve the issue.

### Testing

Run `pytest` to verify."""
        
        blocks = parser.parse_response(response)
        assert len(blocks) == 1
        assert blocks[0].file_path == "src/calc.py"
        assert blocks[0].old_lines == "old = 1"
        assert blocks[0].new_lines == "new = 2"
    
    def test_parse_file_path_with_spaces(self):
        """File path containing spaces."""
        parser = EditParser()
        response = """Fix:

path/to/my file.py
««« EDIT
───────
x = 1
═══════
x = 2
───────
»»»
"""
        
        blocks = parser.parse_response(response)
        assert len(blocks) == 1
        assert blocks[0].file_path == "path/to/my file.py"
    
    def test_skip_empty_path(self):
        """Block with empty/whitespace path is skipped."""
        parser = EditParser()
        response = """

««« EDIT
───────
x = 1
═══════
x = 2
───────
»»»
"""
        
        blocks = parser.parse_response(response)
        assert len(blocks) == 0
    
    def test_skip_unclosed_block(self):
        """Unclosed block at end of response is discarded."""
        parser = EditParser()
        # Block that never closes - should be discarded
        lines = [
            "src/broken.py",
            "««« EDIT",
            "def foo():",
            "───────",
            "    return 1",
            "═══════",
            "    return 2",
            "───────",
            "# no closing marker - response ends here",
        ]
        response = "\n".join(lines)
        
        blocks = parser.parse_response(response)
        # Block should be discarded since it never closes
        assert len(blocks) == 0
    
    def test_multiple_blocks_both_complete(self):
        """Two complete blocks both parsed."""
        parser = EditParser()
        lines = [
            "src/first.py",
            "««« EDIT",
            "def foo():",
            "───────",
            "    return 1",
            "═══════",
            "    return 2",
            "───────",
            "»»»",
            "",
            "src/second.py",
            "««« EDIT",
            "def bar():",
            "───────",
            '    return "a"',
            "═══════",
            '    return "b"',
            "───────",
            "»»»",
        ]
        response = "\n".join(lines)
        
        blocks = parser.parse_response(response)
        assert len(blocks) == 2
        assert blocks[0].file_path == "src/first.py"
        assert blocks[1].file_path == "src/second.py"
    
    def test_skip_missing_content_separator(self):
        """Block missing ═══════ is skipped."""
        parser = EditParser()
        response = """src/test.py
««« EDIT
def foo():
───────
    return 1
───────
»»»
"""
        
        blocks = parser.parse_response(response)
        assert len(blocks) == 0
    
    def test_skip_missing_second_anchor_separator(self):
        """Block missing second ─────── is skipped."""
        parser = EditParser()
        response = """src/test.py
««« EDIT
def foo():
───────
    return 1
═══════
    return 2
»»»
"""
        
        blocks = parser.parse_response(response)
        assert len(blocks) == 0
    
    def test_marker_mid_line_not_recognized(self):
        """Markers appearing mid-line are treated as content."""
        parser = EditParser()
        response = """src/test.py
««« EDIT
def foo():
───────
    x = "═══════"  # This should be content
═══════
    x = "new"
───────
»»»
"""
        
        blocks = parser.parse_response(response)
        assert len(blocks) == 1
        assert '═══════' in blocks[0].old_lines
    
    def test_empty_leading_anchor(self):
        """Empty leading anchor (─────── right after ««« EDIT)."""
        parser = EditParser()
        response = """src/test.py
««« EDIT
───────
old content
═══════
new content
───────
trailing
»»»
"""
        
        blocks = parser.parse_response(response)
        assert len(blocks) == 1
        assert blocks[0].leading_anchor == ""
        assert blocks[0].old_lines == "old content"
        assert blocks[0].trailing_anchor == "trailing"
    
    def test_empty_old_lines(self):
        """Empty old lines (═══════ right after first ───────)."""
        parser = EditParser()
        response = """src/test.py
««« EDIT
leading
───────
═══════
inserted
───────
trailing
»»»
"""
        
        blocks = parser.parse_response(response)
        assert len(blocks) == 1
        assert blocks[0].leading_anchor == "leading"
        assert blocks[0].old_lines == ""
        assert blocks[0].new_lines == "inserted"
        assert blocks[0].trailing_anchor == "trailing"
    
    def test_empty_new_lines(self):
        """Empty new lines (─────── right after ═══════)."""
        parser = EditParser()
        response = """src/test.py
««« EDIT
leading
───────
to delete
═══════
───────
trailing
»»»
"""
        
        blocks = parser.parse_response(response)
        assert len(blocks) == 1
        assert blocks[0].old_lines == "to delete"
        assert blocks[0].new_lines == ""
    
    def test_empty_trailing_anchor(self):
        """Empty trailing anchor (»»» right after second ───────)."""
        parser = EditParser()
        response = """src/test.py
««« EDIT
leading
───────
old
═══════
new
───────
»»»
"""
        
        blocks = parser.parse_response(response)
        assert len(blocks) == 1
        assert blocks[0].trailing_anchor == ""
    
    def test_all_sections_empty_except_new(self):
        """New file creation pattern."""
        parser = EditParser()
        response = """src/newfile.py
««« EDIT
───────
═══════
def hello():
    print("Hello!")
───────
»»»
"""
        
        blocks = parser.parse_response(response)
        assert len(blocks) == 1
        assert blocks[0].leading_anchor == ""
        assert blocks[0].old_lines == ""
        assert blocks[0].new_lines == 'def hello():\n    print("Hello!")'
        assert blocks[0].trailing_anchor == ""
    
    def test_preserves_internal_blank_lines(self):
        """Blank lines within sections are preserved."""
        parser = EditParser()
        response = """src/test.py
««« EDIT
def foo():

    pass
───────
    x = 1

    y = 2
═══════
    x = 10

    y = 20
───────

def bar():
»»»
"""
        
        blocks = parser.parse_response(response)
        assert len(blocks) == 1
        assert "\n\n" in blocks[0].leading_anchor
        assert "\n\n" in blocks[0].old_lines
        assert "\n\n" in blocks[0].new_lines
        assert blocks[0].trailing_anchor.startswith("\n")
    
    def test_preserves_indentation(self):
        """Indentation in content is preserved exactly."""
        parser = EditParser()
        response = """src/test.py
««« EDIT
class Foo:
    def method(self):
───────
        return None
═══════
        return 42
───────
»»»
"""
        
        blocks = parser.parse_response(response)
        assert len(blocks) == 1
        assert blocks[0].old_lines == "        return None"
        assert blocks[0].new_lines == "        return 42"


class TestEditParserValidate:
    """Tests for EditParser.validate_block()"""
    
    def test_valid_block(self):
        """Block that matches file content exactly."""
        parser = EditParser()
        block = EditBlock(
            file_path="test.py",
            leading_anchor="def foo():",
            old_lines="    return 1",
            new_lines="    return 2",
            trailing_anchor="",
            raw_block="",
            line_number=1
        )
        content = "def foo():\n    return 1\n"
        
        error, line = parser.validate_block(block, content)
        assert error is None
    
    def test_leading_anchor_not_found(self):
        """Error when leading anchor doesn't exist in file."""
        parser = EditParser()
        block = EditBlock(
            file_path="test.py",
            leading_anchor="def bar():",
            old_lines="    return 1",
            new_lines="    return 2",
            trailing_anchor="",
            raw_block="",
            line_number=1
        )
        content = "def foo():\n    return 1\n"
        
        error, line = parser.validate_block(block, content)
        assert error is not None
        assert "Leading anchor not found" in error
    
    def test_leading_anchor_multiple_matches(self):
        """Error when edit location matches multiple times."""
        parser = EditParser()
        block = EditBlock(
            file_path="test.py",
            leading_anchor="def foo():",
            old_lines="    pass",
            new_lines="    return 1",
            trailing_anchor="",
            raw_block="",
            line_number=1
        )
        content = "def foo():\n    pass\n\ndef bar():\n    pass\n\ndef foo():\n    pass\n"
        
        error, line = parser.validate_block(block, content)
        assert error is not None
        assert "ambiguous" in error.lower()
    
    def test_old_lines_mismatch(self):
        """Error when old lines don't match after anchor."""
        parser = EditParser()
        block = EditBlock(
            file_path="test.py",
            leading_anchor="def foo():",
            old_lines="    return 999",
            new_lines="    return 2",
            trailing_anchor="",
            raw_block="",
            line_number=1
        )
        content = "def foo():\n    return 1\n"
        
        error, line = parser.validate_block(block, content)
        assert error is not None
        assert "Old lines don't match" in error or "not found" in error.lower()
    
    def test_trailing_anchor_mismatch(self):
        """Error when trailing anchor doesn't match after old lines."""
        parser = EditParser()
        block = EditBlock(
            file_path="test.py",
            leading_anchor="def foo():",
            old_lines="    return 1",
            new_lines="    return 2",
            trailing_anchor="def wrong():",
            raw_block="",
            line_number=1
        )
        content = "def foo():\n    return 1\n\ndef bar():\n    pass\n"
        
        error, line = parser.validate_block(block, content)
        assert error is not None
        assert "Trailing anchor not found" in error or "not found" in error.lower()
    
    def test_new_file_validation(self):
        """New file (all empty) validates against empty/missing file."""
        parser = EditParser()
        block = EditBlock(
            file_path="newfile.py",
            leading_anchor="",
            old_lines="",
            new_lines="print('hello')",
            trailing_anchor="",
            raw_block="",
            line_number=1
        )
        
        error, line = parser.validate_block(block, "")
        assert error is None
    
    def test_line_number_in_error(self):
        """Error includes estimated line number."""
        parser = EditParser()
        block = EditBlock(
            file_path="test.py",
            leading_anchor="def foo():",
            old_lines="    return 1",
            new_lines="    return 2",
            trailing_anchor="",
            raw_block="",
            line_number=1
        )
        content = "# header\n\ndef foo():\n    return 1\n"
        
        error, line = parser.validate_block(block, content)
        assert error is None
        assert line == 3  # def foo() is on line 3


class TestEditParserApply:
    """Tests for EditParser.apply_block() and apply_edits()"""
    
    def test_apply_modification(self):
        """Replace old lines with new lines."""
        parser = EditParser()
        block = EditBlock(
            file_path="test.py",
            leading_anchor="def foo():",
            old_lines="    return 1",
            new_lines="    return 2",
            trailing_anchor="",
            raw_block="",
            line_number=1
        )
        content = "def foo():\n    return 1\n"
        
        new_content, result = parser.apply_block(block, content)
        assert result.status == EditStatus.APPLIED
        assert "return 2" in new_content
        assert "return 1" not in new_content
    
    def test_apply_insertion(self):
        """Insert new lines (empty old lines)."""
        parser = EditParser()
        block = EditBlock(
            file_path="test.py",
            leading_anchor="def foo():",
            old_lines="",
            new_lines="    # inserted comment",
            trailing_anchor="    return 1",
            raw_block="",
            line_number=1
        )
        content = "def foo():\n    return 1\n"
        
        new_content, result = parser.apply_block(block, content)
        assert result.status == EditStatus.APPLIED
        assert "# inserted comment" in new_content
        assert "return 1" in new_content
    
    def test_apply_deletion(self):
        """Delete old lines (empty new lines)."""
        parser = EditParser()
        block = EditBlock(
            file_path="test.py",
            leading_anchor="def foo():",
            old_lines="    # delete me",
            new_lines="",
            trailing_anchor="    return 1",
            raw_block="",
            line_number=1
        )
        content = "def foo():\n    # delete me\n    return 1\n"
        
        new_content, result = parser.apply_block(block, content)
        assert result.status == EditStatus.APPLIED
        assert "# delete me" not in new_content
        assert "return 1" in new_content
    
    def test_apply_new_file(self):
        """Create new file from empty content."""
        parser = EditParser()
        block = EditBlock(
            file_path="newfile.py",
            leading_anchor="",
            old_lines="",
            new_lines="print('hello')",
            trailing_anchor="",
            raw_block="",
            line_number=1
        )
        
        new_content, result = parser.apply_block(block, "")
        assert result.status == EditStatus.APPLIED
        assert "print('hello')" in new_content
    
    def test_trailing_newline_normalization(self):
        """Result always has exactly one trailing newline."""
        parser = EditParser()
        block = EditBlock(
            file_path="test.py",
            leading_anchor="",
            old_lines="",
            new_lines="x = 1",
            trailing_anchor="",
            raw_block="",
            line_number=1
        )
        
        new_content, result = parser.apply_block(block, "")
        assert new_content.endswith('\n')
        assert not new_content.endswith('\n\n')
    
    def test_crlf_normalization(self):
        """CRLF in file content normalized to LF."""
        parser = EditParser()
        block = EditBlock(
            file_path="test.py",
            leading_anchor="def foo():",
            old_lines="    return 1",
            new_lines="    return 2",
            trailing_anchor="",
            raw_block="",
            line_number=1
        )
        content = "def foo():\r\n    return 1\r\n"
        
        new_content, result = parser.apply_block(block, content)
        assert result.status == EditStatus.APPLIED
        assert '\r\n' not in new_content
    
    def test_sequential_edits_same_file(self):
        """Multiple edits to same file applied in order."""
        parser = EditParser()
        blocks = [
            EditBlock(
                file_path="test.py",
                leading_anchor="",
                old_lines="x = 1",
                new_lines="x = 2",
                trailing_anchor="y = 1",
                raw_block="",
                line_number=1
            ),
            EditBlock(
                file_path="test.py",
                leading_anchor="x = 2",
                old_lines="y = 1",
                new_lines="y = 2",
                trailing_anchor="",
                raw_block="",
                line_number=1
            ),
        ]
        
        # Create a mock repo
        class MockRepo:
            def __init__(self):
                self.content = "x = 1\ny = 1\n"
                self.written = {}
                self.staged = []
            
            def get_file_content(self, path):
                return self.content
            
            def write_file(self, path, content):
                self.written[path] = content
            
            def stage_files(self, paths):
                self.staged.extend(paths)
            
            def is_binary_file(self, path):
                return False
        
        repo = MockRepo()
        result = parser.apply_edits(blocks, repo, dry_run=False)
        
        assert len(result.results) == 2
        assert all(r.status == EditStatus.APPLIED for r in result.results)
        assert "test.py" in result.files_modified
        assert "x = 2" in repo.written["test.py"]
        assert "y = 2" in repo.written["test.py"]
    
    def test_skip_after_failure(self):
        """Subsequent edits to file skipped after failure."""
        parser = EditParser()
        blocks = [
            EditBlock(
                file_path="test.py",
                leading_anchor="nonexistent",
                old_lines="x = 1",
                new_lines="x = 2",
                trailing_anchor="",
                raw_block="",
                line_number=1
            ),
            EditBlock(
                file_path="test.py",
                leading_anchor="",
                old_lines="y = 1",
                new_lines="y = 2",
                trailing_anchor="",
                raw_block="",
                line_number=1
            ),
        ]
        
        class MockRepo:
            def get_file_content(self, path):
                return "x = 1\ny = 1\n"
            
            def write_file(self, path, content):
                pass
            
            def stage_files(self, paths):
                pass
            
            def is_binary_file(self, path):
                return False
        
        result = parser.apply_edits(blocks, MockRepo())
        
        assert result.results[0].status == EditStatus.FAILED
        assert result.results[1].status == EditStatus.SKIPPED
        assert "Previous edit" in result.results[1].reason
    
    def test_dry_run_no_write(self):
        """Dry run validates but doesn't write."""
        parser = EditParser()
        block = EditBlock(
            file_path="test.py",
            leading_anchor="",
            old_lines="x = 1",
            new_lines="x = 2",
            trailing_anchor="",
            raw_block="",
            line_number=1
        )
        
        class MockRepo:
            def __init__(self):
                self.written = False
            
            def get_file_content(self, path):
                return "x = 1\n"
            
            def write_file(self, path, content):
                self.written = True
            
            def stage_files(self, paths):
                pass
            
            def is_binary_file(self, path):
                return False
        
        repo = MockRepo()
        result = parser.apply_edits([block], repo, dry_run=True)
        
        assert result.results[0].status == EditStatus.APPLIED
        assert not repo.written
    
    def test_auto_stage(self):
        """Modified files are git staged."""
        parser = EditParser()
        block = EditBlock(
            file_path="test.py",
            leading_anchor="",
            old_lines="x = 1",
            new_lines="x = 2",
            trailing_anchor="",
            raw_block="",
            line_number=1
        )
        
        class MockRepo:
            def __init__(self):
                self.staged = []
            
            def get_file_content(self, path):
                return "x = 1\n"
            
            def write_file(self, path, content):
                pass
            
            def stage_files(self, paths):
                self.staged.extend(paths)
            
            def is_binary_file(self, path):
                return False
        
        repo = MockRepo()
        result = parser.apply_edits([block], repo, auto_stage=True)
        
        assert "test.py" in repo.staged
    
    def test_binary_file_rejected(self):
        """Binary files cannot be edited."""
        parser = EditParser()
        block = EditBlock(
            file_path="image.png",
            leading_anchor="",
            old_lines="x = 1",
            new_lines="x = 2",
            trailing_anchor="",
            raw_block="",
            line_number=1
        )
        
        class MockRepo:
            def is_binary_file(self, path):
                return True
            
            def get_file_content(self, path):
                return b'\x89PNG'
        
        result = parser.apply_edits([block], MockRepo())
        
        assert result.results[0].status == EditStatus.FAILED
        assert "binary" in result.results[0].reason.lower()


class TestEditParserHelpers:
    """Tests for helper methods."""
    
    def test_detect_format_edit_v2(self):
        """Detect new EDIT format."""
        parser = EditParser()
        response = "file.py\n\u00ab\u00ab\u00ab EDIT\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\u00bb\u00bb\u00bb"
        assert parser.detect_format(response) == "edit_v2"
    
    def test_detect_format_search_replace(self):
        """Detect old SEARCH/REPLACE format."""
        parser = EditParser()
        response = "file.py\n<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE"
        assert parser.detect_format(response) == "search_replace"
    
    def test_detect_format_none(self):
        """Detect no edit format."""
        parser = EditParser()
        response = "Just some text without any edits."
        assert parser.detect_format(response) == "none"
    
    def test_detect_shell_suggestions(self):
        """Extract shell command suggestions."""
        parser = EditParser()
        response = """To rename the file, run:
`git mv old.py new.py`

To remove it:
`git rm deprecated.py`
"""
        suggestions = parser.detect_shell_suggestions(response)
        assert "git mv old.py new.py" in suggestions
        assert "git rm deprecated.py" in suggestions
    
    def test_find_line_number(self):
        """Line number calculation."""
        parser = EditParser()
        content = "line1\nline2\nline3\n"
        
        assert parser._find_line_number(content, 0) == 1
        assert parser._find_line_number(content, 6) == 2
        assert parser._find_line_number(content, 12) == 3
    def test_find_line_number(self):
        """Line number calculation."""
        parser = EditParser()
        content = "line1\nline2\nline3\n"
        
        assert parser._find_line_number(content, 0) == 1
        assert parser._find_line_number(content, 6) == 2
        assert parser._find_line_number(content, 12) == 3


class TestEditParserAdditional:
    """Additional tests for edge cases and coverage gaps."""
    
    def test_parse_with_actual_unicode_markers(self):
        """Verify parsing works with actual unicode marker characters."""
        parser = EditParser()
        # Using the actual unicode characters from the format
        response = "src/test.py\n\u00ab\u00ab\u00ab EDIT\ndef foo():\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n    old\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n    new\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\u00bb\u00bb\u00bb"
        blocks = parser.parse_response(response)
        assert len(blocks) == 1
        assert blocks[0].file_path == "src/test.py"
        assert blocks[0].old_lines == "    old"
        assert blocks[0].new_lines == "    new"

    def test_multiline_leading_anchor(self):
        """Multi-line leading anchor parsed correctly."""
        parser = EditParser()
        lines = [
            "src/test.py",
            "\u00ab\u00ab\u00ab EDIT",
            "def foo():",
            "    '''Docstring.'''",
            "    x = 1",
            "\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
            "    y = 2",
            "\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
            "    y = 3",
            "\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
            "\u00bb\u00bb\u00bb",
        ]
        response = "\n".join(lines)
        blocks = parser.parse_response(response)
        assert len(blocks) == 1
        assert "x = 1" in blocks[0].leading_anchor
        assert blocks[0].leading_anchor.count('\n') == 2

    def test_multiline_sections_boundary(self):
        """Verify newline boundaries between multi-line sections."""
        parser = EditParser()
        block = EditBlock(
            file_path="test.py",
            leading_anchor="def foo():\n    x = 1",
            old_lines="    y = 2\n    z = 3",
            new_lines="    y = 20",
            trailing_anchor="    return x",
            raw_block="",
            line_number=1
        )
        content = "def foo():\n    x = 1\n    y = 2\n    z = 3\n    return x\n"
        
        error, line = parser.validate_block(block, content)
        assert error is None

    def test_ambiguous_includes_both_line_numbers(self):
        """Ambiguous error message includes both matching line numbers."""
        parser = EditParser()
        block = EditBlock(
            file_path="test.py",
            leading_anchor="x = 1",
            old_lines="y = 2",
            new_lines="y = 20",
            trailing_anchor="",
            raw_block="",
            line_number=1
        )
        content = "x = 1\ny = 2\nz = 3\nx = 1\ny = 2\n"
        
        error, line = parser.validate_block(block, content)
        assert error is not None
        assert "ambiguous" in error.lower()
        # Should mention both line numbers
        assert "1" in error and "4" in error

    def test_old_lines_not_found_no_anchor(self):
        """Error when old lines not found (no leading anchor)."""
        parser = EditParser()
        block = EditBlock(
            file_path="test.py",
            leading_anchor="",
            old_lines="nonexistent line",
            new_lines="new",
            trailing_anchor="",
            raw_block="",
            line_number=1
        )
        content = "some other content\n"
        
        error, line = parser.validate_block(block, content)
        assert error is not None
        assert "not found" in error.lower()

    def test_trailing_anchor_only_not_found(self):
        """Error when only trailing anchor specified and not found."""
        parser = EditParser()
        block = EditBlock(
            file_path="test.py",
            leading_anchor="",
            old_lines="",
            new_lines="inserted",
            trailing_anchor="nonexistent",
            raw_block="",
            line_number=1
        )
        content = "some content\n"
        
        error, line = parser.validate_block(block, content)
        assert error is not None
        assert "not found" in error.lower()

    def test_apply_edits_repo_returns_error_dict(self):
        """Handle repo.get_file_content returning error dict."""
        parser = EditParser()
        block = EditBlock(
            file_path="missing.py",
            leading_anchor="def foo():",
            old_lines="    pass",
            new_lines="    return 1",
            trailing_anchor="",
            raw_block="",
            line_number=1
        )
        
        class MockRepo:
            def get_file_content(self, path):
                return {'error': 'File not found'}
            
            def is_binary_file(self, path):
                return False
        
        result = parser.apply_edits([block], MockRepo())
        assert result.results[0].status == EditStatus.FAILED
        assert "not found" in result.results[0].reason.lower()

    def test_apply_edits_no_repo_existing_file(self):
        """apply_edits with repo=None for non-new-file fails gracefully."""
        parser = EditParser()
        block = EditBlock(
            file_path="test.py",
            leading_anchor="def foo():",
            old_lines="    pass",
            new_lines="    return 1",
            trailing_anchor="",
            raw_block="",
            line_number=1
        )
        
        result = parser.apply_edits([block], repo=None)
        assert result.results[0].status == EditStatus.FAILED
        assert "not found" in result.results[0].reason.lower() or "repo" in result.results[0].reason.lower()

    def test_apply_edits_new_file_creation(self):
        """New file creation through apply_edits with file not existing."""
        parser = EditParser()
        block = EditBlock(
            file_path="brand_new.py",
            leading_anchor="",
            old_lines="",
            new_lines="print('hello')",
            trailing_anchor="",
            raw_block="",
            line_number=1
        )
        
        class MockRepo:
            def __init__(self):
                self.written = {}
                self.staged = []
            
            def get_file_content(self, path):
                return {'error': 'File not found'}
            
            def write_file(self, path, content):
                self.written[path] = content
            
            def stage_files(self, paths):
                self.staged.extend(paths)
            
            def is_binary_file(self, path):
                return False
        
        repo = MockRepo()
        result = parser.apply_edits([block], repo, dry_run=False)
        
        assert result.results[0].status == EditStatus.APPLIED
        assert "brand_new.py" in repo.written
        assert "print('hello')" in repo.written["brand_new.py"]

    def test_apply_edits_new_file_no_repo(self):
        """New file creation works even without repo (content cached)."""
        parser = EditParser()
        block = EditBlock(
            file_path="new.py",
            leading_anchor="",
            old_lines="",
            new_lines="x = 1",
            trailing_anchor="",
            raw_block="",
            line_number=1
        )
        
        # No repo, but new file creation should still work for validation
        result = parser.apply_edits([block], repo=None, dry_run=True)
        assert result.results[0].status == EditStatus.APPLIED

    def test_apply_multiline_modification(self):
        """Apply edit with multi-line old and new content."""
        parser = EditParser()
        block = EditBlock(
            file_path="test.py",
            leading_anchor="class Foo:",
            old_lines="    def __init__(self):\n        self.x = 1\n        self.y = 2",
            new_lines="    def __init__(self, x, y):\n        self.x = x\n        self.y = y",
            trailing_anchor="\n    def method(self):",
            raw_block="",
            line_number=1
        )
        content = "class Foo:\n    def __init__(self):\n        self.x = 1\n        self.y = 2\n\n    def method(self):\n        pass\n"
        
        new_content, result = parser.apply_block(block, content)
        assert result.status == EditStatus.APPLIED
        assert "def __init__(self, x, y):" in new_content
        assert "self.x = x" in new_content
        assert "def method(self):" in new_content

    def test_parse_block_with_code_containing_separator_chars(self):
        """Parse block where code content contains separator-like characters."""
        parser = EditParser()
        lines = [
            "src/test.py",
            "\u00ab\u00ab\u00ab EDIT",
            "def draw():",
            "\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
            '    print("------- header -------")',
            "\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
            '    print("======= header =======")',
            "\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
            "\u00bb\u00bb\u00bb",
        ]
        response = "\n".join(lines)
        blocks = parser.parse_response(response)
        assert len(blocks) == 1
        # ASCII dashes in content should NOT be confused with markers
        assert '-------' in blocks[0].old_lines
        assert '=======' in blocks[0].new_lines

    def test_consecutive_edits_different_files(self):
        """Multiple edits to different files all succeed."""
        parser = EditParser()
        blocks = [
            EditBlock(
                file_path="a.py",
                leading_anchor="",
                old_lines="x = 1",
                new_lines="x = 10",
                trailing_anchor="",
                raw_block="",
                line_number=1
            ),
            EditBlock(
                file_path="b.py",
                leading_anchor="",
                old_lines="y = 2",
                new_lines="y = 20",
                trailing_anchor="",
                raw_block="",
                line_number=1
            ),
        ]
        
        class MockRepo:
            def __init__(self):
                self.files = {"a.py": "x = 1\n", "b.py": "y = 2\n"}
                self.written = {}
                self.staged = []
            
            def get_file_content(self, path):
                return self.files.get(path, {'error': 'not found'})
            
            def write_file(self, path, content):
                self.written[path] = content
            
            def stage_files(self, paths):
                self.staged.extend(paths)
            
            def is_binary_file(self, path):
                return False
        
        repo = MockRepo()
        result = parser.apply_edits(blocks, repo)
        
        assert len(result.results) == 2
        assert all(r.status == EditStatus.APPLIED for r in result.results)
        assert "a.py" in result.files_modified
        assert "b.py" in result.files_modified
        assert "x = 10" in repo.written["a.py"]
        assert "y = 20" in repo.written["b.py"]

    def test_diagnose_trailing_without_old(self):
        """Diagnose failure when trailing anchor follows leading directly."""
        parser = EditParser()
        block = EditBlock(
            file_path="test.py",
            leading_anchor="def foo():",
            old_lines="",
            new_lines="    # inserted",
            trailing_anchor="wrong_trailing",
            raw_block="",
            line_number=1
        )
        content = "def foo():\n    pass\n"
        
        error, line = parser.validate_block(block, content)
        assert error is not None
        assert "trailing" in error.lower() or "not found" in error.lower()

    def test_result_previews_truncated(self):
        """EditResult preview fields are truncated to 50 chars."""
        parser = EditParser()
        long_line = "x" * 100
        block = EditBlock(
            file_path="test.py",
            leading_anchor=long_line,
            old_lines=long_line,
            new_lines=long_line,
            trailing_anchor="",
            raw_block="",
            line_number=1
        )
        content = long_line + "\n" + long_line + "\n"
        
        new_content, result = parser.apply_block(block, content)
        assert len(result.anchor_preview) == 50
        assert len(result.old_preview) == 50
        assert len(result.new_preview) == 50
