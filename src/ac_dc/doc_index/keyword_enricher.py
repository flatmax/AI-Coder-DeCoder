"""Keyword enricher — Layer 2.8.4a (availability probe).

This module provides :class:`KeywordEnricher`, the entry point for
keyword extraction over :class:`~ac_dc.doc_index.models.DocOutline`
objects. It's built in three stages:

- **2.8.4a (this file, current state):** construction + availability
  probe + lazy model loading. No extraction yet — every public
  method raises or returns empty. This lets callers wire the
  enricher into the service and test the graceful-degradation
  path (KeyBERT missing) before any real extraction code lands.
- **2.8.4b:** ``enrich_outline`` — batched extraction with MMR,
  code stripping, TF-IDF fallback, corpus-aware filtering,
  adaptive top-n.
- **2.8.4c:** orchestrator integration — ``enrich_single_file``,
  ``queue_enrichment``, in-place cache entry replacement.

Governing spec: ``specs4/2-indexing/keyword-enrichment.md``.

Design notes pinned here:

- **Tristate availability flag.** ``_available`` is one of
  ``None`` (not yet probed), ``True`` (KeyBERT + sentence-
  transformers importable), ``False`` (ImportError or other
  failure during load). A missing library shows up the same
  way as a broken install — the enricher degrades to "produce
  no keywords" rather than crashing the caller.

- **Lazy model load.** The sentence-transformer model is heavy
  (200MB+ download, multi-second load). We don't load in
  ``__init__`` — only when :meth:`ensure_loaded` is called.
  The service layer (2.8.4d) calls ``ensure_loaded`` eagerly
  during the startup background phase so the first mode
  switch doesn't block on a model download.

- **Broad ImportError catch.** Matches the pattern in
  :class:`ac_dc.doc_convert.DocConvert._probe_import`. A
  module that installs but fails on import (version mismatch,
  missing native dependency, corrupted install) should show
  as unavailable rather than propagating the exception.

- **Model name is the cache key.** When the user changes the
  configured model, the enricher re-initialises with the new
  model; cached outlines with a different ``keyword_model``
  entry are refused by :meth:`DocCache.get` and trigger
  re-extraction. That machinery already exists in the doc
  cache; this module just holds the name as state for
  construction.

- **No global singleton.** Each :class:`LLMService` constructs
  its own enricher. Parallel-agent mode (Layer 7) wants one
  per agent so the D10 "per-context-manager scoping"
  contract holds uniformly.
"""

from __future__ import annotations

import importlib
import logging
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    # Forward reference for type hints without paying the import
    # cost on module load. None of these are imported at runtime
    # by this file — the enricher holds them as Any.
    from ac_dc.doc_index.models import DocOutline


logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Module constants
# ---------------------------------------------------------------------------


# Default model — matches the config default in `app.json`.
# Small, fast, English-focused. Users can override via
# `config.doc_index_config["keyword_model"]`.
_DEFAULT_MODEL_NAME = "BAAI/bge-small-en-v1.5"


# ---------------------------------------------------------------------------
# KeywordEnricher
# ---------------------------------------------------------------------------


class KeywordEnricher:
    """Keyword extraction for document outlines.

    Construct with the sentence-transformer model name (or leave
    default). Probe availability via :meth:`is_available`.
    Enrich outlines via :meth:`enrich_outline` (2.8.4b — not yet
    implemented; currently returns the outline unchanged).

    Thread-safety: not thread-safe. The service layer serialises
    enrichment calls through a single-worker executor slot in
    the aux pool. If parallel enrichment ever becomes useful,
    construct multiple instances.
    """

    def __init__(
        self,
        model_name: str = _DEFAULT_MODEL_NAME,
    ) -> None:
        """Initialise. Does NOT load the model yet — see
        :meth:`ensure_loaded`.

        Parameters
        ----------
        model_name:
            Sentence-transformer model identifier. Must match
            what's configured in ``app.json``'s
            ``doc_index.keyword_model`` — the cache uses this
            string as part of its hit criterion, so mismatches
            force re-extraction.
        """
        self._model_name = model_name
        # Tristate: None=unchecked, True=ready, False=unavailable.
        # Flipping to False is sticky — once we've observed the
        # library missing, we don't retry (avoids repeated
        # ImportError noise in the log on every file).
        self._available: bool | None = None
        # The KeyBERT instance. Populated by ensure_loaded on
        # first successful check. Held as Any so the type hint
        # doesn't leak KeyBERT into our public surface.
        self._model: Any = None

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def model_name(self) -> str:
        """The configured sentence-transformer model name."""
        return self._model_name

    @property
    def is_loaded(self) -> bool:
        """True when the KeyBERT model is constructed and ready.

        Distinct from :meth:`is_available` — a module may be
        importable (available) but not yet loaded into memory.
        Tests assert on this to verify lazy loading.
        """
        return self._model is not None

    # ------------------------------------------------------------------
    # Availability probing
    # ------------------------------------------------------------------

    def is_available(self) -> bool:
        """Return True when KeyBERT + sentence-transformers import.

        Cached after the first call — subsequent calls return the
        cached result without re-probing. Use
        :meth:`reset_availability` to force a re-probe (useful in
        tests).

        Does NOT load the model — just checks that the modules
        import cleanly. Loading happens in :meth:`ensure_loaded`.

        A library that installs but fails on import (version
        mismatch, missing native dependency, corrupt install)
        shows as unavailable. The broad exception catch matches
        :class:`DocConvert._probe_import`.
        """
        if self._available is not None:
            return self._available
        self._available = self._probe()
        return self._available

    def _probe(self) -> bool:
        """Run the actual import check.

        Separate method so tests can patch it. Checks for both
        KeyBERT (primary API) and sentence-transformers (the
        embedding model backend). Either missing → unavailable.
        """
        for module_name in ("keybert", "sentence_transformers"):
            try:
                importlib.import_module(module_name)
            except Exception as exc:
                # Broad catch: ImportError is the expected case,
                # but transformers / sentence-transformers can
                # raise RuntimeError on version mismatch or
                # missing CUDA libraries, and we want to degrade
                # for all of them uniformly.
                logger.info(
                    "Keyword enrichment unavailable — %s could "
                    "not be imported: %s. Install with: pip "
                    "install 'ac-dc[docs]'",
                    module_name, exc,
                )
                return False
        return True

    def reset_availability(self) -> None:
        """Clear the cached availability result.

        Tests call this to force a re-probe after monkeypatching
        the import system. Not useful in production — the answer
        doesn't change at runtime.
        """
        self._available = None

    # ------------------------------------------------------------------
    # Model loading
    # ------------------------------------------------------------------

    def ensure_loaded(self) -> bool:
        """Load the KeyBERT model if not already loaded.

        Returns True when the model is ready to use, False when
        the libraries aren't available. Safe to call repeatedly
        — once loaded, subsequent calls are no-ops.

        The sentence-transformer model is loaded via KeyBERT's
        default constructor, which probes the Hugging Face
        cache and downloads the model if missing. First call
        on a fresh install can take 10+ seconds for the
        download; subsequent calls are near-instant.

        The service layer (2.8.4d) calls this eagerly during
        startup so the first mode switch or chat request
        doesn't block on the download.
        """
        if self._model is not None:
            return True
        if not self.is_available():
            return False
        try:
            # Lazy import so module load doesn't pay the cost
            # when the enricher is constructed but never used.
            from keybert import KeyBERT  # type: ignore[import-not-found]
        except Exception as exc:
            # Shouldn't happen given is_available() passed, but
            # defensive against a race where the library becomes
            # unavailable between probe and load (e.g., a stray
            # uninstall mid-session).
            logger.warning(
                "KeyBERT import failed after availability "
                "check passed: %s. Marking unavailable.",
                exc,
            )
            self._available = False
            return False

        try:
            self._model = KeyBERT(model=self._model_name)
        except Exception as exc:
            # Model download / construction failure. Common
            # causes: no internet, invalid model name, disk
            # full during download, Hugging Face Hub rate
            # limit. Degrade to unavailable so the rest of
            # doc mode still works.
            logger.warning(
                "KeyBERT model %r failed to load: %s. "
                "Keyword enrichment disabled for this session.",
                self._model_name, exc,
            )
            self._available = False
            self._model = None
            return False
        return True

    # ------------------------------------------------------------------
    # Enrichment surface (stubs for 2.8.4a)
    # ------------------------------------------------------------------

    def enrich_outline(
        self,
        outline: "DocOutline",
        source_text: str = "",
    ) -> "DocOutline":
        """Enrich an outline with keywords per section / prose block.

        **Not yet implemented.** Full implementation lands in
        2.8.4b. For now, returns the outline unchanged so callers
        can wire in the enricher without committing to a specific
        extraction behaviour.

        When implemented, will:

        - Collect eligible sections (headings with text ≥
          ``keywords_min_section_chars``) and SVG prose blocks
          into a single batch
        - Call KeyBERT once with all section texts (batch
          encoding via the sentence transformer)
        - Apply MMR diversity to reduce near-duplicate keywords
        - Apply a corpus-aware document-frequency filter
          (bigrams only filtered when all constituent unigrams
          exceed threshold)
        - Use TF-IDF fallback for sections below
          ``keywords_tfidf_fallback_chars``
        - Attach keywords to :attr:`DocHeading.keywords` and
          :attr:`DocProseBlock.keywords` in place
        - Return the mutated outline

        Parameters
        ----------
        outline:
            The outline to enrich. Modified in place; also
            returned for call-chaining convenience.
        source_text:
            Full source text. Needed for section slicing in the
            markdown case (section text = lines between this
            heading and the next). Unused for SVG outlines
            (prose blocks carry their text inline).
        """
        # Parameters unused in the stub. Preserved on the signature
        # so 2.8.4b can drop in the real implementation without
        # call sites changing.
        del source_text
        return outline

    def is_section_eligible(
        self,
        heading_text_length: int,
        min_chars: int,
    ) -> bool:
        """Return True when a section's text is long enough to enrich.

        Exposed as a method so tests can pin the threshold
        comparison logic without constructing full outlines.
        The actual enrichment (2.8.4b) uses this to decide
        whether a section joins the batch or gets skipped.

        Parameters
        ----------
        heading_text_length:
            Character count of the section's content (not the
            heading text itself — the body text beneath).
        min_chars:
            Threshold from config (
            ``doc_index.keywords_min_section_chars``).
        """
        return heading_text_length >= min_chars