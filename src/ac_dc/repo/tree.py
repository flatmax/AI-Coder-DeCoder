"""File tree construction with status and diff overlay.

Extracted from ``src/ac_dc/repo.py``. See the parent module's
docstring for the overall design.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .errors import BINARY_PROBE_BYTES


class TreeMixin:
    """File tree construction with status and diff overlay."""

    _root: Path

    @staticmethod
    def _is_binary_bytes(data: bytes) -> bool: ...  # type: ignore[empty-body]
    def _run_git(self, args: list[str], **kwargs: Any) -> Any: ...  # type: ignore[empty-body]

    # ------------------------------------------------------------------
    # File tree and flat listing
    # ------------------------------------------------------------------

    def get_flat_file_list(self) -> str:
        """Return a sorted newline-separated list of all repo files.

        Combines tracked files (``git ls-files``) with untracked
        non-ignored files (``git ls-files --others --exclude-standard``).
        Used as the file-tree section in LLM prompts — flat, one per
        line, no tree indentation.

        Returns an empty string when the repo has no files (fresh
        init, no commits, nothing untracked).
        """
        tracked = self._run_git(
            ["ls-files"],
            check=True,
        ).stdout.splitlines()
        untracked = self._run_git(
            ["ls-files", "--others", "--exclude-standard"],
            check=True,
        ).stdout.splitlines()
        all_files = sorted(set(tracked) | set(untracked))
        return "\n".join(all_files)

    def _count_lines(self, absolute: Path) -> int:
        """Count newlines in a file for the tree-line-count badge.

        Returns 0 for binary files (no useful line count for them)
        and for any file we can't read. Used by the file picker to
        colour-code files by size.
        """
        try:
            with absolute.open("rb") as fh:
                probe = fh.read(BINARY_PROBE_BYTES)
                if self._is_binary_bytes(probe):
                    return 0
                # Count newlines across the whole file, streaming
                # in chunks so we don't load huge files into memory.
                count = probe.count(b"\n")
                while True:
                    chunk = fh.read(65536)
                    if not chunk:
                        break
                    count += chunk.count(b"\n")
                return count
        except OSError:
            return 0

    def _probe_is_binary(self, absolute: Path) -> bool:
        """Return True when the file looks binary at the head.

        Mirrors :meth:`_count_lines`'s probe: we sniff the first
        ``BINARY_PROBE_BYTES`` and ask the shared classifier. Used
        by :meth:`get_file_tree` to tag file nodes so the webapp
        picker can disable their checkboxes (binary files can't be
        sent to the LLM, so toggling them on selection is futile).

        Errors fall back to "not binary" — the picker will accept
        the file, the backend's binary trim at sync time will catch
        it, and the user gets the existing toast warning.
        """
        try:
            with absolute.open("rb") as fh:
                probe = fh.read(BINARY_PROBE_BYTES)
                return self._is_binary_bytes(probe)
        except OSError:
            return False

    @staticmethod
    def _unquote_porcelain_path(raw: str) -> str:
        """Strip git porcelain quoting from a single path segment.

        Git wraps paths containing special characters (spaces,
        non-ASCII, control chars) in double quotes with backslash
        escapes. We reverse that for display. For plain paths, the
        input is returned unchanged.

        The full escape grammar is more elaborate (octal escapes
        for arbitrary bytes), but we hit the common 99% case: the
        quotes themselves, tabs, newlines, and backslashes. Paths
        with truly exotic bytes will display slightly mangled but
        won't corrupt the UI.
        """
        if len(raw) < 2 or raw[0] != '"' or raw[-1] != '"':
            return raw
        # Strip enclosing quotes.
        inner = raw[1:-1]
        # Reverse common backslash escapes. Order matters — unescape
        # \\ last so we don't turn an escaped backslash back into a
        # meaningful escape.
        inner = (
            inner
            .replace(r"\t", "\t")
            .replace(r"\n", "\n")
            .replace(r"\"", '"')
            .replace(r"\\", "\\")
        )
        return inner

    def _parse_porcelain_status(
        self,
        raw: str,
    ) -> tuple[list[str], list[str], list[str], list[str]]:
        """Parse ``git status --porcelain`` output into four path lists.

        Returns ``(modified, staged, untracked, deleted)``. Each is
        a list of repo-relative paths. Rename entries (``R``) are
        expanded into both the old and new paths in the staged list.

        Porcelain format is ``XY path`` where X is the index
        status and Y is the worktree status. We classify each entry
        by both characters — a modified file may be simultaneously
        staged and unstaged, and both lists include it.
        """
        modified: list[str] = []
        staged: list[str] = []
        untracked: list[str] = []
        deleted: list[str] = []

        for line in raw.splitlines():
            if len(line) < 3:
                continue
            x, y, rest = line[0], line[1], line[3:]

            # Untracked files: "?? path".
            if x == "?" and y == "?":
                untracked.append(self._unquote_porcelain_path(rest))
                continue

            # Rename / copy entries: "R  old -> new". Both sides
            # may be individually quoted (the old git behaviour)
            # so we split on the arrow, then unquote each segment.
            if x in ("R", "C") and " -> " in rest:
                old_raw, new_raw = rest.split(" -> ", 1)
                old_path = self._unquote_porcelain_path(old_raw)
                new_path = self._unquote_porcelain_path(new_raw)
                staged.append(old_path)
                staged.append(new_path)
                continue

            path = self._unquote_porcelain_path(rest)

            # Index status (X) — changes staged for commit.
            if x in ("M", "A", "D", "T"):
                staged.append(path)
                if x == "D":
                    deleted.append(path)

            # Worktree status (Y) — unstaged changes.
            if y == "M" or y == "T":
                modified.append(path)
            elif y == "D":
                deleted.append(path)

        return modified, staged, untracked, deleted

    def _parse_numstat(self, raw: str) -> dict[str, dict[str, int]]:
        """Parse ``git diff --numstat`` output into per-file stats.

        Each output line is ``<added>\\t<deleted>\\t<path>``. Binary
        files report ``-`` for both counts — we map those to 0
        because the file picker has no meaningful way to display
        "binary diff stats" in an addition/deletion badge.
        """
        stats: dict[str, dict[str, int]] = {}
        for line in raw.splitlines():
            if not line:
                continue
            parts = line.split("\t", 2)
            if len(parts) != 3:
                continue
            added_raw, deleted_raw, path = parts
            added = 0 if added_raw == "-" else int(added_raw or 0)
            deleted = 0 if deleted_raw == "-" else int(deleted_raw or 0)
            path = self._unquote_porcelain_path(path)
            stats[path] = {"additions": added, "deletions": deleted}
        return stats

    def get_file_tree(self) -> dict[str, object]:
        """Return the full file tree with git status and diff stats.

        Shape:

        - ``tree``: nested node structure rooted at the repo name.
          Each node is a dict with ``name``, ``path``, ``type``
          (``"file"`` or ``"dir"``), ``lines`` (int, 0 for binary
          and directories), ``mtime`` (float, files only),
          ``children`` (list, directories only).
        - ``modified``, ``staged``, ``untracked``, ``deleted``:
          lists of repo-relative paths from porcelain status.
        - ``diff_stats``: ``{path: {"additions": int, "deletions":
          int}}`` merged across staged and unstaged diffs.

        Ignored files never appear in the tree — we build the file
        set from ``git ls-files`` (tracked) plus
        ``git ls-files --others --exclude-standard`` (untracked,
        non-ignored). Binary files appear with ``lines: 0``.

        Root node name matches the repo root's basename, so the UI
        can display it as the tree root header.
        """
        # Candidate file set: tracked ∪ untracked (non-ignored).
        tracked = set(
            self._run_git(["ls-files"], check=True).stdout.splitlines()
        )
        untracked_raw = self._run_git(
            ["ls-files", "--others", "--exclude-standard"],
            check=True,
        ).stdout.splitlines()
        all_files = sorted(tracked | set(untracked_raw))

        # Status — the four classification lists.
        status_result = self._run_git(
            ["status", "--porcelain"],
            check=True,
        )
        modified, staged, untracked, deleted = self._parse_porcelain_status(
            status_result.stdout
        )

        # Diff stats — staged and unstaged. We merge additions and
        # deletions across both so the picker shows the total churn
        # per file. Staged numbers take precedence when a file
        # appears in both (which happens for partially-staged edits).
        staged_stats = self._parse_numstat(
            self._run_git(
                ["diff", "--cached", "--numstat"],
                check=True,
            ).stdout
        )
        unstaged_stats = self._parse_numstat(
            self._run_git(
                ["diff", "--numstat"],
                check=True,
            ).stdout
        )
        diff_stats: dict[str, dict[str, int]] = {}
        for source in (unstaged_stats, staged_stats):
            for path, entry in source.items():
                existing = diff_stats.setdefault(
                    path, {"additions": 0, "deletions": 0}
                )
                existing["additions"] += entry["additions"]
                existing["deletions"] += entry["deletions"]

        # Build the nested tree. We walk each file path, creating
        # directory nodes on demand in a dict keyed by path. The
        # root node is the repo name. Deleted files are intentionally
        # included in the tree — the picker shows them with a deleted
        # badge so users can recover them. They don't appear in
        # ``all_files`` (neither tracked nor untracked lists them),
        # so we add them explicitly.
        tree_files = sorted(set(all_files) | set(deleted))

        root: dict[str, object] = {
            "name": self._root.name,
            "path": "",
            "type": "dir",
            "lines": 0,
            "children": [],
        }
        # Index: relative-path string → node dict. Lets us reuse
        # directory nodes when multiple files share ancestors
        # without re-searching the tree.
        index: dict[str, dict[str, object]] = {"": root}

        for rel_path in tree_files:
            # Build up directory nodes for every ancestor.
            parts = rel_path.split("/")
            parent_path = ""
            for depth in range(len(parts) - 1):
                dir_name = parts[depth]
                dir_path = "/".join(parts[: depth + 1])
                if dir_path not in index:
                    dir_node: dict[str, object] = {
                        "name": dir_name,
                        "path": dir_path,
                        "type": "dir",
                        "lines": 0,
                        "children": [],
                    }
                    index[dir_path] = dir_node
                    # Parent's children is always a list — type
                    # narrowed here to satisfy the type checker.
                    parent_children = index[parent_path]["children"]
                    assert isinstance(parent_children, list)
                    parent_children.append(dir_node)
                parent_path = dir_path

            # Build the leaf file node. Line counts and mtimes are
            # best-effort — a file that exists at porcelain time but
            # vanishes before we stat it just gets a zero.
            absolute = self._root / rel_path
            lines = 0
            mtime = 0.0
            is_binary = False
            if absolute.is_file():
                is_binary = self._probe_is_binary(absolute)
                lines = 0 if is_binary else self._count_lines(absolute)
                try:
                    mtime = absolute.stat().st_mtime
                except OSError:
                    mtime = 0.0
            file_node: dict[str, object] = {
                "name": parts[-1],
                "path": rel_path,
                "type": "file",
                "lines": lines,
                "mtime": mtime,
                "is_binary": is_binary,
            }
            parent_children = index[parent_path]["children"]
            assert isinstance(parent_children, list)
            parent_children.append(file_node)

        # Sort each directory's children alphabetically, directories
        # before files. The picker does its own sort for mtime/size
        # modes, but alphabetical is a stable default.
        def _sort_children(node: dict[str, object]) -> None:
            children = node.get("children")
            if not isinstance(children, list):
                return
            children.sort(
                key=lambda n: (n["type"] != "dir", n["name"]),
            )
            for child in children:
                _sort_children(child)

        _sort_children(root)

        return {
            "tree": root,
            "modified": modified,
            "staged": staged,
            "untracked": untracked,
            "deleted": deleted,
            "diff_stats": diff_stats,
        }