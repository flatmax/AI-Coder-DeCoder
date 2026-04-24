# Startup
**Status:** stub
The startup sequence is split into two phases to give the user early feedback. The browser connects and shows a startup overlay while heavy initialization runs in the background with progress updates. The WebSocket server is accepting connections within the fast phase.
## Running Modes
| Mode | Description | URL pattern |
|---|---|---|
| Bundled (default) | Built-in static server serves bundled webapp | `http://localhost:{webapp_port}/?port={server_port}` |
| Local dev (`--dev`) | Vite dev server + RPC server | Same pattern |
| Local preview (`--preview`) | Vite production build + preview server | Same pattern |
## Phase 1: Fast (under a second)
1. Validate git repository — if not a repo, write a self-contained instruction HTML to a temp file, open as a file URL in the browser, print terminal banner with remediation commands, exit
2. Find available ports for WebSocket and webapp servers
3. Initialize lightweight services — config manager, repo, settings, doc convert availability check
4. Start webapp server — bundled static server (default), Vite dev, or Vite preview
5. Create LLM service with deferred-init flag (no symbol index, no stability init)
6. **Restore last session** — explicitly, before starting the WebSocket server, so `get_current_state` returns previous messages to the first browser connection
7. Register services with the RPC server and start the WebSocket server
8. Open browser (unless `--no-browser` flag passed) — user sees startup overlay immediately
## Phase 2: Deferred (non-blocking background task)
Phase 2 runs as a background task so the event loop stays free to handle WebSocket frames (pings, RPC calls) throughout. Each CPU-bound step uses the executor to avoid GIL starvation.
1. Wait briefly for browser WebSocket connection
2. Initialize symbol index via executor — progress ~10%
3. Complete deferred LLM init via executor (wire symbol index) — progress ~30%
4. Index repository in small batches (around 20 files per batch) via executor, with event-loop yield between batches — progress 50–90%
5. Build reference index once after all files indexed
6. Initialize stability tracker via executor (tier assignments, reference graph) — progress ~80%
7. Signal ready — browser dismisses startup overlay — progress 100%
8. Start background doc index build (structural extraction → enrichment)
### Progress Reporting
- Progress sent via a server-push progress callback
- Each stage is best-effort — if the browser isn't connected yet, the call is silently dropped
- An init-complete flag gates chat requests — requests before phase 2 completes are rejected with a user-friendly message
### Doc Index Stage Filtering
- Progress stage indicating doc-index work is intercepted by the shell and routed to the dialog header progress bar instead of the startup overlay
- Only in-progress updates forwarded; completion signal arrives via the enrichment-complete event
- Prevents the background doc index build from stalling or re-showing the startup overlay
### File Reopen Deferral
- Browser delays reopening the last-viewed file until the startup overlay dismisses (after the ready signal)
- Prevents file-fetch RPC calls from blocking the server's event loop during heavy initialization
- On reconnect (when init is already complete), the file reopens immediately
## Startup Overlay
The browser shows a full-screen overlay with the brand mark, a status message, and a progress bar. The overlay updates as progress events arrive:
| Stage | Message | Percent |
|---|---|---|
| Connected | Connected — initializing… | ~5% |
| Symbol index | Initializing symbol parser… | ~10% |
| Session restore | Restoring session… | ~30% |
| Indexing | Indexing repository… N/M | 50–90% |
| Stability | Building cache tiers… | ~80% |
| Ready | Ready | 100% |
- Overlay fades out shortly after ready
- On reconnection (not first connect), overlay is not shown — only a "Reconnected" success toast appears
- Document index enrichment progress is communicated separately via the persistent header progress bar in the chat panel (not the startup overlay)
## Git Repository Validation
- When the target path is not a git repository, the server writes a self-contained HTML page to a temp file and opens it in the browser via a file URL
- HTML is dark-themed, centered, shows the brand mark, highlights the offending path and remediation commands (`cd /path && git init`) in a visually distinct style
- Terminal banner mirrors the information in plain text
- Server then exits without starting the WebSocket server
## CLI Arguments
| Flag | Default | Description |
|---|---|---|
| `--server-port` | 18080 | RPC WebSocket port |
| `--webapp-port` | 18999 | Webapp server port |
| `--no-browser` | false | Don't auto-open browser |
| `--repo-path` | current dir | Git repository path |
| `--dev` | false | Run local dev server (Vite) |
| `--preview` | false | Build and preview (Vite) |
| `--verbose` | false | Debug logging |
| `--collab` | false | Enable collaboration mode (listen on all interfaces, admission-gated) |
## Port Selection
- Find-available-port helper tries binding to loopback on consecutive ports starting from the configured default
- Scans up to a reasonable number of attempts
- First successfully bound port is used
- If no port available in the range, server exits with an error
- **Both ports are probed independently** — the WebSocket port AND the webapp port. Skipping the probe on either port is a correctness bug: a second instance launched with defaults would fail to bind the taken port in one of two silent ways (static-server constructor raises `OSError` inside a daemon thread and gets swallowed; or the browser-open call still fires and the user sees "their" app in the tab title while the loaded JS comes from the first instance). Users have no clear signal that something is wrong — the tab loads, looks right, and silently talks to the wrong backend
- The CLI flags `--server-port` and `--webapp-port` specify the *starting* port for the probe, not a required port. This matches the "just works" principle — running two AC⚡DC instances back to back should never require the user to remember port arithmetic

## Browser Tab Title

- Set to the repo name (e.g., `my-project`)
- Repo name comes from the state snapshot returned by the current-state RPC
- Updated on initial state load
- No prefix or branding — just the bare repo name
- Helps users distinguish multiple AC⚡DC sessions across different repos

## Logging

Structured to stderr. Default level INFO. Verbose flag enables DEBUG.

| Level | Usage |
|---|---|
| ERROR | Exceptions, fatal failures |
| WARN | Recoverable issues |
| INFO | LLM requests, edit results, cache changes, startup |
| DEBUG | RPC calls, chunks, symbol timing, config |

## Graceful Shutdown

- SIGINT / SIGTERM handler triggers clean exit
- Child processes (Vite dev/preview) terminated with a timeout, then killed if needed
- WebSocket server stopped cleanly
- Pending background tasks allowed a brief grace period before forced termination
- Temp directories (TeX preview working dirs, URL cache clones) cleaned up where possible

## Security Considerations

| Area | Policy |
|---|---|
| File access | Paths resolved relative to repo root; parent-directory traversal rejected |
| Git operations | Local only (except shallow clones for URL fetching) |
| WebSocket binding | Loopback by default; all interfaces only when collaboration flag is set |
| Edit blocks | Paths validated against repo root; binary files rejected |
| URL fetching | HTTP(S) only; file URLs rejected; timeouts enforced |

## Graceful Degradation

| Failure | Behavior |
|---|---|
| Tree-sitter parse failure | Skip file in symbol index, log warning; file still in tree and selectable |
| LLM provider down/timeout | Completion event with error in chat; user can retry |
| Git operation fails | RPC returns an error shape; toast shown; file tree doesn't update |
| Commit fails | Error shown in chat; files remain staged |
| URL fetch fails | Chip shows error state; error results not cached; user can retry |
| WebSocket disconnect | Reconnecting banner with attempt count, auto-retry with exponential backoff |
| Config file corrupt/missing | Use built-in defaults; log warning; settings panel displays the error |
| Symbol cache corrupt | Clear in-memory cache, rebuild from source |
| Compaction LLM failure | Safe defaults (no boundary, zero confidence); history unchanged; retry next trigger |
| Review mode crash | Manual recovery via checkout of the original branch; detached HEAD state is safe |

## Invariants

- Phase 1 completes before the WebSocket server accepts connections
- Last session is restored before the WebSocket server starts, so the first browser connect returns previous messages immediately
- Phase 2 never blocks the event loop — all CPU-bound work goes through the executor with event-loop yields
- Chat requests arriving before phase 2 completes are rejected with a user-friendly message
- Startup overlay appears on first connect only; reconnects show a transient toast
- Doc-index progress during phase 2 never re-shows or stalls the startup overlay
- Git repository validation failure always produces both the HTML instruction page and the terminal banner
- Port selection always succeeds or exits with a clear error — never silently binds to an unexpected port
- Both the WebSocket port and webapp port are probed before the server starts; a second concurrent instance probes past the first's ports rather than cross-wiring into it
- Browser tab title always matches the repo name; no branding prefix
- SIGINT / SIGTERM always trigger clean shutdown with child process termination