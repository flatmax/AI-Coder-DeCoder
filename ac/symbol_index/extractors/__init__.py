"""Symbol extractors for different languages."""

from .base import BaseExtractor
from .python import PythonExtractor
from .javascript import JavaScriptExtractor

__all__ = ['BaseExtractor', 'PythonExtractor', 'JavaScriptExtractor', 'get_extractor']


def get_extractor(language: str) -> BaseExtractor:
    """Get the appropriate extractor for a language."""
    extractors = {
        'python': PythonExtractor,
        'javascript': JavaScriptExtractor,
        'typescript': JavaScriptExtractor,  # JS extractor handles TS too
        'tsx': JavaScriptExtractor,
    }
    extractor_class = extractors.get(language)
    if extractor_class:
        return extractor_class()
    raise ValueError(f"No extractor for language: {language}")
