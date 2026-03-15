"""Topic boundary detection for history compaction."""

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class TopicBoundary:
    """Result of topic boundary detection."""
    boundary_index: Optional[int] = None
    boundary_reason: str = ""
    confidence: float = 0.0
    summary: str = ""


# Safe default when detection fails
SAFE_BOUNDARY = TopicBoundary(
    boundary_index=None,
    boundary_reason="Detection failed — safe default",
    confidence=0.0,
    summary="",
)


def format_messages_for_detection(
    messages: list[dict],
    max_chars: int = 1000,
    max_messages: int = 50,
) -> str:
    """Format messages as indexed blocks for LLM analysis.

    Each message: [N] ROLE: content (truncated)
    """
    lines = []
    for i, msg in enumerate(messages[:max_messages]):
        role = msg.get("role", "unknown").upper()
        content = msg.get("content", "")
        if isinstance(content, list):
            # Multimodal — extract text blocks
            text_parts = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    text_parts.append(block.get("text", ""))
            content = " ".join(text_parts)
        if len(content) > max_chars:
            content = content[:max_chars] + "..."
        lines.append(f"[{i}] {role}: {content}")
    return "\n\n".join(lines)


def parse_detection_result(text: str) -> TopicBoundary:
    """Parse LLM output into a TopicBoundary.

    Tries: clean JSON, markdown-fenced JSON, regex fallback.
    """
    if not text or not text.strip():
        return TopicBoundary(boundary_index=None, confidence=0.0)

    # Try clean JSON
    try:
        data = json.loads(text.strip())
        return _from_dict(data)
    except (json.JSONDecodeError, ValueError):
        pass

    # Try markdown-fenced JSON
    fenced = re.search(r'```(?:json)?\s*\n?(.*?)\n?```', text, re.DOTALL)
    if fenced:
        try:
            data = json.loads(fenced.group(1).strip())
            return _from_dict(data)
        except (json.JSONDecodeError, ValueError):
            pass

    # Regex fallback
    boundary_match = re.search(r'"boundary_index"\s*:\s*(\d+|null)', text)
    confidence_match = re.search(r'"confidence"\s*:\s*([\d.]+)', text)
    summary_match = re.search(r'"summary"\s*:\s*"([^"]*)"', text)
    reason_match = re.search(r'"boundary_reason"\s*:\s*"([^"]*)"', text)

    if boundary_match or confidence_match:
        idx = None
        if boundary_match and boundary_match.group(1) != "null":
            try:
                idx = int(boundary_match.group(1))
            except ValueError:
                pass
        conf = 0.0
        if confidence_match:
            try:
                conf = float(confidence_match.group(1))
            except ValueError:
                pass
        return TopicBoundary(
            boundary_index=idx,
            confidence=conf,
            summary=summary_match.group(1) if summary_match else "",
            boundary_reason=reason_match.group(1) if reason_match else "",
        )

    return TopicBoundary(boundary_index=None, confidence=0.0)


def _from_dict(data: dict) -> TopicBoundary:
    """Construct TopicBoundary from parsed dict."""
    idx = data.get("boundary_index")
    if idx is not None:
        idx = int(idx)
    return TopicBoundary(
        boundary_index=idx,
        boundary_reason=data.get("boundary_reason", ""),
        confidence=float(data.get("confidence", 0.0)),
        summary=data.get("summary", ""),
    )


class TopicDetector:
    """Detect topic boundaries in conversation history via LLM."""

    def __init__(self, model: Optional[str] = None, skill_prompt: str = ""):
        self._model = model
        self._skill_prompt = skill_prompt

    def detect(self, messages: list[dict]) -> TopicBoundary:
        """Detect topic boundary in messages.

        Returns SAFE_BOUNDARY on any failure.
        """
        if not messages or not self._model:
            return SAFE_BOUNDARY

        formatted = format_messages_for_detection(messages)
        if not formatted:
            return SAFE_BOUNDARY

        try:
            import litellm
            response = litellm.completion(
                model=self._model,
                messages=[
                    {"role": "system", "content": self._skill_prompt},
                    {"role": "user", "content": formatted},
                ],
                temperature=0.0,
                max_tokens=500,
            )
            text = response.choices[0].message.content
            return parse_detection_result(text)
        except Exception as e:
            logger.warning(f"Topic detection failed: {e}")
            return SAFE_BOUNDARY