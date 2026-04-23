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
            "cross_ref_enabled",
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
        """get_mode returns the documented shape in default state."""
        result = service.get_mode()
        assert result == {
            "mode": "code",
            "doc_index_ready": False,
            "doc_index_building": False,
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
        """Enabling cross-reference flips the flag and broadcasts."""
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

    def test_doc_key_is_skipped(
        self, service: LLMService
    ) -> None:
        """doc:* items skipped pre-Layer-3.10 (doc index not landed)."""
        _place_item(service._stability_tracker, "doc:README.md", "L1")
        result = service._build_tiered_content()
        assert result is not None
        # doc: dispatched but produces no content and no
        # graduated_files entry.
        assert result["L1"]["symbols"] == ""
        assert result["L1"]["files"] == ""
        assert result["L1"]["graduated_files"] == []

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