"""Symbol cache — in-memory, per-file, mtime-based invalidation."""

import hashlib
import os


class SymbolCache:
    """Cache parsed symbols per file, invalidated by mtime."""

    def __init__(self):
        self._cache = {}  # path -> {mtime, file_symbols, content_hash}

    def get(self, path, mtime):
        """Get cached symbols if mtime matches."""
        entry = self._cache.get(path)
        if entry and entry["mtime"] == mtime:
            return entry["file_symbols"]
        return None

    def put(self, path, mtime, file_symbols):
        """Store symbols with mtime."""
        content_hash = self._compute_hash(file_symbols)
        self._cache[path] = {
            "mtime": mtime,
            "file_symbols": file_symbols,
            "content_hash": content_hash,
        }

    def get_hash(self, path):
        """Get content hash for a cached file."""
        entry = self._cache.get(path)
        if entry:
            return entry["content_hash"]
        return None

    def invalidate(self, path):
        """Remove entry from cache."""
        self._cache.pop(path, None)

    def clear(self):
        """Clear all entries."""
        self._cache.clear()

    @property
    def cached_files(self):
        """Set of cached file paths."""
        return set(self._cache.keys())

    def _compute_hash(self, file_symbols):
        """Compute deterministic hash of symbol signatures."""
        parts = []
        for sym in file_symbols.symbols:
            parts.append(sym.signature_hash_content())
        for imp in file_symbols.imports:
            parts.append(f"import:{imp.module}:{','.join(imp.names)}")
        content = "\n".join(parts)
        return hashlib.sha256(content.encode()).hexdigest()[:16]
