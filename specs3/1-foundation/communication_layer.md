# Communication Layer

## Overview

The terminal application and browser webapp communicate via **bidirectional JSON-RPC 2.0 over WebSocket**, using the [jrpc-oo](https://github.com/flatmax/jrpc-oo) library. Once connected, both sides are symmetric peers — either can initiate calls to the other.

## Connection Model

```
Browser (WebSocket Client)
    │
    │  ws://localhost:{port}
    │
    ▼
Terminal App (WebSocket Server, localhost only)
```

A single WebSocket connection carries all traffic, multiplexed by JSON-RPC request IDs. The server binds to `localhost` only — not externally accessible.

## Transport Configuration

| Property | Value |
|----------|-------|
| Default server port | 18080 (configurable via CLI) |
| Bind address | `localhost` (127.0.0.1) |
| Protocol | `ws://` (plain WebSocket) |
| Port passed to browser | via URL query parameter `?port=N` |
| Remote timeout | 60 seconds |

## jrpc-oo Patterns

### Server Side (Python)

**Setup:**

```python
from jrpc_oo import JRPCServer

server = JRPCServer(port, remote_timeout=60)
server.add_class(repo_instance)       # exposes Repo.get_file_tree, etc.
server.add_class(llm_instance)        # exposes LLM.chat_streaming, etc.
server.add_class(settings_instance)   # exposes Settings.get_config_info, etc.
await server.start()
```

`add_class()` introspects the instance and exposes all public methods as `ClassName.method_name` RPC endpoints. No base class or decorator needed. Underscore-prefixed methods are not exposed.

**Calling the browser from Python:**

jrpc-oo injects `get_call()` on registered instances. The returned proxy uses bracket notation:

```python
class LLM:
    @property
    def call(self):
        try:
            return self.get_call()
        except Exception:
            return None

    async def _notify_browser(self, data):
        await self.call["AcApp.streamChunk"](request_id, content)
```

**Event callback abstraction:** The LLM service uses an `_event_callback` function rather than calling `get_call()` directly. This callback is wired up in `main.py` to dispatch to `AcApp.{event_name}(...)`:

```python
async def event_callback(event_name, *args):
    call = llm_service.get_call()
    await call[f"AcApp.{event_name}"](*args)
```

Different events pass different argument shapes:
- `streamComplete(request_id, result)` — 2 args
- `compactionEvent(request_id, event_dict)` — 2 args
- `filesChanged(selected_files_list)` — 1 arg (no request_id)

The `*args` splat handles this variance, but callers must match the browser method signatures exactly.

**Response envelope:** All jrpc-oo return values are wrapped as `{ "remote_id": return_value }`. Extract the actual value from the single key. In practice, many server→browser calls are fire-and-forget notifications where the browser returns `true` as an acknowledgement and the Python side just awaits without inspecting the result.

### Browser Side (JavaScript)

**Root component extends JRPCClient** (which extends LitElement), giving it WebSocket transport and the `call` proxy:

```javascript
class AcApp extends JRPCClient {
    constructor() {
        super();
        this.serverURI = `ws://localhost:${port}`;
        this.remoteTimeout = 60;
    }
    connectedCallback() {
        super.connectedCallback();
        this.addClass(this, 'AcApp');   // register methods the server can call
    }
}
```

**Calling server methods:**

```javascript
const raw = await this.call['Repo.get_file_tree']();
// raw = { "get_file_tree": { tree: {...}, modified: [...] } }

const state = await this.call['LLMService.get_current_state']();
// raw = { "get_current_state": { messages: [...], ... } }
```

**Unwrapping the envelope:**

```javascript
async _extract(method, ...args) {
    const result = await this.call[method](...args);
    if (result && typeof result === 'object') {
        const keys = Object.keys(result);
        if (keys.length === 1) return result[keys[0]];
    }
    return result;
}
```

**Methods the server can call** must be registered via `addClass` and must return a value (the server awaits each call). The server calls them using `ClassName.method` format, matching the name passed to `addClass`:

```javascript
// Browser registers: this.addClass(this, 'AcApp');
// Server calls:      await call["AcApp.streamChunk"](requestId, content);

streamChunk(requestId, content) {
    this._dispatch('stream-chunk', { requestId, content });
    return true;  // acknowledgement
}
```

### Connection Lifecycle

| Event | Description |
|-------|-------------|
| WebSocket opens | jrpc-oo handshake begins |
| `remoteIsUp()` | Connection confirmed, remote is ready |
| `setupDone()` | `call` proxy populated — can now make RPC calls |
| `startupProgress` calls | Server sends initialization progress (first connect only) |
| `startupProgress("ready", ...)` | Browser dismisses startup overlay, normal operation begins |
| Normal operation | Request/response pairs over the shared connection |
| `setupSkip()` | Connection failed |
| `remoteDisconnected()` | WebSocket closed |

## RPC Distribution to Child Components

Only the root component holds the WebSocket connection. Child components get RPC access through a shared singleton:

```javascript
// Root component publishes on connect
SharedRpc.set(this.call);

// Any child component using RpcMixin:
class ChildComponent extends RpcMixin(LitElement) {
    onRpcReady() {
        // this.rpcCall / this.rpcExtract now available
    }
}
```

The mixin provides:
- `rpcCall(method, ...args)` — raw call returning the full envelope
- `rpcExtract(method, ...args)` — unwraps the envelope automatically
- `rpcConnected` — boolean property
- `onRpcReady()` — callback when connection is established

## Streaming Pattern

The bidirectional nature enables server-push streaming:

```
1. Browser → Server:  LLMService.chat_streaming(request_id, prompt, files, images)
2. Server → Browser:  AcApp.streamChunk(request_id, content)     // repeated
3. Server → Browser:  AcApp.streamComplete(request_id, result)    // once
4. Server → Browser:  AcApp.compactionEvent(request_id, event)    // optional
```

Each chunk/completion is a full JSON-RPC method call from server to client.

### Request ID Generation and Correlation

The browser generates request IDs as `{epoch_ms}-{random_alphanumeric_6}` (e.g., `1736956800000-x7k2m9`). The chat panel stores the current request ID and ignores chunks/completions with non-matching IDs. This correlates callbacks to the correct request and prevents stale callbacks from a previous request from corrupting the current stream.

### `compactionEvent` Dual Purpose

The `compactionEvent` callback serves as a general-purpose progress channel during streaming, not just for compaction:

| Stage | Purpose |
|-------|---------|
| `compaction_start` | History compaction beginning |
| `compaction_complete` | History compaction finished |
| `compaction_error` | History compaction failed |
| `url_fetch` | URL fetch in progress (toast notification) |
| `url_ready` | URL fetch completed (success toast) |
| `doc_enrichment_queued` | Files pending keyword enrichment (persistent toast) |
| `doc_enrichment_file_done` | One file enriched (update persistent toast) |
| `doc_enrichment_complete` | All files enriched (dismiss persistent toast) |
| `doc_enrichment_failed` | Enrichment failed for one file (warning in toast) |

The frontend handles these by stage name — compaction stages update the message display, URL stages show toast notifications.

## File Selection Sync

The file selection state follows this round-trip:

```
1. Browser: User checks file in picker
2. Browser: selection-changed event → Files tab
3. Browser: Files tab calls LLMService.set_selected_files(files) via RPC
4. Server: LLMService stores _selected_files list
5. Browser: User sends chat message
6. Browser: LLMService.chat_streaming(request_id, message, files, images)
7. Server: _stream_chat reads _selected_files, syncs FileContext, loads content
8. Server: Files in _selected_files are included in prompt assembly
```

When the server modifies the selection (e.g., auto-adding files for not-in-context edits), it broadcasts via:
```
Server: await call["AcApp.filesChanged"](updated_files_list)
Browser: files-changed event → Files tab updates picker and chat panel
```

## Concurrency

### Single Active Stream

Only one LLM streaming request may be active at a time. The server tracks the active request ID and rejects concurrent requests.

### Multiple Clients

jrpc-oo supports multiple connected remotes. All clients share the same service instances. Streaming callbacks are directed to the originating remote only. Non-streaming calls are served concurrently.

### State Scope

All state is **global** across connected clients:

| State | Sync Mechanism |
|-------|----------------|
| Selected files | Broadcast `filesChanged` to all clients on change |
| Conversation history | One conversation; clients fetch on connect |
| Streaming | Chunks to originator only; others see result on next state fetch |

### Reconnection

On WebSocket reconnect (browser refresh), the client calls `LLMService.get_current_state()` which returns current session messages, selected files, streaming status, session ID, and repo name. The client rebuilds its UI from this state. On first connect after server startup, the state already contains messages from the auto-restored last session (see [Context and History — Auto-Restore on Startup](../3-llm-engine/context_and_history.md#auto-restore-on-startup)).

The startup overlay only appears on first connection. On reconnect (when `_wasConnected` is already true), the overlay is skipped and a "Reconnected" success toast is shown instead.

## Server-Side Class Organization

Three top-level service classes, registered via `add_class()`:

| Class Name | RPC Prefix | Responsibility |
|------------|------------|---------------|
| **Repo** | `Repo.*` | Git operations, file I/O, tree, search |
| **LLMService** | `LLMService.*` | Chat streaming, context assembly, URL handling, history, symbol index |
| **Settings** | `Settings.*` | Config read/write/reload |

**Note:** The LLM service class is named `LLMService` in code, so all RPC methods are prefixed `LLMService.*` (e.g., `LLMService.chat_streaming`, `LLMService.get_context_breakdown`). Other specs may refer to these methods with the full prefix or the shorthand `LLM.*` — both refer to the same endpoints.

## RPC Method Inventory

### Repo Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `Repo.get_file_content` | `(path, version?) → string` | Read file; optional version (e.g., "HEAD") |
| `Repo.write_file` | `(path, content) → {status}` | Write content to file |
| `Repo.create_file` | `(path, content) → {status}` | Create new file (error if exists) |
| `Repo.file_exists` | `(path) → boolean` | Check file existence |
| `Repo.is_binary_file` | `(path) → boolean` | Binary detection |
| `Repo.stage_files` | `(paths) → {status}` | Git add |
| `Repo.unstage_files` | `(paths) → {status}` | Git reset |
| `Repo.discard_changes` | `(paths) → {status}` | Restore or delete |
| `Repo.delete_file` | `(path) → {status}` | Remove from filesystem |
| `Repo.rename_file` | `(old, new) → {status}` | Git mv or filesystem rename |
| `Repo.rename_directory` | `(old, new) → {status}` | Directory rename |
| `Repo.get_file_tree` | `() → {tree, modified, staged, untracked, diff_stats}` | Full tree with git status |
| `Repo.get_flat_file_list` | `() → string` | Sorted one-per-line file list |
| `Repo.get_staged_diff` | `() → string` | Git diff --cached |
| `Repo.get_unstaged_diff` | `() → string` | Git diff |
| `Repo.stage_all` | `() → {status}` | Git add -A |
| `Repo.commit` | `(message) → {sha, message}` | Create commit |
| `Repo.reset_hard` | `() → {status}` | Git reset --hard HEAD |
| `Repo.search_files` | `(query, whole_word?, use_regex?, ignore_case?, context_lines?) → [{file, matches}]` | Git grep |
| `Repo.search_commits` | `(query, branch?, limit?) → [{sha, message, author, date}]` | Search commit history |
| `Repo.get_current_branch` | `() → {branch, sha, detached}` | Current HEAD info |
| `Repo.list_branches` | `() → {branches, current}` | All branches |
| `Repo.is_clean` | `() → boolean` | Working tree clean check |
| `Repo.resolve_ref` | `(ref) → string` | Resolve ref to SHA |
| `Repo.get_commit_graph` | `(limit?, offset?, include_remote?) → {commits, branches, has_more}` | For review selector |
| `Repo.get_commit_log` | `(base, head?, limit?) → [{sha, message, author, date}]` | Commit log range |
| `Repo.get_commit_parent` | `(commit) → {sha, short_sha}` | Parent commit |
| `Repo.get_merge_base` | `(ref1, ref2?) → {sha, short_sha}` | Common ancestor |
| `Repo.checkout_review_parent` | `(branch, base_commit) → {branch, branch_tip, ...}` | Review entry |
| `Repo.setup_review_soft_reset` | `(branch_tip, parent_commit) → {status}` | Review setup |
| `Repo.exit_review_mode` | `(branch_tip, original_branch) → {status}` | Review exit |
| `Repo.get_review_file_diff` | `(path) → {path, diff}` | Single file review diff |
| `Repo.get_review_changed_files` | `() → [{path, status, additions, deletions}]` | Changed files in review |

### LLMService Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `LLMService.get_current_state` | `() → {messages, selected_files, streaming_active, session_id, repo_name, cross_ref_enabled}` | Full state snapshot |
| `LLMService.set_selected_files` | `(files) → [string]` | Update file selection |
| `LLMService.get_selected_files` | `() → [string]` | Current selection |
| `LLMService.chat_streaming` | `(request_id, message, files?, images?) → {status}` | Start streaming chat |
| `LLMService.cancel_streaming` | `(request_id) → {status}` | Cancel active stream |
| `LLMService.new_session` | `() → {session_id}` | Start new session |
| `LLMService.generate_commit_message` | `(diff_text) → string` | Generate commit message |
| `LLMService.get_context_breakdown` | `() → {model, total_tokens, blocks, breakdown, ...}` | Token/tier breakdown |
| `LLMService.check_review_ready` | `() → {clean, message?}` | Check for clean tree |
| `LLMService.get_commit_graph` | `(limit?, offset?, include_remote?) → {commits, branches, has_more}` | Delegates to Repo |
| `LLMService.start_review` | `(branch, base_commit) → {status, commits, changed_files, stats}` | Enter review mode |
| `LLMService.end_review` | `() → {status}` | Exit review mode |
| `LLMService.get_review_state` | `() → {active, branch?, ...}` | Current review state |
| `LLMService.get_review_file_diff` | `(path) → {path, diff}` | Delegates to Repo |
| `LLMService.get_snippets` | `() → [{icon, tooltip, message}]` | Mode-aware snippets |
| `LLMService.history_search` | `(query, role?, limit?) → [{session_id, messages}]` | Search history |
| `LLMService.history_get_session` | `(session_id) → [message]` | Full session messages |
| `LLMService.history_list_sessions` | `(limit?) → [SessionSummary]` | Recent sessions |
| `LLMService.history_new_session` | `() → {session_id}` | Start new history session |
| `LLMService.load_session_into_context` | `(session_id) → {messages, session_id}` | Load previous session |
| `LLMService.get_history_status` | `() → {tokens, max, percent, ...}` | History bar data |
| `LLMService.detect_urls` | `(text) → [{url, type, display_name}]` | URL detection |
| `LLMService.fetch_url` | `(url, use_cache?, summarize?, summary_type?, user_text?) → URLContent` | Fetch URL |
| `LLMService.detect_and_fetch` | `(text, use_cache?, summarize?) → [URLContent]` | Detect and fetch all |
| `LLMService.get_url_content` | `(url) → URLContent` | Get cached/fetched content |
| `LLMService.invalidate_url_cache` | `(url) → {status}` | Remove from cache+fetched |
| `LLMService.remove_fetched_url` | `(url) → {status}` | Remove from active context |
| `LLMService.clear_url_cache` | `() → {status}` | Clear all URL state |
| `LLMService.lsp_get_hover` | `(path, line, col) → {contents}` | Symbol hover info |
| `LLMService.lsp_get_definition` | `(path, line, col) → {file, range}` | Go to definition |
| `LLMService.lsp_get_references` | `(path, line, col) → [{file, range}]` | Find references |
| `LLMService.lsp_get_completions` | `(path, line, col, prefix?) → [{label, kind, detail}]` | Code completions |
| `LLMService.set_cross_reference` | `(enabled) → {status, cross_ref_enabled, message?}` | Enable/disable cross-reference mode |

### Settings Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `Settings.get_config_content` | `(type) → string` | Read config file |
| `Settings.save_config_content` | `(type, content) → {status}` | Write config file |
| `Settings.reload_llm_config` | `() → {status}` | Hot-reload LLM config |
| `Settings.reload_app_config` | `() → {status}` | Hot-reload app config |
| `Settings.get_config_info` | `() → {model, smaller_model, config_dir}` | Config info |
| `Settings.get_snippets` | `() → [{icon, tooltip, message}]` | Direct snippet access |
| `Settings.get_review_snippets` | `() → [{icon, tooltip, message}]` | Direct review snippet access |

### Browser Methods (Server → Client)

| Method | Signature | Description |
|--------|-----------|-------------|
| `AcApp.streamChunk` | `(requestId, content) → true` | Streaming content chunk |
| `AcApp.streamComplete` | `(requestId, result) → true` | Stream finished |
| `AcApp.compactionEvent` | `(requestId, event) → true` | Progress notification |
| `AcApp.filesChanged` | `(selectedFiles) → true` | File selection broadcast |
| `AcApp.startupProgress` | `(stage, message, percent) → true` | Startup initialization progress |

## Error Handling

- RPC errors follow JSON-RPC 2.0 error format
- Application-level errors return `{error: "message"}` dicts
- Connection loss triggers reconnection with exponential backoff (1s, 2s, 4s, 8s, max 15s)

## Server Initialization Pseudocode

The following shows how services are constructed and registered in `main.py`. The startup is split into two phases: a **fast phase** that gets the WebSocket server running and the browser connected, and a **deferred phase** that performs heavy initialization with progress reporting.

### Phase 1: Fast Startup (WebSocket + Browser)

```pseudo
# 1. Initialize lightweight services (fast — no parsing)
config = ConfigManager(repo_root)
repo = Repo(repo_root)
settings = Settings(config)

# 2. Create LLM service with deferred init (no symbol index yet)
llm_service = LLMService(
    config_manager=config,
    repo=repo,
    symbol_index=None,
    deferred_init=True,       # skip session restore, stability init
)

# 3. Register with RPC server
server = JRPCServer(port, remote_timeout=60)
server.add_class(repo)
server.add_class(llm_service)
server.add_class(settings)

# 4. Wire up callbacks (chunk_callback, event_callback)
# 5. Start server — WebSocket now accepting connections
await server.start()

# 6. Open browser immediately — user sees startup overlay
webbrowser.open(url)
```

### Phase 2: Deferred Initialization (with Progress)

```pseudo
# 7. Wait briefly for browser to connect
await asyncio.sleep(0.5)

# 8. Initialize symbol index (optional — may fail if tree-sitter unavailable)
await send_progress("symbol_index", "Initializing symbol parser...", 10)
symbol_index = SymbolIndex(repo_root)

# 9. Complete deferred init — restore last session
await send_progress("session_restore", "Restoring session...", 30)
llm_service.complete_deferred_init(symbol_index)

# 10. Index repository (heaviest step — parses all source files)
await send_progress("indexing", "Indexing repository...", 50)
await run_in_executor(symbol_index.index_repo, file_list)

# 11. Initialize stability tracker (tier assignments, reference graph)
await send_progress("stability", "Building cache tiers...", 80)
llm_service._try_initialize_stability()

# 12. Signal ready — browser dismisses startup overlay
await send_progress("ready", "Ready", 100)
```

Progress is sent via `AcApp.startupProgress(stage, message, percent)` — best-effort, since the browser may not be connected yet during early stages. The `_init_complete` flag gates `chat_streaming` so requests are rejected with a user-friendly message until initialization finishes.

**Event callback variance:** Different events pass different argument shapes:
- `streamComplete(request_id, result)` — 2 args
- `compactionEvent(request_id, event_dict)` — 2 args
- `filesChanged(selected_files_list)` — 1 arg (no request_id)
- `startupProgress(stage, message, percent)` — 3 args

The `*args` splat handles this variance, but callers must match the browser method signatures exactly.

## Threading Notes

From a background thread (e.g., LLM streaming worker), use `asyncio.run_coroutine_threadsafe` to schedule calls on the event loop. Use `asyncio.wait_for` for timeouts on server→browser calls.

## Version Reporting

On `setupDone`, the server includes its version SHA in the connection metadata. The client logs this to console for debugging. No version negotiation or compatibility enforcement — the hosted webapp URL already includes the matching SHA.

## serverURI Changes

A top-level change to `serverURI` triggers reconnection to the new URI in all classes inheriting from jrpc-oo.