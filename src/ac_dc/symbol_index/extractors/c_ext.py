"""C/C++ symbol extractor."""

import logging
from typing import Optional

from ..models import (
    Symbol, SymbolKind, SymbolRange, Parameter, CallSite, Import,
)
from .base import BaseExtractor, _node_text, _make_range

log = logging.getLogger(__name__)


class CExtractor(BaseExtractor):
    """Extract symbols from C/C++ source files."""

    CLASS_NODE_TYPES = {
        "struct_specifier", "class_specifier", "enum_specifier",
    }
    FUNCTION_NODE_TYPES = {"function_definition"}
    VARIABLE_NODE_TYPES = {"declaration"}
    IMPORT_NODE_TYPES = {"preproc_include"}
    CALL_NODE_TYPES = {"call_expression"}

    def _extract_class(
        self, node, source_bytes: bytes, file_path: str
    ) -> Optional[Symbol]:
        name_node = node.child_by_field_name("name")
        if name_node is None:
            return None

        name = _node_text(name_node, source_bytes)
        bases = []

        # C++ base class list
        base_list = self._find_child_by_type(node, "base_class_clause")
        if base_list:
            for child in base_list.children:
                if child.type == "type_identifier":
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
        declarator = node.child_by_field_name("declarator")
        if declarator is None:
            return None

        # Navigate to the function declarator
        func_decl = declarator
        while func_decl and func_decl.type not in (
            "function_declarator", "identifier",
        ):
            func_decl = func_decl.child_by_field_name("declarator") or \
                (func_decl.children[0] if func_decl.children else None)

        if func_decl is None:
            return None

        if func_decl.type == "function_declarator":
            name_node = func_decl.child_by_field_name("declarator")
            if name_node is None:
                return None
            # Handle qualified names like Class::method
            if name_node.type == "qualified_identifier":
                # Last identifier is the name
                name = _node_text(name_node, source_bytes)
            else:
                name = _node_text(name_node, source_bytes)
        else:
            name = _node_text(func_decl, source_bytes)

        params = self._extract_c_params(declarator, source_bytes)
        return_type = self._extract_c_return(node, source_bytes)

        kind = SymbolKind.METHOD if parent_class else SymbolKind.FUNCTION

        return Symbol(
            name=name,
            kind=kind,
            file_path=file_path,
            range=_make_range(node),
            parameters=params,
            return_type=return_type,
        )

    def _extract_c_params(self, declarator, source_bytes: bytes) -> list[Parameter]:
        """Extract C/C++ function parameters."""
        params = []
        # Find the parameter_list
        param_list = self._find_param_list(declarator)
        if param_list is None:
            return params

        for child in param_list.children:
            if child.type == "parameter_declaration":
                # Type is in the declarator, name might be there too
                decl = child.child_by_field_name("declarator")
                if decl:
                    name = _node_text(decl, source_bytes).strip("*& ")
                    ptype_node = child.child_by_field_name("type")
                    ptype = _node_text(ptype_node, source_bytes) if ptype_node else None
                    params.append(Parameter(name=name, type_annotation=ptype))
                else:
                    # Type-only parameter
                    ptype = _node_text(child, source_bytes)
                    params.append(Parameter(name=ptype))

            elif child.type == "variadic_parameter":
                params.append(Parameter(name="...", is_variadic=True))

        return params

    def _find_param_list(self, node):
        """Find parameter_list in a declarator tree."""
        if node is None:
            return None
        for child in node.children:
            if child.type == "parameter_list":
                return child
            result = self._find_param_list(child)
            if result:
                return result
        return None

    def _extract_c_return(self, func_node, source_bytes: bytes) -> Optional[str]:
        """Extract return type from function definition."""
        type_node = func_node.child_by_field_name("type")
        if type_node:
            return _node_text(type_node, source_bytes)
        return None

    def _extract_import(self, node, source_bytes: bytes) -> Optional[Import]:
        """Extract #include directive."""
        path_node = node.child_by_field_name("path")
        if path_node is None:
            # Try to find string_literal or system_lib_string
            for child in node.children:
                if child.type in ("string_literal", "system_lib_string"):
                    path_node = child
                    break

        if path_node is None:
            return None

        path = _node_text(path_node, source_bytes).strip('"<>')
        return Import(
            module=path,
            names=[path],
            level=0,
            line=node.start_point[0] + 1,
        )

    def _extract_variable(
        self, node, source_bytes: bytes, file_path: str
    ) -> Optional[Symbol]:
        """Extract top-level variable/constant declarations."""
        # Skip function declarations and typedefs
        text = _node_text(node, source_bytes)
        if "(" in text:
            return None  # Likely a function declaration
        if text.strip().startswith("typedef"):
            return None

        declarator = node.child_by_field_name("declarator")
        if declarator is None:
            return None

        # Handle init_declarator
        if declarator.type == "init_declarator":
            declarator = declarator.child_by_field_name("declarator")
        if declarator is None:
            return None

        if declarator.type == "identifier":
            name = _node_text(declarator, source_bytes)
            return Symbol(
                name=name,
                kind=SymbolKind.VARIABLE,
                file_path=file_path,
                range=_make_range(node),
            )

        return None
