"""Document index orchestrator — coordinates extraction, caching, enrichment, and queries.

Parallels symbol_index/index.py but for markdown documents.
No tree-sitter dependency — uses regex-based extraction only.
"""

import logging
import os
from pathlib import Path

from .cache import DocCache
from .extractors import EXTRACTORS
from .formatter import DocFormatter
from .keyword_enricher import KeywordEnricher
from .reference_index import DocReferenceIndex

logger = logging.getLogger(__name__)

# Directories to skip during file discovery
_SKIP_DIRS = {
    '.git', '.ac-dc', 'node_modules', '__pycache__',
    'venv', '.venv', 'dist', 'build',
}


class DocIndex:
    """Main document index orchestrator.

    Coordinates: file discovery → extraction → keyword enrichment →
    caching → reference tracking → compact formatting.
    """

    def __init__(self, repo_root, doc_config=None):
        """Initialize document index.

        Args:
            repo_root: path to repository root
            doc_config: dict from app.json doc_index section
        """
        self._root = Path(repo_root)
        self._config = doc_config or {}
        self._cache = DocCache()
        self._ref_index = DocReferenceIndex()
        self._formatter = DocFormatter(self._ref_index)
        self._all_outlines = {}  # path -> DocOutline

        # Initialize keyword enricher from config
        kw_enabled = self._config.get("keywords_enabled", True)
        if kw_enabled:
            self._enricher = KeywordEnricher(
                model_name=self._config.get("keyword_model", "all-mpnet-base-v2"),
                top_n=self._config.get("keywords_top_n", 3),
                ngram_range=tuple(self._config.get("keywords_ngram_range", [1, 2])),
                min_section_chars=self._config.get("keywords_min_section_chars", 50),
                min_score=self._config.get("keywords_min_score", 0.3),
            )
        else:
            self._enricher = None

    @property
    def reference_index(self):
        return self._ref_index

    @property
    def cache(self):
        return self._cache

    def index_file(self, path):
        """Index a single markdown file, using cache if possible.

        Args:
            path: relative path from repo root

        Returns:
            DocOutline or None
        """
        abs_path = self._root / path
        if not abs_path.exists():
            return None

        ext = abs_path.suffix.lower()
        extractor_cls = EXTRACTORS.get(ext)
        if not extractor_cls:
            return None

        try:
            mtime = abs_path.stat().st_mtime
        except OSError:
            return None

        # Check cache (including keyword model match)
        keyword_model = self._enricher.model_name if self._enricher else None
        cached = self._cache.get(path, mtime, keyword_model=keyword_model)
        if cached:
            self._all_outlines[path] = cached
            return cached

        # Read file
        try:
            text = abs_path.read_text(errors="replace")
        except OSError:
            return None

        # Extract outline
        extractor = extractor_cls()
        outline = extractor.extract(path, text)

        # Enrich with keywords
        if self._enricher:
            outline = self._enricher.enrich(outline, text)

        # Cache
        self._cache.put(path, mtime, outline, keyword_model=keyword_model)
        self._all_outlines[path] = outline

        return outline

    def index_repo(self, file_list=None, progress_callback=None):
        """Index all markdown files in the repo.

        Args:
            file_list: optional list of relative paths to index.
                       If None, discovers .md files automatically.
            progress_callback: optional fn(stage, message, percent)

        Returns:
            dict of {path: DocOutline}
        """
        if file_list is None:
            file_list = self._get_doc_files()

        # Filter to supported extensions only
        doc_files = [
            f for f in file_list
            if Path(f).suffix.lower() in EXTRACTORS
        ]

        total = len(doc_files)
        if total == 0:
            return self._all_outlines

        # Phase 1: Structure extraction (fast)
        if progress_callback:
            progress_callback("doc_index", "Extracting document outlines...", 10)

        # Determine which files need (re)indexing
        needs_enrichment = []
        keyword_model = self._enricher.model_name if self._enricher else None

        for i, path in enumerate(doc_files):
            abs_path = self._root / path
            if not abs_path.exists():
                continue

            try:
                mtime = abs_path.stat().st_mtime
            except OSError:
                continue

            # Check cache
            cached = self._cache.get(path, mtime, keyword_model=keyword_model)
            if cached:
                self._all_outlines[path] = cached
                continue

            # Read and extract
            ext = abs_path.suffix.lower()
            extractor_cls = EXTRACTORS.get(ext)
            if not extractor_cls:
                continue

            try:
                text = abs_path.read_text(errors="replace")
            except OSError:
                continue

            extractor = extractor_cls()
            outline = extractor.extract(path, text)
            needs_enrichment.append((path, mtime, outline, text))

            if progress_callback:
                pct = 10 + int(20 * (i + 1) / total)
                progress_callback(
                    "doc_index",
                    f"Extracting outlines... ({i + 1}/{total} files)",
                    pct,
                )

        # Phase 2: Keyword enrichment (slow)
        if needs_enrichment and self._enricher:
            for i, (path, mtime, outline, text) in enumerate(needs_enrichment):
                # On the first file, pass progress_callback so the enricher
                # can report model loading / download progress (0–10%).
                enrich_cb = progress_callback if i == 0 else None
                outline = self._enricher.enrich(outline, text, progress_callback=enrich_cb)
                self._cache.put(path, mtime, outline, keyword_model=keyword_model)
                self._all_outlines[path] = outline

                if progress_callback:
                    pct = 30 + int(65 * (i + 1) / len(needs_enrichment))
                    progress_callback(
                        "doc_index",
                        f"Extracting keywords... ({i + 1}/{len(needs_enrichment)} files)",
                        pct,
                    )
        elif needs_enrichment:
            # No enricher — just cache the outlines as-is
            for path, mtime, outline, text in needs_enrichment:
                self._cache.put(path, mtime, outline, keyword_model=keyword_model)
                self._all_outlines[path] = outline

        # Phase 3: Build reference index
        if progress_callback:
            progress_callback("doc_index", "Building cross-references...", 96)

        self._ref_index.build(self._all_outlines, repo_root=str(self._root))

        if progress_callback:
            progress_callback("doc_index", "Document indexing complete", 100)

        logger.info(
            f"Document index: {len(self._all_outlines)} files, "
            f"{len(needs_enrichment)} newly indexed"
        )

        return self._all_outlines

    def _get_doc_files(self):
        """Get all indexable document files."""
        files = []
        for dirpath, dirnames, filenames in os.walk(self._root):
            dirnames[:] = [
                d for d in dirnames
                if not d.startswith('.') and d not in _SKIP_DIRS
            ]
            for f in filenames:
                ext = os.path.splitext(f)[1].lower()
                if ext in EXTRACTORS:
                    rel = os.path.relpath(os.path.join(dirpath, f), self._root)
                    files.append(rel.replace("\\", "/"))
        return sorted(files)

    def get_doc_map(self, exclude_files=None, chunks=1):
        """Generate compact document map text.

        Args:
            exclude_files: files to exclude
            chunks: number of chunks for cache tier distribution

        Returns:
            str or list[str]
        """
        return self._formatter.format_all(
            self._all_outlines,
            exclude_files=exclude_files,
            chunks=chunks,
        )

    def get_file_doc_block(self, path):
        """Get compact format for a single file."""
        outline = self._all_outlines.get(path)
        if not outline:
            return ""
        return self._formatter.format_file(path, outline)

    def get_legend(self):
        """Get the document map legend text."""
        return self._formatter.get_legend()

    def get_signature_hash(self, path):
        """Get content hash for a file's outline."""
        return self._cache.get_hash(path)

    def invalidate_file(self, path):
        """Invalidate cache for a file."""
        self._cache.invalidate(path)
        self._all_outlines.pop(path, None)

    def save_doc_map(self, output_path, exclude_files=None):
        """Save document map to file."""
        text = self._formatter.format_all(
            self._all_outlines, exclude_files=exclude_files,
        )
        Path(output_path).write_text(text)