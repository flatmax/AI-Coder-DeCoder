"""C++ symbol extractor using tree-sitter."""

from typing import List, Optional, Set
from ..models import Symbol, Parameter, Import, CallSite
from .base import BaseExtractor


class CppExtractor(BaseExtractor):
    """Extracts symbols from C++ source code."""
    
    CALL_NODE_TYPE = 'call_expression'
    SELF_PREFIX = 'this->'
    CONDITIONAL_TYPES = {
        'if_statement', 'else_clause',
        'try_statement', 'catch_clause',
        'for_statement', 'while_statement', 'do_statement',
        'for_range_loop',
        'switch_statement', 'case_statement',
        'conditional_expression',
    }
    BUILTINS_TO_SKIP = {
        'sizeof', 'alignof', 'typeid', 'decltype',
        'static_cast', 'dynamic_cast', 'const_cast', 'reinterpret_cast',
        'std::move', 'std::forward', 'std::make_unique', 'std::make_shared',
    }
    
    def _extract_from_node(
        self, 
        node, 
        file_path: str, 
        content: bytes, 
        symbols: List[Symbol],
        parent: Optional[str] = None
    ):
        """Recursively extract symbols from a node."""
        
        if node.type == 'class_specifier':
            symbol = self._extract_class(node, file_path, content, parent)
            if symbol:
                symbols.append(symbol)
                # Extract children (methods, nested classes)
                body = self._find_child(node, 'field_declaration_list')
                if body:
                    for child in body.children:
                        self._extract_from_node(
                            child, file_path, content,
                            symbol.children, parent=symbol.name
                        )
        
        elif node.type == 'struct_specifier':
            symbol = self._extract_struct(node, file_path, content, parent)
            if symbol:
                symbols.append(symbol)
                body = self._find_child(node, 'field_declaration_list')
                if body:
                    for child in body.children:
                        self._extract_from_node(
                            child, file_path, content,
                            symbol.children, parent=symbol.name
                        )
        
        elif node.type == 'enum_specifier':
            symbol = self._extract_enum(node, file_path, content, parent)
            if symbol:
                symbols.append(symbol)
        
        elif node.type == 'function_definition':
            symbol = self._extract_function(node, file_path, content, parent)
            if symbol:
                symbols.append(symbol)
        
        elif node.type == 'declaration':
            # Could be function declaration, variable, or field
            syms = self._extract_declaration(node, file_path, content, parent)
            symbols.extend(syms)
        
        elif node.type == 'field_declaration':
            # Class/struct member
            syms = self._extract_field(node, file_path, content, parent)
            symbols.extend(syms)
        
        elif node.type == 'preproc_include':
            symbol, imp = self._extract_include(node, file_path, content)
            if symbol:
                symbols.append(symbol)
            if imp:
                self._imports.append(imp)
        
        elif node.type == 'namespace_definition':
            symbol = self._extract_namespace(node, file_path, content, parent)
            body = self._find_child(node, 'declaration_list')
            if symbol:
                symbols.append(symbol)
                if body:
                    for child in body.children:
                        self._extract_from_node(
                            child, file_path, content,
                            symbol.children, parent=symbol.name
                        )
            elif body:
                # Anonymous namespace - still extract contents at current level
                for child in body.children:
                    self._extract_from_node(
                        child, file_path, content,
                        symbols, parent=parent
                    )
        
        elif node.type == 'template_declaration':
            # Extract the templated entity
            for child in node.children:
                if child.type in ('class_specifier', 'struct_specifier', 
                                  'function_definition', 'declaration'):
                    self._extract_from_node(child, file_path, content, symbols, parent)
        
        elif node.type == 'linkage_specification':
            # extern "C" { ... }
            body = self._find_child(node, 'declaration_list')
            if body:
                for child in body.children:
                    self._extract_from_node(child, file_path, content, symbols, parent)
        
        else:
            # Recurse into other node types at module level
            if parent is None:
                for child in node.children:
                    self._extract_from_node(child, file_path, content, symbols, parent)
    
    def _extract_class(
        self, node, file_path: str, content: bytes, parent: Optional[str]
    ) -> Optional[Symbol]:
        """Extract a class definition."""
        name_node = self._find_child(node, 'type_identifier')
        if not name_node:
            return None
        
        name = self._get_node_text(name_node, content)
        
        # Get base classes
        bases = []
        base_clause = self._find_child(node, 'base_class_clause')
        if base_clause:
            for child in base_clause.children:
                if child.type == 'type_identifier':
                    bases.append(self._get_node_text(child, content))
                elif child.type == 'qualified_identifier':
                    bases.append(self._get_node_text(child, content))
        
        return Symbol(
            name=name,
            kind='class',
            file_path=file_path,
            range=self._make_range(node),
            selection_range=self._make_range(name_node),
            parent=parent,
            bases=bases,
        )
    
    def _extract_struct(
        self, node, file_path: str, content: bytes, parent: Optional[str]
    ) -> Optional[Symbol]:
        """Extract a struct definition."""
        name_node = self._find_child(node, 'type_identifier')
        if not name_node:
            return None
        
        name = self._get_node_text(name_node, content)
        
        bases = []
        base_clause = self._find_child(node, 'base_class_clause')
        if base_clause:
            for child in base_clause.children:
                if child.type == 'type_identifier':
                    bases.append(self._get_node_text(child, content))
                elif child.type == 'qualified_identifier':
                    bases.append(self._get_node_text(child, content))
        
        return Symbol(
            name=name,
            kind='class',  # Treat struct as class in symbol map
            file_path=file_path,
            range=self._make_range(node),
            selection_range=self._make_range(name_node),
            parent=parent,
            bases=bases,
        )
    
    def _extract_enum(
        self, node, file_path: str, content: bytes, parent: Optional[str]
    ) -> Optional[Symbol]:
        """Extract an enum definition."""
        name_node = self._find_child(node, 'type_identifier')
        if not name_node:
            return None
        
        name = self._get_node_text(name_node, content)
        
        return Symbol(
            name=name,
            kind='class',  # Treat enum as class-like in symbol map
            file_path=file_path,
            range=self._make_range(node),
            selection_range=self._make_range(name_node),
            parent=parent,
        )
    
    def _extract_namespace(
        self, node, file_path: str, content: bytes, parent: Optional[str]
    ) -> Optional[Symbol]:
        """Extract a namespace definition."""
        name_node = self._find_child(node, 'identifier')
        if not name_node:
            # Try namespace_identifier (used in some tree-sitter-cpp versions)
            name_node = self._find_child(node, 'namespace_identifier')
        if not name_node:
            # Anonymous namespace - still recurse into body
            return None
        
        name = self._get_node_text(name_node, content)
        
        return Symbol(
            name=name,
            kind='class',  # Treat namespace as container
            file_path=file_path,
            range=self._make_range(node),
            selection_range=self._make_range(name_node),
            parent=parent,
        )
    
    def _extract_function(
        self, node, file_path: str, content: bytes, parent: Optional[str]
    ) -> Optional[Symbol]:
        """Extract a function/method definition."""
        declarator = self._find_child(node, 'function_declarator')
        if not declarator:
            return None
        
        # Get function name
        name_node = self._find_function_name(declarator)
        if not name_node:
            return None
        
        name = self._get_node_text(name_node, content)
        
        # Handle qualified names (ClassName::methodName)
        if '::' in name:
            parts = name.split('::')
            name = parts[-1]
            # Could track the class prefix if needed
        
        kind = 'method' if parent else 'function'
        
        # Get parameters
        parameters = []
        params_node = self._find_child(declarator, 'parameter_list')
        if params_node:
            parameters = self._extract_parameters(params_node, content)
        
        # Get return type
        return_type = self._get_return_type(node, content)
        
        calls, call_sites = self._extract_calls_with_context(node, content)
        
        return Symbol(
            name=name,
            kind=kind,
            file_path=file_path,
            range=self._make_range(node),
            selection_range=self._make_range(name_node),
            parent=parent,
            parameters=parameters,
            return_type=return_type,
            calls=calls,
            call_sites=call_sites,
        )
    
    def _find_function_name(self, declarator):
        """Find the function name node in a declarator."""
        for child in declarator.children:
            if child.type == 'identifier':
                return child
            elif child.type == 'qualified_identifier':
                return child
            elif child.type == 'field_identifier':
                return child
            elif child.type == 'destructor_name':
                return child
        return None
    
    def _get_return_type(self, node, content: bytes) -> Optional[str]:
        """Extract return type from function definition."""
        # Return type is typically a type node before the declarator
        for child in node.children:
            if child.type in ('type_identifier', 'primitive_type', 
                             'qualified_identifier', 'template_type'):
                return self._get_node_text(child, content)
            elif child.type == 'placeholder_type_specifier':
                return 'auto'
        return None
    
    def _extract_parameters(self, params_node, content: bytes) -> List[Parameter]:
        """Extract parameters from a parameter list."""
        parameters = []
        
        for child in params_node.children:
            if child.type == 'parameter_declaration':
                param = self._extract_single_parameter(child, content)
                if param:
                    parameters.append(param)
            elif child.type == 'optional_parameter_declaration':
                param = self._extract_single_parameter(child, content)
                if param:
                    # Find default value
                    for c in child.children:
                        if c.type not in ('type_identifier', 'primitive_type',
                                         'identifier', 'reference_declarator',
                                         'pointer_declarator', '='):
                            param.default_value = self._get_node_text(c, content)
                            break
                    parameters.append(param)
            elif child.type == 'variadic_parameter_declaration':
                parameters.append(Parameter(name='...'))
        
        return parameters
    
    def _extract_single_parameter(self, node, content: bytes) -> Optional[Parameter]:
        """Extract a single parameter from a parameter declaration."""
        type_part = None
        name_part = None
        
        for child in node.children:
            if child.type in ('type_identifier', 'primitive_type', 
                             'qualified_identifier', 'template_type'):
                type_part = self._get_node_text(child, content)
            elif child.type == 'identifier':
                name_part = self._get_node_text(child, content)
            elif child.type == 'reference_declarator':
                # int& x or int&& x
                ident = self._find_child(child, 'identifier')
                if ident:
                    name_part = self._get_node_text(ident, content)
            elif child.type == 'pointer_declarator':
                # int* x
                ident = self._find_child(child, 'identifier')
                if ident:
                    name_part = self._get_node_text(ident, content)
        
        if name_part:
            return Parameter(name=name_part, type_annotation=type_part)
        elif type_part:
            # Unnamed parameter
            return Parameter(name=type_part)
        return None
    
    def _extract_declaration(
        self, node, file_path: str, content: bytes, parent: Optional[str]
    ) -> List[Symbol]:
        """Extract symbols from a declaration (variable, function decl, etc)."""
        symbols = []
        
        # Check if it's a function declaration
        declarator = self._find_child(node, 'function_declarator')
        if declarator:
            sym = self._extract_function_declaration(node, declarator, file_path, content, parent)
            if sym:
                symbols.append(sym)
            return symbols
        
        # Otherwise it might be a variable declaration
        declarator = self._find_child(node, 'init_declarator')
        if declarator:
            ident = self._find_child(declarator, 'identifier')
            if ident:
                name = self._get_node_text(ident, content)
                symbols.append(Symbol(
                    name=name,
                    kind='variable',
                    file_path=file_path,
                    range=self._make_range(node),
                    selection_range=self._make_range(ident),
                    parent=parent,
                ))
            return symbols
        
        # Simple variable without initializer
        ident = self._find_child(node, 'identifier')
        if ident:
            name = self._get_node_text(ident, content)
            symbols.append(Symbol(
                name=name,
                kind='variable',
                file_path=file_path,
                range=self._make_range(node),
                selection_range=self._make_range(ident),
                parent=parent,
            ))
        
        return symbols
    
    def _extract_function_declaration(
        self, node, declarator, file_path: str, content: bytes, parent: Optional[str]
    ) -> Optional[Symbol]:
        """Extract a function declaration (prototype)."""
        name_node = self._find_function_name(declarator)
        if not name_node:
            return None
        
        name = self._get_node_text(name_node, content)
        if '::' in name:
            parts = name.split('::')
            name = parts[-1]
        
        kind = 'method' if parent else 'function'
        
        parameters = []
        params_node = self._find_child(declarator, 'parameter_list')
        if params_node:
            parameters = self._extract_parameters(params_node, content)
        
        return_type = self._get_return_type(node, content)
        
        return Symbol(
            name=name,
            kind=kind,
            file_path=file_path,
            range=self._make_range(node),
            selection_range=self._make_range(name_node),
            parent=parent,
            parameters=parameters,
            return_type=return_type,
        )
    
    def _extract_field(
        self, node, file_path: str, content: bytes, parent: Optional[str]
    ) -> List[Symbol]:
        """Extract class/struct field declarations."""
        symbols = []
        
        # Check for method declaration
        declarator = self._find_child(node, 'function_declarator')
        if declarator:
            sym = self._extract_function_declaration(node, declarator, file_path, content, parent)
            if sym:
                symbols.append(sym)
            return symbols
        
        # Regular field
        for child in node.children:
            if child.type == 'field_identifier':
                name = self._get_node_text(child, content)
                symbols.append(Symbol(
                    name=name,
                    kind='property',
                    file_path=file_path,
                    range=self._make_range(node),
                    selection_range=self._make_range(child),
                    parent=parent,
                ))
        
        return symbols
    
    def _extract_include(self, node, file_path: str, content: bytes) -> tuple:
        """Extract #include directive."""
        include_text = self._get_node_text(node, content)
        
        symbol = Symbol(
            name=include_text,
            kind='import',
            file_path=file_path,
            range=self._make_range(node),
            selection_range=self._make_range(node),
        )
        
        # Parse the include path
        path_node = None
        for child in node.children:
            if child.type in ('string_literal', 'system_lib_string'):
                path_node = child
                break
        
        if path_node:
            path = self._get_node_text(path_node, content)
            # Remove quotes or angle brackets
            if path.startswith('"') and path.endswith('"'):
                path = path[1:-1]
            elif path.startswith('<') and path.endswith('>'):
                path = path[1:-1]
            
            imp = Import(
                module=path,
                line=node.start_point[0] + 1,
            )
            return symbol, imp
        
        return symbol, None
    
    def _is_instance_var_assignment(self, node, content: bytes) -> Optional[str]:
        """Check if node is a this->x = ... assignment."""
        if node.type != 'assignment_expression':
            return None
        
        left = node.children[0] if node.children else None
        if not left or left.type != 'field_expression':
            return None
        
        # Check for this->member pattern
        obj = self._find_child(left, 'this')
        if not obj:
            return None
        
        field = self._find_child(left, 'field_identifier')
        if field:
            return self._get_node_text(field, content)
        
        return None
    
    def _get_call_name(self, node, content: bytes) -> Optional[str]:
        """Get the name of a called function/method."""
        if node.type == 'identifier':
            return self._get_node_text(node, content)
        elif node.type == 'qualified_identifier':
            return self._get_node_text(node, content)
        elif node.type == 'field_expression':
            # obj.method or obj->method
            text = self._get_node_text(node, content)
            if self.SELF_PREFIX and text.startswith(self.SELF_PREFIX):
                return text[len(self.SELF_PREFIX):]
            # Return just the method name for now
            field = self._find_child(node, 'field_identifier')
            if field:
                return self._get_node_text(field, content)
        elif node.type == 'template_function':
            # func<T>(...)
            ident = self._find_child(node, 'identifier')
            if ident:
                return self._get_node_text(ident, content)
        return None
