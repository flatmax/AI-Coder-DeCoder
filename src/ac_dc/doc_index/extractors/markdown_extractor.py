"""Markdown document extractor — regex-based heading and link extraction.

No external dependencies. Handles ATX headings (# prefix) and
[text](target) links.
"""

import re

from .base import BaseDocExtractor, DocHeading, DocLink, DocOutline

# ATX heading: one or more # at start of line, followed by space and text
_HEADING_RE = re.compile(r'^(#{1,6})\s+(.+?)(?:\s+#+\s*)?$')

# Markdown links: [text](target) — excludes images ![alt](src)
_LINK_RE = re.compile(r'(?<!!)\[([^\]]+)\]\(([^)]+)\)')

# Fenced code block markers
_FENCE_RE = re.compile(r'^(`{3,}|~{3,})')


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
                target = link_match.group(2).strip()
                # Find the heading this link is under
                source_heading = ""
                if flat_headings:
                    source_heading = flat_headings[-1].text
                all_links.append(DocLink(
                    target=target,
                    source_heading=source_heading,
                ))

        # Build nested heading tree
        nested = self._build_heading_tree(flat_headings)

        return DocOutline(
            path=path,
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