"""Tests for DocConvert — scanning, status detection, conversion, provenance."""

import json
import os
import subprocess
import zipfile
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from ac_dc.repo import Repo


# ── Helpers ───────────────────────────────────────────────────────

def _make_repo(tmp_path):
    """Create a minimal git repo with an initial commit."""
    repo_dir = tmp_path / "repo"
    repo_dir.mkdir()
    subprocess.run(["git", "init", str(repo_dir)], capture_output=True, check=True)
    subprocess.run(
        ["git", "-C", str(repo_dir), "config", "user.email", "test@test.com"],
        capture_output=True, check=True,
    )
    subprocess.run(
        ["git", "-C", str(repo_dir), "config", "user.name", "Test"],
        capture_output=True, check=True,
    )
    (repo_dir / "README.md").write_text("# Test\n")
    subprocess.run(["git", "-C", str(repo_dir), "add", "."], capture_output=True, check=True)
    subprocess.run(
        ["git", "-C", str(repo_dir), "commit", "-m", "init"],
        capture_output=True, check=True,
    )
    return repo_dir


def _create_docx_stub(path: Path):
    """Create a minimal .docx zip with a media image."""
    with zipfile.ZipFile(str(path), "w") as zf:
        zf.writestr("word/document.xml", "<w:document/>")
        zf.writestr("word/media/image1.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 50)
        zf.writestr("word/media/image2.jpeg", b"\xff\xd8\xff\xe0" + b"\x00" * 50)


@pytest.fixture
def doc_convert_repo(tmp_path):
    """Repo with convertible files and a DocConvert instance."""
    repo_dir = _make_repo(tmp_path)

    # Create test files
    (repo_dir / "docs").mkdir()
    (repo_dir / "docs" / "report.csv").write_text("a,b,c\n1,2,3\n4,5,6\n")
    (repo_dir / "docs" / "notes.rtf").write_text("{\\rtf1 Hello RTF}")

    # Commit so tree is clean
    subprocess.run(["git", "-C", str(repo_dir), "add", "."], capture_output=True, check=True)
    subprocess.run(
        ["git", "-C", str(repo_dir), "commit", "-m", "add docs"],
        capture_output=True, check=True,
    )

    repo = Repo(repo_dir)

    from ac_dc.doc_convert import DocConvert
    dc = DocConvert(repo)
    return repo_dir, repo, dc


# ── Import Guard ──────────────────────────────────────────────────

def _has_markitdown():
    try:
        import markitdown
        return True
    except ImportError:
        return False


_skip_no_markitdown = pytest.mark.skipif(
    not _has_markitdown(),
    reason="markitdown not installed",
)


# ── Provenance Parsing ────────────────────────────────────────────

class TestProvenance:
    def test_parse_provenance_present(self):
        from ac_dc.doc_convert import _parse_provenance
        text = "<!-- docuvert: source=report.csv sha256=abc123 -->\n\n# Report\n"
        prov = _parse_provenance(text)
        assert prov is not None
        assert prov["source"] == "report.csv"
        assert prov["sha256"] == "abc123"

    def test_parse_provenance_with_images(self):
        from ac_dc.doc_convert import _parse_provenance
        text = "<!-- docuvert: source=doc.docx sha256=abc images=img1.png,img2.svg -->\n"
        prov = _parse_provenance(text)
        assert prov["images"] == "img1.png,img2.svg"

    def test_parse_provenance_missing(self):
        from ac_dc.doc_convert import _parse_provenance
        prov = _parse_provenance("# Just a regular markdown file\n")
        assert prov is None

    def test_parse_provenance_lenient(self):
        from ac_dc.doc_convert import _parse_provenance
        text = "<!-- docuvert: source=x.csv sha256=abc future_field=foo -->\n"
        prov = _parse_provenance(text)
        assert prov["source"] == "x.csv"
        assert prov["future_field"] == "foo"

    def test_build_md_provenance(self):
        from ac_dc.doc_convert import _build_md_provenance
        header = _build_md_provenance("report.csv", "abc123")
        assert "docuvert:" in header
        assert "source=report.csv" in header
        assert "sha256=abc123" in header

    def test_build_md_provenance_with_images(self):
        from ac_dc.doc_convert import _build_md_provenance
        header = _build_md_provenance("doc.docx", "abc", images=["img1.png", "img2.svg"])
        assert "images=img1.png,img2.svg" in header

    def test_build_svg_provenance(self):
        from ac_dc.doc_convert import _build_svg_provenance
        header = _build_svg_provenance("doc.md", "doc.docx", "abc", 2)
        assert "parent=doc.md" in header
        assert "img_index=2" in header


# ── Status Detection ──────────────────────────────────────────────

class TestStatusDetection:
    def test_new_status(self, doc_convert_repo):
        repo_dir, repo, dc = doc_convert_repo
        from ac_dc.doc_convert import _sha256_file
        abs_path = repo_dir / "docs" / "report.csv"
        status = dc._detect_status("docs/report.csv", abs_path, "docs/report.md")
        assert status == "new"

    def test_current_status(self, doc_convert_repo):
        repo_dir, repo, dc = doc_convert_repo
        from ac_dc.doc_convert import _sha256_file, _build_md_provenance

        abs_path = repo_dir / "docs" / "report.csv"
        sha = _sha256_file(abs_path)

        # Create matching output
        output = repo_dir / "docs" / "report.md"
        header = _build_md_provenance("report.csv", sha)
        output.write_text(f"{header}\n\n# Report\n")

        status = dc._detect_status("docs/report.csv", abs_path, "docs/report.md")
        assert status == "current"

    def test_stale_status(self, doc_convert_repo):
        repo_dir, repo, dc = doc_convert_repo
        from ac_dc.doc_convert import _build_md_provenance

        # Create output with wrong hash
        output = repo_dir / "docs" / "report.md"
        header = _build_md_provenance("report.csv", "wrong_hash")
        output.write_text(f"{header}\n\n# Report\n")

        abs_path = repo_dir / "docs" / "report.csv"
        status = dc._detect_status("docs/report.csv", abs_path, "docs/report.md")
        assert status == "stale"

    def test_conflict_status(self, doc_convert_repo):
        repo_dir, repo, dc = doc_convert_repo

        # Create output without provenance header
        output = repo_dir / "docs" / "report.md"
        output.write_text("# Manually authored report\n")

        abs_path = repo_dir / "docs" / "report.csv"
        status = dc._detect_status("docs/report.csv", abs_path, "docs/report.md")
        assert status == "conflict"


# ── Scanning ──────────────────────────────────────────────────────

class TestScanning:
    def test_scan_discovers_files(self, doc_convert_repo):
        repo_dir, repo, dc = doc_convert_repo
        result = dc.scan_convertible_files()
        paths = [f["path"] for f in result["files"]]
        assert "docs/report.csv" in paths

    def test_scan_skips_excluded_dirs(self, doc_convert_repo):
        repo_dir, repo, dc = doc_convert_repo
        # Put a file in node_modules
        nm = repo_dir / "node_modules"
        nm.mkdir()
        (nm / "lib.csv").write_text("x,y\n")

        result = dc.scan_convertible_files()
        paths = [f["path"] for f in result["files"]]
        assert not any("node_modules" in p for p in paths)

    def test_scan_clean_tree_check(self, doc_convert_repo):
        repo_dir, repo, dc = doc_convert_repo
        result = dc.scan_convertible_files()
        assert result["clean"] is True

    def test_scan_dirty_tree(self, doc_convert_repo):
        repo_dir, repo, dc = doc_convert_repo
        (repo_dir / "dirty.txt").write_text("content")
        repo.stage_files(["dirty.txt"])

        result = dc.scan_convertible_files()
        assert result["clean"] is False
        assert result["message"] is not None


# ── is_available ──────────────────────────────────────────────────

class TestIsAvailable:
    def test_returns_dict(self, doc_convert_repo):
        _, _, dc = doc_convert_repo
        result = dc.is_available()
        assert "available" in result
        assert "libreoffice" in result
        assert "pymupdf" in result
        assert "pdf_pipeline" in result
        assert isinstance(result["available"], bool)


# ── Conversion ────────────────────────────────────────────────────

class TestConversion:
    def test_dirty_tree_blocks_conversion(self, doc_convert_repo):
        repo_dir, repo, dc = doc_convert_repo
        (repo_dir / "dirty.txt").write_text("x")
        repo.stage_files(["dirty.txt"])

        results = dc.convert_files(["docs/report.csv"])
        assert results[0]["status"] == "error"
        assert "uncommitted" in results[0]["message"].lower()

    def test_missing_file_error(self, doc_convert_repo):
        _, _, dc = doc_convert_repo
        results = dc.convert_files(["nonexistent.csv"])
        assert results[0]["status"] == "error"
        assert "not found" in results[0]["message"].lower()

    @_skip_no_markitdown
    def test_csv_conversion(self, doc_convert_repo):
        repo_dir, repo, dc = doc_convert_repo
        results = dc.convert_files(["docs/report.csv"])
        assert results[0]["status"] == "ok"
        assert results[0]["output_path"] == "docs/report.md"

        output = (repo_dir / "docs" / "report.md").read_text()
        assert "docuvert:" in output
        assert "source=report.csv" in output

    @_skip_no_markitdown
    def test_provenance_header_written(self, doc_convert_repo):
        repo_dir, repo, dc = doc_convert_repo
        dc.convert_files(["docs/report.csv"])

        output = (repo_dir / "docs" / "report.md").read_text()
        from ac_dc.doc_convert import _parse_provenance, _sha256_file
        prov = _parse_provenance(output)
        assert prov is not None
        assert prov["source"] == "report.csv"

        expected_sha = _sha256_file(repo_dir / "docs" / "report.csv")
        assert prov["sha256"] == expected_sha

    @_skip_no_markitdown
    def test_stale_reconversion(self, doc_convert_repo):
        repo_dir, repo, dc = doc_convert_repo
        from ac_dc.doc_convert import _build_md_provenance

        # First conversion
        dc.convert_files(["docs/report.csv"])

        # Commit conversion output, then modify source and commit again
        subprocess.run(["git", "-C", str(repo_dir), "add", "."], capture_output=True)
        subprocess.run(
            ["git", "-C", str(repo_dir), "commit", "-m", "add conversion output"],
            capture_output=True,
        )
        (repo_dir / "docs" / "report.csv").write_text("x,y\n10,20\n")
        subprocess.run(["git", "-C", str(repo_dir), "add", "."], capture_output=True)
        subprocess.run(
            ["git", "-C", str(repo_dir), "commit", "-m", "update csv"],
            capture_output=True,
        )

        # Re-convert
        results = dc.convert_files(["docs/report.csv"])
        assert results[0]["status"] == "ok"

    @_skip_no_markitdown
    def test_conflict_overwrite(self, doc_convert_repo):
        repo_dir, repo, dc = doc_convert_repo

        # Create manual .md
        output = repo_dir / "docs" / "report.md"
        output.write_text("# Manual report\n")
        subprocess.run(["git", "-C", str(repo_dir), "add", "."], capture_output=True)
        subprocess.run(
            ["git", "-C", str(repo_dir), "commit", "-m", "add manual"],
            capture_output=True,
        )

        results = dc.convert_files(["docs/report.csv"])
        assert results[0]["status"] == "ok"

        # Should now have provenance
        text = output.read_text()
        from ac_dc.doc_convert import _parse_provenance
        assert _parse_provenance(text) is not None

    @_skip_no_markitdown
    def test_assets_dir_removed_if_empty(self, doc_convert_repo):
        repo_dir, repo, dc = doc_convert_repo
        dc.convert_files(["docs/report.csv"])
        # CSV has no images, so assets dir should not exist
        assets = repo_dir / "docs" / "report"
        assert not assets.exists()


# ── DOCX Image Extraction ────────────────────────────────────────

class TestDocxImages:
    def test_extract_docx_images(self, doc_convert_repo):
        repo_dir, repo, dc = doc_convert_repo
        from ac_dc.doc_convert import DocConvert

        # Create a stub docx
        docx_path = repo_dir / "docs" / "test.docx"
        _create_docx_stub(docx_path)

        assets = repo_dir / "docs" / "test"
        assets.mkdir(exist_ok=True)

        images = dc._extract_docx_images(docx_path, "test", assets)
        assert len(images) == 2
        assert images[0].endswith(".png")
        assert images[1].endswith(".jpg")  # .jpeg normalized to .jpg

    def test_extract_docx_non_zip(self, doc_convert_repo):
        repo_dir, repo, dc = doc_convert_repo

        # Not a zip
        bad_path = repo_dir / "docs" / "bad.docx"
        bad_path.write_text("not a zip")

        assets = repo_dir / "docs" / "bad"
        assets.mkdir(exist_ok=True)

        images = dc._extract_docx_images(bad_path, "bad", assets)
        assert images == []

    def test_replace_truncated_uris(self, doc_convert_repo):
        _, _, dc = doc_convert_repo
        md = "![img](data:image/png;base64...) and ![img2](data:image/jpeg;base64...)"
        result = dc._replace_truncated_uris(md, ["img1.png", "img2.jpg"], "assets")
        assert "assets/img1.png" in result
        assert "assets/img2.jpg" in result
        assert "base64..." not in result


# ── SVG Image Externalization ─────────────────────────────────────

class TestSvgExternalization:
    def test_externalize_basic(self, doc_convert_repo):
        repo_dir, repo, dc = doc_convert_repo
        assets = repo_dir / "docs" / "test"
        assets.mkdir(exist_ok=True)

        import base64
        img_data = base64.b64encode(b"\x89PNG" + b"\x00" * 20).decode()
        svg = f'<svg><image href="data:image/png;base64,{img_data}"/></svg>'

        result, files = dc._externalize_svg_images(svg, "test", 0, assets, "docs/test")
        assert len(files) == 1
        assert files[0].endswith(".png")
        assert "data:image" not in result

    def test_externalize_xlink_href(self, doc_convert_repo):
        repo_dir, repo, dc = doc_convert_repo
        assets = repo_dir / "docs" / "test"
        assets.mkdir(exist_ok=True)

        import base64
        img_data = base64.b64encode(b"\xff\xd8" + b"\x00" * 20).decode()
        svg = f'<svg><image xlink:href="data:image/jpeg;base64,{img_data}"/></svg>'

        result, files = dc._externalize_svg_images(svg, "test", 0, assets, "docs/test")
        assert len(files) == 1
        assert files[0].endswith(".jpg")

    def test_externalize_whitespace_in_base64(self, doc_convert_repo):
        repo_dir, repo, dc = doc_convert_repo
        assets = repo_dir / "docs" / "test"
        assets.mkdir(exist_ok=True)

        import base64
        img_data = base64.b64encode(b"\x89PNG" + b"\x00" * 20).decode()
        # Insert whitespace/newlines
        broken = img_data[:10] + "\n  " + img_data[10:]
        svg = f'<svg><image href="data:image/png;base64,{broken}"/></svg>'

        result, files = dc._externalize_svg_images(svg, "test", 0, assets, "docs/test")
        assert len(files) == 1


# ── Colour-Aware XLSX ─────────────────────────────────────────────

class TestXlsxColors:
    def test_color_extraction_requires_openpyxl(self, doc_convert_repo):
        """Verify the method exists and handles the fallback path."""
        _, _, dc = doc_convert_repo
        # Create a simple xlsx-like test — just verify no crash on CSV
        # (actual xlsx testing requires openpyxl which may not be installed)
        from ac_dc.doc_convert import _check_openpyxl
        # This is a presence test — detailed color tests need openpyxl
        assert isinstance(_check_openpyxl(), bool)


# ── Configuration ─────────────────────────────────────────────────

class TestConfiguration:
    def test_default_extensions(self, doc_convert_repo):
        _, _, dc = doc_convert_repo
        exts = dc._get_extensions()
        assert ".csv" in exts
        assert ".docx" in exts

    def test_custom_extensions(self, doc_convert_repo):
        repo_dir, repo, dc = doc_convert_repo
        from ac_dc.config_manager import ConfigManager
        config = ConfigManager(repo_dir)
        config._app_config["doc_convert"]["extensions"] = [".csv"]
        dc._config = config

        exts = dc._get_extensions()
        assert exts == {".csv"}

    def test_max_size(self, doc_convert_repo):
        _, _, dc = doc_convert_repo
        max_bytes = dc._get_max_size_bytes()
        assert max_bytes == 50 * 1024 * 1024

    @_skip_no_markitdown
    def test_over_size_skipped(self, doc_convert_repo):
        repo_dir, repo, dc = doc_convert_repo

        # Patch max size to a tiny value so the CSV exceeds it
        dc._get_max_size_bytes = lambda: 10  # 10 bytes

        results = dc.convert_files(["docs/report.csv"])
        assert results[0]["status"] == "error"
        assert "size" in results[0]["message"].lower()


# ── Orphan Cleanup ────────────────────────────────────────────────

class TestOrphanCleanup:
    def test_old_images_cleaned_on_reconversion(self, doc_convert_repo):
        repo_dir, repo, dc = doc_convert_repo
        from ac_dc.doc_convert import _build_md_provenance, _sha256_file

        # Simulate existing conversion with images
        assets = repo_dir / "docs" / "report"
        assets.mkdir(parents=True, exist_ok=True)
        old_img = assets / "report_img1.png"
        old_img.write_bytes(b"\x89PNG")

        sha = _sha256_file(repo_dir / "docs" / "report.csv")
        header = _build_md_provenance("report.csv", sha, images=["report_img1.png"])
        output = repo_dir / "docs" / "report.md"
        output.write_text(f"{header}\n\n# Old\n")

        # Cleanup should remove old image
        dc._cleanup_old_images(output, assets)
        assert not old_img.exists()


# ── Graceful Degradation ─────────────────────────────────────────

class TestGracefulDegradation:
    def test_markitdown_not_installed(self, doc_convert_repo):
        _, _, dc = doc_convert_repo
        with patch("ac_dc.doc_convert._check_markitdown", return_value=False):
            results = dc.convert_files(["docs/report.csv"])
            assert results[0]["status"] == "error"
            assert "markitdown" in results[0]["message"].lower()

    def test_is_available_reports_dependencies(self, doc_convert_repo):
        _, _, dc = doc_convert_repo
        result = dc.is_available()
        # Just verify the shape — actual values depend on environment
        assert isinstance(result["available"], bool)
        assert isinstance(result["libreoffice"], bool)
        assert isinstance(result["pymupdf"], bool)
        assert result["pdf_pipeline"] == (result["libreoffice"] and result["pymupdf"])