# App Shell and Dialog

## Overview

The webapp is a single-page application built with **Lit** (LitElement web components). The main UI surface is a floating dialog that hosts all tabs — draggable, resizable, and collapsible. The diff viewer fills the background.

## Application Structure

```
AppShell (root, extends JRPCClient)
    ├── DiffViewer (background, fills viewport)
    │   ├── Tab bar (open files)
    │   └── Monaco diff editor
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

**App Shell:** On `setupDone`: publish call proxy → fetch `LLM.get_current_state()` → dispatch `state-loaded` event.

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

**Lazy loading** — non-default tabs import their component on first visit. **DOM preservation** — visited tabs are hidden, not destroyed.

### Global Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Alt+1..5 | Switch to tab |
| Alt+M | Toggle minimize |
| Ctrl+Shift+F | Open Search tab with current selection or clipboard |

Ctrl+Shift+F captures `window.getSelection()` synchronously before focus change clears it.

### Dragging & Resizing

- Header drag with 5px threshold (under = click → toggle minimize)
- Right edge always resizable (primary handle for left-docked)
- All 8 directional handles after undocking
- Min: 300px × 200px

### Minimizing

Toggle via header click or Alt+M. Minimized: 48px header only.

### History Bar

3px bar at bottom showing history token usage percentage:
- Green ≤ 75%, Orange 75–90%, Red > 90%
- Data from `LLM.get_history_status()`, refreshed on: RPC ready, stream-complete, compaction, state-loaded, session-reset

## Diff Viewer (Background)

- `position: fixed; inset: 0; z-index: 0` — always behind dialog
- Empty state: AC⚡DC watermark (8rem, 18% opacity, 75% horizontal)
- File tab bar at top when files loaded
- Monaco diff editor fills remaining space
- Only reloads already-open files on post-edit refresh; does not auto-open new tabs

See [Diff Viewer](diff_viewer.md) for full editor details.

## Graceful Degradation

| Failure | Behavior |
|---------|----------|
| Tree-sitter parse failure | Skip file in symbol index, log warning |
| LLM provider down | streamComplete with error in chat |
| Git operation fails | Error toast |
| WebSocket disconnect | Reconnecting banner, auto-retry |
| Config file corrupt | Use defaults, log warning |