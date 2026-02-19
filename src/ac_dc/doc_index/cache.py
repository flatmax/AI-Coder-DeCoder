"""Document cache — mtime-based outline caching with keyword model tracking.

Extends BaseCache. Stores DocOutline objects and tracks which keyword model
was used so that changing the model invalidates enriched entries.
"""

import hashlib

from ..base_cache import BaseCache


class DocCache(BaseCache):
    """Cache document outlines per file, invalidated by mtime or model change."""

    def __init__(self):
        super().__init__()

    def get(self, path, mtime, keyword_model=None):
        """Get cached outline if mtime matches and keyword model is current.

        Args:
            path: file path
            mtime: file modification time
            keyword_model: current keyword model name (None = no enrichment)

        Returns:
            DocOutline or None
        """
        entry = self._cache.get(path)
        if not entry:
            return None
        if entry["mtime"] != mtime:
            return None
        # Check keyword model matches
        if keyword_model is not None:
            cached_model = entry.get("keyword_model")
            if cached_model != keyword_model:
                return None
        return entry["data"]

    def put(self, path, mtime, outline, keyword_model=None):
        """Store outline with mtime and keyword model name.

        Args:
            path: file path
            mtime: file modification time
            outline: DocOutline instance
            keyword_model: model name used for keyword enrichment
        """
        content_hash = self._compute_hash(outline)
        super().put(
            path, mtime, outline,
            content_hash=content_hash,
            keyword_model=keyword_model,
        )

    def _compute_hash(self, data):
        """Compute deterministic hash of document outline."""
        content = data.signature_hash_content()
        return hashlib.sha256(content.encode()).hexdigest()[:16]