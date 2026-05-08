"""Agent spawning — dispatch gating, scope construction, execution, assimilation.

Covers the full fan-out pipeline:

- :class:`TestAgentDispatchScaffold` — the filter method
  (``_filter_dispatchable_agents``) plus end-to-end dispatch
  routing through ``_stream_chat``. Toggle gating, warning
  logs for all-invalid input, and the child-request
  recursion guard.
- :class:`TestAgentSpawn` — ``_spawn_agents_for_turn`` and its
  helper ``_build_agent_scope``. Scope construction (fresh
  ContextManager + tracker, deep-copied selection, inherited
  session_id), child request IDs, archive directory
  creation, sibling-exception isolation, parent-state
  preservation.
- :class:`TestAgentExecutionEndToEnd` — agents running through
  the real ``_stream_chat`` pipeline. Per-agent archives,
  edit block routing, sibling-exception isolation at the
  execution layer, ``filesChanged`` suppression for child
  streams.
- :class:`TestAgentAssimilation` — post-spawn assimilation:
  union of ``files_modified`` + ``files_created`` into the
  parent's scope, file context refresh, broadcasts, no
  spurious broadcasts when agents are read-only.

Governing spec: :doc:`specs4/7-future/parallel-agents`.
"""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any

import pytest

from ac_dc.config import ConfigManager
from ac_dc.history_store import HistoryStore
from ac_dc.llm_service import LLMService
from ac_dc.repo import Repo

from .conftest import _FakeLiteLLM, _RecordingEventCallback


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
            agent_key: str | None = None,
        ) -> None:
            recordings.append({
                "request_id": request_id,
                "message": message,
                "scope": scope,
                "agent_key": agent_key,
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

    async def test_agents_spawned_payload_carries_mode(
        self,
        service: LLMService,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
        event_cb: Any,
    ) -> None:
        """``agentsSpawned`` event carries each agent's resolved mode.

        Per ``specs4/5-webapp/agent-browser.md`` § Status LEDs
        → Click and hover, the LED-row tooltip needs each
        agent's mode (``code`` / ``doc`` / ``code+xref`` /
        ``doc+xref``) to render its hover string. The
        broadcast payload must include this field at spawn
        time so the frontend's tab-creation handler stores
        it before any LED renders.

        Mode resolution mirrors the spawn-time logic — empty
        ``block.mode`` inherits from the orchestrator's
        current scope. This test pins both an explicit mode
        and an inherited one in a single decomposition.
        """
        from ac_dc.context_manager import Mode

        self._enable_agents(config)
        self._install_recording_stub(service)
        # Force orchestrator into a known state so inherited
        # mode is deterministic.
        service._context.set_mode(Mode.CODE)
        service._context.set_cross_reference_enabled(False)

        # Two agents: one inherits, one explicit.
        response = (
            self._build_agent_block(
                "explicit-doc", "doc work"
            ).replace(
                "🟩🟩🟩 AGEND",
                "mode: doc+xref\n🟩🟩🟩 AGEND",
            )
            + "\n"
            + self._build_agent_block(
                "inherits", "code work"
            )
        )
        fake_litellm.set_streaming_chunks([response])
        event_cb.events.clear()

        await service.chat_streaming(
            request_id="r1", message="please decompose"
        )
        await asyncio.sleep(0.3)

        # Find the agentsSpawned broadcast.
        spawn_events = [
            args for name, args in event_cb.events
            if name == "agentsSpawned"
        ]
        assert len(spawn_events) == 1
        payload = spawn_events[0][0]
        assert payload["parent_request_id"] == "r1"
        blocks_by_id = {
            b["id"]: b for b in payload["agent_blocks"]
        }
        assert "explicit-doc" in blocks_by_id
        assert "inherits" in blocks_by_id
        # Explicit mode round-trips.
        assert blocks_by_id["explicit-doc"]["mode"] == "doc+xref"
        # Inherited mode reflects the orchestrator's CODE +
        # cross_ref=False at spawn time.
        assert blocks_by_id["inherits"]["mode"] == "code"


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
            agent_key: str | None = None,
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
                "agent_key": agent_key,
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
            agent_key: str | None = None,
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


class TestAgentScopeMode:
    """Per-agent mode and cross-reference resolution.

    Covers :func:`_resolve_agent_mode` and the mode-aware
    behaviour of :func:`build_agent_scope`:

    - Empty ``block.mode`` inherits the orchestrator's
      current mode (both axes).
    - Each of the four valid mode strings flattens back to
      ``(Mode, bool)`` correctly.
    - The resolved values reach the agent's ContextManager
      via the factory.
    - Re-spawning a known id with a different mode raises
      ``ValueError`` — the orchestrator must close + respawn,
      not silently retask.

    The descriptor consumes the per-agent mode for the
    orchestrator's prompt; that integration is covered in
    :mod:`test_agent_descriptor`. Here we just pin the
    spawn-time wiring.
    """

    def _make_block(
        self,
        agent_id: str = "agent-0",
        task: str = "do work",
        mode: str = "",
    ) -> "AgentBlock":  # type: ignore[name-defined]
        from ac_dc.edit_protocol import AgentBlock

        return AgentBlock(id=agent_id, task=task, mode=mode)

    def test_resolve_empty_inherits_parent(self) -> None:
        from ac_dc.context_manager import Mode
        from ac_dc.llm._agents import _resolve_agent_mode

        # Inherits both axes when block.mode is empty.
        assert _resolve_agent_mode("", Mode.CODE, False) == (
            Mode.CODE, False,
        )
        assert _resolve_agent_mode("", Mode.DOC, True) == (
            Mode.DOC, True,
        )
        assert _resolve_agent_mode("", Mode.CODE, True) == (
            Mode.CODE, True,
        )

    def test_resolve_each_explicit_mode(self) -> None:
        from ac_dc.context_manager import Mode
        from ac_dc.llm._agents import _resolve_agent_mode

        # The four valid strings flatten correctly. Parent
        # values are ignored when the block is explicit.
        assert _resolve_agent_mode(
            "code", Mode.DOC, True
        ) == (Mode.CODE, False)
        assert _resolve_agent_mode(
            "doc", Mode.CODE, True
        ) == (Mode.DOC, False)
        assert _resolve_agent_mode(
            "code+xref", Mode.DOC, False
        ) == (Mode.CODE, True)
        assert _resolve_agent_mode(
            "doc+xref", Mode.CODE, False
        ) == (Mode.DOC, True)

    def test_resolve_unknown_raises(self) -> None:
        """Defensive guard if validation pipeline is bypassed."""
        from ac_dc.context_manager import Mode
        from ac_dc.llm._agents import _resolve_agent_mode

        with pytest.raises(ValueError, match="Unrecognised"):
            _resolve_agent_mode("typescript", Mode.CODE, False)

    def test_block_mode_reaches_context_manager(
        self, service: LLMService
    ) -> None:
        """Resolved mode is set on the agent's ContextManager."""
        from ac_dc.context_manager import Mode

        parent = service._default_scope()
        block = self._make_block("agent-doc", mode="doc+xref")
        scope = service._build_agent_scope(
            block=block,
            agent_idx=0,
            parent_scope=parent,
            turn_id="t",
        )
        assert scope.context.mode == Mode.DOC
        assert scope.context.cross_reference_enabled is True

    def test_empty_block_mode_inherits_orchestrator(
        self, service: LLMService
    ) -> None:
        """Agent inherits orchestrator's current mode when omitted."""
        from ac_dc.context_manager import Mode

        # Flip the orchestrator into doc+xref so we can observe
        # inheritance rather than the default.
        service._context.set_mode(Mode.DOC)
        service._context.set_cross_reference_enabled(True)
        parent = service._default_scope()
        block = self._make_block("agent-inherit", mode="")
        scope = service._build_agent_scope(
            block=block,
            agent_idx=0,
            parent_scope=parent,
            turn_id="t",
        )
        assert scope.context.mode == Mode.DOC
        assert scope.context.cross_reference_enabled is True

    def test_each_axis_inherited_independently(
        self, service: LLMService
    ) -> None:
        """Inheriting cross_ref independently of mode."""
        from ac_dc.context_manager import Mode

        # Orchestrator: code mode but xref enabled.
        service._context.set_mode(Mode.CODE)
        service._context.set_cross_reference_enabled(True)
        parent = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_block("agent-x", mode=""),
            agent_idx=0,
            parent_scope=parent,
            turn_id="t",
        )
        assert scope.context.mode == Mode.CODE
        assert scope.context.cross_reference_enabled is True

    def test_build_agent_scope_does_not_check_mode(
        self, service: LLMService
    ) -> None:
        """``build_agent_scope`` is "always fresh" by contract.

        Mode-conflict rejection is a dispatch decision and
        lives in :func:`_resolve_or_spawn_agent_scope`,
        not :func:`build_agent_scope`. Direct calls to
        ``build_agent_scope`` with a known id and a
        different mode silently overwrite the registered
        scope — the tests below pin this so a future
        refactor that re-adds rejection here surfaces as
        a test failure.
        """
        parent = service._default_scope()
        first = self._make_block("frontend", mode="code")
        first_scope = service._build_agent_scope(
            block=first,
            agent_idx=0,
            parent_scope=parent,
            turn_id="t",
        )
        # Different mode → still constructs, no raise.
        conflicting = self._make_block("frontend", mode="doc")
        second_scope = service._build_agent_scope(
            block=conflicting,
            agent_idx=0,
            parent_scope=parent,
            turn_id="t",
        )
        # The registry now points at the second scope —
        # the first was overwritten. This is precisely
        # the behaviour the dispatch layer guards against
        # for the retask path.
        assert second_scope is not first_scope
        assert (
            service._agent_contexts["frontend"] is second_scope
        )


class TestAgentRetaskDispatch:
    """Lookup-or-spawn dispatch in :func:`spawn_agents_for_turn`.

    Per ``specs4/7-future/parallel-agents.md`` § "Agent
    Reuse by ID" — re-using a known agent id retasks the
    existing agent, preserving its ContextManager, file
    context, stability tracker, and provider-cache warmth.
    A different id spawns a fresh agent. A known id with a
    mismatched mode is skipped with a warning; the existing
    agent stays in its current mode.

    These tests exercise :func:`_resolve_or_spawn_agent_scope`
    directly and through :func:`spawn_agents_for_turn` to
    pin both the unit-level behaviour and the integration
    with the spawn loop.
    """

    def _make_block(
        self,
        agent_id: str = "agent-0",
        task: str = "do work",
        mode: str = "",
    ) -> Any:
        from ac_dc.edit_protocol import AgentBlock

        return AgentBlock(id=agent_id, task=task, mode=mode)

    async def _drain_stub_invocations(
        self, service: LLMService
    ) -> list[dict[str, Any]]:
        """Install a recorder for ``_agent_stream_impl``."""
        recordings: list[dict[str, Any]] = []

        async def _recorder(
            request_id: str,
            message: str,
            files: list[str],
            images: list[str],
            excluded_urls: list[str] | None = None,
            *,
            scope: Any = None,
            agent_key: str | None = None,
        ) -> None:
            recordings.append({
                "request_id": request_id,
                "message": message,
                "scope": scope,
                "agent_key": agent_key,
            })

        service._agent_stream_impl = _recorder
        return recordings

    # ---- _resolve_or_spawn_agent_scope unit tests ------------

    def test_resolver_miss_returns_fresh_scope(
        self, service: LLMService
    ) -> None:
        """Unknown id → fresh spawn via build_agent_scope."""
        from ac_dc.llm._agents import (
            _resolve_or_spawn_agent_scope,
        )

        parent = service._default_scope()
        block = self._make_block("new-agent", mode="code")
        scope = _resolve_or_spawn_agent_scope(
            service,
            block=block,
            agent_idx=0,
            parent_scope=parent,
            turn_id="t",
        )
        assert scope is not None
        # Newly registered.
        assert service._agent_contexts["new-agent"] is scope

    def test_resolver_hit_same_mode_returns_existing(
        self, service: LLMService
    ) -> None:
        """Known id + matching mode → reuse the existing scope.

        The returned scope IS the same object as the one
        constructed on the first call — preserving the
        ContextManager, tracker, file context, and identity.
        Provider cache warmth is preserved by virtue of the
        same StabilityTracker remaining attached.
        """
        from ac_dc.llm._agents import (
            _resolve_or_spawn_agent_scope,
        )

        parent = service._default_scope()
        first_scope = _resolve_or_spawn_agent_scope(
            service,
            block=self._make_block("frontend", mode="code"),
            agent_idx=0,
            parent_scope=parent,
            turn_id="t1",
        )
        # Plant some state on the existing scope so we can
        # verify it's the SAME object on retask, not a fresh
        # construction with matching shape.
        first_scope.context.add_message("user", "first turn task")
        first_scope.context.add_message("assistant", "first turn reply")

        second_scope = _resolve_or_spawn_agent_scope(
            service,
            block=self._make_block("frontend", mode="code"),
            agent_idx=0,
            parent_scope=parent,
            turn_id="t2",
        )
        # Object identity — the SAME scope, not a clone.
        assert second_scope is first_scope
        assert second_scope.context is first_scope.context
        assert second_scope.tracker is first_scope.tracker
        # Conversation preserved.
        history = second_scope.context.get_history()
        assert any(
            m.get("content") == "first turn task" for m in history
        )
        assert any(
            m.get("content") == "first turn reply" for m in history
        )

    def test_resolver_hit_mode_mismatch_returns_none(
        self, service: LLMService
    ) -> None:
        """Known id + different mode → None (skip)."""
        from ac_dc.llm._agents import (
            _resolve_or_spawn_agent_scope,
        )

        parent = service._default_scope()
        first_scope = _resolve_or_spawn_agent_scope(
            service,
            block=self._make_block("agent-0", mode="code"),
            agent_idx=0,
            parent_scope=parent,
            turn_id="t1",
        )
        result = _resolve_or_spawn_agent_scope(
            service,
            block=self._make_block("agent-0", mode="doc"),
            agent_idx=0,
            parent_scope=parent,
            turn_id="t2",
        )
        assert result is None
        # Existing scope untouched.
        assert (
            service._agent_contexts["agent-0"] is first_scope
        )

    def test_resolver_hit_xref_axis_mismatch_returns_none(
        self, service: LLMService
    ) -> None:
        """Cross-ref axis difference alone is a mismatch."""
        from ac_dc.llm._agents import (
            _resolve_or_spawn_agent_scope,
        )

        parent = service._default_scope()
        _resolve_or_spawn_agent_scope(
            service,
            block=self._make_block("agent-0", mode="code"),
            agent_idx=0,
            parent_scope=parent,
            turn_id="t1",
        )
        result = _resolve_or_spawn_agent_scope(
            service,
            block=self._make_block("agent-0", mode="code+xref"),
            agent_idx=0,
            parent_scope=parent,
            turn_id="t2",
        )
        assert result is None

    def test_resolver_inherited_mode_matches(
        self, service: LLMService
    ) -> None:
        """Empty block.mode → inherits orchestrator → matches.

        An orchestrator emitting a bare ``id: foo`` block to
        retask succeeds when its own mode hasn't drifted
        since the agent's last spawn. The implicit
        inheritance still has to match the agent's existing
        mode.
        """
        from ac_dc.context_manager import Mode
        from ac_dc.llm._agents import (
            _resolve_or_spawn_agent_scope,
        )

        # Orchestrator in code mode; agent spawned matching.
        service._context.set_mode(Mode.CODE)
        service._context.set_cross_reference_enabled(False)
        parent = service._default_scope()
        first = _resolve_or_spawn_agent_scope(
            service,
            block=self._make_block("foo", mode="code"),
            agent_idx=0,
            parent_scope=parent,
            turn_id="t1",
        )
        # Retask with bare id — empty mode inherits code.
        second = _resolve_or_spawn_agent_scope(
            service,
            block=self._make_block("foo", mode=""),
            agent_idx=0,
            parent_scope=parent,
            turn_id="t2",
        )
        assert second is first

    def test_resolver_inherited_mode_mismatch(
        self, service: LLMService
    ) -> None:
        """Orchestrator drift after spawn → inherited retask fails.

        Agent spawned in code mode; orchestrator later
        switches to doc mode; a bare retask block now
        inherits doc, which doesn't match. Skipped.
        """
        from ac_dc.context_manager import Mode
        from ac_dc.llm._agents import (
            _resolve_or_spawn_agent_scope,
        )

        service._context.set_mode(Mode.CODE)
        service._context.set_cross_reference_enabled(False)
        parent = service._default_scope()
        _resolve_or_spawn_agent_scope(
            service,
            block=self._make_block("foo", mode="code"),
            agent_idx=0,
            parent_scope=parent,
            turn_id="t1",
        )
        # Orchestrator drifts to doc mode.
        service._context.set_mode(Mode.DOC)
        new_parent = service._default_scope()
        result = _resolve_or_spawn_agent_scope(
            service,
            block=self._make_block("foo", mode=""),
            agent_idx=0,
            parent_scope=new_parent,
            turn_id="t2",
        )
        assert result is None

    def test_resolver_logs_warning_on_skip(
        self, service: LLMService, caplog
    ) -> None:
        """Mode mismatch logs a WARNING with both modes named."""
        import logging

        from ac_dc.llm._agents import (
            _resolve_or_spawn_agent_scope,
        )

        parent = service._default_scope()
        _resolve_or_spawn_agent_scope(
            service,
            block=self._make_block("foo", mode="code"),
            agent_idx=0,
            parent_scope=parent,
            turn_id="t1",
        )
        caplog.clear()
        with caplog.at_level(
            logging.WARNING, logger="ac_dc.llm_service"
        ):
            _resolve_or_spawn_agent_scope(
                service,
                block=self._make_block("foo", mode="doc"),
                agent_idx=0,
                parent_scope=parent,
                turn_id="t2",
            )
        warnings = [
            rec.getMessage() for rec in caplog.records
            if rec.levelno == logging.WARNING
        ]
        assert any("foo" in w for w in warnings)
        assert any(
            "code" in w and "doc" in w for w in warnings
        )

    def test_resolver_logs_info_on_retask(
        self, service: LLMService, caplog
    ) -> None:
        """Successful retask logs an INFO line for traceability."""
        import logging

        from ac_dc.llm._agents import (
            _resolve_or_spawn_agent_scope,
        )

        parent = service._default_scope()
        _resolve_or_spawn_agent_scope(
            service,
            block=self._make_block("foo", mode="code"),
            agent_idx=0,
            parent_scope=parent,
            turn_id="t1",
        )
        caplog.clear()
        with caplog.at_level(
            logging.INFO, logger="ac_dc.llm_service"
        ):
            _resolve_or_spawn_agent_scope(
                service,
                block=self._make_block("foo", mode="code"),
                agent_idx=0,
                parent_scope=parent,
                turn_id="t2",
            )
        info_logs = [
            rec.getMessage() for rec in caplog.records
            if rec.levelno == logging.INFO
            and "Retasking" in rec.getMessage()
        ]
        assert len(info_logs) == 1
        assert "foo" in info_logs[0]

    # ---- spawn_agents_for_turn integration tests -------------

    async def test_spawn_loop_skips_mode_conflict_block(
        self, service: LLMService
    ) -> None:
        """Mode-mismatch block is skipped; siblings still dispatch."""
        recordings = await self._drain_stub_invocations(service)
        parent = service._default_scope()
        # Pre-register an agent so the first block in the
        # next spawn collides on mode.
        from ac_dc.llm._agents import build_agent_scope

        build_agent_scope(
            service,
            block=self._make_block("collider", mode="code"),
            agent_idx=0,
            parent_scope=parent,
            turn_id="t1",
        )

        blocks = [
            self._make_block("collider", mode="doc"),  # skipped
            self._make_block("worker", mode="code"),  # dispatches
        ]
        await service._spawn_agents_for_turn(
            agent_blocks=blocks,
            parent_scope=parent,
            parent_request_id="r-main",
            turn_id="t2",
        )
        # Only the worker dispatches — collider was skipped.
        assert len(recordings) == 1
        assert recordings[0]["agent_key"] == "worker"

    async def test_spawn_loop_retask_reuses_scope(
        self, service: LLMService
    ) -> None:
        """Retask passes the existing scope to the stream impl."""
        recordings = await self._drain_stub_invocations(service)
        parent = service._default_scope()
        from ac_dc.llm._agents import build_agent_scope

        original = build_agent_scope(
            service,
            block=self._make_block("persistent", mode="code"),
            agent_idx=0,
            parent_scope=parent,
            turn_id="t1",
        )
        await service._spawn_agents_for_turn(
            agent_blocks=[
                self._make_block(
                    "persistent", mode="code", task="next task",
                ),
            ],
            parent_scope=parent,
            parent_request_id="r-main",
            turn_id="t2",
        )
        assert len(recordings) == 1
        # The scope passed to the stream impl IS the
        # original — not a fresh construction.
        assert recordings[0]["scope"] is original
        # Task threading is unchanged (the resolver doesn't
        # touch the message; _stream_chat appends it).
        assert recordings[0]["message"] == "next task"

    async def test_spawn_loop_fresh_id_spawns_fresh_scope(
        self, service: LLMService
    ) -> None:
        """Unknown id under spawn loop → new scope registered."""
        recordings = await self._drain_stub_invocations(service)
        parent = service._default_scope()
        await service._spawn_agents_for_turn(
            agent_blocks=[
                self._make_block("brand-new", mode="code"),
            ],
            parent_scope=parent,
            parent_request_id="r-main",
            turn_id="t1",
        )
        assert "brand-new" in service._agent_contexts
        assert len(recordings) == 1
        assert recordings[0]["scope"] is (
            service._agent_contexts["brand-new"]
        )

    async def test_retask_preserves_archive_idx(
        self, service: LLMService
    ) -> None:
        """Retasked agent writes to its ORIGINAL archive file.

        The archival sink closes over agent_idx at
        construction time. Retasking does NOT call
        build_agent_context_manager, so the closure
        retains the agent's first-spawn idx — the agent
        keeps writing to the same agent-NN.jsonl across
        turns.

        Pinned because the spawn loop's per-turn agent_idx
        (the positional index in agent_blocks) varies
        between turns. If a future change accidentally
        rebuilt the sink with the new agent_idx, the
        archive would split into two files.
        """
        # Spawn first turn at agent_idx=2 (third block,
        # though we only emit one — the index is what
        # matters).
        from ac_dc.llm._agents import build_agent_scope

        parent = service._default_scope()
        first_scope = build_agent_scope(
            service,
            block=self._make_block("sticky", mode="code"),
            agent_idx=2,
            parent_scope=parent,
            turn_id="t1",
        )
        # Write a message via first-turn sink.
        first_scope.context.add_message(
            "user", "turn-1 task"
        )
        # Retask in second turn at a different positional
        # idx.
        await self._drain_stub_invocations(service)
        await service._spawn_agents_for_turn(
            agent_blocks=[
                self._make_block(
                    "sticky", mode="code",
                    task="turn-2 task",
                ),
            ],
            parent_scope=parent,
            parent_request_id="r2",
            turn_id="t2",
        )
        # The archive file for turn t1 carries idx=2; the
        # context manager from the retask still writes
        # there because the sink closure baked in idx=2.
        archive_t1 = service._history_store.get_turn_archive("t1")
        assert len(archive_t1) == 1
        assert archive_t1[0]["agent_idx"] == 2


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
        app_path = config.config_dir / "app.json"
        app_data = json.loads(app_path.read_text())
        app_data.setdefault("agents", {})
        app_data["agents"]["enabled"] = True
        app_path.write_text(json.dumps(app_data))
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
        # A list-valued content (multimodal) needs flattening.
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