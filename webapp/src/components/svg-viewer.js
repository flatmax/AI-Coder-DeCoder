/**
 * SVG Viewer — side-by-side SVG diff viewer with editing.
 *
 * Left panel: original SVG (read-only, svg-pan-zoom for navigation).
 * Right panel: editable SVG (SvgEditor for drag/resize, synchronized viewport).
 *
 * Modes:
 *   - "select" (default): right panel uses SvgEditor for editing, left uses svg-pan-zoom.
 *     Viewport sync: left panel drives, viewBox is copied to right panel.
 *   - "pan": both panels use svg-pan-zoom for navigation only, editing disabled.
 *
 * Uses svg-pan-zoom for native SVG viewBox manipulation (stays crisp at any zoom).
 * Uses SvgEditor for pointer-based SVG element editing.
 */

import { LitElement, html, css, nothing } from 'lit';
import { theme, scrollbarStyles } from '../styles/theme.js';
import { RpcMixin } from '../rpc-mixin.js';
import svgPanZoom from 'svg-pan-zoom';
import { SvgEditor } from './svg-editor.js';

export class AcSvgViewer extends RpcMixin(LitElement) {
  static properties = {
    _files:       { type: Array, state: true },
    _activeIndex: { type: Number, state: true },
    _dirtySet:    { type: Object, state: true },
    _zoomLevel:   { type: Number, state: true },
    _mode:        { type: String, state: true },       // 'select' | 'pan'
    _selectedTag: { type: String, state: true },       // tag name of selected element
  };

  static styles = [theme, scrollbarStyles, css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }

    /* Diff container — side by side */
    .diff-container {
      flex: 1;
      display: flex;
      flex-direction: row;
      min-height: 0;
      overflow: hidden;
      position: relative;
    }

    .diff-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      position: relative;
    }
    .diff-panel + .diff-panel {
      border-left: 1px solid var(--border-primary);
    }

    .svg-container {
      flex: 1;
      min-height: 0;
      overflow: hidden;
      background: var(--bg-primary);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .svg-container svg {
      width: 100%;
      height: 100%;
    }

    .svg-left svg {
      cursor: grab;
    }
    .svg-left svg:active {
      cursor: grabbing;
    }

    /* Fit button — floating bottom-right */
    .fit-btn {
      position: absolute;
      bottom: 12px;
      right: 16px;
      z-index: 10;
      width: 32px;
      height: 32px;
      border-radius: 6px;
      border: 1px solid var(--border-primary);
      background: var(--bg-secondary);
      color: var(--text-secondary);
      font-size: 1rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s, color 0.15s;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .fit-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    /* Splitter handle */
    .splitter {
      width: 4px;
      background: transparent;
      flex-shrink: 0;
      z-index: 1;
    }

    /* Status LED — floating top-right indicator */
    .status-led {
      position: absolute;
      top: 8px;
      right: 16px;
      z-index: 10;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      cursor: pointer;
      transition: box-shadow 0.3s, background 0.3s;
      border: none;
      padding: 0;
    }
    .status-led.dirty {
      background: var(--accent-orange, #f0883e);
      box-shadow: 0 0 6px 2px rgba(240, 136, 62, 0.6);
      animation: led-pulse 2s ease-in-out infinite;
    }
    .status-led.clean {
      background: var(--accent-green);
      box-shadow: 0 0 4px 1px rgba(126, 231, 135, 0.4);
    }
    .status-led.new-file {
      background: var(--accent-primary);
      box-shadow: 0 0 4px 1px rgba(79, 195, 247, 0.4);
    }
    .status-led:hover {
      transform: scale(1.4);
    }
    @keyframes led-pulse {
      0%, 100% { opacity: 0.7; box-shadow: 0 0 6px 2px rgba(240, 136, 62, 0.4); }
      50% { opacity: 1; box-shadow: 0 0 10px 3px rgba(240, 136, 62, 0.8); }
    }

    /* Context menu */
    .context-menu {
      position: absolute;
      z-index: 100;
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: 6px;
      padding: 4px 0;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      min-width: 160px;
    }
    .context-menu button {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 6px 14px;
      background: none;
      border: none;
      color: var(--text-primary);
      font-size: 0.75rem;
      cursor: pointer;
      text-align: left;
    }
    .context-menu button:hover {
      background: var(--bg-hover);
    }
    .context-menu button .shortcut {
      margin-left: auto;
      color: var(--text-muted);
      font-size: 0.65rem;
    }

    /* Empty state */
    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
    }
    .watermark {
      font-size: 8rem;
      opacity: 0.18;
      user-select: none;
    }
  `];

  constructor() {
    super();
    this._files = [];
    this._activeIndex = -1;
    this._dirtySet = new Set();
    this._zoomLevel = 100;
    this._mode = 'select';   // 'select' or 'pan'
    this._selectedTag = '';

    this._panZoomLeft = null;
    this._panZoomRight = null;   // only used in 'pan' mode
    this._svgEditor = null;       // only used in 'select' mode
    this._resizeObserver = null;
    this._undoStack = [];         // per-file undo: array of SVG strings

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onContextMenu = this._onContextMenu.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this._onKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._onKeyDown);
    this._dismissContextMenu();
    this._disposeAll();
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }

  firstUpdated() {
    const container = this.shadowRoot.querySelector('.diff-container');
    if (container) {
      this._resizeObserver = new ResizeObserver(() => this._handleResize());
      this._resizeObserver.observe(container);
    }
  }

  // === Public API (mirrors diff-viewer) ===

  async openFile(opts) {
    const { path } = opts;
    if (!path) return;

    const existingIdx = this._files.findIndex(f => f.path === path);
    if (existingIdx !== -1) {
      this._activeIndex = existingIdx;
      await this.updateComplete;
      this._injectSvgContent();
      this._dispatchActiveFileChanged(path);
      return;
    }

    let original = opts.original ?? '';
    let modified = opts.modified ?? '';
    let is_new = opts.is_new ?? false;

    // Fetch content if not provided
    if (!original && !modified) {
      const content = await this._fetchSvgContent(path);
      if (content === null) {
        console.warn('SVG viewer: no content for', path);
        return;
      }
      original = content.original;
      modified = content.modified;
      is_new = content.is_new;
    }

    console.log(`SVG viewer: opening ${path} (original: ${original.length} chars, modified: ${modified.length} chars, new: ${is_new})`);

    const fileObj = {
      path,
      original,
      modified,
      is_new,
      savedContent: modified,
    };

    this._files = [...this._files, fileObj];
    this._activeIndex = this._files.length - 1;
    this._undoStack = [modified];

    await this.updateComplete;
    this._injectSvgContent();
    this._dispatchActiveFileChanged(path);
  }

  async refreshOpenFiles() {
    const updatedFiles = [];
    let changed = false;

    for (const file of this._files) {
      const content = await this._fetchSvgContent(file.path);
      if (content === null) {
        updatedFiles.push(file);
        continue;
      }
      updatedFiles.push({
        ...file,
        original: content.original,
        modified: content.modified,
        is_new: content.is_new,
        savedContent: content.modified,
      });
      changed = true;
    }

    if (changed) {
      this._files = updatedFiles;
      this._dirtySet = new Set();
      await this.updateComplete;
      this._injectSvgContent();
    }
  }

  closeFile(path) {
    const idx = this._files.findIndex(f => f.path === path);
    if (idx === -1) return;

    this._dirtySet.delete(path);
    this._files = this._files.filter(f => f.path !== path);

    if (this._files.length === 0) {
      this._activeIndex = -1;
      this._disposeAll();
      this._dispatchActiveFileChanged(null);
    } else if (this._activeIndex >= this._files.length) {
      this._activeIndex = this._files.length - 1;
      this.updateComplete.then(() => this._injectSvgContent());
      this._dispatchActiveFileChanged(this._files[this._activeIndex].path);
    } else if (idx <= this._activeIndex) {
      this._activeIndex = Math.max(0, this._activeIndex - 1);
      this.updateComplete.then(() => this._injectSvgContent());
      this._dispatchActiveFileChanged(this._files[this._activeIndex].path);
    }
  }

  getDirtyFiles() {
    return [...this._dirtySet];
  }

  // === SVG Content Fetching ===

  async _fetchSvgContent(path) {
    if (!this.rpcConnected) {
      console.warn('SVG viewer: RPC not connected, cannot fetch', path);
      return null;
    }
    try {
      let original = '';
      let modified = '';
      let is_new = false;

      // Fetch HEAD version (may fail for new files)
      let headContent = '';
      try {
        const headResult = await this.rpcExtract('Repo.get_file_content', path, 'HEAD');
        headContent = typeof headResult === 'string' ? headResult : (headResult?.content ?? '');
      } catch {
        // File doesn't exist in HEAD — it's new
      }

      // Fetch working copy
      let workContent = '';
      try {
        const workResult = await this.rpcExtract('Repo.get_file_content', path);
        workContent = typeof workResult === 'string' ? workResult : (workResult?.content ?? '');
      } catch {
        // File doesn't exist in working copy
      }

      if (!headContent && !workContent) {
        console.warn('SVG file not found:', path);
        return null;
      }

      if (!headContent) {
        is_new = true;
      }

      original = headContent;
      modified = workContent || headContent;

      return { original, modified, is_new };
    } catch (e) {
      console.warn('Failed to fetch SVG content:', path, e);
      return null;
    }
  }

  // === Mode Switching ===

  _setMode(mode) {
    if (mode === this._mode) return;

    // Capture current modified content from editor before switching
    this._captureEditorContent();

    this._mode = mode;
    this._selectedTag = '';

    // Re-inject and re-initialize for the new mode
    this.updateComplete.then(() => this._injectSvgContent());
  }

  /**
   * Capture the current SVG content from the editor (right panel)
   * back into the file object, so it's preserved across mode switches.
   */
  _captureEditorContent() {
    if (!this._svgEditor) return;
    const file = this._getActiveFile();
    if (!file) return;

    const content = this._svgEditor.getContent();
    if (content && content !== file.modified) {
      file.modified = content;
    }
  }

  // === Dispose Helpers ===

  _disposeAll() {
    this._disposePanZoom();
    this._disposeEditor();
  }

  _disposePanZoom() {
    if (this._panZoomLeft) {
      try { this._panZoomLeft.destroy(); } catch {}
      this._panZoomLeft = null;
    }
    if (this._panZoomRight) {
      try { this._panZoomRight.destroy(); } catch {}
      this._panZoomRight = null;
    }
  }

  _disposeEditor() {
    if (this._svgEditor) {
      this._svgEditor.dispose();
      this._svgEditor = null;
    }
  }

  // === Pan/Zoom Management (Left Panel — always active) ===

  _initLeftPanZoom() {
    if (this._panZoomLeft) {
      try { this._panZoomLeft.destroy(); } catch {}
      this._panZoomLeft = null;
    }

    const leftSvg = this.shadowRoot.querySelector('.svg-left svg');
    if (!leftSvg) return;

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
        dblClickZoomEnabled: true,
      });
    } catch (e) {
      console.warn('svg-pan-zoom init failed for left panel:', e);
    }

    this._zoomLevel = 100;
  }

  /**
   * In 'pan' mode: initialize svg-pan-zoom on the right panel too,
   * with bidirectional sync.
   */
  _initRightPanZoom() {
    if (this._panZoomRight) {
      try { this._panZoomRight.destroy(); } catch {}
      this._panZoomRight = null;
    }

    const rightSvg = this.shadowRoot.querySelector('.svg-right svg');
    if (!rightSvg) return;

    try {
      this._panZoomRight = svgPanZoom(rightSvg, {
        zoomEnabled: true,
        panEnabled: true,
        controlIconsEnabled: false,
        fit: true,
        center: true,
        minZoom: 0.1,
        maxZoom: 40,
        zoomScaleSensitivity: 0.3,
        dblClickZoomEnabled: true,
        onZoom: onUpdate,
        onPan: onUpdate,
        onUpdatedCTM: onUpdate,
      });
    } catch (e) {
      console.warn('svg-pan-zoom init failed for right panel:', e);
    }

    // Sync initial viewport from left
    this._syncLeftToRight();
  }

  /**
   * In 'select' mode: initialize SvgEditor on the right panel SVG.
   */
  _initEditor() {
    this._disposeEditor();

    const rightSvg = this.shadowRoot.querySelector('.svg-right svg');
    if (!rightSvg) return;

    const file = this._getActiveFile();

    this._svgEditor = new SvgEditor(rightSvg, {
      onDirty: () => {
        if (file) {
          this._dirtySet.add(file.path);
          this._dirtySet = new Set(this._dirtySet);
          // Push undo snapshot
          const content = this._svgEditor?.getContent();
          if (content) {
            this._undoStack.push(content);
            // Keep undo stack manageable
            if (this._undoStack.length > 50) this._undoStack.shift();
          }
        }
      },
      onSelect: (el) => {
        if (this._svgEditor && this._svgEditor._multiSelected.size > 1) {
          this._selectedTag = `${this._svgEditor._multiSelected.size} elements`;
        } else {
          this._selectedTag = el ? `<${el.tagName.toLowerCase()}>` : '';
        }
      },
      onDeselect: () => {
        this._selectedTag = '';
      },
      onZoom: ({ zoom }) => {
        this._zoomLevel = Math.round(zoom * 100);
      },
    });
  }

  /**
   * Sync the left panel's viewport to the right panel.
   * In 'select' mode: copies the left viewBox to the right (via SvgEditor).
   * In 'pan' mode: uses svg-pan-zoom API.
   */
  _syncLeftToRight() {
    if (!this._panZoomLeft) return;

    if (this._mode === 'pan' && this._panZoomRight) {
      const zoom = this._panZoomLeft.getZoom();
      const pan = this._panZoomLeft.getPan();
      this._panZoomRight.zoom(zoom);
      this._panZoomRight.pan(pan);
    } else if (this._mode === 'select' && this._svgEditor) {
      // svg-pan-zoom doesn't modify the viewBox attribute — it uses an
      // internal viewport-group transform.  Compute the effective visible
      // area from the pan-zoom zoom/pan state and the original viewBox.
      const leftSvg = this.shadowRoot.querySelector('.svg-left svg');
      if (leftSvg) {
        const origVb = this._getOriginalViewBox(leftSvg);
        if (origVb) {
          const zoom = this._panZoomLeft.getZoom();
          const pan = this._panZoomLeft.getPan();
          const w = origVb.w / zoom;
          const h = origVb.h / zoom;
          const x = origVb.x - pan.x / zoom;
          const y = origVb.y - pan.y / zoom;
          this._svgEditor.setViewBox(x, y, w, h);
        }
      }
    }
  }

  /**
   * Sync the right panel's viewport (from SvgEditor zoom/pan) to the left panel.
   * Used in 'select' mode when the user zooms/pans in the editor.
   */
  _syncRightToLeft(viewBox) {
    if (!this._panZoomLeft || this._syncing) return;
    this._syncing = true;
    try {
      // svg-pan-zoom doesn't have a direct setViewBox, so we manipulate
      // the left SVG's internal viewport group to match.
      // The simplest reliable approach: set the left SVG's viewBox directly
      // and re-initialize pan-zoom, or use the pan-zoom's zoom/pan API.
      const leftSvg = this.shadowRoot.querySelector('.svg-left svg');
      if (!leftSvg) return;

      // Temporarily destroy pan-zoom, set viewBox, reinit
      // This is expensive, so instead we'll just set the viewBox on the
      // inner viewport group that svg-pan-zoom creates.
      const vpGroup = leftSvg.querySelector('.svg-pan-zoom_viewport');
      if (vpGroup && viewBox) {
        // Calculate the transform that maps the original viewBox to the new one
        const origVb = this._getOriginalViewBox(leftSvg);
        if (origVb) {
          const scaleX = origVb.w / viewBox.w;
          const scaleY = origVb.h / viewBox.h;
          const scale = Math.min(scaleX, scaleY);
          const tx = -(viewBox.x - origVb.x) * scale;
          const ty = -(viewBox.y - origVb.y) * scale;

          // Use svg-pan-zoom API
          this._panZoomLeft.zoom(scale);
          this._panZoomLeft.pan({ x: tx, y: ty });
        }
      }
    } finally {
      this._syncing = false;
    }
  }

  /**
   * Get the original viewBox of an SVG element (before svg-pan-zoom modified it).
   */
  _getOriginalViewBox(svgEl) {
    // svg-pan-zoom stores the original viewBox; we can read it from the
    // svg element's viewBox.baseVal if available, or fall back to attribute
    const vb = svgEl.viewBox?.baseVal;
    if (vb && vb.width > 0) {
      return { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
    }
    const attr = svgEl.getAttribute('viewBox');
    if (attr) {
      const parts = attr.split(/[\s,]+/).map(Number);
      return { x: parts[0] || 0, y: parts[1] || 0, w: parts[2] || 800, h: parts[3] || 600 };
    }
    return { x: 0, y: 0, w: 800, h: 600 };
  }

  _handleResize() {
    if (this._panZoomLeft) this._panZoomLeft.resize();
    if (this._panZoomRight) this._panZoomRight.resize();
  }

  // === Toolbar Actions ===

  _zoomIn() {
    if (this._panZoomLeft) this._panZoomLeft.zoomIn();
  }

  _zoomOut() {
    if (this._panZoomLeft) this._panZoomLeft.zoomOut();
  }

  _zoomReset() {
    if (this._panZoomLeft) {
      this._panZoomLeft.resetZoom();
      this._panZoomLeft.resetPan();
    }
    if (this._panZoomRight) {
      this._panZoomRight.resetZoom();
      this._panZoomRight.resetPan();
    }
    this._zoomLevel = 100;
  }

  _fitAll() {
    if (this._panZoomLeft) {
      this._panZoomLeft.resize();
      this._panZoomLeft.fit();
      this._panZoomLeft.center();
      this._zoomLevel = Math.round(this._panZoomLeft.getZoom() * 100);
    }
    if (this._panZoomRight) {
      this._panZoomRight.resize();
      this._panZoomRight.fit();
      this._panZoomRight.center();
    }

    // In select mode, use the editor's own fit method which accounts
    // for the container aspect ratio and resets zoom.
    if (this._mode === 'select' && this._svgEditor) {
      this._svgEditor.fitContent();
    }
  }

  _undo() {
    if (this._undoStack.length <= 1) return; // nothing to undo (first entry is original)
    this._undoStack.pop(); // remove current state
    const prev = this._undoStack[this._undoStack.length - 1];
    if (!prev) return;

    const file = this._getActiveFile();
    if (file) {
      file.modified = prev;
      // Re-inject and re-init editor
      this._injectSvgContent();
    }
  }

  async _save() {
    const file = this._getActiveFile();
    if (!file) return;

    // Capture latest from editor
    this._captureEditorContent();

    if (!this.rpcConnected) {
      console.warn('SVG viewer: RPC not connected, cannot save');
      return;
    }

    try {
      await this.rpcCall('Repo.write_file', file.path, file.modified);
      file.savedContent = file.modified;
      this._dirtySet.delete(file.path);
      this._dirtySet = new Set(this._dirtySet);

      this.dispatchEvent(new CustomEvent('file-saved', {
        bubbles: true, composed: true,
        detail: { path: file.path, content: file.modified },
      }));
    } catch (e) {
      console.error('Failed to save SVG:', e);
    }
  }

  // === Copy Image ===

  /**
   * Render the current modified SVG to a canvas and copy as PNG to clipboard.
   */
  async _copyImage() {
    const file = this._getActiveFile();
    if (!file) return;

    // Get latest content from editor
    this._captureEditorContent();
    const svgText = file.modified || file.original || '';
    if (!svgText.trim()) return;

    try {
      // Parse SVG to determine intrinsic size
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgText, 'image/svg+xml');
      const svgEl = doc.documentElement;

      // Determine render dimensions from viewBox or width/height attributes
      let width = 1920;
      let height = 1080;
      const vb = svgEl.getAttribute('viewBox');
      if (vb) {
        const parts = vb.split(/[\s,]+/).map(Number);
        if (parts[2] > 0 && parts[3] > 0) {
          width = parts[2];
          height = parts[3];
        }
      } else {
        const w = parseFloat(svgEl.getAttribute('width'));
        const h = parseFloat(svgEl.getAttribute('height'));
        if (w > 0 && h > 0) { width = w; height = h; }
      }

      // Scale up for high-quality output (min 2x, capped at 4096px on longest side)
      const maxDim = Math.max(width, height);
      const scale = maxDim < 1024 ? Math.min(4, 4096 / maxDim) : Math.min(2, 4096 / maxDim);
      const renderW = Math.round(width * scale);
      const renderH = Math.round(height * scale);

      // Ensure the SVG has explicit dimensions for the Image element
      svgEl.setAttribute('width', renderW);
      svgEl.setAttribute('height', renderH);

      const serializer = new XMLSerializer();
      const svgBlob = new Blob([serializer.serializeToString(svgEl)], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.width = renderW;
      img.height = renderH;

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });

      const canvas = document.createElement('canvas');
      canvas.width = renderW;
      canvas.height = renderH;
      const ctx = canvas.getContext('2d');

      // White background (SVGs often have transparent bg)
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, renderW, renderH);
      ctx.drawImage(img, 0, 0, renderW, renderH);

      URL.revokeObjectURL(url);

      // Copy to clipboard — pass a Promise<Blob> to ClipboardItem so the
      // browser can preserve the user-gesture context across the async gap.
      if (navigator.clipboard?.write) {
        const blobPromise = new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blobPromise }),
          ]);
          this._showCopyToast('Image copied to clipboard');
        } catch (clipErr) {
          console.warn('Clipboard write failed, falling back to download:', clipErr);
          const blob = await blobPromise;
          this._downloadBlob(blob, file.path);
        }
      } else {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        this._downloadBlob(blob, file.path);
      }
    } catch (err) {
      console.error('Failed to copy SVG as image:', err);
      this._showCopyToast('Failed to copy image');
    }
  }

  _showCopyToast(message) {
    this.dispatchEvent(new CustomEvent('show-toast', {
      bubbles: true, composed: true,
      detail: { message, type: 'info' },
    }));
  }

  _downloadBlob(blob, filePath) {
    if (!blob) {
      this._showCopyToast('Failed to create image');
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (filePath.split('/').pop() || 'image').replace(/\.svg$/i, '') + '.png';
    a.click();
    URL.revokeObjectURL(a.href);
    this._showCopyToast('Image downloaded as PNG');
  }

  // === Context Menu ===

  _onContextMenu(e) {
    // Only show on the right (editable) panel
    const rightPanel = this.shadowRoot.querySelector('.svg-right');
    if (!rightPanel || !rightPanel.contains(e.target)) return;

    e.preventDefault();
    this._dismissContextMenu();

    const container = this.shadowRoot.querySelector('.diff-container');
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const copyBtn = document.createElement('button');
    copyBtn.innerHTML = '📋 Copy as PNG <span class="shortcut">Ctrl+Shift+C</span>';
    copyBtn.addEventListener('click', () => {
      this._dismissContextMenu();
      this._copyImage();
    });
    menu.appendChild(copyBtn);

    container.appendChild(menu);
    this._contextMenu = menu;

    // Dismiss on next click anywhere (use 'click' so menu buttons fire first)
    const dismiss = (ev) => {
      if (menu.contains(ev.target)) return;
      this._dismissContextMenu();
    };
    // Use setTimeout so the current right-click doesn't immediately dismiss
    setTimeout(() => {
      window.addEventListener('click', dismiss, { capture: true });
      window.addEventListener('contextmenu', dismiss, { capture: true });
      this._contextMenuDismiss = () => {
        window.removeEventListener('click', dismiss, { capture: true });
        window.removeEventListener('contextmenu', dismiss, { capture: true });
      };
    }, 0);
  }

  _dismissContextMenu() {
    if (this._contextMenu) {
      this._contextMenu.remove();
      this._contextMenu = null;
    }
    if (this._contextMenuDismiss) {
      this._contextMenuDismiss();
      this._contextMenuDismiss = null;
    }
  }

  // === Keyboard ===

  _onKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'PageDown') {
      e.preventDefault();
      if (this._files.length > 1) {
        this._captureEditorContent();
        this._activeIndex = (this._activeIndex + 1) % this._files.length;
        this.updateComplete.then(() => this._injectSvgContent());
        this._dispatchActiveFileChanged(this._files[this._activeIndex].path);
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'PageUp') {
      e.preventDefault();
      if (this._files.length > 1) {
        this._captureEditorContent();
        this._activeIndex = (this._activeIndex - 1 + this._files.length) % this._files.length;
        this.updateComplete.then(() => this._injectSvgContent());
        this._dispatchActiveFileChanged(this._files[this._activeIndex].path);
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
      e.preventDefault();
      if (this._files.length > 0 && this._activeIndex >= 0) {
        this._captureEditorContent();
        this.closeFile(this._files[this._activeIndex].path);
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      this._save();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
      e.preventDefault();
      this._copyImage();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      if (this._mode === 'select') {
        e.preventDefault();
        this._undo();
      }
      return;
    }
  }

  _dispatchActiveFileChanged(path) {
    window.dispatchEvent(new CustomEvent('active-file-changed', {
      detail: { path },
    }));
  }

  // === Helpers ===

  _getActiveFile() {
    if (this._activeIndex >= 0 && this._activeIndex < this._files.length) {
      return this._files[this._activeIndex];
    }
    return null;
  }

  // === Rendering / Injection ===

  updated(changedProps) {
    if (changedProps.has('_activeIndex') || changedProps.has('_files')) {
      this._injectSvgContent();
    }
  }

  _prepareSvgElement(container) {
    const svg = container.querySelector('svg');
    if (svg) {
      svg.style.width = '100%';
      svg.style.height = '100%';
      if (!svg.getAttribute('viewBox')) {
        const w = svg.getAttribute('width') || '800';
        const h = svg.getAttribute('height') || '600';
        svg.setAttribute('viewBox', `0 0 ${parseFloat(w)} ${parseFloat(h)}`);
      }
      svg.removeAttribute('width');
      svg.removeAttribute('height');
    }
  }

  _injectSvgContent() {
    const file = this._getActiveFile();

    const leftContainer = this.shadowRoot.querySelector('.svg-left');
    const rightContainer = this.shadowRoot.querySelector('.svg-right');

    if (!file) return;
    if (!leftContainer || !rightContainer) {
      requestAnimationFrame(() => this._injectSvgContent());
      return;
    }

    // Guard against duplicate injection (updated() and openFile both call this)
    if (this._injectGeneration == null) this._injectGeneration = 0;
    const gen = ++this._injectGeneration;

    // Dispose everything before replacing content
    this._disposeAll();

    // Inject original SVG (left, always read-only)
    const originalSvg = file.original || file.modified || '';
    const modifiedSvg = file.modified || '';

    leftContainer.innerHTML = originalSvg.trim() || '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>';
    rightContainer.innerHTML = modifiedSvg.trim() || '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>';

    this._prepareSvgElement(leftContainer);
    this._prepareSvgElement(rightContainer);

    // Attach context menu to right panel
    rightContainer.removeEventListener('contextmenu', this._onContextMenu);
    rightContainer.addEventListener('contextmenu', this._onContextMenu);

    // Initialize based on mode
    requestAnimationFrame(() => {
      // Skip if a newer _injectSvgContent call has superseded this one
      if (gen !== this._injectGeneration) return;

      this._initLeftPanZoom();

      if (this._mode === 'select') {
        this._initEditor();
      } else {
        this._initRightPanZoom();
      }

      // Auto-fit both panels so they start with content fully visible.
      // Use a second rAF so the container has its final layout dimensions.
      requestAnimationFrame(() => {
        if (gen !== this._injectGeneration) return;
        this._fitAll();
      });
    });
  }

  render() {
    const hasFiles = this._files.length > 0;
    const file = hasFiles ? this._getActiveFile() : null;
    const isDirty = file && this._dirtySet.has(file.path);

    return html`
      <div class="diff-container">
        ${file ? html`
          <button
            class="status-led ${isDirty ? 'dirty' : file.is_new ? 'new-file' : 'clean'}"
            title="${file.path}${isDirty ? ' — unsaved (Ctrl+S to save)' : file.is_new ? ' — new file' : ''}"
            aria-label="${file.path}${isDirty ? ', unsaved changes, press to save' : file.is_new ? ', new file' : ', no changes'}"
            @click=${() => isDirty ? this._save() : null}
          ></button>
          <button class="fit-btn" @click=${this._fitAll} title="Fit to view">⊡</button>
          <div class="diff-panel">
            <div class="svg-container svg-left"></div>
          </div>
          <div class="splitter"></div>
          <div class="diff-panel">
            <div class="svg-container svg-right"></div>
          </div>
        ` : html`
          <div class="empty-state">
            <div class="watermark">AC⚡DC</div>
          </div>
        `}
      </div>

    `;
  }
}

customElements.define('ac-svg-viewer', AcSvgViewer);