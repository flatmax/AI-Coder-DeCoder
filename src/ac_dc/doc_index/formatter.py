"""Document index formatter — compact text output for LLM context."""

from typing import Optional

from ac_dc.base_formatter import BaseFormatter
from ac_dc.doc_index.models import DocHeading, DocOutline


class DocFormatter(BaseFormatter):
    """Format DocOutline into compact text for LLM context."""

    def get_legend(self) -> str:
        """Document index legend."""
        lines = [
            "# Headings show document structure with nesting",
            "# (keywords) = section topics  [table][code][formula] = content types",
            "# ~Nln = section size  ←N = incoming refs  →target = outgoing refs",
        ]
        alias_legend = self.format_alias_legend()
        if alias_legend:
            lines.append(alias_legend)
        return "\n".join(lines)

    def format_file(self, path: str, data: object,
                    ref_index=None, **kwargs) -> str:
        """Format a single document's outline."""
        if not isinstance(data, DocOutline):
            return ""

        outline: DocOutline = data
        lines = []

        # Path line with doc type
        display_path = self.alias_path(path)
        type_tag = f" [{outline.doc_type}]" if outline.doc_type != "unknown" else ""
        lines.append(f"{display_path}{type_tag}:")

        # Heading tree
        for heading in outline.headings:
            self._format_heading(heading, lines, ref_index, path)

        # Links summary
        all_targets = []
        seen = set()
        for link in outline.links:
            if link.target and link.target not in seen:
                seen.add(link.target)
                all_targets.append(link.target)
        if all_targets:
            lines.append(f"  links: {', '.join(all_targets)}")

        return "\n".join(lines)

    def format_map(self, all_outlines: dict[str, DocOutline],
                   ref_index=None,
                   exclude_files: Optional[set[str]] = None) -> str:
        """Format the complete document index."""
        exclude_files = exclude_files or set()
        paths = [p for p in all_outlines if p not in exclude_files]
        self.compute_path_aliases(paths)

        parts = []
        for path in sorted(all_outlines.keys()):
            if path in exclude_files:
                continue
            text = self.format_file(path, all_outlines[path], ref_index)
            if text:
                parts.append(text)

        return "\n\n".join(parts)

    def _format_heading(self, heading: DocHeading, lines: list[str],
                        ref_index, doc_path: str):
        """Format a heading and its children recursively."""
        indent = "  " * (heading.level)

        # Keywords
        kw_str = f" ({', '.join(heading.keywords)})" if heading.keywords else ""

        # Content types
        ct_str = ""
        if heading.content_types:
            ct_str = " " + " ".join(f"[{ct}]" for ct in heading.content_types)

        # Section size
        sz_str = f" ~{heading.section_lines}ln" if heading.section_lines >= 5 else ""

        # Incoming ref count
        ref_str = ""
        ref_count = heading.incoming_ref_count
        if ref_index and hasattr(ref_index, "incoming_count"):
            ref_count = ref_index.incoming_count(doc_path, heading.text)
        if ref_count > 0:
            ref_str = f" ←{ref_count}"

        # Heading line
        prefix = "#" * heading.level
        lines.append(f"{indent}{prefix} {heading.text}{kw_str}{ct_str}{sz_str}{ref_str}")

        # Outgoing section refs
        ref_indent = "  " * (heading.level + 1)
        for ref in heading.outgoing_refs:
            if ref.target_heading:
                lines.append(f"{ref_indent}→{ref.target_path}#{ref.target_heading}")
            else:
                lines.append(f"{ref_indent}→{ref.target_path}")

        # Children
        for child in heading.children:
            self._format_heading(child, lines, ref_index, doc_path)