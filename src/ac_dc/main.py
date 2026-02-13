"""AC⚡DC — AI-assisted code editing tool.

Entry point: CLI parsing, port scanning, service initialization,
browser launch, and WebSocket server startup.
"""

import argparse
import logging
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
import webbrowser
from pathlib import Path

logger = logging.getLogger(__name__)

# HTML page shown when not in a git repo
NOT_A_REPO_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AC⚡DC — Not a Git Repository</title>
<style>
  body {{
    background: #0d1117; color: #c9d1d9; font-family: -apple-system, sans-serif;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 100vh; margin: 0; padding: 2rem;
  }}
  .brand {{ font-size: 4rem; opacity: 0.18; margin-bottom: 2rem; }}
  .msg {{ font-size: 1.2rem; max-width: 600px; text-align: center; line-height: 1.6; }}
  .path {{ color: #58a6ff; font-family: monospace; word-break: break-all; }}
  code {{ background: #161b22; padding: 0.2em 0.5em; border-radius: 4px; color: #7ee787; }}
</style>
</head>
<body>
  <div class="brand">AC⚡DC</div>
  <div class="msg">
    <p>The directory <span class="path">{repo_path}</span> is not a git repository.</p>
    <p>To get started:</p>
    <p><code>cd /path/to/your/project</code></p>
    <p><code>git init</code></p>
    <p>Then run <code>ac-dc</code> again.</p>
  </div>
</body>
</html>
"""

# Version detection
def _get_version():
    """Detect version from baked VERSION file, git, or fallback.

    Priority:
    1. Baked VERSION file (PyInstaller bundle or source install)
    2. git rev-parse HEAD
    3. .git/HEAD direct read
    4. Fallback: "dev"
    """
    # 1. Baked VERSION file
    version_file = Path(__file__).parent / "VERSION"
    if version_file.exists():
        try:
            return version_file.read_text().strip()
        except OSError:
            pass

    # 2. git rev-parse HEAD
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            return result.stdout.strip()[:8]
    except (OSError, subprocess.TimeoutExpired):
        pass

    # 3. .git/HEAD direct read
    try:
        git_head = Path(".git/HEAD")
        if git_head.exists():
            content = git_head.read_text().strip()
            if content.startswith("ref:"):
                ref_path = Path(".git") / content[5:]
                if ref_path.exists():
                    return ref_path.read_text().strip()[:8]
            else:
                return content[:8]
    except OSError:
        pass

    return "dev"


def _extract_sha(version):
    """Extract short SHA from version string.

    Formats:
    - Baked: "2025.01.15-14.32-a1b2c3d4" -> "a1b2c3d4"
    - Git: "a1b2c3d4..." -> first 8 chars
    - "dev" -> None
    """
    if version == "dev":
        return None
    if "-" in version:
        return version.rsplit("-", 1)[-1]
    return version[:8]


def _is_git_repo(path):
    """Check if path is inside a git repository."""
    try:
        result = subprocess.run(
            ["git", "-C", str(path), "rev-parse", "--git-dir"],
            capture_output=True, text=True, timeout=5,
        )
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def find_available_port(start=18080, max_tries=50):
    """Find an available port starting from `start`.

    Tries binding to 127.0.0.1:{start} through {start+max_tries-1}.
    Returns the first available port.
    """
    for offset in range(max_tries):
        port = start + offset
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", port))
                return port
        except OSError:
            continue
    raise RuntimeError(f"No available port found in range {start}-{start + max_tries - 1}")


def _build_browser_url(server_port, version, dev_mode=False, webapp_port=None,
                       base_url_override=None):
    """Build the browser URL based on running mode.

    Args:
        server_port: RPC WebSocket server port
        version: version string
        dev_mode: if True, use local dev server
        webapp_port: local webapp port (for dev/preview modes)
        base_url_override: AC_WEBAPP_BASE_URL env override

    Returns:
        URL string
    """
    if dev_mode and webapp_port:
        return f"http://localhost:{webapp_port}/?port={server_port}"

    sha = _extract_sha(version)
    base = base_url_override or "https://flatmax.github.io/AI-Coder-DeCoder"

    if sha:
        return f"{base}/{sha}/?port={server_port}"
    else:
        # dev fallback — root redirect
        return f"{base}/?port={server_port}"


def _handle_not_a_repo(repo_path):
    """Handle case where repo_path is not a git repository.

    Opens a self-contained HTML page in browser, prints terminal banner, exits.
    """
    abs_path = os.path.abspath(repo_path)

    # Write HTML to temp file
    html = NOT_A_REPO_HTML.format(repo_path=abs_path)
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".html", prefix="ac-dc-", delete=False
    ) as f:
        f.write(html)
        html_path = f.name

    # Open in browser
    try:
        webbrowser.open(f"file://{html_path}")
    except Exception:
        pass

    # Print terminal banner
    print()
    print("  AC⚡DC")
    print()
    print(f"  Not a git repository: {abs_path}")
    print()
    print("  To get started:")
    print(f"    cd {abs_path}")
    print("    git init")
    print()
    print("  Or specify a repo path:")
    print("    ac-dc --repo-path /path/to/your/project")
    print()

    sys.exit(1)


def _start_vite_dev_server(webapp_port):
    """Start Vite dev server as a child process.

    Returns the subprocess.Popen object, or None if port already in use.
    """
    # Check if port already in use (assume another instance)
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", webapp_port))
    except OSError:
        logger.info(f"Vite dev server port {webapp_port} already in use, skipping")
        return None

    # Resolve AC⚡DC project root (where package.json and webapp/ live)
    # __file__ = src/ac_dc/main.py → project root is two levels up
    project_root = Path(__file__).resolve().parent.parent.parent
    node_modules = project_root / "node_modules"

    # Check prerequisites
    if not node_modules.exists():
        print(f"node_modules/ not found in {project_root}. Run: cd {project_root} && npm install")
        sys.exit(1)

    logger.info(f"Starting Vite dev server on port {webapp_port} (project: {project_root})")
    try:
        proc = subprocess.Popen(
            ["npm", "run", "dev", "--", "--port", str(webapp_port)],
            cwd=str(project_root),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        # Give it a moment to start
        time.sleep(1)
        return proc
    except OSError as e:
        logger.error(f"Failed to start Vite dev server: {e}")
        return None


def _cleanup_vite(proc):
    """Terminate Vite dev server process."""
    if proc is None:
        return
    try:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=2)
    except Exception:
        pass


def parse_args(args=None):
    """Parse CLI arguments."""
    parser = argparse.ArgumentParser(
        prog="ac-dc",
        description="AC⚡DC — AI-assisted code editing tool",
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
        "--repo-path", type=str, default=".",
        help="Git repository path (default: current directory)",
    )
    parser.add_argument(
        "--dev", action="store_true",
        help="Run local Vite dev server",
    )
    parser.add_argument(
        "--preview", action="store_true",
        help="Build and preview locally",
    )
    parser.add_argument(
        "--verbose", action="store_true",
        help="Enable debug logging",
    )
    return parser.parse_args(args)


def main(args=None):
    """Main entry point."""
    parsed = parse_args(args)

    # Configure logging
    level = logging.DEBUG if parsed.verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )

    repo_path = os.path.abspath(parsed.repo_path)

    # Step 1: Validate git repository
    if not _is_git_repo(repo_path):
        _handle_not_a_repo(repo_path)

    # Step 2: Find available ports
    try:
        server_port = find_available_port(parsed.server_port)
    except RuntimeError as e:
        logger.error(str(e))
        sys.exit(1)

    if parsed.dev or parsed.preview:
        try:
            webapp_port = find_available_port(parsed.webapp_port)
        except RuntimeError as e:
            logger.error(str(e))
            sys.exit(1)
    else:
        webapp_port = parsed.webapp_port

    # Step 3: Initialize services
    from .config import ConfigManager
    from .repo import Repo
    from .settings import Settings

    config = ConfigManager(repo_root=repo_path)
    repo = Repo(repo_path)
    settings = Settings(config)

    # Symbol index (optional — may fail if tree-sitter not available)
    symbol_index = None
    try:
        from .symbol_index.index import SymbolIndex
        symbol_index = SymbolIndex(repo_path)
        logger.info("Symbol index initialized")
    except Exception as e:
        logger.warning(f"Symbol index unavailable: {e}")

    # LLM service
    from .llm_service import LLMService
    llm_service = LLMService(
        config, repo=repo, symbol_index=symbol_index,
    )

    # Step 4: Start Vite dev server if --dev
    vite_proc = None
    if parsed.dev:
        vite_proc = _start_vite_dev_server(webapp_port)

    # Step 5: Start RPC WebSocket server
    try:
        from jrpc_oo import JRPCServer
    except ImportError:
        logger.error("jrpc-oo not installed. Run: pip install jrpc-oo")
        sys.exit(1)

    import asyncio

    async def _run_server():
        server = JRPCServer(server_port, remote_timeout=60)
        server.add_class(repo)
        server.add_class(llm_service)
        server.add_class(settings)

        # Wire up callbacks
        async def chunk_callback(request_id, content):
            try:
                call = llm_service.get_call()
                if call:
                    await call["AcApp.streamChunk"](request_id, content)
                else:
                    logger.warning("chunk_callback: get_call() returned None")
            except Exception as e:
                logger.error(f"chunk_callback failed: {e}")

        async def event_callback(event_name, *args):
            try:
                call = llm_service.get_call()
                if call:
                    await call[f"AcApp.{event_name}"](*args)
                else:
                    logger.warning(f"event_callback: get_call() returned None for {event_name}")
            except Exception as e:
                logger.error(f"event_callback failed for AcApp.{event_name}: {e}")

        llm_service._chunk_callback = chunk_callback
        llm_service._event_callback = event_callback

        await server.start()

        version = _get_version()
        base_url = os.environ.get("AC_WEBAPP_BASE_URL")
        url = _build_browser_url(
            server_port, version,
            dev_mode=parsed.dev,
            webapp_port=webapp_port,
            base_url_override=base_url,
        )

        logger.info(f"AC⚡DC server running on ws://localhost:{server_port}")
        logger.info(f"Version: {version}")

        # Step 6: Open browser
        if not parsed.no_browser:
            try:
                webbrowser.open(url)
                logger.info(f"Opened browser: {url}")
            except Exception as e:
                logger.warning(f"Failed to open browser: {e}")
                print(f"\nOpen in browser: {url}\n")

        # Serve forever
        try:
            await asyncio.Future()  # run forever
        except asyncio.CancelledError:
            pass

    def _signal_handler(sig, frame):
        """Handle shutdown signals."""
        _cleanup_vite(vite_proc)
        sys.exit(0)

    signal.signal(signal.SIGINT, _signal_handler)
    signal.signal(signal.SIGTERM, _signal_handler)

    try:
        asyncio.run(_run_server())
    except KeyboardInterrupt:
        pass
    finally:
        _cleanup_vite(vite_proc)


if __name__ == "__main__":
    main()