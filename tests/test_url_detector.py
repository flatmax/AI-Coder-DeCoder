"""Tests for URL detection and classification."""

import pytest

from ac.url_handler import URLDetector, URLType


class TestURLDetectorFindUrls:
    """Tests for finding URLs in text."""
    
    def test_find_single_url(self):
        text = "Check out https://github.com/owner/repo for more info"
        urls = URLDetector.find_urls(text)
        assert urls == ["https://github.com/owner/repo"]
    
    def test_find_multiple_urls(self):
        text = "See https://example.com and https://github.com/a/b"
        urls = URLDetector.find_urls(text)
        assert len(urls) == 2
        assert "https://example.com" in urls
        assert "https://github.com/a/b" in urls
    
    def test_find_no_urls(self):
        text = "No URLs here, just plain text"
        urls = URLDetector.find_urls(text)
        assert urls == []
    
    def test_url_not_followed_by_punctuation(self):
        text = "Visit https://example.com/path, then continue."
        urls = URLDetector.find_urls(text)
        assert urls == ["https://example.com/path"]
    
    def test_url_in_parentheses(self):
        text = "Documentation (https://docs.example.com) is helpful"
        urls = URLDetector.find_urls(text)
        assert urls == ["https://docs.example.com"]


class TestURLDetectorGitHub:
    """Tests for GitHub URL detection."""
    
    def test_github_repo(self):
        url = "https://github.com/owner/repo"
        url_type, info = URLDetector.detect_type(url)
        assert url_type == URLType.GITHUB_REPO
        assert info.owner == "owner"
        assert info.repo == "repo"
        assert info.path is None
    
    def test_github_repo_trailing_slash(self):
        url = "https://github.com/owner/repo/"
        url_type, info = URLDetector.detect_type(url)
        assert url_type == URLType.GITHUB_REPO
        assert info.owner == "owner"
        assert info.repo == "repo"
    
    def test_github_file(self):
        url = "https://github.com/owner/repo/blob/main/src/file.py"
        url_type, info = URLDetector.detect_type(url)
        assert url_type == URLType.GITHUB_FILE
        assert info.owner == "owner"
        assert info.repo == "repo"
        assert info.branch == "main"
        assert info.path == "src/file.py"
    
    def test_github_tree(self):
        url = "https://github.com/owner/repo/tree/develop/src"
        url_type, info = URLDetector.detect_type(url)
        assert url_type == URLType.GITHUB_FILE  # Tree with path is a file/dir
        assert info.owner == "owner"
        assert info.repo == "repo"
        assert info.branch == "develop"
        assert info.path == "src"
    
    def test_github_issue(self):
        url = "https://github.com/owner/repo/issues/123"
        url_type, info = URLDetector.detect_type(url)
        assert url_type == URLType.GITHUB_ISSUE
        assert info.owner == "owner"
        assert info.repo == "repo"
        assert info.issue_number == 123
    
    def test_github_pr(self):
        url = "https://github.com/owner/repo/pull/456"
        url_type, info = URLDetector.detect_type(url)
        assert url_type == URLType.GITHUB_PR
        assert info.owner == "owner"
        assert info.repo == "repo"
        assert info.pr_number == 456
    
    def test_github_raw(self):
        url = "https://raw.githubusercontent.com/owner/repo/main/README.md"
        url_type, info = URLDetector.detect_type(url)
        assert url_type == URLType.GITHUB_FILE
        assert info.owner == "owner"
        assert info.repo == "repo"
        assert info.branch == "main"
        assert info.path == "README.md"
    
    def test_github_info_repo_url(self):
        url = "https://github.com/owner/repo/blob/main/file.py"
        _, info = URLDetector.detect_type(url)
        assert info.repo_url == "https://github.com/owner/repo"
        assert info.clone_url == "https://github.com/owner/repo.git"


class TestURLDetectorDocumentation:
    """Tests for documentation site detection."""
    
    def test_python_docs(self):
        url = "https://docs.python.org/3/library/json.html"
        url_type, info = URLDetector.detect_type(url)
        assert url_type == URLType.DOCUMENTATION
        assert info is None
    
    def test_readthedocs(self):
        url = "https://requests.readthedocs.io/en/latest/"
        url_type, _ = URLDetector.detect_type(url)
        assert url_type == URLType.DOCUMENTATION
    
    def test_mdn(self):
        url = "https://developer.mozilla.org/en-US/docs/Web/JavaScript"
        url_type, _ = URLDetector.detect_type(url)
        assert url_type == URLType.DOCUMENTATION
    
    def test_generic_with_docs_path(self):
        url = "https://example.com/docs/api/reference"
        url_type, _ = URLDetector.detect_type(url)
        assert url_type == URLType.DOCUMENTATION


class TestURLDetectorGeneric:
    """Tests for generic web URL detection."""
    
    def test_generic_web(self):
        url = "https://example.com/some/page"
        url_type, info = URLDetector.detect_type(url)
        assert url_type == URLType.GENERIC_WEB
        assert info is None
    
    def test_http_url(self):
        url = "http://example.com"
        url_type, _ = URLDetector.detect_type(url)
        assert url_type == URLType.GENERIC_WEB


class TestURLDetectorExtractWithTypes:
    """Tests for extracting URLs with their types."""
    
    def test_extract_mixed_urls(self):
        text = """
        Check the repo at https://github.com/owner/repo
        and the docs at https://docs.python.org/3/
        """
        results = URLDetector.extract_urls_with_types(text)
        assert len(results) == 2
        
        types = {r[1] for r in results}
        assert URLType.GITHUB_REPO in types
        assert URLType.DOCUMENTATION in types
    
    def test_deduplicate_urls(self):
        text = "Visit https://example.com twice: https://example.com"
        results = URLDetector.extract_urls_with_types(text)
        assert len(results) == 1
