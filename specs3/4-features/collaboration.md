# Collaboration Mode

## Overview

Collaboration mode allows multiple browsers to connect to a single AC⚡DC Python backend. The first connection is auto-admitted as the host. All subsequent connections require explicit admission from any already-admitted user via a toast prompt. Once admitted, non-localhost participants see the full UI and receive all broadcast events (streaming responses, file changes, etc.) but cannot send prompts, mutate LLM state, or perform git operations.

## Connection Lifecycle

### First Connection (Auto-Admit)

The first WebSocket connection to the server is auto-admitted with no screening. This is the host — in normal usage, the person who started the Python process and opened their localhost browser. No admission toast is shown.

### Subsequent Connections (Admission Required)

All connections after the first are held in a pending state before JRPC setup completes. The server overrides the JRPC-oo `handle_connection` method to insert screening logic:

1. New WebSocket connects
2. Server detects this is not the first connection
3. Server sends a raw WebSocket message: `{"type": "admission_pending"}` with a generated `client_id`
4. Server does **not** call `super().handle_connection()` yet — no JRPC2 remote is created, no methods are exposed
5. Server broadcasts an `admissionRequest` event to all admitted clients via `self.call`
6. An admitted user clicks **Admit** or **Deny** in their UI
7. On admit: server calls `super().handle_connection()`, completing normal JRPC setup. The client becomes a full participant.
8. On deny: server closes the WebSocket with code 1008. No JRPC state was created.

### Disconnection

When a client disconnects, the server removes them from the client registry. If the host disconnects, the next admitted client (by admission order) becomes the host. If the last client disconnects, the server resets — the next connection will be auto-admitted as the first.

## Server Architecture

### CollabServer Subclass

`CollabServer` extends the JRPC-oo `JRPCServer` class. It overrides `handle_connection` to insert admission screening and caller tracking. Once a connection is admitted, it runs its own message receive loop (mirroring `JRPCServer.handle_connection`) to set `_current_caller_uuid` before each dispatch.

```python
class CollabServer(JRPCServer):
    async def handle_connection(self, websocket):
        peer_ip = websocket.remote_address[0]

        if self._is_first_connection():
            self._register_client(websocket, peer_ip, role='host')
        else:
            admitted = await self._wait_for_admission(websocket, peer_ip)
            if not admitted:
                await websocket.close(1008, "Denied")
                return

        # Create JRPC remote and run receive loop with caller tracking
        remote = self.create_remote(websocket)
        client_id = self._register_remote(remote, peer_ip)
        try:
            async for message in websocket:
                self._current_caller_uuid = remote.uuid
                data = message if isinstance(message, str) else message.decode()
                remote.receive(data)
        finally:
            self._unregister_client(remote.uuid)
```

### Client Registry

The server maintains a registry of connected clients:

| Field | Description |
|-------|-------------|
| `client_id` | UUID assigned on connection |
| `ip` | Peer IP address from WebSocket |
| `role` | `host` or `participant` |
| `is_localhost` | Whether peer IP is loopback (`127.0.0.1`, `::1`) or a local interface |
| `admitted_at` | Timestamp of admission |
| `websocket` | Reference to the WebSocket connection |

### Pending Queue

Pending connections are tracked separately:

| Field | Description |
|-------|-------------|
| `client_id` | UUID for this pending request |
| `ip` | Peer IP address |
| `websocket` | Raw WebSocket (pre-JRPC) |
| `future` | `asyncio.Future` resolved by admit/deny |
| `requested_at` | Timestamp |

Pending requests that are not acted on within **120 seconds** are auto-denied and the WebSocket is closed. This prevents abandoned connections from accumulating.

If a new connection arrives from the same IP while a previous request is still pending (e.g., the user refreshed their browser), the old pending request is auto-denied and its toast is removed before the new request is created. The cancelled request's `admissionResult` includes `"replaced": true` so frontends can distinguish this from an explicit deny.

The server also monitors the pending client's WebSocket for closure. If the pending client disconnects before a decision is made (e.g., closes the tab), the request is cleaned up and an `admissionResult` broadcast removes the toast from all admitted clients.

### Localhost Detection

A connection is considered localhost if the peer IP matches:
- `127.0.0.1`
- `::1`
- Any IP address assigned to a local network interface

This handles the case where the host opens their browser to their LAN IP (e.g., `192.168.1.50`) instead of `localhost`.

### Host Promotion

When the current host disconnects:
1. The next admitted client (by `admitted_at` timestamp) is promoted to host
2. The promoted client receives a `roleChanged` event with their new role
3. All clients receive an updated client list
4. If the promoted client is non-localhost, they gain host role but still cannot send prompts — only localhost hosts can send prompts

### Role vs Localhost

Role and localhost are independent concepts:

| | localhost | non-localhost |
|---|---|---|
| **host** | Full control (normal single-user behavior) | Can admit/deny, but cannot send prompts or mutate |
| **participant** | Full control (same as host in practice) | Read-only: can browse, search, view |

The meaningful restriction is **localhost vs non-localhost**, not host vs participant. The host role primarily determines who can admit/deny new connections when no localhost client is connected. Any localhost connection can always send prompts regardless of host/participant role.

## RPC Restrictions

### Localhost-Only RPCs

The following operations are restricted to localhost connections:

| Category | Methods | Enforcement |
|----------|---------|-------------|
| **LLM interaction** | `chat_streaming`, `generate_commit_message`, `cancel_streaming` | `LLMService._check_localhost_only()` |
| **Session management** | `new_session`, `load_session_into_context`, `history_new_session` | `LLMService._check_localhost_only()` |
| **LLM state** | `set_selected_files`, `switch_mode`, `set_cross_reference` | `LLMService._check_localhost_only()` |
| **Review mode** | `start_review`, `end_review` | `LLMService._check_localhost_only()` |
| **Git operations** | `commit`, `stage_files`, `unstage_files`, `rename_file`, `delete_file`, `create_file`, `write_file`, `discard_changes`, `reset_hard`, `stage_all` | `Repo._check_localhost_only()` |
| **Settings** | `save_config_content`, `reload_llm_config`, `reload_app_config` | `Settings._check_localhost_only()` |

### Everyone RPCs

These are available to all admitted clients:

| Category | Methods |
|----------|---------|
| **Read operations** | `get_file_content`, `get_file_tree`, `search`, `get_current_state` |
| **Navigation** | `get_flat_file_list`, `get_symbol_map`, `get_context_breakdown` |
| **History browse** | `list_sessions`, `get_session_messages` |
| **Collaboration** | `Collab.admit_client`, `Collab.deny_client`, `Collab.get_connected_clients` |

### Enforcement

RPC restriction is enforced by identifying which remote triggered a call. `CollabServer` overrides `handle_connection` to run its own message receive loop (rather than delegating entirely to `super()`). Before each `remote.receive(message)` dispatch, it sets a context variable identifying the caller:

```python
class CollabServer(JRPCServer):
    async def _run_admitted_connection(self, websocket, peer_ip, role):
        remote = self.create_remote(websocket)
        self._collab._register_client(remote.uuid, peer_ip, role=role,
                                       websocket=websocket, remote=remote)
        try:
            async for message in websocket:
                self._current_caller_uuid = remote.uuid
                data = message if isinstance(message, str) else message.decode()
                remote.receive(data)
        finally:
            self._current_caller_uuid = None
            self._collab._unregister_client(remote.uuid)
```

This mirrors the receive loop in `JRPCServer.handle_connection` but adds caller tracking. Service classes check the caller via the shared `Collab` instance:

```python
class LLMService:
    def _check_localhost_only(self):
        """Returns None if allowed, or error dict if restricted."""
        if self._collab and not self._collab._is_caller_localhost():
            return {"error": "restricted", "reason": "Participants cannot perform this action"}
        return None

    def chat_streaming(self, request_id, message, ...):
        restricted = self._check_localhost_only()
        if restricted:
            return restricted
        # ... normal logic
```

The `_collab` reference is set on each service class in `main.py`:

```python
collab = Collab()
server = CollabServer(server_port, collab=collab)
llm_service._collab = collab
repo._collab = collab
settings._collab = collab
```

The `Collab._is_caller_localhost()` method reads `server._current_caller_uuid` (set per-message in the receive loop) and looks up the client's `is_localhost` flag in the registry. When no caller tracking is available (single-user fallback), it returns `True`.

## New RPC Methods

The following methods are on the `Collab` class, registered via `server.add_class(collab, 'Collab')`. RPC prefix is `Collab.*`.

### `admit_client(client_id: str) → dict`

Admits a pending client. Can be called by any admitted user.

Returns: `{"ok": True, "client_id": client_id}`

### `deny_client(client_id: str) → dict`

Denies a pending client. Closes their WebSocket.

Returns: `{"ok": True, "client_id": client_id}`

### `get_connected_clients() → list`

Returns the list of currently connected clients.

```json
[
  {"client_id": "abc-123", "ip": "127.0.0.1", "role": "host", "is_localhost": true},
  {"client_id": "def-456", "ip": "192.168.1.42", "role": "participant", "is_localhost": false}
]
```

### `get_collab_role() → dict`

Called by a client after JRPC setup to learn its own role.

```json
{"role": "participant", "is_localhost": false, "client_id": "def-456"}
```

## Server → Client Events

### `admissionRequest(data: dict)`

Broadcast to all admitted clients when a new connection is pending.

```json
{"client_id": "xyz-789", "ip": "192.168.1.42", "requested_at": "2025-01-15T10:30:00Z"}
```

### `admissionResult(data: dict)`

Broadcast to all admitted clients when a pending request is resolved.

```json
{"client_id": "xyz-789", "ip": "192.168.1.42", "admitted": true}
```

### `clientJoined(data: dict)`

Broadcast when a client completes admission and JRPC setup.

```json
{"client_id": "xyz-789", "ip": "192.168.1.42", "role": "participant", "is_localhost": false}
```

### `clientLeft(data: dict)`

Broadcast when a client disconnects.

```json
{"client_id": "xyz-789", "ip": "192.168.1.42", "role": "participant"}
```

### `modeChanged(data: dict)`

Broadcast when a localhost client switches between code and document modes, or toggles cross-reference mode.

```json
{"mode": "doc"}
```

When triggered by a cross-reference toggle, includes the cross-ref state:

```json
{"mode": "code", "cross_ref_enabled": true}
```

### `sessionChanged(data: dict)`

Broadcast when a localhost client starts a new session or loads a previous session. Contains the full message list so all clients can reset their chat panel.

```json
{"session_id": "sess_1234_abc", "messages": [...]}
```

### `roleChanged(data: dict)`

Sent to a specific client when their role changes (e.g., promoted to host).

```json
{"role": "host", "reason": "previous host disconnected"}
```

### `navigateFile(data: dict)`

Broadcast when any client navigates to a file (clicks in file picker, search result, edit block anchor, etc.). All clients open the same file in their viewer.

```json
{"path": "src/ac_dc/llm_service.py"}
```

## Raw WebSocket Messages (Pre-JRPC)

These are sent on the raw WebSocket before JRPC setup, for pending clients:

### `admission_pending`

Sent immediately when a non-first connection is held.

```json
{"type": "admission_pending", "client_id": "xyz-789"}
```

### `admission_granted`

Sent when the pending client is admitted. The client then expects normal JRPC setup to follow.

```json
{"type": "admission_granted", "client_id": "xyz-789"}
```

### `admission_denied`

Sent just before the WebSocket is closed.

```json
{"type": "admission_denied", "client_id": "xyz-789", "reason": "Denied by host"}
```

## Frontend

### Pending State (Pre-JRPC)

The webapp detects the pending state by intercepting raw WebSocket messages before jrpc-oo processes them. This requires overriding `serverChanged()` in the app shell (which jrpc-oo calls when the WebSocket is created) to add a capturing `addEventListener('message')` listener on the WebSocket:

```javascript
serverChanged() {
    super.serverChanged();  // creates WebSocket
    const ws = this._ws || this.ws;
    if (ws && ws.addEventListener) {
        if (this._rawWsListener) {
            ws.removeEventListener('message', this._rawWsListener);
        }
        this._rawWsListener = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data?.type === 'admission_pending') {
                    this._admissionPending = true;
                    this._admissionClientId = data.client_id;
                    event.stopImmediatePropagation();
                    return;
                }
                if (data?.type === 'admission_granted') {
                    this._admissionPending = false;
                    event.stopImmediatePropagation();
                    return;
                }
                if (data?.type === 'admission_denied') {
                    this._admissionPending = false;
                    this._admissionDenied = true;
                    event.stopImmediatePropagation();
                    return;
                }
            } catch (_) {}
        };
        ws.addEventListener('message', this._rawWsListener);
    }
}
```

All three admission message types are consumed via `stopImmediatePropagation()` and never reach jrpc-oo's message handler. This approach is necessary because jrpc-oo uses `addEventListener('message')` internally rather than `ws.onmessage`, so replacing `onmessage` would not intercept messages. The listener is re-attached each time `serverChanged` fires (e.g. on reconnect) and the previous listener is removed to avoid duplicates.

When `admission_pending` is received, the app shows a centered waiting screen:

```
┌──────────────────────────────────┐
│                                  │
│     Waiting for admission...     │
│                                  │
│   Requesting access to ac-dc     │
│                                  │
│          [ Cancel ]              │
│                                  │
└──────────────────────────────────┘
```

The Cancel button closes the WebSocket.

On `admission_granted`, the app proceeds with normal JRPC setup (`setupDone` etc.). On `admission_denied`, the app shows a brief "Access denied" message and disconnects.

### Participant UI Restrictions

When `get_collab_role()` returns `is_localhost: false`:

- **Chat input area**: replaced with a static bar: `"Viewing as participant — prompts are host-only"`
- **File picker context menu**: git-mutating items hidden (rename, delete, new file)
- **File picker checkboxes**: hidden (cannot change LLM context)
- **Commit button**: hidden
- **Settings tab editing**: disabled
- **Mode toggle**: disabled
- **New Session / Load Session**: disabled
- **Review mode controls**: hidden

Everything else works normally: browsing files, viewing diffs, searching, reading chat history, viewing the SVG viewer, using tabs.

### Admission Toast

When an `admissionRequest` event arrives via `AcApp.admissionRequest(data)`, a persistent (non-auto-dismissing) toast is shown:

```
┌──────────────────────────────────────┐
│  🔔  192.168.1.42 wants to connect   │
│                                      │
│              [ Admit ]  [ Deny ]     │
└──────────────────────────────────────┘
```

The `_admissionRequests` array must be declared as a Lit reactive property (`{ type: Array, state: true }`) so that appending a new request triggers a re-render. The array is updated immutably (`this._admissionRequests = [...this._admissionRequests, data]`).

The toast remains until acted upon. Multiple pending requests show multiple toasts, stacked. If a new request arrives from the same IP as an existing pending toast (e.g., the remote user refreshed their browser), the old toast is replaced rather than duplicated.

Clicking **Admit** calls `Collab.admit_client(client_id)`. Clicking **Deny** calls `Collab.deny_client(client_id)`.

When `admissionResult` is received, the matching request is removed from `_admissionRequests`, dismissing its toast. If someone else already acted on it, the toast is also dismissed.

### Connected Users Indicator

A small indicator in the dialog header shows the count of connected clients:

`👥 2` — visible when more than one client is connected. Hidden in single-user mode to avoid clutter.

Clicking it could show a popover with the client list and a **Kick** button (future enhancement — not in phase 1).

## Integration with Existing Systems

### Communication Layer

When `--collab` is passed, `CollabServer` replaces `JRPCServer` in `main.py`. A `Collab` instance is created and passed to `CollabServer`, then registered separately via `add_class()` to expose its RPC methods. Without `--collab`, a plain `JRPCServer` is used and the `Collab` class is not registered. The existing `LLMService` and `Repo` classes are added via `add_class()` in both cases.

### Streaming

`self.call` in JRPC-oo broadcasts to all connected remotes. This means `streamChunk`, `streamComplete`, `filesChanged`, and all other server-push events automatically reach all admitted clients. No changes needed.

### File Selection Sync

When a localhost client changes the file selection via `set_selected_files`, the server broadcasts a `filesChanged` event to all connected clients. This ensures all browsers show the same checked files in the file picker. Only localhost clients can change the selection, but everyone sees the result immediately.

### File Navigation Sync

When any client navigates to a file (clicking in the file picker, a search result, or an edit block anchor), the browser calls `LLMService.navigate_file(path)`. The server broadcasts a `navigateFile` event to all connected clients. Each client opens the file in its diff viewer or SVG viewer. Events originating from a remote broadcast carry a `_remote` flag so the receiving client does not re-broadcast, preventing loops.

### Doc Index Selection Sync

Doc index file checkboxes (used to include/exclude doc files from context) follow the same pattern as code file selection — they call `set_selected_files`, which already broadcasts `filesChanged` to all connected clients. No additional sync mechanism is needed.

### Mode Sync

When a localhost client switches between code mode and doc mode via `switch_mode`, the server broadcasts a `modeChanged` event to all connected clients. All browsers update their UI to reflect the active mode — tab visibility, mode toggle state, and available controls all stay in sync. Only localhost clients can initiate a mode switch, but the result is visible to everyone immediately.

Non-localhost clients passively follow the server's authoritative mode. When a `modeChanged` event arrives, the remote client's `_refreshMode()` calls `get_mode()` (read-only) to sync its UI and updates its localStorage preference to match the server. This prevents stale localStorage preferences from triggering `switch_mode` calls that would be rejected by `_check_localhost_only()`. The `_canMutate` guard ensures non-localhost clients never attempt to call `switch_mode` — they only read and display.

Cross-reference toggle changes (`set_cross_reference`) also broadcast `modeChanged` events with the `cross_ref_enabled` field, so all clients see the cross-reference checkbox state update immediately.

### Session Sync

When a localhost client starts a new session (`new_session`) or loads a previous session (`load_session_into_context`), the server broadcasts a `sessionChanged` event containing the new session ID and message list. All browsers clear their chat panel and display the new conversation state. This ensures collaborators always see the same conversation context.

### Chat History

On admission, the new client calls `get_current_state()` during its normal `setupDone` flow, which returns the conversation history. They see all messages exchanged so far. If streaming is in progress when they join, they miss already-sent chunks but see the complete message on `streamComplete`.

### Cache Tiering

No changes. The stability tracker and cache tiers are server-side state. All clients see the same token HUD data when they request it.

### Code Review Mode

Review mode controls are restricted to localhost clients. If the host enters review mode, participants see the review UI (banner, diffs, etc.) via the normal broadcast events.

## Existing Broadcast Behavior

Since `self.call` already broadcasts to all JRPC remotes, the following events reach all admitted clients automatically:

| Event | Effect |
|-------|--------|
| `streamChunk` | All clients see LLM response streaming |
| `streamComplete` | All clients see completed response with edit results |
| `userMessage` | All clients see user messages immediately (before streaming begins) |
| `commitResult` | All clients see commit results (SHA, message) |
| `filesChanged` | All clients see file selection changes (broadcast on every `set_selected_files` call and after not-in-context auto-adds) |
| `modeChanged` | All clients see code/doc mode switches and cross-reference toggle changes |
| `sessionChanged` | All clients see new session / loaded session (chat panel resets) |
| `compactionEvent` | All clients see compaction notifications |
| `navigateFile` | All clients open the same file in their viewer |
| `admissionRequest` | All clients see admission toasts |
| `clientJoined` / `clientLeft` | All clients see connection changes |

## Module Structure

New file: `src/ac_dc/collab.py`

Contains:
- `CollabServer(JRPCServer)` — subclass with admission screening in `handle_connection`
- `Collab` — service class registered via `add_class()`, exposes admission and registry RPCs
- Client registry management (shared between `CollabServer` and `Collab`)
- Pending queue management
- Localhost detection utility
- Role/permission checking utility

The split is necessary because `add_class()` exposes *all* public methods of a class. Putting RPCs directly on `CollabServer` would also expose inherited methods like `start`, `stop`, and `handle_connection`. The `Collab` class contains only the methods intended as RPC endpoints. `CollabServer` holds a reference to the `Collab` instance and delegates admission state to it.

## Configuration

No new configuration is required. The server always uses `CollabServer`. In single-user mode (only one connection), the behavior is identical to today — the admission flow is never triggered.

## Activation

Collaboration mode is **disabled by default** for security. It must be explicitly enabled via the `--collab` CLI flag:

```bash
ac-dc --collab
```

When `--collab` is passed:
- `CollabServer` is used instead of plain `JRPCServer`
- The `Collab` RPC class is registered (exposes `Collab.*` endpoints)
- WebSocket server binds to `0.0.0.0` (all interfaces)
- Vite dev/preview servers bind to `0.0.0.0`
- `_collab` is set on service instances for RPC restriction checks

When `--collab` is **not** passed (default):
- Plain `JRPCServer` is used — localhost only, no admission flow
- The `Collab` RPC class is not registered
- All servers bind to `127.0.0.1`
- `_collab` remains `None` on service instances — all callers are treated as localhost
- The collab popover in the browser shows a message explaining how to enable collaboration

## Network Binding

When collaboration is enabled (`--collab`), both the WebSocket RPC server and the Vite dev/preview server bind to `0.0.0.0` (all network interfaces). Without `--collab`, they bind to `127.0.0.1` (localhost only).

- **WebSocket server**: `0.0.0.0:{server_port}` (with `--collab`) — handled by jrpc-oo's `JRPCServer`
- **Vite dev server** (`--dev`): `0.0.0.0:{webapp_port}` (with `--collab`) — via `--host` CLI flag
- **Vite preview server** (`--preview`): `0.0.0.0:{webapp_port}` (with `--collab`) — same as dev
- **Hosted mode** (default): no local HTTP server needed — the webapp is served from GitHub Pages. LAN clients only need WebSocket access to `{server_port}`.

In hosted mode, remote collaborators open the same GitHub Pages URL (shared via the collab popover's share link) and connect back to the host's WebSocket port over the LAN. The share link replaces `localhost` with the host's LAN IP in the URL.

### WebSocket URI Derivation

The webapp builds its WebSocket connection URI dynamically from the page URL via `getServerURI(port)`:

```javascript
function getServerURI(port) {
  const host = window.location.hostname || 'localhost';
  return `ws://${host}:${port}`;
}
```

This means the WebSocket always connects to the same host that served the page. When a remote client accesses the webapp via `http://192.168.1.x:19001/?port=18081`, the WebSocket connects to `ws://192.168.1.x:18081/`. If the page is loaded via `localhost`, the WebSocket also targets `localhost` — which is correct for the host but fails for remote clients. Remote clients **must** access the page using the host machine's LAN IP, not `localhost`.

The `port` parameter is read from the URL query string (`?port=N`), defaulting to `18080` if absent. The collab popover's share link includes the correct port automatically.

## Testing

### Connection Handling
- First connection auto-admitted, gets host role
- Second connection held pending, admission toast broadcast
- Admit resolves pending, client gets JRPC setup
- Deny closes WebSocket cleanly
- Rapid connect/disconnect doesn't leak pending entries

### Role Detection
- `127.0.0.1` detected as localhost
- `::1` detected as localhost
- LAN IP detected as non-localhost
- Local interface IPs detected as localhost

### RPC Restrictions
- Localhost client can call all RPCs
- Non-localhost client can call read-only RPCs
- Non-localhost client gets error on restricted RPCs
- Restriction checked per-call, not cached

### Host Promotion
- Host disconnects → next admitted client promoted
- All clients notified of role change
- Last client disconnects → server resets

### Admission Queue
- Multiple pending connections handled independently
- Admit one, deny another — both resolve correctly
- Pending client disconnects before decision → cleaned up
- Timeout: pending requests not acted on within 120 seconds are auto-denied

### Frontend
- Pending screen shown while waiting
- Admission toast shown for pending requests
- Toast dismissed when request resolved
- Participant UI restrictions applied correctly
- Connected users indicator updates on join/leave

## Limitations

### No Display Names
Phase 1 shows IP addresses only. A future enhancement could prompt for a display name on connect.

### No Kick
Admitted clients cannot be removed in phase 1. The host can restart the server to clear all connections.

### Single LLM Stream
Only one LLM request can be active at a time (existing constraint). Participants cannot queue prompts.

### Mid-Stream Join
A client admitted while streaming is in progress will miss already-sent chunks. They see the complete message when streaming finishes.

### No Follow Mode
Phase 1 has no synchronized navigation. Each client browses independently. This is a planned future enhancement.

## Future Enhancements

### Display Names
Prompt for a name on connect, show in admission toast and connected users list.

### Kick / Ban
Allow host to remove admitted clients. Ban by IP for the session.

### Follow Mode
Synchronized navigation: one user leads, others' viewers follow (file open, scroll position, editor selection).

### Participant Prompt Queue
Allow participants to submit prompt suggestions that the host can approve before sending.

### Connection Indicators
Show typing indicators, cursor positions, or "viewing file X" status for each connected user.