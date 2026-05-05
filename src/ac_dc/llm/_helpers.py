"""Pure helper functions extracted from :mod:`ac_dc.llm_service`.

All helpers here are side-effect-free or take explicit dependencies
as arguments; none require an :class:`LLMService` instance. The
service module re-exports these so external callers and tests can
continue to import from ``ac_dc.llm_service``.
"""

from __future__ import annotations

import json
import logging
import random
import re
import time
from concurrent.futures import ThreadPoolExecutor
from typing import TYPE_CHECKING, Any, Callable

from ac_dc.history_compactor import TopicBoundary
from ac_dc.token_counter import TokenCounter

if TYPE_CHECKING:
    from ac_dc.config import ConfigManager

logger = logging.getLogger("ac_dc.llm_service")


# ---------------------------------------------------------------------------
# Module-level constants used only by helpers below
# ---------------------------------------------------------------------------
#
# Kept here (rather than in _types.py) because only _build_topic_detector
# reads them; moving them up would add imports elsewhere for no gain.

from ac_dc.llm._types import (
    _DETECTOR_MAX_MESSAGES,
    _DETECTOR_MSG_TRUNCATE_CHARS,
)


# ---------------------------------------------------------------------------
# Max-tokens resolution
# ---------------------------------------------------------------------------


def _resolve_max_output_tokens(
    config: "ConfigManager",
    counter: TokenCounter,
) -> int:
    """Resolve the effective ``max_tokens`` for an LLM call.

    Two-level fallback chain per specs-reference/3-llm/
    streaming.md § Max-tokens resolution:

    1. ``config.max_output_tokens`` — user override in ``llm.json``
    2. ``counter.max_output_tokens`` — per-model ceiling

    The config value may lower the ceiling but cannot raise it —
    a user configuring 200K on a model that only supports 64K
    would produce a provider 400. We clamp against the counter
    ceiling as a safety net.

    Returned value is always a positive int. Used by every
    :func:`litellm.completion` call site so no path can silently
    inherit the provider default (which varies across providers
    and led to 4096-token truncation before this was wired up).
    """
    ceiling = counter.max_output_tokens
    override = config.max_output_tokens
    if override is None:
        return ceiling
    return min(override, ceiling)


# ---------------------------------------------------------------------------
# Finish-reason extraction
# ---------------------------------------------------------------------------


def _extract_finish_reason(chunk: Any) -> str | None:
    """Extract the ``finish_reason`` from a streaming chunk.

    Provider chunks use the OpenAI-compatible shape via litellm:
    ``chunk.choices[0].finish_reason`` — non-null on the final
    chunk, None on intermediates. Dict-form chunks come from some
    providers; we accept both attribute and key access.

    Returns None on any extraction failure (malformed chunk,
    empty choices array, missing attribute). Non-None means the
    stream is terminating — the worker should capture the value
    and propagate it into the completion result.

    Values we see in the wild, documented in
    specs-reference/3-llm/streaming.md § Finish reason values:

    - ``"stop"`` — natural end of generation
    - ``"end_turn"`` — Anthropic passthrough (also natural)
    - ``"length"`` — hit ``max_tokens``; response truncated
    - ``"content_filter"`` — safety filter triggered
    - ``"tool_calls"`` / ``"function_call"`` — model wants a tool

    The UI treats ``stop``/``end_turn`` as natural (muted badge)
    and everything else as abnormal (red badge + toast).
    """
    try:
        choices = getattr(chunk, "choices", None)
        if choices is None and isinstance(chunk, dict):
            choices = chunk.get("choices")
        if not choices:
            return None
        first = choices[0]
        reason = getattr(first, "finish_reason", None)
        if reason is None and isinstance(first, dict):
            reason = first.get("finish_reason")
        if reason is None:
            return None
        return str(reason)
    except (AttributeError, IndexError, KeyError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Request ID generation
# ---------------------------------------------------------------------------


def _generate_request_id() -> str:
    """Generate a request ID — ``{epoch_ms}-{6-char-alnum}``.

    Format matches specs3's frontend convention so request IDs are
    interchangeable across the boundary. Epoch prefix gives stable
    chronological ordering; random suffix handles same-millisecond
    ties (rare but possible).
    """
    epoch_ms = int(time.time() * 1000)
    alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
    suffix = "".join(random.choices(alphabet, k=6))
    return f"{epoch_ms}-{suffix}"


# ---------------------------------------------------------------------------
# Compaction event text
# ---------------------------------------------------------------------------


def _build_compaction_event_text(
    result: Any,
    tokens_before: int,
    tokens_after: int,
    messages_before_count: int,
    messages_after_count: int,
) -> str:
    """Build the system-event message text for a successful compaction.

    Three-part format per IMPLEMENTATION_NOTES.md's compaction UI
    plan:

      **History compacted** — {case}

      {boundary reason or fallback}

      Removed N messages • Mtokens → Ntokens

    For summarize cases, appends a ``<details>/<summary>`` block
    carrying the detector's summary text so the LLM can see what
    was summarized on session reload, and users can expand it in
    the chat panel (marked.js passes through HTML tags with gfm
    enabled).

    Returns the raw markdown string. The caller wraps it in an
    ``add_message`` / ``append_message`` pair with
    ``system_event=True`` so the chat panel renders it with the
    system-event styling.

    ``result`` is typed Any rather than CompactionResult to avoid
    a circular dependency concern at the top of this module; the
    caller always passes a CompactionResult instance.
    """
    case_name = result.case
    # Boundary line — truncate uses the detected reason, summarize
    # falls back to a generic "no clear boundary" line when the
    # detector couldn't find one. result.boundary is always
    # populated for truncate, and often for summarize; defensive
    # getattr keeps us safe if a future code path produces None.
    boundary = getattr(result, "boundary", None)
    if case_name == "truncate" and boundary:
        reason = getattr(boundary, "boundary_reason", "") or "topic boundary"
        confidence = getattr(boundary, "confidence", 0.0) or 0.0
        boundary_line = (
            f"Boundary: {reason} (confidence {confidence:.2f})"
        )
    elif case_name == "summarize":
        if boundary and getattr(boundary, "boundary_reason", ""):
            boundary_line = (
                f"Boundary reason: {boundary.boundary_reason}"
            )
        else:
            boundary_line = (
                "No clear topic boundary detected; summarized "
                "earlier context."
            )
    else:
        # "none" case shouldn't reach here (caller only runs this
        # on truncate/summarize) but handle defensively so a future
        # code path doesn't produce a malformed message.
        boundary_line = "History compacted"

    messages_removed = max(
        0, messages_before_count - messages_after_count
    )
    stats_line = (
        f"Removed {messages_removed} messages • "
        f"{tokens_before} → {tokens_after} tokens"
    )

    parts = [
        f"**History compacted** — {case_name}",
        "",
        boundary_line,
        "",
        stats_line,
    ]

    # Summarize case gets an expandable details block with the
    # actual summary text. Truncate doesn't — the reason line
    # already explains what happened, and there's no separate
    # summary body to show (truncate keeps full text).
    summary_text = getattr(result, "summary", "") or ""
    if case_name == "summarize" and summary_text.strip():
        parts.extend([
            "",
            "<details>",
            "<summary>Summary</summary>",
            "",
            summary_text.strip(),
            "",
            "</details>",
        ])

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Topic detector closure factory
# ---------------------------------------------------------------------------


def _build_topic_detector(
    config: "ConfigManager",
    aux_executor: ThreadPoolExecutor,
) -> Callable[[list[dict[str, Any]]], TopicBoundary]:
    """Build the detector callable injected into HistoryCompactor.

    The returned callable:
    1. Formats messages as indexed blocks
    2. Truncates long messages and caps total count
    3. Calls ``litellm.completion`` with the compaction system prompt
    4. Parses the JSON response (with tolerance for markdown fences)
    5. Returns a TopicBoundary — or the safe default on any failure

    Called from the compactor synchronously. The compactor wraps the
    call in its own try/except, so even if this helper raises the
    result is safe-defaulted. But we return the safe default
    internally too for clarity.
    """

    def _format_for_detector(messages: list[dict[str, Any]]) -> str:
        """Produce the ``[N] ROLE: content`` block format."""
        # Cap to recent messages — older ones are already
        # summarized in practice, and a huge prompt wastes tokens.
        tail = messages[-_DETECTOR_MAX_MESSAGES:]
        # Preserve original indices so the detector's
        # boundary_index is meaningful in the full message list.
        start_idx = len(messages) - len(tail)
        lines: list[str] = []
        for i, msg in enumerate(tail):
            idx = start_idx + i
            role = msg.get("role", "user").upper()
            content = msg.get("content", "") or ""
            if not isinstance(content, str):
                content = str(content)
            if len(content) > _DETECTOR_MSG_TRUNCATE_CHARS:
                content = (
                    content[:_DETECTOR_MSG_TRUNCATE_CHARS]
                    + "... (truncated)"
                )
            lines.append(f"[{idx}] {role}: {content}")
        return "\n\n".join(lines)

    def _parse_detector_response(text: str) -> TopicBoundary:
        """Parse the JSON detector response.

        Tolerates markdown fences — LLMs sometimes wrap JSON in
        ``` even when told not to. Returns safe defaults on any
        parse failure.
        """
        # Strip code fences if present.
        stripped = text.strip()
        # Match ``` optionally followed by a language tag on the first
        # line, and ``` on the last. Pull out the interior.
        fence_match = re.match(
            r"^```(?:json)?\s*\n(.*)\n```\s*$",
            stripped,
            re.DOTALL,
        )
        if fence_match:
            stripped = fence_match.group(1).strip()
        try:
            data = json.loads(stripped)
        except json.JSONDecodeError:
            logger.warning(
                "Topic detector returned unparseable JSON: %r",
                text[:200],
            )
            return TopicBoundary(None, "unparseable", 0.0, "")
        if not isinstance(data, dict):
            return TopicBoundary(None, "unexpected shape", 0.0, "")
        boundary_index = data.get("boundary_index")
        if boundary_index is not None and not isinstance(
            boundary_index, int
        ):
            boundary_index = None
        reason = data.get("boundary_reason", "")
        if not isinstance(reason, str):
            reason = ""
        try:
            confidence = float(data.get("confidence", 0.0))
        except (TypeError, ValueError):
            confidence = 0.0
        confidence = max(0.0, min(1.0, confidence))
        summary = data.get("summary", "")
        if not isinstance(summary, str):
            summary = ""
        return TopicBoundary(
            boundary_index=boundary_index,
            boundary_reason=reason,
            confidence=confidence,
            summary=summary,
        )

    def _detect(messages: list[dict[str, Any]]) -> TopicBoundary:
        """The callable handed to HistoryCompactor."""
        # Import litellm lazily — it's a heavyweight import and we
        # want the service module to load cleanly in tests that
        # don't exercise the detector path.
        try:
            import litellm
        except ImportError:
            logger.warning(
                "litellm not available; topic detection disabled"
            )
            return TopicBoundary(None, "litellm missing", 0.0, "")

        system_prompt = config.get_compaction_prompt()
        if not system_prompt:
            return TopicBoundary(None, "prompt missing", 0.0, "")

        user_prompt = _format_for_detector(messages)
        if not user_prompt:
            return TopicBoundary(None, "no messages", 0.0, "")

        model = config.smaller_model
        # Topic-detector responses are small (short JSON), but we
        # still pass max_tokens so the call is consistent with
        # the rest of the LLM surface and so a provider that
        # defaults to a tiny ceiling (e.g. 512) doesn't truncate
        # mid-JSON and produce an unparseable reply.
        detector_counter = TokenCounter(model)
        max_output = _resolve_max_output_tokens(
            config, detector_counter
        )
        try:
            # Non-streaming call — we want the full JSON response
            # before parsing.
            response = litellm.completion(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                stream=False,
                max_tokens=max_output,
            )
        except Exception as exc:
            # Classify for richer log output. Topic detection
            # always degrades to a safe default on failure —
            # we don't propagate structured errors upward
            # because the compactor's caller isn't equipped to
            # react to them (no UI surface for "detection
            # failed due to rate limit" — the compaction just
            # falls through to summarize mode).
            info = _classify_litellm_error(litellm, exc)
            logger.warning(
                "Topic detection LLM call failed: "
                "type=%s provider=%s msg=%s",
                info.get("error_type"),
                info.get("provider"),
                info.get("message"),
            )
            return TopicBoundary(None, "llm failure", 0.0, "")

        # litellm returns an OpenAI-shaped response object.
        try:
            content = response.choices[0].message.content
        except (AttributeError, IndexError, KeyError):
            logger.warning(
                "Topic detection response had unexpected shape"
            )
            return TopicBoundary(None, "bad response", 0.0, "")

        if not isinstance(content, str) or not content.strip():
            return TopicBoundary(None, "empty response", 0.0, "")

        return _parse_detector_response(content)

    # aux_executor is accepted but unused at the moment — the
    # detector call happens inside the compactor's synchronous
    # context (post-response housekeeping). If a future revision
    # wants to pre-empt the detector call onto the aux pool to
    # overlap with other post-response work, the handle is here.
    del aux_executor

    return _detect


# ---------------------------------------------------------------------------
# Cost extraction from LiteLLM responses
# ---------------------------------------------------------------------------


def _extract_response_cost(
    cost_source: Any,
    litellm_module: Any,
    usage: Any,
) -> float | None:
    """Pull the USD cost for a completion from LiteLLM.

    Tries three locations in order:

    1. ``cost_source._hidden_params["response_cost"]`` — the
       primary location. LiteLLM populates this on the response
       object (non-streaming) and on the stream wrapper
       (streaming) as it receives usage.
    2. ``cost_source.response_cost`` — some provider
       integrations expose it as a direct attribute.
    3. ``litellm.completion_cost(completion_response=cost_source)``
       — computes from the usage dict using LiteLLM's pricing
       table. Final fallback when the hidden-params path didn't
       populate.

    Returns None when none of the paths produced a numeric cost.
    Callers treat None as "unknown"; the frontend renders it as "—".
    """
    del usage  # signature preserved for call-site compatibility
    # Path 1 — _hidden_params["response_cost"].
    try:
        hidden = getattr(cost_source, "_hidden_params", None)
        if isinstance(hidden, dict):
            raw = hidden.get("response_cost")
            if raw is not None:
                return float(raw)
    except (TypeError, ValueError, AttributeError):
        pass

    # Path 2 — direct attribute.
    try:
        raw = getattr(cost_source, "response_cost", None)
        if raw is not None:
            return float(raw)
    except (TypeError, ValueError, AttributeError):
        pass

    # Path 3 — litellm.completion_cost(). The function signature
    # varies slightly across LiteLLM versions; pass the response
    # object positionally as the primary arg and accept any of
    # the supported shapes. Failures (unknown model, missing
    # pricing, malformed response) return None — we don't want
    # pricing to abort a stream.
    try:
        cost_fn = getattr(litellm_module, "completion_cost", None)
        if cost_fn is not None and cost_source is not None:
            raw = cost_fn(completion_response=cost_source)
            if raw is not None:
                return float(raw)
    except Exception as exc:
        # LiteLLM raises various pricing-related exceptions
        # (NotFoundError for unknown models, BadRequestError for
        # malformed usage). Log at debug — unknown models are a
        # normal case, not an error the user needs to see.
        logger.debug(
            "litellm.completion_cost failed: %s", exc
        )

    return None


# ---------------------------------------------------------------------------
# LiteLLM exception classification
# ---------------------------------------------------------------------------


def _classify_litellm_error(
    litellm_module: Any,
    exc: BaseException,
) -> dict[str, Any]:
    """Map a LiteLLM exception to a structured error dict.

    LiteLLM's exception hierarchy normalises provider errors into
    a small set of typed classes — each carrying ``status_code``,
    ``model``, ``llm_provider``, and sometimes ``response`` with
    a ``Retry-After`` header. This classifier reads those
    attributes into a flat dict the frontend can dispatch on.

    Recognised types and their intended UX:

    - ``context_window_exceeded`` — the prompt (including
      history) exceeds the model's input window. Actionable:
      trigger compaction or drop files. Frontend shows a toast
      with a "Compact now" action.
    - ``rate_limit`` — provider throttled the request.
      Actionable: wait and retry. Frontend shows a countdown
      toast using the ``retry_after`` field when populated
      (LiteLLM surfaces the ``Retry-After`` header on the
      exception's ``response`` attribute).
    - ``authentication`` — API key invalid or missing.
      Actionable: edit LLM config. Frontend shows a toast with
      a "Open Settings" action.
    - ``bad_request`` — malformed request (usually a schema
      mismatch between AC⚡DC's request shape and the
      provider's expectations). Actionable: file a bug;
      frontend shows the raw provider message.
    - ``api_connection`` — network/transport failure before the
      request reached the provider. Actionable: check internet /
      corporate proxy.
    - ``service_unavailable`` — provider reported 503 or
      equivalent. Actionable: wait; may retry.
    - ``timeout`` — request took longer than LiteLLM's
      configured timeout.
    - ``not_found`` — model identifier doesn't exist for the
      configured provider. Actionable: verify the model name in
      LLM config.
    - ``llm_error`` — catch-all for exceptions not matching any
      recognised LiteLLM subclass. Original exception type name
      captured in ``original_type`` for debugging.

    The classification tries the most specific types first.
    LiteLLM's class hierarchy has ``ContextWindowExceededError``
    as a subclass of ``BadRequestError`` (400 with specific
    error code), so checking the window error BEFORE the
    generic bad-request matters — otherwise every context
    overflow would be mis-tagged.

    Returns a dict with at minimum ``error_type`` and
    ``message``. Additional fields populated when present on the
    exception object.
    """
    info: dict[str, Any] = {
        "error_type": "llm_error",
        "message": str(exc),
        "retry_after": None,
        "status_code": None,
        "provider": None,
        "model": None,
        "original_type": type(exc).__name__,
    }

    # Pull common metadata first — present on most LiteLLM
    # exception types. Guarded access because not every
    # exception in the chain carries these attributes (wrapped
    # third-party errors sometimes don't).
    info["status_code"] = getattr(exc, "status_code", None)
    info["model"] = getattr(exc, "model", None)
    info["provider"] = getattr(exc, "llm_provider", None)

    # Classification. Each branch uses getattr on the module so
    # a LiteLLM version that drops one of these classes doesn't
    # crash classification — the attribute lookup returns None
    # and isinstance(exc, None) is False, so the branch is
    # skipped.
    exceptions_mod = getattr(litellm_module, "exceptions", None)

    def _cls(name: str) -> type | None:
        """Locate a LiteLLM exception class by name.

        Some versions expose classes on the top-level module,
        others nest them under ``litellm.exceptions``. Check
        both; return None if neither has it.
        """
        cls = getattr(litellm_module, name, None)
        if cls is None and exceptions_mod is not None:
            cls = getattr(exceptions_mod, name, None)
        if isinstance(cls, type):
            return cls
        return None

    ctx_cls = _cls("ContextWindowExceededError")
    rate_cls = _cls("RateLimitError")
    auth_cls = _cls("AuthenticationError")
    not_found_cls = _cls("NotFoundError")
    bad_req_cls = _cls("BadRequestError")
    conn_cls = _cls("APIConnectionError")
    unavail_cls = _cls("ServiceUnavailableError")
    timeout_cls = _cls("Timeout")

    # Order matters: more-specific subclasses first.
    if ctx_cls is not None and isinstance(exc, ctx_cls):
        info["error_type"] = "context_window_exceeded"
    elif rate_cls is not None and isinstance(exc, rate_cls):
        info["error_type"] = "rate_limit"
        # Retry-After extraction. LiteLLM attaches the original
        # httpx/requests response as .response on some exception
        # types; the header is "retry-after" (lowercase in httpx,
        # case-insensitive lookup). Parse as float seconds; fall
        # back to None on any shape mismatch.
        resp = getattr(exc, "response", None)
        if resp is not None:
            headers = getattr(resp, "headers", None)
            if headers is not None:
                try:
                    raw = headers.get("retry-after") or headers.get(
                        "Retry-After"
                    )
                    if raw is not None:
                        info["retry_after"] = float(raw)
                except (TypeError, ValueError, AttributeError):
                    pass
    elif auth_cls is not None and isinstance(exc, auth_cls):
        info["error_type"] = "authentication"
    elif not_found_cls is not None and isinstance(exc, not_found_cls):
        info["error_type"] = "not_found"
    elif bad_req_cls is not None and isinstance(exc, bad_req_cls):
        # Checked AFTER ContextWindowExceededError because the
        # latter is a subclass of BadRequestError.
        info["error_type"] = "bad_request"
    elif conn_cls is not None and isinstance(exc, conn_cls):
        info["error_type"] = "api_connection"
    elif unavail_cls is not None and isinstance(exc, unavail_cls):
        info["error_type"] = "service_unavailable"
    elif timeout_cls is not None and isinstance(exc, timeout_cls):
        info["error_type"] = "timeout"

    return info


# ---------------------------------------------------------------------------
# Agent tag parsing
# ---------------------------------------------------------------------------


def _parse_agent_tag(
    agent_tag: Any,
) -> tuple[str, int] | None:
    """Coerce an incoming agent_tag into a ``(turn_id, agent_idx)`` tuple.

    JRPC-OO serialises tuples to JS arrays on the wire; tests
    and direct callers use the tuple form. Both shapes are
    accepted. Returns None when the payload is structurally
    malformed (wrong length, wrong types).
    """
    if not isinstance(agent_tag, (list, tuple)):
        return None
    if len(agent_tag) != 2:
        return None
    turn_id_raw, agent_idx_raw = agent_tag
    if not isinstance(turn_id_raw, str) or not turn_id_raw:
        return None
    # Accept int or int-compatible. Reject bool because ``bool``
    # is a subclass of ``int`` and True/False silently matching
    # agent_idx 1/0 would mask bugs in upstream code that forgot
    # to parse a string.
    if isinstance(agent_idx_raw, bool):
        return None
    if not isinstance(agent_idx_raw, int):
        return None
    if agent_idx_raw < 0:
        return None
    return (turn_id_raw, agent_idx_raw)