"""Document index orchestrator — Layer 2.8.1f.
Wires extractor registry, cache, reference index, and formatter
into a single entry point. Consumers call :meth:`DocIndex.index_repo`
with a file list (or let it walk the repo itself) and then query
via :meth:`get_doc_map`, :meth:`get_file_doc_block`, or
:meth:`get_signature_hash`.
Mirrors :class:`ac_dc.symbol_index.index.SymbolIndex` —
deliberately similar shape so callers (the LLM service's tier
builder, the streaming handler's stability update pass) dispatch
between them via a simple mode check.
Design notes pinned by the test suite and spec:
- **Per-file pipeline** — mtime check → extract → resolve
  link paths against repo file set → store. Cached files
  return by reference, preserving identity across calls.
- **Multi-file pipeline** — three phases per ``index_repo``:
  (1) discover files via ``os.walk`` when no explicit list
  given, (2) index each file (cache-aware), (3) prune stale
  entries from both memory and cache BEFORE rebuilding the
  reference graph.
- **Stale-removal ordering** — matches the symbol index
  invariant. The reference index would briefly hold edges
  to/from deleted files if we rebuilt before pruning. Test
  ``test_stale_removal_before_reference_build`` pins this.
- **Structure-only vs enriched cache lookup** — two entry
  points. :meth:`index_file` and :meth:`index_repo` pass the
  ``keyword_model`` through to the cache, so callers that
  require keyword-enriched outlines fail to hit the cache
  when the stored model doesn't match. 2.8.1 callers always
  pass ``None`` (no enrichment yet); 2.8.4 will pass real
  model names.
- **Snapshot discipline (D10)** — read methods don't mutate
  ``_all_outlines``. The reference index is rebuilt only on
  ``index_repo``, not on per-file reads. Within a request
  window the index is a read-only snapshot.
- **Repo file set for link validation** — extractors accept
  ``repo_files`` so image-extension scans validate against
  real paths. A phantom mention ("the old layout.svg was
  removed") doesn't produce an edge. The orchestrator
  builds this set fresh on every ``index_repo`` call from
  the walked file list.
- **Excluded directories match the symbol index** — ``.git``,
  ``.ac-dc``, ``.ac-dc4``, ``node_modules``, ``__pycache__``,
  ``.venv``, ``venv``, ``dist``, ``build``. Changes to
  ``SymbolIndex``'s list should mirror here; a future
  refactor could share the set.
- **Extractor registry dispatch** — ``EXTRACTORS`` maps
  extensions to extractor classes. Unknown extensions return
  None from :meth:`index_file` without error. New format
  support (SVG in 2.8.3) is an entry in the registry plus
  a new extractor class, no orchestrator changes.
- **Two formatters** — one instance for tier assembly
  (no line numbers; 2.8.1 doesn't emit line numbers yet),
  one reserved for future LSP-style consumers. Currently
  only the first is built; the second will land when doc-
  mode editor features (if ever) need line-annotated output.
Governing spec: ``specs4/2-indexing/document-index.md``.
"""
from __future__ import annotations
import logging
import os
from pathlib import Path
from typing import TYPE_CHECKING
from ac_dc.doc_index.cache import DocCache
from ac_dc.doc_index.extractors import EXTRACTORS, BaseDocExtractor
from ac_dc.doc_index.formatter import DocFormatter
from ac_dc.doc_index.reference_index import DocReferenceIndex
if TYPE_CHECKING:
    from ac_dc.doc_index.models import DocOutline
logger = logging.getLogger(__name__)
# Directory names never walked during file discovery. Mirrors
# :attr:`ac_dc.symbol_index.index._EXCLUDED_DIRS`. ``.ac-dc`` and
# ``.ac-dc4`` are this project's working-state dirs; excluding
# them avoids indexing the sidecar JSON files we just wrote.
_EXCLUDED_DIRS: frozenset[str] = frozenset(
    {
        ".git",
        ".ac-dc",
        ".ac-dc4",
        "node_modules",
        "__pycache__",
        ".venv",
        "venv",
        "dist",
        "build",
    }
)
class DocIndex:
    """Document-index orchestrator.
    Construct with an optional repo root. The root serves two
    purposes: resolving relative paths handed to
    :meth:`index_file`, and anchoring the cache's on-disk
    sidecar directory at ``{root}/.ac-dc/doc_cache/``.
    When ``repo_root`` is None, :meth:`index_file` requires
    absolute paths, cache persistence is disabled (pure
    in-memory), and :meth:`index_repo` with no explicit file
    list is a no-op.
    """
    def __init__(self, repo_root: Path | str | None = None) -> None:
        """Initialise the orchestrator.
        Parameters
        ----------
        repo_root
            Repository root directory. Used for path
            resolution and as the base for cache persistence.
            When None, cache runs in memory-only mode.
        """
        self.repo_root: Path | None = (
            Path(repo_root) if repo_root is not None else None
        )
        # Cache: mtime-keyed with disk persistence when root
        # is set. Signature hashes over the structural outline
        # (see DocCache._compute_signature_hash).
        self._cache = DocCache(self.repo_root)
        # Reference index: rebuilt after each index_repo pass.
        # Per-file index_file calls don't rebuild — would be
        # incorrect (graph depends on ALL outlines) and
        # wasteful.
        self._ref_index = DocReferenceIndex()
        # Extractor registry: one shared instance per
        # extension. Extractors are stateless across calls so
        # sharing is safe.
        self._extractors: dict[str, BaseDocExtractor] = {
            ext: cls() for ext, cls in EXTRACTORS.items()
        }
        # Formatter for tier assembly — no line numbers.
        # 2.8.1 doesn't surface line numbers in the compact
        # format; if a future LSP-style consumer needs them,
        # a second formatter variant can be added.
        self._formatter = DocFormatter()
        # In-memory outline store. Keys are forward-slash
        # relative paths. Read-only snapshot within a request
        # window (D10); only index_file and index_repo mutate.
        self._all_outlines: dict[str, "DocOutline"] = {}
    # ------------------------------------------------------------------
    # Path normalisation
    # ------------------------------------------------------------------
    @staticmethod
    def _normalise_rel_path(path: str | Path) -> str:
        """Canonical dict-key form for a repo path.
        Forward-slash separators, no leading/trailing slash.
        Matches :meth:`DocCache._normalise_path` and
        :meth:`SymbolIndex._normalise_rel_path` so lookups
        across layers collide on the same key.
        """
        return str(path).replace("\\", "/").strip("/")
    def _absolute_path(self, rel: str) -> Path:
        """Resolve a normalised relative path to an absolute Path.
        Joins against ``repo_root`` when set; returns the path
        as-is when it's already absolute or when no root is
        configured. Callers that pass relative paths without
        a root configured will get a cwd-relative resolution
        from the filesystem layer.
        """
        candidate = Path(rel)
        if candidate.is_absolute():
            return candidate
        if self.repo_root is not None:
            return self.repo_root / rel
        return candidate
    @staticmethod
    def _extension_of(path: str) -> str:
        """Return the lowercased extension including the dot.
        Empty string for extensionless files. Matches the
        extractor registry's key format.
        """
        return Path(path).suffix.lower()
    # ------------------------------------------------------------------
    # Per-file pipeline
    # ------------------------------------------------------------------
    def index_file(
        self,
        path: str | Path,
        repo_files: set[str] | None = None,
        keyword_model: str | None = None,
    ) -> "DocOutline | None":
        """Index a single file.
        Uses the cache when possible. Returns the
        :class:`DocOutline` (cached or freshly extracted), or
        None when:
        - The extension isn't registered
        - The file is missing / unreadable (mtime stat fails)
        - The extractor fails to produce an outline
        Parameters
        ----------
        path
            Repo-relative or absolute path.
        repo_files
            Optional set of known repo-relative file paths for
            extractors that need to validate link targets
            (e.g., markdown image references). When None, the
            extractor skips repo-validation and accepts all
            paths.
        keyword_model
            Optional name of the enrichment model. Structure-
            only lookup (None) accepts any cached entry;
            non-None requires model match and forces
            re-extraction when the cache was populated with a
            different model.
        Returns
        -------
        DocOutline or None
            The outline, or None on any skip/failure.
        """
        # Absolute paths are accepted defensively — detect
        # before normalisation, which strips the leading
        # slash and would turn "/tmp/x.md" into a
        # repo-relative "tmp/x.md" lookup against the wrong
        # root.
        path_obj = Path(path) if not isinstance(path, Path) else path
        if path_obj.is_absolute():
            absolute = path_obj
            if self.repo_root is not None:
                try:
                    rel = self._normalise_rel_path(
                        path_obj.relative_to(self.repo_root)
                    )
                except ValueError:
                    # Path lives outside repo_root; use the
                    # absolute path as its own key.
                    rel = self._normalise_rel_path(path_obj)
            else:
                rel = self._normalise_rel_path(path_obj)
        else:
            rel = self._normalise_rel_path(path)
            absolute = self._absolute_path(rel)
        extension = self._extension_of(rel)
        extractor = self._extractors.get(extension)
        if extractor is None:
            return None
        try:
            mtime = absolute.stat().st_mtime
        except OSError:
            # Missing file / permission error. Invalidate any
            # stale entry in both memory and cache — the file
            # is gone from the orchestrator's view.
            self._all_outlines.pop(rel, None)
            self._cache.invalidate(rel)
            return None
        cached = self._cache.get(rel, mtime, keyword_model=keyword_model)
        if cached is not None:
            # Cache hit — identity preserved for callers that
            # hold references (the stability tracker's content
            # hash relies on structural hash, not object
            # identity, but reusing the cached object reduces
            # memory churn).
            self._all_outlines[rel] = cached
            return cached
        return self._parse_and_store(
            rel=rel,
            absolute=absolute,
            extractor=extractor,
            mtime=mtime,
            repo_files=repo_files,
            keyword_model=keyword_model,
        )
    def _parse_and_store(
        self,
        *,
        rel: str,
        absolute: Path,
        extractor: BaseDocExtractor,
        mtime: float,
        repo_files: set[str] | None,
        keyword_model: str | None,
    ) -> "DocOutline | None":
        """Read, extract, cache, and store. Returns the outline.
        Kept separate from :meth:`index_file` so the cache-hit
        path is a clean early-return and the error-handling
        around read/extract sits together.
        """
        try:
            content = absolute.read_text(
                encoding="utf-8", errors="replace"
            )
        except OSError:
            self._all_outlines.pop(rel, None)
            self._cache.invalidate(rel)
            return None
        try:
            outline = extractor.extract(Path(rel), content)
        except Exception as exc:
            # Defensive — an extractor bug (malformed regex,
            # unexpected content pattern) shouldn't crash the
            # whole index pass. Log and return None so the
            # file is simply absent from the index.
            logger.warning(
                "Doc extractor for %s failed on %s: %s",
                extension_of := extractor.__class__.__name__,
                rel,
                exc,
            )
            del extension_of
            return None
        # Repo-file validation for link targets happens in the
        # extractor when it needs the set. For markdown, the
        # 2.8.1 extractor doesn't use repo_files (its link
        # extraction is syntax-only — `[text](target)` always
        # produces a DocLink regardless of whether target
        # exists on disk). SVG (2.8.3) and the image-extension
        # scan will use it. We pass None through for now;
        # the parameter is forward-compatible.
        del repo_files  # reserved for 2.8.3+
        # Store in both cache (with keyword_model) and memory.
        self._cache.put(
            rel, mtime, outline, keyword_model=keyword_model
        )
        self._all_outlines[rel] = outline
        return outline
    # ------------------------------------------------------------------
    # Multi-file pipeline
    # ------------------------------------------------------------------
    def index_repo(
        self,
        file_list: list[str | Path] | None = None,
        keyword_model: str | None = None,
    ) -> None:
        """Index a file list, prune stale entries, rebuild refs.
        The canonical full-repo entry point. Order of
        operations:
        1. Normalise the input list (or walk the repo when
           None). Filter to files with a registered extractor.
        2. Build the set of repo-relative paths for link
           validation. Passed through to extractors.
        3. Index each file (cache-aware via
           :meth:`index_file`).
        4. Prune entries in ``_all_outlines`` and the cache
           whose paths aren't in the new list. Must run BEFORE
           the reference graph rebuild.
        5. Rebuild the reference graph from the current
           ``_all_outlines``.
        Parameters
        ----------
        file_list
            Repo-relative paths to index. When None, walks the
            repo root via :meth:`_walk_repo`. An empty list is
            NOT the same as None — it explicitly says "index
            nothing" (which causes every existing entry to
            prune).
        keyword_model
            Passed through to :meth:`index_file` for every
            file. 2.8.1 callers pass None; 2.8.4's enrichment
            pipeline passes the real model name.
        """
        if file_list is None:
            if self.repo_root is None:
                # No root configured and no explicit file
                # list — nothing to discover.
                logger.debug(
                    "index_repo called with no file_list and "
                    "no repo_root; skipping"
                )
                return
            walked = self._walk_repo()
        else:
            walked = file_list
        # Phase 1: normalise and filter to known extensions.
        normalised: list[str] = []
        for p in walked:
            rel = self._normalise_rel_path(p)
            if not rel:
                continue
            if self._extension_of(rel) in self._extractors:
                normalised.append(rel)
        keep = set(normalised)
        # Phase 2: build repo_files for extractor link
        # validation. Includes non-doc files (images,
        # source code) so image links resolve against real
        # paths even when the image's extension isn't
        # registered.
        all_walked: set[str] = {
            self._normalise_rel_path(p) for p in walked
        }
        # Preserve the non-doc files; don't intersect with
        # `keep`, or SVG/image targets would disappear.
        repo_files = {p for p in all_walked if p}
        # Phase 3: index each file. Errors are swallowed at
        # index_file / _parse_and_store; this loop always
        # continues.
        for rel in normalised:
            self.index_file(
                rel,
                repo_files=repo_files,
                keyword_model=keyword_model,
            )
        # Phase 4: prune stale entries. Run BEFORE the
        # reference graph rebuild — otherwise the rebuild
        # would include edges from/to files we're about to
        # drop.
        self._prune_stale(keep)
        # Phase 5: rebuild the reference graph from the
        # current outline set. The reference index's build()
        # is idempotent — clears prior state and recomputes
        # from scratch.
        self._ref_index.build(list(self._all_outlines.values()))
    def _walk_repo(self) -> list[str]:
        """Walk the repo root and return candidate file paths.
        Returns repo-relative paths (forward-slash normalised).
        Skips excluded directories via in-place ``dirs`` filter
        — same pattern the symbol index uses.
        """
        if self.repo_root is None:
            return []
        result: list[str] = []
        root_str = str(self.repo_root)
        for dirpath, dirs, files in os.walk(root_str):
            # In-place prune so os.walk doesn't descend into
            # excluded directories. Hidden directories other
            # than .github are also skipped — aligns with the
            # doc_convert walker's rule for consistency across
            # the codebase.
            dirs[:] = [
                d for d in dirs
                if d not in _EXCLUDED_DIRS
                and (not d.startswith(".") or d == ".github")
            ]
            for name in files:
                absolute = os.path.join(dirpath, name)
                rel_path = os.path.relpath(absolute, root_str)
                # Normalise backslashes on Windows.
                normalised = rel_path.replace("\\", "/")
                result.append(normalised)
        return result
    def _prune_stale(self, keep: set[str]) -> None:
        """Drop in-memory and cache entries not in ``keep``.
        Union of the two key sets gives the candidates; for
        each path not in ``keep``, drop the memory entry and
        invalidate the cache sidecar. The cache's invalidate
        is cheap for missing keys so extra calls don't hurt.
        """
        stale = (
            set(self._all_outlines.keys()) | self._cache.cached_paths
        ) - keep
        for path in stale:
            self._all_outlines.pop(path, None)
            self._cache.invalidate(path)
    # ------------------------------------------------------------------
    # Invalidation
    # ------------------------------------------------------------------
    def invalidate_file(self, path: str | Path) -> bool:
        """Drop a file from memory and cache.
        Returns True if anything was removed, False if neither
        existed. Called by the streaming handler after the
        LLM writes to a doc file (see specs4/3-llm/streaming.md
        — post-edit invalidation).
        """
        rel = self._normalise_rel_path(path)
        had_memory = self._all_outlines.pop(rel, None) is not None
        had_cache = self._cache.invalidate(rel)
        return had_memory or had_cache
    # ------------------------------------------------------------------
    # Read queries — snapshot discipline applies
    # ------------------------------------------------------------------
    def get_doc_map(
        self,
        exclude_files: set[str] | None = None,
    ) -> str:
        """Render the full doc map with legend.
        Consumed by the tier assembler's L0 block. Empty when
        no outlines are indexed so callers can concatenate
        the output without extra conditionals.
        """
        if not self._all_outlines:
            return ""
        return self._formatter.format_files(
            self._all_outlines.values(),
            exclude_files=exclude_files,
        )
    def get_legend(self) -> str:
        """Return just the legend block.
        Matches :class:`SymbolIndex.get_legend` — useful when
        the tier assembler wants the legend cached separately
        from file blocks (so the legend stabilises in L0 while
        file blocks cascade).
        """
        return self._formatter.get_legend(self._all_outlines.keys())
    def get_file_doc_block(self, path: str | Path) -> str | None:
        """Render the compact block for a single file.
        Returns None for files not in the index — matches the
        symbol index's behaviour so the stability tracker can
        probe for a block without crashing on deleted files.
        Output omits the legend (callers composing into a
        cached tier render the legend separately).
        """
        rel = self._normalise_rel_path(path)
        if rel not in self._all_outlines:
            return None
        outline = self._all_outlines[rel]
        # Stash in _current_by_path so _format_file can look
        # up the outline by path string. Drop in finally so
        # a repeated-call pattern doesn't accumulate state.
        self._formatter._current_by_path = {rel: outline}
        try:
            return self._formatter.format(
                [rel],
                include_legend=False,
            )
        finally:
            self._formatter._current_by_path = {}
    def get_signature_hash(self, path: str | Path) -> str | None:
        """Return the structural hash for a file, or None.
        Thin wrapper over :meth:`DocCache.get_signature_hash`.
        The stability tracker uses this to distinguish
        whitespace-only edits (mtime bump, same hash → no
        demote) from structural changes (new hash → demote).
        """
        rel = self._normalise_rel_path(path)
        return self._cache.get_signature_hash(rel)