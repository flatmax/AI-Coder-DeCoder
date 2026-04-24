"""Tests for the doc-index data model.

Pins the shape of the dataclasses in
:mod:`ac_dc.doc_index.models` so future refactors (adding fields,
changing defaults, renaming) surface as test failures rather than
silent regressions in consumer code.

Testing philosophy matches the rest of the suite — the data model
itself has no behaviour beyond default construction and flat
iteration, so tests are brief. Deeper contract tests (how the
extractor populates the model, how the formatter renders it)
belong in the extractor and formatter test files respectively.
"""

from __future__ import annotations

import pytest

from ac_dc.doc_index.models import (
    DOC_TYPES,
    DocHeading,
    DocLink,
    DocOutline,
    DocProseBlock,
    DocSectionRef,
)


# ---------------------------------------------------------------------------
# DOC_TYPES
# ---------------------------------------------------------------------------


class TestDocTypes:
    def test_is_tuple_not_list(self) -> None:
        # Immutability matters — DOC_TYPES is consulted by the
        # detector and formatter as a fixed set. A list would
        # allow a caller to .append() and surprise downstream
        # consumers.
        assert isinstance(DOC_TYPES, tuple)

    def test_contains_expected_values(self) -> None:
        assert set(DOC_TYPES) == {
            "readme",
            "spec",
            "guide",
            "reference",
            "decision",
            "notes",
            "unknown",
        }

    def test_unknown_included(self) -> None:
        # "unknown" is the neutral default — every doc that
        # doesn't match a heuristic gets this type. If it were
        # ever removed by accident, the detector would raise or
        # silently produce empty-string types.
        assert "unknown" in DOC_TYPES


# ---------------------------------------------------------------------------
# DocSectionRef
# ---------------------------------------------------------------------------


class TestDocSectionRef:
    def test_target_path_required(self) -> None:
        with pytest.raises(TypeError):
            DocSectionRef()  # type: ignore[call-arg]

    def test_default_target_heading_is_none(self) -> None:
        ref = DocSectionRef(target_path="foo.md")
        assert ref.target_heading is None

    def test_document_level_ref(self) -> None:
        # No fragment — reference index emits this shape when a
        # link had no #anchor.
        ref = DocSectionRef(target_path="foo.md")
        assert ref.target_path == "foo.md"
        assert ref.target_heading is None

    def test_section_level_ref(self) -> None:
        ref = DocSectionRef(
            target_path="foo.md",
            target_heading="Section Two",
        )
        assert ref.target_heading == "Section Two"

    def test_is_mutable(self) -> None:
        # Plain @dataclass, not @dataclass(frozen=True). The
        # reference index builds these during its resolve pass
        # and may adjust fields incrementally. Freezing would
        # force a new object per change.
        ref = DocSectionRef(target_path="foo.md")
        ref.target_path = "bar.md"
        assert ref.target_path == "bar.md"


# ---------------------------------------------------------------------------
# DocLink
# ---------------------------------------------------------------------------


class TestDocLink:
    def test_target_required(self) -> None:
        with pytest.raises(TypeError):
            DocLink()  # type: ignore[call-arg]

    def test_defaults(self) -> None:
        link = DocLink(target="foo.md")
        assert link.line == 0
        assert link.source_heading == ""
        assert link.is_image is False

    def test_empty_source_heading_is_the_above_first_heading_case(self) -> None:
        # Links that sit above the first heading get an empty
        # string, not None. Pinned so the reference index can
        # cheaply skip with `if link.source_heading:`.
        link = DocLink(target="logo.svg", line=1)
        assert link.source_heading == ""

    def test_image_flag_set(self) -> None:
        link = DocLink(target="diagram.svg", is_image=True)
        assert link.is_image is True

    def test_regular_and_image_are_equivalent_otherwise(self) -> None:
        # Image flag is the only distinguisher — same line, same
        # source, same target all allowed with different flags.
        text_link = DocLink(
            target="foo.md#sec",
            line=10,
            source_heading="Intro",
        )
        image_link = DocLink(
            target="foo.md#sec",
            line=10,
            source_heading="Intro",
            is_image=True,
        )
        assert text_link != image_link
        assert text_link.target == image_link.target

    def test_target_preserves_fragment(self) -> None:
        # DocLink stores the raw href — fragment splitting
        # happens in the reference index during resolve. The
        # model shouldn't pre-split; it would make the
        # serialized form diverge from what was in the source.
        link = DocLink(target="foo.md#section-two")
        assert link.target == "foo.md#section-two"


# ---------------------------------------------------------------------------
# DocProseBlock
# ---------------------------------------------------------------------------


class TestDocProseBlock:
    def test_text_required(self) -> None:
        with pytest.raises(TypeError):
            DocProseBlock()  # type: ignore[call-arg]

    def test_defaults(self) -> None:
        block = DocProseBlock(text="A long paragraph of prose.")
        assert block.container_heading_id is None
        assert block.start_line == 0
        assert block.keywords == []

    def test_root_level_prose_has_none_container(self) -> None:
        # Prose directly at document root (no containing box)
        # uses None. Formatter check is `if container_id` so
        # None renders at the outline's top level.
        block = DocProseBlock(text="Root prose")
        assert block.container_heading_id is None

    def test_keywords_default_is_fresh_list(self) -> None:
        # Shared-mutable-default regression guard. Two
        # independently-constructed blocks must not share the
        # same default list.
        a = DocProseBlock(text="First")
        b = DocProseBlock(text="Second")
        a.keywords.append("kw")
        assert b.keywords == []

    def test_keywords_populated_post_enrichment(self) -> None:
        block = DocProseBlock(text="A flowchart explanation.")
        block.keywords = ["flowchart", "diagram", "explanation"]
        assert block.keywords == [
            "flowchart",
            "diagram",
            "explanation",
        ]

    def test_container_heading_id_is_string_not_reference(self) -> None:
        # Pinned explicitly — string identity keeps the JSON
        # sidecar serializable without custom encoding for
        # circular references.
        block = DocProseBlock(
            text="Inner prose",
            container_heading_id="System Overview",
        )
        assert isinstance(block.container_heading_id, str)


# ---------------------------------------------------------------------------
# DocHeading
# ---------------------------------------------------------------------------


class TestDocHeading:
    def test_text_and_level_required(self) -> None:
        with pytest.raises(TypeError):
            DocHeading()  # type: ignore[call-arg]
        with pytest.raises(TypeError):
            DocHeading(text="x")  # type: ignore[call-arg]

    def test_defaults(self) -> None:
        h = DocHeading(text="Intro", level=1)
        assert h.start_line == 0
        assert h.section_lines == 0
        assert h.keywords == []
        assert h.content_types == []
        assert h.children == []
        assert h.outgoing_refs == []
        assert h.incoming_ref_count == 0

    def test_level_range_is_not_constrained(self) -> None:
        # The dataclass doesn't validate 1..6. Markdown
        # extractor enforces level semantics; SVG nesting may
        # exceed 6 if boxes nest deeply. Validation belongs to
        # the extractor side, not the model.
        assert DocHeading(text="x", level=0).level == 0
        assert DocHeading(text="x", level=9).level == 9

    def test_lists_are_fresh_per_instance(self) -> None:
        # Shared-mutable-default guard for every list field.
        a = DocHeading(text="A", level=1)
        b = DocHeading(text="B", level=1)
        a.keywords.append("kw")
        a.content_types.append("table")
        a.children.append(DocHeading(text="child", level=2))
        a.outgoing_refs.append(DocSectionRef(target_path="x.md"))
        assert b.keywords == []
        assert b.content_types == []
        assert b.children == []
        assert b.outgoing_refs == []

    def test_incoming_ref_count_is_int(self) -> None:
        h = DocHeading(text="x", level=1, incoming_ref_count=5)
        assert h.incoming_ref_count == 5

    def test_nested_children(self) -> None:
        grandchild = DocHeading(text="Grandchild", level=3)
        child = DocHeading(
            text="Child",
            level=2,
            children=[grandchild],
        )
        parent = DocHeading(
            text="Parent",
            level=1,
            children=[child],
        )
        assert parent.children[0].children[0] is grandchild

    def test_start_line_is_one_indexed_by_convention(self) -> None:
        # Not enforced by the model — documented in the
        # docstring. Test pins the convention by using a
        # non-zero default-ish value and asserting it's
        # preserved.
        h = DocHeading(text="x", level=1, start_line=42)
        assert h.start_line == 42


# ---------------------------------------------------------------------------
# DocOutline
# ---------------------------------------------------------------------------


class TestDocOutline:
    def test_file_path_required(self) -> None:
        with pytest.raises(TypeError):
            DocOutline()  # type: ignore[call-arg]

    def test_defaults(self) -> None:
        o = DocOutline(file_path="foo.md")
        assert o.doc_type == "unknown"
        assert o.headings == []
        assert o.links == []
        assert o.prose_blocks == []

    def test_doc_type_accepts_any_string(self) -> None:
        # Dataclass doesn't validate against DOC_TYPES — detector
        # is responsible for producing a valid string. Keeps
        # tests simple and means a future doc_type addition
        # doesn't ripple through every model test.
        o = DocOutline(file_path="foo.md", doc_type="custom")
        assert o.doc_type == "custom"

    def test_lists_are_fresh_per_instance(self) -> None:
        a = DocOutline(file_path="a.md")
        b = DocOutline(file_path="b.md")
        a.headings.append(DocHeading(text="x", level=1))
        a.links.append(DocLink(target="y.md"))
        a.prose_blocks.append(DocProseBlock(text="z"))
        assert b.headings == []
        assert b.links == []
        assert b.prose_blocks == []

    def test_all_headings_flat_empty(self) -> None:
        o = DocOutline(file_path="foo.md")
        assert o.all_headings_flat == []

    def test_all_headings_flat_single_level(self) -> None:
        h1 = DocHeading(text="One", level=1)
        h2 = DocHeading(text="Two", level=1)
        o = DocOutline(file_path="foo.md", headings=[h1, h2])
        assert o.all_headings_flat == [h1, h2]

    def test_all_headings_flat_nested(self) -> None:
        grandchild = DocHeading(text="Grandchild", level=3)
        child1 = DocHeading(
            text="Child 1",
            level=2,
            children=[grandchild],
        )
        child2 = DocHeading(text="Child 2", level=2)
        parent = DocHeading(
            text="Parent",
            level=1,
            children=[child1, child2],
        )
        o = DocOutline(file_path="foo.md", headings=[parent])

        flat = o.all_headings_flat
        # Order is document order — parent first, then its
        # first child, then grandchild under first child,
        # then second child.
        assert flat == [parent, child1, grandchild, child2]

    def test_all_headings_flat_preserves_sibling_order(self) -> None:
        # Multiple top-level headings walked in order.
        h1 = DocHeading(text="First", level=1)
        h2_child = DocHeading(text="2.1", level=2)
        h2 = DocHeading(text="Second", level=1, children=[h2_child])
        h3 = DocHeading(text="Third", level=1)
        o = DocOutline(
            file_path="foo.md",
            headings=[h1, h2, h3],
        )
        assert o.all_headings_flat == [h1, h2, h2_child, h3]

    def test_all_headings_flat_returns_fresh_list(self) -> None:
        # Caller mutations shouldn't affect the outline's
        # heading tree. The flat list is a view built fresh
        # each call.
        h = DocHeading(text="x", level=1)
        o = DocOutline(file_path="foo.md", headings=[h])

        flat = o.all_headings_flat
        flat.append(DocHeading(text="injected", level=1))
        # Outline's real headings unchanged.
        assert len(o.headings) == 1
        # Next call produces a fresh list without the injection.
        assert o.all_headings_flat == [h]

    def test_file_path_matches_dict_key_convention(self) -> None:
        # Orchestrator stores outlines by repo-relative path.
        # The file_path field is redundant but useful for
        # standalone serialization. Pinned here so any future
        # rename drops the dupe cleanly.
        o = DocOutline(file_path="docs/spec.md")
        assert o.file_path == "docs/spec.md"

    def test_is_mutable(self) -> None:
        # Full-outline construction is incremental during
        # extraction — headings appended as they are found,
        # links appended from the link scanner, prose blocks
        # appended from SVG long-text capture. Frozen would
        # force a builder pattern for no benefit.
        o = DocOutline(file_path="foo.md")
        o.doc_type = "spec"
        o.headings.append(DocHeading(text="x", level=1))
        assert o.doc_type == "spec"
        assert len(o.headings) == 1