# JRPC-OO Spec

JRPC-OO is the bidirectional communication layer between the Python server and the browser client. It uses JSON-RPC 2.0 over WebSockets, with an object-oriented wrapper that lets both sides call methods on each other's registered classes as if they were local objects.

## Overview

Once connected, the server and client are symmetric peers. Either side can initiate a call to the other. The server exposes Python class instances; the client exposes JavaScript class instances. Method calls cross the network transparently — the caller doesn't need to know whether the method runs locally or remotely.

## Connection Setup

### Server side (Python)

```pseudo
server = JRPCServer(port=18080)

# Register class instances — all public methods become callable
server.add_class(repo)       # exposes Repo.get_file_tree, Repo.search_files, etc.
server.add_class(llm)        # exposes LiteLLM.chat_streaming, LiteLLM.get_context_breakdown, etc.
server.add_class(settings)   # exposes Settings.get_config_info, etc.

await server.start()
```

Each `add_class(instance)` registers all public methods of that instance under the namespace `ClassName.method_name`. For example, a `Repo` instance with a `get_file_tree()` method becomes callable as `Repo.get_file_tree`.

### Client side (JavaScript)

```pseudo
class MessageHandler extends JRPCClient {
  constructor() {
    super()
  }

  connectedCallback() {
    // JRPCClient reads this.serverURI and opens a WebSocket
    this.serverURI = `ws://localhost:${port}`
    super.connectedCallback()
  }

  // Once connected, jrpc-oo calls:
  //   setupDone()      — connection established, this.call is available
  //   remoteIsUp()     — server is ready
  //   remoteDisconnected(uuid) — server went away
}
```

`JRPCClient` is a LitElement base class. When it connects to the server, it populates `this.call` — a proxy object whose properties are callable server methods.

## Calling the Server from the Client

After `setupDone()` fires, the client can call any registered server method through `this.call`:

```pseudo
// Client calls server method
response = await this.call['LiteLLM.get_context_breakdown'](selectedFiles, fetchedUrls)

// Response is wrapped as { 'LiteLLM.get_context_breakdown': result }
result = extractResponse(response)  // unwraps to just the return value
```

Under the hood:
1. Client sends a JSON-RPC 2.0 request: `{ jsonrpc: "2.0", method: "LiteLLM.get_context_breakdown", params: [...], id: 1 }`
2. Server receives it, finds the `LiteLLM` instance, calls `get_context_breakdown(*params)`
3. Server sends back: `{ jsonrpc: "2.0", result: { "LiteLLM.get_context_breakdown": <value> }, id: 1 }`
4. Client's `await` resolves with the response object

The `extractResponse()` helper unwraps the `{ method_name: value }` envelope, returning just the value.

## Calling the Client from the Server

The server can also call methods on the client. Any public method defined on the `JRPCClient` subclass (or its mixin chain) is callable from the server. The server uses its reference to the JRPC server object:

```pseudo
# Server calls client method (Python side)
# llm.server was set during setup: llm.server = server
await server.call['streamChunk'](request_id, content)
await server.call['streamComplete'](request_id, result)
await server.call['compactionEvent'](request_id, event)
```

The client must define these methods and return a value so the JSON-RPC response is sent back:

```pseudo
// Client defines callable methods (JavaScript side)
class PromptView extends MixedBase {
  streamChunk(requestId, content) {
    // process the chunk...
    return true   // acknowledgement sent back to server
  }

  streamComplete(requestId, result) {
    // process completion...
    return true
  }

  compactionEvent(requestId, event) {
    // process event...
    return true
  }
}
```

**Important**: Server→client calls expect a return value. If the client method doesn't return anything, the server's `await` may hang or timeout. Always return an acknowledgement value.

## The `call` Proxy Object

`this.call` is the central mechanism for cross-network method invocation. It is a proxy where any property access returns an async callable:

```pseudo
this.call['ClassName.method'](...args)  →  Promise<response>
```

- Available after `setupDone()` on the client
- Namespaced by class name on the server side (`Repo.get_status`, `LiteLLM.fetch_url`)
- Flat (no namespace) for server→client calls (`streamChunk`, `compactionEvent`)

## RPC Distribution to Child Components

Only `PromptView` (the `JRPCClient` subclass) has a direct WebSocket connection. Child components get RPC access through a shared singleton rather than prop-drilling:

```pseudo
// PromptView publishes its call object on connect
setupDone() {
  setSharedRpcCall(this.call)    // store in singleton
}

// Any child component using RpcMixin auto-acquires it
class CacheViewer extends RpcMixin(LitElement) {
  onRpcReady() {
    // this.rpcCall is now available
    this.refreshBreakdown()
  }

  async refreshBreakdown() {
    result = await this._rpcExtract('LiteLLM.get_context_breakdown', files, urls)
  }
}
```

`RpcMixin` provides convenience methods:
- `_rpc(method, ...args)` — raw call, returns full response
- `_rpcExtract(method, ...args)` — call + `extractResponse()` unwrap
- `_rpcWithState(method, options, ...args)` — call with automatic `isLoading`/`error` state management

Components that connect before `PromptView` has published the call object use `waitForRpc()`, which returns a promise that resolves once `setSharedRpcCall()` is called.

## Streaming Pattern

JRPC-OO's bidirectional calling enables a streaming pattern where:

1. **Client→Server**: Client initiates `LiteLLM.chat_streaming(requestId, prompt, files, ...)`
2. **Server→Client**: Server calls `streamChunk(requestId, content)` repeatedly as tokens arrive
3. **Server→Client**: Server calls `streamComplete(requestId, result)` when finished
4. **Server→Client**: Server may call `compactionEvent(requestId, event)` if history compaction occurs

This is not WebSocket streaming in the traditional sense — each chunk is a full JSON-RPC method call from server to client, with the client returning an acknowledgement.

## Connection Lifecycle

| Event | Trigger | What happens |
|---|---|---|
| WebSocket opens | `connectedCallback` sets `serverURI` | JRPC handshake begins |
| `remoteIsUp()` | Server responds to handshake | Connection confirmed |
| `setupDone()` | `this.call` proxy is populated | Client can call server; publishes `call` to singleton |
| Normal operation | Either side calls the other | JSON-RPC 2.0 request/response pairs over WebSocket |
| `remoteDisconnected(uuid)` | WebSocket closes | Client marks `isConnected = false` |

## Transport

- **Protocol**: JSON-RPC 2.0 over WebSocket
- **Default server port**: 18080 (configurable via `--server-port`)
- **Client connects to**: `ws://localhost:{port}` (port passed via URL query param `?port=`)
- **Single connection**: One WebSocket per `PromptView` instance; all RPC traffic multiplexed over it
- **Library**: `@flatmax/jrpc-oo` (npm) / `jrpc_oo` (Python)
