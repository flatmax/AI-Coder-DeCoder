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
# Stub enrich_outline (2.8.4a — no-op; real impl lands in 2.8.4b)
# ---------------------------------------------------------------------------


class TestEnrichOutlineStub:
    def test_returns_outline_unchanged(self) -> None:
        """Stub: no keywords added."""
        enricher = KeywordEnricher()
        heading = DocHeading(text="Introduction", level=1)
        outline = DocOutline(
            file_path="test.md",
            headings=[heading],
        )
        result = enricher.enrich_outline(outline, source_text="...")
        assert result is outline  # identity preserved
        assert heading.keywords == []  # unchanged

    def test_accepts_empty_source_text(self) -> None:
        """Source text is optional in the stub."""
        enricher = KeywordEnricher()
        outline = DocOutline(file_path="empty.md")
        result = enricher.enrich_outline(outline)
        assert result is outline


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