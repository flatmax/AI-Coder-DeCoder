"""Document cross-reference index — doc↔doc and doc→code link tracking.

Tracks links at section granularity:
- Doc section → Doc section: [link](other.md#Section-Heading)
- Doc section → Doc: [link](other.md)
- Doc → Code: [context](../src/context.py)
- Code files appear as leaf nodes (no outgoing edges)

Populates incoming_ref_count on DocHeading objects and outgoing_refs
lists for section-level cross-reference annotations in the compact output.

Exposes connected_components() and file_ref_count() for StabilityTracker
compatibility — same protocol as symbol_index/reference_index.py.
"""

import logging
import os
import re
from collections import defaultdict

from .extractors.base import DocSectionRef

logger = logging.getLogger(__name__)

# GitHub-style anchor slugging: lowercase, spaces→hyphens, strip punctuation
_SLUG_RE = re.compile(r'[^\w\s-]', re.UNICODE)
_SPACE_RE = re.compile(r'[\s]+')


def _slugify(text):
    """Convert heading text to GitHub-style anchor slug."""
    slug = text.lower()
    slug = _SLUG_RE.sub('', slug)
    slug = _SPACE_RE.sub('-', slug).strip('-')
    return slug


class DocReferenceIndex:
    """Tracks cross-file references extracted from document links.

    Two-pass build:
    1. Collect all links with source/target heading context
    2. Resolve target heading anchors and populate incoming_ref_count
       and outgoing_refs on DocHeading objects
    """

    def __init__(self):
        self._file_refs = defaultdict(set)   # target_file -> set of source files
        self._file_deps = defaultdict(set)   # source_file -> set of target files
        # Dedup set: (source_path, source_heading, target_file, target_slug)
        self._seen_section_refs = set()

    def build(self, all_outlines, repo_root=None):
        """Build reference index from all document outlines.

        Two-pass build:
        1. Collect links and build file-level graph
        2. Resolve heading anchors and populate section-level refs

        Args:
            all_outlines: dict of {path: DocOutline}
            repo_root: optional repo root path for resolving relative links
        """
        self._file_refs.clear()
        self._file_deps.clear()
        self._seen_section_refs.clear()

        # Build heading slug lookup: {path: {slug: DocHeading}}
        heading_lookup = {}
        for path, outline in all_outlines.items():
            slugs = {}
            for h in outline.all_headings_flat:
                slug = _slugify(h.text)
                if slug and slug not in slugs:
                    slugs[slug] = h
                # Reset ref counts from previous builds
                h.incoming_ref_count = 0
                h.outgoing_refs = []
            heading_lookup[path] = slugs

        # Pass 1: Collect links and build file-level + section-level graph
        # Collect raw links for pass 2 resolution
        raw_links = []  # (source_path, source_heading_text, target_file, target_anchor, link)

        for source_path, outline in all_outlines.items():
            for link in outline.links:
                # Resolve file-level target
                raw_target = link.target
                # Strip anchor for file resolution
                if "#" in raw_target:
                    target_file_part = raw_target.split("#")[0]
                    target_anchor = link.target_heading
                else:
                    target_file_part = raw_target
                    target_anchor = ""

                target_file = self._resolve_link(
                    target_file_part if target_file_part else raw_target,
                    source_path, repo_root
                )
                if not target_file or target_file == source_path:
                    continue

                # File-level graph
                self._file_refs[target_file].add(source_path)
                self._file_deps[source_path].add(target_file)

                raw_links.append((
                    source_path,
                    link.source_heading,
                    target_file,
                    target_anchor,
                    link,
                ))

        # Pass 2: Resolve heading anchors and populate section-level refs
        for source_path, source_heading_text, target_file, target_anchor, link in raw_links:
            target_slug = _slugify(target_anchor) if target_anchor else ""

            # Deduplicate: same source section → same target section
            dedup_key = (source_path, source_heading_text, target_file, target_slug)
            if dedup_key in self._seen_section_refs:
                continue
            self._seen_section_refs.add(dedup_key)

            # Resolve target heading
            resolved_heading = None
            if target_slug and target_file in heading_lookup:
                resolved_heading = heading_lookup[target_file].get(target_slug)

            # Increment incoming_ref_count on target heading
            if resolved_heading:
                resolved_heading.incoming_ref_count += 1
            elif target_file in heading_lookup:
                # No specific heading — increment on first H1
                target_outlines = all_outlines.get(target_file)
                if target_outlines and target_outlines.headings:
                    target_outlines.headings[0].incoming_ref_count += 1

            # Build outgoing_ref on source heading
            if source_heading_text and source_path in all_outlines:
                source_outline = all_outlines[source_path]
                source_heading_obj = self._find_heading_by_text(
                    source_outline, source_heading_text
                )
                if source_heading_obj:
                    ref = DocSectionRef(
                        target_path=target_file,
                        target_heading=target_anchor if resolved_heading else "",
                    )
                    source_heading_obj.outgoing_refs.append(ref)

    @staticmethod
    def _find_heading_by_text(outline, heading_text):
        """Find a heading in an outline by its text."""
        for h in outline.all_headings_flat:
            if h.text == heading_text:
                return h
        return None

    def _resolve_link(self, target, source_path, repo_root):
        """Resolve a link target to a repo-relative path.

        Handles relative paths, strips anchors (#section), ignores URLs.
        """
        # Skip external URLs
        if target.startswith(("http://", "https://", "mailto:", "ftp://")):
            return None

        # Strip anchor fragments
        if "#" in target:
            target = target.split("#")[0]
        if not target:
            return None

        # Resolve relative to source file's directory
        source_dir = os.path.dirname(source_path)
        resolved = os.path.normpath(os.path.join(source_dir, target))

        # Normalize separators
        resolved = resolved.replace("\\", "/")

        # Block path traversal outside repo
        if resolved.startswith(".."):
            return None

        return resolved

    # === Protocol methods for StabilityTracker compatibility ===

    def file_ref_count(self, file_path):
        """Incoming reference count for a file."""
        return len(self._file_refs.get(file_path, set()))

    def reference_count(self, file_path):
        """Alias for file_ref_count (compatibility)."""
        return self.file_ref_count(file_path)

    def connected_components(self):
        """Find clusters of coupled files via bidirectional edges.

        Two files are bidirectionally connected if A links to B and B links to A.
        """
        edges = self._bidirectional_edges()
        if not edges:
            return []

        adj = defaultdict(set)
        for a, b in edges:
            adj[a].add(b)
            adj[b].add(a)

        visited = set()
        components = []

        for node in adj:
            if node in visited:
                continue
            component = set()
            stack = [node]
            while stack:
                current = stack.pop()
                if current in visited:
                    continue
                visited.add(current)
                component.add(current)
                stack.extend(adj[current] - visited)
            if component:
                components.append(component)

        return components

    def _bidirectional_edges(self):
        """Find mutually-linked file pairs."""
        edges = set()
        for file_a, deps in self._file_deps.items():
            for file_b in deps:
                if file_a in self._file_deps.get(file_b, set()):
                    pair = tuple(sorted([file_a, file_b]))
                    edges.add(pair)
        return edges

    def files_referencing(self, file_path):
        """Set of files that link to this file."""
        return self._file_refs.get(file_path, set())

    def file_dependencies(self, file_path):
        """Set of files this file links to."""
        return self._file_deps.get(file_path, set())