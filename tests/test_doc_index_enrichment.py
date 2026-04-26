"""Tests for DocIndex enrichment integration — Layer 2.8.4c.

Covers the three new surfaces on :class:`DocIndex`:

- :meth:`needs_enrichment` — predicate for "does this outline
  have uncached keyword work to do?"
- :meth:`queue_enrichment` — returns the list of paths needing
  enrichment, sorted deterministically
- :meth:`enrich_single_file` — runs the enricher in place and
  replaces the cache entry with the keyword_model tag

Uses a :class:`_StubEnricher` that records calls and populates
keywords on whatever targets it sees — no real KeyBERT, no
sentence-transformers download. The orchestrator treats the
enricher as an opaque callable, so the stub exercises the full
wiring without any of the heavy dependencies.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from ac_dc.doc_index.index import DocIndex
from ac_dc.doc_index.models import (
    DocHeading,
    DocOutline,
    DocProseBlock,
)


# ---------------------------------------------------------------------------
# Stub enricher
# ---------------------------------------------------------------------------


class _StubEnricher:
    """Records calls, populates keywords per-unit deterministically.

    The stub mimics :class:`KeywordEnricher`'s public surface:
    :attr:`model_name` + :meth:`enrich_outline`. It doesn't
    check eligibility — if a heading/prose block is passed in
    and has empty keywords, the stub populates them with a
    single deterministic entry derived from the heading text
    (or a fixed string for prose). Callers that want to test
    eligibility filtering configure the fake to skip items.
    """

    def __init__(
        self,
        model_name: str = "stub-model",
        skip_prose: bool = False,
    ) -> None:
        self.model_name = model_name
        self._skip_prose = skip_prose
        self.calls: list[dict[str, Any]] = []

    def enrich_outline(
        self,
        outline: Any,
        source_text: str = "",
        config: Any = None,
    ) -> Any:
        self.calls.append({
            "file_path": outline.file_path,
            "source_text": source_text,
        })
        # Populate keywords on each heading (flat walk).
        for heading in outline.all_headings_flat:
            if not heading.keywords:
                heading.keywords = [f"kw-for-{heading.text}"]
        if not self._skip_prose:
            for block in outline.prose_blocks:
                if not block.keywords:
                    block.keywords = ["prose-kw"]
        return outline


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def repo_root(tmp_path: Path) -> Path:
    return tmp_path


@pytest.fixture
def index_no_enricher(repo_root: Path) -> DocIndex:
    """DocIndex with enrichment disabled."""
    return DocIndex(repo_root=repo_root)


@pytest.fixture
def stub_enricher() -> _StubEnricher:
    return _StubEnricher()


@pytest.fixture
def index_with_enricher(
    repo_root: Path,
    stub_enricher: _StubEnricher,
) -> DocIndex:
    """DocIndex wired with the stub enricher."""
    return DocIndex(repo_root=repo_root, enricher=stub_enricher)


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


# ---------------------------------------------------------------------------
# needs_enrichment
# ---------------------------------------------------------------------------


class TestNeedsEnrichment:
    def test_outline_with_keywords_already_set(
        self, index_with_enricher: DocIndex
    ) -> None:
        """All headings enriched → False."""
        h = DocHeading(
            text="Intro",
            level=1,
            start_line=1,
            section_lines=10,
            keywords=["existing"],
        )
        outline = DocOutline(file_path="a.md", headings=[h])
        assert index_with_enricher.needs_enrichment(outline) is False

    def test_heading_with_empty_keywords_returns_true(
        self, index_with_enricher: DocIndex
    ) -> None:
        """Unenriched heading → True."""
        h = DocHeading(
            text="Intro",
            level=1,
            start_line=1,
            section_lines=10,
        )
        outline = DocOutline(file_path="a.md", headings=[h])
        assert index_with_enricher.needs_enrichment(outline) is True

    def test_heading_with_zero_section_lines_skipped(
        self, index_with_enricher: DocIndex
    ) -> None:
        """Heading with no body → not eligible, returns False."""
        h = DocHeading(
            text="Stub",
            level=1,
            start_line=1,
            section_lines=0,
        )
        outline = DocOutline(file_path="a.md", headings=[h])
        assert index_with_enricher.needs_enrichment(outline) is False

    def test_nested_headings_all_enriched(
        self, index_with_enricher: DocIndex
    ) -> None:
        """Depth-first check — child keywords present → False."""
        child = DocHeading(
            text="Child",
            level=2,
            start_line=5,
            section_lines=3,
            keywords=["child-kw"],
        )
        parent = DocHeading(
            text="Parent",
            level=1,
            start_line=1,
            section_lines=10,
            keywords=["parent-kw"],
            children=[child],
        )
        outline = DocOutline(
            file_path="a.md", headings=[parent]
        )
        assert index_with_enricher.needs_enrichment(outline) is False

    def test_nested_child_missing_keywords(
        self, index_with_enricher: DocIndex
    ) -> None:
        """Child missing keywords → True even if parent has them."""
        child = DocHeading(
            text="Child",
            level=2,
            start_line=5,
            section_lines=3,
        )
        parent = DocHeading(
            text="Parent",
            level=1,
            start_line=1,
            section_lines=10,
            keywords=["parent-kw"],
            children=[child],
        )
        outline = DocOutline(
            file_path="a.md", headings=[parent]
        )
        assert index_with_enricher.needs_enrichment(outline) is True

    def test_prose_block_enrichable_above_threshold(
        self, index_with_enricher: DocIndex
    ) -> None:
        """Long unenriched prose → True."""
        prose = DocProseBlock(
            text="A" * 200,  # well above default 50 chars
        )
        outline = DocOutline(
            file_path="a.svg",
            prose_blocks=[prose],
        )
        assert index_with_enricher.needs_enrichment(outline) is True

    def test_prose_block_below_threshold_skipped(
        self, index_with_enricher: DocIndex
    ) -> None:
        """Short prose → not eligible."""
        prose = DocProseBlock(text="short")
        outline = DocOutline(
            file_path="a.svg",
            prose_blocks=[prose],
        )
        assert index_with_enricher.needs_enrichment(outline) is False

    def test_prose_block_with_keywords_skipped(
        self, index_with_enricher: DocIndex
    ) -> None:
        """Enriched prose doesn't trigger re-enrichment."""
        prose = DocProseBlock(
            text="A" * 200,
            keywords=["existing"],
        )
        outline = DocOutline(
            file_path="a.svg",
            prose_blocks=[prose],
        )
        assert index_with_enricher.needs_enrichment(outline) is False

    def test_mixed_headings_and_prose(
        self, index_with_enricher: DocIndex
    ) -> None:
        """Either unenriched unit → True."""
        h = DocHeading(
            text="H",
            level=1,
            start_line=1,
            section_lines=5,
            keywords=["existing"],
        )
        prose = DocProseBlock(text="A" * 200)
        outline = DocOutline(
            file_path="a.md",
            headings=[h],
            prose_blocks=[prose],
        )
        assert index_with_enricher.needs_enrichment(outline) is True

    def test_empty_outline_returns_false(
        self, index_with_enricher: DocIndex
    ) -> None:
        """No headings, no prose → nothing to enrich."""
        outline = DocOutline(file_path="empty.md")
        assert index_with_enricher.needs_enrichment(outline) is False


# ---------------------------------------------------------------------------
# queue_enrichment
# ---------------------------------------------------------------------------


class TestQueueEnrichment:
    def test_no_enricher_returns_empty(
        self, index_no_enricher: DocIndex, repo_root: Path
    ) -> None:
        """Without an enricher, queue is always empty."""
        _write(repo_root / "a.md", "# Hello\n\nBody.\n")
        index_no_enricher.index_file("a.md")
        # Even with a file loaded, no enricher → empty queue.
        assert index_no_enricher.queue_enrichment() == []

    def test_enricher_but_no_files_returns_empty(
        self, index_with_enricher: DocIndex
    ) -> None:
        assert index_with_enricher.queue_enrichment() == []

    def test_queues_unenriched_files(
        self,
        index_with_enricher: DocIndex,
        repo_root: Path,
    ) -> None:
        _write(repo_root / "a.md", "# A\n\n" + ("line\n" * 10))
        _write(repo_root / "b.md", "# B\n\n" + ("line\n" * 10))
        index_with_enricher.index_file("a.md")
        index_with_enricher.index_file("b.md")
        queue = index_with_enricher.queue_enrichment()
        assert queue == ["a.md", "b.md"]

    def test_excludes_already_enriched_files(
        self,
        index_with_enricher: DocIndex,
        repo_root: Path,
    ) -> None:
        """File whose cached outline has keywords → excluded."""
        _write(repo_root / "a.md", "# A\n\n" + ("line\n" * 10))
        index_with_enricher.index_file("a.md")
        # Manually mark as enriched.
        outline = index_with_enricher._all_outlines["a.md"]
        for h in outline.all_headings_flat:
            h.keywords = ["existing"]
        assert index_with_enricher.queue_enrichment() == []

    def test_sorted_alphabetically(
        self,
        index_with_enricher: DocIndex,
        repo_root: Path,
    ) -> None:
        """Deterministic ordering — tests rely on this."""
        _write(repo_root / "z.md", "# Z\n\n" + ("line\n" * 10))
        _write(repo_root / "a.md", "# A\n\n" + ("line\n" * 10))
        _write(repo_root / "m.md", "# M\n\n" + ("line\n" * 10))
        for name in ("z.md", "a.md", "m.md"):
            index_with_enricher.index_file(name)
        assert index_with_enricher.queue_enrichment() == [
            "a.md", "m.md", "z.md",
        ]

    def test_mixed_enriched_and_unenriched(
        self,
        index_with_enricher: DocIndex,
        repo_root: Path,
    ) -> None:
        """Only unenriched files appear in the queue."""
        _write(repo_root / "a.md", "# A\n\n" + ("line\n" * 10))
        _write(repo_root / "b.md", "# B\n\n" + ("line\n" * 10))
        _write(repo_root / "c.md", "# C\n\n" + ("line\n" * 10))
        for name in ("a.md", "b.md", "c.md"):
            index_with_enricher.index_file(name)
        # Mark b as enriched.
        outline = index_with_enricher._all_outlines["b.md"]
        for h in outline.all_headings_flat:
            h.keywords = ["existing"]
        assert index_with_enricher.queue_enrichment() == [
            "a.md", "c.md"
        ]


# ---------------------------------------------------------------------------
# enrich_single_file
# ---------------------------------------------------------------------------


class TestEnrichSingleFile:
    def test_no_enricher_returns_none(
        self, index_no_enricher: DocIndex, repo_root: Path
    ) -> None:
        _write(repo_root / "a.md", "# A\n\nBody.\n")
        index_no_enricher.index_file("a.md")
        result = index_no_enricher.enrich_single_file(
            "a.md", source_text="# A\n\nBody.\n"
        )
        assert result is None

    def test_unknown_file_returns_none(
        self, index_with_enricher: DocIndex
    ) -> None:
        """File never indexed → None, no enricher call."""
        result = index_with_enricher.enrich_single_file(
            "never-indexed.md", source_text=""
        )
        assert result is None

    def test_missing_file_on_disk_returns_none(
        self,
        index_with_enricher: DocIndex,
        repo_root: Path,
    ) -> None:
        """File indexed then deleted → None.

        The enricher needs an mtime to re-cache the result;
        a missing file has no mtime so we bail cleanly.
        """
        path = repo_root / "a.md"
        _write(path, "# A\n\n" + ("line\n" * 10))
        index_with_enricher.index_file("a.md")
        path.unlink()
        result = index_with_enricher.enrich_single_file(
            "a.md",
            source_text="# A\n\n" + ("line\n" * 10),
        )
        assert result is None

    def test_enriches_outline_in_place(
        self,
        index_with_enricher: DocIndex,
        stub_enricher: _StubEnricher,
        repo_root: Path,
    ) -> None:
        """Happy path — enricher called, keywords populated."""
        source = "# Intro\n\n" + ("line\n" * 10)
        _write(repo_root / "a.md", source)
        index_with_enricher.index_file("a.md")

        result = index_with_enricher.enrich_single_file(
            "a.md", source_text=source
        )
        assert result is not None
        # Stub populates kw-for-{heading text}.
        assert result.headings[0].keywords == ["kw-for-Intro"]
        # Enricher called once with our source text.
        assert len(stub_enricher.calls) == 1
        assert stub_enricher.calls[0]["source_text"] == source

    def test_returns_same_outline_object(
        self,
        index_with_enricher: DocIndex,
        repo_root: Path,
    ) -> None:
        """Identity preserved — enrichment mutates in place."""
        source = "# Intro\n\n" + ("line\n" * 10)
        _write(repo_root / "a.md", source)
        index_with_enricher.index_file("a.md")

        before = index_with_enricher._all_outlines["a.md"]
        result = index_with_enricher.enrich_single_file(
            "a.md", source_text=source
        )
        assert result is before

    def test_enriched_file_no_longer_in_queue(
        self,
        index_with_enricher: DocIndex,
        repo_root: Path,
    ) -> None:
        """After enrichment, queue_enrichment drops the file."""
        source = "# Intro\n\n" + ("line\n" * 10)
        _write(repo_root / "a.md", source)
        index_with_enricher.index_file("a.md")

        assert "a.md" in index_with_enricher.queue_enrichment()
        index_with_enricher.enrich_single_file(
            "a.md", source_text=source
        )
        assert "a.md" not in index_with_enricher.queue_enrichment()

    def test_cache_entry_tagged_with_keyword_model(
        self,
        index_with_enricher: DocIndex,
        repo_root: Path,
    ) -> None:
        """Post-enrichment cache lookup by same model hits."""
        source = "# Intro\n\n" + ("line\n" * 10)
        path = repo_root / "a.md"
        _write(path, source)
        index_with_enricher.index_file("a.md")
        index_with_enricher.enrich_single_file(
            "a.md", source_text=source
        )

        # Direct cache probe: by the stub's model name should hit.
        mtime = path.stat().st_mtime
        cached = index_with_enricher._cache.get(
            "a.md", mtime, keyword_model="stub-model"
        )
        assert cached is not None
        # Different model → miss (would force re-enrichment
        # when the user changes their keyword model).
        assert index_with_enricher._cache.get(
            "a.md", mtime, keyword_model="other-model"
        ) is None

    def test_structure_only_lookup_still_hits_after_enrichment(
        self,
        index_with_enricher: DocIndex,
        repo_root: Path,
    ) -> None:
        """keyword_model=None lookup hits regardless of tag.

        Mode switches use structure-only lookup to avoid
        blocking on enrichment completion.
        """
        source = "# Intro\n\n" + ("line\n" * 10)
        path = repo_root / "a.md"
        _write(path, source)
        index_with_enricher.index_file("a.md")
        index_with_enricher.enrich_single_file(
            "a.md", source_text=source
        )
        mtime = path.stat().st_mtime
        assert index_with_enricher._cache.get(
            "a.md", mtime, keyword_model=None
        ) is not None

    def test_signature_hash_changes_after_enrichment(
        self,
        index_with_enricher: DocIndex,
        repo_root: Path,
    ) -> None:
        """Hash includes keywords — enrichment bumps it."""
        source = "# Intro\n\n" + ("line\n" * 10)
        _write(repo_root / "a.md", source)
        index_with_enricher.index_file("a.md")

        before_hash = index_with_enricher.get_signature_hash("a.md")
        index_with_enricher.enrich_single_file(
            "a.md", source_text=source
        )
        after_hash = index_with_enricher.get_signature_hash("a.md")

        assert before_hash is not None
        assert after_hash is not None
        assert before_hash != after_hash