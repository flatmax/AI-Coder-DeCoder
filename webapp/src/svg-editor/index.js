// SvgEditor — pointer-based visual editor for an SVG element.
//
// This module composes the editor by Object.assign'ing the
// per-concern mixins (viewport, drag, resize, marquee,
// text-edit, handles, hit-test) onto SvgEditor.prototype.
// The class declared here owns:
//   - construction (state initialization, bound handlers)
//   - the public attach/detach lifecycle
//   - the selection API (getSelection, setSelection,
//     toggleSelection, deleteSelection)
//   - the undo stack and copy/paste/duplicate
//   - the orchestration handlers (_onPointerDown,
//     _onPointerMove, _onPointerUp, _onKeyDown,
//     _cancelDrag, _clearSelection) that route events
//     to mixin methods
//
// Everything else lives in the mixin files. See the
// per-file headers for scope and rationale.
//
// Original design and behaviour notes are preserved from
// the pre-refactor svg-editor.js — the public surface
// (HANDLE_SCREEN_RADIUS, HANDLE_CLASS, HANDLE_GROUP_ID,
// HANDLE_ROLE_ATTR, MARQUEE_ID and the SvgEditor class
// itself) is unchanged.

import {
  HANDLE_CLASS,
  HANDLE_GROUP_ID,
  HANDLE_ROLE_ATTR,
  HANDLE_SCREEN_RADIUS,
  MARQUEE_ID,
  _NON_SELECTABLE_TAGS,
  _PASTE_OFFSET,
  _SELECTABLE_TAGS,
  _UNDO_MAX,
} from './constants.js';
import {
  _computePathControlPoints,
  _computePathEndpoints,
  _elementRootBBox,
  _isEditableTarget,
  _isSingleStraightSegment,
  _parseNum,
  _parsePathData,
  _parsePoints,
  _serializePathData,
} from './geometry.js';
import dragMixin from './drag.js';
import handlesMixin from './handles.js';
import hitTestMixin from './hit-test.js';
import marqueeMixin from './marquee.js';
import resizeMixin from './resize.js';
import textEditMixin from './text-edit.js';
import viewportMixin from './viewport.js';

export class SvgEditor {
  /**
   * @param {SVGSVGElement} svg — the root SVG element to
   *   operate on. Must be attached to the DOM at the time
   *   of `attach()`.
   * @param {object} options
   * @param {() => void} [options.onChange] — called after
   *   any edit operation that modifies the SVG.
   * @param {() => void} [options.onSelectionChange] —
   *   called when the selected element changes.
   * @param {(vb: {x:number,y:number,width:number,height:number}) => void} [options.onViewChange]
   *   — called after any viewBox write (wheel zoom, pan,
   *   fit, external setViewBox). Used by the enclosing
   *   viewer to mirror viewport state to the other pane.
   * @param {boolean} [options.readOnly] — when true, the
   *   editor only performs pan/zoom on its own SVG. All
   *   selection, handles, marquee, keyboard shortcuts,
   *   double-click-to-edit, and mutation paths are
   *   disabled. Used for the left (reference) pane in
   *   the side-by-side viewer.
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
    this._onViewChange = options.onViewChange || (() => {});
    this._readOnly = options.readOnly === true;

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
     * Active pan gesture. Null when not panning;
     * populated on middle-click drag (both modes) or
     * plain drag on empty space in read-only mode.
     * Fields:
     *   pointerId — captured pointer
     *   startScreenX, startScreenY — pointer position in
     *     screen coords at drag start
     *   startViewBox — viewBox at drag start, in SVG
     *     units. Each move computes a delta from the
     *     initial press rather than compounding on the
     *     previous move.
     */
    this._pan = null;

    /**
     * Suppress the onViewChange callback during
     * programmatic viewBox writes where the caller
     * doesn't want to notify (e.g., initial fit, or
     * sync mirror writes from the partner editor).
     * Incremented on enter, decremented on exit — nested
     * suppression works. Public API callers can request
     * suppression via `setViewBox(..., { silent: true })`.
     */
    this._suppressViewChange = 0;

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
    this._onWheel = this._onWheel.bind(this);

    /** Whether `attach()` has been called. */
    this._attached = false;
  }

  // ---------------------------------------------------------------
  // Public API — lifecycle
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
    // Wheel zoom — active in both editable and read-only
    // modes. Non-passive so preventDefault on the event
    // suppresses the browser's default page-scroll.
    this._svg.addEventListener('wheel', this._onWheel, { passive: false });
    // The remaining listeners only apply to the editable
    // mode. Read-only mode is pan/zoom-only; it doesn't
    // select elements, doesn't open text-edit overlays,
    // and doesn't respond to keyboard shortcuts.
    if (!this._readOnly) {
      // Double-click for inline text editing. Uses the
      // composed-aware `dblclick` so clicks targeting a
      // tspan inside a text element still route here.
      this._svg.addEventListener('dblclick', this._onDoubleClick);
      // Keyboard events on document so Escape / Delete work
      // regardless of which element has focus.
      document.addEventListener('keydown', this._onKeyDown);
    }
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
    // Cancel any in-flight pan. Same reasoning — the
    // captured pointer would be orphaned otherwise.
    this._cancelPan();
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
    this._svg.removeEventListener('wheel', this._onWheel);
    if (!this._readOnly) {
      this._svg.removeEventListener('dblclick', this._onDoubleClick);
      document.removeEventListener('keydown', this._onKeyDown);
    }
    this._clearSelection();
  }

  // ---------------------------------------------------------------
  // Public API — selection
  // ---------------------------------------------------------------

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
    // When a selection becomes active, blur any currently-
    // focused editable element so the document-level
    // keydown listener's `_isEditableTarget` guard stops
    // swallowing Delete / Backspace. Without this, clicking
    // an SVG element while focus remains in the chat
    // textarea (the common case) leaves Delete routed to
    // the textarea — it does nothing visible because there's
    // no text to delete, and the user concludes "delete
    // doesn't work on SVGs." A move-drag coincidentally
    // fixes it because `setPointerCapture` on the SVG
    // pulls focus away from the textarea.
    if (resolved) this._blurEditableFocus();
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
      // Dedupe ancestor / descendant overlap so the new
      // addition doesn't create a double-move hazard.
      // Same rule as marquee — if an ancestor is now
      // selected, drop its descendants; if a descendant
      // of an already-selected ancestor was added, drop
      // the descendant.
      this._removeDescendantsOfSelectedAncestors(this._selectedSet);
      // Primary may have been dropped if it was a
      // descendant of an already-selected ancestor.
      if (!this._selectedSet.has(this._selected)) {
        this._selected = this._selectedSet.values().next().value || null;
      }
    }
    this._renderHandles();
    this._onSelectionChange();
    // See setSelection for the rationale on blurring
    // editable focus whenever a selection becomes active.
    if (this._selectedSet.size > 0) this._blurEditableFocus();
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

  /**
   * Snap a single selected line-like element to be
   * exactly horizontal or vertical. Operates on:
   *
   *   - `<line>` — adjust x1/y1 or x2/y2 of the
   *     non-anchor endpoint.
   *   - `<polyline>` with exactly two points — same
   *     idea, edits the `points` attribute.
   *   - `<path>` whose `d` is a single straight segment
   *     (M followed by exactly one L, optionally
   *     followed by Z) — rewrites the L's coordinates.
   *
   * Anchor selection: when the element has a
   * `marker-end` attribute (the arrow's head), the
   * MARKER-END endpoint is anchored — the arrow head
   * stays put, the tail moves to align. This matches
   * intent: "make this arrow point straight at the
   * thing it's pointing at." Without `marker-end`, the
   * second endpoint is anchored (preserves direction
   * of travel for plain lines).
   *
   * `axis` is 'horizontal' (set y values equal — line
   * runs horizontally) or 'vertical' (set x values
   * equal — line runs vertically). No-op for any
   * other input or for selections that aren't snappable.
   *
   * Single undo entry, single onChange — same shape as
   * alignSelection / deleteSelection.
   */
  snapSelectionToAxis(axis) {
    if (this._selectedSet.size !== 1) return;
    if (axis !== 'horizontal' && axis !== 'vertical') return;
    const el = this._selected;
    if (!el) return;
    const tag = el.tagName?.toLowerCase();
    if (tag !== 'line' && tag !== 'polyline' && tag !== 'path') return;
    // Element-attribute snapshot for undo + cancel
    // semantics. Mirrors deleteSelection's approach —
    // capture before mutate, push undo before write.
    if (tag === 'line') {
      this._snapLineToAxis(el, axis);
      return;
    }
    if (tag === 'polyline') {
      this._snapPolylineToAxis(el, axis);
      return;
    }
    if (tag === 'path') {
      this._snapStraightPathToAxis(el, axis);
      return;
    }
  }

  /**
   * Whether the current selection is snappable. Used by
   * the host viewer to decide whether to show the
   * "Make horizontal / Make vertical" entries in the
   * right-click menu.
   *
   *   - Exactly one element selected.
   *   - Element is a `<line>`, a two-point `<polyline>`,
   *     or a `<path>` whose `d` is a single straight
   *     segment.
   *
   * Returns false otherwise. Read-only — no DOM
   * mutation, no event firing.
   */
  canSnapSelectionToAxis() {
    if (this._selectedSet.size !== 1) return false;
    const el = this._selected;
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'line') return true;
    if (tag === 'polyline') {
      const pts = _parsePoints(el.getAttribute('points'));
      return pts.length === 2;
    }
    if (tag === 'path') {
      const cmds = _parsePathData(el.getAttribute('d'));
      return _isSingleStraightSegment(cmds);
    }
    return false;
  }

  /**
   * Snap helper for `<line>`. Anchor selection: the
   * marker-end endpoint (x2/y2) wins when present;
   * otherwise the second endpoint anchors anyway, so
   * either way x2/y2 stays put and x1/y1 moves.
   */
  _snapLineToAxis(el, axis) {
    const x1 = _parseNum(el.getAttribute('x1'));
    const y1 = _parseNum(el.getAttribute('y1'));
    const x2 = _parseNum(el.getAttribute('x2'));
    const y2 = _parseNum(el.getAttribute('y2'));
    let newX1 = x1;
    let newY1 = y1;
    if (axis === 'horizontal') {
      if (y1 === y2) return;
      newY1 = y2;
    } else {
      if (x1 === x2) return;
      newX1 = x2;
    }
    this._pushUndo();
    el.setAttribute('x1', String(newX1));
    el.setAttribute('y1', String(newY1));
    this._renderHandles();
    this._onChange();
  }

  /**
   * Snap helper for two-point `<polyline>`. Same rules
   * as line — second point anchors, first point moves.
   * Three-or-more-point polylines aren't snappable
   * (the operation is ill-defined for a multi-segment
   * path) and the gating in `canSnapSelectionToAxis`
   * already rejects them.
   */
  _snapPolylineToAxis(el, axis) {
    const pts = _parsePoints(el.getAttribute('points'));
    if (pts.length !== 2) return;
    const [[x1, y1], [x2, y2]] = pts;
    let newX1 = x1;
    let newY1 = y1;
    if (axis === 'horizontal') {
      if (y1 === y2) return;
      newY1 = y2;
    } else {
      if (x1 === x2) return;
      newX1 = x2;
    }
    this._pushUndo();
    el.setAttribute('points', `${newX1},${newY1} ${x2},${y2}`);
    this._renderHandles();
    this._onChange();
  }

  /**
   * Snap helper for straight-segment `<path>`. The
   * commands array is M + L (+ optional Z). We rebuild
   * with absolute coordinates regardless of source case
   * — round-tripping through absolute is simpler than
   * preserving relative semantics, and any markers or
   * stroke styling on the path are unaffected.
   */
  _snapStraightPathToAxis(el, axis) {
    const cmds = _parsePathData(el.getAttribute('d'));
    if (!_isSingleStraightSegment(cmds)) return;
    // Compute absolute endpoints. M is always at
    // index 0; L is at index 1. Z (if present) needs no
    // coordinate work.
    const m = cmds[0];
    const l = cmds[1];
    const mAbs = m.cmd === 'M';
    const lAbs = l.cmd === 'L';
    const x1 = m.args[0];
    const y1 = m.args[1];
    const x2 = lAbs ? l.args[0] : x1 + l.args[0];
    const y2 = lAbs ? l.args[1] : y1 + l.args[1];
    let newX1 = x1;
    let newY1 = y1;
    if (axis === 'horizontal') {
      if (y1 === y2) return;
      newY1 = y2;
    } else {
      if (x1 === x2) return;
      newX1 = x2;
    }
    // Rebuild as absolute commands so the round-trip
    // through the parser produces a stable d. Preserve
    // a trailing Z if it was there.
    const newCmds = [
      { cmd: 'M', args: [newX1, newY1] },
      { cmd: 'L', args: [x2, y2] },
    ];
    if (cmds.length === 3) {
      newCmds.push({ cmd: cmds[2].cmd, args: [] });
    }
    this._pushUndo();
    el.setAttribute('d', _serializePathData(newCmds));
    // Any preserved relative-ness in the original is
    // lost — that's fine, the visual is identical and
    // a serialized SVG round-trips cleanly.
    if (mAbs && lAbs) {
      // No-op branch retained as documentation: when
      // the source was already absolute, we wrote the
      // same shape we read.
    }
    this._renderHandles();
    this._onChange();
  }

  /**
   * Align every element in the selection set along the
   * given axis. Requires at least two selected elements
   * — single-element alignment has no group reference,
   * so it's a no-op rather than (e.g.) aligning to the
   * canvas, which would surprise users.
   *
   * `axis` is 'horizontal' (acts on x) or 'vertical'
   * (acts on y). `mode` is 'left' / 'center' / 'right'
   * for horizontal, or 'top' / 'middle' / 'bottom' for
   * vertical. Other combinations are no-ops.
   *
   * The reference is the union bbox of the selection.
   * Each element gets a (dx, dy) computed against its
   * own root-space bbox, then we reuse the drag mixin's
   * `_captureDragAttributes` + `_applyDragDeltaToEntry`
   * + `_restoreDragAttributes` so alignment honors
   * scaled/transformed ancestor chains identically to
   * drag-to-move. Single undo entry, single onChange,
   * single handle re-render — same orchestration shape
   * as `deleteSelection`.
   */
  alignSelection(axis, mode) {
    if (this._selectedSet.size < 2) return;
    if (axis !== 'horizontal' && axis !== 'vertical') return;
    const validHorizontal = mode === 'left' || mode === 'center' || mode === 'right';
    const validVertical = mode === 'top' || mode === 'middle' || mode === 'bottom';
    if (axis === 'horizontal' && !validHorizontal) return;
    if (axis === 'vertical' && !validVertical) return;
    // Collect bboxes. Skip elements we can't measure —
    // matches the drag mixin's "silent drop" rule for
    // unsupported tags.
    const entries = [];
    for (const el of this._selectedSet) {
      const bbox = _elementRootBBox(el, this._svg);
      if (!bbox) continue;
      entries.push({ el, bbox });
    }
    if (entries.length < 2) return;
    // Group bbox — the alignment reference.
    let groupMinX = Infinity;
    let groupMinY = Infinity;
    let groupMaxX = -Infinity;
    let groupMaxY = -Infinity;
    for (const { bbox } of entries) {
      if (bbox.x < groupMinX) groupMinX = bbox.x;
      if (bbox.y < groupMinY) groupMinY = bbox.y;
      if (bbox.x + bbox.width > groupMaxX) groupMaxX = bbox.x + bbox.width;
      if (bbox.y + bbox.height > groupMaxY) groupMaxY = bbox.y + bbox.height;
    }
    const groupCenterX = (groupMinX + groupMaxX) / 2;
    const groupCenterY = (groupMinY + groupMaxY) / 2;
    // Compute per-element delta and capture origin
    // attrs. We capture BEFORE pushing undo so a fully
    // unsupported selection (every element drops out of
    // `_captureDragAttributes`) doesn't waste an undo
    // slot.
    const moves = [];
    for (const { el, bbox } of entries) {
      const elCenterX = bbox.x + bbox.width / 2;
      const elCenterY = bbox.y + bbox.height / 2;
      let dx = 0;
      let dy = 0;
      if (axis === 'horizontal') {
        if (mode === 'left') dx = groupMinX - bbox.x;
        else if (mode === 'right') dx = groupMaxX - (bbox.x + bbox.width);
        else dx = groupCenterX - elCenterX;
      } else {
        if (mode === 'top') dy = groupMinY - bbox.y;
        else if (mode === 'bottom') dy = groupMaxY - (bbox.y + bbox.height);
        else dy = groupCenterY - elCenterY;
      }
      // Skip moves under a sub-pixel threshold —
      // alignment is idempotent on already-aligned
      // elements and we don't want to dirty the file
      // with no-op writes.
      if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) continue;
      const originAttrs = this._captureDragAttributes(el);
      if (!originAttrs) continue;
      moves.push({ el, originAttrs, dx, dy });
    }
    if (moves.length === 0) return;
    this._pushUndo();
    for (const move of moves) {
      this._applyDragDeltaToEntry(move, move.dx, move.dy);
    }
    this._renderHandles();
    this._onChange();
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
          // Prepend — see the main drag dispatch for
          // why this order matters with scaled groups.
          const base = (el.getAttribute('transform') || '').trim();
          const t = `translate(${dx} ${dy})`;
          el.setAttribute('transform', base ? `${t} ${base}` : t);
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
        // Prepend so the translate operates in parent
        // coords (see main drag dispatch for rationale).
        const base = (el.getAttribute('transform') || '').trim();
        const t = `translate(${dx} ${dy})`;
        el.setAttribute('transform', base ? `${t} ${base}` : t);
        break;
      }
    }
  }

  // ---------------------------------------------------------------
  // Pointer orchestration
  // ---------------------------------------------------------------

  _onPointerDown(event) {
    // Middle-click drag pans in both editable and
    // read-only modes. Matches the Inkscape / most-
    // vector-editor convention. Pan begins immediately
    // and doesn't interfere with selection gestures on
    // the other buttons.
    if (event.button === 1) {
      event.stopPropagation();
      event.preventDefault();
      this._beginPan(event);
      return;
    }
    // Only react to primary button (left-click / touch).
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    // Suppress the browser's native drag behavior on
    // `<image>` and `<text>` elements inside the SVG.
    // Without this, clicking an embedded image starts an
    // OS-level image drag that visually "detaches" the
    // image from the canvas and fights our selection /
    // pan gestures. Applied to every primary-button
    // press so it covers read-only pan, editable pan,
    // marquee, and element selection uniformly.
    event.preventDefault();
    // Read-only mode: left-click drag on empty space
    // pans. There's no selection, no marquee, no handles
    // — pan is the only useful gesture on the read-only
    // pane besides wheel zoom. Hit-test is skipped since
    // clicks on real elements are still just pan gestures
    // (nothing to select).
    //
    // preventDefault suppresses the browser's native drag
    // behavior on `<image>` and `<text>` elements — without
    // it, dragging an embedded image in the reference pane
    // initiates an OS-level image drag that fights our pan
    // gesture. stopPropagation keeps the enclosing viewer
    // from reacting too.
    if (this._readOnly) {
      event.stopPropagation();
      event.preventDefault();
      this._beginPan(event);
      return;
    }
    // Shift key takes priority over handle hit-test.
    // Shift+click is always "modify selection" — either
    // toggle-element (on click-without-drag) or marquee
    // (on drag). We begin a marquee unconditionally on
    // shift+pointerdown; the pointerup handler falls
    // back to toggle-element when the marquee never
    // crossed its render threshold AND the pointer was
    // over an element at start. This way shift+drag
    // anywhere (empty space OR over an element) begins
    // a marquee, while shift+click on an element still
    // toggles it cleanly.
    //
    // Without this ordering, a shift+click on a
    // selected element with handles visible would start
    // a resize drag instead of affecting selection.
    if (event.shiftKey) {
      event.stopPropagation();
      const shiftTarget = this._hitTest(event.clientX, event.clientY);
      this._beginMarquee(event);
      if (this._marquee) {
        // Remember the element under the pointer so the
        // click-without-drag path can fall back to
        // toggle-selection on pointerup.
        this._marquee.clickFallbackTarget = shiftTarget;
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
      // Plain drag on empty space in the editable pane
      // starts a marquee. Matches the Illustrator-style
      // convention where empty-space drag is "select
      // region." Click-without-drag (below the marquee
      // threshold) is a no-op on selection — the marquee
      // never renders and end-marquee treats hadRect as
      // false. So a plain click on empty space neither
      // clears nor selects; user explicitly dismisses
      // selection via Escape or by clicking an element
      // that's already the sole selection.
      //
      // Deselection is available via Escape. We don't
      // clear on empty-space click because that would
      // destroy the selection every time the user
      // mistakes a click for a tiny drag — less
      // forgiving than letting Escape be the explicit
      // gesture.
      event.stopPropagation();
      this._beginMarquee(event);
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
    //
    // For case 1 we also accept clicks that landed on a
    // descendant of a selected ancestor. The
    // ancestor-dedupe step (see
    // `_removeDescendantsOfSelectedAncestors`) drops
    // group descendants from the set when their parent
    // group is also selected, so a naive `has(target)`
    // check would miss clicks on the rendered children.
    // Walk up the parent chain — if any ancestor is in
    // the set, the click hits the group-drag path.
    if (
      this._selectedSet.has(target) ||
      this._ancestorInSelection(target)
    ) {
      this._beginDrag(event);
    } else {
      this.setSelection(target);
    }
  }

  _onPointerMove(event) {
    // Pan takes precedence over every other gesture —
    // once a pan is underway, subsequent pointer motion
    // translates the viewBox until pointerup.
    if (this._pan) {
      this._updatePan(event);
      return;
    }
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
    // Pan is finalized before any other gesture —
    // it's a separate pointer interaction from drag /
    // marquee.
    if (this._pan) {
      this._endPan(event);
      return;
    }
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

  _onKeyDown(event) {
    if (!this._attached) return;
    // The listener is on `document`, so every keystroke
    // in the page fires here — including keystrokes in
    // the chat textarea, file picker filter, search
    // input, and any other editable field. Without this
    // guard, Ctrl+C/V/D/Z and Delete/Backspace would
    // hijack keystrokes the user intends for those
    // fields. The editor's own inline text-edit
    // textarea is handled by `_onTextEditKeyDown` which
    // stopPropagation's before we see the event, so it
    // isn't affected.
    //
    // Test: is the event target an input/textarea/
    // contenteditable element? If so, defer to that
    // element's default handling. Escape is the one
    // exception — escape should still clear SVG
    // selection even when focus is elsewhere.
    if (event.key !== 'Escape' && _isEditableTarget(event)) {
      return;
    }
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
}

// Compose the per-concern mixins onto the prototype. Each
// mixin's default export is a plain object whose own
// properties are the methods to install. Object.assign
// copies them straight onto SvgEditor.prototype so they
// behave like normal class methods (visible to subclasses,
// callable via `this.method()`, etc.). Order doesn't
// matter because no two mixins define the same method.
Object.assign(
  SvgEditor.prototype,
  viewportMixin,
  dragMixin,
  resizeMixin,
  marqueeMixin,
  textEditMixin,
  handlesMixin,
  hitTestMixin,
);

// Re-export the public constants and test-relevant helpers
// so consumers (and tests) can keep importing from this
// module without reaching into constants.js / geometry.js
// directly.
export {
  HANDLE_CLASS,
  HANDLE_GROUP_ID,
  HANDLE_ROLE_ATTR,
  HANDLE_SCREEN_RADIUS,
  MARQUEE_ID,
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