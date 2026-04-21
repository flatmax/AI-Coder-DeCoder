"""Tests for ac_dc.symbol_index.extractors.typescript — Layer 2.2.4.

Scope: the TypeScriptExtractor — focused on what TS *adds* over
JS (type annotations, return types, optional params, interfaces,
type aliases, enums). The JS-inherited behaviour (classes,
methods, imports, call sites, etc.) gets a single sanity class
— not a re-test of the full JS suite.

Strategy matches the JS extractor tests:
- Real tree-sitter parses via TreeSitterParser
- One test class per feature area
- Skip the module when tree_sitter_typescript isn't installed

Diagnostic-first for any grammar shape we aren't 100% sure
about — one ``pytest -s`` run produces the authoritative
node types before we write the extractor code that depends
on them. Lesson from the JS round (class fields).
"""

from __future__ import annotations

import pytest

from ac_dc.symbol_index.extractors.typescript import TypeScriptExtractor
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
def extractor() -> TypeScriptExtractor:
    """Fresh TypeScript extractor per test."""
    return TypeScriptExtractor()


def _extract(
    parser: TreeSitterParser,
    extractor: TypeScriptExtractor,
    source: str,
    path: str = "test.ts",
) -> FileSymbols:
    """Parse and extract in one step — skips when grammar missing."""
    if not parser.is_available("typescript"):
        pytest.skip("tree_sitter_typescript not installed")
    source_bytes = source.encode("utf-8")
    tree = parser.parse(source_bytes, "typescript")
    assert tree is not None
    return extractor.extract(tree, source_bytes, path)


# ---------------------------------------------------------------------------
# JS-inherited behaviour — sanity only
# ---------------------------------------------------------------------------


class TestJavaScriptInheritanceSanity:
    """One-test-per-feature smoke suite proving JS behaviour flows through.

    TypeScriptExtractor inherits from JavaScriptExtractor, so
    every behaviour covered by the JS test suite should work on
    TS source too. We don't re-run the entire JS suite here —
    just enough to catch a case where the TS grammar diverges
    in a way that breaks the inherited extractor.
    """

    def test_function_declaration(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """Plain function declaration parses and extracts on TS."""
        result = _extract(parser, extractor, "function hello() {}\n")
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "hello"
        assert sym.kind == "function"

    def test_class_with_extends(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """``class Foo extends Bar`` — inheritance still works on TS."""
        result = _extract(
            parser, extractor, "class Foo extends Bar {}\n"
        )
        assert result.symbols[0].bases == ["Bar"]

    def test_import_statement(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """Named imports — JS-inherited handling works on TS."""
        result = _extract(
            parser, extractor, 'import { a, b } from "x";\n'
        )
        assert len(result.imports) == 1
        assert result.imports[0].module == "x"
        assert result.imports[0].names == ["a", "b"]

    def test_call_site_in_function_body(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """Call-site extraction flows through to TS source."""
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

    def test_export_wrapper(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """``export function foo() {}`` unwraps to a function symbol."""
        result = _extract(
            parser, extractor, "export function hello() {}\n"
        )
        assert len(result.symbols) == 1
        assert result.symbols[0].name == "hello"
        assert result.symbols[0].kind == "function"


# ---------------------------------------------------------------------------
# Parameter type annotations
# ---------------------------------------------------------------------------


class TestParameterTypes:
    """TS-specific parameter handling — types, optionals, defaults."""

    def test_typed_parameter(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """``function f(x: string)`` → parameter carries the type text."""
        result = _extract(
            parser, extractor, "function f(x: string) {}\n"
        )
        params = result.symbols[0].parameters
        assert len(params) == 1
        assert params[0].name == "x"
        assert params[0].type_annotation == "string"

    def test_multiple_typed_parameters(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """Each parameter records its own type independently."""
        result = _extract(
            parser, extractor,
            "function f(a: string, b: number) {}\n",
        )
        params = result.symbols[0].parameters
        assert [p.name for p in params] == ["a", "b"]
        assert [p.type_annotation for p in params] == ["string", "number"]

    def test_typed_parameter_with_default(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """``x: number = 10`` records both type and default."""
        result = _extract(
            parser, extractor,
            "function f(x: number = 10) {}\n",
        )
        p = result.symbols[0].parameters[0]
        assert p.name == "x"
        assert p.type_annotation == "number"
        assert p.default == "10"

    def test_optional_parameter_marker(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """``x?: string`` — name carries a trailing '?' marker.

        The extractor encodes optionality by suffixing the
        parameter name with ``?`` rather than adding a separate
        field on :class:`Parameter`. Consumers get the signal
        directly in the rendered signature.
        """
        result = _extract(
            parser, extractor,
            "function f(x?: string) {}\n",
        )
        p = result.symbols[0].parameters[0]
        assert p.name == "x?"
        assert p.type_annotation == "string"

    def test_generic_type_preserved_as_source_text(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """``Array<string>`` survives round-trip as the annotation."""
        result = _extract(
            parser, extractor,
            "function f(xs: Array<string>) {}\n",
        )
        p = result.symbols[0].parameters[0]
        assert p.type_annotation == "Array<string>"

    def test_union_type_preserved_as_source_text(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """``string | number`` round-trips verbatim.

        We don't model the union structurally; capturing source
        text is enough for symbol-map display. Grammar versions
        may vary slightly in whitespace, so we check content
        rather than exact spelling.
        """
        result = _extract(
            parser, extractor,
            "function f(x: string | number) {}\n",
        )
        p = result.symbols[0].parameters[0]
        assert p.type_annotation is not None
        assert "string" in p.type_annotation
        assert "number" in p.type_annotation

    def test_rest_parameter_still_works(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """``...args: string[]`` — rest pattern falls through to JS path.

        Rest parameters in TS aren't wrapped in
        ``required_parameter`` — they keep the JS ``rest_pattern``
        shape. The TS ``_build_parameter`` dispatch has to fall
        through to the JS base when it sees a non-TS-wrapper
        node type. This test pins the fallback path down.
        """
        result = _extract(
            parser, extractor,
            "function f(...args: string[]) {}\n",
        )
        p = result.symbols[0].parameters[0]
        assert p.name == "args"
        assert p.is_vararg is True


# ---------------------------------------------------------------------------
# Return types on functions and methods
# ---------------------------------------------------------------------------


class TestReturnTypes:
    """Return-type annotations on functions, methods, and arrow values."""

    def test_function_return_type(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """``function f(): string`` → Symbol.return_type == 'string'."""
        result = _extract(
            parser, extractor,
            "function f(): string { return ''; }\n",
        )
        assert result.symbols[0].return_type == "string"

    def test_function_return_type_generic(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """Generic return types round-trip verbatim as source text."""
        result = _extract(
            parser, extractor,
            "function f(): Promise<void> { return Promise.resolve(); }\n",
        )
        assert result.symbols[0].return_type == "Promise<void>"

    def test_function_no_return_type_is_none(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """Absent annotation → return_type stays None.

        Matches the Python extractor's convention — missing type
        info is None, not an empty string or some sentinel.
        """
        result = _extract(
            parser, extractor, "function f() { return; }\n"
        )
        assert result.symbols[0].return_type is None

    def test_method_return_type(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """Method return type annotation is captured on the method symbol."""
        source = (
            "class Foo {\n"
            "  greet(name: string): string { return name; }\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        method = result.symbols[0].children[0]
        assert method.name == "greet"
        assert method.return_type == "string"

    def test_arrow_function_return_type(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """Arrow-valued declarations pick up the return type.

        ``const foo = (): string => ''`` — the return type lives
        on the arrow_function node, not on the declarator. The
        extractor's ``_populate_function_from_value`` override
        handles that.
        """
        result = _extract(
            parser, extractor,
            "const foo = (): string => '';\n",
        )
        sym = result.symbols[0]
        assert sym.name == "foo"
        assert sym.kind == "function"
        assert sym.return_type == "string"

    def test_function_expression_return_type(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """``const foo = function(): number {}`` picks up the return type."""
        result = _extract(
            parser, extractor,
            "const foo = function(): number { return 1; };\n",
        )
        assert result.symbols[0].return_type == "number"


# ---------------------------------------------------------------------------
# Interfaces
# ---------------------------------------------------------------------------


class TestInterfaces:
    """Interface declarations — treated as classes with member children."""

    def test_empty_interface(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """``interface Foo {}`` → Symbol(kind='class') with no children."""
        result = _extract(parser, extractor, "interface Foo {}\n")
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "Foo"
        assert sym.kind == "class"
        assert sym.children == []
        assert sym.bases == []

    def test_interface_method_signature(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """Method signatures in an interface become method children."""
        source = (
            "interface Greeter {\n"
            "  greet(name: string): string;\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        iface = result.symbols[0]
        assert iface.name == "Greeter"
        assert len(iface.children) == 1
        method = iface.children[0]
        assert method.name == "greet"
        assert method.kind == "method"
        assert [p.name for p in method.parameters] == ["name"]
        assert method.parameters[0].type_annotation == "string"
        assert method.return_type == "string"

    def test_interface_property_signature(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """Property signatures become variable children with type info.

        The type annotation lifts into ``return_type`` so the
        symbol map renders ``name -> string`` the same way it
        renders a function's return type. Not strictly a return
        type, but the renderer uses that field to display a
        trailing type annotation.
        """
        source = (
            "interface Person {\n"
            "  name: string;\n"
            "  age: number;\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        iface = result.symbols[0]
        assert len(iface.children) == 2
        name_field = iface.children[0]
        assert name_field.name == "name"
        assert name_field.kind == "variable"
        assert name_field.return_type == "string"
        age_field = iface.children[1]
        assert age_field.name == "age"
        assert age_field.return_type == "number"

    def test_interface_optional_property(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """Optional properties carry the '?' marker in the name."""
        source = (
            "interface Config {\n"
            "  verbose?: boolean;\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        field = result.symbols[0].children[0]
        assert field.name == "verbose?"
        assert field.return_type == "boolean"

    def test_interface_single_extends(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """``interface Foo extends Bar {}`` → bases=['Bar']."""
        result = _extract(
            parser, extractor,
            "interface Foo extends Bar {}\n",
        )
        assert result.symbols[0].bases == ["Bar"]

    def test_interface_multiple_extends(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """Interfaces support multiple inheritance.

        Unlike JS classes, TS interfaces can extend multiple
        bases in a single clause. Each base lands as its own
        entry in the bases list in source order.
        """
        result = _extract(
            parser, extractor,
            "interface Foo extends Bar, Baz {}\n",
        )
        assert result.symbols[0].bases == ["Bar", "Baz"]

    def test_interface_mixed_members_preserve_order(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """Method and property signatures preserve source order."""
        source = (
            "interface Mixed {\n"
            "  count: number;\n"
            "  bump(): void;\n"
            "  name: string;\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        iface = result.symbols[0]
        names = [c.name for c in iface.children]
        assert names == ["count", "bump", "name"]


# ---------------------------------------------------------------------------
# Type aliases
# ---------------------------------------------------------------------------


class TestTypeAliases:
    """``type X = ...`` declarations produce bare-name variable symbols."""

    def test_simple_type_alias(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """``type ID = string`` → Symbol(kind='variable', name='ID')."""
        result = _extract(
            parser, extractor, "type ID = string;\n"
        )
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "ID"
        assert sym.kind == "variable"

    def test_object_type_alias(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """``type Point = { x: number; y: number }`` — name only, no members.

        The aliased structure isn't rendered — the symbol map
        just lists the name. If the LLM needs the detail it
        loads the file.
        """
        result = _extract(
            parser, extractor,
            "type Point = { x: number; y: number };\n",
        )
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "Point"
        assert sym.kind == "variable"
        assert sym.children == []

    def test_union_type_alias(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """``type Status = 'on' | 'off'`` produces the name symbol."""
        result = _extract(
            parser, extractor,
            "type Status = 'on' | 'off';\n",
        )
        assert result.symbols[0].name == "Status"
        assert result.symbols[0].kind == "variable"

    def test_generic_type_alias(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """Generic params don't affect extraction — just the name matters.

        ``type Box<T> = { value: T }`` — the ``<T>`` generic
        parameter sits on the type alias node but isn't
        surfaced as a symbol. The extractor captures only the
        alias name.
        """
        result = _extract(
            parser, extractor,
            "type Box<T> = { value: T };\n",
        )
        assert result.symbols[0].name == "Box"
        assert result.symbols[0].kind == "variable"


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class TestEnums:
    """Enum declarations — treated as classes with variable children."""

    def test_simple_enum(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """``enum Color { Red, Green, Blue }`` → class with 3 children."""
        result = _extract(
            parser, extractor,
            "enum Color { Red, Green, Blue }\n",
        )
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "Color"
        assert sym.kind == "class"
        assert len(sym.children) == 3
        names = [c.name for c in sym.children]
        assert names == ["Red", "Green", "Blue"]
        assert all(c.kind == "variable" for c in sym.children)

    def test_enum_with_explicit_values(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """``enum Code { A = 1, B = 2 }`` — assigned values are ignored."""
        result = _extract(
            parser, extractor,
            "enum Code { A = 1, B = 2 }\n",
        )
        sym = result.symbols[0]
        assert sym.name == "Code"
        names = [c.name for c in sym.children]
        assert names == ["A", "B"]

    def test_enum_with_string_values(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """String-valued enum — member names still surface correctly."""
        result = _extract(
            parser, extractor,
            'enum Status { On = "on", Off = "off" }\n',
        )
        sym = result.symbols[0]
        names = [c.name for c in sym.children]
        assert names == ["On", "Off"]

    def test_empty_enum(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """``enum Empty {}`` — no members, still a valid class symbol."""
        result = _extract(
            parser, extractor, "enum Empty {}\n"
        )
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "Empty"
        assert sym.kind == "class"
        assert sym.children == []

    def test_enum_members_preserve_order(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """Enum members appear in source order on children."""
        result = _extract(
            parser, extractor,
            "enum Direction { North, South, East, West }\n",
        )
        sym = result.symbols[0]
        names = [c.name for c in sym.children]
        assert names == ["North", "South", "East", "West"]

    def test_exported_enum(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """``export enum Color { Red }`` unwraps through the export handler."""
        result = _extract(
            parser, extractor,
            "export enum Color { Red, Green }\n",
        )
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "Color"
        assert sym.kind == "class"
        assert [c.name for c in sym.children] == ["Red", "Green"]


# ---------------------------------------------------------------------------
# Export unwrapping for TS-specific declarations
# ---------------------------------------------------------------------------


class TestExportOfTypeScriptDeclarations:
    """``export interface`` / ``export type`` flow through export handler.

    The JS extractor's ``_handle_export`` delegates the inner
    declaration to ``_handle_top_level``. That dispatcher is
    overridden on TS to add interface/type-alias/enum cases.
    Together, ``export`` + TS-specific declaration works end
    to end — these tests pin the integration.
    """

    def test_exported_interface(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """``export interface Foo { greet(): void }`` extracts fully."""
        source = (
            "export interface Greeter {\n"
            "  greet(): void;\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        assert len(result.symbols) == 1
        iface = result.symbols[0]
        assert iface.name == "Greeter"
        assert iface.kind == "class"
        assert len(iface.children) == 1
        assert iface.children[0].name == "greet"

    def test_exported_type_alias(
        self,
        parser: TreeSitterParser,
        extractor: TypeScriptExtractor,
    ) -> None:
        """``export type ID = string`` produces the name symbol."""
        result = _extract(
            parser, extractor, "export type ID = string;\n"
        )
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "ID"
        assert sym.kind == "variable"