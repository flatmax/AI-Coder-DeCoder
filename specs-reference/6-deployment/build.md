# Reference: Build

**Supplements:** `specs4/6-deployment/build.md`

This is the canonical owner for PyInstaller flag sequences, Vite optimizeDeps entries, and package-name lists that the build pipeline depends on.

## Byte-level formats

### Version string format

```
{YYYY.MM.DD}-{HH.MM}-{short_sha}
```

Examples:

```
2025.06.15-14.32-a1b2c3d4
2025.12.03-09.15-f6e5d4c3
```

- Date and time are UTC
- Time segment is hours-minutes (no seconds) — same-day rebuilds within the same minute produce the same version string; not a problem in practice because CI doesn't rebuild that fast
- `short_sha` is the first 8 chars of `git rev-parse HEAD`
- Source installs without a baked version file produce the literal string `dev`

Written to `src/ac_dc/VERSION` at build time. Read by `src/ac_dc/__init__.py` into `__version__`. Also written to `.bundled_version` in the user config directory on first run of a packaged build (see `specs-reference/1-foundation/configuration.md` § Version marker file).

### PyInstaller command — release build

Full command as run in CI per platform:

```bash
pyinstaller --onefile --name ac-dc-{platform} \
    --add-data "src/ac_dc/VERSION{sep}ac_dc" \
    --add-data "src/ac_dc/config{sep}ac_dc/config" \
    --add-data "webapp/dist{sep}ac_dc/webapp_dist" \
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
    --hidden-import=ac_dc \
    --hidden-import=ac_dc.collab \
    --hidden-import=ac_dc.doc_convert \
    --hidden-import=ac_dc.base_cache \
    --hidden-import=jrpc_oo \
    src/ac_dc/__main__.py
```

Where:

- `{platform}` is one of `linux`, `windows`, `macos-arm`
- `{sep}` is `:` on Unix, `;` on Windows — PyInstaller's `--add-data` uses OS-native path separator

### `--collect-all` package list

Packages that ship data files PyInstaller's static analysis can't discover automatically:

| Package | Reason |
|---|---|
| `litellm` | Model registry data, provider-specific token counts |
| `tiktoken` | BPE merge rules and encoding tables |
| `tiktoken_ext` | Optional tiktoken extensions (open-source registry) |
| `tree_sitter` | Core library's runtime data |
| `tree_sitter_python` | Compiled grammar (`.so` / `.dll` / `.dylib`) |
| `tree_sitter_javascript` | Compiled grammar |
| `tree_sitter_typescript` | Compiled grammar (exposes both `language_typescript` and `language_tsx`) |
| `tree_sitter_c` | Compiled grammar |
| `tree_sitter_cpp` | Compiled grammar |
| `trafilatura` | Content extraction data files (stopwords, language detection models) |

Missing any of these produces a runtime `ModuleNotFoundError` (for the package itself) or a silent data-file-not-found failure (grammars that fail to load silently leave the language unavailable).

### `--hidden-import` module list

Modules PyInstaller's static analyzer misses because they're imported dynamically or only referenced by string name:

| Module | Why missed |
|---|---|
| `boto3` | Only imported by `litellm` when Bedrock provider is used |
| `botocore` | Transitive dep of `boto3`; static analyzer misses both when `boto3` is only imported via `litellm` |
| `ac_dc` | Package root — static analyzer sees only the entry point's direct imports |
| `ac_dc.collab` | Registered via `add_class()` dynamically; not imported directly by `main.py` |
| `ac_dc.doc_convert` | Same — registered via `add_class()` |
| `ac_dc.base_cache` | Abstract base; concrete subclasses import it, but analyzer may miss the chain |
| `jrpc_oo` | Some submodules imported by string in the jrpc-oo library itself |

The full workflow YAML (`.github/workflows/release.yml`) has additional hidden imports for every `ac_dc.*` submodule — the list in this twin is the minimal set observed to work; the full list is belt-and-braces. Adding new submodules during development typically requires adding a corresponding `--hidden-import` entry before the next release build.

### Vite optimizeDeps exclude

The jrpc-oo package contains UMD/CJS global assignment (`globalThis.JRPC = ...`) that Vite's esbuild-based pre-bundler mangles during dependency optimization. Exclusion bypasses the pre-bundler and resolves the package natively via Vite's dev server.

Required `webapp/vite.config.js` entry:

```js
import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    exclude: ['@flatmax/jrpc-oo'],
  },
});
```

Package name is `@flatmax/jrpc-oo` (scoped under `@flatmax`). Without this exclusion, the browser reports `Uncaught ReferenceError: JRPC is not defined` on the first RPC call and the WebSocket handshake never completes.

After any change to `optimizeDeps`, clear the Vite dep cache:

```bash
rm -rf webapp/node_modules/.vite
```

Vite aggressively caches pre-bundled deps; stale cache entries silently re-introduce the bug even after the config is corrected.

### `@flatmax/jrpc-oo` import path

Always import from the explicit bundle path, not the package root:

```js
import { JRPCClient } from '@flatmax/jrpc-oo/dist/bundle.js';
```

The package root resolution (`import { JRPCClient } from '@flatmax/jrpc-oo'`) goes through Vite's dep optimizer even when the package is excluded from `optimizeDeps`, because the exclusion only affects the optimizer's input list — not module resolution. The explicit bundle path bypasses resolution entirely and loads the UMD bundle directly.

## Numeric constants

### Default ports

| Port | Default | Purpose |
|---|---|---|
| WebSocket RPC server | 18080 | jrpc-oo WebSocket endpoint (Python side) |
| Webapp static server | 18999 | Built-in HTTP server for bundled webapp (or Vite dev server in dev mode) |
| PyInstaller port probe start | Same as above | Server scans upward from this port if taken |

CLI flags `--server-port` and `--webapp-port` override; see `specs4/6-deployment/startup.md` for probing behavior.

### Webapp location priority

Runtime search order for the bundled webapp:

1. `{sys._MEIPASS}/ac_dc/webapp_dist/` — PyInstaller-bundled location (temp dir extracted at startup)
2. `{repo_root}/webapp/dist/` — development after `npm run build`
3. `{package_dir}/webapp_dist/` — pip-installed package data directory

First existing path wins. If none exist, the server prints an error and exits with instructions to either build the webapp or use `--dev` mode.

### PyInstaller data-file inclusion

The `--add-data` flag's destination path format matters:

```
src/ac_dc/VERSION{sep}ac_dc
```

- Source: `src/ac_dc/VERSION` (relative to CI working dir)
- Destination: `ac_dc` (relative path inside the bundle, matches the Python package name)
- Separator: `:` on Unix, `;` on Windows

The destination matching the package name is load-bearing — `Path(__file__).parent` at runtime resolves to the bundle's `ac_dc` directory, which is where `VERSION`, `config/`, and `webapp_dist/` must land for the package to find them.

## Schemas

### PyInstaller bundle layout

After extraction (PyInstaller's `--onefile` mode unpacks to a temp directory at startup):

```
{MEIPASS}/
├── ac_dc/
│   ├── VERSION                    # baked version string
│   ├── config/                    # bundled config defaults
│   │   ├── llm.json
│   │   ├── app.json
│   │   ├── snippets.json
│   │   ├── system.md
│   │   └── ...
│   └── webapp_dist/               # Vite-built webapp
│       ├── index.html
│       ├── assets/
│       │   ├── index-{hash}.js
│       │   └── index-{hash}.css
│       └── ...
├── litellm/                       # --collect-all targets
├── tiktoken/
├── tree_sitter/
├── tree_sitter_python/
└── ...
```

The `ac_dc/` subtree matches what `pip install ac-dc` produces on disk, so `Path(__file__).parent` resolves consistently between source installs, pip installs, and PyInstaller bundles.

### Webapp dist layout (Vite build output)

Produced by `npm run build` in the `webapp/` directory:

```
webapp/dist/
├── index.html                     # SPA entry; no root-relative asset refs
├── assets/
│   ├── index-{hash}.js            # Main bundle, content-hashed filename
│   ├── index-{hash}.css           # Styles, content-hashed
│   └── ...
└── monaco/                        # Monaco editor worker chunks (if split)
```

Vite's `base: './'` config (see below) produces asset references that are relative to `index.html` — portable across origin, port, and path prefix.

### Vite config essentials

Minimal `vite.config.js` shape:

```js
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',                                   // Relative asset paths
  optimizeDeps: {
    exclude: ['@flatmax/jrpc-oo'],              // See § Vite optimizeDeps exclude
  },
  server: {
    port: 18999,                                // Default; overridable via CLI
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
```

## Dependency quirks

### tree-sitter TypeScript package exposes two grammars

The `tree_sitter_typescript` pip package exposes `language_typescript()` (for `.ts`) and `language_tsx()` (for `.tsx`) but **not** `language()`. PyInstaller's `--collect-all=tree_sitter_typescript` picks up both grammars as data files, but the loader code must probe for the function names individually. See `specs-reference/2-indexing/symbol-index.md` § dependency quirks for the loader pattern.

### litellm's Bedrock provider requires boto3

When a user configures a Bedrock model (e.g., `bedrock/anthropic.claude-sonnet-4`), `litellm` lazy-imports `boto3`. PyInstaller's static analyzer doesn't see the import chain, so `boto3` and its transitive dep `botocore` must be explicitly listed as `--hidden-import`. Missing these produces a runtime `ModuleNotFoundError` only when a user actually selects a Bedrock model — not caught by build-time tests that use other providers.

### Static file server — threading class name

The bundled static server uses `http.server.ThreadingHTTPServer` (stdlib, introduced in Python 3.7). Multi-threaded to handle parallel asset requests from the browser. Single-request `HTTPServer` would serialize asset loads and produce visible lag on the initial page load.

### Static file server — SPA fallback

Requests for paths without a file extension that don't match a real file on disk are served `index.html`. Implementation is a custom `SimpleHTTPRequestHandler` subclass that checks `os.path.isfile(target)` before falling through to the index. Required for client-side routing to work when users bookmark deep links or refresh mid-route.

### Static file server — error suppression

`BrokenPipeError` and `ConnectionResetError` are silently caught in two locations:

1. `do_GET` wrapped in try/except — catches mid-transfer disconnects
2. The server's `handle_error` override checks `sys.exc_info()[1]` type before deciding to log

Without the suppression, every browser tab close or navigation-during-load produces a noisy traceback in the terminal. The errors are benign — the client went away, nothing to recover.

### Static file server — bind address

Binds to `127.0.0.1` by default (localhost only). Binds to `0.0.0.0` when `--collab` is passed. Same rule applies to the WebSocket server and the Vite dev/preview servers. See `specs4/4-features/collaboration.md` for the contract.

### GitHub Pages — alternative webapp source

Source installs (`pip install -e .`) that skip `npm run build` can use a GitHub Pages deployment as the webapp source instead. The backend's webapp location priority falls through all three local paths and, if configured, redirects the browser to the GitHub Pages URL. Deployed via a GitHub Actions workflow on push to `main`. Version skew between pip-installed backend and GitHub-hosted frontend is possible but minor — the RPC surface is stable enough to tolerate one or two-week lag.

## Cross-references

- Startup sequence and port probing: `specs4/6-deployment/startup.md`
- Config file upgrade flow and version marker: `specs-reference/1-foundation/configuration.md`
- Collaboration bind-address policy: `specs4/4-features/collaboration.md`
- Tree-sitter TypeScript loader quirk: `specs-reference/2-indexing/symbol-index.md`
- Symbol map compact format produced by the packaged backend: `specs-reference/2-indexing/symbol-index.md`