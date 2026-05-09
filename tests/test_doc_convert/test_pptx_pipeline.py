"""pptx pipeline tests — Pass A4 (python-pptx fallback).

These tests pin the python-pptx fallback path used when
LibreOffice is unavailable. The ``force_pptx_fallback`` fixture
stubs out ``shutil.which`` so soffice appears absent regardless
of the host environment, letting the same tests run on
LibreOffice-equipped CI machines.

The primary LibreOffice + PyMuPDF path lives in
``test_libreoffice_pipeline.py``.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from ._helpers import (
    _make_png_bytes,
    _make_pptx_with_image,
    _make_pptx_with_n_slides,
    _make_pptx_with_table,
    _make_pptx_with_title,
    _require_pptx,
    _write_source,
)


@pytest.mark.usefixtures("force_pptx_fallback")
class TestPptxDispatch:
    """Basic routing — pptx goes to python-pptx, not markitdown."""

    def test_pptx_routes_to_python_pptx(
        self, doc_convert, scan_root, fake_markitdown
    ):
        _require_pptx()
        pptx_path = scan_root / "deck.pptx"
        _make_pptx_with_title(pptx_path, "Hello")
        result = doc_convert.convert_files(["deck.pptx"])
        [entry] = result["results"]
        assert entry["status"] == "ok"

    def test_pptx_produces_index_markdown(
        self, doc_convert, scan_root
    ):
        _require_pptx()
        _make_pptx_with_title(scan_root / "deck.pptx", "Intro")
        doc_convert.convert_files(["deck.pptx"])
        output = scan_root / "deck.md"
        assert output.is_file()

    def test_pptx_produces_assets_subdirectory(
        self, doc_convert, scan_root
    ):
        _require_pptx()
        _make_pptx_with_title(scan_root / "deck.pptx", "Intro")
        doc_convert.convert_files(["deck.pptx"])
        assets_dir = scan_root / "deck"
        assert assets_dir.is_dir()

    def test_pptx_header_has_provenance(
        self, doc_convert, scan_root
    ):
        _require_pptx()
        _make_pptx_with_title(scan_root / "deck.pptx", "Intro")
        doc_convert.convert_files(["deck.pptx"])
        content = (scan_root / "deck.md").read_text(encoding="utf-8")
        assert content.startswith("<!-- docuvert:")
        assert "source=deck.pptx" in content
        assert "sha256=" in content

    def test_pptx_scan_current_after_conversion(
        self, doc_convert, scan_root
    ):
        _require_pptx()
        _make_pptx_with_title(scan_root / "deck.pptx", "Intro")
        doc_convert.convert_files(["deck.pptx"])
        scan = doc_convert.scan_convertible_files()
        [entry] = scan
        assert entry["status"] == "current"


@pytest.mark.usefixtures("force_pptx_fallback")
class TestPptxSlideFiles:
    """Per-slide SVG file creation and naming."""

    def test_single_slide_produces_one_svg(
        self, doc_convert, scan_root
    ):
        _require_pptx()
        _make_pptx_with_title(scan_root / "deck.pptx", "Only slide")
        doc_convert.convert_files(["deck.pptx"])
        svgs = list((scan_root / "deck").glob("*.svg"))
        assert len(svgs) == 1
        assert svgs[0].name == "01_slide.svg"

    def test_multiple_slides_zero_padded(
        self, doc_convert, scan_root
    ):
        _require_pptx()
        _make_pptx_with_n_slides(scan_root / "deck.pptx", 3)
        doc_convert.convert_files(["deck.pptx"])
        svgs = sorted(p.name for p in (scan_root / "deck").glob("*.svg"))
        assert svgs == ["01_slide.svg", "02_slide.svg", "03_slide.svg"]

    def test_large_deck_pads_width(
        self, doc_convert, scan_root
    ):
        """A deck > 99 slides pads to 3 digits."""
        _require_pptx()
        # 100 slides is slow but still fast enough for a test.
        _make_pptx_with_n_slides(scan_root / "deck.pptx", 100)
        doc_convert.convert_files(["deck.pptx"])
        svgs = sorted(p.name for p in (scan_root / "deck").glob("*.svg"))
        assert len(svgs) == 100
        # First slide padded to 3 digits.
        assert svgs[0] == "001_slide.svg"
        # Last slide has no leading zero beyond the width.
        assert svgs[-1] == "100_slide.svg"

    def test_images_listed_in_provenance_header(
        self, doc_convert, scan_root
    ):
        _require_pptx()
        _make_pptx_with_n_slides(scan_root / "deck.pptx", 2)
        doc_convert.convert_files(["deck.pptx"])
        content = (scan_root / "deck.md").read_text(encoding="utf-8")
        assert "images=01_slide.svg,02_slide.svg" in content


@pytest.mark.usefixtures("force_pptx_fallback")
class TestPptxIndexMarkdown:
    """Structure of the index markdown linking all slides."""

    def test_index_has_slide_heading(
        self, doc_convert, scan_root
    ):
        _require_pptx()
        _make_pptx_with_n_slides(scan_root / "deck.pptx", 2)
        doc_convert.convert_files(["deck.pptx"])
        content = (scan_root / "deck.md").read_text(encoding="utf-8")
        assert "## Slide 1" in content
        assert "## Slide 2" in content

    def test_index_has_image_references(
        self, doc_convert, scan_root
    ):
        _require_pptx()
        _make_pptx_with_n_slides(scan_root / "deck.pptx", 2)
        doc_convert.convert_files(["deck.pptx"])
        content = (scan_root / "deck.md").read_text(encoding="utf-8")
        assert "![Slide 1](deck/01_slide.svg)" in content
        assert "![Slide 2](deck/02_slide.svg)" in content

    def test_empty_presentation_placeholder(
        self, doc_convert, scan_root, fake_markitdown
    ):
        """A pptx with no slides produces a placeholder output."""
        _require_pptx()
        from pptx import Presentation
        prs = Presentation()  # no slides added
        prs.save(str(scan_root / "empty.pptx"))
        result = doc_convert.convert_files(["empty.pptx"])
        [entry] = result["results"]
        assert entry["status"] == "ok"
        content = (scan_root / "empty.md").read_text(encoding="utf-8")
        assert "empty presentation" in content.lower()


@pytest.mark.usefixtures("force_pptx_fallback")
class TestPptxSvgContent:
    """SVG content — text, images, tables."""

    def test_title_text_appears_in_svg(
        self, doc_convert, scan_root
    ):
        _require_pptx()
        _make_pptx_with_title(
            scan_root / "deck.pptx",
            "Architecture Review",
            body="Key insights below",
        )
        doc_convert.convert_files(["deck.pptx"])
        svg_content = (
            scan_root / "deck" / "01_slide.svg"
        ).read_text(encoding="utf-8")
        assert "Architecture Review" in svg_content
        assert "Key insights below" in svg_content

    def test_svg_has_valid_root(
        self, doc_convert, scan_root
    ):
        _require_pptx()
        _make_pptx_with_title(scan_root / "deck.pptx", "Title")
        doc_convert.convert_files(["deck.pptx"])
        svg_content = (
            scan_root / "deck" / "01_slide.svg"
        ).read_text(encoding="utf-8")
        assert svg_content.startswith("<svg")
        assert "xmlns=\"http://www.w3.org/2000/svg\"" in svg_content
        assert svg_content.rstrip().endswith("</svg>")

    def test_svg_has_viewbox(
        self, doc_convert, scan_root
    ):
        _require_pptx()
        _make_pptx_with_title(scan_root / "deck.pptx", "Title")
        doc_convert.convert_files(["deck.pptx"])
        svg_content = (
            scan_root / "deck" / "01_slide.svg"
        ).read_text(encoding="utf-8")
        assert "viewBox=" in svg_content

    def test_image_embedded_as_data_uri(
        self, doc_convert, scan_root
    ):
        _require_pptx()
        png = _make_png_bytes()
        _make_pptx_with_image(scan_root / "deck.pptx", png)
        doc_convert.convert_files(["deck.pptx"])
        svg_content = (
            scan_root / "deck" / "01_slide.svg"
        ).read_text(encoding="utf-8")
        # python-pptx re-saves PNG on add_picture, so we can't
        # compare exact bytes. But the data URI should be
        # present with an image MIME.
        assert "data:image/" in svg_content
        assert ";base64," in svg_content
        assert "<image" in svg_content

    def test_table_cells_rendered(
        self, doc_convert, scan_root
    ):
        _require_pptx()
        _make_pptx_with_table(scan_root / "deck.pptx")
        doc_convert.convert_files(["deck.pptx"])
        svg_content = (
            scan_root / "deck" / "01_slide.svg"
        ).read_text(encoding="utf-8")
        # Table cells should be rendered as text elements.
        for cell_text in ["header1", "header2", "a", "b", "c"]:
            assert cell_text in svg_content
        # At least one rect for cell borders.
        assert "<rect" in svg_content

    def test_special_characters_escaped(
        self, doc_convert, scan_root
    ):
        """Text containing < > & should be XML-escaped."""
        _require_pptx()
        _make_pptx_with_title(
            scan_root / "deck.pptx",
            "A & B < C > D",
        )
        doc_convert.convert_files(["deck.pptx"])
        svg_content = (
            scan_root / "deck" / "01_slide.svg"
        ).read_text(encoding="utf-8")
        # Literal unescaped chars would break XML parsing.
        assert "&amp;" in svg_content
        assert "&lt;" in svg_content
        assert "&gt;" in svg_content


@pytest.mark.usefixtures("force_pptx_fallback")
class TestPptxOrphanCleanup:
    """Reconversion removes stale slide SVGs."""

    def test_reconversion_with_fewer_slides_removes_orphans(
        self, doc_convert, scan_root
    ):
        _require_pptx()
        # Initial 3-slide deck.
        _make_pptx_with_n_slides(scan_root / "deck.pptx", 3)
        doc_convert.convert_files(["deck.pptx"])
        assert (scan_root / "deck" / "03_slide.svg").exists()

        # Re-save with 1 slide.
        _make_pptx_with_n_slides(scan_root / "deck.pptx", 1)
        doc_convert.convert_files(["deck.pptx"])

        # Only 01 remains.
        assert (scan_root / "deck" / "01_slide.svg").exists()
        assert not (scan_root / "deck" / "02_slide.svg").exists()
        assert not (scan_root / "deck" / "03_slide.svg").exists()


class TestPptxFailures:
    """python-pptx missing, corrupt file.

    These tests exercise the FALLBACK path — they monkeypatch
    `shutil.which` to return None so the LibreOffice dispatch
    bypasses its primary path and falls back to python-pptx.
    Without this stub the tests would require LibreOffice NOT
    to be installed in the test environment, which isn't
    portable across CI.
    """

    def test_missing_python_pptx_returns_error(
        self, doc_convert, scan_root, monkeypatch
    ):
        """Without python-pptx installed, pptx conversion errors."""
        import sys
        _write_source(scan_root, "deck.pptx", b"fake pptx")
        # Force the LibreOffice path to bypass — pretend soffice
        # isn't available.
        monkeypatch.setattr(
            "ac_dc.doc_convert.shutil.which",
            lambda cmd: None,
        )
        monkeypatch.delitem(sys.modules, "pptx", raising=False)
        # Also need to block re-import.
        real_import = __builtins__["__import__"] if isinstance(
            __builtins__, dict
        ) else __builtins__.__import__

        def blocking_import(name, *args, **kwargs):
            if name == "pptx" or name.startswith("pptx."):
                raise ImportError("python-pptx not installed")
            return real_import(name, *args, **kwargs)

        monkeypatch.setattr("builtins.__import__", blocking_import)
        result = doc_convert.convert_files(["deck.pptx"])
        [entry] = result["results"]
        assert entry["status"] == "error"
        assert "python-pptx" in entry["message"]

    def test_corrupt_pptx_errors(
        self, doc_convert, scan_root, monkeypatch
    ):
        """A non-pptx file errors rather than crashing."""
        _require_pptx()
        # Force the LibreOffice path to bypass so we hit the
        # python-pptx fallback which will fail on corrupt input.
        monkeypatch.setattr(
            "ac_dc.doc_convert.shutil.which",
            lambda cmd: None,
        )
        _write_source(scan_root, "corrupt.pptx", b"not a real pptx")
        result = doc_convert.convert_files(["corrupt.pptx"])
        [entry] = result["results"]
        assert entry["status"] == "error"