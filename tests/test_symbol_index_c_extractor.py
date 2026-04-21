"""Tests for ac_dc.symbol_index.extractors.c — Layer 2.2.5.

Scope: CExtractor — functions (definitions and prototypes),
structs, unions, enums, typedefs, #include, globals, call sites,
parameters including function-pointer and variadic shapes.

Strategy matches the other extractor tests:
- Real tree-sitter parses via TreeSitterParser
- One test class per feature area
- Skip the module when tree_sitter_c isn't installed
"""

from __future__ import annotations

import pytest

from ac_dc.symbol_index.extractors.c import CExtractor
from ac_dc.symbol_index.models import FileSymbols
from ac_dc.symbol_index.parser import TreeSitterParser


@pytest.fixture
def parser() -> TreeSitterParser:
    """Fresh parser per test — no singleton coupling between tests."""
    return TreeSitterParser()


@pytest.fixture
def extractor() -> CExtractor:
    """Fresh extractor per test."""
    return CExtractor()


def _extract(
    parser: TreeSitterParser,
    extractor: CExtractor,
    source: str,
    path: str = "test.c",
) -> FileSymbols:
    """Parse and extract in one step — skips when grammar missing."""
    if not parser.is_available("c"):
        pytest.skip("tree_sitter_c not installed")
    source_bytes = source.encode("utf-8")
    tree = parser.parse(source_bytes, "c")
    assert tree is not None
    return extractor.extract(tree, source_bytes, path)


class TestExtractionContract:
    """Top-level shape — empty source, tree=None, path passthrough."""

    def test_empty_source_returns_empty_file_symbols(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """No symbols, no imports, path populated."""
        result = _extract(parser, extractor, "", "empty.c")
        assert isinstance(result, FileSymbols)
        assert result.file_path == "empty.c"
        assert result.symbols == []
        assert result.imports == []

    def test_path_passthrough(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """The path argument is recorded on FileSymbols and children."""
        result = _extract(
            parser, extractor,
            "int hello(void) { return 0; }\n",
            path="src/mod.c",
        )
        assert result.file_path == "src/mod.c"
        assert result.symbols[0].file_path == "src/mod.c"

    def test_tree_none_returns_empty_result(
        self, extractor: CExtractor
    ) -> None:
        """Defensive: tree=None produces an empty FileSymbols."""
        result = extractor.extract(None, b"", "foo.c")
        assert isinstance(result, FileSymbols)
        assert result.file_path == "foo.c"
        assert result.symbols == []
        assert result.imports == []

    def test_top_level_symbols_preserve_source_order(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """Top-level symbols emit in source order — matters for diffs."""
        source = (
            "int alpha(void) { return 1; }\n"
            "struct Beta { int x; };\n"
            "int gamma = 42;\n"
        )
        result = _extract(parser, extractor, source)
        names = [s.name for s in result.symbols]
        assert names == ["alpha", "Beta", "gamma"]


class TestIncludes:
    """``#include`` directive extraction."""

    def test_local_include(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``#include "local.h"`` strips the quotes from module name."""
        result = _extract(parser, extractor, '#include "local.h"\n')
        assert len(result.imports) == 1
        imp = result.imports[0]
        assert imp.module == "local.h"
        assert imp.line == 1

    def test_system_include(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``#include <stdio.h>`` strips the angle brackets."""
        result = _extract(parser, extractor, "#include <stdio.h>\n")
        assert len(result.imports) == 1
        assert result.imports[0].module == "stdio.h"

    def test_multiple_includes_order_preserved(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """Multiple includes come back in source order."""
        source = (
            "#include <stdio.h>\n"
            "#include <stdlib.h>\n"
            '#include "mymod.h"\n'
        )
        result = _extract(parser, extractor, source)
        assert [i.module for i in result.imports] == [
            "stdio.h",
            "stdlib.h",
            "mymod.h",
        ]

    def test_include_line_is_one_indexed(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """Import.line is 1-indexed, matching other extractors."""
        source = (
            "// preamble comment\n"
            "#include <stdio.h>\n"
        )
        result = _extract(parser, extractor, source)
        assert result.imports[0].line == 2

    def test_include_with_subdirectory(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``#include "sub/header.h"`` preserves the path."""
        result = _extract(
            parser, extractor, '#include "sub/header.h"\n'
        )
        assert result.imports[0].module == "sub/header.h"

    def test_includes_do_not_produce_symbols(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """Includes go to ``imports``, never to ``symbols``."""
        result = _extract(
            parser, extractor,
            "#include <stdio.h>\n#include <stdlib.h>\n",
        )
        assert result.imports
        assert result.symbols == []


class TestFunctionDefinitions:
    """Full function definitions with a body."""

    def test_simple_function(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``int hello(void) { return 0; }`` → Symbol(kind='function')."""
        result = _extract(
            parser, extractor,
            "int hello(void) { return 0; }\n",
        )
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "hello"
        assert sym.kind == "function"
        assert sym.return_type == "int"

    def test_function_with_void_params_has_empty_parameter_list(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``(void)`` is C's "takes no arguments" convention.

        Semantically it's "no parameters". The extractor collapses
        the single ``void`` parameter_declaration to an empty list.
        """
        result = _extract(
            parser, extractor,
            "int hello(void) { return 0; }\n",
        )
        assert result.symbols[0].parameters == []

    def test_function_with_parameters(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``int add(int a, int b)`` produces two typed parameters."""
        result = _extract(
            parser, extractor,
            "int add(int a, int b) { return a + b; }\n",
        )
        sym = result.symbols[0]
        assert [p.name for p in sym.parameters] == ["a", "b"]
        assert [p.type_annotation for p in sym.parameters] == [
            "int",
            "int",
        ]

    def test_function_returning_pointer(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``char *foo(void) {}`` — pointer return handled via unwrap.

        The declarator is wrapped in pointer_declarator. The
        extractor's ``_unwrap_declarator`` peels it to find the
        function_declarator underneath.
        """
        result = _extract(
            parser, extractor,
            "char *foo(void) { return 0; }\n",
        )
        assert len(result.symbols) == 1
        assert result.symbols[0].name == "foo"
        assert result.symbols[0].kind == "function"

    def test_multiple_functions_preserve_order(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """Multiple function definitions appear in source order."""
        source = (
            "int alpha(void) { return 1; }\n"
            "int beta(void) { return 2; }\n"
            "int gamma(void) { return 3; }\n"
        )
        result = _extract(parser, extractor, source)
        names = [s.name for s in result.symbols]
        assert names == ["alpha", "beta", "gamma"]

    def test_function_range_is_zero_indexed(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """Symbol.range uses tree-sitter's 0-indexed row/col."""
        result = _extract(
            parser, extractor,
            "int foo(void) { return 0; }\n",
        )
        start_row, start_col, _, _ = result.symbols[0].range
        assert start_row == 0
        assert start_col == 0

    def test_static_function_still_indexed(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``static`` storage class doesn't hide the symbol.

        specs4 calls this out explicitly — storage class isn't
        surfaced in the kind. Internal linkage is an
        implementation detail for the LLM's purposes.
        """
        result = _extract(
            parser, extractor,
            "static int helper(void) { return 0; }\n",
        )
        assert len(result.symbols) == 1
        assert result.symbols[0].name == "helper"
        assert result.symbols[0].kind == "function"


class TestFunctionPrototypes:
    """Function prototypes (declarations without a body).

    Common in header files. Both prototypes and definitions
    produce symbols so headers still have navigable entries.
    """

    def test_simple_prototype(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``int foo(int x);`` → function symbol with no body."""
        result = _extract(parser, extractor, "int foo(int x);\n")
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "foo"
        assert sym.kind == "function"
        assert sym.return_type == "int"
        # No body, so no call sites.
        assert sym.call_sites == []

    def test_prototype_with_named_parameters(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """Prototype with named parameters captures the names."""
        result = _extract(
            parser, extractor,
            "int add(int a, int b);\n",
        )
        params = result.symbols[0].parameters
        assert [p.name for p in params] == ["a", "b"]

    def test_prototype_with_unnamed_parameters(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``int add(int, int);`` — type-only parameters.

        Valid C prototype syntax. The extractor surfaces empty
        names so the parameter count is preserved.
        """
        result = _extract(
            parser, extractor,
            "int add(int, int);\n",
        )
        params = result.symbols[0].parameters
        assert len(params) == 2
        assert all(p.name == "" for p in params)
        assert all(p.type_annotation == "int" for p in params)

    def test_prototype_and_definition_both_indexed(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """Prototype followed by definition produces two symbols.

        Both are legitimate — a header might declare a prototype
        and the implementation file might define it. In the rare
        case both appear in one file, we don't deduplicate.
        """
        source = (
            "int foo(int x);\n"
            "int foo(int x) { return x + 1; }\n"
        )
        result = _extract(parser, extractor, source)
        assert len(result.symbols) == 2
        assert all(s.name == "foo" for s in result.symbols)

    def test_prototype_with_void_params(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``int foo(void);`` treats the void as no parameters."""
        result = _extract(parser, extractor, "int foo(void);\n")
        assert result.symbols[0].parameters == []


class TestParameters:
    """Parameter extraction — every shape C grammar emits."""

    def test_pointer_parameter(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``char *name`` — pointer declarator wraps the identifier."""
        result = _extract(
            parser, extractor,
            "void greet(char *name) { }\n",
        )
        params = result.symbols[0].parameters
        assert len(params) == 1
        assert params[0].name == "name"
        assert params[0].type_annotation == "char"

    def test_const_pointer_parameter(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``const char *name`` — const qualifier preserved in type."""
        result = _extract(
            parser, extractor,
            "void greet(const char *name) { }\n",
        )
        params = result.symbols[0].parameters
        assert len(params) == 1
        assert params[0].name == "name"
        ann = params[0].type_annotation or ""
        assert "const" in ann
        assert "char" in ann

    def test_array_parameter(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``int xs[]`` — array declarator wraps the identifier."""
        result = _extract(
            parser, extractor,
            "int sum(int xs[], int n) { return 0; }\n",
        )
        params = result.symbols[0].parameters
        assert len(params) == 2
        assert params[0].name == "xs"
        assert params[1].name == "n"

    def test_variadic_parameter(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``int wrap(const char *fmt, ...);`` — variadic flag set."""
        result = _extract(
            parser, extractor,
            "int wrap(const char *fmt, ...);\n",
        )
        params = result.symbols[0].parameters
        assert len(params) == 2
        assert params[0].name == "fmt"
        assert params[1].is_vararg is True

    def test_function_pointer_parameter(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``void (*cb)(int)`` — function-pointer parameter."""
        result = _extract(
            parser, extractor,
            "void run(void (*cb)(int)) { }\n",
        )
        params = result.symbols[0].parameters
        assert len(params) == 1
        # Grammar-version-dependent whether the name extracts
        # cleanly — accept identifier or empty.
        assert params[0].name in ("cb", "")

    def test_multiple_parameters_preserve_order(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """Parameter order matches source order."""
        result = _extract(
            parser, extractor,
            "int fn(int a, char b, float c) { return 0; }\n",
        )
        params = result.symbols[0].parameters
        assert [p.name for p in params] == ["a", "b", "c"]


class TestStructs:
    """Struct and union definitions — kind='class', member children."""

    def test_simple_struct(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``struct Point { int x; int y; };`` → class with two fields."""
        source = (
            "struct Point {\n"
            "    int x;\n"
            "    int y;\n"
            "};\n"
        )
        result = _extract(parser, extractor, source)
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "Point"
        assert sym.kind == "class"
        assert len(sym.children) == 2
        assert [c.name for c in sym.children] == ["x", "y"]
        assert all(c.kind == "variable" for c in sym.children)

    def test_struct_with_pointer_field(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``char *name;`` — pointer field's name is extracted."""
        source = (
            "struct Person {\n"
            "    char *name;\n"
            "    int age;\n"
            "};\n"
        )
        result = _extract(parser, extractor, source)
        sym = result.symbols[0]
        assert [c.name for c in sym.children] == ["name", "age"]

    def test_struct_with_multiple_fields_per_declaration(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``int x, y;`` declares two fields in one line."""
        source = (
            "struct Point {\n"
            "    int x, y;\n"
            "};\n"
        )
        result = _extract(parser, extractor, source)
        sym = result.symbols[0]
        names = [c.name for c in sym.children]
        assert "x" in names
        assert "y" in names

    def test_struct_with_function_pointer_field(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``int (*cb)(int);`` — function-pointer field as variable."""
        source = (
            "struct Handlers {\n"
            "    int (*cb)(int);\n"
            "    int other;\n"
            "};\n"
        )
        result = _extract(parser, extractor, source)
        sym = result.symbols[0]
        names = [c.name for c in sym.children]
        assert "cb" in names
        assert "other" in names

    def test_anonymous_struct_skipped(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``struct { int x; } foo;`` — anonymous, no struct symbol.

        The anonymous struct itself produces no symbol. The
        containing declaration produces a variable symbol for
        ``foo`` which is what users navigate to.
        """
        source = "struct { int x; } foo;\n"
        result = _extract(parser, extractor, source)
        names = [s.name for s in result.symbols]
        assert "foo" in names

    def test_empty_struct(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``struct Empty { };`` — valid class symbol with no children."""
        result = _extract(
            parser, extractor,
            "struct Empty { };\n",
        )
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "Empty"
        assert sym.kind == "class"
        assert sym.children == []

    def test_union_becomes_class(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """Unions are rendered as classes — same treatment as structs."""
        source = (
            "union Value {\n"
            "    int i;\n"
            "    float f;\n"
            "};\n"
        )
        result = _extract(parser, extractor, source)
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "Value"
        assert sym.kind == "class"
        assert [c.name for c in sym.children] == ["i", "f"]


class TestEnums:
    """Enum definitions — kind='class' with variable children."""

    def test_simple_enum(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``enum Color { RED, GREEN, BLUE };`` → class with 3 children."""
        result = _extract(
            parser, extractor,
            "enum Color { RED, GREEN, BLUE };\n",
        )
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "Color"
        assert sym.kind == "class"
        assert [c.name for c in sym.children] == ["RED", "GREEN", "BLUE"]
        assert all(c.kind == "variable" for c in sym.children)

    def test_enum_with_explicit_values(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``enum Code { A = 1, B = 2 };`` — values ignored, names kept."""
        result = _extract(
            parser, extractor,
            "enum Code { A = 1, B = 2 };\n",
        )
        sym = result.symbols[0]
        assert [c.name for c in sym.children] == ["A", "B"]

    def test_empty_enum(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``enum Empty { };`` — valid, no children."""
        result = _extract(
            parser, extractor,
            "enum Empty { };\n",
        )
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "Empty"
        assert sym.kind == "class"
        assert sym.children == []

    def test_enum_members_preserve_order(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """Enum members appear in source order on children."""
        result = _extract(
            parser, extractor,
            "enum Direction { NORTH, SOUTH, EAST, WEST };\n",
        )
        sym = result.symbols[0]
        names = [c.name for c in sym.children]
        assert names == ["NORTH", "SOUTH", "EAST", "WEST"]


class TestTypedefs:
    """``typedef`` declarations — surface the typedef name."""

    def test_simple_typedef(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``typedef int mytype_t;`` → variable symbol named mytype_t."""
        result = _extract(
            parser, extractor,
            "typedef int mytype_t;\n",
        )
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "mytype_t"
        assert sym.kind == "variable"

    def test_typedef_of_named_struct(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``typedef struct Foo { ... } FooAlias;`` → two symbols.

        The struct itself is indexed as ``Foo`` (class), and the
        typedef name ``FooAlias`` is indexed separately as a
        variable. Both produce navigable entries.
        """
        source = (
            "typedef struct Foo {\n"
            "    int x;\n"
            "} FooAlias;\n"
        )
        result = _extract(parser, extractor, source)
        names = [s.name for s in result.symbols]
        assert "Foo" in names
        assert "FooAlias" in names

    def test_typedef_of_anonymous_struct(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``typedef struct { ... } Alias;`` → one symbol (the alias).

        Anonymous struct contributes no struct symbol. The
        typedef name becomes a variable. This is the common
        pattern for typedef'd plain-data types.
        """
        source = (
            "typedef struct {\n"
            "    int x;\n"
            "} Point;\n"
        )
        result = _extract(parser, extractor, source)
        names = [s.name for s in result.symbols]
        assert "Point" in names

    def test_typedef_pointer(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``typedef char *string_t;`` → surfaces the pointer alias."""
        result = _extract(
            parser, extractor,
            "typedef char *string_t;\n",
        )
        names = [s.name for s in result.symbols]
        assert "string_t" in names

    def test_typedef_of_enum(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``typedef enum { ... } Status;`` → typedef alias surfaces."""
        source = (
            "typedef enum {\n"
            "    OK,\n"
            "    ERR\n"
            "} Status;\n"
        )
        result = _extract(parser, extractor, source)
        names = [s.name for s in result.symbols]
        assert "Status" in names


class TestGlobalVariables:
    """Global variable declarations — surfaced as variable symbols."""

    def test_simple_global(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``int counter;`` → variable symbol."""
        result = _extract(parser, extractor, "int counter;\n")
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "counter"
        assert sym.kind == "variable"

    def test_global_with_initializer(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``int answer = 42;`` — init_declarator handled."""
        result = _extract(
            parser, extractor, "int answer = 42;\n"
        )
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "answer"
        assert sym.kind == "variable"

    def test_global_pointer(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``char *name;`` — pointer declarator unwrapped to name."""
        result = _extract(parser, extractor, "char *name;\n")
        assert len(result.symbols) == 1
        assert result.symbols[0].name == "name"

    def test_const_global(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``const int MAX = 100;`` — const qualifier doesn't hide it."""
        result = _extract(
            parser, extractor, "const int MAX = 100;\n"
        )
        assert len(result.symbols) == 1
        assert result.symbols[0].name == "MAX"

    def test_static_global(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``static int internal = 0;`` — storage class doesn't hide."""
        result = _extract(
            parser, extractor, "static int internal = 0;\n"
        )
        assert len(result.symbols) == 1
        assert result.symbols[0].name == "internal"


class TestCallSites:
    """Function body call-site extraction."""

    def test_simple_call_in_function_body(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``helper()`` inside a function body → one CallSite."""
        source = (
            "int helper(void) { return 0; }\n"
            "int caller(void) {\n"
            "    return helper();\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        caller = result.symbols[1]
        assert len(caller.call_sites) == 1
        assert caller.call_sites[0].name == "helper"

    def test_call_site_line_is_one_indexed(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """CallSite.line uses 1-indexed line numbers."""
        source = (
            "int caller(void) {\n"
            "    foo();\n"
            "    return 0;\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        site = result.symbols[0].call_sites[0]
        assert site.line == 2

    def test_field_expression_call_uses_field_name(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``obj->handler(x)`` records the field name, not the receiver."""
        source = (
            "struct Foo { int (*handler)(int); };\n"
            "int caller(struct Foo *obj) {\n"
            "    return obj->handler(1);\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        # Find the caller function — the struct definition
        # produces a symbol too.
        caller = next(s for s in result.symbols if s.name == "caller")
        assert len(caller.call_sites) == 1
        assert caller.call_sites[0].name == "handler"

    def test_dot_field_call_uses_field_name(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``obj.handler(x)`` records the field name too."""
        source = (
            "struct Foo { int (*handler)(int); };\n"
            "int caller(struct Foo obj) {\n"
            "    return obj.handler(1);\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        caller = next(s for s in result.symbols if s.name == "caller")
        assert len(caller.call_sites) == 1
        assert caller.call_sites[0].name == "handler"

    def test_builtins_filtered(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``printf``, ``malloc``, ``free`` etc. are skipped.

        These stdlib calls would otherwise produce edges from
        every source file in the reference graph. The extractor
        maintains a filter set to suppress them.
        """
        source = (
            "int caller(void) {\n"
            "    printf(\"hello\");\n"
            "    void *p = malloc(64);\n"
            "    free(p);\n"
            "    return 0;\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        assert result.symbols[0].call_sites == []

    def test_user_and_builtin_mixed(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """User calls pass through even when mixed with builtins."""
        source = (
            "int helper(int x);\n"
            "int caller(int n) {\n"
            "    printf(\"%d\", n);\n"
            "    return helper(n);\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        caller = next(s for s in result.symbols if s.name == "caller")
        names = [s.name for s in caller.call_sites]
        assert names == ["helper"]

    def test_multiple_calls_preserve_order(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """Call sites appear in source order."""
        source = (
            "int a(void);\n"
            "int b(void);\n"
            "int c(void);\n"
            "int caller(void) {\n"
            "    a();\n"
            "    b();\n"
            "    c();\n"
            "    return 0;\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        caller = next(s for s in result.symbols if s.name == "caller")
        names = [s.name for s in caller.call_sites]
        assert names == ["a", "b", "c"]

    def test_sizeof_filtered(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """``sizeof(x)`` — builtin, filtered.

        Some grammar versions parse ``sizeof`` as a call
        expression. It's in the builtin set so it's filtered
        regardless of how the grammar represents it.
        """
        source = (
            "int caller(void) {\n"
            "    return sizeof(int);\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        assert result.symbols[0].call_sites == []

    def test_nested_calls(
        self,
        parser: TreeSitterParser,
        extractor: CExtractor,
    ) -> None:
        """Calls nested inside other call arguments are extracted.

        ``outer(inner())`` — both ``outer`` and ``inner`` are
        call expressions; the walk descends into arguments so
        both sites are recorded.
        """
        source = (
            "int inner(void);\n"
            "int outer(int x);\n"
            "int caller(void) {\n"
            "    return outer(inner());\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        caller = next(s for s in result.symbols if s.name == "caller")
        names = {s.name for s in caller.call_sites}
        assert names == {"inner", "outer"}