"""Data models for symbol indexing."""

from dataclasses import dataclass, field
from typing import Optional, List


@dataclass
class Import:
    """Resolved import information."""
    module: str                              # "foo.bar" or "os"
    names: List[str] = field(default_factory=list)  # ["baz", "qux"] for 'from' imports
    aliases: dict = field(default_factory=dict)     # {"qux": "q"} for 'as' aliases
    resolved_file: Optional[str] = None      # Relative path if in-repo
    line: int = 0
    level: int = 0                           # Relative import level (1 = ., 2 = .., etc)
    
    def to_dict(self) -> dict:
        result = {'module': self.module, 'line': self.line}
        if self.names:
            result['names'] = self.names
        if self.aliases:
            result['aliases'] = self.aliases
        if self.resolved_file:
            result['resolvedFile'] = self.resolved_file
        return result


@dataclass
class CallSite:
    """A function/method call with resolution info."""
    name: str                                # Called name as written
    target_file: Optional[str] = None        # Resolved target file (if in-repo)
    target_symbol: Optional[str] = None      # Resolved symbol name
    line: int = 0
    is_conditional: bool = False             # Inside if/try/loop
    
    def to_dict(self) -> dict:
        result = {'name': self.name, 'line': self.line}
        if self.target_file:
            result['targetFile'] = self.target_file
        if self.target_symbol:
            result['targetSymbol'] = self.target_symbol
        if self.is_conditional:
            result['conditional'] = True
        return result


@dataclass
class Range:
    """Source code range with line and column positions."""
    start_line: int
    start_col: int
    end_line: int
    end_col: int
    
    def to_dict(self) -> dict:
        return {
            'start': {'line': self.start_line, 'col': self.start_col},
            'end': {'line': self.end_line, 'col': self.end_col}
        }


@dataclass
class Parameter:
    """Function/method parameter."""
    name: str
    type_annotation: Optional[str] = None
    default_value: Optional[str] = None
    
    def to_dict(self) -> dict:
        result = {'name': self.name}
        if self.type_annotation:
            result['type'] = self.type_annotation
        if self.default_value:
            result['default'] = self.default_value
        return result


@dataclass
class Symbol:
    """Represents a code symbol (class, function, method, variable, etc.)."""
    name: str
    kind: str  # class, method, function, variable, import, property
    file_path: str
    range: Range  # full extent of the symbol
    selection_range: Range  # just the name part
    parent: Optional[str] = None  # parent symbol name
    children: List['Symbol'] = field(default_factory=list)
    parameters: List[Parameter] = field(default_factory=list)
    return_type: Optional[str] = None
    bases: List[str] = field(default_factory=list)  # for classes
    docstring: Optional[str] = None
    # Instance variables (self.x assignments for classes)
    instance_vars: List[str] = field(default_factory=list)
    # Function/method calls made within this symbol (simple names for backward compat)
    calls: List[str] = field(default_factory=list)
    # Rich call information with resolution
    call_sites: List[CallSite] = field(default_factory=list)
    # For inherited methods, which parent class it comes from
    inherited_from: Optional[str] = None
    
    def to_dict(self) -> dict:
        result = {
            'name': self.name,
            'kind': self.kind,
            'range': self.range.to_dict(),
            'selectionRange': self.selection_range.to_dict(),
        }
        if self.parent:
            result['parent'] = self.parent
        if self.children:
            result['children'] = [c.to_dict() for c in self.children]
        if self.parameters:
            result['parameters'] = [p.to_dict() for p in self.parameters]
        if self.return_type:
            result['returnType'] = self.return_type
        if self.bases:
            result['bases'] = self.bases
        if self.docstring:
            result['docstring'] = self.docstring
        if self.instance_vars:
            result['instanceVars'] = self.instance_vars
        if self.calls:
            result['calls'] = self.calls
        if self.call_sites:
            result['callSites'] = [c.to_dict() for c in self.call_sites]
        if self.inherited_from:
            result['inheritedFrom'] = self.inherited_from
        return result
