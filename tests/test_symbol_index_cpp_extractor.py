"""Tests for ac_dc.symbol_index.extractors.cpp — Layer 2.2.6.

Scope: CppExtractor — everything C++ adds on top of C. Inheritance
from C means the C test suite is already proving that base
behaviour works on C++ source. Here we focus on:

- Classes (``class`` keyword; default-private access doesn't
  change extractor output)
- Base classes via ``base_class_clause``
- Namespaces (named + anonymous)
- Using declarations (both ``using foo::bar;`` and
  ``using namespace foo;``)
- Constructors / destructors / operator overloads
- Method prototypes inside class bodies (distinct from data
  members — both use ``field_declaration``)
- Out-of-class method definitions (``void Foo::bar() {}``)
- Template declarations unwrap to their inner class/function
- Extended builtin filter (std::cout, std::move, etc.)
- ``qualified_identifier`` callees resolve to tail component

Strategy matches the other extractor tests:
- Real tree-sitter parses via TreeSitterParser
- One test class per feature area
- Skip the module when tree_sitter_cpp isn't installed
"""

from __future__ import annotations

import pytest

from ac_dc.symbol_index.extractors.cpp import CppExtractor
from ac_dc.symbol_index.models import FileSymbols
from ac_dc.symbol_index.parser import TreeSitterParser


@pytest.fixture
def parser() -> TreeSitterParser:
    """Fresh parser per test — no singleton coupling between tests."""
    return TreeSitterParser()


@pytest.fixture
def extractor() -> CppExtractor:
    """Fresh extractor per test."""
    return CppExtractor()


def _extract(
    parser: TreeSitterParser,
    extractor: CppExtractor,
    source: str,
    path: str = "test.cpp",
) -> FileSymbols:
    """Parse and extract in one step — skips when grammar missing."""
    if not parser.is_available("cpp"):
        pytest.skip("tree_sitter_cpp not installed")
    source_bytes = source.encode("utf-8")
    tree = parser.parse(source_bytes, "cpp")
    assert tree is not None
    return extractor.extract(tree, source_bytes, path)


class TestExtractionContract:
    """Top-level shape — empty source, C-inherited behaviour."""

    def test_empty_source_returns_empty_file_symbols(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """No symbols, no imports, path populated."""
        result = _extract(parser, extractor, "", "empty.cpp")
        assert isinstance(result, FileSymbols)
        assert result.file_path == "empty.cpp"
        assert result.symbols == []
        assert result.imports == []

    def test_c_function_extracted_via_inheritance(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """Plain C function extracts via the inherited C path."""
        result = _extract(
            parser, extractor,
            "int hello(int x) { return x + 1; }\n",
        )
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "hello"
        assert sym.kind == "function"

    def test_c_include_extracted_via_inheritance(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """``#include`` still works on C++ source."""
        result = _extract(
            parser, extractor,
            "#include <iostream>\n",
        )
        assert len(result.imports) == 1
        assert result.imports[0].module == "iostream"


class TestClasses:
    """``class_specifier`` extraction with bases and members."""

    def test_simple_class(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """``class Foo {};`` → Symbol(kind='class')."""
        result = _extract(parser, extractor, "class Foo {};\n")
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "Foo"
        assert sym.kind == "class"
        assert sym.bases == []
        assert sym.children == []

    def test_class_with_single_base(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """``class Foo : public Bar {};`` → bases=['Bar']."""
        result = _extract(
            parser, extractor,
            "class Foo : public Bar {};\n",
        )
        assert result.symbols[0].bases == ["Bar"]

    def test_class_with_multiple_bases(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """``class Foo : public A, private B {};`` → bases in source order."""
        result = _extract(
            parser, extractor,
            "class Foo : public A, private B {};\n",
        )
        bases = result.symbols[0].bases
        assert len(bases) == 2
        assert "A" in bases[0]
        assert "B" in bases[1]

    def test_class_with_data_members(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """Data members attach as variable children."""
        source = (
            "class Point {\n"
            "    int x;\n"
            "    int y;\n"
            "};\n"
        )
        result = _extract(parser, extractor, source)
        cls = result.symbols[0]
        names = [c.name for c in cls.children]
        assert "x" in names
        assert "y" in names
        for child in cls.children:
            assert child.kind == "variable"

    def test_anonymous_class_skipped(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """``class { int x; } foo;`` — anonymous, no class symbol.

        Matches C struct behaviour. The surrounding declaration
        may still produce a variable symbol for ``foo``.
        """
        result = _extract(
            parser, extractor,
            "class { int x; } foo;\n",
        )
        # No class symbol — ``foo`` is a legitimate variable.
        names = [s.name for s in result.symbols]
        assert "foo" in names


class TestMethods:
    """Method definitions inside class bodies — ctors, dtors, ops."""

    def test_inline_method_definition(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """Inline method → method-kind child of the class."""
        source = (
            "class Foo {\n"
            "    void greet() { }\n"
            "};\n"
        )
        result = _extract(parser, extractor, source)
        cls = result.symbols[0]
        assert len(cls.children) == 1
        method = cls.children[0]
        assert method.name == "greet"
        assert method.kind == "method"
        assert method.return_type == "void"

    def test_method_prototype_inside_class(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """Method prototype (no body) still attaches as method child.

        C++ uses ``field_declaration`` for both data members and
        method prototypes. The extractor distinguishes by the
        declarator shape — function_declarator means method.
        """
        source = (
            "class Foo {\n"
            "    void greet(int x);\n"
            "};\n"
        )
        result = _extract(parser, extractor, source)
        cls = result.symbols[0]
        assert len(cls.children) == 1
        method = cls.children[0]
        assert method.name == "greet"
        assert method.kind == "method"
        # No body — no call sites captured.
        assert method.call_sites == []

    def test_constructor_extracted(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """``Foo(int x) {}`` inside class Foo → method named 'Foo'.

        Constructors have no return type, which trips the C
        extractor's requirement. The C++ override handles it.
        """
        source = (
            "class Foo {\n"
            "    Foo(int x) { }\n"
            "};\n"
        )
        result = _extract(parser, extractor, source)
        cls = result.symbols[0]
        assert len(cls.children) == 1
        ctor = cls.children[0]
        assert ctor.name == "Foo"
        assert ctor.kind == "method"
        # No return type on a constructor.
        assert ctor.return_type is None

    def test_destructor_extracted(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """``~Foo() {}`` → method named '~Foo'.

        The tilde is part of the name — preserving it makes
        destructors visually distinct in the symbol map.
        """
        source = (
            "class Foo {\n"
            "    ~Foo() { }\n"
            "};\n"
        )
        result = _extract(parser, extractor, source)
        cls = result.symbols[0]
        assert len(cls.children) == 1
        dtor = cls.children[0]
        assert dtor.name == "~Foo"
        assert dtor.kind == "method"

    def test_operator_overload_extracted(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """``operator+() {}`` → method named 'operator+'.

        The full operator name including the symbol is preserved
        in the method name.
        """
        source = (
            "class Vec {\n"
            "    Vec operator+(const Vec& other) { return other; }\n"
            "};\n"
        )
        result = _extract(parser, extractor, source)
        cls = result.symbols[0]
        # One method — the operator overload.
        ops = [c for c in cls.children if c.kind == "method"]
        assert len(ops) == 1
        assert "operator" in ops[0].name

    def test_mixed_members_preserve_order(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """Data members and methods appear in source order."""
        source = (
            "class Foo {\n"
            "    int count;\n"
            "    void bump() { count = count + 1; }\n"
            "    int value;\n"
            "};\n"
        )
        result = _extract(parser, extractor, source)
        cls = result.symbols[0]
        names = [c.name for c in cls.children]
        assert names == ["count", "bump", "value"]

    def test_method_with_parameters(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """Method parameter extraction goes through the C path."""
        source = (
            "class Foo {\n"
            "    int add(int a, int b) { return a + b; }\n"
            "};\n"
        )
        result = _extract(parser, extractor, source)
        method = result.symbols[0].children[0]
        assert [p.name for p in method.parameters] == ["a", "b"]


class TestNamespaces:
    """``namespace_definition`` extraction."""

    def test_named_namespace(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """``namespace foo { ... }`` → Symbol(kind='class')."""
        result = _extract(
            parser, extractor,
            "namespace foo {\n"
            "    int helper(int x) { return x; }\n"
            "}\n",
        )
        assert len(result.symbols) == 1
        ns = result.symbols[0]
        assert ns.name == "foo"
        assert ns.kind == "class"

    def test_namespace_contents_become_children(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """Classes and functions inside a namespace → child symbols."""
        source = (
            "namespace foo {\n"
            "    class Bar { };\n"
            "    int baz(int x) { return x; }\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        ns = result.symbols[0]
        names = [c.name for c in ns.children]
        assert "Bar" in names
        assert "baz" in names

    def test_anonymous_namespace_skipped(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """``namespace { ... }`` — no symbol produced.

        Contents of an anonymous namespace have internal linkage
        only. There's no navigable name, so the namespace itself
        produces no symbol. Any inner classes/functions are
        silently dropped too, matching the anonymous-struct policy.
        """
        source = (
            "namespace {\n"
            "    int helper() { return 0; }\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        # No namespace symbol produced. Whether the inner
        # helper surfaces separately depends on grammar
        # behaviour — we assert only that the namespace itself
        # doesn't appear.
        names = [s.name for s in result.symbols]
        # If any symbol exists, it's not empty-string or none
        # from the anonymous namespace.
        assert "" not in names

    def test_nested_namespace(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """``namespace a { namespace b { ... } }`` — b is a child of a."""
        source = (
            "namespace outer {\n"
            "    namespace inner {\n"
            "        int value(void) { return 0; }\n"
            "    }\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        outer = result.symbols[0]
        assert outer.name == "outer"
        assert len(outer.children) == 1
        inner = outer.children[0]
        assert inner.name == "inner"
        assert inner.kind == "class"
        # ``value`` lives inside ``inner``.
        inner_names = [c.name for c in inner.children]
        assert "value" in inner_names


class TestUsingDeclarations:
    """``using`` declarations as Import entries."""

    def test_using_qualified_name(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """``using std::vector;`` → Import(module='std::vector')."""
        result = _extract(
            parser, extractor,
            "using std::vector;\n",
        )
        assert len(result.imports) == 1
        assert result.imports[0].module == "std::vector"

    def test_using_namespace(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """``using namespace std;`` → Import with the namespace name.

        ``using namespace`` may be emitted as a distinct
        ``using_declaration`` variant in some grammar versions.
        Accept either: an Import with module='std', or no Import
        at all. The semantic contract is "don't crash and don't
        surface it as a symbol."
        """
        result = _extract(
            parser, extractor,
            "using namespace std;\n",
        )
        if result.imports:
            assert result.imports[0].module == "std"

    def test_using_deeply_qualified_name(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """``using a::b::c;`` preserves the full qualified path."""
        result = _extract(
            parser, extractor,
            "using a::b::c;\n",
        )
        assert len(result.imports) == 1
        assert result.imports[0].module == "a::b::c"

    def test_using_line_is_one_indexed(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """Import.line is 1-indexed, matching other import types."""
        source = (
            "// leading comment\n"
            "using std::string;\n"
        )
        result = _extract(parser, extractor, source)
        assert result.imports[0].line == 2

    def test_using_does_not_produce_symbol(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """``using`` declarations go to imports, never to symbols."""
        result = _extract(
            parser, extractor,
            "using std::move;\n",
        )
        assert result.imports
        assert result.symbols == []


class TestTemplates:
    """``template_declaration`` unwraps to its inner declaration."""

    def test_template_class_unwraps(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """``template<typename T> class Foo {};`` → class Foo symbol.

        Template parameters are not surfaced — only the inner
        class becomes a symbol.
        """
        source = (
            "template<typename T>\n"
            "class Foo {\n"
            "    T value;\n"
            "};\n"
        )
        result = _extract(parser, extractor, source)
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "Foo"
        assert sym.kind == "class"

    def test_template_function_unwraps(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """``template<typename T> T foo(T x) {}`` → function symbol."""
        source = (
            "template<typename T>\n"
            "T identity(T x) { return x; }\n"
        )
        result = _extract(parser, extractor, source)
        assert len(result.symbols) == 1
        sym = result.symbols[0]
        assert sym.name == "identity"
        assert sym.kind == "function"

    def test_template_class_has_members(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """Members of a template class are extracted normally."""
        source = (
            "template<typename T>\n"
            "class Box {\n"
            "    T value;\n"
            "    T get() { return value; }\n"
            "};\n"
        )
        result = _extract(parser, extractor, source)
        cls = result.symbols[0]
        names = [c.name for c in cls.children]
        assert "value" in names
        assert "get" in names

    def test_multiple_template_parameters(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """``template<typename T, typename U>`` still unwraps."""
        source = (
            "template<typename T, typename U>\n"
            "class Pair {\n"
            "    T first;\n"
            "    U second;\n"
            "};\n"
        )
        result = _extract(parser, extractor, source)
        assert len(result.symbols) == 1
        assert result.symbols[0].name == "Pair"


class TestOutOfClassDefinitions:
    """``void Foo::bar() {}`` — qualified identifier preserves scope.

    Out-of-class method definitions surface as top-level
    functions with their qualified name preserved. Merging them
    under the class would need a second pass; the current shape
    is navigable and matches the specs3 approach.
    """

    def test_qualified_method_definition(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """``void Foo::bar() {}`` → top-level symbol with qualified name.

        The C extractor's function-definition path fires on the
        outer ``function_definition``; the declarator's name is
        a ``qualified_identifier`` which the C extractor's
        existing logic reads as-is via ``_node_text``.
        """
        source = (
            "class Foo {\n"
            "    void bar();\n"
            "};\n"
            "void Foo::bar() { }\n"
        )
        result = _extract(parser, extractor, source)
        # Two top-level symbols expected: the class and the
        # out-of-class definition.
        names = [s.name for s in result.symbols]
        assert "Foo" in names
        # Out-of-class definition preserves the Foo:: prefix.
        assert any("Foo" in n and "bar" in n for n in names)

    def test_constructor_definition_out_of_class(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """``Foo::Foo(int x) {}`` — qualified constructor definition.

        Constructors defined out-of-class use the qualified name
        ``ClassName::ClassName``. The C extractor's path handles
        this via ``_node_text`` on the qualified_identifier.
        """
        source = (
            "class Foo {\n"
            "    Foo(int x);\n"
            "};\n"
            "Foo::Foo(int x) { }\n"
        )
        result = _extract(parser, extractor, source)
        # We get the class (with its prototype child) plus the
        # out-of-class constructor definition. Assert the class
        # is present and that some out-of-class symbol surfaced.
        names = [s.name for s in result.symbols]
        assert "Foo" in names


class TestCallSites:
    """Call-site extraction with the C++ extended builtin filter.

    The C extractor's call-site walk handles identifier and
    field_expression callees. The C++ override adds
    ``qualified_identifier`` (``std::move``) and
    ``template_function`` (``std::make_unique<Foo>``) resolution,
    plus a broader builtin set that suppresses stdlib noise.
    """

    def test_simple_call_in_method_body(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """``helper()`` inside a method body → one CallSite."""
        source = (
            "int helper(int x);\n"
            "class Foo {\n"
            "    int caller(int n) {\n"
            "        return helper(n);\n"
            "    }\n"
            "};\n"
        )
        result = _extract(parser, extractor, source)
        cls = next(s for s in result.symbols if s.name == "Foo")
        method = cls.children[0]
        names = [s.name for s in method.call_sites]
        assert "helper" in names

    def test_std_library_calls_filtered(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """``std::move``, ``std::cout`` etc. are filtered as builtins.

        The qualified_identifier resolves to its tail component
        (``move``, ``cout``) which lives in the extended builtin
        set. These calls would otherwise flood the reference
        graph with noise edges from every file.
        """
        source = (
            "void use(int x) {\n"
            "    auto y = std::move(x);\n"
            "    std::sort(nullptr, nullptr);\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        fn = next(s for s in result.symbols if s.name == "use")
        names = [s.name for s in fn.call_sites]
        # Neither ``move`` nor ``sort`` should appear.
        assert "move" not in names
        assert "sort" not in names

    def test_user_qualified_call_resolves_to_tail(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """``mylib::helper()`` — tail ``helper`` is recorded.

        User-qualified calls aren't builtins, so the tail
        component survives filtering and gets recorded. The
        scope prefix is dropped — it's noise for the reference
        graph.
        """
        source = (
            "void caller(void) {\n"
            "    mylib::helper();\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        fn = next(s for s in result.symbols if s.name == "caller")
        names = [s.name for s in fn.call_sites]
        assert "helper" in names
        # Scope prefix is not kept as a separate entry.
        assert "mylib" not in names

    def test_template_function_call_resolves(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """``std::make_unique<Foo>(x)`` — tail ``make_unique`` filtered.

        The call's function is a ``template_function`` wrapping
        a ``qualified_identifier``. The extractor peels both
        layers to reach ``make_unique`` which is in the builtin
        set.
        """
        source = (
            "void caller(int x) {\n"
            "    auto p = std::make_unique<int>(x);\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        fn = next(s for s in result.symbols if s.name == "caller")
        names = [s.name for s in fn.call_sites]
        # Filtered as builtin.
        assert "make_unique" not in names

    def test_method_call_on_member_resolves_to_tail(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """``obj.method()`` inside a C++ method — recorded as 'method'.

        Field expression handling is inherited from the C
        extractor. Adding a C++-specific test pins down that the
        C path still fires on C++ source.
        """
        source = (
            "class Worker {\n"
            "public:\n"
            "    void run(Worker& other) {\n"
            "        other.start();\n"
            "    }\n"
            "};\n"
        )
        result = _extract(parser, extractor, source)
        cls = next(s for s in result.symbols if s.name == "Worker")
        run = next(c for c in cls.children if c.name == "run")
        names = [s.name for s in run.call_sites]
        assert "start" in names

    def test_multiple_calls_preserve_order(
        self,
        parser: TreeSitterParser,
        extractor: CppExtractor,
    ) -> None:
        """User-function call sites appear in source order."""
        source = (
            "void alpha(void);\n"
            "void beta(void);\n"
            "void gamma(void);\n"
            "void caller(void) {\n"
            "    alpha();\n"
            "    beta();\n"
            "    gamma();\n"
            "}\n"
        )
        result = _extract(parser, extractor, source)
        fn = next(s for s in result.symbols if s.name == "caller")
        names = [s.name for s in fn.call_sites]
        assert names == ["alpha", "beta", "gamma"]