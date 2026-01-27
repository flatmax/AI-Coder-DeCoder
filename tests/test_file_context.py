"""Tests for ac/context/file_context.py"""

import pytest
from pathlib import Path
from ac.context import FileContext, TokenCounter


class TestFileContextInit:
    """Tests for FileContext initialization."""
    
    def test_init_default_repo_root(self):
        ctx = FileContext()
        assert ctx.repo_root == Path.cwd()
    
    def test_init_custom_repo_root(self, tmp_path):
        ctx = FileContext(str(tmp_path))
        assert ctx.repo_root == tmp_path
    
    def test_init_empty(self):
        ctx = FileContext()
        assert len(ctx) == 0
        assert ctx.get_files() == []


class TestFileContextAddRemove:
    """Tests for adding and removing files."""
    
    def test_add_file_with_content(self):
        ctx = FileContext()
        ctx.add_file("test.py", "print('hello')")
        assert "test.py" in ctx
        assert ctx.get_content("test.py") == "print('hello')"
    
    def test_add_file_from_disk(self, tmp_path):
        # Create a test file
        test_file = tmp_path / "example.py"
        test_file.write_text("# Example\nx = 1")
        
        ctx = FileContext(str(tmp_path))
        ctx.add_file("example.py")
        
        assert "example.py" in ctx
        assert ctx.get_content("example.py") == "# Example\nx = 1"
    
    def test_add_file_not_found(self, tmp_path):
        ctx = FileContext(str(tmp_path))
        with pytest.raises(FileNotFoundError):
            ctx.add_file("nonexistent.py")
    
    def test_add_multiple_files(self):
        ctx = FileContext()
        ctx.add_file("a.py", "# a")
        ctx.add_file("b.py", "# b")
        ctx.add_file("c.py", "# c")
        
        assert len(ctx) == 3
        assert set(ctx.get_files()) == {"a.py", "b.py", "c.py"}
    
    def test_add_file_overwrites(self):
        ctx = FileContext()
        ctx.add_file("test.py", "version 1")
        ctx.add_file("test.py", "version 2")
        
        assert len(ctx) == 1
        assert ctx.get_content("test.py") == "version 2"
    
    def test_remove_file_exists(self):
        ctx = FileContext()
        ctx.add_file("test.py", "content")
        
        result = ctx.remove_file("test.py")
        
        assert result is True
        assert "test.py" not in ctx
        assert len(ctx) == 0
    
    def test_remove_file_not_exists(self):
        ctx = FileContext()
        result = ctx.remove_file("nonexistent.py")
        assert result is False
    
    def test_clear(self):
        ctx = FileContext()
        ctx.add_file("a.py", "# a")
        ctx.add_file("b.py", "# b")
        
        ctx.clear()
        
        assert len(ctx) == 0
        assert ctx.get_files() == []


class TestFileContextAccess:
    """Tests for accessing file content."""
    
    def test_get_content_exists(self):
        ctx = FileContext()
        ctx.add_file("test.py", "content here")
        assert ctx.get_content("test.py") == "content here"
    
    def test_get_content_not_exists(self):
        ctx = FileContext()
        assert ctx.get_content("nonexistent.py") is None
    
    def test_has_file(self):
        ctx = FileContext()
        ctx.add_file("test.py", "content")
        
        assert ctx.has_file("test.py") is True
        assert ctx.has_file("other.py") is False
    
    def test_contains_operator(self):
        ctx = FileContext()
        ctx.add_file("test.py", "content")
        
        assert "test.py" in ctx
        assert "other.py" not in ctx
    
    def test_len(self):
        ctx = FileContext()
        assert len(ctx) == 0
        
        ctx.add_file("a.py", "a")
        assert len(ctx) == 1
        
        ctx.add_file("b.py", "b")
        assert len(ctx) == 2


class TestFileContextFormatting:
    """Tests for formatting files for prompts."""
    
    def test_format_empty(self):
        ctx = FileContext()
        assert ctx.format_for_prompt() == ""
    
    def test_format_single_file(self):
        ctx = FileContext()
        ctx.add_file("test.py", "print('hello')")
        
        formatted = ctx.format_for_prompt()
        
        assert "test.py" in formatted
        assert "```" in formatted
        assert "print('hello')" in formatted
    
    def test_format_multiple_files(self):
        ctx = FileContext()
        ctx.add_file("a.py", "# file a")
        ctx.add_file("b.py", "# file b")
        
        formatted = ctx.format_for_prompt()
        
        assert "a.py" in formatted
        assert "b.py" in formatted
        assert "# file a" in formatted
        assert "# file b" in formatted
        # Files should be separated
        assert formatted.count("```") == 4  # 2 files × 2 fences each
    
    def test_format_custom_fence(self):
        ctx = FileContext()
        ctx.add_file("test.py", "code")
        
        formatted = ctx.format_for_prompt(fence=("~~~", "~~~"))
        
        assert "~~~" in formatted
        assert "```" not in formatted
    
    def test_format_preserves_content(self):
        ctx = FileContext()
        content = "def foo():\n    return 42\n"
        ctx.add_file("test.py", content)
        
        formatted = ctx.format_for_prompt()
        
        assert content in formatted


class TestFileContextTokenCounting:
    """Tests for token counting."""
    
    def test_count_tokens_empty(self):
        ctx = FileContext()
        counter = TokenCounter("gpt-4")
        
        assert ctx.count_tokens(counter) == 0
    
    def test_count_tokens_with_files(self):
        ctx = FileContext()
        ctx.add_file("test.py", "print('hello world')")
        counter = TokenCounter("gpt-4")
        
        count = ctx.count_tokens(counter)
        
        assert count > 0
        assert count < 100  # Sanity check
    
    def test_tokens_by_file(self):
        ctx = FileContext()
        ctx.add_file("small.py", "x=1")
        ctx.add_file("large.py", "# " + "word " * 100)
        counter = TokenCounter("gpt-4")
        
        by_file = ctx.get_tokens_by_file(counter)
        
        assert "small.py" in by_file
        assert "large.py" in by_file
        assert by_file["large.py"] > by_file["small.py"]
    
    def test_tokens_by_file_empty(self):
        ctx = FileContext()
        counter = TokenCounter("gpt-4")
        
        by_file = ctx.get_tokens_by_file(counter)
        
        assert by_file == {}
