"""Agent runner — Slice 6a of parallel-agents foundation.

Runs one agent end-to-end: builds its :class:`ContextManager`
via :func:`build_agent_context_manager`, adds the task string
as the agent's initial user message, invokes a pluggable LLM
completion function, parses the response for edit blocks and
shell commands, and returns a structured :class:`AgentResult`.

Scope boundaries — what this slice deliberately does NOT do:

- **No parallelism.** One agent per call. Slice 6b adds the
  orchestrator that dispatches N calls across the executor.
- **No streaming chunk events.** The completion function is
  expected to return the full response; streaming event
  emission (``streamChunk`` with child request IDs) lives in
  Slice 6b.
- **No edit application.** Parsed blocks surface in the
  :class:`AgentResult.parse_result` field but are not applied
  to the working tree. Slice 6c wires the
  :class:`EditPipeline`.
- **No cancellation.** A running agent runs to completion.
  Cancellation lives with the Slice 6b orchestrator.
- **No tool use / iterative turns.** The agent makes exactly
  one LLM call from its initial task message. Multi-turn
  agent conversations are a future extension.

Governing spec: ``specs4/7-future/parallel-agents.md`` §
Agents.

## Design Decisions Pinned Here

- **Completion function as a parameter.** The runner accepts
  a ``completion_fn`` callable that takes ``(messages,
  model_name)`` and returns ``(content, usage)``. Tests pass
  stubs that return canned responses; production wires a
  function that delegates to :func:`litellm.completion` in
  streaming mode and accumulates chunks. Keeping litellm out
  of this module lets the runner be tested without mocking
  HTTP or the executor pool.

- **Invalid agent blocks short-circuit.** Blocks that came
  out of parsing with ``valid=False`` (missing ``id`` or
  ``task``) skip the LLM call entirely. They produce an
  :class:`AgentResult` with an error describing the
  malformation. No archive entry is written — without a
  valid ``id`` the archive file name would be
  nondeterministic, and without a task there's nothing the
  agent could do.

- **Nested agent-spawn blocks in agent output are
  discarded.** Per specs4 § Agents, agents are leaves —
  they emit edits and tool calls, not further agent blocks.
  If an agent's response contains parsed ``agent_blocks``,
  that's a protocol violation by the agent LLM. The runner
  logs a warning and drops them; the parser still produces
  them (we don't want to special-case parsing based on
  caller identity), but the runner's contract makes them
  invisible to downstream code.

- **Exceptions become error fields, never propagate.** Any
  exception from ``completion_fn`` is caught and recorded on
  the result's ``error`` field. The agent's user message was
  already persisted by the ContextManager's archival sink
  (it fires on the ``add_message`` before the LLM call); the
  assistant-side record is skipped so the archive stays
  clean — a half-persisted turn is worse than a missing one
  because the main LLM's synthesis step would see partial
  agent output and try to reason about it.

- **Assistant response always persists on successful calls.**
  Even an empty response string persists — the archival sink
  sees the full add_message lifecycle. An agent that decided
  its task was impossible and said nothing is valid state;
  synthesis can see the empty response and react.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Callable, Protocol

from ac_dc.agent_factory import build_agent_context_manager
from ac_dc.edit_protocol import AgentBlock, ParseResult, parse_text

if TYPE_CHECKING:
    from ac_dc.history_store import HistoryStore
    from ac_dc.repo import Repo

logger = logging.getLogger(__name__)


class _CompletionFn(Protocol):
    """Shape of the LLM-completion callable the runner expects.

    Production implementations wrap :func:`litellm.completion`
    (streaming or non-streaming) and accumulate the full
    response content alongside the provider's usage dict.
    Tests pass stubs that return canned responses.

    The function is synchronous and blocking — the runner
    does not ``await`` it. Callers that want to run multiple
    agents in parallel submit runner invocations to an
    executor pool (Slice 6b's orchestrator).
    """

    def __call__(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
    ) -> tuple[str, dict[str, Any]]:
        """Return (response_content, usage_dict).

        ``usage_dict`` shape matches what the normal streaming
        path produces — prompt/completion tokens, cache read/
        write, cost. Empty dict is acceptable when the
        function can't report usage (e.g., a test stub).
        """


@dataclass
class AgentResult:
    """Outcome of running one agent.

    Mirrors the fields the main LLM's synthesis step needs to
    review the agent's work: the task it was given, the
    response it produced, any edit blocks it emitted (for the
    Slice 6c wiring to apply), and an error field when things
    went wrong.
    """

    agent_idx: int
    agent_id: str
    task: str
    response: str = ""
    parse_result: ParseResult = field(default_factory=ParseResult)
    error: str | None = None
    usage: dict[str, Any] = field(default_factory=dict)


def run_agent(
    block: AgentBlock,
    agent_idx: int,
    *,
    turn_id: str,
    model_name: str,
    history_store: "HistoryStore",
    completion_fn: _CompletionFn,
    repo: "Repo | None" = None,
    system_prompt: str = "",
    cache_target_tokens: int | None = None,
    compaction_config: dict[str, Any] | None = None,
) -> AgentResult:
    """Run one agent end-to-end.

    Builds the agent's :class:`ContextManager` via
    :func:`build_agent_context_manager`, appends ``block.task``
    as the agent's first user message, invokes
    ``completion_fn`` to get the response, parses the response
    for edit blocks and shell commands, and returns the
    result.

    Parameters
    ----------
    block:
        Parsed agent-spawn block from
        :mod:`edit_protocol`. Blocks with ``valid=False`` skip
        the LLM call and produce an error result.
    agent_idx:
        Zero-based index within the parent turn's agent set.
        Used for the archive filename (``agent-NN.jsonl``)
        and surfaced in the result.
    turn_id:
        Parent turn identifier — agents under the same turn
        share this value. Drives the archive directory
        (``.ac-dc4/agents/{turn_id}/``).
    model_name:
        Provider-qualified model identifier.
    history_store:
        Agent archive writer.
    completion_fn:
        LLM completion callable. See :class:`_CompletionFn`.
    repo:
        Optional repository for file I/O during the agent's
        turn. Agents that need to read files use this via
        their ContextManager's file context.
    system_prompt:
        Task-focused system prompt. The spawning code composes
        this (typically a shared agent-mode prompt plus
        per-agent task scope). Defaults to empty — agents
        running without a system prompt see only their user
        message.
    cache_target_tokens:
        Optional cache-target value forwarded to the
        ContextManager.
    compaction_config:
        Optional compaction config forwarded to the
        ContextManager.

    Returns
    -------
    AgentResult
        Always returns a result — exceptions are captured in
        the ``error`` field rather than propagated. The main
        LLM's synthesis step handles error results alongside
        successful ones.
    """
    # Invalid blocks — missing id or task — skip the LLM
    # call. We don't build a ContextManager because the
    # archive file name is keyed by agent_idx (which we have)
    # but the block carries no task for the agent to act on;
    # running the LLM with no user message would produce
    # unpredictable output and waste tokens. Return an error
    # result that the orchestrator / synthesis step can see.
    if not block.valid:
        reason = _describe_invalid_block(block)
        logger.warning(
            "Skipping invalid agent block at idx=%d: %s",
            agent_idx, reason,
        )
        return AgentResult(
            agent_idx=agent_idx,
            agent_id=block.id,
            task=block.task,
            error=f"Invalid agent block: {reason}",
        )

    # Build the agent's ContextManager. The archival sink
    # inside it is already wired by the factory — every
    # subsequent add_message persists to
    # .ac-dc4/agents/{turn_id}/agent-NN.jsonl.
    context = build_agent_context_manager(
        turn_id=turn_id,
        agent_idx=agent_idx,
        model_name=model_name,
        history_store=history_store,
        repo=repo,
        cache_target_tokens=cache_target_tokens,
        compaction_config=compaction_config,
        system_prompt=system_prompt,
    )

    # Seed the conversation with the task. This fires the
    # archival sink — the user message lands in the archive
    # file before the LLM call. Intentional: matches the
    # main-session pattern where user messages persist before
    # the LLM runs, so a mid-call crash preserves user intent.
    context.add_message("user", block.task)

    # Build the message array. Agents start with no prior
    # history, so the shape is just system (optional) + user.
    # The ContextManager's prompt assembly is overkill for
    # Slice 6a's one-shot flow; we construct the message list
    # inline to keep the runner simple. Slice 6c+ can
    # graduate to using assemble_tiered_messages when agents
    # need tool loops or iterative turns.
    messages: list[dict[str, Any]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": block.task})

    # Invoke the LLM. Exceptions become error fields —
    # propagating would force the caller to wrap every agent
    # invocation in try/except, defeating the "always get a
    # result back" contract that makes the synthesis step
    # simple.
    try:
        response, usage = completion_fn(
            model=model_name,
            messages=messages,
        )
    except Exception as exc:
        logger.exception(
            "Agent %d (%s) completion failed: %s",
            agent_idx, block.id, exc,
        )
        return AgentResult(
            agent_idx=agent_idx,
            agent_id=block.id,
            task=block.task,
            error=f"LLM completion failed: {exc}",
        )

    # Persist the assistant response. The archival sink
    # writes it to the agent's JSONL. Even an empty response
    # persists — an agent that produced nothing is still a
    # valid turn that synthesis can react to.
    context.add_message("assistant", response)

    # Parse the response. Edit blocks surface for Slice 6c to
    # apply; shell commands for UI display; nested
    # agent-spawn blocks we discard with a warning (agents
    # are leaves per specs4).
    parsed = parse_text(response)
    if parsed.agent_blocks or parsed.incomplete_agents:
        logger.warning(
            "Agent %d (%s) emitted %d agent-spawn blocks — "
            "discarding; agents are leaves and cannot spawn "
            "further agents",
            agent_idx, block.id,
            len(parsed.agent_blocks) + len(parsed.incomplete_agents),
        )
        # Drop the agent-spawn fields from the result.
        # Reconstruct the ParseResult rather than mutating in
        # place — ParseResult fields are conceptually
        # immutable once parse_text returns, and mutating
        # would surprise a reader who inspected the parser's
        # output separately.
        parsed = ParseResult(
            blocks=parsed.blocks,
            incomplete=parsed.incomplete,
            shell_commands=parsed.shell_commands,
            agent_blocks=[],
            incomplete_agents=[],
        )

    return AgentResult(
        agent_idx=agent_idx,
        agent_id=block.id,
        task=block.task,
        response=response,
        parse_result=parsed,
        usage=usage,
    )


def _describe_invalid_block(block: AgentBlock) -> str:
    """Produce a human-readable reason for an invalid block.

    Used only in the invalid-block error message. Keeps the
    error text consistent across tests and production logs.
    """
    missing: list[str] = []
    if not block.id:
        missing.append("id")
    if not block.task:
        missing.append("task")
    if missing:
        return f"missing required field(s): {', '.join(missing)}"
    return "block flagged invalid by parser"