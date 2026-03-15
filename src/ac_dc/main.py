"""AC⚡DC — AI-assisted code editing tool.

Entry point: CLI parsing, port scanning, service initialization,
browser launch, and WebSocket server startup.
"""

import argparse
import http.server
import logging
import os
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from pathlib import Path
from urllib.parse import urlparse, unquote

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


def _build_browser_url(server_port, webapp_port, host="localhost"):
    """Build the browser URL for the locally-served webapp.

    Args:
        server_port: RPC WebSocket server port
        webapp_port: local webapp HTTP port
        host: hostname to use in URL

    Returns:
        URL string
    """
    return f"http://{host}:{webapp_port}/?port={server_port}"


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


def _start_vite_dev_server(webapp_port, host="127.0.0.1"):
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

    logger.info(f"Starting Vite dev server on port {webapp_port} host={host} (project: {project_root})")
    try:
        proc = subprocess.Popen(
            ["npm", "run", "dev", "--", "--host", host, "--port", str(webapp_port)],
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


def _start_vite_preview_server(webapp_port, host="127.0.0.1"):
    """Build and start Vite preview server as a child process.

    Returns the subprocess.Popen object, or None if port already in use.
    """
    # Check if port already in use
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", webapp_port))
    except OSError:
        logger.info(f"Preview server port {webapp_port} already in use, skipping")
        return None

    project_root = Path(__file__).resolve().parent.parent.parent
    node_modules = project_root / "node_modules"

    if not node_modules.exists():
        print(f"node_modules/ not found in {project_root}. Run: cd {project_root} && npm install")
        sys.exit(1)

    # Build first
    logger.info(f"Building webapp (project: {project_root})")
    try:
        build_result = subprocess.run(
            ["npm", "run", "build"],
            cwd=str(project_root),
            capture_output=True, text=True, timeout=120,
        )
        if build_result.returncode != 0:
            logger.error(f"Webapp build failed:\n{build_result.stderr}")
            print(f"Webapp build failed:\n{build_result.stderr}")
            sys.exit(1)
    except (OSError, subprocess.TimeoutExpired) as e:
        logger.error(f"Webapp build failed: {e}")
        sys.exit(1)

    # Start preview server
    logger.info(f"Starting Vite preview server on port {webapp_port} host={host}")
    try:
        proc = subprocess.Popen(
            ["npm", "run", "preview", "--", "--host", host, "--port", str(webapp_port)],
            cwd=str(project_root),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        time.sleep(1)
        return proc
    except OSError as e:
        logger.error(f"Failed to start preview server: {e}")
        return None


def _find_webapp_dist():
    """Locate the bundled webapp dist directory.

    Search order:
    1. PyInstaller bundle: sys._MEIPASS/ac_dc/webapp_dist
    2. Source tree: <project_root>/webapp/dist
    3. Installed package: <package_dir>/webapp_dist

    Returns Path or None.
    """
    # 1. PyInstaller bundle
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        candidate = Path(meipass) / "ac_dc" / "webapp_dist"
        if candidate.is_dir():
            return candidate

    # 2. Source tree (main.py is at src/ac_dc/main.py → project root is 3 levels up)
    source_dist = Path(__file__).resolve().parent.parent.parent / "webapp" / "dist"
    if source_dist.is_dir():
        return source_dist

    # 3. Installed package data
    pkg_dist = Path(__file__).resolve().parent / "webapp_dist"
    if pkg_dist.is_dir():
        return pkg_dist

    return None


def _start_static_server(webapp_dir, port, host="127.0.0.1"):
    """Start a simple HTTP static file server in a background thread.

    Serves the pre-built webapp dist directory.  Returns the port actually
    used, or None on failure.
    """
    class _QuietHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(webapp_dir), **kw)

        def log_message(self, fmt, *a):
            pass  # silence per-request logging

        def do_GET(self):
            # SPA fallback — serve index.html for paths that don't match a file
            parsed = urlparse(self.path)
            clean = unquote(parsed.path).lstrip("/")
            fs_path = Path(str(webapp_dir)) / clean
            if not fs_path.exists() and "." not in clean.split("/")[-1]:
                self.path = "/index.html"
            try:
                super().do_GET()
            except BrokenPipeError:
                pass  # client closed connection mid-transfer

    class _ThreadingHTTPServer(http.server.ThreadingHTTPServer):
        """Threaded HTTP server that silences broken-pipe errors."""
        def handle_error(self, request, client_address):
            # Suppress BrokenPipeError / ConnectionResetError from stderr
            import sys
            exc = sys.exc_info()[1]
            if isinstance(exc, (BrokenPipeError, ConnectionResetError)):
                return
            super().handle_error(request, client_address)

    try:
        httpd = _ThreadingHTTPServer((host, port), _QuietHandler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        logger.info(f"Static webapp server on http://{host}:{port} -> {webapp_dir}")
        return port
    except OSError as e:
        logger.error(f"Failed to start static server on port {port}: {e}")
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
    parser.add_argument(
        "--collab", action="store_true",
        help="Enable collaboration mode (LAN-accessible, multi-browser)",
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

    # Step 3: Initialize lightweight services (fast — no heavy parsing)
    from ac_dc.config import ConfigManager
    from ac_dc.repo import Repo
    from ac_dc.settings import Settings
    from ac_dc.doc_convert import DocConvert

    config = ConfigManager(repo_root=repo_path)
    repo = Repo(repo_path)
    settings = Settings(config)
    doc_convert = DocConvert(repo, config)

    # Step 4: Start webapp server (bundled static, Vite dev, or Vite preview)
    vite_proc = None
    webapp_host = "0.0.0.0" if parsed.collab else "127.0.0.1"
    if parsed.dev:
        vite_proc = _start_vite_dev_server(webapp_port, host=webapp_host)
    elif parsed.preview:
        vite_proc = _start_vite_preview_server(webapp_port, host=webapp_host)
    else:
        # Serve bundled webapp via built-in static server
        webapp_dist = _find_webapp_dist()
        if webapp_dist:
            try:
                webapp_port = find_available_port(webapp_port)
            except RuntimeError:
                logger.error("No available port for webapp server")
                sys.exit(1)
            result = _start_static_server(webapp_dist, webapp_port, host=webapp_host)
            if not result:
                logger.error("Failed to start webapp server")
                sys.exit(1)
            logger.info(f"Serving bundled webapp from {webapp_dist}")
        else:
            logger.error(
                "No bundled webapp found. Build it first:\n"
                "  npm install && npm run build\n"
                "Or use --dev mode for development."
            )
            sys.exit(1)

    # Step 5: Start RPC WebSocket server EARLY — before heavy init
    # This lets the browser connect immediately and show progress.
    try:
        from jrpc_oo import JRPCServer
    except ImportError:
        logger.error("jrpc-oo not installed. Run: pip install jrpc-oo")
        sys.exit(1)

    import asyncio

    async def _run_server():
        if parsed.collab:
            # CollabServer for admission-gated multi-browser support.
            # Binds to 0.0.0.0 so LAN clients can connect.
            from ac_dc.collab import CollabServer, Collab

            collab = Collab()
            server = CollabServer(server_port, collab=collab, remote_timeout=120)

            # Attach collab to service instances for RPC restriction checks
            repo._collab = collab
            settings._collab = collab
            doc_convert._collab = collab

            server.add_class(repo)
            server.add_class(settings)
            server.add_class(doc_convert)
            server.add_class(collab)
        else:
            # Single-user mode — plain JRPCServer, localhost only.
            collab = None
            server = JRPCServer(server_port, remote_timeout=120)

            server.add_class(repo)
            server.add_class(settings)
            server.add_class(doc_convert)

        # Step 5.5: Create LLM service and restore last session BEFORE the
        # server starts accepting connections.  This way get_current_state()
        # returns previous session messages as soon as the browser connects.
        # litellm import happens here — if provider SDK init hangs (e.g.
        # boto3 credential chain) the server won't start, but that is
        # preferable to the browser connecting and seeing no history.
        from ac_dc.llm_service import LLMService
        llm_service = LLMService(
            config, repo=repo, symbol_index=None, deferred_init=True,
        )
        llm_service._collab = collab  # For RPC restriction checks (None if single-user)
        llm_service._restore_last_session()
        server.add_class(llm_service)

        await server.start()

        version = _get_version()
        browser_host = "localhost"
        url = _build_browser_url(server_port, webapp_port, host=browser_host)

        logger.info(f"AC⚡DC server running on ws://localhost:{server_port}")
        logger.info(f"Webapp: {url}")
        logger.info(f"Version: {version}")

        # Step 6: Open browser EARLY — before heavy init
        if not parsed.no_browser:
            try:
                webbrowser.open(url)
                logger.info(f"Opened browser: {url}")
            except Exception as e:
                logger.warning(f"Failed to open browser: {e}")
                print(f"\nOpen in browser: {url}\n")

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
        doc_convert._event_callback = event_callback

        # Step 7: Heavy initialization in background with progress reporting
        async def _send_progress(stage, message, percent=None):
            """Send startup progress to browser (best-effort)."""
            try:
                call = llm_service.get_call()
                if call:
                    await call["AcApp.startupProgress"](stage, message, percent)
            except Exception:
                pass  # Browser may not be connected yet

        # Give the browser a moment to connect before sending progress.
        # The heavy init task (below) handles all CPU-bound work via
        # run_in_executor so the event loop stays responsive.
        await asyncio.sleep(0.5)

        # Run all heavy initialization in a single background task so the
        # event loop stays free to handle WebSocket frames.  Each step
        # uses run_in_executor to push CPU work off the event loop thread,
        # with sleeps between to let pings/pongs flow.
        async def _heavy_init():
            loop = asyncio.get_event_loop()

            # Symbol index (optional — may fail if tree-sitter not available)
            symbol_index = None
            try:
                await _send_progress("symbol_index", "Initializing symbol parser...", 10)
                from ac_dc.symbol_index.index import SymbolIndex
                symbol_index = await loop.run_in_executor(
                    None, lambda: SymbolIndex(repo_path),
                )
                logger.info("Symbol index initialized")
            except Exception as e:
                logger.warning(f"Symbol index unavailable: {e}")

            # Complete deferred initialization with symbol index
            await _send_progress("session_restore", "Completing initialization...", 30)
            await loop.run_in_executor(
                None, lambda: llm_service.complete_deferred_init(symbol_index),
            )
            await asyncio.sleep(0)

            # Index repo in small batches
            if symbol_index:
                await _send_progress("indexing", "Indexing repository...", 50)
                try:
                    file_list = repo.get_flat_file_list()
                    total_files = len(file_list)
                    batch_size = 20
                    for batch_start in range(0, total_files, batch_size):
                        batch = file_list[batch_start:batch_start + batch_size]
                        await loop.run_in_executor(
                            None,
                            lambda b=batch: [symbol_index.index_file(f) for f in b],
                        )
                        await asyncio.sleep(0)
                        done = min(batch_start + batch_size, total_files)
                        pct = 50 + int(40 * done / max(total_files, 1))
                        await _send_progress(
                            "indexing",
                            f"Indexing repository... {done}/{total_files}",
                            pct,
                        )
                    symbol_index._ref_index.build(symbol_index._all_symbols)
                    logger.info(f"Repo indexed: {len(symbol_index._all_symbols)} files")
                except Exception as e:
                    logger.warning(f"Repo indexing failed: {e}")

            # Initialize stability tracker
            await _send_progress("stability", "Building cache tiers...", 80)
            await loop.run_in_executor(
                None, llm_service._try_initialize_stability,
            )
            await asyncio.sleep(0)

            await _send_progress("ready", "Ready", 100)
            logger.info("Startup complete — all services initialized")

            # Start doc index build after startup overlay dismisses
            llm_service._start_background_doc_index()

        # Fire the heavy init as a non-blocking task — the event loop
        # continues to serve WebSocket frames while it runs.
        asyncio.ensure_future(_heavy_init())

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