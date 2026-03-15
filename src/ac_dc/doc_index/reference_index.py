"""Document reference index — section-level link tracking."""

import re
import logging
from collections import defaultdict
from typing import Optional

from ac_dc.doc_index.models import DocHeading, DocLink, DocOutline, DocSectionRef

logger = logging.getLogger(__name__)


def _heading_anchor(text: str) -> str:
    """Convert heading text to GitHub-style anchor slug."""
    slug = text.lower()
    slug = re.sub(r'[^\w\s-]', '', slug)
    slug = slug.strip().replace(' ', '-')
    return slug


def _flatten_headings(headings: list[DocHeading]) -> list[DocHeading]:
    """Flatten a heading tree into a list."""
    result = []
    stack = list(headings)
    while stack:
        h = stack.pop(0)
        result.append(h)
        stack = list(h.children) + stack
    return result


class DocReferenceIndex:
    """Cross-document reference graph with section-level link tracking.

    Tracks doc↔doc and doc→code links at heading granularity.
    Exposes connected_components() and file_ref_count() for the
    stability tracker (same protocol as symbol ReferenceIndex).
    """

    def __init__(self):
        # heading key = (path, heading_text)
        self._incoming: dict[tuple[str, str], set[tuple[str, str]]] = defaultdict(set)
        self._file_deps: dict[str, set[str]] = defaultdict(set)  # file -> depends on
        self._file_dependents: dict[str, set[str]] = defaultdict(set)  # file -> depended on by
        self._file_ref_counts: dict[str, int] = defaultdict(int)

    def build(self, all_outlines: dict[str, DocOutline]):
        """Build the reference index from all doc outlines.

        Two passes: collect, then resolve.
        """
        self._incoming.clear()
        self._file_deps.clear()
        self._file_dependents.clear()
        self._file_ref_counts.clear()

        # Clear mutable state on headings before rebuilding
        for outline in all_outlines.values():
            for h in _flatten_headings(outline.headings):
                h.outgoing_refs.clear()
                h.incoming_ref_count = 0

        # Build anchor lookup: (path, anchor_slug) -> heading_text
        anchor_lookup: dict[tuple[str, str], str] = {}
        for path, outline in all_outlines.items():
            for h in _flatten_headings(outline.headings):
                slug = _heading_anchor(h.text)
                anchor_lookup[(path, slug)] = h.text

        # Process all links
        for source_path, outline in all_outlines.items():
            for link in outline.links:
                target_path = link.target
                if not target_path:
                    continue

                # Skip external URLs
                if target_path.startswith(("http://", "https://", "data:")):
                    continue

                # Self-references excluded from incoming counts
                if target_path == source_path or target_path == "":
                    continue

                # Resolve target heading
                target_heading_text = None
                if link.target_heading:
                    anchor = _heading_anchor(link.target_heading)
                    resolved = anchor_lookup.get((target_path, anchor))
                    if resolved:
                        target_heading_text = resolved

                # Track file-level dependency
                self._file_deps[source_path].add(target_path)
                self._file_dependents[target_path].add(source_path)

                # Track section-level incoming references
                source_key = (source_path, link.source_heading or "")
                if target_heading_text:
                    target_key = (target_path, target_heading_text)
                else:
                    # Document-level link -> increment top-level heading
                    target_outline = all_outlines.get(target_path)
                    if target_outline and target_outline.headings:
                        target_key = (target_path, target_outline.headings[0].text)
                    else:
                        target_key = (target_path, "")

                self._incoming[target_key].add(source_key)

                # Add outgoing section ref to the source heading
                if link.source_heading:
                    for h in _flatten_headings(outline.headings):
                        if h.text == link.source_heading:
                            h.outgoing_refs.append(DocSectionRef(
                                target_path=target_path,
                                target_heading=target_heading_text,
                            ))
                            break

        # Update incoming ref counts on headings
        for path, outline in all_outlines.items():
            for h in _flatten_headings(outline.headings):
                key = (path, h.text)
                h.incoming_ref_count = len(self._incoming.get(key, set()))

        # Compute file ref counts
        for path in all_outlines:
            self._file_ref_counts[path] = len(self._file_dependents.get(path, set()))

    def incoming_count(self, path: str, heading_text: str) -> int:
        """Number of external sections linking to this heading."""
        return len(self._incoming.get((path, heading_text), set()))

    def file_ref_count(self, path: str) -> int:
        """Incoming reference count for a file."""
        return self._file_ref_counts.get(path, 0)

    def connected_components(self) -> list[list[str]]:
        """Clusters of mutually-linked documents (bidirectional edges)."""
        # Build bidirectional adjacency
        bi_adj: dict[str, set[str]] = defaultdict(set)
        for a, deps in self._file_deps.items():
            for b in deps:
                if b in self._file_deps and a in self._file_deps[b]:
                    bi_adj[a].add(b)
                    bi_adj[b].add(a)

        visited: set[str] = set()
        components: list[list[str]] = []

        for node in bi_adj:
            if node in visited:
                continue
            component = []
            stack = [node]
            while stack:
                n = stack.pop()
                if n in visited:
                    continue
                visited.add(n)
                component.append(n)
                for neighbor in bi_adj[n]:
                    if neighbor not in visited:
                        stack.append(neighbor)
            if component:
                components.append(sorted(component))

        return components