"""Markdown document extractor — regex-based heading and link extraction.

No external dependencies. Handles ATX headings (# prefix) and
[text](target) links. Detects document type heuristically from path
and heading structure.
"""

import os
import re

from .base import BaseDocExtractor, DocHeading, DocLink, DocOutline

# ATX heading: one or more # at start of line, followed by space and text
_HEADING_RE = re.compile(r'^(#{1,6})\s+(.+?)(?:\s+#+\s*)?$')

# Markdown links: [text](target) — excludes images ![alt](src)
_LINK_RE = re.compile(r'(?<!!)\[([^\]]+)\]\(([^)]+)\)')

# Fenced code block markers
_FENCE_RE = re.compile(r'^(`{3,}|~{3,})')

# Content-type detection patterns
_TABLE_SEP_RE = re.compile(r'^\|[\s:]*-[-\s:|]*\|')  # |---|---| or |:---:|
_INLINE_MATH_RE = re.compile(r'\$[^$]+\$')            # $...$
_DISPLAY_MATH_RE = re.compile(r'^\$\$')                # $$ on its own line


class MarkdownExtractor(BaseDocExtractor):
    """Extract headings and links from markdown files."""

    def extract(self, path, text):
        """Extract document outline from markdown text.

        Args:
            path: file path
            text: full markdown content

        Returns:
            DocOutline with nested headings and links
        """
        lines = text.splitlines()
        flat_headings = []
        all_links = []
        in_fence = False
        fence_marker = None

        for line_num, line in enumerate(lines):
            stripped = line.strip()

            # Track fenced code blocks — skip content inside them
            fence_match = _FENCE_RE.match(stripped)
            if fence_match:
                if not in_fence:
                    in_fence = True
                    fence_marker = fence_match.group(1)[0]  # ` or ~
                elif stripped.startswith(fence_marker):
                    in_fence = False
                    fence_marker = None
                continue

            if in_fence:
                continue

            # Check for heading
            heading_match = _HEADING_RE.match(line)
            if heading_match:
                level = len(heading_match.group(1))
                text_content = heading_match.group(2).strip()
                flat_headings.append(DocHeading(
                    text=text_content,
                    level=level,
                    start_line=line_num,
                ))

            # Extract links from this line
            for link_match in _LINK_RE.finditer(line):
                raw_target = link_match.group(2).strip()
                # Split target into path and heading anchor
                target_heading = ""
                if "#" in raw_target:
                    target_path, target_heading = raw_target.split("#", 1)
                else:
                    target_path = raw_target
                # Find the heading this link is under
                source_heading = ""
                if flat_headings:
                    source_heading = flat_headings[-1].text
                all_links.append(DocLink(
                    target=raw_target,
                    target_heading=target_heading,
                    source_heading=source_heading,
                ))

        # Annotate sections with line counts and content types
        self._annotate_sections(flat_headings, lines)

        # Build nested heading tree
        nested = self._build_heading_tree(flat_headings)

        # Detect document type
        doc_type = self._detect_doc_type(path, flat_headings)

        return DocOutline(
            path=path,
            doc_type=doc_type,
            headings=nested,
            links=all_links,
        )

    def _build_heading_tree(self, flat_headings):
        """Convert flat heading list into nested tree based on levels.

        Each heading's children are headings at deeper levels that appear
        before the next heading at the same or shallower level.
        """
        if not flat_headings:
            return []

        root = []
        stack = []  # (level, heading) — tracks nesting

        for heading in flat_headings:
            # Pop stack until we find a parent at a shallower level
            while stack and stack[-1][0] >= heading.level:
                stack.pop()

            if stack:
                # Add as child of the heading on top of stack
                stack[-1][1].children.append(heading)
            else:
                # Top-level heading
                root.append(heading)

            stack.append((heading.level, heading))

        return root

    def _detect_doc_type(self, path, flat_headings):
        """Detect document type heuristically from path and headings.

        Returns one of: spec, guide, reference, decision, readme, notes, unknown.
        """
        basename = os.path.basename(path).lower()
        dir_parts = os.path.dirname(path).lower().replace("\\", "/")

        # Path-based detection (highest confidence)
        if basename.startswith("readme"):
            return "readme"
        if basename.startswith("adr-"):
            return "decision"

        for keyword in ("spec", "specs", "rfc"):
            if keyword in dir_parts.split("/"):
                return "spec"
        for keyword in ("guide", "tutorial", "howto", "getting-started"):
            if keyword in dir_parts.split("/"):
                return "guide"
        for keyword in ("reference", "api", "endpoints"):
            if keyword in dir_parts.split("/"):
                return "reference"
        for keyword in ("notes", "meeting", "minutes", "journal"):
            if keyword in dir_parts.split("/"):
                return "notes"
        if "decision" in dir_parts.split("/"):
            return "decision"

        # Heading-based detection (fallback)
        heading_texts = {h.text.lower() for h in flat_headings}
        if "status" in heading_texts and "decision" in heading_texts:
            return "decision"

        # Check for numbered headings (spec-like)
        numbered_re = re.compile(r'^\d+[\.\)]')
        if any(numbered_re.match(h.text) for h in flat_headings):
            return "spec"

        return "unknown"

    def _annotate_sections(self, flat_headings, lines):
        """Compute section line counts and detect content types.

        For each heading, the section runs from its start_line to the next
        heading's start_line (or end of file).  Content types are detected
        by scanning for markdown patterns within the section.

        Args:
            flat_headings: list of DocHeading (flat, not nested)
            lines: list of all lines in the document
        """
        total_lines = len(lines)

        for i, heading in enumerate(flat_headings):
            start = heading.start_line
            if i + 1 < len(flat_headings):
                end = flat_headings[i + 1].start_line
            else:
                end = total_lines

            heading.section_lines = max(0, end - start)
            heading.content_types = self._detect_content_types(lines[start:end])

    def _detect_content_types(self, section_lines):
        """Detect content types present in a section's lines.

        Returns a list of unique type strings, e.g. ["table", "code", "formula"].
        """
        types = set()
        in_fence = False

        for line in section_lines:
            stripped = line.strip()

            # Track fenced code blocks
            if _FENCE_RE.match(stripped):
                if not in_fence:
                    in_fence = True
                    types.add("code")
                else:
                    in_fence = False
                continue

            if in_fence:
                continue

            # Table separator row: |---|---|
            if _TABLE_SEP_RE.match(stripped):
                types.add("table")

            # Display math: $$ on its own line
            if _DISPLAY_MATH_RE.match(stripped):
                types.add("formula")
            # Inline math: $...$ (but not $$)
            elif _INLINE_MATH_RE.search(stripped):
                types.add("formula")

        return sorted(types)