"""Tests for symbol map stable ordering (prefix cache optimization)."""

import json
import pytest
from pathlib import Path

from ac.symbol_index.symbol_index import SymbolIndex
from ac.symbol_index.compact_format import to_compact, _is_test_file, _format_collapsed_test_file, _format_cross_file_calls
from ac.symbol_index.models import Symbol, Range, CallSite


@pytest.fixture
def temp_repo(tmp_path):
    """Create a temporary repo with some Python files."""
    # Create .aicoder directory
    (tmp_path / ".aicoder").mkdir()
    
    # Create some test files
    (tmp_path / "a_first.py").write_text("def foo(): pass")
    (tmp_path / "b_second.py").write_text("def bar(): pass")
    (tmp_path / "c_third.py").write_text("def baz(): pass")
    
    return tmp_path


@pytest.fixture
def symbol_index(temp_repo):
    """Create a SymbolIndex for the temp repo."""
    return SymbolIndex(str(temp_repo))


class TestOrderPersistence:
    """Test that file order is persisted and loaded correctly."""
    
    def test_save_order_creates_file(self, symbol_index, temp_repo):
        order = ["a_first.py", "b_second.py"]
        symbol_index._save_order(order)
        
        order_path = temp_repo / ".aicoder" / "symbol_map_order.json"
        assert order_path.exists()
        
        with open(order_path) as f:
            data = json.load(f)
        assert data["order"] == order
    
    def test_load_order_returns_saved_order(self, symbol_index, temp_repo):
        order = ["c_third.py", "a_first.py"]
        symbol_index._save_order(order)
        
        # Clear cached order to force reload
        symbol_index._file_order = None
        
        loaded = symbol_index._load_order()
        assert loaded == order
    
    def test_load_order_returns_empty_if_no_file(self, symbol_index):
        loaded = symbol_index._load_order()
        assert loaded == []
    
    def test_load_order_handles_corrupted_json(self, symbol_index, temp_repo):
        order_path = temp_repo / ".aicoder" / "symbol_map_order.json"
        order_path.write_text("not valid json {{{")
        
        loaded = symbol_index._load_order()
        assert loaded == []
    
    def test_load_order_caches_result(self, symbol_index, temp_repo):
        order = ["a_first.py"]
        symbol_index._save_order(order)
        symbol_index._file_order = None
        
        # Load twice
        first_load = symbol_index._load_order()
        second_load = symbol_index._load_order()
        
        # Should be same object (cached)
        assert first_load is second_load


class TestGetOrderedFiles:
    """Test the get_ordered_files method."""
    
    def test_first_call_returns_sorted(self, symbol_index):
        """First call with no existing order returns sorted files."""
        available = ["c_third.py", "a_first.py", "b_second.py"]
        result = symbol_index.get_ordered_files(available)
        
        assert result == ["a_first.py", "b_second.py", "c_third.py"]
    
    def test_preserves_existing_order(self, symbol_index):
        """Existing order is preserved for files still available."""
        # Establish an order
        symbol_index._save_order(["c_third.py", "a_first.py", "b_second.py"])
        symbol_index._file_order = None
        
        available = ["a_first.py", "b_second.py", "c_third.py"]
        result = symbol_index.get_ordered_files(available)
        
        # Should maintain the saved order
        assert result == ["c_third.py", "a_first.py", "b_second.py"]
    
    def test_new_files_appended_at_bottom(self, symbol_index):
        """New files are appended at the bottom, sorted among themselves."""
        # Establish an order with only some files
        symbol_index._save_order(["b_second.py"])
        symbol_index._file_order = None
        
        available = ["a_first.py", "b_second.py", "c_third.py"]
        result = symbol_index.get_ordered_files(available)
        
        # b_second.py keeps position, new files appended sorted
        assert result == ["b_second.py", "a_first.py", "c_third.py"]
    
    def test_unavailable_files_filtered_out(self, symbol_index):
        """Files in saved order but not available are filtered out."""
        symbol_index._save_order(["a_first.py", "deleted.py", "b_second.py"])
        symbol_index._file_order = None
        
        available = ["a_first.py", "b_second.py"]
        result = symbol_index.get_ordered_files(available)
        
        assert result == ["a_first.py", "b_second.py"]
        assert "deleted.py" not in result
    
    def test_saves_updated_order(self, symbol_index, temp_repo):
        """get_ordered_files saves the updated order."""
        available = ["c_third.py", "a_first.py"]
        symbol_index.get_ordered_files(available)
        
        # Check the saved file
        order_path = temp_repo / ".aicoder" / "symbol_map_order.json"
        with open(order_path) as f:
            data = json.load(f)
        
        assert data["order"] == ["a_first.py", "c_third.py"]


class TestCompactFormatFileOrder:
    """Test that compact format respects file_order parameter."""
    
    def _make_symbol(self, name, line=1):
        """Helper to create a simple symbol."""
        r = Range(start_line=line, start_col=0, end_line=line, end_col=10)
        return Symbol(
            name=name,
            kind="function",
            file_path="test.py",
            range=r,
            selection_range=r,
        )
    
    def test_uses_provided_order(self):
        """to_compact uses file_order when provided."""
        symbols_by_file = {
            "c.py": [self._make_symbol("c_func")],
            "a.py": [self._make_symbol("a_func")],
            "b.py": [self._make_symbol("b_func")],
        }
        
        result = to_compact(
            symbols_by_file,
            include_legend=False,
            file_order=["b.py", "c.py", "a.py"]
        )
        
        lines = result.strip().split("\n")
        file_lines = [l for l in lines if l.endswith(":")]
        
        assert file_lines == ["b.py:", "c.py:", "a.py:"]
    
    def test_falls_back_to_sorted_without_order(self):
        """to_compact sorts alphabetically when file_order is None."""
        symbols_by_file = {
            "c.py": [self._make_symbol("c_func")],
            "a.py": [self._make_symbol("a_func")],
            "b.py": [self._make_symbol("b_func")],
        }
        
        result = to_compact(
            symbols_by_file,
            include_legend=False,
            file_order=None
        )
        
        lines = result.strip().split("\n")
        file_lines = [l for l in lines if l.endswith(":")]
        
        assert file_lines == ["a.py:", "b.py:", "c.py:"]
    
    def test_filters_order_to_available_files(self):
        """Files in file_order but not in symbols_by_file are skipped."""
        symbols_by_file = {
            "a.py": [self._make_symbol("a_func")],
            "b.py": [self._make_symbol("b_func")],
        }
        
        result = to_compact(
            symbols_by_file,
            include_legend=False,
            file_order=["c.py", "a.py", "missing.py", "b.py"]
        )
        
        lines = result.strip().split("\n")
        file_lines = [l for l in lines if l.endswith(":")]
        
        assert file_lines == ["a.py:", "b.py:"]


class TestIsTestFile:
    """Test the _is_test_file helper function."""
    
    def test_test_prefix_in_path(self):
        assert _is_test_file("tests/test_foo.py") is True
        assert _is_test_file("test_foo.py") is True
    
    def test_tests_directory(self):
        assert _is_test_file("tests/something.py") is True
        assert _is_test_file("src/tests/helper.py") is True
    
    def test_test_suffix(self):
        assert _is_test_file("foo_test.py") is True
        assert _is_test_file("src/bar_test.js") is True
    
    def test_spec_files(self):
        assert _is_test_file("Component.test.js") is True
        assert _is_test_file("utils.spec.ts") is True
    
    def test_non_test_files(self):
        assert _is_test_file("src/main.py") is False
        assert _is_test_file("ac/context/manager.py") is False
        assert _is_test_file("testing_utils.py") is False  # Has 'test' but not a test file


class TestTestFileCollapsing:
    """Test that test files are collapsed to summaries."""
    
    def _make_symbol(self, name, kind="function", line=1, children=None):
        """Helper to create a symbol."""
        r = Range(start_line=line, start_col=0, end_line=line, end_col=10)
        return Symbol(
            name=name,
            kind=kind,
            file_path="test.py",
            range=r,
            selection_range=r,
            children=children or [],
        )
    
    def test_collapsed_test_file_shows_counts(self):
        """Collapsed test file should show class/method counts."""
        test_class = self._make_symbol("TestFoo", kind="class", children=[
            self._make_symbol("test_one", kind="method"),
            self._make_symbol("test_two", kind="method"),
            self._make_symbol("test_three", kind="method"),
        ])
        symbols = [test_class]
        
        lines = _format_collapsed_test_file("tests/test_foo.py", symbols, None)
        content = '\n'.join(lines)
        
        assert "tests/test_foo.py:" in content
        assert "1c/3m" in content  # 1 class, 3 methods
    
    def test_collapsed_test_file_shows_imports(self):
        """Collapsed test file should still show imports."""
        import_sym = self._make_symbol("import pytest", kind="import")
        symbols = [import_sym]
        
        lines = _format_collapsed_test_file("tests/test_foo.py", symbols, None)
        content = '\n'.join(lines)
        
        assert "i pytest" in content
    
    def test_collapsed_test_file_shows_local_imports(self):
        """Collapsed test file should show i→ local imports."""
        symbols = []
        file_imports = {"tests/test_foo.py": {"ac/foo.py", "ac/bar.py"}}
        
        lines = _format_collapsed_test_file("tests/test_foo.py", symbols, file_imports)
        content = '\n'.join(lines)
        
        assert "i→" in content
        assert "ac/bar.py" in content
        assert "ac/foo.py" in content
    
    def test_collapsed_test_file_shows_fixtures(self):
        """Collapsed test file should show fixture functions."""
        symbols = [
            self._make_symbol("my_fixture", kind="function"),
            self._make_symbol("test_something", kind="function"),
        ]
        
        lines = _format_collapsed_test_file("tests/test_foo.py", symbols, None)
        content = '\n'.join(lines)
        
        assert "fixtures:my_fixture" in content
        assert "1f" in content  # 1 test function
    
    def test_to_compact_collapses_test_files(self):
        """to_compact should collapse test files by default."""
        test_class = self._make_symbol("TestFoo", kind="class", children=[
            self._make_symbol("test_one", kind="method"),
            self._make_symbol("test_two", kind="method"),
        ])
        symbols_by_file = {
            "tests/test_foo.py": [test_class],
        }
        
        result = to_compact(symbols_by_file, include_legend=False)
        
        # Should have summary, not individual methods
        assert "1c/2m" in result
        assert "test_one" not in result
        assert "test_two" not in result
    
    def test_to_compact_collapse_tests_false(self):
        """collapse_tests=False should show full test details."""
        test_class = self._make_symbol("TestFoo", kind="class", children=[
            self._make_symbol("test_one", kind="method"),
            self._make_symbol("test_two", kind="method"),
        ])
        symbols_by_file = {
            "tests/test_foo.py": [test_class],
        }
        
        result = to_compact(symbols_by_file, include_legend=False, collapse_tests=False)
        
        # Should have full details
        assert "test_one" in result
        assert "test_two" in result
        assert "1c/2m" not in result


class TestFileWeight:
    """Test that file headers show reference weight."""
    
    def _make_symbol(self, name, line=1):
        """Helper to create a simple symbol."""
        r = Range(start_line=line, start_col=0, end_line=line, end_col=10)
        return Symbol(
            name=name,
            kind="function",
            file_path="test.py",
            range=r,
            selection_range=r,
        )
    
    def test_file_weight_shown_when_referenced(self):
        """Files with references should show ←N in header."""
        symbols_by_file = {
            "src/foo.py": [self._make_symbol("func")],
        }
        file_refs = {
            "src/foo.py": {"bar.py", "baz.py", "qux.py"},
        }
        
        result = to_compact(
            symbols_by_file,
            file_refs=file_refs,
            include_legend=False,
            collapse_tests=False,
        )
        
        assert "src/foo.py: ←3" in result
    
    def test_file_weight_not_shown_when_zero(self):
        """Files with no references should not show ←N."""
        symbols_by_file = {
            "src/foo.py": [self._make_symbol("func")],
        }
        
        result = to_compact(
            symbols_by_file,
            file_refs={},
            include_legend=False,
            collapse_tests=False,
        )
        
        assert "src/foo.py:" in result
        assert "src/foo.py: ←" not in result


class TestSymbolIndexToCompactOrdering:
    """Test that SymbolIndex.to_compact uses stable ordering."""
    
    def test_to_compact_uses_stable_order(self, symbol_index, temp_repo):
        """to_compact should use get_ordered_files for ordering."""
        # Index the files
        files = ["a_first.py", "b_second.py", "c_third.py"]
        
        # Establish a non-alphabetical order
        symbol_index._save_order(["c_third.py", "b_second.py", "a_first.py"])
        symbol_index._file_order = None
        
        result = symbol_index.to_compact(files)
        
        lines = result.split("\n")
        file_lines = [l for l in lines if l.endswith(":")]
        
        assert file_lines == ["c_third.py:", "b_second.py:", "a_first.py:"]


class TestToCompactChunked:
    """Test the chunked compact format generation."""
    
    def _make_symbol(self, name, line=1):
        """Helper to create a simple symbol."""
        r = Range(start_line=line, start_col=0, end_line=line, end_col=10)
        return Symbol(
            name=name,
            kind="function",
            file_path="test.py",
            range=r,
            selection_range=r,
        )
    
    def test_single_chunk_when_small(self):
        """Small symbol maps should return a single chunk."""
        from ac.symbol_index.compact_format import to_compact_chunked
        
        symbols_by_file = {
            "a.py": [self._make_symbol("foo")],
            "b.py": [self._make_symbol("bar")],
        }
        
        chunks = to_compact_chunked(
            symbols_by_file,
            include_legend=False,
            min_chunk_tokens=10000,  # Very high threshold
        )
        
        assert len(chunks) == 1
        assert "a.py:" in chunks[0]
        assert "b.py:" in chunks[0]
    
    def test_multiple_chunks_when_large(self):
        """Large symbol maps should be split into multiple chunks."""
        from ac.symbol_index.compact_format import to_compact_chunked
        
        # Create enough symbols to exceed 1024 tokens (~4096 chars)
        symbols_by_file = {}
        for i in range(20):
            file_name = f"file_{i:02d}.py"
            # Each file has several symbols to make it substantial
            symbols_by_file[file_name] = [
                self._make_symbol(f"function_{j}_with_a_long_name", line=j*10)
                for j in range(10)
            ]
        
        chunks = to_compact_chunked(
            symbols_by_file,
            include_legend=True,
            min_chunk_tokens=1024,
        )
        
        # Should have multiple chunks
        assert len(chunks) > 1
        
        # Legend should only be in first chunk
        assert "# c=class" in chunks[0]
        for chunk in chunks[1:]:
            assert "# c=class" not in chunk
    
    def test_respects_file_order(self):
        """Chunks should respect the provided file order."""
        from ac.symbol_index.compact_format import to_compact_chunked
        
        symbols_by_file = {
            "c.py": [self._make_symbol("c_func")],
            "a.py": [self._make_symbol("a_func")],
            "b.py": [self._make_symbol("b_func")],
        }
        
        chunks = to_compact_chunked(
            symbols_by_file,
            include_legend=False,
            file_order=["b.py", "c.py", "a.py"],
            min_chunk_tokens=0,  # No chunking
        )
        
        # Single chunk with correct order
        assert len(chunks) == 1
        content = chunks[0]
        
        # Verify order by finding positions
        b_pos = content.find("b.py:")
        c_pos = content.find("c.py:")
        a_pos = content.find("a.py:")
        
        assert b_pos < c_pos < a_pos
    
    def test_chunk_boundaries_at_file_boundaries(self):
        """Chunks should break at file boundaries, not mid-file."""
        from ac.symbol_index.compact_format import to_compact_chunked
        
        # Create files of varying sizes
        symbols_by_file = {
            "small.py": [self._make_symbol("tiny")],
            "medium.py": [self._make_symbol(f"func_{i}") for i in range(5)],
            "large.py": [self._make_symbol(f"big_func_{i}") for i in range(20)],
        }
        
        chunks = to_compact_chunked(
            symbols_by_file,
            include_legend=False,
            min_chunk_tokens=100,  # Low threshold to force splits
        )
        
        # Each chunk should have complete files (file header and content together)
        for chunk in chunks:
            # Count file headers (lines ending with : that look like file paths)
            file_headers = [l for l in chunk.split('\n') if l.endswith(':') and '.' in l.split(':')[0]]
            # Each file header should have corresponding content (f = function symbols)
            for header in file_headers:
                file_name = header.rstrip(':').split(':')[0].strip()  # Handle "file.py: ←N" format
                # The file's symbols should be in the same chunk
                assert 'f ' in chunk  # Has function symbol content
    
    def test_empty_symbols_returns_empty_list(self):
        """Empty input should return empty list."""
        from ac.symbol_index.compact_format import to_compact_chunked
        
        chunks = to_compact_chunked({}, min_chunk_tokens=1024)
        assert chunks == []
    
    def test_min_chunk_zero_no_splitting(self):
        """min_chunk_tokens=0 should not split at all."""
        from ac.symbol_index.compact_format import to_compact_chunked
        
        symbols_by_file = {
            f"file_{i}.py": [self._make_symbol(f"func_{i}")]
            for i in range(10)
        }
        
        chunks = to_compact_chunked(
            symbols_by_file,
            include_legend=False,
            min_chunk_tokens=0,
        )
        
        # Should be single chunk
        assert len(chunks) == 1
    
    def test_num_chunks_splits_evenly(self):
        """num_chunks should split into exactly that many chunks."""
        from ac.symbol_index.compact_format import to_compact_chunked
        
        symbols_by_file = {
            f"file_{i}.py": [self._make_symbol(f"func_{i}")]
            for i in range(10)
        }
        
        chunks = to_compact_chunked(
            symbols_by_file,
            include_legend=False,
            num_chunks=5,
        )
        
        assert len(chunks) == 5
        
        # All files should be present across all chunks
        all_content = '\n'.join(chunks)
        for i in range(10):
            assert f"file_{i}.py:" in all_content
    
    def test_num_chunks_with_uneven_files(self):
        """num_chunks should handle uneven file distribution."""
        from ac.symbol_index.compact_format import to_compact_chunked
        
        # 7 files into 3 chunks: should be 2, 2, 3 (extras go to later chunks)
        symbols_by_file = {
            f"file_{i}.py": [self._make_symbol(f"func_{i}")]
            for i in range(7)
        }
        
        chunks = to_compact_chunked(
            symbols_by_file,
            include_legend=False,
            num_chunks=3,
        )
        
        assert len(chunks) == 3
        
        # Count files in each chunk
        for chunk in chunks:
            file_headers = [l for l in chunk.split('\n') if l.endswith(':') and l.startswith('file_')]
            # Each chunk should have at least 2 files
            assert len(file_headers) >= 2
    
    def test_num_chunks_puts_newer_files_last(self):
        """Later chunks should contain files added later (for cache optimization)."""
        from ac.symbol_index.compact_format import to_compact_chunked
        
        symbols_by_file = {
            f"file_{i}.py": [self._make_symbol(f"func_{i}")]
            for i in range(10)
        }
        
        # Specify order where file_9 is "newest" (last in order)
        file_order = [f"file_{i}.py" for i in range(10)]
        
        chunks = to_compact_chunked(
            symbols_by_file,
            include_legend=False,
            file_order=file_order,
            num_chunks=5,
        )
        
        # file_9.py should be in the last chunk
        assert "file_9.py:" in chunks[-1]
        # file_0.py should be in the first chunk
        assert "file_0.py:" in chunks[0]
    
    def test_num_chunks_includes_legend_in_first(self):
        """Legend should only appear in first chunk when num_chunks used."""
        from ac.symbol_index.compact_format import to_compact_chunked
        
        symbols_by_file = {
            f"file_{i}.py": [self._make_symbol(f"func_{i}")]
            for i in range(10)
        }
        
        chunks = to_compact_chunked(
            symbols_by_file,
            include_legend=True,
            num_chunks=5,
        )
        
        assert "# c=class" in chunks[0]
        for chunk in chunks[1:]:
            assert "# c=class" not in chunk
    
    def test_return_metadata_includes_file_lists(self):
        """return_metadata=True should include files in each chunk."""
        from ac.symbol_index.compact_format import to_compact_chunked
        
        symbols_by_file = {
            f"file_{i}.py": [self._make_symbol(f"func_{i}")]
            for i in range(10)
        }
        
        chunks = to_compact_chunked(
            symbols_by_file,
            include_legend=False,
            num_chunks=3,
            return_metadata=True,
        )
        
        assert len(chunks) == 3
        assert all(isinstance(c, dict) for c in chunks)
        
        # Check each chunk has required fields
        for chunk in chunks:
            assert 'content' in chunk
            assert 'files' in chunk
            assert 'tokens' in chunk
            assert 'cached' in chunk
            assert isinstance(chunk['files'], list)
        
        # All files should be distributed across chunks
        all_files = []
        for chunk in chunks:
            all_files.extend(chunk['files'])
        assert len(all_files) == 10
        assert set(all_files) == {f"file_{i}.py" for i in range(10)}
    
    def test_return_metadata_cached_flag(self):
        """First 3 chunks should be marked cached, rest uncached."""
        from ac.symbol_index.compact_format import to_compact_chunked
        
        symbols_by_file = {
            f"file_{i}.py": [self._make_symbol(f"func_{i}")]
            for i in range(10)
        }
        
        chunks = to_compact_chunked(
            symbols_by_file,
            include_legend=False,
            num_chunks=5,
            return_metadata=True,
        )
        
        assert chunks[0]['cached'] is True
        assert chunks[1]['cached'] is True
        assert chunks[2]['cached'] is True
        assert chunks[3]['cached'] is False
        assert chunks[4]['cached'] is False
    
    def test_num_chunks_more_than_files(self):
        """num_chunks > file count should create fewer chunks."""
        from ac.symbol_index.compact_format import to_compact_chunked
        
        symbols_by_file = {
            "a.py": [self._make_symbol("foo")],
            "b.py": [self._make_symbol("bar")],
        }
        
        chunks = to_compact_chunked(
            symbols_by_file,
            include_legend=False,
            num_chunks=10,  # More chunks than files
        )
        
        # Should create at most 2 chunks (one per file)
        assert len(chunks) <= 2
        assert len(chunks) > 0


class TestCrossFileCallGraph:
    """Test cross-file call graph resolution and formatting."""
    
    def _make_symbol(self, name, kind="function", line=1, children=None, call_sites=None):
        """Helper to create a symbol with optional call sites."""
        r = Range(start_line=line, start_col=0, end_line=line, end_col=10)
        return Symbol(
            name=name,
            kind=kind,
            file_path="test.py",
            range=r,
            selection_range=r,
            children=children or [],
            call_sites=call_sites or [],
        )
    
    def _make_call_site(self, name, target_file=None, target_symbol=None, line=1):
        """Helper to create a CallSite."""
        from ac.symbol_index.models import CallSite
        return CallSite(
            name=name,
            target_file=target_file,
            target_symbol=target_symbol,
            line=line,
        )
    
    def test_format_cross_file_calls_basic(self):
        """Cross-file calls should be formatted with file:symbol."""
        from ac.symbol_index.compact_format import _format_cross_file_calls
        
        call_sites = [
            self._make_call_site("get", target_file="cache.py"),
            self._make_call_site("save", target_file="db.py"),
        ]
        symbol = self._make_symbol("fetch", call_sites=call_sites)
        
        result = _format_cross_file_calls(symbol, current_file="main.py")
        
        assert result == "→cache.py:get,db.py:save"
    
    def test_format_cross_file_calls_filters_same_file(self):
        """Same-file calls should be filtered out."""
        from ac.symbol_index.compact_format import _format_cross_file_calls
        
        call_sites = [
            self._make_call_site("external", target_file="other.py"),
            self._make_call_site("internal", target_file="main.py"),  # Same file
        ]
        symbol = self._make_symbol("fetch", call_sites=call_sites)
        
        result = _format_cross_file_calls(symbol, current_file="main.py")
        
        assert "internal" not in result
        assert "other.py:external" in result
    
    def test_format_cross_file_calls_filters_unresolved(self):
        """Calls without target_file should be filtered out."""
        from ac.symbol_index.compact_format import _format_cross_file_calls
        
        call_sites = [
            self._make_call_site("resolved", target_file="other.py"),
            self._make_call_site("unresolved", target_file=None),
        ]
        symbol = self._make_symbol("fetch", call_sites=call_sites)
        
        result = _format_cross_file_calls(symbol, current_file="main.py")
        
        assert "unresolved" not in result
        assert "other.py:resolved" in result
    
    def test_format_cross_file_calls_applies_aliases(self):
        """Path aliases should be applied to target files."""
        from ac.symbol_index.compact_format import _format_cross_file_calls
        
        call_sites = [
            self._make_call_site("get", target_file="ac/url_handler/cache.py"),
        ]
        symbol = self._make_symbol("fetch", call_sites=call_sites)
        aliases = {"ac/url_handler/": "@1/"}
        
        result = _format_cross_file_calls(symbol, current_file="main.py", aliases=aliases)
        
        assert result == "→@1/cache.py:get"
    
    def test_format_cross_file_calls_dedupes(self):
        """Duplicate file:symbol pairs should be deduplicated."""
        from ac.symbol_index.compact_format import _format_cross_file_calls
        
        call_sites = [
            self._make_call_site("get", target_file="cache.py", line=10),
            self._make_call_site("get", target_file="cache.py", line=20),  # Duplicate
            self._make_call_site("save", target_file="cache.py", line=30),
        ]
        symbol = self._make_symbol("fetch", call_sites=call_sites)
        
        result = _format_cross_file_calls(symbol, current_file="main.py")
        
        # Should have get and save, but only one get
        assert result.count("cache.py:get") == 1
        assert "cache.py:save" in result
    
    def test_format_cross_file_calls_limits_to_5(self):
        """Should limit to 5 calls with +N overflow."""
        from ac.symbol_index.compact_format import _format_cross_file_calls
        
        call_sites = [
            self._make_call_site(f"func{i}", target_file=f"file{i}.py")
            for i in range(8)
        ]
        symbol = self._make_symbol("fetch", call_sites=call_sites)
        
        result = _format_cross_file_calls(symbol, current_file="main.py")
        
        assert "+3" in result
        # Should have exactly 5 file:func pairs before +3
        assert result.count(":func") == 5
    
    def test_format_cross_file_calls_strips_module_prefix(self):
        """Module prefixes in call names should be stripped."""
        from ac.symbol_index.compact_format import _format_cross_file_calls
        
        call_sites = [
            self._make_call_site("module.submodule.func", target_file="other.py"),
        ]
        symbol = self._make_symbol("fetch", call_sites=call_sites)
        
        result = _format_cross_file_calls(symbol, current_file="main.py")
        
        assert result == "→other.py:func"
    
    def test_format_cross_file_calls_empty_when_no_calls(self):
        """Should return empty string when no call sites."""
        from ac.symbol_index.compact_format import _format_cross_file_calls
        
        symbol = self._make_symbol("fetch", call_sites=[])
        
        result = _format_cross_file_calls(symbol, current_file="main.py")
        
        assert result == ""
    
    def test_format_cross_file_calls_empty_when_all_filtered(self):
        """Should return empty when all calls are filtered out."""
        from ac.symbol_index.compact_format import _format_cross_file_calls
        
        call_sites = [
            self._make_call_site("internal", target_file="main.py"),  # Same file
            self._make_call_site("unresolved", target_file=None),  # Unresolved
        ]
        symbol = self._make_symbol("fetch", call_sites=call_sites)
        
        result = _format_cross_file_calls(symbol, current_file="main.py")
        
        assert result == ""
    
    def test_to_compact_includes_cross_file_calls_by_default(self):
        """to_compact should include cross-file calls by default."""
        call_sites = [
            self._make_call_site("helper", target_file="utils.py"),
        ]
        symbols_by_file = {
            "main.py": [self._make_symbol("process", call_sites=call_sites)],
        }
        
        result = to_compact(symbols_by_file, include_legend=False)
        
        assert "→utils.py:helper" in result
    
    def test_to_compact_cross_file_calls_disabled(self):
        """to_compact with include_cross_file_calls=False should not show calls."""
        call_sites = [
            self._make_call_site("helper", target_file="utils.py"),
        ]
        symbols_by_file = {
            "main.py": [self._make_symbol("process", call_sites=call_sites)],
        }
        
        result = to_compact(
            symbols_by_file, 
            include_legend=False,
            include_cross_file_calls=False,
        )
        
        assert "→utils.py:helper" not in result
        assert "→" not in result


class TestSymbolIndexCallResolution:
    """Test SymbolIndex call target resolution."""
    
    def test_resolve_symbol_to_file(self, symbol_index, temp_repo):
        """_resolve_symbol_to_file should resolve dotted paths."""
        # Create a module structure
        (temp_repo / "mypackage").mkdir()
        (temp_repo / "mypackage" / "__init__.py").write_text("")
        (temp_repo / "mypackage" / "utils.py").write_text("def helper(): pass")
        
        result = symbol_index._resolve_symbol_to_file("mypackage.utils.helper")
        
        assert result == "mypackage/utils.py"
    
    def test_resolve_symbol_to_file_not_found(self, symbol_index):
        """_resolve_symbol_to_file returns None for unknown symbols."""
        result = symbol_index._resolve_symbol_to_file("nonexistent.module.func")
        
        assert result is None
    
    def test_find_symbol_file_finds_function(self, symbol_index):
        """_find_symbol_file should find functions by name."""
        r = Range(start_line=1, start_col=0, end_line=1, end_col=10)
        all_symbols = {
            "utils.py": [Symbol(
                name="helper",
                kind="function",
                file_path="utils.py",
                range=r,
                selection_range=r,
            )],
            "main.py": [],
        }
        
        result = symbol_index._find_symbol_file("helper", all_symbols, exclude_file="main.py")
        
        assert result == "utils.py"
    
    def test_find_symbol_file_finds_method(self, symbol_index):
        """_find_symbol_file should find methods in class children."""
        r = Range(start_line=1, start_col=0, end_line=1, end_col=10)
        method = Symbol(
            name="process",
            kind="method",
            file_path="handler.py",
            range=r,
            selection_range=r,
        )
        class_sym = Symbol(
            name="Handler",
            kind="class",
            file_path="handler.py",
            range=r,
            selection_range=r,
            children=[method],
        )
        all_symbols = {
            "handler.py": [class_sym],
        }
        
        result = symbol_index._find_symbol_file("process", all_symbols)
        
        assert result == "handler.py"
    
    def test_find_symbol_file_excludes_current(self, symbol_index):
        """_find_symbol_file should not match symbols in excluded file."""
        r = Range(start_line=1, start_col=0, end_line=1, end_col=10)
        all_symbols = {
            "main.py": [Symbol(
                name="helper",
                kind="function",
                file_path="main.py",
                range=r,
                selection_range=r,
            )],
        }
        
        result = symbol_index._find_symbol_file("helper", all_symbols, exclude_file="main.py")
        
        assert result is None
    
    def test_find_symbol_file_handles_qualified_names(self, symbol_index):
        """_find_symbol_file should handle Class::method and module.func names."""
        r = Range(start_line=1, start_col=0, end_line=1, end_col=10)
        all_symbols = {
            "utils.py": [Symbol(
                name="helper",
                kind="function",
                file_path="utils.py",
                range=r,
                selection_range=r,
            )],
        }
        
        # Should strip :: prefix
        result1 = symbol_index._find_symbol_file("SomeClass::helper", all_symbols)
        assert result1 == "utils.py"
        
        # Should strip . prefix
        result2 = symbol_index._find_symbol_file("module.helper", all_symbols)
        assert result2 == "utils.py"
    
    def test_resolve_call_targets_populates_target_file(self, symbol_index, temp_repo):
        """_resolve_call_targets should populate target_file on CallSites."""
        from ac.symbol_index.models import CallSite
        
        # Create target file
        (temp_repo / "utils.py").write_text("def helper(): pass")
        
        r = Range(start_line=1, start_col=0, end_line=1, end_col=10)
        call_site = CallSite(name="helper", line=5)
        symbol = Symbol(
            name="main",
            kind="function",
            file_path="main.py",
            range=r,
            selection_range=r,
            call_sites=[call_site],
        )
        
        all_symbols = {
            "main.py": [symbol],
            "utils.py": [Symbol(
                name="helper",
                kind="function",
                file_path="utils.py",
                range=r,
                selection_range=r,
            )],
        }
        
        symbol_index._resolve_call_targets("main.py", [symbol], all_symbols)
        
        assert call_site.target_file == "utils.py"
    
    def test_resolve_call_targets_skips_already_resolved(self, symbol_index):
        """_resolve_call_targets should skip calls with existing target_file."""
        from ac.symbol_index.models import CallSite
        
        r = Range(start_line=1, start_col=0, end_line=1, end_col=10)
        call_site = CallSite(name="helper", target_file="preset.py", line=5)
        symbol = Symbol(
            name="main",
            kind="function",
            file_path="main.py",
            range=r,
            selection_range=r,
            call_sites=[call_site],
        )
        
        symbol_index._resolve_call_targets("main.py", [symbol], {})
        
        # Should not be changed
        assert call_site.target_file == "preset.py"
    
    def test_resolve_call_targets_via_target_symbol(self, symbol_index, temp_repo):
        """_resolve_call_targets should use target_symbol for resolution."""
        from ac.symbol_index.models import CallSite
        
        # Create module structure
        (temp_repo / "mymod").mkdir()
        (temp_repo / "mymod" / "__init__.py").write_text("")
        (temp_repo / "mymod" / "helpers.py").write_text("def do_thing(): pass")
        
        r = Range(start_line=1, start_col=0, end_line=1, end_col=10)
        call_site = CallSite(
            name="do_thing",
            target_symbol="mymod.helpers.do_thing",
            line=5,
        )
        symbol = Symbol(
            name="main",
            kind="function",
            file_path="main.py",
            range=r,
            selection_range=r,
            call_sites=[call_site],
        )
        
        symbol_index._resolve_call_targets("main.py", [symbol], {})
        
        assert call_site.target_file == "mymod/helpers.py"


class TestSymbolIndexToCompactChunked:
    """Test SymbolIndex.to_compact_chunked method."""
    
    def test_to_compact_chunked_returns_list(self, symbol_index, temp_repo):
        """to_compact_chunked should return a list of strings."""
        files = ["a_first.py", "b_second.py", "c_third.py"]
        
        chunks = symbol_index.to_compact_chunked(files, min_chunk_tokens=0)
        
        assert isinstance(chunks, list)
        assert all(isinstance(c, str) for c in chunks)
    
    def test_to_compact_chunked_uses_stable_order(self, symbol_index, temp_repo):
        """to_compact_chunked should respect saved file order."""
        files = ["a_first.py", "b_second.py", "c_third.py"]
        
        # Establish a non-alphabetical order
        symbol_index._save_order(["c_third.py", "b_second.py", "a_first.py"])
        symbol_index._file_order = None
        
        chunks = symbol_index.to_compact_chunked(files, min_chunk_tokens=0)
        
        # Join chunks and check order
        content = '\n'.join(chunks)
        c_pos = content.find("c_third.py:")
        b_pos = content.find("b_second.py:")
        a_pos = content.find("a_first.py:")
        
        assert c_pos < b_pos < a_pos
    
    def test_to_compact_chunked_includes_references(self, symbol_index, temp_repo):
        """to_compact_chunked should include references when requested."""
        # Create files with cross-references
        (temp_repo / "caller.py").write_text("from a_first import foo\nfoo()")
        
        files = ["a_first.py", "caller.py"]
        
        chunks = symbol_index.to_compact_chunked(
            files,
            include_references=True,
            min_chunk_tokens=0
        )
        
        content = '\n'.join(chunks)
        # Should have some reference indicators
        assert "←" in content or "i→" in content or "refs:" in content
