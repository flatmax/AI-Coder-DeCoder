"""Tests for collab restriction enforcement — Layer 4.4.2.

Scope: verifies that mutating methods on :class:`Repo` consult
the attached :class:`Collab` instance's
:meth:`is_caller_localhost` and return the
``{"error": "restricted", ...}`` shape when the caller is a
non-localhost participant.

Strategy:

- Real :class:`Repo` against a fresh git repo per test, same as
  ``test_repo.py``'s fixtures.
- Stub collab — a minimal class exposing
  :meth:`is_caller_localhost` with a configurable return value.
  Tests don't exercise the full admission flow; that's covered
  by ``test_collab.py``.
- Two scenarios per method — localhost caller allowed (normal
  behaviour), non-localhost caller rejected with the specific
  error shape.

The single-user path (``_collab is None``) isn't tested here
because every other test in the suite exercises it — 1855+
existing tests all run with ``_collab = None`` and would fail
if the guard broke the common case.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

import pytest

from ac_dc.repo import Repo


# ---------------------------------------------------------------------------
# Stub collab
# ---------------------------------------------------------------------------


class _StubCollab:
    """Minimal collab stand-in for restriction tests.

    Exposes :meth:`is_caller_localhost` with a configurable
    return value. The real :class:`Collab` has the same method
    but delegates to server-side caller tracking; here we just
    pin the return directly so tests focus on the guard
    behaviour rather than the tracking mechanism.
    """

    def __init__(self, is_localhost: bool = True) -> None:
        self._is_localhost = is_localhost
        self.call_count = 0

    def is_caller_localhost(self) -> bool:
        self.call_count += 1
        return self._is_localhost


class _RaisingCollab:
    """Collab stub that raises from ``is_caller_localhost``.

    Used to verify the "fail closed" defensive path — if the
    collab check itself throws, the guard must still refuse
    rather than silently allow the call through.
    """

    def is_caller_localhost(self) -> bool:
        raise RuntimeError("collab check failed")


# ---------------------------------------------------------------------------
# Fixtures — same shape as test_repo.py
# ---------------------------------------------------------------------------


def _run_git(cwd: Path, *args: str) -> None:
    result = subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, (
        f"git {' '.join(args)} failed: {result.stderr}"
    )


@pytest.fixture
def repo_dir(tmp_path: Path) -> Path:
    d = tmp_path / "repo"
    d.mkdir()
    _run_git(d, "init", "-q")
    _run_git(d, "config", "user.email", "test@example.com")
    _run_git(d, "config", "user.name", "Test")
    _run_git(d, "config", "init.defaultBranch", "main")
    _run_git(d, "checkout", "-q", "-b", "main")
    (d / "seed.md").write_text("seed\n")
    _run_git(d, "add", "seed.md")
    _run_git(d, "commit", "-q", "-m", "seed")
    return d


@pytest.fixture
def repo(repo_dir: Path) -> Repo:
    return Repo(repo_dir)


# ---------------------------------------------------------------------------
# Shared assertion helpers
# ---------------------------------------------------------------------------


def _assert_restricted(result: Any) -> None:
    """Assert ``result`` matches the specs4 restricted-error shape."""
    assert isinstance(result, dict)
    assert result.get("error") == "restricted"
    # Reason is human-readable — don't pin exact wording, just
    # make sure it exists and is a non-empty string.
    reason = result.get("reason")
    assert isinstance(reason, str)
    assert reason


# ---------------------------------------------------------------------------
# No-collab single-user path
# ---------------------------------------------------------------------------


class TestNoCollab:
    """``_collab = None`` — every caller treated as localhost."""

    def test_stage_all_allowed(self, repo: Repo) -> None:
        # No collab attached — default behaviour.
        assert repo._collab is None
        result = repo.stage_all()
        assert result == {"status": "ok"}

    def test_check_returns_none_without_collab(
        self, repo: Repo
    ) -> None:
        assert repo._check_localhost_only() is None


# ---------------------------------------------------------------------------
# Localhost caller — allowed
# ---------------------------------------------------------------------------


class TestLocalhostAllowed:
    """Localhost caller sees normal behaviour."""

    def test_stage_all(self, repo: Repo, repo_dir: Path) -> None:
        (repo_dir / "a.md").write_text("new")
        repo._collab = _StubCollab(is_localhost=True)
        result = repo.stage_all()
        assert result == {"status": "ok"}

    def test_commit(self, repo: Repo, repo_dir: Path) -> None:
        (repo_dir / "a.md").write_text("new")
        _run_git(repo_dir, "add", "a.md")
        repo._collab = _StubCollab(is_localhost=True)
        result = repo.commit("add a.md")
        assert "sha" in result
        assert "error" not in result

    def test_reset_hard(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        (repo_dir / "a.md").write_text("dirty")
        repo._collab = _StubCollab(is_localhost=True)
        result = repo.reset_hard()
        assert result == {"status": "ok"}

    def test_stage_files(self, repo: Repo, repo_dir: Path) -> None:
        (repo_dir / "a.md").write_text("new")
        repo._collab = _StubCollab(is_localhost=True)
        result = repo.stage_files(["a.md"])
        assert result == {"status": "ok"}

    def test_unstage_files(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        (repo_dir / "a.md").write_text("new")
        _run_git(repo_dir, "add", "a.md")
        repo._collab = _StubCollab(is_localhost=True)
        result = repo.unstage_files(["a.md"])
        assert result == {"status": "ok"}

    async def test_discard_changes(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        (repo_dir / "seed.md").write_text("modified")
        repo._collab = _StubCollab(is_localhost=True)
        result = await repo.discard_changes(["seed.md"])
        assert result == {"status": "ok"}

    async def test_write_file(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        repo._collab = _StubCollab(is_localhost=True)
        result = await repo.write_file("new.md", "content")
        assert result == {"status": "ok"}

    async def test_create_file(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        repo._collab = _StubCollab(is_localhost=True)
        result = await repo.create_file("new.md", "content")
        assert result == {"status": "ok"}

    async def test_delete_file(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        (repo_dir / "to_delete.md").write_text("goodbye")
        repo._collab = _StubCollab(is_localhost=True)
        result = await repo.delete_file("to_delete.md")
        assert result == {"status": "ok"}

    async def test_rename_file(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        (repo_dir / "old.md").write_text("content")
        repo._collab = _StubCollab(is_localhost=True)
        result = await repo.rename_file("old.md", "new.md")
        assert result == {"status": "ok"}

    async def test_rename_directory(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        (repo_dir / "olddir").mkdir()
        (repo_dir / "olddir" / "file.md").write_text("x")
        repo._collab = _StubCollab(is_localhost=True)
        result = await repo.rename_directory("olddir", "newdir")
        assert result == {"status": "ok"}


# ---------------------------------------------------------------------------
# Non-localhost caller — rejected
# ---------------------------------------------------------------------------


class TestNonLocalhostRejected:
    """Non-localhost caller gets the restricted-error shape.

    Each test asserts that:
    1. The method returns the restricted-error dict
    2. The collab's ``is_caller_localhost`` was consulted
    3. No side effect on disk — the repo state is unchanged
    """

    def test_stage_all(self, repo: Repo, repo_dir: Path) -> None:
        (repo_dir / "a.md").write_text("new")
        collab = _StubCollab(is_localhost=False)
        repo._collab = collab
        result = repo.stage_all()
        _assert_restricted(result)
        assert collab.call_count == 1
        # Staging didn't happen — status-porcelain shows a.md
        # as untracked, not staged.
        status = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=repo_dir, capture_output=True, text=True,
            check=True,
        )
        assert "A  a.md" not in status.stdout
        assert "?? a.md" in status.stdout

    def test_commit(self, repo: Repo, repo_dir: Path) -> None:
        (repo_dir / "a.md").write_text("new")
        _run_git(repo_dir, "add", "a.md")
        repo._collab = _StubCollab(is_localhost=False)
        result = repo.commit("try to commit")
        _assert_restricted(result)
        # a.md is still staged — commit didn't fire.
        status = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=repo_dir, capture_output=True, text=True,
            check=True,
        )
        assert "A  a.md" in status.stdout

    def test_reset_hard(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        (repo_dir / "seed.md").write_text("modified")
        repo._collab = _StubCollab(is_localhost=False)
        result = repo.reset_hard()
        _assert_restricted(result)
        # Modifications preserved.
        assert (
            (repo_dir / "seed.md").read_text() == "modified"
        )

    def test_stage_files(self, repo: Repo, repo_dir: Path) -> None:
        (repo_dir / "a.md").write_text("new")
        repo._collab = _StubCollab(is_localhost=False)
        result = repo.stage_files(["a.md"])
        _assert_restricted(result)

    def test_unstage_files(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        (repo_dir / "a.md").write_text("new")
        _run_git(repo_dir, "add", "a.md")
        repo._collab = _StubCollab(is_localhost=False)
        result = repo.unstage_files(["a.md"])
        _assert_restricted(result)

    async def test_discard_changes(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        (repo_dir / "seed.md").write_text("modified")
        repo._collab = _StubCollab(is_localhost=False)
        result = await repo.discard_changes(["seed.md"])
        _assert_restricted(result)
        # Modification preserved.
        assert (repo_dir / "seed.md").read_text() == "modified"

    async def test_write_file(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        repo._collab = _StubCollab(is_localhost=False)
        result = await repo.write_file("new.md", "content")
        _assert_restricted(result)
        # File wasn't written.
        assert not (repo_dir / "new.md").exists()

    async def test_create_file(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        repo._collab = _StubCollab(is_localhost=False)
        result = await repo.create_file("new.md", "content")
        _assert_restricted(result)
        assert not (repo_dir / "new.md").exists()

    async def test_delete_file(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        (repo_dir / "to_delete.md").write_text("preserved")
        repo._collab = _StubCollab(is_localhost=False)
        result = await repo.delete_file("to_delete.md")
        _assert_restricted(result)
        # File still exists.
        assert (
            (repo_dir / "to_delete.md").read_text() == "preserved"
        )

    async def test_rename_file(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        (repo_dir / "old.md").write_text("content")
        repo._collab = _StubCollab(is_localhost=False)
        result = await repo.rename_file("old.md", "new.md")
        _assert_restricted(result)
        # Original still there, new not created.
        assert (repo_dir / "old.md").exists()
        assert not (repo_dir / "new.md").exists()

    async def test_rename_directory(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        (repo_dir / "olddir").mkdir()
        (repo_dir / "olddir" / "file.md").write_text("x")
        repo._collab = _StubCollab(is_localhost=False)
        result = await repo.rename_directory("olddir", "newdir")
        _assert_restricted(result)
        assert (repo_dir / "olddir").exists()
        assert not (repo_dir / "newdir").exists()


# ---------------------------------------------------------------------------
# Defensive — collab check failure
# ---------------------------------------------------------------------------


class TestCollabCheckFailure:
    """If the collab check itself raises, fail closed."""

    def test_stage_all_fails_closed(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        (repo_dir / "a.md").write_text("new")
        repo._collab = _RaisingCollab()
        result = repo.stage_all()
        _assert_restricted(result)
        # Staging didn't happen — a.md still untracked.
        status = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=repo_dir, capture_output=True, text=True,
            check=True,
        )
        assert "?? a.md" in status.stdout


# ---------------------------------------------------------------------------
# Read operations unaffected
# ---------------------------------------------------------------------------


class TestReadOperationsAllowed:
    """Read-only methods work regardless of localhost status.

    Specs4 — non-localhost participants can browse, search,
    view diffs. Only mutating methods are guarded.
    """

    def test_get_file_content(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        repo._collab = _StubCollab(is_localhost=False)
        # Read-only — no restriction.
        content = repo.get_file_content("seed.md")
        assert content == "seed\n"

    def test_get_staged_diff(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        repo._collab = _StubCollab(is_localhost=False)
        diff = repo.get_staged_diff()
        # Empty diff — no staged changes.
        assert diff == ""

    def test_file_exists(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        repo._collab = _StubCollab(is_localhost=False)
        assert repo.file_exists("seed.md") is True
        assert repo.file_exists("nonexistent.md") is False

    def test_is_clean(
        self, repo: Repo, repo_dir: Path
    ) -> None:
        repo._collab = _StubCollab(is_localhost=False)
        assert repo.is_clean() is True


# =============================================================
# LLMService restriction tests
# =============================================================
#
# Same pattern as the Repo tests above — stub collab, two
# scenarios per method (localhost allowed, non-localhost
# rejected). We use a minimal LLMService construction that
# avoids needing a real symbol index or history store.


from ac_dc.config import ConfigManager
from ac_dc.llm_service import LLMService


@pytest.fixture
def config_dir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Path:
    """Isolate config directory per test."""
    d = tmp_path / "config"
    monkeypatch.setenv("AC_DC_CONFIG_HOME", str(d))
    return d


@pytest.fixture
def config(
    config_dir: Path, repo_dir: Path
) -> ConfigManager:
    return ConfigManager(repo_root=repo_dir)


@pytest.fixture
def service(
    config: ConfigManager, repo: Repo
) -> LLMService:
    """Minimal LLMService — no history store, no symbol index."""
    return LLMService(config=config, repo=repo)


# ---------------------------------------------------------------------------
# LLMService — no-collab path
# ---------------------------------------------------------------------------


class TestLLMServiceNoCollab:
    """Without collab attached, everything works normally."""

    def test_check_returns_none_without_collab(
        self, service: LLMService
    ) -> None:
        assert service._check_localhost_only() is None

    def test_new_session_allowed(
        self, service: LLMService
    ) -> None:
        # Default state — no collab, no restriction.
        result = service.new_session()
        assert "session_id" in result
        assert "error" not in result


# ---------------------------------------------------------------------------
# LLMService — localhost caller allowed
# ---------------------------------------------------------------------------


class TestLLMServiceLocalhostAllowed:
    """Localhost caller sees normal behaviour."""

    def test_new_session(self, service: LLMService) -> None:
        service._collab = _StubCollab(is_localhost=True)
        result = service.new_session()
        assert "session_id" in result

    def test_set_selected_files(
        self, service: LLMService, repo_dir: Path
    ) -> None:
        (repo_dir / "a.md").write_text("x")
        service._collab = _StubCollab(is_localhost=True)
        result = service.set_selected_files(["a.md"])
        # Normal path returns a list of the accepted paths.
        assert result == ["a.md"]

    def test_switch_mode(self, service: LLMService) -> None:
        service._collab = _StubCollab(is_localhost=True)
        result = service.switch_mode("doc")
        assert result.get("mode") == "doc"

    def test_set_cross_reference(
        self, service: LLMService
    ) -> None:
        # Enable requires doc index readiness (2.8.2g). Fake
        # the flag since the real background build isn't
        # wired in this fixture.
        service._doc_index_ready = True
        service._collab = _StubCollab(is_localhost=True)
        result = service.set_cross_reference(True)
        assert result.get("status") == "ok"
        assert result.get("cross_ref_enabled") is True

    def test_reset_to_head(
        self, service: LLMService
    ) -> None:
        service._collab = _StubCollab(is_localhost=True)
        result = service.reset_to_head()
        assert result.get("status") == "ok"

    def test_cancel_streaming_localhost_accepts_any_id(
        self, service: LLMService
    ) -> None:
        """Localhost caller — cancel accepts any id and adds it
        to the cancelled set.

        The previous "not the active stream" guard rejected ids
        that didn't match ``_active_user_request``. Removed
        because agent tabs send child ids of shape
        ``{parent}-agent-NN`` which never match the parent —
        Stop on an agent tab silently no-op'd. The worker's
        per-chunk membership check is the authoritative
        consumer; stale ids in the set are harmless."""
        service._collab = _StubCollab(is_localhost=True)
        result = service.cancel_streaming("any-id")
        # Not restricted — the method got past the guard.
        assert result.get("error") != "restricted"
        assert result == {"status": "cancelling"}
        assert "any-id" in service._cancelled_requests

    def test_invalidate_url_cache(
        self, service: LLMService
    ) -> None:
        service._collab = _StubCollab(is_localhost=True)
        result = service.invalidate_url_cache(
            "https://example.com"
        )
        # URL service returns an ok shape even for unknown URLs.
        assert result.get("error") != "restricted"

    def test_clear_url_cache(
        self, service: LLMService
    ) -> None:
        service._collab = _StubCollab(is_localhost=True)
        result = service.clear_url_cache()
        assert result.get("error") != "restricted"

    def test_start_review_no_repo_guard_order(
        self,
        config: ConfigManager,
    ) -> None:
        """Localhost caller but no repo — gets the "no repo"
        error (past the localhost check), proving the guard let
        the call through."""
        svc = LLMService(config=config, repo=None)
        svc._collab = _StubCollab(is_localhost=True)
        result = svc.start_review("feature", "abc123")
        # Not restricted — the method got past the guard.
        assert result.get("error") != "restricted"
        assert "repository" in result.get("error", "").lower()

    def test_end_review_not_active_guard_order(
        self, service: LLMService
    ) -> None:
        """Localhost caller, review not active — gets the "not
        active" error, proving the guard let the call through."""
        service._collab = _StubCollab(is_localhost=True)
        result = service.end_review()
        assert result.get("error") != "restricted"
        assert "not active" in result.get("error", "").lower()


# ---------------------------------------------------------------------------
# LLMService — non-localhost caller rejected
# ---------------------------------------------------------------------------


class TestLLMServiceNonLocalhostRejected:
    """Non-localhost caller gets the restricted-error shape.

    Each test asserts:
    1. The method returns the restricted-error dict
    2. No side effect (state unchanged)
    """

    def test_new_session(self, service: LLMService) -> None:
        original_session = service.get_current_state()["session_id"]
        service._collab = _StubCollab(is_localhost=False)
        result = service.new_session()
        _assert_restricted(result)
        # Session ID unchanged.
        assert service.get_current_state()["session_id"] == (
            original_session
        )

    def test_set_selected_files(
        self, service: LLMService, repo_dir: Path
    ) -> None:
        (repo_dir / "a.md").write_text("x")
        original_selection = service.get_selected_files()
        service._collab = _StubCollab(is_localhost=False)
        result = service.set_selected_files(["a.md"])
        _assert_restricted(result)
        # Selection unchanged.
        assert service.get_selected_files() == original_selection

    def test_switch_mode(self, service: LLMService) -> None:
        original_mode = service.get_current_state()["mode"]
        service._collab = _StubCollab(is_localhost=False)
        result = service.switch_mode("doc")
        _assert_restricted(result)
        # Mode unchanged.
        assert service.get_current_state()["mode"] == original_mode

    def test_set_cross_reference(
        self, service: LLMService
    ) -> None:
        service._collab = _StubCollab(is_localhost=False)
        result = service.set_cross_reference(True)
        _assert_restricted(result)
        # Flag unchanged.
        assert service.get_current_state()[
            "cross_ref_enabled"
        ] is False

    def test_cancel_streaming(
        self, service: LLMService
    ) -> None:
        service._collab = _StubCollab(is_localhost=False)
        result = service.cancel_streaming("anything")
        _assert_restricted(result)

    def test_reset_to_head(
        self, service: LLMService, repo_dir: Path
    ) -> None:
        (repo_dir / "seed.md").write_text("dirty")
        service._collab = _StubCollab(is_localhost=False)
        result = service.reset_to_head()
        _assert_restricted(result)
        # File still dirty — reset didn't fire.
        assert (repo_dir / "seed.md").read_text() == "dirty"

    def test_start_review(
        self, service: LLMService
    ) -> None:
        service._collab = _StubCollab(is_localhost=False)
        result = service.start_review("feature", "abc123")
        _assert_restricted(result)
        assert service._review_active is False

    def test_end_review(
        self, service: LLMService
    ) -> None:
        # Force review-active so the guard is what actually
        # blocks (not the "not active" check).
        service._review_active = True
        service._collab = _StubCollab(is_localhost=False)
        result = service.end_review()
        _assert_restricted(result)
        # Review still active — exit didn't run.
        assert service._review_active is True
        # Clean up so fixtures don't bleed state.
        service._review_active = False

    def test_invalidate_url_cache(
        self, service: LLMService
    ) -> None:
        service._collab = _StubCollab(is_localhost=False)
        result = service.invalidate_url_cache(
            "https://example.com"
        )
        _assert_restricted(result)

    def test_remove_fetched_url(
        self, service: LLMService
    ) -> None:
        service._collab = _StubCollab(is_localhost=False)
        result = service.remove_fetched_url(
            "https://example.com"
        )
        _assert_restricted(result)

    def test_clear_url_cache(
        self, service: LLMService
    ) -> None:
        service._collab = _StubCollab(is_localhost=False)
        result = service.clear_url_cache()
        _assert_restricted(result)

    async def test_chat_streaming(
        self, service: LLMService
    ) -> None:
        service._collab = _StubCollab(is_localhost=False)
        result = await service.chat_streaming(
            request_id="r1", message="hi"
        )
        _assert_restricted(result)
        # No stream started.
        assert service._active_user_request is None

    async def test_commit_all(
        self, service: LLMService
    ) -> None:
        service._collab = _StubCollab(is_localhost=False)
        result = await service.commit_all()
        _assert_restricted(result)
        assert service._committing is False

    async def test_fetch_url(
        self, service: LLMService
    ) -> None:
        # Capture the loop the RPC would have otherwise
        # captured — mimics what chat_streaming does.
        service._main_loop = asyncio.get_event_loop()
        service._collab = _StubCollab(is_localhost=False)
        result = await service.fetch_url(
            "https://example.com"
        )
        _assert_restricted(result)

    async def test_detect_and_fetch(
        self, service: LLMService
    ) -> None:
        service._main_loop = asyncio.get_event_loop()
        service._collab = _StubCollab(is_localhost=False)
        result = await service.detect_and_fetch(
            "see https://example.com"
        )
        _assert_restricted(result)


# ---------------------------------------------------------------------------
# LLMService — read operations always allowed
# ---------------------------------------------------------------------------


class TestLLMServiceReadOpsAllowed:
    """Read-only methods work for non-localhost callers."""

    def test_get_current_state(
        self, service: LLMService
    ) -> None:
        service._collab = _StubCollab(is_localhost=False)
        state = service.get_current_state()
        # Returns the state dict — not restricted.
        assert "session_id" in state

    def test_get_selected_files(
        self, service: LLMService
    ) -> None:
        service._collab = _StubCollab(is_localhost=False)
        # Returns empty list, not restricted dict.
        assert service.get_selected_files() == []

    def test_get_mode(self, service: LLMService) -> None:
        service._collab = _StubCollab(is_localhost=False)
        result = service.get_mode()
        assert result.get("mode") == "code"

    def test_get_review_state(
        self, service: LLMService
    ) -> None:
        service._collab = _StubCollab(is_localhost=False)
        state = service.get_review_state()
        assert state.get("active") is False

    def test_detect_urls(self, service: LLMService) -> None:
        service._collab = _StubCollab(is_localhost=False)
        result = service.detect_urls("no urls here")
        assert result == []

    def test_get_snippets(
        self, service: LLMService
    ) -> None:
        service._collab = _StubCollab(is_localhost=False)
        # Returns a list, not a restricted dict.
        snippets = service.get_snippets()
        assert isinstance(snippets, list)


# ---------------------------------------------------------------------------
# LLMService — collab check failure fails closed
# ---------------------------------------------------------------------------


class TestLLMServiceCollabFailClosed:
    """If the collab check raises, deny the call."""

    def test_new_session_fails_closed(
        self, service: LLMService
    ) -> None:
        service._collab = _RaisingCollab()
        result = service.new_session()
        _assert_restricted(result)


# asyncio import for async restriction tests.
import asyncio  # noqa: E402