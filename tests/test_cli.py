"""Tests for ac_dc.cli.

Layer 0 scope — verify the CLI parses arguments, prints the banner, and
exits cleanly. Full startup orchestration is tested in Layer 6.
"""

from __future__ import annotations

import subprocess
import sys

import pytest

from ac_dc import __version__
from ac_dc.cli import main


def test_main_no_args_exits_zero(capsys: pytest.CaptureFixture[str]) -> None:
    """Running with no arguments returns 0 and prints the banner to stderr.

    Asserts only the stable identity strings (product name and expansion)
    — not the banner wording itself, which changes as development
    progresses.
    """
    exit_code = main([])
    assert exit_code == 0
    captured = capsys.readouterr()
    assert "AC-DC" in captured.err
    assert "AI Coder - DeCoder" in captured.err


def test_main_version_flag_prints_version(capsys: pytest.CaptureFixture[str]) -> None:
    """--version exits 0 and prints the version string from __init__."""
    # argparse calls sys.exit on --version; SystemExit(code=0) is the expected
    # signal. We catch it so pytest doesn't treat it as a test error.
    with pytest.raises(SystemExit) as exc_info:
        main(["--version"])
    assert exc_info.value.code == 0
    captured = capsys.readouterr()
    assert __version__ in captured.out


def test_main_help_flag_exits_zero(capsys: pytest.CaptureFixture[str]) -> None:
    """--help exits 0 and prints usage to stdout."""
    with pytest.raises(SystemExit) as exc_info:
        main(["--help"])
    assert exc_info.value.code == 0
    captured = capsys.readouterr()
    assert "ac-dc" in captured.out.lower()
    assert "usage" in captured.out.lower()


def test_main_accepts_all_documented_flags() -> None:
    """All flags listed in specs4/6-deployment/startup.md parse without error.

    Layer 0 accepts them but ignores their values — full behavior lands in
    Layer 6. This test is the contract that the flag set is stable.
    """
    # Each combination should parse and exit 0.
    flag_sets = [
        ["--server-port", "19000"],
        ["--webapp-port", "19001"],
        ["--no-browser"],
        ["--repo-path", "/tmp"],
        ["--dev"],
        ["--preview"],
        ["--verbose"],
        ["--collab"],
        # Composite — several at once.
        ["--server-port", "19000", "--no-browser", "--verbose"],
    ]
    for flags in flag_sets:
        assert main(flags) == 0, f"flags {flags!r} did not parse cleanly"


def test_main_rejects_unknown_flag() -> None:
    """Unknown flags cause argparse to exit with code 2."""
    with pytest.raises(SystemExit) as exc_info:
        main(["--does-not-exist"])
    assert exc_info.value.code == 2


def test_module_entrypoint_runs() -> None:
    """`python -m ac_dc` works as an alternative to the ac-dc script.

    Uses a subprocess so we exercise the real __main__ module dispatch.
    """
    result = subprocess.run(
        [sys.executable, "-m", "ac_dc", "--version"],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0
    assert __version__ in result.stdout