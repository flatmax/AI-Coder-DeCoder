/**
 * SVG Viewer — side-by-side SVG diff viewer with synchronized pan/zoom.
 *
 * Left panel: original SVG (read-only).
 * Right panel: modified SVG (read-only).
 * Both panels are synchronized — pan/zoom one and the other follows.
 *
 * Uses svg-pan-zoom for native SVG viewBox manipulation (stays crisp at any zoom).
 */

import { LitElement, html, css, nothing } from 'lit';
import { theme, scrollbarStyles } from '../styles/theme.js';
import { RpcMixin } from '../rpc-mixin.js';
import svgPanZoom from 'svg-pan-zoom';

export class AcSvgViewer extends RpcMixin(LitElement) {
  static properties = {
    _files:       { type: Array, state: true },
    _activeIndex: { type: Number, state: true },
    _dirtySet:    { type: Object, state: true },
    _zoomLevel:   { type: Number, state: true },
  };

  static styles = [theme, scrollbarStyles, css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }

    /* Tab bar */
    .tab-bar {
      display: flex;
      flex-shrink: 0;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-primary);
      overflow-x: auto;
      min-height: 32px;
      align-items: stretch;
    }
    .tab-bar::-webkit-scrollbar { height: 3px; }

    .tab {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      font-size: 0.75rem;
      color: var(--text-muted);
      border-right: 1px solid var(--border-primary);
      cursor: pointer;
      white-space: nowrap;
      user-select: none;
      transition: background 0.15s, color 0.15s;
    }
    .tab:hover { background: var(--bg-tertiary); }
    .tab.active {
      color: var(--text-primary);
      background: var(--bg-primary);
      border-bottom: 2px solid var(--accent-primary);
    }

    .tab-close {
      font-size: 0.65rem;
      opacity: 0.5;
      cursor: pointer;
      padding: 2px;
      border-radius: 3px;
      border: none;
      background: none;
      color: inherit;
    }
    .tab-close:hover { opacity: 1; background: var(--bg-tertiary); }

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

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px 8px;
      font-size: 0.7rem;
      color: var(--text-muted);
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-primary);
      user-select: none;
      flex-shrink: 0;
    }
    .panel-header.modified { color: var(--accent-green); }
    .panel-header.original { color: var(--text-muted); }

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

    /* Toolbar */
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 4px 8px;
      background: var(--bg-secondary);
      border-top: 1px solid var(--border-primary);
      flex-shrink: 0;
    }

    .toolbar button {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      color: var(--text-secondary);
      padding: 3px 10px;
      border-radius: 4px;
      font-size: 0.7rem;
      cursor: pointer;
      transition: background 0.15s;
    }
    .toolbar button:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .toolbar .zoom-label {
      font-size: 0.7rem;
      color: var(--text-muted);
      min-width: 48px;
      text-align: center;
    }

    /* Splitter handle */
    .splitter {
      width: 4px;
      cursor: col-resize;
      background: transparent;
      flex-shrink: 0;
      z-index: 1;
    }
    .splitter:hover { background: var(--accent-primary); opacity: 0.3; }

    /* Status badge on tabs */
    .tab-badge {
      font-size: 0.6rem;
      padding: 1px 4px;
      border-radius: 3px;
      font-weight: 600;
    }
    .tab-badge.new { background: rgba(79, 195, 247, 0.2); color: var(--accent-primary); }
    .tab-badge.changed { background: rgba(240, 136, 62, 0.2); color: var(--accent-orange, #f0883e); }
    .tab-badge.same { background: rgba(126, 231, 135, 0.15); color: var(--accent-green); }

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

    this._panZoomLeft = null;
    this._panZoomRight = null;
    this._syncing = false;
    this._resizeObserver = null;

    this._onKeyDown = this._onKeyDown.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this._onKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._onKeyDown);
    this._disposePanZoom();
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
      this._initPanZoom();
    }
  }

  closeFile(path) {
    const idx = this._files.findIndex(f => f.path === path);
    if (idx === -1) return;

    this._dirtySet.delete(path);
    this._files = this._files.filter(f => f.path !== path);

    if (this._files.length === 0) {
      this._activeIndex = -1;
      this._disposePanZoom();
      this._dispatchActiveFileChanged(null);
    } else if (this._activeIndex >= this._files.length) {
      this._activeIndex = this._files.length - 1;
      this.updateComplete.then(() => this._initPanZoom());
      this._dispatchActiveFileChanged(this._files[this._activeIndex].path);
    } else if (idx <= this._activeIndex) {
      this._activeIndex = Math.max(0, this._activeIndex - 1);
      this.updateComplete.then(() => this._initPanZoom());
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

  // === Pan/Zoom Management ===

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

  _initPanZoom() {
    this._disposePanZoom();

    const leftSvg = this.shadowRoot.querySelector('.svg-left svg');
    const rightSvg = this.shadowRoot.querySelector('.svg-right svg');

    if (!leftSvg && !rightSvg) return;

    const commonOpts = {
      zoomEnabled: true,
      panEnabled: true,
      controlIconsEnabled: false,
      fit: true,
      center: true,
      minZoom: 0.1,
      maxZoom: 40,
      zoomScaleSensitivity: 0.3,
      dblClickZoomEnabled: true,
    };

    try {
      if (leftSvg) {
        this._panZoomLeft = svgPanZoom(leftSvg, {
          ...commonOpts,
          onZoom: (level) => this._syncFromLeft('zoom', level),
          onPan: (point) => this._syncFromLeft('pan', point),
          onUpdatedCTM: () => this._syncFromLeft('ctm'),
        });
      }

      if (rightSvg) {
        this._panZoomRight = svgPanZoom(rightSvg, {
          ...commonOpts,
          onZoom: (level) => this._syncFromRight('zoom', level),
          onPan: (point) => this._syncFromRight('pan', point),
          onUpdatedCTM: () => this._syncFromRight('ctm'),
        });
      }
    } catch (e) {
      console.warn('svg-pan-zoom initialization failed (Shadow DOM?):', e);
      // SVGs are still visible — just without pan/zoom
    }

    this._zoomLevel = 100;
  }

  _syncFromLeft(type, value) {
    if (this._syncing || !this._panZoomLeft || !this._panZoomRight) return;
    this._syncing = true;
    try {
      const zoom = this._panZoomLeft.getZoom();
      const pan = this._panZoomLeft.getPan();
      this._panZoomRight.zoom(zoom);
      this._panZoomRight.pan(pan);
      this._zoomLevel = Math.round(zoom * 100);
    } finally {
      this._syncing = false;
    }
  }

  _syncFromRight(type, value) {
    if (this._syncing || !this._panZoomLeft || !this._panZoomRight) return;
    this._syncing = true;
    try {
      const zoom = this._panZoomRight.getZoom();
      const pan = this._panZoomRight.getPan();
      this._panZoomLeft.zoom(zoom);
      this._panZoomLeft.pan(pan);
      this._zoomLevel = Math.round(zoom * 100);
    } finally {
      this._syncing = false;
    }
  }

  _handleResize() {
    if (this._panZoomLeft) this._panZoomLeft.resize();
    if (this._panZoomRight) this._panZoomRight.resize();
  }

  // === Toolbar Actions ===

  _zoomIn() {
    if (this._panZoomLeft) this._panZoomLeft.zoomIn();
    // Sync will propagate to right via callback
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
    if (this._panZoomLeft) this._panZoomLeft.fit();
    if (this._panZoomRight) this._panZoomRight.fit();
    if (this._panZoomLeft) {
      this._zoomLevel = Math.round(this._panZoomLeft.getZoom() * 100);
    }
    // After fit, sync positions
    this._syncFromLeft('fit');
  }

  // === Keyboard ===

  _onKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'PageDown') {
      e.preventDefault();
      if (this._files.length > 1) {
        this._activeIndex = (this._activeIndex + 1) % this._files.length;
        this.updateComplete.then(() => this._initPanZoom());
        this._dispatchActiveFileChanged(this._files[this._activeIndex].path);
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'PageUp') {
      e.preventDefault();
      if (this._files.length > 1) {
        this._activeIndex = (this._activeIndex - 1 + this._files.length) % this._files.length;
        this.updateComplete.then(() => this._initPanZoom());
        this._dispatchActiveFileChanged(this._files[this._activeIndex].path);
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
      e.preventDefault();
      if (this._files.length > 0 && this._activeIndex >= 0) {
        this.closeFile(this._files[this._activeIndex].path);
      }
    }
  }

  _dispatchActiveFileChanged(path) {
    window.dispatchEvent(new CustomEvent('active-file-changed', {
      detail: { path },
    }));
  }

  // === Rendering ===

  _renderSvgContent(svgString) {
    if (!svgString || !svgString.trim()) {
      return html`<div class="empty-state" style="font-size:1rem;">No content</div>`;
    }

    // Parse SVG string into DOM — we inject it via innerHTML in updated()
    // because Lit doesn't natively handle raw SVG injection.
    // Return a placeholder container; actual SVG is injected in _initPanZoom flow.
    const template = document.createElement('template');
    template.innerHTML = svgString.trim();
    const svgEl = template.content.firstElementChild;

    if (!svgEl || svgEl.tagName.toLowerCase() !== 'svg') {
      // Content is not SVG — wrap in an SVG foreignObject or show as text
      return html`<div class="empty-state" style="font-size:0.8rem; padding:1rem; overflow:auto; white-space:pre-wrap;">${svgString.slice(0, 500)}</div>`;
    }

    return nothing;
  }

  _getTabBadge(file) {
    if (file.is_new) return 'new';
    if (file.original !== file.modified) return 'changed';
    return 'same';
  }

  updated(changedProps) {
    if (changedProps.has('_activeIndex') || changedProps.has('_files')) {
      this._injectSvgContent();
    }
  }

  _injectSvgContent() {
    const file = this._activeIndex >= 0 && this._activeIndex < this._files.length
      ? this._files[this._activeIndex]
      : null;

    const leftContainer = this.shadowRoot.querySelector('.svg-left');
    const rightContainer = this.shadowRoot.querySelector('.svg-right');

    if (!file) return;
    if (!leftContainer || !rightContainer) {
      // Containers not yet in DOM — retry after next frame
      requestAnimationFrame(() => this._injectSvgContent());
      return;
    }

    // Dispose existing pan-zoom before replacing content
    this._disposePanZoom();

    // Inject original SVG
    const originalSvg = file.original || file.modified || '';
    const modifiedSvg = file.modified || '';

    leftContainer.innerHTML = originalSvg.trim() || '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>';
    rightContainer.innerHTML = modifiedSvg.trim() || '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>';

    // Ensure injected SVGs have 100% dimensions for pan-zoom
    for (const container of [leftContainer, rightContainer]) {
      const svg = container.querySelector('svg');
      if (svg) {
        svg.style.width = '100%';
        svg.style.height = '100%';
        // Ensure viewBox exists for pan-zoom to work
        if (!svg.getAttribute('viewBox')) {
          const w = svg.getAttribute('width') || '800';
          const h = svg.getAttribute('height') || '600';
          svg.setAttribute('viewBox', `0 0 ${parseFloat(w)} ${parseFloat(h)}`);
        }
        // Remove fixed width/height so SVG fills container
        svg.removeAttribute('width');
        svg.removeAttribute('height');
      }
    }

    // Initialize pan-zoom on the injected SVGs
    requestAnimationFrame(() => this._initPanZoom());
  }

  render() {
    const hasFiles = this._files.length > 0;
    const file = hasFiles && this._activeIndex >= 0 ? this._files[this._activeIndex] : null;

    return html`
      ${hasFiles ? html`
        <div class="tab-bar">
          ${this._files.map((f, i) => {
            const badge = this._getTabBadge(f);
            return html`
              <div
                class="tab ${i === this._activeIndex ? 'active' : ''}"
                @click=${() => { this._activeIndex = i; this.updateComplete.then(() => this._initPanZoom()); this._dispatchActiveFileChanged(f.path); }}
              >
                <span>${f.path.split('/').pop()}</span>
                <span class="tab-badge ${badge}">${badge === 'same' ? '=' : badge === 'new' ? 'N' : 'Δ'}</span>
                <button class="tab-close" @click=${(e) => { e.stopPropagation(); this.closeFile(f.path); }}
                  title="Close" aria-label="Close ${f.path}">✕</button>
              </div>
            `;
          })}
        </div>
      ` : nothing}

      <div class="diff-container">
        ${file ? html`
          <div class="diff-panel">
            <div class="panel-header original">Original${file.is_new ? ' (empty)' : ''}</div>
            <div class="svg-container svg-left"></div>
          </div>
          <div class="splitter"></div>
          <div class="diff-panel">
            <div class="panel-header modified">Modified</div>
            <div class="svg-container svg-right"></div>
          </div>
        ` : html`
          <div class="empty-state">
            <div class="watermark">AC⚡DC</div>
          </div>
        `}
      </div>

      ${file ? html`
        <div class="toolbar">
          <button @click=${this._zoomOut} title="Zoom out (−)">−</button>
          <span class="zoom-label">${this._zoomLevel}%</span>
          <button @click=${this._zoomIn} title="Zoom in (+)">+</button>
          <button @click=${this._zoomReset} title="Reset zoom">1:1</button>
          <button @click=${this._fitAll} title="Fit to view">Fit</button>
        </div>
      ` : nothing}
    `;
  }
}

customElements.define('ac-svg-viewer', AcSvgViewer);