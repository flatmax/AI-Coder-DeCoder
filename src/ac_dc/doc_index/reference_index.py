"""Document cross-reference index — doc↔doc and doc→code link tracking.

Tracks three types of links:
- Doc → Doc: [link](other.md)
- Doc → Code: [context](../src/context.py)
- Code files appear as leaf nodes (no outgoing edges)

Exposes connected_components() and file_ref_count() for StabilityTracker
compatibility — same protocol as symbol_index/reference_index.py.
"""

import logging
import os
from collections import defaultdict

logger = logging.getLogger(__name__)


class DocReferenceIndex:
    """Tracks cross-file references extracted from document links."""

    def __init__(self):
        self._file_refs = defaultdict(set)   # target -> set of source files
        self._file_deps = defaultdict(set)   # source -> set of target files

    def build(self, all_outlines, repo_root=None):
        """Build reference index from all document outlines.

        Args:
            all_outlines: dict of {path: DocOutline}
            repo_root: optional repo root path for resolving relative links
        """
        self._file_refs.clear()
        self._file_deps.clear()

        known_files = set(all_outlines.keys())

        for source_path, outline in all_outlines.items():
            for link in outline.links:
                target = self._resolve_link(link.target, source_path, repo_root)
                if target and target != source_path:
                    self._file_refs[target].add(source_path)
                    self._file_deps[source_path].add(target)

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