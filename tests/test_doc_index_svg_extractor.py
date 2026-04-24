"""Tests for the minimal SVG extractor — Layer 2.8.3c.

Covers only the narrow surface 2.8.3c implements:

- ``<title>`` / ``<desc>`` → headings
- ``<a xlink:href>`` → DocLink
- Shape-less spatial clustering fallback
- Non-visual element filtering
- Text deduplication
- Long-text filtering (prose blocks arrive in 2.8.3e)
- Parse error tolerance

Containment-tree behaviour (2.8.3d) and prose-block capture
(2.8.3e) are explicitly NOT tested here — those sub-commits
own those contracts. A containment-aware test that landed in
2.8.3c and then needed rewriting in 2.8.3d would be noise.

Several tests exercise SVGs without the SVG namespace so the
local-name stripping logic is verified both with and without
it. Real-world SVGs always declare the namespace, but stripped
fixtures keep the tests readable.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from ac_dc.doc_index.extractors.svg import (
    SvgExtractor,
    _local_name,
    _spatial_cluster,
    _TextElement,
)
from ac_dc.doc_index.models import DocOutline


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def extractor() -> SvgExtractor:
    return SvgExtractor()


def _extract(
    extractor: SvgExtractor, content: str, path: str = "doc.svg"
) -> DocOutline:
    """Run the extractor and return the outline."""
    return extractor.extract(Path(path), content)


# Minimal namespaced SVG wrapper — matches what real-world
# files (Inkscape, Illustrator, manual authoring) produce.
def _wrap_ns(body: str) -> str:
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        'xmlns:xlink="http://www.w3.org/1999/xlink" '
        'viewBox="0 0 400 300">'
        f"{body}"
        "</svg>"
    )


# Namespace-free wrapper — used by a subset of tests to keep
# fixtures readable. The extractor must handle both.
def _wrap_bare(body: str) -> str:
    return f'<svg viewBox="0 0 400 300">{body}</svg>'


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


class TestRegistration:
    def test_extension_is_svg(self, extractor: SvgExtractor) -> None:
        assert extractor.extension == ".svg"

    def test_supports_enrichment(
        self, extractor: SvgExtractor
    ) -> None:
        # Coarse hint — enrichment decision is per-outline in the
        # orchestrator. True here means "might produce prose
        # blocks"; 2.8.3c itself never does.
        assert extractor.supports_enrichment is True


# ---------------------------------------------------------------------------
# Parse error tolerance
# ---------------------------------------------------------------------------


class TestParseErrorTolerance:
    def test_malformed_xml_returns_empty_outline(
        self, extractor: SvgExtractor
    ) -> None:
        out = _extract(extractor, "<svg><not-closed")
        assert out.headings == []
        assert out.links == []
        assert out.file_path == "doc.svg"

    def test_empty_content_returns_empty_outline(
        self, extractor: SvgExtractor
    ) -> None:
        out = _extract(extractor, "")
        assert out.headings == []
        assert out.links == []

    def test_non_svg_root_still_returns_outline(
        self, extractor: SvgExtractor
    ) -> None:
        # A well-formed XML document that isn't SVG. The parser
        # succeeds but no title / desc / text — empty headings.
        out = _extract(extractor, "<root><child/></root>")
        assert out.headings == []


# ---------------------------------------------------------------------------
# Title and desc
# ---------------------------------------------------------------------------


class TestTitleDesc:
    def test_title_becomes_level_1_heading(
        self, extractor: SvgExtractor
    ) -> None:
        svg = _wrap_ns("<title>System Overview</title>")
        out = _extract(extractor, svg)
        assert len(out.headings) == 1
        assert out.headings[0].text == "System Overview"
        assert out.headings[0].level == 1

    def test_desc_becomes_level_2_child_of_title(
        self, extractor: SvgExtractor
    ) -> None:
        svg = _wrap_ns(
            "<title>Main</title>"
            "<desc>Explanatory text</desc>"
        )
        out = _extract(extractor, svg)
        assert len(out.headings) == 1
        title = out.headings[0]
        assert len(title.children) == 1
        desc = title.children[0]
        assert desc.text == "Explanatory text"
        assert desc.level == 2

    def test_desc_without_title_promoted_to_level_1(
        self, extractor: SvgExtractor
    ) -> None:
        # No title — desc becomes the top-level heading so the
        # outline isn't headingless.
        svg = _wrap_ns("<desc>Orphan description</desc>")
        out = _extract(extractor, svg)
        assert len(out.headings) == 1
        assert out.headings[0].text == "Orphan description"
        assert out.headings[0].level == 1

    def test_no_title_no_desc_produces_empty_headings(
        self, extractor: SvgExtractor
    ) -> None:
        svg = _wrap_ns('<rect x="0" y="0" width="10" height="10"/>')
        out = _extract(extractor, svg)
        assert out.headings == []

    def test_nested_title_not_promoted(
        self, extractor: SvgExtractor
    ) -> None:
        # Only direct children of the root matter — a <title>
        # inside a <g> belongs to that group, not the document.
        svg = _wrap_ns(
            "<g><title>Group title</title>"
            '<rect x="0" y="0" width="10" height="10"/></g>'
        )
        out = _extract(extractor, svg)
        # 2.8.3c doesn't surface group titles — only root ones.
        assert out.headings == []

    def test_title_with_whitespace_stripped(
        self, extractor: SvgExtractor
    ) -> None:
        svg = _wrap_ns("<title>  Padded  </title>")
        out = _extract(extractor, svg)
        assert out.headings[0].text == "Padded"

    def test_empty_title_ignored(
        self, extractor: SvgExtractor
    ) -> None:
        svg = _wrap_ns("<title></title>")
        out = _extract(extractor, svg)
        assert out.headings == []

    def test_bare_namespace_title_also_works(
        self, extractor: SvgExtractor
    ) -> None:
        # Namespace-free SVG for readability in fixtures.
        svg = _wrap_bare("<title>Bare Title</title>")
        out = _extract(extractor, svg)
        assert out.headings[0].text == "Bare Title"


# ---------------------------------------------------------------------------
# Anchor links
# ---------------------------------------------------------------------------


class TestAnchorLinks:
    def test_xlink_href_captured(
        self, extractor: SvgExtractor
    ) -> None:
        svg = _wrap_ns(
            '<a xlink:href="foo.md">'
            '<rect x="0" y="0" width="10" height="10"/>'
            "</a>"
        )
        out = _extract(extractor, svg)
        assert len(out.links) == 1
        assert out.links[0].target == "foo.md"
        assert out.links[0].is_image is False

    def test_svg2_href_captured(
        self, extractor: SvgExtractor
    ) -> None:
        # SVG2 uses plain href rather than xlink:href.
        svg = _wrap_ns(
            '<a href="bar.md">'
            '<rect x="0" y="0" width="10" height="10"/>'
            "</a>"
        )
        out = _extract(extractor, svg)
        assert len(out.links) == 1
        assert out.links[0].target == "bar.md"

    def test_path_with_fragment_preserved(
        self, extractor: SvgExtractor
    ) -> None:
        svg = _wrap_ns(
            '<a xlink:href="spec.md#section-two">'
            "<text>click</text>"
            "</a>"
        )
        out = _extract(extractor, svg)
        assert len(out.links) == 1
        assert out.links[0].target == "spec.md#section-two"

    def test_fragment_only_href_filtered(
        self, extractor: SvgExtractor
    ) -> None:
        # Pure in-document navigation — no reference value.
        svg = _wrap_ns(
            '<a xlink:href="#intro"><text>jump</text></a>'
        )
        out = _extract(extractor, svg)
        assert out.links == []

    def test_external_url_filtered(
        self, extractor: SvgExtractor
    ) -> None:
        # External URLs don't join the reference graph.
        svg = _wrap_ns(
            '<a xlink:href="https://example.com/page">'
            "<text>external</text>"
            "</a>"
        )
        out = _extract(extractor, svg)
        assert out.links == []

    def test_mailto_filtered(
        self, extractor: SvgExtractor
    ) -> None:
        svg = _wrap_ns(
            '<a xlink:href="mailto:foo@bar.com">'
            "<text>email</text></a>"
        )
        out = _extract(extractor, svg)
        assert out.links == []

    def test_empty_href_ignored(
        self, extractor: SvgExtractor
    ) -> None:
        svg = _wrap_ns('<a xlink:href=""><text>empty</text></a>')
        out = _extract(extractor, svg)
        assert out.links == []

    def test_anchor_without_href_ignored(
        self, extractor: SvgExtractor
    ) -> None:
        svg = _wrap_ns("<a><text>dangling</text></a>")
        out = _extract(extractor, svg)
        assert out.links == []

    def test_multiple_anchors_all_captured(
        self, extractor: SvgExtractor
    ) -> None:
        svg = _wrap_ns(
            '<a xlink:href="a.md"><text>one</text></a>'
            '<a xlink:href="b.md"><text>two</text></a>'
            '<a xlink:href="sub/c.md"><text>three</text></a>'
        )
        out = _extract(extractor, svg)
        targets = [link.target for link in out.links]
        assert targets == ["a.md", "b.md", "sub/c.md"]

    def test_anchor_source_heading_uses_root_title(
        self, extractor: SvgExtractor
    ) -> None:
        svg = _wrap_ns(
            "<title>Diagram</title>"
            '<a xlink:href="details.md"><text>link</text></a>'
        )
        out = _extract(extractor, svg)
        assert len(out.links) == 1
        assert out.links[0].source_heading == "Diagram"

    def test_anchor_source_heading_empty_without_title(
        self, extractor: SvgExtractor
    ) -> None:
        svg = _wrap_ns(
            '<a xlink:href="x.md"><text>link</text></a>'
        )
        out = _extract(extractor, svg)
        assert out.links[0].source_heading == ""


# ---------------------------------------------------------------------------
# Shape-less spatial clustering
# ---------------------------------------------------------------------------


class TestSpatialClustering:
    def test_single_text_produces_one_heading(
        self, extractor: SvgExtractor
    ) -> None:
        svg = _wrap_ns('<text x="10" y="20">Only Text</text>')
        out = _extract(extractor, svg)
        assert len(out.headings) == 1
        assert out.headings[0].text == "Only Text"
        assert out.headings[0].level == 1

    def test_tight_cluster_produces_one_parent_with_children(
        self, extractor: SvgExtractor
    ) -> None:
        # Three tightly-spaced texts (y = 20, 30, 40) cluster
        # into one group — first becomes parent, rest children.
        svg = _wrap_ns(
            '<text x="10" y="20">First</text>'
            '<text x="10" y="30">Second</text>'
            '<text x="10" y="40">Third</text>'
        )
        out = _extract(extractor, svg)
        assert len(out.headings) == 1
        parent = out.headings[0]
        assert parent.text == "First"
        assert [c.text for c in parent.children] == [
            "Second",
            "Third",
        ]

    def test_separated_clusters_become_siblings(
        self, extractor: SvgExtractor
    ) -> None:
        # Two well-separated groups — large y gap between them.
        svg = _wrap_ns(
            '<text x="10" y="20">Group A</text>'
            '<text x="10" y="30">A Item</text>'
            '<text x="10" y="200">Group B</text>'
            '<text x="10" y="210">B Item</text>'
        )
        out = _extract(extractor, svg)
        assert len(out.headings) == 2
        assert out.headings[0].text == "Group A"
        assert out.headings[1].text == "Group B"

    def test_reading_order_preserved(
        self, extractor: SvgExtractor
    ) -> None:
        # Even if declared out of order in the source, the
        # cluster walks them top-to-bottom.
        svg = _wrap_ns(
            '<text x="10" y="40">Last</text>'
            '<text x="10" y="20">First</text>'
            '<text x="10" y="30">Middle</text>'
        )
        out = _extract(extractor, svg)
        parent = out.headings[0]
        assert parent.text == "First"
        assert [c.text for c in parent.children] == [
            "Middle",
            "Last",
        ]

    def test_clusters_attached_under_title_when_present(
        self, extractor: SvgExtractor
    ) -> None:
        # With a root title, cluster headings become level-2
        # children of it rather than top-level siblings.
        svg = _wrap_ns(
            "<title>Diagram</title>"
            '<text x="10" y="20">Label A</text>'
            '<text x="10" y="30">Label B</text>'
        )
        out = _extract(extractor, svg)
        assert len(out.headings) == 1
        title = out.headings[0]
        assert title.text == "Diagram"
        # Title's children: the cluster parent (level 2).
        assert len(title.children) == 1
        cluster_parent = title.children[0]
        assert cluster_parent.text == "Label A"
        assert cluster_parent.level == 2
        # Cluster's own child (level 3).
        assert len(cluster_parent.children) == 1
        assert cluster_parent.children[0].text == "Label B"
        assert cluster_parent.children[0].level == 3


# ---------------------------------------------------------------------------
# Text deduplication
# ---------------------------------------------------------------------------


class TestDeduplication:
    def test_duplicate_texts_dropped(
        self, extractor: SvgExtractor
    ) -> None:
        svg = _wrap_ns(
            '<text x="10" y="20">Repeated</text>'
            '<text x="10" y="30">Repeated</text>'
            '<text x="10" y="40">Unique</text>'
        )
        out = _extract(extractor, svg)
        texts = [out.headings[0].text] + [
            c.text for c in out.headings[0].children
        ]
        # "Repeated" appears only once.
        assert texts.count("Repeated") == 1
        assert "Unique" in texts

    def test_cluster_duplicates_of_title_filtered(
        self, extractor: SvgExtractor
    ) -> None:
        # A text label identical to the root title shouldn't
        # appear again under it.
        svg = _wrap_ns(
            "<title>System</title>"
            '<text x="10" y="20">System</text>'
            '<text x="10" y="30">Component</text>'
        )
        out = _extract(extractor, svg)
        title = out.headings[0]
        descendants = [
            h.text for h in title.children
        ] + [
            gc.text
            for c in title.children
            for gc in c.children
        ]
        # "System" only appears as the root title, not repeated.
        assert "System" not in descendants
        assert "Component" in descendants


# ---------------------------------------------------------------------------
# Long-text filtering
# ---------------------------------------------------------------------------


class TestLongTextFiltering:
    def test_long_text_dropped_from_headings(
        self, extractor: SvgExtractor
    ) -> None:
        # 2.8.3c filters text > 80 chars. In 2.8.3e these
        # become DocProseBlock entries — until then they are
        # silently dropped so heading leaves stay label-sized.
        long_text = "x" * 120
        svg = _wrap_ns(
            f'<text x="10" y="20">Short</text>'
            f'<text x="10" y="30">{long_text}</text>'
            f'<text x="10" y="40">Another Short</text>'
        )
        out = _extract(extractor, svg)
        # Long text doesn't appear as a heading.
        all_texts = [h.text for h in out.all_headings_flat]
        assert long_text not in all_texts
        # Short labels survive.
        assert "Short" in all_texts
        assert "Another Short" in all_texts

    def test_threshold_boundary_exact_80_preserved(
        self, extractor: SvgExtractor
    ) -> None:
        # Text at exactly 80 chars is NOT filtered — threshold
        # is strict inequality (> 80).
        boundary = "x" * 80
        svg = _wrap_ns(
            f'<text x="10" y="20">{boundary}</text>'
        )
        out = _extract(extractor, svg)
        assert len(out.headings) == 1
        assert out.headings[0].text == boundary


# ---------------------------------------------------------------------------
# Non-visual element filtering
# ---------------------------------------------------------------------------


class TestNonVisualFiltering:
    def test_defs_skipped(
        self, extractor: SvgExtractor
    ) -> None:
        svg = _wrap_ns(
            '<defs><text x="0" y="0">In defs</text></defs>'
            '<text x="10" y="20">Real label</text>'
        )
        out = _extract(extractor, svg)
        all_texts = [h.text for h in out.all_headings_flat]
        assert "In defs" not in all_texts
        assert "Real label" in all_texts

    def test_style_skipped(
        self, extractor: SvgExtractor
    ) -> None:
        svg = _wrap_ns(
            '<style>text { fill: red }</style>'
            '<text x="10" y="20">Visible</text>'
        )
        out = _extract(extractor, svg)
        texts = [h.text for h in out.all_headings_flat]
        # The style tag's text content isn't promoted.
        assert "text { fill: red }" not in texts
        assert "Visible" in texts

    def test_script_skipped(
        self, extractor: SvgExtractor
    ) -> None:
        svg = _wrap_ns(
            '<script><text x="0" y="0">In script</text></script>'
            '<text x="10" y="20">Label</text>'
        )
        out = _extract(extractor, svg)
        all_texts = [h.text for h in out.all_headings_flat]
        assert "In script" not in all_texts
        assert "Label" in all_texts

    def test_clippath_skipped(
        self, extractor: SvgExtractor
    ) -> None:
        svg = _wrap_ns(
            '<clipPath><text x="0" y="0">In clipPath</text></clipPath>'
            '<text x="10" y="20">Real</text>'
        )
        out = _extract(extractor, svg)
        texts = [h.text for h in out.all_headings_flat]
        assert "In clipPath" not in texts
        assert "Real" in texts

    def test_symbol_skipped(
        self, extractor: SvgExtractor
    ) -> None:
        # <symbol> defines reusable content — not actual outline.
        svg = _wrap_ns(
            '<symbol id="icon"><text x="0" y="0">In symbol</text></symbol>'
            '<text x="10" y="20">Real</text>'
        )
        out = _extract(extractor, svg)
        texts = [h.text for h in out.all_headings_flat]
        assert "In symbol" not in texts
        assert "Real" in texts


# ---------------------------------------------------------------------------
# Tspan handling
# ---------------------------------------------------------------------------


class TestTspan:
    def test_tspan_content_joined(
        self, extractor: SvgExtractor
    ) -> None:
        svg = _wrap_ns(
            '<text x="10" y="20">'
            '<tspan>First</tspan>'
            '<tspan>Second</tspan>'
            "</text>"
        )
        out = _extract(extractor, svg)
        assert len(out.headings) == 1
        assert out.headings[0].text == "First Second"

    def test_tspan_with_base_text(
        self, extractor: SvgExtractor
    ) -> None:
        svg = _wrap_ns(
            '<text x="10" y="20">Main <tspan>extra</tspan></text>'
        )
        out = _extract(extractor, svg)
        # Element text and tspan content joined.
        assert "Main" in out.headings[0].text
        assert "extra" in out.headings[0].text


# ---------------------------------------------------------------------------
# Transform resolution in text position
# ---------------------------------------------------------------------------


class TestTransformResolution:
    def test_group_translate_applied_to_text_position(
        self, extractor: SvgExtractor
    ) -> None:
        # A text inside a translated group should position
        # correctly after transform resolution. We verify this
        # indirectly: two clusters, one translated to appear
        # above the other, should emit in that reading order.
        svg = _wrap_ns(
            # Ungrouped text at y=200 (declared second).
            '<text x="10" y="200">Bottom</text>'
            # Grouped text translated to y=30 (declared first
            # in source, but ends up at y=30 after transform).
            '<g transform="translate(0, 20)">'
            '<text x="10" y="10">Top</text>'
            '</g>'
        )
        out = _extract(extractor, svg)
        # Reading order: Top (y=30 after transform) before
        # Bottom (y=200).
        all_texts = [h.text for h in out.all_headings_flat]
        assert all_texts.index("Top") < all_texts.index("Bottom")


# ---------------------------------------------------------------------------
# Doc type
# ---------------------------------------------------------------------------


class TestDocType:
    def test_default_is_unknown(
        self, extractor: SvgExtractor
    ) -> None:
        out = _extract(extractor, _wrap_ns("<title>X</title>"))
        # 2.8.3c doesn't implement SVG-specific doc type
        # heuristics — outlines default to "unknown".
        assert out.doc_type == "unknown"


# ---------------------------------------------------------------------------
# Containment tree (2.8.3d)
# ---------------------------------------------------------------------------


class TestContainmentBasic:
    """Shapes containing text produce hierarchical headings."""

    def test_text_attached_to_containing_rect(
        self, extractor: SvgExtractor
    ) -> None:
        # A rect containing one text — single-text box
        # labelling picks the text as the label.
        svg = _wrap_ns(
            '<rect x="0" y="0" width="100" height="100"/>'
            '<text x="20" y="50">Inside</text>'
        )
        out = _extract(extractor, svg)
        assert len(out.headings) == 1
        assert out.headings[0].text == "Inside"

    def test_text_outside_any_shape_sits_at_root(
        self, extractor: SvgExtractor
    ) -> None:
        # Rect at (0,0)-(50,50), text at (200,200) — text is
        # not contained, becomes a root heading.
        svg = _wrap_ns(
            '<rect x="0" y="0" width="50" height="50"/>'
            '<text x="200" y="200">Outside</text>'
        )
        out = _extract(extractor, svg)
        # Outside text lands as a root heading; the empty
        # rect has no label and no contents so it's skipped.
        texts = [h.text for h in out.all_headings_flat]
        assert "Outside" in texts

    def test_nested_rects_form_tree(
        self, extractor: SvgExtractor
    ) -> None:
        # Outer rect 0-100, inner rect 20-50 (both sides).
        # Outer gets its label from a single inside-text;
        # inner does likewise. But a text at (30,40) lands
        # in the INNER (smaller containing box).
        svg = _wrap_ns(
            # Outer group with explicit label.
            '<g aria-label="Frontend">'
            '<rect x="0" y="0" width="100" height="100"/>'
            '</g>'
            # Inner group with explicit label.
            '<g aria-label="Auth">'
            '<rect x="20" y="20" width="30" height="30"/>'
            '</g>'
            # Text at (30, 40) — inside both, but inner wins
            # (smallest containing).
            '<text x="30" y="40">OAuth2</text>'
        )
        out = _extract(extractor, svg)
        # Frontend is a top-level heading.
        assert len(out.headings) == 1
        frontend = out.headings[0]
        assert frontend.text == "Frontend"
        # Auth is nested under Frontend.
        assert len(frontend.children) == 1
        auth = frontend.children[0]
        assert auth.text == "Auth"
        # OAuth2 is a leaf under Auth.
        assert len(auth.children) == 1
        assert auth.children[0].text == "OAuth2"

    def test_sibling_boxes_stay_flat(
        self, extractor: SvgExtractor
    ) -> None:
        # Two non-overlapping boxes — siblings, not nested.
        svg = _wrap_ns(
            '<g aria-label="Box A">'
            '<rect x="0" y="0" width="100" height="100"/>'
            '</g>'
            '<g aria-label="Box B">'
            '<rect x="200" y="0" width="100" height="100"/>'
            '</g>'
        )
        out = _extract(extractor, svg)
        assert len(out.headings) == 2
        assert out.headings[0].text == "Box A"
        assert out.headings[1].text == "Box B"


class TestContainmentLabels:
    """Three-level labeling rule."""

    def test_aria_label_wins_over_text(
        self, extractor: SvgExtractor
    ) -> None:
        # Explicit aria-label on the group takes priority
        # over single-text inference.
        svg = _wrap_ns(
            '<g aria-label="Explicit Label">'
            '<rect x="0" y="0" width="100" height="100"/>'
            '<text x="20" y="50">Text Inside</text>'
            '</g>'
        )
        out = _extract(extractor, svg)
        assert len(out.headings) == 1
        heading = out.headings[0]
        assert heading.text == "Explicit Label"
        # The text becomes a child leaf.
        assert len(heading.children) == 1
        assert heading.children[0].text == "Text Inside"

    def test_inkscape_label_used(
        self, extractor: SvgExtractor
    ) -> None:
        svg = _wrap_ns(
            '<g inkscape:label="Inkscape Label" '
            'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">'
            '<rect x="0" y="0" width="100" height="100"/>'
            '<text x="20" y="50">A</text>'
            '<text x="20" y="80">B</text>'
            '</g>'
        )
        out = _extract(extractor, svg)
        assert out.headings[0].text == "Inkscape Label"

    def test_aria_label_beats_inkscape_label(
        self, extractor: SvgExtractor
    ) -> None:
        svg = _wrap_ns(
            '<g aria-label="Aria" '
            'inkscape:label="Inkscape" '
            'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">'
            '<rect x="0" y="0" width="100" height="100"/>'
            '</g>'
        )
        # Single-text inference doesn't apply (no text), and
        # aria-label beats inkscape:label.
        out = _extract(extractor, svg)
        # The rect has an aria-label, but no contents — it
        # emits a heading with that label.
        assert out.headings[0].text == "Aria"

    def test_id_used_when_not_auto_generated(
        self, extractor: SvgExtractor
    ) -> None:
        svg = _wrap_ns(
            '<g id="user-chosen-name">'
            '<rect x="0" y="0" width="100" height="100"/>'
            '<text x="20" y="20">A</text>'
            '<text x="20" y="50">B</text>'
            '</g>'
        )
        out = _extract(extractor, svg)
        assert out.headings[0].text == "user-chosen-name"

    def test_auto_generated_id_ignored(
        self, extractor: SvgExtractor
    ) -> None:
        # g123 matches the auto-id regex — not used as a
        # label. Single-text inference applies instead.
        svg = _wrap_ns(
            '<g id="g123">'
            '<rect x="0" y="0" width="100" height="100"/>'
            '<text x="20" y="50">Real Label</text>'
            '</g>'
        )
        out = _extract(extractor, svg)
        assert out.headings[0].text == "Real Label"

    def test_group_underscore_number_auto_id(
        self, extractor: SvgExtractor
    ) -> None:
        # Group_42 pattern.
        svg = _wrap_ns(
            '<g id="Group_42">'
            '<rect x="0" y="0" width="100" height="100"/>'
            '<text x="20" y="50">Genuine</text>'
            '</g>'
        )
        out = _extract(extractor, svg)
        assert out.headings[0].text == "Genuine"

    def test_single_text_inference(
        self, extractor: SvgExtractor
    ) -> None:
        # No explicit label, rect contains one text → text is
        # the label.
        svg = _wrap_ns(
            '<rect x="0" y="0" width="100" height="100"/>'
            '<text x="20" y="50">Single</text>'
        )
        out = _extract(extractor, svg)
        assert out.headings[0].text == "Single"

    def test_multi_text_unlabeled_box_uses_neutral_identifier(
        self, extractor: SvgExtractor
    ) -> None:
        # No label, multiple texts → neutral "(box)" with
        # texts as children.
        svg = _wrap_ns(
            '<rect x="0" y="0" width="100" height="100"/>'
            '<text x="20" y="30">Alpha</text>'
            '<text x="20" y="50">Beta</text>'
            '<text x="20" y="70">Gamma</text>'
        )
        out = _extract(extractor, svg)
        assert len(out.headings) == 1
        box = out.headings[0]
        assert box.text == "(box)"
        child_texts = [c.text for c in box.children]
        assert "Alpha" in child_texts
        assert "Beta" in child_texts
        assert "Gamma" in child_texts

    def test_empty_unlabeled_box_skipped(
        self, extractor: SvgExtractor
    ) -> None:
        # A rect with no label and no contents emits nothing.
        svg = _wrap_ns(
            '<rect x="0" y="0" width="100" height="100"/>'
        )
        out = _extract(extractor, svg)
        assert out.headings == []


class TestContainmentReadingOrder:
    """Sibling shapes order y-then-x within each level."""

    def test_vertical_stack_ordered_top_to_bottom(
        self, extractor: SvgExtractor
    ) -> None:
        # Second declared is lower y — it should emit second.
        svg = _wrap_ns(
            '<g aria-label="Top">'
            '<rect x="0" y="0" width="100" height="100"/>'
            '</g>'
            '<g aria-label="Bottom">'
            '<rect x="0" y="200" width="100" height="100"/>'
            '</g>'
        )
        out = _extract(extractor, svg)
        assert [h.text for h in out.headings] == ["Top", "Bottom"]

    def test_declaration_order_does_not_override_reading_order(
        self, extractor: SvgExtractor
    ) -> None:
        # Declare Bottom first in source, but y puts Top first.
        svg = _wrap_ns(
            '<g aria-label="Bottom">'
            '<rect x="0" y="200" width="100" height="100"/>'
            '</g>'
            '<g aria-label="Top">'
            '<rect x="0" y="0" width="100" height="100"/>'
            '</g>'
        )
        out = _extract(extractor, svg)
        assert [h.text for h in out.headings] == ["Top", "Bottom"]

    def test_same_row_ordered_left_to_right(
        self, extractor: SvgExtractor
    ) -> None:
        # Same y, different x — left first.
        svg = _wrap_ns(
            '<g aria-label="Right">'
            '<rect x="200" y="50" width="100" height="50"/>'
            '</g>'
            '<g aria-label="Left">'
            '<rect x="0" y="50" width="100" height="50"/>'
            '</g>'
        )
        out = _extract(extractor, svg)
        assert [h.text for h in out.headings] == ["Left", "Right"]


class TestContainmentShapes:
    """Circles, ellipses, polygons, paths all act as containers."""

    def test_circle_as_container(
        self, extractor: SvgExtractor
    ) -> None:
        # Circle at (50, 50) radius 40 — bbox (10, 10, 90, 90).
        # Text at (50, 50) is contained.
        svg = _wrap_ns(
            '<g aria-label="CircleGroup">'
            '<circle cx="50" cy="50" r="40"/>'
            '</g>'
            '<text x="50" y="50">Inside Circle</text>'
        )
        out = _extract(extractor, svg)
        assert out.headings[0].text == "CircleGroup"
        # The text got attached to the circle's box.
        assert len(out.headings[0].children) == 1
        assert out.headings[0].children[0].text == "Inside Circle"

    def test_ellipse_as_container(
        self, extractor: SvgExtractor
    ) -> None:
        svg = _wrap_ns(
            '<g aria-label="E">'
            '<ellipse cx="100" cy="50" rx="80" ry="30"/>'
            '</g>'
            '<text x="100" y="50">In</text>'
        )
        out = _extract(extractor, svg)
        assert out.headings[0].text == "E"
        assert len(out.headings[0].children) == 1

    def test_polygon_as_container(
        self, extractor: SvgExtractor
    ) -> None:
        # Triangle with wide bounding box.
        svg = _wrap_ns(
            '<g aria-label="Tri">'
            '<polygon points="0,0 100,0 50,100"/>'
            '</g>'
            '<text x="50" y="30">Inside</text>'
        )
        out = _extract(extractor, svg)
        assert out.headings[0].text == "Tri"
        # Polygon bbox-contains the text's point even though
        # geometrically the triangle might not. Acceptable
        # approximation per specs4.
        assert len(out.headings[0].children) == 1

    def test_path_as_container(
        self, extractor: SvgExtractor
    ) -> None:
        # Simple rectangular path.
        svg = _wrap_ns(
            '<g aria-label="P">'
            '<path d="M 0 0 L 100 0 L 100 100 L 0 100 Z"/>'
            '</g>'
            '<text x="50" y="50">In Path</text>'
        )
        out = _extract(extractor, svg)
        assert out.headings[0].text == "P"
        assert len(out.headings[0].children) == 1

    def test_zero_dimension_rect_ignored(
        self, extractor: SvgExtractor
    ) -> None:
        # A rect with width=0 doesn't become a container.
        svg = _wrap_ns(
            '<rect x="0" y="0" width="0" height="100"/>'
            '<text x="0" y="50">Text</text>'
        )
        out = _extract(extractor, svg)
        # Shape-less behaviour: text lands as a root heading.
        assert out.headings[0].text == "Text"


class TestContainmentTransforms:
    """Transforms apply to shape bounding boxes before containment."""

    def test_translated_rect_contains_transformed_text(
        self, extractor: SvgExtractor
    ) -> None:
        # Rect declared at (0, 0) but translated to (50, 50).
        # Text at local (0, 0) translated to (60, 60) — inside
        # the translated rect (50, 50) to (150, 150).
        svg = _wrap_ns(
            '<g transform="translate(50, 50)">'
            '<g aria-label="Shifted">'
            '<rect x="0" y="0" width="100" height="100"/>'
            '<text x="10" y="10">Shifted Text</text>'
            '</g>'
            '</g>'
        )
        out = _extract(extractor, svg)
        assert out.headings[0].text == "Shifted"
        assert len(out.headings[0].children) == 1

    def test_scaled_rect_still_contains_text(
        self, extractor: SvgExtractor
    ) -> None:
        # Rect at local (0, 0)-(10, 10) scaled 2×. Bbox
        # becomes (0, 0)-(20, 20). Text at (5, 5) is inside.
        svg = _wrap_ns(
            '<g transform="scale(2)" aria-label="Scaled">'
            '<rect x="0" y="0" width="10" height="10"/>'
            '<text x="2.5" y="2.5">Scaled Text</text>'
            '</g>'
        )
        out = _extract(extractor, svg)
        assert out.headings[0].text == "Scaled"


class TestContainmentRootTitle:
    """Containment tree attaches under a root title when present."""

    def test_shapes_become_children_of_title(
        self, extractor: SvgExtractor
    ) -> None:
        svg = _wrap_ns(
            "<title>Architecture</title>"
            '<g aria-label="Frontend">'
            '<rect x="0" y="0" width="100" height="100"/>'
            '</g>'
            '<g aria-label="Backend">'
            '<rect x="200" y="0" width="100" height="100"/>'
            '</g>'
        )
        out = _extract(extractor, svg)
        assert len(out.headings) == 1
        title = out.headings[0]
        assert title.text == "Architecture"
        # Shape headings attach under the title at level 2.
        assert len(title.children) == 2
        assert title.children[0].text == "Frontend"
        assert title.children[0].level == 2
        assert title.children[1].text == "Backend"


class TestContainmentNestedTexts:
    """Texts attach to the SMALLEST containing shape."""

    def test_text_goes_to_smaller_of_nested_shapes(
        self, extractor: SvgExtractor
    ) -> None:
        # Outer contains inner contains text.
        svg = _wrap_ns(
            '<g aria-label="Outer">'
            '<rect x="0" y="0" width="100" height="100"/>'
            '</g>'
            '<g aria-label="Inner">'
            '<rect x="20" y="20" width="30" height="30"/>'
            '</g>'
            '<text x="30" y="40">Deep</text>'
        )
        out = _extract(extractor, svg)
        # Text attaches to Inner, not Outer.
        outer = out.headings[0]
        assert outer.text == "Outer"
        inner = outer.children[0]
        assert inner.text == "Inner"
        assert len(inner.children) == 1
        assert inner.children[0].text == "Deep"
        # Outer has no direct text children (only Inner).
        outer_text_children = [
            c for c in outer.children if c.text != "Inner"
        ]
        assert outer_text_children == []


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


class TestLocalName:
    def test_strips_namespace_prefix(self) -> None:
        assert (
            _local_name("{http://www.w3.org/2000/svg}rect")
            == "rect"
        )

    def test_bare_tag_returned_verbatim(self) -> None:
        assert _local_name("rect") == "rect"

    def test_malformed_tag_without_closing_brace(self) -> None:
        # Defensive path — a malformed tag is rare but
        # possible. Shouldn't raise.
        assert _local_name("{broken") == "{broken"


class TestSpatialClusterHelper:
    def test_empty_input(self) -> None:
        assert _spatial_cluster([]) == []

    def test_single_element(self) -> None:
        el = _TextElement("x", 10, 20)
        clusters = _spatial_cluster([el])
        assert len(clusters) == 1
        assert clusters[0] == [el]

    def test_tight_group_clusters_together(self) -> None:
        # y-gaps of 10 each — median is 10, threshold is 20.
        # All elements group together.
        els = [
            _TextElement("a", 0, 10),
            _TextElement("b", 0, 20),
            _TextElement("c", 0, 30),
        ]
        clusters = _spatial_cluster(els)
        assert len(clusters) == 1
        assert len(clusters[0]) == 3

    def test_large_gap_splits(self) -> None:
        # y-gaps: 10, 10, 200 — median 10, threshold 20. Third
        # gap (200) splits.
        els = [
            _TextElement("a", 0, 10),
            _TextElement("b", 0, 20),
            _TextElement("c", 0, 30),
            _TextElement("d", 0, 230),
        ]
        clusters = _spatial_cluster(els)
        assert len(clusters) == 2
        assert len(clusters[0]) == 3
        assert len(clusters[1]) == 1