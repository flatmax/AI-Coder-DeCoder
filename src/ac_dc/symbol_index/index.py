"""Symbol index orchestrator — coordinates parsing, caching, resolution, and queries."""

import logging
import os
from pathlib import Path

from .cache import SymbolCache
from .compact_format import CompactFormatter
from .extractors import EXTRACTORS
from .import_resolver import ImportResolver
from .parser import TreeSitterParser
from .reference_index import ReferenceIndex

logger = logging.getLogger(__name__)


class SymbolIndex:
    """Main symbol index orchestrator.

    Coordinates: parsing → extraction → caching → import resolution →
    reference tracking → compact formatting → LSP queries.
    """

    def __init__(self, repo_root):
        self._root = Path(repo_root)
        self._parser = TreeSitterParser()
        self._cache = SymbolCache()
        self._resolver = ImportResolver(repo_root)
        self._ref_index = ReferenceIndex()
        self._formatter = CompactFormatter(self._ref_index)
        self._all_symbols = {}  # path -> FileSymbols

    @property
    def reference_index(self):
        return self._ref_index

    @property
    def cache(self):
        return self._cache

    def index_file(self, path):
        """Index a single file, using cache if possible.

        Args:
            path: relative path from repo root

        Returns:
            FileSymbols or None
        """
        abs_path = self._root / path
        if not abs_path.exists():
            return None

        try:
            mtime = abs_path.stat().st_mtime
        except OSError:
            return None

        # Check cache
        cached = self._cache.get(path, mtime)
        if cached:
            self._all_symbols[path] = cached
            return cached

        # Determine language
        language = self._parser.language_for_file(path)
        if not language:
            return None

        # Read source
        try:
            source = abs_path.read_bytes()
        except (OSError, UnicodeDecodeError):
            return None

        # Parse
        tree = self._parser.parse(source, language)
        if not tree:
            return None

        # Extract
        extractor_cls = EXTRACTORS.get(language)
        if not extractor_cls:
            return None

        extractor = extractor_cls()
        file_symbols = extractor.extract(tree, source, path)

        # Resolve imports
        for imp in file_symbols.imports:
            resolved = self._resolver.resolve(imp, path, language)
            # Store resolved path as target_file on call sites that match
            if resolved:
                for sym in file_symbols.all_symbols_flat:
                    for call in sym.call_sites:
                        if call.name in imp.names:
                            call.target_file = resolved

        # Cache and store
        self._cache.put(path, mtime, file_symbols)
        self._all_symbols[path] = file_symbols

        return file_symbols

    def index_repo(self, file_list=None):
        """Index all supported files in the repo.

        Args:
            file_list: optional list of relative paths. If None, walks the repo.

        Returns:
            dict of {path: FileSymbols}
        """
        if file_list is None:
            file_list = self._get_source_files()

        for path in file_list:
            try:
                self.index_file(path)
            except Exception as e:
                logger.warning(f"Failed to index {path}: {e}")

        # Build reference index
        self._ref_index.build(self._all_symbols)

        return self._all_symbols

    def _get_source_files(self):
        """Get all indexable source files."""
        files = []
        for dirpath, dirnames, filenames in os.walk(self._root):
            dirnames[:] = [d for d in dirnames
                          if not d.startswith('.') and d not in
                          ('node_modules', '__pycache__', 'venv', '.venv',
                           'dist', 'build', '.git', '.ac-dc')]
            for f in filenames:
                rel = os.path.relpath(os.path.join(dirpath, f), self._root)
                lang = self._parser.language_for_file(f)
                if lang:
                    files.append(rel)
        return sorted(files)

    def get_symbol_map(self, exclude_files=None, chunks=1):
        """Generate compact symbol map text.

        Args:
            exclude_files: files to exclude (e.g., active files in context)
            chunks: number of chunks for cache tier distribution

        Returns:
            str or list[str]
        """
        return self._formatter.format_all(
            self._all_symbols,
            exclude_files=exclude_files,
            chunks=chunks,
        )

    def get_file_symbol_block(self, path):
        """Get compact format for a single file."""
        fs = self._all_symbols.get(path)
        if not fs:
            return ""
        return self._formatter.format_file(path, fs)

    def get_legend(self):
        """Get the symbol map legend text."""
        return self._formatter.get_legend()

    def get_signature_hash(self, path):
        """Get content hash for a file's symbols."""
        return self._cache.get_hash(path)

    def invalidate_file(self, path):
        """Invalidate cache for a file."""
        self._cache.invalidate(path)
        self._all_symbols.pop(path, None)

    def save_symbol_map(self, output_path, exclude_files=None):
        """Save symbol map to file."""
        text = self.get_symbol_map(exclude_files=exclude_files)
        Path(output_path).write_text(text)

    # === LSP Queries ===

    def get_symbol_at_position(self, path, line, col):
        """Find deepest symbol at a given position."""
        fs = self._all_symbols.get(path)
        if not fs:
            return None

        best = None
        for sym in fs.all_symbols_flat:
            if (sym.start_line <= line <= sym.end_line):
                if best is None or (sym.end_line - sym.start_line) < (best.end_line - best.start_line):
                    best = sym

        # Check call sites
        if best:
            for call in best.call_sites:
                if call.line == line:
                    return call

        return best

    def lsp_get_hover(self, path, line, col):
        """Get hover info for a symbol."""
        sym = self.get_symbol_at_position(path, line, col)
        if sym is None:
            return None

        if hasattr(sym, 'kind'):
            # It's a Symbol
            parts = [f"{sym.kind} {sym.name}"]
            if sym.parameters:
                param_strs = []
                for p in sym.parameters:
                    s = p.name
                    if p.type_hint:
                        s += f": {p.type_hint}"
                    if p.default:
                        s += f" = {p.default}"
                    param_strs.append(s)
                parts[0] += f"({', '.join(param_strs)})"
            if sym.return_type:
                parts[0] += f" -> {sym.return_type}"
            if sym.bases:
                parts.append(f"extends: {', '.join(sym.bases)}")
            return {"contents": "\n".join(parts)}

        if hasattr(sym, 'target_file'):
            # It's a CallSite
            return {"contents": f"call: {sym.name}"}

        return None

    def lsp_get_definition(self, path, line, col):
        """Get definition location for a symbol."""
        sym = self.get_symbol_at_position(path, line, col)
        if sym is None:
            return None

        # If it's a call site with target
        if hasattr(sym, 'target_file') and sym.target_file:
            target_fs = self._all_symbols.get(sym.target_file)
            if target_fs:
                for s in target_fs.all_symbols_flat:
                    if s.name == sym.name:
                        return {"file": sym.target_file, "range": s.range}

        # If it's a symbol, return its own definition
        if hasattr(sym, 'range'):
            return {"file": path, "range": sym.range}

        return None

    def lsp_get_references(self, path, line, col):
        """Get all references to a symbol."""
        sym = self.get_symbol_at_position(path, line, col)
        if sym is None:
            return []

        name = sym.name if hasattr(sym, 'name') else None
        if not name:
            return []

        refs = self._ref_index.references_to_symbol(name)
        results = []
        for ref in refs:
            results.append({
                "file": ref["file"],
                "range": {
                    "start_line": ref["line"],
                    "start_col": 0,
                    "end_line": ref["line"],
                    "end_col": 0,
                },
            })
        return results

    def lsp_get_completions(self, path, line, col, prefix=""):
        """Get completion suggestions filtered by prefix."""
        completions = []

        fs = self._all_symbols.get(path)
        if not fs:
            return completions

        # File-local symbols
        for sym in fs.all_symbols_flat:
            if prefix and not sym.name.lower().startswith(prefix.lower()):
                continue
            completions.append({
                "label": sym.name,
                "kind": sym.kind,
                "detail": f"{sym.kind} in {path}",
            })

        # Imported symbols
        for imp in fs.imports:
            for name in imp.names:
                if prefix and not name.lower().startswith(prefix.lower()):
                    continue
                completions.append({
                    "label": name,
                    "kind": "import",
                    "detail": f"from {imp.module}",
                })

        return completions
