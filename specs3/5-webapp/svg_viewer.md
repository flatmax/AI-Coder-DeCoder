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

### Normal Layout (Select / Pan Mode)

```
┌──────────────────────────────────────────────────┐
│                                      [●] [◱][⊡]  │
│                                                   │
│   ┌──────────┐    │    ┌──────────┐              │
│   │  SVG     │    │    │  SVG     │              │
│   │ original │    │    │ modified │              │
│   └──────────┘    │    └──────────┘              │
│                    │                              │
│   Left panel       │   Right panel               │
│   (read-only)      │   (editable)                │
└──────────────────────────────────────────────────┘
        [●] = status LED (top-right)
        [◱] = presentation mode toggle (bottom-right)
        [⊡] = fit button (bottom-right)
```

### Presentation Layout

```
┌──────────────────────────────────────────────────┐
│                                      [●] [◱][⊡]  │
│                                                   │
│   ┌──────────────────────────────────────────┐   │
│   │                                          │   │
│   │           SVG modified                   │   │
│   │           (editable, full width)         │   │
│   │                                          │   │
│   └──────────────────────────────────────────┘   │
│                                                   │
└──────────────────────────────────────────────────┘
```

In presentation mode the left panel and splitter are hidden via CSS (`display: none`), and the right panel expands to fill the full width. The `SvgEditor` remains active so all editing operations (drag, resize, text edit, undo) continue to work. The left panel's SVG content is not injected and its `svg-pan-zoom` instance is not initialized, avoiding unnecessary work on a hidden element.

There is no tab bar or bottom toolbar — the viewer is a minimal chrome layout with only floating overlay controls.

### Panels

- **Left panel**: Original SVG (HEAD version). Always read-only, uses `svg-pan-zoom` for navigation
- **Right panel**: Modified SVG (working copy). Editable in "Select" mode via `SvgEditor`, read-only navigation in "Pan" mode
- A 4px splitter handle separates the panels (hover highlights with accent color)

### Empty State

When no SVG files are open, the viewer shows the AC⚡DC watermark (8rem, 18% opacity), matching the diff viewer's empty state.

## File Tabs

The viewer supports multiple open files internally (switchable via Ctrl+PageDown/PageUp, closable via Ctrl+W), but does **not** render a visible tab bar. File status is communicated solely through the floating status LED.

### Status Detection

| LED State | Condition |
|-----------|-----------|
| Dirty (orange, pulsing) | Modified content differs from last saved content |
| New file (cyan) | File does not exist in HEAD |
| Clean (green) | No unsaved changes |

## Interaction Modes

The viewer has two modes, switchable programmatically via `_setMode()` (no UI toggle is currently rendered):

| Mode | Left Panel | Right Panel | Purpose |
|------|-----------|-------------|---------|
| **Select** (default) | `svg-pan-zoom` (read-only navigation) | `SvgEditor` (visual editing) | Edit SVG elements by dragging, resizing, and typing |
| **Pan** | `svg-pan-zoom` (navigation) | `svg-pan-zoom` (navigation) | Navigate both panels without editing |
| **Present** | Hidden | `SvgEditor` (visual editing, full width) | Full-width editor with left panel hidden |

Switching modes calls `_captureEditorContent()` — which reads the current SVG from the `SvgEditor` via `getContent()` and writes it back to the active file object's `modified` field — then disposes the active interaction handlers and reinitializes for the new mode. This ensures the modified SVG content is preserved across mode switches. In practice, the viewer starts in Select mode and stays there — Pan mode infrastructure exists but has no UI trigger. Presentation mode is toggled via the `◱` floating button or the F11 keyboard shortcut.

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

A guard flag (`_syncing`) prevents infinite callback loops.

### Shadow DOM Compatibility

`svg-pan-zoom` operates on SVG elements obtained via `shadowRoot.querySelector()`. Initialization is wrapped in a try/catch — if `svg-pan-zoom` fails (e.g., Shadow DOM isolation issues), the SVGs are still visible and scrollable, just without interactive pan/zoom.

## SVG Editing (Select Mode)

When in Select mode, the right panel uses `SvgEditor` — a pointer-based visual editor for SVG elements. The left panel remains read-only for reference.

### Element Selection

Click an SVG element to select it. A bounding box with handles appears around the selected element. Click empty space or press Escape to deselect. The selected element's tag name is tracked internally (`_selectedTag`) but is not currently displayed in the UI.

When a `<tspan>` element is clicked, the hit resolves to its parent `<text>` element — `tspan` is never selected independently. This ensures that PyMuPDF-generated SVGs (which wrap text runs in `<tspan>` children of `<text>`) are fully interactive.

### Multi-Selection

Hold **Shift** and click or drag to multi-select:

| Interaction | Behavior |
|-------------|----------|
| **Shift+click** on selected element | Immediately remove from multi-selection (toggle out) |
| **Shift+click** on unselected element | Immediately add to multi-selection (toggle in), then begin marquee tracking so shift+drag still works |
| **Shift+click** on empty space | Begin marquee selection |
| **Shift+drag top-left→bottom-right** (forward) | **Containment mode** — solid blue border, selects only elements fully inside the marquee. Forward mode requires the end point to be both right of AND below the start point |
| **Shift+drag any other direction** (reverse) | **Crossing mode** — dashed green border, selects any elements that touch or intersect the marquee. Any drag that isn't strictly top-left to bottom-right is treated as crossing mode |

Marquee hit testing checks direct children of the root `<svg>` element and also one level of children inside `<g>` groups. Deeper nesting is not scanned — elements inside nested groups must be selected by clicking the group.

Marquee hit testing checks direct children of the root `<svg>` element and also one level of children inside `<g>` groups. Deeper nesting is not scanned — elements inside nested groups must be selected by clicking the group.

Shift+click toggles elements immediately without waiting for pointer-up. When shift-clicking an unselected element, a marquee is also started (with `_marqueeClickTarget` set to `null` to prevent double-toggle) so that if the user continues dragging, area selection still works. If the resulting drag distance is below 5px, the tiny-marquee fallback is skipped since the toggle was already applied.

The count of selected elements is tracked internally (e.g., `_selectedTag` = "3 elements") but is not currently displayed in the UI. Multi-selected elements can be dragged as a group — clicking on any element that is part of a multi-selection initiates a group drag without breaking the selection.

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
- Handle positions account for ancestor `<g>` transforms via a `localToSvgRoot` coordinate transformation so overlays align with the visually-rendered element position regardless of nesting

### Coordinate Math Details

SVG editing requires translating between three coordinate systems:
1. **Screen coordinates** — raw `clientX`/`clientY` from pointer events
2. **SVG root coordinates** — the viewBox coordinate space of the root `<svg>`
3. **Element-local coordinates** — the coordinate space inside an element's parent `<g>` transforms

Without precise translation, handles drift from their visual positions when elements are inside transformed groups, and drags produce jitter when zoomed.

#### Screen → SVG

```js
_screenToSvg(screenX, screenY) {
  const ctm = this._svg.getScreenCTM();
  if (!ctm) return { x: screenX, y: screenY };
  const pt = this._svg.createSVGPoint();
  pt.x = screenX;
  pt.y = screenY;
  return pt.matrixTransform(ctm.inverse());
}
```

`getScreenCTM()` returns the composed transform from the SVG's internal viewBox space to screen pixels. Inverting it converts pointer events into viewBox units. This is the foundation for all drag math.

#### Element-local → SVG root

```js
_localToSvgRoot(el, lx, ly) {
  const ctm = el.getCTM();            // local → screen
  const svgCtm = this._svg.getCTM();  // svg root → screen
  const m = svgCtm.inverse().multiply(ctm);  // local → svg root
  return { x: m.a*lx + m.c*ly + m.e, y: m.b*lx + m.d*ly + m.f };
}
```

Used when rendering handle overlays: the element's bounding box is in its own local coordinate space (relative to ancestor `<g>` transforms), but handles are placed in the root SVG. The composed matrix accounts for every `translate()`, `scale()`, and `rotate()` on ancestor groups.

#### Handle Size Constancy

Handles should appear at ~6 pixels on screen regardless of zoom. Since SVG coordinates scale with the viewBox, handle radius in SVG units must scale inversely:

```js
_screenDistToSvgDist(screenDist) {
  const a = this._screenToSvg(0, 0);
  const b = this._screenToSvg(screenDist, 0);
  return Math.abs(b.x - a.x);
}

_getHandleRadius() {
  return this._screenDistToSvgDist(HANDLE_RADIUS);  // HANDLE_RADIUS = 6 screen px
}
```

This is called every frame during handle render — the computation is cheap (two CTM multiplies) and ensures handles stay the same size on screen when the user zooms.

#### Hit-Test Exclusion

Handle elements and the marquee rectangle must be ignored by `_hitTest` (finding the SVG element under the pointer):

- All handle overlays are marked with class `HANDLE_CLASS` (constant: `"svg-editor-handle"`)
- The handle group has id `HANDLE_GROUP_ID` (constant: `"svg-editor-handles"`)
- `_hitTest` uses `elementsFromPoint` and skips any element with the handle class, the handle group id, or the root SVG itself
- Tags that never participate in editing are also filtered: `defs`, `style`, `metadata`, `title`, `desc`, `filter`, `lineargradient`, `radialgradient`, `clippath`, `mask`, `marker`, `pattern`, `symbol`

Without this filtering, clicking a handle would re-hit-test to the underlying element and start a drag on that element instead of the handle.

#### preserveAspectRatio="none" on the Editable SVG

When the right-panel SVG is injected, it's given `preserveAspectRatio="none"` explicitly. Without this override, the browser applies `xMidYMid meet` (the default) on top of whatever viewBox `SvgEditor` sets — producing a double-fitted display where the editor's viewBox changes don't match what the user sees. Disabling browser-side aspect handling makes the SVG viewBox the single source of truth for what's visible, and `SvgEditor`'s `fitContent()` / `setViewBox()` fully controls sizing and centering.

The left (read-only) panel keeps the default aspect ratio preservation — `svg-pan-zoom` manages its viewport via internal transform groups rather than viewBox manipulation, so browser aspect fitting is harmless there.

#### Path Command Parsing

Path editing requires parsing the `d` attribute into editable command objects. The parser handles all SVG path commands — M, L, H, V, C, S, Q, T, A, Z — in both absolute (uppercase) and relative (lowercase) forms. Each parsed command has `{cmd, args: [numbers...]}` shape.

Control point extraction walks the command list, tracking the current pen position (absolute coordinates) and extracting draggable points:

| Command | Extracted Points |
|---------|-----------------|
| M, L | endpoint |
| H | endpoint (Y inherited from pen) |
| V | endpoint (X inherited from pen) |
| Q | control point + endpoint |
| C | two control points + endpoint |
| S | control point + endpoint (first control inferred from previous command) |
| T | endpoint only (control inferred) |
| A | endpoint (arc parameters not draggable) |
| Z | no point (closes to subpath start) |

For relative commands, the parser converts to absolute coordinates for display but preserves relative offsets in the serialized output. When a handle is dragged, the delta is applied to the original relative arg values so the overall path shape is preserved.

Serialization (`_serializePathData`) rounds to 3 decimal places and joins commands with spaces. This is ~150 lines of code that must be implemented carefully — off-by-one errors in arg indexing produce visually-broken but syntactically-valid paths.

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
| `text` | Translate (x, y or transform — auto-detected: uses `transform` if the element has a `transform` attribute, otherwise `x`/`y` attributes) | — (double-click to edit) |
| `tspan` | Resolves to parent `text` | — |
| `g` (group) | Translate via transform | — |

### Marquee Visual Feedback

The marquee rectangle's appearance changes based on drag direction to signal the selection mode:

| Direction | Fill | Stroke | Dash | Meaning |
|-----------|------|--------|------|---------|
| Forward (left→right) | Blue 12% opacity | Solid `#4fc3f7` | None | Containment — must be fully inside |
| Reverse (right→left) | Green 10% opacity | Dashed `#7ee787` | 4px on / 3px off | Crossing — any intersection counts |

Stroke width and dash lengths scale inversely with zoom to maintain consistent screen-pixel appearance.

### Dirty Tracking and Undo

Each edit marks the file as dirty (orange pulsing status LED in the top-right corner). An **undo stack** captures SVG snapshots after each edit operation (up to 50 entries). Ctrl+Z pops the stack and restores the previous state by re-injecting the SVG content and reinitializing the editor.

### Save

Ctrl+S or clicking the dirty status LED saves the modified SVG content to disk via `Repo.write_file`. The `SvgEditor.getContent()` method commits any active text edit, removes selection handles, serializes the SVG, then re-renders handles — ensuring saved content is clean. A `file-saved` event is dispatched on success.

## Controls

There is no persistent toolbar. The viewer uses floating overlay buttons and keyboard shortcuts for all actions.

### Floating Action Buttons

The bottom-right corner of the diff container holds a vertical stack of 32×32px floating buttons (`.floating-actions`), each with a rounded border, box-shadow, and hover highlight:

| Button | Icon | Action |
|--------|------|--------|
| Presentation toggle | `◱` | Toggle presentation mode (full-width editor). Highlighted with accent color when active |
| Fit | `⊡` | Fit content to view |

### Fit Button

The `⊡` button fits both panels so SVG content is fully visible within the available space.

Fitting respects the SVG's authored `viewBox` when one exists. Many SVGs — especially those with `<defs>` containing font glyphs, clip paths, or symbol definitions with fractional coordinates — produce misleading `getBBox()` results that don't reflect the intended visible area. The authored viewBox is the correct viewport in these cases.

When no authored viewBox is present, fitting falls back to `getBBox()` (the actual rendered content bounding box) with a 3% margin. The viewBox is then expanded on the shorter axis to match the container's aspect ratio, ensuring the browser's default `preserveAspectRatio="xMidYMid meet"` is effectively a no-op (viewBox AR matches container AR). This approach works correctly for both portrait and landscape SVGs.

For the left panel, the viewBox is expanded from `getBBox()` only when no authored viewBox exists, or when the authored viewBox is smaller than the content bounds AND the `getBBox` area is not suspiciously large (≤ 4× the authored viewBox area). If `getBBox` produces an area vastly larger than the authored viewBox (e.g., off-screen text at x=-28000 from font glyph definitions in `<defs>`), the authored viewBox is trusted as the correct viewport. The same sanity check applies in `_fitAll` for the right panel — if `getBBox` area exceeds 4× the stashed original viewBox area, `getBBox` is discarded and the stashed viewBox is used instead. `svg-pan-zoom` is then initialized with `fit: true` and `center: true`. For the right panel (SvgEditor), if an authored viewBox exists it is fitted into the container dimensions directly (preserving aspect ratio); otherwise `fitContent()` computes a viewBox via `getBBox()`.

### Status LED

A floating 10px circular indicator in the top-right corner of the diff container:

| State | Color | Behavior |
|-------|-------|----------|
| **Dirty** (unsaved edits) | Orange with pulse animation | Click to save (Ctrl+S) |
| **New file** (no HEAD version) | Cyan/accent | Informational only |
| **Clean** | Green | Informational only |

The LED has a hover scale transform (1.4×) for discoverability.

### Zoom

Zooming is performed exclusively via mouse wheel — there are no zoom +/− toolbar buttons. The mouse wheel handler on `SvgEditor` (Select mode) or `svg-pan-zoom` (Pan mode) provides smooth zoom centered on the cursor position. The zoom level is tracked internally (`_zoomLevel`) but is not displayed in the UI.

| Input | Behavior |
|-------|----------|
| Mouse wheel | Zoom in/out centered on cursor |
| Min zoom | 0.1× |
| Max zoom | 40× |

## SVG Content Injection

SVG content cannot be rendered via Lit templates (Lit doesn't natively handle raw SVG string injection). Instead:

1. `render()` creates empty `.svg-left` and `.svg-right` container divs
2. `_injectSvgContent()` sets `innerHTML` on each container with the SVG string

**Injection deduplication:** A generation counter (`_injectGeneration`) guards against duplicate injection. Both `updated()` (Lit lifecycle) and `openFile()` can trigger `_injectSvgContent()` for the same file; the counter ensures only the latest invocation proceeds — earlier invocations that are still in-flight (waiting on `requestAnimationFrame`) bail out when they see the counter has advanced. This applies to both the diff viewer (for Monaco editor creation) and the SVG viewer (for SVG element injection and pan-zoom initialization).

3. After injection, SVG elements are normalized:
   - `width`/`height` attributes removed (so SVG fills container)
   - `style.width` and `style.height` set to `100%`
   - `viewBox` attribute added if missing (computed from the original `width` and `height` attributes before they are removed — e.g., `width="200" height="100"` becomes `viewBox="0 0 200 100"`)
   - For the editable (right) panel, `preserveAspectRatio="none"` is set so `SvgEditor` has full control over viewBox-based fitting without the browser applying an additional transform
4. `svg-pan-zoom` is initialized on the injected SVG elements via `requestAnimationFrame`

**Injection deduplication (detailed):** The counter is incremented at the start of every `_injectSvgContent()` call. Each call captures the counter value as `gen` in local scope. Before any async work (`requestAnimationFrame` callbacks, delayed pan-zoom initialization), the callback checks `gen !== this._injectGeneration` and bails out if a newer call has started:

```js
_injectSvgContent() {
  if (this._injectGeneration == null) this._injectGeneration = 0;
  const gen = ++this._injectGeneration;

  // ... synchronous DOM injection ...

  requestAnimationFrame(() => {
    if (gen !== this._injectGeneration) return;  // superseded — bail
    this._initLeftPanZoom();
    // more rAF callbacks each guarded the same way
    requestAnimationFrame(() => {
      if (gen !== this._injectGeneration) return;
      this._fitAll();
    });
  });
}
```

Without this guard, a rapid sequence of `openFile()` calls would initialize pan-zoom instances on stale SVG content (since `innerHTML` was already replaced by the later call), leaving broken interaction state.

The same pattern is used in the diff viewer's `_showEditor()` for Monaco editor creation guards — see [Diff Viewer — Concurrent openFile Guard](diff_viewer.md#concurrent-openfile-guard).

**Authored viewBox preservation**: Both panels prefer the SVG's authored `viewBox` attribute over a `getBBox()`-derived one. SVGs with `<defs>` containing font glyphs, clip paths, or symbol definitions often have elements with very small coordinate systems (e.g., 0–1 font units) that pollute `getBBox()` results, causing content to appear shrunken. The authored viewBox is trusted as the correct viewport. `getBBox()` is only used as a fallback when no viewBox attribute exists — in that case a 3% margin is added around the computed bounding box. For the right panel, `preserveAspectRatio="none"` is set so that `SvgEditor` has full control over viewBox-based fitting without the browser applying an additional transform.

**Retry on next frame**: If the `.svg-left` / `.svg-right` containers are not yet in the shadow DOM when `_injectSvgContent()` runs (due to Lit render timing — the method may be called from `updated()` before the template has committed), it schedules a retry via `requestAnimationFrame`. This ensures injection succeeds even when called during the Lit update lifecycle before the DOM reflects the latest template.

## Relative Image Resolution

SVG files produced by doc-convert (e.g. from `.pptx` presentations) reference sibling image files with relative paths like `<image xlink:href="01_slide_img1_2.jpg"/>`. When the SVG is injected into the webapp DOM, the browser resolves those paths against the webapp's origin URL — which does not serve repository files. The images silently fail to load.

After `_injectSvgContent()` sets `innerHTML` on both panels, it calls `_resolveImageHrefs()` on each container. This method:

1. Finds all `<image>` elements in the injected SVG
2. Skips elements whose `href` / `xlink:href` is already a `data:` URI or an absolute URL (`http://`, `https://`)
3. Resolves each relative path against the SVG file's directory (e.g. `docs/slides/01_slide.svg` + `01_slide_img1_2.jpg` → `docs/slides/01_slide_img1_2.jpg`)
4. Fetches the binary content via `Repo.get_file_base64` RPC, which returns a `data:` URI with the correct MIME type
5. Rewrites the `href` and/or `xlink:href` attribute in-place so the browser renders the image

Image resolution runs in parallel for all images in both panels via `Promise.all`. It is non-blocking — the SVG panels initialize and become interactive immediately, and images appear as the base64 fetches complete. Failed fetches log a warning but do not prevent the SVG from displaying.

## File Content Fetching

Content is fetched via the same RPC methods as the diff viewer:

| Version | RPC Call | Fallback |
|---------|----------|----------|
| HEAD (original) | `Repo.get_file_content(path, 'HEAD')` | Empty string (file is new) |
| Working copy (modified) | `Repo.get_file_content(path)` | Empty string (file deleted) |
| Embedded images | `Repo.get_file_base64(imagePath)` | Warning logged, image not shown |

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

All toolbar-level actions are accessible only via keyboard shortcuts. Element-level shortcuts (Copy, Paste, Delete, Escape) are handled by `SvgEditor` internally and only apply in Select mode when the editor has focus.

| Shortcut | Scope | Action |
|----------|-------|--------|
| Ctrl+PageDown | Viewer | Next tab |
| Ctrl+PageUp | Viewer | Previous tab |
| Ctrl+W | Viewer | Close active tab |
| Ctrl+S | Viewer | Save modified SVG |
| Ctrl+Z | Viewer (Select mode) | Undo last edit |
| Ctrl+Shift+C | Viewer | Copy SVG as PNG image to clipboard |
| F11 | Viewer | Toggle presentation mode |
| Escape | Viewer (Present mode) | Exit presentation mode (back to Select) |
| Ctrl+C | SvgEditor | Copy selected element(s) |
| Ctrl+V | SvgEditor | Paste copied element(s) with offset |
| Ctrl+D | SvgEditor | Duplicate selected element(s) in place |
| Delete / Backspace | SvgEditor | Delete selected element(s) |
| Escape | SvgEditor | Deselect / cancel text edit / cancel marquee |

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

1. **Parse dimensions** — reads `viewBox` or `width`/`height` attributes to determine intrinsic size (defaults to 1920×1080 when unparseable)
2. **Scale for quality** — scales up to 2×–4× (capped at 4096px on the longest side) for crisp output. Small SVGs (max dimension < 1024px) use up to 4× scale; larger SVGs use up to 2×
3. **Render to canvas** — creates an offscreen `<canvas>`, draws a white background (SVGs often have transparent backgrounds), then renders the SVG via an `Image` element loaded from a Blob URL
4. **Clipboard write** — passes a `Promise<Blob>` (not a resolved Blob) to `ClipboardItem` to preserve the user-gesture context across async operations
5. **Download fallback** — if `navigator.clipboard.write` is unavailable or fails, downloads the PNG file via a synthesized `<a download>` link. The download filename strips `.svg` from the file path's basename and appends `.png` (e.g. `architecture.svg` → `architecture.png`)

### User Feedback

Success and failure are communicated via a toast event dispatched from the viewer:

```js
this.dispatchEvent(new CustomEvent('show-toast', {
  bubbles: true, composed: true,
  detail: { message: 'Image copied to clipboard', type: 'info' },
}));
```

The app shell (or parent component) catches `show-toast` events and renders them in the global toast system. Messages:

| Outcome | Toast message |
|---------|--------------|
| Clipboard write succeeded | `Image copied to clipboard` |
| Clipboard write failed, download succeeded | `Image downloaded as PNG` |
| Both clipboard and download failed | `Failed to copy image` or `Failed to create image` |

Available via two paths:
- **Context menu**: right-click → "Copy as PNG"
- **Keyboard shortcut**: Ctrl+Shift+C (Cmd+Shift+C on Mac)

## SVG ↔ Text Diff Mode Toggle

SVG files can be viewed in either the visual SVG editor or the Monaco text diff editor. Two buttons enable bidirectional switching:

| Button | Location | Direction |
|--------|----------|-----------|
| `</>` (code) | SVG viewer floating actions | Visual → Text diff |
| `🎨 Visual` | Diff viewer overlay buttons | Text diff → Visual |

### Toggle Mechanism

Both directions dispatch a `toggle-svg-mode` window event with:

```pseudo
{
    path: string,          // file path
    target: 'diff' | 'visual',  // which viewer to switch to
    modified?: string,     // latest content from the source viewer
    savedContent?: string, // on-disk content for dirty tracking
}
```

### App Shell Handler

The app shell's `_onToggleSvgMode` handler orchestrates the switch:

**Visual → Text (`target: 'diff'`):**
1. Capture latest SVG content from the SVG editor (`_captureEditorContent`)
2. Read the file object from the SVG viewer's internal files list
3. Flip viewer visibility (show diff, hide SVG)
4. Close any existing diff tab for the path, then open fresh with the captured content
5. Set `savedContent` to the on-disk original so visual edits appear as dirty in the diff editor
6. Layout Monaco after the DOM settles

**Text → Visual (`target: 'visual'`):**
1. Read the file object from the SVG viewer's files list (before closing)
2. Flip viewer visibility (show SVG, hide diff)
3. Close and reopen the SVG viewer with the latest text content from the diff editor
4. Carry `savedContent` through so dirty state is preserved
5. Close the diff viewer's tab for the path

### Race Prevention

A `_svgModeOverride` flag is set on the app shell during the toggle to prevent `_onActiveFileChanged` from interfering. The flag is cleared in a `requestAnimationFrame` callback after the toggle completes. Without this guard, the active-file-changed event from opening the new tab would trigger viewer visibility logic that conflicts with the toggle in progress.

### Content Preservation

`savedContent` (the last on-disk content) is carried across mode toggles so that:
- Edits made in the SVG editor appear as dirty when switching to text mode
- Edits made in the text editor appear as dirty when switching back to visual mode
- Saving in either mode updates `savedContent` for both

## Future Enhancements

### Visual Diff Overlay

A translucent overlay mode showing both SVGs superimposed with difference highlighting (pixel-diff or structural SVG diff).

### SVG Element Inspection

Click on an SVG element to see its attributes, path data, and position in the SVG DOM tree.

### Source Editor Panel

A split view with a Monaco text editor showing the SVG source alongside the rendered view, with live preview updates on keystroke.

### Full-Screen Presentation

~~A full-width editing view that hides the left panel for focused editing or presenting.~~ Implemented as presentation mode — toggled via the `◱` button or F11, exited via Escape or toggling again.

### Export

~~Export the current view (zoomed/cropped) as PNG or PDF.~~ PNG copy is now implemented via the Copy as PNG feature. PDF export remains a future enhancement.