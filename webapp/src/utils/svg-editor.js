/**
 * SvgEditor — pointer-based visual editor for SVG elements.
 *
 * Supports: select, move, resize, vertex edit, line endpoint edit,
 * inline text editing, copy/paste/delete, multi-selection with marquee,
 * zoom (mouse wheel), and pan (drag on empty space).
 *
 * No external dependencies — operates directly on SVG DOM elements
 * using pointer events, getScreenCTM(), and createSVGPoint().
 */

// Elements that can be selected
const SELECTABLE_TAGS = new Set([
  'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'g', 'image',
]);

// Elements that resolve to their parent text
const TSPAN_TAG = 'tspan';

export class SvgEditor {
  constructor(svgElement, options = {}) {
    this._svg = svgElement;
    this._onEdit = options.onEdit || (() => {});
    this._onZoom = options.onZoom || (() => {});

    this._selected = new Set();
    this._selectedTag = '';
    this._handles = null;
    this._textEditor = null;

    // Drag state
    this._dragging = false;
    this._dragStart = null;
    this._dragTarget = null;
    this._dragOffset = null;

    // Marquee state
    this._marquee = null;
    this._marqueeEl = null;
    this._marqueeClickTarget = undefined;

    // Zoom state
    this._viewBox = this._parseViewBox();
    this._zoomLevel = 1;

    // Clipboard
    this._clipboard = null;

    this._setupEventListeners();
  }

  dispose() {
    this._removeHandles();
    this._removeTextEditor();
    this._removeMarquee();
    this._svg.removeEventListener('pointerdown', this._onPointerDown);
    this._svg.removeEventListener('pointermove', this._onPointerMove);
    this._svg.removeEventListener('pointerup', this._onPointerUp);
    this._svg.removeEventListener('wheel', this._onWheel);
    this._svg.removeEventListener('dblclick', this._onDblClick);
    document.removeEventListener('keydown', this._onKeyDown);
  }

  // ── Public methods ─────────────────────────────────────────────

  getContent() {
    // Commit any active text edit
    this._commitTextEdit();
    // Remove handles before serializing
    this._removeHandles();
    const content = new XMLSerializer().serializeToString(this._svg);
    // Re-render handles
    if (this._selected.size) this._renderHandles();
    return content;
  }

  setViewBox(vbStr) {
    if (!vbStr) return;
    this._svg.setAttribute('viewBox', vbStr);
    this._viewBox = this._parseViewBox();
  }

  fitContent() {
    const authored = this._svg._authoredViewBox;
    if (authored) {
      // Use authored viewBox — already set
      this._viewBox = this._parseViewBox();
      return;
    }

    // Compute from getBBox with 3% margin
    try {
      const bbox = this._svg.getBBox();
      if (bbox.width === 0 || bbox.height === 0) return;
      const margin = 0.03;
      const mx = bbox.width * margin;
      const my = bbox.height * margin;
      const vb = `${bbox.x - mx} ${bbox.y - my} ${bbox.width + 2 * mx} ${bbox.height + 2 * my}`;
      this._svg.setAttribute('viewBox', vb);
      this._viewBox = this._parseViewBox();
    } catch (_) {}
  }

  // ── Event setup ────────────────────────────────────────────────

  _setupEventListeners() {
    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp = this._handlePointerUp.bind(this);
    this._onWheel = this._handleWheel.bind(this);
    this._onDblClick = this._handleDblClick.bind(this);
    this._onKeyDown = this._handleKeyDown.bind(this);

    this._svg.addEventListener('pointerdown', this._onPointerDown);
    this._svg.addEventListener('pointermove', this._onPointerMove);
    this._svg.addEventListener('pointerup', this._onPointerUp);
    this._svg.addEventListener('wheel', this._onWheel, { passive: false });
    this._svg.addEventListener('dblclick', this._onDblClick);
    document.addEventListener('keydown', this._onKeyDown);
  }

  // ── Coordinate helpers ─────────────────────────────────────────

  _svgPoint(clientX, clientY) {
    const pt = this._svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = this._svg.getScreenCTM();
    if (!ctm) return { x: clientX, y: clientY };
    return pt.matrixTransform(ctm.inverse());
  }

  _parseViewBox() {
    const vb = this._svg.getAttribute('viewBox');
    if (!vb) return { x: 0, y: 0, w: 300, h: 150 };
    const parts = vb.split(/[\s,]+/).map(Number);
    return { x: parts[0] || 0, y: parts[1] || 0, w: parts[2] || 300, h: parts[3] || 150 };
  }

  _applyViewBox() {
    const { x, y, w, h } = this._viewBox;
    this._svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  }

  // ── Selection ──────────────────────────────────────────────────

  _findSelectableTarget(target) {
    let el = target;
    while (el && el !== this._svg) {
      // Skip handles
      if (el.dataset?.svgEditorHandle) return null;
      // Skip text editor foreign objects
      if (el.tagName === 'foreignObject' && el.dataset?.svgEditorTextEdit) return null;
      const tag = el.tagName?.toLowerCase();
      if (tag === TSPAN_TAG) {
        // Resolve to parent text
        el = el.parentElement;
        continue;
      }
      if (SELECTABLE_TAGS.has(tag)) return el;
      el = el.parentElement;
    }
    return null;
  }

  _select(el) {
    this._selected.clear();
    if (el) this._selected.add(el);
    this._updateSelectedTag();
    this._renderHandles();
  }

  _addToSelection(el) {
    if (el) this._selected.add(el);
    this._updateSelectedTag();
    this._renderHandles();
  }

  _removeFromSelection(el) {
    this._selected.delete(el);
    this._updateSelectedTag();
    this._renderHandles();
  }

  _clearSelection() {
    this._selected.clear();
    this._selectedTag = '';
    this._removeHandles();
  }

  _updateSelectedTag() {
    if (this._selected.size === 0) {
      this._selectedTag = '';
    } else if (this._selected.size === 1) {
      this._selectedTag = [...this._selected][0].tagName?.toLowerCase() || '';
    } else {
      this._selectedTag = `${this._selected.size} elements`;
    }
  }

  // ── Pointer events ─────────────────────────────────────────────

  _handlePointerDown(e) {
    if (e.button !== 0) return;

    const target = this._findSelectableTarget(e.target);
    const svgPt = this._svgPoint(e.clientX, e.clientY);

    // Shift+click: multi-select toggle
    if (e.shiftKey) {
      if (target && this._selected.has(target)) {
        this._removeFromSelection(target);
        this._marqueeClickTarget = null;
      } else if (target) {
        this._addToSelection(target);
        this._marqueeClickTarget = null;
      }
      // Start marquee tracking
      this._marquee = {
        startX: svgPt.x,
        startY: svgPt.y,
        currentX: svgPt.x,
        currentY: svgPt.y,
      };
      this._svg.setPointerCapture(e.pointerId);
      return;
    }

    if (target) {
      // If clicking a multi-selected element, drag the group
      if (this._selected.size > 1 && this._selected.has(target)) {
        this._startDrag(target, svgPt, true);
      } else {
        this._select(target);
        this._startDrag(target, svgPt, false);
      }
      this._svg.setPointerCapture(e.pointerId);
    } else {
      // Empty space — start pan
      this._clearSelection();
      this._commitTextEdit();
      this._dragStart = { x: svgPt.x, y: svgPt.y };
      this._dragging = true;
      this._dragTarget = null;
      this._svg.setPointerCapture(e.pointerId);
    }
  }

  _handlePointerMove(e) {
    const svgPt = this._svgPoint(e.clientX, e.clientY);

    // Marquee drawing
    if (this._marquee) {
      this._marquee.currentX = svgPt.x;
      this._marquee.currentY = svgPt.y;
      this._renderMarquee();
      return;
    }

    if (!this._dragging) return;

    if (this._dragTarget) {
      // Move element(s)
      const dx = svgPt.x - this._dragStart.x;
      const dy = svgPt.y - this._dragStart.y;
      this._moveSelected(dx, dy);
      this._dragStart = { x: svgPt.x, y: svgPt.y };
      this._renderHandles();
    } else if (this._dragStart) {
      // Pan viewport
      const dx = svgPt.x - this._dragStart.x;
      const dy = svgPt.y - this._dragStart.y;
      this._viewBox.x -= dx;
      this._viewBox.y -= dy;
      this._applyViewBox();
    }
  }

  _handlePointerUp(e) {
    // Marquee selection
    if (this._marquee) {
      const { startX, startY, currentX, currentY } = this._marquee;
      const dist = Math.sqrt((currentX - startX) ** 2 + (currentY - startY) ** 2);
      if (dist > 5) {
        const isForward = currentX >= startX;
        this._applyMarqueeSelection(startX, startY, currentX, currentY, isForward);
      }
      this._removeMarquee();
      this._marquee = null;
      this._svg.releasePointerCapture(e.pointerId);
      return;
    }

    if (this._dragging && this._dragTarget) {
      this._onEdit();
    }
    this._dragging = false;
    this._dragTarget = null;
    this._dragStart = null;
    this._svg.releasePointerCapture(e.pointerId);
  }

  _startDrag(target, svgPt, isGroup) {
    this._dragging = true;
    this._dragTarget = target;
    this._dragStart = { x: svgPt.x, y: svgPt.y };
  }

  // ── Element movement ───────────────────────────────────────────

  _moveSelected(dx, dy) {
    for (const el of this._selected) {
      this._moveElement(el, dx, dy);
    }
  }

  _moveElement(el, dx, dy) {
    const tag = el.tagName?.toLowerCase();

    switch (tag) {
      case 'rect':
      case 'image':
        el.setAttribute('x', (parseFloat(el.getAttribute('x') || 0) + dx));
        el.setAttribute('y', (parseFloat(el.getAttribute('y') || 0) + dy));
        break;
      case 'circle':
        el.setAttribute('cx', (parseFloat(el.getAttribute('cx') || 0) + dx));
        el.setAttribute('cy', (parseFloat(el.getAttribute('cy') || 0) + dy));
        break;
      case 'ellipse':
        el.setAttribute('cx', (parseFloat(el.getAttribute('cx') || 0) + dx));
        el.setAttribute('cy', (parseFloat(el.getAttribute('cy') || 0) + dy));
        break;
      case 'line':
        el.setAttribute('x1', (parseFloat(el.getAttribute('x1') || 0) + dx));
        el.setAttribute('y1', (parseFloat(el.getAttribute('y1') || 0) + dy));
        el.setAttribute('x2', (parseFloat(el.getAttribute('x2') || 0) + dx));
        el.setAttribute('y2', (parseFloat(el.getAttribute('y2') || 0) + dy));
        break;
      case 'polyline':
      case 'polygon':
        this._translatePoints(el, dx, dy);
        break;
      case 'text': {
        // Auto-detect: attribute-based or transform-based positioning
        const hasXY = el.hasAttribute('x') && el.hasAttribute('y');
        if (hasXY) {
          el.setAttribute('x', (parseFloat(el.getAttribute('x') || 0) + dx));
          el.setAttribute('y', (parseFloat(el.getAttribute('y') || 0) + dy));
        } else {
          this._translateViaTransform(el, dx, dy);
        }
        break;
      }
      case 'path':
      case 'g':
        this._translateViaTransform(el, dx, dy);
        break;
    }
  }

  _translatePoints(el, dx, dy) {
    const pts = el.getAttribute('points') || '';
    const newPts = pts.trim().split(/\s+/).map(pair => {
      const [x, y] = pair.split(',').map(Number);
      return `${x + dx},${y + dy}`;
    }).join(' ');
    el.setAttribute('points', newPts);
  }

  _translateViaTransform(el, dx, dy) {
    const current = el.getAttribute('transform') || '';
    const translateMatch = current.match(/translate\(([^)]+)\)/);
    if (translateMatch) {
      const parts = translateMatch[1].split(/[\s,]+/).map(Number);
      const newX = (parts[0] || 0) + dx;
      const newY = (parts[1] || 0) + dy;
      el.setAttribute('transform', current.replace(/translate\([^)]+\)/, `translate(${newX},${newY})`));
    } else {
      const prefix = current ? current + ' ' : '';
      el.setAttribute('transform', `${prefix}translate(${dx},${dy})`);
    }
  }

  // ── Zoom (mouse wheel) ────────────────────────────────────────

  _handleWheel(e) {
    e.preventDefault();
    const scaleFactor = e.deltaY > 0 ? 1.1 : 0.9;
    const svgPt = this._svgPoint(e.clientX, e.clientY);

    const newW = this._viewBox.w * scaleFactor;
    const newH = this._viewBox.h * scaleFactor;

    // Limit zoom
    const currentZoom = this._svg.clientWidth / this._viewBox.w;
    const newZoom = this._svg.clientWidth / newW;
    if (newZoom < 0.1 || newZoom > 40) return;

    // Zoom centered on cursor
    const ratioX = (svgPt.x - this._viewBox.x) / this._viewBox.w;
    const ratioY = (svgPt.y - this._viewBox.y) / this._viewBox.h;

    this._viewBox.x = svgPt.x - ratioX * newW;
    this._viewBox.y = svgPt.y - ratioY * newH;
    this._viewBox.w = newW;
    this._viewBox.h = newH;
    this._applyViewBox();

    this._zoomLevel = newZoom;
    this._onZoom(newZoom);
  }

  // ── Double-click: text editing ─────────────────────────────────

  _handleDblClick(e) {
    const target = this._findSelectableTarget(e.target);
    if (!target || target.tagName?.toLowerCase() !== 'text') return;

    this._commitTextEdit();

    const bbox = target.getBBox();
    const fontSize = parseFloat(getComputedStyle(target).fontSize) || 14;

    // Create foreignObject with textarea
    const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    fo.setAttribute('x', bbox.x);
    fo.setAttribute('y', bbox.y);
    fo.setAttribute('width', Math.max(bbox.width + 20, 100));
    fo.setAttribute('height', Math.max(bbox.height + 10, fontSize * 2));
    fo.dataset.svgEditorTextEdit = 'true';

    const textarea = document.createElement('textarea');
    textarea.value = target.textContent || '';
    textarea.style.cssText = `
      width: 100%; height: 100%; border: 1px solid #4fc3f7;
      background: rgba(26,26,46,0.9); color: #e0e0e0;
      font-size: ${fontSize}px; font-family: inherit;
      padding: 2px 4px; resize: none; outline: none;
      box-sizing: border-box; border-radius: 3px;
    `;

    textarea.addEventListener('keydown', (ke) => {
      if (ke.key === 'Enter' && !ke.shiftKey) {
        ke.preventDefault();
        this._commitTextEdit();
      } else if (ke.key === 'Escape') {
        this._removeTextEditor();
      }
    });

    fo.appendChild(textarea);
    this._svg.appendChild(fo);
    this._textEditor = { foreignObject: fo, textarea, target };
    textarea.focus();
    textarea.select();
  }

  _commitTextEdit() {
    if (!this._textEditor) return;
    const { textarea, target } = this._textEditor;
    const newText = textarea.value;
    if (newText !== target.textContent) {
      target.textContent = newText;
      this._onEdit();
    }
    this._removeTextEditor();
  }

  _removeTextEditor() {
    if (!this._textEditor) return;
    try {
      this._textEditor.foreignObject.remove();
    } catch (_) {}
    this._textEditor = null;
  }

  // ── Keyboard ───────────────────────────────────────────────────

  _handleKeyDown(e) {
    // Only handle when SVG is hovered or has active text edit
    if (!this._svg.matches(':hover') && !this._textEditor) return;

    if (e.key === 'Escape') {
      if (this._textEditor) {
        this._removeTextEditor();
      } else if (this._marquee) {
        this._removeMarquee();
        this._marquee = null;
      } else {
        this._clearSelection();
      }
      return;
    }

    if (this._textEditor) return; // Don't intercept while editing text

    if ((e.key === 'Delete' || e.key === 'Backspace') && this._selected.size) {
      e.preventDefault();
      this._deleteSelected();
      return;
    }

    if (e.ctrlKey && (e.key === 'c' || e.key === 'C') && this._selected.size) {
      e.preventDefault();
      this._copy();
      return;
    }

    if (e.ctrlKey && (e.key === 'v' || e.key === 'V') && this._clipboard) {
      e.preventDefault();
      this._paste();
      return;
    }

    if (e.ctrlKey && (e.key === 'd' || e.key === 'D') && this._selected.size) {
      e.preventDefault();
      this._duplicate();
      return;
    }
  }

  _deleteSelected() {
    for (const el of this._selected) {
      el.remove();
    }
    this._clearSelection();
    this._onEdit();
  }

  _copy() {
    this._clipboard = [...this._selected].map(el => el.cloneNode(true));
  }

  _paste() {
    if (!this._clipboard?.length) return;
    this._clearSelection();
    for (const clone of this._clipboard) {
      const el = clone.cloneNode(true);
      // Offset slightly
      this._moveElement(el, 10, 10);
      this._svg.appendChild(el);
      this._selected.add(el);
    }
    this._updateSelectedTag();
    this._renderHandles();
    this._onEdit();
  }

  _duplicate() {
    const originals = [...this._selected];
    this._clearSelection();
    for (const orig of originals) {
      const el = orig.cloneNode(true);
      this._moveElement(el, 10, 10);
      this._svg.appendChild(el);
      this._selected.add(el);
    }
    this._updateSelectedTag();
    this._renderHandles();
    this._onEdit();
  }

  // ── Marquee selection ──────────────────────────────────────────

  _renderMarquee() {
    if (!this._marquee) return;
    const { startX, startY, currentX, currentY } = this._marquee;
    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const w = Math.abs(currentX - startX);
    const h = Math.abs(currentY - startY);
    const isForward = currentX >= startX;

    if (!this._marqueeEl) {
      this._marqueeEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      this._marqueeEl.dataset.svgEditorHandle = 'true';
      this._svg.appendChild(this._marqueeEl);
    }

    const strokeWidth = Math.max(1, this._viewBox.w / this._svg.clientWidth);
    this._marqueeEl.setAttribute('x', x);
    this._marqueeEl.setAttribute('y', y);
    this._marqueeEl.setAttribute('width', w);
    this._marqueeEl.setAttribute('height', h);
    this._marqueeEl.setAttribute('fill', isForward ? 'rgba(79,195,247,0.12)' : 'rgba(126,231,135,0.10)');
    this._marqueeEl.setAttribute('stroke', isForward ? '#4fc3f7' : '#7ee787');
    this._marqueeEl.setAttribute('stroke-width', strokeWidth);
    if (!isForward) {
      const dashLen = 4 * strokeWidth;
      this._marqueeEl.setAttribute('stroke-dasharray', `${dashLen} ${dashLen * 0.75}`);
    } else {
      this._marqueeEl.removeAttribute('stroke-dasharray');
    }
  }

  _removeMarquee() {
    if (this._marqueeEl) {
      this._marqueeEl.remove();
      this._marqueeEl = null;
    }
  }

  _applyMarqueeSelection(x1, y1, x2, y2, isContainment) {
    const minX = Math.min(x1, x2);
    const minY = Math.min(y1, y2);
    const maxX = Math.max(x1, x2);
    const maxY = Math.max(y1, y2);

    for (const child of this._svg.children) {
      if (child.dataset?.svgEditorHandle) continue;
      if (child.dataset?.svgEditorTextEdit) continue;
      const tag = child.tagName?.toLowerCase();
      if (!SELECTABLE_TAGS.has(tag)) continue;

      try {
        const bbox = child.getBBox();
        if (isContainment) {
          // Must be fully inside
          if (bbox.x >= minX && bbox.y >= minY &&
              bbox.x + bbox.width <= maxX && bbox.y + bbox.height <= maxY) {
            this._selected.add(child);
          }
        } else {
          // Must intersect
          if (bbox.x + bbox.width >= minX && bbox.x <= maxX &&
              bbox.y + bbox.height >= minY && bbox.y <= maxY) {
            this._selected.add(child);
          }
        }
      } catch (_) {}
    }
    this._updateSelectedTag();
    this._renderHandles();
  }

  // ── Handles ────────────────────────────────────────────────────

  _renderHandles() {
    this._removeHandles();
    if (!this._selected.size) return;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.dataset.svgEditorHandle = 'true';

    const strokeWidth = Math.max(1, this._viewBox.w / this._svg.clientWidth);

    for (const el of this._selected) {
      try {
        const bbox = el.getBBox();

        // Bounding box
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', bbox.x);
        rect.setAttribute('y', bbox.y);
        rect.setAttribute('width', bbox.width);
        rect.setAttribute('height', bbox.height);
        rect.setAttribute('fill', 'none');
        rect.setAttribute('stroke', '#4fc3f7');
        rect.setAttribute('stroke-width', strokeWidth);
        rect.setAttribute('stroke-dasharray', `${strokeWidth * 3} ${strokeWidth * 2}`);
        rect.dataset.svgEditorHandle = 'true';
        g.appendChild(rect);
      } catch (_) {}
    }

    this._svg.appendChild(g);
    this._handles = g;
  }

  _removeHandles() {
    if (this._handles) {
      this._handles.remove();
      this._handles = null;
    }
  }
}