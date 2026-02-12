"""JavaScript/TypeScript symbol extractor."""

from .base import BaseExtractor, CallSite, FileSymbols, Import, Parameter, Symbol


class JavaScriptExtractor(BaseExtractor):
    """Extract symbols from JavaScript/TypeScript source files."""

    def extract(self, tree, source_code, file_path):
        root = tree.root_node
        symbols = []
        imports = []

        for node in root.children:
            if node.type == "import_statement":
                imp = self._extract_import(node, source_code)
                if imp:
                    imports.append(imp)
            elif node.type == "export_statement":
                inner = self._extract_export(node, source_code, file_path)
                if isinstance(inner, list):
                    symbols.extend(inner)
                elif inner:
                    symbols.append(inner)
            elif node.type == "class_declaration":
                sym = self._extract_class(node, source_code, file_path)
                if sym:
                    symbols.append(sym)
            elif node.type in ("function_declaration", "generator_function_declaration"):
                sym = self._extract_function(node, source_code, file_path)
                if sym:
                    symbols.append(sym)
            elif node.type in ("lexical_declaration", "variable_declaration"):
                syms = self._extract_variable_decl(node, source_code, file_path)
                symbols.extend(syms)
            elif node.type == "expression_statement":
                sym = self._extract_expression_var(node, source_code, file_path)
                if sym:
                    symbols.append(sym)

        return FileSymbols(file_path=file_path, symbols=symbols, imports=imports)

    def _extract_import(self, node, source):
        """Extract import statement."""
        names = []
        module = ""

        for child in node.children:
            if child.type == "string":
                module = self._node_text(child, source).strip("'\"")
            elif child.type == "import_clause":
                for ic in child.children:
                    if ic.type == "identifier":
                        names.append(self._node_text(ic, source))
                    elif ic.type == "named_imports":
                        for ni in ic.children:
                            if ni.type == "import_specifier":
                                name_node = ni.children[0] if ni.children else None
                                if name_node:
                                    names.append(self._node_text(name_node, source))
                    elif ic.type == "namespace_import":
                        star_name = self._find_child(ic, "identifier")
                        if star_name:
                            names.append("* as " + self._node_text(star_name, source))

        if module:
            return Import(module=module, names=names)
        return None

    def _extract_export(self, node, source, file_path):
        """Extract exported declarations."""
        for child in node.children:
            if child.type == "class_declaration":
                return self._extract_class(child, source, file_path)
            elif child.type in ("function_declaration", "generator_function_declaration"):
                return self._extract_function(child, source, file_path)
            elif child.type in ("lexical_declaration", "variable_declaration"):
                return self._extract_variable_decl(child, source, file_path)
        return None

    def _extract_class(self, node, source, file_path):
        """Extract class declaration."""
        name_node = self._find_child(node, "identifier")
        if not name_node:
            return None

        name = self._node_text(name_node, source)
        bases = []

        # class_heritage / extends
        heritage = self._find_child(node, "class_heritage")
        if heritage:
            for child in heritage.children:
                if child.type in ("identifier", "member_expression"):
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

        body = self._find_child(node, "class_body")
        if body:
            for child in body.children:
                method = self._extract_method(child, source, file_path)
                if method:
                    sym.children.append(method)

        return sym

    def _extract_method(self, node, source, file_path):
        """Extract class method/getter/setter."""
        if node.type not in ("method_definition", "public_field_definition",
                             "field_definition"):
            return None

        if node.type in ("public_field_definition", "field_definition"):
            name_node = node.children[0] if node.children else None
            if name_node:
                return Symbol(
                    name=self._node_text(name_node, source),
                    kind="variable",
                    file_path=file_path,
                    start_line=node.start_point[0] + 1,
                    start_col=node.start_point[1],
                    end_line=node.end_point[0] + 1,
                    end_col=node.end_point[1],
                )
            return None

        name_node = self._find_child(node, "property_identifier")
        if not name_node:
            return None

        name = self._node_text(name_node, source)
        is_async = False
        kind = "method"

        # Check for async, get, set keywords
        for child in node.children:
            text = self._node_text(child, source)
            if text == "async":
                is_async = True
            elif text == "get":
                kind = "property"
            elif text == "set":
                kind = "property"

        params = self._extract_params(node, source)

        sym = Symbol(
            name=name,
            kind=kind,
            file_path=file_path,
            start_line=node.start_point[0] + 1,
            start_col=node.start_point[1],
            end_line=node.end_point[0] + 1,
            end_col=node.end_point[1],
            parameters=params,
            is_async=is_async,
        )

        body = self._find_child(node, "statement_block")
        if body:
            sym.call_sites = self._extract_call_sites(body, source)

        return sym

    def _extract_function(self, node, source, file_path):
        """Extract function declaration."""
        name_node = self._find_child(node, "identifier")
        if not name_node:
            return None

        name = self._node_text(name_node, source)
        text = self._node_text(node, source)
        is_async = text.startswith("async ") or "async" in [
            self._node_text(c, source) for c in node.children[:3]
        ]

        params = self._extract_params(node, source)

        sym = Symbol(
            name=name,
            kind="function",
            file_path=file_path,
            start_line=node.start_point[0] + 1,
            start_col=node.start_point[1],
            end_line=node.end_point[0] + 1,
            end_col=node.end_point[1],
            parameters=params,
            is_async=is_async,
        )

        body = self._find_child(node, "statement_block")
        if body:
            sym.call_sites = self._extract_call_sites(body, source)

        return sym

    def _extract_variable_decl(self, node, source, file_path):
        """Extract const/let/var declarations."""
        symbols = []
        for child in node.children:
            if child.type == "variable_declarator":
                name_node = self._find_child(child, "identifier")
                if not name_node:
                    continue
                name = self._node_text(name_node, source)

                # Check if value is an arrow function or function expression
                value = child.children[-1] if len(child.children) > 1 else None
                if value and value.type in ("arrow_function", "function_expression",
                                            "function"):
                    is_async = self._node_text(value, source).startswith("async")
                    params = self._extract_params(value, source)
                    sym = Symbol(
                        name=name,
                        kind="function",
                        file_path=file_path,
                        start_line=node.start_point[0] + 1,
                        start_col=node.start_point[1],
                        end_line=node.end_point[0] + 1,
                        end_col=node.end_point[1],
                        parameters=params,
                        is_async=is_async,
                    )
                else:
                    sym = Symbol(
                        name=name,
                        kind="variable",
                        file_path=file_path,
                        start_line=node.start_point[0] + 1,
                        start_col=node.start_point[1],
                        end_line=node.end_point[0] + 1,
                        end_col=node.end_point[1],
                    )
                symbols.append(sym)
        return symbols

    def _extract_expression_var(self, node, source, file_path):
        """Extract module.exports or similar expressions."""
        return None  # Skip expression statements for now

    def _extract_params(self, node, source):
        """Extract function parameters."""
        params = []
        formal = self._find_child(node, "formal_parameters")
        if not formal:
            return params

        for child in formal.children:
            if child.type in ("(", ")", ","):
                continue
            if child.type == "identifier":
                params.append(Parameter(name=self._node_text(child, source)))
            elif child.type == "assignment_pattern":
                name_node = child.children[0] if child.children else None
                if name_node:
                    p = Parameter(name=self._node_text(name_node, source))
                    if len(child.children) >= 3:
                        p.default = self._node_text(child.children[2], source)
                    params.append(p)
            elif child.type == "rest_pattern":
                name_node = self._find_child(child, "identifier")
                if name_node:
                    params.append(Parameter(
                        name=self._node_text(name_node, source),
                        is_args=True,
                    ))
            elif child.type in ("object_pattern", "array_pattern"):
                params.append(Parameter(name=self._node_text(child, source)))

        return params
