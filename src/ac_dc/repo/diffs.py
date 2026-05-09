"""Diff queries — staged, unstaged, and against a branch.

Extracted from :mod:`ac_dc.repo`. See ``specs4/1-foundation/repository.md``
for the governing contract.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any


class DiffsMixin:
    """Diff queries — staged, unstaged, and against a branch."""

    _root: Path

    # Forward declarations from sibling mixins.
    def _run_git(self, args: list[str], **kwargs: Any) -> Any: ...  # type: ignore[empty-body]

    # ------------------------------------------------------------------
    # Diffs
    # ------------------------------------------------------------------

    def get_staged_diff(self) -> str:
        """Return the staged diff (``git diff --cached``) as text.

        Empty string when nothing is staged. Used by the commit
        message generator as its primary input.
        """
        result = self._run_git(["diff", "--cached"], check=True)
        return result.stdout

    def get_unstaged_diff(self) -> str:
        """Return the unstaged working-tree diff (``git diff``) as text.

        Empty string when the working tree is clean.
        """
        result = self._run_git(["diff"], check=True)
        return result.stdout

    def get_diff_to_branch(self, branch: str) -> dict[str, str]:
        """Return a two-dot diff against ``branch`` (working tree included).

        Two-dot diff: ``git diff <branch>`` compares the named branch
        against the working tree — includes both committed and
        uncommitted changes on the current side. Matches what the
        "copy diff vs branch" dropdown in the UI produces.

        Parameters
        ----------
        branch:
            Name of a branch, tag, or any ref git can resolve.

        Returns
        -------
        dict
            ``{"diff": "<patch text>"}`` on success, or
            ``{"error": "<message>"}`` if the ref doesn't exist.
            Error is returned rather than raised because the UI's
            branch picker calls this for user-chosen branches and
            should surface typos as feedback, not crash logs.
        """
        if not branch or not branch.strip():
            return {"error": "Empty branch name"}
        # Check the ref resolves before issuing the diff — gives a
        # cleaner error than git's own "bad revision" message.
        probe = self._run_git(["rev-parse", "--verify", branch])
        if probe.returncode != 0:
            return {"error": f"Unknown ref: {branch}"}
        result = self._run_git(["diff", branch])
        if result.returncode != 0:
            return {
                "error": (result.stderr or "diff failed").strip()
            }
        return {"diff": result.stdout}