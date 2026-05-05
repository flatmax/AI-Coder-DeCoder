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


class TestSetAgentExcludedIndexFiles:
    """D23 — set_agent_excluded_index_files RPC.

    Per-agent analogue of :meth:`LLMService.set_excluded_index_files`.
    The frontend routes picker shift-click exclusion toggles
    here when an agent tab is active; the main-tab path still
    hits set_excluded_index_files.

    Tests cover happy path, missing-agent error, per-agent
    tracker entry removal (so stale rows don't linger in the
    cache viewer), and the restricted-error path. The
    ``excluded_index_files`` field on ConversationScope starts
    empty; successful calls replace it.
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
        result = service.set_agent_excluded_index_files(
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
        result = service.set_agent_excluded_index_files(
            "turn_known", 99, [],
        )
        assert result == {"error": "agent not found"}

    def test_replaces_excluded_files(
        self,
        service: LLMService,
    ) -> None:
        """Exclusion replacement — new list becomes canonical."""
        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_t",
        )
        # Scope starts with empty exclusion list.
        assert scope.excluded_index_files == []
        result = service.set_agent_excluded_index_files(
            "turn_t", 0, ["a.py", "b.py"],
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
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_clear",
        )
        service.set_agent_excluded_index_files(
            "turn_clear", 0, ["a.py"],
        )
        assert scope.excluded_index_files == ["a.py"]
        result = service.set_agent_excluded_index_files(
            "turn_clear", 0, [],
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
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_copy",
        )
        result = service.set_agent_excluded_index_files(
            "turn_copy", 0, ["a.py"],
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
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_typed",
        )
        result = service.set_agent_excluded_index_files(
            "turn_typed", 0, ["a.py", 42, None, ["nested"]],
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
            block=self._make_agent_block(),
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
            "turn_purge", 0, ["drop.py"],
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

        Per-tab state invariant — agent-0's exclusion
        changes must not leak into agent-1's scope.
        """
        parent_scope = service._default_scope()
        scope_a = service._build_agent_scope(
            block=self._make_agent_block("a0"),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_both",
        )
        scope_b = service._build_agent_scope(
            block=self._make_agent_block("a1"),
            agent_idx=1,
            parent_scope=parent_scope,
            turn_id="turn_both",
        )
        service.set_agent_excluded_index_files(
            "turn_both", 0, ["a-only.py"],
        )
        assert scope_a.excluded_index_files == ["a-only.py"]
        assert scope_b.excluded_index_files == []


class TestSetAgentExcludedIndexFilesLocalhostOnly:
    """D23 — set_agent_excluded_index_files restricts non-localhost."""

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
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_restricted",
        )

        class _FakeCollab:
            def is_caller_localhost(self) -> bool:
                return False

        service._collab = _FakeCollab()
        result = service.set_agent_excluded_index_files(
            "turn_restricted", 0, ["a.py"],
        )
        assert result.get("error") == "restricted"
        # Scope NOT mutated.
        assert scope.excluded_index_files == []


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