# File Navigation Grid

File navigation uses a 2D spatial grid rather than tabs or a linear history stack. Every file-open action creates a new node adjacent to the current node on a 2D grid. Alt+Arrow keys traverse the grid spatially — left, right, up, down — opening the target file in the diff viewer or SVG viewer as appropriate. A fullscreen HUD overlay appears while Alt is held, showing the grid structure and the user's position within it.
## Constants
Navigation grid behavior is driven by direction-priority arrays and a small set of sizing/timing constants.
### Spatial Layout
- Horizontal spacing between cell centers
- Vertical spacing between cell centers
- Node card width, height, corner radius
### Animation / Timing
- HUD fade duration on Alt release
- Replacement undo toast lifetime
### Placement Priority
- Direction order to try first when adding a new neighbor — right, up, down, left
- Natural reading direction preference (rightward growth)
### Replacement Priority
- Reverse of placement order — left, down, up, right
- Used when all four neighbors are occupied
- Tie-breaking among equal-travel-count candidates prefers left (the least-preferred placement direction)
- The grid tends to grow rightward and shrink leftward under pressure
Placement and replacement orders are exact inverses of each other. Ordering is intentional and affects user-visible behavior — changing the arrays changes which neighbors get replaced first.
### Direction Offsets
Each direction maps to a grid-cell offset. Y increases downward (screen convention), so up has negative Y and down has positive Y. Traversal and wrapping logic depend on these signs.
## Grid Model
### Nodes
Each node represents a single file-open event positioned on a 2D grid:
- Unique auto-incrementing ID
- Relative file path
- Integer X and Y position on the grid
Multiple nodes may reference the same file path. All nodes sharing a path are colored identically and highlight together when any one of them is the current node.
### Grid Adjacency
- Adjacency is implicit from grid coordinates
- Two nodes are neighbors if and only if their positions differ by exactly 1 in one axis and 0 in the other (Manhattan distance 1)
- No explicit edge objects — a lookup index keyed by position provides constant-time neighbor checks
- Each cell holds at most one node
- A node has up to four potential neighbors
### Travel Counts
- Track how often the user has navigated between two adjacent nodes
- Stored in a separate map keyed by a canonical pair of node IDs
- When the user presses Alt+Arrow and moves from node A to neighbor B, the count for that pair increments by 1
- Used to decide which neighbor to replace when all four adjacent cells are occupied
### No Persistence
- Grid is not persisted
- On page reload, the grid is empty
- The first file opened after reload becomes the root node

### Pure Navigation History
- The grid tracks which files the user has visited; it does not correspond to open tabs or persistent viewer state
- Navigating back to a previously-visited node triggers a fresh fetch in the diff viewer — the content is not cached across the visit
- Unsaved edits are discarded whenever the user navigates away from a file, whether by Alt+Arrow, picker click, or any other `navigate-file` dispatch. This is the diff viewer's no-cache policy (see [diff-viewer.md](diff-viewer.md#no-caching-across-switches))
- No per-node viewport state. When returning to a previously-visited node the diff editor starts at the top of the file.
## Node Creation
### Triggers
Any action that opens a file creates a new node:
| Source | Event |
|---|---|
| File picker click | File-clicked from file picker |
| Search result click | Navigate-file from search tab |
| Chat file mention click | File-mention-click from chat panel |
| Edit block file link | Navigate-file from edit block rendering |
| Server navigate-file RPC | Navigate-file callback on app shell |
| LSP go-to-definition | Definition jump within editor |
### Non-Triggers
These do not create nodes:
| Action | Reason |
|---|---|
| Alt+Arrow navigation | Traversal to existing neighbor, not file-open |
| HUD click on a node | Teleport to existing node, no new node created |
| Programmatic file refresh | Post-edit reload |
| Page load | No grid exists yet; first explicit open creates root |
### Same-File Suppression
- If the current node already references the same file path as the target, no new node is created
- File is already open
### Adjacent Same-File Reuse
- If an adjacent neighbor of the current node already references the target file path, no new node is created
- Existing neighbor becomes the current node and its travel count is incremented
- Check scans adjacent cells in placement priority order and uses the first match
- Prevents duplicate nodes for the same file accumulating around a hub node when the user repeatedly opens the same file from different navigation paths
### Placement Algorithm
When a new node is created from the current node:
1. Check which of the four adjacent cells are unoccupied, in priority order
2. Place the new node at the first free adjacent cell
3. The new node becomes the current node; file is opened in the viewer
If all four adjacent cells are occupied, the replacement algorithm runs instead.
### Replacement When Surrounded
When all four adjacent cells around the current node are occupied and a new file is opened:
1. Iterate replacement priority order and find the neighbor with the lowest travel count from the current node
2. Because iteration order is fixed, ties break toward the first-listed direction (left wins over down, down over up, up over right)
3. Remove the chosen neighbor node from the grid (clear it and all its travel counts)
4. Place the new node in the freed cell
5. Show an undo toast in the HUD
Tie-break order is deliberately the reverse of placement order — since new nodes prefer to be placed right, the replacement path prefers to evict from left first. Right-side neighbors (the most recently-added ones in a typical flow) stay stable under pressure.
Removing a neighbor may create disconnected subgraphs if the removed node was the only path to other nodes. This is acceptable — disconnected subgraphs remain reachable via HUD click.
### Grid Collision on Placement
When a new node's target grid position is occupied by an existing node (occurs during replacement):
1. Existing node at that position is removed from the grid
2. All travel counts involving the removed node are cleared
3. May create disconnected subgraphs — acceptable
4. New node is placed at the now-free position
## Navigation
### Alt+Arrow Traversal
| Shortcut | Action |
|---|---|
| Alt+← | Navigate to the node at left neighbor position |
| Alt+→ | Navigate to the node at right neighbor position |
| Alt+↑ | Navigate to the node at upper neighbor position |
| Alt+↓ | Navigate to the node at lower neighbor position |
When an Alt+Arrow key is pressed:
1. Look up the adjacent grid cell in the pressed direction
2. If a node exists, increment the travel count for the current-neighbor pair
3. If no node exists at that cell, wrap to the opposite edge of the grid along the same axis (see edge wrapping)
4. If wrapping also finds no node, no-op
5. The neighbor becomes the current node (immediately — HUD updates without waiting)
6. Dispatching `navigate-file` for the new current node is **debounced** — rapid arrow sequences coalesce into a single fetch for the final position. The dispatch fires on Alt release or after a short pause (on the order of 200ms) with no additional arrow press.
7. The HUD updates to show the new position (no wait for the fetch)

Handled at the app shell level with a capture-phase listener to intercept before Monaco's word-navigation Alt+Arrow bindings. When the grid has nodes, all Alt+Arrow events are consumed regardless of whether a neighbor exists — prevents unintended edits in Monaco while the HUD is visible.

The debounce is necessary because the diff viewer refetches on every `openFile` (see [diff-viewer.md](diff-viewer.md#no-caching-across-switches)). Without coalescing, holding Alt and pressing an arrow key ten times in a second would trigger ten round-trip fetches, most of which would be wasted work superseded by the final position. Debouncing aligns the user's intent ("move to the file at the end of this sequence") with the cost model ("one fetch per visible target").
### Edge Wrapping
When Alt+Arrow is pressed and no node exists in the adjacent cell, navigation wraps to the opposite edge of the grid along the same row or column:
| Direction | Wrap target |
|---|---|
| Left (no left neighbor) | Rightmost node on the same row |
| Right (no right neighbor) | Leftmost node on the same row |
| Up (no upper neighbor) | Bottommost node in the same column |
| Down (no lower neighbor) | Topmost node in the same column |
The scan iterates all nodes, filters to those sharing the same row or column (excluding the current node), and selects the one with the maximum or minimum coordinate on the relevant axis. The wrap target does not need to be directly adjacent — it can be any distance away along the axis. Travel counts are incremented for the current-wrap pair, same as any other traversal.
### HUD Click Teleport
Clicking any node in the HUD jumps directly to that node. This is a teleport — no new node is created, no travel counts change. The clicked node becomes current and its file is opened. Allows reaching disconnected subgraphs that are unreachable via Alt+Arrow traversal.
### Disconnected Subgraphs
- Node removal (via grid collision, replacement, or right-click delete) can create disconnected subgraphs — clusters of nodes with no occupied-cell path to the current node
- Remain at their fixed grid positions and are visible in the HUD, clickable to teleport, not reachable via Alt+Arrow from the current region
- Disconnected nodes work normally if they become the current node — new files opened from them are placed in adjacent cells using the standard algorithm
## HUD
### Activation
- HUD appears when the user presses Alt+Arrow (any direction), regardless of whether a node exists in the adjacent cell
- Does not appear on a bare Alt press — arrow key must accompany it
- If no neighbor exists, HUD still shows so the user can see the grid structure and available directions
### Dismissal
- When Alt is released, the HUD fades out
- File at the current node is already loaded — it was opened on the Alt+Arrow press
### While Alt Held
- HUD remains visible
- User can press additional arrow keys to continue navigating, click any node to teleport, right-click a node for context menu, view grid structure
### Layout
- Fullscreen semi-transparent overlay with the grid rendered on top
- Nodes positioned at their grid coordinates with fixed spacing between cells
- Current node is always centered in the viewport
- Viewport pans smoothly when navigating to keep the current node centered
- Off-screen nodes become visible as the user navigates toward them
### Node Rendering
Each node rendered as a rounded rectangle:
| Element | Description |
|---|---|
| Label | File basename, truncated if longer than a threshold |
| Color | Determined by file extension (see below) |
| Border | Solid, slightly lighter than fill |
| Current indicator | Brighter fill, distinct border, subtle pulse animation |
| Same-file highlight | All nodes sharing the same file path as the current node get a matching glow |
| Hover | Full relative path shown as tooltip |
### Connector Lines
- Drawn between every pair of nodes that are grid-adjacent
- Purely visual — no explicit edge objects in the data model
- Travel count rendered at the line midpoint (omitted when count is 0)
- No arrowheads — adjacency is symmetric
### File Type Colors
Colors follow the visible spectrum, mapped by language family:
| Color | Extensions |
|---|---|
| Red | C, C header |
| Orange | C++ variants |
| Yellow | JavaScript variants |
| Lime | TypeScript variants |
| Green | Markdown, text, reStructuredText |
| Teal | JSON, YAML, TOML, XML |
| Blue | Python |
| Purple | SVG |
| Pink | CSS, SCSS, HTML |
| Grey | Everything else |
All nodes for the same file path share the same color. Specific hex values should be readable against the dark HUD backdrop.
### Navigation Animation
When the user presses an Alt+Arrow and a neighbor exists:
1. Current-node highlight shifts to the neighbor
2. Viewport pans smoothly to center the new node
3. Previous node's highlight returns to its normal color
4. If the neighbor shares a file path with other nodes, all same-file nodes pulse briefly
### Context Menu (Right-Click)
| Action | Description |
|---|---|
| Remove node | Removes the node and clears all its travel counts. May create disconnected subgraphs. Disabled for the current node — must navigate away first |
### Clear Button
- Button in the corner of the HUD overlay
- Clears all nodes and travel counts
- If a file is currently open, creates a new root node for that file at the center
### Replacement Undo
- When a neighbor node is replaced, the HUD shows a transient notification
- Notification — "Replaced X" with undo button
- Displayed for a short interval then auto-dismissed
- Clicking undo restores the replaced node (including travel counts) and removes the newly placed node
- Only the most recent replacement is undoable — a subsequent replacement replaces the undo state
- If the HUD is dismissed before undo is clicked, the opportunity is lost
### Empty State
- When the grid has no nodes (fresh page load, no file opened yet), Alt+Arrow does nothing and the HUD does not appear
## Viewer Integration
### File Routing
When a node becomes current (via Alt+Arrow or HUD click), the file is opened in the appropriate viewer based on extension:
| Extension | Viewer |
|---|---|
| SVG | SVG viewer |
| All others | Diff viewer |
Matches the existing routing logic in the app shell.
### Opening Files
- Grid component dispatches a navigate-file event with the file path
- App shell handles routing to the correct viewer
- Event carries a flag indicating the event originated from the grid itself — the app shell uses this to skip re-registration in the grid
### No Content Caching
- When navigating away from a node, the editor content is not cached in the grid
- Navigating back re-fetches the file from disk; any unsaved changes are lost
- Diff viewer preserves viewport state per-file — see [diff-viewer.md](diff-viewer.md#per-file-viewport-state)
## Component Architecture
### Role
A component that manages the grid state and renders the HUD overlay. Hosted in the app shell as a sibling of the viewer layer.
### State
| Field | Description |
|---|---|
| Nodes | Map of node IDs to node records |
| Grid index | Map of position strings to node IDs for constant-time cell lookup |
| Travel counts | Map of canonical pair keys to traversal counts |
| Current node ID | The active node, or none |
| Next ID | Auto-incrementing counter |
| Undo state | Last replacement, for undo |
| Visible flag | Whether the HUD overlay is shown |
### Public Methods
| Method | Description |
|---|---|
| Open file | Called by app shell when any file-open action occurs. Creates a node if the current node references a different path. Returns path and a created flag |
| Navigate direction | Called on Alt+Arrow. Looks up the adjacent cell, returns the file path of the neighbor or null |
| Show / hide | Toggle HUD visibility |
| Clear | Reset the grid, keeping current file as root |
### Event Detail Flags
Events the grid dispatches (or reacts to) carry optional flags that modify app-shell behavior:
| Flag | Effect |
|---|---|
| From-nav | The event originated from the grid itself. App shell skips grid registration — grid already updated its state |
| Refresh | The event is a programmatic refresh. App shell skips grid registration — no new node created |
| Remote | The event originated from a collaboration broadcast. App shell does not re-broadcast to the server, preventing echo loops |
### Integration with App Shell
- App shell intercepts Alt+Arrow keydown events at the document level
- Calls navigate-direction — if a path is returned, routes to the viewer
- On Alt keyup, hides HUD
- On any file-open event, calls open-file before routing to the viewer
### Integration with File Picker
- No changes to the file picker — dispatches file-clicked as before
- App shell intercepts and routes through the grid
### Integration with Diff Viewer / SVG Viewer
- No changes to the viewers — they receive open-file calls as before
- Grid is upstream — viewers don't know about it
### Integration with Collaboration
- When collaboration is active, navigate-file broadcasts cause all clients to open the same file
- Each client maintains its own independent navigation grid
- Broadcast triggers open-file on each client's grid, which creates a node in that client's local grid
## Keyboard Shortcut Conflicts
### Monaco Editor
- Monaco uses Alt+← and Alt+→ for word-level cursor navigation, Alt+↑ and Alt+↓ for moving lines
- App shell intercepts all four Alt+Arrow combinations at the document level with a capture-phase listener, before they reach Monaco
- When the grid has nodes, all Alt+Arrow events are consumed regardless of whether a neighbor exists — prevents unintended side effects (word jumps, line moves) in the editor while the HUD is showing
- When the grid is empty (no files opened yet), events propagate normally
### Existing App Shortcuts
- Existing global shortcuts (Alt+1..N for tabs, Ctrl+Shift+F for search) are unaffected
- Alt+Arrow is a new binding that doesn't conflict with any existing shortcut
### Escape
- Pressing Escape while the HUD is visible hides it immediately (no fade) without navigating
- Alt release also hides it
## Invariants
- First file open always creates the root node; grid starts empty on every page load
- Same-file suppression prevents opening a file that is already the current node — no duplicate nodes grow at that position
- Adjacent same-file reuse prevents duplicate nodes for the same file around a hub node
- Grid index is always in sync with the nodes map after any add, remove, or move operation
- Travel counts on both sides of a removed node are cleared — no dangling count entries
- Alt+Arrow navigation never creates a new node; only file-open actions do
- HUD click teleport never creates a new node; it's pure navigation
- Replacement picks the neighbor with the lowest travel count; tie-break order is fixed and reverse of placement order
- Monaco word-navigation works only when the grid is empty; otherwise Alt+Arrow is consumed by the grid
- Each collaboration client maintains an independent grid — navigation broadcasts from other clients create nodes on each client's local grid