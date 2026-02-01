"""
History compaction engine using topic-aware truncation.

Compacts conversation history by identifying topic boundaries and
preserving recent context while summarizing or truncating older content.
"""

from dataclasses import dataclass, field
from typing import Optional

from ac.context.token_counter import TokenCounter
from ac.context.topic_detector import TopicDetector, TopicBoundaryResult


@dataclass
class CompactionConfig:
    """Configuration for history compaction."""
    
    # Two-threshold system
    compaction_trigger_tokens: int = 6000   # When to trigger compaction
    verbatim_window_tokens: int = 3000      # Recent history to preserve verbatim
    summary_budget_tokens: int = 500        # Max tokens for summary
    
    # Safety minimums
    min_verbatim_exchanges: int = 2         # Always keep at least N user/assistant pairs
    min_confidence: float = 0.5             # Minimum confidence to trust boundary
    
    # Model for detection
    detection_model: str = "anthropic/claude-3-haiku-20240307"


@dataclass
class CompactionResult:
    """Result of a compaction operation."""
    
    compacted_messages: list[dict]          # New message list to use
    summary_message: Optional[dict] = None  # Summary of truncated content (if any)
    truncated_count: int = 0                # How many messages were removed
    topic_detected: Optional[str] = None    # What topic boundary was identified
    boundary_index: Optional[int] = None    # Where the boundary was found
    confidence: float = 0.0                 # Confidence in the boundary detection
    tokens_before: int = 0                  # Tokens before compaction
    tokens_after: int = 0                   # Tokens after compaction
    case: str = "none"                      # "truncate_only", "summarize", or "none"


class HistoryCompactor:
    """
    Compacts conversation history using topic-aware truncation.
    
    Uses a two-threshold system:
    - compaction_trigger_tokens: When total history exceeds this, compaction runs
    - verbatim_window_tokens: How much recent history to preserve unchanged
    
    Two cases based on where topic boundary falls:
    1. Boundary INSIDE verbatim window → truncate only (discard old topic)
    2. Boundary OUTSIDE verbatim window → summarize gap + keep verbatim window
    """
    
    def __init__(
        self,
        config: Optional[CompactionConfig] = None,
        token_counter: Optional[TokenCounter] = None,
        model_name: str = "gpt-4o"
    ):
        """
        Initialize the compactor.
        
        Args:
            config: Compaction configuration (uses defaults if None)
            token_counter: Token counter for accurate counting (creates one if None)
            model_name: Model name for token counting
        """
        self.config = config or CompactionConfig()
        self.token_counter = token_counter or TokenCounter(model_name)
        self.topic_detector = TopicDetector(model=self.config.detection_model)
    
    def should_compact(self, messages: list[dict]) -> bool:
        """
        Check if history exceeds trigger threshold.
        
        Args:
            messages: Current conversation messages
            
        Returns:
            True if compaction should be triggered
        """
        if not messages:
            return False
        total_tokens = self._count_messages_tokens(messages)
        return total_tokens > self.config.compaction_trigger_tokens
    
    async def compact(self, messages: list[dict]) -> CompactionResult:
        """
        Compact history preserving current topic context.
        
        Strategy:
        1. Find verbatim window boundary (last N tokens)
        2. Detect topic boundary in the messages
        3. Apply appropriate case:
           - Case 1: Boundary inside verbatim window → truncate at boundary
           - Case 2: Boundary outside verbatim window → summarize + keep window
           - Fallback: No clear boundary → summarize old + keep window
        
        Args:
            messages: Current conversation messages
            
        Returns:
            CompactionResult with compacted messages and metadata
        """
        if not messages:
            return CompactionResult(
                compacted_messages=[],
                case="none"
            )
        
        tokens_before = self._count_messages_tokens(messages)
        
        # Check if compaction is needed
        if tokens_before <= self.config.compaction_trigger_tokens:
            return CompactionResult(
                compacted_messages=messages,
                tokens_before=tokens_before,
                tokens_after=tokens_before,
                case="none"
            )
        
        # Find verbatim window start (scan backward from end)
        verbatim_start_idx = self._find_verbatim_window_start(messages)
        
        # Detect topic boundary
        boundary_result = await self.topic_detector.find_topic_boundary(
            messages,
            verbatim_window_tokens=self.config.verbatim_window_tokens,
            token_counter=self.token_counter
        )
        
        # Determine which case applies
        boundary_idx = boundary_result.boundary_index
        confidence = boundary_result.confidence
        
        # Case 1: Clear boundary INSIDE verbatim window (or at/after it)
        # The current topic started recently - just truncate, no summary needed
        if (boundary_idx is not None 
            and confidence >= self.config.min_confidence 
            and boundary_idx >= verbatim_start_idx):
            
            compacted = messages[boundary_idx:]
            compacted = self._ensure_min_exchanges(compacted, messages)
            tokens_after = self._count_messages_tokens(compacted)
            
            return CompactionResult(
                compacted_messages=compacted,
                summary_message=None,
                truncated_count=len(messages) - len(compacted),
                topic_detected=boundary_result.boundary_reason,
                boundary_index=boundary_idx,
                confidence=confidence,
                tokens_before=tokens_before,
                tokens_after=tokens_after,
                case="truncate_only"
            )
        
        # Case 2: Boundary OUTSIDE verbatim window (or low confidence/no boundary)
        # Summarize content before verbatim window, keep verbatim window intact
        verbatim_messages = messages[verbatim_start_idx:]
        old_messages = messages[:verbatim_start_idx]
        
        # Generate summary of old messages
        summary_message = None
        if old_messages and boundary_result.summary:
            summary_message = self._create_summary_message(
                boundary_result.summary,
                len(old_messages)
            )
        
        # Build compacted messages
        if summary_message:
            compacted = [summary_message] + verbatim_messages
        else:
            compacted = verbatim_messages
        
        compacted = self._ensure_min_exchanges(compacted, messages)
        tokens_after = self._count_messages_tokens(compacted)
        
        return CompactionResult(
            compacted_messages=compacted,
            summary_message=summary_message,
            truncated_count=len(old_messages),
            topic_detected=boundary_result.boundary_reason if boundary_idx else None,
            boundary_index=boundary_idx,
            confidence=confidence,
            tokens_before=tokens_before,
            tokens_after=tokens_after,
            case="summarize"
        )
    
    def compact_sync(self, messages: list[dict]) -> CompactionResult:
        """
        Synchronous wrapper for compact().
        
        Use this when calling from synchronous code.
        """
        import asyncio
        
        try:
            loop = asyncio.get_running_loop()
            # We're in an async context, run in thread pool
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                future = pool.submit(asyncio.run, self.compact(messages))
                return future.result()
        except RuntimeError:
            # No running event loop, safe to use asyncio.run
            return asyncio.run(self.compact(messages))
    
    def _find_verbatim_window_start(self, messages: list[dict]) -> int:
        """
        Find the message index where verbatim window starts.
        
        Scans backward from end until token limit reached.
        
        Args:
            messages: Conversation messages
            
        Returns:
            Index of first message in verbatim window
        """
        if not messages:
            return 0
        
        total_tokens = 0
        for i in range(len(messages) - 1, -1, -1):
            msg_tokens = self._count_message_tokens(messages[i])
            if total_tokens + msg_tokens > self.config.verbatim_window_tokens:
                # This message would exceed the window, start after it
                return min(i + 1, len(messages) - 1)
            total_tokens += msg_tokens
        
        # All messages fit in verbatim window
        return 0
    
    def _count_messages_tokens(self, messages: list[dict]) -> int:
        """Count total tokens in message list."""
        return sum(self._count_message_tokens(msg) for msg in messages)
    
    def _count_message_tokens(self, message: dict) -> int:
        """Count tokens in a single message."""
        content = message.get("content", "")
        if isinstance(content, list):
            # Handle structured content (images, etc.)
            text_parts = [p.get("text", "") for p in content if isinstance(p, dict)]
            content = " ".join(text_parts)
        return self.token_counter.count(content)
    
    def _create_summary_message(self, summary: str, messages_summarized: int) -> dict:
        """
        Create a system message containing the summary.
        
        Args:
            summary: Summary text from topic detector
            messages_summarized: Number of messages that were summarized
            
        Returns:
            Message dict with role "system"
        """
        return {
            "role": "system",
            "content": f"[History Summary - {messages_summarized} earlier messages]\n\n{summary}"
        }
    
    def _ensure_min_exchanges(
        self, 
        compacted: list[dict], 
        original: list[dict]
    ) -> list[dict]:
        """
        Ensure minimum number of exchanges are preserved.
        
        Args:
            compacted: Compacted message list
            original: Original message list
            
        Returns:
            Message list with at least min_verbatim_exchanges user/assistant pairs
        """
        # Count user messages in compacted
        user_count = sum(1 for m in compacted if m.get("role") == "user")
        
        if user_count >= self.config.min_verbatim_exchanges:
            return compacted
        
        # Need to add more messages from original
        # Find how many more user messages we need
        needed = self.config.min_verbatim_exchanges - user_count
        
        # Scan backward in original to find messages to add
        to_prepend = []
        found_users = 0
        
        for i in range(len(original) - len(compacted) - 1, -1, -1):
            msg = original[i]
            to_prepend.insert(0, msg)
            if msg.get("role") == "user":
                found_users += 1
                if found_users >= needed:
                    break
        
        return to_prepend + compacted
