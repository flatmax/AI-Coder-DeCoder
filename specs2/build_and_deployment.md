# Build and Deployment

## Overview

The webapp is a web-component-based SPA. It connects to the terminal backend over WebSocket. Three running modes are supported: hosted (production), local dev, and local preview.

## Running Modes

### Mode 1: Hosted Webapp (Default)

No local webapp server. The terminal app starts only the RPC WebSocket server. The browser opens a pre-built webapp hosted on GitHub Pages.

```pseudo
URL = https://flatmax.github.io/AI-Coder-DeCoder/{version_sha}/?port={server_port}
```

The version SHA matches the running codebase so the webapp is always compatible with the backend.

### Mode 2: Local Dev Server

Starts a Vite dev server alongside the RPC server. Provides hot module replacement for development.

```pseudo
URL = http://localhost:{webapp_port}/?port={server_port}
```

### Mode 3: Local Preview

Builds the webapp, then serves the production bundle locally. For testing production builds.

## Version-Matching Flow

The core problem: the desktop binary must open the **exact** webapp version it was built with. This is solved by baking the version into the binary and deploying each commit's webapp to a SHA-specific directory on GitHub Pages.

### End-to-End Flow

```
git push master
    │
    ├─ deploy-pages.yml: builds webapp at /AI-Coder-DeCoder/{sha}/
    │
    └─ release.yml: bakes version "2025.01.15-14.32-{sha}" into binary
         │
         ▼
User runs binary
    │
    ├─ Reads VERSION file → "2025.01.15-14.32-a1b2c3d4"
    ├─ Extracts SHA → "a1b2c3d4"
    ├─ Constructs URL → https://flatmax.github.io/AI-Coder-DeCoder/a1b2c3d4/?port=18080
    │
    ▼
Browser loads hosted webapp
    │
    ├─ Reads ?port=18080 from URL
    └─ Connects ws://localhost:18080 back to local RPC server
```

### Version Detection (`get_version()`)

Priority chain for determining the current version:

1. **Baked VERSION file** — checked first; works in PyInstaller bundles
   - PyInstaller bundle: `{_MEIPASS}/ac_dc/VERSION` or `{_MEIPASS}/VERSION`
   - Source install: `src/ac_dc/VERSION`
2. **`git rev-parse HEAD`** — subprocess call, works during development
3. **`.git/HEAD` direct read** — fallback if git binary unavailable (reads ref, resolves to SHA)
4. **Fallback**: `"dev"` (triggers root redirect URL)

### SHA Extraction (`get_git_sha()`)

Extracts the 8-character short SHA from the version string:

| Version Format | Example | SHA Extracted |
|----------------|---------|---------------|
| Baked (date-sha) | `2025.01.15-14.32-a1b2c3d4` | `a1b2c3d4` (rsplit on `-`) |
| Git (raw sha) | `a1b2c3d4` | `a1b2c3d4` (first 8 chars) |
| Fallback | `dev` | `None` (use root redirect) |

### Browser URL Construction

| Mode | URL |
|------|-----|
| `--dev` | `http://localhost:{webapp_port}/?port={server_port}` |
| Normal (SHA found) | `https://flatmax.github.io/AI-Coder-DeCoder/{sha}/?port={server_port}` |
| Normal (no SHA) | `https://flatmax.github.io/AI-Coder-DeCoder/?port={server_port}` (root redirect) |

The base URL is overridable via `AC_WEBAPP_BASE_URL` environment variable.

## Startup Sequence

1. Validate git repository (if not a repo, open a self-contained HTML page in the browser showing AC⚡DC branding, repo path, and instructions; print terminal banner with `git init` / `cd <repo>` instructions, and exit)
2. Find available ports (server port required, webapp port for local modes)
3. Initialize services: ConfigManager, Repo, LLM, Settings
4. Register service classes with JRPCServer
5. Print connection info and version
6. If `--dev` mode: start Vite dev server subprocess
7. Start RPC WebSocket server
8. Open browser (unless `--no-browser`)
9. Serve forever (cleanup Vite subprocess and stop server on exit)

### CLI Arguments

| Flag | Default | Description |
|------|---------|-------------|
| `--server-port` | 18080 | RPC WebSocket port |
| `--webapp-port` | 18999 | Webapp dev/preview port |
| `--no-browser` | false | Don't auto-open browser |
| `--repo-path` | cwd | Git repository path |
| `--dev` | false | Run local dev server |
| `--preview` | false | Build and run preview server |
| `--verbose` | false | Enable debug logging |

### Port Selection

`find_available_port(start, max_tries=50)` — tries binding to `127.0.0.1:{start}` through `{start+49}`, returns the first available port.

## Webapp Dev Server Management

For `--dev` mode, a Vite dev server runs as a child process:

- **Port check**: skip if port already in use (assumes another instance running)
- **Prerequisite check**: verify `node_modules/` exists, prompt `npm install` if not
- **Process lifecycle**: `subprocess.Popen` with `npm run dev`, terminated on app exit
- **Port passed** via `PORT` environment variable
- **Cleanup**: `terminate()` with 5-second timeout, then `kill()` if needed

## GitHub Pages Deployment (CI)

### Workflow: `deploy-pages.yml`

**Trigger:** Push to `master` or manual dispatch.

**Pipeline:**

1. Checkout source into `source/`
2. Checkout `gh-pages` branch into `gh-pages/` (or initialize fresh)
3. Install Node.js 20, run `npm ci`
4. Get short SHA (first 8 chars of commit hash)
5. Build webapp: `npm run build -- --base=/AI-Coder-DeCoder/{sha}/`
6. Copy build output to `gh-pages/{sha}/`
7. Update `versions.json` manifest
8. Clean up old versions (keep last 20)
9. Create root `index.html` redirect page
10. Commit and push to `gh-pages` branch
11. Deploy via GitHub Pages action

### Deployed Structure on GitHub Pages

```
/AI-Coder-DeCoder/
├── index.html          ← redirect to latest version
├── versions.json       ← version manifest
├── a1b2c3d4/          ← build from commit a1b2c3d4
│   ├── index.html
│   └── assets/...
├── e5f6g7h8/          ← build from commit e5f6g7h8
│   ├── index.html
│   └── assets/...
└── ...                 ← up to 20 versions retained
```

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

New versions are prepended (newest first). `latest` always points to the most recent.

### Root Redirect Page

The root `index.html` dynamically computes the repo name and redirects:

```javascript
const repoName = 'AI-Coder-DeCoder';
fetch('/' + repoName + '/versions.json')
    .then(r => r.json())
    .then(data => {
        const query = window.location.search;
        window.location.href = '/' + repoName + '/' + data.latest + '/' + query;
    });
```

Query parameters (especially `?port=`) are preserved through the redirect. This is the fallback when the binary can't determine its SHA.

### Version Cleanup

On each deploy, the workflow:
1. Trims `versions.json` to the 20 most recent entries
2. Scans `gh-pages/` for SHA directories not in the keep list
3. Deletes old directories

## Binary Releases (CI)

### Workflow: `release.yml`

**Trigger:** Push to `master` or manual dispatch.

**Platforms:**

| Runner | Output Binary |
|--------|---------------|
| `ubuntu-latest` | `ac-dc-linux` |
| `windows-latest` | `ac-dc-windows.exe` |
| `macos-latest` (ARM) | `ac-dc-macos` |

### Build Steps (per platform)

1. Checkout source
2. Setup Python 3.13
3. Compute version: `YYYY.MM.DD-HH.MM-{short_sha}` (24-hour time for same-day ordering)
4. Bake version file: write version string to `src/ac_dc/VERSION`
5. Install dependencies: `pip install pyinstaller && pip install -e .`
6. Run PyInstaller with `--onefile`
7. Upload build artifact

### PyInstaller Configuration

```bash
pyinstaller \
    --onefile \
    --name ac-dc-{platform} \
    --add-data "src/ac_dc/VERSION:ac_dc" \
    --add-data "src/ac_dc/config:ac_dc/config" \
    --collect-all=litellm \
    --collect-all=tiktoken \
    --collect-all=tiktoken_ext \
    --collect-all=tree_sitter \
    --collect-all=tree_sitter_python \
    --collect-all=tree_sitter_javascript \
    --collect-all=tree_sitter_typescript \
    --collect-all=tree_sitter_c \
    --collect-all=tree_sitter_cpp \
    --collect-all=trafilatura \
    --hidden-import=boto3 \
    --hidden-import=botocore \
    src/ac_dc/main.py
```

**`--add-data` paths:**
- Unix separator: `src:dst` (colon)
- Windows separator: `src;dst` (semicolon)
- Destination `ac_dc` matches the Python package name so `Path(__file__).parent` resolves correctly at runtime

### Release Job

After all platform builds complete:
1. Download all artifacts
2. Compute release tag: `YYYY.MM.DD-HH.MM-{short_sha}`
3. Generate release notes with download table
4. Create GitHub Release with all three binaries attached

### Release Tag Format

```
2025.01.15-14.32-a1b2c3d4
│         │     │
│         │     └─ First 8 chars of git SHA
│         └─ 24-hour time (UTC) — ensures ordering for same-day releases
└─ Date (UTC)
```

## WebSocket Connection

The webapp extracts the server port from `?port=N` in the URL and constructs `ws://localhost:{port}` for the RPC connection:

```javascript
const urlParams = new URLSearchParams(window.location.search);
const port = urlParams.get('port') || '8765';
this.serverURI = `ws://localhost:${port}`;
```

## Build Considerations

### Web Component Framework

The webapp uses **Lit** (web components) with no additional framework. Components extend `LitElement` for reactive rendering, lifecycle management, and shadow DOM scoping.

### jrpc-oo Compatibility

jrpc-oo's browser client (`jrpc-client.js`) already extends LitElement. The webapp components can extend `JRPCClient` directly or use a mixin. Source transforms may be needed at build time to:
- Replace environment detection with direct imports
- Handle mixed CommonJS/ESM modules

### Editor Integration

Monaco Editor is installed via npm (`monaco-editor` package) and bundled with the application. Lazy-load on first use of the diff viewer to keep initial bundle small. Configure the bundler to handle Monaco's web workers.

### Entry Points

Each major component has a one-line registration module that imports its implementation. The HTML entry point loads only the root component; others are loaded on demand via the template system.

## Logging

### Approach

Structured logging to stderr. No log files — stderr is sufficient for a developer tool; users can redirect if needed.

### Levels

| Level | Usage |
|-------|-------|
| ERROR | Exceptions with tracebacks, fatal failures |
| WARN | Recoverable issues (parse failures, cache misses, timeout retries) |
| INFO | LLM requests with token counts, edit application results, cache tier changes, startup/shutdown |
| DEBUG | RPC calls, chunk delivery, symbol index timing, config loading |

**Default**: INFO. Enable DEBUG via `--verbose` CLI flag.

### Frontend

`console.error` for RPC failures and connection issues. No logging framework — browser dev tools are sufficient.

## Security Considerations

### File Access

All file operations resolve paths relative to the git repo root. Paths containing `..` traversal are rejected. The resolved absolute path is verified to remain under the repo root before any read or write. Config files use hardcoded type keys mapped to known paths — no arbitrary file path access through the settings RPC.

### Git Operations

Only operate on the repository specified at startup. No remote git operations except shallow clone for URL handling (to a temporary directory, cleaned up after use).

### WebSocket

Binds to localhost only — not externally accessible. No authentication required; same trust model as any local dev server (e.g., webpack-dev-server, Jupyter). Other local applications may connect; this is acceptable for a developer tool.

### Edit Blocks

File paths from LLM-generated edit blocks are validated against the repo root before any write. Binary files are rejected before content is touched.

### URL Fetching

Only HTTP(S) URLs are accepted. `file://` and other schemes are rejected. Timeouts are enforced on all fetches. Content extraction strips scripts and active content.

## `.ac-dc/` Directory

A per-repository working directory at `{repo_root}/.ac-dc/`. Created on first run and added to `.gitignore`.

### Contents

| File | Purpose | Lifecycle |
|------|---------|-----------|
| `history.jsonl` | Persistent conversation history | Append-only |
| `symbol_map.txt` | Current symbol map | Rebuilt on startup and before each LLM request |
| `snippets.json` | Per-repo prompt snippets (optional) | User-managed |

This directory is **not** committed to the repository. The `.gitignore` entry is created automatically on first use.

## README.md Generation

The repository root contains a `README.md` that serves as a combined user guide and developer reference. Keep it as a single file with these sections in order:

1. **Title & tagline** — project name with lightning bolt, one-sentence description
2. **Philosophy** — speed-over-agency stance and the hybrid workflow (sprint → hit wall → agent → return)
3. **Features** — one bullet per capability, one sentence each, no elaboration
4. **Quick Start** — platform binaries from releases, `chmod`, run from git repo
5. **Configuration** — two subsections:
   - LLM config with provider examples (Anthropic, OpenAI, Ollama, OpenAI-compatible local, Bedrock, Azure, Vertex) as copy-pasteable JSON blocks, plus a field reference table
   - App config with defaults table
6. **Workflow** — numbered steps from task description through commit
7. **Keyboard Shortcuts** — table reflecting actual implementations:
   - `chat-input.js` `_onKeyDown`: Enter, Shift+Enter, Escape, ↑ at start, ↓ at end
   - `diff-viewer.js` `_onKeyDown`: Ctrl/Cmd+S, Ctrl/Cmd+W
   - `ac-dialog.js` `KEYBOARD_SHORTCUTS` + `_onGlobalKeyDown`: Alt+1..5, Alt+M
   - When shortcuts change in code, update the table to match
8. **Development** — prerequisites, setup, run modes table, CLI options table, test commands, tech stack with library links, project structure tree with one-line file descriptions
9. **License** — MIT

### Style rules

- One sentence per feature bullet — no multi-paragraph explanations
- Tables for all reference data (config fields, CLI options, shortcuts)
- Project structure tree must mirror actual file layout — update on file add/remove/rename
- No screenshots, videos, or embedded media in the markdown

## Graceful Degradation

| Failure | Behavior |
|---------|----------|
| Tree-sitter parse failure | Skip file in symbol index, log warning. File still appears in tree and can be selected — just no symbols. |
| LLM provider down/timeout | `streamComplete` with error message displayed in chat. User can retry. |
| Git operation fails | Return `{error: message}` from RPC. UI shows error toast or message in chat. File tree doesn't update. |
| Commit fails | Error shown in chat. Files remain staged. |
| URL fetch fails | Chip shows error state. Content not included in context. User can retry. |
| WebSocket disconnect | Client shows reconnecting indicator, retries automatically. On reconnect, fetches full state from server. |
| Config file corrupt/missing | Use built-in defaults. Log warning. Settings panel displays the error. |
| Symbol cache corrupt | Clear in-memory cache, rebuild from source. No persisted state to corrupt. |
| Compaction LLM failure | Return safe defaults (no boundary, 0 confidence). History unchanged. Retry on next trigger. |
| Emergency token overflow | Oldest messages truncated without summarization if history exceeds 2× compaction trigger. |