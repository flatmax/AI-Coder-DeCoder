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
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    # Forward reference for type hints without paying the import
    # cost on module load. None of these are imported at runtime
    # by this file — the enricher holds them as Any.
    from ac_dc.doc_index.models import DocHeading, DocOutline, DocProseBlock


logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Module constants
# ---------------------------------------------------------------------------


# Default model — matches the config default in `app.json`.
# Small, fast, English-focused. Users can override via
# `config.doc_index_config["keyword_model"]`.
_DEFAULT_MODEL_NAME = "BAAI/bge-small-en-v1.5"


# Adaptive top-n: sections at or above this line count get extra
# keywords. Spec'd in specs4/2-indexing/keyword-enrichment.md —
# "Large sections get extra keywords to capture vocabulary from
# multiple branches". 15 lines is the cutoff.
_LARGE_SECTION_LINE_THRESHOLD = 15
_LARGE_SECTION_TOPN_BONUS = 2


# Regex patterns for code stripping. Fenced code blocks (both
# backtick and tilde, 3+ chars, with optional language info
# string on the opener) and inline code spans. Not CommonMark-
# exact — handles the common cases without a full markdown
# parser. Unmatched openers and unterminated spans are left
# in the text, which is fine since KeyBERT doesn't care about
# syntactic validity.
_FENCED_CODE_RE = re.compile(
    r"^(```|~~~)[^\n]*\n.*?^\1\s*$",
    re.MULTILINE | re.DOTALL,
)
_INLINE_CODE_RE = re.compile(r"`[^`\n]+`")


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EnrichmentConfig:
    """Runtime knobs for keyword extraction.

    Read from :attr:`ConfigManager.doc_index_config` and passed
    into :meth:`KeywordEnricher.enrich_outline`. Frozen so
    callers can't mutate mid-enrichment and cause a batch to
    half-apply old values and half-apply new ones.

    Fields match the config keys in ``app.json``'s ``doc_index``
    section — see ``specs4/2-indexing/keyword-enrichment.md`` for
    semantics. Defaults mirror the values in
    :attr:`ConfigManager.doc_index_config`.
    """

    top_n: int = 3
    ngram_range: tuple[int, int] = (1, 2)
    min_section_chars: int = 50
    min_score: float = 0.3
    diversity: float = 0.5
    tfidf_fallback_chars: int = 150
    max_doc_freq: float = 0.6

    @classmethod
    def from_dict(cls, cfg: dict[str, Any]) -> "EnrichmentConfig":
        """Build from the ``doc_index_config`` dict shape.

        Uses ``.get`` with defaults so a partial config doesn't
        crash — matches :attr:`ConfigManager.doc_index_config`'s
        lenient parsing.
        """
        ngram_raw = cfg.get("keywords_ngram_range", [1, 2])
        if (
            isinstance(ngram_raw, (list, tuple))
            and len(ngram_raw) == 2
        ):
            ngram = (int(ngram_raw[0]), int(ngram_raw[1]))
        else:
            ngram = (1, 2)
        return cls(
            top_n=int(cfg.get("keywords_top_n", 3)),
            ngram_range=ngram,
            min_section_chars=int(
                cfg.get("keywords_min_section_chars", 50)
            ),
            min_score=float(cfg.get("keywords_min_score", 0.3)),
            diversity=float(cfg.get("keywords_diversity", 0.5)),
            tfidf_fallback_chars=int(
                cfg.get("keywords_tfidf_fallback_chars", 150)
            ),
            max_doc_freq=float(
                cfg.get("keywords_max_doc_freq", 0.6)
            ),
        )


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
    # Enrichment entry point
    # ------------------------------------------------------------------

    def enrich_outline(
        self,
        outline: "DocOutline",
        source_text: str = "",
        config: EnrichmentConfig | None = None,
    ) -> "DocOutline":
        """Enrich an outline with keywords per section / prose block.

        Mutates the outline in place: populates
        :attr:`DocHeading.keywords` for eligible markdown
        sections and :attr:`DocProseBlock.keywords` for SVG
        prose blocks. Returns the same outline for call-
        chaining convenience.

        Pipeline:

        1. Collect eligible units — each is a tuple of
           ``(target, text, line_count)`` where ``target`` is
           the heading or prose block object, ``text`` is the
           content to extract from (with code stripped for
           markdown), and ``line_count`` feeds the adaptive
           top-n rule.
        2. Split units into two groups by text length:
           short → TF-IDF fallback, long → KeyBERT embedding
           extraction.
        3. Run KeyBERT once per group with the batch of texts.
        4. Apply min-score filter inside each candidate list.
        5. Apply corpus-aware document-frequency filter across
           the whole document (bigrams survive if any
           constituent unigram is below threshold — specs4).
        6. Attach the resulting keyword lists to their targets
           in place.

        When KeyBERT isn't available (probe failed, model
        missing), this method returns the outline unchanged.
        Callers check :meth:`is_available` before calling to
        avoid the no-op round trip, but calling anyway is safe.

        Parameters
        ----------
        outline:
            The outline to enrich. Modified in place; also
            returned for call-chaining.
        source_text:
            Full source text. Required for markdown outlines —
            section text is sliced from this using each
            heading's ``start_line``. Ignored for SVG outlines
            (prose blocks carry their text inline).
        config:
            Enrichment parameters. Defaults to
            :class:`EnrichmentConfig`'s default values when
            None.
        """
        cfg = config or EnrichmentConfig()

        # Graceful degradation: no keywords if the model isn't
        # ready. Callers can still call in a loop without
        # checking availability first; this just no-ops.
        if not self.ensure_loaded():
            return outline

        # Step 1 — collect eligible units. Headings need their
        # section text sliced from the source; prose blocks
        # carry their text already.
        units = self._collect_units(outline, source_text, cfg)
        if not units:
            return outline

        # Step 2 — partition by length. Below the TF-IDF
        # fallback threshold, use TF-IDF; at or above, use
        # KeyBERT embeddings. The two paths produce the same
        # shape (list of (keyword, score) tuples per unit) so
        # the downstream filter steps are uniform.
        short_units: list[tuple[Any, str, int]] = []
        long_units: list[tuple[Any, str, int]] = []
        for unit in units:
            target, text, lines = unit
            if len(text) < cfg.tfidf_fallback_chars:
                short_units.append(unit)
            else:
                long_units.append(unit)

        long_results = self._run_keybert_batch(long_units, cfg)
        short_results = self._run_tfidf_batch(short_units, cfg)

        # Index by target identity so we can stitch the two
        # results back into outline order.
        by_target: dict[int, list[tuple[str, float]]] = {}
        for unit, kws in zip(long_units, long_results):
            by_target[id(unit[0])] = kws
        for unit, kws in zip(short_units, short_results):
            by_target[id(unit[0])] = kws

        # Step 5 — corpus-aware document-frequency filter.
        # Operates on the whole document at once so filtering
        # is contrastive against siblings.
        filtered = self._apply_corpus_filter(units, by_target, cfg)

        # Step 6 — attach keywords in place.
        for target, _text, _lines in units:
            kws = filtered.get(id(target), [])
            target.keywords = [kw for kw, _score in kws]

        return outline

    # ------------------------------------------------------------------
    # Unit collection
    # ------------------------------------------------------------------

    def _collect_units(
        self,
        outline: "DocOutline",
        source_text: str,
        cfg: EnrichmentConfig,
    ) -> list[tuple[Any, str, int]]:
        """Collect eligible (target, text, line_count) tuples.

        Walks the outline's flat heading list and its prose
        blocks. For each heading, slices its section text from
        the source via ``start_line`` and the next heading's
        ``start_line`` (or end of file for the last heading).
        For prose blocks, uses the inline ``text`` field.

        Filters:

        - Empty text — skipped
        - Text below ``min_section_chars`` — skipped
        - Code-stripped text that becomes empty — falls back
          to unstripped text (matches the spec's "sections
          that become empty after stripping fall back to
          unstripped text")

        Returns units in document order: headings first
        (depth-first flattened), then prose blocks.
        """
        units: list[tuple[Any, str, int]] = []
        headings = outline.all_headings_flat

        # Build (heading, body_text, line_count) for each.
        # Section body is the text between this heading's
        # start_line and the next heading's start_line. The
        # last heading runs to end-of-file.
        if source_text and headings:
            source_lines = source_text.split("\n")
            total_lines = len(source_lines)
            for i, heading in enumerate(headings):
                # start_line is 1-indexed per the extractor
                # convention. Body starts on the line AFTER the
                # heading line. End is the line BEFORE the next
                # heading's line, or EOF.
                body_start = heading.start_line  # 0-indexed: line after heading
                if i + 1 < len(headings):
                    body_end = headings[i + 1].start_line - 1
                else:
                    body_end = total_lines
                body_start = max(0, body_start)
                body_end = max(body_start, body_end)
                body_lines = source_lines[body_start:body_end]
                raw_text = "\n".join(body_lines)

                stripped = self._strip_code(raw_text)
                # Fall back to unstripped if stripping emptied
                # the section (pure code block or similar).
                text_for_extraction = stripped or raw_text

                if not text_for_extraction.strip():
                    continue
                if not self.is_section_eligible(
                    len(text_for_extraction),
                    cfg.min_section_chars,
                ):
                    continue
                units.append(
                    (heading, text_for_extraction, len(body_lines))
                )

        # Prose blocks — SVG long text. Carry their text
        # inline; no slicing needed. Line count is 1 for
        # adaptive top-n purposes (prose blocks are typically
        # single multi-line elements that don't correspond
        # to a source-file line structure).
        for block in outline.prose_blocks:
            text = block.text or ""
            if not text.strip():
                continue
            if not self.is_section_eligible(
                len(text), cfg.min_section_chars
            ):
                continue
            # Adaptive top-n for prose doesn't apply
            # meaningfully — use 1 line so the bonus never
            # triggers. Callers that want per-prose top-n
            # can override via config (future).
            units.append((block, text, 1))

        return units

    # ------------------------------------------------------------------
    # Code stripping
    # ------------------------------------------------------------------

    @staticmethod
    def _strip_code(text: str) -> str:
        """Remove fenced code blocks and inline code spans.

        Applied to markdown body text before extraction. Code
        vocabulary dominates in short sections; stripping
        keeps keyword extraction focused on explanatory prose.

        Not a CommonMark-exact strip — we use a pair of regex
        passes for speed. Unmatched openers are left in the
        output, which is harmless because KeyBERT treats them
        as noise.
        """
        without_fences = _FENCED_CODE_RE.sub("", text)
        without_spans = _INLINE_CODE_RE.sub("", without_fences)
        return without_spans

    # ------------------------------------------------------------------
    # KeyBERT batch extraction
    # ------------------------------------------------------------------

    def _run_keybert_batch(
        self,
        units: list[tuple[Any, str, int]],
        cfg: EnrichmentConfig,
    ) -> list[list[tuple[str, float]]]:
        """Extract keywords for a batch of units via KeyBERT.

        Single KeyBERT call for the whole batch — the
        sentence-transformer encodes all section texts in one
        forward pass. Adaptive top-n is handled per-unit: a
        section at or above ``_LARGE_SECTION_LINE_THRESHOLD``
        gets ``top_n + _LARGE_SECTION_TOPN_BONUS`` keywords.

        KeyBERT's ``extract_keywords`` returns a list of lists
        when given a list input; we pass the max top-n
        globally and then trim per-unit to the adaptive value
        and apply the min-score filter.

        Returns a list of keyword-score pairs aligned with
        ``units``. Empty list for units with zero keywords
        after filtering.
        """
        if not units:
            return []
        if self._model is None:
            return [[] for _ in units]

        texts = [u[1] for u in units]
        # Use the max possible top-n so the adaptive per-unit
        # trim has enough candidates to choose from.
        global_top_n = cfg.top_n + _LARGE_SECTION_TOPN_BONUS

        try:
            raw = self._model.extract_keywords(
                texts,
                keyphrase_ngram_range=cfg.ngram_range,
                top_n=global_top_n,
                use_mmr=True,
                diversity=cfg.diversity,
            )
        except Exception as exc:
            # Defensive — a malformed input or an internal
            # KeyBERT error shouldn't kill the whole enrichment
            # pass. Log and return empty keyword lists for
            # every unit; the user gets unenriched keywords
            # (empty) rather than a crash.
            logger.warning(
                "KeyBERT batch extraction failed: %s", exc
            )
            return [[] for _ in units]

        # KeyBERT returns a list-of-lists when given a list
        # input. Some versions return a flat list when given
        # a single input — we always pass a list so we always
        # get list-of-lists. Normalise defensively just in
        # case.
        if raw and not isinstance(raw[0], list):
            raw = [raw]

        results: list[list[tuple[str, float]]] = []
        for (target, text, lines), candidates in zip(units, raw):
            # Per-unit top-n — adaptive bonus for large sections.
            if lines >= _LARGE_SECTION_LINE_THRESHOLD:
                per_unit_top_n = cfg.top_n + _LARGE_SECTION_TOPN_BONUS
            else:
                per_unit_top_n = cfg.top_n

            # Normalise: KeyBERT returns (keyword, score) tuples;
            # some callers return plain strings. Defensive
            # coercion to a uniform shape.
            normalised: list[tuple[str, float]] = []
            for entry in candidates[:per_unit_top_n]:
                if isinstance(entry, tuple) and len(entry) == 2:
                    kw, score = entry
                    normalised.append((str(kw), float(score)))
                elif isinstance(entry, str):
                    normalised.append((entry, 1.0))
                # else: malformed entry — skip silently.

            # Min-score filter.
            kept = [
                (kw, score) for kw, score in normalised
                if score >= cfg.min_score
            ]
            results.append(kept)
        return results

    # ------------------------------------------------------------------
    # TF-IDF fallback
    # ------------------------------------------------------------------

    def _run_tfidf_batch(
        self,
        units: list[tuple[Any, str, int]],
        cfg: EnrichmentConfig,
    ) -> list[list[tuple[str, float]]]:
        """Extract keywords for short units via TF-IDF.

        Used when a section's text is below
        ``tfidf_fallback_chars``. Embedding-based extraction
        tends to pick generic terms for very short passages;
        TF-IDF penalises corpus-wide frequency and surfaces
        terms distinctive to this section relative to its
        siblings in the document.

        The corpus for the vectoriser is the full set of short
        texts within this document. Too few texts (< 2) means
        TF-IDF can't compute inverse document frequency
        meaningfully; in that case we return a candidate list
        from raw term frequency instead.

        Returns empty keyword lists when scikit-learn isn't
        installed — the enricher is still useful via the
        KeyBERT path alone.
        """
        if not units:
            return []

        try:
            from sklearn.feature_extraction.text import (  # type: ignore[import-not-found]
                TfidfVectorizer,
            )
        except ImportError:
            logger.info(
                "scikit-learn not installed; TF-IDF fallback "
                "disabled. Short sections will have no keywords."
            )
            return [[] for _ in units]

        texts = [u[1] for u in units]

        # Vectoriser params: match the ngram range the KeyBERT
        # path uses so the keyword vocabulary is consistent
        # across paths. English stopwords filter helps with
        # very short inputs.
        try:
            vectoriser = TfidfVectorizer(
                ngram_range=cfg.ngram_range,
                stop_words="english",
                lowercase=True,
            )
            matrix = vectoriser.fit_transform(texts)
        except ValueError:
            # Empty vocabulary after stop-word filtering — all
            # texts were boilerplate. Return empty lists; a
            # section that's pure stop words is noise anyway.
            return [[] for _ in units]

        feature_names = list(vectoriser.get_feature_names_out())
        results: list[list[tuple[str, float]]] = []
        for idx, (target, text, lines) in enumerate(units):
            if lines >= _LARGE_SECTION_LINE_THRESHOLD:
                per_unit_top_n = cfg.top_n + _LARGE_SECTION_TOPN_BONUS
            else:
                per_unit_top_n = cfg.top_n

            row = matrix[idx].toarray()[0]
            # Rank features by TF-IDF score.
            scored = [
                (feature_names[i], float(row[i]))
                for i in range(len(feature_names))
                if row[i] > 0.0
            ]
            scored.sort(key=lambda kv: kv[1], reverse=True)
            top = scored[:per_unit_top_n]
            # Normalise scores to 0..1 per-row so the min-score
            # filter works on a comparable scale with KeyBERT.
            # KeyBERT scores are cosine similarities in roughly
            # the 0..1 range; TF-IDF row values vary wildly so
            # we rescale by the max in this row.
            if top:
                row_max = max(score for _, score in top)
                if row_max > 0:
                    rescaled = [
                        (kw, score / row_max)
                        for kw, score in top
                    ]
                else:
                    rescaled = top
                kept = [
                    (kw, score) for kw, score in rescaled
                    if score >= cfg.min_score
                ]
            else:
                kept = []
            results.append(kept)
        return results

    # ------------------------------------------------------------------
    # Corpus-aware document-frequency filter
    # ------------------------------------------------------------------

    @staticmethod
    def _apply_corpus_filter(
        units: list[tuple[Any, str, int]],
        by_target: dict[int, list[tuple[str, float]]],
        cfg: EnrichmentConfig,
    ) -> dict[int, list[tuple[str, float]]]:
        """Filter keywords that appear in too many sections.

        Pervasive terms ("system", "function") appear in many
        sections of a repo's documentation and don't
        disambiguate — they're effectively domain stopwords.
        We filter keywords whose document frequency (fraction
        of sections containing them) exceeds
        ``cfg.max_doc_freq``.

        Bigrams survive if ANY constituent unigram is below
        the threshold — matches the spec: "A bigram is
        filtered only if all its constituent unigrams exceed
        the threshold". Rationale: a bigram like "request
        handler" may be distinctive even if "request" is
        pervasive.

        If filtering would leave a section keyword-less, the
        top-scoring keyword is retained regardless — also per
        spec: "If pruning would leave a section keyword-less,
        the top keyword is retained regardless".

        Returns a fresh dict with filtered keyword lists; the
        input dict is not mutated.

        No-op for single-section documents. Doc frequency
        requires a non-trivial corpus to be meaningful — with
        only one section, every keyword has 100% document
        frequency and the filter would incorrectly mark
        everything as pervasive. The fallback-to-top-keyword
        rule would salvage one per section but lose the
        others, producing surprising behaviour on small
        documents. Skipping the filter entirely when there's
        nothing to be contrastive against is cleaner.
        """
        if not units or not by_target:
            return by_target

        # Compute document frequency per unigram keyword.
        # Normalised to lowercase for comparison.
        total_sections = len(units)
        # Filter needs at least 2 sections to produce useful
        # contrastive signals. One-section documents bypass
        # the filter — every keyword would trivially be at
        # 100% doc frequency.
        if total_sections < 2:
            return by_target
        unigram_counts: dict[str, int] = {}
        for target, _text, _lines in units:
            kws = by_target.get(id(target), [])
            seen_in_this_section: set[str] = set()
            for kw, _score in kws:
                for token in kw.lower().split():
                    if token in seen_in_this_section:
                        continue
                    seen_in_this_section.add(token)
                    unigram_counts[token] = (
                        unigram_counts.get(token, 0) + 1
                    )

        if total_sections == 0:
            return by_target

        threshold = cfg.max_doc_freq
        # A unigram is "pervasive" if its fraction exceeds
        # the threshold. Pre-compute the set for fast lookup.
        pervasive: set[str] = {
            token for token, count in unigram_counts.items()
            if (count / total_sections) > threshold
        }

        filtered: dict[int, list[tuple[str, float]]] = {}
        for target, _text, _lines in units:
            kws = by_target.get(id(target), [])
            survivors: list[tuple[str, float]] = []
            for kw, score in kws:
                tokens = kw.lower().split()
                # Keep if at least one token is NOT pervasive.
                # Unigrams with their only token pervasive get
                # filtered; bigrams with at least one non-
                # pervasive token survive.
                if any(t not in pervasive for t in tokens):
                    survivors.append((kw, score))
            # Never leave a section keyword-less if the
            # original had any candidates: fall back to the
            # top-scoring keyword.
            if not survivors and kws:
                survivors = [kws[0]]
            filtered[id(target)] = survivors
        return filtered

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