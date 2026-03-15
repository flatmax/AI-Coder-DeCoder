"""Per-language symbol extractors."""
from .python_extractor import PythonExtractor
from .javascript_extractor import JavaScriptExtractor
from .c_extractor import CExtractor
from .matlab_extractor import MatlabExtractor

EXTRACTORS = {
    'python': PythonExtractor,
    'javascript': JavaScriptExtractor,
    'typescript': JavaScriptExtractor,
    'c': CExtractor,
    'cpp': CExtractor,
    'matlab': MatlabExtractor,
}
