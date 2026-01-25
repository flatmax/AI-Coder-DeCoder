"""JavaScript/TypeScript symbol extractor using tree-sitter."""

from typing import List, Optional
from ..models import Symbol, Range, Parameter
from .base import BaseExtractor


class JavaScriptExtractor(BaseExtractor):
    """Extracts symbols from JavaScript/TypeScript source code."""
    
    def extract_symbols(self, tree, file_path: str, content: bytes) -> List[Symbol]:
        """Extract all symbols from a JS/TS file."""
        symbols = []
        self._extract_from_node(tree.root_node, file_path, content, symbols, parent=None)
        return symbols
    
    def _extract_from_node(
        self, 
        node, 
        file_path: str, 
        content: bytes, 
        symbols: List[Symbol],
        parent: Optional[str] = None
    ):
        """Recursively extract symbols from a node."""
        
        # Class declaration
        if node.type == 'class_declaration':
            symbol = self._extract_class(node, file_path, content, parent)
            if symbol:
                symbols.append(symbol)
                body = self._find_child(node, 'class_body')
                if body:
                    for child in body.children:
                        self._extract_from_node(
                            child, file_path, content,
                            symbol.children, parent=symbol.name
                        )
        
        # Function declaration
        elif node.type in ('function_declaration', 'generator_function_declaration'):
            symbol = self._extract_function(node, file_path, content, parent)
            if symbol:
                symbols.append(symbol)
        
        # Arrow function assigned to variable
        elif node.type == 'lexical_declaration' or node.type == 'variable_declaration':
            for child in node.children:
                if child.type == 'variable_declarator':
                    symbol = self._extract_variable_declarator(child, file_path, content, parent)
                    if symbol:
                        symbols.append(symbol)
        
        # Method definition in class
        elif node.type == 'method_definition':
            symbol = self._extract_method(node, file_path, content, parent)
            if symbol:
                symbols.append(symbol)
        
        # Field definition in class
        elif node.type in ('field_definition', 'public_field_definition'):
            symbol = self._extract_field(node, file_path, content, parent)
            if symbol:
                symbols.append(symbol)
        
        # Import statements
        elif node.type == 'import_statement':
            symbol = self._extract_import(node, file_path, content)
            if symbol:
                symbols.append(symbol)
        
        # Export statements - extract the inner declaration
        elif node.type == 'export_statement':
            for child in node.children:
                self._extract_from_node(child, file_path, content, symbols, parent)
        
        else:
            # Recurse into children at module level
            if parent is None:
                for child in node.children:
                    self._extract_from_node(child, file_path, content, symbols, parent)
    
    def _extract_class(
        self, node, file_path: str, content: bytes, parent: Optional[str]
    ) -> Optional[Symbol]:
        """Extract a class declaration."""
        name_node = self._find_child(node, 'identifier')
        if not name_node:
            return None
        
        name = self._get_node_text(name_node, content)
        
        # Get base class (extends)
        bases = []
        heritage = self._find_child(node, 'class_heritage')
        if heritage:
            for child in heritage.children:
                if child.type == 'identifier':
                    bases.append(self._get_node_text(child, content))
                elif child.type == 'member_expression':
                    bases.append(self._get_node_text(child, content))
        
        # Get instance variables (this.x assignments)
        instance_vars = self._extract_instance_vars(node, content)
        
        return Symbol(
            name=name,
            kind='class',
            file_path=file_path,
            range=self._make_range(node),
            selection_range=self._make_range(name_node),
            parent=parent,
            bases=bases,
            instance_vars=instance_vars,
        )
    
    def _extract_function(
        self, node, file_path: str, content: bytes, parent: Optional[str]
    ) -> Optional[Symbol]:
        """Extract a function declaration."""
        name_node = self._find_child(node, 'identifier')
        if not name_node:
            return None
        
        name = self._get_node_text(name_node, content)
        parameters = self._extract_parameters(node, content)
        return_type = self._get_return_type(node, content)
        calls = self._extract_calls(node, content)
        
        return Symbol(
            name=name,
            kind='function',
            file_path=file_path,
            range=self._make_range(node),
            selection_range=self._make_range(name_node),
            parent=parent,
            parameters=parameters,
            return_type=return_type,
            calls=calls,
        )
    
    def _extract_method(
        self, node, file_path: str, content: bytes, parent: Optional[str]
    ) -> Optional[Symbol]:
        """Extract a method definition."""
        name_node = self._find_child(node, 'property_identifier')
        if not name_node:
            return None
        
        name = self._get_node_text(name_node, content)
        parameters = self._extract_parameters(node, content)
        return_type = self._get_return_type(node, content)
        calls = self._extract_calls(node, content)
        
        # Determine if it's a getter/setter/static
        kind = 'method'
        for child in node.children:
            if child.type == 'get':
                kind = 'property'  # getter
                break
            elif child.type == 'set':
                kind = 'property'  # setter
                break
        
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
        )
    
    def _extract_field(
        self, node, file_path: str, content: bytes, parent: Optional[str]
    ) -> Optional[Symbol]:
        """Extract a class field definition."""
        name_node = self._find_child(node, 'property_identifier')
        if not name_node:
            return None
        
        name = self._get_node_text(name_node, content)
        
        return Symbol(
            name=name,
            kind='property',
            file_path=file_path,
            range=self._make_range(node),
            selection_range=self._make_range(name_node),
            parent=parent,
        )
    
    def _extract_variable_declarator(
        self, node, file_path: str, content: bytes, parent: Optional[str]
    ) -> Optional[Symbol]:
        """Extract a variable declarator (const/let/var)."""
        name_node = self._find_child(node, 'identifier')
        if not name_node:
            return None
        
        name = self._get_node_text(name_node, content)
        
        # Check if it's an arrow function or regular function expression
        value = None
        for child in node.children:
            if child.type in ('arrow_function', 'function'):
                value = child
                break
        
        if value:
            parameters = self._extract_parameters(value, content)
            return_type = self._get_return_type(value, content)
            calls = self._extract_calls(value, content)
            return Symbol(
                name=name,
                kind='function',
                file_path=file_path,
                range=self._make_range(node),
                selection_range=self._make_range(name_node),
                parent=parent,
                parameters=parameters,
                return_type=return_type,
                calls=calls,
            )
        else:
            return Symbol(
                name=name,
                kind='variable',
                file_path=file_path,
                range=self._make_range(node),
                selection_range=self._make_range(name_node),
                parent=parent,
            )
    
    def _extract_import(self, node, file_path: str, content: bytes) -> Optional[Symbol]:
        """Extract an import statement."""
        import_text = self._get_node_text(node, content)
        
        return Symbol(
            name=import_text,
            kind='import',
            file_path=file_path,
            range=self._make_range(node),
            selection_range=self._make_range(node),
        )
    
    def _extract_parameters(self, node, content: bytes) -> List[Parameter]:
        """Extract parameters from a function/method node."""
        parameters = []
        
        params_node = self._find_child(node, 'formal_parameters')
        if not params_node:
            return parameters
        
        for child in params_node.children:
            if child.type == 'identifier':
                parameters.append(Parameter(name=self._get_node_text(child, content)))
            
            elif child.type == 'required_parameter':
                name_node = self._find_child(child, 'identifier')
                type_node = self._find_child(child, 'type_annotation')
                if name_node:
                    param = Parameter(
                        name=self._get_node_text(name_node, content),
                        type_annotation=self._get_node_text(type_node, content) if type_node else None
                    )
                    parameters.append(param)
            
            elif child.type == 'optional_parameter':
                name_node = self._find_child(child, 'identifier')
                type_node = self._find_child(child, 'type_annotation')
                if name_node:
                    param = Parameter(
                        name=self._get_node_text(name_node, content) + '?',
                        type_annotation=self._get_node_text(type_node, content) if type_node else None
                    )
                    parameters.append(param)
            
            elif child.type == 'assignment_pattern':
                name_node = self._find_child(child, 'identifier')
                if name_node:
                    # Get default value
                    default = None
                    for c in child.children:
                        if c.type not in ('identifier', '='):
                            default = self._get_node_text(c, content)
                            break
                    param = Parameter(
                        name=self._get_node_text(name_node, content),
                        default_value=default
                    )
                    parameters.append(param)
            
            elif child.type == 'rest_pattern':
                name_node = self._find_child(child, 'identifier')
                if name_node:
                    parameters.append(Parameter(name='...' + self._get_node_text(name_node, content)))
        
        return parameters
    
    def _extract_instance_vars(self, class_node, content: bytes) -> List[str]:
        """Extract instance variables (this.x = ...) from a class."""
        instance_vars = []
        seen = set()
        
        def walk(node):
            for child in node.children:
                # Look for this.x = ... assignments
                if child.type == 'assignment_expression':
                    left = child.children[0] if child.children else None
                    if left and left.type == 'member_expression':
                        obj = self._find_child(left, 'this')
                        if obj:
                            # Get property name
                            prop = self._find_child(left, 'property_identifier')
                            if prop:
                                var_name = self._get_node_text(prop, content)
                                if var_name not in seen:
                                    seen.add(var_name)
                                    instance_vars.append(var_name)
                walk(child)
        
        walk(class_node)
        return instance_vars
    
    def _extract_calls(self, func_node, content: bytes) -> List[str]:
        """Extract function/method calls from a function body."""
        calls = []
        seen = set()
        
        def walk(node):
            for child in node.children:
                if child.type == 'call_expression':
                    func = child.children[0] if child.children else None
                    if func:
                        call_name = self._get_call_name(func, content)
                        if call_name and call_name not in seen:
                            # Filter out common globals
                            if call_name not in ('console.log', 'console.error', 
                                                 'console.warn', 'JSON.stringify',
                                                 'JSON.parse', 'Object.keys',
                                                 'Object.values', 'Array.isArray'):
                                seen.add(call_name)
                                calls.append(call_name)
                walk(child)
        
        walk(func_node)
        return calls
    
    def _get_call_name(self, node, content: bytes) -> Optional[str]:
        """Get the name of a called function/method."""
        if node.type == 'identifier':
            return self._get_node_text(node, content)
        elif node.type == 'member_expression':
            text = self._get_node_text(node, content)
            # Simplify this.x to just x
            if text.startswith('this.'):
                return text[5:]
            # Keep short forms
            parts = text.split('.')
            if len(parts) <= 2:
                return text
            return '.'.join(parts[-2:])
        return None
    
    def _get_return_type(self, node, content: bytes) -> Optional[str]:
        """Get return type annotation if present."""
        type_node = self._find_child(node, 'type_annotation')
        if type_node:
            return self._get_node_text(type_node, content)
        return None
    
    def _find_child(self, node, type_name: str):
        """Find the first child of a given type."""
        for child in node.children:
            if child.type == type_name:
                return child
        return None
    
    def _make_range(self, node) -> Range:
        """Create a Range from a tree-sitter node."""
        return Range(
            start_line=node.start_point[0] + 1,  # 1-indexed
            start_col=node.start_point[1],
            end_line=node.end_point[0] + 1,
            end_col=node.end_point[1],
        )
