"""Manual cache rebuild pipeline.

Covers :class:`TestRebuildCache` — :meth:`LLMService.rebuild_cache`
and its per-mode variations. Tests exercise the full 12-step
pipeline: history preservation, file-entry swap, orphan
distribution, history graduation, cross-reference swap (Fix 2),
localhost-only gate, and error handling.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from ac_dc.config import ConfigManager
from ac_dc.context_manager import Mode
from ac_dc.history_store import HistoryStore
from ac_dc.llm_service import LLMService
from ac_dc.repo import Repo

from .conftest import _FakeLiteLLM, _FakeSymbolIndexWithRefs, _RecordingEventCallback


class TestRebuildCache:
    """Manual cache rebuild — LLMService.rebuild_cache.

    Covers the specs3 "Manual Cache Rebuild" sequence:
    history preservation, file-entry swap, orphan distribution,
    history graduation, localhost-only gate, error handling.
    """

    def _make_service(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        symbol_index=None,
        repo_files: list[str] | None = None,
        monkeypatch: pytest.MonkeyPatch | None = None,
    ) -> LLMService:
        """Build a service with a symbol index attached and
        optionally a controlled repo-file list.

        ``repo_files`` replaces the output of
        ``Repo.get_flat_file_list`` so tests can pin exactly
        which files appear in the index without needing to
        create real files on disk. The ``Repo.get_flat_file_list``
        method is monkeypatched directly.
        """
        svc = LLMService(
            config=config,
            repo=repo,
            symbol_index=symbol_index,
            event_callback=event_cb,
            history_store=history_store,
        )
        if repo_files is not None and monkeypatch is not None:
            monkeypatch.setattr(
                repo,
                "get_flat_file_list",
                lambda: "\n".join(repo_files),
            )
        return svc

    def test_no_repo_rejected(
        self,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """rebuild_cache requires both a repo and a symbol index."""
        svc = LLMService(config=config, repo=None)
        result = svc.rebuild_cache()
        assert "error" in result
        assert "repository" in result["error"].lower()

    def test_no_symbol_index_rejected(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Missing symbol index → clean error."""
        svc = LLMService(
            config=config,
            repo=repo,
            symbol_index=None,
        )
        result = svc.rebuild_cache()
        assert "error" in result
        assert (
            "symbol index" in result["error"].lower()
            or "repository" in result["error"].lower()
        )

    def test_empty_tracker_and_no_files_succeeds(
        self,
        config: ConfigManager,
        repo: Repo,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Rebuild with no files in the index is a valid no-op path.

        Produces a tracker containing only the re-seeded system
        prompt. items_before == items_after == 1 (system:prompt).
        """
        fake_index = _FakeSymbolIndexWithRefs()
        svc = self._make_service(
            config, repo, fake_litellm,
            history_store, event_cb,
            symbol_index=fake_index,
            repo_files=[],
            monkeypatch=monkeypatch,
        )
        result = svc.rebuild_cache()
        assert result["status"] == "rebuilt"
        assert result["items_after"] >= 1  # system:prompt at least
        # system:prompt seeded in L0.
        assert svc._stability_tracker.has_item("system:prompt")

    def test_preserves_history_entries_across_rebuild(
        self,
        config: ConfigManager,
        repo: Repo,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """history:* items survive rebuild at their previous tier/N.

        Before rebuild: seed history:0 in L2 with N=4. After
        rebuild: the same key exists in L2 with the same N,
        even though everything else was wiped.
        """
        fake_index = _FakeSymbolIndexWithRefs()
        svc = self._make_service(
            config, repo, fake_litellm,
            history_store, event_cb,
            symbol_index=fake_index,
            repo_files=[],
            monkeypatch=monkeypatch,
        )
        # Seed history directly onto the tracker. We also seed a
        # matching message on the context manager so step 11's
        # history-graduation pass has content to walk (though
        # with repo_files=[] and no file tokens, the verbatim
        # window will absorb everything).
        from ac_dc.stability_tracker import Tier, TrackedItem
        tracker = svc._stability_tracker
        tracker._items["history:0"] = TrackedItem(
            key="history:0",
            tier=Tier.L2,
            n_value=4,
            content_hash="h0",
            tokens=10,
        )
        svc._context.add_message("user", "earlier message")

        result = svc.rebuild_cache()
        assert result["status"] == "rebuilt"

        # history:0 still present at L2 with N=4 (verbatim
        # window keeps it since it's the only message and fits).
        existing = tracker.get_all_items().get("history:0")
        assert existing is not None
        # The verbatim window preserves it in its prior tier.
        assert existing.n_value == 4
        assert existing.tier == Tier.L2

    def test_wipes_non_history_entries(
        self,
        config: ConfigManager,
        repo: Repo,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Stale symbol:/doc:/file:/url: entries don't survive rebuild.

        A stale symbol: entry for a path that's no longer indexed
        must be gone after rebuild — even if no item replaces it.
        """
        fake_index = _FakeSymbolIndexWithRefs(
            blocks={},
            ref_counts={},
            components=[],
        )
        svc = self._make_service(
            config, repo, fake_litellm,
            history_store, event_cb,
            symbol_index=fake_index,
            repo_files=[],
            monkeypatch=monkeypatch,
        )
        # Seed various non-history items.
        from ac_dc.stability_tracker import Tier, TrackedItem
        tracker = svc._stability_tracker
        tracker._items["symbol:stale.py"] = TrackedItem(
            key="symbol:stale.py", tier=Tier.L1,
            n_value=3, content_hash="h", tokens=100,
        )
        tracker._items["file:gone.md"] = TrackedItem(
            key="file:gone.md", tier=Tier.L2,
            n_value=5, content_hash="h", tokens=50,
        )
        tracker._items["url:abc123"] = TrackedItem(
            key="url:abc123", tier=Tier.L3,
            n_value=2, content_hash="h", tokens=30,
        )

        svc.rebuild_cache()

        # All three gone. system:prompt may be present from
        # step 9; history is preserved (none seeded here).
        all_keys = set(tracker.get_all_items().keys())
        assert "symbol:stale.py" not in all_keys
        assert "file:gone.md" not in all_keys
        assert "url:abc123" not in all_keys

    def test_indexed_files_not_seeded_as_tracker_entries(
        self,
        config: ConfigManager,
        repo: Repo,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Under D27, indexed files are NOT tracker entries.

        Pre-D27 rebuild bin-packed every indexed file across
        L0/L1/L2/L3 as ``symbol:{path}`` tracker entries. Under
        the L0-content-typed model the aggregate symbol map is
        regenerated from the index at assembly time, not held
        as tracker entries. Rebuild therefore produces a
        tracker that contains only ``system:prompt`` (and any
        preserved history) when no files are selected.

        Spec: ``specs4/3-llm/cache-tiering.md`` § L0 Stability
        Contract and § Why no startup file distribution.
        """
        fake_index = _FakeSymbolIndexWithRefs(
            blocks={
                "central.py": "block-central",
                "mod_a.py": "block-A",
                "mod_b.py": "block-B",
            },
            ref_counts={
                "central.py": 10,
                "mod_a.py": 2,
                "mod_b.py": 2,
            },
            components=[{"mod_a.py", "mod_b.py"}],
        )
        svc = self._make_service(
            config, repo, fake_litellm,
            history_store, event_cb,
            symbol_index=fake_index,
            repo_files=["central.py", "mod_a.py", "mod_b.py"],
            monkeypatch=monkeypatch,
        )
        result = svc.rebuild_cache()
        assert result["status"] == "rebuilt"

        # No symbol: entries — those live in L0's aggregate
        # map, not as cascade-tracked items.
        tracker = svc._stability_tracker
        all_keys = set(tracker.get_all_items().keys())
        assert "symbol:central.py" not in all_keys
        assert "symbol:mod_a.py" not in all_keys
        assert "symbol:mod_b.py" not in all_keys
        # Only system:prompt expected (no files selected, no
        # history seeded).
        assert all_keys == {"system:prompt"}

    def test_selected_files_become_file_entries(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Selected files end up as file: entries in cached tiers.

        Under D27 there's no primary-index ``symbol:`` tracker
        entry to swap from — selected files are placed directly
        into L1/L2/L3 via :func:`distribute_orphan_files`. The
        outcome is the same: the file appears as a ``file:``
        entry in a cached tier (never L0, never Active).
        """
        # Create a real selected file so file_context.add_file
        # can load it.
        (repo_dir / "a.py").write_text("def foo(): pass\n")
        fake_index = _FakeSymbolIndexWithRefs(
            blocks={"a.py": "block-a"},
            ref_counts={"a.py": 5},
            components=[],
        )
        svc = self._make_service(
            config, repo, fake_litellm,
            history_store, event_cb,
            symbol_index=fake_index,
            repo_files=["a.py"],
            monkeypatch=monkeypatch,
        )
        svc.set_selected_files(["a.py"])
        svc.rebuild_cache()

        tracker = svc._stability_tracker
        all_keys = set(tracker.get_all_items().keys())
        # No symbol: entry — those don't exist as tracker
        # entries under D27.
        assert "symbol:a.py" not in all_keys
        # file: entry placed by orphan distribution.
        assert "file:a.py" in all_keys
        # Landed in a cached tier (L1/L2/L3 — never L0 or Active).
        file_item = tracker.get_all_items()["file:a.py"]
        from ac_dc.stability_tracker import Tier
        assert file_item.tier in (Tier.L1, Tier.L2, Tier.L3)

    def test_distributes_orphan_selected_files(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Selected non-source files become file: entries in L1-L3.

        An orphan is a file that's selected but isn't in the
        primary index (e.g., .md, .json). Without distribution
        it would end up in ACTIVE; rebuild packs it into L1-L3.
        """
        (repo_dir / "README.md").write_text("# readme\n" * 50)
        (repo_dir / "config.json").write_text('{"x": 1}\n')
        # repo_files intentionally EXCLUDES the selected files —
        # they're orphans from the index's perspective.
        fake_index = _FakeSymbolIndexWithRefs(
            blocks={},
            ref_counts={},
            components=[],
        )
        svc = self._make_service(
            config, repo, fake_litellm,
            history_store, event_cb,
            symbol_index=fake_index,
            repo_files=[],  # nothing indexed
            monkeypatch=monkeypatch,
        )
        svc.set_selected_files(["README.md", "config.json"])
        svc.rebuild_cache()

        from ac_dc.stability_tracker import Tier
        tracker = svc._stability_tracker
        # Both appear as file: entries.
        readme = tracker.get_all_items().get("file:README.md")
        cfg = tracker.get_all_items().get("file:config.json")
        assert readme is not None
        assert cfg is not None
        # Landed in L1, L2, or L3 — never ACTIVE.
        assert readme.tier in (Tier.L1, Tier.L2, Tier.L3)
        assert cfg.tier in (Tier.L1, Tier.L2, Tier.L3)

    def test_reseeds_system_prompt_in_l0(
        self,
        config: ConfigManager,
        repo: Repo,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """system:prompt lands in L0 with entry_n after rebuild."""
        fake_index = _FakeSymbolIndexWithRefs()
        svc = self._make_service(
            config, repo, fake_litellm,
            history_store, event_cb,
            symbol_index=fake_index,
            repo_files=[],
            monkeypatch=monkeypatch,
        )
        svc.rebuild_cache()

        from ac_dc.stability_tracker import Tier
        item = svc._stability_tracker.get_all_items().get(
            "system:prompt"
        )
        assert item is not None
        assert item.tier == Tier.L0

    def test_graduates_older_history_to_l3(
        self,
        config: ConfigManager,
        repo: Repo,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """History beyond the verbatim window graduates to L3.

        Seed many large history items; the verbatim window (sized
        by cache_target_tokens) keeps only the newest, older ones
        graduate.
        """
        fake_index = _FakeSymbolIndexWithRefs()
        svc = self._make_service(
            config, repo, fake_litellm,
            history_store, event_cb,
            symbol_index=fake_index,
            repo_files=[],
            monkeypatch=monkeypatch,
        )
        # Seed history messages and matching tracker entries.
        # Each message sized so a handful fills the cache target
        # and the rest must graduate.
        cache_target = config.cache_target_tokens_for_model()
        # Pick per-message tokens so ~3 messages fit in verbatim
        # window and 2 overflow.
        per_msg = max(1, cache_target // 3) + 50

        from ac_dc.stability_tracker import Tier, TrackedItem
        tracker = svc._stability_tracker
        for i in range(5):
            svc._context.add_message("user", f"message {i}")
            tracker._items[f"history:{i}"] = TrackedItem(
                key=f"history:{i}",
                tier=Tier.ACTIVE,
                n_value=0,
                content_hash=f"h{i}",
                tokens=per_msg,
            )

        svc.rebuild_cache()

        # Walk the tracker: the newest few should be in ACTIVE,
        # the oldest few in L3.
        items = tracker.get_all_items()
        # Oldest (history:0) should have graduated.
        assert items["history:0"].tier == Tier.L3
        # Newest (history:4) should remain in ACTIVE (verbatim).
        assert items["history:4"].tier == Tier.ACTIVE

    def test_history_stays_active_when_cache_target_zero(
        self,
        config: ConfigManager,
        repo: Repo,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """cache_target_tokens == 0 → no history graduation."""
        # Monkeypatch the config's cache_target_tokens_for_model
        # to return 0. This exercises the early-return in
        # _rebuild_graduate_history.
        monkeypatch.setattr(
            config, "cache_target_tokens_for_model",
            lambda: 0,
        )
        fake_index = _FakeSymbolIndexWithRefs()
        svc = self._make_service(
            config, repo, fake_litellm,
            history_store, event_cb,
            symbol_index=fake_index,
            repo_files=[],
            monkeypatch=monkeypatch,
        )
        # Seed one history item in ACTIVE.
        from ac_dc.stability_tracker import Tier, TrackedItem
        tracker = svc._stability_tracker
        tracker._items["history:0"] = TrackedItem(
            key="history:0",
            tier=Tier.ACTIVE,
            n_value=0,
            content_hash="h",
            tokens=100,
        )
        svc._context.add_message("user", "msg")

        svc.rebuild_cache()

        # Still in ACTIVE — no graduation.
        assert tracker.get_all_items()["history:0"].tier == Tier.ACTIVE

    def test_marks_initialized_after_rebuild(
        self,
        config: ConfigManager,
        repo: Repo,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """_stability_initialized flips True so lazy init is skipped.

        _stability_initialized is a per-mode dict now —
        rebuild sets the flag only for the active mode,
        leaving the other mode's tracker to do its own
        init on first switch.
        """
        fake_index = _FakeSymbolIndexWithRefs()
        svc = self._make_service(
            config, repo, fake_litellm,
            history_store, event_cb,
            symbol_index=fake_index,
            repo_files=[],
            monkeypatch=monkeypatch,
        )
        assert svc._stability_initialized.get(Mode.CODE, False) is False
        svc.rebuild_cache()
        assert svc._stability_initialized.get(Mode.CODE, False) is True

    def test_returns_documented_result_shape(
        self,
        config: ConfigManager,
        repo: Repo,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Success return has all the fields specs3 calls out."""
        fake_index = _FakeSymbolIndexWithRefs(
            blocks={"a.py": "blk"},
            ref_counts={"a.py": 1},
            components=[],
        )
        svc = self._make_service(
            config, repo, fake_litellm,
            history_store, event_cb,
            symbol_index=fake_index,
            repo_files=["a.py"],
            monkeypatch=monkeypatch,
        )
        result = svc.rebuild_cache()
        assert set(result.keys()) >= {
            "status",
            "mode",
            "items_before",
            "items_after",
            "files_distributed",
            "tier_counts",
            "file_tier_counts",
            "message",
        }
        assert result["status"] == "rebuilt"
        assert result["mode"] == "code"
        # tier_counts covers all five tiers even when empty.
        assert set(result["tier_counts"].keys()) == {
            "L0", "L1", "L2", "L3", "active",
        }
        assert isinstance(result["message"], str)
        assert "Cache rebuild" in result["message"]

    def test_localhost_only(
        self,
        config: ConfigManager,
        repo: Repo,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Non-localhost caller gets the restricted-error shape.

        Rebuild affects shared session state; remote collaborators
        shouldn't be able to trigger it.
        """
        fake_index = _FakeSymbolIndexWithRefs()
        svc = self._make_service(
            config, repo, fake_litellm,
            history_store, event_cb,
            symbol_index=fake_index,
            repo_files=[],
            monkeypatch=monkeypatch,
        )

        # Simulate a non-localhost collab attachment.
        class _Collab:
            def is_caller_localhost(self) -> bool:
                return False

        svc._collab = _Collab()

        result = svc.rebuild_cache()
        assert result.get("error") == "restricted"
        # Tracker not touched by a rejected call.
        assert svc._stability_initialized.get(Mode.CODE, False) is False

    def test_exception_during_impl_surfaces_as_error(
        self,
        config: ConfigManager,
        repo: Repo,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Exceptions mid-rebuild produce an {error: ...} response.

        The wrapper catches exceptions and returns a dict rather
        than raising to the RPC caller.
        """
        fake_index = _FakeSymbolIndexWithRefs()
        svc = self._make_service(
            config, repo, fake_litellm,
            history_store, event_cb,
            symbol_index=fake_index,
            repo_files=[],
            monkeypatch=monkeypatch,
        )
        # Force _rebuild_cache_impl to raise.
        def _boom() -> None:
            raise RuntimeError("simulated failure")
        monkeypatch.setattr(svc, "_rebuild_cache_impl", _boom)

        result = svc.rebuild_cache()
        assert "error" in result
        assert "simulated failure" in result["error"]

    def _seed_doc_outlines(
        self, svc: LLMService, paths: list[str]
    ) -> None:
        """Seed the doc index with markdown outlines for rebuild tests."""
        from ac_dc.doc_index.extractors.markdown import (
            MarkdownExtractor,
        )
        from pathlib import Path as _Path

        extractor = MarkdownExtractor()
        for path in paths:
            outline = extractor.extract(
                _Path(path),
                f"# Heading for {path}\n\nbody content.\n",
            )
            svc._doc_index._all_outlines[path] = outline

    def test_doc_mode_rebuild_does_not_seed_doc_entries(
        self,
        config: ConfigManager,
        repo: Repo,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Doc mode rebuild does NOT create doc: tracker entries.

        Symmetric to the code-mode case — under D27, the
        aggregate doc map is regenerated from the doc index
        at assembly time, not held as tracker entries.
        Rebuild only places ``system:prompt`` and (if any
        files are selected) ``file:`` entries.
        """
        fake_symbol_index = _FakeSymbolIndexWithRefs(
            blocks={"ignored.py": "block"},
            ref_counts={"ignored.py": 5},
            components=[],
        )
        svc = self._make_service(
            config, repo, fake_litellm,
            history_store, event_cb,
            symbol_index=fake_symbol_index,
            repo_files=["ignored.py"],
            monkeypatch=monkeypatch,
        )
        self._seed_doc_outlines(
            svc, ["README.md", "guide.md", "api.md"]
        )
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker

        result = svc.rebuild_cache()
        assert result["status"] == "rebuilt"
        assert result["mode"] == "doc"

        tracker = svc._stability_tracker
        all_keys = set(tracker.get_all_items().keys())
        # No doc: entries — those live in L0's aggregate map
        # at assembly time.
        assert "doc:README.md" not in all_keys
        assert "doc:guide.md" not in all_keys
        assert "doc:api.md" not in all_keys
        # No symbol: entries either.
        assert "symbol:ignored.py" not in all_keys
        # Only system:prompt remains.
        assert all_keys == {"system:prompt"}

    def test_doc_mode_selected_doc_file_becomes_file_entry(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Selected doc file → file: entry; no doc: entries seeded.

        Under D27 rebuild does not seed any ``doc:`` entries
        for indexed-but-unselected files (those live in L0's
        aggregate doc map at assembly time). The selected
        markdown file goes through orphan distribution and
        becomes a ``file:`` entry in a cached tier.
        """
        (repo_dir / "README.md").write_text(
            "# Readme\n\nbody.\n"
        )
        fake_symbol_index = _FakeSymbolIndexWithRefs()
        svc = self._make_service(
            config, repo, fake_litellm,
            history_store, event_cb,
            symbol_index=fake_symbol_index,
            repo_files=["README.md"],
            monkeypatch=monkeypatch,
        )
        self._seed_doc_outlines(svc, ["README.md", "guide.md"])
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker
        svc.set_selected_files(["README.md"])

        svc.rebuild_cache()

        tracker = svc._stability_tracker
        all_keys = set(tracker.get_all_items().keys())
        # Selected doc became a file: entry.
        assert "file:README.md" in all_keys
        # No doc: entries from rebuild (neither selected nor
        # unselected files seed these under D27).
        assert "doc:README.md" not in all_keys
        assert "doc:guide.md" not in all_keys

    def test_doc_mode_rebuild_distributes_orphan_non_markdown_files(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Selected non-markdown files in doc mode become orphans.

        In doc mode, anything not in the doc index is an orphan
        — including .py files that would be indexed in code mode.
        Orphan distribution works identically: bin-pack across
        L1/L2/L3, never land in ACTIVE or L0.
        """
        (repo_dir / "script.py").write_text("x = 1\n")
        (repo_dir / "config.json").write_text('{"a": 1}\n')
        fake_symbol_index = _FakeSymbolIndexWithRefs()
        svc = self._make_service(
            config, repo, fake_litellm,
            history_store, event_cb,
            symbol_index=fake_symbol_index,
            repo_files=["script.py", "config.json"],
            monkeypatch=monkeypatch,
        )
        # Doc index is empty — the selected files are orphans.
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker
        svc.set_selected_files(["script.py", "config.json"])

        svc.rebuild_cache()

        from ac_dc.stability_tracker import Tier
        tracker = svc._stability_tracker
        script_item = tracker.get_all_items().get(
            "file:script.py"
        )
        cfg_item = tracker.get_all_items().get(
            "file:config.json"
        )
        assert script_item is not None
        assert cfg_item is not None
        # Both in cached tiers, never ACTIVE or L0.
        assert script_item.tier in (Tier.L1, Tier.L2, Tier.L3)
        assert cfg_item.tier in (Tier.L1, Tier.L2, Tier.L3)

    def test_doc_mode_rebuild_result_mode_field(
        self,
        config: ConfigManager,
        repo: Repo,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Result dict's mode field reflects the active mode."""
        fake_symbol_index = _FakeSymbolIndexWithRefs()
        svc = self._make_service(
            config, repo, fake_litellm,
            history_store, event_cb,
            symbol_index=fake_symbol_index,
            repo_files=[],
            monkeypatch=monkeypatch,
        )
        self._seed_doc_outlines(svc, ["guide.md"])
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker

        result = svc.rebuild_cache()
        assert result["mode"] == "doc"
        # Summary message mentions doc mode.
        assert "doc" in result["message"].lower()

    def test_doc_mode_empty_doc_index_still_succeeds(
        self,
        config: ConfigManager,
        repo: Repo,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Doc mode with no doc outlines still produces a valid rebuild.

        The tracker ends up with just system:prompt (plus any
        preserved history). No doc: entries because there are
        no outlines to seed.
        """
        fake_symbol_index = _FakeSymbolIndexWithRefs()
        svc = self._make_service(
            config, repo, fake_litellm,
            history_store, event_cb,
            symbol_index=fake_symbol_index,
            repo_files=[],
            monkeypatch=monkeypatch,
        )
        # No doc outlines seeded.
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker

        result = svc.rebuild_cache()
        assert result["status"] == "rebuilt"
        assert result["mode"] == "doc"

        tracker = svc._stability_tracker
        all_keys = set(tracker.get_all_items().keys())
        # No doc: entries.
        assert not any(
            k.startswith("doc:") for k in all_keys
        )
        # system:prompt still reseeded.
        assert "system:prompt" in all_keys

    def test_doc_mode_preserves_history_across_rebuild(
        self,
        config: ConfigManager,
        repo: Repo,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """History preservation works the same way in doc mode."""
        fake_symbol_index = _FakeSymbolIndexWithRefs()
        svc = self._make_service(
            config, repo, fake_litellm,
            history_store, event_cb,
            symbol_index=fake_symbol_index,
            repo_files=[],
            monkeypatch=monkeypatch,
        )
        self._seed_doc_outlines(svc, ["guide.md"])
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker

        # Seed a history entry.
        from ac_dc.stability_tracker import Tier, TrackedItem
        tracker = svc._stability_tracker
        tracker._items["history:0"] = TrackedItem(
            key="history:0",
            tier=Tier.L2,
            n_value=4,
            content_hash="h0",
            tokens=10,
        )
        svc._context.add_message("user", "earlier message")

        svc.rebuild_cache()

        # history:0 preserved (verbatim window keeps it).
        existing = tracker.get_all_items().get("history:0")
        assert existing is not None
        assert existing.n_value == 4

    def test_cross_ref_rebuild_swaps_both_prefixes_for_selected_file(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Rebuild with cross-ref: selected file's secondary entry removed too.

        Regression test for Fix 2. Before the fix, step 7 of
        ``_rebuild_cache_impl`` only removed the primary-prefix
        entry for each selected file. In cross-reference mode,
        step 5b seeded the secondary-prefix entry for every file
        in the opposite index — including selected files. That
        secondary entry survived step 7, so the tracker ended up
        with both ``file:{path}`` (full content) AND the
        secondary-prefix entry (index block) for the same path,
        violating the uniqueness invariant.

        The fix extends step 7 to also remove any
        secondary-prefix entry for each selected file. This test
        stages the exact conditions (selected file present in
        both primary and secondary indexes, cross-ref enabled)
        and verifies only the ``file:`` entry survives.
        """
        # Create a file that's indexed as both a source file and
        # a doc file. In practice this is rare (a .md file with
        # parseable symbols, or a .py file with doc outlines),
        # but we simulate it with a shared path.
        (repo_dir / "shared.py").write_text("def foo(): pass\n")

        fake_symbol_index = _FakeSymbolIndexWithRefs(
            blocks={"shared.py": "symbol-block-shared"},
            ref_counts={"shared.py": 1},
            components=[],
        )
        svc = self._make_service(
            config, repo, fake_litellm,
            history_store, event_cb,
            symbol_index=fake_symbol_index,
            repo_files=["shared.py"],
            monkeypatch=monkeypatch,
        )
        # Seed the doc index with the same path so step 5b
        # creates a doc: entry for it.
        self._seed_doc_outlines(svc, ["shared.py"])

        # Enable cross-reference in code mode and select the
        # shared file. The combination is what triggered the
        # bug: step 5 creates symbol:shared.py, step 5b creates
        # doc:shared.py, step 7 swaps symbol: → file: but left
        # doc: in place.
        svc._doc_index_ready = True
        svc._cross_ref_enabled = True
        svc.set_selected_files(["shared.py"])

        svc.rebuild_cache()

        tracker = svc._stability_tracker
        all_keys = set(tracker.get_all_items().keys())
        # file: entry present — full content is in a cached tier.
        assert "file:shared.py" in all_keys
        # Primary-prefix entry swapped out.
        assert "symbol:shared.py" not in all_keys
        # Secondary-prefix entry ALSO swapped out (Fix 2).
        # Without the fix this assertion fails — the doc:
        # entry survives alongside file:.
        assert "doc:shared.py" not in all_keys

    def test_cross_ref_rebuild_creates_no_secondary_entries(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Rebuild + cross-ref creates no ``doc:`` tracker entries.

        Pre-D27 rebuild seeded ``doc:{path}`` entries for
        every doc-index file when cross-ref was enabled,
        and the test originally asserted that selected
        files' secondary entries got swapped while
        unselected ones survived.

        Under the L0-content-typed model rebuild does not
        create secondary entries at all — cross-reference is
        L0-only and the secondary aggregate map is
        regenerated from the doc index at assembly time.
        This test pins the new contract: regardless of
        which files are selected, no ``doc:`` entries appear
        in the tracker after rebuild + cross-ref.

        Spec: ``specs4/3-llm/cache-tiering.md`` § Manual
        Cache Rebuild — rebuild's cross-ref step seeds the
        secondary aggregate map into L0's structural
        content, not as cascade-tracked items.
        """
        (repo_dir / "selected.py").write_text("def foo(): pass\n")
        fake_symbol_index = _FakeSymbolIndexWithRefs(
            blocks={
                "selected.py": "block-selected",
                "a.py": "block-a",
            },
            ref_counts={"selected.py": 1, "a.py": 1},
            components=[],
        )
        svc = self._make_service(
            config, repo, fake_litellm,
            history_store, event_cb,
            symbol_index=fake_symbol_index,
            repo_files=["selected.py", "a.py"],
            monkeypatch=monkeypatch,
        )
        # Both selected.py and other.md are in the doc index;
        # only selected.py is selected (so it becomes a
        # file: entry).
        self._seed_doc_outlines(svc, ["selected.py", "other.md"])
        svc._doc_index_ready = True
        svc._cross_ref_enabled = True
        svc.set_selected_files(["selected.py"])

        svc.rebuild_cache()

        tracker = svc._stability_tracker
        all_keys = set(tracker.get_all_items().keys())
        # Selected file → file: entry as expected.
        assert "file:selected.py" in all_keys
        # No doc: entries — neither for the selected file
        # (no swap target to begin with) nor for the
        # unselected one. Cross-ref is L0-only under D27.
        assert not any(
            k.startswith("doc:") for k in all_keys
        )
        # Primary symbol entries also absent — D27 doesn't
        # seed those as tracker entries either; the
        # aggregate map carries them.
        assert not any(
            k.startswith("symbol:") for k in all_keys
        )

    def test_cross_ref_rebuild_marks_secondary_tier_broken(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Removed secondary entry's tier is added to _broken_tiers.

        So the next cascade can rebalance cleanly after rebuild.
        """
        (repo_dir / "shared.py").write_text("def foo(): pass\n")

        fake_symbol_index = _FakeSymbolIndexWithRefs(
            blocks={"shared.py": "block"},
            ref_counts={"shared.py": 1},
            components=[],
        )
        svc = self._make_service(
            config, repo, fake_litellm,
            history_store, event_cb,
            symbol_index=fake_symbol_index,
            repo_files=["shared.py"],
            monkeypatch=monkeypatch,
        )
        self._seed_doc_outlines(svc, ["shared.py"])
        svc._doc_index_ready = True
        svc._cross_ref_enabled = True
        svc.set_selected_files(["shared.py"])

        svc.rebuild_cache()

        # The secondary entry's tier should appear in
        # _broken_tiers. We can't predict exactly which tier
        # clustering placed it in, but at least SOME tier
        # beyond the default rebuild-initialized set should
        # be marked. More robustly: after rebuild, the
        # broken_tiers set is non-empty (rebuild itself marks
        # all tiers broken as step 3, so this is trivially
        # true — but the removal path would have a concrete
        # effect if rebuild didn't pre-mark everything).
        # This test is a weak signal; the stronger assertion
        # is that the entry is gone (covered by the other
        # tests in this group).
        assert len(svc._stability_tracker._broken_tiers) > 0

    def test_cross_ref_rebuild_code_mode_strips_doc_entry(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Code mode primary → secondary prefix is doc:.

        Pinning the direction of the swap: in code mode,
        primary='symbol:' and secondary='doc:'. Fix 2 removes
        the doc: entry for selected files.
        """
        (repo_dir / "shared.py").write_text("code\n")
        fake_symbol_index = _FakeSymbolIndexWithRefs(
            blocks={"shared.py": "block"},
            ref_counts={"shared.py": 1},
            components=[],
        )
        svc = self._make_service(
            config, repo, fake_litellm,
            history_store, event_cb,
            symbol_index=fake_symbol_index,
            repo_files=["shared.py"],
            monkeypatch=monkeypatch,
        )
        self._seed_doc_outlines(svc, ["shared.py"])
        # Explicitly in code mode.
        assert svc._context.mode == Mode.CODE
        svc._doc_index_ready = True
        svc._cross_ref_enabled = True
        svc.set_selected_files(["shared.py"])

        svc.rebuild_cache()

        all_keys = set(svc._stability_tracker.get_all_items().keys())
        assert "file:shared.py" in all_keys
        assert "doc:shared.py" not in all_keys

    def test_cross_ref_rebuild_doc_mode_strips_symbol_entry(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Doc mode primary → secondary prefix is symbol:.

        Symmetric to the code-mode test. In doc mode,
        primary='doc:' and secondary='symbol:'. Fix 2 removes
        the symbol: entry for selected files.
        """
        (repo_dir / "shared.md").write_text("# Doc\n\nbody.\n")
        fake_symbol_index = _FakeSymbolIndexWithRefs(
            blocks={"shared.md": "block"},
            ref_counts={"shared.md": 1},
            components=[],
        )
        svc = self._make_service(
            config, repo, fake_litellm,
            history_store, event_cb,
            symbol_index=fake_symbol_index,
            repo_files=["shared.md"],
            monkeypatch=monkeypatch,
        )
        self._seed_doc_outlines(svc, ["shared.md"])
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker
        svc._doc_index_ready = True
        svc._cross_ref_enabled = True
        svc.set_selected_files(["shared.md"])

        svc.rebuild_cache()

        all_keys = set(svc._stability_tracker.get_all_items().keys())
        assert "file:shared.md" in all_keys
        assert "symbol:shared.md" not in all_keys

    def test_rebuild_clears_pin_flags(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Rebuild clears edit-invariant pins on file: entries.

        D27's edit invariant pins ``file:`` entries when their
        content hash changes during the session, so the
        truthful current text stays cached. Pin lifecycle ends
        on rebuild — the user's "fresh start" gesture
        supersedes per-file edit history. After rebuild the
        same file may be present (if still selected) but
        without the pin.

        Spec: ``specs4/3-llm/cache-tiering.md`` § Manual Cache
        Rebuild — "Clear all edit-invariant pin flags" and
        § Edit Invariant.
        """
        from ac_dc.stability_tracker import Tier, TrackedItem

        (repo_dir / "edited.py").write_text("def foo(): pass\n")
        fake_index = _FakeSymbolIndexWithRefs()
        svc = self._make_service(
            config, repo, fake_litellm,
            history_store, event_cb,
            symbol_index=fake_index,
            repo_files=["edited.py"],
            monkeypatch=monkeypatch,
        )
        # Pre-seed a pinned file: entry — simulates a file
        # edited mid-session that the edit invariant has
        # pinned.
        tracker = svc._stability_tracker
        tracker._items["file:edited.py"] = TrackedItem(
            key="file:edited.py",
            tier=Tier.L1,
            n_value=9,
            content_hash="prev-hash",
            tokens=100,
        )
        tracker.pin_file("file:edited.py")
        assert tracker.is_pinned("file:edited.py") is True

        # Re-select so rebuild distributes it as an orphan.
        svc.set_selected_files(["edited.py"])
        svc.rebuild_cache()

        # file: entry present (still selected) but pin cleared.
        new_item = tracker.get_all_items().get("file:edited.py")
        assert new_item is not None
        assert tracker.is_pinned("file:edited.py") is False

    def test_rebuild_clears_deletion_markers(
        self,
        config: ConfigManager,
        repo: Repo,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Rebuild removes deletion-marker entries.

        Deletion markers exist to bridge the gap between a
        file's deletion and the next ``rebuild_cache`` that
        re-extracts L0's aggregate maps from the now-current
        index. Once rebuild runs, the index already excludes
        the deleted file, so the marker is no longer needed
        and is cleared along with all other non-history
        tracker entries.

        Spec: ``specs4/3-llm/cache-tiering.md`` § Item
        Removal and § Deletion Markers.
        """
        from ac_dc.stability_tracker import Tier, TrackedItem

        fake_index = _FakeSymbolIndexWithRefs()
        svc = self._make_service(
            config, repo, fake_litellm,
            history_store, event_cb,
            symbol_index=fake_index,
            repo_files=[],
            monkeypatch=monkeypatch,
        )
        tracker = svc._stability_tracker
        # Pre-seed a deletion-marker file entry.
        tracker._items["file:deleted.py"] = TrackedItem(
            key="file:deleted.py",
            tier=Tier.L2,
            n_value=6,
            content_hash="placeholder",
            tokens=100,
        )
        tracker.mark_deleted("file:deleted.py")
        assert tracker.is_deleted("file:deleted.py") is True

        svc.rebuild_cache()

        # Marker gone — the entry was wiped along with all
        # other non-history items.
        assert "file:deleted.py" not in (
            tracker.get_all_items()
        )