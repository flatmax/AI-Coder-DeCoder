/**
 * SvgEditor — standalone SVG element editing via native pointer events.
 *
 * Takes an SVG element and makes its children draggable/resizable.
 * Uses SVGElement.getScreenCTM().inverse() for accurate coordinate conversion
 * that works correctly inside Shadow DOM.
 *
 * Not a web component — just a plain ES class.
 */

// Handle radius in SVG units for hit-testing and rendering
const HANDLE_RADIUS = 6;
const ENDPOINT_HIT_THRESHOLD = 8;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 40;
const ZOOM_SENSITIVITY = 0.002;

// CSS class for overlay handles so we can skip them during hit-testing
const HANDLE_CLASS = 'svg-editor-handle';
const HANDLE_GROUP_ID = 'svg-editor-handles';

/**
 * Determine the interaction model for an SVG element.
 * Returns { drag, endpoints, resize } flags.
 */
function _getInteractionModel(el) {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case 'rect':
      return { drag: true, endpoints: false, resize: true };
    case 'circle':
      return { drag: true, endpoints: false, resize: true };
    case 'ellipse':
      return { drag: true, endpoints: false, resize: true };
    case 'line':
      return { drag: true, endpoints: true, resize: false };
    case 'polyline':
    case 'polygon':
      return { drag: true, endpoints: true, resize: false };
    case 'path':
      return { drag: true, endpoints: true, resize: false };
    case 'text':
      return { drag: true, endpoints: false, resize: false };
    case 'g':
    case 'image':
    case 'use':
    case 'foreignobject':
      return { drag: true, endpoints: false, resize: false };
    default:
      return { drag: false, endpoints: false, resize: false };
  }
}

/**
 * Parse a path's `d` attribute into an array of command objects.
 * Each object: { cmd, args: [numbers...], startIndex, endIndex }
 * Supports M, L, Q, C, S, T, A, H, V, Z and lowercase variants.
 */
function _parsePathData(d) {
  const commands = [];
  const re = /([MLHVCSQTAZmlhvcsqtaz])\s*([-\d.,eE\s]*)/g;
  let m;
  while ((m = re.exec(d)) !== null) {
    const cmd = m[1];
    const argStr = m[2].trim();
    const args = argStr.length > 0
      ? argStr.split(/[\s,]+/).map(Number)
      : [];
    commands.push({ cmd, args });
  }
  return commands;
}

/**
 * Serialize parsed path commands back to a `d` attribute string.
 */
function _serializePathData(commands) {
  return commands.map(c => {
    if (c.args.length === 0) return c.cmd;
    return c.cmd + ' ' + c.args.map(n => Math.round(n * 1000) / 1000).join(' ');
  }).join(' ');
}

/**
 * Extract draggable control points from parsed path commands.
 * Returns array of { x, y, cmdIndex, argIndex, type }
 * where type is 'endpoint' or 'control'.
 */
function _extractPathPoints(commands) {
  const points = [];
  let curX = 0, curY = 0;
  let startX = 0, startY = 0;

  for (let ci = 0; ci < commands.length; ci++) {
    const { cmd, args } = commands[ci];
    const upper = cmd.toUpperCase();
    const isRel = cmd !== upper;

    if (upper === 'M') {
      const x = isRel ? curX + args[0] : args[0];
      const y = isRel ? curY + args[1] : args[1];
      points.push({ x, y, cmdIndex: ci, argIndex: 0, type: 'endpoint' });
      curX = x; curY = y;
      startX = x; startY = y;
    } else if (upper === 'L') {
      const x = isRel ? curX + args[0] : args[0];
      const y = isRel ? curY + args[1] : args[1];
      points.push({ x, y, cmdIndex: ci, argIndex: 0, type: 'endpoint' });
      curX = x; curY = y;
    } else if (upper === 'H') {
      const x = isRel ? curX + args[0] : args[0];
      points.push({ x, y: curY, cmdIndex: ci, argIndex: 0, type: 'endpoint' });
      curX = x;
    } else if (upper === 'V') {
      const y = isRel ? curY + args[0] : args[0];
      points.push({ x: curX, y, cmdIndex: ci, argIndex: 0, type: 'endpoint' });
      curY = y;
    } else if (upper === 'Q') {
      // Quadratic: control point + endpoint
      const cpx = isRel ? curX + args[0] : args[0];
      const cpy = isRel ? curY + args[1] : args[1];
      const ex = isRel ? curX + args[2] : args[2];
      const ey = isRel ? curY + args[3] : args[3];
      points.push({ x: cpx, y: cpy, cmdIndex: ci, argIndex: 0, type: 'control' });
      points.push({ x: ex, y: ey, cmdIndex: ci, argIndex: 2, type: 'endpoint' });
      curX = ex; curY = ey;
    } else if (upper === 'C') {
      // Cubic: two control points + endpoint
      const cp1x = isRel ? curX + args[0] : args[0];
      const cp1y = isRel ? curY + args[1] : args[1];
      const cp2x = isRel ? curX + args[2] : args[2];
      const cp2y = isRel ? curY + args[3] : args[3];
      const ex = isRel ? curX + args[4] : args[4];
      const ey = isRel ? curY + args[5] : args[5];
      points.push({ x: cp1x, y: cp1y, cmdIndex: ci, argIndex: 0, type: 'control' });
      points.push({ x: cp2x, y: cp2y, cmdIndex: ci, argIndex: 2, type: 'control' });
      points.push({ x: ex, y: ey, cmdIndex: ci, argIndex: 4, type: 'endpoint' });
      curX = ex; curY = ey;
    } else if (upper === 'S') {
      // Smooth cubic: one control point + endpoint
      const cpx = isRel ? curX + args[0] : args[0];
      const cpy = isRel ? curY + args[1] : args[1];
      const ex = isRel ? curX + args[2] : args[2];
      const ey = isRel ? curY + args[3] : args[3];
      points.push({ x: cpx, y: cpy, cmdIndex: ci, argIndex: 0, type: 'control' });
      points.push({ x: ex, y: ey, cmdIndex: ci, argIndex: 2, type: 'endpoint' });
      curX = ex; curY = ey;
    } else if (upper === 'T') {
      // Smooth quadratic: just endpoint
      const ex = isRel ? curX + args[0] : args[0];
      const ey = isRel ? curY + args[1] : args[1];
      points.push({ x: ex, y: ey, cmdIndex: ci, argIndex: 0, type: 'endpoint' });
      curX = ex; curY = ey;
    } else if (upper === 'A') {
      // Arc: endpoint at args[5], args[6]
      const ex = isRel ? curX + args[5] : args[5];
      const ey = isRel ? curY + args[6] : args[6];
      points.push({ x: ex, y: ey, cmdIndex: ci, argIndex: 5, type: 'endpoint' });
      curX = ex; curY = ey;
    } else if (upper === 'Z') {
      curX = startX; curY = startY;
    }
  }
  return points;
}

/**
 * Parse a `transform` attribute and extract the translate(tx, ty) values.
 * Returns { tx, ty }. If no translate is present, returns { tx: 0, ty: 0 }.
 */
function _parseTranslate(el) {
  const attr = el.getAttribute('transform') || '';
  const m = attr.match(/translate\(\s*([-\d.e]+)[\s,]+([-\d.e]+)\s*\)/);
  if (m) return { tx: parseFloat(m[1]), ty: parseFloat(m[2]) };
  return { tx: 0, ty: 0 };
}

/**
 * Set or update the translate(tx, ty) in a transform attribute.
 * Preserves other transform functions (rotate, scale, etc.).
 */
function _setTranslate(el, tx, ty) {
  let attr = el.getAttribute('transform') || '';
  const translateStr = `translate(${tx}, ${ty})`;
  if (/translate\(/.test(attr)) {
    attr = attr.replace(/translate\(\s*[-\d.e]+[\s,]+[-\d.e]+\s*\)/, translateStr);
  } else {
    attr = attr ? `${translateStr} ${attr}` : translateStr;
  }
  el.setAttribute('transform', attr);
}

/**
 * Parse a points attribute (for polyline/polygon) into an array of {x, y}.
 */
function _parsePoints(el) {
  const raw = el.getAttribute('points') || '';
  const result = [];
  const pairs = raw.trim().split(/\s+/);
  for (const pair of pairs) {
    const [x, y] = pair.split(',').map(Number);
    if (!isNaN(x) && !isNaN(y)) result.push({ x, y });
  }
  return result;
}

/**
 * Serialize an array of {x, y} back to a points attribute string.
 */
function _serializePoints(points) {
  return points.map(p => `${p.x},${p.y}`).join(' ');
}

/**
 * Get the numeric value of an attribute, defaulting to 0.
 */
function _num(el, attr) {
  return parseFloat(el.getAttribute(attr)) || 0;
}

export class SvgEditor {
  /**
   * @param {SVGSVGElement} svgElement — the root <svg> to edit
   * @param {Object} callbacks
   * @param {Function} callbacks.onDirty — called when content is modified
   * @param {Function} callbacks.onSelect — called with selected element
   * @param {Function} callbacks.onDeselect — called when selection is cleared
   */
  constructor(svgElement, { onDirty, onSelect, onDeselect, onZoom } = {}) {
    this._svg = svgElement;
    this._onDirty = onDirty || (() => {});
    this._onSelect = onSelect || (() => {});
    this._onDeselect = onDeselect || (() => {});
    this._onZoom = onZoom || (() => {});

    // State
    this._selected = null;       // currently selected SVG element (primary)
    this._multiSelected = new Set(); // all selected elements (including primary)
    this._dragState = null;      // active drag operation info
    this._handleGroup = null;    // SVG <g> for overlay handles
    this._dirty = false;
    this._clipboard = null;      // cloned SVG element(s) for copy/paste
    this._zoomLevel = 1;         // current zoom factor
    this._panX = 0;              // current pan offset in SVG units
    this._panY = 0;
    this._isPanning = false;     // middle-button / space+drag panning
    this._panStart = null;

    // Marquee (rubber-band) selection state
    this._marqueeRect = null;    // the visible SVG <rect> overlay
    this._marqueeStart = null;   // { x, y } in SVG coords
    this._marqueeActive = false;
    this._marqueeAlreadyToggled = false; // true when shift+click already toggled an element

    // Text editing state
    this._textEditEl = null;      // the <text> element being edited
    this._textEditOverlay = null;  // the <foreignObject> overlay for editing

    // Bound handlers
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onPointerMoveHover = this._onPointerMoveHover.bind(this);
    this._onDblClick = this._onDblClick.bind(this);

    // Attach listeners
    this._svg.addEventListener('pointerdown', this._onPointerDown);
    this._svg.addEventListener('dblclick', this._onDblClick);
    this._svg.addEventListener('wheel', this._onWheel, { passive: false });
    this._svg.addEventListener('pointermove', this._onPointerMoveHover);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('keydown', this._onKeyDown);

    // Make SVG capture pointer events on children
    this._svg.style.touchAction = 'none';

    // Store the original viewBox for zoom/pan calculations
    this._origViewBox = this._getViewBox();
  }

  /** Clean up all listeners and overlay elements. */
  dispose() {
    this._commitTextEdit();
    this._cancelMarquee();
    this._removeHandles();
    this._svg.removeEventListener('pointerdown', this._onPointerDown);
    this._svg.removeEventListener('dblclick', this._onDblClick);
    this._svg.removeEventListener('wheel', this._onWheel);
    this._svg.removeEventListener('pointermove', this._onPointerMoveHover);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('keydown', this._onKeyDown);
    this._svg.style.cursor = '';
    this._selected = null;
    this._multiSelected.clear();
    this._dragState = null;
  }

  /** Returns the current dirty state. */
  get isDirty() { return this._dirty; }

  /** Returns the currently selected element, or null. */
  get selectedElement() { return this._selected; }

  /** Returns the serialized SVG content (outerHTML of the root svg). */
  getContent() {
    // Commit any in-progress text edit
    this._commitTextEdit();
    // Remove our handle overlays before serializing
    this._removeHandles();
    const content = this._svg.outerHTML;
    // Restore handles if element(s) still selected
    if (this._selected || this._multiSelected.size > 0) this._renderHandles();
    return content;
  }

  // === Coordinate Conversion ===

  /**
   * Convert screen coordinates to SVG user-space coordinates.
   * Handles viewBox, nested transforms, Shadow DOM offsets.
   */
  _screenToSvg(screenX, screenY) {
    const ctm = this._svg.getScreenCTM();
    if (!ctm) return { x: screenX, y: screenY };
    const inv = ctm.inverse();
    const pt = this._svg.createSVGPoint();
    pt.x = screenX;
    pt.y = screenY;
    const svgPt = pt.matrixTransform(inv);
    return { x: svgPt.x, y: svgPt.y };
  }

  /**
   * Get the distance in SVG units between two screen points.
   * Used for threshold calculations.
   */
  _screenDistToSvgDist(screenDist) {
    const a = this._screenToSvg(0, 0);
    const b = this._screenToSvg(screenDist, 0);
    return Math.abs(b.x - a.x);
  }

  // === ViewBox Zoom & Pan ===

  _getViewBox() {
    const vb = this._svg.getAttribute('viewBox');
    if (!vb) return { x: 0, y: 0, w: 800, h: 600 };
    const parts = vb.split(/[\s,]+/).map(Number);
    return { x: parts[0] || 0, y: parts[1] || 0, w: parts[2] || 800, h: parts[3] || 600 };
  }

  _setViewBox(x, y, w, h) {
    this._svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  }

  /** Returns the current zoom level (1 = original size). */
  get zoomLevel() { return this._zoomLevel; }

  /** Get the current viewBox as {x, y, w, h}. */
  get viewBox() { return this._getViewBox(); }

  /** Set the viewBox externally (for synchronization from the left panel). */
  setViewBox(x, y, w, h) {
    this._setViewBox(x, y, w, h);
    // Update our zoom level based on the new viewBox vs original
    if (this._origViewBox.w > 0) {
      this._zoomLevel = this._origViewBox.w / w;
    }
  }

  /** Reset viewBox to show all content, fitted and centered within the container. */
  fitContent() {
    // Use the actual rendered content bounds (getBBox) rather than the
    // original viewBox attribute, which may be a crop window that doesn't
    // cover all content.  Fall back to _origViewBox if getBBox fails.
    let contentBounds;
    try {
      const bbox = this._svg.getBBox();
      if (bbox.width > 0 && bbox.height > 0) {
        contentBounds = { x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height };
      }
    } catch {
      // getBBox can fail for hidden/empty SVGs
    }
    if (!contentBounds) contentBounds = this._origViewBox;
    if (!contentBounds || contentBounds.w <= 0 || contentBounds.h <= 0) return;

    const cb = contentBounds;

    // Compute a viewBox that shows all content centered and aspect-ratio-
    // preserved.  The shorter axis is expanded to match the container's
    // aspect ratio so the browser's default preserveAspectRatio="xMidYMid meet"
    // becomes a no-op (viewBox AR === container AR).
    const rect = this._svg.getBoundingClientRect();
    const cw = rect.width || 1;
    const ch = rect.height || 1;
    const containerAR = cw / ch;
    const contentAR = cb.w / cb.h;

    // Add a small margin (3%) so content doesn't touch edges
    const margin = 0.03;
    const mx = cb.x - cb.w * margin;
    const my = cb.y - cb.h * margin;
    const mw = cb.w * (1 + margin * 2);
    const mh = cb.h * (1 + margin * 2);

    let vbW, vbH;
    if (contentAR > containerAR) {
      // Content is wider — width constrains
      vbW = mw;
      vbH = mw / containerAR;
    } else {
      // Content is taller — height constrains
      vbH = mh;
      vbW = mh * containerAR;
    }

    // Center the content within the expanded viewBox
    const vbX = mx - (vbW - mw) / 2;
    const vbY = my - (vbH - mh) / 2;

    this._setViewBox(vbX, vbY, vbW, vbH);
    this._zoomLevel = 1;
    this._updateHandles();
    this._onZoom({ zoom: 1, viewBox: { x: vbX, y: vbY, w: vbW, h: vbH } });
  }

  _onWheel(e) {
    e.preventDefault();
    e.stopPropagation();

    const delta = -e.deltaY * ZOOM_SENSITIVITY;
    const oldZoom = this._zoomLevel;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, oldZoom * (1 + delta)));
    const factor = oldZoom / newZoom;

    // Zoom centered on the mouse position
    const svgPt = this._screenToSvg(e.clientX, e.clientY);
    const vb = this._getViewBox();

    const newW = vb.w * factor;
    const newH = vb.h * factor;
    const newX = svgPt.x - (svgPt.x - vb.x) * factor;
    const newY = svgPt.y - (svgPt.y - vb.y) * factor;

    this._setViewBox(newX, newY, newW, newH);
    this._zoomLevel = newZoom;

    // Re-render handles at new zoom level
    this._updateHandles();

    // Notify parent for synchronization
    this._onZoom({ zoom: newZoom, viewBox: { x: newX, y: newY, w: newW, h: newH } });
  }

  // === Cursor Feedback ===

  /**
   * On hover (without dragging), update cursor based on what's under the pointer.
   */
  _onPointerMoveHover(e) {
    // Don't change cursor while dragging
    if (this._dragState || this._isPanning) return;

    const screenX = e.clientX;
    const screenY = e.clientY;

    // Check handles first
    if (this._selected) {
      const handle = this._hitTestHandle(screenX, screenY);
      if (handle) {
        if (handle.type === 'endpoint') {
          this._svg.style.cursor = 'crosshair';
        } else if (handle.type === 'resize-corner') {
          // Set appropriate diagonal resize cursor based on corner index
          const cursors = ['nwse-resize', 'nesw-resize', 'nwse-resize', 'nesw-resize'];
          this._svg.style.cursor = cursors[handle.index] || 'nwse-resize';
        } else if (handle.type === 'resize-edge') {
          const cursors = ['ew-resize', 'ns-resize', 'ew-resize', 'ns-resize'];
          this._svg.style.cursor = cursors[handle.index] || 'ew-resize';
        }
        return;
      }
    }

    // Check elements
    const target = this._hitTest(screenX, screenY);
    if (target) {
      // If hovering over a multi-selected element, show move cursor
      if (this._multiSelected.size > 1 && this._multiSelected.has(target)) {
        this._svg.style.cursor = 'move';
        return;
      }
      const model = _getInteractionModel(target);
      if (model.endpoints) {
        // Lines, polylines, polygons — check if near an endpoint
        this._svg.style.cursor = 'pointer';
      } else if (model.resize) {
        this._svg.style.cursor = 'move';
      } else if (model.drag) {
        this._svg.style.cursor = 'grab';
      } else {
        this._svg.style.cursor = 'default';
      }
    } else {
      this._svg.style.cursor = 'default';
    }
  }

  // === Hit Testing ===

  /**
   * Find the topmost editable SVG element at the given SVG coordinates.
   * Skips our overlay handle elements.
   */
  _hitTest(screenX, screenY) {
    // Use elementsFromPoint for accurate hit testing
    const root = this._svg.getRootNode();
    const els = root.elementsFromPoint
      ? root.elementsFromPoint(screenX, screenY)
      : document.elementsFromPoint(screenX, screenY);

    for (const el of els) {
      // Skip our handle overlays
      if (el.classList && el.classList.contains(HANDLE_CLASS)) continue;
      // Skip the root SVG itself
      if (el === this._svg) continue;
      // Skip defs, style, metadata
      const tag = el.tagName.toLowerCase();
      if (['defs', 'style', 'metadata', 'title', 'desc', 'filter',
           'lineargradient', 'radialgradient', 'clippath', 'mask',
           'marker', 'pattern', 'symbol', 'femerge', 'femergenode',
           'fegaussianblur', 'fedropshadow', 'stop'].includes(tag)) continue;
      // Must be inside our SVG
      if (!this._svg.contains(el)) continue;
      // Check if it's an editable element
      const model = _getInteractionModel(el);
      if (model.drag) return el;
    }
    return null;
  }

  /**
   * Check if a handle was hit. Returns { type, index } or null.
   * type: 'endpoint' | 'resize-corner' | 'resize-edge'
   * index: which handle (corner index, endpoint index, etc.)
   */
  _hitTestHandle(screenX, screenY) {
    const root = this._svg.getRootNode();
    const els = root.elementsFromPoint
      ? root.elementsFromPoint(screenX, screenY)
      : document.elementsFromPoint(screenX, screenY);

    for (const el of els) {
      if (el.classList && el.classList.contains(HANDLE_CLASS)) {
        return {
          type: el.dataset.handleType,
          index: parseInt(el.dataset.handleIndex, 10),
        };
      }
    }
    return null;
  }

  // === Pointer Event Handlers ===

  _onPointerDown(e) {
    // Middle button = pan
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      this._isPanning = true;
      this._panStart = { screenX: e.clientX, screenY: e.clientY, vb: this._getViewBox() };
      this._svg.style.cursor = 'grabbing';
      return;
    }

    if (e.button !== 0) return; // left button only

    const screenX = e.clientX;
    const screenY = e.clientY;
    const svgPt = this._screenToSvg(screenX, screenY);
    const isShift = e.shiftKey;

    // First: check if we hit a handle on the current selection (only in single-select)
    if (this._selected && !isShift && this._multiSelected.size <= 1) {
      const handle = this._hitTestHandle(screenX, screenY);
      if (handle) {
        e.preventDefault();
        e.stopPropagation();
        this._startHandleDrag(handle, svgPt, screenX, screenY);
        return;
      }
    }

    // Commit any active text edit
    if (this._textEditEl) {
      this._commitTextEdit();
    }

    // Second: hit-test for an element
    const target = this._hitTest(screenX, screenY);

    // --- Shift key handling ---
    if (isShift) {
      e.preventDefault();
      e.stopPropagation();

      if (target) {
        if (this._multiSelected.has(target)) {
          // Shift+click on already-selected element — toggle it OUT immediately
          this._multiSelected.delete(target);
          if (this._selected === target) {
            const remaining = [...this._multiSelected];
            this._selected = remaining.length > 0 ? remaining[remaining.length - 1] : null;
          }
          if (this._multiSelected.size === 0) {
            this._deselect();
          } else {
            this._renderHandles();
            this._onSelect(this._selected);
          }
          // No marquee — toggle-out is a discrete action
          return;
        }

        // Shift+click on unselected element — toggle it IN immediately
        if (!this._selected) this._selected = target;
        this._multiSelected.add(target);
        this._renderHandles();
        this._onSelect(this._selected);

        // Also start marquee tracking so shift+drag from this point does
        // area selection.  Record that we already toggled this target so
        // _finishMarquee won't double-toggle on a tiny drag.
        this._marqueeAlreadyToggled = true;
        this._startMarquee(svgPt);
        return;
      }

      // Shift+click on empty space — start marquee (may deselect on tiny drag)
      this._marqueeAlreadyToggled = false;
      this._startMarquee(svgPt);
      return;
    }

    // --- No target, no shift ---
    if (!target) {
      this._deselect();
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    // If clicking an element that's already part of a multi-selection,
    // start a multi-drag without breaking the selection.
    if (this._multiSelected.size > 1 && this._multiSelected.has(target)) {
      this._svg.style.cursor = 'grabbing';
      this._startMultiDrag(svgPt);
      return;
    }

    // Normal click (no Shift): single-select
    this._select(target);
    this._svg.style.cursor = 'grabbing';

    // Start drag
    const model = _getInteractionModel(target);
    const tag = target.tagName.toLowerCase();

    if (tag === 'line' && model.endpoints) {
      this._startLineDrag(target, svgPt);
    } else if ((tag === 'polyline' || tag === 'polygon') && model.endpoints) {
      this._startPolyDrag(target, svgPt);
    } else if (tag === 'path' && model.endpoints) {
      this._startPathDrag(target, svgPt);
    } else if (model.drag) {
      this._startElementDrag(target, svgPt);
    }
  }

  _onPointerMove(e) {
    // Handle marquee drag
    if (this._marqueeActive) {
      e.preventDefault();
      const svgPt = this._screenToSvg(e.clientX, e.clientY);
      this._updateMarquee(svgPt);
      return;
    }

    // Handle middle-button panning
    if (this._isPanning && this._panStart) {
      e.preventDefault();
      const dx = e.clientX - this._panStart.screenX;
      const dy = e.clientY - this._panStart.screenY;
      const vb = this._panStart.vb;
      // Convert screen pixel delta to SVG units
      const svgRect = this._svg.getBoundingClientRect();
      const scaleX = vb.w / svgRect.width;
      const scaleY = vb.h / svgRect.height;
      this._setViewBox(vb.x - dx * scaleX, vb.y - dy * scaleY, vb.w, vb.h);
      this._updateHandles();
      this._onZoom({ zoom: this._zoomLevel, viewBox: this._getViewBox() });
      return;
    }

    if (!this._dragState) return;
    e.preventDefault();

    const svgPt = this._screenToSvg(e.clientX, e.clientY);
    const dx = svgPt.x - this._dragState.startSvg.x;
    const dy = svgPt.y - this._dragState.startSvg.y;

    switch (this._dragState.mode) {
      case 'translate':
        this._applyTranslate(dx, dy);
        break;
      case 'multi-translate':
        this._applyMultiTranslate(dx, dy);
        break;
      case 'line-whole':
        this._applyLineWhole(dx, dy);
        break;
      case 'line-endpoint':
        this._applyLineEndpoint(svgPt);
        break;
      case 'poly-whole':
        this._applyPolyWhole(dx, dy);
        break;
      case 'poly-vertex':
        this._applyPolyVertex(svgPt);
        break;
      case 'resize':
        this._applyResize(svgPt);
        break;
      case 'path-point':
        this._applyPathPoint(svgPt);
        break;
    }

    this._updateHandles();
  }

  _onPointerUp(e) {
    // End marquee selection
    if (this._marqueeActive) {
      const svgPt = this._screenToSvg(e.clientX, e.clientY);
      this._finishMarquee(svgPt);
      return;
    }

    // End middle-button panning
    if (this._isPanning) {
      this._isPanning = false;
      this._panStart = null;
      this._svg.style.cursor = '';
      return;
    }

    if (!this._dragState) return;

    // Check if anything actually moved
    const svgPt = this._screenToSvg(e.clientX, e.clientY);
    const dx = Math.abs(svgPt.x - this._dragState.startSvg.x);
    const dy = Math.abs(svgPt.y - this._dragState.startSvg.y);
    if (dx > 0.5 || dy > 0.5) {
      this._markDirty();
    }

    this._dragState = null;
    this._svg.style.cursor = '';
  }

  _onKeyDown(e) {
    if (e.key === 'Escape') {
      if (this._marqueeActive) {
        this._cancelMarquee();
      } else if (this._textEditEl) {
        this._commitTextEdit();
      } else if (this._selected || this._multiSelected.size > 0) {
        this._deselect();
      }
      return;
    }

    // Copy / Paste / Delete — only when not text-editing
    if (this._textEditEl) return;

    const mod = e.ctrlKey || e.metaKey;
    const hasSelection = this._selected || this._multiSelected.size > 0;

    if (mod && e.key === 'c' && hasSelection) {
      e.preventDefault();
      this._copySelected();
    } else if (mod && e.key === 'v' && this._clipboard && this._clipboard.length > 0) {
      e.preventDefault();
      this._pasteClipboard();
    } else if (mod && e.key === 'd' && hasSelection) {
      // Ctrl+D = duplicate in place (copy + immediate paste)
      e.preventDefault();
      this._copySelected();
      this._pasteClipboard();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && hasSelection) {
      e.preventDefault();
      this._deleteSelected();
    }
  }

  // === Copy / Paste / Delete ===

  _copySelected() {
    if (this._multiSelected.size === 0) return;
    // Remove handles before cloning so they aren't included
    this._removeHandles();
    this._clipboard = [...this._multiSelected].map(el => el.cloneNode(true));
    // Restore handles
    this._renderHandles();
  }

  _pasteClipboard() {
    if (!this._clipboard || this._clipboard.length === 0) return;

    const offset = this._screenDistToSvgDist(15);
    const clones = [];

    for (const orig of this._clipboard) {
      const clone = orig.cloneNode(true);

      // Offset the pasted element so it doesn't sit exactly on top
      const tag = clone.tagName.toLowerCase();
      if (tag === 'rect' || tag === 'text' || tag === 'image' || tag === 'foreignobject') {
        clone.setAttribute('x', _num(clone, 'x') + offset);
        clone.setAttribute('y', _num(clone, 'y') + offset);
      } else if (tag === 'circle' || tag === 'ellipse') {
        clone.setAttribute('cx', _num(clone, 'cx') + offset);
        clone.setAttribute('cy', _num(clone, 'cy') + offset);
      } else if (tag === 'line') {
        clone.setAttribute('x1', _num(clone, 'x1') + offset);
        clone.setAttribute('y1', _num(clone, 'y1') + offset);
        clone.setAttribute('x2', _num(clone, 'x2') + offset);
        clone.setAttribute('y2', _num(clone, 'y2') + offset);
      } else if (tag === 'polyline' || tag === 'polygon') {
        const points = _parsePoints(clone);
        const shifted = points.map(p => ({ x: p.x + offset, y: p.y + offset }));
        clone.setAttribute('points', _serializePoints(shifted));
      } else if (tag === 'path') {
        const { tx, ty } = _parseTranslate(clone);
        _setTranslate(clone, tx + offset, ty + offset);
      } else {
        const { tx, ty } = _parseTranslate(clone);
        _setTranslate(clone, tx + offset, ty + offset);
      }

      this._svg.appendChild(clone);
      clones.push(clone);
    }

    // Select all pasted clones
    this._deselect();
    if (clones.length > 0) {
      this._selected = clones[clones.length - 1];
      this._multiSelected = new Set(clones);
      this._renderHandles();
      this._onSelect(this._selected);
    }
    this._markDirty();
  }

  _deleteSelected() {
    if (this._multiSelected.size === 0) return;
    const elements = [...this._multiSelected];
    this._deselect();
    for (const el of elements) {
      el.remove();
    }
    this._markDirty();
  }

  // === Double-click Text Editing ===

  _onDblClick(e) {
    const screenX = e.clientX;
    const screenY = e.clientY;
    const target = this._hitTest(screenX, screenY);
    if (!target) return;

    const tag = target.tagName.toLowerCase();
    if (tag === 'text') {
      e.preventDefault();
      e.stopPropagation();
      this._select(target);
      this._startTextEdit(target);
    }
  }

  /**
   * Open an inline text editor overlaid on the <text> element.
   * Uses a <foreignObject> with a contenteditable <div> so the user
   * can type directly in place.
   */
  _startTextEdit(textEl) {
    // Commit any previous edit
    this._commitTextEdit();

    this._textEditEl = textEl;

    // Get bounding box of the text element in SVG coordinates
    let bbox;
    try {
      bbox = textEl.getBBox();
    } catch {
      return; // element not rendered
    }

    const ns = 'http://www.w3.org/2000/svg';
    const xhtmlNs = 'http://www.w3.org/1999/xhtml';

    // Create foreignObject sized to cover the text with some padding
    const pad = 4;
    const fo = document.createElementNS(ns, 'foreignObject');
    fo.setAttribute('x', bbox.x - pad);
    fo.setAttribute('y', bbox.y - pad);
    fo.setAttribute('width', Math.max(bbox.width + pad * 4, 60));
    fo.setAttribute('height', bbox.height + pad * 2);
    fo.classList.add(HANDLE_CLASS); // so hit-testing skips it
    fo.dataset.handleType = 'text-edit';
    fo.dataset.handleIndex = '0';

    // Create the editable div
    const div = document.createElementNS(xhtmlNs, 'div');
    div.setAttribute('contenteditable', 'true');
    div.setAttribute('xmlns', xhtmlNs);

    // Try to match the text element's style
    const computed = window.getComputedStyle(textEl);
    const fontSize = computed.fontSize || '16px';
    const fontFamily = computed.fontFamily || 'sans-serif';
    const fill = computed.fill || textEl.getAttribute('fill') || '#000';

    Object.assign(div.style, {
      fontSize,
      fontFamily,
      color: fill === 'none' ? '#000' : fill,
      background: 'rgba(30, 30, 30, 0.85)',
      border: '1px solid #4fc3f7',
      borderRadius: '2px',
      padding: `${pad}px`,
      margin: '0',
      outline: 'none',
      whiteSpace: 'pre',
      minWidth: '40px',
      lineHeight: 'normal',
      boxSizing: 'border-box',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
    });

    // Populate with current text content
    div.textContent = textEl.textContent;

    fo.appendChild(div);
    this._svg.appendChild(fo);
    this._textEditOverlay = fo;

    // Hide the original text while editing
    textEl.style.opacity = '0';

    // Focus and select all text
    requestAnimationFrame(() => {
      div.focus();
      const range = document.createRange();
      range.selectNodeContents(div);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });

    // Listen for blur to commit
    div.addEventListener('blur', () => this._commitTextEdit());

    // Prevent pointer events from starting drags
    div.addEventListener('pointerdown', (ev) => ev.stopPropagation());

    // Enter commits (Shift+Enter for newline in multi-line)
    div.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        this._commitTextEdit();
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this._cancelTextEdit();
      }
      // Stop propagation so SvgEditor's keydown doesn't fire
      ev.stopPropagation();
    });
  }

  /**
   * Commit the text edit: apply the new text to the <text> element.
   */
  _commitTextEdit() {
    if (!this._textEditEl || !this._textEditOverlay) return;

    const div = this._textEditOverlay.querySelector('div');
    const newText = div ? div.textContent : '';
    const oldText = this._textEditEl.textContent;

    // Restore visibility
    this._textEditEl.style.opacity = '';

    // Apply new text
    if (newText !== oldText) {
      this._textEditEl.textContent = newText;
      this._markDirty();
    }

    // Remove overlay
    this._textEditOverlay.remove();
    this._textEditOverlay = null;
    this._textEditEl = null;

    // Refresh handles
    this._updateHandles();
  }

  /**
   * Cancel text edit without applying changes.
   */
  _cancelTextEdit() {
    if (!this._textEditEl || !this._textEditOverlay) return;

    // Restore visibility without changing text
    this._textEditEl.style.opacity = '';

    // Remove overlay
    this._textEditOverlay.remove();
    this._textEditOverlay = null;
    this._textEditEl = null;
  }

  // === Marquee (Rubber-Band) Selection ===

  /**
   * Start drawing a selection rectangle from the given SVG point.
   * _marqueeAlreadyToggled must be set by the caller before calling this.
   */
  _startMarquee(svgPt) {
    this._marqueeStart = { x: svgPt.x, y: svgPt.y };
    this._marqueeActive = true;

    // Create the visible rectangle overlay
    const ns = 'http://www.w3.org/2000/svg';
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('x', svgPt.x);
    rect.setAttribute('y', svgPt.y);
    rect.setAttribute('width', 0);
    rect.setAttribute('height', 0);
    // Default style — will be updated in _updateMarquee based on drag direction
    rect.setAttribute('fill', 'rgba(79, 195, 247, 0.1)');
    const sw = this._screenDistToSvgDist(1);
    const dashOn = this._screenDistToSvgDist(4);
    const dashOff = this._screenDistToSvgDist(3);
    rect.setAttribute('stroke', '#4fc3f7');
    rect.setAttribute('stroke-width', sw);
    rect.setAttribute('stroke-dasharray', `${dashOn} ${dashOff}`);
    rect.setAttribute('pointer-events', 'none');
    rect.classList.add(HANDLE_CLASS);
    rect.dataset.handleType = 'marquee';
    rect.dataset.handleIndex = '0';
    this._svg.appendChild(rect);
    this._marqueeRect = rect;

    this._svg.style.cursor = 'crosshair';
  }

  /**
   * Update the marquee rectangle as the pointer moves.
   *
   * Drag direction determines selection mode:
   *   - Top-left → bottom-right (forward): containment mode (solid stroke,
   *     blue fill) — only elements entirely inside the marquee are selected.
   *   - Any other direction (reverse): crossing mode (dashed stroke, green
   *     tinted fill) — elements that intersect or are inside are selected.
   */
  _updateMarquee(svgPt) {
    if (!this._marqueeRect || !this._marqueeStart) return;

    const x = Math.min(this._marqueeStart.x, svgPt.x);
    const y = Math.min(this._marqueeStart.y, svgPt.y);
    const w = Math.abs(svgPt.x - this._marqueeStart.x);
    const h = Math.abs(svgPt.y - this._marqueeStart.y);

    this._marqueeRect.setAttribute('x', x);
    this._marqueeRect.setAttribute('y', y);
    this._marqueeRect.setAttribute('width', w);
    this._marqueeRect.setAttribute('height', h);

    // Determine drag direction: forward = start is top-left of end
    const isForward = svgPt.x >= this._marqueeStart.x && svgPt.y >= this._marqueeStart.y;
    const sw = this._screenDistToSvgDist(1);

    if (isForward) {
      // Containment mode — solid stroke, blue fill
      this._marqueeRect.setAttribute('fill', 'rgba(79, 195, 247, 0.12)');
      this._marqueeRect.setAttribute('stroke', '#4fc3f7');
      this._marqueeRect.setAttribute('stroke-width', sw);
      this._marqueeRect.removeAttribute('stroke-dasharray');
    } else {
      // Crossing mode — dashed stroke, green-tinted fill
      const dashOn = this._screenDistToSvgDist(4);
      const dashOff = this._screenDistToSvgDist(3);
      this._marqueeRect.setAttribute('fill', 'rgba(126, 231, 135, 0.10)');
      this._marqueeRect.setAttribute('stroke', '#7ee787');
      this._marqueeRect.setAttribute('stroke-width', sw);
      this._marqueeRect.setAttribute('stroke-dasharray', `${dashOn} ${dashOff}`);
    }
  }

  /**
   * Finish the marquee: find all elements whose bounding boxes intersect
   * the selection rectangle, and add them to the multi-selection.
   */
  _finishMarquee(svgPt) {
    const start = this._marqueeStart;
    const alreadyToggled = this._marqueeAlreadyToggled;

    if (!start) {
      this._cancelMarquee();
      return;
    }

    // Compute the marquee bounds in SVG root coords
    const mx1 = Math.min(start.x, svgPt.x);
    const my1 = Math.min(start.y, svgPt.y);
    const mx2 = Math.max(start.x, svgPt.x);
    const my2 = Math.max(start.y, svgPt.y);

    // Remove the visual marquee rect
    this._cancelMarquee();

    // Minimum drag distance to count as a real marquee
    const minSize = this._screenDistToSvgDist(5);
    if ((mx2 - mx1) < minSize && (my2 - my1) < minSize) {
      // Tiny drag — not a real marquee.
      if (alreadyToggled) {
        // Shift+click on element: toggle was already applied in _onPointerDown.
        // Nothing more to do.
        return;
      }
      // Shift+click on empty space with no meaningful drag — deselect all
      this._deselect();
      return;
    }

    // --- Real marquee drag: collect elements whose bboxes overlap ---
    // Determine drag direction: forward = left-to-right (containment mode)
    const isForward = svgPt.x >= start.x && svgPt.y >= start.y;

    const hits = this._collectMarqueeHits(mx1, my1, mx2, my2, isForward);

    if (hits.length === 0) return;

    // Add hits to multi-selection (shift = additive)
    for (const el of hits) {
      this._multiSelected.add(el);
    }

    // Ensure we have a primary selection
    if (!this._selected || !this._multiSelected.has(this._selected)) {
      this._selected = hits[hits.length - 1];
    }

    this._renderHandles();
    this._onSelect(this._selected);
  }

  /**
   * Collect editable elements whose transformed bounding boxes overlap
   * the marquee rectangle (in SVG root coordinates).
   *
   * @param {number} mx1 - marquee left
   * @param {number} my1 - marquee top
   * @param {number} mx2 - marquee right
   * @param {number} my2 - marquee bottom
   * @param {boolean} isForward - true = containment mode, false = crossing mode
   * @returns {Element[]}
   */
  _collectMarqueeHits(mx1, my1, mx2, my2, isForward) {
    const hits = [];

    const testElement = (el) => {
      const model = _getInteractionModel(el);
      if (!model.drag) return;

      try {
        const bbox = el.getBBox();
        if (bbox.width === 0 && bbox.height === 0) return;

        // Transform bbox corners into SVG root coordinate space
        const tl = this._localToSvgRoot(el, bbox.x, bbox.y);
        const tr = this._localToSvgRoot(el, bbox.x + bbox.width, bbox.y);
        const br = this._localToSvgRoot(el, bbox.x + bbox.width, bbox.y + bbox.height);
        const bl = this._localToSvgRoot(el, bbox.x, bbox.y + bbox.height);

        // Compute axis-aligned bounding box of transformed corners
        const bx1 = Math.min(tl.x, tr.x, br.x, bl.x);
        const by1 = Math.min(tl.y, tr.y, br.y, bl.y);
        const bx2 = Math.max(tl.x, tr.x, br.x, bl.x);
        const by2 = Math.max(tl.y, tr.y, br.y, bl.y);

        if (isForward) {
          // Containment mode — element must be fully inside marquee
          if (bx1 >= mx1 && by1 >= my1 && bx2 <= mx2 && by2 <= my2) {
            hits.push(el);
          }
        } else {
          // Crossing mode — any intersection counts (AABB overlap)
          if (bx1 <= mx2 && bx2 >= mx1 && by1 <= my2 && by2 >= my1) {
            hits.push(el);
          }
        }
      } catch {
        // getBBox can fail for hidden elements
      }
    };

    const children = this._svg.children;
    for (let i = 0; i < children.length; i++) {
      const el = children[i];
      // Skip our overlays
      if (el.classList && el.classList.contains(HANDLE_CLASS)) continue;
      if (el.id === HANDLE_GROUP_ID) continue;
      const tag = el.tagName.toLowerCase();
      if (['defs', 'style', 'metadata', 'title', 'desc'].includes(tag)) continue;

      testElement(el);

      // Also check nested elements inside <g> groups (one level deep)
      if (tag === 'g') {
        for (let j = 0; j < el.children.length; j++) {
          testElement(el.children[j]);
        }
      }
    }

    return hits;
  }

  /**
   * Remove the visual marquee overlay and reset state.
   */
  _cancelMarquee() {
    if (this._marqueeRect) {
      this._marqueeRect.remove();
      this._marqueeRect = null;
    }
    this._marqueeStart = null;
    this._marqueeActive = false;
    this._marqueeAlreadyToggled = false;
    this._svg.style.cursor = '';
  }

  // === Selection ===

  _select(el) {
    if (this._selected === el && this._multiSelected.size <= 1) return;
    this._deselect();
    this._selected = el;
    this._multiSelected.clear();
    this._multiSelected.add(el);
    this._renderHandles();
    this._onSelect(el);
  }

  _deselect() {
    if (!this._selected && this._multiSelected.size === 0) return;
    this._removeHandles();
    this._selected = null;
    this._multiSelected.clear();
    this._onDeselect();
  }

  _markDirty() {
    if (!this._dirty) {
      this._dirty = true;
    }
    this._onDirty();
  }

  // === Handle Rendering ===

  _removeHandles() {
    if (this._handleGroup) {
      this._handleGroup.remove();
      this._handleGroup = null;
    }
  }

  _renderHandles() {
    this._removeHandles();
    if (!this._selected && this._multiSelected.size === 0) return;

    const ns = 'http://www.w3.org/2000/svg';
    const g = document.createElementNS(ns, 'g');
    g.id = HANDLE_GROUP_ID;
    g.setAttribute('pointer-events', 'all');
    this._svg.appendChild(g);
    this._handleGroup = g;

    const isMulti = this._multiSelected.size > 1;

    // Draw bounding boxes for all selected elements
    for (const el of this._multiSelected) {
      this._renderBoundingBox(g, el);
    }

    // In single-select mode, also draw detailed drag/resize handles
    if (!isMulti && this._selected) {
      const el = this._selected;
      const tag = el.tagName.toLowerCase();
      const model = _getInteractionModel(el);

      if (tag === 'line') {
        this._renderLineHandles(g, el);
      } else if (tag === 'polyline' || tag === 'polygon') {
        this._renderPolyHandles(g, el);
      } else if (tag === 'rect' && model.resize) {
        this._renderRectHandles(g, el);
      } else if (tag === 'circle' && model.resize) {
        this._renderCircleHandles(g, el);
      } else if (tag === 'ellipse' && model.resize) {
        this._renderEllipseHandles(g, el);
      } else if (tag === 'path') {
        this._renderPathHandles(g, el);
      }
    }
  }

  /**
   * Render a dashed bounding-box rectangle around the selected element.
   * Provides clear visual feedback for any selected element type.
   */
  _renderBoundingBox(g, el) {
    try {
      const bbox = el.getBBox();
      if (bbox.width === 0 && bbox.height === 0) return;

      // Transform bbox from element-local coords into SVG root coords
      // so the overlay aligns with the visually-rendered position
      // (accounts for ancestor <g> transforms).
      let bx = bbox.x, by = bbox.y, bw = bbox.width, bh = bbox.height;
      const ctm = el.getCTM();
      const svgCtm = this._svg.getCTM();
      if (ctm && svgCtm) {
        const inv = svgCtm.inverse();
        const m = inv.multiply(ctm);
        const corners = [
          { x: bbox.x, y: bbox.y },
          { x: bbox.x + bbox.width, y: bbox.y },
          { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
          { x: bbox.x, y: bbox.y + bbox.height },
        ];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const c of corners) {
          const tx = m.a * c.x + m.c * c.y + m.e;
          const ty = m.b * c.x + m.d * c.y + m.f;
          if (tx < minX) minX = tx;
          if (ty < minY) minY = ty;
          if (tx > maxX) maxX = tx;
          if (ty > maxY) maxY = ty;
        }
        bx = minX; by = minY; bw = maxX - minX; bh = maxY - minY;
      }

      const ns = 'http://www.w3.org/2000/svg';
      const rect = document.createElementNS(ns, 'rect');
      const sw = this._screenDistToSvgDist(1);
      const dashOn = this._screenDistToSvgDist(4);
      const dashOff = this._screenDistToSvgDist(3);
      const padSvg = this._screenDistToSvgDist(3);
      rect.setAttribute('x', bx - padSvg);
      rect.setAttribute('y', by - padSvg);
      rect.setAttribute('width', bw + padSvg * 2);
      rect.setAttribute('height', bh + padSvg * 2);
      rect.setAttribute('fill', 'none');
      rect.setAttribute('stroke', '#4fc3f7');
      rect.setAttribute('stroke-width', sw);
      rect.setAttribute('stroke-dasharray', `${dashOn} ${dashOff}`);
      rect.setAttribute('pointer-events', 'none');
      rect.classList.add(HANDLE_CLASS);
      rect.dataset.handleType = 'bbox';
      rect.dataset.handleIndex = '0';
      g.appendChild(rect);
    } catch {
      // getBBox can fail for hidden or zero-size elements
    }
  }

  _updateHandles() {
    // Re-render handles at current positions
    this._renderHandles();
  }

  /**
   * Get handle radius in SVG units that corresponds to a fixed screen size.
   * This ensures handles are always visible regardless of zoom/viewBox.
   */
  _getHandleRadius() {
    return this._screenDistToSvgDist(HANDLE_RADIUS);
  }

  /**
   * Transform a point from an element's local coordinate space into the
   * SVG root coordinate space.  Accounts for ancestor <g> transforms so
   * overlay handles align with the visually-rendered position.
   */
  _localToSvgRoot(el, lx, ly) {
    const ctm = el.getCTM();
    const svgCtm = this._svg.getCTM();
    if (ctm && svgCtm) {
      const m = svgCtm.inverse().multiply(ctm);
      return {
        x: m.a * lx + m.c * ly + m.e,
        y: m.b * lx + m.d * ly + m.f,
      };
    }
    return { x: lx, y: ly };
  }

  _createHandle(parent, cx, cy, type, index, shape = 'circle') {
    const ns = 'http://www.w3.org/2000/svg';
    const r = this._getHandleRadius();

    let handle;
    if (shape === 'diamond') {
      // Diamond for control points
      handle = document.createElementNS(ns, 'polygon');
      handle.setAttribute('points',
        `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`);
    } else if (shape === 'circle') {
      handle = document.createElementNS(ns, 'circle');
      handle.setAttribute('cx', cx);
      handle.setAttribute('cy', cy);
      handle.setAttribute('r', r);
    } else {
      // Square handle
      handle = document.createElementNS(ns, 'rect');
      handle.setAttribute('x', cx - r);
      handle.setAttribute('y', cy - r);
      handle.setAttribute('width', r * 2);
      handle.setAttribute('height', r * 2);
    }

    const sw = this._screenDistToSvgDist(1.5);
    const color = (type === 'path-control') ? '#f0883e'
      : (type === 'endpoint' || type === 'path-point') ? '#4fc3f7' : '#f0883e';
    handle.setAttribute('fill', color);
    handle.setAttribute('stroke', '#fff');
    handle.setAttribute('stroke-width', sw);
    handle.setAttribute('cursor', 'pointer');
    handle.classList.add(HANDLE_CLASS);
    handle.dataset.handleType = type;
    handle.dataset.handleIndex = index;
    handle.style.pointerEvents = 'all';
    parent.appendChild(handle);
    return handle;
  }

  _renderLineHandles(g, el) {
    const x1 = _num(el, 'x1'), y1 = _num(el, 'y1');
    const x2 = _num(el, 'x2'), y2 = _num(el, 'y2');
    const p1 = this._localToSvgRoot(el, x1, y1);
    const p2 = this._localToSvgRoot(el, x2, y2);
    this._createHandle(g, p1.x, p1.y, 'endpoint', 0);
    this._createHandle(g, p2.x, p2.y, 'endpoint', 1);
  }

  _renderPolyHandles(g, el) {
    const points = _parsePoints(el);
    points.forEach((p, i) => {
      const sp = this._localToSvgRoot(el, p.x, p.y);
      this._createHandle(g, sp.x, sp.y, 'endpoint', i);
    });
  }

  _renderRectHandles(g, el) {
    const x = _num(el, 'x'), y = _num(el, 'y');
    const w = _num(el, 'width'), h = _num(el, 'height');
    // Four corners: TL=0, TR=1, BR=2, BL=3
    const corners = [
      { x: x, y: y },
      { x: x + w, y: y },
      { x: x + w, y: y + h },
      { x: x, y: y + h },
    ];
    corners.forEach((c, i) => {
      const sp = this._localToSvgRoot(el, c.x, c.y);
      this._createHandle(g, sp.x, sp.y, 'resize-corner', i, 'rect');
    });
  }

  _renderCircleHandles(g, el) {
    const cx = _num(el, 'cx'), cy = _num(el, 'cy'), r = _num(el, 'r');
    // Four edge handles: right=0, bottom=1, left=2, top=3
    const edges = [
      { x: cx + r, y: cy },
      { x: cx, y: cy + r },
      { x: cx - r, y: cy },
      { x: cx, y: cy - r },
    ];
    edges.forEach((p, i) => {
      const sp = this._localToSvgRoot(el, p.x, p.y);
      this._createHandle(g, sp.x, sp.y, 'resize-edge', i, 'rect');
    });
  }

  _renderEllipseHandles(g, el) {
    const cx = _num(el, 'cx'), cy = _num(el, 'cy');
    const rx = _num(el, 'rx'), ry = _num(el, 'ry');
    // Four edge handles: right=0, bottom=1, left=2, top=3
    const edges = [
      { x: cx + rx, y: cy },
      { x: cx, y: cy + ry },
      { x: cx - rx, y: cy },
      { x: cx, y: cy - ry },
    ];
    edges.forEach((p, i) => {
      const sp = this._localToSvgRoot(el, p.x, p.y);
      this._createHandle(g, sp.x, sp.y, 'resize-edge', i, 'rect');
    });
  }

  _renderPathHandles(g, el) {
    const d = el.getAttribute('d') || '';
    const commands = _parsePathData(d);
    const points = _extractPathPoints(commands);

    // Draw thin guide lines from control points to their associated endpoints
    const ns = 'http://www.w3.org/2000/svg';
    const sw = this._screenDistToSvgDist(0.75);
    for (let i = 0; i < points.length; i++) {
      if (points[i].type === 'control') {
        // Find the adjacent endpoint: previous or next
        let ep = null;
        if (i > 0 && points[i - 1].type === 'endpoint') ep = points[i - 1];
        if (i + 1 < points.length && points[i + 1].type === 'endpoint') ep = points[i + 1];
        if (!ep) {
          // For cubic with two controls, link to the nearest endpoint
          if (i + 2 < points.length && points[i + 2].type === 'endpoint') ep = points[i + 2];
          if (i >= 2 && points[i - 2].type === 'endpoint') ep = points[i - 2];
        }
        if (ep) {
          const sp1 = this._localToSvgRoot(el, points[i].x, points[i].y);
          const sp2 = this._localToSvgRoot(el, ep.x, ep.y);
          const line = document.createElementNS(ns, 'line');
          line.setAttribute('x1', sp1.x);
          line.setAttribute('y1', sp1.y);
          line.setAttribute('x2', sp2.x);
          line.setAttribute('y2', sp2.y);
          line.setAttribute('stroke', '#4fc3f7');
          line.setAttribute('stroke-width', sw);
          line.setAttribute('stroke-opacity', '0.4');
          line.setAttribute('stroke-dasharray', `${this._screenDistToSvgDist(2)} ${this._screenDistToSvgDist(2)}`);
          line.setAttribute('pointer-events', 'none');
          line.classList.add(HANDLE_CLASS);
          line.dataset.handleType = 'guide';
          line.dataset.handleIndex = '0';
          g.appendChild(line);
        }
      }
    }

    // Draw handles — endpoints as circles, control points as diamonds
    points.forEach((p, i) => {
      const sp = this._localToSvgRoot(el, p.x, p.y);
      const handleType = p.type === 'control' ? 'path-control' : 'path-point';
      const shape = p.type === 'control' ? 'diamond' : 'circle';
      this._createHandle(g, sp.x, sp.y, handleType, i, shape);
    });

    // Store point metadata on the handle group for drag lookup
    if (this._handleGroup) {
      this._handleGroup._pathPoints = points;
      this._handleGroup._pathCommands = commands;
    }
  }

  // === Drag Initialization ===

  _startElementDrag(el, svgPt) {
    const tag = el.tagName.toLowerCase();

    if (['rect', 'text'].includes(tag)) {
      // Drag by x, y attributes
      this._dragState = {
        mode: 'translate',
        element: el,
        startSvg: { ...svgPt },
        attrMode: 'xy',
        origX: _num(el, 'x'),
        origY: _num(el, 'y'),
      };
    } else if (['circle', 'ellipse'].includes(tag)) {
      // Drag by cx, cy
      this._dragState = {
        mode: 'translate',
        element: el,
        startSvg: { ...svgPt },
        attrMode: 'cxcy',
        origX: _num(el, 'cx'),
        origY: _num(el, 'cy'),
      };
    } else {
      // path, g, image, use, foreignobject — drag via transform
      const { tx, ty } = _parseTranslate(el);
      this._dragState = {
        mode: 'translate',
        element: el,
        startSvg: { ...svgPt },
        attrMode: 'transform',
        origX: tx,
        origY: ty,
      };
    }
  }

  _startLineDrag(el, svgPt) {
    const x1 = _num(el, 'x1'), y1 = _num(el, 'y1');
    const x2 = _num(el, 'x2'), y2 = _num(el, 'y2');

    // Always start with whole-line drag on direct element click.
    // Endpoint dragging is done via the rendered handle overlays.
    this._dragState = {
      mode: 'line-whole',
      element: el,
      startSvg: { ...svgPt },
      origX1: x1, origY1: y1,
      origX2: x2, origY2: y2,
    };
  }

  _startPolyDrag(el, svgPt) {
    const points = _parsePoints(el);

    // Always whole-shape drag on direct element click.
    // Vertex dragging happens exclusively via rendered handle overlays.
    this._dragState = {
      mode: 'poly-whole',
      element: el,
      startSvg: { ...svgPt },
      origPoints: points.map(p => ({ ...p })),
    };
  }

  _startPathDrag(el, svgPt) {
    const d = el.getAttribute('d') || '';
    const commands = _parsePathData(d);

    // Whole-path drag via translate. Point dragging via handle overlays.
    const { tx, ty } = _parseTranslate(el);
    this._dragState = {
      mode: 'translate',
      element: el,
      startSvg: { ...svgPt },
      attrMode: 'transform',
      origX: tx,
      origY: ty,
    };
  }

  /**
   * Start a multi-element drag. Snapshots geometry for every selected element
   * so they all move together as a group.
   */
  _startMultiDrag(svgPt) {
    const snapshots = [];
    for (const el of this._multiSelected) {
      const tag = el.tagName.toLowerCase();
      const model = _getInteractionModel(el);
      if (!model.drag) continue;

      if (tag === 'line') {
        snapshots.push({
          el,
          kind: 'line',
          origX1: _num(el, 'x1'), origY1: _num(el, 'y1'),
          origX2: _num(el, 'x2'), origY2: _num(el, 'y2'),
        });
      } else if (tag === 'polyline' || tag === 'polygon') {
        snapshots.push({
          el,
          kind: 'poly',
          origPoints: _parsePoints(el).map(p => ({ ...p })),
        });
      } else if (['rect', 'text', 'image', 'foreignobject'].includes(tag)) {
        snapshots.push({
          el,
          kind: 'xy',
          origX: _num(el, 'x'),
          origY: _num(el, 'y'),
        });
      } else if (tag === 'circle' || tag === 'ellipse') {
        snapshots.push({
          el,
          kind: 'cxcy',
          origX: _num(el, 'cx'),
          origY: _num(el, 'cy'),
        });
      } else {
        // g, path, use, etc. — translate transform
        const { tx, ty } = _parseTranslate(el);
        snapshots.push({
          el,
          kind: 'transform',
          origX: tx,
          origY: ty,
        });
      }
    }

    this._dragState = {
      mode: 'multi-translate',
      startSvg: { ...svgPt },
      snapshots,
    };
  }

  /**
   * Apply translation delta to all elements in a multi-drag.
   */
  _applyMultiTranslate(dx, dy) {
    const s = this._dragState;
    for (const snap of s.snapshots) {
      const el = snap.el;
      if (snap.kind === 'xy') {
        el.setAttribute('x', snap.origX + dx);
        el.setAttribute('y', snap.origY + dy);
      } else if (snap.kind === 'cxcy') {
        el.setAttribute('cx', snap.origX + dx);
        el.setAttribute('cy', snap.origY + dy);
      } else if (snap.kind === 'transform') {
        _setTranslate(el, snap.origX + dx, snap.origY + dy);
      } else if (snap.kind === 'line') {
        el.setAttribute('x1', snap.origX1 + dx);
        el.setAttribute('y1', snap.origY1 + dy);
        el.setAttribute('x2', snap.origX2 + dx);
        el.setAttribute('y2', snap.origY2 + dy);
      } else if (snap.kind === 'poly') {
        const newPoints = snap.origPoints.map(p => ({ x: p.x + dx, y: p.y + dy }));
        el.setAttribute('points', _serializePoints(newPoints));
      }
    }
  }

  _startHandleDrag(handle, svgPt, screenX, screenY) {
    const el = this._selected;
    if (!el) return;

    const tag = el.tagName.toLowerCase();

    if (handle.type === 'endpoint') {
      if (tag === 'line') {
        this._dragState = {
          mode: 'line-endpoint',
          element: el,
          startSvg: { ...svgPt },
          endpointIndex: handle.index,
        };
      } else if (tag === 'polyline' || tag === 'polygon') {
        const points = _parsePoints(el);
        this._dragState = {
          mode: 'poly-vertex',
          element: el,
          startSvg: { ...svgPt },
          vertexIndex: handle.index,
          origPoints: points.map(p => ({ ...p })),
        };
      }
    } else if (handle.type === 'path-point' || handle.type === 'path-control') {
      const hg = this._handleGroup;
      if (hg && hg._pathPoints && hg._pathCommands) {
        const pt = hg._pathPoints[handle.index];
        if (pt) {
          this._dragState = {
            mode: 'path-point',
            element: el,
            startSvg: { ...svgPt },
            pointIndex: handle.index,
            pathPoints: hg._pathPoints.map(p => ({ ...p })),
            pathCommands: hg._pathCommands.map(c => ({ cmd: c.cmd, args: [...c.args] })),
          };
        }
      }
    } else if (handle.type === 'resize-corner' || handle.type === 'resize-edge') {
      this._dragState = {
        mode: 'resize',
        element: el,
        startSvg: { ...svgPt },
        handleType: handle.type,
        handleIndex: handle.index,
        // Snapshot current geometry
        ...this._snapshotGeometry(el),
      };
    }
  }

  _snapshotGeometry(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'rect') {
      return {
        geomType: 'rect',
        origX: _num(el, 'x'),
        origY: _num(el, 'y'),
        origW: _num(el, 'width'),
        origH: _num(el, 'height'),
      };
    } else if (tag === 'circle') {
      return {
        geomType: 'circle',
        origCx: _num(el, 'cx'),
        origCy: _num(el, 'cy'),
        origR: _num(el, 'r'),
      };
    } else if (tag === 'ellipse') {
      return {
        geomType: 'ellipse',
        origCx: _num(el, 'cx'),
        origCy: _num(el, 'cy'),
        origRx: _num(el, 'rx'),
        origRy: _num(el, 'ry'),
      };
    }
    return {};
  }

  // === Drag Application ===

  _applyTranslate(dx, dy) {
    const s = this._dragState;
    const el = s.element;

    if (s.attrMode === 'xy') {
      el.setAttribute('x', s.origX + dx);
      el.setAttribute('y', s.origY + dy);
    } else if (s.attrMode === 'cxcy') {
      el.setAttribute('cx', s.origX + dx);
      el.setAttribute('cy', s.origY + dy);
    } else if (s.attrMode === 'transform') {
      _setTranslate(el, s.origX + dx, s.origY + dy);
    }
  }

  _applyLineWhole(dx, dy) {
    const s = this._dragState;
    const el = s.element;
    el.setAttribute('x1', s.origX1 + dx);
    el.setAttribute('y1', s.origY1 + dy);
    el.setAttribute('x2', s.origX2 + dx);
    el.setAttribute('y2', s.origY2 + dy);
  }

  _applyLineEndpoint(svgPt) {
    const s = this._dragState;
    const el = s.element;
    if (s.endpointIndex === 0) {
      el.setAttribute('x1', svgPt.x);
      el.setAttribute('y1', svgPt.y);
    } else {
      el.setAttribute('x2', svgPt.x);
      el.setAttribute('y2', svgPt.y);
    }
  }

  _applyPolyWhole(dx, dy) {
    const s = this._dragState;
    const el = s.element;
    const newPoints = s.origPoints.map(p => ({ x: p.x + dx, y: p.y + dy }));
    el.setAttribute('points', _serializePoints(newPoints));
  }

  _applyPolyVertex(svgPt) {
    const s = this._dragState;
    const el = s.element;
    const newPoints = s.origPoints.map(p => ({ ...p }));
    newPoints[s.vertexIndex] = { x: svgPt.x, y: svgPt.y };
    el.setAttribute('points', _serializePoints(newPoints));
  }

  _applyPathPoint(svgPt) {
    const s = this._dragState;
    const el = s.element;
    const pt = s.pathPoints[s.pointIndex];
    if (!pt) return;

    // Clone commands and update the specific args
    const commands = s.pathCommands.map(c => ({ cmd: c.cmd, args: [...c.args] }));
    const cmd = commands[pt.cmdIndex];
    if (!cmd) return;

    const isRel = cmd.cmd !== cmd.cmd.toUpperCase();
    if (isRel) {
      // For relative commands, compute delta from original absolute position
      // and apply it relative to the original arg values
      const origCmd = s.pathCommands[pt.cmdIndex];
      const dx = svgPt.x - pt.x;
      const dy = svgPt.y - pt.y;
      cmd.args[pt.argIndex] = origCmd.args[pt.argIndex] + dx;
      cmd.args[pt.argIndex + 1] = origCmd.args[pt.argIndex + 1] + dy;
    } else {
      cmd.args[pt.argIndex] = svgPt.x;
      cmd.args[pt.argIndex + 1] = svgPt.y;
    }

    el.setAttribute('d', _serializePathData(commands));
  }

  _applyResize(svgPt) {
    const s = this._dragState;
    const el = s.element;
    const dx = svgPt.x - s.startSvg.x;
    const dy = svgPt.y - s.startSvg.y;

    if (s.geomType === 'rect') {
      this._applyRectResize(el, s, dx, dy);
    } else if (s.geomType === 'circle') {
      this._applyCircleResize(el, s, svgPt);
    } else if (s.geomType === 'ellipse') {
      this._applyEllipseResize(el, s, svgPt);
    }
  }

  _applyRectResize(el, s, dx, dy) {
    // Corners: TL=0, TR=1, BR=2, BL=3
    const idx = s.handleIndex;
    let x = s.origX, y = s.origY, w = s.origW, h = s.origH;

    if (idx === 0) { // TL
      x += dx; y += dy; w -= dx; h -= dy;
    } else if (idx === 1) { // TR
      y += dy; w += dx; h -= dy;
    } else if (idx === 2) { // BR
      w += dx; h += dy;
    } else if (idx === 3) { // BL
      x += dx; w -= dx; h += dy;
    }

    // Enforce minimum size
    if (w < 1) { w = 1; }
    if (h < 1) { h = 1; }

    el.setAttribute('x', x);
    el.setAttribute('y', y);
    el.setAttribute('width', w);
    el.setAttribute('height', h);
  }

  _applyCircleResize(el, s, svgPt) {
    const cx = s.origCx, cy = s.origCy;
    const r = Math.max(1, Math.hypot(svgPt.x - cx, svgPt.y - cy));
    el.setAttribute('r', r);
  }

  _applyEllipseResize(el, s, svgPt) {
    const cx = s.origCx, cy = s.origCy;
    const idx = s.handleIndex;

    if (idx === 0 || idx === 2) {
      // Horizontal edge — change rx
      el.setAttribute('rx', Math.max(1, Math.abs(svgPt.x - cx)));
    } else {
      // Vertical edge — change ry
      el.setAttribute('ry', Math.max(1, Math.abs(svgPt.y - cy)));
    }
  }
}