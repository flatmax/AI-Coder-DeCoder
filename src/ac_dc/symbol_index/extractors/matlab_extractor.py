"""MATLAB/Octave symbol extractor — regex-based, no tree-sitter required."""

import re
from typing import Optional

from ac_dc.symbol_index.models import (
    CallSite, FileSymbols, Import, Parameter, Symbol,
)
from ac_dc.symbol_index.extractors.base import BaseExtractor

# Regex patterns
_CLASS_RE = re.compile(
    r'^classdef\s+(\w+)\s*(?:<\s*([\w\s&.]+?))?$', re.MULTILINE
)
_FUNC_RE = re.compile(
    r'^(\s*)function\s+(?:\[([^\]]*)\]\s*=\s*|(\w+)\s*=\s*)?(\w+)\s*\(([^)]*)\)',
    re.MULTILINE,
)
_IMPORT_RE = re.compile(r'^\s*import\s+([\w.]+)', re.MULTILINE)
_VAR_RE = re.compile(r'^(\w+)\s*=\s*', re.MULTILINE)

# MATLAB keywords and builtins to exclude from call sites / read vars
_KEYWORDS = {
    "if", "else", "elseif", "end", "for", "while", "switch", "case",
    "otherwise", "try", "catch", "return", "break", "continue",
    "function", "classdef", "properties", "methods", "events", "enumeration",
    "persistent", "global", "parfor",
}
_BUILTINS = {
    "disp", "fprintf", "sprintf", "error", "warning", "assert",
    "zeros", "ones", "eye", "rand", "randn", "linspace", "logspace",
    "size", "length", "numel", "isempty", "isequal",
    "max", "min", "sum", "prod", "mean", "std", "var", "abs", "sqrt",
    "plot", "figure", "hold", "xlabel", "ylabel", "title", "legend",
    "subplot", "close", "clf", "grid",
    "struct", "cell", "fieldnames", "rmfield",
    "strcmp", "strcmpi", "strfind", "strsplit", "strtrim",
    "true", "false", "inf", "nan", "pi", "eps",
    "nargin", "nargout", "varargin", "varargout",
    "fopen", "fclose", "fread", "fwrite", "fscanf", "fgets",
    "exist", "which", "addpath", "rmpath", "cd", "pwd",
    "cellfun", "arrayfun", "structfun",
}
_EXCLUDE = _KEYWORDS | _BUILTINS


class MatlabExtractor(BaseExtractor):
    """Extract symbols from MATLAB/Octave source files (regex-based)."""

    tree_optional = True

    def extract(self, source: bytes, tree: Optional[object], file_path: str) -> FileSymbols:
        text = source.decode("utf-8", errors="replace")
        # Strip comments and strings for analysis
        clean = self._strip_comments_strings(text)
        lines = text.splitlines()

        symbols = []
        imports = []

        # Extract classes
        classes = self._extract_classes(text, clean, file_path)

        # Extract functions
        functions = self._extract_functions(text, clean, file_path, classes)

        # Classify functions as methods if inside class blocks
        for cls in classes:
            symbols.append(cls)

        for func in functions:
            # Check if already added as a method
            if not any(func is child for cls in classes for child in cls.children):
                symbols.append(func)

        # Extract imports
        for m in _IMPORT_RE.finditer(clean):
            imports.append(Import(
                module=m.group(1), names=[m.group(1)],
                line=text[:m.start()].count("\n") + 1,
            ))

        # Extract top-level variables (not inside functions or classes)
        top_vars = self._extract_top_level_vars(clean, file_path, classes, functions)
        symbols.extend(top_vars)

        return FileSymbols(file_path=file_path, symbols=symbols, imports=imports)

    def _strip_comments_strings(self, text: str) -> str:
        """Strip line comments (%) and string literals from a copy."""
        result = []
        for line in text.splitlines():
            # Remove strings
            stripped = re.sub(r"'[^']*'", "''", line)
            stripped = re.sub(r'"[^"]*"', '""', stripped)
            # Remove comment
            idx = stripped.find("%")
            if idx >= 0:
                stripped = stripped[:idx]
            result.append(stripped)
        return "\n".join(result)

    def _find_end(self, lines: list[str], start_line: int) -> int:
        """Find the matching 'end' for a block starting at start_line."""
        depth = 1
        block_openers = re.compile(
            r'\b(function|classdef|if|for|while|switch|try|parfor|properties|methods|events)\b'
        )
        end_re = re.compile(r'\bend\b')

        for i in range(start_line + 1, len(lines)):
            line = lines[i].strip()
            if not line or line.startswith("%"):
                continue
            # Strip strings
            clean = re.sub(r"'[^']*'", "''", line)
            clean = re.sub(r'"[^"]*"', '""', clean)
            idx = clean.find("%")
            if idx >= 0:
                clean = clean[:idx]

            depth += len(block_openers.findall(clean))
            depth -= len(end_re.findall(clean))
            if depth <= 0:
                return i
        return len(lines) - 1

    def _extract_classes(self, text: str, clean: str, file_path: str) -> list[Symbol]:
        """Extract classdef blocks."""
        classes = []
        lines = text.splitlines()

        for m in _CLASS_RE.finditer(clean):
            name = m.group(1)
            bases_str = m.group(2)
            bases = []
            if bases_str:
                bases = [b.strip() for b in bases_str.split("&") if b.strip()]

            start_line = clean[:m.start()].count("\n")
            end_line = self._find_end(lines, start_line)

            sym = Symbol(
                name=name, kind="class", file_path=file_path,
                range={
                    "start_line": start_line + 1, "start_col": 0,
                    "end_line": end_line + 1, "end_col": 0,
                },
                bases=bases,
            )
            sym._source_span = (start_line, end_line)  # For method detection
            classes.append(sym)

        return classes

    def _extract_functions(self, text: str, clean: str, file_path: str,
                           classes: list[Symbol]) -> list[Symbol]:
        """Extract function definitions."""
        functions = []
        lines = text.splitlines()

        for m in _FUNC_RE.finditer(clean):
            outputs_bracket = m.group(2)  # [a, b]
            output_single = m.group(3)    # single output
            name = m.group(4)
            params_str = m.group(5)

            start_line = clean[:m.start()].count("\n")
            end_line = self._find_end(lines, start_line)

            # Parse parameters
            params = []
            if params_str:
                for p in params_str.split(","):
                    p = p.strip()
                    if p:
                        params.append(Parameter(name=p))

            # Return type from outputs
            return_type = None
            if outputs_bracket:
                outputs = [o.strip() for o in outputs_bracket.split(",") if o.strip()]
                if outputs:
                    return_type = ", ".join(outputs)
            elif output_single:
                return_type = output_single

            # Determine if this is a method (inside a class block)
            kind = "function"
            parent_class = None
            for cls in classes:
                span = getattr(cls, "_source_span", None)
                if span and span[0] <= start_line <= span[1]:
                    kind = "method"
                    parent_class = cls
                    break

            sym = Symbol(
                name=name, kind=kind, file_path=file_path,
                range={
                    "start_line": start_line + 1, "start_col": 0,
                    "end_line": end_line + 1, "end_col": 0,
                },
                parameters=params,
                return_type=return_type,
            )

            # Extract call sites and local vars from function body
            body_text = "\n".join(lines[start_line + 1:end_line])
            body_clean = self._strip_comments_strings(body_text)

            param_names = {p.name for p in params}
            output_names = set()
            if outputs_bracket:
                output_names = {o.strip() for o in outputs_bracket.split(",") if o.strip()}
            elif output_single:
                output_names = {output_single}

            # Call sites
            call_pattern = re.compile(r'\b(\w+)\s*\(')
            for cm in call_pattern.finditer(body_clean):
                cname = cm.group(1)
                if cname not in _EXCLUDE and cname != name:
                    sym.call_sites.append(CallSite(
                        name=cname,
                        line=start_line + 1 + body_clean[:cm.start()].count("\n") + 1,
                    ))

            # Local variables (assignments in body)
            local_assign = re.compile(r'^(\w+)\s*=', re.MULTILINE)
            locals_set = set()
            for lm in local_assign.finditer(body_clean):
                vname = lm.group(1)
                if vname not in _EXCLUDE and vname not in param_names and vname not in output_names:
                    locals_set.add(vname)

            for vname in sorted(locals_set):
                sym.children.append(Symbol(
                    name=vname, kind="variable", file_path=file_path,
                    range={"start_line": start_line + 1, "start_col": 0,
                           "end_line": end_line + 1, "end_col": 0},
                ))

            # Read-only variables: identifiers in body that are not assigned,
            # not parameters, not outputs, and not builtins/keywords
            read_pattern = re.compile(r'\b(\w+)\b')
            all_identifiers = set()
            for rm in read_pattern.finditer(body_clean):
                ident = rm.group(1)
                if ident not in _EXCLUDE and ident != name:
                    all_identifiers.add(ident)
            # Subtract: params, outputs, local assignments, call sites
            call_names = {c.name for c in sym.call_sites}
            read_vars = all_identifiers - param_names - output_names - locals_set - call_names
            for vname in sorted(read_vars):
                sym.children.append(Symbol(
                    name=vname, kind="variable", file_path=file_path,
                    range={"start_line": start_line + 1, "start_col": 0,
                           "end_line": end_line + 1, "end_col": 0},
                ))

            if parent_class:
                parent_class.children.append(sym)
            functions.append(sym)

        return functions

    def _extract_top_level_vars(self, clean: str, file_path: str,
                                classes: list[Symbol],
                                functions: list[Symbol]) -> list[Symbol]:
        """Extract top-level variable assignments."""
        vars_list = []
        lines = clean.splitlines()

        # Build excluded line ranges (class and function bodies)
        excluded_ranges = []
        for cls in classes:
            span = getattr(cls, "_source_span", None)
            if span:
                excluded_ranges.append(span)
        for func in functions:
            r = func.range
            excluded_ranges.append((r["start_line"] - 1, r["end_line"] - 1))

        for m in _VAR_RE.finditer(clean):
            name = m.group(1)
            if name.startswith("_"):
                continue
            if name in _EXCLUDE:
                continue

            line_num = clean[:m.start()].count("\n")
            # Check not inside any excluded range
            inside = False
            for start, end in excluded_ranges:
                if start <= line_num <= end:
                    inside = True
                    break
            if inside:
                continue

            vars_list.append(Symbol(
                name=name, kind="variable", file_path=file_path,
                range={"start_line": line_num + 1, "start_col": 0,
                       "end_line": line_num + 1, "end_col": 0},
            ))

        return vars_list