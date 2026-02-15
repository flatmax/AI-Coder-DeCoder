"""Per-language symbol extractors."""
from .python_extractor import PythonExtractor
from .javascript_extractor import JavaScriptExtractor
from .c_extractor import CExtractor

EXTRACTORS = {
    'python': PythonExtractor,
    'javascript': JavaScriptExtractor,
    'typescript': JavaScriptExtractor,
    'c': CExtractor,
    'cpp': CExtractor,
}
