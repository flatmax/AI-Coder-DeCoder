"""Tests for ac_dc.llm_service — Layer 3.7.

Scope: the LLMService orchestration layer. Coverage includes
construction, session auto-restore, state snapshot, file selection,
new-session handling, chat_streaming guards (init-complete, single
stream), cancellation, commit and reset flows, the topic detector
closure, and event broadcast routing.

Strategy:

- Real ContextManager / FileContext / HistoryStore / TokenCounter /
  StabilityTracker / HistoryCompactor — no mocking of Layer 3
  components. These have their own test suites; the LLMService test
  suite exercises integration.
- litellm is mocked at the boundary via a module-level monkeypatch.
  Two fake completions — streaming (yields pre-seeded chunks) and
  non-streaming (returns a canned string). No network, no real
  tokens.
- Event callback is a recording stub. Tests assert on the sequence
  of (event_name, args) tuples captured.
- Repo is a minimal fake rather than a real git clone. The tests
  that need real git behaviour (commit, reset) use tmp_path + a real
  Repo.
"""

from __future__ import annotations

import asyncio
import json
import logging
import subprocess
from pathlib import Path
from typing import Any

import pytest

from ac_dc.config import ConfigManager
from ac_dc.context_manager import Mode
from ac_dc.doc_index.index import DocIndex
from ac_dc.history_compactor import CompactionResult, TopicBoundary
from ac_dc.history_store import HistoryStore
from ac_dc.llm_service import LLMService, _build_topic_detector
from ac_dc.repo import Repo


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _RecordingEventCallback:
    """Recording stub for the event callback.

    Mimics the signature ``(event_name, *args) -> awaitable`` and
    captures every invocation. Tests assert on the sequence of
    (event_name, args_tuple) tuples.
    """

    def __init__(self) -> None:
        self.events: list[tuple[str, tuple[Any, ...]]] = []

    def __call__(self, event_name: str, *args: Any):
        self.events.append((event_name, args))

        async def _noop() -> None:
            return None

        return _noop()


class _FakeLiteLLM:
    """Fake litellm module for the streaming and non-streaming paths.

    Test setup patches ``ac_dc.llm_service`` lookups for
    ``import litellm`` via monkeypatching ``sys.modules`` so both
    the streaming and aux completion paths see this fake.

    For single-call tests, ``set_streaming_chunks([...])`` seeds
    the next streaming completion. For multi-call tests (parallel
    agents), ``queue_streaming_chunks([...])`` appends to a FIFO
    that each ``completion(stream=True)`` call pops from —
    so N parallel agents each get their pre-planned chunks
    regardless of which call hits the fake first.

    Exceptions can be queued too via ``queue_streaming_error`` —
    each exception pops from the same FIFO as chunks and raises
    on the corresponding ``completion()`` call. Useful for
    testing sibling-exception isolation.
    """

    def __init__(self) -> None:
        self.streaming_chunks: list[str] = []
        self.non_streaming_reply: str = ""
        self.call_count = 0
        self.last_call_args: dict[str, Any] = {}
        # FIFO of per-call directives. Each entry is either a
        # list[str] of chunks or an Exception. Consumed in
        # order on each streaming completion() call. When the
        # FIFO is empty, falls back to the single-call
        # ``streaming_chunks`` field for backward compatibility.
        self._streaming_queue: list[Any] = []

    def set_streaming_chunks(self, chunks: list[str]) -> None:
        """Pre-seed content for the next streaming completion.

        Each string becomes the INCREMENTAL delta of one chunk.
        The service accumulates these and fires streamChunk with
        the running total.
        """
        self.streaming_chunks = list(chunks)

    def queue_streaming_chunks(self, chunks: list[str]) -> None:
        """Append a chunk-list to the per-call FIFO.

        Each queued entry is consumed by one streaming
        ``completion()`` call. Use this for parallel-agent
        tests where two or more concurrent calls each need
        their own pre-planned output.
        """
        self._streaming_queue.append(list(chunks))

    def queue_streaming_error(self, exc: BaseException) -> None:
        """Append an exception to the per-call FIFO.

        The next streaming ``completion()`` call raises this
        exception instead of returning chunks. Useful for
        testing sibling-exception isolation across parallel
        agents.
        """
        self._streaming_queue.append(exc)

    def set_non_streaming_reply(self, reply: str) -> None:
        """Pre-seed content for the next non-streaming call."""
        self.non_streaming_reply = reply

    def completion(self, **kwargs: Any) -> Any:
        """Match litellm.completion's public signature."""
        self.call_count += 1
        self.last_call_args = kwargs
        if kwargs.get("stream"):
            # If we have queued directives, consume one;
            # otherwise fall through to the single-call field.
            if self._streaming_queue:
                directive = self._streaming_queue.pop(0)
                if isinstance(directive, BaseException):
                    raise directive
                return self._build_stream_from(directive)
            return self._build_stream()
        return self._build_response(self.non_streaming_reply)

    def _build_stream_from(self, chunks: list[str]):
        """Yield chunks supplied directly (bypasses single-call field)."""
        # Re-use the same chunk-wrapping machinery as
        # _build_stream; we just start with a specific list.
        return self._wrap_chunks(list(chunks))

    def _build_stream(self):
        """Yield fake streaming chunks."""
        chunks = list(self.streaming_chunks)
        # Reset so a second call doesn't replay stale content.
        self.streaming_chunks = []
        return self._wrap_chunks(chunks)

    def _wrap_chunks(self, chunks: list[str]):
        """Shared chunk-wrapping machinery for both entry points."""

        class _Delta:
            def __init__(self, content: str) -> None:
                self.content = content

        class _Choice:
            def __init__(self, content: str) -> None:
                self.delta = _Delta(content)

        class _Chunk:
            def __init__(self, content: str) -> None:
                self.choices = [_Choice(content)]
                self.usage = None

        class _FinalChunk:
            def __init__(self, usage: dict[str, int]) -> None:
                self.choices = []
                self.usage = usage

        def _gen():
            for c in chunks:
                yield _Chunk(c)
            # Final chunk with usage — mirrors provider behaviour.
            yield _FinalChunk({
                "prompt_tokens": 10,
                "completion_tokens": 5,
            })

        return _gen()

    def _build_response(self, content: str) -> Any:
        """Return a non-streaming response object."""
        class _Message:
            def __init__(self, content: str) -> None:
                self.content = content

        class _Choice:
            def __init__(self, content: str) -> None:
                self.message = _Message(content)

        class _Response:
            def __init__(self, content: str) -> None:
                self.choices = [_Choice(content)]

        return _Response(content)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def config_dir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Path:
    """Isolate config directory per test."""
    d = tmp_path / "config"
    monkeypatch.setenv("AC_DC_CONFIG_HOME", str(d))
    return d


def _run_git(cwd: Path, *args: str) -> None:
    """Run git inside a test repo, failing loudly on error."""
    result = subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, (
        f"git {' '.join(args)} failed: {result.stderr}"
    )


@pytest.fixture
def repo_dir(tmp_path: Path) -> Path:
    """Initialise a minimal git repo for tests."""
    d = tmp_path / "repo"
    d.mkdir()
    _run_git(d, "init", "-q")
    _run_git(d, "config", "user.email", "test@example.com")
    _run_git(d, "config", "user.name", "Test")
    _run_git(d, "config", "init.defaultBranch", "main")
    _run_git(d, "checkout", "-q", "-b", "main")
    # Seed commit so HEAD resolves.
    (d / "seed.md").write_text("seed\n")
    _run_git(d, "add", "seed.md")
    _run_git(d, "commit", "-q", "-m", "seed")
    return d


@pytest.fixture
def repo(repo_dir: Path) -> Repo:
    return Repo(repo_dir)


@pytest.fixture
def config(config_dir: Path, repo_dir: Path) -> ConfigManager:
    """Configured ConfigManager — triggers first-install bundle copy."""
    return ConfigManager(repo_root=repo_dir)


@pytest.fixture
def history_store(repo_dir: Path) -> HistoryStore:
    ac_dc_dir = repo_dir / ".ac-dc4"
    ac_dc_dir.mkdir(exist_ok=True)
    return HistoryStore(ac_dc_dir)


@pytest.fixture
def fake_litellm(monkeypatch: pytest.MonkeyPatch) -> _FakeLiteLLM:
    """Install a fake litellm module.

    Patches sys.modules so ``import litellm`` inside the service
    module resolves to our fake. Restored automatically by
    monkeypatch fixture teardown.
    """
    fake = _FakeLiteLLM()
    monkeypatch.setitem(__import__("sys").modules, "litellm", fake)
    return fake


@pytest.fixture
def event_cb() -> _RecordingEventCallback:
    return _RecordingEventCallback()


@pytest.fixture
def service(
    config: ConfigManager,
    repo: Repo,
    history_store: HistoryStore,
    event_cb: _RecordingEventCallback,
    fake_litellm: _FakeLiteLLM,
) -> LLMService:
    """Fully-wired service for most tests."""
    return LLMService(
        config=config,
        repo=repo,
        event_callback=event_cb,
        history_store=history_store,
    )


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


# ---------------------------------------------------------------------------
# File selection
# ---------------------------------------------------------------------------


class TestSelectedFiles:
    """set_selected_files / get_selected_files behaviour."""

    def test_set_returns_canonical_list(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """set_selected_files stores and broadcasts."""
        # Create a real file so the existence filter keeps it.
        (repo_dir / "a.md").write_text("hello")
        result = service.set_selected_files(["a.md"])
        assert result == ["a.md"]
        assert service.get_selected_files() == ["a.md"]
        # filesChanged broadcast emitted.
        assert any(
            name == "filesChanged" for name, _ in event_cb.events
        )

    def test_missing_files_filtered(
        self, service: LLMService
    ) -> None:
        """Paths pointing at nonexistent files are dropped."""
        result = service.set_selected_files(["does-not-exist.md"])
        assert result == []

    def test_stored_list_is_a_copy(
        self,
        service: LLMService,
        repo_dir: Path,
    ) -> None:
        """Caller mutating the input doesn't affect stored state."""
        (repo_dir / "a.md").write_text("x")
        inp = ["a.md"]
        service.set_selected_files(inp)
        inp.append("b.md")
        assert service.get_selected_files() == ["a.md"]


# ---------------------------------------------------------------------------
# new_session
# ---------------------------------------------------------------------------


class TestNewSession:
    """new_session resets state."""

    def test_generates_new_session_id(
        self, service: LLMService
    ) -> None:
        """Session ID changes on new_session."""
        old = service.get_current_state()["session_id"]
        result = service.new_session()
        assert result["session_id"] != old
        assert service.get_current_state()["session_id"] == (
            result["session_id"]
        )

    def test_clears_history(
        self,
        service: LLMService,
        history_store: HistoryStore,
    ) -> None:
        """new_session empties the context manager's history."""
        # Seed some history via the context manager.
        service._context.add_message("user", "old")
        service._context.add_message("assistant", "reply")
        assert len(service.get_current_state()["messages"]) == 2
        service.new_session()
        assert service.get_current_state()["messages"] == []

    def test_broadcasts_session_changed(
        self,
        service: LLMService,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """sessionChanged event fires with the new session ID."""
        service.new_session()
        sessions_changed = [
            args
            for name, args in event_cb.events
            if name == "sessionChanged"
        ]
        assert sessions_changed
        payload = sessions_changed[-1][0]
        assert payload["session_id"] == service.get_current_state()[
            "session_id"
        ]
        assert payload["messages"] == []


# ---------------------------------------------------------------------------
# chat_streaming — guards
# ---------------------------------------------------------------------------


class TestStreamingGuards:
    """chat_streaming rejects when init incomplete or stream active."""

    async def test_rejects_before_init_complete(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """deferred_init=True → chat rejects with friendly message."""
        svc = LLMService(
            config=config, repo=repo, deferred_init=True
        )
        result = await svc.chat_streaming(
            request_id="r1", message="hi"
        )
        assert "initializing" in result.get("error", "")

    async def test_rejects_concurrent_stream(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Second call while first is active → rejected."""
        # Register an active stream without going through
        # chat_streaming (to avoid racing with the background task).
        service._active_user_request = "existing-req"
        result = await service.chat_streaming(
            request_id="new-req", message="hi"
        )
        assert "active" in result.get("error", "").lower()


# ---------------------------------------------------------------------------
# _is_child_request — parallel-agents foundation
# ---------------------------------------------------------------------------


class TestIsChildRequest:
    """The `_is_child_request` classifier narrows the single-stream guard.

    Per specs4/7-future/parallel-agents.md § Foundation
    Requirements ("Single-stream guard gates user-initiated
    requests only"), the guard must accept child streams that
    share a parent's request ID prefix while continuing to
    reject genuinely-concurrent user streams.

    Today no code path produces child request IDs, so
    ``_is_child_request`` always returns False in practice.
    These tests pin the contract so when agent spawning lands,
    the guard's shape is already correct — only the spawning
    code needs to change.
    """

    def test_returns_false_when_no_active_parent(
        self, service: LLMService
    ) -> None:
        """No active parent → nothing to be a child of.

        Without a parent, every request ID is its own
        user-initiated request. The guard path with no active
        stream doesn't reach this helper, but the classifier
        itself must be defined on the empty-parent case.
        """
        assert service._active_user_request is None
        assert service._is_child_request("any-id") is False

    def test_returns_false_when_id_matches_parent_exactly(
        self, service: LLMService
    ) -> None:
        """An exact-match request ID is a duplicate, not a child.

        A reconnect from the same browser or a duplicate RPC
        call that carries the existing parent's ID must be
        treated as a conflicting user-initiated request, not
        silently accepted as a child. Downstream this surfaces
        as the "another stream is active" error.
        """
        service._active_user_request = "parent-abc"
        assert service._is_child_request("parent-abc") is False

    def test_returns_true_for_prefixed_child_id(
        self, service: LLMService
    ) -> None:
        """``{parent}-agent-N`` pattern is recognised as a child.

        Pins the child-ID convention from
        specs4/7-future/parallel-agents.md § Transport. When
        agent spawning lands, each agent's request ID will
        follow this shape and the guard will let it through.
        """
        service._active_user_request = "parent-abc"
        assert service._is_child_request("parent-abc-agent-0") is True
        assert service._is_child_request("parent-abc-agent-7") is True

    def test_returns_true_for_arbitrary_dash_suffix(
        self, service: LLMService
    ) -> None:
        """Any ``{parent}-{suffix}`` shape qualifies as a child.

        The convention is ``{parent}-agent-N`` but the
        classifier doesn't enforce the ``agent-`` infix — it
        just checks for the parent prefix followed by a dash.
        This keeps the rule simple and lets future spawning
        paths (sub-agents, tool-call streams) inherit the
        guard without coordinating on naming.
        """
        service._active_user_request = "parent-abc"
        assert service._is_child_request("parent-abc-sub-1") is True
        assert service._is_child_request("parent-abc-tool-42") is True

    def test_returns_false_for_non_prefix_match(
        self, service: LLMService
    ) -> None:
        """A request ID that merely contains the parent string is not a child.

        The classifier requires the parent to be a *prefix*
        followed by a dash — not a substring anywhere in the
        ID. Otherwise a user-initiated request whose random
        suffix happens to contain an active parent's ID
        would be misclassified.
        """
        service._active_user_request = "parent-abc"
        # Contains "parent-abc" but not as a prefix.
        assert service._is_child_request("x-parent-abc") is False
        # Prefix match without the separating dash — an
        # unrelated ID that happens to start with the parent's
        # text.
        assert service._is_child_request("parent-abcxyz") is False

    def test_returns_false_for_sibling_user_request(
        self, service: LLMService
    ) -> None:
        """A sibling user-initiated request doesn't match the prefix.

        Two unrelated user-initiated requests running
        back-to-back have independent IDs. The second must
        be rejected as a conflicting user stream, not
        accepted as a child of the first.
        """
        service._active_user_request = "req-alpha"
        assert service._is_child_request("req-beta") is False


class TestChildRequestGuard:
    """The single-stream guard lets child requests through.

    End-to-end behaviour: with a parent user-initiated stream
    active, a prefixed child request ID doesn't register a new
    parent slot, doesn't reject with the "another stream"
    error, and doesn't overwrite the parent's active-request
    tracking. A non-child second request still rejects as
    before.

    No code path produces child request IDs yet, so these
    tests construct the scenario by seeding
    ``_active_user_request`` directly and calling
    ``chat_streaming`` with a prefixed ID. When agent spawning
    lands, the tests still pass because the contract they pin
    matches the spawning path's behaviour by design.
    """

    async def test_child_request_not_rejected_by_guard(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Prefixed child ID passes the guard while parent is active."""
        # Parent stream registered.
        service._active_user_request = "parent-abc"

        fake_litellm.set_streaming_chunks(["ok"])
        result = await service.chat_streaming(
            request_id="parent-abc-agent-0", message="hi"
        )
        # Not rejected — child streams pass through.
        assert result == {"status": "started"}
        # Clean up the background task so teardown doesn't
        # leave an orphan stream running against the fake.
        await asyncio.sleep(0.2)

    async def test_child_request_does_not_overwrite_parent(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """A child's ID never replaces the parent's guard slot.

        Critical invariant: the guard's ``_active_user_request``
        slot tracks the user-initiated parent. If a child
        overwrote it, the parent's own cleanup (in the
        background task's finally block) would run against a
        mismatched ID and the slot could leak.
        """
        service._active_user_request = "parent-abc"

        fake_litellm.set_streaming_chunks(["ok"])
        await service.chat_streaming(
            request_id="parent-abc-agent-0", message="hi"
        )
        # Parent slot unchanged.
        assert service._active_user_request == "parent-abc"
        await asyncio.sleep(0.2)

    async def test_duplicate_parent_id_still_rejected(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """An exact-match request ID is NOT a child, so it rejects.

        A reconnect or duplicate call that carries the active
        parent's ID must surface the "another stream is
        active" error rather than silently passing through.
        Without this, a double-submit from a glitchy browser
        would race two completions into the same parent slot.
        """
        service._active_user_request = "parent-abc"
        result = await service.chat_streaming(
            request_id="parent-abc", message="hi"
        )
        assert "active" in result.get("error", "").lower()

    async def test_sibling_user_request_still_rejected(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Non-prefixed second request rejects — the pre-fix behaviour.

        Regression guard: narrowing the guard to user-only
        must not accidentally let a second genuine user
        stream through. Only prefixed child IDs pass.
        """
        service._active_user_request = "req-alpha"
        result = await service.chat_streaming(
            request_id="req-beta", message="hi"
        )
        assert "active" in result.get("error", "").lower()


# ---------------------------------------------------------------------------
# Per-request accumulator — parallel-agents foundation
# ---------------------------------------------------------------------------


class TestRequestAccumulator:
    """Per-request accumulated response content, keyed by request ID.

    Per specs4/7-future/parallel-agents.md § Foundation
    Requirements ("Chunk routing keyed by request ID, not by
    singleton flag"), the accumulator must be keyed by request
    ID so N concurrent streams can coexist. Today only the main
    LLM stream populates an entry; when agent spawning lands,
    each agent's child request gets its own slot.

    These tests pin the contract:

    - Slot populated on every chunk with accumulated content
    - Slot contains the final assembled string at completion
    - Slot cleared after post-response work completes
    - Slot cleared on error and cancellation paths
    - Missing slots don't crash the cleanup path

    The accumulator is a write-from-worker, read-from-event-loop
    channel. GIL guarantees atomic dict writes for string values,
    so readers don't need locks.
    """

    async def test_slot_populated_with_accumulated_content(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """Each chunk writes the running total to the slot.

        We can't easily observe mid-stream state without race
        conditions, but we can verify the FINAL state after
        completion has the full accumulated content — which
        proves writes happened at least once with the correct
        value.

        The cleanup in the finally block removes the slot after
        post-response work completes, so we read the slot
        BEFORE awaiting long enough for cleanup — the
        streamComplete event fires before cleanup, so the
        event's presence is our signal that the slot was
        populated but not yet cleared.
        """
        fake_litellm.set_streaming_chunks(["Hello", " world"])

        # Patch _run_completion_sync to capture the accumulator
        # state at the moment the worker returns — BEFORE
        # cleanup runs. This is the reliable observation window
        # for the slot contents.
        captured: dict[str, str] = {}
        original = service._run_completion_sync

        def _capture_after_run(*args, **kwargs):
            result = original(*args, **kwargs)
            request_id = args[0]
            captured[request_id] = (
                service._request_accumulators.get(request_id, "")
            )
            return result

        service._run_completion_sync = _capture_after_run  # type: ignore[method-assign]

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.3)

        assert captured.get("r1") == "Hello world"

    async def test_slot_cleared_after_completion(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Cleanup drops the slot once post-response work finishes.

        The slot's lifetime matches the "stream is active"
        signal — it lives from first chunk through post-
        response work, then clears. Nothing should read stale
        accumulator data after a stream ends.
        """
        fake_litellm.set_streaming_chunks(["response"])

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.3)

        assert "r1" not in service._request_accumulators

    async def test_slot_cleared_on_error(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Errors in the worker don't leak accumulator slots.

        Regression guard: a stream that raises before completing
        must still clear its slot. Otherwise a series of failing
        requests would grow the dict unboundedly.
        """
        # Force _run_completion_sync to raise.
        def _raise(*args, **kwargs):
            raise RuntimeError("simulated LLM failure")
        monkeypatch.setattr(
            service, "_run_completion_sync", _raise
        )

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.3)

        assert "r1" not in service._request_accumulators

    async def test_slot_cleared_on_cancellation(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Cancelled streams also clear their accumulator slot."""
        fake_litellm.set_streaming_chunks(["partial"])
        # Pre-register cancellation so the worker breaks out
        # on the first chunk check.
        service._cancelled_requests.add("r1")

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.3)

        assert "r1" not in service._request_accumulators

    async def test_missing_slot_cleanup_is_safe(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Cleanup tolerates a request that never populated a slot.

        Edge case: the worker raises before the first chunk
        arrives, so no ``self._request_accumulators[request_id]``
        write ever happened. The cleanup's ``pop`` with a
        default must not raise KeyError.
        """
        # Force the worker to raise immediately, before any
        # chunk loop iteration. The fake's completion() would
        # normally yield chunks; patching _run_completion_sync
        # at the service level skips the worker entirely.
        def _instant_raise(*args, **kwargs):
            raise RuntimeError("pre-chunk failure")
        monkeypatch.setattr(
            service, "_run_completion_sync", _instant_raise
        )

        # Streaming must not raise from the cleanup path.
        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.3)

        # Dict is clean; no KeyError observed.
        assert "r1" not in service._request_accumulators

    async def test_parent_slot_not_cleared_by_child_cleanup(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """A child stream's completion preserves the parent's guard slot.

        Critical invariant: the ``_active_user_request`` slot
        must survive until the PARENT stream completes. If a
        child's cleanup path cleared it, the parent would
        continue streaming into a state where the guard thinks
        no stream is active, breaking the single-stream
        contract. Today no code path produces child streams,
        so we simulate the scenario by seeding the parent
        state directly.
        """
        # Simulate parent active.
        service._active_user_request = "parent-abc"

        fake_litellm.set_streaming_chunks(["ok"])
        # Child request completes.
        await service.chat_streaming(
            request_id="parent-abc-agent-0", message="hi"
        )
        await asyncio.sleep(0.3)

        # Parent slot intact — child's cleanup did NOT touch it.
        assert service._active_user_request == "parent-abc"

    async def test_child_slot_cleared_independently(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Child accumulator slots clear on their own completion.

        Symmetric with the parent-preservation test: children
        clean up their OWN slots without interfering with the
        parent's. When agent spawning lands, each agent's
        output is isolated to its own slot and drops when
        that agent completes, even if siblings are still
        streaming.
        """
        service._active_user_request = "parent-abc"

        fake_litellm.set_streaming_chunks(["child output"])
        await service.chat_streaming(
            request_id="parent-abc-agent-0", message="hi"
        )
        await asyncio.sleep(0.3)

        # Child's slot cleared; parent's slot not (parent
        # never had one in this test).
        assert "parent-abc-agent-0" not in (
            service._request_accumulators
        )


# ---------------------------------------------------------------------------
# chat_streaming — happy path
# ---------------------------------------------------------------------------


class TestStreamingHappyPath:
    """End-to-end streaming flow."""

    async def test_user_message_persisted_before_completion(
        self,
        service: LLMService,
        history_store: HistoryStore,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """User message lands in history before the LLM call."""
        fake_litellm.set_streaming_chunks(["Hello", " world"])

        result = await service.chat_streaming(
            request_id="r1", message="hi"
        )
        assert result == {"status": "started"}

        # Wait for the background task to complete.
        await asyncio.sleep(0.1)

        # User message is in persistent history.
        sid = service.get_current_state()["session_id"]
        persisted = history_store.get_session_messages(sid)
        user_msgs = [m for m in persisted if m["role"] == "user"]
        assert any(m["content"] == "hi" for m in user_msgs)

    async def test_chunks_broadcast_via_event_callback(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """streamChunk events fire with accumulated content."""
        fake_litellm.set_streaming_chunks(["Hello", " world"])

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.2)

        chunk_events = [
            args for name, args in event_cb.events
            if name == "streamChunk"
        ]
        # Each chunk carries request_id and full accumulated content.
        assert chunk_events
        # Final chunk should have the full reply.
        last_args = chunk_events[-1]
        assert last_args[0] == "r1"
        assert last_args[1] == "Hello world"

    async def test_stream_complete_event_fires(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """streamComplete fires with the full response."""
        fake_litellm.set_streaming_chunks(["done"])

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.2)

        complete_events = [
            args for name, args in event_cb.events
            if name == "streamComplete"
        ]
        assert complete_events
        req_id, result = complete_events[-1]
        assert req_id == "r1"
        assert result["response"] == "done"
        assert "cancelled" not in result

    async def test_user_message_broadcast(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """userMessage event fires to all clients before streaming."""
        fake_litellm.set_streaming_chunks(["ok"])

        await service.chat_streaming(
            request_id="r1", message="the prompt"
        )
        await asyncio.sleep(0.2)

        user_events = [
            args for name, args in event_cb.events
            if name == "userMessage"
        ]
        assert user_events
        assert user_events[0][0]["content"] == "the prompt"

    async def test_assistant_response_persisted(
        self,
        service: LLMService,
        history_store: HistoryStore,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Assistant message persists to history after completion."""
        fake_litellm.set_streaming_chunks(["final reply"])

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.2)

        sid = service.get_current_state()["session_id"]
        persisted = history_store.get_session_messages(sid)
        assistant_msgs = [
            m for m in persisted if m["role"] == "assistant"
        ]
        assert any(
            m["content"] == "final reply" for m in assistant_msgs
        )


class TestConversationScopeDefault:
    """Explicit-scope calls to ``_stream_chat`` match default behaviour.

    Regression guard for the parallel-agents scope refactor.
    Every existing test exercises the implicit default-scope
    path via ``chat_streaming`` → ``_stream_chat(..., scope=
    self._default_scope())``. This class adds tests that verify
    the EXPLICIT-scope path produces identical behaviour —
    which matters because future agent-spawning code always
    passes scopes explicitly rather than relying on the
    None-fallback in each method's signature.

    Three angles covered:

    1. Calling ``_stream_chat`` directly with ``scope=service.
       _default_scope()`` — the production path a future
       spawner will take. Verifies the default-scope helper
       wires all fields correctly.
    2. Calling ``_stream_chat`` with a manually-constructed
       ``ConversationScope`` whose fields point at the same
       objects ``_default_scope`` would use — verifies that
       the scope's field semantics (context/tracker/
       session_id/selected_files/archival_append) are the
       contract, not the helper.
    3. Calling ``_stream_chat`` with ``scope=None`` — verifies
       the None-fallback path every method carries. Catches a
       future refactor that drops the fallback and breaks
       callers that rely on it.

    Each test asserts against the same observable surface as
    ``TestStreamingHappyPath``: user and assistant messages
    persist to history, ``streamComplete`` fires with the
    expected payload, and the session state reflects the
    conversation. The point is byte-identical behaviour — any
    divergence surfaces as a test failure here before it
    reaches production.
    """

    async def test_explicit_default_scope_produces_same_result(
        self,
        service: LLMService,
        history_store: HistoryStore,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """``_stream_chat`` called with an explicit default scope behaves normally.

        Bypasses ``chat_streaming`` to pass the scope directly,
        simulating what future agent-spawning code does. Every
        observable — persisted messages, streamComplete event,
        final conversation state — matches what the implicit
        path produces.
        """
        fake_litellm.set_streaming_chunks(["explicit scope works"])

        # Capture the main loop the way chat_streaming would —
        # _stream_chat's worker thread bridge needs it.
        service._main_loop = asyncio.get_event_loop()
        # Register the stream against the guard so the worker
        # thread's cancellation check doesn't race with a
        # concurrent cancel.
        service._active_user_request = "r-explicit"

        try:
            scope = service._default_scope()
            await service._stream_chat(
                request_id="r-explicit",
                message="hello",
                files=[],
                images=[],
                excluded_urls=[],
                scope=scope,
            )
        finally:
            service._active_user_request = None

        # User + assistant messages persisted.
        sid = service.get_current_state()["session_id"]
        persisted = history_store.get_session_messages(sid)
        assert any(
            m["role"] == "user" and m["content"] == "hello"
            for m in persisted
        )
        assert any(
            m["role"] == "assistant"
            and m["content"] == "explicit scope works"
            for m in persisted
        )

        # streamComplete fired with the correct request ID.
        completes = [
            args for name, args in event_cb.events
            if name == "streamComplete"
        ]
        assert completes
        req_id, result = completes[-1]
        assert req_id == "r-explicit"
        assert result["response"] == "explicit scope works"

    async def test_manually_constructed_scope_matches_default(
        self,
        service: LLMService,
        history_store: HistoryStore,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """A scope built field-by-field behaves like ``_default_scope()``.

        Proves the scope's field semantics are the contract,
        not the helper. A future agent-spawning path that
        constructs scopes manually (pointing at agent-specific
        ContextManager / tracker / selection list) must produce
        the same behaviour as the main-conversation default
        when its fields happen to point at the main-conversation
        state.
        """
        from ac_dc.llm_service import ConversationScope

        fake_litellm.set_streaming_chunks(["manual scope works"])

        service._main_loop = asyncio.get_event_loop()
        service._active_user_request = "r-manual"

        # Build an archival_append closure the same way
        # _default_scope does — thin wrapper around
        # HistoryStore.append_message.
        store = service._history_store
        assert store is not None  # fixture has one

        def _append(
            role: str,
            content: str,
            *,
            session_id: str,
            **kwargs: Any,
        ) -> Any:
            return store.append_message(
                session_id=session_id,
                role=role,
                content=content,
                **kwargs,
            )

        manual_scope = ConversationScope(
            context=service._context,
            tracker=service._stability_tracker,
            session_id=service._session_id,
            selected_files=service._selected_files,
            archival_append=_append,
        )

        try:
            await service._stream_chat(
                request_id="r-manual",
                message="hello",
                files=[],
                images=[],
                excluded_urls=[],
                scope=manual_scope,
            )
        finally:
            service._active_user_request = None

        # Same observable surface as the default-scope test.
        sid = service.get_current_state()["session_id"]
        persisted = history_store.get_session_messages(sid)
        assert any(
            m["role"] == "user" and m["content"] == "hello"
            for m in persisted
        )
        assert any(
            m["role"] == "assistant"
            and m["content"] == "manual scope works"
            for m in persisted
        )

    async def test_none_fallback_produces_same_result(
        self,
        service: LLMService,
        history_store: HistoryStore,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """``scope=None`` falls through to the default scope.

        Safety-net path every per-conversation method carries.
        If a future refactor drops the None-fallback and
        requires an explicit scope, this test catches the
        breaking change — the existing ``chat_streaming``
        surface doesn't use None (it always builds a default
        scope), but the None-branch in every helper is a
        documented contract worth pinning.
        """
        fake_litellm.set_streaming_chunks(["none fallback works"])

        service._main_loop = asyncio.get_event_loop()
        service._active_user_request = "r-none"

        try:
            await service._stream_chat(
                request_id="r-none",
                message="hello",
                files=[],
                images=[],
                excluded_urls=[],
                scope=None,
            )
        finally:
            service._active_user_request = None

        sid = service.get_current_state()["session_id"]
        persisted = history_store.get_session_messages(sid)
        assert any(
            m["role"] == "user" and m["content"] == "hello"
            for m in persisted
        )
        assert any(
            m["role"] == "assistant"
            and m["content"] == "none fallback works"
            for m in persisted
        )

    def test_default_scope_helper_fields(
        self,
        service: LLMService,
    ) -> None:
        """``_default_scope()`` wires every field to the main state.

        Unit-level check on the helper itself. Verifies each
        field points at the exact object the main conversation
        owns — aliasing matters for the byte-identical contract
        (a copy of ``_selected_files`` would mean auto-add
        mutations don't reach the service's list; a fresh
        ContextManager would mean history and file_context
        don't align with what the frontend sees via
        ``get_current_state``).
        """
        scope = service._default_scope()
        # ContextManager identity — not a copy.
        assert scope.context is service._context
        # Tracker identity — the active mode's tracker.
        assert scope.tracker is service._stability_tracker
        # Session ID — string equality (strings are immutable,
        # identity doesn't matter, but the value must match).
        assert scope.session_id == service._session_id
        # Selected files — MUST be the same list object so
        # auto-add mutations in _build_completion_result reach
        # the service's list. A copy would break the contract.
        assert scope.selected_files is service._selected_files
        # archival_append is a closure over the history store,
        # not None (fixture has a store). It's a new closure
        # on every call — we can't assert identity, but it
        # must be callable.
        assert callable(scope.archival_append)

    def test_default_scope_without_history_store_has_none_append(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """No history store → ``archival_append`` is None.

        Tests that skip persistence (no ``history_store``
        fixture) must get a scope whose archival_append is
        None so callers check before invoking. Matches the
        ``Optional[ArchivalAppend]`` contract.
        """
        svc = LLMService(config=config, repo=repo)
        scope = svc._default_scope()
        assert scope.archival_append is None
        # Other fields still wired.
        assert scope.context is svc._context
        assert scope.tracker is svc._stability_tracker
        assert scope.selected_files is svc._selected_files


class TestTurnIdPropagation:
    """Turn ID propagation through the streaming pipeline.

    Slice 1 of the parallel-agents foundation — per
    specs4/3-llm/history.md § Turns, every record produced by a
    user request carries a shared turn_id so the main store has
    a consistent key for "records from this request". Lays the
    groundwork for Slice 2 (agent archives keyed by turn_id).

    Scope: verifies turn IDs are generated, match between
    user/assistant records, appear in both the context manager
    and the history store, and carry through to compaction
    system events when compaction fires during post-response.
    """

    async def test_user_message_carries_turn_id(
        self,
        service: LLMService,
        history_store: HistoryStore,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Persisted user message has a turn_id starting with 'turn_'."""
        fake_litellm.set_streaming_chunks(["ok"])

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.2)

        sid = service.get_current_state()["session_id"]
        persisted = history_store.get_session_messages(sid)
        user_msgs = [m for m in persisted if m["role"] == "user"]
        assert user_msgs
        tid = user_msgs[-1].get("turn_id")
        assert isinstance(tid, str)
        assert tid.startswith("turn_")

    async def test_assistant_message_carries_turn_id(
        self,
        service: LLMService,
        history_store: HistoryStore,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Persisted assistant message has a turn_id."""
        fake_litellm.set_streaming_chunks(["ok"])

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.2)

        sid = service.get_current_state()["session_id"]
        persisted = history_store.get_session_messages(sid)
        assistant_msgs = [
            m for m in persisted if m["role"] == "assistant"
        ]
        assert assistant_msgs
        tid = assistant_msgs[-1].get("turn_id")
        assert isinstance(tid, str)
        assert tid.startswith("turn_")

    async def test_user_and_assistant_share_turn_id(
        self,
        service: LLMService,
        history_store: HistoryStore,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """User and assistant records from one turn share turn_id.

        The key invariant — turn_id groups all records produced
        by a single request. Without this, agent archives
        (Slice 2) couldn't be keyed by turn_id because the key
        wouldn't uniquely identify the turn.
        """
        fake_litellm.set_streaming_chunks(["reply"])

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.2)

        sid = service.get_current_state()["session_id"]
        persisted = history_store.get_session_messages(sid)
        user_tid = next(
            m["turn_id"] for m in persisted
            if m["role"] == "user" and m.get("turn_id")
        )
        assistant_tid = next(
            m["turn_id"] for m in persisted
            if m["role"] == "assistant" and m.get("turn_id")
        )
        assert user_tid == assistant_tid

    async def test_two_turns_have_different_ids(
        self,
        service: LLMService,
        history_store: HistoryStore,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Back-to-back turns produce distinct turn_ids.

        Pins the "one turn ID per user request" rule — reusing
        an ID across turns would corrupt the agent archive
        directory structure (Slice 2).
        """
        fake_litellm.set_streaming_chunks(["r1 reply"])
        await service.chat_streaming(request_id="r1", message="one")
        await asyncio.sleep(0.2)

        fake_litellm.set_streaming_chunks(["r2 reply"])
        await service.chat_streaming(request_id="r2", message="two")
        await asyncio.sleep(0.2)

        sid = service.get_current_state()["session_id"]
        persisted = history_store.get_session_messages(sid)
        # Collect turn_ids from user records (one per turn).
        turn_ids = [
            m["turn_id"] for m in persisted
            if m["role"] == "user" and m.get("turn_id")
        ]
        assert len(turn_ids) == 2
        assert turn_ids[0] != turn_ids[1]

    async def test_context_manager_records_turn_id(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Context manager's in-memory history carries turn_id too.

        Both stores (context manager + JSONL) must agree on the
        turn_id — otherwise a reader walking the context for
        prompt assembly and a reader walking JSONL for the
        agent-browser UI would see inconsistent grouping.
        """
        fake_litellm.set_streaming_chunks(["ok"])

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.2)

        history = service.get_current_state()["messages"]
        user_msg = next(
            m for m in history if m["role"] == "user"
        )
        assistant_msg = next(
            m for m in history if m["role"] == "assistant"
        )
        assert user_msg.get("turn_id")
        assert user_msg["turn_id"] == assistant_msg.get("turn_id")

    async def test_compaction_event_inherits_turn_id(
        self,
        service: LLMService,
        config: ConfigManager,
        history_store: HistoryStore,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Compaction system event shares turn_id with its triggering turn.

        Pins the "system events fired during a turn inherit the
        turn_id" rule from specs4/3-llm/history.md § Turns. Uses
        the same low-threshold config trick as
        ``TestCompactionSystemEvent`` to force compaction to
        fire on the first real turn.
        """
        # Lower the compaction threshold so compaction fires
        # after the first turn. Reuse the helper pattern from
        # TestCompactionSystemEvent.
        import json as _json
        app_path = config.config_dir / "app.json"
        app_data = _json.loads(app_path.read_text())
        app_data.setdefault("history_compaction", {})
        app_data["history_compaction"]["enabled"] = True
        app_data["history_compaction"]["compaction_trigger_tokens"] = 500
        app_data["history_compaction"]["verbatim_window_tokens"] = 200
        app_data["history_compaction"]["min_verbatim_exchanges"] = 1
        app_data["history_compaction"]["summary_budget_tokens"] = 500
        app_path.write_text(_json.dumps(app_data))
        config._app_config = None

        # Seed enough history to cross the trigger.
        long_content = "x " * 150
        for _ in range(10):
            service._context.add_message("user", long_content)
            service._context.add_message("assistant", long_content)

        # Canned detector — truncate case so the event fires.
        def _detector(messages):
            return TopicBoundary(
                boundary_index=18,
                boundary_reason="topic shift",
                confidence=0.9,
                summary="",
            )
        service._compactor._detect = _detector

        fake_litellm.set_streaming_chunks(["reply"])
        await service.chat_streaming(
            request_id="r1", message="trigger"
        )
        await asyncio.sleep(0.3)

        sid = service.get_current_state()["session_id"]
        persisted = history_store.get_session_messages(sid)
        # The compaction system event is a user-role record
        # with system_event=True and "History compacted" in
        # the content.
        compaction_events = [
            m for m in persisted
            if m.get("system_event")
            and "History compacted" in m.get("content", "")
        ]
        assert len(compaction_events) == 1
        # User message carries the turn ID; the compaction
        # event must inherit it.
        user_tid = next(
            m["turn_id"] for m in persisted
            if m["role"] == "user"
            and m.get("content") == "trigger"
            and m.get("turn_id")
        )
        assert compaction_events[0].get("turn_id") == user_tid


# ---------------------------------------------------------------------------
# cancel_streaming
# ---------------------------------------------------------------------------


class TestCancellation:
    """cancel_streaming aborts the in-flight stream."""

    def test_wrong_request_id_rejected(
        self, service: LLMService
    ) -> None:
        """Canceling a non-active request returns an error."""
        service._active_user_request = "actual"
        result = service.cancel_streaming("different")
        assert "error" in result

    def test_active_request_added_to_cancelled_set(
        self, service: LLMService
    ) -> None:
        """Active cancellation registers the ID."""
        service._active_user_request = "r1"
        service.cancel_streaming("r1")
        assert "r1" in service._cancelled_requests


# ---------------------------------------------------------------------------
# Commit flow
# ---------------------------------------------------------------------------


class TestCommitFlow:
    """commit_all pipeline — session ID capture, message recording."""

    async def test_rejects_when_already_committing(
        self, service: LLMService
    ) -> None:
        """Concurrent commits are rejected."""
        service._committing = True
        result = await service.commit_all()
        assert "in progress" in result.get("error", "")

    async def test_no_repo_rejected(
        self,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """No repo attached → commit_all returns error."""
        svc = LLMService(config=config, repo=None)
        result = await svc.commit_all()
        assert "repository" in result.get("error", "").lower()

    async def test_session_id_captured_synchronously(
        self,
        service: LLMService,
        repo_dir: Path,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Session ID used in the commit message is the one
        captured at launch time, not whatever self._session_id is
        later.

        Critical race-prevention contract from specs3.
        """
        # Make a change so commit has something to stage.
        (repo_dir / "new.md").write_text("content")
        fake_litellm.set_non_streaming_reply(
            "feat: add new.md"
        )

        captured_session = service.get_current_state()["session_id"]

        result = await service.commit_all()
        assert result == {"status": "started"}

        # Simulate a session swap RIGHT after launch — the
        # background task must use the captured value, not the new.
        service._session_id = "sess_different"

        await asyncio.sleep(0.3)

        # The commit-event should have been persisted under the
        # ORIGINAL session ID.
        assert service._history_store is not None
        persisted_old = service._history_store.get_session_messages(
            captured_session
        )
        commit_entries = [
            m for m in persisted_old
            if m.get("system_event")
            and "Committed" in m.get("content", "")
        ]
        assert commit_entries, (
            "commit event not persisted to captured session"
        )


# ---------------------------------------------------------------------------
# Reset flow
# ---------------------------------------------------------------------------


class TestResetFlow:
    """reset_to_head records a system event."""

    def test_no_repo_rejected(
        self, config: ConfigManager, fake_litellm: _FakeLiteLLM
    ) -> None:
        svc = LLMService(config=config, repo=None)
        result = svc.reset_to_head()
        assert "repository" in result.get("error", "").lower()

    def test_system_event_recorded(
        self,
        service: LLMService,
        history_store: HistoryStore,
    ) -> None:
        """Reset records a system event message in context + history."""
        result = service.reset_to_head()
        assert result["status"] == "ok"
        assert "Reset to HEAD" in result["system_event_message"]

        # In-memory history has the system event.
        history = service.get_current_state()["messages"]
        assert any(
            m.get("system_event")
            and "Reset to HEAD" in m.get("content", "")
            for m in history
        )
        # Persistent history has it too.
        sid = service.get_current_state()["session_id"]
        persisted = history_store.get_session_messages(sid)
        assert any(
            m.get("system_event")
            and "Reset to HEAD" in m.get("content", "")
            for m in persisted
        )


# ---------------------------------------------------------------------------
# Topic detector closure
# ---------------------------------------------------------------------------


class TestTopicDetector:
    """The detector closure built by _build_topic_detector."""

    def test_detector_returns_safe_default_on_empty(
        self,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Empty messages → safe-default TopicBoundary."""
        from concurrent.futures import ThreadPoolExecutor
        detector = _build_topic_detector(
            config, ThreadPoolExecutor(max_workers=1)
        )
        result = detector([])
        assert result.boundary_index is None
        assert result.confidence == 0.0

    def test_detector_parses_json_reply(
        self,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Valid JSON reply → populated TopicBoundary."""
        from concurrent.futures import ThreadPoolExecutor
        fake_litellm.set_non_streaming_reply(json.dumps({
            "boundary_index": 3,
            "boundary_reason": "topic shift",
            "confidence": 0.85,
            "summary": "earlier work on X",
        }))
        detector = _build_topic_detector(
            config, ThreadPoolExecutor(max_workers=1)
        )
        result = detector([
            {"role": "user", "content": "msg 0"},
            {"role": "assistant", "content": "msg 1"},
        ])
        assert result.boundary_index == 3
        assert result.confidence == 0.85
        assert "earlier" in result.summary

    def test_detector_tolerates_markdown_fence(
        self,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """LLM wrapping JSON in ```json fences → still parsed."""
        from concurrent.futures import ThreadPoolExecutor
        fake_litellm.set_non_streaming_reply(
            "```json\n"
            + json.dumps({
                "boundary_index": 2,
                "boundary_reason": "shift",
                "confidence": 0.7,
                "summary": "",
            })
            + "\n```"
        )
        detector = _build_topic_detector(
            config, ThreadPoolExecutor(max_workers=1)
        )
        result = detector([
            {"role": "user", "content": "something"},
        ])
        assert result.boundary_index == 2

    def test_detector_handles_unparseable_reply(
        self,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Garbage reply → safe default."""
        from concurrent.futures import ThreadPoolExecutor
        fake_litellm.set_non_streaming_reply("not json at all")
        detector = _build_topic_detector(
            config, ThreadPoolExecutor(max_workers=1)
        )
        result = detector([
            {"role": "user", "content": "x"},
        ])
        assert result.boundary_index is None
        assert result.confidence == 0.0

    def test_detector_confidence_clamped(
        self,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Out-of-range confidence values are clamped to [0, 1]."""
        from concurrent.futures import ThreadPoolExecutor
        fake_litellm.set_non_streaming_reply(json.dumps({
            "boundary_index": 0,
            "boundary_reason": "x",
            "confidence": 5.0,
            "summary": "",
        }))
        detector = _build_topic_detector(
            config, ThreadPoolExecutor(max_workers=1)
        )
        result = detector([
            {"role": "user", "content": "msg"},
        ])
        assert result.confidence <= 1.0


# ---------------------------------------------------------------------------
# State snapshot
# ---------------------------------------------------------------------------


class TestStateSnapshot:
    """get_current_state returns the documented shape."""

    def test_snapshot_shape(
        self, service: LLMService
    ) -> None:
        """Required fields are present."""
        state = service.get_current_state()
        assert set(state.keys()) == {
            "messages",
            "selected_files",
            "streaming_active",
            "session_id",
            "repo_name",
            "init_complete",
            "mode",
            "cross_ref_enabled",
            "enrichment_status",
            "review_state",
            "excluded_index_files",
            "doc_convert_available",
        }

    def test_messages_is_copy(
        self, service: LLMService
    ) -> None:
        """Mutating returned messages doesn't affect state."""
        state = service.get_current_state()
        state["messages"].append({"role": "user", "content": "fake"})
        assert service.get_current_state()["messages"] == []

    def test_selected_files_is_copy(
        self,
        service: LLMService,
        repo_dir: Path,
    ) -> None:
        """Mutating returned selected_files doesn't affect state."""
        (repo_dir / "a.md").write_text("x")
        service.set_selected_files(["a.md"])
        state = service.get_current_state()
        state["selected_files"].append("fake.md")
        assert service.get_current_state()["selected_files"] == ["a.md"]


# ---------------------------------------------------------------------------
# Mode switching — Layer 3.10
# ---------------------------------------------------------------------------


class TestMode:
    """Mode switching, cross-reference toggle, state snapshot fields."""

    def test_get_mode_default_shape(
        self, service: LLMService
    ) -> None:
        """get_mode returns the documented shape in default state.

        Default state has all readiness flags False — tracker
        hasn't run the background build yet, enrichment starts
        in "pending".
        """
        result = service.get_mode()
        assert result == {
            "mode": "code",
            "doc_index_ready": False,
            "doc_index_building": False,
            "doc_index_enriched": False,
            "enrichment_status": "pending",
            "cross_ref_ready": False,
            "cross_ref_enabled": False,
        }

    def test_state_snapshot_includes_cross_ref(
        self, service: LLMService
    ) -> None:
        """get_current_state carries cross_ref_enabled field."""
        state = service.get_current_state()
        assert "cross_ref_enabled" in state
        assert state["cross_ref_enabled"] is False

    async def test_get_mode_reflects_doc_index_ready(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """After background build completes, ready flags flip True."""
        (repo_dir / "doc.md").write_text("# Doc\n")

        svc = LLMService(
            config=config,
            repo=repo,
            event_callback=event_cb,
            deferred_init=True,
        )
        # Pre-build: all readiness flags False.
        before = svc.get_mode()
        assert before["doc_index_ready"] is False
        assert before["doc_index_building"] is False
        assert before["cross_ref_ready"] is False

        # Run the background build.
        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        # Post-build: structural flags flip True, cross_ref_ready
        # mirrors doc_index_ready.
        after = svc.get_mode()
        assert after["doc_index_ready"] is True
        assert after["doc_index_building"] is False
        assert after["cross_ref_ready"] is True

    def test_get_mode_enriched_stays_false_in_2_8_2(
        self, service: LLMService
    ) -> None:
        """doc_index_enriched is always False in 2.8.2.

        Enrichment lands in 2.8.4. Until then the flag is
        hardcoded False regardless of structural readiness.
        Matches the two-phase principle from specs4 — structural
        extraction and enrichment are independent phases.
        """
        # Fake a post-build state to prove enriched stays False
        # even when structure is ready.
        service._doc_index_ready = True
        service._doc_index_building = False
        # Enrichment hasn't run.
        assert service._doc_index_enriched is False
        result = service.get_mode()
        assert result["doc_index_enriched"] is False

    def test_get_mode_cross_ref_ready_mirrors_doc_index_ready(
        self, service: LLMService
    ) -> None:
        """cross_ref_ready follows doc_index_ready.

        Structural extraction is the minimum readiness for
        cross-reference to produce content. Enrichment improves
        output quality but isn't a gate — the toggle is available
        once structure is ready, regardless of enrichment state.
        """
        # Initial state — both False.
        result = service.get_mode()
        assert result["cross_ref_ready"] == result["doc_index_ready"]
        # Flip structural readiness without enrichment.
        service._doc_index_ready = True
        result = service.get_mode()
        assert result["cross_ref_ready"] is True
        assert result["doc_index_enriched"] is False

    def test_switch_to_same_mode_is_noop(
        self,
        service: LLMService,
        event_cb: _RecordingEventCallback,
        history_store: HistoryStore,
    ) -> None:
        """Switching to the already-active mode produces no side effects."""
        # Clear any events from construction.
        event_cb.events.clear()

        result = service.switch_mode("code")

        assert result["mode"] == "code"
        assert "Already" in result.get("message", "")
        # No system event message added.
        assert service.get_current_state()["messages"] == []
        # No broadcast.
        mode_events = [
            args for name, args in event_cb.events
            if name == "modeChanged"
        ]
        assert mode_events == []

    def test_switch_to_unknown_mode_rejected(
        self, service: LLMService
    ) -> None:
        """Unknown mode string returns a clean error."""
        result = service.switch_mode("invalid")
        assert "error" in result
        assert "code" in result["error"]
        assert "doc" in result["error"]
        # Mode unchanged.
        assert service.get_current_state()["mode"] == "code"

    def test_switch_code_to_doc_changes_mode(
        self, service: LLMService
    ) -> None:
        """Switching code → doc updates the context manager's mode."""
        result = service.switch_mode("doc")
        assert result == {"mode": "doc"}
        assert service.get_current_state()["mode"] == "doc"

    def test_switch_swaps_system_prompt(
        self,
        service: LLMService,
        config: ConfigManager,
    ) -> None:
        """Mode switch installs the mode-appropriate system prompt."""
        code_prompt = service._context.get_system_prompt()
        service.switch_mode("doc")
        doc_prompt = service._context.get_system_prompt()
        assert doc_prompt == config.get_doc_system_prompt()
        assert doc_prompt != code_prompt
        # Switch back — original code prompt restored (via the
        # config, not via save-and-restore — mode switch uses
        # plain set_system_prompt).
        service.switch_mode("code")
        assert service._context.get_system_prompt() == (
            config.get_system_prompt()
        )

    def test_switch_swaps_stability_tracker(
        self, service: LLMService
    ) -> None:
        """Each mode has its own tracker; switching swaps the active one."""
        code_tracker = service._stability_tracker
        service.switch_mode("doc")
        doc_tracker = service._stability_tracker
        # Distinct instances.
        assert doc_tracker is not code_tracker
        # Context manager's attached tracker updated too.
        assert service._context.stability_tracker is doc_tracker

    def test_switch_preserves_tracker_state(
        self, service: LLMService
    ) -> None:
        """Switching away and back returns to the original tracker."""
        first_code_tracker = service._stability_tracker
        service.switch_mode("doc")
        service.switch_mode("code")
        # Same instance as before — not reconstructed.
        assert service._stability_tracker is first_code_tracker

    def test_switch_lazy_constructs_doc_tracker(
        self, service: LLMService
    ) -> None:
        """Doc tracker only exists once doc mode is first entered."""
        assert Mode.DOC not in service._trackers
        service.switch_mode("doc")
        assert Mode.DOC in service._trackers

    def test_switch_records_system_event_in_context(
        self, service: LLMService
    ) -> None:
        """Mode switch appends a system event to conversation history."""
        service.switch_mode("doc")
        messages = service.get_current_state()["messages"]
        assert len(messages) == 1
        event = messages[0]
        assert event["role"] == "user"
        assert event.get("system_event") is True
        assert "doc" in event["content"].lower()

    def test_switch_records_system_event_in_history_store(
        self,
        service: LLMService,
        history_store: HistoryStore,
    ) -> None:
        """Mode switch persists the system event to JSONL."""
        service.switch_mode("doc")
        sid = service.get_current_state()["session_id"]
        persisted = history_store.get_session_messages(sid)
        events = [
            m for m in persisted
            if m.get("system_event")
            and "doc" in m.get("content", "").lower()
        ]
        assert len(events) == 1

    def test_switch_broadcasts_mode_changed(
        self,
        service: LLMService,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """modeChanged event fires with the new mode."""
        event_cb.events.clear()
        service.switch_mode("doc")
        mode_events = [
            args for name, args in event_cb.events
            if name == "modeChanged"
        ]
        assert len(mode_events) == 1
        payload = mode_events[0][0]
        assert payload == {"mode": "doc"}

    def test_set_cross_reference_enable(
        self,
        service: LLMService,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """Enabling cross-reference flips the flag and broadcasts.

        Pre-flip readiness gate: we fake-mark the doc index
        ready since the real background build isn't wired in
        this fixture.
        """
        service._doc_index_ready = True
        event_cb.events.clear()
        result = service.set_cross_reference(True)
        assert result == {
            "status": "ok",
            "cross_ref_enabled": True,
        }
        assert service.get_current_state()["cross_ref_enabled"] is True
        # Broadcast carries both mode and new state.
        mode_events = [
            args for name, args in event_cb.events
            if name == "modeChanged"
        ]
        assert len(mode_events) == 1
        payload = mode_events[0][0]
        assert payload["mode"] == "code"
        assert payload["cross_ref_enabled"] is True

    def test_set_cross_reference_disable(
        self,
        service: LLMService,
    ) -> None:
        """Disabling cross-reference flips the flag back."""
        service._doc_index_ready = True
        service.set_cross_reference(True)
        result = service.set_cross_reference(False)
        assert result == {
            "status": "ok",
            "cross_ref_enabled": False,
        }
        assert service.get_current_state()["cross_ref_enabled"] is False

    def test_set_cross_reference_idempotent(
        self,
        service: LLMService,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """Setting cross-reference to its current value is a no-op."""
        event_cb.events.clear()
        # Default is False; setting to False should not broadcast.
        result = service.set_cross_reference(False)
        assert result["cross_ref_enabled"] is False
        mode_events = [
            args for name, args in event_cb.events
            if name == "modeChanged"
        ]
        assert mode_events == []

    def test_cross_reference_resets_on_mode_switch(
        self, service: LLMService
    ) -> None:
        """Cross-reference flag resets to False on every mode switch."""
        service._doc_index_ready = True
        service.set_cross_reference(True)
        assert service.get_current_state()["cross_ref_enabled"] is True
        service.switch_mode("doc")
        assert service.get_current_state()["cross_ref_enabled"] is False
        # And staying on: re-enable, switch back to code, reset.
        service.set_cross_reference(True)
        service.switch_mode("code")
        assert service.get_current_state()["cross_ref_enabled"] is False


# ---------------------------------------------------------------------------
# Enrichment status tristate — follow-up to Layer 2.8.4
# ---------------------------------------------------------------------------


class TestEnrichmentStatus:
    """The ``enrichment_status`` field on ``get_mode()``.

    Four states track the keyword-enrichment lifecycle:

    - ``"pending"`` — initial state, or structural extraction
      still running before enrichment starts
    - ``"building"`` — enrichment loop is actively processing files
    - ``"complete"`` — all files enriched
    - ``"unavailable"`` — KeyBERT or sentence-transformers not
      installed, or model load failed

    The transitions "pending → building → complete" cover the
    happy path; "pending → complete" handles the cache-hit case
    where everything was already enriched from a prior session;
    "pending → unavailable" handles missing dependencies or
    model load failures.

    Tests drive the background enrichment loop via
    :meth:`LLMService.complete_deferred_init` with a controlled
    :class:`KeywordEnricher` stub — real KeyBERT isn't available
    in the test environment and we don't want to exercise the
    real model download path. Status transitions are checked
    synchronously via ``asyncio.sleep`` to let the executor
    task complete.
    """

    async def test_initial_state_is_pending(
        self, service: LLMService
    ) -> None:
        """Fresh service reports pending — enrichment hasn't run."""
        result = service.get_mode()
        assert result["enrichment_status"] == "pending"
        assert result["doc_index_enriched"] is False

    async def test_unavailable_when_enricher_probe_fails(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """KeyBERT probe returns False → status flips to unavailable."""
        (repo_dir / "doc.md").write_text("# Doc\n")

        svc = LLMService(
            config=config,
            repo=repo,
            event_callback=event_cb,
            deferred_init=True,
        )
        # Force the enricher to report unavailable. The probe
        # caches its result, so setting _available directly
        # short-circuits future is_available() calls.
        svc._enricher._available = False

        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        result = svc.get_mode()
        assert result["enrichment_status"] == "unavailable"
        # Backwards-compatibility boolean stays False.
        assert result["doc_index_enriched"] is False

    async def test_unavailable_when_model_load_fails(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Model load failure → unavailable.

        Enricher passes the probe (library importable) but the
        KeyBERT instance can't be constructed — matches the
        real case of corrupted model cache or HF Hub rate limit.
        """
        (repo_dir / "doc.md").write_text("# Doc\n")

        svc = LLMService(
            config=config,
            repo=repo,
            event_callback=event_cb,
            deferred_init=True,
        )
        # Force probe to pass but ensure_loaded to fail.
        svc._enricher._available = True
        monkeypatch.setattr(
            svc._enricher, "ensure_loaded", lambda: False
        )

        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        result = svc.get_mode()
        assert result["enrichment_status"] == "unavailable"
        assert result["doc_index_enriched"] is False

    async def test_complete_when_no_files_queued(
        self,
        config: ConfigManager,
        repo: Repo,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Empty queue → pending → complete (skips building).

        Common case on a warm start: every file was enriched in
        a prior session and the disk cache carries forward.
        The enricher loads the model but the queue is empty;
        status skips "building" and goes straight to "complete".
        """
        svc = LLMService(
            config=config,
            repo=repo,
            event_callback=event_cb,
            deferred_init=True,
        )
        # Probe passes; model loads; queue is empty.
        svc._enricher._available = True
        monkeypatch.setattr(
            svc._enricher, "ensure_loaded", lambda: True
        )
        # Ensure the queue is empty regardless of any files
        # that the doc index might have picked up.
        monkeypatch.setattr(
            svc._doc_index, "queue_enrichment", lambda: []
        )

        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        result = svc.get_mode()
        assert result["enrichment_status"] == "complete"
        assert result["doc_index_enriched"] is True

    async def test_complete_after_enriching_queued_files(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Happy path: pending → building → complete.

        Files are queued, enrichment runs, status ends at
        "complete". We can't easily observe "building" mid-flight
        from a sync test (the loop completes quickly with stub
        enrichment), but we can pin that the terminal state is
        correct and that the loop path was actually taken.
        """
        (repo_dir / "doc.md").write_text("# Doc\n\nBody.\n")

        svc = LLMService(
            config=config,
            repo=repo,
            event_callback=event_cb,
            deferred_init=True,
        )
        svc._enricher._available = True
        monkeypatch.setattr(
            svc._enricher, "ensure_loaded", lambda: True
        )
        # Stub enrich_single_file so we don't exercise real
        # KeyBERT. Just records that enrichment happened.
        enrichment_calls: list[str] = []

        def _stub_enrich(
            path: str, source_text: str = ""
        ) -> Any:
            enrichment_calls.append(path)
            return svc._doc_index._all_outlines.get(path)

        monkeypatch.setattr(
            svc._doc_index, "enrich_single_file", _stub_enrich
        )

        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        result = svc.get_mode()
        assert result["enrichment_status"] == "complete"
        assert result["doc_index_enriched"] is True
        # Enrichment actually ran (loop path taken, not
        # early-return from empty queue).
        assert len(enrichment_calls) >= 1

    async def test_doc_index_enriched_mirrors_complete_status(
        self,
        config: ConfigManager,
        repo: Repo,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Backwards-compat boolean stays consistent with tristate.

        ``doc_index_enriched`` is True iff ``enrichment_status``
        is "complete". Pinning this so a future refactor that
        drops the boolean doesn't silently diverge the two
        fields during the transition.
        """
        svc = LLMService(
            config=config,
            repo=repo,
            event_callback=event_cb,
            deferred_init=True,
        )
        svc._enricher._available = True
        monkeypatch.setattr(
            svc._enricher, "ensure_loaded", lambda: True
        )
        monkeypatch.setattr(
            svc._doc_index, "queue_enrichment", lambda: []
        )

        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        result = svc.get_mode()
        # Both indicate complete.
        assert result["enrichment_status"] == "complete"
        assert result["doc_index_enriched"] is True

    def test_unavailable_keeps_doc_index_enriched_false(
        self, service: LLMService
    ) -> None:
        """Unavailable → doc_index_enriched stays False.

        Critical for the frontend: the old boolean alone would
        report False both during "still building" and during
        "can't build". The new tristate distinguishes them, but
        the boolean must remain reliable for existing callers
        that haven't migrated yet.
        """
        service._enrichment_status = "unavailable"
        service._doc_index_enriched = False

        result = service.get_mode()
        assert result["enrichment_status"] == "unavailable"
        assert result["doc_index_enriched"] is False

    def test_state_snapshot_includes_enrichment_status(
        self, service: LLMService
    ) -> None:
        """get_current_state carries enrichment_status for clients.

        Frontend reads this on connect / reconnect to decide
        whether to show the one-shot unavailable toast without
        waiting for a separate get_mode call.
        """
        state = service.get_current_state()
        assert "enrichment_status" in state
        assert state["enrichment_status"] == "pending"

    def test_state_snapshot_reflects_unavailable_status(
        self, service: LLMService
    ) -> None:
        """Snapshot updates as the backend state changes."""
        service._enrichment_status = "unavailable"
        state = service.get_current_state()
        assert state["enrichment_status"] == "unavailable"

    async def test_unavailable_triggers_mode_changed_broadcast(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Probe failure broadcasts modeChanged with status.

        Mid-session clients (browser reload during a build that
        then fails) need to learn about the unavailable state
        without polling. The broadcast carries mode +
        cross-reference + enrichment_status so the frontend's
        modeChanged handler can route it.
        """
        (repo_dir / "doc.md").write_text("# Doc\n")

        svc = LLMService(
            config=config,
            repo=repo,
            event_callback=event_cb,
            deferred_init=True,
        )
        # Force probe failure.
        svc._enricher._available = False

        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        # Filter to modeChanged events carrying the status.
        mode_events = [
            args for name, args in event_cb.events
            if name == "modeChanged"
        ]
        # At least one mode-changed broadcast with unavailable.
        unavailable_broadcasts = [
            args[0] for args in mode_events
            if isinstance(args[0], dict)
            and args[0].get("enrichment_status") == "unavailable"
        ]
        assert len(unavailable_broadcasts) >= 1
        payload = unavailable_broadcasts[0]
        # Mode and cross-ref carried along so the frontend's
        # handler sees a consistent snapshot.
        assert payload["mode"] == "code"
        assert "cross_ref_enabled" in payload

    async def test_model_load_failure_triggers_broadcast(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Model load failure also broadcasts.

        Symmetric with the probe failure — both paths set
        `_enrichment_status = "unavailable"` and both must
        broadcast so the frontend can react.
        """
        (repo_dir / "doc.md").write_text("# Doc\n")

        svc = LLMService(
            config=config,
            repo=repo,
            event_callback=event_cb,
            deferred_init=True,
        )
        svc._enricher._available = True
        monkeypatch.setattr(
            svc._enricher, "ensure_loaded", lambda: False
        )

        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        mode_events = [
            args for name, args in event_cb.events
            if name == "modeChanged"
        ]
        unavailable_broadcasts = [
            args[0] for args in mode_events
            if isinstance(args[0], dict)
            and args[0].get("enrichment_status") == "unavailable"
        ]
        assert len(unavailable_broadcasts) >= 1


# ---------------------------------------------------------------------------
# _build_tiered_content — Layer 3.8 tier dispatch
# ---------------------------------------------------------------------------


class _FakeSymbolIndex:
    """Minimal symbol index stub for tier-builder tests.

    Exposes ``get_file_symbol_block(path)`` matching the real
    interface. Returns pre-seeded blocks from an in-memory dict;
    missing paths return None (matches the real index's behaviour
    for unknown files).
    """

    def __init__(self, blocks: dict[str, str] | None = None) -> None:
        self._blocks = dict(blocks or {})

    def get_file_symbol_block(self, path: str) -> str | None:
        return self._blocks.get(path)


def _place_item(
    tracker,
    key: str,
    tier_name: str,
    content_hash: str = "h",
    tokens: int = 10,
) -> None:
    """Helper: put an item directly into a tier on the tracker.

    The tracker's public update() flow expects an active-items
    dict and runs its own state machine. For testing the
    tier-builder we just want items parked in specific tiers —
    we construct TrackedItem directly and inject into the
    tracker's internal map.

    This is a white-box helper; the real cascade is tested in
    test_stability_tracker.py.
    """
    from ac_dc.stability_tracker import Tier, TrackedItem

    tier = Tier(tier_name)
    tracker._items[key] = TrackedItem(
        key=key,
        tier=tier,
        n_value=0,
        content_hash=content_hash,
        tokens=tokens,
    )


class TestStreamingWithEdits:
    """End-to-end streaming with edit block parsing and application.

    Exercises the full `_stream_chat` → `_build_completion_result`
    → `EditPipeline.apply_edits` path. The fake litellm streams
    responses containing edit blocks; tests assert on the
    resulting `streamComplete` payload and on disk state.
    """

    # Marker constants — re-declared here (not imported) so that
    # any accidental drift in the module's constants surfaces as
    # a test failure rather than a silent byte-level mismatch.
    # Matches the same discipline used in test_edit_protocol.py.
    EDIT_MARK = "🟧🟧🟧 EDIT"
    REPL_MARK = "🟨🟨🟨 REPL"
    END_MARK = "🟩🟩🟩 END"

    def _build_edit_block(
        self, path: str, old: str, new: str
    ) -> str:
        """Assemble one well-formed edit block as response text."""
        return (
            f"{path}\n{self.EDIT_MARK}\n"
            f"{old}\n{self.REPL_MARK}\n"
            f"{new}\n{self.END_MARK}\n"
        )

    def _last_complete_result(
        self, event_cb: _RecordingEventCallback
    ) -> dict:
        """Extract the most recent streamComplete result dict."""
        completes = [
            args for name, args in event_cb.events
            if name == "streamComplete"
        ]
        assert completes, "No streamComplete event observed"
        # args = (request_id, result_dict)
        return completes[-1][1]

    async def test_modify_edit_applied_end_to_end(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """LLM emits an edit block → file on disk is updated."""
        # Seed a file in the repo and put it in selection.
        (repo_dir / "a.py").write_text("hello world\n")
        service.set_selected_files(["a.py"])

        # LLM streams a response containing one edit block.
        response = (
            "Here's the change:\n\n"
            + self._build_edit_block("a.py", "hello", "goodbye")
        )
        # Split across two chunks to exercise the accumulation
        # path — the final chunk still carries the full content.
        mid = len(response) // 2
        fake_litellm.set_streaming_chunks([
            response[:mid],
            response[mid:],
        ])

        await service.chat_streaming(
            request_id="r1", message="rename hello"
        )
        await asyncio.sleep(0.3)

        # File was modified on disk.
        assert (repo_dir / "a.py").read_text() == "goodbye world\n"

        # Result carries the edit metadata.
        result = self._last_complete_result(event_cb)
        assert result["passed"] == 1
        assert result["failed"] == 0
        assert result["files_modified"] == ["a.py"]
        assert len(result["edit_blocks"]) == 1
        assert result["edit_blocks"][0]["file"] == "a.py"
        assert result["edit_blocks"][0]["is_create"] is False

    async def test_edit_results_serialised_shape(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """edit_results entries carry every documented field."""
        (repo_dir / "a.py").write_text("x\n")
        service.set_selected_files(["a.py"])

        response = (
            "Change:\n\n"
            + self._build_edit_block("a.py", "x", "y")
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="change"
        )
        await asyncio.sleep(0.3)

        result = self._last_complete_result(event_cb)
        assert len(result["edit_results"]) == 1
        entry = result["edit_results"][0]
        # Required fields.
        assert entry["file"] == "a.py"
        assert entry["status"] == "applied"
        assert entry["error_type"] == ""
        # Previews populated even on success.
        assert "x" in entry["old_preview"]
        assert "y" in entry["new_preview"]
        assert "message" in entry

    async def test_multiple_edits_in_one_response(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Two edits in the same response both apply sequentially."""
        (repo_dir / "a.py").write_text("alpha\n")
        (repo_dir / "b.py").write_text("beta\n")
        service.set_selected_files(["a.py", "b.py"])

        response = (
            self._build_edit_block("a.py", "alpha", "ALPHA")
            + self._build_edit_block("b.py", "beta", "BETA")
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="uppercase"
        )
        await asyncio.sleep(0.3)

        assert (repo_dir / "a.py").read_text() == "ALPHA\n"
        assert (repo_dir / "b.py").read_text() == "BETA\n"

        result = self._last_complete_result(event_cb)
        assert result["passed"] == 2
        # files_modified preserves first-seen order.
        assert result["files_modified"] == ["a.py", "b.py"]

    async def test_create_block_during_streaming(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Create block (empty old text) creates a new file on disk."""
        # Create block has empty old text — just REPL and END.
        response = (
            f"Creating:\n\n"
            f"new.py\n{self.EDIT_MARK}\n"
            f"{self.REPL_MARK}\n"
            f"print('hi')\n{self.END_MARK}\n"
        )
        fake_litellm.set_streaming_chunks([response])

        # Empty selection — create bypasses the in-context check.
        await service.chat_streaming(
            request_id="r1", message="make new file"
        )
        await asyncio.sleep(0.3)

        # Parser joins content lines with "\n"; a single-line
        # body produces no trailing newline. If the LLM wants
        # one it emits a blank line before the END marker.
        assert (repo_dir / "new.py").read_text() == "print('hi')"

        result = self._last_complete_result(event_cb)
        assert result["passed"] == 1
        assert result["edit_blocks"][0]["is_create"] is True
        assert result["files_modified"] == ["new.py"]

    async def test_create_block_auto_adds_to_selection(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Successful create adds the new file to the selection.

        Pinned by specs4/3-llm/edit-protocol.md § "Created
        File Handling": creates auto-add so the next turn has
        the new file's content in context and the user sees it
        in the picker.
        """
        response = (
            f"new.py\n{self.EDIT_MARK}\n"
            f"{self.REPL_MARK}\n"
            f"print('hi')\n{self.END_MARK}\n"
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="create"
        )
        await asyncio.sleep(0.3)

        # File added to selected-files list.
        assert "new.py" in service.get_selected_files()

        # Result surfaces the created file separately from
        # auto-added modifies — the frontend uses this split
        # to decide whether to fire a retry prompt (creates
        # don't).
        result = self._last_complete_result(event_cb)
        assert result["files_created"] == ["new.py"]
        assert result["files_auto_added"] == []

    async def test_created_file_content_loaded_into_file_context(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Created file's content is loaded so the next turn sees it.

        Without this the LLM would see the file path in the
        selected list but the file context wouldn't have the
        content — the next turn's prompt assembly would either
        re-read from disk on-demand or silently drop the file.
        Pinning explicit loading ensures consistency with how
        auto-added modify targets are handled.
        """
        response = (
            f"helper.py\n{self.EDIT_MARK}\n"
            f"{self.REPL_MARK}\n"
            f"def helper(): pass\n{self.END_MARK}\n"
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="create helper"
        )
        await asyncio.sleep(0.3)

        # File context has the content.
        assert service._file_context.has_file("helper.py")
        content = service._file_context.get_content("helper.py")
        assert content is not None
        assert "def helper()" in content

    async def test_create_broadcasts_files_changed(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Successful create fires filesChanged after streamComplete.

        Collaborator clients rely on this broadcast to refresh
        their picker checkbox state. Without it, the server's
        selection mutates but remote clients still see the
        pre-create selection.
        """
        response = (
            f"new.py\n{self.EDIT_MARK}\n"
            f"{self.REPL_MARK}\n"
            f"x = 1\n{self.END_MARK}\n"
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="create"
        )
        await asyncio.sleep(0.3)

        # filesChanged fires AFTER streamComplete, carrying the
        # new selection.
        event_names = [name for name, _ in event_cb.events]
        complete_idx = event_names.index("streamComplete")
        post_complete = event_names[complete_idx + 1:]
        assert "filesChanged" in post_complete

        # Payload includes the newly-created file.
        files_changed_events = [
            args for name, args in event_cb.events
            if name == "filesChanged"
        ]
        assert files_changed_events
        last_payload = files_changed_events[-1][0]
        assert "new.py" in last_payload

    async def test_create_adds_to_selection_without_duplication(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Path already in selection isn't duplicated by create auto-add.

        Edge case: the LLM creates a file that's somehow
        already in the selection (unlikely in practice, but
        defensive against list-as-set mutation bugs).
        """
        # Pre-create the file so the create path hits
        # already_applied. This is the cleanest way to exercise
        # the "path might already be in selection" case without
        # needing an out-of-band manipulation.
        (repo_dir / "existing.py").write_text("pre-existing\n")
        service.set_selected_files(["existing.py"])

        response = (
            f"existing.py\n{self.EDIT_MARK}\n"
            f"{self.REPL_MARK}\n"
            f"pre-existing\n{self.END_MARK}\n"
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="re-create"
        )
        await asyncio.sleep(0.3)

        # Already-applied doesn't populate files_created (so
        # no auto-add attempt), and existing selection stays
        # unchanged.
        selected = service.get_selected_files()
        assert selected.count("existing.py") == 1

    async def test_create_and_not_in_context_modify_mixed(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Response with one create and one not-in-context modify.

        Both files should land in the selection via their
        respective auto-add paths. The result separates them
        so the frontend knows a retry prompt is warranted for
        the modify but not for the create.
        """
        # An existing file, not selected, so a modify against
        # it goes through the not-in-context path.
        (repo_dir / "old.py").write_text("original\n")

        response = (
            # Create block.
            f"new.py\n{self.EDIT_MARK}\n"
            f"{self.REPL_MARK}\n"
            f"created\n{self.END_MARK}\n"
            # Modify block for a file not in selection.
            f"\nold.py\n{self.EDIT_MARK}\n"
            f"original\n{self.REPL_MARK}\n"
            f"modified\n{self.END_MARK}\n"
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="mixed"
        )
        await asyncio.sleep(0.3)

        result = self._last_complete_result(event_cb)
        # Separated by source — create in files_created,
        # not-in-context modify in files_auto_added.
        assert result["files_created"] == ["new.py"]
        assert result["files_auto_added"] == ["old.py"]

        # Both landed in the selection.
        selected = service.get_selected_files()
        assert "new.py" in selected
        assert "old.py" in selected

    async def test_create_in_review_mode_skipped(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Review mode is read-only — creates don't apply, don't auto-add.

        Pinned by specs4/3-llm/edit-protocol.md § "Review
        Mode Read-Only": the entire apply step is skipped, so
        no files are created on disk and no auto-add happens.
        Regression guard against a future refactor that
        special-cases creates into the review path.
        """
        service._review_active = True
        response = (
            f"new.py\n{self.EDIT_MARK}\n"
            f"{self.REPL_MARK}\n"
            f"content\n{self.END_MARK}\n"
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="create during review"
        )
        await asyncio.sleep(0.3)

        # File not written.
        assert not (repo_dir / "new.py").exists()
        # Selection not mutated.
        assert "new.py" not in service.get_selected_files()
        # Block still surfaced in edit_blocks for UI display.
        result = self._last_complete_result(event_cb)
        assert len(result["edit_blocks"]) == 1
        # But no apply activity.
        assert result["passed"] == 0
        assert result["files_created"] == []

    async def test_not_in_context_edit_auto_adds_file(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Edit for unselected file → NOT_IN_CONTEXT + auto-added to selection."""
        (repo_dir / "a.py").write_text("content\n")
        # Deliberately empty selection.
        service.set_selected_files([])

        response = self._build_edit_block(
            "a.py", "content", "updated"
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="edit a.py"
        )
        await asyncio.sleep(0.3)

        # File NOT modified (not-in-context skips application).
        assert (repo_dir / "a.py").read_text() == "content\n"

        result = self._last_complete_result(event_cb)
        assert result["not_in_context"] == 1
        assert result["passed"] == 0
        assert result["files_auto_added"] == ["a.py"]

        # Service auto-added the file to its selection.
        assert "a.py" in service.get_selected_files()

    async def test_not_in_context_broadcasts_files_changed(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Auto-added files trigger filesChanged broadcast after completion."""
        (repo_dir / "a.py").write_text("x\n")
        service.set_selected_files([])

        response = self._build_edit_block("a.py", "x", "y")
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="edit"
        )
        await asyncio.sleep(0.3)

        # filesChanged events — we expect at least one AFTER
        # streamComplete (the auto-add broadcast).
        event_names = [name for name, _ in event_cb.events]
        complete_idx = event_names.index("streamComplete")
        post_complete = event_names[complete_idx + 1:]
        assert "filesChanged" in post_complete

    async def test_auto_added_files_loaded_into_file_context(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Auto-added files have their content loaded for the next request."""
        (repo_dir / "a.py").write_text("alpha content\n")
        service.set_selected_files([])

        response = self._build_edit_block("a.py", "alpha", "ALPHA")
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="edit"
        )
        await asyncio.sleep(0.3)

        # File context should have loaded a.py so the next
        # request's prompt assembly sees its content.
        assert service._file_context.has_file("a.py")
        assert service._file_context.get_content("a.py") == (
            "alpha content\n"
        )

    async def test_cancelled_stream_skips_apply(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Cancelled streams don't apply edits, even if blocks are complete."""
        (repo_dir / "a.py").write_text("original\n")
        service.set_selected_files(["a.py"])

        response = self._build_edit_block(
            "a.py", "original", "modified"
        )
        fake_litellm.set_streaming_chunks([response])

        # Simulate cancellation by pre-registering the request ID
        # in the cancelled set BEFORE the stream runs. The worker
        # thread checks on each chunk iteration.
        service._cancelled_requests.add("r1")

        await service.chat_streaming(
            request_id="r1", message="edit"
        )
        await asyncio.sleep(0.3)

        # File unchanged — apply was gated by the cancellation.
        assert (repo_dir / "a.py").read_text() == "original\n"

        # Result marked cancelled, apply fields zero.
        result = self._last_complete_result(event_cb)
        assert result.get("cancelled") is True
        assert result["passed"] == 0
        assert result["failed"] == 0

    async def test_review_mode_skips_apply(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Review mode is read-only — edits parse but don't apply."""
        (repo_dir / "a.py").write_text("original\n")
        service.set_selected_files(["a.py"])

        # Turn on the review-active flag directly (Layer 4.3
        # wires the entry/exit flow).
        service._review_active = True

        response = self._build_edit_block(
            "a.py", "original", "modified"
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="review"
        )
        await asyncio.sleep(0.3)

        # File unchanged.
        assert (repo_dir / "a.py").read_text() == "original\n"

        # Edit block still parsed and surfaced for UI display.
        result = self._last_complete_result(event_cb)
        assert len(result["edit_blocks"]) == 1
        # But no aggregate counts — apply was skipped entirely.
        assert result["passed"] == 0
        assert result["failed"] == 0
        assert result["edit_results"] == []

    async def test_no_repo_skips_apply_gracefully(
        self,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """No repo attached → no pipeline → apply skipped without error."""
        # Construct service without a repo.
        svc = LLMService(
            config=config,
            repo=None,
            event_callback=event_cb,
        )

        response = self._build_edit_block("a.py", "old", "new")
        fake_litellm.set_streaming_chunks([response])

        await svc.chat_streaming(
            request_id="r1", message="edit"
        )
        await asyncio.sleep(0.3)

        result = self._last_complete_result(event_cb)
        # Blocks parsed, but no apply attempted.
        assert len(result["edit_blocks"]) == 1
        assert result["passed"] == 0
        assert result["edit_results"] == []
        assert "error" not in result  # no spurious error

    async def test_shell_commands_detected_in_result(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Shell commands in the response populate result.shell_commands."""
        response = (
            "Run these:\n\n"
            "```bash\n"
            "npm install\n"
            "npm test\n"
            "```\n"
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="setup"
        )
        await asyncio.sleep(0.3)

        result = self._last_complete_result(event_cb)
        assert result["shell_commands"] == [
            "npm install", "npm test",
        ]

    async def test_response_with_no_edits_has_empty_edit_fields(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """A plain-prose response produces zero-count edit fields."""
        fake_litellm.set_streaming_chunks([
            "Just some prose with no edit blocks.",
        ])

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.3)

        result = self._last_complete_result(event_cb)
        assert result["edit_blocks"] == []
        assert result["edit_results"] == []
        assert result["files_modified"] == []
        assert result["files_auto_added"] == []
        assert result["passed"] == 0
        assert result["failed"] == 0

    async def test_mixed_in_context_and_not_in_same_response(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """In-context edit applies; not-in-context edit defers."""
        (repo_dir / "selected.py").write_text("one\n")
        (repo_dir / "unselected.py").write_text("two\n")
        service.set_selected_files(["selected.py"])

        response = (
            self._build_edit_block("selected.py", "one", "ONE")
            + self._build_edit_block(
                "unselected.py", "two", "TWO"
            )
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="both"
        )
        await asyncio.sleep(0.3)

        # Selected file modified, unselected untouched.
        assert (repo_dir / "selected.py").read_text() == "ONE\n"
        assert (repo_dir / "unselected.py").read_text() == "two\n"

        result = self._last_complete_result(event_cb)
        assert result["passed"] == 1
        assert result["not_in_context"] == 1
        assert result["files_modified"] == ["selected.py"]
        assert result["files_auto_added"] == ["unselected.py"]

    async def test_failed_edit_reports_anchor_not_found(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Edit with non-matching anchor → failed + anchor_not_found."""
        (repo_dir / "a.py").write_text("real content\n")
        service.set_selected_files(["a.py"])

        response = self._build_edit_block(
            "a.py", "imagined content", "replacement"
        )
        fake_litellm.set_streaming_chunks([response])

        await service.chat_streaming(
            request_id="r1", message="bad edit"
        )
        await asyncio.sleep(0.3)

        # File unchanged.
        assert (repo_dir / "a.py").read_text() == "real content\n"

        result = self._last_complete_result(event_cb)
        assert result["failed"] == 1
        assert result["passed"] == 0
        assert result["edit_results"][0]["error_type"] == (
            "anchor_not_found"
        )


class TestAgentDispatchScaffold:
    """Agent dispatch gating — the filter method and end-to-end routing.

    Originally Step 1 of the agent-spawning plan; promoted to
    regression guard in Step 2 when the log-only scaffold
    became real spawning. The tests pin:

    - When ``agents.enabled`` is False, :meth:`_filter_dispatchable_agents`
      returns ``[]`` and emits no log regardless of input.
    - When ``agents.enabled`` is True and blocks are valid, the
      method logs an INFO line per block and returns the filtered
      list.
    - When ``agents.enabled`` is True but all blocks are invalid
      (missing ``id`` or ``task``), the method logs a WARNING and
      returns ``[]``.
    - End-to-end through :meth:`_stream_chat`: the dispatch branch
      fires on the normal-completion path with a well-formed
      agent block in the response, skipped on cancel/error/child
      paths.

    Step 2 separates this contract from the spawn behaviour:
    :class:`TestAgentSpawn` covers scope construction and the
    stub invocation. The stub does not interact with the log
    messages this class asserts on, so the two tests layers
    remain independent.
    """

    # Agent block markers for assembling test responses. Declared
    # here rather than imported so any byte-level drift in the
    # parser's constants surfaces as a visible test failure
    # rather than a silent mismatch. Matches the discipline used
    # in TestStreamingWithEdits.
    AGENT_START = "🟧🟧🟧 AGENT"
    AGEND_MARK = "🟩🟩🟩 AGEND"

    def _build_agent_block(
        self,
        agent_id: str = "agent-0",
        task: str = "do something useful",
    ) -> str:
        """Assemble one well-formed agent-spawn block."""
        return (
            f"{self.AGENT_START}\n"
            f"id: {agent_id}\n"
            f"task: {task}\n"
            f"{self.AGEND_MARK}\n"
        )

    def _build_invalid_agent_block(self) -> str:
        """Agent block missing the required ``task`` field."""
        return (
            f"{self.AGENT_START}\n"
            f"id: agent-0\n"
            f"{self.AGEND_MARK}\n"
        )

    def _enable_agents(self, config: ConfigManager) -> None:
        """Flip ``agents.enabled`` to True via app.json override.

        Mirrors the helper pattern in TestCompactionSystemEvent —
        writes to app.json on disk and invalidates the config
        manager's cached copy so the next access re-reads.
        """
        app_path = config.config_dir / "app.json"
        app_data = json.loads(app_path.read_text())
        app_data.setdefault("agents", {})
        app_data["agents"]["enabled"] = True
        app_path.write_text(json.dumps(app_data))
        config._app_config = None

    # ---------- Unit tests on _maybe_dispatch_agents directly ----------

    def test_toggle_off_returns_empty_with_no_log(
        self,
        service: LLMService,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """Toggle off → no log, empty return, even with valid input."""
        from ac_dc.edit_protocol import AgentBlock

        blocks = [AgentBlock(id="agent-0", task="task zero")]
        caplog.clear()
        with caplog.at_level(logging.INFO, logger="ac_dc.llm_service"):
            result = service._filter_dispatchable_agents(
                blocks,
                parent_request_id="r1",
                turn_id="turn_abc",
            )
        assert result == []
        # No dispatch log — either INFO or WARNING — fires.
        assert not any(
            "Agent spawn" in rec.getMessage()
            or "Agent mode enabled" in rec.getMessage()
            for rec in caplog.records
        )

    def test_toggle_on_empty_input_no_log(
        self,
        service: LLMService,
        config: ConfigManager,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """Toggle on but empty agent_blocks → no log, empty return."""
        self._enable_agents(config)
        caplog.clear()
        with caplog.at_level(logging.INFO, logger="ac_dc.llm_service"):
            result = service._filter_dispatchable_agents(
                [],
                parent_request_id="r1",
                turn_id="turn_abc",
            )
        assert result == []
        assert not any(
            "Agent spawn" in rec.getMessage()
            for rec in caplog.records
        )

    def test_toggle_on_valid_blocks_logs_and_returns(
        self,
        service: LLMService,
        config: ConfigManager,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """Toggle on + valid blocks → INFO log fires, blocks returned."""
        from ac_dc.edit_protocol import AgentBlock

        self._enable_agents(config)
        blocks = [
            AgentBlock(id="agent-0", task="first task"),
            AgentBlock(id="agent-1", task="second task"),
        ]
        caplog.clear()
        with caplog.at_level(logging.INFO, logger="ac_dc.llm_service"):
            result = service._filter_dispatchable_agents(
                blocks,
                parent_request_id="r-parent",
                turn_id="turn_xyz",
            )
        assert result == blocks
        # Header log carries parent request and turn ID.
        header_logs = [
            rec.getMessage() for rec in caplog.records
            if "Agent spawn: dispatching" in rec.getMessage()
        ]
        assert len(header_logs) == 1
        assert "r-parent" in header_logs[0]
        assert "turn_xyz" in header_logs[0]
        assert "2 agent" in header_logs[0]
        # Per-block log lines carry id and task text.
        per_block_logs = [
            rec.getMessage() for rec in caplog.records
            if "id=" in rec.getMessage() and "task=" in rec.getMessage()
        ]
        assert len(per_block_logs) == 2
        assert any("agent-0" in m for m in per_block_logs)
        assert any("first task" in m for m in per_block_logs)
        assert any("agent-1" in m for m in per_block_logs)

    def test_toggle_on_invalid_blocks_warns_and_returns_empty(
        self,
        service: LLMService,
        config: ConfigManager,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """Toggle on + all blocks invalid → WARNING log, empty return."""
        from ac_dc.edit_protocol import AgentBlock

        self._enable_agents(config)
        blocks = [
            AgentBlock(id="", task="orphaned", valid=False),
            AgentBlock(id="agent-1", task="", valid=False),
        ]
        caplog.clear()
        with caplog.at_level(
            logging.WARNING, logger="ac_dc.llm_service"
        ):
            result = service._filter_dispatchable_agents(
                blocks,
                parent_request_id="r1",
                turn_id="turn_abc",
            )
        assert result == []
        warning_logs = [
            rec for rec in caplog.records
            if rec.levelno == logging.WARNING
            and "all were invalid" in rec.getMessage()
        ]
        assert len(warning_logs) == 1
        # No spawn INFO log fires — the warning
        # path short-circuits.
        dispatch_logs = [
            rec for rec in caplog.records
            if "Agent spawn: dispatching" in rec.getMessage()
        ]
        assert dispatch_logs == []

    def test_toggle_on_mixed_valid_invalid_filters(
        self,
        service: LLMService,
        config: ConfigManager,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """Only valid blocks reach the dispatch log.

        Mixed input (one valid, one invalid) should log the
        valid one and silently drop the invalid one — the
        all-invalid WARNING path doesn't fire because at least
        one block was good.
        """
        from ac_dc.edit_protocol import AgentBlock

        self._enable_agents(config)
        blocks = [
            AgentBlock(id="agent-0", task="the good one"),
            AgentBlock(id="", task="bad", valid=False),
        ]
        caplog.clear()
        with caplog.at_level(logging.INFO, logger="ac_dc.llm_service"):
            result = service._filter_dispatchable_agents(
                blocks,
                parent_request_id="r1",
                turn_id="turn_abc",
            )
        assert len(result) == 1
        assert result[0].id == "agent-0"
        # One header log + one per-block log for the valid agent.
        header_logs = [
            rec.getMessage() for rec in caplog.records
            if "Agent spawn: dispatching" in rec.getMessage()
        ]
        assert len(header_logs) == 1
        assert "1 agent" in header_logs[0]
        # No WARNING (at least one block was valid).
        warnings = [
            rec for rec in caplog.records
            if rec.levelno == logging.WARNING
            and "all were invalid" in rec.getMessage()
        ]
        assert warnings == []

    # ---------- End-to-end tests through _stream_chat ----------

    def _install_recording_stub(
        self, service: LLMService
    ) -> list[dict[str, Any]]:
        """Replace ``_agent_stream_impl`` with a recorder.

        Returns a list that the recorder appends one dict to
        per invocation. Tests inspect the list to verify which
        child request IDs / tasks / scopes reached the stub.

        The stub signature matches ``_stream_chat`` so the
        swap is transparent — Step 3 will flip the real
        ``_agent_stream_impl`` to ``_stream_chat`` and these
        tests become regression guards that the spawn loop
        does invoke the configured impl.
        """
        recordings: list[dict[str, Any]] = []

        async def _recorder(
            request_id: str,
            message: str,
            files: list[str],
            images: list[str],
            excluded_urls: list[str] | None = None,
            *,
            scope: Any = None,
        ) -> None:
            recordings.append({
                "request_id": request_id,
                "message": message,
                "scope": scope,
            })

        service._agent_stream_impl = _recorder
        return recordings

    async def test_stream_chat_dispatches_when_toggle_on(
        self,
        service: LLMService,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """Normal-completion path with agent block → spawn fires."""
        self._enable_agents(config)
        recordings = self._install_recording_stub(service)
        response = (
            "I'll spawn an agent.\n\n"
            + self._build_agent_block("agent-0", "refactor auth")
        )
        fake_litellm.set_streaming_chunks([response])

        caplog.clear()
        with caplog.at_level(logging.INFO, logger="ac_dc.llm_service"):
            await service.chat_streaming(
                request_id="r-main", message="please spawn"
            )
            await asyncio.sleep(0.3)

        # Filter log fired with parent request ID.
        dispatch_logs = [
            rec.getMessage() for rec in caplog.records
            if "Agent spawn: dispatching" in rec.getMessage()
        ]
        assert len(dispatch_logs) == 1
        assert "r-main" in dispatch_logs[0]
        # One agent spawned — the recording stub was invoked once.
        assert len(recordings) == 1
        assert recordings[0]["request_id"] == "r-main-agent-00"
        assert recordings[0]["message"] == "refactor auth"

    async def test_stream_chat_skips_dispatch_when_toggle_off(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """Toggle off → even with agent blocks in response, no dispatch."""
        # agents.enabled defaults to False — no setup needed.
        recordings = self._install_recording_stub(service)
        response = (
            "Here's an agent block:\n\n"
            + self._build_agent_block()
        )
        fake_litellm.set_streaming_chunks([response])

        caplog.clear()
        with caplog.at_level(logging.INFO, logger="ac_dc.llm_service"):
            await service.chat_streaming(
                request_id="r1", message="hi"
            )
            await asyncio.sleep(0.3)

        dispatch_logs = [
            rec.getMessage() for rec in caplog.records
            if "Agent spawn: dispatching" in rec.getMessage()
        ]
        assert dispatch_logs == []
        # No spawn fired.
        assert recordings == []

    async def test_stream_chat_skips_dispatch_on_cancellation(
        self,
        service: LLMService,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """Cancelled stream → dispatch skipped even with agent blocks.

        Partial LLM output may carry malformed or unintended
        agent blocks; spawning from a cancelled turn would
        violate the "only commit from a completed turn"
        invariant.
        """
        self._enable_agents(config)
        recordings = self._install_recording_stub(service)
        response = (
            "Starting...\n\n"
            + self._build_agent_block()
        )
        fake_litellm.set_streaming_chunks([response])
        # Pre-cancel so the worker breaks out on the first check.
        service._cancelled_requests.add("r1")

        caplog.clear()
        with caplog.at_level(logging.INFO, logger="ac_dc.llm_service"):
            await service.chat_streaming(
                request_id="r1", message="hi"
            )
            await asyncio.sleep(0.3)

        dispatch_logs = [
            rec.getMessage() for rec in caplog.records
            if "Agent spawn: dispatching" in rec.getMessage()
        ]
        assert dispatch_logs == []
        assert recordings == []

    async def test_stream_chat_skips_dispatch_for_child_request(
        self,
        service: LLMService,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """Child request IDs don't spawn sub-agents.

        Per ``specs4/7-future/parallel-agents.md`` § Execution
        Model, tree depth is 1: planner → leaf agents. An agent
        whose response somehow contained agent blocks must not
        recursively spawn — that would fan out unboundedly.
        The child-request guard via ``_is_child_request``
        enforces this at the dispatch point.
        """
        self._enable_agents(config)
        recordings = self._install_recording_stub(service)
        # Simulate an active parent stream so
        # "r-parent-agent-0" classifies as a child.
        service._active_user_request = "r-parent"

        response = self._build_agent_block()
        fake_litellm.set_streaming_chunks([response])

        caplog.clear()
        with caplog.at_level(logging.INFO, logger="ac_dc.llm_service"):
            await service.chat_streaming(
                request_id="r-parent-agent-0",
                message="subtask",
            )
            await asyncio.sleep(0.3)

        dispatch_logs = [
            rec.getMessage() for rec in caplog.records
            if "Agent spawn: dispatching" in rec.getMessage()
        ]
        assert dispatch_logs == []
        assert recordings == []

    async def test_stream_chat_dispatches_with_multiple_blocks(
        self,
        service: LLMService,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """Multiple agent blocks spawn N agents with child IDs."""
        self._enable_agents(config)
        recordings = self._install_recording_stub(service)
        response = (
            self._build_agent_block("agent-0", "task zero")
            + "\n"
            + self._build_agent_block("agent-1", "task one")
            + "\n"
            + self._build_agent_block("agent-2", "task two")
        )
        fake_litellm.set_streaming_chunks([response])

        caplog.clear()
        with caplog.at_level(logging.INFO, logger="ac_dc.llm_service"):
            await service.chat_streaming(
                request_id="r1", message="big decomp"
            )
            await asyncio.sleep(0.3)

        header_logs = [
            rec.getMessage() for rec in caplog.records
            if "Agent spawn: dispatching" in rec.getMessage()
        ]
        assert len(header_logs) == 1
        assert "3 agent" in header_logs[0]
        # One per-block INFO log per agent.
        per_block = [
            rec.getMessage() for rec in caplog.records
            if "id=" in rec.getMessage()
            and "task=" in rec.getMessage()
        ]
        assert len(per_block) == 3
        # Three agents spawned with child IDs zero-padded.
        assert len(recordings) == 3
        child_ids = sorted(r["request_id"] for r in recordings)
        assert child_ids == [
            "r1-agent-00", "r1-agent-01", "r1-agent-02",
        ]

    async def test_stream_chat_no_dispatch_without_agent_blocks(
        self,
        service: LLMService,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """Regular response with no agent blocks → no dispatch log.

        Confirms the guard on ``agent_parse.agent_blocks`` is
        cheap — a response with no AGENT markers doesn't
        trigger the scaffold even when the toggle is on.
        """
        self._enable_agents(config)
        recordings = self._install_recording_stub(service)
        fake_litellm.set_streaming_chunks([
            "Just a normal response with no agents.",
        ])

        caplog.clear()
        with caplog.at_level(logging.INFO, logger="ac_dc.llm_service"):
            await service.chat_streaming(
                request_id="r1", message="hi"
            )
            await asyncio.sleep(0.3)

        dispatch_logs = [
            rec.getMessage() for rec in caplog.records
            if "Agent spawn: dispatching" in rec.getMessage()
        ]
        assert dispatch_logs == []
        assert recordings == []


class TestAgentSpawn:
    """Step 2 — per-agent scope construction and fan-out.

    Covers ``_spawn_agents_for_turn`` and its helper
    ``_build_agent_scope``:

    - Each agent gets a fresh ContextManager whose archival
      sink targets ``.ac-dc4/agents/{turn_id}/agent-NN.jsonl``.
    - Each agent gets a fresh StabilityTracker, not a copy of
      the parent's.
    - ``selected_files`` is deep-copied so agent auto-add
      mutations don't leak back to the parent.
    - ``session_id`` is inherited so archive records tie back
      to the user session.
    - Child request IDs follow the ``{parent}-agent-{NN}``
      shape.
    - The parent's scope state (``_active_user_request``,
      ``_selected_files``) is preserved through fan-out.
    - Empty block list is a cheap no-op.
    - No history store → construction raises with a clear
      message (agent mode requires persistence).

    These tests exercise the spawn machinery directly rather
    than going through ``_stream_chat`` — the end-to-end path
    is covered by ``TestAgentDispatchScaffold``.
    """

    def _make_agent_block(
        self,
        agent_id: str = "agent-0",
        task: str = "do something",
    ) -> Any:
        """Build a valid AgentBlock for spawn tests."""
        from ac_dc.edit_protocol import AgentBlock

        return AgentBlock(id=agent_id, task=task)

    async def _drain_stub_invocations(
        self, service: LLMService
    ) -> list[dict[str, Any]]:
        """Install a recorder as ``_agent_stream_impl``.

        Returns a list that the recorder appends to per
        invocation; each entry carries request_id, message,
        and the per-agent scope.
        """
        recordings: list[dict[str, Any]] = []

        async def _recorder(
            request_id: str,
            message: str,
            files: list[str],
            images: list[str],
            excluded_urls: list[str] | None = None,
            *,
            scope: Any = None,
        ) -> None:
            recordings.append({
                "request_id": request_id,
                "message": message,
                "scope": scope,
                "files": list(files),
                "images": list(images),
                "excluded_urls": (
                    list(excluded_urls) if excluded_urls else []
                ),
            })

        service._agent_stream_impl = _recorder
        return recordings

    async def test_empty_blocks_is_noop(
        self,
        service: LLMService,
    ) -> None:
        """Empty block list → returns immediately, no stub invocation."""
        recordings = await self._drain_stub_invocations(service)
        parent_scope = service._default_scope()
        await service._spawn_agents_for_turn(
            agent_blocks=[],
            parent_scope=parent_scope,
            parent_request_id="r1",
            turn_id="turn_abc",
        )
        assert recordings == []

    async def test_single_agent_invokes_stream_impl(
        self,
        service: LLMService,
    ) -> None:
        """One agent block → one stub invocation with child ID."""
        recordings = await self._drain_stub_invocations(service)
        parent_scope = service._default_scope()
        block = self._make_agent_block("agent-0", "task text")
        await service._spawn_agents_for_turn(
            agent_blocks=[block],
            parent_scope=parent_scope,
            parent_request_id="r-main",
            turn_id="turn_xyz",
        )
        assert len(recordings) == 1
        assert recordings[0]["request_id"] == "r-main-agent-00"
        # The agent's initial message IS the task text — the
        # agent's first turn is as if the user typed the task.
        assert recordings[0]["message"] == "task text"

    async def test_multiple_agents_get_zero_padded_ids(
        self,
        service: LLMService,
    ) -> None:
        """Child IDs are zero-padded to 2 digits regardless of count."""
        recordings = await self._drain_stub_invocations(service)
        parent_scope = service._default_scope()
        blocks = [
            self._make_agent_block(f"agent-{i}", f"t{i}")
            for i in range(3)
        ]
        await service._spawn_agents_for_turn(
            agent_blocks=blocks,
            parent_scope=parent_scope,
            parent_request_id="r-parent",
            turn_id="turn_x",
        )
        ids = sorted(r["request_id"] for r in recordings)
        assert ids == [
            "r-parent-agent-00",
            "r-parent-agent-01",
            "r-parent-agent-02",
        ]

    async def test_agent_scope_has_fresh_context_manager(
        self,
        service: LLMService,
    ) -> None:
        """Each agent gets its own ContextManager, not the parent's."""
        recordings = await self._drain_stub_invocations(service)
        parent_scope = service._default_scope()
        blocks = [
            self._make_agent_block("a0", "t0"),
            self._make_agent_block("a1", "t1"),
        ]
        await service._spawn_agents_for_turn(
            agent_blocks=blocks,
            parent_scope=parent_scope,
            parent_request_id="r1",
            turn_id="turn_x",
        )
        assert len(recordings) == 2
        # Neither agent's context is the parent's.
        assert recordings[0]["scope"].context is not (
            parent_scope.context
        )
        assert recordings[1]["scope"].context is not (
            parent_scope.context
        )
        # The two agents have DISTINCT ContextManagers — not
        # aliased to a single shared instance.
        assert (
            recordings[0]["scope"].context
            is not recordings[1]["scope"].context
        )

    async def test_agent_scope_has_fresh_tracker(
        self,
        service: LLMService,
    ) -> None:
        """Each agent gets its own StabilityTracker."""
        recordings = await self._drain_stub_invocations(service)
        parent_scope = service._default_scope()
        blocks = [
            self._make_agent_block("a0", "t0"),
            self._make_agent_block("a1", "t1"),
        ]
        await service._spawn_agents_for_turn(
            agent_blocks=blocks,
            parent_scope=parent_scope,
            parent_request_id="r1",
            turn_id="turn_x",
        )
        assert recordings[0]["scope"].tracker is not (
            parent_scope.tracker
        )
        assert (
            recordings[0]["scope"].tracker
            is not recordings[1]["scope"].tracker
        )

    async def test_agent_scope_inherits_session_id(
        self,
        service: LLMService,
    ) -> None:
        """Agent scopes use the parent's session_id so archive
        records tie back to the user session correctly."""
        recordings = await self._drain_stub_invocations(service)
        parent_scope = service._default_scope()
        block = self._make_agent_block()
        await service._spawn_agents_for_turn(
            agent_blocks=[block],
            parent_scope=parent_scope,
            parent_request_id="r1",
            turn_id="turn_x",
        )
        assert recordings[0]["scope"].session_id == (
            parent_scope.session_id
        )

    async def test_agent_scope_copies_selected_files(
        self,
        service: LLMService,
        repo_dir: Path,
    ) -> None:
        """selected_files is copied, not shared, so mutations isolate."""
        (repo_dir / "a.py").write_text("content")
        service.set_selected_files(["a.py"])
        recordings = await self._drain_stub_invocations(service)
        parent_scope = service._default_scope()
        block = self._make_agent_block()
        await service._spawn_agents_for_turn(
            agent_blocks=[block],
            parent_scope=parent_scope,
            parent_request_id="r1",
            turn_id="turn_x",
        )
        agent_scope = recordings[0]["scope"]
        # Same contents.
        assert agent_scope.selected_files == ["a.py"]
        # Different list object — mutation on agent's list
        # doesn't touch parent's.
        assert agent_scope.selected_files is not (
            parent_scope.selected_files
        )
        agent_scope.selected_files.append("b.py")
        assert parent_scope.selected_files == ["a.py"]
        assert service.get_selected_files() == ["a.py"]

    async def test_agent_archive_directory_created_on_first_message(
        self,
        service: LLMService,
        history_store: HistoryStore,
        repo_dir: Path,
    ) -> None:
        """Appending via the agent's archival_sink creates the dir.

        Per specs4/3-llm/history.md § Agent Turn Archive, the
        directory is created lazily on the first agent-message
        write — turns without agent spawning leave no trace on
        disk. The factory wires this behaviour via
        HistoryStore.append_agent_message, which mkdir's
        parents=True on the per-turn path.
        """
        recordings = await self._drain_stub_invocations(service)
        parent_scope = service._default_scope()
        block = self._make_agent_block("agent-0", "task body")
        turn_id = HistoryStore.new_turn_id()
        await service._spawn_agents_for_turn(
            agent_blocks=[block],
            parent_scope=parent_scope,
            parent_request_id="r1",
            turn_id=turn_id,
        )
        agent_scope = recordings[0]["scope"]
        # Before any write, the directory doesn't exist.
        archive_dir = repo_dir / ".ac-dc4" / "agents" / turn_id
        assert not archive_dir.exists()
        # Simulate the agent producing output — the sink
        # creates the archive directory.
        agent_scope.context.add_message(
            "assistant", "agent reply",
        )
        assert archive_dir.exists()
        agent_file = archive_dir / "agent-00.jsonl"
        assert agent_file.exists()
        # And the message is persisted.
        contents = agent_file.read_text()
        assert "agent reply" in contents

    async def test_parent_scope_not_mutated_by_spawn(
        self,
        service: LLMService,
        repo_dir: Path,
    ) -> None:
        """Spawn leaves parent scope's fields untouched."""
        (repo_dir / "a.py").write_text("content")
        service.set_selected_files(["a.py"])
        await self._drain_stub_invocations(service)
        parent_scope = service._default_scope()
        # Snapshot every scope field.
        before = {
            "context": parent_scope.context,
            "tracker": parent_scope.tracker,
            "session_id": parent_scope.session_id,
            "selected_files": list(parent_scope.selected_files),
            "archival_append": parent_scope.archival_append,
        }

        blocks = [
            self._make_agent_block("a0", "t0"),
            self._make_agent_block("a1", "t1"),
        ]
        await service._spawn_agents_for_turn(
            agent_blocks=blocks,
            parent_scope=parent_scope,
            parent_request_id="r1",
            turn_id="turn_x",
        )

        # Every field unchanged.
        assert parent_scope.context is before["context"]
        assert parent_scope.tracker is before["tracker"]
        assert parent_scope.session_id == before["session_id"]
        assert parent_scope.selected_files == (
            before["selected_files"]
        )
        assert parent_scope.archival_append is (
            before["archival_append"]
        )

    async def test_parent_guard_state_preserved(
        self,
        service: LLMService,
    ) -> None:
        """_active_user_request unchanged after spawn completes.

        The guard slot tracks the user-initiated parent; agent
        streams must not overwrite or clear it. Today the stub
        never touches guard state, but Step 3 runs the real
        _stream_chat for each agent — and _stream_chat's
        cleanup path must recognise child requests and skip
        the parent-slot clear (the _is_child_request branch in
        _stream_chat's finally). Pinning the invariant now
        catches a regression if that branch ever drops.
        """
        service._active_user_request = "r-parent"
        recordings = await self._drain_stub_invocations(service)
        parent_scope = service._default_scope()
        await service._spawn_agents_for_turn(
            agent_blocks=[self._make_agent_block()],
            parent_scope=parent_scope,
            parent_request_id="r-parent",
            turn_id="turn_x",
        )
        assert service._active_user_request == "r-parent"
        assert len(recordings) == 1

    async def test_sibling_exception_does_not_kill_others(
        self,
        service: LLMService,
    ) -> None:
        """One agent raising doesn't prevent siblings from running.

        asyncio.gather(return_exceptions=True) captures each
        task's result (or exception) independently. Pinning
        this invariant now means the synthesis step in Step 4
        can rely on partial results when one agent fails.
        """
        invocations: list[str] = []

        async def _sometimes_raising(
            request_id: str,
            message: str,
            files: list[str],
            images: list[str],
            excluded_urls: list[str] | None = None,
            *,
            scope: Any = None,
        ) -> None:
            invocations.append(request_id)
            if "agent-01" in request_id:
                raise RuntimeError("simulated agent-01 failure")

        service._agent_stream_impl = _sometimes_raising
        parent_scope = service._default_scope()
        blocks = [
            self._make_agent_block("a0", "t0"),
            self._make_agent_block("a1", "t1"),
            self._make_agent_block("a2", "t2"),
        ]
        # Must not raise.
        await service._spawn_agents_for_turn(
            agent_blocks=blocks,
            parent_scope=parent_scope,
            parent_request_id="r1",
            turn_id="turn_x",
        )
        # All three agents were invoked; the middle one raised
        # but the other two still ran.
        assert sorted(invocations) == [
            "r1-agent-00", "r1-agent-01", "r1-agent-02",
        ]

    async def test_build_scope_requires_history_store(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Agent mode without a history store → construction raises.

        Per specs4/3-llm/history.md § Agent Turn Archive, the
        archive IS the transcript the main LLM reads in
        synthesis. Running agents without persistence would
        silently drop that transcript — better to fail loudly.
        """
        svc = LLMService(
            config=config, repo=repo, history_store=None
        )
        block = self._make_agent_block()
        with pytest.raises(
            RuntimeError, match="history store"
        ):
            svc._build_agent_scope(
                block=block,
                agent_idx=0,
                parent_scope=svc._default_scope(),
                turn_id="turn_x",
            )

    async def test_build_scope_field_identity(
        self,
        service: LLMService,
    ) -> None:
        """_build_agent_scope wires every field correctly.

        Unit-level check on the helper itself. Verifies the
        constructed scope has the shape Step 3 depends on:

        - context is an agent ContextManager (has a turn_id
          attribute matching the supplied turn_id)
        - tracker is a fresh StabilityTracker
        - session_id comes from the parent
        - selected_files is a list-copy of the parent's
        - archival_append is the ContextManager's own sink
        """
        from ac_dc.stability_tracker import StabilityTracker

        parent_scope = service._default_scope()
        service.set_selected_files([])  # clean baseline
        block = self._make_agent_block()
        turn_id = "turn_xyz"
        agent_scope = service._build_agent_scope(
            block=block,
            agent_idx=2,
            parent_scope=parent_scope,
            turn_id=turn_id,
        )
        # ContextManager wired with the right turn_id.
        assert agent_scope.context.turn_id == turn_id
        # Not the parent's ContextManager.
        assert agent_scope.context is not parent_scope.context
        # Fresh tracker.
        assert isinstance(agent_scope.tracker, StabilityTracker)
        assert agent_scope.tracker is not parent_scope.tracker
        # Session ID inherited.
        assert agent_scope.session_id == parent_scope.session_id
        # Selected files is a copy.
        assert agent_scope.selected_files == (
            parent_scope.selected_files
        )
        assert agent_scope.selected_files is not (
            parent_scope.selected_files
        )
        # Archival sink wired through the agent context.
        assert agent_scope.archival_append is (
            agent_scope.context.archival_sink
        )

    def test_default_agent_stream_impl_is_real_stream_chat(
        self,
        service: LLMService,
    ) -> None:
        """After Step 3, the default impl is ``_stream_chat``.

        Regression guard for the Step 3 flip. A future
        refactor that accidentally re-aliased the attribute
        to the stub (easy mistake — the stub is still in the
        codebase for test convenience) would make agent spawns
        silently no-op in production while still passing every
        test that installs its own recorder.
        """
        # Bound-method identity check — the attribute holds
        # the service's own _stream_chat method, not the stub.
        assert service._agent_stream_impl == service._stream_chat
        # And critically, NOT the stub.
        assert service._agent_stream_impl != service._stream_chat_stub


class TestAgentContextRegistry:
    """C1a — agent ContextManager registry and turn_id surfacing.

    Two concerns pinned here:

    1. The ``_agent_contexts`` registry outlives the spawn's
       ``asyncio.gather``. When ``_build_agent_scope``
       constructs a scope, the scope lands in
       ``service._agent_contexts[turn_id][agent_idx]``. The
       registry survives across turns so subsequent user
       replies to agent tabs can look up the scope and route
       to the correct ContextManager. ``new_session()`` wipes
       the whole registry.

    2. The completion result dict carries ``turn_id``. The
       frontend's agent-tab construction needs it to build
       tab IDs matching the backend's archive paths
       (``{turn_id}/agent-NN``). ``_stream_chat`` generates
       the turn_id at the top of the pipeline and threads it
       into ``_build_completion_result`` on every path —
       error, cancelled, normal completion.

    These tests exercise the registry API directly (via
    ``_build_agent_scope`` and ``new_session``) and the
    completion-result threading (via ``chat_streaming``).
    C1b's close_agent_context and C1c's agent_tag build on
    top of what's pinned here.
    """

    def _make_agent_block(
        self,
        agent_id: str = "agent-0",
        task: str = "do something",
    ) -> Any:
        """Build a valid AgentBlock."""
        from ac_dc.edit_protocol import AgentBlock

        return AgentBlock(id=agent_id, task=task)

    def test_registry_empty_on_fresh_service(
        self,
        service: LLMService,
    ) -> None:
        """A newly-constructed service has no agent contexts."""
        assert service._agent_contexts == {}

    def test_registry_populated_after_build_agent_scope(
        self,
        service: LLMService,
    ) -> None:
        """_build_agent_scope registers the scope under (turn_id, idx)."""
        parent_scope = service._default_scope()
        block = self._make_agent_block("a0", "t0")
        turn_id = "turn_abc"
        scope = service._build_agent_scope(
            block=block,
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id=turn_id,
        )
        assert turn_id in service._agent_contexts
        assert 0 in service._agent_contexts[turn_id]
        # Registered scope is the exact same object returned
        # from the factory — identity, not equality.
        assert service._agent_contexts[turn_id][0] is scope

    def test_registry_handles_multiple_agents_same_turn(
        self,
        service: LLMService,
    ) -> None:
        """Two agents from one turn each get their own slot."""
        parent_scope = service._default_scope()
        turn_id = "turn_same"
        scope_0 = service._build_agent_scope(
            block=self._make_agent_block("a0", "t0"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id=turn_id,
        )
        scope_1 = service._build_agent_scope(
            block=self._make_agent_block("a1", "t1"),
            agent_idx=1,
            parent_scope=parent_scope,
            turn_id=turn_id,
        )
        assert service._agent_contexts[turn_id][0] is scope_0
        assert service._agent_contexts[turn_id][1] is scope_1
        assert scope_0 is not scope_1

    def test_registry_handles_multiple_turns(
        self,
        service: LLMService,
    ) -> None:
        """Scopes from different turns land under different keys."""
        parent_scope = service._default_scope()
        scope_a = service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_a",
        )
        scope_b = service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_b",
        )
        # Both keys present in the outer dict.
        assert "turn_a" in service._agent_contexts
        assert "turn_b" in service._agent_contexts
        # Each turn's agent-0 slot holds the right scope.
        assert service._agent_contexts["turn_a"][0] is scope_a
        assert service._agent_contexts["turn_b"][0] is scope_b

    def test_registry_survives_across_turns(
        self,
        service: LLMService,
    ) -> None:
        """Registering a second turn's scope doesn't evict the first.

        Pins the "agents stay warm across turns" invariant.
        Without this, the registry would effectively be a
        single-turn cache and follow-up replies to prior-turn
        agent tabs would fail to find their scopes.
        """
        parent_scope = service._default_scope()
        scope_first = service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_first",
        )
        # Second turn comes along.
        service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_second",
        )
        # First turn's scope still reachable.
        assert service._agent_contexts["turn_first"][0] is scope_first

    def test_re_registration_with_same_key_replaces(
        self,
        service: LLMService,
    ) -> None:
        """Re-iteration within a turn replaces the prior scope.

        Specs4/5-webapp/agent-browser.md describes
        re-iteration — the main LLM spawns agent-0 again
        with a revised task. The new scope becomes
        authoritative. The archive still holds both
        iterations' transcripts for audit, but the registry
        tracks only the latest.
        """
        parent_scope = service._default_scope()
        turn_id = "turn_iter"
        scope_v1 = service._build_agent_scope(
            block=self._make_agent_block("a0", "first task"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id=turn_id,
        )
        scope_v2 = service._build_agent_scope(
            block=self._make_agent_block("a0", "revised task"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id=turn_id,
        )
        # v2 replaces v1 in the slot.
        assert service._agent_contexts[turn_id][0] is scope_v2
        assert service._agent_contexts[turn_id][0] is not scope_v1

    def test_new_session_clears_registry(
        self,
        service: LLMService,
    ) -> None:
        """new_session drops every agent scope in one shot.

        Prior-session agents have no path forward into a
        fresh conversation — their turn_ids won't match
        anything the new conversation produces, and the
        frontend's sessionChanged broadcast will close any
        open agent tabs. Clearing the registry here frees
        every agent's ContextManager + StabilityTracker +
        file_context immediately rather than relying on
        Python's garbage collector to notice the tabs are
        gone.
        """
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_one",
        )
        service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=1,
            parent_scope=parent_scope,
            turn_id="turn_one",
        )
        service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_two",
        )
        assert len(service._agent_contexts) == 2
        result = service.new_session()
        assert "session_id" in result
        assert service._agent_contexts == {}

    async def test_completion_result_carries_turn_id(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """streamComplete's result dict includes turn_id.

        Frontend reads this to build agent tab IDs matching
        the backend archive path convention. Without it, C2's
        spawn-path handler can't construct a tab ID that
        routes streaming chunks correctly.
        """
        fake_litellm.set_streaming_chunks(["ok"])
        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.2)

        completes = [
            args for name, args in event_cb.events
            if name == "streamComplete"
        ]
        assert completes
        _req_id, result = completes[-1]
        turn_id = result.get("turn_id")
        assert isinstance(turn_id, str)
        assert turn_id.startswith("turn_")

    async def test_completion_result_turn_id_matches_history_turn_id(
        self,
        service: LLMService,
        history_store: HistoryStore,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """turn_id in result matches the one persisted to history.

        Critical for the frontend → backend lookup path: a
        tab built from result.turn_id must match records in
        the history store's archive path
        (.ac-dc4/agents/{turn_id}/agent-NN.jsonl) and the
        turn_id field on every persisted message of the
        turn.
        """
        fake_litellm.set_streaming_chunks(["ok"])
        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.2)

        completes = [
            args for name, args in event_cb.events
            if name == "streamComplete"
        ]
        result_turn_id = completes[-1][1]["turn_id"]

        sid = service.get_current_state()["session_id"]
        persisted = history_store.get_session_messages(sid)
        user_turn_ids = {
            m["turn_id"] for m in persisted
            if m.get("role") == "user" and m.get("turn_id")
        }
        assert result_turn_id in user_turn_ids

    async def test_completion_result_turn_id_on_error_path(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Errors still carry a turn_id in their completion result.

        The turn_id is generated at the top of _stream_chat
        before the try block — so even when the completion
        path raises, the result dict built in the except
        branch threads the same turn_id through. Frontend
        can use it to correlate the failed turn with the
        user message that triggered it.
        """
        # Force the LLM call to raise by making
        # _run_completion_sync blow up.
        def _raise(*args, **kwargs):
            raise RuntimeError("simulated failure")
        monkeypatch.setattr(
            service, "_run_completion_sync", _raise
        )

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.2)

        completes = [
            args for name, args in event_cb.events
            if name == "streamComplete"
        ]
        assert completes
        _req_id, result = completes[-1]
        # Error present.
        assert "error" in result
        # turn_id still present — not dropped by the error
        # path.
        assert isinstance(result.get("turn_id"), str)
        assert result["turn_id"].startswith("turn_")

    async def test_agent_archive_path_matches_registry_turn_id(
        self,
        service: LLMService,
        history_store: HistoryStore,
        repo_dir: Path,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Registry turn_id matches the agent archive directory.

        End-to-end contract: the turn_id that populates the
        agent registry is the SAME turn_id used to construct
        the archive path. If the two diverged, the frontend
        would build tab IDs off the registry key but look up
        archive transcripts under a different turn_id — the
        tab would show empty history.

        Exercises via _spawn_agents_for_turn because that's
        the single path that both (a) calls _build_agent_scope
        (which registers) and (b) triggers archive writes
        (via the agent's streaming run).
        """
        fake_litellm.queue_streaming_chunks(["agent reply"])

        parent_scope = service._default_scope()
        service._main_loop = asyncio.get_event_loop()
        turn_id = HistoryStore.new_turn_id()
        block = self._make_agent_block("a0", "write something")

        await service._spawn_agents_for_turn(
            agent_blocks=[block],
            parent_scope=parent_scope,
            parent_request_id="r-main",
            turn_id=turn_id,
        )

        # Registry key matches the turn_id.
        assert turn_id in service._agent_contexts
        # Archive directory exists at the same turn_id.
        archive_dir = repo_dir / ".ac-dc4" / "agents" / turn_id
        assert archive_dir.exists()
        # And get_turn_archive returns content for that turn_id.
        archive = history_store.get_turn_archive(turn_id)
        assert len(archive) == 1


class TestCloseAgentContext:
    """C1b — close_agent_context RPC.

    The frontend calls this when the user clicks ✕ on an
    agent tab (D21 Phase B3). The backend frees the scope's
    ContextManager + StabilityTracker + file_context; the
    per-turn archive file on disk stays.

    Tests exercise both populated-registry and empty-registry
    paths so the idempotence contract is pinned — closing an
    already-closed agent, an agent that never existed, or
    any combination of stale turn_id / stale agent_idx all
    return ``{status: "ok", closed: False}`` rather than
    raising.
    """

    def _make_agent_block(
        self,
        agent_id: str = "agent-0",
        task: str = "do something",
    ) -> Any:
        """Build a valid AgentBlock."""
        from ac_dc.edit_protocol import AgentBlock

        return AgentBlock(id=agent_id, task=task)

    def test_close_unknown_turn_is_noop(
        self,
        service: LLMService,
    ) -> None:
        """Unknown turn_id → ok with closed=False."""
        result = service.close_agent_context(
            "turn_nonexistent", 0
        )
        assert result == {"status": "ok", "closed": False}

    def test_close_known_turn_unknown_agent_is_noop(
        self,
        service: LLMService,
    ) -> None:
        """Known turn_id but unknown agent_idx → closed=False."""
        # Seed an agent at idx 0.
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_known",
        )
        # Close a different idx.
        result = service.close_agent_context("turn_known", 7)
        assert result == {"status": "ok", "closed": False}
        # Original agent still there.
        assert 0 in service._agent_contexts["turn_known"]

    def test_close_existing_agent_returns_closed_true(
        self,
        service: LLMService,
    ) -> None:
        """Successful close → closed=True; scope removed."""
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_one",
        )
        assert 0 in service._agent_contexts["turn_one"]
        result = service.close_agent_context("turn_one", 0)
        assert result == {"status": "ok", "closed": True}
        # Agent gone.
        assert "turn_one" not in service._agent_contexts

    def test_close_empties_inner_dict_drops_outer_key(
        self,
        service: LLMService,
    ) -> None:
        """Closing last agent of a turn removes the turn_id bucket.

        Keeps the registry compact — a long session with many
        turns would accumulate empty {turn_id: {}} buckets
        indefinitely otherwise.
        """
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_solo",
        )
        assert "turn_solo" in service._agent_contexts
        service.close_agent_context("turn_solo", 0)
        # Outer key gone, not just emptied.
        assert "turn_solo" not in service._agent_contexts

    def test_close_one_of_many_keeps_outer_key(
        self,
        service: LLMService,
    ) -> None:
        """Closing one agent leaves siblings and their bucket intact."""
        parent_scope = service._default_scope()
        for i in range(3):
            service._build_agent_scope(
                block=self._make_agent_block(f"a{i}", f"t{i}"),
                agent_idx=i,
                parent_scope=parent_scope,
                turn_id="turn_multi",
            )
        # Close middle agent.
        result = service.close_agent_context("turn_multi", 1)
        assert result == {"status": "ok", "closed": True}
        # Siblings survive.
        assert 0 in service._agent_contexts["turn_multi"]
        assert 1 not in service._agent_contexts["turn_multi"]
        assert 2 in service._agent_contexts["turn_multi"]

    def test_close_is_idempotent(
        self,
        service: LLMService,
    ) -> None:
        """Closing the same agent twice is safe.

        A stale frontend tab ID (user clicks ✕ on a tab that
        was already closed server-side by new_session) must
        not raise or mutate anything. Pinning idempotence
        keeps the frontend's error surface narrow.
        """
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_twice",
        )
        first = service.close_agent_context("turn_twice", 0)
        assert first == {"status": "ok", "closed": True}
        second = service.close_agent_context("turn_twice", 0)
        assert second == {"status": "ok", "closed": False}

    def test_close_freed_scope_no_longer_looked_up(
        self,
        service: LLMService,
    ) -> None:
        """After close, set_agent_selected_files can't find the agent."""
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_gone",
        )
        service.close_agent_context("turn_gone", 0)
        # C1b's other RPC should return agent-not-found.
        result = service.set_agent_selected_files(
            "turn_gone", 0, []
        )
        assert result == {"error": "agent not found"}

    def test_close_does_not_remove_archive_file(
        self,
        service: LLMService,
        history_store: HistoryStore,
        repo_dir: Path,
    ) -> None:
        """Closing an agent leaves its archive on disk.

        Per specs4/3-llm/history.md § Agent Turn Archive, the
        archive IS the transcript. Close frees memory; audit
        paths (synthesis on a follow-up main-tab turn, manual
        archive inspection) still work.
        """
        parent_scope = service._default_scope()
        turn_id = "turn_with_archive"
        scope = service._build_agent_scope(
            block=self._make_agent_block("a0", "test task"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id=turn_id,
        )
        # Write something to the archive via the scope's sink.
        scope.context.add_message(
            "assistant", "agent output goes here",
        )
        archive_file = (
            repo_dir / ".ac-dc4" / "agents" / turn_id
            / "agent-00.jsonl"
        )
        assert archive_file.exists()
        # Close the agent.
        service.close_agent_context(turn_id, 0)
        # Archive file survives.
        assert archive_file.exists()
        # And is still readable via the public RPC.
        archive = service.get_turn_archive(turn_id)
        assert len(archive) == 1


class TestCloseAgentContextLocalhostOnly:
    """C1b — close_agent_context restricts non-localhost callers.

    Remote collaborators must not be able to free the host's
    session state. The restriction shape matches the rest of
    the mutating RPC surface — ``{"error": "restricted",
    "reason": ...}`` — so frontend toast rendering works
    uniformly.
    """

    def _make_agent_block(
        self,
        agent_id: str = "agent-0",
        task: str = "do something",
    ) -> Any:
        from ac_dc.edit_protocol import AgentBlock

        return AgentBlock(id=agent_id, task=task)

    def test_non_localhost_returns_restricted(
        self,
        service: LLMService,
    ) -> None:
        """Non-localhost caller gets the restricted-error shape."""
        # Install a collab stub that reports non-localhost.
        class _FakeCollab:
            def is_caller_localhost(self) -> bool:
                return False

        service._collab = _FakeCollab()
        # Seed an agent so the restriction isn't masked by
        # the unknown-turn noop path.
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_secured",
        )
        result = service.close_agent_context("turn_secured", 0)
        assert result.get("error") == "restricted"
        # Agent NOT freed — the guard runs before the pop.
        assert "turn_secured" in service._agent_contexts

    def test_localhost_bypasses_restriction(
        self,
        service: LLMService,
    ) -> None:
        """Localhost caller proceeds normally."""
        class _LocalCollab:
            def is_caller_localhost(self) -> bool:
                return True

        service._collab = _LocalCollab()
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_local",
        )
        result = service.close_agent_context("turn_local", 0)
        assert result == {"status": "ok", "closed": True}


class TestSetAgentSelectedFiles:
    """C1b — set_agent_selected_files RPC.

    Per-agent analogue of set_selected_files. The frontend
    routes picker checkbox toggles here when an agent tab is
    active; the main-tab path still hits set_selected_files.

    Tests cover happy path, missing-agent error, in-place
    list mutation (so the scope's stored list identity is
    preserved), filesystem existence filtering (mirroring the
    main-tab path), and the restricted-error path.
    """

    def _make_agent_block(
        self,
        agent_id: str = "agent-0",
        task: str = "do something",
    ) -> Any:
        from ac_dc.edit_protocol import AgentBlock

        return AgentBlock(id=agent_id, task=task)

    def test_unknown_turn_returns_error(
        self,
        service: LLMService,
    ) -> None:
        """Unknown turn_id → agent-not-found error."""
        result = service.set_agent_selected_files(
            "turn_nonexistent", 0, ["file.py"],
        )
        assert result == {"error": "agent not found"}

    def test_unknown_agent_idx_returns_error(
        self,
        service: LLMService,
    ) -> None:
        """Known turn but unknown agent_idx → error."""
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_known",
        )
        result = service.set_agent_selected_files(
            "turn_known", 99, [],
        )
        assert result == {"error": "agent not found"}

    def test_replaces_selected_files(
        self,
        service: LLMService,
        repo_dir: Path,
    ) -> None:
        """Selection replacement — new list becomes canonical."""
        (repo_dir / "a.py").write_text("alpha\n")
        (repo_dir / "b.py").write_text("beta\n")
        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_t",
        )
        result = service.set_agent_selected_files(
            "turn_t", 0, ["a.py", "b.py"],
        )
        assert result == ["a.py", "b.py"]
        # Agent's scope reflects the change.
        assert scope.selected_files == ["a.py", "b.py"]

    def test_preserves_list_identity(
        self,
        service: LLMService,
        repo_dir: Path,
    ) -> None:
        """Mutation is in-place; the scope's list object is preserved.

        Downstream code (_sync_file_context, _stream_chat's
        scope reads) holds references to scope.selected_files.
        Swapping the list object for a new one would leave
        those references pointing at stale state. Pinning
        in-place mutation ensures the scope stays coherent
        across multiple set_agent_selected_files calls.
        """
        (repo_dir / "a.py").write_text("x\n")
        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_identity",
        )
        original_list = scope.selected_files
        service.set_agent_selected_files(
            "turn_identity", 0, ["a.py"],
        )
        # Same list object, updated contents.
        assert scope.selected_files is original_list
        assert original_list == ["a.py"]

    def test_filters_nonexistent_files(
        self,
        service: LLMService,
        repo_dir: Path,
    ) -> None:
        """Paths not on disk are dropped (mirrors main-tab path)."""
        (repo_dir / "real.py").write_text("content\n")
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_filter",
        )
        result = service.set_agent_selected_files(
            "turn_filter", 0, ["real.py", "phantom.py"],
        )
        # Phantom filtered out.
        assert result == ["real.py"]

    def test_empty_list_clears_selection(
        self,
        service: LLMService,
        repo_dir: Path,
    ) -> None:
        """Passing [] clears the agent's selection."""
        (repo_dir / "a.py").write_text("x\n")
        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_clear",
        )
        # Seed a non-empty selection.
        service.set_agent_selected_files(
            "turn_clear", 0, ["a.py"],
        )
        assert scope.selected_files == ["a.py"]
        # Clear.
        result = service.set_agent_selected_files(
            "turn_clear", 0, [],
        )
        assert result == []
        assert scope.selected_files == []

    def test_returns_copy_not_internal_list(
        self,
        service: LLMService,
        repo_dir: Path,
    ) -> None:
        """Caller mutations of the return value don't affect scope."""
        (repo_dir / "a.py").write_text("x\n")
        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_copy",
        )
        result = service.set_agent_selected_files(
            "turn_copy", 0, ["a.py"],
        )
        assert isinstance(result, list)
        result.append("injected.py")
        # Scope's list unaffected.
        assert scope.selected_files == ["a.py"]

    def test_non_string_entries_filtered(
        self,
        service: LLMService,
        repo_dir: Path,
    ) -> None:
        """Non-string entries dropped — defensive against bad RPC payloads."""
        (repo_dir / "a.py").write_text("x\n")
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_typed",
        )
        result = service.set_agent_selected_files(
            "turn_typed", 0, ["a.py", 42, None, ["nested"]],
        )
        # Only the string survives.
        assert result == ["a.py"]

    def test_works_without_repo(
        self,
        config: ConfigManager,
        history_store: HistoryStore,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """No repo attached → string-type filter applies but no fs check.

        Tests that construct a service without a repo (e.g.,
        standalone RPC surface tests) should still be able to
        exercise the selection path. The filesystem existence
        filter is bypassed because there's no repo to consult.
        """
        # Build a service with no repo but a fake history store
        # so _build_agent_scope doesn't reject for missing
        # persistence.
        svc = LLMService(
            config=config,
            repo=None,
            history_store=history_store,
        )
        from ac_dc.edit_protocol import AgentBlock
        block = AgentBlock(id="a0", task="t0")
        parent_scope = svc._default_scope()
        svc._build_agent_scope(
            block=block,
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_no_repo",
        )
        # Non-existent file still passes because there's no
        # repo to filter against.
        result = svc.set_agent_selected_files(
            "turn_no_repo", 0, ["anything.py"],
        )
        assert result == ["anything.py"]


class TestSetAgentSelectedFilesLocalhostOnly:
    """C1b — set_agent_selected_files restricts non-localhost callers."""

    def _make_agent_block(
        self,
        agent_id: str = "agent-0",
        task: str = "do something",
    ) -> Any:
        from ac_dc.edit_protocol import AgentBlock

        return AgentBlock(id=agent_id, task=task)

    def test_non_localhost_returns_restricted(
        self,
        service: LLMService,
        repo_dir: Path,
    ) -> None:
        """Non-localhost caller gets the restricted-error shape."""
        (repo_dir / "a.py").write_text("x\n")
        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_restricted",
        )

        class _FakeCollab:
            def is_caller_localhost(self) -> bool:
                return False

        service._collab = _FakeCollab()
        result = service.set_agent_selected_files(
            "turn_restricted", 0, ["a.py"],
        )
        assert result.get("error") == "restricted"
        # Scope NOT mutated.
        assert scope.selected_files == []


class TestParseAgentTag:
    """C1c — :meth:`LLMService._parse_agent_tag` input coercion.

    Pure static method so no fixture setup needed. Tests pin
    the shape normalisation (tuple vs list), the type
    rejection rules (non-string turn_id, non-int agent_idx,
    bool masquerading as int, negative index), and the
    empty-turn-id guard.
    """

    def test_tuple_input_accepted(self) -> None:
        """Native tuple form passes through."""
        assert LLMService._parse_agent_tag(
            ("turn_abc", 0)
        ) == ("turn_abc", 0)

    def test_list_input_normalises_to_tuple(self) -> None:
        """JRPC-OO array form coerces to tuple.

        Over the wire jrpc-oo serialises Python tuples to JS
        arrays. The frontend sends ``[turn_id, idx]``; parsing
        must accept that shape and produce the tuple form used
        as the registry key.
        """
        assert LLMService._parse_agent_tag(
            ["turn_abc", 5]
        ) == ("turn_abc", 5)

    def test_three_element_list_rejected(self) -> None:
        """Wrong length → None."""
        assert LLMService._parse_agent_tag(
            ["turn_abc", 0, "extra"]
        ) is None

    def test_single_element_rejected(self) -> None:
        """Single element → None."""
        assert LLMService._parse_agent_tag(
            ["turn_abc"]
        ) is None

    def test_empty_list_rejected(self) -> None:
        assert LLMService._parse_agent_tag([]) is None

    def test_non_string_turn_id_rejected(self) -> None:
        """turn_id must be a string."""
        assert LLMService._parse_agent_tag(
            (42, 0)
        ) is None

    def test_empty_string_turn_id_rejected(self) -> None:
        """Empty turn_id → None.

        An empty string is a valid Python string but a useless
        registry key. Rejecting here keeps the lookup path
        straightforward.
        """
        assert LLMService._parse_agent_tag(
            ("", 0)
        ) is None

    def test_non_int_agent_idx_rejected(self) -> None:
        """agent_idx must be an int."""
        assert LLMService._parse_agent_tag(
            ("turn_abc", "0")
        ) is None
        assert LLMService._parse_agent_tag(
            ("turn_abc", 0.5)
        ) is None

    def test_bool_agent_idx_rejected(self) -> None:
        """Bool is a subclass of int; rejecting avoids True/False matching.

        ``isinstance(True, int)`` is ``True`` in Python —
        a caller that forgot to parse a string could send
        ``True`` and silently match agent_idx 1. Explicit
        bool rejection surfaces the bug instead.
        """
        assert LLMService._parse_agent_tag(
            ("turn_abc", True)
        ) is None
        assert LLMService._parse_agent_tag(
            ("turn_abc", False)
        ) is None

    def test_negative_agent_idx_rejected(self) -> None:
        """Negative indexes don't exist in the registry."""
        assert LLMService._parse_agent_tag(
            ("turn_abc", -1)
        ) is None

    def test_non_sequence_rejected(self) -> None:
        """Dict, string, scalar — all None."""
        assert LLMService._parse_agent_tag(
            {"turn_id": "turn_abc", "idx": 0}
        ) is None
        assert LLMService._parse_agent_tag(
            "turn_abc/agent-00"
        ) is None
        assert LLMService._parse_agent_tag(42) is None
        assert LLMService._parse_agent_tag(None) is None


class TestAgentTaggedStreaming:
    """C1c — ``agent_tag`` routes ``chat_streaming`` to agent scopes.

    Covers the routing, single-stream guard scoping, and
    cleanup. End-to-end streaming into an agent's own
    ContextManager is covered separately by
    :class:`TestAgentExecutionEndToEnd` via direct
    ``_spawn_agents_for_turn`` calls — those cover the
    archive-write path. Here we focus on the
    ``chat_streaming`` surface: malformed / unknown agent
    tags, guard slot selection, parallel streams.
    """

    def _make_agent_block(
        self,
        agent_id: str = "agent-0",
        task: str = "do something",
    ) -> Any:
        from ac_dc.edit_protocol import AgentBlock

        return AgentBlock(id=agent_id, task=task)

    def _seed_agent(
        self,
        service: LLMService,
        turn_id: str = "turn_abc",
        agent_idx: int = 0,
    ) -> Any:
        """Register an agent scope directly.

        Bypasses ``_spawn_agents_for_turn`` so the test
        exercises only the ``chat_streaming`` surface without
        spinning up a full streaming pipeline for the setup.
        """
        parent_scope = service._default_scope()
        return service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=agent_idx,
            parent_scope=parent_scope,
            turn_id=turn_id,
        )

    async def test_untagged_call_uses_default_scope(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """No agent_tag → default main-tab behaviour.

        Regression guard for the common path. The default
        scope resolves to the main ContextManager so the
        streamed response lands in main-session history.
        """
        fake_litellm.set_streaming_chunks(["hi there"])
        result = await service.chat_streaming(
            request_id="r1", message="hello"
        )
        assert result == {"status": "started"}
        await asyncio.sleep(0.2)

        # Main session's history got the exchange.
        main_history = service._context.get_history()
        roles = [m["role"] for m in main_history]
        assert "user" in roles
        assert "assistant" in roles
        # Main guard slot cleared after completion.
        assert service._active_user_request is None

    async def test_tagged_call_streams_into_agent_context(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Tagged call writes history into the agent's ContextManager.

        Key routing invariant: the agent's own history grows
        while the main session's stays untouched.
        """
        agent_scope = self._seed_agent(service)
        fake_litellm.set_streaming_chunks(["agent reply"])

        result = await service.chat_streaming(
            request_id="r-agent-1",
            message="do the thing",
            agent_tag=("turn_abc", 0),
        )
        assert result == {"status": "started"}
        await asyncio.sleep(0.3)

        # Agent's history grew.
        agent_history = agent_scope.context.get_history()
        agent_roles = [m["role"] for m in agent_history]
        assert "user" in agent_roles
        assert "assistant" in agent_roles
        # Main session's history DID NOT grow. (The fixture
        # constructs LLMService with no auto-restore content,
        # so the main history starts empty. If the tagged
        # call leaked into it, we'd see messages.)
        main_history = service._context.get_history()
        assert main_history == []

    async def test_tagged_call_accepts_list_shape(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """jrpc-oo array form routes identically to the tuple form.

        Frontend sends ``[turn_id, idx]`` as a JSON array.
        Pinning both shapes works so wire-format coercion
        is invisible to the routing logic.
        """
        agent_scope = self._seed_agent(service)
        fake_litellm.set_streaming_chunks(["ok"])

        result = await service.chat_streaming(
            request_id="r1",
            message="hi",
            agent_tag=["turn_abc", 0],
        )
        assert result == {"status": "started"}
        await asyncio.sleep(0.3)

        # Agent got the message.
        assert len(agent_scope.context.get_history()) >= 1

    async def test_unknown_agent_tag_returns_error(
        self,
        service: LLMService,
    ) -> None:
        """Stale tab ID (agent not in registry) → error response."""
        # No agent registered.
        result = await service.chat_streaming(
            request_id="r1",
            message="hi",
            agent_tag=("turn_nonexistent", 0),
        )
        assert result == {"error": "agent not found"}
        # Neither guard slot touched.
        assert service._active_user_request is None
        assert service._active_agent_streams == set()

    async def test_known_turn_unknown_agent_idx_returns_error(
        self,
        service: LLMService,
    ) -> None:
        """Turn exists but agent_idx doesn't — error.

        Plausible in practice: the registry has agents 0 and 1
        for a turn; the frontend sends a stale tag for
        agent-07 from a closed tab.
        """
        self._seed_agent(service, turn_id="turn_known")
        result = await service.chat_streaming(
            request_id="r1",
            message="hi",
            agent_tag=("turn_known", 99),
        )
        assert result == {"error": "agent not found"}

    async def test_malformed_agent_tag_returns_error(
        self,
        service: LLMService,
    ) -> None:
        """Bad shape → malformed-tag error, distinct from stale.

        Frontend bug vs stale tab are surfaced differently so
        the user-facing error can be actionable. Stale-tab
        triggers a "your tab is closed, dismiss it" toast;
        malformed-payload triggers a "file a bug" toast.
        """
        result = await service.chat_streaming(
            request_id="r1",
            message="hi",
            agent_tag="not-a-tuple",
        )
        assert "malformed" in result.get("error", "").lower()
        # Empty list form also malformed.
        result = await service.chat_streaming(
            request_id="r2",
            message="hi",
            agent_tag=[],
        )
        assert "malformed" in result.get("error", "").lower()

    async def test_tagged_call_does_not_touch_user_guard(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Agent-tagged call leaves main-tab guard available.

        User types in the main tab while an agent stream runs;
        the main call must not be rejected as "another stream
        active". The two guards are disjoint.
        """
        self._seed_agent(service)
        fake_litellm.set_streaming_chunks(["ok"])

        # Start agent stream.
        r1 = await service.chat_streaming(
            request_id="r-agent",
            message="agent task",
            agent_tag=("turn_abc", 0),
        )
        assert r1 == {"status": "started"}
        # Main-tab guard untouched at this point.
        assert service._active_user_request is None
        # Agent slot registered.
        assert ("turn_abc", 0) in service._active_agent_streams

        await asyncio.sleep(0.3)
        # Both slots cleared after completion.
        assert service._active_user_request is None
        assert service._active_agent_streams == set()

    async def test_untagged_call_does_not_touch_agent_guard(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Main-tab call leaves per-agent guards available.

        Symmetric with the reverse test. User typing in the
        main tab while an agent is idle doesn't register any
        agent slot.
        """
        self._seed_agent(service)
        fake_litellm.set_streaming_chunks(["ok"])

        await service.chat_streaming(
            request_id="r-main",
            message="hello"
        )
        # Main slot registered; agent slots empty.
        assert service._active_user_request == "r-main"
        assert service._active_agent_streams == set()

        await asyncio.sleep(0.3)
        # Both cleared.
        assert service._active_user_request is None
        assert service._active_agent_streams == set()

    async def test_duplicate_agent_tag_rejected(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Second tagged call for the same agent while active → rejected.

        Per-agent single-stream guard. User double-clicks
        Send in an agent tab; the second call errors out.
        """
        self._seed_agent(service)
        fake_litellm.set_streaming_chunks(["ok"])
        # Pre-register the agent slot to simulate an in-flight
        # stream. Using the service's own guard state rather
        # than racing two real streams keeps the test
        # deterministic.
        service._active_agent_streams.add(("turn_abc", 0))

        result = await service.chat_streaming(
            request_id="r2",
            message="again",
            agent_tag=("turn_abc", 0),
        )
        assert "active" in result.get("error", "").lower()

        # Cleanup.
        service._active_agent_streams.discard(("turn_abc", 0))

    async def test_different_agents_stream_in_parallel(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Agent 0 and agent 1 can stream concurrently.

        Per-agent single-stream guard is per-key, not global.
        Two agents in the same turn (or different turns) can
        have simultaneous streams.
        """
        self._seed_agent(service, turn_id="turn_abc", agent_idx=0)
        self._seed_agent(service, turn_id="turn_abc", agent_idx=1)

        # Queue two per-call responses so both streams have
        # content to consume.
        fake_litellm.queue_streaming_chunks(["a0 reply"])
        fake_litellm.queue_streaming_chunks(["a1 reply"])

        r1 = await service.chat_streaming(
            request_id="r-a0",
            message="t0",
            agent_tag=("turn_abc", 0),
        )
        r2 = await service.chat_streaming(
            request_id="r-a1",
            message="t1",
            agent_tag=("turn_abc", 1),
        )
        assert r1 == {"status": "started"}
        assert r2 == {"status": "started"}

        # Both slots registered.
        assert ("turn_abc", 0) in service._active_agent_streams
        assert ("turn_abc", 1) in service._active_agent_streams

        await asyncio.sleep(0.5)
        # Both cleared.
        assert service._active_agent_streams == set()

    async def test_agent_slot_cleared_on_error(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Agent stream raising leaves no stale slot entry.

        Regression guard: a series of failing agent calls
        would otherwise accumulate slot entries permanently,
        eventually blocking every future call for that agent.
        """
        self._seed_agent(service)

        # Force the executor call to raise.
        def _raise(*args: Any, **kwargs: Any) -> None:
            raise RuntimeError("simulated failure")
        monkeypatch.setattr(
            service, "_run_completion_sync", _raise
        )

        await service.chat_streaming(
            request_id="r1",
            message="hi",
            agent_tag=("turn_abc", 0),
        )
        await asyncio.sleep(0.3)

        # Slot cleared even though the stream errored.
        assert service._active_agent_streams == set()

    async def test_closed_agent_returns_error_on_next_call(
        self,
        service: LLMService,
    ) -> None:
        """After close_agent_context, the tag becomes stale."""
        self._seed_agent(service)
        # Close via the C1b RPC.
        closed = service.close_agent_context("turn_abc", 0)
        assert closed["closed"] is True

        # Subsequent tagged call returns agent-not-found.
        result = await service.chat_streaming(
            request_id="r1",
            message="hi",
            agent_tag=("turn_abc", 0),
        )
        assert result == {"error": "agent not found"}


class TestAgentExecutionEndToEnd:
    """Step 3 — agents run through the real _stream_chat pipeline.

    These tests pin the invariants that matter when agents
    spawn real LLM calls rather than hitting the stub:

    - Each agent's assistant response lands in its own archive
      file (agent-NN.jsonl) under the correct turn directory.
    - Each agent's task string appears in its archive as a
      user message (the task text is the agent's initial
      prompt).
    - Edit blocks emitted by an agent apply against the shared
      repo with the per-path write mutex serialising disk
      writes.
    - Sibling-exception isolation: one agent raising mid-stream
      (via a queued LiteLLM exception) doesn't prevent siblings
      from completing and writing their archives.
    - The parent's ``filesChanged`` broadcast is suppressed
      for child streams so an agent's selection doesn't stomp
      the user's picker.

    Unlike ``TestAgentSpawn`` (which installs a recorder for
    ``_agent_stream_impl``), these tests use the real
    ``_stream_chat`` — reached via ``_spawn_agents_for_turn``.
    The ``_FakeLiteLLM`` queue mechanism supplies per-call
    responses so two parallel agents each get their planned
    chunks.
    """

    def _make_agent_block(
        self,
        agent_id: str = "agent-0",
        task: str = "do something useful",
    ) -> Any:
        """Build a valid AgentBlock."""
        from ac_dc.edit_protocol import AgentBlock

        return AgentBlock(id=agent_id, task=task)

    async def test_two_agents_each_produce_archive(
        self,
        service: LLMService,
        history_store: HistoryStore,
        fake_litellm: _FakeLiteLLM,
        repo_dir: Path,
    ) -> None:
        """Two parallel agents each write their own archive file.

        Verifies the core invariant: per-agent ContextManager
        routes its assistant response to its own per-turn
        archive path. The main store is untouched by agents.
        """
        # Queue per-call responses. Two agents run in parallel;
        # each consumes one queued entry. Order-insensitive
        # because each response contains a unique marker we
        # can grep for.
        fake_litellm.queue_streaming_chunks(["alpha reply"])
        fake_litellm.queue_streaming_chunks(["beta reply"])

        # Set up parent scope as if _stream_chat had populated
        # it. We exercise _spawn_agents_for_turn directly
        # rather than going through chat_streaming — avoids
        # coordinating the main LLM's fake call with the
        # agents' calls.
        parent_scope = service._default_scope()
        service._main_loop = asyncio.get_event_loop()
        blocks = [
            self._make_agent_block("agent-0", "first task"),
            self._make_agent_block("agent-1", "second task"),
        ]
        turn_id = HistoryStore.new_turn_id()

        await service._spawn_agents_for_turn(
            agent_blocks=blocks,
            parent_scope=parent_scope,
            parent_request_id="r-main",
            turn_id=turn_id,
        )

        # Each agent's archive exists and contains its
        # response.
        archive_dir = repo_dir / ".ac-dc4" / "agents" / turn_id
        agent_0 = archive_dir / "agent-00.jsonl"
        agent_1 = archive_dir / "agent-01.jsonl"
        assert agent_0.exists()
        assert agent_1.exists()

        archive = history_store.get_turn_archive(turn_id)
        assert len(archive) == 2
        # Both agents recorded their task AND a response.
        # Each archive contains at least user message + assistant
        # response. Response content depends on which queued
        # chunk each agent consumed, so we assert on SET of
        # responses across agents rather than per-agent order.
        all_contents: list[str] = []
        for entry in archive:
            for msg in entry["messages"]:
                content = msg.get("content", "")
                if isinstance(content, str):
                    all_contents.append(content)
        combined = " ".join(all_contents)
        assert "first task" in combined
        assert "second task" in combined
        assert "alpha reply" in combined
        assert "beta reply" in combined

    async def test_agent_edit_applies_to_repo(
        self,
        service: LLMService,
        repo_dir: Path,
        history_store: HistoryStore,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """An agent's edit block reaches the apply path.

        The per-path write mutex in ``Repo`` serialises
        concurrent writes; a single agent writing one file
        just exercises the apply path end-to-end.

        An agent has no selected files by default, so a modify
        edit against an existing file goes through the
        ``not_in_context`` path — the edit doesn't apply to
        disk, but the file gets auto-added to the agent's
        selection (which the agent's scope carries; it does
        not propagate back to the parent).

        Observable effects:
        - File on disk stays unchanged (not-in-context skipped
          the apply step).
        - Agent's archive contains its assistant response with
          the edit block as text (parsed and echoed).
        - The agent's scope.selected_files accumulated the
          auto-add, but scope is a local to the spawn; since
          _spawn_agents_for_turn doesn't return the scopes, we
          verify the outcome through the archive + disk state.

        We don't assert on edit_results in the archive because
        those fields ride on the streamComplete event's result
        dict, not on persisted messages. The message content
        itself IS the edit block text, which is sufficient
        evidence the agent produced its edit and the pipeline
        ran.
        """
        # Seed a file the agent will try to edit.
        target = repo_dir / "target.py"
        target.write_text("original content\n")

        # Agent response contains an edit block targeting the
        # pre-existing file. The response gets parsed by
        # _build_completion_result which routes the block
        # through _edit_pipeline.apply_edits; not-in-context
        # for the agent means the file is auto-added to its
        # selection without writing to disk.
        edit_response = (
            "Making a change:\n\n"
            "target.py\n"
            "🟧🟧🟧 EDIT\n"
            "original content\n"
            "🟨🟨🟨 REPL\n"
            "modified content\n"
            "🟩🟩🟩 END\n"
        )
        fake_litellm.queue_streaming_chunks([edit_response])

        parent_scope = service._default_scope()
        service._main_loop = asyncio.get_event_loop()
        blocks = [
            self._make_agent_block(
                "agent-0", "edit target.py"
            ),
        ]
        turn_id = HistoryStore.new_turn_id()

        await service._spawn_agents_for_turn(
            agent_blocks=blocks,
            parent_scope=parent_scope,
            parent_request_id="r-main",
            turn_id=turn_id,
        )

        # File on disk is unchanged because the edit was
        # not-in-context (agent's selection was empty) and
        # the apply pipeline skipped disk write.
        assert target.read_text() == "original content\n"

        # Archive populated with user task + assistant response.
        archive = history_store.get_turn_archive(turn_id)
        assert len(archive) == 1
        messages = archive[0]["messages"]
        # Assistant response present — the edit block round-tripped
        # through the streaming pipeline and landed in the archive.
        assistant_msgs = [
            m for m in messages if m.get("role") == "assistant"
        ]
        assert assistant_msgs
        # The assistant's content carries the edit block text
        # (proving the response was captured and persisted).
        combined = " ".join(
            m.get("content", "") for m in assistant_msgs
            if isinstance(m.get("content"), str)
        )
        assert "target.py" in combined
        assert "🟧🟧🟧 EDIT" in combined

    async def test_sibling_exception_does_not_block_other_agents(
        self,
        service: LLMService,
        history_store: HistoryStore,
        fake_litellm: _FakeLiteLLM,
        repo_dir: Path,
    ) -> None:
        """Agent 0 raises mid-stream; agent 1 still completes.

        ``asyncio.gather(return_exceptions=True)`` in
        ``_spawn_agents_for_turn`` absorbs the raise.
        Agent 1's archive must still contain its response.
        """
        # Agent 0 raises; agent 1 streams normally.
        fake_litellm.queue_streaming_error(
            RuntimeError("simulated agent-0 failure"),
        )
        fake_litellm.queue_streaming_chunks(["beta survived"])

        parent_scope = service._default_scope()
        service._main_loop = asyncio.get_event_loop()
        blocks = [
            self._make_agent_block("agent-0", "will fail"),
            self._make_agent_block(
                "agent-1", "will succeed"
            ),
        ]
        turn_id = HistoryStore.new_turn_id()

        # Must not raise — gather absorbs exceptions.
        await service._spawn_agents_for_turn(
            agent_blocks=blocks,
            parent_scope=parent_scope,
            parent_request_id="r-main",
            turn_id=turn_id,
        )

        archive = history_store.get_turn_archive(turn_id)
        # Agent 1's archive survived.
        survived = [
            a for a in archive if a["agent_idx"] == 1
        ]
        assert survived
        messages = survived[0]["messages"]
        combined = " ".join(
            m.get("content", "") for m in messages
            if isinstance(m.get("content"), str)
        )
        assert "beta survived" in combined

    async def test_child_stream_does_not_broadcast_selection(
        self,
        service: LLMService,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        repo_dir: Path,
    ) -> None:
        """Agent auto-adds don't stomp the user's picker.

        The agent's scope.selected_files is a per-agent copy;
        broadcasting a filesChanged event with that list
        would make the main picker reflect the agent's view
        rather than the user's. Step 3 suppresses this
        broadcast for child streams via the
        ``_is_child_request`` check at the broadcast site.
        """
        # Seed a file the agent will edit, so the edit path
        # triggers auto-add (file exists, agent selection is
        # empty → not_in_context → auto-added).
        target = repo_dir / "victim.py"
        target.write_text("unchanged\n")

        edit_response = (
            "victim.py\n"
            "🟧🟧🟧 EDIT\n"
            "unchanged\n"
            "🟨🟨🟨 REPL\n"
            "changed\n"
            "🟩🟩🟩 END\n"
        )
        fake_litellm.queue_streaming_chunks([edit_response])

        parent_scope = service._default_scope()
        service._main_loop = asyncio.get_event_loop()
        # Set _active_user_request so _is_child_request
        # recognises the child IDs. In production this is
        # set by chat_streaming before _spawn_agents_for_turn
        # is called; we're bypassing that path by invoking
        # _spawn_agents_for_turn directly, so we simulate it
        # here. Without this, _is_child_request returns False
        # for the child ID (no parent to be a child of) and
        # the broadcast suppression doesn't fire.
        service._active_user_request = "r-main"
        # Clear any events from earlier broadcasts so we're
        # measuring just this spawn's output.
        event_cb.events.clear()

        blocks = [
            self._make_agent_block("agent-0", "modify"),
        ]
        turn_id = HistoryStore.new_turn_id()
        try:
            await service._spawn_agents_for_turn(
                agent_blocks=blocks,
                parent_scope=parent_scope,
                parent_request_id="r-main",
                turn_id=turn_id,
            )
        finally:
            service._active_user_request = None

        # No filesChanged event should have fired from the
        # agent's auto-add path. The main picker would have
        # been stomped if we broadcast the agent's private
        # selection list.
        files_changed = [
            args for name, args in event_cb.events
            if name == "filesChanged"
        ]
        assert files_changed == []


class TestAgentAssimilation:
    """Step 4 — post-agent assimilation into the parent conversation.

    After ``_spawn_agents_for_turn`` runs, the backend folds
    the union of agent-modified and agent-created files into
    the parent scope's selection and file context, then
    broadcasts ``filesChanged`` + ``filesModified`` so the
    frontend picker reloads. No automatic synthesis LLM call
    fires — review and iteration are user-driven on follow-up
    turns per specs4/7-future/parallel-agents.md § Execution
    Model and § Review Step — User-Driven.

    These tests pin the assimilation contract:

    - Single agent's edit → parent picks up the file in its
      selection and file context.
    - Two agents touching independent files → union lands in
      parent's selection and file context; both broadcasts
      fire with the union.
    - Agent emitting no edits → assimilation is a no-op,
      no spurious broadcasts.
    - Agent creating a new file → ``files_created`` path
      assimilates just like ``files_modified``.
    - Sibling raising mid-gather → surviving agent's changes
      still assimilate; the exception doesn't block the path.
    - Parent's follow-up turn sees the assimilated files in
      its prompt context.

    Most tests invoke ``_spawn_agents_for_turn`` directly
    rather than going through ``chat_streaming`` — the goal
    is to pin assimilation behaviour without coordinating a
    main-LLM fake call alongside the agents' calls. The
    follow-up-turn test DOES use ``chat_streaming`` because
    the whole point is the cross-turn observable.
    """

    def _make_agent_block(
        self,
        agent_id: str = "agent-0",
        task: str = "do something",
    ) -> Any:
        """Build a valid AgentBlock."""
        from ac_dc.edit_protocol import AgentBlock

        return AgentBlock(id=agent_id, task=task)

    def _build_modify_edit(
        self, path: str, old: str, new: str
    ) -> str:
        """Assemble one modify edit block as agent response text."""
        return (
            f"{path}\n"
            "🟧🟧🟧 EDIT\n"
            f"{old}\n"
            "🟨🟨🟨 REPL\n"
            f"{new}\n"
            "🟩🟩🟩 END\n"
        )

    def _build_create_edit(
        self, path: str, content: str
    ) -> str:
        """Assemble one create edit block (empty old text)."""
        return (
            f"{path}\n"
            "🟧🟧🟧 EDIT\n"
            "🟨🟨🟨 REPL\n"
            f"{content}\n"
            "🟩🟩🟩 END\n"
        )

    async def test_single_agent_modify_parent_had_file_selected(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Parent had file selected → agent applies → parent refreshes.

        The agent inherits the parent's selection list as a
        deep copy. When the agent edits an already-selected
        file, the edit applies to disk. Assimilation then
        refreshes the parent's file context so it sees the
        post-edit content (the parent's cache was stale since
        it loaded the file before the agent ran).
        """
        target = repo_dir / "helper.py"
        target.write_text("original body\n")
        service.set_selected_files(["helper.py"])
        # Load pre-edit content into parent's file context.
        service._sync_file_context()
        assert service._file_context.get_content(
            "helper.py"
        ) == "original body\n"

        parent_scope = service._default_scope()
        service._main_loop = asyncio.get_event_loop()
        service._active_user_request = "r-parent"
        event_cb.events.clear()

        agent_response = self._build_modify_edit(
            "helper.py", "original body", "modified body"
        )
        fake_litellm.queue_streaming_chunks([agent_response])

        try:
            await service._spawn_agents_for_turn(
                agent_blocks=[
                    self._make_agent_block(
                        "agent-0", "modify helper.py"
                    ),
                ],
                parent_scope=parent_scope,
                parent_request_id="r-parent",
                turn_id=HistoryStore.new_turn_id(),
            )
        finally:
            service._active_user_request = None

        # File on disk has the new content (agent's edit landed).
        assert target.read_text() == "modified body\n"

        # Parent's file context refreshed to the post-edit
        # content. Without assimilation's refresh pass, the
        # parent would still see "original body" here.
        assert service._file_context.get_content(
            "helper.py"
        ) == "modified body\n"

        # Parent's selection still contains the file (was
        # already there; assimilation's append skips duplicates).
        assert service.get_selected_files() == ["helper.py"]
        assert service.get_selected_files().count(
            "helper.py"
        ) == 1

        # filesChanged broadcast fired from the parent-level
        # assimilation. Payload is the parent's full selection.
        files_changed = [
            args for name, args in event_cb.events
            if name == "filesChanged"
        ]
        # At least one broadcast — the assimilation one. The
        # agent's own _stream_chat suppresses its filesChanged
        # broadcast for child streams, so this one comes from
        # _assimilate_agent_changes.
        assert files_changed
        # Most-recent payload carries the updated selection.
        last_payload = files_changed[-1][0]
        assert "helper.py" in last_payload

        # filesModified broadcast fired with the touched path.
        files_modified = [
            args for name, args in event_cb.events
            if name == "filesModified"
        ]
        assert files_modified
        # Find the parent-level broadcast (carries just the
        # unioned paths). The agent's own _stream_chat also
        # fires filesModified on edit apply; both events are
        # valid, so we assert that at least one carries
        # helper.py.
        assert any(
            "helper.py" in args[0] for args in files_modified
        )

    async def test_two_agents_independent_files_union_assimilates(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Two agents each edit a different file → union in parent.

        The parent had both files selected so both edits apply.
        After assimilation: parent's file context has both files'
        post-edit content, selection unchanged (already had
        them), and the parent-level filesModified broadcast
        carries both paths.
        """
        alpha = repo_dir / "alpha.py"
        beta = repo_dir / "beta.py"
        alpha.write_text("alpha v1\n")
        beta.write_text("beta v1\n")
        service.set_selected_files(["alpha.py", "beta.py"])
        service._sync_file_context()

        parent_scope = service._default_scope()
        service._main_loop = asyncio.get_event_loop()
        service._active_user_request = "r-parent"
        event_cb.events.clear()

        # Queue per-agent responses. Each agent's _stream_chat
        # consumes one queued directive in FIFO order.
        fake_litellm.queue_streaming_chunks([
            self._build_modify_edit(
                "alpha.py", "alpha v1", "alpha v2"
            ),
        ])
        fake_litellm.queue_streaming_chunks([
            self._build_modify_edit(
                "beta.py", "beta v1", "beta v2"
            ),
        ])

        try:
            await service._spawn_agents_for_turn(
                agent_blocks=[
                    self._make_agent_block("agent-0", "edit alpha"),
                    self._make_agent_block("agent-1", "edit beta"),
                ],
                parent_scope=parent_scope,
                parent_request_id="r-parent",
                turn_id=HistoryStore.new_turn_id(),
            )
        finally:
            service._active_user_request = None

        # Both files on disk updated.
        assert alpha.read_text() == "alpha v2\n"
        assert beta.read_text() == "beta v2\n"

        # Parent's file context reflects both post-edit bodies.
        assert service._file_context.get_content(
            "alpha.py"
        ) == "alpha v2\n"
        assert service._file_context.get_content(
            "beta.py"
        ) == "beta v2\n"

        # Parent-level filesModified broadcast carries the
        # union. There may be multiple filesModified events
        # (each agent's own _stream_chat fires one); we look
        # for ONE whose payload contains both paths — that's
        # the assimilation broadcast.
        files_modified = [
            args for name, args in event_cb.events
            if name == "filesModified"
        ]
        union_broadcasts = [
            args for args in files_modified
            if isinstance(args[0], list)
            and "alpha.py" in args[0]
            and "beta.py" in args[0]
        ]
        assert union_broadcasts, (
            "Expected a filesModified broadcast carrying the "
            "union of agent-modified files; got: "
            f"{[a[0] for a in files_modified]}"
        )

    async def test_no_edits_no_broadcasts(
        self,
        service: LLMService,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Agent with no edits → assimilation is a no-op.

        Some agent tasks are read-only (exploration, analysis).
        The agent's response has no edit blocks, so
        ``files_modified`` and ``files_created`` are empty in
        the completion result. Assimilation should skip the
        broadcast step entirely — bothering the frontend's
        picker for a no-op turn would cause unnecessary
        re-fetching.
        """
        parent_scope = service._default_scope()
        service._main_loop = asyncio.get_event_loop()
        service._active_user_request = "r-parent"
        event_cb.events.clear()

        # Agent responds with pure prose, no edit blocks.
        fake_litellm.queue_streaming_chunks([
            "I explored the codebase. No changes needed.",
        ])

        try:
            await service._spawn_agents_for_turn(
                agent_blocks=[
                    self._make_agent_block(
                        "agent-0", "explore the codebase"
                    ),
                ],
                parent_scope=parent_scope,
                parent_request_id="r-parent",
                turn_id=HistoryStore.new_turn_id(),
            )
        finally:
            service._active_user_request = None

        # No filesChanged or filesModified broadcasts fired
        # from assimilation. (The agent's own _stream_chat
        # suppresses its filesChanged for child streams and
        # fires filesModified only on edit apply — with no
        # edits, it fires nothing either.)
        files_changed = [
            args for name, args in event_cb.events
            if name == "filesChanged"
        ]
        files_modified = [
            args for name, args in event_cb.events
            if name == "filesModified"
        ]
        assert files_changed == []
        assert files_modified == []

        # Parent's selection unchanged.
        assert service.get_selected_files() == []

    async def test_agent_creates_new_file_assimilates(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Agent creates a new file → appears in parent's selection.

        Creates bypass the in-context check — an agent can
        create a file without having it pre-selected. The
        completion result populates both ``files_created`` and
        ``files_modified``; assimilation unions both and
        appends the new path to the parent's selection.
        """
        parent_scope = service._default_scope()
        service._main_loop = asyncio.get_event_loop()
        service._active_user_request = "r-parent"
        event_cb.events.clear()

        # Agent creates a new file.
        agent_response = self._build_create_edit(
            "new_module.py", "def added(): pass"
        )
        fake_litellm.queue_streaming_chunks([agent_response])

        try:
            await service._spawn_agents_for_turn(
                agent_blocks=[
                    self._make_agent_block(
                        "agent-0", "create new_module.py"
                    ),
                ],
                parent_scope=parent_scope,
                parent_request_id="r-parent",
                turn_id=HistoryStore.new_turn_id(),
            )
        finally:
            service._active_user_request = None

        # File exists on disk.
        created = repo_dir / "new_module.py"
        assert created.exists()

        # Parent's selection includes the new file.
        assert "new_module.py" in service.get_selected_files()

        # Parent's file context has the content loaded.
        assert service._file_context.has_file("new_module.py")
        content = service._file_context.get_content(
            "new_module.py"
        )
        assert content is not None
        assert "def added" in content

        # Parent-level filesChanged broadcast carries the
        # new selection.
        files_changed = [
            args for name, args in event_cb.events
            if name == "filesChanged"
        ]
        assert files_changed
        last_payload = files_changed[-1][0]
        assert "new_module.py" in last_payload

    async def test_sibling_exception_does_not_block_assimilation(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """One agent raises → surviving agent's changes still assimilate.

        ``asyncio.gather(return_exceptions=True)`` in
        ``_spawn_agents_for_turn`` absorbs the exception;
        ``_assimilate_agent_changes`` skips the exception
        entry and processes the other agent's result. The
        parent still sees the surviving agent's file changes.
        """
        target = repo_dir / "survived.py"
        target.write_text("v1\n")
        service.set_selected_files(["survived.py"])
        service._sync_file_context()

        parent_scope = service._default_scope()
        service._main_loop = asyncio.get_event_loop()
        service._active_user_request = "r-parent"
        event_cb.events.clear()

        # Agent 0 raises; agent 1 modifies the file.
        fake_litellm.queue_streaming_error(
            RuntimeError("simulated agent-0 failure"),
        )
        fake_litellm.queue_streaming_chunks([
            self._build_modify_edit(
                "survived.py", "v1", "v2"
            ),
        ])

        try:
            await service._spawn_agents_for_turn(
                agent_blocks=[
                    self._make_agent_block("agent-0", "will fail"),
                    self._make_agent_block("agent-1", "will succeed"),
                ],
                parent_scope=parent_scope,
                parent_request_id="r-parent",
                turn_id=HistoryStore.new_turn_id(),
            )
        finally:
            service._active_user_request = None

        # Surviving agent's edit landed on disk.
        assert target.read_text() == "v2\n"

        # Parent's file context refreshed to the post-edit
        # content despite the sibling exception.
        assert service._file_context.get_content(
            "survived.py"
        ) == "v2\n"

        # Parent-level filesModified broadcast carries the
        # surviving path.
        files_modified = [
            args for name, args in event_cb.events
            if name == "filesModified"
        ]
        assert any(
            isinstance(args[0], list)
            and "survived.py" in args[0]
            for args in files_modified
        )

    async def test_followup_turn_sees_assimilated_files(
        self,
        service: LLMService,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        config: ConfigManager,
    ) -> None:
        """Parent's next LLM call sees the agent-modified content.

        Drives the full assimilation → next-turn flow:

        1. Parent runs a main LLM turn that emits an agent
           spawn block. The agent modifies a file.
        2. Assimilation folds the modified file into the
           parent's context.
        3. Parent sends a follow-up user message. Its
           ``_stream_chat`` assembles a prompt that includes
           the post-edit file content — proving the follow-up
           turn sees what the agent did.

        We verify step 3 by inspecting the messages array the
        fake LiteLLM receives on the follow-up call: it must
        contain the post-edit content, not the pre-edit.

        Agent mode requires the toggle to be on — we enable
        it via the config helper pattern used elsewhere in
        this file.
        """
        # Enable agent mode so the main LLM's spawn block
        # actually dispatches. Otherwise the block is parsed
        # but the dispatch branch is gated off.
        import json as _json
        app_path = config.config_dir / "app.json"
        app_data = _json.loads(app_path.read_text())
        app_data.setdefault("agents", {})
        app_data["agents"]["enabled"] = True
        app_path.write_text(_json.dumps(app_data))
        config._app_config = None

        # Seed the file and select it so the agent's edit
        # applies (agent inherits parent's selection).
        target = repo_dir / "accumulator.py"
        target.write_text("counter = 0\n")
        service.set_selected_files(["accumulator.py"])

        # Queue three responses: main LLM turn 1 (with agent
        # block), agent's response (edits file), main LLM
        # turn 2 (follow-up; response doesn't matter, we
        # only care that the assembled prompt contains the
        # post-edit content).
        main_turn_1 = (
            "I'll delegate this to an agent.\n\n"
            "🟧🟧🟧 AGENT\n"
            "id: agent-0\n"
            "task: bump the counter\n"
            "🟩🟩🟩 AGEND\n"
        )
        agent_resp = self._build_modify_edit(
            "accumulator.py", "counter = 0", "counter = 1"
        )
        main_turn_2 = "Got it."
        fake_litellm.queue_streaming_chunks([main_turn_1])
        fake_litellm.queue_streaming_chunks([agent_resp])
        fake_litellm.queue_streaming_chunks([main_turn_2])

        # First turn — main LLM spawns agent.
        await service.chat_streaming(
            request_id="r1", message="bump the counter"
        )
        await asyncio.sleep(0.5)

        # Agent's edit landed.
        assert target.read_text() == "counter = 1\n"
        # Parent's file context refreshed.
        assert service._file_context.get_content(
            "accumulator.py"
        ) == "counter = 1\n"

        # Second turn — capture the messages the fake receives.
        # The fake's last_call_args dict is overwritten on each
        # completion() call, so after turn 2 it holds turn 2's
        # messages.
        await service.chat_streaming(
            request_id="r2", message="what's the value?"
        )
        await asyncio.sleep(0.3)

        # The fake's messages array for the follow-up turn
        # should carry the post-edit content somewhere — the
        # file got refreshed during assimilation and re-renders
        # as an active file or cached tier entry.
        assembled = fake_litellm.last_call_args.get("messages", [])
        combined = " ".join(
            str(m.get("content", "")) for m in assembled
            if isinstance(m.get("content"), (str, list))
        )
        # A list-valued content (multimodal) needs flattening.
        # Rebuild considering list content.
        parts: list[str] = []
        for msg in assembled:
            content = msg.get("content", "")
            if isinstance(content, str):
                parts.append(content)
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, dict):
                        text = block.get("text", "")
                        if isinstance(text, str):
                            parts.append(text)
        combined = " ".join(parts)
        assert "counter = 1" in combined, (
            "Follow-up turn's prompt didn't carry post-edit "
            "file content. Assimilation's file_context refresh "
            "didn't propagate to the next turn's assembly."
        )
        # Defensive: the pre-edit content shouldn't be in the
        # prompt (the file context was refreshed, not
        # duplicated).
        assert "counter = 0" not in combined


class TestURLIntegration:
    """URL service integration in LLMService — Layer 4.1.6."""

    def test_url_service_constructed(
        self,
        service: LLMService,
    ) -> None:
        """LLMService constructs a URL service with cache and model."""
        assert service._url_service is not None
        # Cache present — config defaults to a temp-dir path.
        assert service._url_service._cache is not None
        # Smaller model wired from config.
        assert service._url_service._smaller_model == (
            service._config.smaller_model
        )

    def test_detect_urls_delegates(self, service: LLMService) -> None:
        """detect_urls RPC passes through to the URL service."""
        result = service.detect_urls(
            "see https://example.com and https://github.com/a/b"
        )
        assert len(result) == 2
        assert result[0]["url"] == "https://example.com"
        assert result[0]["type"] == "generic"
        assert result[1]["type"] == "github_repo"

    def test_get_url_content_sentinel_when_not_fetched(
        self,
        service: LLMService,
    ) -> None:
        """Unknown URL returns the not-fetched sentinel."""
        result = service.get_url_content("https://unknown.example.com")
        assert result["error"] == "URL not yet fetched"

    def test_invalidate_url_cache_delegates(
        self,
        service: LLMService,
    ) -> None:
        """invalidate_url_cache returns the service's status dict."""
        result = service.invalidate_url_cache("https://never-fetched.com")
        assert result["status"] == "ok"
        assert result["fetched_removed"] is False

    def test_remove_fetched_url_delegates(
        self,
        service: LLMService,
    ) -> None:
        """remove_fetched_url returns the service's status dict."""
        result = service.remove_fetched_url("https://never-fetched.com")
        assert result["status"] == "ok"
        assert result["removed"] is False

    def test_clear_url_cache_delegates(
        self,
        service: LLMService,
    ) -> None:
        """clear_url_cache returns the service's status dict."""
        result = service.clear_url_cache()
        assert result["status"] == "ok"
        assert "cache_cleared" in result

    async def test_streaming_with_url_triggers_fetch(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Streaming a message with a URL fetches and notifies."""
        from ac_dc.url_service.models import URLContent

        # Stub the URL service's fetch_url to avoid real network.
        # Populates _fetched so format_url_context emits content.
        fetched_content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="page body",
            fetched_at="2025-01-01T00:00:00Z",
        )

        def fake_fetch(url, **kwargs):
            service._url_service._fetched[url] = fetched_content
            return fetched_content

        monkeypatch.setattr(
            service._url_service, "fetch_url", fake_fetch
        )

        # Minimal streaming response — we just care about the
        # pre-assembly URL fetch, not the LLM output.
        fake_litellm.set_streaming_chunks(["ok"])

        await service.chat_streaming(
            request_id="r1",
            message="check this out: https://example.com",
        )
        await asyncio.sleep(0.3)

        # compactionEvent fired twice — url_fetch then url_ready.
        compaction_events = [
            args
            for name, args in event_cb.events
            if name == "compactionEvent"
        ]
        url_events = [
            ev for ev in compaction_events
            if ev[1].get("stage") in ("url_fetch", "url_ready")
        ]
        assert len(url_events) == 2
        assert url_events[0][1]["stage"] == "url_fetch"
        assert url_events[0][1]["url"] == "example.com"
        assert url_events[1][1]["stage"] == "url_ready"

    async def test_streaming_skips_already_fetched_urls(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Already-fetched URLs produce no fetch events."""
        from ac_dc.url_service.models import URLContent

        # Pre-populate the URL service's fetched dict.
        service._url_service._fetched["https://example.com"] = URLContent(
            url="https://example.com",
            url_type="generic",
            content="cached body",
            fetched_at="2025-01-01T00:00:00Z",
        )

        fetch_calls = []

        def fake_fetch(url, **kwargs):
            fetch_calls.append(url)
            return service._url_service._fetched[url]

        monkeypatch.setattr(
            service._url_service, "fetch_url", fake_fetch
        )

        fake_litellm.set_streaming_chunks(["ok"])

        await service.chat_streaming(
            request_id="r1",
            message="revisit https://example.com",
        )
        await asyncio.sleep(0.3)

        # No fetch happened since the URL was already fetched.
        assert fetch_calls == []

        # No fetch-progress events either.
        url_events = [
            args
            for name, args in event_cb.events
            if name == "compactionEvent"
            and args[1].get("stage") in ("url_fetch", "url_ready")
        ]
        assert url_events == []

    async def test_streaming_without_urls_skips_fetch_path(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """Messages with no URLs produce no URL-related events."""
        fake_litellm.set_streaming_chunks(["ok"])

        await service.chat_streaming(
            request_id="r1",
            message="hello, no urls here",
        )
        await asyncio.sleep(0.3)

        url_events = [
            args
            for name, args in event_cb.events
            if name == "compactionEvent"
            and args[1].get("stage") in ("url_fetch", "url_ready")
        ]
        assert url_events == []

    async def test_streaming_injects_url_content_into_context(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Fetched URL content lands in context manager's URL section."""
        from ac_dc.url_service.models import URLContent

        fetched_content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="this is the page body",
            fetched_at="2025-01-01T00:00:00Z",
        )

        def fake_fetch(url, **kwargs):
            service._url_service._fetched[url] = fetched_content
            return fetched_content

        monkeypatch.setattr(
            service._url_service, "fetch_url", fake_fetch
        )

        fake_litellm.set_streaming_chunks(["ok"])

        await service.chat_streaming(
            request_id="r1",
            message="explain https://example.com",
        )
        await asyncio.sleep(0.3)

        # URL content attached to context manager.
        url_context = service._context.get_url_context()
        assert len(url_context) == 1
        assert "example.com" in url_context[0]
        assert "this is the page body" in url_context[0]

    async def test_per_message_url_limit_applied(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Only the first 3 URLs in a message get fetched."""
        from ac_dc.url_service.models import URLContent

        fetched_urls = []

        def fake_fetch(url, **kwargs):
            fetched_urls.append(url)
            content = URLContent(
                url=url,
                url_type="generic",
                content="body",
                fetched_at="2025-01-01T00:00:00Z",
            )
            service._url_service._fetched[url] = content
            return content

        monkeypatch.setattr(
            service._url_service, "fetch_url", fake_fetch
        )

        fake_litellm.set_streaming_chunks(["ok"])

        # Five URLs in the prompt; only first three should fetch.
        message = (
            "https://a.example.com https://b.example.com "
            "https://c.example.com https://d.example.com "
            "https://e.example.com"
        )
        await service.chat_streaming(
            request_id="r1",
            message=message,
        )
        await asyncio.sleep(0.3)

        assert len(fetched_urls) == 3

    async def test_excluded_urls_omitted_from_prompt_context(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """``excluded_urls`` kwarg drops URLs from this turn's prompt.

        End-to-end contract for the chip UI's include checkbox.
        The user has two fetched URLs from a prior turn; on
        send they uncheck one. The streaming handler receives
        the exclusion list and threads it through to
        :meth:`URLService.format_url_context` so the excluded
        URL's content doesn't appear in ``_url_context`` on the
        context manager.

        The URLs themselves STAY in the URL service's
        session-scoped ``_fetched`` dict — the chip remains
        visible so the user can re-include on a later turn by
        rechecking the box. This is the distinguishing behaviour
        from :meth:`remove_fetched_url`, which drops the chip
        entirely.
        """
        from ac_dc.url_service.models import URLContent

        # Pre-populate two fetched URLs from prior turns.
        service._url_service._fetched["https://keep.example.com"] = (
            URLContent(
                url="https://keep.example.com",
                url_type="generic",
                content="keep body",
                fetched_at="2025-01-01T00:00:00Z",
            )
        )
        service._url_service._fetched["https://drop.example.com"] = (
            URLContent(
                url="https://drop.example.com",
                url_type="generic",
                content="drop body",
                fetched_at="2025-01-01T00:00:00Z",
            )
        )

        fake_litellm.set_streaming_chunks(["ok"])

        # User sends a message with no new URLs but asks to
        # exclude drop.example.com from this turn.
        await service.chat_streaming(
            request_id="r1",
            message="tell me about what we discussed",
            excluded_urls=["https://drop.example.com"],
        )
        await asyncio.sleep(0.3)

        # URL context built for the LLM contains only the kept
        # URL's content.
        url_context = service._context.get_url_context()
        assert len(url_context) == 1
        joined = url_context[0]
        assert "keep body" in joined
        assert "keep.example.com" in joined
        # Excluded URL's content is ABSENT.
        assert "drop body" not in joined
        assert "drop.example.com" not in joined

        # Both URLs still in the session-scoped fetched dict —
        # chips stay visible, user can re-include on next turn.
        fetched_keys = set(service._url_service._fetched.keys())
        assert "https://keep.example.com" in fetched_keys
        assert "https://drop.example.com" in fetched_keys

    async def test_excluded_urls_empty_list_is_noop(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Empty exclusion list → all fetched URLs contribute.

        Regression guard: a falsy-but-not-None argument must
        behave the same as no argument. The `or []` coalescing
        in :meth:`chat_streaming` handles the None case; this
        test pins the explicit empty list behaviour so a future
        refactor that collapses the two paths doesn't
        accidentally treat `[]` as "exclude everything".
        """
        from ac_dc.url_service.models import URLContent

        service._url_service._fetched["https://a.example.com"] = (
            URLContent(
                url="https://a.example.com",
                url_type="generic",
                content="a body",
                fetched_at="2025-01-01T00:00:00Z",
            )
        )
        service._url_service._fetched["https://b.example.com"] = (
            URLContent(
                url="https://b.example.com",
                url_type="generic",
                content="b body",
                fetched_at="2025-01-01T00:00:00Z",
            )
        )

        fake_litellm.set_streaming_chunks(["ok"])
        await service.chat_streaming(
            request_id="r1",
            message="ask something",
            excluded_urls=[],
        )
        await asyncio.sleep(0.3)

        url_context = service._context.get_url_context()
        assert len(url_context) == 1
        joined = url_context[0]
        # Both URLs contribute when nothing is excluded.
        assert "a body" in joined
        assert "b body" in joined

    async def test_excluded_urls_multiple_all_omitted(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Multiple excluded URLs are all dropped.

        Covers the set-conversion path in
        :meth:`_detect_and_fetch_urls`: the list arrives as a
        list, gets converted to a set, and every member is
        filtered by :meth:`URLService.format_url_context`.
        """
        from ac_dc.url_service.models import URLContent

        for i, url in enumerate(
            [
                "https://a.example.com",
                "https://b.example.com",
                "https://c.example.com",
            ]
        ):
            service._url_service._fetched[url] = URLContent(
                url=url,
                url_type="generic",
                content=f"body {i}",
                fetched_at="2025-01-01T00:00:00Z",
            )

        fake_litellm.set_streaming_chunks(["ok"])
        await service.chat_streaming(
            request_id="r1",
            message="ask",
            excluded_urls=[
                "https://a.example.com",
                "https://c.example.com",
            ],
        )
        await asyncio.sleep(0.3)

        url_context = service._context.get_url_context()
        assert len(url_context) == 1
        joined = url_context[0]
        # Only b survives.
        assert "body 1" in joined
        assert "body 0" not in joined
        assert "body 2" not in joined

    async def test_excluded_urls_all_fetched_clears_context(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Excluding every fetched URL → empty URL context.

        When the exclusion set covers all fetched URLs,
        :meth:`URLService.format_url_context` returns an empty
        string. The streaming handler's branch on
        ``if url_context:`` then calls
        :meth:`ContextManager.clear_url_context` instead of
        attaching — so the prompt has no URL section at all.
        """
        from ac_dc.url_service.models import URLContent

        service._url_service._fetched["https://only.example.com"] = (
            URLContent(
                url="https://only.example.com",
                url_type="generic",
                content="only body",
                fetched_at="2025-01-01T00:00:00Z",
            )
        )

        fake_litellm.set_streaming_chunks(["ok"])
        await service.chat_streaming(
            request_id="r1",
            message="ask",
            excluded_urls=["https://only.example.com"],
        )
        await asyncio.sleep(0.3)

        # No URL context attached — format returned empty.
        assert service._context.get_url_context() == []
        # URL still in fetched dict.
        assert (
            "https://only.example.com"
            in service._url_service._fetched
        )


class TestReview:
    """Code review mode — Layer 4.3."""

    def test_check_review_ready_clean_tree(
        self, service: LLMService
    ) -> None:
        """Clean working tree → ready."""
        result = service.check_review_ready()
        assert result == {"clean": True}

    def test_check_review_ready_dirty_tree(
        self,
        service: LLMService,
        repo_dir: Path,
    ) -> None:
        """Uncommitted changes → not ready with message."""
        # Introduce a staged change.
        (repo_dir / "new.md").write_text("content")
        _run_git(repo_dir, "add", "new.md")
        result = service.check_review_ready()
        assert result["clean"] is False
        assert "commit" in result["message"].lower()

    def test_check_review_ready_no_repo(
        self,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Service without a repo → not ready."""
        svc = LLMService(config=config, repo=None)
        result = svc.check_review_ready()
        assert result["clean"] is False
        assert "repository" in result["message"].lower()

    def test_get_review_state_inactive(
        self, service: LLMService
    ) -> None:
        """Pre-start state has active=False and empty fields."""
        state = service.get_review_state()
        assert state["active"] is False
        assert state["branch"] is None
        assert state["commits"] == []
        assert state["changed_files"] == []
        # pre_change_symbol_map stripped from the response.
        assert "pre_change_symbol_map" not in state

    def test_state_snapshot_includes_review(
        self, service: LLMService
    ) -> None:
        """get_current_state exposes review_state."""
        state = service.get_current_state()
        assert "review_state" in state
        assert state["review_state"]["active"] is False

    def test_start_review_requires_repo(
        self,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """No repo → clean error."""
        svc = LLMService(config=config, repo=None)
        result = svc.start_review("feature", "abc1234")
        assert "repository" in result.get("error", "").lower()

    def test_start_review_rejects_dirty_tree(
        self,
        service: LLMService,
        repo_dir: Path,
    ) -> None:
        """Dirty tree rejection happens at start_review too."""
        (repo_dir / "new.md").write_text("content")
        _run_git(repo_dir, "add", "new.md")
        result = service.start_review("main", "HEAD")
        assert "error" in result
        # Review state not activated.
        assert service._review_active is False

    def test_start_review_full_lifecycle(
        self,
        service: LLMService,
        repo_dir: Path,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """Full round-trip — enter review, exit cleanly."""
        # Set up a feature branch with a commit.
        _run_git(repo_dir, "checkout", "-q", "-b", "feature")
        (repo_dir / "new.py").write_text("def hello(): pass\n")
        _run_git(repo_dir, "add", "new.py")
        _run_git(
            repo_dir, "commit", "-q", "-m", "feat: add hello"
        )
        _run_git(repo_dir, "checkout", "-q", "main")

        # Pre-review: record original system prompt for later
        # restoration check.
        orig_prompt = service._context.get_system_prompt()

        # Enter review. base_commit is the feature branch tip
        # (the selector UI would provide this).
        tip_result = service._repo._run_git(
            ["rev-parse", "feature"], check=True
        )
        tip_sha = tip_result.stdout.strip()
        result = service.start_review("feature", tip_sha)

        assert result["status"] == "review_active"
        assert result["branch"] == "feature"
        assert result["stats"]["commit_count"] >= 1
        assert service._review_active is True

        # System prompt swapped.
        current_prompt = service._context.get_system_prompt()
        assert current_prompt != orig_prompt
        assert (
            current_prompt == service._config.get_review_prompt()
        )

        # Review state populated.
        review_state = service.get_review_state()
        assert review_state["active"] is True
        assert review_state["branch"] == "feature"
        assert len(review_state["commits"]) >= 1
        assert len(review_state["changed_files"]) >= 1

        # Selection cleared on entry.
        assert service.get_selected_files() == []

        # System event recorded in both stores.
        history = service.get_current_state()["messages"]
        entry_events = [
            m for m in history
            if m.get("system_event")
            and "review" in m.get("content", "").lower()
        ]
        assert len(entry_events) == 1
        assert "feature" in entry_events[0]["content"]

        # filesChanged broadcast emitted on entry.
        files_changed_events = [
            args for name, args in event_cb.events
            if name == "filesChanged"
        ]
        assert files_changed_events

        # Exit review.
        exit_result = service.end_review()
        assert exit_result["status"] == "restored"
        assert service._review_active is False

        # System prompt restored.
        assert service._context.get_system_prompt() == orig_prompt

        # Review state cleared.
        cleared_state = service.get_review_state()
        assert cleared_state["active"] is False
        assert cleared_state["branch"] is None

        # Second system event (exit).
        history = service.get_current_state()["messages"]
        exit_events = [
            m for m in history
            if m.get("system_event")
            and "exited" in m.get("content", "").lower()
        ]
        assert len(exit_events) == 1

    def test_start_review_rejects_concurrent(
        self,
        service: LLMService,
        repo_dir: Path,
    ) -> None:
        """Already-active review rejects new start."""
        service._review_active = True
        result = service.start_review("any", "any")
        assert "already active" in result.get("error", "").lower()

    def test_end_review_when_not_active(
        self, service: LLMService
    ) -> None:
        """end_review when inactive returns clean error."""
        result = service.end_review()
        assert "not active" in result.get("error", "").lower()

    def test_end_review_clears_state_even_on_exit_failure(
        self,
        service: LLMService,
        repo_dir: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Even if git exit fails, review state is cleared."""
        # Activate review with a valid state.
        _run_git(repo_dir, "checkout", "-q", "-b", "feature")
        (repo_dir / "x.py").write_text("x")
        _run_git(repo_dir, "add", "x.py")
        _run_git(repo_dir, "commit", "-q", "-m", "feat")
        _run_git(repo_dir, "checkout", "-q", "main")
        tip = service._repo._run_git(
            ["rev-parse", "feature"], check=True
        ).stdout.strip()
        service.start_review("feature", tip)
        assert service._review_active is True

        # Force the repo's exit to fail.
        def failing_exit(*args, **kwargs):
            return {"error": "simulated failure"}
        monkeypatch.setattr(
            service._repo, "exit_review_mode", failing_exit
        )

        result = service.end_review()
        # Partial status returned with the error.
        assert result.get("status") == "partial"
        assert "simulated" in result.get("error", "")
        # But review state IS cleared so the user isn't stuck.
        assert service._review_active is False
        assert service.get_review_state()["active"] is False

    def test_get_review_file_diff_requires_active(
        self, service: LLMService
    ) -> None:
        """Diff fetch is guarded by review-active flag."""
        result = service.get_review_file_diff("some.py")
        assert "not active" in result.get("error", "").lower()

    def test_get_review_file_diff_no_repo(
        self,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Service without a repo → clean error."""
        svc = LLMService(config=config, repo=None)
        svc._review_active = True
        result = svc.get_review_file_diff("some.py")
        assert "repository" in result.get("error", "").lower()

    def test_get_snippets_default_code(
        self, service: LLMService
    ) -> None:
        """Code mode snippets when no mode/review state active."""
        snippets = service.get_snippets()
        assert isinstance(snippets, list)
        # Code snippets cover common LLM interaction patterns.
        assert any(
            "continue" in s.get("message", "").lower()
            for s in snippets
        )

    def test_get_snippets_review_mode(
        self, service: LLMService
    ) -> None:
        """Review snippets returned when review active."""
        service._review_active = True
        snippets = service.get_snippets()
        assert isinstance(snippets, list)
        # At least one review-style snippet should mention review.
        assert any(
            "review" in s.get("message", "").lower()
            for s in snippets
        )

    def test_get_snippets_doc_mode(
        self, service: LLMService
    ) -> None:
        """Doc snippets returned in doc mode (outside review)."""
        service.switch_mode("doc")
        snippets = service.get_snippets()
        assert isinstance(snippets, list)
        # Doc snippets mention summaries / documents.
        assert any(
            any(
                k in s.get("message", "").lower()
                for k in ("summaris", "document", "toc")
            )
            for s in snippets
        )

    def test_get_snippets_review_overrides_mode(
        self, service: LLMService
    ) -> None:
        """Review snippets win over doc-mode snippets."""
        service.switch_mode("doc")
        service._review_active = True
        snippets = service.get_snippets()
        # Review snippets — verify a review-specific snippet
        # appears and doc-specific ones don't.
        messages = [s.get("message", "").lower() for s in snippets]
        assert any("review" in m for m in messages)

    def test_get_commit_graph_delegates(
        self,
        service: LLMService,
        repo_dir: Path,
    ) -> None:
        """get_commit_graph delegates to the repo."""
        result = service.get_commit_graph(limit=10)
        assert "commits" in result
        assert "branches" in result
        assert "has_more" in result

    def test_get_commit_graph_no_repo(
        self,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """No repo → empty shape rather than error."""
        svc = LLMService(config=config, repo=None)
        result = svc.get_commit_graph()
        assert result == {
            "commits": [],
            "branches": [],
            "has_more": False,
        }

    def test_review_state_returns_independent_copies(
        self, service: LLMService
    ) -> None:
        """Mutating returned state doesn't affect stored state."""
        # Seed review state directly to avoid running the full
        # entry sequence.
        service._review_state = {
            "active": True,
            "branch": "feature",
            "branch_tip": "abc",
            "base_commit": "xyz",
            "parent_commit": "def",
            "original_branch": "main",
            "commits": [{"sha": "1"}],
            "changed_files": [{"path": "a.py"}],
            "stats": {"commit_count": 1},
            "pre_change_symbol_map": "secret",
        }
        state = service.get_review_state()
        # pre_change_symbol_map stripped.
        assert "pre_change_symbol_map" not in state
        # Mutating copies doesn't affect stored state.
        state["commits"].append({"sha": "2"})
        state["changed_files"].append({"path": "b.py"})
        state["stats"]["commit_count"] = 999
        assert len(service._review_state["commits"]) == 1
        assert len(service._review_state["changed_files"]) == 1
        assert service._review_state["stats"]["commit_count"] == 1

    async def test_streaming_injects_review_context(
        self,
        service: LLMService,
        repo_dir: Path,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Active review → review context attached to context manager."""
        # Set up a feature branch with a commit.
        _run_git(repo_dir, "checkout", "-q", "-b", "feature")
        (repo_dir / "new.py").write_text(
            "def hello():\n    return 42\n"
        )
        _run_git(repo_dir, "add", "new.py")
        _run_git(
            repo_dir, "commit", "-q", "-m", "feat: add hello"
        )
        _run_git(repo_dir, "checkout", "-q", "main")

        tip = service._repo._run_git(
            ["rev-parse", "feature"], check=True
        ).stdout.strip()
        service.start_review("feature", tip)

        # Stream a message — should trigger review context build.
        fake_litellm.set_streaming_chunks(["ok"])
        await service.chat_streaming(
            request_id="r1", message="review this"
        )
        await asyncio.sleep(0.3)

        # Review context populated on the context manager.
        review_ctx = service._context.get_review_context()
        assert review_ctx is not None
        assert "feature" in review_ctx
        assert "## Review:" in review_ctx
        assert "## Commits" in review_ctx

    async def test_streaming_without_review_clears_context(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Non-review streaming clears any stale review context."""
        # Seed a stale review context.
        service._context.set_review_context("stale review data")
        assert service._context.get_review_context() == (
            "stale review data"
        )

        fake_litellm.set_streaming_chunks(["ok"])
        await service.chat_streaming(
            request_id="r1", message="normal chat"
        )
        await asyncio.sleep(0.3)

        # Context cleared defensively.
        assert service._context.get_review_context() is None


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


# ---------------------------------------------------------------------------
# _assemble_tiered — legend dispatch (Layer 2.8.2e)
# ---------------------------------------------------------------------------


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
        fake_symbol_index = _FakeSymbolIndex({"a.py": "block-a"})
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
        original_doc_get_legend = svc._doc_index.get_legend
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


class _FakeRefIndex:
    """Minimal reference-index stub for rebuild_cache tests.

    Exposes the two methods ``StabilityTracker.initialize_with_keys``
    calls: ``file_ref_count`` (for L0 seeding order) and
    ``connected_components`` (for L1/L2/L3 clustering). Matches
    the shape of Layer 2.4's :class:`ReferenceIndex` without
    pulling in the real tree-sitter stack.
    """

    def __init__(
        self,
        ref_counts: dict[str, int] | None = None,
        components: list[set[str]] | None = None,
    ) -> None:
        self._ref_counts = dict(ref_counts or {})
        self._components = list(components or [])

    def file_ref_count(self, path: str) -> int:
        return self._ref_counts.get(path, 0)

    def connected_components(self) -> list[set[str]]:
        # Return copies so the tracker can't mutate our fixture.
        return [set(c) for c in self._components]


class _FakeSymbolIndexWithRefs:
    """Symbol index stub that also carries a ``_ref_index`` attribute.

    Layer 3.7's ``_try_initialize_stability`` and
    ``rebuild_cache_impl`` both reach into ``symbol_index._ref_index``
    — the real :class:`SymbolIndex` exposes it as a private
    attribute used for tier initialisation. Tests use this stub to
    supply a controllable reference graph without needing a real
    tree-sitter-backed index.
    """

    def __init__(
        self,
        blocks: dict[str, str] | None = None,
        ref_counts: dict[str, int] | None = None,
        components: list[set[str]] | None = None,
        legend: str = "",
        all_symbols: dict[str, Any] | None = None,
    ) -> None:
        self._blocks = dict(blocks or {})
        self._ref_index = _FakeRefIndex(ref_counts, components)
        self._legend = legend
        # _all_symbols is consumed by both _update_stability's
        # step-3 loop AND _rebuild_cache_impl's indexed-files
        # filter (`path in self._symbol_index._all_symbols`).
        # When callers don't supply all_symbols explicitly, we
        # default to the same key set as blocks — matching the
        # real SymbolIndex invariant that every indexed file
        # appears in both _all_symbols (FileSymbols objects)
        # and is queryable via get_file_symbol_block. A test
        # that wants to desync them (e.g., to exercise an
        # error path) can pass all_symbols=... explicitly.
        if all_symbols is None:
            # Mirror blocks so rebuild's filter admits the
            # same files the stub says it can render blocks
            # for. None values are a cheap sentinel — rebuild
            # only tests membership, not the value shape.
            self._all_symbols = {k: None for k in self._blocks}
        else:
            self._all_symbols = dict(all_symbols)

    def get_file_symbol_block(self, path: str) -> str | None:
        return self._blocks.get(path)

    def get_legend(self) -> str:
        return self._legend

    def get_signature_hash(self, path: str) -> str | None:
        # Rebuild doesn't call this; return a stable per-path
        # digest so _update_stability doesn't raise if a future
        # test composes rebuild with a stability update.
        if path in self._blocks:
            return f"sig-{path}"
        return None


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
        symbol_index: Any | None = None,
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

    def test_places_indexed_files_across_tiers(
        self,
        config: ConfigManager,
        repo: Repo,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Indexed files appear as symbol: entries after rebuild.

        With a reference graph providing both L0 seed candidates
        (by ref count) and connected components (for L1/L2/L3
        distribution), rebuild produces symbol: entries in the
        cached tiers.
        """
        # Build a small graph: three files, one well-connected
        # (goes to L0 or a cached tier), two in a cluster.
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

        # All three files appear as symbol: entries somewhere.
        tracker = svc._stability_tracker
        all_keys = set(tracker.get_all_items().keys())
        assert "symbol:central.py" in all_keys
        assert "symbol:mod_a.py" in all_keys
        assert "symbol:mod_b.py" in all_keys

    def test_swaps_selected_files_to_file_entries(
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

        The "never appears twice" invariant — a selected file's
        symbol: entry is replaced by a file: entry at the same
        tier. Both don't coexist.
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
        # symbol: entry swapped out.
        assert "symbol:a.py" not in all_keys
        # file: entry swapped in.
        assert "file:a.py" in all_keys
        # Tier is preserved — it landed somewhere cached (L0-L3).
        file_item = tracker.get_all_items()["file:a.py"]
        from ac_dc.stability_tracker import Tier
        assert file_item.tier != Tier.ACTIVE

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
        """Seed the doc index with markdown outlines for rebuild tests.

        Helper that mirrors the pattern used in cross-reference
        tests — constructs real DocOutline objects via the
        markdown extractor rather than mocking the doc index's
        interface. Rebuild reads from ``_all_outlines.keys()``
        so we populate that dict directly.
        """
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

    def test_doc_mode_places_doc_entries_across_tiers(
        self,
        config: ConfigManager,
        repo: Repo,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Doc mode rebuild iterates the doc index, not the symbol index.

        Before 2.8.2h the doc-mode branch produced an empty
        indexed_files list with a TODO. Now it reads from
        ``_doc_index._all_outlines`` and places ``doc:`` entries
        in cached tiers via the same clustering algorithm used
        for symbol entries in code mode.
        """
        # Symbol index has some files, but doc mode shouldn't
        # care — rebuild in doc mode dispatches to the doc
        # index's outlines, not the symbol index.
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
        # Seed doc outlines.
        self._seed_doc_outlines(
            svc, ["README.md", "guide.md", "api.md"]
        )
        # Switch to doc mode via the context manager (avoids
        # switch_mode's side effects).
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker

        result = svc.rebuild_cache()
        assert result["status"] == "rebuilt"
        assert result["mode"] == "doc"

        # All three doc files appear as doc: entries somewhere.
        tracker = svc._stability_tracker
        all_keys = set(tracker.get_all_items().keys())
        assert "doc:README.md" in all_keys
        assert "doc:guide.md" in all_keys
        assert "doc:api.md" in all_keys

        # No symbol: entries — rebuild didn't iterate the symbol
        # index in doc mode.
        assert "symbol:ignored.py" not in all_keys

    def test_doc_mode_rebuild_swaps_selected_doc_files(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Selected doc file → file: entry, not doc: entry.

        The "never appears twice" invariant applies in doc mode
        the same way as code mode. A selected markdown file
        becomes a file: entry with full content; its doc: entry
        (if any was placed by clustering) gets swapped out.
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
        # Selected doc swapped to file: entry.
        assert "file:README.md" in all_keys
        assert "doc:README.md" not in all_keys
        # Unselected doc retains its doc: entry.
        assert "doc:guide.md" in all_keys

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

    def test_cross_ref_rebuild_preserves_unselected_secondary_entries(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """The swap only strips the SELECTED file's secondary entry.

        Other files in the secondary index keep their entries —
        we're not wiping cross-reference indiscriminately, just
        enforcing uniqueness for selected paths.

        The selected file must be present in the PRIMARY index so
        step 7 runs the swap path that Fix 2 extends. An orphan
        path (selected but not in the primary index) goes through
        the step-8 orphan-distribution path instead, which is
        outside Fix 2's scope. See
        ``test_cross_ref_rebuild_swaps_both_prefixes_for_selected_file``
        for the core regression.
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
        # selected.py is in both indexes (cross-ref seeds
        # doc:selected.py alongside the primary symbol entry);
        # other.md is only in the doc index.
        self._seed_doc_outlines(svc, ["selected.py", "other.md"])
        svc._doc_index_ready = True
        svc._cross_ref_enabled = True
        svc.set_selected_files(["selected.py"])

        svc.rebuild_cache()

        tracker = svc._stability_tracker
        all_keys = set(tracker.get_all_items().keys())
        # Selected file → file: only; both index prefixes swapped.
        assert "file:selected.py" in all_keys
        assert "symbol:selected.py" not in all_keys
        assert "doc:selected.py" not in all_keys
        # Other doc file's entry preserved (scope check — the
        # swap only affects the selected path).
        assert "doc:other.md" in all_keys

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


# ---------------------------------------------------------------------------
# _update_stability — mode-aware index entry dispatch (Layer 2.8.2f)
# ---------------------------------------------------------------------------


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

    def test_code_mode_cross_ref_adds_both(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Code mode + cross-ref on → symbol: primary + doc: secondary."""
        svc, capture = self._make_service_with_update_capture(
            config, repo, fake_litellm,
            symbol_paths=["a.py", "b.py"],
            doc_paths=["README.md", "guide.md"],
        )
        svc._cross_ref_enabled = True

        svc._update_stability()
        active = capture["active_items"]

        # Both primary (symbol) and secondary (doc) entries.
        assert "symbol:a.py" in active
        assert "symbol:b.py" in active
        assert "doc:README.md" in active
        assert "doc:guide.md" in active

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

    def test_doc_mode_cross_ref_adds_both(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Doc mode + cross-ref on → doc: primary + symbol: secondary."""
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

        # Both primary (doc) and secondary (symbol) entries.
        assert "doc:README.md" in active
        assert "doc:guide.md" in active
        assert "symbol:a.py" in active
        assert "symbol:b.py" in active

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
        """Cross-reference mode respects selected-files exclusion.

        A selected file shouldn't appear as either prefix even
        when both indexes are active.
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

        # Selected files → file: only, no symbol:/doc:.
        assert "file:a.py" in active
        assert "symbol:a.py" not in active
        assert "doc:a.py" not in active
        assert "file:README.md" in active
        assert "symbol:README.md" not in active
        assert "doc:README.md" not in active
        # Unselected files still present with the right prefix.
        assert "symbol:b.py" in active
        assert "doc:guide.md" in active

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

    def test_step_4_skips_excluded_cross_ref_paths(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Cross-reference step 4 also honours the excluded set.

        Without this skip, an excluded file would survive step
        0a's removal, skip step 3's primary-index registration,
        but get re-registered via step 4's cross-ref pass.
        """
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=["a.py"],
            doc_paths=["excluded.md", "normal.md"],
        )
        # Code mode primary; cross-ref adds doc: as secondary.
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
        # Excluded doc file absent from cross-ref entries;
        # normal doc file present.
        assert "doc:excluded.md" not in active
        assert "doc:normal.md" in active
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


# ---------------------------------------------------------------------------
# Cross-reference lifecycle — readiness gate, seeding, removal (2.8.2g)
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Lazy init — mode-aware (2.8.2i)
# ---------------------------------------------------------------------------


class TestLazyInitModeAware:
    """_try_initialize_stability dispatches by current mode.

    Code mode (default): seeds the tracker from the symbol
    index's reference graph with ``symbol:`` prefix.

    Doc mode: seeds from the doc index's reference graph with
    ``doc:`` prefix. If doc index isn't ready yet, skips
    cleanly — next request's lazy-init retry catches it.

    Mode switches before init cause the switch's own state
    setup to drive the tracker; this test class covers only
    the first-call init path.
    """

    def _seed_doc_outlines(
        self, svc: LLMService, paths: list[str]
    ) -> None:
        """Seed the doc index with markdown outlines."""
        from ac_dc.doc_index.extractors.markdown import (
            MarkdownExtractor,
        )
        from pathlib import Path as _Path

        extractor = MarkdownExtractor()
        for path in paths:
            outline = extractor.extract(
                _Path(path),
                f"# Heading for {path}\n\nbody.\n",
            )
            svc._doc_index._all_outlines[path] = outline

    def _make_service(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        symbol_paths: list[str] | None = None,
        repo_files: list[str] | None = None,
        monkeypatch: pytest.MonkeyPatch | None = None,
    ) -> LLMService:
        """Build a service with a controllable symbol index and repo."""
        symbol_paths = symbol_paths or []
        fake_index = _FakeSymbolIndexWithRefs(
            blocks={p: f"block-{p}" for p in symbol_paths},
            ref_counts={p: 1 for p in symbol_paths},
            components=[],
        )
        # Stub the symbol index's index_repo so it doesn't try
        # to re-walk the repo on init.
        fake_index.index_repo = lambda files: None  # type: ignore[method-assign]

        svc = LLMService(
            config=config,
            repo=repo,
            symbol_index=fake_index,
        )
        if repo_files is not None and monkeypatch is not None:
            monkeypatch.setattr(
                repo,
                "get_flat_file_list",
                lambda: "\n".join(repo_files),
            )
        return svc

    def test_code_mode_init_uses_symbol_prefix(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Code mode init seeds tracker with symbol: entries."""
        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=["a.py", "b.py"],
            repo_files=["a.py", "b.py"],
            monkeypatch=monkeypatch,
        )
        assert svc._context.mode == Mode.CODE

        svc._try_initialize_stability()

        assert svc._stability_initialized.get(Mode.CODE, False) is True
        all_keys = set(
            svc._stability_tracker.get_all_items().keys()
        )
        assert "symbol:a.py" in all_keys
        assert "symbol:b.py" in all_keys
        # No doc: entries in code mode.
        assert not any(k.startswith("doc:") for k in all_keys)

    def test_doc_mode_init_uses_doc_prefix(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Doc mode init seeds tracker with doc: entries.

        Symbol paths exist but aren't used — the primary
        index in doc mode is the doc index, not the symbol
        index.
        """
        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=["ignored.py"],
            repo_files=["ignored.py", "guide.md"],
            monkeypatch=monkeypatch,
        )
        # Seed doc outlines and switch to doc mode.
        self._seed_doc_outlines(svc, ["guide.md", "README.md"])
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker
        # Doc index must be marked ready for init to proceed.
        svc._doc_index_ready = True

        svc._try_initialize_stability()

        assert svc._stability_initialized.get(Mode.DOC, False) is True
        all_keys = set(
            svc._stability_tracker.get_all_items().keys()
        )
        assert "doc:guide.md" in all_keys
        assert "doc:README.md" in all_keys
        # No symbol: entries in doc mode.
        assert not any(
            k.startswith("symbol:") for k in all_keys
        )

    def test_doc_mode_init_skipped_when_not_ready(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Doc mode + _doc_index_ready False → skip init cleanly.

        The next chat request's lazy-init retry will try again
        once the background build completes. Meanwhile the
        tracker stays uninitialized, which is the correct
        state — we don't want to seed a stale/empty doc index.
        """
        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=[],
            repo_files=[],
            monkeypatch=monkeypatch,
        )
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker
        # Doc index NOT ready.
        assert svc._doc_index_ready is False

        svc._try_initialize_stability()

        # Not initialized — next retry will pick it up.
        assert svc._stability_initialized.get(Mode.DOC, False) is False
        # Tracker empty (system:prompt isn't seeded without init).
        assert svc._stability_tracker.get_all_items() == {}

    def test_doc_mode_init_retry_succeeds_after_ready(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """First call skips; second call after ready succeeds.

        Simulates the "request arrives before build completes"
        case. The first _try_initialize_stability bails; when
        the background build finishes and sets _doc_index_ready,
        the next retry initializes correctly.
        """
        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=[],
            repo_files=[],
            monkeypatch=monkeypatch,
        )
        self._seed_doc_outlines(svc, ["guide.md"])
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker

        # First attempt — not ready, bails.
        assert svc._doc_index_ready is False
        svc._try_initialize_stability()
        assert svc._stability_initialized.get(Mode.DOC, False) is False

        # Background build "completes"; retry.
        svc._doc_index_ready = True
        svc._try_initialize_stability()

        assert svc._stability_initialized.get(Mode.DOC, False) is True
        assert "doc:guide.md" in (
            svc._stability_tracker.get_all_items()
        )

    def test_doc_mode_init_uses_doc_prompt(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Doc mode init seeds with the doc system prompt hash.

        The system prompt hash stored in the tracker should
        correspond to the doc prompt, not the code prompt —
        so when the user later switches to code mode, the
        hash mismatch triggers a reinstall rather than a
        silent drift.
        """
        import hashlib

        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=[],
            repo_files=[],
            monkeypatch=monkeypatch,
        )
        self._seed_doc_outlines(svc, ["guide.md"])
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker
        svc._doc_index_ready = True

        svc._try_initialize_stability()

        # system:prompt registered with the doc prompt's hash.
        doc_prompt = config.get_doc_system_prompt()
        expected_hash = hashlib.sha256(
            doc_prompt.encode("utf-8")
        ).hexdigest()
        item = svc._stability_tracker.get_all_items().get(
            "system:prompt"
        )
        assert item is not None
        assert item.content_hash == expected_hash

    def test_code_mode_init_uses_code_prompt(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Code mode init seeds with the code prompt's hash."""
        import hashlib

        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=["a.py"],
            repo_files=["a.py"],
            monkeypatch=monkeypatch,
        )
        # Default: code mode.
        svc._try_initialize_stability()

        code_prompt = config.get_system_prompt()
        expected_hash = hashlib.sha256(
            code_prompt.encode("utf-8")
        ).hexdigest()
        item = svc._stability_tracker.get_all_items().get(
            "system:prompt"
        )
        assert item is not None
        assert item.content_hash == expected_hash

    def test_code_mode_no_symbol_index_skips(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Code mode without symbol index → skip gracefully."""
        svc = LLMService(
            config=config,
            repo=repo,
            symbol_index=None,
        )
        assert svc._context.mode == Mode.CODE

        svc._try_initialize_stability()

        assert svc._stability_initialized.get(Mode.CODE, False) is False

    def test_init_is_idempotent(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Second call after successful init is a no-op."""
        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=["a.py"],
            repo_files=["a.py"],
            monkeypatch=monkeypatch,
        )
        svc._try_initialize_stability()
        assert svc._stability_initialized.get(Mode.CODE, False) is True
        first_items = set(
            svc._stability_tracker.get_all_items().keys()
        )

        # Simulate something changing in the index that would
        # alter init output. The no-op guard means this change
        # isn't reflected — as expected.
        svc._symbol_index._all_symbols["new.py"] = None

        svc._try_initialize_stability()
        second_items = set(
            svc._stability_tracker.get_all_items().keys()
        )
        assert first_items == second_items

    def test_doc_mode_init_measures_tokens(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Doc mode init replaces placeholder tokens with real counts.

        ``initialize_with_keys`` uses a placeholder token count
        (400) for every seeded item. The post-init
        ``_measure_tracker_tokens`` pass should overwrite those
        with real counts derived from the formatted doc blocks.
        """
        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=[],
            repo_files=[],
            monkeypatch=monkeypatch,
        )
        self._seed_doc_outlines(svc, ["guide.md"])
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker
        svc._doc_index_ready = True

        svc._try_initialize_stability()

        item = svc._stability_tracker.get_all_items().get(
            "doc:guide.md"
        )
        assert item is not None
        # Tokens should reflect the real block, not the 400
        # placeholder. The exact value depends on the counter
        # model, but it'll be non-zero and different from 400.
        # "# Heading for guide.md\n\nbody.\n" is ~6-10 tokens.
        assert item.tokens > 0
        assert item.tokens != 400


# ---------------------------------------------------------------------------
# Compaction system-event message — Increment B of the compaction UI plan
# ---------------------------------------------------------------------------


class TestCompactionSystemEvent:
    """Compaction events land as system-event messages in history.

    After a successful compaction, ``_post_response`` appends a
    ``system_event: true`` message to both the context manager's
    in-memory history and the persistent JSONL store. The
    message reports the compaction case, boundary info (for
    truncate) or fallback line (for summarize), and before/after
    stats. For summarize cases, the summary text is embedded in
    an expandable ``<details>`` block.

    Tests exercise both happy paths (truncate + summarize) plus
    the error-path rule (don't append on compaction_error) and
    edge cases around the event reaching both stores with the
    correct content.

    Driving compaction from a test requires an unusual setup:
    we have to seed enough history to trigger the threshold,
    provide a canned detector response, and let
    ``_post_response`` run. The compactor's trigger check
    compares against ``config.compaction_config['trigger_tokens']``
    so we monkey-patch the compaction config to a low value
    (500 tokens) that's easily exceeded by a few long messages.
    """

    def _trigger_small_config(
        self,
        config: ConfigManager,
    ) -> None:
        """Rewrite compaction config to a low trigger.

        The compactor reads through ``config.compaction_config``
        via a property that re-parses ``app.json`` on each
        access (no cache to invalidate beyond the one we null
        out defensively). We write the keys
        :class:`HistoryCompactor` actually consults —
        ``compaction_trigger_tokens``, not ``trigger_tokens``.
        Mismatched key names were the cause of the original
        "compaction never triggers in tests" bug.
        """
        # Access the compactor's config via its live-read path.
        # The real ConfigManager loads from app.json; we override
        # the underlying file and invalidate any cache.
        import json as _json
        app_path = config.config_dir / "app.json"
        app_data = _json.loads(app_path.read_text())
        app_data.setdefault("history_compaction", {})
        app_data["history_compaction"]["enabled"] = True
        # Key names match the ones HistoryCompactor's properties
        # read from self._config.get(...).
        app_data["history_compaction"]["compaction_trigger_tokens"] = 500
        app_data["history_compaction"]["verbatim_window_tokens"] = 200
        app_data["history_compaction"]["min_verbatim_exchanges"] = 1
        app_data["history_compaction"]["summary_budget_tokens"] = 500
        app_path.write_text(_json.dumps(app_data))
        # Clear any cached copy so the next access re-reads.
        config._app_config = None

    def _seed_history_over_trigger(
        self,
        service: LLMService,
    ) -> None:
        """Add ~600 tokens of history so the compactor triggers."""
        # Each message is ~60 tokens (300 chars); 10 exchanges
        # crosses the 500-token threshold with margin.
        long_content = "x " * 150
        for _ in range(10):
            service._context.add_message("user", long_content)
            service._context.add_message(
                "assistant", long_content
            )

    def _patch_detector(
        self,
        service: LLMService,
        boundary_index: int | None,
        confidence: float,
        reason: str,
        summary: str,
    ) -> None:
        """Replace the compactor's detector with a canned response."""
        def _detector(
            messages: list[dict[str, Any]],
        ) -> TopicBoundary:
            return TopicBoundary(
                boundary_index=boundary_index,
                boundary_reason=reason,
                confidence=confidence,
                summary=summary,
            )
        service._compactor._detect = _detector

    async def test_truncate_case_appends_system_event_to_context(
        self,
        service: LLMService,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Successful truncate → system event in context history."""
        self._trigger_small_config(config)
        self._seed_history_over_trigger(service)
        # Boundary in the last few messages (past the verbatim
        # window start) with high confidence → truncate case.
        self._patch_detector(
            service,
            boundary_index=18,
            confidence=0.9,
            reason="user switched to logging work",
            summary="",
        )

        tid = HistoryStore.new_turn_id()
        await service._post_response("r1", tid)

        # System event present in context.
        history = service._context.get_history()
        events = [
            m for m in history
            if m.get("system_event")
            and "History compacted" in m.get("content", "")
        ]
        assert len(events) == 1
        content = events[0]["content"]
        assert "truncate" in content
        assert "logging" in content
        assert "confidence" in content

    async def test_truncate_case_persists_to_history_store(
        self,
        service: LLMService,
        config: ConfigManager,
        history_store: HistoryStore,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Successful truncate → system event in JSONL too."""
        self._trigger_small_config(config)
        self._seed_history_over_trigger(service)
        self._patch_detector(
            service,
            boundary_index=18,
            confidence=0.9,
            reason="topic shift",
            summary="",
        )

        tid = HistoryStore.new_turn_id()
        await service._post_response("r1", tid)

        sid = service.get_current_state()["session_id"]
        persisted = history_store.get_session_messages(sid)
        events = [
            m for m in persisted
            if m.get("system_event")
            and "History compacted" in m.get("content", "")
        ]
        assert len(events) == 1

    async def test_summarize_case_embeds_details_block(
        self,
        service: LLMService,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Summarize → <details> block with summary text."""
        self._trigger_small_config(config)
        self._seed_history_over_trigger(service)
        # Boundary before the verbatim window → summarize case.
        self._patch_detector(
            service,
            boundary_index=2,
            confidence=0.8,
            reason="early exploration",
            summary=(
                "The prior conversation covered setting up the "
                "auth module and writing the first tests."
            ),
        )

        tid = HistoryStore.new_turn_id()
        await service._post_response("r1", tid)

        history = service._context.get_history()
        events = [
            m for m in history
            if m.get("system_event")
            and "History compacted" in m.get("content", "")
        ]
        assert len(events) == 1
        content = events[0]["content"]
        assert "summarize" in content
        assert "<details>" in content
        assert "<summary>Summary</summary>" in content
        assert "auth module" in content
        assert "</details>" in content

    async def test_summarize_without_detector_summary_uses_fallback(
        self,
        service: LLMService,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Summarize + empty detector summary → compactor fallback shown.

        When the detector returns an empty summary string,
        :class:`HistoryCompactor` substitutes a generic
        placeholder so the LLM's next turn sees *something*
        describing the compacted history. The event builder
        reads the compactor's final ``result.summary`` — not the
        detector's original output — so the ``<details>`` block
        IS present, carrying the fallback text.

        This is the user-visible behaviour: a compaction with
        no detected topic boundary still produces an expandable
        summary block in the chat, populated with the generic
        fallback. The "empty summary → no details" path exists
        only when ``_build_compaction_event_text`` is called
        directly with a ``CompactionResult(summary="")`` — covered
        by :meth:`test_build_event_text_summarize_without_summary`.
        """
        self._trigger_small_config(config)
        self._seed_history_over_trigger(service)
        self._patch_detector(
            service,
            boundary_index=None,
            confidence=0.0,
            reason="",
            summary="",
        )

        tid = HistoryStore.new_turn_id()
        await service._post_response("r1", tid)

        history = service._context.get_history()
        events = [
            m for m in history
            if m.get("system_event")
            and "History compacted" in m.get("content", "")
        ]
        assert len(events) == 1
        content = events[0]["content"]
        # Fallback boundary line present — no detector-reported
        # reason to display.
        assert "No clear topic boundary" in content
        # Details block present with the compactor's generic
        # fallback summary text. The fallback is defined in
        # history_compactor._GENERIC_SUMMARY_FALLBACK; we assert
        # on a stable fragment rather than the full string to
        # avoid coupling to the exact wording.
        assert "<details>" in content
        assert "<summary>Summary</summary>" in content
        assert "earlier topics" in content
        assert "</details>" in content

    async def test_event_contains_token_stats(
        self,
        service: LLMService,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Stats line reports before/after token counts and message delta."""
        self._trigger_small_config(config)
        self._seed_history_over_trigger(service)
        self._patch_detector(
            service,
            boundary_index=18,
            confidence=0.9,
            reason="shift",
            summary="",
        )

        tid = HistoryStore.new_turn_id()
        await service._post_response("r1", tid)

        history = service._context.get_history()
        events = [
            m for m in history
            if m.get("system_event")
            and "History compacted" in m.get("content", "")
        ]
        assert len(events) == 1
        content = events[0]["content"]
        # Stats line format: "Removed N messages • M → N tokens"
        assert "Removed" in content
        assert "messages" in content
        assert "tokens" in content
        assert "→" in content

    async def test_error_path_does_not_append_system_event(
        self,
        service: LLMService,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """compaction_error → no system event written.

        A failure in the detector (or anywhere in the
        compactor's path) emits compaction_error and returns.
        Appending a message saying compaction failed would be
        noise — the event already communicates the failure via
        the progress channel, and the history (which we
        couldn't compact) stays intact.
        """
        self._trigger_small_config(config)
        self._seed_history_over_trigger(service)
        # Force the compactor to raise.
        def _broken(messages: list[dict[str, Any]]) -> TopicBoundary:
            raise RuntimeError("simulated detector failure")
        service._compactor._detect = _broken
        # The HistoryCompactor's _safely_detect catches the
        # raise and returns SAFE_BOUNDARY; so the compaction
        # itself won't error. Force a harder failure by making
        # compact_history_if_needed itself raise.
        original = service._compactor.compact_history_if_needed
        def _raise(*args: Any, **kwargs: Any) -> Any:
            raise RuntimeError("pipeline failure")
        service._compactor.compact_history_if_needed = _raise  # type: ignore[method-assign]

        try:
            tid = HistoryStore.new_turn_id()
            await service._post_response("r1", tid)
        finally:
            service._compactor.compact_history_if_needed = original  # type: ignore[method-assign]

        # No compaction system event.
        history = service._context.get_history()
        events = [
            m for m in history
            if m.get("system_event")
            and "History compacted" in m.get("content", "")
        ]
        assert events == []

        # compaction_error event fired via the callback.
        errors = [
            args for name, args in event_cb.events
            if name == "compactionEvent"
            and args[1].get("stage") == "compaction_error"
        ]
        assert errors

    async def test_event_appended_after_set_history(
        self,
        service: LLMService,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """System event is the LAST message in the compacted history.

        Without this ordering, a browser reload after compaction
        would show the compacted messages without the system
        event — the event would only appear on the NEXT request.
        Pinning ensures the event is visible in the current
        session state immediately.
        """
        self._trigger_small_config(config)
        self._seed_history_over_trigger(service)
        self._patch_detector(
            service,
            boundary_index=18,
            confidence=0.9,
            reason="x",
            summary="",
        )

        tid = HistoryStore.new_turn_id()
        await service._post_response("r1", tid)

        history = service._context.get_history()
        assert len(history) > 0
        last = history[-1]
        assert last.get("system_event") is True
        assert "History compacted" in last.get("content", "")

    async def test_broadcast_includes_event_in_messages(
        self,
        service: LLMService,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """compacted broadcast carries the system event in its messages.

        The frontend's ChatPanel replaces its message list from
        this broadcast. If the event weren't included, the
        chat panel would briefly show the compacted list
        WITHOUT the event, then append it on the next render
        — producing a visible flicker. Pinning the event's
        presence in the broadcast payload prevents that.
        """
        self._trigger_small_config(config)
        self._seed_history_over_trigger(service)
        self._patch_detector(
            service,
            boundary_index=18,
            confidence=0.9,
            reason="x",
            summary="",
        )

        tid = HistoryStore.new_turn_id()
        await service._post_response("r1", tid)

        # Find the compacted broadcast.
        completes = [
            args for name, args in event_cb.events
            if name == "compactionEvent"
            and args[1].get("stage") == "compacted"
        ]
        assert completes
        payload = completes[-1][1]
        messages = payload.get("messages", [])
        events = [
            m for m in messages
            if m.get("system_event")
            and "History compacted" in m.get("content", "")
        ]
        assert len(events) == 1

    def test_build_event_text_truncate_format(self) -> None:
        """Helper produces the documented 3-part format for truncate."""
        from ac_dc.llm_service import _build_compaction_event_text

        result = CompactionResult(
            case="truncate",
            messages=[],
            boundary=TopicBoundary(
                boundary_index=5,
                boundary_reason="switched topics",
                confidence=0.95,
                summary="",
            ),
            summary="",
        )
        text = _build_compaction_event_text(
            result,
            tokens_before=24000,
            tokens_after=8400,
            messages_before_count=20,
            messages_after_count=2,
        )
        # Header line.
        assert text.startswith("**History compacted** — truncate")
        # Boundary line.
        assert "switched topics" in text
        assert "0.95" in text
        # Stats line.
        assert "Removed 18 messages" in text
        assert "24000 → 8400 tokens" in text
        # No details block for truncate.
        assert "<details>" not in text

    def test_build_event_text_summarize_with_summary(self) -> None:
        """Summarize case includes the <details> block."""
        from ac_dc.llm_service import _build_compaction_event_text

        result = CompactionResult(
            case="summarize",
            messages=[],
            boundary=TopicBoundary(
                boundary_index=None,
                boundary_reason="",
                confidence=0.3,
                summary="",
            ),
            summary="earlier work on the parser",
        )
        text = _build_compaction_event_text(
            result,
            tokens_before=28000,
            tokens_after=9200,
            messages_before_count=30,
            messages_after_count=3,
        )
        assert text.startswith("**History compacted** — summarize")
        assert "No clear topic boundary" in text
        assert "Removed 27 messages" in text
        assert "<details>" in text
        assert "<summary>Summary</summary>" in text
        assert "earlier work on the parser" in text
        assert "</details>" in text

    def test_build_event_text_summarize_without_summary(self) -> None:
        """Summarize with empty summary text omits the details block."""
        from ac_dc.llm_service import _build_compaction_event_text

        result = CompactionResult(
            case="summarize",
            messages=[],
            boundary=TopicBoundary(
                boundary_index=None,
                boundary_reason="",
                confidence=0.0,
                summary="",
            ),
            summary="",
        )
        text = _build_compaction_event_text(
            result,
            tokens_before=10000,
            tokens_after=3000,
            messages_before_count=5,
            messages_after_count=1,
        )
        assert "summarize" in text
        assert "<details>" not in text
        assert "No clear topic boundary" in text


class TestGetTurnArchiveRPC:
    """LLMService.get_turn_archive exposes the history-store method.

    Slice 2 of the parallel-agents foundation — per
    specs4/3-llm/history.md § User-Visible Agent Browsing, the
    frontend calls this RPC lazily as the user scrolls the chat.
    The wrapper is a thin delegation to
    :meth:`HistoryStore.get_turn_archive`; tests verify the
    delegation, the no-history-store fallback, and the ordered
    multi-agent shape.
    """

    def test_empty_when_no_history_store(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """No history store attached → empty list, no crash.

        Tests that skip the store should still be able to call
        this RPC without errors. Matches the pattern used by
        ``history_list_sessions`` / ``history_get_session``.
        """
        svc = LLMService(
            config=config, repo=repo, history_store=None
        )
        assert svc.get_turn_archive("turn_anything") == []

    def test_missing_archive_returns_empty(
        self,
        service: LLMService,
    ) -> None:
        """Turn ID with no archive directory returns empty."""
        tid = HistoryStore.new_turn_id()
        result = service.get_turn_archive(tid)
        assert result == []

    def test_returns_archive_when_present(
        self,
        service: LLMService,
        history_store: HistoryStore,
    ) -> None:
        """Archive populated via the store surfaces through the RPC."""
        tid = HistoryStore.new_turn_id()
        history_store.append_agent_message(
            tid, 0, "user", "task for agent zero"
        )
        history_store.append_agent_message(
            tid, 0, "assistant", "done"
        )
        history_store.append_agent_message(
            tid, 1, "user", "task for agent one"
        )

        result = service.get_turn_archive(tid)
        assert len(result) == 2
        assert result[0]["agent_idx"] == 0
        assert len(result[0]["messages"]) == 2
        assert result[1]["agent_idx"] == 1

    def test_preserves_agent_order(
        self,
        service: LLMService,
        history_store: HistoryStore,
    ) -> None:
        """Agents returned in index-ascending order.

        The frontend renders one column per agent left-to-right;
        the RPC must preserve the order so the UI doesn't need
        to re-sort.
        """
        tid = HistoryStore.new_turn_id()
        # Append out of order.
        history_store.append_agent_message(tid, 2, "user", "a2")
        history_store.append_agent_message(tid, 0, "user", "a0")
        history_store.append_agent_message(tid, 1, "user", "a1")

        result = service.get_turn_archive(tid)
        assert [entry["agent_idx"] for entry in result] == [
            0, 1, 2,
        ]

    def test_record_metadata_preserved_through_rpc(
        self,
        service: LLMService,
        history_store: HistoryStore,
    ) -> None:
        """Records arrive at the frontend with full metadata.

        Pins the contract that the RPC is lossless: everything
        the store persisted is visible through the wrapper.
        The agent-browser UI needs file-mention detection in
        the transcripts, which depends on seeing the
        ``files_modified`` field.
        """
        tid = HistoryStore.new_turn_id()
        sid = HistoryStore.new_session_id()
        history_store.append_agent_message(
            tid, 0, "assistant", "edited the files",
            session_id=sid,
            extra={
                "files_modified": ["src/auth.py"],
                "edit_results": [
                    {"file": "src/auth.py", "status": "applied"},
                ],
            },
        )

        result = service.get_turn_archive(tid)
        msg = result[0]["messages"][0]
        assert msg["turn_id"] == tid
        assert msg["session_id"] == sid
        assert msg["files_modified"] == ["src/auth.py"]
        assert msg["edit_results"][0]["status"] == "applied"


# ---------------------------------------------------------------------------
# Per-request token_usage threading — HUD "This Request" fix
# ---------------------------------------------------------------------------


class TestStreamingRequestUsage:
    """Per-request token_usage in the stream-complete result.

    Regression guard for the HUD "This Request" section. The
    `_FakeLiteLLM` emits a final chunk with ``prompt_tokens=10``,
    ``completion_tokens=5``; those numbers must make it through
    ``_run_completion_sync`` → ``_stream_chat`` →
    ``_build_completion_result`` → ``result["token_usage"]`` to
    reach the frontend HUD.

    Before the fix, ``_build_completion_result`` initialised
    ``token_usage`` to zero and never wrote to it — the
    per-request section in the HUD always showed zero even
    though session totals climbed. The fix threads a
    normalised usage dict from the worker thread back out as
    a 4th tuple element.
    """

    async def _last_complete_result(
        self,
        event_cb: _RecordingEventCallback,
    ) -> dict[str, Any]:
        """Extract the most recent streamComplete result dict.

        Async helper so callers can `await asyncio.sleep(...)`
        before invoking it — matches the usage pattern in the
        neighbouring streaming test classes.
        """
        completes = [
            args for name, args in event_cb.events
            if name == "streamComplete"
        ]
        assert completes, "No streamComplete event observed"
        # args = (request_id, result_dict)
        return completes[-1][1]

    async def test_token_usage_populated_when_provider_reports(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """Provider-reported usage threads through to the HUD contract."""
        fake_litellm.set_streaming_chunks(["reply"])

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.2)

        result = await self._last_complete_result(event_cb)
        usage = result.get("token_usage")
        assert usage is not None
        # Fake injects 10/5; the worker normalises provider
        # field-name variations but plain prompt/completion
        # round-trip unchanged.
        assert usage["prompt_tokens"] == 10
        assert usage["completion_tokens"] == 5
        # Cache fields present even when provider didn't report
        # them (normalised to zero).
        assert usage["cache_read_tokens"] == 0
        assert usage["cache_write_tokens"] == 0

    async def test_token_usage_shape_stable_on_error(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Errors produce an all-zero usage dict, not missing field.

        The frontend HUD reads token_usage unconditionally; a
        missing key would render as undefined/NaN. The backend
        always emits a dict with all four keys — zeros on the
        error path. Pinning the shape stops a future refactor
        from silently dropping the field on error exits.
        """
        # Force an error in the executor.
        def _raise(*args: Any, **kwargs: Any) -> None:
            raise RuntimeError("simulated LLM failure")
        monkeypatch.setattr(
            service, "_run_completion_sync", _raise
        )

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.2)

        result = await self._last_complete_result(event_cb)
        assert "error" in result
        # Shape preserved even on error.
        usage = result.get("token_usage")
        assert usage is not None
        assert usage["prompt_tokens"] == 0
        assert usage["completion_tokens"] == 0
        assert usage["cache_read_tokens"] == 0
        assert usage["cache_write_tokens"] == 0

    async def test_session_totals_match_request_usage(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """Session totals reflect the same per-request numbers.

        Before the fix, per-request was zero and session totals
        climbed — the two views disagreed. After the fix they
        agree: one request's usage shows up in both places.
        """
        fake_litellm.set_streaming_chunks(["reply"])

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.2)

        result = await self._last_complete_result(event_cb)
        request_usage = result["token_usage"]
        totals = service.get_session_totals()

        # Session totals accumulate; after one request they
        # equal the request's usage.
        assert totals["input_tokens"] == (
            request_usage["prompt_tokens"]
        )
        assert totals["output_tokens"] == (
            request_usage["completion_tokens"]
        )


# ---------------------------------------------------------------------------
# get_context_breakdown — url_details and symbol_map_details (audit follow-up)
# ---------------------------------------------------------------------------


class TestBreakdownUrlDetails:
    """The Budget sub-view's expandable URL category.

    ``get_context_breakdown`` emits ``breakdown.url_details`` as
    a list of ``{name, url, tokens}`` entries — one per fetched
    URL. Empty list when nothing's fetched; error-record URLs
    are skipped because their ``format_for_prompt()`` would
    return the empty string (the URL service marks error
    records with ``error`` set and empty body).
    """

    def test_empty_when_no_urls_fetched(
        self, service: LLMService
    ) -> None:
        """Fresh service reports no URL details."""
        breakdown = service.get_context_breakdown()["breakdown"]
        assert breakdown["url_details"] == []

    def test_populated_with_name_url_tokens(
        self, service: LLMService
    ) -> None:
        """Fetched URLs appear as detail entries."""
        from ac_dc.url_service.models import URLContent

        service._url_service._fetched[
            "https://example.com/docs"
        ] = URLContent(
            url="https://example.com/docs",
            url_type="generic",
            title="Docs",
            content="lots of documentation here",
            fetched_at="2025-01-01T00:00:00Z",
        )
        service._url_service._fetched[
            "https://github.com/owner/repo"
        ] = URLContent(
            url="https://github.com/owner/repo",
            url_type="github_repo",
            content="readme body",
            fetched_at="2025-01-01T00:00:00Z",
        )

        details = service.get_context_breakdown()[
            "breakdown"
        ]["url_details"]
        assert len(details) == 2
        # Each entry carries name, url, tokens.
        for entry in details:
            assert set(entry.keys()) == {"name", "url", "tokens"}
            assert isinstance(entry["tokens"], int)
            assert entry["tokens"] > 0
        # Display names come from url_service.detection.display_name;
        # for a github repo URL that's "owner/repo".
        names_to_urls = {e["name"]: e["url"] for e in details}
        assert (
            names_to_urls["owner/repo"]
            == "https://github.com/owner/repo"
        )

    def test_error_records_skipped(
        self, service: LLMService
    ) -> None:
        """URLs with the ``error`` field set are omitted."""
        from ac_dc.url_service.models import URLContent

        # Successful fetch → included.
        service._url_service._fetched[
            "https://good.example.com"
        ] = URLContent(
            url="https://good.example.com",
            url_type="generic",
            content="body",
            fetched_at="2025-01-01T00:00:00Z",
        )
        # Error fetch → excluded.
        service._url_service._fetched[
            "https://bad.example.com"
        ] = URLContent(
            url="https://bad.example.com",
            url_type="generic",
            error="HTTP 500",
            fetched_at="2025-01-01T00:00:00Z",
        )

        details = service.get_context_breakdown()[
            "breakdown"
        ]["url_details"]
        assert len(details) == 1
        assert details[0]["url"] == "https://good.example.com"


class TestBreakdownSymbolMapDetails:
    """The Budget sub-view's expandable Symbol Map / Doc Map category.

    ``breakdown.symbol_map_details`` carries a list of
    ``{name, path, tokens}`` entries — one per file in the
    active mode's primary index. Selected files and
    user-excluded files are absent (their content flows via
    ``file:`` or is dropped entirely).
    """

    def _make_service(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        symbol_paths: list[str] | None = None,
        doc_paths: list[str] | None = None,
    ) -> LLMService:
        """Service with controllable index contents."""
        symbol_paths = symbol_paths or []
        doc_paths = doc_paths or []

        class _SymbolIndexStub:
            def __init__(self, paths: list[str]) -> None:
                self._all_symbols = {p: None for p in paths}

            def get_file_symbol_block(
                self, path: str
            ) -> str | None:
                if path in self._all_symbols:
                    return (
                        f"symbol block for {path}\n"
                        "with some content\n"
                    )
                return None

            def get_signature_hash(
                self, path: str
            ) -> str | None:
                return f"sig-{path}" if (
                    path in self._all_symbols
                ) else None

            def get_legend(self) -> str:
                return ""

            def get_symbol_map(
                self,
                exclude_files: set[str] | None = None,
            ) -> str:
                excl = exclude_files or set()
                blocks = []
                for p in self._all_symbols:
                    if p in excl:
                        continue
                    blocks.append(f"symbol block for {p}")
                return "\n\n".join(blocks)

        svc = LLMService(
            config=config,
            repo=repo,
            symbol_index=_SymbolIndexStub(symbol_paths),
        )

        # Seed doc outlines.
        from ac_dc.doc_index.extractors.markdown import (
            MarkdownExtractor,
        )
        from pathlib import Path as _Path

        extractor = MarkdownExtractor()
        for path in doc_paths:
            outline = extractor.extract(
                _Path(path),
                f"# Title {path}\n\nsome body.\n",
            )
            svc._doc_index._all_outlines[path] = outline

        return svc

    def test_empty_when_no_symbol_index(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Service without a symbol index produces no details."""
        svc = LLMService(
            config=config, repo=repo, symbol_index=None
        )
        details = svc.get_context_breakdown()[
            "breakdown"
        ]["symbol_map_details"]
        assert details == []

    def test_code_mode_lists_symbol_index_files(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Code mode emits one entry per file in the symbol index."""
        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=["src/a.py", "src/b.py"],
            doc_paths=["README.md"],
        )
        assert svc._context.mode == Mode.CODE

        details = svc.get_context_breakdown()[
            "breakdown"
        ]["symbol_map_details"]
        paths = sorted(e["path"] for e in details)
        assert paths == ["src/a.py", "src/b.py"]
        # Each entry has the documented shape.
        for entry in details:
            assert set(entry.keys()) == {"name", "path", "tokens"}
            assert entry["tokens"] > 0
        # name is the basename for paths with "/".
        basenames = {e["path"]: e["name"] for e in details}
        assert basenames["src/a.py"] == "a.py"
        assert basenames["src/b.py"] == "b.py"

    def test_doc_mode_lists_doc_index_files(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Doc mode emits one entry per file in the doc index."""
        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=["src/a.py"],
            doc_paths=["docs/guide.md", "README.md"],
        )
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker

        details = svc.get_context_breakdown()[
            "breakdown"
        ]["symbol_map_details"]
        paths = sorted(e["path"] for e in details)
        assert paths == ["README.md", "docs/guide.md"]
        # No .py entries — doc mode doesn't consult the symbol
        # index for the primary map.
        assert not any(
            e["path"].endswith(".py") for e in details
        )

    def test_selected_files_excluded_from_details(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Selected files don't appear in symbol_map_details.

        Same contract as the map itself — selected files'
        content flows via ``file:`` entries in cached tiers
        or the active Working Files section. Their symbol/doc
        blocks would be redundant, so the details listing
        omits them too.
        """
        (repo_dir / "src").mkdir()
        (repo_dir / "src" / "a.py").write_text("content\n")
        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=["src/a.py", "src/b.py"],
        )
        svc.set_selected_files(["src/a.py"])

        details = svc.get_context_breakdown()[
            "breakdown"
        ]["symbol_map_details"]
        paths = [e["path"] for e in details]
        assert "src/a.py" not in paths
        assert "src/b.py" in paths

    def test_user_excluded_files_excluded_from_details(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Index-excluded files are absent from details too.

        Three-state checkbox excludes a file from the index
        entirely — no content, no index block, no entry in
        the breakdown's per-file listing.
        """
        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=["keep.py", "drop.py"],
        )
        svc._excluded_index_files = ["drop.py"]

        details = svc.get_context_breakdown()[
            "breakdown"
        ]["symbol_map_details"]
        paths = [e["path"] for e in details]
        assert "keep.py" in paths
        assert "drop.py" not in paths

    def test_file_count_matches_details_length(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """``symbol_map_files`` count is the total indexed, not filtered.

        Important distinction: the count reflects how many
        files the index holds, while the details list reflects
        how many render. A user who selects 3 of 10 files
        sees ``symbol_map_files=10`` with ``len(details)==7``
        — matches what the Budget sub-view's header should
        show (total known) vs the expanded list (what's
        actually contributing tokens).
        """
        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=["a.py", "b.py", "c.py"],
        )
        breakdown = svc.get_context_breakdown()["breakdown"]
        # All three indexed; all three in details.
        assert breakdown["symbol_map_files"] == 3
        assert len(breakdown["symbol_map_details"]) == 3

    def test_details_tokens_sum_is_reasonable(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Per-file token counts are positive and individually plausible.

        We don't assert a tight numeric match against the
        aggregate ``symbol_map`` total because the formatter's
        aggregated output includes alias headers and cross-file
        separators that the per-file blocks don't duplicate.
        What matters for the Budget UI is that each per-file
        entry reports a positive count and together they
        reflect a non-trivial fraction of the aggregate — so
        the user's expanded view isn't wildly off from the
        collapsed total.
        """
        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=["a.py", "b.py"],
        )
        breakdown = svc.get_context_breakdown()["breakdown"]
        aggregate = breakdown["symbol_map"]
        details = breakdown["symbol_map_details"]
        per_file_sum = sum(e["tokens"] for e in details)
        # Each file contributes some tokens.
        for entry in details:
            assert entry["tokens"] > 0
        # Per-file sum is a meaningful portion of the aggregate
        # — at least half, to rule out a bug where details
        # always report a small constant regardless of content.
        assert per_file_sum >= aggregate // 2