"""Diff queries and commit/reset/search helpers."""

from __future__ import annotations

import pytest

from ac_dc.repo import Repo, RepoError

from .conftest import _run_git


class TestDiffs:
    """get_staged_diff, get_unstaged_diff, get_diff_to_branch."""

    def test_get_staged_diff_empty_when_nothing_staged(self, repo: Repo) -> None:
        """Clean working tree produces empty staged diff."""
        assert repo.get_staged_diff() == ""

    def test_get_staged_diff_shows_staged_changes(self, repo: Repo) -> None:
        """Staged additions appear in the diff output."""
        (repo.root / "a.md").write_text("hello\nworld\n", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        diff = repo.get_staged_diff()
        # The diff header mentions the path and the content lines
        # appear as additions.
        assert "a.md" in diff
        assert "+hello" in diff
        assert "+world" in diff

    def test_get_unstaged_diff_empty_when_clean(self, repo: Repo) -> None:
        """Clean working tree produces empty unstaged diff."""
        assert repo.get_unstaged_diff() == ""

    def test_get_unstaged_diff_shows_working_tree_changes(
        self, repo: Repo
    ) -> None:
        """Modifications to tracked files appear in the unstaged diff."""
        (repo.root / "a.md").write_text("v1\n", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        (repo.root / "a.md").write_text("v2\n", encoding="utf-8")
        diff = repo.get_unstaged_diff()
        assert "a.md" in diff
        assert "-v1" in diff
        assert "+v2" in diff

    def test_get_unstaged_diff_excludes_staged_changes(
        self, repo: Repo
    ) -> None:
        """Staged-only changes don't appear in the unstaged diff."""
        (repo.root / "a.md").write_text("hello\n", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        # Nothing in the working tree beyond the staged addition —
        # the staged diff shows it, the unstaged one does not.
        assert "+hello" in repo.get_staged_diff()
        assert repo.get_unstaged_diff() == ""

    def test_get_diff_to_branch_returns_diff_for_existing_branch(
        self, repo: Repo
    ) -> None:
        """Diff vs an existing branch returns patch text under 'diff'."""
        # Initial commit on main.
        (repo.root / "a.md").write_text("v1\n", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        # Create a feature branch with a divergent commit.
        _run_git(repo.root, "checkout", "-q", "-b", "feature")
        (repo.root / "a.md").write_text("v2\n", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "v2")
        # Back to main and compare vs feature.
        _run_git(repo.root, "checkout", "-q", "main")
        result = repo.get_diff_to_branch("feature")
        assert "diff" in result
        assert "error" not in result
        assert "a.md" in result["diff"]

    def test_get_diff_to_branch_includes_working_tree_changes(
        self, repo: Repo
    ) -> None:
        """Two-dot diff covers working-tree changes, not just committed.

        specs4/1-foundation/repository.md documents this explicitly —
        ``git diff <branch>`` shows the branch tip vs the working
        tree, so uncommitted edits on the current side appear.
        """
        (repo.root / "a.md").write_text("v1\n", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        _run_git(repo.root, "checkout", "-q", "-b", "feature")
        _run_git(repo.root, "checkout", "-q", "main")
        # Uncommitted working-tree change on main.
        (repo.root / "a.md").write_text("wip\n", encoding="utf-8")
        result = repo.get_diff_to_branch("feature")
        # The working-tree edit shows as a difference.
        assert "wip" in result["diff"]

    def test_get_diff_to_branch_rejects_empty_name(self, repo: Repo) -> None:
        """Empty branch name produces a structured error, not a raise."""
        result = repo.get_diff_to_branch("")
        assert "error" in result
        assert "diff" not in result

    def test_get_diff_to_branch_whitespace_rejected(self, repo: Repo) -> None:
        """Whitespace-only branch names are also rejected."""
        result = repo.get_diff_to_branch("   ")
        assert "error" in result

    def test_get_diff_to_branch_unknown_ref_returns_error(
        self, repo: Repo
    ) -> None:
        """An unresolvable ref returns a structured error naming it.

        The method does its own rev-parse probe so users see a
        clear "unknown ref" rather than git's raw "bad revision"
        message from the diff call.
        """
        # Need at least one commit so rev-parse doesn't fail for a
        # different reason.
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        result = repo.get_diff_to_branch("definitely-not-a-branch")
        assert "error" in result
        assert "definitely-not-a-branch" in result["error"]


class TestCommit:
    """commit, stage_all, reset_hard, search_commits."""

    def test_commit_creates_commit_and_returns_sha(self, repo: Repo) -> None:
        """commit stages and creates a commit; returns full SHA and message."""
        (repo.root / "a.md").write_text("hello", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        result = repo.commit("init: add a.md")
        assert set(result.keys()) == {"sha", "message"}
        # SHA-1 is 40 hex characters.
        assert len(result["sha"]) == 40
        assert all(c in "0123456789abcdef" for c in result["sha"])
        assert result["message"] == "init: add a.md"

    def test_commit_uses_stdin_for_multiline_message(self, repo: Repo) -> None:
        """Multi-line messages with special characters round-trip correctly.

        ``git commit -F -`` reads from stdin — safer than ``-m`` for
        messages containing newlines, quotes, or conventional-commit
        bodies.
        """
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        message = (
            'feat(x): add "quoted" thing\n'
            "\n"
            "This body spans multiple lines\n"
            "and has $special chars."
        )
        result = repo.commit(message)
        # Verify git stored the message verbatim.
        stored = _run_git(
            repo.root, "log", "-1", "--format=%B"
        ).stdout.rstrip("\n")
        assert stored == message
        assert result["message"] == message

    def test_commit_rejects_empty_message(self, repo: Repo) -> None:
        """Empty commit messages are rejected before invoking git."""
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        with pytest.raises(RepoError, match="must not be empty"):
            repo.commit("")

    def test_commit_rejects_whitespace_message(self, repo: Repo) -> None:
        """Whitespace-only messages count as empty."""
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        with pytest.raises(RepoError, match="must not be empty"):
            repo.commit("   \n  ")

    def test_commit_with_nothing_staged_raises(self, repo: Repo) -> None:
        """Commit with an empty index fails — check=True surfaces it."""
        with pytest.raises(RepoError):
            repo.commit("noop")

    def test_commit_handles_initial_commit(self, repo: Repo) -> None:
        """First commit on a fresh repo works (no parent).

        The fresh-repo fixture has no HEAD; this exercises the
        initial-commit path where git has to create the history from
        scratch.
        """
        (repo.root / "readme.md").write_text("# hello", encoding="utf-8")
        _run_git(repo.root, "add", "readme.md")
        result = repo.commit("initial commit")
        # Verify: log should now show exactly one commit.
        log = _run_git(repo.root, "log", "--oneline").stdout.splitlines()
        assert len(log) == 1
        assert result["sha"] != ""

    def test_reset_hard_discards_staged_and_unstaged(self, repo: Repo) -> None:
        """reset_hard wipes both staged and unstaged changes.

        Sets up a committed file, makes one staged modification and
        one unstaged modification, then verifies both revert after
        reset_hard.
        """
        (repo.root / "a.md").write_text("original\n", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        # Staged modification.
        (repo.root / "a.md").write_text("staged\n", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        # Further unstaged modification on top.
        (repo.root / "a.md").write_text("unstaged\n", encoding="utf-8")
        result = repo.reset_hard()
        assert result == {"status": "ok"}
        # File is back to committed state.
        assert (repo.root / "a.md").read_text(encoding="utf-8") == "original\n"
        # Working tree is clean.
        status = _run_git(repo.root, "status", "--porcelain").stdout
        assert status.strip() == ""

    def test_reset_hard_leaves_untracked_alone(self, repo: Repo) -> None:
        """Untracked files survive reset --hard — matches git's semantics.

        Users rely on this to keep editor scratch files during a
        reset. We verify that ``reset_hard`` doesn't add ``-x`` or
        otherwise clean up untracked content.
        """
        (repo.root / "tracked.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "tracked.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        (repo.root / "scratch.md").write_text("draft", encoding="utf-8")
        repo.reset_hard()
        assert (repo.root / "scratch.md").is_file()
        assert (repo.root / "scratch.md").read_text(encoding="utf-8") == "draft"

    @staticmethod
    def _seed_search_history(repo: Repo) -> list[str]:
        """Create three commits with distinct messages and authors.

        Returns the list of full SHAs in creation order. Callers
        assert against that order. Uses per-commit identity
        overrides so tests don't depend on a fixture-wide author.
        """
        shas: list[str] = []
        entries = [
            ("a.md", "feat: add login form", "Alice", "alice@example.com"),
            ("b.md", "fix: handle empty password", "Bob", "bob@example.com"),
            ("c.md", "docs: note the login flow", "Alice", "alice@example.com"),
        ]
        for i, (filename, message, author_name, author_email) in enumerate(
            entries
        ):
            (repo.root / filename).write_text(
                f"content {i}", encoding="utf-8"
            )
            _run_git(repo.root, "add", filename)
            _run_git(
                repo.root,
                "-c", f"user.name={author_name}",
                "-c", f"user.email={author_email}",
                "commit", "-q", "-m", message,
            )
            sha = _run_git(
                repo.root, "rev-parse", "HEAD"
            ).stdout.strip()
            shas.append(sha)
        return shas

    def test_search_commits_by_message_substring(self, repo: Repo) -> None:
        """Substring match in the commit message hits."""
        self._seed_search_history(repo)
        results = repo.search_commits("login")
        # "login" appears in the feat (a.md) and docs (c.md) commits.
        messages = [r["message"] for r in results]
        assert any("login form" in m for m in messages)
        assert any("login flow" in m for m in messages)
        # The fix commit does not mention login.
        assert not any("handle empty password" in m for m in messages)

    def test_search_commits_is_case_insensitive(self, repo: Repo) -> None:
        """Case-insensitive search — "LOGIN" matches "login"."""
        self._seed_search_history(repo)
        results = repo.search_commits("LOGIN")
        assert len(results) == 2

    def test_search_commits_by_author(self, repo: Repo) -> None:
        """Author name match — --author is OR'd with --grep."""
        self._seed_search_history(repo)
        results = repo.search_commits("Bob")
        # Only Bob's fix commit.
        assert len(results) == 1
        assert "fix" in results[0]["message"]

    def test_search_commits_empty_query_returns_empty(
        self, repo: Repo
    ) -> None:
        """Empty or whitespace-only query returns [] without invoking git."""
        self._seed_search_history(repo)
        assert repo.search_commits("") == []
        assert repo.search_commits("   ") == []

    def test_search_commits_no_matches_returns_empty(self, repo: Repo) -> None:
        """Query with no hits returns an empty list, not an error."""
        self._seed_search_history(repo)
        assert repo.search_commits("zzz-never-appears-in-any-commit") == []

    def test_search_commits_sha_prefix_fast_path(self, repo: Repo) -> None:
        """A query that resolves as a commit SHA returns only that commit.

        The fast-path branch avoids grepping when the query is
        unambiguously a commit — a 7-char SHA prefix like "abc1234"
        that happens to appear in some commit message would
        otherwise produce noisy hits.
        """
        shas = self._seed_search_history(repo)
        short = shas[1][:7]  # prefix of the fix commit
        results = repo.search_commits(short)
        assert len(results) == 1
        assert results[0]["sha"] == shas[1]

    def test_search_commits_result_shape(self, repo: Repo) -> None:
        """Each entry has the documented keys with correct types."""
        self._seed_search_history(repo)
        results = repo.search_commits("login")
        assert len(results) > 0
        entry = results[0]
        assert set(entry.keys()) == {
            "sha", "short_sha", "message", "author", "date",
        }
        assert len(entry["sha"]) == 40
        assert len(entry["short_sha"]) >= 7
        # ISO 8601 date contains 'T' between date and time.
        assert "T" in entry["date"]

    def test_search_commits_respects_limit(self, repo: Repo) -> None:
        """limit caps the number of matches."""
        self._seed_search_history(repo)
        # "login" matches 2 commits; limit=1 truncates.
        results = repo.search_commits("login", limit=1)
        assert len(results) == 1

    def test_search_commits_branch_filter(self, repo: Repo) -> None:
        """branch parameter restricts the search to that branch.

        ``--orphan`` creates a new branch with an empty index but
        leaves the old working-tree files in place. After committing
        the one orphan file, we delete the leftover main-branch
        files from the working tree so the checkout back to main
        can restore them without "would be overwritten" errors.
        """
        self._seed_search_history(repo)
        # Create an orphan branch with a unique commit message.
        _run_git(repo.root, "checkout", "-q", "--orphan", "side")
        _run_git(repo.root, "rm", "-rf", "--cached", ".")
        # Remove the untracked files main left behind before
        # switching back, otherwise checkout refuses the switch.
        for leftover in ("a.md", "b.md", "c.md"):
            (repo.root / leftover).unlink(missing_ok=True)
        (repo.root / "side.md").write_text("side", encoding="utf-8")
        _run_git(repo.root, "add", "side.md")
        _run_git(repo.root, "commit", "-q", "-m", "side: unique marker xyzzy")
        _run_git(repo.root, "checkout", "-q", "main")
        # Without branch, finds xyzzy.
        assert len(repo.search_commits("xyzzy")) >= 1
        # With branch=main, does not.
        assert repo.search_commits("xyzzy", branch="main") == []