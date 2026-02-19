"""Document outline formatter — compact map output for LLM context.

Produces text blocks structurally similar to code symbol map output.
Headings include KeyBERT keywords in parentheses for disambiguation.
"""

import os
from collections import Counter

DOC_LEGEND = """# Document outline: headings with keywords, links between docs
# ##=heading level (keywords) →target_doc
# links: comma-separated linked documents"""

DOC_LEGEND_WITH_ALIASES = DOC_LEGEND  # aliases appended dynamically


class DocFormatter:
    """Format document outlines into LLM-optimized compact text."""

    def __init__(self, reference_index=None):
        self._ref_index = reference_index
        self._path_aliases = {}

    def get_legend(self):
        """Get the legend text with path aliases."""
        legend = DOC_LEGEND
        for alias, prefix in sorted(self._path_aliases.items()):
            legend += f"\n# {alias}={prefix}"
        return legend

    def format_all(self, all_outlines, exclude_files=None, chunks=1):
        """Format all document outlines into compact text.

        Args:
            all_outlines: dict of {path: DocOutline}
            exclude_files: set of paths to exclude
            chunks: number of chunks to split into

        Returns:
            str or list[str] if chunks > 1
        """
        exclude = set(exclude_files or [])
        paths = sorted(p for p in all_outlines if p not in exclude)

        self._path_aliases = self._compute_aliases(paths)

        blocks = []
        for path in paths:
            outline = all_outlines[path]
            blocks.append(self._format_outline(path, outline))

        if chunks <= 1:
            legend = self.get_legend()
            return legend + "\n\n" + "\n\n".join(blocks)

        chunk_size = max(1, -(-len(blocks) // chunks))
        result = []
        for i in range(0, len(blocks), chunk_size):
            chunk_blocks = blocks[i:i + chunk_size]
            if i == 0:
                result.append(self.get_legend() + "\n\n" + "\n\n".join(chunk_blocks))
            else:
                result.append("\n\n".join(chunk_blocks))
        return result

    def format_file(self, path, outline):
        """Format a single document outline."""
        return self._format_outline(path, outline)

    def _format_outline(self, path, outline):
        """Format a single document outline block."""
        lines = []

        # File header with ref count
        ref_count = self._ref_index.file_ref_count(path) if self._ref_index else 0
        header = self._alias_path(path) + ":"
        if ref_count > 0:
            header += f" ←{ref_count}"
        lines.append(header)

        # Headings (nested via indentation)
        for heading in outline.headings:
            self._format_heading(heading, lines, indent=1)

        # Links summary
        doc_links = self._extract_doc_links(outline)
        if doc_links:
            link_strs = [self._alias_path(l) for l in sorted(doc_links)]
            lines.append(f"  links: {', '.join(link_strs)}")

        return "\n".join(lines)

    def _format_heading(self, heading, lines, indent):
        """Format a heading and its children recursively."""
        prefix = "  " * indent
        hashes = "#" * heading.level

        # Build heading line
        line = f"{prefix}{hashes} {heading.text}"

        # Add keywords if present
        if heading.keywords:
            line += f" ({', '.join(heading.keywords)})"

        lines.append(line)

        # Children
        for child in heading.children:
            self._format_heading(child, lines, indent + 1)

    def _extract_doc_links(self, outline):
        """Extract unique document link targets (non-URL, non-anchor)."""
        targets = set()
        for link in outline.links:
            target = link.target
            # Skip external URLs
            if target.startswith(("http://", "https://", "mailto:", "ftp://")):
                continue
            # Strip anchors
            if "#" in target:
                target = target.split("#")[0]
            if target:
                targets.add(target)
        return targets

    def _compute_aliases(self, paths):
        """Compute path aliases for frequent prefixes."""
        if not paths:
            return {}

        prefix_count = Counter()
        for p in paths:
            parts = p.split("/")
            for i in range(1, len(parts)):
                prefix = "/".join(parts[:i]) + "/"
                prefix_count[prefix] += 1

        aliases = {}
        alias_num = 1
        for prefix, count in prefix_count.most_common(5):
            if count >= 3 and len(prefix) > 5:
                aliases[f"@{alias_num}/"] = prefix
                alias_num += 1

        return aliases

    def _alias_path(self, path):
        """Replace path prefix with alias if available."""
        for alias, prefix in self._path_aliases.items():
            if path.startswith(prefix):
                return alias + path[len(prefix):]
        return path