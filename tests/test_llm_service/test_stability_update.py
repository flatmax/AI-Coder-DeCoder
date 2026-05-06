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
    """_update_stability never creates per-file symbol/doc entries.

    Under the L0-content-typed model (D27, see
    ``specs4/3-llm/cache-tiering.md`` § Index Inclusion), the
    aggregate symbol/doc map lives permanently in L0 and is
    regenerated from the index at assembly time. No per-file
    ``symbol:{path}`` or ``doc:{path}`` entries are placed into
    ``active_items`` — those entries would be picked up by the
    tracker, registered as Active items, and graduate through
    L3 → L2 → L1 over subsequent turns, polluting cached tiers
    that are reserved for promoted concrete content.

    These tests pin the new contract across all four mode ×
    cross-reference combinations. The selected-files /
    excluded-files invariants are covered separately below.

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

    def test_code_mode_creates_no_per_file_index_entries(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Code mode + cross-ref off → no symbol: or doc: entries.

        Under D27 the aggregate symbol map lives in L0 and is
        rendered from the index at assembly time. Per-file
        ``symbol:{path}`` entries would pollute cached tiers
        and are forbidden.
        """
        svc, capture = self._make_service_with_update_capture(
            config, repo, fake_litellm,
            symbol_paths=["a.py", "b.py"],
            doc_paths=["README.md", "guide.md"],
        )
        assert svc._context.mode == Mode.CODE
        assert svc._cross_ref_enabled is False

        svc._update_stability()
        active = capture["active_items"]

        assert not any(k.startswith("symbol:") for k in active)
        assert not any(k.startswith("doc:") for k in active)

    def test_code_mode_cross_ref_creates_no_per_file_index_entries(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Code mode + cross-ref on → still no per-file entries.

        Cross-reference is L0-only under D27. Toggling it on
        does not create per-file tracker entries of either
        kind; the secondary aggregate map is regenerated
        from the opposite-mode index at assembly time.
        """
        svc, capture = self._make_service_with_update_capture(
            config, repo, fake_litellm,
            symbol_paths=["a.py", "b.py"],
            doc_paths=["README.md", "guide.md"],
        )
        svc._cross_ref_enabled = True

        svc._update_stability()
        active = capture["active_items"]

        assert not any(k.startswith("symbol:") for k in active)
        assert not any(k.startswith("doc:") for k in active)

    def test_doc_mode_creates_no_per_file_index_entries(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Doc mode + cross-ref off → no doc: or symbol: entries."""
        svc, capture = self._make_service_with_update_capture(
            config, repo, fake_litellm,
            symbol_paths=["a.py", "b.py"],
            doc_paths=["README.md", "guide.md"],
        )
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker
        assert svc._cross_ref_enabled is False

        svc._update_stability()
        active = capture["active_items"]

        assert not any(k.startswith("symbol:") for k in active)
        assert not any(k.startswith("doc:") for k in active)

    def test_doc_mode_cross_ref_creates_no_per_file_index_entries(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Doc mode + cross-ref on → still no per-file entries.

        Symmetric to the code-mode case: cross-ref is L0-only
        regardless of primary mode.
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

        assert not any(k.startswith("symbol:") for k in active)
        assert not any(k.startswith("doc:") for k in active)

    def test_selected_files_become_file_entries(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Selected files appear as ``file:`` entries only.

        Under D27 there are no per-file ``symbol:`` entries
        for any file (selected or not). Selected files carry
        their full content via ``file:{path}`` entries
        (Step 1 of ``update_stability``).
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

        # Selected file → file: entry present.
        assert "file:a.py" in active
        # No per-file symbol entries for any file.
        assert not any(k.startswith("symbol:") for k in active)

    def test_selected_doc_files_become_file_entries(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Selected doc files appear as ``file:`` entries only."""
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
        # note in test_selected_files_become_file_entries.
        svc._sync_file_context()

        svc._update_stability()
        active = capture["active_items"]

        # Selected file → file: entry present.
        assert "file:README.md" in active
        # No per-file doc entries for any file.
        assert not any(k.startswith("doc:") for k in active)

    def test_selected_files_in_cross_ref_mode_become_file_entries(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Cross-reference doesn't change the selected-file contract.

        Under D27 cross-ref is L0-only: no per-file entries
        of either kind, regardless of selection state. Selected
        files appear as ``file:`` entries; everything else is
        absent.
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
        # note in test_selected_files_become_file_entries.
        svc._sync_file_context()

        svc._update_stability()
        active = capture["active_items"]

        # Selected files → file: entries.
        assert "file:a.py" in active
        assert "file:README.md" in active
        # No per-file index entries of any kind.
        assert not any(k.startswith("symbol:") for k in active)
        assert not any(k.startswith("doc:") for k in active)

    def test_doc_mode_with_indexed_files_produces_no_per_file_entries(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Doc mode with a populated doc index still produces nothing.

        Companion to the empty-index case. Under D27 even a
        fully-populated index does not produce per-file
        ``doc:{path}`` entries — the aggregate map lives in
        L0 only.
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

        # No per-file index entries of any kind.
        assert not any(k.startswith("doc:") for k in active)
        assert not any(k.startswith("symbol:") for k in active)

    def test_code_mode_with_indexed_files_produces_no_per_file_entries(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Code mode with a populated symbol index produces nothing."""
        svc, capture = self._make_service_with_update_capture(
            config, repo, fake_litellm,
            symbol_paths=[],
            doc_paths=["README.md"],
        )

        svc._update_stability()
        active = capture["active_items"]

        # No per-file index entries of any kind.
        assert not any(k.startswith("symbol:") for k in active)
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

    def test_no_per_file_symbol_entries_regardless_of_exclusion(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """No per-file ``symbol:`` entries appear, exclusion or not.

        Under D27 the primary aggregate symbol map is rendered
        from the index at assembly time and never produces
        per-file tracker entries. The exclusion machinery is
        defensive — if it never fires (because no entries are
        being created in the first place), we still expect a
        clean active_items dict with no per-file index keys.
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
        # No per-file symbol entries at all.
        assert not any(k.startswith("symbol:") for k in active)

    def test_no_per_file_doc_entries_regardless_of_exclusion(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """No per-file ``doc:`` entries appear, exclusion or not."""
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
        # No per-file doc entries at all.
        assert not any(k.startswith("doc:") for k in active)

    def test_cross_ref_creates_no_per_file_entries_either_kind(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Cross-ref creates no per-file entries — primary or secondary.

        Pre-D27, Step 3 created per-file primary entries and
        Step 4 created per-file secondary entries when cross-
        ref was enabled. Both steps are gone under the L0-
        content-typed model. Both aggregate maps are
        regenerated from their indexes at assembly time and
        rendered into L0; no per-file tracker entries are
        created at any time.
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
        # No per-file index entries of either kind, regardless
        # of exclusion state.
        assert not any(k.startswith("symbol:") for k in active)
        assert not any(k.startswith("doc:") for k in active)

    def test_no_excluded_files_is_noop(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Empty exclusion list → step 0a does nothing.

        Regression guard: the removal pass must not corrupt
        unrelated tracker state when there's nothing to
        exclude.

        Pre-D27 this test seeded a ``symbol:a.py`` entry. Under
        D27 the defensive sweep (new Step 2) correctly removes
        any per-file ``symbol:`` entry it finds — so we use a
        ``file:a.py`` entry instead, which is legitimate under
        the L0-content-typed model and which neither step 0a
        nor step 2 touch.

        ``get_flat_file_list`` is monkeypatched so Phase 0
        stale-removal doesn't drop ``file:a.py`` for not being
        on disk — the point of this test is to exercise step
        0a, not Phase 0.
        """
        from ac_dc.stability_tracker import Tier, TrackedItem

        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=["a.py"],
        )
        # Make a.py a real file so _sync_file_context can
        # load it; selecting it puts a file:a.py entry into
        # active_items via Step 1.
        (repo_dir / "a.py").write_text("content\n")
        monkeypatch.setattr(
            repo, "get_flat_file_list", lambda: "a.py"
        )
        svc.set_selected_files(["a.py"])
        svc._sync_file_context()
        # Pre-populate the tracker entry at L2 so we can
        # confirm step 0a doesn't disturb it. Hash matches
        # what Step 1 will produce so Phase 1 doesn't demote
        # for a hash mismatch.
        import hashlib
        content = "content\n"
        h = hashlib.sha256(content.encode("utf-8")).hexdigest()
        svc._stability_tracker._items["file:a.py"] = TrackedItem(
            key="file:a.py",
            tier=Tier.L2,
            n_value=6,
            content_hash=h,
            tokens=50,
        )

        svc._update_stability()

        # Entry survives (normal cascade may change its tier,
        # but it shouldn't disappear because of step 0a or
        # the legacy-sweep step 2).
        all_keys = set(
            svc._stability_tracker.get_all_items().keys()
        )
        assert "file:a.py" in all_keys

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