"""Doc formatter — the document map rendered for the LLM.

Concrete :class:`~ac_dc.base_formatter.BaseFormatter` subclass
that turns a list of :class:`~ac_dc.doc_index.models.DocOutline`
into the token-efficient text format documented in
``specs4/2-indexing/document-index.md#compact-output-format``.

Output shape per file::

    path [doc_type]:
      # Top Heading (kw1, kw2) [table] ~45ln ←3
        →other.md#Linked-Section
      ## Sub Heading (kw3) ~12ln
      ## Another Sub (kw4) [code] [formula]
      links: other.md, diagram.svg

Annotation order on each heading:

1. Keywords in parentheses (omitted when empty — 2.8.1
   produces no keywords, 2.8.4 fills them in)
2. Content types in bracketed tags (``[table]``, ``[code]``,
   ``[formula]``)
3. Section size ``~Nln`` (omitted below
   :data:`_SIZE_OMIT_THRESHOLD` lines)
4. Incoming ref count ``←N`` (omitted when zero)

Outgoing section refs from a heading render as indented
child lines, one level deeper than the heading. Prefixed
with ``→`` to distinguish from actual child headings.

Design notes pinned by specs4 and the test suite:

- **Inherits from BaseFormatter.** Same path-alias computation
  and legend block shape as :class:`CompactFormatter`.
- **Reads incoming counts from headings directly.** The doc
  reference index mutates
  :attr:`DocHeading.incoming_ref_count` in place, so the
  formatter doesn't need a separate reference-index argument.
  The ``ref_index`` parameter on :meth:`_format_file` is
  accepted for base-class compatibility but unused.
- **Per-call outline lookup.** :meth:`format_files` stashes
  outlines in ``_current_by_path`` so :meth:`_format_file`
  can look them up by path string. Matches the pattern used
  by :class:`CompactFormatter`.
- **Heading indent uses markdown-style level prefixes.**
  Level 1 → ``# Heading``, level 2 → ``## Heading``, etc.
  Two-space base indent per nesting level in addition to
  the ``#`` prefix, matching the symbol formatter's
  two-space nesting indent.
- **Image links in the ``links:`` summary.** Not
  distinguished from text links in the output — both
  appear in the deduplicated list. The formatter's job is
  compact output; the index flag is for other consumers.
- **Deterministic output.** Same input produces byte-identical
  output. Deduplication preserves first-seen order for
  links (consistent with
  :class:`CompactFormatter`'s call-site dedup).

Governing spec: ``specs4/2-indexing/document-index.md``
§ Compact Output Format.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Iterable

from ac_dc.base_formatter import BaseFormatter

if TYPE_CHECKING:
    from ac_dc.doc_index.models import DocHeading, DocOutline
    from ac_dc.symbol_index.reference_index import ReferenceIndex


# Headings whose section_lines is below this threshold don't
# get the ``~Nln`` annotation. Section sizes of 1–4 lines are
# trivially short — the annotation would add tokens without
# adding information (the LLM can see the heading is a leaf).
# Spec pins this as "omitted for sections under 5 lines".
_SIZE_OMIT_THRESHOLD = 5


class DocFormatter(BaseFormatter):
    """Render DocOutlines as the compact doc map.

    Usage mirrors :class:`CompactFormatter`: construct once,
    reuse across calls. Not thread-safe — a single instance
    can't render two maps concurrently (the per-call outline
    lookup dict would collide).
    """

    def __init__(self) -> None:
        # Populated per format_files call so _format_file can
        # look up the DocOutline for each path. Drops references
        # on exit so cached outlines don't linger beyond the
        # caller's expected lifetime.
        self._current_by_path: dict[str, "DocOutline"] = {}

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def format_files(
        self,
        outlines: Iterable["DocOutline"],
        ref_index: "ReferenceIndex | None" = None,
        exclude_files: set[str] | None = None,
    ) -> str:
        """Render the map for an iterable of DocOutline.

        ``ref_index`` is accepted for signature symmetry with
        :meth:`CompactFormatter.format_files` but unused —
        incoming counts live on the headings themselves,
        populated by :class:`DocReferenceIndex.build`.
        """
        outline_list = list(outlines)
        self._current_by_path = {
            o.file_path: o for o in outline_list
        }
        try:
            return self.format(
                (o.file_path for o in outline_list),
                ref_index=ref_index,
                exclude_files=exclude_files,
            )
        finally:
            # Drop references so the dict doesn't pin outlines.
            self._current_by_path = {}

    def get_legend(
        self,
        files: Iterable[str] | None = None,
    ) -> str:
        """Return the legend block.

        Overridden for test ergonomics — callers typically
        want ``get_legend()`` with no argument to probe the
        legend text without constructing a file list.
        """
        return super().get_legend(files)

    # ------------------------------------------------------------------
    # Legend — doc-specific abbreviation key
    # ------------------------------------------------------------------

    def _legend(self) -> str:
        """Doc-specific annotation markers.

        Kind codes aren't needed — doc outlines are just
        headings (``#``..``######``) and the ``→`` / ``←N`` /
        ``~Nln`` / ``(kw)`` / ``[type]`` markers. The ``#``
        symbols are standard markdown and self-documenting;
        the legend describes only the custom markers.

        Like :class:`CompactFormatter._legend`, keeps the
        ``→`` and ``←`` glyphs out of documentation text —
        they appear only in rendered heading lines. This
        ensures tests using `next(line for line in result
        if "→" in line)` find the intended content line
        rather than a legend line.
        """
        return (
            "# doc outline: indented headings (# H1, ## H2, ...)\n"
            "# (kw1,kw2)=keywords [table]=table [code]=code "
            "[formula]=math\n"
            "# ~Nln=section line count N=refs "
            "links:=document-level link targets"
        )

    # ------------------------------------------------------------------
    # Per-file block rendering
    # ------------------------------------------------------------------

    def _format_file(
        self,
        path: str,
        aliases: dict[str, str],
        ref_index: "ReferenceIndex | None",
    ) -> str:
        """Render one outline's compact block.

        The ``ref_index`` parameter is unused — see class
        docstring. Accepting it keeps the subclass compatible
        with the base class signature.
        """
        # ref_index intentionally unused — accepted for
        # base-class signature compatibility.
        del ref_index

        outline = self._current_by_path.get(path)
        if outline is None:
            # Shouldn't happen — format_files populates the
            # dict with every path. Defensive return keeps
            # us total rather than raising on a caller bug.
            return ""

        aliased_path = self._apply_aliases(path, aliases)
        lines: list[str] = []

        # Header line: path, optional doc_type, colon.
        # doc_type "unknown" is omitted because it conveys
        # no information — every unclassified file would
        # otherwise get the same noise tag.
        if outline.doc_type and outline.doc_type != "unknown":
            lines.append(f"{aliased_path} [{outline.doc_type}]:")
        else:
            lines.append(f"{aliased_path}:")

        # Heading tree — recurse through each top-level
        # heading and its children.
        for heading in outline.headings:
            self._append_heading_lines(
                heading,
                lines,
                depth=0,
                aliases=aliases,
            )

        # Document-level links summary. Dedupe preserving
        # first-seen order so re-renders of the same
        # outline produce byte-identical output.
        targets = self._collect_link_targets(outline, aliases)
        if targets:
            lines.append(f"  links: {', '.join(targets)}")

        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Heading rendering (recursive)
    # ------------------------------------------------------------------

    def _append_heading_lines(
        self,
        heading: "DocHeading",
        lines: list[str],
        depth: int,
        aliases: dict[str, str],
    ) -> None:
        """Render a heading and its children into ``lines``.

        ``depth`` drives the two-space indent per nesting
        level. Outgoing section refs render after the
        heading's own line, indented one level deeper than
        the heading. Child headings render after the
        outgoing refs so the tree reads in natural order:
        heading → its refs → its children.
        """
        indent = "  " * depth
        # Level prefix — one ``#`` per level. Level 1 → ``#``,
        # level 2 → ``##``, etc. Capped at 6 defensively (HTML
        # only defines H1..H6; the extractor shouldn't produce
        # deeper but SVG extractor might via container nesting).
        level_marker = "#" * max(1, min(heading.level, 6))

        annotations = self._render_annotations(heading)
        if annotations:
            lines.append(
                f"{indent}{level_marker} {heading.text}"
                f" {annotations}"
            )
        else:
            lines.append(f"{indent}{level_marker} {heading.text}")

        # Outgoing section refs, indented one level deeper
        # than the heading. Rendered in encounter order.
        child_indent = "  " * (depth + 1)
        for ref in heading.outgoing_refs:
            target = self._apply_aliases(ref.target_path, aliases)
            if ref.target_heading:
                lines.append(f"{child_indent}→{target}#{ref.target_heading}")
            else:
                lines.append(f"{child_indent}→{target}")

        # Nested child headings.
        for child in heading.children:
            self._append_heading_lines(
                child,
                lines,
                depth=depth + 1,
                aliases=aliases,
            )

    # ------------------------------------------------------------------
    # Per-heading annotation assembly
    # ------------------------------------------------------------------

    @staticmethod
    def _render_annotations(heading: "DocHeading") -> str:
        """Assemble the trailing annotations for a heading line.

        Order (matches specs4):

        1. Keywords in parens
        2. Content types as bracketed tags (one per type)
        3. Section size ``~Nln`` (omitted below threshold)
        4. Incoming ref count ``←N`` (omitted when zero)

        Returns empty string when no annotations apply, so
        the caller can avoid appending a trailing space.
        """
        parts: list[str] = []

        # Keywords. 2.8.1 produces no keywords (the field is
        # always empty); 2.8.4's enricher fills it.
        if heading.keywords:
            parts.append(f"({', '.join(heading.keywords)})")

        # Content types. One bracketed tag per type. Preserved
        # in extractor-detected order; deduplicated at
        # extraction time via DocHeading.content_types's list
        # semantics (the markdown extractor appends only if
        # not already present).
        for content_type in heading.content_types:
            parts.append(f"[{content_type}]")

        # Section size.
        if heading.section_lines >= _SIZE_OMIT_THRESHOLD:
            parts.append(f"~{heading.section_lines}ln")

        # Incoming refs.
        if heading.incoming_ref_count > 0:
            parts.append(f"←{heading.incoming_ref_count}")

        return " ".join(parts)

    # ------------------------------------------------------------------
    # Document-level link summary
    # ------------------------------------------------------------------

    @staticmethod
    def _collect_link_targets(
        outline: "DocOutline",
        aliases: dict[str, str],
    ) -> list[str]:
        """Return dedup'd, alias-applied link targets in first-seen order.

        Matches the code formatter's dedup convention — a set
        would lose order across Python runs due to hash
        randomization, so we use a seen-set plus ordered
        list. The dedup key is the raw target (before alias
        application) so two links to the same target with
        different source headings collapse to one entry.
        """
        seen: set[str] = set()
        targets: list[str] = []
        for link in outline.links:
            # Strip fragment for the document-level summary —
            # the heading-level refs render separately. We
            # dedupe on the path portion so two links to
            # different sections of the same target file
            # produce one entry in ``links:`` (they do produce
            # separate ``→target#section`` entries under their
            # source headings).
            target_path = link.target.split("#", 1)[0]
            if not target_path:
                # Fragment-only target — it's an in-page anchor,
                # doesn't belong in the cross-document summary.
                continue
            if target_path in seen:
                continue
            seen.add(target_path)
            targets.append(
                DocFormatter._apply_aliases(target_path, aliases)
            )
        return targets