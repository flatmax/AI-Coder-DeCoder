"""Tests for symbol map stable ordering (prefix cache optimization)."""

import json
import pytest
from pathlib import Path

from ac.symbol_index.symbol_index import SymbolIndex
from ac.symbol_index.compact_format import to_compact
from ac.symbol_index.models import Symbol, Range


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
            # Count file headers
            file_headers = [l for l in chunk.split('\n') if l.endswith(':') and not l.startswith('│')]
            # Each file header should have corresponding content
            for header in file_headers:
                file_name = header.rstrip(':')
                # The file's symbols should be in the same chunk
                assert f"│" in chunk  # Has symbol content
    
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
