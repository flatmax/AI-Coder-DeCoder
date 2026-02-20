"""SVG document extractor — extracts text content, titles, and structure.

Uses stdlib xml.etree.ElementTree. No external dependencies.
Extracts: <title>, <desc>, <text>/<tspan> content, <g> group labels,
and <a> links for cross-references.
"""

import logging
import xml.etree.ElementTree as ET

from .base import BaseDocExtractor, DocHeading, DocLink, DocOutline

logger = logging.getLogger(__name__)

# SVG namespace
_SVG_NS = "http://www.w3.org/2000/svg"
_XLINK_NS = "http://www.w3.org/1999/xlink"
_INKSCAPE_NS = "http://www.inkscape.org/namespaces/inkscape"

# Tags we extract text from (with and without namespace)
_TEXT_TAGS = {
    "text", f"{{{_SVG_NS}}}text",
}
_TSPAN_TAGS = {
    "tspan", f"{{{_SVG_NS}}}tspan",
}
_TITLE_TAGS = {
    "title", f"{{{_SVG_NS}}}title",
}
_DESC_TAGS = {
    "desc", f"{{{_SVG_NS}}}desc",
}
_GROUP_TAGS = {
    "g", f"{{{_SVG_NS}}}g",
}
_LINK_TAGS = {
    "a", f"{{{_SVG_NS}}}a",
}


def _get_text_content(el):
    """Recursively extract all text from an element and its children."""
    parts = []
    if el.text and el.text.strip():
        parts.append(el.text.strip())
    for child in el:
        child_text = _get_text_content(child)
        if child_text:
            parts.append(child_text)
        if child.tail and child.tail.strip():
            parts.append(child.tail.strip())
    return " ".join(parts)


def _get_group_label(el):
    """Get a human-readable label for a <g> element."""
    # Try common labelling attributes
    for attr in ("id", "aria-label",
                 f"{{{_INKSCAPE_NS}}}label",
                 "data-label", "data-name"):
        val = el.get(attr)
        if val and not val.startswith("__"):
            return val
    return None


class SvgExtractor(BaseDocExtractor):
    """Extract document outline from SVG files.

    Produces a DocOutline with:
    - <title> as the top-level heading
    - <desc> as a sub-heading with description text
    - <text> elements as leaf headings (the visible labels/annotations)
    - <g> groups with labels as structural headings containing their text children
    - <a> links as DocLinks for cross-reference tracking
    """

    def extract(self, path, text, repo_files=None):
        """Extract document outline from SVG content.

        Args:
            path: file path (relative to repo root)
            text: full SVG content as string
            repo_files: unused (accepted for interface compatibility)

        Returns:
            DocOutline
        """
        try:
            root = ET.fromstring(text)
        except ET.ParseError:
            logger.warning("Failed to parse SVG: %s", path)
            return DocOutline(path=path)

        headings = []
        links = []
        seen_texts = set()  # deduplicate identical labels

        # Extract top-level <title> and <desc>
        title_text = self._find_direct_meta(root, _TITLE_TAGS)
        desc_text = self._find_direct_meta(root, _DESC_TAGS)

        if title_text:
            headings.append(DocHeading(
                text=title_text, level=1, start_line=0,
            ))
            seen_texts.add(title_text)

        if desc_text:
            headings.append(DocHeading(
                text=desc_text, level=2, start_line=0,
            ))
            seen_texts.add(desc_text)

        # Walk the tree for groups, text elements, and links
        self._walk(root, headings, links, seen_texts, depth=2)

        # If no title was found, synthesise one from the filename
        if not headings:
            name = path.rsplit("/", 1)[-1] if "/" in path else path
            headings.append(DocHeading(
                text=name, level=1, start_line=0,
            ))

        # Build a simple nested structure:
        # title (level 1) contains everything else
        if len(headings) > 1 and headings[0].level == 1:
            top = headings[0]
            for h in headings[1:]:
                top.children.append(h)
            headings = [top]

        return DocOutline(path=path, headings=headings, links=links)

    def _find_direct_meta(self, root, tag_set):
        """Find a direct child matching tag_set and return its text."""
        for child in root:
            if child.tag in tag_set:
                text = _get_text_content(child)
                if text:
                    return text
        return None

    def _walk(self, el, headings, links, seen_texts, depth):
        """Recursively walk SVG tree extracting structure."""
        for child in el:
            tag = child.tag

            # Skip defs, style, script — no visible content
            local = tag.split("}")[-1] if "}" in tag else tag
            if local in ("defs", "style", "script", "metadata"):
                continue

            # Links
            if tag in _LINK_TAGS:
                href = (child.get("href")
                        or child.get(f"{{{_XLINK_NS}}}href")
                        or "")
                if href and not href.startswith("#"):
                    link_text = _get_text_content(child)
                    current_heading = headings[-1].text if headings else ""
                    links.append(DocLink(
                        target=href,
                        source_heading=current_heading,
                    ))
                # Still walk inside <a> for text content
                self._walk(child, headings, links, seen_texts, depth)
                continue

            # Groups with labels become structural headings
            if tag in _GROUP_TAGS:
                label = _get_group_label(child)
                if label and label not in seen_texts:
                    seen_texts.add(label)
                    group_heading = DocHeading(
                        text=label, level=min(depth, 6), start_line=0,
                    )
                    # Collect text children inside this group
                    group_texts = []
                    self._collect_texts(child, group_texts, seen_texts)
                    for gt in group_texts:
                        group_heading.children.append(DocHeading(
                            text=gt, level=min(depth + 1, 6),
                            start_line=0,
                        ))
                    headings.append(group_heading)
                else:
                    # Unlabelled group — walk children directly
                    self._walk(child, headings, links, seen_texts, depth)
                continue

            # Text elements
            if tag in _TEXT_TAGS:
                text = _get_text_content(child)
                if text and text not in seen_texts:
                    seen_texts.add(text)
                    headings.append(DocHeading(
                        text=text, level=min(depth, 6),
                        start_line=0,
                    ))
                continue

            # Title/desc nested inside elements (not top-level)
            if tag in _TITLE_TAGS or tag in _DESC_TAGS:
                continue  # already handled at top level

            # Recurse into other elements
            self._walk(child, headings, links, seen_texts, depth)

    def _collect_texts(self, el, texts, seen_texts):
        """Collect all text content from descendants of an element."""
        for child in el:
            tag = child.tag
            if tag in _TEXT_TAGS:
                text = _get_text_content(child)
                if text and text not in seen_texts:
                    seen_texts.add(text)
                    texts.append(text)
            else:
                local = tag.split("}")[-1] if "}" in tag else tag
                if local not in ("defs", "style", "script", "metadata"):
                    self._collect_texts(child, texts, seen_texts)