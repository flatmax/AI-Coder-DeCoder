"""Symbol cache — in-memory, per-file, mtime-based invalidation.

Extends BaseCache with symbol-specific content hashing.
"""

import hashlib

from ..base_cache import BaseCache


class SymbolCache(BaseCache):
    """Cache parsed symbols per file, invalidated by mtime."""

    def __init__(self):
        super().__init__()

    def get(self, path, mtime):
        """Get cached symbols if mtime matches."""
        return super().get(path, mtime)

    def put(self, path, mtime, file_symbols):
        """Store symbols with mtime."""
        content_hash = self._compute_hash(file_symbols)
        super().put(path, mtime, file_symbols, content_hash=content_hash)

    def _compute_hash(self, data):
        """Compute deterministic hash of symbol signatures."""
        parts = []
        for sym in data.symbols:
            parts.append(sym.signature_hash_content())
        for imp in data.imports:
            parts.append(f"import:{imp.module}:{','.join(imp.names)}")
        content = "\n".join(parts)
        return hashlib.sha256(content.encode()).hexdigest()[:16]
