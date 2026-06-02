// Resize mixin — capture/apply/restore dimensional
// attributes for resize-handle drag operations.
//
// Methods use `this` to access editor state. Bodies copied
// verbatim from svg-editor.js. References to the parsing
// helpers (which moved to geometry.js) and the resize
// minimum constant (which moved to constants.js) use the
// imported names.

import { _MIN_RESIZE_DIMENSION, _ROTATE_SNAP_DEGREES } from './constants.js';
import {
  _parseNum,
  _parsePathData,
  _parsePoints,
  _serializePathData,
} from './geometry.js';

/**
 * Map a point in SVG root user-coordinate space into the
 * coordinate space of `el`'s parent. The element's own
 * `transform` attribute is applied AFTER positional
 * attributes (and after any prepended transform we write),
 * so a `rotate(θ cx cy)` we write into `el.transform` runs
 * in the PARENT's space — the pivot must be expressed
 * there, not in the root's space.
 *
 * Math: parentCtm maps parent-space → screen; rootCtm
 * maps root-space → screen. So rootToParent =
 * inverse(parentCtm) * rootCtm. Apply that to the
 * root-space point.
 *
 * Returns null when CTMs aren't computable (detached
 * element, zero-size SVG); callers should fall back to
 * the root-space point as a best-effort, which works
 * correctly for elements at the SVG root.
 */
function _rootPointToParentSpace(el, svgRoot, rootX, rootY) {
  const parent = el.parentNode;
  if (!parent || parent === svgRoot) {
    return { x: rootX, y: rootY };
  }
  const parentCtm = parent.getCTM?.();
  const rootCtm = svgRoot.getCTM?.();
  if (!parentCtm || !rootCtm) return null;
  let m;
  try {
    m = parentCtm.inverse().multiply(rootCtm);
  } catch (_) {
    return null;
  }
  return {
    x: m.a * rootX + m.c * rootY + m.e,
    y: m.b * rootX + m.d * rootY + m.f,
  };
}

export default {
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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

  /**
   * Start a rotate drag on the selected element. Captures
   * the element's existing `transform` attribute verbatim
   * so we can prepend a `rotate(θ cx cy)` on each move
   * and restore the original on cancel.
   *
   * The pivot is the bbox center in SVG root coords —
   * computed once at drag start and frozen for the drag's
   * duration. Using a frozen pivot means the angle math
   * stays stable as the element rotates (the bbox would
   * otherwise track the rotated geometry and the pivot
   * would drift).
   *
   * Single-selection only — the rotate handle isn't
   * rendered in multi-selection mode.
   */
  _beginRotateDrag(event) {
    if (!this._selected) return;
    if (this._selectedSet.size !== 1) return;
    const bbox = this._elementBBoxInSvgRoot(this._selected);
    if (!bbox) return;
    const origin = this._screenToSvg(event.clientX, event.clientY);
    // Pivot in SVG root space — used for the angle math
    // (the pointer coords from `_screenToSvg` are in root
    // space too, so the angle stays consistent).
    const pivotRootX = bbox.x + bbox.width / 2;
    const pivotRootY = bbox.y + bbox.height / 2;
    // Pivot in the element's parent's coordinate space —
    // used for the `rotate(θ cx cy)` write. SVG applies
    // the rotate in the parent's space, so a root-space
    // pivot would rotate around the wrong point whenever
    // the element lives inside a transformed ancestor
    // (Y-flip, scale, translate — common for diagrams
    // exported from CAD or hand-authored with a
    // matrix(1,0,0,-1,...) root flip).
    const pivotParent = _rootPointToParentSpace(
      this._selected,
      this._svg,
      pivotRootX,
      pivotRootY,
    ) || { x: pivotRootX, y: pivotRootY };
    const startAngle = Math.atan2(
      origin.y - pivotRootY,
      origin.x - pivotRootX,
    );
    this._drag = {
      mode: 'rotate',
      role: 'rotate',
      pointerId: event.pointerId,
      startX: origin.x,
      startY: origin.y,
      // Root-space pivot for angle computation in
      // `_applyRotateDelta`.
      pivotX: pivotRootX,
      pivotY: pivotRootY,
      // Parent-space pivot for the transform write.
      pivotParentX: pivotParent.x,
      pivotParentY: pivotParent.y,
      startAngle,
      originTransform: this._selected.getAttribute('transform') || '',
      committed: false,
    };
    try {
      this._svg.setPointerCapture(event.pointerId);
    } catch (_) {}
  },

  /**
   * Apply a rotation delta during a rotate drag. The
   * delta is the angle from the pivot to the current
   * pointer minus the angle from the pivot to the
   * drag-start pointer. Shift held → snap to
   * `_ROTATE_SNAP_DEGREES` increments.
   *
   * Writes `rotate(θ cx cy) <existing>` to the
   * `transform` attribute. Prepending (rather than
   * appending) means the rotate operates in the parent's
   * coordinate space — same rationale as the move-drag
   * transform branch. The element's own pre-existing
   * transform stays in place, applied first; then our
   * rotate spins the result around the pivot.
   *
   * `dx` and `dy` are the unused move delta (kept for
   * signature symmetry with the other apply functions);
   * the actual angle computation uses the absolute pointer
   * position from `event` indirectly via `startX + dx`.
   *
   * `snap` (truthy) → round the rotation to
   * `_ROTATE_SNAP_DEGREES` increments. The caller maps
   * Ctrl/Cmd to this flag; see `_onPointerMove` in
   * index.js for why Shift can't be used.
   */
  _applyRotateDelta(dx, dy, snap) {
    if (!this._drag || !this._selected) return;
    if (this._drag.mode !== 'rotate') return;
    const px = this._drag.startX + dx;
    const py = this._drag.startY + dy;
    const currentAngle = Math.atan2(
      py - this._drag.pivotY,
      px - this._drag.pivotX,
    );
    let deltaRad = currentAngle - this._drag.startAngle;
    let deltaDeg = (deltaRad * 180) / Math.PI;
    if (snap) {
      deltaDeg = Math.round(deltaDeg / _ROTATE_SNAP_DEGREES) *
        _ROTATE_SNAP_DEGREES;
    }
    const base = this._drag.originTransform.trim();
    // Pivot is in the parent's coord space — see
    // `_beginRotateDrag` for the rationale. Angle math
    // above used the root-space pivot to stay consistent
    // with the pointer coords from `_screenToSvg`.
    const rot = `rotate(${deltaDeg} ${this._drag.pivotParentX} ${this._drag.pivotParentY})`;
    const combined = base ? `${rot} ${base}` : rot;
    this._selected.setAttribute('transform', combined);
  },

  /**
   * Restore the element's pre-rotate transform on cancel.
   * Mirror of `_restoreDragAttributes` for the transform
   * branch — empty string clears the attribute entirely
   * (we don't want to leave `transform=""` on elements
   * that didn't have one originally).
   */
  _restoreRotateAttributes(el, originTransform) {
    if (!el) return;
    if (originTransform) {
      el.setAttribute('transform', originTransform);
    } else {
      el.removeAttribute('transform');
    }
  },
};