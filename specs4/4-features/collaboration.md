# Collaboration

Collaboration mode allows multiple browsers to connect to a single backend. The first connection is auto-admitted as the host; subsequent connections require explicit admission from any already-admitted user via a toast prompt. Once admitted, non-localhost participants see the full UI and receive all broadcast events but cannot send prompts, mutate LLM state, or perform git operations. Disabled by default — enabled via an explicit CLI flag.
## Activation
- Disabled by default for security
- Enabled via a CLI flag
- When enabled — admission-aware server is used, collaboration service is registered as an RPC class, WebSocket and webapp servers bind to all interfaces
- When disabled — plain server, no admission flow, services bind to localhost only
## Connection Lifecycle
### First Connection (Auto-Admit)
- First WebSocket connection is auto-admitted with no screening
- This is the host — normally the user who started the process and opened their localhost browser
- No admission toast shown
### Subsequent Connections (Admission Required)
- All connections after the first are held in a pending state before JRPC setup completes
- Server overrides the JRPC handle-connection method to insert screening
- New WebSocket connects; server detects this is not the first connection
- Server sends a raw WebSocket admission-pending message with a generated client ID
- Server does not complete JRPC setup yet — no methods are exposed
- Server broadcasts an admission-request event to all admitted clients
- An admitted user clicks Admit or Deny in their UI
- On admit — JRPC setup completes, client becomes a full participant
- On deny — WebSocket closed with an error code, no JRPC state was created
### Disconnection
- Server removes the client from the registry
- If the host disconnects, the next admitted client (by admission order) becomes the host
- If the last client disconnects, the server resets — next connection will be auto-admitted
## Server Architecture
### Admission-Aware Server
- Subclass of the base RPC server
- Overrides handle-connection to insert admission screening and caller tracking
- Runs its own message receive loop after admission (mirroring the base server's loop) to set a current-caller identifier before each dispatch
### Client Registry
Per-client record:
- Client ID (UUID assigned on connection)
- IP address (peer IP from WebSocket)
- Role — host or participant
- Is-localhost flag
- Admission timestamp
- WebSocket reference
### Pending Queue
Per-pending-request record:
- Client ID
- IP
- Raw WebSocket (pre-JRPC)
- Future resolved by admit/deny
- Request timestamp
- Pending requests not acted on within a timeout (default 120 seconds) are auto-denied and the WebSocket is closed
- If a new connection arrives from the same IP while a previous request is still pending (e.g. browser refresh), the old pending request is auto-denied and its toast is removed before the new request is created
- Cancelled-by-replacement requests include a flag so frontends can distinguish from explicit deny
- Server monitors the pending client's WebSocket for closure — if the pending client disconnects before a decision, the request is cleaned up and an admission-result broadcast removes the toast from all admitted clients
### Localhost Detection
Connection is localhost if the peer IP matches:
- Loopback addresses (IPv4 and IPv6)
- Any IP address assigned to a local network interface
Handles the case where the host opens their browser to their LAN IP instead of loopback.
### Host Promotion
When the current host disconnects:
1. Next admitted client (by admission time) is promoted to host
2. Promoted client receives a role-changed event
3. All clients receive an updated client list
4. If the promoted client is non-localhost, they gain host role but still cannot send prompts — only localhost hosts can send prompts
### Role vs Localhost
Role and localhost are independent concepts:
| | Localhost | Non-localhost |
|---|---|---|
| Host | Full control | Can admit/deny, cannot mutate |
| Participant | Full control | Read-only: browse, search, view |
- The meaningful restriction is localhost vs non-localhost, not host vs participant
- Host role primarily determines who can admit/deny new connections when no localhost client is connected
## RPC Restrictions
### Localhost-Only Operations
Restricted to localhost connections (non-localhost participants get an error):
| Category | Operations |
|---|---|
| LLM interaction | Chat streaming, commit message generation, cancel streaming |
| Session management | New session, load session, new history session |
| LLM state | Set selected files, switch mode, set cross-reference |
| Review mode | Start review, end review |
| Git operations | Commit, stage/unstage/discard files, rename/delete/create/write files, reset hard, stage all |
| Settings | Save config, reload LLM config, reload app config |
| Doc convert | Convert files |
### Read-Only Operations (Available to All)
- File content, file tree, search, current state
- Flat file list, symbol map, context breakdown
- Session list, session messages
- Collaboration queries — admit/deny, connected clients
### Enforcement Mechanism
- Service classes check caller identity via a shared collaboration reference
- A per-message context identifier is set before each dispatch (inside the receive loop)
- Service methods read the identifier and look up the client's localhost flag
- When no collaboration instance is attached (single-user mode), callers are always treated as localhost
### Restriction Response Shape
- Restricted methods return a specific error shape rather than raising
- Fields — error type (restricted), reason (human-readable)
- Frontend components track a mutation-allowed flag and hide or disable UI affordances for restricted actions
## Collaboration Service Methods
- Admit client — admits a pending client (callable by any admitted user)
- Deny client — denies a pending client, closes their WebSocket
- Get connected clients — returns list of currently connected clients with ID, IP, role, localhost flag
- Get own role — called by a client after JRPC setup to learn its own role
- Get share info — returns routable LAN IPs and WebSocket port for constructing share URLs
## Server → Client Events
- Admission request — broadcast to all admitted clients when a new connection is pending
- Admission result — broadcast when a pending request is resolved (admitted/denied/replaced)
- Client joined — broadcast when a client completes admission and JRPC setup
- Client left — broadcast when a client disconnects
- Role changed — sent to a specific client when their role changes
- Navigate file — broadcast when any client navigates to a file (all clients open the same file)
- Mode changed — broadcast when a localhost client switches mode or toggles cross-reference
- Session changed — broadcast when a localhost client starts a new session or loads one
## Raw WebSocket Messages (Pre-JRPC)
Sent on the raw WebSocket before JRPC setup, for pending clients:
- Admission pending — sent immediately when a non-first connection is held
- Admission granted — sent when pending client is admitted; normal JRPC setup follows
- Admission denied — sent just before the WebSocket is closed
## Frontend Admission Flow
### Pending State
- Webapp intercepts raw WebSocket messages before JRPC processes them
- Root component overrides the WebSocket created hook to add a capturing message listener on the raw WebSocket
- All three admission message types are consumed before reaching JRPC
- On admission-pending — show a centered waiting screen with a cancel button
- On admission-granted — proceed with normal JRPC setup
- On admission-denied — show brief "Access denied" message and disconnect
### Admission Toast
- Persistent (non-auto-dismissing) toast shown when admission-request event arrives
- Shows connecting IP, admit button, deny button
- Multiple pending requests show multiple toasts, stacked
- New request from an IP matching a pending toast replaces the old toast (handles browser refresh)
- Admitted/denied toast is removed when admission-result arrives (self-action or someone else acted)
### Connected Users Indicator
- Small indicator in the dialog header shows count of connected clients
- Visible always (shows count even with one client)
- Clicking opens a collab popover
### Collab Popover
When collaboration is enabled:
- List of connected clients — role badge (host/participant, color-coded), IP, local label for localhost clients
- Share link section — copyable URL from server's LAN IP and WebSocket port
- Copy button with brief success indicator
- Share hint — instructional text for collaborators
When collaboration is disabled:
- Message explaining that collaboration mode is not enabled
- Instructions showing the CLI flag to enable it
## Participant UI Restrictions
When the calling client is non-localhost, the frontend applies restrictions:
- Chat input area replaced with a static "Viewing as participant" bar
- File picker context menu — git-mutating items hidden (rename, delete, new file)
- File picker checkboxes hidden (cannot change LLM context)
- Commit button hidden
- Settings tab editing disabled
- Mode toggle disabled
- New session / load session disabled
- Review mode controls hidden
Everything else works — browsing files, viewing diffs, searching, reading chat history, using tabs.
## Network Binding

When collaboration is enabled, the WebSocket server and webapp server bind to all interfaces. When disabled, both bind to loopback only.

- WebSocket server — binds all interfaces with collaboration flag, loopback otherwise
- Webapp server (default bundled static server) — same binding rules
- Vite dev server and preview server — same binding rules, via a host flag

Remote collaborators open the share link (which uses the host's LAN IP) to load the webapp and connect back to the host's WebSocket port over the LAN.

### WebSocket URI Derivation

- Webapp builds its WebSocket connection URI dynamically from the page URL
- URI uses the same hostname that served the page, with the WebSocket port
- When a remote client accesses the webapp via a LAN IP, the WebSocket connects to the same LAN IP
- When the page is loaded via loopback, the WebSocket also targets loopback (correct for the host but fails for remote clients)
- Remote clients must access the page using the host machine's LAN IP, not loopback
- The share link in the collab popover includes the correct port automatically

## Integration with Existing Systems

### Communication Layer

- Collaboration-aware server replaces the base RPC server when the flag is passed
- Collaboration instance is created and registered as a separate RPC class to expose admission methods
- Without the flag — plain server used, collaboration class is not registered
- Service classes receive references to the collaboration instance for localhost checks in both modes (the reference is null in single-user mode)

### Streaming

- The broadcast mechanism reaches all connected remotes automatically
- Streaming chunks, completions, files-changed events, and all server-push events reach all admitted clients
- No changes needed to the streaming pipeline

### File Selection Sync

- When a localhost client changes file selection, the server broadcasts a files-changed event to all clients
- All browsers show the same checked files in the file picker
- Only localhost clients can change the selection; everyone sees the result immediately

### File Navigation Sync

- When any client navigates to a file, the server broadcasts a navigate-file event
- Each client opens the file in its diff viewer or SVG viewer
- Events originating from a remote broadcast carry a flag so the receiving client does not re-broadcast, preventing loops

### Mode Sync

- When a localhost client switches mode or toggles cross-reference, the server broadcasts a mode-changed event
- All browsers update their UI — tab visibility, mode toggle state, available controls
- Non-localhost clients passively follow the server's authoritative mode — they never attempt to initiate a switch
- See [modes.md](../3-llm/modes.md) for the full mode sync protocol

### Session Sync

- When a localhost client starts a new session or loads a previous one, the server broadcasts a session-changed event with the full message list
- All browsers clear their chat panel and display the new conversation state
- Collaborators always see the same conversation context

### Chat History

- On admission, the new client fetches current state as part of its normal setup
- They see all messages exchanged so far
- If streaming is in progress when they join, they miss already-sent chunks but adopt the stream as passive and see the complete message on completion

### Cache Tiering

- No changes — stability tracker and cache tiers are server-side state
- All clients see the same token HUD data when they request it

### Code Review Mode

- Review mode controls are restricted to localhost clients
- If the host enters review mode, participants see the review UI (banner, diffs) via the normal broadcast events

## Module Structure

- A dedicated collaboration module contains the admission-aware server subclass and the collaboration service class
- The split between server subclass and service class is necessary because exposing the server's inherited methods (start, stop, handle-connection) via RPC would be wrong
- The service class contains only the methods intended as RPC endpoints
- Server subclass holds a reference to the service instance and delegates admission state to it

## Limitations

### No Display Names

- Initial implementation shows IP addresses only
- A future enhancement could prompt for a display name on connect

### No Kick

- Admitted clients cannot be removed in the initial implementation
- The host can restart the server to clear all connections

### Single LLM Stream

- Only one LLM request can be active at a time (existing constraint)
- Participants cannot queue prompts

### Mid-Stream Join

- A client admitted while streaming is in progress will miss already-sent chunks
- Passive stream adoption ensures they see the complete message on completion

### No Follow Mode

- No synchronized navigation in the initial implementation
- Each client browses independently
- A planned future enhancement

## Future Enhancements

- Display names — prompt for a name on connect, show in admission toast and connected users list
- Kick / ban — allow host to remove admitted clients; ban by IP for the session
- Follow mode — synchronized navigation where one user leads and others' viewers follow
- Participant prompt queue — participants submit prompt suggestions that the host approves before sending
- Connection indicators — typing indicators, cursor positions, viewing-file status per connected user

## Invariants

- The first connection is always auto-admitted as host; subsequent connections are always screened
- Non-localhost participants cannot call any mutating RPC method — restricted calls always return an error without side effects
- Admission-pending clients have no JRPC state and no exposed methods
- Host disconnection always results in promotion of another admitted client, or a reset if no clients remain
- Same-IP pending requests never accumulate — new requests always replace older ones from the same IP
- Collaboration-aware server behaves identically to the base server in single-user mode (no flag)
- Single active LLM stream policy applies across all connected clients, not per-client