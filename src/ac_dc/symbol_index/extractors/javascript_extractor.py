"""JavaScript/TypeScript symbol extractor using tree-sitter."""

from typing import Optional

from ac_dc.symbol_index.models import (
    CallSite, FileSymbols, Import, Parameter, Symbol,
)
from ac_dc.symbol_index.extractors.base import BaseExtractor


class JavaScriptExtractor(BaseExtractor):
    """Extract symbols from JavaScript/TypeScript source files."""

    def extract(self, source: bytes, tree: Optional[object], file_path: str) -> FileSymbols:
        if tree is None:
            return FileSymbols(file_path=file_path)

        root = tree.root_node
        symbols = []
        imports = []

        for child in root.children:
            self._extract_top_level(child, source, file_path, symbols, imports)

        return FileSymbols(file_path=file_path, symbols=symbols, imports=imports)

    def _extract_top_level(self, node, source: bytes, file_path: str,
                           symbols: list, imports: list):
        """Process a top-level AST node."""
        kind = node.type

        if kind == "class_declaration":
            sym = self._extract_class(node, source, file_path)
            if sym:
                symbols.append(sym)
        elif kind == "export_statement":
            # Unwrap export
            for child in node.children:
                self._extract_top_level(child, source, file_path, symbols, imports)
        elif kind in ("function_declaration", "generator_function_declaration"):
            sym = self._extract_function(node, source, file_path)
            if sym:
                symbols.append(sym)
        elif kind in ("lexical_declaration", "variable_declaration"):
            for decl in node.children:
                if decl.type == "variable_declarator":
                    sym = self._extract_var_declarator(decl, source, file_path)
                    if sym:
                        symbols.append(sym)
        elif kind == "import_statement":
            imp = self._extract_import(node, source)
            if imp:
                imports.append(imp)

    def _extract_class(self, node, source: bytes, file_path: str) -> Optional[Symbol]:
        name_node = node.child_by_field_name("name")
        if not name_node:
            return None
        name = self._node_text(name_node, source)

        # Heritage (extends)
        bases = []
        heritage = node.child_by_field_name("heritage") or None
        # Try finding heritage clause in children
        for child in node.children:
            if child.type == "class_heritage":
                for sub in child.children:
                    if sub.type == "identifier":
                        bases.append(self._node_text(sub, source))
                    elif sub.type == "member_expression":
                        bases.append(self._node_text(sub, source))

        sym = Symbol(
            name=name, kind="class", file_path=file_path,
            range=self._node_range(node), bases=bases,
        )

        # Extract body
        body = node.child_by_field_name("body")
        if body:
            for child in body.children:
                if child.type == "method_definition":
                    method = self._extract_method(child, source, file_path)
                    if method:
                        sym.children.append(method)

        return sym

    def _extract_method(self, node, source: bytes, file_path: str) -> Optional[Symbol]:
        name_node = node.child_by_field_name("name")
        if not name_node:
            return None
        name = self._node_text(name_node, source)

        # Check for getter/setter
        kind = "method"
        for child in node.children:
            if child.type == "get":
                kind = "property"
                break

        # Check async
        is_async = any(c.type == "async" for c in node.children)

        params = self._extract_params(node, source)
        return_type = self._get_return_type(node, source)

        sym = Symbol(
            name=name, kind=kind, file_path=file_path,
            range=self._node_range(node), parameters=params,
            return_type=return_type, is_async=is_async,
        )

        body = node.child_by_field_name("body")
        if body:
            sym.call_sites = self._extract_call_sites(body, source)

        return sym

    def _extract_function(self, node, source: bytes, file_path: str) -> Optional[Symbol]:
        name_node = node.child_by_field_name("name")
        if not name_node:
            return None
        name = self._node_text(name_node, source)
        is_async = any(c.type == "async" for c in node.children)
        params = self._extract_params(node, source)
        return_type = self._get_return_type(node, source)

        sym = Symbol(
            name=name, kind="function", file_path=file_path,
            range=self._node_range(node), parameters=params,
            return_type=return_type, is_async=is_async,
        )

        body = node.child_by_field_name("body")
        if body:
            sym.call_sites = self._extract_call_sites(body, source)

        return sym

    def _extract_var_declarator(self, node, source: bytes,
                                file_path: str) -> Optional[Symbol]:
        name_node = node.child_by_field_name("name")
        if not name_node:
            return None
        name = self._node_text(name_node, source)
        return Symbol(
            name=name, kind="variable", file_path=file_path,
            range=self._node_range(node),
        )

    def _extract_params(self, node, source: bytes) -> list[Parameter]:
        params = []
        params_node = node.child_by_field_name("parameters")
        if not params_node:
            return params
        for child in params_node.children:
            if child.type in ("identifier", "required_parameter",
                              "optional_parameter"):
                name = ""
                default = None
                for sub in ([child] if child.type == "identifier" else child.children):
                    if sub.type == "identifier":
                        name = self._node_text(sub, source)
                    elif sub.type not in ("=", ":", ",", "(", ")", "?"):
                        if default is None and sub.type != "type_annotation":
                            default = self._node_text(sub, source)
                if name:
                    params.append(Parameter(name=name, default=default))
            elif child.type == "rest_pattern":
                for sub in child.children:
                    if sub.type == "identifier":
                        params.append(Parameter(
                            name=self._node_text(sub, source),
                            is_variadic=True,
                        ))
        return params

    def _get_return_type(self, node, source: bytes) -> Optional[str]:
        ret = node.child_by_field_name("return_type")
        if ret:
            text = self._node_text(ret, source)
            # Strip leading ": " for TS annotations
            if text.startswith(": "):
                text = text[2:]
            elif text.startswith(":"):
                text = text[1:]
            return text.strip() if text.strip() else None
        return None

    def _extract_import(self, node, source: bytes) -> Optional[Import]:
        source_node = node.child_by_field_name("source")
        if not source_node:
            return None
        module = self._node_text(source_node, source).strip("'\"")
        names = []
        for child in node.children:
            if child.type == "import_clause":
                for sub in child.children:
                    if sub.type == "identifier":
                        names.append(self._node_text(sub, source))
                    elif sub.type == "named_imports":
                        for imp in sub.children:
                            if imp.type == "import_specifier":
                                for spec in imp.children:
                                    if spec.type == "identifier":
                                        names.append(self._node_text(spec, source))
                                        break
        return Import(
            module=module, names=names,
            line=node.start_point[0] + 1,
        )

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