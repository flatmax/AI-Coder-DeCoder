"""Cross-file reference tracking for the symbol index."""

import logging
from collections import defaultdict
from typing import Optional

from ac_dc.symbol_index.models import FileSymbols

logger = logging.getLogger(__name__)

# Common identifiers to exclude from reference matching
_BUILTINS = {
    # Python
    "self", "cls", "None", "True", "False", "print", "len", "str", "int",
    "float", "bool", "list", "dict", "set", "tuple", "range", "type",
    "super", "isinstance", "issubclass", "hasattr", "getattr", "setattr",
    "property", "staticmethod", "classmethod", "object", "Exception",
    "ValueError", "TypeError", "KeyError", "AttributeError", "ImportError",
    "RuntimeError", "StopIteration", "NotImplementedError", "OSError",
    "open", "map", "filter", "zip", "enumerate", "sorted", "reversed",
    "any", "all", "min", "max", "sum", "abs", "round", "id", "hash",
    "repr", "format", "input", "iter", "next", "callable",
    # JavaScript
    "this", "new", "function", "const", "let", "var", "return",
    "undefined", "null", "console", "window", "document",
    "Array", "Object", "String", "Number", "Boolean", "Promise",
    "Map", "Set", "Error", "JSON", "Math", "Date", "RegExp",
    "require", "module", "exports", "import", "export",
    "setTimeout", "setInterval", "clearTimeout", "clearInterval",
    "addEventListener", "removeEventListener",
    # C
    "sizeof", "malloc", "free", "realloc", "calloc",
    "printf", "scanf", "fprintf", "sprintf", "strlen", "strcpy",
    "memcpy", "memset", "NULL", "void", "char", "short", "long",
    "unsigned", "signed", "double", "struct", "enum", "union", "typedef",
    "extern", "static", "inline", "const", "volatile",
}


class ReferenceIndex:
    """Cross-file reference graph.

    Tracks where symbols defined in one file are used in other files.
    """

    def __init__(self):
        self._refs: dict[str, list[dict]] = defaultdict(list)  # symbol_name -> [{file, line}]
        self._file_deps: dict[str, set[str]] = defaultdict(set)  # file -> set of files it depends on
        self._file_dependents: dict[str, set[str]] = defaultdict(set)  # file -> files that depend on it
        self._file_ref_counts: dict[str, int] = defaultdict(int)
        self._all_symbols: dict[str, str] = {}  # symbol_name -> defining file

    def build(self, all_file_symbols: dict[str, FileSymbols]):
        """Build the reference index from all parsed files.

        Args:
            all_file_symbols: Map of file_path -> FileSymbols.
        """
        self._refs.clear()
        self._file_deps.clear()
        self._file_dependents.clear()
        self._file_ref_counts.clear()
        self._all_symbols.clear()

        # Phase 1: collect all defined symbol names
        for path, fs in all_file_symbols.items():
            for sym in fs.all_symbols_flat:
                if sym.name and sym.name not in _BUILTINS:
                    self._all_symbols[sym.name] = path

        # Phase 2: match call sites to definitions
        for path, fs in all_file_symbols.items():
            for sym in fs.all_symbols_flat:
                for call in sym.call_sites:
                    # Try direct name match
                    call_name = call.name
                    # Handle attribute calls like "obj.method"
                    if "." in call_name:
                        call_name = call_name.split(".")[-1]

                    target_file = self._all_symbols.get(call_name)
                    if target_file and target_file != path:
                        call.target_file = target_file
                        call.target_symbol = call_name
                        self._refs[call_name].append({
                            "file": path,
                            "line": call.line,
                        })
                        self._file_deps[path].add(target_file)
                        self._file_dependents[target_file].add(path)

            # Also track import-based dependencies
            for imp in fs.imports:
                # If import resolved to a file, that's a dependency
                # (ImportResolver sets target_file on call sites,
                #  but we also track via module name matching)
                for name in imp.names:
                    target_file = self._all_symbols.get(name)
                    if target_file and target_file != path:
                        self._file_deps[path].add(target_file)
                        self._file_dependents[target_file].add(path)

        # Compute reference counts
        for path in all_file_symbols:
            self._file_ref_counts[path] = len(self._file_dependents.get(path, set()))

    def references_to_symbol(self, name: str) -> list[dict]:
        """All locations where a symbol is referenced."""
        return list(self._refs.get(name, []))

    def files_referencing(self, file_path: str) -> set[str]:
        """Set of files that depend on this file."""
        return set(self._file_dependents.get(file_path, set()))

    def file_dependencies(self, file_path: str) -> set[str]:
        """Set of files this file depends on."""
        return set(self._file_deps.get(file_path, set()))

    def file_ref_count(self, file_path: str) -> int:
        """Incoming reference count for a file."""
        return self._file_ref_counts.get(file_path, 0)

    def bidirectional_edges(self) -> list[tuple[str, str]]:
        """File pairs with mutual dependencies."""
        edges = []
        seen = set()
        for a, deps in self._file_deps.items():
            for b in deps:
                if b in self._file_deps and a in self._file_deps[b]:
                    pair = tuple(sorted((a, b)))
                    if pair not in seen:
                        seen.add(pair)
                        edges.append(pair)
        return edges

    def connected_components(self) -> list[list[str]]:
        """Clusters of mutually-coupled files (bidirectional edges only)."""
        bi_edges = self.bidirectional_edges()

        # Build adjacency
        adj: dict[str, set[str]] = defaultdict(set)
        for a, b in bi_edges:
            adj[a].add(b)
            adj[b].add(a)

        visited: set[str] = set()
        components: list[list[str]] = []

        for node in adj:
            if node in visited:
                continue
            component = []
            stack = [node]
            while stack:
                n = stack.pop()
                if n in visited:
                    continue
                visited.add(n)
                component.append(n)
                for neighbor in adj[n]:
                    if neighbor not in visited:
                        stack.append(neighbor)
            if component:
                components.append(sorted(component))

        return components