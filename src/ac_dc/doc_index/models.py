"""Data models for the document index."""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class DocSectionRef:
    """An outgoing reference from a heading to another document section."""
    target_path: str
    target_heading: Optional[str] = None


@dataclass
class DocLink:
    """A link found in a document."""
    target: str
    target_heading: Optional[str] = None
    source_heading: Optional[str] = None
    is_image: bool = False


@dataclass
class DocHeading:
    """A heading extracted from a document."""
    text: str
    level: int  # 1-6 for markdown
    keywords: list[str] = field(default_factory=list)
    start_line: int = 0
    children: list["DocHeading"] = field(default_factory=list)
    outgoing_refs: list[DocSectionRef] = field(default_factory=list)
    incoming_ref_count: int = 0
    content_types: list[str] = field(default_factory=list)
    section_lines: int = 0


@dataclass
class DocOutline:
    """Parse result for a single document."""
    path: str
    doc_type: str = "unknown"  # spec, guide, reference, decision, readme, notes, unknown
    headings: list[DocHeading] = field(default_factory=list)
    links: list[DocLink] = field(default_factory=list)