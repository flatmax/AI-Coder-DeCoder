"""Base extractor interface."""

from abc import ABC, abstractmethod
from typing import List, Optional
from ..models import Symbol


class BaseExtractor(ABC):
    """Abstract base class for language-specific symbol extractors."""
    
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
    
    def _get_node_text(self, node, content: bytes) -> str:
        """Get the text content of a node."""
        return content[node.start_byte:node.end_byte].decode('utf-8')
    
    def _get_docstring(self, node, content: bytes) -> Optional[str]:
        """Extract docstring from a node if present. Override in subclasses."""
        return None
