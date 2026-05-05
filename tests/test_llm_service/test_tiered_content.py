"""_build_tiered_content dispatch and uniqueness invariants.

Covers:

- :class:`TestBuildTieredContent` — ``_build_tiered_content``
  dispatches items by key prefix (``symbol:``, ``doc:``,
  ``file:``, ``history:``, ``system:``, ``url:``), producing
  the four-tier dict that :meth:`ContextManager.assemble_tiered_messages`
  consumes.
- :class:`TestBuildTieredContentUniquenessInvariant` — defensive
  filters that enforce "a file never appears twice" when
  upstream tracker state drifted (selected files, excluded
  files, cross-reference rebuild edge cases).
- :class:`TestAssembleTieredLegendDispatch` — legend routing in
  :meth:`LLMService._assemble_tiered` based on mode and
  cross-reference state.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ac_dc.config import ConfigManager
from ac_dc.context_manager import Mode
from ac_dc.llm_service import LLMService
from ac_dc.repo import Repo

from .conftest import _FakeLiteLLM, _FakeSymbolIndex, _place_item


class TestBuildTieredContent:
    """LLMService._build_tiered_content dispatches items by key prefix."""

    def test_returns_none_when_tracker_empty(
        self, service: LLMService
    ) -> None:
        """Empty tracker → None, signalling flat-assembly fallback."""
        # Fresh service: tracker was just constructed, no items
        # registered yet. This is the narrow startup window the
        # spec calls out.
        result = service._build_tiered_content()
        assert result is None

    def test_returns_dict_with_four_tiers(
        self, service: LLMService
    ) -> None:
        """Non-empty tracker returns a dict with L0..L3 keys."""
        _place_item(service._stability_tracker, "history:0", "L1")
        # Need a history entry for the history: key to resolve
        service._context.add_message("user", "hello")
        result = service._build_tiered_content()
        assert result is not None
        assert set(result.keys()) == {"L0", "L1", "L2", "L3"}

    def test_symbol_key_dispatches_to_symbol_index(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """symbol:{path} items fetch blocks from the symbol index."""
        fake_index = _FakeSymbolIndex({
            "src/foo.py": "symbol-block-for-foo",
        })
        svc = LLMService(
            config=config,
            repo=repo,
            symbol_index=fake_index,
        )
        _place_item(svc._stability_tracker, "symbol:src/foo.py", "L1")
        result = svc._build_tiered_content()
        assert result is not None
        assert "symbol-block-for-foo" in result["L1"]["symbols"]
        # Not in other tiers.
        assert result["L0"]["symbols"] == ""
        assert result["L2"]["symbols"] == ""

    def test_symbol_key_without_symbol_index_skipped(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """symbol:* items with no attached index are silently skipped."""
        svc = LLMService(config=config, repo=repo, symbol_index=None)
        _place_item(svc._stability_tracker, "symbol:src/foo.py", "L1")
        result = svc._build_tiered_content()
        assert result is not None
        assert result["L1"]["symbols"] == ""

    def test_symbol_key_block_not_found_skipped(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """symbol:* items whose path returns None are omitted."""
        fake_index = _FakeSymbolIndex({})  # no blocks
        svc = LLMService(
            config=config,
            repo=repo,
            symbol_index=fake_index,
        )
        _place_item(svc._stability_tracker, "symbol:src/bar.py", "L1")
        result = svc._build_tiered_content()
        assert result is not None
        assert result["L1"]["symbols"] == ""

    def test_doc_key_dispatches_to_doc_index(
        self, service: LLMService
    ) -> None:
        """doc:{path} items fetch blocks from the doc index.

        Doc blocks land in the tier's `symbols` field alongside
        symbol blocks — both render under the continued-structure
        header per specs4/3-llm/prompt-assembly.md.
        """
        from ac_dc.doc_index.extractors.markdown import MarkdownExtractor
        from pathlib import Path as _Path

        # Seed an outline directly on the doc index so we don't
        # need a real file on disk. _all_outlines is the
        # authoritative store that get_file_doc_block reads.
        extractor = MarkdownExtractor()
        outline = extractor.extract(
            _Path("README.md"),
            "# Project\n\nSome prose.\n",
        )
        service._doc_index._all_outlines["README.md"] = outline

        _place_item(service._stability_tracker, "doc:README.md", "L1")
        result = service._build_tiered_content()
        assert result is not None
        # Block landed in the symbols field (not files) — doc
        # and symbol blocks share the same tier section.
        assert "README.md" in result["L1"]["symbols"]
        assert "Project" in result["L1"]["symbols"]
        # Not in other tiers.
        assert result["L0"]["symbols"] == ""
        assert result["L2"]["symbols"] == ""

    def test_doc_key_missing_outline_skipped(
        self, service: LLMService
    ) -> None:
        """doc:{path} with no outline in the index is omitted.

        Matches the symbol: pattern — missing blocks don't
        crash assembly, they just produce no content for that
        tier item. Defensive against partial tracker state
        (a doc: key seeded from a cached session before the
        doc index finished rebuilding).
        """
        _place_item(service._stability_tracker, "doc:missing.md", "L1")
        result = service._build_tiered_content()
        assert result is not None
        assert result["L1"]["symbols"] == ""
        assert result["L1"]["files"] == ""

    def test_doc_and_symbol_blocks_mix_in_same_tier(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Cross-reference tier holds both symbol: and doc: items.

        When cross-reference mode is active, a single tier can
        contain items from both indexes. Both blocks land in
        the tier's `symbols` field and the sorted-key walk
        orders them deterministically across runs.
        """
        from ac_dc.doc_index.extractors.markdown import MarkdownExtractor
        from pathlib import Path as _Path

        fake_index = _FakeSymbolIndex({
            "src/foo.py": "symbol-block-foo",
        })
        svc = LLMService(
            config=config,
            repo=repo,
            symbol_index=fake_index,
        )
        # Seed a doc outline.
        extractor = MarkdownExtractor()
        outline = extractor.extract(
            _Path("guide.md"),
            "# Guide\n\nContent.\n",
        )
        svc._doc_index._all_outlines["guide.md"] = outline

        # Both items in L1.
        _place_item(svc._stability_tracker, "symbol:src/foo.py", "L1")
        _place_item(svc._stability_tracker, "doc:guide.md", "L1")

        result = svc._build_tiered_content()
        assert result is not None
        text = result["L1"]["symbols"]
        # Both blocks present in the same tier field.
        assert "symbol-block-foo" in text
        assert "Guide" in text
        # Sorted by full key: "doc:guide.md" < "symbol:src/foo.py"
        # (alphabetical comparison), so doc block appears first.
        assert text.index("Guide") < text.index("symbol-block-foo")

    def test_file_key_dispatches_to_file_context(
        self, service: LLMService
    ) -> None:
        """file:{path} items fetch content from the file context."""
        service._file_context.add_file("a.py", "A content")
        _place_item(service._stability_tracker, "file:a.py", "L1")
        result = service._build_tiered_content()
        assert result is not None
        assert "a.py" in result["L1"]["files"]
        assert "A content" in result["L1"]["files"]
        # graduated_files captures the path for active-exclusion.
        assert "a.py" in result["L1"]["graduated_files"]

    def test_file_key_not_in_file_context_skipped(
        self, service: LLMService
    ) -> None:
        """file:* items whose path isn't loaded are omitted silently."""
        _place_item(service._stability_tracker, "file:missing.py", "L1")
        result = service._build_tiered_content()
        assert result is not None
        assert result["L1"]["files"] == ""
        assert result["L1"]["graduated_files"] == []

    def test_history_key_dispatches_to_context(
        self, service: LLMService
    ) -> None:
        """history:{N} items fetch messages from the context manager."""
        service._context.add_message("user", "early u")
        service._context.add_message("assistant", "early a")
        _place_item(service._stability_tracker, "history:0", "L2")
        _place_item(service._stability_tracker, "history:1", "L2")
        result = service._build_tiered_content()
        assert result is not None
        l2_history = result["L2"]["history"]
        assert len(l2_history) == 2
        # Ordered by original index (0 before 1).
        assert l2_history[0]["content"] == "early u"
        assert l2_history[1]["content"] == "early a"
        # Indices recorded for active-history exclusion.
        assert result["L2"]["graduated_history_indices"] == [0, 1]

    def test_history_key_out_of_range_skipped(
        self, service: LLMService
    ) -> None:
        """history:{N} for an N past the history length is dropped."""
        service._context.add_message("user", "only msg")
        _place_item(service._stability_tracker, "history:5", "L1")
        result = service._build_tiered_content()
        assert result is not None
        assert result["L1"]["history"] == []
        assert result["L1"]["graduated_history_indices"] == []

    def test_history_key_non_numeric_skipped(
        self, service: LLMService
    ) -> None:
        """A malformed history: key doesn't crash assembly."""
        service._context.add_message("user", "x")
        _place_item(
            service._stability_tracker, "history:notanumber", "L1"
        )
        result = service._build_tiered_content()
        assert result is not None
        assert result["L1"]["history"] == []

    def test_system_key_skipped(
        self, service: LLMService
    ) -> None:
        """system:* items are handled by the assembler, not the builder."""
        _place_item(
            service._stability_tracker, "system:prompt", "L0"
        )
        result = service._build_tiered_content()
        assert result is not None
        # No symbols, no files, no history for the system key.
        assert result["L0"]["symbols"] == ""
        assert result["L0"]["files"] == ""

    def test_url_key_skipped(
        self, service: LLMService
    ) -> None:
        """url:* items are deferred to Layer 4.1; currently skipped."""
        _place_item(
            service._stability_tracker, "url:abc123def456", "L1"
        )
        result = service._build_tiered_content()
        assert result is not None
        assert result["L1"]["files"] == ""

    def test_active_tier_items_excluded(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Items in the active tier don't appear in any cached tier.

        Active is for content rebuilt each request — it never
        carries a cache-control marker, and its content is
        rendered directly by the assembler (not via
        tiered_content).
        """
        fake_index = _FakeSymbolIndex({
            "src/foo.py": "symbol-block",
        })
        svc = LLMService(
            config=config,
            repo=repo,
            symbol_index=fake_index,
        )
        _place_item(
            svc._stability_tracker,
            "symbol:src/foo.py",
            "active",
        )
        result = svc._build_tiered_content()
        # Tracker has at least one item so result is non-None.
        assert result is not None
        # But no cached tier contains the symbol block.
        for tier in ("L0", "L1", "L2", "L3"):
            assert "symbol-block" not in result[tier]["symbols"]

    def test_multiple_tiers_isolated(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Content in one tier doesn't bleed into adjacent tiers."""
        fake_index = _FakeSymbolIndex({
            "a.py": "block-A",
            "b.py": "block-B",
        })
        svc = LLMService(
            config=config,
            repo=repo,
            symbol_index=fake_index,
        )
        _place_item(svc._stability_tracker, "symbol:a.py", "L1")
        _place_item(svc._stability_tracker, "symbol:b.py", "L2")
        result = svc._build_tiered_content()
        assert result is not None
        assert "block-A" in result["L1"]["symbols"]
        assert "block-B" not in result["L1"]["symbols"]
        assert "block-B" in result["L2"]["symbols"]
        assert "block-A" not in result["L2"]["symbols"]

    def test_symbol_blocks_joined_with_blank_lines(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Multiple symbol blocks in the same tier are separated."""
        fake_index = _FakeSymbolIndex({
            "a.py": "block-A",
            "b.py": "block-B",
        })
        svc = LLMService(
            config=config,
            repo=repo,
            symbol_index=fake_index,
        )
        _place_item(svc._stability_tracker, "symbol:a.py", "L1")
        _place_item(svc._stability_tracker, "symbol:b.py", "L1")
        result = svc._build_tiered_content()
        assert result is not None
        # Blocks joined with a blank line separator.
        assert "\n\n" in result["L1"]["symbols"]
        assert "block-A" in result["L1"]["symbols"]
        assert "block-B" in result["L1"]["symbols"]

    def test_symbol_blocks_sorted_by_key_for_determinism(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Fragment ordering is deterministic (sorted by key)."""
        fake_index = _FakeSymbolIndex({
            "z.py": "block-Z",
            "a.py": "block-A",
            "m.py": "block-M",
        })
        svc = LLMService(
            config=config,
            repo=repo,
            symbol_index=fake_index,
        )
        _place_item(svc._stability_tracker, "symbol:z.py", "L1")
        _place_item(svc._stability_tracker, "symbol:a.py", "L1")
        _place_item(svc._stability_tracker, "symbol:m.py", "L1")
        result = svc._build_tiered_content()
        assert result is not None
        text = result["L1"]["symbols"]
        # Sorted by key: a.py → m.py → z.py.
        assert text.index("block-A") < text.index("block-M")
        assert text.index("block-M") < text.index("block-Z")


class TestBuildTieredContentUniquenessInvariant:
    """Defensive filters enforce the "never appears twice" invariant.

    Per specs4/3-llm/prompt-assembly.md § "Uniqueness Invariants"
    and specs-reference/3-llm/prompt-assembly.md § "A File Never
    Appears Twice": a file's index block (``symbol:`` or ``doc:``)
    must never coexist with its full content (``file:``) in any
    form. Upstream (``_update_stability`` Step 2,
    ``set_excluded_index_files``, ``_rebuild_cache_impl`` Step 7)
    is responsible for removing stale entries, but
    ``_build_tiered_content`` carries belt-and-suspenders checks
    so rendering is correct even when upstream state drifted
    (races, cross-reference rebuild edge cases, future code
    paths that forget the invariant).

    These tests intentionally install tracker state that
    violates the upstream contract — e.g., a symbol: entry
    alongside a selected file — to verify the render-time
    filters catch it. The checks are skip-with-debug-log rather
    than raise, so the tests verify absence of content rather
    than exception behaviour.
    """

    def test_selected_file_symbol_entry_skipped(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """symbol:{path} for a selected file is filtered at render time."""
        (repo_dir / "a.py").write_text("content\n")
        fake_index = _FakeSymbolIndex({"a.py": "symbol-block-for-a"})
        svc = LLMService(
            config=config,
            repo=repo,
            symbol_index=fake_index,
        )
        # Add a.py to selection. This should normally cause
        # _update_stability to remove any symbol:a.py entry —
        # we simulate a desync by placing one directly AFTER
        # selecting.
        svc.set_selected_files(["a.py"])
        _place_item(svc._stability_tracker, "symbol:a.py", "L1")

        result = svc._build_tiered_content()
        assert result is not None
        # symbol-block-for-a must NOT appear in any tier's
        # symbols output — the file is selected, its content
        # would render separately as a file: entry (or in the
        # active Working Files section).
        for tier in ("L0", "L1", "L2", "L3"):
            assert "symbol-block-for-a" not in result[tier]["symbols"]

    def test_selected_file_doc_entry_skipped(
        self,
        service: LLMService,
        repo_dir: Path,
    ) -> None:
        """doc:{path} for a selected file is filtered at render time."""
        from ac_dc.doc_index.extractors.markdown import MarkdownExtractor
        from pathlib import Path as _Path

        (repo_dir / "README.md").write_text("# Doc\n")
        extractor = MarkdownExtractor()
        outline = extractor.extract(
            _Path("README.md"),
            "# Project\n\nprose.\n",
        )
        service._doc_index._all_outlines["README.md"] = outline

        service.set_selected_files(["README.md"])
        _place_item(service._stability_tracker, "doc:README.md", "L2")

        result = service._build_tiered_content()
        assert result is not None
        # Doc block must not appear in any tier's symbols field.
        for tier in ("L0", "L1", "L2", "L3"):
            assert "Project" not in result[tier]["symbols"]

    def test_excluded_path_symbol_entry_skipped(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Items whose path is excluded are skipped regardless of prefix."""
        fake_index = _FakeSymbolIndex({"excluded.py": "block-X"})
        svc = LLMService(
            config=config,
            repo=repo,
            symbol_index=fake_index,
        )
        # Set excluded list directly (bypassing set_excluded_index_files
        # to avoid the immediate removal pass; we want to simulate
        # a state where the exclusion is active but a tracker
        # entry somehow survived).
        svc._excluded_index_files = ["excluded.py"]
        _place_item(svc._stability_tracker, "symbol:excluded.py", "L1")

        result = svc._build_tiered_content()
        assert result is not None
        for tier in ("L0", "L1", "L2", "L3"):
            assert "block-X" not in result[tier]["symbols"]

    def test_excluded_path_file_entry_skipped(
        self,
        service: LLMService,
    ) -> None:
        """file: entries for excluded paths are filtered out too.

        Exclusion means "remove from context entirely" — applies
        to all three prefixes.
        """
        service._file_context.add_file("secret.md", "secret content")
        service._excluded_index_files = ["secret.md"]
        _place_item(service._stability_tracker, "file:secret.md", "L1")

        result = service._build_tiered_content()
        assert result is not None
        for tier in ("L0", "L1", "L2", "L3"):
            assert "secret content" not in result[tier]["files"]
            assert "secret.md" not in result[tier]["graduated_files"]

    def test_excluded_path_doc_entry_skipped(
        self,
        service: LLMService,
    ) -> None:
        """doc: entries for excluded paths are filtered at render time."""
        from ac_dc.doc_index.extractors.markdown import MarkdownExtractor
        from pathlib import Path as _Path

        extractor = MarkdownExtractor()
        outline = extractor.extract(
            _Path("excluded.md"),
            "# Excluded\n\ncontent.\n",
        )
        service._doc_index._all_outlines["excluded.md"] = outline

        service._excluded_index_files = ["excluded.md"]
        _place_item(service._stability_tracker, "doc:excluded.md", "L1")

        result = service._build_tiered_content()
        assert result is not None
        for tier in ("L0", "L1", "L2", "L3"):
            assert "Excluded" not in result[tier]["symbols"]

    def test_system_and_history_keys_not_filtered_by_exclusion(
        self,
        service: LLMService,
    ) -> None:
        """Exclusion / selection filters only apply to path-bearing prefixes.

        system:*, url:*, history:* have no path component, so
        they must never be affected by the defensive filters.
        Regression guard against an over-eager filter.
        """
        # system: key is skipped separately by the builder
        # (handled by the assembler). history: should render
        # normally even if the tracker somehow also has a
        # same-path entry in the excluded set.
        service._context.add_message("user", "hello from history")
        service._excluded_index_files = ["history:0"]  # nonsense path
        service._selected_files = ["history:0"]
        _place_item(service._stability_tracker, "history:0", "L1")

        result = service._build_tiered_content()
        assert result is not None
        # History entry still rendered — not a path-bearing key.
        assert len(result["L1"]["history"]) == 1
        assert result["L1"]["history"][0]["content"] == "hello from history"

    def test_rebuild_cross_ref_does_not_double_render(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Regression: rebuild with cross-ref doesn't duplicate content.

        Before Fix 2, ``_rebuild_cache_impl`` step 7 only
        swapped the primary-prefix entry for selected files.
        If the same path existed in both indexes (cross-ref
        enabled), the secondary-prefix entry survived
        alongside the new file: entry, and
        ``_build_tiered_content`` would render both the full
        file content AND the index block.

        This test places all three entries directly and
        confirms the render-time filters suppress the
        duplicates even without running the rebuild fix —
        proving the defense-in-depth works.
        """
        from ac_dc.doc_index.extractors.markdown import MarkdownExtractor
        from pathlib import Path as _Path

        # Set up a file present in both indexes.
        (repo_dir / "shared.md").write_text("# Shared\n\nbody.\n")
        fake_index = _FakeSymbolIndex(
            {"shared.md": "symbol-block-shared"}
        )
        svc = LLMService(
            config=config,
            repo=repo,
            symbol_index=fake_index,
        )
        extractor = MarkdownExtractor()
        outline = extractor.extract(
            _Path("shared.md"),
            "# Shared\n\nbody.\n",
        )
        svc._doc_index._all_outlines["shared.md"] = outline

        # Select the file AND place entries for all three
        # prefixes at the same tier. This is the pathological
        # state the rebuild bug could produce before Fix 2.
        svc.set_selected_files(["shared.md"])
        svc._file_context.add_file("shared.md", "shared content")
        _place_item(svc._stability_tracker, "file:shared.md", "L1")
        _place_item(svc._stability_tracker, "symbol:shared.md", "L1")
        _place_item(svc._stability_tracker, "doc:shared.md", "L1")

        result = svc._build_tiered_content()
        assert result is not None
        # Full content appears exactly once (via file: entry).
        assert "shared content" in result["L1"]["files"]
        # Neither index block appears — both symbol: and doc:
        # were filtered because the path is selected.
        symbols_text = result["L1"]["symbols"]
        assert "symbol-block-shared" not in symbols_text
        assert "# Shared" not in symbols_text

    def test_non_selected_non_excluded_path_renders_normally(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Normal-case sanity check — filters don't over-reach.

        An unselected, non-excluded path must still render its
        symbol: / doc: / file: content through the builder.
        Guards against a filter that accidentally suppressed
        everything.

        a.py must exist on disk because ``set_selected_files``
        runs a ``file_exists`` filter — without the real file,
        the selection would be silently empty and both symbol
        blocks would render, defeating the point of the test.
        """
        (repo_dir / "a.py").write_text("content-a\n")
        (repo_dir / "b.py").write_text("content-b\n")
        fake_index = _FakeSymbolIndex({
            "a.py": "symbol-block-a",
            "b.py": "symbol-block-b",
        })
        svc = LLMService(
            config=config,
            repo=repo,
            symbol_index=fake_index,
        )
        # a.py selected (filtered out), b.py neither selected
        # nor excluded (must render).
        svc._file_context.add_file("a.py", "content-a")
        svc.set_selected_files(["a.py"])
        assert svc.get_selected_files() == ["a.py"]  # precondition
        _place_item(svc._stability_tracker, "symbol:a.py", "L1")
        _place_item(svc._stability_tracker, "symbol:b.py", "L1")

        result = svc._build_tiered_content()
        assert result is not None
        # a.py's symbol filtered; b.py's rendered.
        assert "symbol-block-a" not in result["L1"]["symbols"]
        assert "symbol-block-b" in result["L1"]["symbols"]


class TestAssembleTieredLegendDispatch:
    """Legend routing in _assemble_tiered based on mode and cross-ref.

    Three scenarios per specs4/3-llm/modes.md and
    specs4/3-llm/prompt-assembly.md § "Cross-Reference Legend
    Headers":

    - Code mode, no cross-ref: symbol legend in primary slot,
      doc_legend empty (suppressed).
    - Code mode, cross-ref on: symbol legend primary, doc legend
      secondary.
    - Doc mode, no cross-ref: doc legend in primary slot,
      doc_legend empty (the assembler already handles the
      primary routing via mode).
    - Doc mode, cross-ref on: doc legend primary, symbol legend
      secondary.

    The tests capture the arguments passed to
    ``ContextManager.assemble_tiered_messages`` so we can verify
    the exact strings without running full message assembly. The
    assembler itself is already tested in test_prompt_assembly.py
    — here we only verify the plumbing.
    """

    def _make_service_with_capture(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        symbol_legend: str = "SYMBOL-LEGEND",
        doc_legend: str = "DOC-LEGEND",
    ) -> tuple[LLMService, dict[str, Any]]:
        """Build a service with captured assembler args.

        Returns (service, capture_dict). The capture_dict holds
        the last-seen kwargs from assemble_tiered_messages.
        """
        # Attach a ``get_legend`` method on the fake via a
        # thin subclass since the base fake doesn't have one.

        class _SymbolIndexWithLegend(_FakeSymbolIndex):
            def get_legend(self_) -> str:
                return symbol_legend

            def get_symbol_map(
                self_, exclude_files: set[str] | None = None
            ) -> str:
                return ""

        svc = LLMService(
            config=config,
            repo=repo,
            symbol_index=_SymbolIndexWithLegend({"a.py": "block-a"}),
        )
        # Attach a get_legend method to the doc index (the real
        # DocIndex has one; it returns "" on an empty index).
        # Override it to return the test sentinel.
        svc._doc_index.get_legend = lambda: doc_legend  # type: ignore[method-assign]

        # Capture the kwargs passed to assemble_tiered_messages.
        capture: dict[str, Any] = {}
        original = svc._context.assemble_tiered_messages

        def _capture_and_call(**kwargs: Any) -> list[dict[str, Any]]:
            capture.update(kwargs)
            return original(**kwargs)

        svc._context.assemble_tiered_messages = _capture_and_call  # type: ignore[method-assign]

        # Place a minimal tiered_content with at least one item so
        # the assembler runs the full path (the caller's
        # _build_tiered_content produces this in real use).
        _place_item(svc._stability_tracker, "symbol:a.py", "L1")

        return svc, capture

    def test_code_mode_no_cross_ref_omits_doc_legend(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Code mode + cross-ref off → symbol legend only."""
        svc, capture = self._make_service_with_capture(
            config, repo, fake_litellm
        )
        # Default state: code mode, cross-ref off.
        assert svc._context.mode == Mode.CODE
        assert svc._cross_ref_enabled is False

        tiered = svc._build_tiered_content()
        assert tiered is not None
        svc._assemble_tiered("hi", [], tiered)

        assert capture["symbol_legend"] == "SYMBOL-LEGEND"
        # doc_legend suppressed in code mode without cross-ref.
        assert capture["doc_legend"] == ""

    def test_code_mode_with_cross_ref_adds_doc_legend_secondary(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Code mode + cross-ref on → symbol primary, doc secondary."""
        svc, capture = self._make_service_with_capture(
            config, repo, fake_litellm
        )
        # Bypass the set_cross_reference RPC — it has a readiness
        # gate we don't care about here. Set the flag directly.
        svc._cross_ref_enabled = True

        tiered = svc._build_tiered_content()
        assert tiered is not None
        svc._assemble_tiered("hi", [], tiered)

        # Symbol legend stays in primary; doc legend added as
        # secondary.
        assert capture["symbol_legend"] == "SYMBOL-LEGEND"
        assert capture["doc_legend"] == "DOC-LEGEND"

    def test_doc_mode_no_cross_ref_primary_is_doc_legend(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Doc mode + cross-ref off → doc legend in primary slot.

        In doc mode, the assembler's primary slot carries the
        doc legend. The context manager uses its mode flag to
        pick the correct header (DOC_MAP_HEADER). We swap what
        goes into symbol_legend — the parameter name is
        historical; it means "primary legend".
        """
        svc, capture = self._make_service_with_capture(
            config, repo, fake_litellm
        )
        # Switch to doc mode. Use the Mode enum directly since
        # switch_mode has broadcast side effects not relevant
        # here.
        svc._context.set_mode(Mode.DOC)
        svc._stability_tracker = svc._trackers.setdefault(
            Mode.DOC, svc._stability_tracker
        )
        # Re-place an item in the new tracker so tiered content
        # is non-empty.
        _place_item(svc._stability_tracker, "symbol:a.py", "L1")

        tiered = svc._build_tiered_content()
        assert tiered is not None
        svc._assemble_tiered("hi", [], tiered)

        # Primary (symbol_legend kwarg) carries DOC legend.
        assert capture["symbol_legend"] == "DOC-LEGEND"
        # No secondary without cross-ref.
        assert capture["doc_legend"] == ""

    def test_doc_mode_with_cross_ref_adds_symbol_as_secondary(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Doc mode + cross-ref on → doc primary, symbol secondary."""
        svc, capture = self._make_service_with_capture(
            config, repo, fake_litellm
        )
        svc._context.set_mode(Mode.DOC)
        svc._stability_tracker = svc._trackers.setdefault(
            Mode.DOC, svc._stability_tracker
        )
        _place_item(svc._stability_tracker, "symbol:a.py", "L1")
        svc._cross_ref_enabled = True

        tiered = svc._build_tiered_content()
        assert tiered is not None
        svc._assemble_tiered("hi", [], tiered)

        # Primary is doc legend; secondary is symbol legend.
        assert capture["symbol_legend"] == "DOC-LEGEND"
        assert capture["doc_legend"] == "SYMBOL-LEGEND"