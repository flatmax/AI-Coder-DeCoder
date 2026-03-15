"""Base extractor for tree-sitter ASTs."""

from abc import ABC, abstractmethod
from typing import Optional

from ac_dc.symbol_index.models import FileSymbols


class BaseExtractor(ABC):
    """Abstract base for language-specific symbol extractors.

    Subclasses implement extract() to walk a tree-sitter AST (or raw source)
    and produce a FileSymbols result.
    """

    # Set True for regex-based extractors that don't need tree-sitter
    tree_optional: bool = False

    @abstractmethod
    def extract(self, source: bytes, tree: Optional[object], file_path: str) -> FileSymbols:
        """Extract symbols from parsed source.

        Args:
            source: Raw file bytes.
            tree: tree-sitter Tree object, or None if tree_optional.
            file_path: Relative path for symbol metadata.

        Returns:
            FileSymbols with top-level symbols and imports.
        """
        ...

    def _node_text(self, node, source: bytes) -> str:
        """Get the text content of a tree-sitter node."""
        return source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")

    def _node_range(self, node) -> dict:
        """Get line/col range from a tree-sitter node (1-indexed lines)."""
        return {
            "start_line": node.start_point[0] + 1,
            "start_col": node.start_point[1],
            "end_line": node.end_point[0] + 1,
            "end_col": node.end_point[1],
        }