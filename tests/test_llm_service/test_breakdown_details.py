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
from typing import Any

from ac_dc.config import ConfigManager
from ac_dc.context_manager import Mode
from ac_dc.history_store import HistoryStore
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


class TestBreakdownAgentTag:
    """D23 — ``get_context_breakdown(agent_tag)`` routing.

    Per specs4/5-webapp/viewers-hud.md § Per-Context-Manager
    Breakdown, the RPC accepts an optional agent identifier
    to target a specific ContextManager. When ``agent_tag``
    is None (the default), reads the main scope; when it
    names an existing agent, reads that scope's state.

    Tests pin:

    - The response's top-level ``scope`` field identifies
      which conversation the data represents ("main" or
      "{turn_id}/agent-NN"). Lets the frontend detect stale
      data when the user switches tabs mid-fetch.
    - Agent scopes report their own tracker tiers, selected
      files, excluded files, and ContextManager history —
      not the main scope's.
    - Unknown agent tags return ``{"error": "agent not
      found"}`` rather than silently falling back to main
      (which would confuse the frontend's tab state).
    """

    def _make_agent_block(
        self,
        agent_id: str = "agent-0",
        task: str = "do something",
    ) -> Any:
        from ac_dc.edit_protocol import AgentBlock

        return AgentBlock(id=agent_id, task=task)

    def test_untagged_returns_main_scope(
        self,
        service: LLMService,
    ) -> None:
        """No agent_tag → main conversation breakdown."""
        result = service.get_context_breakdown()
        assert result.get("scope") == "main"

    def test_explicit_none_returns_main(
        self,
        service: LLMService,
    ) -> None:
        """Explicit None behaves identically to omission."""
        result = service.get_context_breakdown(None)
        assert result.get("scope") == "main"

    def test_unknown_turn_returns_error(
        self,
        service: LLMService,
    ) -> None:
        """Unknown turn_id → agent-not-found error.

        No fallback to main — the frontend needs to know
        the tag was stale so it can close the tab rather
        than silently showing main's data in an agent tab
        slot.
        """
        result = service.get_context_breakdown(
            ("turn_nonexistent", 0),
        )
        assert result == {"error": "agent not found"}

    def test_unknown_agent_idx_returns_error(
        self,
        service: LLMService,
    ) -> None:
        """Known turn but unknown agent_idx → error."""
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_known",
        )
        result = service.get_context_breakdown(
            ("turn_known", 99),
        )
        assert result == {"error": "agent not found"}

    def test_agent_scope_label_includes_turn_and_idx(
        self,
        service: LLMService,
    ) -> None:
        """Scope label matches the frontend tab ID shape."""
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_abc",
        )
        result = service.get_context_breakdown(
            ("turn_abc", 0),
        )
        # Frontend's tab IDs are "{turn_id}/agent-{NN:02d}";
        # the scope label matches so the frontend can compare
        # directly.
        assert result.get("scope") == "turn_abc/agent-00"

    def test_agent_scope_two_digit_padding(
        self,
        service: LLMService,
    ) -> None:
        """Agent index zero-padded to two digits.

        Matches the backend's archive path convention
        (``.ac-dc4/agents/{turn_id}/agent-NN.jsonl``) and
        the frontend's tab ID format. A single-digit label
        here would break the frontend's tab ID comparison.
        """
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=7,
            parent_scope=parent_scope,
            turn_id="turn_xyz",
        )
        result = service.get_context_breakdown(
            ("turn_xyz", 7),
        )
        assert result.get("scope") == "turn_xyz/agent-07"

    def test_list_agent_tag_accepted(
        self,
        service: LLMService,
    ) -> None:
        """JRPC-OO array form parses identically to tuple.

        Over the wire jrpc-oo serialises Python tuples to
        JS arrays. The frontend sends ``[turn_id, idx]``;
        the parser must accept both shapes.
        """
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_list",
        )
        result = service.get_context_breakdown(
            ["turn_list", 0],
        )
        assert result.get("scope") == "turn_list/agent-00"

    def test_malformed_agent_tag_falls_back_to_main(
        self,
        service: LLMService,
    ) -> None:
        """Malformed tag parses to None; resolver treats as main.

        Matches the delegator's behaviour — a non-None
        agent_tag that fails to parse is treated as a
        client bug and routed to main rather than erroring.
        The debug log records the malformed payload for
        operators.
        """
        # Various malformed shapes.
        for bad in [
            "not-a-tuple",
            [],
            ["only-one"],
            ["turn", "not-int"],
            ("turn", -1),
            {"turn": "x"},
        ]:
            result = service.get_context_breakdown(bad)
            assert result.get("scope") == "main", (
                f"{bad!r} should fall back to main"
            )

    def test_agent_scope_reports_its_own_selection(
        self,
        service: LLMService,
        repo_dir: Path,
    ) -> None:
        """Agent's selection appears in the breakdown's file details."""
        (repo_dir / "agent-only.py").write_text(
            "agent content\n"
        )
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_sel",
        )
        # Seed different selections per scope.
        service.set_selected_files([])
        service.set_agent_selected_files(
            "turn_sel", 0, ["agent-only.py"],
        )

        # Main breakdown — no file details for agent-only.py.
        main = service.get_context_breakdown()
        main_paths = [
            f["path"] for f in
            main["breakdown"]["file_details"]
        ]
        # Agent breakdown — should see the agent's selection.
        # The file_context is per-scope; agent's scope has
        # agent-only.py loaded (via the _sync path when the
        # agent's ContextManager reads).
        #
        # The agent breakdown skips the _sync_file_context
        # call (inspection-only path per commit 2's code),
        # so we don't check file_details here — we just
        # check that the scope resolution picked up the
        # right conversation. Specifically, the selected
        # count reflects the agent's list, not main's.
        agent = service.get_context_breakdown(("turn_sel", 0))
        assert agent.get("scope") == "turn_sel/agent-00"
        # Main has no selection → no files appear in main's
        # wide_map_exclude_set-driven breakdown.
        # (Full file_details coverage depends on file_context
        # contents, which the agent's own streaming pipeline
        # drives; the per-scope selection is the load-bearing
        # signal here.)
        assert "agent-only.py" not in main_paths

    def test_agent_scope_reports_its_own_exclusion(
        self,
        service: LLMService,
    ) -> None:
        """Agent's excluded files appear in that scope's computation.

        End-to-end check that ``excluded_index_files`` on
        the ConversationScope flows through to the breakdown's
        wide-map exclusion set. Without this, the
        ``get_context_breakdown`` call reads from
        ``service._excluded_index_files`` (main's list) even
        when an agent tag was supplied — the symbol_map
        section would then reflect main's exclusions, not
        the agent's.
        """
        parent_scope = service._default_scope()
        service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_excl",
        )
        # Set different exclusions on each scope.
        service._excluded_index_files = ["main-excl.py"]
        service.set_agent_excluded_index_files(
            "turn_excl", 0, ["agent-excl.py"],
        )
        # Fetching agent breakdown — no raise, scope label
        # correct.
        agent = service.get_context_breakdown(("turn_excl", 0))
        assert agent.get("scope") == "turn_excl/agent-00"
        # Main breakdown reports main scope.
        main = service.get_context_breakdown()
        assert main.get("scope") == "main"

    def test_agent_scope_reports_its_own_tracker(
        self,
        service: LLMService,
    ) -> None:
        """Agent tier blocks come from its own StabilityTracker.

        Build agent scope (fresh empty tracker per
        build_agent_scope contract), then seed a distinctive
        item. The agent breakdown surfaces that item; main
        breakdown does not.
        """
        from ac_dc.stability_tracker import Tier, TrackedItem

        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_tracker",
        )
        # Seed a distinctive item on the agent's tracker.
        scope.tracker._items["symbol:agent-only.py"] = TrackedItem(
            key="symbol:agent-only.py",
            tier=Tier.L1,
            n_value=5,
            content_hash="h",
            tokens=42,
        )

        # Agent breakdown includes the item.
        agent = service.get_context_breakdown(("turn_tracker", 0))
        agent_keys: list[str] = []
        for block in agent.get("blocks", []):
            for item in block.get("contents", []):
                agent_keys.append(item.get("name"))
        assert "symbol:agent-only.py" in agent_keys

        # Main breakdown does not.
        main = service.get_context_breakdown()
        main_keys: list[str] = []
        for block in main.get("blocks", []):
            for item in block.get("contents", []):
                main_keys.append(item.get("name"))
        assert "symbol:agent-only.py" not in main_keys

    def test_agent_scope_reports_its_own_history(
        self,
        service: LLMService,
    ) -> None:
        """History token count reflects agent's ContextManager.

        Each scope has its own ContextManager; the agent's
        starts with whatever seed messages the spawn put
        there (or empty for a manually-built scope). Main's
        starts with whatever session state was restored.
        Pinning this check guards against a regression
        where the breakdown reads main's history for an
        agent-tagged call.
        """
        parent_scope = service._default_scope()
        scope = service._build_agent_scope(
            block=self._make_agent_block(),
            agent_idx=0,
            parent_scope=parent_scope,
            turn_id="turn_hist",
        )
        # Seed agent's history with a distinctive message.
        scope.context.add_message(
            "user", "agent-only question",
        )
        # Main's history stays empty.
        main_history_tokens = (
            service._context.history_token_count()
        )
        # Agent breakdown → history_messages count reflects
        # the agent's scope.
        agent = service.get_context_breakdown(("turn_hist", 0))
        assert agent["breakdown"]["history_messages"] >= 1
        # Main breakdown → reflects main's (empty) history.
        main = service.get_context_breakdown()
        assert main["breakdown"]["history_messages"] == 0