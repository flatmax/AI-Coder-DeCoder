"""Commit graph rendering data and range queries.

Extracted verbatim from ``src/ac_dc/repo.py`` as part of the
repository-layer split. See that module's docstring for the
overall design notes.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .errors import (
    COMMIT_GRAPH_DEFAULT_LIMIT,
    COMMIT_LOG_DEFAULT_LIMIT,
)


class CommitGraphMixin:
    """Commit graph rendering data and range queries."""

    _root: Path

    def _run_git(self, args: list[str], **kwargs: Any) -> Any: ...  # type: ignore[empty-body]
    def list_branches(self) -> dict[str, object]: ...  # type: ignore[empty-body]
    def list_all_branches(self) -> list[dict[str, object]]: ...  # type: ignore[empty-body]
    @staticmethod
    def _parse_log_records(raw: str) -> list[dict[str, str]]: ...  # type: ignore[empty-body]

    # ------------------------------------------------------------------
    # Commit graph and log
    # ------------------------------------------------------------------

    def get_commit_graph(
        self,
        limit: int = COMMIT_GRAPH_DEFAULT_LIMIT,
        offset: int = 0,
        include_remote: bool = False,
    ) -> dict[str, object]:
        """Return paginated commit graph data for the review selector.

        Used by the git-graph UI that replaces the old branch-dropdown
        flow in review mode. Returns commits plus branch tip data so
        the frontend can render the lane layout client-side.

        Parameters
        ----------
        limit:
            Page size. Default :data:`COMMIT_GRAPH_DEFAULT_LIMIT`.
        offset:
            Skip this many commits before returning the page. Used
            for scroll-loading additional commits.
        include_remote:
            When True, includes remote branches in the graph. The
            default is local-only because most users don't care about
            every remote tracking ref and the graph gets noisy.

        Returns
        -------
        dict
            - ``commits``: list of dicts with keys ``sha``,
              ``short_sha``, ``message``, ``author``, ``date`` (ISO
              8601), ``relative_date`` (e.g., "2 days ago"),
              ``parents`` (list of parent SHAs)
            - ``branches``: list of dicts with keys ``name``, ``sha``
              (tip commit), ``is_current``, ``is_remote``
            - ``has_more``: ``True`` when there are more commits
              beyond this page
        """
        # --all traverses all refs; without it we only get HEAD's
        # ancestry, which isn't enough for a multi-branch graph.
        # --topo-order keeps the topological order stable so lane
        # assignment on the client side is deterministic.
        # %x00 is a literal NUL used as field separator — safer than
        # any printable character because commit subjects can contain
        # anything.
        # Note: --max-count + --skip gives us paging. Getting
        # has_more right requires fetching one extra commit and
        # checking whether we got it; we do this with `limit + 1`.
        scope = ["--all"] if include_remote else ["--branches"]
        format_str = "%H%x00%h%x00%s%x00%an%x00%aI%x00%ar%x00%P"
        args = [
            "log",
            *scope,
            "--topo-order",
            f"--skip={offset}",
            f"--max-count={limit + 1}",
            f"--format={format_str}",
        ]
        result = self._run_git(args, check=True)

        commits: list[dict[str, object]] = []
        for line in result.stdout.splitlines():
            if not line:
                continue
            parts = line.split("\x00")
            if len(parts) != 7:
                continue
            sha, short_sha, message, author, date, relative_date, parents_raw = parts
            parents = parents_raw.split() if parents_raw else []
            commits.append({
                "sha": sha,
                "short_sha": short_sha,
                "message": message,
                "author": author,
                "date": date,
                "relative_date": relative_date,
                "parents": parents,
            })

        # Check for has_more by examining the over-fetch.
        has_more = len(commits) > limit
        if has_more:
            commits = commits[:limit]

        # Branches — reuse list_all_branches when include_remote,
        # otherwise just local.
        if include_remote:
            branches = self.list_all_branches()
        else:
            local = self.list_branches()
            branches = [
                {
                    "name": b["name"],
                    "sha": b["sha"],
                    "is_current": b["is_current"],
                    "is_remote": False,
                }
                for b in local["branches"]  # type: ignore[index]
            ]

        return {
            "commits": commits,
            "branches": branches,
            "has_more": has_more,
        }

    def get_commit_log(
        self,
        base: str,
        head: str | None = None,
        limit: int = COMMIT_LOG_DEFAULT_LIMIT,
    ) -> list[dict[str, str]]:
        """Return the commit log for a range.

        Parameters
        ----------
        base:
            Base ref (exclusive).
        head:
            Head ref (inclusive). Defaults to ``HEAD`` when None.
        limit:
            Maximum number of commits.

        Returns
        -------
        list[dict]
            Entries with ``sha``, ``short_sha``, ``message``,
            ``author``, ``date`` — same shape as
            :meth:`search_commits`.
        """
        head_ref = head or "HEAD"
        # ``base..head`` is the two-dot range: commits reachable
        # from head but not from base. Matches what git log shows
        # by default and what review mode needs.
        range_spec = f"{base}..{head_ref}"
        args = [
            "log",
            range_spec,
            f"--max-count={limit}",
            "--format=%H%x00%h%x00%s%x00%an%x00%aI",
        ]
        result = self._run_git(args, check=True)
        return self._parse_log_records(result.stdout)

    def get_commit_parent(self, commit: str) -> dict[str, str]:
        """Return the parent SHA of a commit.

        Used by review mode when falling back from ``merge-base``:
        if the merge-base cascade fails, the UI uses the parent of
        the user-selected base commit instead.

        Parameters
        ----------
        commit:
            Commit SHA, ref name, or prefix.

        Returns
        -------
        dict
            ``{"sha": "<full SHA>", "short_sha": "<7 chars>"}`` on
            success, or ``{"error": "<message>"}`` if the commit
            doesn't resolve or has no parent (root commit).
        """
        # ``commit^`` is git syntax for "first parent of commit".
        # rev-parse with --verify fails cleanly when the commit
        # doesn't exist or has no parent.
        probe = self._run_git(
            ["rev-parse", "--verify", f"{commit}^"],
        )
        if probe.returncode != 0:
            return {
                "error": (probe.stderr or "commit has no parent").strip()
            }
        sha = probe.stdout.strip()
        short = self._run_git(
            ["rev-parse", "--short", sha],
            check=True,
        ).stdout.strip()
        return {"sha": sha, "short_sha": short}

    def get_merge_base(
        self,
        ref1: str,
        ref2: str | None = None,
    ) -> dict[str, str]:
        """Return the merge-base between two refs.

        Used by review mode to find the commit where the reviewed
        branch diverged from the target branch. When ``ref2`` is
        None, cascades through common candidates (``main``,
        ``master``) — useful when the review selector doesn't know
        which default branch the repo uses.

        Parameters
        ----------
        ref1:
            First ref (typically the branch tip being reviewed).
        ref2:
            Second ref. When None, tries ``main`` then ``master``.

        Returns
        -------
        dict
            ``{"sha": "<full SHA>", "short_sha": "<7 chars>"}`` on
            success, or ``{"error": "<message>"}`` if no merge-base
            exists (unrelated histories).
        """
        candidates: list[str]
        if ref2 is not None:
            candidates = [ref2]
        else:
            # Cascade — try main, then master. Matches what specs4
            # calls the "original_branch → main → master" fallback.
            candidates = ["main", "master"]

        last_error = ""
        for candidate in candidates:
            result = self._run_git(["merge-base", ref1, candidate])
            if result.returncode == 0 and result.stdout.strip():
                sha = result.stdout.strip()
                short = self._run_git(
                    ["rev-parse", "--short", sha],
                    check=True,
                ).stdout.strip()
                return {"sha": sha, "short_sha": short}
            last_error = (result.stderr or "").strip()

        return {"error": last_error or "No merge-base found"}