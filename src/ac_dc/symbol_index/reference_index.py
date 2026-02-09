"""Cross-file reference tracking."""

import logging
from collections import defaultdict
from typing import Optional

from .models import FileSymbols, Symbol, SymbolKind

log = logging.getLogger(__name__)

# Common identifiers that produce noise
BUILTINS_PYTHON = {
    "self", "cls", "None", "True", "False", "print", "len", "str", "int",
    "float", "bool", "list", "dict", "set", "tuple", "type", "range",
    "enumerate", "zip", "map", "filter", "sorted", "reversed", "super",
    "isinstance", "issubclass", "hasattr", "getattr", "setattr", "property",
    "staticmethod", "classmethod", "Exception", "ValueError", "TypeError",
    "KeyError", "IndexError", "AttributeError", "RuntimeError", "OSError",
    "NotImplementedError", "StopIteration", "object", "open", "input",
    "max", "min", "abs", "sum", "any", "all", "iter", "next", "id", "hash",
    "repr", "format", "chr", "ord",
}

BUILTINS_JS = {
    "this", "super", "new", "function", "const", "let", "var",
    "return", "if", "for", "while", "switch", "case", "break",
    "continue", "class", "extends", "import", "export", "default",
    "null", "undefined", "true", "false", "NaN", "Infinity",
    "console", "window", "document", "Math", "JSON", "Array",
    "Object", "String", "Number", "Boolean", "Date", "Promise",
    "Error", "TypeError", "RangeError", "Map", "Set", "WeakMap",
    "setTimeout", "setInterval", "clearTimeout", "clearInterval",
    "require", "module", "exports", "async", "await", "yield",
    "typeof", "instanceof", "void", "delete", "in", "of",
    "try", "catch", "finally", "throw",
}

BUILTINS_C = {
    "int", "char", "float", "double", "void", "long", "short",
    "unsigned", "signed", "const", "static", "extern", "volatile",
    "struct", "enum", "union", "typedef", "sizeof", "return",
    "if", "else", "for", "while", "do", "switch", "case", "break",
    "continue", "goto", "default", "NULL", "true", "false",
    "printf", "fprintf", "sprintf", "malloc", "free", "calloc",
    "realloc", "memcpy", "memset", "strlen", "strcmp", "strcpy",
    "size_t", "uint8_t", "uint16_t", "uint32_t", "uint64_t",
    "int8_t", "int16_t", "int32_t", "int64_t", "bool",
    "stdin", "stdout", "stderr", "EOF", "BUFSIZ",
    "include", "define", "ifdef", "ifndef", "endif", "pragma",
}

ALL_BUILTINS = BUILTINS_PYTHON | BUILTINS_JS | BUILTINS_C


class ReferenceIndex:
    """Tracks where symbols are used across files."""

    def __init__(self):
        # symbol_name -> list of (file_path, line)
        self._refs: dict[str, list[tuple[str, int]]] = defaultdict(list)
        # file_path -> set of symbol names defined in it
        self._definitions: dict[str, set[str]] = defaultdict(set)
        # file_path -> set of files it imports from
        self._imports_from: dict[str, set[str]] = defaultdict(set)
        # file_path -> set of files that import it
        self._imported_by: dict[str, set[str]] = defaultdict(set)
        # file_path -> ref count (how many other files reference it)
        self._file_ref_count: dict[str, int] = defaultdict(int)

    def clear(self):
        """Clear all reference data."""
        self._refs.clear()
        self._definitions.clear()
        self._imports_from.clear()
        self._imported_by.clear()
        self._file_ref_count.clear()

    def build(self, all_symbols: dict[str, FileSymbols]):
        """Build the reference index from all file symbols."""
        self.clear()

        # Phase 1: Collect definitions
        for fpath, fsyms in all_symbols.items():
            for sym in fsyms.all_symbols_flat:
                self._definitions[fpath].add(sym.name)

        # Phase 2: Collect import edges
        for fpath, fsyms in all_symbols.items():
            for imp in fsyms.imports:
                # Import target is stored on import objects if resolved
                pass  # Handled by register_import_edge

        # Phase 3: Collect references via call sites
        all_defined = {}  # name -> set of files defining it
        for fpath, names in self._definitions.items():
            for name in names:
                if name not in all_defined:
                    all_defined[name] = set()
                all_defined[name].add(fpath)

        for fpath, fsyms in all_symbols.items():
            for sym in fsyms.all_symbols_flat:
                for call in sym.call_sites:
                    call_name = call.name.split(".")[-1]  # Last component
                    if call_name in ALL_BUILTINS:
                        continue
                    if call_name in all_defined:
                        for def_file in all_defined[call_name]:
                            if def_file != fpath:
                                self._refs[call_name].append((fpath, call.line))
                                self._file_ref_count[def_file] = \
                                    self._file_ref_count.get(def_file, 0) + 1

    def register_import_edge(self, from_file: str, to_file: str):
        """Register a resolved import relationship."""
        if from_file != to_file:
            self._imports_from[from_file].add(to_file)
            self._imported_by[to_file].add(from_file)
            self._file_ref_count[to_file] = \
                self._file_ref_count.get(to_file, 0) + 1

    def references_to_symbol(self, name: str) -> list[tuple[str, int]]:
        """All locations referencing a symbol name."""
        return list(self._refs.get(name, []))

    def files_referencing(self, file_path: str) -> set[str]:
        """Set of files that reference symbols defined in file_path."""
        result = set(self._imported_by.get(file_path, set()))
        # Also check call-site references
        for name in self._definitions.get(file_path, set()):
            for ref_file, _ in self._refs.get(name, []):
                result.add(ref_file)
        result.discard(file_path)
        return result

    def file_dependencies(self, file_path: str) -> set[str]:
        """Set of files that file_path depends on."""
        return set(self._imports_from.get(file_path, set()))

    def file_ref_count(self, file_path: str) -> int:
        """How many external references point to this file."""
        return self._file_ref_count.get(file_path, 0)

    def bidirectional_edges(self) -> list[tuple[str, str]]:
        """Pairs of files with mutual references (A→B AND B→A)."""
        edges = []
        seen = set()

        for file_a, deps_a in self._imports_from.items():
            for file_b in deps_a:
                if file_b in self._imports_from and file_a in self._imports_from[file_b]:
                    pair = tuple(sorted([file_a, file_b]))
                    if pair not in seen:
                        seen.add(pair)
                        edges.append(pair)

        return edges

    def connected_components(self) -> list[set[str]]:
        """Find connected components from bidirectional edges."""
        edges = self.bidirectional_edges()
        if not edges:
            return []

        # Build adjacency
        adj: dict[str, set[str]] = defaultdict(set)
        for a, b in edges:
            adj[a].add(b)
            adj[b].add(a)

        visited: set[str] = set()
        components: list[set[str]] = []

        for node in adj:
            if node in visited:
                continue
            component: set[str] = set()
            stack = [node]
            while stack:
                current = stack.pop()
                if current in visited:
                    continue
                visited.add(current)
                component.add(current)
                for neighbor in adj[current]:
                    if neighbor not in visited:
                        stack.append(neighbor)
            components.append(component)

        return components

    def reference_annotations(
        self, symbol_name: str, defining_file: str, max_refs: int = 4
    ) -> tuple[list[str], int]:
        """Get reference annotations for a symbol.

        Returns (list of "file:line" strings, count of additional refs).
        """
        refs = self._refs.get(symbol_name, [])
        # Filter out self-references
        external = [(f, l) for f, l in refs if f != defining_file]

        shown = []
        for ref_file, ref_line in external[:max_refs]:
            shown.append(f"{ref_file}:{ref_line}")

        remaining = max(0, len(external) - max_refs)
        return shown, remaining
