"""Document index orchestrator — coordinates extraction, caching, enrichment, and queries.

Parallels symbol_index/index.py but for markdown documents.
No tree-sitter dependency — uses regex-based extraction only.
"""

import logging
import os
from concurrent.futures import ThreadPoolExecutor
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
        self._cache = DocCache(repo_root=repo_root)
        self._ref_index = DocReferenceIndex()
        self._formatter = DocFormatter(self._ref_index)
        self._all_outlines = {}  # path -> DocOutline
        self._repo_files = None  # set of all repo file paths (for image ref validation)

        # Initialize keyword enricher from config
        kw_enabled = self._config.get("keywords_enabled", True)
        if kw_enabled:
            self._enricher = KeywordEnricher(
                model_name=self._config.get("keyword_model", "all-mpnet-base-v2"),
                top_n=self._config.get("keywords_top_n", 3),
                ngram_range=tuple(self._config.get("keywords_ngram_range", [1, 2])),
                min_section_chars=self._config.get("keywords_min_section_chars", 50),
                min_score=self._config.get("keywords_min_score", 0.3),
                diversity=self._config.get("keywords_diversity", 0.5),
                tfidf_fallback_chars=self._config.get("keywords_tfidf_fallback_chars", 150),
                max_doc_freq=self._config.get("keywords_max_doc_freq", 0.6),
            )
        else:
            self._enricher = None

    @property
    def reference_index(self):
        return self._ref_index

    @property
    def keywords_available(self):
        """Whether keyword enrichment is active (keybert installed and working)."""
        if self._enricher is None:
            return False
        return self._enricher.available

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
        outline = extractor.extract(path, text, repo_files=self._repo_files)

        # Enrich with keywords (skip SVG — text labels are already keywords)
        if self._enricher and ext != '.svg':
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

        # Build repo file set for image reference validation
        self._repo_files = self._get_all_repo_files()

        # Filter to supported extensions only
        doc_files = [
            f for f in file_list
            if Path(f).suffix.lower() in EXTRACTORS
        ]

        total = len(doc_files)
        if total == 0:
            return self._all_outlines

        # Phase 1: Structure extraction (fast)
        logger.info(f"Document index: extracting outlines from {total} files")
        if progress_callback:
            progress_callback("doc_index", "Extracting document outlines…", 10)

        needs_enrichment = self._extract_outlines(doc_files, total, progress_callback)

        logger.info(
            f"Structure extraction complete: {len(needs_enrichment)} files need enrichment, "
            f"{total - len(needs_enrichment)} cached"
        )

        # Phase 2: Keyword enrichment (slow, GIL-heavy)
        keyword_model = self._enricher.model_name if self._enricher else None
        self._enrich_files(needs_enrichment, keyword_model, progress_callback)

        # Phase 3: Build reference index
        self._finalize_index(progress_callback)

        logger.info(
            f"Document index: {len(self._all_outlines)} files, "
            f"{len(needs_enrichment)} newly indexed"
        )

        return self._all_outlines

    def _extract_outlines(self, doc_files, total, progress_callback=None):
        """Phase 1: Extract outlines from files, using cache where possible.

        Returns list of (path, mtime, outline, text) tuples that still
        need keyword enrichment.
        """
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
            outline = extractor.extract(path, text, repo_files=self._repo_files)

            # SVG text labels are already terse keywords — skip enrichment
            if ext == '.svg':
                self._cache.put(path, mtime, outline, keyword_model=keyword_model)
                self._all_outlines[path] = outline
            else:
                needs_enrichment.append((path, mtime, outline, text))

            if progress_callback:
                pct = 10 + int(20 * (i + 1) / total)
                progress_callback(
                    "doc_index",
                    f"Extracting outlines... ({i + 1}/{total} files)",
                    pct,
                )

        return needs_enrichment

    def _enrich_files(self, needs_enrichment, keyword_model, progress_callback=None):
        """Phase 2: Run keyword enrichment on extracted outlines.

        Separated from index_repo so _build_doc_index can run extraction
        in an executor (fast, I/O-bound) then call enrich_single_file
        per-file from the async context with yields between each,
        preventing GIL starvation of the event loop.

        Args:
            needs_enrichment: list of (path, mtime, outline, text) tuples
            keyword_model: model name string or None
            progress_callback: optional fn(stage, message, percent)
        """
        if not needs_enrichment:
            return

        if self._enricher:
            enrich_total = len(needs_enrichment)
            logger.info(f"Keyword enrichment: {enrich_total} files to process")

            # Trigger model init (may download) on the first file with the
            # progress callback, then enrich remaining files without it.
            first_path, first_mtime, first_outline, first_text = needs_enrichment[0]
            first_outline = self._enricher.enrich(
                first_outline, first_text, progress_callback=progress_callback,
            )
            self._cache.put(first_path, first_mtime, first_outline, keyword_model=keyword_model)
            self._all_outlines[first_path] = first_outline

            if progress_callback:
                pct = 30 + int(65 * 1 / enrich_total)
                progress_callback(
                    "doc_index",
                    f"Extracting keywords… (1/{enrich_total} files) — {first_path}",
                    pct,
                )
            logger.info(f"Keyword enrichment: 1/{enrich_total} — {first_path}")

            # Process remaining files with a thread pool for cache write overlap
            remaining = needs_enrichment[1:]
            if remaining:
                n_workers = min(4, len(remaining))
                with ThreadPoolExecutor(max_workers=n_workers) as pool:
                    for i, (path, mtime, outline, text) in enumerate(remaining, start=2):
                        outline = self._enricher.enrich(outline, text)
                        self._all_outlines[path] = outline
                        # Fire-and-forget disk cache write in a thread
                        pool.submit(
                            self._cache.put, path, mtime, outline,
                            keyword_model,
                        )

                        pct = 30 + int(65 * i / enrich_total)
                        logger.info(
                            f"Keyword enrichment: {i}/{enrich_total} — {path} ({pct}%)"
                        )
                        if progress_callback:
                            progress_callback(
                                "doc_index",
                                f"Extracting keywords… ({i}/{enrich_total} files) — {path}",
                                pct,
                            )
        else:
            # No enricher — just cache the outlines as-is
            for path, mtime, outline, text in needs_enrichment:
                self._cache.put(path, mtime, outline, keyword_model=keyword_model)
                self._all_outlines[path] = outline

    def _finalize_index(self, progress_callback=None):
        """Phase 3: Build reference index from accumulated outlines."""
        if progress_callback:
            progress_callback("doc_index", "Building cross-references...", 96)

        self._ref_index.build(self._all_outlines, repo_root=str(self._root))

        if progress_callback:
            progress_callback("doc_index", "Document indexing complete", 100)

    def enrich_single_file(self, path, mtime, outline, text, keyword_model=None,
                           progress_callback=None):
        """Enrich and cache a single file's outline.

        Called from LLMService._build_doc_index to process one file at a
        time with asyncio.sleep(0) between files, giving the event loop
        a chance to process WebSocket traffic between GIL-heavy enrichment.

        Args:
            path: relative file path
            mtime: file modification time
            outline: DocOutline from extraction phase
            text: file text content
            keyword_model: keyword model name or None
            progress_callback: optional fn(stage, message, percent) —
                               passed only for the first file to trigger
                               model init with progress reporting.

        Returns:
            enriched DocOutline
        """
        if self._enricher:
            outline = self._enricher.enrich(outline, text,
                                            progress_callback=progress_callback)
        self._cache.put(path, mtime, outline, keyword_model=keyword_model)
        self._all_outlines[path] = outline
        return outline

    def _get_all_repo_files(self):
        """Get set of all files in the repo (for image reference validation)."""
        files = set()
        for dirpath, dirnames, filenames in os.walk(self._root):
            dirnames[:] = [
                d for d in dirnames
                if not d.startswith('.') and d not in _SKIP_DIRS
            ]
            for f in filenames:
                rel = os.path.relpath(os.path.join(dirpath, f), self._root)
                files.add(rel.replace("\\", "/"))
        return files

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
