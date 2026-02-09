# Dialog Spec

The main UI surface is a single floating dialog that hosts all tabs and interactions. It behaves like a desktop window — draggable, resizable, and collapsible — while remaining embedded in the browser viewport.

## Structure

The dialog is a `<div class="dialog">` rendered by `PromptView` via `renderPromptView()`. It consists of:

1. **Resize handles** — Eight directional handles around the perimeter (n, s, e, w, ne, nw, se, sw)
2. **Header bar** — Drag handle, tab buttons, action buttons, minimize toggle
3. **Main content area** — Tab panels and chat interface
4. **History bar** — Thin token-usage indicator at the bottom edge

## Positioning & Dragging

- By default the dialog is positioned via normal document flow (`position: relative`, `width: 50vw`, `height: 100%`).
- Dragging the header bar switches to `position: fixed` with explicit `left`/`top` coordinates. The dialog gains the `dragged` class and is sized to `height: calc(100vh - 80px)`.
- A 5-pixel movement threshold distinguishes clicks from drags. If the mouse is released without exceeding the threshold, the action is treated as a click and toggles minimize instead.
- Drag state is managed by `WindowControlsMixin`: `_handleDragStart` on the header's `mousedown`, with `mousemove`/`mouseup` listeners added to `document` for the duration of the gesture and cleaned up on release.

## Resizing

- Eight invisible resize handles are positioned absolutely around the dialog edges and corners.
- Dragging a handle updates `_dialogWidth` and/or `_dialogHeight` via `_handleResizeMove`. For north/west handles, `dialogX`/`dialogY` are adjusted to keep the opposite edge anchored.
- Minimum dimensions: 300px wide, 200px tall.
- `getResizeStyle()` returns the inline CSS applied to the dialog element.
- Resize handles highlight on hover (`rgba(233, 69, 96, 0.3)` background).
- All document-level listeners are cleaned up in `_handleResizeEnd` and `destroyWindowControls`.

## Minimizing

- Clicking the `▼`/`▲` button (or clicking the header without dragging) toggles `minimized`.
- When minimized the dialog collapses to `250px × 48px` — only the header bar is visible. All content including resize handles, main content, and the history bar are hidden.
- The header left section shows the name of the active tab and acts as a minimize toggle on click.

## Left Panel (File Picker) Resizer

- When the Files tab is active and the file picker is visible, a vertical resizer separates the picker panel from the chat panel.
- The resizer has a draggable handle (`cursor: col-resize`) and a collapse button (`◀`/`▶`).
- Panel width is constrained between 150px and 500px and persisted to `localStorage` under `promptview-left-panel-width`.
- Collapsed state is persisted under `promptview-left-panel-collapsed`.

## Tabs

The header contains five tab buttons displayed as a centered row of icon buttons. Tabs use the `TABS` enum from `utils/constants.js`:

| Key        | Icon | Label          |
|------------|------|----------------|
| `FILES`    | 📁   | Files & Chat   |
| `SEARCH`   | 🔍   | Search         |
| `CONTEXT`  | 📊   | Context Budget |
| `CACHE`    | 🗄️   | Cache Tiers    |
| `SETTINGS` | ⚙️   | Settings       |

### Tab behavior

- The active tab is tracked by `activeLeftTab` (default: `FILES`).
- `switchTab(tab)` sets `activeLeftTab` and lazily imports the tab's component on first visit. Visited tabs are tracked in `_visitedTabs` so their DOM is preserved (hidden via `visibility: hidden` + `position: absolute` + `pointer-events: none`) rather than destroyed. This preserves scroll positions and component state across tab switches.
- The Files tab always renders. Other tabs render only after first visit.
- The header left section displays the active tab's icon and name.
- Switching to the Files tab re-establishes the scroll observer. Switching to Search focuses the search input. Switching to Context or Cache triggers a data refresh. Switching to Settings loads config info.
- Each tab's content and behavior will be covered in its own spec.

## Header Sections

The header is divided into four flex sections:

1. **header-left** — Active tab label; click toggles minimize.
2. **header-tabs** — The five tab icon buttons (centered).
3. **header-git** — Git action buttons (clipboard, commit, reset); only visible on the Files tab when not minimized.
4. **header-right** — History browser toggle, clear context, and minimize button; history/clear only visible on Files tab when not minimized.

## History Bar

A 3px-tall bar at the absolute bottom of the dialog showing history token usage as a colored fill:

- **Green** (`#7ec699`) — Normal usage
- **Orange** (`#f0a500`) — Warning level (`.warning` class)
- **Red** (`#e94560`) — Critical level (`.critical` class)

The fill width transitions smoothly and is rendered by `renderHistoryBar()`.

## Lifecycle

- `connectedCallback` initializes input handling, window controls, streaming, URL service, scroll observer, and registers event listeners for snippet drawer and panel resize.
- `disconnectedCallback` tears down all listeners, window controls, input handlers, scroll observers, URL service, and panel resize listeners.
- `setupDone` (called when JRPC connection is established) publishes the RPC call object, loads the file tree, restores the last session, loads prompt snippets, and syncs the history bar.
