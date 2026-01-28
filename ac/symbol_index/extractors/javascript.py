"""JavaScript/TypeScript symbol extractor using tree-sitter."""

from typing import List, Optional, Set
from ..models import Symbol, Parameter, Import, CallSite
from .base import BaseExtractor


class JavaScriptExtractor(BaseExtractor):
    """Extracts symbols from JavaScript/TypeScript source code."""
    
    CALL_NODE_TYPE = 'call_expression'
    SELF_PREFIX = 'this.'
    CONDITIONAL_TYPES = {
        'if_statement', 'else_clause',
        'try_statement', 'catch_clause', 'finally_clause',
        'for_statement', 'for_in_statement', 'for_of_statement',
        'while_statement', 'do_statement',
        'switch_statement', 'switch_case',
        'ternary_expression', 'conditional_expression',
    }
    BUILTINS_TO_SKIP = {
        'console.log', 'console.error', 'console.warn', 'console.info',
        'JSON.stringify', 'JSON.parse',
        'Object.keys', 'Object.values', 'Object.entries', 'Object.assign',
        'Array.isArray', 'Array.from',
        'Promise.resolve', 'Promise.reject', 'Promise.all',
        'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
        'parseInt', 'parseFloat', 'isNaN', 'isFinite',
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
            symbol, imp = self._extract_import(node, file_path, content)
            if symbol:
                symbols.append(symbol)
            if imp:
                self._imports.append(imp)
                self._update_import_map(imp)
        
        # Export statements - extract the inner declaration
        elif node.type == 'export_statement':
            for child in node.children:
                self._extract_from_node(child, file_path, content, symbols, parent)
        
        else:
            # Recurse into children at module level
            if parent is None:
                for child in node.children:
                    self._extract_from_node(child, file_path, content, symbols, parent)
    
    def _is_instance_var_assignment(self, node, content: bytes) -> Optional[str]:
        """Check if node is a this.x = ... assignment."""
        if node.type != 'assignment_expression':
            return None
        left = node.children[0] if node.children else None
        if not left or left.type != 'member_expression':
            return None
        if not self._find_child(left, 'this'):
            return None
        prop = self._find_child(left, 'property_identifier')
        return self._get_node_text(prop, content) if prop else None
    
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
        
        return Symbol(
            name=name,
            kind='class',
            file_path=file_path,
            range=self._make_range(node),
            selection_range=self._make_range(name_node),
            parent=parent,
            bases=bases,
            instance_vars=self._extract_instance_vars(node, content),
        )
    
    def _extract_function(
        self, node, file_path: str, content: bytes, parent: Optional[str]
    ) -> Optional[Symbol]:
        """Extract a function declaration."""
        name_node = self._find_child(node, 'identifier')
        if not name_node:
            return None
        
        name = self._get_node_text(name_node, content)
        calls, call_sites = self._extract_calls_with_context(node, content)
        
        parameters = self._extract_parameters(node, content)
        return_type = self._get_return_type(node, content)
        
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
            call_sites=call_sites,
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
        calls, call_sites = self._extract_calls_with_context(node, content)
        
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
            call_sites=call_sites,
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
            calls, call_sites = self._extract_calls_with_context(value, content)
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
                call_sites=call_sites,
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
    
    def _extract_import(self, node, file_path: str, content: bytes) -> tuple:
        """Extract an import statement with structured info."""
        import_text = self._get_node_text(node, content)
        
        symbol = Symbol(
            name=import_text,
            kind='import',
            file_path=file_path,
            range=self._make_range(node),
            selection_range=self._make_range(node),
        )
        
        # Parse import structure
        module = None
        names = []
        aliases = {}
        
        for child in node.children:
            if child.type == 'string':
                # Remove quotes
                module = self._get_node_text(child, content).strip('"\'')
            elif child.type == 'import_clause':
                self._parse_import_clause(child, content, names, aliases)
        
        imp = None
        if module:
            imp = Import(
                module=module,
                names=names,
                aliases=aliases,
                line=node.start_point[0] + 1
            )
        
        return symbol, imp
    
    def _parse_import_clause(self, node, content: bytes, names: list, aliases: dict):
        """Parse import clause to extract names and aliases."""
        for child in node.children:
            if child.type == 'identifier':
                # Default import
                names.append(self._get_node_text(child, content))
            elif child.type == 'named_imports':
                for spec in child.children:
                    if spec.type == 'import_specifier':
                        name = None
                        alias = None
                        for part in spec.children:
                            if part.type == 'identifier':
                                if name is None:
                                    name = self._get_node_text(part, content)
                                else:
                                    alias = self._get_node_text(part, content)
                        if name:
                            names.append(name)
                            if alias:
                                aliases[name] = alias
            elif child.type == 'namespace_import':
                # import * as foo
                for part in child.children:
                    if part.type == 'identifier':
                        alias = self._get_node_text(part, content)
                        names.append('*')
                        aliases['*'] = alias
    
    def _update_import_map(self, imp: Import):
        """Update the import map for call resolution."""
        for name in imp.names:
            alias = imp.aliases.get(name, name)
            if name == '*':
                self._import_map[alias] = imp.module
            else:
                self._import_map[alias] = f"{imp.module}:{name}"
    
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
    
    def _get_return_type(self, node, content: bytes) -> Optional[str]:
        """Get return type annotation if present."""
        type_node = self._find_child(node, 'type_annotation')
        if type_node:
            return self._get_node_text(type_node, content)
        return None
    
