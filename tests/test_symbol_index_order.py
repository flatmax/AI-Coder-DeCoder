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
