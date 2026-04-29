# Reference: File Navigation Grid

**Supplements:** `specs4/5-webapp/file-navigation.md`

## Numeric constants

### Spatial layout

| Constant | Value |
|---|---|
| `GRID_SPACING_X` | 180 px |
| `GRID_SPACING_Y` | 100 px |
| `NODE_WIDTH` | 150 px |
| `NODE_HEIGHT` | 48 px |
| `NODE_RADIUS` | 8 px (corner radius) |

### Animation / timing

| Constant | Value |
|---|---|
| `FADE_DURATION` | 150 ms (HUD fade-out on Alt release) |
| `UNDO_TIMEOUT` | 3000 ms (replacement undo toast lifetime) |
| Alt+Arrow debounce window | ~200 ms (rapid arrow sequences coalesce to one navigate-file dispatch) |

Debounce behavior: HUD updates immediately on every arrow press; `navigate-file` dispatch fires on Alt release OR after 200ms with no additional arrow press. Alt release flushes any pending dispatch immediately.

## Schemas

### Placement priority

Direction order tried when adding a new neighbor, in priority order:

```
PLACEMENT_ORDER = ['right', 'up', 'down', 'left']
```

Reading-direction preference — grid tends to grow rightward.

### Replacement priority

When all four neighbors are occupied and a new node must replace one, tie-breaking order among equal-travel-count candidates:

```
REPLACEMENT_ORDER = ['left', 'down', 'up', 'right']
```

**Exact inverse of PLACEMENT_ORDER.** The grid tends to grow rightward and shrink leftward under pressure. Changing the arrays will change which neighbors get replaced first in pathological cases.

### Direction offsets

```
DIR_OFFSET = {
  right: { dx: 1, dy: 0 },
  left:  { dx: -1, dy: 0 },
  up:    { dx: 0, dy: -1 },
  down:  { dx: 0, dy: 1 },
}
```

Y increases downward (screen convention). `up` has negative dy; `down` has positive dy.

### Node data model

| Field | Type | Description |
|---|---|---|
| `id` | integer | Auto-incrementing unique identifier |
| `path` | string | Relative file path |
| `gridX` | integer | X position on the grid |
| `gridY` | integer | Y position on the grid |

### Grid state

| State | Structure |
|---|---|
| `_nodes` | `Map<id, Node>` |
| `_gridIndex` | `Map<"gridX,gridY", id>` — O(1) cell lookup |
| `_travelCounts` | `Map<"min(idA,idB)-max(idA,idB)", integer>` — canonical pair keys |
| `_currentNodeId` | integer or null |
| `_nextId` | integer (auto-increment source) |
| `_undoState` | `{ removedNode, replacedBy, timestamp }` or null |

### Event detail flags

Events the grid dispatches (or reacts to) carry optional flags that modify app-shell behavior:

| Flag | Effect |
|---|---|
| `_fromNav: true` | Event originated from the grid itself; app shell skips grid registration to prevent duplicate nodes |
| `_refresh: true` | Event is a programmatic refresh (post-edit reload); app shell skips grid registration |
| `_remote: true` | Event originated from a collaboration broadcast; app shell does not re-broadcast (prevents echo loops) |

### File type color palette

Colors mapped by language family, following visible spectrum:

| Color | Hex | Extensions |
|---|---|---|
| Red | `#f87171` | `.c`, `.h` |
| Orange | `#fb923c` | `.cpp`, `.cc`, `.hpp`, `.cxx` |
| Yellow | `#facc15` | `.js`, `.jsx`, `.mjs` |
| Lime | `#a3e635` | `.ts`, `.tsx` |
| Green | `#4ade80` | `.md`, `.txt`, `.rst` |
| Teal | `#2dd4bf` | `.json`, `.yaml`, `.yml`, `.toml`, `.xml` |
| Blue | `#60a5fa` | `.py`, `.pyi` |
| Purple | `#a78bfa` | `.svg` |
| Pink | `#f472b6` | `.css`, `.scss`, `.html` |
| Grey | `#9ca3af` | Everything else |

Values chosen to be readable against the dark HUD backdrop (#1a1a1a region). All nodes for the same file path share the same color.

## Dependency quirks

### Alt+Arrow capture-phase listener

App shell intercepts all four Alt+Arrow combinations at the document level using a **capture-phase** event listener (`addEventListener(..., true)`). This runs BEFORE Monaco's word-navigation Alt+Arrow bindings.

When the grid has nodes, all Alt+Arrow events are consumed (`preventDefault()` + `stopPropagation()`) regardless of whether a neighbor exists — prevents unintended word jumps or line moves in the Monaco editor while the HUD is visible.

When the grid is empty (no files opened yet), Alt+Arrow events propagate normally, so Monaco's default bindings work.

### Escape priority

Escape while HUD is visible hides the HUD immediately (no fade) without navigating. Alt release also hides with fade. The two paths cleanly separate "I want to dismiss this NOW" from "I'm done navigating."

## Cross-references

- Behavioral specification (grid operations, HUD, node creation): `specs4/5-webapp/file-navigation.md`
- Diff viewer integration (refetches on every navigate-file, no per-node viewport cache): `specs-reference/5-webapp/diff-viewer.md` § No caching across switches
- Global keyboard shortcuts (Alt+1..M bubble-phase; Alt+Arrow capture-phase): `specs-reference/5-webapp/shell.md`