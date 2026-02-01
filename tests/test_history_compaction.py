"""Tests for the HistoryCompactor."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from ac.history.compactor import (
    HistoryCompactor,
    CompactionConfig,
    CompactionResult,
)
from ac.context.topic_detector import TopicBoundaryResult


class TestCompactionConfig:
    """Tests for CompactionConfig defaults."""
    
    def test_default_values(self):
        """Default configuration values are sensible."""
        config = CompactionConfig()
        assert config.compaction_trigger_tokens == 6000
        assert config.verbatim_window_tokens == 3000
        assert config.summary_budget_tokens == 500
        assert config.min_verbatim_exchanges == 2
        assert config.min_confidence == 0.5
    
    def test_custom_values(self):
        """Custom values can be set."""
        config = CompactionConfig(
            compaction_trigger_tokens=10000,
            verbatim_window_tokens=5000,
            min_confidence=0.7
        )
        assert config.compaction_trigger_tokens == 10000
        assert config.verbatim_window_tokens == 5000
        assert config.min_confidence == 0.7


class TestCompactionResult:
    """Tests for CompactionResult dataclass."""
    
    def test_default_values(self):
        """Result has sensible defaults."""
        result = CompactionResult(compacted_messages=[])
        assert result.summary_message is None
        assert result.truncated_count == 0
        assert result.case == "none"
    
    def test_all_fields(self):
        """All fields can be set."""
        result = CompactionResult(
            compacted_messages=[{"role": "user", "content": "test"}],
            summary_message={"role": "system", "content": "summary"},
            truncated_count=5,
            topic_detected="new feature",
            boundary_index=3,
            confidence=0.9,
            tokens_before=5000,
            tokens_after=2000,
            case="summarize"
        )
        assert result.truncated_count == 5
        assert result.case == "summarize"


class TestHistoryCompactorInit:
    """Tests for HistoryCompactor initialization."""
    
    def test_default_init(self):
        """Can initialize with detection_model."""
        compactor = HistoryCompactor(detection_model="gpt-4o-mini")
        assert compactor.config is not None
        assert compactor.token_counter is not None
        assert compactor.topic_detector is not None
    
    def test_custom_config(self):
        """Can initialize with custom config."""
        config = CompactionConfig(compaction_trigger_tokens=8000)
        compactor = HistoryCompactor(config=config, detection_model="gpt-4o-mini")
        assert compactor.config.compaction_trigger_tokens == 8000
    
    def test_detection_model_required(self):
        """detection_model is required."""
        with pytest.raises(ValueError, match="detection_model is required"):
            HistoryCompactor()


class TestShouldCompact:
    """Tests for should_compact() method."""
    
    def test_empty_messages(self):
        """Empty messages don't need compaction."""
        compactor = HistoryCompactor(detection_model="gpt-4o-mini")
        assert compactor.should_compact([]) is False
    
    def test_below_threshold(self):
        """Messages below threshold don't need compaction."""
        config = CompactionConfig(compaction_trigger_tokens=10000)
        compactor = HistoryCompactor(config=config, detection_model="gpt-4o-mini")
        
        # Short messages, well under threshold
        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there"},
        ]
        assert compactor.should_compact(messages) is False
    
    def test_above_threshold(self):
        """Messages above threshold need compaction."""
        config = CompactionConfig(compaction_trigger_tokens=100)  # Very low threshold
        compactor = HistoryCompactor(config=config, detection_model="gpt-4o-mini")
        
        # Messages that exceed 100 tokens (use words - each word is ~1 token)
        messages = [
            {"role": "user", "content": " ".join(["word"] * 80)},
            {"role": "assistant", "content": " ".join(["response"] * 80)},
        ]
        assert compactor.should_compact(messages) is True


class TestFindVerbatimWindowStart:
    """Tests for _find_verbatim_window_start() method."""
    
    def test_empty_messages(self):
        """Empty messages returns 0."""
        compactor = HistoryCompactor(detection_model="gpt-4o-mini")
        assert compactor._find_verbatim_window_start([]) == 0
    
    def test_all_messages_fit(self):
        """When all messages fit in window, returns 0."""
        config = CompactionConfig(verbatim_window_tokens=10000)
        compactor = HistoryCompactor(config=config, detection_model="gpt-4o-mini")
        
        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi"},
        ]
        assert compactor._find_verbatim_window_start(messages) == 0
    
    def test_window_boundary(self):
        """Window boundary is calculated correctly."""
        config = CompactionConfig(verbatim_window_tokens=50)  # Very small window
        compactor = HistoryCompactor(config=config, detection_model="gpt-4o-mini")
        
        # Each message ~30 tokens, total ~120 tokens, window of 50 fits ~1-2 messages
        messages = [
            {"role": "user", "content": " ".join(["word"] * 30)},
            {"role": "assistant", "content": " ".join(["response"] * 30)},
            {"role": "user", "content": " ".join(["another"] * 30)},
            {"role": "assistant", "content": " ".join(["reply"] * 30)},
        ]
        
        start_idx = compactor._find_verbatim_window_start(messages)
        # Should start somewhere in the middle, not at 0
        assert start_idx > 0
        assert start_idx < len(messages)


class TestCompact:
    """Tests for compact() method."""
    
    def test_no_compaction_needed(self):
        """Returns original messages if under threshold."""
        config = CompactionConfig(compaction_trigger_tokens=10000)
        compactor = HistoryCompactor(config=config, detection_model="gpt-4o-mini")
        
        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi"},
        ]
        
        result = compactor.compact_sync(messages)
        
        assert result.compacted_messages == messages
        assert result.case == "none"
        assert result.truncated_count == 0
    
    def test_empty_messages(self):
        """Empty messages returns empty result."""
        compactor = HistoryCompactor(detection_model="gpt-4o-mini")
        result = compactor.compact_sync([])
        
        assert result.compacted_messages == []
        assert result.case == "none"
    
    def test_truncate_only_case(self):
        """Case 1: Boundary inside verbatim window triggers truncate only."""
        config = CompactionConfig(
            compaction_trigger_tokens=100,  # Trigger when > 100 tokens
            verbatim_window_tokens=120,     # Large enough to include boundary index
            min_confidence=0.5,
            min_verbatim_exchanges=1        # Allow keeping just 1 exchange
        )
        compactor = HistoryCompactor(config=config, detection_model="gpt-4o-mini")
        
        # Create messages with known token counts (~40 tokens each, total ~160)
        messages = [
            {"role": "user", "content": " ".join(["old"] * 40)},
            {"role": "assistant", "content": " ".join(["oldreply"] * 40)},
            {"role": "user", "content": " ".join(["new"] * 40)},
            {"role": "assistant", "content": " ".join(["newreply"] * 40)},
        ]
        # Total ~160 tokens, exceeds 100 trigger
        # Verbatim window of 120 tokens = last ~3 messages (indices 1, 2, 3)
        # So verbatim_start_idx = 1
        # Boundary at index 2 is INSIDE verbatim window (2 >= 1)
        
        mock_boundary = TopicBoundaryResult(
            boundary_index=2,
            boundary_reason="new topic",
            confidence=0.9,
            summary="Old topic discussion",
            messages_analyzed=4
        )
        
        with patch.object(
            compactor.topic_detector, 
            'find_topic_boundary',
            new_callable=AsyncMock
        ) as mock_detect:
            mock_detect.return_value = mock_boundary
            result = compactor.compact_sync(messages)
        
        assert result.case == "truncate_only"
        assert result.summary_message is None
        assert result.boundary_index == 2
        # Should have truncated messages before boundary (indices 0, 1)
        assert len(result.compacted_messages) == 2
        assert result.truncated_count == 2
    
    def test_summarize_case(self):
        """Case 2: Boundary outside verbatim window triggers summarization."""
        config = CompactionConfig(
            compaction_trigger_tokens=50,   # Very low to trigger compaction
            verbatim_window_tokens=10,      # Tiny window - only last ~1 message fits
            min_confidence=0.5
        )
        compactor = HistoryCompactor(config=config, detection_model="gpt-4o-mini")
        
        # All messages ~40 tokens each except last two which are short
        # Total well over 50 tokens to trigger compaction
        messages = [
            {"role": "user", "content": " ".join(["old"] * 40)},        # ~40 tokens
            {"role": "assistant", "content": " ".join(["reply"] * 40)}, # ~40 tokens
            {"role": "user", "content": " ".join(["more"] * 40)},       # ~40 tokens
            {"role": "assistant", "content": " ".join(["response"] * 40)}, # ~40 tokens
        ]
        # Total ~160 tokens, exceeds 50 trigger
        # Verbatim window of 10 tokens = only last message (index 3)
        # So verbatim_start_idx = 3
        # Boundary at index 1 is OUTSIDE verbatim window (1 < 3) → summarize
        
        mock_boundary = TopicBoundaryResult(
            boundary_index=1,
            boundary_reason="topic shift",
            confidence=0.8,
            summary="Discussed the old feature in detail",
            messages_analyzed=4
        )
        
        with patch.object(
            compactor.topic_detector,
            'find_topic_boundary',
            new_callable=AsyncMock
        ) as mock_detect:
            mock_detect.return_value = mock_boundary
            result = compactor.compact_sync(messages)
        
        assert result.case == "summarize"
        assert result.summary_message is not None
        assert "History Summary" in result.summary_message["content"]
        assert "old feature" in result.summary_message["content"]  # Summary text included
        assert result.summary_message["role"] == "system"
    
    def test_low_confidence_falls_back_to_summarize(self):
        """Low confidence boundary falls back to summarize case."""
        config = CompactionConfig(
            compaction_trigger_tokens=100,  # Trigger above 100 tokens
            verbatim_window_tokens=60,      # Small verbatim window
            min_confidence=0.8              # High confidence threshold
        )
        compactor = HistoryCompactor(config=config, detection_model="gpt-4o-mini")
        
        # Create messages totaling > 100 tokens (~160 total)
        messages = [
            {"role": "user", "content": " ".join(["word"] * 40)},
            {"role": "assistant", "content": " ".join(["response"] * 40)},
            {"role": "user", "content": " ".join(["another"] * 40)},
            {"role": "assistant", "content": " ".join(["reply"] * 40)},
        ]
        
        # Mock low confidence result
        mock_boundary = TopicBoundaryResult(
            boundary_index=2,
            boundary_reason="maybe topic shift",
            confidence=0.4,  # Below 0.8 threshold
            summary="Some discussion happened earlier",
            messages_analyzed=4
        )
        
        with patch.object(
            compactor.topic_detector,
            'find_topic_boundary',
            new_callable=AsyncMock
        ) as mock_detect:
            mock_detect.return_value = mock_boundary
            result = compactor.compact_sync(messages)
        
        # Should fall back to summarize case due to low confidence
        assert result.case == "summarize"
        assert result.summary_message is not None


class TestMinExchanges:
    """Tests for minimum exchange preservation."""
    
    def test_ensures_min_exchanges_adds_messages(self):
        """Compaction adds messages to meet minimum exchange requirement."""
        config = CompactionConfig(
            compaction_trigger_tokens=50,
            verbatim_window_tokens=200,  # Large window to trigger truncate_only
            min_verbatim_exchanges=3     # Require 3 exchanges
        )
        compactor = HistoryCompactor(config=config, detection_model="gpt-4o-mini")
        
        # 4 exchanges total
        messages = [
            {"role": "user", "content": "First " * 20},
            {"role": "assistant", "content": "Response1 " * 20},
            {"role": "user", "content": "Second " * 20},
            {"role": "assistant", "content": "Response2 " * 20},
            {"role": "user", "content": "Third " * 20},
            {"role": "assistant", "content": "Response3 " * 20},
            {"role": "user", "content": "Fourth"},
            {"role": "assistant", "content": "Response4"},
        ]
        
        # Boundary at index 6 would leave only 1 user message (Fourth)
        # min_verbatim_exchanges=3 should force adding more
        mock_boundary = TopicBoundaryResult(
            boundary_index=6,
            boundary_reason="topic",
            confidence=0.9,
            summary="Earlier discussion",
            messages_analyzed=8
        )
        
        with patch.object(
            compactor.topic_detector,
            'find_topic_boundary',
            new_callable=AsyncMock
        ) as mock_detect:
            mock_detect.return_value = mock_boundary
            result = compactor.compact_sync(messages)
        
        # Count user messages in result - should have at least 3
        user_count = sum(
            1 for m in result.compacted_messages 
            if m.get("role") == "user"
        )
        assert user_count >= 3, f"Expected at least 3 user messages, got {user_count}"
        
        # Verify we actually added messages (more than just index 6-7)
        assert len(result.compacted_messages) > 2, "Should have added messages to meet minimum"


class TestNoBoundaryDetected:
    """Tests for when no topic boundary is found."""
    
    def test_null_boundary_falls_back_to_summarize(self):
        """When no boundary is detected, falls back to summarize case."""
        config = CompactionConfig(
            compaction_trigger_tokens=100,
            verbatim_window_tokens=60,
            min_confidence=0.5
        )
        compactor = HistoryCompactor(config=config, detection_model="gpt-4o-mini")
        
        # Create messages exceeding trigger threshold
        messages = [
            {"role": "user", "content": " ".join(["word"] * 40)},
            {"role": "assistant", "content": " ".join(["response"] * 40)},
            {"role": "user", "content": " ".join(["more"] * 40)},
            {"role": "assistant", "content": " ".join(["reply"] * 40)},
        ]
        
        # Mock no boundary detected
        mock_boundary = TopicBoundaryResult(
            boundary_index=None,  # No boundary found
            boundary_reason="continuous topic throughout",
            confidence=0.3,
            summary="Discussed various topics without clear shift",
            messages_analyzed=4
        )
        
        with patch.object(
            compactor.topic_detector,
            'find_topic_boundary',
            new_callable=AsyncMock
        ) as mock_detect:
            mock_detect.return_value = mock_boundary
            result = compactor.compact_sync(messages)
        
        # Should fall back to summarize case
        assert result.case == "summarize"
        assert result.boundary_index is None
        # Should still have summary from old messages
        assert result.summary_message is not None


class TestCreateSummaryMessage:
    """Tests for summary message creation."""
    
    def test_summary_format(self):
        """Summary message has correct format."""
        compactor = HistoryCompactor(detection_model="gpt-4o-mini")
        
        summary_msg = compactor._create_summary_message(
            "Discussed authentication and fixed login bug.",
            5
        )
        
        assert summary_msg["role"] == "system"
        assert "History Summary" in summary_msg["content"]
        assert "5 earlier messages" in summary_msg["content"]
        assert "authentication" in summary_msg["content"]
