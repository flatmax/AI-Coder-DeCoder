"""Tests for :class:`MarkdownExtractor` — Layer 2.8.1.

Mirrors the test style of ``test_symbol_index_python_extractor.py``:
one describe class per contract area, each test pins a specific
behaviour with a minimal fixture. Tests use real markdown content
rather than mocked parsing — the extractor is line-scanning regex
code, there's nothing productive to mock.

The extractor is stateless across calls so each test constructs
its own input and asserts on the returned :class:`DocOutline`.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from ac_dc.doc_index.extractors.markdown import (
    MarkdownExtractor,
    _detect_doc_type,
)
from ac_dc.doc_index.models import DocHeading


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def extractor() -> MarkdownExtractor:
    return MarkdownExtractor()


def _extract(
    extractor: MarkdownExtractor,
    content: str,
    path: str = "doc.md",
):
    """Convenience wrapper — extract and return the outline."""
    return extractor.extract(Path(path), content)


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


class TestRegistration:
    def test_extension_is_md(self, extractor: MarkdownExtractor) -> None:
        assert extractor.extension == ".md"

    def test_supports_enrichment(
        self, extractor: MarkdownExtractor
    ) -> None:
        # Markdown sections carry prose — the enricher has
        # content to work with. SVG sets False at class level.
        assert extractor.supports_enrichment is True


# ---------------------------------------------------------------------------
# Basic empty / trivial cases
# ---------------------------------------------------------------------------


class TestTrivialCases:
    def test_empty_file(self, extractor: MarkdownExtractor) -> None:
        outline = _extract(extractor, "")
        assert outline.file_path == "doc.md"
        assert outline.headings == []
        assert outline.links == []
        assert outline.doc_type == "unknown"

    def test_prose_only_no_headings(
        self, extractor: MarkdownExtractor
    ) -> None:
        outline = _extract(
            extractor,
            "Just some prose.\nMore prose here.\n",
        )
        assert outline.headings == []
        assert outline.links == []

    def test_single_heading_no_body(
        self, extractor: MarkdownExtractor
    ) -> None:
        outline = _extract(extractor, "# Title\n")
        assert len(outline.headings) == 1
        assert outline.headings[0].text == "Title"
        assert outline.headings[0].level == 1


# ---------------------------------------------------------------------------
# Heading extraction
# ---------------------------------------------------------------------------


class TestHeadings:
    def test_all_six_levels(
        self, extractor: MarkdownExtractor
    ) -> None:
        content = (
            "# H1\n\n"
            "## H2\n\n"
            "### H3\n\n"
            "#### H4\n\n"
            "##### H5\n\n"
            "###### H6\n"
        )
        outline = _extract(extractor, content)
        flat = outline.all_headings_flat
        assert len(flat) == 6
        for i, h in enumerate(flat, start=1):
            assert h.level == i
            assert h.text == f"H{i}"

    def test_seven_hashes_not_a_heading(
        self, extractor: MarkdownExtractor
    ) -> None:
        # Markdown only defines H1..H6. More than 6 hashes is
        # not a heading — our regex caps at 6.
        outline = _extract(extractor, "####### Seven\n")
        assert outline.headings == []

    def test_hash_without_space_not_a_heading(
        self, extractor: MarkdownExtractor
    ) -> None:
        # "#text" without a space is not a heading per CommonMark.
        outline = _extract(extractor, "#NoSpace\n")
        assert outline.headings == []

    def test_trailing_hashes_stripped(
        self, extractor: MarkdownExtractor
    ) -> None:
        # `# Title #` and `# Title ###` are valid markdown —
        # trailing hashes are decorative and must be stripped.
        outline = _extract(extractor, "# Title ###\n")
        assert outline.headings[0].text == "Title"

    def test_heading_line_numbers_one_indexed(
        self, extractor: MarkdownExtractor
    ) -> None:
        content = (
            "\n"  # line 1 blank
            "\n"  # line 2 blank
            "# First\n"  # line 3
            "prose\n"  # line 4
            "\n"  # line 5
            "## Second\n"  # line 6
        )
        outline = _extract(extractor, content)
        flat = outline.all_headings_flat
        assert flat[0].start_line == 3
        assert flat[1].start_line == 6

    def test_document_order_preserved(
        self, extractor: MarkdownExtractor
    ) -> None:
        outline = _extract(
            extractor,
            "# A\n## B\n## C\n# D\n",
        )
        texts = [h.text for h in outline.all_headings_flat]
        assert texts == ["A", "B", "C", "D"]


# ---------------------------------------------------------------------------
# Heading nesting
# ---------------------------------------------------------------------------


class TestNesting:
    def test_h1_parent_of_h2(
        self, extractor: MarkdownExtractor
    ) -> None:
        outline = _extract(extractor, "# Parent\n## Child\n")
        assert len(outline.headings) == 1
        assert outline.headings[0].text == "Parent"
        assert len(outline.headings[0].children) == 1
        assert outline.headings[0].children[0].text == "Child"

    def test_deeply_nested(
        self, extractor: MarkdownExtractor
    ) -> None:
        outline = _extract(
            extractor,
            "# L1\n## L2\n### L3\n#### L4\n",
        )
        node = outline.headings[0]
        assert node.text == "L1"
        node = node.children[0]
        assert node.text == "L2"
        node = node.children[0]
        assert node.text == "L3"
        node = node.children[0]
        assert node.text == "L4"

    def test_sibling_h2_not_nested_under_each_other(
        self, extractor: MarkdownExtractor
    ) -> None:
        outline = _extract(
            extractor,
            "# Top\n## A\n## B\n",
        )
        top = outline.headings[0]
        assert [c.text for c in top.children] == ["A", "B"]
        # B isn't A's child.
        assert top.children[0].children == []

    def test_back_to_h1_creates_new_top_level(
        self, extractor: MarkdownExtractor
    ) -> None:
        outline = _extract(
            extractor,
            "# First\n## Sub\n# Second\n",
        )
        assert len(outline.headings) == 2
        assert outline.headings[0].text == "First"
        assert outline.headings[1].text == "Second"
        # "Second" has no children.
        assert outline.headings[1].children == []

    def test_skipped_level_attaches_to_nearest_ancestor(
        self, extractor: MarkdownExtractor
    ) -> None:
        # H1 → H3 skipping H2. H3 should attach to H1.
        outline = _extract(extractor, "# Top\n### Deep\n")
        assert len(outline.headings) == 1
        assert outline.headings[0].children[0].text == "Deep"

    def test_no_top_level_heading(
        self, extractor: MarkdownExtractor
    ) -> None:
        # Document starting at H2 (README-less repos do this).
        # The H2 becomes a top-level node in `outline.headings`.
        outline = _extract(extractor, "## First\n### Child\n")
        assert len(outline.headings) == 1
        assert outline.headings[0].text == "First"
        assert outline.headings[0].children[0].text == "Child"


# ---------------------------------------------------------------------------
# Inline links
# ---------------------------------------------------------------------------


class TestInlineLinks:
    def test_simple_link(
        self, extractor: MarkdownExtractor
    ) -> None:
        outline = _extract(
            extractor,
            "# Intro\nSee [spec](other.md) for more.\n",
        )
        assert len(outline.links) == 1
        link = outline.links[0]
        assert link.target == "other.md"
        assert link.is_image is False
        assert link.source_heading == "Intro"

    def test_link_with_fragment(
        self, extractor: MarkdownExtractor
    ) -> None:
        outline = _extract(
            extractor,
            "# Top\nSee [here](other.md#section).\n",
        )
        # Fragment preserved verbatim in target.
        assert outline.links[0].target == "other.md#section"

    def test_image_link(
        self, extractor: MarkdownExtractor
    ) -> None:
        outline = _extract(
            extractor,
            "# Intro\n![diagram](arch.svg)\n",
        )
        assert len(outline.links) == 1
        assert outline.links[0].target == "arch.svg"
        assert outline.links[0].is_image is True

    def test_multiple_links_same_line(
        self, extractor: MarkdownExtractor
    ) -> None:
        outline = _extract(
            extractor,
            "# Top\nSee [a](x.md) and [b](y.md).\n",
        )
        targets = [ln.target for ln in outline.links]
        assert targets == ["x.md", "y.md"]

    def test_source_heading_updates_across_sections(
        self, extractor: MarkdownExtractor
    ) -> None:
        content = (
            "# First\n[a](x.md)\n"
            "# Second\n[b](y.md)\n"
        )
        outline = _extract(extractor, content)
        assert outline.links[0].source_heading == "First"
        assert outline.links[1].source_heading == "Second"

    def test_link_above_first_heading(
        self, extractor: MarkdownExtractor
    ) -> None:
        # Links above the first heading get empty source_heading
        # — pinned by DocLink model test; verify here too.
        outline = _extract(
            extractor,
            "![logo](logo.svg)\n\n# Title\n",
        )
        assert outline.links[0].is_image is True
        assert outline.links[0].source_heading == ""

    def test_link_line_number(
        self, extractor: MarkdownExtractor
    ) -> None:
        content = "# Top\n\n\nSee [here](x.md).\n"
        outline = _extract(extractor, content)
        assert outline.links[0].line == 4


# ---------------------------------------------------------------------------
# Reference-style links
# ---------------------------------------------------------------------------


class TestReferenceLinks:
    def test_resolves_reference_link(
        self, extractor: MarkdownExtractor
    ) -> None:
        content = (
            "# Top\n"
            "See [spec][s] for details.\n"
            "\n"
            "[s]: spec.md\n"
        )
        outline = _extract(extractor, content)
        assert len(outline.links) == 1
        assert outline.links[0].target == "spec.md"

    def test_reference_label_case_insensitive(
        self, extractor: MarkdownExtractor
    ) -> None:
        content = (
            "# Top\n"
            "See [spec][MyRef] for details.\n"
            "\n"
            "[myref]: target.md\n"
        )
        outline = _extract(extractor, content)
        assert len(outline.links) == 1
        assert outline.links[0].target == "target.md"

    def test_undefined_reference_dropped(
        self, extractor: MarkdownExtractor
    ) -> None:
        # An undefined label has no target to resolve to. Rather
        # than emit a DocLink with empty target (which would
        # confuse downstream consumers), drop it.
        content = "# Top\nSee [link][missing].\n"
        outline = _extract(extractor, content)
        assert outline.links == []

    def test_definition_with_title(
        self, extractor: MarkdownExtractor
    ) -> None:
        # Standard markdown allows a title after the target.
        # Parser should still extract the target.
        content = (
            "# Top\n"
            "[text][r]\n"
            "\n"
            '[r]: target.md "Title text"\n'
        )
        outline = _extract(extractor, content)
        assert outline.links[0].target == "target.md"


# ---------------------------------------------------------------------------
# Content-type detection
# ---------------------------------------------------------------------------


class TestContentTypes:
    def test_fenced_code_marks_section(
        self, extractor: MarkdownExtractor
    ) -> None:
        content = (
            "# Section\n"
            "```python\n"
            "x = 1\n"
            "```\n"
        )
        outline = _extract(extractor, content)
        assert outline.headings[0].content_types == ["code"]

    def test_table_separator_marks_section(
        self, extractor: MarkdownExtractor
    ) -> None:
        content = (
            "# Section\n"
            "| A | B |\n"
            "|---|---|\n"
            "| 1 | 2 |\n"
        )
        outline = _extract(extractor, content)
        assert outline.headings[0].content_types == ["table"]

    def test_math_block_marks_section(
        self, extractor: MarkdownExtractor
    ) -> None:
        content = (
            "# Section\n"
            "$$\n"
            "x^2 + y^2 = z^2\n"
            "$$\n"
        )
        outline = _extract(extractor, content)
        assert outline.headings[0].content_types == ["formula"]

    def test_inline_math_marks_section(
        self, extractor: MarkdownExtractor
    ) -> None:
        content = "# Section\nThe formula is $E = mc^2$ here.\n"
        outline = _extract(extractor, content)
        assert outline.headings[0].content_types == ["formula"]

    def test_mixed_content_types(
        self, extractor: MarkdownExtractor
    ) -> None:
        content = (
            "# Section\n"
            "```\n"
            "code\n"
            "```\n"
            "| a | b |\n"
            "|---|---|\n"
            "inline $x = 1$ math\n"
        )
        outline = _extract(extractor, content)
        # All three present; order by first-detection.
        types = outline.headings[0].content_types
        assert set(types) == {"code", "table", "formula"}

    def test_content_type_deduped(
        self, extractor: MarkdownExtractor
    ) -> None:
        # Two code blocks in the same section → "code" once.
        content = (
            "# Section\n"
            "```\nblock1\n```\n"
            "prose\n"
            "```\nblock2\n```\n"
        )
        outline = _extract(extractor, content)
        assert outline.headings[0].content_types == ["code"]


# ---------------------------------------------------------------------------
# Fenced code block suppresses heading detection
# ---------------------------------------------------------------------------


class TestFencedCodeSuppression:
    def test_hash_inside_fence_not_a_heading(
        self, extractor: MarkdownExtractor
    ) -> None:
        content = (
            "# Real\n"
            "```python\n"
            "# This is a comment, not a heading\n"
            "```\n"
        )
        outline = _extract(extractor, content)
        flat = outline.all_headings_flat
        assert len(flat) == 1
        assert flat[0].text == "Real"

    def test_link_inside_fence_not_extracted(
        self, extractor: MarkdownExtractor
    ) -> None:
        content = (
            "# Section\n"
            "```\n"
            "see [x](y.md) — just text\n"
            "```\n"
        )
        outline = _extract(extractor, content)
        assert outline.links == []

    def test_tilde_fence_closes_with_tilde(
        self, extractor: MarkdownExtractor
    ) -> None:
        content = (
            "# Before\n"
            "~~~\n"
            "# inside tilde fence\n"
            "~~~\n"
            "# After\n"
        )
        outline = _extract(extractor, content)
        texts = [h.text for h in outline.all_headings_flat]
        # "# inside tilde fence" suppressed by the fence.
        assert texts == ["Before", "After"]

    def test_backtick_fence_not_closed_by_tilde(
        self, extractor: MarkdownExtractor
    ) -> None:
        # Mismatched fences — backtick opener stays open until
        # another backtick fence closes it.
        content = (
            "```\n"
            "~~~ this tilde doesn't close the backtick block\n"
            "# suppressed\n"
            "```\n"
            "# After\n"
        )
        outline = _extract(extractor, content)
        texts = [h.text for h in outline.all_headings_flat]
        assert texts == ["After"]


# ---------------------------------------------------------------------------
# Inline code strips link detection
# ---------------------------------------------------------------------------


class TestInlineCodeSuppression:
    def test_link_inside_code_span_not_extracted(
        self, extractor: MarkdownExtractor
    ) -> None:
        content = (
            "# Top\nHere's some code: `[x](y.md)` literal.\n"
        )
        outline = _extract(extractor, content)
        assert outline.links == []

    def test_link_adjacent_to_code_span_still_extracted(
        self, extractor: MarkdownExtractor
    ) -> None:
        content = (
            "# Top\n"
            "Code `example` and [link](target.md) coexist.\n"
        )
        outline = _extract(extractor, content)
        assert len(outline.links) == 1
        assert outline.links[0].target == "target.md"


# ---------------------------------------------------------------------------
# section_lines
# ---------------------------------------------------------------------------


class TestSectionLines:
    def test_section_lines_computed(
        self, extractor: MarkdownExtractor
    ) -> None:
        content = (
            "# First\n"   # line 1
            "prose 1\n"   # line 2
            "prose 2\n"   # line 3
            "# Second\n"  # line 4
            "prose 3\n"   # line 5
        )
        outline = _extract(extractor, content)
        first, second = outline.all_headings_flat
        # First section spans lines 1..3 → 3 lines.
        assert first.section_lines == 3
        # Second section spans lines 4..5 → 2 lines.
        assert second.section_lines == 2

    def test_section_lines_for_last_heading_to_eof(
        self, extractor: MarkdownExtractor
    ) -> None:
        content = (
            "# First\n"
            "# Second\n"
            "one\n"
            "two\n"
            "three\n"
        )
        outline = _extract(extractor, content)
        flat = outline.all_headings_flat
        # First is heading-only (1 line including itself).
        assert flat[0].section_lines == 1
        # Second heading + 3 prose lines = 4 lines.
        assert flat[1].section_lines == 4


# ---------------------------------------------------------------------------
# Doc type detection
# ---------------------------------------------------------------------------


class TestDocTypeDetection:
    def test_readme_detected(self) -> None:
        assert _detect_doc_type("README.md", []) == "readme"
        assert _detect_doc_type("readme.md", []) == "readme"
        # In a subdirectory.
        assert _detect_doc_type("sub/README.md", []) == "readme"

    def test_spec_by_path(self) -> None:
        # Conventional documentation directory names that hold
        # across arbitrary repos. Not repo-specific layouts —
        # the heuristic is a classification hint, not a discovery
        # filter.
        assert _detect_doc_type("specs/foo.md", []) == "spec"
        assert _detect_doc_type("spec/intro.md", []) == "spec"
        assert _detect_doc_type("rfcs/0001.md", []) == "spec"
        assert _detect_doc_type("design/overview.md", []) == "spec"
        # Deeper nesting: the pattern matches the directory
        # component anywhere in the path.
        assert _detect_doc_type(
            "docs/specs/foo.md", []
        ) == "spec"

    def test_guide_by_path(self) -> None:
        assert _detect_doc_type(
            "docs/guide/quick.md", []
        ) == "guide"
        assert _detect_doc_type(
            "tutorial/intro.md", []
        ) == "guide"

    def test_reference_by_path(self) -> None:
        assert _detect_doc_type(
            "api/endpoints.md", []
        ) == "reference"
        assert _detect_doc_type(
            "reference/class.md", []
        ) == "reference"

    def test_decision_by_path(self) -> None:
        assert _detect_doc_type(
            "adr/0001.md", []
        ) == "decision"
        assert _detect_doc_type(
            "decisions/use-sqlite.md", []
        ) == "decision"

    def test_notes_by_path(self) -> None:
        assert _detect_doc_type(
            "notes/2025-01.md", []
        ) == "notes"
        assert _detect_doc_type(
            "meeting/planning.md", []
        ) == "notes"

    def test_decision_by_heading_heuristic(self) -> None:
        # ADR format — Status + Decision headings.
        headings = [
            DocHeading(text="Status", level=2),
            DocHeading(text="Context", level=2),
            DocHeading(text="Decision", level=2),
        ]
        assert _detect_doc_type(
            "plain.md", headings
        ) == "decision"

    def test_spec_by_numbered_heading_heuristic(self) -> None:
        headings = [
            DocHeading(text="1. Introduction", level=2),
            DocHeading(text="1.1 Scope", level=3),
        ]
        assert _detect_doc_type(
            "arbitrary.md", headings
        ) == "spec"

    def test_unknown_default(self) -> None:
        assert _detect_doc_type("random.md", []) == "unknown"

    def test_path_wins_over_heading_heuristic(self) -> None:
        # Even if headings look ADR-like, a README filename wins.
        adr_headings = [
            DocHeading(text="Status", level=2),
            DocHeading(text="Decision", level=2),
        ]
        assert _detect_doc_type(
            "README.md", adr_headings
        ) == "readme"

    def test_unclassified_paths_produce_valid_outlines(
        self, extractor: MarkdownExtractor
    ) -> None:
        """Path-keyword misses don't exclude the file.

        Pins the invariant that `_PATH_TYPE_KEYWORDS` is a
        classification table, not a discovery filter. A file
        at an arbitrary location still produces a full outline
        — the doc_type just falls back to ``"unknown"``.

        If a future refactor accidentally fuses the two (e.g.,
        short-circuiting the whole extraction when no pattern
        matches), this test surfaces the regression loudly.
        """
        content = (
            "# Random Doc\n\n"
            "Some prose.\n\n"
            "## A Section\n\n"
            "See [link](other.md).\n\n"
            "```python\n"
            "x = 1\n"
            "```\n"
        )
        # Path that matches none of the classification keywords.
        outline = _extract(
            extractor,
            content,
            path="some-random-dir/anything.md",
        )

        # Full extraction still happened — every output field
        # populated as normal.
        assert outline.doc_type == "unknown"
        assert outline.file_path == "some-random-dir/anything.md"
        assert len(outline.headings) == 1
        assert outline.headings[0].text == "Random Doc"
        assert outline.headings[0].children[0].text == "A Section"
        # Link extracted, content-type detected.
        assert len(outline.links) == 1
        assert outline.links[0].target == "other.md"
        assert "code" in outline.headings[0].children[0].content_types


# ---------------------------------------------------------------------------
# Path normalisation
# ---------------------------------------------------------------------------


class TestPathNormalisation:
    def test_backslashes_normalised(
        self, extractor: MarkdownExtractor
    ) -> None:
        outline = extractor.extract(
            Path("docs\\sub\\file.md"),
            "# Title\n",
        )
        # Forward slashes in file_path regardless of source.
        assert outline.file_path == "docs/sub/file.md"

    def test_leading_slash_stripped(
        self, extractor: MarkdownExtractor
    ) -> None:
        outline = extractor.extract(
            Path("/absolute/path.md"),
            "",
        )
        assert outline.file_path == "absolute/path.md"


# ---------------------------------------------------------------------------
# Integration — specs-style document
# ---------------------------------------------------------------------------


class TestIntegration:
    def test_realistic_spec_document(
        self, extractor: MarkdownExtractor
    ) -> None:
        """End-to-end — a representative spec produces the expected outline."""
        content = (
            "# Spec Title\n\n"
            "Intro paragraph.\n\n"
            "## Overview\n\n"
            "See [context](context.md) and [cache][c].\n\n"
            "```python\n"
            "# a comment\n"
            "print('hello')\n"
            "```\n\n"
            "## Architecture\n\n"
            "![diagram](arch.svg)\n\n"
            "| Component | Role |\n"
            "|-----------|------|\n"
            "| A         | x    |\n\n"
            "### Details\n\n"
            "Formula: $a = b + c$\n\n"
            "[c]: cache.md\n"
        )
        outline = _extract(
            extractor,
            content,
            path="specs/project/overview.md",
        )

        # Top-level: one H1 with two H2 children.
        assert len(outline.headings) == 1
        h1 = outline.headings[0]
        assert h1.text == "Spec Title"
        assert [c.text for c in h1.children] == [
            "Overview",
            "Architecture",
        ]
        # Overview has content_types code (not "formula" — the
        # formula is in Details' section).
        overview = h1.children[0]
        assert "code" in overview.content_types
        # Architecture has table marker.
        arch = h1.children[1]
        assert "table" in arch.content_types
        # Details nested under Architecture has formula marker.
        details = arch.children[0]
        assert details.text == "Details"
        assert "formula" in details.content_types

        # Links — 3 total: context, cache (resolved), diagram.
        link_targets = {ln.target for ln in outline.links}
        assert link_targets == {
            "context.md", "cache.md", "arch.svg",
        }
        # Exactly one image link.
        image_links = [ln for ln in outline.links if ln.is_image]
        assert len(image_links) == 1
        assert image_links[0].target == "arch.svg"

        # Doc type: path starts with "specs/" → "spec".
        assert outline.doc_type == "spec"