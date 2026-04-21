"""Language-specific symbol extractors.

Each extractor walks a tree-sitter AST for one language and
produces a :class:`ac_dc.symbol_index.models.FileSymbols`. The
base class handles plumbing (text decoding, range extraction,
tree traversal); subclasses handle language-specific node types.

Layer 2.2 delivers the Python / JS / TS / C / C++ extractors.
MATLAB is deferred — it has no maintained tree-sitter grammar and
would use the ``tree_optional = True`` regex-based fallback.

Governing spec: ``specs4/2-indexing/symbol-index.md#per-language-extractors``.
"""

from ac_dc.symbol_index.extractors.base import BaseExtractor

__all__ = ["BaseExtractor"]