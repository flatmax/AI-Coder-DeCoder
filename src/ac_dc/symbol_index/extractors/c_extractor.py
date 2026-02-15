"""C/C++ symbol extractor."""

from .base import BaseExtractor, FileSymbols, Import, Parameter, Symbol


class CExtractor(BaseExtractor):
    """Extract symbols from C/C++ source files."""

    def extract(self, tree, source_code, file_path):
        root = tree.root_node
        symbols = []
        imports = []

        for node in root.children:
            if node.type == "preproc_include":
                imp = self._extract_include(node, source_code)
                if imp:
                    imports.append(imp)
            elif node.type in ("struct_specifier", "type_definition"):
                sym = self._extract_struct(node, source_code, file_path)
                if sym:
                    symbols.append(sym)
            elif node.type == "function_definition":
                sym = self._extract_function(node, source_code, file_path)
                if sym:
                    symbols.append(sym)
            elif node.type == "declaration":
                sym = self._extract_declaration(node, source_code, file_path)
                if sym:
                    symbols.append(sym)

        return FileSymbols(file_path=file_path, symbols=symbols, imports=imports)

    def _extract_include(self, node, source):
        """Extract #include directive."""
        for child in node.children:
            if child.type in ("string_literal", "system_lib_string"):
                path = self._node_text(child, source).strip('"<>')
                return Import(module=path, names=[])
        return None

    def _extract_struct(self, node, source, file_path):
        """Extract struct/class definition."""
        actual = node
        if node.type == "type_definition":
            for child in node.children:
                if child.type == "struct_specifier":
                    actual = child
                    break
            else:
                return None

        name_node = self._find_child(actual, "type_identifier")
        if not name_node:
            # Check for field_identifier in typedef
            name_node = self._find_child(actual, "field_identifier")
        if not name_node:
            # Try the last type_identifier in typedef
            if node.type == "type_definition":
                for child in node.children:
                    if child.type == "type_identifier":
                        name_node = child
            if not name_node:
                return None

        name = self._node_text(name_node, source)

        sym = Symbol(
            name=name,
            kind="class",
            file_path=file_path,
            start_line=node.start_point[0] + 1,
            start_col=node.start_point[1],
            end_line=node.end_point[0] + 1,
            end_col=node.end_point[1],
        )

        # Extract struct fields
        body = self._find_child(actual, "field_declaration_list")
        if body:
            for child in body.children:
                if child.type == "field_declaration":
                    field_name = self._find_child(child, "field_identifier")
                    if field_name:
                        sym.children.append(Symbol(
                            name=self._node_text(field_name, source),
                            kind="variable",
                            file_path=file_path,
                            start_line=child.start_point[0] + 1,
                            start_col=child.start_point[1],
                            end_line=child.end_point[0] + 1,
                            end_col=child.end_point[1],
                        ))

        return sym

    def _extract_function(self, node, source, file_path):
        """Extract function definition."""
        # Find declarator
        declarator = self._find_child(node, "function_declarator")
        if not declarator:
            # Try nested declarator
            decl = self._find_child(node, "declarator")
            if decl:
                declarator = self._find_child(decl, "function_declarator")
        if not declarator:
            return None

        name_node = self._find_child(declarator, "identifier")
        if not name_node:
            return None

        name = self._node_text(name_node, source)
        params = self._extract_params(declarator, source)

        # Return type
        return_type = None
        type_node = self._find_child(node, "primitive_type") or self._find_child(node, "type_identifier")
        if type_node:
            return_type = self._node_text(type_node, source)

        sym = Symbol(
            name=name,
            kind="function",
            file_path=file_path,
            start_line=node.start_point[0] + 1,
            start_col=node.start_point[1],
            end_line=node.end_point[0] + 1,
            end_col=node.end_point[1],
            parameters=params,
            return_type=return_type,
        )

        body = self._find_child(node, "compound_statement")
        if body:
            sym.call_sites = self._extract_call_sites(body, source)

        return sym

    def _extract_declaration(self, node, source, file_path):
        """Extract variable/function declaration."""
        # Function prototypes
        for child in node.children:
            if child.type == "function_declarator":
                name_node = self._find_child(child, "identifier")
                if name_node:
                    params = self._extract_params(child, source)
                    return Symbol(
                        name=self._node_text(name_node, source),
                        kind="function",
                        file_path=file_path,
                        start_line=node.start_point[0] + 1,
                        start_col=node.start_point[1],
                        end_line=node.end_point[0] + 1,
                        end_col=node.end_point[1],
                        parameters=params,
                    )
        return None

    def _extract_params(self, func_node, source):
        """Extract function parameters."""
        params = []
        param_list = self._find_child(func_node, "parameter_list")
        if not param_list:
            return params

        for child in param_list.children:
            if child.type == "parameter_declaration":
                name_node = self._find_child(child, "identifier")
                type_node = self._find_child(child, "primitive_type") or self._find_child(child, "type_identifier")
                if name_node:
                    p = Parameter(name=self._node_text(name_node, source))
                    if type_node:
                        p.type_hint = self._node_text(type_node, source)
                    params.append(p)

        return params
