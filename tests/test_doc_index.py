"""Tests for DocIndex — extractors, cache, formatter, reference index."""

import json
from pathlib import Path

import pytest

from ac_dc.doc_index.models import DocHeading, DocLink, DocOutline, DocSectionRef
from ac_dc.doc_index.extractors.markdown_extractor import MarkdownExtractor
from ac_dc.doc_index.extractors.svg_extractor import SvgExtractor
from ac_dc.doc_index.cache import DocCache
from ac_dc.doc_index.formatter import DocFormatter
from ac_dc.doc_index.reference_index import DocReferenceIndex


# ── Markdown Extractor ────────────────────────────────────────────

class TestMarkdownExtractor:
    def test_headings_extracted(self):
        ext = MarkdownExtractor()
        content = "# Title\n\n## Section A\n\nText\n\n## Section B\n\nMore text\n"
        outline = ext.extract("test.md", content)
        assert len(outline.headings) == 1  # H1 is root
        assert outline.headings[0].text == "Title"
        assert len(outline.headings[0].children) == 2

    def test_heading_nesting(self):
        ext = MarkdownExtractor()
        content = "# H1\n## H2\n### H3\n## H2b\n"
        outline = ext.extract("test.md", content)
        assert len(outline.headings) == 1
        h1 = outline.headings[0]
        assert len(h1.children) == 2  # H2 and H2b
        assert len(h1.children[0].children) == 1  # H3

    def test_links_extracted(self):
        ext = MarkdownExtractor()
        content = "# Doc\n\nSee [other](other.md#section) for details.\n"
        outline = ext.extract("test.md", content)
        assert len(outline.links) >= 1
        link = outline.links[0]
        assert link.target == "other.md"
        assert link.target_heading == "section"

    def test_image_references(self):
        ext = MarkdownExtractor(repo_files={"assets/diagram.svg"})
        content = "# Doc\n\n![diagram](assets/diagram.svg)\n"
        outline = ext.extract("test.md", content)
        img_links = [l for l in outline.links if l.is_image]
        assert len(img_links) >= 1

    def test_content_type_table(self):
        ext = MarkdownExtractor()
        content = "# Doc\n\n| A | B |\n|---|---|\n| 1 | 2 |\n"
        outline = ext.extract("test.md", content)
        flat = _flatten(outline.headings)
        assert any("table" in h.content_types for h in flat)

    def test_content_type_code(self):
        ext = MarkdownExtractor()
        content = "# Doc\n\n```python\nprint('hi')\n```\n"
        outline = ext.extract("test.md", content)
        flat = _flatten(outline.headings)
        assert any("code" in h.content_types for h in flat)

    def test_section_lines(self):
        ext = MarkdownExtractor()
        content = "# Title\n\nLine 1\nLine 2\nLine 3\n\n## Next\nLine 4\n"
        outline = ext.extract("test.md", content)
        h1 = outline.headings[0]
        assert h1.section_lines > 0

    def test_doc_type_readme(self):
        ext = MarkdownExtractor()
        outline = ext.extract("README.md", "# My Project\n")
        assert outline.doc_type == "readme"

    def test_doc_type_spec(self):
        ext = MarkdownExtractor()
        outline = ext.extract("specs/api.md", "# API\n")
        assert outline.doc_type == "spec"

    def test_doc_type_unknown(self):
        ext = MarkdownExtractor()
        outline = ext.extract("random.md", "# Hello\n")
        assert outline.doc_type == "unknown"

    def test_external_links_skipped(self):
        ext = MarkdownExtractor()
        content = "# Doc\n\n[link](https://example.com)\n"
        outline = ext.extract("test.md", content)
        assert len(outline.links) == 0


# ── SVG Extractor ─────────────────────────────────────────────────

class TestSvgExtractor:
    def test_title_and_desc(self):
        ext = SvgExtractor()
        svg = '<svg xmlns="http://www.w3.org/2000/svg"><title>My Diagram</title><desc>A description</desc></svg>'
        outline = ext.extract("test.svg", svg)
        texts = [h.text for h in outline.headings]
        assert "My Diagram" in texts
        assert "A description" in texts

    def test_text_labels(self):
        ext = SvgExtractor()
        svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Label A</text><text>Label B</text></svg>'
        outline = ext.extract("test.svg", svg)
        texts = [h.text for h in outline.headings]
        assert "Label A" in texts
        assert "Label B" in texts

    def test_deduplication(self):
        ext = SvgExtractor()
        svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Same</text><text>Same</text></svg>'
        outline = ext.extract("test.svg", svg)
        texts = [h.text for h in outline.headings]
        assert texts.count("Same") == 1

    def test_links_extracted(self):
        ext = SvgExtractor()
        svg = '<svg xmlns="http://www.w3.org/2000/svg"><a href="other.svg"><text>Link</text></a></svg>'
        outline = ext.extract("test.svg", svg)
        assert len(outline.links) >= 1

    def test_fragment_links_skipped(self):
        ext = SvgExtractor()
        svg = '<svg xmlns="http://www.w3.org/2000/svg"><a href="#internal"><text>X</text></a></svg>'
        outline = ext.extract("test.svg", svg)
        assert len(outline.links) == 0

    def test_defs_skipped(self):
        ext = SvgExtractor()
        svg = '<svg xmlns="http://www.w3.org/2000/svg"><defs><text>Hidden</text></defs><text>Visible</text></svg>'
        outline = ext.extract("test.svg", svg)
        texts = [h.text for h in outline.headings]
        assert "Hidden" not in texts
        assert "Visible" in texts

    def test_invalid_svg(self):
        ext = SvgExtractor()
        outline = ext.extract("bad.svg", "not valid xml at all")
        assert outline.doc_type == "unknown"
        assert len(outline.headings) == 0


# ── Doc Cache ─────────────────────────────────────────────────────

class TestDocCache:
    def test_put_get_inmemory(self):
        cache = DocCache()
        outline = DocOutline(path="test.md", headings=[
            DocHeading(text="Title", level=1),
        ])
        cache.put("test.md", 1234.0, outline)
        result = cache.get("test.md", 1234.0)
        assert result is not None
        assert result.path == "test.md"

    def test_stale_mtime(self):
        cache = DocCache()
        outline = DocOutline(path="test.md")
        cache.put("test.md", 1234.0, outline)
        assert cache.get("test.md", 9999.0) is None

    def test_invalidate(self):
        cache = DocCache()
        outline = DocOutline(path="test.md")
        cache.put("test.md", 1234.0, outline)
        cache.invalidate("test.md")
        assert cache.get("test.md", 1234.0) is None

    def test_disk_persistence(self, tmp_path):
        repo = tmp_path / "repo"
        repo.mkdir()
        (repo / ".ac-dc").mkdir()

        outline = DocOutline(
            path="docs/test.md", doc_type="spec",
            headings=[DocHeading(text="Title", level=1, keywords=["topic"])],
            links=[DocLink(target="other.md")],
        )

        # Write
        cache1 = DocCache(repo_root=repo)
        cache1.put("docs/test.md", 1234.0, outline, keyword_model="test-model")

        # Read from fresh cache
        cache2 = DocCache(repo_root=repo)
        result = cache2.get("docs/test.md", 1234.0)
        assert result is not None
        assert result.doc_type == "spec"
        assert result.headings[0].text == "Title"
        assert result.headings[0].keywords == ["topic"]

    def test_model_change_invalidates(self):
        cache = DocCache(keyword_model="model-a")
        outline = DocOutline(path="test.md")
        cache.put("test.md", 1.0, outline, keyword_model="model-a")
        # Same model
        assert cache.get("test.md", 1.0, keyword_model="model-a") is not None
        # Different model
        assert cache.get("test.md", 1.0, keyword_model="model-b") is None

    def test_clear(self, tmp_path):
        repo = tmp_path / "repo"
        repo.mkdir()
        (repo / ".ac-dc").mkdir()

        cache = DocCache(repo_root=repo)
        cache.put("a.md", 1.0, DocOutline(path="a.md"))
        cache.put("b.md", 1.0, DocOutline(path="b.md"))
        cache.clear()
        assert cache.get("a.md", 1.0) is None
        assert cache.get("b.md", 1.0) is None


# ── Doc Formatter ─────────────────────────────────────────────────

class TestDocFormatter:
    def test_format_basic(self):
        fmt = DocFormatter()
        outline = DocOutline(
            path="docs/test.md", doc_type="spec",
            headings=[
                DocHeading(text="Title", level=1, section_lines=20, children=[
                    DocHeading(text="Section A", level=2, section_lines=10,
                               keywords=["topic1", "topic2"]),
                ]),
            ],
        )
        output = fmt.format_file("docs/test.md", outline)
        assert "docs/test.md [spec]:" in output
        assert "# Title" in output
        assert "## Section A" in output
        assert "(topic1, topic2)" in output
        assert "~20ln" in output

    def test_legend(self):
        fmt = DocFormatter()
        legend = fmt.get_legend()
        assert "keywords" in legend.lower() or "(keywords)" in legend

    def test_content_type_annotations(self):
        fmt = DocFormatter()
        outline = DocOutline(path="test.md", headings=[
            DocHeading(text="Data", level=1, content_types=["table"], section_lines=30),
        ])
        output = fmt.format_file("test.md", outline)
        assert "[table]" in output

    def test_outgoing_refs(self):
        fmt = DocFormatter()
        outline = DocOutline(path="test.md", headings=[
            DocHeading(text="Intro", level=1, section_lines=10, outgoing_refs=[
                DocSectionRef(target_path="other.md", target_heading="Details"),
            ]),
        ])
        output = fmt.format_file("test.md", outline)
        assert "→other.md#Details" in output

    def test_links_summary(self):
        fmt = DocFormatter()
        outline = DocOutline(
            path="test.md",
            headings=[DocHeading(text="Doc", level=1)],
            links=[DocLink(target="a.md"), DocLink(target="b.md")],
        )
        output = fmt.format_file("test.md", outline)
        assert "links:" in output
        assert "a.md" in output
        assert "b.md" in output

    def test_small_sections_omit_size(self):
        fmt = DocFormatter()
        outline = DocOutline(path="test.md", headings=[
            DocHeading(text="Tiny", level=1, section_lines=3),
        ])
        output = fmt.format_file("test.md", outline)
        assert "~3ln" not in output


# ── Doc Reference Index ──────────────────────────────────────────

class TestDocReferenceIndex:
    def test_incoming_count(self):
        idx = DocReferenceIndex()
        outline_a = DocOutline(path="a.md", headings=[
            DocHeading(text="Title A", level=1),
        ], links=[
            DocLink(target="b.md", source_heading="Title A"),
        ])
        outline_b = DocOutline(path="b.md", headings=[
            DocHeading(text="Title B", level=1),
        ])
        idx.build({"a.md": outline_a, "b.md": outline_b})
        assert idx.incoming_count("b.md", "Title B") >= 1

    def test_file_ref_count(self):
        idx = DocReferenceIndex()
        outline_a = DocOutline(path="a.md", links=[
            DocLink(target="b.md"),
        ])
        outline_b = DocOutline(path="b.md")
        outline_c = DocOutline(path="c.md", links=[
            DocLink(target="b.md"),
        ])
        idx.build({"a.md": outline_a, "b.md": outline_b, "c.md": outline_c})
        assert idx.file_ref_count("b.md") == 2

    def test_connected_components(self):
        idx = DocReferenceIndex()
        outline_a = DocOutline(path="a.md", links=[DocLink(target="b.md")])
        outline_b = DocOutline(path="b.md", links=[DocLink(target="a.md")])
        outline_c = DocOutline(path="c.md")  # Isolated
        idx.build({"a.md": outline_a, "b.md": outline_b, "c.md": outline_c})
        comps = idx.connected_components()
        assert len(comps) == 1
        assert set(comps[0]) == {"a.md", "b.md"}

    def test_self_refs_excluded(self):
        idx = DocReferenceIndex()
        outline = DocOutline(path="a.md", headings=[
            DocHeading(text="Title", level=1),
        ], links=[
            DocLink(target="a.md", source_heading="Title"),
        ])
        idx.build({"a.md": outline})
        assert idx.incoming_count("a.md", "Title") == 0

    def test_section_anchor_resolution(self):
        idx = DocReferenceIndex()
        outline_a = DocOutline(path="a.md", headings=[
            DocHeading(text="Intro", level=1),
        ], links=[
            DocLink(target="b.md", target_heading="My-Section",
                    source_heading="Intro"),
        ])
        outline_b = DocOutline(path="b.md", headings=[
            DocHeading(text="My Section", level=1),
        ])
        idx.build({"a.md": outline_a, "b.md": outline_b})
        assert idx.incoming_count("b.md", "My Section") >= 1


# ── Integration ───────────────────────────────────────────────────

class TestDocIndexIntegration:
    def test_index_repo(self, tmp_git_repo):
        from ac_dc.doc_index.index import DocIndex

        # Add a markdown file
        (tmp_git_repo / "docs").mkdir()
        (tmp_git_repo / "docs" / "guide.md").write_text(
            "# User Guide\n\n## Getting Started\n\nHello world.\n\n## API\n\n| Method | Desc |\n|---|---|\n| GET | Fetch |\n"
        )

        idx = DocIndex(tmp_git_repo)
        result = idx.index_repo()
        assert "docs/guide.md" in result

    def test_doc_map_output(self, tmp_git_repo):
        from ac_dc.doc_index.index import DocIndex

        (tmp_git_repo / "README.md").write_text(
            "# My Project\n\nA description.\n\n## Installation\n\nRun pip install.\n"
        )

        idx = DocIndex(tmp_git_repo)
        idx.index_repo()
        output = idx.get_doc_map()
        assert "README.md" in output
        assert "readme" in output.lower() or "Installation" in output

    def test_file_doc_block(self, tmp_git_repo):
        from ac_dc.doc_index.index import DocIndex

        (tmp_git_repo / "doc.md").write_text("# Title\n\n## Section\n\nText\n")
        idx = DocIndex(tmp_git_repo)
        idx.index_repo()
        block = idx.get_file_doc_block("doc.md")
        assert block is not None
        assert "Title" in block

    def test_invalidate_and_reindex(self, tmp_git_repo):
        from ac_dc.doc_index.index import DocIndex

        doc = tmp_git_repo / "test.md"
        doc.write_text("# Original\n")
        idx = DocIndex(tmp_git_repo)
        idx.index_repo()
        assert "Original" in idx.get_doc_map()

        doc.write_text("# Updated\n")
        idx.invalidate_file("test.md")
        idx.index_file("test.md")
        assert "Updated" in idx.get_doc_map()


# ── Helpers ──────────────────────────────────────────────────────

def _flatten(headings):
    result = []
    stack = list(headings)
    while stack:
        h = stack.pop(0)
        result.append(h)
        stack = list(h.children) + stack
    return result