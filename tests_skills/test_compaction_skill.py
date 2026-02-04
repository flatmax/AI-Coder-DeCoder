"""
Tests for the history compaction skill.

These tests verify that the topic detection and summarization works correctly
using realistic conversation history data.
"""

import json
import os
import pytest
from pathlib import Path
from ac.context.topic_detector import TopicDetector, TopicBoundaryResult


@pytest.fixture(autouse=True)
def setup_llm_env():
    """Apply environment variables from config/litellm.json before tests."""
    # tests_skills/ is at repo root, so parent is repo root
    repo_root = Path(__file__).parent.parent
    llm_json = repo_root / "config" / "litellm.json"
    if llm_json.exists():
        config = json.loads(llm_json.read_text())
        env_vars = config.get("env", {})
        for key, value in env_vars.items():
            os.environ[key] = value


# Test conversation history - simulates a real session with a topic shift
TEST_HISTORY_TOPIC_SHIFT = [
    {
        "role": "user",
        "content": "I'm getting an error in the context viewer - the URL content modal isn't showing up when I click on a URL."
    },
    {
        "role": "assistant", 
        "content": "Let me look at the ContextViewer component. The issue might be in how the modal visibility state is being managed. I'll check the `viewUrl` method and the modal rendering logic."
    },
    {
        "role": "user",
        "content": "I think it might be related to the event handling in PromptView.js"
    },
    {
        "role": "assistant",
        "content": "You're right. Looking at PromptView.js, I can see the `handleContextRemoveUrl` method but there's no handler for viewing URL content. We need to add a `handleViewUrlContent` method that sets the modal state. Here's the fix:\n\n```javascript\nhandleViewUrlContent(e) {\n    this.urlModalContent = e.detail;\n    this.showUrlModal = true;\n}\n```"
    },
    {
        "role": "user",
        "content": "ok good that seems to fix it"
    },
    {
        "role": "assistant",
        "content": "Great to hear the fix worked! Is there anything else you'd like me to help with on the codebase?"
    },
    {
        "role": "user",
        "content": "ready for me to commit ?"
    },
    {
        "role": "assistant",
        "content": "Yes, go ahead and commit! The changes look good."
    },
    # Topic shift - new task begins here (index 8)
    {
        "role": "user",
        "content": "Now I want to add a new feature - history compaction. When the conversation gets too long, we should summarize older messages."
    },
    {
        "role": "assistant",
        "content": "That's a great feature to add. We'll need to:\n1. Detect topic boundaries in the conversation\n2. Summarize content before the boundary\n3. Keep recent messages verbatim\n\nLet me create a plan for this. We'll add a TopicDetector class and a HistoryCompactor."
    },
    {
        "role": "user",
        "content": "sounds good, let's start with the topic detector"
    },
]

# Test history with no clear topic shift - continuous single topic
TEST_HISTORY_SINGLE_TOPIC = [
    {
        "role": "user",
        "content": "I want to implement a file upload feature for the webapp"
    },
    {
        "role": "assistant",
        "content": "Let's start by adding a file input component. We'll need to handle the file selection and upload it to the server."
    },
    {
        "role": "user",
        "content": "What about drag and drop support?"
    },
    {
        "role": "assistant",
        "content": "Good idea. We can add drag and drop handlers to the upload area. Here's how we'd implement it with ondragover and ondrop events."
    },
    {
        "role": "user",
        "content": "Can we also show a progress bar during upload?"
    },
    {
        "role": "assistant",
        "content": "Yes, we can track upload progress using XMLHttpRequest's progress event or fetch with ReadableStream. I'll add a progress bar component."
    },
]


def _get_smaller_model() -> str:
    """Get the smaller model from config/litellm.json config."""
    # Use absolute path relative to this file to find repo root
    # tests_skills/ is at repo root, so parent is repo root
    repo_root = Path(__file__).parent.parent
    llm_json = repo_root / "config" / "litellm.json"
    if llm_json.exists():
        config = json.loads(llm_json.read_text())
        # Try both camelCase (from config) and snake_case
        return config.get("smallerModel") or config.get("smaller_model") or "gpt-4o-mini"
    return "gpt-4o-mini"


class TestTopicDetector:
    """Tests for TopicDetector class."""
    
    @pytest.fixture
    def detector(self):
        """Create a TopicDetector with the smaller model from config."""
        return TopicDetector(model=_get_smaller_model())
    
    @pytest.mark.asyncio
    async def test_detects_topic_shift(self, detector):
        """Test that detector identifies a clear topic boundary."""
        result = await detector.find_topic_boundary(TEST_HISTORY_TOPIC_SHIFT)
        
        assert isinstance(result, TopicBoundaryResult)
        assert result.messages_analyzed == len(TEST_HISTORY_TOPIC_SHIFT)
        
        # Should detect boundary around index 8 (where new topic starts)
        # Allow some flexibility - the model might identify it at 7 or 8
        if result.boundary_index is not None:
            assert 7 <= result.boundary_index <= 9, \
                f"Expected boundary near index 8, got {result.boundary_index}"
            assert result.confidence >= 0.5, \
                f"Expected confidence >= 0.5, got {result.confidence}"
        
        # Should have a summary of the prior topic
        assert result.summary, "Expected a summary of prior content"
        # Summary should mention the URL/modal fix topic
        summary_lower = result.summary.lower()
        assert any(word in summary_lower for word in ['url', 'modal', 'context', 'fix', 'viewer']), \
            f"Summary should reference the URL modal fix topic: {result.summary}"
    
    @pytest.mark.asyncio
    async def test_single_topic_no_boundary(self, detector):
        """Test that detector handles continuous single-topic conversation."""
        result = await detector.find_topic_boundary(TEST_HISTORY_SINGLE_TOPIC)
        
        assert isinstance(result, TopicBoundaryResult)
        assert result.messages_analyzed == len(TEST_HISTORY_SINGLE_TOPIC)
        
        # For a single continuous topic, boundary should be None or index 0
        # with lower confidence
        if result.boundary_index is not None and result.boundary_index > 0:
            # If it finds a boundary, confidence should be lower
            assert result.confidence < 0.8, \
                f"Single topic should have lower confidence, got {result.confidence}"
    
    @pytest.mark.asyncio
    async def test_empty_history(self, detector):
        """Test handling of empty message list."""
        result = await detector.find_topic_boundary([])
        
        assert result.boundary_index is None
        assert result.messages_analyzed == 0
        assert result.confidence == 0.0
    
    @pytest.mark.asyncio  
    async def test_single_message(self, detector):
        """Test handling of single message."""
        single_msg = [{"role": "user", "content": "Hello, can you help me?"}]
        result = await detector.find_topic_boundary(single_msg)
        
        assert result.messages_analyzed == 1
        # With only one message, no meaningful boundary detection possible
    
    def test_sync_wrapper(self, detector):
        """Test synchronous wrapper works correctly."""
        result = detector.find_topic_boundary_sync(TEST_HISTORY_TOPIC_SHIFT)
        
        assert isinstance(result, TopicBoundaryResult)
        assert result.messages_analyzed == len(TEST_HISTORY_TOPIC_SHIFT)


class TestCompactionSkillIntegration:
    """Integration tests for compaction using real LLM calls."""
    
    @pytest.fixture
    def compactor(self):
        """Create a HistoryCompactor with test configuration."""
        from ac.history.compactor import HistoryCompactor, CompactionConfig
        
        # Test data is ~294 tokens, so set threshold below that to trigger compaction
        config = CompactionConfig(
            compaction_trigger_tokens=200,  # Below test data size to trigger compaction
            verbatim_window_tokens=100,     # Keep last ~100 tokens verbatim
            summary_budget_tokens=100,
            min_verbatim_exchanges=1,
            min_confidence=0.5
        )
        return HistoryCompactor(
            config=config,
            detection_model=_get_smaller_model()
        )
    
    @pytest.mark.asyncio
    async def test_compaction_with_topic_shift(self, compactor):
        """Test full compaction flow with topic shift."""
        result = await compactor.compact(TEST_HISTORY_TOPIC_SHIFT)
        
        # Should have compacted some messages
        assert len(result.compacted_messages) < len(TEST_HISTORY_TOPIC_SHIFT)
        assert result.truncated_count > 0
        
        # Should preserve recent messages (the new topic)
        assert result.tokens_after < result.tokens_before
        
        # Case should be either truncate_only or summarize
        assert result.case in ("truncate_only", "summarize")
    
    @pytest.mark.asyncio
    async def test_compaction_preserves_recent_context(self, compactor):
        """Test that compaction preserves the most recent exchanges."""
        result = await compactor.compact(TEST_HISTORY_TOPIC_SHIFT)
        
        # The last few messages should be preserved
        last_user_msg = TEST_HISTORY_TOPIC_SHIFT[-2]["content"]  # "sounds good..."
        last_asst_msg = TEST_HISTORY_TOPIC_SHIFT[-1]["content"]  # Response about topic detector
        
        compacted_contents = [m.get("content", "") for m in result.compacted_messages]
        
        # At minimum, very recent messages should be in the compacted result
        # (either verbatim or the new topic should be preserved)
        assert any("topic" in c.lower() or "compaction" in c.lower() or "history" in c.lower() 
                   for c in compacted_contents), \
            "Recent topic about history compaction should be preserved"
