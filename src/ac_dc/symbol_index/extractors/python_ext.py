"""Python-specific symbol extractor."""

import logging
from typing import Optional

from ..models import (
    Symbol, SymbolKind, SymbolRange, Parameter, CallSite, Import,
)
from .base import BaseExtractor, _node_text, _make_range

log = logging.getLogger(__name__)


class PythonExtractor(BaseExtractor):
    """Extract symbols from Python source files."""

    CLASS_NODE_TYPES = {"class_definition"}
    FUNCTION_NODE_TYPES = {"function_definition", "decorated_definition"}
    VARIABLE_NODE_TYPES = {"expression_statement", "assignment"}
    IMPORT_NODE_TYPES = {"import_statement", "import_from_statement"}
    CALL_NODE_TYPES = {"call"}
    PROPERTY_NODE_TYPES = set()  # handled via decorated_definition

    def _extract_class(
        self, node, source_bytes: bytes, file_path: str
    ) -> Optional[Symbol]:
        name_node = node.child_by_field_name("name")
        if name_node is None:
            return None

        name = _node_text(name_node, source_bytes)
        bases = self._extract_bases(node, source_bytes)

        sym = Symbol(
            name=name,
            kind=SymbolKind.CLASS,
            file_path=file_path,
            range=_make_range(node),
            bases=bases,
        )

        # Extract instance variables from __init__
        body = node.child_by_field_name("body")
        if body:
            sym.instance_vars = self._extract_instance_vars(body, source_bytes)

        return sym

    def _extract_bases(self, class_node, source_bytes: bytes) -> list[str]:
        """Extract base class names."""
        bases = []
        superclasses = class_node.child_by_field_name("superclasses")
        if superclasses is None:
            # Try argument_list (older grammar versions)
            for child in class_node.children:
                if child.type == "argument_list":
                    superclasses = child
                    break

        if superclasses:
            for child in superclasses.children:
                if child.type in ("identifier", "attribute"):
                    bases.append(_node_text(child, source_bytes))
        return bases

    def _extract_instance_vars(self, body_node, source_bytes: bytes) -> list[str]:
        """Extract self.x assignments from __init__."""
        ivars = []
        for child in body_node.children:
            if child.type == "function_definition":
                fname = child.child_by_field_name("name")
                if fname and _node_text(fname, source_bytes) == "__init__":
                    self._collect_self_assignments(child, source_bytes, ivars)
        return ivars

    def _collect_self_assignments(self, node, source_bytes: bytes, ivars: list[str]):
        """Recursively find self.x = ... patterns."""
        for child in node.children:
            if child.type in ("expression_statement", "assignment"):
                self._check_self_assign(child, source_bytes, ivars)
            if hasattr(child, 'children'):
                self._collect_self_assignments(child, source_bytes, ivars)

    def _check_self_assign(self, node, source_bytes: bytes, ivars: list[str]):
        """Check if node is self.x = ... and extract x."""
        # Look for assignment with self.x on left
        left = node.child_by_field_name("left")
        if left is None:
            # expression_statement may contain assignment as child
            for child in node.children:
                if child.type == "assignment":
                    left = child.child_by_field_name("left")
                    break

        if left and left.type == "attribute":
            obj = left.child_by_field_name("object")
            attr = left.child_by_field_name("attribute")
            if obj and attr and _node_text(obj, source_bytes) == "self":
                name = _node_text(attr, source_bytes)
                if name not in ivars and not name.startswith("__"):
                    ivars.append(name)

    def _extract_function(
        self, node, source_bytes: bytes, file_path: str,
        parent_class: Optional[Symbol],
    ) -> Optional[Symbol]:
        actual_node = node
        is_decorated = node.type == "decorated_definition"
        is_property = False
        is_async = False

        if is_decorated:
            # Check decorators
            for child in node.children:
                if child.type == "decorator":
                    dec_text = _node_text(child, source_bytes)
                    if "@property" in dec_text:
                        is_property = True
                # The actual function definition
                if child.type == "function_definition":
                    actual_node = child

        if actual_node.type != "function_definition":
            return None

        name_node = actual_node.child_by_field_name("name")
        if name_node is None:
            return None

        name = _node_text(name_node, source_bytes)

        # Check async
        for child in actual_node.children:
            if child.type == "async":
                is_async = True
                break
        # Also check parent text for 'async def'
        text_before = source_bytes[actual_node.start_byte:actual_node.start_byte + 10]
        if text_before.startswith(b"async "):
            is_async = True

        # Determine kind
        if is_property:
            kind = SymbolKind.PROPERTY
        elif parent_class is not None:
            kind = SymbolKind.METHOD
        else:
            kind = SymbolKind.FUNCTION

        params = self._extract_params(actual_node, source_bytes, parent_class is not None)
        return_type = self._extract_return_type(actual_node, source_bytes)

        return Symbol(
            name=name,
            kind=kind,
            file_path=file_path,
            range=_make_range(node),
            parameters=params,
            return_type=return_type,
            is_async=is_async,
        )

    def _extract_params(
        self, func_node, source_bytes: bytes, is_method: bool
    ) -> list[Parameter]:
        """Extract parameters, omitting self/cls for methods."""
        params_node = func_node.child_by_field_name("parameters")
        if params_node is None:
            return []

        params = []
        for child in params_node.children:
            if child.type in ("identifier",):
                name = _node_text(child, source_bytes)
                if is_method and name in ("self", "cls") and not params:
                    continue
                params.append(Parameter(name=name))

            elif child.type == "typed_parameter":
                pname_node = child.children[0] if child.children else None
                pname = _node_text(pname_node, source_bytes) if pname_node else "?"
                if is_method and pname in ("self", "cls") and not params:
                    continue
                type_ann = None
                type_node = child.child_by_field_name("type")
                if type_node:
                    type_ann = _node_text(type_node, source_bytes)
                params.append(Parameter(name=pname, type_annotation=type_ann))

            elif child.type == "default_parameter":
                pname_node = child.child_by_field_name("name")
                pname = _node_text(pname_node, source_bytes) if pname_node else "?"
                if is_method and pname in ("self", "cls") and not params:
                    continue
                default_node = child.child_by_field_name("value")
                default = _node_text(default_node, source_bytes) if default_node else None
                params.append(Parameter(name=pname, default=default))

            elif child.type == "typed_default_parameter":
                pname_node = child.child_by_field_name("name")
                pname = _node_text(pname_node, source_bytes) if pname_node else "?"
                if is_method and pname in ("self", "cls") and not params:
                    continue
                type_node = child.child_by_field_name("type")
                type_ann = _node_text(type_node, source_bytes) if type_node else None
                default_node = child.child_by_field_name("value")
                default = _node_text(default_node, source_bytes) if default_node else None
                params.append(Parameter(
                    name=pname, type_annotation=type_ann, default=default,
                ))

            elif child.type == "list_splat_pattern":
                name = _node_text(child, source_bytes).lstrip("*")
                params.append(Parameter(name=name, is_variadic=True))

            elif child.type == "dictionary_splat_pattern":
                name = _node_text(child, source_bytes).lstrip("*")
                params.append(Parameter(name=name, is_keyword=True))

        return params

    def _extract_return_type(self, func_node, source_bytes: bytes) -> Optional[str]:
        """Extract return type annotation."""
        ret = func_node.child_by_field_name("return_type")
        if ret:
            text = _node_text(ret, source_bytes)
            return text
        return None

    def _extract_import(self, node, source_bytes: bytes) -> Optional[Import]:
        if node.type == "import_statement":
            # import foo, import foo.bar
            names = []
            for child in node.children:
                if child.type == "dotted_name":
                    names.append(_node_text(child, source_bytes))
                elif child.type == "aliased_import":
                    name_node = child.child_by_field_name("name")
                    if name_node:
                        names.append(_node_text(name_node, source_bytes))
            if names:
                return Import(
                    module=names[0],
                    names=names,
                    line=node.start_point[0] + 1,
                )

        elif node.type == "import_from_statement":
            # from foo import bar, from .foo import bar
            module = ""
            level = 0
            names = []

            for child in node.children:
                if child.type == "relative_import":
                    text = _node_text(child, source_bytes)
                    # Count leading dots
                    import_prefix = child.child_by_field_name("import_prefix")
                    if import_prefix:
                        level = _node_text(import_prefix, source_bytes).count(".")
                    else:
                        level = text.count(".")
                    # Module part
                    for sub in child.children:
                        if sub.type == "dotted_name":
                            module = _node_text(sub, source_bytes)

                elif child.type == "dotted_name":
                    if not module:
                        module = _node_text(child, source_bytes)
                    else:
                        names.append(_node_text(child, source_bytes))

                elif child.type == "import_prefix":
                    level = _node_text(child, source_bytes).count(".")

                elif child.type == "aliased_import":
                    name_node = child.child_by_field_name("name")
                    if name_node:
                        names.append(_node_text(name_node, source_bytes))

                elif child.type == "identifier":
                    # "from x import name"
                    text = _node_text(child, source_bytes)
                    if text not in ("from", "import"):
                        names.append(text)

                elif child.type == "wildcard_import":
                    names.append("*")

            return Import(
                module=module,
                names=names,
                level=level,
                line=node.start_point[0] + 1,
            )

        return None

    def _extract_variable(
        self, node, source_bytes: bytes, file_path: str
    ) -> Optional[Symbol]:
        """Extract top-level variable assignment."""
        # expression_statement containing assignment
        assign_node = node
        if node.type == "expression_statement":
            for child in node.children:
                if child.type == "assignment":
                    assign_node = child
                    break
            else:
                return None

        if assign_node.type != "assignment":
            return None

        left = assign_node.child_by_field_name("left")
        if left is None:
            return None

        # Only simple identifiers at top level
        if left.type != "identifier":
            return None

        name = _node_text(left, source_bytes)
        # Skip dunder and private
        if name.startswith("_") and not name.startswith("__"):
            return None

        return Symbol(
            name=name,
            kind=SymbolKind.VARIABLE,
            file_path=file_path,
            range=_make_range(node),
        )
