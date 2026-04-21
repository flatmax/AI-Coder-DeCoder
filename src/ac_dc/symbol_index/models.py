"""Data model for the symbol index.

Plain dataclasses — no behaviour, no validation. The extractors,
cache, and formatter all share these shapes. Keeping them
behaviour-free means tests can construct fixtures directly
without coupling to extraction logic.

Governing spec: ``specs4/2-indexing/symbol-index.md#data-model``.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class CallSite:
    """A place where some symbol is referenced from within a function
    or method body.

    The resolver fills ``target_symbol`` and ``target_file`` after
    cross-file analysis. At extraction time only ``name``, ``line``,
    and ``is_conditional`` are populated.
    """

    name: str
    line: int
    is_conditional: bool = False
    target_symbol: str | None = None
    target_file: str | None = None


@dataclass
class Import:
    """An import statement.

    - ``level`` is 0 for absolute imports, 1+ for Python relative
      imports (``from .x import y`` is level 1, ``from ..x import y``
      is level 2, etc.). For non-Python languages it's always 0.
    - ``names`` lists the imported names; empty for a bare
      ``import module`` with no ``from``-clause.
    - ``alias`` is the ``as`` alias when present.
    - ``line`` is 1-indexed (matches tree-sitter's row+1 convention
      for UI consumption).
    """

    module: str
    names: list[str] = field(default_factory=list)
    alias: str | None = None
    level: int = 0
    line: int = 0


@dataclass
class Parameter:
    """A function or method parameter.

    ``default`` is the source text of the default expression when
    present, not the evaluated value — the extractor never executes
    code.
    """

    name: str
    type_annotation: str | None = None
    default: str | None = None
    is_vararg: bool = False  # *args
    is_kwarg: bool = False  # **kwargs


@dataclass
class Symbol:
    """A named code entity.

    ``kind`` is one of: ``"class"``, ``"function"``, ``"method"``,
    ``"variable"``, ``"import"``, ``"property"``. Other kinds may
    be added per-language (e.g. ``"struct"`` for C) — the formatter
    falls back to a generic rendering for unknown kinds.

    ``range`` stores 0-indexed start/end positions matching
    tree-sitter's native convention, not 1-indexed line numbers.
    Callers that present line numbers to users add 1 at the
    boundary.
    """

    name: str
    kind: str
    file_path: str
    # (start_line, start_col, end_line, end_col), 0-indexed.
    range: tuple[int, int, int, int] = (0, 0, 0, 0)
    parameters: list[Parameter] = field(default_factory=list)
    return_type: str | None = None
    bases: list[str] = field(default_factory=list)
    children: list[Symbol] = field(default_factory=list)
    is_async: bool = False
    call_sites: list[CallSite] = field(default_factory=list)
    instance_vars: list[str] = field(default_factory=list)

    @property
    def start_line(self) -> int:
        """Convenience accessor — 0-indexed start line."""
        return self.range[0]


@dataclass
class FileSymbols:
    """Per-file extraction result.

    - ``symbols`` contains top-level symbols only; nested children
      (methods of classes, inner functions) live on their parent's
      ``children`` list.
    - ``imports`` is a flat list of every import statement in the
      file.
    - ``all_symbols_flat`` is a computed convenience — walks the
      tree and returns every symbol including nested children.
    """

    file_path: str
    symbols: list[Symbol] = field(default_factory=list)
    imports: list[Import] = field(default_factory=list)

    @property
    def all_symbols_flat(self) -> list[Symbol]:
        """Depth-first flat list of every symbol in the file."""
        result: list[Symbol] = []

        def _walk(syms: list[Symbol]) -> None:
            for sym in syms:
                result.append(sym)
                if sym.children:
                    _walk(sym.children)

        _walk(self.symbols)
        return result