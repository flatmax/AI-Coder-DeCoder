"""Shared fixtures for the doc_convert test suite.

These fixtures match the originals from the monolithic
``tests/test_doc_convert.py`` byte-for-byte. The split into
topic-specific test modules under this package preserved every
test verbatim; only the shared infrastructure moved here.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest

from ac_dc.config import ConfigManager

from ._helpers import _FakeMarkItDown


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
    from ac_dc.doc_convert import DocConvert
    return DocConvert(config, repo=fake_repo)


@pytest.fixture
def fake_markitdown(monkeypatch):
    """Install a fake markitdown module via sys.modules."""
    # Reset per-test state.
    _FakeMarkItDown.outputs = {}
    _FakeMarkItDown.raise_on_convert = None

    fake_module = types.ModuleType("markitdown")
    fake_module.MarkItDown = _FakeMarkItDown
    monkeypatch.setitem(sys.modules, "markitdown", fake_module)
    return _FakeMarkItDown


@pytest.fixture
def clean_repo(scan_root):
    """A fake repo whose `is_clean()` returns True."""
    return SimpleNamespace(
        root=scan_root,
        is_clean=lambda: True,
    )


@pytest.fixture
def dirty_repo(scan_root):
    """A fake repo whose `is_clean()` returns False."""
    return SimpleNamespace(
        root=scan_root,
        is_clean=lambda: False,
    )


@pytest.fixture
def force_pptx_fallback(monkeypatch):
    """Force pptx to use the python-pptx fallback path.

    When LibreOffice is actually installed on the test machine,
    pptx files route through the LibreOffice + PyMuPDF pipeline
    (Pass A5b primary path). The A4 fallback tests were written
    against the python-pptx path and produce different output
    (SVGs named `NN_slide.svg`, headings `## Slide N`) than the
    LibreOffice path (`NN_page.svg`, `## Page N`).

    Stubbing `shutil.which` to return None for `soffice` forces
    the dispatch to bypass LibreOffice and fall through to
    python-pptx. The A4 tests work unchanged.
    """
    monkeypatch.setattr(
        "ac_dc.doc_convert.shutil.which",
        lambda cmd: None,
    )