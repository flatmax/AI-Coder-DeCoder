"""Tests for repository operations."""

import subprocess
import tempfile
from pathlib import Path

import pytest

from ac_dc.repo import Repo


@pytest.fixture
def git_repo(tmp_path):
    """Create a temporary git repo with initial commit."""
    repo_dir = tmp_path / "test_repo"
    repo_dir.mkdir()
    subprocess.run(["git", "init", str(repo_dir)], capture_output=True)
    subprocess.run(["git", "-C", str(repo_dir), "config", "user.email", "test@test.com"], capture_output=True)
    subprocess.run(["git", "-C", str(repo_dir), "config", "user.name", "Test"], capture_output=True)

    # Create initial files
    (repo_dir / "README.md").write_text("# Test\n")
    (repo_dir / "src").mkdir()
    (repo_dir / "src" / "main.py").write_text("def main():\n    print('hello')\n")
    (repo_dir / "src" / "utils.py").write_text("def helper():\n    pass\n")

    subprocess.run(["git", "-C", str(repo_dir), "add", "-A"], capture_output=True)
    subprocess.run(["git", "-C", str(repo_dir), "commit", "-m", "initial"], capture_output=True)

    return repo_dir


@pytest.fixture
def repo(git_repo):
    return Repo(git_repo)


class TestFileOperations:
    def test_read_file(self, repo):
        result = repo.get_file_content("README.md")
        assert "content" in result
        assert "# Test" in result["content"]

    def test_read_at_head(self, repo, git_repo):
        (git_repo / "README.md").write_text("# Modified\n")
        result = repo.get_file_content("README.md", version="HEAD")
        assert "# Test" in result["content"]

    def test_write_file(self, repo, git_repo):
        repo.write_file("new.txt", "hello")
        assert (git_repo / "new.txt").read_text() == "hello"

    def test_create_file_exists_error(self, repo):
        result = repo.create_file("README.md", "duplicate")
        assert "error" in result

    def test_path_traversal_blocked(self, repo):
        result = repo.get_file_content("../../../etc/passwd")
        assert "error" in result

    def test_binary_detection(self, repo, git_repo):
        (git_repo / "data.bin").write_bytes(b"text\x00binary")
        assert repo.is_binary_file("data.bin") is True
        assert repo.is_binary_file("README.md") is False


class TestGitStaging:
    def test_stage_and_diff(self, repo, git_repo):
        (git_repo / "README.md").write_text("# Modified\n")
        repo.stage_files(["README.md"])
        result = repo.get_staged_diff()
        assert "Modified" in result["diff"]

    def test_unstage(self, repo, git_repo):
        (git_repo / "README.md").write_text("# Modified\n")
        repo.stage_files(["README.md"])
        repo.unstage_files(["README.md"])
        result = repo.get_staged_diff()
        assert result["diff"] == ""

    def test_commit(self, repo, git_repo):
        (git_repo / "README.md").write_text("# Modified\n")
        repo.stage_files(["README.md"])
        result = repo.commit("test commit")
        assert "success" in result

    def test_reset_hard(self, repo, git_repo):
        original = (git_repo / "README.md").read_text()
        (git_repo / "README.md").write_text("# Changed\n")
        repo.reset_hard()
        assert (git_repo / "README.md").read_text() == original


class TestRename:
    def test_rename_tracked_file(self, repo, git_repo):
        result = repo.rename_file("README.md", "README.txt")
        assert result.get("success") is True
        assert (git_repo / "README.txt").exists()
        assert not (git_repo / "README.md").exists()


class TestFileTree:
    def test_tree_structure(self, repo):
        result = repo.get_file_tree()
        assert "tree" in result
        assert result["tree"]["type"] == "dir"
        assert len(result["tree"]["children"]) > 0

    def test_tree_includes_status_arrays(self, repo, git_repo):
        (git_repo / "untracked.txt").write_text("new file")
        result = repo.get_file_tree()
        assert "untracked" in result
        assert "untracked.txt" in result["untracked"]

    def test_flat_file_list(self, repo):
        files = repo.get_flat_file_list()
        assert "README.md" in files
        assert "src/main.py" in files


class TestSearch:
    def test_search_finds_content(self, repo):
        results = repo.search_files("hello")
        assert len(results) > 0
        assert any("main.py" in r["file"] for r in results)

    def test_case_insensitive_search(self, repo):
        results = repo.search_files("HELLO", ignore_case=True)
        assert len(results) > 0

    def test_no_results_returns_empty(self, repo):
        results = repo.search_files("nonexistent_string_xyz")
        assert len(results) == 0
