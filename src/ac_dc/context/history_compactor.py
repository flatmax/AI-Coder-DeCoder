"""History compaction — topic-aware summarization of old messages."""

import logging
from dataclasses import dataclass
from typing import Optional

from ac_dc.context.topic_detector import TopicBoundary, TopicDetector, SAFE_BOUNDARY

logger = logging.getLogger(__name__)


@dataclass
class CompactionResult:
    """Result of a compaction operation."""
    case: str  # "truncate", "summarize", "none"
    messages: list[dict]
    boundary: Optional[TopicBoundary] = None
    summary: Optional[str] = None


class HistoryCompactor:
    """Compact conversation history using topic boundary detection.

    Two strategies:
    - Truncate: discard old topic entirely when boundary is in/after verbatim window
    - Summarize: replace pre-verbatim messages with a summary
    """

    def __init__(
        self,
        config: dict,
        detection_model: Optional[str] = None,
        skill_prompt: str = "",
    ):
        self._config = config
        self._enabled = config.get("enabled", True)
        self._trigger = config.get("compaction_trigger_tokens", 24000)
        self._verbatim_window = config.get("verbatim_window_tokens", 4000)
        self._summary_budget = config.get("summary_budget_tokens", 500)
        self._min_verbatim = config.get("min_verbatim_exchanges", 2)
        self._detector = TopicDetector(model=detection_model, skill_prompt=skill_prompt)

    @property
    def enabled(self) -> bool:
        return self._enabled

    def should_compact(self, token_count: int) -> bool:
        """Check if compaction should be triggered."""
        if not self._enabled:
            return False
        return token_count > self._trigger

    def compact(self, messages: list[dict], token_counter) -> CompactionResult:
        """Run compaction on messages.

        Returns a CompactionResult with the compacted messages.
        """
        if not messages:
            return CompactionResult(case="none", messages=messages)

        token_count = token_counter.count(messages)
        if not self.should_compact(token_count):
            return CompactionResult(case="none", messages=messages)

        # Find verbatim window start
        verbatim_start = self._find_verbatim_start(messages, token_counter)

        # Detect topic boundary in the summarizable zone
        boundary = self._detector.detect(messages[:verbatim_start])

        if boundary.boundary_index is not None and boundary.confidence >= 0.5:
            # Boundary found
            if boundary.boundary_index >= verbatim_start:
                # Boundary in/after verbatim window → truncate
                result = self._apply_truncate(messages, boundary.boundary_index)
            else:
                # Boundary before verbatim → summarize pre-verbatim
                result = self._apply_summarize(
                    messages, verbatim_start, boundary.summary,
                )
        else:
            # No clear boundary → summarize
            result = self._apply_summarize(
                messages, verbatim_start,
                boundary.summary if boundary.summary else "",
            )

        # Ensure min_verbatim_exchanges
        result = self._ensure_min_exchanges(result, messages)

        return result

    def _find_verbatim_start(self, messages: list[dict], token_counter) -> int:
        """Find the index where the verbatim window starts (from the end)."""
        total = 0
        for i in range(len(messages) - 1, -1, -1):
            total += token_counter.count(messages[i])
            if total >= self._verbatim_window:
                return i
        return 0

    def _apply_truncate(self, messages: list[dict], boundary_index: int) -> CompactionResult:
        """Discard everything before the boundary."""
        truncated = messages[boundary_index:]
        return CompactionResult(
            case="truncate",
            messages=truncated,
            boundary=TopicBoundary(boundary_index=boundary_index),
        )

    def _apply_summarize(
        self,
        messages: list[dict],
        verbatim_start: int,
        summary_text: str,
    ) -> CompactionResult:
        """Replace pre-verbatim messages with a summary."""
        if not summary_text:
            summary_text = "Previous conversation context."

        summary_msg = {
            "role": "user",
            "content": f"[History Summary]\n{summary_text}",
        }
        ack_msg = {
            "role": "assistant",
            "content": "Ok, I understand the context from the previous conversation.",
        }

        verbatim = messages[verbatim_start:]
        result = [summary_msg, ack_msg] + verbatim

        return CompactionResult(
            case="summarize",
            messages=result,
            summary=summary_text,
        )

    def _ensure_min_exchanges(
        self, result: CompactionResult, original: list[dict],
    ) -> CompactionResult:
        """Ensure minimum verbatim exchanges are preserved."""
        # Count user messages in result
        user_count = sum(1 for m in result.messages if m.get("role") == "user"
                         and not m.get("content", "").startswith("[History Summary]"))
        if user_count >= self._min_verbatim:
            return result

        # Prepend earlier messages to reach minimum
        needed = self._min_verbatim - user_count
        prepend = []
        for msg in original:
            if msg in result.messages:
                break
            prepend.append(msg)
            if msg.get("role") == "user":
                needed -= 1
            if needed <= 0:
                break

        if prepend:
            result.messages = prepend + result.messages

        return result