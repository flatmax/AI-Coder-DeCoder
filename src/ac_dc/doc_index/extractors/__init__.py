"""Per-format document extractors.

Registry of extension → extractor class. Consumers (the
:class:`ac_dc.doc_index.index.DocIndex` orchestrator) dispatch
by file extension; unknown extensions produce no outline.

Registry design matches the symbol index's per-language dispatch
pattern. Instances are constructed once per orchestrator and
reused across files — extractors are stateless across calls.

Currently registered:

- ``.md`` / ``.markdown`` — :class:`MarkdownExtractor`
- ``.svg`` — :class:`SvgExtractor` (2.8.3c minimal baseline;
  containment tree and prose blocks land in 2.8.3d / 2.8.3e)
"""

from __future__ import annotations

from ac_dc.doc_index.extractors.base import BaseDocExtractor
from ac_dc.doc_index.extractors.markdown import MarkdownExtractor
from ac_dc.doc_index.extractors.svg import SvgExtractor

# Extension → extractor class. Extensions are lowercase, dot-
# prefixed — matches the language_for_file convention used by
# the symbol index. Callers normalize before lookup.
EXTRACTORS: dict[str, type[BaseDocExtractor]] = {
    ".md": MarkdownExtractor,
    ".markdown": MarkdownExtractor,
    ".svg": SvgExtractor,
}


__all__ = [
    "BaseDocExtractor",
    "EXTRACTORS",
    "MarkdownExtractor",
    "SvgExtractor",
]