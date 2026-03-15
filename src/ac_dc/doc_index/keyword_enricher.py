"""KeyBERT-based keyword extraction for document sections."""

import logging
import re
from typing import Optional

from ac_dc.doc_index.models import DocHeading, DocOutline

logger = logging.getLogger(__name__)


def _flatten_headings(headings: list[DocHeading]) -> list[DocHeading]:
    result = []
    stack = list(headings)
    while stack:
        h = stack.pop(0)
        result.append(h)
        stack = list(h.children) + stack
    return result


def _strip_code(text: str) -> str:
    """Remove fenced code blocks and inline code spans."""
    # Fenced blocks
    text = re.sub(
        r'(?m)^[ \t]*(`{3,}|~{3,})[^\n]*\n(.*?\n)?[ \t]*\1[ \t]*$',
        '', text, flags=re.DOTALL,
    )
    # Inline code
    text = re.sub(r'`[^`\n]+`', '', text)
    return text


class KeywordEnricher:
    """Extract keywords per document section using KeyBERT.

    Gracefully degrades when keybert is not installed.
    """

    def __init__(
        self,
        model_name: str = "BAAI/bge-small-en-v1.5",
        top_n: int = 3,
        ngram_range: tuple[int, int] = (1, 2),
        min_section_chars: int = 50,
        min_score: float = 0.3,
        diversity: float = 0.5,
        tfidf_fallback_chars: int = 150,
        max_doc_freq: float = 0.6,
    ):
        self._model_name = model_name
        self._top_n = top_n
        self._ngram_range = ngram_range
        self._min_section_chars = min_section_chars
        self._min_score = min_score
        self._diversity = diversity
        self._tfidf_fallback_chars = tfidf_fallback_chars
        self._max_doc_freq = max_doc_freq
        self._kw_model = None
        self._available: Optional[bool] = None

    @property
    def available(self) -> bool:
        """Check if keybert is importable."""
        if self._available is None:
            try:
                from keybert import KeyBERT  # noqa: F401
                self._available = True
            except ImportError:
                self._available = False
        return self._available

    def _ensure_model(self):
        """Lazily initialize the KeyBERT model."""
        if self._kw_model is not None:
            return
        if not self.available:
            return
        from keybert import KeyBERT
        self._kw_model = KeyBERT(model=self._model_name)

    def pre_init_model(self):
        """Eagerly initialize the model (for background startup)."""
        self._ensure_model()

    def enrich(self, outline: DocOutline, full_text: str) -> DocOutline:
        """Enrich headings with keywords. Modifies outline in place."""
        if not self.available:
            return outline

        self._ensure_model()
        if self._kw_model is None:
            return outline

        full_text_lines = full_text.splitlines()
        all_headings = _flatten_headings(outline.headings)

        if not all_headings:
            return outline

        # Collect all eligible sections
        batch_texts = []
        batch_headings = []
        batch_top_ns = []
        all_cleaned_texts = []
        all_cleaned_headings = []
        all_cleaned_top_ns = []

        for i, heading in enumerate(all_headings):
            # Compute section boundaries
            if i + 1 < len(all_headings):
                end_line = all_headings[i + 1].start_line
            else:
                end_line = len(full_text_lines)

            section_text = "\n".join(full_text_lines[heading.start_line:end_line])
            if len(section_text) < self._min_section_chars:
                continue

            # Strip code
            cleaned = _strip_code(section_text)
            if not cleaned.strip():
                cleaned = section_text

            # Adaptive top_n
            section_lines = end_line - heading.start_line
            effective_top_n = self._top_n + 2 if section_lines >= 15 else self._top_n

            all_cleaned_texts.append(cleaned)
            all_cleaned_headings.append(heading)
            all_cleaned_top_ns.append(effective_top_n)

            # Route: short sections -> TF-IDF, others -> KeyBERT batch
            if len(cleaned) >= self._tfidf_fallback_chars:
                batch_texts.append(cleaned)
                batch_headings.append(heading)
                batch_top_ns.append(effective_top_n)

        # TF-IDF fallback for short sections
        tfidf_corpus = list(all_cleaned_texts) if all_cleaned_texts else []
        for heading, cleaned, effective_top_n in zip(
            all_cleaned_headings, all_cleaned_texts, all_cleaned_top_ns,
        ):
            if len(cleaned) < self._tfidf_fallback_chars:
                kws = self._extract_tfidf_keywords(cleaned, effective_top_n, tfidf_corpus)
                heading.keywords = [kw for kw, _ in kws]

        if not batch_texts:
            return outline

        # Batched KeyBERT extraction
        max_top_n = max(batch_top_ns)
        try:
            all_keywords = self._kw_model.extract_keywords(
                batch_texts, top_n=max_top_n,
                keyphrase_ngram_range=self._ngram_range,
                use_mmr=True, diversity=self._diversity,
            )
        except Exception as e:
            logger.warning(f"KeyBERT batch extraction failed: {e}")
            # Fallback to per-heading
            all_keywords = []
            for text in batch_texts:
                try:
                    kws = self._kw_model.extract_keywords(
                        text, top_n=max_top_n,
                        keyphrase_ngram_range=self._ngram_range,
                        use_mmr=True, diversity=self._diversity,
                    )
                    all_keywords.append(kws)
                except Exception:
                    all_keywords.append([])

        # Normalize: single doc returns flat list
        if batch_texts and all_keywords and not isinstance(all_keywords[0], list):
            all_keywords = [all_keywords]

        # Build document frequency map
        term_doc_count: dict[str, int] = {}
        for text in batch_texts:
            seen: set[str] = set()
            for word in text.lower().split():
                if word not in seen:
                    term_doc_count[word] = term_doc_count.get(word, 0) + 1
                    seen.add(word)
        doc_freq_threshold = len(batch_texts) * self._max_doc_freq

        # Assign keywords
        for heading, keywords, effective_n in zip(
            batch_headings, all_keywords, batch_top_ns,
        ):
            filtered = [
                kw for kw, score in keywords[:effective_n]
                if score > self._min_score
                and not self._is_corpus_frequent(kw, term_doc_count, doc_freq_threshold)
            ]
            # Never leave empty due to filtering
            if not filtered and keywords:
                filtered = [keywords[0][0]]
            heading.keywords = filtered

        return outline

    def _is_corpus_frequent(self, kw: str, term_doc_count: dict[str, int],
                            threshold: float) -> bool:
        """Check if all unigrams in a keyword exceed document frequency threshold."""
        words = kw.lower().split()
        return all(term_doc_count.get(w, 0) > threshold for w in words)

    def _extract_tfidf_keywords(self, text: str, top_n: int,
                                corpus: list[str]) -> list[tuple[str, float]]:
        """TF-IDF fallback for short sections."""
        try:
            from sklearn.feature_extraction.text import TfidfVectorizer
        except ImportError:
            return []

        vec = TfidfVectorizer(
            ngram_range=self._ngram_range, stop_words="english",
        )
        try:
            tfidf = vec.fit_transform(corpus)
        except ValueError:
            return []

        try:
            target_idx = corpus.index(text)
        except ValueError:
            return []

        feature_names = vec.get_feature_names_out()
        scores = tfidf.toarray()[target_idx]
        ranked = sorted(zip(feature_names, scores), key=lambda x: -x[1])
        return ranked[:top_n]