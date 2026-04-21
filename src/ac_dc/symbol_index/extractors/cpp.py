"""C++ symbol extractor.

Subclass of :class:`CExtractor` that adds C++-specific constructs
over the shared C grammar shape. tree-sitter-cpp is a superset of
tree-sitter-c — every C node type is accepted — but adds:

- ``class_specifier`` (like ``struct_specifier`` but with default
  ``private`` access)
- Access-modifier labels (``public:``, ``private:``, ``protected:``)
  inside class/struct bodies
- ``namespace_definition`` — named namespaces
- ``using_declaration`` — ``using foo::bar;``
- ``template_declaration`` — wraps classes and functions
- ``qualified_identifier`` — ``Foo::method`` for out-of-class
  definitions
- ``destructor_name`` — ``~Foo``
- ``operator_name`` — ``operator+``
- Constructor / destructor definitions

Deliberate scope decisions:

- **Templates preserved as source text only.** Template parameters
  aren't surfaced as symbols.
- **No SFINAE / concept analysis.**
- **Private members included** — hiding them would surprise users.

Governing spec: ``specs4/2-indexing/symbol-index.md``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from ac_dc.symbol_index.extractors.c import CExtractor
from ac_dc.symbol_index.models import FileSymbols, Import, Symbol

if TYPE_CHECKING:
    import tree_sitter


# C++ adds builtins beyond the C set. We filter by bare name (after
# resolving qualified_identifier to its tail), so these match.
_CPP_EXTRA_BUILTINS = frozenset({
    # iostream
    "cout", "cerr", "clog", "cin", "endl",
    # std smart pointers and moves
    "move", "forward", "make_unique", "make_shared",
    "swap", "ref", "cref",
    # std containers — common constructor-as-function calls
    "vector", "string", "map", "unordered_map", "set",
    "unordered_set", "list", "deque", "array", "pair",
    "tuple", "get",
    # std algorithms
    "sort", "find", "find_if", "copy", "transform",
    "remove", "remove_if", "fill", "for_each",
    "min", "max", "minmax",
    # exception machinery
    "throw", "rethrow_exception", "current_exception",
    # C++ keyword-ish
    "static_cast", "dynamic_cast", "const_cast",
    "reinterpret_cast", "typeid",
})


class CppExtractor(CExtractor):
    """Extract symbols from a tree-sitter C++ parse tree.

    Inherits from :class:`CExtractor`; only overrides what C++
    adds to the grammar. Stateless across calls; not thread-safe
    on a single instance during extraction.
    """

    language = "cpp"

    # ------------------------------------------------------------------
    # Top-level dispatch — add C++-specific node types
    # ------------------------------------------------------------------

    def _handle_top_level(
        self,
        node: "tree_sitter.Node",
        result: FileSymbols,
    ) -> None:
        """Dispatch top-level node, adding C++-specific constructs.

        Unknown-to-C types fall through to the C handler via
        ``super()``.
        """
        t = node.type
        if t == "class_specifier":
            sym = self._extract_class(node)
            if sym is not None:
                result.symbols.append(sym)
            return
        if t == "namespace_definition":
            sym = self._extract_namespace(node)
            if sym is not None:
                result.symbols.append(sym)
            return
        if t == "using_declaration":
            imp = self._extract_using(node)
            if imp is not None:
                result.imports.append(imp)
            return
        if t == "template_declaration":
            self._handle_template(node, result)
            return
        # Fall through to C handler for all C node types.
        super()._handle_top_level(node, result)

    def _handle_template(
        self,
        node: "tree_sitter.Node",
        result: FileSymbols,
    ) -> None:
        """Unwrap ``template_declaration`` to its inner declaration.

        ``template<typename T> class Foo {}`` — the class_specifier
        is a direct child after the template_parameter_list. Scan
        for the real declaration and dispatch through our own
        top-level handler so nested templates unwrap correctly.
        """
        for child in node.named_children:
            t = child.type
            if t in (
                "class_specifier",
                "struct_specifier",
                "function_definition",
                "declaration",
                "template_declaration",
            ):
                self._handle_top_level(child, result)
                return

    # ------------------------------------------------------------------
    # Function definitions — override to accept qualified_identifier
    # ------------------------------------------------------------------

    def _extract_function_definition(
        self,
        node: "tree_sitter.Node",
    ) -> "Symbol | None":
        """Extract a function definition, accepting C++ name shapes.

        The C extractor's implementation rejects declarator
        names that aren't plain ``identifier``. C++ allows
        out-of-class definitions like ``void Foo::bar() {}``
        where the function-declarator's inner declarator is a
        ``qualified_identifier``, and operator overloads like
        ``Vec operator+(...) {}`` where it's an ``operator_name``.
        These should surface as top-level function symbols with
        their full qualified/operator text as the name so the
        symbol map preserves the scope prefix.

        This override reuses the C path's structure but swaps
        the identifier check for ``_cpp_method_name`` which
        accepts all C++ name shapes.
        """
        declarator = node.child_by_field_name("declarator")
        if declarator is None:
            return None

        # Unwrap pointer_declarator / parenthesized_declarator
        # for functions returning pointers or function pointers.
        fn_decl = self._unwrap_declarator(declarator)
        if fn_decl is None or fn_decl.type != "function_declarator":
            return None

        name_node = fn_decl.child_by_field_name("declarator")
        if name_node is None:
            return None
        name = self._cpp_method_name(name_node)
        if not name:
            return None

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
    # Classes
    # ------------------------------------------------------------------

    def _extract_class(
        self,
        node: "tree_sitter.Node",
    ) -> Symbol | None:
        """Build a Symbol for a ``class_specifier`` node.

        Same shape as struct_specifier. Anonymous classes
        (``class { ... } foo;``) produce no symbol — matches C
        struct behaviour.
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

        sym.bases = self._extract_class_bases(node)

        body = node.child_by_field_name("body")
        if body is not None:
            self._populate_cpp_class_body(sym, body)

        return sym

    def _extract_class_bases(
        self,
        class_node: "tree_sitter.Node",
    ) -> list[str]:
        """Return base class names from the base_class_clause.

        Grammar observation — tree-sitter-cpp emits access
        keywords (``public``, ``private``, ``protected``) and
        ``virtual`` as NAMED children of ``base_class_clause``,
        not as anonymous tokens. So for ``class Foo : public
        Bar`` the clause's named children are
        ``["public", "Bar"]`` — two entries, not one. The
        class heritage field also doesn't group keyword+type
        into a composite node.

        We pair each entry with the following type by walking
        the list and treating the known access/virtual
        keywords as prefix modifiers to skip. Commas are
        anonymous so they don't interfere. Each accumulated
        type text becomes one base entry; if a modifier
        appears with no following type before the next comma
        (malformed source) we drop it.
        """
        clause = self._find_child(class_node, "base_class_clause")
        if clause is None:
            return []
        # Treat these as modifiers to skip — they're named in
        # the current grammar but carry no structural meaning
        # for the base list.
        access_keywords = {"public", "private", "protected", "virtual"}
        bases: list[str] = []
        for child in clause.named_children:
            text = self._node_text(child, self._source)
            # A modifier alone — skip.
            if text in access_keywords:
                continue
            bases.append(text)
        return bases

    def _populate_cpp_class_body(
        self,
        class_sym: Symbol,
        body: "tree_sitter.Node",
    ) -> None:
        """Walk a class body, attaching members as children.

        Class bodies contain:

        - ``function_definition`` — inline method definitions
          (including constructors, destructors, operators)
        - ``field_declaration`` — data members AND method
          prototypes (same node type in C++ grammar)
        - ``access_specifier`` — ``public:``/``private:``/``protected:``
          labels (ignored; all members surfaced)
        - ``class_specifier`` / ``struct_specifier`` — nested
          types, extracted as child symbols

        Private members are surfaced — the symbol map kind
        already conveys method-vs-variable; hiding privates
        would surprise users.
        """
        for child in body.named_children:
            t = child.type
            if t == "function_definition":
                method = self._extract_cpp_method(child)
                if method is not None:
                    class_sym.children.append(method)
            elif t == "field_declaration":
                self._handle_cpp_field_declaration(child, class_sym)
            elif t == "class_specifier":
                nested = self._extract_class(child)
                if nested is not None:
                    class_sym.children.append(nested)
            elif t == "struct_specifier":
                nested = self._extract_struct_or_union(child, "struct")
                if nested is not None:
                    class_sym.children.append(nested)
            elif t == "template_declaration":
                # Templated nested class or method. Rather than
                # calling _handle_template (which writes to a
                # FileSymbols), peel manually and attach here.
                self._handle_nested_template(child, class_sym)

    def _handle_nested_template(
        self,
        node: "tree_sitter.Node",
        class_sym: Symbol,
    ) -> None:
        """Unwrap a template_declaration inside a class body.

        Peels to the inner class/struct/function and attaches
        the resulting symbol as a child of ``class_sym``. Unlike
        top-level ``_handle_template``, this operates on a
        parent Symbol rather than a FileSymbols.
        """
        for child in node.named_children:
            t = child.type
            if t == "class_specifier":
                nested = self._extract_class(child)
                if nested is not None:
                    class_sym.children.append(nested)
                return
            if t == "struct_specifier":
                nested = self._extract_struct_or_union(child, "struct")
                if nested is not None:
                    class_sym.children.append(nested)
                return
            if t == "function_definition":
                method = self._extract_cpp_method(child)
                if method is not None:
                    class_sym.children.append(method)
                return

    # ------------------------------------------------------------------
    # Methods (inside class bodies)
    # ------------------------------------------------------------------

    def _extract_cpp_method(
        self,
        node: "tree_sitter.Node",
    ) -> Symbol | None:
        """Build a Symbol for a method definition inside a class.

        Reuses the C function-definition extraction path for
        parameters, return type, and call sites, then upgrades
        kind to ``'method'``. Also handles C++-specific
        declarator shapes:

        - Regular method: ``void foo() {}`` — identifier name.
        - Constructor: ``Foo() {}`` — identifier matching the
          class name, no return type. The C extractor's
          ``_extract_function_definition`` rejects this (it
          requires a ``type`` field); we handle it here.
        - Destructor: ``~Foo()`` — declarator is a
          ``destructor_name``.
        - Operator: ``operator+()`` — declarator is an
          ``operator_name``.

        Returns None for shapes we can't parse cleanly.
        """
        declarator = node.child_by_field_name("declarator")
        if declarator is None:
            return None

        fn_decl = self._unwrap_declarator(declarator)
        if fn_decl is None or fn_decl.type != "function_declarator":
            return None

        name_node = fn_decl.child_by_field_name("declarator")
        if name_node is None:
            return None
        name = self._cpp_method_name(name_node)
        if not name:
            return None

        sym = Symbol(
            name=name,
            kind="method",
            file_path=self._path,
            range=self._range(node),
        )

        # Return type — present for regular methods, absent for
        # constructors and destructors. Take whatever the type
        # field gives us; None is fine for ctors/dtors.
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

    def _cpp_method_name(
        self,
        node: "tree_sitter.Node",
    ) -> str:
        """Resolve a C++ method-declarator name to its display form.

        Handles the shapes that appear in the declarator position
        of a ``function_declarator``:

        - ``identifier`` — regular method
        - ``field_identifier`` — method declared inside a class
          body uses this node type in some grammar versions
        - ``destructor_name`` — ``~Foo`` (tilde + identifier
          children; we capture the full source text)
        - ``operator_name`` — ``operator+`` etc. (source text)
        - ``qualified_identifier`` — ``Foo::bar`` for out-of-class
          definitions; source text preserves the scope prefix
        - Wrapped in ``pointer_declarator`` for ``int * foo();``
          style — unwrap first
        """
        inner = self._unwrap_declarator(node)
        if inner is None:
            return ""
        t = inner.type
        if t in (
            "identifier",
            "field_identifier",
            "destructor_name",
            "operator_name",
            "qualified_identifier",
        ):
            return self._node_text(inner, self._source)
        return ""

    # ------------------------------------------------------------------
    # Field declarations (data members + method prototypes)
    # ------------------------------------------------------------------

    def _handle_cpp_field_declaration(
        self,
        field_decl: "tree_sitter.Node",
        class_sym: Symbol,
    ) -> None:
        """Dispatch a ``field_declaration`` inside a C++ class body.

        C++ grammar uses ``field_declaration`` for both:

        - Data members: ``int count;`` — delegate to the C
          extractor's ``_extract_field_declaration`` which
          produces variable children.
        - Method prototypes: ``void greet();`` — the declarator
          is a ``function_declarator`` (possibly wrapped in
          pointer/array/parenthesized layers for unusual
          shapes like returning a function pointer).

        We can't just "look at the first named child" — the
        type specifier appears as a named child too
        (primitive_type, struct_specifier, etc.), so blindly
        unwrapping the first child and finding a non-function
        shape would falsely route to the data-member path.
        Scan the field_declaration's ``_find_children`` for
        declarator-typed children specifically, unwrap each,
        and dispatch to method-prototype extraction if any
        yields a function_declarator.
        """
        for declarator in self._find_children(
            field_decl,
            "function_declarator",
            "pointer_declarator",
            "array_declarator",
            "parenthesized_declarator",
            "field_identifier",
            "identifier",
        ):
            inner = self._unwrap_declarator(declarator)
            if inner is None:
                continue
            if inner.type == "function_declarator":
                method = self._extract_method_prototype(
                    field_decl, inner
                )
                if method is not None:
                    class_sym.children.append(method)
                return
            # Found an identifier-kind declarator — definitely
            # a data member. Stop scanning; C path handles it.
            break

        # Data members — reuse the C path.
        self._extract_field_declaration(field_decl, class_sym)

    def _extract_method_prototype(
        self,
        field_decl: "tree_sitter.Node",
        fn_decl: "tree_sitter.Node",
    ) -> Symbol | None:
        """Build a method Symbol for a prototype inside a class body.

        ``void greet(int);`` — no body, so no call sites. Return
        type comes from the enclosing ``field_declaration``'s
        ``type`` field.
        """
        name_node = fn_decl.child_by_field_name("declarator")
        if name_node is None:
            return None
        name = self._cpp_method_name(name_node)
        if not name:
            return None

        sym = Symbol(
            name=name,
            kind="method",
            file_path=self._path,
            range=self._range(field_decl),
        )

        type_node = field_decl.child_by_field_name("type")
        if type_node is not None:
            sym.return_type = self._node_text(
                type_node, self._source
            )

        params_node = fn_decl.child_by_field_name("parameters")
        if params_node is not None:
            sym.parameters = self._extract_parameters(params_node)

        return sym

    # ------------------------------------------------------------------
    # Namespaces
    # ------------------------------------------------------------------

    def _extract_namespace(
        self,
        node: "tree_sitter.Node",
    ) -> Symbol | None:
        """Build a Symbol for a ``namespace_definition`` node.

        Rendered as ``kind='class'`` — the symbol map treats
        namespaces as scope containers, same visual shape as
        classes. Nested declarations (classes, functions,
        nested namespaces) become children.

        Anonymous namespaces (``namespace { ... }``) produce no
        symbol — there's no name to navigate to, and their
        contents are only visible in the current translation
        unit anyway.
        """
        name_node = node.child_by_field_name("name")
        if name_node is None:
            # Anonymous namespace — skip.
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
            self._populate_namespace_body(sym, body)

        return sym

    def _populate_namespace_body(
        self,
        ns_sym: Symbol,
        body: "tree_sitter.Node",
    ) -> None:
        """Walk a namespace body, attaching contents as children.

        Namespaces can contain anything top-level can contain:
        classes, structs, functions, nested namespaces, using
        declarations, typedefs. We build a synthetic FileSymbols
        to reuse the top-level dispatcher, then attach the
        collected symbols to the namespace. Imports from
        ``using`` declarations inside a namespace are discarded
        — they're namespace-scoped, not file-scoped, and surfacing
        them as file-level imports would be misleading.
        """
        inner_result = FileSymbols(file_path=self._path)
        for child in body.named_children:
            self._handle_top_level(child, inner_result)
        ns_sym.children.extend(inner_result.symbols)

    # ------------------------------------------------------------------
    # Using declarations (imports)
    # ------------------------------------------------------------------

    def _extract_using(
        self,
        node: "tree_sitter.Node",
    ) -> Import | None:
        """Extract a ``using`` declaration as an Import.

        Two shapes:

        - ``using foo::bar;`` — imports a specific name; the
          named child is a ``qualified_identifier`` whose text
          is the full qualified name.
        - ``using namespace foo;`` — imports all names from a
          namespace. The ``namespace`` keyword is anonymous in
          the grammar; we still land on the qualified_identifier
          as the first named child.

        We store the full qualified text as the module, matching
        the ``std::vector`` conventions users expect to see.
        Returns None if the declaration has no resolvable name.
        """
        line = self._start_line(node) + 1
        name_node = None
        for child in node.named_children:
            if child.type in (
                "qualified_identifier",
                "identifier",
                "type_identifier",
            ):
                name_node = child
                break
        if name_node is None:
            return None

        module = self._node_text(name_node, self._source)
        return Import(module=module, line=line)

    # ------------------------------------------------------------------
    # Call sites — extend the builtin filter with C++ extras
    # ------------------------------------------------------------------

    def _extract_call_sites(
        self,
        body: "tree_sitter.Node",
    ) -> "list":
        """Collect call sites inside a function/method body.

        Mirrors the C extractor's walk but filters against the
        union of C and C++ builtins. Also resolves
        ``qualified_identifier`` callees — ``std::move(x)`` shows
        up as a call whose callee is a qualified_identifier. We
        take the tail component via ``_callee_name`` for the
        filter check so ``std::move`` resolves to ``move`` and
        gets filtered.
        """
        from ac_dc.symbol_index.extractors.c import _C_BUILTINS
        from ac_dc.symbol_index.models import CallSite

        combined = _C_BUILTINS | _CPP_EXTRA_BUILTINS
        sites: list[CallSite] = []

        def _visit(node: "tree_sitter.Node") -> None:
            if node.type != "call_expression":
                return
            fn = node.child_by_field_name("function")
            if fn is None:
                return
            name = self._callee_name(fn)
            if not name or name in combined:
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
    ) -> "str | None":
        """Resolve a callable expression to a simple name.

        Extends the C extractor's handling with:

        - ``qualified_identifier`` (``std::move``, ``foo::bar``) —
          return the tail component (``move``, ``bar``). The
          scope prefix is noise for the reference graph; callers
          in ``std::`` get filtered as builtins via the tail
          match.
        - ``template_function`` (``std::make_unique<Foo>``) — the
          grammar wraps it in a template_function node whose
          ``name`` field holds the callable. Unwrap and recurse.

        Falls through to the C implementation for identifier and
        field_expression shapes.
        """
        t = node.type
        if t == "qualified_identifier":
            name_field = node.child_by_field_name("name")
            if name_field is not None:
                return self._callee_name(name_field)
            last = None
            for child in node.named_children:
                last = child
            if last is not None:
                return self._callee_name(last)
            return None
        if t == "template_function":
            name_field = node.child_by_field_name("name")
            if name_field is not None:
                return self._callee_name(name_field)
        return super()._callee_name(node)