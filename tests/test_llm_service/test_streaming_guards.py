"""Single-stream guard behaviour and child-request classification.

Covers:

- :class:`TestStreamingGuards` — ``chat_streaming`` rejects when
  init incomplete or another stream is active.
- :class:`TestIsChildRequest` — :meth:`LLMService._is_child_request`
  classifier contract for the parallel-agents foundation.
- :class:`TestChildRequestGuard` — end-to-end behaviour: the guard
  lets prefixed child requests through while continuing to reject
  genuine concurrent user streams.
"""

from __future__ import annotations

import asyncio

from ac_dc.config import ConfigManager
from ac_dc.llm_service import LLMService
from ac_dc.repo import Repo

from .conftest import _FakeLiteLLM


# ---------------------------------------------------------------------------
# chat_streaming — guards
# ---------------------------------------------------------------------------


class TestStreamingGuards:
    """chat_streaming rejects when init incomplete or stream active."""

    async def test_rejects_before_init_complete(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """deferred_init=True → chat rejects with friendly message."""
        svc = LLMService(
            config=config, repo=repo, deferred_init=True
        )
        result = await svc.chat_streaming(
            request_id="r1", message="hi"
        )
        assert "initializing" in result.get("error", "")

    async def test_rejects_concurrent_stream(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Second call while first is active → rejected."""
        # Register an active stream without going through
        # chat_streaming (to avoid racing with the background task).
        service._active_user_request = "existing-req"
        result = await service.chat_streaming(
            request_id="new-req", message="hi"
        )
        assert "active" in result.get("error", "").lower()


# ---------------------------------------------------------------------------
# _is_child_request — parallel-agents foundation
# ---------------------------------------------------------------------------


class TestIsChildRequest:
    """The `_is_child_request` classifier narrows the single-stream guard.

    Per specs4/7-future/parallel-agents.md § Foundation
    Requirements ("Single-stream guard gates user-initiated
    requests only"), the guard must accept child streams that
    share a parent's request ID prefix while continuing to
    reject genuinely-concurrent user streams.

    Today no code path produces child request IDs, so
    ``_is_child_request`` always returns False in practice.
    These tests pin the contract so when agent spawning lands,
    the guard's shape is already correct — only the spawning
    code needs to change.
    """

    def test_returns_false_when_no_active_parent(
        self, service: LLMService
    ) -> None:
        """No active parent → nothing to be a child of.

        Without a parent, every request ID is its own
        user-initiated request. The guard path with no active
        stream doesn't reach this helper, but the classifier
        itself must be defined on the empty-parent case.
        """
        assert service._active_user_request is None
        assert service._is_child_request("any-id") is False

    def test_returns_false_when_id_matches_parent_exactly(
        self, service: LLMService
    ) -> None:
        """An exact-match request ID is a duplicate, not a child.

        A reconnect from the same browser or a duplicate RPC
        call that carries the existing parent's ID must be
        treated as a conflicting user-initiated request, not
        silently accepted as a child. Downstream this surfaces
        as the "another stream is active" error.
        """
        service._active_user_request = "parent-abc"
        assert service._is_child_request("parent-abc") is False

    def test_returns_true_for_prefixed_child_id(
        self, service: LLMService
    ) -> None:
        """``{parent}-agent-N`` pattern is recognised as a child.

        Pins the child-ID convention from
        specs4/7-future/parallel-agents.md § Transport. When
        agent spawning lands, each agent's request ID will
        follow this shape and the guard will let it through.
        """
        service._active_user_request = "parent-abc"
        assert service._is_child_request("parent-abc-agent-0") is True
        assert service._is_child_request("parent-abc-agent-7") is True

    def test_returns_true_for_arbitrary_dash_suffix(
        self, service: LLMService
    ) -> None:
        """Any ``{parent}-{suffix}`` shape qualifies as a child.

        The convention is ``{parent}-agent-N`` but the
        classifier doesn't enforce the ``agent-`` infix — it
        just checks for the parent prefix followed by a dash.
        This keeps the rule simple and lets future spawning
        paths (sub-agents, tool-call streams) inherit the
        guard without coordinating on naming.
        """
        service._active_user_request = "parent-abc"
        assert service._is_child_request("parent-abc-sub-1") is True
        assert service._is_child_request("parent-abc-tool-42") is True

    def test_returns_false_for_non_prefix_match(
        self, service: LLMService
    ) -> None:
        """A request ID that merely contains the parent string is not a child.

        The classifier requires the parent to be a *prefix*
        followed by a dash — not a substring anywhere in the
        ID. Otherwise a user-initiated request whose random
        suffix happens to contain an active parent's ID
        would be misclassified.
        """
        service._active_user_request = "parent-abc"
        # Contains "parent-abc" but not as a prefix.
        assert service._is_child_request("x-parent-abc") is False
        # Prefix match without the separating dash — an
        # unrelated ID that happens to start with the parent's
        # text.
        assert service._is_child_request("parent-abcxyz") is False

    def test_returns_false_for_sibling_user_request(
        self, service: LLMService
    ) -> None:
        """A sibling user-initiated request doesn't match the prefix.

        Two unrelated user-initiated requests running
        back-to-back have independent IDs. The second must
        be rejected as a conflicting user stream, not
        accepted as a child of the first.
        """
        service._active_user_request = "req-alpha"
        assert service._is_child_request("req-beta") is False


class TestChildRequestGuard:
    """The single-stream guard lets child requests through.

    End-to-end behaviour: with a parent user-initiated stream
    active, a prefixed child request ID doesn't register a new
    parent slot, doesn't reject with the "another stream"
    error, and doesn't overwrite the parent's active-request
    tracking. A non-child second request still rejects as
    before.

    No code path produces child request IDs yet, so these
    tests construct the scenario by seeding
    ``_active_user_request`` directly and calling
    ``chat_streaming`` with a prefixed ID. When agent spawning
    lands, the tests still pass because the contract they pin
    matches the spawning path's behaviour by design.
    """

    async def test_child_request_not_rejected_by_guard(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Prefixed child ID passes the guard while parent is active."""
        # Parent stream registered.
        service._active_user_request = "parent-abc"

        fake_litellm.set_streaming_chunks(["ok"])
        result = await service.chat_streaming(
            request_id="parent-abc-agent-0", message="hi"
        )
        # Not rejected — child streams pass through.
        assert result == {"status": "started"}
        # Clean up the background task so teardown doesn't
        # leave an orphan stream running against the fake.
        await asyncio.sleep(0.2)

    async def test_child_request_does_not_overwrite_parent(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """A child's ID never replaces the parent's guard slot.

        Critical invariant: the guard's ``_active_user_request``
        slot tracks the user-initiated parent. If a child
        overwrote it, the parent's own cleanup (in the
        background task's finally block) would run against a
        mismatched ID and the slot could leak.
        """
        service._active_user_request = "parent-abc"

        fake_litellm.set_streaming_chunks(["ok"])
        await service.chat_streaming(
            request_id="parent-abc-agent-0", message="hi"
        )
        # Parent slot unchanged.
        assert service._active_user_request == "parent-abc"
        await asyncio.sleep(0.2)

    async def test_duplicate_parent_id_still_rejected(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """An exact-match request ID is NOT a child, so it rejects.

        A reconnect or duplicate call that carries the active
        parent's ID must surface the "another stream is
        active" error rather than silently passing through.
        Without this, a double-submit from a glitchy browser
        would race two completions into the same parent slot.
        """
        service._active_user_request = "parent-abc"
        result = await service.chat_streaming(
            request_id="parent-abc", message="hi"
        )
        assert "active" in result.get("error", "").lower()

    async def test_sibling_user_request_still_rejected(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Non-prefixed second request rejects — the pre-fix behaviour.

        Regression guard: narrowing the guard to user-only
        must not accidentally let a second genuine user
        stream through. Only prefixed child IDs pass.
        """
        service._active_user_request = "req-alpha"
        result = await service.chat_streaming(
            request_id="req-beta", message="hi"
        )
        assert "active" in result.get("error", "").lower()