"""Tests for main.py — startup, CLI, port scanning, version detection."""

import os
import socket
import subprocess
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from ac_dc.main import (
    _extract_sha,
    _get_version,
    _is_git_repo,
    _build_browser_url,
    _handle_not_a_repo,
    find_available_port,
    parse_args,
)


# === Version Detection ===


class TestVersionDetection:
    def test_extract_sha_baked(self):
        """Baked version format extracts SHA."""
        assert _extract_sha("2025.01.15-14.32-a1b2c3d4") == "a1b2c3d4"

    def test_extract_sha_git(self):
        """Git SHA format extracts first 8 chars."""
        assert _extract_sha("a1b2c3d4e5f6") == "a1b2c3d4"

    def test_extract_sha_dev(self):
        """'dev' returns None."""
        assert _extract_sha("dev") is None

    def test_get_version_returns_string(self):
        """_get_version returns a non-empty string."""
        version = _get_version()
        assert isinstance(version, str)
        assert len(version) > 0


# === Git Repo Check ===


class TestGitRepoCheck:
    def test_valid_repo(self, tmp_path):
        """Valid git repo detected."""
        repo = tmp_path / "repo"
        repo.mkdir()
        subprocess.run(["git", "init", str(repo)], capture_output=True)
        assert _is_git_repo(str(repo)) is True

    def test_not_a_repo(self, tmp_path):
        """Non-repo directory detected."""
        not_repo = tmp_path / "not_repo"
        not_repo.mkdir()
        assert _is_git_repo(str(not_repo)) is False

    def test_nonexistent_path(self, tmp_path):
        """Nonexistent path returns False."""
        assert _is_git_repo(str(tmp_path / "does_not_exist")) is False


# === Port Finding ===


class TestPortFinding:
    def test_find_available_port(self):
        """Finds an available port."""
        port = find_available_port(19000)
        assert isinstance(port, int)
        assert port >= 19000

    def test_port_in_range(self):
        """Port is within expected range."""
        port = find_available_port(19000, max_tries=50)
        assert 19000 <= port < 19050

    def test_occupied_port_skipped(self):
        """Occupied port is skipped."""
        # Bind a port
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(("127.0.0.1", 19100))
        try:
            port = find_available_port(19100, max_tries=50)
            assert port != 19100
            assert port > 19100
        finally:
            sock.close()

    def test_no_available_port_raises(self):
        """No available port raises RuntimeError."""
        # Bind all ports in a tiny range
        socks = []
        try:
            for i in range(3):
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.bind(("127.0.0.1", 19200 + i))
                socks.append(s)
            with pytest.raises(RuntimeError):
                find_available_port(19200, max_tries=3)
        finally:
            for s in socks:
                s.close()


# === Browser URL Building ===


class TestBrowserUrl:
    def test_dev_mode(self):
        """Dev mode uses localhost."""
        url = _build_browser_url(18080, "abc123", dev_mode=True, webapp_port=18999)
        assert "localhost:18999" in url
        assert "port=18080" in url

    def test_hosted_mode_with_sha(self):
        """Hosted mode includes SHA in path."""
        url = _build_browser_url(18080, "2025.01.15-14.32-abc12345")
        assert "abc12345" in url
        assert "port=18080" in url

    def test_hosted_mode_dev_fallback(self):
        """Dev version uses root redirect."""
        url = _build_browser_url(18080, "dev")
        assert "port=18080" in url
        # Should not have a SHA path segment
        assert "/dev/" not in url

    def test_base_url_override(self):
        """Base URL override respected."""
        url = _build_browser_url(
            18080, "abc12345",
            base_url_override="https://custom.example.com/app",
        )
        assert "custom.example.com/app" in url


# === Not-a-Repo Handler ===


class TestNotARepo:
    def test_handle_not_a_repo_exits(self, tmp_path):
        """_handle_not_a_repo calls sys.exit(1)."""
        with pytest.raises(SystemExit) as exc_info:
            _handle_not_a_repo(str(tmp_path))
        assert exc_info.value.code == 1


# === CLI Argument Parsing ===


class TestCLI:
    def test_defaults(self):
        """Default arguments."""
        args = parse_args([])
        assert args.server_port == 18080
        assert args.webapp_port == 18999
        assert args.no_browser is False
        assert args.repo_path == "."
        assert args.dev is False
        assert args.preview is False
        assert args.verbose is False

    def test_custom_ports(self):
        """Custom port arguments."""
        args = parse_args(["--server-port", "9000", "--webapp-port", "9001"])
        assert args.server_port == 9000
        assert args.webapp_port == 9001

    def test_flags(self):
        """Boolean flags."""
        args = parse_args(["--no-browser", "--dev", "--verbose"])
        assert args.no_browser is True
        assert args.dev is True
        assert args.verbose is True

    def test_collab_flag(self):
        """Collab flag defaults to False."""
        args = parse_args([])
        assert args.collab is False

    def test_collab_flag_enabled(self):
        """Collab flag can be enabled."""
        args = parse_args(["--collab"])
        assert args.collab is True

    def test_repo_path(self):
        """Custom repo path."""
        args = parse_args(["--repo-path", "/tmp/my-repo"])
        assert args.repo_path == "/tmp/my-repo"


# === Repo Localhost Guards ===


class TestRepoLocalhostGuards:
    """Verify that mutating Repo methods are blocked for non-localhost callers."""

    def _make_repo_with_collab(self, tmp_path, is_localhost):
        """Create a Repo with a mock collab that returns the given localhost status."""
        from unittest.mock import MagicMock
        from ac_dc.repo import Repo

        repo_dir = tmp_path / "repo"
        repo_dir.mkdir()
        subprocess.run(["git", "init", str(repo_dir)], capture_output=True)
        # Create an initial commit so HEAD exists
        (repo_dir / "file.txt").write_text("hello")
        subprocess.run(["git", "-C", str(repo_dir), "add", "."], capture_output=True)
        subprocess.run(["git", "-C", str(repo_dir), "commit", "-m", "init"], capture_output=True)

        repo = Repo(str(repo_dir))
        collab = MagicMock()
        collab._is_caller_localhost.return_value = is_localhost
        repo._collab = collab
        return repo

    def test_write_file_blocked_for_remote(self, tmp_path):
        repo = self._make_repo_with_collab(tmp_path, is_localhost=False)
        result = repo.write_file("test.txt", "content")
        assert result.get("error") == "restricted"

    def test_write_file_allowed_for_localhost(self, tmp_path):
        repo = self._make_repo_with_collab(tmp_path, is_localhost=True)
        result = repo.write_file("test.txt", "content")
        assert result.get("success") is True

    def test_commit_blocked_for_remote(self, tmp_path):
        repo = self._make_repo_with_collab(tmp_path, is_localhost=False)
        result = repo.commit("test commit")
        assert result.get("error") == "restricted"

    def test_reset_hard_blocked_for_remote(self, tmp_path):
        repo = self._make_repo_with_collab(tmp_path, is_localhost=False)
        result = repo.reset_hard()
        assert result.get("error") == "restricted"

    def test_stage_all_blocked_for_remote(self, tmp_path):
        repo = self._make_repo_with_collab(tmp_path, is_localhost=False)
        result = repo.stage_all()
        assert result.get("error") == "restricted"

    def test_delete_file_blocked_for_remote(self, tmp_path):
        repo = self._make_repo_with_collab(tmp_path, is_localhost=False)
        result = repo.delete_file("test.txt")
        assert result.get("error") == "restricted"

    def test_no_collab_allows_all(self, tmp_path):
        """Without collab (single-user mode), all operations are allowed."""
        from ac_dc.repo import Repo
        repo_dir = tmp_path / "repo"
        repo_dir.mkdir()
        subprocess.run(["git", "init", str(repo_dir)], capture_output=True)
        repo = Repo(str(repo_dir))
        # _collab is None by default — should not block
        result = repo.write_file("test.txt", "content")
        assert result.get("success") is True


# === Settings Localhost Guards ===


class TestSettingsLocalhostGuards:
    """Verify that mutating Settings methods are blocked for non-localhost callers."""

    def test_save_config_blocked_for_remote(self):
        from unittest.mock import MagicMock
        from ac_dc.settings import Settings

        config = MagicMock()
        settings = Settings(config)
        collab = MagicMock()
        collab._is_caller_localhost.return_value = False
        settings._collab = collab

        result = settings.save_config_content("system", "new content")
        assert result.get("error") == "restricted"
        config.save_config_content.assert_not_called()

    def test_reload_blocked_for_remote(self):
        from unittest.mock import MagicMock
        from ac_dc.settings import Settings

        config = MagicMock()
        settings = Settings(config)
        collab = MagicMock()
        collab._is_caller_localhost.return_value = False
        settings._collab = collab

        result = settings.reload_llm_config()
        assert result.get("error") == "restricted"
        config.reload_llm_config.assert_not_called()

    def test_save_allowed_for_localhost(self):
        from unittest.mock import MagicMock
        from ac_dc.settings import Settings

        config = MagicMock()
        config.save_config_content.return_value = None
        settings = Settings(config)
        collab = MagicMock()
        collab._is_caller_localhost.return_value = True
        settings._collab = collab

        result = settings.save_config_content("system", "new content")
        assert result.get("success") is True
        config.save_config_content.assert_called_once()