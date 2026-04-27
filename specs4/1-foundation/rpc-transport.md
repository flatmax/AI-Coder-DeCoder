# RPC Transport

**Status:** stub

Bidirectional JSON-RPC 2.0 over a single WebSocket connection, using the jrpc-oo library. Either side can call methods exposed by the other.

## Connection Model

- Single WebSocket carries all traffic, multiplexed by JSON-RPC request IDs
- Browser is the client; Python process is the server
- Localhost-only binding by default; all-interfaces binding when collaboration is enabled
- Port passed to browser via URL query parameter

## Transport Configuration

- Default server port selection and override
- Default webapp port selection and override
- Remote timeouts (server-side and browser-side)
- Protocol is plain `ws://` — no TLS (local tool)
- Maximum WebSocket frame size is raised from the `websockets` library default (1 MiB) to 64 MiB so data-URI image payloads in chat args don't trip code 1009 disconnects. The limit still provides back-pressure against pathological payloads.

## Registering Services

- Server-side: objects have their public methods auto-exposed; namespace derived from class name
- Browser-side: root component registers methods the server can call
- Underscore-prefixed methods are never exposed

## Calling Conventions

- Server → browser: uses bracket-notation proxy on a `call` attribute
- Browser → server: uses bracket-notation proxy on a `call` attribute
- Response envelope unwrapping (single-key object → direct value)
- Multi-remote responses are keyed by client UUID; first value wins for read ops
- Broadcasts reach all connected admitted remotes

## Streaming Pattern

- Browser initiates a streaming request with a generated request ID
- Server returns synchronously with `{status: "started"}`, streams via server-push
- Chunk payloads carry full accumulated content, not deltas — dropped/reordered chunks are harmless
- A completion event signals end of stream
- Progress events (e.g., compaction, URL fetch) share the same channel

## Connection Lifecycle

- Handshake hook (before JRPC setup) — used by collaboration admission
- `remoteIsUp` — connection confirmed
- `setupDone` — call proxy populated, ready to invoke methods
- Disconnect and reconnect triggers
- Reconnection uses exponential backoff (1s, 2s, 4s, 8s, cap 15s)

## Threading

- Server event loop reference must be captured on the event loop thread before launching worker threads
- Worker threads schedule callbacks via `run_coroutine_threadsafe` using the captured loop
- Callers must never acquire a new event loop inside a worker thread

## Concurrency

- Only one user-initiated LLM streaming request is active at a time (enforced by the LLM service)
- A user-initiated request may spawn additional internal streams (e.g. parallel agents) that share the parent's request ID as a prefix and are distinguished by child IDs — these coexist under the parent request and are not blocked by the single-stream guard (see [streaming.md](../3-llm/streaming.md#multiple-agent-streams-under-a-parent-request))
- Request IDs are the multiplexing primitive — the transport never assumes a singleton stream; every server-push event carries the exact ID of the stream it belongs to
- Non-streaming calls are served concurrently
- All state is global across connected clients; file selection and streaming are broadcast to all admitted remotes

## Reconnection Behavior

- On reconnect, the client fetches current state via a single RPC call and rebuilds its UI
- First connect shows a startup overlay driven by progress events
- Subsequent reconnects show only a transient "Reconnected" toast

## Invariants

- Every server-push event reaches all admitted clients unless explicitly filtered
- Every server-push event carries the exact request ID of the stream it belongs to; the transport never assumes a singleton stream
- A captured event-loop reference is always usable from a worker thread
- A reconnecting client never receives duplicate state that would double-apply history or selections
- Methods on registered objects must return a value (server awaits every browser-side call)