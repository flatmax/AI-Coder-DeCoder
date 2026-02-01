"""Tests for the TopicDetector."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from ac.context.topic_detector import (
    TopicDetector,
    TopicBoundaryResult,
    _format_messages_for_analysis,
    _parse_llm_response,
    _load_compaction_prompt,
)


class TestFormatMessagesForAnalysis:
    """Tests for message formatting."""
    
    def test_empty_messages(self):
        """Empty list returns empty string."""
        result = _format_messages_for_analysis([])
        assert result == ""
    
    def test_single_message(self):
        """Single message is formatted with index."""
        messages = [{"role": "user", "content": "Hello"}]
        result = _format_messages_for_analysis(messages)
        assert "[0] USER: Hello" in result
    
    def test_multiple_messages(self):
        """Multiple messages are formatted with correct indices."""
        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there"},
            {"role": "user", "content": "How are you?"},
        ]
        result = _format_messages_for_analysis(messages)
        assert "[0] USER: Hello" in result
        assert "[1] ASSISTANT: Hi there" in result
        assert "[2] USER: How are you?" in result
    
    def test_truncates_long_messages(self):
        """Long messages are truncated."""
        long_content = "x" * 2000
        messages = [{"role": "user", "content": long_content}]
        result = _format_messages_for_analysis(messages)
        assert "... [truncated]" in result
        assert len(result) < 1500  # Should be truncated
    
    def test_handles_list_content(self):
        """Structured content (images) is handled."""
        messages = [{
            "role": "user",
            "content": [
                {"type": "text", "text": "Look at this image"},
                {"type": "image_url", "image_url": {"url": "data:..."}}
            ]
        }]
        result = _format_messages_for_analysis(messages)
        assert "Look at this image" in result
    
    def test_max_messages_limit(self):
        """Only most recent messages are included when over limit."""
        messages = [{"role": "user", "content": f"Message {i}"} for i in range(100)]
        result = _format_messages_for_analysis(messages, max_messages=10)
        # Should have messages 90-99
        assert "[90]" in result
        assert "[99]" in result
        assert "[0]" not in result
    
    def test_handles_missing_role(self):
        """Missing role defaults to 'unknown'."""
        messages = [{"content": "No role here"}]
        result = _format_messages_for_analysis(messages)
        assert "UNKNOWN:" in result


class TestParseLLMResponse:
    """Tests for LLM response parsing."""
    
    def test_valid_json(self):
        """Valid JSON is parsed correctly."""
        response = '{"boundary_index": 5, "boundary_reason": "topic shift", "confidence": 0.8, "summary": "discussed files"}'
        result = _parse_llm_response(response)
        assert result["boundary_index"] == 5
        assert result["boundary_reason"] == "topic shift"
        assert result["confidence"] == 0.8
        assert result["summary"] == "discussed files"
    
    def test_json_with_markdown_fencing(self):
        """JSON wrapped in markdown code fences is extracted."""
        response = '''```json
{"boundary_index": 3, "boundary_reason": "new task", "confidence": 0.9, "summary": "completed feature"}
```'''
        result = _parse_llm_response(response)
        assert result["boundary_index"] == 3
        assert result["confidence"] == 0.9
    
    def test_json_embedded_in_text(self):
        """JSON embedded in other text is extracted."""
        response = '''Here is my analysis:
{"boundary_index": 2, "boundary_reason": "file change", "confidence": 0.7, "summary": "worked on auth"}
I hope this helps!'''
        result = _parse_llm_response(response)
        assert result["boundary_index"] == 2
    
    def test_null_boundary_index(self):
        """null boundary_index is parsed correctly."""
        response = '{"boundary_index": null, "boundary_reason": "continuous topic", "confidence": 0.6, "summary": ""}'
        result = _parse_llm_response(response)
        assert result["boundary_index"] is None
    
    def test_invalid_json_returns_default(self):
        """Invalid JSON returns safe defaults."""
        response = "This is not valid JSON at all"
        result = _parse_llm_response(response)
        assert result["boundary_index"] is None
        assert result["confidence"] == 0.0
        assert "Failed to parse" in result["boundary_reason"]


class TestLoadCompactionPrompt:
    """Tests for prompt loading."""
    
    def test_loads_prompt_file(self):
        """Prompt file is loaded when it exists."""
        prompt = _load_compaction_prompt()
        assert "topic boundary" in prompt.lower() or "topic boundaries" in prompt.lower()
        assert "JSON" in prompt or "json" in prompt
    
    def test_prompt_contains_required_fields(self):
        """Prompt mentions required output fields."""
        prompt = _load_compaction_prompt()
        assert "boundary_index" in prompt
        assert "confidence" in prompt
        assert "summary" in prompt


class TestTopicDetectorInit:
    """Tests for TopicDetector initialization."""
    
    def test_default_model(self):
        """Default model is set."""
        detector = TopicDetector()
        assert detector.model is not None
        assert "claude" in detector.model or "gpt" in detector.model or "anthropic" in detector.model
    
    def test_custom_model(self):
        """Custom model can be specified."""
        detector = TopicDetector(model="openai/gpt-4")
        assert detector.model == "openai/gpt-4"
    
    def test_prompt_loaded(self):
        """Compaction prompt is loaded on init."""
        detector = TopicDetector()
        assert detector._prompt is not None
        assert len(detector._prompt) > 100


class TestTopicDetectorFindBoundary:
    """Tests for topic boundary detection."""
    
    def test_empty_messages(self):
        """Empty message list returns no boundary."""
        detector = TopicDetector()
        result = detector.find_topic_boundary_sync([])
        
        assert result.boundary_index is None
        assert result.messages_analyzed == 0
        assert result.confidence == 0.0
    
    def test_successful_detection(self):
        """Successful detection returns valid result."""
        detector = TopicDetector()
        
        # Mock the LLM response
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = '{"boundary_index": 2, "boundary_reason": "new feature", "confidence": 0.85, "summary": "Fixed bug in auth"}'
        
        messages = [
            {"role": "user", "content": "Fix the login bug"},
            {"role": "assistant", "content": "I fixed it"},
            {"role": "user", "content": "Now let's add a new feature"},
            {"role": "assistant", "content": "Sure, what feature?"},
        ]
        
        with patch('litellm.acompletion', new_callable=AsyncMock) as mock_completion:
            mock_completion.return_value = mock_response
            result = detector.find_topic_boundary_sync(messages)
        
        assert result.boundary_index == 2
        assert result.boundary_reason == "new feature"
        assert result.confidence == 0.85
        assert result.summary == "Fixed bug in auth"
        assert result.messages_analyzed == 4
    
    def test_invalid_boundary_index_clamped(self):
        """Invalid boundary index is set to None."""
        detector = TopicDetector()
        
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        # boundary_index 10 is out of range for 4 messages
        mock_response.choices[0].message.content = '{"boundary_index": 10, "boundary_reason": "test", "confidence": 0.5, "summary": ""}'
        
        messages = [
            {"role": "user", "content": "msg1"},
            {"role": "assistant", "content": "msg2"},
            {"role": "user", "content": "msg3"},
            {"role": "assistant", "content": "msg4"},
        ]
        
        with patch('litellm.acompletion', new_callable=AsyncMock) as mock_completion:
            mock_completion.return_value = mock_response
            result = detector.find_topic_boundary_sync(messages)
        
        assert result.boundary_index is None
    
    def test_negative_boundary_index_rejected(self):
        """Negative boundary index is set to None."""
        detector = TopicDetector()
        
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = '{"boundary_index": -1, "boundary_reason": "test", "confidence": 0.5, "summary": ""}'
        
        messages = [{"role": "user", "content": "msg"}]
        
        with patch('litellm.acompletion', new_callable=AsyncMock) as mock_completion:
            mock_completion.return_value = mock_response
            result = detector.find_topic_boundary_sync(messages)
        
        assert result.boundary_index is None
    
    def test_llm_error_handled(self):
        """LLM errors are handled gracefully."""
        detector = TopicDetector()
        
        messages = [{"role": "user", "content": "test"}]
        
        with patch('litellm.acompletion', new_callable=AsyncMock) as mock_completion:
            mock_completion.side_effect = Exception("API error")
            result = detector.find_topic_boundary_sync(messages)
        
        assert result.boundary_index is None
        assert result.confidence == 0.0
        assert "Detection failed" in result.boundary_reason
        assert result.messages_analyzed == 1


class TestTopicDetectorSync:
    """Tests for synchronous wrapper."""
    
    def test_sync_wrapper_works(self):
        """Sync wrapper successfully calls async method."""
        detector = TopicDetector()
        
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = '{"boundary_index": null, "boundary_reason": "no boundary", "confidence": 0.3, "summary": ""}'
        
        messages = [{"role": "user", "content": "test"}]
        
        with patch('litellm.acompletion', new_callable=AsyncMock) as mock_completion:
            mock_completion.return_value = mock_response
            result = detector.find_topic_boundary_sync(messages)
        
        assert isinstance(result, TopicBoundaryResult)
        assert result.boundary_index is None


class TestTopicBoundaryResult:
    """Tests for the result dataclass."""
    
    def test_dataclass_fields(self):
        """All expected fields are present."""
        result = TopicBoundaryResult(
            boundary_index=5,
            boundary_reason="topic shift",
            confidence=0.9,
            summary="Summary text",
            messages_analyzed=10
        )
        
        assert result.boundary_index == 5
        assert result.boundary_reason == "topic shift"
        assert result.confidence == 0.9
        assert result.summary == "Summary text"
        assert result.messages_analyzed == 10
    
    def test_optional_boundary_index(self):
        """boundary_index can be None."""
        result = TopicBoundaryResult(
            boundary_index=None,
            boundary_reason="no boundary found",
            confidence=0.1,
            summary="",
            messages_analyzed=5
        )
        
        assert result.boundary_index is None
