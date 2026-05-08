"""Repository-wide content search via git grep.

Extracted from ``src/ac_dc/repo.py``. See the parent module's
docstring for the overall design.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .errors import RepoError


class SearchMixin:
    """Repository-wide content search via git grep."""

    _root: Path

    def _run_git(self, args: list[str], **kwargs: Any) -> Any: ...  # type: ignore[empty-body]

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    def search_files(
        self,
        query: str,
        whole_word: bool = False,
        use_regex: bool = False,
        ignore_case: bool = True,
        context_lines: int = 1,
    ) -> list[dict[str, object]]:
        """Search tracked files with ``git grep``.

        Uses ``git grep`` rather than a pure-Python walk: git is
        already doing the heavy lifting (binary detection,
        gitignore respect, index awareness) and greps through
        thousands of files faster than Python can enumerate them.

        Parameters
        ----------
        query:
            Search text. Empty or whitespace-only returns an empty
            list — treated as "no query" rather than "match every
            line in the repo".
        whole_word:
            When True, adds ``--word-regexp`` so partial matches
            don't hit. Mirrors the VS-Code-style toggle in the UI.
        use_regex:
            When False (default), ``--fixed-strings`` is passed so
            regex metacharacters in the query are matched literally.
            When True, the query is interpreted as an extended
            regular expression.
        ignore_case:
            Defaults to True — case-insensitive is the friendlier
            default for code search. Disable when identifier casing
            matters.
        context_lines:
            Lines of context before and after each match. Applied
            via ``-C``. Zero is valid (match lines only). Negative
            values are clamped to zero.

        Returns
        -------
        list[dict]
            One entry per matching file:

            - ``file``: repo-relative path
            - ``matches``: list of match dicts, each with:
                - ``line_num``: 1-indexed line number
                - ``line``: text of the matching line
                - ``context_before``: list of
                  ``{line_num, line}`` for context lines before
                - ``context_after``: list of the same shape after
        """
        if not query or not query.strip():
            return []

        # Note: we do NOT pass --null. When --null is set, git grep
        # uses NUL for EVERY field separator and drops the ':' /
        # '-' distinction between match lines and context lines —
        # which makes context parsing impossible. The default
        # output uses ':' between path and linenum on match lines,
        # '-' on context lines. A pathological filename containing
        # ':' would confuse the parser, but that's vanishingly
        # rare in practice (and our _validate_rel_path already
        # rejects the worst offenders).
        args: list[str] = ["grep", "-n"]
        ctx = max(0, context_lines)
        if ctx:
            args.extend(["-C", str(ctx)])
        if ignore_case:
            args.append("--ignore-case")
        if whole_word:
            args.append("--word-regexp")
        if use_regex:
            args.append("--extended-regexp")
        else:
            args.append("--fixed-strings")
        # ``-e`` explicitly marks the pattern so a query starting
        # with ``-`` (e.g. ``--foo``) isn't mistaken for a flag.
        args.extend(["-e", query])

        result = self._run_git(args)
        # git grep exit code: 0 = matches found, 1 = no matches
        # (not an error), 2+ = actual error. Only raise on 2+.
        if result.returncode >= 2:
            stderr = (result.stderr or "").strip()
            raise RepoError(
                f"git grep failed: {stderr or 'unknown error'}"
            )
        if result.returncode == 1 or not result.stdout:
            return []

        return self._parse_grep_output(result.stdout, ctx)

    @staticmethod
    def _parse_grep_output(
        raw: str,
        context_lines: int,
    ) -> list[dict[str, object]]:
        """Parse ``git grep -n -C <ctx>`` output.

        Format (without ``--null``):

        - Match lines: ``path:linenum:text``
        - Context lines: ``path-linenum-text``
        - Group separators: a literal ``--`` between non-contiguous
          match groups (ignored here).

        The separator character (``:`` or ``-``) between path and
        linenum is ALSO the match-vs-context indicator, and the
        SAME character separates linenum from the text. This means
        paths containing hyphens (``chat-panel.js``,
        ``file-picker.js``, etc.) are deeply ambiguous — scanning
        for the first ``:`` or ``-`` would split at the first
        hyphen in the path, not at the path/linenum boundary.

        Disambiguation: the real path/linenum boundary is always
        followed by ``<digits><same-sep>``. We scan every
        candidate separator in the line and accept the first one
        whose continuation matches that pattern. This handles
        hyphenated paths correctly because a hyphen inside the
        path is followed by more path characters (letters, another
        hyphen, a dot), never by ``<digits>-``.

        Strategy: three passes, each small and obvious.

        1. Parse every grep output line into a tuple of
           (path, line_num, is_match, text).
        2. Group consecutive rows by file (preserving encounter
           order so results appear in git's pathspec order).
        3. For each file, walk its rows left-to-right. Each match
           collects at most ``context_lines`` non-match rows
           immediately before it as ``context_before``, and at
           most ``context_lines`` non-match rows immediately after
           it as ``context_after``. Rows between two matches are
           attributed to the later match's ``context_before`` and
           the earlier match's ``context_after`` symmetrically.
        """
        parsed: list[tuple[str, int, bool, str]] = []
        for line in raw.splitlines():
            if line == "--":
                continue
            # Find the first ``:`` or ``-`` whose continuation is
            # ``<digits><same-sep>``. Candidates earlier in the
            # line (e.g. a hyphen inside ``chat-panel.js``) fail
            # the continuation check and get skipped.
            path_end = -1
            sep_char = ""
            text_start = -1
            line_num = -1
            scan = 0
            while scan < len(line):
                ch = line[scan]
                if ch not in (":", "-"):
                    scan += 1
                    continue
                # Candidate separator at position `scan`. Check the
                # continuation: one or more digits, then the same
                # separator character again.
                digit_end = scan + 1
                while digit_end < len(line) and line[digit_end].isdigit():
                    digit_end += 1
                if digit_end == scan + 1:
                    # No digits followed the separator — not a
                    # real path/linenum boundary.
                    scan += 1
                    continue
                if digit_end >= len(line) or line[digit_end] != ch:
                    # Digits not followed by a matching separator.
                    scan += 1
                    continue
                # Valid boundary found.
                path_end = scan
                sep_char = ch
                try:
                    line_num = int(line[scan + 1:digit_end])
                except ValueError:
                    scan += 1
                    continue
                text_start = digit_end + 1
                break
            if path_end <= 0 or line_num < 0:
                # No valid boundary or empty path — skip.
                continue
            path = line[:path_end]
            is_match = sep_char == ":"
            text = line[text_start:]
            parsed.append((path, line_num, is_match, text))

        # Group by file, preserving order.
        file_order: list[str] = []
        file_rows: dict[str, list[tuple[int, bool, str]]] = {}
        for path, line_num, is_match, text in parsed:
            if path not in file_rows:
                file_order.append(path)
                file_rows[path] = []
            file_rows[path].append((line_num, is_match, text))

        output: list[dict[str, object]] = []
        for path in file_order:
            rows = file_rows[path]
            matches: list[dict[str, object]] = []
            for idx, (line_num, is_match, text) in enumerate(rows):
                if not is_match:
                    continue
                # Context before: walk backwards from idx-1, collect
                # up to context_lines non-match rows. Stop at a
                # match — earlier matches have their own entry.
                before: list[dict[str, object]] = []
                j = idx - 1
                while j >= 0 and len(before) < context_lines:
                    prev_num, prev_is_match, prev_text = rows[j]
                    if prev_is_match:
                        break
                    before.append({"line_num": prev_num, "line": prev_text})
                    j -= 1
                before.reverse()  # chronological order
                # Context after: walk forwards from idx+1, symmetric.
                after: list[dict[str, object]] = []
                j = idx + 1
                while j < len(rows) and len(after) < context_lines:
                    next_num, next_is_match, next_text = rows[j]
                    if next_is_match:
                        break
                    after.append({"line_num": next_num, "line": next_text})
                    j += 1
                matches.append({
                    "line_num": line_num,
                    "line": text,
                    "context_before": before,
                    "context_after": after,
                })
            if matches:
                output.append({"file": path, "matches": matches})
        return output