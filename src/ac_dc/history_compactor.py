"""History compactor — summarise or truncate old messages.

The compactor keeps conversation history within a token budget
by detecting topic boundaries via a small LLM and replacing
pre-verbatim messages with either a summary pair (summarize
case) or a clean truncation (truncate case). The compacted
history takes effect on the next request.

Design points pinned by specs4/3-llm/history.md and specs3's
concrete algorithm:

- **Post-response housekeeping.** The compactor is invoked
  AFTER the assistant response is delivered to the user. It
  never blocks the user's turn. The streaming handler calls
  ``should_compact(history_tokens)`` to decide, then
  ``compact_history_if_needed(messages)`` to run.

- **Injected detection callable.** The compactor receives a
  ``detect_topic_boundary(messages) -> TopicBoundary`` callable
  at construction rather than calling litellm directly. This
  keeps the compactor testable (no external mocking), keeps
  LLM-calling concerns at the streaming-handler layer, and
  lines up with the D10 pattern of "injection points, not
  globals". A future parallel-agent mode (specs4/7-future)
  creates N compactors, each with its own detector callable —
  no shared state.

- **Live config reloading.** All threshold properties
  (``enabled``, ``trigger_tokens``, ``verbatim_window_tokens``,
  ``summary_budget_tokens``, ``min_verbatim_exchanges``) read
  from ``config_manager.compaction_config`` on every access.
  Hot-reloaded app.json values take effect on the next
  ``should_compact`` call without reconstructing the compactor.

- **Safe defaults on detector failure.** If the detector raises
  OR returns an unexpected shape, the compactor falls back to
  ``TopicBoundary(None, "detection failed", 0.0, "")`` — which
  drives the decision logic toward a safe summarize-everything
  case rather than leaving history unchanged. Matches specs3:
  "On failure or unparseable output — safe defaults (null
  boundary, zero confidence)".

- **Two-threshold verbatim window.** The verbatim boundary is
  the EARLIER (more inclusive) of two candidates:
  token-accumulated from the end, or min-user-message-count.
  This ensures recent context is always preserved regardless
  of which signal dominates for a given history shape.

- **Minimum-verbatim safeguard prepends from before the cut.**
  If the compacted result has fewer user messages than
  ``min_verbatim_exchanges``, earlier messages are prepended.
  For summarize, prepended AFTER the summary pair (at offset 2)
  so the LLM sees: summary → earlier context → verbatim window.

Governing spec: ``specs4/3-llm/history.md``.
Numeric reference: ``specs-reference/3-llm/history.md``.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Callable

if TYPE_CHECKING:
    from ac_dc.config import ConfigManager
    from ac_dc.token_counter import TokenCounter

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data shapes
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TopicBoundary:
    """Result from the topic-boundary detection LLM.

    Frozen because callers (the streaming handler, tests) pass
    these around and shouldn't need to defensively copy. Fields
    match specs3's JSON schema for the detector output.

    Fields
    ------
    boundary_index:
        Index (into the messages list) of the first message of
        the NEW topic. None when no boundary was detected or the
        detector couldn't produce a confident answer.
    boundary_reason:
        Human-readable description of what shifted. Stored but
        not used for decisions — the confidence threshold drives
        behaviour.
    confidence:
        0.0–1.0. The compactor uses ≥ 0.5 as the threshold for
        the truncate case (otherwise falls through to summarize).
    summary:
        Prose summary of the pre-boundary content. When the
        summarize case fires, this text becomes the body of the
        injected summary message. May be empty — if the detector
        didn't produce a summary and summarize fires, the
        compactor synthesises a generic placeholder.
    """

    boundary_index: int | None
    boundary_reason: str
    confidence: float
    summary: str


# The safe-default boundary returned when detection fails or is
# unavailable. None index + zero confidence drives the decision
# logic toward the "no boundary, fall through to summarize" path
# rather than leaving history unchanged — specs3 says "safe
# defaults" and compacting-to-summary is the conservative move
# when over budget.
_SAFE_BOUNDARY = TopicBoundary(
    boundary_index=None,
    boundary_reason="detection unavailable",
    confidence=0.0,
    summary="",
)


# Confidence threshold for the truncate case. Below this, even a
# non-None boundary index falls through to summarize. Matches
# specs3's explicit value.
_TRUNCATE_CONFIDENCE_THRESHOLD = 0.5


@dataclass
class CompactionResult:
    """Outcome of one compaction pass.

    Not frozen — the caller may want to attach metadata (e.g.,
    token counts before/after) before serialising for the
    frontend notification. Mutation after return is a caller
    concern; the compactor itself never re-reads a returned
    result.

    Fields
    ------
    case:
        ``"truncate"``, ``"summarize"``, or ``"none"``. ``"none"``
        means compaction was considered but no change produced
        (shouldn't happen via ``compact_history_if_needed``
        which returns None in that case — but ``apply_compaction``
        accepts "none" for symmetry with a "nothing to do"
        input).
    messages:
        The compacted message list. When ``case == "none"``
        this is the input list unchanged.
    boundary:
        The detected boundary, if any. Attached for UI display
        (the HUD's "recent changes" line) and for debugging —
        not read back by the compactor.
    summary:
        The summary text that replaced pre-verbatim messages.
        Present only in the summarize case.
    """

    case: str
    messages: list[dict[str, Any]] = field(default_factory=list)
    boundary: TopicBoundary | None = None
    summary: str | None = None


# ---------------------------------------------------------------------------
# HistoryCompactor
# ---------------------------------------------------------------------------


# Signature of the detector callable. A plain alias rather than
# Protocol because the callable is supplied by user code and
# shouldn't need to subclass anything — it just needs to be
# callable with the messages list.
DetectorCallable = Callable[[list[dict[str, Any]]], TopicBoundary]


# Fallback summary text when the detector produces a None boundary
# with empty summary — the over-budget case where we compact
# without a specific topic shift to describe. Intentionally brief;
# the LLM's follow-up turns fill in specifics.
_GENERIC_SUMMARY_FALLBACK = (
    "The prior conversation covered earlier topics that are not "
    "directly relevant to the current work."
)


class HistoryCompactor:
    """Summarise or truncate conversation history.

    Construct once per context manager, reuse across requests.
    Reads config live through ``config_manager`` so hot-reloaded
    threshold changes take effect without reconstruction.

    Not thread-safe — the streaming handler drives compaction
    from a single executor. Multiple compactor instances (future
    parallel-agent mode) operate on their own history lists and
    share no state.
    """

    def __init__(
        self,
        config_manager: "ConfigManager",
        token_counter: "TokenCounter",
        detect_topic_boundary: DetectorCallable | None = None,
    ) -> None:
        """Construct a compactor attached to a config + counter.

        Parameters
        ----------
        config_manager:
            Used for live reads of ``compaction_config``. The
            compactor holds the reference and reads on every
            property access; changing app.json and calling
            ``config_manager.reload_app_config()`` makes the new
            values visible on the next compaction check.
        token_counter:
            Used for verbatim-window boundary calculation (token
            accumulation from the end). Shared with the owning
            context manager — the compactor is a downstream
            consumer of the same counter.
        detect_topic_boundary:
            Optional callable that takes the messages list and
            returns a ``TopicBoundary``. When None, the
            compactor treats every call as "no boundary,
            confidence 0" which drives toward summarize-all on
            over-budget. The streaming handler injects the real
            detector (an LLM-calling closure) at construction.
        """
        self._config_manager = config_manager
        self._counter = token_counter
        self._detect = detect_topic_boundary

    # ------------------------------------------------------------------
    # Live config accessors
    # ------------------------------------------------------------------

    @property
    def _config(self) -> dict[str, Any]:
        """Current compaction_config dict. Read on every access."""
        return self._config_manager.compaction_config

    @property
    def enabled(self) -> bool:
        """Master switch."""
        return bool(self._config.get("enabled", True))

    @property
    def trigger_tokens(self) -> int:
        """History-token threshold above which compaction fires."""
        return int(self._config.get("compaction_trigger_tokens", 24000))

    @property
    def verbatim_window_tokens(self) -> int:
        """Tokens of recent history kept unchanged on compaction."""
        return int(self._config.get("verbatim_window_tokens", 4000))

    @property
    def summary_budget_tokens(self) -> int:
        """Target token budget for the generated summary text.

        Advisory — the detector's summary prompt targets this
        budget. The compactor doesn't enforce it on input (a
        large summary still goes through); it's passed through
        for the detector prompt to use.
        """
        return int(self._config.get("summary_budget_tokens", 500))

    @property
    def min_verbatim_exchanges(self) -> int:
        """Minimum user messages always preserved verbatim.

        Applied as a safeguard AFTER the main compaction —
        if the result has fewer user messages than this, earlier
        messages are prepended from before the cut point.
        """
        return int(self._config.get("min_verbatim_exchanges", 2))

    # ------------------------------------------------------------------
    # Decision — should compaction fire?
    # ------------------------------------------------------------------

    def should_compact(self, history_tokens: int) -> bool:
        """Return True when history exceeds the trigger threshold.

        Cheap — just a comparison and a config read. The context
        manager's budget reporter calls this every request; the
        streaming handler's post-response hook calls it again
        with the freshly-computed total.
        """
        if not self.enabled:
            return False
        if self.trigger_tokens <= 0:
            # Zero or negative trigger effectively disables —
            # defensive check so a typo in app.json doesn't
            # trigger compaction on every request.
            return False
        return history_tokens >= self.trigger_tokens

    # ------------------------------------------------------------------
    # Entry point
    # ------------------------------------------------------------------

    def compact_history_if_needed(
        self,
        messages: list[dict[str, Any]],
        already_checked: bool = False,
    ) -> CompactionResult | None:
        """Run compaction when needed, otherwise return None.

        Parameters
        ----------
        messages:
            The current in-memory history (role/content dicts).
            The compactor never mutates this list — the returned
            ``CompactionResult.messages`` is a fresh list the
            caller installs via ``context.set_history``.
        already_checked:
            When True, skip the internal ``should_compact`` probe.
            The streaming handler sometimes pre-checks with a
            fresh token count (avoiding a double-count) and
            passes True so we don't re-run the same check.

        Returns
        -------
        CompactionResult or None
            None when compaction wasn't needed (below trigger,
            disabled, empty history). Otherwise a result with
            ``case`` of ``"truncate"`` or ``"summarize"``.
            ``case == "none"`` is never returned from this method
            — it's a shape for ``apply_compaction``'s
            already-compacted case.
        """
        if not messages:
            return None

        if not already_checked:
            tokens = self._counter.count(messages)
            if not self.should_compact(tokens):
                return None

        # Find the verbatim window start — the earlier of
        # token-based and count-based boundaries.
        verbatim_start_idx = self._find_verbatim_start(messages)

        # Detect topic boundary. The detector call is the single
        # LLM-touching operation; wrap defensively so detector
        # failures don't prevent compaction — we fall back to
        # summarize-all under the over-budget assumption that
        # doing something is better than doing nothing.
        boundary = self._safely_detect(messages)

        # Decide between truncate and summarize.
        case = self._decide_case(boundary, verbatim_start_idx)

        if case == "truncate":
            compacted = self._apply_truncate(
                messages, boundary, verbatim_start_idx
            )
            return CompactionResult(
                case="truncate",
                messages=compacted,
                boundary=boundary,
            )

        # Summarize — the general fallback case.
        compacted, summary_text = self._apply_summarize(
            messages, boundary, verbatim_start_idx
        )
        return CompactionResult(
            case="summarize",
            messages=compacted,
            boundary=boundary,
            summary=summary_text,
        )

    def apply_compaction(
        self,
        messages: list[dict[str, Any]],
        result: CompactionResult | None,
    ) -> list[dict[str, Any]]:
        """Return the compacted messages — convenience wrapper.

        When ``result`` is None or ``result.case == "none"``,
        returns the original messages unchanged. Otherwise
        returns ``result.messages``. Useful for callers that
        want a one-liner:

        ::

            history = compactor.apply_compaction(
                history,
                compactor.compact_history_if_needed(history),
            )
        """
        if result is None or result.case == "none":
            return messages
        return result.messages

    # ------------------------------------------------------------------
    # Internal — detector wrapper
    # ------------------------------------------------------------------

    def _safely_detect(
        self,
        messages: list[dict[str, Any]],
    ) -> TopicBoundary:
        """Invoke the detector with exception protection.

        Detector is allowed to raise (LLM timeout, bad JSON,
        network blip) or return a non-TopicBoundary shape. Either
        yields the safe-default boundary so compaction proceeds
        toward summarize-all.
        """
        if self._detect is None:
            return _SAFE_BOUNDARY
        try:
            result = self._detect(messages)
        except Exception as exc:
            logger.warning(
                "Topic boundary detector raised: %s; "
                "falling back to safe defaults",
                exc,
            )
            return _SAFE_BOUNDARY
        if not isinstance(result, TopicBoundary):
            logger.warning(
                "Topic boundary detector returned %s, expected "
                "TopicBoundary; falling back to safe defaults",
                type(result).__name__,
            )
            return _SAFE_BOUNDARY
        return result

    # ------------------------------------------------------------------
    # Internal — verbatim window boundary
    # ------------------------------------------------------------------

    def _find_verbatim_start(
        self,
        messages: list[dict[str, Any]],
    ) -> int:
        """Return the index of the first verbatim-window message.

        Two candidates computed independently:

        1. Token-based: walk backward from the end, accumulate
           tokens per message until the running sum reaches
           ``verbatim_window_tokens``. The index is the earliest
           message whose inclusion keeps the window at-or-under
           budget.
        2. Count-based: walk backward counting user messages
           until reaching ``min_verbatim_exchanges``. The index
           is the position of that user message.

        The EARLIER (more inclusive, lower index) wins —
        specs3's rule: "The earlier (more inclusive) of the two
        indices is used as verbatim_start_idx". Ensures both
        token budget and exchange-count invariants are met.

        Returns 0 when the whole history fits in the verbatim
        window — the compactor then effectively has nothing to
        compact, which the decision logic handles downstream.
        """
        n = len(messages)
        if n == 0:
            return 0

        # Token-based — walk backward, sum up from the end.
        token_idx = n  # start past the end; we'll decrement
        accum = 0
        budget = self.verbatim_window_tokens
        for i in range(n - 1, -1, -1):
            msg_tokens = self._counter.count(messages[i])
            if accum + msg_tokens > budget and accum > 0:
                # Adding this message would exceed the window.
                # Stop; the current token_idx is the earliest
                # message included so far.
                break
            accum += msg_tokens
            token_idx = i

        # Count-based — walk backward counting user messages.
        target_users = self.min_verbatim_exchanges
        count_idx = 0  # if we run out of user messages, include all
        users_seen = 0
        for i in range(n - 1, -1, -1):
            if messages[i].get("role") == "user":
                users_seen += 1
                if users_seen >= target_users:
                    count_idx = i
                    break
        else:
            # Loop completed without break — fewer user messages
            # than target. Include everything.
            count_idx = 0

        # Earlier (lower index) wins — most inclusive.
        return min(token_idx, count_idx)

    # ------------------------------------------------------------------
    # Internal — case decision
    # ------------------------------------------------------------------

    def _decide_case(
        self,
        boundary: TopicBoundary,
        verbatim_start_idx: int,
    ) -> str:
        """Choose between ``"truncate"`` and ``"summarize"``.

        Truncate when:
        - boundary_index is not None
        - boundary_index >= verbatim_start_idx (the boundary
          sits IN or AFTER the verbatim window — truncating to
          the boundary doesn't discard verbatim content)
        - confidence >= 0.5

        Everything else falls through to summarize. Specifically:
        - No boundary detected (None)
        - Boundary before verbatim window (truncating would cut
          into verbatim content, which defeats the purpose)
        - Low confidence (we don't trust the cut)
        """
        if boundary.boundary_index is None:
            return "summarize"
        if boundary.confidence < _TRUNCATE_CONFIDENCE_THRESHOLD:
            return "summarize"
        if boundary.boundary_index < verbatim_start_idx:
            return "summarize"
        return "truncate"

    # ------------------------------------------------------------------
    # Internal — truncate case
    # ------------------------------------------------------------------

    def _apply_truncate(
        self,
        messages: list[dict[str, Any]],
        boundary: TopicBoundary,
        verbatim_start_idx: int,
    ) -> list[dict[str, Any]]:
        """Keep messages from ``boundary_index`` onward.

        Then apply the min-verbatim safeguard — if the result
        has fewer user messages than the threshold, prepend
        earlier messages from before the cut to make up the
        count. Prepending happens at the head of the list
        (index 0) since there's no summary pair in the truncate
        case.
        """
        # boundary_index is guaranteed non-None in the truncate
        # case by _decide_case; assert for type-checker peace
        # and defensive correctness.
        cut = boundary.boundary_index
        assert cut is not None
        # Cap the index — a bogus detector return shouldn't
        # produce an IndexError. Clamp to message bounds.
        cut = max(0, min(cut, len(messages)))

        compacted = list(messages[cut:])

        # Min-verbatim safeguard.
        user_count = sum(
            1 for m in compacted if m.get("role") == "user"
        )
        target = self.min_verbatim_exchanges
        if user_count < target and cut > 0:
            # Walk backward from the cut, prepending messages
            # until we hit the target user count.
            prepended: list[dict[str, Any]] = []
            need = target - user_count
            for i in range(cut - 1, -1, -1):
                prepended.insert(0, messages[i])
                if messages[i].get("role") == "user":
                    need -= 1
                    if need <= 0:
                        break
            compacted = prepended + compacted
        return compacted

    # ------------------------------------------------------------------
    # Internal — summarize case
    # ------------------------------------------------------------------

    def _apply_summarize(
        self,
        messages: list[dict[str, Any]],
        boundary: TopicBoundary,
        verbatim_start_idx: int,
    ) -> tuple[list[dict[str, Any]], str]:
        """Replace pre-verbatim messages with a summary pair.

        The summary pair:

        ::

            {"role": "user", "content": "[History Summary]\\n{summary}"}
            {"role": "assistant", "content": "Ok, I understand..."}

        Prepended to the verbatim-window messages. If the
        resulting user count is still below
        ``min_verbatim_exchanges``, earlier pre-verbatim
        messages are inserted AFTER the summary pair (at offset
        2) — specs3's rule: "summary → earlier context →
        verbatim window".

        Returns the new message list and the summary text
        (caller stashes it on the CompactionResult for UI
        display and debugging).
        """
        # Pick a summary text. Prefer the detector's, fall back
        # to a generic placeholder when empty.
        summary_text = boundary.summary.strip()
        if not summary_text:
            summary_text = _GENERIC_SUMMARY_FALLBACK

        summary_pair = [
            {
                "role": "user",
                "content": f"[History Summary]\n{summary_text}",
            },
            {
                "role": "assistant",
                "content": (
                    "Ok, I understand the context from the "
                    "previous conversation."
                ),
            },
        ]

        verbatim = list(messages[verbatim_start_idx:])
        compacted = summary_pair + verbatim

        # Min-verbatim safeguard for summarize — insert at
        # offset 2 (after the summary pair) to keep the
        # summary → earlier context → verbatim ordering.
        user_count = sum(
            1 for m in verbatim if m.get("role") == "user"
        )
        target = self.min_verbatim_exchanges
        if user_count < target and verbatim_start_idx > 0:
            inserted: list[dict[str, Any]] = []
            need = target - user_count
            for i in range(verbatim_start_idx - 1, -1, -1):
                inserted.insert(0, messages[i])
                if messages[i].get("role") == "user":
                    need -= 1
                    if need <= 0:
                        break
            compacted = (
                summary_pair + inserted + verbatim
            )

        return compacted, summary_text