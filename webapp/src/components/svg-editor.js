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
const HANDLE_RADIUS = 5;
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
      return { drag: true, endpoints: false, resize: false };
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
    this._selected = null;       // currently selected SVG element
    this._dragState = null;      // active drag operation info
    this._handleGroup = null;    // SVG <g> for overlay handles
    this._dirty = false;
    this._zoomLevel = 1;         // current zoom factor
    this._panX = 0;              // current pan offset in SVG units
    this._panY = 0;
    this._isPanning = false;     // middle-button / space+drag panning
    this._panStart = null;

    // Bound handlers
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onPointerMoveHover = this._onPointerMoveHover.bind(this);

    // Attach listeners
    this._svg.addEventListener('pointerdown', this._onPointerDown);
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
    this._removeHandles();
    this._svg.removeEventListener('pointerdown', this._onPointerDown);
    this._svg.removeEventListener('wheel', this._onWheel);
    this._svg.removeEventListener('pointermove', this._onPointerMoveHover);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('keydown', this._onKeyDown);
    this._svg.style.cursor = '';
    this._selected = null;
    this._dragState = null;
  }

  /** Returns the current dirty state. */
  get isDirty() { return this._dirty; }

  /** Returns the currently selected element, or null. */
  get selectedElement() { return this._selected; }

  /** Returns the serialized SVG content (outerHTML of the root svg). */
  getContent() {
    // Remove our handle overlays before serializing
    this._removeHandles();
    const content = this._svg.outerHTML;
    // Restore handles if element is still selected
    if (this._selected) this._renderHandles();
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
      const tag = target.tagName.toLowerCase();
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

    // First: check if we hit a handle on the current selection
    if (this._selected) {
      const handle = this._hitTestHandle(screenX, screenY);
      if (handle) {
        e.preventDefault();
        e.stopPropagation();
        this._startHandleDrag(handle, svgPt, screenX, screenY);
        return;
      }
    }

    // Second: hit-test for an element
    const target = this._hitTest(screenX, screenY);

    if (!target) {
      // Clicked on empty space — deselect
      this._deselect();
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    // Select the element
    this._select(target);
    this._svg.style.cursor = 'grabbing';

    // Start drag
    const model = _getInteractionModel(target);
    const tag = target.tagName.toLowerCase();

    if (tag === 'line' && model.endpoints) {
      this._startLineDrag(target, svgPt);
    } else if ((tag === 'polyline' || tag === 'polygon') && model.endpoints) {
      this._startPolyDrag(target, svgPt);
    } else if (model.drag) {
      this._startElementDrag(target, svgPt);
    }
  }

  _onPointerMove(e) {
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
    }

    this._updateHandles();
  }

  _onPointerUp(e) {
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
    if (e.key === 'Escape' && this._selected) {
      this._deselect();
    }
  }

  // === Selection ===

  _select(el) {
    if (this._selected === el) return;
    this._deselect();
    this._selected = el;
    this._renderHandles();
    this._onSelect(el);
  }

  _deselect() {
    if (!this._selected) return;
    this._removeHandles();
    this._selected = null;
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
    if (!this._selected) return;

    const ns = 'http://www.w3.org/2000/svg';
    const g = document.createElementNS(ns, 'g');
    g.id = HANDLE_GROUP_ID;
    g.setAttribute('pointer-events', 'all');
    this._svg.appendChild(g);
    this._handleGroup = g;

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
    }
    // For elements with only drag (path, text, g, etc.), no handles needed
    // — just the selection highlight
  }

  _updateHandles() {
    // Re-render handles at current positions
    this._renderHandles();
  }

  _createHandle(parent, cx, cy, type, index, shape = 'circle') {
    const ns = 'http://www.w3.org/2000/svg';
    const r = HANDLE_RADIUS;

    let handle;
    if (shape === 'circle') {
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

    handle.setAttribute('fill', type === 'endpoint' ? '#4fc3f7' : '#f0883e');
    handle.setAttribute('stroke', '#fff');
    handle.setAttribute('stroke-width', '1.5');
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
    this._createHandle(g, x1, y1, 'endpoint', 0);
    this._createHandle(g, x2, y2, 'endpoint', 1);
  }

  _renderPolyHandles(g, el) {
    const points = _parsePoints(el);
    points.forEach((p, i) => {
      this._createHandle(g, p.x, p.y, 'endpoint', i);
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
      this._createHandle(g, c.x, c.y, 'resize-corner', i, 'rect');
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
      this._createHandle(g, p.x, p.y, 'resize-edge', i, 'rect');
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
      this._createHandle(g, p.x, p.y, 'resize-edge', i, 'rect');
    });
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

    const dist1 = Math.hypot(svgPt.x - x1, svgPt.y - y1);
    const dist2 = Math.hypot(svgPt.x - x2, svgPt.y - y2);
    const threshold = this._screenDistToSvgDist(ENDPOINT_HIT_THRESHOLD * 3);

    if (dist1 < threshold && dist1 < dist2) {
      // Drag endpoint 1
      this._dragState = {
        mode: 'line-endpoint',
        element: el,
        startSvg: { ...svgPt },
        endpointIndex: 0,
      };
    } else if (dist2 < threshold && dist2 < dist1) {
      // Drag endpoint 2
      this._dragState = {
        mode: 'line-endpoint',
        element: el,
        startSvg: { ...svgPt },
        endpointIndex: 1,
      };
    } else {
      // Drag whole line
      this._dragState = {
        mode: 'line-whole',
        element: el,
        startSvg: { ...svgPt },
        origX1: x1, origY1: y1,
        origX2: x2, origY2: y2,
      };
    }
  }

  _startPolyDrag(el, svgPt) {
    const points = _parsePoints(el);
    const threshold = this._screenDistToSvgDist(ENDPOINT_HIT_THRESHOLD * 3);

    // Find closest vertex
    let closestIdx = -1;
    let closestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.hypot(svgPt.x - points[i].x, svgPt.y - points[i].y);
      if (d < closestDist) {
        closestDist = d;
        closestIdx = i;
      }
    }

    if (closestDist < threshold) {
      this._dragState = {
        mode: 'poly-vertex',
        element: el,
        startSvg: { ...svgPt },
        vertexIndex: closestIdx,
        origPoints: points.map(p => ({ ...p })),
      };
    } else {
      this._dragState = {
        mode: 'poly-whole',
        element: el,
        startSvg: { ...svgPt },
        origPoints: points.map(p => ({ ...p })),
      };
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