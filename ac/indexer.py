"""DEPRECATED: Use ac.symbol_index.SymbolIndex directly.

This module is a thin shim kept for backwards compatibility.
All functionality has been moved to SymbolIndex.
"""

import warnings
from typing import List, Optional

from ac.symbol_index import SymbolIndex


class Indexer:
    """DEPRECATED: Use SymbolIndex directly.
    
    This class is a thin wrapper that delegates all calls to SymbolIndex.
    It will be removed in a future version.
    """
    
    def __init__(self, repo_root: str = None):
        warnings.warn(
            "Indexer is deprecated, use ac.symbol_index.SymbolIndex directly",
            DeprecationWarning,
            stacklevel=2,
        )
        self._symbol_index = SymbolIndex(repo_root)
    
    def _get_symbol_index(self):
        """Get the underlying SymbolIndex instance."""
        return self._symbol_index
    
    def __getattr__(self, name):
        """Delegate all attribute access to SymbolIndex."""
        return getattr(self._symbol_index, name)
