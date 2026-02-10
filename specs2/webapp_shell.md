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

A thin (3px) bar at the bottom showing history token usage:
- **Green** — normal usage
- **Orange** — warning level
- **Red** — critical level

Width transitions smoothly as a percentage fill.

## Left Panel (File Picker) Resizer

On the Files tab, a vertical resizer separates the file picker from the chat panel:
- Draggable handle with collapse button (◀/▶)
- Width constrained 150px–500px
- Width and collapsed state persisted to local storage

## Diff Viewer (Background)

The app shell hosts a `<diff-viewer>` component that fills the viewport behind the dialog:
- `position: fixed; inset: 0; z-index: 0` — always behind the dialog
- Shows an empty/dark state when no files are open
- File tab bar appears at the top when files are loaded
- Monaco diff editor fills the remaining space
- The app shell listens for `navigate-file` events and routes them to the diff viewer
- Post-edit file updates are routed from the `stream-complete` handler to the diff viewer
- Save events from the diff viewer (`file-save`) are handled by the app shell, which calls the appropriate Repo or Settings RPC

## Lifecycle
═══════ REPL

specs2/webapp_shell.md
««« EDIT
### Startup
- Initialize input handling, window controls, streaming, URL service, scroll observer
- Register event listeners for snippets and panel resize
- On RPC ready: call `LLM.get_current_state()` to restore session (messages, selected files, streaming status), load file tree, load snippets, sync history bar
═══════ REPL
### Startup
- Initialize diff viewer (background layer) and dialog (foreground)
- Register event listeners for file navigation and save events
- On RPC ready: call `LLM.get_current_state()` to restore session (messages, selected files, streaming status), load file tree, load snippets, sync history bar

### Startup
- Initialize input handling, window controls, streaming, URL service, scroll observer
- Register event listeners for snippets and panel resize
- On RPC ready: call `LLM.get_current_state()` to restore session (messages, selected files, streaming status), load file tree, load snippets, sync history bar

### Reconnection (Browser Refresh)
- jrpc-oo handles WebSocket reconnection automatically
- On `setupDone`: fetch current state from server, rebuild chat display and file selection
- If a stream is active (from another tab or pre-refresh), display existing messages but don't receive in-progress chunks

### Shutdown
- Tear down all listeners, controls, handlers, observers, services
