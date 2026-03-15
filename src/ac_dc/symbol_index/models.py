"""Data models for the symbol index."""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class CallSite:
    """A function/method call within a symbol body."""
    name: str
    line: int
    is_conditional: bool = False
    target_symbol: Optional[str] = None
    target_file: Optional[str] = None


@dataclass
class Import:
    """An import statement."""
    module: str
    names: list[str] = field(default_factory=list)
    alias: Optional[str] = None
    level: int = 0  # 0 = absolute, 1+ = relative
    line: int = 0


@dataclass
class Parameter:
    """A function/method parameter."""
    name: str
    type_hint: Optional[str] = None
    default: Optional[str] = None
    is_variadic: bool = False  # *args
    is_keyword: bool = False   # **kwargs


@dataclass
class Symbol:
    """A code symbol (class, function, method, variable, property)."""
    name: str
    kind: str  # "class", "function", "method", "variable", "import", "property"
    file_path: str
    range: dict = field(default_factory=lambda: {
        "start_line": 0, "start_col": 0, "end_line": 0, "end_col": 0,
    })
    parameters: list[Parameter] = field(default_factory=list)
    return_type: Optional[str] = None
    bases: list[str] = field(default_factory=list)
    children: list["Symbol"] = field(default_factory=list)
    is_async: bool = False
    call_sites: list[CallSite] = field(default_factory=list)
    instance_vars: list[str] = field(default_factory=list)


@dataclass
class FileSymbols:
    """Parse result for a single file."""
    file_path: str
    symbols: list[Symbol] = field(default_factory=list)  # Top-level only
    imports: list[Import] = field(default_factory=list)

    @property
    def all_symbols_flat(self) -> list[Symbol]:
        """Flattened list including nested children."""
        result = []
        stack = list(self.symbols)
        while stack:
            sym = stack.pop()
            result.append(sym)
            stack.extend(sym.children)
        return result