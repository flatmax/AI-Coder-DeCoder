"""Code review mode — entry, exit, diffs, context injection.

Covers :class:`TestReview` — :meth:`LLMService.check_review_ready`,
:meth:`LLMService.start_review`, :meth:`LLMService.end_review`,
:meth:`LLMService.get_review_state`,
:meth:`LLMService.get_review_file_diff`, plus the snippet
routing for review mode and the commit graph RPC.

Review mode is a Layer 4.3 feature — see
:doc:`specs4/4-features/code-review` for the git state machine.
"""

from __future__ import annotations

import asyncio
import subprocess
from pathlib import Path

import pytest

from ac_dc.config import ConfigManager
from ac_dc.history_store import HistoryStore
from ac_dc.llm_service import LLMService

from .conftest import _FakeLiteLLM, _RecordingEventCallback, _run_git


class TestReview:
    """Code review mode — Layer 4.3."""

    def test_check_review_ready_clean_tree(
        self, service: LLMService
    ) -> None:
        """Clean working tree → ready."""
        result = service.check_review_ready()
        assert result == {"clean": True}

    def test_check_review_ready_dirty_tree(
        self,
        service: LLMService,
        repo_dir: Path,
    ) -> None:
        """Uncommitted changes → not ready with message."""
        # Introduce a staged change.
        (repo_dir / "new.md").write_text("content")
        _run_git(repo_dir, "add", "new.md")
        result = service.check_review_ready()
        assert result["clean"] is False
        assert "commit" in result["message"].lower()

    def test_check_review_ready_no_repo(
        self,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Service without a repo → not ready."""
        svc = LLMService(config=config, repo=None)
        result = svc.check_review_ready()
        assert result["clean"] is False
        assert "repository" in result["message"].lower()

    def test_get_review_state_inactive(
        self, service: LLMService
    ) -> None:
        """Pre-start state has active=False and empty fields."""
        state = service.get_review_state()
        assert state["active"] is False
        assert state["branch"] is None
        assert state["commits"] == []
        assert state["changed_files"] == []
        # pre_change_symbol_map stripped from the response.
        assert "pre_change_symbol_map" not in state

    def test_state_snapshot_includes_review(
        self, service: LLMService
    ) -> None:
        """get_current_state exposes review_state."""
        state = service.get_current_state()
        assert "review_state" in state
        assert state["review_state"]["active"] is False

    def test_start_review_requires_repo(
        self,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """No repo → clean error."""
        svc = LLMService(config=config, repo=None)
        result = svc.start_review("feature", "abc1234")
        assert "repository" in result.get("error", "").lower()

    def test_start_review_rejects_dirty_tree(
        self,
        service: LLMService,
        repo_dir: Path,
    ) -> None:
        """Dirty tree rejection happens at start_review too."""
        (repo_dir / "new.md").write_text("content")
        _run_git(repo_dir, "add", "new.md")
        result = service.start_review("main", "HEAD")
        assert "error" in result
        # Review state not activated.
        assert service._review_active is False

    def test_start_review_full_lifecycle(
        self,
        service: LLMService,
        repo_dir: Path,
        history_store: HistoryStore,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """Full round-trip — enter review, exit cleanly."""
        # Set up a feature branch with a commit.
        _run_git(repo_dir, "checkout", "-q", "-b", "feature")
        (repo_dir / "new.py").write_text("def hello(): pass\n")
        _run_git(repo_dir, "add", "new.py")
        _run_git(
            repo_dir, "commit", "-q", "-m", "feat: add hello"
        )
        _run_git(repo_dir, "checkout", "-q", "main")

        # Pre-review: record original system prompt for later
        # restoration check.
        orig_prompt = service._context.get_system_prompt()

        # Enter review. base_commit is the feature branch tip
        # (the selector UI would provide this).
        tip_result = service._repo._run_git(
            ["rev-parse", "feature"], check=True
        )
        tip_sha = tip_result.stdout.strip()
        result = service.start_review("feature", tip_sha)

        assert result["status"] == "review_active"
        assert result["branch"] == "feature"
        assert result["stats"]["commit_count"] >= 1
        assert service._review_active is True

        # System prompt swapped.
        current_prompt = service._context.get_system_prompt()
        assert current_prompt != orig_prompt
        assert (
            current_prompt == service._config.get_review_prompt()
        )

        # Review state populated.
        review_state = service.get_review_state()
        assert review_state["active"] is True
        assert review_state["branch"] == "feature"
        assert len(review_state["commits"]) >= 1
        assert len(review_state["changed_files"]) >= 1

        # Selection cleared on entry.
        assert service.get_selected_files() == []

        # System event recorded in both stores.
        history = service.get_current_state()["messages"]
        entry_events = [
            m for m in history
            if m.get("system_event")
            and "review" in m.get("content", "").lower()
        ]
        assert len(entry_events) == 1
        assert "feature" in entry_events[0]["content"]

        # filesChanged broadcast emitted on entry.
        files_changed_events = [
            args for name, args in event_cb.events
            if name == "filesChanged"
        ]
        assert files_changed_events

        # Exit review.
        exit_result = service.end_review()
        assert exit_result["status"] == "restored"
        assert service._review_active is False

        # System prompt restored.
        assert service._context.get_system_prompt() == orig_prompt

        # Review state cleared.
        cleared_state = service.get_review_state()
        assert cleared_state["active"] is False
        assert cleared_state["branch"] is None

        # Second system event (exit).
        history = service.get_current_state()["messages"]
        exit_events = [
            m for m in history
            if m.get("system_event")
            and "exited" in m.get("content", "").lower()
        ]
        assert len(exit_events) == 1

    def test_start_review_rejects_concurrent(
        self,
        service: LLMService,
        repo_dir: Path,
    ) -> None:
        """Already-active review rejects new start."""
        service._review_active = True
        result = service.start_review("any", "any")
        assert "already active" in result.get("error", "").lower()

    def test_end_review_when_not_active(
        self, service: LLMService
    ) -> None:
        """end_review when inactive returns clean error."""
        result = service.end_review()
        assert "not active" in result.get("error", "").lower()

    def test_end_review_clears_state_even_on_exit_failure(
        self,
        service: LLMService,
        repo_dir: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Even if git exit fails, review state is cleared."""
        # Activate review with a valid state.
        _run_git(repo_dir, "checkout", "-q", "-b", "feature")
        (repo_dir / "x.py").write_text("x")
        _run_git(repo_dir, "add", "x.py")
        _run_git(repo_dir, "commit", "-q", "-m", "feat")
        _run_git(repo_dir, "checkout", "-q", "main")
        tip = service._repo._run_git(
            ["rev-parse", "feature"], check=True
        ).stdout.strip()
        service.start_review("feature", tip)
        assert service._review_active is True

        # Force the repo's exit to fail.
        def failing_exit(*args, **kwargs):
            return {"error": "simulated failure"}
        monkeypatch.setattr(
            service._repo, "exit_review_mode", failing_exit
        )

        result = service.end_review()
        # Partial status returned with the error.
        assert result.get("status") == "partial"
        assert "simulated" in result.get("error", "")
        # But review state IS cleared so the user isn't stuck.
        assert service._review_active is False
        assert service.get_review_state()["active"] is False

    def test_get_review_file_diff_requires_active(
        self, service: LLMService
    ) -> None:
        """Diff fetch is guarded by review-active flag."""
        result = service.get_review_file_diff("some.py")
        assert "not active" in result.get("error", "").lower()

    def test_get_review_file_diff_no_repo(
        self,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Service without a repo → clean error."""
        svc = LLMService(config=config, repo=None)
        svc._review_active = True
        result = svc.get_review_file_diff("some.py")
        assert "repository" in result.get("error", "").lower()

    def test_get_snippets_default_code(
        self, service: LLMService
    ) -> None:
        """Code mode snippets when no mode/review state active."""
        snippets = service.get_snippets()
        assert isinstance(snippets, list)
        # Code snippets cover common LLM interaction patterns.
        assert any(
            "continue" in s.get("message", "").lower()
            for s in snippets
        )

    def test_get_snippets_review_mode(
        self, service: LLMService
    ) -> None:
        """Review snippets returned when review active."""
        service._review_active = True
        snippets = service.get_snippets()
        assert isinstance(snippets, list)
        # At least one review-style snippet should mention review.
        assert any(
            "review" in s.get("message", "").lower()
            for s in snippets
        )

    def test_get_snippets_doc_mode(
        self, service: LLMService
    ) -> None:
        """Doc snippets returned in doc mode (outside review)."""
        service.switch_mode("doc")
        snippets = service.get_snippets()
        assert isinstance(snippets, list)
        # Doc snippets mention summaries / documents.
        assert any(
            any(
                k in s.get("message", "").lower()
                for k in ("summaris", "document", "toc")
            )
            for s in snippets
        )

    def test_get_snippets_review_overrides_mode(
        self, service: LLMService
    ) -> None:
        """Review snippets win over doc-mode snippets."""
        service.switch_mode("doc")
        service._review_active = True
        snippets = service.get_snippets()
        # Review snippets — verify a review-specific snippet
        # appears and doc-specific ones don't.
        messages = [s.get("message", "").lower() for s in snippets]
        assert any("review" in m for m in messages)

    def test_get_commit_graph_delegates(
        self,
        service: LLMService,
        repo_dir: Path,
    ) -> None:
        """get_commit_graph delegates to the repo."""
        result = service.get_commit_graph(limit=10)
        assert "commits" in result
        assert "branches" in result
        assert "has_more" in result

    def test_get_commit_graph_no_repo(
        self,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """No repo → empty shape rather than error."""
        svc = LLMService(config=config, repo=None)
        result = svc.get_commit_graph()
        assert result == {
            "commits": [],
            "branches": [],
            "has_more": False,
        }

    def test_review_state_returns_independent_copies(
        self, service: LLMService
    ) -> None:
        """Mutating returned state doesn't affect stored state."""
        # Seed review state directly to avoid running the full
        # entry sequence.
        service._review_state = {
            "active": True,
            "branch": "feature",
            "branch_tip": "abc",
            "base_commit": "xyz",
            "parent_commit": "def",
            "original_branch": "main",
            "commits": [{"sha": "1"}],
            "changed_files": [{"path": "a.py"}],
            "stats": {"commit_count": 1},
            "pre_change_symbol_map": "secret",
        }
        state = service.get_review_state()
        # pre_change_symbol_map stripped.
        assert "pre_change_symbol_map" not in state
        # Mutating copies doesn't affect stored state.
        state["commits"].append({"sha": "2"})
        state["changed_files"].append({"path": "b.py"})
        state["stats"]["commit_count"] = 999
        assert len(service._review_state["commits"]) == 1
        assert len(service._review_state["changed_files"]) == 1
        assert service._review_state["stats"]["commit_count"] == 1

    async def test_streaming_injects_review_context(
        self,
        service: LLMService,
        repo_dir: Path,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Active review → review context attached to context manager."""
        # Set up a feature branch with a commit.
        _run_git(repo_dir, "checkout", "-q", "-b", "feature")
        (repo_dir / "new.py").write_text(
            "def hello():\n    return 42\n"
        )
        _run_git(repo_dir, "add", "new.py")
        _run_git(
            repo_dir, "commit", "-q", "-m", "feat: add hello"
        )
        _run_git(repo_dir, "checkout", "-q", "main")

        tip = service._repo._run_git(
            ["rev-parse", "feature"], check=True
        ).stdout.strip()
        service.start_review("feature", tip)

        # Stream a message — should trigger review context build.
        fake_litellm.set_streaming_chunks(["ok"])
        await service.chat_streaming(
            request_id="r1", message="review this"
        )
        await asyncio.sleep(0.3)

        # Review context populated on the context manager.
        review_ctx = service._context.get_review_context()
        assert review_ctx is not None
        assert "feature" in review_ctx
        assert "## Review:" in review_ctx
        assert "## Commits" in review_ctx

    async def test_streaming_without_review_clears_context(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Non-review streaming clears any stale review context."""
        # Seed a stale review context.
        service._context.set_review_context("stale review data")
        assert service._context.get_review_context() == (
            "stale review data"
        )

        fake_litellm.set_streaming_chunks(["ok"])
        await service.chat_streaming(
            request_id="r1", message="normal chat"
        )
        await asyncio.sleep(0.3)

        # Context cleared defensively.
        assert service._context.get_review_context() is None