"""AC-DC startup orchestrator — Layer 6.

Two-phase startup:

Phase 1 (fast, < 1 second):
  - Validate git repo
  - Find available ports
  - Initialize lightweight services (ConfigManager, Repo, Settings, DocConvert)
  - Create LLMService with deferred_init=True
  - Restore last session BEFORE starting WebSocket server
  - Register services with JRPCServer, start it
  - Open browser

Phase 2 (background, non-blocking):
  - Initialize SymbolIndex via run_in_executor
  - Complete deferred LLM init (wire symbol index)
  - Index repository in batches
  - Build reference index
  - Initialize stability tracker
  - Signal ready

Governing spec: specs4/6-deployment/startup.md
"""

from __future__ import annotations

# os is imported first so the env-var setdefaults below
# fire before any import that might transitively load
# numpy / scipy / sklearn / torch and bake in their BLAS
# thread-pool sizes.
import os

# Constrain native math libraries to a single thread BEFORE
# any import that might pull numpy/scipy/sklearn/torch.
# Field incident: segfault inside OpenBLAS's threaded SGEMM
# kernel (sgemm_oncopy_SKYLAKEX) during KeyBERT's MMR
# cosine-similarity computation. The crash reproduces on
# Python 3.14 + OpenBLAS in threaded mode and disappears
# when OpenBLAS is restricted to one thread.
#
# These env vars only take effect if set BEFORE the library
# is loaded — once OpenBLAS or MKL has initialised its
# thread pool the count is baked in for the lifetime of
# the process. Setting them here, at the top of main.py,
# ensures the safety net is in place before any ac_dc
# import runs.
#
# setdefault preserves explicit user overrides (e.g. for
# benchmarking). The cost of single-threaded BLAS for
# keyword enrichment is negligible — bottleneck is the
# sentence-transformer forward pass, not the matmul.
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("BLIS_NUM_THREADS", "1")
os.environ.setdefault("VECLIB_MAXIMUM_THREADS", "1")

import asyncio
import atexit
import faulthandler
import io
import logging
import signal
import sys
import traceback
import webbrowser
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


# Enable faulthandler at module import — earliest point
# in the AC-DC process lifecycle. Dumps a Python traceback
# on SIGSEGV / SIGABRT / SIGFPE / SIGBUS / SIGILL to stderr,
# even when the fault is inside a C extension (KeyBERT,
# sentence-transformers, torch, PyMuPDF, tree-sitter).
# Without this, a native crash leaves only "Segmentation
# fault (core dumped)" with no Python context.
#
# Guarded because pytest's capture fixture replaces sys.stderr
# with an in-memory buffer that lacks ``fileno()``, and
# faulthandler.enable() raises ``io.UnsupportedOperation`` in
# that case. The guard preserves crash diagnostics in real
# runs (where stderr is a tty or a real file) and silently
# skips installation under capture. Falls back to the raw
# stderr file descriptor (2) when the high-level stream is
# not usable but the underlying fd still is.
try:
    faulthandler.enable()
except (io.UnsupportedOperation, ValueError, OSError):
    try:
        faulthandler.enable(file=2)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Exit-trigger diagnostics
# ---------------------------------------------------------------------------
#
# Field incident: AC-DC processes have been exiting with no
# log line preceding the post-exit ``resource_tracker``
# semaphore warning. The existing signal handler only logs
# SIGINT/SIGTERM, so any other exit path (uncaught exception
# in a background task, sys.exit from unexpected code,
# event-loop crash, OOM kill) leaves no breadcrumbs and we
# can't distinguish "user closed browser" from "doc-index
# task crashed silently" from "main coroutine returned
# normally".
#
# Three hooks installed below catch every Python-visible
# exit path:
#
# 1. ``atexit`` — fires on every clean Python interpreter
#    shutdown. Logs the moment the process starts its
#    final unwind, regardless of who triggered it.
# 2. ``sys.excepthook`` — fires on unhandled exceptions in
#    the main thread. Captures the traceback before
#    Python's default handler prints to stderr and exits.
# 3. ``asyncio`` loop exception handler — fires on
#    unhandled exceptions in background tasks (doc-index
#    build, enrichment loop, post-write hooks). Without
#    this, a bug in a task's own error-handling path
#    silently kills the task; the loop keeps running
#    but the work it represented is lost.
#
# The first two are installed at module load (before any
# ac_dc import that might transitively spawn threads or
# tasks). The asyncio handler is installed at the top of
# ``run()`` once we have a loop reference.


def _on_atexit() -> None:
    """Mark the start of process unwind.

    Fires on any clean exit — signal handler, sys.exit,
    main coroutine return, exception in main thread that
    propagates to the top. Pairs with the
    ``resource_tracker`` warning that fires later in the
    same unwind: if we see this log line, the unwind was
    Python-driven; if not, the process died abruptly
    (segfault, OOM kill, kill -9) and faulthandler /
    kernel dmesg are the next things to check.

    Uses ``os.write`` directly rather than the logger
    because by the time atexit handlers run the logging
    module's stream handlers may already be torn down by
    pytest's capture machinery (or any harness that closes
    stderr early). The logging module catches the
    resulting ``ValueError`` internally and prints a
    "--- Logging error ---" diagnostic to stderr, which is
    noisy and unhelpful at this stage. The raw fd write is
    both more reliable and quieter.
    """
    try:
        os.write(2, b"[ac-dc] atexit: process unwinding...\n")
    except Exception:
        pass


atexit.register(_on_atexit)


def _excepthook(
    exc_type: type[BaseException],
    exc_value: BaseException,
    exc_tb: Any,
) -> None:
    """Log unhandled exceptions in the main thread.

    Replaces Python's default excepthook with one that
    routes through our logger first, then chains to the
    default so the user still sees the traceback on
    stderr. KeyboardInterrupt is handled specially —
    it's the user's Ctrl+C and shouldn't get a scary
    "unhandled exception" log line; the signal handler
    logs the shutdown intent properly.
    """
    if issubclass(exc_type, KeyboardInterrupt):
        # Defer to default — signal handler logs cleanly.
        sys.__excepthook__(exc_type, exc_value, exc_tb)
        return
    try:
        logger.error(
            "Unhandled exception in main thread: %s",
            "".join(
                traceback.format_exception(
                    exc_type, exc_value, exc_tb
                )
            ),
        )
    except Exception:
        pass
    # Chain to default so stderr still shows the traceback
    # for users who don't have the log open.
    sys.__excepthook__(exc_type, exc_value, exc_tb)


sys.excepthook = _excepthook


def _asyncio_exception_handler(
    loop: asyncio.AbstractEventLoop,
    context: dict[str, Any],
) -> None:
    """Log unhandled exceptions from background asyncio tasks.

    asyncio's default handler logs to its own logger at
    ERROR level, which the user typically doesn't see in
    the steady-state output. Routing through our logger
    plus a structured prefix makes these visible in the
    same place as the rest of AC-DC's diagnostics.

    The ``context`` dict carries the exception object
    (``"exception"``), the message (``"message"``), and
    sometimes the future / task / handle that raised
    (``"future"`` / ``"task"`` / ``"handle"``). We log
    all three so a wedged background task can be
    identified by name in the log.
    """
    message = context.get("message", "asyncio error")
    exception = context.get("exception")
    task = context.get("task") or context.get("future")
    try:
        if exception is not None:
            tb = "".join(
                traceback.format_exception(
                    type(exception), exception, exception.__traceback__
                )
            )
            logger.error(
                "asyncio unhandled exception: %s | task=%r\n%s",
                message, task, tb,
            )
        else:
            logger.error(
                "asyncio unhandled error: %s | task=%r | context=%r",
                message, task, context,
            )
    except Exception:
        # Logger failure mid-shutdown — fall back to default.
        loop.default_exception_handler(context)


def _find_webapp_dist() -> Path | None:
    """Locate the built webapp directory.

    Priority:
    1. PyInstaller bundle (sys._MEIPASS)
    2. Source tree (project_root/webapp/dist)
    3. Installed package data (package_dir/webapp_dist)
    """
    # PyInstaller bundle
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        candidate = Path(meipass) / "ac_dc" / "webapp_dist"
        if candidate.is_dir():
            return candidate

    # Source tree — walk up from this file to find webapp/dist
    pkg_dir = Path(__file__).resolve().parent
    project_root = pkg_dir.parent.parent
    candidate = project_root / "webapp" / "dist"
    if candidate.is_dir():
        return candidate

    # Installed package data
    candidate = pkg_dir / "webapp_dist"
    if candidate.is_dir():
        return candidate

    return None


def _write_not_a_repo_page(repo_path: str) -> str:
    """Write a self-contained HTML instruction page and return path."""
    import tempfile

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>AC⚡DC</title>
<style>
body {{ background: #0d1117; color: #c9d1d9; font-family: system-ui;
       display: flex; justify-content: center; align-items: center;
       min-height: 100vh; margin: 0; }}
.box {{ text-align: center; max-width: 600px; padding: 2rem; }}
h1 {{ font-size: 4rem; opacity: 0.18; margin-bottom: 1rem; }}
.path {{ color: #58a6ff; font-family: monospace; font-size: 1.1rem; }}
pre {{ background: #161b22; padding: 1rem; border-radius: 8px;
       text-align: left; color: #7ee787; }}
</style></head><body><div class="box">
<h1>AC⚡DC</h1>
<p>The path is not a git repository:</p>
<p class="path">{repo_path}</p>
<pre>cd {repo_path}\ngit init</pre>
<p>Or run ac-dc from inside an existing repository.</p>
</div></body></html>"""

    fd, path = tempfile.mkstemp(suffix=".html", prefix="ac-dc-")
    os.write(fd, html.encode("utf-8"))
    os.close(fd)
    return path


async def _send_progress(
    event_callback: Any,
    stage: str,
    message: str,
    percent: int,
) -> None:
    """Best-effort progress notification to the browser."""
    if event_callback is None:
        return
    try:
        await event_callback("startupProgress", stage, message, percent)
    except Exception:
        pass  # Browser may not be connected yet


async def _heavy_init(
    llm_service: Any,
    repo: Any,
    config: Any,
    event_callback: Any,
) -> None:
    """Phase 2 — heavy initialization as a background task.

    Runs via ensure_future so the event loop stays free for
    WebSocket frames (pings, RPC calls).
    """
    from ac_dc.symbol_index.index import SymbolIndex

    loop = asyncio.get_event_loop()

    # Brief pause for browser to connect
    await asyncio.sleep(0.5)

    # Step 1: Initialize symbol index
    await _send_progress(event_callback, "symbol_index",
                         "Initializing symbol parser...", 10)
    try:
        symbol_index = await loop.run_in_executor(
            None, lambda: SymbolIndex(repo.root)
        )
    except Exception as exc:
        logger.warning("Symbol index construction failed: %s", exc)
        symbol_index = None

    # Step 2: Complete deferred init
    await _send_progress(event_callback, "session_restore",
                         "Completing initialization...", 30)
    if symbol_index is not None:
        try:
            await loop.run_in_executor(
                None, lambda: llm_service.complete_deferred_init(symbol_index)
            )
        except Exception as exc:
            logger.warning("Deferred init failed: %s", exc)

    # Step 2b: Schedule the doc index background build. Split
    # from complete_deferred_init because that method runs in
    # an executor thread (step 2 wraps it in run_in_executor),
    # where asyncio.get_event_loop() returns a fresh dead loop
    # rather than the main one. We're back on the event loop
    # thread now, so schedule_doc_index_build can safely call
    # asyncio.get_running_loop() and ensure_future against the
    # real loop.
    try:
        llm_service.schedule_doc_index_build()
    except Exception as exc:
        logger.warning("Doc index build scheduling failed: %s", exc)

    # Step 3: Index repository in batches
    if symbol_index is not None and repo is not None:
        await _send_progress(event_callback, "indexing",
                             "Indexing repository...", 50)
        try:
            flat = await loop.run_in_executor(
                None, repo.get_flat_file_list
            )
            file_list = [f for f in flat.split("\n") if f]
            # Seed the import resolver's file set BEFORE
            # per-file indexing so _resolve_imports_for_file
            # can populate Import.resolved_target correctly.
            # Without this, every resolver lookup during
            # per-file indexing returns None (the resolver's
            # file set is empty), every import gets
            # resolved_target=None, and cross-file
            # Go-to-Definition silently fails. The full
            # index_repo path does this via set_files; the
            # batched path here has to replicate it.
            await loop.run_in_executor(
                None,
                lambda: symbol_index._resolver.set_files(file_list),
            )
            batch_size = 20
            total = len(file_list)
            for i in range(0, total, batch_size):
                batch = file_list[i:i + batch_size]
                await loop.run_in_executor(
                    None,
                    lambda b=batch: [symbol_index.index_file(f) for f in b]
                )
                await asyncio.sleep(0)  # yield for WebSocket pings
                pct = 50 + int(40 * min(i + batch_size, total) / max(total, 1))
                await _send_progress(
                    event_callback, "indexing",
                    f"Indexing repository... {min(i + batch_size, total)}/{total}",
                    pct,
                )
            # Resolve cross-file call-site targets now that every
            # file's imports are in place. index_repo does this
            # automatically; the batched path has to call it
            # explicitly. Without it, call sites keep
            # target_file=None and references / Go-to-Def on
            # function calls fall back to symbol-name lookups
            # that may miss the mark.
            await loop.run_in_executor(
                None, symbol_index._resolve_call_sites,
            )
            # Build reference index after all files
            await loop.run_in_executor(
                None,
                lambda: symbol_index._ref_index.build(
                    list(symbol_index._all_symbols.values())
                )
            )
        except Exception as exc:
            logger.warning("Repository indexing failed: %s", exc)

    # Step 4: Initialize stability tracker
    await _send_progress(event_callback, "stability",
                         "Building cache tiers...", 80)
    try:
        await loop.run_in_executor(
            None, llm_service._try_initialize_stability
        )
    except Exception as exc:
        logger.warning("Stability init failed: %s", exc)

    # Step 5: Signal ready
    await _send_progress(event_callback, "ready", "Ready", 100)
    logger.info("Initialization complete")


def _start_static_server(
    webapp_dir: Path,
    port: int,
    host: str = "127.0.0.1",
) -> None:
    """Start a threaded HTTP server for the bundled webapp.

    Runs in a daemon thread so it doesn't block shutdown.
    """
    import http.server
    import threading

    class _Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__(*args, directory=str(webapp_dir), **kwargs)

        def log_message(self, format: str, *args: Any) -> None:
            pass  # Silent

        def do_GET(self) -> None:
            # SPA fallback — requests without extension that don't
            # match a real file serve index.html
            path = self.translate_path(self.path)
            if not Path(path).exists() and "." not in Path(self.path).name:
                self.path = "/index.html"
            try:
                super().do_GET()
            except (BrokenPipeError, ConnectionResetError):
                pass

    class _Server(http.server.ThreadingHTTPServer):
        def handle_error(self, request: Any, client_address: Any) -> None:
            exc = sys.exc_info()[1]
            if isinstance(exc, (BrokenPipeError, ConnectionResetError)):
                return
            super().handle_error(request, client_address)

    server = _Server((host, port), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    logger.info("Static file server on http://%s:%d", host, port)


async def run(
    repo_path: str | Path | None = None,
    server_port: int = 18080,
    webapp_port: int = 18999,
    no_browser: bool = False,
    dev: bool = False,
    preview: bool = False,
    verbose: bool = False,
    collab: bool = False,
    experimental: bool = False,
) -> None:
    """Main entry point — runs the two-phase startup.

    Called from cli.py or directly for programmatic use.
    """
    from ac_dc.config import ConfigManager
    from ac_dc.doc_convert import DocConvert
    from ac_dc.logging_setup import configure
    from ac_dc.repo import Repo, RepoError
    from ac_dc.rpc import RpcServer, find_available_port
    from ac_dc.settings import Settings

    configure(verbose=verbose)

    # Install the asyncio loop exception handler now that
    # logging is configured. Must run before any
    # ``ensure_future`` / ``create_task`` call that could
    # schedule a background coroutine — placed here, at the
    # top of run(), so every background task spawned by
    # subsequent code (doc-index build, enrichment loop,
    # cache warmer, agent streams, post-write hooks) is
    # covered.
    try:
        _loop = asyncio.get_running_loop()
        _loop.set_exception_handler(_asyncio_exception_handler)
        logger.info("asyncio exception handler installed")
    except RuntimeError:
        # No running loop yet — caller invoked run() outside
        # an event loop. Defensive: shouldn't happen in
        # practice (cli.py calls asyncio.run(main())), but
        # if it does the handler simply isn't installed and
        # asyncio's default error logging applies.
        logger.warning(
            "run(): no running event loop; asyncio "
            "exception handler not installed"
        )

    # Resolve repo path
    if repo_path is None:
        repo_path = Path.cwd()
    repo_path = Path(repo_path).resolve()

    # Step 1: Validate git repo
    try:
        repo = Repo(repo_path)
    except RepoError:
        page = _write_not_a_repo_page(str(repo_path))
        print(
            f"\n  AC⚡DC — Not a git repository: {repo_path}\n"
            f"  Run: cd {repo_path} && git init\n",
            file=sys.stderr,
        )
        if not no_browser:
            webbrowser.open(f"file://{page}")
        return

    # Step 2: Find available ports. Both the WebSocket and
    # webapp ports are probed so two concurrent AC-DC
    # instances don't silently collide on the default port.
    # Without probing the webapp port, a second instance
    # would fail to bind (OSError in the static-server
    # thread or Vite crash-loop) but still open a browser
    # pointing at the *first* instance's webapp — producing
    # the confusing "AC-DC4 title bar, AC-DC code" bug.
    try:
        server_port = find_available_port(start=server_port)
    except RuntimeError as exc:
        logger.error("Could not find server port: %s", exc)
        return
    logger.info("WebSocket server port: %d", server_port)
    try:
        webapp_port = find_available_port(start=webapp_port)
    except RuntimeError as exc:
        logger.error("Could not find webapp port: %s", exc)
        return
    logger.info("Webapp server port: %d", webapp_port)

    # Step 3: Initialize lightweight services
    config = ConfigManager(repo_root=repo_path)
    # Export the env vars declared in llm.json into the
    # process environment now, before any litellm completion
    # is constructed. Without this, providers that read env
    # at client-construction time (notably bedrock via boto3)
    # pick up the shell's AWS_REGION / AWS_PROFILE rather
    # than the values the user configured in the UI — and
    # the first turn fails until the user saves llm.json
    # (which triggers ConfigManager.reload_llm_config and
    # finally exports the env). Calling apply_llm_env here
    # rather than inside ConfigManager.__init__ keeps
    # construction side-effect-free for tests and other
    # non-runtime consumers.
    config.apply_llm_env()
    settings = Settings(config)
    # DocConvert is constructed later (after event_callback is
    # defined) so progress events can flow to the browser.

    # Step 4: Start webapp server (bundled or dev)
    bind_host = "0.0.0.0" if collab else "127.0.0.1"
    vite_process = None

    if dev or preview:
        # Vite dev/preview server
        import subprocess
        import shutil

        node_modules = repo_path.parent / "webapp" / "node_modules"
        # Try finding webapp relative to the package
        pkg_dir = Path(__file__).resolve().parent
        project_root = pkg_dir.parent.parent
        webapp_dir = project_root / "webapp"
        if not webapp_dir.is_dir():
            webapp_dir = repo_path / "webapp"

        if not (webapp_dir / "node_modules").is_dir():
            logger.error(
                "webapp/node_modules not found. Run: cd webapp && npm install"
            )
            return

        # Preview mode always rebuilds. Without it,
        # `vite preview` silently serves whatever stale
        # bundle was last built — users see old code and
        # the browser may fail to register as AcApp at all
        # if the backend contract changed since the last
        # build. The `prebuild` hook in webapp/package.json
        # wipes dist/ and Vite's dep cache so every
        # --preview starts from a clean slate; Vite's
        # incremental build keeps the cost small when
        # nothing changed.
        if preview:
            logger.info(
                "Running `npm run build` for --preview "
                "(clean rebuild via prebuild hook)..."
            )
            try:
                build_result = subprocess.run(
                    ["npm", "run", "build"],
                    cwd=str(webapp_dir),
                    timeout=300,
                )
            except FileNotFoundError:
                logger.error(
                    "npm not found on PATH. Install Node.js, or "
                    "build manually: cd webapp && npm run build"
                )
                return
            except subprocess.TimeoutExpired:
                logger.error(
                    "npm run build timed out after 5 minutes. "
                    "Try running it manually: "
                    "cd webapp && npm run build"
                )
                return
            if build_result.returncode != 0:
                logger.error(
                    "npm run build failed (exit %d). "
                    "See output above.",
                    build_result.returncode,
                )
                return
            if not (webapp_dir / "dist").is_dir():
                logger.error(
                    "Build completed but webapp/dist is still "
                    "missing — check webapp/vite.config.js"
                )
                return
            logger.info("Build complete.")

        cmd = ["npx"]
        if dev:
            cmd.extend(["vite", "--host", bind_host, "--port", str(webapp_port)])
        else:
            cmd.extend(["vite", "preview", "--host", bind_host, "--port", str(webapp_port)])

        # Surface Vite's stdout/stderr so build errors or port
        # binding failures are visible. Previously piped to
        # DEVNULL, which hid the "dist/ not found" message
        # and made the hang impossible to diagnose.
        try:
            vite_process = subprocess.Popen(
                cmd,
                cwd=str(webapp_dir),
            )
            logger.info("Vite %s server started (PID %d)",
                        "dev" if dev else "preview", vite_process.pid)
        except Exception as exc:
            logger.error("Failed to start Vite: %s", exc)
            return
    else:
        # Bundled static server
        webapp_dist = _find_webapp_dist()
        if webapp_dist is None:
            logger.error(
                "No built webapp found. Either:\n"
                "  - Run: cd webapp && npm install && npm run build\n"
                "  - Use: ac-dc --dev (for development)"
            )
            return
        _start_static_server(webapp_dist, webapp_port, bind_host)

    # Step 5: Create LLMService with deferred init
    from ac_dc.llm_service import LLMService
    from ac_dc.history_store import HistoryStore

    # Create history store in the per-repo working dir.
    # Use the config-managed path so the name (.ac-dc4) is
    # defined in exactly one place (config._AC_DC_DIR).
    ac_dc_dir = config.ac_dc_dir or (repo_path / ".ac-dc4")
    history_store = HistoryStore(ac_dc_dir)

    # Event callback — will be wired after the server starts
    event_callback_ref: list[Any] = [None]

    async def event_callback(event_name: str, *args: Any) -> None:
        cb = event_callback_ref[0]
        if cb is not None:
            try:
                await cb(event_name, *args)
            except Exception:
                pass

    # DocConvert wired with the same event callback so
    # docConvertProgress events reach the browser. The
    # callback is a closure over event_callback_ref which
    # the real dispatcher replaces once the RPC server is up.
    doc_convert = DocConvert(
        config, repo=repo, event_callback=event_callback,
    )

    llm_service = LLMService(
        config=config,
        repo=repo,
        symbol_index=None,
        event_callback=event_callback,
        history_store=history_store,
        deferred_init=True,
        experimental=experimental,
    )

    # Wire the LLMService reference into Settings so
    # reload_app_config can refresh the system prompt when
    # app-config changes affect prompt composition (notably
    # the agents.enabled toggle). Done post-construction
    # because Settings is built before LLMService; matches
    # the pattern used for _collab on every service.
    settings._llm_service = llm_service

    # Step 6: Restore last session BEFORE starting the server
    # (already done in LLMService.__init__ via _restore_last_session)

    # Step 7: Register services with RPC server and start
    if collab:
        from ac_dc.collab import Collab, CollabServer
        collab_instance = Collab()
        server = CollabServer(
            port=server_port,
            remote_timeout=120,
            collab=collab_instance,
        )
        server.add_service(collab_instance)
        # Wire collab to all services
        llm_service._collab = collab_instance
        repo._collab = collab_instance
        settings._collab = collab_instance
        doc_convert._collab = collab_instance
    else:
        server = RpcServer(
            port=server_port,
            host=bind_host,
            remote_timeout=120,
        )

    server.add_service(repo)
    server.add_service(llm_service)
    server.add_service(settings)
    server.add_service(doc_convert)

    # Wire the post-write callback — every successful file
    # write/create/rename on Repo triggers
    # LLMService._on_doc_file_written, which decides (based
    # on extension, mode, and cross-ref state) whether to
    # invalidate the doc-index cache entry, re-extract the
    # outline, and schedule keyword enrichment. Matches the
    # specs4/2-indexing/document-index.md § Triggers contract
    # for "LLM edits" and "user edits in viewer" — both paths
    # go through Repo.write_file, so one hook covers both.
    repo._post_write_callback = llm_service._on_doc_file_written

    await server.start()
    logger.info("WebSocket server started on ws://%s:%d", bind_host, server_port)

    # Wire the event callback now that the server is up.
    # The LLM service's event_callback dispatches to
    # AcApp.{event_name}(...) on all connected browsers.
    # jrpc-oo injects get_call() onto instances registered via
    # add_class, so llm_service.get_call() is available after
    # server.add_service(llm_service) above.
    def _make_real_callback() -> Any:
        async def _cb(event_name: str, *args: Any) -> None:
            # Try both get_call() (method form) and .call
            # (attribute form) — jrpc-oo's injection shape
            # varies by version.
            call = None
            try:
                call = llm_service.get_call()
            except AttributeError:
                call = getattr(llm_service, "call", None)
            if call is None:
                logger.warning(
                    "Event callback: no call proxy available for %s",
                    event_name,
                )
                return
            method_key = f"AcApp.{event_name}"
            try:
                method = call[method_key]
            except (KeyError, TypeError) as exc:
                logger.warning(
                    "Event callback: no remote method %s (%s)",
                    method_key, exc,
                )
                return
            try:
                result = method(*args)
                # jrpc-oo methods may return coroutines or
                # plain values; await when awaitable.
                if hasattr(result, "__await__"):
                    await result
            except Exception as exc:
                logger.warning(
                    "Event callback %s raised: %s",
                    event_name, exc,
                )
        return _cb

    event_callback_ref[0] = _make_real_callback()
    logger.info("Event callback wired (llm_service=%s)", type(llm_service).__name__)
    # Log what jrpc-oo has injected so we can diagnose which
    # form of the call proxy is available.
    logger.info(
        "llm_service attributes: get_call=%s call=%s",
        hasattr(llm_service, "get_call"),
        hasattr(llm_service, "call"),
    )

    # Step 8: Open browser
    url = f"http://localhost:{webapp_port}/?port={server_port}"
    if experimental:
        # Enables UI affordances flagged `locked: true` — e.g.
        # the agentic coding toggle in settings. The webapp
        # reads ?experimental=1 from window.location and
        # treats it as a session-scoped override.
        url += "&experimental=1"
    if not no_browser:
        webbrowser.open(url)
        logger.info("Browser opened: %s", url)
    else:
        logger.info("Webapp URL: %s", url)

    # Launch Phase 2 as a background task
    asyncio.ensure_future(
        _heavy_init(llm_service, repo, config, event_callback)
    )

    # Keep the server running
    def _signal_handler(sig: int, frame: Any) -> None:
        logger.info("Shutting down (signal=%d)...", sig)
        if vite_process is not None:
            try:
                logger.info("Terminating Vite process...")
                vite_process.terminate()
                vite_process.wait(timeout=5)
                logger.info("Vite process terminated cleanly.")
            except Exception as exc:
                logger.warning(
                    "Vite terminate failed: %s — sending SIGKILL",
                    exc,
                )
                try:
                    vite_process.kill()
                except Exception:
                    pass
        # llm_service.shutdown() tears down the three thread
        # pools (stream, aux, warmer). The aux pool runs
        # KeyBERT enrichment which spawns joblib/loky worker
        # processes; if those don't drain we leak the
        # semaphore observed in the field. Logging entry/exit
        # gives a timestamp pair to correlate against the
        # resource_tracker warning that fires post-exit.
        logger.info("Shutting down LLMService...")
        try:
            llm_service.shutdown()
            logger.info("LLMService shutdown complete.")
        except Exception as exc:
            logger.warning(
                "LLMService shutdown raised: %s", exc
            )
        sys.exit(0)

    signal.signal(signal.SIGINT, _signal_handler)
    signal.signal(signal.SIGTERM, _signal_handler)

    # SIGCONT logger — fires when the process resumes from
    # Ctrl+Z / SIGSTOP. The first segfault incident
    # followed a suspend/resume cycle; logging the resume
    # gives us a timestamp to correlate against the next
    # crash. Native extensions (joblib's loky pool, torch
    # workers, PyMuPDF) don't always survive suspension —
    # the parent's first call into them post-resume is
    # the likely fault site.
    #
    # Signal handlers can't safely call into Python's
    # logger on every platform, so we use os.write directly.
    # Best-effort: if even that fails we swallow it.
    def _on_sigcont(_sig: int, _frame: Any) -> None:
        try:
            os.write(
                2,
                b"[ac-dc] SIGCONT received - process resumed "
                b"from suspension. Native extensions (KeyBERT, "
                b"PyMuPDF, tree-sitter) may be in inconsistent "
                b"state; segfault-on-next-call is possible.\n",
            )
        except Exception:
            pass
    try:
        signal.signal(signal.SIGCONT, _on_sigcont)
    except (OSError, ValueError):
        # Some environments (Windows, certain restricted
        # sandboxes) don't allow SIGCONT handlers. Not
        # critical — just lose the marker on those.
        pass

    try:
        await asyncio.Event().wait()
    except (KeyboardInterrupt, asyncio.CancelledError):
        _signal_handler(0, None)