"""Tests for :class:`DocReferenceIndex` — Layer 2.8.1d.

Covers:

- **Protocol compatibility with code-side ReferenceIndex** —
  :meth:`connected_components` and :meth:`file_ref_count` shape
  match so the stability tracker's initialisation uses the
  same code path for both indexes.
- **Section-level incoming counts** — links resolve to specific
  headings via slug matching; counts land on the right heading.
- **Slug normalisation** — GitHub-style lowercase-hyphen-strip.
- **Unresolved anchor fallback** — bad fragment still counts
  against the target document's top-level heading.
- **Self-reference exclusion** — a document linking to its own
  headings doesn't inflate its own counts.
- **Dedup per source-target pair** — multiple links from the
  same source heading to the same target heading count once.
- **Image links participate** — ``is_image=True`` links create
  edges same as regular links.
- **Idempotent rebuild** — state cleared on every :meth:`build`.
- **Bidirectional-only clustering** — one-way links don't cluster.

Uses real :class:`DocOutline` objects built from the extractor's
data model. No mocking — the model is cheap to construct and the
test failures surface the graph math directly.
"""

from __future__ import annotations

import pytest

from ac_dc.doc_index.models import (
    DocHeading,
    DocLink,
    DocOutline,
)
from ac_dc.doc_index.reference_index import (
    DocReferenceIndex,
    _parse_link_target,
    _slugify,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _outline(
    path: str,
    headings: list[DocHeading] | None = None,
    links: list[DocLink] | None = None,
) -> DocOutline:
    """Build a minimal outline with explicit headings and links."""
    return DocOutline(
        file_path=path,
        doc_type="unknown",
        headings=headings or [],
        links=links or [],
    )


def _h(text: str, level: int = 1, children: list[DocHeading] | None = None) -> DocHeading:
    """Build a heading with optional children."""
    return DocHeading(
        text=text,
        level=level,
        children=children or [],
    )


def _link(
    target: str,
    source_heading: str = "",
    is_image: bool = False,
) -> DocLink:
    """Build a link."""
    return DocLink(
        target=target,
        source_heading=source_heading,
        is_image=is_image,
    )


# ---------------------------------------------------------------------------
# Slug helper
# ---------------------------------------------------------------------------


class TestSlugify:
    def test_lowercase(self) -> None:
        assert _slugify("Section") == "section"

    def test_spaces_to_hyphens(self) -> None:
        assert _slugify("Section Two") == "section-two"

    def test_multiple_whitespace_collapsed(self) -> None:
        assert _slugify("Section   Two\t\tThree") == "section-two-three"

    def test_punctuation_stripped(self) -> None:
        assert _slugify("What's New?") == "whats-new"

    def test_empty(self) -> None:
        assert _slugify("") == ""

    def test_whitespace_only(self) -> None:
        assert _slugify("   ") == ""

    def test_punctuation_only(self) -> None:
        # All chars stripped → empty slug. Caller falls back.
        assert _slugify("!!!") == ""

    def test_already_slugged(self) -> None:
        # A slug fed back in is a fixed point.
        assert _slugify("section-two") == "section-two"

    def test_numbers_preserved(self) -> None:
        assert _slugify("Section 2.1") == "section-21"

    def test_unicode_stripped(self) -> None:
        # Non-ASCII chars don't match [a-z0-9-] so they're stripped.
        # GitHub's slug algorithm is more lenient but we don't need
        # unicode-aware slugging for realistic docs; pinned here to
        # document the behaviour so a future enhancement knows.
        assert _slugify("Café") == "caf"


# ---------------------------------------------------------------------------
# Target parsing
# ---------------------------------------------------------------------------


class TestParseLinkTarget:
    def test_path_only(self) -> None:
        assert _parse_link_target("foo.md") == ("foo.md", None)

    def test_path_with_fragment(self) -> None:
        assert _parse_link_target("foo.md#section") == ("foo.md", "section")

    def test_empty_fragment_treated_as_none(self) -> None:
        # foo.md# — the hash separator with nothing after isn't
        # a real fragment. Treat as document-level link.
        assert _parse_link_target("foo.md#") == ("foo.md", None)

    def test_fragment_only(self) -> None:
        # In-page anchor — empty path signals the caller to skip.
        assert _parse_link_target("#section") == ("", "section")

    def test_empty_target(self) -> None:
        assert _parse_link_target("") == ("", None)

    def test_multiple_hash_signs(self) -> None:
        # First hash wins; remainder is the fragment.
        assert _parse_link_target("foo.md#a#b") == ("foo.md", "a#b")


# ---------------------------------------------------------------------------
# Construction and empty state
# ---------------------------------------------------------------------------


class TestConstruction:
    def test_empty_initial_state(self) -> None:
        idx = DocReferenceIndex()
        assert idx.file_ref_count("anything.md") == 0
        assert idx.files_referencing("anything.md") == set()
        assert idx.file_dependencies("anything.md") == set()
        assert idx.bidirectional_edges() == set()
        assert idx.connected_components() == []

    def test_build_empty_list(self) -> None:
        idx = DocReferenceIndex()
        idx.build([])
        assert idx.file_ref_count("any.md") == 0
        assert idx.connected_components() == []

    def test_build_single_outline_no_links(self) -> None:
        idx = DocReferenceIndex()
        idx.build([_outline("solo.md", headings=[_h("Top")])])
        # Isolated file shows up as a singleton component.
        components = idx.connected_components()
        assert len(components) == 1
        assert components[0] == {"solo.md"}
        # No incoming refs.
        assert idx.file_ref_count("solo.md") == 0


# ---------------------------------------------------------------------------
# File-level edges (collapsed, weighted)
# ---------------------------------------------------------------------------


class TestFileLevelEdges:
    def test_single_link_creates_edge(self) -> None:
        a = _outline(
            "a.md",
            headings=[_h("Top")],
            links=[_link("b.md", source_heading="Top")],
        )
        b = _outline("b.md", headings=[_h("B Top")])
        idx = DocReferenceIndex()
        idx.build([a, b])
        assert idx.file_dependencies("a.md") == {"b.md"}
        assert idx.files_referencing("b.md") == {"a.md"}
        assert idx.file_ref_count("b.md") == 1

    def test_multiple_links_same_target_different_sections_count_twice(
        self,
    ) -> None:
        # Two DIFFERENT source headings link to the same target.
        # These are distinct edges — count should be 2.
        a = _outline(
            "a.md",
            headings=[_h("Intro"), _h("Outro")],
            links=[
                _link("b.md", source_heading="Intro"),
                _link("b.md", source_heading="Outro"),
            ],
        )
        b = _outline("b.md", headings=[_h("B")])
        idx = DocReferenceIndex()
        idx.build([a, b])
        assert idx.file_ref_count("b.md") == 2

    def test_duplicate_links_same_source_and_target_dedup(self) -> None:
        # Same source heading, same target, same fragment — one
        # conceptual edge, dedup'd.
        a = _outline(
            "a.md",
            headings=[_h("Intro")],
            links=[
                _link("b.md", source_heading="Intro"),
                _link("b.md", source_heading="Intro"),
            ],
        )
        b = _outline("b.md", headings=[_h("B")])
        idx = DocReferenceIndex()
        idx.build([a, b])
        assert idx.file_ref_count("b.md") == 1

    def test_different_target_sections_count_separately(self) -> None:
        # Same source, same target file, DIFFERENT target
        # fragments — two distinct edges.
        a = _outline(
            "a.md",
            headings=[_h("Intro")],
            links=[
                _link("b.md#section-one", source_heading="Intro"),
                _link("b.md#section-two", source_heading="Intro"),
            ],
        )
        b = _outline(
            "b.md",
            headings=[
                _h("B Top"),
                _h("Section One", level=2),
                _h("Section Two", level=2),
            ],
        )
        idx = DocReferenceIndex()
        idx.build([a, b])
        assert idx.file_ref_count("b.md") == 2

    def test_missing_target_outline_still_records_edge(self) -> None:
        # Link to a file we have no outline for — extractor
        # should filter, but defensively we still record the
        # file-level edge for clustering purposes.
        a = _outline(
            "a.md",
            headings=[_h("Top")],
            links=[_link("ghost.md", source_heading="Top")],
        )
        idx = DocReferenceIndex()
        idx.build([a])
        assert idx.file_dependencies("a.md") == {"ghost.md"}


# ---------------------------------------------------------------------------
# Heading-level incoming counts
# ---------------------------------------------------------------------------


class TestHeadingIncomingCounts:
    def test_document_level_link_increments_top_heading(self) -> None:
        b_top = _h("B Top")
        b_sub = _h("Section", level=2)
        b_top.children = [b_sub]
        a = _outline(
            "a.md",
            headings=[_h("A")],
            links=[_link("b.md", source_heading="A")],
        )
        b = _outline("b.md", headings=[b_top])
        idx = DocReferenceIndex()
        idx.build([a, b])
        assert b_top.incoming_ref_count == 1
        assert b_sub.incoming_ref_count == 0

    def test_fragment_link_resolves_to_matching_heading(self) -> None:
        # Link to #section-two should increment that specific heading.
        b_top = _h("B Top")
        b_one = _h("Section One", level=2)
        b_two = _h("Section Two", level=2)
        b_top.children = [b_one, b_two]
        a = _outline(
            "a.md",
            headings=[_h("A")],
            links=[_link("b.md#section-two", source_heading="A")],
        )
        b = _outline("b.md", headings=[b_top])
        idx = DocReferenceIndex()
        idx.build([a, b])
        assert b_top.incoming_ref_count == 0
        assert b_one.incoming_ref_count == 0
        assert b_two.incoming_ref_count == 1

    def test_fragment_matches_case_insensitive_via_slug(self) -> None:
        # Link fragment "SECTION-TWO" slugs to "section-two";
        # heading "Section Two" slugs to the same — match.
        b_top = _h("B")
        b_two = _h("Section Two", level=2)
        b_top.children = [b_two]
        a = _outline(
            "a.md",
            links=[_link("b.md#SECTION-TWO", source_heading="")],
        )
        b = _outline("b.md", headings=[b_top])
        idx = DocReferenceIndex()
        idx.build([a, b])
        assert b_two.incoming_ref_count == 1

    def test_fragment_with_punctuation_resolves(self) -> None:
        # Heading "What's New?" → slug "whats-new". Fragment
        # "whats-new" → same slug → match.
        b_top = _h("B")
        b_news = _h("What's New?", level=2)
        b_top.children = [b_news]
        a = _outline(
            "a.md",
            links=[_link("b.md#whats-new", source_heading="")],
        )
        b = _outline("b.md", headings=[b_top])
        idx = DocReferenceIndex()
        idx.build([a, b])
        assert b_news.incoming_ref_count == 1

    def test_unresolved_anchor_falls_back_to_top_level(self) -> None:
        # Fragment doesn't match any heading — fall back to top.
        b_top = _h("B")
        b_two = _h("Section Two", level=2)
        b_top.children = [b_two]
        a = _outline(
            "a.md",
            links=[_link("b.md#does-not-exist", source_heading="")],
        )
        b = _outline("b.md", headings=[b_top])
        idx = DocReferenceIndex()
        idx.build([a, b])
        # Top gets the count; specific heading doesn't.
        assert b_top.incoming_ref_count == 1
        assert b_two.incoming_ref_count == 0

    def test_deeply_nested_heading_resolves(self) -> None:
        # H1 > H2 > H3 — link fragment matches H3.
        grandchild = _h("Deep Section", level=3)
        child = _h("Middle", level=2, children=[grandchild])
        top = _h("Top", children=[child])
        a = _outline(
            "a.md",
            links=[_link("b.md#deep-section", source_heading="")],
        )
        b = _outline("b.md", headings=[top])
        idx = DocReferenceIndex()
        idx.build([a, b])
        assert grandchild.incoming_ref_count == 1
        assert top.incoming_ref_count == 0
        assert child.incoming_ref_count == 0

    def test_no_headings_in_target_produces_no_count(self) -> None:
        # Target file has no headings (rare but possible — e.g.,
        # an empty or prose-only markdown file). Document-level
        # link can't find a target heading. No count applied,
        # but the file-level edge still exists.
        a = _outline(
            "a.md",
            links=[_link("b.md", source_heading="")],
        )
        b = _outline("b.md", headings=[])
        idx = DocReferenceIndex()
        idx.build([a, b])
        assert idx.file_ref_count("b.md") == 1


# ---------------------------------------------------------------------------
# Self-reference exclusion
# ---------------------------------------------------------------------------


class TestSelfReference:
    def test_self_fragment_link_ignored(self) -> None:
        # A README with a table of contents linking to its own
        # headings — none of those count.
        top = _h("Top")
        section = _h("Section", level=2)
        top.children = [section]
        a = _outline(
            "a.md",
            headings=[top],
            links=[_link("a.md#section", source_heading="Top")],
        )
        idx = DocReferenceIndex()
        idx.build([a])
        assert section.incoming_ref_count == 0
        assert top.incoming_ref_count == 0
        assert idx.file_ref_count("a.md") == 0

    def test_self_document_link_ignored(self) -> None:
        # Link to the document itself (no fragment) — also self.
        top = _h("Top")
        a = _outline(
            "a.md",
            headings=[top],
            links=[_link("a.md", source_heading="Top")],
        )
        idx = DocReferenceIndex()
        idx.build([a])
        assert top.incoming_ref_count == 0


# ---------------------------------------------------------------------------
# Image links
# ---------------------------------------------------------------------------


class TestImageLinks:
    def test_image_link_creates_edge(self) -> None:
        # A doc embedding a SVG via ![alt](diagram.svg) should
        # produce an edge same as a regular link.
        a = _outline(
            "a.md",
            headings=[_h("A")],
            links=[_link("diagram.svg", source_heading="A", is_image=True)],
        )
        svg = _outline("diagram.svg", headings=[_h("Diagram")])
        idx = DocReferenceIndex()
        idx.build([a, svg])
        assert idx.file_ref_count("diagram.svg") == 1
        assert idx.files_referencing("diagram.svg") == {"a.md"}

    def test_image_and_text_link_to_same_target(self) -> None:
        # Same source heading links to same target via both
        # image and text forms — same dedup key, counts once.
        a = _outline(
            "a.md",
            headings=[_h("A")],
            links=[
                _link("shared.md", source_heading="A"),
                _link("shared.md", source_heading="A", is_image=True),
            ],
        )
        b = _outline("shared.md", headings=[_h("B")])
        idx = DocReferenceIndex()
        idx.build([a, b])
        # The is_image flag isn't part of the dedup key because
        # a link to a SVG via an image embed and via a text
        # anchor in the same section are the same conceptual
        # reference. Dedup'd.
        assert idx.file_ref_count("shared.md") == 1


# ---------------------------------------------------------------------------
# Rebuild idempotence
# ---------------------------------------------------------------------------


class TestRebuildIdempotence:
    def test_rebuild_clears_prior_state(self) -> None:
        a = _outline(
            "a.md",
            headings=[_h("A")],
            links=[_link("b.md", source_heading="A")],
        )
        b = _outline("b.md", headings=[_h("B")])
        idx = DocReferenceIndex()
        idx.build([a, b])
        assert idx.file_ref_count("b.md") == 1

        # Rebuild with an empty link set — count should reset.
        a2 = _outline("a.md", headings=[_h("A")])
        b2 = _outline("b.md", headings=[_h("B")])
        idx.build([a2, b2])
        assert idx.file_ref_count("b.md") == 0

    def test_rebuild_resets_heading_counts(self) -> None:
        # After a rebuild without links, heading incoming_ref_count
        # on the fresh outlines should be 0 — not inherited from
        # some prior state.
        b_top = _h("B")
        a = _outline(
            "a.md",
            links=[_link("b.md", source_heading="")],
        )
        b = _outline("b.md", headings=[b_top])
        idx = DocReferenceIndex()
        idx.build([a, b])
        assert b_top.incoming_ref_count == 1

        # Fresh outlines, no links. The build method mutates
        # incoming_ref_count on its input; we pass new outline
        # objects.
        b_top2 = _h("B")
        a2 = _outline("a.md")
        b2 = _outline("b.md", headings=[b_top2])
        idx.build([a2, b2])
        assert b_top2.incoming_ref_count == 0

    def test_rebuild_resets_heading_counts_on_same_outlines(self) -> None:
        # If the caller reuses the SAME outline objects across
        # rebuilds, previous counts should be zeroed. Matters
        # because the orchestrator does exactly this — it holds
        # outlines in _all_outlines and calls build() repeatedly.
        b_top = _h("B Top")
        b_section = _h("Section", level=2)
        b_top.children = [b_section]
        a = _outline(
            "a.md",
            links=[_link("b.md#section", source_heading="")],
        )
        b = _outline("b.md", headings=[b_top])

        idx = DocReferenceIndex()
        idx.build([a, b])
        assert b_section.incoming_ref_count == 1

        # Rebuild on the same outlines with the link removed.
        a.links = []
        idx.build([a, b])
        assert b_section.incoming_ref_count == 0
        assert b_top.incoming_ref_count == 0

    def test_rebuild_resets_file_dependencies(self) -> None:
        a = _outline(
            "a.md",
            headings=[_h("A")],
            links=[_link("b.md", source_heading="A")],
        )
        b = _outline("b.md", headings=[_h("B")])
        idx = DocReferenceIndex()
        idx.build([a, b])
        assert idx.file_dependencies("a.md") == {"b.md"}
        # Rebuild with link removed.
        a2 = _outline("a.md", headings=[_h("A")])
        b2 = _outline("b.md", headings=[_h("B")])
        idx.build([a2, b2])
        assert idx.file_dependencies("a.md") == set()


# ---------------------------------------------------------------------------
# Bidirectional edges and connected components
# ---------------------------------------------------------------------------


class TestBidirectionalEdges:
    def test_mutual_links_produce_edge(self) -> None:
        a = _outline(
            "a.md",
            headings=[_h("A")],
            links=[_link("b.md", source_heading="A")],
        )
        b = _outline(
            "b.md",
            headings=[_h("B")],
            links=[_link("a.md", source_heading="B")],
        )
        idx = DocReferenceIndex()
        idx.build([a, b])
        edges = idx.bidirectional_edges()
        assert edges == {("a.md", "b.md")}

    def test_one_way_link_no_edge(self) -> None:
        a = _outline(
            "a.md",
            links=[_link("b.md", source_heading="")],
        )
        b = _outline("b.md", headings=[_h("B")])
        idx = DocReferenceIndex()
        idx.build([a, b])
        assert idx.bidirectional_edges() == set()

    def test_edge_canonical_order(self) -> None:
        # Edge stored in (lo, hi) order regardless of which
        # direction the links were added in.
        a = _outline("z.md", links=[_link("a.md", source_heading="")])
        b = _outline("a.md", links=[_link("z.md", source_heading="")])
        idx = DocReferenceIndex()
        idx.build([a, b])
        edges = idx.bidirectional_edges()
        assert edges == {("a.md", "z.md")}


class TestConnectedComponents:
    def test_isolated_files_are_singletons(self) -> None:
        a = _outline("a.md", headings=[_h("A")])
        b = _outline("b.md", headings=[_h("B")])
        idx = DocReferenceIndex()
        idx.build([a, b])
        components = idx.connected_components()
        assert len(components) == 2
        # Two singletons.
        assert {"a.md"} in components
        assert {"b.md"} in components

    def test_mutual_pair_is_one_component(self) -> None:
        a = _outline(
            "a.md",
            links=[_link("b.md", source_heading="")],
        )
        b = _outline(
            "b.md",
            links=[_link("a.md", source_heading="")],
        )
        idx = DocReferenceIndex()
        idx.build([a, b])
        components = idx.connected_components()
        assert len(components) == 1
        assert components[0] == {"a.md", "b.md"}

    def test_transitive_cluster(self) -> None:
        # a <-> b <-> c forms one component.
        a = _outline(
            "a.md",
            links=[_link("b.md", source_heading="")],
        )
        b = _outline(
            "b.md",
            links=[
                _link("a.md", source_heading=""),
                _link("c.md", source_heading=""),
            ],
        )
        c = _outline(
            "c.md",
            links=[_link("b.md", source_heading="")],
        )
        idx = DocReferenceIndex()
        idx.build([a, b, c])
        components = idx.connected_components()
        assert len(components) == 1
        assert components[0] == {"a.md", "b.md", "c.md"}

    def test_one_way_chain_not_clustered(self) -> None:
        # a -> b -> c with no reverse edges. Three singletons.
        a = _outline(
            "a.md",
            links=[_link("b.md", source_heading="")],
        )
        b = _outline(
            "b.md",
            links=[_link("c.md", source_heading="")],
        )
        c = _outline("c.md")
        idx = DocReferenceIndex()
        idx.build([a, b, c])
        components = idx.connected_components()
        assert len(components) == 3

    def test_mixed_doc_and_image_cluster(self) -> None:
        # Mutual doc link + image ref. Doc-image edges clustering
        # only happens when there's a mutual reverse — an image
        # link from doc to svg is one-way. So a.md + b.md cluster
        # via their mutual text links; diagram.svg stays separate.
        a = _outline(
            "a.md",
            links=[
                _link("b.md", source_heading=""),
                _link("diagram.svg", source_heading="", is_image=True),
            ],
        )
        b = _outline(
            "b.md",
            links=[_link("a.md", source_heading="")],
        )
        svg = _outline("diagram.svg", headings=[_h("Diagram")])
        idx = DocReferenceIndex()
        idx.build([a, b, svg])
        components = idx.connected_components()
        # a.md + b.md together; diagram.svg as singleton.
        assert len(components) == 2
        paths = [frozenset(c) for c in components]
        assert frozenset({"a.md", "b.md"}) in paths
        assert frozenset({"diagram.svg"}) in paths


# ---------------------------------------------------------------------------
# Protocol compatibility with stability tracker
# ---------------------------------------------------------------------------


class TestTrackerProtocol:
    """The tracker's ``initialize_from_reference_graph`` calls
    :meth:`file_ref_count` and :meth:`connected_components` — and
    nothing else. Pinning these two methods' shape ensures doc and
    code indexes are interchangeable as tracker input."""

    def test_file_ref_count_returns_int(self) -> None:
        a = _outline("a.md", links=[_link("b.md", source_heading="")])
        b = _outline("b.md", headings=[_h("B")])
        idx = DocReferenceIndex()
        idx.build([a, b])
        result = idx.file_ref_count("b.md")
        assert isinstance(result, int)
        assert result == 1

    def test_file_ref_count_zero_for_unknown(self) -> None:
        idx = DocReferenceIndex()
        assert idx.file_ref_count("never.md") == 0

    def test_connected_components_returns_list_of_sets(self) -> None:
        a = _outline("a.md", headings=[_h("A")])
        idx = DocReferenceIndex()
        idx.build([a])
        components = idx.connected_components()
        assert isinstance(components, list)
        for component in components:
            assert isinstance(component, set)
            # Every member is a string path.
            for path in component:
                assert isinstance(path, str)

    def test_connected_components_includes_every_file(self) -> None:
        # Critical for the tracker's init — every file must appear
        # in exactly one component. Matches the code-side
        # ReferenceIndex contract.
        a = _outline("a.md")
        b = _outline("b.md", links=[_link("c.md", source_heading="")])
        c = _outline("c.md", links=[_link("b.md", source_heading="")])
        idx = DocReferenceIndex()
        idx.build([a, b, c])
        components = idx.connected_components()
        all_paths: set[str] = set()
        for component in components:
            all_paths |= component
        assert all_paths == {"a.md", "b.md", "c.md"}


# ---------------------------------------------------------------------------
# Realistic multi-file scenario
# ---------------------------------------------------------------------------


class TestRealisticScenario:
    def test_multi_doc_with_sections(self) -> None:
        # Mimics specs4 structure: a central overview linked
        # from multiple detail docs, with section-level refs.
        overview_top = _h("Overview")
        overview_section = _h("Key Concepts", level=2)
        overview_top.children = [overview_section]
        overview = _outline(
            "overview.md",
            headings=[overview_top],
        )

        details1 = _outline(
            "details-a.md",
            headings=[_h("Details A")],
            links=[
                _link("overview.md#key-concepts", source_heading="Details A"),
            ],
        )
        details2 = _outline(
            "details-b.md",
            headings=[_h("Details B")],
            links=[
                _link("overview.md#key-concepts", source_heading="Details B"),
            ],
        )
        details3 = _outline(
            "details-c.md",
            headings=[_h("Details C")],
            links=[
                # Document-level link — falls to overview_top.
                _link("overview.md", source_heading="Details C"),
            ],
        )

        idx = DocReferenceIndex()
        idx.build([overview, details1, details2, details3])

        # Overview's section accumulates the section-level refs.
        assert overview_section.incoming_ref_count == 2
        # Overview's top gets the document-level fallback.
        assert overview_top.incoming_ref_count == 1

        # File-level total is 3 (one from each details file).
        assert idx.file_ref_count("overview.md") == 3

        # No bidirectional edges — overview doesn't link back.
        assert idx.bidirectional_edges() == set()
        # Four singleton components.
        assert len(idx.connected_components()) == 4

    def test_cross_references_produce_cluster(self) -> None:
        # Two docs that reference each other's sections.
        a = _outline(
            "a.md",
            headings=[_h("A")],
            links=[_link("b.md#implementation", source_heading="A")],
        )
        b_top = _h("B")
        b_impl = _h("Implementation", level=2)
        b_top.children = [b_impl]
        b = _outline(
            "b.md",
            headings=[b_top],
            links=[_link("a.md", source_heading="B")],
        )
        idx = DocReferenceIndex()
        idx.build([a, b])

        # a.md gets document-level ref from b.md → top heading.
        a_top = a.headings[0]
        assert a_top.incoming_ref_count == 1

        # b.md's "Implementation" section gets the section-level ref.
        assert b_impl.incoming_ref_count == 1
        assert b_top.incoming_ref_count == 0

        # Bidirectional — forms a cluster.
        assert idx.bidirectional_edges() == {("a.md", "b.md")}
        components = idx.connected_components()
        assert len(components) == 1
        assert components[0] == {"a.md", "b.md"}