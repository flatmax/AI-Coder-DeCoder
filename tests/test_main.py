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

    def test_repo_path(self):
        """Custom repo path."""
        args = parse_args(["--repo-path", "/tmp/my-repo"])
        assert args.repo_path == "/tmp/my-repo"