# App Shell and Dialog

## Overview

The webapp is a single-page application built with **Lit** (LitElement web components). The main UI surface is a floating dialog that hosts all tabs — draggable, resizable, and collapsible. The diff viewer fills the background.

## Application Structure

```
AppShell (root, extends JRPCClient)
    ├── Viewer Background (fills viewport)
    │   ├── DiffViewer (text files)
    │   │   ├── Tab bar (open files)
    │   │   └── Monaco diff editor
    │   └── SvgViewer (.svg files)
    │       ├── Tab bar (open SVG files)
    │       └── Side-by-side SVG panels with synchronized pan/zoom
    ├── TokenHUD (floating overlay, fixed positioning)
    └── Dialog (foreground, left-docked)
        ├── Header Bar (tabs, actions, minimize)
        ├── Content Area
        │   ├── Files & Chat tab (default)
        │   ├── Search tab
        │   ├── Context Budget tab
        │   ├── Cache Tiers tab
        │   └── Settings tab
        └── History Bar (token usage indicator)
```

## App Shell

The root component extends `JRPCClient`, managing the WebSocket connection and routing events between dialog and diff viewer.

### Responsibilities

- Set browser tab title to the repo name (e.g., `my-project`). The repo name comes from the `repo_name` field of `get_current_state()`. Updated on initial state load. No prefix or branding in the title — just the bare repo name.
- Extract WebSocket port from `?port=N`
- Publish `SharedRpc` on connection
- Route `navigate-file` events to diff viewer
- Route `file-save` events to Repo or Settings RPC
- Trigger token HUD on `streamComplete`
- Handle reconnection with exponential backoff

### Server Callbacks

Methods the server calls on the client (registered via `addClass`):

| Method | Action |
|--------|--------|
| `streamChunk(requestId, content)` | Dispatch `stream-chunk` window event |
| `streamComplete(requestId, result)` | Dispatch `stream-complete` window event |
| `compactionEvent(requestId, event)` | Dispatch `compaction-event` window event |
| `filesChanged(selectedFiles)` | Dispatch `files-changed` window event |

### Startup Sequence

**Server:** Validate git repo (if not a repo: open HTML instruction page in browser, print terminal banner, exit). Initialize services. Register classes with JRPCServer. Start WebSocket server. Open browser.

**App Shell:** On `setupDone`: publish call proxy → fetch `LLMService.get_current_state()` → dispatch `state-loaded` event (window-level CustomEvent with full state object as detail). The state already contains messages from the server's auto-restored last session, so the browser renders the previous conversation immediately.

**Files Tab:** On RPC ready: load snippets, load file tree, load review state. On `state-loaded`: restore messages, selected files, streaming status, sync file picker, scroll chat to bottom.

**RPC Deferral:** Some components defer their first RPC call to the next microtask (`Promise.resolve().then(...)`) in `onRpcReady()`. This ensures the `SharedRpc` call proxy has fully propagated to all listeners before any component issues requests. Without this, a component's `onRpcReady` might fire before sibling components have received the proxy, causing race conditions when calls trigger events that siblings need to handle.

**Dialog:** On RPC ready: sync history bar via `LLMService.get_history_status()`. Restore last-used tab from localStorage.

### State Restoration Cascade

The `state-loaded` event triggers a specific cascade with ordering constraints:

1. **App shell** dispatches `state-loaded` on `window` with the full state object (`messages`, `selected_files`, `streaming_active`, `session_id`, `repo_name`). The `repo_name` field is used to set the browser tab title.
2. **Files tab** listens on `window`, sets `_messages`, `_selectedFiles`, `_streamingActive` from the state
3. **File picker sync is deferred** via `requestAnimationFrame` — the picker may not have its tree loaded yet (its own `onRpcReady` fires independently via microtask deferral)
4. **Chat panel** detects bulk message load (empty→non-empty transition in `updated()`) and triggers scroll-to-bottom with double-rAF

**Ordering dependency:** The file picker loads its tree via its own `onRpcReady` (deferred to next microtask), while the files tab restores selection from `state-loaded`. These can race. The `requestAnimationFrame` deferral of picker sync ensures the tree is loaded before selection is applied.

**The files tab does NOT call `loadTree()` on `state-loaded`** — the picker's own `onRpcReady` handles tree loading independently. This separation prevents duplicate tree fetches.

## Dialog

### Layout

Default: fixed left-docked, 50% viewport width (min 400px), full height. Right half available for diff viewer.

### Tabs

| Tab | Icon | Shortcut |
|-----|------|----------|
| FILES | 📁 | Alt+1 |
| SEARCH | 🔍 | Alt+2 |
| CONTEXT | 📊 | Alt+3 |
| CACHE | 🗄️ | Alt+4 |
| SETTINGS | ⚙️ | Alt+5 |

### Lazy Loading and DOM Preservation

Non-default tabs are loaded on first visit via dynamic `import()`. A `lazyImports` map associates tab IDs with import functions. A `_visitedTabs` set tracks which tabs have been rendered — Lit templates conditionally include tab panels only for visited tabs, so unvisited tabs have no DOM presence at all.

Once visited, tab panels remain in DOM (hidden via CSS, not destroyed). Switching tabs toggles the `.active` class. Each tab component may implement an `onTabVisible()` callback — the dialog calls this when switching to a tab, allowing the component to refresh stale data (e.g., context/cache tabs that missed `stream-complete` events while hidden).

### Tab Active Detection

Tab components determine their visibility by checking their parent `.tab-panel` element's class list for `active`. This is used by context and cache tabs to decide whether to refresh on `stream-complete` / `files-changed` events or mark themselves as stale:

```pseudo
_isTabActive():
    panel = this.parentElement
    if panel has class 'tab-panel':
        return panel has class 'active'
    return this.offsetParent !== null  // fallback
```

When a stale tab becomes visible (via `onTabVisible()`), it clears the stale flag and refreshes automatically. A `● stale` badge is shown in the toolbar while the tab is stale.

### Global Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Alt+1..5 | Switch to tab |
| Alt+M | Toggle minimize |
| Ctrl+Shift+F | Open Search tab with current selection or clipboard |

Ctrl+Shift+F captures `window.getSelection()` synchronously before focus change clears it.

### Dragging & Resizing

- Header drag with 5px threshold (under = click → toggle minimize)
- Right edge resizable via dedicated handle element (4px wide, absolute positioned at right: -4px)
- Undocking: on first drag beyond threshold, dialog switches from docked layout (top/left/height: 100%) to explicit fixed positioning with pixel coordinates
- Min width: 300px (enforced during resize)
- Once undocked, position is persisted to localStorage as JSON (`ac-dc-dialog-pos`: left, top, width, height)

### Dialog Container Access

The dialog component accesses its container (the `.dialog-container` div in the app shell's shadow DOM) via `this.parentElement`. This works because `<ac-dialog>` is a direct child element within the app shell's shadow root — `this.parentElement` returns the containing div, not a shadow root boundary. Resize and undocking operations modify the container's inline styles directly (width, height, left, top, position).

### Tab Restoration

On RPC ready (not on construction), the dialog restores the last-used tab from localStorage (`ac-dc-active-tab`). This is deferred to `onRpcReady()` rather than `connectedCallback()` so that lazy-loaded tab components can fetch data immediately when activated. The default tab is `files` if no saved preference exists.

### Position Persistence

| State | Persisted | Storage Key |
|-------|-----------|-------------|
| Dialog width | Yes | `ac-dc-dialog-width` |
| Undocked position | Yes | `ac-dc-dialog-pos` (JSON: left, top, width, height) |
| Minimized state | Yes | `ac-dc-minimized` |
| Active tab | Yes | `ac-dc-active-tab` |

On startup, the dialog restores its last position and size. Undocked positions are bounds-checked against the current viewport (at least 100px must remain visible). If the dialog was never undocked, it starts in the default left-docked layout at 50% viewport width.

### Header Sections

| Section | Content |
|---------|---------|
| Left | Active tab label; click toggles minimize |
| Center | Tab icon buttons |
| Right | Review toggle (👁️), minimize button |

The review toggle button (👁️) appears in the header actions area on all tabs. When review mode is inactive, clicking it switches to the Files tab and opens the review selector. When review mode is active, the button is visually highlighted (`review-active` class) and clicking it calls `_exitReview()` on the files tab. This provides quick access to review without navigating to the Files tab first.

The dialog tracks review state via `_reviewActive` property, synced from:
- `onRpcReady`: fetches `LLMService.get_review_state()`
- `review-started` window event → sets `true`
- `review-ended` window event → sets `false`

**Note:** Git action buttons (clipboard, commit, reset) and session buttons (new session, history browser) are in the chat panel's action bar, not the dialog header. See [Chat Interface — Action Bar](chat_interface.md#action-bar).

### Minimizing

Toggle via header click or Alt+M. Minimized: 48px header only.

### History Bar

3px bar at bottom showing history token usage percentage:
- Green ≤ 75%, Orange 75–90%, Red > 90%
- Data from `LLMService.get_history_status()`, refreshed on: RPC ready, stream-complete, compaction, state-loaded

Event listeners for history bar refresh are registered once (guarded by `_dialogEventsRegistered` flag) to prevent duplicate listeners on reconnect (since `onRpcReady` fires again on each reconnection).

## Viewer Background

The background layer (`position: fixed; inset: 0; z-index: 0`) hosts two viewer components as absolutely positioned siblings:

| Viewer | Files | Component |
|--------|-------|-----------|
| Diff Viewer | All text files | `<ac-diff-viewer>` |
| SVG Viewer | `.svg` files | `<ac-svg-viewer>` |

Only one viewer is visible at a time. CSS classes `viewer-visible` / `viewer-hidden` toggle `opacity` and `pointer-events` with a 150ms transition. The app shell routes `navigate-file` events by file extension and toggles visibility on `active-file-changed`.

Both viewers share the same empty state: AC⚡DC watermark (8rem, 18% opacity). Both maintain independent tab state — switching between an open `.svg` and an open `.js` file toggles the viewer layer without closing either tab.

Post-edit refresh (`stream-complete` with `files_modified`, or `files-modified` events) calls `refreshOpenFiles()` on both viewers. Neither viewer auto-opens new tabs on refresh.

See [Diff Viewer](diff_viewer.md) for the Monaco editor and [SVG Viewer](svg_viewer.md) for the SVG diff viewer.

## Local Storage Persistence Pattern

Multiple components persist UI preferences to localStorage using a duplicated `_loadBool`/`_saveBool` pattern (load via `getItem(key) === 'true'`, save via `setItem(key, String(value))`). This is intentionally duplicated per-component rather than extracted to a shared utility — each component manages its own keys independently.

| Component | Keys |
|-----------|------|
| Dialog | `ac-dc-dialog-width`, `ac-dc-dialog-pos`, `ac-dc-minimized`, `ac-dc-active-tab` |
| File picker | `ac-dc-picker-width`, `ac-dc-picker-collapsed` |
| Search tab | `ac-dc-search-ignore-case`, `ac-dc-search-regex`, `ac-dc-search-whole-word` |
| Chat panel | `ac-dc-snippet-drawer` |
| Cache tab | `ac-dc-cache-expanded` |
| Context tab | `ac-dc-context-expanded` |
| Token HUD | `ac-dc-hud-collapsed` |

## Content-Visibility Detail

The `content-visibility` optimization described in the chat interface spec relies on `data-msg-index` attributes on each `.message-card` element. These indices are also used by the chat search highlight system. The last 15 messages use `content-visibility: visible` and `contain: none` (via a `.force-visible` class) to ensure accurate scroll heights near the bottom of the conversation, where the user is most likely scrolling.

## Graceful Degradation

| Failure | Behavior |
|---------|----------|
| Tree-sitter parse failure | Skip file in symbol index, log warning. File still in tree and selectable |
| LLM provider down/timeout | streamComplete with error in chat. User can retry |
| Git operation fails | Return `{error}` from RPC. Error toast. File tree doesn't update |
| Commit fails | Error shown in chat. Files remain staged |
| URL fetch fails | Chip shows error state. Error results not cached. Content not included. User can retry |
| WebSocket disconnect | Reconnecting banner with attempt count, auto-retry with exponential backoff (1s, 2s, 4s, 8s, max 15s). On disconnect: reset `SharedRpc`, show banner, dispatch error toast. On reconnect: re-publish call proxy, fetch state, rebuild UI, dispatch success toast |
| Config file corrupt/missing | Use built-in defaults. Log warning. Settings panel displays the error |
| Symbol cache corrupt | Clear in-memory cache, rebuild from source |
| Compaction LLM failure | Safe defaults (no boundary, 0 confidence). History unchanged. Retry next trigger |
| Emergency token overflow | Oldest messages truncated without summarization if > 2× compaction trigger |
| Review mode crash | Manual recovery via `git checkout {original_branch}`. Detached HEAD state is safe — disk files match branch tip |