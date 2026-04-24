"""SVG extractor — Layer 2.8.3c (minimal baseline).

Covers the trivial paths only:

- ``<title>`` → top-level heading
- ``<desc>`` → level-2 heading under the document root
- ``<a xlink:href=...>`` with non-fragment target → DocLink entry
- Shape-less spatial clustering fallback when no boxes are
  present (text-only SVGs)
- Text label deduplication
- Non-visual element filtering (defs, style, script, metadata,
  filter, gradients, clipPath, mask, marker, pattern, symbol)

Deliberately excluded — land in later sub-commits:

- **Containment tree** (2.8.3d) — building the shape hierarchy
  from bounding boxes and attaching text to boxes. Without this,
  multi-box SVGs fall back to flat spatial clustering or produce
  minimal outlines.
- **Three-level labeling** (2.8.3d) — explicit labels, single-
  text inference, neutral identifiers.
- **Long-text prose blocks** (2.8.3e) — text elements exceeding
  the label length threshold.

Today's behaviour on an SVG with shapes: the extractor still
runs shape-less clustering over the text elements. This is
suboptimal for box-heavy diagrams but correct for the narrow
subset of SVGs 2.8.3c targets (label-only or text-only files).
Sub-commit 2.8.3d replaces the shape-less-fallback-only path
with containment-aware extraction.

Uses stdlib ``xml.etree.ElementTree`` only — no external XML
dependencies. Parse failures are caught and produce an empty
outline rather than propagating: an unparseable SVG should not
take down indexing of the rest of the repo.

Governing spec: ``specs4/2-indexing/document-index.md``.
"""

from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from pathlib import Path

from ac_dc.doc_index.extractors.base import BaseDocExtractor
from ac_dc.doc_index.extractors.svg_geometry import (
    Matrix,
    compose,
    parse_transform,
    transform_point,
)
from ac_dc.doc_index.models import (
    DocHeading,
    DocLink,
    DocOutline,
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


# Label-length threshold for long-text classification. Text
# elements exceeding this become prose blocks (2.8.3e); shorter
# ones become heading leaves. The threshold matches the spec's
# keyword-enrichment minimum section size so SVG prose and
# markdown sections share the same enrichment cutoff.
#
# 2.8.3c doesn't emit prose blocks, but we still use the
# threshold to drop oversized text from the heading list — it
# would produce wildly-variable-length heading leaves that
# dominate siblings in the compact output.
_LONG_TEXT_THRESHOLD = 80


# Spatial-clustering gap multiplier. Text elements separated by
# a vertical gap greater than this multiple of the median line
# height start a new cluster.
_CLUSTER_GAP_MULTIPLIER = 2.0


# Fallback line height in root-canvas units, used when the
# file has only one text element (no pairwise deltas available
# to compute a median). Chosen as a neutral middle ground —
# too small causes over-clustering, too large under-clusters.
_FALLBACK_LINE_HEIGHT = 16.0


# URL schemes that identify external links. Added to filter
# out http / https / mailto / etc. from the DocLink capture path
# (we only want repo-local references in the reference graph).
_EXTERNAL_URL_RE = re.compile(
    r"^(https?|ftp|mailto|data|javascript|tel):",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Text element internal representation
# ---------------------------------------------------------------------------


class _TextElement:
    """A text element's content and root-canvas position.

    Internal helper for the extractor. Carries the text content
    (joined across ``<tspan>`` children) and the root-canvas
    (x, y) position after transform resolution. Used by the
    shape-less clustering pass.

    Kept as a plain class rather than a dataclass because it's
    tiny, private, and we don't need __eq__ / __repr__ helpers.
    """

    __slots__ = ("text", "x", "y")

    def __init__(self, text: str, x: float, y: float) -> None:
        self.text = text
        self.x = x
        self.y = y


# ---------------------------------------------------------------------------
# Extractor
# ---------------------------------------------------------------------------


class SvgExtractor(BaseDocExtractor):
    """Parse an SVG file into a minimal outline.

    2.8.3c scope — see module docstring for what's included and
    what's deferred. The extractor is stateless across calls;
    all traversal state lives in local variables or on the
    returned :class:`DocOutline`.
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

        # Walk the tree collecting text elements (with their
        # resolved root-canvas positions) and anchor hrefs.
        # Skips non-visual subtrees entirely.
        text_elements: list[_TextElement] = []
        seen_label_texts: set[str] = set()
        current_heading_for_links = (
            root_heading.text if root_heading is not None else ""
        )

        def _walk(node: ET.Element, parent_matrix: Matrix) -> None:
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
                    # Text elements don't have meaningful
                    # children to recurse into (<tspan> content
                    # was joined in place).
                    continue

                if tag == "a":
                    # Capture the href; DocLink emitted below.
                    href = _anchor_href(child)
                    if href:
                        link = _build_doc_link(
                            href,
                            current_heading_for_links,
                        )
                        if link is not None:
                            outline.links.append(link)
                    # <a> wraps content — continue into children.
                    _walk(child, child_matrix)
                    continue

                # For any other element, descend. Shape
                # elements (rect / circle / etc.) have no
                # meaningful children for the minimal 2.8.3c
                # extractor, but descending is cheap and
                # correct.
                _walk(child, child_matrix)

        # Start the walk. Skip the root's own <title>/<desc> —
        # they're already captured above.
        for child in root:
            tag = _local_name(child.tag)
            if tag in ("title", "desc"):
                continue
            if tag in _NON_VISUAL_TAGS:
                continue

            child_transform = parse_transform(child.get("transform"))
            child_matrix = compose(
                Matrix(1, 0, 0, 1, 0, 0),
                child_transform,
            )

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
                _walk(child, child_matrix)
                continue

            _walk(child, child_matrix)

        # Shape-less fallback: cluster text elements by
        # spatial proximity. When 2.8.3d lands its containment
        # tree, this will be replaced with containment-aware
        # grouping and this fallback will only fire for truly
        # shape-less SVGs.
        if text_elements:
            clusters = _spatial_cluster(text_elements)
            _attach_clusters_to_outline(
                outline,
                clusters,
                seen_label_texts,
                skip_root_heading=root_heading is not None,
            )

        return outline


# ---------------------------------------------------------------------------
# Helpers
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


def _spatial_cluster(
    elements: list[_TextElement],
) -> list[list[_TextElement]]:
    """Cluster text elements by vertical proximity.

    Used as a fallback when no containment information is
    available. Sorts elements by y ascending, then groups
    consecutive elements whose y-gap is less than the
    clustering threshold (``_CLUSTER_GAP_MULTIPLIER`` × median
    inter-element gap).

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

    Each cluster becomes a top-level heading (or a child of the
    root title when one exists). Texts within a cluster are
    emitted in the order they appear in the sorted cluster —
    which is reading order (top to bottom, then left to right
    within a row).

    Long text elements (exceeding :data:`_LONG_TEXT_THRESHOLD`)
    are dropped from the heading list for 2.8.3c. Sub-commit
    2.8.3e promotes them to :class:`DocProseBlock` entries.

    Duplicates are removed against ``seen_labels`` — a caller-
    provided set that tracks labels already emitted anywhere
    else in the outline (e.g., from the root title).
    """
    parent: list[DocHeading]
    base_level: int
    if skip_root_heading and outline.headings:
        # Attach under the root title as level-2 children.
        parent = outline.headings[0].children
        base_level = 2
    else:
        parent = outline.headings
        base_level = 1

    # Seed seen_labels with any existing heading texts so a
    # cluster that duplicates the root title doesn't emit it
    # twice.
    for h in outline.all_headings_flat:
        seen_labels.add(h.text)

    for cluster in clusters:
        # Filter long text AND duplicates within the cluster.
        texts: list[str] = []
        for el in cluster:
            if len(el.text) > _LONG_TEXT_THRESHOLD:
                continue
            if el.text in seen_labels:
                continue
            texts.append(el.text)
            seen_labels.add(el.text)
        if not texts:
            continue

        # Multi-text cluster — first text becomes the parent
        # heading, rest become its children. Single-text
        # cluster is a leaf heading.
        head = DocHeading(text=texts[0], level=base_level)
        parent.append(head)
        for child_text in texts[1:]:
            head.children.append(
                DocHeading(text=child_text, level=base_level + 1)
            )