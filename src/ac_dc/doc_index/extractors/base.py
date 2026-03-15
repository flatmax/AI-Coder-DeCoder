"""Base document extractor."""

from abc import ABC, abstractmethod

from ac_dc.doc_index.models import DocOutline


class BaseDocExtractor(ABC):
    """Abstract base for document format extractors."""

    @abstractmethod
    def extract(self, path: str, content: str) -> DocOutline:
        """Extract structural outline from document content.

        Args:
            path: Relative file path.
            content: File content as string.

        Returns:
            DocOutline with headings, links, and doc_type.
        """
        ...