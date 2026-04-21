"""Python symbol extractor.

Walks a tree-sitter Python AST and produces a
:class:`~ac_dc.symbol_index.models.FileSymbols`. Handles:

- Classes with inheritance (bases from the superclass list)
- Functions (sync and async) and methods (functions inside a class)
- Properties (methods decorated with ``@property``)
- Instance variables (``self.x = ...`` in ``__init__`` bodies)
- Imports — absolute, from-import, relative (with level), aliases
- Top-level variable assignments (private underscore-prefixed excluded)
- Call sites inside function/method bodies
- Parameters with optional type annotations and defaults

Design notes kept in the class docstring. See
``specs4/2-indexing/symbol-index.md#per-language-extractors`` and
``IMPLEMENTATION_NOTES.md`` section 2.2.2 for the scope and the
decisions that trimmed it (no decorator preservation beyond
``@property``, ``is_conditional`` left False on call sites,
import resolution deferred to the resolver).
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


# Python identifiers always excluded from call-site extraction —
# they're language-level names, not user-code references. Keeping
# this set small and language-specific (not the exhaustive
# specs3 list) — the resolver can filter further if false
# positives creep into the reference graph.
_PY_BUILTINS = frozenset({
    "True", "False", "None",
    "self", "cls", "super",
    "print", "len", "range", "str", "int", "float", "bool",
    "list", "dict", "tuple", "set", "frozenset",
    "isinstance", "issubclass", "type", "id", "hash",
    "getattr", "setattr", "hasattr", "delattr",
    "iter", "next", "enumerate", "zip", "map", "filter",
    "open", "input", "repr", "format",
    "min", "max", "sum", "abs", "round", "any", "all",
    "sorted", "reversed",
    "Exception", "ValueError", "TypeError", "KeyError",
    "IndexError", "AttributeError", "RuntimeError",
    "__name__", "__file__", "__doc__",
})


class PythonExtractor(BaseExtractor):
    """Extract symbols from a tree-sitter Python parse tree.

    Stateless across calls — construct once, call :meth:`extract`
    as many times as needed. The orchestrator caches extractor
    instances so there's no per-file allocation cost.

    Not thread-safe for concurrent extraction of different files
    on the same instance — uses internal state (``_source``,
    ``_path``) during a single extract call. The orchestrator
    drives extraction from a single executor so this isn't a
    concern in practice.
    """

    language = "python"

    def extract(
        self,
        tree: "tree_sitter.Tree | None",
        source: bytes,
        path: str,
    ) -> FileSymbols:
        if tree is None:
            # Shouldn't happen for a non-tree-optional extractor,
            # but surface it cleanly rather than crashing on
            # attribute access. Empty result is fine — the
            # orchestrator's contract is "extractor returns what
            # it can; errors propagate elsewhere".
            return FileSymbols(file_path=path)

        self._source = source
        self._path = path

        result = FileSymbols(file_path=path)
        # Module is the root for Python; walk its direct
        # children to pick up top-level constructs. Nested
        # definitions (a function inside a function) attach
        # to their parent, not the module.
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
        """Route a direct child of the module to the right handler.

        Only direct module children become top-level symbols.
        Nested definitions (a function inside a function at the
        module level) attach to their parent, not the module.

        Unknown node types are silently ignored — tree-sitter
        produces many anonymous punctuation nodes and language
        constructs we don't model (for/while/if at module level,
        for example, which could happen in scripts). Silently
        skipping them is correct; they don't contribute symbols.
        """
        if node.type == "import_statement":
            imports = self._extract_import_statement(node)
            result.imports.extend(imports)
        elif node.type == "import_from_statement":
            imports = self._extract_from_import(node)
            result.imports.extend(imports)
        elif node.type == "function_definition":
            func = self._extract_function(node, is_method=False)
            if func is not None:
                result.symbols.append(func)
        elif node.type == "decorated_definition":
            # decorated_definition wraps a function or class; the
            # inner definition carries the real semantics. We
            # extract the inner node and apply decorator info
            # (e.g. @property marks methods; irrelevant at
            # module level but handled uniformly).
            inner = self._extract_decorated(node, is_method=False)
            if inner is not None:
                result.symbols.append(inner)
        elif node.type == "class_definition":
            cls = self._extract_class(node)
            if cls is not None:
                result.symbols.append(cls)
        elif node.type == "expression_statement":
            # Top-level assignments become variables. Only
            # ``name = expr`` and ``name: Type = expr`` forms
            # are treated as variables — tuple unpacking and
            # augmented assignments are skipped (less common,
            # and the formatter doesn't render them distinctly
            # enough to be worth the extraction complexity).
            var = self._extract_top_level_variable(node)
            if var is not None:
                result.symbols.append(var)

    # ------------------------------------------------------------------
    # Imports
    # ------------------------------------------------------------------

    def _extract_import_statement(
        self,
        node: "tree_sitter.Node",
    ) -> list[Import]:
        """Extract ``import foo`` / ``import foo as bar`` statements.

        Tree-sitter's ``import_statement`` may contain multiple
        comma-separated items — ``import os, sys`` produces two
        ``dotted_name`` children under one statement node. Each
        item becomes its own Import record. ``import foo as bar``
        wraps the name in an ``aliased_import`` with fields
        ``name`` and ``alias``.

        These are always absolute imports (``level=0``); relative
        imports only appear via the ``from .x import y`` form.
        """
        line = self._start_line(node) + 1  # 1-indexed per model
        imports: list[Import] = []
        for child in node.named_children:
            if child.type == "dotted_name":
                module = self._node_text(child, self._source)
                imports.append(Import(module=module, line=line))
            elif child.type == "aliased_import":
                name_node = child.child_by_field_name("name")
                alias_node = child.child_by_field_name("alias")
                if name_node is None:
                    continue
                module = self._node_text(name_node, self._source)
                alias = (
                    self._node_text(alias_node, self._source)
                    if alias_node is not None
                    else None
                )
                imports.append(
                    Import(module=module, alias=alias, line=line)
                )
        return imports

    def _extract_from_import(
        self,
        node: "tree_sitter.Node",
    ) -> list[Import]:
        """Extract ``from X import Y`` statements.

        Grammar shape:

        - ``from foo import x, y``           — level 0, module ``foo``
        - ``from .foo import x``             — level 1, module ``foo``
        - ``from .. import x``               — level 2, module ``""``
        - ``from foo import *``              — level 0, names=``["*"]``
        - ``from foo import x as y``         — alias recorded per-name

        tree-sitter-python represents the leading dots as
        ``relative_import`` / ``import_prefix`` children. We count
        them for the ``level`` field. A single Import record
        aggregates all the imported names from one statement —
        downstream consumers can iterate ``.names``. Per-name
        aliases aren't separately preserved (specs3 didn't, and
        the resolver only needs the original names).
        """
        line = self._start_line(node) + 1

        module_name_node = node.child_by_field_name("module_name")
        level = 0
        module = ""

        if module_name_node is not None:
            if module_name_node.type == "relative_import":
                # relative_import contains an import_prefix (dots)
                # and optionally a dotted_name for the module.
                level, module = self._parse_relative_import(
                    module_name_node
                )
            else:
                # Plain dotted_name — absolute import.
                module = self._node_text(
                    module_name_node, self._source
                )

        names: list[str] = []
        alias: str | None = None

        # The imported names sit under the ``name`` field. There
        # may be multiple (``from x import a, b``) so we iterate.
        for name_node in self._children_by_field(node, "name"):
            if name_node.type == "dotted_name":
                names.append(
                    self._node_text(name_node, self._source)
                )
            elif name_node.type == "aliased_import":
                inner_name = name_node.child_by_field_name("name")
                inner_alias = name_node.child_by_field_name("alias")
                if inner_name is not None:
                    names.append(
                        self._node_text(inner_name, self._source)
                    )
                # Record the FIRST alias encountered on the
                # statement. Multi-name from-imports with
                # per-item aliases are rare and the resolver
                # only needs one signal that aliasing happened.
                if inner_alias is not None and alias is None:
                    alias = self._node_text(
                        inner_alias, self._source
                    )
            elif name_node.type == "wildcard_import":
                names.append("*")

        # Wildcard imports — ``from X import *`` — are NOT
        # assigned to the ``name`` field in tree-sitter-python's
        # grammar. They appear as a direct unfielded child of
        # the import_from_statement. Scan direct children for
        # the wildcard node separately.
        if not names:
            for child in node.children:
                if child.type == "wildcard_import":
                    names.append("*")
                    break

        return [
            Import(
                module=module,
                names=names,
                alias=alias,
                level=level,
                line=line,
            )
        ]

    @staticmethod
    def _parse_relative_import(
        node: "tree_sitter.Node",
    ) -> tuple[int, str]:
        """Return ``(level, module)`` for a relative_import node.

        The ``import_prefix`` child contains one or more dots;
        its byte length is the level (``.`` = 1, ``..`` = 2).
        A trailing ``dotted_name`` child supplies the module
        name; when absent (``from .. import x``) module is "".
        """
        level = 0
        module = ""
        for child in node.children:
            if child.type == "import_prefix":
                # import_prefix's source text is just the dots.
                level = child.end_byte - child.start_byte
            elif child.type == "dotted_name":
                # _node_text needs self._source but this is a
                # static helper. tree-sitter's Node.text gives
                # us the bytes directly — dotted_name bodies
                # are plain ASCII identifiers so the decode is
                # always clean.
                text = getattr(child, "text", None)
                if text is not None:
                    module = text.decode("utf-8", errors="replace")
        return level, module

    @staticmethod
    def _children_by_field(
        node: "tree_sitter.Node",
        field: str,
    ) -> list["tree_sitter.Node"]:
        """Return all direct children assigned to ``field``.

        Tree-sitter's ``child_by_field_name`` returns only the
        first match. Some grammars assign the same field name to
        multiple children — ``import_from_statement``'s ``name``
        field is one such case. We walk the cursor to collect
        them all.
        """
        result: list["tree_sitter.Node"] = []
        cursor = node.walk()
        if not cursor.goto_first_child():
            return result
        while True:
            if cursor.field_name == field:
                result.append(cursor.node)
            if not cursor.goto_next_sibling():
                break
        return result

    # ------------------------------------------------------------------
    # Functions and methods
    # ------------------------------------------------------------------

    def _extract_function(
        self,
        node: "tree_sitter.Node",
        *,
        is_method: bool,
        decorators: list[str] | None = None,
    ) -> Symbol | None:
        """Build a Symbol for a ``function_definition`` node.

        ``is_method`` distinguishes a function inside a class
        body from a free function — methods get their first
        parameter (``self`` / ``cls``) stripped from the output.
        ``decorators`` carries names from a wrapping
        ``decorated_definition``; an empty/None value means an
        undecorated function.

        ``@property`` on a method upgrades its kind from
        ``"method"`` to ``"property"``. Other decorators are
        noted but don't change the kind — ``@staticmethod`` and
        ``@classmethod`` methods still read as methods in the
        symbol map.
        """
        name_node = node.child_by_field_name("name")
        if name_node is None:
            return None
        name = self._node_text(name_node, self._source)

        # Async detection — the grammar emits an anonymous
        # ``async`` token before ``def`` for async functions.
        # Tree-sitter marks it as a non-named child. Checking
        # the first byte of the node's source is the simplest
        # reliable probe and avoids iterating non-named children
        # (which varies slightly across grammar versions).
        prefix = self._source[node.start_byte:node.start_byte + 5]
        is_async = prefix.startswith(b"async")

        kind = "method" if is_method else "function"
        if decorators and "property" in decorators:
            # @property turns a method into a readable attribute
            # for the symbol map's purposes.
            kind = "property"

        sym = Symbol(
            name=name,
            kind=kind,
            file_path=self._path,
            range=self._range(node),
            is_async=is_async,
        )

        # Parameters — strip self/cls for methods. Return type
        # from the optional ``return_type`` field.
        params_node = node.child_by_field_name("parameters")
        if params_node is not None:
            sym.parameters = self._extract_parameters(
                params_node, strip_first=is_method
            )

        return_type_node = node.child_by_field_name("return_type")
        if return_type_node is not None:
            sym.return_type = self._node_text(
                return_type_node, self._source
            )

        # Call sites from the function body.
        body = node.child_by_field_name("body")
        if body is not None:
            sym.call_sites = self._extract_call_sites(body)

        return sym

    # ------------------------------------------------------------------
    # Parameters
    # ------------------------------------------------------------------

    def _extract_parameters(
        self,
        params_node: "tree_sitter.Node",
        *,
        strip_first: bool,
    ) -> list[Parameter]:
        """Extract parameters from a ``parameters`` node.

        tree-sitter-python emits one child node per parameter,
        with the shape depending on what the source provided:

        - ``identifier``                   — plain positional
        - ``typed_parameter``              — ``x: int``
        - ``default_parameter``            — ``x=1``
        - ``typed_default_parameter``      — ``x: int = 1``
        - ``list_splat_pattern``           — ``*args``
        - ``dictionary_splat_pattern``     — ``**kwargs``
        - ``keyword_separator`` / ``*``    — bare ``*`` marker
                                              for keyword-only
                                              boundary

        ``strip_first`` drops the first parameter — used for
        methods to hide ``self`` / ``cls`` from the output.
        Bare ``*`` separators don't count for stripping
        purposes; we only strip a real named parameter.
        """
        params: list[Parameter] = []
        first_real_skipped = not strip_first
        for child in params_node.named_children:
            param = self._build_parameter(child)
            if param is None:
                continue
            if not first_real_skipped:
                # First real parameter is self/cls for a method;
                # drop it from the output and remember we've
                # done so.
                first_real_skipped = True
                continue
            params.append(param)
        return params

    def _build_parameter(
        self,
        node: "tree_sitter.Node",
    ) -> Parameter | None:
        """Build one :class:`Parameter` from a parameter node.

        Returns None for nodes that aren't actual parameters
        (keyword separators, anonymous punctuation slipping
        through). Each real shape is handled by its own branch.
        """
        t = node.type
        if t == "identifier":
            return Parameter(name=self._node_text(node, self._source))
        if t == "typed_parameter":
            # Children are: identifier, type. The ``type`` field
            # on the type child gives us the annotation text.
            name = ""
            type_ann = None
            for child in node.named_children:
                if child.type == "identifier" and not name:
                    name = self._node_text(child, self._source)
                elif child.type == "type":
                    type_ann = self._node_text(child, self._source)
            if not name:
                return None
            return Parameter(name=name, type_annotation=type_ann)
        if t == "default_parameter":
            name_node = node.child_by_field_name("name")
            value_node = node.child_by_field_name("value")
            if name_node is None:
                return None
            return Parameter(
                name=self._node_text(name_node, self._source),
                default=(
                    self._node_text(value_node, self._source)
                    if value_node is not None
                    else None
                ),
            )
        if t == "typed_default_parameter":
            name_node = node.child_by_field_name("name")
            type_node = node.child_by_field_name("type")
            value_node = node.child_by_field_name("value")
            if name_node is None:
                return None
            return Parameter(
                name=self._node_text(name_node, self._source),
                type_annotation=(
                    self._node_text(type_node, self._source)
                    if type_node is not None
                    else None
                ),
                default=(
                    self._node_text(value_node, self._source)
                    if value_node is not None
                    else None
                ),
            )
        if t == "list_splat_pattern":
            # *args — the identifier child holds the name.
            name_node = self._find_child(node, "identifier")
            if name_node is None:
                return None
            return Parameter(
                name=self._node_text(name_node, self._source),
                is_vararg=True,
            )
        if t == "dictionary_splat_pattern":
            # **kwargs — same shape as list_splat_pattern.
            name_node = self._find_child(node, "identifier")
            if name_node is None:
                return None
            return Parameter(
                name=self._node_text(name_node, self._source),
                is_kwarg=True,
            )
        # keyword_separator and any unknown shapes don't
        # produce a parameter.
        return None

    # ------------------------------------------------------------------
    # Call sites
    # ------------------------------------------------------------------

    def _extract_call_sites(
        self,
        body: "tree_sitter.Node",
    ) -> list[CallSite]:
        """Collect call sites inside a function/method body.

        Walks every descendant ``call`` node. The callee name is
        taken from the call's ``function`` field:

        - ``foo()``       — identifier ``foo``
        - ``obj.foo()``   — attribute; we record the attribute
                             name (``foo``), not the receiver
        - ``a.b.c()``     — nested attribute; we record the
                             final component (``c``)
        - ``(expr)()``    — complex callee; skipped (no
                             extractable name)

        Built-in names (``print``, ``len``, etc.) are filtered
        out via :data:`_PY_BUILTINS` — they're language-level
        noise, not cross-file references. The resolver applies
        further filtering later; this is just the cheap first
        pass.
        """
        sites: list[CallSite] = []

        def _visit(node: "tree_sitter.Node") -> None:
            if node.type != "call":
                return
            fn = node.child_by_field_name("function")
            if fn is None:
                return
            name = self._callee_name(fn)
            if not name:
                return
            if name in _PY_BUILTINS:
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

        Returns the identifier for ``foo()``, the attribute
        tail for ``a.b.c()``, or None for anything we can't
        reduce (subscripts, call results, lambdas).
        """
        if node.type == "identifier":
            return self._node_text(node, self._source)
        if node.type == "attribute":
            # The ``attribute`` field holds the final component.
            # For ``a.b.c`` the structure is
            # ``(attribute (attribute a b) c)`` so this gives ``c``.
            attr_node = node.child_by_field_name("attribute")
            if attr_node is not None:
                return self._node_text(attr_node, self._source)
        return None

    # ------------------------------------------------------------------
    # Classes
    # ------------------------------------------------------------------

    def _extract_class(
        self,
        node: "tree_sitter.Node",
        decorators: list[str] | None = None,
    ) -> Symbol | None:
        """Build a Symbol for a ``class_definition`` node.

        - Name from the ``name`` field
        - Bases from the ``superclasses`` field (an argument_list)
        - Methods and nested classes from the body
        - Instance vars collected from ``self.x = ...`` inside
          ``__init__`` method bodies

        ``decorators`` is accepted for signature symmetry with
        :meth:`_extract_function`. Python class decorators aren't
        currently surfaced on the Symbol (nothing downstream
        consumes them) but keeping the parameter means the
        decorated-definition dispatcher can pass it uniformly.
        """
        # Silence the unused-argument check until class
        # decorators gain a consumer.
        _ = decorators

        name_node = node.child_by_field_name("name")
        if name_node is None:
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
        """Return base class names from the ``superclasses`` field.

        The superclasses field is an ``argument_list`` — its
        named children are the comma-separated base expressions.
        We emit the source text of each; Python allows arbitrary
        expressions here (``Generic[T]``, ``metaclass=Meta``
        keyword) so preserving the text form is honest.

        Keyword arguments (``metaclass=Meta``, ``total=False``)
        are skipped — they're class-creation options, not base
        classes, and the symbol map would render them misleadingly
        as bases.
        """
        supers = class_node.child_by_field_name("superclasses")
        if supers is None:
            return []
        bases: list[str] = []
        for child in supers.named_children:
            if child.type == "keyword_argument":
                continue
            bases.append(self._node_text(child, self._source))
        return bases

    def _populate_class_body(
        self,
        class_sym: Symbol,
        body: "tree_sitter.Node",
    ) -> None:
        """Walk a class body, attaching methods, nested classes,
        and instance variables to ``class_sym``.

        Tree-sitter's class body is a ``block`` node whose
        children are the statement-level constructs — method
        definitions (possibly decorated), nested classes, class
        variable assignments, string docstrings, ``pass``
        statements. We handle the ones that contribute symbols
        and silently skip the rest.

        Instance-variable collection peeks inside methods named
        ``__init__`` — if the LLM later renames an init method
        to something else, we lose the instance-var annotation.
        Matches specs3 behaviour; if it becomes a problem we can
        widen the heuristic later.
        """
        for child in body.children:
            if child.type == "function_definition":
                method = self._extract_function(child, is_method=True)
                if method is not None:
                    class_sym.children.append(method)
                    if method.name == "__init__":
                        class_sym.instance_vars = (
                            self._extract_instance_vars(child)
                        )
            elif child.type == "decorated_definition":
                method = self._extract_decorated(child, is_method=True)
                if method is not None:
                    class_sym.children.append(method)
                    # A decorated __init__ still contributes
                    # instance vars. The inner function_definition
                    # lives under the decorated_definition node.
                    if method.name == "__init__":
                        inner = self._find_child(
                            child, "function_definition"
                        )
                        if inner is not None:
                            class_sym.instance_vars = (
                                self._extract_instance_vars(inner)
                            )
            elif child.type == "class_definition":
                nested = self._extract_class(child)
                if nested is not None:
                    class_sym.children.append(nested)

    def _extract_instance_vars(
        self,
        init_node: "tree_sitter.Node",
    ) -> list[str]:
        """Scan an ``__init__`` body for ``self.x = ...`` assignments.

        Tree-sitter represents the left side of ``self.x = ...``
        as an ``attribute`` node whose object is the identifier
        ``self`` and whose attribute is the bare name. We walk
        descendants looking for ``assignment`` nodes with that
        shape on the left.

        Also handles typed annotations (``self.x: int = ...``)
        which parse as ``typed_default_parameter``-shaped
        children under ``assignment`` — the grammar surfaces
        them as the same ``assignment`` node type but with a
        ``type`` field alongside the usual ``left`` and ``right``.
        Either way, the left side is still an ``attribute``.

        Names are deduped, preserving first-seen order —
        ``self.x = 1`` followed later by ``self.x = 2`` in the
        same init body records ``x`` once.
        """
        seen: set[str] = set()
        order: list[str] = []
        body = init_node.child_by_field_name("body")
        if body is None:
            return []

        def _visit(node: "tree_sitter.Node") -> None:
            if node.type != "assignment":
                return
            left = node.child_by_field_name("left")
            if left is None or left.type != "attribute":
                return
            obj = left.child_by_field_name("object")
            attr = left.child_by_field_name("attribute")
            if obj is None or attr is None:
                return
            if obj.type != "identifier":
                return
            if self._node_text(obj, self._source) != "self":
                return
            name = self._node_text(attr, self._source)
            if name not in seen:
                seen.add(name)
                order.append(name)

        self._walk_named(body, _visit)
        return order

    # ------------------------------------------------------------------
    # Decorated definitions
    # ------------------------------------------------------------------

    def _extract_decorated(
        self,
        node: "tree_sitter.Node",
        *,
        is_method: bool,
    ) -> Symbol | None:
        """Handle ``decorated_definition`` — decorator(s) + def/class.

        Children are one or more ``decorator`` nodes followed by
        the wrapped ``function_definition`` or ``class_definition``.
        We collect decorator names (last component only — for
        ``@my.decorators.foo`` we record ``"foo"``) and pass them
        to the appropriate extractor.

        Only bare decorator names are interesting to the symbol
        map today. Arguments to decorators (``@cache(maxsize=10)``)
        are stripped — we keep ``"cache"`` and discard the call.
        """
        decorators: list[str] = []
        inner: "tree_sitter.Node | None" = None

        for child in node.children:
            if child.type == "decorator":
                name = self._decorator_name(child)
                if name is not None:
                    decorators.append(name)
            elif child.type == "function_definition":
                inner = child
            elif child.type == "class_definition":
                inner = child

        if inner is None:
            return None
        if inner.type == "function_definition":
            return self._extract_function(
                inner, is_method=is_method, decorators=decorators
            )
        if inner.type == "class_definition":
            return self._extract_class(inner, decorators=decorators)
        return None

    def _decorator_name(
        self,
        node: "tree_sitter.Node",
    ) -> str | None:
        """Return the short name of a decorator.

        - ``@foo``                 → ``"foo"``
        - ``@foo.bar``             → ``"bar"``
        - ``@foo(args)``           → ``"foo"``
        - ``@foo.bar.baz(args)``   → ``"baz"``

        Tree-sitter wraps the decorator expression as the
        decorator node's only named child. We peel calls to
        reach the underlying identifier or attribute, then
        take the final component of a dotted name.
        """
        expr: "tree_sitter.Node | None" = None
        for child in node.named_children:
            expr = child
            break
        if expr is None:
            return None

        # Unwrap ``call`` to its callee. ``@cache(maxsize=10)``
        # appears as a ``call`` whose ``function`` field holds
        # the decorator's name expression.
        if expr.type == "call":
            fn = expr.child_by_field_name("function")
            if fn is None:
                return None
            expr = fn

        if expr.type == "identifier":
            return self._node_text(expr, self._source)
        if expr.type == "attribute":
            attr_node = expr.child_by_field_name("attribute")
            if attr_node is not None:
                return self._node_text(attr_node, self._source)
        return None

    # ------------------------------------------------------------------
    # Top-level variables
    # ------------------------------------------------------------------

    def _extract_top_level_variable(
        self,
        node: "tree_sitter.Node",
    ) -> Symbol | None:
        """Extract a top-level variable from an ``expression_statement``.

        Handles:

        - ``NAME = expr``              (assignment, plain identifier)
        - ``NAME: Type = expr``        (assignment with type)
        - ``NAME: Type``               (annotation without value)

        Filters:

        - Private names (single leading underscore) — these are
          module-internal by convention. Dunder names are kept
          because ``__all__``, ``__version__``, etc. are public
          API.
        - Non-identifier LHS — tuple unpacking
          (``a, b = 1, 2``), subscript assignment (``d[k] = v``),
          attribute assignment (``obj.attr = x``). None of these
          contribute a module-level symbol in the conventional
          sense.
        - Augmented assignments (``x += 1``) — don't define;
          tree-sitter emits these as ``augmented_assignment``
          rather than ``assignment`` so they're naturally skipped.
        """
        # The statement wraps an ``assignment`` as its only
        # real child — anonymous punctuation aside.
        assign: "tree_sitter.Node | None" = None
        for child in node.named_children:
            if child.type == "assignment":
                assign = child
                break
        if assign is None:
            return None

        left = assign.child_by_field_name("left")
        if left is None or left.type != "identifier":
            return None

        name = self._node_text(left, self._source)

        # Private convention: skip names starting with `_` unless
        # they're dunders (``__name__``). Underscore-prefixed
        # non-dunder names (``_internal``) are module-internal
        # and would clutter the symbol map with implementation
        # detail.
        if name.startswith("_") and not (
            name.startswith("__") and name.endswith("__")
        ):
            return None

        return Symbol(
            name=name,
            kind="variable",
            file_path=self._path,
            range=self._range(assign),
        )