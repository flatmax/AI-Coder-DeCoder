"""Markitdown pipeline tests — Pass A2.

Covers ``convert_files`` for the markitdown-backed extensions
(.docx, .rtf, .odt, .csv) plus the data-URI image extraction,
docx truncated-URI workaround, and orphan cleanup behaviour
shared with later passes.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from ac_dc.doc_convert import DocConvert

from ._helpers import (
    _RaisingCollab,
    _StubCollab,
    _assert_restricted,
    _make_data_uri,
    _make_docx_zip,
    _make_png_bytes,
    _sha256_of,
    _write_source,
)


# ---------------------------------------------------------------------------
# Localhost guard + restricted callers
# ---------------------------------------------------------------------------


class TestConvertFilesGuards:
    def test_non_localhost_returns_restricted(self, doc_convert):
        doc_convert._collab = _StubCollab(is_localhost=False)
        result = doc_convert.convert_files(["any.docx"])
        _assert_restricted(result)

    def test_raising_collab_returns_restricted(self, doc_convert):
        doc_convert._collab = _RaisingCollab()
        result = doc_convert.convert_files(["any.docx"])
        _assert_restricted(result)

    def test_guard_runs_before_clean_tree_check(
        self, config, fake_repo
    ):
        """Restricted caller is rejected before any other check runs."""
        svc = DocConvert(config, repo=fake_repo)
        svc._collab = _StubCollab(is_localhost=False)
        result = svc.convert_files(["any.docx"])
        _assert_restricted(result)


# ---------------------------------------------------------------------------
# Extension dispatch
# ---------------------------------------------------------------------------


class TestExtensionDispatch:
    def test_docx_routes_to_markitdown(
        self, doc_convert, scan_root, fake_markitdown
    ):
        _write_source(scan_root, "doc.docx", b"x")
        fake_markitdown.outputs[str(scan_root / "doc.docx")] = "text\n"
        result = doc_convert.convert_files(["doc.docx"])
        [entry] = result["results"]
        assert entry["status"] == "ok"

    def test_rtf_routes_to_markitdown(
        self, doc_convert, scan_root, fake_markitdown
    ):
        _write_source(scan_root, "doc.rtf", b"x")
        fake_markitdown.outputs[str(scan_root / "doc.rtf")] = "text\n"
        result = doc_convert.convert_files(["doc.rtf"])
        [entry] = result["results"]
        assert entry["status"] == "ok"

    def test_odt_routes_to_markitdown(
        self, doc_convert, scan_root, fake_markitdown
    ):
        _write_source(scan_root, "doc.odt", b"x")
        fake_markitdown.outputs[str(scan_root / "doc.odt")] = "text\n"
        result = doc_convert.convert_files(["doc.odt"])
        [entry] = result["results"]
        assert entry["status"] == "ok"


    def test_unsupported_extension_errors(
        self, doc_convert, scan_root, fake_markitdown
    ):
        _write_source(scan_root, "weird.xyz", b"x")
        result = doc_convert.convert_files(["weird.xyz"])
        [entry] = result["results"]
        assert entry["status"] == "error"

    def test_csv_routes_to_markitdown(
        self, doc_convert, scan_root, fake_markitdown
    ):
        """Pass A3 — csv uses markitdown (clean table output)."""
        _write_source(scan_root, "data.csv", b"a,b,c\n1,2,3\n")
        fake_markitdown.outputs[str(scan_root / "data.csv")] = (
            "| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n"
        )
        result = doc_convert.convert_files(["data.csv"])
        [entry] = result["results"]
        assert entry["status"] == "ok"

    def test_mixed_batch_produces_per_file_results(
        self, doc_convert, scan_root, fake_markitdown
    ):
        # Pairs one success with one failure (missing file)
        # to prove per-file isolation — a failing entry doesn't
        # abort the rest of the batch. Before Pass A5a/b there
        # were multiple supported-but-deferred extensions that
        # produced `skipped` results; now every supported ext
        # has at least one working path (or a format-specific
        # fallback), so a genuine failure is the right test
        # shape.
        _write_source(scan_root, "ok.docx", b"x")
        # "missing.docx" is deliberately not written — the
        # converter's pre-flight sees it doesn't exist.
        fake_markitdown.outputs[str(scan_root / "ok.docx")] = "text\n"
        result = doc_convert.convert_files(["ok.docx", "missing.docx"])
        assert len(result["results"]) == 2
        statuses = [r["status"] for r in result["results"]]
        assert statuses == ["ok", "error"]


# ---------------------------------------------------------------------------
# Pre-flight validation
# ---------------------------------------------------------------------------


class TestPreflightValidation:
    def test_missing_file_errors(
        self, doc_convert, fake_markitdown
    ):
        result = doc_convert.convert_files(["nonexistent.docx"])
        [entry] = result["results"]
        assert entry["status"] == "error"
        assert "not found" in entry["message"].lower()

    def test_path_traversal_rejected(
        self, doc_convert, fake_markitdown
    ):
        result = doc_convert.convert_files(["../escape.docx"])
        [entry] = result["results"]
        assert entry["status"] == "error"
        # Message should mention the path must be inside the root.
        assert (
            "repository" in entry["message"].lower()
            or "not found" in entry["message"].lower()
        )

    def test_over_size_file_skipped(
        self, doc_convert, isolated_config_dir, scan_root, fake_markitdown
    ):
        # Set max to 1 MB, write 2 MB.
        app_json = isolated_config_dir / "app.json"
        data = json.loads(app_json.read_text(encoding="utf-8"))
        data["doc_convert"]["max_source_size_mb"] = 1
        app_json.write_text(json.dumps(data), encoding="utf-8")
        doc_convert._config.reload_app_config()
        _write_source(scan_root, "big.docx", b"x" * (2 * 1024 * 1024))
        result = doc_convert.convert_files(["big.docx"])
        [entry] = result["results"]
        assert entry["status"] == "skipped"
        assert "limit" in entry["message"].lower()


# ---------------------------------------------------------------------------
# markitdown failure handling
# ---------------------------------------------------------------------------


class TestMarkitdownFailures:
    def test_missing_markitdown_returns_error(
        self, doc_convert, scan_root, monkeypatch
    ):
        """When markitdown isn't installed, return a clean error."""
        import sys
        _write_source(scan_root, "doc.docx", b"x")
        # Ensure no markitdown in sys.modules. Also block the import
        # at a lower level so the lazy `from markitdown import ...`
        # raises ImportError.
        monkeypatch.delitem(sys.modules, "markitdown", raising=False)

        real_import = __builtins__["__import__"] if isinstance(
            __builtins__, dict
        ) else __builtins__.__import__

        def blocking_import(name, *args, **kwargs):
            if name == "markitdown":
                raise ImportError("markitdown not installed")
            return real_import(name, *args, **kwargs)

        monkeypatch.setattr(
            "builtins.__import__", blocking_import,
        )
        result = doc_convert.convert_files(["doc.docx"])
        [entry] = result["results"]
        assert entry["status"] == "error"
        assert "markitdown" in entry["message"].lower()

    def test_markitdown_exception_captured(
        self, doc_convert, scan_root, fake_markitdown
    ):
        _write_source(scan_root, "doc.docx", b"x")
        fake_markitdown.raise_on_convert = RuntimeError("corrupted file")
        result = doc_convert.convert_files(["doc.docx"])
        [entry] = result["results"]
        assert entry["status"] == "error"
        assert "corrupted" in entry["message"].lower()


# ---------------------------------------------------------------------------
# Provenance header writing
# ---------------------------------------------------------------------------


class TestProvenanceWriting:
    def test_header_on_first_line(
        self, doc_convert, scan_root, fake_markitdown
    ):
        _write_source(scan_root, "doc.docx", b"content")
        fake_markitdown.outputs[str(scan_root / "doc.docx")] = "body text\n"
        doc_convert.convert_files(["doc.docx"])
        output = (scan_root / "doc.md").read_text(encoding="utf-8")
        assert output.startswith("<!-- docuvert:")

    def test_header_contains_source_and_sha(
        self, doc_convert, scan_root, fake_markitdown
    ):
        content = b"known content"
        expected_hash = _sha256_of(content)
        _write_source(scan_root, "doc.docx", content)
        fake_markitdown.outputs[str(scan_root / "doc.docx")] = "body\n"
        doc_convert.convert_files(["doc.docx"])
        output = (scan_root / "doc.md").read_text(encoding="utf-8")
        assert "source=doc.docx" in output
        assert f"sha256={expected_hash}" in output

    def test_header_includes_images_when_present(
        self, doc_convert, scan_root, fake_markitdown
    ):
        _write_source(scan_root, "doc.docx", b"x")
        png = _make_png_bytes()
        fake_markitdown.outputs[str(scan_root / "doc.docx")] = (
            f"Before ![alt]({_make_data_uri(png)}) after\n"
        )
        doc_convert.convert_files(["doc.docx"])
        output = (scan_root / "doc.md").read_text(encoding="utf-8")
        assert "images=doc_img1.png" in output

    def test_header_omits_images_when_none(
        self, doc_convert, scan_root, fake_markitdown
    ):
        _write_source(scan_root, "doc.docx", b"x")
        fake_markitdown.outputs[str(scan_root / "doc.docx")] = "no images\n"
        doc_convert.convert_files(["doc.docx"])
        output = (scan_root / "doc.md").read_text(encoding="utf-8")
        # Header present but `images=` field absent.
        assert "<!-- docuvert:" in output
        assert "images=" not in output

    def test_roundtrip_via_scan(
        self, doc_convert, scan_root, fake_markitdown
    ):
        """Converted file scans as `current` on next pass."""
        _write_source(scan_root, "doc.docx", b"stable")
        fake_markitdown.outputs[str(scan_root / "doc.docx")] = "body\n"
        doc_convert.convert_files(["doc.docx"])
        scan = doc_convert.scan_convertible_files()
        [entry] = scan
        assert entry["status"] == "current"

    def test_conversion_changes_to_stale_on_source_edit(
        self, doc_convert, scan_root, fake_markitdown
    ):
        _write_source(scan_root, "doc.docx", b"original")
        fake_markitdown.outputs[str(scan_root / "doc.docx")] = "body\n"
        doc_convert.convert_files(["doc.docx"])
        # Edit the source — hash now differs from what's recorded.
        _write_source(scan_root, "doc.docx", b"edited")
        scan = doc_convert.scan_convertible_files()
        [entry] = scan
        assert entry["status"] == "stale"


# ---------------------------------------------------------------------------
# Data-URI image extraction
# ---------------------------------------------------------------------------


class TestDataUriImages:
    def test_single_image_extracted(
        self, doc_convert, scan_root, fake_markitdown
    ):
        _write_source(scan_root, "doc.docx", b"x")
        png = _make_png_bytes()
        fake_markitdown.outputs[str(scan_root / "doc.docx")] = (
            f"Text ![alt]({_make_data_uri(png)}) more\n"
        )
        result = doc_convert.convert_files(["doc.docx"])
        [entry] = result["results"]
        assert entry["images"] == ["doc_img1.png"]
        # File was written.
        image_path = scan_root / "doc" / "doc_img1.png"
        assert image_path.is_file()
        assert image_path.read_bytes() == png

    def test_multiple_images_numbered_in_order(
        self, doc_convert, scan_root, fake_markitdown
    ):
        _write_source(scan_root, "doc.docx", b"x")
        png = _make_png_bytes()
        fake_markitdown.outputs[str(scan_root / "doc.docx")] = (
            f"![a]({_make_data_uri(png)}) "
            f"![b]({_make_data_uri(png)}) "
            f"![c]({_make_data_uri(png)})\n"
        )
        result = doc_convert.convert_files(["doc.docx"])
        [entry] = result["results"]
        assert entry["images"] == [
            "doc_img1.png", "doc_img2.png", "doc_img3.png",
        ]

    def test_markdown_references_rewritten(
        self, doc_convert, scan_root, fake_markitdown
    ):
        _write_source(scan_root, "doc.docx", b"x")
        png = _make_png_bytes()
        fake_markitdown.outputs[str(scan_root / "doc.docx")] = (
            f"Before ![alt]({_make_data_uri(png)}) after\n"
        )
        doc_convert.convert_files(["doc.docx"])
        output = (scan_root / "doc.md").read_text(encoding="utf-8")
        assert "![alt](doc/doc_img1.png)" in output
        # Original data URI stripped.
        assert "data:image/png;base64" not in output

    def test_alt_text_preserved(
        self, doc_convert, scan_root, fake_markitdown
    ):
        _write_source(scan_root, "doc.docx", b"x")
        png = _make_png_bytes()
        fake_markitdown.outputs[str(scan_root / "doc.docx")] = (
            f"![Architecture diagram]({_make_data_uri(png)})\n"
        )
        doc_convert.convert_files(["doc.docx"])
        output = (scan_root / "doc.md").read_text(encoding="utf-8")
        assert "![Architecture diagram](doc/doc_img1.png)" in output

    def test_jpeg_extension(
        self, doc_convert, scan_root, fake_markitdown
    ):
        _write_source(scan_root, "doc.docx", b"x")
        fake_markitdown.outputs[str(scan_root / "doc.docx")] = (
            f"![alt]({_make_data_uri(b'fakejpegdata', 'image/jpeg')})\n"
        )
        result = doc_convert.convert_files(["doc.docx"])
        [entry] = result["results"]
        assert entry["images"] == ["doc_img1.jpg"]

    def test_no_images_no_assets_dir(
        self, doc_convert, scan_root, fake_markitdown
    ):
        """Files without images don't leave an empty assets subdirectory."""
        _write_source(scan_root, "doc.docx", b"x")
        fake_markitdown.outputs[str(scan_root / "doc.docx")] = (
            "text only, no images\n"
        )
        doc_convert.convert_files(["doc.docx"])
        assert not (scan_root / "doc").exists()

    def test_decode_failure_leaves_reference_in_place(
        self, doc_convert, scan_root, fake_markitdown
    ):
        """Invalid base64 doesn't crash — leaves the broken ref."""
        _write_source(scan_root, "doc.docx", b"x")
        # Intentionally broken payload with non-base64 chars.
        fake_markitdown.outputs[str(scan_root / "doc.docx")] = (
            "![alt](data:image/png;base64,!!!not-base64!!!)\n"
        )
        result = doc_convert.convert_files(["doc.docx"])
        [entry] = result["results"]
        # Conversion succeeded but no images saved.
        assert entry["status"] == "ok"


# ---------------------------------------------------------------------------
# DOCX truncated-URI workaround
# ---------------------------------------------------------------------------


class TestDocxTruncatedUris:
    def test_truncated_uri_replaced_from_zip(
        self, doc_convert, scan_root, fake_markitdown
    ):
        png_bytes = _make_png_bytes()
        docx_path = scan_root / "doc.docx"
        _make_docx_zip(docx_path, {"image1.png": png_bytes})
        fake_markitdown.outputs[str(docx_path)] = (
            "Before ![alt](data:image/png;base64...) after\n"
        )
        result = doc_convert.convert_files(["doc.docx"])
        [entry] = result["results"]
        assert entry["status"] == "ok"
        # Image extracted and saved — proves the truncated URI
        # was replaced with a real payload that then went through
        # the data-URI extractor.
        image_path = scan_root / "doc" / "doc_img1.png"
        assert image_path.is_file()
        assert image_path.read_bytes() == png_bytes

    def test_multiple_truncated_uris_matched_in_order(
        self, doc_convert, scan_root, fake_markitdown
    ):
        png1 = _make_png_bytes()
        png2 = png1 + b"\x00"  # distinguishable variant
        docx_path = scan_root / "doc.docx"
        _make_docx_zip(docx_path, {
            "image1.png": png1,
            "image2.png": png2,
        })
        fake_markitdown.outputs[str(docx_path)] = (
            "![a](data:image/png;base64...) "
            "![b](data:image/png;base64...)\n"
        )
        doc_convert.convert_files(["doc.docx"])
        # First image should match png1, second png2.
        assert (scan_root / "doc" / "doc_img1.png").read_bytes() == png1
        assert (scan_root / "doc" / "doc_img2.png").read_bytes() == png2

    def test_no_media_in_zip_leaves_truncated_uri(
        self, doc_convert, scan_root, fake_markitdown
    ):
        """When the docx zip has no images, we can't substitute."""
        docx_path = scan_root / "doc.docx"
        _make_docx_zip(docx_path, {})  # no media
        fake_markitdown.outputs[str(docx_path)] = (
            "![alt](data:image/png;base64...)\n"
        )
        result = doc_convert.convert_files(["doc.docx"])
        [entry] = result["results"]
        # Conversion succeeded but no image saved.
        assert entry["status"] == "ok"
        assert entry["images"] == []

    def test_non_zip_docx_tolerated(
        self, doc_convert, scan_root, fake_markitdown
    ):
        """Corrupt .docx (not a zip) doesn't crash the pipeline."""
        _write_source(scan_root, "corrupt.docx", b"not a zip")
        fake_markitdown.outputs[str(scan_root / "corrupt.docx")] = (
            "text with ![alt](data:image/png;base64...) ref\n"
        )
        result = doc_convert.convert_files(["corrupt.docx"])
        [entry] = result["results"]
        # markitdown succeeded (the fake doesn't care about
        # zip-ness), so conversion proceeds. The truncated URI is
        # left in place because docx extraction returned no images.
        assert entry["status"] == "ok"


# ---------------------------------------------------------------------------
# Orphan image cleanup
# ---------------------------------------------------------------------------


class TestOrphanCleanup:
    def test_orphans_removed_on_reconversion(
        self, doc_convert, scan_root, fake_markitdown
    ):
        """Images in the old header but not the new output are deleted."""
        _write_source(scan_root, "doc.docx", b"v1")
        png = _make_png_bytes()

        # First conversion — produces two images.
        fake_markitdown.outputs[str(scan_root / "doc.docx")] = (
            f"![a]({_make_data_uri(png)}) "
            f"![b]({_make_data_uri(png)})\n"
        )
        doc_convert.convert_files(["doc.docx"])
        assert (scan_root / "doc" / "doc_img1.png").exists()
        assert (scan_root / "doc" / "doc_img2.png").exists()

        # Edit source and reconvert — only one image this time.
        _write_source(scan_root, "doc.docx", b"v2")
        fake_markitdown.outputs[str(scan_root / "doc.docx")] = (
            f"![a]({_make_data_uri(png)})\n"
        )
        doc_convert.convert_files(["doc.docx"])

        # img1 kept, img2 cleaned up as orphan.
        assert (scan_root / "doc" / "doc_img1.png").exists()
        assert not (scan_root / "doc" / "doc_img2.png").exists()

    def test_no_header_no_orphan_cleanup(
        self, doc_convert, scan_root, fake_markitdown
    ):
        """Conflict files (no header) are overwritten without cleanup.

        The previous content wasn't ours to manage, so we don't
        touch any sibling files — user may have put things in
        the assets subdir by hand.
        """
        _write_source(scan_root, "doc.docx", b"x")
        # Pre-existing assets subdir with a file we didn't create.
        (scan_root / "doc").mkdir()
        stranger = scan_root / "doc" / "user_file.png"
        stranger.write_bytes(b"stranger content")
        # Pre-existing output with no header.
        (scan_root / "doc.md").write_text(
            "# Manual\n\nNo docuvert header.\n",
            encoding="utf-8",
        )
        fake_markitdown.outputs[str(scan_root / "doc.docx")] = "body\n"
        doc_convert.convert_files(["doc.docx"])
        # Stranger file still present.
        assert stranger.exists()

    def test_assets_dir_removed_when_fully_orphaned(
        self, doc_convert, scan_root, fake_markitdown
    ):
        """If every image is an orphan and none are produced, the
        assets dir is removed."""
        _write_source(scan_root, "doc.docx", b"v1")
        png = _make_png_bytes()
        fake_markitdown.outputs[str(scan_root / "doc.docx")] = (
            f"![a]({_make_data_uri(png)})\n"
        )
        doc_convert.convert_files(["doc.docx"])
        assert (scan_root / "doc").is_dir()

        # Reconvert with no images.
        _write_source(scan_root, "doc.docx", b"v2")
        fake_markitdown.outputs[str(scan_root / "doc.docx")] = "text only\n"
        doc_convert.convert_files(["doc.docx"])
        assert not (scan_root / "doc").exists()