"""Tests for ac_dc.symbol_index.extractors.matlab — Layer 2.2.

Scope: the MatlabExtractor — a regex-based, tree-optional
extractor. classdef + inheritance, functions / methods, imports,
top-level variables, parameters, call sites, end-nesting, and
the Octave implicit-function-close case.

Strategy:

- The extractor is ``tree_optional = True`` — it never receives
  a tree-sitter tree. Tests call ``extract(None, source, path)``
  directly; no parser fixture is needed and no grammar can be
  missing, so (unlike the tree-sitter extractor suites) these
  tests never skip.
- One test class per feature area so a failure localises to one
  aspect of MATLAB extraction.
- Small, focused source snippets per test.
"""

from __future__ import annotations

from ac_dc.symbol_index.extractors.matlab import MatlabExtractor
from ac_dc.symbol_index.models import FileSymbols
from ac_dc.symbol_index.parser import language_for_file


def _extract(source: str, path: str = "test.m") -> FileSymbols:
    """Run the extractor on raw source.

    MATLAB is tree-optional, so we pass ``tree=None`` and let the
    extractor scan the decoded bytes itself.
    """
    extractor = MatlabExtractor()
    return extractor.extract(None, source.encode("utf-8"), path)


# ---------------------------------------------------------------------------
# Extension routing
# ---------------------------------------------------------------------------


class TestExtensionRouting:
    """`.m` resolves to the matlab language without a grammar."""

    def test_dot_m_resolves_to_matlab(self) -> None:
        """language_for_file routes .m to 'matlab'.

        The tree-optional extension map is consulted after
        LANGUAGE_MAP; .m has no tree-sitter grammar so it lives
        only in the fallback map.
        """
        assert language_for_file("foo.m") == "matlab"
        assert language_for_file("src/sub/Bar.m") == "matlab"

    def test_dot_m_case_insensitive(self) -> None:
        """Uppercase .M resolves the same as lowercase."""
        assert language_for_file("Foo.M") == "matlab"

    def test_extractor_declares_tree_optional(self) -> None:
        """The extractor opts out of requiring a parse tree.

        The orchestrator reads this flag to pass tree=None — if
        it ever flips to False, the orchestrator would try to
        parse .m with a non-existent grammar and skip the file.
        """
        assert MatlabExtractor.tree_optional is True
        assert MatlabExtractor.language == "matlab"


# ---------------------------------------------------------------------------
# Extraction contract
# ---------------------------------------------------------------------------


class TestExtractionContract:
    """Top-level shape, empty input, path passthrough."""

    def test_empty_source_returns_empty_file_symbols(self) -> None:
        """Empty input yields an empty-but-shaped result."""
        result = _extract("", "empty.m")
        assert isinstance(result, FileSymbols)
        assert result.file_path == "empty.m"
        assert result.symbols == []
        assert result.imports == []

    def test_path_passthrough(self) -> None:
        """The path is recorded on FileSymbols and on each symbol."""
        result = _extract("x = 1;\n", "src/script.m")
        assert result.file_path == "src/script.m"
        assert result.symbols[0].file_path == "src/script.m"

    def test_blank_and_comment_only_file(self) -> None:
        """A file of only blanks and comments produces no symbols."""
        source = (
            "\n"
            "% a comment\n"
            "   % indented comment\n"
            "\n"
        )
        result = _extract(source)
        assert result.symbols == []
        assert result.imports == []

    def test_top_level_order_preserved(self) -> None:
        """Symbols appear in source order."""
        source = (
            "function alpha()\n"
            "end\n"
            "function beta()\n"
            "end\n"
        )
        result = _extract(source)
        assert [s.name for s in result.symbols] == ["alpha", "beta"]


# ---------------------------------------------------------------------------
# Functions
# ---------------------------------------------------------------------------


class TestFunctions:
    """Free-function extraction — output args, params, kind."""

    def test_simple_function(self) -> None:
        """``function f()`` → Symbol(kind='function')."""
        result = _extract("function f()\nend\n")
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "f"
        assert sym.kind == "function"

    def test_function_without_parens(self) -> None:
        """``function f`` (no parens) still extracts."""
        result = _extract("function f\nend\n")
        assert result.symbols[0].name == "f"
        assert result.symbols[0].parameters == []

    def test_function_with_single_output(self) -> None:
        """``function out = f(x)`` — output arg stripped from name."""
        result = _extract("function out = f(x)\nend\n")
        sym = result.symbols[0]
        assert sym.name == "f"
        assert [p.name for p in sym.parameters] == ["x"]

    def test_function_with_multiple_outputs(self) -> None:
        """``function [a, b] = f(x)`` — bracketed outputs stripped."""
        result = _extract("function [a, b] = f(x, y)\nend\n")
        sym = result.symbols[0]
        assert sym.name == "f"
        assert [p.name for p in sym.parameters] == ["x", "y"]

    def test_function_params_preserve_order(self) -> None:
        """Parameters keep source order."""
        result = _extract("function f(a, b, c)\nend\n")
        names = [p.name for p in result.symbols[0].parameters]
        assert names == ["a", "b", "c"]

    def test_varargin_flagged_as_vararg(self) -> None:
        """``varargin`` sets is_vararg so the formatter renders it
        consistently with other languages."""
        result = _extract("function f(a, varargin)\nend\n")
        params = result.symbols[0].parameters
        assert params[0].name == "a"
        assert params[0].is_vararg is False
        assert params[1].name == "varargin"
        assert params[1].is_vararg is True

    def test_function_range_zero_indexed(self) -> None:
        """Symbol.range start row is the 0-indexed line."""
        source = (
            "% header comment\n"
            "function f()\n"
            "end\n"
        )
        result = _extract(source)
        start_row, start_col, _, _ = result.symbols[0].range
        assert start_row == 1  # second line, 0-indexed
        assert start_col == 0

    def test_two_functions_with_explicit_end(self) -> None:
        """Sibling functions each closed by ``end`` extract cleanly."""
        source = (
            "function a()\n"
            "end\n"
            "function b()\n"
            "end\n"
        )
        result = _extract(source)
        assert [s.name for s in result.symbols] == ["a", "b"]
        assert all(s.kind == "function" for s in result.symbols)


# ---------------------------------------------------------------------------
# Octave implicit function close
# ---------------------------------------------------------------------------


class TestImplicitFunctionClose:
    """Octave allows functions with no closing ``end``."""

    def test_sibling_function_implicitly_closes(self) -> None:
        """A new ``function`` at body depth 1 terminates the prior one.

        Octave style — neither function has a closing ``end``; the
        second function's header implicitly closes the first.
        """
        source = (
            "function a()\n"
            "  x = 1;\n"
            "function b()\n"
            "  y = 2;\n"
        )
        result = _extract(source)
        assert [s.name for s in result.symbols] == ["a", "b"]

    def test_eof_implicitly_closes_function(self) -> None:
        """A function running to EOF without ``end`` still extracts."""
        source = (
            "function a()\n"
            "  x = 1;\n"
        )
        result = _extract(source)
        assert len(result.symbols) == 1
        assert result.symbols[0].name == "a"


# ---------------------------------------------------------------------------
# End-nesting
# ---------------------------------------------------------------------------


class TestEndNesting:
    """Inner blocks consume their own ``end`` without closing the
    enclosing function."""

    def test_if_block_does_not_close_function(self) -> None:
        """An ``if ... end`` inside a function doesn't end the function.

        If the depth counter mishandled the inner ``end``, the
        function would close early and the trailing sibling would
        be misattributed.
        """
        source = (
            "function a()\n"
            "  if true\n"
            "    x = 1;\n"
            "  end\n"
            "  y = 2;\n"
            "end\n"
            "function b()\n"
            "end\n"
        )
        result = _extract(source)
        assert [s.name for s in result.symbols] == ["a", "b"]

    def test_nested_for_and_while(self) -> None:
        """Multiple nested block-openers all balance correctly."""
        source = (
            "function a()\n"
            "  for i = 1:10\n"
            "    while true\n"
            "      x = 1;\n"
            "    end\n"
            "  end\n"
            "end\n"
            "function b()\n"
            "end\n"
        )
        result = _extract(source)
        assert [s.name for s in result.symbols] == ["a", "b"]


# ---------------------------------------------------------------------------
# classdef
# ---------------------------------------------------------------------------


class TestClassdef:
    """Class extraction — inheritance, methods, instance vars."""

    def test_simple_classdef(self) -> None:
        """``classdef Foo`` → Symbol(kind='class')."""
        result = _extract("classdef Foo\nend\n")
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "Foo"
        assert sym.kind == "class"
        assert sym.bases == []

    def test_classdef_single_base(self) -> None:
        """``classdef Foo < Bar`` → bases=['Bar']."""
        result = _extract("classdef Foo < Bar\nend\n")
        assert result.symbols[0].bases == ["Bar"]

    def test_classdef_multiple_bases(self) -> None:
        """``classdef Foo < A & B`` → bases in order, ampersand-split."""
        result = _extract("classdef Foo < A & B & C\nend\n")
        assert result.symbols[0].bases == ["A", "B", "C"]

    def test_classdef_dotted_base(self) -> None:
        """Packaged base names are kept verbatim."""
        result = _extract("classdef Foo < pkg.Base\nend\n")
        assert result.symbols[0].bases == ["pkg.Base"]

    def test_classdef_attribute_block_ignored(self) -> None:
        """``classdef (Sealed) Foo`` — attribute block doesn't break
        the name match."""
        result = _extract("classdef (Sealed) Foo < Bar\nend\n")
        sym = result.symbols[0]
        assert sym.name == "Foo"
        assert sym.bases == ["Bar"]

    def test_methods_become_children(self) -> None:
        """``function`` lines inside the class become methods."""
        source = (
            "classdef Foo\n"
            "  methods\n"
            "    function greet(obj)\n"
            "    end\n"
            "    function run(obj, x)\n"
            "    end\n"
            "  end\n"
            "end\n"
        )
        result = _extract(source)
        cls = result.symbols[0]
        assert cls.name == "Foo"
        names = [m.name for m in cls.children]
        assert names == ["greet", "run"]
        assert all(m.kind == "method" for m in cls.children)

    def test_properties_block_does_not_close_class_early(self) -> None:
        """A ``properties ... end`` block balances within the class.

        If the ``properties`` ``end`` were mishandled, the class
        would close before its methods were scanned.
        """
        source = (
            "classdef Foo\n"
            "  properties\n"
            "    x\n"
            "    y\n"
            "  end\n"
            "  methods\n"
            "    function greet(obj)\n"
            "    end\n"
            "  end\n"
            "end\n"
        )
        result = _extract(source)
        cls = result.symbols[0]
        assert [m.name for m in cls.children] == ["greet"]

    def test_constructor_instance_vars(self) -> None:
        """A constructor's ``obj.x = ...`` assignments become
        instance_vars.

        MATLAB convention: the method named like the class is the
        constructor. Field assignments on its first arg are the
        instance state.
        """
        source = (
            "classdef Foo\n"
            "  methods\n"
            "    function obj = Foo(name)\n"
            "      obj.name = name;\n"
            "      obj.count = 0;\n"
            "    end\n"
            "  end\n"
            "end\n"
        )
        result = _extract(source)
        cls = result.symbols[0]
        assert cls.instance_vars == ["name", "count"]

    def test_instance_vars_deduped_first_seen_order(self) -> None:
        """Repeated field assignments record the field once."""
        source = (
            "classdef Foo\n"
            "  methods\n"
            "    function obj = Foo()\n"
            "      obj.x = 1;\n"
            "      obj.y = 2;\n"
            "      obj.x = 3;\n"
            "    end\n"
            "  end\n"
            "end\n"
        )
        result = _extract(source)
        assert result.symbols[0].instance_vars == ["x", "y"]

    def test_non_constructor_method_no_instance_vars(self) -> None:
        """A class with no constructor has empty instance_vars."""
        source = (
            "classdef Foo\n"
            "  methods\n"
            "    function greet(obj)\n"
            "      obj.x = 1;\n"
            "    end\n"
            "  end\n"
            "end\n"
        )
        result = _extract(source)
        assert result.symbols[0].instance_vars == []


# ---------------------------------------------------------------------------
# Imports
# ---------------------------------------------------------------------------


class TestImports:
    """``import`` statement extraction."""

    def test_import_qualified_name(self) -> None:
        """``import pkg.Foo`` → Import(module='pkg.Foo')."""
        result = _extract("import pkg.Foo\n")
        assert len(result.imports) == 1
        imp = result.imports[0]
        assert imp.module == "pkg.Foo"
        assert imp.line == 1

    def test_import_wildcard(self) -> None:
        """``import pkg.*`` keeps the wildcard in the module path."""
        result = _extract("import pkg.sub.*\n")
        assert result.imports[0].module == "pkg.sub.*"

    def test_import_line_one_indexed(self) -> None:
        """Import line numbers are 1-indexed."""
        source = (
            "% header\n"
            "import pkg.Foo\n"
        )
        result = _extract(source)
        assert result.imports[0].line == 2

    def test_imports_do_not_produce_symbols(self) -> None:
        """A file of only imports has no symbols."""
        result = _extract("import a.b\nimport c.d\n")
        assert len(result.imports) == 2
        assert result.symbols == []


# ---------------------------------------------------------------------------
# Top-level variables
# ---------------------------------------------------------------------------


class TestTopLevelVariables:
    """Script-level assignments become variable symbols."""

    def test_simple_assignment(self) -> None:
        """``x = 1`` → Symbol(kind='variable')."""
        result = _extract("x = 1;\n")
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "x"
        assert sym.kind == "variable"

    def test_multiple_assignments(self) -> None:
        """Each top-level assignment is its own symbol."""
        result = _extract("a = 1;\nb = 2;\nc = 3;\n")
        assert [s.name for s in result.symbols] == ["a", "b", "c"]

    def test_equality_not_treated_as_assignment(self) -> None:
        """``x == 1`` is a comparison, not an assignment.

        The negative lookahead after ``=`` prevents ``==`` from
        matching the assignment pattern.
        """
        result = _extract("x == 1;\n")
        assert result.symbols == []

    def test_le_comparison_not_assignment(self) -> None:
        """A leading ``<=`` expression isn't an assignment.

        ``y <= 3`` starts with an identifier but the next sig
        char isn't a bare ``=``, so no variable is recorded.
        """
        result = _extract("y <= 3;\n")
        assert result.symbols == []

    def test_assignment_range_zero_indexed(self) -> None:
        """Variable range start row is the 0-indexed line."""
        source = "% comment\nx = 5;\n"
        result = _extract(source)
        start_row, _, _, _ = result.symbols[0].range
        assert start_row == 1


# ---------------------------------------------------------------------------
# Call sites
# ---------------------------------------------------------------------------


class TestCallSites:
    """Function-body call-site extraction with builtin filtering."""

    def test_user_call_recorded(self) -> None:
        """A non-builtin ``ident(...)`` inside a body is a call site."""
        source = (
            "function caller()\n"
            "  helper(1, 2);\n"
            "end\n"
        )
        result = _extract(source)
        sites = result.symbols[0].call_sites
        assert len(sites) == 1
        assert sites[0].name == "helper"
        assert sites[0].line == 2

    def test_builtins_filtered(self) -> None:
        """Pervasive builtins (disp, zeros, length) are dropped."""
        source = (
            "function caller(xs)\n"
            "  disp(xs);\n"
            "  n = length(xs);\n"
            "  z = zeros(n);\n"
            "end\n"
        )
        result = _extract(source)
        assert result.symbols[0].call_sites == []

    def test_user_and_builtin_mixed(self) -> None:
        """User calls survive when mixed with builtins."""
        source = (
            "function caller(xs)\n"
            "  disp(xs);\n"
            "  helper();\n"
            "  n = length(xs);\n"
            "end\n"
        )
        result = _extract(source)
        names = [cs.name for cs in result.symbols[0].call_sites]
        assert names == ["helper"]

    def test_self_recursion_dropped(self) -> None:
        """A function calling itself doesn't record its own name."""
        source = (
            "function fib(n)\n"
            "  fib(n - 1);\n"
            "  other(n);\n"
            "end\n"
        )
        result = _extract(source)
        names = [cs.name for cs in result.symbols[0].call_sites]
        assert names == ["other"]

    def test_deduped_per_name_and_line(self) -> None:
        """The same call twice on one line is recorded once."""
        source = (
            "function caller()\n"
            "  helper() + helper();\n"
            "end\n"
        )
        result = _extract(source)
        sites = result.symbols[0].call_sites
        assert len(sites) == 1
        assert sites[0].name == "helper"

    def test_same_call_different_lines_kept(self) -> None:
        """The same callee on two lines yields two call sites."""
        source = (
            "function caller()\n"
            "  helper();\n"
            "  helper();\n"
            "end\n"
        )
        result = _extract(source)
        sites = result.symbols[0].call_sites
        assert len(sites) == 2
        assert [cs.line for cs in sites] == [2, 3]

    def test_field_access_call_not_double_counted(self) -> None:
        """``obj.method(...)`` doesn't record ``obj`` as a call.

        The lookbehind in the call pattern rejects an identifier
        preceded by a dot, so only the leading receiver — if it's
        a bare call — would match. Here ``obj`` is followed by a
        dot, not a paren, so nothing spurious is recorded.
        """
        source = (
            "function caller(obj)\n"
            "  obj.run();\n"
            "end\n"
        )
        result = _extract(source)
        names = [cs.name for cs in result.symbols[0].call_sites]
        assert "obj" not in names

    def test_comment_calls_ignored(self) -> None:
        """A call appearing only in a comment isn't extracted."""
        source = (
            "function caller()\n"
            "  % helper() would be called here\n"
            "  real_call();\n"
            "end\n"
        )
        result = _extract(source)
        names = [cs.name for cs in result.symbols[0].call_sites]
        assert names == ["real_call"]


# ---------------------------------------------------------------------------
# Mixed files
# ---------------------------------------------------------------------------


class TestMixedFile:
    """A realistic script mixing constructs extracts everything."""

    def test_script_with_function_and_vars(self) -> None:
        """Top-level vars, an import, and a local function coexist."""
        source = (
            "import pkg.Helper\n"
            "config = struct();\n"
            "result = process(config);\n"
            "\n"
            "function out = process(cfg)\n"
            "  out = transform(cfg);\n"
            "end\n"
        )
        result = _extract(source)
        # One import.
        assert [i.module for i in result.imports] == ["pkg.Helper"]
        # Two top-level vars and one function, in source order.
        kinds = [(s.name, s.kind) for s in result.symbols]
        assert kinds == [
            ("config", "variable"),
            ("result", "variable"),
            ("process", "function"),
        ]
        # The function's body call survives builtin filtering.
        proc = result.symbols[2]
        names = [cs.name for cs in proc.call_sites]
        assert names == ["transform"]