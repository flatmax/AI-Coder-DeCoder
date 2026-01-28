"""Tests for GitHub handler."""

import pytest
from unittest.mock import patch, MagicMock
from pathlib import Path
import tempfile
import os

from ac.url_handler.github_handler import GitHubHandler
from ac.url_handler.models import GitHubInfo, URLType


class TestGitHubHandlerInit:
    """Tests for GitHubHandler initialization."""
    
    def test_init_default(self):
        handler = GitHubHandler()
        assert handler.cache_path is None
    
    def test_init_with_cache_path(self, tmp_path):
        handler = GitHubHandler(cache_path=tmp_path)
        assert handler.cache_path == tmp_path


class TestGitHubHandlerFindReadme:
    """Tests for README finding."""
    
    def test_find_readme_md(self, tmp_path):
        handler = GitHubHandler()
        readme_path = tmp_path / "README.md"
        readme_path.write_text("# Test README")
        
        result = handler._find_readme(str(tmp_path))
        assert result == "# Test README"
    
    def test_find_readme_rst(self, tmp_path):
        handler = GitHubHandler()
        readme_path = tmp_path / "README.rst"
        readme_path.write_text("Test RST")
        
        result = handler._find_readme(str(tmp_path))
        assert result == "Test RST"
    
    def test_find_readme_priority(self, tmp_path):
        """README.md should be preferred over README.rst"""
        handler = GitHubHandler()
        (tmp_path / "README.md").write_text("Markdown")
        (tmp_path / "README.rst").write_text("RST")
        
        result = handler._find_readme(str(tmp_path))
        assert result == "Markdown"
    
    def test_find_readme_none(self, tmp_path):
        handler = GitHubHandler()
        result = handler._find_readme(str(tmp_path))
        assert result is None


class TestGitHubHandlerFindFiles:
    """Tests for finding supported files."""
    
    def test_find_python_files(self, tmp_path):
        handler = GitHubHandler()
        (tmp_path / "main.py").write_text("# python")
        (tmp_path / "src").mkdir()
        (tmp_path / "src" / "lib.py").write_text("# lib")
        
        files = handler._find_supported_files(str(tmp_path))
        assert "main.py" in files
        assert "src/lib.py" in files
    
    def test_find_js_files(self, tmp_path):
        handler = GitHubHandler()
        (tmp_path / "index.js").write_text("// js")
        (tmp_path / "app.ts").write_text("// ts")
        
        files = handler._find_supported_files(str(tmp_path))
        assert "index.js" in files
        assert "app.ts" in files
    
    def test_skip_hidden_dirs(self, tmp_path):
        handler = GitHubHandler()
        (tmp_path / ".git").mkdir()
        (tmp_path / ".git" / "config.py").write_text("# git")
        (tmp_path / "main.py").write_text("# main")
        
        files = handler._find_supported_files(str(tmp_path))
        assert "main.py" in files
        assert ".git/config.py" not in files
    
    def test_skip_node_modules(self, tmp_path):
        handler = GitHubHandler()
        (tmp_path / "node_modules").mkdir()
        (tmp_path / "node_modules" / "dep.js").write_text("// dep")
        (tmp_path / "src.js").write_text("// src")
        
        files = handler._find_supported_files(str(tmp_path))
        assert "src.js" in files
        assert "node_modules/dep.js" not in files


class TestGitHubHandlerFetchFile:
    """Tests for single file fetching."""
    
    def test_fetch_file_no_path(self):
        handler = GitHubHandler()
        info = GitHubInfo(owner="owner", repo="repo")
        
        result = handler.fetch_file(info)
        assert result.error == "No file path specified"
    
    @patch('urllib.request.urlopen')
    def test_fetch_file_success(self, mock_urlopen):
        handler = GitHubHandler()
        info = GitHubInfo(
            owner="owner",
            repo="repo",
            branch="main",
            path="README.md"
        )
        
        # Mock response
        mock_response = MagicMock()
        mock_response.read.return_value = b"# Hello"
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_response
        
        result = handler.fetch_file(info)
        assert result.content == "# Hello"
        assert result.title == "README.md"
        assert result.error is None
    
    @patch('urllib.request.urlopen')
    def test_fetch_file_fallback_to_master(self, mock_urlopen):
        """Should try master branch if main fails with 404."""
        import urllib.error
        
        handler = GitHubHandler()
        info = GitHubInfo(
            owner="owner",
            repo="repo",
            branch=None,  # Will default to main
            path="README.md"
        )
        
        # First call fails with 404, second succeeds
        mock_response = MagicMock()
        mock_response.read.return_value = b"# From master"
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)
        
        http_error = urllib.error.HTTPError(
            url="", code=404, msg="Not Found", hdrs={}, fp=None
        )
        mock_urlopen.side_effect = [http_error, mock_response]
        
        result = handler.fetch_file(info)
        assert result.content == "# From master"


class TestGitHubHandlerShallowClone:
    """Tests for shallow clone functionality."""
    
    @patch('subprocess.run')
    def test_shallow_clone_success(self, mock_run):
        handler = GitHubHandler()
        mock_run.return_value = MagicMock(returncode=0)
        
        result = handler._shallow_clone(
            "https://github.com/owner/repo.git",
            "/tmp/dest"
        )
        
        assert result is True
        mock_run.assert_called_once()
        args = mock_run.call_args[0][0]
        assert '--depth' in args
        assert '1' in args
    
    @patch('subprocess.run')
    def test_shallow_clone_failure(self, mock_run):
        handler = GitHubHandler()
        mock_run.return_value = MagicMock(returncode=1)
        
        result = handler._shallow_clone(
            "https://github.com/owner/repo.git",
            "/tmp/dest"
        )
        
        assert result is False
    
    @patch('subprocess.run')
    def test_shallow_clone_timeout(self, mock_run):
        import subprocess
        handler = GitHubHandler()
        mock_run.side_effect = subprocess.TimeoutExpired(cmd="git", timeout=120)
        
        result = handler._shallow_clone(
            "https://github.com/owner/repo.git",
            "/tmp/dest"
        )
        
        assert result is False


class TestGitHubHandlerFetchRepo:
    """Tests for full repo fetching."""
    
    @patch.object(GitHubHandler, '_shallow_clone')
    @patch.object(GitHubHandler, '_find_readme')
    @patch.object(GitHubHandler, '_generate_symbol_map')
    def test_fetch_repo_success(self, mock_symbol_map, mock_readme, mock_clone):
        handler = GitHubHandler()
        mock_clone.return_value = True
        mock_readme.return_value = "# README"
        mock_symbol_map.return_value = "symbol map content"
        
        info = GitHubInfo(owner="owner", repo="repo")
        result = handler.fetch_repo(info)
        
        assert result.error is None
        assert result.readme == "# README"
        assert result.symbol_map == "symbol map content"
        assert result.url_type == URLType.GITHUB_REPO
    
    @patch.object(GitHubHandler, '_shallow_clone')
    def test_fetch_repo_clone_failure(self, mock_clone):
        handler = GitHubHandler()
        mock_clone.return_value = False
        
        info = GitHubInfo(owner="owner", repo="repo")
        result = handler.fetch_repo(info)
        
        assert result.error == "Failed to clone repository"
    
    @patch.object(GitHubHandler, '_shallow_clone')
    @patch.object(GitHubHandler, '_find_readme')
    def test_fetch_repo_skip_symbol_map(self, mock_readme, mock_clone):
        handler = GitHubHandler()
        mock_clone.return_value = True
        mock_readme.return_value = "# README"
        
        info = GitHubInfo(owner="owner", repo="repo")
        result = handler.fetch_repo(info, include_symbol_map=False)
        
        assert result.symbol_map is None
        assert result.readme == "# README"
