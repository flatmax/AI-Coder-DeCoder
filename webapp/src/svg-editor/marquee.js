// Marquee mixin — shift+drag region selection plus the
// helpers it relies on (candidate enumeration, hit-test,
// element bbox in root coords, marquee rect creation).
//
// Methods use `this` to access editor state. Bodies copied
// verbatim from svg-editor.js. References to constants and
// geometry helpers use the imported names.

import {
  HANDLE_CLASS,
  HANDLE_GROUP_ID,
  MARQUEE_ID,
  _MARQUEE_MIN_SCREEN,
  _NON_SELECTABLE_TAGS,
  _SELECTABLE_TAGS,
} from './constants.js';
import { _bboxContains, _bboxOverlaps } from './geometry.js';

export default {
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
  },

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
  },

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
      // Shift+click without drag.
      // - If the press was on an element, fall back to
      //   toggle-element (preserves the old shift+click
      //   toggle semantics).
      // - If the press was on empty space, no-op on
      //   selection (matches "shift+click empty space"
      //   convention — it doesn't clear, doesn't add).
      if (m.clickFallbackTarget) {
        this.toggleSelection(m.clickFallbackTarget);
      }
      return;
    }
    // Compute the final selection set: baseline ∪ hits.
    const bbox = this._marqueeBBoxFor(m);
    const forward = m.currentX > m.startX && m.currentY > m.startY;
    const hits = this._marqueeHitTest(bbox, forward);
    const next = new Set(m.originalSet);
    for (const el of hits) next.add(el);
    // Dedupe ancestor / descendant overlap — when a
    // group AND its descendants both land in the set,
    // the descendants are redundant. Moving the group
    // moves them automatically; writing each
    // descendant's positional attributes on top of that
    // doubles the effective delta (the child moves both
    // because its x/y changed AND because its ancestor
    // translated). Remove descendants when an ancestor
    // is also selected.
    this._removeDescendantsOfSelectedAncestors(next);
    // Pick a primary. If the baseline was non-empty, keep
    // its primary; otherwise use the first hit.
    let primary = this._selected;
    if (!primary || !next.has(primary)) {
      primary = hits.length > 0 ? hits[0] : null;
      // If the first hit was itself dropped by the
      // ancestor dedupe, walk forward to find one that
      // survived.
      if (primary && !next.has(primary)) {
        primary = null;
        for (const h of hits) {
          if (next.has(h)) {
            primary = h;
            break;
          }
        }
      }
    }
    this._selectedSet = next;
    this._selected = primary;
    this._renderHandles();
    this._onSelectionChange();
  },

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
  },

  /**
   * Remove entries from a selection set when an ancestor
   * is also in the set. A group move translates every
   * descendant via the transform chain; if a descendant's
   * own positional attributes are also mutated by the
   * drag, it ends up moving by 2× the delta (once from
   * its own attribute update, once from the ancestor's
   * transform). Dedupe before drag dispatch so the drag
   * writes exactly one position for each visually-moved
   * element.
   *
   * Mutates the set in place. O(n²) in the number of
   * selected elements — fine for typical multi-selection
   * sizes (tens of items). If this ever becomes a hot
   * path, switch to a single DOM walk that marks
   * "selected ancestor above me" bottom-up.
   */
  _removeDescendantsOfSelectedAncestors(set) {
    const toRemove = [];
    for (const el of set) {
      let parent = el.parentNode;
      while (parent && parent !== this._svg) {
        if (set.has(parent)) {
          toRemove.push(el);
          break;
        }
        parent = parent.parentNode;
      }
    }
    for (const el of toRemove) set.delete(el);
  },

  /**
   * Walk the SVG DOM collecting candidate elements for
   * marquee hit-test. Recursively descends through every
   * `<g>` group so deeply-nested elements (typical of
   * exported SVGs that wrap content in styling layers)
   * are reachable. The ancestor-dedupe step in
   * `_endMarquee` drops descendants whose ancestor is
   * also selected, so adding everything here doesn't
   * cause double-moves on group drag — it just means
   * the marquee can find shapes regardless of how the
   * source SVG nests them.
   */
  _marqueeCandidates() {
    const out = [];
    const visit = (node) => {
      if (!node || !node.tagName) return;
      const tag = node.tagName.toLowerCase();
      if (_NON_SELECTABLE_TAGS.has(tag)) return;
      if (node.classList && node.classList.contains(HANDLE_CLASS)) {
        return;
      }
      if (node.id === HANDLE_GROUP_ID) return;
      if (tag === 'g') {
        // Group itself is selectable, and we descend
        // into its children so nested shapes are
        // reachable too.
        out.push(node);
        for (const child of Array.from(node.children)) {
          visit(child);
        }
        return;
      }
      if (_SELECTABLE_TAGS.has(tag)) {
        out.push(node);
      }
    };
    for (const child of Array.from(this._svg.children)) {
      visit(child);
    }
    return out;
  },

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
  },

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
  },

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
  },

  /** Axis-aligned bbox from the marquee's start and
   * current points. Read from `this._marquee`. */
  _marqueeBBox() {
    return this._marqueeBBoxFor(this._marquee);
  },

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
  },

  /** Convert an SVG-unit distance to screen pixels.
   * Inverse of `_screenDistToSvgDist`. Used by the
   * marquee threshold check. */
  _svgDistToScreenDist(svgDist) {
    if (svgDist === 0) return 0;
    const per = this._screenDistToSvgDist(1);
    return per > 0 ? svgDist / per : svgDist;
  },
};