"""Cross-reference toggle lifecycle.

Covers :class:`TestCrossReferenceLifecycle` —
:meth:`LLMService.set_cross_reference` together with
:func:`_seed_cross_reference_items` /
:func:`_remove_cross_reference_items`. Verifies the readiness
gate, seeding onto the active tracker, removal on disable or
mode switch, selected-file exclusion, and the idempotence
contract.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ac_dc.config import ConfigManager
from ac_dc.context_manager import Mode
from ac_dc.llm_service import LLMService
from ac_dc.repo import Repo

from .conftest import _FakeLiteLLM, _RecordingEventCallback


class TestCrossReferenceLifecycle:
    """set_cross_reference + _seed/_remove_cross_reference_items.

    Verifies the full lifecycle:

    - Enable requires _doc_index_ready; rejected with error
      when not ready. Disable always works.
    - Enable seeds the tracker with opposite-index items
      distributed across L0/L1/L2/L3 (never ACTIVE) so the
      provider cache absorbs them on the next request.
    - L0 backfill promotes the highest ref-count cross-ref
      items into L0 without evicting primary-index items
      already resident there.
    - Disable removes those items and marks affected tiers
      broken for clean rebalancing.
    - Mode switch with cross-ref active removes items BEFORE
      swapping trackers (so removal runs against the right
      prefix).
    - Selected files are never added as cross-ref items
      (they carry their own file: entries).
    """

    def _make_service_with_both_indexes(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        symbol_paths: list[str] | None = None,
        doc_paths: list[str] | None = None,
    ) -> LLMService:
        """Service with both indexes populated for cross-ref tests."""
        symbol_paths = symbol_paths or []
        doc_paths = doc_paths or []

        class _SymbolRefIndexStub:
            """Minimal ref-index stub for cross-ref seeding.

            seed_cross_reference_items reads
            ``service._symbol_index._ref_index`` in doc mode
            and hands it to ``distribute_keys_by_clustering``
            + ``backfill_l0_after_measurement``. Both methods
            only need ``connected_components()`` and
            ``file_ref_count()``. Empty components + zero
            ref counts produce singleton orphans for every
            path — matches the real empty-graph state.
            """

            def connected_components(self) -> list[set[str]]:
                return []

            def file_ref_count(self, path: str) -> int:
                return 0

        class _SymbolIndexStub:
            def __init__(self, paths: list[str]) -> None:
                self._all_symbols = {p: None for p in paths}
                self._ref_index = _SymbolRefIndexStub()

            def get_file_symbol_block(
                self, path: str
            ) -> str | None:
                if path in self._all_symbols:
                    return f"symbol-block-for-{path}"
                return None

            def get_signature_hash(
                self, path: str
            ) -> str | None:
                if path in self._all_symbols:
                    return f"sym-sig-{path}"
                return None

            def get_legend(self) -> str:
                return ""

            def get_symbol_map(
                self, exclude_files: set[str] | None = None
            ) -> str:
                return ""

        svc = LLMService(
            config=config,
            repo=repo,
            symbol_index=_SymbolIndexStub(symbol_paths),
        )

        # Seed doc outlines directly.
        from ac_dc.doc_index.extractors.markdown import (
            MarkdownExtractor,
        )
        from pathlib import Path as _Path

        extractor = MarkdownExtractor()
        for path in doc_paths:
            outline = extractor.extract(
                _Path(path),
                f"# Heading for {path}\n\nbody.\n",
            )
            svc._doc_index._all_outlines[path] = outline

        return svc

    def test_enable_rejected_when_not_ready(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Enable returns error when _doc_index_ready is False."""
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=["a.py"],
            doc_paths=["guide.md"],
        )
        # Readiness flag starts False.
        assert svc._doc_index_ready is False

        result = svc.set_cross_reference(True)
        assert result.get("error") == "cross-reference not ready"
        assert "building" in result.get("reason", "").lower()
        # Flag not flipped.
        assert svc._cross_ref_enabled is False

    def test_enable_succeeds_when_ready(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Enable succeeds when _doc_index_ready is True."""
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=["a.py"],
            doc_paths=["guide.md"],
        )
        svc._doc_index_ready = True

        result = svc.set_cross_reference(True)
        assert result["status"] == "ok"
        assert result["cross_ref_enabled"] is True
        assert svc._cross_ref_enabled is True

    def test_disable_always_allowed(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Disable doesn't check readiness.

        Edge case: an enable succeeded previously, then the
        doc index was somehow invalidated (shouldn't happen
        in practice but defensive). Disable must still work
        to let the user clean up.
        """
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=[],
            doc_paths=[],
        )
        # Force the state: enabled but not ready.
        svc._cross_ref_enabled = True
        svc._doc_index_ready = False

        result = svc.set_cross_reference(False)
        assert result["status"] == "ok"
        assert result["cross_ref_enabled"] is False
        assert svc._cross_ref_enabled is False

    def test_enable_seeds_doc_items_in_code_mode(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Code mode + enable → doc: entries land in tracker."""
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=["a.py"],
            doc_paths=["guide.md", "README.md"],
        )
        svc._doc_index_ready = True

        assert svc._context.mode == Mode.CODE
        svc.set_cross_reference(True)

        tracker_items = svc._stability_tracker.get_all_items()
        assert "doc:guide.md" in tracker_items
        assert "doc:README.md" in tracker_items
        # Symbol entries NOT added by the seeding pass (those
        # are primary; normal init/update handles them).
        # The seeding pass only adds cross-ref entries.

    def test_enable_seeds_symbol_items_in_doc_mode(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Doc mode + enable → symbol: entries land in tracker."""
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=["a.py", "b.py"],
            doc_paths=["guide.md"],
        )
        svc._doc_index_ready = True
        # Switch to doc mode via the context manager directly
        # to avoid the switch_mode RPC's side effects.
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker

        svc.set_cross_reference(True)

        tracker_items = svc._stability_tracker.get_all_items()
        assert "symbol:a.py" in tracker_items
        assert "symbol:b.py" in tracker_items

    def test_enable_excludes_selected_files(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Selected files don't get cross-ref entries.

        A selected doc file (in code mode + cross-ref) should
        NOT become a doc: entry — its content flows via file:
        in the primary path.
        """
        (repo_dir / "guide.md").write_text("# Guide\n")
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=[],
            doc_paths=["guide.md", "README.md"],
        )
        svc._doc_index_ready = True
        svc.set_selected_files(["guide.md"])

        svc.set_cross_reference(True)

        tracker_items = svc._stability_tracker.get_all_items()
        # Unselected doc got a cross-ref entry.
        assert "doc:README.md" in tracker_items
        # Selected doc didn't.
        assert "doc:guide.md" not in tracker_items

    def test_seeded_items_never_land_in_active(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Seeded cross-ref items land in cached tiers, not ACTIVE.

        The earlier implementation placed every cross-ref
        item at ACTIVE with N=0, which produced one massive
        uncached block on the next request. The rewrite runs
        the reference-graph clustering algorithm and bin-packs
        items across L0/L1/L2/L3 so the provider cache
        absorbs them immediately. Pinned here so a regression
        to the old behaviour fails loudly.
        """
        from ac_dc.stability_tracker import Tier

        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=[],
            doc_paths=["guide.md", "README.md", "api.md"],
        )
        svc._doc_index_ready = True
        svc.set_cross_reference(True)

        items = svc._stability_tracker.get_all_items()
        cross_ref_items = [
            item for key, item in items.items()
            if key.startswith("doc:")
        ]
        assert len(cross_ref_items) == 3
        for item in cross_ref_items:
            assert item.tier != Tier.ACTIVE, (
                f"Cross-ref item {item.key} landed in "
                f"ACTIVE — should be in a cached tier"
            )

    def test_seeded_items_distributed_across_cached_tiers(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Cross-ref items never land in ACTIVE.

        The clustering algorithm bin-packs by component size
        across L1/L2/L3; orphan files (no reference edges)
        become singletons and get round-robined. Post-
        measurement backfill may promote some into L0. The
        exact distribution depends on cache target tokens
        vs measured tokens — for small test repos with tiny
        stub blocks, backfill can absorb everything into L0.
        The user-facing invariant is "never ACTIVE"; that's
        what we pin here.
        """
        from ac_dc.stability_tracker import Tier

        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=[],
            doc_paths=["a.md", "b.md", "c.md"],
        )
        svc._doc_index_ready = True
        svc.set_cross_reference(True)

        items = svc._stability_tracker.get_all_items()
        cross_ref_items = [
            item for key, item in items.items()
            if key.startswith("doc:")
        ]
        assert len(cross_ref_items) == 3
        tiers_used = {item.tier for item in cross_ref_items}
        # Never ACTIVE.
        assert Tier.ACTIVE not in tiers_used
        # Every item is in a cached tier.
        cached = {Tier.L0, Tier.L1, Tier.L2, Tier.L3}
        assert tiers_used.issubset(cached)

    def test_l0_backfill_promotes_most_referenced(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """L0 backfill promotes the highest ref-count cross-ref item.

        The post-measurement backfill pass walks L1/L2/L3
        candidates sorted by ``file_ref_count`` descending
        and promotes until L0 tokens reach the overshoot
        threshold. Even with placeholder-token estimates
        replaced by real counts, a small repo's L0 will
        start underfilled, so at least one high-ref file
        should be promoted.

        We swap in a stub doc index whose reference graph
        marks one file as heavily referenced; the backfill
        should pick that file for L0.
        """
        from ac_dc.stability_tracker import Tier

        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=[],
            doc_paths=["hub.md", "leaf1.md", "leaf2.md"],
        )
        # Replace the doc ref index with a stub that reports
        # hub.md as the most-connected file. The real ref
        # index would do this via actual cross-document
        # links; we bypass that wiring because the backfill
        # behaviour is what we're testing, not the graph
        # construction.
        class _StubRefIndex:
            def connected_components(self) -> list[set[str]]:
                return [{"hub.md", "leaf1.md", "leaf2.md"}]

            def file_ref_count(self, path: str) -> int:
                if path == "hub.md":
                    return 10
                return 0

        svc._doc_index._ref_index = _StubRefIndex()
        svc._doc_index_ready = True

        svc.set_cross_reference(True)

        item = svc._stability_tracker.get_all_items()["doc:hub.md"]
        # The hub should win the L0 slot via ref-count
        # ranking. Leaves may or may not reach L0 depending
        # on the overshoot target vs real token sizes; what
        # matters is that the hub specifically lands there.
        assert item.tier == Tier.L0

    def test_l0_backfill_preserves_primary_index_in_l0(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Primary-index L0 residents survive cross-ref enable.

        A symbol: entry already in L0 (placed by the primary
        init path) must NOT be evicted when cross-ref's L0
        backfill runs. The backfill method only considers
        L1/L2/L3 candidates, so primary L0 items are safe
        regardless of how many cross-ref items want L0 slots.
        """
        from ac_dc.stability_tracker import Tier, TrackedItem

        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=["core.py"],
            doc_paths=["guide.md"],
        )
        # Pre-seed a primary-index L0 item, as if the primary
        # init pass had already placed it there.
        svc._stability_tracker._items["symbol:core.py"] = TrackedItem(
            key="symbol:core.py",
            tier=Tier.L0,
            n_value=12,
            content_hash="primary-hash",
            tokens=500,
        )
        svc._doc_index_ready = True

        svc.set_cross_reference(True)

        # Primary L0 item survives.
        symbol_item = svc._stability_tracker.get_all_items()[
            "symbol:core.py"
        ]
        assert symbol_item.tier == Tier.L0
        assert symbol_item.n_value == 12
        assert symbol_item.content_hash == "primary-hash"

    def test_disable_removes_cross_ref_items(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Disable strips doc: items from the tracker (code mode)."""
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=[],
            doc_paths=["guide.md", "README.md"],
        )
        svc._doc_index_ready = True
        svc.set_cross_reference(True)
        # Confirm items present.
        items = svc._stability_tracker.get_all_items()
        assert "doc:guide.md" in items
        assert "doc:README.md" in items

        svc.set_cross_reference(False)

        items_after = svc._stability_tracker.get_all_items()
        assert "doc:guide.md" not in items_after
        assert "doc:README.md" not in items_after

    def test_disable_marks_tiers_broken(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Disable marks the tier of every removed item as broken.

        So the next cascade can rebalance without being
        blocked by a stable tier flag.
        """
        from ac_dc.stability_tracker import Tier

        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=[],
            doc_paths=["guide.md"],
        )
        svc._doc_index_ready = True
        svc.set_cross_reference(True)

        # Manually relocate the item to L3 to exercise
        # tier-broken tracking for a non-ACTIVE tier.
        item = svc._stability_tracker._items["doc:guide.md"]
        item.tier = Tier.L3
        # Clear broken tiers so we can check the disable pass
        # marks L3 specifically.
        svc._stability_tracker._broken_tiers.clear()

        svc.set_cross_reference(False)
        assert Tier.L3 in svc._stability_tracker._broken_tiers

    def test_disable_preserves_non_cross_ref_items(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Disable leaves file:/history:/symbol: (primary) alone.

        Only the OPPOSITE-mode prefix is stripped. In code
        mode that's doc:; symbol: entries (primary) must
        survive.
        """
        from ac_dc.stability_tracker import Tier, TrackedItem

        (repo_dir / "a.py").write_text("content\n")
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=["a.py"],
            doc_paths=["guide.md"],
        )
        svc._doc_index_ready = True
        # Seed a file: entry and a history: entry manually.
        svc._stability_tracker._items["file:a.py"] = TrackedItem(
            key="file:a.py", tier=Tier.L1,
            n_value=3, content_hash="h", tokens=50,
        )
        svc._stability_tracker._items["history:0"] = TrackedItem(
            key="history:0", tier=Tier.L2,
            n_value=5, content_hash="h", tokens=20,
        )
        # Also seed a symbol: entry (simulating normal primary
        # index placement).
        svc._stability_tracker._items["symbol:a.py"] = TrackedItem(
            key="symbol:a.py", tier=Tier.L1,
            n_value=3, content_hash="h", tokens=30,
        )

        svc.set_cross_reference(True)
        svc.set_cross_reference(False)

        items = svc._stability_tracker.get_all_items()
        assert "file:a.py" in items
        assert "history:0" in items
        assert "symbol:a.py" in items
        # doc: items (cross-ref) gone.
        assert "doc:guide.md" not in items

    def test_doc_mode_disable_strips_symbol_not_doc(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """In doc mode + disable, symbol: entries are cross-ref.

        Doc mode's primary is doc:; symbol: is the secondary.
        Disabling must remove symbol: and leave doc: alone.
        """
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=["a.py"],
            doc_paths=["guide.md"],
        )
        svc._doc_index_ready = True
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker

        svc.set_cross_reference(True)
        items_with = svc._stability_tracker.get_all_items()
        assert "symbol:a.py" in items_with

        svc.set_cross_reference(False)
        items_without = svc._stability_tracker.get_all_items()
        assert "symbol:a.py" not in items_without

    def test_mode_switch_cleans_up_cross_ref_before_swap(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Mode switch with cross-ref on removes items from OLD tracker.

        The removal must run BEFORE the tracker swap, so the
        right prefix (matching the OLD mode) is stripped from
        the OLD tracker. After the swap, the new mode's
        tracker starts without stale cross-ref entries.
        """
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=["a.py"],
            doc_paths=["guide.md"],
        )
        svc._doc_index_ready = True

        # Enable cross-ref in code mode → doc: entries seeded
        # in the code-mode tracker.
        svc.set_cross_reference(True)
        code_tracker = svc._stability_tracker
        assert "doc:guide.md" in code_tracker.get_all_items()

        # Switch to doc mode. Cross-ref flag resets, doc: items
        # removed from the code tracker (cleanup).
        svc.switch_mode("doc")

        # Code tracker's doc: entries cleaned up.
        assert "doc:guide.md" not in code_tracker.get_all_items()
        # New (doc) tracker is distinct and has no cross-ref
        # entries either.
        assert svc._stability_tracker is not code_tracker
        assert svc._cross_ref_enabled is False

    def test_enable_is_idempotent_for_already_tracked_items(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Seeding doesn't overwrite items already in the tracker.

        If an item is already tracked (e.g., from a prior
        update cycle that placed it in a higher tier), the
        seeding pass leaves it alone. Prevents accidental
        demotion of stable cross-ref content.
        """
        from ac_dc.stability_tracker import Tier, TrackedItem

        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=[],
            doc_paths=["guide.md"],
        )
        svc._doc_index_ready = True

        # Pre-place doc:guide.md at L2 with N=5 (stable state).
        svc._stability_tracker._items["doc:guide.md"] = TrackedItem(
            key="doc:guide.md", tier=Tier.L2,
            n_value=5, content_hash="pre-existing",
            tokens=100,
        )

        svc.set_cross_reference(True)

        item = svc._stability_tracker.get_all_items()["doc:guide.md"]
        # Original state preserved.
        assert item.tier == Tier.L2
        assert item.n_value == 5
        assert item.content_hash == "pre-existing"

    def test_enable_broadcasts_mode_changed(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """Enable still broadcasts modeChanged with new state."""
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=[],
            doc_paths=["guide.md"],
        )
        svc._doc_index_ready = True
        svc._event_callback = event_cb
        event_cb.events.clear()

        svc.set_cross_reference(True)

        mode_events = [
            args for name, args in event_cb.events
            if name == "modeChanged"
        ]
        assert len(mode_events) == 1
        payload = mode_events[0][0]
        assert payload["cross_ref_enabled"] is True

    def test_rejection_does_not_broadcast(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """Readiness rejection doesn't fire modeChanged.

        The state didn't actually change, so no broadcast.
        """
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=[],
            doc_paths=["guide.md"],
        )
        svc._event_callback = event_cb
        # Readiness False.
        assert svc._doc_index_ready is False
        event_cb.events.clear()

        result = svc.set_cross_reference(True)
        assert "error" in result

        mode_events = [
            args for name, args in event_cb.events
            if name == "modeChanged"
        ]
        assert mode_events == []