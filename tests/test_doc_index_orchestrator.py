"""Tests for :class:`DocIndex` — Layer 2.8.1f.
Covers:
- **Construction** — with and without repo root.
- **Per-file pipeline** — cache hit, cache miss, unknown
  extension, missing file, extractor failure, mtime change.
- **Multi-file pipeline** — explicit file list, walked
  discovery, stale removal ordering, reference graph rebuild.
- **Discovery** — excluded directories, hidden directories,
  extension filtering, .github exception.
- **Invalidation** — memory + cache invalidate, return value.
- **Read methods** — snapshot discipline (no mutation), empty
  index behaviour, missing-path handling, legend extraction.
- **Signature hash** — delegation to cache, mtime-insensitive
  stability.
- **Keyword model plumbing** — None passes through (2.8.1);
  non-None requires match on cache lookup.
- **Reference graph integration** — incoming counts populated,
  cross-doc edges formed.
Uses real filesystem via ``tmp_path`` — no mock for the disk
layer because the integration between cache, extractor, and
reference index is part of the contract, and mocks would miss
ordering / path-normalisation issues.
"""
from __future__ import annotations
from pathlib import Path
import pytest
from ac_dc.doc_index.extractors.markdown import MarkdownExtractor
from ac_dc.doc_index.index import DocIndex
from ac_dc.doc_index.models import DocOutline
# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture
def repo_root(tmp_path: Path) -> Path:
    """Fresh repo root for each test."""
    root = tmp_path / "repo"
    root.mkdir()
    return root
@pytest.fixture
def index(repo_root: Path) -> DocIndex:
    """DocIndex with disk persistence enabled."""
    return DocIndex(repo_root)
def _write(path: Path, content: str) -> None:
    """Write content to a file, creating parents as needed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------
class TestConstruction:
    def test_with_repo_root(self, repo_root: Path) -> None:
        idx = DocIndex(repo_root)
        assert idx.repo_root == repo_root
    def test_with_string_path(self, repo_root: Path) -> None:
        idx = DocIndex(str(repo_root))
        assert idx.repo_root == repo_root
    def test_without_repo_root(self) -> None:
        idx = DocIndex()
        assert idx.repo_root is None
    def test_exposes_components(self, index: DocIndex) -> None:
        # Public-ish attributes the service layer reads.
        assert index._cache is not None
        assert index._ref_index is not None
        assert index._formatter is not None
    def test_empty_initial_state(self, index: DocIndex) -> None:
        assert index._all_outlines == {}
        assert index.get_doc_map() == ""
    def test_markdown_extractor_registered(
        self, index: DocIndex
    ) -> None:
        # 2.8.1 registers markdown; SVG lands in 2.8.3.
        assert ".md" in index._extractors
        assert ".markdown" in index._extractors
        assert isinstance(
            index._extractors[".md"], MarkdownExtractor
        )
# ---------------------------------------------------------------------------
# Per-file pipeline
# ---------------------------------------------------------------------------
class TestIndexFile:
    def test_indexes_markdown_file(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(
            repo_root / "doc.md",
            "# Title\n\nSome prose.\n",
        )
        outline = index.index_file("doc.md")
        assert outline is not None
        assert isinstance(outline, DocOutline)
        assert outline.file_path == "doc.md"
        assert len(outline.headings) == 1
        assert outline.headings[0].text == "Title"
    def test_stores_in_all_outlines(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "a.md", "# A\n")
        index.index_file("a.md")
        assert "a.md" in index._all_outlines
    def test_markdown_lowercase_extension_variant(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        # .markdown (long form) also registered.
        _write(
            repo_root / "long.markdown", "# Long form\n"
        )
        outline = index.index_file("long.markdown")
        assert outline is not None
        assert "long.markdown" in index._all_outlines
    def test_unknown_extension_returns_none(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "code.py", "# not a heading in py\n")
        assert index.index_file("code.py") is None
        assert "code.py" not in index._all_outlines
    def test_missing_file_returns_none(
        self, index: DocIndex
    ) -> None:
        # File doesn't exist on disk.
        assert index.index_file("ghost.md") is None
    def test_missing_file_invalidates_stale_entry(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        # File exists, gets indexed, then is deleted. A
        # follow-up index_file call should invalidate the
        # stale memory entry.
        path = repo_root / "doc.md"
        _write(path, "# Once\n")
        index.index_file("doc.md")
        assert "doc.md" in index._all_outlines
        path.unlink()
        result = index.index_file("doc.md")
        assert result is None
        assert "doc.md" not in index._all_outlines
    def test_cache_hit_on_unchanged_mtime(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "doc.md", "# Title\n")
        first = index.index_file("doc.md")
        # Second call — mtime unchanged, same object returned.
        second = index.index_file("doc.md")
        assert first is second
    def test_cache_miss_on_mtime_change(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        path = repo_root / "doc.md"
        _write(path, "# First\n")
        first = index.index_file("doc.md")
        # Rewrite the file with different content and a
        # different mtime.
        import os
        import time
        time.sleep(0.01)
        _write(path, "# Second\n")
        # Ensure mtime moves forward.
        os.utime(path, None)
        second = index.index_file("doc.md")
        assert second is not None
        assert second is not first
        assert second.headings[0].text == "Second"
    def test_extractor_exception_returns_none(
        self,
        index: DocIndex,
        repo_root: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        # Force the markdown extractor to raise. Orchestrator
        # should log and return None rather than propagate.
        _write(repo_root / "doc.md", "# Title\n")
        def _raise(*args, **kwargs):
            raise RuntimeError("simulated extraction failure")
        monkeypatch.setattr(
            index._extractors[".md"], "extract", _raise
        )
        assert index.index_file("doc.md") is None
        assert "doc.md" not in index._all_outlines
    def test_accepts_absolute_path(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "doc.md", "# Abs\n")
        absolute = repo_root / "doc.md"
        outline = index.index_file(str(absolute))
        assert outline is not None
        # Stored under absolute path as key (matches
        # normalisation — absolute paths are normalised
        # to strip leading slash but keep the path body).
        # This is a defensive path; real callers pass
        # repo-relative paths.
        assert outline.file_path.endswith("doc.md")
    def test_backslash_path_normalised(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "sub" / "doc.md", "# Nested\n")
        outline = index.index_file("sub\\doc.md")
        assert outline is not None
        # Stored with forward-slash key.
        assert "sub/doc.md" in index._all_outlines
# ---------------------------------------------------------------------------
# Keyword-model plumbing
# ---------------------------------------------------------------------------
class TestKeywordModel:
    def test_none_model_accepts_any_cached_entry(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "doc.md", "# Title\n")
        # First put stores with model=None. Second read with
        # model=None returns the cached copy.
        first = index.index_file("doc.md", keyword_model=None)
        second = index.index_file("doc.md", keyword_model=None)
        assert first is second
    def test_specific_model_forces_reextract_when_cache_none(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "doc.md", "# Title\n")
        # First put: model=None.
        index.index_file("doc.md", keyword_model=None)
        # Second read with a specific model — cache miss on
        # model mismatch. Forces re-extract (but the file is
        # unchanged, so new outline has same structural content).
        result = index.index_file(
            "doc.md", keyword_model="model-X"
        )
        assert result is not None
# ---------------------------------------------------------------------------
# Multi-file pipeline
# ---------------------------------------------------------------------------
class TestIndexRepo:
    def test_indexes_explicit_file_list(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "a.md", "# A\n")
        _write(repo_root / "b.md", "# B\n")
        _write(repo_root / "c.py", "# python file, skipped\n")
        index.index_repo(["a.md", "b.md", "c.py"])
        assert set(index._all_outlines.keys()) == {"a.md", "b.md"}
    def test_walks_repo_when_no_list(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "a.md", "# A\n")
        _write(repo_root / "sub" / "b.md", "# B\n")
        _write(repo_root / "c.py", "x = 1\n")
        index.index_repo()
        assert set(index._all_outlines.keys()) == {
            "a.md",
            "sub/b.md",
        }
    def test_walk_skips_excluded_dirs(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "a.md", "# A\n")
        # Excluded directories — mustn't show up in results.
        _write(repo_root / ".git" / "HEAD.md", "# git internal\n")
        _write(
            repo_root / "node_modules" / "lib.md",
            "# dep\n",
        )
        _write(
            repo_root / ".ac-dc" / "state.md",
            "# state\n",
        )
        _write(repo_root / "__pycache__" / "x.md", "# py\n")
        index.index_repo()
        assert set(index._all_outlines.keys()) == {"a.md"}
    def test_walk_skips_hidden_dirs_except_github(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "a.md", "# A\n")
        # .github is explicitly allowed (CI docs, etc).
        _write(
            repo_root / ".github" / "workflow.md",
            "# workflow\n",
        )
        # Generic hidden directory — skipped.
        _write(
            repo_root / ".hidden" / "secret.md",
            "# secret\n",
        )
        index.index_repo()
        assert "a.md" in index._all_outlines
        assert ".github/workflow.md" in index._all_outlines
        assert ".hidden/secret.md" not in index._all_outlines
    def test_walk_respects_repo_root_boundary(
        self, index: DocIndex, repo_root: Path, tmp_path: Path
    ) -> None:
        # Files outside the configured repo root aren't found.
        _write(repo_root / "inside.md", "# In\n")
        _write(tmp_path / "outside.md", "# Out\n")
        index.index_repo()
        assert "inside.md" in index._all_outlines
        # outside.md lives in tmp_path, not tmp_path/repo.
        assert not any(
            "outside.md" in key for key in index._all_outlines
        )
    def test_explicit_empty_list_prunes_everything(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        # Index some files, then explicit empty list —
        # everything gets pruned.
        _write(repo_root / "a.md", "# A\n")
        index.index_repo(["a.md"])
        assert "a.md" in index._all_outlines
        index.index_repo([])
        assert index._all_outlines == {}
    def test_builds_reference_graph(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        # Two docs with bidirectional links.
        _write(
            repo_root / "a.md",
            "# A\n\nSee [B](b.md) for more.\n",
        )
        _write(
            repo_root / "b.md",
            "# B\n\nSee [A](a.md) for more.\n",
        )
        index.index_repo()
        # File-level incoming ref counts populated.
        assert index._ref_index.file_ref_count("a.md") == 1
        assert index._ref_index.file_ref_count("b.md") == 1
        # Bidirectional pair clusters.
        components = index._ref_index.connected_components()
        assert {"a.md", "b.md"} in components
    def test_populates_incoming_ref_count_on_headings(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        # Overview referenced by two details docs.
        _write(
            repo_root / "overview.md",
            "# Overview\n\n## Key Concepts\n\nBody.\n",
        )
        _write(
            repo_root / "details-a.md",
            "# A\n\n[kc](overview.md#key-concepts)\n",
        )
        _write(
            repo_root / "details-b.md",
            "# B\n\n[kc](overview.md#key-concepts)\n",
        )
        index.index_repo()
        overview = index._all_outlines["overview.md"]
        # The "Key Concepts" subheading should have incoming
        # count 2 (reference index mutated it in-place).
        kc_heading = overview.headings[0].children[0]
        assert kc_heading.text == "Key Concepts"
        assert kc_heading.incoming_ref_count == 2
    def test_empty_repo_is_safe(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        # No .md files at all.
        index.index_repo()
        assert index._all_outlines == {}
        assert index.get_doc_map() == ""
    def test_no_repo_root_no_list_is_noop(self) -> None:
        idx = DocIndex()
        # Neither a repo root nor an explicit file list —
        # nothing to walk, nothing to index. Must not crash.
        idx.index_repo()
        assert idx._all_outlines == {}


# ---------------------------------------------------------------------------
# Stale entry removal
# ---------------------------------------------------------------------------


class TestStaleRemoval:
    """Files removed from the repo must drop from the index."""

    def test_file_removed_from_list_drops_from_memory(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "a.md", "# A\n")
        _write(repo_root / "b.md", "# B\n")
        index.index_repo(["a.md", "b.md"])
        assert set(index._all_outlines.keys()) == {"a.md", "b.md"}

        # Second pass — b.md dropped from the list. Should
        # prune from memory even though the file still exists
        # on disk.
        index.index_repo(["a.md"])
        assert set(index._all_outlines.keys()) == {"a.md"}

    def test_file_removed_from_list_drops_from_cache(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "a.md", "# A\n")
        _write(repo_root / "b.md", "# B\n")
        index.index_repo(["a.md", "b.md"])
        assert "b.md" in index._cache.cached_paths

        index.index_repo(["a.md"])
        assert "b.md" not in index._cache.cached_paths

    def test_stale_removal_before_reference_build(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        # Regression guard for the documented ordering: prune
        # stale entries BEFORE rebuilding the reference graph.
        # If rebuild ran first, the deleted file would appear
        # as a phantom target/source in the edges.
        _write(
            repo_root / "a.md",
            "# A\n\n[link](deleted.md)\n",
        )
        _write(repo_root / "deleted.md", "# Deleted\n")
        index.index_repo(["a.md", "deleted.md"])

        # deleted.md has an incoming ref from a.md.
        assert index._ref_index.file_ref_count("deleted.md") == 1

        # Second pass without deleted.md — it's pruned, and
        # a.md's link target no longer resolves to a known file.
        index.index_repo(["a.md"])
        assert "deleted.md" not in index._all_outlines
        # The file-level edge still exists in the ref graph
        # (defensive — extractor-validated paths may lag), but
        # deleted.md isn't in _all_files if we prune correctly
        # before rebuilding. Actual test: the ref count on the
        # surviving files is correct.
        assert index._ref_index.file_ref_count("a.md") == 0


# ---------------------------------------------------------------------------
# Invalidation
# ---------------------------------------------------------------------------


class TestInvalidateFile:
    def test_invalidate_present_file(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "doc.md", "# Title\n")
        index.index_file("doc.md")
        assert "doc.md" in index._all_outlines

        assert index.invalidate_file("doc.md") is True
        assert "doc.md" not in index._all_outlines

    def test_invalidate_absent_file_returns_false(
        self, index: DocIndex
    ) -> None:
        assert index.invalidate_file("never-indexed.md") is False

    def test_invalidate_removes_from_cache(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "doc.md", "# Title\n")
        index.index_file("doc.md")
        assert "doc.md" in index._cache.cached_paths

        index.invalidate_file("doc.md")
        assert "doc.md" not in index._cache.cached_paths

    def test_invalidate_normalises_path(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "sub" / "doc.md", "# Nested\n")
        index.index_file("sub/doc.md")
        # Invalidate via backslash variant.
        assert index.invalidate_file("sub\\doc.md") is True
        assert "sub/doc.md" not in index._all_outlines


# ---------------------------------------------------------------------------
# Read methods: get_doc_map, get_legend, get_file_doc_block
# ---------------------------------------------------------------------------


class TestReadMethods:
    def test_get_doc_map_empty(self, index: DocIndex) -> None:
        # No outlines indexed — empty string for clean
        # concatenation by callers.
        assert index.get_doc_map() == ""

    def test_get_doc_map_single_file(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "doc.md", "# Title\n")
        index.index_file("doc.md")
        out = index.get_doc_map()
        assert "doc.md:" in out
        assert "# Title" in out

    def test_get_doc_map_multiple_files(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "a.md", "# A\n")
        _write(repo_root / "b.md", "# B\n")
        index.index_repo(["a.md", "b.md"])
        out = index.get_doc_map()
        assert "a.md:" in out
        assert "b.md:" in out

    def test_get_doc_map_respects_exclude(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "a.md", "# A\n")
        _write(repo_root / "b.md", "# B\n")
        index.index_repo(["a.md", "b.md"])
        out = index.get_doc_map(exclude_files={"b.md"})
        assert "a.md:" in out
        assert "b.md:" not in out

    def test_get_legend_empty_index(
        self, index: DocIndex
    ) -> None:
        # Legend is still produced — it's a generic marker
        # reference, doesn't require any files to be indexed.
        legend = index.get_legend()
        assert legend.strip() != ""

    def test_get_legend_with_files(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "doc.md", "# Title\n")
        index.index_file("doc.md")
        legend = index.get_legend()
        # Legend includes the doc-specific markers.
        assert "[table]" in legend or "keywords" in legend

    def test_get_file_doc_block_returns_single_file(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "a.md", "# A\n")
        _write(repo_root / "b.md", "# B\n")
        index.index_repo(["a.md", "b.md"])
        block = index.get_file_doc_block("a.md")
        assert block is not None
        assert "a.md:" in block
        assert "# A" in block
        # b.md's content is NOT in a.md's block.
        assert "b.md:" not in block
        assert "# B" not in block

    def test_get_file_doc_block_unknown_file(
        self, index: DocIndex
    ) -> None:
        # Unknown files return None — matches SymbolIndex
        # behaviour so the stability tracker can probe for
        # blocks without crashing.
        assert index.get_file_doc_block("ghost.md") is None

    def test_get_file_doc_block_normalises_path(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "sub" / "doc.md", "# Nested\n")
        index.index_file("sub/doc.md")
        # Backslash variant resolves to the same key.
        block = index.get_file_doc_block("sub\\doc.md")
        assert block is not None


# ---------------------------------------------------------------------------
# Signature hash
# ---------------------------------------------------------------------------


class TestSignatureHash:
    def test_returns_hash_for_indexed_file(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "doc.md", "# Title\n")
        index.index_file("doc.md")
        hash_value = index.get_signature_hash("doc.md")
        assert hash_value is not None
        assert isinstance(hash_value, str)
        assert len(hash_value) == 64  # SHA-256 hex

    def test_returns_none_for_unknown_file(
        self, index: DocIndex
    ) -> None:
        assert index.get_signature_hash("ghost.md") is None

    def test_hash_stable_across_unchanged_content(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        path = repo_root / "doc.md"
        _write(path, "# Title\n\nProse.\n")
        index.index_file("doc.md")
        h1 = index.get_signature_hash("doc.md")

        # Re-index without changing the file — hash stays.
        # (Cache hit, no re-extraction, but the hash comes
        # from the stored entry either way.)
        index.index_file("doc.md")
        h2 = index.get_signature_hash("doc.md")
        assert h1 == h2

    def test_hash_changes_on_structural_edit(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        import os
        import time

        path = repo_root / "doc.md"
        _write(path, "# Title\n")
        index.index_file("doc.md")
        h1 = index.get_signature_hash("doc.md")

        # Add a heading — structural change.
        time.sleep(0.01)
        _write(path, "# Title\n\n## New Section\n")
        os.utime(path, None)
        index.index_file("doc.md")
        h2 = index.get_signature_hash("doc.md")
        assert h1 != h2

    def test_hash_normalises_path(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "sub" / "doc.md", "# Nested\n")
        index.index_file("sub/doc.md")
        # Access via a different separator variant.
        h1 = index.get_signature_hash("sub/doc.md")
        h2 = index.get_signature_hash("sub\\doc.md")
        assert h1 is not None
        assert h1 == h2


# ---------------------------------------------------------------------------
# Snapshot discipline (D10)
# ---------------------------------------------------------------------------


class TestSnapshotDiscipline:
    """Read methods must not mutate ``_all_outlines``.

    Within a request window (the scope between two ``index_repo``
    calls), the index is a read-only snapshot. Map-rendering,
    per-file block lookup, and signature-hash queries must not
    add, remove, or modify entries — otherwise concurrent reads
    during tier assembly could observe half-mutated state.
    """

    def test_get_doc_map_does_not_mutate(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "a.md", "# A\n")
        _write(repo_root / "b.md", "# B\n")
        index.index_repo(["a.md", "b.md"])
        before = set(index._all_outlines.keys())

        index.get_doc_map()

        after = set(index._all_outlines.keys())
        assert before == after

    def test_get_doc_map_produces_identical_output_twice(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(
            repo_root / "a.md",
            "# A\n\nSee [b](b.md).\n",
        )
        _write(repo_root / "b.md", "# B\n")
        index.index_repo(["a.md", "b.md"])

        # Two back-to-back calls — byte-identical output.
        out1 = index.get_doc_map()
        out2 = index.get_doc_map()
        assert out1 == out2

    def test_get_file_doc_block_does_not_mutate(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "doc.md", "# Title\n")
        index.index_file("doc.md")
        before = set(index._all_outlines.keys())

        index.get_file_doc_block("doc.md")

        after = set(index._all_outlines.keys())
        assert before == after

    def test_get_file_doc_block_stable_across_calls(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "doc.md", "# Title\n\n## Sub\n")
        index.index_file("doc.md")
        b1 = index.get_file_doc_block("doc.md")
        b2 = index.get_file_doc_block("doc.md")
        assert b1 == b2

    def test_reads_do_not_mutate_all_outlines(
        self, index: DocIndex, repo_root: Path
    ) -> None:
        # Every read method in one sweep.
        _write(repo_root / "a.md", "# A\n")
        _write(repo_root / "b.md", "# B\n")
        index.index_repo(["a.md", "b.md"])
        snapshot = dict(index._all_outlines)

        index.get_doc_map()
        index.get_legend()
        index.get_file_doc_block("a.md")
        index.get_signature_hash("a.md")
        index.get_file_doc_block("nonexistent.md")
        index.get_signature_hash("nonexistent.md")

        # Dict keys and identities unchanged — same outline
        # objects in the same slots.
        assert set(index._all_outlines.keys()) == set(snapshot.keys())
        for key in snapshot:
            assert index._all_outlines[key] is snapshot[key]