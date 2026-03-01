# File Navigation Graph

## Overview

File navigation uses a **2D spatial graph** rather than tabs or a linear history stack. Every file-open action creates a new node adjacent to the current node on a 2D grid. Alt+Arrow keys traverse the graph spatially — left, right, up, down — opening the target file in the diff viewer or SVG viewer as appropriate. A fullscreen HUD overlay appears while Alt is held, showing the graph structure and the user's position within it.

## Graph Model

### Nodes

Each node represents a single file-open event positioned on a 2D grid:

| Field | Description |
|-------|-------------|
| `id` | Unique integer, auto-incrementing |
| `path` | Relative file path |
| `gridX` | Integer X position on the grid |
| `gridY` | Integer Y position on the grid |
| `edges` | Map of direction → neighbor node id (`right`, `up`, `down`, `left`) |
| `travelCounts` | Map of direction → number of times this edge has been traversed (in either direction) |

Multiple nodes may reference the same file path. All nodes sharing a path are colored identically and highlight together when any one of them is the current node.

### Edges

Edges are spatial adjacency links between nodes. Each node has at most **4 edges**, one per cardinal direction (right, up, down, left). Edges are bidirectional — if A's `right` is B, then B's `left` is A.

### Edge Symmetry

When a new node B is placed to the right of node A:
- A's `right` edge → B
- B's `left` edge → A

This is always enforced. If B's `left` slot is already occupied, the existing occupant's reciprocal edge is cleared first.

### No Persistence

The graph is not persisted. On page reload, the graph is empty. The first file opened after reload becomes the root node.

### No Dirty Tracking

Navigating away from a file does not preserve unsaved changes. The editor content is discarded when a different node becomes current. Standard Ctrl+S saving works while a file is active.

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
| Alt+Arrow navigation | Traversal of existing edges, not file-open |
| HUD click on a node | Teleport to existing node, no edge created |
| Programmatic file refresh | Post-edit reload, `refreshOpenFiles` |
| Page load | No graph exists yet; first explicit open creates root |

### Same-File Suppression

If the current node already references the same file path as the target, no new node is created. The file is already open.

### Placement Algorithm

When a new node is created from the current node, it is placed in the first available edge slot in priority order: **right → up → down → left**.

1. Check if the current node has a free slot in priority order
2. Place the new node at the grid position adjacent to the current node in that direction
3. If the target grid position is already occupied by another node, **replace** that node (remove it and all its edges, then place the new node)
4. Create the bidirectional edge between current and new node
5. The new node becomes the current node; the file is opened in the viewer

### Edge Eviction (5th Node)

When all 4 edge slots on the current node are occupied and a new file is opened:

1. Find the edge with the **lowest travel count** (sum of forward + backward traversals)
2. If tied, prefer evicting in reverse priority order: left → down → up → right (i.e., the least-preferred slot is dropped first)
3. Remove the evicted edge (clear both endpoints' references)
4. The evicted neighbor node remains in the graph at its fixed position but is now disconnected from the current node
5. Place the new node in the freed slot
6. Show an undo toast in the HUD (see [Edge Eviction Undo](#edge-eviction-undo))

### Grid Collision on Placement

When a new node's target grid position is occupied by an existing node:

1. The existing node at that position is **removed** from the graph
2. All edges connected to the removed node are cleared (both endpoints)
3. This may create disconnected subgraphs — that is acceptable (see [Disconnected Subgraphs](#disconnected-subgraphs))
4. The new node is placed at the now-free position

## Navigation

### Alt+Arrow Traversal

| Shortcut | Action |
|----------|--------|
| Alt+← | Navigate to the node connected via the `left` edge |
| Alt+→ | Navigate to the node connected via the `right` edge |
| Alt+↑ | Navigate to the node connected via the `up` edge |
| Alt+↓ | Navigate to the node connected via the `down` edge |

When an Alt+Arrow key is pressed:

1. If no neighbor exists in that direction, do nothing (no-op)
2. If a neighbor exists, increment the travel count on that edge
3. The neighbor becomes the current node
4. The file at the neighbor node is opened in the appropriate viewer (diff viewer or SVG viewer, based on file extension)
5. The HUD updates to show the new position

These shortcuts are handled at the **app shell level** with a capture-phase listener to intercept before Monaco's word-navigation Alt+Arrow bindings. When the graph has nodes, all Alt+Arrow events are consumed (`preventDefault` + `stopPropagation`) regardless of whether a neighbor exists in the pressed direction — this prevents unintended edits in Monaco while the HUD is visible.

### HUD Click Teleport

Clicking any node in the HUD jumps directly to that node. This is a **teleport** — no edge is created, no travel counts change. The clicked node becomes current and its file is opened.

This allows reaching disconnected subgraphs that are unreachable via Alt+Arrow traversal.

### Disconnected Subgraphs

Node removal (via grid collision, edge eviction, or right-click delete) can create disconnected subgraphs — nodes that have no edge path to the current node. These remain at their fixed grid positions and are:

- **Visible** in the HUD at their original positions
- **Clickable** to teleport to them
- **Not reachable** via Alt+Arrow from the main connected component

Disconnected nodes can acquire new edges normally if they become the current node (via click) and new files are opened from them.

## Size Limit

The graph is capped at **200 nodes**. When a 201st node would be created:

1. Find the node with the lowest total travel count across all its edges (excluding the current node)
2. If tied, remove the oldest node (lowest `id`)
3. Remove that node and clear all its edges
4. Proceed with normal node creation

## HUD

### Activation

The HUD appears when the user presses **Alt+Arrow** (any direction), regardless of whether a neighbor exists in that direction. It does not appear on a bare Alt press — the arrow key must accompany it. If no neighbor exists, the HUD still shows so the user can see the graph structure and available directions.

### Dismissal

When Alt is released, the HUD fades out over **150ms**. The file at the current node is already loaded (it was opened on the Alt+Arrow press).

### Holding Alt

While Alt is held, the HUD remains visible. The user can:

- Press additional arrow keys to continue navigating
- Click any node to teleport
- Right-click a node for the context menu
- View the graph structure

### Layout

The HUD is a **fullscreen semi-transparent overlay** (dark backdrop, ~85% opacity) with the graph rendered on top.

- Nodes are positioned on a grid with fixed spacing
- The **current node is always centered** in the viewport
- The viewport **pans smoothly** when navigating to keep the current node centered
- Nodes that are off-screen (large graphs) become visible as the user navigates toward them

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

### Edge Rendering

Edges are rendered as lines connecting adjacent nodes:

| Element | Description |
|---------|-------------|
| Line | Solid, semi-transparent white |
| Travel count | Small number rendered at the midpoint of the edge |
| Direction | No arrowheads needed — edges are bidirectional |

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
| **Remove node** | Removes the node and all its edges. May create disconnected subgraphs. Greyed out for the current node — the user must navigate away first. |

### Clear Button

A **Clear** button is rendered in the corner of the HUD overlay. Clicking it:

1. Removes all nodes and edges from the graph
2. If a file is currently open, creates a new root node for that file at the center
3. If no file is open (edge case — unlikely since files can't be closed), the graph is completely empty

### Edge Eviction Undo

When an edge is evicted to make room for a 5th connection, the HUD shows a transient notification:

```
Edge to config.py dropped  [ Undo ]
```

- Displayed for **3 seconds**, then auto-dismissed
- Clicking **Undo** restores the dropped edge (including its travel counts) and removes the newly added node/edge
- Only the most recent eviction is undoable — a subsequent eviction replaces the undo state
- If the HUD is dismissed (Alt released) before undo is clicked, the undo opportunity is lost

### Empty State

When the graph has no nodes (fresh page load, no file opened yet), Alt+Arrow does nothing and the HUD does not appear.

## Viewer Integration

### File Routing

When a node becomes current (via Alt+Arrow or HUD click), the file is opened in the appropriate viewer based on extension:

| Extension | Viewer |
|-----------|--------|
| `.svg` | SVG viewer (`<ac-svg-viewer>`) |
| All others | Diff viewer (`<ac-diff-viewer>`) |

This matches the existing routing logic in the app shell.

### Opening Files

The graph component dispatches a `navigate-file` event with the file path. The app shell handles routing to the correct viewer, exactly as it does today for file picker clicks and search result navigation.

### No Content Caching

When navigating away from a node, the editor content is not cached. Navigating back to a node re-fetches the file from disk. Any unsaved changes are lost. This matches the current behavior where files are loaded fresh on each open.

## Component Architecture

### `<ac-file-nav>` Component

A new LitElement component that manages the graph state and renders the HUD overlay.

**State (internal, not reactive properties):**

| Field | Type | Description |
|-------|------|-------------|
| `nodes` | `Map<number, Node>` | All nodes in the graph |
| `currentNodeId` | `number \| null` | The active node |
| `nextId` | `number` | Auto-incrementing node ID counter |
| `undoState` | `object \| null` | Last eviction, for undo |

**Reactive properties:**

| Property | Type | Description |
|----------|------|-------------|
| `visible` | `Boolean` | Whether the HUD overlay is shown |

**Public methods:**

| Method | Description |
|--------|-------------|
| `openFile(path)` | Called by app shell when any file-open action occurs. Creates a node if the current node references a different path. Returns `{ path, created }` — `created` is `false` when same-file suppression applies. |
| `navigateDirection(dir)` | Called on Alt+Arrow. Returns the file path of the neighbor, or `null` if no neighbor. |
| `show()` | Makes the HUD visible |
| `hide()` | Triggers the 150ms fade-out |
| `clear()` | Resets the graph, keeping current file as root |

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

No changes to the diff viewer. It receives `openFile(opts)` calls as before. The graph is upstream — the diff viewer doesn't know about it.

### Integration with SVG Viewer

No changes to the SVG viewer. Same as diff viewer — receives `openFile(opts)` calls routed by the app shell.

### Integration with Collaboration

When collaboration is active, `navigateFile` broadcasts cause all clients to open the same file. Each client maintains its **own** independent navigation graph. The broadcast triggers `openFile(path)` on each client's `<ac-file-nav>`, which creates a node in that client's local graph.

## Keyboard Shortcut Conflicts

### Monaco Editor

Monaco uses Alt+← and Alt+→ for word-level cursor navigation, and Alt+↑ and Alt+↓ for moving lines up/down. The app shell intercepts all four Alt+Arrow combinations at the **document level** (`addEventListener('keydown', ..., true)` with capture) before they reach Monaco. When the graph has nodes, all Alt+Arrow events are consumed (`preventDefault` + `stopPropagation`) regardless of whether a neighbor exists — this prevents unintended side effects (word jumps, line moves) in the editor while the HUD is showing. When the graph is empty (no files opened yet), the events propagate normally.

### Existing App Shortcuts

The existing global shortcuts (Alt+1 through Alt+9 for tabs, Ctrl+Shift+F for search, etc.) are unaffected. Alt+Arrow is a new binding that doesn't conflict with any existing shortcut.

### Escape

Pressing Escape while the HUD is visible hides it immediately (no fade) without navigating. Alt release also hides it.

## Testing

### Graph Operations
- First file open creates root node at grid center
- Second file open creates node to the right of root
- Third from root fills up slot, then down slot, then left slot
- Same-file open from current node is suppressed (no new node)
- Different-file open from full node evicts least-traveled edge
- Eviction tie-breaking prefers reverse priority order
- Grid collision replaces existing node
- Node removal clears all connected edges
- Graph capped at 200 nodes, oldest/least-traveled removed

### Navigation
- Alt+→ with right neighbor opens that file
- Alt+← with no left neighbor is no-op
- Travel counts increment on each traversal
- HUD click teleports without creating edges
- Disconnected nodes reachable via HUD click

### HUD
- HUD appears on first Alt+Arrow press
- HUD stays visible while Alt held
- HUD fades on Alt release (150ms)
- Escape hides HUD immediately
- Current node centered in viewport
- Viewport pans on navigation
- Same-file nodes highlight together
- Right-click context menu shows remove option
- Clear button resets graph, keeps current file
- Edge eviction shows undo toast
- Undo restores evicted edge and removes new node

### Integration
- File picker click creates graph node then opens file
- Search result click creates graph node then opens file
- SVG files route to SVG viewer
- Non-SVG files route to diff viewer
- Collaboration: each client has independent graph
- Monaco word-navigation works when no graph neighbor exists