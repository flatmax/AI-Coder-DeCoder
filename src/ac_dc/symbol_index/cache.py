"""Symbol cache — in-memory mtime-based cache for FileSymbols.

Thin concrete subclass of :class:`~ac_dc.base_cache.BaseCache`
specialised to :class:`~ac_dc.symbol_index.models.FileSymbols`.

Design points:

- **In-memory only.** Tree-sitter re-parse is cheap (~5ms per
  file for typical sources); the cache exists primarily to
  avoid redundant work within a single session, not across
  sessions. The doc cache (Layer 2.7) adds disk sidecars
  because KeyBERT enrichment costs ~500ms per file and is
  worth persisting.

- **Signature hash from raw symbol data, not formatted output.**
  Per specs4/2-indexing/symbol-index.md, the signature hash
  covers structural content (symbol names, kinds, parameters)
  rather than the rendered compact format. The formatted
  output changes when path aliases or exclude-files sets
  change between requests — using it as the hash source would
  cause spurious demotions in the stability tracker.

- **Deterministic hashing.** Same symbol data → same hash, every
  run. The stability tracker relies on this to detect genuine
  structural changes.

Governing spec: ``specs4/2-indexing/symbol-index.md#caching``.
"""

from __future__ import annotations

import hashlib

from ac_dc.base_cache import BaseCache
from ac_dc.symbol_index.models import FileSymbols, Symbol


class SymbolCache(BaseCache[FileSymbols]):
    """In-memory mtime-based cache for :class:`FileSymbols`.

    Behaviour inherited from :class:`BaseCache`:

    - ``get(path, mtime)`` returns the cached FileSymbols when
      mtime matches, else None.
    - ``put(path, mtime, file_symbols)`` stores, computing a
      signature hash from the symbol structure.
    - ``invalidate(path)`` / ``clear()`` drop entries.
    - ``get_signature_hash(path)`` exposes the structural hash
      for the stability tracker.

    No disk persistence — ``_persist`` and ``_remove_persisted``
    inherit the base class's no-op defaults. The cache is
    rebuilt from scratch on every session start.
    """

    # ------------------------------------------------------------------
    # Signature hashing
    # ------------------------------------------------------------------

    def _compute_signature_hash(self, value: FileSymbols) -> str:
        """SHA-256 hex digest of the file's structural signature.

        The hash covers what the stability tracker cares about:

        - Top-level symbol names, kinds, and parameter signatures
        - Nested children (methods on a class, nested functions)
        - Import module names

        It deliberately excludes:

        - Source ranges (line/column) — a file re-indexed after
          an unrelated edit may have the same symbols at
          different lines; that shouldn't count as a structural
          change for caching purposes.
        - File path — baked into the cache key already.
        - Call sites — implementation detail of a symbol body;
          a refactor that moves code between methods shouldn't
          trip the stability tracker just because call-site
          positions shifted.

        The digest is lowercase hex, 64 characters. Callers
        compare for exact equality; substring / prefix matching
        isn't used anywhere.
        """
        parts: list[str] = []

        # Imports — module names in source order. Aliases and
        # from-import names are intentionally excluded: adding an
        # alias to an existing import doesn't change the
        # structural topology, which is what the stability
        # tracker cares about.
        for imp in value.imports:
            parts.append(f"i:{imp.module}")

        # Symbols — recurse into children for nested structure.
        for sym in value.symbols:
            self._append_symbol_signature(sym, parts)

        joined = "\n".join(parts).encode("utf-8")
        return hashlib.sha256(joined).hexdigest()

    def _append_symbol_signature(
        self,
        sym: Symbol,
        parts: list[str],
    ) -> None:
        """Append a symbol's signature lines to ``parts``.

        Recursive — child symbols produce nested entries. Each
        line is self-describing so two symbols that happen to
        share a name but differ in kind or parameters produce
        distinct hash input.
        """
        # Parameter signature — name plus optional type plus
        # optional default. Missing fields use a sentinel so
        # "x with no default" and "x with default None" don't
        # collide (the latter would literally render as "None"
        # but here we preserve the None-vs-missing distinction).
        param_sigs: list[str] = []
        for p in sym.parameters:
            type_s = p.type_annotation or ""
            default_s = p.default if p.default is not None else ""
            flags = ""
            if p.is_vararg:
                flags += "*"
            if p.is_kwarg:
                flags += "**"
            param_sigs.append(f"{flags}{p.name}:{type_s}={default_s}")

        bases_s = ",".join(sym.bases)
        return_s = sym.return_type or ""
        async_s = "1" if sym.is_async else "0"
        ivars_s = ",".join(sym.instance_vars)

        parts.append(
            f"s:{sym.kind}:{sym.name}:{async_s}:{return_s}:"
            f"({';'.join(param_sigs)}):"
            f"[{bases_s}]:"
            f"<{ivars_s}>"
        )

        for child in sym.children:
            self._append_symbol_signature(child, parts)

    # ------------------------------------------------------------------
    # Introspection convenience
    # ------------------------------------------------------------------

    @property
    def cached_files(self) -> set[str]:
        """Alias for :attr:`BaseCache.cached_paths`.

        Matches the name symbol-index code uses throughout —
        ``cache.cached_files`` reads more naturally than
        ``cache.cached_paths`` when the context is specifically
        source files.
        """
        return self.cached_paths