# Webapp Build & Deployment

The webapp is a Lit-based single-page application bundled by Vite. It
connects to the Python backend over WebSocket JRPC. The build and
deployment pipeline supports three modes: hosted GitHub Pages (production),
local dev server, and local preview server.

## Project Structure

```
webapp/
├── index.html              # Entry HTML
├── package.json            # Dependencies and scripts
├── vite.config.js          # Vite build configuration
├── app-shell.js            # Component registration entry points
├── prompt-view.js          │
├── context-viewer.js       │
├── file-picker.js          │
├── find-in-files.js        │
├── history-browser.js      │
├── settings-panel.js       │
└── src/                    # Component source (see other specs)
    ├── app-shell/
    ├── context-viewer/
    ├── diff-viewer/
    ├── file-picker/
    ├── find-in-files/
    ├── history-browser/
    ├── lsp/
    ├── prompt/
    ├── services/
    ├── settings/
    └── utils/
```

### Entry Point Modules

Each top-level `.js` file is a one-line re-export that registers a web
component by importing its source:

```js
// app-shell.js
import './src/app-shell/AppShell.js';
```

These files exist to give Vite clean entry points and to decouple
registration from implementation. `index.html` loads only `app-shell.js`
directly:

```html
<script type="module" src="/app-shell.js"></script>
```

Other components are loaded on demand via Lit's template system — when
`<prompt-view>`, `<file-picker>`, etc. appear in rendered HTML, the browser
fetches their modules.

## Dependencies

### Runtime

| Package | Version | Purpose |
|---------|---------|---------|
| `@flatmax/jrpc-oo` | ^1.0.0 | WebSocket JRPC client for backend communication |
| `lit` | ^3.0.0 | Web component framework |
| `marked` | ^9.0.0 | Markdown rendering in chat messages |
| `monaco-editor` | ^0.45.0 | Diff viewer / code editor (CDN-loaded at runtime) |
| `prismjs` | ^1.29.0 | Syntax highlighting in chat code blocks |

### Dev

| Package | Version | Purpose |
|---------|---------|---------|
| `vite` | ^5.0.0 | Build tool and dev server |
| `playwright` | ^1.40.0 | Demo recording (not used for tests) |

## Vite Configuration

### JRPC Fixes Plugin

`@flatmax/jrpc-oo` uses `Window` globals and browser/Node.js detection
patterns that break with ESM bundlers. A custom Vite plugin `jrpcFixes()`
applies source transforms at build time:

| File | Fix |
|------|-----|
| `JRPCCommon.js` | Replaces browser/node detection `if/else` with direct `require()` calls for `ExposeClass`, `JRPC`, `lit`, `crypto`. Replaces `new Window.JRPC(` with `new JRPC(`. Replaces dual-mode export with `module.exports`. |
| `jrpc-client.js` | Replaces `Window.JRPCCommon` reference with direct `require()`. |
| `JRPCExport.js` | Replaces side-effect `import 'jrpc/jrpc.min.js'` with proper default import. |
| `jrpc/jrpc.js` | Replaces `require('timers').setImmediate` with browser-compatible polyfill using `setTimeout`. |

The plugin only transforms files matching `@flatmax/jrpc-oo` or
`jrpc/jrpc.js` in their path.

### Build Settings

```js
{
  base: '/',                           // Overridden by --base in CI
  optimizeDeps: { exclude: ['@flatmax/jrpc-oo'] },
  server: { port: process.env.PORT || 8999 },
  preview: { port: process.env.PORT || 8999 },
  build: {
    target: 'esnext',
    commonjsOptions: { transformMixedEsModules: true }
  }
}
```

`@flatmax/jrpc-oo` is excluded from dependency pre-bundling because the
custom plugin needs to transform it during the full build, not during
Vite's pre-optimization step.

The `base` path defaults to `/` for local development but is set to
`/<repo-name>/<sha>/` during CI builds for versioned GitHub Pages
deployment.

## Monaco Editor Loading

Monaco is **not bundled** by Vite. It is loaded at runtime from CDN via
`MonacoLoaderMixin`:

```
https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/loader.js
```

`index.html` includes a `<link rel="preload">` hint for the loader script
to reduce first-paint latency when the diff viewer tab is opened.

A local fallback path (`/node_modules/monaco-editor/min/vs`) is defined
but CDN is tried first. Loading is lazy — Monaco scripts are fetched only
when the diff viewer is first rendered.

## Running Modes

### Mode 1: Hosted Webapp (Default)

The default mode. No local webapp server is started. The Python backend
starts only the JRPC WebSocket server, and the browser opens the pre-built
webapp hosted on GitHub Pages.

```
ac-dc                                    # or: ac-dc --server-port 18080
```

**URL construction** (`get_browser_url()`):

```
https://flatmax.github.io/AI-Coder-DeCoder/<sha>/?port=<server_port>
```

- `<sha>` is the 8-char git SHA of the running codebase, obtained by
  `get_git_sha()`.
- Falls back to the root URL (which redirects to latest version via JS)
  if SHA detection fails.
- The `?port=` query parameter tells the webapp which WebSocket port to
  connect to.

**SHA detection** (`ac/version.py`):

1. **Baked version**: Checks for a `VERSION` file (used in PyInstaller
   bundles) at `ac/VERSION`, repo root, or `sys._MEIPASS`.
2. **Git command**: Runs `git rev-parse HEAD`.
3. **Fallback**: Reads `.git/HEAD` directly (handles detached HEAD and
   ref resolution).
4. Returns `None` if all methods fail.

### Mode 2: Local Dev Server

```
ac-dc --dev
```

Starts a Vite dev server alongside the JRPC server. Provides hot module
replacement for webapp development.

- **Webapp port**: Defaults to 18999, configurable with `--webapp-port`.
- **Browser URL**: `http://localhost:<webapp_port>/?port=<server_port>`
- Vite runs `npm run start` (which runs `vite`).

### Mode 3: Local Preview Server

```
ac-dc --preview
```

Builds the webapp first (`npm run build`), then serves the production
bundle locally. Used for testing production builds without deploying.

- Same port behavior as dev mode.
- Runs `npm run build` then `npm run preview` (which runs `vite preview`).
- Build failure raises `RuntimeError`.

## WebappProcessManager

`ac/webapp_server.py` manages the local Vite process:

```python
class WebappProcessManager:
    def __init__(webapp_dir, port, dev_mode=False)
    def start_dev_server() -> subprocess.Popen
    def start_preview_server() -> subprocess.Popen  # build + preview
    def start_with_port_check() -> bool | Popen
    def stop()
```

**Port check**: `start_with_port_check()` skips starting a new process if
the port is already in use (another instance running). Returns `True` if
skipped.

**Process lifecycle**: The Vite process is a child `subprocess.Popen`. It
is terminated via `process.terminate()` + `process.wait()` when the
application exits.

**Port passing**: The port is passed to Vite via the `PORT` environment
variable, which `vite.config.js` reads for both `server.port` and
`preview.port`.

## Startup Sequence

`ac/dc.py` `main_starter_async()`:

1. Validate git repository (exit with error dialog if not a git repo).
2. Find available ports:
   - Always: JRPC server port (default 18080).
   - Local modes only: Webapp port (default 18999).
   - Ports are scanned concurrently via `ThreadPoolExecutor`.
3. Print connection info (server port, WebSocket URI, browser URL).
4. Create and register JRPC objects: `Repo`, `LiteLLM`, `Settings`.
5. If local mode: start Vite via `WebappProcessManager`.
6. Start JRPC WebSocket server.
7. Open browser (unless `--no-browser`).
8. Serve forever.

### CLI Arguments

| Flag | Default | Description |
|------|---------|-------------|
| `--server-port` | 18080 | JRPC WebSocket server port |
| `--webapp-port` | 18999 | Vite dev/preview server port (local modes only) |
| `--no-browser` | false | Don't auto-open browser |
| `--repo-path` | cwd | Git repository path |
| `--dev` | false | Run local Vite dev server |
| `--preview` | false | Build and run local preview server |

### Config Initialization

Before argument parsing, `main()` calls `ensure_user_config()` which
copies bundled default configs from the package to the user config
directory on first run. This is primarily for PyInstaller builds where
the source config directory may not be accessible.

## GitHub Pages Deployment

### CI Pipeline

`.github/workflows/deploy-pages.yml` triggers on push to `master`:

1. **Checkout** source repo and existing `gh-pages` branch.
2. **Build** webapp with versioned base path:
   ```
   npm run build -- --base=/AI-Coder-DeCoder/<short-sha>/
   ```
3. **Deploy** built files to `gh-pages/<short-sha>/`.
4. **Update** `versions.json` with the new version entry.
5. **Cleanup** old versions (keep last 20).
6. **Create** root `index.html` redirect page.
7. **Push** to `gh-pages` branch.
8. **Deploy** via GitHub Pages action.

### Versioned Deployment

Each build produces a SHA-stamped directory:

```
gh-pages/
├── index.html          # Redirect to latest version
├── versions.json       # Version registry
├── a1b2c3d4/          # Build for commit a1b2c3d4
│   ├── index.html
│   └── assets/
├── e5f6g7h8/          # Build for commit e5f6g7h8
│   ├── index.html
│   └── assets/
└── ...
```

This ensures the running Python backend always loads a webapp build that
matches its own commit — the SHA in the URL matches the SHA of the Python
code.

### versions.json

```json
{
  "latest": "a1b2c3d4",
  "versions": [
    {
      "sha": "a1b2c3d4",
      "full_sha": "a1b2c3d4e5f6g7h8...",
      "date": "2024-01-15T10:30:00Z",
      "branch": "master"
    }
  ]
}
```

The root `index.html` fetches this file and redirects to the latest
version, preserving query parameters (particularly `?port=`).

### Version Cleanup

The CI pipeline retains the 20 most recent versions. Older version
directories are deleted and their entries removed from `versions.json`.

## WebSocket Connection

The webapp connects to the Python backend via WebSocket JRPC. The server
port is passed as a query parameter:

```
?port=18080
```

The `AppShell` component extracts this and constructs the WebSocket URI:

```
ws://localhost:18080
```

See [JRPC](jrpc-oo.md) for the communication protocol.

## npm Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `start` | `vite` | Dev server with HMR |
| `build` | `vite build` | Production build to `dist/` |
| `preview` | `vite preview` | Serve production build locally |
