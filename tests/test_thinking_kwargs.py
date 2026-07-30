"""Reasoning / extended-thinking kwargs for ``litellm.completion``.

Covers :mod:`ac_dc.llm._helpers` § Reasoning kwargs:

- :class:`TestParseClaudeVersion` — version extraction from every
  model-id shape the providers hand us.
- :class:`TestAdaptiveDetection` — which models take the
  ``adaptive`` thinking shape and which take legacy
  ``budget_tokens``.
- :class:`TestBuildThinkingKwargs` — the enable/disable
  resolution chain and the two payload shapes.
- :class:`TestLiteLLMTranslation` — the adaptive kwargs really do
  reach the provider as the AWS-documented wire shape.

Background — the bug these pin. Detection used to enumerate model
names (``opus-4-5``, ``opus-4-6``, ... ``opus-4-8``), so a model
released after the list was last edited matched nothing and took
the *legacy* branch. On Bedrock that produced::

    "thinking.type.enabled" is not supported for this model.
    Use "thinking.type.adaptive" and "output_config.effort"
    to control thinking behavior.

i.e. every reasoning request on a new Opus failed outright. The
tests below therefore check unreleased-looking versions and
unknown families as much as the known ones — an enumeration would
pass the "known model" cases and still ship the outage.

The authoritative split (Bedrock user guide § Adaptive thinking):
Claude 4.6 and later support adaptive, and the newest of them
reject ``enabled`` entirely; the 4.5 generation and older don't
support adaptive at all and require ``budget_tokens``.
"""

from __future__ import annotations

from typing import Any

import pytest

from ac_dc.llm._helpers import (
    _model_uses_adaptive_thinking,
    _parse_claude_version,
    build_thinking_kwargs,
)


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _FakeConfigManager:
    """Minimal stand-in for ConfigManager.

    Exposes only the four properties the reasoning helpers read.
    Constructing a real ConfigManager would drag in config-dir
    resolution and bundle copying for what is a pure function of
    (model, enabled, budget, effort).
    """

    def __init__(
        self,
        model: str = "anthropic/claude-opus-5",
        *,
        reasoning_enabled: bool = True,
        reasoning_budget_tokens: int = 10000,
        reasoning_effort: str = "medium",
    ) -> None:
        self.model = model
        self.reasoning_enabled = reasoning_enabled
        self.reasoning_budget_tokens = reasoning_budget_tokens
        self.reasoning_effort = reasoning_effort


def _cfg(model: str, **kw: Any) -> Any:
    """Shorthand for a reasoning-enabled fake config."""
    return _FakeConfigManager(model, **kw)


# Every id shape seen in the wild for one logical model: bare,
# provider-prefixed, Bedrock with and without a regional prefix,
# and with a Bedrock revision suffix.
_OPUS_5_IDS = (
    "claude-opus-5",
    "anthropic/claude-opus-5",
    "bedrock/anthropic.claude-opus-5",
    "bedrock/au.anthropic.claude-opus-5",
    "bedrock/us.anthropic.claude-opus-5",
    "bedrock/global.anthropic.claude-opus-5",
    "bedrock/au.anthropic.claude-opus-5-v1:0",
)


# ---------------------------------------------------------------------------
# Version parsing
# ---------------------------------------------------------------------------


class TestParseClaudeVersion:
    """``_parse_claude_version`` — (major, minor) from a model id."""

    def test_bare_major_reads_minor_as_zero(self) -> None:
        """``claude-opus-5`` is 5.0, so it sorts above 4.6.

        A missing minor must not make the version unorderable or
        the whole comparison collapses for exactly the newest
        models — the ones that need adaptive most.
        """
        assert _parse_claude_version("claude-opus-5") == (5, 0)

    def test_dash_and_dot_minors_both_parse(self) -> None:
        """Providers spell the minor both ways for the same model."""
        assert _parse_claude_version("claude-opus-4-6") == (4, 6)
        assert _parse_claude_version("claude-opus-4.6") == (4, 6)
        assert _parse_claude_version("claude-opus-4_6") == (4, 6)

    def test_provider_prefixes_pass_through(self) -> None:
        """Prefix noise ahead of ``claude-`` is ignored.

        The same model reaches us as an Anthropic-style slug or a
        Bedrock id with a regional prefix; both must resolve
        identically or reasoning behaviour would depend on which
        provider route the user configured.
        """
        for model in _OPUS_5_IDS:
            assert _parse_claude_version(model) == (5, 0), model

    def test_uppercase_ids_parse(self) -> None:
        """Case-insensitive — config files capitalise inconsistently."""
        assert _parse_claude_version("ANTHROPIC/CLAUDE-OPUS-4-6") == (4, 6)

    def test_date_suffix_is_not_the_minor(self) -> None:
        """An 8-digit release date must not be read as a minor.

        ``claude-opus-4-20250514`` is Opus 4.0. Reading it as 4.20
        would promote a legacy model into the adaptive branch and
        400 the request — the mirror image of the original bug.
        """
        assert _parse_claude_version("claude-opus-4-20250514") == (4, 0)
        assert _parse_claude_version(
            "anthropic/claude-sonnet-4-5-20250929"
        ) == (4, 5)

    def test_unparseable_ids_return_none(self) -> None:
        """Non-Claude and pre-4 ids don't parse.

        Pre-4 names put the family *after* the version
        (``claude-3-5-sonnet``), which the pattern deliberately
        skips: every one of those models is legacy-thinking, so
        None and "not adaptive" are the same answer.
        """
        for model in (
            "openai/gpt-4",
            "unknown/model",
            "claude-3-5-sonnet-20241022",
            "claude-instant",
        ):
            assert _parse_claude_version(model) is None, model


# ---------------------------------------------------------------------------
# Adaptive detection
# ---------------------------------------------------------------------------


class TestAdaptiveDetection:
    """``_model_uses_adaptive_thinking`` — the 4.6 cut-over."""

    def test_opus_5_is_adaptive_on_every_id_shape(self) -> None:
        """The regression case from the field report.

        ``bedrock/au.anthropic.claude-opus-5`` with reasoning on
        returned a Bedrock 400 because it fell through the
        enumerated marker list to the legacy branch.
        """
        for model in _OPUS_5_IDS:
            assert _model_uses_adaptive_thinking(model) is True, model

    def test_four_six_and_later_are_adaptive(self) -> None:
        """4.6 is the first generation to support adaptive."""
        for model in (
            "anthropic/claude-opus-4-6",
            "anthropic/claude-opus-4.6",
            "anthropic/claude-sonnet-4-6",
            "anthropic/claude-opus-4-7",
            "anthropic/claude-opus-4-8",
            "anthropic/claude-sonnet-5",
            "anthropic/claude-fable-5",
            "anthropic/claude-mythos-5",
            "bedrock/anthropic.claude-opus-4-6-v1:0",
        ):
            assert _model_uses_adaptive_thinking(model) is True, model

    def test_unknown_family_and_future_version_are_adaptive(self) -> None:
        """New names inherit adaptive without a code change.

        This is the property the enumerated list lacked. A family
        or major we've never heard of is, by the version rule,
        adaptive — matching where the provider has been heading
        since 4.6 and avoiding a hard failure on day one of a
        release. Getting it wrong the other way is recoverable:
        legacy models are a closed, known set.
        """
        for model in (
            "anthropic/claude-opus-6",
            "anthropic/claude-opus-4-10",
            "anthropic/claude-newfamily-7",
        ):
            assert _model_uses_adaptive_thinking(model) is True, model

    def test_four_five_generation_is_legacy(self) -> None:
        """The 4.5 generation requires ``budget_tokens``.

        These were previously classified as adaptive here. It went
        unnoticed because LiteLLM silently rewrites an adaptive
        request into ``{"type": "enabled", "budget_tokens": 8192}``
        for them — so the wire request was valid but the budget was
        LiteLLM's default, not the configured one.
        """
        for model in (
            "anthropic/claude-opus-4-5",
            "anthropic/claude-opus-4.5",
            "anthropic/claude-sonnet-4-5",
            "anthropic/claude-haiku-4-5",
            "anthropic/claude-sonnet-4-5-20250929",
            "bedrock/anthropic.claude-opus-4-5-v1:0",
        ):
            assert _model_uses_adaptive_thinking(model) is False, model

    def test_older_and_non_claude_are_legacy(self) -> None:
        """Pre-4.5 Claude and every non-Claude take the legacy shape."""
        for model in (
            "anthropic/claude-opus-4",
            "anthropic/claude-sonnet-4",
            "claude-3-5-sonnet-20241022",
            "openai/gpt-4",
            "unknown/model",
        ):
            assert _model_uses_adaptive_thinking(model) is False, model

    def test_unversioned_adaptive_only_model(self) -> None:
        """Mythos Preview carries no version but is adaptive-only.

        Its id has nothing to parse, so it's matched by substring.
        ``enabled`` and ``disabled`` both 400 on it.
        """
        assert _model_uses_adaptive_thinking(
            "anthropic/claude-mythos-preview"
        ) is True


# ---------------------------------------------------------------------------
# Kwargs assembly
# ---------------------------------------------------------------------------


class TestBuildThinkingKwargs:
    """``build_thinking_kwargs`` — payload shape and enable chain."""

    def test_adaptive_model_gets_adaptive_plus_effort(self) -> None:
        """Adaptive shape carries effort as a sibling kwarg.

        ``reasoning_effort`` is LiteLLM's cross-provider param and
        must stay *outside* ``thinking`` — Bedrock raises a
        ValidationException if effort is nested inside the
        thinking object.
        """
        kwargs = build_thinking_kwargs(
            _cfg("bedrock/au.anthropic.claude-opus-5",
                 reasoning_effort="xhigh"),
            None,
        )
        assert kwargs == {
            "thinking": {"type": "adaptive"},
            "reasoning_effort": "xhigh",
        }

    def test_legacy_model_gets_budget_and_no_effort(self) -> None:
        """Legacy shape carries the configured budget, no effort.

        ``reasoning_effort`` is omitted deliberately: passing it
        lets LiteLLM synthesise a budget of its own choosing,
        overriding ``reasoning.budget_tokens`` from config.
        """
        kwargs = build_thinking_kwargs(
            _cfg("anthropic/claude-sonnet-4-5",
                 reasoning_budget_tokens=12345,
                 reasoning_effort="xhigh"),
            None,
        )
        assert kwargs == {
            "thinking": {"type": "enabled", "budget_tokens": 12345},
        }

    def test_disabled_in_config_returns_empty(self) -> None:
        """No reasoning kwargs at all when config has it off.

        An empty dict, not ``{"thinking": {"type": "disabled"}}`` —
        omitting the kwarg keeps the request identical to a
        never-reasoned one, which matters for prompt caching.
        """
        cfg = _cfg("anthropic/claude-opus-5", reasoning_enabled=False)
        assert build_thinking_kwargs(cfg, None) == {}

    def test_request_override_true_beats_disabled_config(self) -> None:
        """The frontend toggle can turn reasoning on for one turn."""
        cfg = _cfg("anthropic/claude-opus-5", reasoning_enabled=False)
        assert build_thinking_kwargs(cfg, True) == {
            "thinking": {"type": "adaptive"},
            "reasoning_effort": "medium",
        }

    def test_request_override_false_beats_enabled_config(self) -> None:
        """Aux calls opt out unconditionally.

        Commit-message generation and topic detection pass
        ``request_override=False``; they must not reason even when
        the primary is configured to. Spec § Aux call policy.
        """
        cfg = _cfg("anthropic/claude-opus-5", reasoning_enabled=True)
        assert build_thinking_kwargs(cfg, False) == {}

    def test_effort_override_wins_over_config(self) -> None:
        """Per-request effort dropdown beats the config default."""
        cfg = _cfg("anthropic/claude-opus-5", reasoning_effort="low")
        kwargs = build_thinking_kwargs(cfg, None, "max")
        assert kwargs["reasoning_effort"] == "max"

    def test_unrecognised_effort_override_defers_to_config(self) -> None:
        """A bogus level falls back rather than reaching the provider.

        The provider would reject it with a 400; deferring to the
        configured level degrades to a working request instead.
        """
        cfg = _cfg("anthropic/claude-opus-5", reasoning_effort="high")
        for override in (None, "", "ludicrous", "MAX"):
            kwargs = build_thinking_kwargs(cfg, None, override)
            assert kwargs["reasoning_effort"] == "high", override

    def test_effort_override_ignored_on_legacy_model(self) -> None:
        """Legacy models get no effort kwarg even when one is asked for."""
        cfg = _cfg("anthropic/claude-haiku-4-5")
        kwargs = build_thinking_kwargs(cfg, True, "xhigh")
        assert "reasoning_effort" not in kwargs

    @pytest.mark.parametrize(
        "effort", ["minimal", "low", "medium", "high", "xhigh", "max"]
    )
    def test_every_valid_effort_passes_through(self, effort: str) -> None:
        """All six levels are accepted here.

        The per-model ceiling (``xhigh``/``max`` only on models
        that advertise them) is the provider's to enforce — this
        layer only screens typos, so it must not silently drop a
        level a newer model has started accepting.
        """
        cfg = _cfg("anthropic/claude-opus-5")
        kwargs = build_thinking_kwargs(cfg, None, effort)
        assert kwargs["reasoning_effort"] == effort


# ---------------------------------------------------------------------------
# LiteLLM translation — the actual wire shape
# ---------------------------------------------------------------------------


class TestLiteLLMTranslation:
    """Our kwargs reach Bedrock as the AWS-documented shape.

    Everything above pins the *kwargs* we hand LiteLLM. This pins
    what LiteLLM then puts on the wire, which is where the
    original 400 came from. Without it, a LiteLLM change to the
    ``reasoning_effort`` → ``output_config.effort`` mapping would
    reintroduce the outage with every unit test still green.
    """

    def test_adaptive_kwargs_become_output_config_effort(self) -> None:
        """``reasoning_effort`` lands in a top-level ``output_config``.

        Per the Bedrock user guide: ``thinking: {"type":
        "adaptive"}`` plus a *sibling* ``output_config.effort``.
        Effort nested inside ``thinking`` is a ValidationException.
        """
        converse = pytest.importorskip(
            "litellm.llms.bedrock.chat.converse_transformation"
        )
        config_cls = getattr(converse, "AmazonConverseConfig", None)
        map_params = getattr(config_cls, "map_openai_params", None)
        if map_params is None:
            pytest.skip("LiteLLM converse transformation surface changed")

        cfg = _cfg("bedrock/au.anthropic.claude-opus-5",
                   reasoning_effort="xhigh")
        kwargs = build_thinking_kwargs(cfg, None)

        wire: dict[str, Any] = config_cls().map_openai_params(
            non_default_params=dict(kwargs),
            optional_params={},
            model="au.anthropic.claude-opus-5",
            drop_params=False,
        )
        assert wire.get("thinking") == {"type": "adaptive"}
        assert wire.get("output_config") == {"effort": "xhigh"}
        # The rejected legacy spelling must be nowhere in the
        # request — its presence is the exact 400 we fixed.
        assert "budget_tokens" not in str(wire.get("thinking"))
