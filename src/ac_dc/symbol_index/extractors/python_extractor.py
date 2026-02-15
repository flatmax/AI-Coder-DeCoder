"""Python-specific symbol extractor."""

from .base import BaseExtractor, CallSite, FileSymbols, Import, Parameter, Symbol


class PythonExtractor(BaseExtractor):
    """Extract symbols from Python source files."""

    def extract(self, tree, source_code, file_path):
        root = tree.root_node
        symbols = []
        imports = []

        for node in root.children:
            if node.type in ("import_statement", "import_from_statement"):
                imp = self._extract_import(node, source_code)
                if imp:
                    imports.append(imp)
            elif node.type == "class_definition":
                sym = self._extract_class(node, source_code, file_path)
                if sym:
                    symbols.append(sym)
            elif node.type in ("function_definition", "decorated_definition"):
                sym = self._extract_function(node, source_code, file_path, is_method=False)
                if sym:
                    symbols.append(sym)
            elif node.type == "expression_statement":
                sym = self._extract_variable(node, source_code, file_path)
                if sym:
                    symbols.append(sym)

        return FileSymbols(file_path=file_path, symbols=symbols, imports=imports)

    def _extract_import(self, node, source):
        """Extract import statement."""
        text = self._node_text(node, source)

        if node.type == "import_statement":
            # import foo, bar
            names = []
            for child in node.children:
                if child.type == "dotted_name":
                    names.append(self._node_text(child, source))
                elif child.type == "aliased_import":
                    name_node = self._find_child(child, "dotted_name")
                    if name_node:
                        names.append(self._node_text(name_node, source))
            if names:
                return Import(module=names[0], names=names)

        elif node.type == "import_from_statement":
            # from foo import bar, baz
            module = ""
            names = []
            level = 0
            alias = None

            for child in node.children:
                if child.type == "relative_import":
                    # Count dots
                    for c in child.children:
                        if c.type == "import_prefix":
                            level = self._node_text(c, source).count(".")
                        elif c.type == "dotted_name":
                            module = self._node_text(c, source)
                elif child.type == "dotted_name":
                    if not module:
                        module = self._node_text(child, source)
                    else:
                        names.append(self._node_text(child, source))
                elif child.type == "import_prefix":
                    level = self._node_text(child, source).count(".")
                elif child.type in ("import_list", ):
                    for item in child.children:
                        if item.type == "dotted_name":
                            names.append(self._node_text(item, source))
                        elif item.type == "aliased_import":
                            name_node = self._find_child(item, "dotted_name") or self._find_child(item, "identifier")
                            if name_node:
                                names.append(self._node_text(name_node, source))

            # Also check for direct identifier imports
            for child in node.children:
                if child.type == "identifier" and child != node.children[0]:
                    name = self._node_text(child, source)
                    if name not in ("from", "import") and name not in names:
                        names.append(name)

            return Import(module=module, names=names, level=level, alias=alias)

        return None

    def _extract_class(self, node, source, file_path):
        """Extract class definition."""
        name_node = self._find_child(node, "identifier")
        if not name_node:
            return None

        name = self._node_text(name_node, source)
        bases = []

        # Extract base classes
        arg_list = self._find_child(node, "argument_list")
        if arg_list:
            for child in arg_list.children:
                if child.type in ("identifier", "attribute"):
                    bases.append(self._node_text(child, source))

        sym = Symbol(
            name=name,
            kind="class",
            file_path=file_path,
            start_line=node.start_point[0] + 1,
            start_col=node.start_point[1],
            end_line=node.end_point[0] + 1,
            end_col=node.end_point[1],
            bases=bases,
        )

        # Extract methods and class body
        body = self._find_child(node, "block")
        if body:
            for child in body.children:
                if child.type in ("function_definition", "decorated_definition"):
                    method = self._extract_function(child, source, file_path, is_method=True)
                    if method:
                        sym.children.append(method)
                        # Extract instance variables from __init__
                        if method.name == "__init__":
                            sym.instance_vars = self._extract_instance_vars(child, source)

        return sym

    def _extract_function(self, node, source, file_path, is_method=False):
        """Extract function/method definition."""
        # Handle decorated definitions
        actual_node = node
        is_property = False
        if node.type == "decorated_definition":
            for child in node.children:
                if child.type == "decorator":
                    dec_text = self._node_text(child, source)
                    if "@property" in dec_text:
                        is_property = True
                elif child.type == "function_definition":
                    actual_node = child

        name_node = self._find_child(actual_node, "identifier")
        if not name_node:
            return None

        name = self._node_text(name_node, source)

        # Skip private helper methods in top-level extraction
        # (but include them as class children)

        # Check async
        is_async = False
        text = self._node_text(actual_node, source)
        if text.startswith("async ") or actual_node.type == "async_function_definition":
            is_async = True
        # Also check parent for async keyword
        if actual_node.prev_sibling and self._node_text(actual_node.prev_sibling, source) == "async":
            is_async = True

        # Extract parameters
        params = self._extract_parameters(actual_node, source, is_method)

        # Extract return type
        return_type = None
        ret_node = self._find_child(actual_node, "type")
        if ret_node:
            return_type = self._node_text(ret_node, source)

        kind = "property" if is_property else ("method" if is_method else "function")
        if is_async and kind == "method":
            kind = "method"  # Keep as method, mark async flag
        elif is_async and kind == "function":
            kind = "function"

        sym = Symbol(
            name=name,
            kind=kind,
            file_path=file_path,
            start_line=actual_node.start_point[0] + 1,
            start_col=actual_node.start_point[1],
            end_line=actual_node.end_point[0] + 1,
            end_col=actual_node.end_point[1],
            parameters=params,
            return_type=return_type,
            is_async=is_async,
        )

        # Extract call sites from function body
        body = self._find_child(actual_node, "block")
        if body:
            sym.call_sites = self._extract_call_sites(body, source)

        return sym

    def _extract_parameters(self, func_node, source, is_method=False):
        """Extract function parameters."""
        params = []
        param_node = self._find_child(func_node, "parameters")
        if not param_node:
            return params

        skip_self = is_method
        for child in param_node.children:
            if child.type in ("(", ")", ","):
                continue

            if child.type == "identifier":
                name = self._node_text(child, source)
                if skip_self and name in ("self", "cls"):
                    skip_self = False
                    continue
                params.append(Parameter(name=name))

            elif child.type == "typed_parameter":
                name_n = self._find_child(child, "identifier")
                type_n = self._find_child(child, "type")
                if name_n:
                    name = self._node_text(name_n, source)
                    if skip_self and name in ("self", "cls"):
                        skip_self = False
                        continue
                    p = Parameter(name=name)
                    if type_n:
                        p.type_hint = self._node_text(type_n, source)
                    params.append(p)

            elif child.type == "default_parameter":
                name_n = child.children[0] if child.children else None
                if name_n:
                    name = self._node_text(name_n, source)
                    if skip_self and name in ("self", "cls"):
                        skip_self = False
                        continue
                    p = Parameter(name=name)
                    if len(child.children) >= 3:
                        p.default = self._node_text(child.children[2], source)
                    params.append(p)

            elif child.type == "typed_default_parameter":
                name_n = self._find_child(child, "identifier")
                type_n = self._find_child(child, "type")
                if name_n:
                    name = self._node_text(name_n, source)
                    p = Parameter(name=name)
                    if type_n:
                        p.type_hint = self._node_text(type_n, source)
                    # Find default value
                    for i, c in enumerate(child.children):
                        if self._node_text(c, source) == "=":
                            if i + 1 < len(child.children):
                                p.default = self._node_text(child.children[i + 1], source)
                    params.append(p)

            elif child.type == "list_splat_pattern":
                name_n = self._find_child(child, "identifier")
                if name_n:
                    params.append(Parameter(
                        name=self._node_text(name_n, source),
                        is_args=True,
                    ))

            elif child.type == "dictionary_splat_pattern":
                name_n = self._find_child(child, "identifier")
                if name_n:
                    params.append(Parameter(
                        name=self._node_text(name_n, source),
                        is_kwargs=True,
                    ))

        return params

    def _extract_instance_vars(self, init_node, source):
        """Extract self.x = ... from __init__."""
        vars_found = []
        actual = init_node
        if init_node.type == "decorated_definition":
            actual = self._find_child(init_node, "function_definition") or init_node

        body = self._find_child(actual, "block")
        if not body:
            return vars_found

        for child in body.children:
            if child.type == "expression_statement":
                expr = child.children[0] if child.children else None
                if expr and expr.type == "assignment":
                    left = expr.children[0] if expr.children else None
                    if left and left.type == "attribute":
                        obj = left.children[0] if left.children else None
                        attr = left.children[-1] if left.children else None
                        if obj and self._node_text(obj, source) == "self" and attr:
                            var_name = self._node_text(attr, source)
                            if var_name not in vars_found:
                                vars_found.append(var_name)
        return vars_found

    def _extract_variable(self, node, source, file_path):
        """Extract top-level variable assignment."""
        if not node.children:
            return None
        expr = node.children[0]
        if expr.type != "assignment":
            return None

        left = expr.children[0] if expr.children else None
        if not left or left.type != "identifier":
            return None

        name = self._node_text(left, source)
        # Skip private variables
        if name.startswith("_"):
            return None

        return Symbol(
            name=name,
            kind="variable",
            file_path=file_path,
            start_line=node.start_point[0] + 1,
            start_col=node.start_point[1],
            end_line=node.end_point[0] + 1,
            end_col=node.end_point[1],
        )
