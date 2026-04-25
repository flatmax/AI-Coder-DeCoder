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
import subprocess
from pathlib import Path
from typing import Any

import pytest

from ac_dc.config import ConfigManager
from ac_dc.context_manager import Mode
from ac_dc.doc_index.index import DocIndex
from ac_dc.history_compactor import TopicBoundary
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
    """

    def __init__(self) -> None:
        self.streaming_chunks: list[str] = []
        self.non_streaming_reply: str = ""
        self.call_count = 0
        self.last_call_args: dict[str, Any] = {}

    def set_streaming_chunks(self, chunks: list[str]) -> None:
        """Pre-seed content for the next streaming completion.

        Each string becomes the INCREMENTAL delta of one chunk.
        The service accumulates these and fires streamChunk with
        the running total.
        """
        self.streaming_chunks = list(chunks)

    def set_non_streaming_reply(self, reply: str) -> None:
        """Pre-seed content for the next non-streaming call."""
        self.non_streaming_reply = reply

    def completion(self, **kwargs: Any) -> Any:
        """Match litellm.completion's public signature."""
        self.call_count += 1
        self.last_call_args = kwargs
        if kwargs.get("stream"):
            return self._build_stream()
        return self._build_response(self.non_streaming_reply)

    def _build_stream(self):
        """Yield fake streaming chunks."""
        chunks = list(self.streaming_chunks)
        # Reset so a second call doesn't replay stale content.
        self.streaming_chunks = []

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
        hasn't run the background build yet, enrichment is
        never complete in 2.8.2.
        """
        result = service.get_mode()
        assert result == {
            "mode": "code",
            "doc_index_ready": False,
            "doc_index_building": False,
            "doc_index_enriched": False,
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
        via a property on ``_FakeConfigManager`` — but on the
        real ConfigManager we have to update the underlying JSON.
        Since the compactor holds a reference to the config
        manager and reads the property fresh on each call
        (``HistoryCompactor._config`` property), updating the
        compactor's internal dict is simpler.
        """
        # Access the compactor's config via its live-read path.
        # The real ConfigManager loads from app.json; we override
        # the cached dict directly.
        import json as _json
        app_path = config.config_dir / "app.json"
        app_data = _json.loads(app_path.read_text())
        app_data.setdefault("history_compaction", {})
        app_data["history_compaction"]["enabled"] = True
        app_data["history_compaction"]["trigger_tokens"] = 500
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

        await service._post_response("r1")

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

        await service._post_response("r1")

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

        await service._post_response("r1")

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
        """Summarize + empty summary → no details, fallback line."""
        self._trigger_small_config(config)
        self._seed_history_over_trigger(service)
        # Empty summary — detector didn't produce summary text.
        # The compactor's generic fallback kicks in and
        # substitutes a placeholder, but our event-builder
        # sees the ORIGINAL boundary (with empty summary) so
        # we expect no <details> block.
        self._patch_detector(
            service,
            boundary_index=None,
            confidence=0.0,
            reason="",
            summary="",
        )

        await service._post_response("r1")

        history = service._context.get_history()
        events = [
            m for m in history
            if m.get("system_event")
            and "History compacted" in m.get("content", "")
        ]
        assert len(events) == 1
        content = events[0]["content"]
        # No details block — nothing to put in it.
        assert "<details>" not in content
        # Fallback boundary line present.
        assert (
            "No clear topic boundary" in content
            or "Boundary reason" in content
        )

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

        await service._post_response("r1")

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
            await service._post_response("r1")
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

        await service._post_response("r1")

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

        await service._post_response("r1")

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