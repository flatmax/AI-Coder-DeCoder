"""Symbol index — tree-sitter based code analysis.

Layer 2.1 delivers the parser and data model. Extractors, cache,
formatter, and orchestrator land in subsequent sub-layers.

Governing spec: ``specs4/2-indexing/symbol-index.md``.
"""

from ac_dc.symbol_index.models import (
    CallSite,
    FileSymbols,
    Import,
    Symbol,
)
from ac_dc.symbol_index.parser import (
    LANGUAGE_MAP,
    TreeSitterParser,
    language_for_file,
)

__all__ = [
    "CallSite",
    "FileSymbols",
    "Import",
    "LANGUAGE_MAP",
    "Symbol",
    "TreeSitterParser",
    "language_for_file",
]