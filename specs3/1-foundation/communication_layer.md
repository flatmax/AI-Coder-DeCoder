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

The frontend handles these by stage name — compaction stages update the message display, URL stages show toast notifications.

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

## Server-Side Class Organization

Three top-level service classes, registered via `add_class()`:

| Class Name | RPC Prefix | Responsibility |
|------------|------------|---------------|
| **Repo** | `Repo.*` | Git operations, file I/O, tree, search |
| **LLMService** | `LLMService.*` | Chat streaming, context assembly, URL handling, history, symbol index |
| **Settings** | `Settings.*` | Config read/write/reload |

**Note:** The LLM service class is named `LLMService` in code, so all RPC methods are prefixed `LLMService.*` (e.g., `LLMService.chat_streaming`, `LLMService.get_context_breakdown`). Other specs may refer to these methods with the full prefix or the shorthand `LLM.*` — both refer to the same endpoints.

## Error Handling

- RPC errors follow JSON-RPC 2.0 error format
- Application-level errors return `{error: "message"}` dicts
- Connection loss triggers reconnection with exponential backoff (1s, 2s, 4s, 8s, max 15s)

## Threading Notes

From a background thread (e.g., LLM streaming worker), use `asyncio.run_coroutine_threadsafe` to schedule calls on the event loop. Use `asyncio.wait_for` for timeouts on server→browser calls.

## Version Reporting

On `setupDone`, the server includes its version SHA in the connection metadata. The client logs this to console for debugging. No version negotiation or compatibility enforcement — the hosted webapp URL already includes the matching SHA.

## serverURI Changes

A top-level change to `serverURI` triggers reconnection to the new URI in all classes inheriting from jrpc-oo.