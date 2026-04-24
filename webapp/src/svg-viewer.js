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
import { SvgEditor } from './svg-editor.js';

/**
 * Default empty SVG shown when a panel has no content
 * (e.g., new files where HEAD is absent). Keeps the panel
 * from collapsing visually.
 */
const _EMPTY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>';

/**
 * Interaction mode for the viewer. Controls which panel
 * layout is rendered and how the right panel behaves.
 *
 *   - 'select' — default. Side-by-side panels, right
 *     panel has SvgEditor for visual editing, left panel
 *     has pan/zoom for reference.
 *   - 'present' — full-width right panel only, left panel
 *     hidden. Editor stays active so all editing operations
 *     work. Used for focused editing or presenting.
 */
const _MODE_SELECT = 'select';
const _MODE_PRESENT = 'present';

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
    /** Interaction mode — 'select' (default) or 'present'. */
    _mode: { type: String, state: true },
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

    /* Presentation mode — left pane hidden, right pane
     * fills the full width. The split container stays in
     * the DOM; CSS hides the left pane so the editor's
     * SVG element isn't detached (which would destroy
     * the SvgEditor's event listeners and selection
     * state). */
    .split.present .pane-left {
      display: none;
    }
    .split.present .pane-right {
      flex: 1 1 100%;
    }
    .split.present .pane-right + .pane-right {
      border-left: none;
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


    /* Floating action buttons stack — presentation toggle
     * and text-diff toggle sit above the fit button in
     * the bottom-right corner. */
    .floating-actions {
      position: absolute;
      bottom: 12px;
      right: 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      z-index: 10;
    }
    .float-btn {
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
      backdrop-filter: blur(4px);
      transition: background 120ms ease, border-color 120ms ease;
    }
    .float-btn:hover {
      background: rgba(240, 246, 252, 0.1);
      border-color: rgba(240, 246, 252, 0.4);
      color: var(--text-primary, #c9d1d9);
    }
    .float-btn.active {
      background: rgba(88, 166, 255, 0.15);
      border-color: rgba(88, 166, 255, 0.4);
      color: var(--accent-primary, #58a6ff);
    }

    /* Context menu — positioned fixed at click point. */
    .context-menu {
      position: fixed;
      z-index: 200;
      background: rgba(22, 27, 34, 0.98);
      border: 1px solid rgba(240, 246, 252, 0.2);
      border-radius: 4px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
      padding: 0.25rem 0;
      min-width: 180px;
      display: flex;
      flex-direction: column;
    }
    .context-menu-item {
      background: transparent;
      border: none;
      color: var(--text-primary, #c9d1d9);
      text-align: left;
      padding: 0.4rem 0.75rem;
      font-size: 0.8125rem;
      font-family: inherit;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .context-menu-item:hover {
      background: rgba(88, 166, 255, 0.12);
    }
  `;

  constructor() {
    super();
    this._files = [];
    this._activeIndex = -1;
    this._dirtyCount = 0;
    this._mode = _MODE_SELECT;
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
    // SvgEditor instance attached to the right panel's SVG.
    // Handles element selection, drag, resize, etc. Null
    // when no file is open or when the SVG hasn't been
    // injected yet. Disposed before re-injection so DOM
    // references don't leak across file switches.
    this._editor = null;
    // Bound editor change handler — syncs edited SVG back
    // to the file's modified content and recomputes dirty.
    this._onEditorChange = this._onEditorChange.bind(this);
    /**
     * Context menu state. Null when closed; `{x, y}` in
     * viewport coordinates when open. Only rendered when
     * the right panel is visible and has content.
     */
    this._contextMenu = null;
    // Bound handlers for add/remove symmetry.
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onContextMenu = this._onContextMenu.bind(this);
    this._onContextDismiss = this._onContextDismiss.bind(this);
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
    document.addEventListener('click', this._onContextDismiss);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('click', this._onContextDismiss);
    this._disposeEditor();
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
      this._mode = _MODE_SELECT;
      this._contextMenu = null;
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
      this._disposeEditor();
      this._disposePanZoom();
      return;
    }
    const file = this._files[this._activeIndex];
    if (!file) return;
    const rightContainer =
      this.shadowRoot?.querySelector('.pane-right .svg-container');
    if (!rightContainer) return;
    // In presentation mode the left pane is display:none.
    // Skip its injection and pan-zoom init to avoid wasted
    // work on a hidden element.
    const isPresent = this._mode === _MODE_PRESENT;
    const leftContainer = isPresent
      ? null
      : this.shadowRoot?.querySelector('.pane-left .svg-container');
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
    if (!isPresent && leftContent !== this._lastLeftContent) {
      if (leftContainer) leftContainer.innerHTML = leftContent;
      this._lastLeftContent = leftContent;
      changed = true;
    }
    if (rightContent !== this._lastRightContent) {
      rightContainer.innerHTML = rightContent;
      this._lastRightContent = rightContent;
      changed = true;
    }
    if (changed) {
      // Right panel gets preserveAspectRatio="none" so the
      // SvgEditor has sole viewBox authority — otherwise
      // the browser's aspect-ratio fitting fights with
      // editor coordinate math. Applied via attribute on
      // the root <svg> element. Left panel keeps the
      // default (preserveAspectRatio="xMidYMid meet") since
      // it's a read-only reference.
      const rightSvg = rightContainer.querySelector('svg');
      if (rightSvg) {
        rightSvg.setAttribute('preserveAspectRatio', 'none');
      }
      // Dispose any prior editor before re-init — the old
      // editor's SVG reference is about to become stale.
      this._disposeEditor();
      if (!isPresent && leftContainer) {
        this._initPanZoom(leftContainer, rightContainer);
      } else {
        // Presentation mode — no left panel to sync. Dispose
        // any existing pan-zoom so stale refs don't linger.
        this._disposePanZoom();
      }
      this._initEditor(rightSvg);
    }
  }

  /**
   * Attach an SvgEditor to the right panel's SVG. The
   * editor shares the panel with the pan-zoom instance —
   * pan-zoom handles viewport navigation (wheel zoom,
   * drag-pan on empty space); the editor handles element
   * selection. When the editor's hit-test returns a real
   * element, its pointerdown handler stops propagation so
   * pan-zoom doesn't start a pan. Empty-space clicks fall
   * through and pan-zoom takes over.
   */
  _initEditor(rightSvg) {
    if (!rightSvg) return;
    try {
      this._editor = new SvgEditor(rightSvg, {
        onChange: this._onEditorChange,
      });
      this._editor.attach();
    } catch (err) {
      console.warn('[svg-viewer] editor init failed', err);
      this._editor = null;
    }
  }

  /**
   * Detach and null the editor. Safe to call when no
   * editor exists.
   */
  _disposeEditor() {
    if (!this._editor) return;
    try {
      this._editor.detach();
    } catch (_) {
      // Already detached or SVG disposed — harmless.
    }
    this._editor = null;
  }

  /**
   * Editor change callback — fires after any mutation
   * (currently delete; 3.2c.2+ will add move/resize).
   * Serialises the current right-panel SVG back to the
   * file's `modified` field and recomputes dirty state.
   * Temporarily removes the handle overlay group during
   * serialisation so it doesn't leak into saved content.
   */
  _onEditorChange() {
    if (this._activeIndex < 0) return;
    const file = this._files[this._activeIndex];
    if (!file) return;
    const rightContainer =
      this.shadowRoot?.querySelector('.pane-right .svg-container');
    if (!rightContainer) return;
    const rightSvg = rightContainer.querySelector('svg');
    if (!rightSvg) return;
    // Detach the handle group before serialising so the
    // `<g id="svg-editor-handles">` chrome doesn't end up
    // in saved content. Re-attach afterwards so the user's
    // selection indicator stays visible.
    const handleGroup = rightSvg.querySelector('#svg-editor-handles');
    let parent = null;
    let nextSibling = null;
    if (handleGroup) {
      parent = handleGroup.parentNode;
      nextSibling = handleGroup.nextSibling;
      parent.removeChild(handleGroup);
    }
    let html;
    try {
      html = rightContainer.innerHTML;
    } finally {
      // Restore regardless of throw.
      if (handleGroup && parent) {
        if (nextSibling) {
          parent.insertBefore(handleGroup, nextSibling);
        } else {
          parent.appendChild(handleGroup);
        }
      }
    }
    if (html !== file.modified) {
      file.modified = html;
      // Keep the injection cache in sync so a future
      // `_injectSvgContent` call (on file switch) doesn't
      // treat this content as changed and re-inject the
      // same bytes we just read.
      this._lastRightContent = html;
      this._recomputeDirtyCount();
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
  // Presentation mode
  // ---------------------------------------------------------------

  _togglePresentation() {
    if (this._activeIndex < 0) return;
    this._mode =
      this._mode === _MODE_PRESENT ? _MODE_SELECT : _MODE_PRESENT;
    this._contextMenu = null;
    // Content caches cleared so _injectSvgContent re-injects
    // into the new layout. In presentation mode the left pane
    // is display:none, so we skip its injection and pan-zoom
    // init to avoid wasted work on a hidden element.
    this._lastLeftContent = null;
    this._lastRightContent = null;
    // Re-inject after Lit commits the new template. The
    // updated() hook's _injectSvgContent call will fire
    // automatically because _mode is reactive.
  }

  // ---------------------------------------------------------------
  // Context menu
  // ---------------------------------------------------------------

  _onContextMenu(event) {
    if (this._activeIndex < 0) return;
    event.preventDefault();
    this._contextMenu = {
      x: event.clientX,
      y: event.clientY,
    };
    this.requestUpdate();
  }

  _onContextDismiss(event) {
    if (!this._contextMenu) return;
    const path = event.composedPath ? event.composedPath() : [];
    for (const el of path) {
      if (
        el &&
        el.classList &&
        el.classList.contains('context-menu')
      ) {
        return;
      }
    }
    this._contextMenu = null;
    this.requestUpdate();
  }

  // ---------------------------------------------------------------
  // Copy as PNG
  // ---------------------------------------------------------------

  /**
   * Render the current modified SVG to a PNG and copy to
   * clipboard. Falls back to a download when clipboard
   * write isn't available. Emits a toast event for user
   * feedback.
   */
  async _copyAsPng() {
    this._contextMenu = null;
    if (this._activeIndex < 0) return;
    const file = this._files[this._activeIndex];
    if (!file) return;
    const svgText = file.modified || '';
    if (!svgText) return;
    try {
      // Parse dimensions from the SVG.
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgText, 'image/svg+xml');
      const svgEl = doc.querySelector('svg');
      let width = 1920;
      let height = 1080;
      if (svgEl) {
        const vb = svgEl.getAttribute('viewBox');
        if (vb) {
          const parts = vb.split(/[\s,]+/).map(Number);
          if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
            width = parts[2];
            height = parts[3];
          }
        }
        const w = parseFloat(svgEl.getAttribute('width'));
        const h = parseFloat(svgEl.getAttribute('height'));
        if (w > 0 && h > 0) {
          width = w;
          height = h;
        }
      }
      // Scale for quality.
      const maxDim = Math.max(width, height);
      let scale = maxDim < 1024 ? 4 : 2;
      const maxPx = 4096;
      if (maxDim * scale > maxPx) {
        scale = maxPx / maxDim;
      }
      const canvasWidth = Math.round(width * scale);
      const canvasHeight = Math.round(height * scale);
      // Render to canvas.
      const canvas = document.createElement('canvas');
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      const blob = new Blob([svgText], {
        type: 'image/svg+xml;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });
      ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
      URL.revokeObjectURL(url);
      // Try clipboard write.
      if (
        navigator.clipboard &&
        typeof navigator.clipboard.write === 'function' &&
        typeof ClipboardItem !== 'undefined'
      ) {
        try {
          const item = new ClipboardItem({
            'image/png': new Promise((resolve) => {
              canvas.toBlob(
                (b) => resolve(b),
                'image/png',
              );
            }),
          });
          await navigator.clipboard.write([item]);
          this._emitToast('Image copied to clipboard', 'success');
          return;
        } catch (_) {
          // Fall through to download.
        }
      }
      // Download fallback.
      canvas.toBlob((b) => {
        if (!b) {
          this._emitToast('Failed to create image', 'error');
          return;
        }
        const a = document.createElement('a');
        const basename = (file.path || 'image')
          .split('/')
          .pop()
          .replace(/\.svg$/i, '');
        a.download = `${basename}.png`;
        a.href = URL.createObjectURL(b);
        a.click();
        URL.revokeObjectURL(a.href);
        this._emitToast('Image downloaded as PNG', 'info');
      }, 'image/png');
    } catch (err) {
      this._emitToast(
        `Failed to copy image: ${err?.message || 'unknown error'}`,
        'error',
      );
    }
  }

  // ---------------------------------------------------------------
  // SVG ↔ text diff toggle
  // ---------------------------------------------------------------

  /**
   * Dispatch a toggle-svg-mode event to switch from the
   * visual SVG viewer to the Monaco text diff editor.
   * The app shell handles the actual viewer swap.
   */
  _switchToTextDiff() {
    if (this._activeIndex < 0) return;
    const file = this._files[this._activeIndex];
    if (!file) return;
    // Capture latest content from the editor before
    // switching. The SvgEditor may have mutations not
    // yet serialized to file.modified.
    this._onEditorChange();
    this.dispatchEvent(
      new CustomEvent('toggle-svg-mode', {
        detail: {
          path: file.path,
          target: 'diff',
          modified: file.modified,
          savedContent: file.savedContent,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  _emitToast(message, type = 'info') {
    window.dispatchEvent(
      new CustomEvent('ac-toast', {
        detail: { message, type },
        bubbles: false,
      }),
    );
  }

  // ---------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------

  _onKeyDown(event) {
    if (!this.isConnected) return;
    if (this._activeIndex < 0) return;
    // F11 toggles presentation mode (no Ctrl needed).
    if (event.key === 'F11') {
      if (this._eventTargetInsideUs(event)) {
        event.preventDefault();
        this._togglePresentation();
      }
      return;
    }
    // Escape exits presentation mode.
    if (
      event.key === 'Escape' &&
      this._mode === _MODE_PRESENT
    ) {
      if (this._eventTargetInsideUs(event)) {
        event.preventDefault();
        this._togglePresentation();
      }
      return;
    }
    const ctrl = event.ctrlKey || event.metaKey;
    if (!ctrl) return;
    if (!this._eventTargetInsideUs(event)) return;
    // Ctrl+Shift+C — copy as PNG.
    if (
      (event.key === 'c' || event.key === 'C') &&
      event.shiftKey
    ) {
      event.preventDefault();
      this._copyAsPng();
      return;
    }
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
    const isPresent = this._mode === _MODE_PRESENT;
    return html`
      <div class="split ${isPresent ? 'present' : ''}">
        <div class="pane pane-left">
          <div class="pane-label">Original</div>
          <div class="svg-container"></div>
        </div>
        <div class="pane pane-right"
          @contextmenu=${this._onContextMenu}
        >
          <div class="pane-label">Modified</div>
          <div class="svg-container"></div>
        </div>
        <div
          class="status-led ${ledClass}"
          title=${this._statusLedTitle()}
          aria-label=${this._statusLedTitle()}
          @click=${this._onStatusLedClick}
        ></div>
        <div class="floating-actions">
          <button
            class="float-btn ${isPresent ? 'active' : ''}"
            title=${isPresent
              ? 'Exit presentation (Escape)'
              : 'Presentation mode (F11)'}
            aria-label=${isPresent
              ? 'Exit presentation mode'
              : 'Enter presentation mode'}
            @click=${this._togglePresentation}
          >
            ◱
          </button>
          <button
            class="float-btn"
            title="Switch to text diff view"
            aria-label="Switch to text diff view"
            @click=${this._switchToTextDiff}
          >
            &lt;/&gt;
          </button>
          <button
            class="float-btn"
            title="Fit to view"
            aria-label="Fit SVG to view"
            @click=${this._onFitClick}
          >
            ⊡
          </button>
        </div>
      </div>
      ${this._contextMenu
        ? html`
            <div
              class="context-menu"
              style="left: ${this._contextMenu.x}px; top: ${this._contextMenu.y}px;"
              role="menu"
            >
              <button
                class="context-menu-item"
                role="menuitem"
                @click=${this._copyAsPng}
              >
                📋 Copy as PNG
              </button>
            </div>
          `
        : ''}
    `;
  }
}

customElements.define('ac-svg-viewer', SvgViewer);