"""Command-line entry point for ``ac-dc``.

Layer 0 stub — prints a startup banner, parses arguments, and exits. Full
startup orchestration (port selection, WebSocket server, webapp serving,
deferred indexing) lands in Layer 6 per specs4/6-deployment/startup.md.

Exposed via the ``ac-dc`` console script declared in pyproject.toml.
"""

from __future__ import annotations

import argparse
import sys

from ac_dc import __version__


def _build_parser() -> argparse.ArgumentParser:
    """Construct the argparse parser.

    The flag set matches specs4/6-deployment/startup.md#cli-arguments so that
    flags are stable from day one. Layer 0 only honours --version and --help;
    other flags are accepted but currently produce a not-implemented banner.
    """
    parser = argparse.ArgumentParser(
        prog="ac-dc",
        description="AC-DC — AI Coder - DeCoder. AI-assisted code editing with a browser UI.",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"ac-dc {__version__}",
    )
    parser.add_argument(
        "--server-port",
        type=int,
        default=18080,
        help="RPC WebSocket server port (default: 18080)",
    )
    parser.add_argument(
        "--webapp-port",
        type=int,
        default=18999,
        help="Webapp static/dev server port (default: 18999)",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not auto-open the browser on startup",
    )
    parser.add_argument(
        "--repo-path",
        default=".",
        help="Path to the git repository to operate on (default: current directory)",
    )
    parser.add_argument(
        "--dev",
        action="store_true",
        help="Run the Vite dev server instead of the bundled webapp",
    )
    parser.add_argument(
        "--preview",
        action="store_true",
        help="Build and run the Vite preview server instead of the bundled webapp",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable debug-level logging",
    )
    parser.add_argument(
        "--collab",
        action="store_true",
        help="Enable collaboration mode (bind all interfaces, admission-gated)",
    )
    return parser


def _print_banner() -> None:
    """Print the startup banner to stderr.

    Uses ASCII only so it works over ssh and in plain terminals. Version
    reads the baked VERSION file via ``__version__``. In source installs
    (VERSION == "dev") we add a scaffold notice so developers running
    ``ac-dc`` know why nothing happens yet. Release builds — where the
    VERSION file has been baked with a real timestamp+SHA — skip the
    scaffold notice.
    """
    if __version__ == "dev":
        banner = f"""
  AC-DC  —  AI Coder - DeCoder
  version {__version__}

  [scaffold build — full startup not yet implemented]
  See specs4/6-deployment/startup.md for the target startup sequence.
"""
    else:
        banner = f"""
  AC-DC  —  AI Coder - DeCoder
  version {__version__}
"""
    print(banner, file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    """CLI entry point.

    Parameters
    ----------
    argv:
        Optional argument list for testing. When ``None`` the default
        ``sys.argv[1:]`` is used.

    Returns
    -------
    int
        Process exit code. Always 0 in Layer 0.
    """
    parser = _build_parser()
    # Parse (and validate) arguments — argparse will exit on --help/--version
    # or on parse errors. The parsed namespace is unused in Layer 0.
    parser.parse_args(argv)
    _print_banner()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())