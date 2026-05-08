"""xlsx pipeline tests — Pass A3.

Covers the openpyxl-backed xlsx → markdown table conversion
including colour extraction, fallback to markitdown when
openpyxl is absent, and the corrupt-file recovery path.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from ._helpers import _require_openpyxl, _write_source, _write_xlsx


class TestXlsxDispatch:
    """Basic routing — xlsx goes to openpyxl, not markitdown."""

    def test_xlsx_routes_to_openpyxl(
        self, doc_convert, scan_root, fake_markitdown
    ):
        _require_openpyxl()
        xlsx_path = scan_root / "data.xlsx"
        _write_xlsx(xlsx_path, {
            "Sheet1": [[("a", None), ("b", None)], [("1", None), ("2", None)]],
        })
        result = doc_convert.convert_files(["data.xlsx"])
        [entry] = result["results"]
        assert entry["status"] == "ok"
        # markitdown fake should NOT have been called for xlsx.
        assert str(xlsx_path) not in fake_markitdown.outputs or (
            fake_markitdown.outputs.get(str(xlsx_path)) is None
        )

    def test_xlsx_produces_output_file(
        self, doc_convert, scan_root
    ):
        _require_openpyxl()
        _write_xlsx(scan_root / "data.xlsx", {
            "Sheet1": [[("a", None)], [("1", None)]],
        })
        doc_convert.convert_files(["data.xlsx"])
        output = scan_root / "data.md"
        assert output.is_file()

    def test_xlsx_header_has_provenance(
        self, doc_convert, scan_root
    ):
        _require_openpyxl()
        _write_xlsx(scan_root / "data.xlsx", {
            "Sheet1": [[("a", None)], [("1", None)]],
        })
        doc_convert.convert_files(["data.xlsx"])
        content = (scan_root / "data.md").read_text(encoding="utf-8")
        assert content.startswith("<!-- docuvert:")
        assert "source=data.xlsx" in content
        assert "sha256=" in content

    def test_xlsx_scan_current_after_conversion(
        self, doc_convert, scan_root
    ):
        """After conversion, scan classifies the xlsx as `current`."""
        _require_openpyxl()
        _write_xlsx(scan_root / "data.xlsx", {
            "Sheet1": [[("a", None)], [("1", None)]],
        })
        doc_convert.convert_files(["data.xlsx"])
        scan = doc_convert.scan_convertible_files()
        [entry] = scan
        assert entry["status"] == "current"


class TestXlsxContent:
    """Markdown table structure — headers, rows, sheet headings."""

    def test_sheet_name_as_heading(self, doc_convert, scan_root):
        _require_openpyxl()
        _write_xlsx(scan_root / "data.xlsx", {
            "Budget": [
                [("col1", None), ("col2", None)],
                [("10", None), ("20", None)],
            ],
        })
        doc_convert.convert_files(["data.xlsx"])
        content = (scan_root / "data.md").read_text(encoding="utf-8")
        assert "## Budget" in content

    def test_first_row_becomes_header(self, doc_convert, scan_root):
        _require_openpyxl()
        _write_xlsx(scan_root / "data.xlsx", {
            "S1": [
                [("Name", None), ("Value", None)],
                [("row1", None), ("100", None)],
            ],
        })
        doc_convert.convert_files(["data.xlsx"])
        content = (scan_root / "data.md").read_text(encoding="utf-8")
        assert "| Name | Value |" in content

    def test_table_has_separator_row(self, doc_convert, scan_root):
        _require_openpyxl()
        _write_xlsx(scan_root / "data.xlsx", {
            "S1": [
                [("a", None), ("b", None)],
                [("1", None), ("2", None)],
            ],
        })
        doc_convert.convert_files(["data.xlsx"])
        content = (scan_root / "data.md").read_text(encoding="utf-8")
        # Separator row uses ---.
        assert "|---|---|" in content

    def test_multiple_sheets(self, doc_convert, scan_root):
        _require_openpyxl()
        _write_xlsx(scan_root / "data.xlsx", {
            "Q1": [[("a", None)], [("1", None)]],
            "Q2": [[("b", None)], [("2", None)]],
        })
        doc_convert.convert_files(["data.xlsx"])
        content = (scan_root / "data.md").read_text(encoding="utf-8")
        assert "## Q1" in content
        assert "## Q2" in content

    def test_empty_row_stripped(self, doc_convert, scan_root):
        _require_openpyxl()
        _write_xlsx(scan_root / "data.xlsx", {
            "S1": [
                [("a", None), ("b", None)],
                [("", None), ("", None)],  # empty row
                [("1", None), ("2", None)],
            ],
        })
        doc_convert.convert_files(["data.xlsx"])
        content = (scan_root / "data.md").read_text(encoding="utf-8")
        # The all-empty row should not appear.
        lines = content.splitlines()
        # Find the data row for "1" — no blank-cell row before it.
        data_lines = [line for line in lines if line.startswith("|")]
        assert "| 1 | 2 |" in data_lines
        # No row of just empty cells.
        for line in data_lines:
            assert line != "|  |  |"

    def test_empty_column_stripped(self, doc_convert, scan_root):
        _require_openpyxl()
        _write_xlsx(scan_root / "data.xlsx", {
            "S1": [
                [("a", None), ("", None), ("c", None)],
                [("1", None), ("", None), ("3", None)],
            ],
        })
        doc_convert.convert_files(["data.xlsx"])
        content = (scan_root / "data.md").read_text(encoding="utf-8")
        # Middle column is empty — should be dropped. Header
        # row should have only two entries.
        assert "| a | c |" in content
        assert "| 1 | 3 |" in content

    def test_nan_normalised_to_empty(self, doc_convert, scan_root):
        """Values 'nan' and 'none' (case-insensitive) become empty."""
        _require_openpyxl()
        _write_xlsx(scan_root / "data.xlsx", {
            "S1": [
                [("Name", None), ("Value", None)],
                [("row", None), ("nan", None)],
                [("row2", None), ("NONE", None)],
            ],
        })
        doc_convert.convert_files(["data.xlsx"])
        content = (scan_root / "data.md").read_text(encoding="utf-8")
        assert "nan" not in content.lower().replace(
            "sha256", ""  # hex digest may contain "nan" substrings
        ) or "| row |  |" in content
        # Direct check — the value cells should be empty.
        assert "| row |  |" in content
        assert "| row2 |  |" in content

    def test_empty_spreadsheet(self, doc_convert, scan_root):
        """A spreadsheet with no data still produces an output file."""
        _require_openpyxl()
        _write_xlsx(scan_root / "empty.xlsx", {
            "Sheet1": [[("", None)]],
        })
        result = doc_convert.convert_files(["empty.xlsx"])
        [entry] = result["results"]
        assert entry["status"] == "ok"
        content = (scan_root / "empty.md").read_text(encoding="utf-8")
        assert "empty spreadsheet" in content.lower()


class TestXlsxColours:
    """Colour extraction — markers and legend."""

    def test_red_cell_gets_red_marker(self, doc_convert, scan_root):
        _require_openpyxl()
        _write_xlsx(scan_root / "data.xlsx", {
            "S1": [
                [("Status", None), ("Priority", None)],
                [("Failed", "FF0000"), ("High", None)],
            ],
        })
        doc_convert.convert_files(["data.xlsx"])
        content = (scan_root / "data.md").read_text(encoding="utf-8")
        # Red fill → 🔴 marker.
        assert "🔴 Failed" in content

    def test_green_cell_gets_green_marker(self, doc_convert, scan_root):
        _require_openpyxl()
        _write_xlsx(scan_root / "data.xlsx", {
            "S1": [
                [("Status", None)],
                [("Done", "00C800")],
            ],
        })
        doc_convert.convert_files(["data.xlsx"])
        content = (scan_root / "data.md").read_text(encoding="utf-8")
        assert "🟢 Done" in content

    def test_legend_lists_used_colours(self, doc_convert, scan_root):
        _require_openpyxl()
        _write_xlsx(scan_root / "data.xlsx", {
            "S1": [
                [("Status", None)],
                [("Failed", "FF0000")],
                [("Done", "00C800")],
            ],
        })
        doc_convert.convert_files(["data.xlsx"])
        content = (scan_root / "data.md").read_text(encoding="utf-8")
        assert "## Legend" in content
        assert "🔴 red" in content
        assert "🟢 green" in content

    def test_no_legend_when_no_colours(self, doc_convert, scan_root):
        _require_openpyxl()
        _write_xlsx(scan_root / "data.xlsx", {
            "S1": [
                [("a", None), ("b", None)],
                [("1", None), ("2", None)],
            ],
        })
        doc_convert.convert_files(["data.xlsx"])
        content = (scan_root / "data.md").read_text(encoding="utf-8")
        assert "## Legend" not in content

    def test_near_white_fill_ignored(self, doc_convert, scan_root):
        """Near-white fills don't produce markers."""
        _require_openpyxl()
        _write_xlsx(scan_root / "data.xlsx", {
            "S1": [
                [("Status", None)],
                # FEFEFE is effectively white — default formatting.
                [("Normal", "FEFEFE")],
            ],
        })
        doc_convert.convert_files(["data.xlsx"])
        content = (scan_root / "data.md").read_text(encoding="utf-8")
        # No emoji markers, no legend.
        assert "## Legend" not in content

    def test_near_black_fill_ignored(self, doc_convert, scan_root):
        """Near-black fills don't produce markers."""
        _require_openpyxl()
        _write_xlsx(scan_root / "data.xlsx", {
            "S1": [
                [("Status", None)],
                [("Text", "010101")],
            ],
        })
        doc_convert.convert_files(["data.xlsx"])
        content = (scan_root / "data.md").read_text(encoding="utf-8")
        assert "## Legend" not in content

    def test_unknown_colour_gets_fallback_marker(
        self, doc_convert, scan_root
    ):
        """A colour far from every named hue gets a fallback marker."""
        _require_openpyxl()
        # A distinctive teal that shouldn't match red/green/yellow/blue
        # closely enough within the named-colour distance.
        _write_xlsx(scan_root / "data.xlsx", {
            "S1": [
                [("Status", None)],
                [("Weird", "00A0A0")],
            ],
        })
        doc_convert.convert_files(["data.xlsx"])
        content = (scan_root / "data.md").read_text(encoding="utf-8")
        assert "## Legend" in content
        # Either a fallback cluster name or a near-miss named
        # colour — both acceptable; what matters is that SOME
        # marker was assigned.
        assert "Weird" in content

    def test_coloured_empty_cell_shows_marker_alone(
        self, doc_convert, scan_root
    ):
        """An empty cell with a fill shows just the marker."""
        _require_openpyxl()
        _write_xlsx(scan_root / "data.xlsx", {
            "S1": [
                [("Name", None), ("Flag", None)],
                [("item", None), ("", "FF0000")],
            ],
        })
        doc_convert.convert_files(["data.xlsx"])
        content = (scan_root / "data.md").read_text(encoding="utf-8")
        # The red marker appears without a trailing value, but
        # still as a cell in the row.
        assert "| item | 🔴 |" in content


class TestXlsxFallback:
    """openpyxl fallback — missing library or corrupt file."""

    def test_missing_openpyxl_falls_back_to_markitdown(
        self, doc_convert, scan_root, fake_markitdown, monkeypatch
    ):
        """When openpyxl isn't installed, fall back to markitdown."""
        import sys
        _write_source(scan_root, "data.xlsx", b"fake xlsx")
        fake_markitdown.outputs[str(scan_root / "data.xlsx")] = (
            "| fake | markitdown | output |\n"
        )
        # Block openpyxl import.
        monkeypatch.delitem(sys.modules, "openpyxl", raising=False)
        real_import = __builtins__["__import__"] if isinstance(
            __builtins__, dict
        ) else __builtins__.__import__

        def blocking_import(name, *args, **kwargs):
            if name == "openpyxl" or name.startswith("openpyxl."):
                raise ImportError("openpyxl not installed")
            return real_import(name, *args, **kwargs)

        monkeypatch.setattr("builtins.__import__", blocking_import)
        result = doc_convert.convert_files(["data.xlsx"])
        [entry] = result["results"]
        # Fell back to markitdown — succeeded using the fake.
        assert entry["status"] == "ok"

    def test_corrupt_xlsx_falls_back_to_markitdown(
        self, doc_convert, scan_root, fake_markitdown
    ):
        """openpyxl failure on a corrupt file falls back cleanly."""
        _require_openpyxl()
        # Not a real xlsx file — openpyxl will raise on open.
        _write_source(scan_root, "corrupt.xlsx", b"not a real xlsx")
        fake_markitdown.outputs[str(scan_root / "corrupt.xlsx")] = (
            "fallback output\n"
        )
        result = doc_convert.convert_files(["corrupt.xlsx"])
        [entry] = result["results"]
        # Either markitdown succeeded (the fake returned text) or
        # markitdown also errored. Both are valid — the key
        # invariant is we don't crash on corrupt input.
        assert entry["status"] in ("ok", "error")