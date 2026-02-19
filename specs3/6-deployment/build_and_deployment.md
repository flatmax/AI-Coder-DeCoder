# Build and Deployment

## Running Modes

| Mode | Description | URL |
|------|-------------|-----|
| Hosted (default) | No local webapp. Browser opens GitHub Pages | `https://flatmax.github.io/AI-Coder-DeCoder/{sha}/?port={port}` |
| Local dev (`--dev`) | Vite dev server + RPC server | `http://localhost:{webapp_port}/?port={server_port}` |
| Local preview (`--preview`) | Production build served locally | Same as dev |

## Version-Matching Flow

```
git push master
    ├─ deploy-pages.yml: builds webapp at /{sha}/
    └─ release.yml: bakes version into binary
         │
         ▼
User runs binary
    ├─ Reads VERSION → "2025.01.15-14.32-a1b2c3d4"
    ├─ Extracts SHA → "a1b2c3d4"
    └─ Opens https://flatmax.github.io/AI-Coder-DeCoder/a1b2c3d4/?port=18080
         │
         ▼
Browser → ws://localhost:18080
```

### Version Detection Priority

1. Baked VERSION file (PyInstaller bundle or source install)
2. `git rev-parse HEAD`
3. `.git/HEAD` direct read
4. Fallback: `"dev"` (triggers root redirect)

### SHA Extraction

| Format | Example | SHA |
|--------|---------|-----|
| Baked | `2025.01.15-14.32-a1b2c3d4` | `a1b2c3d4` (rsplit on `-`) |
| Git | `a1b2c3d4...` | first 8 chars |
| Fallback | `dev` | None (root redirect) |

Base URL overridable via `AC_WEBAPP_BASE_URL` environment variable.

## Vite Dev Server Management

For `--dev` mode, a Vite dev server runs as a child process:
- **Port check**: skip if port already in use (assumes another instance)
- **Prerequisite check**: verify `node_modules/` exists, prompt `npm install` if not
- **Process lifecycle**: `subprocess.Popen` with `npm run dev`, terminated on exit
- **Cleanup**: `terminate()` with 5-second timeout, then `kill()` if needed

## Startup Sequence

The startup is split into two phases to give the user early feedback. The browser connects and shows a startup overlay while heavy initialization runs in the background with progress updates.

### Phase 1: Fast (< 1 second)

1. Validate git repository (not a repo → write self-contained HTML to temp file, open as `file://` in browser, print terminal banner with `git init` / `cd` instructions, exit)
2. Find available ports
3. Initialize lightweight services: ConfigManager, Repo, Settings
4. Create LLMService with `deferred_init=True` (no symbol index, no session restore)
5. If `--dev`: start Vite subprocess
6. Register services with JRPCServer and start WebSocket server
7. Open browser (unless `--no-browser`) — user sees startup overlay immediately

### Phase 2: Deferred (progress reported to browser)

8. Wait briefly (500ms) for browser WebSocket connection
9. Initialize SymbolIndex (tree-sitter parser) — progress: 10%
10. Complete deferred LLM init (restore last session) — progress: 30%
11. Index repository (parse all source files, heaviest step, runs in executor) — progress: 50%
12. Initialize stability tracker (tier assignments, reference graph) — progress: 80%
13. Signal ready — progress: 100%, browser dismisses startup overlay
14. Serve forever

Progress is sent via `AcApp.startupProgress(stage, message, percent)` RPC calls. Each stage is best-effort — if the browser isn't connected yet, the call is silently dropped. The `_init_complete` flag on LLMService prevents chat requests from being processed until Phase 2 completes.

### Startup Overlay (Browser)

The browser shows a full-screen overlay with the AC⚡DC brand, a status message, and a progress bar. The overlay updates as `startupProgress` calls arrive:

| Stage | Message | Percent |
|-------|---------|---------|
| (connected) | `Connected — initializing...` | 5% |
| `symbol_index` | `Initializing symbol parser...` | 10% |
| `session_restore` | `Restoring session...` | 30% |
| `indexing` | `Indexing repository...` | 50% |
| `stability` | `Building cache tiers...` | 80% |
| `ready` | `Ready` | 100% |

The overlay fades out 400ms after `stage === 'ready'`. On reconnection (not first connect), the overlay is not shown — only a "Reconnected" toast appears.

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

### Port Selection

`find_available_port(start, max_tries=50)` — tries binding to `127.0.0.1:{start}` through `{start+49}`.

## GitHub Pages Deployment

### Workflow: `deploy-pages.yml`

Trigger: push to `master` or manual dispatch.

1. Build webapp: `npm run build -- --base=/AI-Coder-DeCoder/{sha}/`
2. Copy to `gh-pages/{sha}/`
3. Update `versions.json` manifest (new versions prepended, `latest` updated)
4. Clean up old versions — trim `versions.json` to 20 entries, delete orphan SHA directories
5. Create root redirect `index.html` (fetches `versions.json`, redirects to latest, preserves `?port=` query)
6. Deploy

### Version Registry (`versions.json`)

```json
{
    "latest": "a1b2c3d4",
    "versions": [
        {"sha": "a1b2c3d4", "full_sha": "abc123...", "date": "2025-01-15T14:32:00Z", "branch": "master"},
        {"sha": "e5f6g7h8", "full_sha": "def456...", "date": "2025-01-14T10:00:00Z", "branch": "master"}
    ]
}
```

### Deployed Structure

```
/AI-Coder-DeCoder/
├── index.html          ← redirect to latest
├── versions.json
├── a1b2c3d4/          ← per-commit build
│   ├── index.html
│   └── assets/...
└── ...                 ← up to 20 retained
```

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
       src/ac_dc/main.py
   ```
   **Note:** `--add-data` uses `:` separator on Unix, `;` on Windows. Destination `ac_dc` matches the package name so `Path(__file__).parent` resolves correctly at runtime.
4. Create GitHub Release with all platform binaries attached

## Config Lifecycle in Packaged Builds

The bundled `config/` directory contains sensible defaults:
- `llm.json` — defaults to `anthropic/claude-sonnet-4-20250514` with empty env (no provider-specific settings)
- `system.md`, `compaction.md`, `commit.md`, `system_reminder.md`, `review.md` — current prompts
- `app.json`, `snippets.json`, `review-snippets.json` — default application settings

On first run, all configs are copied to the user config directory. On subsequent releases, managed files (prompts, default settings) are overwritten with backups; user files (`llm.json`, `system_extra.md`) are preserved. See [Configuration — Packaged Builds](../1-foundation/configuration.md#packaged-builds) for details.

## Python Version

The `pyproject.toml` specifies the minimum Python version via `requires-python`. **Note:** The current `pyproject.toml` states `requires-python = ">=3.14"`, which is likely an error — Python 3.14 is not yet released. The intended minimum is Python 3.10 or newer. This should be corrected to `requires-python = ">=3.10"`.

## Security

| Area | Policy |
|------|--------|
| File access | Paths resolved relative to repo root; `..` rejected |
| Git | Local operations only (except shallow clone for URLs) |
| WebSocket | Localhost only, no auth (same as any local dev server) |
| Edit blocks | Paths validated against repo root; binary files rejected |
| URL fetching | HTTP(S) only; `file://` rejected; timeouts enforced |

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