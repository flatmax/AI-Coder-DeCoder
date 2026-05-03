"""Tests for ac_dc.agent_runner — Slice 6a of parallel-agents foundation.

Scope: the :func:`run_agent` function — invalid-block
short-circuit, ContextManager wiring, completion-function
invocation, response parsing, nested-agent-block discard,
exception isolation, archive persistence.

Strategy:

- Real :class:`HistoryStore` and :class:`ContextManager` —
  same discipline as Slice 5 tests. The runner's job is
  composition, so stubbing its collaborators would hide the
  behaviour we care about.
- ``completion_fn`` stubs — the runner's pluggable LLM-call
  parameter is the natural seam for test isolation. Each test
  constructs a stub that either returns a canned
  ``(content, usage)`` pair or raises.
- No LLM, no network, no streaming.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from ac_dc.agent_runner import AgentResult, run_agent
from ac_dc.edit_protocol import AgentBlock, parse_text
from ac_dc.history_store import HistoryStore


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def ac_dc_dir(tmp_path: Path) -> Path:
    """Fresh .ac-dc4/ directory per test."""
    d = tmp_path / ".ac-dc4"
    d.mkdir()
    return d


@pytest.fixture
def history_store(ac_dc_dir: Path) -> HistoryStore:
    return HistoryStore(ac_dc_dir)


# Convenience constructor for test agent blocks. Always
# produces a valid block unless a field is explicitly blanked.
def _valid_block(
    agent_id: str = "agent-0",
    task: str = "do the thing",
) -> AgentBlock:
    return AgentBlock(id=agent_id, task=task, valid=True)


def _make_stub(
    content: str = "",
    usage: dict[str, Any] | None = None,
) -> Any:
    """Build a completion_fn stub with canned return values.

    Returns a callable plus a ``calls`` list attribute that
    records every invocation's kwargs for assertion.
    """
    usage = usage if usage is not None else {}
    calls: list[dict[str, Any]] = []

    def _fn(*, model: str, messages: list[dict[str, Any]]) -> tuple[
        str, dict[str, Any]
    ]:
        calls.append({"model": model, "messages": messages})
        return content, usage

    _fn.calls = calls  # type: ignore[attr-defined]
    return _fn


# ---------------------------------------------------------------------------
# Invalid-block handling
# ---------------------------------------------------------------------------


class TestInvalidBlock:
    """Invalid agent blocks short-circuit before the LLM call."""

    def test_missing_id_skips_llm_call(
        self, history_store: HistoryStore
    ) -> None:
        """A block with no id is rejected without invoking completion_fn."""
        block = AgentBlock(id="", task="do it", valid=False)
        fn = _make_stub(content="never called")

        result = run_agent(
            block,
            agent_idx=0,
            turn_id="turn_abc",
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            completion_fn=fn,
        )

        assert fn.calls == []
        assert result.error is not None
        assert "id" in result.error

    def test_missing_task_skips_llm_call(
        self, history_store: HistoryStore
    ) -> None:
        """A block with no task is rejected."""
        block = AgentBlock(id="agent-0", task="", valid=False)
        fn = _make_stub()

        result = run_agent(
            block,
            agent_idx=0,
            turn_id="turn_abc",
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            completion_fn=fn,
        )

        assert fn.calls == []
        assert result.error is not None
        assert "task" in result.error

    def test_invalid_block_produces_no_archive_entry(
        self,
        history_store: HistoryStore,
    ) -> None:
        """Invalid blocks don't touch the archive filesystem.

        Without a valid id, the archive file name would be
        nondeterministic; more importantly, there's nothing
        meaningful to record — no task was dispatched, no
        response was produced.
        """
        block = AgentBlock(id="", task="", valid=False)
        fn = _make_stub()

        run_agent(
            block,
            agent_idx=0,
            turn_id="turn_abc",
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            completion_fn=fn,
        )

        archive = history_store.get_turn_archive("turn_abc")
        assert archive == []

    def test_invalid_block_preserves_agent_identity_in_result(
        self, history_store: HistoryStore
    ) -> None:
        """The result carries whatever id/task fields the block had.

        Orchestrator code correlates results with blocks by
        ``agent_idx``, but the id and task help diagnose what
        was malformed.
        """
        block = AgentBlock(id="agent-0", task="", valid=False)
        fn = _make_stub()

        result = run_agent(
            block,
            agent_idx=0,
            turn_id="turn_abc",
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            completion_fn=fn,
        )

        assert result.agent_idx == 0
        assert result.agent_id == "agent-0"
        assert result.task == ""


# ---------------------------------------------------------------------------
# Happy path — LLM invocation and result shape
# ---------------------------------------------------------------------------


class TestHappyPath:
    """Valid blocks run the LLM and produce populated results."""

    def test_completion_fn_invoked_with_model(
        self, history_store: HistoryStore
    ) -> None:
        """The runner passes the model name through."""
        fn = _make_stub(content="done")

        run_agent(
            _valid_block(),
            agent_idx=0,
            turn_id="turn_abc",
            model_name="openai/gpt-4",
            history_store=history_store,
            completion_fn=fn,
        )

        assert len(fn.calls) == 1
        assert fn.calls[0]["model"] == "openai/gpt-4"

    def test_completion_fn_invoked_with_user_message(
        self, history_store: HistoryStore
    ) -> None:
        """The task string becomes the user message content."""
        fn = _make_stub()

        run_agent(
            _valid_block(task="refactor the auth module"),
            agent_idx=0,
            turn_id="turn_abc",
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            completion_fn=fn,
        )

        messages = fn.calls[0]["messages"]
        user_msgs = [m for m in messages if m["role"] == "user"]
        assert len(user_msgs) == 1
        assert user_msgs[0]["content"] == "refactor the auth module"

    def test_system_prompt_prepended_when_supplied(
        self, history_store: HistoryStore
    ) -> None:
        """A non-empty system prompt goes at the front of messages."""
        fn = _make_stub()

        run_agent(
            _valid_block(),
            agent_idx=0,
            turn_id="turn_abc",
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            completion_fn=fn,
            system_prompt="You are agent-0, a refactoring specialist.",
        )

        messages = fn.calls[0]["messages"]
        assert messages[0]["role"] == "system"
        assert "refactoring specialist" in messages[0]["content"]
        # User message follows.
        assert messages[1]["role"] == "user"

    def test_system_prompt_omitted_when_empty(
        self, history_store: HistoryStore
    ) -> None:
        """Empty system prompt produces no system message.

        Some agent configurations might rely on the model's
        own defaults — the runner shouldn't inject an empty
        system message that could throw off provider
        heuristics.
        """
        fn = _make_stub()

        run_agent(
            _valid_block(),
            agent_idx=0,
            turn_id="turn_abc",
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            completion_fn=fn,
        )

        messages = fn.calls[0]["messages"]
        assert all(m["role"] != "system" for m in messages)

    def test_response_captured_in_result(
        self, history_store: HistoryStore
    ) -> None:
        """The completion_fn's return value populates result.response."""
        fn = _make_stub(content="the agent's final answer")

        result = run_agent(
            _valid_block(),
            agent_idx=0,
            turn_id="turn_abc",
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            completion_fn=fn,
        )

        assert result.response == "the agent's final answer"
        assert result.error is None

    def test_usage_captured_in_result(
        self, history_store: HistoryStore
    ) -> None:
        """Usage dict round-trips verbatim."""
        usage = {
            "prompt_tokens": 100,
            "completion_tokens": 50,
            "cache_read_tokens": 80,
        }
        fn = _make_stub(content="done", usage=usage)

        result = run_agent(
            _valid_block(),
            agent_idx=0,
            turn_id="turn_abc",
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            completion_fn=fn,
        )

        assert result.usage == usage

    def test_result_carries_agent_identity(
        self, history_store: HistoryStore
    ) -> None:
        """agent_idx, agent_id, task all land on the result."""
        fn = _make_stub(content="ok")

        result = run_agent(
            _valid_block(agent_id="agent-3", task="task 3"),
            agent_idx=3,
            turn_id="turn_abc",
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            completion_fn=fn,
        )

        assert result.agent_idx == 3
        assert result.agent_id == "agent-3"
        assert result.task == "task 3"


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------


class TestResponseParsing:
    """The response is parsed for edit blocks and shell commands."""

    def test_plain_text_produces_empty_parse_result(
        self, history_store: HistoryStore
    ) -> None:
        """A pure-prose response has no edit blocks or commands."""
        fn = _make_stub(content="Just some thoughts, no edits.")

        result = run_agent(
            _valid_block(),
            agent_idx=0,
            turn_id="turn_abc",
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            completion_fn=fn,
        )

        assert result.parse_result.blocks == []
        assert result.parse_result.shell_commands == []

    def test_edit_blocks_captured_in_parse_result(
        self, history_store: HistoryStore
    ) -> None:
        """Edit blocks in the agent's response surface for later application.

        Slice 6c's wiring applies them. Here we just check
        they reach the result intact.
        """
        response = (
            "Here's the change:\n\n"
            "src/foo.py\n"
            "🟧🟧🟧 EDIT\n"
            "old\n"
            "🟨🟨🟨 REPL\n"
            "new\n"
            "🟩🟩🟩 END\n"
        )
        fn = _make_stub(content=response)

        result = run_agent(
            _valid_block(),
            agent_idx=0,
            turn_id="turn_abc",
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            completion_fn=fn,
        )

        assert len(result.parse_result.blocks) == 1
        block = result.parse_result.blocks[0]
        assert block.file_path == "src/foo.py"
        assert block.old_text == "old"
        assert block.new_text == "new"

    def test_shell_commands_captured(
        self, history_store: HistoryStore
    ) -> None:
        """Shell command hints reach the result."""
        response = (
            "Run this:\n\n"
            "```bash\n"
            "pytest tests/\n"
            "```\n"
        )
        fn = _make_stub(content=response)

        result = run_agent(
            _valid_block(),
            agent_idx=0,
            turn_id="turn_abc",
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            completion_fn=fn,
        )

        assert "pytest tests/" in result.parse_result.shell_commands


class TestNestedAgentBlocks:
    """Agents don't spawn agents — nested blocks are discarded."""

    def test_nested_agent_blocks_stripped_from_result(
        self, history_store: HistoryStore
    ) -> None:
        """An agent emitting an AGENT block has the block discarded.

        Per specs4 § Agents: agents are leaves. A protocol
        violation by the agent LLM is not treated as a hard
        error — the runner logs it and drops the nested
        blocks from the result so downstream code sees a
        clean ``agent_blocks=[]``.
        """
        response = (
            "I need help:\n\n"
            "🟧🟧🟧 AGENT\n"
            "id: sub-agent-0\n"
            "task: help me do the thing\n"
            "🟩🟩🟩 AGEND\n"
        )
        fn = _make_stub(content=response)

        # Sanity check — the parser IS producing the nested
        # block, so the runner's discard is doing real work.
        parsed_sanity = parse_text(response)
        assert len(parsed_sanity.agent_blocks) == 1

        result = run_agent(
            _valid_block(),
            agent_idx=0,
            turn_id="turn_abc",
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            completion_fn=fn,
        )

        # Nested agent blocks stripped.
        assert result.parse_result.agent_blocks == []
        assert result.parse_result.incomplete_agents == []

    def test_nested_agent_blocks_logged_as_warning(
        self,
        history_store: HistoryStore,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """The discard produces a WARNING so operators can see it.

        Silent drops would hide agent-LLM protocol drift. The
        log entry includes the agent index and id so the
        offending agent is identifiable.
        """
        response = (
            "🟧🟧🟧 AGENT\n"
            "id: sub\n"
            "task: recurse\n"
            "🟩🟩🟩 AGEND\n"
        )
        fn = _make_stub(content=response)

        with caplog.at_level("WARNING", logger="ac_dc.agent_runner"):
            run_agent(
                _valid_block(agent_id="agent-7"),
                agent_idx=7,
                turn_id="turn_abc",
                model_name="anthropic/claude-sonnet-4-5",
                history_store=history_store,
                completion_fn=fn,
            )

        warnings = [r for r in caplog.records if r.levelname == "WARNING"]
        assert warnings
        joined = " ".join(r.getMessage() for r in warnings)
        assert "agent-7" in joined
        assert "7" in joined

    def test_other_parse_fields_preserved_when_discarding(
        self, history_store: HistoryStore
    ) -> None:
        """Edit blocks and shell commands survive the discard.

        The reconstruction-rather-than-mutation path in the
        runner must preserve the non-agent fields verbatim.
        """
        response = (
            "```bash\n"
            "ls\n"
            "```\n\n"
            "src/x.py\n"
            "🟧🟧🟧 EDIT\n"
            "a\n"
            "🟨🟨🟨 REPL\n"
            "b\n"
            "🟩🟩🟩 END\n\n"
            "🟧🟧🟧 AGENT\n"
            "id: nested\n"
            "task: nested task\n"
            "🟩🟩🟩 AGEND\n"
        )
        fn = _make_stub(content=response)

        result = run_agent(
            _valid_block(),
            agent_idx=0,
            turn_id="turn_abc",
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            completion_fn=fn,
        )

        # Agent block stripped.
        assert result.parse_result.agent_blocks == []
        # Other fields intact.
        assert len(result.parse_result.blocks) == 1
        assert "ls" in result.parse_result.shell_commands


# ---------------------------------------------------------------------------
# Archive persistence
# ---------------------------------------------------------------------------


class TestArchivePersistence:
    """The agent's turn is fully recorded in the archive."""

    def test_user_message_persisted_before_llm_call(
        self, history_store: HistoryStore
    ) -> None:
        """The task lands in the archive even if the LLM fails later.

        Matches the main-session pattern: user messages
        persist before the LLM call, so a mid-call crash
        preserves user intent.
        """
        def _raising(**kwargs: Any) -> tuple[str, dict[str, Any]]:
            raise RuntimeError("simulated LLM failure")

        run_agent(
            _valid_block(task="do the thing"),
            agent_idx=0,
            turn_id="turn_abc",
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            completion_fn=_raising,
        )

        archive = history_store.get_turn_archive("turn_abc")
        assert len(archive) == 1
        user_msgs = [
            m for m in archive[0]["messages"]
            if m["role"] == "user"
        ]
        assert len(user_msgs) == 1
        assert user_msgs[0]["content"] == "do the thing"

    def test_assistant_response_persisted_on_success(
        self, history_store: HistoryStore
    ) -> None:
        """The assistant message joins the archive after the call."""
        fn = _make_stub(content="assistant reply")

        run_agent(
            _valid_block(),
            agent_idx=0,
            turn_id="turn_abc",
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            completion_fn=fn,
        )

        archive = history_store.get_turn_archive("turn_abc")
        messages = archive[0]["messages"]
        assert len(messages) == 2
        assert messages[0]["role"] == "user"
        assert messages[1]["role"] == "assistant"
        assert messages[1]["content"] == "assistant reply"

    def test_empty_response_still_persists(
        self, history_store: HistoryStore
    ) -> None:
        """An agent returning empty string still produces an assistant record.

        The synthesis step sees empty as a valid signal
        (e.g., "this agent decided there was nothing to do").
        Missing the record entirely would make the archive
        inconsistent.
        """
        fn = _make_stub(content="")

        run_agent(
            _valid_block(),
            agent_idx=0,
            turn_id="turn_abc",
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            completion_fn=fn,
        )

        archive = history_store.get_turn_archive("turn_abc")
        messages = archive[0]["messages"]
        assistant = [m for m in messages if m["role"] == "assistant"]
        assert len(assistant) == 1
        assert assistant[0]["content"] == ""

    def test_archive_keyed_by_turn_and_agent_idx(
        self, history_store: HistoryStore
    ) -> None:
        """Multiple agents under one turn get separate archive entries."""
        fn = _make_stub(content="ok")

        run_agent(
            _valid_block(agent_id="a0"),
            agent_idx=0,
            turn_id="turn_abc",
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            completion_fn=fn,
        )
        run_agent(
            _valid_block(agent_id="a1"),
            agent_idx=1,
            turn_id="turn_abc",
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            completion_fn=fn,
        )

        archive = history_store.get_turn_archive("turn_abc")
        indices = sorted(e["agent_idx"] for e in archive)
        assert indices == [0, 1]

    def test_assistant_response_not_persisted_on_llm_failure(
        self, history_store: HistoryStore
    ) -> None:
        """LLM failure means no assistant record in the archive.

        A half-persisted turn (user message + error-placeholder
        assistant message) would confuse synthesis, which
        would see an "agent reply" that never really existed.
        Keeping the archive at user-message-only matches the
        mid-stream-crash pattern used in the main session.
        """
        def _raising(**kwargs: Any) -> tuple[str, dict[str, Any]]:
            raise RuntimeError("boom")

        run_agent(
            _valid_block(),
            agent_idx=0,
            turn_id="turn_abc",
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            completion_fn=_raising,
        )

        archive = history_store.get_turn_archive("turn_abc")
        messages = archive[0]["messages"]
        assert all(m["role"] == "user" for m in messages)


# ---------------------------------------------------------------------------
# Exception isolation
# ---------------------------------------------------------------------------


class TestExceptionIsolation:
    """Exceptions from completion_fn never propagate."""

    def test_exception_captured_as_error_field(
        self, history_store: HistoryStore
    ) -> None:
        """RuntimeError from the LLM call → result.error populated."""
        def _raising(**kwargs: Any) -> tuple[str, dict[str, Any]]:
            raise RuntimeError("simulated rate limit")

        result = run_agent(
            _valid_block(),
            agent_idx=0,
            turn_id="turn_abc",
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            completion_fn=_raising,
        )

        assert result.error is not None
        assert "rate limit" in result.error

    def test_exception_does_not_propagate(
        self, history_store: HistoryStore
    ) -> None:
        """The caller sees a result, not an exception.

        Pinned so a future refactor that forgets the
        try/except makes this test fail loudly.
        """
        def _raising(**kwargs: Any) -> tuple[str, dict[str, Any]]:
            raise ValueError("arbitrary")

        # If propagation happened, this would raise.
        result = run_agent(
            _valid_block(),
            agent_idx=0,
            turn_id="turn_abc",
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            completion_fn=_raising,
        )
        assert isinstance(result, AgentResult)

    def test_exception_logged_with_agent_identity(
        self,
        history_store: HistoryStore,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """The log line names the agent so operators can correlate.

        Useful when a batch of agents runs and only one fails.
        """
        def _raising(**kwargs: Any) -> tuple[str, dict[str, Any]]:
            raise RuntimeError("boom")

        with caplog.at_level("ERROR", logger="ac_dc.agent_runner"):
            run_agent(
                _valid_block(agent_id="agent-42"),
                agent_idx=42,
                turn_id="turn_abc",
                model_name="anthropic/claude-sonnet-4-5",
                history_store=history_store,
                completion_fn=_raising,
            )

        errors = [r for r in caplog.records if r.levelname == "ERROR"]
        assert errors
        joined = " ".join(r.getMessage() for r in errors)
        assert "42" in joined

    def test_error_result_preserves_task_and_identity(
        self, history_store: HistoryStore
    ) -> None:
        """Error results still carry agent_idx, agent_id, task."""
        def _raising(**kwargs: Any) -> tuple[str, dict[str, Any]]:
            raise RuntimeError("x")

        result = run_agent(
            _valid_block(agent_id="agent-5", task="task 5"),
            agent_idx=5,
            turn_id="turn_abc",
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            completion_fn=_raising,
        )

        assert result.agent_idx == 5
        assert result.agent_id == "agent-5"
        assert result.task == "task 5"
        assert result.response == ""  # empty on error
        assert result.usage == {}  # empty on error