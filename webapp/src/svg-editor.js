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
// Deferred to 3.2c.2c+:
//   - Line endpoint drag (3.2c.2c)
//   - Vertex edit / inline text edit (3.2c.3)
//   - Multi-selection + marquee (3.2c.4)
//   - Undo stack + copy/paste (3.2c.5)
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

    /** Currently-selected element, or null. */
    this._selected = null;

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

    /** Bound handlers for add/remove symmetry. */
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);

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
    document.removeEventListener('keydown', this._onKeyDown);
    this._clearSelection();
  }

  /**
   * Return the currently-selected element, or null. Reads
   * live — subsequent mutations by the caller are visible.
   */
  getSelection() {
    return this._selected;
  }

  /**
   * Programmatically select an element. Bypasses pointer
   * event machinery; used by tests and by future
   * load-selection flows.
   *
   * @param {SVGElement | null} element
   */
  setSelection(element) {
    const resolved = element ? this._resolveTarget(element) : null;
    if (resolved === this._selected) return;
    this._selected = resolved;
    this._renderHandles();
    this._onSelectionChange();
  }

  /**
   * Delete the currently-selected element from the DOM.
   * Fires `onChange`. No-op when no selection.
   */
  deleteSelection() {
    if (!this._selected) return;
    // If the element has a parent, remove it. Root SVG
    // isn't a valid selection target so this is defensive.
    const parent = this._selected.parentNode;
    if (parent && parent !== this._svg.parentNode) {
      parent.removeChild(this._selected);
      this._selected = null;
      this._renderHandles();
      this._onSelectionChange();
      this._onChange();
    }
  }

  // ---------------------------------------------------------------
  // Pointer handling
  // ---------------------------------------------------------------

  _onPointerDown(event) {
    // Only react to primary button (left-click / touch).
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    // Handle hit-test runs FIRST — when the pointer is over
    // one of the selected element's resize handles, start
    // a resize drag rather than a move/select. Only fires
    // when there's already a selection, so a fresh click on
    // an unselected shape can't accidentally initiate a
    // resize.
    if (this._selected) {
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
      // Click on empty space deselects.
      this._clearSelection();
      return;
    }
    // Stop propagation so the SvgViewer's pan/zoom doesn't
    // also react. Without this, a click would start a pan
    // on the left panel via the sync callback.
    event.stopPropagation();
    // Two cases:
    //   1. Click on the already-selected element → start
    //      drag. The existing selection stays as-is.
    //   2. Click on a different element → select it. Drag
    //      would require a second click; matches most
    //      editors' click-to-select-first, click-to-drag
    //      behavior and prevents accidental drags when
    //      the user is just trying to select.
    if (target === this._selected) {
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
   * Start a drag on the selected element. Captures the
   * pointer so subsequent move events flow here even when
   * the pointer leaves the SVG bounds.
   */
  _beginDrag(event) {
    if (!this._selected) return;
    const origin = this._screenToSvg(event.clientX, event.clientY);
    const originAttrs = this._captureDragAttributes(this._selected);
    if (!originAttrs) {
      // Element isn't draggable (no supported attribute
      // dispatch). Silently drop; selection stays.
      return;
    }
    this._drag = {
      mode: 'move',
      pointerId: event.pointerId,
      startX: origin.x,
      startY: origin.y,
      originAttrs,
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
      // The drag actually moved the element; notify the
      // viewer so it can serialize. Click-without-drag
      // skips this path.
      this._onChange();
    }
  }

  /**
   * Cancel an in-flight drag without committing. Rolls
   * back to the original attribute values and releases
   * pointer capture. Used by detach().
   */
  _cancelDrag() {
    if (!this._drag) return;
    // Roll back to the snapshot. Dispatch by drag mode —
    // move uses position attributes, resize uses dimension
    // attributes.
    if (this._drag.mode === 'resize') {
      this._restoreResizeAttributes(
        this._selected,
        this._drag.originAttrs,
      );
    } else {
      this._restoreDragAttributes(
        this._selected,
        this._drag.originAttrs,
      );
    }
    try {
      this._svg.releasePointerCapture(this._drag.pointerId);
    } catch (_) {}
    this._drag = null;
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
   * Apply a translation delta to the currently-dragging
   * element. Uses the snapshot stored on `_drag.originAttrs`
   * as the origin (so repeated pointermoves don't compound
   * — each move is relative to the drag start, not the
   * previous position).
   */
  _applyDragDelta(dx, dy) {
    if (!this._drag || !this._selected) return;
    const el = this._selected;
    const o = this._drag.originAttrs;
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
  }

  _clearSelection() {
    if (!this._selected) return;
    this._selected = null;
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
   * Render the selection handles for the current selected
   * element. Always draws a dashed bounding-box outline;
   * for rect/circle/ellipse, also draws the per-shape
   * resize handles at their appropriate positions.
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
    // Clear prior contents.
    while (group.firstChild) {
      group.removeChild(group.firstChild);
    }
    if (!this._selected) return;
    const bbox = this._getSelectionBBox();
    if (!bbox) return;
    const ns = 'http://www.w3.org/2000/svg';
    // Bounding-box dashed outline.
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('class', HANDLE_CLASS);
    rect.setAttribute('x', String(bbox.x));
    rect.setAttribute('y', String(bbox.y));
    rect.setAttribute('width', String(bbox.width));
    rect.setAttribute('height', String(bbox.height));
    rect.setAttribute('fill', 'none');
    rect.setAttribute('stroke', '#4fc3f7');
    const strokeWidth = this._screenDistToSvgDist(1.5);
    rect.setAttribute('stroke-width', String(strokeWidth));
    const dashLen = this._screenDistToSvgDist(4);
    rect.setAttribute('stroke-dasharray', `${dashLen},${dashLen}`);
    rect.setAttribute('pointer-events', 'none');
    group.appendChild(rect);
    // Per-shape resize handles.
    this._renderResizeHandles(group, this._selected, bbox);
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
  _SELECTABLE_TAGS,
  _parseNum,
  _parsePoints,
};