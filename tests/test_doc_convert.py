"""Tests for ac_dc.doc_convert.DocConvert — Layer 4.5 Pass A (foundation).

Covers:

- Construction (holds config reference, collab starts None)
- Localhost-only guard (single-user path, localhost allowed,
  non-localhost rejected, fail-closed on raising collab)
- `is_available` dependency probing (reports all four flags,
  degradation when deps missing, derived `pdf_pipeline` flag)
- `scan_convertible_files` (empty repo, new sources, status
  classification matrix, directory exclusions, extension
  filtering, disabled flag returns empty, size threshold flag,
  stable sort order, malformed files skipped defensively)
- Provenance header parsing (valid header, missing required
  fields, unknown fields preserved as extra, no header,
  malformed bytes)
- `convert_files` stub (restricted for non-localhost, raises
  NotImplementedError for localhost — proves the guard runs
  before the unimplemented body)

Strategy:

- Isolated config dir via ``AC_DC_CONFIG_HOME`` (the documented
  test hook used by every other test suite).
- Use `tmp_path` as the scan root rather than constructing a
  real `Repo` — the scanner only needs `.root` which is trivially
  provided by a `SimpleNamespace` stub. Keeps tests from coupling
  to the Repo test fixtures.
- Stub collab with configurable `is_caller_localhost`, same
  pattern as `test_settings.py` and `test_collab_restrictions.py`.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import pytest

from ac_dc.config import ConfigManager
from ac_dc.doc_convert import (
    DocConvert,
    ProvenanceHeader,
    _DEFAULT_EXTENSIONS,
    _EXCLUDED_DIRS,
)


# ---------------------------------------------------------------------------
# Stub collab (matches test_collab_restrictions.py + test_settings.py)
# ---------------------------------------------------------------------------


class _StubCollab:
    def __init__(self, is_localhost: bool = True) -> None:
        self._is_localhost = is_localhost
        self.call_count = 0

    def is_caller_localhost(self) -> bool:
        self.call_count += 1
        return self._is_localhost


class _RaisingCollab:
    def is_caller_localhost(self) -> bool:
        raise RuntimeError("collab check failed")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def isolated_config_dir(tmp_path, monkeypatch):
    home = tmp_path / "ac-dc-config"
    monkeypatch.setenv("AC_DC_CONFIG_HOME", str(home))
    return home


@pytest.fixture
def config(isolated_config_dir):
    return ConfigManager()


@pytest.fixture
def scan_root(tmp_path):
    """A fresh directory to act as the scan root."""
    root = tmp_path / "scan-root"
    root.mkdir()
    return root


@pytest.fixture
def fake_repo(scan_root):
    """A minimal repo stand-in exposing `.root`."""
    return SimpleNamespace(root=scan_root)


@pytest.fixture
def doc_convert(config, fake_repo):
    """DocConvert with no collab attached (single-user mode)."""
    return DocConvert(config, repo=fake_repo)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _assert_restricted(result: Any) -> None:
    assert isinstance(result, dict)
    assert result.get("error") == "restricted"
    reason = result.get("reason")
    assert isinstance(reason, str) and reason


def _write_source(scan_root: Path, rel_path: str, content: bytes) -> Path:
    """Helper — write a binary source file at a given relative path."""
    path = scan_root / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


def _write_output(
    scan_root: Path,
    rel_path: str,
    provenance: str | None,
    body: str = "converted content\n",
) -> Path:
    """Helper — write a markdown output with an optional provenance header."""
    path = scan_root / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    if provenance is not None:
        lines.append(f"<!-- docuvert: {provenance} -->")
        lines.append("")
    lines.append(body)
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def _sha256_of(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


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
        _write_source(scan_root, ".ac-dc/history.docx", b"x")
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
# convert_files — Pass A stub
# ---------------------------------------------------------------------------


class TestConvertFilesStub:
    def test_non_localhost_returns_restricted(self, doc_convert):
        doc_convert._collab = _StubCollab(is_localhost=False)
        result = doc_convert.convert_files(["any.docx"])
        _assert_restricted(result)

    def test_localhost_raises_not_implemented(self, doc_convert):
        """Localhost callers get NotImplementedError, proving the
        guard runs first (non-localhost would return a dict, not
        raise)."""
        doc_convert._collab = _StubCollab(is_localhost=True)
        with pytest.raises(NotImplementedError):
            doc_convert.convert_files(["any.docx"])

    def test_no_collab_raises_not_implemented(self, doc_convert):
        """Single-user mode also raises — the guard path is
        orthogonal to the unimplemented-body path."""
        with pytest.raises(NotImplementedError):
            doc_convert.convert_files(["any.docx"])

    def test_raising_collab_returns_restricted_not_raises(
        self, doc_convert
    ):
        """Guard fails closed — a raising collab returns restricted,
        not NotImplementedError. Proves the guard is strictly before
        the body."""
        doc_convert._collab = _RaisingCollab()
        result = doc_convert.convert_files(["any.docx"])
        _assert_restricted(result)