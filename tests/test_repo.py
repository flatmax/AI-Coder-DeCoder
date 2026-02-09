"""Tests for repository operations."""

import subprocess
import pytest
from pathlib import Path
from ac_dc.repo import Repo


@pytest.fixture
def git_repo(tmp_path):
    """Create a real git repo for testing."""
    subprocess.run(["git", "init", str(tmp_path)], capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@test.com"],
                   cwd=str(tmp_path), capture_output=True)
    subprocess.run(["git", "config", "user.name", "Test"],
                   cwd=str(tmp_path), capture_output=True)

    # Create some files
    (tmp_path / "README.md").write_text("# Test\n")
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "main.py").write_text("def main():\n    pass\n")
    (tmp_path / "src" / "utils.py").write_text("import os\n\ndef helper():\n    pass\n")

    # Initial commit
    subprocess.run(["git", "add", "-A"], cwd=str(tmp_path), capture_output=True)
    subprocess.run(["git", "commit", "-m", "init"], cwd=str(tmp_path), capture_output=True)

    return tmp_path


class TestFileOperations:

    def test_read_file(self, git_repo):
        repo = Repo(git_repo)
        result = repo.get_file_content("README.md")
        assert result["content"] == "# Test\n"

    def test_read_file_at_head(self, git_repo):
        repo = Repo(git_repo)
        # Modify file
        (git_repo / "README.md").write_text("# Modified\n")
        # HEAD version should be original
        result = repo.get_file_content("README.md", version="HEAD")
        assert result["content"] == "# Test\n"

    def test_write_file(self, git_repo):
        repo = Repo(git_repo)
        result = repo.write_file("src/new.py", "print('hello')")
        assert result.get("ok")
        assert (git_repo / "src" / "new.py").read_text() == "print('hello')"

    def test_create_file_exists_error(self, git_repo):
        repo = Repo(git_repo)
        result = repo.create_file("README.md", "overwrite")
        assert "error" in result

    def test_path_traversal_blocked(self, git_repo):
        repo = Repo(git_repo)
        result = repo.get_file_content("../../../etc/passwd")
        assert "error" in result

    def test_binary_detection(self, git_repo):
        repo = Repo(git_repo)
        (git_repo / "binary.bin").write_bytes(b"\x00\x01\x02\x03")
        assert repo.is_binary_file("binary.bin") is True
        assert repo.is_binary_file("README.md") is False


class TestGitOperations:

    def test_stage_and_diff(self, git_repo):
        repo = Repo(git_repo)
        (git_repo / "README.md").write_text("# Changed\n")
        result = repo.stage_files(["README.md"])
        assert result.get("ok")
        diff = repo.get_staged_diff()
        assert "Changed" in diff["diff"]

    def test_unstage(self, git_repo):
        repo = Repo(git_repo)
        (git_repo / "README.md").write_text("# Changed\n")
        repo.stage_files(["README.md"])
        repo.unstage_files(["README.md"])
        diff = repo.get_staged_diff()
        assert diff["diff"] == ""

    def test_commit(self, git_repo):
        repo = Repo(git_repo)
        (git_repo / "README.md").write_text("# Updated\n")
        repo.stage_files(["README.md"])
        result = repo.commit("test commit")
        assert result.get("ok")

    def test_reset_hard(self, git_repo):
        repo = Repo(git_repo)
        (git_repo / "README.md").write_text("# Changed\n")
        repo.reset_hard()
        assert (git_repo / "README.md").read_text() == "# Test\n"

    def test_rename_file(self, git_repo):
        repo = Repo(git_repo)
        result = repo.rename_file("README.md", "ABOUT.md")
        assert result.get("ok")
        assert not (git_repo / "README.md").exists()
        assert (git_repo / "ABOUT.md").exists()


class TestFileTree:

    def test_basic_tree(self, git_repo):
        repo = Repo(git_repo)
        result = repo.get_file_tree()
        assert "tree" in result
        tree = result["tree"]
        assert tree["type"] == "dir"

    def test_modified_detection(self, git_repo):
        repo = Repo(git_repo)
        (git_repo / "README.md").write_text("# Modified\n")
        result = repo.get_file_tree()
        assert "README.md" in result["modified"]

    def test_untracked_detection(self, git_repo):
        repo = Repo(git_repo)
        (git_repo / "new_file.txt").write_text("new\n")
        result = repo.get_file_tree()
        assert "new_file.txt" in result["untracked"]

    def test_flat_file_list(self, git_repo):
        repo = Repo(git_repo)
        flat = repo.get_flat_file_list()
        assert "README.md" in flat
        assert "src/main.py" in flat


class TestSearch:

    def test_basic_search(self, git_repo):
        repo = Repo(git_repo)
        results = repo.search_files("def main")
        assert len(results) > 0
        assert results[0]["file"] == "src/main.py"

    def test_case_insensitive(self, git_repo):
        repo = Repo(git_repo)
        results = repo.search_files("DEF MAIN", ignore_case=True)
        assert len(results) > 0

    def test_no_results(self, git_repo):
        repo = Repo(git_repo)
        results = repo.search_files("xyznonexistent")
        assert len(results) == 0
