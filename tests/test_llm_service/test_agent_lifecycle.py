"""Agent lifecycle RPC surface — registry, close, set-selected, tagged streaming.

Covers the per-agent lifecycle RPCs that keep agent scopes
reachable across turns:

- :class:`TestAgentContextRegistry` — the ``_agent_contexts``
  registry and ``turn_id`` field on the completion result.
  Scopes outlive the spawn's ``asyncio.gather`` so follow-up
  user replies can look them up.
- :class:`TestCloseAgentContext` — :meth:`LLMService.close_agent_context`.
  Frees an agent's ContextManager + tracker + file_context;
  idempotent; archive file on disk survives.
- :class:`TestCloseAgentContextLocalhostOnly` — non-localhost
  callers get the restricted-error shape.
- :class:`TestSetAgentSelectedFiles` — per-agent analogue of
  :meth:`LLMService.set_selected_files`. In-place mutation
  preserves the scope's list identity.
- :class:`TestSetAgentSelectedFilesLocalhostOnly` — symmetric
  localhost-only gate.
- :class:`TestParseAgentTag` — :meth:`LLMService._parse_agent_tag`
  input coercion. Accepts tuple and list forms; rejects
  malformed shapes.
- :class:`TestAgentTaggedStreaming` — ``agent_tag`` routes
  :meth:`LLMService.chat_streaming` to agent scopes. Per-agent
  single-stream guard, malformed/unknown tag handling,
  parallel streams.

Governing specs:
:doc:`specs4/7-future/parallel-agents`,
:doc:`specs4/5-webapp/agent-browser`.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest

from ac_dc.config import ConfigManager
from ac_dc.history_store import HistoryStore
from ac_dc.llm_service import LLMService
from ac_dc.repo import Repo

from .conftest import _FakeLiteLLM, _RecordingEventCallback


class TestAgentContextRegistry:
    """Agent ContextManager registry and turn_id surfacing.

    Identity contract (commit "honor LLM-chosen ids;
    flatten registry"): the registry is keyed flat by the
    LLM-chosen id from the agent's spawn block. The
    ``turn_id`` parameter to ``_build_agent_scope`` is no
    longer part of identity — it's still threaded through
    for archive-file naming (the agent's persisted
    transcript lives at
    ``.ac-dc4/agents/{turn_id}/agent-NN.jsonl``) but the
    registry key is purely the agent's ``id``.

    Two concerns pinned here:

    1. The ``_agent_contexts`` registry outlives the spawn's
       ``asyncio.gather``. When ``_build_agent_scope``
       constructs a scope, the scope lands in
       ``service._agent_contexts[agent_id]``. The registry
       survives across turns so the orchestrator can
       re-address the same agent by name in a later turn.
       ``new_session()`` clears each agent's chat history
       but PRESERVES the scope — agents stay warm for the
       lifetime of the session.

    2. The completion result dict carries ``turn_id``. The
       frontend uses it to look up the per-turn archive on
       demand (history-browser → "View agents" affordance)
       and to correlate the failed turn with the user
       message on the error path.
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
        """_build_agent_scope registers the scope under the agent's id."""
        parent_scope = service._default_scope()
        block = self._make_agent_block("frontend-chat", "t0")
        scope = service._build_agent_scope(
            block=block,
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_abc",
        )
        # Flat registry keyed by the LLM-chosen id.
        assert "frontend-chat" in service._agent_contexts
        assert (
            service._agent_contexts["frontend-chat"] is scope
        )

    def test_registry_handles_multiple_agents(
        self,
        service: LLMService,
    ) -> None:
        """Two agents in one spawn each get their own slot by id."""
        parent_scope = service._default_scope()
        scope_0 = service._build_agent_scope(
            block=self._make_agent_block("frontend", "t0"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_same",
        )
        scope_1 = service._build_agent_scope(
            block=self._make_agent_block("backend", "t1"),
            agent_idx=1,
            parent_scope=parent_scope,
            turn_id="turn_same",
        )
        assert service._agent_contexts["frontend"] is scope_0
        assert service._agent_contexts["backend"] is scope_1
        assert scope_0 is not scope_1

    def test_registry_persists_unique_ids_across_turns(
        self,
        service: LLMService,
    ) -> None:
        """Different ids spawned across turns each get their own slot."""
        parent_scope = service._default_scope()
        scope_a = service._build_agent_scope(
            block=self._make_agent_block("alpha"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_a",
        )
        scope_b = service._build_agent_scope(
            block=self._make_agent_block("beta"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_b",
        )
        # Both reachable independently.
        assert service._agent_contexts["alpha"] is scope_a
        assert service._agent_contexts["beta"] is scope_b
        assert len(service._agent_contexts) == 2

    def test_registry_survives_across_turns(
        self,
        service: LLMService,
    ) -> None:
        """A second turn registering different ids doesn't evict the first.

        Pins the "agents stay warm across turns" invariant.
        Without this, the registry would effectively be a
        single-turn cache and follow-up replies to
        prior-turn agent tabs would fail to find their
        scopes.
        """
        parent_scope = service._default_scope()
        scope_first = service._build_agent_scope(
            block=self._make_agent_block("first-agent"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_first",
        )
        # Second turn comes along, spawns a different agent.
        service._build_agent_scope(
            block=self._make_agent_block("second-agent"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_second",
        )
        # First agent still reachable.
        assert (
            service._agent_contexts["first-agent"]
            is scope_first
        )

    def test_re_addressing_same_id_replaces_scope(
        self,
        service: LLMService,
    ) -> None:
        """A second spawn with the same id replaces the prior scope.

        ``_build_agent_scope`` itself doesn't dispatch
        retask-vs-new-spawn — that's the spawn-loop's job.
        Called directly with a duplicate id, this function
        creates a fresh scope and overwrites the registry
        slot. The retask-preserving lookup-or-spawn
        behaviour is tested in :class:`TestAgentSpawn`.
        """
        parent_scope = service._default_scope()
        scope_v1 = service._build_agent_scope(
            block=self._make_agent_block("worker", "first task"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_iter",
        )
        scope_v2 = service._build_agent_scope(
            block=self._make_agent_block("worker", "revised task"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_iter",
        )
        # v2 replaces v1 in the slot.
        assert service._agent_contexts["worker"] is scope_v2
        assert service._agent_contexts["worker"] is not scope_v1

    def test_new_session_closes_all_live_agents(
        self,
        service: LLMService,
    ) -> None:
        """new_session clears the agent registry entirely.

        Per the "Agents as first-class persistent entities"
        plan (Increment 2 in IMPLEMENTATION_NOTES.md): the
        new-session gesture means "the entire conversation
        thread goes with it — including agents". This
        supersedes the earlier "agents survive new_session"
        policy that produced the "I clicked new session
        and nothing happened" UX bug for users on agent
        tabs.

        Application exit and explicit close-tab clicks both
        also free agents; new_session joins them as a third
        teardown trigger.
        """
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block("alpha"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_one",
        )
        service._build_agent_scope(
            block=self._make_agent_block("beta"),
            agent_idx=1,
            parent_scope=parent_scope,
            turn_id="turn_one",
        )
        assert "alpha" in service._agent_contexts
        assert "beta" in service._agent_contexts

        result = service.new_session()
        assert "session_id" in result

        # All agent scopes gone.
        assert service._agent_contexts == {}

    async def test_completion_result_carries_turn_id(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """streamComplete's result dict includes turn_id.

        Frontend uses turn_id to look up the per-turn
        archive on demand (history-browser → "View agents")
        even though identity itself is the agent's id.
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
        per-turn archive request built from result.turn_id
        must match records in the history store's archive
        path (.ac-dc4/agents/{turn_id}/agent-NN.jsonl) and
        the turn_id field on every persisted message of the
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

    async def test_agent_archive_persists_under_turn_id(
        self,
        service: LLMService,
        history_store: HistoryStore,
        repo_dir: Path,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Per-turn archive directory exists at the spawn's turn_id.

        The agent's identity is its id (and hence its
        registry key), but the on-disk transcript is still
        organised by turn — one directory per turn,
        ``agent-NN.jsonl`` per agent within. This test
        pins that the archive path matches the turn_id
        passed into the spawn.

        Exercises via _spawn_agents_for_turn because that's
        the single path that both registers the scope and
        triggers archive writes.
        """
        fake_litellm.queue_streaming_chunks(["agent reply"])

        parent_scope = service._default_scope()
        service._main_loop = asyncio.get_event_loop()
        turn_id = HistoryStore.new_turn_id()
        block = self._make_agent_block(
            "writer", "write something"
        )

        await service._spawn_agents_for_turn(
            agent_blocks=[block],
            parent_scope=parent_scope,
            parent_request_id="r-main",
            turn_id=turn_id,
        )

        # Registry keyed by the agent's id.
        assert "writer" in service._agent_contexts
        # Archive directory exists at the supplied turn_id.
        archive_dir = repo_dir / ".ac-dc4" / "agents" / turn_id
        assert archive_dir.exists()
        # And get_turn_archive returns content for that turn_id.
        archive = history_store.get_turn_archive(turn_id)
        assert len(archive) == 1


class TestCloseAgentContext:
    """close_agent_context RPC.

    The frontend calls this when the user clicks ✕ on an
    agent tab. The backend frees the scope's ContextManager
    + StabilityTracker + file_context; the per-turn archive
    file on disk stays.

    Identifies agents by their LLM-chosen id (the same id
    used in ``🟧🟧🟧 AGENT`` blocks). Idempotence contract:
    closing an already-closed agent or an unknown id
    returns ``{status: "ok", closed: False}`` rather than
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

    def test_close_unknown_id_is_noop(
        self,
        service: LLMService,
    ) -> None:
        """Unknown agent id → ok with closed=False."""
        result = service.close_agent_context("nonexistent")
        assert result == {"status": "ok", "closed": False}

    def test_close_empty_string_is_noop(
        self,
        service: LLMService,
    ) -> None:
        """Empty string id → ok with closed=False (defensive)."""
        result = service.close_agent_context("")
        assert result == {"status": "ok", "closed": False}

    def test_close_existing_agent_returns_closed_true(
        self,
        service: LLMService,
    ) -> None:
        """Successful close → closed=True; scope removed."""
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block("worker"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_one",
        )
        assert "worker" in service._agent_contexts
        result = service.close_agent_context("worker")
        assert result == {"status": "ok", "closed": True}
        # Agent gone.
        assert "worker" not in service._agent_contexts

    def test_close_one_of_many_leaves_siblings(
        self,
        service: LLMService,
    ) -> None:
        """Closing one agent leaves sibling agents intact."""
        parent_scope = service._default_scope()
        for name in ("alpha", "beta", "gamma"):
            service._build_agent_scope(
                block=self._make_agent_block(name, "t"),
                agent_idx=0,
                parent_scope=parent_scope,
                turn_id="turn_multi",
            )
        result = service.close_agent_context("beta")
        assert result == {"status": "ok", "closed": True}
        # Siblings survive.
        assert "alpha" in service._agent_contexts
        assert "beta" not in service._agent_contexts
        assert "gamma" in service._agent_contexts

    def test_close_is_idempotent(
        self,
        service: LLMService,
    ) -> None:
        """Closing the same agent twice is safe.

        A stale frontend tab ID (user clicks ✕ on a tab that
        was already closed server-side) must not raise.
        Idempotence keeps the frontend's error surface
        narrow.
        """
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block("once"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_twice",
        )
        first = service.close_agent_context("once")
        assert first == {"status": "ok", "closed": True}
        second = service.close_agent_context("once")
        assert second == {"status": "ok", "closed": False}

    def test_close_freed_scope_no_longer_looked_up(
        self,
        service: LLMService,
    ) -> None:
        """After close, set_agent_selected_files can't find the agent."""
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block("ghost"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_gone",
        )
        service.close_agent_context("ghost")
        # The other agent-keyed RPC returns agent-not-found.
        result = service.set_agent_selected_files("ghost", [])
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
        paths (manual archive inspection, history-browser
        deep-link) still work.
        """
        parent_scope = service._default_scope()
        turn_id = "turn_with_archive"
        scope = service._build_agent_scope(
            block=self._make_agent_block("recorder", "test task"),
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
        # Close the agent by id.
        service.close_agent_context("recorder")
        # Archive file survives.
        assert archive_file.exists()
        # And is still readable via the public RPC.
        archive = service.get_turn_archive(turn_id)
        assert len(archive) == 1


class TestCloseAgentContextLocalhostOnly:
    """close_agent_context restricts non-localhost callers.

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
        # the unknown-id noop path.
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block("secured"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_secured",
        )
        result = service.close_agent_context("secured")
        assert result.get("error") == "restricted"
        # Agent NOT freed — the guard runs before the pop.
        assert "secured" in service._agent_contexts

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
            block=self._make_agent_block("local"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_local",
        )
        result = service.close_agent_context("local")
        assert result == {"status": "ok", "closed": True}


class TestSetAgentSelectedFiles:
    """set_agent_selected_files RPC.

    Per-agent analogue of set_selected_files. Identifies
    the agent by its LLM-chosen id. The frontend routes
    picker checkbox toggles here when an agent tab is
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

    def test_unknown_id_returns_error(
        self,
        service: LLMService,
    ) -> None:
        """Unknown agent id → agent-not-found error."""
        result = service.set_agent_selected_files(
            "nonexistent", ["file.py"],
        )
        assert result == {"error": "agent not found"}

    def test_empty_string_id_returns_error(
        self,
        service: LLMService,
    ) -> None:
        """Empty string id → agent-not-found (defensive)."""
        result = service.set_agent_selected_files("", [])
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
            block=self._make_agent_block("worker"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_t",
        )
        result = service.set_agent_selected_files(
            "worker", ["a.py", "b.py"],
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
            block=self._make_agent_block("identity"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_identity",
        )
        original_list = scope.selected_files
        service.set_agent_selected_files(
            "identity", ["a.py"],
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
            block=self._make_agent_block("filter"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_filter",
        )
        result = service.set_agent_selected_files(
            "filter", ["real.py", "phantom.py"],
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
            block=self._make_agent_block("clearer"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_clear",
        )
        # Seed a non-empty selection.
        service.set_agent_selected_files("clearer", ["a.py"])
        assert scope.selected_files == ["a.py"]
        # Clear.
        result = service.set_agent_selected_files(
            "clearer", [],
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
            block=self._make_agent_block("copier"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_copy",
        )
        result = service.set_agent_selected_files(
            "copier", ["a.py"],
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
            block=self._make_agent_block("typed"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_typed",
        )
        result = service.set_agent_selected_files(
            "typed", ["a.py", 42, None, ["nested"]],
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
        block = AgentBlock(id="no-repo", task="t0")
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
            "no-repo", ["anything.py"],
        )
        assert result == ["anything.py"]


class TestSetAgentSelectedFilesLocalhostOnly:
    """set_agent_selected_files restricts non-localhost callers."""

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
            block=self._make_agent_block("guarded"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_restricted",
        )

        class _FakeCollab:
            def is_caller_localhost(self) -> bool:
                return False

        service._collab = _FakeCollab()
        result = service.set_agent_selected_files(
            "guarded", ["a.py"],
        )
        assert result.get("error") == "restricted"
        # Scope NOT mutated.
        assert scope.selected_files == []


class TestSetAgentExcludedIndexFiles:
    """set_agent_excluded_index_files RPC.

    Per-agent analogue of :meth:`LLMService.set_excluded_index_files`.
    Identifies the agent by its LLM-chosen id. The
    frontend routes picker shift-click exclusion toggles
    here when an agent tab is active; the main-tab path
    still hits set_excluded_index_files.

    Tests cover happy path, missing-agent error, per-agent
    tracker entry removal (so stale rows don't linger in the
    cache viewer), and the restricted-error path. The
    ``excluded_index_files`` field on ConversationScope
    starts empty; successful calls replace it.
    """

    def _make_agent_block(
        self,
        agent_id: str = "agent-0",
        task: str = "do something",
    ) -> Any:
        from ac_dc.edit_protocol import AgentBlock

        return AgentBlock(id=agent_id, task=task)

    def test_unknown_id_returns_error(
        self,
        service: LLMService,
    ) -> None:
        """Unknown agent id → agent-not-found error."""
        result = service.set_agent_excluded_index_files(
            "nonexistent", ["file.py"],
        )
        assert result == {"error": "agent not found"}

    def test_empty_string_id_returns_error(
        self,
        service: LLMService,
    ) -> None:
        """Empty string id → agent-not-found (defensive)."""
        result = service.set_agent_excluded_index_files(
            "", [],
        )
        assert result == {"error": "agent not found"}

    def test_replaces_excluded_files(
        self,
        service: LLMService,
    ) -> None:
        """Exclusion replacement — new list becomes canonical."""
        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block("worker"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_t",
        )
        # Scope starts with empty exclusion list.
        assert scope.excluded_index_files == []
        result = service.set_agent_excluded_index_files(
            "worker", ["a.py", "b.py"],
        )
        assert result == ["a.py", "b.py"]
        # Scope reflects the change.
        assert scope.excluded_index_files == ["a.py", "b.py"]

    def test_empty_list_clears_exclusion(
        self,
        service: LLMService,
    ) -> None:
        """Passing [] clears the agent's exclusion set."""
        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block("clearer"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_clear",
        )
        service.set_agent_excluded_index_files(
            "clearer", ["a.py"],
        )
        assert scope.excluded_index_files == ["a.py"]
        result = service.set_agent_excluded_index_files(
            "clearer", [],
        )
        assert result == []
        assert scope.excluded_index_files == []

    def test_returns_copy_not_internal_list(
        self,
        service: LLMService,
    ) -> None:
        """Caller mutations of the return value don't affect scope."""
        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block("copier"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_copy",
        )
        result = service.set_agent_excluded_index_files(
            "copier", ["a.py"],
        )
        assert isinstance(result, list)
        result.append("injected.py")
        # Scope's list unaffected.
        assert scope.excluded_index_files == ["a.py"]

    def test_non_string_entries_filtered(
        self,
        service: LLMService,
    ) -> None:
        """Non-string entries dropped — defensive against bad payloads."""
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block("typed"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_typed",
        )
        result = service.set_agent_excluded_index_files(
            "typed", ["a.py", 42, None, ["nested"]],
        )
        # Only the string survives.
        assert result == ["a.py"]

    def test_removes_stale_tracker_entries(
        self,
        service: LLMService,
    ) -> None:
        """Excluded paths are purged from the agent's tracker.

        The Context tab's Cache sub-view reads per-agent
        tracker state via the agent-tagged
        ``get_context_breakdown``. Without this purge, a
        previously-tracked ``symbol:foo.py`` entry would
        linger after the user excludes foo.py — showing
        a stale row the user just said they didn't want.
        """
        from ac_dc.stability_tracker import Tier, TrackedItem

        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block("purger"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_purge",
        )
        # Seed symbol:, doc:, and file: entries for the
        # path we're about to exclude. All three prefixes
        # must be purged — that's the invariant.
        tracker = scope.tracker
        for prefix in ("symbol:", "doc:", "file:"):
            tracker._items[prefix + "drop.py"] = TrackedItem(
                key=prefix + "drop.py",
                tier=Tier.L1,
                n_value=3,
                content_hash="h",
                tokens=100,
            )
        # Also seed an entry for a different path — must
        # survive the exclusion.
        tracker._items["symbol:keep.py"] = TrackedItem(
            key="symbol:keep.py",
            tier=Tier.L1,
            n_value=3,
            content_hash="h",
            tokens=100,
        )

        service.set_agent_excluded_index_files(
            "purger", ["drop.py"],
        )

        # Every prefix for drop.py gone.
        for prefix in ("symbol:", "doc:", "file:"):
            assert not tracker.has_item(prefix + "drop.py")
        # Unrelated entry untouched.
        assert tracker.has_item("symbol:keep.py")

    def test_multiple_agents_isolated(
        self,
        service: LLMService,
    ) -> None:
        """Excluding on one agent doesn't affect sibling agents.

        Per-tab state invariant — alpha's exclusion
        changes must not leak into beta's scope.
        """
        parent_scope = service._default_scope()
        scope_a = service._build_agent_scope(
            block=self._make_agent_block("alpha"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_both",
        )
        scope_b = service._build_agent_scope(
            block=self._make_agent_block("beta"),
            agent_idx=1,
            parent_scope=parent_scope,
            turn_id="turn_both",
        )
        service.set_agent_excluded_index_files(
            "alpha", ["a-only.py"],
        )
        assert scope_a.excluded_index_files == ["a-only.py"]
        assert scope_b.excluded_index_files == []


class TestSetAgentExcludedIndexFilesLocalhostOnly:
    """set_agent_excluded_index_files restricts non-localhost."""

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
        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block("guarded"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_restricted",
        )

        class _FakeCollab:
            def is_caller_localhost(self) -> bool:
                return False

        service._collab = _FakeCollab()
        result = service.set_agent_excluded_index_files(
            "guarded", ["a.py"],
        )
        assert result.get("error") == "restricted"
        # Scope NOT mutated.
        assert scope.excluded_index_files == []


class TestSwitchAgentMode:
    """switch_agent_mode RPC.

    Per-agent mode toggle (Increment 4a). Identifies the
    agent by its LLM-chosen id. Accepts the four combined
    mode strings on the wire and flattens them into the
    ContextManager's two axes (mode + cross_reference_enabled).

    Tests cover happy path for each mode transition,
    no-op when already in the target state, mid-stream
    rejection, validation errors (unknown agent, malformed
    mode), tracker rebuild side-effect, archive event
    persistence, and the localhost-only gate.
    """

    def _make_agent_block(
        self,
        agent_id: str = "agent-0",
        task: str = "do something",
    ) -> Any:
        from ac_dc.edit_protocol import AgentBlock
        return AgentBlock(id=agent_id, task=task)

    def test_unknown_id_returns_error(
        self,
        service: LLMService,
    ) -> None:
        """Unknown agent id → agent-not-found error."""
        result = service.switch_agent_mode("nonexistent", "doc")
        assert result == {"error": "agent not found"}

    def test_empty_string_id_returns_error(
        self,
        service: LLMService,
    ) -> None:
        """Empty string id → agent-not-found (defensive)."""
        result = service.switch_agent_mode("", "doc")
        assert result == {"error": "agent not found"}

    def test_invalid_mode_string_returns_error(
        self,
        service: LLMService,
    ) -> None:
        """Mode value outside the four-valid set → error.

        The LLM-side surface accepts the same four strings
        every other mode-bearing API does. A malformed
        client payload must surface a clear error rather
        than silently mutating to an unexpected state.
        """
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block("worker"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_t",
        )
        result = service.switch_agent_mode("worker", "rust")
        assert result.get("error") == "invalid mode"
        assert "rust" in result.get("reason", "")

    def test_non_string_mode_returns_error(
        self,
        service: LLMService,
    ) -> None:
        """Defensive — non-string mode value rejected."""
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block("worker"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_t",
        )
        result = service.switch_agent_mode("worker", 42)
        assert result.get("error") == "invalid mode"

    def test_switches_code_to_doc(
        self,
        service: LLMService,
    ) -> None:
        """code → doc switches Mode and clears cross-ref."""
        from ac_dc.context_manager import Mode

        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block("worker"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_t",
        )
        # Default agent state: code mode, xref off.
        assert scope.context.mode == Mode.CODE
        assert scope.context.cross_reference_enabled is False

        result = service.switch_agent_mode("worker", "doc")
        assert result == {
            "status": "ok",
            "agent_id": "worker",
            "mode": "doc",
        }
        assert scope.context.mode == Mode.DOC
        assert scope.context.cross_reference_enabled is False

    def test_switches_to_code_xref(
        self,
        service: LLMService,
    ) -> None:
        """code → code+xref flips just the xref axis."""
        from ac_dc.context_manager import Mode

        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block("worker"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_t",
        )
        result = service.switch_agent_mode(
            "worker", "code+xref",
        )
        assert result["mode"] == "code+xref"
        assert scope.context.mode == Mode.CODE
        assert scope.context.cross_reference_enabled is True

    def test_switches_to_doc_xref(
        self,
        service: LLMService,
    ) -> None:
        """code → doc+xref flips both axes in one call."""
        from ac_dc.context_manager import Mode

        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block("worker"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_t",
        )
        result = service.switch_agent_mode(
            "worker", "doc+xref",
        )
        assert result["mode"] == "doc+xref"
        assert scope.context.mode == Mode.DOC
        assert scope.context.cross_reference_enabled is True

    def test_no_op_when_already_in_target_mode(
        self,
        service: LLMService,
    ) -> None:
        """Same mode → ok status with 'already' message.

        Pinned because re-applying the same mode would
        otherwise rebuild the tracker (a needless cache
        write) and emit an archive event for nothing. The
        identity comparison guards both axes.
        """
        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block("idle"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_t",
        )
        # Pre-set to doc+xref.
        from ac_dc.context_manager import Mode
        scope.context.set_mode(Mode.DOC)
        scope.context.set_cross_reference_enabled(True)
        original_tracker = scope.tracker

        result = service.switch_agent_mode(
            "idle", "doc+xref",
        )
        assert result["status"] == "ok"
        assert "already" in result.get("message", "").lower()
        # Tracker untouched — the no-op short-circuit avoids
        # the rebuild.
        assert scope.tracker is original_tracker

    def test_mid_stream_rejected(
        self,
        service: LLMService,
    ) -> None:
        """Agent with active stream → stream-active error.

        Switching mode mid-flight would leave the cached
        tier prefix mismatched against the agent's
        in-progress LLM call. Frontend hides the toggle
        while the LED is cyan, but the backend guards
        defensively against a stale click.
        """
        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block("busy"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_t",
        )
        # Simulate an in-flight stream.
        service._active_agent_streams.add("busy")
        try:
            result = service.switch_agent_mode("busy", "doc")
            assert result.get("error") == "agent stream active"
            assert "wait" in result.get("reason", "").lower()
            # Mode unchanged.
            from ac_dc.context_manager import Mode
            assert scope.context.mode == Mode.CODE
        finally:
            service._active_agent_streams.discard("busy")

    def test_rebuilds_tracker(
        self,
        service: LLMService,
    ) -> None:
        """Successful switch replaces the agent's tracker.

        Tier placements were valid for the old prompt + index
        combination; the new combination invalidates every
        cached prefix, so a fresh tracker is the correct
        starting state for the next turn. The
        ContextManager's ``stability_tracker`` reference
        also follows the swap so reads through that path
        see the new instance.
        """
        from ac_dc.stability_tracker import StabilityTracker

        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block("worker"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_t",
        )
        original_tracker = scope.tracker

        service.switch_agent_mode("worker", "doc")
        assert scope.tracker is not original_tracker
        assert isinstance(scope.tracker, StabilityTracker)
        # ContextManager attachment also updated.
        assert scope.context.stability_tracker is scope.tracker

    def test_writes_archive_system_event(
        self,
        service: LLMService,
        history_store: Any,
    ) -> None:
        """Archive carries a mode-change system event.

        Per Increment 3b: the agent's archive records the
        transition so reconstruction (Increment 5) can
        replay events and arrive at the agent's final
        mode. The event's content names both the old and
        new modes so a future reader can audit the
        transition without inferring it from neighbouring
        records.
        """
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block("recorder"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_event",
        )

        service.switch_agent_mode(
            "recorder", "doc+xref",
        )

        archive = history_store.get_turn_archive("turn_event")
        assert len(archive) == 1
        messages = archive[0]["messages"]
        # The mode-change event is the only system_event in
        # the archive — agent's task wasn't run, no
        # streaming happened, so the only record is our
        # archive write.
        events = [
            m for m in messages
            if m.get("system_event") is True
        ]
        assert len(events) == 1
        content = events[0].get("content", "")
        assert "code" in content
        assert "doc+xref" in content

    def test_broadcasts_agent_mode_changed(
        self,
        service: LLMService,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """Successful switch fires an agentModeChanged event.

        Frontend listens for this to update the tab's
        tooltip and the LED-row state without polling. The
        payload's ``agent_id`` field is the registry key so
        the frontend can route to the right tab.
        """
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block("notifier"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_t",
        )
        event_cb.events.clear()

        service.switch_agent_mode("notifier", "doc")

        broadcasts = [
            args for name, args in event_cb.events
            if name == "agentModeChanged"
        ]
        assert len(broadcasts) == 1
        payload = broadcasts[0][0]
        assert payload == {
            "agent_id": "notifier",
            "mode": "doc",
            "cross_reference_enabled": False,
        }

    def test_no_op_does_not_broadcast(
        self,
        service: LLMService,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """Re-applying same mode → no broadcast.

        Mirrors the ``main.switch_mode`` no-broadcast
        contract for already-current state. Without this,
        rapid identical clicks would flood the event
        channel.
        """
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block("idle"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_t",
        )
        event_cb.events.clear()

        service.switch_agent_mode("idle", "code")  # already
        broadcasts = [
            args for name, args in event_cb.events
            if name == "agentModeChanged"
        ]
        assert broadcasts == []


class TestSwitchAgentModeLocalhostOnly:
    """switch_agent_mode restricts non-localhost callers."""

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
        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block("guarded"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_t",
        )

        class _FakeCollab:
            def is_caller_localhost(self) -> bool:
                return False

        service._collab = _FakeCollab()
        result = service.switch_agent_mode("guarded", "doc")
        assert result.get("error") == "restricted"
        # Mode unchanged.
        from ac_dc.context_manager import Mode
        assert scope.context.mode == Mode.CODE


class TestSetAgentCrossReference:
    """set_agent_cross_reference RPC.

    Per-agent cross-ref toggle (Increment 4a). Tests cover
    happy path for both directions, no-op when already in
    the target state, mid-stream rejection, unknown agent,
    archive event, and broadcast.

    Mode-axis stability is the key contract here:
    cross-ref toggles must NOT change the agent's primary
    mode. Pinned by tests that exercise both code and doc
    starting states.
    """

    def _make_agent_block(
        self,
        agent_id: str = "agent-0",
        task: str = "do something",
    ) -> Any:
        from ac_dc.edit_protocol import AgentBlock
        return AgentBlock(id=agent_id, task=task)

    def test_unknown_id_returns_error(
        self,
        service: LLMService,
    ) -> None:
        """Unknown agent id → agent-not-found error."""
        result = service.set_agent_cross_reference(
            "nonexistent", True,
        )
        assert result == {"error": "agent not found"}

    def test_empty_string_id_returns_error(
        self,
        service: LLMService,
    ) -> None:
        """Empty string id → agent-not-found (defensive)."""
        result = service.set_agent_cross_reference("", True)
        assert result == {"error": "agent not found"}

    def test_enables_xref_in_code_mode(
        self,
        service: LLMService,
    ) -> None:
        """code → code+xref via toggle."""
        from ac_dc.context_manager import Mode

        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block("worker"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_t",
        )
        result = service.set_agent_cross_reference(
            "worker", True,
        )
        assert result == {
            "status": "ok",
            "agent_id": "worker",
            "cross_reference_enabled": True,
        }
        # Primary mode unchanged.
        assert scope.context.mode == Mode.CODE
        assert scope.context.cross_reference_enabled is True

    def test_disables_xref_preserving_mode(
        self,
        service: LLMService,
    ) -> None:
        """doc+xref → doc keeps the primary doc mode.

        Critical contract — the cross-ref RPC must not
        accidentally collapse mode to its default. Without
        this guard a regression that read both axes from
        wire input would silently reset mode on every
        xref toggle.
        """
        from ac_dc.context_manager import Mode

        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block("worker"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_t",
        )
        scope.context.set_mode(Mode.DOC)
        scope.context.set_cross_reference_enabled(True)

        result = service.set_agent_cross_reference(
            "worker", False,
        )
        assert result["cross_reference_enabled"] is False
        # Primary mode preserved.
        assert scope.context.mode == Mode.DOC

    def test_no_op_when_already_in_target_state(
        self,
        service: LLMService,
    ) -> None:
        """Same xref state → ok with 'already' message."""
        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block("idle"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_t",
        )
        # Default xref is False.
        original_tracker = scope.tracker
        result = service.set_agent_cross_reference(
            "idle", False,
        )
        assert result["status"] == "ok"
        assert "already" in result.get("message", "").lower()
        assert scope.tracker is original_tracker

    def test_mid_stream_rejected(
        self,
        service: LLMService,
    ) -> None:
        """Active stream → stream-active error."""
        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block("busy"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_t",
        )
        service._active_agent_streams.add("busy")
        try:
            result = service.set_agent_cross_reference(
                "busy", True,
            )
            assert result.get("error") == "agent stream active"
            # State unchanged.
            assert scope.context.cross_reference_enabled is False
        finally:
            service._active_agent_streams.discard("busy")

    def test_non_bool_input_coerced(
        self,
        service: LLMService,
    ) -> None:
        """Truthy/falsy values coerce via bool() — defensive.

        The wire input arrives as JSON, where True/False are
        the only legal bool values. A truthy int leaking
        through (frontend bug) shouldn't crash; bool()
        handles it.
        """
        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block("worker"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_t",
        )
        result = service.set_agent_cross_reference(
            "worker", 1,
        )
        assert result["cross_reference_enabled"] is True
        assert scope.context.cross_reference_enabled is True

    def test_rebuilds_tracker(
        self,
        service: LLMService,
    ) -> None:
        """Successful toggle replaces the tracker."""
        from ac_dc.stability_tracker import StabilityTracker

        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block("worker"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_t",
        )
        original_tracker = scope.tracker

        service.set_agent_cross_reference("worker", True)
        assert scope.tracker is not original_tracker
        assert isinstance(scope.tracker, StabilityTracker)
        assert scope.context.stability_tracker is scope.tracker

    def test_writes_archive_system_event(
        self,
        service: LLMService,
        history_store: Any,
    ) -> None:
        """Archive carries a cross-ref-toggle system event."""
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block("recorder"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_xref_event",
        )

        service.set_agent_cross_reference("recorder", True)

        archive = history_store.get_turn_archive(
            "turn_xref_event",
        )
        events = [
            m for m in archive[0]["messages"]
            if m.get("system_event") is True
        ]
        assert len(events) == 1
        content = events[0].get("content", "")
        # Event names both the old (code) and new (code+xref)
        # modes — the format mirrors switch_agent_mode's
        # event so reconstruction can use one parser.
        assert "code" in content
        assert "code+xref" in content

    def test_broadcasts_agent_mode_changed(
        self,
        service: LLMService,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """Toggle fires the same agentModeChanged event.

        Frontend listens for one event regardless of which
        axis changed — keeps the listener simple and the
        wire chatter narrow.
        """
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block("notifier"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_t",
        )
        event_cb.events.clear()

        service.set_agent_cross_reference("notifier", True)

        broadcasts = [
            args for name, args in event_cb.events
            if name == "agentModeChanged"
        ]
        assert len(broadcasts) == 1
        payload = broadcasts[0][0]
        assert payload["agent_id"] == "notifier"
        assert payload["mode"] == "code+xref"
        assert payload["cross_reference_enabled"] is True

    def test_no_op_does_not_broadcast(
        self,
        service: LLMService,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """Re-applying same state → no broadcast."""
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block("idle"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_t",
        )
        event_cb.events.clear()

        service.set_agent_cross_reference("idle", False)
        broadcasts = [
            args for name, args in event_cb.events
            if name == "agentModeChanged"
        ]
        assert broadcasts == []


class TestSetAgentCrossReferenceLocalhostOnly:
    """set_agent_cross_reference restricts non-localhost."""

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
        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block("guarded"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_t",
        )

        class _FakeCollab:
            def is_caller_localhost(self) -> bool:
                return False

        service._collab = _FakeCollab()
        result = service.set_agent_cross_reference(
            "guarded", True,
        )
        assert result.get("error") == "restricted"
        # State unchanged.
        assert scope.context.cross_reference_enabled is False


class TestParseAgentTag:
    """:meth:`LLMService._parse_agent_tag` input validation.

    The agent_tag is the agent's LLM-chosen id (a non-empty
    string) when routing, or None for the main conversation.
    Pure static method so no fixture setup needed. Tests pin
    the type/shape rejection rules.
    """

    def test_non_empty_string_accepted(self) -> None:
        """A non-empty string passes through unchanged."""
        assert LLMService._parse_agent_tag(
            "frontend-chat"
        ) == "frontend-chat"

    def test_simple_id_accepted(self) -> None:
        """Conventional agent-N-style ids are accepted."""
        assert LLMService._parse_agent_tag(
            "agent-0"
        ) == "agent-0"

    def test_id_with_special_chars_accepted(self) -> None:
        """The parser doesn't restrict id shape beyond non-emptiness.

        Backend lookups just do dict.get(id), so any
        non-empty string is structurally valid. The
        orchestrator's agentic appendix encourages
        descriptive ids; the parser stays permissive.
        """
        assert LLMService._parse_agent_tag(
            "frontend/chat"
        ) == "frontend/chat"
        assert LLMService._parse_agent_tag(
            "spaces ok too"
        ) == "spaces ok too"

    def test_empty_string_rejected(self) -> None:
        """Empty string → None.

        An empty id can't be a useful registry key. Rejecting
        here keeps the lookup path straightforward.
        """
        assert LLMService._parse_agent_tag("") is None

    def test_none_returns_none(self) -> None:
        """None passthroughs as None — but callers should
        check before invoking; the streaming path uses None
        as the "main conversation" sentinel."""
        assert LLMService._parse_agent_tag(None) is None

    def test_tuple_rejected(self) -> None:
        """Old (turn_id, agent_idx) tuple form → None.

        The old format predated id-based identity. Rejecting
        it surfaces stale frontend code rather than silently
        looking like a malformed-id error.
        """
        assert LLMService._parse_agent_tag(
            ("turn_abc", 0)
        ) is None

    def test_list_rejected(self) -> None:
        """Old [turn_id, agent_idx] list form → None."""
        assert LLMService._parse_agent_tag(
            ["turn_abc", 0]
        ) is None

    def test_int_rejected(self) -> None:
        """Numeric input → None."""
        assert LLMService._parse_agent_tag(42) is None

    def test_dict_rejected(self) -> None:
        """Dict input → None."""
        assert LLMService._parse_agent_tag(
            {"id": "frontend"}
        ) is None

    def test_bool_rejected(self) -> None:
        """Bool input → None.

        Bool is a subclass of int but neither int nor
        string — the isinstance check rules it out.
        """
        assert LLMService._parse_agent_tag(True) is None
        assert LLMService._parse_agent_tag(False) is None


class TestAgentTaggedStreaming:
    """``agent_tag`` routes ``chat_streaming`` to agent scopes.

    Covers the routing, single-stream guard scoping, and
    cleanup. End-to-end streaming into an agent's own
    ContextManager is covered separately by
    :class:`TestAgentExecutionEndToEnd` via direct
    ``_spawn_agents_for_turn`` calls — those cover the
    archive-write path. Here we focus on the
    ``chat_streaming`` surface: malformed / unknown agent
    tags, guard slot selection, parallel streams.

    Identity is the agent's LLM-chosen id; ``agent_tag`` is
    that id directly (no tuple, no list).
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
        agent_id: str = "worker",
        turn_id: str = "turn_abc",
        agent_idx: int = 0,
    ) -> Any:
        """Register an agent scope directly.

        Bypasses ``_spawn_agents_for_turn`` so the test
        exercises only the ``chat_streaming`` surface
        without spinning up a full streaming pipeline for
        the setup. Returns the per-agent ConversationScope.
        """
        parent_scope = service._default_scope()
        return service._build_agent_scope(
            block=self._make_agent_block(agent_id),
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
        agent_scope = self._seed_agent(service, "worker")
        fake_litellm.set_streaming_chunks(["agent reply"])

        result = await service.chat_streaming(
            request_id="r-agent-1",
            message="do the thing",
            agent_tag="worker",
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

    async def test_unknown_agent_tag_returns_error(
        self,
        service: LLMService,
    ) -> None:
        """Stale tab id (agent not in registry) → error response."""
        # No agent registered.
        result = await service.chat_streaming(
            request_id="r1",
            message="hi",
            agent_tag="phantom",
        )
        assert result == {"error": "agent not found"}
        # Neither guard slot touched.
        assert service._active_user_request is None
        assert service._active_agent_streams == set()

    async def test_malformed_agent_tag_returns_error(
        self,
        service: LLMService,
    ) -> None:
        """Bad shape → malformed-tag error, distinct from stale.

        Frontend bug vs stale tab are surfaced differently
        so the user-facing error can be actionable.
        Stale-tab triggers a "your tab is closed, dismiss
        it" toast; malformed-payload triggers a "file a
        bug" toast.

        Both old shapes (tuple, list) are now malformed;
        empty string is malformed; non-string is malformed.
        """
        # Empty string.
        result = await service.chat_streaming(
            request_id="r1",
            message="hi",
            agent_tag="",
        )
        assert "malformed" in result.get("error", "").lower()
        # Old tuple shape.
        result = await service.chat_streaming(
            request_id="r2",
            message="hi",
            agent_tag=("turn_abc", 0),
        )
        assert "malformed" in result.get("error", "").lower()
        # Old list shape.
        result = await service.chat_streaming(
            request_id="r3",
            message="hi",
            agent_tag=["turn_abc", 0],
        )
        assert "malformed" in result.get("error", "").lower()

    async def test_tagged_call_does_not_touch_user_guard(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Agent-tagged call leaves main-tab guard available.

        User types in the main tab while an agent stream
        runs; the main call must not be rejected as
        "another stream active". The two guards are
        disjoint.
        """
        self._seed_agent(service, "worker")
        fake_litellm.set_streaming_chunks(["ok"])

        # Start agent stream.
        r1 = await service.chat_streaming(
            request_id="r-agent",
            message="agent task",
            agent_tag="worker",
        )
        assert r1 == {"status": "started"}
        # Main-tab guard untouched at this point.
        assert service._active_user_request is None
        # Agent slot registered under the agent id.
        assert "worker" in service._active_agent_streams

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

        Symmetric with the reverse test. User typing in
        the main tab while an agent is idle doesn't
        register any agent slot.
        """
        self._seed_agent(service, "worker")
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
        self._seed_agent(service, "worker")
        fake_litellm.set_streaming_chunks(["ok"])
        # Pre-register the agent slot to simulate an
        # in-flight stream. Using the service's own guard
        # state rather than racing two real streams keeps
        # the test deterministic.
        service._active_agent_streams.add("worker")

        result = await service.chat_streaming(
            request_id="r2",
            message="again",
            agent_tag="worker",
        )
        assert "active" in result.get("error", "").lower()

        # Cleanup.
        service._active_agent_streams.discard("worker")

    async def test_different_agents_stream_in_parallel(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Two agents can stream concurrently.

        Per-agent single-stream guard is per-id, not
        global. Distinct ids can stream simultaneously.
        """
        self._seed_agent(service, "alpha", agent_idx=0)
        self._seed_agent(service, "beta", agent_idx=1)

        # Queue two per-call responses so both streams
        # have content to consume.
        fake_litellm.queue_streaming_chunks(["a0 reply"])
        fake_litellm.queue_streaming_chunks(["a1 reply"])

        r1 = await service.chat_streaming(
            request_id="r-a0",
            message="t0",
            agent_tag="alpha",
        )
        r2 = await service.chat_streaming(
            request_id="r-a1",
            message="t1",
            agent_tag="beta",
        )
        assert r1 == {"status": "started"}
        assert r2 == {"status": "started"}

        # Both slots registered under their ids.
        assert "alpha" in service._active_agent_streams
        assert "beta" in service._active_agent_streams

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
        would otherwise accumulate slot entries
        permanently, eventually blocking every future call
        for that agent.
        """
        self._seed_agent(service, "errored")

        # Force the executor call to raise.
        def _raise(*args: Any, **kwargs: Any) -> None:
            raise RuntimeError("simulated failure")
        monkeypatch.setattr(
            service, "_run_completion_sync", _raise
        )

        await service.chat_streaming(
            request_id="r1",
            message="hi",
            agent_tag="errored",
        )
        await asyncio.sleep(0.3)

        # Slot cleared even though the stream errored.
        assert service._active_agent_streams == set()

    async def test_closed_agent_returns_error_on_next_call(
        self,
        service: LLMService,
    ) -> None:
        """After close_agent_context, the tag becomes stale."""
        self._seed_agent(service, "closeable")
        # Close via the close-agent RPC.
        closed = service.close_agent_context("closeable")
        assert closed["closed"] is True

        # Subsequent tagged call returns agent-not-found.
        result = await service.chat_streaming(
            request_id="r1",
            message="hi",
            agent_tag="closeable",
        )
        assert result == {"error": "agent not found"}


class TestSessionLoadReconstruction:
    """Increment 5 Commit 1 — session-load agent reconstruction.

    Pins the spec contract from `specs4/3-llm/history.md §
    Session-Load Reconstruction`: loading a previous session
    rebuilds every agent that participated as a live,
    writable scope. Reconstructed agents are reachable via
    `_agent_contexts`, accept new messages, and surface in
    `list_live_agents()`.

    Commit 1 covers the spawn-time-baseline mode resolution.
    Commit 2 will add archive-replay for mid-session mode
    toggles; tests for that behaviour land alongside that
    commit. A `# Commit 2` marker comment flags the
    intermediate known-wrong state — an agent toggled mid-
    session reconstructs as its spawn-time mode after Commit
    1, and as its post-toggle mode after Commit 2.
    """

    def _persist_agent_turn(
        self,
        history_store: HistoryStore,
        session_id: str,
        turn_id: str,
        agent_blocks: list[dict[str, Any]],
        archive_per_agent: dict[int, list[dict[str, Any]]],
    ) -> None:
        """Persist one agent-spawning turn to disk.

        Writes the user message, the assistant message
        carrying ``agent_blocks``, and each agent's archive
        records. Mirrors what `_stream_chat` does at runtime
        but without the LLM call. Tests use this to seed a
        history-store the same way a real session would
        leave it.
        """
        history_store.append_message(
            session_id=session_id,
            role="user",
            content="please decompose",
            turn_id=turn_id,
        )
        history_store.append_message(
            session_id=session_id,
            role="assistant",
            content="delegating",
            turn_id=turn_id,
            agent_blocks=agent_blocks,
        )
        for agent_idx, msgs in archive_per_agent.items():
            for msg in msgs:
                history_store.append_agent_message(
                    turn_id=turn_id,
                    agent_idx=agent_idx,
                    role=msg.get("role", "user"),
                    content=msg.get("content", ""),
                    session_id=session_id,
                    system_event=bool(
                        msg.get("system_event", False)
                    ),
                )

    def test_empty_session_reconstructs_no_agents(
        self,
        service: LLMService,
        history_store: HistoryStore,
    ) -> None:
        """Loading a session with no agentic turns: registry empty."""
        sid = HistoryStore.new_session_id()
        # Persist a non-agent turn so the session isn't empty
        # (load_session_into_context refuses empty sessions).
        history_store.append_message(
            session_id=sid,
            role="user",
            content="hi",
            turn_id=HistoryStore.new_turn_id(),
        )
        history_store.append_message(
            session_id=sid,
            role="assistant",
            content="hello",
        )
        result = service.load_session_into_context(sid)
        assert "error" not in result
        assert service._agent_contexts == {}

    def test_single_agent_session_restores_context_manager(
        self,
        service: LLMService,
        history_store: HistoryStore,
    ) -> None:
        """One agent in one turn: scope registered, history loaded."""
        sid = HistoryStore.new_session_id()
        tid = HistoryStore.new_turn_id()
        self._persist_agent_turn(
            history_store,
            session_id=sid,
            turn_id=tid,
            agent_blocks=[
                {
                    "id": "frontend",
                    "agent_idx": 0,
                    "mode": "code",
                    "cross_reference_enabled": False,
                    "model": "anthropic/claude-sonnet-4-5",
                },
            ],
            archive_per_agent={
                0: [
                    {"role": "user", "content": "do the work"},
                    {
                        "role": "assistant",
                        "content": "work done",
                    },
                ],
            },
        )

        service.load_session_into_context(sid)

        # Agent registered.
        assert "frontend" in service._agent_contexts
        scope = service._agent_contexts["frontend"]
        # Mode reflects the persisted spawn-time baseline.
        from ac_dc.context_manager import Mode
        assert scope.context.mode == Mode.CODE
        assert scope.context.cross_reference_enabled is False
        # History populated from archive.
        history = scope.context.get_history()
        contents = [m.get("content") for m in history]
        assert "do the work" in contents
        assert "work done" in contents

    def test_multi_agent_single_turn_session_restores_all(
        self,
        service: LLMService,
        history_store: HistoryStore,
    ) -> None:
        """Multiple agents in one turn: each gets its own scope."""
        sid = HistoryStore.new_session_id()
        tid = HistoryStore.new_turn_id()
        self._persist_agent_turn(
            history_store,
            session_id=sid,
            turn_id=tid,
            agent_blocks=[
                {
                    "id": "agent-a",
                    "agent_idx": 0,
                    "mode": "code",
                },
                {
                    "id": "agent-b",
                    "agent_idx": 1,
                    "mode": "doc",
                },
                {
                    "id": "agent-c",
                    "agent_idx": 2,
                    "mode": "code+xref",
                },
            ],
            archive_per_agent={
                0: [{"role": "user", "content": "task a"}],
                1: [{"role": "user", "content": "task b"}],
                2: [{"role": "user", "content": "task c"}],
            },
        )

        service.load_session_into_context(sid)

        from ac_dc.context_manager import Mode
        assert "agent-a" in service._agent_contexts
        assert "agent-b" in service._agent_contexts
        assert "agent-c" in service._agent_contexts
        a = service._agent_contexts["agent-a"]
        b = service._agent_contexts["agent-b"]
        c = service._agent_contexts["agent-c"]
        # Modes round-trip through reconstruction.
        assert a.context.mode == Mode.CODE
        assert a.context.cross_reference_enabled is False
        assert b.context.mode == Mode.DOC
        assert b.context.cross_reference_enabled is False
        assert c.context.mode == Mode.CODE
        assert c.context.cross_reference_enabled is True

    def test_retask_within_session_uses_latest_spawn_record(
        self,
        service: LLMService,
        history_store: HistoryStore,
    ) -> None:
        """Same id across two turns: latest spawn record wins.

        Per spec § Session-Load Reconstruction step 3:
        "When an id appears in multiple turns ... the
        latest record wins — its agent_blocks entry is
        the spawn-time baseline. Earlier turns contribute
        archive content but not mode state."

        Setup: agent ``worker`` spawned in turn 1 as code
        mode, retasked in turn 2 as doc mode. After
        reconstruction (Commit 1 spawn-time baseline) the
        agent's mode is doc — the latest spawn record's
        value. Both turns' archive content is concatenated.
        """
        sid = HistoryStore.new_session_id()
        tid_1 = HistoryStore.new_turn_id()
        tid_2 = HistoryStore.new_turn_id()
        # Turn 1 — worker spawned in code mode.
        self._persist_agent_turn(
            history_store,
            session_id=sid,
            turn_id=tid_1,
            agent_blocks=[
                {
                    "id": "worker",
                    "agent_idx": 0,
                    "mode": "code",
                },
            ],
            archive_per_agent={
                0: [
                    {"role": "user", "content": "first task"},
                    {
                        "role": "assistant",
                        "content": "first done",
                    },
                ],
            },
        )
        # Turn 2 — same worker, retasked in doc mode.
        self._persist_agent_turn(
            history_store,
            session_id=sid,
            turn_id=tid_2,
            agent_blocks=[
                {
                    "id": "worker",
                    "agent_idx": 0,
                    "mode": "doc",
                },
            ],
            archive_per_agent={
                0: [
                    {
                        "role": "user",
                        "content": "second task",
                    },
                    {
                        "role": "assistant",
                        "content": "second done",
                    },
                ],
            },
        )

        service.load_session_into_context(sid)

        from ac_dc.context_manager import Mode
        scope = service._agent_contexts["worker"]
        # Latest record's mode wins per spec.
        assert scope.context.mode == Mode.DOC
        # History from BOTH turns concatenated.
        contents = [
            m.get("content")
            for m in scope.context.get_history()
        ]
        assert "first task" in contents
        assert "first done" in contents
        assert "second task" in contents
        assert "second done" in contents

    def test_missing_archive_directory_skipped(
        self,
        service: LLMService,
        history_store: HistoryStore,
        repo_dir: Path,
    ) -> None:
        """Deleted archive: agent reconstructs with empty history.

        Per spec: "Turns whose archive directory has been
        deleted are skipped without error. The agent's
        reconstruction proceeds with whatever archive
        content remains."
        """
        sid = HistoryStore.new_session_id()
        tid = HistoryStore.new_turn_id()
        self._persist_agent_turn(
            history_store,
            session_id=sid,
            turn_id=tid,
            agent_blocks=[
                {"id": "ghost", "agent_idx": 0, "mode": "code"},
            ],
            archive_per_agent={
                0: [{"role": "user", "content": "task"}],
            },
        )
        # Delete the archive directory after persistence.
        archive_dir = (
            repo_dir / ".ac-dc4" / "agents" / tid
        )
        assert archive_dir.exists()
        for f in archive_dir.iterdir():
            f.unlink()
        archive_dir.rmdir()

        service.load_session_into_context(sid)

        # Agent still reconstructed (record in main store
        # has agent_blocks); just empty history.
        assert "ghost" in service._agent_contexts
        scope = service._agent_contexts["ghost"]
        assert scope.context.get_history() == []

    def test_records_without_agent_blocks_skipped(
        self,
        service: LLMService,
        history_store: HistoryStore,
    ) -> None:
        """Pre-Increment-A records (no agent_blocks) silently skipped."""
        sid = HistoryStore.new_session_id()
        # User + assistant without turn_id or agent_blocks
        # — simulates a record from before agent persistence.
        history_store.append_message(
            session_id=sid,
            role="user",
            content="hi",
        )
        history_store.append_message(
            session_id=sid,
            role="assistant",
            content="hello",
        )

        service.load_session_into_context(sid)

        assert service._agent_contexts == {}

    def test_reconstructed_scope_reachable_via_rpc(
        self,
        service: LLMService,
        history_store: HistoryStore,
    ) -> None:
        """Reconstructed agent answers to set_agent_selected_files."""
        sid = HistoryStore.new_session_id()
        tid = HistoryStore.new_turn_id()
        self._persist_agent_turn(
            history_store,
            session_id=sid,
            turn_id=tid,
            agent_blocks=[
                {
                    "id": "live-agent",
                    "agent_idx": 0,
                    "mode": "code",
                },
            ],
            archive_per_agent={
                0: [{"role": "user", "content": "task"}],
            },
        )

        service.load_session_into_context(sid)

        # Agent reachable through the agent-keyed RPC
        # surface — proves it's a live writable scope, not
        # a read-only stub.
        result = service.set_agent_selected_files(
            "live-agent", [],
        )
        assert result == []