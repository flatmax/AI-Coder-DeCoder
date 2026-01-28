"""Tests for URL handler models."""

import pytest
from datetime import datetime

from ac.url_handler import URLContent, URLResult, URLType
from ac.url_handler.models import GitHubInfo, SummaryType


class TestGitHubInfo:
    """Tests for GitHubInfo dataclass."""
    
    def test_repo_url(self):
        info = GitHubInfo(owner="owner", repo="repo")
        assert info.repo_url == "https://github.com/owner/repo"
    
    def test_clone_url(self):
        info = GitHubInfo(owner="owner", repo="repo")
        assert info.clone_url == "https://github.com/owner/repo.git"
    
    def test_with_branch_and_path(self):
        info = GitHubInfo(
            owner="owner",
            repo="repo",
            branch="main",
            path="src/file.py"
        )
        assert info.branch == "main"
        assert info.path == "src/file.py"


class TestURLContent:
    """Tests for URLContent dataclass."""
    
    def test_basic_creation(self):
        content = URLContent(
            url="https://example.com",
            url_type=URLType.GENERIC_WEB,
        )
        assert content.url == "https://example.com"
        assert content.url_type == URLType.GENERIC_WEB
        assert content.error is None
    
    def test_to_dict(self):
        now = datetime.now()
        content = URLContent(
            url="https://github.com/owner/repo",
            url_type=URLType.GITHUB_REPO,
            title="Test Repo",
            github_info=GitHubInfo(owner="owner", repo="repo"),
            fetched_at=now,
        )
        d = content.to_dict()
        assert d['url'] == "https://github.com/owner/repo"
        assert d['url_type'] == "github_repo"
        assert d['title'] == "Test Repo"
        assert d['github_info']['owner'] == "owner"
        assert d['fetched_at'] == now.isoformat()
    
    def test_from_dict(self):
        data = {
            'url': 'https://example.com',
            'url_type': 'generic_web',
            'title': 'Example',
            'content': 'Some content',
            'github_info': None,
            'fetched_at': '2024-01-15T10:30:00',
        }
        content = URLContent.from_dict(data)
        assert content.url == 'https://example.com'
        assert content.url_type == URLType.GENERIC_WEB
        assert content.title == 'Example'
        assert content.fetched_at.year == 2024
    
    def test_roundtrip(self):
        original = URLContent(
            url="https://github.com/a/b",
            url_type=URLType.GITHUB_REPO,
            title="Repo",
            description="A repo",
            readme="# README",
            github_info=GitHubInfo(owner="a", repo="b"),
            fetched_at=datetime(2024, 1, 15, 10, 30),
        )
        d = original.to_dict()
        restored = URLContent.from_dict(d)
        assert restored.url == original.url
        assert restored.url_type == original.url_type
        assert restored.github_info.owner == original.github_info.owner


class TestURLResult:
    """Tests for URLResult dataclass."""
    
    def test_basic_creation(self):
        content = URLContent(
            url="https://example.com",
            url_type=URLType.GENERIC_WEB,
        )
        result = URLResult(content=content)
        assert result.content == content
        assert result.cached is False
    
    def test_with_summary(self):
        content = URLContent(
            url="https://example.com",
            url_type=URLType.GENERIC_WEB,
        )
        result = URLResult(
            content=content,
            summary="Brief summary",
            summary_type=SummaryType.BRIEF,
            cached=True,
        )
        assert result.summary == "Brief summary"
        assert result.summary_type == SummaryType.BRIEF
        assert result.cached is True
    
    def test_to_dict(self):
        content = URLContent(
            url="https://example.com",
            url_type=URLType.GENERIC_WEB,
        )
        result = URLResult(
            content=content,
            summary="Test",
            summary_type=SummaryType.USAGE,
        )
        d = result.to_dict()
        assert d['summary'] == "Test"
        assert d['summary_type'] == "usage"
        assert d['content']['url'] == "https://example.com"
