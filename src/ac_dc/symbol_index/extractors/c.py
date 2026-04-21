"""C symbol extractor.

Walks a tree-sitter C AST and produces a
:class:`~ac_dc.symbol_index.models.FileSymbols`. Handles:

- Function definitions (``int foo(int x) { ... }``)
- Function prototypes (``int foo(int x);``)
- Struct definitions treated as classes with member children
- Union definitions — same treatment as structs
- Enum definitions — treated as classes with variable children
- Typedef declarations — surfaced as variable symbols by their
  typedef name
- ``#include`` directives as Imports
- Global variable declarations
- Call sites inside function bodies (with builtin filtering)
- Function parameters with type annotations

Deliberate scope decisions:

- **No macro tracking.** ``#define FOO 42`` is a ``preproc_def``
  node, emitted separately. Marginal value, adds complexity.
- **No typedef alias resolution.** ``typedef int mytype_t;``
  produces a symbol named ``mytype_t`` of kind ``variable``.
- **No static vs extern distinction.** Storage class isn't
  surfaced in the symbol kind.
- **Function prototypes and definitions both produce symbols.**
  Headers with prototypes should still have navigable symbols.

Governing spec: ``specs4/2-indexing/symbol-index.md``.
"""

from __future__ import annotations

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
    import tree_sitter


# C builtins and standard library calls filtered from call sites.
# Same rationale as JS/TS — these would create noisy edges from
# every source file.
_C_BUILTINS = frozenset({
    # stdio
    "printf", "fprintf", "sprintf", "snprintf", "scanf", "fscanf",
    "puts", "fputs", "putc", "putchar", "getc", "getchar",
    "fopen", "fclose", "fread", "fwrite", "fseek", "ftell",
    "feof", "ferror", "fflush",
    # stdlib
    "malloc", "calloc", "realloc", "free",
    "exit", "abort", "atoi", "atol", "atof",
    "strtol", "strtoul", "strtod",
    "qsort", "bsearch",
    "rand", "srand",
    "getenv", "setenv",
    # string
    "strlen", "strcpy", "strncpy", "strcat", "strncat",
    "strcmp", "strncmp", "strchr", "strrchr", "strstr",
    "memcpy", "memmove", "memset", "memcmp",
    # ctype
    "isalpha", "isdigit", "isalnum", "isspace", "isupper", "islower",
    "toupper", "tolower",
    # math
    "abs", "labs", "fabs", "sqrt", "pow", "sin", "cos", "tan",
    "exp", "log", "floor", "ceil", "round",
    # assert, errno, time, signal, setjmp, varargs
    "assert", "perror",
    "time", "clock", "difftime",
    "signal", "raise",
    "setjmp", "longjmp",
    "va_start", "va_arg", "va_end", "va_copy",
    # C keywords that look like calls
    "sizeof", "alignof", "offsetof",
})


class CExtractor(BaseExtractor):
    """Extract symbols from a tree-sitter C parse tree.

    Stateless across calls — construct once, reuse. Not
    thread-safe for concurrent extraction (uses ``_source`` /
    ``_path`` during a single call).
    """

    language = "c"

    def extract(
        self,
        tree: "tree_sitter.Tree | None",
        source: bytes,
        path: str,
    ) -> FileSymbols:
        if tree is None:
            return FileSymbols(file_path=path)

        self._source = source
        self._path = path

        result = FileSymbols(file_path=path)
        for child in tree.root_node.children:
            self._handle_top_level(child, result)

        return result

    # ------------------------------------------------------------------
    # Top-level dispatch
    # ------------------------------------------------------------------

    def _handle_top_level(
        self,
        node: "tree_sitter.Node",
        result: FileSymbols,
    ) -> None:
        """Route a direct child of the translation unit.

        Unknown node types are silently ignored. Preprocessor
        directives other than include don't contribute symbols.
        """
        t = node.type
        if t == "function_definition":
            func = self._extract_function_definition(node)
            if func is not None:
                result.symbols.append(func)
        elif t == "declaration":
            self._handle_declaration(node, result)
        elif t == "type_definition":
            self._handle_typedef(node, result)
        elif t == "struct_specifier":
            sym = self._extract_struct_or_union(node, "struct")
            if sym is not None:
                result.symbols.append(sym)
        elif t == "union_specifier":
            sym = self._extract_struct_or_union(node, "union")
            if sym is not None:
                result.symbols.append(sym)
        elif t == "enum_specifier":
            sym = self._extract_enum(node)
            if sym is not None:
                result.symbols.append(sym)
        elif t == "preproc_include":
            imp = self._extract_include(node)
            if imp is not None:
                result.imports.append(imp)

    # ------------------------------------------------------------------
    # #include directives
    # ------------------------------------------------------------------

    def _extract_include(
        self,
        node: "tree_sitter.Node",
    ) -> Import | None:
        """Extract a ``#include`` directive.

        Handles both ``#include "local.h"`` (string_literal) and
        ``#include <system.h>`` (system_lib_string). The quoted-
        vs-angled distinction isn't preserved in :class:`Import`
        — the resolver handles either form via its search path.
        """
        line = self._start_line(node) + 1
        path_node = node.child_by_field_name("path")
        if path_node is None:
            return None

        raw = self._node_text(path_node, self._source)
        # Strip surrounding quotes or angle brackets.
        if len(raw) >= 2:
            if raw[0] == '"' and raw[-1] == '"':
                module = raw[1:-1]
            elif raw[0] == "<" and raw[-1] == ">":
                module = raw[1:-1]
            else:
                module = raw
        else:
            module = raw

        return Import(module=module, line=line)

    # ------------------------------------------------------------------
    # Declarations — prototypes, globals, typedefs
    # ------------------------------------------------------------------

    def _handle_declaration(
        self,
        node: "tree_sitter.Node",
        result: FileSymbols,
    ) -> None:
        """Dispatch a ``declaration`` to the right handler.

        Covers function prototypes, global variables, and
        declarations that embed a struct/union/enum specifier.
        Embedded specifiers produce their own symbols even when
        wrapped in a declaration.
        """
        # Check for embedded struct/union/enum specifier in the
        # type position — these produce their own symbols.
        for child in node.named_children:
            t = child.type
            if t == "struct_specifier":
                sym = self._extract_struct_or_union(child, "struct")
                if sym is not None:
                    result.symbols.append(sym)
            elif t == "union_specifier":
                sym = self._extract_struct_or_union(child, "union")
                if sym is not None:
                    result.symbols.append(sym)
            elif t == "enum_specifier":
                sym = self._extract_enum(child)
                if sym is not None:
                    result.symbols.append(sym)

        # Now walk declarators for prototypes and variables.
        for declarator in self._find_children(
            node,
            "function_declarator",
            "identifier",
            "init_declarator",
            "pointer_declarator",
            "array_declarator",
        ):
            sym = self._extract_declaration_symbol(node, declarator)
            if sym is not None:
                result.symbols.append(sym)

    def _extract_declaration_symbol(
        self,
        decl_node: "tree_sitter.Node",
        declarator: "tree_sitter.Node",
    ) -> Symbol | None:
        """Build a Symbol from a declaration's declarator.

        Unwraps pointer_declarator / array_declarator wrappers
        to find the inner identifier or function_declarator.
        """
        inner = self._unwrap_declarator(declarator)
        if inner is None:
            return None

        if inner.type == "function_declarator":
            return self._build_function_prototype(decl_node, inner)

        if inner.type == "identifier":
            name = self._node_text(inner, self._source)
            return Symbol(
                name=name,
                kind="variable",
                file_path=self._path,
                range=self._range(decl_node),
            )

        if inner.type == "init_declarator":
            return self._extract_init_declarator(decl_node, inner)

        return None

    def _unwrap_declarator(
        self,
        node: "tree_sitter.Node",
    ) -> "tree_sitter.Node | None":
        """Strip pointer / array / parenthesized wrappers.

        C declarators nest: ``int *const foo[10]`` parses with
        ``array_declarator`` wrapping ``pointer_declarator``
        wrapping ``identifier``. Function pointers add
        ``parenthesized_declarator`` around the inner pointer:
        ``int (*cb)(int)`` — the outer shape is
        ``function_declarator`` → ``parenthesized_declarator`` →
        ``pointer_declarator`` → ``identifier`` (``cb``).

        Peel all three wrapper types to find the underlying
        identifier or function_declarator.

        Loop bounded defensively — malformed input shouldn't
        infinite-loop us.
        """
        current = node
        for _ in range(16):
            if current is None:
                return None
            t = current.type
            if t in (
                "pointer_declarator",
                "array_declarator",
                "parenthesized_declarator",
            ):
                # parenthesized_declarator doesn't use the
                # "declarator" field name — its payload is its
                # first named child. Try the field first, fall
                # back to first named child.
                inner = current.child_by_field_name("declarator")
                if inner is None:
                    for child in current.named_children:
                        inner = child
                        break
                current = inner
                continue
            return current
        return None

    def _extract_init_declarator(
        self,
        decl_node: "tree_sitter.Node",
        init_decl: "tree_sitter.Node",
    ) -> Symbol | None:
        """Build a Symbol from ``name = value`` inside a declaration."""
        declarator = init_decl.child_by_field_name("declarator")
        if declarator is None:
            return None
        inner = self._unwrap_declarator(declarator)
        if inner is None:
            return None
        if inner.type == "identifier":
            name = self._node_text(inner, self._source)
            return Symbol(
                name=name,
                kind="variable",
                file_path=self._path,
                range=self._range(decl_node),
            )
        if inner.type == "function_declarator":
            # ``int (*fn)(int) = &something;`` — function pointer.
            # Treat as variable; the name is a pointer, not a
            # function.
            id_node = inner.child_by_field_name("declarator")
            if id_node is not None:
                inner2 = self._unwrap_declarator(id_node)
                if inner2 is not None and inner2.type == "identifier":
                    name = self._node_text(inner2, self._source)
                    return Symbol(
                        name=name,
                        kind="variable",
                        file_path=self._path,
                        range=self._range(decl_node),
                    )
        return None

    def _build_function_prototype(
        self,
        decl_node: "tree_sitter.Node",
        fn_declarator: "tree_sitter.Node",
    ) -> Symbol | None:
        """Build a function Symbol from a prototype declaration.

        ``int foo(int x);`` — no body, so no call sites. Return
        type comes from the enclosing declaration's ``type``
        field.
        """
        name_node = fn_declarator.child_by_field_name("declarator")
        if name_node is None:
            return None
        name_inner = self._unwrap_declarator(name_node)
        if name_inner is None or name_inner.type != "identifier":
            return None
        name = self._node_text(name_inner, self._source)

        sym = Symbol(
            name=name,
            kind="function",
            file_path=self._path,
            range=self._range(decl_node),
        )

        type_node = decl_node.child_by_field_name("type")
        if type_node is not None:
            sym.return_type = self._node_text(type_node, self._source)

        params_node = fn_declarator.child_by_field_name("parameters")
        if params_node is not None:
            sym.parameters = self._extract_parameters(params_node)

        return sym

    # ------------------------------------------------------------------
    # Function definitions (with body)
    # ------------------------------------------------------------------

    def _extract_function_definition(
        self,
        node: "tree_sitter.Node",
    ) -> Symbol | None:
        """Build a function Symbol from a full definition.

        ``int foo(int x) { ... }`` — has a body, so we extract
        call sites. Return type from the ``type`` field; the
        name + parameters come from the function_declarator in
        the ``declarator`` field.
        """
        declarator = node.child_by_field_name("declarator")
        if declarator is None:
            return None

        # Declarator may be wrapped in pointer_declarator (for
        # functions returning pointers: ``char *foo(void) {}``).
        fn_decl = self._unwrap_declarator(declarator)
        if fn_decl is None or fn_decl.type != "function_declarator":
            return None

        name_node = fn_decl.child_by_field_name("declarator")
        if name_node is None:
            return None
        name_inner = self._unwrap_declarator(name_node)
        if name_inner is None or name_inner.type != "identifier":
            return None
        name = self._node_text(name_inner, self._source)

        sym = Symbol(
            name=name,
            kind="function",
            file_path=self._path,
            range=self._range(node),
        )

        type_node = node.child_by_field_name("type")
        if type_node is not None:
            sym.return_type = self._node_text(type_node, self._source)

        params_node = fn_decl.child_by_field_name("parameters")
        if params_node is not None:
            sym.parameters = self._extract_parameters(params_node)

        body = node.child_by_field_name("body")
        if body is not None:
            sym.call_sites = self._extract_call_sites(body)

        return sym

    # ------------------------------------------------------------------
    # Typedefs
    # ------------------------------------------------------------------

    def _handle_typedef(
        self,
        node: "tree_sitter.Node",
        result: FileSymbols,
    ) -> None:
        """Handle a ``type_definition`` (``typedef ...``).

        Two shapes we care about:

        - ``typedef int mytype_t;`` — simple alias. The last
          identifier in the typedef is the new name.
        - ``typedef struct { int x; } Point;`` — the struct
          body contributes a struct symbol (anonymous or named),
          AND the typedef name produces its own variable symbol.

        The struct/union/enum specifier is a child of the
        type_definition node. If present, extract it as a
        symbol. Separately, find the typedef name via the
        ``declarator`` field.
        """
        # Embedded struct/union/enum specifier.
        for child in node.named_children:
            t = child.type
            if t == "struct_specifier":
                sym = self._extract_struct_or_union(child, "struct")
                if sym is not None:
                    result.symbols.append(sym)
            elif t == "union_specifier":
                sym = self._extract_struct_or_union(child, "union")
                if sym is not None:
                    result.symbols.append(sym)
            elif t == "enum_specifier":
                sym = self._extract_enum(child)
                if sym is not None:
                    result.symbols.append(sym)

        # The typedef name — the declarator field holds it.
        # May be wrapped in pointer_declarator for ``typedef
        # struct Foo *FooPtr;`` style declarations.
        declarator = node.child_by_field_name("declarator")
        if declarator is not None:
            inner = self._unwrap_declarator(declarator)
            if inner is not None and inner.type == "type_identifier":
                name = self._node_text(inner, self._source)
                result.symbols.append(Symbol(
                    name=name,
                    kind="variable",
                    file_path=self._path,
                    range=self._range(node),
                ))
            elif inner is not None and inner.type == "identifier":
                # Some grammar versions use identifier instead.
                name = self._node_text(inner, self._source)
                result.symbols.append(Symbol(
                    name=name,
                    kind="variable",
                    file_path=self._path,
                    range=self._range(node),
                ))

    # ------------------------------------------------------------------
    # Structs and unions
    # ------------------------------------------------------------------

    def _extract_struct_or_union(
        self,
        node: "tree_sitter.Node",
        kind_name: str,
    ) -> Symbol | None:
        """Build a class-kind Symbol for a struct or union.

        ``kind_name`` is either ``"struct"`` or ``"union"``.
        We render both as ``kind="class"`` so the symbol map
        treats them as containers with member children — the
        structural information (fields) is what the LLM needs.

        Anonymous structs (``struct { int x; } foo;``) are
        skipped — there's no name to index. The containing
        declaration will produce a variable symbol for ``foo``
        which is what users navigate to.
        """
        name_node = node.child_by_field_name("name")
        if name_node is None:
            # Anonymous — no symbol.
            return None
        name = self._node_text(name_node, self._source)

        sym = Symbol(
            name=name,
            kind="class",
            file_path=self._path,
            range=self._range(node),
        )

        # Body field holds the ``field_declaration_list``.
        body = node.child_by_field_name("body")
        if body is not None:
            self._populate_struct_body(sym, body)

        return sym

    def _populate_struct_body(
        self,
        struct_sym: Symbol,
        body: "tree_sitter.Node",
    ) -> None:
        """Attach field declarations as variable children.

        A ``field_declaration`` inside a struct body can
        declare multiple fields: ``int x, y;`` produces two
        fields. Each becomes a variable-kind child.

        Nested struct/union/enum declarations inside the body
        aren't surfaced as children of the containing struct —
        they're typically anonymous for layout purposes and
        don't navigate usefully. If they're named, users can
        still find them via the flat symbol list.
        """
        for field_decl in body.named_children:
            if field_decl.type != "field_declaration":
                continue
            self._extract_field_declaration(field_decl, struct_sym)

    def _extract_field_declaration(
        self,
        field_decl: "tree_sitter.Node",
        struct_sym: Symbol,
    ) -> None:
        """Extract one or more fields from a ``field_declaration``.

        ``int x;`` produces one field; ``int x, y;`` produces
        two. Each declarator (unwrapped past pointer/array) is
        an identifier naming the field.
        """
        # Iterate declarator-like children. A field_declaration
        # may have multiple in the multi-declaration case.
        for declarator in self._find_children(
            field_decl,
            "field_identifier",
            "identifier",
            "pointer_declarator",
            "array_declarator",
            "function_declarator",
        ):
            inner = self._unwrap_declarator(declarator)
            if inner is None:
                continue
            if inner.type in ("field_identifier", "identifier"):
                name = self._node_text(inner, self._source)
                struct_sym.children.append(Symbol(
                    name=name,
                    kind="variable",
                    file_path=self._path,
                    range=self._range(field_decl),
                ))
            elif inner.type == "function_declarator":
                # Function pointer field: ``int (*cb)(int);``.
                # Treat as a variable — the name is the
                # field, the function_declarator is its type.
                id_node = inner.child_by_field_name("declarator")
                if id_node is not None:
                    inner2 = self._unwrap_declarator(id_node)
                    if inner2 is not None and inner2.type in (
                        "field_identifier",
                        "identifier",
                    ):
                        name = self._node_text(inner2, self._source)
                        struct_sym.children.append(Symbol(
                            name=name,
                            kind="variable",
                            file_path=self._path,
                            range=self._range(field_decl),
                        ))

    # ------------------------------------------------------------------
    # Enums
    # ------------------------------------------------------------------

    def _extract_enum(
        self,
        node: "tree_sitter.Node",
    ) -> Symbol | None:
        """Build a class-kind Symbol for an enum.

        ``enum Color { RED, GREEN, BLUE }`` — we treat enums as
        classes with each member as a variable child, same as
        the TypeScript enum treatment. Anonymous enums are
        skipped (no name to index).
        """
        name_node = node.child_by_field_name("name")
        if name_node is None:
            return None
        name = self._node_text(name_node, self._source)

        sym = Symbol(
            name=name,
            kind="class",
            file_path=self._path,
            range=self._range(node),
        )

        body = node.child_by_field_name("body")
        if body is not None:
            self._populate_enum_body(sym, body)

        return sym

    def _populate_enum_body(
        self,
        enum_sym: Symbol,
        body: "tree_sitter.Node",
    ) -> None:
        """Attach enum members as variable children.

        Body is an ``enumerator_list``; each child is an
        ``enumerator`` with a ``name`` field (identifier).
        Value expressions (``RED = 1``) aren't surfaced — only
        names matter for the symbol map.
        """
        for enumerator in body.named_children:
            if enumerator.type != "enumerator":
                continue
            name_node = enumerator.child_by_field_name("name")
            if name_node is None:
                # Fall back to first named child.
                for child in enumerator.named_children:
                    name_node = child
                    break
            if name_node is None:
                continue
            name = self._node_text(name_node, self._source)
            enum_sym.children.append(Symbol(
                name=name,
                kind="variable",
                file_path=self._path,
                range=self._range(enumerator),
            ))

    # ------------------------------------------------------------------
    # Parameters
    # ------------------------------------------------------------------

    def _extract_parameters(
        self,
        params_node: "tree_sitter.Node",
    ) -> list[Parameter]:
        """Extract parameters from a ``parameter_list`` node.

        tree-sitter-c shapes:

        - ``parameter_declaration`` — normal typed parameter
        - ``variadic_parameter`` — ``...`` at end
        - ``(void)`` — a single parameter_declaration whose
          type is ``void`` and has no declarator. Treated as
          "no parameters" to match C semantics.
        """
        params: list[Parameter] = []
        children = params_node.named_children

        # Detect the ``(void)`` case — single parameter_declaration
        # with type=void and no declarator.
        if len(children) == 1:
            only = children[0]
            if only.type == "parameter_declaration":
                type_node = only.child_by_field_name("type")
                decl_node = only.child_by_field_name("declarator")
                if (
                    decl_node is None
                    and type_node is not None
                    and self._node_text(type_node, self._source) == "void"
                ):
                    return []

        for child in children:
            param = self._build_parameter(child)
            if param is not None:
                params.append(param)
        return params

    def _build_parameter(
        self,
        node: "tree_sitter.Node",
    ) -> Parameter | None:
        """Build one Parameter from a parameter_list child.

        ``parameter_declaration`` shape has:
        - ``type`` field (required) — the type specifier
        - ``declarator`` field (optional) — the parameter name,
          possibly wrapped in pointer/array declarators. When
          absent, the parameter has no name (valid C — common
          in function prototypes like ``int f(int);``).

        ``variadic_parameter`` (``...``) — produces a synthetic
        ``...`` named parameter flagged as vararg.

        Unknown node types return None; the caller filters.
        """
        t = node.type
        if t == "variadic_parameter":
            # Variadic ``...`` — use a synthetic name so the
            # symbol map renders something.
            return Parameter(name="...", is_vararg=True)

        if t != "parameter_declaration":
            return None

        type_node = node.child_by_field_name("type")
        type_ann = (
            self._node_text(type_node, self._source)
            if type_node is not None
            else None
        )

        # Prepend any type qualifiers (const, volatile, restrict)
        # that appear as sibling nodes on the parameter_declaration.
        # tree-sitter-c puts qualifiers on the parameter node itself,
        # not inside the `type` field, so we collect them separately
        # and join with the type text. Preserves source order —
        # ``const char *name`` becomes ``const char``.
        qualifiers: list[str] = []
        for child in node.children:
            if child.type == "type_qualifier":
                qualifiers.append(
                    self._node_text(child, self._source)
                )
        if qualifiers and type_ann is not None:
            type_ann = " ".join(qualifiers) + " " + type_ann
        elif qualifiers:
            type_ann = " ".join(qualifiers)

        decl_node = node.child_by_field_name("declarator")
        if decl_node is None:
            # Unnamed parameter in a prototype — surface it
            # with an empty name so the count is preserved.
            return Parameter(name="", type_annotation=type_ann)

        # Unwrap pointer/array/function wrappers to reach the
        # identifier. Parameters can be function pointers, which
        # show up as function_declarator with an inner
        # identifier.
        inner = self._unwrap_declarator(decl_node)
        if inner is None:
            return Parameter(name="", type_annotation=type_ann)

        if inner.type == "identifier":
            name = self._node_text(inner, self._source)
            return Parameter(name=name, type_annotation=type_ann)

        if inner.type == "function_declarator":
            # Function-pointer parameter: ``void (*cb)(int)``.
            # The name is inside the function_declarator's own
            # declarator field.
            id_node = inner.child_by_field_name("declarator")
            if id_node is not None:
                inner2 = self._unwrap_declarator(id_node)
                if inner2 is not None and inner2.type == "identifier":
                    name = self._node_text(inner2, self._source)
                    return Parameter(
                        name=name,
                        type_annotation=type_ann,
                    )

        # Abstract declarator (type-only, no name).
        return Parameter(name="", type_annotation=type_ann)

    # ------------------------------------------------------------------
    # Call sites
    # ------------------------------------------------------------------

    def _extract_call_sites(
        self,
        body: "tree_sitter.Node",
    ) -> list[CallSite]:
        """Collect call sites inside a function body.

        Walks every descendant ``call_expression``:

        - ``foo(x)`` — identifier callee
        - ``obj->method(x)`` — field_expression; record the
          field name (``method``), not the receiver
        - ``obj.field(x)`` — same treatment
        - ``(*fp)(x)`` — parenthesized / dereferenced callable;
          skipped (no static name)

        Builtin names (stdio, stdlib, string, etc.) are
        filtered via :data:`_C_BUILTINS` to keep the reference
        graph clean. ``sizeof(x)`` parses as a call in some
        grammar versions; ``sizeof`` is in the builtin set so
        it's filtered regardless.
        """
        sites: list[CallSite] = []

        def _visit(node: "tree_sitter.Node") -> None:
            if node.type != "call_expression":
                return
            fn = node.child_by_field_name("function")
            if fn is None:
                return
            name = self._callee_name(fn)
            if not name or name in _C_BUILTINS:
                return
            sites.append(
                CallSite(
                    name=name,
                    line=self._start_line(node) + 1,
                )
            )

        self._walk_named(body, _visit)
        return sites

    def _callee_name(
        self,
        node: "tree_sitter.Node",
    ) -> str | None:
        """Resolve a callable expression to a simple name.

        - ``identifier`` → its text
        - ``field_expression`` (``obj.foo`` / ``obj->foo``) →
          the field name (final component)
        - Anything else (parenthesized, subscript, call result)
          → None. The visitor skips callees without a static
          name.
        """
        t = node.type
        if t == "identifier":
            return self._node_text(node, self._source)
        if t == "field_expression":
            # The ``field`` field holds the field_identifier.
            field = node.child_by_field_name("field")
            if field is not None:
                return self._node_text(field, self._source)
        return None