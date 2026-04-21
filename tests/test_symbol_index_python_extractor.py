"""Tests for ac_dc.symbol_index.extractors.python — Layer 2.2.2.

Scope: the PythonExtractor — imports, functions, methods,
classes, instance vars, decorators, top-level variables, call
sites, parameters.

Strategy:

- Use real tree-sitter parses via TreeSitterParser. Mocking
  tree-sitter nodes would be brittle and miss grammar drift.
- Skip the whole module when tree_sitter_python isn't available
  — matches the pattern used in test_symbol_index_parser.py
  and test_symbol_index_base_extractor.py.
- One test class per feature area, so failures localise to
  "this aspect of Python extraction is broken".
- Small, focused source snippets per test — a test that fails
  should point clearly at one missing or wrong behaviour, not
  a dozen at once.
"""

from __future__ import annotations

import pytest

from ac_dc.symbol_index.extractors.python import PythonExtractor
from ac_dc.symbol_index.models import FileSymbols
from ac_dc.symbol_index.parser import TreeSitterParser


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def parser() -> TreeSitterParser:
    """Fresh parser per test — no singleton coupling between tests."""
    return TreeSitterParser()


@pytest.fixture
def extractor() -> PythonExtractor:
    """Fresh extractor per test.

    The extractor stores ``_source`` and ``_path`` during a
    single ``extract()`` call; giving each test its own instance
    prevents any subtle leakage between tests.
    """
    return PythonExtractor()


def _extract(
    parser: TreeSitterParser,
    extractor: PythonExtractor,
    source: str,
    path: str = "test.py",
) -> FileSymbols:
    """Parse and extract in one step.

    Helper so each test reads as "given this source, assert the
    symbols". Returns the ``FileSymbols`` result directly.
    Skips the test when the Python grammar isn't installed.
    """
    if not parser.is_available("python"):
        pytest.skip("tree_sitter_python not installed")
    source_bytes = source.encode("utf-8")
    tree = parser.parse(source_bytes, "python")
    assert tree is not None
    return extractor.extract(tree, source_bytes, path)


# ---------------------------------------------------------------------------
# Basic extraction contract
# ---------------------------------------------------------------------------


class TestExtractionContract:
    """The extractor's top-level behaviour — shape, empty input,
    tree=None handling."""

    def test_empty_source_returns_empty_file_symbols(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """No symbols, no imports, but path populated.

        An empty file is a legitimate input (``__init__.py``
        placeholders exist in real repos). Extraction must
        succeed with an empty-but-shaped result.
        """
        result = _extract(parser, extractor, "", "empty.py")
        assert isinstance(result, FileSymbols)
        assert result.file_path == "empty.py"
        assert result.symbols == []
        assert result.imports == []

    def test_path_passthrough(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """The path argument is recorded verbatim on FileSymbols.

        Downstream consumers (reference index, formatter) match
        symbols to files by this path; whitespace or separator
        tweaks here propagate everywhere.
        """
        result = _extract(
            parser, extractor, "x = 1", "src/module.py"
        )
        assert result.file_path == "src/module.py"
        # And on each child symbol too.
        assert result.symbols[0].file_path == "src/module.py"

    def test_tree_none_returns_empty_result(
        self, extractor: PythonExtractor
    ) -> None:
        """Defensive: tree=None produces an empty FileSymbols.

        A non-tree-optional extractor shouldn't normally receive
        None, but returning a clean empty result is better than
        crashing on attribute access. Tests the early-return
        branch in ``extract()``.
        """
        result = extractor.extract(None, b"", "foo.py")
        assert isinstance(result, FileSymbols)
        assert result.file_path == "foo.py"
        assert result.symbols == []
        assert result.imports == []

    def test_top_level_symbols_preserve_source_order(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """Symbols appear in the order they occur in source.

        Critical for stable symbol-map output — if source order
        isn't preserved, diffs across re-parses become noisy
        even when source is unchanged.
        """
        source = (
            "def alpha(): pass\n"
            "\n"
            "class Beta: pass\n"
            "\n"
            "def gamma(): pass\n"
        )
        result = _extract(parser, extractor, source)
        names = [s.name for s in result.symbols]
        assert names == ["alpha", "Beta", "gamma"]


# ---------------------------------------------------------------------------
# Imports
# ---------------------------------------------------------------------------


class TestImports:
    """``import`` and ``from X import Y`` extraction."""

    def test_simple_import(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``import os`` → one Import with module='os', level=0."""
        result = _extract(parser, extractor, "import os\n")
        assert len(result.imports) == 1
        imp = result.imports[0]
        assert imp.module == "os"
        assert imp.names == []  # no from-clause
        assert imp.alias is None
        assert imp.level == 0
        assert imp.line == 1

    def test_dotted_import(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``import os.path`` → module captured with the dot."""
        result = _extract(parser, extractor, "import os.path\n")
        assert len(result.imports) == 1
        assert result.imports[0].module == "os.path"

    def test_aliased_import(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``import numpy as np`` captures the alias."""
        result = _extract(parser, extractor, "import numpy as np\n")
        assert len(result.imports) == 1
        imp = result.imports[0]
        assert imp.module == "numpy"
        assert imp.alias == "np"

    def test_multiple_imports_on_one_statement(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``import os, sys`` produces two Import entries.

        Grammar-level detail: tree-sitter-python emits two
        ``dotted_name`` children under one ``import_statement``
        node. Each must become its own record so consumers can
        treat them uniformly with single-item imports.
        """
        result = _extract(parser, extractor, "import os, sys\n")
        assert len(result.imports) == 2
        modules = {imp.module for imp in result.imports}
        assert modules == {"os", "sys"}

    def test_from_import_single_name(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``from os import path`` → Import with names=['path']."""
        result = _extract(
            parser, extractor, "from os import path\n"
        )
        assert len(result.imports) == 1
        imp = result.imports[0]
        assert imp.module == "os"
        assert imp.names == ["path"]
        assert imp.level == 0

    def test_from_import_multiple_names(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``from os import path, sep`` → one Import, two names.

        Matches the "one Import per statement" contract —
        multiple names under a single from-import share the
        same module and level, so aggregating them into one
        record keeps the resolver's job simpler.
        """
        result = _extract(
            parser, extractor, "from os import path, sep\n"
        )
        assert len(result.imports) == 1
        imp = result.imports[0]
        assert imp.module == "os"
        assert imp.names == ["path", "sep"]

    def test_from_relative_import_level_one(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``from .foo import x`` → level=1, module='foo'."""
        result = _extract(
            parser, extractor, "from .foo import x\n"
        )
        assert len(result.imports) == 1
        imp = result.imports[0]
        assert imp.level == 1
        assert imp.module == "foo"
        assert imp.names == ["x"]

    def test_from_relative_import_level_two(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``from ..foo import x`` → level=2, module='foo'."""
        result = _extract(
            parser, extractor, "from ..foo import x\n"
        )
        imp = result.imports[0]
        assert imp.level == 2
        assert imp.module == "foo"

    def test_from_relative_import_no_module(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``from .. import x`` → level=2, module='' (empty).

        Bare dots with no trailing module name — valid Python
        for "import from parent package".
        """
        result = _extract(
            parser, extractor, "from .. import x\n"
        )
        imp = result.imports[0]
        assert imp.level == 2
        assert imp.module == ""
        assert imp.names == ["x"]

    def test_from_import_wildcard(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``from os import *`` → names=['*'].

        Star-imports are legitimate Python. The extractor records
        them as a literal '*' in the names list; the resolver can
        treat them specially if it wants broader name resolution.
        """
        result = _extract(
            parser, extractor, "from os import *\n"
        )
        imp = result.imports[0]
        assert imp.names == ["*"]

    def test_from_import_with_alias(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``from os import path as p`` captures the alias.

        Per the extractor's contract, only the FIRST alias on
        a multi-name from-import is recorded — aliases are a
        signal flag for the resolver, not a per-name map.
        """
        result = _extract(
            parser, extractor, "from os import path as p\n"
        )
        imp = result.imports[0]
        assert imp.module == "os"
        assert imp.names == ["path"]
        assert imp.alias == "p"

    def test_import_line_number_is_one_indexed(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """Line numbers on Import start at 1, not 0.

        Symbol ranges are 0-indexed (tree-sitter native); import
        lines are 1-indexed because the Import model is consumed
        by UI/display paths where 1-indexed is the convention.
        """
        source = (
            "# leading comment\n"
            "import os\n"
        )
        result = _extract(parser, extractor, source)
        assert result.imports[0].line == 2

    def test_imports_do_not_produce_symbols(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """Imports go to ``imports``, never to ``symbols``.

        Cross-check — a file consisting only of imports should
        have zero symbols. The symbols list is for defined
        things; imports are references.
        """
        result = _extract(
            parser, extractor, "import os\nfrom sys import path\n"
        )
        assert result.imports  # non-empty
        assert result.symbols == []


# ---------------------------------------------------------------------------
# Functions
# ---------------------------------------------------------------------------


class TestFunctions:
    """Top-level function extraction — shape, async, return types."""

    def test_simple_function(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``def hello(): pass`` → Symbol(kind='function')."""
        result = _extract(parser, extractor, "def hello():\n    pass\n")
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "hello"
        assert sym.kind == "function"
        assert sym.is_async is False

    def test_async_function_detected(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``async def`` sets is_async=True.

        The async detection reads the first 5 bytes of the
        node's source — 'async' is five characters.
        """
        result = _extract(
            parser, extractor,
            "async def fetch():\n    pass\n",
        )
        sym = result.symbols[0]
        assert sym.name == "fetch"
        assert sym.is_async is True

    def test_function_range_is_zero_indexed(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """Symbol.range uses tree-sitter's 0-indexed row/col.

        The Symbol data model stores 0-indexed positions;
        converting to 1-indexed for UI happens at the boundary.
        """
        source = "def hello():\n    pass\n"
        result = _extract(parser, extractor, source)
        start_row, start_col, _, _ = result.symbols[0].range
        assert start_row == 0
        assert start_col == 0

    def test_function_file_path_populated(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """Every extracted Symbol carries the file path."""
        result = _extract(
            parser, extractor,
            "def foo(): pass\n",
            path="src/module.py",
        )
        assert result.symbols[0].file_path == "src/module.py"

    def test_return_type_captured(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``-> int`` populates Symbol.return_type."""
        result = _extract(
            parser, extractor,
            "def count() -> int:\n    return 0\n",
        )
        assert result.symbols[0].return_type == "int"

    def test_complex_return_type_captured_verbatim(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """Complex return types are preserved as source text.

        ``list[dict[str, int]]`` would be annoying to model
        structurally — the symbol map consumers just want the
        rendered type to show.
        """
        result = _extract(
            parser, extractor,
            "def f() -> list[dict[str, int]]:\n    return []\n",
        )
        assert result.symbols[0].return_type == "list[dict[str, int]]"

    def test_no_return_type_leaves_none(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """Absent return annotation → return_type stays None."""
        result = _extract(
            parser, extractor, "def hello(): pass\n"
        )
        assert result.symbols[0].return_type is None


# ---------------------------------------------------------------------------
# Parameters
# ---------------------------------------------------------------------------


class TestParameters:
    """Parameter extraction — every shape tree-sitter-python emits."""

    def test_plain_positional(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``def f(a, b)`` → two Parameter entries, names only."""
        result = _extract(
            parser, extractor, "def f(a, b):\n    pass\n"
        )
        params = result.symbols[0].parameters
        assert len(params) == 2
        assert [p.name for p in params] == ["a", "b"]
        assert all(p.type_annotation is None for p in params)
        assert all(p.default is None for p in params)

    def test_typed_parameter(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``def f(x: int)`` → Parameter with type_annotation='int'."""
        result = _extract(
            parser, extractor, "def f(x: int):\n    pass\n"
        )
        params = result.symbols[0].parameters
        assert len(params) == 1
        assert params[0].name == "x"
        assert params[0].type_annotation == "int"
        assert params[0].default is None

    def test_default_parameter(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``def f(x=10)`` → Parameter with default='10'.

        Default is the source text of the expression — the
        extractor never evaluates defaults.
        """
        result = _extract(
            parser, extractor, "def f(x=10):\n    pass\n"
        )
        params = result.symbols[0].parameters
        assert params[0].name == "x"
        assert params[0].default == "10"
        assert params[0].type_annotation is None

    def test_typed_default_parameter(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``def f(x: int = 10)`` carries both type and default."""
        result = _extract(
            parser, extractor, "def f(x: int = 10):\n    pass\n"
        )
        p = result.symbols[0].parameters[0]
        assert p.name == "x"
        assert p.type_annotation == "int"
        assert p.default == "10"

    def test_vararg_parameter(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``*args`` → Parameter with is_vararg=True."""
        result = _extract(
            parser, extractor, "def f(*args):\n    pass\n"
        )
        p = result.symbols[0].parameters[0]
        assert p.name == "args"
        assert p.is_vararg is True
        assert p.is_kwarg is False

    def test_kwarg_parameter(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``**kwargs`` → Parameter with is_kwarg=True."""
        result = _extract(
            parser, extractor, "def f(**kwargs):\n    pass\n"
        )
        p = result.symbols[0].parameters[0]
        assert p.name == "kwargs"
        assert p.is_kwarg is True
        assert p.is_vararg is False

    def test_mixed_parameters_preserve_order(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """Mixed parameter kinds stay in source order.

        The symbol map renders parameters left-to-right; order
        preservation matters or the rendered signature becomes
        a lie.
        """
        source = (
            "def f(a, b: int, c=1, *args, **kwargs):\n"
            "    pass\n"
        )
        result = _extract(parser, extractor, source)
        params = result.symbols[0].parameters
        names = [p.name for p in params]
        assert names == ["a", "b", "c", "args", "kwargs"]

    def test_keyword_only_separator_skipped(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """Bare ``*`` keyword-only separator doesn't produce a parameter.

        ``def f(a, *, b)`` has three syntactic children under
        the parameters node — identifier, keyword separator,
        identifier — but only ``a`` and ``b`` are real
        parameters.
        """
        result = _extract(
            parser, extractor, "def f(a, *, b):\n    pass\n"
        )
        params = result.symbols[0].parameters
        assert [p.name for p in params] == ["a", "b"]

    def test_no_parameters(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """A function with no parameters has an empty list."""
        result = _extract(
            parser, extractor, "def f():\n    pass\n"
        )
        assert result.symbols[0].parameters == []


# ---------------------------------------------------------------------------
# Classes
# ---------------------------------------------------------------------------


class TestClasses:
    """Class extraction — bases, nested structure."""

    def test_simple_class(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``class Foo: pass`` → Symbol(kind='class')."""
        result = _extract(
            parser, extractor, "class Foo:\n    pass\n"
        )
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "Foo"
        assert sym.kind == "class"
        assert sym.bases == []
        assert sym.children == []

    def test_class_with_single_base(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``class Foo(Bar)`` → bases=['Bar']."""
        result = _extract(
            parser, extractor, "class Foo(Bar):\n    pass\n"
        )
        assert result.symbols[0].bases == ["Bar"]

    def test_class_with_multiple_bases(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``class Foo(A, B)`` → bases in source order.

        Python's MRO cares about base order; the symbol map
        preserves it too.
        """
        result = _extract(
            parser, extractor, "class Foo(A, B):\n    pass\n"
        )
        assert result.symbols[0].bases == ["A", "B"]

    def test_class_base_with_generic(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """Generic-typed bases are captured as source text.

        ``Generic[T]`` is a subscript expression; rendering it
        structurally would be overkill. The symbol map consumer
        just wants to show the base as the user wrote it.
        """
        result = _extract(
            parser, extractor,
            "class Box(Generic[T]):\n    pass\n",
        )
        assert result.symbols[0].bases == ["Generic[T]"]

    def test_metaclass_keyword_is_skipped(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``class Foo(Bar, metaclass=Meta)`` skips the kwarg.

        ``metaclass=Meta`` is a class-creation option, not a
        base. Including it in bases would misrepresent the
        inheritance structure.
        """
        result = _extract(
            parser, extractor,
            "class Foo(Bar, metaclass=Meta):\n    pass\n",
        )
        assert result.symbols[0].bases == ["Bar"]

    def test_typeddict_total_kwarg_skipped(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """TypedDict-style ``total=False`` kwarg is skipped too.

        Same rationale as metaclass — it's a class-creation
        option, not a base.
        """
        result = _extract(
            parser, extractor,
            "class Foo(TypedDict, total=False):\n    x: int\n",
        )
        assert result.symbols[0].bases == ["TypedDict"]

    def test_nested_class_becomes_child(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """A class defined inside another class is a child.

        Nested classes attach to their parent's ``children``
        list, not to the module's top-level ``symbols``.
        """
        source = (
            "class Outer:\n"
            "    class Inner:\n"
            "        pass\n"
        )
        result = _extract(parser, extractor, source)
        assert len(result.symbols) == 1
        outer = result.symbols[0]
        assert outer.name == "Outer"
        assert len(outer.children) == 1
        inner = outer.children[0]
        assert inner.name == "Inner"
        assert inner.kind == "class"


# ---------------------------------------------------------------------------
# Methods
# ---------------------------------------------------------------------------


class TestMethods:
    """Method extraction — kind='method', self-stripping, async."""

    def test_method_has_method_kind(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """Functions inside a class body get kind='method'.

        Distinguishing methods from top-level functions matters
        for the symbol map renderer — methods show with a
        different prefix (``m`` vs ``f``).
        """
        source = (
            "class Foo:\n"
            "    def greet(self):\n"
            "        pass\n"
        )
        result = _extract(parser, extractor, source)
        cls = result.symbols[0]
        assert len(cls.children) == 1
        method = cls.children[0]
        assert method.name == "greet"
        assert method.kind == "method"

    def test_method_self_is_stripped(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``self`` is not in the method's parameter list.

        The first parameter on a method (self/cls) is an
        implementation detail of Python's method dispatch; the
        symbol map renders the signature without it so the
        external-API shape is clear.
        """
        source = (
            "class Foo:\n"
            "    def greet(self, name):\n"
            "        pass\n"
        )
        result = _extract(parser, extractor, source)
        method = result.symbols[0].children[0]
        names = [p.name for p in method.parameters]
        assert names == ["name"]

    def test_method_cls_is_stripped(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``cls`` is stripped too — the rule is 'first parameter'.

        The stripping is positional, not name-based, so any
        first parameter name works (classmethods use ``cls``,
        some codebases use ``this``).
        """
        source = (
            "class Foo:\n"
            "    @classmethod\n"
            "    def make(cls, x):\n"
            "        pass\n"
        )
        result = _extract(parser, extractor, source)
        method = result.symbols[0].children[0]
        names = [p.name for p in method.parameters]
        assert names == ["x"]

    def test_method_with_no_params_stays_empty(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """A method with only self produces empty parameters.

        ``def greet(self): ...`` has one syntactic parameter
        which is stripped; the output list is empty, not None.
        """
        source = (
            "class Foo:\n"
            "    def greet(self):\n"
            "        pass\n"
        )
        result = _extract(parser, extractor, source)
        method = result.symbols[0].children[0]
        assert method.parameters == []

    def test_async_method(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``async def`` inside a class → method with is_async=True."""
        source = (
            "class Fetcher:\n"
            "    async def fetch(self, url):\n"
            "        return url\n"
        )
        result = _extract(parser, extractor, source)
        method = result.symbols[0].children[0]
        assert method.kind == "method"
        assert method.is_async is True

    def test_multiple_methods_in_source_order(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """Methods appear on children in source order."""
        source = (
            "class Foo:\n"
            "    def a(self): pass\n"
            "    def b(self): pass\n"
            "    def c(self): pass\n"
        )
        result = _extract(parser, extractor, source)
        cls = result.symbols[0]
        assert [m.name for m in cls.children] == ["a", "b", "c"]

    def test_nested_function_inside_method_not_extracted(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """Closures inside method bodies aren't extracted as children.

        Only direct children of the class body become method
        symbols. A function defined inside a method body is an
        implementation detail that doesn't appear in the class's
        ``children`` list.
        """
        source = (
            "class Foo:\n"
            "    def outer(self):\n"
            "        def inner():\n"
            "            pass\n"
        )
        result = _extract(parser, extractor, source)
        cls = result.symbols[0]
        assert len(cls.children) == 1
        assert cls.children[0].name == "outer"

    def test_docstring_and_pass_dont_become_symbols(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """Docstrings and bare ``pass`` don't produce children.

        Class bodies often start with a docstring or contain a
        ``pass`` placeholder. Neither contributes a symbol — the
        children list should stay clean.
        """
        source = (
            "class Foo:\n"
            '    """Class-level docstring."""\n'
            "    pass\n"
        )
        result = _extract(parser, extractor, source)
        assert result.symbols[0].children == []


# ---------------------------------------------------------------------------
# Instance variables
# ---------------------------------------------------------------------------


class TestInstanceVariables:
    """Instance-variable extraction from ``__init__`` bodies."""

    def test_self_assignments_collected(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``self.x = v`` inside __init__ → instance_vars=['x'].

        The core case — simple attribute assignments on ``self``
        become instance-var names on the class symbol.
        """
        source = (
            "class Foo:\n"
            "    def __init__(self, name):\n"
            "        self.name = name\n"
            "        self.count = 0\n"
        )
        result = _extract(parser, extractor, source)
        assert result.symbols[0].instance_vars == ["name", "count"]

    def test_preserves_first_seen_order(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """Order matches first-occurrence in source.

        The symbol map renders instance vars in a deterministic
        order so re-runs produce stable diffs.
        """
        source = (
            "class Foo:\n"
            "    def __init__(self):\n"
            "        self.b = 2\n"
            "        self.a = 1\n"
            "        self.c = 3\n"
        )
        result = _extract(parser, extractor, source)
        assert result.symbols[0].instance_vars == ["b", "a", "c"]

    def test_duplicate_assignments_dedup(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """Repeated ``self.x = ...`` records ``x`` once.

        An __init__ may re-assign the same attribute (e.g. inside
        a conditional) — the symbol map shouldn't render it
        twice.
        """
        source = (
            "class Foo:\n"
            "    def __init__(self):\n"
            "        self.x = 1\n"
            "        if True:\n"
            "            self.x = 2\n"
        )
        result = _extract(parser, extractor, source)
        assert result.symbols[0].instance_vars == ["x"]

    def test_assignments_outside_init_ignored(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``self.x = v`` in other methods doesn't contribute.

        Specs3 chose to peek inside __init__ only — the heuristic
        catches the common case cleanly and keeps the
        implementation simple. A method named ``setup`` that also
        assigns instance vars contributes nothing.
        """
        source = (
            "class Foo:\n"
            "    def __init__(self):\n"
            "        self.a = 1\n"
            "    def configure(self):\n"
            "        self.b = 2\n"
        )
        result = _extract(parser, extractor, source)
        assert result.symbols[0].instance_vars == ["a"]

    def test_no_init_no_instance_vars(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """A class without __init__ has empty instance_vars."""
        source = (
            "class Foo:\n"
            "    def greet(self):\n"
            "        self.x = 1\n"
        )
        result = _extract(parser, extractor, source)
        assert result.symbols[0].instance_vars == []

    def test_non_self_attribute_assignments_ignored(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``other.x = v`` in __init__ doesn't count.

        Only attribute assignments whose object is the bare name
        ``self`` count. Assignments on other objects (a passed-in
        config, a global) aren't instance state of this class.
        """
        source = (
            "class Foo:\n"
            "    def __init__(self, other):\n"
            "        other.x = 1\n"
            "        self.y = 2\n"
        )
        result = _extract(parser, extractor, source)
        assert result.symbols[0].instance_vars == ["y"]


# ---------------------------------------------------------------------------
# Decorators
# ---------------------------------------------------------------------------


class TestDecorators:
    """Decorator handling — property upgrade, decorator-name extraction."""

    def test_property_decorator_upgrades_kind(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``@property`` changes method kind to 'property'.

        The symbol map renders properties with a ``p`` prefix so
        consumers see them as attributes rather than methods.
        """
        source = (
            "class Foo:\n"
            "    @property\n"
            "    def name(self):\n"
            "        return self._name\n"
        )
        result = _extract(parser, extractor, source)
        method = result.symbols[0].children[0]
        assert method.name == "name"
        assert method.kind == "property"

    def test_other_decorators_leave_kind_as_method(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``@staticmethod`` / ``@classmethod`` keep kind='method'.

        Only @property triggers the kind upgrade. Static and
        class methods are still methods in the symbol map —
        distinguishing them would clutter the output.
        """
        source = (
            "class Foo:\n"
            "    @staticmethod\n"
            "    def helper(x):\n"
            "        return x\n"
            "    @classmethod\n"
            "    def make(cls, x):\n"
            "        return cls()\n"
        )
        result = _extract(parser, extractor, source)
        cls = result.symbols[0]
        assert all(m.kind == "method" for m in cls.children)

    def test_dotted_decorator_name_uses_last_component(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``@my.decorators.property`` still upgrades to kind='property'.

        Decorator name extraction takes the last component of a
        dotted expression; for property-detection purposes, a
        dotted name ending in ``property`` counts.
        """
        source = (
            "class Foo:\n"
            "    @my.decorators.property\n"
            "    def name(self):\n"
            "        return self._name\n"
        )
        result = _extract(parser, extractor, source)
        method = result.symbols[0].children[0]
        assert method.kind == "property"

    def test_called_decorator_name_extracted(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``@cache(maxsize=10)`` — arguments stripped, kind stays 'method'.

        Decorators with call syntax wrap the underlying name;
        the extractor peels the call to reach the identifier.
        No kind change for non-property decorators, but the
        underlying function is still produced.
        """
        source = (
            "class Foo:\n"
            "    @cache(maxsize=10)\n"
            "    def compute(self, x):\n"
            "        return x * 2\n"
        )
        result = _extract(parser, extractor, source)
        method = result.symbols[0].children[0]
        assert method.name == "compute"
        assert method.kind == "method"

    def test_top_level_decorated_function_produces_symbol(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``@decorator`` on a top-level function still extracts it.

        The decorated_definition wrapper shouldn't hide the inner
        function from the module-level symbols list.
        """
        source = (
            "@my_decorator\n"
            "def hello():\n"
            "    return 42\n"
        )
        result = _extract(parser, extractor, source)
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "hello"
        assert sym.kind == "function"

    def test_top_level_decorated_class_produces_symbol(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``@dataclass`` on a class doesn't hide it from extraction."""
        source = (
            "@dataclass\n"
            "class Point:\n"
            "    x: int\n"
            "    y: int\n"
        )
        result = _extract(parser, extractor, source)
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "Point"
        assert sym.kind == "class"


# ---------------------------------------------------------------------------
# Top-level variables
# ---------------------------------------------------------------------------


class TestTopLevelVariables:
    """Module-level assignment → Symbol(kind='variable')."""

    def test_simple_assignment(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``X = 1`` → Symbol with name='X', kind='variable'."""
        result = _extract(parser, extractor, "X = 1\n")
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "X"
        assert sym.kind == "variable"

    def test_multiple_assignments_each_produce_symbol(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """Each top-level assignment is a separate symbol."""
        source = "A = 1\nB = 2\nC = 3\n"
        result = _extract(parser, extractor, source)
        names = [s.name for s in result.symbols]
        assert names == ["A", "B", "C"]

    def test_private_names_skipped(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """Single-underscore names are module-internal, skipped.

        Python convention: a leading underscore signals "don't
        import from outside the module". The symbol map respects
        this and omits them to cut noise.
        """
        source = (
            "PUBLIC = 1\n"
            "_private = 2\n"
            "_another = 3\n"
        )
        result = _extract(parser, extractor, source)
        names = [s.name for s in result.symbols]
        assert names == ["PUBLIC"]

    def test_dunder_names_kept(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``__all__`` / ``__version__`` etc. are public API.

        Dunder names are a different convention — they're the
        documented module-public API for things like ``__all__``,
        ``__version__``, ``__author__``. Keep them.
        """
        source = (
            "__version__ = '1.0'\n"
            "__all__ = ['foo']\n"
            "_internal = 42\n"
        )
        result = _extract(parser, extractor, source)
        names = [s.name for s in result.symbols]
        assert names == ["__version__", "__all__"]

    def test_typed_assignment_extracted(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``X: int = 1`` is still a variable.

        Typed assignments parse the same way as plain assignments
        for our purposes — the LHS is an identifier, which is
        what the extractor filters on.
        """
        result = _extract(parser, extractor, "X: int = 1\n")
        assert len(result.symbols) == 1
        assert result.symbols[0].name == "X"
        assert result.symbols[0].kind == "variable"

    def test_tuple_unpacking_skipped(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``a, b = 1, 2`` doesn't produce variable symbols.

        Tuple unpacking has a non-identifier LHS (a tuple
        pattern). The extractor only recognises plain-identifier
        assignments; modelling tuple unpacking as multiple
        symbols would complicate the data model for a rare case.
        """
        result = _extract(parser, extractor, "a, b = 1, 2\n")
        assert result.symbols == []

    def test_subscript_assignment_skipped(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``d[k] = v`` doesn't produce a symbol.

        Subscript assignments mutate an existing binding rather
        than define one — not a module-level symbol.
        """
        result = _extract(
            parser, extractor,
            "d = {}\nd['key'] = 1\n",
        )
        names = [s.name for s in result.symbols]
        assert names == ["d"]

    def test_attribute_assignment_skipped(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``obj.attr = v`` at module level doesn't define a name.

        Same rationale — attribute assignments mutate, they don't
        define. The ``obj`` binding already exists; the assignment
        just modifies it.
        """
        result = _extract(
            parser, extractor,
            "obj = object()\nobj.attr = 1\n",
        )
        names = [s.name for s in result.symbols]
        assert names == ["obj"]

    def test_augmented_assignment_skipped(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``x += 1`` doesn't redefine — and tree-sitter emits a
        different node type, so the extractor naturally skips it.
        """
        result = _extract(
            parser, extractor,
            "x = 0\nx += 1\n",
        )
        names = [s.name for s in result.symbols]
        assert names == ["x"]


# ---------------------------------------------------------------------------
# Call sites
# ---------------------------------------------------------------------------


class TestCallSites:
    """Function body call-site extraction."""

    def test_simple_call_in_function_body(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``helper()`` inside a function body → one CallSite."""
        source = (
            "def helper(): pass\n"
            "\n"
            "def caller():\n"
            "    helper()\n"
        )
        result = _extract(parser, extractor, source)
        caller = result.symbols[1]
        assert len(caller.call_sites) == 1
        site = caller.call_sites[0]
        assert site.name == "helper"

    def test_call_site_line_is_one_indexed(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """CallSite.line uses 1-indexed line numbers.

        Matches the Import model's convention — display-path
        consumers (symbol map output) want 1-indexed lines.
        """
        source = (
            "def caller():\n"
            "    foo()\n"
        )
        result = _extract(parser, extractor, source)
        site = result.symbols[0].call_sites[0]
        assert site.line == 2

    def test_attribute_call_uses_attribute_name(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``obj.foo()`` records the attribute, not the receiver.

        The attribute name (``foo``) is the useful bit for cross-
        file reference tracking — the receiver is runtime data
        the extractor can't resolve statically.
        """
        source = (
            "def caller(obj):\n"
            "    obj.handle()\n"
        )
        result = _extract(parser, extractor, source)
        sites = result.symbols[0].call_sites
        assert len(sites) == 1
        assert sites[0].name == "handle"

    def test_nested_attribute_call_uses_tail(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``a.b.c()`` records ``c`` — the final component only.

        Tree-sitter represents ``a.b.c`` as
        ``(attribute (attribute a b) c)``; the outer attribute's
        ``attribute`` field is the final component.
        """
        source = (
            "def caller():\n"
            "    pkg.module.func()\n"
        )
        result = _extract(parser, extractor, source)
        sites = result.symbols[0].call_sites
        assert len(sites) == 1
        assert sites[0].name == "func"

    def test_subscript_call_skipped(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``handlers[key]()`` has no extractable name.

        Subscript expressions resolve to runtime values; we
        can't name the callee statically. The extractor skips
        these rather than inventing a name.
        """
        source = (
            "def dispatch(handlers, key):\n"
            "    handlers[key]()\n"
        )
        result = _extract(parser, extractor, source)
        # No usable call site — just the local identifier uses
        # inside, which aren't call sites themselves.
        assert result.symbols[0].call_sites == []

    def test_call_on_call_result_skipped(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``factory()()`` — the outer call has no simple callee name.

        The outer call's callee is itself a call expression, not
        an identifier or attribute. No static name to record; the
        inner ``factory`` call IS recorded though.
        """
        source = (
            "def caller():\n"
            "    factory()()\n"
        )
        result = _extract(parser, extractor, source)
        names = [s.name for s in result.symbols[0].call_sites]
        # Inner ``factory`` hit; outer anonymous call dropped.
        assert names == ["factory"]

    def test_builtins_filtered(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """``print`` / ``len`` / ``str`` are skipped.

        The extractor maintains a modest set of language-level
        built-ins that would otherwise produce edges from every
        file in the reference graph. Filtering them at extraction
        time keeps the resolver's job cheaper.
        """
        source = (
            "def caller(xs):\n"
            "    print(xs)\n"
            "    n = len(xs)\n"
            "    s = str(n)\n"
            "    return s\n"
        )
        result = _extract(parser, extractor, source)
        assert result.symbols[0].call_sites == []

    def test_non_builtin_and_builtin_mixed(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """User calls pass through even when mixed with built-ins."""
        source = (
            "def caller(xs):\n"
            "    print(xs)\n"
            "    helper()\n"
            "    return len(xs)\n"
        )
        result = _extract(parser, extractor, source)
        names = [s.name for s in result.symbols[0].call_sites]
        assert names == ["helper"]

    def test_multiple_calls_preserve_order(
        self, parser: TreeSitterParser, extractor: PythonExtractor
    ) -> None:
        """Call sites appear in source order.

        Stable ordering makes the symbol-map diff clean on
        re-extraction. The ``→`` outgoing-calls section in the
        compact format renders them in this order.
        """
        source = (
            "def caller():\n"
            "    alpha()\n"
            "    beta()\n"
            "    gamma()\n"
        )
        result = _extract(parser, extractor, source)
        names = [s.name for s in result.symbols[0].call_sites]
        assert names == ["alpha", "beta", "gamma"]