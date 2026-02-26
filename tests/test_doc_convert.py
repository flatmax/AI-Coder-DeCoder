"""Tests for doc_convert module."""

import hashlib
import os
import subprocess
import textwrap
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from ac_dc.doc_convert import (
    DocConvert,
    _build_provenance_header,
    _build_svg_provenance_header,
    _is_markitdown_available,
    _output_path_for,
    _parse_provenance,
    _sha256_file,
    _should_skip_dir,
)


# === Provenance Header Tests ===


class TestProvenanceHeader:
    def test_build_header_basic(self):
        h = _build_provenance_header("arch.docx", "abc123")
        assert "docuvert:" in h
        assert "source=arch.docx" in h
        assert "sha256=abc123" in h
        assert "images=" not in h

    def test_build_header_with_images(self):
        h = _build_provenance_header("arch.docx", "abc123", ["img1.png", "img2.svg"])
        assert "images=img1.png,img2.svg" in h

    def test_build_svg_header(self):
        h = _build_svg_provenance_header("arch.md", "arch.docx", "abc123", 2)
        assert "parent=arch.md" in h
        assert "source=arch.docx" in h
        assert "sha256=abc123" in h
        assert "img_index=2" in h

    def test_parse_provenance_found(self):
        text = "<!-- docuvert: source=test.docx sha256=abc123 -->\n\n# Title"
        result = _parse_provenance(text)
        assert result is not None
        assert result["source"] == "test.docx"
        assert result["sha256"] == "abc123"

    def test_parse_provenance_with_images(self):
        text = "<!-- docuvert: source=test.docx sha256=abc images=a.png,b.svg -->\n"
        result = _parse_provenance(text)
        assert result["images"] == "a.png,b.svg"

    def test_parse_provenance_not_found(self):
        text = "# Just a heading\n\nSome content"
        result = _parse_provenance(text)
        assert result is None

    def test_parse_provenance_unknown_fields_ignored(self):
        text = "<!-- docuvert: source=test.docx sha256=abc future_field=xyz -->\n"
        result = _parse_provenance(text)
        assert result["source"] == "test.docx"
        assert result["future_field"] == "xyz"

    def test_parse_provenance_beyond_line_5_not_found(self):
        text = "\n\n\n\n\n\n<!-- docuvert: source=test.docx sha256=abc -->"
        result = _parse_provenance(text)
        assert result is None


# === Utility Tests ===


class TestUtilities:
    def test_output_path_for_docx(self):
        assert _output_path_for("docs/arch.docx") == "docs/arch.md"

    def test_output_path_for_csv(self):
        assert _output_path_for("data/users.csv") == "data/users.md"

    def test_sha256_file(self, tmp_path):
        f = tmp_path / "test.txt"
        f.write_text("hello world")
        h = _sha256_file(f)
        expected = hashlib.sha256(b"hello world").hexdigest()
        assert h == expected

    def test_should_skip_dir(self):
        assert _should_skip_dir(".git")
        assert _should_skip_dir("node_modules")
        assert _should_skip_dir("__pycache__")
        assert _should_skip_dir(".venv")
        assert _should_skip_dir(".hidden")
        assert not _should_skip_dir(".github")
        assert not _should_skip_dir("src")
        assert not _should_skip_dir("docs")


# === Status Detection Tests ===


@pytest.fixture
def git_repo(tmp_path):
    """Create a minimal git repo."""
    subprocess.run(["git", "init", str(tmp_path)], capture_output=True, check=True)
    subprocess.run(
        ["git", "-C", str(tmp_path), "config", "user.email", "test@test.com"],
        capture_output=True,
    )
    subprocess.run(
        ["git", "-C", str(tmp_path), "config", "user.name", "Test"],
        capture_output=True,
    )
    # Create initial commit so is_clean works
    (tmp_path / ".gitignore").write_text(".ac-dc/\n")
    subprocess.run(["git", "-C", str(tmp_path), "add", "."], capture_output=True)
    subprocess.run(
        ["git", "-C", str(tmp_path), "commit", "-m", "init"],
        capture_output=True,
    )
    return tmp_path


@pytest.fixture
def repo(git_repo):
    from ac_dc.repo import Repo
    return Repo(str(git_repo))


@pytest.fixture
def config(git_repo):
    from ac_dc.config import ConfigManager
    return ConfigManager(repo_root=str(git_repo))


@pytest.fixture
def converter(repo, config):
    return DocConvert(repo, config)


class TestStatusDetection:
    def test_new_when_no_output(self, converter, git_repo):
        (git_repo / "doc.docx").write_bytes(b"fake docx content")
        result = converter.scan_convertible_files()
        files = result["files"]
        assert len(files) == 1
        assert files[0]["status"] == "new"

    def test_current_when_hash_matches(self, converter, git_repo):
        source = git_repo / "doc.docx"
        source.write_bytes(b"fake docx content")
        sha = _sha256_file(source)
        output = git_repo / "doc.md"
        header = _build_provenance_header("doc.docx", sha)
        output.write_text(f"{header}\n\n# Converted")
        result = converter.scan_convertible_files()
        files = result["files"]
        assert files[0]["status"] == "current"

    def test_stale_when_hash_differs(self, converter, git_repo):
        source = git_repo / "doc.docx"
        source.write_bytes(b"fake docx content")
        output = git_repo / "doc.md"
        header = _build_provenance_header("doc.docx", "old_hash_abc")
        output.write_text(f"{header}\n\n# Old conversion")
        result = converter.scan_convertible_files()
        files = result["files"]
        assert files[0]["status"] == "stale"

    def test_conflict_when_no_provenance(self, converter, git_repo):
        (git_repo / "doc.docx").write_bytes(b"fake docx")
        (git_repo / "doc.md").write_text("# Manually written\n\nHand-crafted content")
        result = converter.scan_convertible_files()
        files = result["files"]
        assert files[0]["status"] == "conflict"


class TestScanFeatures:
    def test_skips_excluded_dirs(self, converter, git_repo):
        nm = git_repo / "node_modules"
        nm.mkdir()
        (nm / "pkg.docx").write_bytes(b"skip me")
        (git_repo / "real.docx").write_bytes(b"include me")
        result = converter.scan_convertible_files()
        paths = [f["path"] for f in result["files"]]
        assert "real.docx" in paths
        assert "node_modules/pkg.docx" not in paths

    def test_over_size_flagged(self, git_repo):
        from ac_dc.config import ConfigManager
        config = ConfigManager(repo_root=str(git_repo))
        # Override max size to 1 byte
        config._app_config["doc_convert"] = {
            "enabled": True,
            "extensions": [".docx"],
            "max_source_size_mb": 0,  # 0 MB = 0 bytes
        }
        converter = DocConvert(
            __import__("ac_dc.repo", fromlist=["Repo"]).Repo(str(git_repo)),
            config,
        )
        (git_repo / "big.docx").write_bytes(b"some content")
        result = converter.scan_convertible_files()
        assert result["files"][0]["over_size"] is True

    def test_disabled_returns_empty(self, git_repo):
        from ac_dc.config import ConfigManager
        config = ConfigManager(repo_root=str(git_repo))
        config._app_config["doc_convert"] = {"enabled": False}
        converter = DocConvert(
            __import__("ac_dc.repo", fromlist=["Repo"]).Repo(str(git_repo)),
            config,
        )
        (git_repo / "doc.docx").write_bytes(b"content")
        result = converter.scan_convertible_files()
        assert result["files"] == []

    def test_custom_extensions_respected(self, git_repo):
        from ac_dc.config import ConfigManager
        config = ConfigManager(repo_root=str(git_repo))
        config._app_config["doc_convert"] = {
            "enabled": True,
            "extensions": [".csv"],
            "max_source_size_mb": 50,
        }
        converter = DocConvert(
            __import__("ac_dc.repo", fromlist=["Repo"]).Repo(str(git_repo)),
            config,
        )
        (git_repo / "data.csv").write_text("a,b,c\n1,2,3")
        (git_repo / "doc.docx").write_bytes(b"skip me")
        result = converter.scan_convertible_files()
        paths = [f["path"] for f in result["files"]]
        assert "data.csv" in paths
        assert "doc.docx" not in paths


class TestConvertFiles:
    @patch("ac_dc.doc_convert._is_markitdown_available", return_value=True)
    def test_nonexistent_file_fails(self, mock_avail, converter, git_repo):
        result = converter.convert_files(["missing.docx"])
        assert result["results"][0]["status"] == "failed"
        assert "not found" in result["results"][0]["error"].lower()

    @patch("ac_dc.doc_convert._is_markitdown_available", return_value=True)
    def test_path_traversal_blocked(self, mock_avail, converter, git_repo):
        result = converter.convert_files(["../etc/passwd.docx"])
        assert result["results"][0]["status"] == "failed"

    @patch("ac_dc.doc_convert._is_markitdown_available", return_value=False)
    def test_unavailable_returns_error(self, mock_avail, converter, git_repo):
        result = converter.convert_files(["doc.docx"])
        assert "error" in result
        assert "markitdown" in result["error"].lower()

    @patch("ac_dc.doc_convert._is_markitdown_available", return_value=True)
    def test_successful_conversion(self, mock_avail, converter, git_repo):
        source = git_repo / "doc.docx"
        source.write_bytes(b"fake docx content")

        mock_result = MagicMock()
        mock_result.text_content = "# Converted Title\n\nSome content."

        with patch("ac_dc.doc_convert.DocConvert._convert_with_markitdown",
                    return_value="# Converted Title\n\nSome content."):
            result = converter.convert_files(["doc.docx"])

        assert result["summary"]["converted"] == 1
        assert result["summary"]["failed"] == 0

        # Check output file
        output = git_repo / "doc.md"
        assert output.exists()
        text = output.read_text()
        assert "docuvert:" in text
        assert "source=doc.docx" in text
        assert "# Converted Title" in text

    @patch("ac_dc.doc_convert._is_markitdown_available", return_value=True)
    def test_orphan_images_cleaned(self, mock_avail, converter, git_repo):
        source = git_repo / "doc.docx"
        source.write_bytes(b"fake content")
        sha = _sha256_file(source)

        # Pre-existing output with an image reference
        output = git_repo / "doc.md"
        header = _build_provenance_header("doc.docx", "old_hash", ["old_img.png"])
        output.write_text(f"{header}\n\n# Old")
        old_img = git_repo / "old_img.png"
        old_img.write_bytes(b"old image")

        with patch("ac_dc.doc_convert.DocConvert._convert_with_markitdown",
                    return_value="# New content"):
            result = converter.convert_files(["doc.docx"])

        assert result["summary"]["converted"] == 1
        # Orphan image should be deleted
        assert not old_img.exists()


class TestGracefulDegradation:
    @patch("ac_dc.doc_convert._is_markitdown_available", return_value=False)
    def test_is_available_false(self, mock_avail):
        converter = DocConvert(MagicMock(), MagicMock())
        result = converter.is_available()
        assert result["available"] is False

    @patch("ac_dc.doc_convert._is_markitdown_available", return_value=True)
    def test_is_available_true(self, mock_avail):
        converter = DocConvert(MagicMock(), MagicMock())
        result = converter.is_available()
        assert result["available"] is True