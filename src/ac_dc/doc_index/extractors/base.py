"""Base class for document extractors.

Defines the contract every per-format extractor implements. Deliberately
thin — the base class provides no shared parsing helpers because markdown
and SVG have nothing in common mechanically. Shared infrastructure lives
at the orchestrator level (cache, formatter, reference index).

Per-extractor state across calls is none — extractors are stateless.
The orchestrator constructs one instance per format and reuses it.
"""

from __future__ import annotations

from pathlib import Path

from ac_dc.doc_index.models import DocOutline


class BaseDocExtractor:
    """Abstract base for per-format document extractors.

    Subclasses must override :meth:`extract` to parse the file
    content and return a populated :class:`DocOutline`.

    The :attr:`extension` class attribute identifies the file
    extension(s) this extractor handles. The registry in
    :mod:`ac_dc.doc_index.extractors` uses it to build the
    dispatch table. A subclass handling multiple extensions
    (markdown covers ``.md`` and ``.markdown``) registers under
    each.

    :attr:`supports_enrichment` indicates whether the extractor
    produces content suitable for keyword enrichment. Markdown:
    True (section prose between headings). SVG: True when prose
    blocks are present, False when the file is purely labels —
    but the class-level default doesn't know this, so the
    orchestrator checks per-outline via the outline's contents.
    The flag is a coarse hint; the orchestrator's per-file
    decision is what actually gates enrichment.
    """

    # Overridden by subclasses. Empty string is a sentinel that
    # means "not registered"; callers should never see it.
    extension: str = ""

    # Coarse enrichment hint. SVG extractor leaves this True
    # (because SVG may produce prose blocks) and relies on the
    # orchestrator to skip files with zero prose blocks.
    supports_enrichment: bool = True

    def extract(self, path: Path, content: str) -> DocOutline:
        """Parse the file and return a populated outline.

        Parameters
        ----------
        path:
            Repo-relative path the outline will be keyed by.
            The extractor uses it for :attr:`DocOutline.file_path`
            and — in the future — for doc-type detection via
            path heuristics.
        content:
            Full file content as a single string. The orchestrator
            reads the file once and passes the content; extractors
            don't do their own I/O.

        Returns
        -------
        DocOutline
            Populated with headings, links, doc_type, and
            (SVG only) prose_blocks. The keyword enricher
            (2.8.4) fills in the ``keywords`` fields post hoc;
            extractors leave them as the default empty lists.

        Raises
        ------
        NotImplementedError
            When called on the base class directly. Subclasses
            must override.
        """
        raise NotImplementedError(
            f"{type(self).__name__} must override extract()"
        )

    def __repr__(self) -> str:
        return (
            f"{type(self).__name__}("
            f"extension={self.extension!r})"
        )