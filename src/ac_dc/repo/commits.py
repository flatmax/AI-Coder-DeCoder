"""Commit creation, reset, and history search.

Extracted verbatim from ``src/ac_dc/repo.py`` as part of the
repository-layer split. See that module's docstring for the
overall design notes.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .errors import COMMIT_LOG_DEFAULT_LIMIT, RepoError


class CommitsMixin:
    """Commit creation, reset, and history search."""

    _root: Path

    def _check_localhost_only(self) -> dict[str, Any] | None: ...  # type: ignore[empty-body]
    def _run_git(self, args: list[str], **kwargs: Any) -> Any: ...  # type: ignore[empty-body]

    # ------------------------------------------------------------------
    # Commit and reset
    # ------------------------------------------------------------------

    def commit(self, message: str) -> dict[str, str]:
        """Create a commit with the given message.

        Handles the initial-commit case (no HEAD yet) by passing
        the message on stdin — git's own empty-repo handling works
        as long as something is staged.

        Parameters
        ----------
        message:
            Commit message. Must be non-empty after stripping.

        Returns
        -------
        dict
            ``{"sha": "<full SHA>", "message": "<message>"}`` on
            success.

        Raises
        ------
        RepoError
            If the message is empty or the commit fails (nothing
            staged, hook rejection, etc.).
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted  # type: ignore[return-value]
        if not message or not message.strip():
            raise RepoError("Commit message must not be empty")
        # ``-F -`` reads the message from stdin. Safer than ``-m``
        # for messages that contain special characters or newlines,
        # which conventional-commit bodies often do.
        self._run_git(
            ["commit", "-F", "-"],
            input_data=message,
            check=True,
        )
        sha_result = self._run_git(
            ["rev-parse", "HEAD"],
            check=True,
        )
        return {"sha": sha_result.stdout.strip(), "message": message}

    def reset_hard(self) -> dict[str, str]:
        """Hard-reset the working tree to HEAD (``git reset --hard HEAD``).

        Destroys all uncommitted changes — staged and unstaged.
        The UI always confirms before calling this; the repo layer
        performs no additional confirmation.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted  # type: ignore[return-value]
        self._run_git(["reset", "--hard", "HEAD"], check=True)
        return {"status": "ok"}

    def search_commits(
        self,
        query: str,
        branch: str | None = None,
        limit: int = COMMIT_LOG_DEFAULT_LIMIT,
    ) -> list[dict[str, str]]:
        """Search commit history for ``query`` in message, SHA, or author.

        Uses ``git log`` with the ``--grep`` filter for messages and
        ``--author`` for authors, combined with ``--all-match=false``
        semantics (the default — ORs the two filters). SHA prefix
        matching is handled by running the query through
        ``git rev-parse`` first: if it resolves to a commit, that
        commit is the only hit.

        Parameters
        ----------
        query:
            Search text. Empty string returns an empty list.
        branch:
            Optional branch or ref to search. When None, searches all
            refs (``--all``) — matches the history-browser UI's
            "search all branches" default.
        limit:
            Maximum number of matching commits to return. Defaults
            to :data:`COMMIT_LOG_DEFAULT_LIMIT`. Large limits on
            monster repos are slow, but paging is a UI concern —
            callers that want pagination use ``get_commit_graph``.

        Returns
        -------
        list[dict]
            Each entry has keys ``sha`` (full SHA), ``short_sha``
            (7 chars), ``message`` (first line only), ``author``,
            ``date`` (ISO 8601 UTC).
        """
        if not query or not query.strip():
            return []

        # SHA-prefix fast path. If the query parses as a commit SHA
        # or prefix, we want an exact hit rather than grepping. A
        # query like "abc" that happens to resolve to a commit and
        # also appears in some commit messages would otherwise show
        # both, which is noisy and usually not what the user meant.
        probe = self._run_git(
            ["rev-parse", "--verify", f"{query}^{{commit}}"],
        )
        if probe.returncode == 0:
            sha = probe.stdout.strip()
            return self._log_for_refs([sha], limit=1)

        scope = [branch] if branch else ["--all"]
        format_str = "--format=%H%x00%h%x00%s%x00%an%x00%aI"
        # ``git log --grep=X --author=Y`` ANDs the two filters. We
        # want OR semantics ("match in message OR in author name")
        # so we run the two filters as separate log invocations and
        # union the results by SHA. Each call already honours
        # --regexp-ignore-case, so matching is case-insensitive on
        # both sides. We over-fetch each side (2x limit) so the
        # union-then-truncate still returns ``limit`` entries in
        # the common case where the two sides overlap heavily.
        base_args = [
            "log",
            *scope,
            f"--max-count={limit * 2}",
            "--regexp-ignore-case",
            format_str,
        ]
        grep_result = self._run_git(
            [*base_args, f"--grep={query}"],
            check=True,
        )
        author_result = self._run_git(
            [*base_args, f"--author={query}"],
            check=True,
        )
        # Union by SHA. Dict preserves insertion order, so entries
        # appear in the order git first emitted them. Grep comes
        # first because message hits are usually what the user
        # wants to see when both match.
        by_sha: dict[str, dict[str, str]] = {}
        for record in self._parse_log_records(grep_result.stdout):
            by_sha[record["sha"]] = record
        for record in self._parse_log_records(author_result.stdout):
            by_sha.setdefault(record["sha"], record)
        # Re-sort the merged list by commit date descending so the
        # caller sees newest-first across both filters. The two
        # individual queries were each date-sorted, but a simple
        # concat loses that ordering once entries interleave.
        merged = sorted(
            by_sha.values(),
            key=lambda r: r["date"],
            reverse=True,
        )
        return merged[:limit]

    def _log_for_refs(
        self,
        refs: list[str],
        *,
        limit: int,
    ) -> list[dict[str, str]]:
        """Run ``git log`` over ``refs`` and parse the output.

        Internal helper — used by :meth:`search_commits` for the
        SHA-prefix fast path. Parses the same null-separated format.
        """
        args = [
            "log",
            *refs,
            f"--max-count={limit}",
            "--format=%H%x00%h%x00%s%x00%an%x00%aI",
        ]
        result = self._run_git(args, check=True)
        return self._parse_log_records(result.stdout)

    @staticmethod
    def _parse_log_records(raw: str) -> list[dict[str, str]]:
        """Parse null-separated git-log output into record dicts.

        Format string ``%H%x00%h%x00%s%x00%an%x00%aI`` produces
        lines where each field is separated by a literal NUL byte.
        NUL is used rather than a printable separator because commit
        subjects can contain any character — tab, pipe, comma — so
        a printable separator risks collisions.
        """
        records: list[dict[str, str]] = []
        for line in raw.splitlines():
            if not line:
                continue
            parts = line.split("\x00")
            if len(parts) != 5:
                # Shouldn't happen — log format is fixed — but skip
                # rather than crash if git emits something unexpected.
                continue
            sha, short_sha, message, author, date = parts
            records.append({
                "sha": sha,
                "short_sha": short_sha,
                "message": message,
                "author": author,
                "date": date,
            })
        return records