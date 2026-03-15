"""Shared test fixtures."""

import os
import subprocess
from pathlib import Path

import pytest


@pytest.fixture
def tmp_git_repo(tmp_path):
    """Create a temporary git repository with an initial commit."""
    repo = tmp_path / "test_repo"
    repo.mkdir()

    # Init git repo
    subprocess.run(["git", "init", str(repo)], capture_output=True, check=True)
    subprocess.run(
        ["git", "-C", str(repo), "config", "user.email", "test@test.com"],
        capture_output=True, check=True,
    )
    subprocess.run(
        ["git", "-C", str(repo), "config", "user.name", "Test"],
        capture_output=True, check=True,
    )

    # Create initial file and commit
    readme = repo / "README.md"
    readme.write_text("# Test Repo\n")
    subprocess.run(
        ["git", "-C", str(repo), "add", "."],
        capture_output=True, check=True,
    )
    subprocess.run(
        ["git", "-C", str(repo), "commit", "-m", "Initial commit"],
        capture_output=True, check=True,
    )

    return repo


@pytest.fixture
def tmp_repo_with_files(tmp_git_repo):
    """Git repo with multiple files for richer testing."""
    repo = tmp_git_repo

    # Create files
    (repo / "src").mkdir()
    (repo / "src" / "main.py").write_text('def main():\n    print("hello")\n')
    (repo / "src" / "utils.py").write_text('def helper():\n    return 42\n')
    (repo / "tests").mkdir()
    (repo / "tests" / "test_main.py").write_text('def test_main():\n    pass\n')
    (repo / ".gitignore").write_text("__pycache__/\n*.pyc\n")

    subprocess.run(
        ["git", "-C", str(repo), "add", "."],
        capture_output=True, check=True,
    )
    subprocess.run(
        ["git", "-C", str(repo), "commit", "-m", "Add source files"],
        capture_output=True, check=True,
    )

    return repo