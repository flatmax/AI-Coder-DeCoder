"""SymbolIndex — orchestrator for code analysis pipeline."""

import logging
import hashlib
from pathlib import Path
from typing import Optional

from .parser import TreeSitterParser, get_parser, LANGUAGE_MAP
from .cache import SymbolCache
from .models import FileSymbols, Symbol, SymbolKind
from .extractors import get_extractor
from .import_resolver import ImportResolver
from .reference_index import ReferenceIndex
from .compact_format import CompactFormatter

log = logging.getLogger(__name__)


class SymbolIndex:
    """Orchestrates code analysis: parse, extract, resolve, format.

    This is the main entry point for symbol indexing.
    """

    def __init__(self, repo_root: Path):
        self.repo_root = repo_root.resolve()
        self._parser = get_parser()
        self._cache = SymbolCache()
        self._ref_index = ReferenceIndex()
        self._formatter = CompactFormatter(self._ref_index)
        self._import_resolver: Optional[ImportResolver] = None
        self._all_symbols: dict[str, FileSymbols] = {}
        self._repo_files: set[str] = set()

    @property
    def available(self) -> bool:
        """Whether tree-sitter is available."""
        return self._parser.available

    @property
    def reference_index(self) -> ReferenceIndex:
        return self._ref_index

    @property
    def all_symbols(self) -> dict[str, FileSymbols]:
        return self._all_symbols

    # ------------------------------------------------------------------
    # Indexing
    # ------------------------------------------------------------------

    def index_repo(self, file_paths: Optional[list[str]] = None) -> dict[str, FileSymbols]:
        """Index all supported files in the repository.

        Args:
            file_paths: If provided, only index these files. Otherwise discover all.

        Returns:
            dict of file_path -> FileSymbols
        """
        if file_paths is None:
            file_paths = self._discover_files()

        self._repo_files = set(file_paths)
        self._import_resolver = ImportResolver(self.repo_root, self._repo_files)

        # Index each file
        for fpath in file_paths:
            lang = self._parser.language_for_file(fpath)
            if lang is None:
                continue
            self._index_file(fpath, lang)

        # Resolve imports and build references
        self._resolve_all_imports()
        self._ref_index.build(self._all_symbols)

        log.info(
            "Indexed %d files, %d symbols, %d cross-references",
            len(self._all_symbols),
            sum(len(fs.all_symbols_flat) for fs in self._all_symbols.values()),
            sum(self._ref_index.file_ref_count(f) for f in self._all_symbols),
        )

        return self._all_symbols

    def index_file(self, file_path: str) -> Optional[FileSymbols]:
        """Index or re-index a single file."""
        lang = self._parser.language_for_file(file_path)
        if lang is None:
            return None
        return self._index_file(file_path, lang)

    def invalidate_file(self, file_path: str):
        """Invalidate cache and symbols for a file."""
        self._cache.invalidate(file_path)
        self._all_symbols.pop(file_path, None)

    def invalidate_files(self, file_paths: list[str]):
        """Invalidate multiple files."""
        for fpath in file_paths:
            self.invalidate_file(fpath)

    # ------------------------------------------------------------------
    # Output
    # ------------------------------------------------------------------

    def get_symbol_map(
        self,
        exclude_files: set[str] | None = None,
    ) -> str:
        """Generate the complete compact symbol map text."""
        return self._formatter.format_all(self._all_symbols, exclude_files)

    def get_symbol_map_chunks(
        self,
        exclude_files: set[str] | None = None,
        num_chunks: int = 3,
    ) -> list[dict]:
        """Get symbol map split into chunks for cache tiers."""
        return self._formatter.get_chunks(
            self._all_symbols, exclude_files, num_chunks,
        )

    def get_file_symbols(self, file_path: str) -> Optional[FileSymbols]:
        """Get symbols for a specific file."""
        return self._all_symbols.get(file_path)

    def get_file_block(self, file_path: str) -> str:
        """Get the compact format block for a single file."""
        fsyms = self._all_symbols.get(file_path)
        if fsyms is None:
            return ""
        return self._formatter.format_file_block(file_path, fsyms)

    def get_file_signature_hash(self, file_path: str) -> str:
        """Compute a stable hash of a file's symbol signatures.

        Used for change detection by the stability tracker.
        """
        fsyms = self._all_symbols.get(file_path)
        if fsyms is None:
            return ""
        sigs = [sym.signature for sym in fsyms.all_symbols_flat]
        return hashlib.sha256("\n".join(sigs).encode()).hexdigest()[:16]

    def get_legend(self) -> str:
        """Return just the legend text."""
        return self._formatter.format_legend()

    # ------------------------------------------------------------------
    # LSP-style queries
    # ------------------------------------------------------------------

    def symbol_at_position(
        self, file_path: str, line: int, col: int
    ) -> Optional[Symbol]:
        """Find the most specific symbol at a given position."""
        fsyms = self._all_symbols.get(file_path)
        if fsyms is None:
            return None

        best: Optional[Symbol] = None
        best_size = float("inf")

        for sym in fsyms.all_symbols_flat:
            r = sym.range
            if r.start_line <= line <= r.end_line:
                # Check column for single-line symbols
                if r.start_line == r.end_line:
                    if not (r.start_col <= col <= r.end_col):
                        continue
                size = r.end_line - r.start_line
                if size < best_size:
                    best = sym
                    best_size = size

        return best

    def get_hover_info(self, file_path: str, line: int, col: int) -> str:
        """Get hover information for a position."""
        sym = self.symbol_at_position(file_path, line, col)
        if sym is None:
            return ""

        parts = [f"**{sym.kind.value}** `{sym.name}`"]

        if sym.parameters:
            params = ", ".join(
                f"{p.name}: {p.type_annotation}" if p.type_annotation else p.name
                for p in sym.parameters
            )
            parts.append(f"Parameters: ({params})")

        if sym.return_type:
            parts.append(f"Returns: `{sym.return_type}`")

        if sym.bases:
            parts.append(f"Extends: {', '.join(sym.bases)}")

        return "\n\n".join(parts)

    def get_definition(
        self, file_path: str, line: int, col: int
    ) -> Optional[dict]:
        """Get definition location for a symbol at position."""
        sym = self.symbol_at_position(file_path, line, col)
        if sym is None:
            return None

        # Check if on a call site
        fsyms = self._all_symbols.get(file_path)
        if fsyms:
            for s in fsyms.all_symbols_flat:
                for call in s.call_sites:
                    if call.line == line and call.target_file:
                        # Find the target symbol
                        target_syms = self._all_symbols.get(call.target_file)
                        if target_syms:
                            target_name = call.name.split(".")[-1]
                            for ts in target_syms.all_symbols_flat:
                                if ts.name == target_name:
                                    return {
                                        "file": call.target_file,
                                        "range": {
                                            "start_line": ts.range.start_line,
                                            "start_col": ts.range.start_col,
                                            "end_line": ts.range.end_line,
                                            "end_col": ts.range.end_col,
                                        },
                                    }

        # Return own definition
        return {
            "file": sym.file_path,
            "range": {
                "start_line": sym.range.start_line,
                "start_col": sym.range.start_col,
                "end_line": sym.range.end_line,
                "end_col": sym.range.end_col,
            },
        }

    def get_references(
        self, file_path: str, line: int, col: int
    ) -> list[dict]:
        """Get all references to the symbol at position."""
        sym = self.symbol_at_position(file_path, line, col)
        if sym is None:
            return []

        refs = self._ref_index.references_to_symbol(sym.name)
        results = []
        for ref_file, ref_line in refs:
            results.append({
                "file": ref_file,
                "range": {
                    "start_line": ref_line,
                    "start_col": 0,
                    "end_line": ref_line,
                    "end_col": 0,
                },
            })
        return results

    def get_completions(
        self, file_path: str, line: int, col: int, prefix: str = ""
    ) -> list[dict]:
        """Get completion candidates at a position."""
        results = []

        # File-local symbols
        fsyms = self._all_symbols.get(file_path)
        if fsyms:
            for sym in fsyms.all_symbols_flat:
                if prefix and not sym.name.lower().startswith(prefix.lower()):
                    continue
                results.append({
                    "label": sym.name,
                    "kind": sym.kind.value,
                    "detail": sym.signature,
                })

        # Imported symbols
        if fsyms:
            for imp in fsyms.imports:
                for name in imp.names:
                    if name == "*":
                        continue
                    if prefix and not name.lower().startswith(prefix.lower()):
                        continue
                    results.append({
                        "label": name,
                        "kind": "import",
                        "detail": f"from {imp.module}",
                    })

        # Deduplicate by label
        seen = set()
        deduped = []
        for r in results:
            if r["label"] not in seen:
                seen.add(r["label"])
                deduped.append(r)

        return sorted(deduped, key=lambda r: r["label"].lower())

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _discover_files(self) -> list[str]:
        """Discover all supported files in the repo."""
        supported_ext = self._parser.supported_extensions()
        files = []

        for ext in supported_ext:
            for fpath in self.repo_root.rglob(f"*{ext}"):
                # Skip hidden dirs and common excludes
                rel = str(fpath.relative_to(self.repo_root))
                if any(part.startswith(".") for part in fpath.parts):
                    continue
                if "node_modules" in rel or "__pycache__" in rel:
                    continue
                if fpath.is_file():
                    files.append(rel)

        return sorted(files)

    def _index_file(self, file_path: str, language: str) -> Optional[FileSymbols]:
        """Index a single file with caching."""
        full_path = self.repo_root / file_path
        if not full_path.exists():
            self._all_symbols.pop(file_path, None)
            return None

        try:
            mtime = full_path.stat().st_mtime
        except OSError:
            return None

        # Check cache
        cached = self._cache.get(file_path, mtime)
        if cached is not None:
            self._all_symbols[file_path] = cached
            return cached

        # Parse and extract
        try:
            source = full_path.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            log.warning("Cannot read %s: %s", file_path, e)
            return None

        # Skip binary-looking files
        if "\x00" in source[:8192]:
            return None

        tree = self._parser.parse(source, language)
        if tree is None:
            log.debug("Parse failed for %s", file_path)
            return None

        extractor = get_extractor(language)
        fsyms = extractor.extract(tree, source, file_path)
        fsyms.language = language

        # Cache
        self._cache.put(file_path, mtime, fsyms)
        self._cache.set_content_hash(file_path, SymbolCache.compute_hash(source))
        self._all_symbols[file_path] = fsyms

        return fsyms

    def _resolve_all_imports(self):
        """Resolve imports across all indexed files."""
        if self._import_resolver is None:
            return

        for fpath, fsyms in self._all_symbols.items():
            lang = fsyms.language
            for imp in fsyms.imports:
                target = None
                if lang == "python":
                    target = self._import_resolver.resolve_python_import(
                        imp.module, imp.level, fpath,
                    )
                elif lang in ("javascript", "typescript"):
                    target = self._import_resolver.resolve_js_import(
                        imp.module, fpath,
                    )
                elif lang in ("c", "cpp"):
                    target = self._import_resolver.resolve_c_include(imp.module)

                if target:
                    self._ref_index.register_import_edge(fpath, target)
