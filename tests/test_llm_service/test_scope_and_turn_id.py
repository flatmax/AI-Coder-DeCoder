"""Conversation scope defaults and turn ID propagation.

Covers:

- :class:`TestConversationScopeDefault` — explicit-scope calls to
  ``_stream_chat`` match the default behaviour. Regression guard
  for the parallel-agents scope refactor: the explicit-scope
  path, a manually-constructed scope, and the None-fallback path
  all produce byte-identical behaviour.
- :class:`TestTurnIdPropagation` — every record produced by a
  user request carries a shared turn_id. Pins the invariant
  that groups user, assistant, and system-event records into
  one turn.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from ac_dc.config import ConfigManager
from ac_dc.history_store import HistoryStore
from ac_dc.history_compactor import TopicBoundary
from ac_dc.llm_service import LLMService
from ac_dc.repo import Repo

from .conftest import _FakeLiteLLM, _RecordingEventCallback


class TestConversationScopeDefault:
    """Explicit-scope calls to ``_stream_chat`` match default behaviour.

    Regression guard for the parallel-agents scope refactor.
    Every existing test exercises the implicit default-scope
    path via ``chat_streaming`` → ``_stream_chat(..., scope=
    self._default_scope())``. This class adds tests that verify
    the EXPLICIT-scope path produces identical behaviour —
    which matters because future agent-spawning code always
    passes scopes explicitly rather than relying on the
    None-fallback in each method's signature.

    Three angles covered:

    1. Calling ``_stream_chat`` directly with ``scope=service.
       _default_scope()`` — the production path a future
       spawner will take. Verifies the default-scope helper
       wires all fields correctly.
    2. Calling ``_stream_chat`` with a manually-constructed
       ``ConversationScope`` whose fields point at the same
       objects ``_default_scope`` would use — verifies that
       the scope's field semantics (context/tracker/
       session_id/selected_files/archival_append) are the
       contract, not the helper.
    3. Calling ``_stream_chat`` with ``scope=None`` — verifies
       the None-fallback path every method carries. Catches a
       future refactor that drops the fallback and breaks
       callers that rely on it.

    Each test asserts against the same observable surface as
    ``TestStreamingHappyPath``: user and assistant messages
    persist to history, ``streamComplete`` fires with the
    expected payload, and the session state reflects the
    conversation. The point is byte-identical behaviour — any
    divergence surfaces as a test failure here before it
    reaches production.
    """

    async def test_explicit_default_scope_produces_same_result(
        self,
        service: LLMService,
        history_store: HistoryStore,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """``_stream_chat`` called with an explicit default scope behaves normally.

        Bypasses ``chat_streaming`` to pass the scope directly,
        simulating what future agent-spawning code does. Every
        observable — persisted messages, streamComplete event,
        final conversation state — matches what the implicit
        path produces.
        """
        fake_litellm.set_streaming_chunks(["explicit scope works"])

        # Capture the main loop the way chat_streaming would —
        # _stream_chat's worker thread bridge needs it.
        service._main_loop = asyncio.get_event_loop()
        # Register the stream against the guard so the worker
        # thread's cancellation check doesn't race with a
        # concurrent cancel.
        service._active_user_request = "r-explicit"

        try:
            scope = service._default_scope()
            await service._stream_chat(
                request_id="r-explicit",
                message="hello",
                files=[],
                images=[],
                excluded_urls=[],
                scope=scope,
            )
        finally:
            service._active_user_request = None

        # User + assistant messages persisted.
        sid = service.get_current_state()["session_id"]
        persisted = history_store.get_session_messages(sid)
        assert any(
            m["role"] == "user" and m["content"] == "hello"
            for m in persisted
        )
        assert any(
            m["role"] == "assistant"
            and m["content"] == "explicit scope works"
            for m in persisted
        )

        # streamComplete fired with the correct request ID.
        completes = [
            args for name, args in event_cb.events
            if name == "streamComplete"
        ]
        assert completes
        req_id, result = completes[-1]
        assert req_id == "r-explicit"
        assert result["response"] == "explicit scope works"

    async def test_manually_constructed_scope_matches_default(
        self,
        service: LLMService,
        history_store: HistoryStore,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """A scope built field-by-field behaves like ``_default_scope()``.

        Proves the scope's field semantics are the contract,
        not the helper. A future agent-spawning path that
        constructs scopes manually (pointing at agent-specific
        ContextManager / tracker / selection list) must produce
        the same behaviour as the main-conversation default
        when its fields happen to point at the main-conversation
        state.
        """
        from ac_dc.llm_service import ConversationScope

        fake_litellm.set_streaming_chunks(["manual scope works"])

        service._main_loop = asyncio.get_event_loop()
        service._active_user_request = "r-manual"

        # Build an archival_append closure the same way
        # _default_scope does — thin wrapper around
        # HistoryStore.append_message.
        store = service._history_store
        assert store is not None  # fixture has one

        def _append(
            role: str,
            content: str,
            *,
            session_id: str,
            **kwargs: Any,
        ) -> Any:
            return store.append_message(
                session_id=session_id,
                role=role,
                content=content,
                **kwargs,
            )

        manual_scope = ConversationScope(
            context=service._context,
            tracker=service._stability_tracker,
            session_id=service._session_id,
            selected_files=service._selected_files,
            archival_append=_append,
        )

        try:
            await service._stream_chat(
                request_id="r-manual",
                message="hello",
                files=[],
                images=[],
                excluded_urls=[],
                scope=manual_scope,
            )
        finally:
            service._active_user_request = None

        # Same observable surface as the default-scope test.
        sid = service.get_current_state()["session_id"]
        persisted = history_store.get_session_messages(sid)
        assert any(
            m["role"] == "user" and m["content"] == "hello"
            for m in persisted
        )
        assert any(
            m["role"] == "assistant"
            and m["content"] == "manual scope works"
            for m in persisted
        )

    async def test_none_fallback_produces_same_result(
        self,
        service: LLMService,
        history_store: HistoryStore,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """``scope=None`` falls through to the default scope.

        Safety-net path every per-conversation method carries.
        If a future refactor drops the None-fallback and
        requires an explicit scope, this test catches the
        breaking change — the existing ``chat_streaming``
        surface doesn't use None (it always builds a default
        scope), but the None-branch in every helper is a
        documented contract worth pinning.
        """
        fake_litellm.set_streaming_chunks(["none fallback works"])

        service._main_loop = asyncio.get_event_loop()
        service._active_user_request = "r-none"

        try:
            await service._stream_chat(
                request_id="r-none",
                message="hello",
                files=[],
                images=[],
                excluded_urls=[],
                scope=None,
            )
        finally:
            service._active_user_request = None

        sid = service.get_current_state()["session_id"]
        persisted = history_store.get_session_messages(sid)
        assert any(
            m["role"] == "user" and m["content"] == "hello"
            for m in persisted
        )
        assert any(
            m["role"] == "assistant"
            and m["content"] == "none fallback works"
            for m in persisted
        )

    def test_default_scope_helper_fields(
        self,
        service: LLMService,
    ) -> None:
        """``_default_scope()`` wires every field to the main state.

        Unit-level check on the helper itself. Verifies each
        field points at the exact object the main conversation
        owns — aliasing matters for the byte-identical contract
        (a copy of ``_selected_files`` would mean auto-add
        mutations don't reach the service's list; a fresh
        ContextManager would mean history and file_context
        don't align with what the frontend sees via
        ``get_current_state``).
        """
        scope = service._default_scope()
        # ContextManager identity — not a copy.
        assert scope.context is service._context
        # Tracker identity — the active mode's tracker.
        assert scope.tracker is service._stability_tracker
        # Session ID — string equality (strings are immutable,
        # identity doesn't matter, but the value must match).
        assert scope.session_id == service._session_id
        # Selected files — MUST be the same list object so
        # auto-add mutations in _build_completion_result reach
        # the service's list. A copy would break the contract.
        assert scope.selected_files is service._selected_files
        # archival_append is a closure over the history store,
        # not None (fixture has a store). It's a new closure
        # on every call — we can't assert identity, but it
        # must be callable.
        assert callable(scope.archival_append)

    def test_default_scope_without_history_store_has_none_append(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """No history store → ``archival_append`` is None.

        Tests that skip persistence (no ``history_store``
        fixture) must get a scope whose archival_append is
        None so callers check before invoking. Matches the
        ``Optional[ArchivalAppend]`` contract.
        """
        svc = LLMService(config=config, repo=repo)
        scope = svc._default_scope()
        assert scope.archival_append is None
        # Other fields still wired.
        assert scope.context is svc._context
        assert scope.tracker is svc._stability_tracker
        assert scope.selected_files is svc._selected_files


class TestTurnIdPropagation:
    """Turn ID propagation through the streaming pipeline.

    Slice 1 of the parallel-agents foundation — per
    specs4/3-llm/history.md § Turns, every record produced by a
    user request carries a shared turn_id so the main store has
    a consistent key for "records from this request". Lays the
    groundwork for Slice 2 (agent archives keyed by turn_id).

    Scope: verifies turn IDs are generated, match between
    user/assistant records, appear in both the context manager
    and the history store, and carry through to compaction
    system events when compaction fires during post-response.
    """

    async def test_user_message_carries_turn_id(
        self,
        service: LLMService,
        history_store: HistoryStore,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Persisted user message has a turn_id starting with 'turn_'."""
        fake_litellm.set_streaming_chunks(["ok"])

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.2)

        sid = service.get_current_state()["session_id"]
        persisted = history_store.get_session_messages(sid)
        user_msgs = [m for m in persisted if m["role"] == "user"]
        assert user_msgs
        tid = user_msgs[-1].get("turn_id")
        assert isinstance(tid, str)
        assert tid.startswith("turn_")

    async def test_assistant_message_carries_turn_id(
        self,
        service: LLMService,
        history_store: HistoryStore,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Persisted assistant message has a turn_id."""
        fake_litellm.set_streaming_chunks(["ok"])

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.2)

        sid = service.get_current_state()["session_id"]
        persisted = history_store.get_session_messages(sid)
        assistant_msgs = [
            m for m in persisted if m["role"] == "assistant"
        ]
        assert assistant_msgs
        tid = assistant_msgs[-1].get("turn_id")
        assert isinstance(tid, str)
        assert tid.startswith("turn_")

    async def test_user_and_assistant_share_turn_id(
        self,
        service: LLMService,
        history_store: HistoryStore,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """User and assistant records from one turn share turn_id.

        The key invariant — turn_id groups all records produced
        by a single request. Without this, agent archives
        (Slice 2) couldn't be keyed by turn_id because the key
        wouldn't uniquely identify the turn.
        """
        fake_litellm.set_streaming_chunks(["reply"])

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.2)

        sid = service.get_current_state()["session_id"]
        persisted = history_store.get_session_messages(sid)
        user_tid = next(
            m["turn_id"] for m in persisted
            if m["role"] == "user" and m.get("turn_id")
        )
        assistant_tid = next(
            m["turn_id"] for m in persisted
            if m["role"] == "assistant" and m.get("turn_id")
        )
        assert user_tid == assistant_tid

    async def test_two_turns_have_different_ids(
        self,
        service: LLMService,
        history_store: HistoryStore,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Back-to-back turns produce distinct turn_ids.

        Pins the "one turn ID per user request" rule — reusing
        an ID across turns would corrupt the agent archive
        directory structure (Slice 2).
        """
        fake_litellm.set_streaming_chunks(["r1 reply"])
        await service.chat_streaming(request_id="r1", message="one")
        await asyncio.sleep(0.2)

        fake_litellm.set_streaming_chunks(["r2 reply"])
        await service.chat_streaming(request_id="r2", message="two")
        await asyncio.sleep(0.2)

        sid = service.get_current_state()["session_id"]
        persisted = history_store.get_session_messages(sid)
        # Collect turn_ids from user records (one per turn).
        turn_ids = [
            m["turn_id"] for m in persisted
            if m["role"] == "user" and m.get("turn_id")
        ]
        assert len(turn_ids) == 2
        assert turn_ids[0] != turn_ids[1]

    async def test_context_manager_records_turn_id(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Context manager's in-memory history carries turn_id too.

        Both stores (context manager + JSONL) must agree on the
        turn_id — otherwise a reader walking the context for
        prompt assembly and a reader walking JSONL for the
        agent-browser UI would see inconsistent grouping.
        """
        fake_litellm.set_streaming_chunks(["ok"])

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.2)

        history = service.get_current_state()["messages"]
        user_msg = next(
            m for m in history if m["role"] == "user"
        )
        assistant_msg = next(
            m for m in history if m["role"] == "assistant"
        )
        assert user_msg.get("turn_id")
        assert user_msg["turn_id"] == assistant_msg.get("turn_id")

    async def test_compaction_event_inherits_turn_id(
        self,
        service: LLMService,
        config: ConfigManager,
        history_store: HistoryStore,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Compaction system event shares turn_id with its triggering turn.

        Pins the "system events fired during a turn inherit the
        turn_id" rule from specs4/3-llm/history.md § Turns. Uses
        the same low-threshold config trick as
        ``TestCompactionSystemEvent`` to force compaction to
        fire on the first real turn.
        """
        # Lower the compaction threshold so compaction fires
        # after the first turn. Reuse the helper pattern from
        # TestCompactionSystemEvent.
        app_path = config.config_dir / "app.json"
        app_data = json.loads(app_path.read_text())
        app_data.setdefault("history_compaction", {})
        app_data["history_compaction"]["enabled"] = True
        app_data["history_compaction"]["compaction_trigger_tokens"] = 500
        app_data["history_compaction"]["verbatim_window_tokens"] = 200
        app_data["history_compaction"]["min_verbatim_exchanges"] = 1
        app_data["history_compaction"]["summary_budget_tokens"] = 500
        app_path.write_text(json.dumps(app_data))
        config._app_config = None

        # Seed enough history to cross the trigger.
        long_content = "x " * 150
        for _ in range(10):
            service._context.add_message("user", long_content)
            service._context.add_message("assistant", long_content)

        # Canned detector — truncate case so the event fires.
        def _detector(messages):
            return TopicBoundary(
                boundary_index=18,
                boundary_reason="topic shift",
                confidence=0.9,
                summary="",
            )
        service._compactor._detect = _detector

        fake_litellm.set_streaming_chunks(["reply"])
        await service.chat_streaming(
            request_id="r1", message="trigger"
        )
        await asyncio.sleep(0.3)

        sid = service.get_current_state()["session_id"]
        persisted = history_store.get_session_messages(sid)
        # The compaction system event is a user-role record
        # with system_event=True and "History compacted" in
        # the content.
        compaction_events = [
            m for m in persisted
            if m.get("system_event")
            and "History compacted" in m.get("content", "")
        ]
        assert len(compaction_events) == 1
        # User message carries the turn ID; the compaction
        # event must inherit it.
        user_tid = next(
            m["turn_id"] for m in persisted
            if m["role"] == "user"
            and m.get("content") == "trigger"
            and m.get("turn_id")
        )
        assert compaction_events[0].get("turn_id") == user_tid