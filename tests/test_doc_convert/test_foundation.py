"""Foundation tests for ``ac_dc.doc_convert.DocConvert``.

Covers the pieces that don't depend on a particular conversion
backend:

- Construction (holds config reference, collab starts None)
- Localhost-only guard
- ``is_available`` dependency probing
- ``scan_convertible_files`` (empty repo, extension filter,
  exclusions, status classification, entry shape, ordering)
- Provenance header parsing (``parse_provenance_body`` plus
  reading from a written file)
- Source hashing (``_hash_file``)

Pipeline-specific tests live in sibling modules.
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import hashlib

import pytest

from ac_dc.doc_convert import (
    DocConvert,
    ProvenanceHeader,
    _DEFAULT_EXTENSIONS,
    _EXCLUDED_DIRS,
)

from ._helpers import (
    _RaisingCollab,
    _StubCollab,
    _assert_restricted,
    _sha256_of,
    _write_output,
    _write_source,
)


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------


class TestConstruction:
    def test_holds_config_reference(self, config):
        svc = DocConvert(config)
        assert svc._config is config

    def test_collab_starts_none(self, doc_convert):
        assert doc_convert._collab is None

    def test_repo_optional(self, config):
        # No repo → uses CWD as root. Not great for production but
        # useful for tests and for "scan current directory" CLI-like
        # use cases.
        svc = DocConvert(config)
        assert svc._repo is None
        # Calling _root returns a Path — cannot guarantee specific
        # value since CWD varies across test runs.
        root = svc._root()
        assert isinstance(root, Path)


# ---------------------------------------------------------------------------
# Localhost-only guard
# ---------------------------------------------------------------------------


class TestLocalhostGuard:
    def test_no_collab_returns_none(self, doc_convert):
        assert doc_convert._check_localhost_only() is None

    def test_localhost_caller_returns_none(self, doc_convert):
        doc_convert._collab = _StubCollab(is_localhost=True)
        assert doc_convert._check_localhost_only() is None
        assert doc_convert._collab.call_count == 1

    def test_non_localhost_caller_returns_restricted(self, doc_convert):
        doc_convert._collab = _StubCollab(is_localhost=False)
        result = doc_convert._check_localhost_only()
        _assert_restricted(result)

    def test_raising_collab_fails_closed(self, doc_convert):
        doc_convert._collab = _RaisingCollab()
        result = doc_convert._check_localhost_only()
        _assert_restricted(result)


# ---------------------------------------------------------------------------
# is_available — dependency probing
# ---------------------------------------------------------------------------


class TestIsAvailable:
    def test_returns_all_four_flags(self, doc_convert):
        result = doc_convert.is_available()
        assert set(result.keys()) == {
            "available",
            "libreoffice",
            "pymupdf",
            "pdf_pipeline",
        }
        for value in result.values():
            assert isinstance(value, bool)

    def test_pdf_pipeline_requires_both_deps(self, doc_convert):
        """Truth table — pdf_pipeline = libreoffice AND pymupdf."""
        with patch.object(
            DocConvert, "_probe_import",
            side_effect=lambda name: {"markitdown": True, "fitz": True}.get(name, False),
        ), patch("ac_dc.doc_convert.shutil.which", return_value="/usr/bin/soffice"):
            result = doc_convert.is_available()
        assert result["pdf_pipeline"] is True

    def test_pdf_pipeline_false_without_libreoffice(self, doc_convert):
        with patch.object(
            DocConvert, "_probe_import",
            side_effect=lambda name: {"markitdown": True, "fitz": True}.get(name, False),
        ), patch("ac_dc.doc_convert.shutil.which", return_value=None):
            result = doc_convert.is_available()
        assert result["pymupdf"] is True
        assert result["libreoffice"] is False
        assert result["pdf_pipeline"] is False

    def test_pdf_pipeline_false_without_pymupdf(self, doc_convert):
        with patch.object(
            DocConvert, "_probe_import",
            side_effect=lambda name: {"markitdown": True, "fitz": False}.get(name, False),
        ), patch("ac_dc.doc_convert.shutil.which", return_value="/usr/bin/soffice"):
            result = doc_convert.is_available()
        assert result["libreoffice"] is True
        assert result["pymupdf"] is False
        assert result["pdf_pipeline"] is False

    def test_markitdown_missing_flags_unavailable(self, doc_convert):
        with patch.object(
            DocConvert, "_probe_import",
            side_effect=lambda name: False,
        ), patch("ac_dc.doc_convert.shutil.which", return_value=None):
            result = doc_convert.is_available()
        assert result["available"] is False

    def test_all_deps_missing(self, doc_convert):
        with patch.object(
            DocConvert, "_probe_import", return_value=False,
        ), patch("ac_dc.doc_convert.shutil.which", return_value=None):
            result = doc_convert.is_available()
        assert result == {
            "available": False,
            "libreoffice": False,
            "pymupdf": False,
            "pdf_pipeline": False,
        }

    def test_probe_import_catches_exception(self):
        """A raising import doesn't escape the probe."""
        with patch(
            "importlib.import_module",
            side_effect=RuntimeError("bad install"),
        ):
            assert DocConvert._probe_import("anything") is False

    def test_is_available_callable_when_disabled(
        self, doc_convert, isolated_config_dir
    ):
        """Disabled config doesn't affect availability probing."""
        # Disable via app config.
        app_json = isolated_config_dir / "app.json"
        data = json.loads(app_json.read_text(encoding="utf-8"))
        data["doc_convert"]["enabled"] = False
        app_json.write_text(json.dumps(data), encoding="utf-8")
        doc_convert._config.reload_app_config()
        # Should still return the capability dict, not refuse.
        result = doc_convert.is_available()
        assert "available" in result


# ---------------------------------------------------------------------------
# scan_convertible_files — empty case + basic structure
# ---------------------------------------------------------------------------


class TestScanEmpty:
    def test_empty_repo(self, doc_convert):
        assert doc_convert.scan_convertible_files() == []

    def test_disabled_returns_empty(
        self, doc_convert, isolated_config_dir, scan_root
    ):
        _write_source(scan_root, "doc.docx", b"fake docx bytes")
        app_json = isolated_config_dir / "app.json"
        data = json.loads(app_json.read_text(encoding="utf-8"))
        data["doc_convert"]["enabled"] = False
        app_json.write_text(json.dumps(data), encoding="utf-8")
        doc_convert._config.reload_app_config()
        assert doc_convert.scan_convertible_files() == []

    def test_missing_root_logs_and_returns_empty(
        self, config, tmp_path
    ):
        """A repo root that doesn't exist doesn't crash."""
        fake_repo = SimpleNamespace(root=tmp_path / "does-not-exist")
        svc = DocConvert(config, repo=fake_repo)
        assert svc.scan_convertible_files() == []


# ---------------------------------------------------------------------------
# scan_convertible_files — extension filtering
# ---------------------------------------------------------------------------


class TestScanExtensions:
    def test_default_extensions_recognised(self, doc_convert, scan_root):
        for ext in _DEFAULT_EXTENSIONS:
            _write_source(scan_root, f"doc{ext}", b"x")
        results = doc_convert.scan_convertible_files()
        found = {r["path"] for r in results}
        expected = {f"doc{ext}" for ext in _DEFAULT_EXTENSIONS}
        assert found == expected

    def test_non_convertible_extensions_ignored(self, doc_convert, scan_root):
        _write_source(scan_root, "script.py", b"code")
        _write_source(scan_root, "readme.md", b"docs")
        _write_source(scan_root, "real.docx", b"x")
        results = doc_convert.scan_convertible_files()
        paths = {r["path"] for r in results}
        assert paths == {"real.docx"}

    def test_case_insensitive_extension_match(self, doc_convert, scan_root):
        _write_source(scan_root, "UPPER.DOCX", b"x")
        _write_source(scan_root, "Mixed.PdF", b"x")
        results = doc_convert.scan_convertible_files()
        assert len(results) == 2

    def test_config_can_restrict_extensions(
        self, doc_convert, isolated_config_dir, scan_root
    ):
        _write_source(scan_root, "a.docx", b"x")
        _write_source(scan_root, "b.xlsx", b"x")
        _write_source(scan_root, "c.pdf", b"x")
        # Override to only .docx.
        app_json = isolated_config_dir / "app.json"
        data = json.loads(app_json.read_text(encoding="utf-8"))
        data["doc_convert"]["extensions"] = [".docx"]
        app_json.write_text(json.dumps(data), encoding="utf-8")
        doc_convert._config.reload_app_config()
        results = doc_convert.scan_convertible_files()
        paths = {r["path"] for r in results}
        assert paths == {"a.docx"}


# ---------------------------------------------------------------------------
# scan_convertible_files — directory exclusions
# ---------------------------------------------------------------------------


class TestScanExclusions:
    def test_git_directory_excluded(self, doc_convert, scan_root):
        _write_source(scan_root, ".git/info/stash.docx", b"x")
        _write_source(scan_root, "visible.docx", b"x")
        results = doc_convert.scan_convertible_files()
        paths = {r["path"] for r in results}
        assert paths == {"visible.docx"}

    def test_ac_dc_directory_excluded(self, doc_convert, scan_root):
        _write_source(scan_root, ".ac-dc4/history.docx", b"x")
        _write_source(scan_root, "visible.docx", b"x")
        results = doc_convert.scan_convertible_files()
        assert {r["path"] for r in results} == {"visible.docx"}

    def test_node_modules_excluded(self, doc_convert, scan_root):
        _write_source(scan_root, "node_modules/pkg/README.docx", b"x")
        _write_source(scan_root, "docs/real.docx", b"x")
        results = doc_convert.scan_convertible_files()
        assert {r["path"] for r in results} == {"docs/real.docx"}

    def test_hidden_dirs_excluded_except_github(
        self, doc_convert, scan_root
    ):
        _write_source(scan_root, ".vscode/settings.docx", b"x")
        _write_source(scan_root, ".github/docs/ci.docx", b"x")
        _write_source(scan_root, "visible.docx", b"x")
        results = doc_convert.scan_convertible_files()
        paths = {r["path"] for r in results}
        # .vscode excluded; .github allowed; visible present.
        assert ".vscode/settings.docx" not in paths
        # Normalise separator for cross-platform.
        assert ".github/docs/ci.docx" in paths
        assert "visible.docx" in paths

    def test_all_excluded_dirs_enumerated(self, doc_convert, scan_root):
        """Smoke-test every name in _EXCLUDED_DIRS."""
        for name in _EXCLUDED_DIRS:
            _write_source(scan_root, f"{name}/trapped.docx", b"x")
        _write_source(scan_root, "visible.docx", b"x")
        results = doc_convert.scan_convertible_files()
        assert {r["path"] for r in results} == {"visible.docx"}


# ---------------------------------------------------------------------------
# scan_convertible_files — status classification matrix
# ---------------------------------------------------------------------------


class TestScanStatusClassification:
    def test_new_when_no_output(self, doc_convert, scan_root):
        _write_source(scan_root, "doc.docx", b"content")
        [entry] = doc_convert.scan_convertible_files()
        assert entry["status"] == "new"

    def test_conflict_when_output_has_no_header(
        self, doc_convert, scan_root
    ):
        _write_source(scan_root, "doc.docx", b"content")
        _write_output(scan_root, "doc.md", provenance=None)
        [entry] = doc_convert.scan_convertible_files()
        assert entry["status"] == "conflict"

    def test_current_when_hash_matches(self, doc_convert, scan_root):
        content = b"stable content"
        _write_source(scan_root, "doc.docx", content)
        sha = _sha256_of(content)
        _write_output(
            scan_root, "doc.md",
            provenance=f"source=doc.docx sha256={sha}",
        )
        [entry] = doc_convert.scan_convertible_files()
        assert entry["status"] == "current"

    def test_stale_when_hash_differs(self, doc_convert, scan_root):
        _write_source(scan_root, "doc.docx", b"new content")
        _write_output(
            scan_root, "doc.md",
            provenance=(
                "source=doc.docx sha256="
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            ),
        )
        [entry] = doc_convert.scan_convertible_files()
        assert entry["status"] == "stale"

    def test_conflict_takes_precedence_over_hash_check(
        self, doc_convert, scan_root
    ):
        """A file without a docuvert header is conflict regardless of
        whether a hash check would pass or fail."""
        _write_source(scan_root, "doc.docx", b"content")
        # Output with no header at all.
        (scan_root / "doc.md").write_text(
            "# Manually authored\n\nNothing to see.\n",
            encoding="utf-8",
        )
        [entry] = doc_convert.scan_convertible_files()
        assert entry["status"] == "conflict"

    def test_malformed_header_treated_as_conflict(
        self, doc_convert, scan_root
    ):
        """Header missing required fields → conflict."""
        _write_source(scan_root, "doc.docx", b"content")
        _write_output(
            scan_root, "doc.md",
            # No sha256 field — fails required-field validation.
            provenance="source=doc.docx",
        )
        [entry] = doc_convert.scan_convertible_files()
        assert entry["status"] == "conflict"


# ---------------------------------------------------------------------------
# scan_convertible_files — entry shape
# ---------------------------------------------------------------------------


class TestScanEntryShape:
    def test_entry_has_required_fields(self, doc_convert, scan_root):
        _write_source(scan_root, "doc.docx", b"hello")
        [entry] = doc_convert.scan_convertible_files()
        assert set(entry.keys()) == {
            "path", "name", "size", "status",
            "output_path", "over_size",
        }

    def test_path_and_name_populated(self, doc_convert, scan_root):
        _write_source(scan_root, "dir/nested.docx", b"x")
        [entry] = doc_convert.scan_convertible_files()
        assert entry["path"] == "dir/nested.docx"
        assert entry["name"] == "nested.docx"

    def test_output_path_is_sibling_md(self, doc_convert, scan_root):
        _write_source(scan_root, "docs/arch.docx", b"x")
        [entry] = doc_convert.scan_convertible_files()
        assert entry["output_path"] == "docs/arch.md"

    def test_size_is_byte_count(self, doc_convert, scan_root):
        content = b"x" * 12345
        _write_source(scan_root, "sized.docx", content)
        [entry] = doc_convert.scan_convertible_files()
        assert entry["size"] == 12345

    def test_over_size_flag_false_under_threshold(
        self, doc_convert, scan_root
    ):
        _write_source(scan_root, "small.docx", b"x" * 100)
        [entry] = doc_convert.scan_convertible_files()
        assert entry["over_size"] is False

    def test_over_size_flag_true_above_threshold(
        self, doc_convert, isolated_config_dir, scan_root
    ):
        # Set max to 1 MB.
        app_json = isolated_config_dir / "app.json"
        data = json.loads(app_json.read_text(encoding="utf-8"))
        data["doc_convert"]["max_source_size_mb"] = 1
        app_json.write_text(json.dumps(data), encoding="utf-8")
        doc_convert._config.reload_app_config()
        # Write > 1 MB of content.
        _write_source(scan_root, "big.docx", b"x" * (2 * 1024 * 1024))
        [entry] = doc_convert.scan_convertible_files()
        assert entry["over_size"] is True

    def test_windows_path_normalised(self, doc_convert, scan_root):
        """Path uses forward slashes regardless of platform."""
        _write_source(scan_root, "a/b/c.docx", b"x")
        [entry] = doc_convert.scan_convertible_files()
        assert "\\" not in entry["path"]
        assert "\\" not in entry["output_path"]


# ---------------------------------------------------------------------------
# scan_convertible_files — ordering
# ---------------------------------------------------------------------------


class TestScanOrdering:
    def test_stable_alphabetical_sort(self, doc_convert, scan_root):
        _write_source(scan_root, "z.docx", b"x")
        _write_source(scan_root, "a.docx", b"x")
        _write_source(scan_root, "m.docx", b"x")
        results = doc_convert.scan_convertible_files()
        paths = [r["path"] for r in results]
        assert paths == sorted(paths)

    def test_sort_includes_nested_paths(self, doc_convert, scan_root):
        _write_source(scan_root, "b/z.docx", b"x")
        _write_source(scan_root, "a/z.docx", b"x")
        _write_source(scan_root, "b/a.docx", b"x")
        results = doc_convert.scan_convertible_files()
        paths = [r["path"] for r in results]
        # Sorted alphabetically, so "a/z" < "b/a" < "b/z".
        assert paths == ["a/z.docx", "b/a.docx", "b/z.docx"]


# ---------------------------------------------------------------------------
# Provenance header parsing
# ---------------------------------------------------------------------------


class TestProvenanceParsing:
    def test_valid_header_parses(self):
        body = "source=doc.docx sha256=abc123 images=a.png,b.png"
        result = DocConvert.parse_provenance_body(body)
        assert result is not None
        assert result.source == "doc.docx"
        assert result.sha256 == "abc123"
        assert result.images == ("a.png", "b.png")
        assert result.extra is None

    def test_minimal_header_valid(self):
        body = "source=doc.docx sha256=abc"
        result = DocConvert.parse_provenance_body(body)
        assert result is not None
        assert result.images == ()

    def test_missing_source_returns_none(self):
        body = "sha256=abc"
        assert DocConvert.parse_provenance_body(body) is None

    def test_missing_sha256_returns_none(self):
        body = "source=doc.docx"
        assert DocConvert.parse_provenance_body(body) is None

    def test_empty_body_returns_none(self):
        assert DocConvert.parse_provenance_body("") is None

    def test_unknown_fields_captured_as_extra(self):
        body = "source=doc.docx sha256=abc tool_version=2.0 custom=xyz"
        result = DocConvert.parse_provenance_body(body)
        assert result is not None
        assert result.extra == {"tool_version": "2.0", "custom": "xyz"}

    def test_empty_images_list_is_empty_tuple(self):
        body = "source=doc.docx sha256=abc images="
        result = DocConvert.parse_provenance_body(body)
        assert result is not None
        assert result.images == ()

    def test_single_image(self):
        body = "source=doc.docx sha256=abc images=only.png"
        result = DocConvert.parse_provenance_body(body)
        assert result is not None
        assert result.images == ("only.png",)

    def test_is_frozen_dataclass(self):
        header = ProvenanceHeader(source="a", sha256="b")
        with pytest.raises((AttributeError, Exception)):
            header.source = "changed"  # type: ignore[misc]


class TestProvenanceReadFromFile:
    def test_reads_header_from_output_file(
        self, doc_convert, scan_root
    ):
        _write_output(
            scan_root, "doc.md",
            provenance="source=doc.docx sha256=abc",
        )
        header = doc_convert._read_provenance_header(
            scan_root / "doc.md"
        )
        assert header is not None
        assert header.source == "doc.docx"
        assert header.sha256 == "abc"

    def test_missing_header_returns_none(self, doc_convert, scan_root):
        (scan_root / "doc.md").write_text(
            "# Plain markdown\n", encoding="utf-8"
        )
        assert doc_convert._read_provenance_header(
            scan_root / "doc.md"
        ) is None

    def test_invalid_body_returns_none(self, doc_convert, scan_root):
        _write_output(
            scan_root, "doc.md",
            provenance="only=garbage",
        )
        assert doc_convert._read_provenance_header(
            scan_root / "doc.md"
        ) is None

    def test_unreadable_file_returns_none(self, doc_convert, scan_root):
        """A file we can't open returns None rather than crashing."""
        # A directory at the path where a file should be.
        bad_path = scan_root / "doc.md"
        bad_path.mkdir()
        assert doc_convert._read_provenance_header(bad_path) is None

    def test_header_with_leading_content_still_found(
        self, doc_convert, scan_root
    ):
        """Header doesn't HAVE to be on line 1 — a leading BOM or
        blank line should still work."""
        (scan_root / "doc.md").write_text(
            "\n<!-- docuvert: source=a sha256=b -->\n# body\n",
            encoding="utf-8",
        )
        header = doc_convert._read_provenance_header(
            scan_root / "doc.md"
        )
        assert header is not None
        assert header.source == "a"


# ---------------------------------------------------------------------------
# Source hashing
# ---------------------------------------------------------------------------


class TestHashFile:
    def test_matches_stdlib_sha256(self, tmp_path):
        content = b"hello world" * 1000
        path = tmp_path / "data.bin"
        path.write_bytes(content)
        expected = hashlib.sha256(content).hexdigest()
        assert DocConvert._hash_file(path) == expected

    def test_streams_large_file(self, tmp_path):
        """File larger than the 64KB chunk is hashed correctly."""
        content = b"x" * (500 * 1024)  # 500 KB
        path = tmp_path / "large.bin"
        path.write_bytes(content)
        expected = hashlib.sha256(content).hexdigest()
        assert DocConvert._hash_file(path) == expected

    def test_empty_file(self, tmp_path):
        path = tmp_path / "empty"
        path.write_bytes(b"")
        assert (
            DocConvert._hash_file(path)
            == hashlib.sha256(b"").hexdigest()
        )


# ---------------------------------------------------------------------------
# Encrypted-OOXML detection at dispatch
# ---------------------------------------------------------------------------


# CDFV2 (OLE compound document) magic — encrypted Office files
# wrap their payload in this container. Padded out to a credible
# file size so the size-budget check doesn't reject before the
# encryption check runs.
_CDFV2_HEADER = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
_ENCRYPTED_OOXML_BYTES = _CDFV2_HEADER + b"\x00" * 1024


class TestEncryptedOoxmlDetection:
    """Dispatch-level CDFV2 detection.

    Catching encrypted Office files before any pipeline runs
    saves the user from a wasted LibreOffice subprocess
    invocation followed by a misleading "Package not found"
    error from python-pptx. The check is keyed on the OOXML
    extensions (.docx / .xlsx / .pptx) only — ODF formats use
    a different encryption scheme that doesn't surface as
    CDFV2.
    """

    def test_encrypted_pptx_returns_error(
        self, doc_convert, scan_root
    ):
        _write_source(scan_root, "deck.pptx", _ENCRYPTED_OOXML_BYTES)
        result = doc_convert.convert_files(["deck.pptx"])
        [entry] = result["results"]
        assert entry["status"] == "error"
        assert entry["path"] == "deck.pptx"

    def test_encrypted_docx_returns_error(
        self, doc_convert, scan_root
    ):
        _write_source(scan_root, "doc.docx", _ENCRYPTED_OOXML_BYTES)
        result = doc_convert.convert_files(["doc.docx"])
        [entry] = result["results"]
        assert entry["status"] == "error"

    def test_encrypted_xlsx_returns_error(
        self, doc_convert, scan_root
    ):
        _write_source(scan_root, "book.xlsx", _ENCRYPTED_OOXML_BYTES)
        result = doc_convert.convert_files(["book.xlsx"])
        [entry] = result["results"]
        assert entry["status"] == "error"

    def test_message_mentions_password_protection(
        self, doc_convert, scan_root
    ):
        """The error string must tell the user the file is encrypted
        — that's the point of the dispatch-level check."""
        _write_source(scan_root, "deck.pptx", _ENCRYPTED_OOXML_BYTES)
        result = doc_convert.convert_files(["deck.pptx"])
        [entry] = result["results"]
        assert "password-protected" in entry["message"].lower()

    def test_message_suggests_resolution(
        self, doc_convert, scan_root
    ):
        """The user needs actionable next steps, not just a diagnosis."""
        _write_source(scan_root, "deck.pptx", _ENCRYPTED_OOXML_BYTES)
        result = doc_convert.convert_files(["deck.pptx"])
        [entry] = result["results"]
        msg = entry["message"]
        # At least one of the two resolution paths is mentioned.
        assert (
            "msoffcrypto-tool" in msg
            or "Encrypt with Password" in msg
        )

    def test_path_field_echoes_caller_request(
        self, doc_convert, scan_root
    ):
        """The path in the result must match what the caller passed,
        not the resolved absolute path or the file basename — the
        webapp keys per-file rows by request path."""
        _write_source(
            scan_root, "nested/deep/deck.pptx",
            _ENCRYPTED_OOXML_BYTES,
        )
        result = doc_convert.convert_files(["nested/deep/deck.pptx"])
        [entry] = result["results"]
        assert entry["path"] == "nested/deep/deck.pptx"

    def test_zip_signature_passes_through_to_pipeline(
        self, doc_convert, scan_root
    ):
        """A real OOXML file (ZIP-prefixed) must NOT trigger the
        encryption check. The pipeline runs and produces whatever
        result it normally would — for a fake/incomplete ZIP that's
        an error from the pipeline, but distinct from the
        encryption error."""
        # PK\x03\x04 prefix = ZIP local file header.
        fake_zip = b"PK\x03\x04" + b"\x00" * 1024
        _write_source(scan_root, "deck.pptx", fake_zip)
        result = doc_convert.convert_files(["deck.pptx"])
        [entry] = result["results"]
        # Pipeline failure on a malformed pptx is distinct from
        # the encryption error — the message should not mention
        # password protection.
        assert "password-protected" not in entry.get("message", "").lower()

    def test_short_file_does_not_trigger(
        self, doc_convert, scan_root
    ):
        """A file shorter than 8 bytes can't match the CDFV2
        signature. It should fall through to the pipeline and
        fail there for a normal reason, not be misidentified as
        encrypted."""
        _write_source(scan_root, "tiny.pptx", b"PK\x03")
        result = doc_convert.convert_files(["tiny.pptx"])
        [entry] = result["results"]
        # Whatever the pipeline says, it's not the encryption
        # error. Defensive .get() — pipelines that succeed
        # don't necessarily produce a message field; we only
        # care that if one is present, it doesn't claim
        # password protection.
        assert "password-protected" not in entry.get("message", "").lower()

    def test_empty_file_does_not_trigger(
        self, doc_convert, scan_root
    ):
        """Zero-byte files fall through to the pipeline."""
        _write_source(scan_root, "empty.pptx", b"")
        result = doc_convert.convert_files(["empty.pptx"])
        [entry] = result["results"]
        assert "password-protected" not in entry.get("message", "").lower()

    def test_pdf_with_cdfv2_bytes_skips_check(
        self, doc_convert, scan_root
    ):
        """The check is keyed on extension. A .pdf file that
        happens to start with the CDFV2 magic (extremely unlikely
        in practice but possible) goes through the PDF pipeline
        — the OOXML encryption diagnostic doesn't apply."""
        _write_source(scan_root, "weird.pdf", _ENCRYPTED_OOXML_BYTES)
        result = doc_convert.convert_files(["weird.pdf"])
        [entry] = result["results"]
        # The PDF pipeline will reject it, but not with the OOXML
        # encryption message.
        assert "CDFV2 container" not in entry.get("message", "")

    def test_no_pipeline_invoked_for_encrypted_file(
        self, doc_convert, scan_root, monkeypatch
    ):
        """Performance test — the dispatch check must short-circuit
        before any pipeline runs. Stub every pipeline's convert
        method and verify none was called."""
        called = []

        def record(name):
            def _fn(*args, **kwargs):
                called.append(name)
                return {"path": "x", "status": "error",
                        "message": "should not be called"}
            return _fn

        monkeypatch.setattr(
            doc_convert._markitdown, "convert", record("markitdown")
        )
        monkeypatch.setattr(
            doc_convert._xlsx, "convert", record("xlsx")
        )
        monkeypatch.setattr(
            doc_convert._pptx, "convert", record("pptx")
        )
        monkeypatch.setattr(
            doc_convert._pdf, "convert_libreoffice",
            record("libreoffice"),
        )
        monkeypatch.setattr(
            doc_convert._pdf, "convert_pymupdf",
            record("pymupdf"),
        )
        _write_source(scan_root, "deck.pptx", _ENCRYPTED_OOXML_BYTES)
        doc_convert.convert_files(["deck.pptx"])
        assert called == []


class TestEncryptionHelperDirectly:
    """Unit tests on ``DocConvert._is_encrypted_ooxml`` itself.

    Complements the dispatch-level integration tests above by
    pinning the helper's contract directly. Useful when refactoring
    the dispatch loop without changing the detection rule.
    """

    def test_returns_none_for_zip_prefix(self, scan_root):
        path = scan_root / "deck.pptx"
        path.write_bytes(b"PK\x03\x04" + b"\x00" * 100)
        result = DocConvert._is_encrypted_ooxml(path, "deck.pptx")
        assert result is None

    def test_returns_dict_for_cdfv2_prefix(self, scan_root):
        path = scan_root / "deck.pptx"
        path.write_bytes(_ENCRYPTED_OOXML_BYTES)
        result = DocConvert._is_encrypted_ooxml(path, "deck.pptx")
        assert result is not None
        assert result["status"] == "error"
        assert result["path"] == "deck.pptx"

    def test_returns_none_for_short_file(self, scan_root):
        path = scan_root / "deck.pptx"
        path.write_bytes(b"\xd0\xcf\x11")
        result = DocConvert._is_encrypted_ooxml(path, "deck.pptx")
        assert result is None

    def test_returns_none_for_unreadable_path(self, scan_root):
        """Missing file falls through — pipeline handles the I/O
        error with its own message rather than us inventing a
        misleading 'encrypted' diagnosis."""
        path = scan_root / "does-not-exist.pptx"
        result = DocConvert._is_encrypted_ooxml(
            path, "does-not-exist.pptx"
        )
        assert result is None

    def test_path_field_uses_caller_supplied_rel_path(
        self, scan_root
    ):
        """The result's path field echoes whatever the caller
        passed, not the basename — webapp matches on request path."""
        path = scan_root / "nested" / "deck.pptx"
        path.parent.mkdir(parents=True)
        path.write_bytes(_ENCRYPTED_OOXML_BYTES)
        result = DocConvert._is_encrypted_ooxml(
            path, "nested/deck.pptx"
        )
        assert result is not None
        assert result["path"] == "nested/deck.pptx"