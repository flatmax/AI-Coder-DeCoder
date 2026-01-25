"""Python symbol extractor using tree-sitter."""

from typing import List, Optional
from ..models import Symbol, Range, Parameter
from .base import BaseExtractor


class PythonExtractor(BaseExtractor):
    """Extracts symbols from Python source code."""
    
    def extract_symbols(self, tree, file_path: str, content: bytes) -> List[Symbol]:
        """Extract all symbols from a Python file."""
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
        
        if node.type == 'class_definition':
            symbol = self._extract_class(node, file_path, content, parent)
            if symbol:
                symbols.append(symbol)
                # Extract children (methods, nested classes)
                body = self._find_child(node, 'block')
                if body:
                    for child in body.children:
                        self._extract_from_node(
                            child, file_path, content, 
                            symbol.children, parent=symbol.name
                        )
        
        elif node.type == 'function_definition':
            symbol = self._extract_function(node, file_path, content, parent)
            if symbol:
                symbols.append(symbol)
        
        elif node.type == 'import_statement' or node.type == 'import_from_statement':
            symbol = self._extract_import(node, file_path, content)
            if symbol:
                symbols.append(symbol)
        
        elif node.type == 'expression_statement':
            # Check for module-level assignments (variables/constants)
            if parent is None:  # Only at module level
                assign = self._find_child(node, 'assignment')
                if assign:
                    symbol = self._extract_assignment(assign, file_path, content, parent)
                    if symbol:
                        symbols.append(symbol)
        
        elif node.type == 'assignment':
            # Class-level or module-level assignments
            if parent is not None:  # Class attribute
                symbol = self._extract_assignment(node, file_path, content, parent)
                if symbol:
                    symbol.kind = 'property'
                    symbols.append(symbol)
        
        else:
            # Recurse into other node types at module level
            if parent is None:
                for child in node.children:
                    self._extract_from_node(child, file_path, content, symbols, parent)
    
    def _extract_class(
        self, node, file_path: str, content: bytes, parent: Optional[str]
    ) -> Optional[Symbol]:
        """Extract a class definition."""
        name_node = self._find_child(node, 'identifier')
        if not name_node:
            return None
        
        name = self._get_node_text(name_node, content)
        
        # Get base classes
        bases = []
        arg_list = self._find_child(node, 'argument_list')
        if arg_list:
            for child in arg_list.children:
                if child.type == 'identifier':
                    bases.append(self._get_node_text(child, content))
                elif child.type == 'attribute':
                    bases.append(self._get_node_text(child, content))
        
        # Get docstring
        docstring = self._get_class_docstring(node, content)
        
        # Get instance variables
        instance_vars = self._extract_instance_vars(node, content)
        
        return Symbol(
            name=name,
            kind='class',
            file_path=file_path,
            range=self._make_range(node),
            selection_range=self._make_range(name_node),
            parent=parent,
            bases=bases,
            docstring=docstring,
            instance_vars=instance_vars,
        )
    
    def _extract_function(
        self, node, file_path: str, content: bytes, parent: Optional[str]
    ) -> Optional[Symbol]:
        """Extract a function/method definition."""
        name_node = self._find_child(node, 'identifier')
        if not name_node:
            return None
        
        name = self._get_node_text(name_node, content)
        kind = 'method' if parent else 'function'
        
        # Get parameters
        parameters = []
        params_node = self._find_child(node, 'parameters')
        if params_node:
            parameters = self._extract_parameters(params_node, content)
        
        # Get return type
        return_type = None
        ret_node = self._find_child(node, 'type')
        if ret_node:
            return_type = self._get_node_text(ret_node, content)
        
        # Get docstring
        docstring = self._get_function_docstring(node, content)
        
        # Get calls made by this function
        calls = self._extract_calls(node, content)
        
        return Symbol(
            name=name,
            kind=kind,
            file_path=file_path,
            range=self._make_range(node),
            selection_range=self._make_range(name_node),
            parent=parent,
            parameters=parameters,
            return_type=return_type,
            docstring=docstring,
            calls=calls,
        )
    
    def _extract_parameters(self, params_node, content: bytes) -> List[Parameter]:
        """Extract parameters from a parameters node."""
        parameters = []
        
        for child in params_node.children:
            if child.type == 'identifier':
                parameters.append(Parameter(name=self._get_node_text(child, content)))
            
            elif child.type == 'typed_parameter':
                name_node = self._find_child(child, 'identifier')
                type_node = self._find_child(child, 'type')
                if name_node:
                    param = Parameter(
                        name=self._get_node_text(name_node, content),
                        type_annotation=self._get_node_text(type_node, content) if type_node else None
                    )
                    parameters.append(param)
            
            elif child.type == 'default_parameter':
                name_node = self._find_child(child, 'identifier')
                if name_node:
                    # Find default value (last non-punctuation child)
                    default = None
                    for c in reversed(child.children):
                        if c.type not in ('identifier', '=', 'type'):
                            default = self._get_node_text(c, content)
                            break
                    param = Parameter(
                        name=self._get_node_text(name_node, content),
                        default_value=default
                    )
                    parameters.append(param)
            
            elif child.type == 'typed_default_parameter':
                name_node = self._find_child(child, 'identifier')
                type_node = self._find_child(child, 'type')
                if name_node:
                    default = None
                    for c in reversed(child.children):
                        if c.type not in ('identifier', '=', 'type', ':'):
                            default = self._get_node_text(c, content)
                            break
                    param = Parameter(
                        name=self._get_node_text(name_node, content),
                        type_annotation=self._get_node_text(type_node, content) if type_node else None,
                        default_value=default
                    )
                    parameters.append(param)
            
            elif child.type == 'list_splat_pattern':
                name_node = self._find_child(child, 'identifier')
                if name_node:
                    parameters.append(Parameter(name='*' + self._get_node_text(name_node, content)))
            
            elif child.type == 'dictionary_splat_pattern':
                name_node = self._find_child(child, 'identifier')
                if name_node:
                    parameters.append(Parameter(name='**' + self._get_node_text(name_node, content)))
        
        return parameters
    
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
    
    def _extract_assignment(
        self, node, file_path: str, content: bytes, parent: Optional[str]
    ) -> Optional[Symbol]:
        """Extract a variable assignment."""
        # Get the left side (variable name)
        left = node.children[0] if node.children else None
        if not left:
            return None
        
        if left.type == 'identifier':
            name = self._get_node_text(left, content)
            return Symbol(
                name=name,
                kind='variable',
                file_path=file_path,
                range=self._make_range(node),
                selection_range=self._make_range(left),
                parent=parent,
            )
        
        return None
    
    def _get_class_docstring(self, node, content: bytes) -> Optional[str]:
        """Extract docstring from a class definition."""
        body = self._find_child(node, 'block')
        return self._get_block_docstring(body, content) if body else None
    
    def _get_function_docstring(self, node, content: bytes) -> Optional[str]:
        """Extract docstring from a function definition."""
        body = self._find_child(node, 'block')
        return self._get_block_docstring(body, content) if body else None
    
    def _get_block_docstring(self, block, content: bytes) -> Optional[str]:
        """Extract docstring from a block (first expression if it's a string)."""
        if not block:
            return None
        
        for child in block.children:
            if child.type == 'expression_statement':
                expr = child.children[0] if child.children else None
                if expr and expr.type == 'string':
                    docstring = self._get_node_text(expr, content)
                    # Remove quotes
                    if docstring.startswith('"""') or docstring.startswith("'''"):
                        return docstring[3:-3].strip()
                    elif docstring.startswith('"') or docstring.startswith("'"):
                        return docstring[1:-1].strip()
                break  # Only check first statement
        
        return None
    
    def _extract_instance_vars(self, class_node, content: bytes) -> List[str]:
        """Extract instance variables (self.x = ...) from a class."""
        instance_vars = []
        seen = set()
        
        # Walk all nodes in the class looking for self.x assignments
        def walk(node):
            for child in node.children:
                if child.type == 'assignment':
                    left = child.children[0] if child.children else None
                    if left and left.type == 'attribute':
                        # Check for self.x pattern
                        obj = self._find_child(left, 'identifier')
                        attr = self._find_attr_name(left)
                        if obj and attr:
                            obj_name = self._get_node_text(obj, content)
                            if obj_name == 'self' and attr not in seen:
                                seen.add(attr)
                                instance_vars.append(attr)
                walk(child)
        
        walk(class_node)
        return instance_vars
    
    def _find_attr_name(self, attr_node) -> Optional[str]:
        """Get the attribute name from an attribute node (self.x -> x)."""
        for child in attr_node.children:
            if child.type == 'identifier':
                # Skip 'self', get the attribute name
                continue
            if child.type == 'identifier':
                return None
        # The attribute name is the last identifier after the dot
        identifiers = [c for c in attr_node.children if c.type == 'identifier']
        if len(identifiers) >= 2:
            return identifiers[-1].text.decode('utf-8') if identifiers[-1].text else None
        return None
    
    def _extract_calls(self, func_node, content: bytes) -> List[str]:
        """Extract function/method calls from a function body."""
        calls = []
        seen = set()
        
        def walk(node):
            for child in node.children:
                if child.type == 'call':
                    func = child.children[0] if child.children else None
                    if func:
                        call_name = self._get_call_name(func, content)
                        if call_name and call_name not in seen:
                            # Filter out common builtins to reduce noise
                            if call_name not in ('print', 'len', 'str', 'int', 'list', 
                                                 'dict', 'set', 'tuple', 'bool', 'range',
                                                 'enumerate', 'zip', 'map', 'filter',
                                                 'isinstance', 'hasattr', 'getattr', 'setattr'):
                                seen.add(call_name)
                                calls.append(call_name)
                walk(child)
        
        walk(func_node)
        return calls
    
    def _get_call_name(self, node, content: bytes) -> Optional[str]:
        """Get the name of a called function/method."""
        if node.type == 'identifier':
            return self._get_node_text(node, content)
        elif node.type == 'attribute':
            # Get the full attribute chain (e.g., self.foo, obj.method)
            text = self._get_node_text(node, content)
            # Simplify self.x to just x
            if text.startswith('self.'):
                return text[5:]
            # For other objects, keep short form (last part)
            parts = text.split('.')
            if len(parts) <= 2:
                return text
            # For long chains, keep last 2 parts
            return '.'.join(parts[-2:])
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
