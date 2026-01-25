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
        
        return Symbol(
            name=name,
            kind='class',
            file_path=file_path,
            range=self._make_range(node),
            selection_range=self._make_range(name_node),
            parent=parent,
            bases=bases,
            docstring=docstring,
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
