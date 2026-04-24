// SvgViewer — side-by-side SVG diff viewer.
//
// Phase 3.2a delivers the lifecycle layer: multi-file
// tracking, content fetching via Repo RPCs, dirty
// tracking, save pipeline, status LED, keyboard shortcuts.
// No pan/zoom yet, no visual editing — just the structural
// viewer that matches the diff viewer's surface.
//
// Scope of this commit (3.2a):
//   - Open/close/switch multiple SVG files
//   - Concurrent-openFile guard
//   - HEAD + working-copy content fetching via RPC
//   - Dirty tracking (content-change-triggered via a
//     MutationObserver on the rendered SVG — no editor yet,
//     so we watch for externally-driven content updates)
//   - Status LED (clean / dirty / new-file)
//   - Save pipeline dispatching `file-saved` events
//   - Keyboard shortcuts (Ctrl+S, Ctrl+W, Ctrl+PageUp/Down)
//   - Side-by-side rendering — raw SVG injected via innerHTML
//     into left and right containers. Left is always HEAD
//     (read-only reference); right is working copy.
//
// Deferred to follow-up sub-phases:
//   - 3.2b: Synchronized pan/zoom via svg-pan-zoom.
//     Fit button. Mouse wheel zoom.
//   - 3.2c: SvgEditor visual editing (select, drag, resize,
//     vertex edit, inline text edit, multi-selection
//     marquee, handle rendering, path command parsing).
//   - 3.2d: Copy-as-PNG, context menu, presentation mode,
//     SVG ↔ text diff mode toggle via toggle-svg-mode event.
//   - 3.2e: Relative image resolution for PDF/PPTX-generated
//     SVGs that reference sibling raster images.
//
// Governing spec: specs4/5-webapp/svg-viewer.md
//
// Architectural contracts pinned by this commit:
//
//   - **Content is text, not base64.** SVG is XML. Fetch via
//     `Repo.get_file_content` (same as the diff viewer does
//     for text files). This matters — `Repo.get_file_base64`
//     is for rendering images, not for editing their source.
//
//   - **`innerHTML` injection, not Lit template interpolation.**
//     Lit doesn't natively handle raw SVG string injection
//     (it would HTML-escape the content). The component
//     renders empty container divs and sets `innerHTML`
//     manually in `updated()`. Same pattern the specs4
//     document describes for the production viewer.
//
//   - **No lazy dirty tracking — save button always enabled
//     for new files.** 3.2a has no editor, so the working-
//     copy content can only change when an external caller
//     mutates `this._files[i].modified` (e.g., a future
//     SvgEditor commit). Until 3.2c lands, the viewer is
//     effectively read-only — the save LED shows dirty only
//     when the working-copy content differs from HEAD (as
//     provided by the fetcher).
//
//   - **Status LED shape matches the diff viewer.** Same
//     classes, same click-to-save affordance, same tooltip
//     shape. Keeps the two viewers visually consistent so
//     toggling between them doesn't surprise the user.

import { LitElement, css, html } from 'lit';

import svgPanZoom from 'svg-pan-zoom';

import { SharedRpc } from './rpc.js';

/**
 * Default empty SVG shown when a panel has no content
 * (e.g., new files where HEAD is absent). Keeps the panel
 * from collapsing visually.
 */
const _EMPTY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>';

/**
 * Pan/zoom configuration shared by both panels. Matches
 * specs4/5-webapp/svg-viewer.md#synchronized-panzoom —
 * mouse wheel zoom, click-drag pan, zoom bounds.
 *
 * `controlIconsEnabled: false` — we render our own fit
 * button as a floating overlay rather than the library's
 * built-in control buttons (which would conflict with
 * the status LED visually and don't match the app's
 * design language).
 *
 * `dblClickZoomEnabled: true` — touchpads use two-finger
 * tap as a double-click equivalent; letting that zoom
 * feels natural.
 *
 * `fit: true, center: true` — on init, fit the SVG to
 * the panel and center it. Subsequent user interaction
 * takes over.
 */
const _PAN_ZOOM_OPTIONS = Object.freeze({
  panEnabled: true,
  controlIconsEnabled: false,
  zoomEnabled: true,
  dblClickZoomEnabled: true,
  mouseWheelZoomEnabled: true,
  preventMouseEventsDefault: true,
  zoomScaleSensitivity: 0.2,
  minZoom: 0.1,
  maxZoom: 10,
  fit: true,
  center: true,
});

export class SvgViewer extends LitElement {
  static properties = {
    _files: { type: Array, state: true },
    _activeIndex: { type: Number, state: true },
    _dirtyCount: { type: Number, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--bg-primary, #0d1117);
      position: relative;
    }

    .empty-state {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      user-select: none;
    }
    .watermark {
      font-size: 8rem;
      opacity: 0.18;
      letter-spacing: -0.05em;
    }
    .watermark .bolt {
      color: var(--accent-primary, #58a6ff);
    }

    /* Split container — two panels side by side with a
     * thin divider. No draggable splitter in 3.2a; fixed
     * 50/50 split. */
    .split {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: row;
      position: relative;
    }
    .pane {
      flex: 1 1 50%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      position: relative;
      background: rgba(13, 17, 23, 0.6);
    }
    .pane + .pane {
      border-left: 1px solid rgba(240, 246, 252, 0.1);
    }
    .svg-container {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .svg-container svg {
      max-width: 100%;
      max-height: 100%;
      width: 100%;
      height: 100%;
    }

    /* Pane labels — shown at the top-left of each panel
     * so users can tell which side is HEAD vs working. */
    .pane-label {
      position: absolute;
      top: 8px;
      left: 12px;
      padding: 0.15rem 0.5rem;
      font-size: 0.7rem;
      font-family: 'SFMono-Regular', Consolas, monospace;
      letter-spacing: 0.05em;
      background: rgba(22, 27, 34, 0.78);
      color: var(--text-secondary, #8b949e);
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 3px;
      backdrop-filter: blur(4px);
      z-index: 5;
      pointer-events: none;
      text-transform: uppercase;
    }

    /* Status LED — same visual language as the diff viewer
     * so toggling between viewers doesn't change the
     * feedback model. */
    .status-led {
      position: absolute;
      top: 12px;
      right: 16px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      cursor: pointer;
      z-index: 10;
      transition: transform 120ms ease;
    }
    .status-led:hover {
      transform: scale(1.4);
    }
    .status-led.clean {
      background: #7ee787;
      box-shadow: 0 0 6px rgba(126, 231, 135, 0.6);
      cursor: default;
    }
    .status-led.new-file {
      background: var(--accent-primary, #58a6ff);
      box-shadow: 0 0 6px rgba(88, 166, 255, 0.6);
      cursor: default;
    }
    .status-led.dirty {
      background: #d29922;
      box-shadow: 0 0 8px rgba(210, 153, 34, 0.7);
      animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.55; }
    }

    /* Fit button — floating overlay in the bottom-right
     * corner. Sized similarly to the status LED so the
     * two controls feel like siblings visually. Clicking
     * resets both panels to their fit+center state. */
    .fit-button {
      position: absolute;
      bottom: 12px;
      right: 16px;
      width: 28px;
      height: 28px;
      padding: 0;
      background: rgba(22, 27, 34, 0.85);
      color: var(--text-secondary, #8b949e);
      border: 1px solid rgba(240, 246, 252, 0.2);
      border-radius: 4px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 0.875rem;
      line-height: 1;
      z-index: 10;
      backdrop-filter: blur(4px);
      transition: background 120ms ease, border-color 120ms ease;
    }
    .fit-button:hover {
      background: rgba(240, 246, 252, 0.1);
      border-color: rgba(240, 246, 252, 0.4);
      color: var(--text-primary, #c9d1d9);
    }
  `;

  constructor() {
    super();
    this._files = [];
    this._activeIndex = -1;
    this._dirtyCount = 0;
    // Concurrent-openFile guard. Same pattern as diff viewer.
    this._openingPath = null;
    // Last-rendered content per side. Lets `updated()`
    // skip innerHTML updates when nothing changed —
    // important because reassigning innerHTML triggers
    // a full SVG re-parse and visual flash.
    this._lastLeftContent = null;
    this._lastRightContent = null;
    // svg-pan-zoom instances, one per panel. Initialised
    // after SVG injection; disposed before every re-
    // injection so Monaco doesn't retain references to
    // detached DOM. Null when no file is open.
    this._panZoomLeft = null;
    this._panZoomRight = null;
    // Guard against feedback loops when syncing pan/zoom
    // between panels. Set before programmatically moving
    // one panel to match the other; cleared after. Pure
    // mutex pattern — same as markdown preview's scroll
    // sync in 3.1b.
    this._syncingPanZoom = false;
    // Bound handlers for add/remove symmetry.
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onLeftPan = this._onLeftPan.bind(this);
    this._onLeftZoom = this._onLeftZoom.bind(this);
    this._onRightPan = this._onRightPan.bind(this);
    this._onRightZoom = this._onRightZoom.bind(this);
    this._onFitClick = this._onFitClick.bind(this);
  }

  // ---------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('keydown', this._onKeyDown);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKeyDown);
    this._disposePanZoom();
    super.disconnectedCallback();
  }

  updated(changedProps) {
    super.updated?.(changedProps);
    // After Lit commits the template, inject SVG content
    // into the pane containers. innerHTML assignment is
    // necessary because Lit would escape the SVG text.
    this._injectSvgContent();
  }

  // ---------------------------------------------------------------
  // Public API — matches DiffViewer's contract
  // ---------------------------------------------------------------

  async openFile(opts) {
    if (!opts || typeof opts.path !== 'string' || !opts.path) {
      return;
    }
    const { path } = opts;
    const existing = this._files.findIndex((f) => f.path === path);
    if (existing !== -1 && existing === this._activeIndex) {
      // Same-file open — no-op.
      return;
    }
    if (this._openingPath === path) return;
    this._openingPath = path;
    try {
      await this._openFileInner(opts);
    } finally {
      this._openingPath = null;
    }
  }

  closeFile(path) {
    const idx = this._files.findIndex((f) => f.path === path);
    if (idx === -1) return;
    const wasActive = idx === this._activeIndex;
    // Capture the active path BEFORE mutating _files so
    // we can decide whether the close actually changed
    // which file is active. Closing an inactive sibling
    // shifts the active index but doesn't change the
    // active path, so the event shouldn't fire.
    const priorActivePath =
      this._activeIndex >= 0
        ? this._files[this._activeIndex].path
        : null;
    const newFiles = [
      ...this._files.slice(0, idx),
      ...this._files.slice(idx + 1),
    ];
    this._files = newFiles;
    if (newFiles.length === 0) {
      this._activeIndex = -1;
      this._lastLeftContent = null;
      this._lastRightContent = null;
    } else if (wasActive) {
      this._activeIndex = Math.min(idx, newFiles.length - 1);
    } else if (idx < this._activeIndex) {
      this._activeIndex -= 1;
    }
    this._recomputeDirtyCount();
    const nextActivePath =
      this._activeIndex >= 0
        ? this._files[this._activeIndex].path
        : null;
    if (nextActivePath !== priorActivePath) {
      this._dispatchActiveFileChanged();
    }
  }

  async refreshOpenFiles() {
    const paths = this._files.map((f) => f.path);
    for (const path of paths) {
      const fetched = await this._fetchFileContent(path);
      if (!fetched) continue;
      const file = this._files.find((f) => f.path === path);
      if (!file) continue;
      file.original = fetched.original;
      file.modified = fetched.modified;
      file.savedContent = fetched.modified;
      file.isNew = fetched.isNew;
    }
    // Force re-injection by clearing last-content cache.
    this._lastLeftContent = null;
    this._lastRightContent = null;
    this._recomputeDirtyCount();
    this.requestUpdate();
  }

  getDirtyFiles() {
    return this._files.filter((f) => this._isDirty(f)).map((f) => f.path);
  }

  async saveAll() {
    for (const file of [...this._files]) {
      if (this._isDirty(file)) {
        await this._saveFile(file.path);
      }
    }
  }

  get hasOpenFiles() {
    return this._files.length > 0;
  }

  // ---------------------------------------------------------------
  // Internals — file loading
  // ---------------------------------------------------------------

  async _openFileInner(opts) {
    const { path } = opts;
    const existing = this._files.findIndex((f) => f.path === path);
    if (existing !== -1) {
      this._activeIndex = existing;
      this._lastLeftContent = null;
      this._lastRightContent = null;
      this._dispatchActiveFileChanged();
      return;
    }
    const fetched = await this._fetchFileContent(path);
    if (!fetched) return;
    const file = {
      path,
      original: fetched.original,
      modified: fetched.modified,
      savedContent: fetched.modified,
      isNew: fetched.isNew,
    };
    this._files = [...this._files, file];
    this._activeIndex = this._files.length - 1;
    this._lastLeftContent = null;
    this._lastRightContent = null;
    this._dispatchActiveFileChanged();
    this._recomputeDirtyCount();
  }

  async _fetchFileContent(path) {
    const call = this._getRpcCall();
    if (!call) {
      return { original: '', modified: '', isNew: false };
    }
    let original = '';
    let modified = '';
    let isNew = false;
    try {
      const headResult = await call['Repo.get_file_content'](
        path,
        'HEAD',
      );
      original = this._extractRpcContent(headResult);
    } catch (_) {
      isNew = true;
    }
    try {
      const workingResult = await call['Repo.get_file_content'](path);
      modified = this._extractRpcContent(workingResult);
    } catch (_) {
      // File missing from working copy (deleted); leave modified empty.
    }
    return { original, modified, isNew };
  }

  _extractRpcContent(result) {
    if (typeof result === 'string') return result;
    if (
      result &&
      typeof result === 'object' &&
      typeof result.content === 'string'
    ) {
      return result.content;
    }
    if (result && typeof result === 'object') {
      const keys = Object.keys(result);
      if (keys.length === 1) {
        return this._extractRpcContent(result[keys[0]]);
      }
    }
    return '';
  }

  _getRpcCall() {
    try {
      const shared = globalThis.__sharedRpcOverride;
      if (shared) return shared;
    } catch (_) {}
    try {
      return SharedRpc.call || null;
    } catch (_) {
      return null;
    }
  }

  // ---------------------------------------------------------------
  // SVG injection
  // ---------------------------------------------------------------

  _injectSvgContent() {
    if (this._activeIndex < 0) {
      this._lastLeftContent = null;
      this._lastRightContent = null;
      this._disposePanZoom();
      return;
    }
    const file = this._files[this._activeIndex];
    if (!file) return;
    const leftContainer =
      this.shadowRoot?.querySelector('.pane-left .svg-container');
    const rightContainer =
      this.shadowRoot?.querySelector('.pane-right .svg-container');
    if (!leftContainer || !rightContainer) return;
    const leftContent = file.original || _EMPTY_SVG;
    const rightContent = file.modified || _EMPTY_SVG;
    // Track whether either side actually changed. If yes,
    // we tear down and re-init pan/zoom; if no, we leave
    // existing instances alone (avoids resetting the
    // user's pan/zoom state on no-op updates).
    let changed = false;
    // Skip reassignment when content hasn't changed —
    // innerHTML assignment forces a full SVG re-parse
    // which flashes the visual.
    if (leftContent !== this._lastLeftContent) {
      leftContainer.innerHTML = leftContent;
      this._lastLeftContent = leftContent;
      changed = true;
    }
    if (rightContent !== this._lastRightContent) {
      rightContainer.innerHTML = rightContent;
      this._lastRightContent = rightContent;
      changed = true;
    }
    if (changed) {
      // Right panel gets preserveAspectRatio="none" so a
      // future SvgEditor (3.2c) has sole viewBox authority
      // — otherwise the browser's aspect-ratio fitting
      // fights with editor coordinate math. Applied via
      // attribute on the root <svg> element. Left panel
      // keeps the default (preserveAspectRatio="xMidYMid
      // meet") since it's a read-only reference.
      const rightSvg = rightContainer.querySelector('svg');
      if (rightSvg) {
        rightSvg.setAttribute('preserveAspectRatio', 'none');
      }
      this._initPanZoom(leftContainer, rightContainer);
    }
  }

  /**
   * Initialise pan/zoom on both panels. Tears down any
   * existing instances first so DOM references aren't
   * retained across file switches.
   *
   * Both panels' pan/zoom instances are wired to mirror
   * each other via `onPan`/`onZoom` callbacks. A
   * `_syncingPanZoom` guard flag prevents ping-pong
   * loops — when we programmatically move one panel to
   * match the other, the callback on the moved panel
   * fires but bails out because the flag is set.
   *
   * Initialisation is wrapped in try/catch — jsdom's
   * SVG implementation doesn't support enough of the
   * real library's feature set, so tests that mount
   * real `svg-pan-zoom` against injected SVG would
   * throw. Tests should mock the library at the module
   * level; production runs fine.
   */
  _initPanZoom(leftContainer, rightContainer) {
    this._disposePanZoom();
    const leftSvg = leftContainer.querySelector('svg');
    const rightSvg = rightContainer.querySelector('svg');
    if (!leftSvg || !rightSvg) return;
    try {
      this._panZoomLeft = svgPanZoom(leftSvg, {
        ..._PAN_ZOOM_OPTIONS,
        onPan: this._onLeftPan,
        onZoom: this._onLeftZoom,
      });
    } catch (err) {
      console.warn('[svg-viewer] left pan/zoom init failed', err);
      this._panZoomLeft = null;
    }
    try {
      this._panZoomRight = svgPanZoom(rightSvg, {
        ..._PAN_ZOOM_OPTIONS,
        onPan: this._onRightPan,
        onZoom: this._onRightZoom,
      });
    } catch (err) {
      console.warn('[svg-viewer] right pan/zoom init failed', err);
      this._panZoomRight = null;
    }
  }

  /**
   * Destroy pan/zoom instances and null the refs. Safe
   * to call when instances don't exist — no-op.
   */
  _disposePanZoom() {
    if (this._panZoomLeft) {
      try {
        this._panZoomLeft.destroy();
      } catch (_) {
        // Already destroyed or underlying SVG detached —
        // harmless.
      }
      this._panZoomLeft = null;
    }
    if (this._panZoomRight) {
      try {
        this._panZoomRight.destroy();
      } catch (_) {}
      this._panZoomRight = null;
    }
  }

  // ---------------------------------------------------------------
  // Pan/zoom sync callbacks
  // ---------------------------------------------------------------

  _onLeftPan(newPan) {
    if (this._syncingPanZoom) return;
    if (!this._panZoomRight) return;
    this._syncingPanZoom = true;
    try {
      this._panZoomRight.pan(newPan);
    } catch (_) {
    } finally {
      this._syncingPanZoom = false;
    }
  }

  _onLeftZoom(newZoom) {
    if (this._syncingPanZoom) return;
    if (!this._panZoomRight) return;
    this._syncingPanZoom = true;
    try {
      this._panZoomRight.zoom(newZoom);
    } catch (_) {
    } finally {
      this._syncingPanZoom = false;
    }
  }

  _onRightPan(newPan) {
    if (this._syncingPanZoom) return;
    if (!this._panZoomLeft) return;
    this._syncingPanZoom = true;
    try {
      this._panZoomLeft.pan(newPan);
    } catch (_) {
    } finally {
      this._syncingPanZoom = false;
    }
  }

  _onRightZoom(newZoom) {
    if (this._syncingPanZoom) return;
    if (!this._panZoomLeft) return;
    this._syncingPanZoom = true;
    try {
      this._panZoomLeft.zoom(newZoom);
    } catch (_) {
    } finally {
      this._syncingPanZoom = false;
    }
  }

  /**
   * Fit button click handler. Resets both panels to
   * fit+center. The sync guard is held across both
   * operations so the fit call on one panel doesn't
   * trigger mirror calls into the other — both are
   * being explicitly reset.
   */
  _onFitClick() {
    if (!this._panZoomLeft && !this._panZoomRight) return;
    this._syncingPanZoom = true;
    try {
      if (this._panZoomLeft) {
        try {
          this._panZoomLeft.resize();
          this._panZoomLeft.fit();
          this._panZoomLeft.center();
        } catch (_) {}
      }
      if (this._panZoomRight) {
        try {
          this._panZoomRight.resize();
          this._panZoomRight.fit();
          this._panZoomRight.center();
        } catch (_) {}
      }
    } finally {
      this._syncingPanZoom = false;
    }
  }

  // ---------------------------------------------------------------
  // Dirty tracking & saving
  // ---------------------------------------------------------------

  _isDirty(file) {
    if (!file) return false;
    return file.modified !== file.savedContent;
  }

  _recomputeDirtyCount() {
    this._dirtyCount = this._files.filter((f) => this._isDirty(f)).length;
  }

  async _saveFile(path) {
    const file = this._files.find((f) => f.path === path);
    if (!file) return;
    file.savedContent = file.modified;
    this._recomputeDirtyCount();
    this.dispatchEvent(
      new CustomEvent('file-saved', {
        detail: { path, content: file.modified },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ---------------------------------------------------------------
  // Status LED
  // ---------------------------------------------------------------

  _statusLedClass() {
    if (this._activeIndex < 0) return '';
    const file = this._files[this._activeIndex];
    if (!file) return '';
    if (this._isDirty(file)) return 'dirty';
    if (file.isNew) return 'new-file';
    return 'clean';
  }

  _statusLedTitle() {
    if (this._activeIndex < 0) return '';
    const file = this._files[this._activeIndex];
    if (!file) return '';
    const klass = this._statusLedClass();
    if (klass === 'dirty') return `${file.path} — unsaved (click to save)`;
    if (klass === 'new-file') return `${file.path} — new file`;
    return file.path;
  }

  _onStatusLedClick() {
    if (this._activeIndex < 0) return;
    const file = this._files[this._activeIndex];
    if (!file) return;
    if (this._isDirty(file)) {
      this._saveFile(file.path);
    }
  }

  // ---------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------

  _onKeyDown(event) {
    if (!this.isConnected) return;
    if (this._activeIndex < 0) return;
    const ctrl = event.ctrlKey || event.metaKey;
    if (!ctrl) return;
    if (!this._eventTargetInsideUs(event)) return;
    if (event.key === 's' || event.key === 'S') {
      event.preventDefault();
      const file = this._files[this._activeIndex];
      if (file) this._saveFile(file.path);
      return;
    }
    if (event.key === 'w' || event.key === 'W') {
      event.preventDefault();
      const file = this._files[this._activeIndex];
      if (file) this.closeFile(file.path);
      return;
    }
    if (event.key === 'PageDown') {
      event.preventDefault();
      this._cycleFile(1);
      return;
    }
    if (event.key === 'PageUp') {
      event.preventDefault();
      this._cycleFile(-1);
      return;
    }
  }

  _eventTargetInsideUs(event) {
    const path = event.composedPath ? event.composedPath() : [];
    return path.includes(this);
  }

  _cycleFile(delta) {
    if (this._files.length < 2) return;
    const next =
      (this._activeIndex + delta + this._files.length) %
      this._files.length;
    if (next === this._activeIndex) return;
    this._activeIndex = next;
    this._lastLeftContent = null;
    this._lastRightContent = null;
    this._dispatchActiveFileChanged();
  }

  _dispatchActiveFileChanged() {
    const activeFile =
      this._activeIndex >= 0 ? this._files[this._activeIndex] : null;
    this.dispatchEvent(
      new CustomEvent('active-file-changed', {
        detail: { path: activeFile ? activeFile.path : null },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  render() {
    if (this._files.length === 0 || this._activeIndex < 0) {
      return html`
        <div class="empty-state">
          <div class="watermark">
            <span>AC</span><span class="bolt">⚡</span><span>DC</span>
          </div>
        </div>
      `;
    }
    const ledClass = this._statusLedClass();
    return html`
      <div class="split">
        <div class="pane pane-left">
          <div class="pane-label">Original</div>
          <div class="svg-container"></div>
        </div>
        <div class="pane pane-right">
          <div class="pane-label">Modified</div>
          <div class="svg-container"></div>
        </div>
        <div
          class="status-led ${ledClass}"
          title=${this._statusLedTitle()}
          aria-label=${this._statusLedTitle()}
          @click=${this._onStatusLedClick}
        ></div>
        <button
          class="fit-button"
          title="Fit to view"
          aria-label="Fit SVG to view"
          @click=${this._onFitClick}
        >
          ⊡
        </button>
      </div>
    `;
  }
}

customElements.define('ac-svg-viewer', SvgViewer);