/**
 * AcSvgViewer — side-by-side SVG diff viewer with synchronized pan/zoom.
 *
 * Uses svg-pan-zoom for native SVG viewBox manipulation. Left panel shows
 * HEAD version (read-only), right panel shows working copy (editable via SvgEditor).
 * Both panels are synchronized: pan or zoom one and the other follows.
 */

import { LitElement, html, css } from 'lit';
import { RpcMixin } from '../utils/rpc-mixin.js';
import svgPanZoom from 'svg-pan-zoom';
import { SvgEditor } from '../utils/svg-editor.js';

export class AcSvgViewer extends RpcMixin(LitElement) {
  static properties = {
    _files: { type: Array, state: true },
    _activeIndex: { type: Number, state: true },
    _dirtySet: { type: Object, state: true },
    _mode: { type: String, state: true }, // 'select' | 'pan' | 'present'
    _zoomLevel: { type: Number, state: true },
  };

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      position: relative;
    }

    .diff-container {
      display: flex;
      width: 100%;
      height: 100%;
      position: relative;
    }

    .svg-left, .svg-right {
      flex: 1;
      min-width: 0;
      height: 100%;
      overflow: hidden;
      position: relative;
      background: var(--bg-primary);
    }

    .svg-left {
      border-right: none;
    }

    .splitter {
      width: 4px;
      cursor: ew-resize;
      background: transparent;
      flex-shrink: 0;
      z-index: 2;
    }
    .splitter:hover {
      background: var(--accent-primary);
      opacity: 0.3;
    }

    .svg-left svg, .svg-right svg {
      width: 100%;
      height: 100%;
      display: block;
    }

    /* Watermark (empty state) */
    .watermark {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 8rem;
      opacity: 0.18;
      color: var(--accent-primary);
      user-select: none;
      pointer-events: none;
      font-weight: 700;
    }

    /* Status LED */
    .status-led {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      z-index: 5;
      cursor: pointer;
      transition: transform 0.15s;
      box-shadow: 0 0 6px currentColor;
    }
    .status-led:hover { transform: scale(1.4); }
    .status-led.clean { background: var(--accent-green); color: var(--accent-green); }
    .status-led.dirty {
      background: var(--accent-orange);
      color: var(--accent-orange);
      animation: led-pulse 1.5s infinite;
    }
    .status-led.new-file { background: var(--accent-cyan); color: var(--accent-cyan); }

    @keyframes led-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    /* Floating action buttons */
    .floating-actions {
      position: absolute;
      bottom: 16px;
      right: 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      z-index: 5;
    }

    .fab {
      width: 32px;
      height: 32px;
      border-radius: 6px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      color: var(--text-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.9rem;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      transition: color 0.15s, border-color 0.15s;
    }
    .fab:hover {
      color: var(--text-primary);
      border-color: var(--accent-primary);
    }
    .fab.active {
      color: var(--accent-primary);
      border-color: var(--accent-primary);
      background: rgba(79, 195, 247, 0.08);
    }

    /* Presentation mode: hide left panel */
    .diff-container.present .svg-left,
    .diff-container.present .splitter {
      display: none;
    }
    .diff-container.present .svg-right {
      flex: 1;
    }

    /* Context menu */
    .context-menu {
      position: fixed;
      z-index: 200;
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: 6px;
      padding: 4px 0;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      min-width: 160px;
    }
    .context-menu-item {
      padding: 5px 14px;
      cursor: pointer;
      font-size: 0.8rem;
      color: var(--text-primary);
    }
    .context-menu-item:hover { background: var(--bg-tertiary); }
  `;

  constructor() {
    super();
    this._files = [];
    this._activeIndex = -1;
    this._dirtySet = new Set();
    this._mode = 'select';
    this._zoomLevel = 1;

    this._panZoomLeft = null;
    this._panZoomRight = null;
    this._editor = null;
    this._syncing = false;
    this._undoStack = [];
    this._maxUndo = 50;
    this._contextMenu = null;
    this._resizeObserver = null;
  }

  connectedCallback() {
    super.connectedCallback();

    this._saveHandler = (e) => {
      if (!this._isActiveViewer()) return;
      if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
        if (this._activeIndex >= 0 && this._dirtySet.has(this._activeIndex)) {
          e.preventDefault();
          this._save();
        }
      }
    };
    window.addEventListener('keydown', this._saveHandler);

    this._keyHandler = (e) => {
      if (!this._isActiveViewer()) return;
      if (e.ctrlKey && e.key === 'z') {
        if (this._activeIndex >= 0 && this._undoStack.length > 0) {
          e.preventDefault();
          this._undo();
        }
      }
      if (e.ctrlKey && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        if (this._activeIndex >= 0) {
          e.preventDefault();
          this._copyAsPng();
        }
      }
      if (e.key === 'F11') {
        e.preventDefault();
        this._togglePresentation();
      }
      if (e.key === 'Escape' && this._mode === 'present') {
        this._setMode('select');
      }
      // Tab navigation
      if (e.ctrlKey && e.key === 'PageDown') {
        e.preventDefault();
        this._nextFile();
      } else if (e.ctrlKey && e.key === 'PageUp') {
        e.preventDefault();
        this._prevFile();
      } else if (e.ctrlKey && (e.key === 'w' || e.key === 'W')) {
        if (this._activeIndex >= 0) {
          e.preventDefault();
          this.closeFile(this._files[this._activeIndex]?.path);
        }
      }
    };
    window.addEventListener('keydown', this._keyHandler);

    this._viewerResizeHandler = () => {
      this._resizePanZoom();
    };
    window.addEventListener('viewer-resize', this._viewerResizeHandler);

    this._clickOutsideHandler = (e) => {
      if (this._contextMenu) {
        this._contextMenu = null;
        this.requestUpdate();
      }
    };
    document.addEventListener('click', this._clickOutsideHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._saveHandler);
    window.removeEventListener('keydown', this._keyHandler);
    window.removeEventListener('viewer-resize', this._viewerResizeHandler);
    document.removeEventListener('click', this._clickOutsideHandler);
    this._disposePanZoom();
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }

  // ── Public API (matches diff viewer interface) ─────────────────

  async openFile(opts) {
    const { path } = opts;
    if (!path) return;

    const existingIdx = this._files.findIndex(f => f.path === path);
    if (existingIdx >= 0) {
      if (this._activeIndex !== existingIdx) {
        this._activeIndex = existingIdx;
        await this.updateComplete;
        this._injectAndInit();
      }
      return;
    }

    let original = opts.original ?? '';
    let modified = opts.modified ?? '';

    if (original === '' && modified === '') {
      try {
        [original, modified] = await this._fetchFileContent(path, opts.is_new);
      } catch (e) {
        console.warn('Failed to fetch SVG content:', e);
      }
    }

    const file = {
      path,
      original,
      modified,
      is_new: opts.is_new || false,
      savedContent: modified,
    };

    this._files = [...this._files, file];
    this._activeIndex = this._files.length - 1;
    this._undoStack = [];

    this._dispatchActiveFile(path);

    await this.updateComplete;
    this._injectAndInit();
  }

  closeFile(path) {
    const idx = this._files.findIndex(f => f.path === path);
    if (idx < 0) return;

    const newFiles = this._files.filter((_, i) => i !== idx);
    const newDirty = new Set();
    for (const di of this._dirtySet) {
      if (di === idx) continue;
      newDirty.add(di < idx ? di : di - 1);
    }
    this._dirtySet = newDirty;
    this._files = newFiles;

    if (this._activeIndex >= newFiles.length) {
      this._activeIndex = newFiles.length - 1;
    } else if (this._activeIndex > idx) {
      this._activeIndex--;
    } else if (this._activeIndex === idx) {
      this._activeIndex = Math.min(idx, newFiles.length - 1);
    }

    this._disposePanZoom();

    if (this._activeIndex >= 0) {
      this.updateComplete.then(() => this._injectAndInit());
      this._dispatchActiveFile(this._files[this._activeIndex].path);
    } else {
      this._dispatchActiveFile('');
    }
  }

  async refreshOpenFiles() {
    for (let i = 0; i < this._files.length; i++) {
      const f = this._files[i];
      try {
        const [original, modified] = await this._fetchFileContent(f.path, f.is_new);
        f.original = original;
        f.modified = modified;
        f.savedContent = modified;
      } catch (_) {}
    }
    this._dirtySet = new Set();
    if (this._activeIndex >= 0) {
      await this.updateComplete;
      this._injectAndInit();
    }
  }

  getDirtyFiles() {
    return [...this._dirtySet].map(i => this._files[i]).filter(Boolean);
  }

  _isActiveViewer() {
    return this.style.opacity !== '0' && this._activeIndex >= 0;
  }

  // ── File fetching ──────────────────────────────────────────────

  async _fetchFileContent(path, isNew) {
    let original = '';
    let modified = '';

    if (!isNew) {
      try {
        const raw = await this.rpcExtract('Repo.get_file_content', path, 'HEAD');
        original = this._normalizeContent(raw);
      } catch (_) {}
    }

    try {
      const raw = await this.rpcExtract('Repo.get_file_content', path);
      modified = this._normalizeContent(raw);
    } catch (_) {}

    return [original, modified];
  }

  _normalizeContent(raw) {
    if (typeof raw === 'string') return raw;
    if (raw && typeof raw === 'object' && 'content' in raw) return raw.content || '';
    if (raw && typeof raw === 'object' && 'error' in raw) return '';
    return raw ?? '';
  }

  // ── SVG Injection & Initialization ─────────────────────────────

  _injectAndInit() {
    this._disposePanZoom();

    const file = this._files[this._activeIndex];
    if (!file) return;

    const leftContainer = this.shadowRoot?.querySelector('.svg-left');
    const rightContainer = this.shadowRoot?.querySelector('.svg-right');

    if (!leftContainer || !rightContainer) {
      // DOM not ready — retry next frame
      requestAnimationFrame(() => this._injectAndInit());
      return;
    }

    // Inject SVG content
    const isPresent = this._mode === 'present';

    if (!isPresent && file.original) {
      leftContainer.innerHTML = file.original;
      this._normalizeSvg(leftContainer);
      this._resolveImageHrefs(leftContainer, file.path);
    } else {
      leftContainer.innerHTML = '';
    }

    rightContainer.innerHTML = file.modified || '';
    this._normalizeSvg(rightContainer);
    this._resolveImageHrefs(rightContainer, file.path);

    // Initialize pan/zoom or editor based on mode
    requestAnimationFrame(() => {
      if (this._mode === 'select' || this._mode === 'present') {
        this._initSelectMode(leftContainer, rightContainer, isPresent);
      } else {
        this._initPanMode(leftContainer, rightContainer);
      }

      // Fit content
      this._fitContent();

      // Set up resize observer
      if (this._resizeObserver) this._resizeObserver.disconnect();
      const container = this.shadowRoot?.querySelector('.diff-container');
      if (container) {
        this._resizeObserver = new ResizeObserver(() => this._resizePanZoom());
        this._resizeObserver.observe(container);
      }
    });
  }

  _normalizeSvg(container) {
    const svg = container.querySelector('svg');
    if (!svg) return;

    // Capture authored viewBox and dimensions before modifying
    const authoredViewBox = svg.getAttribute('viewBox');
    const origWidth = svg.getAttribute('width');
    const origHeight = svg.getAttribute('height');

    // Remove explicit width/height so SVG fills container
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.style.width = '100%';
    svg.style.height = '100%';

    // Add viewBox if missing (from original dimensions)
    if (!authoredViewBox && origWidth && origHeight) {
      const w = parseFloat(origWidth) || 300;
      const h = parseFloat(origHeight) || 150;
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }

    // Store whether viewBox was authored
    svg._authoredViewBox = !!authoredViewBox;
  }

  async _resolveImageHrefs(container, filePath) {
    const images = container.querySelectorAll('image');
    if (!images.length) return;

    const fileDir = filePath.includes('/')
      ? filePath.substring(0, filePath.lastIndexOf('/'))
      : '';

    const promises = [];
    for (const img of images) {
      const href = img.getAttribute('href') || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
      if (!href || href.startsWith('data:') || href.startsWith('http://') || href.startsWith('https://')) continue;

      const resolved = fileDir ? `${fileDir}/${href}` : href;
      promises.push(
        this.rpcExtract('Repo.get_file_base64', resolved).then(result => {
          if (result?.data_uri) {
            img.setAttribute('href', result.data_uri);
            if (img.hasAttributeNS('http://www.w3.org/1999/xlink', 'href')) {
              img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', result.data_uri);
            }
          }
        }).catch(e => {
          console.warn(`Image resolve failed for ${href}:`, e);
        })
      );
    }
    await Promise.all(promises);
  }

  // ── Mode Initialization ────────────────────────────────────────

  _initSelectMode(leftContainer, rightContainer, isPresent) {
    // Left panel: svg-pan-zoom (read-only navigation) — skip in present mode
    if (!isPresent) {
      const leftSvg = leftContainer.querySelector('svg');
      if (leftSvg) {
        try {
          this._panZoomLeft = svgPanZoom(leftSvg, {
            zoomEnabled: true,
            panEnabled: true,
            controlIconsEnabled: false,
            fit: true,
            center: true,
            minZoom: 0.1,
            maxZoom: 40,
            zoomScaleSensitivity: 0.3,
            onZoom: () => this._syncLeftToRight(),
            onPan: () => this._syncLeftToRight(),
          });
        } catch (e) {
          console.warn('svg-pan-zoom init failed (left):', e);
        }
      }
    }

    // Right panel: SvgEditor (visual editing)
    const rightSvg = rightContainer.querySelector('svg');
    if (rightSvg) {
      rightSvg.setAttribute('preserveAspectRatio', 'none');
      this._editor = new SvgEditor(rightSvg, {
        onEdit: () => this._onEditorEdit(),
        onZoom: (zoomLevel) => this._onEditorZoom(zoomLevel),
      });
    }
  }

  _initPanMode(leftContainer, rightContainer) {
    const leftSvg = leftContainer.querySelector('svg');
    const rightSvg = rightContainer.querySelector('svg');

    if (leftSvg) {
      try {
        this._panZoomLeft = svgPanZoom(leftSvg, {
          zoomEnabled: true, panEnabled: true,
          controlIconsEnabled: false,
          fit: true, center: true,
          minZoom: 0.1, maxZoom: 40,
          zoomScaleSensitivity: 0.3,
          onZoom: () => this._syncLeftToRight(),
          onPan: () => this._syncLeftToRight(),
        });
      } catch (e) {
        console.warn('svg-pan-zoom init failed (left):', e);
      }
    }

    if (rightSvg) {
      try {
        this._panZoomRight = svgPanZoom(rightSvg, {
          zoomEnabled: true, panEnabled: true,
          controlIconsEnabled: false,
          fit: true, center: true,
          minZoom: 0.1, maxZoom: 40,
          zoomScaleSensitivity: 0.3,
          onZoom: () => this._syncRightToLeft(),
          onPan: () => this._syncRightToLeft(),
        });
      } catch (e) {
        console.warn('svg-pan-zoom init failed (right):', e);
      }
    }
  }

  _disposePanZoom() {
    if (this._panZoomLeft) {
      try { this._panZoomLeft.destroy(); } catch (_) {}
      this._panZoomLeft = null;
    }
    if (this._panZoomRight) {
      try { this._panZoomRight.destroy(); } catch (_) {}
      this._panZoomRight = null;
    }
    if (this._editor) {
      this._editor.dispose();
      this._editor = null;
    }
  }

  _resizePanZoom() {
    requestAnimationFrame(() => {
      if (this._panZoomLeft) {
        try { this._panZoomLeft.resize(); } catch (_) {}
      }
      if (this._panZoomRight) {
        try { this._panZoomRight.resize(); } catch (_) {}
      }
    });
  }

  // ── Synchronization ────────────────────────────────────────────

  _syncLeftToRight() {
    if (this._syncing) return;
    this._syncing = true;
    requestAnimationFrame(() => {
      try {
        if (this._panZoomLeft && this._editor) {
          const leftSvg = this.shadowRoot?.querySelector('.svg-left svg');
          if (leftSvg) {
            const vb = leftSvg.getAttribute('viewBox');
            if (vb) this._editor.setViewBox(vb);
          }
        } else if (this._panZoomLeft && this._panZoomRight) {
          const pan = this._panZoomLeft.getPan();
          const zoom = this._panZoomLeft.getZoom();
          this._panZoomRight.zoom(zoom);
          this._panZoomRight.pan(pan);
        }
      } catch (_) {}
      this._syncing = false;
    });
  }

  _syncRightToLeft() {
    if (this._syncing) return;
    this._syncing = true;
    requestAnimationFrame(() => {
      try {
        if (this._panZoomRight && this._panZoomLeft) {
          const pan = this._panZoomRight.getPan();
          const zoom = this._panZoomRight.getZoom();
          this._panZoomLeft.zoom(zoom);
          this._panZoomLeft.pan(pan);
        }
      } catch (_) {}
      this._syncing = false;
    });
  }

  _onEditorZoom(zoomLevel) {
    this._zoomLevel = zoomLevel;
    // Sync back to left panel
    if (this._panZoomLeft && !this._syncing) {
      this._syncing = true;
      try {
        this._panZoomLeft.zoom(zoomLevel);
      } catch (_) {}
      this._syncing = false;
    }
  }

  // ── Editing ────────────────────────────────────────────────────

  _onEditorEdit() {
    if (this._activeIndex < 0) return;
    const file = this._files[this._activeIndex];
    if (!file) return;

    // Push undo snapshot (before the edit)
    if (this._undoStack.length >= this._maxUndo) this._undoStack.shift();
    this._undoStack.push(file.modified);

    // Update modified content
    const svg = this.shadowRoot?.querySelector('.svg-right svg');
    if (svg) {
      file.modified = new XMLSerializer().serializeToString(svg);
    }

    // Mark dirty
    if (!this._dirtySet.has(this._activeIndex)) {
      this._dirtySet = new Set([...this._dirtySet, this._activeIndex]);
    }
  }

  _undo() {
    if (!this._undoStack.length || this._activeIndex < 0) return;
    const file = this._files[this._activeIndex];
    if (!file) return;

    const prev = this._undoStack.pop();
    file.modified = prev;

    // Re-inject and reinitialize
    this.updateComplete.then(() => this._injectAndInit());

    // Check if back to saved state
    if (file.modified === file.savedContent) {
      const next = new Set(this._dirtySet);
      next.delete(this._activeIndex);
      this._dirtySet = next;
    }
  }

  // ── Save ───────────────────────────────────────────────────────

  async _save() {
    if (this._activeIndex < 0) return;
    const file = this._files[this._activeIndex];
    if (!file) return;

    // Get clean content from editor
    let content = file.modified;
    if (this._editor) {
      content = this._editor.getContent();
      file.modified = content;
    }

    file.savedContent = content;

    const next = new Set(this._dirtySet);
    next.delete(this._activeIndex);
    this._dirtySet = next;

    // Dispatch save
    window.dispatchEvent(new CustomEvent('file-save', {
      detail: { path: file.path, content },
      bubbles: true, composed: true,
    }));
  }

  // ── Fit ────────────────────────────────────────────────────────

  _fitContent() {
    if (this._panZoomLeft) {
      try {
        this._panZoomLeft.fit();
        this._panZoomLeft.center();
      } catch (_) {}
    }
    if (this._editor) {
      this._editor.fitContent();
    } else if (this._panZoomRight) {
      try {
        this._panZoomRight.fit();
        this._panZoomRight.center();
      } catch (_) {}
    }
  }

  // ── Mode switching ─────────────────────────────────────────────

  _setMode(mode) {
    if (this._mode === mode) return;

    // Save current editor content before mode switch
    if (this._editor && this._activeIndex >= 0) {
      const file = this._files[this._activeIndex];
      if (file) file.modified = this._editor.getContent();
    }

    this._mode = mode;
    this._disposePanZoom();

    this.updateComplete.then(() => this._injectAndInit());
  }

  _togglePresentation() {
    if (this._mode === 'present') {
      this._setMode('select');
    } else {
      this._setMode('present');
    }
  }

  // ── Navigation ─────────────────────────────────────────────────

  _nextFile() {
    if (this._files.length <= 1) return;
    this._activeIndex = (this._activeIndex + 1) % this._files.length;
    this._undoStack = [];
    this.updateComplete.then(() => this._injectAndInit());
    this._dispatchActiveFile(this._files[this._activeIndex].path);
  }

  _prevFile() {
    if (this._files.length <= 1) return;
    this._activeIndex = (this._activeIndex - 1 + this._files.length) % this._files.length;
    this._undoStack = [];
    this.updateComplete.then(() => this._injectAndInit());
    this._dispatchActiveFile(this._files[this._activeIndex].path);
  }

  _dispatchActiveFile(path) {
    window.dispatchEvent(new CustomEvent('active-file-changed', {
      detail: { path },
    }));
  }

  // ── Copy as PNG ────────────────────────────────────────────────

  async _copyAsPng() {
    const rightContainer = this.shadowRoot?.querySelector('.svg-right');
    const svg = rightContainer?.querySelector('svg');
    if (!svg) return;

    try {
      const svgData = new XMLSerializer().serializeToString(svg);
      const viewBox = svg.getAttribute('viewBox');
      let width = 800, height = 600;
      if (viewBox) {
        const parts = viewBox.split(/[\s,]+/).map(Number);
        if (parts.length === 4) {
          width = parts[2];
          height = parts[3];
        }
      }

      // Scale up for quality (max 4096px)
      const maxDim = Math.max(width, height);
      const scale = Math.min(4, 4096 / maxDim);
      const canvasW = Math.round(width * scale);
      const canvasH = Math.round(height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext('2d');

      // White background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvasW, canvasH);

      // Render SVG via Image
      const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });

      ctx.drawImage(img, 0, 0, canvasW, canvasH);
      URL.revokeObjectURL(url);

      // Copy to clipboard
      try {
        const pngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': pngBlob }),
        ]);
      } catch (_) {
        // Fallback: download
        canvas.toBlob(blob => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'svg-export.png';
          a.click();
          URL.revokeObjectURL(a.href);
        }, 'image/png');
      }
    } catch (e) {
      console.warn('Copy as PNG failed:', e);
    }
  }

  // ── Context menu ───────────────────────────────────────────────

  _onContextMenu(e) {
    e.preventDefault();
    this._contextMenu = { x: e.clientX, y: e.clientY };
    this.requestUpdate();
  }

  _contextMenuAction(action) {
    this._contextMenu = null;
    this.requestUpdate();
    if (action === 'copy-png') this._copyAsPng();
  }

  // ── Render ─────────────────────────────────────────────────────

  render() {
    const hasFiles = this._files.length > 0;
    const file = hasFiles ? this._files[this._activeIndex] : null;
    const isDirty = this._activeIndex >= 0 && this._dirtySet.has(this._activeIndex);
    const isPresent = this._mode === 'present';

    if (!hasFiles) {
      return html`<div class="watermark">AC⚡DC</div>`;
    }

    return html`
      <div class="diff-container ${isPresent ? 'present' : ''}"
           @contextmenu=${this._onContextMenu}>
        <div class="svg-left"></div>
        ${!isPresent ? html`<div class="splitter"></div>` : ''}
        <div class="svg-right"></div>
      </div>

      <!-- Floating actions -->
      <div class="floating-actions">
        <button class="fab ${isPresent ? 'active' : ''}"
                title="Presentation mode (F11)"
                @click=${this._togglePresentation}>◱</button>
        <button class="fab" title="Fit to view"
                @click=${this._fitContent}>⊡</button>
      </div>

      <!-- Status LED -->
      ${file ? html`
        <div class="status-led ${isDirty ? 'dirty' : file.is_new ? 'new-file' : 'clean'}"
             title="${file.path}${isDirty ? ' — click to save (Ctrl+S)' : ''}"
             @click=${() => isDirty ? this._save() : null}></div>
      ` : ''}

      <!-- Context menu -->
      ${this._contextMenu ? html`
        <div class="context-menu"
             style="left:${this._contextMenu.x}px;top:${this._contextMenu.y}px">
          <div class="context-menu-item"
               @click=${() => this._contextMenuAction('copy-png')}>
            Copy as PNG (Ctrl+Shift+C)
          </div>
        </div>
      ` : ''}
    `;
  }
}

customElements.define('ac-svg-viewer', AcSvgViewer);