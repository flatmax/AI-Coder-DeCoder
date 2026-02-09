"""Base symbol extractor with generic tree-sitter AST walking."""

import logging
from typing import Optional

from ..models import (
    Symbol, SymbolKind, SymbolRange, Parameter, CallSite, Import, FileSymbols,
)

log = logging.getLogger(__name__)


def _node_text(node, source_bytes: bytes) -> str:
    """Extract text from a tree-sitter node."""
    return source_bytes[node.start_byte:node.end_byte].decode("utf-8", errors="replace")


def _make_range(node) -> SymbolRange:
    """Create a SymbolRange from a tree-sitter node."""
    return SymbolRange(
        start_line=node.start_point[0] + 1,  # 1-indexed
        start_col=node.start_point[1],
        end_line=node.end_point[0] + 1,
        end_col=node.end_point[1],
    )


class BaseExtractor:
    """Generic symbol extractor using AST walking.

    Subclasses override methods for language-specific behavior.
    """

    # Node types that define symbols — subclasses override
    CLASS_NODE_TYPES: set[str] = set()
    FUNCTION_NODE_TYPES: set[str] = set()
    VARIABLE_NODE_TYPES: set[str] = set()
    IMPORT_NODE_TYPES: set[str] = set()
    CALL_NODE_TYPES: set[str] = {"call_expression"}
    PROPERTY_NODE_TYPES: set[str] = set()

    def extract(self, tree, source: str, file_path: str) -> FileSymbols:
        """Extract symbols from a parsed tree."""
        source_bytes = source.encode("utf-8")
        result = FileSymbols(file_path=file_path)

        if tree is None or tree.root_node is None:
            result.parse_error = "No parse tree"
            return result

        try:
            self._walk_tree(tree.root_node, source_bytes, result, parent_class=None)
        except Exception as e:
            log.warning("Extraction error in %s: %s", file_path, e)
            result.parse_error = str(e)

        return result

    def _walk_tree(
        self,
        node,
        source_bytes: bytes,
        result: FileSymbols,
        parent_class: Optional[Symbol],
    ):
        """Recursively walk the AST and extract symbols."""
        ntype = node.type

        if ntype in self.CLASS_NODE_TYPES:
            sym = self._extract_class(node, source_bytes, result.file_path)
            if sym:
                if parent_class:
                    parent_class.children.append(sym)
                else:
                    result.symbols.append(sym)
                # Walk children for methods
                for child in node.children:
                    if hasattr(child, 'type') and child.type in (
                        'block', 'class_body', 'statement_block',
                        'declaration_list', 'field_declaration_list',
                    ):
                        self._walk_tree(child, source_bytes, result, parent_class=sym)
                return  # Don't re-walk children

        elif ntype in self.FUNCTION_NODE_TYPES:
            sym = self._extract_function(node, source_bytes, result.file_path, parent_class)
            if sym:
                if parent_class:
                    parent_class.children.append(sym)
                else:
                    result.symbols.append(sym)
                # Extract call sites from the function body
                self._extract_calls(node, source_bytes, sym)
                return

        elif ntype in self.IMPORT_NODE_TYPES:
            imp = self._extract_import(node, source_bytes)
            if imp:
                result.imports.append(imp)

        elif ntype in self.VARIABLE_NODE_TYPES and parent_class is None:
            sym = self._extract_variable(node, source_bytes, result.file_path)
            if sym:
                result.symbols.append(sym)

        elif ntype in self.PROPERTY_NODE_TYPES and parent_class is not None:
            sym = self._extract_property(node, source_bytes, result.file_path)
            if sym:
                parent_class.children.append(sym)

        # Recurse
        for child in node.children:
            self._walk_tree(child, source_bytes, result, parent_class)

    def _extract_class(
        self, node, source_bytes: bytes, file_path: str
    ) -> Optional[Symbol]:
        """Extract a class definition. Override for language specifics."""
        return None

    def _extract_function(
        self, node, source_bytes: bytes, file_path: str,
        parent_class: Optional[Symbol],
    ) -> Optional[Symbol]:
        """Extract a function/method. Override for language specifics."""
        return None

    def _extract_import(self, node, source_bytes: bytes) -> Optional[Import]:
        """Extract an import. Override for language specifics."""
        return None

    def _extract_variable(
        self, node, source_bytes: bytes, file_path: str
    ) -> Optional[Symbol]:
        """Extract a top-level variable/constant."""
        return None

    def _extract_property(
        self, node, source_bytes: bytes, file_path: str
    ) -> Optional[Symbol]:
        """Extract a class property."""
        return None

    def _extract_calls(self, node, source_bytes: bytes, func_sym: Symbol):
        """Extract call sites from a function body."""
        if node is None:
            return
        for child in node.children:
            if child.type in self.CALL_NODE_TYPES:
                call = self._parse_call(child, source_bytes)
                if call:
                    func_sym.call_sites.append(call)
            self._extract_calls(child, source_bytes, func_sym)

    def _parse_call(self, node, source_bytes: bytes) -> Optional[CallSite]:
        """Parse a call expression node into a CallSite."""
        # Generic: look for the function being called
        func_node = node.child_by_field_name("function")
        if func_node is None and node.children:
            func_node = node.children[0]

        if func_node is None:
            return None

        name = _node_text(func_node, source_bytes)
        # Skip overly long/complex call expressions
        if len(name) > 80 or "\n" in name:
            return None

        # Check if inside conditional
        is_conditional = self._is_in_conditional(node)

        return CallSite(
            name=name,
            line=node.start_point[0] + 1,
            is_conditional=is_conditional,
        )

    def _is_in_conditional(self, node) -> bool:
        """Check if a node is inside an if/try/except block."""
        parent = node.parent
        conditional_types = {
            "if_statement", "elif_clause", "else_clause",
            "try_statement", "except_clause", "catch_clause",
            "if_expression", "conditional_expression",
            "ternary_expression",
        }
        while parent is not None:
            if parent.type in conditional_types:
                return True
            # Stop at function boundary
            if parent.type in self.FUNCTION_NODE_TYPES | self.CLASS_NODE_TYPES:
                break
            parent = parent.parent
        return False

    def _find_child_by_type(self, node, type_name: str):
        """Find first child with given type."""
        for child in node.children:
            if child.type == type_name:
                return child
        return None

    def _find_children_by_type(self, node, type_name: str) -> list:
        """Find all children with given type."""
        return [c for c in node.children if c.type == type_name]
