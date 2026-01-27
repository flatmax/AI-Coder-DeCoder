"""Base extractor interface."""

from abc import ABC, abstractmethod
from typing import List, Optional
from ..models import Symbol, Range, Import


class BaseExtractor(ABC):
    """Abstract base class for language-specific symbol extractors."""
    
    def __init__(self):
        self._imports: List[Import] = []
    
    @abstractmethod
    def extract_symbols(self, tree, file_path: str, content: bytes) -> List[Symbol]:
        """Extract symbols from a parsed tree.
        
        Args:
            tree: tree-sitter Tree object
            file_path: Path to the source file
            content: Raw file content as bytes
            
        Returns:
            List of Symbol objects found in the file
        """
        pass
    
    def get_imports(self) -> List[Import]:
        """Get structured imports from last extraction."""
        return self._imports
    
    def _get_node_text(self, node, content: bytes) -> str:
        """Get the text content of a node."""
        return content[node.start_byte:node.end_byte].decode('utf-8')
    
    def _find_child(self, node, type_name: str):
        """Find the first child of a given type."""
        for child in node.children:
            if child.type == type_name:
                return child
        return None
    
    def _make_range(self, node) -> Range:
        """Create a Range from a tree-sitter node."""
        return Range(
            start_line=node.start_point[0] + 1,
            start_col=node.start_point[1],
            end_line=node.end_point[0] + 1,
            end_col=node.end_point[1],
        )
    
    def _get_docstring(self, node, content: bytes) -> Optional[str]:
        """Extract docstring from a node if present. Override in subclasses."""
        return None
