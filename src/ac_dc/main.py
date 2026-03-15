"""Main entry point — service construction and server startup.

Phase 1: Fast startup — lightweight services, WebSocket server, open browser.
Phase 2: Deferred — symbol index, stability tracker, doc index (background).
"""

import argparse
import asyncio
import http.server
import logging
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


# ── Port Discovery ────────────────────────────────────────────────

def find_available_port(start: int, max_tries: int = 50) -> int:
    """Find an available port starting from `start`."""
    for offset in range(max_tries):
        port = start + offset
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", port))
                return port
        except OSError:
            continue
    raise RuntimeError(f"No available port in range {start}-{start + max_tries - 1}")


# ── Version Detection ─────────────────────────────────────────────

def _detect_version() -> str:
    """Detect the application version."""
    # 1. Baked VERSION file (PyInstaller or source)
    for candidate in [
        Path(getattr(sys, "_MEIPASS", "")) / "ac_dc" / "VERSION",
        Path(__file__).parent / "VERSION",
    ]:
        if candidate.exists():
            return candidate.read_text(encoding="utf-8").strip()

    # 2. Git SHA
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True, text=True, check=False,
            cwd=Path(__file__).parent,
        )
        if result.returncode == 0:
            return result.stdout.strip()[:12]
    except Exception:
        pass

    # 3. .git/HEAD direct read
    try:
        git_head = Path(__file__).parent.parent.parent / ".git" / "HEAD"
        if git_head.exists():
            content = git_head.read_text().strip()
            if content.startswith("ref:"):
                ref_path = Path(__file__).parent.parent.parent / ".git" / content[5:]
                if ref_path.exists():
                    return ref_path.read_text().strip()[:12]
            else:
                return content[:12]
    except Exception:
        pass

    return "dev"


# ── Static File Server ────────────────────────────────────────────

class _SilentHandler(http.server.SimpleHTTPRequestHandler):
    """Static file server with SPA fallback and suppressed logging."""

    def log_message(self, format, *args):
        pass  # Suppress per-request logging

    def do_GET(self):
        # SPA fallback: paths without extension that aren't real files → index.html
        path = self.translate_path(self.path.split("?")[0])
        if not os.path.exists(path) and "." not in os.path.basename(path):
            self.path = "/index.html"
        try:
            super().do_GET()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def handle_error(self, request, client_address):
        pass  # Suppress error tracebacks


def _start_static_server(
    directory: str, port: int, bind: str = "127.0.0.1",
) -> threading.Thread:
    """Start a threaded static file server in the background."""

    class Handler(_SilentHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=directory, **kwargs)

    server = http.server.ThreadingHTTPServer((bind, port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    logger.info(f"Static server on http://{bind}:{port}/ serving {directory}")
    return thread


# ── Webapp Location ───────────────────────────────────────────────

def _find_webapp_dist() -> Optional[Path]:
    """Find the bundled webapp dist directory."""
    candidates = [
        # PyInstaller bundle
        Path(getattr(sys, "_MEIPASS", "")) / "ac_dc" / "webapp_dist",
        # Source tree
        Path(__file__).parent.parent.parent / "webapp" / "dist",
        # Installed package data
        Path(__file__).parent / "webapp_dist",
    ]
    for p in candidates:
        if p.is_dir() and (p / "index.html").exists():
            return p
    return None


# ── Vite Dev Server ───────────────────────────────────────────────

def _start_vite(
    mode: str, port: int, host: str, project_dir: Path,
) -> Optional[subprocess.Popen]:
    """Start Vite dev or preview server as a child process."""
    webapp_dir = project_dir / "webapp"
    if not webapp_dir.exists():
        logger.warning("webapp/ directory not found for Vite")
        return None

    node_modules = project_dir / "node_modules"
    if not node_modules.exists():
        logger.error(
            "node_modules/ not found. Run: npm install"
        )
        return None

    # Check if port is already in use
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", port))
    except OSError:
        logger.info(f"Port {port} already in use — assuming Vite is running")
        return None

    if mode == "dev":
        cmd = ["npm", "run", "dev", "--", "--host", host, "--port", str(port)]
    else:
        cmd = ["npm", "run", "preview", "--", "--host", host, "--port", str(port)]

    proc = subprocess.Popen(
        cmd, cwd=str(project_dir),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    logger.info(f"Vite {mode} server started on {host}:{port} (PID {proc.pid})")
    return proc


# ── Git Repo Validation ──────────────────────────────────────────

_NOT_A_REPO_HTML = """\
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>AC⚡DC — Not a Git Repository</title>
<style>
body { font-family: system-ui; background: #1a1a2e; color: #e0e0e0;
       display: flex; align-items: center; justify-content: center;
       min-height: 100vh; margin: 0; }
.box { background: #16213e; border-radius: 12px; padding: 2rem 3rem;
       max-width: 600px; text-align: center; }
h1 { color: #4fc3f7; } code { color: #f59e0b; }
</style></head>
<body><div class="box">
<h1>AC⚡DC</h1>
<p>The current directory is not a Git repository.</p>
<p>Navigate to a Git repository and try again:</p>
<pre><code>cd /path/to/your/project
ac-dc</code></pre>
<p>Or initialize a new repository:</p>
<pre><code>git init
ac-dc</code></pre>
</div></body></html>
"""


def _validate_git_repo(repo_path: str) -> Optional[Path]:
    """Validate the repo path. Returns resolved Path or None."""
    resolved = Path(repo_path).resolve()
    if not (resolved / ".git").exists():
        return None
    return resolved


# ── Event Callback Factory ────────────────────────────────────────

def _make_event_callback(service_instance):
    """Create an event callback that dispatches to AcApp.{event}."""
    async def event_callback(event_name, *args):
        try:
            call = service_instance.get_call()
            if call:
                await call[f"AcApp.{event_name}"](*args)
        except Exception as e:
            logger.debug(f"Event callback {event_name} failed: {e}")
    return event_callback


def _make_chunk_callback(service_instance, loop):
    """Create a synchronous chunk callback for streaming threads."""
    def chunk_callback(request_id, content):
        try:
            call = service_instance.get_call()
            if call:
                coro = call["AcApp.streamChunk"](request_id, content)
                asyncio.run_coroutine_threadsafe(coro, loop)
        except Exception:
            pass
    return chunk_callback


# ── Startup Progress ──────────────────────────────────────────────

async def _send_progress(event_callback, stage: str, message: str, percent: int):
    """Send startup progress to the browser (best-effort)."""
    try:
        if event_callback:
            await event_callback("startupProgress", stage, message, percent)
    except Exception:
        pass


# ── Main ──────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="AC⚡DC — AI-assisted code editing")
    parser.add_argument("--server-port", type=int, default=18080, help="RPC WebSocket port")
    parser.add_argument("--webapp-port", type=int, default=18999, help="Webapp port")
    parser.add_argument("--no-browser", action="store_true", help="Don't auto-open browser")
    parser.add_argument("--repo-path", default=".", help="Git repository path")
    parser.add_argument("--dev", action="store_true", help="Run local dev server")
    parser.add_argument("--preview", action="store_true", help="Build and preview")
    parser.add_argument("--verbose", action="store_true", help="Debug logging")
    parser.add_argument("--collab", action="store_true", help="Enable collaboration mode")

    args = parser.parse_args()

    # Logging
    level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=level, stream=sys.stderr,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    # Validate git repo
    repo_path = _validate_git_repo(args.repo_path)
    if repo_path is None:
        # Write instruction page and open in browser
        tmp_html = Path(tempfile.gettempdir()) / "ac_dc_not_a_repo.html"
        tmp_html.write_text(_NOT_A_REPO_HTML, encoding="utf-8")
        if not args.no_browser:
            webbrowser.open(f"file://{tmp_html}")
        print(
            "\n  AC⚡DC — Not a Git repository\n"
            f"  Path: {Path(args.repo_path).resolve()}\n\n"
            "  Navigate to a git repository and try again:\n"
            "    cd /path/to/your/project && ac-dc\n\n"
            "  Or initialize a new repository:\n"
            "    git init && ac-dc\n"
        )
        sys.exit(1)

    # Run async main
    try:
        asyncio.run(_async_main(args, repo_path))
    except KeyboardInterrupt:
        print("\nAC⚡DC shutting down.")


async def _async_main(args, repo_path: Path):
    """Async entry — Phase 1 fast startup, then Phase 2 deferred init."""
    from ac_dc.config_manager import ConfigManager
    from ac_dc.repo import Repo
    from ac_dc.settings import Settings
    from ac_dc.llm_service import LLMService

    version = _detect_version()
    bind_host = "0.0.0.0" if args.collab else "127.0.0.1"

    # ── Phase 1: Fast Startup ─────────────────────────────────────

    # 1. Initialize lightweight services
    config = ConfigManager(repo_path)
    repo = Repo(repo_path)
    settings = Settings(config)

    # Doc convert (optional)
    doc_convert = None
    try:
        from ac_dc.doc_convert import DocConvert
        doc_convert = DocConvert(repo, config)
    except Exception as e:
        logger.debug(f"DocConvert unavailable: {e}")

    # 2. Create LLM service with deferred init
    llm_service = LLMService(
        config_manager=config,
        repo=repo,
        symbol_index=None,
        deferred_init=True,
    )

    # 3. Restore last session eagerly (before server starts)
    llm_service._restore_last_session()

    # 4. Find available ports
    server_port = find_available_port(args.server_port)
    webapp_port = find_available_port(args.webapp_port)

    # 5. Register with RPC server
    collab = None
    collab_server = None

    if args.collab:
        from ac_dc.collab import Collab, CollabServer
        collab = Collab()
        collab_server = CollabServer(
            port=server_port, collab=collab, remote_timeout=120,
        )
        collab_server.add_class(collab, "Collab")
        collab_server.add_class(repo)
        collab_server.add_class(llm_service)
        collab_server.add_class(settings)
        if doc_convert:
            collab_server.add_class(doc_convert)

        # Wire collab references
        llm_service._collab = collab
        repo._collab = collab
        settings._collab = collab  # type: ignore
        if doc_convert:
            doc_convert._collab = collab

        server = collab_server
    else:
        from jrpc_oo import JRPCServer
        server = JRPCServer(port=server_port, remote_timeout=120)
        server.add_class(repo)
        server.add_class(llm_service)
        server.add_class(settings)
        if doc_convert:
            server.add_class(doc_convert)

    # 6. Wire callbacks
    loop = asyncio.get_running_loop()
    event_callback = _make_event_callback(llm_service)
    chunk_callback = _make_chunk_callback(llm_service, loop)
    llm_service._event_callback = event_callback
    llm_service._chunk_callback = chunk_callback
    if doc_convert:
        doc_convert._event_callback = event_callback

    # 7. Start WebSocket server
    if args.collab and collab_server:
        await collab_server.start()
    else:
        await server.start()

    logger.info(f"WebSocket RPC server on ws://{bind_host}:{server_port}/")

    # 8. Start webapp server
    vite_proc = None
    if args.dev or args.preview:
        project_dir = Path(__file__).parent.parent.parent
        mode = "dev" if args.dev else "preview"
        vite_proc = _start_vite(mode, webapp_port, bind_host, project_dir)
    else:
        webapp_dist = _find_webapp_dist()
        if webapp_dist:
            _start_static_server(str(webapp_dist), webapp_port, bind_host)
        else:
            logger.error(
                "No bundled webapp found. Build first:\n"
                "  cd webapp && npm install && npm run build\n"
                "Or use --dev mode for development."
            )
            return

    # 9. Open browser
    url = f"http://localhost:{webapp_port}/?port={server_port}"
    print(f"\n  AC⚡DC v{version}")
    print(f"  Repo: {repo_path.name}")
    print(f"  URL:  {url}")
    print(f"  Model: {config.model}\n")

    if not args.no_browser:
        webbrowser.open(url)

    # ── Phase 2: Deferred Initialization ──────────────────────────

    async def _heavy_init():
        # Wait for browser to connect
        await asyncio.sleep(0.5)

        # 8a. Initialize symbol index
        await _send_progress(event_callback, "symbol_index",
                             "Initializing symbol parser...", 10)
        symbol_index = None
        try:
            from ac_dc.symbol_index.index import SymbolIndex
            from ac_dc.symbol_index.parser import TreeSitterParser
            symbol_index = await loop.run_in_executor(
                None, lambda: SymbolIndex(repo_path),
            )
        except Exception as e:
            logger.warning(f"Symbol index init failed: {e}")

        # 8b. Complete deferred init
        await _send_progress(event_callback, "session_restore",
                             "Completing initialization...", 30)
        try:
            await loop.run_in_executor(
                None, llm_service.complete_deferred_init, symbol_index,
            )
        except Exception as e:
            logger.warning(f"Deferred init failed: {e}")

        # 8c. Index repository in batches
        if symbol_index:
            await _send_progress(event_callback, "indexing",
                                 "Indexing repository...", 50)
            try:
                files = await loop.run_in_executor(
                    None, symbol_index._get_source_files,
                )
                batch_size = 20
                for i in range(0, len(files), batch_size):
                    batch = files[i:i + batch_size]
                    for f in batch:
                        await loop.run_in_executor(None, symbol_index.index_file, f)
                    await asyncio.sleep(0)  # Yield for WebSocket pings
                    pct = 50 + int(40 * min(i + batch_size, len(files)) / max(len(files), 1))
                    await _send_progress(
                        event_callback, "indexing",
                        f"Indexing repository... {min(i + batch_size, len(files))}/{len(files)}",
                        pct,
                    )

                # Build reference index
                await loop.run_in_executor(
                    None,
                    symbol_index._ref_index.build,
                    symbol_index._all_symbols,
                )
            except Exception as e:
                logger.warning(f"Repository indexing failed: {e}")

        # 8d. Initialize stability tracker
        await _send_progress(event_callback, "stability",
                             "Building cache tiers...", 90)
        try:
            await loop.run_in_executor(
                None, llm_service._try_initialize_stability,
            )
        except Exception as e:
            logger.warning(f"Stability init failed: {e}")

        # 8e. Signal ready
        await _send_progress(event_callback, "ready", "Ready", 100)
        logger.info("Initialization complete")

        # 8f. Background doc index
        asyncio.ensure_future(_background_doc_index())

    async def _background_doc_index():
        """Build document index in background after ready signal."""
        try:
            from ac_dc.doc_index.index import DocIndex
            doc_config = config.doc_index_config
            keyword_model = doc_config.get("keyword_model")

            doc_index = await loop.run_in_executor(
                None,
                lambda: DocIndex(repo_path, keyword_model=keyword_model),
            )

            # Phase 1: Structure extraction (fast)
            repo_files = set(repo.get_flat_file_list().splitlines())
            await loop.run_in_executor(
                None, doc_index.index_repo, repo_files,
            )

            llm_service._doc_index = doc_index
            logger.info("Doc index ready (structure extracted)")

            # Notify browser
            await _send_progress(
                event_callback, "doc_index_ready",
                "Document index ready", 100,
            )

            # Phase 2: Keyword enrichment (slow, per-file)
            if doc_config.get("keywords_enabled", True) and doc_index.keywords_available:
                # Pre-initialize model
                enricher = doc_index._get_enricher()
                if enricher:
                    await loop.run_in_executor(None, enricher.pre_init_model)

                outlines = list(doc_index._all_outlines.keys())
                enrichable = [p for p in outlines if not p.lower().endswith(".svg")]

                if enrichable:
                    try:
                        await event_callback("compactionEvent", "", {
                            "stage": "doc_enrichment_queued",
                            "files": enrichable,
                        })
                    except Exception:
                        pass

                    for i, path in enumerate(enrichable):
                        try:
                            await loop.run_in_executor(
                                None, doc_index.enrich_single_file, path,
                            )
                            await asyncio.sleep(0)  # Yield for pings

                            await event_callback("compactionEvent", "", {
                                "stage": "doc_enrichment_file_done",
                                "file": path,
                            })
                        except Exception as e:
                            logger.warning(f"Enrichment failed for {path}: {e}")
                            try:
                                await event_callback("compactionEvent", "", {
                                    "stage": "doc_enrichment_failed",
                                    "file": path,
                                    "error": str(e),
                                })
                            except Exception:
                                pass

                    try:
                        await event_callback("compactionEvent", "", {
                            "stage": "doc_enrichment_complete",
                        })
                    except Exception:
                        pass

                    logger.info("Doc keyword enrichment complete")

        except ImportError:
            logger.debug("Doc index dependencies unavailable")
        except Exception as e:
            logger.warning(f"Background doc index failed: {e}")

    # Launch Phase 2 as background task
    asyncio.ensure_future(_heavy_init())

    # Serve forever
    try:
        await asyncio.Future()  # Block until interrupted
    finally:
        # Cleanup
        if vite_proc:
            vite_proc.terminate()
            try:
                vite_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                vite_proc.kill()


if __name__ == "__main__":
    main()