"""Document index — structural extraction for documentation files.

Parallels :mod:`ac_dc.symbol_index` but for documents instead of
code. Supports markdown and SVG via a per-extension extractor
registry. No tree-sitter dependency — markdown uses regex scanning,
SVG uses stdlib :mod:`xml.etree.ElementTree`.

Governing spec: ``specs4/2-indexing/document-index.md``.

Public surface:

- :class:`DocHeading`, :class:`DocLink`, :class:`DocSectionRef`,
  :class:`DocProseBlock`, :class:`DocOutline` — data model
- :class:`DocCache` — mtime-based outline caching with disk
  persistence
- :class:`DocFormatter` — compact map rendering
- :class:`DocReferenceIndex` — cross-document reference graph
- :class:`DocIndex` — orchestrator
- :class:`BaseDocExtractor` and per-format extractors under
  :mod:`ac_dc.doc_index.extractors`

Import design notes:

- Models re-exported eagerly — they are light (dataclasses) and
  used by most consumers of the package.
- Orchestrator and heavier components (cache, formatter, reference
  index) re-exported once the scaffold lands in 2.8.1. Tests import
  directly from submodules until then so partial commits remain
  importable.
"""

from __future__ import annotations

from ac_dc.doc_index.cache import DocCache
from ac_dc.doc_index.formatter import DocFormatter
from ac_dc.doc_index.models import (
    DocHeading,
    DocLink,
    DocOutline,
    DocProseBlock,
    DocSectionRef,
)
from ac_dc.doc_index.reference_index import DocReferenceIndex

__all__ = [
    "DocCache",
    "DocFormatter",
    "DocHeading",
    "DocLink",
    "DocOutline",
    "DocProseBlock",
    "DocReferenceIndex",
    "DocSectionRef",
]