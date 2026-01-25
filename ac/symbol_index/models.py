"""Data models for symbol indexing."""

from dataclasses import dataclass, field
from typing import Optional, List


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
    # Function/method calls made within this symbol
    calls: List[str] = field(default_factory=list)
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
        if self.inherited_from:
            result['inheritedFrom'] = self.inherited_from
        return result
