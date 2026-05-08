"""LibreOffice + PyMuPDF pipeline tests — Pass A5b.

These tests exercise the LibreOffice dispatch without requiring
LibreOffice to actually be installed. We monkeypatch
`subprocess.run` and the `shutil.which` availability probe to
simulate various outcomes: success, timeout, non-zero exit,
missing output, and the fallback paths when dependencies are
absent.

The "real" LibreOffice path is tested end-to-end only when
soffice is present on PATH (skipped otherwise) — that test
uses a real pptx and exercises the full LibreOffice invocation.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from ._helpers import (
    _make_pptx_with_title,
    _require_pptx,
    _require_pymupdf,
    _write_source,
)


class TestLibreOfficeDispatch:
    """Extension routing through the LibreOffice pipeline."""

    def test_pptx_routes_to_libreoffice_when_available(
        self, doc_convert, scan_root, monkeypatch
    ):
        """pptx tries LibreOffice first when soffice is on PATH."""
        import subprocess
        calls: list[list[str]] = []

        def fake_run(cmd, **kwargs):
            calls.append(cmd)
            # Write a fake PDF to the --outdir location so the
            # caller finds it and proceeds. We don't care about
            # PDF validity — the PyMuPDF mock below handles that.
            outdir_idx = cmd.index("--outdir") + 1
            outdir = Path(cmd[outdir_idx])
            source_path = Path(cmd[-1])
            pdf_path = outdir / (source_path.stem + ".pdf")
            pdf_path.write_bytes(b"fake pdf content")
            return subprocess.CompletedProcess(
                args=cmd, returncode=0, stdout="", stderr=""
            )

        monkeypatch.setattr(
            "ac_dc.doc_convert.shutil.which",
            lambda cmd: "/usr/bin/soffice" if cmd == "soffice" else None,
        )
        monkeypatch.setattr("subprocess.run", fake_run)
        # Stub PyMuPDF open to fail cleanly so we don't need to
        # produce a real PDF — the test only verifies dispatch.
        _require_pymupdf()
        import fitz as _fitz  # noqa: F401 — only checking import
        _make_pptx_with_title(scan_root / "deck.pptx", "Title")

        result = doc_convert.convert_files(["deck.pptx"])
        # LibreOffice was called.
        assert len(calls) == 1
        assert calls[0][0] == "/usr/bin/soffice"
        assert "--headless" in calls[0]
        assert "--convert-to" in calls[0]
        assert "pdf" in calls[0]
        # PyMuPDF fails on the fake PDF — result is an error,
        # but the important thing is LibreOffice WAS called.
        [entry] = result["results"]
        assert entry["status"] == "error"

    def test_odp_routes_to_libreoffice_when_available(
        self, doc_convert, scan_root, monkeypatch
    ):
        """odp tries LibreOffice first when soffice is on PATH."""
        import subprocess
        calls: list[list[str]] = []

        def fake_run(cmd, **kwargs):
            calls.append(cmd)
            outdir_idx = cmd.index("--outdir") + 1
            outdir = Path(cmd[outdir_idx])
            source_path = Path(cmd[-1])
            pdf_path = outdir / (source_path.stem + ".pdf")
            pdf_path.write_bytes(b"fake pdf")
            return subprocess.CompletedProcess(
                args=cmd, returncode=0, stdout="", stderr=""
            )

        monkeypatch.setattr(
            "ac_dc.doc_convert.shutil.which",
            lambda cmd: "/usr/bin/soffice" if cmd == "soffice" else None,
        )
        monkeypatch.setattr("subprocess.run", fake_run)
        _write_source(scan_root, "deck.odp", b"fake odp")

        doc_convert.convert_files(["deck.odp"])
        assert len(calls) == 1
        # Source path (last arg) ends with .odp.
        assert calls[0][-1].endswith("deck.odp")


class TestLibreOfficeFallback:
    """Fallback paths when LibreOffice isn't usable."""

    def test_no_soffice_pptx_falls_back_to_python_pptx(
        self, doc_convert, scan_root, monkeypatch
    ):
        """pptx falls back to python-pptx when soffice missing."""
        _require_pptx()
        # soffice not on PATH.
        monkeypatch.setattr(
            "ac_dc.doc_convert.shutil.which",
            lambda cmd: None,
        )
        _make_pptx_with_title(scan_root / "deck.pptx", "Title")
        result = doc_convert.convert_files(["deck.pptx"])
        [entry] = result["results"]
        # python-pptx fallback succeeds — the usual pptx output.
        assert entry["status"] == "ok"
        # Per-slide SVG characteristic of the python-pptx path.
        assert (scan_root / "deck" / "01_slide.svg").is_file()

    def test_no_soffice_odp_falls_back_to_markitdown(
        self, doc_convert, scan_root, fake_markitdown, monkeypatch
    ):
        """odp falls back to markitdown when soffice missing."""
        monkeypatch.setattr(
            "ac_dc.doc_convert.shutil.which",
            lambda cmd: None,
        )
        _write_source(scan_root, "deck.odp", b"fake odp")
        fake_markitdown.outputs[str(scan_root / "deck.odp")] = (
            "odp as markdown\n"
        )
        result = doc_convert.convert_files(["deck.odp"])
        [entry] = result["results"]
        assert entry["status"] == "ok"
        content = (scan_root / "deck.md").read_text(encoding="utf-8")
        assert "odp as markdown" in content

    def test_timeout_falls_back(
        self, doc_convert, scan_root, monkeypatch
    ):
        """LibreOffice timeout falls back rather than erroring."""
        _require_pptx()
        import subprocess

        def fake_run(cmd, **kwargs):
            raise subprocess.TimeoutExpired(cmd, timeout=120)

        monkeypatch.setattr(
            "ac_dc.doc_convert.shutil.which",
            lambda cmd: "/usr/bin/soffice" if cmd == "soffice" else None,
        )
        monkeypatch.setattr("subprocess.run", fake_run)
        _make_pptx_with_title(scan_root / "deck.pptx", "Title")
        result = doc_convert.convert_files(["deck.pptx"])
        [entry] = result["results"]
        # Falls back to python-pptx which succeeds.
        assert entry["status"] == "ok"
        assert (scan_root / "deck" / "01_slide.svg").is_file()

    def test_nonzero_exit_falls_back(
        self, doc_convert, scan_root, monkeypatch
    ):
        """Non-zero soffice exit falls back to python-pptx."""
        _require_pptx()
        import subprocess

        def fake_run(cmd, **kwargs):
            return subprocess.CompletedProcess(
                args=cmd, returncode=1,
                stdout="", stderr="conversion failed",
            )

        monkeypatch.setattr(
            "ac_dc.doc_convert.shutil.which",
            lambda cmd: "/usr/bin/soffice" if cmd == "soffice" else None,
        )
        monkeypatch.setattr("subprocess.run", fake_run)
        _make_pptx_with_title(scan_root / "deck.pptx", "Title")
        result = doc_convert.convert_files(["deck.pptx"])
        [entry] = result["results"]
        assert entry["status"] == "ok"
        assert (scan_root / "deck" / "01_slide.svg").is_file()

    def test_missing_output_pdf_falls_back(
        self, doc_convert, scan_root, monkeypatch
    ):
        """LibreOffice succeeds but produces no PDF → fallback."""
        _require_pptx()
        import subprocess

        def fake_run(cmd, **kwargs):
            # Don't write any output — simulates weird template
            # that makes soffice produce no file despite 0 exit.
            return subprocess.CompletedProcess(
                args=cmd, returncode=0, stdout="", stderr=""
            )

        monkeypatch.setattr(
            "ac_dc.doc_convert.shutil.which",
            lambda cmd: "/usr/bin/soffice" if cmd == "soffice" else None,
        )
        monkeypatch.setattr("subprocess.run", fake_run)
        _make_pptx_with_title(scan_root / "deck.pptx", "Title")
        result = doc_convert.convert_files(["deck.pptx"])
        [entry] = result["results"]
        assert entry["status"] == "ok"
        assert (scan_root / "deck" / "01_slide.svg").is_file()

    def test_no_pymupdf_falls_back(
        self, doc_convert, scan_root, monkeypatch
    ):
        """Missing PyMuPDF falls back even when soffice available."""
        _require_pptx()
        monkeypatch.setattr(
            "ac_dc.doc_convert.shutil.which",
            lambda cmd: "/usr/bin/soffice" if cmd == "soffice" else None,
        )
        # Make the PyMuPDF probe report False.
        monkeypatch.setattr(
            "ac_dc.doc_convert.DocConvert._probe_import",
            lambda self, name: False,
        )
        _make_pptx_with_title(scan_root / "deck.pptx", "Title")
        result = doc_convert.convert_files(["deck.pptx"])
        [entry] = result["results"]
        assert entry["status"] == "ok"
        assert (scan_root / "deck" / "01_slide.svg").is_file()


class TestLibreOfficeProvenance:
    """Provenance header correctness when routing through LibreOffice."""

    def test_header_uses_original_filename(
        self, doc_convert, scan_root, monkeypatch
    ):
        """Provenance records source=deck.pptx, not source=deck.pdf."""
        _require_pymupdf()
        import subprocess

        # Make soffice produce a minimal valid PDF using PyMuPDF.
        import fitz

        def fake_run(cmd, **kwargs):
            outdir_idx = cmd.index("--outdir") + 1
            outdir = Path(cmd[outdir_idx])
            source_path = Path(cmd[-1])
            pdf_path = outdir / (source_path.stem + ".pdf")
            doc = fitz.open()
            page = doc.new_page()
            page.insert_text((72, 72), "Converted content", fontsize=12)
            doc.save(str(pdf_path))
            doc.close()
            return subprocess.CompletedProcess(
                args=cmd, returncode=0, stdout="", stderr=""
            )

        monkeypatch.setattr(
            "ac_dc.doc_convert.shutil.which",
            lambda cmd: "/usr/bin/soffice" if cmd == "soffice" else None,
        )
        monkeypatch.setattr("subprocess.run", fake_run)
        _write_source(scan_root, "deck.pptx", b"original pptx bytes")

        doc_convert.convert_files(["deck.pptx"])
        content = (scan_root / "deck.md").read_text(encoding="utf-8")
        # Provenance points at the ORIGINAL file, not the
        # intermediate PDF.
        assert "source=deck.pptx" in content
        assert "source=deck.pdf" not in content

    def test_hash_reflects_original_source(
        self, doc_convert, scan_root, monkeypatch
    ):
        """Hash is of the original pptx, not the intermediate PDF."""
        _require_pymupdf()
        import subprocess
        import hashlib
        import fitz

        original_content = b"specific pptx bytes for hash check"
        expected_hash = hashlib.sha256(original_content).hexdigest()

        def fake_run(cmd, **kwargs):
            outdir_idx = cmd.index("--outdir") + 1
            outdir = Path(cmd[outdir_idx])
            source_path = Path(cmd[-1])
            pdf_path = outdir / (source_path.stem + ".pdf")
            doc = fitz.open()
            doc.new_page()
            doc.save(str(pdf_path))
            doc.close()
            return subprocess.CompletedProcess(
                args=cmd, returncode=0, stdout="", stderr=""
            )

        monkeypatch.setattr(
            "ac_dc.doc_convert.shutil.which",
            lambda cmd: "/usr/bin/soffice" if cmd == "soffice" else None,
        )
        monkeypatch.setattr("subprocess.run", fake_run)
        _write_source(scan_root, "deck.pptx", original_content)

        doc_convert.convert_files(["deck.pptx"])
        content = (scan_root / "deck.md").read_text(encoding="utf-8")
        assert f"sha256={expected_hash}" in content

    def test_output_lands_next_to_original(
        self, doc_convert, scan_root, monkeypatch
    ):
        """Output .md is beside the source, not in the temp dir."""
        _require_pymupdf()
        import subprocess
        import fitz

        def fake_run(cmd, **kwargs):
            outdir_idx = cmd.index("--outdir") + 1
            outdir = Path(cmd[outdir_idx])
            source_path = Path(cmd[-1])
            pdf_path = outdir / (source_path.stem + ".pdf")
            doc = fitz.open()
            doc.new_page()
            doc.save(str(pdf_path))
            doc.close()
            return subprocess.CompletedProcess(
                args=cmd, returncode=0, stdout="", stderr=""
            )

        monkeypatch.setattr(
            "ac_dc.doc_convert.shutil.which",
            lambda cmd: "/usr/bin/soffice" if cmd == "soffice" else None,
        )
        monkeypatch.setattr("subprocess.run", fake_run)
        _write_source(scan_root, "docs/deck.pptx", b"x")

        doc_convert.convert_files(["docs/deck.pptx"])
        # Output at the expected sibling location.
        assert (scan_root / "docs" / "deck.md").is_file()

    def test_scan_current_after_libreoffice_conversion(
        self, doc_convert, scan_root, monkeypatch
    ):
        """After conversion, scan classifies pptx as `current`."""
        _require_pymupdf()
        import subprocess
        import fitz

        def fake_run(cmd, **kwargs):
            outdir_idx = cmd.index("--outdir") + 1
            outdir = Path(cmd[outdir_idx])
            source_path = Path(cmd[-1])
            pdf_path = outdir / (source_path.stem + ".pdf")
            doc = fitz.open()
            doc.new_page()
            doc.save(str(pdf_path))
            doc.close()
            return subprocess.CompletedProcess(
                args=cmd, returncode=0, stdout="", stderr=""
            )

        monkeypatch.setattr(
            "ac_dc.doc_convert.shutil.which",
            lambda cmd: "/usr/bin/soffice" if cmd == "soffice" else None,
        )
        monkeypatch.setattr("subprocess.run", fake_run)
        _write_source(scan_root, "deck.pptx", b"stable content")

        doc_convert.convert_files(["deck.pptx"])
        scan = doc_convert.scan_convertible_files()
        [entry] = scan
        assert entry["status"] == "current"


class TestLibreOfficeEndToEnd:
    """Full-pipeline test against real LibreOffice (when available)."""

    def test_real_libreoffice_converts_pptx(
        self, doc_convert, scan_root
    ):
        """Full round-trip when soffice is actually installed.

        Skipped when LibreOffice isn't on PATH. Ensures the
        mocked tests above aren't hiding a real-world issue with
        subprocess args, output path resolution, or format
        compatibility.
        """
        if shutil.which("soffice") is None:
            pytest.skip("LibreOffice (soffice) not installed")
        _require_pymupdf()
        _require_pptx()
        _make_pptx_with_title(
            scan_root / "deck.pptx",
            "Real LibreOffice Test",
            body="Body paragraph",
        )
        result = doc_convert.convert_files(["deck.pptx"])
        [entry] = result["results"]
        assert entry["status"] == "ok"
        content = (scan_root / "deck.md").read_text(encoding="utf-8")
        # Title text should survive the round-trip.
        assert "Real LibreOffice Test" in content
        # Provenance correctness.
        assert "source=deck.pptx" in content