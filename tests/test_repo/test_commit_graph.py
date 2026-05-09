"""Commit graph, log, parent, and merge-base helpers."""

from __future__ import annotations

from pathlib import Path

from ac_dc.repo import Repo

from .conftest import _run_git


class TestCommitGraph:
    """get_commit_graph, get_commit_log, get_commit_parent, get_merge_base."""

    @staticmethod
    def _seed_linear_history(repo: Repo, count: int = 3) -> list[str]:
        """Create ``count`` linear commits on main.

        Returns the SHAs in creation order (oldest first).
        """
        shas: list[str] = []
        for i in range(count):
            path = repo.root / f"f{i}.md"
            path.write_text(f"content {i}\n", encoding="utf-8")
            _run_git(repo.root, "add", f"f{i}.md")
            _run_git(repo.root, "commit", "-q", "-m", f"commit {i}")
            sha = _run_git(
                repo.root, "rev-parse", "HEAD"
            ).stdout.strip()
            shas.append(sha)
        return shas

    def test_get_commit_graph_returns_expected_shape(self, repo: Repo) -> None:
        """Result has commits, branches, and has_more keys."""
        self._seed_linear_history(repo, count=3)
        result = repo.get_commit_graph()
        assert set(result.keys()) == {"commits", "branches", "has_more"}
        assert isinstance(result["commits"], list)
        assert isinstance(result["branches"], list)
        assert isinstance(result["has_more"], bool)

    def test_get_commit_graph_commit_entries_have_all_fields(
        self, repo: Repo
    ) -> None:
        """Each commit entry has every documented field."""
        self._seed_linear_history(repo, count=3)
        result = repo.get_commit_graph()
        entry = result["commits"][0]
        assert set(entry.keys()) == {
            "sha",
            "short_sha",
            "message",
            "author",
            "date",
            "relative_date",
            "parents",
        }
        assert len(entry["sha"]) == 40
        assert len(entry["short_sha"]) >= 7
        assert isinstance(entry["parents"], list)
        # ISO 8601 contains 'T' between date and time.
        assert "T" in entry["date"]

    def test_get_commit_graph_orders_newest_first(self, repo: Repo) -> None:
        """Commits come back with the most recent first.

        Reverse of the seed order — seed returns oldest-first
        because that's the creation order; the graph returns
        newest-first because that's what users want to see.
        """
        shas = self._seed_linear_history(repo, count=3)
        result = repo.get_commit_graph()
        result_shas = [c["sha"] for c in result["commits"]]
        assert result_shas == list(reversed(shas))

    def test_get_commit_graph_captures_parent_shas(self, repo: Repo) -> None:
        """Each commit's parents list matches git's actual parentage.

        Linear history: each commit has exactly one parent (the
        previous one). The root has zero parents.
        """
        shas = self._seed_linear_history(repo, count=3)
        result = repo.get_commit_graph()
        # commits[0] is the tip (shas[2]); its parent is shas[1].
        # commits[1] is shas[1]; its parent is shas[0].
        # commits[2] is shas[0]; no parent (root commit).
        assert result["commits"][0]["parents"] == [shas[1]]
        assert result["commits"][1]["parents"] == [shas[0]]
        assert result["commits"][2]["parents"] == []

    def test_get_commit_graph_captures_merge_parent(self, repo: Repo) -> None:
        """A merge commit has two parents; both appear in the list."""
        self._seed_linear_history(repo, count=1)
        # Branch off, add a commit, merge back.
        _run_git(repo.root, "checkout", "-q", "-b", "feature")
        (repo.root / "feature.md").write_text("feat", encoding="utf-8")
        _run_git(repo.root, "add", "feature.md")
        _run_git(repo.root, "commit", "-q", "-m", "feature work")
        _run_git(repo.root, "checkout", "-q", "main")
        _run_git(
            repo.root, "merge", "--no-ff", "-q", "feature",
            "-m", "merge feature",
        )
        result = repo.get_commit_graph()
        merge_commit = result["commits"][0]
        # Merge has exactly two parents.
        assert len(merge_commit["parents"]) == 2

    def test_get_commit_graph_respects_limit(self, repo: Repo) -> None:
        """limit caps the number of commits returned."""
        self._seed_linear_history(repo, count=5)
        result = repo.get_commit_graph(limit=2)
        assert len(result["commits"]) == 2
        # has_more is True because we fetched fewer than available.
        assert result["has_more"] is True

    def test_get_commit_graph_has_more_false_when_exhausted(
        self, repo: Repo
    ) -> None:
        """has_more is False when limit >= total commits."""
        self._seed_linear_history(repo, count=3)
        result = repo.get_commit_graph(limit=10)
        assert len(result["commits"]) == 3
        assert result["has_more"] is False

    def test_get_commit_graph_respects_offset(self, repo: Repo) -> None:
        """offset skips the first N commits.

        With 5 commits and offset=2, we see the 3 oldest (in
        newest-first order: commits[2], [1], [0] of the seed list).
        """
        shas = self._seed_linear_history(repo, count=5)
        result = repo.get_commit_graph(limit=10, offset=2)
        result_shas = [c["sha"] for c in result["commits"]]
        # Expected: shas[2], shas[1], shas[0] (newest of the skipped-past batch).
        assert result_shas == [shas[2], shas[1], shas[0]]

    def test_get_commit_graph_empty_repo_returns_empty_commits(
        self, repo: Repo
    ) -> None:
        """Repo with no commits returns an empty commits list.

        ``git log`` on an empty repo exits non-zero, but the graph
        method handles that cleanly — has_more is False, commits
        is empty, branches is empty.
        """
        # No _seed_linear_history call — repo is freshly initialised.
        result = repo.get_commit_graph()
        assert result["commits"] == []
        assert result["has_more"] is False

    def test_get_commit_graph_branches_local_only_by_default(
        self, repo: Repo
    ) -> None:
        """Default branches list is local-only (is_remote all False)."""
        self._seed_linear_history(repo, count=1)
        _run_git(repo.root, "checkout", "-q", "-b", "feature")
        _run_git(repo.root, "commit", "-q", "--allow-empty", "-m", "feat")
        _run_git(repo.root, "checkout", "-q", "main")
        result = repo.get_commit_graph()
        names = {b["name"] for b in result["branches"]}
        assert "main" in names
        assert "feature" in names
        # Every entry has is_remote=False because include_remote
        # defaults to False.
        assert all(b["is_remote"] is False for b in result["branches"])

    def test_get_commit_graph_include_remote_adds_remote_branches(
        self, repo: Repo, tmp_path: Path
    ) -> None:
        """include_remote=True adds remote-only branches to the list.

        Sets up a bare remote, pushes a distinct branch, deletes
        the local copy. With include_remote=True the ``origin/*``
        form shows up in the graph's branches list.
        """
        remote_root = tmp_path / "origin.git"
        remote_root.mkdir()
        _run_git(remote_root, "init", "-q", "--bare")

        self._seed_linear_history(repo, count=1)
        _run_git(repo.root, "remote", "add", "origin", str(remote_root))
        _run_git(repo.root, "push", "-q", "-u", "origin", "main")

        # Create a branch, push, delete locally.
        _run_git(repo.root, "checkout", "-q", "-b", "feature")
        _run_git(repo.root, "commit", "-q", "--allow-empty", "-m", "feat")
        _run_git(repo.root, "push", "-q", "-u", "origin", "feature")
        _run_git(repo.root, "checkout", "-q", "main")
        _run_git(repo.root, "branch", "-q", "-D", "feature")

        result = repo.get_commit_graph(include_remote=True)
        names = {b["name"] for b in result["branches"]}
        assert "origin/feature" in names

    def test_get_commit_log_returns_range_exclusive_of_base(
        self, repo: Repo
    ) -> None:
        """base..head returns commits reachable from head but not from base.

        Three commits; log from shas[0] to HEAD yields shas[2] and
        shas[1] (newest first) — exactly what ``git log base..head``
        normally shows.
        """
        shas = self._seed_linear_history(repo, count=3)
        results = repo.get_commit_log(base=shas[0])
        result_shas = [r["sha"] for r in results]
        # Two commits returned — shas[2] newest, then shas[1].
        assert result_shas == [shas[2], shas[1]]

    def test_get_commit_log_explicit_head(self, repo: Repo) -> None:
        """Passing head explicitly overrides the HEAD default."""
        shas = self._seed_linear_history(repo, count=3)
        # base=shas[0], head=shas[1]: only shas[1] is in the range.
        results = repo.get_commit_log(base=shas[0], head=shas[1])
        result_shas = [r["sha"] for r in results]
        assert result_shas == [shas[1]]

    def test_get_commit_log_respects_limit(self, repo: Repo) -> None:
        """limit caps the number of commits returned."""
        shas = self._seed_linear_history(repo, count=5)
        results = repo.get_commit_log(base=shas[0], limit=2)
        assert len(results) == 2

    def test_get_commit_log_entry_shape(self, repo: Repo) -> None:
        """Each entry has the documented keys with correct types."""
        shas = self._seed_linear_history(repo, count=2)
        results = repo.get_commit_log(base=shas[0])
        assert len(results) == 1
        entry = results[0]
        assert set(entry.keys()) == {
            "sha", "short_sha", "message", "author", "date",
        }
        assert len(entry["sha"]) == 40

    def test_get_commit_log_empty_range(self, repo: Repo) -> None:
        """When head is at base, the range is empty.

        This is the "nothing to review" case — user picked a base
        commit at the very tip of the branch.
        """
        shas = self._seed_linear_history(repo, count=2)
        # base=HEAD means no commits reachable beyond it.
        results = repo.get_commit_log(base=shas[1], head=shas[1])
        assert results == []

    def test_get_commit_parent_returns_parent_sha(self, repo: Repo) -> None:
        """Parent SHA is returned with full and short forms."""
        shas = self._seed_linear_history(repo, count=3)
        result = repo.get_commit_parent(shas[2])
        assert "error" not in result
        assert result["sha"] == shas[1]
        assert len(result["short_sha"]) >= 7
        # short_sha is a prefix of the full sha.
        assert shas[1].startswith(result["short_sha"])

    def test_get_commit_parent_accepts_ref_name(self, repo: Repo) -> None:
        """Parent resolution works for ref names, not just SHAs."""
        shas = self._seed_linear_history(repo, count=2)
        result = repo.get_commit_parent("HEAD")
        # HEAD's parent is shas[0] (the root commit).
        assert result["sha"] == shas[0]

    def test_get_commit_parent_of_root_returns_error(self, repo: Repo) -> None:
        """The root commit has no parent — structured error, not raise."""
        shas = self._seed_linear_history(repo, count=1)
        result = repo.get_commit_parent(shas[0])
        assert "error" in result
        assert "sha" not in result

    def test_get_commit_parent_unknown_ref_returns_error(
        self, repo: Repo
    ) -> None:
        """Unresolvable commit reference returns a structured error."""
        self._seed_linear_history(repo, count=1)
        result = repo.get_commit_parent("no-such-commit")
        assert "error" in result

    def test_get_merge_base_linear_history_returns_older_commit(
        self, repo: Repo
    ) -> None:
        """With two refs on a linear chain, the older commit is the base.

        ``git merge-base A B`` returns the best common ancestor. On
        a linear history where B is an ancestor of A, the answer is
        just B itself. This is the simplest case that exercises the
        explicit two-ref path.
        """
        shas = self._seed_linear_history(repo, count=3)
        # shas[0] is ancestor of shas[2]; merge-base is shas[0].
        result = repo.get_merge_base(shas[2], shas[0])
        assert "error" not in result
        assert result["sha"] == shas[0]
        assert len(result["short_sha"]) >= 7
        assert shas[0].startswith(result["short_sha"])

    def test_get_merge_base_diverged_branches(self, repo: Repo) -> None:
        """Branches that diverged return their common ancestor.

        This is the shape review mode sees: a feature branch forked
        from main, each adds commits independently. merge-base is
        the fork point.
        """
        shas = self._seed_linear_history(repo, count=2)
        fork_sha = shas[1]
        # Branch off at HEAD and add a commit.
        _run_git(repo.root, "checkout", "-q", "-b", "feature")
        (repo.root / "feat.md").write_text("feat", encoding="utf-8")
        _run_git(repo.root, "add", "feat.md")
        _run_git(repo.root, "commit", "-q", "-m", "feat work")
        # Return to main and add a commit there too.
        _run_git(repo.root, "checkout", "-q", "main")
        (repo.root / "main_more.md").write_text("more", encoding="utf-8")
        _run_git(repo.root, "add", "main_more.md")
        _run_git(repo.root, "commit", "-q", "-m", "main work")
        # merge-base of the two tips is the fork point.
        result = repo.get_merge_base("feature", "main")
        assert result["sha"] == fork_sha

    def test_get_merge_base_cascade_finds_main(self, repo: Repo) -> None:
        """With no explicit ref₂, the cascade finds ``main`` first.

        Review mode calls ``get_merge_base(branch_tip)`` and expects
        the method to probe common target-branch names (main, then
        master) until one succeeds.
        """
        shas = self._seed_linear_history(repo, count=2)
        fork_sha = shas[1]
        _run_git(repo.root, "checkout", "-q", "-b", "feature")
        _run_git(repo.root, "commit", "-q", "--allow-empty", "-m", "feat")
        # ref₂ omitted — cascade kicks in, finds main.
        result = repo.get_merge_base("feature")
        assert result["sha"] == fork_sha

    def test_get_merge_base_cascade_falls_through_to_master(
        self, repo: Repo
    ) -> None:
        """When main is absent, the cascade tries master next.

        Some repos still use ``master`` as the default branch. We
        rename the seeded branch from main→master and verify the
        cascade's second candidate succeeds.
        """
        shas = self._seed_linear_history(repo, count=2)
        fork_sha = shas[1]
        # Rename main to master.
        _run_git(repo.root, "branch", "-m", "main", "master")
        _run_git(repo.root, "checkout", "-q", "-b", "feature")
        _run_git(repo.root, "commit", "-q", "--allow-empty", "-m", "feat")
        result = repo.get_merge_base("feature")
        assert result["sha"] == fork_sha

    def test_get_merge_base_cascade_exhausted_returns_error(
        self, repo: Repo
    ) -> None:
        """When no cascade candidate resolves, a structured error is returned.

        Rename ``main`` to something outside the cascade's candidate
        list (``main`` → ``development``). With no ``main`` and no
        ``master`` present, cascade has nothing to match against.
        """
        shas = self._seed_linear_history(repo, count=1)
        _run_git(repo.root, "branch", "-m", "main", "development")
        result = repo.get_merge_base(shas[0])
        assert "error" in result
        assert "sha" not in result

    def test_get_merge_base_unrelated_histories_returns_error(
        self, repo: Repo
    ) -> None:
        """Two histories that share no ancestor return a structured error.

        Two orphan branches created with ``--orphan`` share no
        history whatsoever — no common ancestor exists for git
        merge-base to return. Our explicit two-ref path surfaces
        this as ``{"error": ...}`` rather than raising.
        """
        # One commit on main.
        self._seed_linear_history(repo, count=1)
        # Orphan branch with no shared history.
        _run_git(repo.root, "checkout", "-q", "--orphan", "detached")
        _run_git(repo.root, "rm", "-rf", "--cached", ".")
        # Orphan leaves previous working-tree files in place — clear
        # them so the orphan commit has a clean slate.
        for leftover in ("f0.md",):
            (repo.root / leftover).unlink(missing_ok=True)
        (repo.root / "detached.md").write_text("orphan", encoding="utf-8")
        _run_git(repo.root, "add", "detached.md")
        _run_git(repo.root, "commit", "-q", "-m", "orphan root")
        # Explicit two-ref call — no cascade. main and detached
        # share no history, so merge-base returns nothing.
        result = repo.get_merge_base("detached", "main")
        assert "error" in result
        assert "sha" not in result