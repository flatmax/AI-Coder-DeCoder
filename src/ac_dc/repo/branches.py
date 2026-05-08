"""Branch queries and checkout.

Extracted verbatim from ``src/ac_dc/repo.py`` as part of the
repository-layer split. See that module's docstring for the
overall design notes.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any


class BranchesMixin:
    """Branch queries and checkout."""

    _root: Path

    def _check_localhost_only(self) -> dict[str, Any] | None: ...  # type: ignore[empty-body]
    def _fire_post_write(self, path: str) -> None: ...  # type: ignore[empty-body]
    def _run_git(self, args: list[str], **kwargs: Any) -> Any: ...  # type: ignore[empty-body]

    # ------------------------------------------------------------------
    # Branch queries
    # ------------------------------------------------------------------

    def get_current_branch(self) -> dict[str, object]:
        """Return the current branch info.

        Uses ``git symbolic-ref`` for the branch name — safer than
        parsing ``git branch`` output, which can include stray
        characters (asterisks, escape codes) depending on locale and
        colour settings. ``symbolic-ref`` returns the full ref path
        (``refs/heads/main``); we strip the prefix.

        Returns
        -------
        dict
            - ``branch``: branch name (``str``) or ``None`` if detached
            - ``sha``: full SHA of HEAD
            - ``detached``: ``True`` when HEAD isn't pointing at a
              branch (e.g., during review mode, after checking out a
              tag or a specific commit)
        """
        # symbolic-ref exits non-zero in detached HEAD. That's the
        # signal, not an error.
        sym = self._run_git(["symbolic-ref", "--short", "HEAD"])
        # HEAD's SHA is always resolvable (except for a completely
        # fresh repo with no commits — rare, but we handle it).
        sha_probe = self._run_git(["rev-parse", "HEAD"])
        sha = sha_probe.stdout.strip() if sha_probe.returncode == 0 else ""
        if sym.returncode == 0:
            return {
                "branch": sym.stdout.strip(),
                "sha": sha,
                "detached": False,
            }
        return {
            "branch": None,
            "sha": sha,
            "detached": True,
        }

    def resolve_ref(self, ref: str) -> str | None:
        """Resolve a ref (branch, tag, SHA prefix) to a full SHA.

        Returns ``None`` when the ref doesn't resolve — callers use
        this as a lightweight "does this ref exist" probe. Raising
        would force every caller to wrap in try/except for a case
        that's expected (user typos in the branch picker).
        """
        if not ref or not ref.strip():
            return None
        result = self._run_git(["rev-parse", "--verify", ref])
        if result.returncode != 0:
            return None
        return result.stdout.strip()

    def list_branches(self) -> dict[str, object]:
        """List local branches.

        Returns
        -------
        dict
            - ``branches``: list of dicts with keys ``name``, ``sha``,
              ``message`` (first line of tip commit), ``is_current``
            - ``current``: name of the current branch, or ``None``
              when detached
        """
        # for-each-ref lets us format the output exactly once rather
        # than making one rev-parse per branch. %(HEAD) is a single
        # character: '*' when the ref is HEAD, ' ' otherwise —
        # simpler than parsing ``git branch`` asterisks.
        format_str = "%(HEAD)%00%(refname:short)%00%(objectname)%00%(contents:subject)"
        result = self._run_git(
            [
                "for-each-ref",
                "refs/heads/",
                f"--format={format_str}",
            ],
            check=True,
        )

        branches: list[dict[str, object]] = []
        current: str | None = None
        for line in result.stdout.splitlines():
            if not line:
                continue
            parts = line.split("\x00")
            if len(parts) != 4:
                continue
            head_marker, name, sha, message = parts
            is_current = head_marker == "*"
            if is_current:
                current = name
            branches.append({
                "name": name,
                "sha": sha,
                "message": message,
                "is_current": is_current,
            })
        return {"branches": branches, "current": current}

    def list_all_branches(self) -> list[dict[str, object]]:
        """List all branches (local and remote), sorted by recency.

        Used by the "copy diff vs branch" dropdown. Remote branches
        appear with their ``origin/`` prefix. Deduplication: when a
        local branch and its remote tracking branch point at the
        same tip, only the local entry is kept — the UI doesn't
        benefit from showing both.

        Filtering rules:

        - Symbolic refs (``HEAD``, ``origin/HEAD``) are skipped —
          ``%(symref)`` is non-empty for them so the filter is exact.
        - Bare remote aliases like ``origin`` (no slash, but a
          refs/remotes parent name) are skipped — they're not
          branches, just remote-root placeholders.

        Returns
        -------
        list[dict]
            Each entry — ``name``, ``sha``, ``is_current``,
            ``is_remote``. Sorted by committer date descending,
            so the most recently active branches appear first.
            Dedup preserves this sort order.
        """
        format_str = (
            "%(refname)%00"
            "%(refname:short)%00"
            "%(objectname)%00"
            "%(HEAD)%00"
            "%(symref)"
        )

        # Two separate for-each-ref calls — one per namespace —
        # merged in Python. Simpler than trying to distinguish
        # refs/heads from refs/remotes by shortname alone, which
        # breaks for local branches that contain slashes (e.g.,
        # the common "feature/auth" convention). The %(refname)
        # field gives us the unambiguous full ref path.
        def _query(namespace: str) -> list[tuple[str, str, str, str]]:
            result = self._run_git(
                [
                    "for-each-ref",
                    namespace,
                    "--sort=-committerdate",
                    f"--format={format_str}",
                ],
                check=True,
            )
            rows: list[tuple[str, str, str, str]] = []
            for line in result.stdout.splitlines():
                if not line:
                    continue
                parts = line.split("\x00")
                if len(parts) != 5:
                    continue
                full_ref, short_name, sha, head_marker, symref = parts
                if symref:
                    # Symbolic ref (HEAD → refs/heads/main,
                    # origin/HEAD → refs/remotes/origin/main).
                    # Never a real branch.
                    continue
                rows.append((full_ref, short_name, sha, head_marker))
            return rows

        local_rows = _query("refs/heads/")
        remote_rows = _query("refs/remotes/")

        # Local branches first — they're authoritative. Build both
        # the entry list and a name→SHA map used for dedup.
        local_entries: list[dict[str, object]] = []
        local_names: set[str] = set()
        local_shas: set[str] = set()
        for _full_ref, short_name, sha, head_marker in local_rows:
            local_entries.append({
                "name": short_name,
                "sha": sha,
                "is_current": head_marker == "*",
                "is_remote": False,
            })
            local_names.add(short_name)
            local_shas.add(sha)

        # Remote branches — filter aliases and dedup against local.
        remote_entries: list[dict[str, object]] = []
        for _full_ref, short_name, sha, _head_marker in remote_rows:
            # Bare remote alias: "origin" with no slash. A real
            # remote branch always has the ``<remote>/<branch>``
            # shape, so absence of a slash means this is the remote
            # root placeholder, not a branch.
            if "/" not in short_name:
                continue
            # Dedup: if the remote's branch name (tail after the
            # first slash) matches a local branch AND the SHA is
            # the same, the remote is just a tracking ref for a
            # local branch we already listed. Skip.
            _, _, tail = short_name.partition("/")
            if tail in local_names and sha in local_shas:
                continue
            remote_entries.append({
                "name": short_name,
                "sha": sha,
                "is_current": False,  # remote refs are never HEAD
                "is_remote": True,
            })

        # Combine. Each list is individually sorted by committer
        # date descending (from git's --sort). Locals come first so
        # the user's own branches appear before remote-only ones.
        # Within each group the recency order is preserved.
        return local_entries + remote_entries

    def is_clean(self) -> bool:
        """Return True when the working tree has no tracked changes.

        Uses ``git status --porcelain -uno`` — the ``-uno`` flag
        skips untracked files. Untracked files are tolerated by
        review-mode and doc-convert gating; only staged or modified
        tracked files count as "dirty".
        """
        result = self._run_git(
            ["status", "--porcelain", "-uno"],
            check=True,
        )
        return not result.stdout.strip()

    def checkout_branch(self, name: str) -> dict[str, object]:
        """Switch to a local branch, or create a tracking branch
        for a remote ref.

        Refuses dirty working trees — the caller should run
        ``is_clean()`` first and surface a toast, but we re-check
        here so a racy click can't wedge git into a half-switched
        state. Uses ``git checkout`` rather than ``git switch`` so
        the behaviour matches the rest of this module's idioms
        (git switch is newer and its DWIM rules differ slightly
        from checkout's in edge cases).

        DWIM semantics for remote refs:

        - ``origin/feature`` with no local ``feature`` →
          ``git checkout -b feature --track origin/feature``
          creates a tracking branch and switches to it.
        - ``origin/feature`` with a local ``feature`` that already
          exists → switch to the local branch (don't re-create).
          Matches what ``git checkout feature`` would do if the
          user had typed the short form.
        - Local branch name → plain ``git checkout <name>``.

        Parameters
        ----------
        name:
            Branch name. Accepts local branches (``feature``) or
            remote tracking refs (``origin/feature``). Must not be
            empty.

        Returns
        -------
        dict
            ``{"status": "ok", "branch": "<name>", "sha": "<SHA>"}``
            on success. On failure, ``{"error": "<message>"}`` —
            the UI surfaces this as a toast so the user can retry
            or resolve the dirty-tree condition.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted  # type: ignore[return-value]
        if not name or not name.strip():
            return {"error": "Empty branch name"}
        name = name.strip()
        if not self.is_clean():
            return {
                "error": (
                    "Working tree has uncommitted changes. "
                    "Commit, stash, or discard them before "
                    "switching branches."
                )
            }

        # Distinguish remote-tracking ref ("origin/feature") from
        # local branch ("feature"). A slash in the name is the
        # signal — local branches can contain slashes (e.g.
        # "feature/auth") but those don't start with a remote name
        # followed by a slash, so we probe for a local branch by
        # that exact name first.
        local_probe = self._run_git(
            ["rev-parse", "--verify", f"refs/heads/{name}"],
        )
        is_local = local_probe.returncode == 0

        if is_local:
            # Plain local switch.
            checkout = self._run_git(["checkout", "-q", name])
            if checkout.returncode != 0:
                return {
                    "error": (
                        f"Failed to checkout {name}: "
                        f"{checkout.stderr.strip() or 'unknown error'}"
                    )
                }
        elif "/" in name:
            # Remote tracking ref. Split into remote + branch tail,
            # then DWIM: if a local branch with the tail name
            # already exists, switch to it; otherwise create a
            # tracking branch.
            _, _, tail = name.partition("/")
            if not tail:
                return {"error": f"Malformed remote ref: {name}"}
            tail_probe = self._run_git(
                ["rev-parse", "--verify", f"refs/heads/{tail}"],
            )
            if tail_probe.returncode == 0:
                # Local branch already exists — plain switch.
                checkout = self._run_git(["checkout", "-q", tail])
                if checkout.returncode != 0:
                    return {
                        "error": (
                            f"Failed to checkout {tail}: "
                            f"{checkout.stderr.strip() or 'unknown error'}"
                        )
                    }
                name = tail  # Return the local name in the result.
            else:
                # Create tracking branch.
                checkout = self._run_git(
                    ["checkout", "-q", "-b", tail, "--track", name],
                )
                if checkout.returncode != 0:
                    return {
                        "error": (
                            f"Failed to create tracking branch {tail}: "
                            f"{checkout.stderr.strip() or 'unknown error'}"
                        )
                    }
                name = tail
        else:
            # Name has no slash and isn't a local branch.
            # Unresolvable — surface the error rather than letting
            # git produce a less-specific message.
            return {"error": f"Unknown branch: {name}"}

        # Resolve the new HEAD SHA for the result envelope.
        sha_probe = self._run_git(["rev-parse", "HEAD"])
        sha = (
            sha_probe.stdout.strip()
            if sha_probe.returncode == 0
            else ""
        )
        # Fire the post-write callback with an empty path — the
        # whole working tree may have changed, so every index
        # should re-scan on its own schedule. An empty path is
        # the LLMService callback's signal for "refresh
        # everything".
        self._fire_post_write("")
        return {"status": "ok", "branch": name, "sha": sha}