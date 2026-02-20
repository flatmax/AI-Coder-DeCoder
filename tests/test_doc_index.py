"""Tests for the document index module."""

import os
import tempfile
from pathlib import Path

import pytest

from ac_dc.doc_index.extractors.base import DocHeading, DocLink, DocOutline
from ac_dc.doc_index.extractors.markdown_extractor import MarkdownExtractor
from ac_dc.doc_index.cache import DocCache
from ac_dc.doc_index.formatter import DocFormatter
from ac_dc.doc_index.reference_index import DocReferenceIndex
from ac_dc.doc_index.index import DocIndex


# === SVG Extractor Tests ===

class TestSvgExtractor:
    """Tests for SVG document extraction."""

    def _extract(self, text, path="test.svg"):
        from ac_dc.doc_index.extractors.svg_extractor import SvgExtractor
        return SvgExtractor().extract(path, text)

    def test_title_extracted(self):
        svg = '<svg xmlns="http://www.w3.org/2000/svg"><title>My Diagram</title></svg>'
        outline = self._extract(svg)
        assert len(outline.headings) == 1
        assert outline.headings[0].text == "My Diagram"
        assert outline.headings[0].level == 1

    def test_desc_extracted(self):
        svg = '<svg xmlns="http://www.w3.org/2000/svg"><title>Diagram</title><desc>A description</desc></svg>'
        outline = self._extract(svg)
        top = outline.headings[0]
        assert top.text == "Diagram"
        assert len(top.children) == 1
        assert top.children[0].text == "A description"

    def test_text_elements_extracted(self):
        svg = '''<svg xmlns="http://www.w3.org/2000/svg">
            <text x="10" y="20">Hello World</text>
            <text x="10" y="40">Second Label</text>
        </svg>'''
        outline = self._extract(svg)
        all_texts = [h.text for h in outline.all_headings_flat]
        assert "Hello World" in all_texts
        assert "Second Label" in all_texts

    def test_duplicate_text_deduplicated(self):
        svg = '''<svg xmlns="http://www.w3.org/2000/svg">
            <text x="10" y="20">Same Label</text>
            <text x="50" y="20">Same Label</text>
        </svg>'''
        outline = self._extract(svg)
        all_texts = [h.text for h in outline.all_headings_flat]
        assert all_texts.count("Same Label") == 1

    def test_group_with_id_becomes_heading(self):
        svg = '''<svg xmlns="http://www.w3.org/2000/svg">
            <g id="services">
                <text x="10" y="20">API Gateway</text>
                <text x="10" y="40">Auth Service</text>
            </g>
        </svg>'''
        outline = self._extract(svg)
        flat = outline.all_headings_flat
        labels = [h.text for h in flat]
        assert "services" in labels
        # Group children should be nested
        group = [h for h in flat if h.text == "services"][0]
        child_texts = [c.text for c in group.children]
        assert "API Gateway" in child_texts
        assert "Auth Service" in child_texts

    def test_link_extracted(self):
        svg = '''<svg xmlns="http://www.w3.org/2000/svg"
                      xmlns:xlink="http://www.w3.org/1999/xlink">
            <a xlink:href="docs/spec.md"><text>See Spec</text></a>
        </svg>'''
        outline = self._extract(svg)
        assert len(outline.links) == 1
        assert outline.links[0].target == "docs/spec.md"

    def test_internal_fragment_links_skipped(self):
        svg = '''<svg xmlns="http://www.w3.org/2000/svg"
                      xmlns:xlink="http://www.w3.org/1999/xlink">
            <a xlink:href="#section1"><text>Internal</text></a>
        </svg>'''
        outline = self._extract(svg)
        assert len(outline.links) == 0

    def test_defs_skipped(self):
        svg = '''<svg xmlns="http://www.w3.org/2000/svg">
            <defs>
                <text id="hidden">Should not appear</text>
            </defs>
            <text x="10" y="20">Visible</text>
        </svg>'''
        outline = self._extract(svg)
        all_texts = [h.text for h in outline.all_headings_flat]
        assert "Should not appear" not in all_texts
        assert "Visible" in all_texts

    def test_invalid_svg_returns_empty(self):
        outline = self._extract("this is not svg")
        assert len(outline.headings) == 0

    def test_empty_svg(self):
        svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
        outline = self._extract(svg, path="empty.svg")
        # Should synthesise a filename-based heading
        assert len(outline.headings) == 1
        assert outline.headings[0].text == "empty.svg"

    def test_tspan_text_collected(self):
        svg = '''<svg xmlns="http://www.w3.org/2000/svg">
            <text x="10" y="20"><tspan>Part One</tspan> <tspan>Part Two</tspan></text>
        </svg>'''
        outline = self._extract(svg)
        flat = outline.all_headings_flat
        # The text element should collect all tspan content
        combined = [h.text for h in flat]
        assert any("Part One" in t and "Part Two" in t for t in combined)

    def test_sample_svg(self):
        """Integration test with the repo's sample.svg file."""
        import os
        sample = os.path.join(os.path.dirname(__file__), "sample.svg")
        if not os.path.exists(sample):
            pytest.skip("sample.svg not found")
        with open(sample) as f:
            text = f.read()
        outline = self._extract(text, path="tests/sample.svg")
        flat = outline.all_headings_flat
        labels = [h.text for h in flat]
        # Should find the main architecture components
        assert any("Architecture" in t for t in labels)
        assert any("LLM Service" in t for t in labels)
        assert any("Context Manager" in t for t in labels)
        assert any("Symbol Index" in t for t in labels)
        assert any("Repo" in t for t in labels)
        assert any("Webapp" in t for t in labels)


# === Markdown Extractor Tests ===

class TestMarkdownExtractor:

    def _extract(self, text, path="test.md"):
        ext = MarkdownExtractor()
        return ext.extract(path, text)

    def test_simple_headings(self):
        text = "# Title\n\nSome text\n\n## Section 1\n\nMore text\n\n## Section 2\n"
        outline = self._extract(text)
        assert len(outline.headings) == 1  # only top-level
        assert outline.headings[0].text == "Title"
        assert outline.headings[0].level == 1
        assert len(outline.headings[0].children) == 2
        assert outline.headings[0].children[0].text == "Section 1"
        assert outline.headings[0].children[1].text == "Section 2"

    def test_heading_levels(self):
        text = "# H1\n## H2\n### H3\n#### H4\n"
        outline = self._extract(text)
        assert len(outline.headings) == 1
        h1 = outline.headings[0]
        assert h1.level == 1
        assert len(h1.children) == 1
        h2 = h1.children[0]
        assert h2.level == 2
        assert len(h2.children) == 1
        h3 = h2.children[0]
        assert h3.level == 3
        assert len(h3.children) == 1

    def test_multiple_top_level(self):
        text = "# Part 1\n\nText\n\n# Part 2\n\nText\n"
        outline = self._extract(text)
        assert len(outline.headings) == 2

    def test_links_extracted(self):
        text = "# Title\n\nSee [other doc](other.md) and [code](../src/main.py)\n"
        outline = self._extract(text)
        assert len(outline.links) == 2
        targets = {l.target for l in outline.links}
        assert "other.md" in targets
        assert "../src/main.py" in targets

    def test_links_not_images(self):
        text = "# Title\n\n![image](pic.png)\n[real link](doc.md)\n"
        outline = self._extract(text)
        assert len(outline.links) == 1
        assert outline.links[0].target == "doc.md"

    def test_link_source_heading(self):
        text = "# Title\n\n## Section A\n\nSee [link](other.md)\n"
        outline = self._extract(text)
        assert outline.links[0].source_heading == "Section A"

    def test_fenced_code_blocks_skipped(self):
        text = "# Title\n\n```\n## Not a heading\n[not a link](foo)\n```\n\n## Real heading\n"
        outline = self._extract(text)
        flat = outline.all_headings_flat
        assert len(flat) == 2  # Title + Real heading
        assert flat[1].text == "Real heading"
        assert len(outline.links) == 0

    def test_tilde_fence_blocks_skipped(self):
        text = "# Title\n\n~~~\n## Not a heading\n~~~\n\n## Real\n"
        outline = self._extract(text)
        flat = outline.all_headings_flat
        assert len(flat) == 2

    def test_empty_file(self):
        outline = self._extract("")
        assert len(outline.headings) == 0
        assert len(outline.links) == 0

    def test_start_line_tracked(self):
        text = "# Title\n\nText\n\n## Section\n"
        outline = self._extract(text)
        assert outline.headings[0].start_line == 0
        assert outline.headings[0].children[0].start_line == 4

    def test_heading_with_trailing_hashes(self):
        text = "## Section ##\n"
        outline = self._extract(text)
        assert outline.headings[0].text == "Section"

    def test_url_links_extracted(self):
        text = "# Title\n\n[example](https://example.com)\n"
        outline = self._extract(text)
        assert len(outline.links) == 1
        assert outline.links[0].target == "https://example.com"


# === DocOutline Data Model Tests ===

class TestDocOutline:

    def test_all_headings_flat(self):
        outline = DocOutline(
            path="test.md",
            headings=[
                DocHeading(text="H1", level=1, children=[
                    DocHeading(text="H2a", level=2, children=[
                        DocHeading(text="H3", level=3),
                    ]),
                    DocHeading(text="H2b", level=2),
                ]),
            ],
        )
        flat = outline.all_headings_flat
        assert len(flat) == 4
        assert [h.text for h in flat] == ["H1", "H2a", "H3", "H2b"]

    def test_signature_hash_content(self):
        outline = DocOutline(
            path="test.md",
            headings=[DocHeading(text="Title", level=1)],
            links=[DocLink(target="other.md")],
        )
        h = outline.signature_hash_content()
        assert "test.md" in h
        assert "Title" in h
        assert "other.md" in h


# === DocCache Tests ===

class TestDocCache:

    def test_put_get_roundtrip(self, tmp_path):
        cache = DocCache(repo_root=str(tmp_path))
        outline = DocOutline(path="test.md", headings=[DocHeading(text="T", level=1)])
        cache.put("test.md", 100.0, outline)
        result = cache.get("test.md", 100.0)
        assert result is not None
        assert result.path == "test.md"

    def test_stale_mtime(self, tmp_path):
        cache = DocCache(repo_root=str(tmp_path))
        outline = DocOutline(path="test.md")
        cache.put("test.md", 100.0, outline)
        assert cache.get("test.md", 200.0) is None

    def test_keyword_model_mismatch(self, tmp_path):
        cache = DocCache(repo_root=str(tmp_path))
        outline = DocOutline(path="test.md")
        cache.put("test.md", 100.0, outline, keyword_model="model-a")
        assert cache.get("test.md", 100.0, keyword_model="model-b") is None
        assert cache.get("test.md", 100.0, keyword_model="model-a") is not None

    def test_invalidate(self, tmp_path):
        cache = DocCache(repo_root=str(tmp_path))
        outline = DocOutline(path="test.md")
        cache.put("test.md", 100.0, outline)
        cache.invalidate("test.md")
        assert cache.get("test.md", 100.0) is None

    def test_content_hash(self, tmp_path):
        cache = DocCache(repo_root=str(tmp_path))
        outline = DocOutline(path="test.md", headings=[DocHeading(text="T", level=1)])
        cache.put("test.md", 100.0, outline)
        h = cache.get_hash("test.md")
        assert h is not None
        assert len(h) == 16

    def test_disk_persistence_survives_restart(self, tmp_path):
        """Cached outlines persist to disk and reload on new DocCache instance."""
        outline = DocOutline(
            path="doc.md",
            headings=[DocHeading(text="Title", level=1, keywords=["kw1", "kw2"])],
            links=[DocLink(target="other.md", source_heading="Title")],
        )
        cache1 = DocCache(repo_root=str(tmp_path))
        cache1.put("doc.md", 42.0, outline, keyword_model="test-model")

        # Create a new cache instance (simulates restart)
        cache2 = DocCache(repo_root=str(tmp_path))
        result = cache2.get("doc.md", 42.0, keyword_model="test-model")
        assert result is not None
        assert result.path == "doc.md"
        assert result.headings[0].text == "Title"
        assert result.headings[0].keywords == ["kw1", "kw2"]
        assert result.links[0].target == "other.md"

    def test_disk_persistence_stale_mtime_after_restart(self, tmp_path):
        """Disk-cached entry rejected when mtime doesn't match."""
        outline = DocOutline(path="doc.md")
        cache1 = DocCache(repo_root=str(tmp_path))
        cache1.put("doc.md", 42.0, outline)

        cache2 = DocCache(repo_root=str(tmp_path))
        assert cache2.get("doc.md", 42.0) is not None
        assert cache2.get("doc.md", 99.0) is None

    def test_disk_persistence_model_mismatch_after_restart(self, tmp_path):
        """Disk-cached entry rejected when keyword model changed."""
        outline = DocOutline(path="doc.md")
        cache1 = DocCache(repo_root=str(tmp_path))
        cache1.put("doc.md", 42.0, outline, keyword_model="model-a")

        cache2 = DocCache(repo_root=str(tmp_path))
        assert cache2.get("doc.md", 42.0, keyword_model="model-a") is not None
        assert cache2.get("doc.md", 42.0, keyword_model="model-b") is None

    def test_invalidate_removes_sidecar(self, tmp_path):
        """Invalidate removes both in-memory and disk entry."""
        outline = DocOutline(path="doc.md")
        cache1 = DocCache(repo_root=str(tmp_path))
        cache1.put("doc.md", 42.0, outline)
        cache1.invalidate("doc.md")

        cache2 = DocCache(repo_root=str(tmp_path))
        assert cache2.get("doc.md", 42.0) is None

    def test_clear_removes_all_sidecars(self, tmp_path):
        """Clear removes all disk entries."""
        cache1 = DocCache(repo_root=str(tmp_path))
        cache1.put("a.md", 1.0, DocOutline(path="a.md"))
        cache1.put("b.md", 2.0, DocOutline(path="b.md"))
        cache1.clear()

        cache2 = DocCache(repo_root=str(tmp_path))
        assert cache2.get("a.md", 1.0) is None
        assert cache2.get("b.md", 2.0) is None

    def test_hash_preserved_on_disk(self, tmp_path):
        """Content hash survives disk round-trip."""
        outline = DocOutline(path="doc.md", headings=[DocHeading(text="T", level=1)])
        cache1 = DocCache(repo_root=str(tmp_path))
        cache1.put("doc.md", 42.0, outline)
        hash1 = cache1.get_hash("doc.md")

        cache2 = DocCache(repo_root=str(tmp_path))
        hash2 = cache2.get_hash("doc.md")
        assert hash1 == hash2

    def test_nested_headings_round_trip(self, tmp_path):
        """Nested heading trees survive serialization."""
        outline = DocOutline(
            path="doc.md",
            headings=[
                DocHeading(text="H1", level=1, children=[
                    DocHeading(text="H2", level=2, keywords=["nested"], children=[
                        DocHeading(text="H3", level=3),
                    ]),
                ]),
            ],
        )
        cache1 = DocCache(repo_root=str(tmp_path))
        cache1.put("doc.md", 1.0, outline)

        cache2 = DocCache(repo_root=str(tmp_path))
        result = cache2.get("doc.md", 1.0)
        assert result.headings[0].text == "H1"
        assert result.headings[0].children[0].text == "H2"
        assert result.headings[0].children[0].keywords == ["nested"]
        assert result.headings[0].children[0].children[0].text == "H3"

    def test_no_repo_root_still_works(self):
        """Without repo_root, cache is in-memory only (no crash)."""
        cache = DocCache()
        outline = DocOutline(path="test.md")
        cache.put("test.md", 1.0, outline)
        assert cache.get("test.md", 1.0) is not None


# === DocReferenceIndex Tests ===

class TestDocReferenceIndex:

    def test_build_and_query(self):
        outlines = {
            "docs/a.md": DocOutline(
                path="docs/a.md",
                links=[DocLink(target="b.md", source_heading="Intro")],
            ),
            "docs/b.md": DocOutline(
                path="docs/b.md",
                links=[DocLink(target="a.md", source_heading="See also")],
            ),
        }
        idx = DocReferenceIndex()
        idx.build(outlines)
        assert idx.file_ref_count("docs/b.md") >= 1
        assert idx.file_ref_count("docs/a.md") >= 1

    def test_bidirectional_components(self):
        outlines = {
            "a.md": DocOutline(path="a.md", links=[DocLink(target="b.md")]),
            "b.md": DocOutline(path="b.md", links=[DocLink(target="a.md")]),
            "c.md": DocOutline(path="c.md"),
        }
        idx = DocReferenceIndex()
        idx.build(outlines)
        components = idx.connected_components()
        assert len(components) >= 1
        # a.md and b.md should be in the same component
        found = False
        for comp in components:
            if "a.md" in comp and "b.md" in comp:
                found = True
        assert found

    def test_external_urls_ignored(self):
        outlines = {
            "a.md": DocOutline(
                path="a.md",
                links=[DocLink(target="https://example.com")],
            ),
        }
        idx = DocReferenceIndex()
        idx.build(outlines)
        assert idx.file_ref_count("https://example.com") == 0

    def test_doc_to_code_link(self):
        outlines = {
            "docs/spec.md": DocOutline(
                path="docs/spec.md",
                links=[DocLink(target="../src/main.py")],
            ),
        }
        idx = DocReferenceIndex()
        idx.build(outlines)
        assert idx.file_ref_count("src/main.py") >= 1


# === DocFormatter Tests ===

class TestDocFormatter:

    def test_format_simple_outline(self):
        outlines = {
            "readme.md": DocOutline(
                path="readme.md",
                headings=[
                    DocHeading(text="Project", level=1, children=[
                        DocHeading(text="Install", level=2),
                        DocHeading(text="Usage", level=2),
                    ]),
                ],
            ),
        }
        fmt = DocFormatter()
        result = fmt.format_all(outlines)
        assert "readme.md:" in result
        assert "# Project" in result
        assert "## Install" in result
        assert "## Usage" in result

    def test_keywords_in_output(self):
        outlines = {
            "api.md": DocOutline(
                path="api.md",
                headings=[
                    DocHeading(text="Auth", level=2, keywords=["OAuth2", "bearer"]),
                ],
            ),
        }
        fmt = DocFormatter()
        result = fmt.format_all(outlines)
        assert "(OAuth2, bearer)" in result

    def test_links_in_output(self):
        outlines = {
            "doc.md": DocOutline(
                path="doc.md",
                headings=[DocHeading(text="Title", level=1)],
                links=[DocLink(target="other.md")],
            ),
        }
        fmt = DocFormatter()
        result = fmt.format_all(outlines)
        assert "links:" in result
        assert "other.md" in result

    def test_exclude_files(self):
        outlines = {
            "a.md": DocOutline(path="a.md", headings=[DocHeading(text="A", level=1)]),
            "b.md": DocOutline(path="b.md", headings=[DocHeading(text="B", level=1)]),
        }
        fmt = DocFormatter()
        result = fmt.format_all(outlines, exclude_files={"a.md"})
        assert "a.md" not in result
        assert "b.md" in result

    def test_ref_count_shown(self):
        ref_idx = DocReferenceIndex()
        outlines = {
            "a.md": DocOutline(path="a.md", links=[DocLink(target="b.md")]),
            "b.md": DocOutline(path="b.md", links=[DocLink(target="a.md")]),
        }
        ref_idx.build(outlines)
        fmt = DocFormatter(reference_index=ref_idx)
        result = fmt.format_all(outlines)
        assert "←" in result

    def test_legend_present(self):
        outlines = {"a.md": DocOutline(path="a.md")}
        fmt = DocFormatter()
        result = fmt.format_all(outlines)
        assert "Document outline" in result

    def test_chunks(self):
        outlines = {}
        for i in range(10):
            outlines[f"doc{i}.md"] = DocOutline(
                path=f"doc{i}.md",
                headings=[DocHeading(text=f"Doc {i}", level=1)],
            )
        fmt = DocFormatter()
        chunks = fmt.format_all(outlines, chunks=3)
        assert isinstance(chunks, list)
        assert len(chunks) <= 3


# === DocIndex Integration Tests ===

class TestDocIndexIntegration:

    @pytest.fixture
    def repo(self, tmp_path):
        docs = tmp_path / "docs"
        docs.mkdir()
        (docs / "readme.md").write_text(
            "# Project\n\n## Overview\n\nA project.\n\n"
            "## Links\n\nSee [spec](spec.md)\n"
        )
        (docs / "spec.md").write_text(
            "# Spec\n\n## API\n\nThe API.\n\n"
            "## References\n\nSee [readme](readme.md)\n"
        )
        (tmp_path / "src").mkdir()
        (tmp_path / "src" / "main.py").write_text("print('hello')\n")
        (tmp_path / "README.md").write_text(
            "# Top\n\nSee [docs](docs/readme.md)\n"
        )
        return tmp_path

    def test_index_repo(self, repo):
        idx = DocIndex(str(repo), doc_config={"keywords_enabled": False})
        result = idx.index_repo()
        assert len(result) >= 3  # docs/readme.md, docs/spec.md, README.md

    def test_doc_map_output(self, repo):
        idx = DocIndex(str(repo), doc_config={"keywords_enabled": False})
        idx.index_repo()
        doc_map = idx.get_doc_map()
        assert "readme.md" in doc_map
        assert "spec.md" in doc_map
        assert "# Project" in doc_map or "Project" in doc_map

    def test_exclude_active_files(self, repo):
        idx = DocIndex(str(repo), doc_config={"keywords_enabled": False})
        idx.index_repo()
        doc_map = idx.get_doc_map(exclude_files={"README.md"})
        assert "README.md:" not in doc_map

    def test_invalidate_file(self, repo):
        idx = DocIndex(str(repo), doc_config={"keywords_enabled": False})
        idx.index_repo()
        assert idx.get_file_doc_block("README.md")
        idx.invalidate_file("README.md")
        assert not idx.get_file_doc_block("README.md")

    def test_reference_index_built(self, repo):
        idx = DocIndex(str(repo), doc_config={"keywords_enabled": False})
        idx.index_repo()
        ref = idx.reference_index
        # docs/readme.md and docs/spec.md link to each other
        components = ref.connected_components()
        assert len(components) >= 1

    def test_file_doc_block(self, repo):
        idx = DocIndex(str(repo), doc_config={"keywords_enabled": False})
        idx.index_repo()
        block = idx.get_file_doc_block("README.md")
        assert "README.md" in block
        assert "Top" in block

    def test_signature_hash(self, repo):
        idx = DocIndex(str(repo), doc_config={"keywords_enabled": False})
        idx.index_repo()
        h = idx.get_signature_hash("README.md")
        assert h is not None
        assert len(h) == 16

    def test_caching(self, repo):
        idx = DocIndex(str(repo), doc_config={"keywords_enabled": False})
        idx.index_repo()
        # Second run should use cache
        idx.index_repo()
        assert len(idx._all_outlines) >= 3

    def test_non_md_files_ignored(self, repo):
        idx = DocIndex(str(repo), doc_config={"keywords_enabled": False})
        idx.index_repo()
        # src/main.py should not be indexed
        assert "src/main.py" not in idx._all_outlines


# === KeywordEnricher Progress Callback Tests ===

class TestDocReferenceIndexEdgeCases:

    def test_anchor_fragment_stripped(self):
        """Links with #anchor fragments resolve to the base path."""
        outlines = {
            "a.md": DocOutline(
                path="a.md",
                links=[DocLink(target="b.md#section-1")],
            ),
            "b.md": DocOutline(path="b.md"),
        }
        idx = DocReferenceIndex()
        idx.build(outlines)
        assert idx.file_ref_count("b.md") >= 1

    def test_anchor_only_link_ignored(self):
        """A #fragment-only link (same file) produces no cross-ref."""
        outlines = {
            "a.md": DocOutline(
                path="a.md",
                links=[DocLink(target="#local-section")],
            ),
        }
        idx = DocReferenceIndex()
        idx.build(outlines)
        assert idx.file_ref_count("a.md") == 0

    def test_self_link_ignored(self):
        """A link from a file to itself produces no cross-ref."""
        outlines = {
            "a.md": DocOutline(
                path="a.md",
                links=[DocLink(target="a.md")],
            ),
        }
        idx = DocReferenceIndex()
        idx.build(outlines)
        assert idx.file_ref_count("a.md") == 0

    def test_path_traversal_blocked(self):
        """Links that resolve outside the repo are ignored."""
        outlines = {
            "docs/a.md": DocOutline(
                path="docs/a.md",
                links=[DocLink(target="../../etc/passwd")],
            ),
        }
        idx = DocReferenceIndex()
        idx.build(outlines)
        # Should not create any reference
        assert idx.file_ref_count("../etc/passwd") == 0

    def test_files_referencing(self):
        outlines = {
            "a.md": DocOutline(path="a.md", links=[DocLink(target="b.md")]),
            "b.md": DocOutline(path="b.md"),
        }
        idx = DocReferenceIndex()
        idx.build(outlines)
        refs = idx.files_referencing("b.md")
        assert "a.md" in refs

    def test_file_dependencies(self):
        outlines = {
            "a.md": DocOutline(path="a.md", links=[DocLink(target="b.md")]),
            "b.md": DocOutline(path="b.md"),
        }
        idx = DocReferenceIndex()
        idx.build(outlines)
        deps = idx.file_dependencies("a.md")
        assert "b.md" in deps


class TestDocFormatterEdgeCases:

    def test_path_aliases_computed(self):
        """Paths sharing a common prefix get aliased."""
        outlines = {}
        for i in range(5):
            path = f"docs/specs/doc{i}.md"
            outlines[path] = DocOutline(
                path=path,
                headings=[DocHeading(text=f"Doc {i}", level=1)],
            )
        fmt = DocFormatter()
        result = fmt.format_all(outlines)
        assert "@1/" in result

    def test_format_file_single(self):
        outline = DocOutline(
            path="test.md",
            headings=[DocHeading(text="Title", level=1)],
        )
        fmt = DocFormatter()
        result = fmt.format_file("test.md", outline)
        assert "test.md:" in result
        assert "# Title" in result

    def test_url_links_excluded_from_summary(self):
        """External URL links should not appear in the links: line."""
        outlines = {
            "doc.md": DocOutline(
                path="doc.md",
                headings=[DocHeading(text="Title", level=1)],
                links=[
                    DocLink(target="https://example.com"),
                    DocLink(target="other.md"),
                ],
            ),
        }
        fmt = DocFormatter()
        result = fmt.format_all(outlines)
        assert "other.md" in result
        assert "https://example.com" not in result

    def test_deep_nesting_indentation(self):
        outlines = {
            "doc.md": DocOutline(
                path="doc.md",
                headings=[
                    DocHeading(text="H1", level=1, children=[
                        DocHeading(text="H2", level=2, children=[
                            DocHeading(text="H3", level=3),
                        ]),
                    ]),
                ],
            ),
        }
        fmt = DocFormatter()
        result = fmt.format_all(outlines)
        lines = result.splitlines()
        # Find the H3 line and check it has deeper indentation than H2
        h2_indent = None
        h3_indent = None
        for line in lines:
            if "## H2" in line:
                h2_indent = len(line) - len(line.lstrip())
            if "### H3" in line:
                h3_indent = len(line) - len(line.lstrip())
        assert h2_indent is not None
        assert h3_indent is not None
        assert h3_indent > h2_indent


class TestDocIndexFile:

    @pytest.fixture
    def repo(self, tmp_path):
        (tmp_path / "test.md").write_text("# Hello\n\nWorld\n")
        (tmp_path / "binary.bin").write_bytes(b"\x00\x01\x02")
        return tmp_path

    def test_index_single_file(self, repo):
        idx = DocIndex(str(repo), doc_config={"keywords_enabled": False})
        outline = idx.index_file("test.md")
        assert outline is not None
        assert outline.headings[0].text == "Hello"

    def test_index_nonexistent_file(self, repo):
        idx = DocIndex(str(repo), doc_config={"keywords_enabled": False})
        assert idx.index_file("missing.md") is None

    def test_index_unsupported_extension(self, repo):
        idx = DocIndex(str(repo), doc_config={"keywords_enabled": False})
        assert idx.index_file("binary.bin") is None

    def test_save_doc_map(self, repo):
        idx = DocIndex(str(repo), doc_config={"keywords_enabled": False})
        idx.index_repo()
        out = repo / "output.txt"
        idx.save_doc_map(str(out))
        assert out.exists()
        content = out.read_text()
        assert "test.md" in content

    def test_progress_callback_fires(self, repo):
        idx = DocIndex(str(repo), doc_config={"keywords_enabled": False})
        events = []
        def cb(stage, message, percent):
            events.append((stage, message, percent))
        idx.index_repo(progress_callback=cb)
        assert len(events) >= 1
        stages = [e[0] for e in events]
        assert "doc_index" in stages

    def test_skip_dirs(self, tmp_path):
        """Directories like node_modules and .git are skipped."""
        (tmp_path / "good.md").write_text("# Good\n")
        nm = tmp_path / "node_modules"
        nm.mkdir()
        (nm / "pkg.md").write_text("# Package\n")
        git = tmp_path / ".git"
        git.mkdir()
        (git / "internal.md").write_text("# Git\n")
        idx = DocIndex(str(tmp_path), doc_config={"keywords_enabled": False})
        idx.index_repo()
        assert "good.md" in idx._all_outlines
        assert "node_modules/pkg.md" not in idx._all_outlines
        assert ".git/internal.md" not in idx._all_outlines


class TestKeywordEnricherProgress:

    def test_init_model_fires_progress_callback(self):
        """Progress callback fires during model init even when keybert is unavailable."""
        from ac_dc.doc_index.keyword_enricher import KeywordEnricher
        enricher = KeywordEnricher(model_name="all-mpnet-base-v2")

        progress_events = []
        def _cb(stage, message, percent):
            progress_events.append((stage, message, percent))

        # enrich() triggers lazy init — may or may not succeed depending on
        # whether keybert is installed, but progress events should fire either way
        outline = DocOutline(path="test.md", headings=[DocHeading(text="T", level=1)])
        enricher.enrich(outline, "Some text content here", progress_callback=_cb)

        # At minimum, the "Loading keyword model" event should have fired
        assert len(progress_events) >= 1
        assert progress_events[0][0] == "doc_index"
        assert "Loading keyword model" in progress_events[0][1]
        assert progress_events[0][2] == 2

    def test_init_model_not_called_twice(self):
        """Progress callback only fires on first init, not on subsequent enrich calls."""
        from ac_dc.doc_index.keyword_enricher import KeywordEnricher
        enricher = KeywordEnricher(model_name="all-mpnet-base-v2")

        progress_events = []
        def _cb(stage, message, percent):
            progress_events.append((stage, message, percent))

        outline = DocOutline(path="test.md", headings=[DocHeading(text="T", level=1)])
        enricher.enrich(outline, "Some text", progress_callback=_cb)

        first_count = len(progress_events)
        assert first_count >= 1

        # Second call should not fire progress events again (model already loaded/failed)
        enricher.enrich(outline, "More text", progress_callback=_cb)
        assert len(progress_events) == first_count

    def test_min_section_chars_filtering(self):
        """Sections shorter than min_section_chars get no keywords."""
        from ac_dc.doc_index.keyword_enricher import KeywordEnricher
        enricher = KeywordEnricher(
            model_name="all-mpnet-base-v2",
            min_section_chars=1000,  # very high threshold
        )
        outline = DocOutline(
            path="test.md",
            headings=[DocHeading(text="Short", level=1, start_line=0)],
        )
        result = enricher.enrich(outline, "Short section text", progress_callback=None)
        # Keywords should remain empty since section is too short
        assert result.headings[0].keywords == []


# === Base Cache Tests ===

class TestBaseCache:

    def test_get_put_roundtrip(self):
        from ac_dc.base_cache import BaseCache
        cache = BaseCache()
        cache.put("file.txt", 100.0, {"data": "value"})
        result = cache.get("file.txt", 100.0)
        assert result == {"data": "value"}

    def test_stale_mtime_returns_none(self):
        from ac_dc.base_cache import BaseCache
        cache = BaseCache()
        cache.put("file.txt", 100.0, "data")
        assert cache.get("file.txt", 200.0) is None

    def test_invalidate(self):
        from ac_dc.base_cache import BaseCache
        cache = BaseCache()
        cache.put("file.txt", 100.0, "data")
        cache.invalidate("file.txt")
        assert cache.get("file.txt", 100.0) is None

    def test_clear(self):
        from ac_dc.base_cache import BaseCache
        cache = BaseCache()
        cache.put("a.txt", 1.0, "a")
        cache.put("b.txt", 2.0, "b")
        cache.clear()
        assert cache.get("a.txt", 1.0) is None
        assert cache.get("b.txt", 2.0) is None

    def test_cached_files(self):
        from ac_dc.base_cache import BaseCache
        cache = BaseCache()
        cache.put("a.txt", 1.0, "a")
        cache.put("b.txt", 2.0, "b")
        assert cache.cached_files == {"a.txt", "b.txt"}

    def test_get_hash(self):
        from ac_dc.base_cache import BaseCache
        cache = BaseCache()
        cache.put("file.txt", 100.0, "data")
        h = cache.get_hash("file.txt")
        assert h is not None

    def test_get_hash_missing(self):
        from ac_dc.base_cache import BaseCache
        cache = BaseCache()
        assert cache.get_hash("missing.txt") is None

    def test_get_extra(self):
        from ac_dc.base_cache import BaseCache
        cache = BaseCache()
        cache.put("file.txt", 100.0, "data", keyword_model="test-model")
        assert cache.get_extra("file.txt", "keyword_model") == "test-model"

    def test_get_extra_missing(self):
        from ac_dc.base_cache import BaseCache
        cache = BaseCache()
        assert cache.get_extra("missing.txt", "key") is None


# === Config Extended Tests ===

class TestConfigExtended:

    def test_get_doc_system_prompt(self):
        from ac_dc.config import ConfigManager
        config = ConfigManager()
        prompt = config.get_doc_system_prompt()
        assert len(prompt) > 0
        assert "document" in prompt.lower()

    def test_get_doc_snippets(self):
        from ac_dc.config import ConfigManager
        config = ConfigManager()
        snippets = config.get_doc_snippets()
        assert isinstance(snippets, list)
        assert len(snippets) > 0

    def test_get_review_prompt(self):
        from ac_dc.config import ConfigManager
        config = ConfigManager()
        prompt = config.get_review_prompt()
        assert len(prompt) > 0

    def test_cache_target_tokens_for_model(self):
        from ac_dc.config import ConfigManager
        config = ConfigManager()
        result = config.cache_target_tokens_for_model(4096)
        # Should be at least 4096 * buffer multiplier
        assert result >= 4096

    def test_cache_target_tokens_uses_larger_of_config_and_model(self):
        from ac_dc.config import ConfigManager
        config = ConfigManager()
        # With a very small model minimum, config minimum should win
        small_result = config.cache_target_tokens_for_model(1)
        # With a very large model minimum, model minimum should win
        large_result = config.cache_target_tokens_for_model(100000)
        assert large_result > small_result

    def test_doc_index_config_property(self):
        from ac_dc.config import ConfigManager
        config = ConfigManager()
        doc_config = config.doc_index_config
        assert isinstance(doc_config, dict)
        assert "keyword_model" in doc_config

    def test_url_cache_config_property(self):
        from ac_dc.config import ConfigManager
        config = ConfigManager()
        url_config = config.url_cache_config
        assert isinstance(url_config, dict)
        assert "ttl_hours" in url_config

    def test_get_system_reminder(self):
        from ac_dc.config import ConfigManager
        config = ConfigManager()
        reminder = config.get_system_reminder()
        assert isinstance(reminder, str)


# === Context Manager Extended Tests ===

class TestContextManagerExtended:

    def test_set_and_get_system_prompt(self):
        from ac_dc.context import ContextManager
        ctx = ContextManager(system_prompt="original")
        assert ctx.get_system_prompt() == "original"
        ctx.set_system_prompt("updated")
        assert ctx.get_system_prompt() == "updated"

    def test_reregister_history_items(self):
        from ac_dc.context import ContextManager
        from ac_dc.stability_tracker import StabilityTracker, TrackedItem, Tier
        ctx = ContextManager()
        tracker = StabilityTracker(cache_target_tokens=1024)
        ctx.set_stability_tracker(tracker)
        # Add a history item to the tracker
        tracker._items["history:0"] = TrackedItem(
            key="history:0", tier=Tier.ACTIVE, n=1,
            content_hash="abc", tokens=100,
        )
        assert tracker.get_item("history:0") is not None
        ctx.reregister_history_items()
        assert tracker.get_item("history:0") is None

    def test_mode_string_conversion(self):
        from ac_dc.context import ContextManager, Mode
        ctx = ContextManager()
        ctx.set_mode("doc")
        assert ctx.mode == Mode.DOC
        ctx.set_mode("code")
        assert ctx.mode == Mode.CODE


# === Context Mode Tests ===

class TestContextMode:

    def test_mode_default_is_code(self):
        from ac_dc.context import ContextManager, Mode
        ctx = ContextManager()
        assert ctx.mode == Mode.CODE

    def test_mode_switch(self):
        from ac_dc.context import ContextManager, Mode
        ctx = ContextManager()
        ctx.set_mode(Mode.DOC)
        assert ctx.mode == Mode.DOC
        ctx.set_mode("code")
        assert ctx.mode == Mode.CODE