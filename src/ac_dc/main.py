"""Main entry point: CLI parsing, server startup, browser launch."""

import argparse
import asyncio
import logging
import os
import socket
import subprocess
import sys
import webbrowser
from pathlib import Path

log = logging.getLogger("ac_dc")


def find_available_port(start: int, max_tries: int = 50) -> int:
    """Find an available port starting from the given number."""
    for offset in range(max_tries):
        port = start + offset
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError(f"No available port found starting from {start}")


def _is_port_in_use(port: int) -> bool:
    """Check if a port is already in use."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def _start_vite_dev(webapp_dir: Path, port: int) -> subprocess.Popen | None:
    """Start the Vite dev server as a subprocess.

    Returns the Popen object, or None if skipped.
    """
    if _is_port_in_use(port):
        log.info("Port %d already in use — assuming Vite is running", port)
        return None

    node_modules = webapp_dir / "node_modules"
    if not node_modules.is_dir():
        print(f"\n❌ node_modules not found in {webapp_dir}")
        print(f"   Run: cd {webapp_dir} && npm install\n")
        return None

    env = os.environ.copy()
    env["PORT"] = str(port)

    try:
        proc = subprocess.Popen(
            ["npm", "run", "dev"],
            cwd=str(webapp_dir),
            env=env,
        )
        log.info("Vite dev server started (pid %d) on port %d", proc.pid, port)
        return proc
    except FileNotFoundError:
        print("\n❌ npm not found. Install Node.js to use --dev mode.\n")
        return None
    except Exception as e:
        log.warning("Failed to start Vite dev server: %s", e)
        return None


def get_version() -> str:
    """Detect version from VERSION file or git.

    Returns a version string like '2025.01.15-14.32-a1b2c3d4' (baked)
    or 'a1b2c3d4' (git) or 'dev' (fallback).
    """
    # Check for baked VERSION file (bundled releases)
    locations = [Path(__file__).parent / "VERSION"]

    # PyInstaller sets sys.frozen = True on bundled executables
    if getattr(sys, "frozen", False):
        bundle_dir = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
        locations.insert(0, bundle_dir / "ac_dc" / "VERSION")
        locations.insert(1, bundle_dir / "VERSION")

    for version_file in locations:
        try:
            if version_file.exists():
                return version_file.read_text().strip()
        except (OSError, IOError):
            pass

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

    # Fallback: read .git/HEAD directly
    try:
        git_dir = Path(__file__).parent.parent.parent / ".git"
        head_file = git_dir / "HEAD"
        if head_file.exists():
            head = head_file.read_text().strip()
            if head.startswith("ref: "):
                ref_path = git_dir / head[5:]
                if ref_path.exists():
                    return ref_path.read_text().strip()[:8]
            elif len(head) >= 8:
                return head[:8]
    except (OSError, IOError):
        pass

    return "dev"


def get_git_sha(short: bool = True) -> str | None:
    """Get the git SHA for webapp URL matching.

    Extracts the short SHA from the baked version string or git.
    """
    version = get_version()
    if version == "dev":
        return None

    # Baked version format: '2025.01.15-14.32-a1b2c3d4' — SHA is the last segment
    if "." in version and "-" in version:
        sha = version.rsplit("-", 1)[-1]
        if len(sha) >= 7:
            return sha[:8] if short else sha
        return sha

    # Raw SHA from git
    return version[:8] if short else version


def get_webapp_base_url() -> str:
    """Get the base URL for the hosted webapp."""
    return os.environ.get(
        "AC_WEBAPP_BASE_URL",
        "https://flatmax.github.io/AI-Coder-DeCoder",
    )


async def run_server(args: argparse.Namespace):
    """Start the RPC server and run forever."""
    from .config import ConfigManager
    from .repo import Repo
    from .llm_service import LLM
    from .settings import Settings

    repo_root = Path(args.repo_path).resolve()

    # Validate git repo — open browser with branding, print instructions, exit
    if not (repo_root / ".git").exists():
        print()
        print("=" * 60)
        print("  AC⚡DC")
        print()
        print("  Not a git repository:")
        print(f"  {repo_root}")
        print()
        print("  To get started, run one of:")
        print(f"    git init {repo_root}")
        print(f"    cd <existing-repo> && ac-dc")
        print("=" * 60)
        print()

        if not args.no_browser:
            import tempfile
            html_content = f"""\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>AC⚡DC</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    background: #1a1a2e; color: #e0e0e0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh;
  }}
  .container {{
    text-align: center; padding: 48px;
    background: #16213e; border-radius: 16px;
    border: 1px solid #2a2a4a; box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    max-width: 520px;
  }}
  .brand {{
    font-size: 4rem; font-weight: 700; letter-spacing: 2px;
    margin-bottom: 32px; opacity: 0.85;
  }}
  .brand .bolt {{ color: #ffd700; }}
  .error-title {{
    font-size: 1.2rem; color: #ff6b6b; margin-bottom: 16px; font-weight: 600;
  }}
  .path {{
    font-family: monospace; background: #0f3460; padding: 8px 16px;
    border-radius: 8px; margin: 16px 0; font-size: 0.9rem;
    word-break: break-all; color: #a0c4ff;
  }}
  .instructions {{
    text-align: left; margin-top: 24px; padding: 16px 20px;
    background: #0f3460; border-radius: 8px; line-height: 1.8;
  }}
  .instructions .label {{
    color: #8888aa; font-size: 0.85rem; margin-bottom: 8px;
  }}
  code {{
    background: #1a1a2e; padding: 4px 10px; border-radius: 4px;
    font-size: 0.9rem; color: #7bed9f; display: inline-block;
  }}
</style>
</head>
<body>
<div class="container">
  <div class="brand">AC<span class="bolt">⚡</span>DC</div>
  <div class="error-title">Not a Git Repository</div>
  <div class="path">{repo_root}</div>
  <div class="instructions">
    <div class="label">To get started, run one of:</div>
    <div><code>git init {repo_root}</code></div>
    <div style="margin-top:4px"><code>cd &lt;existing-repo&gt; &amp;&amp; ac-dc</code></div>
  </div>
</div>
</body>
</html>"""
            tmp = tempfile.NamedTemporaryFile(
                suffix=".html", prefix="ac-dc-", delete=False, mode="w",
            )
            tmp.write(html_content)
            tmp.close()
            webbrowser.open(f"file://{tmp.name}")

        sys.exit(1)

    # Find ports
    server_port = find_available_port(args.server_port)
    webapp_port = find_available_port(args.webapp_port) if args.dev else None

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

    print(f"ac-dc v{version}")
    print(f"RPC server: ws://localhost:{server_port}")
    print(f"Repository: {repo_root}")

    # Start Vite dev server in dev mode
    vite_proc = None
    if args.dev:
        webapp_dir = Path(__file__).parent.parent.parent / "webapp"
        loop = asyncio.get_event_loop()
        vite_proc = await loop.run_in_executor(
            None, _start_vite_dev, webapp_dir, webapp_port,
        )
        print(f"Webapp: http://localhost:{webapp_port}/?port={server_port}")

    # Open browser
    if not args.no_browser:
        if args.dev:
            url = f"http://localhost:{webapp_port}/?port={server_port}"
        else:
            base_url = get_webapp_base_url()
            sha = get_git_sha(short=True)
            if sha:
                url = f"{base_url}/{sha}/?port={server_port}"
            else:
                # Fallback: root redirect via versions.json
                url = f"{base_url}/?port={server_port}"

        print(f"Opening: {url}")
        webbrowser.open(url)

    await server.start()

    # Run forever
    try:
        await asyncio.Future()  # Block until cancelled
    except asyncio.CancelledError:
        pass
    finally:
        # Clean up Vite subprocess
        if vite_proc is not None:
            log.info("Stopping Vite dev server (pid %d)", vite_proc.pid)
            vite_proc.terminate()
            try:
                vite_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                vite_proc.kill()
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