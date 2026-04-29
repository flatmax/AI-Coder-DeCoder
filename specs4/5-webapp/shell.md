# Shell

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

The dialog is a draggable, resizable foreground panel hosting the tab bar and tab bodies. It sits above the viewer background layer (z-index 10 vs 0–1) so it always renders on top regardless of what the viewer's internal positioning does. Left-docked by default; first drag or first bottom/corner resize undocks it into an explicit rectangle.

### Layout Modes

Two mutually-exclusive modes:

- **Docked** — top, left, bottom anchored to the viewport edges; width is a percentage (with an optional stored override in pixels). This is the default on first run and stays in effect until the user drags the header or bottom/corner-resizes.
- **Undocked** (floating) — all four edges set from a stored pixel rectangle. The CSS `bottom: 0` anchor is disabled; shadow gives visual separation from the viewer background. Produced by dragging the header past the drag threshold, or by resizing from the bottom / corner handle.

Minimize applies to both modes — collapses the dialog to the header row only, hiding the body, the reconnect banner (if visible), and the compaction capacity bar. Resize handles on the bottom and corner are also hidden when minimized since they'd be meaningless (no body to resize). Minimized state is preserved across reload in both modes.

### Resize Handles

Three handles — invisible hit zones at the edges that grow a subtle accent line on hover:

| Handle | Location | Axis | Behaviour |
|---|---|---|---|
| Right | Right edge, 8px hit zone extending 4px past the border | Horizontal | Adjusts width only. In docked mode, writes the new width to `ac-dc-dialog-width` and stays docked. In undocked mode, writes to the full undocked rectangle. |
| Bottom | Bottom edge, 8px hit zone | Vertical | Adjusts height only. **Always undocks** — the docked mode's height comes from `bottom: 0`, so expressing a smaller height requires an explicit rectangle. |
| Corner | Bottom-right, 14×14px hit zone | Both | Adjusts width and height simultaneously. Always undocks for the same reason. |

The right handle's behaviour is asymmetric: while docked, only `ac-dc-dialog-width` is persisted, leaving the undocked rectangle alone. This lets a user widen the docked dialog without committing to floating mode.

Mid-drag the `.dialog.resizing` class is active, suppressing the width transition so the pane tracks the pointer 1:1. The class is removed on pointerup.

### Minimum Dimensions

- Width: **300px**
- Height: **200px**

Below 300 wide the tab buttons wrap to a second row; below 200 tall the body collapses to an unusable slit. The resize handlers clamp against these floors at the JS level — CSS `min-width` / `min-height` aren't applied because flexbox interactions with the docked-mode percentage width cause occasional drift.

### Dragging

The dialog header is the drag handle — `cursor: grab` on the background, `cursor: grabbing` during an active drag. Buttons inside the header (tab buttons, mode toggle, minimize) override the cursor and don't initiate drags; the header's pointerdown handler skips when `event.target.closest('button')` matches.

**Drag threshold: 5px.** Below this, a header pointerdown + pointerup pair is treated as a click (no-op today, since minimize has its own button). Above the threshold, the `.dialog.dragging` class activates, the dialog undocks if still docked, and subsequent pointermove events track the pointer by applying the stored delta to the drag-start rectangle.

The threshold prevents accidental undocks from imprecise clicks — users clicking the header edge without meaning to drag shouldn't see the dialog jump into floating mode.

### Off-Screen Recovery

Both during drag and at restore time, the dialog is constrained so that **at least 100px remains visible on both the X and Y axes**. Specifically:

- During drag: the new left is clamped to `[100 - width, viewportWidth - 100]`, the new top to `[0, viewportHeight - 100]`. The left can go negative (part of the dialog hanging off the left edge) as long as 100px sticks out into the viewport; the top cannot go negative because the header must remain reachable as the drag handle.
- At restore: a stored position where fewer than 100px would be visible — typically after a monitor disconnect or resolution change that stranded the dialog off-screen — is discarded and the dialog reverts to docked mode. Valid-but-too-big rectangles are clamped to viewport dimensions rather than rejected.

The margin is a "findable handle" guarantee: however the user maimed their window, the dialog always has a visible edge they can grab to drag it back into view.

### Proportional Rescaling

On window resize, the dialog keeps the same approximate fraction of the viewport the user last chose — the user's intent was "half the window" or "this rectangle of screen real estate", not "exactly 600 pixels". Holding pixel values static across browser resizes makes the dialog drift away from its intended size.

Three cases:

- **Docked, default width** — The stylesheet's percentage rule (`width: 50%`) tracks the viewport automatically. No JS action needed. This is the state on first run, before the user ever drags the right edge.
- **Docked, user-resized width** — Once the user drags the right edge, an inline pixel width overrides the percentage rule. Rescale it by `newViewport / baselineViewport` on every resize so the fraction stays constant. Without this, a user who set half-width on a 1200px-wide window would see the dialog become a quarter of the viewport when the browser grows to 2400px.
- **Undocked** — Scale `width`, `height`, `left`, and `top` independently by the corresponding viewport-axis ratio. Left and top scale so a right-anchored or centred dialog stays pinned; width and height scale so the dialog keeps its fraction of the viewport on each axis.

In every case the result is clamped to the dialog's minimum width / height and to the visible-margin safety rule (at least 100px of the dialog must remain inside the viewport on both axes).

**Baseline viewport.** The scaling ratio needs a remembered "viewport at last commit" baseline for each state. Without one, every resize event would scale from the original stored pixel-literal and the dialog's fraction of the viewport would slowly drift.

The baseline is updated at three points:

- **User commit** — pointerup after a right-edge resize (docked width), drag (undocked position), or bottom/corner resize (undocked rectangle).
- **After each resize-driven rescale** — the just-captured viewport becomes the new baseline, so subsequent resize events chain correctly.
- **First render** — initialised to the current viewport, so the very first resize after a fresh load scales from "now" rather than from whatever viewport was active when the stored geometry was originally written.

**Throttling.** Resize handling is throttled to one call per animation frame. Rapid resize events (drag the window corner, laptop lid reopen) can fire dozens of times per frame; without throttling the reflow math produces visible jank. The viewer relayout uses a separate RAF handle from the dialog rescale so a window resize during a dialog-resize drag doesn't cancel the drag's pending viewer relayout.

### Persistence

Four localStorage keys, all repo-scoped implicitly via the URL-derived WebSocket port (the dialog state is frontend-only, but the user's chrome preferences are stable across repo switches):

| Key | Type | Purpose |
|---|---|---|
| `ac-dc-active-tab` | string | Last-selected tab — one of `files`, `context`, `settings`, `doc-convert`. Unknown values fall back to `files`. A stored `search` value (from a pre-integrated-search-tab build) also falls back to `files`. |
| `ac-dc-minimized` | string `"true"` / `"false"` | Minimize state. |
| `ac-dc-dialog-width` | string (integer px) | Docked-mode width override. Absent until the user resizes the right edge while docked. Ignored while undocked. |
| `ac-dc-dialog-pos` | JSON `{left, top, width, height}` | Full undocked rectangle. Absent until the user drags the header past the drag threshold or resizes from the bottom / corner. |

Keys are read synchronously in the constructor (not in `connectedCallback`) so first paint doesn't flash the defaults before jumping to the stored values.

Width and position are independent — resizing the right edge while docked writes only `ac-dc-dialog-width`, leaving any stored undocked rectangle alone. This is deliberate: a user who occasionally floats the dialog shouldn't lose their preferred floating geometry just because they widened the docked view in between.

Malformed values (non-JSON, wrong shape, width below minimum, finite-number check fails) are treated as absent. Invalid keys don't propagate into the UI state.

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