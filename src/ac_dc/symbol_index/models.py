"""Data models for symbol extraction."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class SymbolKind(Enum):
    CLASS = "class"
    FUNCTION = "function"
    METHOD = "method"
    VARIABLE = "variable"
    IMPORT = "import"
    PROPERTY = "property"


@dataclass
class SymbolRange:
    """Source location range."""
    start_line: int
    start_col: int
    end_line: int
    end_col: int


@dataclass
class Parameter:
    """Function/method parameter."""
    name: str
    type_annotation: Optional[str] = None
    default: Optional[str] = None
    is_variadic: bool = False       # *args
    is_keyword: bool = False        # **kwargs


@dataclass
class CallSite:
    """A resolved function/method call."""
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
class Symbol:
    """A code symbol (class, function, method, variable, etc.)."""
    name: str
    kind: SymbolKind
    file_path: str
    range: SymbolRange
    parameters: list[Parameter] = field(default_factory=list)
    return_type: Optional[str] = None
    bases: list[str] = field(default_factory=list)
    children: list["Symbol"] = field(default_factory=list)
    is_async: bool = False
    call_sites: list[CallSite] = field(default_factory=list)
    instance_vars: list[str] = field(default_factory=list)
    is_optional_return: bool = False

    @property
    def dotted_name(self) -> str:
        """Return fully qualified name for matching."""
        return self.name

    @property
    def signature(self) -> str:
        """Stable signature for hashing — name + kind + params + return."""
        params = ",".join(p.name for p in self.parameters)
        ret = f"->{self.return_type}" if self.return_type else ""
        bases = f"({','.join(self.bases)})" if self.bases else ""
        async_prefix = "async " if self.is_async else ""
        return f"{async_prefix}{self.kind.value} {self.name}{bases}({params}){ret}"


@dataclass
class FileSymbols:
    """All symbols extracted from a single file."""
    file_path: str
    symbols: list[Symbol] = field(default_factory=list)
    imports: list[Import] = field(default_factory=list)
    language: str = ""
    parse_error: Optional[str] = None

    @property
    def all_symbols_flat(self) -> list[Symbol]:
        """Return all symbols including nested children."""
        result = []
        for sym in self.symbols:
            result.append(sym)
            result.extend(self._flatten(sym))
        return result

    def _flatten(self, sym: Symbol) -> list[Symbol]:
        result = []
        for child in sym.children:
            result.append(child)
            result.extend(self._flatten(child))
        return result
