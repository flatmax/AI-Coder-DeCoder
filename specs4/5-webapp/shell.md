# Shell

**Status:** stub

The root component of the webapp. Owns the WebSocket connection, routes server-push events to child components, hosts the dialog and viewer background, manages global keyboard shortcuts, and orchestrates startup and reconnection. All child components receive RPC access through a shared singleton rather than holding their own WebSocket.

## Role

- Single WebSocket client for the whole webapp
- Publishes a shared RPC proxy that child components consume via a mixin
- Hosts the draggable dialog (foreground) and the viewer background (full viewport)
- Routes server-push events to child components via window-level custom events
- Manages startup overlay and reconnection UI

## Connection Management

- Extract WebSocket port from URL query parameter
- Build WebSocket URI from the current page hostname (ensures remote collaborators connect to the LAN IP they loaded the page from, not loopback)
- Connect on mount; reconnect with exponential backoff on disconnect (1s, 2s, 4s, 8s, capped at 15s)
- First-connect shows the startup overlay; subsequent reconnects show only a transient "Reconnected" toast

## Shared RPC Publishing

- On setup-done, publish the call proxy to a shared singleton
- Child components using the RPC mixin subscribe and receive ready notifications
- Some components defer their first RPC call to the next microtask so sibling components finish receiving the proxy before requests fire

## Server Callbacks

Methods the server calls on the client (registered at connection time):

- Streaming — chunk, complete, compaction/progress event
- State sync — files changed, mode changed, session changed, user message, commit result
- Startup — progress (with special filtering; see below)
- Navigation — navigate file (carries a flag to prevent echo re-broadcast)
- Collaboration — admission request, admission result, client joined, client left, role changed
- Doc convert — progress

All dispatch to window-level custom events that the relevant child components listen for.

## Startup Overlay

- Full-screen overlay driven by startup-progress events
- Shows the AC⚡DC brand, a status message, and a progress bar
- Message and percent update per stage (symbol index init, session restore, indexing, stability tiers, ready)
- Fades out shortly after the ready signal

### Doc Index Stage Filtering

- Progress stage indicating doc-index work is intercepted and routed to the dialog header progress bar instead of the startup overlay
- Only in-progress updates (percent below 100) are forwarded; completion arrives via the enrichment-complete event
- Prevents the background doc index build from re-showing or stalling the startup overlay

### First Connect vs Reconnect

- First connect — show startup overlay, drive it from progress events
- Reconnect — skip overlay, show success toast, re-fetch state, re-subscribe to events

## State Restoration Cascade

- On setup-done, fetch a full current-state snapshot via a single RPC call
- Dispatch a state-loaded event with the full state as detail
- Browser tab title updated from the repo name in state (no prefix, no branding)
- Files tab restores messages, selected files, streaming status, mode state
- File picker sync deferred so the picker has loaded its tree before selection is applied
- Chat panel detects bulk message load and triggers scroll-to-bottom

## File and Viewport Persistence

- Last-opened file path and viewport state persisted to localStorage
- Keys are repo-scoped so opening a different repo never restores the wrong file
- Legacy bare keys migrated to scoped keys on first recognition of the repo name
- File path saved on every navigate-file event
- Viewport state (scroll position, cursor) saved on `beforeunload` and before navigating away from the current file

### Restore Flow

- On startup, after state-loaded completes, defer file reopen until the startup overlay dismisses (prevents file-fetch RPC calls from blocking the server during heavy init)
- On reconnect (init already complete), reopen immediately
- After the reopen, restore viewport state once the viewer is ready
- A timeout cancels restoration if the file never opens (e.g., deleted)

## Viewer Background

- Full-viewport background layer hosts the diff viewer and SVG viewer as siblings
- Only one is visible at a time — CSS class toggle with a short opacity transition
- Routing by file extension determines which viewer receives each navigate-file event
- Both viewers keep independent tab state; switching between file types just toggles the layer

## Dialog Container

- Left-docked by default, resizable and draggable, collapsible to header-only
- Holds tabs — chat, context, settings, optionally doc convert
- Position, size, minimize state, and active tab persisted to localStorage
- Size and position change proportionally on window resize

## Mode Toggle

A segmented control plus overlay toggle lives inline in the dialog header, between the tab buttons and the minimize button. Three controls total — two for the primary mode, one for cross-reference.

### Primary Mode (Segmented)

- Two mutually-exclusive buttons — `💻 Code` and `📄 Doc`
- Active button shows accent-coloured background and pressed-state border
- Clicking the inactive button calls the mode-switch RPC
- No-op when already in the target mode (the backend would no-op too, but the frontend short-circuits to save a round-trip)
- Disabled when RPC isn't connected or when the current client is non-localhost

### Cross-Reference (Overlay Toggle)

- Single toggle button — `🔀 Cross-ref` or `🔀 Cross-ref ON` when active
- Active state uses a distinct accent colour (amber) to separate it visually from the primary-mode accent (blue)
- Clicking calls the set-cross-reference RPC with the inverted current state
- Disabled under the same conditions as the primary mode buttons

### State Synchronization

- Initial state hydrated from the backend's `get_current_state` snapshot on connection
- Updated via `mode-changed` window events broadcast by the backend
- When a `mode-changed` event reports a primary mode different from the current UI state, the cross-reference flag is reset to false locally — mirrors the backend's reset-on-switch behaviour per [modes.md](../3-llm/modes.md)
- RPC call failures surface as toasts; restricted errors (non-localhost caller) use warning type rather than error

### Feedback

- Successful primary-mode switch shows an info toast — "Switched to document mode" / "Switched to code mode"
- Successful cross-reference enable shows "Cross-reference enabled — both indexes active"
- Successful cross-reference disable shows "Cross-reference disabled"
- The actual state flip happens via the `mode-changed` broadcast, not optimistically on RPC success — prevents the UI from racing the broadcast when multiple clients are connected

### Non-Localhost Clients

- Buttons are rendered but disabled for non-localhost participants
- The disabled-state tooltip still shows the mode's description so participants can see what the current authoritative mode is even if they can't change it
- `mode-changed` broadcasts still update the UI state — participants passively follow the server

## Global Keyboard Shortcuts

- Alt+1..4 switch tabs (4 when doc convert is available)
- Alt+M toggles dialog minimize
- Ctrl+Shift+F activates file search in the chat panel, prefilling from the current selection

### Ctrl+Shift+F Selection Capture

- The selection must be read synchronously as the very first operation in the keydown handler, before any asynchronous work
- Focus changes during tab switching would clear the selection if read later
- The captured string is passed as an explicit parameter down to the search activator — never re-read from `window.getSelection()` inside a later callback
- Multi-line selections are discarded (file search is single-line by design)
- Captured string is trimmed before use

## Window Resize Handling

- Window resize triggers two actions — proportional dialog rescaling and viewer relayout
- Both throttled to one call per animation frame
- Without throttling, rapid resize events cause feedback loops (layout shift → resize event → layout call → forced reflow → visible jank)
- Throttle handle cancelled on component unmount to prevent stale callbacks
- Viewer relayout is also scheduled on every dialog-resize pointermove frame — the viewer sits behind the dialog, so a dialog getting wider shrinks the visible viewer area. Monaco caches scrollbar / minimap dimensions; the SVG viewer's editors run with `preserveAspectRatio="none"` and rely on explicit `fitContent()` calls. Without this hook, both viewers leave stale layout until the user clicks into them.
- Window-resize and dialog-resize relayouts use separate RAF handles so they don't cancel each other's pending frames.

## Toast System

Two independent toast layers:

- **Chat panel local toast** — rendered inside the chat panel, positioned near the input; used for chat-specific feedback (copy, commit, stream errors, URL fetch notifications)
- **App shell global toast** — rendered in the app shell, supports multiple simultaneous toasts with independent fade-out; used by components outside the chat panel

Components dispatch toast events; the shell catches and renders them. Chat panel's local toast does not dispatch global events.

## Invariants

- Only the shell holds a WebSocket connection; child components use the shared RPC proxy
- First-connect always shows the startup overlay; reconnect never does
- The captured `window.getSelection()` at Ctrl+Shift+F is passed by parameter, never re-read downstream
- File and viewport state is restored after the ready signal on first connect, or immediately on reconnect — never before
- Window resize handlers run at most once per animation frame
- Browser tab title reflects the current repo name with no prefix
- The startup overlay is dismissed exactly once per connection lifecycle (first connect)