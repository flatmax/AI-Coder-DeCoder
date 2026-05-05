"""End-to-end streaming flow covering broadcasts and persistence.

Covers :class:`TestStreamingHappyPath` — user-message persistence
before the LLM call, chunk broadcast shape, streamComplete
payload, and assistant-message persistence after completion.
The service is wired to a fake litellm that streams pre-seeded
chunks so every test is deterministic.
"""

from __future__ import annotations

import asyncio

from ac_dc.history_store import HistoryStore
from ac_dc.llm_service import LLMService

from .conftest import _FakeLiteLLM, _RecordingEventCallback


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