"""Branch queries and checkout."""

from __future__ import annotations

from pathlib import Path

from ac_dc.repo import Repo

from .conftest import _run_git


class TestBranches:
    """get_current_branch, resolve_ref, list_branches, list_all_branches,
    is_clean."""

    def test_get_current_branch_on_new_branch_reports_name(
        self, repo: Repo
    ) -> None:
        """Regular branch — ``branch`` is set, ``detached`` is False."""
        # Need at least one commit so HEAD resolves.
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        result = repo.get_current_branch()
        assert result["branch"] == "main"
        assert result["detached"] is False
        assert len(result["sha"]) == 40

    def test_get_current_branch_detached_head(self, repo: Repo) -> None:
        """Detached HEAD returns branch=None and detached=True."""
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        sha = _run_git(repo.root, "rev-parse", "HEAD").stdout.strip()
        # Detach by checking out the SHA directly.
        _run_git(repo.root, "checkout", "-q", sha)
        result = repo.get_current_branch()
        assert result["branch"] is None
        assert result["detached"] is True
        assert result["sha"] == sha

    def test_get_current_branch_empty_repo(self, repo: Repo) -> None:
        """Fresh repo with no commits — HEAD doesn't resolve yet.

        We still return a structured dict rather than raising, so
        callers (e.g., the branch badge in the file picker) can
        render a placeholder on first launch of a brand-new repo.
        The fixture already set init.defaultBranch=main and ran a
        ``checkout -b main``, so symbolic-ref should still see
        HEAD pointing at refs/heads/main even without any commits.
        """
        result = repo.get_current_branch()
        # Branch name comes from symbolic-ref, which works even
        # before the first commit as long as HEAD points at a ref.
        assert result["branch"] == "main"
        assert result["detached"] is False
        # No commits yet — rev-parse HEAD fails, so sha is empty.
        assert result["sha"] == ""

    def test_resolve_ref_branch_name(self, repo: Repo) -> None:
        """Branch names resolve to the full tip SHA."""
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        sha = _run_git(repo.root, "rev-parse", "HEAD").stdout.strip()
        assert repo.resolve_ref("main") == sha

    def test_resolve_ref_short_sha(self, repo: Repo) -> None:
        """Short SHA prefixes resolve to the full SHA."""
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        sha = _run_git(repo.root, "rev-parse", "HEAD").stdout.strip()
        short = sha[:7]
        assert repo.resolve_ref(short) == sha

    def test_resolve_ref_tag(self, repo: Repo) -> None:
        """Tag names resolve to the tagged commit's SHA."""
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        _run_git(repo.root, "tag", "v1.0")
        sha = _run_git(repo.root, "rev-parse", "HEAD").stdout.strip()
        assert repo.resolve_ref("v1.0") == sha

    def test_resolve_ref_unknown_returns_none(self, repo: Repo) -> None:
        """Unresolvable refs return None, not raise.

        Callers use this as a lightweight existence probe — raising
        would force every call site into try/except for a case
        that's expected (user typos).
        """
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        assert repo.resolve_ref("no-such-ref") is None

    def test_resolve_ref_empty_returns_none(self, repo: Repo) -> None:
        """Empty or whitespace-only input returns None without invoking git."""
        assert repo.resolve_ref("") is None
        assert repo.resolve_ref("   ") is None

    def test_list_branches_single_branch(self, repo: Repo) -> None:
        """Freshly-committed repo reports exactly one branch, main, current."""
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        result = repo.list_branches()
        assert result["current"] == "main"
        branches = result["branches"]
        assert len(branches) == 1
        entry = branches[0]
        assert entry["name"] == "main"
        assert entry["is_current"] is True
        assert len(entry["sha"]) == 40
        assert entry["message"] == "init"

    def test_list_branches_multiple_branches(self, repo: Repo) -> None:
        """Multiple branches are listed, current flag is exclusive."""
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        _run_git(repo.root, "checkout", "-q", "-b", "feature")
        (repo.root / "b.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "b.md")
        _run_git(repo.root, "commit", "-q", "-m", "feature work")
        _run_git(repo.root, "checkout", "-q", "main")
        result = repo.list_branches()
        names = {b["name"] for b in result["branches"]}
        assert names == {"main", "feature"}
        assert result["current"] == "main"
        # Exactly one branch is marked current.
        current_flags = [b["is_current"] for b in result["branches"]]
        assert current_flags.count(True) == 1

    def test_list_branches_detached_head(self, repo: Repo) -> None:
        """Detached HEAD — branches still listed, current is None.

        Verifies the ``current`` field is None and no branch entry
        has ``is_current=True`` when HEAD is detached. Matches
        ``get_current_branch`` behaviour.
        """
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        sha = _run_git(repo.root, "rev-parse", "HEAD").stdout.strip()
        _run_git(repo.root, "checkout", "-q", sha)
        result = repo.list_branches()
        assert result["current"] is None
        assert all(b["is_current"] is False for b in result["branches"])
        # Main is still listed — being on a detached HEAD doesn't
        # hide the branches that point at commits we're ancestors of.
        names = {b["name"] for b in result["branches"]}
        assert "main" in names

    def test_list_branches_empty_repo(self, repo: Repo) -> None:
        """Fresh repo with no commits — no branches exist yet."""
        result = repo.list_branches()
        assert result["branches"] == []
        # current is None because symbolic-ref resolves to a ref
        # that has no tip commit — for-each-ref emits nothing.
        assert result["current"] is None

    def test_list_all_branches_local_only(self, repo: Repo) -> None:
        """Without any remotes, list_all_branches returns local branches.

        Verifies the local-only path: no remotes configured, only
        local entries come back. All entries have is_remote=False.
        """
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        _run_git(repo.root, "checkout", "-q", "-b", "feature")
        _run_git(repo.root, "commit", "-q", "--allow-empty", "-m", "feat")
        _run_git(repo.root, "checkout", "-q", "main")
        result = repo.list_all_branches()
        names = {b["name"] for b in result}
        assert names == {"main", "feature"}
        # Every entry is local.
        assert all(b["is_remote"] is False for b in result)
        # Exactly one entry is current.
        assert sum(1 for b in result if b["is_current"]) == 1

    def test_list_all_branches_entry_shape(self, repo: Repo) -> None:
        """Each entry has name, sha, is_current, is_remote keys."""
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        result = repo.list_all_branches()
        assert len(result) >= 1
        entry = result[0]
        assert set(entry.keys()) == {"name", "sha", "is_current", "is_remote"}
        assert isinstance(entry["name"], str)
        assert len(entry["sha"]) == 40
        assert isinstance(entry["is_current"], bool)
        assert isinstance(entry["is_remote"], bool)

    def test_list_all_branches_dedups_remote_tracking_branches(
        self, repo: Repo, tmp_path: Path
    ) -> None:
        """Remote tracking branches that match local branches are dropped.

        Sets up a second repo as a bare remote named ``origin``,
        pushes to it, and fetches back. After fetch,
        ``refs/remotes/origin/main`` tracks the local ``main``; the
        list_all_branches dedup should collapse these into a single
        local entry rather than returning both.
        """
        # Bare repo to act as the remote.
        remote_root = tmp_path / "origin.git"
        remote_root.mkdir()
        _run_git(remote_root, "init", "-q", "--bare")

        # Commit in the working repo then push to the fake remote.
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        _run_git(repo.root, "remote", "add", "origin", str(remote_root))
        _run_git(repo.root, "push", "-q", "-u", "origin", "main")

        # Remote tracking ref now exists.
        refs = _run_git(
            repo.root, "for-each-ref", "refs/remotes/", "--format=%(refname)"
        ).stdout
        assert "refs/remotes/origin/main" in refs

        result = repo.list_all_branches()
        names = [b["name"] for b in result]
        # Exactly one entry named "main"; "origin/main" was deduped out.
        assert names.count("main") == 1
        assert "origin/main" not in names

    def test_list_all_branches_includes_distinct_remote_branches(
        self, repo: Repo, tmp_path: Path
    ) -> None:
        """Remote branches without a local counterpart are included.

        When the remote has a branch that doesn't exist locally, it
        shows up as a remote entry (``is_remote=True``) with its
        fully-qualified ``origin/<name>`` label.
        """
        remote_root = tmp_path / "origin.git"
        remote_root.mkdir()
        _run_git(remote_root, "init", "-q", "--bare")

        # Local main + push.
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        _run_git(repo.root, "remote", "add", "origin", str(remote_root))
        _run_git(repo.root, "push", "-q", "-u", "origin", "main")

        # Create a second local branch, push it, then delete the
        # local copy so only the remote tracking ref remains.
        _run_git(repo.root, "checkout", "-q", "-b", "feature")
        _run_git(repo.root, "commit", "-q", "--allow-empty", "-m", "feat")
        _run_git(repo.root, "push", "-q", "-u", "origin", "feature")
        _run_git(repo.root, "checkout", "-q", "main")
        _run_git(repo.root, "branch", "-q", "-D", "feature")

        result = repo.list_all_branches()
        # "feature" gone locally; "origin/feature" should remain.
        names = {b["name"] for b in result}
        assert "feature" not in names
        assert "origin/feature" in names
        # And the entry for origin/feature is marked remote.
        remote_entry = next(b for b in result if b["name"] == "origin/feature")
        assert remote_entry["is_remote"] is True
        assert remote_entry["is_current"] is False

    def test_list_all_branches_filters_bare_remote_alias(
        self, repo: Repo, tmp_path: Path
    ) -> None:
        """``origin`` (no slash) is a remote alias, not a branch — filtered.

        ``git remote add origin <url>`` followed by a fetch can
        produce ``refs/remotes/origin/HEAD`` pointing at the remote's
        default branch, plus the underlying ``refs/remotes/origin/main``.
        Our filter drops ``origin/HEAD`` (symref) but must never emit
        a bare ``origin`` entry either.
        """
        remote_root = tmp_path / "origin.git"
        remote_root.mkdir()
        _run_git(remote_root, "init", "-q", "--bare")
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        _run_git(repo.root, "remote", "add", "origin", str(remote_root))
        _run_git(repo.root, "push", "-q", "-u", "origin", "main")

        result = repo.list_all_branches()
        names = [b["name"] for b in result]
        # No entry is exactly "origin" — that would be the alias.
        assert "origin" not in names
        # And no entry is "origin/HEAD" — that's a symref, filtered.
        assert "origin/HEAD" not in names

    def test_is_clean_on_clean_working_tree(self, repo: Repo) -> None:
        """Freshly-committed repo with no working-tree changes is clean."""
        (repo.root / "a.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        assert repo.is_clean() is True

    def test_is_clean_false_with_staged_changes(self, repo: Repo) -> None:
        """Staged modifications make the working tree dirty."""
        (repo.root / "a.md").write_text("v1", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        (repo.root / "a.md").write_text("v2", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        assert repo.is_clean() is False

    def test_is_clean_false_with_unstaged_changes(self, repo: Repo) -> None:
        """Unstaged modifications also count as dirty."""
        (repo.root / "a.md").write_text("v1", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        (repo.root / "a.md").write_text("v2", encoding="utf-8")
        assert repo.is_clean() is False

    def test_is_clean_ignores_untracked_files(self, repo: Repo) -> None:
        """Untracked files don't make the tree dirty — ``-uno`` is passed.

        Users run AC-DC in repos that routinely have editor scratch
        files and ``.ac-dc4/`` itself lives in the working tree.
        Review-mode and doc-convert gating would be unusable if every
        untracked file tripped them.
        """
        (repo.root / "tracked.md").write_text("hi", encoding="utf-8")
        _run_git(repo.root, "add", "tracked.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        (repo.root / "scratch.md").write_text("draft", encoding="utf-8")
        assert repo.is_clean() is True


class TestCheckoutBranch:
    """checkout_branch — switching between local and remote branches."""

    @staticmethod
    def _seed_two_branches(repo: Repo) -> None:
        """Create main with one commit and a feature branch with another.

        Leaves HEAD on main so tests can verify the initial state.
        """
        (repo.root / "a.md").write_text("on main\n", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "main init")
        _run_git(repo.root, "checkout", "-q", "-b", "feature")
        (repo.root / "b.md").write_text("on feature\n", encoding="utf-8")
        _run_git(repo.root, "add", "b.md")
        _run_git(repo.root, "commit", "-q", "-m", "feature work")
        _run_git(repo.root, "checkout", "-q", "main")

    def test_switches_to_existing_local_branch(self, repo: Repo) -> None:
        """Plain branch name switches HEAD to that branch."""
        self._seed_two_branches(repo)
        result = repo.checkout_branch("feature")
        assert result.get("status") == "ok"
        assert result.get("branch") == "feature"
        assert len(result.get("sha", "")) == 40
        # Working tree reflects feature branch now.
        assert (repo.root / "b.md").is_file()
        # And git's own view agrees.
        current = _run_git(
            repo.root, "rev-parse", "--abbrev-ref", "HEAD",
        ).stdout.strip()
        assert current == "feature"

    def test_rejects_empty_name(self, repo: Repo) -> None:
        """Empty string / whitespace-only returns a structured error."""
        self._seed_two_branches(repo)
        assert "error" in repo.checkout_branch("")
        assert "error" in repo.checkout_branch("   ")

    def test_rejects_unknown_branch(self, repo: Repo) -> None:
        """Non-existent local branch returns a structured error."""
        self._seed_two_branches(repo)
        result = repo.checkout_branch("does-not-exist")
        assert "error" in result
        assert "does-not-exist" in result["error"]

    def test_refuses_dirty_working_tree(self, repo: Repo) -> None:
        """Uncommitted changes block the switch with a clear error."""
        self._seed_two_branches(repo)
        # Modify the tracked file so the working tree is dirty.
        (repo.root / "a.md").write_text("uncommitted\n", encoding="utf-8")
        result = repo.checkout_branch("feature")
        assert "error" in result
        assert "uncommitted" in result["error"].lower()
        # HEAD still on main.
        current = _run_git(
            repo.root, "rev-parse", "--abbrev-ref", "HEAD",
        ).stdout.strip()
        assert current == "main"

    def test_switch_to_current_branch_is_noop(self, repo: Repo) -> None:
        """Switching to the branch you're already on succeeds.

        Git's own checkout is a no-op in that case; we want the
        same semantics so a racy double-click doesn't produce an
        error toast.
        """
        self._seed_two_branches(repo)
        result = repo.checkout_branch("main")
        assert result.get("status") == "ok"
        assert result.get("branch") == "main"

    def test_remote_ref_creates_tracking_branch(
        self, repo: Repo, tmp_path
    ) -> None:
        """``origin/feature`` with no local branch creates one that tracks.

        Sets up a bare remote, pushes a feature branch, deletes the
        local copy, then checks out via the ``origin/feature``
        form. After the switch, a local ``feature`` branch exists
        with upstream tracking configured.
        """
        remote_root = tmp_path / "origin.git"
        remote_root.mkdir()
        _run_git(remote_root, "init", "-q", "--bare")
        # Initial commit on main, push.
        (repo.root / "a.md").write_text("on main\n", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        _run_git(repo.root, "remote", "add", "origin", str(remote_root))
        _run_git(repo.root, "push", "-q", "-u", "origin", "main")
        # Create a feature branch, push, then delete locally.
        _run_git(repo.root, "checkout", "-q", "-b", "feature")
        _run_git(repo.root, "commit", "-q", "--allow-empty", "-m", "feat")
        _run_git(repo.root, "push", "-q", "-u", "origin", "feature")
        _run_git(repo.root, "checkout", "-q", "main")
        _run_git(repo.root, "branch", "-q", "-D", "feature")
        # Sanity: feature is gone locally but origin/feature exists.
        refs = _run_git(
            repo.root, "for-each-ref", "refs/remotes/",
            "--format=%(refname)",
        ).stdout
        assert "refs/remotes/origin/feature" in refs
        # Switch via the remote form.
        result = repo.checkout_branch("origin/feature")
        assert result.get("status") == "ok"
        # Result's branch name is the tail — the local name we
        # just created, not the remote qualified form.
        assert result.get("branch") == "feature"
        # Local tracking branch now exists.
        local_probe = _run_git(
            repo.root, "rev-parse", "--verify", "refs/heads/feature",
        )
        assert local_probe.returncode == 0

    def test_remote_ref_with_existing_local_switches_local(
        self, repo: Repo, tmp_path
    ) -> None:
        """``origin/feature`` with an existing local ``feature`` switches
        to the local branch without re-creating.

        DWIM rule — matches what plain ``git checkout feature`` does
        when both sides exist.
        """
        remote_root = tmp_path / "origin.git"
        remote_root.mkdir()
        _run_git(remote_root, "init", "-q", "--bare")
        (repo.root / "a.md").write_text("on main\n", encoding="utf-8")
        _run_git(repo.root, "add", "a.md")
        _run_git(repo.root, "commit", "-q", "-m", "init")
        _run_git(repo.root, "remote", "add", "origin", str(remote_root))
        _run_git(repo.root, "push", "-q", "-u", "origin", "main")
        _run_git(repo.root, "checkout", "-q", "-b", "feature")
        _run_git(repo.root, "commit", "-q", "--allow-empty", "-m", "feat")
        _run_git(repo.root, "push", "-q", "-u", "origin", "feature")
        _run_git(repo.root, "checkout", "-q", "main")
        # Local feature branch still exists — don't delete.
        result = repo.checkout_branch("origin/feature")
        assert result.get("status") == "ok"
        assert result.get("branch") == "feature"
        # HEAD is on the local feature branch.
        current = _run_git(
            repo.root, "rev-parse", "--abbrev-ref", "HEAD",
        ).stdout.strip()
        assert current == "feature"

    def test_malformed_remote_ref_rejected(self, repo: Repo) -> None:
        """``origin/`` with no tail name returns a structured error."""
        self._seed_two_branches(repo)
        result = repo.checkout_branch("origin/")
        # Either rejected as malformed or as "unknown branch" —
        # either response is acceptable because the ref can't
        # resolve. We just assert it doesn't raise.
        assert "error" in result