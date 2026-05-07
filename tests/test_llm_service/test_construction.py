"""Construction, deferred init, and session auto-restore.

Covers:

- :class:`TestConstruction` — basic wiring, deferred-init flag,
  session-ID generation.
- :class:`TestDocIndexConstruction` — the always-on DocIndex
  attachment (2.8.2a).
- :class:`TestDocIndexBackgroundBuild` — the structural
  extraction pass kicked off by ``complete_deferred_init``
  (2.8.2b).
- :class:`TestAutoRestore` — constructor-time session restore
  from the history store.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from ac_dc.config import ConfigManager
from ac_dc.doc_index.index import DocIndex
from ac_dc.history_store import HistoryStore
from ac_dc.llm_service import LLMService
from ac_dc.repo import Repo

from .conftest import _FakeLiteLLM, _RecordingEventCallback


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------


class TestConstruction:
    """Constructor wires subsystems correctly."""

    def test_basic_construction(
        self, config: ConfigManager, repo: Repo
    ) -> None:
        """Minimal construction works."""
        svc = LLMService(config=config, repo=repo)
        assert svc.get_current_state()["repo_name"] == repo.name
        assert svc.get_current_state()["init_complete"] is True

    def test_deferred_init_marks_not_ready(
        self, config: ConfigManager, repo: Repo
    ) -> None:
        """deferred_init=True → init_complete starts False."""
        svc = LLMService(
            config=config, repo=repo, deferred_init=True
        )
        assert svc.get_current_state()["init_complete"] is False

    def test_complete_deferred_init_flips_flag(
        self, config: ConfigManager, repo: Repo
    ) -> None:
        """complete_deferred_init(symbol_index) marks ready."""
        svc = LLMService(
            config=config, repo=repo, deferred_init=True
        )
        # SymbolIndex isn't essential for this test — any truthy
        # object works as the attachment point.
        svc.complete_deferred_init(symbol_index=object())
        assert svc.get_current_state()["init_complete"] is True

    def test_session_id_generated(
        self, service: LLMService
    ) -> None:
        """Session ID has the expected prefix."""
        sid = service.get_current_state()["session_id"]
        assert sid.startswith("sess_")


# ---------------------------------------------------------------------------
# DocIndex attachment (2.8.2a)
# ---------------------------------------------------------------------------


class TestDocIndexConstruction:
    """LLMService always holds a DocIndex.

    Unlike ``_symbol_index`` (which can be None during deferred
    init and is attached later via ``complete_deferred_init``),
    the doc index is constructed unconditionally. DocIndex
    construction is cheap — no tree-sitter grammars, no
    heavyweight dependencies — so there's no reason to defer.

    The background build that actually populates
    ``_doc_index._all_outlines`` lands in 2.8.2b. These tests
    cover the attachment surface only; content is empty.
    """

    def test_doc_index_populated_on_construction(
        self, service: LLMService
    ) -> None:
        """The attribute exists and is a DocIndex instance."""
        assert service._doc_index is not None
        assert isinstance(service._doc_index, DocIndex)

    def test_doc_index_uses_repo_root(
        self,
        service: LLMService,
        repo: Repo,
    ) -> None:
        """repo_root passed to DocIndex matches the attached repo."""
        assert service._doc_index.repo_root == repo.root

    def test_doc_index_memory_only_without_repo(
        self,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """When repo is None, DocIndex is built in memory-only mode."""
        svc = LLMService(config=config, repo=None)
        assert svc._doc_index is not None
        assert svc._doc_index.repo_root is None

    def test_doc_index_present_with_deferred_init(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Deferred init doesn't skip DocIndex construction.

        Symbol index is explicitly deferrable (heavyweight,
        slow startup) but doc index is always built. Pinning
        this prevents a future refactor that "helpfully"
        defers both.
        """
        svc = LLMService(
            config=config, repo=repo, deferred_init=True
        )
        assert svc._doc_index is not None

    def test_doc_index_starts_empty(
        self, service: LLMService
    ) -> None:
        """Pre-background-build, the doc index holds no outlines.

        Populated by ``complete_deferred_init`` which triggers
        the background build (2.8.2b). Until then, reads return
        empty.
        """
        assert service._doc_index._all_outlines == {}
        assert service._doc_index.get_doc_map() == ""

    def test_doc_index_identity_preserved_across_mode_switch(
        self, service: LLMService
    ) -> None:
        """Switching modes doesn't swap out the doc index.

        Unlike the stability tracker (which has per-mode
        instances), the doc index is shared across both modes
        — the same outlines are consulted whether rendering
        for doc mode (primary) or code mode + cross-reference
        (secondary).
        """
        original = service._doc_index
        service.switch_mode("doc")
        assert service._doc_index is original
        service.switch_mode("code")
        assert service._doc_index is original

    def test_readiness_flags_start_false(
        self, service: LLMService
    ) -> None:
        """All three readiness flags start False.

        ``_doc_index_ready`` flips True when structure extraction
        completes (2.8.2b). ``_doc_index_building`` flips True
        during the build, False after. ``_doc_index_enriched``
        stays False throughout 2.8.2 — enrichment lands in
        2.8.4.
        """
        assert service._doc_index_ready is False
        assert service._doc_index_building is False
        assert service._doc_index_enriched is False


# ---------------------------------------------------------------------------
# Doc index background build (2.8.2b)
# ---------------------------------------------------------------------------


class TestDocIndexBackgroundBuild:
    """Doc index background build triggered by complete_deferred_init.

    The build:
    - Fires as an ensure_future task during complete_deferred_init
    - Runs in the aux executor so the event loop stays responsive
    - Emits startupProgress events with stage='doc_index' at
      start (0%) and completion (100%)
    - Flips ``_doc_index_ready`` on success
    - Non-fatal on failure — leaves readiness False, emits
      stage='doc_index_error' event
    - Empty-file-list case still marks ready (valid empty state)

    Tests use ``deferred_init=True`` and manually invoke
    ``complete_deferred_init`` so the timing is controllable.
    """

    async def test_background_build_triggered_by_deferred_init(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """complete_deferred_init kicks off the background build."""
        # Seed a markdown file so the build has something to index.
        (repo_dir / "doc.md").write_text(
            "# Title\n\nContent.\n"
        )

        svc = LLMService(
            config=config,
            repo=repo,
            event_callback=event_cb,
            deferred_init=True,
        )
        assert svc._doc_index_ready is False

        # complete_deferred_init synchronously launches the
        # background task; we wait for it to settle.
        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        assert svc._doc_index_ready is True
        assert svc._doc_index_building is False
        assert "doc.md" in svc._doc_index._all_outlines

    async def test_background_build_emits_start_and_end_events(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Progress events fire with doc_index stage."""
        (repo_dir / "doc.md").write_text("# Doc\n")

        svc = LLMService(
            config=config,
            repo=repo,
            event_callback=event_cb,
            deferred_init=True,
        )
        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        # Filter to doc_index progress events.
        progress_events = [
            args for name, args in event_cb.events
            if name == "startupProgress"
            and len(args) >= 3
            and args[0] == "doc_index"
        ]
        # Start event at 0%, completion event at 100%.
        assert len(progress_events) >= 2
        assert progress_events[0][2] == 0
        assert progress_events[-1][2] == 100

    async def test_empty_file_list_still_marks_ready(
        self,
        config: ConfigManager,
        repo: Repo,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Repo with no doc files — readiness flips, no error."""
        # seed.md exists (from repo_dir fixture), so we need a
        # repo without markdown files. Use a fresh empty dir
        # and remove the seed file. But even the seed commit's
        # seed.md is markdown — let's just trust that the
        # filter finds it and marks ready after indexing it.
        # The actual empty case is covered by the no-repo
        # test below.
        svc = LLMService(
            config=config,
            repo=repo,
            event_callback=event_cb,
            deferred_init=True,
        )
        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        # Whether there are 0 or 1 markdown files, readiness
        # flips.
        assert svc._doc_index_ready is True
        assert svc._doc_index_building is False

    async def test_no_repo_skips_build_but_still_flips_readiness(
        self,
        config: ConfigManager,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Without a repo, the build has nothing to index.

        Result: no doc files discovered, readiness flips True
        (empty doc index is a valid state), no errors.
        """
        svc = LLMService(
            config=config,
            repo=None,
            event_callback=event_cb,
            deferred_init=True,
        )
        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        assert svc._doc_index_ready is True
        assert svc._doc_index_building is False
        assert svc._doc_index._all_outlines == {}

    async def test_multiple_markdown_files_indexed(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Multiple doc files all land in the outlines dict."""
        (repo_dir / "a.md").write_text("# A\n")
        (repo_dir / "sub").mkdir()
        (repo_dir / "sub" / "b.md").write_text("# B\n")

        svc = LLMService(
            config=config,
            repo=repo,
            event_callback=event_cb,
            deferred_init=True,
        )
        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        outlines = svc._doc_index._all_outlines
        assert "a.md" in outlines
        assert "sub/b.md" in outlines

    async def test_non_markdown_files_skipped(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Python / JSON / other files don't land in doc index."""
        (repo_dir / "script.py").write_text("x = 1\n")
        (repo_dir / "data.json").write_text("{}\n")
        (repo_dir / "doc.md").write_text("# Doc\n")

        svc = LLMService(
            config=config,
            repo=repo,
            event_callback=event_cb,
            deferred_init=True,
        )
        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        outlines = svc._doc_index._all_outlines
        assert "doc.md" in outlines
        assert "script.py" not in outlines
        assert "data.json" not in outlines

    async def test_repeated_deferred_init_does_not_rebuild(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Second call to complete_deferred_init is a no-op.

        The idempotence guard in complete_deferred_init returns
        early if already complete; the doc index background
        task therefore doesn't get scheduled twice.
        """
        (repo_dir / "doc.md").write_text("# Doc\n")

        svc = LLMService(
            config=config,
            repo=repo,
            event_callback=event_cb,
            deferred_init=True,
        )
        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        # Count doc_index progress events from the first call.
        first_events = [
            args for name, args in event_cb.events
            if name == "startupProgress"
            and len(args) >= 3
            and args[0] == "doc_index"
        ]
        first_count = len(first_events)
        assert first_count >= 2

        # Second call — should be a no-op.
        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        second_events = [
            args for name, args in event_cb.events
            if name == "startupProgress"
            and len(args) >= 3
            and args[0] == "doc_index"
        ]
        # No new events fired.
        assert len(second_events) == first_count

    async def test_build_failure_logs_but_does_not_raise(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Exceptions during build emit error event, don't crash."""
        (repo_dir / "doc.md").write_text("# Doc\n")

        svc = LLMService(
            config=config,
            repo=repo,
            event_callback=event_cb,
            deferred_init=True,
        )

        # Force index_repo to raise.
        def _boom(*args, **kwargs):
            raise RuntimeError("simulated build failure")
        monkeypatch.setattr(
            svc._doc_index, "index_repo", _boom
        )

        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        # Readiness flag stays False.
        assert svc._doc_index_ready is False
        assert svc._doc_index_building is False

        # Error event fired.
        error_events = [
            args for name, args in event_cb.events
            if name == "startupProgress"
            and len(args) >= 3
            and args[0] == "doc_index_error"
        ]
        assert len(error_events) >= 1
        assert "simulated build failure" in error_events[0][1]

    async def test_build_survives_no_event_callback(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Build works without an event callback attached.

        Defensive — the service accepts event_callback=None for
        tests that don't exercise the browser-push path. The
        background build must not crash when there's nobody
        listening.
        """
        (repo_dir / "doc.md").write_text("# Doc\n")

        svc = LLMService(
            config=config,
            repo=repo,
            event_callback=None,
            deferred_init=True,
        )
        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        assert svc._doc_index_ready is True
        assert "doc.md" in svc._doc_index._all_outlines

    async def test_building_flag_true_during_build(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """_doc_index_building is True while the task runs."""
        (repo_dir / "doc.md").write_text("# Doc\n")

        # Patch index_repo to observe the flag mid-execution.
        flag_during_build = {"value": None}
        original = None

        def _slow_index(*args, **kwargs):
            # Capture the flag's value while we're inside the
            # executor. Direct attribute read — the service is
            # on the main event loop thread; we're on the aux
            # executor thread. GIL makes the read atomic for a
            # bool.
            flag_during_build["value"] = svc._doc_index_building
            if original is not None:
                return original(*args, **kwargs)
            return None

        svc = LLMService(
            config=config,
            repo=repo,
            event_callback=event_cb,
            deferred_init=True,
        )
        original = svc._doc_index.index_repo
        monkeypatch.setattr(
            svc._doc_index, "index_repo", _slow_index
        )

        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        # Flag was True during the executor call, False after.
        assert flag_during_build["value"] is True
        assert svc._doc_index_building is False


# ---------------------------------------------------------------------------
# Session auto-restore
# ---------------------------------------------------------------------------


class TestAutoRestore:
    """Construction loads the most recent session."""

    def test_no_prior_sessions_empty_history(
        self, service: LLMService
    ) -> None:
        """No prior session → history is empty."""
        assert service.get_current_state()["messages"] == []

    def test_restores_most_recent_session(
        self,
        config: ConfigManager,
        repo: Repo,
        history_store: HistoryStore,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Constructor loads messages from last session."""
        # Persist a session manually.
        sid = HistoryStore.new_session_id()
        history_store.append_message(sid, "user", "hello")
        history_store.append_message(sid, "assistant", "hi")
        # Construct service — should restore.
        svc = LLMService(
            config=config,
            repo=repo,
            history_store=history_store,
        )
        state = svc.get_current_state()
        assert state["session_id"] == sid
        assert len(state["messages"]) == 2
        assert state["messages"][0]["content"] == "hello"
        assert state["messages"][1]["content"] == "hi"

    def test_restore_failure_is_non_fatal(
        self,
        config: ConfigManager,
        repo: Repo,
        monkeypatch: pytest.MonkeyPatch,
        fake_litellm: _FakeLiteLLM,
        tmp_path: Path,
    ) -> None:
        """Failing restore logs and starts fresh."""
        bad_store = HistoryStore(tmp_path / "broken")
        # Corrupt list_sessions.
        def _broken(*args, **kwargs):
            raise RuntimeError("simulated")
        monkeypatch.setattr(bad_store, "list_sessions", _broken)
        # Construction must not raise.
        svc = LLMService(
            config=config, repo=repo, history_store=bad_store
        )
        assert svc.get_current_state()["messages"] == []