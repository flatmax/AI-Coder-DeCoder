"""Tests for LLM service."""

import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch
from ac_dc.config import ConfigManager
from ac_dc.repo import Repo
from ac_dc.llm_service import LLM, _detect_shell_commands
import subprocess


@pytest.fixture
def git_repo(tmp_path):
    """Create a real git repo for testing."""
    subprocess.run(["git", "init", str(tmp_path)], capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@test.com"],
                   cwd=str(tmp_path), capture_output=True)
    subprocess.run(["git", "config", "user.name", "Test"],
                   cwd=str(tmp_path), capture_output=True)
    (tmp_path / "README.md").write_text("# Test\n")
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "main.py").write_text("def main():\n    pass\n")
    subprocess.run(["git", "add", "-A"], cwd=str(tmp_path), capture_output=True)
    subprocess.run(["git", "commit", "-m", "init"], cwd=str(tmp_path), capture_output=True)
    return tmp_path


@pytest.fixture
def llm_service(git_repo):
    """Create LLM service with test config."""
    config = ConfigManager(git_repo, dev_mode=True)
    repo = Repo(git_repo)
    return LLM(config, repo)


class TestStateManagement:

    def test_get_current_state(self, llm_service):
        state = llm_service.get_current_state()
        assert "messages" in state
        assert "selected_files" in state
        assert "streaming_active" in state
        assert "session_id" in state

    def test_set_selected_files(self, llm_service):
        result = llm_service.set_selected_files(["README.md", "src/main.py"])
        assert result["ok"]
        assert llm_service.get_selected_files() == ["README.md", "src/main.py"]

    def test_get_selected_files(self, llm_service):
        llm_service.set_selected_files(["a.py"])
        files = llm_service.get_selected_files()
        assert files == ["a.py"]
        # Verify it returns a copy
        files.append("b.py")
        assert llm_service.get_selected_files() == ["a.py"]


class TestStreaming:

    def test_reject_concurrent_stream(self, llm_service):
        llm_service._streaming_active = True
        llm_service._active_request_id = "req1"
        result = llm_service.chat_streaming("req2", "hello")
        assert "error" in result

    def test_cancel_streaming(self, llm_service):
        llm_service._streaming_active = True
        llm_service._active_request_id = "req1"
        result = llm_service.cancel_streaming("req1")
        assert result.get("ok")

    def test_cancel_wrong_id(self, llm_service):
        llm_service._streaming_active = True
        llm_service._active_request_id = "req1"
        result = llm_service.cancel_streaming("wrong_id")
        assert "error" in result


class TestHistory:

    def test_new_session(self, llm_service):
        result = llm_service.history_new_session()
        assert "session_id" in result
        # History should be cleared
        state = llm_service.get_current_state()
        assert state["messages"] == []

    def test_session_id_changes(self, llm_service):
        old_id = llm_service.get_current_state()["session_id"]
        llm_service.history_new_session()
        new_id = llm_service.get_current_state()["session_id"]
        assert old_id != new_id


class TestContextBreakdown:

    def test_basic_breakdown(self, llm_service):
        breakdown = llm_service.get_context_breakdown()
        assert "breakdown" in breakdown
        assert "total_tokens" in breakdown
        assert "max_input_tokens" in breakdown
        assert "model" in breakdown
        assert "session_totals" in breakdown

    def test_breakdown_has_categories(self, llm_service):
        bd = llm_service.get_context_breakdown()["breakdown"]
        assert "system" in bd
        assert "symbol_map" in bd
        assert "files" in bd
        assert "history" in bd

    def test_session_totals_initial(self, llm_service):
        totals = llm_service.get_context_breakdown()["session_totals"]
        assert totals["prompt"] == 0
        assert totals["completion"] == 0
        assert totals["total"] == 0


class TestShellCommandDetection:

    def test_bash_block(self):
        text = "Run this:\n```bash\npip install foo\npython setup.py\n```"
        cmds = _detect_shell_commands(text)
        assert "pip install foo" in cmds
        assert "python setup.py" in cmds

    def test_dollar_prefix(self):
        text = "Run:\n$ git status\n$ git add ."
        cmds = _detect_shell_commands(text)
        assert "git status" in cmds
        assert "git add ." in cmds

    def test_chevron_prefix(self):
        text = "> npm install\n> npm run build"
        cmds = _detect_shell_commands(text)
        assert "npm install" in cmds

    def test_comments_skipped(self):
        text = "```bash\n# This is a comment\nactual_command\n```"
        cmds = _detect_shell_commands(text)
        assert "actual_command" in cmds
        assert not any("comment" in c for c in cmds)

    def test_no_commands(self):
        text = "Just some regular text without any commands."
        cmds = _detect_shell_commands(text)
        assert cmds == []

    def test_sh_block(self):
        text = "```sh\necho hello\n```"
        cmds = _detect_shell_commands(text)
        assert "echo hello" in cmds


class TestCommitMessage:

    @patch("ac_dc.llm_service.litellm", create=True)
    def test_generate_commit_message(self, mock_litellm, llm_service):
        """Test commit message generation with mocked LLM."""
        # We need to mock the import inside the method
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "fix: correct typo in README"
        mock_response.usage.prompt_tokens = 100
        mock_response.usage.completion_tokens = 10
        mock_response.usage.total_tokens = 110

        with patch.dict("sys.modules", {"litellm": mock_litellm}):
            mock_litellm.completion.return_value = mock_response
            result = llm_service.generate_commit_message("diff --git a/README.md...")

        assert "message" in result
        assert "fix:" in result["message"]

    def test_empty_diff_rejected(self, llm_service):
        result = llm_service.generate_commit_message("")
        assert "error" in result

    def test_whitespace_diff_rejected(self, llm_service):
        result = llm_service.generate_commit_message("   \n  ")
        assert "error" in result
