"""Tests for URL content summarizer."""

import pytest
from unittest import mock
from datetime import datetime

from ac.url_handler.models import URLContent, URLType, SummaryType
from ac.url_handler.summarizer import Summarizer, SUMMARY_PROMPTS, SYSTEM_PROMPT


class TestSummarizerInit:
    """Tests for Summarizer initialization."""
    
    def test_default_model(self):
        """Test default model is set."""
        s = Summarizer()
        assert s.model == "claude-3-5-haiku-latest"
    
    def test_custom_model(self):
        """Test custom model can be set."""
        s = Summarizer(model="gpt-4o-mini")
        assert s.model == "gpt-4o-mini"


class TestSummaryPrompts:
    """Tests for summary prompt configuration."""
    
    def test_all_summary_types_have_prompts(self):
        """All SummaryType values should have prompts."""
        for st in SummaryType:
            assert st in SUMMARY_PROMPTS
            assert len(SUMMARY_PROMPTS[st]) > 0
    
    def test_prompts_are_distinct(self):
        """Each prompt should be unique."""
        prompts = list(SUMMARY_PROMPTS.values())
        assert len(prompts) == len(set(prompts))


class TestSummarizerSummarize:
    """Tests for the summarize method."""
    
    @mock.patch('ac.url_handler.summarizer._litellm')
    def test_summarize_basic(self, mock_litellm):
        """Test basic summarization call."""
        # Setup mock response
        mock_response = mock.MagicMock()
        mock_response.choices = [mock.MagicMock()]
        mock_response.choices[0].message.content = "This is a test summary."
        mock_litellm.completion.return_value = mock_response
        
        content = URLContent(
            url="https://github.com/test/repo",
            url_type=URLType.GITHUB_REPO,
            title="Test Repo",
            readme="# Test\nThis is a test repository.",
        )
        
        s = Summarizer()
        result = s.summarize(content, SummaryType.BRIEF)
        
        assert result == "This is a test summary."
        mock_litellm.completion.assert_called_once()
        
        # Check the call arguments
        call_args = mock_litellm.completion.call_args
        assert call_args.kwargs['model'] == "claude-3-5-haiku-latest"
        messages = call_args.kwargs['messages']
        assert len(messages) == 2
        assert messages[0]['role'] == 'system'
        assert messages[1]['role'] == 'user'
    
    @mock.patch('ac.url_handler.summarizer._litellm')
    def test_summarize_includes_all_content_parts(self, mock_litellm):
        """Test that all content parts are included."""
        mock_response = mock.MagicMock()
        mock_response.choices = [mock.MagicMock()]
        mock_response.choices[0].message.content = "Summary"
        mock_litellm.completion.return_value = mock_response
        
        content = URLContent(
            url="https://example.com",
            url_type=URLType.GITHUB_REPO,
            title="My Title",
            description="My description",
            readme="README content",
            symbol_map="symbol map content",
            content="main content",
        )
        
        s = Summarizer()
        s.summarize(content, SummaryType.BRIEF)
        
        # Check user message contains all parts
        call_args = mock_litellm.completion.call_args
        user_msg = call_args.kwargs['messages'][1]['content']
        assert "My Title" in user_msg
        assert "My description" in user_msg
        assert "README content" in user_msg
        assert "symbol map content" in user_msg
        assert "main content" in user_msg
    
    @mock.patch('ac.url_handler.summarizer._litellm')
    def test_summarize_with_context(self, mock_litellm):
        """Test that user context is included."""
        mock_response = mock.MagicMock()
        mock_response.choices = [mock.MagicMock()]
        mock_response.choices[0].message.content = "Summary"
        mock_litellm.completion.return_value = mock_response
        
        content = URLContent(
            url="https://example.com",
            url_type=URLType.GENERIC_WEB,
            content="Some content",
        )
        
        s = Summarizer()
        s.summarize(content, SummaryType.USAGE, context="How do I install this?")
        
        call_args = mock_litellm.completion.call_args
        user_msg = call_args.kwargs['messages'][1]['content']
        assert "How do I install this?" in user_msg
    
    @mock.patch('ac.url_handler.summarizer._litellm')
    def test_summarize_uses_correct_prompt_type(self, mock_litellm):
        """Test that the correct summary type prompt is used."""
        mock_response = mock.MagicMock()
        mock_response.choices = [mock.MagicMock()]
        mock_response.choices[0].message.content = "Summary"
        mock_litellm.completion.return_value = mock_response
        
        content = URLContent(
            url="https://example.com",
            url_type=URLType.GENERIC_WEB,
            content="Some content",
        )
        
        s = Summarizer()
        s.summarize(content, SummaryType.API)
        
        call_args = mock_litellm.completion.call_args
        user_msg = call_args.kwargs['messages'][1]['content']
        # API prompt should mention classes, functions, signatures
        assert "classes" in user_msg.lower() or "functions" in user_msg.lower()
    
    def test_summarize_empty_content(self):
        """Test handling of empty content."""
        content = URLContent(
            url="https://example.com",
            url_type=URLType.GENERIC_WEB,
        )
        
        s = Summarizer()
        result = s.summarize(content, SummaryType.BRIEF)
        
        assert result == "No content available to summarize."
    
    @mock.patch('ac.url_handler.summarizer._litellm')
    def test_summarize_truncates_long_content(self, mock_litellm):
        """Test that very long content is truncated."""
        mock_response = mock.MagicMock()
        mock_response.choices = [mock.MagicMock()]
        mock_response.choices[0].message.content = "Summary"
        mock_litellm.completion.return_value = mock_response
        
        # Create content longer than 100k chars
        long_content = "x" * 150000
        content = URLContent(
            url="https://example.com",
            url_type=URLType.GENERIC_WEB,
            content=long_content,
        )
        
        s = Summarizer()
        s.summarize(content, SummaryType.BRIEF)
        
        call_args = mock_litellm.completion.call_args
        user_msg = call_args.kwargs['messages'][1]['content']
        assert "[Content truncated...]" in user_msg
        assert len(user_msg) < 150000


class TestSummarizerSummarizeForContext:
    """Tests for the summarize_for_context method."""
    
    @mock.patch('ac.url_handler.summarizer._litellm')
    def test_github_repo_with_symbol_map_uses_architecture(self, mock_litellm):
        """GitHub repos with symbol maps should use architecture summary."""
        mock_response = mock.MagicMock()
        mock_response.choices = [mock.MagicMock()]
        mock_response.choices[0].message.content = "Summary"
        mock_litellm.completion.return_value = mock_response
        
        content = URLContent(
            url="https://github.com/test/repo",
            url_type=URLType.GITHUB_REPO,
            symbol_map="c MyClass:10\n  m method:12",
            readme="# Test",
        )
        
        s = Summarizer()
        s.summarize_for_context(content)
        
        call_args = mock_litellm.completion.call_args
        user_msg = call_args.kwargs['messages'][1]['content']
        # Architecture prompt mentions modules, design patterns
        assert "architecture" in user_msg.lower() or "design" in user_msg.lower()
    
    @mock.patch('ac.url_handler.summarizer._litellm')
    def test_github_repo_without_symbol_map_uses_brief(self, mock_litellm):
        """GitHub repos without symbol maps should use brief summary."""
        mock_response = mock.MagicMock()
        mock_response.choices = [mock.MagicMock()]
        mock_response.choices[0].message.content = "Summary"
        mock_litellm.completion.return_value = mock_response
        
        content = URLContent(
            url="https://github.com/test/repo",
            url_type=URLType.GITHUB_REPO,
            readme="# Test",
        )
        
        s = Summarizer()
        s.summarize_for_context(content)
        
        call_args = mock_litellm.completion.call_args
        user_msg = call_args.kwargs['messages'][1]['content']
        # Brief prompt mentions overview
        assert "overview" in user_msg.lower()
    
    @mock.patch('ac.url_handler.summarizer._litellm')
    def test_documentation_uses_usage(self, mock_litellm):
        """Documentation URLs should use usage summary."""
        mock_response = mock.MagicMock()
        mock_response.choices = [mock.MagicMock()]
        mock_response.choices[0].message.content = "Summary"
        mock_litellm.completion.return_value = mock_response
        
        content = URLContent(
            url="https://docs.python.org/3/library/os.html",
            url_type=URLType.DOCUMENTATION,
            content="os module documentation...",
        )
        
        s = Summarizer()
        s.summarize_for_context(content)
        
        call_args = mock_litellm.completion.call_args
        user_msg = call_args.kwargs['messages'][1]['content']
        # Usage prompt mentions installation, patterns
        assert "usage" in user_msg.lower() or "install" in user_msg.lower()
    
    @mock.patch('ac.url_handler.summarizer._litellm')
    def test_user_question_overrides_default_type(self, mock_litellm):
        """User question should influence summary type."""
        mock_response = mock.MagicMock()
        mock_response.choices = [mock.MagicMock()]
        mock_response.choices[0].message.content = "Summary"
        mock_litellm.completion.return_value = mock_response
        
        content = URLContent(
            url="https://github.com/test/repo",
            url_type=URLType.GITHUB_REPO,
            readme="# Test",
        )
        
        s = Summarizer()
        # Even though it's a repo, asking about API should use API summary
        s.summarize_for_context(content, user_question="What's the API for this library?")
        
        call_args = mock_litellm.completion.call_args
        user_msg = call_args.kwargs['messages'][1]['content']
        # API prompt mentions classes, functions
        assert "class" in user_msg.lower() or "function" in user_msg.lower()
    
    @mock.patch('ac.url_handler.summarizer._litellm')
    def test_evaluation_question(self, mock_litellm):
        """Questions about evaluation should use eval summary."""
        mock_response = mock.MagicMock()
        mock_response.choices = [mock.MagicMock()]
        mock_response.choices[0].message.content = "Summary"
        mock_litellm.completion.return_value = mock_response
        
        content = URLContent(
            url="https://github.com/test/repo",
            url_type=URLType.GITHUB_REPO,
            readme="# Test",
        )
        
        s = Summarizer()
        s.summarize_for_context(content, user_question="Should I use this library or are there alternatives?")
        
        call_args = mock_litellm.completion.call_args
        user_msg = call_args.kwargs['messages'][1]['content']
        # Evaluation prompt mentions maturity, alternatives
        assert "evaluate" in user_msg.lower() or "alternative" in user_msg.lower()
