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
    - Enable seeds the tracker with opposite-index items so
      content appears on the next request, not just after the
      next _update_stability cycle.
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

        class _SymbolIndexStub:
            def __init__(self, paths: list[str]) -> None:
                self._all_symbols = {p: None for p in paths}

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

    def test_seeded_items_land_in_active_tier(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Seeded cross-ref items start in the ACTIVE tier with N=0.

        They promote via the standard N-value machinery on
        subsequent requests.
        """
        from ac_dc.stability_tracker import Tier

        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=[],
            doc_paths=["guide.md"],
        )
        svc._doc_index_ready = True
        svc.set_cross_reference(True)

        item = svc._stability_tracker.get_all_items()["doc:guide.md"]
        assert item.tier == Tier.ACTIVE
        assert item.n_value == 0

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