"""History compactor — truncation/summarization strategies with verbatim window.

Compacts conversation history when token count exceeds the trigger threshold.
Uses topic boundary detection to decide between truncation and summarization.
"""

import logging

from .token_counter import TokenCounter
from .topic_detector import SAFE_BOUNDARY, detect_topic_boundary

logger = logging.getLogger(__name__)


class HistoryCompactor:
    """Compacts conversation history to stay within token budgets.

    Two strategies:
    - Truncate: discard everything before a topic boundary
    - Summarize: replace old messages with a summary

    Configuration keys:
        enabled: bool (master switch)
        compaction_trigger_tokens: int (threshold to trigger)
        verbatim_window_tokens: int (recent tokens kept unchanged)
        summary_budget_tokens: int (max tokens for summary)
        min_verbatim_exchanges: int (minimum recent exchanges always kept)
    """

    def __init__(self, config, model=None, detection_model=None,
                 compaction_prompt=None):
        """Initialize compactor.

        Args:
            config: compaction config dict
            model: primary model name (for token counting)
            detection_model: smaller model for topic detection
            compaction_prompt: system prompt for topic detector
        """
        self._config = config or {}
        self._model = model
        self._detection_model = detection_model or config.get("detection_model")
        self._compaction_prompt = compaction_prompt
        self._counter = TokenCounter(model)

    @property
    def enabled(self):
        return self._config.get("enabled", False)

    @property
    def trigger_tokens(self):
        return self._config.get("compaction_trigger_tokens", 24000)

    @property
    def verbatim_window_tokens(self):
        return self._config.get("verbatim_window_tokens", 4000)

    @property
    def summary_budget_tokens(self):
        return self._config.get("summary_budget_tokens", 500)

    @property
    def min_verbatim_exchanges(self):
        return self._config.get("min_verbatim_exchanges", 2)

    def should_compact(self, messages):
        """Check if compaction should run.

        Returns True if enabled and history tokens exceed trigger.
        """
        if not self.enabled:
            return False
        tokens = self._counter.count_messages(messages)
        return tokens > self.trigger_tokens

    async def compact(self, messages):
        """Run compaction on message history.

        Returns dict:
            case: "truncate" | "summarize" | "none"
            messages: list of compacted messages
            boundary: TopicBoundary dict (if detected)
            summary: str (if summarized)
        """
        if not messages:
            return {"case": "none", "messages": list(messages)}

        if not self.should_compact(messages):
            return {"case": "none", "messages": list(messages)}

        # Find verbatim window start
        verbatim_start = self._find_verbatim_start(messages)

        # Detect topic boundary
        boundary = await detect_topic_boundary(
            messages[:verbatim_start] if verbatim_start > 0 else messages,
            model=self._detection_model,
            compaction_prompt=self._compaction_prompt,
        )

        boundary_index = boundary.get("boundary_index")
        confidence = boundary.get("confidence", 0.0)

        # Decide strategy
        if (boundary_index is not None
                and boundary_index >= verbatim_start
                and confidence >= 0.5):
            # Truncate: boundary is in or after verbatim window
            result = self._apply_truncate(messages, boundary_index)
            result["boundary"] = boundary
            return result
        elif (boundary_index is not None
              and boundary_index < verbatim_start
              and confidence >= 0.5):
            # Summarize: boundary is before verbatim window
            result = self._apply_summarize(messages, verbatim_start, boundary)
            result["boundary"] = boundary
            return result
        else:
            # Low confidence or no boundary: summarize as fallback
            result = self._apply_summarize(messages, verbatim_start, boundary)
            result["boundary"] = boundary
            return result

    def _find_verbatim_start(self, messages):
        """Find the start index of the verbatim window.

        Works backward from the end, counting tokens until we exceed
        verbatim_window_tokens. Also ensures min_verbatim_exchanges.
        """
        if not messages:
            return 0

        target = self.verbatim_window_tokens
        min_exchanges = self.min_verbatim_exchanges

        # Count from end
        tokens = 0
        start = len(messages)
        for i in range(len(messages) - 1, -1, -1):
            msg_tokens = self._counter.count_message(messages[i])
            tokens += msg_tokens
            start = i
            if tokens >= target:
                break

        # Ensure min_verbatim_exchanges (count user messages from end)
        user_count = 0
        min_start = len(messages)
        for i in range(len(messages) - 1, -1, -1):
            if messages[i].get("role") == "user":
                user_count += 1
            min_start = i
            if user_count >= min_exchanges:
                break

        # Take the earlier (more inclusive) start
        return min(start, min_start)

    def _apply_truncate(self, messages, boundary_index):
        """Truncate: discard everything before boundary.

        Returns compaction result dict.
        """
        result_messages = list(messages[boundary_index:])

        # Ensure min_verbatim_exchanges
        result_messages = self._ensure_min_exchanges(messages, result_messages, boundary_index)

        return {
            "case": "truncate",
            "messages": result_messages,
        }

    def _apply_summarize(self, messages, verbatim_start, boundary):
        """Summarize: replace pre-verbatim messages with summary.

        Returns compaction result dict.
        """
        summary_text = boundary.get("summary", "")

        if not summary_text:
            # Fallback: just truncate at verbatim window
            result_messages = list(messages[verbatim_start:])
            result_messages = self._ensure_min_exchanges(
                messages, result_messages, verbatim_start
            )
            return {
                "case": "summarize",
                "messages": result_messages,
                "summary": "",
            }

        # Build summary message
        summary_msg = {
            "role": "user",
            "content": f"[History Summary]\n{summary_text}",
        }
        summary_ack = {
            "role": "assistant",
            "content": "Ok, I understand the context from the previous conversation.",
        }

        result_messages = [summary_msg, summary_ack] + list(messages[verbatim_start:])

        # Ensure min_verbatim_exchanges (the summary pair counts as one)
        result_messages = self._ensure_min_exchanges(
            messages, result_messages, verbatim_start,
            prepend_offset=2,  # account for summary pair
        )

        return {
            "case": "summarize",
            "messages": result_messages,
            "summary": summary_text,
        }

    def _ensure_min_exchanges(self, original, result, cut_index, prepend_offset=0):
        """Ensure minimum verbatim exchanges are preserved.

        If result has fewer user messages than min_verbatim_exchanges,
        prepend earlier messages from original.
        """
        min_exchanges = self.min_verbatim_exchanges

        # Count user messages in result (excluding summary pair)
        user_count = sum(
            1 for m in result[prepend_offset:]
            if m.get("role") == "user"
        )

        if user_count >= min_exchanges:
            return result

        # Need more messages from before cut_index
        needed = min_exchanges - user_count
        prepend = []
        for i in range(cut_index - 1, -1, -1):
            prepend.insert(0, dict(original[i]))
            if original[i].get("role") == "user":
                needed -= 1
            if needed <= 0:
                break

        # Insert before the verbatim portion (after summary pair if present)
        return result[:prepend_offset] + prepend + result[prepend_offset:]

    def apply_compaction(self, messages, compaction_result):
        """Apply a compaction result to messages.

        Convenience method for external callers. Returns the compacted messages
        or original if case is "none".
        """
        if compaction_result.get("case") == "none":
            return list(messages)
        return list(compaction_result.get("messages", messages))