"""Symbol index orchestrator — Layer 2.7.

Wires the parser, per-language extractors, cache, import
resolver, reference graph, and formatters into a single
entry point. Consumers call :meth:`SymbolIndex.index_repo`
with a file list and then query via
:meth:`get_symbol_map` / :meth:`get_file_symbol_block` /
:meth:`get_signature_hash`.

Design notes pinned by the test suite and spec:

- **Per-file pipeline** — check cache → parse → extract →
  post-process (import resolution) → store. mtime-based
  caching means unchanged files are a no-op.

- **Multi-file pipeline** — index each file, prune stale
  entries (both in-memory and cache), resolve cross-file
  call-site targets, rebuild the reference graph.

- **Stale-removal ordering** — pruning happens BEFORE the
  reference graph rebuild. Otherwise the ref index would
  briefly contain edges to/from deleted files.

- **Snapshot discipline** — read methods
  (``get_symbol_map``, ``get_file_symbol_block``,
  ``get_signature_hash``) never mutate state.

- **Two formatter variants** — a context formatter (no
  line numbers, for the LLM) and an LSP formatter (with
  line numbers, for editor features).

- **Dispatch by language name** — each extractor declares
  a ``language`` class attribute matching a key in
  LANGUAGE_MAP. The orchestrator resolves a file's
  language via ``language_for_file`` and picks the
  matching extractor.

- **Path normalisation** — incoming paths normalised to
  forward-slash, leading/trailing-slash-stripped form
  before any cache lookup or dict key.

Governing spec: ``specs4/2-indexing/symbol-index.md``.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING

from ac_dc.symbol_index.cache import SymbolCache
from ac_dc.symbol_index.compact_format import CompactFormatter
from ac_dc.symbol_index.extractors import (
    BaseExtractor,
    CExtractor,
    CppExtractor,
    JavaScriptExtractor,
    PythonExtractor,
    TypeScriptExtractor,
)
from ac_dc.symbol_index.import_resolver import ImportResolver
from ac_dc.symbol_index.parser import (
    TreeSitterParser,
    language_for_file,
)
from ac_dc.symbol_index.reference_index import ReferenceIndex

if TYPE_CHECKING:
    from ac_dc.symbol_index.models import FileSymbols

logger = logging.getLogger(__name__)


# Per-language extractor classes. MATLAB is intentionally
# absent — no maintained tree-sitter grammar, and the
# regex-based extractor path (tree_optional = True) is
# deferred.
_EXTRACTOR_CLASSES: tuple[type[BaseExtractor], ...] = (
    PythonExtractor,
    JavaScriptExtractor,
    TypeScriptExtractor,
    CExtractor,
    CppExtractor,
)


class SymbolIndex:
    """Top-level symbol-index orchestrator.

    Construct once per session. Call :meth:`index_repo`
    with the current file list to (re-)index, then query
    via the read methods. The in-memory ``_all_symbols``
    map is a read-only snapshot between re-index passes.
    """

    def __init__(self, repo_root: Path | str | None = None) -> None:
        """Initialise the orchestrator.

        Parameters
        ----------
        repo_root
            Optional path to the repository root. When
            provided, relative paths passed to
            :meth:`index_file` and :meth:`index_repo` are
            resolved against this directory. When None,
            callers must pass absolute paths.
        """
        self.repo_root: Path | None = (
            Path(repo_root) if repo_root is not None else None
        )

        # Shared tree-sitter parser — caches loaded
        # Language objects internally.
        self._parser = TreeSitterParser.instance()

        # Cache, reference index, resolver. Exposed as
        # underscored attributes for test introspection.
        self._cache = SymbolCache()
        self._ref_index = ReferenceIndex()
        self._resolver = ImportResolver()

        # Extractor registry keyed by language name.
        self._extractors: dict[str, BaseExtractor] = {}
        for cls in _EXTRACTOR_CLASSES:
            instance = cls()
            if instance.language:
                self._extractors[instance.language] = instance

        # In-memory per-file symbol store. Keys are
        # forward-slash relative paths.
        self._all_symbols: dict[str, "FileSymbols"] = {}

        # Two formatter instances — context (LLM-facing)
        # and LSP (editor features, with line numbers).
        self._formatter_context = CompactFormatter(
            include_line_numbers=False
        )
        self._formatter_lsp = CompactFormatter(
            include_line_numbers=True
        )

    # ------------------------------------------------------------------
    # Path normalisation
    # ------------------------------------------------------------------

    @staticmethod
    def _normalise_rel_path(path: str | Path) -> str:
        """Return the canonical dict-key form for a repo path.

        Forward-slash separators, no leading or trailing
        slash. Matches the conventions used by BaseCache
        and ImportResolver so lookups collide cleanly.
        """
        return str(path).replace("\\", "/").strip("/")

    def _absolute_path(self, rel: str) -> Path:
        """Resolve a normalised relative path to an absolute Path.

        When ``repo_root`` is set, joins against it;
        otherwise treats the input as relative to the
        process cwd. An absolute path is returned as-is.
        """
        candidate = Path(rel)
        if candidate.is_absolute():
            return candidate
        if self.repo_root is not None:
            return self.repo_root / rel
        return candidate

    # ------------------------------------------------------------------
    # Per-file pipeline
    # ------------------------------------------------------------------

    def index_file(
        self, path: str | Path
    ) -> "FileSymbols | None":
        """Index a single file, using the cache when possible.

        Returns the FileSymbols (from cache or freshly
        extracted), or None when the file has no supported
        extractor, is missing, or fails to parse.
        """
        rel = self._normalise_rel_path(path)
        language = language_for_file(rel)
        if language is None:
            return None

        extractor = self._extractors.get(language)
        if extractor is None:
            return None

        absolute = self._absolute_path(rel)
        try:
            mtime = absolute.stat().st_mtime
        except OSError:
            # Missing file / permission error. Invalidate
            # any stale entry and return None.
            self._all_symbols.pop(rel, None)
            self._cache.invalidate(rel)
            return None

        cached = self._cache.get(rel, mtime)
        if cached is not None:
            # Cache hit — identity preserved for callers
            # that hold references.
            self._all_symbols[rel] = cached
            return cached

        return self._parse_and_store(
            rel, absolute, language, extractor, mtime
        )

    def _parse_and_store(
        self,
        rel: str,
        absolute: Path,
        language: str,
        extractor: BaseExtractor,
        mtime: float,
    ) -> "FileSymbols | None":
        """Parse and extract, then store in cache and _all_symbols."""
        try:
            source = absolute.read_bytes()
        except OSError:
            self._all_symbols.pop(rel, None)
            self._cache.invalidate(rel)
            return None

        # Extractors that declare tree_optional=True (e.g.
        # future MATLAB) get tree=None and do their own
        # regex-based extraction. The rest need a real tree.
        if extractor.tree_optional:
            tree = None
        else:
            tree = self._parser.parse(source, language)
            if tree is None:
                # Grammar unavailable — nothing to do.
                return None

        try:
            file_symbols = extractor.extract(tree, source, rel)
        except Exception as exc:
            # Defensive — an extractor bug shouldn't take
            # down the whole index pass.
            logger.warning(
                "Extractor for %s failed on %s: %s",
                language, rel, exc,
            )
            return None

        # Populate Import.resolved_target for the file's
        # own imports using the current resolver state.
        # The resolver's file set may not yet include all
        # repo files during per-file invocations; callers
        # that need cross-file resolution (reference graph)
        # use index_repo which updates the resolver's file
        # set first.
        self._resolve_imports_for_file(file_symbols)

        # Store in both cache and in-memory map.
        self._cache.put(rel, mtime, file_symbols)
        self._all_symbols[rel] = file_symbols
        return file_symbols

    def _resolve_imports_for_file(
        self, file_symbols: "FileSymbols"
    ) -> None:
        """Attach ``resolved_target`` to each Import object.

        The import resolver returns a repo-relative path
        (or None). We stash it on the Import via
        :func:`setattr` — Layer 2.4's reference index
        reads via :func:`getattr` with a None default, so
        pre-resolver Import objects still work. A later
        model change could make this a real field.
        """
        for imp in file_symbols.imports:
            target = self._resolver.resolve(imp, file_symbols.file_path)
            setattr(imp, "resolved_target", target)

    # ------------------------------------------------------------------
    # Multi-file pipeline
    # ------------------------------------------------------------------

    def index_repo(self, file_list: list[str | Path]) -> None:
        """Index a list of files, prune stale entries, rebuild refs.

        The canonical full-repo entry point. Callers pass
        the current repo file list (typically from
        :meth:`ac_dc.repo.Repo.get_flat_file_list`). Order
        of operations:

        1. Normalise every path, filter to those with a
           known extractor. Unknown extensions are skipped
           silently — the walker's file list may contain
           arbitrary content.
        2. Update the resolver's file set so per-file
           import resolution sees every repo file.
        3. Index each file (cache-aware).
        4. Prune entries in ``_all_symbols`` and the cache
           whose paths aren't in the new list. Must run
           BEFORE the reference index rebuild.
        5. Resolve cross-file call-site targets using the
           now-complete import and symbol maps.
        6. Rebuild the reference graph from the current
           ``_all_symbols``.
        """
        # Step 1 — normalise and filter.
        normalised: list[str] = []
        for p in file_list:
            rel = self._normalise_rel_path(p)
            if rel and language_for_file(rel) is not None:
                normalised.append(rel)
        keep = set(normalised)

        # Step 2 — refresh the resolver's file set. We
        # pass the raw normalised list (not the filter),
        # so the resolver can answer queries about files
        # it wouldn't itself index (e.g. plain ``.txt``
        # files referenced by C-style includes in some
        # exotic project).
        self._resolver.set_files([
            self._normalise_rel_path(p) for p in file_list
        ])

        # Step 3 — index each file. Errors inside
        # index_file are swallowed there (returns None);
        # the pass continues.
        for rel in normalised:
            self.index_file(rel)

        # Step 4 — prune stale entries. Done by diffing
        # the in-memory map and cache against the current
        # file set. A file absent from keep is a deleted
        # or moved file; its entries must go.
        self._prune_stale(keep)

        # Step 5 — cross-file call-site resolution.
        self._resolve_call_sites()

        # Step 6 — rebuild the reference graph from
        # scratch. ReferenceIndex.build is idempotent —
        # it clears prior state first.
        self._ref_index.build(list(self._all_symbols.values()))

    def _prune_stale(self, keep: set[str]) -> None:
        """Remove in-memory and cached entries not in ``keep``.

        A union of the two key sets gives us paths that
        might be stale. For each, drop the memory entry
        and invalidate the cache sidecar (the cache's
        no-op for missing keys means extra ``invalidate``
        calls are cheap).

        Must run before the reference graph rebuild — see
        the ordering note in :meth:`index_repo`.
        """
        stale = (
            set(self._all_symbols.keys()) | self._cache.cached_paths
        ) - keep
        for path in stale:
            self._all_symbols.pop(path, None)
            self._cache.invalidate(path)

    def _resolve_call_sites(self) -> None:
        """Populate ``target_file`` on each call site.

        Strategy — for each file, build a map of
        imported-name → resolved target. Then for each
        call site in that file, if the callee's name
        matches an imported name, set ``target_file`` to
        the import's resolved target.

        This is intentionally modest: it catches the
        common case where a function is imported and
        called under the same name. Resolving method
        calls on imported classes, aliased imports, or
        deeply namespaced calls would require symbol
        resolution that's out of scope for Layer 2.7 —
        the reference graph handles those via import
        edges separately.
        """
        for file_symbols in self._all_symbols.values():
            # Per-file imported-name → target map.
            import_map: dict[str, str] = {}
            for imp in file_symbols.imports:
                target = getattr(imp, "resolved_target", None)
                if not target:
                    continue
                # ``from foo import bar`` — each name
                # maps to target. ``import foo`` (no
                # names) maps the module's leaf name to
                # target, but that's more ambiguous and
                # the call-site extractor already strips
                # module prefixes, so we skip it.
                for name in imp.names:
                    if name and name != "*":
                        import_map[name] = target

            # Walk every symbol (top-level + nested) and
            # resolve each call site's target.
            for sym in file_symbols.all_symbols_flat:
                for cs in sym.call_sites:
                    if cs.target_file is not None:
                        continue  # already resolved
                    target = import_map.get(cs.name)
                    if target is not None:
                        cs.target_file = target
                        # target_symbol defaults to the
                        # callee name — good enough for
                        # the reference index's needs.
                        if cs.target_symbol is None:
                            cs.target_symbol = cs.name

    # ------------------------------------------------------------------
    # Invalidation
    # ------------------------------------------------------------------

    def invalidate_file(self, path: str | Path) -> bool:
        """Drop a file from the in-memory map and cache.

        Returns True if anything was removed (either the
        memory entry, the cache entry, or both), False if
        neither existed. Callers use the return value to
        count cleanups; raising on missing would force
        every call site into try/except.
        """
        rel = self._normalise_rel_path(path)
        had_memory = self._all_symbols.pop(rel, None) is not None
        had_cache = self._cache.invalidate(rel)
        return had_memory or had_cache

    # ------------------------------------------------------------------
    # Read queries — snapshot discipline applies
    # ------------------------------------------------------------------

    def get_symbol_map(
        self,
        exclude_files: set[str] | None = None,
    ) -> str:
        """Render the context-variant symbol map.

        No line numbers — the LLM-facing format. Empty
        when no files are indexed, matching the base
        formatter's contract so callers can concatenate
        the output into a prompt and skip the section
        cleanly when there's nothing to show.
        """
        if not self._all_symbols:
            return ""
        return self._formatter_context.format_files(
            self._all_symbols.values(),
            ref_index=self._ref_index,
            exclude_files=exclude_files,
        )

    def get_lsp_symbol_map(
        self,
        exclude_files: set[str] | None = None,
    ) -> str:
        """Render the LSP-variant symbol map.

        Same content as :meth:`get_symbol_map` but with
        ``:N`` line numbers on every symbol. Consumed by
        editor features (hover, go-to-definition); not
        suitable for the LLM prompt because line numbers
        waste tokens the model doesn't use.
        """
        if not self._all_symbols:
            return ""
        return self._formatter_lsp.format_files(
            self._all_symbols.values(),
            ref_index=self._ref_index,
            exclude_files=exclude_files,
        )

    def get_legend(self) -> str:
        """Return just the legend block (kind codes, aliases).

        Layer 3's prompt assembly places the legend in a
        cached L0 block separate from the map body so the
        legend can stabilise while file blocks cascade
        through tiers. The base formatter exposes a
        standalone ``get_legend`` method that computes
        path aliases from the supplied file list; we pass
        the current set.
        """
        return self._formatter_context.get_legend(
            self._all_symbols.keys()
        )

    def get_file_symbol_block(
        self, path: str | Path
    ) -> str | None:
        """Render the compact block for a single file.

        Returns None when the file isn't in the index —
        the stability tracker polls per-file and a deleted
        file between request assembly and block retrieval
        would otherwise crash the tier build.

        The block omits the legend and alias block — it's
        meant to be composed into a cached tier where the
        legend lives separately in L0.
        """
        rel = self._normalise_rel_path(path)
        if rel not in self._all_symbols:
            return None
        # Render just this one file without the legend.
        # CompactFormatter.format_files always emits the
        # legend; drop down to the base class's format()
        # method, which accepts include_legend=False, and
        # stash the FileSymbols in _current_by_path so
        # _format_file can look it up by path string.
        fs = self._all_symbols[rel]
        fmt = self._formatter_context
        fmt._current_by_path = {rel: fs}
        try:
            return fmt.format(
                [rel],
                ref_index=self._ref_index,
                include_legend=False,
            )
        finally:
            fmt._current_by_path = {}

    def get_signature_hash(self, path: str | Path) -> str | None:
        """Return the structural hash for a file, or None if unknown.

        Thin wrapper around the cache's hash accessor.
        The stability tracker uses this to detect when a
        file's structure genuinely changed (distinct from
        whitespace-only edits which change mtime but not
        the signature).
        """
        rel = self._normalise_rel_path(path)
        return self._cache.get_signature_hash(rel)