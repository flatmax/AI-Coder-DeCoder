"""Token counter — cheap, deterministic token estimation.

Every LLM-facing piece of Layer 3 needs accurate token counts: the
context manager for budget enforcement, the history compactor for
trigger thresholds, the stability tracker for cache-target decisions,
the prompt assembler for the token HUD.

Design points pinned by the spec (specs4/1-foundation/configuration.md
#token-counter-data-sources, specs3/1-foundation/configuration.md
#token-counter-data-sources for the concrete numbers):

- **One encoding for every model.** ``cl100k_base`` is the OpenAI
  tokenizer but it's close enough to Claude and Bedrock tokenisation
  for budget decisions (a few percent drift, which doesn't move
  compaction triggers or cache-target gates). Using one encoding
  means one tokenizer to load, no per-request dispatch, no soft
  dependencies on provider SDKs.

- **Hardcoded model limits.** The spec explicitly forbids runtime
  queries to ``litellm``'s model registry. Limits are frozen
  constants per model family. A new Claude release with a different
  minimum cacheable-tokens value needs a code change — intentional,
  because silently changing the cache target would produce mystery
  cost increases in user bills.

- **Graceful degradation when tiktoken is missing.** Packaged
  releases may skip it; development installs may lag. Without the
  tokenizer we fall back to a 4-characters-per-token estimate.
  Wrong by ~15% for code but still useful for coarse budget
  checks (nobody's compaction trigger is at the 1% boundary).

- **No global mutable state.** The encoder is cached per-instance,
  not at module level. D10 wants multiple ``TokenCounter`` instances
  coexisting (one per context manager in agent mode) without
  sharing singletons.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Model-family limits
# ---------------------------------------------------------------------------
#
# All values from specs3/1-foundation/configuration.md#token-counter-data-
# sources. The spec is the authoritative source — do not derive these from
# provider docs at runtime.

# Default fallbacks when we see a model we don't recognise. Safe
# minimums — 1M input matches the current supported set, 4096 output
# matches GPT-4, 1024 min-cacheable matches Sonnet and non-Claude
# models.
_DEFAULT_MAX_INPUT_TOKENS = 1_000_000
_DEFAULT_MAX_OUTPUT_TOKENS = 4096
_DEFAULT_MIN_CACHEABLE_TOKENS = 1024

# Match by lowercase substring — resilient to provider prefixes like
# ``anthropic/`` or ``bedrock/anthropic.``. Both dash-separated and
# dot-separated version styles appear in the wild.
_CLAUDE_FAMILY_MARKERS = ("claude", "anthropic")

# Per-model output token ceilings. Matched by lowercase substring
# against the model name, first match wins. The ordering of the
# tuple matters — more-specific patterns must come before less-
# specific ones (e.g. ``opus-4-5`` before ``claude``). These are
# the hard ceilings the provider accepts; user configuration can
# lower this via ``config.max_output_tokens`` but cannot raise it.
#
# Values from provider documentation as of 2025-01 —
# Anthropic publishes these under "Output length" per model.
# When a new model ships with a different ceiling, add it here
# rather than relying on runtime provider queries (which the
# spec forbids — silently changing ceilings would mask bugs
# like the 4096-token truncation we had before this table).
_OUTPUT_TOKEN_CEILINGS: tuple[tuple[tuple[str, ...], int], ...] = (
    # Opus 4.5+ — 128K output window
    (("opus-4-5", "opus-4.5", "opus-4-6", "opus-4.6",
      "opus-4-7", "opus-4.7"), 128_000),
    # Sonnet 4.5+ — 64K output window
    (("sonnet-4-5", "sonnet-4.5", "sonnet-4-6", "sonnet-4.6",
      "sonnet-4-7", "sonnet-4.7"), 64_000),
    # Haiku 4.5+ — 64K output window
    (("haiku-4-5", "haiku-4.5", "haiku-4-6", "haiku-4.6"), 64_000),
    # GPT-4 family — 16K output window
    (("gpt-4",), 16_384),
    # Older Claude (3.x, 2.x, pre-4.5 4.x) — 8K output window.
    # Catch-all for any ``claude``/``anthropic`` model that didn't
    # match a more specific pattern above.
    (("claude", "anthropic"), 8_192),
)

# Models with a 4096 min-cacheable-tokens floor. Same family markers
# as ``ConfigManager._model_min_cacheable_tokens`` — duplicated here
# rather than imported, since ``ConfigManager`` is an optional
# dependency of ``TokenCounter`` (tests construct the counter in
# isolation).
_HIGH_MIN_MODELS = (
    "opus-4-5", "opus-4.5",
    "opus-4-6", "opus-4.6",
    "haiku-4-5", "haiku-4.5",
)
_HIGH_MIN_TOKENS = 4096

# Divisor for the char-count fallback. Empirically ~4 chars per
# token for English prose; code runs a bit higher, JSON a bit
# lower. 4 is a fair middle ground, and matches tiktoken to within
# roughly 15% on typical LLM context.
_CHARS_PER_TOKEN_FALLBACK = 4

# Flat estimate for image content blocks. Image tokenisation
# varies wildly across providers — Anthropic bills by image
# dimensions, OpenAI by tile count, Bedrock by a mix — and the
# counter doesn't have the dimensions at hand when inspecting a
# message block. 1000 tokens is deliberately generous so budget
# decisions err on the safe side; a truly large image might cost
# more, but any provider that charges 1000 tokens for a minimum
# image is already accounted for.
_IMAGE_TOKEN_ESTIMATE = 1000


def _matches(model: str, markers: tuple[str, ...]) -> bool:
    """Case-insensitive substring match against a marker list.

    Centralised so every family check uses the same normalisation.
    Model names arrive in various shapes —
    ``anthropic/claude-sonnet-4-5-20250929``,
    ``bedrock/anthropic.claude-opus-4-6-v1:0``, plain
    ``claude-haiku-4.5`` — and a lowercased substring scan is the
    cheapest way to handle all of them.
    """
    lowered = model.lower()
    return any(m in lowered for m in markers)


def _is_claude(model: str) -> bool:
    """Return True when ``model`` looks like a Claude-family model.

    Matches both ``anthropic/claude-*`` and ``bedrock/anthropic.*``
    forms. Two markers because the same models appear under
    different provider prefixes.
    """
    return _matches(model, _CLAUDE_FAMILY_MARKERS)


def _min_cacheable_for(model: str) -> int:
    """Provider-minimum cacheable tokens for ``model``.

    4096 for Opus 4.5/4.6 and Haiku 4.5; 1024 for everything else
    (Sonnet, other Claude, GPT-4, etc.). Non-matching models fall
    through to the default.
    """
    if _matches(model, _HIGH_MIN_MODELS):
        return _HIGH_MIN_TOKENS
    return _DEFAULT_MIN_CACHEABLE_TOKENS


# ---------------------------------------------------------------------------
# Encoding loader
# ---------------------------------------------------------------------------


def _load_encoding() -> Any | None:
    """Load and return the cl100k_base tiktoken encoding, or None.

    Returns None when ``tiktoken`` isn't installed (optional in
    packaged releases) or when the encoding fails to construct
    (corrupted install, version mismatch). Both failures are
    expected — we log once at DEBUG / WARNING and let the caller
    fall back to char-counting.

    Module-level helper rather than a staticmethod so tests can
    monkeypatch it cleanly without wiring through the class
    namespace.
    """
    try:
        import tiktoken
    except ImportError:
        logger.debug(
            "tiktoken not installed; falling back to char-count estimate"
        )
        return None
    try:
        return tiktoken.get_encoding("cl100k_base")
    except Exception as exc:
        # Broad catch — tiktoken's internals evolve between versions,
        # and we don't want a hard crash on counter construction
        # taking down the whole LLM pipeline for a cosmetic budget
        # estimate issue.
        logger.warning(
            "Failed to load cl100k_base encoding: %s; "
            "falling back to char-count estimate",
            exc,
        )
        return None


# ---------------------------------------------------------------------------
# TokenCounter
# ---------------------------------------------------------------------------


class TokenCounter:
    """Count tokens for a specific model's budget decisions.

    Owns its own cached encoding — no module-level singleton, no
    shared mutable state. D10 wants multiple ``TokenCounter``
    instances coexisting (one per context manager in agent mode)
    without sharing globals. tiktoken's internal cache means the
    encoding itself only loads once per process; construction of
    additional counters is near-free.

    Thread-safety — the encoder is safe for concurrent ``encode``
    calls (documented in tiktoken). The counter holds no mutable
    state beyond the cached encoder, so multiple threads may share
    one ``TokenCounter`` for read-only counting.
    """

    def __init__(self, model: str) -> None:
        """Initialise a counter for ``model``.

        Parameters
        ----------
        model:
            Provider-qualified model identifier, e.g.
            ``"anthropic/claude-sonnet-4-5"``. Used for limit
            lookups (max input / output / cache minimum); the
            tokenizer itself doesn't vary by model.
        """
        self._model = model
        # Load eagerly so a missing tiktoken surfaces at construction
        # time rather than on first count. Logged once per counter
        # rather than once per call.
        self._encoding = _load_encoding()

    # ------------------------------------------------------------------
    # Model properties
    # ------------------------------------------------------------------

    @property
    def model(self) -> str:
        """The model identifier this counter was constructed with."""
        return self._model

    @property
    def max_input_tokens(self) -> int:
        """Maximum input tokens per request.

        Hardcoded at 1M for every currently supported model. A
        future smaller-context release would need a family check
        here; today the single value covers everything.

        Exposed as a plain property (not a stored attribute) so
        subclasses or tests can override it via the property
        machinery — the pre-request shedding tests in Layer 3.4
        rely on this to simulate budget pressure without
        constructing artificially huge file contexts.
        """
        return _DEFAULT_MAX_INPUT_TOKENS

    @property
    def max_output_tokens(self) -> int:
        """Maximum output tokens per request.

        Walks :data:`_OUTPUT_TOKEN_CEILINGS` in declaration order
        and returns the first matching ceiling. Order is load-
        bearing — more-specific patterns (``opus-4-5``) must
        appear before the catch-all (``claude``).

        A user-configured ``max_output_tokens`` in ``llm.json``
        can LOWER this ceiling but cannot raise it — see
        :meth:`ConfigManager.max_output_tokens`. The counter
        exposes the provider's hard ceiling; the config layer
        clamps the user's preference against it.

        Falls back to :data:`_DEFAULT_MAX_OUTPUT_TOKENS` (4096)
        for unrecognized models. Conservative default — better
        to get a shorter-than-possible response than a 400
        from the provider because we asked for too much.
        """
        lowered = self._model.lower()
        for markers, ceiling in _OUTPUT_TOKEN_CEILINGS:
            for marker in markers:
                if marker in lowered:
                    return ceiling
        return _DEFAULT_MAX_OUTPUT_TOKENS

    @property
    def max_history_tokens(self) -> int:
        """Target ceiling for conversation history.

        ``max_input_tokens / 16`` per spec — roughly 62.5K on a 1M
        model. Leaves substantial headroom for symbol map, files,
        and the current prompt. The history compactor's trigger
        threshold is configured separately (default 24K); this
        property is the hard upper bound used by emergency
        truncation and the context-viewer's budget bar.
        """
        return self.max_input_tokens // 16

    @property
    def min_cacheable_tokens(self) -> int:
        """Provider-minimum tokens for a cache breakpoint to engage.

        Model-aware per spec — 4096 for Opus 4.5/4.6 and Haiku 4.5,
        1024 elsewhere. Used by
        :meth:`ConfigManager.cache_target_tokens_for_model` to
        compute the effective cache target.
        """
        return _min_cacheable_for(self._model)

    # ------------------------------------------------------------------
    # Counting — public
    # ------------------------------------------------------------------

    def count(self, value: Any) -> int:
        """Return an approximate token count for ``value``.

        Accepts:

        - ``str`` — encoded directly
        - ``dict`` — treated as a message dict with ``role`` and
          ``content`` keys; content may be a string or a list of
          content blocks (multimodal)
        - ``list`` — each entry counted recursively and summed
          (covers a list of message dicts, or a list of content
          blocks passed directly)
        - ``None`` — 0
        - Any other shape — stringified and counted

        Always returns a non-negative int. On any unexpected input
        or encoding failure, falls back to the char-count estimate
        rather than raising — an off-by-a-few budget estimate is
        never worth failing a user's request.
        """
        if value is None:
            return 0
        if isinstance(value, str):
            return self._count_string(value)
        if isinstance(value, dict):
            return self._count_message(value)
        if isinstance(value, list):
            return sum(self.count(item) for item in value)
        # Unknown type — stringify. Defensive; real callers shouldn't
        # hit this path, but returning 0 for a non-empty payload
        # would understate budget and raising would be worse.
        return self._count_string(str(value))

    def count_message(self, message: dict) -> int:
        """Count tokens in a single message dict.

        Convenience alias for :meth:`count` on a known-dict. Exists
        because callers that already know they hold a message read
        more clearly with a named method than with the generic
        ``count``.
        """
        return self._count_message(message)

    # ------------------------------------------------------------------
    # Counting — internals
    # ------------------------------------------------------------------

    def _count_string(self, text: str) -> int:
        """Tokenize a raw string.

        Uses the cached tiktoken encoding when available. Falls
        back to ``len(text) // chars_per_token`` when the encoder
        isn't loaded — graceful degradation per the module header.

        If the encoder is present but throws at runtime (a bad
        UTF-8 surrogate pair, unexpected internal state), we catch
        broadly and fall back rather than propagate. A failed
        tokenisation is a cosmetic budget issue; propagating would
        take down the streaming pipeline.
        """
        if not text:
            return 0
        if self._encoding is None:
            return len(text) // _CHARS_PER_TOKEN_FALLBACK
        try:
            return len(self._encoding.encode(text))
        except Exception as exc:
            logger.debug(
                "tiktoken encode failed on %d-char input: %s; "
                "falling back to char-count",
                len(text), exc,
            )
            return len(text) // _CHARS_PER_TOKEN_FALLBACK

    def _count_message(self, message: dict) -> int:
        """Tokenize a message dict.

        Message shape is provider-agnostic —
        ``{"role": ..., "content": ...}`` is the common denominator.
        Content can be:

        - A string (plain text message)
        - A list of content blocks for multimodal messages, where
          each block is a dict with a ``type`` field and a content
          field (``text`` for text, ``image_url`` for images, etc.)

        We count:

        - Role name (small, but consistent across providers)
        - Text content from every text-bearing block
        - A flat per-image estimate for image blocks — provider
          tokenisation of images varies wildly (Anthropic uses image
          dimensions, OpenAI uses tile counts) and we don't have
          the dimensions here. :data:`_IMAGE_TOKEN_ESTIMATE` is
          deliberately generous so budget decisions err on the safe
          side.

        Unknown block types are stringified as a last resort. Keeps
        the method total; no block shape causes a zero count on
        meaningful content.
        """
        total = 0
        role = message.get("role") or ""
        if role:
            total += self._count_string(role)

        content = message.get("content")
        if isinstance(content, str):
            total += self._count_string(content)
        elif isinstance(content, list):
            for block in content:
                total += self._count_block(block)
        elif content is not None:
            # Unknown content shape — stringify.
            total += self._count_string(str(content))

        return total

    def _count_block(self, block: Any) -> int:
        """Count tokens in a single multimodal content block.

        Block shapes we handle:

        - ``{"type": "text", "text": "..."}`` — text block from the
          Anthropic / OpenAI message format. Count the ``text``
          field.
        - ``{"type": "image", ...}`` or ``{"type": "image_url", ...}``
          — image block. Use :data:`_IMAGE_TOKEN_ESTIMATE` rather
          than trying to compute a precise per-provider value (we
          don't have the image dimensions here, and the two
          providers tokenise images differently anyway).
        - ``str`` — bare string inside a content list. Rare, but
          some callers pass pre-flattened content. Count as text.
        - Anything else — stringify the block.

        Returning a too-low count would understate budget and risk
        overruns; overstating by a few tokens per image is harmless
        and keeps us on the safe side of any provider's hard limit.
        """
        if isinstance(block, str):
            return self._count_string(block)
        if not isinstance(block, dict):
            return self._count_string(str(block))
        block_type = block.get("type")
        if block_type == "text":
            text = block.get("text") or ""
            return self._count_string(text)
        if block_type in ("image", "image_url"):
            return _IMAGE_TOKEN_ESTIMATE
        # Unknown block type — stringify the whole block. Defensive
        # against future provider extensions (e.g. audio, video).
        return self._count_string(str(block))