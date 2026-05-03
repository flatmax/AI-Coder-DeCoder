"""Tests for ac_dc.context_manager — Layer 3.4.

Scope: the ContextManager plumbing — mode switching, history
ops, system prompt save/restore, URL/review context, stability
tracker and compactor attachment points, budget reporting,
emergency truncation, and pre-request file shedding.

Strategy:

- Construct with ``model_name`` only for most tests; attach a
  Repo-less FileContext. Tests that exercise file content pass
  ``add_file(path, content=...)`` directly rather than touching
  disk.
- Stability tracker and history compactor are tested with
  ``_FakeTracker`` / ``_FakeCompactor`` stubs. Layer 3.5 and 3.6
  define the real shapes; Layer 3.4 only needs the attachment
  point and a couple of defensive invocations.
- Token counting goes through the real :class:`TokenCounter`
  (tiktoken path). Tests assert on relative properties (bigger
  input → bigger count, shedding reduces file-context size)
  rather than exact values.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator

import pytest

from ac_dc.context_manager import (
    ContextManager,
    Mode,
)
from ac_dc.token_counter import TokenCounter


# ---------------------------------------------------------------------------
# Monkey-patch helper for max_input_tokens
# ---------------------------------------------------------------------------
#
# Several shedding tests need to clamp the counter's input budget to
# simulate budget pressure. Naively doing::
#
#     type(cm.counter).max_input_tokens = property(lambda self: 100)
#     try:
#         ...
#     finally:
#         del type(cm.counter).max_input_tokens
#
# looks innocuous but leaks catastrophically. The ``del`` strips the
# class-level property — including the original descriptor, because
# the assignment replaced it without saving a copy. Any subsequent
# test that reads ``counter.max_input_tokens`` then sees
# ``AttributeError``. Since pytest collects tests alphabetically,
# ``test_context_manager.py`` runs before ``test_token_counter.py``
# and the token-counter tests fail with a baffling "attribute
# doesn't exist" — even though the source clearly defines it.
#
# The helper below captures the original descriptor via
# ``TokenCounter.__dict__`` (which holds the real ``property``
# object, not the resolved value), installs the override, then
# restores the original on exit — whether or not the test raised.


@contextmanager
def _patch_max_input_tokens(
    counter: TokenCounter,
    value: int,
) -> Iterator[None]:
    """Temporarily clamp ``counter.max_input_tokens`` to ``value``.

    Replaces the class-level property for the duration of the
    ``with`` block. The original descriptor is captured before
    installation and restored on exit, so the patch never leaks
    into sibling tests.
    """
    cls = type(counter)
    # Capture the real descriptor (a ``property`` object), not the
    # int it resolves to. ``cls.__dict__`` gives the raw descriptor;
    # ``getattr(cls, ...)`` would invoke it on a fake instance.
    original = cls.__dict__.get("max_input_tokens")
    cls.max_input_tokens = property(lambda self: value)  # type: ignore[assignment]
    try:
        yield
    finally:
        if original is None:
            # No prior descriptor — remove the one we added.
            delattr(cls, "max_input_tokens")
        else:
            cls.max_input_tokens = original  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _FakeTracker:
    """Minimal stability-tracker stub.

    Layer 3.4 only calls ``purge_history`` (and only when clearing
    the history). Record invocations so tests can assert the call
    happened.
    """

    def __init__(self) -> None:
        self.purge_calls = 0

    def purge_history(self) -> None:
        self.purge_calls += 1


class _CompactorWithBoolCheck:
    """Compactor stub that takes the current history tokens.

    Used to verify :meth:`get_token_budget` forwards the token
    count and that ``needs_compaction`` reflects the compactor's
    decision.
    """

    trigger_tokens = 100

    def __init__(self, should_flag: bool) -> None:
        self._should_flag = should_flag
        self.last_call_tokens: int | None = None

    def should_compact(self, tokens: int) -> bool:
        self.last_call_tokens = tokens
        return self._should_flag


class _CompactorNoArgs:
    """Compactor whose ``should_compact`` takes no arguments.

    Exists to pin the fallback path in :meth:`_needs_compaction`
    — Layer 3.6's signature isn't frozen, so the context manager
    accepts either shape.
    """

    trigger_tokens = 50

    def __init__(self, should_flag: bool) -> None:
        self._should_flag = should_flag
        self.calls = 0

    def should_compact(self) -> bool:
        self.calls += 1
        return self._should_flag


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def cm() -> ContextManager:
    """Fresh context manager for each test, no repo."""
    return ContextManager(
        model_name="anthropic/claude-sonnet-4-5",
        system_prompt="You are a helpful assistant.",
    )


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------


class TestConstruction:
    """Basic initialisation — required args, optional args, defaults."""

    def test_requires_model_name(self) -> None:
        """Positional ``model_name`` is mandatory."""
        with pytest.raises(TypeError):
            ContextManager()  # type: ignore[call-arg]

    def test_model_accessor(self) -> None:
        """``model`` property returns the constructor arg verbatim."""
        cm = ContextManager(model_name="openai/gpt-4")
        assert cm.model == "openai/gpt-4"

    def test_default_mode_is_code(self) -> None:
        """Fresh context starts in code mode.

        Per specs4 — document mode is opt-in via an explicit
        toggle; the default for every session is code mode.
        """
        cm = ContextManager(model_name="openai/gpt-4")
        assert cm.mode == Mode.CODE

    def test_empty_system_prompt_by_default(self) -> None:
        """Default system prompt is empty; caller supplies it."""
        cm = ContextManager(model_name="openai/gpt-4")
        assert cm.get_system_prompt() == ""

    def test_initial_history_is_empty(self, cm: ContextManager) -> None:
        """History starts as an empty list."""
        assert cm.get_history() == []

    def test_no_tracker_attached_by_default(
        self, cm: ContextManager
    ) -> None:
        """Tracker attachment point starts None."""
        assert cm.stability_tracker is None

    def test_no_compactor_attached_by_default(
        self, cm: ContextManager
    ) -> None:
        """Compactor attachment point starts None."""
        assert cm.compactor is None

    def test_cache_target_tokens_stored(self) -> None:
        """Optional ``cache_target_tokens`` passed at construction
        is exposed via the property."""
        cm = ContextManager(
            model_name="anthropic/claude-sonnet-4-5",
            cache_target_tokens=1500,
        )
        assert cm.cache_target_tokens == 1500

    def test_cache_target_tokens_none_by_default(
        self, cm: ContextManager
    ) -> None:
        """Omitting the optional arg leaves the property None."""
        assert cm.cache_target_tokens is None

    def test_compaction_config_stored(self) -> None:
        """Compaction config dict is held for Layer 3.6 to read."""
        cfg = {"enabled": True, "trigger_tokens": 10000}
        cm = ContextManager(
            model_name="anthropic/claude-sonnet-4-5",
            compaction_config=cfg,
        )
        assert cm.compaction_config == cfg

    def test_compaction_config_copied(self) -> None:
        """Construction stores a copy — caller mutation doesn't leak.

        Defense against a caller that passes a dict they plan to
        keep editing. The stored copy isolates us from that.
        """
        cfg = {"enabled": True, "trigger_tokens": 10000}
        cm = ContextManager(
            model_name="anthropic/claude-sonnet-4-5",
            compaction_config=cfg,
        )
        cfg["trigger_tokens"] = 999
        assert cm.compaction_config == {
            "enabled": True,
            "trigger_tokens": 10000,
        }

    def test_counter_reports_correct_model(
        self, cm: ContextManager
    ) -> None:
        """Attached token counter uses the same model identifier."""
        assert cm.counter.model == "anthropic/claude-sonnet-4-5"

    def test_file_context_accessible(
        self, cm: ContextManager
    ) -> None:
        """The attached file context is a fresh empty FileContext."""
        assert len(cm.file_context) == 0


# ---------------------------------------------------------------------------
# Mode
# ---------------------------------------------------------------------------


class TestMode:
    """Mode enum setter/getter."""

    def test_set_mode_accepts_enum(self, cm: ContextManager) -> None:
        """Setting via the enum changes the mode."""
        cm.set_mode(Mode.DOC)
        assert cm.mode == Mode.DOC

    def test_set_mode_accepts_string(
        self, cm: ContextManager
    ) -> None:
        """Setting via string works too — wire-format friendliness.

        The RPC layer receives mode as a string; the context
        manager shouldn't force callers to unwrap.
        """
        cm.set_mode("doc")
        assert cm.mode == Mode.DOC

    def test_set_mode_round_trip(self, cm: ContextManager) -> None:
        """Setting back to code works, same as any other switch."""
        cm.set_mode(Mode.DOC)
        cm.set_mode(Mode.CODE)
        assert cm.mode == Mode.CODE

    def test_set_mode_rejects_unknown(
        self, cm: ContextManager
    ) -> None:
        """Unknown string raises ValueError with a helpful message."""
        with pytest.raises(ValueError, match="Unknown mode"):
            cm.set_mode("not-a-mode")


# ---------------------------------------------------------------------------
# History — basic ops
# ---------------------------------------------------------------------------


class TestHistoryBasics:
    """add_message, add_exchange, get_history, set_history, clear."""

    def test_add_message_appends(self, cm: ContextManager) -> None:
        """Single message appended preserves role and content."""
        cm.add_message("user", "hello")
        hist = cm.get_history()
        assert hist == [{"role": "user", "content": "hello"}]

    def test_add_message_returns_dict(
        self, cm: ContextManager
    ) -> None:
        """Return value is the appended dict — callers can use it.

        Matches specs3 — callers occasionally attach IDs or
        timestamps directly to the returned dict. The context
        manager hands back the same reference it stored.
        """
        result = cm.add_message("user", "hi")
        # The returned dict is the same one in history.
        assert cm.get_history()[0] is result

    def test_add_message_with_system_event_flag(
        self, cm: ContextManager
    ) -> None:
        """system_event=True adds a flag field on the stored message."""
        cm.add_message("user", "Committed abc123", system_event=True)
        hist = cm.get_history()
        assert hist[0]["system_event"] is True
        assert hist[0]["role"] == "user"

    def test_add_message_without_system_event_omits_field(
        self, cm: ContextManager
    ) -> None:
        """Non-event messages don't carry the flag field at all."""
        cm.add_message("user", "normal")
        assert "system_event" not in cm.get_history()[0]

    def test_add_message_forwards_extra_kwargs(
        self, cm: ContextManager
    ) -> None:
        """Extra kwargs stash directly on the dict.

        Supports callers that want to attach ``files``,
        ``edit_results``, or ``image_refs`` for the history
        browser. Layer 3.4 doesn't interpret them — just stores.
        """
        cm.add_message("user", "hi", files=["a.py"])
        hist = cm.get_history()
        assert hist[0]["files"] == ["a.py"]

    def test_add_exchange_appends_pair(
        self, cm: ContextManager
    ) -> None:
        """add_exchange puts a user/assistant pair in order."""
        cm.add_exchange("hello", "hi there")
        hist = cm.get_history()
        assert len(hist) == 2
        assert hist[0] == {"role": "user", "content": "hello"}
        assert hist[1] == {"role": "assistant", "content": "hi there"}

    def test_get_history_returns_copy(
        self, cm: ContextManager
    ) -> None:
        """Mutating the returned list doesn't affect stored history.

        Callers often filter or slice the returned list. A live
        view would let those mutations accidentally drop messages.
        """
        cm.add_message("user", "hi")
        got = cm.get_history()
        got.append({"role": "user", "content": "fake"})
        assert len(cm.get_history()) == 1

    def test_set_history_replaces(self, cm: ContextManager) -> None:
        """set_history wipes and replaces the conversation."""
        cm.add_message("user", "old")
        cm.set_history(
            [
                {"role": "user", "content": "fresh"},
                {"role": "assistant", "content": "new"},
            ]
        )
        hist = cm.get_history()
        assert [m["content"] for m in hist] == ["fresh", "new"]

    def test_set_history_copies_messages(
        self, cm: ContextManager
    ) -> None:
        """Each message is shallow-copied — caller mutations don't leak.

        Someone doing ``msgs[0]['content'] = 'tampered'`` after
        calling set_history shouldn't corrupt our stored history.
        """
        input_list = [{"role": "user", "content": "original"}]
        cm.set_history(input_list)
        input_list[0]["content"] = "tampered"
        assert cm.get_history()[0]["content"] == "original"

    def test_clear_history_empties(self, cm: ContextManager) -> None:
        """Clear removes everything; subsequent read is empty."""
        cm.add_message("user", "will be cleared")
        cm.clear_history()
        assert cm.get_history() == []

    def test_history_token_count_empty_is_zero(
        self, cm: ContextManager
    ) -> None:
        """Empty history counts as zero tokens."""
        assert cm.history_token_count() == 0

    def test_history_token_count_positive_when_populated(
        self, cm: ContextManager
    ) -> None:
        """Any non-empty history produces a positive count."""
        cm.add_message("user", "hello world")
        assert cm.history_token_count() > 0

    def test_history_token_count_monotonic(
        self, cm: ContextManager
    ) -> None:
        """More content means more tokens — pinned as a property.

        Exact values depend on tiktoken; monotonicity is what
        budget decisions actually care about.
        """
        cm.add_message("user", "short")
        first = cm.history_token_count()
        cm.add_message("assistant", "a longer reply with more words")
        second = cm.history_token_count()
        assert second > first


# ---------------------------------------------------------------------------
# History — stability tracker interaction
# ---------------------------------------------------------------------------


class TestHistoryAndTracker:
    """clear_history invokes tracker.purge_history defensively."""

    def test_clear_calls_purge_when_tracker_attached(
        self, cm: ContextManager
    ) -> None:
        """Clearing history triggers tracker purge."""
        tracker = _FakeTracker()
        cm.set_stability_tracker(tracker)
        cm.add_message("user", "hi")
        cm.clear_history()
        assert tracker.purge_calls == 1

    def test_clear_without_tracker_is_ok(
        self, cm: ContextManager
    ) -> None:
        """No tracker attached — clear still works without errors."""
        cm.add_message("user", "hi")
        cm.clear_history()  # must not raise
        assert cm.get_history() == []

    def test_clear_with_tracker_missing_purge_is_ok(
        self, cm: ContextManager
    ) -> None:
        """Tracker without purge_history method — no-op, no error.

        Defensive: Layer 3.5's tracker API isn't frozen; if an
        older or simpler tracker is attached it shouldn't break
        history clearing.
        """
        class _MinimalTracker:
            pass

        cm.set_stability_tracker(_MinimalTracker())
        cm.add_message("user", "hi")
        cm.clear_history()
        assert cm.get_history() == []


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------


class TestSystemPrompt:
    """Plain set/get plus save/restore for review mode."""

    def test_set_replaces(self, cm: ContextManager) -> None:
        """Setting a new prompt replaces the old one."""
        cm.set_system_prompt("new")
        assert cm.get_system_prompt() == "new"

    def test_set_does_not_save(self, cm: ContextManager) -> None:
        """Plain set doesn't save; restore with no save fails.

        Distinct from save_and_replace — callers that want to
        restore later must opt in.
        """
        original = cm.get_system_prompt()
        cm.set_system_prompt("new")
        restored = cm.restore_system_prompt()
        # Nothing was saved, so restore is a no-op.
        assert restored is False
        assert cm.get_system_prompt() == "new"
        assert original != "new"  # sanity

    def test_save_and_replace_stores_original(
        self, cm: ContextManager
    ) -> None:
        """save_and_replace puts the old prompt in the saved slot."""
        original = cm.get_system_prompt()
        cm.save_and_replace_system_prompt("review-mode")
        assert cm.get_system_prompt() == "review-mode"
        cm.restore_system_prompt()
        assert cm.get_system_prompt() == original

    def test_restore_returns_true_on_success(
        self, cm: ContextManager
    ) -> None:
        """Successful restore returns True."""
        cm.save_and_replace_system_prompt("review")
        assert cm.restore_system_prompt() is True

    def test_restore_returns_false_when_no_save(
        self, cm: ContextManager
    ) -> None:
        """Restore with nothing saved returns False."""
        assert cm.restore_system_prompt() is False

    def test_restore_clears_saved_slot(
        self, cm: ContextManager
    ) -> None:
        """After a successful restore, the saved slot is empty.

        A second restore without another save is a no-op.
        """
        cm.save_and_replace_system_prompt("review")
        cm.restore_system_prompt()
        assert cm.restore_system_prompt() is False

    def test_double_save_overwrites(
        self, cm: ContextManager
    ) -> None:
        """Saving twice before restore keeps the most recent "original".

        If the user enters review, enters doc mode while still in
        review (edge case but possible), then exits — they should
        return to the most recent "original" state, not a stale
        pre-review copy.
        """
        cm.set_system_prompt("state-A")
        cm.save_and_replace_system_prompt("state-B")
        cm.save_and_replace_system_prompt("state-C")
        cm.restore_system_prompt()
        # Restored to state-B (the most recent save), not state-A.
        assert cm.get_system_prompt() == "state-B"


# ---------------------------------------------------------------------------
# URL context
# ---------------------------------------------------------------------------


class TestUrlContext:
    """Set / clear / get for URL context parts."""

    def test_empty_by_default(self, cm: ContextManager) -> None:
        """Fresh context has no URL parts."""
        assert cm.get_url_context() == []

    def test_set_stores_parts(self, cm: ContextManager) -> None:
        """A list of parts is stored for downstream assembly."""
        cm.set_url_context(["url1 content", "url2 content"])
        assert cm.get_url_context() == ["url1 content", "url2 content"]

    def test_set_none_clears(self, cm: ContextManager) -> None:
        """None input clears the URL context.

        Matches specs — "empty or null input clears the context".
        """
        cm.set_url_context(["something"])
        cm.set_url_context(None)
        assert cm.get_url_context() == []

    def test_set_empty_list_clears(self, cm: ContextManager) -> None:
        """Empty list is semantically the same as None."""
        cm.set_url_context(["something"])
        cm.set_url_context([])
        assert cm.get_url_context() == []

    def test_clear_method(self, cm: ContextManager) -> None:
        """Explicit clear_url_context() empties the context."""
        cm.set_url_context(["a", "b"])
        cm.clear_url_context()
        assert cm.get_url_context() == []

    def test_get_returns_copy(self, cm: ContextManager) -> None:
        """Returned list is a copy — caller mutation is safe."""
        cm.set_url_context(["a"])
        got = cm.get_url_context()
        got.append("b")
        assert cm.get_url_context() == ["a"]

    def test_set_copies_input(self, cm: ContextManager) -> None:
        """Stored list is a copy of the caller's input."""
        inp = ["a", "b"]
        cm.set_url_context(inp)
        inp.append("c")
        assert cm.get_url_context() == ["a", "b"]


# ---------------------------------------------------------------------------
# Review context
# ---------------------------------------------------------------------------


class TestReviewContext:
    """Set / clear / get for review context."""

    def test_none_by_default(self, cm: ContextManager) -> None:
        """Fresh context has no review context."""
        assert cm.get_review_context() is None

    def test_set_stores(self, cm: ContextManager) -> None:
        """A string is stored verbatim."""
        cm.set_review_context("review block")
        assert cm.get_review_context() == "review block"

    def test_set_none_clears(self, cm: ContextManager) -> None:
        """None input clears the review context."""
        cm.set_review_context("something")
        cm.set_review_context(None)
        assert cm.get_review_context() is None

    def test_set_empty_string_clears(
        self, cm: ContextManager
    ) -> None:
        """Empty string clears — no point injecting blank content."""
        cm.set_review_context("something")
        cm.set_review_context("")
        assert cm.get_review_context() is None

    def test_clear_method(self, cm: ContextManager) -> None:
        """Explicit clear_review_context() empties the context."""
        cm.set_review_context("a")
        cm.clear_review_context()
        assert cm.get_review_context() is None


# ---------------------------------------------------------------------------
# Attachment points
# ---------------------------------------------------------------------------


class TestAttachmentPoints:
    """Stability tracker and compactor attach/detach."""

    def test_attach_tracker(self, cm: ContextManager) -> None:
        """set_stability_tracker installs the instance."""
        tracker = _FakeTracker()
        cm.set_stability_tracker(tracker)
        assert cm.stability_tracker is tracker

    def test_replace_tracker(self, cm: ContextManager) -> None:
        """Setting a different tracker replaces the previous one.

        Used during mode switching — each mode has its own
        tracker instance and the switch just points at the
        correct one.
        """
        a = _FakeTracker()
        b = _FakeTracker()
        cm.set_stability_tracker(a)
        cm.set_stability_tracker(b)
        assert cm.stability_tracker is b

    def test_detach_tracker(self, cm: ContextManager) -> None:
        """Setting None detaches — useful for tests / reset paths."""
        cm.set_stability_tracker(_FakeTracker())
        cm.set_stability_tracker(None)
        assert cm.stability_tracker is None

    def test_attach_compactor(self, cm: ContextManager) -> None:
        """set_compactor installs the instance."""
        compactor = _CompactorWithBoolCheck(should_flag=False)
        cm.set_compactor(compactor)
        assert cm.compactor is compactor


# ---------------------------------------------------------------------------
# Token budget reporting
# ---------------------------------------------------------------------------


class TestTokenBudget:
    """get_token_budget and get_compaction_status snapshots."""

    def test_budget_fields_present(self, cm: ContextManager) -> None:
        """get_token_budget returns all documented fields."""
        budget = cm.get_token_budget()
        assert set(budget.keys()) == {
            "history_tokens",
            "max_history_tokens",
            "max_input_tokens",
            "remaining",
            "needs_compaction",
        }

    def test_budget_history_matches_count(
        self, cm: ContextManager
    ) -> None:
        """history_tokens field matches history_token_count()."""
        cm.add_message("user", "hello world")
        expected = cm.history_token_count()
        assert cm.get_token_budget()["history_tokens"] == expected

    def test_budget_remaining_nonnegative(
        self, cm: ContextManager
    ) -> None:
        """remaining is floored at zero, never negative."""
        # On a 1M-context model, even a big history doesn't exhaust
        # the budget. Just assert the floor holds for empty.
        assert cm.get_token_budget()["remaining"] >= 0

    def test_budget_needs_compaction_false_without_compactor(
        self, cm: ContextManager
    ) -> None:
        """No compactor attached → needs_compaction is False."""
        cm.add_message("user", "a" * 5000)
        assert cm.get_token_budget()["needs_compaction"] is False

    def test_budget_needs_compaction_delegates_to_compactor(
        self, cm: ContextManager
    ) -> None:
        """Compactor's should_compact drives the flag."""
        compactor = _CompactorWithBoolCheck(should_flag=True)
        cm.set_compactor(compactor)
        assert cm.get_token_budget()["needs_compaction"] is True

    def test_budget_passes_tokens_to_compactor(
        self, cm: ContextManager
    ) -> None:
        """Compactor receives the current history token count."""
        cm.add_message("user", "hi")
        compactor = _CompactorWithBoolCheck(should_flag=False)
        cm.set_compactor(compactor)
        cm.get_token_budget()
        assert compactor.last_call_tokens == cm.history_token_count()

    def test_budget_falls_back_to_zero_arg_compactor(
        self, cm: ContextManager
    ) -> None:
        """Compactor whose should_compact takes no args also works.

        Layer 3.6's exact signature isn't pinned yet. The context
        manager probes with an argument first, falls back to
        zero-arg on TypeError. Either way the result surfaces.
        """
        compactor = _CompactorNoArgs(should_flag=True)
        cm.set_compactor(compactor)
        assert cm.get_token_budget()["needs_compaction"] is True
        assert compactor.calls == 1

    def test_compaction_status_disabled_without_compactor(
        self, cm: ContextManager
    ) -> None:
        """Without a compactor, status reports disabled with zeros."""
        status = cm.get_compaction_status()
        assert status["enabled"] is False
        assert status["trigger_tokens"] == 0
        assert status["percent"] == 0

    def test_compaction_status_enabled_with_compactor(
        self, cm: ContextManager
    ) -> None:
        """Attached compactor exposes its trigger in the status."""
        compactor = _CompactorWithBoolCheck(should_flag=False)
        cm.set_compactor(compactor)
        status = cm.get_compaction_status()
        assert status["enabled"] is True
        assert status["trigger_tokens"] == compactor.trigger_tokens

    def test_compaction_status_current_tokens_reflects_history(
        self, cm: ContextManager
    ) -> None:
        """current_tokens tracks the current history count."""
        cm.add_message("user", "some content")
        status = cm.get_compaction_status()
        assert status["current_tokens"] == cm.history_token_count()

    def test_compaction_status_percent_computed(
        self, cm: ContextManager
    ) -> None:
        """percent = current/trigger * 100, rounded.

        Set up a compactor with a tiny trigger and push enough
        history past it to exercise the math without relying on
        exact token counts.
        """
        compactor = _CompactorWithBoolCheck(should_flag=False)
        compactor.trigger_tokens = 10
        cm.set_compactor(compactor)
        # Force a big history.
        for _ in range(20):
            cm.add_message("user", "some content here")
        status = cm.get_compaction_status()
        # At least 100% — we've exceeded the tiny trigger.
        assert status["percent"] >= 100
        # And capped at 999 to keep UI display sane.
        assert status["percent"] <= 999

    def test_compaction_status_zero_trigger_safe(
        self, cm: ContextManager
    ) -> None:
        """Zero trigger doesn't divide by zero; percent stays 0."""
        compactor = _CompactorWithBoolCheck(should_flag=False)
        compactor.trigger_tokens = 0
        cm.set_compactor(compactor)
        cm.add_message("user", "hi")
        assert cm.get_compaction_status()["percent"] == 0


# ---------------------------------------------------------------------------
# Emergency truncation
# ---------------------------------------------------------------------------


class TestEmergencyTruncate:
    """Layer-2 safety net dropping oldest messages on overflow."""

    def test_no_op_on_small_history(
        self, cm: ContextManager
    ) -> None:
        """History under the trigger isn't touched."""
        cm.add_message("user", "hi")
        dropped = cm.emergency_truncate(trigger_tokens=10_000)
        assert dropped == 0
        assert len(cm.get_history()) == 1

    def test_drops_oldest_first(self, cm: ContextManager) -> None:
        """Truncation removes messages from the front."""
        # Build up a sizeable history.
        for i in range(30):
            cm.add_message("user", f"message {i} with some content")
        before = len(cm.get_history())
        # Force drop to a small trigger.
        dropped = cm.emergency_truncate(trigger_tokens=10)
        after = len(cm.get_history())
        assert dropped > 0
        assert after < before
        # Earlier messages are gone; later ones remain.
        first_surviving = cm.get_history()[0]["content"]
        assert "message 0" not in first_surviving

    def test_returns_count_of_dropped(
        self, cm: ContextManager
    ) -> None:
        """Return value matches how many entries were removed."""
        for i in range(10):
            cm.add_message("user", f"msg {i} " * 20)
        before = len(cm.get_history())
        dropped = cm.emergency_truncate(trigger_tokens=50)
        after = len(cm.get_history())
        assert dropped == before - after

    def test_zero_trigger_is_safe(self, cm: ContextManager) -> None:
        """Zero trigger short-circuits — never strips history."""
        cm.add_message("user", "hi")
        dropped = cm.emergency_truncate(trigger_tokens=0)
        assert dropped == 0

    def test_empty_history_returns_zero(
        self, cm: ContextManager
    ) -> None:
        """No messages → nothing to drop."""
        assert cm.emergency_truncate(trigger_tokens=10) == 0


# ---------------------------------------------------------------------------
# Pre-request shedding
# ---------------------------------------------------------------------------


class TestEstimateAndShed:
    """Layer-3 shedding — drops largest files under budget pressure."""

    def test_estimate_empty_has_floor(
        self, cm: ContextManager
    ) -> None:
        """Empty context still produces a positive estimate.

        The fixed overhead constant means the estimate is always
        positive, even for a completely empty context.
        """
        assert cm.estimate_request_tokens() > 0

    def test_estimate_grows_with_history(
        self, cm: ContextManager
    ) -> None:
        """Adding history increases the estimate."""
        baseline = cm.estimate_request_tokens()
        cm.add_message("user", "a" * 500)
        assert cm.estimate_request_tokens() > baseline

    def test_estimate_grows_with_files(
        self, cm: ContextManager
    ) -> None:
        """Adding files increases the estimate."""
        baseline = cm.estimate_request_tokens()
        cm.file_context.add_file("big.py", "x = 1\n" * 2000)
        assert cm.estimate_request_tokens() > baseline

    def test_estimate_includes_user_prompt(
        self, cm: ContextManager
    ) -> None:
        """Passing a user prompt adds its tokens to the estimate."""
        without = cm.estimate_request_tokens()
        with_prompt = cm.estimate_request_tokens("hello " * 100)
        assert with_prompt > without

    def test_shed_no_op_under_ceiling(
        self, cm: ContextManager
    ) -> None:
        """Small context → no files shed.

        Even a modest file sits far under the 90% ceiling of a
        1M-token model's input budget.
        """
        cm.file_context.add_file("small.py", "x = 1\n")
        dropped = cm.shed_files_if_needed()
        assert dropped == []
        assert cm.file_context.has_file("small.py")

    def test_shed_drops_largest_first(
        self, cm: ContextManager
    ) -> None:
        """When shedding is needed, largest file goes first.

        Construct a scenario where two files are both present
        but only one is truly large. Simulate budget pressure
        by monkey-patching the counter's max_input_tokens to a
        small value.

        Uses the ``_patch_max_input_tokens`` helper to save and
        restore the original descriptor — a bare ``del`` would
        permanently strip the class attribute, breaking every
        later test that reads the property.
        """
        cm.file_context.add_file("small.py", "x = 1\n")
        # Put enough content in 'large.py' to dominate.
        cm.file_context.add_file("large.py", "y = 2\n" * 4000)
        with _patch_max_input_tokens(cm.counter, 100):
            dropped = cm.shed_files_if_needed()
        # Largest file dropped first.
        assert "large.py" in dropped

    def test_shed_returns_empty_when_nothing_to_drop(
        self, cm: ContextManager
    ) -> None:
        """Shedding returns empty list when file context is empty.

        Even under extreme simulated budget pressure, no files
        means nothing to drop — the loop bails cleanly.
        """
        # Zero files, big history (but history isn't shed).
        cm.add_message("user", "long content " * 200)
        with _patch_max_input_tokens(cm.counter, 50):
            dropped = cm.shed_files_if_needed()
        assert dropped == []

    def test_shed_stops_once_under_ceiling(
        self, cm: ContextManager
    ) -> None:
        """Shedding loop exits as soon as the estimate fits.

        Add several files of different sizes and verify that not
        all of them get dropped — at least one small file should
        survive once the estimate drops below the ceiling.
        """
        cm.file_context.add_file("small.py", "a = 1\n")
        cm.file_context.add_file("medium.py", "b = 2\n" * 50)
        cm.file_context.add_file("large.py", "c = 3\n" * 4000)
        with _patch_max_input_tokens(cm.counter, 1000):
            dropped = cm.shed_files_if_needed()
        # Large file definitely dropped.
        assert "large.py" in dropped
        # Small file should survive.
        assert cm.file_context.has_file("small.py")


# ---------------------------------------------------------------------------
# Turn ID and archival sink — Slice 4 of parallel-agents foundation
# ---------------------------------------------------------------------------


class _RecordingSink:
    """Captures every archival-sink invocation for assertions.

    Mimics the shape of the closure the LLMService will build
    around ``HistoryStore.append_agent_message`` — accepts
    arbitrary keyword arguments and records them. Tests inspect
    the ``calls`` list to verify ordering, per-message payload
    contents, and that the sink fired at all.
    """

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def __call__(self, **kwargs: Any) -> None:
        self.calls.append(dict(kwargs))


class _BrokenSink:
    """Sink that always raises — for exception-isolation tests.

    A production sink could raise from disk full, permission
    denied, serialisation failure, or a bug in the closure that
    wraps ``HistoryStore``. The ContextManager must isolate those
    failures so a broken sink doesn't corrupt the in-memory
    conversation or leak exceptions into the streaming pipeline.
    """

    def __init__(self) -> None:
        self.call_count = 0

    def __call__(self, **kwargs: Any) -> None:
        self.call_count += 1
        raise RuntimeError("simulated sink failure")


class TestTurnIdAndArchivalSink:
    """Agent-scoped plumbing — turn_id propagation + archival sink.

    Pins the Slice 4 contract from
    ``specs4/7-future/parallel-agents.md`` § Turn ID
    Propagation. The main user-facing ContextManager leaves
    these fields None (its records flow through the main history
    store via a different path); agent ContextManagers receive
    both so every per-agent record carries its parent turn's ID
    and lands in ``.ac-dc4/agents/{turn_id}/agent-NN.jsonl``.
    """

    def test_turn_id_defaults_none(
        self, cm: ContextManager
    ) -> None:
        """Main-LLM ContextManager has no turn_id."""
        assert cm.turn_id is None

    def test_archival_sink_defaults_none(
        self, cm: ContextManager
    ) -> None:
        """Main-LLM ContextManager has no archival sink."""
        assert cm.archival_sink is None

    def test_turn_id_stored_from_constructor(self) -> None:
        """Agent ContextManager exposes the turn_id it was built with."""
        cm = ContextManager(
            model_name="anthropic/claude-sonnet-4-5",
            turn_id="turn_1234567890_abc123",
        )
        assert cm.turn_id == "turn_1234567890_abc123"

    def test_archival_sink_stored_from_constructor(self) -> None:
        """Agent ContextManager exposes the sink it was built with."""
        sink = _RecordingSink()
        cm = ContextManager(
            model_name="anthropic/claude-sonnet-4-5",
            archival_sink=sink,
        )
        assert cm.archival_sink is sink

    def test_add_message_invokes_sink(self) -> None:
        """Each add_message call fires the sink once.

        Pins the per-message invocation contract — callers should
        see one sink call per message, not batched.
        """
        sink = _RecordingSink()
        cm = ContextManager(
            model_name="anthropic/claude-sonnet-4-5",
            turn_id="turn_1_abc",
            archival_sink=sink,
        )
        cm.add_message("user", "hello")
        cm.add_message("assistant", "hi there")
        assert len(sink.calls) == 2

    def test_add_message_payload_shape(self) -> None:
        """Sink receives role, content, system_event keyword args.

        The shape matches ``HistoryStore.append_agent_message``
        minus ``turn_id`` and ``agent_idx`` which the sink's
        closure supplies. Pinning the kwarg names protects the
        LLMService's closure code from a silent contract break.
        """
        sink = _RecordingSink()
        cm = ContextManager(
            model_name="anthropic/claude-sonnet-4-5",
            turn_id="turn_1_abc",
            archival_sink=sink,
        )
        cm.add_message("user", "hello")
        call = sink.calls[0]
        assert call["role"] == "user"
        assert call["content"] == "hello"
        assert call["system_event"] is False

    def test_add_message_system_event_forwarded(self) -> None:
        """system_event=True propagates to the sink."""
        sink = _RecordingSink()
        cm = ContextManager(
            model_name="anthropic/claude-sonnet-4-5",
            archival_sink=sink,
        )
        cm.add_message(
            "user", "Committed abc123", system_event=True
        )
        assert sink.calls[0]["system_event"] is True

    def test_add_message_extras_forwarded(self) -> None:
        """Arbitrary extra kwargs forward to the sink.

        Matches the stash-on-the-dict behaviour of add_message
        itself — files, edit_results, image_refs all reach the
        sink verbatim so the per-agent JSONL records carry the
        same metadata as the main store's records would.
        """
        sink = _RecordingSink()
        cm = ContextManager(
            model_name="anthropic/claude-sonnet-4-5",
            archival_sink=sink,
        )
        cm.add_message(
            "assistant",
            "done",
            files_modified=["src/foo.py"],
            edit_results=[{"file": "src/foo.py", "status": "applied"}],
        )
        call = sink.calls[0]
        assert call["files_modified"] == ["src/foo.py"]
        assert call["edit_results"][0]["status"] == "applied"

    def test_add_message_without_sink_is_noop(
        self, cm: ContextManager
    ) -> None:
        """No sink attached → add_message still works, no crash.

        The main ContextManager runs without a sink every day;
        this test pins that the sink call site handles the
        None case without raising or special-casing.
        """
        cm.add_message("user", "hi")
        assert len(cm.get_history()) == 1

    def test_add_exchange_fires_sink_twice(self) -> None:
        """add_exchange invokes the sink for user then assistant.

        Session restore and other atomic-pair callers use
        add_exchange; the sink must see both records so the
        per-agent archive stays consistent with in-memory state.
        """
        sink = _RecordingSink()
        cm = ContextManager(
            model_name="anthropic/claude-sonnet-4-5",
            turn_id="turn_1_abc",
            archival_sink=sink,
        )
        cm.add_exchange("question", "answer")
        assert len(sink.calls) == 2
        assert sink.calls[0]["role"] == "user"
        assert sink.calls[0]["content"] == "question"
        assert sink.calls[1]["role"] == "assistant"
        assert sink.calls[1]["content"] == "answer"

    def test_sink_fires_after_history_append(self) -> None:
        """In-memory history is updated before the sink runs.

        Critical: a sink that reads back from the context
        manager during its invocation must see the just-appended
        message. If the order were reversed, the sink would see
        stale history (or worse, could race with a concurrent
        reader). We pin the order by having the sink check
        history length during its call.
        """
        history_sizes_seen: list[int] = []

        def _observing_sink(**kwargs: Any) -> None:
            history_sizes_seen.append(len(cm.get_history()))

        cm = ContextManager(
            model_name="anthropic/claude-sonnet-4-5",
            archival_sink=_observing_sink,
        )
        cm.add_message("user", "first")
        cm.add_message("assistant", "second")
        # Sink saw 1 entry after first append, 2 after second.
        assert history_sizes_seen == [1, 2]

    def test_sink_exception_does_not_propagate(self) -> None:
        """Sink raises → add_message returns normally.

        A failing sink must not break the in-memory conversation.
        Matches the defensive discipline on
        :meth:`_purge_tracker_history` and repo post-write
        callbacks.
        """
        sink = _BrokenSink()
        cm = ContextManager(
            model_name="anthropic/claude-sonnet-4-5",
            archival_sink=sink,
        )
        # Must not raise.
        cm.add_message("user", "hi")
        # History was still updated.
        assert len(cm.get_history()) == 1
        # Sink was still called.
        assert sink.call_count == 1

    def test_sink_exception_does_not_prevent_history_append(
        self,
    ) -> None:
        """Broken sink leaves in-memory history intact.

        Belt-and-braces over the previous test: pin that the
        history append happens BEFORE the sink fires, so a
        sink exception can never leave us with a message the
        caller thinks was stored but isn't.
        """
        sink = _BrokenSink()
        cm = ContextManager(
            model_name="anthropic/claude-sonnet-4-5",
            archival_sink=sink,
        )
        returned = cm.add_message("user", "survives")
        # Message is in history.
        assert cm.get_history() == [returned]
        # And was returned to the caller.
        assert returned["content"] == "survives"

    def test_sink_exception_logged(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Broken sink produces a WARNING log entry.

        Operators need a signal when sinks fail — silent
        swallowing would hide a broken agent archive
        indefinitely.
        """
        sink = _BrokenSink()
        cm = ContextManager(
            model_name="anthropic/claude-sonnet-4-5",
            turn_id="turn_diag_xyz",
            archival_sink=sink,
        )
        with caplog.at_level("WARNING", logger="ac_dc.context_manager"):
            cm.add_message("user", "hi")
        # At least one WARNING mentioning the turn_id.
        warnings = [
            r for r in caplog.records
            if r.levelname == "WARNING"
        ]
        assert warnings
        assert any(
            "turn_diag_xyz" in r.getMessage() for r in warnings
        )

    def test_turn_id_is_read_only(self) -> None:
        """No public setter for turn_id.

        Turn ID is set once at construction and never changes —
        it's the agent's identity. A setter would invite bugs
        where a running agent's turn ID drifts mid-execution.
        """
        cm = ContextManager(
            model_name="anthropic/claude-sonnet-4-5",
            turn_id="turn_1_abc",
        )
        with pytest.raises(AttributeError):
            cm.turn_id = "turn_2_def"  # type: ignore[misc]

    def test_archival_sink_is_read_only(self) -> None:
        """No public setter for archival_sink.

        Sink is set once at construction. Swapping mid-session
        would mean messages written with the old sink would be
        orphaned in a different archive from the new sink's
        target.
        """
        cm = ContextManager(
            model_name="anthropic/claude-sonnet-4-5",
            archival_sink=_RecordingSink(),
        )
        with pytest.raises(AttributeError):
            cm.archival_sink = _RecordingSink()  # type: ignore[misc]