# Webapp Shell

## Overview

The webapp is a single-page application built with web components. The main UI surface is a floating dialog that hosts all tabs and interactions — draggable, resizable, and collapsible.

## Application Structure

Built with **Lit** (LitElement web components). No additional frameworks. Components use shadow DOM for style scoping and Lit's reactive property system for state management.

```
AppShell (root component, extends JRPCClient)
    └── Dialog
        ├── Header Bar (tabs, actions, minimize)
        ├── Content Area
        │   ├── Files & Chat tab (default)
        │   ├── Search tab
        │   ├── Context Budget tab
        │   ├── Cache Tiers tab
        │   └── Settings tab
        └── History Bar (token usage indicator)
```

## Dialog Behavior

### Positioning & Dragging

- Default: positioned via normal document flow
- Dragging the header switches to fixed positioning with explicit coordinates
- 5px movement threshold distinguishes clicks from drags (under threshold = toggle minimize)
- Drag uses document-level mouse listeners, cleaned up on release

### Resizing

- Eight directional handles (n, s, e, w, ne, nw, se, sw) around the perimeter
- North/west handles adjust position to keep opposite edge anchored
- Minimum: 300px wide, 200px tall
- Handles are invisible until hovered

### Minimizing

- Toggle via header click (without drag) or minimize button
- Minimized: ~250px × 48px, only header visible
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

## Lifecycle

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
