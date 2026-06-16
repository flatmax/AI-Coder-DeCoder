"""Language-specific symbol extractors.

Each extractor walks a tree-sitter AST for one language and
produces a :class:`ac_dc.symbol_index.models.FileSymbols`. The
base class handles plumbing (text decoding, range extraction,
tree traversal); subclasses handle language-specific node types.

Layer 2.2 is complete — Python, JavaScript, TypeScript, C, C++
all have working tree-sitter extractors with comprehensive test
suites. MATLAB has no maintained tree-sitter grammar and uses
the ``tree_optional = True`` regex-based fallback
(:class:`MatlabExtractor`); its extension is resolved via the
parser's tree-optional extension map rather than
``LANGUAGE_MAP``.

Governing spec: ``specs4/2-indexing/symbol-index.md#per-language-extractors``.
"""

from ac_dc.symbol_index.extractors.base import BaseExtractor
from ac_dc.symbol_index.extractors.c import CExtractor
from ac_dc.symbol_index.extractors.cpp import CppExtractor
from ac_dc.symbol_index.extractors.javascript import JavaScriptExtractor
from ac_dc.symbol_index.extractors.matlab import MatlabExtractor
from ac_dc.symbol_index.extractors.python import PythonExtractor
from ac_dc.symbol_index.extractors.typescript import TypeScriptExtractor

__all__ = [
    "BaseExtractor",
    "CExtractor",
    "CppExtractor",
    "JavaScriptExtractor",
    "MatlabExtractor",
    "PythonExtractor",
    "TypeScriptExtractor",
]