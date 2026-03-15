"""Document format extractors."""

from ac_dc.doc_index.extractors.base import BaseDocExtractor
from ac_dc.doc_index.extractors.markdown_extractor import MarkdownExtractor
from ac_dc.doc_index.extractors.svg_extractor import SvgExtractor

# Extension -> Extractor class
EXTRACTORS: dict[str, type[BaseDocExtractor]] = {
    ".md": MarkdownExtractor,
    ".svg": SvgExtractor,
}