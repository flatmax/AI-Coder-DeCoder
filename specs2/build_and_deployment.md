# Build and Deployment

## Overview

The webapp is a web-component-based SPA. It connects to the terminal backend over WebSocket. Three running modes are supported: hosted (production), local dev, and local preview.

## Running Modes

### Mode 1: Hosted Webapp (Default)

No local webapp server. The terminal app starts only the RPC WebSocket server. The browser opens a pre-built webapp hosted externally (e.g., GitHub Pages).

```pseudo
URL = https://{hosted_domain}/{version_sha}/?port={server_port}
```

The version SHA matches the running codebase so the webapp is always compatible with the backend.

### Mode 2: Local Dev Server

Starts a dev server alongside the RPC server. Provides hot module replacement for development.

```pseudo
URL = http://localhost:{webapp_port}/?port={server_port}
```

### Mode 3: Local Preview

Builds the webapp, then serves the production bundle locally. For testing production builds.

## Version Detection

To match the webapp build to the backend:
1. Check for a baked `VERSION` file (packaged builds)
2. Run `git rev-parse HEAD`
3. Read `.git/HEAD` directly (handles detached HEAD)
4. Fallback: none (use root redirect URL)

## Startup Sequence

1. Validate git repository (exit with error if not a repo)
2. Find available ports (server port required, webapp port for local modes)
3. Print connection info
4. Create and register RPC service objects: Repo, LLM, Settings
5. If local mode: start webapp dev/preview server
6. Start RPC WebSocket server
7. Open browser (unless disabled)
8. Serve forever

### CLI Arguments

| Flag | Default | Description |
|------|---------|-------------|
| `--server-port` | 18080 | RPC WebSocket port |
| `--webapp-port` | 18999 | Webapp dev/preview port |
| `--no-browser` | false | Don't auto-open browser |
| `--repo-path` | cwd | Git repository path |
| `--dev` | false | Run local dev server |
| `--preview` | false | Build and run preview server |

## Webapp Process Management

A process manager handles the local webapp server:
- Port check: skip if port already in use (another instance)
- Process lifecycle: child process, terminated on app exit
- Port passed via environment variable

## Hosted Deployment (CI)

### Pipeline

1. Build webapp with versioned base path (`/{repo}/{sha}/`)
2. Deploy to versioned directory
3. Update version registry
4. Clean up old versions (keep last ~20)
5. Create root redirect page

### Version Registry

```pseudo
{
    latest: "a1b2c3d4",
    versions: [
        { sha, full_sha, date, branch }
    ]
}
```

Root page fetches registry and redirects to latest, preserving query parameters (especially `?port=`).

## WebSocket Connection

The webapp extracts the server port from `?port=N` in the URL and constructs `ws://localhost:{port}` for the RPC connection.

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
