"""Tests for package metadata and bundled defaults.

Guards the contract that ac_dc is importable, exposes a version string,
and ships all the default configuration files that later layers depend on.
A packaging regression (missing force-include, renamed file, broken VERSION
read) surfaces here rather than in a downstream layer's tests.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import ac_dc


CONFIG_DIR = Path(ac_dc.__file__).parent / "config"


def test_version_is_non_empty_string() -> None:
    """__version__ is always a non-empty string.

    Source installs see the literal 'dev' marker from the shipped VERSION
    file. Release builds bake a timestamp+SHA string. Either way, reading
    it must succeed and yield something printable.
    """
    assert isinstance(ac_dc.__version__, str)
    assert ac_dc.__version__ != ""
    # Version should be ASCII printable — no surprise control chars from a
    # mis-encoded VERSION file.
    assert ac_dc.__version__.isprintable()


def test_version_file_is_shipped() -> None:
    """The VERSION file is present in the installed package.

    This is the file _read_version() consults. Absence would mean the
    package was installed without its data files.
    """
    version_file = Path(ac_dc.__file__).parent / "VERSION"
    assert version_file.is_file()
    content = version_file.read_text(encoding="utf-8").strip()
    # Source tree ships 'dev'; release builds bake a timestamp+SHA string
    # matching YYYY.MM.DD-HH.MM-<sha>. Accept either shape.
    is_dev = content == "dev"
    is_release = bool(
        re.fullmatch(r"\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}-[0-9a-f]{7,40}", content)
    )
    assert is_dev or is_release, f"unexpected VERSION content: {content!r}"


def test_config_dir_exists() -> None:
    """The bundled config directory is present next to the package."""
    assert CONFIG_DIR.is_dir(), f"expected config dir at {CONFIG_DIR}"


def test_all_expected_config_files_present() -> None:
    """Every config file specs4 references is shipped with the package.

    The names here are the union of files listed in:
      - specs4/1-foundation/configuration.md (config file set)
      - specs4/6-deployment/packaging.md (managed + user files)

    We check containment, not equality — extra files in the bundled
    config directory (experiments, transitional files during a
    refactor) are tolerated. If you add a *required* config file,
    add it both here and in the packaging spec.
    """
    expected = {
        "llm.json",
        "app.json",
        "snippets.json",
        "system.md",
        "system_doc.md",
        "review.md",
        "commit.md",
        "compaction.md",
        "system_reminder.md",
    }
    actual = {p.name for p in CONFIG_DIR.iterdir() if p.is_file()}
    missing = expected - actual
    assert not missing, f"missing config files: {sorted(missing)}"


def test_llm_config_is_valid_json_with_required_keys() -> None:
    """llm.json parses and carries the fields ConfigManager will read.

    Layer 1 will wrap this file with accessors; at Layer 0 we just ensure
    the bundled defaults don't ship broken JSON or missing keys.
    """
    data = json.loads((CONFIG_DIR / "llm.json").read_text(encoding="utf-8"))
    assert isinstance(data, dict)
    # Required keys per specs4/1-foundation/configuration.md.
    assert "model" in data
    assert "smaller_model" in data
    assert "cache_min_tokens" in data
    assert "cache_buffer_multiplier" in data
    # env is allowed to be an empty dict but must be present.
    assert "env" in data
    assert isinstance(data["env"], dict)


def test_app_config_is_valid_json_with_required_sections() -> None:
    """app.json parses and has the sections downstream layers consume."""
    data = json.loads((CONFIG_DIR / "app.json").read_text(encoding="utf-8"))
    assert isinstance(data, dict)
    # Required top-level sections per specs4/1-foundation/configuration.md.
    for section in ("url_cache", "history_compaction", "doc_convert", "doc_index"):
        assert section in data, f"missing app.json section: {section}"
        assert isinstance(data[section], dict)


def test_snippets_json_has_all_three_modes() -> None:
    """snippets.json uses the nested per-mode structure.

    specs4/1-foundation/configuration.md#snippets defines keys for code,
    review, and doc modes. Each value is a list of snippet objects with
    icon, tooltip, and message fields.
    """
    data = json.loads((CONFIG_DIR / "snippets.json").read_text(encoding="utf-8"))
    assert isinstance(data, dict)
    for mode in ("code", "review", "doc"):
        assert mode in data, f"snippets.json missing mode: {mode}"
        assert isinstance(data[mode], list)
        assert len(data[mode]) > 0, f"snippets.json[{mode}] is empty"
        for snippet in data[mode]:
            assert isinstance(snippet, dict)
            # Required keys per spec.
            assert "icon" in snippet
            assert "tooltip" in snippet
            assert "message" in snippet


def test_prompt_files_are_non_empty() -> None:
    """Every prompt file ships with real content, not a zero-byte stub."""
    prompt_files = [
        "system.md",
        "system_doc.md",
        "review.md",
        "commit.md",
        "compaction.md",
        "system_reminder.md",
    ]
    for name in prompt_files:
        content = (CONFIG_DIR / name).read_text(encoding="utf-8")
        # Strip whitespace so a file containing only newlines fails the check.
        assert content.strip(), f"{name} is empty or whitespace-only"


def test_edit_protocol_delimiters_are_defined_correctly() -> None:
    """The shipped system prompts use the emoji-based edit-block delimiters.

    IMPLEMENTATION_NOTES.md D3 specifies the delimiter set:
      - 🟧🟧🟧 EDIT  (orange squares, U+1F7E7)
      - 🟨🟨🟨 REPL  (yellow squares, U+1F7E8)
      - 🟩🟩🟩 END   (green squares, U+1F7E9)

    This guard prevents a regression to the specs3 guillemet markers or
    to a subtle variant (e.g., missing the literal END word).
    """
    for prompt_name in ("system.md", "system_doc.md"):
        content = (CONFIG_DIR / prompt_name).read_text(encoding="utf-8")
        # All three markers must appear at least once (in the protocol
        # description) and in the example block.
        assert "🟧🟧🟧 EDIT" in content, f"{prompt_name} missing start marker"
        assert "🟨🟨🟨 REPL" in content, f"{prompt_name} missing separator"
        assert "🟩🟩🟩 END" in content, f"{prompt_name} missing end marker"
        # Guard against the specs3 markers creeping back in.
        assert "««« EDIT" not in content, f"{prompt_name} has old guillemet markers"
        assert "»»» EDIT END" not in content, f"{prompt_name} has old guillemet markers"

    # system_reminder.md must also carry the full end marker.
    reminder = (CONFIG_DIR / "system_reminder.md").read_text(encoding="utf-8")
    assert "🟩🟩🟩 END" in reminder, "system_reminder.md missing end marker"