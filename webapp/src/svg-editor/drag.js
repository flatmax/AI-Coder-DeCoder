// Drag mixin — capture/apply/restore positional
// attributes for move-drag operations.
//
// Methods use `this` to access editor state. Bodies copied
// verbatim from svg-editor.js. References to the parsing
// helpers (which moved to geometry.js) use the imported
// names.

import { _parseNum, _parsePoints } from './geometry.js';

export default {
  /**
   * Capture the parent-chain transform that maps the
   * element's local coordinate space to the SVG root.
   * Returns a `{sx, sy}` object giving how many local-
   * space units equal one SVG-root unit along each axis.
   *
   * For an element at the SVG root with no ancestor
   * transforms, {sx: 1, sy: 1}. For an element inside
   * `<g transform="scale(2)">`, {sx: 0.5, sy: 0.5} —
   * a 1-unit drag in root space corresponds to 0.5
   * local units, which rendered through the scale(2)
   * produces 1 root unit of visual movement.
   *
   * Critically this is the PARENT's CTM, not the
   * element's own. The element's own transform attribute
   * (if any) is applied AFTER positional attributes, so
   * positional attribute writes should be in the parent's
   * space, not the element's.
   *
   * Read-only math — no attribute writes. Called at drag
   * start; the resulting scale is stored in the snapshot.
   */
  _captureLocalScale(el) {
    const parent = el.parentNode;
    if (!parent || parent === this._svg) {
      return { sx: 1, sy: 1 };
    }
    const parentCtm = parent.getCTM?.();
    const svgCtm = this._svg.getCTM?.();
    if (!parentCtm || !svgCtm) return { sx: 1, sy: 1 };
    // Compose inverse(parent) * svgRoot to get the
    // root-to-parent-local transform. The (a, d) entries
    // give per-axis scaling (ignoring rotation/shear —
    // which drag-as-translate in local space doesn't
    // cleanly support anyway). For pure-translate ancestor
    // chains (a=1, d=1) this returns {sx: 1, sy: 1} as
    // expected; for scaled groups it returns the inverse
    // scale.
    const svgToParent = parentCtm.inverse().multiply(svgCtm);
    const sx = Math.abs(svgToParent.a) || 1;
    const sy = Math.abs(svgToParent.d) || 1;
    return { sx, sy };
  },

  /**
   * Capture the current positional attributes of an
   * element into a snapshot that can be used as the
   * origin for a drag operation. Returns null when the
   * element doesn't match any supported dispatch case.
   *
   * Every snapshot also carries a `localScale: {sx, sy}`
   * field — the conversion factor from SVG-root units
   * to the element's local coordinate space, used by
   * `_applyDragDeltaToEntry` to emit correct local
   * coordinates when the element lives inside a scaled
   * `<g>`.
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
    const localScale = this._captureLocalScale(el);
    switch (tag) {
      case 'rect':
      case 'image':
      case 'use':
        return {
          kind: 'xy',
          localScale,
          x: _parseNum(el.getAttribute('x')),
          y: _parseNum(el.getAttribute('y')),
        };
      case 'circle':
      case 'ellipse':
        return {
          kind: 'cxcy',
          localScale,
          cx: _parseNum(el.getAttribute('cx')),
          cy: _parseNum(el.getAttribute('cy')),
        };
      case 'line':
        return {
          kind: 'line',
          localScale,
          x1: _parseNum(el.getAttribute('x1')),
          y1: _parseNum(el.getAttribute('y1')),
          x2: _parseNum(el.getAttribute('x2')),
          y2: _parseNum(el.getAttribute('y2')),
        };
      case 'polyline':
      case 'polygon':
        return {
          kind: 'points',
          localScale,
          points: _parsePoints(el.getAttribute('points')),
        };
      case 'text': {
        // text can use either x/y attributes or a
        // transform. Auto-detect: if the element has a
        // transform attribute, use that (preserves
        // existing transform like rotate()); otherwise
        // use x/y.
        //
        // For the transform branch we use localScale
        // computed against the element itself's parent —
        // prepending a translate operates in that parent's
        // coord space and localScale isn't needed (the
        // prepended translate is applied last, in parent
        // space). We still include localScale in the
        // snapshot for shape uniformity; the 'transform'
        // branch in `_applyDragDeltaToEntry` ignores it.
        if (el.hasAttribute('transform')) {
          return {
            kind: 'transform',
            localScale,
            transform: el.getAttribute('transform') || '',
          };
        }
        return {
          kind: 'xy',
          localScale,
          x: _parseNum(el.getAttribute('x')),
          y: _parseNum(el.getAttribute('y')),
        };
      }
      case 'path':
      case 'g':
        return {
          kind: 'transform',
          localScale,
          transform: el.getAttribute('transform') || '',
        };
      default:
        return null;
    }
  },

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
  },

  /**
   * Apply a drag delta to a single entry (element +
   * snapshot). Extracted from `_applyDragDelta` so the
   * per-element logic stays in one place; the outer
   * method just iterates.
   *
   * `dx` and `dy` are in SVG-root coordinate units. For
   * positional-attribute branches (xy, cxcy, line,
   * points), the attribute values are in the element's
   * LOCAL coordinate space — if the element sits inside
   * `<g transform="scale(2)">`, one local unit equals
   * two root units visually. We divide dx/dy by the
   * captured localScale to emit the correct local-space
   * delta, so the rendered element moves by exactly
   * dx/dy in root units regardless of ancestor transforms.
   *
   * The 'transform' branch doesn't need the correction
   * because prepended translates operate in the parent's
   * coordinate space, which is where dx/dy are already
   * expressed once the parent chain unwinds.
   */
  _applyDragDeltaToEntry(entry, dx, dy) {
    const el = entry.el;
    const o = entry.originAttrs;
    const scale = o.localScale || { sx: 1, sy: 1 };
    const localDx = dx / scale.sx;
    const localDy = dy / scale.sy;
    switch (o.kind) {
      case 'xy':
        el.setAttribute('x', String(o.x + localDx));
        el.setAttribute('y', String(o.y + localDy));
        break;
      case 'cxcy':
        el.setAttribute('cx', String(o.cx + localDx));
        el.setAttribute('cy', String(o.cy + localDy));
        break;
      case 'line':
        el.setAttribute('x1', String(o.x1 + localDx));
        el.setAttribute('y1', String(o.y1 + localDy));
        el.setAttribute('x2', String(o.x2 + localDx));
        el.setAttribute('y2', String(o.y2 + localDy));
        break;
      case 'points': {
        const shifted = o.points
          .map(([x, y]) => `${x + localDx},${y + localDy}`)
          .join(' ');
        el.setAttribute('points', shifted);
        break;
      }
      case 'transform': {
        // Prepend a translate(dx, dy) to the existing
        // transform. SVG applies transform chains
        // right-to-left in element-local space: an
        // APPENDED translate would be applied FIRST
        // (before the element's own scale/rotate),
        // meaning a scaled group would move the element
        // by (scale * dx, scale * dy) — faster or slower
        // than the pointer depending on the group's scale
        // factor. Prepending puts our translate LAST in
        // application order, operating in the PARENT's
        // coordinate space. The element then moves by
        // exactly (dx, dy) in SVG root coords, matching
        // the pointer 1:1 regardless of any intermediate
        // scale or rotation.
        //
        // Use dx/dy (root-space) directly here — NOT
        // localDx/localDy. Prepended translates run in
        // the parent's space; the chain of ancestor
        // transforms then maps that parent space up to
        // SVG root. If every ancestor is a simple
        // translate, parent space equals root space and
        // the two are identical. If ancestors scale, the
        // scaling applies to the ORIGINAL transform chain
        // (which stays on the right of our prepend) —
        // our prepended translate runs after all of that
        // in the parent's direct space, so dx/dy in root
        // units are what we want.
        const base = o.transform.trim();
        const delta = `translate(${dx} ${dy})`;
        const combined = base ? `${delta} ${base}` : delta;
        el.setAttribute('transform', combined);
        break;
      }
      default:
        break;
    }
  },

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
  },

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
  },
};