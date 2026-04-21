"""TypeScript symbol extractor.

Subclass of :class:`JavaScriptExtractor` that adds type-awareness
over the shared JS grammar shape. TypeScript is a syntactic
superset of JavaScript — tree-sitter-typescript reuses most
node types from tree-sitter-javascript (``class_declaration``,
``function_declaration``, ``method_definition``, ``import_statement``,
``call_expression``, ``new_expression``, etc.) but adds:

- ``type_annotation`` children on parameters (``x: number``)
- ``return_type`` field on functions (``function f(): Promise<void>``)
- Optional parameter markers (``x?: number``)
- ``interface_declaration``, ``type_alias_declaration``,
  ``enum_declaration`` top-level constructs
- ``abstract`` class modifier, access modifiers (``public``,
  ``private``, ``protected``, ``readonly``) on class members

What we inherit unchanged from JS:

- Classes, ``extends`` clause, method dispatch, field_definition
- Top-level functions, generators, export unwrapping, imports,
  call sites, builtin filtering

What this subclass adds (layered on top):

- Parameter ``type_annotation`` — populates
  :attr:`Parameter.type_annotation`
- Function/method ``return_type`` — populates
  :attr:`Symbol.return_type`
- Optional parameter marker — preserved in the parameter name
  (``x?``) so the symbol map renders an accurate signature
- ``interface_declaration`` → Symbol(kind='class') with
  member methods as children — treated like a class for
  symbol-map purposes since the LLM consumes structure, not
  runtime semantics
- ``type_alias_declaration`` → Symbol(kind='variable') — keeps
  the name visible in the map; the aliased type body isn't
  rendered
- ``enum_declaration`` → Symbol(kind='class') with enum members
  as variable children

What we deliberately DON'T model:

- Generic type parameters (``<T>``) — not surfaced as symbols
- Access modifiers (public/private/protected) — TypeScript
  types, not runtime distinctions; the symbol map doesn't care
- Ambient declarations (``declare``) — same reasoning
- Decorator-based metaprogramming — specs3 didn't

Governing spec: ``specs4/2-indexing/symbol-index.md``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from ac_dc.symbol_index.extractors.javascript import JavaScriptExtractor
from ac_dc.symbol_index.models import FileSymbols, Parameter, Symbol

if TYPE_CHECKING:
    import tree_sitter


class TypeScriptExtractor(JavaScriptExtractor):
    """Extract symbols from a tree-sitter TypeScript parse tree.

    Inherits every method from :class:`JavaScriptExtractor` at
    construction. Subsequent methods on this class override only
    the JS behaviour that needs to change for TypeScript — see
    the module docstring for the surface.
    """

    language = "typescript"

    # ------------------------------------------------------------------
    # Top-level dispatch — add TS-specific declarations
    # ------------------------------------------------------------------

    def _handle_top_level(
        self,
        node: "tree_sitter.Node",
        result: FileSymbols,
    ) -> None:
        """Dispatch top-level node, adding TS-specific constructs.

        TS extends the JS top-level set with three constructs:

        - ``interface_declaration`` → Symbol(kind='class') with
          method/property members as children
        - ``type_alias_declaration`` → Symbol(kind='variable')
          naming the alias; the aliased type body isn't rendered
        - ``enum_declaration`` → Symbol(kind='class') with
          member identifiers as variable children

        Unknown-to-JS node types fall through to the parent
        handler, which silently ignores them. Known JS types
        (function_declaration, class_declaration, etc.) are
        handled by the JS parent.
        """
        t = node.type
        if t == "interface_declaration":
            sym = self._extract_interface(node)
            if sym is not None:
                result.symbols.append(sym)
            return
        if t == "type_alias_declaration":
            sym = self._extract_type_alias(node)
            if sym is not None:
                result.symbols.append(sym)
            return
        if t == "enum_declaration":
            sym = self._extract_enum(node)
            if sym is not None:
                result.symbols.append(sym)
            return
        # Fall through to JS handler for everything else.
        super()._handle_top_level(node, result)

    # ------------------------------------------------------------------
    # Parameters — handle TS wrapper nodes
    # ------------------------------------------------------------------

    def _build_parameter(
        self,
        node: "tree_sitter.Node",
    ) -> Parameter | None:
        """Build one Parameter, handling TS-specific wrappers.

        tree-sitter-typescript wraps most parameters in one of:

        - ``required_parameter`` — regular typed param, optionally
          with a default
        - ``optional_parameter`` — the ``x?: T`` shape

        Inside both, a ``pattern`` field holds the name (usually an
        identifier, but also object/array patterns for destructuring),
        and an optional ``type`` field wraps a ``type_annotation``.
        A ``value`` field carries the default when present.

        Shapes that match JS verbatim — bare identifiers, rest
        patterns, raw destructuring — fall through to the JS
        handler, which already covers them.
        """
        t = node.type
        if t == "required_parameter":
            return self._build_required_parameter(node)
        if t == "optional_parameter":
            return self._build_optional_parameter(node)
        # Unwrapped identifier, rest_pattern, etc. — same as JS.
        return super()._build_parameter(node)

    def _build_required_parameter(
        self,
        node: "tree_sitter.Node",
    ) -> Parameter | None:
        """Build a Parameter from a ``required_parameter`` node.

        The shape is roughly ``pattern (type)? (= value)?``:

        - ``pattern`` is either an identifier, a destructuring
          pattern (object_pattern / array_pattern), or a
          ``rest_pattern``. For destructuring we reuse the JS
          pattern-naming helper so the synthetic name is
          consistent across languages. For rest patterns,
          tree-sitter-typescript DOES wrap them in
          ``required_parameter`` (unlike the module docstring's
          earlier assumption) — we detect the rest shape and
          strip the ``...`` prefix, marking the parameter as
          a vararg.
        - ``type`` wraps a ``type_annotation``. Its single
          non-anonymous child is the actual type node; we
          capture its source text verbatim.
        - ``value`` is the default-expression text.
        """
        pattern_node = node.child_by_field_name("pattern")
        if pattern_node is None:
            return None
        # Rest parameters wrapped in required_parameter — detect
        # by the pattern's node type. The pattern's identifier
        # child carries the real name; the ``...`` is an
        # anonymous token sibling that doesn't participate in
        # named-child iteration.
        is_vararg = pattern_node.type == "rest_pattern"
        if is_vararg:
            inner = self._find_child(pattern_node, "identifier")
            name = (
                self._node_text(inner, self._source)
                if inner is not None
                else "args"
            )
        else:
            name = self._pattern_name(pattern_node)
        type_ann = self._extract_type_annotation(node)
        default = self._extract_parameter_default(node)
        return Parameter(
            name=name,
            type_annotation=type_ann,
            default=default,
            is_vararg=is_vararg,
        )

    def _build_optional_parameter(
        self,
        node: "tree_sitter.Node",
    ) -> Parameter | None:
        """Build a Parameter from an ``optional_parameter`` node.

        Identical to ``required_parameter`` except the name is
        suffixed with ``?`` so the symbol map signature renders
        the optional marker. The extractor could introduce a
        separate ``is_optional`` field on :class:`Parameter`, but
        specs3 chose in-name encoding — consumers already get
        the signal for free.
        """
        pattern_node = node.child_by_field_name("pattern")
        if pattern_node is None:
            return None
        name = self._pattern_name(pattern_node) + "?"
        type_ann = self._extract_type_annotation(node)
        default = self._extract_parameter_default(node)
        return Parameter(
            name=name,
            type_annotation=type_ann,
            default=default,
        )

    def _extract_type_annotation(
        self,
        param_node: "tree_sitter.Node",
    ) -> str | None:
        """Return the source text of a parameter's type annotation.

        tree-sitter-typescript assigns the annotation to the
        ``type`` field of the parameter node. The field's value
        is a ``type_annotation`` wrapper whose single non-
        anonymous child is the actual type node (``type_identifier``,
        ``generic_type``, ``union_type``, etc.). We capture the
        wrapped type's source text verbatim — preserves generics,
        unions, mapped types, etc. without modelling them
        structurally.
        """
        type_node = param_node.child_by_field_name("type")
        if type_node is None:
            return None
        # type_annotation wraps the real type in its first named
        # child. Fall back to the wrapper's own text if the
        # grammar version puts the type directly.
        for child in type_node.named_children:
            return self._node_text(child, self._source)
        return self._node_text(type_node, self._source)

    def _extract_parameter_default(
        self,
        param_node: "tree_sitter.Node",
    ) -> str | None:
        """Return the default-expression source text, or None."""
        value_node = param_node.child_by_field_name("value")
        if value_node is None:
            return None
        return self._node_text(value_node, self._source)

    # ------------------------------------------------------------------
    # Functions / methods — add return-type capture
    # ------------------------------------------------------------------

    def _extract_function(
        self,
        node: "tree_sitter.Node",
        *,
        is_method: bool,
    ) -> Symbol | None:
        """Extract a function/method Symbol and add TS return type.

        Delegates the structural work (name, kind, async, params,
        body call sites) to the JS base, then layers the TS
        ``return_type`` field on top. Keeping the override narrow
        avoids duplicating the JS logic and means any future JS
        changes flow through automatically.
        """
        sym = super()._extract_function(node, is_method=is_method)
        if sym is None:
            return None
        return_type = self._extract_return_type(node)
        if return_type is not None:
            sym.return_type = return_type
        return sym

    def _extract_return_type(
        self,
        node: "tree_sitter.Node",
    ) -> str | None:
        """Return the source text of a function's return-type annotation.

        Same wrapping convention as parameter type annotations —
        a ``type_annotation`` node assigned to the ``return_type``
        field, whose first non-anonymous child is the actual
        type. Captures the wrapped type's source verbatim so
        generics and unions round-trip into the symbol map.
        """
        ret_node = node.child_by_field_name("return_type")
        if ret_node is None:
            return None
        for child in ret_node.named_children:
            return self._node_text(child, self._source)
        return self._node_text(ret_node, self._source)

    def _populate_function_from_value(
        self,
        sym: Symbol,
        value_node: "tree_sitter.Node",
    ) -> None:
        """Populate params/body call sites AND return type from a value.

        Delegates to the JS base for params and call sites, then
        adds ``return_type`` so ``const foo = (): T => ...`` and
        ``const foo = function(): T {}`` carry type info through
        to the symbol map, same as top-level function declarations.
        """
        super()._populate_function_from_value(sym, value_node)
        return_type = self._extract_return_type(value_node)
        if return_type is not None:
            sym.return_type = return_type

    # ------------------------------------------------------------------
    # Interfaces — treated as classes for symbol-map purposes
    # ------------------------------------------------------------------

    def _extract_interface(
        self,
        node: "tree_sitter.Node",
    ) -> Symbol | None:
        """Build a Symbol for an ``interface_declaration``.

        Interfaces are a TS-only structural type. We render them
        as ``kind='class'`` so the symbol map treats them
        uniformly with classes — the LLM consumes structure, not
        runtime semantics, and an interface's member signatures
        are just as useful as a class's method signatures.

        Members come from a ``body`` field wrapping an
        ``object_type`` (or ``interface_body`` in some grammar
        versions) whose children are one of:

        - ``method_signature`` — ``greet(name: string): string;``
          → Symbol(kind='method') with params and return type
        - ``property_signature`` — ``greeting: string;``
          → Symbol(kind='variable') with the type preserved as
          return_type for rendering
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
        # Bases — ``interface Foo extends Bar`` emits a
        # ``class_heritage`` or ``extends_type_clause`` sibling;
        # both shapes have the base expression as a named child.
        sym.bases = self._extract_interface_bases(node)

        body = node.child_by_field_name("body")
        if body is not None:
            self._populate_interface_body(sym, body)

        return sym

    def _extract_class_bases(
        self,
        class_node: "tree_sitter.Node",
    ) -> list[str]:
        """Return base names for a TS class, stripping the ``extends`` keyword.

        tree-sitter-typescript emits the ``extends`` keyword as
        part of the ``class_heritage`` node's text rather than
        as a separate anonymous-token child, so JS's base
        extractor (which takes each named child's verbatim
        source text) returns ``'extends Bar'`` instead of
        ``'Bar'``. Strip the leading keyword here.

        TS classes still have single inheritance at runtime —
        ``implements`` is a different clause and doesn't show
        up here. But we strip defensively in case a grammar
        version emits something unexpected.
        """
        heritage = self._find_child(class_node, "class_heritage")
        if heritage is None:
            return []
        bases: list[str] = []
        for child in heritage.named_children:
            text = self._node_text(child, self._source)
            # Strip leading ``extends``/``implements`` keyword.
            # The keyword appears as the first word followed by
            # whitespace; splitting once handles multi-word
            # expressions like ``extends Foo<T>`` cleanly.
            for keyword in ("extends ", "implements "):
                if text.startswith(keyword):
                    text = text[len(keyword):]
                    break
            bases.append(text.strip())
        return bases

    def _extract_interface_bases(
        self,
        iface_node: "tree_sitter.Node",
    ) -> list[str]:
        """Return base names from an interface's extends clause.

        Interface inheritance isn't assigned to a named field
        across grammar versions — it's a direct child named
        ``extends_type_clause`` (newer grammars) or
        ``extends_clause``. We scan direct children for either,
        then collect each named child as a base name. Multiple
        bases (``interface A extends B, C``) all land in the
        same clause, unlike JS's single-inheritance class model.
        """
        bases: list[str] = []
        for child in iface_node.children:
            if child.type not in (
                "extends_type_clause",
                "extends_clause",
            ):
                continue
            for entry in child.named_children:
                bases.append(self._node_text(entry, self._source))
        return bases

    def _populate_interface_body(
        self,
        iface_sym: Symbol,
        body: "tree_sitter.Node",
    ) -> None:
        """Attach method/property signatures as children.

        Unknown child node types are silently skipped — some
        grammars emit ``index_signature``, ``call_signature``, and
        ``construct_signature`` nodes too, but rendering those
        meaningfully would need more modelling than the symbol
        map benefits from.
        """
        for child in body.named_children:
            if child.type == "method_signature":
                member = self._extract_method_signature(child)
                if member is not None:
                    iface_sym.children.append(member)
            elif child.type == "property_signature":
                member = self._extract_property_signature(child)
                if member is not None:
                    iface_sym.children.append(member)

    def _extract_method_signature(
        self,
        node: "tree_sitter.Node",
    ) -> Symbol | None:
        """Build a Symbol for an interface ``method_signature``.

        Same field layout as ``method_definition`` (name,
        parameters, return_type) but with no body — method
        signatures are declarations only. We extract name,
        parameters, and return type and leave ``call_sites``
        empty.
        """
        name_node = node.child_by_field_name("name")
        if name_node is None:
            return None
        name = self._node_text(name_node, self._source)

        sym = Symbol(
            name=name,
            kind="method",
            file_path=self._path,
            range=self._range(node),
        )
        params_node = node.child_by_field_name("parameters")
        if params_node is not None:
            sym.parameters = self._extract_parameters(params_node)
        return_type = self._extract_return_type(node)
        if return_type is not None:
            sym.return_type = return_type
        return sym

    def _extract_property_signature(
        self,
        node: "tree_sitter.Node",
    ) -> Symbol | None:
        """Build a Symbol for an interface ``property_signature``.

        Properties are data members on an interface. We render
        them as ``kind='variable'`` — same treatment as class
        fields. The property's type annotation is lifted into
        ``return_type`` for the symbol map to show; strictly
        it's not a return type, but the renderer uses that
        field to display the type after the name (``x -> string``)
        which is exactly what we want for ``x: string``.

        Optional properties (``x?: T``) get their ``?`` suffix
        preserved in the name, matching the optional-parameter
        convention.
        """
        name_node = node.child_by_field_name("name")
        if name_node is None:
            return None
        name = self._node_text(name_node, self._source)
        # Optional marker — tree-sitter-typescript emits an
        # anonymous '?' child when present. Scan direct children
        # for it so we can append the marker to the name.
        for child in node.children:
            if child.type == "?":
                name = name + "?"
                break

        sym = Symbol(
            name=name,
            kind="variable",
            file_path=self._path,
            range=self._range(node),
        )
        # Lift the type annotation into return_type for render.
        type_ann = self._extract_type_annotation(node)
        if type_ann is not None:
            sym.return_type = type_ann
        return sym

    # ------------------------------------------------------------------
    # Type aliases — bare name entries
    # ------------------------------------------------------------------

    def _extract_type_alias(
        self,
        node: "tree_sitter.Node",
    ) -> Symbol | None:
        """Build a Symbol for a ``type_alias_declaration``.

        ``type Point = { x: number; y: number }`` — we surface
        the name ``Point`` as a variable symbol so the symbol
        map lists it. The aliased type body isn't rendered; the
        LLM can load the file if it needs more detail. Kind is
        ``'variable'`` because the symbol has no members to
        enumerate (unlike an interface or enum).
        """
        name_node = node.child_by_field_name("name")
        if name_node is None:
            return None
        name = self._node_text(name_node, self._source)

        return Symbol(
            name=name,
            kind="variable",
            file_path=self._path,
            range=self._range(node),
        )

    # ------------------------------------------------------------------
    # Enums — treated as classes with variable children
    # ------------------------------------------------------------------

    def _extract_enum(
        self,
        node: "tree_sitter.Node",
    ) -> Symbol | None:
        """Build a Symbol for an ``enum_declaration``.

        ``enum Color { Red, Green, Blue }`` — we treat the enum
        as ``kind='class'`` with each member as a variable child.
        This mirrors the interface treatment and produces a
        useful symbol-map rendering: the enum name appears as a
        class-like container, and the members appear as nested
        symbols the LLM can reference.

        Enum members come in two shapes in the grammar:

        - Bare identifiers (``Red``, ``Green``) — auto-numbered
          entries, the member IS the identifier node
        - ``enum_assignment`` — ``Red = 1`` or ``Red = "red"``,
          wraps the identifier and the value expression
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

        Scans the body's named children for the two member
        shapes. Unknown shapes are silently skipped — defensive
        against grammar evolution.
        """
        for child in body.named_children:
            member = self._extract_enum_member(child)
            if member is not None:
                enum_sym.children.append(member)

    def _extract_enum_member(
        self,
        node: "tree_sitter.Node",
    ) -> Symbol | None:
        """Build a Symbol for one enum member.

        - ``property_identifier`` / ``identifier`` → the
          identifier IS the name (``Red`` in
          ``enum Color { Red }``). We use the node text.
        - ``enum_assignment`` → the ``name`` field carries the
          identifier; the ``value`` field has the assigned
          expression which we don't surface (the symbol map
          only needs the name).
        """
        t = node.type
        if t in ("property_identifier", "identifier"):
            name = self._node_text(node, self._source)
            return Symbol(
                name=name,
                kind="variable",
                file_path=self._path,
                range=self._range(node),
            )
        if t == "enum_assignment":
            name_node = node.child_by_field_name("name")
            if name_node is None:
                # Fall back to the first named child — some
                # grammar versions don't use the name field.
                for child in node.named_children:
                    name_node = child
                    break
            if name_node is None:
                return None
            name = self._node_text(name_node, self._source)
            return Symbol(
                name=name,
                kind="variable",
                file_path=self._path,
                range=self._range(node),
            )
        return None