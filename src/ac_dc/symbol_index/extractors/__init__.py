"""Language-specific symbol extractors."""

from ac_dc.symbol_index.extractors.base import BaseExtractor
from ac_dc.symbol_index.extractors.python_extractor import PythonExtractor
from ac_dc.symbol_index.extractors.javascript_extractor import JavaScriptExtractor
from ac_dc.symbol_index.extractors.c_extractor import CExtractor
from ac_dc.symbol_index.extractors.matlab_extractor import MatlabExtractor

# Extension -> Extractor class
EXTRACTORS: dict[str, type[BaseExtractor]] = {
    ".py": PythonExtractor,
    ".js": JavaScriptExtractor,
    ".mjs": JavaScriptExtractor,
    ".jsx": JavaScriptExtractor,
    ".ts": JavaScriptExtractor,
    ".tsx": JavaScriptExtractor,
    ".c": CExtractor,
    ".h": CExtractor,
    ".cpp": CExtractor,
    ".cc": CExtractor,
    ".cxx": CExtractor,
    ".hpp": CExtractor,
    ".hxx": CExtractor,
    ".m": MatlabExtractor,
}