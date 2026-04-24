"""Data model for the document index.

Mirrors :mod:`ac_dc.symbol_index.models` in shape — mutable
dataclasses that the orchestrator treats as read-only snapshots
within a request boundary (D10 contract). The mutability is for
the extraction pass; once an outline is stored in
:attr:`DocIndex._all_outlines`, it is queried but not written.

The model carries three classes of edges:

1. **Document-level links** (``DocLink`` on :attr:`DocOutline.links`)
   — every `[text](path)` or `![alt](path)` match the extractor
   found, with the heading under which the link appears recorded
   for cross-reference context.

2. **Section-level outgoing refs** (``DocSectionRef`` on
   :attr:`DocHeading.outgoing_refs`) — computed by the reference
   index in a second pass from document-level links. Each entry
   says "this heading contains a link to that document's specific
   section".

3. **Incoming ref count** (:attr:`DocHeading.incoming_ref_count`)
   — also computed by the reference index, counting sections in
   other documents that link to this heading.

SVG prose blocks (:class:`DocProseBlock`) are the path for
long-text SVG elements that would otherwise drown out label siblings.
They carry raw text so :mod:`ac_dc.doc_index.keyword_enricher` can
process them alongside markdown sections (2.8.4). The formatter
renders them as ``[prose] (kw1, kw2)`` entries under their
containing heading.

Governing spec: ``specs4/2-indexing/document-index.md``.
"""

from __future__ import annotations

from dataclasses import dataclass, field


# ---------------------------------------------------------------------------
# Outgoing section-level reference
# ---------------------------------------------------------------------------


@dataclass
class DocSectionRef:
    """A heading → heading edge computed by the reference index.

    Distinct from :class:`DocLink` — links are what the extractor
    found verbatim in the source; section refs are the resolved
    form after anchor slugging and target-heading lookup.

    ``target_heading`` is None when the source link was
    document-level (no fragment) — the reference index resolves
    such links to the target document's top-level heading for
    counting purposes but emits a document-only ref here so the
    formatter can render ``→target.md`` rather than
    ``→target.md#None``.
    """

    target_path: str
    target_heading: str | None = None


# ---------------------------------------------------------------------------
# Document-level link
# ---------------------------------------------------------------------------


@dataclass
class DocLink:
    """A link match as found by the extractor.

    ``target`` is the raw href from the source (relative path,
    optional ``#fragment``). The reference index splits it and
    resolves anchors during its build pass.

    ``source_heading`` carries the text of the heading under which
    the link appeared. Empty string when the link sits above the
    first heading (rare but possible — e.g., an ``![alt](logo.svg)``
    at the top of a README before the title).

    ``is_image`` is True for image references (``![alt](path)`` in
    markdown, image path extensions matched in prose, ``<image>``
    / ``<img>`` sources anywhere). The reference index treats them
    identically to regular links — both produce edges in the graph
    — but the flag lets future renderers distinguish them without
    re-parsing the source.
    """

    target: str
    line: int = 0
    source_heading: str = ""
    is_image: bool = False


# ---------------------------------------------------------------------------
# Prose block (SVG long text)
# ---------------------------------------------------------------------------


@dataclass
class DocProseBlock:
    """A long-text SVG element held aside for keyword enrichment.

    Populated by the SVG extractor (2.8.3) for ``<text>`` elements
    that exceed the label-length threshold. Enriched by
    :mod:`ac_dc.doc_index.keyword_enricher` (2.8.4) — keywords land
    in the :attr:`keywords` field and the formatter renders the
    entry as ``[prose] (kw1, kw2, kw3)``.

    Markdown documents do NOT produce prose blocks — their
    equivalent is the text between consecutive headings, which the
    enricher slices directly from the full document text using
    :attr:`DocHeading.start_line`.

    ``container_heading_id`` is the identity of the heading this
    prose sits inside, or None for prose at document root (no
    containing box). Extractor decides what identity to use —
    typically the heading's text, or a positional token for
    unlabeled boxes.
    """

    text: str
    container_heading_id: str | None = None
    start_line: int = 0
    keywords: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Heading
# ---------------------------------------------------------------------------


@dataclass
class DocHeading:
    """One heading in a document outline.

    Trees of headings form the outline structure. A heading's
    :attr:`level` is 1–6 for markdown (H1–H6) or the nesting depth
    for SVG. Nesting is via the :attr:`children` list — the
    extractor rebuilds the tree from level transitions (markdown)
    or box containment (SVG).

    :attr:`keywords` is populated by the keyword enricher in a
    post-extraction pass (2.8.4). Before then, or when the
    enricher is unavailable, the list is empty and the formatter
    omits the parenthetical keyword annotation.

    :attr:`outgoing_refs` is populated by the reference index
    after all documents have been extracted, so the target anchor
    can be resolved against the destination document's heading
    tree. Before that pass, the list is empty.

    :attr:`incoming_ref_count` is also populated by the reference
    index — zero before the pass or for headings with no inbound
    references.

    :attr:`content_types` carries markers detected during
    extraction: ``"table"``, ``"code"``, ``"formula"``. Each marker
    appears at most once per heading regardless of how many
    instances the section contains. Empty list for sections with
    none of the detected content types.

    :attr:`section_lines` is the line count from this heading's
    start line to the next heading's start line (or end of file).
    The formatter omits the annotation below a threshold (default
    5 lines) to reduce noise on trivially short sections.

    :attr:`start_line` is 1-indexed — matches the convention used
    elsewhere in the codebase (Monaco, symbol index LSP variant).
    The keyword enricher uses adjacent headings' start lines to
    slice section text from the full document.
    """

    text: str
    level: int
    start_line: int = 0
    section_lines: int = 0
    keywords: list[str] = field(default_factory=list)
    content_types: list[str] = field(default_factory=list)
    children: list[DocHeading] = field(default_factory=list)
    outgoing_refs: list[DocSectionRef] = field(default_factory=list)
    incoming_ref_count: int = 0


# ---------------------------------------------------------------------------
# Outline (per-file top-level)
# ---------------------------------------------------------------------------


# Valid doc_type values. The detector produces one of these
# strings; callers treat "unknown" as the neutral default. Tuple
# rather than Enum to keep wire-format cheap (strings round-trip
# through JSON sidecars without custom encoding).
DOC_TYPES: tuple[str, ...] = (
    "readme",
    "spec",
    "guide",
    "reference",
    "decision",
    "notes",
    "unknown",
)


@dataclass
class DocOutline:
    """Per-file extraction result — the top-level outline object.

    The orchestrator stores one :class:`DocOutline` per indexed
    file in its ``_all_outlines`` dict, keyed by repo-relative
    path. Reads (map rendering, per-file block lookup, reference
    graph build) treat the stored outline as read-only.

    :attr:`file_path` matches the dict key — redundancy is
    deliberate, matches :class:`ac_dc.symbol_index.models.FileSymbols`
    convention so outlines are self-describing if serialized
    independently.

    :attr:`doc_type` is one of the :data:`DOC_TYPES` strings. The
    heuristic detector produces ``"unknown"`` when no signal
    matches — this is fine, the type annotation is a hint for the
    LLM, not a gate.

    :attr:`headings` is the top-level heading list. Nested
    headings live under their parent's :attr:`DocHeading.children`.
    A document with no headings has an empty list.

    :attr:`links` is every link the extractor found, in document
    order. The reference index reads this directly to build the
    graph.

    :attr:`prose_blocks` is SVG-only. Markdown extractors leave it
    empty.
    """

    file_path: str
    doc_type: str = "unknown"
    headings: list[DocHeading] = field(default_factory=list)
    links: list[DocLink] = field(default_factory=list)
    prose_blocks: list[DocProseBlock] = field(default_factory=list)

    @property
    def all_headings_flat(self) -> list[DocHeading]:
        """Return every heading in document order, flattened.

        Used by the reference index (to walk every heading when
        resolving outgoing links) and by the keyword enricher (to
        walk every section for batched extraction). The recursion
        is simple because heading trees are shallow — H1..H6 means
        maximum depth 6, typically 2–3 in practice.
        """
        result: list[DocHeading] = []

        def _walk(headings: list[DocHeading]) -> None:
            for h in headings:
                result.append(h)
                if h.children:
                    _walk(h.children)

        _walk(self.headings)
        return result