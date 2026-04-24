"""Per-format document extractors.

Registry of extension → extractor class. Consumers (the
:class:`ac_dc.doc_index.index.DocIndex` orchestrator) dispatch
by file extension; unknown extensions produce no outline.

Registry design matches the symbol index's per-language dispatch
pattern. Instances are constructed once per orchestrator and
reused across files — extractors are stateless across calls.

Currently registered:

- ``.md`` / ``.markdown`` — :class:`MarkdownExtractor`

SVG (``.svg``) joins in 2.8.3 via a dedicated :class:`SvgExtractor`.
"""

from __future__ import annotations

from ac_dc.doc_index.extractors.base import BaseDocExtractor
from ac_dc.doc_index.extractors.markdown import MarkdownExtractor

# Extension → extractor class. Extensions are lowercase, dot-
# prefixed — matches the language_for_file convention used by
# the symbol index. Callers normalize before lookup.
EXTRACTORS: dict[str, type[BaseDocExtractor]] = {
    ".md": MarkdownExtractor,
    ".markdown": MarkdownExtractor,
}


__all__ = [
    "BaseDocExtractor",
    "EXTRACTORS",
    "MarkdownExtractor",
]