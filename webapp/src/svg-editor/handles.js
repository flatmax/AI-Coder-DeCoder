// Handles mixin — handle-overlay rendering: bbox,
// per-shape resize handles, vertex handles, control-point
// handles with tangent lines, plus the lazy handle group
// container.
//
// Methods use `this` to access editor state. Bodies copied
// verbatim from svg-editor.js. References to constants
// and geometry helpers use the imported names.

import {
  HANDLE_CLASS,
  HANDLE_GROUP_ID,
  HANDLE_ROLE_ATTR,
  HANDLE_SCREEN_RADIUS,
  _ROTATE_HANDLE_OFFSET,
} from './constants.js';
import {
  _computePathControlPoints,
  _computePathEndpoints,
  _parseNum,
  _parsePathData,
  _parsePoints,
} from './geometry.js';

export default {
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
  },

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
    // Rotate handle — floats above the bbox top edge.
    this._renderRotateHandle(group, bbox);
    if (marqueeRect) group.appendChild(marqueeRect);
  },

  /**
   * Render the rotate handle above the bbox top edge.
   * A small dashed line connects the bbox top-center to
   * the handle dot so the spatial relationship is clear.
   * Both elements opt out of pointer events except the
   * dot itself, which carries the `rotate` role.
   *
   * Offset is in screen pixels (converted to SVG units
   * per zoom) so the gap stays visually constant.
   */
  _renderRotateHandle(group, bbox) {
    const offset = this._screenDistToSvgDist(_ROTATE_HANDLE_OFFSET);
    const cx = bbox.x + bbox.width / 2;
    const topY = bbox.y;
    const handleY = topY - offset;
    // Tangent line from bbox top-center to handle.
    group.appendChild(
      this._makeTangentLine(cx, topY, cx, handleY),
    );
    // Handle dot. Distinct fill from resize handles so
    // it's visually identifiable as a rotation control.
    const dot = this._makeHandleDot(cx, handleY, 'rotate');
    dot.setAttribute('fill', '#ffd54f');
    group.appendChild(dot);
  },

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
  },

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
      //
      // The attribute values are in the element's LOCAL
      // coordinate space. If the element lives inside a
      // transformed ancestor (e.g., a Y-flipping group
      // in Y-up source SVGs), the local coords don't
      // match the root-space coords where the handle
      // group renders. Map through the element's CTM
      // so handles land on the line visually rather
      // than at mirrored positions elsewhere in the
      // viewport.
      const x1 = _parseNum(el.getAttribute('x1'));
      const y1 = _parseNum(el.getAttribute('y1'));
      const x2 = _parseNum(el.getAttribute('x2'));
      const y2 = _parseNum(el.getAttribute('y2'));
      const p1 = this._localToSvgRoot(el, x1, y1);
      const p2 = this._localToSvgRoot(el, x2, y2);
      group.appendChild(this._makeHandleDot(p1.x, p1.y, 'p1'));
      group.appendChild(this._makeHandleDot(p2.x, p2.y, 'p2'));
      return;
    }
    if (tag === 'polyline' || tag === 'polygon') {
      // One handle per vertex. Points parsed from the
      // `points` attribute; handles placed at the exact
      // coordinate of each point (same reasoning as line
      // endpoints — bbox corners would be wrong targets).
      // Role format is `v{N}` so the resize dispatch can
      // parse the index and update only that vertex.
      //
      // Points are in local coords — map to root space
      // so handles land on the actual vertices regardless
      // of ancestor transforms. See the line branch for
      // the full rationale.
      const points = _parsePoints(el.getAttribute('points'));
      for (let i = 0; i < points.length; i += 1) {
        const [px, py] = points[i];
        const mapped = this._localToSvgRoot(el, px, py);
        group.appendChild(
          this._makeHandleDot(mapped.x, mapped.y, `v${i}`),
        );
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
      // Endpoints and control points are in the element's
      // local coordinate space — same as polyline vertices
      // and line endpoints. Map each through the element's
      // CTM before placing handles, so a path inside a
      // transformed ancestor (common for Y-up source SVGs
      // with a matrix(1,0,0,-1,...) root flip) gets handles
      // visually aligned with the path rather than mirrored
      // to the other side of the viewport.
      const commands = _parsePathData(el.getAttribute('d'));
      const endpoints = _computePathEndpoints(commands);
      const controls = _computePathControlPoints(commands);
      for (let i = 0; i < endpoints.length; i += 1) {
        const pt = endpoints[i];
        const cps = controls[i];
        const mappedPt = pt
          ? this._localToSvgRoot(el, pt.x, pt.y)
          : null;
        // Render tangent lines and control-point handles
        // BEFORE the endpoint so the endpoint renders
        // on top — visually clearer when a control
        // point sits near its endpoint.
        if (mappedPt && Array.isArray(cps)) {
          for (let k = 0; k < cps.length; k += 1) {
            const cp = cps[k];
            const mappedCp = this._localToSvgRoot(el, cp.x, cp.y);
            // Tangent line from control point to
            // endpoint. Dotted so it doesn't clutter
            // when multiple curves overlap.
            group.appendChild(
              this._makeTangentLine(
                mappedCp.x,
                mappedCp.y,
                mappedPt.x,
                mappedPt.y,
              ),
            );
            group.appendChild(
              this._makeHandleDot(
                mappedCp.x,
                mappedCp.y,
                `c${i}-${k + 1}`,
              ),
            );
          }
        }
        if (mappedPt) {
          group.appendChild(
            this._makeHandleDot(mappedPt.x, mappedPt.y, `p${i}`),
          );
        }
      }
      return;
    }
    // Other tags get no resize handles in this sub-phase.
  },

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
  },

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
  },

  /**
   * Compute the bounding box of the selected element in
   * SVG root coordinates. Returns null when the element
   * has no geometry (empty group, detached).
   *
   * Delegates to `_elementBBoxInSvgRoot`, which uses
   * `getBoundingClientRect` to sample the element's
   * painted screen extent and maps it back through the
   * root CTM. The alternative — `getBBox()` plus
   * `_localToSvgRoot` corner mapping — gives the wrong
   * result when the element lives inside a Y-flipping
   * ancestor group (the common case for SVGs exported
   * from CAD / plotting tools that use a Y-up coordinate
   * system, transformed via `matrix(1,0,0,-1,0,H)` at
   * the root).
   *
   * Symptom of using the local→root path: the outline
   * rectangle renders at one location (because
   * `_renderBBoxOverlay` uses `_elementBBoxInSvgRoot`
   * directly) while resize handles render mirrored
   * across the viewport. Both paths are supposed to
   * produce identical root-space axis-aligned bboxes,
   * but CTM composition with a flipping parent disagrees
   * with the painted screen rect in practice. Using the
   * screen-rect path for both keeps them in lockstep.
   */
  _getSelectionBBox() {
    if (!this._selected) return null;
    return this._elementBBoxInSvgRoot(this._selected);
  },

  /** Current handle radius in SVG viewBox units. */
  _getHandleRadius() {
    const r = this._screenDistToSvgDist(HANDLE_SCREEN_RADIUS);
    // Sanity fallback — if the CTM isn't computable yet
    // (detached, zero-size), return a reasonable default.
    return r > 0 && Number.isFinite(r) ? r : HANDLE_SCREEN_RADIUS;
  },

  /**
   * Notify the editor that the SVG's view transform has
   * changed (pan, zoom, resize). Forces a re-render of
   * the handle overlay so stroke width, dash length,
   * and handle radius — all computed from the current
   * CTM via `_screenDistToSvgDist` — recompute at the
   * new zoom and stay visually constant in screen space.
   *
   * Safe to call when no element is selected; becomes a
   * no-op. Called by the hosting viewer from its
   * pan/zoom event callbacks.
   *
   * Doesn't re-measure the selected element's bbox (it
   * scales with zoom automatically since it's in SVG
   * user units), but the attributes of handle dots and
   * bbox outline need refreshing because they were baked
   * in user units computed at the previous zoom level.
   */
  notifyViewChanged() {
    if (this._selectedSet.size === 0 && !this._textEdit) return;
    this._renderHandles();
    // If a text edit is in flight, rebuild its overlay
    // so the foreignObject position, size, and font-size
    // — all derived from the current CTM — refresh to
    // match the new zoom. Preserve the in-progress
    // textarea value and caret/selection so the user
    // doesn't lose work mid-edit.
    if (this._textEdit) {
      const edit = this._textEdit;
      const liveValue = edit.textarea.value;
      let caretStart = liveValue.length;
      let caretEnd = liveValue.length;
      try {
        caretStart = edit.textarea.selectionStart ?? caretStart;
        caretEnd = edit.textarea.selectionEnd ?? caretEnd;
      } catch (_) {}
      this._teardownTextEditOverlay(edit);
      const overlay = this._renderTextEditOverlay(
        edit.element,
        liveValue,
      );
      if (overlay) {
        this._textEdit = {
          element: edit.element,
          originalContent: edit.originalContent,
          foreignObject: overlay.foreignObject,
          textarea: overlay.textarea,
        };
        try {
          overlay.textarea.focus();
          overlay.textarea.setSelectionRange?.(
            caretStart,
            caretEnd,
          );
        } catch (_) {}
      } else {
        // Rebuild failed (bbox unmeasurable after
        // transform change) — drop the edit state to
        // avoid an orphaned reference.
        this._textEdit = null;
      }
    }
  },
};