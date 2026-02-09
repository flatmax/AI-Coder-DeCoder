"""Per-language symbol extractors."""

from .base import BaseExtractor
from .python_ext import PythonExtractor
from .javascript_ext import JavaScriptExtractor
from .c_ext import CExtractor

EXTRACTORS: dict[str, type[BaseExtractor]] = {
    "python": PythonExtractor,
    "javascript": JavaScriptExtractor,
    "typescript": JavaScriptExtractor,  # TS uses same extractor with tweaks
    "c": CExtractor,
    "cpp": CExtractor,
}


def get_extractor(language: str) -> BaseExtractor:
    """Get the extractor for a language."""
    cls = EXTRACTORS.get(language, BaseExtractor)
    return cls()
