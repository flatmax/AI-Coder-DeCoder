# Webapp Shell

## Overview

The webapp is a single-page application built with web components. The main UI surface is a floating dialog that hosts all tabs and interactions — draggable, resizable, and collapsible.

## Application Structure

Built with **Lit** (LitElement web components). No additional frameworks. Components use shadow DOM for style scoping and Lit's reactive property system for state management.

```
AppShell (root component, extends JRPCClient)
    ├── DiffViewer (background, fills viewport behind dialog)
    │   ├── Tab bar (open files)
    │   └── Monaco diff editor
    └── Dialog (foreground, left-docked by default)
        ├── Header Bar (tabs, actions, minimize)
        ├── Content Area
        │   ├── Files & Chat tab (default)
        │   ├── Search tab
        │   ├── Context Budget tab
        │   ├── Cache Tiers tab
        │   └── Settings tab
        └── History Bar (token usage indicator)
```

The diff viewer and dialog are **siblings** in the app shell. The diff viewer fills the full viewport as a background layer. The dialog floats on top, initially docked to the left half. File navigation events bubble up to the app shell, which routes them to the diff viewer.

## Dialog Behavior

### Default Layout

The dialog starts **docked to the left edge** of the viewport, filling the full height. Default width is 50% of the viewport (minimum 400px). This leaves the right half of the screen available for the diff viewer.

### Global Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Alt+1..5 | Switch to tab (Files, Search, Context, Cache, Settings) |
| Alt+M | Toggle minimize |
| Ctrl+Shift+F | Open Search tab with current selection or clipboard text |

Ctrl+Shift+F captures the browser's text selection synchronously before switching tabs (focus changes would otherwise clear the selection), then passes it to the search tab for pre-fill. See [Search Interface — Global Shortcut](search_interface.md#global-shortcut).

### Positioning & Dragging

- Default: fixed positioning, left-docked, full height
- Dragging the header allows repositioning to any location
- 5px movement threshold distinguishes clicks from drags (under threshold = toggle minimize)
- Drag uses document-level mouse listeners, cleaned up on release

### Resizing

- Right edge is the primary resize handle (since left-docked)
- All eight directional handles (n, s, e, w, ne, nw, se, sw) available after undocking
- Minimum: 300px wide, 200px tall
- Handles are invisible until hovered

### Minimizing

- Toggle via header click (without drag) or minimize button
- Minimized: collapses to header bar only (48px height), stays at current position
- Header shows active tab name when minimized

## Tabs

Five tabs in a centered row of icon buttons:

| Tab | Icon | Label |
|-----|------|-------|
| FILES | 📁 | Files & Chat |
| SEARCH | 🔍 | Search |
| CONTEXT | 📊 | Context Budget |
| CACHE | 🗄️ | Cache Tiers |
| SETTINGS | ⚙️ | Settings |

### Tab Management

- Active tab tracked in state; default: FILES
- **Lazy loading** — non-default tabs import their component on first visit
- **DOM preservation** — visited tabs are hidden (not destroyed) to preserve scroll positions and state
- Tab-specific actions on switch: Search focuses input, Context/Cache trigger data refresh, Settings loads config info

## Header Sections

| Section | Content |
|---------|---------|
| Left | Active tab label; click toggles minimize |
| Center | Tab icon buttons |
| Git actions | Clipboard, commit, reset buttons (Files tab only) |
| Right | History browser, clear context, minimize button |

## History Bar

A thin (3px) bar at the bottom showing history token usage as a percentage of `compaction_trigger_tokens`:
- **Green** — ≤ 75% of trigger threshold
- **Orange** — 75–90% (warning)
- **Red** — > 90% (critical, compaction imminent)

Width transitions smoothly as a percentage fill (`width: N%` with CSS transition).

### Data Source

`LLM.get_history_status()` returns:
```pseudo
{
    enabled: boolean,
    history_tokens: integer,
    trigger_tokens: integer,
    percent: integer (0–100)
}
```

### Refresh Triggers

The dialog fetches history status on:
1. **RPC ready** — initial sync (spec: "sync history bar")
2. **`stream-complete`** — history grew (user + assistant messages added)
3. **`compaction-event`** (type `compaction_complete`, case ≠ `none`) — history shrank
4. **`state-loaded`** — session loaded or reconnected
5. **`session-reset`** — new session started (history cleared)

## Left Panel (File Picker) Resizer

On the Files tab, a vertical resizer separates the file picker from the chat panel:
- Draggable handle with collapse button (◀/▶)
- Width constrained 150px–500px
- Width and collapsed state persisted to local storage

## Diff Viewer (Background)

The app shell hosts a `<diff-viewer>` component and a `<token-hud>` component that fill the viewport behind the dialog:
- `position: fixed; inset: 0; z-index: 0` — always behind the dialog
- Shows an empty state with the **AC⚡DC** brand watermark when no files are open (large, semi-transparent text at 75% horizontal, vertically centered)
- File tab bar appears at the top when files are loaded
- Monaco diff editor fills the remaining space
- The app shell listens for `navigate-file` events and routes them to the diff viewer
- Post-edit file updates are routed from the `stream-complete` handler to the diff viewer (only reloads already-open files; does not auto-open new tabs)
- Save events from the diff viewer (`file-save`) are handled by the app shell, which calls the appropriate Repo or Settings RPC
- File mention clicks (`file-mention-click`) bubble from chat panel through the dialog to the files tab, which updates file selection

### Token HUD

A `<token-hud>` component rendered as a top-level sibling in the app-shell shadow DOM (outside `.diff-background`). It uses `position: fixed` with `z-index: 10000` to guarantee visibility above Monaco editor overlays. Appears after each LLM response when `streamComplete` includes `token_usage` data. The app shell's `_onStreamCompleteForDiff` handler triggers the HUD via `hud.show(result)`. The HUD uses `RpcMixin` to independently fetch the full context breakdown from `LLM.get_context_breakdown`. See [Chat Interface — Token HUD Overlay](chat_interface.md#token-hud-overlay) for full details.

## Lifecycle

### Startup

**Server (main.py):**
- Validate git repository — if not a repo, write a self-contained HTML file (AC⚡DC branding, repo path, `git init`/`cd` instructions) to a temp file, open it as `file://` in the browser, print terminal banner, and exit. No server or webapp is started.

**App Shell (app-shell.js):**
- Initialize diff viewer (background layer) and dialog (foreground)
- Register event listeners for file navigation, save events, and stream-complete
- On RPC ready (`setupDone`): publish call proxy to `SharedRpc`, call `LLM.get_current_state()` to restore session (messages, selected files, streaming status), dispatch `state-loaded` event

**Files Tab (files-tab.js):**
- On RPC ready: load snippets, load file tree
- On `state-loaded`: restore messages, selected files, streaming status, sync file picker, scroll chat to bottom

**Dialog (ac-dialog.js):**
- On RPC ready: sync history bar via `LLM.get_history_status()`

### Reconnection

- jrpc-oo provides the base WebSocket transport; app shell implements reconnection with exponential backoff (1s, 2s, 4s, 8s, max 15s)
- On disconnect: reset `SharedRpc`, show reconnecting banner with attempt count, dispatch error toast
- On reconnect (`setupDone`): re-publish call proxy to `SharedRpc`, fetch current state from server, rebuild chat display and file selection, dispatch success toast
- Scroll chat to bottom after state is loaded (so the user sees the most recent messages)
- If a stream is active (from another tab or pre-refresh), display existing messages but don't receive in-progress chunks

### Shutdown
- Tear down all listeners, controls, handlers, observers, services