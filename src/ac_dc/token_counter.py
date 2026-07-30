"""Token counter — cheap, deterministic token estimation.

Every LLM-facing piece of Layer 3 needs accurate token counts: the
context manager for budget enforcement, the history compactor for
trigger thresholds, the stability tracker for cache-target decisions,
the prompt assembler for the token HUD.

Design points pinned by the spec (specs4/1-foundation/configuration.md
and specs-reference/1-foundation/configuration.md § Token counter
defaults for the concrete numbers):

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
import re
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Model-family limits
# ---------------------------------------------------------------------------
#
# All values from specs-reference/1-foundation/configuration.md § Token
# counter defaults. The spec is the authoritative source — do not derive
# these from provider docs at runtime.

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

# Claude family + version extractor. Handles every id shape we see:
# bare (``claude-opus-5``), Anthropic-prefixed
# (``anthropic/claude-sonnet-4-6``), Bedrock-dotted with a regional
# prefix (``bedrock/au.anthropic.claude-opus-5``), and either with a
# release-date and/or revision suffix (``-20251101-v1:0``). Minor
# separator may be a dash or a dot.
#
# Capping the minor at two digits (with a negative lookahead) is what
# keeps a date suffix out of the version: in
# ``claude-opus-4-20250514`` the minor group can't swallow
# ``20250514``, so it reads as 4.0, not 4.20. Pre-4 ids order the
# segments the other way (``claude-3-5-sonnet``) and deliberately
# don't match — they all sit in the oldest bucket anyway.
_CLAUDE_MODEL_RE = re.compile(
    r"claude-([a-z]+)-(\d{1,2})(?!\d)(?:[-._](\d{1,2})(?!\d))?"
)

# Per-family output token ceilings, keyed by family name and floored
# by (major, minor) version. Each entry lists thresholds newest-first;
# the first whose version floor is met wins. Comparing versions rather
# than enumerating names means a new release inherits its family's
# current ceiling instead of silently dropping to the 8192 catch-all
# below — the failure mode that truncated Opus 5 responses to 8K.
#
# Values from provider documentation (Anthropic publishes these under
# "Output length" per model; the Bedrock model cards agree). The spec
# forbids runtime provider queries, so a genuinely new ceiling still
# needs an edit here — but only when the number actually changes.
_FAMILY_OUTPUT_CEILINGS: dict[str, tuple[tuple[tuple[int, int], int], ...]] = {
    # Opus 4.5+ — 128K output window.
    "opus": (((4, 5), 128_000),),
    # Sonnet 5 and Sonnet 4.6 — 128K; Sonnet 4.5 — 64K.
    "sonnet": (((4, 6), 128_000), ((4, 5), 64_000)),
    # Haiku 4.5+ — 64K output window.
    "haiku": (((4, 5), 64_000),),
    # Fable / Mythos launched at 5 with a 128K window.
    "fable": (((5, 0), 128_000),),
    "mythos": (((5, 0), 128_000),),
}

# Non-Claude ceilings, matched by lowercase substring.
_OTHER_OUTPUT_CEILINGS: tuple[tuple[tuple[str, ...], int], ...] = (
    # GPT-4 family — 16K output window.
    (("gpt-4",), 16_384),
)

# Older Claude (3.x, 2.x, and 4.x below the per-family floors above)
# — 8K output window. Catch-all for any ``claude``/``anthropic``
# model that didn't resolve to a family ceiling.
_LEGACY_CLAUDE_OUTPUT_CEILING = 8_192

# Minimum cacheable prefix per family, same newest-first structure as
# the output ceilings. Not monotonic across generations: Opus 5 halved
# Opus 4.8's minimum, and 4.6/4.5 sit four times higher than either.
# Getting it wrong means the provider silently declines to cache the
# block and we eat the full ingestion cost on every request.
#
# This is the single copy of the table.
# ``ConfigManager._model_min_cacheable_tokens`` delegates to
# :func:`_min_cacheable_for` below; an earlier revision kept a second
# copy in ``config.py`` and the two drifted (a new Opus was added to
# one list only). The dependency runs one way — this module imports
# nothing from ``config`` — which is what keeps ``TokenCounter``
# constructible without a ``ConfigManager`` (tests rely on that).
#
# Sonnet is absent deliberately: every Sonnet generation takes the
# 1024 default. The Bedrock prompt-caching page lists Sonnet 4.5 at
# 4096, but Anthropic's per-model table and
# specs-reference/1-foundation/configuration.md both say 1024, so the
# majority reading wins.
_FAMILY_MIN_CACHEABLE: dict[
    str, tuple[tuple[tuple[int, int], int], ...]
] = {
    # Opus 5 → 512, 4.8 → 1024, 4.7 → 2048, 4.6/4.5 → 4096.
    "opus": (
        ((5, 0), 512),
        ((4, 8), 1024),
        ((4, 7), 2048),
        ((4, 5), 4096),
    ),
    # Haiku 4.5 → 4096. Haiku 3.5 is nominally 2048, but its real id
    # puts the family last (``claude-3-5-haiku-20241022``) and so
    # never parses here; leaving it off keeps both id spellings on
    # the same 1024 default rather than splitting them.
    "haiku": (((4, 5), 4096),),
    # Fable / Mythos 5 → 512, matching Opus 5.
    "fable": (((5, 0), 512),),
    "mythos": (((5, 0), 512),),
}

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


def _parse_claude_model(model: str) -> tuple[str, tuple[int, int]] | None:
    """Extract ``(family, (major, minor))`` from a Claude model id.

    Returns None for anything without a parseable
    ``claude-<family>-<version>`` segment: non-Claude models, and
    pre-4 Claude ids that put the family last
    (``claude-3-5-sonnet``). Callers fall back to their
    lowest-tier default in that case.

    A missing minor reads as 0 so bare majors order correctly —
    ``claude-opus-5`` yields ``("opus", (5, 0))``, which clears a
    ``(4, 8)`` floor as intended.
    """
    match = _CLAUDE_MODEL_RE.search(model.lower())
    if match is None:
        return None
    minor = match.group(3)
    return (
        match.group(1),
        (int(match.group(2)), int(minor) if minor is not None else 0),
    )


def _lookup_by_version(
    model: str,
    table: dict[str, tuple[tuple[tuple[int, int], int], ...]],
) -> int | None:
    """Resolve ``model`` against a family/version-floor ``table``.

    Walks the family's thresholds in declaration order (newest
    floor first) and returns the value for the first floor the
    model's version meets or exceeds. Returns None when the model
    isn't a parseable Claude id, its family isn't in the table, or
    its version predates every floor — the caller supplies the
    fallback, which differs per table.
    """
    parsed = _parse_claude_model(model)
    if parsed is None:
        return None
    family, version = parsed
    for floor, value in table.get(family, ()):
        if version >= floor:
            return value
    return None


def _min_cacheable_for(model: str) -> int:
    """Provider-minimum cacheable tokens for ``model``.

    Resolved from :data:`_FAMILY_MIN_CACHEABLE` by family and
    version — 512 on Opus/Fable/Mythos 5, 4096 on Opus 4.6/4.5 and
    Haiku 4.5, and so on. Anything unrecognised (non-Claude, or a
    Claude older than every listed floor) gets the 1024 default.
    """
    resolved = _lookup_by_version(model, _FAMILY_MIN_CACHEABLE)
    if resolved is not None:
        return resolved
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

        Resolution order:

        1. :data:`_FAMILY_OUTPUT_CEILINGS` — Claude family plus
           version floor (Opus 4.5+ → 128K, Sonnet 4.6+ → 128K,
           and so on). A release newer than every listed floor
           inherits its family's current ceiling.
        2. :data:`_OTHER_OUTPUT_CEILINGS` — non-Claude substring
           matches (GPT-4 → 16K).
        3. :data:`_LEGACY_CLAUDE_OUTPUT_CEILING` (8192) for any
           remaining ``claude``/``anthropic`` model — the 3.x/2.x
           generation and unversioned names.
        4. :data:`_DEFAULT_MAX_OUTPUT_TOKENS` (4096) for anything
           unrecognised. Conservative — better a shorter-than-
           possible response than a 400 for asking too much.

        A user-configured ``max_output_tokens`` in ``llm.json``
        can LOWER this ceiling but cannot raise it — see
        :meth:`ConfigManager.max_output_tokens`. The counter
        exposes the provider's hard ceiling; the config layer
        clamps the user's preference against it.
        """
        resolved = _lookup_by_version(self._model, _FAMILY_OUTPUT_CEILINGS)
        if resolved is not None:
            return resolved
        for markers, ceiling in _OTHER_OUTPUT_CEILINGS:
            if _matches(self._model, markers):
                return ceiling
        if _is_claude(self._model):
            return _LEGACY_CLAUDE_OUTPUT_CEILING
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

        Model-aware — 512 on Opus/Fable/Mythos 5, 1024 on Opus 4.8,
        2048 on Opus 4.7, 4096 on Opus 4.6/4.5 and Haiku 4.5, and
        1024 everywhere else (all Sonnet, older Claude, non-Claude).
        Used by
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