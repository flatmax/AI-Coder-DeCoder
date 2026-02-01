"""
Topic-aware boundary detection for history compaction.

Identifies natural topic boundaries in conversation history to enable
intelligent summarization that preserves recent context while compacting
older, completed topics.
"""

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import litellm


@dataclass
class TopicBoundaryResult:
    """Result from topic boundary detection."""
    boundary_index: Optional[int]  # Message index where new topic starts (None = no boundary)
    boundary_reason: str           # Why this was identified as a boundary
    confidence: float              # 0.0-1.0 confidence score
    summary: str                   # Summary of messages before boundary
    messages_analyzed: int         # How many messages were analyzed


def _load_compaction_prompt() -> str:
    """Load the compaction skill prompt."""
    prompt_path = Path(__file__).parent.parent / "prompts" / "compaction_skill.md"
    if prompt_path.exists():
        return prompt_path.read_text()
    
    # Fallback minimal prompt if file missing
    return """Analyze conversation history for topic boundaries.
Output JSON: {"boundary_index": int|null, "boundary_reason": str, "confidence": float, "summary": str}"""


def _format_messages_for_analysis(messages: list[dict], max_messages: int = 50) -> str:
    """
    Format messages for LLM analysis.
    
    Args:
        messages: Conversation messages
        max_messages: Maximum messages to include (from the end)
        
    Returns:
        Formatted string with indexed messages
    """
    # Take most recent messages if too many
    if len(messages) > max_messages:
        offset = len(messages) - max_messages
        messages = messages[-max_messages:]
    else:
        offset = 0
    
    lines = []
    for i, msg in enumerate(messages):
        idx = i + offset
        role = msg.get("role", "unknown").upper()
        content = msg.get("content", "")
        
        # Truncate very long messages
        if isinstance(content, str) and len(content) > 1000:
            content = content[:1000] + "... [truncated]"
        elif isinstance(content, list):
            # Handle structured content (images, etc.)
            text_parts = [p.get("text", "") for p in content if isinstance(p, dict)]
            content = " ".join(text_parts)[:1000]
        
        lines.append(f"[{idx}] {role}: {content}")
    
    return "\n\n".join(lines)


def _parse_llm_response(response_text: str) -> dict:
    """
    Parse LLM response, handling various JSON formats.
    
    Args:
        response_text: Raw LLM response
        
    Returns:
        Parsed dict with boundary info
    """
    # Try to extract JSON from response
    text = response_text.strip()
    
    # Remove markdown code fencing if present
    if text.startswith("```"):
        # Find the end of the code block
        lines = text.split("\n")
        json_lines = []
        in_block = False
        for line in lines:
            if line.startswith("```") and not in_block:
                in_block = True
                continue
            elif line.startswith("```") and in_block:
                break
            elif in_block:
                json_lines.append(line)
        text = "\n".join(json_lines)
    
    # Try direct JSON parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    
    # Try to find JSON object in text
    match = re.search(r'\{[^{}]*\}', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    
    # Return default if parsing fails
    return {
        "boundary_index": None,
        "boundary_reason": "Failed to parse LLM response",
        "confidence": 0.0,
        "summary": ""
    }


class TopicDetector:
    """
    Detects topic boundaries in conversation history.
    
    Uses an LLM to identify where conversations shift topics,
    enabling intelligent summarization that preserves recent context.
    """
    
    def __init__(self, model: str):
        """
        Initialize topic detector.
        
        Args:
            model: LLM model to use for topic detection (required)
        """
        if not model:
            raise ValueError("model is required for TopicDetector")
        self.model = model
        self._prompt = _load_compaction_prompt()
    
    async def find_topic_boundary(
        self,
        messages: list[dict],
        verbatim_window_tokens: int = 3000,
        token_counter=None
    ) -> TopicBoundaryResult:
        """
        Find the most recent topic boundary in conversation history.
        
        Args:
            messages: Conversation messages to analyze
            verbatim_window_tokens: Minimum tokens to preserve verbatim at end
            token_counter: Optional TokenCounter for accurate counting
            
        Returns:
            TopicBoundaryResult with boundary info and summary
        """
        if not messages:
            return TopicBoundaryResult(
                boundary_index=None,
                boundary_reason="No messages to analyze",
                confidence=0.0,
                summary="",
                messages_analyzed=0
            )
        
        # Format messages for analysis
        formatted = _format_messages_for_analysis(messages)
        
        # Build analysis prompt
        user_prompt = f"""Analyze this conversation history and identify topic boundaries.

## Conversation History

{formatted}

## Instructions

Find the most recent clear topic boundary and summarize everything before it.
Remember: boundary_index points to where the NEW topic STARTS (first message of new topic).
Messages 0 through boundary_index-1 will be summarized and compacted.

Provide your response as a JSON object."""

        try:
            # Use async completion
            response = await litellm.acompletion(
                model=self.model,
                messages=[
                    {"role": "system", "content": self._prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.3,  # Lower temperature for more consistent analysis
            )
            
            response_text = response.choices[0].message.content
            parsed = _parse_llm_response(response_text)
            
            # Validate boundary_index
            boundary_idx = parsed.get("boundary_index")
            if boundary_idx is not None:
                if not isinstance(boundary_idx, int) or boundary_idx < 0 or boundary_idx >= len(messages):
                    boundary_idx = None
            
            return TopicBoundaryResult(
                boundary_index=boundary_idx,
                boundary_reason=parsed.get("boundary_reason", ""),
                confidence=float(parsed.get("confidence", 0.0)),
                summary=parsed.get("summary", ""),
                messages_analyzed=len(messages)
            )
            
        except Exception as e:
            # Return safe default on error
            return TopicBoundaryResult(
                boundary_index=None,
                boundary_reason=f"Detection failed: {e}",
                confidence=0.0,
                summary="",
                messages_analyzed=len(messages)
            )
    
    def find_topic_boundary_sync(
        self,
        messages: list[dict],
        verbatim_window_tokens: int = 3000,
        token_counter=None
    ) -> TopicBoundaryResult:
        """
        Synchronous wrapper for find_topic_boundary.
        
        Use this when calling from synchronous code.
        """
        import asyncio
        
        # Check if we're already in an async context
        try:
            loop = asyncio.get_running_loop()
            # We're in an async context, run in thread pool
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                future = pool.submit(
                    asyncio.run,
                    self.find_topic_boundary(messages, verbatim_window_tokens, token_counter)
                )
                return future.result()
        except RuntimeError:
            # No running event loop, safe to use asyncio.run
            return asyncio.run(
                self.find_topic_boundary(messages, verbatim_window_tokens, token_counter)
            )
