"""Python symbol extractor using tree-sitter."""

from typing import List, Optional, Set
from ..models import Symbol, Parameter, Import, CallSite
from .base import BaseExtractor


class PythonExtractor(BaseExtractor):
    """Extracts symbols from Python source code."""
    
    def __init__(self):
        super().__init__()
        self._import_map: dict = {}  # name -> module for resolution
    
    def extract_symbols(self, tree, file_path: str, content: bytes) -> List[Symbol]:
        """Extract all symbols from a Python file."""
        symbols = []
        self._imports = []
        self._import_map = {}
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
        
        elif node.type == 'import_statement':
            symbol, imp = self._extract_import_statement(node, file_path, content)
            if symbol:
                symbols.append(symbol)
            if imp:
                self._imports.append(imp)
                self._update_import_map(imp)
        
        elif node.type == 'import_from_statement':
            symbol, imp = self._extract_import_from_statement(node, file_path, content)
            if symbol:
                symbols.append(symbol)
            if imp:
                self._imports.append(imp)
                self._update_import_map(imp)
        
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
            docstring=docstring,
            calls=calls,
            call_sites=call_sites,
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
    
    def _extract_import_statement(self, node, file_path: str, content: bytes) -> tuple:
        """Extract 'import x' or 'import x as y' statement."""
        import_text = self._get_node_text(node, content)
        
        symbol = Symbol(
            name=import_text,
            kind='import',
            file_path=file_path,
            range=self._make_range(node),
            selection_range=self._make_range(node),
        )
        
        # Parse the import
        modules = []
        aliases = {}
        
        for child in node.children:
            if child.type == 'dotted_name':
                modules.append(self._get_node_text(child, content))
            elif child.type == 'aliased_import':
                name_node = self._find_child(child, 'dotted_name')
                alias_node = self._find_child(child, 'identifier')
                if name_node:
                    mod_name = self._get_node_text(name_node, content)
                    modules.append(mod_name)
                    if alias_node:
                        aliases[mod_name] = self._get_node_text(alias_node, content)
        
        # Create Import for each module
        imp = None
        if modules:
            imp = Import(
                module=modules[0],
                aliases=aliases,
                line=node.start_point[0] + 1
            )
        
        return symbol, imp
    
    def _extract_import_from_statement(self, node, file_path: str, content: bytes) -> tuple:
        """Extract 'from x import y' statement."""
        import_text = self._get_node_text(node, content)
        
        symbol = Symbol(
            name=import_text,
            kind='import',
            file_path=file_path,
            range=self._make_range(node),
            selection_range=self._make_range(node),
        )
        
        # Parse the from import
        module = None
        names = []
        aliases = {}
        level = 0  # For relative imports
        
        # Track whether we've seen 'import' keyword to know if identifiers are names
        seen_import_keyword = False
        
        for child in node.children:
            if child.type == 'dotted_name' and not seen_import_keyword:
                # Module name before 'import' keyword
                module = self._get_node_text(child, content)
            elif child.type == 'relative_import':
                # Handle relative imports like "from ..foo import bar"
                for sub in child.children:
                    if sub.type == 'import_prefix':
                        prefix = self._get_node_text(sub, content)
                        level = len(prefix)
                    elif sub.type == 'dotted_name':
                        module = self._get_node_text(sub, content)
            elif child.type == 'import':
                # The 'import' keyword - names come after this
                seen_import_keyword = True
            elif seen_import_keyword and child.type == 'dotted_name':
                # Handle imported name like 'foo.bar' after 'import' keyword
                names.append(self._get_node_text(child, content))
            elif child.type == 'identifier' and seen_import_keyword:
                # Imported name (after 'import' keyword)
                names.append(self._get_node_text(child, content))
            elif child.type == 'aliased_import':
                name_node = self._find_child(child, 'identifier')
                if name_node:
                    name = self._get_node_text(name_node, content)
                    names.append(name)
                    # Find alias (second identifier)
                    idents = [c for c in child.children if c.type == 'identifier']
                    if len(idents) >= 2:
                        aliases[name] = self._get_node_text(idents[1], content)
        
        imp = Import(
            module=module or '',
            names=names,
            aliases=aliases,
            line=node.start_point[0] + 1,
            level=level,
        )
        
        return symbol, imp
    
    def _update_import_map(self, imp: Import):
        """Update the import map for call resolution."""
        if imp.names:
            # from foo import bar -> bar maps to foo.bar
            for name in imp.names:
                alias = imp.aliases.get(name, name)
                self._import_map[alias] = f"{imp.module}.{name}" if imp.module else name
        else:
            # import foo or import foo as bar
            module_name = imp.module.split('.')[0]
            alias = imp.aliases.get(imp.module, module_name)
            self._import_map[alias] = imp.module
    
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
    
    def _extract_calls_with_context(self, func_node, content: bytes) -> tuple:
        """Extract function/method calls with conditional context.
        
        Returns:
            Tuple of (calls: List[str], call_sites: List[CallSite])
        """
        calls = []
        call_sites = []
        seen: Set[str] = set()
        
        # Track conditional depth
        conditional_types = {
            'if_statement', 'elif_clause', 'else_clause',
            'try_statement', 'except_clause', 'finally_clause',
            'for_statement', 'while_statement',
            'with_statement',
            'conditional_expression',  # ternary
        }
        
        builtins = {
            'print', 'len', 'str', 'int', 'list', 'dict', 'set', 
            'tuple', 'bool', 'range', 'enumerate', 'zip', 'map', 
            'filter', 'isinstance', 'hasattr', 'getattr', 'setattr',
            'open', 'type', 'super', 'sorted', 'reversed', 'any', 'all',
            'min', 'max', 'sum', 'abs', 'round', 'format', 'repr',
        }
        
        def walk(node, in_conditional: bool = False):
            # Check if entering a conditional context
            is_conditional = node.type in conditional_types
            current_conditional = in_conditional or is_conditional
            
            for child in node.children:
                if child.type == 'call':
                    func = child.children[0] if child.children else None
                    if func:
                        call_name = self._get_call_name(func, content)
                        if call_name and call_name not in builtins:
                            # Add to simple calls list (deduped)
                            if call_name not in seen:
                                seen.add(call_name)
                                calls.append(call_name)
                            
                            # Create CallSite with context
                            call_site = CallSite(
                                name=call_name,
                                line=child.start_point[0] + 1,
                                is_conditional=current_conditional,
                            )
                            
                            # Try to resolve target
                            self._resolve_call_target(call_name, call_site)
                            call_sites.append(call_site)
                
                walk(child, current_conditional)
        
        walk(func_node)
        return calls, call_sites
    
    def _resolve_call_target(self, call_name: str, call_site: CallSite):
        """Try to resolve a call to its target module/symbol."""
        # Check if it's an imported name
        if call_name in self._import_map:
            full_path = self._import_map[call_name]
            parts = full_path.rsplit('.', 1)
            if len(parts) == 2:
                call_site.target_symbol = parts[1]
                # Module path would need resolver to get file
            else:
                call_site.target_symbol = parts[0]
        
        # Handle attribute access like foo.bar()
        elif '.' in call_name:
            parts = call_name.split('.')
            base = parts[0]
            if base in self._import_map:
                full_path = self._import_map[base]
                call_site.target_symbol = '.'.join([full_path] + parts[1:])
    
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
    
