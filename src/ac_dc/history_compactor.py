"""History compactor — truncation and summarization strategies.

Runs after the assistant response has been delivered. The compacted
history takes effect on the next request.

Three cases:
  1. Truncate only — boundary inside/after verbatim window, high confidence
  2. Summarize — boundary before verbatim window or low confidence
  3. None — below trigger threshold
"""

import logging
from dataclasses import dataclass
from typing import Optional

from .token_counter import TokenCounter
from .topic_detector import TopicDetector, TopicBoundary, SAFE_BOUNDARY

log = logging.getLogger(__name__)


@dataclass
class CompactionResult:
    """Result of a compaction attempt."""
    case: str                           # "truncate", "summarize", "none"
    messages_before: int                # Count before compaction
    messages_after: int                 # Count after compaction
    tokens_before: int = 0
    tokens_after: int = 0
    summary: str = ""                   # Summary text (if case=summarize)
    boundary_index: Optional[int] = None
    error: Optional[str] = None


class HistoryCompactor:
    """Compacts conversation history via truncation or summarization.

    Configuration:
        compaction_trigger_tokens: Token count that triggers compaction
        verbatim_window_tokens: Recent tokens kept unchanged
        summary_budget_tokens: Max tokens for summary
        min_verbatim_exchanges: Minimum recent exchanges always kept
    """

    def __init__(
        self,
        counter: TokenCounter,
        config: dict,
        detection_model: str = "",
        skill_prompt: str = "",
    ):
        self._counter = counter
        self._trigger_tokens = config.get("compaction_trigger_tokens", 24000)
        self._verbatim_window_tokens = config.get("verbatim_window_tokens", 4000)
        self._summary_budget_tokens = config.get("summary_budget_tokens", 500)
        self._min_verbatim_exchanges = config.get("min_verbatim_exchanges", 2)
        self._enabled = config.get("enabled", True)

        # Topic detector (requires a model)
        self._detector: Optional[TopicDetector] = None
        if detection_model and skill_prompt:
            self._detector = TopicDetector(detection_model, skill_prompt)

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def trigger_tokens(self) -> int:
        return self._trigger_tokens

    def should_compact(self, messages: list[dict]) -> bool:
        """Check if compaction should run."""
        if not self._enabled:
            return False
        if not messages:
            return False
        return self._counter.count(messages) > self._trigger_tokens

    def compact(self, messages: list[dict]) -> CompactionResult:
        """Run compaction on the given message history.

        Returns a CompactionResult with the compacted messages accessible
        via get_compacted_messages().
        """
        if not messages:
            return CompactionResult(
                case="none", messages_before=0, messages_after=0,
            )

        tokens_before = self._counter.count(messages)
        if tokens_before <= self._trigger_tokens:
            return CompactionResult(
                case="none",
                messages_before=len(messages),
                messages_after=len(messages),
                tokens_before=tokens_before,
                tokens_after=tokens_before,
            )

        # Find the verbatim window start index
        verbatim_start = self._find_verbatim_start(messages)

        # Detect topic boundary
        boundary = SAFE_BOUNDARY
        if self._detector:
            try:
                boundary = self._detector.detect(messages)
            except Exception as e:
                log.warning("Topic detection error: %s", e)
                boundary = SAFE_BOUNDARY

        # Choose strategy
        result = self._apply_strategy(messages, boundary, verbatim_start, tokens_before)

        return result

    def apply_compaction(
        self, messages: list[dict], result: CompactionResult
    ) -> list[dict]:
        """Apply the compaction result to produce the new message list.

        Call this separately so the caller can inspect the result first.
        """
        if result.case == "none":
            return list(messages)

        verbatim_start = self._find_verbatim_start(messages)

        if result.case == "truncate":
            idx = result.boundary_index
            if idx is not None and 0 <= idx < len(messages):
                compacted = list(messages[idx:])
            else:
                compacted = list(messages[verbatim_start:])
        elif result.case == "summarize":
            verbatim = list(messages[verbatim_start:])
            if result.summary:
                summary_msg = {
                    "role": "user",
                    "content": (
                        f"[History Summary - {verbatim_start} earlier messages]\n\n"
                        f"{result.summary}"
                    ),
                }
                compacted = [summary_msg] + verbatim
            else:
                compacted = verbatim
        else:
            compacted = list(messages)

        # Enforce minimum exchanges
        compacted = self._enforce_min_exchanges(messages, compacted)

        # Ensure pairs are aligned (starts with user)
        if compacted and compacted[0].get("role") == "assistant":
            compacted.pop(0)

        return compacted

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _find_verbatim_start(self, messages: list[dict]) -> int:
        """Find the start index of the verbatim window.

        Walk backwards from the end, accumulating tokens until
        we reach verbatim_window_tokens. Ensure at least
        min_verbatim_exchanges user messages.
        """
        if not messages:
            return 0

        total_tokens = 0
        user_count = 0
        start_idx = len(messages)

        for i in range(len(messages) - 1, -1, -1):
            msg = messages[i]
            msg_tokens = self._counter.count(msg)
            total_tokens += msg_tokens
            if msg.get("role") == "user":
                user_count += 1

            if (total_tokens >= self._verbatim_window_tokens
                    and user_count >= self._min_verbatim_exchanges):
                start_idx = i
                break
        else:
            # Walked through everything
            start_idx = 0

        # Align to user message boundary
        while start_idx < len(messages) and messages[start_idx].get("role") != "user":
            start_idx += 1

        return start_idx

    def _apply_strategy(
        self,
        messages: list[dict],
        boundary: TopicBoundary,
        verbatim_start: int,
        tokens_before: int,
    ) -> CompactionResult:
        """Choose and apply compaction strategy."""

        # Case 1: Truncate — boundary inside/after verbatim window, high confidence
        if (boundary.boundary_index is not None
                and boundary.confidence >= 0.5
                and boundary.boundary_index >= verbatim_start):
            truncated = messages[boundary.boundary_index:]
            tokens_after = self._counter.count(truncated)
            return CompactionResult(
                case="truncate",
                messages_before=len(messages),
                messages_after=len(truncated),
                tokens_before=tokens_before,
                tokens_after=tokens_after,
                boundary_index=boundary.boundary_index,
            )

        # Case 2: Summarize — boundary before verbatim window, low confidence, or no boundary
        verbatim = messages[verbatim_start:]
        summary_text = boundary.summary if boundary.summary else ""

        tokens_after = self._counter.count(verbatim)
        if summary_text:
            summary_msg = {
                "role": "user",
                "content": (
                    f"[History Summary - {verbatim_start} earlier messages]\n\n"
                    f"{summary_text}"
                ),
            }
            tokens_after += self._counter.count(summary_msg)

        return CompactionResult(
            case="summarize",
            messages_before=len(messages),
            messages_after=len(verbatim) + (1 if summary_text else 0),
            tokens_before=tokens_before,
            tokens_after=tokens_after,
            summary=summary_text,
            boundary_index=boundary.boundary_index,
        )

    def _enforce_min_exchanges(
        self, original: list[dict], compacted: list[dict]
    ) -> list[dict]:
        """Ensure minimum number of user messages in compacted result."""
        user_count = sum(1 for m in compacted if m.get("role") == "user")
        if user_count >= self._min_verbatim_exchanges:
            return compacted

        # Find where compacted starts in original
        # Walk backwards from compacted start to add more exchanges
        if not compacted:
            return compacted

        # Find the first message of compacted in original
        first_content = compacted[0].get("content", "")
        start_in_original = None
        for i, m in enumerate(original):
            if m.get("content") == first_content and m.get("role") == compacted[0].get("role"):
                start_in_original = i
                break

        if start_in_original is None or start_in_original == 0:
            return compacted

        # Prepend messages from original
        needed = self._min_verbatim_exchanges - user_count
        prepend = []
        for i in range(start_in_original - 1, -1, -1):
            msg = original[i]
            prepend.insert(0, msg)
            if msg.get("role") == "user":
                needed -= 1
                if needed <= 0:
                    break

        return prepend + compacted
