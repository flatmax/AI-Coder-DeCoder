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
- Viewport state (scroll position, cursor, and any view-mode toggles) saved on `beforeunload`, before navigating away from the current file, and whenever a viewer reports a new active file via `active-file-changed`. The last case captures the `type` discriminator (svg vs diff) at the moment the viewer is ready, so a reload immediately after opening a file always has a correct viewer-routing record — without it, the stored viewport would still describe the previous file and restore would short-circuit on path mismatch
- View-mode toggles covered:
  - Markdown files — whether the preview pane was open and the preview's scroll position
  - TeX files — whether the preview pane was open and the preview's scroll position
  - SVG files — the current viewBox (pan/zoom), presentation-mode flag, and which viewer was active (visual SVG vs. Monaco text diff via `toggle-svg-mode`). Persisting the active-viewer choice means a user who switched to text diff for precise editing, then reloaded, returns to the text diff rather than having to re-toggle every session.
- Not persisted: editor find-widget state, focused side of the diff editor. Adding either is an additive `ac-last-viewport` schema change.

### Restore Flow

- On startup, after state-loaded completes, defer file reopen until the startup overlay dismisses (prevents file-fetch RPC calls from blocking the server during heavy init)
- On reconnect (init already complete), reopen immediately
- After the reopen, restore viewport state once the viewer is ready
- Preview toggles restore before scroll — the user's last view (raw editor vs preview) is the one they see, and the preview's own scroll position is restored against the preview pane rather than the editor
- For SVG files: if the stored `type` is `svg`, route through the SVG viewer and apply presentation-mode flag before writing the viewBox — presentation mode changes the right pane's width (no left pane), and the viewBox rectangle is only meaningful against its actual container. If the stored `type` is `diff` for an `.svg` path, the user toggled to text diff; restore via the diff viewer and dispatch `toggle-svg-mode` with target `diff` after navigate so the visibility flip lands on the diff viewer. The visual ↔ text toggle buttons remain available; persistence only affects the initial restore.
- A timeout cancels restoration if the file never opens (e.g., deleted)

## Viewer Background

- Full-viewport background layer hosts the diff viewer and SVG viewer as siblings
- Only one is visible at a time — CSS class toggle with a short opacity transition
- Routing by file extension determines which viewer receives each navigate-file event
- Both viewers keep independent tab state; switching between file types just toggles the layer

## Dialog Container

The dialog is a draggable, resizable foreground panel hosting the tab bar and tab bodies. It sits above the viewer background layer (z-index 10 vs 0–1) so it always renders on top regardless of what the viewer's internal positioning does. Left-docked by default; first drag or first bottom/corner resize undocks it into an explicit rectangle.

### Layout

The dialog has no header bar. The chat panel's tab strip sits directly at the top of the dialog body; messages, input, and a compact LED strip follow.

**Tab strip** (top of chat panel): Main + one per agent. Text labels with horizontal scroll overflow and a ⋯ direct-jump menu when the strip exceeds available width. Always rendered, even with only Main present. Each tab carries a per-tab 📊 Context icon (visible on hover/active/focus) that opens the Context overlay scoped to that conversation. Agent tabs additionally carry a ✕ close icon. The strip is the dialog **drag handle** — pointerdown on its empty background or the gap between buttons begins a drag; pointerdown on any tab button, Context icon, close icon, or overflow button skips drag via the `closest('button')` guard.

**LED strip** (below the textarea, above the compaction-capacity bar): one small dot per tab, centered horizontally. Each dot reflects that tab's stream / outcome state (cyan flashing while streaming, green for clean completion, red for error). Clicking a dot activates the corresponding tab. The strip takes minimal vertical space — no background, no border, just the dots floating below the input. Tooltip on hover gives the tab id, mode, and state-specific diagnostic per [agent-browser.md](agent-browser.md#status-leds).

**Doc Convert**: lives in the file picker's top toolbar (a 📄 button rendered only when the backend reports markitdown is installed). Clicking dispatches `request-dialog-tab` with `{tab: 'doc-convert'}`. Same toolbar pattern as Settings — both buttons replaced earlier dialog-header / FAB iterations and now live in the picker so the dialog has no header at all.

**Minimize button**: ▾ button rendered at the right edge of each dialog tab's toolbar — the chat panel's tab strip (after the overflow ⋯ menu), and each overlay tab's toolbar/nav-bar (Context, Settings, Convert). Right-edge placement is consistent across all four tabs so the affordance lives in the same spatial location regardless of which tab is active.

All four dispatch `request-dialog-minimize` which the shell catches and routes through `_toggleMinimize`. Each tab carries its own minimize button rather than relying on a single top-right FAB (an earlier FAB iteration shadowed the Context tab's refresh button) — overlay tabs are sibling tab-panels inside `dialog-body`, so the chat panel's tab strip is unreachable when an overlay is active.

**Expand FAB**: ▴ button at the dialog's top-right, rendered ONLY when the dialog is minimized. The minimized state hides the dialog body, so all in-tab minimize buttons are unreachable; the expand FAB takes over as the only way to restore the dialog.

**Settings**: lives in the file picker's top toolbar (a ⚙️ button between the sort split-button and the Doc Convert / git split-button row). Clicking dispatches `request-dialog-tab` with `{tab: 'settings'}`.

**Drag detection**: the dialog as a whole listens for pointerdown. Drag is initiated only when the pointer's `composedPath()` walks through an element with `data-drag-handle="true"` AND no button. Today only the tab strip carries that attribute. This means:

- Pointerdown on a tab button, the per-tab 📊 Context icon, the per-tab ✕ close icon, or the overflow button — `closest('button')` matches, no drag.
- Pointerdown on the tab strip's background or the gap between buttons — drag begins.
- Pointerdown anywhere else in the dialog (LEDs, message area, picker, input) — no drag, normal click handling.

**Compaction-capacity bar**: thin 4px strip at the very bottom of the dialog (above the resize handles), rendered when the backend reports compaction is enabled and history-status data has been fetched. The fill width tracks the ratio of current history tokens to the compaction trigger threshold. Colour follows the same tri-state convention as the Context tab budget bar and Token HUD: green ≤75%, amber 75–90%, red >90%. Hidden in minimized mode along with the body and reconnect banner. Tooltip on hover gives exact token counts and percent. Refreshed via `LLMService.get_history_status` after every stream-complete, session-changed, and compaction-event broadcast.

**Doc index progress overlay**: an `ac-doc-index-progress` component rendered inside the dialog body. Owns its own visibility lifecycle keyed on the doc-index stages the shell intercepts from the startup-progress channel and re-dispatches as `doc-index-progress` window events. Distinct from the compaction-progress overlay (an `ac-compaction-progress` component rendered at viewport scope, not inside the dialog), which fires on `compaction-event` and auto-dismisses after success or error. Both overlays exist so background work surfaces without re-showing the startup overlay or stalling chat interaction.

**Cache warmup progress overlay**: an `ac-cache-warmup-progress` component rendered at viewport scope (bottom-center, above the toast layer's z-index but below modals). Listens for the four `cache-warmup-*` window events the shell re-dispatches from server-push callbacks. Renders a 30-second countdown progress bar during the visible phase, flips to a spinner during the firing phase, briefly flashes "Cache refreshed" on success or an error reason on failure, then fades out. Cancelled events close the bar without a flash. See [cache-tiering.md § Cache Warmer](../3-llm/cache-tiering.md#cache-warmer) for the backend lifecycle.

**Read-aloud transport overlay**: an `ac-speech-controls` component rendered at viewport scope. Unlike the progress overlays, it is **draggable** and remembers its position across sessions. It listens for the text-to-speech player's state-change window event and is visible only while a message is being read aloud, offering play/pause, a speed slider, and a per-sentence position bar. It holds no playback state — it is a remote control for the shared synthesis player and reflects its state. See [speech.md § Floating Transport](speech.md#floating-transport-controls-overlay) for the full specification.

Returning to chat from an overlay tab: each overlay tab's body carries a back-arrow (`← Chat`) at top-left. Clicking it dispatches `request-dialog-tab` with `{tab: 'files'}` — legacy storage key, retained for migration safety. The shell's `_switchTab` handles the rest.

**Layout history note**: the journey here started from a draft that kept a dialog header and tried to project the chat tab strip up into it via absolute positioning — that failed due to shadow-DOM stacking-context constraints. A second iteration removed the header but kept a full-width LED row at the top with Context/minimize icons attached. The current layout is a third pass: the LED row collapses into a compact strip at the bottom of the chat panel, Context lives per-tab, and minimize joins Convert as a corner FAB. The tab strip absorbs the drag-handle role.

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

The primary-mode segmented control and cross-reference overlay toggle live in the chat panel's search bar — not the dialog header. Only the Main tab renders these controls; agent tabs hide them entirely. See [chat.md § Mode Toggle](chat.md#mode-toggle) for the full UI specification.

Rationale: mode is per-conversation in spirit (an agent could in principle inherit a different mode from its parent), and visually anchoring the controls to a specific chat tab makes the per-tab scope obvious. Today the backend has one authoritative mode for the whole service; agents inherit it via their parent scope. When the backend gains per-agent mode, the controls' read/write paths thread through `agent_tag` without a UI move.

## Global Keyboard Shortcuts

- Alt+1 returns to Chat (the default body)
- Alt+2 opens Context
- Alt+3 opens Settings
- Alt+4 opens Convert (when available; the keystroke is consumed but no-op when Convert is unavailable)
- Alt+M toggles dialog minimize
- Ctrl+Shift+F activates file search in the chat panel, prefilling from the current selection

Alt+1 always returns to Chat regardless of which overlay is currently shown — same effect as clicking the back arrow. Alt+3 is fixed on Settings regardless of whether Convert is installed, so muscle memory survives stripped-down deployments.
🟨🟨🟨 REPL

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
- **App shell global toast** — rendered in the app shell at the bottom-left of the viewport (z-index above the dialog so toasts remain visible when the dialog is docked left), supports multiple simultaneous toasts with independent fade-out; used by components outside the chat panel.

Components dispatch toast events; the shell catches and renders them. Chat panel's local toast does not dispatch global events.

## Invariants

- Only the shell holds a WebSocket connection; child components use the shared RPC proxy
- First-connect always shows the startup overlay; reconnect never does
- The captured `window.getSelection()` at Ctrl+Shift+F is passed by parameter, never re-read downstream
- File and viewport state is restored after the ready signal on first connect, or immediately on reconnect — never before
- Window resize handlers run at most once per animation frame
- Browser tab title reflects the current repo name with no prefix
- The startup overlay is dismissed exactly once per connection lifecycle (first connect)