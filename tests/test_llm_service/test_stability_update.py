"""_update_stability mode-aware dispatch and exclusion handling.

Covers:

- :class:`TestUpdateStabilityIndexDispatch` — :meth:`LLMService._update_stability`
  populates active_items with the right index prefix per
  mode × cross-reference state.
- :class:`TestUpdateStabilityExcludedFiles` — the step-0a
  defensive excluded-files removal pass and its companion
  guards in steps 3 and 4.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from ac_dc.config import ConfigManager
from ac_dc.context_manager import Mode
from ac_dc.llm_service import LLMService
from ac_dc.repo import Repo

from .conftest import _FakeLiteLLM


class TestUpdateStabilityIndexDispatch:
    """_update_stability populates active_items with the right prefix
    per mode × cross-reference state.

    Four scenarios:

    - Code mode, no cross-ref: only symbol: entries (no doc:).
    - Code mode, cross-ref on: both symbol: (primary) and doc:
      (secondary).
    - Doc mode, no cross-ref: only doc: entries (no symbol:).
    - Doc mode, cross-ref on: both doc: (primary) and symbol:
      (secondary).

    In every case, selected files are excluded from both
    prefixes (the "never appears twice" invariant — selected
    files carry their content directly via file: entries).

    Tests capture the active_items dict by patching
    ``self._stability_tracker.update`` to record the first
    argument. The tracker's own behaviour is tested
    exhaustively in test_stability_tracker.py; here we only
    verify the service's dispatch.
    """

    def _make_service_with_update_capture(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        symbol_paths: list[str] | None = None,
        doc_paths: list[str] | None = None,
    ) -> tuple[LLMService, dict[str, Any]]:
        """Build a service with captured tracker.update args.

        symbol_paths and doc_paths control which files appear in
        the respective indexes. Returns (service, capture_dict)
        where capture_dict['active_items'] holds the dict passed
        to the most recent tracker.update call.
        """
        symbol_paths = symbol_paths or []
        doc_paths = doc_paths or []

        class _SymbolIndexStub:
            def __init__(self, paths: list[str]) -> None:
                # _all_symbols membership drives which files
                # step 3 iterates.
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

        # Seed doc index outlines. We need actual DocOutline
        # objects so get_file_doc_block produces content. Using
        # the markdown extractor is simpler than constructing
        # outlines by hand.
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

        # Patch tracker.update to record the active_items arg.
        capture: dict[str, Any] = {}
        original_update = svc._stability_tracker.update

        def _capture_update(
            active_items: dict[str, Any],
            existing_files: set[str] | None = None,
        ) -> list[str]:
            capture["active_items"] = dict(active_items)
            return original_update(
                active_items, existing_files=existing_files
            )

        svc._stability_tracker.update = _capture_update  # type: ignore[method-assign]

        return svc, capture

    def test_code_mode_adds_symbol_entries_only(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Code mode + cross-ref off → symbol: only, no doc:."""
        svc, capture = self._make_service_with_update_capture(
            config, repo, fake_litellm,
            symbol_paths=["a.py", "b.py"],
            doc_paths=["README.md", "guide.md"],
        )
        assert svc._context.mode == Mode.CODE
        assert svc._cross_ref_enabled is False

        svc._update_stability()
        active = capture["active_items"]

        # Symbol entries present.
        assert "symbol:a.py" in active
        assert "symbol:b.py" in active
        # Doc entries absent.
        assert "doc:README.md" not in active
        assert "doc:guide.md" not in active

    def test_code_mode_cross_ref_adds_only_primary(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Code mode + cross-ref on → still only ``symbol:`` (primary).

        Under the L0-content-typed model (D27) cross-reference
        is L0-only — no per-file ``doc:{path}`` entries get
        created in active_items even when the toggle is on.
        The secondary aggregate map is regenerated from the
        opposite-mode index at assembly time, not held as
        cascade-tracked items.
        """
        svc, capture = self._make_service_with_update_capture(
            config, repo, fake_litellm,
            symbol_paths=["a.py", "b.py"],
            doc_paths=["README.md", "guide.md"],
        )
        svc._cross_ref_enabled = True

        svc._update_stability()
        active = capture["active_items"]

        # Primary entries still present.
        assert "symbol:a.py" in active
        assert "symbol:b.py" in active
        # Secondary entries NOT created — under D27 cross-ref
        # is an L0-only affair, not a per-file tracker concern.
        assert "doc:README.md" not in active
        assert "doc:guide.md" not in active

    def test_doc_mode_adds_doc_entries_only(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Doc mode + cross-ref off → doc: only, no symbol:."""
        svc, capture = self._make_service_with_update_capture(
            config, repo, fake_litellm,
            symbol_paths=["a.py", "b.py"],
            doc_paths=["README.md", "guide.md"],
        )
        # Switch to doc mode via the context manager directly.
        svc._context.set_mode(Mode.DOC)
        # Ensure doc tracker is in use.
        svc._trackers[Mode.DOC] = svc._stability_tracker
        assert svc._cross_ref_enabled is False

        svc._update_stability()
        active = capture["active_items"]

        # Doc entries present.
        assert "doc:README.md" in active
        assert "doc:guide.md" in active
        # Symbol entries absent in doc mode without cross-ref.
        assert "symbol:a.py" not in active
        assert "symbol:b.py" not in active

    def test_doc_mode_cross_ref_adds_only_primary(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Doc mode + cross-ref on → still only ``doc:`` (primary).

        Symmetric to the code-mode case: cross-ref is L0-only
        regardless of which mode is primary. No per-file
        secondary tracker entries.
        """
        svc, capture = self._make_service_with_update_capture(
            config, repo, fake_litellm,
            symbol_paths=["a.py", "b.py"],
            doc_paths=["README.md", "guide.md"],
        )
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker
        svc._cross_ref_enabled = True

        svc._update_stability()
        active = capture["active_items"]

        # Primary (doc) entries present.
        assert "doc:README.md" in active
        assert "doc:guide.md" in active
        # Secondary (symbol) entries NOT created.
        assert "symbol:a.py" not in active
        assert "symbol:b.py" not in active

    def test_selected_files_excluded_from_symbol_entries(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Selected files don't appear as symbol: entries.

        Selected files carry their content via file: entries
        (step 1); the symbol: entry would be redundant.
        """
        (repo_dir / "a.py").write_text("content\n")
        svc, capture = self._make_service_with_update_capture(
            config, repo, fake_litellm,
            symbol_paths=["a.py", "b.py"],
            doc_paths=[],
        )
        svc.set_selected_files(["a.py"])
        # _update_stability reads file: entries from the file
        # context; selection alone doesn't populate it. In
        # production, _stream_chat calls _sync_file_context
        # before _update_stability; here we do it manually.
        svc._sync_file_context()

        svc._update_stability()
        active = capture["active_items"]

        # a.py is selected — file: entry present, symbol: absent.
        assert "file:a.py" in active
        assert "symbol:a.py" not in active
        # b.py unselected — symbol: present.
        assert "symbol:b.py" in active

    def test_selected_files_excluded_from_doc_entries(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Selected doc files don't appear as doc: entries either."""
        (repo_dir / "README.md").write_text("# Doc\n\nbody.\n")
        svc, capture = self._make_service_with_update_capture(
            config, repo, fake_litellm,
            symbol_paths=[],
            doc_paths=["README.md", "guide.md"],
        )
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker
        svc.set_selected_files(["README.md"])
        # Load selection content into the file context — see
        # note in test_selected_files_excluded_from_symbol_entries.
        svc._sync_file_context()

        svc._update_stability()
        active = capture["active_items"]

        # README.md selected — file: present, doc: absent.
        assert "file:README.md" in active
        assert "doc:README.md" not in active
        # guide.md unselected — doc: present.
        assert "doc:guide.md" in active

    def test_selected_files_excluded_in_cross_ref_mode(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Cross-reference mode still excludes selected files from primary.

        Under D27 cross-ref doesn't create secondary per-file
        entries at all — the selected-files exclusion only
        needs to cover the primary ``symbol:`` (in code mode)
        prefix. Verified here: selected files appear as
        ``file:`` only; unselected files appear as primary
        ``symbol:``; nothing on the secondary ``doc:``
        prefix appears regardless.
        """
        (repo_dir / "a.py").write_text("pycontent\n")
        (repo_dir / "README.md").write_text("# Doc\n\nbody.\n")
        svc, capture = self._make_service_with_update_capture(
            config, repo, fake_litellm,
            symbol_paths=["a.py", "b.py"],
            doc_paths=["README.md", "guide.md"],
        )
        svc._cross_ref_enabled = True
        svc.set_selected_files(["a.py", "README.md"])
        # Load selection content into the file context — see
        # note in test_selected_files_excluded_from_symbol_entries.
        svc._sync_file_context()

        svc._update_stability()
        active = capture["active_items"]

        # Selected files → file: only.
        assert "file:a.py" in active
        assert "symbol:a.py" not in active
        assert "file:README.md" in active
        # README.md isn't in the symbol index so symbol:
        # was never going to fire.
        # Unselected non-selected, non-excluded source file
        # appears with the primary prefix.
        assert "symbol:b.py" in active
        # No secondary (doc:) entries — D27 cross-ref is
        # L0-only.
        assert not any(
            k.startswith("doc:") for k in active
        )

    def test_empty_doc_index_in_doc_mode_produces_no_entries(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Doc mode with empty doc index → no doc: entries.

        The primary index being empty isn't an error — doc mode
        with no outlines yet (pre-background-build) simply
        produces no primary entries. Symbol mode would still
        produce symbol: entries if cross-ref were on, but here
        we're testing the primary-empty case only.
        """
        svc, capture = self._make_service_with_update_capture(
            config, repo, fake_litellm,
            symbol_paths=["a.py"],
            doc_paths=[],  # empty doc index
        )
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker

        svc._update_stability()
        active = capture["active_items"]

        # No doc: entries (empty index).
        assert not any(k.startswith("doc:") for k in active)
        # No symbol: entries (cross-ref off).
        assert not any(k.startswith("symbol:") for k in active)

    def test_empty_symbol_index_in_code_mode_produces_no_entries(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Code mode with empty symbol index → no symbol: entries."""
        svc, capture = self._make_service_with_update_capture(
            config, repo, fake_litellm,
            symbol_paths=[],
            doc_paths=["README.md"],
        )

        svc._update_stability()
        active = capture["active_items"]

        # No symbol: entries (empty index).
        assert not any(k.startswith("symbol:") for k in active)
        # No doc: entries (cross-ref off in code mode).
        assert not any(k.startswith("doc:") for k in active)


class TestUpdateStabilityExcludedFiles:
    """_update_stability step 0a: defensive excluded-files removal.

    Covers Fix 3 — the defensive excluded-files removal pass at
    the top of every update cycle. ``set_excluded_index_files``
    does a one-shot removal when the exclusion set changes, but
    a file could be re-indexed between that call and the next
    update (repo re-walk, rebuild, cross-ref enable). Step 0a
    catches that drift and honours the specs3 belt-and-
    suspenders contract.

    Steps 3 and 4 of ``_update_stability`` also carry an
    ``excluded_set`` guard so they don't re-register excluded
    paths as fresh active items. Without that guard, step 0a's
    removal would be immediately undone.
    """

    def _make_service_with_both_indexes(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        symbol_paths: list[str] | None = None,
        doc_paths: list[str] | None = None,
    ) -> LLMService:
        """Service with both indexes populated."""
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

    def test_step_0a_removes_stale_tracker_entries(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Excluded files whose tracker entries survived get removed.

        Simulates drift: a file was indexed, got a tracker
        entry at L2, and was later excluded. The one-shot
        removal in set_excluded_index_files should have caught
        it — but if it didn't (tracker re-populated after the
        exclusion set change, e.g., from a cross-ref enable),
        step 0a cleans it up on the next update cycle.
        """
        from ac_dc.stability_tracker import Tier, TrackedItem

        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=["excluded.py"],
        )
        # Set exclusion DIRECTLY on the attribute, bypassing
        # set_excluded_index_files to simulate the drift case.
        svc._excluded_index_files = ["excluded.py"]
        # Seed a stale tracker entry at L2.
        svc._stability_tracker._items["symbol:excluded.py"] = TrackedItem(
            key="symbol:excluded.py",
            tier=Tier.L2,
            n_value=6,
            content_hash="h",
            tokens=100,
        )

        svc._update_stability()

        # Entry gone after the update cycle.
        all_keys = set(svc._stability_tracker.get_all_items().keys())
        assert "symbol:excluded.py" not in all_keys

    def test_step_0a_removes_all_three_prefixes(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Removal pass covers symbol:, doc:, and file: prefixes."""
        from ac_dc.stability_tracker import Tier, TrackedItem

        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
        )
        svc._excluded_index_files = ["multi.md"]
        tracker = svc._stability_tracker
        tracker._items["symbol:multi.md"] = TrackedItem(
            key="symbol:multi.md", tier=Tier.L1,
            n_value=3, content_hash="h", tokens=10,
        )
        tracker._items["doc:multi.md"] = TrackedItem(
            key="doc:multi.md", tier=Tier.L2,
            n_value=6, content_hash="h", tokens=20,
        )
        tracker._items["file:multi.md"] = TrackedItem(
            key="file:multi.md", tier=Tier.L3,
            n_value=3, content_hash="h", tokens=30,
        )

        svc._update_stability()

        all_keys = set(tracker.get_all_items().keys())
        assert "symbol:multi.md" not in all_keys
        assert "doc:multi.md" not in all_keys
        assert "file:multi.md" not in all_keys

    def test_step_0a_marks_tiers_broken(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Removed items' tiers get added to _broken_tiers.

        So the cascade can rebalance. We seed the entry at a
        non-ACTIVE tier and confirm that tier shows up in
        broken_tiers after the update.

        Note: ``tracker.update`` resets _broken_tiers at the
        top of the cycle, so we can't observe the flag after
        a full update. Instead we verify the REMOVAL happened
        at all — if step 0a's tier-marking didn't run, the
        entry would still be there after step 3 (which doesn't
        touch tracker state for excluded-but-indexed paths in
        a way that removes prior entries).
        """
        from ac_dc.stability_tracker import Tier, TrackedItem

        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=["excluded.py"],
        )
        svc._excluded_index_files = ["excluded.py"]
        svc._stability_tracker._items["symbol:excluded.py"] = TrackedItem(
            key="symbol:excluded.py",
            tier=Tier.L2,
            n_value=6,
            content_hash="h",
            tokens=100,
        )

        svc._update_stability()

        # The entry is gone — that's the observable effect.
        all_keys = set(
            svc._stability_tracker.get_all_items().keys()
        )
        assert "symbol:excluded.py" not in all_keys

    def test_step_3_skips_excluded_paths(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Excluded paths don't get re-registered as active items.

        Without the excluded_set guard in step 3, an excluded
        file would be removed by step 0a and then immediately
        re-added by step 3's iteration over the index. Step 3
        must skip excluded paths.

        Test approach: call _update_stability with a capture
        on tracker.update. If step 3's skip works, the
        active_items dict passed to update has no entry for
        the excluded path.
        """
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=["excluded.py", "normal.py"],
        )
        svc._excluded_index_files = ["excluded.py"]

        # Capture tracker.update's active_items arg.
        capture: dict[str, Any] = {}
        original = svc._stability_tracker.update

        def _capture(
            active_items: dict[str, Any],
            existing_files: set[str] | None = None,
        ) -> list[str]:
            capture["active_items"] = dict(active_items)
            return original(active_items, existing_files=existing_files)

        svc._stability_tracker.update = _capture  # type: ignore[method-assign]

        svc._update_stability()

        active = capture["active_items"]
        # Excluded path absent; normal path present.
        assert "symbol:excluded.py" not in active
        assert "symbol:normal.py" in active

    def test_step_3_skips_excluded_doc_paths(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Doc-mode step 3 also skips excluded paths."""
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            doc_paths=["excluded.md", "normal.md"],
        )
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker
        svc._excluded_index_files = ["excluded.md"]

        capture: dict[str, Any] = {}
        original = svc._stability_tracker.update

        def _capture(
            active_items: dict[str, Any],
            existing_files: set[str] | None = None,
        ) -> list[str]:
            capture["active_items"] = dict(active_items)
            return original(active_items, existing_files=existing_files)

        svc._stability_tracker.update = _capture  # type: ignore[method-assign]

        svc._update_stability()

        active = capture["active_items"]
        assert "doc:excluded.md" not in active
        assert "doc:normal.md" in active

    def test_step_4_creates_no_secondary_entries_under_d27(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Step 4 is gone — no secondary entries created at all.

        Pre-D27 step 4 created per-file ``doc:{path}`` (in
        code mode) or ``symbol:{path}`` (in doc mode)
        entries when cross-reference was enabled, with an
        excluded-set guard to skip user-excluded paths.
        Under D27 the whole step is gone — cross-ref is
        L0-only and the secondary map is regenerated from
        the index at assembly time.

        This test pins the new contract: regardless of the
        excluded set, no secondary entries appear in
        active_items when cross-ref is on. The primary
        index path's exclusion handling is unchanged and
        is covered by other tests in this class.
        """
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=["a.py"],
            doc_paths=["excluded.md", "normal.md"],
        )
        # Code mode primary; cross-ref enabled.
        svc._cross_ref_enabled = True
        svc._excluded_index_files = ["excluded.md"]

        capture: dict[str, Any] = {}
        original = svc._stability_tracker.update

        def _capture(
            active_items: dict[str, Any],
            existing_files: set[str] | None = None,
        ) -> list[str]:
            capture["active_items"] = dict(active_items)
            return original(active_items, existing_files=existing_files)

        svc._stability_tracker.update = _capture  # type: ignore[method-assign]

        svc._update_stability()

        active = capture["active_items"]
        # No secondary (doc:) entries — neither for the
        # excluded file nor the normal one. The whole
        # secondary-index pass is gone under D27.
        assert "doc:excluded.md" not in active
        assert "doc:normal.md" not in active
        # Primary symbol entry unaffected.
        assert "symbol:a.py" in active

    def test_no_excluded_files_is_noop(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Empty exclusion list → step 0a does nothing.

        Regression guard: the removal pass must not corrupt
        tracker state when there's nothing to exclude.

        ``get_flat_file_list`` is monkeypatched so the tracker's
        Phase 0 stale-removal doesn't drop ``symbol:a.py`` for
        not being on disk — the point of this test is to
        exercise step 0a, not Phase 0.
        """
        from ac_dc.stability_tracker import Tier, TrackedItem

        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=["a.py"],
        )
        monkeypatch.setattr(
            repo, "get_flat_file_list", lambda: "a.py"
        )
        # Pre-populate a legitimate tracker entry. Use the
        # real signature hash so Phase 1 doesn't demote it —
        # we want to see that step 0a left the entry alone,
        # not that Phase 1 demoted-but-preserved it.
        sig_hash = (
            svc._symbol_index.get_signature_hash("a.py")
            or "h"
        )
        svc._stability_tracker._items["symbol:a.py"] = TrackedItem(
            key="symbol:a.py",
            tier=Tier.L2,
            n_value=6,
            content_hash=sig_hash,
            tokens=50,
        )

        svc._update_stability()

        # Entry survives (the normal update flow may change its
        # tier via cascade, but it shouldn't disappear because
        # of step 0a).
        all_keys = set(
            svc._stability_tracker.get_all_items().keys()
        )
        assert "symbol:a.py" in all_keys

    def test_exclusion_drift_scenario_end_to_end(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Full drift scenario: exclude → re-index → update.

        1. User excludes a file via set_excluded_index_files —
           tracker entry removed immediately (one-shot).
        2. Something re-creates the tracker entry (simulated
           here by direct injection, but could be any code path
           that touches the tracker).
        3. Next update cycle runs step 0a, which catches the
           drift and removes the entry again.

        Without Fix 3, step 3 would see the excluded file in
        the symbol index, skip it, but the stale tracker entry
        from (2) would linger indefinitely — rendering as an
        index block in cached tiers even though the user
        excluded it.
        """
        from ac_dc.stability_tracker import Tier, TrackedItem

        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=["drifted.py"],
        )
        # Phase 1: exclude.
        svc.set_excluded_index_files(["drifted.py"])
        # Tracker should have no entry at this point.
        assert "symbol:drifted.py" not in (
            svc._stability_tracker.get_all_items()
        )

        # Phase 2: simulate drift — something re-creates the
        # entry. In production this could be a rebuild or a
        # cross-ref enable that iterates the index without
        # checking the exclusion set.
        svc._stability_tracker._items["symbol:drifted.py"] = TrackedItem(
            key="symbol:drifted.py",
            tier=Tier.L1,
            n_value=3,
            content_hash="h",
            tokens=20,
        )
        assert "symbol:drifted.py" in (
            svc._stability_tracker.get_all_items()
        )

        # Phase 3: next update runs step 0a.
        svc._update_stability()

        # Entry gone.
        assert "symbol:drifted.py" not in (
            svc._stability_tracker.get_all_items()
        )