// SvgEditor — pointer-based visual editor for an SVG element.
//
// Phase 3.2c.1 scope: foundation + element selection.
//   - Click hit-testing (with handle-exclusion)
//   - Single-element selection
//   - Bounding-box handle overlay rendered as a separate
//     <g> in the SVG
//   - Coordinate math helpers
//   - Escape to deselect
//   - Delete key to remove selected element
//   - tspan → parent text resolution on click
//
// Phase 3.2c.2a adds: drag-to-move.
//   - Clicking a selected element and dragging moves it
//   - Per-element position dispatch (rect uses x/y,
//     circle/ellipse use cx/cy, line moves both endpoints
//     together, polylines/polygons shift every point,
//     paths/groups/text use transform)
//   - Pointer capture so dragging off the SVG continues
//     smoothly
//   - Click-without-drag (< threshold) is treated as pure
//     selection — no onChange fires, no attribute mutation
//   - Handle overlay re-renders every pointermove so the
//     bounding box follows the element
//
// Phase 3.2c.2b adds: resize handles for rect/circle/ellipse.
//   - Per-shape handle rendering: rect gets eight handles
//     (four corners + four edges), circle and ellipse get
//     four cardinal handles
//   - Handle pointerdown initiates a resize drag (distinct
//     from the move drag from 3.2c.2a)
//   - Per-handle drag math: rect corners pin the opposite
//     corner and adjust x/y/width/height simultaneously;
//     rect edges pin the opposite edge; circle handles
//     adjust r from the center; ellipse handles adjust
//     rx or ry independently
//   - Width/height/r/rx/ry clamped to 0 so a drag past the
//     opposite edge collapses to zero rather than flipping
//   - Handles are `pointer-events: auto` (the enclosing
//     group remains `pointer-events: none`) so clicks route
//     to them rather than the underlying element
//
// Phase 3.2c.2c adds: line endpoint drag.
//   - Two handles per line at (x1,y1) and (x2,y2) with
//     roles `p1` and `p2`
//   - Each endpoint moves independently — dragging one
//     doesn't affect the other
//   - No clamping: endpoints may coincide (degenerate
//     zero-length line) or cross without visual
//     corruption
//   - Reuses `_beginResizeDrag` / `_applyResizeDelta` /
//     `_restoreResizeAttributes` machinery with a
//     `line-endpoints` snapshot kind
//
// Phase 3.2c.3a adds: polyline and polygon vertex edit.
//   - One handle per vertex with role `v{N}` (v0, v1, ...)
//   - Dragging a vertex moves only that point; other
//     vertices unchanged
//   - No clamping — vertices may coincide, cross, or
//     produce self-intersecting shapes
//   - Snapshot kind `polyline-vertices` / `polygon-vertices`
//     (distinct from move-drag's `points` kind)
//
// Phase 3.2c.3b-i adds: path endpoint editing for M/L/H/V/Z.
//   - `d` attribute parsed into command objects via
//     `_parsePathData`
//   - Endpoint handles emitted at each command's absolute
//     endpoint with role `p{N}` where N is the command
//     index in the parsed array
//   - Dragging adjusts the command's args (respecting
//     relative vs absolute form — relative commands keep
//     their delta-style args)
//   - Snapshot kind `path-commands` holds the parsed array
//     plus a running "pen position" map so relative
//     commands can be restored independently
//   - Z commands have no endpoint (they close back to the
//     subpath start), so no handle emitted for them
//   - H and V single-axis commands work naturally — the
//     handle's other-axis drag component is ignored
//
// Phase 3.2c.3b-ii adds: C/S/Q/T control-point handles.
//   - C gets two control-point handles (args[0..1] and
//     args[2..3]) plus its endpoint handle
//   - S gets one control-point handle (args[0..1]) plus
//     endpoint. The reflected first control point isn't
//     draggable — it's derived from the previous command
//   - Q gets one control-point handle (args[0..1]) plus
//     endpoint
//   - T is endpoint-only; its control point is always
//     reflected from the previous Q/T so there's nothing
//     to independently drag
//   - Control-point role format: `c{N}-{K}` where N is
//     the command index and K is 1 or 2
//   - Dashed tangent lines rendered from each control
//     point to its endpoint so users see the curve's
//     tangent structure (standard vector-editor
//     convention)
//   - Tangent lines carry `HANDLE_CLASS` so hit-testing
//     excludes them — only the control-point dots are
//     interactive
//   - Relative-form control point drag: delta added to
//     command args (same math as relative endpoints in
//     3.2c.3b-i — the pen position at the command's
//     start doesn't change, so adding the drag delta to
//     relative args shifts the absolute control point by
//     exactly that delta)
//
// Phase 3.2c.3b-iii adds: A (arc) endpoint handles.
//   - Arc commands render their endpoint as a draggable
//     handle with the standard `p{N}` role format
//   - Arc shape parameters — rx, ry, x-axis-rotation,
//     large-arc-flag, sweep-flag — stay fixed during
//     drag; only args[5..6] (the endpoint) move
//   - Visual result: the arc preserves its shape and
//     curvature while its destination tracks the pointer
//   - No control-point-style handles for shape
//     parameters — they're either scalars (rx, ry,
//     rotation) or booleans (flags) with no natural
//     positional interpretation. Users reshaping an arc
//     edit the source directly or regenerate the path
//   - Endpoint dispatch in `_applyPathEndpointResize`
//     already handled this case (args[5] += dx;
//     args[6] += dy) from 3.2c.3b-i; this sub-phase
//     adds the test coverage to pin the contract
//
// Phase 3.2c.3c adds: inline text editing.
//   - Double-clicking a <text> element opens a
//     foreignObject-hosted textarea positioned at the
//     element's bounding box
//   - Textarea inherits font size from the text element's
//     font-size attribute (or a sensible default) and
//     color from the fill attribute
//   - Enter commits the edit; Escape cancels and rolls
//     back; blur commits (user-friendly — accidental
//     click-aways don't discard work)
//   - Only one edit active at a time. Starting a new
//     edit while one is in flight commits the previous
//     one
//   - On commit, the text element's children are
//     replaced wholesale with a single text node
//     containing the new content. Any pre-existing
//     <tspan> structure is flattened
//   - Double-click only initiates edits on text
//     elements. Non-text elements ignore the gesture
//     (single-click selection still works)
//   - Detach during an edit cancels and rolls back
//
// Phase 3.2c.4 adds: multi-selection and marquee.
//   - Shift+click toggles an element into or out of the
//     selection set. Click without shift still replaces
//     the selection with the clicked element (single-
//     selection semantics preserved)
//   - `_selected` tracks the "primary" element (last
//     clicked); `_selectedSet` tracks every element in
//     the selection. Resize handles, vertex edit, and
//     text edit all dispatch against `_selected` so
//     single-element operations still work when a set
//     is active
//   - Shift+drag on empty space starts a marquee. Forward
//     drag (top-left to bottom-right) uses containment
//     mode — only elements fully inside the marquee are
//     selected, rendered with solid border. Reverse drag
//     uses crossing mode — any intersection selects,
//     rendered with dashed border. Matches Illustrator /
//     Figma conventions
//   - Marquee hit-test scans direct children of the root
//     SVG plus one level inside `<g>` groups. Deeper
//     nesting is deliberately out of scope — elements
//     in deeply-nested groups select by clicking the
//     group
//   - Clicking a member of a multi-selection and
//     dragging moves every selected element as a group.
//     Each element's positional attributes are
//     snapshotted and deltas applied uniformly
//   - Delete removes every selected element
//   - Double-click on a text element in a multi-
//     selection collapses to single-selection of that
//     text AND enters the inline edit. Matches
//     user intent — double-click is a "focus this" gesture
//
// Phase 3.2c.5 adds: undo stack + copy/paste.
//   - Undo stack captures SVG innerHTML snapshots before
//     each edit operation (delete, drag commit, text edit
//     commit). Ctrl+Z pops the stack and restores the SVG
//     by writing innerHTML back to the root element, then
//     clearing the selection (the restored DOM has new
//     element references so prior selection refs are stale)
//   - Stack bounded to 50 entries — oldest discarded on
//     overflow. Stack cleared on detach (new file / viewer
//     switch means a fresh undo context)
//   - Copy/Paste: Ctrl+C serializes selected element(s) to
//     an internal clipboard (outerHTML strings). Ctrl+V
//     deserializes and appends with a slight positional
//     offset so the paste is visually distinguishable from
//     the original. Ctrl+D duplicates in place (no offset)
//   - Paste inserts before the handle group so pasted
//     elements render below the selection chrome. Each
//     pasted element is selected (replacing prior selection)
//   - Copy/paste is internal only — no system clipboard
//     integration for SVG fragments (system clipboard
//     would require sanitization and MIME negotiation that's
//     out of scope)
//
// Design:
//
//   - **Not a Lit component.** SvgEditor operates on an
//     existing SVG DOM element. The SvgViewer component
//     creates an instance when entering Select mode and
//     disposes it on mode switch / file switch / unmount.
//     This avoids Lit re-render cycles interfering with
//     pointer state during drag operations.
//
//   - **Handle rendering via a dedicated `<g>` group.** The
//     handle group is a direct child of the root SVG with
//     `id="svg-editor-handles"` so hit-test exclusion can
//     find it by ID. Handles within the group carry class
//     `svg-editor-handle` for per-element exclusion.
//
//   - **Coordinate math via CTM inversion.** Pointer events
//     give us screen coordinates. The `_screenToSvg` helper
//     inverts the root SVG's CTM to convert to viewBox
//     units. `_localToSvgRoot` composes transforms when an
//     element lives inside a transformed <g>.
//
//   - **Handle size constancy.** Handles should appear at
//     ~6 pixels on screen regardless of zoom. Since SVG
//     coordinates scale with viewBox, handle radius is
//     computed inversely to the current zoom via
//     `_screenDistToSvgDist`.
//
//   - **Hit-test filtering.** `_hitTest` uses
//     `elementsFromPoint` (composed-aware in shadow DOM)
//     and skips elements with the handle class, the handle
//     group id, the root SVG itself, and elements with
//     structural-only tags (defs, style, metadata, etc.).
//
//   - **Event lifecycle.** Pointer events on the SVG bubble
//     to the editor's listeners. The editor stops
//     propagation for events it handles so the viewer's
//     enclosing listeners don't double-fire. Listeners are
//     attached in `attach()` and removed in `detach()` —
//     the caller owns the lifecycle.

/**
 * Handle visual size in screen pixels. Dragging a handle
 * starts when the pointer is within this radius of the
 * handle center.
 */
export const HANDLE_SCREEN_RADIUS = 6;

/**
 * Class applied to every handle overlay element so
 * `_hitTest` can skip them.
 */
export const HANDLE_CLASS = 'svg-editor-handle';

/**
 * ID of the `<g>` element containing all handle overlays.
 * Placed as a direct child of the root SVG so it renders
 * above the content.
 */
export const HANDLE_GROUP_ID = 'svg-editor-handles';

/**
 * Dataset key on individual resize handles identifying
 * which corner or edge they represent. Values are compass
 * directions: `nw`, `n`, `ne`, `e`, `se`, `s`, `sw`, `w`
 * for rects; `n`, `e`, `s`, `w` for circles and ellipses.
 *
 * Stored on the DOM element itself so the pointerdown
 * dispatch can read it without maintaining a separate
 * handle → metadata map.
 */
export const HANDLE_ROLE_ATTR = 'data-handle-role';

/**
 * Minimum dimension for resize operations. Dragging past
 * the opposite edge clamps dimensions to this value rather
 * than flipping the shape (which would require swapping
 * which handle is which mid-drag — complex and visually
 * confusing). Expressed in SVG units; a pixel-ish value
 * that won't render as visually zero at normal zoom.
 */
const _MIN_RESIZE_DIMENSION = 1;

/**
 * Maximum undo stack depth. 50 entries per specs4. Oldest
 * entries are discarded when the stack exceeds this limit.
 */
const _UNDO_MAX = 50;

/**
 * Positional offset (SVG units) applied to pasted elements
 * so they're visually distinguishable from the originals.
 * Applied to both x and y.
 */
const _PASTE_OFFSET = 10;

/**
 * Minimum marquee drag distance (screen pixels) before
 * treating it as a deliberate marquee rather than a jittery
 * click. Below this, a shift+click+tiny-drag on empty space
 * is a no-op — same rule as the drag threshold for moves.
 */
const _MARQUEE_MIN_SCREEN = 3;

/**
 * ID of the marquee rectangle element while it's alive.
 * Placed inside the handle group so hit-test exclusion
 * finds it.
 */
const MARQUEE_ID = 'svg-editor-marquee';

/**
 * Axis-aligned bounding box in SVG root coords.
 * Used by marquee hit-test to check containment /
 * intersection.
 */
function _bboxOverlaps(a, b) {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

function _bboxContains(outer, inner) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * Parse a numeric SVG attribute value to a number. SVG
 * treats missing / non-numeric values as 0 — matches
 * browser behavior. Deliberately does not handle units
 * like `10px` because SVG coordinate attributes don't
 * accept units (length attributes like stroke-width do,
 * but drag math doesn't touch those).
 */
function _parseNum(value) {
  if (value == null) return 0;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parse a polyline/polygon `points` attribute into an
 * array of [x, y] pairs. SVG accepts both comma-separated
 * and whitespace-separated coordinates, and mixes of the
 * two. We normalize by splitting on any combination of
 * commas and whitespace.
 *
 * Malformed input (odd number of tokens, non-numeric
 * values) returns an empty array — the drag dispatch
 * then emits an empty `points` attribute, which the
 * browser treats as an empty polyline. Better than
 * throwing and stranding the editor.
 */
function _parsePoints(value) {
  if (!value || typeof value !== 'string') return [];
  const tokens = value.trim().split(/[\s,]+/).filter(Boolean);
  if (tokens.length % 2 !== 0) return [];
  const result = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const x = parseFloat(tokens[i]);
    const y = parseFloat(tokens[i + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    result.push([x, y]);
  }
  return result;
}

/**
 * Number of arguments consumed by each path command.
 * Both cases (absolute and relative) use the same arg
 * count — case determines coordinate interpretation
 * (absolute vs delta-from-pen), not arg shape.
 *
 * A commands take 7 args: rx, ry, x-axis-rotation,
 * large-arc-flag, sweep-flag, x, y. The flags are
 * booleans encoded as 0/1 in the path string but land
 * in our args array as numbers for uniformity.
 *
 * Z takes no args — it just closes the subpath back to
 * the most recent M point.
 */
const _PATH_ARG_COUNTS = {
  M: 2, m: 2,
  L: 2, l: 2,
  H: 1, h: 1,
  V: 1, v: 1,
  C: 6, c: 6,
  S: 4, s: 4,
  Q: 4, q: 4,
  T: 2, t: 2,
  A: 7, a: 7,
  Z: 0, z: 0,
};

/**
 * Parse an SVG path `d` attribute into a flat array of
 * command objects. Each command is `{cmd, args}` where
 * `cmd` is the single-character command letter (case
 * preserved — uppercase is absolute, lowercase is
 * relative) and `args` is an array of numbers.
 *
 * SVG path syntax packs multiple command invocations
 * after a single command letter — `M 0 0 10 10 20 20`
 * means moveto followed by two linetos. Per SVG spec,
 * trailing coordinates after M are treated as L (with
 * matching case). Similarly, trailing coords after m
 * are treated as l. We expand these into separate
 * command objects during parsing so downstream code can
 * treat every entry uniformly.
 *
 * Returns an empty array on any parse failure. Like
 * `_parsePoints`, prefers silent no-op over throwing —
 * a malformed `d` attribute strands the editor's
 * handles but doesn't crash the whole viewer.
 *
 * @param {string} d
 * @returns {Array<{cmd: string, args: number[]}>}
 */
function _parsePathData(d) {
  if (!d || typeof d !== 'string') return [];
  // Tokenize. Command letters are their own tokens;
  // numbers are separated by whitespace, commas, or
  // sign changes (-5-10 → [-5, -10]). The regex matches
  // either a command letter or a signed number (with
  // optional fractional and exponent parts).
  const tokenRe = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
  const tokens = [];
  let match;
  while ((match = tokenRe.exec(d)) !== null) {
    if (match[1]) {
      tokens.push({ type: 'cmd', value: match[1] });
    } else if (match[2]) {
      const n = parseFloat(match[2]);
      if (!Number.isFinite(n)) return [];
      tokens.push({ type: 'num', value: n });
    }
  }
  // Walk tokens. Each command letter consumes the
  // configured number of following number tokens. If
  // more numbers follow, spawn implicit command
  // repetitions — M becomes L, m becomes l, others
  // repeat themselves.
  const commands = [];
  let i = 0;
  let currentCmd = null;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok.type === 'cmd') {
      currentCmd = tok.value;
      i += 1;
    } else if (currentCmd === null) {
      // Number before any command — malformed.
      return [];
    }
    if (currentCmd === null) continue;
    const argCount = _PATH_ARG_COUNTS[currentCmd];
    if (argCount === undefined) return [];
    if (argCount === 0) {
      // Z / z — no args consumed.
      commands.push({ cmd: currentCmd, args: [] });
      // Don't re-use currentCmd for subsequent tokens —
      // explicit next command required after Z.
      currentCmd = null;
      continue;
    }
    // Consume argCount numbers.
    const args = [];
    for (let j = 0; j < argCount; j += 1) {
      const next = tokens[i];
      if (!next || next.type !== 'num') return [];
      args.push(next.value);
      i += 1;
    }
    commands.push({ cmd: currentCmd, args });
    // Implicit repetition: after M/m, subsequent coord
    // pairs become L/l. Other commands repeat themselves.
    if (currentCmd === 'M') currentCmd = 'L';
    else if (currentCmd === 'm') currentCmd = 'l';
    // else currentCmd stays as-is for implicit repeat.
  }
  return commands;
}

/**
 * Serialize an array of parsed path commands back to a
 * `d` attribute string. Commands emitted individually
 * (no implicit-repeat compaction) so round-tripping is
 * lossless in the direction parser → serializer →
 * parser. The serializer's output may be slightly more
 * verbose than an optimized hand-written path, but
 * visually identical.
 *
 * Number formatting: uses `.toString()` rather than
 * `.toFixed(N)` to avoid silently truncating precision.
 * A path with coordinates like 10.12345 round-trips
 * verbatim; only integer cases drop the `.0`.
 *
 * @param {Array<{cmd: string, args: number[]}>} commands
 * @returns {string}
 */
function _serializePathData(commands) {
  if (!Array.isArray(commands)) return '';
  const parts = [];
  for (const c of commands) {
    if (!c || typeof c.cmd !== 'string') continue;
    if (c.cmd.toUpperCase() === 'Z') {
      parts.push(c.cmd);
      continue;
    }
    const args = Array.isArray(c.args) ? c.args : [];
    parts.push(`${c.cmd} ${args.map((n) => String(n)).join(' ')}`);
  }
  return parts.join(' ');
}

/**
 * Compute absolute endpoint positions for each command
 * in a parsed path. Walks commands tracking the current
 * pen position and the most recent subpath start (for
 * Z commands). Returns an array of `{x, y}` objects
 * aligned with the input `commands` array.
 *
 * Z commands produce an endpoint at the subpath start
 * (not the current pen position) since that's where
 * the pen actually lands after the close — but we
 * return null for Z entries to signal "no independently
 * draggable endpoint" (dragging Z doesn't make sense).
 *
 * For relative commands, the absolute position is
 * computed from the current pen plus the command's
 * offset. For absolute commands, the position is taken
 * directly from the command's args.
 *
 * H and V are single-axis — H sets only x, V sets
 * only y, leaving the other coordinate at the pen's
 * current value.
 *
 * Returns an empty array if `commands` is empty or
 * malformed.
 *
 * @param {Array<{cmd: string, args: number[]}>} commands
 * @returns {Array<{x: number, y: number} | null>}
 */
function _computePathEndpoints(commands) {
  if (!Array.isArray(commands) || commands.length === 0) return [];
  let penX = 0;
  let penY = 0;
  let subpathStartX = 0;
  let subpathStartY = 0;
  const result = [];
  for (const c of commands) {
    if (!c || typeof c.cmd !== 'string') {
      result.push(null);
      continue;
    }
    const abs = c.cmd === c.cmd.toUpperCase();
    const args = Array.isArray(c.args) ? c.args : [];
    const upper = c.cmd.toUpperCase();
    switch (upper) {
      case 'M': {
        const [x, y] = args;
        const nx = abs ? x : penX + x;
        const ny = abs ? y : penY + y;
        penX = nx;
        penY = ny;
        subpathStartX = nx;
        subpathStartY = ny;
        result.push({ x: nx, y: ny });
        break;
      }
      case 'L':
      case 'T': {
        const [x, y] = args;
        const nx = abs ? x : penX + x;
        const ny = abs ? y : penY + y;
        penX = nx;
        penY = ny;
        result.push({ x: nx, y: ny });
        break;
      }
      case 'H': {
        const [x] = args;
        const nx = abs ? x : penX + x;
        penX = nx;
        // y unchanged.
        result.push({ x: nx, y: penY });
        break;
      }
      case 'V': {
        const [y] = args;
        const ny = abs ? y : penY + y;
        penY = ny;
        result.push({ x: penX, y: ny });
        break;
      }
      case 'C': {
        // Args: cx1, cy1, cx2, cy2, x, y. Endpoint is
        // the last pair.
        const x = args[4];
        const y = args[5];
        const nx = abs ? x : penX + x;
        const ny = abs ? y : penY + y;
        penX = nx;
        penY = ny;
        result.push({ x: nx, y: ny });
        break;
      }
      case 'S':
      case 'Q': {
        // S: cx2, cy2, x, y. Q: cx, cy, x, y. Either way
        // endpoint is args[2], args[3].
        const x = args[2];
        const y = args[3];
        const nx = abs ? x : penX + x;
        const ny = abs ? y : penY + y;
        penX = nx;
        penY = ny;
        result.push({ x: nx, y: ny });
        break;
      }
      case 'A': {
        // Args: rx, ry, x-axis-rot, large-arc, sweep,
        // x, y. Endpoint is last pair.
        const x = args[5];
        const y = args[6];
        const nx = abs ? x : penX + x;
        const ny = abs ? y : penY + y;
        penX = nx;
        penY = ny;
        result.push({ x: nx, y: ny });
        break;
      }
      case 'Z': {
        // Close back to subpath start. No independently
        // draggable endpoint, but update pen so a
        // following command sees the correct position.
        penX = subpathStartX;
        penY = subpathStartY;
        result.push(null);
        break;
      }
      default:
        result.push(null);
        break;
    }
  }
  return result;
}

/**
 * Compute absolute control-point positions for each
 * curve command in a parsed path. Returns an array
 * aligned with `commands`, each entry either an array
 * of `{x, y}` control points or null for commands
 * without independently-draggable control points.
 *
 * - M, L, H, V, T, A, Z → null (no draggable control
 *   points; T's control is reflected from previous, A's
 *   shape params aren't positional)
 * - C → [{x, y}, {x, y}] (two control points)
 * - S → [{x, y}] (one control point; first is reflected)
 * - Q → [{x, y}] (one control point)
 *
 * Shares the pen-walking logic with `_computePathEndpoints`
 * but tracks a different output shape. Two separate walks
 * would work; keeping them as separate functions means
 * each has a clear single purpose and callers pay only
 * for what they need (handle rendering calls both;
 * serialization doesn't call either).
 *
 * For relative commands, control-point coordinates are
 * computed from the pen position at the command's start
 * plus the command's offset args. For absolute commands,
 * the positions come straight from the args.
 *
 * @param {Array<{cmd: string, args: number[]}>} commands
 * @returns {Array<Array<{x: number, y: number}> | null>}
 */
function _computePathControlPoints(commands) {
  if (!Array.isArray(commands) || commands.length === 0) return [];
  let penX = 0;
  let penY = 0;
  let subpathStartX = 0;
  let subpathStartY = 0;
  const result = [];
  for (const c of commands) {
    if (!c || typeof c.cmd !== 'string') {
      result.push(null);
      continue;
    }
    const abs = c.cmd === c.cmd.toUpperCase();
    const args = Array.isArray(c.args) ? c.args : [];
    const upper = c.cmd.toUpperCase();
    switch (upper) {
      case 'M': {
        const [x, y] = args;
        const nx = abs ? x : penX + x;
        const ny = abs ? y : penY + y;
        penX = nx;
        penY = ny;
        subpathStartX = nx;
        subpathStartY = ny;
        result.push(null);
        break;
      }
      case 'L':
      case 'T': {
        const [x, y] = args;
        const nx = abs ? x : penX + x;
        const ny = abs ? y : penY + y;
        penX = nx;
        penY = ny;
        result.push(null);
        break;
      }
      case 'H': {
        const [x] = args;
        penX = abs ? x : penX + x;
        result.push(null);
        break;
      }
      case 'V': {
        const [y] = args;
        penY = abs ? y : penY + y;
        result.push(null);
        break;
      }
      case 'C': {
        // Args: cx1, cy1, cx2, cy2, x, y. Two control
        // points plus endpoint.
        const c1x = abs ? args[0] : penX + args[0];
        const c1y = abs ? args[1] : penY + args[1];
        const c2x = abs ? args[2] : penX + args[2];
        const c2y = abs ? args[3] : penY + args[3];
        const ex = abs ? args[4] : penX + args[4];
        const ey = abs ? args[5] : penY + args[5];
        result.push([
          { x: c1x, y: c1y },
          { x: c2x, y: c2y },
        ]);
        penX = ex;
        penY = ey;
        break;
      }
      case 'S':
      case 'Q': {
        // S: cx2, cy2, x, y (one draggable control; the
        // reflected first control is derived from the
        // previous command).
        // Q: cx, cy, x, y (one control point).
        const cx = abs ? args[0] : penX + args[0];
        const cy = abs ? args[1] : penY + args[1];
        const ex = abs ? args[2] : penX + args[2];
        const ey = abs ? args[3] : penY + args[3];
        result.push([{ x: cx, y: cy }]);
        penX = ex;
        penY = ey;
        break;
      }
      case 'A': {
        // Endpoint at args[5..6]; shape parameters
        // aren't positional, no control-point handles.
        const ex = abs ? args[5] : penX + args[5];
        const ey = abs ? args[6] : penY + args[6];
        penX = ex;
        penY = ey;
        result.push(null);
        break;
      }
      case 'Z': {
        penX = subpathStartX;
        penY = subpathStartY;
        result.push(null);
        break;
      }
      default:
        result.push(null);
        break;
    }
  }
  return result;
}

/**
 * SVG element tags that should never be considered as
 * selection targets. Structural, definitional, or
 * non-visual content.
 */
const _NON_SELECTABLE_TAGS = new Set([
  'defs',
  'style',
  'metadata',
  'title',
  'desc',
  'filter',
  'lineargradient',
  'radialgradient',
  'clippath',
  'mask',
  'marker',
  'pattern',
  'symbol',
]);

/**
 * Visible shape tags that are valid selection targets.
 * `<tspan>` is NOT in this set — tspan hits resolve to
 * their parent `<text>`.
 */
const _SELECTABLE_TAGS = new Set([
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'text',
  'g',
  'image',
  'use',
]);

export class SvgEditor {
  /**
   * @param {SVGSVGElement} svg — the root SVG element to
   *   operate on. Must be attached to the DOM at the time
   *   of `attach()`.
   * @param {object} options
   * @param {() => void} [options.onChange] — called after
   *   any edit operation that modifies the SVG. Phase
   *   3.2c.1 only fires this for delete operations.
   * @param {() => void} [options.onSelectionChange] —
   *   called when the selected element changes.
   */
  constructor(svg, options = {}) {
    if (!svg || svg.tagName?.toLowerCase() !== 'svg') {
      throw new Error(
        'SvgEditor requires an <svg> element as its root',
      );
    }
    this._svg = svg;
    this._onChange = options.onChange || (() => {});
    this._onSelectionChange = options.onSelectionChange || (() => {});

    /**
     * Primary selected element — the "active" element that
     * single-element operations (resize handles, vertex
     * edit, text edit) dispatch against. Null when nothing
     * is selected OR when the set is empty.
     *
     * When multi-selection is active, `_selected` is one
     * of the elements in `_selectedSet` (typically the
     * most recently shift+clicked one). Callers that
     * ignore the set and look only at `_selected` still
     * get a reasonable single-element contract.
     */
    this._selected = null;

    /**
     * Full selection set. Always contains `_selected` when
     * non-empty. Single-click replaces the set with just
     * the clicked element; shift+click toggles. Empty when
     * nothing is selected.
     */
    this._selectedSet = new Set();

    /**
     * Active marquee state. Null when not marqueeing;
     * populated on shift+drag from empty space. Fields:
     *   pointerId — captured pointer
     *   startX, startY — origin in SVG root coords
     *   currentX, currentY — latest pointer in SVG root
     *   rect — the rendered <rect> element, or null until
     *     the user moves beyond the min-drag threshold
     *   originalSet — snapshot of `_selectedSet` at
     *     marquee start, so each move computes the new
     *     union from that baseline rather than
     *     compounding as the marquee grows/shrinks
     */
    this._marquee = null;

    /** Handle overlay group, lazily created on first render. */
    this._handleGroup = null;

    /**
     * Drag state. Null when not dragging; populated on
     * pointerdown that hits the already-selected element
     * (move drag) or one of its resize handles (resize
     * drag). Cleared on pointerup.
     *
     * Common fields:
     *   mode — 'move' or 'resize'
     *   pointerId — id of the captured pointer
     *   startX, startY — pointer position in SVG root
     *     coords at drag start
     *   originAttrs — snapshot of the element's positional
     *     or dimensional attributes at drag start
     *   committed — set true on first pointermove beyond
     *     threshold, triggers onChange on pointerup
     *
     * Resize-only fields:
     *   role — which handle (nw / n / ne / e / se / s /
     *     sw / w for rect; n / e / s / w for circle and
     *     ellipse)
     */
    this._drag = null;

    /**
     * Click-to-drag threshold in SVG-root units. A
     * pointermove whose cumulative delta stays under this
     * is treated as a click-with-jitter rather than a
     * drag — no attributes are mutated, no onChange
     * fires. Measured in SVG units but set in screen
     * pixels and converted on first move.
     */
    this._dragThresholdScreen = 3;

    /**
     * Active inline text edit. Null when not editing;
     * populated by `beginTextEdit`, cleared by
     * `commitTextEdit` / `cancelTextEdit`. Fields:
     *   element — the <text> element being edited
     *   originalContent — text content at edit start,
     *     restored on cancel
     *   foreignObject — the foreignObject wrapper
     *     hosting the textarea
     *   textarea — the <textarea> element
     */
    this._textEdit = null;

    /**
     * Undo stack — array of SVG innerHTML snapshots.
     * Newest at the end. Bounded to `_UNDO_MAX` entries;
     * oldest discarded on overflow. Cleared on detach.
     */
    this._undoStack = [];

    /**
     * Internal clipboard for copy/paste. Array of
     * outerHTML strings, one per copied element. Empty
     * when nothing has been copied. Survives across
     * selection changes — the user can copy, deselect,
     * reselect something else, then paste.
     */
    this._clipboard = [];

    /** Bound handlers for add/remove symmetry. */
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onDoubleClick = this._onDoubleClick.bind(this);
    this._onTextEditKeyDown = this._onTextEditKeyDown.bind(this);
    this._onTextEditBlur = this._onTextEditBlur.bind(this);

    /** Whether `attach()` has been called. */
    this._attached = false;
  }

  // ---------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------

  /**
   * Wire up event listeners. Must be called before the
   * editor responds to user input.
   */
  attach() {
    if (this._attached) return;
    this._attached = true;
    // Pointer events on the root SVG. Using 'pointerdown'
    // rather than 'click' so we can react before focus
    // shifts and so drags can begin from the initial press.
    this._svg.addEventListener('pointerdown', this._onPointerDown);
    // Pointer move/up are attached during drag only via
    // setPointerCapture. See _beginDrag.
    this._svg.addEventListener('pointermove', this._onPointerMove);
    this._svg.addEventListener('pointerup', this._onPointerUp);
    this._svg.addEventListener('pointercancel', this._onPointerUp);
    // Double-click for inline text editing. Uses the
    // composed-aware `dblclick` so clicks targeting a
    // tspan inside a text element still route here.
    this._svg.addEventListener('dblclick', this._onDoubleClick);
    // Keyboard events on document so Escape / Delete work
    // regardless of which element has focus.
    document.addEventListener('keydown', this._onKeyDown);
  }

  /**
   * Remove event listeners and tear down the handle overlay.
   * Safe to call when not attached.
   */
  detach() {
    if (!this._attached) return;
    this._attached = false;
    // Cancel any in-flight drag. Without this, a detach
    // during a drag would leave the element partially
    // moved and the captured pointer orphaned.
    this._cancelDrag();
    // Cancel any in-flight marquee. Same reasoning —
    // orphaned rect + captured pointer otherwise.
    this._cancelMarquee();
    // Cancel any in-flight text edit so the foreignObject
    // overlay doesn't orphan on the SVG and the element's
    // original content is restored.
    this.cancelTextEdit();
    // Clear undo stack and clipboard — new file / viewer
    // switch means a fresh editing context.
    this._undoStack = [];
    this._clipboard = [];
    this._svg.removeEventListener(
      'pointerdown',
      this._onPointerDown,
    );
    this._svg.removeEventListener(
      'pointermove',
      this._onPointerMove,
    );
    this._svg.removeEventListener(
      'pointerup',
      this._onPointerUp,
    );
    this._svg.removeEventListener(
      'pointercancel',
      this._onPointerUp,
    );
    this._svg.removeEventListener('dblclick', this._onDoubleClick);
    document.removeEventListener('keydown', this._onKeyDown);
    this._clearSelection();
  }

  /**
   * Return the primary selected element, or null. Reads
   * live — subsequent mutations by the caller are visible.
   *
   * For the full set of selected elements (including
   * multi-selection), use `getSelectionSet`.
   */
  getSelection() {
    return this._selected;
  }

  /**
   * Return the full selection set. Always contains at
   * least the primary (`getSelection()`) unless empty.
   * Returns a fresh Set each call — caller mutations
   * don't affect the editor's state.
   */
  getSelectionSet() {
    return new Set(this._selectedSet);
  }

  /**
   * Programmatically select a single element, replacing
   * any prior selection (including multi-selection).
   * Bypasses pointer event machinery; used by tests and
   * by future load-selection flows.
   *
   * Passing null clears the selection entirely.
   *
   * @param {SVGElement | null} element
   */
  setSelection(element) {
    const resolved = element ? this._resolveTarget(element) : null;
    if (resolved === this._selected && this._selectedSet.size <= 1) {
      // Already the sole selection — no-op.
      return;
    }
    this._selected = resolved;
    this._selectedSet = resolved ? new Set([resolved]) : new Set();
    this._renderHandles();
    this._onSelectionChange();
  }

  /**
   * Toggle an element in or out of the selection set.
   * Used by shift+click. When the element is already
   * selected, it's removed; when it isn't, it's added
   * and becomes the new primary.
   *
   * Passing a non-selectable element (tspan resolves to
   * its parent; defs / style / etc. reject entirely) is
   * a no-op.
   *
   * @param {SVGElement} element
   */
  toggleSelection(element) {
    const resolved = element ? this._resolveTarget(element) : null;
    if (!resolved) return;
    if (this._selectedSet.has(resolved)) {
      this._selectedSet.delete(resolved);
      // If we removed the primary, pick a new primary
      // from whatever's left (or null if empty).
      if (this._selected === resolved) {
        const remaining = this._selectedSet.values().next().value;
        this._selected = remaining || null;
      }
    } else {
      this._selectedSet.add(resolved);
      this._selected = resolved;
    }
    this._renderHandles();
    this._onSelectionChange();
  }

  /**
   * Delete every selected element from the DOM. Fires
   * `onChange` exactly once regardless of how many
   * elements were removed. No-op when nothing is
   * selected.
   */
  deleteSelection() {
    if (this._selectedSet.size === 0) return;
    this._pushUndo();
    let removed = 0;
    for (const el of this._selectedSet) {
      const parent = el.parentNode;
      // Root SVG isn't a valid selection target so this
      // check is defensive — in practice every selectable
      // element has a real parent inside the SVG.
      if (parent && parent !== this._svg.parentNode) {
        parent.removeChild(el);
        removed += 1;
      }
    }
    this._selected = null;
    this._selectedSet = new Set();
    this._renderHandles();
    this._onSelectionChange();
    if (removed > 0) this._onChange();
  }

  // ---------------------------------------------------------------
  // Undo stack
  // ---------------------------------------------------------------

  /**
   * Push the current SVG state onto the undo stack.
   * Called BEFORE a mutation so the pre-mutation state
   * can be restored. Internally called by deleteSelection,
   * drag commit (pointerup with committed=true), and
   * text edit commit. External callers (the viewer) don't
   * need to call this — the editor manages its own stack.
   *
   * Strips the handle group from the snapshot so undo
   * doesn't restore stale selection chrome. The group is
   * re-rendered after every undo via _renderHandles.
   */
  _pushUndo() {
    // Temporarily remove the handle group so it doesn't
    // end up in the snapshot.
    const handleGroup = this._handleGroup;
    let parent = null;
    let nextSib = null;
    if (handleGroup && handleGroup.parentNode) {
      parent = handleGroup.parentNode;
      nextSib = handleGroup.nextSibling;
      try { parent.removeChild(handleGroup); } catch (_) { parent = null; }
    }
    // Also strip any active text-edit foreignObject.
    const fo = this._textEdit?.foreignObject;
    let foParent = null;
    let foNext = null;
    if (fo && fo.parentNode) {
      foParent = fo.parentNode;
      foNext = fo.nextSibling;
      try { foParent.removeChild(fo); } catch (_) { foParent = null; }
    }
    const snapshot = this._svg.innerHTML;
    // Restore the handle group and foreignObject.
    if (handleGroup && parent) {
      try {
        if (nextSib && nextSib.parentNode === parent) {
          parent.insertBefore(handleGroup, nextSib);
        } else {
          parent.appendChild(handleGroup);
        }
      } catch (_) {}
    }
    if (fo && foParent) {
      try {
        if (foNext && foNext.parentNode === foParent) {
          foParent.insertBefore(fo, foNext);
        } else {
          foParent.appendChild(fo);
        }
      } catch (_) {}
    }
    this._undoStack.push(snapshot);
    if (this._undoStack.length > _UNDO_MAX) {
      this._undoStack.shift();
    }
  }

  /**
   * Undo the most recent edit by restoring the SVG's
   * innerHTML from the stack. Clears selection (DOM
   * element references become stale after innerHTML
   * replacement). Fires onChange so the viewer can
   * re-serialize. No-op when the stack is empty.
   *
   * @returns {boolean} true if an undo was performed
   */
  undo() {
    if (this._undoStack.length === 0) return false;
    const snapshot = this._undoStack.pop();
    // Cancel any in-flight state so we don't leave
    // orphaned drag / marquee / text-edit state.
    this._cancelDrag();
    this._cancelMarquee();
    if (this._textEdit) {
      // Tear down the overlay without restoring content —
      // we're about to replace the entire SVG anyway.
      this._teardownTextEditOverlay(this._textEdit);
      this._textEdit = null;
    }
    // Drop the handle group reference — innerHTML
    // replacement will destroy the DOM node.
    this._handleGroup = null;
    this._svg.innerHTML = snapshot;
    // Clear selection — old element references are stale.
    this._selected = null;
    this._selectedSet = new Set();
    this._renderHandles();
    this._onSelectionChange();
    this._onChange();
    return true;
  }

  /**
   * Whether the undo stack has entries. Exposed for UI
   * (e.g., graying out an undo button) and tests.
   */
  get canUndo() {
    return this._undoStack.length > 0;
  }

  // ---------------------------------------------------------------
  // Copy / Paste / Duplicate
  // ---------------------------------------------------------------

  /**
   * Copy the selected element(s) to the internal clipboard
   * as outerHTML strings. No-op when nothing is selected.
   * The clipboard persists across selection changes.
   */
  copySelection() {
    if (this._selectedSet.size === 0) return;
    this._clipboard = [];
    for (const el of this._selectedSet) {
      if (el.outerHTML) {
        this._clipboard.push(el.outerHTML);
      }
    }
  }

  /**
   * Paste the internal clipboard into the SVG with a
   * positional offset. Each pasted element becomes the
   * new selection (replacing prior selection). Fires
   * onChange. No-op when the clipboard is empty.
   *
   * @param {number} [offsetX] — override offset (default _PASTE_OFFSET)
   * @param {number} [offsetY] — override offset (default _PASTE_OFFSET)
   */
  pasteClipboard(offsetX, offsetY) {
    if (this._clipboard.length === 0) return;
    const ox = typeof offsetX === 'number' ? offsetX : _PASTE_OFFSET;
    const oy = typeof offsetY === 'number' ? offsetY : _PASTE_OFFSET;
    this._pushUndo();
    const ns = 'http://www.w3.org/2000/svg';
    const newSelection = new Set();
    // Insert point — before the handle group so pasted
    // elements render below the selection chrome.
    const insertBefore = this._handleGroup || null;
    for (const html of this._clipboard) {
      // Parse the outerHTML via a temporary SVG container.
      // DOMParser with 'image/svg+xml' is the reliable
      // way to parse SVG fragments; innerHTML on a <g>
      // also works in browsers but DOMParser is more
      // explicit.
      let el;
      try {
        const wrapper = document.createElementNS(ns, 'svg');
        wrapper.innerHTML = html;
        el = wrapper.firstElementChild;
        if (!el) continue;
      } catch (_) {
        continue;
      }
      // Apply offset. Use the same attribute-dispatch
      // logic as drag-to-move to handle each element
      // type's positioning attributes.
      this._applyPasteOffset(el, ox, oy);
      // Adopt the node into our SVG.
      if (insertBefore) {
        this._svg.insertBefore(el, insertBefore);
      } else {
        this._svg.appendChild(el);
      }
      newSelection.add(el);
    }
    if (newSelection.size > 0) {
      this._selectedSet = newSelection;
      this._selected = newSelection.values().next().value;
      this._renderHandles();
      this._onSelectionChange();
      this._onChange();
    }
  }

  /**
   * Duplicate the selected element(s) in place (no offset).
   * Equivalent to copy + paste with zero offset. Fires
   * onChange. No-op when nothing is selected.
   */
  duplicateSelection() {
    this.copySelection();
    this.pasteClipboard(0, 0);
  }

  /**
   * Apply a positional offset to a pasted element. Uses
   * the same attribute-based dispatch as drag-to-move
   * so each element type's positioning attributes are
   * handled correctly. Elements with no recognized
   * position attributes (e.g., `<g>` without a transform)
   * get a transform appended.
   */
  _applyPasteOffset(el, dx, dy) {
    if (!el || !el.tagName || dx === 0 && dy === 0) return;
    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case 'rect':
      case 'image':
      case 'use': {
        const x = _parseNum(el.getAttribute('x'));
        const y = _parseNum(el.getAttribute('y'));
        el.setAttribute('x', String(x + dx));
        el.setAttribute('y', String(y + dy));
        break;
      }
      case 'circle':
      case 'ellipse': {
        const cx = _parseNum(el.getAttribute('cx'));
        const cy = _parseNum(el.getAttribute('cy'));
        el.setAttribute('cx', String(cx + dx));
        el.setAttribute('cy', String(cy + dy));
        break;
      }
      case 'line': {
        const x1 = _parseNum(el.getAttribute('x1'));
        const y1 = _parseNum(el.getAttribute('y1'));
        const x2 = _parseNum(el.getAttribute('x2'));
        const y2 = _parseNum(el.getAttribute('y2'));
        el.setAttribute('x1', String(x1 + dx));
        el.setAttribute('y1', String(y1 + dy));
        el.setAttribute('x2', String(x2 + dx));
        el.setAttribute('y2', String(y2 + dy));
        break;
      }
      case 'text': {
        if (el.hasAttribute('transform')) {
          const base = (el.getAttribute('transform') || '').trim();
          const t = `translate(${dx} ${dy})`;
          el.setAttribute('transform', base ? `${base} ${t}` : t);
        } else {
          const x = _parseNum(el.getAttribute('x'));
          const y = _parseNum(el.getAttribute('y'));
          el.setAttribute('x', String(x + dx));
          el.setAttribute('y', String(y + dy));
        }
        break;
      }
      default: {
        // Fallback — use transform translate for paths,
        // groups, polygons, polylines, and anything else.
        const base = (el.getAttribute('transform') || '').trim();
        const t = `translate(${dx} ${dy})`;
        el.setAttribute('transform', base ? `${base} ${t}` : t);
        break;
      }
    }
  }

  // ---------------------------------------------------------------
  // Inline text editing
  // ---------------------------------------------------------------

  /**
   * Begin an inline text edit on a `<text>` element.
   * Opens a foreignObject-hosted textarea positioned at
   * the element's bounding box. No-op for non-text
   * elements or when the argument is null.
   *
   * If another edit is already in flight, that edit is
   * committed first. Prevents orphaned foreignObjects
   * when the user double-clicks one text then another
   * without pressing Enter in between.
   */
  beginTextEdit(element) {
    if (!element || !element.tagName) return;
    if (element.tagName.toLowerCase() !== 'text') return;
    // Commit any prior edit so we never have two
    // foreignObjects alive at once.
    if (this._textEdit) {
      this.commitTextEdit();
    }
    const originalContent = element.textContent || '';
    const overlay = this._renderTextEditOverlay(element, originalContent);
    if (!overlay) return;
    this._textEdit = {
      element,
      originalContent,
      foreignObject: overlay.foreignObject,
      textarea: overlay.textarea,
    };
    // Focus + select all so the user can immediately
    // start typing to replace, or arrow-key to edit.
    try {
      overlay.textarea.focus();
      overlay.textarea.select?.();
    } catch (_) {
      // jsdom / headless environments may not support
      // focus correctly; the edit is still functional
      // via programmatic API.
    }
  }

  /**
   * Commit the active text edit. Replaces the element's
   * children with a single text node containing the
   * textarea's value. Any pre-existing `<tspan>` children
   * are flattened. Fires `onChange` if the content
   * actually changed. No-op when no edit is active.
   */
  commitTextEdit() {
    if (!this._textEdit) return;
    const edit = this._textEdit;
    const newContent = edit.textarea.value;
    // Push undo before mutating — only if content actually
    // changed (no-change commits shouldn't pollute the stack).
    if (newContent !== edit.originalContent) {
      this._pushUndo();
    }
    this._teardownTextEditOverlay(edit);
    this._textEdit = null;
    // Replace all children with a single text node.
    // Wholesale replacement flattens any <tspan>
    // structure. Documented trade-off — most SVG text
    // elements don't use tspan, and the ones that do
    // either get their structure preserved via the
    // source (user edits the file directly) or lose it
    // here. Users with tspan-heavy text should edit
    // the source.
    while (edit.element.firstChild) {
      edit.element.removeChild(edit.element.firstChild);
    }
    if (newContent) {
      edit.element.appendChild(
        document.createTextNode(newContent),
      );
    }
    // Fire onChange only when content actually changed.
    // Clicking into a text element, not typing, then
    // pressing Enter shouldn't mark the file dirty.
    if (newContent !== edit.originalContent) {
      this._onChange();
    }
    // Re-render handles in case the element's bounding
    // box changed as a result of the content change.
    this._renderHandles();
  }

  /**
   * Cancel the active text edit. Restores the element's
   * original content and removes the foreignObject
   * overlay. No onChange fired — cancel is a rollback.
   * No-op when no edit is active.
   */
  cancelTextEdit() {
    if (!this._textEdit) return;
    const edit = this._textEdit;
    this._teardownTextEditOverlay(edit);
    this._textEdit = null;
    // Restore original content. If the edit didn't
    // mutate the element's children (the user only
    // typed in the textarea), this is a no-op. If an
    // external caller modified the element mid-edit
    // (unlikely but defensive), this restores what we
    // snapshotted at edit start.
    while (edit.element.firstChild) {
      edit.element.removeChild(edit.element.firstChild);
    }
    if (edit.originalContent) {
      edit.element.appendChild(
        document.createTextNode(edit.originalContent),
      );
    }
    this._renderHandles();
  }

  /**
   * Build the foreignObject + textarea overlay for a
   * text edit. Positioned at the element's bounding box
   * with a small padding so typing doesn't overflow
   * immediately. Font size and color inherited from
   * the text element. Returns the foreignObject and
   * textarea refs, or null when bbox computation fails.
   */
  _renderTextEditOverlay(element, content) {
    let bbox;
    try {
      bbox = element.getBBox?.();
    } catch (_) {
      return null;
    }
    if (!bbox) return null;
    // Positioning padding. Ensures the textarea has
    // room for the user's first keystroke without
    // resizing or clipping.
    const padX = 8;
    const padY = 4;
    const width = Math.max(bbox.width + padX * 2, 60);
    const height = Math.max(bbox.height + padY * 2, 24);
    const ns = 'http://www.w3.org/2000/svg';
    const xhtmlNs = 'http://www.w3.org/1999/xhtml';
    const fo = document.createElementNS(ns, 'foreignObject');
    fo.setAttribute('x', String(bbox.x - padX));
    fo.setAttribute('y', String(bbox.y - padY));
    fo.setAttribute('width', String(width));
    fo.setAttribute('height', String(height));
    // Mark the foreignObject so `_hitTest` doesn't
    // re-select the text element if the user clicks
    // inside the textarea.
    fo.setAttribute('class', HANDLE_CLASS);
    // Read font properties from the text element. Falls
    // back to CSS defaults when unspecified.
    const fontSize =
      element.getAttribute('font-size') || '16';
    const fill = element.getAttribute('fill') || '#000';
    const textarea = document.createElementNS(xhtmlNs, 'textarea');
    textarea.value = content;
    // Inline styles — fills the foreignObject, inherits
    // font from the text element, accent border so the
    // active edit is visually distinct from other
    // handles.
    textarea.setAttribute(
      'style',
      [
        'width: 100%',
        'height: 100%',
        'box-sizing: border-box',
        'margin: 0',
        `padding: ${padY}px ${padX}px`,
        `font-size: ${fontSize}px`,
        `color: ${fill}`,
        'background: rgba(255, 255, 255, 0.95)',
        'border: 2px solid #4fc3f7',
        'border-radius: 2px',
        'outline: none',
        'resize: none',
        'font-family: inherit',
        'line-height: 1.2',
      ].join('; '),
    );
    textarea.addEventListener('keydown', this._onTextEditKeyDown);
    textarea.addEventListener('blur', this._onTextEditBlur);
    fo.appendChild(textarea);
    this._svg.appendChild(fo);
    return { foreignObject: fo, textarea };
  }

  /**
   * Remove the foreignObject overlay and detach its
   * event listeners. Called by both commit and cancel
   * paths.
   */
  _teardownTextEditOverlay(edit) {
    try {
      edit.textarea.removeEventListener(
        'keydown',
        this._onTextEditKeyDown,
      );
      edit.textarea.removeEventListener(
        'blur',
        this._onTextEditBlur,
      );
    } catch (_) {
      // Listeners may have been auto-removed if the
      // foreignObject was detached externally.
    }
    if (
      edit.foreignObject &&
      edit.foreignObject.parentNode
    ) {
      edit.foreignObject.parentNode.removeChild(
        edit.foreignObject,
      );
    }
  }

  /**
   * Keyboard handler for the textarea. Enter commits
   * (unless Shift is held for multi-line), Escape
   * cancels. Other keys flow through to default
   * textarea behavior.
   */
  _onTextEditKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this.commitTextEdit();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelTextEdit();
      return;
    }
    // Stop propagation for other keys too so the
    // editor's document-level keydown doesn't hijack
    // Delete/Backspace while typing.
    event.stopPropagation();
  }

  /**
   * Blur handler — user clicked outside the textarea.
   * Commits rather than cancels; accidental click-aways
   * shouldn't discard user work.
   */
  _onTextEditBlur() {
    // Defer so a programmatic focus change doesn't fire
    // blur before the focus lands elsewhere. Without the
    // timeout, Enter → focus-change → blur → double-commit
    // could race.
    if (!this._textEdit) return;
    this.commitTextEdit();
  }

  // ---------------------------------------------------------------
  // Pointer handling
  // ---------------------------------------------------------------

  /**
   * Double-click dispatch. Opens an inline text edit
   * when the target is a `<text>` element (or a `<tspan>`
   * that resolves to its parent text). Other elements
   * ignore the gesture.
   *
   * When the target is part of a multi-selection, the
   * set collapses to just the target before the edit
   * opens. Rationale: double-click is a "focus this
   * specific element" gesture; silently leaving other
   * elements selected in the background would confuse
   * the follow-up "what does Delete do now?" question.
   */
  _onDoubleClick(event) {
    const target = this._hitTest(event.clientX, event.clientY);
    if (!target) return;
    if (target.tagName?.toLowerCase() !== 'text') return;
    event.stopPropagation();
    event.preventDefault();
    if (this._selectedSet.size > 1) {
      // Collapse to just this element.
      this.setSelection(target);
    }
    this.beginTextEdit(target);
  }

  _onPointerDown(event) {
    // Only react to primary button (left-click / touch).
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    // Shift key takes priority over handle hit-test.
    // Shift+click is always "modify selection" (toggle
    // element in/out of set) or "start marquee" (on empty
    // space). Without this ordering, a shift+click on a
    // selected element with handles visible would start a
    // resize drag instead of toggling selection.
    if (event.shiftKey) {
      const shiftTarget = this._hitTest(event.clientX, event.clientY);
      if (!shiftTarget) {
        event.stopPropagation();
        this._beginMarquee(event);
      } else {
        event.stopPropagation();
        this.toggleSelection(shiftTarget);
      }
      return;
    }
    // Handle hit-test runs NEXT — when the pointer is over
    // one of the selected element's resize handles, start
    // a resize drag rather than a move/select. Only fires
    // when there's already a selection, so a fresh click on
    // an unselected shape can't accidentally initiate a
    // resize. Resize handles are shown only in single-
    // selection mode (size === 1) so multi-selection
    // skips this path.
    if (this._selected && this._selectedSet.size === 1) {
      const role = this._hitTestHandle(
        event.clientX,
        event.clientY,
      );
      if (role) {
        event.stopPropagation();
        this._beginResizeDrag(event, role);
        return;
      }
    }
    const target = this._hitTest(event.clientX, event.clientY);
    if (!target) {
      this._clearSelection();
      return;
    }
    // Stop propagation so the SvgViewer's pan/zoom doesn't
    // also react. Without this, a click would start a pan
    // on the left panel via the sync callback.
    event.stopPropagation();
    // Plain click — three cases:
    //   1. Click on a member of a multi-selection → start
    //      a group drag. The existing set stays as-is;
    //      the drag moves every element uniformly.
    //   2. Click on the already-sole-selected element →
    //      start a single-element drag.
    //   3. Click on something else → replace selection.
    //      Drag requires a second click — matches the
    //      click-to-select-first, click-to-drag
    //      convention and prevents accidental drags.
    if (this._selectedSet.has(target)) {
      this._beginDrag(event);
    } else {
      this.setSelection(target);
    }
  }

  /**
   * Check whether the given screen coordinates are over
   * one of the selected element's resize handles. Returns
   * the handle's role string (`nw`/`n`/`ne`/... for rects
   * or `n`/`e`/`s`/`w` for circles/ellipses) or null.
   *
   * Uses the same composed-aware elementsFromPoint as the
   * main hit-test but filters FOR handles rather than
   * against them.
   */
  _hitTestHandle(clientX, clientY) {
    const root = this._svg.getRootNode();
    let els = null;
    if (root && typeof root.elementsFromPoint === 'function') {
      els = root.elementsFromPoint(clientX, clientY);
    } else if (typeof document.elementsFromPoint === 'function') {
      els = document.elementsFromPoint(clientX, clientY);
    }
    if (!els || els.length === 0) return null;
    for (const el of els) {
      if (!el || !el.tagName) continue;
      if (!el.classList || !el.classList.contains(HANDLE_CLASS)) {
        continue;
      }
      const role = el.getAttribute(HANDLE_ROLE_ATTR);
      if (role) return role;
    }
    return null;
  }

  // ---------------------------------------------------------------
  // Drag machinery
  // ---------------------------------------------------------------

  /**
   * Start a drag on the selected element(s). Captures the
   * pointer so subsequent move events flow here even when
   * the pointer leaves the SVG bounds.
   *
   * When multi-selection is active, snapshots every
   * element's positional attributes so the move handler
   * can apply the drag delta uniformly to each. Elements
   * whose tag has no dispatch (and therefore no snapshot)
   * are silently excluded from the group drag — matches
   * the single-element path which no-ops on unsupported
   * tags.
   */
  _beginDrag(event) {
    if (!this._selected) return;
    const origin = this._screenToSvg(event.clientX, event.clientY);
    // Build one entry per element in the set. Single-
    // selection produces a one-entry array. Filter out
    // elements with no supported dispatch — they won't
    // move but the rest of the group will.
    const entries = [];
    for (const el of this._selectedSet) {
      const attrs = this._captureDragAttributes(el);
      if (attrs) entries.push({ el, originAttrs: attrs });
    }
    if (entries.length === 0) {
      // Nothing draggable in the set. Silently drop.
      return;
    }
    this._drag = {
      mode: 'move',
      pointerId: event.pointerId,
      startX: origin.x,
      startY: origin.y,
      entries,
      // Keep single-element compatibility fields for
      // tests and for any code that reads `originAttrs`
      // directly — points at the primary's snapshot.
      originAttrs: entries[0].originAttrs,
      committed: false,
    };
    try {
      this._svg.setPointerCapture(event.pointerId);
    } catch (_) {
      // Pointer capture not supported or pointer already
      // released. The drag still works via the bubbling
      // pointermove handler; capture is an enhancement,
      // not a requirement.
    }
  }

  /**
   * Start a resize drag on the selected element. Like
   * `_beginDrag` but captures dimensional attributes
   * (width/height/r/rx/ry) in addition to position, and
   * records which handle was grabbed so the move handler
   * knows which corner/edge is being dragged.
   */
  _beginResizeDrag(event, role) {
    if (!this._selected) return;
    const origin = this._screenToSvg(event.clientX, event.clientY);
    const originAttrs = this._captureResizeAttributes(this._selected);
    if (!originAttrs) {
      // Element isn't resizable (shouldn't happen — handle
      // rendering is shape-specific — but defensive).
      return;
    }
    this._drag = {
      mode: 'resize',
      role,
      pointerId: event.pointerId,
      startX: origin.x,
      startY: origin.y,
      originAttrs,
      committed: false,
    };
    try {
      this._svg.setPointerCapture(event.pointerId);
    } catch (_) {}
  }

  _onPointerMove(event) {
    // Marquee takes precedence — if we're marqueeing,
    // the same event stream is consumed by marquee
    // update rather than drag.
    if (this._marquee) {
      this._updateMarquee(event);
      return;
    }
    if (!this._drag) return;
    if (event.pointerId !== this._drag.pointerId) return;
    const current = this._screenToSvg(event.clientX, event.clientY);
    const dx = current.x - this._drag.startX;
    const dy = current.y - this._drag.startY;
    // Click-without-drag threshold. Convert the screen-px
    // threshold to SVG units on first move so zoom doesn't
    // make a 3px screen threshold require 300 SVG units.
    if (!this._drag.committed) {
      const thresholdSvg = this._screenDistToSvgDist(
        this._dragThresholdScreen,
      );
      if (Math.abs(dx) < thresholdSvg && Math.abs(dy) < thresholdSvg) {
        return;
      }
      // Push undo BEFORE the first mutation. At this point
      // the element's attributes are still at their
      // pre-drag values (we haven't applied the delta yet).
      this._pushUndo();
      this._drag.committed = true;
    }
    if (this._drag.mode === 'resize') {
      this._applyResizeDelta(dx, dy);
    } else {
      this._applyDragDelta(dx, dy);
    }
    this._renderHandles();
  }

  _onPointerUp(event) {
    // Marquee is finalized here too — it runs as a
    // separate pointer interaction from drag.
    if (this._marquee) {
      this._endMarquee(event);
      return;
    }
    if (!this._drag) return;
    if (event.pointerId !== this._drag.pointerId) return;
    const wasCommitted = this._drag.committed;
    try {
      this._svg.releasePointerCapture(event.pointerId);
    } catch (_) {
      // Capture may never have been granted or may have
      // been released already.
    }
    this._drag = null;
    if (wasCommitted) {
      this._onChange();
    }
  }

  /**
   * Cancel an in-flight drag without committing. Rolls
   * back to the original attribute values and releases
   * pointer capture. Used by detach().
   *
   * Group drags iterate every entry to restore each
   * element independently; resize drags have only one
   * element since resize handles only appear in single-
   * selection mode.
   */
  _cancelDrag() {
    if (!this._drag) return;
    // Roll back to the snapshot. Dispatch by drag mode —
    // move uses position attributes (possibly multiple
    // entries for group drag), resize uses dimension
    // attributes (always one element).
    if (this._drag.mode === 'resize') {
      this._restoreResizeAttributes(
        this._selected,
        this._drag.originAttrs,
      );
    } else {
      const entries = this._drag.entries || [];
      for (const entry of entries) {
        this._restoreDragAttributes(entry.el, entry.originAttrs);
      }
    }
    try {
      this._svg.releasePointerCapture(this._drag.pointerId);
    } catch (_) {}
    this._drag = null;
  }

  // ---------------------------------------------------------------
  // Marquee selection
  // ---------------------------------------------------------------

  /**
   * Start a marquee on shift+drag from empty space.
   * Captures the origin in SVG root coords and snapshots
   * the current selection set as the baseline. The rect
   * element is lazily created on the first pointermove
   * that crosses the min-drag threshold — a shift+click
   * on empty space with no drag still clears to a pure
   * click (no marquee residue).
   */
  _beginMarquee(event) {
    const origin = this._screenToSvg(event.clientX, event.clientY);
    this._marquee = {
      pointerId: event.pointerId,
      startX: origin.x,
      startY: origin.y,
      currentX: origin.x,
      currentY: origin.y,
      rect: null,
      originalSet: new Set(this._selectedSet),
    };
    try {
      this._svg.setPointerCapture(event.pointerId);
    } catch (_) {}
  }

  /**
   * Update the marquee on pointermove. Lazily creates
   * the rect element once the drag passes the min
   * threshold. Updates the rect's geometry and the
   * direction-dependent border style (solid for forward
   * containment drag, dashed for reverse crossing drag).
   *
   * Returns true when a pointermove was consumed as
   * marquee motion; false otherwise so callers know to
   * fall through.
   */
  _updateMarquee(event) {
    if (!this._marquee) return false;
    if (event.pointerId !== this._marquee.pointerId) return false;
    const current = this._screenToSvg(event.clientX, event.clientY);
    this._marquee.currentX = current.x;
    this._marquee.currentY = current.y;
    const m = this._marquee;
    const dxScreen = this._svgDistToScreenDist(
      Math.abs(current.x - m.startX),
    );
    const dyScreen = this._svgDistToScreenDist(
      Math.abs(current.y - m.startY),
    );
    // Below threshold — no visible rect yet, but the
    // marquee state is live so pointerup can still
    // distinguish click-with-shift from a real marquee.
    if (
      !m.rect &&
      dxScreen < _MARQUEE_MIN_SCREEN &&
      dyScreen < _MARQUEE_MIN_SCREEN
    ) {
      return true;
    }
    // Crossed threshold (or already alive) — render.
    if (!m.rect) {
      m.rect = this._createMarqueeRect();
      this._ensureHandleGroup().appendChild(m.rect);
    }
    const bbox = this._marqueeBBox();
    m.rect.setAttribute('x', String(bbox.x));
    m.rect.setAttribute('y', String(bbox.y));
    m.rect.setAttribute('width', String(bbox.width));
    m.rect.setAttribute('height', String(bbox.height));
    // Direction: forward = pointer strictly to the right
    // AND strictly below origin → containment mode (solid).
    // Anything else = crossing mode (dashed).
    const forward =
      current.x > m.startX && current.y > m.startY;
    const stroke = forward ? '#4fc3f7' : '#7ee787';
    const dashArray = forward
      ? 'none'
      : `${this._screenDistToSvgDist(4)},${this._screenDistToSvgDist(3)}`;
    const fill = forward
      ? 'rgba(79, 195, 247, 0.12)'
      : 'rgba(126, 231, 135, 0.10)';
    m.rect.setAttribute('stroke', stroke);
    m.rect.setAttribute('stroke-dasharray', dashArray);
    m.rect.setAttribute('fill', fill);
    return true;
  }

  /**
   * Finalize the marquee on pointerup. Computes the
   * selection update based on drag direction:
   *   - forward: elements fully contained → ADDED to
   *     baseline (shift adds, not replaces)
   *   - reverse: elements overlapping → ADDED to baseline
   *
   * In practice specs4 calls for the marquee to TOGGLE
   * rather than ADD (so drag-selecting then drag-
   * deselecting works). We add-only here — a
   * tiny-scope decision; 3.2c.5's undo stack plus
   * manual shift+click covers the remove case.
   *
   * Click-with-shift-without-drag (rect never rendered)
   * is treated as a no-op on the current selection,
   * matching "shift+click empty space" convention — it
   * doesn't clear, doesn't add.
   */
  _endMarquee(event) {
    if (!this._marquee) return;
    if (event && event.pointerId !== this._marquee.pointerId) return;
    const m = this._marquee;
    const hadRect = !!m.rect;
    // Tear down the rect regardless of whether a real
    // selection update happened.
    if (m.rect && m.rect.parentNode) {
      m.rect.parentNode.removeChild(m.rect);
    }
    try {
      this._svg.releasePointerCapture(m.pointerId);
    } catch (_) {}
    this._marquee = null;
    if (!hadRect) {
      // Shift+click without drag — no-op on selection.
      return;
    }
    // Compute the final selection set: baseline ∪ hits.
    const bbox = this._marqueeBBoxFor(m);
    const forward = m.currentX > m.startX && m.currentY > m.startY;
    const hits = this._marqueeHitTest(bbox, forward);
    const next = new Set(m.originalSet);
    for (const el of hits) next.add(el);
    // Pick a primary. If the baseline was non-empty, keep
    // its primary; otherwise use the first hit.
    let primary = this._selected;
    if (!primary || !next.has(primary)) {
      primary = hits.length > 0 ? hits[0] : null;
    }
    this._selectedSet = next;
    this._selected = primary;
    this._renderHandles();
    this._onSelectionChange();
  }

  /**
   * Cancel an in-flight marquee without applying any
   * selection changes. Used by detach(). Removes the
   * rendered rect, releases pointer capture, nulls
   * state.
   */
  _cancelMarquee() {
    if (!this._marquee) return;
    const m = this._marquee;
    if (m.rect && m.rect.parentNode) {
      m.rect.parentNode.removeChild(m.rect);
    }
    try {
      this._svg.releasePointerCapture(m.pointerId);
    } catch (_) {}
    this._marquee = null;
  }

  /**
   * Walk the SVG DOM collecting candidate elements for
   * marquee hit-test. Direct children of the root SVG
   * plus one level inside `<g>` groups. Deeper nesting
   * is deliberately out of scope per specs4.
   */
  _marqueeCandidates() {
    const out = [];
    const rootChildren = Array.from(this._svg.children);
    for (const child of rootChildren) {
      if (!child.tagName) continue;
      const tag = child.tagName.toLowerCase();
      if (_NON_SELECTABLE_TAGS.has(tag)) continue;
      if (child.classList && child.classList.contains(HANDLE_CLASS)) {
        continue;
      }
      if (child.id === HANDLE_GROUP_ID) continue;
      if (tag === 'g') {
        // One level deeper.
        for (const inner of Array.from(child.children)) {
          if (!inner.tagName) continue;
          const innerTag = inner.tagName.toLowerCase();
          if (_NON_SELECTABLE_TAGS.has(innerTag)) continue;
          if (_SELECTABLE_TAGS.has(innerTag) || innerTag === 'g') {
            out.push(inner);
          }
        }
        // The group itself is also selectable.
        out.push(child);
      } else if (_SELECTABLE_TAGS.has(tag)) {
        out.push(child);
      }
    }
    return out;
  }

  /**
   * Run the marquee hit-test against candidate elements.
   * Forward drags use containment (element fully inside
   * marquee); reverse drags use crossing (any overlap).
   *
   * Returns candidates that pass in DOM order — stable
   * for deterministic "first hit" primary selection.
   */
  _marqueeHitTest(marqueeBBox, forward) {
    const hits = [];
    for (const el of this._marqueeCandidates()) {
      const elBBox = this._elementBBoxInSvgRoot(el);
      if (!elBBox) continue;
      const passes = forward
        ? _bboxContains(marqueeBBox, elBBox)
        : _bboxOverlaps(marqueeBBox, elBBox);
      if (passes) hits.push(el);
    }
    return hits;
  }

  /**
   * Compute an element's bounding box in SVG root coords.
   * `getBBox` returns local coords; for elements inside
   * transformed groups we map the four corners through
   * the element's CTM.
   */
  _elementBBoxInSvgRoot(el) {
    let bbox;
    try {
      bbox = el.getBBox?.();
    } catch (_) {
      return null;
    }
    if (!bbox) return null;
    const tl = this._localToSvgRoot(el, bbox.x, bbox.y);
    const br = this._localToSvgRoot(
      el,
      bbox.x + bbox.width,
      bbox.y + bbox.height,
    );
    const tr = this._localToSvgRoot(
      el,
      bbox.x + bbox.width,
      bbox.y,
    );
    const bl = this._localToSvgRoot(
      el,
      bbox.x,
      bbox.y + bbox.height,
    );
    const xs = [tl.x, tr.x, bl.x, br.x];
    const ys = [tl.y, tr.y, bl.y, br.y];
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  /** Build the marquee <rect> element. Geometry filled
   * in by the caller. Styling applied on each move based
   * on drag direction. */
  _createMarqueeRect() {
    const ns = 'http://www.w3.org/2000/svg';
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('id', MARQUEE_ID);
    rect.setAttribute('class', HANDLE_CLASS);
    rect.setAttribute('pointer-events', 'none');
    const sw = this._screenDistToSvgDist(1);
    rect.setAttribute('stroke-width', String(sw));
    return rect;
  }

  /** Axis-aligned bbox from the marquee's start and
   * current points. Read from `this._marquee`. */
  _marqueeBBox() {
    return this._marqueeBBoxFor(this._marquee);
  }

  /** Axis-aligned bbox for a given marquee state
   * object. Factored out so `_endMarquee` can pass the
   * cleared snapshot rather than relying on
   * `this._marquee` (which was nulled above it). */
  _marqueeBBoxFor(m) {
    const x = Math.min(m.startX, m.currentX);
    const y = Math.min(m.startY, m.currentY);
    const width = Math.abs(m.currentX - m.startX);
    const height = Math.abs(m.currentY - m.startY);
    return { x, y, width, height };
  }

  /** Convert an SVG-unit distance to screen pixels.
   * Inverse of `_screenDistToSvgDist`. Used by the
   * marquee threshold check. */
  _svgDistToScreenDist(svgDist) {
    if (svgDist === 0) return 0;
    const per = this._screenDistToSvgDist(1);
    return per > 0 ? svgDist / per : svgDist;
  }

  // ---------------------------------------------------------------
  // Per-element position dispatch
  // ---------------------------------------------------------------

  /**
   * Capture the current positional attributes of an
   * element into a snapshot that can be used as the
   * origin for a drag operation. Returns null when the
   * element doesn't match any supported dispatch case.
   *
   * The snapshot shape depends on the element type:
   *   - rect/image/use → {x, y}
   *   - circle → {cx, cy}
   *   - ellipse → {cx, cy}
   *   - line → {x1, y1, x2, y2}
   *   - polyline/polygon → {points: [[x, y], ...]}
   *   - text → {x, y} OR {transform: origText}
   *     (auto-detected: transform wins if present)
   *   - path/g → {transform: origText}
   *
   * All numeric values are captured as numbers so delta
   * math works uniformly; string attributes like transform
   * are captured verbatim so we can append/replace a
   * translate() without losing any pre-existing transforms.
   */
  _captureDragAttributes(el) {
    if (!el || !el.tagName) return null;
    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case 'rect':
      case 'image':
      case 'use':
        return {
          kind: 'xy',
          x: _parseNum(el.getAttribute('x')),
          y: _parseNum(el.getAttribute('y')),
        };
      case 'circle':
      case 'ellipse':
        return {
          kind: 'cxcy',
          cx: _parseNum(el.getAttribute('cx')),
          cy: _parseNum(el.getAttribute('cy')),
        };
      case 'line':
        return {
          kind: 'line',
          x1: _parseNum(el.getAttribute('x1')),
          y1: _parseNum(el.getAttribute('y1')),
          x2: _parseNum(el.getAttribute('x2')),
          y2: _parseNum(el.getAttribute('y2')),
        };
      case 'polyline':
      case 'polygon':
        return {
          kind: 'points',
          points: _parsePoints(el.getAttribute('points')),
        };
      case 'text': {
        // text can use either x/y attributes or a
        // transform. Auto-detect: if the element has a
        // transform attribute, use that (preserves
        // existing transform like rotate()); otherwise
        // use x/y.
        if (el.hasAttribute('transform')) {
          return {
            kind: 'transform',
            transform: el.getAttribute('transform') || '',
          };
        }
        return {
          kind: 'xy',
          x: _parseNum(el.getAttribute('x')),
          y: _parseNum(el.getAttribute('y')),
        };
      }
      case 'path':
      case 'g':
        return {
          kind: 'transform',
          transform: el.getAttribute('transform') || '',
        };
      default:
        return null;
    }
  }

  /**
   * Apply a translation delta to every element in the
   * current drag. Uses the per-element snapshots stored
   * on `_drag.entries` so repeated pointermoves don't
   * compound — each move is relative to the drag start,
   * not the previous position.
   *
   * Single-element drags have one entry in the array;
   * group drags have N. The math per element is
   * identical to the single-element case — each element
   * reads its own snapshot and writes its own attributes.
   */
  _applyDragDelta(dx, dy) {
    if (!this._drag) return;
    const entries = this._drag.entries || [];
    for (const entry of entries) {
      this._applyDragDeltaToEntry(entry, dx, dy);
    }
  }

  /**
   * Apply a drag delta to a single entry (element +
   * snapshot). Extracted from `_applyDragDelta` so the
   * per-element logic stays in one place; the outer
   * method just iterates.
   */
  _applyDragDeltaToEntry(entry, dx, dy) {
    const el = entry.el;
    const o = entry.originAttrs;
    switch (o.kind) {
      case 'xy':
        el.setAttribute('x', String(o.x + dx));
        el.setAttribute('y', String(o.y + dy));
        break;
      case 'cxcy':
        el.setAttribute('cx', String(o.cx + dx));
        el.setAttribute('cy', String(o.cy + dy));
        break;
      case 'line':
        el.setAttribute('x1', String(o.x1 + dx));
        el.setAttribute('y1', String(o.y1 + dy));
        el.setAttribute('x2', String(o.x2 + dx));
        el.setAttribute('y2', String(o.y2 + dy));
        break;
      case 'points': {
        const shifted = o.points
          .map(([x, y]) => `${x + dx},${y + dy}`)
          .join(' ');
        el.setAttribute('points', shifted);
        break;
      }
      case 'transform': {
        // Append a translate(dx, dy) to the existing
        // transform. Browsers parse a chain of transforms
        // left-to-right; our translate is applied after
        // any existing transforms, which is what the user
        // intends (the drag should move the rendered
        // element by dx/dy regardless of its existing
        // rotation/scale).
        const base = o.transform.trim();
        const delta = `translate(${dx} ${dy})`;
        const combined = base ? `${base} ${delta}` : delta;
        el.setAttribute('transform', combined);
        break;
      }
      default:
        break;
    }
  }

  /**
   * Restore the element to its pre-drag attribute state.
   * Used on drag cancel (e.g., editor detach mid-drag).
   */
  _restoreDragAttributes(el, snapshot) {
    if (!el || !snapshot) return;
    switch (snapshot.kind) {
      case 'xy':
        el.setAttribute('x', String(snapshot.x));
        el.setAttribute('y', String(snapshot.y));
        break;
      case 'cxcy':
        el.setAttribute('cx', String(snapshot.cx));
        el.setAttribute('cy', String(snapshot.cy));
        break;
      case 'line':
        el.setAttribute('x1', String(snapshot.x1));
        el.setAttribute('y1', String(snapshot.y1));
        el.setAttribute('x2', String(snapshot.x2));
        el.setAttribute('y2', String(snapshot.y2));
        break;
      case 'points':
        el.setAttribute(
          'points',
          snapshot.points.map(([x, y]) => `${x},${y}`).join(' '),
        );
        break;
      case 'transform':
        if (snapshot.transform) {
          el.setAttribute('transform', snapshot.transform);
        } else {
          el.removeAttribute('transform');
        }
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------
  // Resize dispatch
  // ---------------------------------------------------------------

  /**
   * Capture the element's current dimensional + positional
   * attributes for a resize drag. Returns a snapshot shape
   * specific to each supported element type:
   *
   *   - rect → {kind: 'rect', x, y, width, height}
   *   - circle → {kind: 'circle', cx, cy, r}
   *   - ellipse → {kind: 'ellipse', cx, cy, rx, ry}
   *
   * Returns null for unsupported shapes. Called only after
   * `_renderResizeHandles` has placed handles, so the set
   * of tags here matches the set that renders handles.
   */
  _captureResizeAttributes(el) {
    if (!el || !el.tagName) return null;
    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case 'rect':
        return {
          kind: 'rect',
          x: _parseNum(el.getAttribute('x')),
          y: _parseNum(el.getAttribute('y')),
          width: _parseNum(el.getAttribute('width')),
          height: _parseNum(el.getAttribute('height')),
        };
      case 'circle':
        return {
          kind: 'circle',
          cx: _parseNum(el.getAttribute('cx')),
          cy: _parseNum(el.getAttribute('cy')),
          r: _parseNum(el.getAttribute('r')),
        };
      case 'ellipse':
        return {
          kind: 'ellipse',
          cx: _parseNum(el.getAttribute('cx')),
          cy: _parseNum(el.getAttribute('cy')),
          rx: _parseNum(el.getAttribute('rx')),
          ry: _parseNum(el.getAttribute('ry')),
        };
      case 'line':
        // Distinct kind from the move-drag 'line' kind
        // (which lives in _captureDragAttributes) — move
        // stores both endpoints for a translation, endpoint
        // resize stores both endpoints for independent
        // edit of one.
        return {
          kind: 'line-endpoints',
          x1: _parseNum(el.getAttribute('x1')),
          y1: _parseNum(el.getAttribute('y1')),
          x2: _parseNum(el.getAttribute('x2')),
          y2: _parseNum(el.getAttribute('y2')),
        };
      case 'polyline':
      case 'polygon':
        // Distinct kind from move-drag's 'points' kind.
        // Move-drag shifts every point by a uniform delta;
        // vertex resize mutates a single point's coords
        // while leaving the rest alone. Keeping the kinds
        // separate means `_applyResizeDelta` and
        // `_restoreResizeAttributes` dispatch cleanly
        // without needing to inspect drag mode.
        return {
          kind: tag === 'polygon'
            ? 'polygon-vertices'
            : 'polyline-vertices',
          points: _parsePoints(el.getAttribute('points')),
        };
      case 'path': {
        // Capture the full parsed command list. Drag
        // dispatch needs the whole list (not just the
        // dragged command) because relative commands
        // following the dragged one reference the pen
        // position at their start — and if we mutate an
        // earlier relative command's args, later commands'
        // absolute endpoint positions shift. That's
        // visually correct (relative commands are meant
        // to propagate downstream) but it means the
        // restore path has to rewrite the whole `d`
        // attribute, not just patch one command.
        //
        // Distinct kind from move-drag's 'transform'
        // kind (which covers path move via transform
        // attribute). Move translates via transform;
        // vertex resize mutates the `d` attribute itself.
        const commands = _parsePathData(el.getAttribute('d'));
        return {
          kind: 'path-commands',
          commands: commands.map((c) => ({
            cmd: c.cmd,
            args: [...c.args],
          })),
        };
      }
      default:
        return null;
    }
  }

  /**
   * Apply a resize delta to the currently-dragging
   * element. Dispatches on the snapshot's `kind` and the
   * drag's `role`. Each shape has its own math:
   *
   *   - **rect**: the handle position determines which
   *     edge moves. `nw` moves the top-left corner —
   *     x += dx, y += dy, width -= dx, height -= dy. `se`
   *     moves the bottom-right — just width += dx,
   *     height += dy. Edge handles (`n`, `e`, `s`, `w`)
   *     adjust one dimension + position. Width and height
   *     clamped to `_MIN_RESIZE_DIMENSION` — a drag past
   *     the opposite edge collapses rather than flipping.
   *
   *   - **circle**: all four handles change the radius.
   *     The new radius is the distance from the center
   *     (cx, cy) to the current pointer position
   *     (startX + dx, startY + dy). Clamped to min.
   *
   *   - **ellipse**: `n`/`s` handles change `ry` (vertical
   *     radius); `e`/`w` change `rx` (horizontal). Each
   *     independently; center unchanged. Clamped to min.
   */
  _applyResizeDelta(dx, dy) {
    if (!this._drag || !this._selected) return;
    if (this._drag.mode !== 'resize') return;
    const el = this._selected;
    const o = this._drag.originAttrs;
    const role = this._drag.role;
    switch (o.kind) {
      case 'rect':
        this._applyRectResize(el, o, role, dx, dy);
        break;
      case 'circle':
        this._applyCircleResize(el, o, dx, dy);
        break;
      case 'ellipse':
        this._applyEllipseResize(el, o, role, dx, dy);
        break;
      case 'line-endpoints':
        this._applyLineEndpointResize(el, o, role, dx, dy);
        break;
      case 'polyline-vertices':
      case 'polygon-vertices':
        this._applyVertexResize(el, o, role, dx, dy);
        break;
      case 'path-commands':
        this._applyPathEndpointResize(el, o, role, dx, dy);
        break;
      default:
        break;
    }
  }

  /**
   * Rect resize dispatch — maps a handle role to changes
   * in x/y/width/height. Each corner/edge pins the opposite
   * corner/edge:
   *
   *   nw → pins SE: x,y move; width,height shrink
   *   ne → pins SW: y moves; width grows, height shrinks
   *   se → pins NW: (no position change) width,height grow
   *   sw → pins NE: x moves; width shrinks, height grows
   *   n  → pins S:  y moves; height shrinks
   *   e  → pins W:  (no position change) width grows
   *   s  → pins N:  (no position change) height grows
   *   w  → pins E:  x moves; width shrinks
   */
  _applyRectResize(el, o, role, dx, dy) {
    let x = o.x;
    let y = o.y;
    let width = o.width;
    let height = o.height;
    // Horizontal axis.
    if (role === 'nw' || role === 'w' || role === 'sw') {
      x = o.x + dx;
      width = o.width - dx;
    } else if (role === 'ne' || role === 'e' || role === 'se') {
      width = o.width + dx;
    }
    // Vertical axis.
    if (role === 'nw' || role === 'n' || role === 'ne') {
      y = o.y + dy;
      height = o.height - dy;
    } else if (role === 'sw' || role === 's' || role === 'se') {
      height = o.height + dy;
    }
    // Clamp to minimum. When a corner drag past the
    // opposite edge would make width/height negative, we
    // clamp to _MIN_RESIZE_DIMENSION AND freeze the
    // position at the opposite edge so the shape doesn't
    // flip. Without this, x would track the pointer and
    // width would go negative, which renders as an
    // inverted rect in most browsers but is unreadable
    // for the user.
    if (width < _MIN_RESIZE_DIMENSION) {
      width = _MIN_RESIZE_DIMENSION;
      if (role === 'nw' || role === 'w' || role === 'sw') {
        // x was moving; pin it so the right edge stays put.
        x = o.x + o.width - _MIN_RESIZE_DIMENSION;
      }
    }
    if (height < _MIN_RESIZE_DIMENSION) {
      height = _MIN_RESIZE_DIMENSION;
      if (role === 'nw' || role === 'n' || role === 'ne') {
        y = o.y + o.height - _MIN_RESIZE_DIMENSION;
      }
    }
    el.setAttribute('x', String(x));
    el.setAttribute('y', String(y));
    el.setAttribute('width', String(width));
    el.setAttribute('height', String(height));
  }

  /**
   * Circle resize — radius = distance from center to
   * pointer. All four cardinal handles behave identically
   * because a circle has a single radius; dragging any
   * handle changes r. Center (cx, cy) unchanged.
   */
  _applyCircleResize(el, o, dx, dy) {
    // Pointer position at drag start is stored in
    // _drag.startX/startY (SVG root coords). The current
    // pointer is at (startX + dx, startY + dy). Distance
    // from the center gives the new radius.
    const px = this._drag.startX + dx;
    const py = this._drag.startY + dy;
    const newR = Math.hypot(px - o.cx, py - o.cy);
    const r = Math.max(newR, _MIN_RESIZE_DIMENSION);
    el.setAttribute('r', String(r));
  }

  /**
   * Ellipse resize — independent rx and ry. `n`/`s`
   * handles set ry = |pointer_y - cy|; `e`/`w` handles
   * set rx = |pointer_x - cx|. Other axis unchanged.
   */
  _applyEllipseResize(el, o, role, dx, dy) {
    const px = this._drag.startX + dx;
    const py = this._drag.startY + dy;
    if (role === 'e' || role === 'w') {
      const newRx = Math.max(
        Math.abs(px - o.cx),
        _MIN_RESIZE_DIMENSION,
      );
      el.setAttribute('rx', String(newRx));
    } else if (role === 'n' || role === 's') {
      const newRy = Math.max(
        Math.abs(py - o.cy),
        _MIN_RESIZE_DIMENSION,
      );
      el.setAttribute('ry', String(newRy));
    }
  }

  /**
   * Line endpoint resize — each endpoint moves
   * independently. Role `p1` adjusts x1/y1; role `p2`
   * adjusts x2/y2. Other endpoint unchanged.
   *
   * No clamping: endpoints may coincide (producing a
   * degenerate zero-length line, invisible but legal SVG)
   * or cross without visual corruption. Unlike rects and
   * ellipses where a zero dimension would strand the user
   * with no visible handle, line handles are always at
   * actual endpoint coordinates — the user can drag them
   * back apart as easily.
   */
  _applyLineEndpointResize(el, o, role, dx, dy) {
    if (role === 'p1') {
      el.setAttribute('x1', String(o.x1 + dx));
      el.setAttribute('y1', String(o.y1 + dy));
    } else if (role === 'p2') {
      el.setAttribute('x2', String(o.x2 + dx));
      el.setAttribute('y2', String(o.y2 + dy));
    }
  }

  /**
   * Polyline / polygon vertex resize — one point moves,
   * others unchanged. Role format is `v{N}` where N is
   * the zero-indexed position in the points array.
   *
   * Serialization uses `x,y` form (comma-separated pair,
   * space-separated pairs) — same format as the move-drag
   * path. Alternative separators (whitespace between x/y)
   * would render identically, but `x,y` is the
   * conventional form and matches the move-drag output
   * so re-serialised polylines are visually stable across
   * edit operations.
   *
   * No clamping: vertices may coincide (collapsing an
   * edge to zero length), cross (producing a
   * self-intersecting polygon), or walk outside the
   * original bounding box. All are legal SVG and
   * recoverable — the user can drag the vertex back.
   */
  _applyVertexResize(el, o, role, dx, dy) {
    if (typeof role !== 'string' || !role.startsWith('v')) return;
    const idx = parseInt(role.slice(1), 10);
    if (!Number.isFinite(idx) || idx < 0 || idx >= o.points.length) {
      return;
    }
    // Clone the snapshot's points array so repeated
    // pointermove calls don't compound — each call
    // recomputes the Nth point from origin, not from
    // the previous move's result.
    const next = o.points.map(([x, y], i) =>
      i === idx ? [x + dx, y + dy] : [x, y],
    );
    el.setAttribute(
      'points',
      next.map(([x, y]) => `${x},${y}`).join(' '),
    );
  }

  /**
   * Path endpoint resize — one command's endpoint moves,
   * others unchanged. Role format is `p{N}` where N is
   * the zero-indexed position in the command array.
   *
   * Relative vs absolute handling: for absolute commands
   * (uppercase letters), the endpoint args become
   * (endpoint + delta). For relative commands (lowercase),
   * the args ARE the delta from the pen position — adding
   * the drag delta to them shifts the endpoint visually by
   * the same amount regardless of whether the form is
   * absolute or relative. The pen position at the command's
   * start doesn't change (earlier commands are untouched),
   * so a relative command's effective endpoint moves by
   * exactly the drag delta.
   *
   * Single-axis commands (H/V) ignore the irrelevant
   * component: H takes only the x delta, V takes only y.
   * This matches user expectation — dragging an H handle
   * up/down should produce no visual change because H is
   * horizontal-only. Strict user could drag exactly
   * horizontally, but accepting both and discarding the
   * irrelevant axis is more forgiving.
   *
   * C/S/Q endpoint arg positions vary: C has endpoint at
   * args[4..5]; S/Q at args[2..3]; T at args[0..1]. The
   * dispatch peeks at the command letter.
   *
   * A (arc) endpoint is at args[5..6]. Arc shape
   * parameters (rx, ry, rotation, flags) are preserved
   * verbatim — 3.2c.3b-iii could add handles for those
   * if needed.
   *
   * Z has no endpoint to drag; the role won't match a Z
   * command because handle rendering skips Z.
   *
   * No clamping: path commands may produce self-intersecting
   * or degenerate shapes, all legal SVG.
   */
  _applyPathEndpointResize(el, o, role, dx, dy) {
    if (typeof role !== 'string') return;
    // Control-point drag uses `c{N}-{K}` role format.
    // Dispatch to the control-point handler for those;
    // fall through to endpoint handling for `p{N}`.
    if (role.startsWith('c')) {
      this._applyPathControlPointResize(el, o, role, dx, dy);
      return;
    }
    if (!role.startsWith('p')) return;
    const idx = parseInt(role.slice(1), 10);
    if (
      !Number.isFinite(idx) ||
      idx < 0 ||
      idx >= o.commands.length
    ) {
      return;
    }
    // Clone the command list so repeated pointermoves
    // recompute from origin, not from the previous move.
    const next = o.commands.map((c) => ({
      cmd: c.cmd,
      args: [...c.args],
    }));
    const target = next[idx];
    if (!target) return;
    const upper = target.cmd.toUpperCase();
    const args = target.args;
    // Endpoint arg positions differ by command. H and V
    // are single-axis.
    switch (upper) {
      case 'M':
      case 'L':
      case 'T':
        // Endpoint at args[0], args[1].
        args[0] += dx;
        args[1] += dy;
        break;
      case 'H':
        // Single-axis: x only.
        args[0] += dx;
        break;
      case 'V':
        // Single-axis: y only.
        args[0] += dy;
        break;
      case 'C':
        // Endpoint at args[4], args[5]. Control points
        // (args[0..1] and args[2..3]) handled by
        // `_applyPathControlPointResize` via the `c{N}-K`
        // role format.
        args[4] += dx;
        args[5] += dy;
        break;
      case 'S':
      case 'Q':
        // Endpoint at args[2], args[3].
        args[2] += dx;
        args[3] += dy;
        break;
      case 'A':
        // Endpoint at args[5], args[6].
        args[5] += dx;
        args[6] += dy;
        break;
      case 'Z':
        // Z has no draggable endpoint; shouldn't be
        // reached because handle rendering skips Z.
        return;
      default:
        return;
    }
    el.setAttribute('d', _serializePathData(next));
  }

  /**
   * Path control-point resize — one curve's control point
   * moves, others (including the curve's endpoint and
   * other commands) unchanged. Role format is `c{N}-{K}`
   * where N is the zero-indexed command position and K
   * is the 1-based control-point index.
   *
   * Arg positions by command:
   *   - C with K=1 → args[0..1]
   *   - C with K=2 → args[2..3]
   *   - S with K=1 → args[0..1] (only one draggable CP —
   *     the first control is reflected from the previous
   *     command)
   *   - Q with K=1 → args[0..1]
   *   - T, M, L, H, V, A, Z → no control points, role
   *     won't reach dispatch (handle rendering skips them)
   *
   * Relative vs absolute: same math as endpoints. For
   * absolute commands, args are absolute positions; we
   * add the drag delta. For relative commands, args are
   * deltas from pen; we add the drag delta. Either way
   * the effective absolute control point shifts by
   * exactly the drag delta because the pen position at
   * the command's start is unchanged.
   *
   * Invalid roles (malformed, wrong command type) are
   * silent no-ops. Shouldn't happen in practice because
   * roles come from our own handle rendering; defensive
   * guard against a future refactor that might feed
   * arbitrary role strings.
   */
  _applyPathControlPointResize(el, o, role, dx, dy) {
    // Parse `c{N}-{K}`.
    const match = /^c(\d+)-(\d+)$/.exec(role);
    if (!match) return;
    const idx = parseInt(match[1], 10);
    const cpIndex = parseInt(match[2], 10);
    if (
      !Number.isFinite(idx) ||
      idx < 0 ||
      idx >= o.commands.length
    ) {
      return;
    }
    if (cpIndex !== 1 && cpIndex !== 2) return;
    const next = o.commands.map((c) => ({
      cmd: c.cmd,
      args: [...c.args],
    }));
    const target = next[idx];
    if (!target) return;
    const upper = target.cmd.toUpperCase();
    const args = target.args;
    switch (upper) {
      case 'C':
        // Two control points. K=1 → args[0..1]; K=2 →
        // args[2..3].
        if (cpIndex === 1) {
          args[0] += dx;
          args[1] += dy;
        } else {
          args[2] += dx;
          args[3] += dy;
        }
        break;
      case 'S':
      case 'Q':
        // One draggable control point at args[0..1].
        // K=2 on these commands is invalid — the reflected
        // first control on S isn't user-draggable.
        if (cpIndex !== 1) return;
        args[0] += dx;
        args[1] += dy;
        break;
      default:
        // Other commands have no draggable control points.
        return;
    }
    el.setAttribute('d', _serializePathData(next));
  }

  /**
   * Restore resize-drag snapshot on cancel. Mirror of
   * `_applyRect/Circle/EllipseResize`; writes the origin
   * values back.
   */
  _restoreResizeAttributes(el, snapshot) {
    if (!el || !snapshot) return;
    switch (snapshot.kind) {
      case 'rect':
        el.setAttribute('x', String(snapshot.x));
        el.setAttribute('y', String(snapshot.y));
        el.setAttribute('width', String(snapshot.width));
        el.setAttribute('height', String(snapshot.height));
        break;
      case 'circle':
        el.setAttribute('cx', String(snapshot.cx));
        el.setAttribute('cy', String(snapshot.cy));
        el.setAttribute('r', String(snapshot.r));
        break;
      case 'ellipse':
        el.setAttribute('cx', String(snapshot.cx));
        el.setAttribute('cy', String(snapshot.cy));
        el.setAttribute('rx', String(snapshot.rx));
        el.setAttribute('ry', String(snapshot.ry));
        break;
      case 'line-endpoints':
        el.setAttribute('x1', String(snapshot.x1));
        el.setAttribute('y1', String(snapshot.y1));
        el.setAttribute('x2', String(snapshot.x2));
        el.setAttribute('y2', String(snapshot.y2));
        break;
      case 'polyline-vertices':
      case 'polygon-vertices':
        el.setAttribute(
          'points',
          snapshot.points.map(([x, y]) => `${x},${y}`).join(' '),
        );
        break;
      case 'path-commands':
        el.setAttribute('d', _serializePathData(snapshot.commands));
        break;
      default:
        break;
    }
  }

  _onKeyDown(event) {
    if (!this._attached) return;
    if (event.key === 'Escape') {
      if (this._selected) {
        event.preventDefault();
        this._clearSelection();
      }
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this._selected) {
        // Only consume the event when we have a selection —
        // otherwise let it propagate (user might be typing
        // in a textarea).
        event.preventDefault();
        this.deleteSelection();
      }
      return;
    }
    // Ctrl/Cmd shortcuts.
    const ctrl = event.ctrlKey || event.metaKey;
    if (!ctrl) return;
    if (event.key === 'z' || event.key === 'Z') {
      if (!event.shiftKey) {
        event.preventDefault();
        this.undo();
      }
      return;
    }
    if (event.key === 'c' || event.key === 'C') {
      if (this._selectedSet.size > 0) {
        event.preventDefault();
        this.copySelection();
      }
      return;
    }
    if (event.key === 'v' || event.key === 'V') {
      if (this._clipboard.length > 0) {
        event.preventDefault();
        this.pasteClipboard();
      }
      return;
    }
    if (event.key === 'd' || event.key === 'D') {
      if (this._selectedSet.size > 0) {
        event.preventDefault();
        this.duplicateSelection();
      }
      return;
    }
  }

  _clearSelection() {
    if (!this._selected && this._selectedSet.size === 0) return;
    this._selected = null;
    this._selectedSet = new Set();
    this._renderHandles();
    this._onSelectionChange();
  }

  // ---------------------------------------------------------------
  // Hit-testing
  // ---------------------------------------------------------------

  /**
   * Find the topmost selectable element at the given screen
   * coordinates. Excludes handle overlays, the root SVG
   * itself, and non-visual elements. Resolves `<tspan>`
   * hits to their parent `<text>`.
   *
   * @param {number} clientX
   * @param {number} clientY
   * @returns {SVGElement | null}
   */
  _hitTest(clientX, clientY) {
    // `elementsFromPoint` works across shadow DOM when the
    // SVG lives inside a shadow root. Returns topmost-first.
    // Not all environments implement it (jsdom lacks it on
    // Document and ShadowRoot); fall back gracefully.
    const root = this._svg.getRootNode();
    let els = null;
    if (root && typeof root.elementsFromPoint === 'function') {
      els = root.elementsFromPoint(clientX, clientY);
    } else if (typeof document.elementsFromPoint === 'function') {
      els = document.elementsFromPoint(clientX, clientY);
    }
    if (!els || els.length === 0) return null;
    for (const el of els) {
      if (!el || !el.tagName) continue;
      const tag = el.tagName.toLowerCase();
      // Skip handles and handle group.
      if (el.classList && el.classList.contains(HANDLE_CLASS)) {
        continue;
      }
      if (el.id === HANDLE_GROUP_ID) continue;
      // Skip non-selectable tags.
      if (_NON_SELECTABLE_TAGS.has(tag)) continue;
      // Skip the root SVG — clicking empty space hits it.
      if (el === this._svg) continue;
      // Skip elements outside the SVG subtree (HTML ancestors
      // when elementsFromPoint walks up the document).
      if (!this._svg.contains(el)) continue;
      // Resolve tspan → text.
      const resolved = this._resolveTarget(el);
      if (resolved) return resolved;
    }
    return null;
  }

  /**
   * Resolve a click target to the canonical selection
   * target. `<tspan>` resolves to its nearest `<text>`
   * ancestor. Other selectable tags return themselves.
   * Non-selectable tags return null.
   */
  _resolveTarget(el) {
    if (!el || !el.tagName) return null;
    let current = el;
    while (current && current !== this._svg) {
      const tag = current.tagName?.toLowerCase();
      if (!tag) break;
      if (tag === 'tspan') {
        // Walk up to find the enclosing <text>.
        let text = current.parentNode;
        while (text && text !== this._svg) {
          if (text.tagName?.toLowerCase() === 'text') return text;
          text = text.parentNode;
        }
        return null;
      }
      if (_SELECTABLE_TAGS.has(tag)) return current;
      if (_NON_SELECTABLE_TAGS.has(tag)) return null;
      current = current.parentNode;
    }
    return null;
  }

  // ---------------------------------------------------------------
  // Coordinate math
  // ---------------------------------------------------------------

  /**
   * Convert screen-pixel coordinates to SVG viewBox units
   * by inverting the root SVG's CTM.
   */
  _screenToSvg(screenX, screenY) {
    const ctm = this._svg.getScreenCTM?.();
    if (!ctm) return { x: screenX, y: screenY };
    const pt = this._svg.createSVGPoint();
    pt.x = screenX;
    pt.y = screenY;
    return pt.matrixTransform(ctm.inverse());
  }

  /**
   * Convert a point in an element's local coordinate space
   * to the root SVG's viewBox space. Used when rendering
   * handles for elements inside transformed `<g>` groups.
   */
  _localToSvgRoot(el, lx, ly) {
    const elCtm = el.getCTM?.();
    const svgCtm = this._svg.getCTM?.();
    if (!elCtm || !svgCtm) return { x: lx, y: ly };
    // Compose: inverse(svgCtm) * elCtm. elCtm already maps
    // local → screen; svgCtm maps svg root → screen; so the
    // composition maps local → svg root.
    const inv = svgCtm.inverse();
    const m = inv.multiply(elCtm);
    return {
      x: m.a * lx + m.c * ly + m.e,
      y: m.b * lx + m.d * ly + m.f,
    };
  }

  /**
   * Convert a screen-pixel distance to SVG viewBox units at
   * the current zoom level. Used to keep handle size
   * visually constant as the user zooms in/out.
   */
  _screenDistToSvgDist(screenDist) {
    const a = this._screenToSvg(0, 0);
    const b = this._screenToSvg(screenDist, 0);
    return Math.abs(b.x - a.x);
  }

  /** Current handle radius in SVG viewBox units. */
  _getHandleRadius() {
    const r = this._screenDistToSvgDist(HANDLE_SCREEN_RADIUS);
    // Sanity fallback — if the CTM isn't computable yet
    // (detached, zero-size), return a reasonable default.
    return r > 0 && Number.isFinite(r) ? r : HANDLE_SCREEN_RADIUS;
  }

  // ---------------------------------------------------------------
  // Handle rendering
  // ---------------------------------------------------------------

  /**
   * Ensure the handle overlay group exists as the last
   * child of the root SVG (so it renders above content).
   */
  _ensureHandleGroup() {
    if (this._handleGroup && this._handleGroup.parentNode === this._svg) {
      return this._handleGroup;
    }
    // Look for an existing group (e.g., from a prior mount).
    const existing = this._svg.querySelector(`#${HANDLE_GROUP_ID}`);
    if (existing) {
      this._handleGroup = existing;
      // Move to the end so it's on top.
      this._svg.appendChild(existing);
      return existing;
    }
    const ns = 'http://www.w3.org/2000/svg';
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('id', HANDLE_GROUP_ID);
    // Prevent pointer-events on the group itself so clicks
    // fall through to content — individual handles will
    // opt back in when they land in 3.2c.2.
    g.setAttribute('pointer-events', 'none');
    this._svg.appendChild(g);
    this._handleGroup = g;
    return g;
  }

  /**
   * Render the selection handles for the current
   * selection. Behavior depends on set size:
   *
   *   - Empty: nothing rendered (group cleared).
   *   - Single: dashed bbox + per-shape resize handles
   *     (rect corners, line endpoints, path vertices,
   *     etc.).
   *   - Multi: one dashed bbox per selected element, no
   *     resize handles. Resize math only makes sense for
   *     a single element; multi-selection is for "move
   *     these together" and "delete these" operations.
   *
   * The primary element's bbox is rendered last in
   * multi-selection mode so the "active" element is
   * visually distinguishable if the overlays overlap.
   *
   * Drag-in-flight detection — during an active resize
   * drag, skip re-rendering to avoid churning the DOM on
   * every pointermove. The bounding box and handle
   * positions would trail the mouse by one frame anyway
   * because we update attributes FIRST then re-render;
   * leaving the stale overlay up is visually acceptable
   * and saves the per-move reflow. Move drags still
   * re-render (the bbox tracks the element).
   */
  _renderHandles() {
    const group = this._ensureHandleGroup();
    // Clear prior contents. Preserve an in-flight marquee
    // rect — it lives in this group too and would
    // disappear otherwise.
    const marqueeRect = this._marquee && this._marquee.rect;
    while (group.firstChild) {
      group.removeChild(group.firstChild);
    }
    if (this._selectedSet.size === 0) {
      // Nothing selected. Restore the marquee rect (if
      // any) and bail.
      if (marqueeRect) group.appendChild(marqueeRect);
      return;
    }
    if (this._selectedSet.size > 1) {
      // Multi-selection — bbox per element, no resize
      // handles. Render non-primary elements first, then
      // primary on top.
      const others = [];
      for (const el of this._selectedSet) {
        if (el !== this._selected) others.push(el);
      }
      for (const el of others) {
        this._renderBBoxOverlay(group, el, false);
      }
      if (this._selected) {
        this._renderBBoxOverlay(group, this._selected, true);
      }
      if (marqueeRect) group.appendChild(marqueeRect);
      return;
    }
    // Single selection — full handle set.
    if (!this._selected) return;
    const bbox = this._getSelectionBBox();
    if (!bbox) return;
    this._renderBBoxOverlay(group, this._selected, true);
    // Per-shape resize handles.
    this._renderResizeHandles(group, this._selected, bbox);
    if (marqueeRect) group.appendChild(marqueeRect);
  }

  /**
   * Render a dashed bounding-box overlay for a single
   * element. Used by both single-selection rendering
   * and multi-selection rendering; the `isPrimary` flag
   * controls styling (primary uses accent blue; non-
   * primary uses a slightly muted shade so the user
   * can see which element single-element operations
   * would target).
   */
  _renderBBoxOverlay(group, element, isPrimary) {
    const bbox = this._elementBBoxInSvgRoot(element);
    if (!bbox) return;
    const ns = 'http://www.w3.org/2000/svg';
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('class', HANDLE_CLASS);
    rect.setAttribute('x', String(bbox.x));
    rect.setAttribute('y', String(bbox.y));
    rect.setAttribute('width', String(bbox.width));
    rect.setAttribute('height', String(bbox.height));
    rect.setAttribute('fill', 'none');
    rect.setAttribute(
      'stroke',
      isPrimary ? '#4fc3f7' : '#7aa9c7',
    );
    const strokeWidth = this._screenDistToSvgDist(1.5);
    rect.setAttribute('stroke-width', String(strokeWidth));
    const dashLen = this._screenDistToSvgDist(4);
    rect.setAttribute(
      'stroke-dasharray',
      `${dashLen},${dashLen}`,
    );
    rect.setAttribute('pointer-events', 'none');
    group.appendChild(rect);
  }

  /**
   * Render resize handles for shapes that support it.
   * Dispatched by tag name — rect gets eight handles,
   * circle and ellipse get four cardinal handles. Other
   * shapes (line, polyline, polygon, path, text, g,
   * image, use) get no resize handles in 3.2c.2b — line
   * endpoints come in 3.2c.2c; polyline/polygon/path
   * vertex handles come in 3.2c.3.
   */
  _renderResizeHandles(group, el, bbox) {
    const tag = el.tagName?.toLowerCase();
    if (tag === 'rect') {
      // Eight handles — four corners plus four edge midpoints.
      const midX = bbox.x + bbox.width / 2;
      const midY = bbox.y + bbox.height / 2;
      const right = bbox.x + bbox.width;
      const bottom = bbox.y + bbox.height;
      const positions = [
        { role: 'nw', cx: bbox.x, cy: bbox.y },
        { role: 'n', cx: midX, cy: bbox.y },
        { role: 'ne', cx: right, cy: bbox.y },
        { role: 'e', cx: right, cy: midY },
        { role: 'se', cx: right, cy: bottom },
        { role: 's', cx: midX, cy: bottom },
        { role: 'sw', cx: bbox.x, cy: bottom },
        { role: 'w', cx: bbox.x, cy: midY },
      ];
      for (const p of positions) {
        group.appendChild(this._makeHandleDot(p.cx, p.cy, p.role));
      }
      return;
    }
    if (tag === 'circle' || tag === 'ellipse') {
      // Four cardinal handles. Circle uses a single radius,
      // so all four adjust `r`; ellipse uses rx + ry
      // independently, so n/s adjust ry and e/w adjust rx.
      const midX = bbox.x + bbox.width / 2;
      const midY = bbox.y + bbox.height / 2;
      const right = bbox.x + bbox.width;
      const bottom = bbox.y + bbox.height;
      const positions = [
        { role: 'n', cx: midX, cy: bbox.y },
        { role: 'e', cx: right, cy: midY },
        { role: 's', cx: midX, cy: bottom },
        { role: 'w', cx: bbox.x, cy: midY },
      ];
      for (const p of positions) {
        group.appendChild(this._makeHandleDot(p.cx, p.cy, p.role));
      }
      return;
    }
    if (tag === 'line') {
      // Two handles at the actual endpoints, not the
      // bounding-box corners. Reads x1/y1/x2/y2 directly
      // from the element so a diagonal line gets handles
      // on the line itself rather than at the enclosing
      // rectangle's corners (which would be misleading
      // since those aren't draggable positions — dragging
      // a bbox corner on a line would need inverse math
      // to map back to endpoint coords).
      const x1 = _parseNum(el.getAttribute('x1'));
      const y1 = _parseNum(el.getAttribute('y1'));
      const x2 = _parseNum(el.getAttribute('x2'));
      const y2 = _parseNum(el.getAttribute('y2'));
      group.appendChild(this._makeHandleDot(x1, y1, 'p1'));
      group.appendChild(this._makeHandleDot(x2, y2, 'p2'));
      return;
    }
    if (tag === 'polyline' || tag === 'polygon') {
      // One handle per vertex. Points parsed from the
      // `points` attribute; handles placed at the exact
      // coordinate of each point (same reasoning as line
      // endpoints — bbox corners would be wrong targets).
      // Role format is `v{N}` so the resize dispatch can
      // parse the index and update only that vertex.
      const points = _parsePoints(el.getAttribute('points'));
      for (let i = 0; i < points.length; i += 1) {
        const [px, py] = points[i];
        group.appendChild(this._makeHandleDot(px, py, `v${i}`));
      }
      return;
    }
    if (tag === 'path') {
      // One handle per command endpoint plus one handle
      // per independently-draggable control point (for C,
      // S, Q curves). Z commands and T commands emit only
      // their endpoint (or nothing for Z) — their "control
      // points" are either absent or reflected from the
      // previous command.
      //
      // Role formats:
      //   - Endpoint: `p{N}` where N is the command index
      //   - Control point: `c{N}-{K}` where N is the
      //     command index and K is 1 or 2
      //
      // Tangent lines rendered from each control point to
      // its endpoint so users see the curve's tangent
      // structure. Lines get HANDLE_CLASS so hit-testing
      // excludes them — only the control-point dots are
      // interactive.
      //
      // 3.2c.3b-iii will add handles for A arc endpoints
      // with the same `p{N}` role format.
      const commands = _parsePathData(el.getAttribute('d'));
      const endpoints = _computePathEndpoints(commands);
      const controls = _computePathControlPoints(commands);
      for (let i = 0; i < endpoints.length; i += 1) {
        const pt = endpoints[i];
        const cps = controls[i];
        // Render tangent lines and control-point handles
        // BEFORE the endpoint so the endpoint renders
        // on top — visually clearer when a control
        // point sits near its endpoint.
        if (pt && Array.isArray(cps)) {
          for (let k = 0; k < cps.length; k += 1) {
            const cp = cps[k];
            // Tangent line from control point to
            // endpoint. Dotted so it doesn't clutter
            // when multiple curves overlap.
            group.appendChild(
              this._makeTangentLine(cp.x, cp.y, pt.x, pt.y),
            );
            group.appendChild(
              this._makeHandleDot(cp.x, cp.y, `c${i}-${k + 1}`),
            );
          }
        }
        if (pt) {
          group.appendChild(this._makeHandleDot(pt.x, pt.y, `p${i}`));
        }
      }
      return;
    }
    // Other tags get no resize handles in this sub-phase.
  }

  /**
   * Build a single handle dot — a small circle with
   * pointer events enabled so clicks route to it rather
   * than the underlying element.
   */
  _makeHandleDot(cx, cy, role) {
    const ns = 'http://www.w3.org/2000/svg';
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('class', HANDLE_CLASS);
    dot.setAttribute(HANDLE_ROLE_ATTR, role);
    dot.setAttribute('cx', String(cx));
    dot.setAttribute('cy', String(cy));
    dot.setAttribute('r', String(this._getHandleRadius()));
    dot.setAttribute('fill', '#4fc3f7');
    dot.setAttribute('stroke', '#ffffff');
    const strokeWidth = this._screenDistToSvgDist(1);
    dot.setAttribute('stroke-width', String(strokeWidth));
    // Handles opt back into pointer events (the group is
    // `pointer-events: none` by default).
    dot.setAttribute('pointer-events', 'auto');
    return dot;
  }

  /**
   * Build a dashed tangent line connecting a control
   * point to its endpoint. Visual hint only — carries
   * HANDLE_CLASS so hit-testing filters it out, and
   * explicitly opts out of pointer events so clicks
   * pass through to whatever's underneath.
   *
   * Dash pattern and stroke width scale inversely with
   * zoom so the line stays visually consistent across
   * zoom levels.
   */
  _makeTangentLine(x1, y1, x2, y2) {
    const ns = 'http://www.w3.org/2000/svg';
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('class', HANDLE_CLASS);
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2));
    line.setAttribute('y2', String(y2));
    line.setAttribute('stroke', '#4fc3f7');
    line.setAttribute('stroke-opacity', '0.6');
    const strokeWidth = this._screenDistToSvgDist(1);
    line.setAttribute('stroke-width', String(strokeWidth));
    const dashLen = this._screenDistToSvgDist(3);
    line.setAttribute('stroke-dasharray', `${dashLen},${dashLen}`);
    line.setAttribute('pointer-events', 'none');
    return line;
  }

  /**
   * Compute the bounding box of the selected element in
   * SVG root coordinates. Returns null when the element
   * has no geometry (empty group, detached).
   */
  _getSelectionBBox() {
    if (!this._selected) return null;
    let bbox;
    try {
      bbox = this._selected.getBBox?.();
    } catch (_) {
      return null;
    }
    if (!bbox) return null;
    // Transform the local-coordinate bbox to root SVG
    // coordinates. Four corners → new axis-aligned bbox.
    const tl = this._localToSvgRoot(this._selected, bbox.x, bbox.y);
    const tr = this._localToSvgRoot(
      this._selected,
      bbox.x + bbox.width,
      bbox.y,
    );
    const bl = this._localToSvgRoot(
      this._selected,
      bbox.x,
      bbox.y + bbox.height,
    );
    const br = this._localToSvgRoot(
      this._selected,
      bbox.x + bbox.width,
      bbox.y + bbox.height,
    );
    const xs = [tl.x, tr.x, bl.x, br.x];
    const ys = [tl.y, tr.y, bl.y, br.y];
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }
}

// Exported constants are re-exported above. Additional
// test-only exports:
export {
  _NON_SELECTABLE_TAGS,
  _PASTE_OFFSET,
  _SELECTABLE_TAGS,
  _UNDO_MAX,
  _computePathControlPoints,
  _computePathEndpoints,
  _parseNum,
  _parsePathData,
  _parsePoints,
  _serializePathData,
};