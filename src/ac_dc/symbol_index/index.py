"""SymbolIndex — orchestrator for code analysis."""

import logging
import os
from pathlib import Path
from typing import Optional

from ac_dc.repo import EXCLUDED_DIRS
from ac_dc.symbol_index.cache import SymbolCache
from ac_dc.symbol_index.compact_format import CompactFormatter
from ac_dc.symbol_index.extractors import EXTRACTORS
from ac_dc.symbol_index.import_resolver import ImportResolver
from ac_dc.symbol_index.models import FileSymbols
from ac_dc.symbol_index.parser import TreeSitterParser, language_for_file
from ac_dc.symbol_index.reference_index import ReferenceIndex

logger = logging.getLogger(__name__)


class SymbolIndex:
    """Code analysis engine — parsing, caching, formatting, references.

    Orchestrates tree-sitter parsing via language-specific extractors,
    caches results by mtime, builds a cross-file reference graph,
    and produces compact text output for LLM context and LSP queries.
    """

    def __init__(self, repo_root: str | Path):
        self._root = Path(repo_root).resolve()
        self._parser = TreeSitterParser()
        self._cache = SymbolCache()
        self._context_formatter = CompactFormatter(include_lines=False)
        self._lsp_formatter = CompactFormatter(include_lines=True)
        self._ref_index = ReferenceIndex()
        self._all_symbols: dict[str, FileSymbols] = {}
        self._import_resolver: Optional[ImportResolver] = None

    @property
    def cache(self) -> SymbolCache:
        return self._cache

    @property
    def ref_index(self) -> ReferenceIndex:
        return self._ref_index

    # ── Indexing ──────────────────────────────────────────────────

    def index_repo(self) -> dict[str, FileSymbols]:
        """Index all supported source files in the repository.

        Returns the dict of path -> FileSymbols.
        """
        files = self._get_source_files()
        file_set = set(files)

        # Initialize import resolver
        self._import_resolver = ImportResolver(self._root, file_set)

        for path in files:
            self.index_file(path)

        # Build reference index from all parsed symbols
        self._ref_index.build(self._all_symbols)

        return self._all_symbols

    def index_file(self, rel_path: str) -> Optional[FileSymbols]:
        """Index a single file (cache-aware).

        Returns FileSymbols or None if the file can't be parsed.
        """
        abs_path = self._root / rel_path

        if not abs_path.exists():
            self._cache.invalidate(rel_path)
            self._all_symbols.pop(rel_path, None)
            return None

        try:
            mtime = abs_path.stat().st_mtime
        except OSError:
            return None

        # Check cache
        cached = self._cache.get(rel_path, mtime)
        if cached is not None:
            self._all_symbols[rel_path] = cached
            return cached

        # Determine language and extractor
        ext = abs_path.suffix.lower()
        extractor_cls = EXTRACTORS.get(ext)
        if extractor_cls is None:
            return None

        lang = language_for_file(rel_path)

        # Read source
        try:
            source = abs_path.read_bytes()
        except OSError as e:
            logger.warning(f"Cannot read {rel_path}: {e}")
            return None

        # Parse
        tree = None
        if not extractor_cls.tree_optional:
            if lang and self._parser.has_language(lang):
                tree = self._parser.parse(source, lang)
                if tree is None:
                    logger.warning(f"Parse failed for {rel_path}")
                    return None
            else:
                # No grammar available
                return None

        # Extract
        extractor = extractor_cls()
        try:
            fs = extractor.extract(source, tree, rel_path)
        except Exception as e:
            logger.warning(f"Extraction failed for {rel_path}: {e}")
            return None

        # Resolve imports
        if self._import_resolver and fs.imports:
            for imp in fs.imports:
                resolved = self._import_resolver.resolve(imp, rel_path)
                # Store resolved path on call sites that match imported names
                if resolved:
                    for sym in fs.all_symbols_flat:
                        for call in sym.call_sites:
                            if call.name in imp.names:
                                call.target_file = resolved

        # Cache and store
        self._cache.put(rel_path, mtime, fs)
        self._all_symbols[rel_path] = fs

        return fs

    def invalidate_file(self, rel_path: str):
        """Remove a file from the cache (forces re-parse on next index)."""
        self._cache.invalidate(rel_path)
        self._all_symbols.pop(rel_path, None)

    # ── Symbol Map Output ─────────────────────────────────────────

    def get_symbol_map(self, exclude_files: Optional[set[str]] = None) -> str:
        """Get the full symbol map (context mode, no line numbers)."""
        return self._context_formatter.format_map(
            self._all_symbols, self._ref_index, exclude_files,
        )

    def get_lsp_symbol_map(self, exclude_files: Optional[set[str]] = None) -> str:
        """Get the full symbol map (LSP mode, with line numbers)."""
        return self._lsp_formatter.format_map(
            self._all_symbols, self._ref_index, exclude_files,
        )

    def get_legend(self) -> str:
        """Get the context-mode legend."""
        return self._context_formatter.get_legend()

    def get_lsp_legend(self) -> str:
        """Get the LSP-mode legend."""
        return self._lsp_formatter.get_legend()

    def get_file_symbol_block(self, rel_path: str) -> Optional[str]:
        """Get the compact symbol block for a single file."""
        fs = self._all_symbols.get(rel_path)
        if not fs:
            return None
        return self._context_formatter.format_file(
            rel_path, fs, self._ref_index,
        )

    def get_chunks(self, exclude_files: Optional[set[str]] = None,
                   num_chunks: int = 4) -> list[str]:
        """Get the symbol map split into chunks."""
        return self._context_formatter.format_chunks(
            self._all_symbols, self._ref_index, exclude_files, num_chunks,
        )

    # ── LSP Queries ───────────────────────────────────────────────

    def lsp_get_hover(self, path: str, line: int, col: int) -> Optional[dict]:
        """Get hover info for a position."""
        sym = self._find_symbol_at(path, line, col)
        if not sym:
            return None
        return {"contents": self._format_hover(sym)}

    def lsp_get_definition(self, path: str, line: int, col: int) -> Optional[dict]:
        """Go to definition for a position."""
        fs = self._all_symbols.get(path)
        if not fs:
            return None

        # Check call sites first
        for sym in fs.all_symbols_flat:
            for call in sym.call_sites:
                if call.line == line:
                    if call.target_file and call.target_symbol:
                        target_fs = self._all_symbols.get(call.target_file)
                        if target_fs:
                            for tsym in target_fs.all_symbols_flat:
                                if tsym.name == call.target_symbol:
                                    return {
                                        "file": call.target_file,
                                        "range": tsym.range,
                                    }
                        return {"file": call.target_file, "range": {
                            "start_line": 1, "start_col": 0,
                            "end_line": 1, "end_col": 0,
                        }}

        # Check imports
        for imp in fs.imports:
            if imp.line == line:
                resolved = None
                if self._import_resolver:
                    resolved = self._import_resolver.resolve(imp, path)
                if resolved:
                    return {"file": resolved, "range": {
                        "start_line": 1, "start_col": 0,
                        "end_line": 1, "end_col": 0,
                    }}

        # Local symbol
        sym = self._find_symbol_at(path, line, col)
        if sym:
            return {"file": path, "range": sym.range}

        return None

    def lsp_get_references(self, path: str, line: int, col: int) -> list[dict]:
        """Find all references to the symbol at position."""
        sym = self._find_symbol_at(path, line, col)
        if not sym:
            return []
        refs = self._ref_index.references_to_symbol(sym.name)
        return [{"file": r["file"], "range": {
            "start_line": r["line"], "start_col": 0,
            "end_line": r["line"], "end_col": 0,
        }} for r in refs]

    def lsp_get_completions(self, path: str, line: int, col: int,
                            prefix: Optional[str] = None) -> list[dict]:
        """Get completions filtered by prefix."""
        completions = []
        if not prefix:
            return completions

        lower_prefix = prefix.lower()

        # File-local symbols
        fs = self._all_symbols.get(path)
        if fs:
            for sym in fs.all_symbols_flat:
                if sym.name.lower().startswith(lower_prefix):
                    completions.append({
                        "label": sym.name,
                        "kind": sym.kind,
                        "detail": self._format_hover(sym),
                    })

        # Imported symbols
        if fs:
            for imp in fs.imports:
                for name in imp.names:
                    if name.lower().startswith(lower_prefix):
                        completions.append({
                            "label": name,
                            "kind": "import",
                            "detail": f"from {imp.module}",
                        })

        return completions

    # ── Private Helpers ───────────────────────────────────────────

    def _get_source_files(self) -> list[str]:
        """Get all supported source files in the repo."""
        files = []
        for dirpath, dirnames, filenames in os.walk(self._root):
            # Filter excluded dirs in-place
            dirnames[:] = [
                d for d in dirnames
                if d not in EXCLUDED_DIRS
                and not (d.startswith(".") and d != ".github")
            ]

            for fname in filenames:
                ext = Path(fname).suffix.lower()
                if ext in EXTRACTORS:
                    rel = os.path.relpath(os.path.join(dirpath, fname), self._root)
                    rel = rel.replace("\\", "/")
                    files.append(rel)

        return sorted(files)

    def _find_symbol_at(self, path: str, line: int, col: int) -> Optional[object]:
        """Find the deepest symbol at a given position."""
        fs = self._all_symbols.get(path)
        if not fs:
            return None

        best = None
        best_size = float("inf")

        for sym in fs.all_symbols_flat:
            r = sym.range
            if (r["start_line"] <= line <= r["end_line"]):
                size = r["end_line"] - r["start_line"]
                if size < best_size:
                    best = sym
                    best_size = size

        return best

    def _format_hover(self, sym) -> str:
        """Format hover text for a symbol."""
        parts = [f"{sym.kind} {sym.name}"]
        if sym.parameters:
            param_strs = []
            for p in sym.parameters:
                ps = p.name
                if p.type_hint:
                    ps += f": {p.type_hint}"
                if p.default is not None:
                    ps += f" = {p.default}"
                param_strs.append(ps)
            parts[0] += f"({', '.join(param_strs)})"
        if sym.return_type:
            parts[0] += f" -> {sym.return_type}"
        if sym.bases:
            parts.append(f"extends: {', '.join(sym.bases)}")
        return "\n".join(parts)

    def save_symbol_map(self, ac_dc_dir: Path):
        """Save the context symbol map to .ac-dc/symbol_map.txt."""
        path = ac_dc_dir / "symbol_map.txt"
        content = self.get_symbol_map()
        path.write_text(content, encoding="utf-8")