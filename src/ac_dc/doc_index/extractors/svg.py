"""SVG extractor — Layer 2.8.3e (containment-aware + prose blocks).

Builds a containment tree from shape bounding boxes and attaches
text elements to their smallest containing box. Three-level
labeling picks box headings from explicit labels, single-text
inference, or neutral identifiers. Long text elements (exceeding
the label threshold) become :class:`DocProseBlock` entries for
keyword enrichment (2.8.4).

Covers:

- ``<title>`` → top-level heading
- ``<desc>`` → level-2 heading under the document root
- ``<a xlink:href=...>`` → ``DocLink`` entry
- **Containment tree** — shapes (rect, circle, ellipse, polygon,
  path) form a nesting hierarchy; text elements attach to the
  smallest containing box
- **Three-level labeling** — explicit group label → single-text
  inference → neutral identifier
- **Auto-id filtering** — Inkscape-style ``g123`` / ``Group_42``
  ids are treated as if no id were set
- **Reading order** — y-then-x sort at each nesting level
- **Shape-less fallback** — spatial clustering when no shapes
  are present (text-only SVGs)
- **Long-text prose blocks** — text elements exceeding the label
  threshold become :class:`DocProseBlock` entries attached to
  the containing shape (or document root)
- Text label deduplication
- Non-visual element filtering

Uses stdlib ``xml.etree.ElementTree`` only — no external XML
dependencies. Parse failures are caught and produce an empty
outline rather than propagating: an unparseable SVG should not
take down indexing of the rest of the repo.

Keyword enrichment (2.8.4) consumes ``outline.prose_blocks`` to
populate each block's ``keywords`` field. The enricher and this
extractor share one threshold — :data:`_LONG_TEXT_THRESHOLD` —
so short labels stay as heading leaves and only body-prose text
gets enriched.

Governing spec: ``specs4/2-indexing/document-index.md``.
"""

from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from pathlib import Path

from ac_dc.doc_index.extractors.base import BaseDocExtractor
from ac_dc.doc_index.extractors.svg_geometry import (
    BBox,
    Matrix,
    box_contains,
    circle_bbox,
    compose,
    ellipse_bbox,
    parse_transform,
    path_bbox,
    point_in_box,
    polygon_bbox,
    rect_bbox,
    transform_bbox,
    transform_point,
)
from ac_dc.doc_index.models import (
    DocHeading,
    DocLink,
    DocOutline,
    DocProseBlock,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------


# SVG namespace — element tags in parsed ElementTree come back
# as ``{http://www.w3.org/2000/svg}title`` when the document
# declares the namespace (which every real SVG does). We strip
# the namespace prefix to get bare tag names.
_SVG_NS = "{http://www.w3.org/2000/svg}"
_XLINK_NS = "{http://www.w3.org/1999/xlink}"
_INKSCAPE_NS = "{http://www.inkscape.org/namespaces/inkscape}"


# Non-visual tags — elements that don't contribute to the
# outline. Skipped wholesale during traversal (their children
# are also ignored since they're supporting infrastructure, not
# content).
_NON_VISUAL_TAGS: frozenset[str] = frozenset({
    "defs",
    "style",
    "script",
    "metadata",
    "filter",
    "linearGradient",
    "radialGradient",
    "clipPath",
    "mask",
    "marker",
    "pattern",
    "symbol",
})


# Shape tags that contribute bounding boxes to the containment
# tree. Order matters only for readability; all are processed
# uniformly.
_SHAPE_TAGS: frozenset[str] = frozenset({
    "rect",
    "circle",
    "ellipse",
    "polygon",
    "path",
})


# Label-length threshold for long-text classification. Text
# elements exceeding this become prose blocks (2.8.3e); shorter
# ones become heading leaves. The threshold matches the spec's
# keyword-enrichment minimum section size so SVG prose and
# markdown sections share the same enrichment cutoff.
#
# 2.8.3d doesn't emit prose blocks, but we still use the
# threshold to drop oversized text from the heading list — it
# would produce wildly-variable-length heading leaves that
# dominate siblings in the compact output.
_LONG_TEXT_THRESHOLD = 80


# Auto-generated id pattern for Inkscape, Illustrator, and
# typical codegen outputs. Matches patterns like ``g123``,
# ``Group_42``, ``path1``, ``rect_7``. Case-insensitive.
# Authors who deliberately name something ``Group_42`` see it
# as a label; this is an acceptable trade-off.
_AUTO_ID_RE = re.compile(
    r"^(?:g|group|path|rect|text|layer|use|ellipse|circle|"
    r"polygon|polyline|line)_?\d+$",
    re.IGNORECASE,
)


# Spatial-clustering gap multiplier. Text elements separated by
# a vertical gap greater than this multiple of the median line
# height start a new cluster (shape-less fallback path only).
_CLUSTER_GAP_MULTIPLIER = 2.0


# Fallback line height in root-canvas units, used when the
# file has only one text element (no pairwise deltas available
# to compute a median). Chosen as a neutral middle ground —
# too small causes over-clustering, too large under-clusters.
_FALLBACK_LINE_HEIGHT = 16.0


# Line-height estimate for multi-line-label joining. Text
# elements whose vertical centres are within this many units
# of each other are joined as consecutive lines of one label.
# Tuned below typical font sizes (18-20 units) so genuinely
# stacked label lines join but labels laid out with clear
# visual spacing between them stay distinct.
_MULTILINE_JOIN_THRESHOLD = 18.0


# URL schemes that identify external links. Added to filter
# out http / https / mailto / etc. from the DocLink capture
# path — we only want repo-local references in the reference
# graph.
_EXTERNAL_URL_RE = re.compile(
    r"^(https?|ftp|mailto|data|javascript|tel):",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Internal types
# ---------------------------------------------------------------------------


class _TextElement:
    """A text element's content and root-canvas position.

    Carries the text content (joined across ``<tspan>``
    children) and the root-canvas (x, y) position after
    transform resolution. The containment-tree builder uses
    the position to decide which box this text belongs to.

    Kept as a plain class rather than a dataclass because it's
    tiny, private, and we don't need __eq__ / __repr__ helpers.
    """

    __slots__ = ("text", "x", "y")

    def __init__(self, text: str, x: float, y: float) -> None:
        self.text = text
        self.x = x
        self.y = y


class _ShapeBox:
    """A containment candidate — one shape's bounding box plus metadata.

    The containment-tree builder consumes these. ``group_label``
    is the explicit label from the shape's own ``<g>`` wrapper
    (``aria-label`` > ``inkscape:label`` > filtered ``id``), or
    None when no explicit label applies.

    Shape boxes are sorted by area descending before tree
    construction so the "smallest containing ancestor" query is
    cheap.
    """

    __slots__ = ("bbox", "group_label", "parent_index")

    def __init__(
        self,
        bbox: BBox,
        group_label: str | None,
    ) -> None:
        self.bbox = bbox
        self.group_label = group_label
        # Set during tree construction — the index of this
        # shape's parent in the sorted list, or None for roots.
        self.parent_index: int | None = None


# ---------------------------------------------------------------------------
# Extractor
# ---------------------------------------------------------------------------


class SvgExtractor(BaseDocExtractor):
    """Parse an SVG file into a containment-aware outline.

    2.8.3d scope — containment tree + three-level labeling.
    Prose-block capture lands in 2.8.3e. The extractor is
    stateless across calls; all traversal state lives in local
    variables or on the returned :class:`DocOutline`.
    """

    extension = ".svg"
    supports_enrichment = True

    def extract(self, path: Path, content: str) -> DocOutline:
        """See :class:`BaseDocExtractor` for the contract."""
        rel_path = str(path).replace("\\", "/").lstrip("/")
        outline = DocOutline(file_path=rel_path, doc_type="unknown")

        # Parse once, tolerating malformed XML. A file that
        # won't parse produces an empty outline — the path is
        # still tracked so the doc index knows about it, but no
        # structural content surfaces.
        try:
            root = ET.fromstring(content)
        except ET.ParseError as exc:
            logger.debug(
                "SVG parse failed for %s: %s", rel_path, exc
            )
            return outline

        # Collect root-level <title> and <desc> first. These
        # are the top of the outline when present.
        title_text = _find_direct_child_text(root, "title")
        desc_text = _find_direct_child_text(root, "desc")

        root_heading: DocHeading | None = None
        if title_text:
            root_heading = DocHeading(
                text=title_text,
                level=1,
            )
            outline.headings.append(root_heading)
            if desc_text:
                # desc becomes a level-2 child of the title.
                root_heading.children.append(
                    DocHeading(text=desc_text, level=2)
                )
        elif desc_text:
            # No title but we have a desc — promote it to
            # level 1 so the outline has at least one top-
            # level heading.
            outline.headings.append(
                DocHeading(text=desc_text, level=1)
            )

        # Walk the tree collecting shape boxes, text elements,
        # and anchor hrefs. Skips non-visual subtrees entirely.
        shape_boxes: list[_ShapeBox] = []
        text_elements: list[_TextElement] = []
        current_heading_for_links = (
            root_heading.text if root_heading is not None else ""
        )

        def _walk(
            node: ET.Element,
            parent_matrix: Matrix,
            inherited_label: str | None,
        ) -> None:
            """Recursive tree walk collecting shapes, text, anchors.

            ``inherited_label`` is the nearest enclosing ``<g>``'s
            explicit label (aria-label > inkscape:label > filtered
            id). Shapes use it as their ``group_label`` unless they
            sit under a more-specific group.
            """
            for child in node:
                tag = _local_name(child.tag)

                # Skip non-visual infrastructure.
                if tag in _NON_VISUAL_TAGS:
                    continue

                # Compose transform as we descend.
                child_transform = parse_transform(
                    child.get("transform")
                )
                child_matrix = compose(
                    parent_matrix, child_transform
                )

                if tag == "text":
                    element = _collect_text_element(
                        child, child_matrix
                    )
                    if element is not None:
                        text_elements.append(element)
                    continue

                if tag == "a":
                    href = _anchor_href(child)
                    if href:
                        link = _build_doc_link(
                            href,
                            current_heading_for_links,
                        )
                        if link is not None:
                            outline.links.append(link)
                    # <a> wraps content — recurse inheriting the
                    # same label (anchors aren't group labels).
                    _walk(child, child_matrix, inherited_label)
                    continue

                if tag == "g":
                    # The group's label applies to every shape
                    # inside until a nested <g> overrides it.
                    own_label = _extract_group_label(child)
                    effective_label = (
                        own_label
                        if own_label is not None
                        else inherited_label
                    )
                    _walk(child, child_matrix, effective_label)
                    continue

                if tag in _SHAPE_TAGS:
                    bbox = _shape_bbox(child, child_matrix)
                    if bbox is not None:
                        # Check the shape's OWN attributes for a
                        # label too — some diagrams put the label
                        # on the shape directly rather than on a
                        # wrapping <g>.
                        own_label = _extract_group_label(child)
                        effective_label = (
                            own_label
                            if own_label is not None
                            else inherited_label
                        )
                        shape_boxes.append(
                            _ShapeBox(bbox, effective_label)
                        )
                    # Shape elements don't contain meaningful
                    # outline content, but we still descend for
                    # defensive reasons (malformed SVG might
                    # nest text inside a rect).
                    _walk(child, child_matrix, inherited_label)
                    continue

                # Any other element — descend with the same
                # inherited label.
                _walk(child, child_matrix, inherited_label)

        # Start the walk. Skip the root's own <title>/<desc> —
        # they're already captured above.
        root_matrix = Matrix(1, 0, 0, 1, 0, 0)
        for child in root:
            tag = _local_name(child.tag)
            if tag in ("title", "desc"):
                continue
            if tag in _NON_VISUAL_TAGS:
                continue

            child_transform = parse_transform(child.get("transform"))
            child_matrix = compose(root_matrix, child_transform)

            if tag == "text":
                element = _collect_text_element(child, child_matrix)
                if element is not None:
                    text_elements.append(element)
                continue

            if tag == "a":
                href = _anchor_href(child)
                if href:
                    link = _build_doc_link(
                        href, current_heading_for_links
                    )
                    if link is not None:
                        outline.links.append(link)
                _walk(child, child_matrix, None)
                continue

            if tag == "g":
                own_label = _extract_group_label(child)
                _walk(child, child_matrix, own_label)
                continue

            if tag in _SHAPE_TAGS:
                bbox = _shape_bbox(child, child_matrix)
                if bbox is not None:
                    own_label = _extract_group_label(child)
                    shape_boxes.append(
                        _ShapeBox(bbox, own_label)
                    )
                _walk(child, child_matrix, None)
                continue

            _walk(child, child_matrix, None)

        # Decide which extraction path to use:
        # - With shapes → containment-aware extraction
        # - Without shapes but with text → spatial clustering
        # - Neither → outline is whatever title/desc produced
        if shape_boxes:
            _extract_containment_aware(
                outline,
                shape_boxes,
                text_elements,
                skip_root_heading=root_heading is not None,
            )
        elif text_elements:
            clusters = _spatial_cluster(text_elements)
            seen_labels: set[str] = set()
            _attach_clusters_to_outline(
                outline,
                clusters,
                seen_labels,
                skip_root_heading=root_heading is not None,
            )

        return outline


# ---------------------------------------------------------------------------
# Containment-aware extraction
# ---------------------------------------------------------------------------


def _extract_containment_aware(
    outline: DocOutline,
    shape_boxes: list[_ShapeBox],
    text_elements: list[_TextElement],
    skip_root_heading: bool,
) -> None:
    """Build the containment tree and emit headings.

    Process:

    1. Sort shapes by area descending — largest first so
       containment queries walk bigger candidates first.
    2. Build parent indices — for each shape, find the
       smallest other shape that contains it.
    3. Attach each text element to its smallest containing
       shape (or root if none contains it).
    4. Emit shapes as headings in reading order (y-then-x)
       at each level, with texts attached as leaves or as
       the shape's label.

    The emission follows three-level labeling:

    - **Level 1** — explicit group label (aria-label,
      inkscape:label, filtered id)
    - **Level 2** — single-text box — the one text becomes
      the label
    - **Level 3** — multi-text unlabeled box — neutral
      identifier ``(box)``, all texts as sibling leaves

    When a root title exists, the tree attaches under it as
    level-2 children; otherwise at the top level.
    """
    # Sort shapes by area descending. Ties broken by position
    # (y then x) so deterministic ordering survives equal-area
    # cases.
    sorted_shapes = sorted(
        shape_boxes,
        key=lambda s: (-s.bbox.area, s.bbox.y, s.bbox.x),
    )

    # Build parent indices. For each shape, walk the list
    # from its own position forward (shapes later in the
    # sorted list are smaller) — but that gives smallest-
    # first children, not parents. What we want is: for each
    # shape, find the smallest ancestor (= smallest larger
    # shape that contains it). Walk backwards through larger
    # shapes.
    for i, shape in enumerate(sorted_shapes):
        # Candidates are shapes BEFORE i (larger area).
        # Among those that contain this shape, pick the
        # smallest — that's the immediate parent in the tree.
        parent_idx: int | None = None
        parent_area = float("inf")
        for j in range(i):
            candidate = sorted_shapes[j]
            if j == i:
                continue
            # Exact-same-bbox case: treat the earlier one
            # (by sort order) as the parent. Avoids a
            # degenerate tree where two identical shapes
            # would each be each other's parent.
            if shape.bbox == candidate.bbox:
                continue
            if box_contains(candidate.bbox, shape.bbox):
                if candidate.bbox.area < parent_area:
                    parent_idx = j
                    parent_area = candidate.bbox.area
        shape.parent_index = parent_idx

    # Attach text elements to their smallest containing box.
    # Key is the shape's index; value is the list of texts
    # attached to it. Texts not contained by any shape are
    # collected under the root (None key).
    text_attachments: dict[int | None, list[_TextElement]] = {}
    for text in text_elements:
        best_idx: int | None = None
        best_area = float("inf")
        for i, shape in enumerate(sorted_shapes):
            if point_in_box(shape.bbox, text.x, text.y):
                if shape.bbox.area < best_area:
                    best_idx = i
                    best_area = shape.bbox.area
        text_attachments.setdefault(best_idx, []).append(text)

    # Build child index for tree emission. ``children_of[i]``
    # is the list of shape indices whose parent is i. Root
    # shapes have parent None.
    children_of: dict[int | None, list[int]] = {}
    for i, shape in enumerate(sorted_shapes):
        children_of.setdefault(
            shape.parent_index, []
        ).append(i)

    # Determine where the emitted headings attach: under the
    # root title if one exists, otherwise at the outline's
    # top level.
    if skip_root_heading and outline.headings:
        parent_children: list[DocHeading] = outline.headings[0].children
        base_level = 2
    else:
        parent_children = outline.headings
        base_level = 1

    # Track emitted labels globally so duplicates (including
    # of the root title) are suppressed.
    seen_labels: set[str] = set()
    for h in outline.all_headings_flat:
        seen_labels.add(h.text)

    # First emit root-level texts (not contained by any shape).
    # These become siblings of the top-level shape headings.
    root_texts = text_attachments.get(None, [])
    _emit_root_texts(
        parent_children,
        root_texts,
        base_level,
        seen_labels,
        outline,
    )

    # Then emit the shape tree in reading order.
    _emit_shape_tree(
        parent_children,
        sorted_shapes,
        children_of,
        text_attachments,
        parent_idx=None,
        current_level=base_level,
        seen_labels=seen_labels,
        outline=outline,
    )


def _emit_root_texts(
    parent_children: list[DocHeading],
    root_texts: list[_TextElement],
    level: int,
    seen_labels: set[str],
    outline: DocOutline,
) -> None:
    """Emit root-level texts (not contained by any shape).

    Joined by proximity first (multi-line labels like
    ``<text>Backend</text><text>Services</text>`` stacked
    vertically become one label "Backend Services"), then
    sorted by reading order.

    Short texts become heading leaves. Long texts (exceeding
    :data:`_LONG_TEXT_THRESHOLD`) become :class:`DocProseBlock`
    entries on the outline with ``container_heading_id=None``
    (root-level prose).
    """
    if not root_texts:
        return
    joined = _join_multiline_labels(root_texts)
    ordered = _reading_order_sort(joined)
    for text in ordered:
        if len(text.text) > _LONG_TEXT_THRESHOLD:
            # Promote to prose block. Root-level prose has
            # no containing heading — None signals document-
            # root attachment to the formatter.
            outline.prose_blocks.append(
                DocProseBlock(
                    text=text.text,
                    container_heading_id=None,
                )
            )
            continue
        if text.text in seen_labels:
            continue
        seen_labels.add(text.text)
        parent_children.append(
            DocHeading(text=text.text, level=level)
        )


def _emit_shape_tree(
    parent_children: list[DocHeading],
    sorted_shapes: list[_ShapeBox],
    children_of: dict[int | None, list[int]],
    text_attachments: dict[int | None, list[_TextElement]],
    parent_idx: int | None,
    current_level: int,
    seen_labels: set[str],
    outline: DocOutline,
) -> None:
    """Emit one level of the shape tree, recursing into children.

    Shapes at this level are sorted by reading order (y then
    x). Each shape emits a heading whose text comes from
    three-level labeling; attached texts become children;
    nested shapes become deeper children.

    Long texts among a shape's attached texts become
    :class:`DocProseBlock` entries on the outline, with
    ``container_heading_id`` set to the shape's label.

    Level clamps at 6 — deeper SVG nesting still emits
    headings, but the level stays at 6 so the compact
    formatter's clamp matches.
    """
    child_indices = children_of.get(parent_idx, [])
    if not child_indices:
        return

    # Sort child shapes by reading order — y first, x second.
    child_indices = sorted(
        child_indices,
        key=lambda i: (
            sorted_shapes[i].bbox.y,
            sorted_shapes[i].bbox.x,
        ),
    )

    emit_level = min(current_level, 6)

    for idx in child_indices:
        shape = sorted_shapes[idx]
        texts = text_attachments.get(idx, [])
        joined_texts = _join_multiline_labels(texts)
        ordered_texts = _reading_order_sort(joined_texts)

        # Split into short (label candidates) and long (prose
        # candidates) before label picking. Long texts never
        # become labels — they're always prose.
        short_texts = [
            t for t in ordered_texts
            if len(t.text) <= _LONG_TEXT_THRESHOLD
        ]
        long_texts = [
            t for t in ordered_texts
            if len(t.text) > _LONG_TEXT_THRESHOLD
        ]

        label_text, leaf_texts = _pick_shape_label(
            shape, short_texts, seen_labels
        )

        # Decide whether to skip a totally empty shape. An
        # empty shape with NO contents (no label, no short
        # texts, no long texts, no children) is pure
        # decoration and contributes nothing.
        has_children = bool(children_of.get(idx))
        if label_text is None and not short_texts and not long_texts:
            if not has_children:
                continue
            # Has nested shapes but no text of its own —
            # emit a neutral identifier so the children have
            # somewhere to attach.
            label_text = "(box)"
        elif label_text is None:
            # No explicit label, no single-text-inference
            # match. Use neutral identifier. Don't add it to
            # seen_labels — multiple unlabeled boxes
            # legitimately share the identifier.
            label_text = "(box)"

        seen_labels.add(label_text)
        heading = DocHeading(text=label_text, level=emit_level)
        parent_children.append(heading)

        # Attach short leaf texts under this heading. Long
        # texts become prose blocks on the outline with this
        # heading as their container.
        leaf_level = min(emit_level + 1, 6)
        for text in leaf_texts:
            if len(text.text) > _LONG_TEXT_THRESHOLD:
                # Should not happen — leaf_texts comes from
                # short_texts via _pick_shape_label — but
                # defensive in case _pick_shape_label's
                # contract drifts in a future refactor.
                continue
            if text.text in seen_labels:
                continue
            seen_labels.add(text.text)
            heading.children.append(
                DocHeading(text=text.text, level=leaf_level)
            )

        for long_text in long_texts:
            outline.prose_blocks.append(
                DocProseBlock(
                    text=long_text.text,
                    container_heading_id=label_text,
                )
            )

        # Recurse into nested shapes.
        _emit_shape_tree(
            heading.children,
            sorted_shapes,
            children_of,
            text_attachments,
            parent_idx=idx,
            current_level=emit_level + 1,
            seen_labels=seen_labels,
            outline=outline,
        )


def _pick_shape_label(
    shape: _ShapeBox,
    texts: list[_TextElement],
    seen_labels: set[str],
) -> tuple[str | None, list[_TextElement]]:
    """Apply the three-level labeling rule.

    Returns ``(label, leaf_texts)`` where label is either the
    chosen heading text or None (meaning "no meaningful
    label, caller decides"). ``leaf_texts`` is the list of
    texts that should render as children — empty for the
    single-text case (the text became the label) and the
    full list otherwise.

    Long texts (> ``_LONG_TEXT_THRESHOLD``) are never picked
    as labels — they're headed for prose blocks in 2.8.3e.
    The current implementation drops them, so single-text
    boxes where the one text is long fall through to the
    no-label case.
    """
    # Level 1 — explicit group label wins.
    if shape.group_label is not None:
        return shape.group_label, texts

    # Filter texts eligible to be labels (short enough).
    short_texts = [
        t for t in texts if len(t.text) <= _LONG_TEXT_THRESHOLD
    ]

    # Level 2 — single short text. It becomes the label; no
    # leaves remain.
    if len(short_texts) == 1 and len(texts) == 1:
        return short_texts[0].text, []

    # Level 3 — multi-text or texts-plus-long. Return None
    # so the caller decides between the neutral identifier
    # and a skip.
    return None, texts


def _join_multiline_labels(
    elements: list[_TextElement],
) -> list[_TextElement]:
    """Join tightly-stacked text elements into multi-line labels.

    Consecutive elements whose y-gap is smaller than
    :data:`_MULTILINE_JOIN_THRESHOLD` are joined space-
    separated. Operates on the y-sorted list. The (x, y)
    position of the joined element is the first element's
    position — reading-order sorting later uses it.

    Does not attempt column detection — two side-by-side
    labels at the same y don't merge. Only vertical stacking
    joins.
    """
    if len(elements) <= 1:
        return list(elements)

    # Sort by y ascending; join consecutive close-y items
    # that share a similar x position (within half a typical
    # label width).
    sorted_els = sorted(elements, key=lambda e: (e.y, e.x))
    result: list[_TextElement] = []
    current = sorted_els[0]
    current_parts: list[str] = [current.text]

    for el in sorted_els[1:]:
        y_gap = el.y - current.y
        x_gap = abs(el.x - current.x)
        # Join criteria: close vertically AND roughly aligned
        # horizontally. The x tolerance prevents joining two
        # side-by-side labels that happen to be on the same
        # row.
        if y_gap < _MULTILINE_JOIN_THRESHOLD and x_gap < 50.0:
            current_parts.append(el.text)
            current = _TextElement(
                text=current.text,
                x=current.x,
                y=el.y,
            )
            continue
        # Flush current.
        result.append(
            _TextElement(
                text=" ".join(current_parts),
                x=current.x,
                y=current.y,
            )
        )
        current = el
        current_parts = [el.text]

    result.append(
        _TextElement(
            text=" ".join(current_parts),
            x=current.x,
            y=current.y,
        )
    )
    return result


def _reading_order_sort(
    elements: list[_TextElement],
) -> list[_TextElement]:
    """Sort text elements in reading order: y-primary, x-secondary.

    Texts on the same row (close y values) order left-to-
    right. Texts on different rows order top-to-bottom.
    The "same row" tolerance is :data:`_FALLBACK_LINE_HEIGHT`
    — wider than typical inter-column gaps but tight enough
    that rows stay distinct.
    """
    if len(elements) <= 1:
        return list(elements)

    # Assign each element a row bucket based on y proximity.
    by_y = sorted(elements, key=lambda e: e.y)
    rows: list[list[_TextElement]] = [[by_y[0]]]
    for el in by_y[1:]:
        last_row_y = rows[-1][-1].y
        if el.y - last_row_y < _FALLBACK_LINE_HEIGHT:
            rows[-1].append(el)
        else:
            rows.append([el])

    result: list[_TextElement] = []
    for row in rows:
        result.extend(sorted(row, key=lambda e: e.x))
    return result


# ---------------------------------------------------------------------------
# Shape bounding-box dispatch
# ---------------------------------------------------------------------------


def _shape_bbox(
    node: ET.Element, matrix: Matrix
) -> BBox | None:
    """Compute a shape element's root-canvas bounding box.

    Dispatches by tag to the appropriate per-shape helper in
    :mod:`svg_geometry`, then applies the accumulated
    transform matrix to project into root coordinates.

    Returns None when the shape's attributes don't describe a
    valid bounding box (zero area, missing required
    attributes, malformed numeric strings).
    """
    tag = _local_name(node.tag)
    local_bbox: BBox | None = None

    if tag == "rect":
        local_bbox = rect_bbox(
            _parse_float_attr(node, "x"),
            _parse_float_attr(node, "y"),
            _parse_float_attr(node, "width"),
            _parse_float_attr(node, "height"),
        )
    elif tag == "circle":
        local_bbox = circle_bbox(
            _parse_float_attr(node, "cx"),
            _parse_float_attr(node, "cy"),
            _parse_float_attr(node, "r"),
        )
    elif tag == "ellipse":
        local_bbox = ellipse_bbox(
            _parse_float_attr(node, "cx"),
            _parse_float_attr(node, "cy"),
            _parse_float_attr(node, "rx"),
            _parse_float_attr(node, "ry"),
        )
    elif tag == "polygon":
        local_bbox = polygon_bbox(node.get("points"))
    elif tag == "path":
        local_bbox = path_bbox(node.get("d"))

    if local_bbox is None:
        return None
    return transform_bbox(matrix, local_bbox)


def _parse_float_attr(
    node: ET.Element, name: str
) -> float | None:
    """Parse a float-valued attribute; None for missing / malformed."""
    value = node.get(name)
    if value is None:
        return None
    try:
        return float(value.strip())
    except (ValueError, AttributeError):
        return None


# ---------------------------------------------------------------------------
# Label extraction
# ---------------------------------------------------------------------------


def _extract_group_label(node: ET.Element) -> str | None:
    """Return the explicit label for a group, or None.

    Priority per specs4/2-indexing/document-index.md:

    1. ``aria-label`` — explicit accessibility label
    2. ``inkscape:label`` — Inkscape's editor-set label
    3. ``id`` — but only when it doesn't match the auto-id
       regex

    Empty string values are treated as absent. Whitespace-
    only labels are stripped and, if empty after stripping,
    treated as absent.
    """
    for attr in ("aria-label", _INKSCAPE_NS + "label"):
        value = node.get(attr)
        if value is not None:
            stripped = value.strip()
            if stripped:
                return stripped

    raw_id = node.get("id")
    if raw_id is None:
        return None
    stripped = raw_id.strip()
    if not stripped:
        return None
    if _AUTO_ID_RE.match(stripped):
        return None
    return stripped


# ---------------------------------------------------------------------------
# Namespace / text / link helpers (unchanged from 2.8.3c)
# ---------------------------------------------------------------------------


def _local_name(tag: str) -> str:
    """Strip the namespace prefix from an ElementTree tag.

    ElementTree returns tags as ``{namespace}name`` when the
    document declares the namespace. We strip the prefix so
    call sites can compare against bare names (``"title"``
    rather than ``"{...}title"``).

    For tags without a namespace (rare in real SVGs but
    possible) the input is returned unchanged.
    """
    if tag.startswith("{"):
        closing = tag.find("}")
        if closing != -1:
            return tag[closing + 1:]
    return tag


def _find_direct_child_text(
    root: ET.Element, tag_name: str
) -> str:
    """Return the text of the first direct child with ``tag_name``.

    Searches only the root's direct children — nested title /
    desc elements inside groups belong to those groups, not to
    the document. Returns empty string when the tag is absent
    or has no text content.

    The search is namespace-aware: we compare local names so
    documents that use the SVG namespace work identically to
    those that don't.
    """
    for child in root:
        if _local_name(child.tag) == tag_name:
            text = child.text or ""
            return text.strip()
    return ""


def _collect_text_element(
    node: ET.Element, matrix: Matrix
) -> _TextElement | None:
    """Build a :class:`_TextElement` from a ``<text>`` node.

    Joins the element's own text with text from its ``<tspan>``
    children (space-separated). Resolves the (x, y) position
    to root-canvas coordinates using the accumulated transform.

    Returns None when the collected text is empty — an empty
    ``<text>`` element contributes nothing to the outline.

    The (x, y) position comes from the first x / y attribute
    pair present on the element or its first ``<tspan>``. SVG
    allows multiple x / y values (one per glyph) for precise
    typesetting — we use only the first.
    """
    parts: list[str] = []
    if node.text:
        parts.append(node.text.strip())

    # Pull x / y from the node itself; fall back to the first
    # tspan that declares them.
    x_str = node.get("x")
    y_str = node.get("y")

    for child in node:
        if _local_name(child.tag) != "tspan":
            continue
        if child.text:
            parts.append(child.text.strip())
        if x_str is None:
            x_str = child.get("x")
        if y_str is None:
            y_str = child.get("y")
        # tail text (text following the tspan's closing tag
        # but still inside the parent <text>) also counts.
        if child.tail:
            parts.append(child.tail.strip())

    text = " ".join(p for p in parts if p)
    if not text:
        return None

    # Parse positions; default to (0, 0) when absent or
    # unparseable. Multiple-value attributes like
    # ``x="10 20 30"`` take the first token.
    local_x = _first_number_or_zero(x_str)
    local_y = _first_number_or_zero(y_str)

    root_x, root_y = transform_point(matrix, local_x, local_y)
    return _TextElement(text=text, x=root_x, y=root_y)


def _first_number_or_zero(value: str | None) -> float:
    """Parse the first number from ``value``; return 0.0 on failure.

    SVG allows space- or comma-separated number lists in x / y
    attributes for per-glyph positioning. We only need the
    first for heading positioning. Missing or malformed input
    becomes 0.0 — matching SVG's default coordinate behaviour.
    """
    if value is None:
        return 0.0
    # Grab the first token, split on whitespace or comma.
    first = re.split(r"[\s,]+", value.strip(), maxsplit=1)
    if not first or not first[0]:
        return 0.0
    try:
        return float(first[0])
    except ValueError:
        return 0.0


def _anchor_href(node: ET.Element) -> str | None:
    """Return the href from an ``<a>`` element, or None.

    SVG anchors use either ``href`` (SVG2) or the older
    ``xlink:href`` form. We accept both. Returns None when
    neither attribute is present or the value is empty.
    """
    href = node.get("href")
    if href is None:
        href = node.get(_XLINK_NS + "href")
    if href is None:
        return None
    href = href.strip()
    if not href:
        return None
    return href


def _build_doc_link(
    target: str, source_heading: str
) -> DocLink | None:
    """Construct a :class:`DocLink` for an anchor target.

    Returns None when the target is:

    - An external URL (http / https / mailto / etc.) — the
      reference index only tracks repo-local references
    - Fragment-only (``#section``) — pure in-document
      navigation, no cross-reference value
    - Empty after stripping

    Targets with ``path#fragment`` shape are preserved verbatim
    — the reference index splits them during its resolve pass.
    """
    if not target:
        return None
    if target.startswith("#"):
        return None
    if _EXTERNAL_URL_RE.match(target):
        return None
    return DocLink(
        target=target,
        source_heading=source_heading,
        is_image=False,
    )


# ---------------------------------------------------------------------------
# Shape-less fallback (only fires when no shapes present)
# ---------------------------------------------------------------------------


def _spatial_cluster(
    elements: list[_TextElement],
) -> list[list[_TextElement]]:
    """Cluster text elements by vertical proximity.

    Fallback for shape-less SVGs. Sorts elements by y
    ascending, then groups consecutive elements whose y-gap
    is less than the clustering threshold
    (``_CLUSTER_GAP_MULTIPLIER`` × median inter-element gap).

    Empty input produces an empty list; a single element
    produces one cluster containing it.
    """
    if not elements:
        return []

    sorted_elements = sorted(elements, key=lambda e: (e.y, e.x))
    if len(sorted_elements) == 1:
        return [list(sorted_elements)]

    # Compute y-gaps between consecutive elements.
    gaps = [
        sorted_elements[i + 1].y - sorted_elements[i].y
        for i in range(len(sorted_elements) - 1)
    ]
    positive_gaps = [g for g in gaps if g > 0]
    if positive_gaps:
        median_gap = sorted(positive_gaps)[len(positive_gaps) // 2]
    else:
        median_gap = _FALLBACK_LINE_HEIGHT

    threshold = median_gap * _CLUSTER_GAP_MULTIPLIER

    clusters: list[list[_TextElement]] = [[sorted_elements[0]]]
    for i in range(1, len(sorted_elements)):
        gap = sorted_elements[i].y - sorted_elements[i - 1].y
        if gap > threshold:
            clusters.append([sorted_elements[i]])
        else:
            clusters[-1].append(sorted_elements[i])

    return clusters


def _attach_clusters_to_outline(
    outline: DocOutline,
    clusters: list[list[_TextElement]],
    seen_labels: set[str],
    skip_root_heading: bool,
) -> None:
    """Emit clusters as heading leaves under the outline.

    Shape-less fallback path. Each cluster becomes a top-
    level heading (or a child of the root title when one
    exists). Texts within a cluster are emitted in the order
    they appear in the sorted cluster — reading order (top to
    bottom, then left to right within a row).

    Long text elements (exceeding :data:`_LONG_TEXT_THRESHOLD`)
    become :class:`DocProseBlock` entries on the outline with
    ``container_heading_id`` set to the root title (if any) or
    the cluster's first short label. Prose without a nearby
    heading falls back to None.

    Duplicates are removed against ``seen_labels`` — a caller-
    provided set that tracks labels already emitted anywhere
    else in the outline (e.g., from the root title).
    """
    parent: list[DocHeading]
    base_level: int
    if skip_root_heading and outline.headings:
        parent = outline.headings[0].children
        base_level = 2
    else:
        parent = outline.headings
        base_level = 1

    # Root title's text is the fallback container for prose
    # that doesn't land under a cluster heading.
    root_container = (
        outline.headings[0].text
        if skip_root_heading and outline.headings
        else None
    )

    for h in outline.all_headings_flat:
        seen_labels.add(h.text)

    for cluster in clusters:
        short_texts: list[str] = []
        long_texts: list[str] = []
        for el in cluster:
            if len(el.text) > _LONG_TEXT_THRESHOLD:
                long_texts.append(el.text)
                continue
            if el.text in seen_labels:
                continue
            short_texts.append(el.text)
            seen_labels.add(el.text)

        # Cluster's container for prose — the first short
        # label if present, otherwise the root title, else
        # None.
        cluster_container = (
            short_texts[0] if short_texts else root_container
        )

        if short_texts:
            head = DocHeading(
                text=short_texts[0], level=base_level
            )
            parent.append(head)
            for child_text in short_texts[1:]:
                head.children.append(
                    DocHeading(
                        text=child_text,
                        level=base_level + 1,
                    )
                )

        for long_text in long_texts:
            outline.prose_blocks.append(
                DocProseBlock(
                    text=long_text,
                    container_heading_id=cluster_container,
                )
            )