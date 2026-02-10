"""Topic boundary detection for history compaction.

Uses a smaller/cheaper LLM to analyze conversation history and find
where the topic shifted. Returns a structured boundary result.
"""

import json
import logging
import re
from dataclasses import dataclass
from typing import Optional

log = logging.getLogger(__name__)


@dataclass
class TopicBoundary:
    """Result of topic boundary detection."""
    boundary_index: Optional[int] = None  # First message of NEW topic (None = no boundary)
    boundary_reason: str = ""
    confidence: float = 0.0
    summary: str = ""                     # Summary of messages before boundary


# Safe defaults when detection fails
SAFE_BOUNDARY = TopicBoundary(
    boundary_index=None,
    boundary_reason="detection failed",
    confidence=0.0,
    summary="",
)


def _format_messages_for_detection(messages: list[dict], max_chars: int = 1000) -> str:
    """Format messages as numbered blocks for the topic detector LLM."""
    lines = []
    for idx, msg in enumerate(messages):
        role = msg.get("role", "unknown").upper()
        content = msg.get("content", "")
        if isinstance(content, list):
            # Multimodal — extract text parts
            text_parts = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    text_parts.append(block.get("text", ""))
                elif isinstance(block, str):
                    text_parts.append(block)
            content = " ".join(text_parts)
        # Truncate each message
        if len(content) > max_chars:
            content = content[:max_chars] + "..."
        lines.append(f"[{idx}] {role}: {content}")
    return "\n".join(lines)


def _parse_boundary_response(text: str) -> TopicBoundary:
    """Parse the LLM's JSON response into a TopicBoundary.

    Handles:
    - Clean JSON
    - JSON in markdown fences
    - Partial/malformed JSON via regex extraction
    """
    # Try clean JSON first
    try:
        data = json.loads(text.strip())
        return _boundary_from_dict(data)
    except (json.JSONDecodeError, TypeError):
        pass

    # Try extracting from markdown fences
    fenced = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    if fenced:
        try:
            data = json.loads(fenced.group(1).strip())
            return _boundary_from_dict(data)
        except (json.JSONDecodeError, TypeError):
            pass

    # Regex fallback for individual fields
    boundary = TopicBoundary()

    idx_match = re.search(r'"boundary_index"\s*:\s*(\d+|null)', text)
    if idx_match:
        val = idx_match.group(1)
        boundary.boundary_index = int(val) if val != "null" else None

    reason_match = re.search(r'"boundary_reason"\s*:\s*"([^"]*)"', text)
    if reason_match:
        boundary.boundary_reason = reason_match.group(1)

    conf_match = re.search(r'"confidence"\s*:\s*([\d.]+)', text)
    if conf_match:
        try:
            boundary.confidence = float(conf_match.group(1))
        except ValueError:
            pass

    summary_match = re.search(r'"summary"\s*:\s*"([^"]*)"', text)
    if summary_match:
        boundary.summary = summary_match.group(1)

    return boundary


def _boundary_from_dict(data: dict) -> TopicBoundary:
    """Build TopicBoundary from a parsed dict."""
    return TopicBoundary(
        boundary_index=data.get("boundary_index"),
        boundary_reason=data.get("boundary_reason", ""),
        confidence=float(data.get("confidence", 0.0)),
        summary=data.get("summary", ""),
    )


class TopicDetector:
    """Detects topic boundaries in conversation history using an LLM."""

    def __init__(self, model: str, skill_prompt: str):
        """
        Args:
            model: The smaller/cheaper model name for detection calls.
            skill_prompt: The compaction skill prompt (from config).
        """
        self._model = model
        self._skill_prompt = skill_prompt

    def detect(self, messages: list[dict], max_messages: int = 50) -> TopicBoundary:
        """Detect the topic boundary in a conversation.

        Args:
            messages: Conversation history as [{role, content}, ...]
            max_messages: Maximum recent messages to analyze.

        Returns:
            TopicBoundary with detection results.
        """
        if not messages or not self._model:
            return SAFE_BOUNDARY

        # Take at most max_messages from the end
        analysis_msgs = messages[-max_messages:]
        formatted = _format_messages_for_detection(analysis_msgs)

        try:
            import litellm
            response = litellm.completion(
                model=self._model,
                messages=[
                    {"role": "system", "content": self._skill_prompt},
                    {"role": "user", "content": formatted},
                ],
                stream=False,
            )
            result_text = response.choices[0].message.content.strip()
            boundary = _parse_boundary_response(result_text)

            # Adjust index relative to full message list if we truncated
            offset = len(messages) - len(analysis_msgs)
            if boundary.boundary_index is not None:
                boundary.boundary_index += offset

            log.info(
                "Topic detection: boundary=%s confidence=%.2f reason=%s",
                boundary.boundary_index, boundary.confidence, boundary.boundary_reason,
            )
            return boundary

        except Exception as e:
            log.warning("Topic detection failed: %s", e)
            return SAFE_BOUNDARY
