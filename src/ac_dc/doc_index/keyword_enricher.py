"""KeyBERT-based keyword extraction for document sections.

Lazily imports keybert — if not installed, headings are returned without
keywords and a warning is logged. The sentence-transformer model is
initialized once and reused across files.
"""

import logging

logger = logging.getLogger(__name__)


class KeywordEnricher:
    """Extract keywords per heading section using KeyBERT."""

    def __init__(self, model_name="all-mpnet-base-v2", top_n=3,
                 ngram_range=(1, 2), min_section_chars=50,
                 min_score=0.3, diversity=0.5):
        self._model_name = model_name
        self._top_n = top_n
        self._ngram_range = tuple(ngram_range)
        self._min_section_chars = min_section_chars
        self._min_score = min_score
        self._diversity = diversity
        self._kw_model = None
        self._available = None  # None = not yet checked

    @property
    def model_name(self):
        return self._model_name

    def _init_model(self, progress_callback=None):
        """Lazily initialize KeyBERT model.

        Args:
            progress_callback: optional fn(stage, message, percent) for
                reporting model load/download progress to the UI.
        """
        if self._available is not None:
            return self._available

        logger.info(f"Initializing KeyBERT with model: {self._model_name}")

        if progress_callback:
            progress_callback(
                "doc_index",
                f"Loading keyword model ({self._model_name})…",
                2,
            )

        try:
            from keybert import KeyBERT

            # Check whether the sentence-transformer model is already cached
            # locally.  If not, the first KeyBERT() call will download it
            # (~80–420 MB depending on model).  We probe the cache directory
            # so we can show a more informative progress message.
            _downloading = False
            try:
                from sentence_transformers import SentenceTransformer
                from huggingface_hub import try_to_load_from_cache
                probe = try_to_load_from_cache(
                    f"sentence-transformers/{self._model_name}", "config.json"
                )
                if probe is None:
                    _downloading = True
            except Exception:
                # Probe failed — not critical; proceed with init anyway
                pass

            if _downloading:
                logger.info(
                    f"Sentence-transformer model '{self._model_name}' not cached — downloading"
                )
                if progress_callback:
                    progress_callback(
                        "doc_index",
                        f"Downloading keyword model ({self._model_name}) — one-time download…",
                        3,
                    )
            else:
                logger.info(
                    f"Sentence-transformer model '{self._model_name}' found in cache"
                )
                if progress_callback:
                    progress_callback(
                        "doc_index",
                        f"Loading keyword model from cache…",
                        5,
                    )

            self._kw_model = KeyBERT(model=self._model_name)
            self._available = True
            logger.info(f"KeyBERT initialized with model: {self._model_name}")

            if progress_callback:
                progress_callback(
                    "doc_index",
                    "Keyword model ready",
                    10,
                )
        except ImportError:
            logger.warning(
                "keybert not installed — document keywords disabled. "
                "Install with: pip install keybert"
            )
            self._available = False
        except Exception as e:
            logger.warning(f"KeyBERT initialization failed: {e}")
            self._available = False

        return self._available

    def enrich(self, outline, full_text, progress_callback=None):
        """Enrich headings with keywords extracted from their sections.

        Uses batched extraction — all eligible sections are sent to KeyBERT
        in a single call so the sentence-transformer can batch-encode the
        embeddings efficiently (2-4× faster than per-heading calls).

        Args:
            outline: DocOutline with headings (modified in place)
            full_text: full document text (for slicing sections)
            progress_callback: optional fn(stage, message, percent) for
                reporting model load/download progress to the UI.
                Only used on the first call (to trigger lazy model init).

        Returns:
            The same DocOutline with keywords populated
        """
        if not self._init_model(progress_callback=progress_callback):
            return outline

        lines = full_text.splitlines()
        all_headings = outline.all_headings_flat

        # Collect eligible sections for batched extraction
        batch_texts = []
        batch_headings = []

        for i, heading in enumerate(all_headings):
            # Determine section boundaries
            start = heading.start_line
            if i + 1 < len(all_headings):
                end = all_headings[i + 1].start_line
            else:
                end = len(lines)

            section_text = "\n".join(lines[start:end])

            if len(section_text) < self._min_section_chars:
                continue

            batch_texts.append(section_text)
            batch_headings.append(heading)

        if not batch_texts:
            return outline

        try:
            # KeyBERT accepts a list of documents and returns a list of
            # keyword lists — the underlying sentence-transformer batches
            # all embeddings in a single forward pass.
            all_keywords = self._kw_model.extract_keywords(
                batch_texts,
                top_n=self._top_n,
                keyphrase_ngram_range=self._ngram_range,
                use_mmr=True,
                diversity=self._diversity,
            )

            # When given a single document, KeyBERT returns a flat list
            # instead of a list-of-lists — normalize.
            if batch_texts and all_keywords and not isinstance(all_keywords[0], list):
                all_keywords = [all_keywords]

            for heading, keywords in zip(batch_headings, all_keywords):
                heading.keywords = [
                    kw for kw, score in keywords
                    if score > self._min_score
                ]
        except Exception as e:
            logger.debug(f"Batched keyword extraction failed: {e}")
            # Fall back to per-heading extraction
            for heading, section_text in zip(batch_headings, batch_texts):
                try:
                    keywords = self._kw_model.extract_keywords(
                        section_text,
                        top_n=self._top_n,
                        keyphrase_ngram_range=self._ngram_range,
                        use_mmr=True,
                        diversity=self._diversity,
                    )
                    heading.keywords = [
                        kw for kw, score in keywords
                        if score > self._min_score
                    ]
                except Exception as inner_e:
                    logger.debug(
                        f"Keyword extraction failed for heading "
                        f"'{heading.text}': {inner_e}"
                    )

        return outline

    @property
    def available(self):
        """Whether KeyBERT is available (initializes on first check)."""
        if self._available is None:
            self._init_model()
        return self._available