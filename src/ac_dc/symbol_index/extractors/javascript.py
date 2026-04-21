"""JavaScript symbol extractor.

Walks a tree-sitter JavaScript AST and produces a
:class:`~ac_dc.symbol_index.models.FileSymbols`. Handles:

- Classes with inheritance (``extends`` clause, arbitrary
  expressions preserved as source text)
- Methods, including getters/setters (upgraded to kind
  ``"property"``), async methods, ``static`` and ``#private``
  members
- Top-level ``function`` declarations (sync + async)
- Top-level ``const`` / ``let`` / ``var`` bindings that hold
  arrow functions or function expressions — extracted as
  function symbols rather than variables (matches specs3)
- Other top-level ``const`` / ``let`` / ``var`` bindings —
  extracted as variable symbols
- ESM imports — default, named, namespace, side-effect
- Call sites inside function/method bodies

Deliberate scope decisions (see IMPLEMENTATION_NOTES.md section 2.2.3):

- CommonJS (``require(...)``, ``module.exports``) is NOT
  modelled. ESM covers modern JS; the resolver would need
  extension to handle CJS properly and the effort doesn't
  earn its keep.
- ``export`` wrappers pass through to the inner
  declaration — ``export function foo() {}`` produces a
  regular function symbol named ``foo``.
- ``export default`` on an anonymous declaration produces no
  symbol (nothing to name it).
- Parameters with destructuring (``function f({a, b})``) get
  a synthetic name derived from the source text — less
  precise than named extraction but avoids modelling every
  destructuring pattern shape.

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


# JavaScript/TypeScript globals always excluded from call-site
# extraction. Kept small — tree-sitter already excludes keywords
# (if, for, while, return, etc.) from identifier nodes, so we
# only need to filter globals that grammatically look like
# function calls.
_JS_BUILTINS = frozenset({
    "console", "window", "document", "globalThis", "self",
    "Array", "Object", "String", "Number", "Boolean", "Symbol",
    "Date", "Error", "TypeError", "RangeError", "Map", "Set",
    "WeakMap", "WeakSet", "Promise", "JSON", "Math", "RegExp",
    "parseInt", "parseFloat", "isNaN", "isFinite",
    "encodeURIComponent", "decodeURIComponent",
    "setTimeout", "setInterval", "clearTimeout", "clearInterval",
    # require() is deliberately here — we don't model CommonJS,
    # but a repo using it shouldn't produce a require edge to
    # every file.
    "require",
    # Common test-framework globals. Their calls would create
    # massive reference edges from every test file.
    "describe", "it", "test", "expect", "beforeEach",
    "afterEach", "beforeAll", "afterAll",
})


class JavaScriptExtractor(BaseExtractor):
    """Extract symbols from a tree-sitter JavaScript parse tree.

    Stateless across calls — construct once, reuse. Not
    thread-safe for concurrent extraction on a single instance
    (uses ``_source`` / ``_path`` during a single call), which
    matches the orchestrator's single-threaded driving pattern.
    """

    language = "javascript"

    def extract(
        self,
        tree: "tree_sitter.Tree | None",
        source: bytes,
        path: str,
    ) -> FileSymbols:
        if tree is None:
            # See PythonExtractor — same defensive path.
            return FileSymbols(file_path=path)

        self._source = source
        self._path = path

        result = FileSymbols(file_path=path)
        # Program is the root for JS/TS; walk direct children
        # to pick up top-level constructs.
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
        """Route a direct child of the program to the right handler.

        JavaScript has fewer top-level shapes than Python but
        more nesting through export wrappers. ``export``
        statements unwrap to their inner declaration; everything
        else dispatches by node type.

        Unknown node types are silently ignored — JS modules
        contain many statements that don't contribute symbols
        (bare expressions, control flow, throw statements).
        """
        t = node.type
        if t == "import_statement":
            imports = self._extract_import_statement(node)
            result.imports.extend(imports)
        elif t == "function_declaration":
            func = self._extract_function(node, is_method=False)
            if func is not None:
                result.symbols.append(func)
        elif t == "generator_function_declaration":
            # ``function* foo()`` — generators parse as their own
            # node type but we treat them as plain functions for
            # symbol-map purposes.
            func = self._extract_function(node, is_method=False)
            if func is not None:
                result.symbols.append(func)
        elif t == "class_declaration":
            cls = self._extract_class(node)
            if cls is not None:
                result.symbols.append(cls)
        elif t in ("lexical_declaration", "variable_declaration"):
            # const/let (lexical) and var (variable). Each
            # declarator gets handled individually — a single
            # ``const a = 1, b = 2`` produces two symbols.
            result.symbols.extend(
                self._extract_declaration(node)
            )
        elif t == "export_statement":
            # ``export function foo() {}`` / ``export class Foo {}``
            # / ``export const x = 1``. Walk into the inner
            # declaration and dispatch it as if it were at the
            # top level. Export-only statements like
            # ``export { foo }`` (re-exports without a
            # declaration) have no declaration child and
            # contribute no symbols.
            self._handle_export(node, result)

    def _handle_export(
        self,
        node: "tree_sitter.Node",
        result: FileSymbols,
    ) -> None:
        """Unwrap an ``export_statement`` to its inner declaration.

        ``export default function() {}`` — the anonymous
        declaration has no name, so it contributes no symbol.
        ``export default function foo() {}`` — named, so it
        does. ``export default SomeIdent`` — just re-exports an
        existing binding, no new symbol.
        """
        decl = node.child_by_field_name("declaration")
        if decl is None:
            # Older grammar versions don't use the field name —
            # scan for the same node types as the top-level
            # dispatcher.
            for child in node.named_children:
                if child.type in (
                    "function_declaration",
                    "generator_function_declaration",
                    "class_declaration",
                    "lexical_declaration",
                    "variable_declaration",
                ):
                    decl = child
                    break
        if decl is None:
            return
        self._handle_top_level(decl, result)

    # ------------------------------------------------------------------
    # Imports
    # ------------------------------------------------------------------

    def _extract_import_statement(
        self,
        node: "tree_sitter.Node",
    ) -> list[Import]:
        """Extract ESM ``import`` statements.

        Grammar shapes handled:

        - ``import "side-effect"``                 → names=[], alias=None
        - ``import foo from "x"``                  → names=["foo"] (default)
        - ``import { a, b } from "x"``             → names=["a", "b"]
        - ``import { a as b } from "x"``           → names=["a"], alias="b"
        - ``import * as ns from "x"``              → names=["*"], alias="ns"
        - ``import foo, { a } from "x"``           → names=["foo", "a"]

        Produces ONE Import record per statement — matching the
        Python extractor's convention. Multiple names under a
        single statement share the same ``module`` and ``line``.
        Per-name aliases are not separately preserved; the
        resolver only needs one signal that aliasing happened.
        """
        line = self._start_line(node) + 1
        module = self._import_source(node)
        if module is None:
            return []

        names: list[str] = []
        alias: str | None = None

        clause = self._find_child(node, "import_clause")
        if clause is not None:
            names, alias = self._parse_import_clause(clause)

        return [
            Import(
                module=module,
                names=names,
                alias=alias,
                line=line,
            )
        ]

    def _import_source(
        self,
        node: "tree_sitter.Node",
    ) -> str | None:
        """Return the module source string from an import.

        The source is a ``string`` node whose children include
        quotation marks and a ``string_fragment`` with the
        content. We prefer the fragment when present (cleaner —
        no surrounding quotes); fall back to stripping quotes
        from the node text otherwise.
        """
        source_node = node.child_by_field_name("source")
        if source_node is None:
            # Scan direct children for the string literal.
            for child in node.named_children:
                if child.type == "string":
                    source_node = child
                    break
        if source_node is None:
            return None
        # Prefer the fragment for clean content.
        for child in source_node.named_children:
            if child.type == "string_fragment":
                return self._node_text(child, self._source)
        # Fallback — strip surrounding quotes.
        raw = self._node_text(source_node, self._source)
        if len(raw) >= 2 and raw[0] in "\"'`" and raw[-1] == raw[0]:
            return raw[1:-1]
        return raw

    def _parse_import_clause(
        self,
        clause: "tree_sitter.Node",
    ) -> tuple[list[str], str | None]:
        """Parse an ``import_clause`` into (names, alias).

        The clause holds one or more of:

        - bare identifier       → default import
        - namespace_import      → ``* as ns``
        - named_imports         → ``{ a, b as c }``

        A single statement can mix a default and named/namespace:
        ``import foo, { a, b } from "x"`` has a default
        identifier alongside a named_imports child under the
        same clause. We collect everything into one flat names
        list and record the first alias we encounter.
        """
        names: list[str] = []
        alias: str | None = None

        for child in clause.children:
            if not child.is_named:
                continue
            if child.type == "identifier":
                # Default import — the identifier IS the name.
                names.append(self._node_text(child, self._source))
            elif child.type == "namespace_import":
                # ``* as ns`` — one identifier child for the
                # alias.
                ns_alias = self._find_child(child, "identifier")
                if ns_alias is not None:
                    names.append("*")
                    if alias is None:
                        alias = self._node_text(
                            ns_alias, self._source
                        )
            elif child.type == "named_imports":
                # { a, b as c } — each specifier is an
                # ``import_specifier`` with ``name`` and
                # optional ``alias`` fields.
                for spec in child.named_children:
                    if spec.type != "import_specifier":
                        continue
                    name_node = spec.child_by_field_name("name")
                    alias_node = spec.child_by_field_name("alias")
                    if name_node is not None:
                        names.append(
                            self._node_text(name_node, self._source)
                        )
                    if alias_node is not None and alias is None:
                        alias = self._node_text(
                            alias_node, self._source
                        )
        return names, alias

    # ------------------------------------------------------------------
    # Top-level declarations (const/let/var)
    # ------------------------------------------------------------------

    def _extract_declaration(
        self,
        node: "tree_sitter.Node",
    ) -> list[Symbol]:
        """Extract symbols from a lexical_declaration or variable_declaration.

        Each declarator under the statement produces one
        symbol. The declarator's ``value`` field decides the
        kind:

        - arrow function (``x => ...`` / ``(x) => ...``)         → function
        - function expression (``function(){}``)                  → function
        - anything else                                           → variable

        Destructuring LHS (``const { a, b } = obj``) is
        skipped — the pattern has no single identifier and
        modelling it as multiple symbols would need to recurse
        into the pattern shape. Matches specs3's limited
        scope for JS top-level variables.

        Private-convention filtering from Python doesn't apply —
        JS has no leading-underscore convention at the module
        level, and it would drop legitimate names like
        ``_internalHelper`` that might be exported. We extract
        whatever the declaration names.
        """
        symbols: list[Symbol] = []
        for declarator in node.named_children:
            if declarator.type != "variable_declarator":
                continue
            sym = self._extract_declarator(declarator)
            if sym is not None:
                symbols.append(sym)
        return symbols

    def _extract_declarator(
        self,
        declarator: "tree_sitter.Node",
    ) -> Symbol | None:
        """Build a Symbol from a single ``variable_declarator``.

        Returns None when the declarator has a non-identifier
        LHS (destructuring) — caller discards.
        """
        name_node = declarator.child_by_field_name("name")
        if name_node is None or name_node.type != "identifier":
            # Destructuring (``object_pattern`` / ``array_pattern``)
            # or malformed — skip.
            return None
        name = self._node_text(name_node, self._source)

        value_node = declarator.child_by_field_name("value")
        kind, is_async = self._classify_declarator_value(value_node)

        sym = Symbol(
            name=name,
            kind=kind,
            file_path=self._path,
            range=self._range(declarator),
            is_async=is_async,
        )

        # For function-valued bindings, pull parameters, return
        # type (TS will override this method later), and body
        # call sites from the value expression so the symbol
        # behaves exactly like a ``function foo()`` declaration.
        if kind == "function" and value_node is not None:
            self._populate_function_from_value(sym, value_node)

        return sym

    @staticmethod
    def _classify_declarator_value(
        value_node: "tree_sitter.Node | None",
    ) -> tuple[str, bool]:
        """Return (kind, is_async) for a declarator's value.

        ``const foo = async () => ...``     → ("function", True)
        ``const foo = () => ...``           → ("function", False)
        ``const foo = function() {}``       → ("function", False)
        ``const foo = async function() {}`` → ("function", True)
        ``const foo = 42``                  → ("variable", False)
        ``const foo``  (no initialiser)     → ("variable", False)
        """
        if value_node is None:
            return ("variable", False)
        t = value_node.type
        if t == "arrow_function":
            # tree-sitter-javascript marks async arrow functions
            # by having an ``async`` anonymous-token child. Scan
            # direct children for the keyword.
            is_async = any(
                c.type == "async" for c in value_node.children
            )
            return ("function", is_async)
        if t in ("function_expression", "generator_function"):
            is_async = any(
                c.type == "async" for c in value_node.children
            )
            return ("function", is_async)
        return ("variable", False)

    def _populate_function_from_value(
        self,
        sym: Symbol,
        value_node: "tree_sitter.Node",
    ) -> None:
        """Attach parameters and call sites from an arrow/function value.

        Both ``arrow_function`` and ``function_expression`` use
        the same ``parameters`` + ``body`` field shape as a
        regular ``function_declaration``, so we reuse the
        parameter and call-site extractors.

        Arrow functions with a single bare-identifier parameter
        (``x => x + 1``) are a special case — the grammar
        assigns the identifier to the ``parameter`` field
        (singular) rather than wrapping it in a ``parameters``
        node. Handle both.
        """
        params_node = value_node.child_by_field_name("parameters")
        if params_node is not None:
            sym.parameters = self._extract_parameters(params_node)
        else:
            single = value_node.child_by_field_name("parameter")
            if single is not None and single.type == "identifier":
                sym.parameters = [
                    Parameter(name=self._node_text(single, self._source))
                ]

        body = value_node.child_by_field_name("body")
        if body is not None:
            sym.call_sites = self._extract_call_sites(body)

    # ------------------------------------------------------------------
    # Functions and methods
    # ------------------------------------------------------------------

    def _extract_function(
        self,
        node: "tree_sitter.Node",
        *,
        is_method: bool,
    ) -> Symbol | None:
        """Build a Symbol for a function/method-shaped node.

        Handles:
        - ``function_declaration`` (top-level ``function foo()``)
        - ``generator_function_declaration`` (``function* foo()``)
        - ``method_definition`` (class body methods)

        ``is_method`` controls kind — top-level becomes
        ``"function"``, class-body becomes ``"method"``. Methods
        can further upgrade to ``"property"`` when the grammar
        marks them as ``get`` / ``set``; that branch is handled
        inside this function so callers don't need to know.
        """
        name_node = node.child_by_field_name("name")
        if name_node is None:
            # Anonymous function declaration — e.g. the shape
            # that appears under ``export default function() {}``.
            # No name to index.
            return None
        name = self._node_text(name_node, self._source)

        # Async detection — look for an ``async`` anonymous child.
        # tree-sitter-javascript emits it as an unnamed keyword
        # node rather than a field.
        is_async = any(c.type == "async" for c in node.children)

        kind = "method" if is_method else "function"

        if is_method:
            # Getters/setters become properties in the symbol
            # map (matches Python's @property treatment). The
            # grammar emits ``get`` / ``set`` as anonymous
            # children before the name.
            if self._method_is_accessor(node):
                kind = "property"

        sym = Symbol(
            name=name,
            kind=kind,
            file_path=self._path,
            range=self._range(node),
            is_async=is_async,
        )

        params_node = node.child_by_field_name("parameters")
        if params_node is not None:
            sym.parameters = self._extract_parameters(params_node)

        body = node.child_by_field_name("body")
        if body is not None:
            sym.call_sites = self._extract_call_sites(body)

        return sym

    @staticmethod
    def _method_is_accessor(
        node: "tree_sitter.Node",
    ) -> bool:
        """Return True when a method_definition is a getter/setter.

        ``get foo() {}`` / ``set foo(v) {}`` are still
        method_definition nodes in tree-sitter-javascript but
        carry an anonymous ``get`` or ``set`` child before the
        name. Scan for that marker.
        """
        for child in node.children:
            if child.type in ("get", "set"):
                return True
        return False

    # ------------------------------------------------------------------
    # Parameters
    # ------------------------------------------------------------------

    def _extract_parameters(
        self,
        params_node: "tree_sitter.Node",
    ) -> list[Parameter]:
        """Extract parameters from a ``formal_parameters`` node.

        tree-sitter-javascript shapes:

        - ``identifier``               → plain positional
        - ``assignment_pattern``       → ``x = default``
        - ``rest_pattern``             → ``...args``
        - ``object_pattern``           → ``{a, b}`` destructuring
        - ``array_pattern``            → ``[a, b]`` destructuring

        Destructuring patterns use their source text as a
        synthetic name — less precise than named extraction but
        avoids modelling every pattern shape. Matches the
        scope-tradeoff in the module docstring.

        No ``self`` stripping — that's a Python-only concern.
        ``this`` is implicit in JS methods and isn't a parameter.
        """
        params: list[Parameter] = []
        for child in params_node.named_children:
            param = self._build_parameter(child)
            if param is not None:
                params.append(param)
        return params

    def _build_parameter(
        self,
        node: "tree_sitter.Node",
    ) -> Parameter | None:
        """Build one Parameter from a formal-parameters child.

        Returns None for shapes we can't produce a Parameter
        from (unexpected node types). The caller filters None.
        """
        t = node.type
        if t == "identifier":
            return Parameter(name=self._node_text(node, self._source))

        if t == "assignment_pattern":
            # ``x = default`` — ``left`` holds the pattern,
            # ``right`` the default expression.
            left = node.child_by_field_name("left")
            right = node.child_by_field_name("right")
            if left is None:
                return None
            name = self._pattern_name(left)
            default = (
                self._node_text(right, self._source)
                if right is not None
                else None
            )
            return Parameter(name=name, default=default)

        if t == "rest_pattern":
            # ``...args`` — single identifier child carries
            # the name. Mark as vararg.
            name_node = self._find_child(node, "identifier")
            if name_node is None:
                return None
            return Parameter(
                name=self._node_text(name_node, self._source),
                is_vararg=True,
            )

        if t in ("object_pattern", "array_pattern"):
            # Destructuring — use source text as synthetic name.
            return Parameter(name=self._pattern_name(node))

        return None

    def _pattern_name(
        self,
        node: "tree_sitter.Node",
    ) -> str:
        """Return a display name for a parameter-position pattern.

        Plain identifiers return their text. Destructuring
        patterns return their source text, collapsed to a
        single line and bounded in length so a multi-line
        pattern doesn't produce a huge "name" in the symbol
        map output.
        """
        if node.type == "identifier":
            return self._node_text(node, self._source)
        text = self._node_text(node, self._source)
        # Collapse whitespace runs to single spaces — patterns
        # can span multiple lines in the source.
        collapsed = " ".join(text.split())
        if len(collapsed) > 60:
            collapsed = collapsed[:57] + "..."
        return collapsed

    # ------------------------------------------------------------------
    # Classes
    # ------------------------------------------------------------------

    def _extract_class(
        self,
        node: "tree_sitter.Node",
    ) -> Symbol | None:
        """Build a Symbol for a class_declaration node.

        - Name from the ``name`` field
        - Bases from the ``class_heritage`` — arbitrary
          expression preserved as source text (``Foo``,
          ``mixin(Foo)``, ``Namespace.Foo`` all valid)
        - Methods from the class_body — each ``method_definition``
          becomes a child; ``field_definition`` (class fields)
          contribute instance-var-style entries

        JS classes don't have an equivalent of Python's
        ``__init__`` instance-var inference; ``this.x = ...``
        inside a constructor is a call-site artefact, not a
        declaration. Class fields (``foo = 42``) are the ESM
        way and we do pick those up.
        """
        name_node = node.child_by_field_name("name")
        if name_node is None:
            # Anonymous class expression — no name to index.
            return None
        name = self._node_text(name_node, self._source)

        bases = self._extract_class_bases(node)
        sym = Symbol(
            name=name,
            kind="class",
            file_path=self._path,
            range=self._range(node),
            bases=bases,
        )

        body = node.child_by_field_name("body")
        if body is not None:
            self._populate_class_body(sym, body)

        return sym

    def _extract_class_bases(
        self,
        class_node: "tree_sitter.Node",
    ) -> list[str]:
        """Return base expression(s) from the class_heritage clause.

        tree-sitter-javascript wraps the ``extends X`` clause
        in a ``class_heritage`` node whose single named child
        is the base expression. ES classes only support single
        inheritance, so the returned list always has at most
        one entry; we use a list for API symmetry with the
        Python extractor (which supports multiple bases).
        """
        heritage = self._find_child(class_node, "class_heritage")
        if heritage is None:
            return []
        for child in heritage.named_children:
            return [self._node_text(child, self._source)]
        return []

    def _populate_class_body(
        self,
        class_sym: Symbol,
        body: "tree_sitter.Node",
    ) -> None:
        """Walk a class_body, attaching methods and class fields.

        Tree-sitter-javascript's class body children include
        method_definition nodes (regular methods, getters,
        setters, constructor, static/#private variants) and
        field_definition nodes (class field declarations —
        ``count = 0``, ``#secret = 42``, ``static X = 1``,
        bare ``name``). ``static`` appears as an anonymous
        keyword child of the field_definition, so iterating
        ``named_children`` naturally skips it.

        Semicolons separating fields are anonymous — filtered
        out by the ``named_children`` iteration.
        """
        for child in body.named_children:
            if child.type == "method_definition":
                method = self._extract_function(child, is_method=True)
                if method is not None:
                    class_sym.children.append(method)
            elif child.type == "field_definition":
                field = self._extract_class_field(child)
                if field is not None:
                    class_sym.children.append(field)

    def _extract_class_field(
        self,
        node: "tree_sitter.Node",
    ) -> Symbol | None:
        """Build a Symbol for a ``field_definition`` (class field).

        ``field_definition`` covers:

        - plain class fields ``count = 0``
        - ``#private`` fields
        - uninitialised fields ``name;``
        - ``static`` fields (keyword is an anonymous child)

        tree-sitter-javascript does NOT assign the name to a
        field in this node — the diagnostic dump shows the
        name appears as the first named child (a
        ``property_identifier`` or ``private_property_identifier``
        node), followed optionally by the initialiser value.
        We scan named children rather than using
        ``child_by_field_name("name")`` which would return
        None here.

        The hash prefix on private names is preserved (``#count``)
        because the ``private_property_identifier`` node's text
        includes it — accurate to source.

        Kind is ``"variable"`` — class fields are instance-level
        data bindings, analogous to how the Python extractor
        treats top-level vars. The symbol map renderer
        distinguishes by nesting depth, not by kind.
        """
        # Scan for the identifier-shaped named child. It's the
        # first (and for uninitialised fields, only) named
        # child. Public fields use ``property_identifier``;
        # private fields use ``private_property_identifier``.
        name_node = None
        for child in node.named_children:
            if child.type in (
                "property_identifier",
                "private_property_identifier",
            ):
                name_node = child
                break
        if name_node is None:
            # Unexpected shape — skip rather than crash.
            return None
        name = self._node_text(name_node, self._source)

        return Symbol(
            name=name,
            kind="variable",
            file_path=self._path,
            range=self._range(node),
        )

    # ------------------------------------------------------------------
    # Call sites
    # ------------------------------------------------------------------

    def _extract_call_sites(
        self,
        body: "tree_sitter.Node",
    ) -> list[CallSite]:
        """Collect call sites inside a function/method body.

        Walks every descendant ``call_expression`` and
        ``new_expression``:

        - ``foo()``            → identifier ``foo``
        - ``obj.foo()``        → member expression; record
                                  the property name ``foo``
        - ``a.b.c()``          → nested member; record the
                                  final component ``c``
        - ``obj?.foo()``       → optional chaining; treated
                                  the same as ``.foo()``
        - ``new Foo()``        → ``new_expression``, recorded
                                  as a call to ``Foo``
        - ``(expr)()``         → complex callee; skipped

        Builtin names (``console``, ``Array``, ``require``,
        etc.) are filtered via :data:`_JS_BUILTINS`. Test-
        framework globals are also filtered so test files
        don't produce spurious edges to every other file.

        Builtin filtering applies both to the callee name
        (``parseInt()``) AND to the root object of a member
        expression (``console.log()`` → root is ``console``,
        a builtin, so the whole chain is filtered). Without
        the root-object check, a call through a builtin
        namespace like ``Math.floor()`` or ``console.log()``
        would produce a spurious edge named for the leaf
        property.
        """
        sites: list[CallSite] = []

        def _visit(node: "tree_sitter.Node") -> None:
            if node.type == "call_expression":
                fn = node.child_by_field_name("function")
                if fn is None:
                    return
                if self._callee_root_is_builtin(fn):
                    return
                name = self._callee_name(fn)
                if not name or name in _JS_BUILTINS:
                    return
                sites.append(
                    CallSite(
                        name=name,
                        line=self._start_line(node) + 1,
                    )
                )
            elif node.type == "new_expression":
                # ``new Foo()`` — the ``constructor`` field
                # holds the class expression.
                ctor = node.child_by_field_name("constructor")
                if ctor is None:
                    return
                if self._callee_root_is_builtin(ctor):
                    return
                name = self._callee_name(ctor)
                if not name or name in _JS_BUILTINS:
                    return
                sites.append(
                    CallSite(
                        name=name,
                        line=self._start_line(node) + 1,
                    )
                )

        self._walk_named(body, _visit)
        return sites

    def _callee_root_is_builtin(
        self,
        node: "tree_sitter.Node",
    ) -> bool:
        """Return True when a callee's root identifier is a builtin.

        For ``console.log(...)``, the callee is a
        ``member_expression`` whose ``object`` field is the
        identifier ``console``. We walk the object chain to
        the leftmost identifier and test it against the
        builtin set.

        For a bare identifier callee, the root is the
        identifier itself — but the existing ``name in
        _JS_BUILTINS`` check in the visitor already handles
        that, so we only need to recurse through
        member_expression shapes here.

        Subscript and call-expression callees return False —
        their "root" isn't statically extractable, and the
        visitor will drop them via ``_callee_name`` returning
        None anyway.
        """
        current = node
        while current is not None:
            t = current.type
            if t == "identifier":
                return (
                    self._node_text(current, self._source)
                    in _JS_BUILTINS
                )
            if t == "member_expression":
                obj = current.child_by_field_name("object")
                if obj is None:
                    return False
                current = obj
                continue
            # subscript_expression, call_expression, parenthesized —
            # no static root. Let the downstream ``_callee_name``
            # decide what to do.
            return False
        return False

    def _callee_name(
        self,
        node: "tree_sitter.Node",
    ) -> str | None:
        """Resolve a callable expression to a simple name.

        - Identifier                 → its text
        - member_expression          → the property name
                                        (final component of a
                                        dotted chain)
        - subscript_expression       → None (dynamic key)
        - call_expression            → None (chained call
                                        result; the inner call
                                        will be visited
                                        separately)

        Optional chaining (``obj?.foo``) uses the same
        ``member_expression`` shape as plain ``obj.foo`` in
        tree-sitter-javascript — the ``?.`` is an anonymous
        token and doesn't change the field structure. No
        special handling needed.
        """
        t = node.type
        if t == "identifier":
            return self._node_text(node, self._source)
        if t == "member_expression":
            prop = node.child_by_field_name("property")
            if prop is None:
                return None
            # property_identifier for public members,
            # private_property_identifier for #private.
            if prop.type in (
                "property_identifier",
                "private_property_identifier",
            ):
                return self._node_text(prop, self._source)
        return None