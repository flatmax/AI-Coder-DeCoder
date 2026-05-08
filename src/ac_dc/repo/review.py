"""Review-mode entry/exit sequence and per-file diff access.

Extracted from ``src/ac_dc/repo.py``. See the parent module's
docstring for the overall design.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class ReviewMixin:
    """Review-mode entry/exit sequence and per-file diff access.

    Review mode uses git's soft-reset mechanism to present branch
    changes as staged modifications. See specs4/4-features/code-review.md
    for the full sequence.
    """

    _root: Path

    def _validate_rel_path(self, path: str | Path) -> Path: ...  # type: ignore[empty-body]
    def _normalise_rel_path(self, path: str | Path) -> str: ...  # type: ignore[empty-body]
    def _check_localhost_only(self) -> dict[str, Any] | None: ...  # type: ignore[empty-body]
    def _run_git(self, args: list[str], **kwargs: Any) -> Any: ...  # type: ignore[empty-body]
    def is_clean(self) -> bool: ...  # type: ignore[empty-body]
    def get_current_branch(self) -> dict[str, object]: ...  # type: ignore[empty-body]
    def resolve_ref(self, ref: str) -> str | None: ...  # type: ignore[empty-body]
    def get_commit_parent(self, commit: str) -> dict[str, str]: ...  # type: ignore[empty-body]
    def get_merge_base(self, ref1: str, ref2: str | None = None) -> dict[str, str]: ...  # type: ignore[empty-body]
    @staticmethod
    def _unquote_porcelain_path(raw: str) -> str: ...  # type: ignore[empty-body]
    def _parse_numstat(self, raw: str) -> dict[str, dict[str, int]]: ...  # type: ignore[empty-body]

    # ------------------------------------------------------------------
    # Review mode
    # ------------------------------------------------------------------
    #
    # Review mode uses git's soft-reset mechanism to present branch
    # changes as staged modifications. The entry sequence does a
    # specific dance of checkouts so the final state has:
    #
    #   - Disk files: at the branch tip (the code being reviewed)
    #   - Git HEAD: at the merge-base (the pre-review state)
    #   - Staged changes: everything between
    #
    # This lets the existing file picker, diff viewer, and context
    # engine work unchanged — they all already understand staged
    # changes. The full sequence is specified in
    # specs4/4-features/code-review.md.

    def checkout_review_parent(
        self,
        branch: str,
        base_commit: str,
    ) -> dict[str, object]:
        """Begin the review-mode entry sequence.

        Performs steps 1–5 of the entry sequence — records the
        original branch, verifies cleanliness, computes the
        merge-base, and checks out that merge-base so disk files
        reflect the pre-change state. The caller then builds the
        pre-change symbol map before invoking
        :meth:`setup_review_soft_reset` to complete the transition.

        Parameters
        ----------
        branch:
            The branch being reviewed. Can be a local branch name
            (``feature-auth``) or a remote tracking ref
            (``origin/feature-auth``).
        base_commit:
            The commit the user selected as the review base. Used
            only as a fallback when the merge-base cascade can't
            find a common ancestor between ``branch`` and a default
            branch (``main`` / ``master``).

        Returns
        -------
        dict
            On success:

            - ``branch``: the reviewed branch name
            - ``branch_tip``: full SHA of the branch tip (used by
              the exit sequence to restore)
            - ``base_commit``: the user-selected base (echoed back)
            - ``parent_commit``: the computed merge-base (current
              disk state)
            - ``original_branch``: branch HEAD was on before review,
              or ``None`` if HEAD was detached
            - ``phase``: always ``"at_parent"`` — signals the
              caller that disk is at the pre-change state and the
              pre-change symbol map should be built before the
              next step

            On failure: ``{"error": "<message>"}``. Failures include
            dirty working tree, unresolvable branch ref, and
            merge-base computation failure that also can't fall
            back to ``base_commit^``.

        Notes
        -----
        We deliberately return errors as dicts rather than raising.
        Review mode is user-initiated from the UI; errors are
        expected feedback (you have uncommitted changes, you
        selected a bogus branch) not programmer bugs.
        """
        # Step 1: working-tree cleanliness.
        if not self.is_clean():
            return {
                "error": (
                    "Working tree has uncommitted changes. "
                    "Commit, stash, or discard them before "
                    "entering review mode."
                )
            }

        # Record the original branch so the exit sequence knows
        # where to return. Detached HEAD is allowed as a starting
        # point — rare but some workflows use it — so we record the
        # SHA as a fallback.
        current = self.get_current_branch()
        original_branch: str | None = (
            str(current["branch"]) if current["branch"] else None
        )

        # Step 2: resolve the branch tip. Accepts both local and
        # remote forms uniformly — rev-parse handles either.
        branch_tip = self.resolve_ref(branch)
        if branch_tip is None:
            return {"error": f"Unknown branch: {branch}"}

        # Step 3: determine the review base.
        #
        # The user explicitly chose ``base_commit`` in the graph
        # — that's the commit they want to review from, not a
        # fallback. Use its parent as the review base so the
        # range becomes ``base_commit..branch_tip`` inclusive
        # of the selected commit's changes.
        #
        # The merge-base cascade is only used when the user
        # didn't pick a base (legacy callers that pass an empty
        # base_commit) or when computing the parent fails (root
        # commit on an unrelated branch).
        merge_base: str | None = None
        if base_commit:
            parent = self.get_commit_parent(base_commit)
            if "sha" in parent:
                merge_base = str(parent["sha"])
            else:
                # Root commit — no parent. Fall through to the
                # merge-base cascade so we don't block the review
                # entirely; the cascade will pick something
                # sensible even if the selected commit was
                # unreachable.
                logger.debug(
                    "base_commit %s has no parent (root?); "
                    "falling back to merge-base cascade",
                    base_commit,
                )
        # Cascade fallback when no base_commit provided or its
        # parent couldn't be resolved.
        if merge_base is None:
            if original_branch and original_branch != branch:
                attempt = self.get_merge_base(branch_tip, original_branch)
                if "sha" in attempt:
                    merge_base = str(attempt["sha"])
        if merge_base is None:
            attempt = self.get_merge_base(branch_tip)  # tries main, master
            if "sha" in attempt:
                merge_base = str(attempt["sha"])
        if merge_base is None:
            return {
                "error": (
                    f"Could not determine a review base for {branch}. "
                    f"Unrelated histories?"
                )
            }
        # Sanity check: a base equal to the tip means there's
        # nothing to review. Surface a clear error rather than
        # silently producing a clean detached-HEAD checkout.
        if merge_base == branch_tip:
            return {
                "error": (
                    f"Nothing to review: the selected base commit "
                    f"is at or after the tip of {branch}. "
                    f"Pick an older commit, or pick a different "
                    f"branch."
                )
            }

        # Step 4: checkout the branch (ensures we're on it before
        # detaching). We only do this when it makes sense — if the
        # user is already at the right branch, this is a no-op, and
        # for remote refs we skip because you can't check out a
        # remote tracking branch by its qualified name without
        # creating a local branch.
        if "/" not in branch and original_branch != branch:
            checkout_branch = self._run_git(["checkout", "-q", branch])
            if checkout_branch.returncode != 0:
                return {
                    "error": (
                        f"Failed to checkout {branch}: "
                        f"{checkout_branch.stderr.strip()}"
                    )
                }

        # Step 5: checkout the merge-base (detached HEAD). Disk now
        # reflects the pre-change state — the caller's next step is
        # to build a symbol map against disk.
        checkout_parent = self._run_git(["checkout", "-q", merge_base])
        if checkout_parent.returncode != 0:
            # Try to return to a known state before surfacing the
            # error — otherwise the user is stranded on a partial
            # review transition.
            if original_branch:
                self._run_git(["checkout", "-q", original_branch])
            return {
                "error": (
                    f"Failed to checkout merge-base {merge_base}: "
                    f"{checkout_parent.stderr.strip()}"
                )
            }

        return {
            "branch": branch,
            "branch_tip": branch_tip,
            "base_commit": base_commit,
            "parent_commit": merge_base,
            "original_branch": original_branch,
            "phase": "at_parent",
        }

    def setup_review_soft_reset(
        self,
        branch_tip: str,
        parent_commit: str,
    ) -> dict[str, str]:
        """Complete the review-mode entry sequence.

        Steps 6–7 of the entry sequence:

        6. Checkout the branch tip **by SHA** (not by name) — this
           brings disk files to the post-change state. Using SHA
           matters: for remote refs like ``origin/feature``, a
           checkout by name would leave HEAD at the ref pointer
           rather than at the actual commit.
        7. Soft reset to the merge-base — HEAD moves back without
           touching the working tree, so all feature-branch changes
           appear as staged modifications.

        Parameters
        ----------
        branch_tip:
            Full SHA of the branch tip (from
            :meth:`checkout_review_parent`'s result).
        parent_commit:
            Full SHA of the merge-base (ditto).

        Returns
        -------
        dict
            ``{"status": "review_ready"}`` on success. On failure,
            ``{"error": "<message>"}`` — the caller should invoke
            :meth:`exit_review_mode` to restore a sane state.
        """
        # Step 6: checkout branch tip by SHA.
        tip_checkout = self._run_git(["checkout", "-q", branch_tip])
        if tip_checkout.returncode != 0:
            return {
                "error": (
                    f"Failed to checkout branch tip {branch_tip}: "
                    f"{tip_checkout.stderr.strip()}"
                )
            }

        # Step 7: soft reset to merge-base. HEAD moves, index is
        # updated to reflect the tree at HEAD, working tree is
        # untouched. The net effect: disk stays at branch tip,
        # HEAD is at merge-base, every feature-branch change is
        # staged.
        reset = self._run_git(["reset", "--soft", parent_commit])
        if reset.returncode != 0:
            return {
                "error": (
                    f"Failed to soft-reset to {parent_commit}: "
                    f"{reset.stderr.strip()}"
                )
            }

        return {"status": "review_ready"}

    def exit_review_mode(
        self,
        branch_tip: str,
        original_branch: str | None,
    ) -> dict[str, str]:
        """Reverse the review-mode entry sequence.

        Three steps:

        1. Soft reset to the branch tip — HEAD moves forward,
           staging clears. Disk is unchanged (already at tip).
        2. Checkout the original branch — HEAD reattaches to the
           branch the user was on before review.
        3. Rebuilding the symbol index is the caller's
           responsibility (LLMService orchestrates it).

        Parameters
        ----------
        branch_tip:
            Full SHA of the branch tip that was being reviewed.
        original_branch:
            Branch name to return to, or ``None`` if HEAD was
            detached at review-entry time.

        Returns
        -------
        dict
            ``{"status": "restored"}`` on complete success. On
            partial success (tip reset worked but branch checkout
            failed), HEAD is left detached at ``branch_tip`` — the
            error message names what couldn't be restored so the
            user can fix it manually.

        Notes
        -----
        Manual recovery path when things go wrong: the user runs
        ``git checkout {original_branch}``. Since disk already
        matches the branch tip (both before and after soft-reset),
        a plain checkout is safe.
        """
        # Step 1: soft reset to the tip. Moves HEAD forward to the
        # branch tip SHA, clearing all the staged changes we
        # created on entry.
        reset = self._run_git(["reset", "--soft", branch_tip])
        if reset.returncode != 0:
            return {
                "error": (
                    f"Failed to reset to branch tip {branch_tip}: "
                    f"{reset.stderr.strip()}"
                )
            }

        # Step 2: reattach to the original branch. If HEAD was
        # detached at entry, we leave it detached — the caller's
        # pre-review state is preserved as faithfully as we can.
        if original_branch is not None:
            checkout = self._run_git(["checkout", "-q", original_branch])
            if checkout.returncode != 0:
                # Reset succeeded, but we couldn't reattach. HEAD
                # is safely at the branch tip SHA — disk matches,
                # no data is lost — but the user is detached. Name
                # the branch so they know what manual checkout to
                # run.
                return {
                    "error": (
                        f"Reset to branch tip succeeded, but could "
                        f"not checkout {original_branch}: "
                        f"{checkout.stderr.strip()}. "
                        f"Run: git checkout {original_branch}"
                    )
                }

        return {"status": "restored"}

    def get_review_changed_files(self) -> list[dict[str, object]]:
        """List files changed in the active review with per-file stats.

        Assumes the caller has already entered review mode (via
        :meth:`checkout_review_parent` + :meth:`setup_review_soft_reset`)
        so every review change appears as a staged modification.
        Produces one entry per changed file combining the status
        character from ``git diff --cached --name-status`` with the
        numeric addition/deletion counts from
        ``git diff --cached --numstat``.

        Returns
        -------
        list[dict]
            Each entry:

            - ``path``: repo-relative path
            - ``status``: one of ``"added"``, ``"modified"``,
              ``"deleted"``, ``"renamed"``, ``"copied"``,
              ``"typechange"``, or ``"unknown"`` (defensive fallback
              for statuses git may add in future versions)
            - ``additions``: lines added (0 for binary or delete)
            - ``deletions``: lines deleted (0 for binary or add)

            Empty list when no files have changed — callers treat
            this as "there's nothing to review".
        """
        # Name-status gives us the classification character; numstat
        # gives us the line-count pair. Two calls because combining
        # them via ``--name-status --numstat`` produces interleaved
        # output that's uglier to parse than two separate passes.
        name_status = self._run_git(
            ["diff", "--cached", "--name-status"],
            check=True,
        )
        numstat = self._run_git(
            ["diff", "--cached", "--numstat"],
            check=True,
        )
        stats = self._parse_numstat(numstat.stdout)

        # Map git's status letter to a human-readable name. The map
        # covers every status the porcelain docs list; anything
        # unexpected falls through to "unknown" rather than raising
        # because a forward-compatible parser is better than one
        # that breaks on a git upgrade.
        status_names: dict[str, str] = {
            "A": "added",
            "M": "modified",
            "D": "deleted",
            "R": "renamed",
            "C": "copied",
            "T": "typechange",
        }

        entries: list[dict[str, object]] = []
        for line in name_status.stdout.splitlines():
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            # Rename and copy entries are ``R100\told\tnew``. The
            # status letter may be followed by a similarity number.
            code = parts[0][:1]
            if code in ("R", "C") and len(parts) >= 3:
                # Use the new path as the canonical entry path —
                # that's what the reviewer actually wants to see.
                path = self._unquote_porcelain_path(parts[2])
            else:
                path = self._unquote_porcelain_path(parts[1])

            entry_stats = stats.get(path, {"additions": 0, "deletions": 0})
            entries.append({
                "path": path,
                "status": status_names.get(code, "unknown"),
                "additions": entry_stats["additions"],
                "deletions": entry_stats["deletions"],
            })
        return entries

    def get_review_file_diff(
        self,
        path: str | Path,
        base_commit: str | None = None,
        head_commit: str | None = None,
    ) -> dict[str, str]:
        """Return the diff for a single file during review mode.

        Forward direction — ``base..head`` — so additions read as
        ``+`` and removals as ``-``, matching the convention in
        commit messages, GitHub PRs, and every other diff-rendering
        tool the LLM has seen during training. Reading "what did
        this branch add" against a forward diff is one mental
        model; against a reverse diff it's two (negate the sign,
        then interpret).

        When ``base_commit`` and ``head_commit`` are both supplied,
        runs ``git diff <base> <head> -- <path>`` against the
        object database. Working tree state is irrelevant — the
        diff is the same regardless of where ``HEAD`` currently
        sits or what's staged.

        When either is missing, falls back to ``git diff --cached``,
        which during the review's soft-reset state produces the
        reverse-direction patch. Kept as a defensive fallback so
        callers that don't yet thread the SHAs through (or that
        invoke this method outside the review entry sequence)
        produce *some* diff rather than an empty string.

        Parameters
        ----------
        path:
            Relative path to the file. Must be validated and inside
            the repo root — same rules as any other path-accepting
            method.
        base_commit:
            Full SHA of the review base (the merge-base, or the
            parent of the user-selected commit). Together with
            ``head_commit`` produces a forward diff.
        head_commit:
            Full SHA of the branch tip being reviewed.

        Returns
        -------
        dict
            ``{"path": "<path>", "diff": "<patch text>"}`` on success.
            Empty diff is returned as an empty string rather than an
            error — a file that's in the review but has no diff
            (e.g., only mode changes) is rare but legal.
        """
        self._validate_rel_path(path)
        rel = self._normalise_rel_path(path)
        if base_commit and head_commit:
            # Forward diff via the object database — independent
            # of working tree state.
            result = self._run_git(
                ["diff", base_commit, head_commit, "--", rel],
                check=True,
            )
        else:
            # Fallback for callers that haven't threaded SHAs
            # through yet. Reverse direction during a soft-reset
            # review, but at least non-empty.
            result = self._run_git(
                ["diff", "--cached", "--", rel],
                check=True,
            )
        return {"path": rel, "diff": result.stdout}