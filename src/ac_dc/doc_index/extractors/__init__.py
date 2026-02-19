"""Per-format document extractors."""

from .markdown_extractor import MarkdownExtractor

EXTRACTORS = {
    '.md': MarkdownExtractor,
}