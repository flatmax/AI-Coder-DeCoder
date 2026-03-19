# File Navigation Grid

## Overview

File navigation uses a **2D spatial grid** rather than tabs or a linear history stack. Every file-open action creates a new node adjacent to the current node on a 2D grid. Alt+Arrow keys traverse the grid spatially — left, right, up, down — opening the target file in the diff viewer or SVG viewer as appropriate. A fullscreen HUD overlay appears while Alt is held, showing the grid structure and the user's position within it.

## Grid Model

### Nodes

Each node represents a single file-open event positioned on a 2D grid:

| Field | Description |
|-------|-------------|
| `id` | Unique integer, auto-incrementing |
| `path` | Relative file path |
| `gridX` | Integer X position on the grid |
| `gridY` | Integer Y position on the grid |

Multiple nodes may reference the same file path. All nodes sharing a path are colored identically and highlight together when any one of them is the current node.

### Grid Adjacency

Adjacency is **implicit from grid coordinates**. Two nodes are neighbors if and only if their grid positions differ by exactly 1 in one axis and 0 in the other (Manhattan distance = 1). There are no explicit edge objects — a lookup index keyed by `"gridX,gridY"` provides O(1) neighbor checks.

Each grid cell holds at most one node. A node at `(x, y)` has up to 4 potential neighbors at `(x+1, y)`, `(x-1, y)`, `(x, y-1)`, and `(x, y+1)`.

### Travel Counts

Travel counts track how often the user has navigated **between** two adjacent nodes. They are stored in a separate map keyed by a canonical pair `"min(idA,idB)-max(idA,idB)"` → count. When the user presses Alt+Arrow and moves from node A to neighbor B, the count for that pair increments by 1.

Travel counts are used to decide which neighbor to replace when all 4 adjacent cells are occupied (see [Replacement When Surrounded](#replacement-when-surrounded)).

### No Persistence

The grid is not persisted. On page reload, the grid is empty. The first file opened after reload becomes the root node.

### No Dirty Tracking

Navigating away from a file does not preserve unsaved changes. The editor content is discarded when a different node becomes current. Standard Ctrl+S saving works while a file is active.

### Viewport Restoration

When navigating back to a previously visited file (via Alt+Arrow or HUD click), the diff viewer restores the scroll position and cursor to where the user left off. The viewport state (scroll top/left, line number, column) is saved per-file in a transient `Map` before switching away, and restored after the diff editor finishes computing. This state is not persisted — on page reload, all saved viewports are lost along with the grid.

## Node Creation

### Triggers

Any action that opens a file creates a new node:

| Source | Event |
|--------|-------|
| File picker click | `file-clicked` dispatched from `<ac-file-picker>` |
| Search result click | `navigate-file` from `<ac-search-tab>` |
| Chat file mention click | `file-mention-click` from `<ac-chat-panel>` |
| Edit block file link | `navigate-file` from edit block rendering |
| Server `navigateFile` RPC | `navigate-file` callback on app shell |
| LSP go-to-definition | Definition jump within Monaco editor |

### Non-Triggers

These do not create nodes:

| Action | Reason |
|--------|--------|
| Alt+Arrow navigation | Traversal to existing neighbor, not file-open |
| HUD click on a node | Teleport to existing node, no new node created |
| Programmatic file refresh | Post-edit reload, `refreshOpenFiles` |
| Page load | No grid exists yet; first explicit open creates root |

### Same-File Suppression

If the current node already references the same file path as the target, no new node is created. The file is already open.

### Placement Algorithm

When a new node is created from the current node, it is placed in the first available adjacent cell in priority order: **right → up → down → left**.

1. Check which of the 4 adjacent grid cells are unoccupied, in priority order
2. Place the new node at the first free adjacent cell
3. The new node becomes the current node; the file is opened in the viewer

If all 4 adjacent cells are occupied, the [Replacement When Surrounded](#replacement-when-surrounded) algorithm runs instead.

### Replacement When Surrounded

When all 4 adjacent cells around the current node are occupied and a new file is opened:

1. Among the 4 neighbors, find the one with the **lowest travel count** (from the current node to that neighbor)
2. If tied, prefer replacing in reverse priority order: left → down → up → right (i.e., the least-preferred direction is replaced first)
3. **Remove** the chosen neighbor node from the grid (clear it and all its travel counts)
4. Place the new node in the freed cell
5. Show an undo toast in the HUD (see [Replacement Undo](#replacement-undo))

Note: removing a neighbor may create disconnected subgraphs if the removed node was the only path to other nodes. This is acceptable (see [Disconnected Subgraphs](#disconnected-subgraphs)).

### Grid Collision on Placement

When a new node's target grid position is occupied by an existing node (this occurs during replacement — the chosen cell is occupied by definition):

1. The existing node at that position is **removed** from the grid
2. All travel counts involving the removed node are cleared
3. This may create disconnected subgraphs — that is acceptable (see [Disconnected Subgraphs](#disconnected-subgraphs))
4. The new node is placed at the now-free position

## Navigation

### Alt+Arrow Traversal

| Shortcut | Action |
|----------|--------|
| Alt+← | Navigate to the node at `(currentX-1, currentY)` |
| Alt+→ | Navigate to the node at `(currentX+1, currentY)` |
| Alt+↑ | Navigate to the node at `(currentX, currentY-1)` |
| Alt+↓ | Navigate to the node at `(currentX, currentY+1)` |

When an Alt+Arrow key is pressed:

1. Look up the adjacent grid cell in the pressed direction
2. If no node exists at that cell, do nothing (no-op)
3. If a node exists, increment the travel count for the current↔neighbor pair
4. The neighbor becomes the current node
5. The file at the neighbor node is opened in the appropriate viewer (diff viewer or SVG viewer, based on file extension)
6. The HUD updates to show the new position

These shortcuts are handled at the **app shell level** with a capture-phase listener to intercept before Monaco's word-navigation Alt+Arrow bindings. When the grid has nodes, all Alt+Arrow events are consumed (`preventDefault` + `stopPropagation`) regardless of whether a neighbor exists in the pressed direction — this prevents unintended edits in Monaco while the HUD is visible.

### HUD Click Teleport

Clicking any node in the HUD jumps directly to that node. This is a **teleport** — no new node is created, no travel counts change. The clicked node becomes current and its file is opened.

This allows reaching disconnected subgraphs that are unreachable via Alt+Arrow traversal.

### Disconnected Subgraphs

Node removal (via grid collision, replacement, or right-click delete) can create disconnected subgraphs — clusters of nodes with no occupied-cell path to the current node. These remain at their fixed grid positions and are:

- **Visible** in the HUD at their original positions
- **Clickable** to teleport to them
- **Not reachable** via Alt+Arrow from the current node's connected region

Disconnected nodes work normally if they become the current node (via click) — new files opened from them are placed in adjacent cells using the standard algorithm.

## HUD

### Activation

The HUD appears when the user presses **Alt+Arrow** (any direction), regardless of whether a node exists in the adjacent cell. It does not appear on a bare Alt press — the arrow key must accompany it. If no neighbor exists, the HUD still shows so the user can see the grid structure and available directions.

### Dismissal

When Alt is released, the HUD fades out over **150ms**. The file at the current node is already loaded (it was opened on the Alt+Arrow press).

### Holding Alt

While Alt is held, the HUD remains visible. The user can:

- Press additional arrow keys to continue navigating
- Click any node to teleport
- Right-click a node for the context menu
- View the grid structure

### Layout

The HUD is a **fullscreen semi-transparent overlay** (dark backdrop, ~85% opacity) with the grid rendered on top.

- Nodes are positioned at their grid coordinates with fixed spacing between cells
- The **current node is always centered** in the viewport
- The viewport **pans smoothly** when navigating to keep the current node centered
- Nodes that are off-screen (large grids) become visible as the user navigates toward them

### Node Rendering

Each node is rendered as a rounded rectangle:

| Element | Description |
|---------|-------------|
| Label | File basename (e.g., `config.py`), truncated if longer than ~20 characters |
| Color | Determined by file extension (see [File Type Colors](#file-type-colors)) |
| Border | Solid 2px, slightly lighter than fill |
| Current indicator | Brighter fill + white border + subtle pulse animation |
| Same-file highlight | All nodes sharing the same file path as the current node get a matching glow |
| Hover | Full relative path shown as tooltip |

### Connector Lines

Lines are drawn between every pair of nodes that are grid-adjacent (Manhattan distance = 1). These are purely visual — there are no explicit edge objects in the data model.

| Element | Description |
|---------|-------------|
| Line | Solid, semi-transparent white |
| Travel count | Small number rendered at the midpoint of the line (omitted if count is 0) |
| Direction | No arrowheads — adjacency is symmetric |

### File Type Colors

Colors follow the visible spectrum, mapped by language family:

| Color | Extensions |
|-------|------------|
| Red | `.c`, `.h` |
| Orange | `.cpp`, `.cc`, `.hpp`, `.cxx` |
| Yellow | `.js`, `.jsx`, `.mjs` |
| Lime | `.ts`, `.tsx` |
| Green | `.md`, `.txt`, `.rst` |
| Teal | `.json`, `.yaml`, `.yml`, `.toml`, `.xml` |
| Blue | `.py`, `.pyi` |
| Purple | `.svg` |
| Pink | `.css`, `.scss`, `.html` |
| Grey | everything else |

All nodes for the same file path share the same color. The specific hex values should be chosen to be readable against the dark HUD backdrop.

### Navigation Animation

When the user presses an Alt+Arrow and a neighbor exists:

1. The current-node highlight shifts to the neighbor
2. The viewport pans smoothly to center the new node (~200ms transition)
3. The previous node's highlight returns to its normal color
4. If the neighbor shares a file path with other nodes, all same-file nodes pulse briefly

### Context Menu (Right-Click)

Right-clicking a node in the HUD shows a context menu:

| Action | Description |
|--------|-------------|
| **Remove node** | Removes the node and clears all its travel counts. May create disconnected subgraphs. Greyed out for the current node — the user must navigate away first. |

### Clear Button

A **Clear** button is rendered in the corner of the HUD overlay. Clicking it:

1. Removes all nodes and travel counts from the grid
2. If a file is currently open, creates a new root node for that file at the center
3. If no file is open (edge case — unlikely since files can't be closed), the grid is completely empty

### Replacement Undo

When a neighbor node is replaced to make room for a new file (see [Replacement When Surrounded](#replacement-when-surrounded)), the HUD shows a transient notification:

```
Replaced config.py  [ Undo ]
```

- Displayed for **3 seconds**, then auto-dismissed
- Clicking **Undo** restores the replaced node (including its travel counts) and removes the newly placed node
- Only the most recent replacement is undoable — a subsequent replacement replaces the undo state
- If the HUD is dismissed (Alt released) before undo is clicked, the undo opportunity is lost

### Empty State

When the grid has no nodes (fresh page load, no file opened yet), Alt+Arrow does nothing and the HUD does not appear.

## Viewer Integration

### File Routing

When a node becomes current (via Alt+Arrow or HUD click), the file is opened in the appropriate viewer based on extension:

| Extension | Viewer |
|-----------|--------|
| `.svg` | SVG viewer (`<ac-svg-viewer>`) |
| All others | Diff viewer (`<ac-diff-viewer>`) |

This matches the existing routing logic in the app shell.

### Opening Files

The grid component dispatches a `navigate-file` event with the file path. The app shell handles routing to the correct viewer, exactly as it does today for file picker clicks and search result navigation.

### No Content Caching

When navigating away from a node, the editor content is not cached. Navigating back to a node re-fetches the file from disk. Any unsaved changes are lost. This matches the current behavior where files are loaded fresh on each open. However, the diff viewer preserves and restores the **viewport state** (scroll position and cursor) per-file — see [Per-File Viewport State](diff_viewer.md#per-file-viewport-state).

## Component Architecture

### `<ac-file-nav>` Component

A LitElement component that manages the grid state and renders the HUD overlay.

**State (internal, not reactive properties):**

| Field | Type | Description |
|-------|------|-------------|
| `nodes` | `Map<number, Node>` | All nodes in the grid |
| `gridIndex` | `Map<string, number>` | `"x,y"` → node id for O(1) cell lookup |
| `travelCounts` | `Map<string, number>` | `"min(idA,idB)-max(idA,idB)"` → traversal count |
| `currentNodeId` | `number \| null` | The active node |
| `nextId` | `number` | Auto-incrementing node ID counter |
| `undoState` | `object \| null` | Last replacement, for undo |

**Reactive properties:**

| Property | Type | Description |
|----------|------|-------------|
| `visible` | `Boolean` | Whether the HUD overlay is shown |

**Public methods:**

| Method | Description |
|--------|-------------|
| `openFile(path)` | Called by app shell when any file-open action occurs. Creates a node if the current node references a different path. Returns `{ path, created }` — `created` is `false` when same-file suppression applies. |
| `navigateDirection(dir)` | Called on Alt+Arrow. Looks up the adjacent cell in the given direction. Returns the file path of the neighbor, or `null` if the cell is empty. |
| `show()` | Makes the HUD visible |
| `hide()` | Triggers the 150ms fade-out |
| `clear()` | Resets the grid, keeping current file as root |

**Events dispatched:**

| Event | Detail | Description |
|-------|--------|-------------|
| `navigate-file` | `{ path }` | When a node becomes current (Alt+Arrow or HUD click) |

### Integration with App Shell

The `<ac-file-nav>` component is placed in the app shell, sibling to the viewer layer. The app shell:

1. Intercepts Alt+Arrow keydown events at the document level
2. Calls `fileNav.navigateDirection(dir)` — if a path is returned, routes to the viewer
3. On Alt keyup, calls `fileNav.hide()`
4. On any file-open event (picker, search, chat, etc.), calls `fileNav.openFile(path)` before routing to the viewer

### Integration with File Picker

No changes to the file picker. It dispatches `file-clicked` as before. The app shell intercepts and routes through `<ac-file-nav>`.

### Integration with Diff Viewer

No changes to the diff viewer. It receives `openFile(opts)` calls as before. The grid is upstream — the diff viewer doesn't know about it.

### Integration with SVG Viewer

No changes to the SVG viewer. Same as diff viewer — receives `openFile(opts)` calls routed by the app shell.

### Integration with Collaboration

When collaboration is active, `navigateFile` broadcasts cause all clients to open the same file. Each client maintains its **own** independent navigation grid. The broadcast triggers `openFile(path)` on each client's `<ac-file-nav>`, which creates a node in that client's local grid.

## Keyboard Shortcut Conflicts

### Monaco Editor

Monaco uses Alt+← and Alt+→ for word-level cursor navigation, and Alt+↑ and Alt+↓ for moving lines up/down. The app shell intercepts all four Alt+Arrow combinations at the **document level** (`addEventListener('keydown', ..., true)` with capture) before they reach Monaco. When the grid has nodes, all Alt+Arrow events are consumed (`preventDefault` + `stopPropagation`) regardless of whether a neighbor exists — this prevents unintended side effects (word jumps, line moves) in the editor while the HUD is showing. When the grid is empty (no files opened yet), the events propagate normally.

### Existing App Shortcuts

The existing global shortcuts (Alt+1 through Alt+9 for tabs, Ctrl+Shift+F for search, etc.) are unaffected. Alt+Arrow is a new binding that doesn't conflict with any existing shortcut.

### Escape

Pressing Escape while the HUD is visible hides it immediately (no fade) without navigating. Alt release also hides it.

## Testing

### Grid Operations
- First file open creates root node at `(0, 0)`
- Second file open creates node at `(1, 0)` (right of root)
- Third from root fills `(0, -1)` (up), then `(0, 1)` (down), then `(-1, 0)` (left)
- Same-file open from current node is suppressed (no new node)
- All 4 neighbors occupied → replaces the least-traveled neighbor
- Replacement tie-breaking prefers reverse priority order (left first)
- Grid collision replaces existing node at target position
- Node removal clears all travel counts involving that node
- `gridIndex` stays in sync after every add/remove operation

### Navigation
- Alt+→ with node at `(currentX+1, currentY)` opens that file
- Alt+← with empty cell at `(currentX-1, currentY)` is no-op
- Travel counts increment on each traversal between a pair
- HUD click teleports without creating new nodes
- Disconnected nodes reachable via HUD click

### HUD
- HUD appears on first Alt+Arrow press
- HUD stays visible while Alt held
- HUD fades on Alt release (150ms)
- Escape hides HUD immediately
- Current node centered in viewport
- Viewport pans on navigation
- Connector lines drawn between all grid-adjacent node pairs
- Travel counts displayed on connector lines (omitted when 0)
- Same-file nodes highlight together
- Right-click context menu shows remove option
- Clear button resets grid, keeps current file
- Replacement shows undo toast
- Undo restores replaced node and removes new node

### Integration
- File picker click creates grid node then opens file
- Search result click creates grid node then opens file
- SVG files route to SVG viewer
- Non-SVG files route to diff viewer
- Collaboration: each client has independent grid
- Monaco word-navigation works when grid is empty