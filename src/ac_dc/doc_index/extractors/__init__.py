"""Per-format document extractors."""

from .markdown_extractor import MarkdownExtractor
from .svg_extractor import SvgExtractor

EXTRACTORS = {
    '.md': MarkdownExtractor,
    '.svg': SvgExtractor,
}