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
    _extract_docx_images,
    _externalize_svg_images,
    _is_markitdown_available,
    _output_path_for,
    _parse_provenance,
    _replace_truncated_uris,
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

        # Pre-existing output with an image reference in subdirectory
        output = git_repo / "doc.md"
        header = _build_provenance_header("doc.docx", "old_hash", ["doc/old_img.png"])
        output.write_text(f"{header}\n\n# Old")
        assets_dir = git_repo / "doc"
        assets_dir.mkdir(exist_ok=True)
        old_img = assets_dir / "old_img.png"
        old_img.write_bytes(b"old image")

        with patch("ac_dc.doc_convert.DocConvert._convert_with_markitdown",
                    return_value="# New content"):
            result = converter.convert_files(["doc.docx"])

        assert result["summary"]["converted"] == 1
        # Orphan image should be deleted
        assert not old_img.exists()


class TestDocConvertLocalhostGuard:
    """Tests for localhost-only restriction on convert_files."""

    def test_convert_blocked_for_remote(self):
        repo = MagicMock()
        config = MagicMock()
        config.doc_convert_config = {}
        converter = DocConvert(repo, config)
        collab = MagicMock()
        collab._is_caller_localhost.return_value = False
        converter._collab = collab
        result = converter.convert_files(["test.docx"])
        assert result.get("error") == "restricted"

    @patch("ac_dc.doc_convert._is_markitdown_available", return_value=False)
    def test_convert_allowed_for_localhost(self, mock_avail):
        repo = MagicMock()
        config = MagicMock()
        config.doc_convert_config = {}
        converter = DocConvert(repo, config)
        collab = MagicMock()
        collab._is_caller_localhost.return_value = True
        converter._collab = collab
        # Passes the guard, then hits "markitdown not installed" check
        result = converter.convert_files(["test.docx"])
        assert result.get("error") != "restricted"
        assert "markitdown" in result.get("error", "").lower()

    def test_scan_not_restricted(self):
        repo = MagicMock()
        repo.root = MagicMock()
        config = MagicMock()
        config.doc_convert_config = {"enabled": False}
        converter = DocConvert(repo, config)
        collab = MagicMock()
        collab._is_caller_localhost.return_value = False
        converter._collab = collab
        # scan is read-only — should not be restricted
        result = converter.scan_convertible_files()
        assert result.get("error") != "restricted"


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


# === SVG Image Externalization Tests ===


class TestExternalizeSvgImages:
    """Tests for _externalize_svg_images."""

    def _make_data_uri(self, mime_sub="png", data=b"\x89PNG\r\n\x1a\n"):
        import base64
        b64 = base64.b64encode(data).decode("ascii")
        return f"data:image/{mime_sub};base64,{b64}"

    def _make_svg(self, href_attr="href", data_uri=None, extra_attrs=""):
        if data_uri is None:
            data_uri = self._make_data_uri()
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">'
            f'<image {extra_attrs}{href_attr}="{data_uri}" width="100" height="100"/>'
            f'</svg>'
        )

    def test_single_image_extracted(self, tmp_path):
        svg = self._make_svg()
        result_svg, saved = _externalize_svg_images(svg, tmp_path, "01_slide", 1)
        assert len(saved) == 1
        assert saved[0].endswith(".png")
        assert "01_slide_img1_1.png" == saved[0]
        assert (tmp_path / saved[0]).exists()
        assert "data:image" not in result_svg
        assert saved[0] in result_svg

    def test_xlink_href_handled(self, tmp_path):
        svg = self._make_svg(href_attr="xlink:href")
        result_svg, saved = _externalize_svg_images(svg, tmp_path, "02_slide", 2)
        assert len(saved) == 1
        assert "data:image" not in result_svg
        assert saved[0] in result_svg

    def test_jpeg_extension(self, tmp_path):
        uri = self._make_data_uri(mime_sub="jpeg", data=b"\xff\xd8\xff\xe0")
        svg = self._make_svg(data_uri=uri)
        _, saved = _externalize_svg_images(svg, tmp_path, "03_slide", 3)
        assert len(saved) == 1
        assert saved[0].endswith(".jpg")

    def test_multiple_images(self, tmp_path):
        uri1 = self._make_data_uri(data=b"img1data")
        uri2 = self._make_data_uri(mime_sub="jpeg", data=b"img2data")
        svg = (
            '<svg xmlns="http://www.w3.org/2000/svg">'
            f'<image href="{uri1}" width="50" height="50"/>'
            f'<image xlink:href="{uri2}" width="50" height="50"/>'
            '</svg>'
        )
        result_svg, saved = _externalize_svg_images(svg, tmp_path, "04_slide", 4)
        assert len(saved) == 2
        assert saved[0].endswith(".png")
        assert saved[1].endswith(".jpg")
        assert "data:image" not in result_svg
        for fn in saved:
            assert (tmp_path / fn).exists()

    def test_no_data_uris_unchanged(self, tmp_path):
        svg = (
            '<svg xmlns="http://www.w3.org/2000/svg">'
            '<image href="photo.png" width="100" height="100"/>'
            '<text x="10" y="20">Hello</text>'
            '</svg>'
        )
        result_svg, saved = _externalize_svg_images(svg, tmp_path, "05_slide", 5)
        assert saved == []
        assert result_svg == svg

    def test_text_elements_preserved(self, tmp_path):
        uri = self._make_data_uri()
        svg = (
            '<svg xmlns="http://www.w3.org/2000/svg">'
            '<text x="10" y="20" font-size="14">Title</text>'
            f'<image href="{uri}" width="50" height="50"/>'
            '<path d="M0 0 L10 10"/>'
            '</svg>'
        )
        result_svg, saved = _externalize_svg_images(svg, tmp_path, "06_slide", 6)
        assert len(saved) == 1
        assert '<text x="10" y="20" font-size="14">Title</text>' in result_svg
        assert '<path d="M0 0 L10 10"/>' in result_svg

    def test_multiline_base64_handled(self, tmp_path):
        """Base64 with newlines every 76 chars (as PyMuPDF produces)."""
        import base64
        raw = b"A" * 200  # enough bytes to produce multi-line base64
        b64 = base64.b64encode(raw).decode("ascii")
        # Insert newlines every 76 chars to mimic real output
        wrapped = "\n".join(b64[i:i+76] for i in range(0, len(b64), 76))
        data_uri = f"data:image/png;base64,\n{wrapped}\n"
        svg = (
            '<svg xmlns="http://www.w3.org/2000/svg">'
            f'<image href="{data_uri}" width="100" height="100"/>'
            '</svg>'
        )
        result_svg, saved = _externalize_svg_images(svg, tmp_path, "07_slide", 7)
        assert len(saved) == 1
        assert "data:image" not in result_svg
        # Verify decoded content matches original
        assert (tmp_path / saved[0]).read_bytes() == raw

    def test_whitespace_around_uri(self, tmp_path):
        """Whitespace after opening quote and before closing quote."""
        import base64
        raw = b"test image bytes"
        b64 = base64.b64encode(raw).decode("ascii")
        # Add whitespace around the data URI value
        svg = (
            '<svg xmlns="http://www.w3.org/2000/svg">'
            f'<image href=" data:image/png;base64, {b64} " width="100" height="100"/>'
            '</svg>'
        )
        result_svg, saved = _externalize_svg_images(svg, tmp_path, "08_slide", 8)
        assert len(saved) == 1
        assert (tmp_path / saved[0]).read_bytes() == raw

    def test_file_naming_convention(self, tmp_path):
        svg = self._make_svg()
        _, saved = _externalize_svg_images(svg, tmp_path, "04_slide", 4)
        assert saved[0] == "04_slide_img4_1.png"

    def test_decoded_bytes_correct(self, tmp_path):
        raw_bytes = b"\x89PNG\r\n\x1a\nSOME_IMAGE_DATA_HERE"
        uri = self._make_data_uri(data=raw_bytes)
        svg = self._make_svg(data_uri=uri)
        _, saved = _externalize_svg_images(svg, tmp_path, "09_slide", 9)
        assert (tmp_path / saved[0]).read_bytes() == raw_bytes

    def test_empty_svg(self, tmp_path):
        svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
        result_svg, saved = _externalize_svg_images(svg, tmp_path, "10_slide", 10)
        assert saved == []
        assert result_svg == svg

    def test_invalid_base64_left_unchanged(self, tmp_path):
        svg = (
            '<svg xmlns="http://www.w3.org/2000/svg">'
            '<image href="data:image/png;base64,!!!NOT_VALID_BASE64!!!" '
            'width="100" height="100"/>'
            '</svg>'
        )
        result_svg, saved = _externalize_svg_images(svg, tmp_path, "11_slide", 11)
        # Invalid base64 should be left in place
        assert saved == []
        assert "data:image" in result_svg


# === Docx Image Extraction Tests ===


class TestExtractDocxImages:
    """Tests for _extract_docx_images."""

    def _make_docx_zip(self, tmp_path, media_files):
        """Create a minimal .docx zip with given media files.

        Args:
            tmp_path: directory to write the zip into
            media_files: dict of {archive_member: bytes_content}

        Returns:
            Path to the created .docx file
        """
        import zipfile
        docx_path = tmp_path / "test.docx"
        with zipfile.ZipFile(str(docx_path), "w") as zf:
            # Minimal content types
            zf.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types/>')
            for member, data in media_files.items():
                zf.writestr(member, data)
        return docx_path

    def test_single_image_extracted(self, tmp_path):
        docx = self._make_docx_zip(tmp_path, {
            "word/media/image1.png": b"\x89PNG\r\n\x1a\nfakedata",
        })
        out_dir = tmp_path / "output"
        out_dir.mkdir()
        saved = _extract_docx_images(docx, out_dir, "report")
        assert len(saved) == 1
        assert saved[0] == "report_img1.png"
        assert (out_dir / saved[0]).exists()
        assert (out_dir / saved[0]).read_bytes() == b"\x89PNG\r\n\x1a\nfakedata"

    def test_multiple_images_in_order(self, tmp_path):
        docx = self._make_docx_zip(tmp_path, {
            "word/media/image1.png": b"img1",
            "word/media/image2.jpeg": b"img2",
            "word/media/image3.gif": b"img3",
        })
        out_dir = tmp_path / "output"
        out_dir.mkdir()
        saved = _extract_docx_images(docx, out_dir, "doc")
        assert len(saved) == 3
        assert saved[0] == "doc_img1.png"   # sorted alphabetically by original name
        assert saved[1] == "doc_img2.jpg"   # .jpeg normalised to .jpg
        assert saved[2] == "doc_img3.gif"

    def test_jpeg_normalised_to_jpg(self, tmp_path):
        docx = self._make_docx_zip(tmp_path, {
            "word/media/photo.jpeg": b"\xff\xd8\xff",
        })
        out_dir = tmp_path / "output"
        out_dir.mkdir()
        saved = _extract_docx_images(docx, out_dir, "memo")
        assert len(saved) == 1
        assert saved[0].endswith(".jpg")

    def test_no_media_returns_empty(self, tmp_path):
        docx = self._make_docx_zip(tmp_path, {})
        out_dir = tmp_path / "output"
        out_dir.mkdir()
        saved = _extract_docx_images(docx, out_dir, "empty")
        assert saved == []

    def test_non_zip_returns_empty(self, tmp_path):
        fake = tmp_path / "notazip.docx"
        fake.write_text("this is not a zip")
        out_dir = tmp_path / "output"
        out_dir.mkdir()
        saved = _extract_docx_images(fake, out_dir, "bad")
        assert saved == []

    def test_non_media_files_skipped(self, tmp_path):
        docx = self._make_docx_zip(tmp_path, {
            "word/media/image1.png": b"img",
            "word/document.xml": b"<doc/>",
            "word/styles.xml": b"<styles/>",
        })
        out_dir = tmp_path / "output"
        out_dir.mkdir()
        saved = _extract_docx_images(docx, out_dir, "test")
        assert len(saved) == 1
        assert saved[0] == "test_img1.png"


class TestReplaceTruncatedUris:
    """Tests for _replace_truncated_uris."""

    def test_single_truncated_uri_replaced(self):
        md = "# Title\n\n![diagram](data:image/png;base64...)\n\nText"
        result = _replace_truncated_uris(md, ["report_img1.png"])
        assert "report_img1.png" in result
        assert "data:image" not in result

    def test_multiple_truncated_uris_replaced_in_order(self):
        md = (
            "![first](data:image/png;base64...)\n"
            "![second](data:image/jpeg;base64...)\n"
        )
        result = _replace_truncated_uris(md, ["img1.png", "img2.jpg"])
        assert "img1.png" in result
        assert "img2.jpg" in result
        assert result.index("img1.png") < result.index("img2.jpg")

    def test_real_data_uri_not_replaced(self):
        import base64
        b64 = base64.b64encode(b"realdata").decode()
        md = f"![pic](data:image/png;base64,{b64})"
        result = _replace_truncated_uris(md, ["should_not_appear.png"])
        assert "should_not_appear.png" not in result
        assert b64 in result

    def test_no_truncated_uris_unchanged(self):
        md = "# Title\n\n![photo](images/photo.png)\n"
        result = _replace_truncated_uris(md, ["unused.png"])
        assert result == md

    def test_more_uris_than_images_leaves_extras(self):
        md = (
            "![a](data:image/png;base64...)\n"
            "![b](data:image/png;base64...)\n"
        )
        result = _replace_truncated_uris(md, ["only_one.png"])
        assert "only_one.png" in result
        # Second truncated URI has no replacement — left as-is
        assert "data:image" in result

    def test_empty_image_list(self):
        md = "![x](data:image/png;base64...)"
        result = _replace_truncated_uris(md, [])
        assert result == md

    def test_alt_text_preserved(self):
        md = "![Architecture Diagram](data:image/png;base64...)"
        result = _replace_truncated_uris(md, ["arch.png"])
        assert "![Architecture Diagram](arch.png)" in result


class TestDocxConversionIntegration:
    """Integration tests for docx image extraction in _convert_single."""

    @patch("ac_dc.doc_convert._is_markitdown_available", return_value=True)
    def test_docx_images_extracted_and_linked(self, mock_avail, converter, git_repo):
        """Verify that docx images are extracted from the zip and linked in output."""
        import zipfile

        # Create a real .docx zip with an embedded image
        source = git_repo / "report.docx"
        img_data = b"\x89PNG\r\n\x1a\nfake_png_data"
        with zipfile.ZipFile(str(source), "w") as zf:
            zf.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types/>')
            zf.writestr("word/media/image1.png", img_data)

        # markitdown returns markdown with a truncated data URI
        fake_md = "# Report\n\n![diagram](data:image/png;base64...)\n\nDone."

        with patch(
            "ac_dc.doc_convert.DocConvert._convert_with_markitdown",
            return_value=fake_md,
        ):
            result = converter.convert_files(["report.docx"])

        assert result["summary"]["converted"] == 1

        # Check that the image was extracted into the subdirectory
        img_file = git_repo / "report" / "report_img1.png"
        assert img_file.exists()
        assert img_file.read_bytes() == img_data

        # Check that the output markdown references the extracted image
        # with the subdirectory prefix
        output = git_repo / "report.md"
        assert output.exists()
        text = output.read_text()
        assert "report/report_img1.png" in text
        assert "data:image" not in text

        # Check provenance lists the image with subdirectory prefix
        assert "images=" in text
        assert "report/report_img1.png" in text

    @patch("ac_dc.doc_convert._is_markitdown_available", return_value=True)
    def test_non_docx_skips_docx_extraction(self, mock_avail, converter, git_repo):
        """Non-.docx files should not attempt docx zip extraction."""
        source = git_repo / "data.csv"
        source.write_text("a,b,c\n1,2,3")

        with patch(
            "ac_dc.doc_convert.DocConvert._convert_with_markitdown",
            return_value="| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |",
        ):
            result = converter.convert_files(["data.csv"])

        assert result["summary"]["converted"] == 1
        output = git_repo / "data.md"
        assert output.exists()

    @patch("ac_dc.doc_convert._is_markitdown_available", return_value=True)
    def test_docx_no_images_still_converts(self, mock_avail, converter, git_repo):
        """A .docx with no embedded images should convert normally."""
        import zipfile

        source = git_repo / "plain.docx"
        with zipfile.ZipFile(str(source), "w") as zf:
            zf.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types/>')
            # No word/media/ entries

        with patch(
            "ac_dc.doc_convert.DocConvert._convert_with_markitdown",
            return_value="# Plain Document\n\nJust text.",
        ):
            result = converter.convert_files(["plain.docx"])

        assert result["summary"]["converted"] == 1
        output = git_repo / "plain.md"
        text = output.read_text()
        assert "# Plain Document" in text
        assert "data:image" not in text