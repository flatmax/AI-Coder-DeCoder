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
// Deferred to 3.2c.2+:
//   - Move / resize / vertex edit (3.2c.2)
//   - Inline text edit via <foreignObject> (3.2c.3)
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

    /** Bound handlers for add/remove symmetry. */
    this._onPointerDown = this._onPointerDown.bind(this);
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
    // shifts and to prepare for drag handling in later
    // sub-phases.
    this._svg.addEventListener('pointerdown', this._onPointerDown);
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
    this._svg.removeEventListener(
      'pointerdown',
      this._onPointerDown,
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
    this.setSelection(target);
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
   * element. For 3.2c.1 this is just a bounding-box
   * rectangle — the interactive corner/edge/vertex handles
   * land in 3.2c.2.
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
export { _NON_SELECTABLE_TAGS, _SELECTABLE_TAGS };