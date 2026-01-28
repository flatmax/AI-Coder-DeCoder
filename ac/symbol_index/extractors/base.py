"""Base extractor interface."""

from abc import ABC, abstractmethod
from typing import List, Optional, Set
from ..models import Symbol, Range, Import, CallSite


class BaseExtractor(ABC):
    """Abstract base class for language-specific symbol extractors.
    
    Provides common utilities and opt-in helpers for call extraction.
    Subclasses must implement _extract_from_node() for language-specific parsing.
    """
    
    # Override in subclasses for language-specific behavior
    CALL_NODE_TYPE: str = 'call'
    SELF_PREFIX: Optional[str] = None
    CONDITIONAL_TYPES: Set[str] = set()
    BUILTINS_TO_SKIP: Set[str] = set()
    
    def __init__(self):
        self._imports: List[Import] = []
        self._import_map: dict = {}
    
    def extract_symbols(self, tree, file_path: str, content: bytes) -> List[Symbol]:
        """Extract symbols from a parsed tree.
        
        Args:
            tree: tree-sitter Tree object
            file_path: Path to the source file
            content: Raw file content as bytes
            
        Returns:
            List of Symbol objects found in the file
        """
        symbols = []
        self._imports = []
        self._import_map = {}
        self._extract_from_node(tree.root_node, file_path, content, symbols, parent=None)
        return symbols
    
    @abstractmethod
    def _extract_from_node(
        self,
        node,
        file_path: str,
        content: bytes,
        symbols: List[Symbol],
        parent: Optional[str] = None
    ):
        """Language-specific node extraction. Must be implemented by subclasses."""
        pass
    
    def get_imports(self) -> List[Import]:
        """Get structured imports from last extraction."""
        return self._imports
    
    def _get_node_text(self, node, content: bytes) -> str:
        """Get the text content of a node."""
        return content[node.start_byte:node.end_byte].decode('utf-8')
    
    def _find_child(self, node, type_name: str):
        """Find the first child of a given type."""
        for child in node.children:
            if child.type == type_name:
                return child
        return None
    
    def _make_range(self, node) -> Range:
        """Create a Range from a tree-sitter node."""
        return Range(
            start_line=node.start_point[0] + 1,
            start_col=node.start_point[1],
            end_line=node.end_point[0] + 1,
            end_col=node.end_point[1],
        )
    
    def _get_docstring(self, node, content: bytes) -> Optional[str]:
        """Extract docstring from a node if present. Override in subclasses."""
        return None
    
    # --- Opt-in helpers for call extraction ---
    
    def _update_import_map(self, imp: Import):
        """Update import map for call resolution. Override for language-specific behavior."""
        pass
    
    def _extract_calls_with_context(self, func_node, content: bytes) -> tuple:
        """Extract function/method calls with conditional context.
        
        Uses class attributes CALL_NODE_TYPE, CONDITIONAL_TYPES, BUILTINS_TO_SKIP.
        Override _get_call_name() and _resolve_call_target() for language-specific behavior.
        
        Returns:
            Tuple of (calls: List[str], call_sites: List[CallSite])
        """
        calls = []
        call_sites = []
        seen: Set[str] = set()
        
        def walk(node, in_conditional: bool = False):
            is_conditional = node.type in self.CONDITIONAL_TYPES
            current_conditional = in_conditional or is_conditional
            
            for child in node.children:
                if child.type == self.CALL_NODE_TYPE:
                    func = child.children[0] if child.children else None
                    if func:
                        call_name = self._get_call_name(func, content)
                        if call_name and call_name not in self.BUILTINS_TO_SKIP:
                            if call_name not in seen:
                                seen.add(call_name)
                                calls.append(call_name)
                            
                            call_site = CallSite(
                                name=call_name,
                                line=child.start_point[0] + 1,
                                is_conditional=current_conditional,
                            )
                            self._resolve_call_target(call_name, call_site)
                            call_sites.append(call_site)
                
                walk(child, current_conditional)
        
        walk(func_node)
        return calls, call_sites
    
    def _get_call_name(self, node, content: bytes) -> Optional[str]:
        """Get the name of a called function/method.
        
        Handles identifier and attribute/member_expression nodes.
        Override for language-specific behavior.
        """
        if node.type == 'identifier':
            return self._get_node_text(node, content)
        elif node.type in ('attribute', 'member_expression'):
            text = self._get_node_text(node, content)
            if self.SELF_PREFIX and text.startswith(self.SELF_PREFIX):
                return text[len(self.SELF_PREFIX):]
            parts = text.split('.')
            if len(parts) <= 2:
                return text
            return '.'.join(parts[-2:])
        return None
    
    def _resolve_call_target(self, call_name: str, call_site: CallSite):
        """Try to resolve a call to its target module/symbol.
        
        Default uses _import_map. Override for language-specific resolution.
        """
        base = call_name.split('.')[0]
        if base in self._import_map:
            target = self._import_map[base]
            if '.' in call_name:
                rest = call_name[len(base)+1:]
                call_site.target_symbol = f"{target}.{rest}"
            else:
                call_site.target_symbol = target
    
    def _extract_instance_vars(self, class_node, content: bytes) -> List[str]:
        """Extract instance variables from a class.
        
        Walks class looking for self.x/this.x assignments.
        Uses _is_instance_var_assignment() for language-specific matching.
        """
        instance_vars = []
        seen = set()
        
        def walk(node):
            var_name = self._is_instance_var_assignment(node, content)
            if var_name and var_name not in seen:
                seen.add(var_name)
                instance_vars.append(var_name)
            for child in node.children:
                walk(child)
        
        walk(class_node)
        return instance_vars
    
    def _is_instance_var_assignment(self, node, content: bytes) -> Optional[str]:
        """Check if node is an instance variable assignment.
        
        Returns variable name if so, None otherwise.
        Override for language-specific behavior.
        """
        return None
