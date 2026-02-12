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
        await self.call["streamChunk"](request_id, content)
```

**Response envelope:** All jrpc-oo return values are wrapped as `{ "remote_id": return_value }`. Extract the actual value from the single key.

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

**Methods the server can call** must be registered via `addClass` and must return a value (the server awaits each call):

```javascript
streamChunk(requestId, content) {
    this._dispatch('stream-chunk', { requestId, content });
    return true;  // acknowledgement
}
```

### Connection Lifecycle

| Event | Description |
|-------|-------------|
| WebSocket opens | jrpc-oo handshake begins |
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
1. Browser → Server:  LLM.chat_streaming(request_id, prompt, files, images)
2. Server → Browser:  streamChunk(request_id, content)     // repeated
3. Server → Browser:  streamComplete(request_id, result)    // once
4. Server → Browser:  compactionEvent(request_id, event)    // optional
```

Each chunk/completion is a full JSON-RPC method call from server to client.

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

On WebSocket reconnect (browser refresh), the client calls `LLM.get_current_state()` which returns current session messages, selected files, streaming status, and session ID. The client rebuilds its UI from this state.

## Server-Side Class Organization

Three top-level service classes:

| Service | Responsibility |
|---------|---------------|
| **Repo** | Git operations, file I/O, tree, search |
| **LLM** | Chat streaming, context assembly, URL handling, history, symbol index |
| **Settings** | Config read/write/reload |

## Error Handling

- RPC errors follow JSON-RPC 2.0 error format
- Application-level errors return `{error: "message"}` dicts
- Connection loss triggers reconnection with exponential backoff (1s, 2s, 4s, 8s, max 15s)