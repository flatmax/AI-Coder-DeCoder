"""Base class for document extractors and shared data model."""

from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class DocHeading:
    """A heading in a document outline."""
    text: str
    level: int              # 1-6 for markdown headings
    keywords: List[str] = field(default_factory=list)
    start_line: int = 0     # 0-indexed line number
    children: List["DocHeading"] = field(default_factory=list)

    def signature_hash_content(self):
        """Content used for stable hashing."""
        parts = [str(self.level), self.text]
        parts.extend(self.keywords)
        for child in self.children:
            parts.append(child.signature_hash_content())
        return "|".join(parts)


@dataclass
class DocLink:
    """A link found in a document."""
    target: str             # relative path or URL
    source_heading: str = ""  # heading text under which link appears


@dataclass
class DocOutline:
    """Structural outline of a document."""
    path: str
    headings: List[DocHeading] = field(default_factory=list)
    links: List[DocLink] = field(default_factory=list)

    @property
    def all_headings_flat(self):
        """Flattened list of all headings including nested children."""
        result = []

        def _collect(heading):
            result.append(heading)
            for child in heading.children:
                _collect(child)

        for h in self.headings:
            _collect(h)
        return result

    def signature_hash_content(self):
        """Content used for stable hashing."""
        parts = [self.path]
        for h in self.headings:
            parts.append(h.signature_hash_content())
        for link in self.links:
            parts.append(f"link:{link.target}")
        return "|".join(parts)


class BaseDocExtractor:
    """Base class for document format extractors."""

    def extract(self, path, text):
        """Extract document outline from text content.

        Args:
            path: file path (relative to repo root)
            text: full text content of the file

        Returns:
            DocOutline
        """
        raise NotImplementedError