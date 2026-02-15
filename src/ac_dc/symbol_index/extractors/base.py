"""Base class for language-specific symbol extractors."""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Parameter:
    name: str
    type_hint: str = ""
    default: str = ""
    is_args: bool = False
    is_kwargs: bool = False


@dataclass
class CallSite:
    name: str
    line: int
    is_conditional: bool = False
    target_symbol: Optional[str] = None
    target_file: Optional[str] = None


@dataclass
class Import:
    module: str
    names: list = field(default_factory=list)
    alias: Optional[str] = None
    level: int = 0  # 0 = absolute, 1+ = relative


@dataclass
class Symbol:
    name: str
    kind: str  # "class", "function", "method", "variable", "import", "property"
    file_path: str = ""
    start_line: int = 0
    start_col: int = 0
    end_line: int = 0
    end_col: int = 0
    parameters: list = field(default_factory=list)  # list[Parameter]
    return_type: Optional[str] = None
    bases: list = field(default_factory=list)
    children: list = field(default_factory=list)  # list[Symbol]
    is_async: bool = False
    call_sites: list = field(default_factory=list)  # list[CallSite]
    instance_vars: list = field(default_factory=list)

    @property
    def range(self):
        return {
            "start_line": self.start_line,
            "start_col": self.start_col,
            "end_line": self.end_line,
            "end_col": self.end_col,
        }

    def signature_hash_content(self):
        """Content used for stable hashing."""
        parts = [self.name, self.kind]
        for p in self.parameters:
            parts.append(p.name)
            if p.type_hint:
                parts.append(p.type_hint)
        if self.return_type:
            parts.append(self.return_type)
        parts.extend(self.bases)
        for child in self.children:
            parts.append(child.signature_hash_content())
        return "|".join(parts)


@dataclass
class FileSymbols:
    file_path: str
    symbols: list = field(default_factory=list)  # top-level Symbol list
    imports: list = field(default_factory=list)   # Import list

    @property
    def all_symbols_flat(self):
        """Flattened list including nested children."""
        result = []
        def _collect(sym):
            result.append(sym)
            for child in sym.children:
                _collect(child)
        for s in self.symbols:
            _collect(s)
        return result


class BaseExtractor:
    """Base class for language-specific extractors."""

    def extract(self, tree, source_code, file_path):
        """Extract symbols from a parsed tree.

        Args:
            tree: tree-sitter Tree
            source_code: bytes
            file_path: str

        Returns:
            FileSymbols
        """
        raise NotImplementedError

    def _node_text(self, node, source):
        """Get text content of a node."""
        if node is None:
            return ""
        return source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")

    def _find_children(self, node, type_name):
        """Find all direct children of a given type."""
        return [c for c in node.children if c.type == type_name]

    def _find_child(self, node, type_name):
        """Find first direct child of a given type."""
        for c in node.children:
            if c.type == type_name:
                return c
        return None

    def _extract_call_sites(self, node, source):
        """Extract function/method call sites from a node."""
        calls = []
        self._walk_calls(node, source, calls)
        return calls

    def _walk_calls(self, node, source, calls):
        """Recursively walk node to find call expressions."""
        if node.type == "call" or node.type == "call_expression":
            func_node = self._find_child(node, "function") or node.children[0] if node.children else None
            if func_node:
                name = self._node_text(func_node, source)
                # Simplify dotted calls like self.method() -> method
                if "." in name:
                    name = name.split(".")[-1]
                # Check if inside if/else
                is_conditional = self._is_in_conditional(node)
                calls.append(CallSite(
                    name=name,
                    line=node.start_point[0] + 1,
                    is_conditional=is_conditional,
                ))
        for child in node.children:
            self._walk_calls(child, source, calls)

    def _is_in_conditional(self, node):
        """Check if node is inside an if/else/ternary."""
        current = node.parent
        while current:
            if current.type in ("if_statement", "if_expression",
                                "conditional_expression", "ternary_expression"):
                return True
            current = current.parent
        return False
