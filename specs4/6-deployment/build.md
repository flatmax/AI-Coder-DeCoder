# Build

**Status:** stub

How the webapp and backend are packaged for distribution. The webapp is a Vite-built SPA served by a built-in HTTP static file server; the backend is a Python package optionally packaged as a PyInstaller single-file binary. Source installs can use a fallback served from GitHub Pages.

## Webapp Bundling

- Vite-based build producing a static bundle
- Base path configured to relative (`./`) so the built webapp can be served from any origin without path rewriting
- Output directory bundled into the Python package under a known subdirectory
- Build emits hashed asset filenames for long-term caching
- `index.html` is the entry point with all asset references relative

### Vite optimizeDeps Exclude

- The RPC library depends on a UMD/CJS package that exposes a global
- Vite's dependency optimizer (esbuild) mangles this during pre-bundling, causing runtime errors
- The RPC package must be excluded from optimizeDeps so the browser resolves the ESM import chain natively
- After config changes, Vite cache must be cleared

## Webapp Location Priority

The backend locates the webapp by checking, in order:

1. PyInstaller bundle directory (packaged binary)
2. Source tree (development after a build)
3. Installed package data (pip install)

If no local bundle is found, the server prints an error instructing the user to build the webapp or use dev mode. Source installs may fall back to a GitHub Pages deployment URL.

## Built-in Static File Server

- A threaded HTTP server runs in a daemon thread alongside the WebSocket server
- Serves files from the webapp dist directory
- **SPA fallback** — requests for paths without a file extension that don't match a real file are served the index page (for client-side routing)
- **Silent logging** — per-request logs suppressed
- **Bind address** — loopback by default, all interfaces when collaboration is enabled
- **Threading** — concurrent requests from multiple browser tabs and parallel asset loads supported
- **Error suppression** — broken-pipe and connection-reset errors silently caught, preventing noisy tracebacks when clients disconnect mid-transfer

## Version Baking

- A version file is written to the Python package at build time
- Format — timestamp plus short commit SHA (e.g., `YYYY.MM.DD-HH.MM-abcdef12`)
- Retained for display and logging
- Runtime detection cascade — baked VERSION file, `git rev-parse HEAD`, direct `.git/HEAD` read, fallback to a dev marker

## PyInstaller Packaging

Per-platform single-file binaries built in CI:

- Platforms — Linux, Windows, macOS (ARM)
- Version computed as timestamp plus commit SHA for same-day ordering
- VERSION file baked into the package before bundling
- `--onefile` with explicit config and webapp data inclusion
- Separator is platform-specific (`:` on Unix, `;` on Windows)
- Destination path within the package matches the Python package name so runtime path resolution works

### Dependency Collection

- `--collect-all` for packages with data files — LLM provider library, tokenizer and extensions, tree-sitter core and per-language grammars, content extraction library
- `--hidden-import` for every ac_dc submodule and extractor (static analysis misses dynamically imported modules and modules only referenced via class registration)
- `--hidden-import` for the RPC library
- Runtime behavior verified in CI on each platform

### Release Workflow

- GitHub Actions workflow triggers on release tag
- Builds all platforms in parallel
- Attaches all platform binaries to the GitHub Release

## GitHub Pages Deployment

- For users running from source (`pip install -e .`) without a local webapp build
- Webapp deployed to a GitHub Pages URL
- Allows pip-install users to skip building the webapp manually — the Python backend redirects to the hosted webapp when no local bundle is found
- GitHub Actions workflow builds the webapp and deploys to Pages on push to main

## Source Install Paths

| Install type | Webapp source |
|---|---|
| PyInstaller binary | Bundled inside binary |
| Development (`pip install -e .` + `npm run build`) | Source tree's dist directory |
| pip install from PyPI | Installed package data (if included) or GitHub Pages fallback |
| Dev mode (`--dev`) | Vite dev server as child process |
| Preview mode (`--preview`) | Vite preview server as child process |

## Vite Dev/Preview Management

For dev and preview modes only (webapp development, not normal usage):

- Port check — skip if port already in use (another instance running)
- Prerequisite check — verify dependency directory exists, prompt for install if not
- Process lifecycle — launched as child process, terminated on exit
- Bind address — loopback by default, all interfaces when collaboration is enabled
- Cleanup — terminate with a timeout, then kill if needed

## Invariants

- Webapp bundle is always self-contained — no absolute paths, no external CDN dependencies for core features
- Base path is always relative so the bundle can serve from any origin
- PyInstaller binary contains everything needed — config defaults, webapp bundle, version file, all Python dependencies
- Hidden imports cover every module — no "module not found" at runtime
- SPA fallback ensures client-side routing works when users bookmark deep links
- Webapp location priority always tried in order; first hit wins
- Broken-pipe errors during client disconnect never surface as tracebacks