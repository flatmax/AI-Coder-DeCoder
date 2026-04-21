"""Tests for ac_dc.symbol_index.extractors.javascript — Layer 2.2.3.

Scope: the JavaScriptExtractor — imports, functions, arrow
functions, classes, methods, getters/setters, class fields
(including private), top-level declarations, call sites,
parameters with destructuring and rest, export unwrapping.

Strategy: same shape as the Python extractor tests — real
tree-sitter parses via TreeSitterParser, one test class per
feature area. Skips the whole module when tree_sitter_javascript
isn't installed.
"""

from __future__ import annotations

import pytest

from ac_dc.symbol_index.extractors.javascript import JavaScriptExtractor
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
def extractor() -> JavaScriptExtractor:
    """Fresh extractor per test — avoids any per-instance state leak."""
    return JavaScriptExtractor()


def _extract(
    parser: TreeSitterParser,
    extractor: JavaScriptExtractor,
    source: str,
    path: str = "test.js",
) -> FileSymbols:
    """Parse and extract in one step — skips when grammar missing."""
    if not parser.is_available("javascript"):
        pytest.skip("tree_sitter_javascript not installed")
    source_bytes = source.encode("utf-8")
    tree = parser.parse(source_bytes, "javascript")
    assert tree is not None
    return extractor.extract(tree, source_bytes, path)


# ---------------------------------------------------------------------------
# Basic extraction contract
# ---------------------------------------------------------------------------


class TestExtractionContract:
    """Top-level shape — empty source, tree=None, path passthrough."""

    def test_empty_source_returns_empty_file_symbols(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """No symbols, no imports, path populated."""
        result = _extract(parser, extractor, "", "empty.js")
        assert isinstance(result, FileSymbols)
        assert result.file_path == "empty.js"
        assert result.symbols == []
        assert result.imports == []

    def test_path_passthrough(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """The path argument is recorded on FileSymbols and children."""
        result = _extract(
            parser, extractor,
            "function hi() {}\n",
            path="src/mod.js",
        )
        assert result.file_path == "src/mod.js"
        assert result.symbols[0].file_path == "src/mod.js"

    def test_tree_none_returns_empty_result(
        self, extractor: JavaScriptExtractor
    ) -> None:
        """Defensive: tree=None produces an empty FileSymbols."""
        result = extractor.extract(None, b"", "foo.js")
        assert isinstance(result, FileSymbols)
        assert result.file_path == "foo.js"
        assert result.symbols == []
        assert result.imports == []

    def test_top_level_symbols_preserve_source_order(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """Top-level symbols emit in source order — matters for diffs."""
        source = (
            "function alpha() {}\n"
            "class Beta {}\n"
            "const gamma = 42;\n"
        )
        result = _extract(parser, extractor, source)
        names = [s.name for s in result.symbols]
        assert names == ["alpha", "Beta", "gamma"]


# ---------------------------------------------------------------------------
# Imports
# ---------------------------------------------------------------------------


class TestImports:
    """ESM ``import`` extraction — every shape tree-sitter-javascript emits."""

    def test_side_effect_import(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``import "x"`` → one Import, names=[], no alias."""
        result = _extract(parser, extractor, 'import "./side-effect";\n')
        assert len(result.imports) == 1
        imp = result.imports[0]
        assert imp.module == "./side-effect"
        assert imp.names == []
        assert imp.alias is None
        assert imp.line == 1

    def test_default_import(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``import foo from "x"`` → names=["foo"]."""
        result = _extract(
            parser, extractor, 'import foo from "x";\n'
        )
        assert len(result.imports) == 1
        imp = result.imports[0]
        assert imp.module == "x"
        assert imp.names == ["foo"]
        assert imp.alias is None

    def test_named_imports(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``import { a, b } from "x"`` → names=["a", "b"]."""
        result = _extract(
            parser, extractor, 'import { a, b } from "x";\n'
        )
        assert len(result.imports) == 1
        imp = result.imports[0]
        assert imp.module == "x"
        assert imp.names == ["a", "b"]

    def test_named_import_with_alias(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``import { a as b } from "x"`` records original name + alias."""
        result = _extract(
            parser, extractor, 'import { a as b } from "x";\n'
        )
        imp = result.imports[0]
        assert imp.names == ["a"]
        assert imp.alias == "b"

    def test_namespace_import(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``import * as ns from "x"`` → names=["*"], alias='ns'."""
        result = _extract(
            parser, extractor, 'import * as ns from "x";\n'
        )
        imp = result.imports[0]
        assert imp.names == ["*"]
        assert imp.alias == "ns"

    def test_default_plus_named(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``import foo, { a } from "x"`` — flat names list.

        A single statement can mix a default and named imports.
        The extractor records them in source order as a single
        flat names list on one Import record.
        """
        result = _extract(
            parser, extractor, 'import foo, { a, b } from "x";\n'
        )
        assert len(result.imports) == 1
        imp = result.imports[0]
        assert imp.module == "x"
        assert imp.names == ["foo", "a", "b"]

    def test_single_quoted_source(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """Single-quoted module strings work the same as double."""
        result = _extract(
            parser, extractor, "import foo from 'x';\n"
        )
        assert result.imports[0].module == "x"

    def test_import_line_is_one_indexed(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """Import.line is 1-indexed to match the Python extractor."""
        source = (
            "// comment\n"
            'import foo from "x";\n'
        )
        result = _extract(parser, extractor, source)
        assert result.imports[0].line == 2

    def test_imports_do_not_produce_symbols(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """Imports go to ``imports``, never to ``symbols``."""
        source = (
            'import foo from "x";\n'
            'import { a } from "y";\n'
        )
        result = _extract(parser, extractor, source)
        assert result.imports
        assert result.symbols == []


# ---------------------------------------------------------------------------
# Functions
# ---------------------------------------------------------------------------


class TestFunctions:
    """Top-level function extraction."""

    def test_simple_function(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``function hello() {}`` → Symbol(kind='function')."""
        result = _extract(parser, extractor, "function hello() {}\n")
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "hello"
        assert sym.kind == "function"
        assert sym.is_async is False

    def test_async_function(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``async function fetch() {}`` → is_async=True."""
        result = _extract(
            parser, extractor, "async function fetchIt() {}\n"
        )
        sym = result.symbols[0]
        assert sym.name == "fetchIt"
        assert sym.is_async is True

    def test_generator_function(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``function* gen() {}`` → kind='function'.

        Generators parse as their own node type but for the
        symbol map we treat them as plain functions. The caller
        doesn't need to know about generatorness at this layer.
        """
        result = _extract(
            parser, extractor, "function* gen() { yield 1; }\n"
        )
        assert len(result.symbols) == 1
        assert result.symbols[0].name == "gen"
        assert result.symbols[0].kind == "function"

    def test_function_range_is_zero_indexed(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """Symbol.range uses tree-sitter's 0-indexed row/col."""
        result = _extract(parser, extractor, "function hi() {}\n")
        start_row, start_col, _, _ = result.symbols[0].range
        assert start_row == 0
        assert start_col == 0


# ---------------------------------------------------------------------------
# Function-valued declarations (arrow + function expression)
# ---------------------------------------------------------------------------


class TestFunctionValuedDeclarations:
    """``const foo = () => {}`` etc. — function-shaped bindings."""

    def test_arrow_function_becomes_function(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``const foo = () => {}`` → kind='function', not 'variable'.

        Specs3 chose to treat arrow functions assigned at the
        top level as function symbols rather than variables —
        the symbol map would otherwise render them as vars,
        which loses useful structural information.
        """
        result = _extract(
            parser, extractor, "const foo = () => {};\n"
        )
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "foo"
        assert sym.kind == "function"
        assert sym.is_async is False

    def test_async_arrow_function(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``const foo = async () => {}`` → kind='function', is_async=True."""
        result = _extract(
            parser, extractor, "const foo = async () => {};\n"
        )
        sym = result.symbols[0]
        assert sym.kind == "function"
        assert sym.is_async is True

    def test_function_expression_assignment(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``const foo = function() {}`` → kind='function'."""
        result = _extract(
            parser, extractor, "const foo = function() {};\n"
        )
        assert result.symbols[0].kind == "function"

    def test_async_function_expression(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``const foo = async function() {}`` → is_async=True."""
        result = _extract(
            parser, extractor, "const foo = async function() {};\n"
        )
        assert result.symbols[0].is_async is True

    def test_single_param_arrow_extracted(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``x => x + 1`` — bare-identifier param is captured.

        The grammar assigns the single identifier to a
        ``parameter`` field (singular) rather than wrapping it
        in a formal_parameters node. The extractor handles both
        shapes so the symbol still reports one parameter.
        """
        result = _extract(
            parser, extractor, "const inc = x => x + 1;\n"
        )
        sym = result.symbols[0]
        assert sym.kind == "function"
        assert len(sym.parameters) == 1
        assert sym.parameters[0].name == "x"

    def test_let_and_var_also_supported(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``let`` and ``var`` bindings produce symbols too.

        The grammar uses ``lexical_declaration`` for const/let
        and ``variable_declaration`` for var. Both dispatch
        through the same handler.
        """
        source = (
            "let a = () => {};\n"
            "var b = () => {};\n"
        )
        result = _extract(parser, extractor, source)
        names = [s.name for s in result.symbols]
        assert names == ["a", "b"]
        assert all(s.kind == "function" for s in result.symbols)

    def test_multiple_declarators_each_produce_symbol(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``const a = 1, b = 2;`` — two declarators → two symbols."""
        result = _extract(
            parser, extractor, "const a = 1, b = 2;\n"
        )
        names = [s.name for s in result.symbols]
        assert names == ["a", "b"]

    def test_plain_constant_is_variable(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``const X = 42`` → kind='variable', not 'function'."""
        result = _extract(
            parser, extractor, "const X = 42;\n"
        )
        sym = result.symbols[0]
        assert sym.name == "X"
        assert sym.kind == "variable"

    def test_uninitialised_declaration_is_variable(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``let x;`` — no initialiser → kind='variable'."""
        result = _extract(parser, extractor, "let x;\n")
        sym = result.symbols[0]
        assert sym.name == "x"
        assert sym.kind == "variable"

    def test_destructuring_lhs_skipped(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``const { a, b } = obj;`` produces no symbols.

        Destructuring patterns have no single identifier LHS.
        Modelling them as multiple symbols would require
        recursion into every pattern shape; specs3 skipped
        them and we match.
        """
        result = _extract(
            parser, extractor,
            "const obj = {};\nconst { a, b } = obj;\n",
        )
        names = [s.name for s in result.symbols]
        assert names == ["obj"]


# ---------------------------------------------------------------------------
# Parameters
# ---------------------------------------------------------------------------


class TestParameters:
    """Parameter extraction — every shape tree-sitter-javascript emits."""

    def test_plain_positional(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``function f(a, b)`` → two Parameter entries."""
        result = _extract(parser, extractor, "function f(a, b) {}\n")
        params = result.symbols[0].parameters
        assert [p.name for p in params] == ["a", "b"]

    def test_default_parameter(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``function f(x = 10)`` → default='10' (source text)."""
        result = _extract(
            parser, extractor, "function f(x = 10) {}\n"
        )
        p = result.symbols[0].parameters[0]
        assert p.name == "x"
        assert p.default == "10"

    def test_rest_parameter(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``function f(...args)`` → Parameter with is_vararg=True."""
        result = _extract(
            parser, extractor, "function f(...args) {}\n"
        )
        p = result.symbols[0].parameters[0]
        assert p.name == "args"
        assert p.is_vararg is True

    def test_object_destructuring_uses_source_text(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``function f({a, b})`` — synthetic name from source.

        The extractor doesn't model the pattern structure; it
        captures the source text as the parameter's "name" so
        the symbol map renders something meaningful.
        """
        result = _extract(
            parser, extractor, "function f({a, b}) {}\n"
        )
        params = result.symbols[0].parameters
        assert len(params) == 1
        # Exact spelling varies with grammar version
        # (``{a, b}`` vs ``{ a, b }``); assert on content.
        assert "a" in params[0].name
        assert "b" in params[0].name

    def test_array_destructuring_uses_source_text(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``function f([a, b])`` — same treatment as object pattern."""
        result = _extract(
            parser, extractor, "function f([a, b]) {}\n"
        )
        params = result.symbols[0].parameters
        assert len(params) == 1
        assert "a" in params[0].name
        assert "b" in params[0].name

    def test_mixed_parameters_preserve_order(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """Parameter order matches source order."""
        source = (
            "function f(a, b = 1, ...rest) {}\n"
        )
        result = _extract(parser, extractor, source)
        names = [p.name for p in result.symbols[0].parameters]
        assert names == ["a", "b", "rest"]

    def test_no_parameters(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """Function with empty param list → empty parameters."""
        result = _extract(parser, extractor, "function f() {}\n")
        assert result.symbols[0].parameters == []


# ---------------------------------------------------------------------------
# Classes
# ---------------------------------------------------------------------------


class TestClasses:
    """Class extraction — bases, body population, nested classes."""

    def test_simple_class(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``class Foo {}`` → Symbol(kind='class')."""
        result = _extract(parser, extractor, "class Foo {}\n")
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "Foo"
        assert sym.kind == "class"
        assert sym.bases == []
        assert sym.children == []

    def test_class_with_single_base(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``class Foo extends Bar {}`` → bases=['Bar']."""
        result = _extract(
            parser, extractor, "class Foo extends Bar {}\n"
        )
        assert result.symbols[0].bases == ["Bar"]

    def test_class_with_expression_base(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``class Foo extends mixin(Bar) {}`` keeps the full expression."""
        result = _extract(
            parser, extractor,
            "class Foo extends mixin(Bar) {}\n",
        )
        bases = result.symbols[0].bases
        assert len(bases) == 1
        # Exact whitespace varies; assert the call expression
        # text is preserved.
        assert "mixin" in bases[0]
        assert "Bar" in bases[0]

    def test_class_with_dotted_base(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``class Foo extends Namespace.Bar {}`` keeps the dotted path."""
        result = _extract(
            parser, extractor,
            "class Foo extends Namespace.Bar {}\n",
        )
        assert result.symbols[0].bases == ["Namespace.Bar"]

    def test_class_method_becomes_child(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """Methods attach to the class's ``children`` list."""
        source = (
            "class Foo {\n"
            "  greet() {}\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        cls = result.symbols[0]
        assert len(cls.children) == 1
        method = cls.children[0]
        assert method.name == "greet"
        assert method.kind == "method"

    def test_multiple_methods_in_source_order(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """Methods appear on children in source order."""
        source = (
            "class Foo {\n"
            "  a() {}\n"
            "  b() {}\n"
            "  c() {}\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        cls = result.symbols[0]
        assert [m.name for m in cls.children] == ["a", "b", "c"]

    def test_constructor_becomes_child_method(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``constructor() {}`` is a regular method child.

        JS classes don't have an equivalent of Python's
        ``__init__`` instance-var inference; the constructor
        appears as just another method named 'constructor'.
        """
        source = (
            "class Foo {\n"
            "  constructor(name) { this.name = name; }\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        cls = result.symbols[0]
        assert len(cls.children) == 1
        ctor = cls.children[0]
        assert ctor.name == "constructor"
        assert ctor.kind == "method"

    def test_nested_class_expression_not_top_level(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """A class expression inside a function body isn't a top-level symbol.

        Only ``class_declaration`` at the module level produces
        a class symbol. Class expressions nested in function
        bodies don't reach the top-level handler.
        """
        source = (
            "function make() {\n"
            "  return class Inner {};\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        assert len(result.symbols) == 1
        assert result.symbols[0].name == "make"
        assert result.symbols[0].kind == "function"


# ---------------------------------------------------------------------------
# Methods and accessors
# ---------------------------------------------------------------------------


class TestMethods:
    """Method details — async, static, private, getters, setters."""

    def test_async_method(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``async foo() {}`` inside class → method with is_async=True."""
        source = (
            "class Fetcher {\n"
            "  async fetch(url) { return url; }\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        method = result.symbols[0].children[0]
        assert method.name == "fetch"
        assert method.kind == "method"
        assert method.is_async is True

    def test_getter_becomes_property(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``get name() {}`` → kind='property'.

        Getters and setters are a read/write attribute surface,
        not a callable. The symbol map renders them with the
        same ``p`` prefix as Python's @property.
        """
        source = (
            "class Foo {\n"
            "  get name() { return this._name; }\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        method = result.symbols[0].children[0]
        assert method.name == "name"
        assert method.kind == "property"

    def test_setter_becomes_property(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``set name(v) {}`` → kind='property' too."""
        source = (
            "class Foo {\n"
            "  set name(v) { this._name = v; }\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        method = result.symbols[0].children[0]
        assert method.name == "name"
        assert method.kind == "property"

    def test_static_method_stays_method(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``static foo() {}`` → kind='method'.

        We don't surface ``static`` in the kind — it's an
        implementation detail. The symbol map's consumers
        treat static and instance methods the same.
        """
        source = (
            "class Foo {\n"
            "  static build() { return new Foo(); }\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        method = result.symbols[0].children[0]
        assert method.name == "build"
        assert method.kind == "method"

    def test_private_method_preserves_hash(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``#secret() {}`` keeps the leading '#' in the name.

        The ``#`` prefix is the actual identifier; stripping
        it would change what callers see and break reference
        matching later.
        """
        source = (
            "class Foo {\n"
            "  #secret() { return 42; }\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        method = result.symbols[0].children[0]
        assert method.name == "#secret"
        assert method.kind == "method"

    def test_method_parameters_extracted(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """Method parameters come through the same extractor as functions."""
        source = (
            "class Foo {\n"
            "  greet(name, loudly = false) {}\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        method = result.symbols[0].children[0]
        names = [p.name for p in method.parameters]
        assert names == ["name", "loudly"]
        # Default preserved as source text.
        assert method.parameters[1].default == "false"


# ---------------------------------------------------------------------------
# Class fields
# ---------------------------------------------------------------------------


class TestClassFields:
    """Class field declarations (``count = 0`` at class body level)."""

    def test_public_field_becomes_variable_child(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``count = 0;`` inside a class → Symbol(kind='variable') child.

        Class fields are instance-level data bindings analogous
        to Python's top-level vars. Kind is 'variable'; the
        symbol map renderer distinguishes by nesting depth,
        not by kind.
        """
        source = (
            "class Counter {\n"
            "  count = 0;\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        cls = result.symbols[0]
        assert len(cls.children) == 1
        field = cls.children[0]
        assert field.name == "count"
        assert field.kind == "variable"

    def test_private_field_preserves_hash(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``#private = 0`` keeps the leading '#' in the name."""
        source = (
            "class Foo {\n"
            "  #secret = 42;\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        field = result.symbols[0].children[0]
        assert field.name == "#secret"
        assert field.kind == "variable"

    def test_uninitialised_field(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``name;`` as a bare field declaration still produces a symbol."""
        source = (
            "class Foo {\n"
            "  name;\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        field = result.symbols[0].children[0]
        assert field.name == "name"
        assert field.kind == "variable"

    def test_field_and_method_mixed_preserve_order(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """Fields and methods appear in source order on children."""
        source = (
            "class Foo {\n"
            "  count = 0;\n"
            "  greet() {}\n"
            "  name;\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        cls = result.symbols[0]
        assert [c.name for c in cls.children] == ["count", "greet", "name"]

    def test_static_field(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``static VERSION = 1;`` still produces a child variable.

        Static vs instance distinction isn't surfaced in the
        kind — matches the ``static foo() {}`` method treatment.
        """
        source = (
            "class Foo {\n"
            "  static VERSION = 1;\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        field = result.symbols[0].children[0]
        assert field.name == "VERSION"
        assert field.kind == "variable"


# ---------------------------------------------------------------------------
# Exports
# ---------------------------------------------------------------------------


class TestExports:
    """``export`` wrappers unwrap to their inner declaration."""

    def test_export_function(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``export function foo() {}`` produces a top-level function symbol."""
        result = _extract(
            parser, extractor, "export function hello() {}\n"
        )
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "hello"
        assert sym.kind == "function"

    def test_export_class(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``export class Foo {}`` produces a top-level class symbol."""
        result = _extract(
            parser, extractor, "export class Point {}\n"
        )
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "Point"
        assert sym.kind == "class"

    def test_export_const(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``export const X = 1;`` produces a top-level variable."""
        result = _extract(
            parser, extractor, "export const X = 1;\n"
        )
        assert len(result.symbols) == 1
        assert result.symbols[0].name == "X"
        assert result.symbols[0].kind == "variable"

    def test_export_default_named_function(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``export default function foo() {}`` still yields a symbol.

        The default marker doesn't strip the name — ``foo`` is
        still the binding's identifier in-module.
        """
        result = _extract(
            parser, extractor,
            "export default function hello() {}\n",
        )
        assert len(result.symbols) == 1
        assert result.symbols[0].name == "hello"

    def test_export_default_anonymous_function(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``export default function() {}`` — anonymous → no symbol.

        Without a name there's nothing to index. The module's
        default export exists at runtime but the extractor
        can't label it.
        """
        result = _extract(
            parser, extractor,
            "export default function() {};\n",
        )
        assert result.symbols == []

    def test_export_without_declaration_produces_no_symbol(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``export { foo };`` re-exports an existing binding — no new symbol.

        Re-exports don't define a new name; the inner ``foo``
        must already exist. The extractor has nothing to
        contribute from the export statement itself.
        """
        source = (
            "function foo() {}\n"
            "export { foo };\n"
        )
        result = _extract(parser, extractor, source)
        # Only ``foo`` from the function declaration, nothing
        # extra from the export.
        names = [s.name for s in result.symbols]
        assert names == ["foo"]


# ---------------------------------------------------------------------------
# Call sites
# ---------------------------------------------------------------------------


class TestCallSites:
    """Function-body call-site extraction."""

    def test_simple_call_in_function_body(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``helper()`` inside a function body → one CallSite."""
        source = (
            "function helper() {}\n"
            "function caller() {\n"
            "  helper();\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        caller = result.symbols[1]
        assert len(caller.call_sites) == 1
        assert caller.call_sites[0].name == "helper"

    def test_call_site_line_is_one_indexed(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """CallSite.line uses 1-indexed line numbers.

        Matches the Python extractor's convention — the symbol
        map renderer wants 1-indexed lines.
        """
        source = (
            "function caller() {\n"
            "  foo();\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        site = result.symbols[0].call_sites[0]
        assert site.line == 2

    def test_member_call_uses_property_name(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``obj.foo()`` records the property, not the receiver.

        The property name is the useful bit for cross-file
        reference tracking — the receiver is runtime data we
        can't resolve statically.
        """
        source = (
            "function caller(obj) {\n"
            "  obj.handle();\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        sites = result.symbols[0].call_sites
        assert len(sites) == 1
        assert sites[0].name == "handle"

    def test_nested_member_call_uses_tail(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``a.b.c()`` records ``c`` — the final component only.

        Tree-sitter represents ``a.b.c`` as nested
        member_expression nodes; the outermost's ``property``
        field is the final component.
        """
        source = (
            "function caller() {\n"
            "  pkg.mod.func();\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        sites = result.symbols[0].call_sites
        assert len(sites) == 1
        assert sites[0].name == "func"

    def test_optional_chaining_call(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``obj?.foo()`` records ``foo`` — same as ``obj.foo()``.

        Tree-sitter-javascript represents optional chaining
        with the same member_expression shape; ``?.`` is an
        anonymous token. No special handling needed.
        """
        source = (
            "function caller(obj) {\n"
            "  obj?.handle();\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        sites = result.symbols[0].call_sites
        assert len(sites) == 1
        assert sites[0].name == "handle"

    def test_new_expression_recorded(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``new Foo()`` produces a CallSite named ``Foo``.

        Constructor calls are the main way classes reference
        each other across files; without this the reference
        graph would miss most class-to-class edges.
        """
        source = (
            "function caller() {\n"
            "  const x = new Widget();\n"
            "  return x;\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        sites = result.symbols[0].call_sites
        assert len(sites) == 1
        assert sites[0].name == "Widget"

    def test_subscript_call_skipped(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``handlers[key]()`` has no extractable name.

        Subscript expressions resolve to runtime values; we
        can't name the callee statically. The extractor skips
        these rather than inventing a name.
        """
        source = (
            "function dispatch(handlers, key) {\n"
            "  handlers[key]();\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        assert result.symbols[0].call_sites == []

    def test_call_on_call_result_produces_inner_only(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``factory()()`` — only the inner ``factory`` call is recorded.

        The outer call's callee is itself a call_expression,
        not an identifier or member expression. No static name
        to record for the outer; the inner ``factory`` IS
        recorded separately.
        """
        source = (
            "function caller() {\n"
            "  factory()();\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        names = [s.name for s in result.symbols[0].call_sites]
        assert names == ["factory"]

    def test_builtins_filtered(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """``console.log`` / ``parseInt`` / ``require`` are skipped.

        The extractor's builtin filter drops calls whose
        root identifier is a global (``console``, ``window``,
        ``Array``, etc.) or a known test-framework hook. This
        keeps the reference graph free of edges from every
        file to every other file.
        """
        source = (
            "function caller(xs) {\n"
            "  console.log(xs);\n"
            "  parseInt('42');\n"
            "  require('x');\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        assert result.symbols[0].call_sites == []

    def test_user_and_builtin_mixed(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """User calls pass through even when mixed with builtins."""
        source = (
            "function caller(xs) {\n"
            "  console.log(xs);\n"
            "  helper();\n"
            "  return parseInt(xs);\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        names = [s.name for s in result.symbols[0].call_sites]
        assert names == ["helper"]

    def test_multiple_calls_preserve_order(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """Call sites appear in source order.

        Stable ordering makes the symbol-map diff clean on
        re-extraction. The ``→`` outgoing-calls section in the
        compact format renders them in this order.
        """
        source = (
            "function caller() {\n"
            "  alpha();\n"
            "  beta();\n"
            "  gamma();\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        names = [s.name for s in result.symbols[0].call_sites]
        assert names == ["alpha", "beta", "gamma"]

    def test_calls_inside_method_body(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """Method bodies produce call sites on the method symbol.

        Same extractor path as top-level functions — the
        ``body`` field lookup finds the block regardless of
        whether it's on a function_declaration or a
        method_definition.
        """
        source = (
            "class Foo {\n"
            "  greet() {\n"
            "    helper();\n"
            "  }\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        method = result.symbols[0].children[0]
        names = [s.name for s in method.call_sites]
        assert names == ["helper"]

    def test_calls_inside_arrow_function_body(
        self,
        parser: TreeSitterParser,
        extractor: JavaScriptExtractor,
    ) -> None:
        """Arrow function bodies produce call sites on the function symbol.

        ``const foo = () => { helper(); }`` — the arrow's
        body is reached through the declarator's value node
        and its call sites are attached to the outer Symbol.
        """
        source = (
            "const foo = () => {\n"
            "  helper();\n"
            "};\n"
        )
        result = _extract(parser, extractor, source)
        sym = result.symbols[0]
        names = [s.name for s in sym.call_sites]
        assert names == ["helper"]