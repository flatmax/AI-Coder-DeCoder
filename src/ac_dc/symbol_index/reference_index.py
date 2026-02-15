"""Cross-file reference tracking."""

from collections import defaultdict

# Common identifiers to exclude from reference tracking
BUILTINS = frozenset({
    # Python
    "self", "cls", "None", "True", "False", "print", "len", "str", "int",
    "float", "list", "dict", "set", "tuple", "bool", "type", "range",
    "enumerate", "zip", "map", "filter", "sorted", "reversed", "any", "all",
    "min", "max", "sum", "abs", "round", "open", "input", "isinstance",
    "issubclass", "hasattr", "getattr", "setattr", "delattr", "super",
    "property", "staticmethod", "classmethod", "object", "Exception",
    "ValueError", "TypeError", "KeyError", "IndexError", "AttributeError",
    "RuntimeError", "StopIteration", "NotImplementedError", "OSError",
    # JavaScript
    "this", "new", "function", "const", "let", "var", "return",
    "if", "else", "for", "while", "do", "switch", "case", "break",
    "continue", "try", "catch", "finally", "throw", "async", "await",
    "class", "extends", "import", "export", "default", "from",
    "typeof", "instanceof", "in", "of", "null", "undefined",
    "console", "window", "document", "Math", "JSON", "Array", "Object",
    "String", "Number", "Boolean", "Promise", "Error", "Map", "Set",
    # C
    "int", "char", "void", "float", "double", "long", "short",
    "unsigned", "signed", "struct", "typedef", "enum", "union",
    "sizeof", "static", "extern", "const", "volatile",
    "if", "else", "for", "while", "do", "switch", "case",
    "return", "break", "continue", "goto", "NULL", "main",
})


class ReferenceIndex:
    """Tracks cross-file symbol references."""

    def __init__(self):
        self._refs = defaultdict(list)  # symbol_name -> [{file, line}]
        self._file_refs = defaultdict(set)  # file -> set of files it references
        self._file_deps = defaultdict(set)  # file -> set of files it depends on

    def build(self, all_file_symbols):
        """Build reference index from all parsed files.

        Args:
            all_file_symbols: dict of {path: FileSymbols}
        """
        self._refs.clear()
        self._file_refs.clear()
        self._file_deps.clear()

        # Collect all symbol names by file
        symbol_names = {}  # name -> defining file
        for path, fs in all_file_symbols.items():
            for sym in fs.all_symbols_flat:
                if sym.name and sym.name not in BUILTINS:
                    symbol_names[sym.name] = path

        # Track references via call sites
        for path, fs in all_file_symbols.items():
            for sym in fs.all_symbols_flat:
                for call in sym.call_sites:
                    if call.name in symbol_names:
                        target_file = symbol_names[call.name]
                        if target_file != path:
                            self._refs[call.name].append({
                                "file": path,
                                "line": call.line,
                            })
                            self._file_refs[target_file].add(path)
                            self._file_deps[path].add(target_file)

            # Track import references
            for imp in fs.imports:
                for name in imp.names:
                    if name in symbol_names:
                        target_file = symbol_names[name]
                        if target_file != path:
                            self._file_refs[target_file].add(path)
                            self._file_deps[path].add(target_file)

    def references_to_symbol(self, name):
        """All locations where a symbol is used."""
        return self._refs.get(name, [])

    def files_referencing(self, file_path):
        """Set of files that reference symbols in this file."""
        return self._file_refs.get(file_path, set())

    def file_dependencies(self, file_path):
        """Set of files this file depends on."""
        return self._file_deps.get(file_path, set())

    def file_ref_count(self, file_path):
        """Incoming reference count for a file."""
        return len(self._file_refs.get(file_path, set()))

    def bidirectional_edges(self):
        """Find mutually-dependent file pairs."""
        edges = set()
        for file_a, deps in self._file_deps.items():
            for file_b in deps:
                if file_a in self._file_deps.get(file_b, set()):
                    pair = tuple(sorted([file_a, file_b]))
                    edges.add(pair)
        return edges

    def connected_components(self):
        """Find clusters of coupled files via bidirectional edges."""
        edges = self.bidirectional_edges()
        if not edges:
            return []

        # Build adjacency list
        adj = defaultdict(set)
        for a, b in edges:
            adj[a].add(b)
            adj[b].add(a)

        visited = set()
        components = []

        for node in adj:
            if node in visited:
                continue
            component = set()
            stack = [node]
            while stack:
                current = stack.pop()
                if current in visited:
                    continue
                visited.add(current)
                component.add(current)
                stack.extend(adj[current] - visited)
            if component:
                components.append(component)

        return components

    @property
    def all_referenced_files(self):
        """All files that have at least one reference."""
        return set(self._file_refs.keys()) | set(self._file_deps.keys())
