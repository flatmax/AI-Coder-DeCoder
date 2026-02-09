"""Main entry point: CLI parsing, server startup, browser launch."""

import argparse
import asyncio
import logging
import os
import subprocess
import sys
import webbrowser
from pathlib import Path

log = logging.getLogger("ac_dc")


def find_available_port(start: int, max_tries: int = 50) -> int:
    """Find an available port starting from the given number."""
    import socket
    for offset in range(max_tries):
        port = start + offset
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError(f"No available port found starting from {start}")


def get_version() -> str:
    """Detect version from VERSION file or git."""
    # Check for baked VERSION file
    version_file = Path(__file__).parent / "VERSION"
    if version_file.exists():
        return version_file.read_text().strip()

    # Try git
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=5,
            cwd=str(Path(__file__).parent),
        )
        if result.returncode == 0:
            return result.stdout.strip()[:8]
    except Exception:
        pass

    return "dev"


async def run_server(args: argparse.Namespace):
    """Start the RPC server and run forever."""
    from .config import ConfigManager
    from .repo import Repo
    from .llm_service import LLM
    from .settings import Settings

    repo_root = Path(args.repo_path).resolve()

    # Validate git repo
    if not (repo_root / ".git").exists():
        print(f"Error: {repo_root} is not a git repository", file=sys.stderr)
        sys.exit(1)

    # Find port
    server_port = find_available_port(args.server_port)

    # Initialize services
    config = ConfigManager(repo_root, dev_mode=args.dev)
    repo = Repo(repo_root)
    llm = LLM(config, repo)
    settings = Settings(config)

    version = get_version()
    log.info("ac-dc v%s starting on port %d", version, server_port)
    log.info("Repository: %s", repo_root)

    # Start RPC server
    try:
        from jrpc_oo import JRPCServer
    except ImportError:
        print("Error: jrpc-oo not installed. Run: pip install jrpc-oo", file=sys.stderr)
        sys.exit(1)

    server = JRPCServer(server_port, remote_timeout=60)
    server.add_class(repo)
    server.add_class(llm)
    server.add_class(settings)

    # Give LLM service access to server for streaming callbacks
    llm._server = server

    print(f"ac-dc v{version}")
    print(f"RPC server: ws://localhost:{server_port}")
    print(f"Repository: {repo_root}")

    # Open browser
    if not args.no_browser:
        if args.dev:
            webapp_port = find_available_port(args.webapp_port)
            url = f"http://localhost:{webapp_port}/?port={server_port}"
        else:
            url = f"http://localhost:{server_port}/?port={server_port}"
        print(f"Opening: {url}")
        webbrowser.open(url)

    await server.start()

    # Run forever
    try:
        await asyncio.Future()  # Block until cancelled
    except asyncio.CancelledError:
        pass
    finally:
        await server.stop()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="ac-dc",
        description="AI-assisted code editing tool",
    )
    parser.add_argument(
        "--server-port", type=int, default=18080,
        help="RPC WebSocket port (default: 18080)",
    )
    parser.add_argument(
        "--webapp-port", type=int, default=18999,
        help="Webapp dev/preview port (default: 18999)",
    )
    parser.add_argument(
        "--no-browser", action="store_true",
        help="Don't auto-open browser",
    )
    parser.add_argument(
        "--repo-path", default=".",
        help="Git repository path (default: current directory)",
    )
    parser.add_argument(
        "--dev", action="store_true",
        help="Run local dev server",
    )
    parser.add_argument(
        "--preview", action="store_true",
        help="Build and run preview server",
    )
    parser.add_argument(
        "--verbose", action="store_true",
        help="Enable debug logging",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    # Configure logging
    level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )

    try:
        asyncio.run(run_server(args))
    except KeyboardInterrupt:
        print("\nShutting down.")


if __name__ == "__main__":
    main()
