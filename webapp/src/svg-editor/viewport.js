// Viewport mixin — pan, zoom, fit, viewBox management.
//
// Exports a default object whose own-properties are
// methods to be Object.assign'd onto SvgEditor.prototype.
// Methods use `this` to access editor state (no
// self/editor parameter). Bodies are copied verbatim from
// the original svg-editor.js.

export default {
  /**
   * Read the current viewBox as a {x, y, width, height}
   * object. Falls back to a synthetic viewBox derived
   * from width/height attributes if no viewBox is set.
   */
  _getViewBox() {
    const attr = this._svg.getAttribute('viewBox');
    if (attr) {
      const parts = attr.trim().split(/[\s,]+/).map(Number);
      if (parts.length >= 4 && parts.every(Number.isFinite)) {
        return {
          x: parts[0],
          y: parts[1],
          width: parts[2],
          height: parts[3],
        };
      }
    }
    // Fallback: use the SVG's intrinsic width/height.
    // Rare in practice — the viewer normalizes injected
    // SVGs to always have a viewBox.
    const w =
      parseFloat(this._svg.getAttribute('width')) ||
      this._svg.clientWidth ||
      100;
    const h =
      parseFloat(this._svg.getAttribute('height')) ||
      this._svg.clientHeight ||
      100;
    return { x: 0, y: 0, width: w, height: h };
  },

  /**
   * Write the viewBox attribute and fire the
   * `onViewChange` callback (unless suppressed).
   * Internal workhorse for every viewport mutation —
   * wheel zoom, pan, fit-content, public setViewBox.
   */
  _setViewBox(x, y, width, height) {
    // Clamp to sane bounds. Width/height of zero would
    // divide-by-zero in subsequent math and disappear
    // the view entirely.
    const w = Math.max(width, 1e-6);
    const h = Math.max(height, 1e-6);
    this._svg.setAttribute(
      'viewBox',
      `${x} ${y} ${w} ${h}`,
    );
    // Re-render handles / text-edit overlay so their
    // screen-pixel-based sizing refreshes for the new
    // zoom level. Same call used by `notifyViewChanged`
    // from external pan/zoom.
    try {
      this.notifyViewChanged();
    } catch (_) {}
    // Fire the callback unless we're in a suppressed
    // scope (mirror write from the partner editor, or
    // explicit silent API use).
    if (this._suppressViewChange === 0) {
      try {
        this._onViewChange({ x, y, width: w, height: h });
      } catch (err) {
        console.warn('[svg-editor] onViewChange threw', err);
      }
    }
  },

  /**
   * Public API — set the viewBox explicitly. Used by
   * the enclosing viewer to mirror viewport state
   * between panes. Pass `{ silent: true }` to suppress
   * the `onViewChange` callback for this write
   * (required to prevent ping-pong when mirroring).
   *
   * @param {number} x
   * @param {number} y
   * @param {number} width
   * @param {number} height
   * @param {{ silent?: boolean }} [opts]
   */
  setViewBox(x, y, width, height, opts = {}) {
    if (opts.silent) {
      this._suppressViewChange += 1;
      try {
        this._setViewBox(x, y, width, height);
      } finally {
        this._suppressViewChange -= 1;
      }
    } else {
      this._setViewBox(x, y, width, height);
    }
  },

  /**
   * Public API — read current viewBox. Returned object
   * is a plain snapshot; caller mutations don't affect
   * the SVG.
   */
  getViewBox() {
    return this._getViewBox();
  },

  /**
   * Public API — fit the SVG content to the container.
   * Preference order:
   *   1. If the SVG has an authored viewBox attribute
   *      that was preserved from the source, use it as
   *      the baseline (respects the artist's intent).
   *   2. Otherwise fall back to `getBBox()` plus a small
   *      margin.
   * Either way, the shorter axis is expanded so the
   * viewBox aspect ratio matches the container aspect
   * ratio. With `preserveAspectRatio="none"` set on
   * the SVG, this guarantees content renders without
   * stretching.
   *
   * Pass `{ silent: true }` to suppress `onViewChange`
   * for the resulting write — used during initial
   * sync-coupling so the partner editor's initial fit
   * doesn't echo back.
   *
   * @param {{ silent?: boolean }} [opts]
   */
  fitContent(opts = {}) {
    let baseline = null;
    // 1. Try authored viewBox.
    const authored = this._getAuthoredViewBox();
    if (authored) baseline = authored;
    // 2. Fall back to getBBox().
    if (!baseline) {
      try {
        const bb = this._svg.getBBox?.();
        if (bb && bb.width > 0 && bb.height > 0) {
          // Small margin — 3% on each side.
          const mx = bb.width * 0.03;
          const my = bb.height * 0.03;
          baseline = {
            x: bb.x - mx,
            y: bb.y - my,
            width: bb.width + mx * 2,
            height: bb.height + my * 2,
          };
        }
      } catch (_) {
        // getBBox can throw in jsdom or on detached
        // SVGs — fall through with null.
      }
    }
    if (!baseline) {
      // Final fallback: a sensible default that at
      // least renders something.
      baseline = { x: 0, y: 0, width: 100, height: 100 };
    }
    // Expand the shorter axis to match container AR so
    // content renders without stretching under
    // preserveAspectRatio="none".
    const expanded = this._expandToContainerAspect(baseline);
    if (opts.silent) {
      this._suppressViewChange += 1;
      try {
        this._setViewBox(
          expanded.x,
          expanded.y,
          expanded.width,
          expanded.height,
        );
      } finally {
        this._suppressViewChange -= 1;
      }
    } else {
      this._setViewBox(
        expanded.x,
        expanded.y,
        expanded.width,
        expanded.height,
      );
    }
  },

  /**
   * Read the authored viewBox if the viewer preserved
   * one. The viewer stores it on the SVG element as a
   * data attribute before normalization (so a later
   * re-fit can return to the original authored extent
   * instead of whatever the user panned/zoomed to).
   * Returns null if no authored viewBox was captured.
   */
  _getAuthoredViewBox() {
    const attr = this._svg.getAttribute('data-authored-viewbox');
    if (!attr) return null;
    const parts = attr.trim().split(/[\s,]+/).map(Number);
    if (parts.length < 4 || !parts.every(Number.isFinite)) {
      return null;
    }
    return {
      x: parts[0],
      y: parts[1],
      width: parts[2],
      height: parts[3],
    };
  },

  /**
   * Expand a viewBox on its shorter axis so its aspect
   * ratio matches the container's aspect ratio. The
   * content stays anchored to its centre so the
   * original bounds remain visible.
   */
  _expandToContainerAspect(vb) {
    const rect = this._svg.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return { ...vb };
    }
    const containerAR = rect.width / rect.height;
    const vbAR = vb.width / vb.height;
    if (Math.abs(containerAR - vbAR) < 1e-6) {
      return { ...vb };
    }
    if (containerAR > vbAR) {
      // Container is wider than content — expand width.
      const newW = vb.height * containerAR;
      return {
        x: vb.x - (newW - vb.width) / 2,
        y: vb.y,
        width: newW,
        height: vb.height,
      };
    }
    // Container is taller than content — expand height.
    const newH = vb.width / containerAR;
    return {
      x: vb.x,
      y: vb.y - (newH - vb.height) / 2,
      width: vb.width,
      height: newH,
    };
  },

  // ---------------------------------------------------------------
  // Pan gesture
  // ---------------------------------------------------------------

  _beginPan(event) {
    const vb = this._getViewBox();
    this._pan = {
      pointerId: event.pointerId,
      startScreenX: event.clientX,
      startScreenY: event.clientY,
      startViewBox: vb,
    };
    try {
      this._svg.setPointerCapture(event.pointerId);
    } catch (_) {}
  },

  _updatePan(event) {
    if (!this._pan) return;
    if (event.pointerId !== this._pan.pointerId) return;
    // Convert screen-pixel delta to viewBox-unit delta.
    // Screen → SVG at origin vs at delta gives the
    // correct scale regardless of current zoom.
    const a = this._screenToSvg(
      this._pan.startScreenX,
      this._pan.startScreenY,
    );
    const b = this._screenToSvg(event.clientX, event.clientY);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const vb = this._pan.startViewBox;
    // Subtract delta — dragging right should shift the
    // viewBox LEFT so content appears to follow the
    // pointer.
    this._setViewBox(vb.x - dx, vb.y - dy, vb.width, vb.height);
  },

  _endPan(event) {
    if (!this._pan) return;
    if (event.pointerId !== this._pan.pointerId) return;
    try {
      this._svg.releasePointerCapture(event.pointerId);
    } catch (_) {}
    this._pan = null;
  },

  _cancelPan() {
    if (!this._pan) return;
    // Restore the original viewBox on cancel so
    // mid-drag teardown doesn't leave the user looking
    // at a partially-panned view.
    const vb = this._pan.startViewBox;
    this._setViewBox(vb.x, vb.y, vb.width, vb.height);
    try {
      this._svg.releasePointerCapture(this._pan.pointerId);
    } catch (_) {}
    this._pan = null;
  },

  // ---------------------------------------------------------------
  // Wheel zoom
  // ---------------------------------------------------------------

  /**
   * Wheel event handler. Zooms around the cursor
   * position by rewriting the viewBox. Zoom factor
   * derives from the wheel delta; repeated scrolls
   * compound geometrically.
   *
   * Min and max zoom are expressed as viewBox
   * width/height bounds relative to some reference
   * size. We don't know the "natural" size a priori,
   * so we clamp the post-zoom width/height to a
   * generous range. Extreme zoom-in (pixel-scale
   * inspection) and zoom-out (far beyond the content)
   * both work.
   */
  _onWheel(event) {
    event.preventDefault();
    event.stopPropagation();
    // Sensitivity calibrated so a typical single notch
    // is ~15% zoom change. Negative delta = zoom in.
    const delta = event.deltaY;
    if (!Number.isFinite(delta) || delta === 0) return;
    const factor = Math.exp(delta * 0.0015);
    const clampedFactor = Math.max(0.1, Math.min(factor, 10));
    const vb = this._getViewBox();
    // Anchor the zoom on the cursor position: the
    // SVG-coord point under the cursor should stay
    // fixed after the zoom. new_vb = cursor -
    // (cursor - old_vb) * factor, applied per axis.
    const cursor = this._screenToSvg(event.clientX, event.clientY);
    const newWidth = vb.width * clampedFactor;
    const newHeight = vb.height * clampedFactor;
    // Clamp to generous bounds. Width/height of the
    // original authored viewBox is the reference.
    const authored = this._getAuthoredViewBox();
    const refW = authored ? authored.width : vb.width;
    const minW = refW * 0.01;
    const maxW = refW * 100;
    if (newWidth < minW || newWidth > maxW) return;
    const newX = cursor.x - (cursor.x - vb.x) * clampedFactor;
    const newY = cursor.y - (cursor.y - vb.y) * clampedFactor;
    this._setViewBox(newX, newY, newWidth, newHeight);
  },
};