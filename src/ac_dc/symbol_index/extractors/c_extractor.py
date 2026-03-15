"""C/C++ symbol extractor using tree-sitter."""

from typing import Optional

from ac_dc.symbol_index.models import (
    CallSite, FileSymbols, Import, Parameter, Symbol,
)
from ac_dc.symbol_index.extractors.base import BaseExtractor


class CExtractor(BaseExtractor):
    """Extract symbols from C/C++ source files."""

    def extract(self, source: bytes, tree: Optional[object], file_path: str) -> FileSymbols:
        if tree is None:
            return FileSymbols(file_path=file_path)

        root = tree.root_node
        symbols = []
        imports = []

        for child in root.children:
            kind = child.type

            if kind == "preproc_include":
                imp = self._extract_include(child, source)
                if imp:
                    imports.append(imp)
            elif kind == "struct_specifier":
                sym = self._extract_struct(child, source, file_path)
                if sym:
                    symbols.append(sym)
            elif kind == "function_definition":
                sym = self._extract_function(child, source, file_path)
                if sym:
                    symbols.append(sym)
            elif kind == "declaration":
                # Could be a function declaration or variable
                sym = self._extract_declaration(child, source, file_path)
                if sym:
                    symbols.append(sym)
            elif kind == "type_definition":
                # typedef struct { ... } Name;
                sym = self._extract_typedef(child, source, file_path)
                if sym:
                    symbols.append(sym)

        return FileSymbols(file_path=file_path, symbols=symbols, imports=imports)

    def _extract_include(self, node, source: bytes) -> Optional[Import]:
        path_node = node.child_by_field_name("path")
        if path_node:
            path = self._node_text(path_node, source)
            # Strip <> or ""
            path = path.strip('<>"')
            return Import(
                module=path, names=[path],
                line=node.start_point[0] + 1,
            )
        return None

    def _extract_struct(self, node, source: bytes, file_path: str) -> Optional[Symbol]:
        name_node = node.child_by_field_name("name")
        if not name_node:
            return None
        name = self._node_text(name_node, source)
        sym = Symbol(
            name=name, kind="class", file_path=file_path,
            range=self._node_range(node),
        )
        # Extract fields from body
        body = node.child_by_field_name("body")
        if body:
            for child in body.children:
                if child.type == "field_declaration":
                    declarator = child.child_by_field_name("declarator")
                    if declarator:
                        var_name = self._node_text(declarator, source)
                        sym.children.append(Symbol(
                            name=var_name, kind="variable",
                            file_path=file_path,
                            range=self._node_range(child),
                        ))
        return sym

    def _extract_function(self, node, source: bytes, file_path: str) -> Optional[Symbol]:
        declarator = node.child_by_field_name("declarator")
        if not declarator:
            return None

        name = ""
        params = []

        # Walk the declarator to find name and parameters
        if declarator.type == "function_declarator":
            name_node = declarator.child_by_field_name("declarator")
            if name_node:
                name = self._node_text(name_node, source)
            params = self._extract_params(declarator, source)
        elif declarator.type == "pointer_declarator":
            # *func(...)
            for child in declarator.children:
                if child.type == "function_declarator":
                    name_node = child.child_by_field_name("declarator")
                    if name_node:
                        name = self._node_text(name_node, source)
                    params = self._extract_params(child, source)

        if not name:
            return None

        sym = Symbol(
            name=name, kind="function", file_path=file_path,
            range=self._node_range(node), parameters=params,
        )

        body = node.child_by_field_name("body")
        if body:
            sym.call_sites = self._extract_call_sites(body, source)

        return sym

    def _extract_declaration(self, node, source: bytes, file_path: str) -> Optional[Symbol]:
        """Extract from a declaration (function prototype or variable)."""
        declarator = node.child_by_field_name("declarator")
        if not declarator:
            return None

        if declarator.type == "function_declarator":
            name_node = declarator.child_by_field_name("declarator")
            if name_node:
                name = self._node_text(name_node, source)
                params = self._extract_params(declarator, source)
                return Symbol(
                    name=name, kind="function", file_path=file_path,
                    range=self._node_range(node), parameters=params,
                )
        elif declarator.type == "init_declarator":
            # Variable initialization
            name_node = declarator.child_by_field_name("declarator")
            if name_node:
                name = self._node_text(name_node, source)
                return Symbol(
                    name=name, kind="variable", file_path=file_path,
                    range=self._node_range(node),
                )
        return None

    def _extract_typedef(self, node, source: bytes, file_path: str) -> Optional[Symbol]:
        """Extract typedef struct."""
        declarator = node.child_by_field_name("declarator")
        if declarator:
            name = self._node_text(declarator, source)
            return Symbol(
                name=name, kind="class", file_path=file_path,
                range=self._node_range(node),
            )
        return None

    def _extract_params(self, func_decl, source: bytes) -> list[Parameter]:
        params = []
        params_node = func_decl.child_by_field_name("parameters")
        if not params_node:
            return params

        for child in params_node.children:
            if child.type == "parameter_declaration":
                declarator = child.child_by_field_name("declarator")
                if declarator:
                    name = self._node_text(declarator, source)
                    params.append(Parameter(name=name))
        return params

    def _extract_call_sites(self, body, source: bytes) -> list[CallSite]:
        calls = []
        seen = set()

        def _walk(node):
            if node.type == "call_expression":
                func = node.child_by_field_name("function")
                if func:
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