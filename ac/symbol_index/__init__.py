"""Symbol index module for tree-sitter based code analysis."""

from .models import Symbol, Range, Parameter, Import, CallSite
from .symbol_index import SymbolIndex
from .cache import SymbolCache
from .references import ReferenceIndex, Location, Reference
from .import_resolver import ImportResolver
from .extensions import (
    SUPPORTED_EXTENSIONS,
    EXTENSION_TO_LANGUAGE,
    is_supported_file,
    get_language_for_extension,
    filter_supported_files,
)

__all__ = [
    'Symbol', 'Range', 'Parameter', 'Import', 'CallSite',
    'SymbolIndex', 'SymbolCache',
    'ReferenceIndex', 'Location', 'Reference',
    'ImportResolver',
    'SUPPORTED_EXTENSIONS',
    'EXTENSION_TO_LANGUAGE',
    'is_supported_file',
    'get_language_for_extension',
    'filter_supported_files',
]
