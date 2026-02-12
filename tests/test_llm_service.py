"""Tests for the LLM service."""

import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from ac_dc.config import ConfigManager
from ac_dc.llm_service import LLMService, _extract_token_usage
from ac_dc.repo import Repo
from ac_dc.stability_tracker import Tier


@pytest.fixture
def config():
    """ConfigManager without repo root."""
    return ConfigManager()


@pytest.fixture
def temp_repo(tmp_path):
    """Create a temporary git repo."""
    repo_dir = tmp_path / "test_repo"
    repo_dir.mkdir()
    subprocess.run(["git", "init", str(repo_dir)], capture_output=True)
    subprocess.run(["git", "-C", str(repo_dir), "config", "user.email", "test@test.com"],
                   capture_output=True)
    subprocess.run(["git", "-C", str(repo_dir), "config", "user.name", "Test"],
                   capture_output=True)
    (repo_dir / "README.md").write_text("# Test\n")
    (repo_dir / "src").mkdir()
    (repo_dir / "src" / "main.py").write_text("def main():\n    print('hello')\n")
    subprocess.run(["git", "-C", str(repo_dir), "add", "-A"], capture_output=True)
    subprocess.run(["git", "-C", str(repo_dir), "commit", "-m", "initial"],
                   capture_output=True)
    return repo_dir


@pytest.fixture
def repo(temp_repo):
    return Repo(temp_repo)


@pytest.fixture
def service(config, repo):
    return LLMService(config, repo=repo)


# === State Management ===


class TestStateManagement:
    def test_get_current_state(self, service):
        """get_current_state returns messages, selected_files, streaming_active, session_id."""
        state = service.get_current_state()
        assert "messages" in state
        assert "selected_files" in state
        assert "streaming_active" in state
        assert "session_id" in state
        assert state["streaming_active"] is False

    def test_set_selected_files(self, service):
        """set_selected_files updates and returns copy."""
        result = service.set_selected_files(["a.py", "b.py"])
        assert result == ["a.py", "b.py"]
        # Mutation-safe
        result.append("c.py")
        assert service.get_selected_files() == ["a.py", "b.py"]

    def test_get_selected_files_independent_copy(self, service):
        """get_selected_files returns independent copy."""
        service.set_selected_files(["a.py"])
        copy1 = service.get_selected_files()
        copy2 = service.get_selected_files()
        copy1.append("b.py")
        assert copy2 == ["a.py"]


# === Streaming Guards ===


class TestStreamingGuards:
    @pytest.mark.asyncio
    async def test_concurrent_stream_rejected(self, service):
        """Concurrent stream rejected with error."""
        service._streaming_active = True
        result = await service.chat_streaming("req-1", "hello")
        assert "error" in result
        service._streaming_active = False

    def test_cancel_matching_request(self, service):
        """cancel_streaming succeeds for matching request_id."""
        service._streaming_active = True
        service._current_request_id = "req-123"
        result = service.cancel_streaming("req-123")
        assert result.get("success") is True
        service._streaming_active = False

    def test_cancel_wrong_id(self, service):
        """cancel_streaming with wrong id returns error."""
        service._current_request_id = "req-123"
        result = service.cancel_streaming("wrong-id")
        assert "error" in result


# === History ===


class TestHistory:
    def test_new_session_changes_id_and_clears(self, service):
        """New session changes session_id and clears history."""
        old_id = service.get_current_state()["session_id"]
        service._context.add_message("user", "hello")
        result = service.new_session()
        assert result["session_id"] != old_id
        assert len(service.get_current_state()["messages"]) == 0


# === Stability Tracker Integration ===


class TestStabilityIntegration:
    def test_tracker_created_on_init(self, service):
        """Stability tracker is created and attached to context manager."""
        assert service._stability_tracker is not None
        assert service._context._stability_tracker is service._stability_tracker

    def test_tracker_not_initialized_before_first_request(self, service):
        """Tracker is not initialized until first streaming request."""
        assert service._stability_initialized is False
        assert len(service._stability_tracker.items) == 0

    def test_update_stability_with_files(self, service):
        """_update_stability processes selected files and history."""
        # Add a file to context
        service.set_selected_files(["README.md"])
        service._context.file_context.add_file("README.md", "# Test\n")
        service._context.add_message("user", "hello")
        service._context.add_message("assistant", "hi")

        service._update_stability()

        # Should have file and history entries
        items = service._stability_tracker.items
        assert "file:README.md" in items
        assert "history:0" in items
        assert "history:1" in items

    def test_update_stability_n_increments(self, service):
        """Repeated stability updates increment N for unchanged items."""
        service.set_selected_files(["README.md"])
        service._context.file_context.add_file("README.md", "# Test\n")

        service._update_stability()
        assert service._stability_tracker.get_item("file:README.md").n == 0

        service._update_stability()
        assert service._stability_tracker.get_item("file:README.md").n == 1

        service._update_stability()
        assert service._stability_tracker.get_item("file:README.md").n == 2

    def test_update_stability_graduation(self, service):
        """Items graduate to L3 after N >= 3."""
        service.set_selected_files(["README.md"])
        service._context.file_context.add_file("README.md", "# Test\n")

        # Run 5 updates: N goes 0, 1, 2, 3 (graduates), then entry_n for L3
        for _ in range(5):
            service._update_stability()

        item = service._stability_tracker.get_item("file:README.md")
        assert item.tier == Tier.L3

    def test_update_stability_stale_removal(self, service, temp_repo):
        """Stale files are removed from tracker."""
        from ac_dc.stability_tracker import TrackedItem
        # Manually add a tracked item for a non-existent file
        service._stability_tracker._items["file:gone.py"] = TrackedItem(
            key="file:gone.py", tier=Tier.L3, n=5,
            content_hash="x", tokens=100,
        )
        service._update_stability()
        assert service._stability_tracker.get_item("file:gone.py") is None

    def test_new_session_preserves_symbol_tiers(self, service):
        """New session purges history but preserves symbol tier assignments."""
        from ac_dc.stability_tracker import TrackedItem
        service._stability_tracker._items["symbol:src/main.py"] = TrackedItem(
            key="symbol:src/main.py", tier=Tier.L2, n=7,
            content_hash="s", tokens=100,
        )
        service._stability_tracker._items["history:0"] = TrackedItem(
            key="history:0", tier=Tier.L3, n=3,
            content_hash="h", tokens=50,
        )

        service.new_session()

        # Symbol entry preserved, history purged
        assert service._stability_tracker.get_item("symbol:src/main.py") is not None
        assert service._stability_tracker.get_item("history:0") is None


# === Context Breakdown ===


class TestContextBreakdown:
    def test_breakdown_has_required_keys(self, service):
        """Returns breakdown with system/symbol_map/files/history categories."""
        breakdown = service.get_context_breakdown()
        assert "system" in breakdown
        assert "symbol_map" in breakdown
        assert "files" in breakdown
        assert "history" in breakdown

    def test_breakdown_has_totals(self, service):
        """Returns total_tokens, max_input_tokens, model, session_totals."""
        breakdown = service.get_context_breakdown()
        assert "total_tokens" in breakdown
        assert "max_input_tokens" in breakdown
        assert "model" in breakdown
        assert "session_totals" in breakdown

    def test_session_totals_initially_zero(self, service):
        """Session totals initially zero."""
        breakdown = service.get_context_breakdown()
        totals = breakdown["session_totals"]
        assert totals["input_tokens"] == 0
        assert totals["output_tokens"] == 0

    def test_breakdown_shows_tier_data(self, service):
        """Breakdown includes tier blocks when tracker has items."""
        from ac_dc.stability_tracker import TrackedItem
        service._stability_tracker._items["symbol:src/main.py"] = TrackedItem(
            key="symbol:src/main.py", tier=Tier.L2, n=7,
            content_hash="s", tokens=500,
        )
        breakdown = service.get_context_breakdown()
        blocks = breakdown.get("blocks", [])
        tier_names = [b["tier"] for b in blocks]
        assert "L2" in tier_names


# === Shell Command Detection ===
# (Uses detect_shell_commands from edit_parser, tested there too)


class TestShellCommands:
    def test_bash_block(self):
        """Extracts from ```bash blocks."""
        from ac_dc.edit_parser import detect_shell_commands
        text = "```bash\npip install foo\n```"
        cmds = detect_shell_commands(text)
        assert "pip install foo" in cmds

    def test_dollar_prefix(self):
        """$ prefix extracted."""
        from ac_dc.edit_parser import detect_shell_commands
        text = "$ npm install"
        cmds = detect_shell_commands(text)
        assert "npm install" in cmds

    def test_comments_skipped(self):
        """Comments skipped."""
        from ac_dc.edit_parser import detect_shell_commands
        text = "```bash\n# comment\necho hello\n```"
        cmds = detect_shell_commands(text)
        assert len(cmds) == 1

    def test_non_command_empty(self):
        """Non-command text returns empty."""
        from ac_dc.edit_parser import detect_shell_commands
        text = "Just some text about coding."
        cmds = detect_shell_commands(text)
        assert len(cmds) == 0


# === Commit Message ===


class TestCommitMessage:
    def test_empty_diff_rejected(self, service):
        """Empty/whitespace diff rejected."""
        result = service.generate_commit_message("")
        assert "error" in result
        result = service.generate_commit_message("   ")
        assert "error" in result

    @patch("ac_dc.llm_service.litellm")
    def test_mocked_llm_returns_message(self, mock_litellm, service):
        """Mocked LLM returns generated message."""
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "feat: add user authentication"
        mock_litellm.completion.return_value = mock_response

        result = service.generate_commit_message("diff --git a/auth.py b/auth.py\n+def login():")
        assert "message" in result
        assert "feat:" in result["message"]


# === Token Usage Extraction ===


class TestTokenUsageExtraction:
    def test_anthropic_format(self):
        """Anthropic-style usage extracted."""
        chunk = MagicMock()
        chunk.usage = MagicMock()
        chunk.usage.prompt_tokens = 100
        chunk.usage.completion_tokens = 50
        chunk.usage.cache_read_input_tokens = 80
        chunk.usage.cache_creation_input_tokens = 20

        # Make _get find attributes
        chunk.usage.input_tokens = None
        chunk.usage.output_tokens = None
        chunk.usage.cache_read_tokens = None
        chunk.usage.cache_creation_tokens = None

        usage = _extract_token_usage(chunk)
        assert usage["input_tokens"] == 100
        assert usage["output_tokens"] == 50
        assert usage["cache_read_tokens"] == 80
        assert usage["cache_write_tokens"] == 20

    def test_no_usage_returns_empty(self):
        """No usage data returns empty dict."""
        chunk = MagicMock()
        chunk.usage = None
        usage = _extract_token_usage(chunk)
        assert usage == {}

    def test_dict_format(self):
        """Dict-based usage object handled."""
        chunk = {"usage": {
            "prompt_tokens": 200,
            "completion_tokens": 100,
        }}
        usage = _extract_token_usage(chunk)
        assert usage["input_tokens"] == 200
        assert usage["output_tokens"] == 100


# === URL Handling ===


class TestURLHandling:
    def test_detect_urls(self, service):
        """detect_urls returns classified results."""
        results = service.detect_urls("Check https://github.com/owner/repo")
        assert len(results) == 1
        assert results[0]["url_type"] == "github_repo"

    def test_get_url_content_unfetched(self, service):
        """get_url_content returns error for unfetched URL."""
        result = service.get_url_content("https://unfetched.com")
        assert result.get("error") is not None

    def test_invalidate_url_cache(self, service):
        """invalidate_url_cache returns success."""
        result = service.invalidate_url_cache("https://example.com")
        assert result.get("success") is True

    def test_clear_url_cache(self, service):
        """clear_url_cache returns success."""
        result = service.clear_url_cache()
        assert result.get("success") is True


# === History Search ===


class TestHistorySearch:
    def test_search_finds_matching(self, service):
        """Search finds matching messages."""
        service._context.add_message("user", "How do I use Python decorators?")
        service._context.add_message("assistant", "Decorators are functions that modify other functions.")
        results = service.history_search("decorator")
        assert len(results) == 2

    def test_search_role_filter(self, service):
        """Search respects role filter."""
        service._context.add_message("user", "Python question")
        service._context.add_message("assistant", "Python answer")
        results = service.history_search("python", role="user")
        assert len(results) == 1
        assert results[0]["role"] == "user"

    def test_empty_query_returns_empty(self, service):
        """Empty query returns empty."""
        service._context.add_message("user", "hello")
        results = service.history_search("")
        assert len(results) == 0