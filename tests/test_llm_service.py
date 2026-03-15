"""Tests for LLMService — state, selection, mode, review, context breakdown."""

import asyncio
import json
from pathlib import Path
from unittest.mock import MagicMock, patch, AsyncMock

import pytest

from ac_dc.config_manager import ConfigManager
from ac_dc.context.stability_tracker import Tier
from ac_dc.llm_service import LLMService, Mode
from ac_dc.repo import Repo


@pytest.fixture
def service(tmp_repo_with_files):
    """LLMService with real repo and config, no symbol index."""
    config = ConfigManager(tmp_repo_with_files)
    repo = Repo(tmp_repo_with_files)
    svc = LLMService(config_manager=config, repo=repo)
    return svc


@pytest.fixture
def service_with_index(tmp_repo_with_files):
    """LLMService with symbol index (if tree-sitter available)."""
    config = ConfigManager(tmp_repo_with_files)
    repo = Repo(tmp_repo_with_files)
    try:
        from ac_dc.symbol_index.index import SymbolIndex
        from ac_dc.symbol_index.parser import TreeSitterParser
        TreeSitterParser.reset()
        idx = SymbolIndex(tmp_repo_with_files)
        idx.index_repo()
    except Exception:
        idx = None
    svc = LLMService(config_manager=config, repo=repo, symbol_index=idx)
    return svc


class TestGetCurrentState:
    def test_returns_required_fields(self, service):
        state = service.get_current_state()
        assert "messages" in state
        assert "selected_files" in state
        assert "streaming_active" in state
        assert "session_id" in state
        assert "repo_name" in state
        assert "cross_ref_enabled" in state
        assert "mode" in state
        assert "init_complete" in state

    def test_initial_state_empty(self, service):
        state = service.get_current_state()
        assert state["messages"] == []
        assert state["selected_files"] == []
        assert state["streaming_active"] is False
        assert state["cross_ref_enabled"] is False
        assert state["mode"] == "code"

    def test_includes_excluded_index_files(self, service):
        state = service.get_current_state()
        assert "excluded_index_files" in state


class TestSelectedFiles:
    def test_set_and_get(self, service):
        service.set_selected_files(["src/main.py", "src/utils.py"])
        result = service.get_selected_files()
        assert result == ["src/main.py", "src/utils.py"]

    def test_returns_copy(self, service):
        service.set_selected_files(["a.py"])
        copy1 = service.get_selected_files()
        copy2 = service.get_selected_files()
        copy1.append("mutated")
        assert service.get_selected_files() == ["a.py"]

    def test_set_excluded_index_files(self, service):
        result = service.set_excluded_index_files(["docs/big.md"])
        assert "docs/big.md" in result

    def test_get_excluded_index_files(self, service):
        service.set_excluded_index_files(["a.md", "b.md"])
        result = service.get_excluded_index_files()
        assert set(result) == {"a.md", "b.md"}


class TestConcurrentStream:
    def test_reject_concurrent(self, service):
        service._streaming_active = True
        service._active_request_id = "req-1"
        result = service.chat_streaming("req-2", "hello")
        assert "error" in result

    def test_cancel_matching_request(self, service):
        service._streaming_active = True
        service._active_request_id = "req-1"
        result = service.cancel_streaming("req-1")
        assert result["status"] == "cancelling"

    def test_cancel_wrong_request(self, service):
        service._streaming_active = True
        service._active_request_id = "req-1"
        result = service.cancel_streaming("req-wrong")
        assert "error" in result


class TestNewSession:
    def test_new_session_changes_id(self, service):
        old_id = service._session_id
        result = service.new_session()
        assert "session_id" in result
        assert result["session_id"] != old_id
        assert service._session_id == result["session_id"]

    def test_new_session_clears_history(self, service):
        service._context.add_message("user", "hello")
        service.new_session()
        assert len(service._context.get_history()) == 0


class TestContextBreakdown:
    def test_returns_breakdown(self, service):
        breakdown = service.get_context_breakdown()
        assert "total_tokens" in breakdown
        assert "max_input_tokens" in breakdown
        assert "model" in breakdown
        assert "breakdown" in breakdown
        assert "session_totals" in breakdown

    def test_breakdown_has_categories(self, service):
        breakdown = service.get_context_breakdown()
        bd = breakdown["breakdown"]
        assert "system" in bd
        assert "symbol_map" in bd
        assert "files" in bd
        assert "history" in bd

    def test_session_totals_initially_zero(self, service):
        breakdown = service.get_context_breakdown()
        totals = breakdown["session_totals"]
        assert totals["total"] == 0

    def test_breakdown_has_url_data(self, service):
        breakdown = service.get_context_breakdown()
        bd = breakdown["breakdown"]
        assert "urls" in bd
        assert "url_details" in bd

    def test_breakdown_has_blocks(self, service):
        breakdown = service.get_context_breakdown()
        assert "blocks" in breakdown
        assert isinstance(breakdown["blocks"], list)

    def test_breakdown_has_cache_hit_rate(self, service):
        breakdown = service.get_context_breakdown()
        assert "cache_hit_rate" in breakdown

    def test_breakdown_has_promotions_demotions(self, service):
        breakdown = service.get_context_breakdown()
        assert "promotions" in breakdown
        assert "demotions" in breakdown


class TestSnippets:
    def test_code_snippets_default(self, service):
        snippets = service.get_snippets()
        assert isinstance(snippets, list)
        assert len(snippets) > 0

    def test_review_snippets_when_active(self, service):
        service._review_active = True
        snippets = service.get_snippets()
        assert isinstance(snippets, list)
        # Review snippets should be different from code snippets
        service._review_active = False
        code_snippets = service.get_snippets()
        if snippets and code_snippets:
            assert snippets[0].get("message") != code_snippets[0].get("message")


class TestModeSwitch:
    def test_switch_to_doc(self, service):
        result = service.switch_mode("doc")
        assert result["status"] == "switched"
        assert result["mode"] == "doc"
        assert service._mode == Mode.DOC

    def test_switch_clears_selected_files(self, service):
        service._selected_files = ["a.py"]
        service.switch_mode("doc")
        assert service._selected_files == []

    def test_switch_back_to_code(self, service):
        service.switch_mode("doc")
        result = service.switch_mode("code")
        assert result["mode"] == "code"

    def test_switch_same_mode_unchanged(self, service):
        result = service.switch_mode("code")
        assert result["status"] == "unchanged"

    def test_cross_ref_resets_on_mode_switch(self, service):
        service._cross_ref_enabled = True
        service.switch_mode("doc")
        assert service._cross_ref_enabled is False

    def test_breakdown_reflects_mode(self, service):
        service.switch_mode("doc")
        breakdown = service.get_context_breakdown()
        assert breakdown["mode"] == "doc"


class TestCrossReference:
    def test_enable(self, service):
        result = service.set_cross_reference(True)
        assert result["cross_ref_enabled"] is True

    def test_disable(self, service):
        service._cross_ref_enabled = True
        result = service.set_cross_reference(False)
        assert result["cross_ref_enabled"] is False

    def test_unchanged(self, service):
        result = service.set_cross_reference(False)
        assert result["status"] == "unchanged"

    def test_state_includes_cross_ref(self, service):
        service.set_cross_reference(True)
        state = service.get_current_state()
        assert state["cross_ref_enabled"] is True


class TestReviewMode:
    def test_check_review_ready_clean(self, service):
        # ConfigManager modifies .gitignore (adding .ac-dc/), so commit that first
        service._repo.stage_files([".gitignore"])
        service._repo.commit("chore: add .ac-dc to gitignore")
        result = service.check_review_ready()
        assert result["clean"] is True

    def test_check_review_ready_dirty(self, service):
        service._repo.write_file("dirty.txt", "content")
        service._repo.stage_files(["dirty.txt"])
        result = service.check_review_ready()
        assert result["clean"] is False

    def test_get_review_state_inactive(self, service):
        state = service.get_review_state()
        assert state["active"] is False

    def test_end_review_when_not_active(self, service):
        result = service.end_review()
        assert "error" in result


class TestDeferredInit:
    def test_deferred_blocks_chat(self, tmp_repo_with_files):
        config = ConfigManager(tmp_repo_with_files)
        repo = Repo(tmp_repo_with_files)
        svc = LLMService(config_manager=config, repo=repo, deferred_init=True)
        result = svc.chat_streaming("req-1", "hello")
        assert "error" in result
        assert "initializing" in result["error"].lower()

    def test_complete_deferred_init(self, tmp_repo_with_files):
        config = ConfigManager(tmp_repo_with_files)
        repo = Repo(tmp_repo_with_files)
        svc = LLMService(config_manager=config, repo=repo, deferred_init=True)
        svc.complete_deferred_init()
        assert svc._init_complete is True


class TestHistoryMethods:
    def test_history_list_sessions(self, service):
        sessions = service.history_list_sessions()
        assert isinstance(sessions, list)

    def test_history_search_empty(self, service):
        results = service.history_search("")
        assert results == []

    def test_get_history_status(self, service):
        status = service.get_history_status()
        assert "tokens" in status
        assert "max" in status
        assert "session_id" in status

    def test_history_search_fallback(self, service):
        """Search falls back to in-memory when store has no results."""
        service._context.add_message("user", "unique_keyword_xyz")
        results = service.history_search("unique_keyword_xyz")
        assert len(results) >= 1


class TestURLMethods:
    def test_detect_urls(self, service):
        results = service.detect_urls("See https://example.com")
        assert len(results) == 1

    def test_get_url_content_unfetched(self, service):
        result = service.get_url_content("https://unfetched.com")
        assert result.get("error") is not None


class TestNavigateFile:
    def test_navigate_returns_ok(self, service):
        result = service.navigate_file("src/main.py")
        assert result["status"] == "ok"
        assert result["path"] == "src/main.py"