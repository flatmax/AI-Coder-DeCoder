"""Tests for ac_dc.agent_factory — Slice 5 of parallel-agents foundation.

Scope: the :func:`build_agent_context_manager` function —
input validation, ContextManager wiring (turn_id, archival_sink,
model_name, repo, config forwarding), archival-sink closure
behaviour (persistence to the archive, extras routing), and
integration with a real :class:`HistoryStore`.

Strategy:

- Real :class:`HistoryStore` backed by ``tmp_path`` — the
  factory's point is composing store + context manager
  correctly, so mocking the store would hide the integration
  behaviour we care about.
- Real :class:`ContextManager` — it's already tested
  exhaustively in test_context_manager.py; here we just verify
  the factory wires it right.
- No LLM, no streaming — this module is pure composition.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from ac_dc.agent_factory import build_agent_context_manager
from ac_dc.context_manager import ContextManager
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
    """Real history store rooted in the per-test directory."""
    return HistoryStore(ac_dc_dir)


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------


class TestValidation:
    """The factory catches programmer errors eagerly."""

    def test_rejects_empty_turn_id(
        self, history_store: HistoryStore
    ) -> None:
        """Empty turn_id raises ValueError at factory time.

        Pinned so the error surfaces at the spawn site instead
        of inside a later sink invocation where the stack trace
        would be less helpful.
        """
        with pytest.raises(ValueError, match="turn_id"):
            build_agent_context_manager(
                turn_id="",
                agent_idx=0,
                model_name="anthropic/claude-sonnet-4-5",
                history_store=history_store,
            )

    def test_rejects_negative_agent_idx(
        self, history_store: HistoryStore
    ) -> None:
        """Negative agent_idx raises ValueError at factory time."""
        with pytest.raises(ValueError, match="agent_idx"):
            build_agent_context_manager(
                turn_id="turn_abc",
                agent_idx=-1,
                model_name="anthropic/claude-sonnet-4-5",
                history_store=history_store,
            )

    def test_accepts_zero_agent_idx(
        self, history_store: HistoryStore
    ) -> None:
        """agent_idx=0 is valid — agents are zero-indexed."""
        # Shouldn't raise.
        cm = build_agent_context_manager(
            turn_id="turn_abc",
            agent_idx=0,
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
        )
        assert isinstance(cm, ContextManager)


# ---------------------------------------------------------------------------
# Construction — wiring verification
# ---------------------------------------------------------------------------


class TestConstruction:
    """Factory produces a ContextManager with the expected wiring."""

    def test_returns_context_manager(
        self, history_store: HistoryStore
    ) -> None:
        """Return value is a real ContextManager instance."""
        cm = build_agent_context_manager(
            turn_id="turn_abc",
            agent_idx=0,
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
        )
        assert isinstance(cm, ContextManager)

    def test_turn_id_propagated(
        self, history_store: HistoryStore
    ) -> None:
        """The ContextManager exposes the passed turn_id."""
        cm = build_agent_context_manager(
            turn_id="turn_1234567890_abc123",
            agent_idx=2,
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
        )
        assert cm.turn_id == "turn_1234567890_abc123"

    def test_archival_sink_attached(
        self, history_store: HistoryStore
    ) -> None:
        """Factory installs an archival sink — not None."""
        cm = build_agent_context_manager(
            turn_id="turn_abc",
            agent_idx=0,
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
        )
        assert cm.archival_sink is not None
        assert callable(cm.archival_sink)

    def test_model_name_forwarded(
        self, history_store: HistoryStore
    ) -> None:
        """Model name threads through to the ContextManager."""
        cm = build_agent_context_manager(
            turn_id="turn_abc",
            agent_idx=0,
            model_name="openai/gpt-4",
            history_store=history_store,
        )
        assert cm.model == "openai/gpt-4"

    def test_system_prompt_forwarded(
        self, history_store: HistoryStore
    ) -> None:
        """System prompt threads through to the ContextManager.

        Agents typically receive a task-specific prompt; the
        factory shouldn't alter it.
        """
        cm = build_agent_context_manager(
            turn_id="turn_abc",
            agent_idx=0,
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            system_prompt="You are agent-0.",
        )
        assert cm.get_system_prompt() == "You are agent-0."

    def test_system_prompt_defaults_empty(
        self, history_store: HistoryStore
    ) -> None:
        """Default system prompt is empty — caller supplies it."""
        cm = build_agent_context_manager(
            turn_id="turn_abc",
            agent_idx=0,
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
        )
        assert cm.get_system_prompt() == ""

    def test_cache_target_tokens_forwarded(
        self, history_store: HistoryStore
    ) -> None:
        """cache_target_tokens threads through."""
        cm = build_agent_context_manager(
            turn_id="turn_abc",
            agent_idx=0,
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            cache_target_tokens=2048,
        )
        assert cm.cache_target_tokens == 2048

    def test_compaction_config_forwarded(
        self, history_store: HistoryStore
    ) -> None:
        """compaction_config threads through."""
        cfg = {"enabled": True, "trigger_tokens": 5000}
        cm = build_agent_context_manager(
            turn_id="turn_abc",
            agent_idx=0,
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
            compaction_config=cfg,
        )
        assert cm.compaction_config == cfg

    def test_multiple_agents_independent(
        self, history_store: HistoryStore
    ) -> None:
        """Two agents built from the same factory are distinct.

        They share the turn_id but hold independent
        ContextManager state. Pinned so a future refactor that
        caches anything per-turn doesn't accidentally alias
        two agents' histories.
        """
        a0 = build_agent_context_manager(
            turn_id="turn_abc",
            agent_idx=0,
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
        )
        a1 = build_agent_context_manager(
            turn_id="turn_abc",
            agent_idx=1,
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
        )
        assert a0 is not a1
        # Shared identity.
        assert a0.turn_id == a1.turn_id
        # Independent state.
        a0.add_message("user", "agent 0 message")
        assert a0.get_history() != a1.get_history()


# ---------------------------------------------------------------------------
# Archival-sink integration
# ---------------------------------------------------------------------------


class TestArchivalIntegration:
    """The sink persists messages to the agent archive."""

    def test_add_message_persists_to_archive(
        self,
        history_store: HistoryStore,
        ac_dc_dir: Path,
    ) -> None:
        """A single add_message produces one record in the archive."""
        cm = build_agent_context_manager(
            turn_id="turn_xyz",
            agent_idx=0,
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
        )
        cm.add_message("user", "initial task")

        archive = history_store.get_turn_archive("turn_xyz")
        assert len(archive) == 1
        assert archive[0]["agent_idx"] == 0
        assert len(archive[0]["messages"]) == 1
        record = archive[0]["messages"][0]
        assert record["role"] == "user"
        assert record["content"] == "initial task"
        assert record["turn_id"] == "turn_xyz"
        assert record["agent_idx"] == 0

    def test_multiple_messages_append_in_order(
        self,
        history_store: HistoryStore,
    ) -> None:
        """Multiple appends produce records in write order."""
        cm = build_agent_context_manager(
            turn_id="turn_xyz",
            agent_idx=0,
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
        )
        cm.add_message("user", "first")
        cm.add_message("assistant", "second")
        cm.add_message("user", "third")

        messages = history_store.get_turn_archive("turn_xyz")[0][
            "messages"
        ]
        assert [m["content"] for m in messages] == [
            "first",
            "second",
            "third",
        ]

    def test_add_exchange_persists_both(
        self,
        history_store: HistoryStore,
    ) -> None:
        """add_exchange fires the sink twice — both records persist."""
        cm = build_agent_context_manager(
            turn_id="turn_xyz",
            agent_idx=0,
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
        )
        cm.add_exchange("question", "answer")

        messages = history_store.get_turn_archive("turn_xyz")[0][
            "messages"
        ]
        assert len(messages) == 2
        assert messages[0]["role"] == "user"
        assert messages[0]["content"] == "question"
        assert messages[1]["role"] == "assistant"
        assert messages[1]["content"] == "answer"

    def test_different_agents_write_to_different_files(
        self,
        history_store: HistoryStore,
        ac_dc_dir: Path,
    ) -> None:
        """Two agents under the same turn produce separate files.

        Pins the agent-idx isolation: agent-00.jsonl and
        agent-01.jsonl never cross-contaminate, even when
        writes interleave.
        """
        a0 = build_agent_context_manager(
            turn_id="turn_xyz",
            agent_idx=0,
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
        )
        a1 = build_agent_context_manager(
            turn_id="turn_xyz",
            agent_idx=1,
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
        )
        a0.add_message("user", "agent-0 message")
        a1.add_message("user", "agent-1 message")

        archive = history_store.get_turn_archive("turn_xyz")
        assert len(archive) == 2
        # Sort by agent_idx so we can rely on order.
        by_idx = {e["agent_idx"]: e for e in archive}
        assert by_idx[0]["messages"][0]["content"] == "agent-0 message"
        assert by_idx[1]["messages"][0]["content"] == "agent-1 message"

    def test_different_turns_write_to_different_directories(
        self,
        history_store: HistoryStore,
        ac_dc_dir: Path,
    ) -> None:
        """Agents under different turns never share archive files."""
        a_t1 = build_agent_context_manager(
            turn_id="turn_001",
            agent_idx=0,
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
        )
        a_t2 = build_agent_context_manager(
            turn_id="turn_002",
            agent_idx=0,
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
        )
        a_t1.add_message("user", "turn 1 task")
        a_t2.add_message("user", "turn 2 task")

        t1 = history_store.get_turn_archive("turn_001")
        t2 = history_store.get_turn_archive("turn_002")
        assert len(t1) == 1 and len(t2) == 1
        assert t1[0]["messages"][0]["content"] == "turn 1 task"
        assert t2[0]["messages"][0]["content"] == "turn 2 task"

    def test_system_event_flag_propagates(
        self,
        history_store: HistoryStore,
    ) -> None:
        """system_event=True lands on the persisted record."""
        cm = build_agent_context_manager(
            turn_id="turn_xyz",
            agent_idx=0,
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
        )
        cm.add_message(
            "user", "agent spawned", system_event=True
        )

        record = history_store.get_turn_archive("turn_xyz")[0][
            "messages"
        ][0]
        assert record.get("system_event") is True


# ---------------------------------------------------------------------------
# Extras routing
# ---------------------------------------------------------------------------


class TestExtrasRouting:
    """The closure routes kwargs between named fields and extras."""

    def test_unknown_kwargs_land_in_extra_dict(
        self,
        history_store: HistoryStore,
    ) -> None:
        """Unrecognised kwargs flow into the extra={...} dict.

        Callers passing ``files_modified`` or ``edit_results``
        (valid ContextManager extras) must not trip
        ``append_agent_message``'s unexpected-keyword-argument
        error. The closure funnels anything it doesn't
        recognise into ``extra={...}``.
        """
        cm = build_agent_context_manager(
            turn_id="turn_xyz",
            agent_idx=0,
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
        )
        cm.add_message(
            "assistant",
            "done",
            files_modified=["src/auth.py"],
            edit_results=[
                {"file": "src/auth.py", "status": "applied"},
            ],
        )
        record = history_store.get_turn_archive("turn_xyz")[0][
            "messages"
        ][0]
        # append_agent_message merges extra dict keys into the
        # top-level record — matches the same-shape-as-main-store
        # contract.
        assert record["files_modified"] == ["src/auth.py"]
        assert record["edit_results"][0]["status"] == "applied"

    def test_image_refs_routed_to_named_kwarg(
        self,
        history_store: HistoryStore,
    ) -> None:
        """image_refs passes through to the named kwarg.

        ``append_agent_message`` treats image_refs as a first-class
        field; the closure must recognise it as such rather than
        lumping it into ``extra``.
        """
        cm = build_agent_context_manager(
            turn_id="turn_xyz",
            agent_idx=0,
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
        )
        cm.add_message(
            "user",
            "look at this",
            image_refs=["img001.png", "img002.png"],
        )
        record = history_store.get_turn_archive("turn_xyz")[0][
            "messages"
        ][0]
        assert record["image_refs"] == ["img001.png", "img002.png"]

    def test_session_id_routed_to_named_kwarg(
        self,
        history_store: HistoryStore,
    ) -> None:
        """session_id kwarg routes to append_agent_message's named slot.

        Agents don't usually carry session_id (they're keyed by
        turn_id), but callers that want to back-reference to the
        user session should be able to.
        """
        cm = build_agent_context_manager(
            turn_id="turn_xyz",
            agent_idx=0,
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
        )
        cm.add_message(
            "user",
            "task",
            session_id="sess_parent",
        )
        record = history_store.get_turn_archive("turn_xyz")[0][
            "messages"
        ][0]
        assert record.get("session_id") == "sess_parent"

    def test_mixed_recognised_and_unrecognised_kwargs(
        self,
        history_store: HistoryStore,
    ) -> None:
        """Mixed kwargs split correctly between named and extra.

        Both recognised and unrecognised kwargs on the same call
        must each land in the right slot without cross-
        contamination.
        """
        cm = build_agent_context_manager(
            turn_id="turn_xyz",
            agent_idx=0,
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
        )
        cm.add_message(
            "assistant",
            "done",
            image_refs=["a.png"],  # recognised
            files_modified=["src/foo.py"],  # extra
        )
        record = history_store.get_turn_archive("turn_xyz")[0][
            "messages"
        ][0]
        assert record["image_refs"] == ["a.png"]
        assert record["files_modified"] == ["src/foo.py"]

    def test_no_extras_produces_clean_record(
        self,
        history_store: HistoryStore,
    ) -> None:
        """Plain add_message (no extras) produces a minimal record.

        Regression guard: the closure must not pass
        ``extra={}`` (empty dict) to ``append_agent_message``
        — that would be a no-op for the store but complicates
        reasoning about record shape.
        """
        cm = build_agent_context_manager(
            turn_id="turn_xyz",
            agent_idx=0,
            model_name="anthropic/claude-sonnet-4-5",
            history_store=history_store,
        )
        cm.add_message("user", "plain")
        record = history_store.get_turn_archive("turn_xyz")[0][
            "messages"
        ][0]
        # Core fields present.
        assert record["role"] == "user"
        assert record["content"] == "plain"
        assert record["turn_id"] == "turn_xyz"
        assert record["agent_idx"] == 0
        # Optional fields absent (or at least not carrying junk).
        assert "files_modified" not in record
        assert "image_refs" not in record


# ---------------------------------------------------------------------------
# Exception isolation
# ---------------------------------------------------------------------------


class TestExceptionIsolation:
    """Sink exceptions don't propagate or corrupt state.

    The ContextManager already pins this at its layer
    (test_sink_exception_does_not_propagate). The factory layer
    adds one concrete scenario: a broken HistoryStore that
    raises from ``append_agent_message``. The ContextManager's
    wrapper catches and logs; the caller sees no exception.
    """

    def test_broken_store_does_not_break_add_message(
        self,
        ac_dc_dir: Path,
    ) -> None:
        """Store raising from append → add_message still works.

        Simulates a full-disk or permission-denied condition.
        Useful here even though ContextManager has its own
        isolation test, because the factory is the boundary
        between user code and the store — a caller inspecting
        the factory output shouldn't be surprised by a raise.
        """
        class _BrokenStore(HistoryStore):
            def append_agent_message(
                self, *args: object, **kwargs: object
            ) -> dict[str, object]:
                raise RuntimeError("simulated disk failure")

        broken = _BrokenStore(ac_dc_dir)
        cm = build_agent_context_manager(
            turn_id="turn_xyz",
            agent_idx=0,
            model_name="anthropic/claude-sonnet-4-5",
            history_store=broken,
        )
        # Must not raise — ContextManager's sink wrapper
        # catches the store's exception and logs it.
        cm.add_message("user", "this still works")
        # In-memory history preserved.
        assert len(cm.get_history()) == 1
        assert cm.get_history()[0]["content"] == "this still works"