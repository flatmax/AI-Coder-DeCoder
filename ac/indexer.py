"""Standalone indexer for symbol map generation.

This module provides indexing functionality for generating symbol maps
using tree-sitter based code analysis.
"""

import os
from pathlib import Path
from typing import List, Optional


class Indexer:
    """
    Generates and saves symbol map files.
    
    Saves to .aicoder/ directory:
    - symbol_map.txt - Symbol index (via tree-sitter)
    """
    
    DEFAULT_OUTPUT_DIR = ".aicoder"
    REPO_MAP_FILENAME = "repo_map.txt"
    SYMBOL_MAP_FILENAME = "symbol_map.txt"
    
    def __init__(self, repo_root: str = None):
        """
        Initialize the indexer.
        
        Args:
            repo_root: Root directory of the repository. Defaults to cwd.
        """
        self.repo_root = Path(repo_root) if repo_root else Path.cwd()
        self._symbol_index = None
    
    @property
    def output_dir(self) -> Path:
        """Get the output directory path."""
        return self.repo_root / self.DEFAULT_OUTPUT_DIR
    
    @property
    def repo_map_path(self) -> Path:
        """Get the repo map file path."""
        return self.output_dir / self.REPO_MAP_FILENAME
    
    @property
    def symbol_map_path(self) -> Path:
        """Get the symbol map file path."""
        return self.output_dir / self.SYMBOL_MAP_FILENAME
    
    def _ensure_output_dir(self):
        """Ensure the output directory exists."""
        self.output_dir.mkdir(parents=True, exist_ok=True)
    
    def _get_symbol_index(self):
        """Lazy-load the SymbolIndex."""
        if self._symbol_index is None:
            from ac.symbol_index import SymbolIndex
            self._symbol_index = SymbolIndex(str(self.repo_root))
        return self._symbol_index
    
    def save_symbol_map(self, file_paths: List[str] = None, output_path: str = None) -> str:
        """
        Generate and save the symbol map.
        
        Args:
            file_paths: List of files to index. If None, uses cached files.
            output_path: Custom output path. If None, uses default.
            
        Returns:
            Path to the saved file.
        """
        self._ensure_output_dir()
        
        if output_path is None:
            output_path = str(self.symbol_map_path)
        
        index = self._get_symbol_index()
        return index.save_compact(output_path=output_path, file_paths=file_paths)
    
    def get_symbol_map(self, file_paths: List[str] = None) -> str:
        """
        Generate symbol map content without saving.
        
        Args:
            file_paths: List of files to index.
            
        Returns:
            Symbol map as string.
        """
        index = self._get_symbol_index()
        return index.to_compact(file_paths)
    
    def index_file(self, file_path: str):
        """
        Index a single file.
        
        Args:
            file_path: Path to the file to index.
            
        Returns:
            List of Symbol objects.
        """
        index = self._get_symbol_index()
        return index.index_file(file_path)
    
    def index_files(self, file_paths: List[str]):
        """
        Index multiple files.
        
        Args:
            file_paths: List of file paths to index.
            
        Returns:
            Dict mapping file paths to their symbols.
        """
        index = self._get_symbol_index()
        result = index.index_files(file_paths)
        # Debug: if no results, try to understand why
        if not result and file_paths:
            # Try indexing first .py file manually to see error
            for fp in file_paths[:3]:
                if fp.endswith('.py'):
                    try:
                        from pathlib import Path
                        abs_path = Path(fp)
                        if not abs_path.is_absolute():
                            abs_path = self.repo_root / fp
                        print(f"  Debug: {fp} -> {abs_path} exists={abs_path.exists()}")
                    except Exception as e:
                        print(f"  Debug error: {e}")
                    break
        return result
    
    def clear_cache(self):
        """Clear the symbol cache."""
        if self._symbol_index:
            self._symbol_index.clear_cache()
    
    def invalidate_file(self, file_path: str):
        """Invalidate cache for a specific file."""
        if self._symbol_index:
            self._symbol_index.invalidate_file(file_path)
    
    def get_document_symbols(self, file_path: str):
        """
        Get LSP-format document symbols for a file.
        
        Args:
            file_path: Path to the file.
            
        Returns:
            List of LSP DocumentSymbol dicts.
        """
        index = self._get_symbol_index()
        return index.get_document_symbols(file_path)
    
    def get_lsp_data(self, file_path: str = None):
        """
        Get LSP-format data for Monaco editor.
        
        Args:
            file_path: Specific file, or None for all cached files.
            
        Returns:
            LSP-compatible dict structure.
        """
        index = self._get_symbol_index()
        return index.to_lsp(file_path)
    
    def get_symbol_map_with_refs(self, file_paths: List[str] = None, output_path: str = None) -> str:
        """
        Generate and save the symbol map with cross-file references.
        
        Args:
            file_paths: List of files to index. If None, uses cached files.
            output_path: Custom output path. If None, uses default.
            
        Returns:
            Path to the saved file.
        """
        self._ensure_output_dir()
        
        if output_path is None:
            output_path = str(self.symbol_map_path)
        
        index = self._get_symbol_index()
        
        # Build references first
        if file_paths:
            index.build_references(file_paths)
        
        # Generate compact format with references
        compact = index.to_compact(file_paths=file_paths, include_references=True)
        
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(compact)
        
        return output_path
    
    def build_references(self, file_paths: List[str] = None):
        """
        Build cross-file reference index.
        
        Args:
            file_paths: Files to analyze. If None, uses cached files.
        """
        index = self._get_symbol_index()
        index.build_references(file_paths)
    
    def get_references_to_symbol(self, file_path: str, symbol_name: str) -> List[dict]:
        """
        Get all locations that reference a symbol.
        
        Args:
            file_path: File where symbol is defined
            symbol_name: Name of the symbol
            
        Returns:
            List of location dicts
        """
        index = self._get_symbol_index()
        return index.get_references_to_symbol(file_path, symbol_name)
    
    def get_files_referencing(self, file_path: str) -> List[str]:
        """
        Get all files that reference symbols in this file.
        
        Args:
            file_path: File to check
            
        Returns:
            Sorted list of file paths
        """
        index = self._get_symbol_index()
        return index.get_files_referencing(file_path)
