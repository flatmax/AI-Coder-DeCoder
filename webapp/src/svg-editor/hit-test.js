// Hit-test mixin — pointer-to-element resolution,
// handle-role detection, ancestor walks, and the
// coordinate-conversion primitives that everything else
// builds on.
//
// Methods use `this` to access editor state. Bodies copied
// verbatim from svg-editor.js. References to constants
// use the imported names.

import {
  HANDLE_CLASS,
  HANDLE_GROUP_ID,
  HANDLE_ROLE_ATTR,
  _NON_SELECTABLE_TAGS,
  _SELECTABLE_TAGS,
} from './constants.js';

export default {
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
  },

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
  },

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
  },

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
  },

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
  },

  /**
   * Convert a screen-pixel distance to SVG viewBox units at
   * the current zoom level. Used to keep handle size
   * visually constant as the user zooms in/out.
   */
  _screenDistToSvgDist(screenDist) {
    const a = this._screenToSvg(0, 0);
    const b = this._screenToSvg(screenDist, 0);
    return Math.abs(b.x - a.x);
  },

  /**
   * Blur the currently-focused editable element, if any.
   * Called when an SVG selection becomes active so the
   * document-level keydown listener's editable-target
   * guard stops swallowing Delete / Backspace.
   *
   * The common trigger is the chat textarea retaining
   * focus after the user clicks an SVG element. Without
   * this, Delete routes to the textarea (which has no
   * text to delete, producing a silent no-op) rather
   * than to the editor. A move-drag coincidentally
   * works around the bug because `setPointerCapture`
   * on the SVG pulls focus away from the textarea; the
   * bug only reproduces on click-then-delete.
   *
   * We walk `activeElement` across shadow roots so the
   * chat panel's nested textarea (inside <ac-chat-panel>'s
   * shadow) is found. Non-editable focus (body, a
   * button) is left alone — it isn't the cause.
   */
  _blurEditableFocus() {
    try {
      let active = document.activeElement;
      // Walk into shadow roots — activeElement on a
      // shadow host returns the host element, not the
      // real focused descendant.
      while (active && active.shadowRoot && active.shadowRoot.activeElement) {
        active = active.shadowRoot.activeElement;
      }
      if (!active) return;
      const tag = active.tagName?.toLowerCase();
      const isEditable =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        active.isContentEditable;
      if (isEditable && typeof active.blur === 'function') {
        active.blur();
      }
    } catch (_) {
      // Focus manipulation can throw on detached nodes or
      // in headless environments without a real focus
      // system. The editor still works without the blur;
      // it just falls back to the old "delete only works
      // after a drag" behaviour, which is what the user
      // already reported and worked around.
    }
  },

  /**
   * Check whether any ancestor of `el` (up to but not
   * including the root SVG) is in the current selection
   * set. Used by pointerdown to route clicks on
   * non-selected descendants of selected groups to the
   * group-drag path rather than the replace-selection
   * path.
   */
  _ancestorInSelection(el) {
    if (!el) return false;
    let cur = el.parentNode;
    while (cur && cur !== this._svg) {
      if (this._selectedSet.has(cur)) return true;
      cur = cur.parentNode;
    }
    return false;
  },
};