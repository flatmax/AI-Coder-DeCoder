"""Python symbol extractor using tree-sitter."""

from typing import Optional

from ac_dc.symbol_index.models import (
    CallSite, FileSymbols, Import, Parameter, Symbol,
)
from ac_dc.symbol_index.extractors.base import BaseExtractor


class PythonExtractor(BaseExtractor):
    """Extract symbols from Python source files."""

    def extract(self, source: bytes, tree: Optional[object], file_path: str) -> FileSymbols:
        if tree is None:
            return FileSymbols(file_path=file_path)

        root = tree.root_node
        symbols = []
        imports = []

        for child in root.children:
            kind = child.type
            if kind == "class_definition":
                sym = self._extract_class(child, source, file_path)
                if sym:
                    symbols.append(sym)
            elif kind in ("function_definition", "decorated_definition"):
                func_node = child
                is_decorated = kind == "decorated_definition"
                if is_decorated:
                    # Find the actual function/class inside
                    for sub in child.children:
                        if sub.type in ("function_definition", "class_definition"):
                            func_node = sub
                            break
                if func_node.type == "class_definition":
                    sym = self._extract_class(func_node, source, file_path, child if is_decorated else None)
                    if sym:
                        symbols.append(sym)
                elif func_node.type == "function_definition":
                    sym = self._extract_function(func_node, source, file_path, child if is_decorated else None)
                    if sym:
                        symbols.append(sym)
            elif kind == "import_statement":
                imp = self._extract_import(child, source)
                if imp:
                    imports.append(imp)
            elif kind == "import_from_statement":
                imp = self._extract_from_import(child, source)
                if imp:
                    imports.append(imp)
            elif kind == "expression_statement":
                var = self._extract_variable(child, source, file_path)
                if var:
                    symbols.append(var)

        return FileSymbols(file_path=file_path, symbols=symbols, imports=imports)

    def _extract_class(self, node, source: bytes, file_path: str,
                       decorated_node=None) -> Optional[Symbol]:
        """Extract a class definition."""
        name_node = node.child_by_field_name("name")
        if not name_node:
            return None
        name = self._node_text(name_node, source)
        rng = self._node_range(decorated_node or node)

        # Bases
        bases = []
        superclasses = node.child_by_field_name("superclasses")
        if superclasses:
            for arg in superclasses.children:
                if arg.type == "identifier":
                    bases.append(self._node_text(arg, source))
                elif arg.type == "attribute":
                    bases.append(self._node_text(arg, source))

        sym = Symbol(
            name=name, kind="class", file_path=file_path,
            range=rng, bases=bases,
        )

        # Extract children (methods, variables) from the class body
        body = node.child_by_field_name("body")
        if body:
            self._extract_class_body(body, source, file_path, sym)

        return sym

    def _extract_class_body(self, body, source: bytes, file_path: str, class_sym: Symbol):
        """Extract methods and instance variables from a class body."""
        for child in body.children:
            if child.type in ("function_definition", "decorated_definition"):
                func_node = child
                is_decorated = child.type == "decorated_definition"
                is_property = False
                if is_decorated:
                    for sub in child.children:
                        if sub.type == "decorator":
                            dec_text = self._node_text(sub, source)
                            if "@property" in dec_text:
                                is_property = True
                        if sub.type == "function_definition":
                            func_node = sub
                            break

                method = self._extract_function(
                    func_node, source, file_path,
                    child if is_decorated else None,
                    is_method=True,
                )
                if method:
                    if is_property:
                        method.kind = "property"
                    class_sym.children.append(method)

                    # Extract instance vars from __init__
                    if method.name == "__init__":
                        self._extract_instance_vars(func_node, source, class_sym)

            elif child.type == "expression_statement":
                var = self._extract_variable(child, source, file_path)
                if var:
                    var.kind = "variable"
                    class_sym.children.append(var)

    def _extract_function(self, node, source: bytes, file_path: str,
                          decorated_node=None, is_method: bool = False) -> Optional[Symbol]:
        """Extract a function or method."""
        name_node = node.child_by_field_name("name")
        if not name_node:
            return None
        name = self._node_text(name_node, source)
        rng = self._node_range(decorated_node or node)

        # Check async
        is_async = False
        if decorated_node:
            for sub in decorated_node.children:
                if sub.type == "function_definition":
                    # Check the text before the function
                    text_before = source[decorated_node.start_byte:sub.start_byte].decode("utf-8")
                    if "async" in text_before:
                        is_async = True
        else:
            func_text = source[node.start_byte:node.start_byte + 20].decode("utf-8")
            if func_text.strip().startswith("async"):
                is_async = True

        # Parameters
        params = self._extract_parameters(node, source, is_method)

        # Return type
        return_type = None
        ret = node.child_by_field_name("return_type")
        if ret:
            return_type = self._node_text(ret, source)
            # Strip leading " -> " if present from the type text
            if return_type.startswith("-> "):
                return_type = return_type[3:]
            elif return_type.startswith("->"):
                return_type = return_type[2:]

        kind = "method" if is_method else "function"

        sym = Symbol(
            name=name, kind=kind, file_path=file_path,
            range=rng, parameters=params,
            return_type=return_type, is_async=is_async,
        )

        # Extract call sites from function body
        body = node.child_by_field_name("body")
        if body:
            sym.call_sites = self._extract_call_sites(body, source)

        return sym

    def _extract_parameters(self, func_node, source: bytes,
                            is_method: bool = False) -> list[Parameter]:
        """Extract function parameters."""
        params = []
        params_node = func_node.child_by_field_name("parameters")
        if not params_node:
            return params

        for child in params_node.children:
            if child.type in ("identifier",):
                name = self._node_text(child, source)
                if is_method and name in ("self", "cls") and not params:
                    continue  # Skip self/cls
                params.append(Parameter(name=name))
            elif child.type == "typed_parameter":
                name = ""
                type_hint = None
                for sub in child.children:
                    if sub.type == "identifier" and not name:
                        name = self._node_text(sub, source)
                    elif sub.type == "type":
                        type_hint = self._node_text(sub, source)
                if is_method and name in ("self", "cls") and not params:
                    continue
                params.append(Parameter(name=name, type_hint=type_hint))
            elif child.type == "default_parameter":
                name = ""
                default = None
                for sub in child.children:
                    if sub.type == "identifier" and not name:
                        name = self._node_text(sub, source)
                    elif sub.type not in ("=",):
                        if default is None:
                            default = self._node_text(sub, source)
                if is_method and name in ("self", "cls") and not params:
                    continue
                params.append(Parameter(name=name, default=default))
            elif child.type == "typed_default_parameter":
                name = ""
                type_hint = None
                default = None
                for sub in child.children:
                    if sub.type == "identifier" and not name:
                        name = self._node_text(sub, source)
                    elif sub.type == "type":
                        type_hint = self._node_text(sub, source)
                    elif sub.type not in ("=", ":", "identifier", "type"):
                        if default is None:
                            default = self._node_text(sub, source)
                if is_method and name in ("self", "cls") and not params:
                    continue
                params.append(Parameter(name=name, type_hint=type_hint, default=default))
            elif child.type == "list_splat_pattern":
                name = ""
                for sub in child.children:
                    if sub.type == "identifier":
                        name = self._node_text(sub, source)
                params.append(Parameter(name=name, is_variadic=True))
            elif child.type == "dictionary_splat_pattern":
                name = ""
                for sub in child.children:
                    if sub.type == "identifier":
                        name = self._node_text(sub, source)
                params.append(Parameter(name=name, is_keyword=True))

        return params

    def _extract_instance_vars(self, init_node, source: bytes, class_sym: Symbol):
        """Extract self.x = ... assignments from __init__."""
        body = init_node.child_by_field_name("body")
        if not body:
            return

        def _walk(node):
            if node.type == "assignment":
                left = node.child_by_field_name("left")
                if left and left.type == "attribute":
                    obj = left.child_by_field_name("object")
                    attr = left.child_by_field_name("attribute")
                    if obj and attr:
                        obj_text = self._node_text(obj, source)
                        if obj_text == "self":
                            var_name = self._node_text(attr, source)
                            if var_name not in class_sym.instance_vars:
                                class_sym.instance_vars.append(var_name)
            for child in node.children:
                _walk(child)

        _walk(body)

    def _extract_variable(self, expr_stmt, source: bytes, file_path: str) -> Optional[Symbol]:
        """Extract a top-level variable assignment."""
        for child in expr_stmt.children:
            if child.type == "assignment":
                left = child.child_by_field_name("left")
                if left and left.type == "identifier":
                    name = self._node_text(left, source)
                    if name.startswith("_"):
                        return None
                    return Symbol(
                        name=name, kind="variable", file_path=file_path,
                        range=self._node_range(child),
                    )
        return None

    def _extract_import(self, node, source: bytes) -> Optional[Import]:
        """Extract 'import x' statement."""
        names = []
        for child in node.children:
            if child.type == "dotted_name":
                names.append(self._node_text(child, source))
            elif child.type == "aliased_import":
                for sub in child.children:
                    if sub.type == "dotted_name":
                        names.append(self._node_text(sub, source))
                        break
        if names:
            return Import(
                module=names[0], names=names,
                line=node.start_point[0] + 1,
            )
        return None

    def _extract_from_import(self, node, source: bytes) -> Optional[Import]:
        """Extract 'from x import y' statement."""
        module = ""
        names = []
        level = 0
        alias = None

        for child in node.children:
            if child.type == "relative_import":
                # Count dots for level
                for sub in child.children:
                    if sub.type == "import_prefix":
                        level = self._node_text(sub, source).count(".")
                    elif sub.type == "dotted_name":
                        module = self._node_text(sub, source)
            elif child.type == "dotted_name":
                if not module:
                    module = self._node_text(child, source)
            elif child.type == "import_prefix":
                level = self._node_text(child, source).count(".")
            elif child.type == "wildcard_import":
                names.append("*")
            elif child.type in ("identifier",):
                names.append(self._node_text(child, source))
            elif child.type == "aliased_import":
                for sub in child.children:
                    if sub.type == "identifier":
                        names.append(self._node_text(sub, source))
                        break

        if module or names:
            return Import(
                module=module, names=names, level=level,
                line=node.start_point[0] + 1,
            )
        return None

    def _extract_call_sites(self, body, source: bytes) -> list[CallSite]:
        """Extract function/method calls from a body node."""
        calls = []
        seen = set()

        def _walk(node):
            if node.type == "call":
                func = node.child_by_field_name("function")
                if func:
                    name = ""
                    if func.type == "identifier":
                        name = self._node_text(func, source)
                    elif func.type == "attribute":
                        name = self._node_text(func, source)
                    if name and name not in seen:
                        seen.add(name)
                        calls.append(CallSite(
                            name=name,
                            line=func.start_point[0] + 1,
                        ))
            for child in node.children:
                _walk(child)

        _walk(body)
        return calls