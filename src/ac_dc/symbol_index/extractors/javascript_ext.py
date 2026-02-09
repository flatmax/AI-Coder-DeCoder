"""JavaScript/TypeScript symbol extractor."""

import logging
from typing import Optional

from ..models import (
    Symbol, SymbolKind, SymbolRange, Parameter, CallSite, Import,
)
from .base import BaseExtractor, _node_text, _make_range

log = logging.getLogger(__name__)


class JavaScriptExtractor(BaseExtractor):
    """Extract symbols from JavaScript/TypeScript files."""

    CLASS_NODE_TYPES = {"class_declaration", "class"}
    FUNCTION_NODE_TYPES = {
        "function_declaration", "method_definition",
        "arrow_function", "generator_function_declaration",
    }
    VARIABLE_NODE_TYPES = {
        "variable_declaration", "lexical_declaration",
        "export_statement",
    }
    IMPORT_NODE_TYPES = {"import_statement"}
    CALL_NODE_TYPES = {"call_expression"}
    PROPERTY_NODE_TYPES = {"public_field_definition", "field_definition"}

    def _extract_class(
        self, node, source_bytes: bytes, file_path: str
    ) -> Optional[Symbol]:
        name_node = node.child_by_field_name("name")
        if name_node is None:
            return None

        name = _node_text(name_node, source_bytes)
        bases = []

        # Check for extends
        heritage = node.child_by_field_name("heritage") or \
            self._find_child_by_type(node, "class_heritage")
        if heritage:
            for child in heritage.children:
                if child.type in ("identifier", "member_expression"):
                    bases.append(_node_text(child, source_bytes))

        return Symbol(
            name=name,
            kind=SymbolKind.CLASS,
            file_path=file_path,
            range=_make_range(node),
            bases=bases,
        )

    def _extract_function(
        self, node, source_bytes: bytes, file_path: str,
        parent_class: Optional[Symbol],
    ) -> Optional[Symbol]:
        is_async = False

        if node.type == "method_definition":
            return self._extract_method(node, source_bytes, file_path, parent_class)

        if node.type == "arrow_function":
            # Arrow functions only tracked if assigned to variable
            return None

        name_node = node.child_by_field_name("name")
        if name_node is None:
            return None

        name = _node_text(name_node, source_bytes)

        # Check async
        text = _node_text(node, source_bytes)
        if text.startswith("async "):
            is_async = True

        params = self._extract_js_params(node, source_bytes)
        return_type = self._extract_ts_return(node, source_bytes)

        kind = SymbolKind.METHOD if parent_class else SymbolKind.FUNCTION

        return Symbol(
            name=name,
            kind=kind,
            file_path=file_path,
            range=_make_range(node),
            parameters=params,
            return_type=return_type,
            is_async=is_async,
        )

    def _extract_method(
        self, node, source_bytes: bytes, file_path: str,
        parent_class: Optional[Symbol],
    ) -> Optional[Symbol]:
        name_node = node.child_by_field_name("name")
        if name_node is None:
            return None

        name = _node_text(name_node, source_bytes)
        is_async = False
        is_property = False

        for child in node.children:
            if child.type == "async":
                is_async = True
            elif child.type == "get" or child.type == "set":
                is_property = True

        params = self._extract_js_params(node, source_bytes)
        return_type = self._extract_ts_return(node, source_bytes)

        kind = SymbolKind.PROPERTY if is_property else SymbolKind.METHOD

        return Symbol(
            name=name,
            kind=kind,
            file_path=file_path,
            range=_make_range(node),
            parameters=params,
            return_type=return_type,
            is_async=is_async,
        )

    def _extract_js_params(self, func_node, source_bytes: bytes) -> list[Parameter]:
        """Extract function parameters."""
        params_node = func_node.child_by_field_name("parameters") or \
            self._find_child_by_type(func_node, "formal_parameters")
        if params_node is None:
            return []

        params = []
        for child in params_node.children:
            if child.type in ("identifier", "shorthand_property_identifier"):
                name = _node_text(child, source_bytes)
                if name not in ("this",):
                    params.append(Parameter(name=name))

            elif child.type == "required_parameter":
                pname = self._param_name(child, source_bytes)
                type_ann = self._ts_type_annotation(child, source_bytes)
                if pname:
                    params.append(Parameter(name=pname, type_annotation=type_ann))

            elif child.type == "optional_parameter":
                pname = self._param_name(child, source_bytes)
                type_ann = self._ts_type_annotation(child, source_bytes)
                if pname:
                    params.append(Parameter(name=pname, type_annotation=type_ann, default="?"))

            elif child.type == "assignment_pattern":
                left = child.child_by_field_name("left")
                if left:
                    pname = _node_text(left, source_bytes)
                    params.append(Parameter(name=pname, default="..."))

            elif child.type == "rest_pattern":
                text = _node_text(child, source_bytes).lstrip(".")
                params.append(Parameter(name=text, is_variadic=True))

            elif child.type == "object_pattern":
                params.append(Parameter(name="{...}"))

            elif child.type == "array_pattern":
                params.append(Parameter(name="[...]"))

        return params

    def _param_name(self, param_node, source_bytes: bytes) -> Optional[str]:
        """Extract name from a TypeScript parameter node."""
        pattern = param_node.child_by_field_name("pattern")
        if pattern:
            return _node_text(pattern, source_bytes)
        # First identifier child
        for child in param_node.children:
            if child.type == "identifier":
                return _node_text(child, source_bytes)
        return None

    def _ts_type_annotation(self, node, source_bytes: bytes) -> Optional[str]:
        """Extract TypeScript type annotation."""
        ann = node.child_by_field_name("type") or \
            self._find_child_by_type(node, "type_annotation")
        if ann:
            text = _node_text(ann, source_bytes).lstrip(": ")
            return text if text else None
        return None

    def _extract_ts_return(self, func_node, source_bytes: bytes) -> Optional[str]:
        """Extract TypeScript return type annotation."""
        ret = func_node.child_by_field_name("return_type") or \
            self._find_child_by_type(func_node, "type_annotation")
        if ret:
            text = _node_text(ret, source_bytes).lstrip(": ")
            return text if text else None
        return None

    def _extract_import(self, node, source_bytes: bytes) -> Optional[Import]:
        """Extract JS/TS import statement."""
        source_node = node.child_by_field_name("source")
        if source_node is None:
            # Find string node
            for child in node.children:
                if child.type == "string":
                    source_node = child
                    break
        if source_node is None:
            return None

        module = _node_text(source_node, source_bytes).strip("'\"")
        names = []

        for child in node.children:
            if child.type == "import_clause":
                for sub in child.children:
                    if sub.type == "identifier":
                        names.append(_node_text(sub, source_bytes))
                    elif sub.type == "named_imports":
                        for imp_spec in sub.children:
                            if imp_spec.type == "import_specifier":
                                name_node = imp_spec.child_by_field_name("name")
                                if name_node:
                                    names.append(_node_text(name_node, source_bytes))
                    elif sub.type == "namespace_import":
                        for ns_child in sub.children:
                            if ns_child.type == "identifier":
                                names.append(f"* as {_node_text(ns_child, source_bytes)}")

        level = 1 if module.startswith(".") else 0

        return Import(
            module=module,
            names=names,
            level=level,
            line=node.start_point[0] + 1,
        )

    def _extract_variable(
        self, node, source_bytes: bytes, file_path: str
    ) -> Optional[Symbol]:
        """Extract variable/const declarations."""
        if node.type == "export_statement":
            # Find the declaration inside
            for child in node.children:
                if child.type in ("variable_declaration", "lexical_declaration"):
                    return self._extract_var_decl(child, source_bytes, file_path)
                elif child.type in ("function_declaration",):
                    return self._extract_function(child, source_bytes, file_path, None)
                elif child.type in ("class_declaration",):
                    return self._extract_class(child, source_bytes, file_path)
            return None

        return self._extract_var_decl(node, source_bytes, file_path)

    def _extract_var_decl(
        self, node, source_bytes: bytes, file_path: str
    ) -> Optional[Symbol]:
        """Extract from variable_declaration or lexical_declaration."""
        for child in node.children:
            if child.type == "variable_declarator":
                name_node = child.child_by_field_name("name")
                if name_node and name_node.type == "identifier":
                    name = _node_text(name_node, source_bytes)
                    # Check if value is arrow function/function
                    value_node = child.child_by_field_name("value")
                    if value_node and value_node.type in ("arrow_function", "function"):
                        # This is really a function
                        is_async = False
                        text_before = _node_text(value_node, source_bytes)[:10]
                        if text_before.startswith("async"):
                            is_async = True
                        params = self._extract_js_params(value_node, source_bytes)
                        return Symbol(
                            name=name,
                            kind=SymbolKind.FUNCTION,
                            file_path=file_path,
                            range=_make_range(node),
                            parameters=params,
                            is_async=is_async,
                        )
                    return Symbol(
                        name=name,
                        kind=SymbolKind.VARIABLE,
                        file_path=file_path,
                        range=_make_range(node),
                    )
        return None

    def _extract_property(
        self, node, source_bytes: bytes, file_path: str
    ) -> Optional[Symbol]:
        """Extract class field definition."""
        name_node = node.child_by_field_name("name") or \
            node.child_by_field_name("property")
        if name_node is None:
            for child in node.children:
                if child.type in ("identifier", "property_identifier"):
                    name_node = child
                    break
        if name_node is None:
            return None

        name = _node_text(name_node, source_bytes)
        return Symbol(
            name=name,
            kind=SymbolKind.VARIABLE,
            file_path=file_path,
            range=_make_range(node),
        )
