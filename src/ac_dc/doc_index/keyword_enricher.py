"""KeyBERT-based keyword extraction for document sections.

Lazily imports keybert — if not installed, headings are returned without
keywords and a warning is logged. The sentence-transformer model is
initialized once and reused across files.

Pre-processing: fenced code blocks and inline code spans are stripped
before embedding so KeyBERT focuses on explanatory prose rather than
example data (model names, token counts, config snippets).

Adaptive top_n: sections with >= 15 lines get top_n + 2 keywords to
capture vocabulary from multi-pathway decision logic.

TF-IDF fallback: short sections (below tfidf_fallback_chars) use
TfidfVectorizer fitted on all section texts as a corpus instead of
KeyBERT embeddings — surfaces terms distinctive to the section relative
to its siblings.

Corpus-frequency filtering: after KeyBERT extraction, keywords whose
constituent unigrams all appear in more than max_doc_freq fraction of
sections are filtered out — removes pervasive domain terms that don't
disambiguate.
"""

import logging
import re

logger = logging.getLogger(__name__)

# Fenced code blocks: ```…``` or ~~~…~~~
_FENCED_CODE_RE = re.compile(
    r'(?m)^[ \t]*(`{3,}|~{3,})[^\n]*\n(.*?\n)?[ \t]*\1[ \t]*$',
    re.DOTALL,
)
# Inline code spans: `…`
_INLINE_CODE_RE = re.compile(r'`[^`\n]+`')

# Threshold for adaptive top_n (section lines)
_LARGE_SECTION_LINES = 15
_LARGE_SECTION_BONUS = 2


class KeywordEnricher:
    """Extract keywords per heading section using KeyBERT."""

    def __init__(self, model_name="all-mpnet-base-v2", top_n=3,
                 ngram_range=(1, 2), min_section_chars=50,
                 min_score=0.3, diversity=0.5,
                 tfidf_fallback_chars=150, max_doc_freq=0.6):
        self._model_name = model_name
        self._top_n = top_n
        self._ngram_range = tuple(ngram_range)
        self._min_section_chars = min_section_chars
        self._min_score = min_score
        self._diversity = diversity
        self._tfidf_fallback_chars = tfidf_fallback_chars
        self._max_doc_freq = max_doc_freq
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

        Pre-processing strips fenced code blocks and inline code spans so
        KeyBERT focuses on explanatory prose rather than example data.

        Adaptive top_n: sections with >= 15 lines get top_n + 2 keywords
        to capture vocabulary from multi-pathway decision logic.

        TF-IDF fallback: short sections (below tfidf_fallback_chars) use
        TfidfVectorizer fitted on all section texts as a corpus instead of
        KeyBERT — surfaces terms distinctive to the section relative to
        its siblings.

        Corpus-frequency filtering: after KeyBERT extraction, keywords
        whose constituent unigrams all exceed max_doc_freq fraction of
        sections are filtered out — removes pervasive domain terms.

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

        # Collect eligible sections — both short (TF-IDF) and long (KeyBERT)
        batch_texts = []       # sections for KeyBERT batched extraction
        batch_top_ns = []
        batch_headings = []
        all_cleaned_texts = []     # all sections for TF-IDF corpus
        all_cleaned_headings = []
        all_cleaned_top_ns = []

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

            # Strip code blocks/spans so KeyBERT focuses on prose
            cleaned = _strip_code(section_text)
            if not cleaned.strip():
                cleaned = section_text  # fallback: section is entirely code

            # Adaptive top_n: large sections get more keywords
            section_lines = end - start
            effective_top_n = (
                self._top_n + _LARGE_SECTION_BONUS
                if section_lines >= _LARGE_SECTION_LINES
                else self._top_n
            )

            # Track all sections for TF-IDF corpus
            all_cleaned_texts.append(cleaned)
            all_cleaned_headings.append(heading)
            all_cleaned_top_ns.append(effective_top_n)

            # Route: short sections use TF-IDF fallback, others go to KeyBERT
            if len(cleaned) >= self._tfidf_fallback_chars:
                batch_texts.append(cleaned)
                batch_headings.append(heading)
                batch_top_ns.append(effective_top_n)

        # TF-IDF fallback for short sections — uses full corpus for contrast
        if all_cleaned_texts:
            for heading, cleaned, effective_top_n in zip(
                all_cleaned_headings, all_cleaned_texts, all_cleaned_top_ns
            ):
                if len(cleaned) < self._tfidf_fallback_chars:
                    heading.keywords = [
                        kw for kw, score in _extract_tfidf_keywords(
                            cleaned, effective_top_n,
                            all_cleaned_texts, self._ngram_range,
                        )
                    ]

        if not batch_texts:
            return outline

        # Batched call uses max(top_ns) — we trim per-heading below
        max_top_n = max(batch_top_ns)

        try:
            # KeyBERT accepts a list of documents and returns a list of
            # keyword lists — the underlying sentence-transformer batches
            # all embeddings in a single forward pass.
            all_keywords = self._kw_model.extract_keywords(
                batch_texts,
                top_n=max_top_n,
                keyphrase_ngram_range=self._ngram_range,
                use_mmr=True,
                diversity=self._diversity,
            )

            # When given a single document, KeyBERT returns a flat list
            # instead of a list-of-lists — normalize.
            if batch_texts and all_keywords and not isinstance(all_keywords[0], list):
                all_keywords = [all_keywords]

            # Build document-frequency map for corpus-aware filtering.
            # Uses unigram frequencies from all KeyBERT batch sections.
            term_doc_count = {}  # term → number of sections containing it
            for text in batch_texts:
                seen = set()
                for word in text.lower().split():
                    if word not in seen:
                        term_doc_count[word] = term_doc_count.get(word, 0) + 1
                        seen.add(word)
            doc_freq_threshold = len(batch_texts) * self._max_doc_freq

            for heading, keywords, effective_n in zip(
                batch_headings, all_keywords, batch_top_ns
            ):
                filtered = [
                    kw for kw, score in keywords[:effective_n]
                    if score > self._min_score
                    and not _is_corpus_frequent(kw, term_doc_count, doc_freq_threshold)
                ]
                # Never leave a section with zero keywords due to filtering
                if not filtered and keywords:
                    filtered = [keywords[0][0]]
                heading.keywords = filtered
        except Exception as e:
            logger.debug(f"Batched keyword extraction failed: {e}")
            # Fall back to per-heading extraction
            for heading, section_text, effective_n in zip(
                batch_headings, batch_texts, batch_top_ns
            ):
                try:
                    keywords = self._kw_model.extract_keywords(
                        section_text,
                        top_n=effective_n,
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


def _is_corpus_frequent(kw, term_doc_count, threshold):
    """Check if a keyword is corpus-frequent (pervasive domain term).

    A keyword (possibly a bigram) is corpus-frequent if ALL its constituent
    unigrams exceed the document-frequency threshold. This uses unigram
    frequencies only — matching KeyBERT's bigram tokenization would add
    complexity for marginal benefit.

    The ALL-must-exceed rule means a bigram like "tier promotion" is only
    filtered if both "tier" AND "promotion" are individually pervasive.
    A bigram with one rare constituent (e.g., "cascade demotion") survives.

    Args:
        kw: keyword string (unigram or bigram)
        term_doc_count: dict mapping unigram → number of sections containing it
        threshold: maximum allowed document count

    Returns:
        True if the keyword should be filtered out
    """
    return all(
        term_doc_count.get(w, 0) > threshold
        for w in kw.lower().split()
    )


def _extract_tfidf_keywords(text, top_n, corpus, ngram_range):
    """Extract keywords using TF-IDF fitted on a corpus of sibling sections.

    Fallback for short sections where embedding-based extraction produces
    generic keywords. TF-IDF penalises terms common across the corpus,
    surfacing terms distinctive to the target section.

    Args:
        text: the target section text
        top_n: maximum keywords to return
        corpus: list of all section texts (includes the target)
        ngram_range: tuple (min_n, max_n) for n-gram extraction

    Returns:
        list of (keyword, score) tuples, sorted by score descending
    """
    try:
        from sklearn.feature_extraction.text import TfidfVectorizer
    except ImportError:
        logger.debug("sklearn not available for TF-IDF fallback")
        return []

    vec = TfidfVectorizer(ngram_range=ngram_range, stop_words="english")
    try:
        tfidf = vec.fit_transform(corpus)
    except ValueError:
        return []  # empty vocabulary after stop words

    # Find the row corresponding to the target section
    try:
        target_idx = corpus.index(text)
    except ValueError:
        return []

    feature_names = vec.get_feature_names_out()
    scores = tfidf.toarray()[target_idx]
    ranked = sorted(zip(feature_names, scores), key=lambda x: -x[1])
    return ranked[:top_n]


def _strip_code(text):
    """Strip fenced code blocks and inline code spans from text.

    Used to pre-process section text before KeyBERT embedding so the
    transformer focuses on explanatory prose rather than example data
    (model names, token counts, configuration snippets).

    Args:
        text: section text (may contain markdown code blocks/spans)

    Returns:
        Text with code blocks and inline spans removed.
        Returns original text if stripping would produce empty output.
    """
    # Remove fenced code blocks (```…``` or ~~~…~~~)
    result = _FENCED_CODE_RE.sub('', text)
    # Remove inline code spans (`…`)
    result = _INLINE_CODE_RE.sub('', result)
    return result