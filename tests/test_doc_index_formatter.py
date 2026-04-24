"""Tests for :class:`DocFormatter` — Layer 2.8.1e.

Covers:

- **Legend block** — doc-specific markers and path aliases.
- **Per-file header** — path with and without doc_type tag.
- **Annotation ordering** — keywords, content types, section
  size, incoming refs in the specs4-documented order.
- **Size threshold** — ``~Nln`` omitted below 5 lines.
- **Zero-ref omission** — ``←0`` never rendered.
- **Heading nesting** — level markers, depth indentation, and
  child ordering with outgoing refs interleaved.
- **Outgoing section refs** — rendered under source heading
  with document-level fallback when no fragment.
- **Document-level links summary** — dedup, first-seen order,
  fragment stripping, image flag ignored.
- **Path aliases** — inherited alias behaviour from
  :class:`BaseFormatter`.
- **Exclude files** — inherited exclusion from
  :class:`BaseFormatter`.
- **Deterministic output** — byte-identical across repeated
  calls and across reordered inputs.

The formatter is pure — no state carries across calls — so
tests construct their own fixtures inline.
"""

from __future__ import annotations

from ac_dc.doc_index.formatter import DocFormatter
from ac_dc.doc_index.models import (
    DocHeading,
    DocLink,
    DocOutline,
    DocSectionRef,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _h(
    text: str,
    level: int = 1,
    *,
    keywords: list[str] | None = None,
    content_types: list[str] | None = None,
    section_lines: int = 0,
    incoming: int = 0,
    children: list[DocHeading] | None = None,
    outgoing: list[DocSectionRef] | None = None,
) -> DocHeading:
    """Construct a DocHeading with all annotation fields."""
    return DocHeading(
        text=text,
        level=level,
        keywords=keywords or [],
        content_types=content_types or [],
        section_lines=section_lines,
        incoming_ref_count=incoming,
        children=children or [],
        outgoing_refs=outgoing or [],
    )


def _o(
    path: str,
    *,
    doc_type: str = "unknown",
    headings: list[DocHeading] | None = None,
    links: list[DocLink] | None = None,
) -> DocOutline:
    """Construct a DocOutline."""
    return DocOutline(
        file_path=path,
        doc_type=doc_type,
        headings=headings or [],
        links=links or [],
    )


def _link(target: str, *, source: str = "", is_image: bool = False) -> DocLink:
    return DocLink(
        target=target,
        source_heading=source,
        is_image=is_image,
    )


# ---------------------------------------------------------------------------
# Legend
# ---------------------------------------------------------------------------


class TestLegend:
    def test_legend_with_no_files(self) -> None:
        fmt = DocFormatter()
        legend = fmt.get_legend()
        # Doc-specific markers documented.
        assert "(kw1,kw2)=keywords" in legend
        assert "[table]=table" in legend
        assert "[code]=code" in legend
        assert "[formula]=math" in legend
        assert "~Nln=section line count" in legend
        assert "links:=document-level" in legend

    def test_legend_excludes_arrow_glyphs(self) -> None:
        # Pinned per the base class convention: keep → and ←
        # out of the legend so `next(line for line in result
        # if "→" in line)` finds the intended content line.
        fmt = DocFormatter()
        legend = fmt.get_legend()
        assert "→" not in legend
        assert "←" not in legend

    def test_legend_standalone_usable(self) -> None:
        # get_legend with no files still produces a non-empty
        # string — callers asking for just the legend don't
        # need to provide any files.
        fmt = DocFormatter()
        assert fmt.get_legend().strip()


# ---------------------------------------------------------------------------
# Empty input
# ---------------------------------------------------------------------------


class TestEmpty:
    def test_no_outlines_produces_empty(self) -> None:
        fmt = DocFormatter()
        assert fmt.format_files([]) == ""

    def test_outline_with_no_headings(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files([_o("empty.md")])
        # Just a header line with trailing newline from base.
        assert "empty.md:" in out
        # No heading lines at all.
        body = out.split("empty.md:")[1]
        # Only whitespace in the body.
        assert body.strip() == ""


# ---------------------------------------------------------------------------
# Per-file header
# ---------------------------------------------------------------------------


class TestHeader:
    def test_unknown_type_omits_tag(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files([_o("foo.md")])
        assert "foo.md:" in out
        # No bracketed type tag when doc_type == "unknown".
        assert "foo.md [unknown]" not in out

    def test_known_type_shows_tag(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files([_o("spec.md", doc_type="spec")])
        assert "spec.md [spec]:" in out

    def test_various_doc_types(self) -> None:
        fmt = DocFormatter()
        for doc_type in ("spec", "guide", "reference", "readme"):
            out = fmt.format_files(
                [_o(f"doc-{doc_type}.md", doc_type=doc_type)]
            )
            assert f"[{doc_type}]:" in out


# ---------------------------------------------------------------------------
# Heading level markers and indentation
# ---------------------------------------------------------------------------


class TestHeadingLevels:
    def test_level_1_single_hash(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files(
            [_o("foo.md", headings=[_h("Top", level=1)])]
        )
        assert "# Top" in out

    def test_level_2_double_hash(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files(
            [_o("foo.md", headings=[_h("Sub", level=2)])]
        )
        assert "## Sub" in out

    def test_all_six_levels(self) -> None:
        fmt = DocFormatter()
        # Construct a nested tree so each level renders.
        deepest = _h("L6", level=6)
        l5 = _h("L5", level=5, children=[deepest])
        l4 = _h("L4", level=4, children=[l5])
        l3 = _h("L3", level=3, children=[l4])
        l2 = _h("L2", level=2, children=[l3])
        l1 = _h("L1", level=1, children=[l2])
        out = fmt.format_files([_o("foo.md", headings=[l1])])
        # Each level marker present.
        for i, text in enumerate(
            ("L1", "L2", "L3", "L4", "L5", "L6"),
            start=1,
        ):
            assert f"{'#' * i} {text}" in out

    def test_nesting_indentation(self) -> None:
        # Top-level heading has no base indent; each level of
        # nesting adds two spaces.
        fmt = DocFormatter()
        child = _h("Child", level=2)
        parent = _h("Parent", level=1, children=[child])
        out = fmt.format_files([_o("foo.md", headings=[parent])])
        lines = out.splitlines()
        parent_line = next(ln for ln in lines if "Parent" in ln)
        child_line = next(ln for ln in lines if "Child" in ln)
        assert parent_line.startswith("# Parent")
        assert child_line.startswith("  ## Child")

    def test_level_clamped_at_6(self) -> None:
        # Defensive: if an extractor accidentally emits
        # level=7, we cap at ``######`` rather than produce
        # a run of 7 hashes.
        fmt = DocFormatter()
        out = fmt.format_files(
            [_o("foo.md", headings=[_h("Deep", level=7)])]
        )
        assert "###### Deep" in out
        assert "####### Deep" not in out

    def test_level_clamped_at_1(self) -> None:
        # Defensive lower bound.
        fmt = DocFormatter()
        out = fmt.format_files(
            [_o("foo.md", headings=[_h("Zero", level=0)])]
        )
        assert "# Zero" in out


# ---------------------------------------------------------------------------
# Annotations: keywords
# ---------------------------------------------------------------------------


class TestKeywords:
    def test_single_keyword(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files(
            [_o("foo.md", headings=[_h("Sec", keywords=["intro"])])]
        )
        assert "# Sec (intro)" in out

    def test_multiple_keywords_comma_space(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files(
            [
                _o(
                    "foo.md",
                    headings=[_h("Sec", keywords=["a", "b", "c"])],
                )
            ]
        )
        assert "# Sec (a, b, c)" in out

    def test_empty_keywords_omitted(self) -> None:
        # Most headings in 2.8.1 have empty keywords — the
        # parenthetical block is completely suppressed in
        # that case.
        fmt = DocFormatter()
        out = fmt.format_files(
            [_o("foo.md", headings=[_h("Sec", keywords=[])])]
        )
        heading_line = next(
            ln for ln in out.splitlines() if "Sec" in ln
        )
        assert "(" not in heading_line
        assert ")" not in heading_line


# ---------------------------------------------------------------------------
# Annotations: content types
# ---------------------------------------------------------------------------


class TestContentTypes:
    def test_single_type(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files(
            [
                _o(
                    "foo.md",
                    headings=[_h("Sec", content_types=["table"])],
                )
            ]
        )
        assert "[table]" in out

    def test_multiple_types_each_bracketed(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files(
            [
                _o(
                    "foo.md",
                    headings=[
                        _h(
                            "Sec",
                            content_types=["table", "code"],
                        )
                    ],
                )
            ]
        )
        line = next(ln for ln in out.splitlines() if "Sec" in ln)
        assert "[table]" in line
        assert "[code]" in line

    def test_order_preserved(self) -> None:
        # Content types render in the order the extractor
        # emitted them. The extractor detects in document
        # order, so the formatter preserves that signal.
        fmt = DocFormatter()
        out = fmt.format_files(
            [
                _o(
                    "foo.md",
                    headings=[
                        _h(
                            "Sec",
                            content_types=["formula", "code", "table"],
                        )
                    ],
                )
            ]
        )
        line = next(ln for ln in out.splitlines() if "Sec" in ln)
        # Verify the relative order of markers matches input.
        assert line.index("[formula]") < line.index("[code]")
        assert line.index("[code]") < line.index("[table]")


# ---------------------------------------------------------------------------
# Annotations: section size
# ---------------------------------------------------------------------------


class TestSectionSize:
    def test_size_above_threshold_rendered(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files(
            [_o("foo.md", headings=[_h("Sec", section_lines=45)])]
        )
        assert "~45ln" in out

    def test_size_at_threshold_rendered(self) -> None:
        # Threshold is ``>= 5`` so exactly 5 lines is
        # included — pins the boundary.
        fmt = DocFormatter()
        out = fmt.format_files(
            [_o("foo.md", headings=[_h("Sec", section_lines=5)])]
        )
        assert "~5ln" in out

    def test_size_below_threshold_omitted(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files(
            [_o("foo.md", headings=[_h("Sec", section_lines=4)])]
        )
        assert "~4ln" not in out

    def test_zero_size_omitted(self) -> None:
        # Default section_lines is 0 (uncomputed / trivial).
        # Should not render.
        fmt = DocFormatter()
        out = fmt.format_files(
            [_o("foo.md", headings=[_h("Sec")])]
        )
        assert "~0ln" not in out

    def test_large_size_rendered(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files(
            [_o("foo.md", headings=[_h("Big", section_lines=9999)])]
        )
        assert "~9999ln" in out


# ---------------------------------------------------------------------------
# Annotations: incoming refs
# ---------------------------------------------------------------------------


class TestIncomingRefs:
    def test_positive_count_rendered(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files(
            [_o("foo.md", headings=[_h("Sec", incoming=3)])]
        )
        assert "←3" in out

    def test_zero_count_omitted(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files(
            [_o("foo.md", headings=[_h("Sec", incoming=0)])]
        )
        assert "←0" not in out
        assert "←" not in out

    def test_large_count(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files(
            [_o("foo.md", headings=[_h("Sec", incoming=100)])]
        )
        assert "←100" in out


# ---------------------------------------------------------------------------
# Annotation ordering
# ---------------------------------------------------------------------------


class TestAnnotationOrdering:
    def test_full_order(self) -> None:
        # All four annotation categories populated. Verify
        # the spec-pinned order: kw, content types, size, refs.
        fmt = DocFormatter()
        out = fmt.format_files(
            [
                _o(
                    "foo.md",
                    headings=[
                        _h(
                            "Sec",
                            keywords=["intro"],
                            content_types=["table"],
                            section_lines=45,
                            incoming=3,
                        )
                    ],
                )
            ]
        )
        line = next(ln for ln in out.splitlines() if "Sec" in ln)
        # Ordered positions:
        idx_kw = line.index("(intro)")
        idx_ct = line.index("[table]")
        idx_sz = line.index("~45ln")
        idx_ref = line.index("←3")
        assert idx_kw < idx_ct < idx_sz < idx_ref

    def test_partial_annotations_skip_empty_slots(self) -> None:
        # Only content types + refs — keywords and size
        # absent. Output should have [table] followed
        # directly by ←2, no empty parens or size slot.
        fmt = DocFormatter()
        out = fmt.format_files(
            [
                _o(
                    "foo.md",
                    headings=[
                        _h(
                            "Sec",
                            content_types=["table"],
                            incoming=2,
                        )
                    ],
                )
            ]
        )
        line = next(ln for ln in out.splitlines() if "Sec" in ln)
        assert "[table] ←2" in line
        assert "(" not in line
        assert "~" not in line


# ---------------------------------------------------------------------------
# Outgoing refs (section-level)
# ---------------------------------------------------------------------------


class TestOutgoingRefs:
    def test_section_ref_rendered(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files(
            [
                _o(
                    "foo.md",
                    headings=[
                        _h(
                            "Top",
                            outgoing=[
                                DocSectionRef(
                                    target_path="other.md",
                                    target_heading="Sec",
                                )
                            ],
                        )
                    ],
                )
            ]
        )
        assert "→other.md#Sec" in out

    def test_document_level_ref_no_fragment(self) -> None:
        # target_heading=None → just the path, no ``#``.
        fmt = DocFormatter()
        out = fmt.format_files(
            [
                _o(
                    "foo.md",
                    headings=[
                        _h(
                            "Top",
                            outgoing=[
                                DocSectionRef(
                                    target_path="other.md",
                                    target_heading=None,
                                )
                            ],
                        )
                    ],
                )
            ]
        )
        assert "→other.md" in out
        assert "→other.md#" not in out

    def test_outgoing_indented_one_level_deeper(self) -> None:
        # A top-level heading (depth 0) has its outgoing refs
        # rendered at two-space indent. A level-2 heading
        # nested under it has its outgoing refs at four-space
        # indent.
        fmt = DocFormatter()
        inner = _h(
            "Inner",
            level=2,
            outgoing=[
                DocSectionRef(
                    target_path="inner-ref.md",
                    target_heading=None,
                )
            ],
        )
        outer = _h(
            "Outer",
            level=1,
            children=[inner],
            outgoing=[
                DocSectionRef(
                    target_path="outer-ref.md",
                    target_heading=None,
                )
            ],
        )
        out = fmt.format_files([_o("foo.md", headings=[outer])])
        lines = out.splitlines()
        # Outer's outgoing ref at two-space indent.
        outer_ref_line = next(
            ln for ln in lines if "outer-ref.md" in ln
        )
        assert outer_ref_line.startswith("  →")
        # Inner's outgoing ref at four-space indent.
        inner_ref_line = next(
            ln for ln in lines if "inner-ref.md" in ln
        )
        assert inner_ref_line.startswith("    →")

    def test_multiple_refs_preserved_in_order(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files(
            [
                _o(
                    "foo.md",
                    headings=[
                        _h(
                            "Top",
                            outgoing=[
                                DocSectionRef(
                                    target_path="first.md",
                                    target_heading=None,
                                ),
                                DocSectionRef(
                                    target_path="second.md",
                                    target_heading=None,
                                ),
                                DocSectionRef(
                                    target_path="third.md",
                                    target_heading=None,
                                ),
                            ],
                        )
                    ],
                )
            ]
        )
        idx1 = out.index("→first.md")
        idx2 = out.index("→second.md")
        idx3 = out.index("→third.md")
        assert idx1 < idx2 < idx3

    def test_refs_rendered_before_children(self) -> None:
        # Outgoing refs for a heading render BEFORE that
        # heading's child headings. Reads top-down as
        # heading → its refs → its children.
        fmt = DocFormatter()
        child = _h("Child", level=2)
        parent = _h(
            "Parent",
            level=1,
            children=[child],
            outgoing=[
                DocSectionRef(
                    target_path="ref.md",
                    target_heading=None,
                )
            ],
        )
        out = fmt.format_files([_o("foo.md", headings=[parent])])
        ref_idx = out.index("→ref.md")
        child_idx = out.index("## Child")
        assert ref_idx < child_idx


# ---------------------------------------------------------------------------
# Document-level links summary
# ---------------------------------------------------------------------------


class TestLinksSummary:
    def test_links_line_appears(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files(
            [
                _o(
                    "foo.md",
                    headings=[_h("Top")],
                    links=[_link("other.md")],
                )
            ]
        )
        assert "  links: other.md" in out

    def test_multiple_links_comma_space_joined(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files(
            [
                _o(
                    "foo.md",
                    headings=[_h("Top")],
                    links=[
                        _link("a.md"),
                        _link("b.md"),
                        _link("c.md"),
                    ],
                )
            ]
        )
        assert "  links: a.md, b.md, c.md" in out

    def test_no_links_no_line(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files(
            [_o("foo.md", headings=[_h("Top")])]
        )
        # The legend itself contains the literal string
        # "links:" describing the marker. Check that no
        # non-legend line contains a leading-whitespace
        # "links:" — that's the summary-line shape.
        for line in out.splitlines():
            assert not line.lstrip().startswith("links:") or line.startswith("#")

    def test_deduplicated_first_seen_order(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files(
            [
                _o(
                    "foo.md",
                    headings=[_h("Top")],
                    links=[
                        _link("b.md"),
                        _link("a.md"),
                        _link("b.md"),
                        _link("a.md"),
                    ],
                )
            ]
        )
        # First-seen order: b, then a.
        assert "links: b.md, a.md" in out

    def test_fragment_stripped_for_dedup(self) -> None:
        # Two links to the same target but different fragments
        # collapse to one entry. Fragments are visible via the
        # per-heading outgoing refs, not in the document-level
        # links summary.
        fmt = DocFormatter()
        out = fmt.format_files(
            [
                _o(
                    "foo.md",
                    headings=[_h("Top")],
                    links=[
                        _link("other.md#section-a"),
                        _link("other.md#section-b"),
                    ],
                )
            ]
        )
        assert "links: other.md" in out
        # The summary line contains only one entry for other.md.
        # Filter to the actual summary line — the legend also
        # contains "links:" as a marker description.
        links_line = next(
            ln for ln in out.splitlines()
            if "links:" in ln and not ln.startswith("#")
        )
        assert links_line.count("other.md") == 1

    def test_image_flag_ignored_in_summary(self) -> None:
        # Image links appear in the summary same as text links.
        fmt = DocFormatter()
        out = fmt.format_files(
            [
                _o(
                    "foo.md",
                    headings=[_h("Top")],
                    links=[
                        _link("diagram.svg", is_image=True),
                        _link("doc.md"),
                    ],
                )
            ]
        )
        assert "links: diagram.svg, doc.md" in out

    def test_fragment_only_target_excluded(self) -> None:
        # Fragment-only targets ("#section") are in-page
        # anchors; they shouldn't pollute the cross-document
        # summary. Extractors should filter them too, but
        # defense in depth is cheap.
        fmt = DocFormatter()
        out = fmt.format_files(
            [
                _o(
                    "foo.md",
                    headings=[_h("Top")],
                    links=[
                        _link("#self-anchor"),
                        _link("other.md"),
                    ],
                )
            ]
        )
        assert "links: other.md" in out
        # Self-anchor not in the summary. Filter to the real
        # summary line — the legend also contains "links:".
        links_line = next(
            ln for ln in out.splitlines()
            if "links:" in ln and not ln.startswith("#")
        )
        assert "#self-anchor" not in links_line


# ---------------------------------------------------------------------------
# Multi-file output
# ---------------------------------------------------------------------------


class TestMultiFile:
    def test_alphabetical_file_ordering(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files(
            [
                _o("z.md", headings=[_h("Z")]),
                _o("a.md", headings=[_h("A")]),
                _o("m.md", headings=[_h("M")]),
            ]
        )
        # base_formatter sorts paths before rendering.
        idx_a = out.index("a.md:")
        idx_m = out.index("m.md:")
        idx_z = out.index("z.md:")
        assert idx_a < idx_m < idx_z

    def test_blank_line_between_blocks(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files(
            [
                _o("a.md", headings=[_h("A")]),
                _o("b.md", headings=[_h("B")]),
            ]
        )
        # Blocks separated by blank line — base uses "\n\n"
        # join between per-file blocks.
        assert "\n\n" in out


# ---------------------------------------------------------------------------
# Path aliasing (inherited from BaseFormatter)
# ---------------------------------------------------------------------------


class TestPathAliases:
    def test_long_repeated_prefix_aliased(self) -> None:
        # Three files under the same long prefix → alias
        # earned (_MIN_ALIAS_USE_COUNT=3, prefix ≥ 8 chars).
        fmt = DocFormatter()
        out = fmt.format_files(
            [
                _o(
                    "specs/project/a.md",
                    headings=[_h("A")],
                ),
                _o(
                    "specs/project/b.md",
                    headings=[_h("B")],
                ),
                _o(
                    "specs/project/c.md",
                    headings=[_h("C")],
                ),
            ]
        )
        # The legend declares at least one @-alias.
        assert "@1/" in out
        # Paths use the alias instead of the full prefix.
        assert "@1/a.md:" in out
        assert "@1/b.md:" in out
        assert "@1/c.md:" in out

    def test_short_or_rare_prefix_not_aliased(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files(
            [
                # Only two files; below _MIN_ALIAS_USE_COUNT.
                _o("a.md", headings=[_h("A")]),
                _o("b.md", headings=[_h("B")]),
            ]
        )
        assert "@1/" not in out
        assert "a.md:" in out
        assert "b.md:" in out

    def test_alias_applied_to_link_targets(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files(
            [
                _o(
                    "specs/project/one.md",
                    headings=[_h("O")],
                    links=[_link("specs/project/two.md")],
                ),
                _o(
                    "specs/project/two.md",
                    headings=[_h("T")],
                ),
                _o(
                    "specs/project/three.md",
                    headings=[_h("Th")],
                ),
            ]
        )
        # Link target also uses the alias.
        assert "links: @1/two.md" in out

    def test_alias_applied_to_outgoing_refs(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files(
            [
                _o(
                    "specs/project/one.md",
                    headings=[
                        _h(
                            "O",
                            outgoing=[
                                DocSectionRef(
                                    target_path="specs/project/two.md",
                                    target_heading="Sec",
                                )
                            ],
                        )
                    ],
                ),
                _o("specs/project/two.md", headings=[_h("T")]),
                _o("specs/project/three.md", headings=[_h("Th")]),
            ]
        )
        assert "→@1/two.md#Sec" in out


# ---------------------------------------------------------------------------
# Exclude files (inherited from BaseFormatter)
# ---------------------------------------------------------------------------


class TestExcludeFiles:
    def test_excluded_file_absent_from_output(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files(
            [
                _o("a.md", headings=[_h("A")]),
                _o("b.md", headings=[_h("B")]),
            ],
            exclude_files={"b.md"},
        )
        assert "a.md:" in out
        assert "b.md:" not in out

    def test_exclude_all_produces_empty(self) -> None:
        fmt = DocFormatter()
        out = fmt.format_files(
            [
                _o("a.md", headings=[_h("A")]),
                _o("b.md", headings=[_h("B")]),
            ],
            exclude_files={"a.md", "b.md"},
        )
        assert out == ""


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


class TestDeterminism:
    def test_repeated_calls_identical(self) -> None:
        fmt = DocFormatter()
        outline = _o(
            "foo.md",
            doc_type="spec",
            headings=[
                _h(
                    "Top",
                    keywords=["intro"],
                    content_types=["table"],
                    section_lines=20,
                    incoming=2,
                    children=[
                        _h("Sub", level=2),
                    ],
                    outgoing=[
                        DocSectionRef(
                            target_path="other.md",
                            target_heading="Sec",
                        )
                    ],
                )
            ],
            links=[_link("other.md"), _link("diagram.svg")],
        )
        out1 = fmt.format_files([outline])
        out2 = fmt.format_files([outline])
        assert out1 == out2

    def test_input_order_insensitive(self) -> None:
        fmt = DocFormatter()
        outlines = [
            _o("a.md", headings=[_h("A")]),
            _o("b.md", headings=[_h("B")]),
            _o("c.md", headings=[_h("C")]),
        ]
        out1 = fmt.format_files(outlines)
        out2 = fmt.format_files(list(reversed(outlines)))
        assert out1 == out2


# ---------------------------------------------------------------------------
# Realistic integration
# ---------------------------------------------------------------------------


class TestIntegration:
    def test_realistic_spec_outline(self) -> None:
        # Mirrors the example from
        # specs4/2-indexing/document-index.md.
        fmt = DocFormatter()
        cm = _h(
            "ContextManager",
            level=2,
            keywords=["FileContext", "token budget"],
            content_types=["code"],
            section_lines=85,
            incoming=3,
            outgoing=[
                DocSectionRef(
                    target_path="src/ac_dc/context.py",
                    target_heading=None,
                )
            ],
        )
        compaction = _h(
            "History Compaction",
            level=2,
            keywords=["trigger", "verbatim"],
            content_types=["code"],
            section_lines=120,
            incoming=2,
            children=[
                _h(
                    "Topic Detection",
                    level=3,
                    keywords=["LLM boundary"],
                    section_lines=45,
                    outgoing=[
                        DocSectionRef(
                            target_path="cache_tiering.md",
                            target_heading="History-Compaction",
                        )
                    ],
                )
            ],
        )
        top = _h(
            "Context & History",
            level=1,
            section_lines=280,
            incoming=5,
            children=[cm, compaction],
        )
        outline = _o(
            "specs3/3-llm-engine/context_and_history.md",
            doc_type="spec",
            headings=[top],
            links=[
                _link("cache_tiering.md"),
                _link("prompt_assembly.md"),
                _link("src/ac_dc/context.py"),
            ],
        )

        out = fmt.format_files([outline])

        # Verify key pieces of the shape.
        assert (
            "specs3/3-llm-engine/context_and_history.md [spec]:"
            in out
        )
        assert "# Context & History" in out
        assert "~280ln" in out
        assert "←5" in out
        assert "## ContextManager" in out
        assert "(FileContext, token budget)" in out
        assert "[code]" in out
        assert "←3" in out
        assert "→src/ac_dc/context.py" in out
        assert "### Topic Detection" in out
        assert (
            "→cache_tiering.md#History-Compaction" in out
        )
        assert (
            "links: cache_tiering.md, prompt_assembly.md, "
            "src/ac_dc/context.py"
        ) in out