"""Compaction system event persistence and broadcast.

Covers :class:`TestCompactionSystemEvent` — verifies that after
a successful compaction, :meth:`LLMService._post_response`
appends a ``system_event: true`` message to both the context
manager's in-memory history and the persistent JSONL store.
The message reports the compaction case, boundary info (for
truncate) or fallback line (for summarize), and before/after
stats. For summarize cases, the summary text is embedded in
an expandable ``<details>`` block.

Also pins the error-path contract (no system event on
``compaction_error``) and the helper function
:func:`_build_compaction_event_text` shape.

Governing spec: IMPLEMENTATION_NOTES.md § "Compaction UI plan".
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from ac_dc.config import ConfigManager
from ac_dc.history_compactor import CompactionResult, TopicBoundary
from ac_dc.history_store import HistoryStore
from ac_dc.llm_service import LLMService

from .conftest import _FakeLiteLLM, _RecordingEventCallback


class TestCompactionSystemEvent:
    """Compaction events land as system-event messages in history.

    After a successful compaction, ``_post_response`` appends a
    ``system_event: true`` message to both the context manager's
    in-memory history and the persistent JSONL store. The
    message reports the compaction case, boundary info (for
    truncate) or fallback line (for summarize), and before/after
    stats. For summarize cases, the summary text is embedded in
    an expandable ``<details>`` block.

    Tests exercise both happy paths (truncate + summarize) plus
    the error-path rule (don't append on compaction_error) and
    edge cases around the event reaching both stores with the
    correct content.

    Driving compaction from a test requires an unusual setup:
    we have to seed enough history to trigger the threshold,
    provide a canned detector response, and let
    ``_post_response`` run. The compactor's trigger check
    compares against ``config.compaction_config['trigger_tokens']``
    so we monkey-patch the compaction config to a low value
    (500 tokens) that's easily exceeded by a few long messages.
    """

    def _trigger_small_config(
        self,
        config: ConfigManager,
    ) -> None:
        """Rewrite compaction config to a low trigger.

        The compactor reads through ``config.compaction_config``
        via a property that re-parses ``app.json`` on each
        access (no cache to invalidate beyond the one we null
        out defensively). We write the keys
        :class:`HistoryCompactor` actually consults —
        ``compaction_trigger_tokens``, not ``trigger_tokens``.
        Mismatched key names were the cause of the original
        "compaction never triggers in tests" bug.
        """
        # Access the compactor's config via its live-read path.
        # The real ConfigManager loads from app.json; we override
        # the underlying file and invalidate any cache.
        app_path = config.config_dir / "app.json"
        app_data = json.loads(app_path.read_text())
        app_data.setdefault("history_compaction", {})
        app_data["history_compaction"]["enabled"] = True
        # Key names match the ones HistoryCompactor's properties
        # read from self._config.get(...).
        app_data["history_compaction"]["compaction_trigger_tokens"] = 500
        app_data["history_compaction"]["verbatim_window_tokens"] = 200
        app_data["history_compaction"]["min_verbatim_exchanges"] = 1
        app_data["history_compaction"]["summary_budget_tokens"] = 500
        app_path.write_text(json.dumps(app_data))
        # Clear any cached copy so the next access re-reads.
        config._app_config = None

    def _seed_history_over_trigger(
        self,
        service: LLMService,
    ) -> None:
        """Add ~600 tokens of history so the compactor triggers."""
        # Each message is ~60 tokens (300 chars); 10 exchanges
        # crosses the 500-token threshold with margin.
        long_content = "x " * 150
        for _ in range(10):
            service._context.add_message("user", long_content)
            service._context.add_message(
                "assistant", long_content
            )

    def _patch_detector(
        self,
        service: LLMService,
        boundary_index: int | None,
        confidence: float,
        reason: str,
        summary: str,
    ) -> None:
        """Replace the compactor's detector with a canned response."""
        def _detector(
            messages: list[dict[str, Any]],
        ) -> TopicBoundary:
            return TopicBoundary(
                boundary_index=boundary_index,
                boundary_reason=reason,
                confidence=confidence,
                summary=summary,
            )
        service._compactor._detect = _detector

    async def test_truncate_case_appends_system_event_to_context(
        self,
        service: LLMService,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Successful truncate → system event in context history."""
        self._trigger_small_config(config)
        self._seed_history_over_trigger(service)
        # Boundary in the last few messages (past the verbatim
        # window start) with high confidence → truncate case.
        self._patch_detector(
            service,
            boundary_index=18,
            confidence=0.9,
            reason="user switched to logging work",
            summary="",
        )

        tid = HistoryStore.new_turn_id()
        await service._post_response("r1", tid)

        # System event present in context.
        history = service._context.get_history()
        events = [
            m for m in history
            if m.get("system_event")
            and "History compacted" in m.get("content", "")
        ]
        assert len(events) == 1
        content = events[0]["content"]
        assert "truncate" in content
        assert "logging" in content
        assert "confidence" in content

    async def test_truncate_case_persists_to_history_store(
        self,
        service: LLMService,
        config: ConfigManager,
        history_store: HistoryStore,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Successful truncate → system event in JSONL too."""
        self._trigger_small_config(config)
        self._seed_history_over_trigger(service)
        self._patch_detector(
            service,
            boundary_index=18,
            confidence=0.9,
            reason="topic shift",
            summary="",
        )

        tid = HistoryStore.new_turn_id()
        await service._post_response("r1", tid)

        sid = service.get_current_state()["session_id"]
        persisted = history_store.get_session_messages(sid)
        events = [
            m for m in persisted
            if m.get("system_event")
            and "History compacted" in m.get("content", "")
        ]
        assert len(events) == 1

    async def test_summarize_case_embeds_details_block(
        self,
        service: LLMService,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Summarize → <details> block with summary text."""
        self._trigger_small_config(config)
        self._seed_history_over_trigger(service)
        # Boundary before the verbatim window → summarize case.
        self._patch_detector(
            service,
            boundary_index=2,
            confidence=0.8,
            reason="early exploration",
            summary=(
                "The prior conversation covered setting up the "
                "auth module and writing the first tests."
            ),
        )

        tid = HistoryStore.new_turn_id()
        await service._post_response("r1", tid)

        history = service._context.get_history()
        events = [
            m for m in history
            if m.get("system_event")
            and "History compacted" in m.get("content", "")
        ]
        assert len(events) == 1
        content = events[0]["content"]
        assert "summarize" in content
        assert "<details>" in content
        assert "<summary>Summary</summary>" in content
        assert "auth module" in content
        assert "</details>" in content

    async def test_summarize_without_detector_summary_uses_fallback(
        self,
        service: LLMService,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Summarize + empty detector summary → compactor fallback shown.

        When the detector returns an empty summary string,
        :class:`HistoryCompactor` substitutes a generic
        placeholder so the LLM's next turn sees *something*
        describing the compacted history. The event builder
        reads the compactor's final ``result.summary`` — not the
        detector's original output — so the ``<details>`` block
        IS present, carrying the fallback text.

        This is the user-visible behaviour: a compaction with
        no detected topic boundary still produces an expandable
        summary block in the chat, populated with the generic
        fallback. The "empty summary → no details" path exists
        only when ``_build_compaction_event_text`` is called
        directly with a ``CompactionResult(summary="")`` — covered
        by :meth:`test_build_event_text_summarize_without_summary`.
        """
        self._trigger_small_config(config)
        self._seed_history_over_trigger(service)
        self._patch_detector(
            service,
            boundary_index=None,
            confidence=0.0,
            reason="",
            summary="",
        )

        tid = HistoryStore.new_turn_id()
        await service._post_response("r1", tid)

        history = service._context.get_history()
        events = [
            m for m in history
            if m.get("system_event")
            and "History compacted" in m.get("content", "")
        ]
        assert len(events) == 1
        content = events[0]["content"]
        # Fallback boundary line present — no detector-reported
        # reason to display.
        assert "No clear topic boundary" in content
        # Details block present with the compactor's generic
        # fallback summary text. The fallback is defined in
        # history_compactor._GENERIC_SUMMARY_FALLBACK; we assert
        # on a stable fragment rather than the full string to
        # avoid coupling to the exact wording.
        assert "<details>" in content
        assert "<summary>Summary</summary>" in content
        assert "earlier topics" in content
        assert "</details>" in content

    async def test_event_contains_token_stats(
        self,
        service: LLMService,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Stats line reports before/after token counts and message delta."""
        self._trigger_small_config(config)
        self._seed_history_over_trigger(service)
        self._patch_detector(
            service,
            boundary_index=18,
            confidence=0.9,
            reason="shift",
            summary="",
        )

        tid = HistoryStore.new_turn_id()
        await service._post_response("r1", tid)

        history = service._context.get_history()
        events = [
            m for m in history
            if m.get("system_event")
            and "History compacted" in m.get("content", "")
        ]
        assert len(events) == 1
        content = events[0]["content"]
        # Stats line format: "Removed N messages • M → N tokens"
        assert "Removed" in content
        assert "messages" in content
        assert "tokens" in content
        assert "→" in content

    async def test_error_path_does_not_append_system_event(
        self,
        service: LLMService,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """compaction_error → no system event written.

        A failure in the detector (or anywhere in the
        compactor's path) emits compaction_error and returns.
        Appending a message saying compaction failed would be
        noise — the event already communicates the failure via
        the progress channel, and the history (which we
        couldn't compact) stays intact.
        """
        self._trigger_small_config(config)
        self._seed_history_over_trigger(service)
        # Force the compactor to raise.
        def _broken(messages: list[dict[str, Any]]) -> TopicBoundary:
            raise RuntimeError("simulated detector failure")
        service._compactor._detect = _broken
        # The HistoryCompactor's _safely_detect catches the
        # raise and returns SAFE_BOUNDARY; so the compaction
        # itself won't error. Force a harder failure by making
        # compact_history_if_needed itself raise.
        original = service._compactor.compact_history_if_needed
        def _raise(*args: Any, **kwargs: Any) -> Any:
            raise RuntimeError("pipeline failure")
        service._compactor.compact_history_if_needed = _raise  # type: ignore[method-assign]

        try:
            tid = HistoryStore.new_turn_id()
            await service._post_response("r1", tid)
        finally:
            service._compactor.compact_history_if_needed = original  # type: ignore[method-assign]

        # No compaction system event.
        history = service._context.get_history()
        events = [
            m for m in history
            if m.get("system_event")
            and "History compacted" in m.get("content", "")
        ]
        assert events == []

        # compaction_error event fired via the callback.
        errors = [
            args for name, args in event_cb.events
            if name == "compactionEvent"
            and args[1].get("stage") == "compaction_error"
        ]
        assert errors

    async def test_event_appended_after_set_history(
        self,
        service: LLMService,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """System event is the LAST message in the compacted history.

        Without this ordering, a browser reload after compaction
        would show the compacted messages without the system
        event — the event would only appear on the NEXT request.
        Pinning ensures the event is visible in the current
        session state immediately.
        """
        self._trigger_small_config(config)
        self._seed_history_over_trigger(service)
        self._patch_detector(
            service,
            boundary_index=18,
            confidence=0.9,
            reason="x",
            summary="",
        )

        tid = HistoryStore.new_turn_id()
        await service._post_response("r1", tid)

        history = service._context.get_history()
        assert len(history) > 0
        last = history[-1]
        assert last.get("system_event") is True
        assert "History compacted" in last.get("content", "")

    async def test_broadcast_includes_event_in_messages(
        self,
        service: LLMService,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """compacted broadcast carries the system event in its messages.

        The frontend's ChatPanel replaces its message list from
        this broadcast. If the event weren't included, the
        chat panel would briefly show the compacted list
        WITHOUT the event, then append it on the next render
        — producing a visible flicker. Pinning the event's
        presence in the broadcast payload prevents that.
        """
        self._trigger_small_config(config)
        self._seed_history_over_trigger(service)
        self._patch_detector(
            service,
            boundary_index=18,
            confidence=0.9,
            reason="x",
            summary="",
        )

        tid = HistoryStore.new_turn_id()
        await service._post_response("r1", tid)

        # Find the compacted broadcast.
        completes = [
            args for name, args in event_cb.events
            if name == "compactionEvent"
            and args[1].get("stage") == "compacted"
        ]
        assert completes
        payload = completes[-1][1]
        messages = payload.get("messages", [])
        events = [
            m for m in messages
            if m.get("system_event")
            and "History compacted" in m.get("content", "")
        ]
        assert len(events) == 1

    def test_build_event_text_truncate_format(self) -> None:
        """Helper produces the documented 3-part format for truncate."""
        from ac_dc.llm_service import _build_compaction_event_text

        result = CompactionResult(
            case="truncate",
            messages=[],
            boundary=TopicBoundary(
                boundary_index=5,
                boundary_reason="switched topics",
                confidence=0.95,
                summary="",
            ),
            summary="",
        )
        text = _build_compaction_event_text(
            result,
            tokens_before=24000,
            tokens_after=8400,
            messages_before_count=20,
            messages_after_count=2,
        )
        # Header line.
        assert text.startswith("**History compacted** — truncate")
        # Boundary line.
        assert "switched topics" in text
        assert "0.95" in text
        # Stats line.
        assert "Removed 18 messages" in text
        assert "24000 → 8400 tokens" in text
        # No details block for truncate.
        assert "<details>" not in text

    def test_build_event_text_summarize_with_summary(self) -> None:
        """Summarize case includes the <details> block."""
        from ac_dc.llm_service import _build_compaction_event_text

        result = CompactionResult(
            case="summarize",
            messages=[],
            boundary=TopicBoundary(
                boundary_index=None,
                boundary_reason="",
                confidence=0.3,
                summary="",
            ),
            summary="earlier work on the parser",
        )
        text = _build_compaction_event_text(
            result,
            tokens_before=28000,
            tokens_after=9200,
            messages_before_count=30,
            messages_after_count=3,
        )
        assert text.startswith("**History compacted** — summarize")
        assert "No clear topic boundary" in text
        assert "Removed 27 messages" in text
        assert "<details>" in text
        assert "<summary>Summary</summary>" in text
        assert "earlier work on the parser" in text
        assert "</details>" in text

    def test_build_event_text_summarize_without_summary(self) -> None:
        """Summarize with empty summary text omits the details block."""
        from ac_dc.llm_service import _build_compaction_event_text

        result = CompactionResult(
            case="summarize",
            messages=[],
            boundary=TopicBoundary(
                boundary_index=None,
                boundary_reason="",
                confidence=0.0,
                summary="",
            ),
            summary="",
        )
        text = _build_compaction_event_text(
            result,
            tokens_before=10000,
            tokens_after=3000,
            messages_before_count=5,
            messages_after_count=1,
        )
        assert "summarize" in text
        assert "<details>" not in text
        assert "No clear topic boundary" in text