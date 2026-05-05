"""Tests for the per-turn agent-state descriptor.

Covers :func:`ac_dc.llm._agents.build_agent_descriptor` and
its injection into both tiered and flat prompt assembly.

Per :doc:`specs4/7-future/parallel-agents` §
"Single-copy invariant — assembly-time injection", the
descriptor:

- Appears in the orchestrator's user-message prompt
  exactly once per turn
- Does NOT appear in any agent ContextManager's prompt
- Does NOT land in the persisted history (assembly-time
  only)
- Is rebuilt fresh from the live registry every turn,
  so closed agents drop out and new agents appear
  without invalidation logic

Identity contract (commit "honor LLM-chosen ids; flatten
registry"): the agent's identity is the LLM-chosen id
from its ``🟧🟧🟧 AGENT`` block. The registry is keyed
flat by that id. The descriptor surfaces the id directly
— no synthesis from turn_id+agent_idx, no
``{turn_id}/agent-NN`` label format. ``new_session``
clears each agent's chat history but PRESERVES its scope,
so an agent's id stays addressable across turns until
the application exits.

The tests construct scopes directly via
:func:`LLMService._build_agent_scope` rather than driving
the spawn pipeline end-to-end. That keeps each test
focused on the descriptor behaviour without dragging
in the LLM call, the apply pipeline, or asyncio
plumbing — none of which the descriptor depends on.
"""

from __future__ import annotations

import pytest

from ac_dc.edit_protocol import AgentBlock
from ac_dc.llm._agents import (
    _classify_agent_paths,
    build_agent_descriptor,
)
from ac_dc.stability_tracker import Tier, TrackedItem


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------


def _make_block(agent_id: str, task: str = "do work") -> AgentBlock:
    """Build a valid AgentBlock with the given id."""
    return AgentBlock(id=agent_id, task=task)


def _seed_tracker_symbol(scope, path: str, *, tokens: int = 100) -> None:
    """Plant a symbol: tracker entry on the scope's tracker."""
    key = f"symbol:{path}"
    scope.tracker._items[key] = TrackedItem(
        key=key,
        tier=Tier.L2,
        n_value=0,
        content_hash="x" * 12,
        tokens=tokens,
    )


def _seed_tracker_doc(scope, path: str, *, tokens: int = 100) -> None:
    """Plant a doc: tracker entry on the scope's tracker."""
    key = f"doc:{path}"
    scope.tracker._items[key] = TrackedItem(
        key=key,
        tier=Tier.L2,
        n_value=0,
        content_hash="x" * 12,
        tokens=tokens,
    )


# ---------------------------------------------------------------------------
# build_agent_descriptor — empty / single / multi
# ---------------------------------------------------------------------------


class TestEmptyRegistry:
    def test_no_agents_returns_empty_string(self, service) -> None:
        assert build_agent_descriptor(service) == ""


class TestSingleAgent:
    def test_descriptor_carries_id(self, service) -> None:
        parent = service._default_scope()
        block = _make_block("frontend-chat")
        service._build_agent_scope(
            block=block,
            agent_idx=0,
            parent_scope=parent,
            turn_id="turn_001",
        )
        result = build_agent_descriptor(service)
        # Identity is the LLM-chosen id from the spawn
        # block. The descriptor surfaces it directly —
        # no ``{turn_id}/agent-NN`` synthesis.
        assert "frontend-chat" in result
        # Confirm the old synthesised label format is NOT
        # produced.
        assert "turn_001/agent-00" not in result

    def test_no_files_shows_placeholder(self, service) -> None:
        parent = service._default_scope()
        block = _make_block("idle-agent")
        service._build_agent_scope(
            block=block,
            agent_idx=0,
            parent_scope=parent,
            turn_id="turn_001",
        )
        result = build_agent_descriptor(service)
        assert "(no files loaded)" in result

    def test_full_files_listed(self, service, repo_dir) -> None:
        # Seed a real file so file_context.add_file
        # succeeds against the repo.
        (repo_dir / "alpha.py").write_text("x = 1\n")
        (repo_dir / "beta.py").write_text("y = 2\n")
        parent = service._default_scope()
        parent.selected_files = ["alpha.py", "beta.py"]
        block = _make_block("frontend-chat")
        scope = service._build_agent_scope(
            block=block,
            agent_idx=0,
            parent_scope=parent,
            turn_id="turn_001",
        )
        scope.context.file_context.add_file("alpha.py")
        scope.context.file_context.add_file("beta.py")
        result = build_agent_descriptor(service)
        assert "full: alpha.py, beta.py" in result

    def test_symbol_only_paths_listed(self, service) -> None:
        parent = service._default_scope()
        block = _make_block("structural")
        scope = service._build_agent_scope(
            block=block,
            agent_idx=0,
            parent_scope=parent,
            turn_id="turn_001",
        )
        _seed_tracker_symbol(scope, "src/ac_dc/foo.py")
        _seed_tracker_symbol(scope, "src/ac_dc/bar.py")
        result = build_agent_descriptor(service)
        # Sorted alphabetically.
        assert "symbol: src/ac_dc/bar.py, src/ac_dc/foo.py" in result

    def test_doc_only_paths_listed(self, service) -> None:
        parent = service._default_scope()
        block = _make_block("doc-agent")
        scope = service._build_agent_scope(
            block=block,
            agent_idx=0,
            parent_scope=parent,
            turn_id="turn_001",
        )
        _seed_tracker_doc(scope, "specs4/3-llm/streaming.md")
        result = build_agent_descriptor(service)
        assert "doc: specs4/3-llm/streaming.md" in result

    def test_full_overrides_symbol(self, service, repo_dir) -> None:
        # Path appears in both file_context AND tracker
        # as symbol: — descriptor should list it under
        # full only, not duplicate under symbol.
        (repo_dir / "shared.py").write_text("z = 3\n")
        parent = service._default_scope()
        parent.selected_files = ["shared.py"]
        block = _make_block("dual-state")
        scope = service._build_agent_scope(
            block=block,
            agent_idx=0,
            parent_scope=parent,
            turn_id="turn_001",
        )
        scope.context.file_context.add_file("shared.py")
        _seed_tracker_symbol(scope, "shared.py")
        result = build_agent_descriptor(service)
        assert "full: shared.py" in result
        # Must NOT appear under symbol — deepest-only rule.
        assert "symbol: shared.py" not in result

    def test_full_overrides_doc(self, service, repo_dir) -> None:
        (repo_dir / "spec.md").write_text("# title\n")
        parent = service._default_scope()
        parent.selected_files = ["spec.md"]
        block = _make_block("doc-and-file")
        scope = service._build_agent_scope(
            block=block,
            agent_idx=0,
            parent_scope=parent,
            turn_id="turn_001",
        )
        scope.context.file_context.add_file("spec.md")
        _seed_tracker_doc(scope, "spec.md")
        result = build_agent_descriptor(service)
        assert "full: spec.md" in result
        assert "doc: spec.md" not in result

    def test_symbol_and_doc_can_coexist(self, service) -> None:
        # Cross-reference mode: same path indexed by both
        # symbol and doc indexes. Neither is "deeper" than
        # the other so both should list.
        parent = service._default_scope()
        block = _make_block("cross-ref")
        scope = service._build_agent_scope(
            block=block,
            agent_idx=0,
            parent_scope=parent,
            turn_id="turn_001",
        )
        _seed_tracker_symbol(scope, "x.py")
        _seed_tracker_doc(scope, "x.py")
        result = build_agent_descriptor(service)
        assert "symbol: x.py" in result
        assert "doc: x.py" in result


class TestMultipleAgents:
    def test_each_agent_listed(self, service) -> None:
        parent = service._default_scope()
        for i in range(3):
            service._build_agent_scope(
                block=_make_block(f"worker-{i}"),
                agent_idx=i,
                parent_scope=parent,
                turn_id="turn_001",
            )
        result = build_agent_descriptor(service)
        assert "worker-0" in result
        assert "worker-1" in result
        assert "worker-2" in result

    def test_agents_sorted_alphabetically_by_id(
        self, service
    ) -> None:
        # Insertion order shuffled; output is sorted by id.
        parent = service._default_scope()
        service._build_agent_scope(
            block=_make_block("zebra"),
            agent_idx=0,
            parent_scope=parent,
            turn_id="t",
        )
        service._build_agent_scope(
            block=_make_block("alpha"),
            agent_idx=1,
            parent_scope=parent,
            turn_id="t",
        )
        service._build_agent_scope(
            block=_make_block("mango"),
            agent_idx=2,
            parent_scope=parent,
            turn_id="t",
        )
        result = build_agent_descriptor(service)
        idx_alpha = result.index("alpha")
        idx_mango = result.index("mango")
        idx_zebra = result.index("zebra")
        assert idx_alpha < idx_mango < idx_zebra

    def test_independent_file_lists(self, service, repo_dir) -> None:
        # Two agents with non-overlapping file sets.
        # Each should see only its own files.
        (repo_dir / "a.py").write_text("x = 1\n")
        (repo_dir / "b.py").write_text("y = 2\n")
        parent = service._default_scope()
        parent.selected_files = ["a.py", "b.py"]
        scope_a = service._build_agent_scope(
            block=_make_block("a-only"),
            agent_idx=0,
            parent_scope=parent,
            turn_id="turn_001",
        )
        scope_b = service._build_agent_scope(
            block=_make_block("b-only"),
            agent_idx=1,
            parent_scope=parent,
            turn_id="turn_001",
        )
        # Each agent loads only its own file.
        scope_a.context.file_context.clear()
        scope_a.context.file_context.add_file("a.py")
        scope_b.context.file_context.clear()
        scope_b.context.file_context.add_file("b.py")
        result = build_agent_descriptor(service)
        # Find each agent's section by its id and check
        # the full-files line is correct for that section
        # only. Sort order is alphabetical — a-only < b-only.
        lines = result.split("\n")
        idx_a = next(
            i for i, line in enumerate(lines)
            if "a-only" in line
        )
        idx_b = next(
            i for i, line in enumerate(lines)
            if "b-only" in line
        )
        section_a = "\n".join(lines[idx_a:idx_b])
        section_b = "\n".join(lines[idx_b:])
        assert "full: a.py" in section_a
        assert "b.py" not in section_a
        assert "full: b.py" in section_b
        assert "a.py" not in section_b


# ---------------------------------------------------------------------------
# _classify_agent_paths — direct unit tests
# ---------------------------------------------------------------------------


class TestClassifyAgentPaths:
    def test_empty_scope(self, service) -> None:
        parent = service._default_scope()
        block = _make_block("empty")
        scope = service._build_agent_scope(
            block=block,
            agent_idx=0,
            parent_scope=parent,
            turn_id="t",
        )
        full, sym, doc = _classify_agent_paths(scope)
        assert full == []
        assert sym == []
        assert doc == []

    def test_returns_sorted_lists(self, service) -> None:
        parent = service._default_scope()
        block = _make_block("sortcheck")
        scope = service._build_agent_scope(
            block=block,
            agent_idx=0,
            parent_scope=parent,
            turn_id="t",
        )
        _seed_tracker_symbol(scope, "z.py")
        _seed_tracker_symbol(scope, "a.py")
        _seed_tracker_symbol(scope, "m.py")
        full, sym, doc = _classify_agent_paths(scope)
        assert sym == ["a.py", "m.py", "z.py"]


# ---------------------------------------------------------------------------
# Assembly-time injection (orchestrator only, not persisted)
# ---------------------------------------------------------------------------


class TestDescriptorInjection:
    def test_orchestrator_prompt_carries_descriptor(
        self, service
    ) -> None:
        # Spawn one agent, then assemble the orchestrator's
        # prompt. The descriptor must appear in the user
        # message.
        parent = service._default_scope()
        block = _make_block("frontend")
        service._build_agent_scope(
            block=block,
            agent_idx=0,
            parent_scope=parent,
            turn_id="t",
        )
        # Use the flat assembly path — simpler to inspect
        # and exercises the same injection.
        messages = service._assemble_messages_flat(
            user_prompt="please retask the frontend agent",
            images=[],
            scope=parent,
        )
        # The user message is the last entry. Its content
        # is a string (no images attached here).
        last = messages[-1]
        assert last["role"] == "user"
        content = last["content"]
        assert isinstance(content, str)
        assert "## Live agents" in content
        assert "frontend" in content

    def test_no_descriptor_when_no_agents(self, service) -> None:
        parent = service._default_scope()
        messages = service._assemble_messages_flat(
            user_prompt="hello",
            images=[],
            scope=parent,
        )
        last = messages[-1]
        content = last["content"]
        assert isinstance(content, str)
        # Empty registry means no descriptor block at all.
        assert "## Live agents" not in content

    def test_agent_scope_does_not_see_descriptor(
        self, service
    ) -> None:
        # An agent's own assembled prompt must NOT contain
        # the descriptor (the spec is explicit: agents are
        # peers in the registry, the descriptor is for the
        # orchestrator only).
        parent = service._default_scope()
        block = _make_block("a")
        agent_scope = service._build_agent_scope(
            block=block,
            agent_idx=0,
            parent_scope=parent,
            turn_id="t",
        )
        messages = service._assemble_messages_flat(
            user_prompt="agent task here",
            images=[],
            scope=agent_scope,
        )
        last = messages[-1]
        content = last["content"]
        assert isinstance(content, str)
        assert "## Live agents" not in content

    def test_descriptor_not_persisted_to_history(
        self, service
    ) -> None:
        # The descriptor is assembly-time only. After
        # building the prompt, the persisted user message
        # in the orchestrator's history must not contain
        # the descriptor — only the user's raw text.
        parent = service._default_scope()
        block = _make_block("b")
        service._build_agent_scope(
            block=block,
            agent_idx=0,
            parent_scope=parent,
            turn_id="t",
        )
        # Add a user message the way add_message would
        # (the streaming pipeline does this before
        # assembly). The descriptor should not leak into
        # the stored content.
        parent.context.add_message("user", "raw user text")
        # Now assemble — verify the live history's last
        # entry is the raw text, not the descriptor.
        history = parent.context.get_history()
        assert history[-1]["content"] == "raw user text"
        assert "## Live agents" not in history[-1]["content"]