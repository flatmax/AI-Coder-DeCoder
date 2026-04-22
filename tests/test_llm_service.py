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
    ac_dc_dir = repo_dir / ".ac-dc"
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