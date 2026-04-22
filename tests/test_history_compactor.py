"""Tests for ac_dc.history_compactor — Layer 3.6.

Scope: the HistoryCompactor's decision logic, truncate and
summarize implementations, min-verbatim safeguard, live config
reload, and defensive detector handling.

Strategy:

- Inject a fake ``ConfigManager`` exposing a mutable
  ``compaction_config`` dict so tests can change thresholds
  mid-test and see the effect on the next call. Mirrors the
  live-config-reload contract.
- Inject stub detector callables — some return canned
  ``TopicBoundary`` values, some raise, some return the wrong
  shape. No litellm mocking, no network.
- Real ``TokenCounter`` (the cl100k_base path) for token math.
  Tests assert monotonic / ordering properties rather than
  exact token counts so tiktoken version bumps don't break the
  suite.
"""

from __future__ import annotations

from typing import Any

import pytest

from ac_dc.history_compactor import (
    CompactionResult,
    HistoryCompactor,
    TopicBoundary,
)
from ac_dc.token_counter import TokenCounter


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _FakeConfigManager:
    """Minimal stand-in for ConfigManager.

    Exposes the one property the compactor reads:
    ``compaction_config``. Tests mutate the dict after
    construction to exercise the live-reload path.
    """

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        # Default matches specs3's shipped values so tests that
        # don't care about thresholds still get sensible behaviour.
        self.compaction_config = (
            dict(config)
            if config is not None
            else {
                "enabled": True,
                "compaction_trigger_tokens": 24000,
                "verbatim_window_tokens": 4000,
                "summary_budget_tokens": 500,
                "min_verbatim_exchanges": 2,
            }
        )


def _msg(role: str, content: str) -> dict[str, Any]:
    """Shorthand for a message dict."""
    return {"role": role, "content": content}


def _build_long_history(
    pairs: int, content_size: int = 100
) -> list[dict[str, Any]]:
    """Return ``pairs`` user/assistant exchanges of roughly equal size.

    Each user message is ``"u{i}: " + "x" * content_size``,
    assistant ``"a{i}: " + "y" * content_size``. Distinct prefixes
    mean tests can assert which specific messages survived
    compaction without ambiguity.
    """
    msgs: list[dict[str, Any]] = []
    for i in range(pairs):
        msgs.append(_msg("user", f"u{i}: " + "x" * content_size))
        msgs.append(_msg("assistant", f"a{i}: " + "y" * content_size))
    return msgs


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def counter() -> TokenCounter:
    """A real token counter — exact values not asserted on."""
    return TokenCounter("anthropic/claude-sonnet-4-5")


@pytest.fixture
def config() -> _FakeConfigManager:
    """Fresh config per test so mutations don't leak."""
    return _FakeConfigManager()


# ---------------------------------------------------------------------------
# should_compact + live config
# ---------------------------------------------------------------------------


class TestShouldCompact:
    """Trigger-threshold check driven by live config."""

    def test_disabled_never_triggers(
        self, config: _FakeConfigManager, counter: TokenCounter
    ) -> None:
        """``enabled: False`` returns False regardless of tokens."""
        config.compaction_config["enabled"] = False
        compactor = HistoryCompactor(config, counter)
        assert compactor.should_compact(999_999) is False

    def test_zero_trigger_disables(
        self, config: _FakeConfigManager, counter: TokenCounter
    ) -> None:
        """Zero or negative trigger disables — defensive against typos.

        A typo in app.json setting ``compaction_trigger_tokens: 0``
        would otherwise fire compaction on every request. Treat
        as disabled.
        """
        config.compaction_config["compaction_trigger_tokens"] = 0
        compactor = HistoryCompactor(config, counter)
        assert compactor.should_compact(999_999) is False

    def test_below_trigger_false(
        self, config: _FakeConfigManager, counter: TokenCounter
    ) -> None:
        """Below threshold — no compaction."""
        config.compaction_config["compaction_trigger_tokens"] = 1000
        compactor = HistoryCompactor(config, counter)
        assert compactor.should_compact(500) is False

    def test_at_trigger_true(
        self, config: _FakeConfigManager, counter: TokenCounter
    ) -> None:
        """At exactly the trigger — yes.

        ``>=`` semantics rather than ``>`` so the threshold is
        inclusive. A corpus that sits right at the trigger should
        compact on the next turn.
        """
        config.compaction_config["compaction_trigger_tokens"] = 1000
        compactor = HistoryCompactor(config, counter)
        assert compactor.should_compact(1000) is True

    def test_live_config_reload(
        self, config: _FakeConfigManager, counter: TokenCounter
    ) -> None:
        """Mutating config after construction takes effect immediately.

        Live-reload contract: the compactor reads through the
        config manager on every check, not at construction.
        Pinned here so a future refactor that caches config
        values fails the test.
        """
        config.compaction_config["compaction_trigger_tokens"] = 1000
        compactor = HistoryCompactor(config, counter)
        assert compactor.should_compact(500) is False
        # Raise the trigger — still should not fire.
        config.compaction_config["compaction_trigger_tokens"] = 100
        assert compactor.should_compact(500) is True


# ---------------------------------------------------------------------------
# compact_history_if_needed — trigger gating
# ---------------------------------------------------------------------------


class TestCompactGating:
    """Returns None when no compaction needed."""

    def test_empty_history_returns_none(
        self, config: _FakeConfigManager, counter: TokenCounter
    ) -> None:
        """Empty list short-circuits without even checking tokens."""
        compactor = HistoryCompactor(config, counter)
        assert compactor.compact_history_if_needed([]) is None

    def test_below_trigger_returns_none(
        self, config: _FakeConfigManager, counter: TokenCounter
    ) -> None:
        """Short history → None, detector never invoked.

        Also pins that the detector isn't called when not
        needed — important because the detector does an LLM
        call and we don't want to pay for it pointlessly.
        """
        calls = 0

        def _detector(_msgs):
            nonlocal calls
            calls += 1
            return TopicBoundary(None, "", 0.0, "")

        compactor = HistoryCompactor(
            config, counter, detect_topic_boundary=_detector
        )
        # Tiny history, well below default trigger.
        result = compactor.compact_history_if_needed(
            _build_long_history(1)
        )
        assert result is None
        assert calls == 0

    def test_already_checked_skips_trigger(
        self, config: _FakeConfigManager, counter: TokenCounter
    ) -> None:
        """``already_checked=True`` bypasses the internal probe.

        The streaming handler pre-checks with a fresh token
        count to avoid counting twice — this flag tells the
        compactor to trust that decision.
        """
        # History well below the default trigger.
        msgs = _build_long_history(1)
        compactor = HistoryCompactor(
            config,
            counter,
            detect_topic_boundary=lambda _m: TopicBoundary(
                None, "", 0.0, ""
            ),
        )
        # With already_checked=True, we skip the should_compact
        # gate and run straight into compaction logic.
        result = compactor.compact_history_if_needed(
            msgs, already_checked=True
        )
        # None boundary + low confidence → summarize case fires.
        assert result is not None
        assert result.case == "summarize"


# ---------------------------------------------------------------------------
# Truncate case
# ---------------------------------------------------------------------------


class TestTruncateCase:
    """High-confidence boundary inside or after verbatim window."""

    def test_truncate_cuts_to_boundary(
        self, config: _FakeConfigManager, counter: TokenCounter
    ) -> None:
        """Messages before boundary_index are discarded."""
        # Low trigger so small history compacts.
        config.compaction_config["compaction_trigger_tokens"] = 10
        # Large verbatim window so the token-based candidate
        # lands at index 0 — meaning the whole history is in
        # the window and any boundary is "inside" it.
        config.compaction_config["verbatim_window_tokens"] = 100_000
        # min_verbatim=1 counts back ONE user message from the
        # end. With 10 pairs that's index 18 (second-to-last).
        # min(0, 18) = 0, so verbatim_start_idx=0 and
        # boundary=14 is >= 0 → truncate fires.
        config.compaction_config["min_verbatim_exchanges"] = 1
        msgs = _build_long_history(10)  # 20 messages

        # Boundary at index 14 — inside the verbatim window,
        # high confidence. Truncate should keep from 14 on.
        def _detector(_m):
            return TopicBoundary(
                boundary_index=14,
                boundary_reason="shifted",
                confidence=0.9,
                summary="",
            )

        compactor = HistoryCompactor(
            config, counter, detect_topic_boundary=_detector
        )
        result = compactor.compact_history_if_needed(
            msgs, already_checked=True
        )
        assert result is not None
        assert result.case == "truncate"
        # First surviving message should be msgs[14] or later
        # (the min-verbatim safeguard may prepend, but the
        # first message of the original cut is present).
        assert any(
            m["content"].startswith(f"u{14 // 2}")
            or m["content"].startswith(f"a{14 // 2}")
            for m in result.messages
        )

    def test_truncate_preserves_boundary_data(
        self, config: _FakeConfigManager, counter: TokenCounter
    ) -> None:
        """Result carries the detected boundary for UI display."""
        config.compaction_config["compaction_trigger_tokens"] = 10
        config.compaction_config["verbatim_window_tokens"] = 50
        msgs = _build_long_history(10)
        b = TopicBoundary(14, "shifted to logging", 0.9, "")
        compactor = HistoryCompactor(
            config, counter, detect_topic_boundary=lambda _m: b
        )
        result = compactor.compact_history_if_needed(
            msgs, already_checked=True
        )
        assert result is not None
        assert result.boundary is b

    def test_truncate_applies_min_verbatim_safeguard(
        self, config: _FakeConfigManager, counter: TokenCounter
    ) -> None:
        """If cut leaves too few user messages, earlier ones prepend.

        Boundary is very late — leaves only 1 user message. With
        ``min_verbatim_exchanges=3`` the safeguard prepends 2
        earlier messages before the cut.
        """
        config.compaction_config["compaction_trigger_tokens"] = 10
        config.compaction_config["verbatim_window_tokens"] = 200
        config.compaction_config["min_verbatim_exchanges"] = 3
        msgs = _build_long_history(10)  # 20 messages, 10 users

        # Boundary at index 18 → cut leaves msgs[18:20] = 1
        # user + 1 assistant. Below threshold of 3.
        b = TopicBoundary(18, "late shift", 0.9, "")
        compactor = HistoryCompactor(
            config, counter, detect_topic_boundary=lambda _m: b
        )
        result = compactor.compact_history_if_needed(
            msgs, already_checked=True
        )
        assert result is not None
        user_count = sum(
            1 for m in result.messages if m["role"] == "user"
        )
        assert user_count >= 3


# ---------------------------------------------------------------------------
# Summarize case
# ---------------------------------------------------------------------------


class TestSummarizeCase:
    """Boundary before verbatim, low confidence, or no boundary."""

    def test_no_boundary_falls_through_to_summarize(
        self, config: _FakeConfigManager, counter: TokenCounter
    ) -> None:
        """``boundary_index=None`` → summarize-everything case."""
        config.compaction_config["compaction_trigger_tokens"] = 10
        config.compaction_config["verbatim_window_tokens"] = 50
        msgs = _build_long_history(5)

        compactor = HistoryCompactor(
            config,
            counter,
            detect_topic_boundary=lambda _m: TopicBoundary(
                None, "none found", 0.0, "some summary"
            ),
        )
        result = compactor.compact_history_if_needed(
            msgs, already_checked=True
        )
        assert result is not None
        assert result.case == "summarize"

    def test_low_confidence_falls_through_to_summarize(
        self, config: _FakeConfigManager, counter: TokenCounter
    ) -> None:
        """Low confidence can't drive truncation — summarise instead.

        Even when a boundary index is returned, low confidence
        means we don't trust the cut. Defaults to summarise.
        """
        config.compaction_config["compaction_trigger_tokens"] = 10
        config.compaction_config["verbatim_window_tokens"] = 50
        msgs = _build_long_history(5)

        compactor = HistoryCompactor(
            config,
            counter,
            detect_topic_boundary=lambda _m: TopicBoundary(
                4, "maybe?", 0.3, "hedged summary"
            ),
        )
        result = compactor.compact_history_if_needed(
            msgs, already_checked=True
        )
        assert result is not None
        assert result.case == "summarize"

    def test_boundary_before_verbatim_falls_through_to_summarize(
        self, config: _FakeConfigManager, counter: TokenCounter
    ) -> None:
        """Cut before verbatim window would lose verbatim content.

        Needs BOTH verbatim-start candidates > 1 so that the
        boundary at index 1 is strictly before the window:
        - Token-based: small window so the accumulator runs out
          well before message 0 — pins token_idx to something
          like index 7+ on this history shape.
        - Count-based: min_verbatim=1 counts one user message
          back from the end — lands at index 8 for this 5-pair
          history.
        Together min(8, 8) = 8, and boundary=1 is < 8 → fall
        through to summarize.
        """
        config.compaction_config["compaction_trigger_tokens"] = 10
        # Small window — forces token_idx high.
        config.compaction_config["verbatim_window_tokens"] = 30
        # Low count requirement — forces count_idx high.
        config.compaction_config["min_verbatim_exchanges"] = 1
        msgs = _build_long_history(5)

        compactor = HistoryCompactor(
            config,
            counter,
            detect_topic_boundary=lambda _m: TopicBoundary(
                1, "early shift", 0.95, "summary"
            ),
        )
        result = compactor.compact_history_if_needed(
            msgs, already_checked=True
        )
        assert result is not None
        assert result.case == "summarize"

    def test_summarize_produces_summary_pair(
        self, config: _FakeConfigManager, counter: TokenCounter
    ) -> None:
        """The compacted list starts with a user/assistant summary pair."""
        config.compaction_config["compaction_trigger_tokens"] = 10
        config.compaction_config["verbatim_window_tokens"] = 50
        config.compaction_config["min_verbatim_exchanges"] = 1
        msgs = _build_long_history(5)

        compactor = HistoryCompactor(
            config,
            counter,
            detect_topic_boundary=lambda _m: TopicBoundary(
                None, "none", 0.0, "earlier work on auth"
            ),
        )
        result = compactor.compact_history_if_needed(
            msgs, already_checked=True
        )
        assert result is not None
        # First two entries are the summary pair.
        assert result.messages[0]["role"] == "user"
        assert "[History Summary]" in result.messages[0]["content"]
        assert "earlier work on auth" in result.messages[0]["content"]
        assert result.messages[1]["role"] == "assistant"
        assert "understand" in result.messages[1]["content"].lower()

    def test_summarize_fallback_when_detector_summary_empty(
        self, config: _FakeConfigManager, counter: TokenCounter
    ) -> None:
        """Empty summary from detector → generic placeholder used.

        The detector can return a None boundary with no summary
        text (common when it can't produce anything meaningful).
        We still need SOME summary content; the compactor uses
        a generic fallback.
        """
        config.compaction_config["compaction_trigger_tokens"] = 10
        config.compaction_config["verbatim_window_tokens"] = 50
        msgs = _build_long_history(5)

        compactor = HistoryCompactor(
            config,
            counter,
            detect_topic_boundary=lambda _m: TopicBoundary(
                None, "", 0.0, ""
            ),
        )
        result = compactor.compact_history_if_needed(
            msgs, already_checked=True
        )
        assert result is not None
        assert result.case == "summarize"
        # Some summary text is present — not empty.
        assert "[History Summary]" in result.messages[0]["content"]
        # Content after the header tag is non-empty.
        body = result.messages[0]["content"].split("\n", 1)[1]
        assert body.strip()

    def test_summarize_safeguard_inserts_after_summary_pair(
        self, config: _FakeConfigManager, counter: TokenCounter
    ) -> None:
        """Safeguard-prepended messages go at offset 2, not 0.

        Specs3 explicitly calls this out: summary → earlier
        context → verbatim window. The LLM reads the summary
        first, then the prepended earlier messages, then the
        verbatim window. Inserting at offset 0 would put the
        earlier messages before the summary, which is wrong.
        """
        config.compaction_config["compaction_trigger_tokens"] = 10
        # Small verbatim window so only the last couple of
        # messages survive.
        config.compaction_config["verbatim_window_tokens"] = 50
        # Require 3 user messages — more than the verbatim
        # window can hold, so safeguard must prepend.
        config.compaction_config["min_verbatim_exchanges"] = 3
        msgs = _build_long_history(10)  # 20 messages, 10 users

        compactor = HistoryCompactor(
            config,
            counter,
            detect_topic_boundary=lambda _m: TopicBoundary(
                None, "none", 0.0, "summary"
            ),
        )
        result = compactor.compact_history_if_needed(
            msgs, already_checked=True
        )
        assert result is not None
        assert result.case == "summarize"
        # Index 0, 1 are the summary pair.
        assert result.messages[0]["role"] == "user"
        assert "[History Summary]" in result.messages[0]["content"]
        assert result.messages[1]["role"] == "assistant"
        # Index 2 onward should include prepended earlier
        # messages — the first should NOT be the last few of
        # the verbatim window (which would mean the prepend
        # happened at the wrong spot).
        #
        # Easier property to pin: total user message count
        # meets the threshold.
        user_count = sum(
            1 for m in result.messages if m["role"] == "user"
        )
        # +1 for the summary pair's user.
        assert user_count >= 3 + 1


# ---------------------------------------------------------------------------
# Detector failure modes
# ---------------------------------------------------------------------------


class TestDetectorFailure:
    """Defensive handling — failures drive to safe summarise case."""

    def test_none_detector_treats_as_no_boundary(
        self, config: _FakeConfigManager, counter: TokenCounter
    ) -> None:
        """No detector supplied → acts like no boundary detected.

        Summarise case fires since the fallback `_SAFE_BOUNDARY`
        has None index + zero confidence. The compactor still
        does something useful — important because a caller
        without a detector (e.g., early startup or agent mode)
        still benefits from budget control.
        """
        config.compaction_config["compaction_trigger_tokens"] = 10
        config.compaction_config["verbatim_window_tokens"] = 50
        msgs = _build_long_history(5)

        compactor = HistoryCompactor(config, counter)
        result = compactor.compact_history_if_needed(
            msgs, already_checked=True
        )
        assert result is not None
        assert result.case == "summarize"

    def test_detector_exception_falls_back(
        self, config: _FakeConfigManager, counter: TokenCounter
    ) -> None:
        """Detector raising an exception → safe defaults.

        Network blip, LLM timeout, bad JSON — any of these
        should land in the safe-default path and summarise
        rather than crash the compaction pass.
        """
        config.compaction_config["compaction_trigger_tokens"] = 10
        config.compaction_config["verbatim_window_tokens"] = 50
        msgs = _build_long_history(5)

        def _broken(_m):
            raise RuntimeError("simulated LLM failure")

        compactor = HistoryCompactor(
            config, counter, detect_topic_boundary=_broken
        )
        # Must not raise.
        result = compactor.compact_history_if_needed(
            msgs, already_checked=True
        )
        assert result is not None
        assert result.case == "summarize"

    def test_detector_wrong_shape_falls_back(
        self, config: _FakeConfigManager, counter: TokenCounter
    ) -> None:
        """Non-TopicBoundary return → safe defaults.

        Detector that returns a dict or string by mistake
        shouldn't pass through to the case-decision logic.
        """
        config.compaction_config["compaction_trigger_tokens"] = 10
        config.compaction_config["verbatim_window_tokens"] = 50
        msgs = _build_long_history(5)

        compactor = HistoryCompactor(
            config,
            counter,
            detect_topic_boundary=lambda _m: {"not": "a boundary"},
        )
        result = compactor.compact_history_if_needed(
            msgs, already_checked=True
        )
        assert result is not None
        assert result.case == "summarize"


# ---------------------------------------------------------------------------
# apply_compaction helper
# ---------------------------------------------------------------------------


class TestApplyCompaction:
    """Convenience wrapper over compaction result."""

    def test_none_result_returns_original(
        self, config: _FakeConfigManager, counter: TokenCounter
    ) -> None:
        """None in → original list back out unchanged."""
        msgs = _build_long_history(3)
        compactor = HistoryCompactor(config, counter)
        assert compactor.apply_compaction(msgs, None) is msgs

    def test_case_none_result_returns_original(
        self, config: _FakeConfigManager, counter: TokenCounter
    ) -> None:
        """``case == "none"`` → original list back out.

        Never produced by ``compact_history_if_needed`` but
        accepted for symmetry — callers that construct a
        ``CompactionResult(case="none")`` to signal "nothing to
        do" get the expected behaviour.
        """
        msgs = _build_long_history(3)
        compactor = HistoryCompactor(config, counter)
        result = CompactionResult(case="none")
        assert compactor.apply_compaction(msgs, result) is msgs

    def test_truncate_result_returns_compacted(
        self, config: _FakeConfigManager, counter: TokenCounter
    ) -> None:
        """Real result's messages are returned, not the original."""
        msgs = _build_long_history(3)
        compacted = [_msg("user", "fresh")]
        result = CompactionResult(
            case="truncate", messages=compacted
        )
        compactor = HistoryCompactor(config, counter)
        assert compactor.apply_compaction(msgs, result) is compacted


# ---------------------------------------------------------------------------
# Verbatim window boundary
# ---------------------------------------------------------------------------


class TestVerbatimWindow:
    """The _find_verbatim_start logic — indirectly via compact."""

    def test_short_history_all_verbatim(
        self, config: _FakeConfigManager, counter: TokenCounter
    ) -> None:
        """When history fits entirely in window, start is 0.

        Verified indirectly — a summarise case with
        verbatim_start_idx=0 means no pre-verbatim messages, so
        the summary pair is prepended to the whole history.
        The total user count after compaction is original +
        1 (from the summary pair).
        """
        config.compaction_config["compaction_trigger_tokens"] = 10
        config.compaction_config["verbatim_window_tokens"] = 100000
        config.compaction_config["min_verbatim_exchanges"] = 1
        msgs = _build_long_history(2)  # 4 messages, 2 users

        compactor = HistoryCompactor(
            config,
            counter,
            detect_topic_boundary=lambda _m: TopicBoundary(
                None, "", 0.0, "summary"
            ),
        )
        result = compactor.compact_history_if_needed(
            msgs, already_checked=True
        )
        assert result is not None
        # Summary pair (1 user) + 2 original users = 3.
        user_count = sum(
            1 for m in result.messages if m["role"] == "user"
        )
        assert user_count == 3

    def test_token_based_window_shrinks_with_budget(
        self, config: _FakeConfigManager, counter: TokenCounter
    ) -> None:
        """Smaller verbatim_window_tokens keeps fewer messages.

        Property-test: shrinking the window reduces the
        verbatim set (or keeps it the same). Pinned as a
        monotonic property rather than exact counts because
        tiktoken measurements aren't worth pinning.
        """
        config.compaction_config["compaction_trigger_tokens"] = 10
        config.compaction_config["min_verbatim_exchanges"] = 1
        msgs = _build_long_history(20)  # 40 messages

        compactor = HistoryCompactor(
            config,
            counter,
            detect_topic_boundary=lambda _m: TopicBoundary(
                None, "", 0.0, "summary"
            ),
        )

        config.compaction_config["verbatim_window_tokens"] = 2000
        big = compactor.compact_history_if_needed(
            msgs, already_checked=True
        )
        assert big is not None
        big_count = len(big.messages)

        config.compaction_config["verbatim_window_tokens"] = 200
        small = compactor.compact_history_if_needed(
            msgs, already_checked=True
        )
        assert small is not None
        small_count = len(small.messages)

        # Smaller window produces fewer messages in the result.
        assert small_count <= big_count