"""File context — in-memory cache of selected file contents.

Holds the files the user has checked in the file picker. Each
entry maps a repo-relative path to its text content. The
prompt assembler consumes this to build the "Working Files"
section of every LLM request.

Design points pinned by specs4/3-llm/context-model.md:

- **Insertion-order preservation.** The selection order drives
  the rendering order — a user who selects A then B expects A
  to appear first in the prompt. Python dicts preserve insertion
  order (3.7+), so we get this for free from a plain ``dict``.

- **Path normalisation.** Keys are canonical
  forward-slash / no-wrapping-slash / no-parent-traversal
  strings, matching :meth:`ac_dc.repo.Repo._normalise_rel_path`.
  Duplicated here (rather than imported) so the module is
  constructable without a ``Repo`` instance — simplifies tests
  and avoids a downstream module dependency.

- **Binary rejection delegates to the repo layer.** This module
  never reads files itself; it asks a supplied :class:`Repo`
  instance via ``get_file_content`` which already blocks binary
  files (null-byte scan) and path traversal. Keeps
  responsibility in one place.

- **Fenced prompt output, no language tag.**
  specs4/3-llm/prompt-assembly.md#file-content-formatting is
  explicit — the LLM sees path, newline, triple-backtick,
  newline, content, newline, triple-backtick, with no language
  hint on the fence. Downstream models don't need the hint
  (they can infer) and adding one would tempt the LLM to
  respect syntax constraints we can't verify.

- **Tokens computed on demand.** No caching. The
  :class:`~ac_dc.token_counter.TokenCounter` is cheap; caching
  would require invalidation on every update and is not worth
  the complexity.

Not thread-safe. The orchestrator drives file-context updates
from a single executor; concurrent add/remove from multiple
threads is out of scope.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ac_dc.repo import Repo
    from ac_dc.token_counter import TokenCounter

logger = logging.getLogger(__name__)


def _normalise_rel_path(path: str) -> str:
    """Return the canonical key form of a relative path.

    Matches :meth:`ac_dc.repo.Repo._normalise_rel_path` so two
    paths with different spellings (``src\\file.py`` on Windows
    input vs ``src/file.py``) collide on the same key.

    Raises :class:`ValueError` for paths with ``..`` segments —
    the file context never stores traversal attempts. Actual
    filesystem-level containment checks happen in the repo
    layer before content ever reaches here; this is a cheap
    second guard for callers that bypass the repo (e.g. tests
    passing content directly).
    """
    s = str(path).replace("\\", "/").strip("/")
    if not s:
        raise ValueError("Empty path")
    segments = s.split("/")
    if any(seg == ".." for seg in segments):
        raise ValueError(f"Path traversal not allowed: {path!r}")
    return s


class FileContext:
    """In-memory cache of path → content for selected files.

    Construction optionally takes a :class:`Repo` reference. When
    supplied, :meth:`add_file` can read content from disk when
    called with a path alone. Without a repo, callers must always
    provide explicit content — useful for tests and for any
    future non-git backend.
    """

    def __init__(self, repo: "Repo | None" = None) -> None:
        self._repo = repo
        # Plain dict — insertion order is what we want.
        self._files: dict[str, str] = {}

    # ------------------------------------------------------------------
    # Mutation
    # ------------------------------------------------------------------

    def add_file(
        self,
        path: str,
        content: str | None = None,
    ) -> None:
        """Add or update a file in the context.

        When ``content`` is None, the repo is consulted to read
        the working-copy content. Callers that already have the
        content (e.g. after an RPC that provided it) pass it
        directly to avoid a redundant disk read.

        Re-adding an existing path updates the content in place.
        The file's position in iteration order is preserved — a
        re-read doesn't move it to the end of the selection.
        Callers that want "move to end" semantics should remove
        then add.

        Parameters
        ----------
        path:
            Repo-relative path. Normalised via
            :func:`_normalise_rel_path`.
        content:
            Optional explicit content. When omitted, the
            attached :class:`Repo` reads from disk. If no repo
            is attached, a ValueError is raised.

        Raises
        ------
        ValueError
            Path is empty or contains ``..`` segments, OR
            content is None and no repo is attached.
        RepoError
            Repo-level failure — binary file, missing file,
            path-traversal attempt detected at the repo layer.
            Propagated verbatim so callers see the exact cause.
        """
        key = _normalise_rel_path(path)
        if content is None:
            if self._repo is None:
                raise ValueError(
                    f"add_file({path!r}) without content requires "
                    f"a Repo; FileContext was constructed without one"
                )
            # Repo.get_file_content does the binary rejection,
            # traversal check, and encoding handling. Any failure
            # propagates (RepoError or similar).
            content = self._repo.get_file_content(key)
        # dict.__setitem__ preserves existing insertion order
        # when the key is already present — matches our contract.
        self._files[key] = content

    def remove_file(self, path: str) -> bool:
        """Remove a file from the context.

        Returns True if the file was present, False if absent.
        Matches :meth:`~ac_dc.base_cache.BaseCache.invalidate`
        so call sites that toggle membership can use a uniform
        shape.

        Never raises on missing files — the "remove if present"
        idiom is common enough that a silent no-op is useful.
        """
        key = _normalise_rel_path(path)
        return self._files.pop(key, None) is not None

    def clear(self) -> None:
        """Drop every file from the context."""
        self._files.clear()

    # ------------------------------------------------------------------
    # Query
    # ------------------------------------------------------------------

    def has_file(self, path: str) -> bool:
        """Return True if the given path is in the context."""
        try:
            key = _normalise_rel_path(path)
        except ValueError:
            # Traversal attempts or empty paths just aren't in
            # the context — no need to raise from a predicate.
            return False
        return key in self._files

    def get_content(self, path: str) -> str | None:
        """Return the content for a path, or None if not in context.

        Used by the prompt assembler when it needs a specific
        file's content without iterating the full list.
        Returning None rather than raising matches the
        dict-like ``.get()`` convention and avoids forcing
        callers into try/except for the common "is this file
        selected" check.
        """
        try:
            key = _normalise_rel_path(path)
        except ValueError:
            return None
        return self._files.get(key)

    def get_files(self) -> list[str]:
        """Return the list of paths in insertion order.

        Returns a copy — mutating it doesn't affect the context.
        The insertion order matches the selection order the
        user sees in the file picker, which is also the order
        the prompt assembler renders the "Working Files"
        section.
        """
        return list(self._files.keys())

    def __len__(self) -> int:
        """Return the number of files in the context."""
        return len(self._files)

    def __contains__(self, path: str) -> bool:
        """Support ``path in file_context`` syntax."""
        return self.has_file(path)

    # ------------------------------------------------------------------
    # Prompt rendering
    # ------------------------------------------------------------------

    def format_for_prompt(self) -> str:
        """Render every file as a fenced block, joined by blank lines.

        Output shape per file::

            path/to/file.py
            ```
            <content>
            ```

        No language tag on the fence — specs4 is explicit about
        this. Files are rendered in insertion order. Empty
        context returns an empty string so callers can skip
        the section cleanly when nothing is selected.

        The assembler concatenates this into the "Working Files"
        section header defined by specs4/3-llm/prompt-assembly.md.
        """
        if not self._files:
            return ""
        blocks: list[str] = []
        for path, content in self._files.items():
            blocks.append(f"{path}\n```\n{content}\n```")
        return "\n\n".join(blocks)

    # ------------------------------------------------------------------
    # Token accounting
    # ------------------------------------------------------------------

    def count_tokens(self, counter: "TokenCounter") -> int:
        """Total tokens across every file's fenced representation.

        Uses :meth:`format_for_prompt` rather than summing
        per-file counts because the fence syntax itself
        contributes tokens. Budget decisions downstream need
        the count the LLM actually sees, not the raw content
        count.
        """
        return counter.count(self.format_for_prompt())

    def get_tokens_by_file(
        self,
        counter: "TokenCounter",
    ) -> dict[str, int]:
        """Per-file token counts for the context-breakdown RPC.

        Returns a dict mapping path → tokens. Sums here don't
        equal :meth:`count_tokens` — per-file counts skip the
        inter-file separators and fence tokens from adjacent
        blocks. Good enough for the viewer's breakdown chart;
        callers that need the total use :meth:`count_tokens`.
        """
        return {
            path: counter.count(f"{path}\n```\n{content}\n```")
            for path, content in self._files.items()
        }