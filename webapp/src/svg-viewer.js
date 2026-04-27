// SvgViewer — side-by-side SVG diff viewer.
//
// Governing spec: specs4/5-webapp/svg-viewer.md
//
// What this component does:
//   - Tracks multiple open SVG files (open/close/switch)
//     with a concurrent-openFile guard.
//   - Fetches HEAD + working-copy content via Repo RPCs
//     (`Repo.get_file_content`), renders them side by
//     side — left pane is HEAD (read-only reference),
//     right pane is the working copy.
//   - Synchronises pan/zoom across the two panes via
//     `svg-pan-zoom`, with a mutex guard to break
//     feedback loops when one pane mirrors the other.
//   - Hosts an `SvgEditor` on the right pane for visual
//     editing (select, drag, resize, vertex edit, inline
//     text edit, marquee, clipboard).
//   - Resolves relative `<image href="...">` references
//     in PDF/PPTX-generated SVGs by fetching sibling
//     raster images via `Repo.get_file_base64` and
//     rewriting the href in place.
//   - Tracks dirty state per file, exposes a status LED
//     mirroring the diff viewer's (clean / dirty / new),
//     and dispatches `file-saved` events on save.
//   - Handles keyboard shortcuts: Ctrl+S save, Ctrl+W
//     close, Ctrl+PageUp/Down cycle, F11 presentation,
//     Escape exit presentation, Ctrl+Shift+C copy PNG.
//   - Presentation mode hides the left pane via CSS and
//     refits the right pane to the new width. The left
//     pane is collapsed (not `display: none`) so its
//     `<defs>` gradients remain addressable by the
//     browser — see the `.split.present .pane-left` CSS
//     block for the full explanation.
//   - Supports a context menu (right-click) with
//     "Copy as PNG" and a toolbar toggle to switch to
//     the Monaco text diff viewer via `toggle-svg-mode`.
//
// Architectural contracts:
//
//   - **Content is text, not base64.** SVG is XML. Fetch
//     via `Repo.get_file_content` — same as the diff
//     viewer for text files. `Repo.get_file_base64` is
//     for rendering raster images, not editing source.
//
//   - **`innerHTML` injection, not Lit interpolation.**
//     Lit would HTML-escape raw SVG strings. The
//     component renders empty container divs and sets
//     `innerHTML` manually in `updated()`.
//
//   - **Right pane has `preserveAspectRatio="none"`** so
//     the `SvgEditor` has sole viewBox authority. The
//     left pane keeps the default ("xMidYMid meet") —
//     it's a read-only reference with no editor math.
//
//   - **Status LED shape matches the diff viewer.** Same
//     classes, same click-to-save affordance. Toggling
//     between viewers should not surprise the user.

import { LitElement, css, html } from 'lit';

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

    /* Presentation mode — left pane collapsed to zero
     * width, right pane fills the remaining space. We
     * deliberately avoid display:none on the left pane:
     * both panes inject the same SVG content, which
     * means both contain <defs> with the same gradient
     * IDs (e.g. a linearGradient with id "g-future").
     * When the left pane has display:none, its subtree
     * is pruned from rendering but its elements remain
     * in the DOM and are still matched by document-wide
     * ID lookups. Some browsers then resolve the right
     * pane's fill="url(#g-future)" to the hidden left
     * pane's gradient — which paints nothing — making
     * every layer band render as a flat colourless
     * rectangle in presentation mode.
     *
     * Collapsing via flex-basis + overflow:hidden +
     * visibility:hidden keeps the left pane in the render
     * tree (so its gradients remain addressable by the
     * browser's renderer) while making it invisible and
     * zero-width. The SvgEditor on the right pane stays
     * mounted, selection state is preserved, and the
     * gradient-resolution conflict is resolved. */
    .split.present .pane-left {
      flex: 0 0 0;
      width: 0;
      min-width: 0;
      visibility: hidden;
      border-left: none;
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
    // Paired SvgEditor instances — one per panel. The
    // left instance is read-only (navigation only); the
    // right is fully editable. Both mirror their viewBox
    // writes to the other via `onViewChange`. Null when
    // no file is open. Disposed before every SVG re-
    // injection so they never hold stale DOM refs.
    this._editorLeft = null;
    this._editorRight = null;
    // Guard against feedback loops when syncing viewBox
    // between panels. Set before programmatically writing
    // to one editor to match the other; cleared after.
    // Pure mutex pattern — same as markdown preview's
    // scroll sync in 3.1b.
    this._syncingViewBox = false;
    // Back-compat alias. Some existing code (tests,
    // `_onEditorChange`) references `_editor` directly;
    // point it at the right (editable) pane.
    this._editor = null;
    // Bound editor change handler — syncs edited SVG back
    // to the file's modified content and recomputes dirty.
    this._onEditorChange = this._onEditorChange.bind(this);
    this._onLeftViewChange = this._onLeftViewChange.bind(this);
    this._onRightViewChange = this._onRightViewChange.bind(this);
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
    this._disposeEditors();
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
      // Same-file open — state is unchanged, but the
      // caller (app-shell's _onNavigateFile) relies on
      // active-file-changed firing to flip viewer
      // visibility from diff to SVG. Without this
      // dispatch, clicking an SVG file that's already
      // the SVG viewer's active file (e.g. from a prior
      // session restore) leaves the SVG viewer hidden
      // behind the diff viewer indefinitely. specs4/
      // 5-webapp/shell.md § "Viewer Background" — "the
      // viewer dispatches active-file-changed on every
      // openFile call; the shell uses this to identify
      // which viewer should be visible."
      this._dispatchActiveFileChanged();
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
      this._disposeEditors();
      return;
    }
    const file = this._files[this._activeIndex];
    if (!file) return;
    const rightContainer =
      this.shadowRoot?.querySelector('.pane-right .svg-container');
    if (!rightContainer) return;
    // Both panes always receive their content — presentation
    // mode is a CSS-only layout change (.split.present hides
    // the left pane via display:none and flexes the right
    // to 100%). The SVGs and their pan-zoom/editor
    // instances stay mounted across the toggle.
    const leftContainer = this.shadowRoot?.querySelector(
      '.pane-left .svg-container',
    );
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
      if (leftContainer) {
        leftContainer.innerHTML = leftContent;
        // Strip declared width/height so pan-zoom's fit
        // computation uses the container's actual size
        // rather than the SVG's intrinsic dimensions.
        // Left pane keeps default preserveAspectRatio
        // ("xMidYMid meet") — it's read-only, no editor
        // coordinate math to protect from browser fitting.
        const leftSvg = leftContainer.querySelector('svg');
        if (leftSvg) {
          leftSvg.removeAttribute('width');
          leftSvg.removeAttribute('height');
        }
      }
      this._lastLeftContent = leftContent;
      changed = true;
    }
    if (rightContent !== this._lastRightContent) {
      rightContainer.innerHTML = rightContent;
      this._lastRightContent = rightContent;
      changed = true;
    }
    if (changed) {
      // Both panes get `preserveAspectRatio="none"` now
      // that each has its own SvgEditor driving viewBox
      // writes. Without this, the browser's aspect-ratio
      // fitting would fight the editor's coordinate math
      // on any pane where the authored viewBox aspect
      // differs from the container aspect — pan/zoom
      // deltas would feel "sticky" as the browser
      // silently re-fit on top of every write.
      //
      // Declared width/height are stripped so the browser
      // doesn't use the SVG's intrinsic dimensions — we
      // want the CSS 100%/100% layout to drive sizing and
      // the editor's viewBox writes to drive content
      // framing.
      const rightSvg = rightContainer.querySelector('svg');
      if (rightSvg) {
        rightSvg.setAttribute('preserveAspectRatio', 'none');
        rightSvg.removeAttribute('width');
        rightSvg.removeAttribute('height');
      }
      const leftSvg = leftContainer
        ? leftContainer.querySelector('svg')
        : null;
      if (leftSvg) {
        leftSvg.setAttribute('preserveAspectRatio', 'none');
      }
      // Dispose any prior editors before re-init — their
      // SVG references are about to become stale.
      this._disposeEditors();
      // Create a read-only editor on the left and an
      // editable editor on the right. Both sync viewBox
      // via their `onViewChange` callbacks with the
      // mirror-guard mutex preventing feedback loops.
      this._initEditors(leftSvg, rightSvg);
      // Resolve relative image references in both panels.
      // PDF/PPTX-converted SVGs reference sibling raster
      // images via `<image href="01_slide_img1.png"/>`.
      // The browser resolves these against the webapp's
      // origin URL — which doesn't serve repo files — so
      // they silently fail. Fetch via Repo.get_file_base64
      // and rewrite in-place.
      if (leftContainer) {
        this._resolveImageHrefs(leftContainer, file.path);
      }
      this._resolveImageHrefs(rightContainer, file.path);
    }
  }

  /**
   * Attach an SvgEditor to each panel's SVG. The left
   * instance runs in read-only mode — it handles only
   * wheel zoom and middle/left-drag pan, never mutates
   * content, never shows handles. The right instance is
   * fully editable. Both call `_onLeftViewChange` /
   * `_onRightViewChange` on every viewBox write; those
   * handlers mirror the write to the other pane under
   * the `_syncingViewBox` mutex to prevent feedback.
   *
   * After both editors attach, an initial fit-content
   * runs on both with `silent: true` so the initial
   * framing writes don't fire `onViewChange` (which
   * would spuriously mirror across before the user has
   * done anything).
   */
  _initEditors(leftSvg, rightSvg) {
    if (leftSvg) {
      try {
        this._editorLeft = new SvgEditor(leftSvg, {
          readOnly: true,
          onViewChange: this._onLeftViewChange,
        });
        this._editorLeft.attach();
      } catch (err) {
        console.warn('[svg-viewer] left editor init failed', err);
        this._editorLeft = null;
      }
    }
    if (rightSvg) {
      try {
        this._editorRight = new SvgEditor(rightSvg, {
          onChange: this._onEditorChange,
          onViewChange: this._onRightViewChange,
        });
        this._editorRight.attach();
      } catch (err) {
        console.warn('[svg-viewer] right editor init failed', err);
        this._editorRight = null;
      }
    }
    // Back-compat alias.
    this._editor = this._editorRight;
    // Initial fit — run under the mutex so the implicit
    // mirror write between the two editors doesn't
    // double-fire before the user touches anything. The
    // `silent: true` option suppresses the `onViewChange`
    // callback for the caller's write; the mutex
    // additionally guards the mirror path in case fit
    // triggers a cascade.
    this._syncingViewBox = true;
    try {
      if (this._editorLeft) this._editorLeft.fitContent({ silent: true });
      if (this._editorRight) this._editorRight.fitContent({ silent: true });
    } finally {
      this._syncingViewBox = false;
    }
  }

  /**
   * Detach both editors and null their refs. Safe to
   * call when no editors exist.
   */
  _disposeEditors() {
    if (this._editorLeft) {
      try {
        this._editorLeft.detach();
      } catch (_) {}
      this._editorLeft = null;
    }
    if (this._editorRight) {
      try {
        this._editorRight.detach();
      } catch (_) {}
      this._editorRight = null;
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
    // Unwrap the svg-pan-zoom viewport group before
    // serialising. svg-pan-zoom wraps all SVG children
    // in <g class="svg-pan-zoom_viewport" transform="...">
    // to apply its pan/zoom transform; if we serialise
    // with the wrapper in place, the transform matrix
    // and wrapper element get baked into file.modified.
    // On next re-injection (e.g. entering presentation
    // mode), pan-zoom wraps the already-wrapped content
    // again, producing nested transforms that stack and
    // visibly break the rendering — layer positions,
    // gradients, and text all render at wrong scales.
    // Collect viewport children, restore as direct
    // children of the SVG root, serialise, then put the
    // wrapper back so pan-zoom can continue operating.
    const viewport = rightSvg.querySelector(
      ':scope > g.svg-pan-zoom_viewport',
    );
    let viewportParent = null;
    let viewportNext = null;
    const viewportChildren = [];
    if (viewport) {
      viewportParent = viewport.parentNode;
      viewportNext = viewport.nextSibling;
      while (viewport.firstChild) {
        const child = viewport.firstChild;
        viewportChildren.push(child);
        viewport.removeChild(child);
        rightSvg.insertBefore(child, viewport);
      }
      rightSvg.removeChild(viewport);
    }
    let html;
    try {
      html = rightContainer.innerHTML;
    } finally {
      // Restore the viewport wrapper so pan-zoom's
      // next operation finds its expected DOM shape.
      if (viewport && viewportParent) {
        for (const child of viewportChildren) {
          viewport.appendChild(child);
        }
        if (viewportNext) {
          viewportParent.insertBefore(viewport, viewportNext);
        } else {
          viewportParent.appendChild(viewport);
        }
      }
      // Restore handle group regardless of throw.
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
   * Resolve relative image references inside an SVG
   * container. Finds all `<image>` elements, skips those
   * with absolute or data URIs, resolves relative paths
   * against the SVG file's directory, fetches binary
   * content via `Repo.get_file_base64`, and rewrites the
   * href attribute in-place.
   *
   * Runs in parallel for all images in the container.
   * Non-blocking — the SVG panels initialize and become
   * interactive immediately; images appear as base64
   * fetches complete. Failed fetches log a warning but
   * do not prevent the SVG from displaying.
   *
   * @param {HTMLElement} container — the `.svg-container` div
   * @param {string} svgPath — repo-relative path of the SVG file
   */
  async _resolveImageHrefs(container, svgPath) {
    if (!container || !svgPath) return;
    const call = this._getRpcCall();
    if (!call) return;
    const images = container.querySelectorAll('image');
    if (images.length === 0) return;
    // Derive the SVG file's directory for relative path
    // resolution. "docs/slides/01_slide.svg" → "docs/slides".
    const lastSlash = svgPath.lastIndexOf('/');
    const baseDir = lastSlash >= 0 ? svgPath.slice(0, lastSlash) : '';
    const tasks = [];
    for (const img of images) {
      // Check both href and xlink:href — SVG uses both
      // attribute forms depending on the generator.
      const href =
        img.getAttribute('href') ||
        img.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
        '';
      if (!href) continue;
      // Skip absolute URLs and data URIs — already resolved.
      if (
        href.startsWith('data:') ||
        href.startsWith('http://') ||
        href.startsWith('https://') ||
        href.startsWith('blob:')
      ) {
        continue;
      }
      // Resolve relative path against the SVG's directory.
      const resolved = baseDir ? `${baseDir}/${href}` : href;
      tasks.push(
        this._resolveOneImageHref(img, resolved, call),
      );
    }
    if (tasks.length > 0) {
      await Promise.all(tasks).catch(() => {
        // Individual failures handled inside
        // _resolveOneImageHref; this catch prevents
        // unhandled rejection if the gather itself throws.
      });
    }
  }

  /**
   * Fetch a single image via Repo.get_file_base64 and
   * rewrite the `<image>` element's href attribute with
   * the resulting data URI.
   */
  async _resolveOneImageHref(imgEl, repoPath, call) {
    try {
      const result = await call['Repo.get_file_base64'](repoPath);
      const dataUri = this._extractBase64Uri(result);
      if (!dataUri) {
        console.warn(
          `[svg-viewer] image resolution failed for ${repoPath}: empty response`,
        );
        return;
      }
      // Rewrite both href forms so the browser picks up
      // the change regardless of which attribute the SVG
      // generator used.
      imgEl.setAttribute('href', dataUri);
      if (imgEl.hasAttributeNS('http://www.w3.org/1999/xlink', 'href')) {
        imgEl.setAttributeNS(
          'http://www.w3.org/1999/xlink',
          'href',
          dataUri,
        );
      }
    } catch (err) {
      console.warn(
        `[svg-viewer] image resolution failed for ${repoPath}:`,
        err?.message || err,
      );
    }
  }

  /**
   * Extract a data URI from a Repo.get_file_base64
   * response. Handles plain string, object with
   * `data_uri` field, and jrpc-oo single-key envelope.
   */
  _extractBase64Uri(result) {
    if (typeof result === 'string') return result;
    if (result && typeof result === 'object') {
      if (typeof result.data_uri === 'string') return result.data_uri;
      if (typeof result.content === 'string') return result.content;
      const keys = Object.keys(result);
      if (keys.length === 1) {
        return this._extractBase64Uri(result[keys[0]]);
      }
    }
    return '';
  }

  // ---------------------------------------------------------------
  // ViewBox sync callbacks
  // ---------------------------------------------------------------

  /**
   * Left editor viewBox changed — mirror to right. The
   * `_syncingViewBox` mutex guards against feedback:
   * when we programmatically write to the right editor,
   * its own `onViewChange` fires, but the mutex is set
   * so the reciprocal mirror is skipped.
   *
   * The mirror write uses `silent: true` so the right
   * editor's callback doesn't fire at all — belt and
   * braces alongside the mutex.
   */
  _onLeftViewChange(vb) {
    if (this._syncingViewBox) return;
    if (!this._editorRight) return;
    this._syncingViewBox = true;
    try {
      this._editorRight.setViewBox(
        vb.x,
        vb.y,
        vb.width,
        vb.height,
        { silent: true },
      );
    } catch (_) {
    } finally {
      this._syncingViewBox = false;
    }
  }

  /** Right → left mirror. Symmetric with `_onLeftViewChange`. */
  _onRightViewChange(vb) {
    if (this._syncingViewBox) return;
    if (!this._editorLeft) return;
    this._syncingViewBox = true;
    try {
      this._editorLeft.setViewBox(
        vb.x,
        vb.y,
        vb.width,
        vb.height,
        { silent: true },
      );
    } finally {
      this._syncingViewBox = false;
    }
  }

  /**
   * Fit button click handler. Calls `fitContent()` on
   * both editors. The mutex is held across both calls
   * so the first fit's `onViewChange` doesn't cascade
   * and overwrite the second's pending fit. `silent: true`
   * on both writes is belt-and-braces — with the mutex
   * alone it would still work, but keeping the silent
   * flag means a future refactor that drops the mutex
   * won't regress.
   */
  _onFitClick() {
    if (!this._editorLeft && !this._editorRight) return;
    this._syncingViewBox = true;
    try {
      if (this._editorLeft) {
        try {
          this._editorLeft.fitContent({ silent: true });
        } catch (_) {}
      }
      if (this._editorRight) {
        try {
          this._editorRight.fitContent({ silent: true });
        } catch (_) {}
      }
    } finally {
      this._syncingViewBox = false;
    }
    // After both fit calls settle, push the right editor's
    // final viewBox onto the left so they're in exact sync
    // (they may differ by a fraction of a pixel because
    // each fit runs against its own container dimensions).
    if (this._editorLeft && this._editorRight) {
      this._syncingViewBox = true;
      try {
        const vb = this._editorRight.getViewBox();
        this._editorLeft.setViewBox(
          vb.x,
          vb.y,
          vb.width,
          vb.height,
          { silent: true },
        );
      } finally {
        this._syncingViewBox = false;
      }
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
    // Mode toggle is CSS-only — .split.present hides the
    // left pane and lets the right pane flex to 100%. The
    // right pane's SVG, its pan-zoom instance, and its
    // editor all stay mounted across the toggle. But the
    // right-pane container does change width (from 50% to
    // 100% of the split), and svg-pan-zoom's viewport
    // transform was computed for the old width — it won't
    // recompute on its own. Without a resize+fit call, the
    // content stays at the narrower scale, painted against
    // a now-stretched SVG element with preserveAspectRatio=
    // "none". That mismatch is what makes gradient-filled
    // layer bands render washed out (gradient stops spread
    // across a stretched bbox) and layer text lose contrast
    // in presentation mode. Wrap the refit in rAF so the
    // CSS layout change has committed before we measure.
    requestAnimationFrame(() => {
      if (!this._editorRight) return;
      try {
        this._editorRight.fitContent({ silent: true });
      } catch (_) {}
    });
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