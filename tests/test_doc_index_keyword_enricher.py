"""Tests for the keyword enricher — Layer 2.8.4a.

Covers the availability probe, lazy model loading, and the
stub enrich_outline. The actual extraction logic lands in
2.8.4b; tests for MMR, TF-IDF fallback, and corpus-aware
filtering come with that sub-commit.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from ac_dc.doc_index.keyword_enricher import (
    KeywordEnricher,
    _DEFAULT_MODEL_NAME,
)
from ac_dc.doc_index.models import DocHeading, DocOutline


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------


class TestConstruction:
    def test_default_model_name(self) -> None:
        enricher = KeywordEnricher()
        assert enricher.model_name == _DEFAULT_MODEL_NAME

    def test_explicit_model_name(self) -> None:
        enricher = KeywordEnricher(model_name="custom/model-v1")
        assert enricher.model_name == "custom/model-v1"

    def test_is_loaded_false_on_construction(self) -> None:
        # Lazy loading — construction doesn't touch the model.
        enricher = KeywordEnricher()
        assert enricher.is_loaded is False


# ---------------------------------------------------------------------------
# Availability probe
# ---------------------------------------------------------------------------


class TestAvailability:
    def test_is_available_probes_once_and_caches(self) -> None:
        """First call probes; subsequent calls return cached result.

        Caching is important because ``is_available`` is called
        from the hot path (every enrichment attempt). Re-probing
        imports on every call would add noticeable latency.
        """
        enricher = KeywordEnricher()
        with patch.object(
            enricher, "_probe", return_value=True
        ) as probe:
            assert enricher.is_available() is True
            assert enricher.is_available() is True
            assert enricher.is_available() is True
            assert probe.call_count == 1

    def test_is_available_caches_negative_result(self) -> None:
        """Sticky negative cache.

        Once we've observed the library missing, we don't retry.
        Prevents ImportError log spam on every file being
        processed.
        """
        enricher = KeywordEnricher()
        with patch.object(
            enricher, "_probe", return_value=False
        ) as probe:
            assert enricher.is_available() is False
            assert enricher.is_available() is False
            assert probe.call_count == 1

    def test_reset_availability_forces_reprobe(self) -> None:
        """Test helper — clears the cached result."""
        enricher = KeywordEnricher()
        with patch.object(
            enricher, "_probe", side_effect=[True, False]
        ) as probe:
            assert enricher.is_available() is True
            enricher.reset_availability()
            assert enricher.is_available() is False
            assert probe.call_count == 2

    def test_probe_returns_false_when_keybert_missing(self) -> None:
        """Missing keybert → unavailable."""
        enricher = KeywordEnricher()

        def fake_import(name: str, *args: object, **kwargs: object) -> object:
            if name == "keybert":
                raise ImportError("No module named 'keybert'")
            # sentence_transformers left untouched
            import importlib as _impl
            return _impl.import_module(name)

        with patch(
            "ac_dc.doc_index.keyword_enricher.importlib.import_module",
            side_effect=fake_import,
        ):
            assert enricher._probe() is False

    def test_probe_returns_false_when_sentence_transformers_missing(
        self,
    ) -> None:
        """Missing sentence-transformers → unavailable.

        Either library being absent is sufficient — they
        always go together in our usage.
        """
        enricher = KeywordEnricher()

        def fake_import(name: str, *args: object, **kwargs: object) -> object:
            if name == "sentence_transformers":
                raise ImportError(
                    "No module named 'sentence_transformers'"
                )
            # keybert pretends to be available
            import types
            stub = types.ModuleType(name)
            return stub

        with patch(
            "ac_dc.doc_index.keyword_enricher.importlib.import_module",
            side_effect=fake_import,
        ):
            assert enricher._probe() is False

    def test_probe_catches_broad_exception(self) -> None:
        """Non-ImportError failures also mark unavailable.

        A module that installs but raises on import (version
        mismatch, missing CUDA, corrupt install) should degrade
        the same way as a missing library. Matches the pattern
        in :class:`DocConvert._probe_import`.
        """
        enricher = KeywordEnricher()
        with patch(
            "ac_dc.doc_index.keyword_enricher.importlib.import_module",
            side_effect=RuntimeError("CUDA not found"),
        ):
            assert enricher._probe() is False

    def test_probe_returns_true_when_both_present(self) -> None:
        """Happy path — both libraries import cleanly."""
        enricher = KeywordEnricher()
        with patch(
            "ac_dc.doc_index.keyword_enricher.importlib.import_module",
            return_value=object(),  # any truthy return is fine
        ):
            assert enricher._probe() is True


# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------


class TestEnsureLoaded:
    def test_returns_false_when_unavailable(self) -> None:
        """ensure_loaded short-circuits when libraries missing."""
        enricher = KeywordEnricher()
        with patch.object(
            enricher, "is_available", return_value=False
        ):
            assert enricher.ensure_loaded() is False
            assert enricher.is_loaded is False

    def test_loads_keybert_when_available(self) -> None:
        """Happy path — libraries available, model constructs."""
        enricher = KeywordEnricher()
        fake_keybert_instance = object()

        class FakeKeyBERT:
            def __init__(self, model: str) -> None:
                # Capture for assertion
                self.model_arg = model

        with patch.object(
            enricher, "is_available", return_value=True
        ), patch.dict(
            "sys.modules",
            {
                "keybert": type(
                    "M", (), {"KeyBERT": FakeKeyBERT}
                ),
            },
        ):
            # Also need to invalidate any previously-imported
            # keybert module so our fake wins
            import sys
            sys.modules.pop("keybert", None)
            # Re-register the fake
            fake_module = type(
                "M", (), {"KeyBERT": FakeKeyBERT}
            )
            sys.modules["keybert"] = fake_module  # type: ignore[assignment]

            assert enricher.ensure_loaded() is True
            assert enricher.is_loaded is True
            # Clean up after the test so other tests that
            # exercise the real keybert don't see our fake.
            sys.modules.pop("keybert", None)

    def test_idempotent(self) -> None:
        """Second call is a no-op once loaded."""
        enricher = KeywordEnricher()
        # Manually set loaded state
        enricher._model = object()
        assert enricher.ensure_loaded() is True
        # Did not flip anything else
        assert enricher.is_loaded is True

    def test_handles_keybert_import_race(self) -> None:
        """Defensive: KeyBERT unavailable after is_available() True.

        Simulates a race where a background process uninstalls
        KeyBERT between the availability check and the load
        attempt. Should degrade cleanly rather than propagating
        the ImportError.
        """
        enricher = KeywordEnricher()
        with patch.object(
            enricher, "is_available", return_value=True
        ):
            # Patch the import to fail even though is_available
            # claimed success.
            import sys
            # Make sure any cached keybert is gone
            sys.modules.pop("keybert", None)
            # Insert a module that will raise on attribute access
            # of KeyBERT so the `from keybert import KeyBERT`
            # line fails.

            class _RaisingModule:
                def __getattr__(self, name: str) -> object:
                    raise ImportError(
                        "keybert disappeared mid-session"
                    )

            sys.modules["keybert"] = _RaisingModule()  # type: ignore[assignment]
            try:
                assert enricher.ensure_loaded() is False
                assert enricher.is_loaded is False
                # Marked unavailable so future calls don't retry
                assert enricher._available is False
            finally:
                sys.modules.pop("keybert", None)

    def test_handles_model_download_failure(self) -> None:
        """Defensive: KeyBERT constructor raises.

        Common causes: no internet, invalid model name, disk
        full, HF Hub rate limit. All should degrade the enricher
        to unavailable rather than crashing.
        """
        enricher = KeywordEnricher()

        class FakeKeyBERT:
            def __init__(self, model: str) -> None:
                raise RuntimeError(
                    "Model download failed: connection refused"
                )

        import sys
        sys.modules.pop("keybert", None)
        fake_module = type("M", (), {"KeyBERT": FakeKeyBERT})
        sys.modules["keybert"] = fake_module  # type: ignore[assignment]

        try:
            with patch.object(
                enricher, "is_available", return_value=True
            ):
                assert enricher.ensure_loaded() is False
                assert enricher.is_loaded is False
                assert enricher._available is False
        finally:
            sys.modules.pop("keybert", None)


# ---------------------------------------------------------------------------
# EnrichmentConfig
# ---------------------------------------------------------------------------


from ac_dc.doc_index.keyword_enricher import EnrichmentConfig
from ac_dc.doc_index.models import DocProseBlock


class TestEnrichmentConfig:
    def test_defaults(self) -> None:
        cfg = EnrichmentConfig()
        assert cfg.top_n == 3
        assert cfg.ngram_range == (1, 2)
        assert cfg.min_section_chars == 50
        assert cfg.min_score == 0.3
        assert cfg.diversity == 0.5
        assert cfg.tfidf_fallback_chars == 150
        assert cfg.max_doc_freq == 0.6

    def test_frozen(self) -> None:
        """Config is immutable — prevents mid-enrichment mutation."""
        cfg = EnrichmentConfig()
        with pytest.raises(Exception):
            # Frozen dataclasses raise FrozenInstanceError on
            # attempted mutation. Accept any exception so the
            # test passes on whatever dataclass semantics the
            # stdlib gives us.
            cfg.top_n = 10  # type: ignore[misc]

    def test_from_dict_happy_path(self) -> None:
        cfg = EnrichmentConfig.from_dict({
            "keywords_top_n": 5,
            "keywords_ngram_range": [1, 3],
            "keywords_min_section_chars": 100,
            "keywords_min_score": 0.5,
            "keywords_diversity": 0.7,
            "keywords_tfidf_fallback_chars": 200,
            "keywords_max_doc_freq": 0.8,
        })
        assert cfg.top_n == 5
        assert cfg.ngram_range == (1, 3)
        assert cfg.min_section_chars == 100
        assert cfg.min_score == 0.5
        assert cfg.diversity == 0.7
        assert cfg.tfidf_fallback_chars == 200
        assert cfg.max_doc_freq == 0.8

    def test_from_dict_empty_uses_defaults(self) -> None:
        """Missing keys fall through to defaults."""
        cfg = EnrichmentConfig.from_dict({})
        assert cfg.top_n == 3
        assert cfg.ngram_range == (1, 2)

    def test_from_dict_malformed_ngram_falls_back(self) -> None:
        """Bad ngram_range → default (1, 2)."""
        cfg = EnrichmentConfig.from_dict({
            "keywords_ngram_range": "not a list",
        })
        assert cfg.ngram_range == (1, 2)

    def test_from_dict_wrong_ngram_length_falls_back(self) -> None:
        cfg = EnrichmentConfig.from_dict({
            "keywords_ngram_range": [1, 2, 3],
        })
        assert cfg.ngram_range == (1, 2)


# ---------------------------------------------------------------------------
# Code stripping
# ---------------------------------------------------------------------------


class TestCodeStripping:
    def test_strips_fenced_backtick_block(self) -> None:
        text = (
            "before\n"
            "```python\n"
            "def hello(): pass\n"
            "```\n"
            "after"
        )
        stripped = KeywordEnricher._strip_code(text)
        assert "def hello" not in stripped
        assert "before" in stripped
        assert "after" in stripped

    def test_strips_fenced_tilde_block(self) -> None:
        text = (
            "before\n"
            "~~~\n"
            "raw code\n"
            "~~~\n"
            "after"
        )
        stripped = KeywordEnricher._strip_code(text)
        assert "raw code" not in stripped

    def test_strips_inline_code(self) -> None:
        text = "The `foo()` function returns `42`."
        stripped = KeywordEnricher._strip_code(text)
        assert "foo()" not in stripped
        assert "42" not in stripped
        assert "function returns" in stripped

    def test_preserves_non_code_text(self) -> None:
        text = "This is plain prose with no code."
        stripped = KeywordEnricher._strip_code(text)
        assert stripped == text

    def test_unmatched_fence_left_alone(self) -> None:
        """Unmatched opener → text unchanged (no error)."""
        text = (
            "before\n"
            "```\n"
            "never closed"
        )
        stripped = KeywordEnricher._strip_code(text)
        # The opener and body stay — regex requires a closing
        # fence. Fine because extraction treats them as noise.
        assert "before" in stripped

    def test_multiple_fences(self) -> None:
        text = (
            "intro\n"
            "```\nblock one\n```\n"
            "middle\n"
            "```\nblock two\n```\n"
            "outro"
        )
        stripped = KeywordEnricher._strip_code(text)
        assert "block one" not in stripped
        assert "block two" not in stripped
        assert "intro" in stripped
        assert "middle" in stripped
        assert "outro" in stripped


# ---------------------------------------------------------------------------
# Fake KeyBERT / TfidfVectorizer test doubles
# ---------------------------------------------------------------------------


class _FakeKeyBERT:
    """Records extract_keywords calls; returns canned results.

    Configure by setting ``results`` to a list-of-lists matching
    the expected input batch size. Each inner list is
    [(keyword, score), ...] for that input text.
    """

    def __init__(self, results: list[list[tuple[str, float]]]) -> None:
        self.results = results
        self.calls: list[dict[str, object]] = []

    def extract_keywords(
        self,
        texts: list[str],
        **kwargs: object,
    ) -> list[list[tuple[str, float]]]:
        self.calls.append({"texts": texts, "kwargs": kwargs})
        return self.results


def _install_fake_keybert(
    enricher: KeywordEnricher,
    fake: _FakeKeyBERT,
) -> None:
    """Skip the real model load and inject the fake."""
    enricher._available = True
    enricher._model = fake


# ---------------------------------------------------------------------------
# Enrichment pipeline
# ---------------------------------------------------------------------------


class TestEnrichOutlineHappyPath:
    def test_unavailable_returns_outline_unchanged(self) -> None:
        """No KeyBERT → no-op (graceful degradation)."""
        enricher = KeywordEnricher()
        enricher._available = False
        heading = DocHeading(
            text="Intro",
            level=1,
            start_line=1,
        )
        outline = DocOutline(
            file_path="test.md", headings=[heading]
        )
        result = enricher.enrich_outline(
            outline,
            source_text="# Intro\n\nBody text here.",
        )
        assert result is outline
        assert heading.keywords == []

    def test_empty_outline_is_noop(self) -> None:
        enricher = KeywordEnricher()
        fake = _FakeKeyBERT(results=[])
        _install_fake_keybert(enricher, fake)
        outline = DocOutline(file_path="empty.md")
        result = enricher.enrich_outline(outline, source_text="")
        assert result is outline
        # No KeyBERT call because nothing eligible.
        assert len(fake.calls) == 0

    def test_enriches_eligible_markdown_section(self) -> None:
        """Standard happy path — one eligible section gets keywords."""
        enricher = KeywordEnricher()
        fake = _FakeKeyBERT(results=[
            [("cache tiering", 0.8), ("stability", 0.6)],
        ])
        _install_fake_keybert(enricher, fake)

        heading = DocHeading(
            text="Cache Tiering",
            level=1,
            start_line=1,
        )
        outline = DocOutline(
            file_path="caching.md", headings=[heading]
        )
        source_text = (
            "# Cache Tiering\n"
            + "This section describes the cache tiering algorithm "
            + "which manages stability across multiple tiers of "
            + "content. Sections that stabilise promote upward "
            + "into cached tiers. " * 3
        )

        enricher.enrich_outline(outline, source_text=source_text)

        assert heading.keywords == ["cache tiering", "stability"]
        assert len(fake.calls) == 1

    def test_below_threshold_skipped(self) -> None:
        """Section below min_section_chars is skipped."""
        enricher = KeywordEnricher()
        fake = _FakeKeyBERT(results=[])
        _install_fake_keybert(enricher, fake)

        heading = DocHeading(
            text="Tiny", level=1, start_line=1,
        )
        outline = DocOutline(
            file_path="tiny.md", headings=[heading]
        )
        source_text = "# Tiny\n\nShort."

        enricher.enrich_outline(
            outline,
            source_text=source_text,
            config=EnrichmentConfig(min_section_chars=200),
        )
        assert heading.keywords == []

    def test_code_stripped_before_extraction(self) -> None:
        """Code blocks don't contribute to keyword candidates."""
        enricher = KeywordEnricher()
        fake = _FakeKeyBERT(results=[[("prose word", 0.7)]])
        _install_fake_keybert(enricher, fake)

        heading = DocHeading(
            text="Example", level=1, start_line=1,
        )
        outline = DocOutline(
            file_path="ex.md", headings=[heading]
        )
        source_text = (
            "# Example\n\n"
            "Some prose about the feature. "
            "The important concept is described here in detail.\n"
            "```python\n"
            "def code_function(): pass\n"
            "```\n"
            "More prose follows."
        )

        enricher.enrich_outline(
            outline, source_text=source_text,
            config=EnrichmentConfig(
                min_section_chars=20,
                tfidf_fallback_chars=10,  # force KeyBERT path
            ),
        )

        # Fake saw the stripped text — verify no 'code_function'.
        call = fake.calls[0]
        sent_text = call["texts"][0]
        assert "code_function" not in sent_text
        assert "prose" in sent_text

    def test_below_min_score_filtered(self) -> None:
        """Keywords below min_score are dropped."""
        enricher = KeywordEnricher()
        fake = _FakeKeyBERT(results=[
            [("kept", 0.5), ("dropped", 0.1), ("also kept", 0.35)],
        ])
        _install_fake_keybert(enricher, fake)

        heading = DocHeading(
            text="S", level=1, start_line=1,
        )
        outline = DocOutline(
            file_path="s.md", headings=[heading]
        )
        source_text = "# S\n\n" + ("body body " * 30)

        enricher.enrich_outline(
            outline, source_text=source_text,
            config=EnrichmentConfig(min_score=0.3),
        )
        assert heading.keywords == ["kept", "also kept"]


class TestAdaptiveTopN:
    def test_large_section_gets_bonus_keywords(self) -> None:
        """Section ≥ 15 lines → top_n + 2 keywords."""
        enricher = KeywordEnricher()
        # Fake returns 5 candidates so the adaptive path has
        # something to pick. Default top_n=3, bonus=2 → 5 total.
        fake = _FakeKeyBERT(results=[
            [(f"kw{i}", 0.9) for i in range(5)],
        ])
        _install_fake_keybert(enricher, fake)

        heading = DocHeading(
            text="Large", level=1, start_line=1,
        )
        outline = DocOutline(
            file_path="l.md", headings=[heading]
        )
        # Section body must span ≥ 15 lines after the heading.
        body = "\n".join(
            f"line {i} describing content details" for i in range(20)
        )
        source_text = f"# Large\n{body}"

        enricher.enrich_outline(outline, source_text=source_text)
        # Expect 5 keywords (3 + 2 bonus).
        assert len(heading.keywords) == 5

    def test_small_section_gets_default_topn(self) -> None:
        """Section < 15 lines → top_n only."""
        enricher = KeywordEnricher()
        fake = _FakeKeyBERT(results=[
            [(f"kw{i}", 0.9) for i in range(5)],
        ])
        _install_fake_keybert(enricher, fake)

        heading = DocHeading(
            text="Small", level=1, start_line=1,
        )
        outline = DocOutline(
            file_path="s.md", headings=[heading]
        )
        source_text = "# Small\n" + "body " * 30  # 2 lines

        enricher.enrich_outline(outline, source_text=source_text)
        assert len(heading.keywords) == 3


class TestProseBlockEnrichment:
    def test_prose_block_gets_keywords(self) -> None:
        """SVG prose blocks participate in the same batch."""
        enricher = KeywordEnricher()
        fake = _FakeKeyBERT(results=[
            [("architecture", 0.9), ("diagram", 0.7)],
        ])
        _install_fake_keybert(enricher, fake)

        # Text ≥ tfidf_fallback_chars (150) so the KeyBERT
        # path (via the fake) handles it. Shorter text would
        # fall through to real scikit-learn TF-IDF, which
        # doesn't know about the fake's canned results.
        prose = DocProseBlock(
            text=(
                "This is a long prose block from an annotated "
                "SVG diagram describing the system architecture "
                "and its major components in detail. "
                "Additional content to push the length over the "
                "TF-IDF fallback threshold so embedding "
                "extraction kicks in for this test."
            ),
            container_heading_id="System Overview",
        )
        outline = DocOutline(
            file_path="diagram.svg",
            prose_blocks=[prose],
        )

        enricher.enrich_outline(outline, source_text="")

        assert prose.keywords == ["architecture", "diagram"]

    def test_markdown_and_prose_mixed_batch(self) -> None:
        """Headings and prose blocks share the batch."""
        enricher = KeywordEnricher()
        fake = _FakeKeyBERT(results=[
            [("heading kw", 0.8)],
            [("prose kw", 0.7)],
        ])
        _install_fake_keybert(enricher, fake)

        heading = DocHeading(
            text="Section",
            level=1,
            start_line=1,
        )
        prose = DocProseBlock(
            text="Long prose content " * 20,
            container_heading_id="Section",
        )
        outline = DocOutline(
            file_path="mixed.md",
            headings=[heading],
            prose_blocks=[prose],
        )
        source_text = "# Section\n" + ("body content " * 20)

        enricher.enrich_outline(outline, source_text=source_text)

        assert heading.keywords == ["heading kw"]
        assert prose.keywords == ["prose kw"]

    def test_empty_prose_block_skipped(self) -> None:
        enricher = KeywordEnricher()
        fake = _FakeKeyBERT(results=[])
        _install_fake_keybert(enricher, fake)

        prose = DocProseBlock(text="")
        outline = DocOutline(
            file_path="empty.svg",
            prose_blocks=[prose],
        )
        enricher.enrich_outline(outline, source_text="")
        assert prose.keywords == []


class TestCorpusFilter:
    def test_pervasive_unigram_filtered(self) -> None:
        """Unigram in too many sections → dropped."""
        enricher = KeywordEnricher()
        # Three sections, "system" in all three → 100% doc freq.
        fake = _FakeKeyBERT(results=[
            [("system", 0.9), ("auth", 0.7)],
            [("system", 0.8), ("router", 0.6)],
            [("system", 0.85), ("parser", 0.5)],
        ])
        _install_fake_keybert(enricher, fake)

        # Build the source text first so start_lines can be
        # derived from actual positions rather than hardcoded.
        # Each section needs ≥ 150 chars to go through KeyBERT
        # rather than TF-IDF.
        filler = "content describing functionality " * 10
        # Heading lines at 1-indexed positions 1, 3, 5 with
        # one-line filler bodies between.
        source_text = (
            f"# A\n{filler}\n# B\n{filler}\n# C\n{filler}"
        )
        h1 = DocHeading(text="A", level=1, start_line=1)
        h2 = DocHeading(text="B", level=1, start_line=3)
        h3 = DocHeading(text="C", level=1, start_line=5)
        outline = DocOutline(
            file_path="doc.md",
            headings=[h1, h2, h3],
        )

        enricher.enrich_outline(
            outline, source_text=source_text,
            config=EnrichmentConfig(max_doc_freq=0.6),
        )

        # "system" should be filtered; distinctive terms kept.
        assert "system" not in h1.keywords
        assert "system" not in h2.keywords
        assert "system" not in h3.keywords
        assert "auth" in h1.keywords
        assert "router" in h2.keywords
        assert "parser" in h3.keywords

    def test_bigram_with_non_pervasive_constituent_survives(
        self,
    ) -> None:
        """Bigram keeps if ANY constituent is below threshold.

        Per spec: "A bigram is filtered only if all its
        constituent unigrams exceed the threshold". "system
        auth" has "auth" below threshold → survives even
        though "system" is pervasive.
        """
        enricher = KeywordEnricher()
        fake = _FakeKeyBERT(results=[
            [("system auth", 0.9), ("system", 0.8)],
            [("system cache", 0.85)],
            [("system parser", 0.75)],
        ])
        _install_fake_keybert(enricher, fake)

        filler = "content describing functionality " * 10
        source_text = (
            f"# A\n{filler}\n# B\n{filler}\n# C\n{filler}"
        )
        h1 = DocHeading(text="A", level=1, start_line=1)
        h2 = DocHeading(text="B", level=1, start_line=3)
        h3 = DocHeading(text="C", level=1, start_line=5)
        outline = DocOutline(
            file_path="d.md",
            headings=[h1, h2, h3],
        )

        enricher.enrich_outline(
            outline, source_text=source_text,
            config=EnrichmentConfig(max_doc_freq=0.5),
        )

        # "system" as a standalone unigram should be gone.
        assert "system" not in h1.keywords
        # But "system auth" survives because "auth" isn't pervasive.
        assert "system auth" in h1.keywords
        # Same for the other sections' bigrams.
        assert "system cache" in h2.keywords
        assert "system parser" in h3.keywords

    def test_filter_keeps_top_kw_when_would_empty(self) -> None:
        """Never leave a section with zero keywords.

        If every candidate would be filtered, keep the
        highest-scoring one.
        """
        enricher = KeywordEnricher()
        # Every section has only "system" as a candidate, and
        # it's pervasive.
        fake = _FakeKeyBERT(results=[
            [("system", 0.9)],
            [("system", 0.8)],
            [("system", 0.85)],
        ])
        _install_fake_keybert(enricher, fake)

        filler = "content describing functionality " * 10
        source_text = (
            f"# A\n{filler}\n# B\n{filler}\n# C\n{filler}"
        )
        h1 = DocHeading(text="A", level=1, start_line=1)
        h2 = DocHeading(text="B", level=1, start_line=3)
        h3 = DocHeading(text="C", level=1, start_line=5)
        outline = DocOutline(
            file_path="d.md",
            headings=[h1, h2, h3],
        )

        enricher.enrich_outline(
            outline, source_text=source_text,
            config=EnrichmentConfig(max_doc_freq=0.5),
        )

        # Even though "system" is pervasive, each section
        # retains it (fallback to top keyword).
        assert h1.keywords == ["system"]
        assert h2.keywords == ["system"]
        assert h3.keywords == ["system"]


class TestKeybertFailure:
    def test_keybert_exception_returns_empty(self) -> None:
        """KeyBERT internal error → no crash, empty keywords."""
        class _RaisingKeyBERT:
            def extract_keywords(self, *args: object, **kwargs: object) -> list:
                raise RuntimeError("keybert failed")

        enricher = KeywordEnricher()
        _install_fake_keybert(enricher, _RaisingKeyBERT())  # type: ignore[arg-type]

        heading = DocHeading(text="T", level=1, start_line=1)
        outline = DocOutline(
            file_path="t.md", headings=[heading]
        )
        source_text = "# T\n" + ("body text here " * 30)

        # No exception propagates.
        enricher.enrich_outline(outline, source_text=source_text)
        assert heading.keywords == []


# ---------------------------------------------------------------------------
# is_section_eligible
# ---------------------------------------------------------------------------


class TestSectionEligibility:
    def test_above_threshold_eligible(self) -> None:
        enricher = KeywordEnricher()
        assert enricher.is_section_eligible(100, min_chars=50) is True

    def test_below_threshold_skipped(self) -> None:
        enricher = KeywordEnricher()
        assert enricher.is_section_eligible(30, min_chars=50) is False

    def test_exact_threshold_eligible(self) -> None:
        """Threshold comparison is `>=`, not `>`.

        Matters at the boundary — a section exactly at the
        configured minimum should qualify.
        """
        enricher = KeywordEnricher()
        assert enricher.is_section_eligible(50, min_chars=50) is True

    def test_zero_length_never_eligible(self) -> None:
        enricher = KeywordEnricher()
        assert enricher.is_section_eligible(0, min_chars=1) is False

    def test_zero_threshold_always_eligible(self) -> None:
        """min_chars=0 makes every section eligible.

        Corresponds to a user config that disables the
        threshold filter. Not a common setting but the
        behaviour should be sensible.
        """
        enricher = KeywordEnricher()
        assert enricher.is_section_eligible(0, min_chars=0) is True