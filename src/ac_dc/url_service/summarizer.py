"""URL content summarizer — Layer 4.1.4.

Takes a fetched :class:`URLContent` and generates a summary via
the smaller/cheaper model, populating the ``summary`` and
``summary_type`` fields in place. The streaming handler will
call this after a fetch when the user has requested summarization
(or when the default-for-this-URL-type policy says to summarize).

Summary types — five prompt variants matching the LLM's
attention to different aspects of the content:

- ``BRIEF`` — 2–3 paragraph overview. Default for most URL types.
- ``USAGE`` — installation, patterns, key imports. Default for
  documentation URLs and when the user's text contains
  "how to".
- ``API`` — classes, functions, signatures. Triggered by user
  text containing "api".
- ``ARCHITECTURE`` — modules, design, data flow. Default for
  GitHub repos with a symbol map; triggered by "architecture".
- ``EVALUATION`` — maturity, dependencies, alternatives.
  Triggered by "compare" or "evaluate".

Design points pinned by specs4/4-features/url-content.md:

- **Fixed system message.** The system message is a simple
  "summarize the content" instruction. The type-specific
  focus goes into the user prompt as the first paragraph.
  Keeping the system message fixed means providers that
  penalize system-prompt changes (cache invalidation,
  rate-limiting heuristics) aren't affected by summary-type
  selection.

- **Non-streaming call.** Summaries are short enough (few
  hundred tokens) that streaming adds latency without user
  benefit. Blocking `litellm.completion(stream=False)` keeps
  the call synchronous; the caller (URL service) schedules
  it via `run_in_executor` so the event loop stays
  responsive.

- **Body truncation at 100k chars.** Very long README or
  documentation content is truncated with an ellipsis
  suffix so a single URL can't blow out the summarizer's
  input budget. 100k characters ≈ 25k tokens with the
  smaller model's tokenizer — large enough that the summary
  still captures the main content, small enough that a single
  fetch can't monopolize the summarizer budget.

- **Symbol map appended, not inlined.** When a GitHub repo
  fetch produced a symbol map, it's appended to the
  summarizer's prompt under its own header. This gives the
  LLM structural context (class names, function signatures)
  that raw README prose wouldn't convey, and it appears
  after the body so the LLM reads the human-authored
  overview first.

- **Fallback summary on error.** If the summarizer LLM call
  fails (timeout, network error, malformed response), the
  ``summary`` field stays None and ``summary_type`` is set
  to ``"error"``. The caller decides whether to retry or
  surface the error — typical behavior is to skip the
  summary and use the raw content.

- **Auto-type selection.** ``choose_summary_type`` picks a
  type based on URL type and user text keywords. The user
  text is optional (streaming handler passes the user's
  prompt; direct RPC calls pass nothing). When absent,
  falls back to URL-type defaults.

Governing spec: ``specs4/4-features/url-content.md#summarization``.
"""

from __future__ import annotations

import logging
from enum import Enum

from ac_dc.url_service.detection import URLType
from ac_dc.url_service.models import URLContent

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Summary type enum
# ---------------------------------------------------------------------------


class SummaryType(str, Enum):
    """The kind of summary to produce.

    Subclasses :class:`str` so the value can be stored directly
    in :class:`URLContent.summary_type` without unwrapping.
    """

    BRIEF = "brief"
    USAGE = "usage"
    API = "api"
    ARCHITECTURE = "architecture"
    EVALUATION = "evaluation"


# ---------------------------------------------------------------------------
# Module constants
# ---------------------------------------------------------------------------


# Per-type focus prompts. Prepended to the user message so the
# LLM knows what angle to summarize from. The "Content from {url}"
# header follows in the assembled prompt so the LLM also knows
# the source.
_FOCUS_PROMPTS: dict[SummaryType, str] = {
    SummaryType.BRIEF: (
        "Provide a concise 2-3 paragraph overview of the following "
        "content. Focus on what it is, what it does, and why "
        "someone might want to use or read it."
    ),
    SummaryType.USAGE: (
        "Summarize the following content focusing on practical "
        "usage: installation, common patterns, key imports, and "
        "typical examples. Skip theoretical background unless "
        "essential."
    ),
    SummaryType.API: (
        "Summarize the following content focusing on the API "
        "surface: classes, functions, signatures, and their "
        "intended use. List the most commonly-used entry points."
    ),
    SummaryType.ARCHITECTURE: (
        "Summarize the following content focusing on architecture: "
        "modules, subsystems, design choices, and how data flows "
        "through the system. Describe the component boundaries."
    ),
    SummaryType.EVALUATION: (
        "Summarize the following content focusing on evaluation: "
        "project maturity, dependencies, license, active "
        "maintenance signals, and how it compares to alternatives."
    ),
}

# Fixed system message. Providers that cache system prompts
# (Anthropic's prompt caching in particular) benefit when the
# system message doesn't vary per request — see the spec's
# "fixed system message" note.
_SYSTEM_MESSAGE = (
    "You are a concise technical writer. Summarize content "
    "clearly and factually without speculation or editorializing."
)

# Body truncation threshold. 100k chars ≈ 25k tokens for most
# content. Keeps a single URL from monopolizing the summarizer's
# input budget while still capturing the main content.
_BODY_MAX_CHARS = 100_000

# Max completion tokens for the summary. Summaries should be
# short — 2-3 paragraphs fit comfortably in 500 tokens.
_SUMMARY_MAX_TOKENS = 500


# Keyword → type mapping for user-text-driven override. Checked
# in order; first match wins. Case-insensitive substring match.
_USER_TEXT_TRIGGERS: tuple[tuple[str, SummaryType], ...] = (
    ("how to", SummaryType.USAGE),
    ("api", SummaryType.API),
    ("architecture", SummaryType.ARCHITECTURE),
    ("compare", SummaryType.EVALUATION),
    ("evaluate", SummaryType.EVALUATION),
)


# ---------------------------------------------------------------------------
# Type selection
# ---------------------------------------------------------------------------


def choose_summary_type(
    content: URLContent,
    user_text: str | None = None,
) -> SummaryType:
    """Pick a summary type from URL type + optional user text hints.

    User text keywords take precedence over URL-type defaults —
    if the user asks "how to use X" about a GitHub repo URL,
    they want USAGE, not ARCHITECTURE. Matching is
    case-insensitive substring; the first matching trigger wins.

    Falls through to URL-type defaults when no keyword matches:

    - GitHub repo WITH symbol map → ARCHITECTURE (the symbol
      map gives structural signal worth analyzing)
    - GitHub repo WITHOUT symbol map → BRIEF (just a README;
      overview is more useful than forced architecture
      commentary on sparse content)
    - GitHub file → BRIEF (a single file doesn't carry enough
      for architecture/usage analysis by default)
    - Documentation → USAGE (docs are read for usage; that's
      the default angle)
    - Generic → BRIEF
    """
    # User text hints win.
    if user_text:
        lowered = user_text.lower()
        for keyword, summary_type in _USER_TEXT_TRIGGERS:
            if keyword in lowered:
                return summary_type

    # URL-type defaults.
    if content.url_type == URLType.GITHUB_REPO.value:
        return (
            SummaryType.ARCHITECTURE
            if content.symbol_map
            else SummaryType.BRIEF
        )
    if content.url_type == URLType.DOCUMENTATION.value:
        return SummaryType.USAGE
    # GITHUB_FILE, GITHUB_ISSUE, GITHUB_PR, GENERIC all default
    # to BRIEF — a safe overview is always useful.
    return SummaryType.BRIEF


# ---------------------------------------------------------------------------
# Prompt assembly
# ---------------------------------------------------------------------------


def _build_user_prompt(
    content: URLContent,
    summary_type: SummaryType,
) -> str:
    """Assemble the user prompt for the summarizer LLM call.

    Structure:

    1. Type-specific focus prompt
    2. Content-source header naming the URL
    3. Body — ``readme`` preferred over ``content`` (READMEs
       are higher-signal than raw web scrape), truncated at
       :data:`_BODY_MAX_CHARS`
    4. Symbol map (when present) under its own header

    Returns the assembled prompt as a single string. Empty
    content produces a minimal prompt ("no content available")
    rather than raising — the LLM will produce a short "no
    content to summarize" response which the caller can
    detect.
    """
    parts = [_FOCUS_PROMPTS[summary_type]]

    if content.url:
        parts.append(f"Content from {content.url}:")

    body = content.readme or content.content
    if body:
        if len(body) > _BODY_MAX_CHARS:
            body = body[:_BODY_MAX_CHARS] + "\n\n... (truncated)"
        parts.append(body)
    else:
        parts.append("(no content available)")

    if content.symbol_map:
        parts.append("Symbol Map:")
        parts.append(content.symbol_map)

    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Summarization
# ---------------------------------------------------------------------------


def summarize(
    content: URLContent,
    model: str,
    summary_type: SummaryType | None = None,
    user_text: str | None = None,
) -> URLContent:
    """Generate a summary for ``content`` and return an updated record.

    Does not mutate the input — returns a new :class:`URLContent`
    with ``summary`` and ``summary_type`` populated (or with
    ``summary_type`` set to ``"error"`` on failure).

    Parameters
    ----------
    content:
        The fetched URL content. Records with a non-empty
        ``error`` field are returned unchanged — we don't
        summarize failed fetches.
    model:
        Model identifier to use for summarization (typically
        the config's smaller model). Provider-prefixed string
        such as ``"anthropic/claude-haiku-4-5-20251001"``.
    summary_type:
        Optional explicit type. When None, picked by
        :func:`choose_summary_type` from URL type + user text.
    user_text:
        Optional user prompt for auto-type selection. Ignored
        when ``summary_type`` is explicit.

    Returns
    -------
    URLContent
        A new record with summary fields set, or the original
        record when the input had an error. The caller should
        update its cache / in-memory store with the returned
        value — this is a functional-style return rather than
        in-place mutation so callers can't forget to propagate
        the update.
    """
    # Error records pass through unchanged.
    if content.error:
        return content

    # Pick type if not specified.
    effective_type = summary_type or choose_summary_type(
        content, user_text
    )

    user_prompt = _build_user_prompt(content, effective_type)

    # litellm import is lazy — only loaded when we actually
    # summarize. Keeps the service module importable in tests
    # that don't exercise the summarizer path.
    try:
        import litellm
    except ImportError:
        logger.warning(
            "litellm not available; cannot summarize %s",
            content.url,
        )
        return _with_error_summary(content, effective_type)

    try:
        response = litellm.completion(
            model=model,
            messages=[
                {"role": "system", "content": _SYSTEM_MESSAGE},
                {"role": "user", "content": user_prompt},
            ],
            stream=False,
            max_tokens=_SUMMARY_MAX_TOKENS,
        )
    except Exception as exc:
        logger.warning(
            "Summarization LLM call failed for %s: %s",
            content.url, exc,
        )
        return _with_error_summary(content, effective_type)

    try:
        summary_text = response.choices[0].message.content
    except (AttributeError, IndexError, KeyError):
        logger.warning(
            "Summarization response had unexpected shape for %s",
            content.url,
        )
        return _with_error_summary(content, effective_type)

    if not isinstance(summary_text, str) or not summary_text.strip():
        logger.debug("Empty summary for %s", content.url)
        return _with_error_summary(content, effective_type)

    # Build a new record with summary fields populated. Using
    # dataclass replacement via dict round-trip — to_dict / from_dict
    # round-trips every field including github_info.
    data = content.to_dict()
    data["summary"] = summary_text.strip()
    data["summary_type"] = effective_type.value
    return URLContent.from_dict(data)


def _with_error_summary(
    content: URLContent,
    summary_type: SummaryType,
) -> URLContent:
    """Return a copy with ``summary_type`` set to an error marker.

    The summary text itself remains None — callers check the
    ``summary_type`` field for the literal ``"error"`` to
    detect failed summarization. Keeps the data shape uniform
    (summary_type is always set when summarization was
    attempted).
    """
    data = content.to_dict()
    data["summary"] = None
    data["summary_type"] = "error"
    # Preserve attempted type in a dedicated field would be
    # nicer, but specs4 only defines summary/summary_type.
    # Callers that want the attempted type can pass it
    # explicitly on retry.
    del summary_type  # documented intent — not persisted
    return URLContent.from_dict(data)