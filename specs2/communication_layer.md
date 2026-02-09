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

A single WebSocket connection carries all traffic, multiplexed by JSON-RPC request IDs. The server binds to `localhost` only — not externally accessible. Other local applications may connect; this is acceptable for a developer tool.

## How jrpc-oo Works

### Class Registration

Both sides register class instances. All public methods of a registered class become remotely callable, namespaced as `ClassName.method_name`.

```pseudo
// Server side
server = JRPCServer(port)
server.add_class(repo_instance)       // exposes Repo.get_file_tree, etc.
server.add_class(llm_instance)        // exposes LLM.chat_streaming, etc.
server.add_class(settings_instance)   // exposes Settings.get_config_info, etc.
await server.start()
```

```pseudo
// Browser side
class AppClient extends JRPCClient
    on connection ready:
        this.call is now available as a proxy object
```

### Calling Remote Methods

After the handshake completes, calls look like local async function calls:

```pseudo
// Browser calls server
result = await this.call['Repo.get_file_tree']()

// Server calls browser
await server.call['streamChunk'](request_id, content)
```

The response is wrapped as `{ 'MethodName': return_value }`. A utility function unwraps this envelope.

### Connection Lifecycle

| Event | Description |
|-------|-------------|
| WebSocket opens | jrpc-oo handshake begins |
| `remoteIsUp()` | Connection confirmed, remote is ready |
| `setupDone()` | `call` proxy populated — can now make RPC calls |
| Normal operation | Request/response pairs over the shared connection |
| `remoteDisconnected()` | WebSocket closed, mark disconnected |

## RPC Distribution to Child Components

Only the root webapp component holds the WebSocket connection. Child components get RPC access through a shared singleton pattern:

```pseudo
// Root component publishes on connect
on setupDone:
    SharedRpcSingleton.set(this.call)

// Any child component acquires it
class ChildComponent uses RpcMixin:
    on rpc ready:
        // this.rpcCall is available
        result = await this.rpcExtract('Repo.search_files', query)
```

The mixin provides convenience methods:
- **raw call** — returns the full response envelope
- **extract call** — unwraps the envelope automatically
- **stateful call** — manages loading/error state for the component

Components that initialize before the connection is ready can await a promise that resolves when the singleton is populated.

## Streaming Pattern

The bidirectional nature enables a server-push streaming pattern:

```
1. Browser → Server:  LLM.chat_streaming(request_id, prompt, files, ...)
2. Server → Browser:  streamChunk(request_id, content)     // repeated
3. Server → Browser:  streamComplete(request_id, result)    // once
4. Server → Browser:  compactionEvent(request_id, event)    // optional
```

Each chunk/completion is a full JSON-RPC method call from server to client. The client must return an acknowledgement value (the server awaits each call).

## Concurrency

### Single Active Stream

Only one LLM streaming request may be active at a time. The server tracks the active request ID. If a second `chat_streaming` call arrives while one is running, it is rejected with an error response. The UI enforces this by disabling send during streaming, but the server is the authoritative guard.

### Multiple Clients

jrpc-oo natively supports multiple connected remotes, each tracked by UUID. All clients share the same Repo, LLM, and Settings service instances. Streaming callbacks are directed to the originating remote only (matched by request ID and remote UUID). Non-streaming RPC calls (file tree, search, config) are served concurrently to all connected clients.

### Browser Refresh / Reconnection

On WebSocket reconnect (browser refresh, tab reopen), the client calls `LLM.get_current_state()` which returns:
- Current session messages (for chat rebuild)
- Selected files
- Whether a stream is currently active
- Current session ID

The client rebuilds its UI from this state. If a stream is active from another client, the reconnected client sees the chat history but does not receive the in-progress stream chunks.

### Multi-Client Behavior

All state is **global** across connected clients — there is no per-connection state on the server.

| State | Scope | Sync Mechanism |
|-------|-------|----------------|
| Selected files | Global | Broadcast `filesChanged(selected_files)` to all clients on change |
| File tree | Global | Same repo; clients refresh independently |
| Conversation history | Global | One conversation; clients fetch on connect |
| Streaming | Global | Chunks delivered only to originating client; others see completed response on next state fetch |

When any client changes the file selection, the server updates its state and broadcasts to all connected clients. This keeps file pickers synchronized — two browser tabs always show the same selection.

## Server-Side Class Organization

Three top-level service classes are registered:

| Service | Responsibility |
|---------|---------------|
| **Repo** | Git operations, file I/O, tree, search |
| **LLM** | Chat streaming, context assembly, URL handling, history |
| **Settings** | Config read/write/reload |

Each is composed via mixins for modularity (see individual specs).

## Error Handling

- RPC errors follow JSON-RPC 2.0 error format
- Application-level errors return `{error: "message"}` dicts
- Connection loss triggers reconnection attempts on the client
- A method-not-found error is raised for unregistered methods

## Transport Configuration

- **Default server port**: 18080 (configurable via CLI)
- **Bind address**: `localhost` (127.0.0.1) — local only
- **Protocol**: `ws://` (plain WebSocket)
- **Port passed to browser**: via URL query parameter `?port=N`

## Version Reporting

On `setupDone`, the server includes its version SHA in the connection metadata. The client logs this to console for debugging. No version negotiation or compatibility enforcement — the hosted webapp URL already includes the matching SHA.

## jrpc-oo Dependency

The jrpc-oo library handles all WebSocket transport, method registration, proxy creation, and connection lifecycle. Its class-based API means that the service classes (Repo, LLM, Settings) **are** the RPC interface — public methods become remotely callable automatically.

**Implementation note:** At build time, the jrpc-oo symbol map and architecture summary should be provided in context so the implementer understands the `addClass()`, `call[]` proxy, `setupDone()`, and `remoteIsUp()` patterns. The library handles concurrent multi-client connections natively — each client gets its own remote proxy, and calls are queued/handled by the library's event loop integration.

No custom WebSocket framing, message size limits, or connection pooling is needed — jrpc-oo manages this over localhost. Concurrency between different service classes (Repo, LLM, Settings) is naturally independent since they are separate registered class instances.
