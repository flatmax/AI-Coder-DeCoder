# SVG Viewer

## Overview

A side-by-side SVG diff viewer for `.svg` files. Replaces the Monaco diff editor when an SVG file is opened. Uses `svg-pan-zoom` for native SVG viewBox manipulation — stays crisp at any zoom level. Both panels are synchronized: pan or zoom one and the other follows.

## Routing

The app shell inspects the file extension on every `navigate-file` event:

| Extension | Viewer |
|-----------|--------|
| `.svg` | `<ac-svg-viewer>` |
| All others | `<ac-diff-viewer>` (Monaco) |

Both viewers live in the same background layer as absolutely positioned siblings. CSS classes (`viewer-visible` / `viewer-hidden`) toggle `opacity` and `pointer-events` with a 150ms transition. When either viewer dispatches `active-file-changed`, the app shell activates the correct layer based on the active file's extension.

### Event Flow

```
File picker click → navigate-file event
    │
    ├─ .svg extension? → ac-svg-viewer.openFile()
    │                     Show SVG viewer, hide diff viewer
    │
    └─ other extension? → ac-diff-viewer.openFile()
                          Show diff viewer, hide SVG viewer
```

Both viewers maintain independent tab state. Switching between an open `.svg` tab and an open `.js` tab toggles the viewer layer.

## Layout

```
┌──────────────────────────────────────────────────┐
│ [sample.svg ×] [diagram.svg ×]        Tab bar    │
├────────────────────┬─┬───────────────────────────┤
│    Original        │ │    Modified               │
├────────────────────┤ ├───────────────────────────┤
│                    │ │                           │
│   ┌──────────┐    │ │    ┌──────────┐           │
│   │  SVG     │    │ │    │  SVG     │           │
│   │ content  │    │ │    │ content  │           │
│   └──────────┘    │ │    └──────────┘           │
│                    │ │                           │
├────────────────────┴─┴───────────────────────────┤
│  [−]  100%  [+]  [1:1]  [Fit]        Toolbar    │
└──────────────────────────────────────────────────┘
```

### Panels

- **Left panel**: Original SVG (HEAD version). Always read-only, uses `svg-pan-zoom` for navigation
- **Right panel**: Modified SVG (working copy). Editable in "Select" mode via `SvgEditor`, read-only navigation in "Pan" mode
- A 4px splitter handle separates the panels (hover highlights with accent color)

### Empty State

When no SVG files are open, the viewer shows the AC⚡DC watermark (8rem, 18% opacity), matching the diff viewer's empty state.

## File Tabs

Tab bar matching the diff viewer style:

- File name (basename only)
- Status badge: **N** (new file, cyan), **Δ** (changed, orange), **=** (identical, green)
- Close button (✕)
- Active tab has accent bottom border

### Status Detection

| Badge | Condition |
|-------|-----------|
| N (new) | File does not exist in HEAD |
| Δ (changed) | Original content differs from modified |
| = (same) | Original and modified are identical |

## Interaction Modes

The viewer has two modes, toggled via toolbar buttons:

| Mode | Left Panel | Right Panel | Purpose |
|------|-----------|-------------|---------|
| **Select** (default) | `svg-pan-zoom` (read-only navigation) | `SvgEditor` (visual editing) | Edit SVG elements by dragging, resizing, and typing |
| **Pan** | `svg-pan-zoom` (navigation) | `svg-pan-zoom` (navigation) | Navigate both panels without editing |

Switching modes captures the current editor content, disposes the active interaction handlers, and reinitializes for the new mode. The modified SVG content is preserved across mode switches.

## Synchronized Pan/Zoom

Both panels maintain synchronized viewports:

| Feature | Detail |
|---------|--------|
| Mouse wheel | Zoom in/out |
| Click-drag | Pan (Pan mode) or move elements (Select mode) |
| Double-click | Zoom in at point (Pan mode) or edit text (Select mode) |
| Pinch gesture | Zoom (touch devices) |
| Min zoom | 0.1× |
| Max zoom | 40× |

### Synchronization

In **Pan mode**, both panels use `svg-pan-zoom` with bidirectional sync — interacting with either panel updates the other via zoom/pan API calls.

In **Select mode**, the left panel's `svg-pan-zoom` viewport drives synchronization. When the left panel is panned/zoomed, its viewBox is read and applied to the right panel's `SvgEditor` via `setViewBox()`. When the user zooms in the editor (mouse wheel), the editor's `onZoom` callback syncs back to the left panel by computing the equivalent `svg-pan-zoom` transform.

A guard flag (`_syncing`) prevents infinite callback loops. The toolbar zoom percentage label updates from whichever panel initiated the change.

### Shadow DOM Compatibility

`svg-pan-zoom` operates on SVG elements obtained via `shadowRoot.querySelector()`. Initialization is wrapped in a try/catch — if `svg-pan-zoom` fails (e.g., Shadow DOM isolation issues), the SVGs are still visible and scrollable, just without interactive pan/zoom.

## SVG Editing (Select Mode)

When in Select mode, the right panel uses `SvgEditor` — a pointer-based visual editor for SVG elements. The left panel remains read-only for reference.

### Element Selection

Click an SVG element to select it. A bounding box with handles appears around the selected element. The toolbar shows the selected element's tag name (e.g., `<rect>`, `<circle>`). Click empty space or press Escape to deselect.

### Multi-Selection

Hold **Shift** and click or drag to multi-select:

| Interaction | Behavior |
|-------------|----------|
| **Shift+click** on element | Toggle element in/out of multi-selection |
| **Shift+click** on empty space | No-op |
| **Shift+drag left→right** (forward) | **Containment mode** — solid blue border, selects only elements fully inside the marquee |
| **Shift+drag right→left** (reverse) | **Crossing mode** — dashed green border, selects any elements that touch or intersect the marquee |

Shift+drag always initiates a marquee rectangle. If the drag distance is below 5px (a click rather than a drag), the editor falls back to toggle-select behavior on the element under the cursor. The `_marqueeClickTarget` field tracks this fallback.

The toolbar shows the count of selected elements (e.g., "3 elements") when multiple elements are selected. Multi-selected elements can be dragged as a group.

### Supported Operations

| Operation | Interaction | Supported Elements |
|-----------|------------|-------------------|
| **Move** | Drag selected element | All visible elements (`rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `path`, `text`, `g`) |
| **Resize** | Drag corner/edge handles | `rect`, `circle`, `ellipse` |
| **Vertex edit** | Drag individual vertex handles | `polyline`, `polygon`, `path` |
| **Line endpoint edit** | Drag endpoint handles | `line` |
| **Inline text edit** | Double-click a `<text>` element | `text` |
| **Copy** | Ctrl+C | Any selected element |
| **Paste** | Ctrl+V | Pastes with slight offset |
| **Delete** | Delete or Backspace key | Any selected element |
| **Zoom** | Mouse wheel | Manipulates SVG viewBox directly |
| **Pan** | Drag on empty space | Translates SVG viewBox |

### Inline Text Editing

Double-clicking a `<text>` element opens a `<foreignObject>` textarea overlay positioned at the text's bounding box. The textarea matches the text's font size and color. Enter confirms the edit (updating the `<text>` element's content), Escape cancels. Only one text edit can be active at a time — starting a new edit commits the previous one.

### Handles

Selection handles are rendered as a dedicated SVG `<g>` group overlaid on the selected element:
- **Bounding box**: A dashed rectangle showing the element's bounds
- **Corner handles**: Small circles at corners for resize (rect, circle, ellipse)
- **Vertex handles**: Small circles at each vertex for point editing (polyline, polygon)
- **Path handles**: Circles at each command endpoint, with dotted lines to control points for cubic/quadratic curves
- Handle radius scales inversely with zoom level to maintain a consistent screen size

### Interaction Model

The editor determines interaction behavior from the element type:

| Element | Drag Behavior | Handle Behavior |
|---------|--------------|-----------------|
| `rect` | Translate (x, y) | Resize (width, height) |
| `circle` | Translate (cx, cy) | Resize (r) |
| `ellipse` | Translate (cx, cy) | Resize (rx, ry) |
| `line` | Translate both endpoints | Move individual endpoints |
| `polyline`, `polygon` | Translate all points | Move individual vertices |
| `path` | Translate via transform | Move individual path points |
| `text` | Translate (x, y or transform) | — (double-click to edit) |
| `g` (group) | Translate via transform | — |

### Marquee Visual Feedback

The marquee rectangle's appearance changes based on drag direction to signal the selection mode:

| Direction | Fill | Stroke | Dash | Meaning |
|-----------|------|--------|------|---------|
| Forward (left→right) | Blue 12% opacity | Solid `#4fc3f7` | None | Containment — must be fully inside |
| Reverse (right→left) | Green 10% opacity | Dashed `#7ee787` | 4px on / 3px off | Crossing — any intersection counts |

Stroke width and dash lengths scale inversely with zoom to maintain consistent screen-pixel appearance.

### Dirty Tracking and Undo

Each edit marks the file as dirty (orange pulsing status LED). An **undo stack** captures SVG snapshots after each edit operation (up to 50 entries). Ctrl+Z pops the stack and restores the previous state by re-injecting the SVG content and reinitializing the editor.

### Save

Ctrl+S (or clicking the dirty status LED) saves the modified SVG content to disk via `Repo.write_file`. The `SvgEditor.getContent()` method commits any active text edit, removes selection handles, serializes the SVG, then re-renders handles — ensuring saved content is clean.

## Toolbar

A bottom toolbar with mode toggle, zoom controls, and edit actions:

| Button | Action |
|--------|--------|
| ✦ Select | Switch to Select (edit) mode |
| ✥ Pan | Switch to Pan (navigate) mode |
| `<tag>` | Shows selected element's tag name (Select mode only) |
| − | Zoom out (propagates via sync callback) |
| % label | Current zoom percentage (read-only) |
| + | Zoom in |
| 1:1 | Reset to 100% zoom and center position |
| Fit | Fit SVG to panel dimensions |
| ↩ Undo | Undo last edit (Ctrl+Z). Disabled when nothing to undo |
| 💾 Save | Save modified SVG (Ctrl+S). Disabled when not dirty |
| 📋 Copy | Copy SVG as PNG image to clipboard (Ctrl+Shift+C) |

## SVG Content Injection

SVG content cannot be rendered via Lit templates (Lit doesn't natively handle raw SVG string injection). Instead:

1. `render()` creates empty `.svg-left` and `.svg-right` container divs
2. `_injectSvgContent()` sets `innerHTML` on each container with the SVG string
3. After injection, SVG elements are normalized:
   - `width`/`height` attributes removed (so SVG fills container)
   - `style.width` and `style.height` set to `100%`
   - `viewBox` attribute added if missing (computed from the original `width` and `height` attributes before they are removed — e.g., `width="200" height="100"` becomes `viewBox="0 0 200 100"`)
4. `svg-pan-zoom` is initialized on the injected SVG elements via `requestAnimationFrame`

**Retry on next frame**: If the `.svg-left` / `.svg-right` containers are not yet in the shadow DOM when `_injectSvgContent()` runs (due to Lit render timing — the method may be called from `updated()` before the template has committed), it schedules a retry via `requestAnimationFrame`. This ensures injection succeeds even when called during the Lit update lifecycle before the DOM reflects the latest template.

## File Content Fetching

Content is fetched via the same RPC methods as the diff viewer:

| Version | RPC Call | Fallback |
|---------|----------|----------|
| HEAD (original) | `Repo.get_file_content(path, 'HEAD')` | Empty string (file is new) |
| Working copy (modified) | `Repo.get_file_content(path)` | Empty string (file deleted) |

Each call is wrapped in its own try/catch — a failure in one (e.g., file doesn't exist in HEAD) doesn't prevent the other from loading. The response is normalized to a string regardless of whether the RPC returns a string or `{content: string}` object.

## Public API

Mirrors the diff viewer's interface so the app shell can treat both uniformly:

| Method | Description |
|--------|-------------|
| `openFile(opts)` | Open or switch to an SVG file. Fetches content if not provided |
| `refreshOpenFiles()` | Re-fetch content for all open files (post-edit refresh) |
| `closeFile(path)` | Close a tab, dispose pan/zoom, update active index |
| `getDirtyFiles()` | Returns empty array (SVGs are read-only) |

### `openFile(opts)`

```pseudo
opts:
    path: string          // Required
    original: string?     // SVG content for left panel
    modified: string?     // SVG content for right panel
    is_new: boolean?      // Whether file is new (no HEAD version)
```

If `original` and `modified` are not provided, content is fetched via RPC. If the file is already open, its tab is activated without re-fetching.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+PageDown | Next tab |
| Ctrl+PageUp | Previous tab |
| Ctrl+W | Close active tab |
| Ctrl+S | Save modified SVG |
| Ctrl+Z | Undo last edit (Select mode) |
| Ctrl+C | Copy selected element (Select mode) |
| Ctrl+Shift+C | Copy SVG as PNG image to clipboard |
| Ctrl+V | Paste copied element (Select mode) |
| Delete / Backspace | Delete selected element (Select mode) |
| Escape | Deselect current element / cancel text edit |

## Resize Handling

A `ResizeObserver` on the diff container calls `svg-pan-zoom.resize()` on both panels when the container dimensions change (e.g., dialog resize, browser window resize).

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `svg-pan-zoom` | ^3.6.1 | Native SVG viewBox pan/zoom with mouse, touch, and wheel support |

`SvgEditor` is a custom class (`svg-editor.js`) with no external dependencies — it operates directly on SVG DOM elements using pointer events, `getScreenCTM()`, and `createSVGPoint()` for coordinate transforms.

## Integration with Existing Systems

### App Shell

The app shell manages viewer visibility:
- Both `<ac-diff-viewer>` and `<ac-svg-viewer>` are children of `.diff-background`
- On `navigate-file`: check extension, toggle `viewer-visible`/`viewer-hidden` classes
- On `active-file-changed`: activate the correct viewer layer
- On `stream-complete` with `files_modified`: call `refreshOpenFiles()` on both viewers
- On `files-modified` (commit, reset): call `refreshOpenFiles()` on both viewers if they have open files

### File Picker

No changes needed. The file picker dispatches `navigate-file` events for all file types — the app shell handles routing.

### Search Tab

Search results for `.svg` files route through the same `navigate-file` → app shell → SVG viewer path.

### Edit Blocks

LLM edit blocks for `.svg` files are applied normally (text-based edits). After application, `refreshOpenFiles()` updates the SVG viewer's content if the file is open.

## Context Menu

Right-clicking on the right (editable) panel opens a context menu with:

| Action | Shortcut | Description |
|--------|----------|-------------|
| Copy as PNG | Ctrl+Shift+C | Renders the current modified SVG to a canvas and copies as PNG to clipboard |

The context menu is positioned at the click point relative to the diff container. It dismisses on clicking outside or on a subsequent right-click. The dismiss listener uses `click` (not `pointerdown`) so that clicking a menu button fires its handler before the dismiss logic runs.

## Copy as PNG

The "Copy as PNG" feature renders the current SVG to a high-quality PNG image:

1. **Parse dimensions** — reads `viewBox` or `width`/`height` attributes to determine intrinsic size
2. **Scale for quality** — scales up to 2×–4× (capped at 4096px on the longest side) for crisp output
3. **Render to canvas** — creates an offscreen `<canvas>`, draws a white background, then renders the SVG via an `Image` element loaded from a Blob URL
4. **Clipboard write** — passes a `Promise<Blob>` (not a resolved Blob) to `ClipboardItem` to preserve the user-gesture context across async operations
5. **Download fallback** — if `navigator.clipboard.write` is unavailable or fails, downloads the PNG file instead

Available via three paths:
- **Context menu**: right-click → "Copy as PNG"
- **Toolbar button**: 📋 Copy
- **Keyboard shortcut**: Ctrl+Shift+C (Cmd+Shift+C on Mac)

## Future Enhancements

### Visual Diff Overlay

A translucent overlay mode showing both SVGs superimposed with difference highlighting (pixel-diff or structural SVG diff).

### SVG Element Inspection

Click on an SVG element to see its attributes, path data, and position in the SVG DOM tree.

### Source Editor Panel

A split view with a Monaco text editor showing the SVG source alongside the rendered view, with live preview updates on keystroke.

### Export

~~Export the current view (zoomed/cropped) as PNG or PDF.~~ PNG copy is now implemented via the Copy as PNG feature. PDF export remains a future enhancement.