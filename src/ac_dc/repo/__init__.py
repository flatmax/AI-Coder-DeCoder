"""Repository layer.

Wraps a single git repository with file I/O, git operations, tree
listing, search, and review-mode orchestration. Exposed to the
browser via RPC and used internally by the LLM context engine.

Governing spec: ``specs4/1-foundation/repository.md``.

This package was split out of a single ``repo.py`` module. Each
sub-module contributes a mixin class holding a coherent group of
methods; ``Repo`` here composes them into the single concrete
class that the rest of the codebase imports.

The mixin layout is purely organisational — every mixin shares
the same ``self`` and the same private state (``self._root``,
``self._write_locks``, ``self._collab``, ``self._post_write_callback``)
set up in :meth:`Repo.__init__`. Method dispatch is unchanged from
the pre-split monolith.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable

from .errors import RepoError
from .paths import PathMixin
from .locks import LocksMixin
from .subprocess_runner import SubprocessMixin
from .files import FilesMixin
from .staging import StagingMixin
from .diffs import DiffsMixin
from .commits import CommitsMixin
from .branches import BranchesMixin
from .commit_graph import CommitGraphMixin
from .tree import TreeMixin
from .review import ReviewMixin
from .search import SearchMixin
from .tex_preview import TexPreviewMixin

logger = logging.getLogger(__name__)


class Repo(
    PathMixin,
    LocksMixin,
    SubprocessMixin,
    FilesMixin,
    StagingMixin,
    DiffsMixin,
    CommitsMixin,
    BranchesMixin,
    CommitGraphMixin,
    TreeMixin,
    ReviewMixin,
    SearchMixin,
    TexPreviewMixin,
):
    """Wraps a single git repository.

    Construction validates that ``repo_root`` exists, is a directory,
    and contains a ``.git`` entry (directory or file — git worktrees
    use a file). All API methods take paths relative to the repo
    root.

    Per-path write serialisation is provided by an internal lock map.
    The lock is an asyncio primitive, so write methods are ``async``.
    Read methods are synchronous — file reads don't contend and
    forcing callers to ``await`` them would add noise.
    """

    def __init__(self, repo_root: Path | str) -> None:
        """Initialise the repository wrapper.

        Parameters
        ----------
        repo_root:
            Absolute or relative path to the repository root. Resolved
            to an absolute path during construction; callers can pass
            anything that resolves to a real directory.

        Raises
        ------
        RepoError
            If the path doesn't exist, isn't a directory, or doesn't
            contain a ``.git`` entry.
        """
        root = Path(repo_root).resolve()
        if not root.exists():
            raise RepoError(f"Repository path does not exist: {root}")
        if not root.is_dir():
            raise RepoError(f"Repository path is not a directory: {root}")
        git_entry = root / ".git"
        if not git_entry.exists():
            raise RepoError(
                f"Not a git repository (no .git entry at {root})"
            )
        self._root = root
        # Per-path write locks, keyed by normalised relative path
        # string. Created on demand by :meth:`_get_write_lock`. Kept
        # in a plain dict — WeakValueDictionary would be neater but
        # asyncio.Lock instances don't support weakrefs without a
        # wrapper class. The map grows with the set of ever-written
        # paths during a session; a long-lived server writing millions
        # of distinct paths would see the map grow unboundedly, but
        # in practice sessions touch a few hundred paths at most.
        import asyncio
        self._write_locks: dict[str, asyncio.Lock] = {}
        # Collaboration reference — set by main.py when collab mode
        # is active, None otherwise. When None, every caller is
        # treated as localhost (single-user operation). When set,
        # mutating methods consult :meth:`Collab.is_caller_localhost`
        # to enforce specs4/4-features/collaboration.md's
        # "participants can browse but not mutate" policy.
        self._collab: Any = None
        # Post-write callback — set by main.py to
        # ``LLMService._on_doc_file_written``. Fired after every
        # successful write/create/rename that produces a file at
        # a path. The callback decides whether the path is
        # interesting (doc-index-eligible, correct mode) and
        # kicks off invalidation + re-extract + enrichment.
        # Fired outside the per-path write lock so a slow
        # enrichment scheduler can't block further writes.
        # Never raises back into the caller — the callback
        # wraps its own work in try/except so a bug in the
        # enrichment path can't turn a successful write into
        # a write-then-error for the user.
        self._post_write_callback: (
            "Callable[[str], None] | None"
        ) = None

    def _check_localhost_only(self) -> dict[str, Any] | None:
        """Return an error dict when the caller is non-localhost.

        Returns None when the call is allowed (single-user mode, or
        collaboration mode with a localhost caller). Returns the
        specs4-mandated restriction error shape when the caller is
        a non-localhost participant — mutating methods return this
        dict verbatim to their RPC caller, the frontend's RpcMixin
        surfaces it as a ``restricted`` error and hides the UI
        affordance that triggered the call.

        The error shape is ``{"error": "restricted", "reason": ...}``
        — matches specs4/1-foundation/communication-layer.md#restricted-operations.
        """
        if self._collab is None:
            return None
        try:
            is_local = self._collab.is_caller_localhost()
        except Exception as exc:
            # Defensive — if the collab check itself fails, fail
            # closed. Better to reject a legitimate call than to
            # silently allow a mutation from an unknown caller.
            logger.warning(
                "Collab localhost check raised: %s; denying",
                exc,
            )
            return {
                "error": "restricted",
                "reason": (
                    "Internal error checking caller identity"
                ),
            }
        if is_local:
            return None
        return {
            "error": "restricted",
            "reason": (
                "Participants cannot perform this action"
            ),
        }

    @property
    def root(self) -> Path:
        """Absolute path to the repository root."""
        return self._root

    @property
    def name(self) -> str:
        """Repository name (basename of the root path).

        Used for the browser tab title and for display in the file
        tree. Defaults to the root directory's name — the user's repo
        folder name — which is stable across checkouts and matches
        what ``git clone`` produced.
        """
        return self._root.name


__all__ = ["Repo", "RepoError"]