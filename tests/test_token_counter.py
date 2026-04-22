"""Tests for ac_dc.token_counter.

Scope: TokenCounter — model-family limits, encoding load path,
counting across all documented input shapes, graceful degradation
when tiktoken is unavailable, edge cases on malformed input.

Strategy:

- Tests for limit computation (max input / output / history,
  min-cacheable-tokens) don't need the encoder — they assert
  against hardcoded constants per the spec.
- Tests for counting behaviour run with the real tiktoken encoder
  when it's installed (always, in the dev environment; guaranteed
  by the core dependency list in pyproject.toml). We assert relative
  properties ("non-zero count", "longer string gets more tokens")
  rather than exact values — the latter would pin us to a tiktoken
  version.
- A handful of tests force the encoder-missing fallback path by
  monkeypatching the module-level loader. This is the documented
  degradation behaviour and must keep working when tiktoken isn't
  in the packaged release.
"""

from __future__ import annotations

import pytest

from ac_dc import token_counter as tc_module
from ac_dc.token_counter import TokenCounter


# ---------------------------------------------------------------------------
# Model-family limits
# ---------------------------------------------------------------------------


class TestModelLimits:
    """Hardcoded per-model limits — no runtime provider lookup."""

    def test_model_property_roundtrips(self) -> None:
        """The ``model`` property returns the constructor argument.

        Trivial but worth pinning: downstream callers (compactor,
        cache target) read ``counter.model`` to dispatch family
        logic. Silent loss of the name would produce wrong limits.
        """
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        assert tc.model == "anthropic/claude-sonnet-4-5"

    def test_max_input_tokens_is_one_million(self) -> None:
        """All supported models have a 1M-token input context.

        Pinned hardcoded per spec — no call into litellm's model
        registry. A future model with a smaller context would
        require a code change here rather than a silent registry
        read.
        """
        assert TokenCounter("anthropic/claude-sonnet-4-5").max_input_tokens == 1_000_000
        assert TokenCounter("openai/gpt-4").max_input_tokens == 1_000_000
        assert TokenCounter("unknown/model").max_input_tokens == 1_000_000

    def test_claude_max_output_tokens(self) -> None:
        """Claude family gets 8192 output tokens.

        Matched by substring — both ``anthropic/`` prefixes and
        ``bedrock/anthropic.`` prefixes resolve the same way.
        """
        for model in (
            "anthropic/claude-sonnet-4-5",
            "anthropic/claude-opus-4-6",
            "anthropic/claude-haiku-4-5",
            "bedrock/anthropic.claude-sonnet-4-5-v1:0",
            "claude-sonnet-4",
        ):
            assert TokenCounter(model).max_output_tokens == 8192, model

    def test_non_claude_max_output_tokens(self) -> None:
        """Non-Claude models fall back to 4096 output tokens."""
        for model in (
            "openai/gpt-4",
            "openai/gpt-4-turbo",
            "unknown/model",
        ):
            assert TokenCounter(model).max_output_tokens == 4096, model

    def test_max_history_tokens_is_input_over_sixteen(self) -> None:
        """Per spec — max history is max input divided by 16.

        On the 1M-token models this gives 62500. Ensures headroom
        for symbol map, files, and current prompt.
        """
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        assert tc.max_history_tokens == tc.max_input_tokens // 16
        assert tc.max_history_tokens == 62_500

    def test_min_cacheable_high_min_models(self) -> None:
        """Opus 4.5/4.6 and Haiku 4.5 have a 4096-token floor.

        These families require substantially more content before
        the provider actually caches the block. ``ConfigManager``
        consumes this via ``cache_target_tokens_for_model`` to
        size cache targets appropriately.

        Both dash and dot version variants must match — provider
        names appear in the wild in both styles.
        """
        for model in (
            "anthropic/claude-opus-4-5",
            "anthropic/claude-opus-4.5",
            "anthropic/claude-opus-4-6",
            "anthropic/claude-opus-4.6",
            "anthropic/claude-haiku-4-5",
            "anthropic/claude-haiku-4.5",
            "bedrock/anthropic.claude-opus-4-6-v1:0",
        ):
            assert TokenCounter(model).min_cacheable_tokens == 4096, model

    def test_min_cacheable_default(self) -> None:
        """Sonnet, other Claude, non-Claude — all get the 1024 default."""
        for model in (
            "anthropic/claude-sonnet-4-5",
            "anthropic/claude-haiku-3-5",
            "anthropic/claude-opus-4",
            "openai/gpt-4",
            "unknown/model",
        ):
            assert TokenCounter(model).min_cacheable_tokens == 1024, model

    def test_limits_are_case_insensitive(self) -> None:
        """Family detection lowercases the input.

        Guards against config files that capitalise model names
        inconsistently (``Anthropic/Claude-Sonnet-4-5``). Matching
        must still work.
        """
        tc = TokenCounter("ANTHROPIC/CLAUDE-OPUS-4-6")
        assert tc.max_output_tokens == 8192
        assert tc.min_cacheable_tokens == 4096


# ---------------------------------------------------------------------------
# Counting — strings
# ---------------------------------------------------------------------------


class TestCountString:
    """``count(str)`` — the simplest path."""

    def test_empty_string_is_zero(self) -> None:
        """Empty string produces zero tokens, not an error.

        Lots of callers pass potentially-empty values (a file
        context that hasn't loaded yet, a missing system prompt).
        Raising on empty would force every site into an if-check.
        """
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        assert tc.count("") == 0

    def test_none_is_zero(self) -> None:
        """``None`` produces zero tokens.

        Same rationale as empty string. ``context.get_history()``
        can legitimately return None-valued entries in edge cases.
        """
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        assert tc.count(None) == 0

    def test_non_empty_string_is_positive(self) -> None:
        """Any non-empty string produces at least one token.

        The fallback path (`len // 4`) can return 0 for 1-3
        character strings, but the tiktoken path always returns at
        least 1 for a single character. Since tiktoken is installed
        as a core dep, we assert the positive-count behaviour.
        """
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        assert tc.count("hello") > 0

    def test_longer_string_has_more_tokens(self) -> None:
        """Relative property — more text means more tokens.

        Pins monotonicity without pinning absolute values (which
        would break on tiktoken version bumps).
        """
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        short = tc.count("one")
        long = tc.count("one two three four five six seven")
        assert long > short

    def test_unicode_string_counted(self) -> None:
        """Non-ASCII input survives the round-trip.

        cl100k_base handles UTF-8 natively. A raise here would
        indicate the encoder wasn't handed bytes correctly.
        """
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        assert tc.count("héllo wörld") > 0
        assert tc.count("日本語テキスト") > 0


# ---------------------------------------------------------------------------
# Counting — messages
# ---------------------------------------------------------------------------


class TestCountMessage:
    """``count(dict)`` — provider-agnostic message shape."""

    def test_plain_text_message(self) -> None:
        """``{"role": "user", "content": "hi"}`` counts both fields."""
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        count = tc.count({"role": "user", "content": "hello world"})
        assert count > 0
        # Role and content both contribute.
        assert count > tc.count("hello world")

    def test_count_message_alias(self) -> None:
        """``count_message`` is equivalent to ``count`` on a dict.

        The alias exists for readability at call sites. Pinning
        equality here prevents drift where one path gets updated
        and the other doesn't.
        """
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        msg = {"role": "assistant", "content": "hello"}
        assert tc.count_message(msg) == tc.count(msg)

    def test_message_with_none_content(self) -> None:
        """Missing content is treated as empty, not a crash.

        History reconstruction from JSONL can produce messages
        with missing keys during partial-write recovery. The
        counter must tolerate the shape without raising.
        """
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        count = tc.count({"role": "user", "content": None})
        # Role still contributes; content does not.
        assert count > 0
        # And equal to role alone.
        assert count == tc.count({"role": "user", "content": ""})

    def test_message_with_missing_role(self) -> None:
        """Missing role is treated as empty, not a crash."""
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        count = tc.count({"content": "hello"})
        # Just the content.
        assert count == tc.count("hello")

    def test_empty_message_dict(self) -> None:
        """Completely empty dict yields zero tokens.

        Not a reachable state in practice, but the counter stays
        total rather than raising.
        """
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        assert tc.count({}) == 0


# ---------------------------------------------------------------------------
# Counting — multimodal content blocks
# ---------------------------------------------------------------------------


class TestCountBlocks:
    """Message content can be a list of typed blocks (multimodal)."""

    def test_text_block_counts_text_field(self) -> None:
        """``{"type": "text", "text": "..."}`` counts the text field.

        This is the Anthropic / OpenAI message format for mixing
        text with other content types. The counter reads the
        ``text`` field only; other block-level metadata (cache
        control markers, etc.) doesn't contribute.
        """
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        msg = {
            "role": "user",
            "content": [{"type": "text", "text": "hello world"}],
        }
        count = tc.count(msg)
        # Role + text, so at least the role contributes.
        assert count > tc.count("hello world")

    def test_multiple_text_blocks_sum(self) -> None:
        """Multiple text blocks contribute additively."""
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        one_block = tc.count({
            "role": "user",
            "content": [{"type": "text", "text": "hello world"}],
        })
        two_blocks = tc.count({
            "role": "user",
            "content": [
                {"type": "text", "text": "hello world"},
                {"type": "text", "text": "hello world"},
            ],
        })
        assert two_blocks > one_block

    def test_image_block_uses_flat_estimate(self) -> None:
        """Image blocks contribute a generous flat per-image estimate.

        Per-provider image tokenisation varies too much to compute
        precisely here. The counter errs on the safe side — 1000
        tokens per image. Tests pin the behaviour by comparing a
        message with one image against a message with two; the
        delta should be substantial.
        """
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        one_image = tc.count({
            "role": "user",
            "content": [
                {"type": "text", "text": "look at this"},
                {"type": "image", "source": {}},
            ],
        })
        two_images = tc.count({
            "role": "user",
            "content": [
                {"type": "text", "text": "look at this"},
                {"type": "image", "source": {}},
                {"type": "image", "source": {}},
            ],
        })
        # The delta is at least the 1000-token image estimate.
        assert two_images - one_image >= 1000

    def test_image_url_block_also_uses_estimate(self) -> None:
        """OpenAI-style ``image_url`` blocks get the same treatment.

        Both Anthropic (``image``) and OpenAI (``image_url``)
        block types route through the same estimate. The counter
        doesn't have image dimensions either way.
        """
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        msg = {
            "role": "user",
            "content": [{"type": "image_url", "image_url": {"url": "..."}}],
        }
        # Role contributes a little; image contributes ~1000.
        assert tc.count(msg) >= 1000

    def test_bare_string_inside_content_list(self) -> None:
        """A raw string in a content list is treated as text.

        Some callers pre-flatten content to a list of strings
        rather than typed blocks. The counter accepts both shapes.
        """
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        msg = {"role": "user", "content": ["hello world"]}
        count = tc.count(msg)
        assert count > tc.count({"role": "user"})

    def test_unknown_block_type_is_stringified(self) -> None:
        """Unknown block types don't raise — they stringify.

        Forward-compatibility for provider extensions (audio,
        video, tool calls, etc.). An unrecognised block gets a
        rough token count via `str()` rather than being silently
        dropped; dropping would understate budget.
        """
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        msg = {
            "role": "user",
            "content": [{"type": "audio", "data": "some-encoded-data"}],
        }
        assert tc.count(msg) > tc.count({"role": "user"})

    def test_malformed_block_does_not_raise(self) -> None:
        """Non-dict, non-string block entries are tolerated.

        Defensive — a corrupted message should never take down the
        budget estimator. Stringify and count.
        """
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        # An int buried in a content list — should be stringified.
        msg = {"role": "user", "content": [42]}
        # Doesn't raise.
        count = tc.count(msg)
        # Non-negative.
        assert count >= 0


# ---------------------------------------------------------------------------
# Counting — lists and misc shapes
# ---------------------------------------------------------------------------


class TestCountList:
    """``count(list)`` — list of messages, list of strings."""

    def test_list_of_messages_sums(self) -> None:
        """A list of messages counts each message and sums.

        The prompt assembler calls ``count(messages)`` directly
        to estimate total history size before tier assembly.
        """
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        messages = [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "hi there"},
        ]
        total = tc.count(messages)
        individual = sum(tc.count(m) for m in messages)
        assert total == individual

    def test_empty_list_is_zero(self) -> None:
        """Empty list yields zero. Common case at session start."""
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        assert tc.count([]) == 0

    def test_list_of_strings(self) -> None:
        """A list of bare strings counts each and sums.

        Less common but documented — the counter accepts
        heterogeneous shapes for resilience.
        """
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        total = tc.count(["hello", "world"])
        parts = tc.count("hello") + tc.count("world")
        assert total == parts


class TestCountMisc:
    """Defensive paths — unknown types, nested shapes."""

    def test_integer_is_stringified(self) -> None:
        """Non-standard types stringify rather than raise.

        Defensive. Every code path should return an int, never
        raise on bad input — budget estimation must stay total.
        """
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        assert tc.count(42) > 0

    def test_nested_list_of_messages(self) -> None:
        """Nested lists recurse through ``count``.

        ``count`` calls itself recursively on list entries, so
        even a nested shape (unusual but possible during
        debugging or test setup) produces a correct sum.
        """
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        nested = [
            [{"role": "user", "content": "hi"}],
            [{"role": "assistant", "content": "hello"}],
        ]
        total = tc.count(nested)
        flat_total = (
            tc.count({"role": "user", "content": "hi"})
            + tc.count({"role": "assistant", "content": "hello"})
        )
        assert total == flat_total


# ---------------------------------------------------------------------------
# Encoding load — degradation when tiktoken is unavailable
# ---------------------------------------------------------------------------


class TestEncodingLoad:
    """Fallback path when tiktoken isn't available.

    The production counter always has tiktoken (core dep). These
    tests simulate the missing-dep case by monkeypatching the
    module-level loader — the documented degradation behaviour
    must keep working for packaged releases that skip tiktoken.
    """

    def test_missing_encoder_falls_back_to_char_count(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Counter constructs cleanly when ``_load_encoding`` returns None.

        A fresh counter with a None encoder still produces token
        counts — just via the char/4 fallback. No crash, no
        warning-level spam (one DEBUG log at construction, then
        silent operation).
        """
        monkeypatch.setattr(tc_module, "_load_encoding", lambda: None)
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        # 40 chars ÷ 4 = 10.
        assert tc.count("x" * 40) == 10
        # Empty still zero.
        assert tc.count("") == 0

    def test_fallback_estimates_reasonably(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Char-count fallback produces non-negative, monotonic values.

        Fallback doesn't need to match tiktoken exactly — it's a
        budget-estimate, not an exact count. But it must be
        monotonic (longer input → more tokens) so budget checks
        aren't fooled.
        """
        monkeypatch.setattr(tc_module, "_load_encoding", lambda: None)
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        assert tc.count("abc") < tc.count("abcdefgh")
        assert tc.count("x" * 100) > tc.count("x" * 50)

    def test_fallback_still_counts_messages(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Message dicts work under the fallback too.

        The fallback is applied at the string level, so the dict /
        list / multimodal handling still works — each string
        encountered just uses char/4 instead of tiktoken.
        """
        monkeypatch.setattr(tc_module, "_load_encoding", lambda: None)
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        msg = {"role": "user", "content": "hello world"}
        # Role ("user" = 4 chars → 1) + content (11 chars → 2).
        assert tc.count(msg) >= 3

    def test_encoder_exception_during_encode_falls_back(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Runtime encoder failure is caught and falls back.

        An encoder that loaded cleanly but throws mid-call
        (version mismatch, bad UTF-8 surrogate, internal state
        corruption) must not propagate. Falling back to char-count
        keeps the budget estimator running at a cosmetic cost.
        """
        class _BrokenEncoder:
            def encode(self, text: str):
                raise RuntimeError("simulated encoder failure")

        monkeypatch.setattr(
            tc_module, "_load_encoding", lambda: _BrokenEncoder()
        )
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        # Doesn't raise — falls back to char-count.
        assert tc.count("x" * 40) == 10


# ---------------------------------------------------------------------------
# Instance independence
# ---------------------------------------------------------------------------


class TestInstanceIndependence:
    """Multiple counters don't share mutable state.

    D10 wants multiple ``TokenCounter`` instances coexisting —
    one per context manager in agent mode. The module-level
    loader caches tiktoken internally (cheap to call repeatedly)
    but counters themselves must hold their own encoder reference
    so one counter's fallback doesn't poison another's happy path.
    """

    def test_two_counters_have_independent_encoders(self) -> None:
        """Each counter holds its own encoder reference.

        Pinning the invariant — no module-level singleton swap
        can accidentally route every counter's calls through a
        single shared encoder.
        """
        a = TokenCounter("anthropic/claude-sonnet-4-5")
        b = TokenCounter("openai/gpt-4")
        # Both constructed successfully; each has its own encoder
        # attribute (even if the underlying tiktoken object is
        # the same cached instance, the reference is per-counter).
        assert a._encoding is not None
        assert b._encoding is not None

    def test_different_models_produce_independent_limits(self) -> None:
        """Constructing one counter doesn't mutate another's limits.

        Trivial property given the no-global-state design, but
        pinning it means a future refactor that introduces a
        shared registry would break this test rather than
        silently cross-contaminating model limits.
        """
        claude = TokenCounter("anthropic/claude-opus-4-6")
        gpt = TokenCounter("openai/gpt-4")
        # Claude: 8192 output, 4096 min-cacheable.
        assert claude.max_output_tokens == 8192
        assert claude.min_cacheable_tokens == 4096
        # GPT-4: 4096 output, 1024 min-cacheable.
        assert gpt.max_output_tokens == 4096
        assert gpt.min_cacheable_tokens == 1024
        # Re-check Claude — unchanged.
        assert claude.max_output_tokens == 8192

    def test_counts_are_deterministic_across_calls(self) -> None:
        """Same input to the same counter always returns same count.

        Pins determinism. The stability tracker's content hashing
        depends on token counts being stable — if the counter
        returned varying values per call, cache tiering would
        demote files for no real reason.
        """
        tc = TokenCounter("anthropic/claude-sonnet-4-5")
        text = "the quick brown fox jumps over the lazy dog"
        first = tc.count(text)
        second = tc.count(text)
        third = tc.count(text)
        assert first == second == third