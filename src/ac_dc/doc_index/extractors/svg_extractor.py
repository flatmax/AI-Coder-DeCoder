"""SVG document extractor — stdlib xml.etree, no external dependencies."""

import xml.etree.ElementTree as ET
from typing import Optional

from ac_dc.doc_index.models import DocHeading, DocLink, DocOutline
from ac_dc.doc_index.extractors.base import BaseDocExtractor

# SVG and common namespaces
_NS = {
    "svg": "http://www.w3.org/2000/svg",
    "xlink": "http://www.w3.org/1999/xlink",
    "inkscape": "http://www.inkscape.org/namespaces/inkscape",
}

# Elements to skip
_SKIP_TAGS = {"defs", "style", "script", "metadata"}


class SvgExtractor(BaseDocExtractor):
    """Extract structural outline from SVG files."""

    def extract(self, path: str, content: str) -> DocOutline:
        try:
            root = ET.fromstring(content)
        except ET.ParseError:
            return DocOutline(path=path, doc_type="unknown")

        headings = []
        links = []
        seen_texts: set[str] = set()

        # Process top-level elements
        self._walk(root, headings, links, seen_texts, level=1)

        return DocOutline(
            path=path, doc_type="unknown",
            headings=headings, links=links,
        )

    def _walk(self, element, headings: list[DocHeading], links: list[DocLink],
              seen_texts: set[str], level: int):
        """Recursively walk SVG DOM."""
        tag = self._local_tag(element.tag)

        if tag in _SKIP_TAGS:
            return

        # <title> -> top-level heading
        if tag == "title":
            text = (element.text or "").strip()
            if text and text not in seen_texts:
                seen_texts.add(text)
                headings.append(DocHeading(text=text, level=1))

        # <desc> -> description heading
        elif tag == "desc":
            text = (element.text or "").strip()
            if text and text not in seen_texts:
                seen_texts.add(text)
                headings.append(DocHeading(text=text, level=2))

        # <text>/<tspan> -> leaf headings
        elif tag in ("text", "tspan"):
            text = self._get_all_text(element).strip()
            if text and text not in seen_texts:
                seen_texts.add(text)
                headings.append(DocHeading(text=text, level=3))
            # Don't recurse into tspan children (already got all text)
            self._extract_links_from(element, links)
            return

        # <g> groups with labels -> structural headings
        elif tag == "g":
            label = (
                element.get("id") or
                element.get("aria-label") or
                element.get(f'{{{_NS["inkscape"]}}}label')
            )
            if label and label not in seen_texts:
                seen_texts.add(label)
                group_heading = DocHeading(text=label, level=2)
                headings.append(group_heading)

        # <a> links
        elif tag == "a":
            href = (
                element.get("href") or
                element.get(f'{{{_NS["xlink"]}}}href') or ""
            )
            if href and not href.startswith("#"):
                links.append(DocLink(target=href, is_image=False))

        # Recurse
        for child in element:
            self._walk(child, headings, links, seen_texts, level + 1)

    def _extract_links_from(self, element, links: list[DocLink]):
        """Extract links from an element and its children."""
        for child in element.iter():
            tag = self._local_tag(child.tag)
            if tag == "a":
                href = (
                    child.get("href") or
                    child.get(f'{{{_NS["xlink"]}}}href') or ""
                )
                if href and not href.startswith("#"):
                    links.append(DocLink(target=href, is_image=False))

    def _get_all_text(self, element) -> str:
        """Get concatenated text from an element and its children."""
        parts = []
        if element.text:
            parts.append(element.text)
        for child in element:
            parts.append(self._get_all_text(child))
            if child.tail:
                parts.append(child.tail)
        return " ".join(parts)

    @staticmethod
    def _local_tag(tag: str) -> str:
        """Strip namespace from a tag name."""
        if "}" in tag:
            return tag.split("}")[1]
        return tag