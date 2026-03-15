"""Tests for Repo operations."""

import subprocess
from pathlib import Path

import pytest

from ac_dc.repo import Repo


@pytest.fixture
def repo(tmp_git_repo):
    return Repo(tmp_git_repo)


@pytest.fixture
def repo_with_files(tmp_repo_with_files):
    return Repo(tmp_repo_with_files)


class TestFileIO:
    def test_read_file(self, repo_with_files):
        content = repo_with_files.get_file_content("src/main.py")
        assert "def main" in content

    def test_read_file_at_head(self, repo_with_files):
        content = repo_with_files.get_file_content("README.md", "HEAD")
        assert "# Test Repo" in content

    def test_write_file(self, repo):
        result = repo.write_file("new_file.txt", "hello")
        assert result["status"] == "written"
        content = repo.get_file_content("new_file.txt")
        assert content == "hello"

    def test_write_creates_directories(self, repo):
        result = repo.write_file("deep/nested/dir/file.txt", "content")
        assert result["status"] == "written"

    def test_create_file(self, repo):
        result = repo.create_file("created.txt", "created content")
        assert result["status"] == "created"

    def test_create_file_exists_error(self, repo):
        result = repo.create_file("README.md", "overwrite")
        assert "error" in result

    def test_file_exists(self, repo_with_files):
        assert repo_with_files.file_exists("src/main.py")
        assert not repo_with_files.file_exists("nonexistent.py")

    def test_path_traversal_blocked(self, repo):
        content = repo.get_file_content("../../../etc/passwd")
        assert isinstance(content, dict)
        assert "error" in content

    def test_path_traversal_blocked_write(self, repo):
        result = repo.write_file("../escape.txt", "hack")
        assert "error" in result


class TestBinaryDetection:
    def test_binary_file(self, repo):
        # Write binary content
        path = repo._resolve_path("binary.bin")
        path.write_bytes(b"\x00\x01\x02\xff")
        assert repo.is_binary_file("binary.bin")

    def test_text_file_not_binary(self, repo_with_files):
        assert not repo_with_files.is_binary_file("src/main.py")


class TestGitStaging:
    def test_stage_and_diff(self, repo):
        repo.write_file("new.py", "print('hello')")
        repo.stage_files(["new.py"])
        diff = repo.get_staged_diff()
        assert "hello" in diff

    def test_unstage(self, repo):
        repo.write_file("new.py", "content")
        repo.stage_files(["new.py"])
        repo.unstage_files(["new.py"])
        diff = repo.get_staged_diff()
        assert "content" not in diff

    def test_discard_tracked(self, repo_with_files):
        repo_with_files.write_file("src/main.py", "modified content")
        repo_with_files.discard_changes(["src/main.py"])
        content = repo_with_files.get_file_content("src/main.py")
        assert "modified content" not in content


class TestCommit:
    def test_commit(self, repo):
        repo.write_file("new.txt", "content")
        repo.stage_files(["new.txt"])
        result = repo.commit("test commit")
        assert "sha" in result
        assert result["message"] == "test commit"

    def test_reset_hard(self, repo_with_files):
        original = repo_with_files.get_file_content("src/main.py")
        repo_with_files.write_file("src/main.py", "modified")
        repo_with_files.stage_files(["src/main.py"])
        repo_with_files.reset_hard()
        restored = repo_with_files.get_file_content("src/main.py")
        assert restored == original


class TestRename:
    def test_rename_tracked_file(self, repo_with_files):
        result = repo_with_files.rename_file("src/utils.py", "src/helpers.py")
        assert result["status"] == "renamed"
        assert repo_with_files.file_exists("src/helpers.py")
        assert not repo_with_files.file_exists("src/utils.py")


class TestFileTree:
    def test_tree_structure(self, repo_with_files):
        tree_data = repo_with_files.get_file_tree()
        tree = tree_data["tree"]
        assert tree["type"] == "dir"
        assert tree["name"] == repo_with_files.root.name

        # Should have children
        child_names = [c["name"] for c in tree["children"]]
        assert "src" in child_names
        assert "README.md" in child_names

    def test_tree_includes_status_arrays(self, repo_with_files):
        # Make a modification
        repo_with_files.write_file("src/main.py", "modified")
        tree_data = repo_with_files.get_file_tree()
        assert "modified" in tree_data
        assert "staged" in tree_data
        assert "untracked" in tree_data
        assert "deleted" in tree_data

    def test_tree_untracked_files(self, repo_with_files):
        repo_with_files.write_file("new_untracked.txt", "content")
        tree_data = repo_with_files.get_file_tree()
        assert "new_untracked.txt" in tree_data["untracked"]


class TestFlatFileList:
    def test_flat_list(self, repo_with_files):
        file_list = repo_with_files.get_flat_file_list()
        assert "src/main.py" in file_list
        assert "README.md" in file_list


class TestSearch:
    def test_search_finds_content(self, repo_with_files):
        results = repo_with_files.search_files("def main")
        assert len(results) > 0
        assert any(r["file"] == "src/main.py" for r in results)

    def test_search_case_insensitive(self, repo_with_files):
        results = repo_with_files.search_files("DEF MAIN", ignore_case=True)
        assert len(results) > 0

    def test_search_no_results(self, repo_with_files):
        results = repo_with_files.search_files("zzz_nonexistent_zzz")
        assert results == []


class TestBranch:
    def test_get_current_branch(self, repo):
        info = repo.get_current_branch()
        assert "branch" in info
        assert "sha" in info
        assert info["detached"] is False

    def test_list_branches(self, repo):
        branches = repo.list_branches()
        assert "branches" in branches
        assert "current" in branches

    def test_is_clean(self, repo):
        assert repo.is_clean()
        repo.write_file("dirty.txt", "content")
        repo.stage_files(["dirty.txt"])
        assert not repo.is_clean()

    def test_resolve_ref(self, repo):
        sha = repo.resolve_ref("HEAD")
        assert sha is not None
        assert len(sha) == 40


class TestCommitGraph:
    def test_commit_graph(self, repo_with_files):
        graph = repo_with_files.get_commit_graph(limit=10)
        assert "commits" in graph
        assert "branches" in graph
        assert "has_more" in graph
        assert len(graph["commits"]) > 0
        # Each commit should have parents field
        for c in graph["commits"]:
            assert "parents" in c

    def test_commit_parent(self, repo_with_files):
        head_sha = repo_with_files.resolve_ref("HEAD")
        parent = repo_with_files.get_commit_parent(head_sha)
        assert "sha" in parent
        assert len(parent["sha"]) == 40