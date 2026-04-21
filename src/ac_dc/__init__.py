"""AC-DC — AI Coder - DeCoder.

AI-assisted code editing with a browser UI, stability-based prompt caching,
and document-mode support.
"""

from pathlib import Path


def _read_version() -> str:
    """Read the baked VERSION file, falling back to a dev marker.

    The VERSION file is written at build time by the release workflow with a
    timestamp + short SHA. In source-tree runs it contains the literal
    string ``dev``.
    """
    version_file = Path(__file__).parent / "VERSION"
    try:
        return version_file.read_text(encoding="utf-8").strip() or "dev"
    except OSError:
        return "dev"


__version__ = _read_version()

__all__ = ["__version__"]