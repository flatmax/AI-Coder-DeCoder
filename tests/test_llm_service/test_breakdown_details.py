"""Breakdown details — url_details and symbol_map_details fields.

Covers:

- :class:`TestBreakdownUrlDetails` — the Budget sub-view's
  expandable URL category. ``get_context_breakdown`` emits
  ``breakdown.url_details`` as a list of ``{name, url, tokens}``
  entries; empty when nothing fetched, error records skipped.
- :class:`TestBreakdownSymbolMapDetails` — the Budget sub-view's
  expandable Symbol Map / Doc Map category. Carries one entry
  per file in the active mode's primary index; selected and
  excluded paths are absent.

Both fields drive the expandable UI chunks on the Context tab.

Governing spec: :doc:`specs4/5-webapp/viewers-hud`.
"""

from __future__ import annotations

from pathlib import Path

from ac_dc.config import ConfigManager
from ac_dc.context_manager import Mode
from ac_dc.llm_service import LLMService
from ac_dc.repo import Repo

from .conftest import _FakeLiteLLM


class TestBreakdownUrlDetails:
    """The Budget sub-view's expandable URL category.

    ``get_context_breakdown`` emits ``breakdown.url_details`` as
    a list of ``{name, url, tokens}`` entries — one per fetched
    URL. Empty list when nothing's fetched; error-record URLs
    are skipped because their ``format_for_prompt()`` would
    return the empty string (the URL service marks error
    records with ``error`` set and empty body).
    """

    def test_empty_when_no_urls_fetched(
        self, service: LLMService
    ) -> None:
        """Fresh service reports no URL details."""
        breakdown = service.get_context_breakdown()["breakdown"]
        assert breakdown["url_details"] == []

    def test_populated_with_name_url_tokens(
        self, service: LLMService
    ) -> None:
        """Fetched URLs appear as detail entries."""
        from ac_dc.url_service.models import URLContent

        service._url_service._fetched[
            "https://example.com/docs"
        ] = URLContent(
            url="https://example.com/docs",
            url_type="generic",
            title="Docs",
            content="lots of documentation here",
            fetched_at="2025-01-01T00:00:00Z",
        )
        service._url_service._fetched[
            "https://github.com/owner/repo"
        ] = URLContent(
            url="https://github.com/owner/repo",
            url_type="github_repo",
            content="readme body",
            fetched_at="2025-01-01T00:00:00Z",
        )

        details = service.get_context_breakdown()[
            "breakdown"
        ]["url_details"]
        assert len(details) == 2
        # Each entry carries name, url, tokens.
        for entry in details:
            assert set(entry.keys()) == {"name", "url", "tokens"}
            assert isinstance(entry["tokens"], int)
            assert entry["tokens"] > 0
        # Display names come from url_service.detection.display_name;
        # for a github repo URL that's "owner/repo".
        names_to_urls = {e["name"]: e["url"] for e in details}
        assert (
            names_to_urls["owner/repo"]
            == "https://github.com/owner/repo"
        )

    def test_error_records_skipped(
        self, service: LLMService
    ) -> None:
        """URLs with the ``error`` field set are omitted."""
        from ac_dc.url_service.models import URLContent

        # Successful fetch → included.
        service._url_service._fetched[
            "https://good.example.com"
        ] = URLContent(
            url="https://good.example.com",
            url_type="generic",
            content="body",
            fetched_at="2025-01-01T00:00:00Z",
        )
        # Error fetch → excluded.
        service._url_service._fetched[
            "https://bad.example.com"
        ] = URLContent(
            url="https://bad.example.com",
            url_type="generic",
            error="HTTP 500",
            fetched_at="2025-01-01T00:00:00Z",
        )

        details = service.get_context_breakdown()[
            "breakdown"
        ]["url_details"]
        assert len(details) == 1
        assert details[0]["url"] == "https://good.example.com"


class TestBreakdownSymbolMapDetails:
    """The Budget sub-view's expandable Symbol Map / Doc Map category.

    ``breakdown.symbol_map_details`` carries a list of
    ``{name, path, tokens}`` entries — one per file in the
    active mode's primary index. Selected files and
    user-excluded files are absent (their content flows via
    ``file:`` or is dropped entirely).
    """

    def _make_service(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        symbol_paths: list[str] | None = None,
        doc_paths: list[str] | None = None,
    ) -> LLMService:
        """Service with controllable index contents."""
        symbol_paths = symbol_paths or []
        doc_paths = doc_paths or []

        class _SymbolIndexStub:
            def __init__(self, paths: list[str]) -> None:
                self._all_symbols = {p: None for p in paths}

            def get_file_symbol_block(
                self, path: str
            ) -> str | None:
                if path in self._all_symbols:
                    return (
                        f"symbol block for {path}\n"
                        "with some content\n"
                    )
                return None

            def get_signature_hash(
                self, path: str
            ) -> str | None:
                return f"sig-{path}" if (
                    path in self._all_symbols
                ) else None

            def get_legend(self) -> str:
                return ""

            def get_symbol_map(
                self,
                exclude_files: set[str] | None = None,
            ) -> str:
                excl = exclude_files or set()
                blocks = []
                for p in self._all_symbols:
                    if p in excl:
                        continue
                    blocks.append(f"symbol block for {p}")
                return "\n\n".join(blocks)

        svc = LLMService(
            config=config,
            repo=repo,
            symbol_index=_SymbolIndexStub(symbol_paths),
        )

        # Seed doc outlines.
        from ac_dc.doc_index.extractors.markdown import (
            MarkdownExtractor,
        )
        from pathlib import Path as _Path

        extractor = MarkdownExtractor()
        for path in doc_paths:
            outline = extractor.extract(
                _Path(path),
                f"# Title {path}\n\nsome body.\n",
            )
            svc._doc_index._all_outlines[path] = outline

        return svc

    def test_empty_when_no_symbol_index(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Service without a symbol index produces no details."""
        svc = LLMService(
            config=config, repo=repo, symbol_index=None
        )
        details = svc.get_context_breakdown()[
            "breakdown"
        ]["symbol_map_details"]
        assert details == []

    def test_code_mode_lists_symbol_index_files(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Code mode emits one entry per file in the symbol index."""
        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=["src/a.py", "src/b.py"],
            doc_paths=["README.md"],
        )
        assert svc._context.mode == Mode.CODE

        details = svc.get_context_breakdown()[
            "breakdown"
        ]["symbol_map_details"]
        paths = sorted(e["path"] for e in details)
        assert paths == ["src/a.py", "src/b.py"]
        # Each entry has the documented shape.
        for entry in details:
            assert set(entry.keys()) == {"name", "path", "tokens"}
            assert entry["tokens"] > 0
        # name is the basename for paths with "/".
        basenames = {e["path"]: e["name"] for e in details}
        assert basenames["src/a.py"] == "a.py"
        assert basenames["src/b.py"] == "b.py"

    def test_doc_mode_lists_doc_index_files(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Doc mode emits one entry per file in the doc index."""
        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=["src/a.py"],
            doc_paths=["docs/guide.md", "README.md"],
        )
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker

        details = svc.get_context_breakdown()[
            "breakdown"
        ]["symbol_map_details"]
        paths = sorted(e["path"] for e in details)
        assert paths == ["README.md", "docs/guide.md"]
        # No .py entries — doc mode doesn't consult the symbol
        # index for the primary map.
        assert not any(
            e["path"].endswith(".py") for e in details
        )

    def test_selected_files_excluded_from_details(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Selected files don't appear in symbol_map_details.

        Same contract as the map itself — selected files'
        content flows via ``file:`` entries in cached tiers
        or the active Working Files section. Their symbol/doc
        blocks would be redundant, so the details listing
        omits them too.
        """
        (repo_dir / "src").mkdir()
        (repo_dir / "src" / "a.py").write_text("content\n")
        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=["src/a.py", "src/b.py"],
        )
        svc.set_selected_files(["src/a.py"])

        details = svc.get_context_breakdown()[
            "breakdown"
        ]["symbol_map_details"]
        paths = [e["path"] for e in details]
        assert "src/a.py" not in paths
        assert "src/b.py" in paths

    def test_user_excluded_files_excluded_from_details(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Index-excluded files are absent from details too.

        Three-state checkbox excludes a file from the index
        entirely — no content, no index block, no entry in
        the breakdown's per-file listing.
        """
        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=["keep.py", "drop.py"],
        )
        svc._excluded_index_files = ["drop.py"]

        details = svc.get_context_breakdown()[
            "breakdown"
        ]["symbol_map_details"]
        paths = [e["path"] for e in details]
        assert "keep.py" in paths
        assert "drop.py" not in paths

    def test_file_count_matches_details_length(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """``symbol_map_files`` count is the total indexed, not filtered.

        Important distinction: the count reflects how many
        files the index holds, while the details list reflects
        how many render. A user who selects 3 of 10 files
        sees ``symbol_map_files=10`` with ``len(details)==7``
        — matches what the Budget sub-view's header should
        show (total known) vs the expanded list (what's
        actually contributing tokens).
        """
        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=["a.py", "b.py", "c.py"],
        )
        breakdown = svc.get_context_breakdown()["breakdown"]
        # All three indexed; all three in details.
        assert breakdown["symbol_map_files"] == 3
        assert len(breakdown["symbol_map_details"]) == 3

    def test_details_tokens_sum_is_reasonable(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Per-file token counts are positive and individually plausible.

        We don't assert a tight numeric match against the
        aggregate ``symbol_map`` total because the formatter's
        aggregated output includes alias headers and cross-file
        separators that the per-file blocks don't duplicate.
        What matters for the Budget UI is that each per-file
        entry reports a positive count and together they
        reflect a non-trivial fraction of the aggregate — so
        the user's expanded view isn't wildly off from the
        collapsed total.
        """
        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=["a.py", "b.py"],
        )
        breakdown = svc.get_context_breakdown()["breakdown"]
        aggregate = breakdown["symbol_map"]
        details = breakdown["symbol_map_details"]
        per_file_sum = sum(e["tokens"] for e in details)
        # Each file contributes some tokens.
        for entry in details:
            assert entry["tokens"] > 0
        # Per-file sum is a meaningful portion of the aggregate
        # — at least half, to rule out a bug where details
        # always report a small constant regardless of content.
        assert per_file_sum >= aggregate // 2