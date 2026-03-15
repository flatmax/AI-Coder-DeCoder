"""MATLAB symbol extractor (regex-based, no tree-sitter grammar required)."""

import re
from .base import BaseExtractor, CallSite, FileSymbols, Import, Parameter, Symbol


# Matches:  function [a, b] = myFunc(x, y)
#           function a = myFunc(x)
#           function myFunc(x)
#           function myFunc
_FUNC_RE = re.compile(
    r"^\s*function"
    r"(?:\s+(?P<outs>[^\=]+)\s*=)?"   # optional output args before =
    r"\s*(?P<name>[A-Za-z_]\w*)"       # function name
    r"\s*(?:\((?P<params>[^)]*)\))?",  # optional param list
    re.MULTILINE,
)

# Matches:  classdef MyClass < Base1 & Base2
_CLASS_RE = re.compile(
    r"^\s*classdef\s+(?P<name>[A-Za-z_]\w*)"
    r"(?:\s*<\s*(?P<bases>[^\n]+))?",
    re.MULTILINE,
)

# Matches property/method blocks:  properties ... end / methods ... end
_BLOCK_RE = re.compile(
    r"^\s*(?P<kind>properties|methods|events|enumeration)"
    r"(?:\s*\([^)]*\))?\s*$",
    re.MULTILINE,
)

# Simple top-level assignment:  VAR = ...  or  VAR=...
_VAR_RE = re.compile(
    r"^(?P<name>[A-Za-z_]\w*)\s*=(?!=)",
    re.MULTILINE,
)

# import pkg.Class  (MATLAB OOP import)
_IMPORT_RE = re.compile(
    r"^\s*import\s+(?P<module>[\w.*]+)",
    re.MULTILINE,
)


def _parse_params(params_str):
    """Parse a comma-separated parameter string into Parameter list."""
    if not params_str:
        return []
    params = []
    for p in params_str.split(","):
        name = p.strip()
        if name:
            params.append(Parameter(name=name))
    return params


def _parse_outputs(outs_str):
    """Parse output argument string (may be bracketed) into a list of names."""
    if not outs_str:
        return []
    s = outs_str.strip().strip("[]")
    return [o.strip() for o in re.split(r"[,\s]+", s) if o.strip()]


def _line_of(text, pos):
    """Return 1-based line number for character position *pos* in *text*."""
    return text[:pos].count("\n") + 1


# Matches a function call:  name(  — but not keyword( or assignment lhs
_CALL_RE = re.compile(r"\b(?P<name>[A-Za-z_]\w*)\s*\(")

# Keywords that look like calls but aren't
_MATLAB_KEYWORDS = frozenset({
    "if", "elseif", "while", "for", "switch", "case", "catch",
    "function", "classdef", "properties", "methods", "events",
    "enumeration", "end", "return", "break", "continue",
    "otherwise", "parfor", "spmd",
})

# Matches LHS of assignment:  varName = ...  (not ==)
_ASSIGN_RE = re.compile(
    r"^\s*(?:\[(?P<multi>[^\]]*)\]|(?P<single>[A-Za-z_]\w*))"
    r"\s*=(?!=)",
    re.MULTILINE,
)


# Matches any bare identifier NOT followed by ( — i.e. a variable read
_IDENT_RE = re.compile(r"\b(?P<name>[A-Za-z_]\w*)\b(?!\s*\()")

# Common MATLAB builtins excluded from read-var detection to reduce noise
_MATLAB_BUILTINS = frozenset({
    "true", "false", "inf", "nan", "pi", "eps", "nargin", "nargout",
    "varargin", "varargout", "disp", "fprintf", "sprintf", "error",
    "warning", "length", "size", "zeros", "ones", "eye", "rand", "randn",
    "numel", "isempty", "fieldnames", "struct", "cell", "num2str",
    "str2num", "str2double", "strtrim", "strsplit", "strjoin",
    "min", "max", "abs", "sum", "mean", "sqrt", "round", "floor", "ceil",
    "mod", "rem", "find", "sort", "unique", "reshape", "repmat",
    "linspace", "logspace", "cat", "horzcat", "vertcat",
    "plot", "figure", "hold", "title", "xlabel", "ylabel", "legend",
    "subplot", "set", "get", "gcf", "gca", "close", "grid",
    "fopen", "fclose", "fread", "fwrite", "fscanf", "fgets", "fgetl",
    "exist", "isa", "isnumeric", "ischar", "isstring", "islogical",
    "class", "double", "single", "int32", "uint8", "logical", "char",
    "string", "real", "imag", "conj", "transpose", "ctranspose",
})


def _extract_read_vars(body_text, func_start_line, params, outs, assigned):
    """Collect identifiers that are read but never assigned in the body."""
    known = set()
    for p in params:
        known.add(p.name)
    for o in outs:
        known.add(o)
    known.update(assigned)
    known.update(_MATLAB_KEYWORDS)
    known.update(_MATLAB_BUILTINS)

    clean = re.sub(r"%[^\n]*", "", body_text)
    # Also strip string literals to avoid false positives
    clean = re.sub(r"'[^'\n]*'", "", clean)
    clean = re.sub(r'"[^"\n]*"', "", clean)
    seen = set()
    var_syms = []
    for m in _IDENT_RE.finditer(clean):
        name = m.group("name")
        if name in known or name in seen:
            continue
        seen.add(name)
        lineno = func_start_line + clean[:m.start()].count("\n") + 1
        var_syms.append(Symbol(
            name=name,
            kind="variable",
            file_path="",
            start_line=lineno,
            start_col=0,
            end_line=lineno,
            end_col=0,
        ))
    return var_syms


def _extract_calls(body_text, func_start_line):
    """Extract call sites from a function body string."""
    seen = set()
    calls = []
    clean = re.sub(r"%[^\n]*", "", body_text)
    clean = re.sub(r"'[^'\n]*'", "", clean)
    clean = re.sub(r'"[^"\n]*"', "", clean)
    for m in _CALL_RE.finditer(clean):
        name = m.group("name")
        if name in _MATLAB_KEYWORDS:
            continue
        if name in seen:
            continue
        seen.add(name)
        lineno = func_start_line + clean[:m.start()].count("\n") + 1
        calls.append(CallSite(name=name, line=lineno))
    return calls


def _extract_local_vars(body_text, func_start_line, params, outs):
    """Extract local variable assignments from a function body."""
    known = set()
    for p in params:
        known.add(p.name)
    for o in outs:
        known.add(o)

    seen = set()
    var_syms = []
    clean = re.sub(r"%[^\n]*", "", body_text)
    clean = re.sub(r"'[^'\n]*'", "", clean)
    clean = re.sub(r'"[^"\n]*"', "", clean)
    for m in _ASSIGN_RE.finditer(clean):
        multi = m.group("multi")
        single = m.group("single")
        names = []
        if multi:
            names = [n.strip() for n in re.split(r"[,\s~]+", multi) if n.strip() and n.strip() != "~"]
        elif single:
            names = [single]
        for name in names:
            if name in _MATLAB_KEYWORDS:
                continue
            if name in known:
                continue
            if name in seen:
                continue
            seen.add(name)
            lineno = func_start_line + clean[:m.start()].count("\n") + 1
            var_syms.append(Symbol(
                name=name,
                kind="variable",
                file_path="",  # will be set by caller context
                start_line=lineno,
                start_col=0,
                end_line=lineno,
                end_col=0,
            ))
    return var_syms


def _find_end(lines, start_idx):
    """Return the 1-based line number of the matching *end* keyword.

    Scans forward from *start_idx* (0-based) tracking nesting depth.
    Returns the line of the closing *end* or the last line of the file.
    """
    depth = 1
    end_re = re.compile(
        r"^\s*(?:function|classdef|if|for|while|switch|try|parfor)\b",
    )
    close_re = re.compile(r"^\s*end\b")
    for i in range(start_idx + 1, len(lines)):
        line = lines[i]
        if end_re.match(line):
            depth += 1
        if close_re.match(line):
            depth -= 1
            if depth == 0:
                return i + 1  # 1-based
    return len(lines)


class MatlabExtractor(BaseExtractor):
    """Regex-based extractor for MATLAB (.m) source files.

    Works without a tree-sitter grammar.  Produces Symbol objects for:
    - classdef  (kind='class')
    - function  (kind='function' or 'method')
    - top-level variable assignments (kind='variable')
    - import statements
    """

    # Signals to the index that a tree-sitter parse tree is not required.
    tree_optional = True

    # BaseExtractor.extract expects (tree, source_code, file_path).
    # For MATLAB we ignore *tree* (always None) and decode source_code ourselves.
    def extract(self, tree, source_code, file_path):
        if isinstance(source_code, bytes):
            text = source_code.decode("utf-8", errors="replace")
        else:
            text = source_code

        lines = text.splitlines()
        symbols = []
        imports = []

        # Strip line comments for pattern matching but keep original for lines
        _clean = re.sub(r"%[^\n]*", "", text)

        # ── imports ──────────────────────────────────────────────────────────
        for m in _IMPORT_RE.finditer(text):
            lineno = _line_of(text, m.start())
            module = m.group("module")
            imports.append(Import(module=module, names=[], line=lineno))

        # ── classdef ─────────────────────────────────────────────────────────
        class_spans = []  # list of (start_line, end_line, Symbol)
        for m in _CLASS_RE.finditer(_clean):
            lineno = _line_of(_clean, m.start())
            bases_str = m.group("bases") or ""
            bases = [b.strip() for b in re.split(r"[&,]", bases_str) if b.strip()]
            end_line = _find_end(lines, lineno - 1)
            cls_sym = Symbol(
                name=m.group("name"),
                kind="class",
                file_path=file_path,
                start_line=lineno,
                start_col=0,
                end_line=end_line,
                end_col=0,
                bases=bases,
            )
            class_spans.append((lineno, end_line, cls_sym))
            symbols.append(cls_sym)

        # ── functions ────────────────────────────────────────────────────────
        for m in _FUNC_RE.finditer(_clean):
            lineno = _line_of(_clean, m.start())
            name = m.group("name")
            params = _parse_params(m.group("params"))
            outs = _parse_outputs(m.group("outs"))
            end_line = _find_end(lines, lineno - 1)

            return_type = ", ".join(outs) if outs else None

            # Extract body text for call sites and local variables
            # lineno is 1-based line of the function header; body starts next line
            body_lines = lines[lineno:end_line - 1]  # lines inside the function
            body_text = "\n".join(body_lines)
            body_start = lineno + 1  # first line of body (1-based)
            call_sites = _extract_calls(body_text, body_start)
            local_vars = _extract_local_vars(body_text, body_start, params, outs)
            assigned_names = {v.name for v in local_vars}
            read_vars = _extract_read_vars(body_text, body_start, params, outs, assigned_names)

            func_sym = Symbol(
                name=name,
                kind="function",
                file_path=file_path,
                start_line=lineno,
                start_col=0,
                end_line=end_line,
                end_col=0,
                parameters=params,
                return_type=return_type,
                call_sites=call_sites,
            )

            # Attach local vars as variable children (assigned first, then read-only)
            for var_sym in local_vars + read_vars:
                var_sym.file_path = file_path
                func_sym.children.append(var_sym)

            # Attach as method if inside a classdef methods block
            attached = False
            for cls_start, cls_end, cls_sym in class_spans:
                if cls_start < lineno <= cls_end:
                    func_sym.kind = "method"
                    cls_sym.children.append(func_sym)
                    attached = True
                    break
            if not attached:
                symbols.append(func_sym)

        # ── top-level variables (script files only – skip class/function bodies) ──
        # Collect all function spans (both standalone and class methods)
        func_spans = []
        for m in _FUNC_RE.finditer(_clean):
            fl = _line_of(_clean, m.start())
            fe = _find_end(lines, fl - 1)
            func_spans.append((fl, fe))
        inside_ranges = [(s, e) for s, e, _ in class_spans] + func_spans
        for m in _VAR_RE.finditer(_clean):
            lineno = _line_of(_clean, m.start())
            name = m.group("name")
            # Skip keywords and names already captured
            if name in ("function", "classdef", "end", "if", "for",
                        "while", "switch", "try", "import", "return",
                        "break", "continue", "otherwise", "case", "catch"):
                continue
            # Only emit at top level (not inside any class or function body)
            in_body = any(s <= lineno <= e for s, e in inside_ranges)
            if in_body:
                continue
            if name.startswith("_"):
                continue
            symbols.append(Symbol(
                name=name,
                kind="variable",
                file_path=file_path,
                start_line=lineno,
                start_col=0,
                end_line=lineno,
                end_col=0,
            ))

        return FileSymbols(file_path=file_path, symbols=symbols, imports=imports)