"""Cross-file reference tracking for symbol index."""

import re
from dataclasses import dataclass, field
from typing import Dict, List, Set, Optional, Tuple
from pathlib import Path

from .models import Symbol, Range
from .parser import get_parser


@dataclass
class Location:
    """A location in source code."""
    file_path: str
    line: int
    col: int
    
    def to_dict(self) -> dict:
        return {
            'file': self.file_path,
            'line': self.line,
            'col': self.col
        }


@dataclass 
class Reference:
    """A reference to a symbol from another location."""
    symbol_name: str
    symbol_file: str
    location: Location
    context: Optional[str] = None  # surrounding code snippet


class ReferenceIndex:
    """
    Tracks cross-file symbol references.
    
    Builds an index of where symbols are used across the codebase,
    enabling "find all references" and "who calls this?" queries.
    """
    
    def __init__(self, repo_root: str = None):
        self.repo_root = Path(repo_root) if repo_root else Path.cwd()
        self._parser = get_parser()
        
        # symbol_file -> symbol_name -> [locations that reference it]
        self._references: Dict[str, Dict[str, List[Location]]] = {}
        
        # file -> set of files it references
        self._file_deps: Dict[str, Set[str]] = {}
        
        # file -> set of files that reference it
        self._file_refs: Dict[str, Set[str]] = {}
        
        # Cache of known symbols: file -> {name: Symbol}
        self._symbols: Dict[str, Dict[str, Symbol]] = {}
    
    def set_symbols(self, symbols_by_file: Dict[str, List[Symbol]]):
        """Set the known symbols from SymbolIndex.
        
        Args:
            symbols_by_file: Dict mapping file paths to their symbols
        """
        self._symbols = {}
        for file_path, symbols in symbols_by_file.items():
            self._symbols[file_path] = {}
            for symbol in symbols:
                if symbol.kind != 'import':
                    self._symbols[file_path][symbol.name] = symbol
                    # Also index children
                    for child in symbol.children:
                        qualified_name = f"{symbol.name}.{child.name}"
                        self._symbols[file_path][qualified_name] = child
    
    def build_references(self, file_paths: List[str]):
        """Build reference index for all files.
        
        Args:
            file_paths: List of files to analyze
        """
        # Clear existing references
        self._references = {}
        self._file_deps = {}
        self._file_refs = {}
        
        # Build set of all known symbol names for quick lookup
        all_symbols: Dict[str, List[Tuple[str, Symbol]]] = {}  # name -> [(file, symbol)]
        for file_path, symbols in self._symbols.items():
            for name, symbol in symbols.items():
                if name not in all_symbols:
                    all_symbols[name] = []
                all_symbols[name].append((file_path, symbol))
        
        # Scan each file for references
        for file_path in file_paths:
            self._scan_file_for_references(file_path, all_symbols)
    
    def _scan_file_for_references(
        self, 
        file_path: str, 
        all_symbols: Dict[str, List[Tuple[str, Symbol]]]
    ):
        """Scan a file for references to known symbols.
        
        Args:
            file_path: File to scan
            all_symbols: Dict of symbol name -> [(defining_file, symbol)]
        """
        path = Path(file_path)
        if not path.is_absolute():
            path = self.repo_root / path
        
        if not path.exists():
            return
        
        rel_path = str(path.relative_to(self.repo_root)) if path.is_relative_to(self.repo_root) else str(path)
        
        try:
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
        except (IOError, UnicodeDecodeError):
            return
        
        # Parse file to find identifiers
        tree, lang_name = self._parser.parse_file(str(path), content)
        if not tree:
            return
        
        # Find all identifier nodes
        identifiers = self._find_identifiers(tree.root_node, content.encode('utf-8'))
        
        # Track dependencies for this file
        deps = set()
        
        for ident_name, line, col in identifiers:
            # Check if this identifier matches a known symbol
            if ident_name in all_symbols:
                for defining_file, symbol in all_symbols[ident_name]:
                    # Skip self-references (definitions in same file)
                    if defining_file == rel_path:
                        continue
                    
                    # Record the reference
                    location = Location(file_path=rel_path, line=line, col=col)
                    
                    if defining_file not in self._references:
                        self._references[defining_file] = {}
                    if ident_name not in self._references[defining_file]:
                        self._references[defining_file][ident_name] = []
                    
                    self._references[defining_file][ident_name].append(location)
                    deps.add(defining_file)
        
        # Update file dependency graph
        self._file_deps[rel_path] = deps
        for dep in deps:
            if dep not in self._file_refs:
                self._file_refs[dep] = set()
            self._file_refs[dep].add(rel_path)
    
    def _find_identifiers(
        self, 
        node, 
        content: bytes
    ) -> List[Tuple[str, int, int]]:
        """Find all identifier nodes in a tree.
        
        Returns:
            List of (name, line, col) tuples
        """
        identifiers = []
        
        # Node types that represent identifiers
        identifier_types = {
            'identifier',
            'property_identifier', 
            'shorthand_property_identifier',
            'type_identifier',
        }
        
        def visit(node):
            if node.type in identifier_types:
                name = content[node.start_byte:node.end_byte].decode('utf-8')
                # Skip common built-ins and keywords
                if name not in {'self', 'cls', 'None', 'True', 'False', 'print', 
                               'len', 'str', 'int', 'float', 'list', 'dict', 'set',
                               'return', 'if', 'else', 'for', 'while', 'try', 'except',
                               'import', 'from', 'class', 'def', 'async', 'await',
                               'this', 'super', 'new', 'function', 'const', 'let', 'var'}:
                    identifiers.append((
                        name,
                        node.start_point[0] + 1,  # 1-indexed
                        node.start_point[1]
                    ))
            
            for child in node.children:
                visit(child)
        
        visit(node)
        return identifiers
    
    def get_references_to_symbol(
        self, 
        file_path: str, 
        symbol_name: str
    ) -> List[Location]:
        """Get all locations that reference a symbol.
        
        Args:
            file_path: File where symbol is defined
            symbol_name: Name of the symbol
            
        Returns:
            List of locations referencing this symbol
        """
        return self._references.get(file_path, {}).get(symbol_name, [])
    
    def get_references_to_file(self, file_path: str) -> Dict[str, List[Location]]:
        """Get all references to symbols in a file.
        
        Args:
            file_path: File to get references for
            
        Returns:
            Dict of symbol_name -> [locations]
        """
        return self._references.get(file_path, {})
    
    def get_files_referencing(self, file_path: str) -> Set[str]:
        """Get all files that reference symbols in this file.
        
        Args:
            file_path: File to check
            
        Returns:
            Set of file paths that reference this file
        """
        return self._file_refs.get(file_path, set())
    
    def get_file_dependencies(self, file_path: str) -> Set[str]:
        """Get all files that this file depends on.
        
        Args:
            file_path: File to check
            
        Returns:
            Set of file paths this file references
        """
        return self._file_deps.get(file_path, set())
    
    def get_bidirectional_edges(self) -> set[tuple[str, str]]:
        """Get pairs of files with mutual references (A→B and B→A).
        
        Bidirectional edges identify mutually coupled files — files that
        are tightly interdependent and likely to be edited together.
        One-way references (e.g., many files import models.py but models.py
        imports nothing back) are excluded.
        
        Returns:
            Set of (file_a, file_b) tuples where file_a < file_b (canonical order)
        """
        edges = set()
        for file_a, deps in self._file_deps.items():
            for file_b in deps:
                if file_a in self._file_deps.get(file_b, set()):
                    edge = tuple(sorted([file_a, file_b]))
                    edges.add(edge)
        return edges
    
    def get_reference_summary(self, file_path: str) -> dict:
        """Get a summary of references for a file.
        
        Args:
            file_path: File to summarize
            
        Returns:
            Dict with reference counts and file lists
        """
        refs = self._references.get(file_path, {})
        ref_files = self._file_refs.get(file_path, set())
        
        symbol_refs = {}
        for symbol_name, locations in refs.items():
            symbol_refs[symbol_name] = {
                'count': len(locations),
                'files': list(set(loc.file_path for loc in locations))
            }
        
        return {
            'total_references': sum(len(locs) for locs in refs.values()),
            'referenced_by_files': sorted(ref_files),
            'symbols': symbol_refs
        }
