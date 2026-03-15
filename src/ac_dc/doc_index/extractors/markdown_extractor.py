"""Markdown document extractor — regex-based, no external dependencies."""

import re
from pathlib import PurePosixPath
from typing import Optional

from ac_dc.doc_index.models import DocHeading, DocLink, DocOutline
from ac_dc.doc_index.extractors.base import BaseDocExtractor

# Heading pattern: # through ######
_HEADING_RE = re.compile(r'^(#{1,6})\s+(.+)$', re.MULTILINE)

# Link patterns: [text](target) and ![alt](target)
_LINK_RE = re.compile(r'(!?)\[([^\]]*)\]\(([^)]+)\)')

# Image path extensions for path-extension scan
_IMAGE_EXTS = ('.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico')
_IMAGE_PATH_RE = re.compile(r'[\w./-]+\.(?:svg|png|jpe?g|gif|webp|bmp|ico)', re.IGNORECASE)

# Content type detection
_TABLE_RE = re.compile(r'\|[-:]+[-:|]+\|')
_CODE_FENCE_RE = re.compile(r'^[ \t]*(`{3,}|~{3,})', re.MULTILINE)
_FORMULA_DISPLAY = re.compile(r'\$\$')
_FORMULA_INLINE = re.compile(r'(?<!\$)\$(?!\$)[^$]+\$(?!\$)')


def _detect_doc_type(path: str, headings: list[DocHeading]) -> str:
    """Infer document type from path and heading structure."""
    basename = PurePosixPath(path).name.lower()
    dir_parts = [p.lower() for p in PurePosixPath(path).parts[:-1]]

    # Path-based detection
    if basename.startswith("readme"):
        return "readme"
    if basename.startswith("adr-"):
        return "decision"
    for part in dir_parts:
        if part in ("spec", "specs", "rfc", "design"):
            return "spec"
        if part in ("guide", "tutorial", "howto", "getting-started"):
            return "guide"
        if part in ("reference", "api", "endpoints"):
            return "reference"
        if part in ("notes", "meeting", "minutes", "journal"):
            return "notes"

    # Heading-based detection
    heading_texts = set()
    for h in _flatten_headings(headings):
        heading_texts.add(h.text.lower())

    if "status" in heading_texts and "decision" in heading_texts:
        return "decision"

    # Check for numbered headings (spec pattern)
    for h in _flatten_headings(headings):
        if re.match(r'^\d+\.?\d*\s+', h.text):
            return "spec"

    return "unknown"


def _flatten_headings(headings: list[DocHeading]) -> list[DocHeading]:
    """Flatten a heading tree into a list."""
    result = []
    stack = list(headings)
    while stack:
        h = stack.pop(0)
        result.append(h)
        stack = list(h.children) + stack
    return result


class MarkdownExtractor(BaseDocExtractor):
    """Extract structural outline from markdown files."""

    def __init__(self, repo_files: Optional[set[str]] = None):
        """
        Args:
            repo_files: Set of repo file paths for validating image references.
        """
        self._repo_files = repo_files or set()

    def extract(self, path: str, content: str) -> DocOutline:
        lines = content.splitlines()
        headings = self._extract_headings(lines, content)
        links = self._extract_links(path, content)

        # Detect content types per section
        self._annotate_sections(headings, lines)

        # Detect doc type
        doc_type = _detect_doc_type(path, headings)

        return DocOutline(
            path=path, doc_type=doc_type,
            headings=headings, links=links,
        )

    def _extract_headings(self, lines: list[str], content: str) -> list[DocHeading]:
        """Extract headings with nesting from markdown lines."""
        flat_headings = []

        for i, line in enumerate(lines):
            m = _HEADING_RE.match(line)
            if m:
                level = len(m.group(1))
                text = m.group(2).strip()
                flat_headings.append(DocHeading(
                    text=text, level=level, start_line=i,
                ))

        # Build tree from flat list
        return self._build_heading_tree(flat_headings)

    def _build_heading_tree(self, flat: list[DocHeading]) -> list[DocHeading]:
        """Convert flat heading list into nested tree."""
        if not flat:
            return []

        root: list[DocHeading] = []
        stack: list[DocHeading] = []

        for heading in flat:
            # Pop stack until we find a parent with lower level
            while stack and stack[-1].level >= heading.level:
                stack.pop()

            if stack:
                stack[-1].children.append(heading)
            else:
                root.append(heading)

            stack.append(heading)

        return root

    def _extract_links(self, path: str, content: str) -> list[DocLink]:
        """Extract links and image references from markdown content."""
        links = []
        lines = content.splitlines()

        # Track which heading each line falls under
        current_heading = None

        line_headings: dict[int, str] = {}  # line_num -> heading text
        for i, line in enumerate(lines):
            m = _HEADING_RE.match(line)
            if m:
                current_heading = m.group(2).strip()
            line_headings[i] = current_heading

        # Standard markdown links
        for m in _LINK_RE.finditer(content):
            is_image = m.group(1) == "!"
            target = m.group(3).strip()

            # Skip external URLs and data URIs
            if target.startswith(("http://", "https://", "data:", "#")):
                continue

            # Parse heading anchor
            target_heading = None
            if "#" in target:
                target, fragment = target.rsplit("#", 1)
                target_heading = fragment.replace("-", " ")

            if not target and not target_heading:
                continue

            # Determine source heading
            line_num = content[:m.start()].count("\n")
            source_heading = line_headings.get(line_num)

            links.append(DocLink(
                target=target if target else "",
                target_heading=target_heading,
                source_heading=source_heading,
                is_image=is_image,
            ))

        # Path-extension scan for image references
        for m in _IMAGE_PATH_RE.finditer(content):
            img_path = m.group(0)
            # Validate against repo files
            if self._repo_files and img_path not in self._repo_files:
                # Try resolving relative to document's directory
                doc_dir = str(PurePosixPath(path).parent)
                resolved = (PurePosixPath(doc_dir) / img_path).as_posix()
                if resolved not in self._repo_files:
                    continue

            # Avoid duplicates
            if not any(l.target == img_path and l.is_image for l in links):
                line_num = content[:m.start()].count("\n")
                source_heading = line_headings.get(line_num)
                links.append(DocLink(
                    target=img_path,
                    source_heading=source_heading,
                    is_image=True,
                ))

        return links

    def _annotate_sections(self, headings: list[DocHeading], lines: list[str]):
        """Annotate headings with content types and section sizes."""
        flat = _flatten_headings(headings)
        for i, heading in enumerate(flat):
            # Compute section boundaries
            start = heading.start_line
            if i + 1 < len(flat):
                end = flat[i + 1].start_line
            else:
                end = len(lines)

            heading.section_lines = end - start

            # Detect content types
            section_text = "\n".join(lines[start:end])
            if _TABLE_RE.search(section_text):
                heading.content_types.append("table")
            if _CODE_FENCE_RE.search(section_text):
                heading.content_types.append("code")
            if _FORMULA_DISPLAY.search(section_text) or _FORMULA_INLINE.search(section_text):
                heading.content_types.append("formula")