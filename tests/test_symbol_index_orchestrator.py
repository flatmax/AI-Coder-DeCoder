"""Tests for ac_dc.symbol_index.index — Layer 2.7.

Scope: the SymbolIndex orchestrator that wires parser,
extractors, cache, resolver, reference index, and formatter
into a single entry point.

Strategy:

- Integration-heavy. Tests use real tree-sitter parses via
  the shipped grammars. Small hand-crafted Python files
  under tmp_path exercise the full pipeline end-to-end.
- Mocking reserved for components whose real version would
  drag in git (Repo interactions) — everything else is real.
- One test class per feature area: construction, per-file
  pipeline, multi-file pipeline, stale removal, caching
  behaviour, query methods, snapshot discipline.

Governing spec: specs4/2-indexing/symbol-index.md.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from ac_dc.symbol_index.index import SymbolIndex
from ac_dc.symbol_index.parser import TreeSitterParser


@pytest.fixture
def repo_dir(tmp_path: Path) -> Path:
    """A throwaway directory acting as a repo root."""
    return tmp_path


@pytest.fixture
def index(repo_dir: Path) -> SymbolIndex:
    """Fresh SymbolIndex per test.

    Skips the test module if tree-sitter-python isn't
    installed — matches the extractor tests' pattern.
    """
    parser = TreeSitterParser()
    if not parser.is_available("python"):
        pytest.skip("tree_sitter_python not installed")
    return SymbolIndex(repo_root=repo_dir)


def _write(path: Path, content: str) -> None:
    """Write content to path, creating parent dirs as needed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------


class TestConstruction:
    """SymbolIndex wires parser, cache, extractors, resolver, ref index."""

    def test_constructs_with_repo_root(self, repo_dir: Path) -> None:
        """Constructor accepts a repo_root and initialises components."""
        parser = TreeSitterParser()
        if not parser.is_available("python"):
            pytest.skip("tree_sitter_python not installed")
        idx = SymbolIndex(repo_root=repo_dir)
        assert idx.repo_root == repo_dir

    def test_constructs_without_repo_root(self) -> None:
        """Repo root is optional — used for file walking but not required
        for single-file operations."""
        parser = TreeSitterParser()
        if not parser.is_available("python"):
            pytest.skip("tree_sitter_python not installed")
        idx = SymbolIndex()
        assert idx.repo_root is None

    def test_exposes_core_components(self, index: SymbolIndex) -> None:
        """The cache, reference index, and resolver are reachable.

        Tests downstream (especially orchestration tests) need
        access to these — pin the attribute names so a refactor
        can't silently break the public surface.
        """
        assert index._cache is not None
        assert index._ref_index is not None
        assert index._resolver is not None

    def test_all_symbols_empty_initially(self, index: SymbolIndex) -> None:
        """Fresh index has no indexed files."""
        assert index._all_symbols == {}


# ---------------------------------------------------------------------------
# Per-file pipeline — index_file
# ---------------------------------------------------------------------------


class TestIndexFile:
    """Single-file extraction, caching, and storage."""

    def test_indexes_python_file(
        self, index: SymbolIndex, repo_dir: Path
    ) -> None:
        """A .py file is parsed, extracted, and stored."""
        _write(
            repo_dir / "foo.py",
            "def hello():\n    return 42\n",
        )
        result = index.index_file("foo.py")
        assert result is not None
        assert result.file_path == "foo.py"
        names = [s.name for s in result.symbols]
        assert "hello" in names

    def test_stores_in_all_symbols(
        self, index: SymbolIndex, repo_dir: Path
    ) -> None:
        """Indexed files are accessible via _all_symbols."""
        _write(repo_dir / "foo.py", "x = 1\n")
        index.index_file("foo.py")
        assert "foo.py" in index._all_symbols
        assert index._all_symbols["foo.py"].file_path == "foo.py"

    def test_unknown_extension_returns_none(
        self, index: SymbolIndex, repo_dir: Path
    ) -> None:
        """Files without a recognised extension skip extraction.

        The orchestrator walks the repo and calls index_file per
        file; unrecognised extensions must return None cleanly
        so the caller just skips them rather than crashing.
        """
        _write(repo_dir / "readme.md", "# hello\n")
        assert index.index_file("readme.md") is None

    def test_missing_file_returns_none(
        self, index: SymbolIndex
    ) -> None:
        """Missing files return None rather than raising.

        The walker might race with a file deletion; graceful
        None makes the orchestrator resilient to that case.
        """
        assert index.index_file("does-not-exist.py") is None

    def test_cache_hit_on_unchanged_mtime(
        self, index: SymbolIndex, repo_dir: Path
    ) -> None:
        """A second index_file with unchanged mtime uses the cache.

        We verify this by confirming the returned object is the
        same instance — the cache stores references, not copies,
        so identity is preserved across cache hits.
        """
        _write(repo_dir / "foo.py", "def hello():\n    pass\n")
        first = index.index_file("foo.py")
        second = index.index_file("foo.py")
        assert first is second

    def test_cache_miss_on_mtime_change(
        self, index: SymbolIndex, repo_dir: Path
    ) -> None:
        """Modifying a file triggers a re-parse.

        We bump the mtime to a known-distinct value rather than
        relying on filesystem timing — some filesystems have 1s
        mtime granularity and back-to-back writes can produce
        the same timestamp.
        """
        import os

        path = repo_dir / "foo.py"
        _write(path, "def old(): pass\n")
        first = index.index_file("foo.py")
        assert first is not None
        assert first.symbols[0].name == "old"

        _write(path, "def new(): pass\n")
        # Force a distinct mtime to avoid filesystem granularity
        # masking the change.
        mtime = path.stat().st_mtime + 1
        os.utime(path, (mtime, mtime))

        second = index.index_file("foo.py")
        assert second is not None
        assert second.symbols[0].name == "new"

    def test_dispatches_by_language(
        self, index: SymbolIndex, repo_dir: Path
    ) -> None:
        """Different languages route to their own extractor.

        We check that a .py and a .js file both extract
        successfully — proves the dispatch is wired correctly,
        not just that one extractor path works.
        """
        parser = TreeSitterParser()
        if not parser.is_available("javascript"):
            pytest.skip("tree_sitter_javascript not installed")
        _write(repo_dir / "a.py", "def foo(): pass\n")
        _write(repo_dir / "b.js", "function bar() {}\n")

        py_result = index.index_file("a.py")
        js_result = index.index_file("b.js")

        assert py_result is not None
        assert py_result.symbols[0].name == "foo"
        assert js_result is not None
        assert js_result.symbols[0].name == "bar"


# ---------------------------------------------------------------------------
# Multi-file pipeline — index_repo
# ---------------------------------------------------------------------------


class TestIndexRepo:
    """Full-repo indexing: discovery, dispatch, reference graph."""

    def test_indexes_all_supported_files(
        self, index: SymbolIndex, repo_dir: Path
    ) -> None:
        """index_repo walks the given file list and extracts each."""
        _write(repo_dir / "a.py", "def foo(): pass\n")
        _write(repo_dir / "b.py", "def bar(): pass\n")
        index.index_repo(["a.py", "b.py"])
        assert "a.py" in index._all_symbols
        assert "b.py" in index._all_symbols

    def test_skips_unsupported_extensions(
        self, index: SymbolIndex, repo_dir: Path
    ) -> None:
        """Files with no matching extractor are silently skipped.

        The caller often passes the full repo file list; the
        orchestrator must filter rather than crash.
        """
        _write(repo_dir / "a.py", "x = 1\n")
        _write(repo_dir / "readme.md", "# hi\n")
        _write(repo_dir / "data.txt", "plain text\n")
        index.index_repo(["a.py", "readme.md", "data.txt"])
        assert "a.py" in index._all_symbols
        assert "readme.md" not in index._all_symbols
        assert "data.txt" not in index._all_symbols

    def test_builds_reference_index(
        self, index: SymbolIndex, repo_dir: Path
    ) -> None:
        """After indexing, the reference index reflects cross-file calls.

        File a.py imports from b.py and calls its function.
        The resolver populates target_file on the call site,
        which feeds into the reference index — files_referencing
        should show the edge.
        """
        _write(
            repo_dir / "b.py",
            "def helper():\n    return 42\n",
        )
        _write(
            repo_dir / "a.py",
            "from b import helper\n"
            "\n"
            "def caller():\n"
            "    return helper()\n",
        )
        index.index_repo(["a.py", "b.py"])
        # a.py depends on b.py (via import + call).
        assert "b.py" in index._ref_index.file_dependencies("a.py")
        assert "a.py" in index._ref_index.files_referencing("b.py")

    def test_resolves_call_site_targets(
        self, index: SymbolIndex, repo_dir: Path
    ) -> None:
        """Call sites get target_file populated via cross-file resolution.

        Without this post-pass, the reference index would see
        bare call names with no file attribution and no edges
        would form. This is the contract Layer 2.4 depends on.
        """
        _write(
            repo_dir / "helpers.py",
            "def util():\n    return 1\n",
        )
        _write(
            repo_dir / "main.py",
            "from helpers import util\n"
            "\n"
            "def run():\n"
            "    return util()\n",
        )
        index.index_repo(["helpers.py", "main.py"])
        main_symbols = index._all_symbols["main.py"]
        run_fn = next(s for s in main_symbols.symbols if s.name == "run")
        util_call = next(
            cs for cs in run_fn.call_sites if cs.name == "util"
        )
        assert util_call.target_file == "helpers.py"

    def test_resolves_imports(
        self, index: SymbolIndex, repo_dir: Path
    ) -> None:
        """Import.resolved_target is populated after indexing.

        The reference graph reads resolved_target to build import
        edges — see Layer 2.4 for the contract.
        """
        _write(repo_dir / "b.py", "x = 1\n")
        _write(
            repo_dir / "a.py",
            "from b import x\n",
        )
        index.index_repo(["a.py", "b.py"])
        a_imports = index._all_symbols["a.py"].imports
        assert len(a_imports) == 1
        assert getattr(a_imports[0], "resolved_target", None) == "b.py"

    def test_empty_file_list_clears_nothing(
        self, index: SymbolIndex
    ) -> None:
        """index_repo with an empty list is safe — no crash, no error.

        Edge case for fresh repos or tests setting up state
        incrementally. Orchestrator must not raise on empty
        input.
        """
        index.index_repo([])
        assert index._all_symbols == {}


# ---------------------------------------------------------------------------
# Stale removal
# ---------------------------------------------------------------------------


class TestStaleRemoval:
    """Files dropped from the repo are removed from memory + cache."""

    def test_removes_file_absent_from_list(
        self, index: SymbolIndex, repo_dir: Path
    ) -> None:
        """A previously-indexed file not in the new list is pruned."""
        _write(repo_dir / "a.py", "x = 1\n")
        _write(repo_dir / "b.py", "y = 2\n")
        index.index_repo(["a.py", "b.py"])
        assert "a.py" in index._all_symbols
        assert "b.py" in index._all_symbols

        # Re-index with only b.py — a.py should be pruned.
        index.index_repo(["b.py"])
        assert "a.py" not in index._all_symbols
        assert "b.py" in index._all_symbols

    def test_invalidates_cache_for_removed_files(
        self, index: SymbolIndex, repo_dir: Path
    ) -> None:
        """Removed files are also dropped from the signature cache.

        Without this, a file that reappears later would hit a
        stale cache entry with the wrong mtime semantics — the
        cache would happily return the pre-removal content.
        """
        _write(repo_dir / "a.py", "x = 1\n")
        _write(repo_dir / "b.py", "y = 2\n")
        index.index_repo(["a.py", "b.py"])
        assert index._cache.has("a.py")

        index.index_repo(["b.py"])
        assert not index._cache.has("a.py")

    def test_stale_removal_before_reference_build(
        self, index: SymbolIndex, repo_dir: Path
    ) -> None:
        """Pruning runs before the reference index is rebuilt.

        If stale removal ran after, the reference index would
        briefly contain edges to/from the deleted file. Pin the
        ordering by checking that the rebuilt ref index has no
        trace of the removed file.
        """
        _write(
            repo_dir / "b.py",
            "def helper(): return 1\n",
        )
        _write(
            repo_dir / "a.py",
            "from b import helper\n"
            "def caller(): return helper()\n",
        )
        index.index_repo(["a.py", "b.py"])
        assert "b.py" in index._ref_index.file_dependencies("a.py")

        # Remove b.py and a.py together; ref index should be clean.
        index.index_repo([])
        assert index._ref_index.file_dependencies("a.py") == set()
        assert index._ref_index.files_referencing("b.py") == set()


# ---------------------------------------------------------------------------
# Invalidation
# ---------------------------------------------------------------------------


class TestInvalidateFile:
    """Explicit invalidation clears cache + memory for a single file."""

    def test_invalidate_removes_entry(
        self, index: SymbolIndex, repo_dir: Path
    ) -> None:
        """invalidate_file drops the file from _all_symbols and cache."""
        _write(repo_dir / "foo.py", "x = 1\n")
        index.index_file("foo.py")
        assert "foo.py" in index._all_symbols
        assert index._cache.has("foo.py")

        result = index.invalidate_file("foo.py")
        assert result is True
        assert "foo.py" not in index._all_symbols
        assert not index._cache.has("foo.py")

    def test_invalidate_absent_file_returns_false(
        self, index: SymbolIndex
    ) -> None:
        """Invalidating an unknown file is a no-op returning False.

        Callers use the return value to log "we cleaned up N
        entries"; raising on missing would force try/except
        around every call.
        """
        assert index.invalidate_file("nope.py") is False


# ---------------------------------------------------------------------------
# Symbol map formatting
# ---------------------------------------------------------------------------


class TestSymbolMap:
    """Formatter integration — context and LSP variants."""

    def test_get_symbol_map_returns_text(
        self, index: SymbolIndex, repo_dir: Path
    ) -> None:
        """get_symbol_map produces non-empty output for a non-empty index."""
        _write(
            repo_dir / "foo.py",
            "def hello(): pass\n",
        )
        index.index_repo(["foo.py"])
        result = index.get_symbol_map()
        assert "foo.py" in result
        assert "hello" in result

    def test_get_symbol_map_empty_index_is_empty(
        self, index: SymbolIndex
    ) -> None:
        """No indexed files → empty string.

        Matches the formatter contract — callers concatenate
        this into the prompt and an empty string lets them
        skip the section cleanly.
        """
        assert index.get_symbol_map() == ""

    def test_get_symbol_map_respects_exclude_files(
        self, index: SymbolIndex, repo_dir: Path
    ) -> None:
        """Excluded files don't appear in the map output.

        Used by the streaming handler when a file's full content
        is already in a cached tier (uniqueness invariant).
        """
        _write(repo_dir / "a.py", "def foo(): pass\n")
        _write(repo_dir / "b.py", "def bar(): pass\n")
        index.index_repo(["a.py", "b.py"])
        result = index.get_symbol_map(exclude_files={"a.py"})
        assert "a.py" not in result
        assert "b.py" in result
        assert "bar" in result

    def test_lsp_map_includes_line_numbers(
        self, index: SymbolIndex, repo_dir: Path
    ) -> None:
        """LSP variant annotates symbols with :N line numbers.

        Per specs3 — the LSP variant is what editor features
        consume, so line numbers are required. The context
        variant (for the LLM) omits them for token efficiency.
        """
        _write(
            repo_dir / "foo.py",
            "def hello(): pass\n",
        )
        index.index_repo(["foo.py"])
        lsp = index.get_lsp_symbol_map()
        # Function is on line 1 (1-indexed).
        assert ":1" in lsp

    def test_context_map_has_no_symbol_line_numbers(
        self, index: SymbolIndex, repo_dir: Path
    ) -> None:
        """Context variant (LLM-facing) has no :N annotations on symbols.

        Callers grep for ``:N`` patterns on symbol lines to
        detect LSP-variant leaks into the context prompt. The
        file header line uses a colon but we're checking the
        symbol line specifically.
        """
        _write(
            repo_dir / "foo.py",
            "def hello(): pass\n",
        )
        index.index_repo(["foo.py"])
        ctx = index.get_symbol_map()
        # Find the symbol line containing `hello`; file header
        # (``foo.py:``) is a separate line.
        hello_line = next(
            line for line in ctx.splitlines()
            if "hello" in line and "foo.py" not in line
        )
        # No trailing :N on the symbol line itself.
        assert ":" not in hello_line

    def test_get_legend_returns_legend_text(
        self, index: SymbolIndex
    ) -> None:
        """get_legend returns the abbreviation key block.

        Layer 3's prompt assembly splits the legend from the
        map so the legend can live in a cached L0 block while
        the map cascades through tiers. Pinning this method
        keeps that separation possible.
        """
        legend = index.get_legend()
        assert legend
        # Kind codes are documented in the legend.
        assert "c=class" in legend or "c = class" in legend

    def test_get_file_symbol_block_returns_single_file(
        self, index: SymbolIndex, repo_dir: Path
    ) -> None:
        """get_file_symbol_block returns just one file's entry.

        Used by the stability tracker when assembling cached
        tier content — it needs to render one file's block at
        a time, not the whole map.
        """
        _write(repo_dir / "a.py", "def foo(): pass\n")
        _write(repo_dir / "b.py", "def bar(): pass\n")
        index.index_repo(["a.py", "b.py"])
        block = index.get_file_symbol_block("a.py")
        assert block is not None
        assert "a.py" in block
        assert "foo" in block
        # Other file's symbol must not appear.
        assert "bar" not in block

    def test_get_file_symbol_block_unknown_file(
        self, index: SymbolIndex
    ) -> None:
        """Unknown paths return None rather than raising.

        The stability tracker polls per-file; a deleted file
        between request assembly and block retrieval would
        otherwise crash the tier build.
        """
        assert index.get_file_symbol_block("nope.py") is None


# ---------------------------------------------------------------------------
# Signature hash
# ---------------------------------------------------------------------------


class TestSignatureHash:
    """get_signature_hash exposes the cache's structural hash."""

    def test_returns_hash_for_indexed_file(
        self, index: SymbolIndex, repo_dir: Path
    ) -> None:
        """Hash is non-empty for an indexed file."""
        _write(repo_dir / "foo.py", "def hello(): pass\n")
        index.index_file("foo.py")
        h = index.get_signature_hash("foo.py")
        assert h is not None
        assert len(h) == 64  # SHA-256 hex digest

    def test_returns_none_for_unknown_file(
        self, index: SymbolIndex
    ) -> None:
        """Unknown paths return None, not empty string.

        The stability tracker uses None as a distinct signal
        from "empty hash" — see base_cache.py's contract.
        """
        assert index.get_signature_hash("nope.py") is None

    def test_hash_stable_across_unchanged_content(
        self, index: SymbolIndex, repo_dir: Path
    ) -> None:
        """Re-indexing identical content yields the same hash.

        Critical for the stability tracker — a spurious hash
        change would demote files unnecessarily. Identity of
        content must produce identity of hash.
        """
        path = repo_dir / "foo.py"
        _write(path, "def hello(): pass\n")
        index.index_file("foo.py")
        first_hash = index.get_signature_hash("foo.py")

        # Invalidate and re-index with the same content.
        index.invalidate_file("foo.py")
        index.index_file("foo.py")
        second_hash = index.get_signature_hash("foo.py")

        assert first_hash == second_hash


# ---------------------------------------------------------------------------
# Snapshot discipline
# ---------------------------------------------------------------------------


class TestSnapshotDiscipline:
    """Read queries don't mutate indexed state.

    Layer 3's streaming pipeline treats the index as a
    read-only snapshot within a request's execution window.
    These tests pin that contract — multiple reads return
    identical results without any re-indexing.
    """

    def test_repeated_map_calls_are_stable(
        self, index: SymbolIndex, repo_dir: Path
    ) -> None:
        """Two get_symbol_map calls return identical output."""
        _write(repo_dir / "a.py", "def foo(): pass\n")
        index.index_repo(["a.py"])
        first = index.get_symbol_map()
        second = index.get_symbol_map()
        assert first == second

    def test_file_block_stable_across_calls(
        self, index: SymbolIndex, repo_dir: Path
    ) -> None:
        """get_file_symbol_block is deterministic across calls."""
        _write(repo_dir / "a.py", "def foo(): pass\n")
        index.index_repo(["a.py"])
        first = index.get_file_symbol_block("a.py")
        second = index.get_file_symbol_block("a.py")
        assert first == second

    def test_reads_do_not_mutate_all_symbols(
        self, index: SymbolIndex, repo_dir: Path
    ) -> None:
        """Query methods don't insert/remove entries in _all_symbols.

        If a query path accidentally triggered re-indexing,
        _all_symbols might grow or shrink between two reads.
        Pin the snapshot contract by asserting the dict is
        byte-identical before and after query calls.
        """
        _write(repo_dir / "a.py", "def foo(): pass\n")
        _write(repo_dir / "b.py", "def bar(): pass\n")
        index.index_repo(["a.py", "b.py"])
        before = set(index._all_symbols.keys())

        # Exercise every query method.
        index.get_symbol_map()
        index.get_lsp_symbol_map()
        index.get_legend()
        index.get_file_symbol_block("a.py")
        index.get_signature_hash("a.py")

        after = set(index._all_symbols.keys())
        assert before == after