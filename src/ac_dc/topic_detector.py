"""Topic boundary detector — LLM-based conversation analysis for compaction.

Detects where the conversation topic shifted, enabling intelligent
truncation vs summarization decisions.
"""

import json
import logging
import re

import litellm

logger = logging.getLogger(__name__)

# Safe default when detection fails or is not possible
SAFE_BOUNDARY = {
    "boundary_index": None,
    "boundary_reason": "No boundary detected",
    "confidence": 0.0,
    "summary": "",
}


def format_messages_for_detection(messages, max_chars=1000, max_messages=50):
    """Format conversation messages for topic detection LLM input.

    Each message formatted as: [N] ROLE: content (truncated)

    Args:
        messages: list of {role, content} dicts
        max_chars: max chars per message content
        max_messages: max messages to include

    Returns:
        Formatted string
    """
    lines = []
    for i, msg in enumerate(messages[:max_messages]):
        role = msg.get("role", "unknown").upper()
        content = msg.get("content", "")
        if isinstance(content, list):
            # Multimodal: extract text parts
            text_parts = [p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text"]
            content = " ".join(text_parts)
        if len(content) > max_chars:
            content = content[:max_chars] + "..."
        # Single line per message
        content_oneline = content.replace("\n", " ").strip()
        lines.append(f"[{i}] {role}: {content_oneline}")
    return "\n".join(lines)


def parse_detection_response(text):
    """Parse topic detection LLM response into a boundary dict.

    Tries multiple strategies:
    1. Clean JSON
    2. Markdown-fenced JSON (```json ... ```)
    3. Partial regex fallback

    Returns dict with boundary_index, boundary_reason, confidence, summary.
    """
    if not text or not text.strip():
        return {**SAFE_BOUNDARY}

    # Strategy 1: direct JSON parse
    try:
        result = json.loads(text.strip())
        return _validate_boundary(result)
    except (json.JSONDecodeError, ValueError):
        pass

    # Strategy 2: markdown-fenced JSON
    fenced = re.search(r"```(?:json)?\s*\n?(.*?)\n?\s*```", text, re.DOTALL)
    if fenced:
        try:
            result = json.loads(fenced.group(1).strip())
            return _validate_boundary(result)
        except (json.JSONDecodeError, ValueError):
            pass

    # Strategy 3: partial regex fallback
    return _regex_fallback(text)


def _validate_boundary(result):
    """Validate and normalize a parsed boundary dict."""
    if not isinstance(result, dict):
        return {**SAFE_BOUNDARY}

    boundary_index = result.get("boundary_index")
    if boundary_index is not None:
        try:
            boundary_index = int(boundary_index)
        except (TypeError, ValueError):
            boundary_index = None

    confidence = result.get("confidence", 0.0)
    try:
        confidence = float(confidence)
        confidence = max(0.0, min(1.0, confidence))
    except (TypeError, ValueError):
        confidence = 0.0

    return {
        "boundary_index": boundary_index,
        "boundary_reason": str(result.get("boundary_reason", "")),
        "confidence": confidence,
        "summary": str(result.get("summary", "")),
    }


def _regex_fallback(text):
    """Extract fields via regex when JSON parsing fails."""
    result = {**SAFE_BOUNDARY}

    # boundary_index
    idx_match = re.search(r'"boundary_index"\s*:\s*(\d+|null)', text)
    if idx_match:
        val = idx_match.group(1)
        if val != "null":
            try:
                result["boundary_index"] = int(val)
            except ValueError:
                pass

    # confidence
    conf_match = re.search(r'"confidence"\s*:\s*([\d.]+)', text)
    if conf_match:
        try:
            result["confidence"] = max(0.0, min(1.0, float(conf_match.group(1))))
        except ValueError:
            pass

    # summary
    sum_match = re.search(r'"summary"\s*:\s*"([^"]*)"', text)
    if sum_match:
        result["summary"] = sum_match.group(1)

    # boundary_reason
    reason_match = re.search(r'"boundary_reason"\s*:\s*"([^"]*)"', text)
    if reason_match:
        result["boundary_reason"] = reason_match.group(1)

    return result


async def detect_topic_boundary(messages, model=None, compaction_prompt=None):
    """Detect topic boundary in conversation using an LLM call.

    Args:
        messages: list of {role, content} dicts
        model: model name for detection (smaller/cheaper model)
        compaction_prompt: system prompt for the detector

    Returns:
        TopicBoundary dict: {boundary_index, boundary_reason, confidence, summary}
    """
    if not messages:
        return {**SAFE_BOUNDARY}

    if not model:
        return {**SAFE_BOUNDARY}

    formatted = format_messages_for_detection(messages)

    system_prompt = compaction_prompt or (
        "Identify where the conversation topic changed. "
        "Respond with JSON: {boundary_index, boundary_reason, confidence, summary}"
    )

    try:
        response = litellm.completion(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": formatted},
            ],
            stream=False,
        )
        text = response.choices[0].message.content
        return parse_detection_response(text)
    except Exception as e:
        logger.warning(f"Topic detection failed: {e}")
        return {**SAFE_BOUNDARY}