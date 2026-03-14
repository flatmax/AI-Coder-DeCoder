# Build and Deployment

## Running Modes

| Mode | Description | URL |
|------|-------------|-----|
| Bundled (default) | Built-in static server serves bundled webapp | `http://localhost:{webapp_port}/?port={server_port}` |
| Local dev (`--dev`) | Vite dev server + RPC server | `http://localhost:{webapp_port}/?port={server_port}` |
| Local preview (`--preview`) | Vite production build + preview server | Same as dev |

## Bundled Webapp

The webapp is pre-built and bundled with the Python package. At startup, `main.py` locates the built webapp and serves it via a built-in HTTP static file server on the `--webapp-port` (default 18999). The browser opens `http://localhost:{webapp_port}/?port={server_port}`.

### Webapp Location Priority

1. **PyInstaller bundle**: `sys._MEIPASS/ac_dc/webapp_dist/`
2. **Source tree**: `<project_root>/webapp/dist/` (for development after `npm run build`)
3. **Installed package data**: `<package_dir>/webapp_dist/` (for `pip install`)

If no bundled webapp is found, the server exits with an error message instructing the user to build the webapp first (`npm install && npm run build`) or use `--dev` mode.

### Static File Server

A `http.server.ThreadingHTTPServer` runs in a daemon thread, serving files from the webapp dist directory. The threaded server handles concurrent requests (e.g., multiple browser tabs, parallel asset loads). Features:

- **SPA fallback**: requests for paths without a file extension that don't match a real file are served `index.html` (for client-side routing)
- **Silent logging**: per-request logs suppressed to avoid noise
- **Bind address**: `127.0.0.1` by default; `0.0.0.0` when `--collab` is passed
- **Error suppression**: `BrokenPipeError` and `ConnectionResetError` are silently caught in both the request handler (`do_GET`) and the server's `handle_error` override, preventing noisy tracebacks when clients disconnect mid-transfer

### Vite Base Path

`vite.config.js` sets `base: './'` so all asset references use relative paths. This allows the built webapp to be served from any origin without path rewriting.

**Note:** `vite.config.js` hardcodes `host: '0.0.0.0'` for both `server` and `preview` blocks. This only affects developers running `npm run dev` or `npm run preview` directly (outside the `ac-dc` CLI). When launched via the CLI, `main.py` passes `--host` to the Vite subprocess, which overrides the config file value. The hardcoded `0.0.0.0` is a development convenience and has no security impact on production builds (which use the built-in static server, not Vite).

### Version Detection

Version detection is retained for display/logging purposes:

1. Baked VERSION file (PyInstaller bundle or source install)
2. `git rev-parse HEAD`
3. `.git/HEAD` direct read
4. Fallback: `"dev"`

## Vite Dev Server Management

For `--dev` and `--preview` modes only, a Vite server runs as a child process (these modes are for webapp development, not normal usage):
- **Port check**: skip if port already in use (assumes another instance)
- **Prerequisite check**: verify `node_modules/` exists, prompt `npm install` if not
- **Process lifecycle**: `subprocess.Popen` with `npm run dev -- --host {host}`, terminated on exit
- **Bind address**: `127.0.0.1` by default; `0.0.0.0` when `--collab` is passed
- **Cleanup**: `terminate()` with 5-second timeout, then `kill()` if needed

## Startup Sequence

The startup is split into two phases to give the user early feedback. The browser connects and shows a startup overlay while heavy initialization runs in the background with progress updates.

### Phase 1: Fast (< 1 second)

1. Validate git repository (not a repo → write self-contained HTML to temp file, open as `file://` in browser, print terminal banner with `git init` / `cd` instructions, exit)
2. Find available ports
3. Initialize lightweight services: ConfigManager, Repo, Settings
4. Start webapp server: bundled static server (default), Vite dev (`--dev`), or Vite preview (`--preview`)
5. Create LLMService with `deferred_init=True` (no symbol index, no session restore)
6. Register services with JRPCServer and start WebSocket server
7. Open browser (unless `--no-browser`) — user sees startup overlay immediately

### Phase 2: Deferred (non-blocking background task with progress)

Phase 2 runs entirely inside `asyncio.ensure_future()` so the event loop stays free to handle WebSocket frames. Each CPU-bound step uses `run_in_executor` to avoid blocking pings/pongs.

8. Wait briefly (500ms) for browser WebSocket connection
9. Initialize SymbolIndex via `run_in_executor` (tree-sitter parser) — progress: 10%
10. Complete deferred LLM init via `run_in_executor` (wire symbol index) — progress: 30%
11. Index repository in batches of 20 files via `run_in_executor`, with `asyncio.sleep(0)` between batches — progress: 50–90%
12. Build reference index once after all files indexed
13. Initialize stability tracker via `run_in_executor` (tier assignments, reference graph) — progress: 80%
14. Signal ready — progress: 100%, browser dismisses startup overlay
15. Start background doc index build:
    - Structure extraction (<250ms for 50 files) → doc mode toggle enabled immediately
    - Reference index build (<50ms)
    - Queue all files for background keyword enrichment → persistent enrichment toast in chat panel
15. Serve forever

Progress is sent via `AcApp.startupProgress(stage, message, percent)` RPC calls. Each stage is best-effort — if the browser isn't connected yet, the call is silently dropped. The `_init_complete` flag on LLMService prevents chat requests from being processed until Phase 2 completes. Document keyword enrichment runs asynchronously after step 15 and never blocks any user operation — see [Document Mode — Progress Reporting](../2-code-analysis/document_mode.md#progress-reporting).

**File reopen deferral:** The browser delays reopening the last-viewed file until the startup overlay dismisses (i.e., after the `ready` signal). This prevents file-fetch RPC calls from blocking the server's event loop during heavy initialization. On reconnect (when `init_complete` is already true), the file reopens immediately.

### Startup Overlay (Browser)

The browser shows a full-screen overlay with the AC⚡DC brand, a status message, and a progress bar. The overlay updates as `startupProgress` calls arrive:

| Stage | Message | Percent |
|-------|---------|---------|
| (connected) | `Connected — initializing...` | 5% |
| `symbol_index` | `Initializing symbol parser...` | 10% |
| `session_restore` | `Restoring session...` | 30% |
| `indexing` | `Indexing repository... N/M` | 50–90% |
| `stability` | `Building cache tiers...` | 80% |
| `ready` | `Ready` | 100% |

The overlay fades out 400ms after `stage === 'ready'`. On reconnection (not first connect), the overlay is not shown — only a "Reconnected" toast appears. Document index enrichment progress is communicated separately via the persistent enrichment toast in the chat panel (not the startup overlay).

### CLI Arguments

| Flag | Default | Description |
|------|---------|-------------|
| `--server-port` | 18080 | RPC WebSocket port |
| `--webapp-port` | 18999 | Webapp dev/preview port |
| `--no-browser` | false | Don't auto-open browser |
| `--repo-path` | cwd | Git repository path |
| `--dev` | false | Run local dev server |
| `--preview` | false | Build and preview |
| `--verbose` | false | Debug logging |
| `--collab` | false | Enable collaboration mode (listen on all interfaces, admission-gated) |

### Port Selection

`find_available_port(start, max_tries=50)` — tries binding to `127.0.0.1:{start}` through `{start+49}`.

## Binary Releases

### Workflow: `release.yml`

Platforms: Linux, Windows, macOS (ARM).

1. Compute version: `YYYY.MM.DD-HH.MM-{short_sha}` (24-hour UTC time for same-day ordering)
2. Bake VERSION file: write version string to `src/ac_dc/VERSION`
3. PyInstaller with full dependency collection:
   ```bash
   pyinstaller --onefile --name ac-dc-{platform} \
       --add-data "src/ac_dc/VERSION:ac_dc" \
       --add-data "src/ac_dc/config:ac_dc/config" \
       --add-data "webapp/dist:ac_dc/webapp_dist" \
       --collect-all=litellm \
       --collect-all=tiktoken --collect-all=tiktoken_ext \
       --collect-all=tree_sitter \
       --collect-all=tree_sitter_python \
       --collect-all=tree_sitter_javascript \
       --collect-all=tree_sitter_typescript \
       --collect-all=tree_sitter_c \
       --collect-all=tree_sitter_cpp \
       --collect-all=trafilatura \
       --hidden-import=boto3 --hidden-import=botocore \
       src/ac_dc/__main__.py
   ```
   **Note:** `--add-data` uses `:` separator on Unix, `;` on Windows. Destination `ac_dc` matches the package name so `Path(__file__).parent` resolves correctly at runtime. The bundled `webapp_dist` is served locally by the built-in static file server — no internet connection required.
4. Create GitHub Release with all platform binaries attached

## Config Lifecycle in Packaged Builds

The bundled `config/` directory contains sensible defaults:
- `llm.json` — defaults to `anthropic/claude-sonnet-4-20250514` with empty env (no provider-specific settings)
- `system.md`, `compaction.md`, `commit.md`, `system_reminder.md`, `review.md` — current prompts
- `app.json`, `snippets.json` — default application settings

On first run, all configs are copied to the user config directory. On subsequent releases, managed files (prompts, default settings) are overwritten with backups; user files (`llm.json`, `system_extra.md`) are preserved. See [Configuration — Packaged Builds](../1-foundation/configuration.md#packaged-builds) for details.

## Python Version

The `pyproject.toml` specifies `requires-python = ">=3.10"`. The CI release workflow (`release.yml`) builds with Python 3.14.

## Security

| Area | Policy |
|------|--------|
| File access | Paths resolved relative to repo root; `..` rejected |
| Git | Local operations only (except shallow clone for URLs) |
| WebSocket | Localhost only, no auth (same as any local dev server) |
| Edit blocks | Paths validated against repo root; binary files rejected |
| URL fetching | HTTP(S) only; `file://` rejected; timeouts enforced |

## Terminal HUD

Three reports printed to stderr after each LLM response (not a UI component). Additionally, a one-time startup HUD is printed when the stability tracker initializes.

### Startup Init HUD

Printed once during server startup after stability tracker initialization completes:

```
╭─ Initial Tier Distribution ─╮
│ L0       12 items            │
│ L1       18 items            │
│ L2       17 items            │
│ L3       17 items            │
├─────────────────────────────┤
│ Total: 64 items              │
╰─────────────────────────────╯
```

### Post-Response HUD

#### Cache Blocks (Boxed)
```
╭─ Cache Blocks ────────────────────────────╮
│ L0         (12+)    1,622 tokens [cached] │
│ L1          (9+)   11,137 tokens [cached] │
│ L2          (6+)    8,462 tokens [cached] │
│ L3          (3+)      388 tokens [cached] │
│ active             19,643 tokens          │
├───────────────────────────────────────────┤
│ Total: 41,252 | Cache hit: 52%           │
╰───────────────────────────────────────────╯
```

#### Token Usage
```
Model: bedrock/anthropic.claude-sonnet-4-20250514
System:         1,622
Symbol Map:    34,355
Files:              0
History:       21,532
Total:         57,509 / 1,000,000
Last request:  74,708 in, 34 out
Cache:         read: 21,640, write: 48,070
Session total: 182,756
```

#### Tier Changes
```
📈 L3 → L2: symbol:src/ac_dc/context.py
📉 L2 → active: symbol:src/ac_dc/repo.py
```

See [Cache and Assembly — Viewers and HUD Data](../3-llm-engine/cache_and_assembly.md#viewers-and-hud-data) for the full data format and terminal HUD details.

## Logging

Structured to stderr. Default: INFO. `--verbose` enables DEBUG.

| Level | Usage |
|-------|-------|
| ERROR | Exceptions, fatal failures |
| WARN | Recoverable issues |
| INFO | LLM requests, edit results, cache changes, startup |
| DEBUG | RPC calls, chunks, symbol timing, config |

## README Generation

Single `README.md` with sections in order: title, philosophy, features, quick start, configuration (with provider examples), workflow, keyboard shortcuts, development, license.

### Style Rules
- One sentence per feature bullet — no multi-paragraph explanations
- Tables for all reference data (config fields, CLI options, shortcuts)
- Project structure tree must mirror actual file layout — update on file add/remove/rename
- No screenshots, videos, or embedded media
- Update keyboard shortcuts table when code changes