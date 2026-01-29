"""Main SymbolIndex class for extracting and querying symbols."""

import json
import os
from typing import List, Optional, Dict, Any, Set
from pathlib import Path

from .models import Symbol
from .parser import get_parser
from .extractors import get_extractor
from .cache import SymbolCache
from .references import ReferenceIndex
from .import_resolver import ImportResolver


class SymbolIndex:
    """
    Tree-sitter based symbol indexer.
    
    Produces two output formats:
    1. Compact Format - For LLM context (replaces aider's repo map)
    2. LSP Format - For Monaco editor (full precision)
    
    Supports optional cross-file reference tracking for richer context.
    Uses mtime-based caching to avoid re-parsing unchanged files.
    
    Maintains stable file ordering in symbol maps to optimize LLM prefix caching.
    When files are removed from context and later return to the symbol map,
    they are appended at the bottom rather than their alphabetical position,
    preserving the cached prefix for unchanged files.
    """
    
    # Default output path for symbol map (separate from repo_map.txt)
    DEFAULT_SYMBOL_MAP_PATH = ".aicoder/symbol_map.txt"
    # File to persist symbol map ordering for cache optimization
    ORDER_FILE = ".aicoder/symbol_map_order.json"
    
    def __init__(self, repo_root: str = None):
        self.repo_root = Path(repo_root) if repo_root else Path.cwd()
        self._parser = get_parser()
        self._cache = SymbolCache(str(self.repo_root))
        self._reference_index: Optional[ReferenceIndex] = None
        self._references_built = False
        self._import_resolver = ImportResolver(str(self.repo_root))
        # Cache of file -> set of in-repo imports
        self._file_imports: Dict[str, set] = {}
        # Cached file order (loaded lazily)
        self._file_order: Optional[List[str]] = None
    
    def index_file(self, file_path: str, content: Optional[str] = None, use_cache: bool = True) -> List[Symbol]:
        """Index a single file and return its symbols.
        
        Args:
            file_path: Path to the file (relative or absolute)
            content: Optional file content. If not provided, reads from disk.
            use_cache: Whether to use cached results if available (default: True)
            
        Returns:
            List of Symbol objects found in the file
        """
        # Normalize path
        path = Path(file_path)
        if not path.is_absolute():
            path = self.repo_root / path
        
        # Check file exists
        if not path.exists():
            return []
        
        rel_path = str(path.relative_to(self.repo_root)) if path.is_relative_to(self.repo_root) else str(path)
        
        # Check cache first (only if no content provided and caching enabled)
        if use_cache and content is None:
            cached = self._cache.get(rel_path)
            if cached is not None:
                # Still need to resolve imports if not already done
                if rel_path not in self._file_imports:
                    self._resolve_cached_file_imports(rel_path, cached)
                return cached
        
        # Parse file
        tree, lang_name = self._parser.parse_file(str(path), content)
        if not tree or not lang_name:
            return []
        
        # Get content bytes for extraction
        if content is None:
            with open(path, 'rb') as f:
                content_bytes = f.read()
        else:
            content_bytes = content.encode('utf-8') if isinstance(content, str) else content
        
        # Get extractor for this language and extract symbols
        extractor = get_extractor(lang_name)
        symbols = extractor.extract_symbols(tree, rel_path, content_bytes)
        
        # Resolve in-repo imports
        self._resolve_file_imports(rel_path, extractor, lang_name)
        
        # Cache (only if reading from disk)
        if content is None:
            self._cache.set(rel_path, symbols)
        
        return symbols
    
    def index_files(self, file_paths: List[str]) -> Dict[str, List[Symbol]]:
        """Index multiple files.
        
        Args:
            file_paths: List of file paths to index
            
        Returns:
            Dict mapping file paths to their symbols
        """
        result = {}
        for file_path in file_paths:
            try:
                symbols = self.index_file(file_path)
                if symbols:
                    result[file_path] = symbols
            except ValueError as e:
                # Unsupported language - skip silently
                pass
            except Exception as e:
                # Log other errors for debugging
                import sys
                import traceback
                print(f"⚠️ Failed to index {file_path}: {e}", file=sys.stderr)
                traceback.print_exc()
        return result
    
    def _resolve_cached_file_imports(self, file_path: str, symbols: List[Symbol]):
        """Resolve imports from cached symbols (re-parse needed for import details)."""
        # Determine language from file extension
        path = Path(file_path)
        lang_name = self._parser.get_language_for_file(str(self.repo_root / path))
        if not lang_name:
            return
        
        # Need to re-parse to get import details (symbols don't store full import info)
        abs_path = self.repo_root / path
        if not abs_path.exists():
            return
        
        tree, _ = self._parser.parse_file(str(abs_path))
        if not tree:
            return
        
        with open(abs_path, 'rb') as f:
            content_bytes = f.read()
        
        extractor = get_extractor(lang_name)
        # Re-extract just to get imports (symbols already cached)
        extractor.extract_symbols(tree, file_path, content_bytes)
        self._resolve_file_imports(file_path, extractor, lang_name)
    
    def _resolve_file_imports(self, file_path: str, extractor, lang_name: str):
        """Resolve imports to in-repo file paths."""
        imports = extractor.get_imports()
        resolved = set()
        
        for imp in imports:
            if lang_name == 'python':
                # Use level from Import object (set by extractor for relative imports)
                is_relative = imp.level > 0
                
                resolved_path = self._import_resolver.resolve_python_import(
                    module=imp.module,
                    from_file=file_path,
                    is_relative=is_relative,
                    level=imp.level,
                )
                if resolved_path:
                    resolved.add(resolved_path)
            
            elif lang_name in ('javascript', 'typescript', 'tsx'):
                resolved_path = self._import_resolver.resolve_js_import(
                    import_path=imp.module,
                    from_file=file_path
                )
                if resolved_path:
                    resolved.add(resolved_path)
        
        if resolved:
            self._file_imports[file_path] = resolved
    
    def get_symbols(self, file_path: str) -> List[Symbol]:
        """Get cached symbols for a file, or index it if not cached."""
        cached = self._cache.get(file_path)
        if cached is not None:
            return cached
        return self.index_file(file_path)
    
    def clear_cache(self):
        """Clear the symbol cache."""
        self._cache.clear()
        self._file_imports.clear()
        self._import_resolver.clear_cache()
    
    def invalidate_file(self, file_path: str):
        """Invalidate cache for a specific file (e.g., after it's modified)."""
        self._cache.invalidate(file_path)
        # Also invalidate references since they may be stale
        self._references_built = False
    
    def _load_order(self) -> List[str]:
        """Load persisted file order for stable symbol map generation."""
        if self._file_order is not None:
            return self._file_order
        
        order_path = self.repo_root / self.ORDER_FILE
        if order_path.exists():
            try:
                with open(order_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self._file_order = data.get("order", [])
            except (json.JSONDecodeError, IOError):
                self._file_order = []
        else:
            self._file_order = []
        return self._file_order
    
    def _save_order(self, order: List[str]):
        """Save file order to disk for prefix cache optimization."""
        order_path = self.repo_root / self.ORDER_FILE
        order_path.parent.mkdir(parents=True, exist_ok=True)
        with open(order_path, 'w', encoding='utf-8') as f:
            json.dump({"order": order}, f, indent=2)
        self._file_order = order
    
    def get_ordered_files(self, available_files: List[str]) -> List[str]:
        """Get files in stable order for LLM context.
        
        Files maintain their position from previous generations.
        New files are appended at the bottom to preserve the cached prefix.
        Files no longer available are filtered out.
        
        Args:
            available_files: List of files currently available for the symbol map
            
        Returns:
            Ordered list of files optimized for prefix caching
        """
        existing_order = self._load_order()
        available_set = set(available_files)
        
        # Keep existing order for files still available
        result = [f for f in existing_order if f in available_set]
        
        # Append new files at bottom (sorted for determinism among new files)
        new_files = sorted(f for f in available_files if f not in existing_order)
        result.extend(new_files)
        
        # Save updated order
        self._save_order(result)
        
        return result
    
    def _get_reference_index(self) -> ReferenceIndex:
        """Get or create the reference index."""
        if self._reference_index is None:
            self._reference_index = ReferenceIndex(str(self.repo_root))
        return self._reference_index
    
    def build_references(self, file_paths: List[str] = None):
        """Build cross-file reference index.
        
        Args:
            file_paths: Files to analyze. If None, uses cached files.
        """
        if file_paths is None:
            file_paths = self._cache.get_cached_files()
        
        if not file_paths:
            return
        
        # First ensure all files are indexed
        symbols_by_file = self.index_files(file_paths)
        
        # Build reference index
        ref_index = self._get_reference_index()
        ref_index.set_symbols(symbols_by_file)
        ref_index.build_references(file_paths)
        self._references_built = True
    
    def get_references_to_symbol(self, file_path: str, symbol_name: str) -> List[dict]:
        """Get all locations that reference a symbol.
        
        Args:
            file_path: File where symbol is defined
            symbol_name: Name of the symbol
            
        Returns:
            List of location dicts
        """
        if not self._references_built:
            self.build_references()
        
        ref_index = self._get_reference_index()
        locations = ref_index.get_references_to_symbol(file_path, symbol_name)
        return [loc.to_dict() for loc in locations]
    
    def get_files_referencing(self, file_path: str) -> List[str]:
        """Get all files that reference symbols in this file.
        
        Args:
            file_path: File to check
            
        Returns:
            Sorted list of file paths
        """
        if not self._references_built:
            self.build_references()
        
        ref_index = self._get_reference_index()
        return sorted(ref_index.get_files_referencing(file_path))
    
    def _get_symbols_and_refs(
        self, 
        file_paths: List[str] = None,
        include_references: bool = False,
    ) -> tuple:
        """Get symbols, references, and file order for compact format generation.
        
        Args:
            file_paths: List of files to include. If None, uses cached files.
            include_references: If True, include cross-file reference data
            
        Returns:
            Tuple of (symbols_by_file, references, file_refs, file_imports, file_order)
        """
        if file_paths:
            symbols_by_file = self.index_files(file_paths)
        else:
            # Build dict from cache
            symbols_by_file = {}
            for fpath in self._cache.get_cached_files():
                symbols = self._cache.get(fpath)
                if symbols is not None:
                    symbols_by_file[fpath] = symbols
        
        # Get references if requested
        references = None
        file_refs = None
        
        if include_references:
            if not self._references_built:
                self.build_references(file_paths)
            
            ref_index = self._get_reference_index()
            references = {}
            file_refs = {}
            
            for file_path in symbols_by_file.keys():
                references[file_path] = ref_index.get_references_to_file(file_path)
                refs_set = ref_index.get_files_referencing(file_path)
                if refs_set:
                    file_refs[file_path] = refs_set
        
        # Collect file imports for files we're outputting
        file_imports = {}
        for file_path in symbols_by_file.keys():
            if file_path in self._file_imports:
                file_imports[file_path] = self._file_imports[file_path]
        
        # Get stable file order for prefix cache optimization
        file_order = self.get_ordered_files(list(symbols_by_file.keys()))
        
        return symbols_by_file, references, file_refs, file_imports, file_order
    
    def to_compact(
        self, 
        file_paths: List[str] = None,
        include_references: bool = False,
    ) -> str:
        """Generate compact format suitable for LLM context.
        
        Uses stable file ordering to optimize LLM prefix caching.
        Files maintain their position; new files are appended at the bottom.
        
        Args:
            file_paths: List of files to include. If None, uses cached files.
            include_references: If True, include cross-file reference annotations
            
        Returns:
            Compact string representation
        """
        from .compact_format import to_compact
        
        symbols_by_file, references, file_refs, file_imports, file_order = \
            self._get_symbols_and_refs(file_paths, include_references)
        
        return to_compact(
            symbols_by_file, 
            references=references, 
            file_refs=file_refs,
            file_imports=file_imports,
            file_order=file_order,
        )
    
    def to_compact_chunked(
        self, 
        file_paths: List[str] = None,
        include_references: bool = False,
        min_chunk_tokens: int = 1024,
        num_chunks: int = None,
        return_metadata: bool = False,
    ) -> List[str]:
        """Generate compact format as cacheable chunks.
        
        Files are processed in stable order and grouped into chunks. If num_chunks
        is specified, splits into exactly that many chunks. Otherwise uses
        min_chunk_tokens. This enables LLM prompt caching - stable files at the
        start of the list form stable chunks that remain cached even when later
        files change.
        
        Args:
            file_paths: List of files to include. If None, uses cached files.
            include_references: If True, include cross-file reference annotations
            min_chunk_tokens: Minimum tokens per chunk (default 1024 for Anthropic)
            num_chunks: If specified, split into exactly this many chunks
            return_metadata: If True, return list of dicts with content, files, tokens
            
        Returns:
            List of chunk strings (or dicts if return_metadata=True)
        """
        from .compact_format import to_compact_chunked
        
        symbols_by_file, references, file_refs, file_imports, file_order = \
            self._get_symbols_and_refs(file_paths, include_references)
        
        return to_compact_chunked(
            symbols_by_file, 
            references=references, 
            file_refs=file_refs,
            file_imports=file_imports,
            file_order=file_order,
            min_chunk_tokens=min_chunk_tokens,
            num_chunks=num_chunks,
            return_metadata=return_metadata,
        )
    
    def save_compact(self, output_path: str = None, file_paths: List[str] = None) -> str:
        """Save compact format to disk.
        
        Writes to .aicoder/symbol_map.txt by default (separate from repo_map.txt).
        
        Args:
            output_path: Path to save the map. If None, uses DEFAULT_SYMBOL_MAP_PATH.
            file_paths: List of files to include. If None, uses cached files.
            
        Returns:
            Path to the saved file
        """
        if output_path is None:
            output_path = str(self.repo_root / self.DEFAULT_SYMBOL_MAP_PATH)
        
        # Ensure directory exists
        output_dir = os.path.dirname(output_path)
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)
        
        compact = self.to_compact(file_paths)
        
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(compact)
        
        return output_path
    
    def to_lsp(self, file_path: str = None) -> Dict:
        """Generate LSP-compatible format for Monaco.
        
        Args:
            file_path: Specific file to get LSP data for.
                      If None, returns all cached files.
            
        Returns:
            LSP-compatible dict structure
        """
        from .lsp_format import to_lsp
        
        if file_path:
            symbols = self.get_symbols(file_path)
            symbols_by_file = {file_path: symbols}
        else:
            # Build dict from cache
            symbols_by_file = {}
            for fpath in self._cache.get_cached_files():
                symbols = self._cache.get(fpath)
                if symbols is not None:
                    symbols_by_file[fpath] = symbols
        
        return to_lsp(symbols_by_file)
    
    def get_document_symbols(self, file_path: str) -> List[Dict]:
        """Get document symbols in LSP format for a file.
        
        Args:
            file_path: Path to the file
            
        Returns:
            List of LSP DocumentSymbol dicts
        """
        from .lsp_format import get_document_symbols
        
        symbols = self.get_symbols(file_path)
        return get_document_symbols(symbols)
