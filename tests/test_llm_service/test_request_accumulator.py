"""Per-request accumulator lifecycle.

Covers :class:`TestRequestAccumulator`: the
``_request_accumulators`` dict keyed by request ID so N
concurrent streams can coexist. Slots are populated during
streaming and cleared after post-response (normal, error, and
cancellation paths). Parent and child streams have independent
slots.
"""

from __future__ import annotations

import asyncio

import pytest

from ac_dc.llm_service import LLMService

from .conftest import _FakeLiteLLM, _RecordingEventCallback


class TestRequestAccumulator:
    """Per-request accumulated response content, keyed by request ID.

    Per specs4/7-future/parallel-agents.md § Foundation
    Requirements ("Chunk routing keyed by request ID, not by
    singleton flag"), the accumulator must be keyed by request
    ID so N concurrent streams can coexist. Today only the main
    LLM stream populates an entry; when agent spawning lands,
    each agent's child request gets its own slot.

    These tests pin the contract:

    - Slot populated on every chunk with accumulated content
    - Slot contains the final assembled string at completion
    - Slot cleared after post-response work completes
    - Slot cleared on error and cancellation paths
    - Missing slots don't crash the cleanup path

    The accumulator is a write-from-worker, read-from-event-loop
    channel. GIL guarantees atomic dict writes for string values,
    so readers don't need locks.
    """

    async def test_slot_populated_with_accumulated_content(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """Each chunk writes the running total to the slot.

        We can't easily observe mid-stream state without race
        conditions, but we can verify the FINAL state after
        completion has the full accumulated content — which
        proves writes happened at least once with the correct
        value.

        The cleanup in the finally block removes the slot after
        post-response work completes, so we read the slot
        BEFORE awaiting long enough for cleanup — the
        streamComplete event fires before cleanup, so the
        event's presence is our signal that the slot was
        populated but not yet cleared.
        """
        fake_litellm.set_streaming_chunks(["Hello", " world"])

        # Patch _run_completion_sync to capture the accumulator
        # state at the moment the worker returns — BEFORE
        # cleanup runs. This is the reliable observation window
        # for the slot contents.
        captured: dict[str, str] = {}
        original = service._run_completion_sync

        def _capture_after_run(*args, **kwargs):
            result = original(*args, **kwargs)
            request_id = args[0]
            captured[request_id] = (
                service._request_accumulators.get(request_id, "")
            )
            return result

        service._run_completion_sync = _capture_after_run  # type: ignore[method-assign]

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.3)

        assert captured.get("r1") == "Hello world"

    async def test_slot_cleared_after_completion(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Cleanup drops the slot once post-response work finishes.

        The slot's lifetime matches the "stream is active"
        signal — it lives from first chunk through post-
        response work, then clears. Nothing should read stale
        accumulator data after a stream ends.
        """
        fake_litellm.set_streaming_chunks(["response"])

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.3)

        assert "r1" not in service._request_accumulators

    async def test_slot_cleared_on_error(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Errors in the worker don't leak accumulator slots.

        Regression guard: a stream that raises before completing
        must still clear its slot. Otherwise a series of failing
        requests would grow the dict unboundedly.
        """
        # Force _run_completion_sync to raise.
        def _raise(*args, **kwargs):
            raise RuntimeError("simulated LLM failure")
        monkeypatch.setattr(
            service, "_run_completion_sync", _raise
        )

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.3)

        assert "r1" not in service._request_accumulators

    async def test_slot_cleared_on_cancellation(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Cancelled streams also clear their accumulator slot."""
        fake_litellm.set_streaming_chunks(["partial"])
        # Pre-register cancellation so the worker breaks out
        # on the first chunk check.
        service._cancelled_requests.add("r1")

        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.3)

        assert "r1" not in service._request_accumulators

    async def test_missing_slot_cleanup_is_safe(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Cleanup tolerates a request that never populated a slot.

        Edge case: the worker raises before the first chunk
        arrives, so no ``self._request_accumulators[request_id]``
        write ever happened. The cleanup's ``pop`` with a
        default must not raise KeyError.
        """
        # Force the worker to raise immediately, before any
        # chunk loop iteration. The fake's completion() would
        # normally yield chunks; patching _run_completion_sync
        # at the service level skips the worker entirely.
        def _instant_raise(*args, **kwargs):
            raise RuntimeError("pre-chunk failure")
        monkeypatch.setattr(
            service, "_run_completion_sync", _instant_raise
        )

        # Streaming must not raise from the cleanup path.
        await service.chat_streaming(
            request_id="r1", message="hi"
        )
        await asyncio.sleep(0.3)

        # Dict is clean; no KeyError observed.
        assert "r1" not in service._request_accumulators

    async def test_parent_slot_not_cleared_by_child_cleanup(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """A child stream's completion preserves the parent's guard slot.

        Critical invariant: the ``_active_user_request`` slot
        must survive until the PARENT stream completes. If a
        child's cleanup path cleared it, the parent would
        continue streaming into a state where the guard thinks
        no stream is active, breaking the single-stream
        contract. Today no code path produces child streams,
        so we simulate the scenario by seeding the parent
        state directly.
        """
        # Simulate parent active.
        service._active_user_request = "parent-abc"

        fake_litellm.set_streaming_chunks(["ok"])
        # Child request completes.
        await service.chat_streaming(
            request_id="parent-abc-agent-0", message="hi"
        )
        await asyncio.sleep(0.3)

        # Parent slot intact — child's cleanup did NOT touch it.
        assert service._active_user_request == "parent-abc"

    async def test_child_slot_cleared_independently(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Child accumulator slots clear on their own completion.

        Symmetric with the parent-preservation test: children
        clean up their OWN slots without interfering with the
        parent's. When agent spawning lands, each agent's
        output is isolated to its own slot and drops when
        that agent completes, even if siblings are still
        streaming.
        """
        service._active_user_request = "parent-abc"

        fake_litellm.set_streaming_chunks(["child output"])
        await service.chat_streaming(
            request_id="parent-abc-agent-0", message="hi"
        )
        await asyncio.sleep(0.3)

        # Child's slot cleared; parent's slot not (parent
        # never had one in this test).
        assert "parent-abc-agent-0" not in (
            service._request_accumulators
        )