"""DocIndex — orchestrator for document analysis."""

import logging
import os
from pathlib import Path
from typing import Optional

from ac_dc.repo import EXCLUDED_DIRS
from ac_dc.doc_index.cache import DocCache
from ac_dc.doc_index.extractors import EXTRACTORS
from ac_dc.doc_index.formatter import DocFormatter
from ac_dc.doc_index.models import DocOutline
from ac_dc.doc_index.reference_index import DocReferenceIndex

logger = logging.getLogger(__name__)


class DocIndex:
    """Document analysis engine — extraction, caching, formatting, references.

    Parallels SymbolIndex but for documentation files (markdown, SVG).
    """

    def __init__(self, repo_root: str | Path,
                 keyword_model: Optional[str] = None):
        self._root = Path(repo_root).resolve()
        self._keyword_model = keyword_model
        self._cache = DocCache(repo_root=repo_root, keyword_model=keyword_model)
        self._formatter = DocFormatter()
        self._ref_index = DocReferenceIndex()
        self._all_outlines: dict[str, DocOutline] = {}
        self._enricher = None
        self._keywords_available: Optional[bool] = None

    @property
    def cache(self) -> DocCache:
        return self._cache

    @property
    def ref_index(self) -> DocReferenceIndex:
        return self._ref_index

    @property
    def keywords_available(self) -> bool:
        """Check if keyword enrichment is available."""
        if self._keywords_available is None:
            try:
                from ac_dc.doc_index.keyword_enricher import KeywordEnricher
                enricher = KeywordEnricher()
                self._keywords_available = enricher.available
            except Exception:
                self._keywords_available = False
        return self._keywords_available

    # ── Indexing ──────────────────────────────────────────────────

    def index_repo(self, repo_files: Optional[set[str]] = None) -> dict[str, DocOutline]:
        """Index all supported document files.

        Args:
            repo_files: Set of all repo file paths (for image reference validation).
        """
        files = self._get_doc_files()

        for path in files:
            self.index_file(path, repo_files=repo_files)

        self._finalize_index()
        return self._all_outlines

    def index_file(self, rel_path: str,
                   repo_files: Optional[set[str]] = None) -> Optional[DocOutline]:
        """Index a single document file (cache-aware)."""
        abs_path = self._root / rel_path

        if not abs_path.exists():
            self._cache.invalidate(rel_path)
            self._all_outlines.pop(rel_path, None)
            return None

        try:
            mtime = abs_path.stat().st_mtime
        except OSError:
            return None

        # Check cache
        cached = self._cache.get(rel_path, mtime, self._keyword_model)
        if cached is not None:
            self._all_outlines[rel_path] = cached
            return cached

        return self.index_file_structure_only(rel_path, repo_files=repo_files)

    def index_file_structure_only(self, rel_path: str,
                                  repo_files: Optional[set[str]] = None) -> Optional[DocOutline]:
        """Extract structure without keyword enrichment (instant)."""
        abs_path = self._root / rel_path

        if not abs_path.exists():
            return None

        try:
            mtime = abs_path.stat().st_mtime
        except OSError:
            return None

        ext = abs_path.suffix.lower()
        extractor_cls = EXTRACTORS.get(ext)
        if extractor_cls is None:
            return None

        try:
            content = abs_path.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            logger.warning(f"Cannot read {rel_path}: {e}")
            return None

        # Create extractor with repo files for validation
        try:
            extractor = extractor_cls(repo_files=repo_files or set())
        except TypeError:
            extractor = extractor_cls()

        try:
            outline = extractor.extract(rel_path, content)
        except Exception as e:
            logger.warning(f"Doc extraction failed for {rel_path}: {e}")
            return None

        # Cache without keyword model (unenriched)
        self._cache.put(rel_path, mtime, outline, keyword_model=None)
        self._all_outlines[rel_path] = outline

        return outline

    def enrich_single_file(self, rel_path: str) -> Optional[DocOutline]:
        """Run keyword enrichment on a single file (blocking)."""
        outline = self._all_outlines.get(rel_path)
        if not outline:
            return None

        # SVGs skip enrichment
        if rel_path.lower().endswith(".svg"):
            return outline

        abs_path = self._root / rel_path
        if not abs_path.exists():
            return None

        try:
            content = abs_path.read_text(encoding="utf-8", errors="replace")
            mtime = abs_path.stat().st_mtime
        except OSError:
            return None

        enricher = self._get_enricher()
        if not enricher or not enricher.available:
            return outline

        try:
            outline = enricher.enrich(outline, content)
        except Exception as e:
            logger.warning(f"Enrichment failed for {rel_path}: {e}")
            return outline

        # Update cache with enriched version
        self._cache.put(rel_path, mtime, outline, keyword_model=self._keyword_model)
        self._all_outlines[rel_path] = outline

        return outline

    def invalidate_file(self, rel_path: str):
        """Remove a file from the cache."""
        self._cache.invalidate(rel_path)
        self._all_outlines.pop(rel_path, None)

    def queue_enrichment(self, paths: list[str]):
        """Queue files for background enrichment (for async caller)."""
        # This is a marker method — the actual async scheduling is done
        # by the caller (LLMService). Returns the list of enrichable paths.
        return [p for p in paths if not p.lower().endswith(".svg")]

    # ── Document Map Output ───────────────────────────────────────

    def get_doc_map(self, exclude_files: Optional[set[str]] = None) -> str:
        """Get the full document index map."""
        exclude_files = exclude_files or set()
        filtered = {
            k: v for k, v in self._all_outlines.items()
            if k not in exclude_files
        }
        return self._formatter.format_map(filtered, self._ref_index, exclude_files)

    def get_legend(self) -> str:
        """Get the document index legend."""
        return self._formatter.get_legend()

    def get_file_doc_block(self, rel_path: str) -> Optional[str]:
        """Get the compact doc block for a single file."""
        outline = self._all_outlines.get(rel_path)
        if not outline:
            return None
        return self._formatter.format_file(rel_path, outline, self._ref_index)

    # ── Private Helpers ───────────────────────────────────────────

    def _get_doc_files(self) -> list[str]:
        """Get all supported document files in the repo."""
        files = []
        for dirpath, dirnames, filenames in os.walk(self._root):
            # Filter excluded dirs
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

    def _finalize_index(self):
        """Build reference index after all files are indexed."""
        self._ref_index.build(self._all_outlines)

    def _get_enricher(self):
        """Lazily create the keyword enricher."""
        if self._enricher is not None:
            return self._enricher

        try:
            from ac_dc.doc_index.keyword_enricher import KeywordEnricher
            self._enricher = KeywordEnricher(model_name=self._keyword_model or "BAAI/bge-small-en-v1.5")
            if not self._enricher.available:
                self._enricher = None
        except Exception:
            self._enricher = None

        return self._enricher