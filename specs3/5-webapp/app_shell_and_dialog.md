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

- Set browser tab title to `{repo_name}` (e.g., `my-project`). The repo name is the root node name from `get_current_state()` or `Repo.get_file_tree()`. Updated on initial state load.
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

**Files Tab:** On RPC ready: load snippets, load file tree. On `state-loaded`: restore messages, selected files, streaming status, sync file picker, scroll chat to bottom.

**Dialog:** On RPC ready: sync history bar via `LLM.get_history_status()`.

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

### Header Sections

| Section | Content |
|---------|---------|
| Left | Active tab label; click toggles minimize |
| Center | Tab icon buttons |
| Git actions | Clipboard, commit, reset buttons (Files tab only) |
| Right | History browser, clear context, minimize button |

### Minimizing

Toggle via header click or Alt+M. Minimized: 48px header only.

### History Bar

3px bar at bottom showing history token usage percentage:
- Green ≤ 75%, Orange 75–90%, Red > 90%
- Data from `LLM.get_history_status()`, refreshed on: RPC ready, stream-complete, compaction, state-loaded, session-reset

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