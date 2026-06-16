"""MATLAB / Octave symbol extractor (regex-based, no tree-sitter).

MATLAB has no maintained tree-sitter grammar, so this extractor
declares ``tree_optional = True`` and works directly from the
raw source bytes. The orchestrator (Layer 2.7) passes
``tree=None`` to such extractors; we ignore it and scan the
decoded text line by line.

Produces the same :class:`~ac_dc.symbol_index.models.FileSymbols`
shape as the tree-sitter extractors. Handles, per
``specs4/2-indexing/symbol-index.md#matlab-extractor-specifics``:

- ``classdef`` with inheritance (``classdef C < Base1 & Base2``)
- ``function`` definitions — with or without output args; a
  function inside a ``classdef`` body becomes a method
- ``import`` statements
- top-level variable assignments
- call sites inside function bodies
- a large builtin exclusion list filtering common MATLAB
  functions from call-site detection
- ``end`` nesting tracked for block scoping (so we know when a
  ``classdef`` body or ``function`` body closes)

This is line-and-regex based, not a full parser. It tolerates
the common cases and degrades gracefully on exotic syntax —
unrecognised lines simply contribute no symbols. Ranges are
0-indexed to match the model convention; block end positions
are computed from the matching ``end``.

Governing spec: ``specs4/2-indexing/symbol-index.md#per-language-extractors``.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from ac_dc.symbol_index.extractors.base import BaseExtractor
from ac_dc.symbol_index.models import (
    CallSite,
    FileSymbols,
    Import,
    Parameter,
    Symbol,
)

if TYPE_CHECKING:
    import re as _re
    import tree_sitter


# MATLAB language-level names and pervasive builtins. Filtered
# from call-site extraction — they're not user-code cross-file
# references. Kept reasonably broad (the spec calls for a "large
# builtin exclusion list") but not exhaustive; the reference
# index filters further downstream.
_MATLAB_BUILTINS = frozenset({
    # Control / keywords that can look like calls.
    "if", "elseif", "else", "end", "for", "parfor", "while",
    "switch", "case", "otherwise", "break", "continue", "return",
    "function", "classdef", "properties", "methods", "events",
    "enumeration", "try", "catch", "global", "persistent",
    "import", "spmd", "arguments",
    # Constants.
    "true", "false", "pi", "Inf", "inf", "NaN", "nan", "eps",
    "nargin", "nargout", "varargin", "varargout",
    # Ubiquitous builtins.
    "disp", "fprintf", "printf", "sprintf", "error", "warning",
    "assert", "size", "length", "numel", "ndims", "isempty",
    "zeros", "ones", "eye", "rand", "randn", "linspace", "reshape",
    "repmat", "cat", "horzcat", "vertcat", "sort", "unique",
    "find", "any", "all", "sum", "prod", "cumsum", "cumprod",
    "min", "max", "mean", "median", "std", "var", "abs", "sqrt",
    "exp", "log", "log2", "log10", "sin", "cos", "tan", "floor",
    "ceil", "round", "mod", "rem", "fix", "sign",
    "double", "single", "int8", "int16", "int32", "int64",
    "uint8", "uint16", "uint32", "uint64", "char", "logical",
    "cell", "struct", "isa", "class", "isnumeric", "ischar",
    "iscell", "isstruct", "isfield", "fieldnames", "strcmp",
    "strcmpi", "strrep", "strsplit", "strjoin", "strtrim",
    "num2str", "str2num", "str2double", "mat2str", "regexp",
    "regexprep", "cellfun", "arrayfun", "structfun", "feval",
    "exist", "func2str", "str2func", "containers",
    "fopen", "fclose", "fread", "fwrite", "fgetl", "fgets",
    "plot", "figure", "hold", "xlabel", "ylabel", "title",
    "legend", "axis", "subplot", "close", "clf", "drawnow",
    "tic", "toc", "clc", "clear", "clearvars", "who", "whos",
})


# Line patterns. Anchored to the start (after optional leading
# whitespace) so we don't match keywords appearing mid-expression.
_RE_CLASSDEF = re.compile(
    r"^\s*classdef\s+"
    r"(?:\([^)]*\)\s*)?"          # optional (Attribute=...) block
    r"(?P<name>[A-Za-z]\w*)"
    r"(?:\s*<\s*(?P<bases>[^%\n]+))?"
)
_RE_FUNCTION = re.compile(
    r"^\s*function\s+"
    # Optional output: ``out =`` or ``[a, b] =``.
    r"(?:(?:\[[^\]]*\]|[A-Za-z]\w*)\s*=\s*)?"
    r"(?P<name>[A-Za-z]\w*)"
    r"\s*(?:\((?P<params>[^)]*)\))?"
)
_RE_IMPORT = re.compile(
    r"^\s*import\s+(?P<target>[A-Za-z]\w*(?:\.[A-Za-z*]\w*)*)"
)
# Block-openers that consume an ``end``. ``classdef`` and
# ``function`` are tracked separately; this set is everything
# else that nests.
_RE_BLOCK_OPENER = re.compile(
    r"^\s*(?:if|for|parfor|while|switch|try|properties|methods|"
    r"events|enumeration|arguments|spmd)\b"
)
_RE_END = re.compile(r"^\s*end\b\s*;?\s*$")
# Top-level / function-body assignment: ``name = expr`` (not
# ``==`` / ``<=`` etc., and not an indexed/field LHS).
_RE_ASSIGN = re.compile(
    r"^\s*(?P<name>[A-Za-z]\w*)\s*=\s*(?!=)"
)
# Identifier-followed-by-`(` — a call or an index. We record it
# as a call site; the builtin filter removes language noise.
_RE_CALL = re.compile(r"(?<![\w.])(?P<name>[A-Za-z]\w*)\s*\(")


def _strip_comment(line: str) -> str:
    """Drop a trailing line comment.

    MATLAB uses ``%`` for comments. ``%`` inside a char/string
    literal is rare in the constructs we scan, so a naive chop
    at the first ``%`` is good enough for symbol extraction.
    """
    idx = line.find("%")
    if idx == -1:
        return line
    return line[:idx]


class MatlabExtractor(BaseExtractor):
    """Regex-based MATLAB / Octave symbol extractor.

    Stateless across calls. ``tree_optional = True`` tells the
    orchestrator to pass ``tree=None`` and rely on raw source.
    """

    language = "matlab"
    tree_optional = True

    def extract(
        self,
        tree: "tree_sitter.Tree | None",
        source: bytes,
        path: str,
    ) -> FileSymbols:
        # tree is always None for this extractor — ignore it.
        _ = tree
        text = source.decode("utf-8", errors="replace")
        lines = text.split("\n")

        result = FileSymbols(file_path=path)
        self._path = path

        self._scan(lines, result)
        return result

    # ------------------------------------------------------------------
    # Top-level scan
    # ------------------------------------------------------------------

    def _scan(self, lines: list[str], result: FileSymbols) -> None:
        """Walk lines once, dispatching by construct.

        A MATLAB file is either a script (top-level statements,
        possibly with local functions) or a ``classdef`` file.
        Both are handled:

        - ``classdef`` opens a class; its inner blocks nest, and
          ``function`` lines inside its ``methods`` body become
          methods of the class.
        - top-level ``function`` lines (script / function files)
          become free functions.
        - assignments outside any function/class become
          top-level variables.
        """
        n = len(lines)
        i = 0

        while i < n:
            raw = lines[i]
            line = _strip_comment(raw)
            stripped = line.strip()

            if not stripped:
                i += 1
                continue

            m_class = _RE_CLASSDEF.match(line)
            if m_class is not None:
                cls, consumed = self._consume_classdef(
                    lines, i, m_class
                )
                if cls is not None:
                    result.symbols.append(cls)
                i += consumed
                continue

            m_func = _RE_FUNCTION.match(line)
            if m_func is not None:
                func, consumed = self._consume_function(
                    lines, i, m_func, is_method=False
                )
                if func is not None:
                    result.symbols.append(func)
                i += consumed
                continue

            m_import = _RE_IMPORT.match(line)
            if m_import is not None:
                result.imports.append(
                    Import(
                        module=m_import.group("target"),
                        line=i + 1,
                    )
                )
                i += 1
                continue

            m_assign = _RE_ASSIGN.match(line)
            if m_assign is not None:
                var = self._build_top_level_variable(m_assign, i)
                if var is not None:
                    result.symbols.append(var)
                i += 1
                continue

            i += 1

    # ------------------------------------------------------------------
    # classdef
    # ------------------------------------------------------------------

    def _consume_classdef(
        self,
        lines: list[str],
        start: int,
        match: "_re.Match[str]",
    ) -> tuple[Symbol | None, int]:
        """Build a class Symbol from a ``classdef`` block.

        Returns ``(symbol, lines_consumed)``. Scans from the
        ``classdef`` line to its matching ``end``, collecting
        bases from the heritage clause and methods from
        ``function`` lines inside the body. Nested
        ``properties`` / ``methods`` / ``if`` etc. raise the
        depth counter; the class closes when depth returns to 0.
        """
        name = match.group("name")
        bases = self._parse_bases(match.group("bases"))

        sym = Symbol(
            name=name,
            kind="class",
            file_path=self._path,
            bases=bases,
        )

        depth = 1  # the classdef itself
        n = len(lines)
        i = start + 1
        while i < n and depth > 0:
            line = _strip_comment(lines[i])
            stripped = line.strip()
            if not stripped:
                i += 1
                continue

            m_func = _RE_FUNCTION.match(line)
            if m_func is not None:
                method, consumed = self._consume_function(
                    lines, i, m_func, is_method=True
                )
                if method is not None:
                    sym.children.append(method)
                    if method.name == name:
                        # Constructor (MATLAB convention: method
                        # named like the class). Its body's
                        # ``obj.x = ...`` assignments are the
                        # instance vars.
                        sym.instance_vars = self._instance_vars(
                            lines, i, consumed
                        )
                # A function body consumes its own ``end``; skip
                # past it without touching the class depth.
                i += consumed
                continue

            if _RE_BLOCK_OPENER.match(line):
                depth += 1
                i += 1
                continue
            if _RE_CLASSDEF.match(line):
                # Defensive — nested classdef isn't legal MATLAB,
                # but don't let it unbalance the counter.
                depth += 1
                i += 1
                continue
            if _RE_END.match(line):
                depth -= 1
                i += 1
                continue
            i += 1

        consumed = i - start
        end_line = start + consumed - 1
        sym.range = (start, 0, max(start, end_line), 0)
        return sym, max(1, consumed)

    @staticmethod
    def _parse_bases(raw: str | None) -> list[str]:
        """Parse a ``< Base1 & Base2`` heritage clause.

        MATLAB joins multiple superclasses with ``&``. Each base
        may be dotted (``pkg.Base``); we keep the text as-is.
        Returns an empty list when there's no heritage clause.
        """
        if not raw:
            return []
        parts = [p.strip() for p in raw.split("&")]
        return [p for p in parts if p]

    def _instance_vars(
        self,
        lines: list[str],
        func_start: int,
        func_len: int,
    ) -> list[str]:
        """Collect ``obj.x = ...`` assignments in a constructor body.

        MATLAB doesn't fix the receiver name, so we accept any
        ``<ident>.<field> = `` on the left and record the field.
        Deduped, first-seen order.
        """
        seen: set[str] = set()
        order: list[str] = []
        field_re = re.compile(
            r"^\s*[A-Za-z]\w*\.(?P<field>[A-Za-z]\w*)\s*=\s*(?!=)"
        )
        for idx in range(func_start + 1, func_start + func_len):
            if idx >= len(lines):
                break
            line = _strip_comment(lines[idx])
            m = field_re.match(line)
            if m is None:
                continue
            field = m.group("field")
            if field not in seen:
                seen.add(field)
                order.append(field)
        return order

    # ------------------------------------------------------------------
    # function / method
    # ------------------------------------------------------------------

    def _consume_function(
        self,
        lines: list[str],
        start: int,
        match: "_re.Match[str]",
        *,
        is_method: bool,
    ) -> tuple[Symbol | None, int]:
        """Build a function/method Symbol and return lines consumed.

        Scans from the ``function`` line to its matching ``end``.
        Octave allows functions without a closing ``end`` (the
        next ``function`` or EOF terminates them); we handle that
        by treating a sibling ``function`` at body depth 1 as an
        implicit close.

        Parameters come from the signature. The body is scanned
        for call sites (filtered against the builtin list).
        """
        name = match.group("name")
        params = self._parse_params(match.group("params"))

        sym = Symbol(
            name=name,
            kind="method" if is_method else "function",
            file_path=self._path,
            parameters=params,
        )

        depth = 1  # the function itself
        n = len(lines)
        i = start + 1
        body_lines: list[tuple[int, str]] = []
        while i < n and depth > 0:
            line = _strip_comment(lines[i])
            stripped = line.strip()
            if not stripped:
                i += 1
                continue

            if _RE_FUNCTION.match(line) and depth == 1:
                # Octave implicit close — a sibling function at
                # body depth 1 with no intervening ``end``. Stop
                # before consuming it; the caller's loop picks it
                # up next.
                break

            if (
                _RE_BLOCK_OPENER.match(line)
                or _RE_FUNCTION.match(line)
                or _RE_CLASSDEF.match(line)
            ):
                depth += 1
                body_lines.append((i, line))
                i += 1
                continue
            if _RE_END.match(line):
                depth -= 1
                i += 1
                continue

            body_lines.append((i, line))
            i += 1

        sym.call_sites = self._extract_call_sites(body_lines, name)

        consumed = i - start
        end_line = start + consumed - 1
        sym.range = (start, 0, max(start, end_line), 0)
        return sym, max(1, consumed)

    @staticmethod
    def _parse_params(raw: str | None) -> list[Parameter]:
        """Parse a comma-separated parameter list.

        MATLAB params are bare names with no annotations or
        defaults. ``varargin`` is flagged as a vararg so the
        formatter renders it consistently with other languages.
        """
        if not raw:
            return []
        params: list[Parameter] = []
        for part in raw.split(","):
            name = part.strip()
            if not name:
                continue
            params.append(
                Parameter(
                    name=name,
                    is_vararg=(name == "varargin"),
                )
            )
        return params

    # ------------------------------------------------------------------
    # call sites
    # ------------------------------------------------------------------

    def _extract_call_sites(
        self,
        body_lines: list[tuple[int, str]],
        self_name: str,
    ) -> list[CallSite]:
        """Collect call sites from a function body.

        Every ``ident(`` is a candidate. MATLAB can't lexically
        distinguish a function call from array indexing, so this
        over-collects; the builtin filter removes language noise
        and the reference resolver filters further. Recursion
        onto the function's own name is dropped. Order preserved,
        deduped per (name, line).
        """
        sites: list[CallSite] = []
        seen: set[tuple[str, int]] = set()
        for line_idx, line in body_lines:
            for m in _RE_CALL.finditer(line):
                name = m.group("name")
                if name in _MATLAB_BUILTINS:
                    continue
                if name == self_name:
                    continue
                key = (name, line_idx + 1)
                if key in seen:
                    continue
                seen.add(key)
                sites.append(CallSite(name=name, line=line_idx + 1))
        return sites

    # ------------------------------------------------------------------
    # top-level variables
    # ------------------------------------------------------------------

    def _build_top_level_variable(
        self,
        match: "_re.Match[str]",
        line_idx: int,
    ) -> Symbol | None:
        """Build a top-level variable Symbol from an assignment.

        Filters private/underscore-prefixed names to match the
        Python extractor's convention — MATLAB has no leading
        underscore convention, but keeping the filter uniform
        avoids surprising downstream consumers. (MATLAB
        identifiers can't begin with an underscore anyway, so in
        practice nothing is filtered.)
        """
        name = match.group("name")
        if name.startswith("_"):
            return None
        return Symbol(
            name=name,
            kind="variable",
            file_path=self._path,
            range=(line_idx, 0, line_idx, 0),
        )