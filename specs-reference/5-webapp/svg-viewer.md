# Reference: SVG Viewer

**Supplements:** `specs4/5-webapp/svg-viewer.md`

This twin captures numeric constants, dispatch tables, and coordinate-math rules for the SvgEditor component. Specs4 describes the behavioral surface (select, drag, resize, vertex edit, multi-selection, marquee, text edit, undo, copy/paste); this twin pins the exact constants and per-element dispatch needed to reproduce the editor faithfully.

## Numeric constants

### Editor geometry

| Constant | Value | Purpose |
|---|---|---|
| `HANDLE_SCREEN_RADIUS` | 6 | Selection-handle visual radius in screen pixels (scales inversely with zoom) |
| `_MIN_RESIZE_DIMENSION` | 1 | Minimum width/height/r/rx/ry in SVG units; clamps prevent shape flipping |
| `_UNDO_MAX` | 50 | Maximum undo stack depth; older snapshots dropped |
| `_PASTE_OFFSET` | 10 | Offset in SVG units applied to pasted elements so they don't overlap their source |
| `_MARQUEE_MIN_SCREEN` | 4 | Minimum drag distance in screen pixels before shift+drag on empty space starts a marquee (below this, the gesture is treated as shift+click) |
| `_DRAG_THRESHOLD_SCREEN` | 3 | Minimum pointermove distance in screen pixels before a pointerdown+pointermove is treated as a drag vs a click-with-jitter |
| `HANDLE_CLASS` | `"svg-editor-handle"` | CSS class applied to every handle overlay element; used by hit-test exclusion |
| `HANDLE_GROUP_ID` | `"svg-editor-handles"` | Id of the root `<g>` containing all selection handle overlays |
| `HANDLE_ROLE_ATTR` | `"data-handle-role"` | Dataset attribute carrying a handle's role identifier |
| `MARQUEE_ID` | `"svg-editor-marquee"` | Id of the transient marquee `<rect>` element |

### Text labels and thresholds

| Constant | Value | Purpose |
|---|---|---|
| Long-text threshold (SVG extractor) | 80 chars | Text elements longer than this become prose blocks in the doc index; shorter are treated as labels |

### Zoom bounds

| Bound | Value |
|---|---|
| Minimum zoom | 0.1× |
| Maximum zoom | 10× |
| Zoom scale sensitivity (wheel) | 0.2 per wheel tick |

## Schemas

### Handle role identifiers

Roles are strings stored in the `data-handle-role` attribute. They classify the handle's geometric function so per-shape dispatch can read a single attribute to decide what to do.

**Rect (8 handles):**

| Role | Position | Effect |
|---|---|---|
| `nw` | Top-left corner | Moves x + y, shrinks width + height (opposite corner pinned) |
| `n` | Top edge midpoint | Moves y, shrinks height (bottom pinned) |
| `ne` | Top-right corner | Moves y, grows width, shrinks height (bottom-left pinned) |
| `e` | Right edge midpoint | Grows width (left pinned) |
| `se` | Bottom-right corner | Grows width + height (top-left pinned) |
| `s` | Bottom edge midpoint | Grows height (top pinned) |
| `sw` | Bottom-left corner | Moves x, shrinks width, grows height (top-right pinned) |
| `w` | Left edge midpoint | Moves x, shrinks width (right pinned) |

**Circle (4 handles):** `n`, `e`, `s`, `w` — any handle sets radius = distance from pointer to center (isotropic resize).

**Ellipse (4 handles):** `n`/`s` adjust `ry` only; `e`/`w` adjust `rx` only. Center unchanged.

**Line (2 handles):** `p1` drags `(x1, y1)` only; `p2` drags `(x2, y2)` only. Endpoints move independently.

**Polyline / polygon (N handles):** `v0`, `v1`, ..., `v{N-1}` — one per vertex. Each role moves exactly one point, leaves others unchanged.

**Path endpoints:** `p0`, `p1`, ..., `p{N-1}` — one per non-Z command. For M/L/T: moves args[0..1]. H: moves args[0] (x only). V: moves args[0] (y only). C: moves args[4..5]. S/Q: moves args[2..3]. A: moves args[5..6]. Z: no handle (null endpoint).

**Path control points (C/S/Q):** `c{N}-1`, `c{N}-2` where N is the command index. C emits both `c{N}-1` (args[0..1]) and `c{N}-2` (args[2..3]). S and Q emit only `c{N}-1`. T emits none (reflected control point, not independently draggable).

## Per-element drag-to-move dispatch

The drag snapshot captures different attributes per element type. `_captureDragAttributes(el)` returns `{kind, ...fields}` or null.

| Element | Snapshot kind | Captured fields | Delta application |
|---|---|---|---|
| `rect`, `image`, `use` | `xy` | `x`, `y` | `x += dx; y += dy` |
| `circle`, `ellipse` | `cxcy` | `cx`, `cy` | `cx += dx; cy += dy` |
| `line` | `line` | `x1`, `y1`, `x2`, `y2` | Both endpoints shift by the same delta |
| `polyline`, `polygon` | `points` | `[[x, y], ...]` | Every point shifts by `(dx, dy)` |
| `text` (no `transform` attr) | `xy` | `x`, `y` | `x += dx; y += dy` |
| `text` (has `transform` attr) | `transform` | `transform` string | Append `translate(dx dy)` to existing transform |
| `path`, `g` | `transform` | `transform` string | Append `translate(dx dy)` to existing transform |

Unknown tags return null — drag silently does not start.

Alignment reuses this same dispatch: `alignSelection(axis, mode)` computes a per-element `(dx, dy)` from the union bbox, calls `_captureDragAttributes` to snapshot the origin attrs, then routes through `_applyDragDeltaToEntry`. Sub-pixel-threshold moves (|dx|, |dy| < 0.0001) are skipped before snapshotting, so alignment is idempotent on already-aligned elements.

## Alignment dispatch

`alignSelection(axis, mode)` translates two-or-more selected elements to share an edge or center against the union bbox of the selection.

| `axis` | `mode` | Per-element delta |
|---|---|---|
| `horizontal` | `left` | `dx = groupMinX - bbox.x` |
| `horizontal` | `center` | `dx = groupCenterX - (bbox.x + bbox.width / 2)` |
| `horizontal` | `right` | `dx = groupMaxX - (bbox.x + bbox.width)` |
| `vertical` | `top` | `dy = groupMinY - bbox.y` |
| `vertical` | `middle` | `dy = groupCenterY - (bbox.y + bbox.height / 2)` |
| `vertical` | `bottom` | `dy = groupMaxY - (bbox.y + bbox.height)` |

Bboxes are computed in SVG root coordinates via `_elementRootBBox(el, svg)` — the element's `getBBox()` (local) is multiplied through `inverse(rootCTM) × elementCTM` to get a four-corner envelope, then min/max gives the axis-aligned root-space box. Required because siblings under different ancestor transforms have incompatible local-space bboxes.

Gating:

- `_selectedSet.size < 2` → no-op (no group reference)
- Element with `_captureDragAttributes` returning null is silently skipped (same as drag)
- All deltas under sub-pixel threshold → no-op (no undo entry, no dirty flip)

Single `_pushUndo()` + `_onChange()` per call, regardless of how many elements move. Same orchestration shape as `deleteSelection` / `pasteClipboard`.

## Snap-to-axis dispatch

`snapSelectionToAxis(axis)` rewrites a single selected line-like element to be exactly horizontal or vertical.

Eligibility (`canSnapSelectionToAxis()`):

| Element | Condition |
|---|---|
| `<line>` | Always eligible |
| `<polyline>` | Exactly two points after `_parsePoints` |
| `<path>` | `_parsePathData(d)` is a single straight segment per `_isSingleStraightSegment` |
| Any other tag | Not eligible |

`_isSingleStraightSegment(commands)` returns true iff the command list has length 2 (M + L) or length 3 (M + L + Z). Both M/L are accepted in either case (uppercase absolute, lowercase relative); the trailing Z must be Z or z.

Per-element rewrite:

| Element | `axis = horizontal` | `axis = vertical` |
|---|---|---|
| `<line>` | `y1 ← y2`, x1 unchanged | `x1 ← x2`, y1 unchanged |
| `<polyline>` (2 points) | First point's y ← second's y | First point's x ← second's x |
| `<path>` (M + L [+ Z]) | Move command's y ← line command's absolute end y | Move command's x ← line command's absolute end x |

Path rewrite always emits absolute M/L regardless of source case — round-tripping through absolute is simpler than preserving relative semantics. Trailing Z is preserved if present.

The second endpoint anchors (x2/y2 for line, point[1] for polyline, L's endpoint for path) — the first endpoint moves. This convention preserves direction of travel for plain lines and keeps the arrow head in place when authoring tools place markers on the second endpoint (the common case for Inkscape, draw.io, PowerPoint).

No-op rules:

- `_selectedSet.size !== 1` → silent no-op
- Already on the requested axis (`y1 === y2` for horizontal, `x1 === x2` for vertical) → silent no-op (no undo entry)
- Selected element doesn't satisfy `canSnapSelectionToAxis` → silent no-op (the host viewer hides the menu entries in this case, but the editor method is defensive anyway)

Single `_pushUndo()` + `_onChange()` per successful call.

## Copy-as-SVG pipeline

Copy-as-SVG reuses the same on-disk serialization path as the save flow:

| Step | Detail |
|---|---|
| Refresh `file.modified` | Call `_onEditorChange()` first to ensure the file's modified text reflects any uncommitted editor mutations. Idempotent on a quiescent editor |
| Source | `file.modified` — same bytes a save would write to disk |
| Serialization | Handle overlay stripped, pan-zoom viewport wrapper unwrapped, inlined data-URI image hrefs swapped back to externalized on-disk paths |
| Clipboard write | `navigator.clipboard.writeText(svgText)` — text-only, no `ClipboardItem` wrapper needed (no async blob production) |
| Empty file fallback | Toast "Nothing to copy" (info) when `file.modified` is empty |
| Clipboard unavailable fallback | Toast "Clipboard not available" (error) — no synthesized download because the operation is text-paste, not file-export |

Available only via right-click menu — no keyboard shortcut. The copy-as-PNG shortcut (Ctrl+Shift+C) is reserved for the bitmap path.

### Points attribute format

Polyline/polygon `points` attributes canonicalize to `x,y` (comma between coordinates, space between points) on output. Input tolerates any combination of commas and whitespace (`10,20 30,40`, `10 20, 30 40`, `10,20,30,40` all parse equivalently).

## Path command parser

`_parsePathData(d)` tokenizes the path `d` attribute into an array of `{cmd, args: [numbers...]}` objects. `_serializePathData(commands)` is the inverse, producing a round-trippable string.

### Argument counts per command

| Command | Args | Semantics (absolute) |
|---|---|---|
| `M`/`m` | 2 | Move to (x, y) |
| `L`/`l` | 2 | Line to (x, y) |
| `H`/`h` | 1 | Horizontal line to x |
| `V`/`v` | 1 | Vertical line to y |
| `C`/`c` | 6 | Cubic Bézier: control1 (x,y), control2 (x,y), end (x,y) |
| `S`/`s` | 4 | Smooth cubic: control2 (x,y), end (x,y) |
| `Q`/`q` | 4 | Quadratic: control (x,y), end (x,y) |
| `T`/`t` | 2 | Smooth quadratic: end (x,y) |
| `A`/`a` | 7 | Arc: rx, ry, x-axis-rotation, large-arc-flag, sweep-flag, end x, end y |
| `Z`/`z` | 0 | Close path |

Both cases share the same arg count; case determines coordinate interpretation (uppercase = absolute, lowercase = relative-to-pen).

### Parser rules

- Number tokens match `/-?\d+\.?\d*(?:[eE][-+]?\d+)?/` plus bare `.5`-style leading-decimal numbers
- Sign changes act as number separators (`M-5-10` → tokens `M`, `-5`, `-10`)
- Commas and whitespace both separate tokens; mixed separators accepted
- Implicit command repetition after M/m: trailing coordinate pairs become L/l commands respectively
- Implicit command repetition for other commands: repeats the same command
- Malformed input returns empty array; caller emits empty handles

### Endpoint computation

`_computePathEndpoints(commands)` walks the command list tracking pen position. Returns an array aligned with `commands`; each entry is `{x, y}` (absolute endpoint) or `null` (for Z).

| Command | Endpoint source |
|---|---|
| M, L, T | `args[0..1]` |
| H | `args[0]`, pen y |
| V | pen x, `args[0]` |
| C | `args[4..5]` |
| S, Q | `args[2..3]` |
| A | `args[5..6]` |
| Z | null; pen returns to subpath start |

Relative commands: args add to pen position to produce the absolute endpoint.

### Control-point computation

`_computePathControlPoints(commands)` returns control points aligned with commands:

| Command | Control points |
|---|---|
| C | Two CPs at `args[0..1]` and `args[2..3]` |
| S | One CP at `args[0..1]` (first CP is reflected from previous command, not draggable) |
| Q | One CP at `args[0..1]` |
| T | None (reflected control) |
| All others | null |

### Path resize dispatch

`_applyPathEndpointResize(el, o, role, dx, dy)` dispatches on role:

- `p{N}` roles mutate the Nth command's endpoint args per the endpoint table above
- `c{N}-{K}` roles mutate control-point args: C with K=1 → args[0..1], C with K=2 → args[2..3], S/Q with K=1 → args[0..1]
- Arc (A) endpoint drag: only args[5..6] mutate; shape parameters (rx, ry, rotation, flags) unchanged
- H/V endpoint drag: only the relevant axis mutates; off-axis delta ignored
- Relative-form drag: args are pen-relative deltas; adding the drag delta to args shifts the effective endpoint by exactly that delta
- Malformed role or out-of-range index: silent no-op

## Coordinate math

Three coordinate systems; translation uses native browser APIs:

1. **Screen coordinates** — raw `clientX`/`clientY` from pointer events
2. **SVG root coordinates** — the viewBox coordinate space
3. **Element-local coordinates** — inside the element's ancestor-group transforms

### Screen → SVG

```
pt = svg.createSVGPoint()
pt.x = screenX
pt.y = screenY
svgPt = pt.matrixTransform(svg.getScreenCTM().inverse())
```

### Element-local → SVG root

```
ctm = el.getCTM()            // local → screen
svgCtm = svg.getCTM()        // svg root → screen
m = svgCtm.inverse().multiply(ctm)
rootPt = { x: m.a*lx + m.c*ly + m.e, y: m.b*lx + m.d*ly + m.f }
```

### Handle size constancy

```
_screenDistToSvgDist(screenDist) {
  const a = this._screenToSvg(0, 0);
  const b = this._screenToSvg(screenDist, 0);
  return Math.abs(b.x - a.x);
}

_getHandleRadius() {
  return this._screenDistToSvgDist(HANDLE_SCREEN_RADIUS);
}
```

Called on every handle render so handles stay ~6px on screen regardless of zoom.

## Inline text edit commit

Double-clicking a `<text>` element opens a `<foreignObject>` textarea overlay; Enter commits, Escape cancels. Both paths flatten the element's children (replacing any `<tspan>` structure with a single text node carrying the new string). Two byte-level fixups run on the parent `<text>` element before the flatten, both required to preserve visible positioning when the originating SVG used non-trivial text layout (common in SVGs derived from PDF, Inkscape, or PowerPoint).

### Tspan attribute promotion

If the parent `<text>` does not declare a positioning or styling attribute that its first child `<tspan>` does, the attribute is copied from the tspan up to the parent before the children are removed. Without this step, text positioned via `<text><tspan x="100" y="50">…</tspan></text>` (parent has no `x`/`y` of its own) would drop to the SVG origin (0,0) after the tspans are deleted.

Promoted attributes (only when absent on the parent):

| Attribute | Reason |
|---|---|
| `x`, `y` | Position |
| `dx`, `dy` | Position offsets |
| `text-anchor` | Horizontal alignment |
| `fill` | Color (sometimes only declared on the tspan) |

Same logic applied on cancel, so an Escape after double-click never relocates the text even though it also flattens children.

### List-valued positioning collapse

SVG permits `x`, `y`, `dx`, `dy` to be whitespace-separated lists, where each value positions one glyph. PDF-to-SVG converters frequently emit pre-computed kerning this way — e.g. `x="37.786 66.32031 101.76848 137.80255 152.91928 181.04344 196.27736 230.61228 263.77537 297.28999"` for the 10 glyphs of `"Topic XYZ "`.

When the user edits the content (e.g. to `"Software"`, 8 glyphs), the original list misaligns:

- Glyph count > list length → trailing glyphs collapse to the last position (or to the parent's default)
- Glyph count < list length → trailing list values ignored
- Glyph count == list length → positions are reused against the wrong glyphs (an `x` calibrated for `T` is now applied to `S`)

The result is visibly broken kerning. To fix this, after the tspan-attribute promotion and before the children are removed, each of `x`, `y`, `dx`, `dy` on the parent is inspected. When:

1. The attribute value contains more than one whitespace-separated number, AND
2. The number of values does not equal the new content's character count

the attribute is collapsed to just its first value. The text then starts at the original anchor point and the font's natural metrics control subsequent glyph spacing.

Exact-length matches are left intact — the assumption is that a list whose length still matches the new content was authored deliberately and should be preserved.

This collapse runs only on commit (the cancel path restores the original content, whose length always matches the original list, so collapse would be a no-op).

## Auto-generated ID filter

The SVG extractor (also shared by the editor for label inference) filters IDs matching this regex as auto-generated (by Inkscape, Illustrator, etc.) and treats them as "no label":

```
/^(g|group|path|rect|text|layer)(_?)\d+$/i
```

Matches: `Group_42`, `g123`, `path_5`, `layer12`. These IDs are ignored; the algorithm falls through to single-text inference or neutral identifier.

## Marquee visual feedback

Marquee rectangle appearance distinguishes containment from crossing mode:

| Direction | Fill opacity | Stroke | Dash | Meaning |
|---|---|---|---|---|
| Forward (left→right AND top→bottom) | 12% accent blue | Solid accent blue | None | Containment — only elements fully inside are selected |
| Reverse (any other direction) | 10% accent green | Dashed accent green | 4px on / 3px off | Crossing — any element the marquee touches or intersects is selected |

Stroke width and dash lengths scale inversely with zoom (via `_screenDistToSvgDist`) to maintain consistent screen-pixel appearance.

Forward mode requires BOTH x and y deltas to be positive (top-left to bottom-right); anything else is crossing. This matches CAD conventions (AutoCAD, Inkscape) that users may have muscle memory for.

### Marquee hit-test depth

Marquee hit testing scans:

1. Direct children of the root `<svg>` element
2. One level of children inside `<g>` groups

Deeper nesting is NOT scanned — elements inside nested groups must be selected by clicking the group. This keeps the hit-test O(direct-children) rather than O(total-tree) for large SVGs.

## Copy-as-PNG pipeline

Renders the current modified SVG to a PNG via canvas:

| Step | Detail |
|---|---|
| Intrinsic dimensions | From viewBox or width/height; defaults to 1920×1080 when unparseable |
| Scale factor | 2× for SVGs where max dimension ≥ 1024px; up to 4× for smaller SVGs |
| Maximum output dimension | 4096px on longest side (prevents accidental giant images) |
| Background fill | White (SVGs often have transparent backgrounds) |
| Clipboard write | `ClipboardItem` with a promise-of-blob (preserves user-gesture context across the async scaling step) |
| Download fallback | When `navigator.clipboard.write` unavailable or fails, synthesizes `<a download>` click |
| Download filename | Source filename with `.svg` → `.png` |

## Keyboard-shortcut focus guard

Document-level keyboard shortcuts (Ctrl+C/V/D/Z, Delete, Backspace) defer to the focused editable field:

```
const activeEl = document.activeElement;
if (activeEl && (
  activeEl.tagName === 'INPUT' ||
  activeEl.tagName === 'TEXTAREA' ||
  activeEl.tagName === 'SELECT' ||
  activeEl.isContentEditable
)) {
  return;  // let the input handle the key
}
```

Escape is the one exception — it clears SVG selection regardless of focus, because Escape is a universal "dismiss" gesture and the editor's selection is the most visible thing to dismiss.

## Cross-references

- Behavioral specification (interaction modes, synchronization, invariants): `specs4/5-webapp/svg-viewer.md`
- Pan/zoom contract — read-only editor flag, silent-write mutex, viewBox authority: `specs4/5-webapp/svg-viewer.md` § Synchronized Pan/Zoom
- SVG↔text mode toggle event: `specs4/5-webapp/diff-viewer.md` § ~~~SVG ↔ Text Diff Mode Toggle~~~ (and reciprocal on this spec's parent)
- Doc index SVG extractor (shares auto-ID filter, long-text threshold, geometric containment model): `specs4/2-indexing/document-index.md` § SVG Extraction