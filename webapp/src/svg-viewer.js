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
import { SvgEditor } from './svg-editor/index.js';

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
    /**
     * Virtual comparison slot for `loadPanel`'s ad-hoc
     * content view. Shape: `{leftContent, leftLabel,
     * rightContent, rightLabel}`. When non-null, the
     * panes render from this slot instead of from the
     * active `_files[]` entry — the user has loaded SVG
     * content into one or both panes for visual
     * side-by-side comparison rather than viewing a
     * file's HEAD vs working diff. Two successive
     * `loadPanel` calls accumulate (one per side).
     * Mutually exclusive with `_files[_activeIndex]` —
     * opening any real file via `openFile` clears this
     * slot. Mirrors the diff viewer's
     * `_virtualComparison` shape so the wiring from the
     * file picker's "Open in left/right panel" actions
     * is symmetric across viewers.
     */
    _virtualComparison: { type: Object, state: true },
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
    /* Keep referenced defs paintable even though the left
     * pane is visibility-hidden. Both panes inject the same
     * SVG content, so both contain a <defs> with the same
     * IDs. When the right pane's content references one
     * (e.g. marker-end="url(#arrowhead)"), the browser
     * resolves to the first matching ID in document order
     * — the left pane's. For gradients/patterns/filters
     * that's fine: a hidden ancestor doesn't suppress fill
     * painting. But <marker> is rendered at path endpoints
     * with visibility inherited from the marker element's
     * tree — so the right pane's arrowheads silently
     * disappear because they're "drawn" through the
     * hidden left pane's marker.
     *
     * Forcing defs subtrees back to visibility:visible
     * keeps the marker paintable. The pane itself stays
     * invisible — defs don't render in flow regardless. */
    .split.present .pane-left svg defs,
    .split.present .pane-left svg defs * {
      visibility: visible;
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
    .context-menu-divider {
      height: 1px;
      background: rgba(240, 246, 252, 0.12);
      margin: 0.25rem 0;
    }
    .context-menu-section-label {
      padding: 0.3rem 0.75rem 0.15rem;
      font-size: 0.7rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--text-secondary, #8b949e);
      user-select: none;
    }
    .align-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 2px;
      padding: 0 0.5rem 0.25rem;
    }
    .align-btn {
      background: rgba(13, 17, 23, 0.6);
      border: 1px solid rgba(240, 246, 252, 0.12);
      color: var(--text-primary, #c9d1d9);
      padding: 0.35rem 0;
      font-family: inherit;
      font-size: 0.95rem;
      line-height: 1;
      cursor: pointer;
      border-radius: 3px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .align-btn:hover {
      background: rgba(88, 166, 255, 0.18);
      border-color: rgba(88, 166, 255, 0.5);
    }
  `;

  constructor() {
    super();
    this._files = [];
    this._activeIndex = -1;
    this._dirtyCount = 0;
    this._mode = _MODE_SELECT;
    this._virtualComparison = null;
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
    this._onFilesModified = this._onFilesModified.bind(this);
  }

  // ---------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('click', this._onContextDismiss);
    // Pick up external edits — commits, pulls, edit-pipeline
    // applies, collab writes. The app shell calls
    // refreshOpenFiles on streamComplete / commitResult /
    // files-reverted, but not on the generic files-modified
    // broadcast that fires after any backend-side write.
    // Without this listener, a file edited on disk between
    // runs (or by a sibling tool) stays cached in _files
    // indefinitely — clicking the tab again reads from
    // memory, never from disk. Subscribing here closes
    // the gap at the viewer level.
    window.addEventListener('files-modified', this._onFilesModified);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('click', this._onContextDismiss);
    window.removeEventListener('files-modified', this._onFilesModified);
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
    // Opening a real file clears any virtual comparison —
    // the slots are mutually exclusive (the panes render
    // either a file's HEAD/working diff or the virtual
    // left/right content, never a mix). Cleared up front
    // so the injection cache invalidation below sees the
    // correct destination state.
    if (this._virtualComparison !== null) {
      this._virtualComparison = null;
      this._lastLeftContent = null;
      this._lastRightContent = null;
    }
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
      const file = this._files.find((f) => f.path === path);
      if (!file) continue;
      // Skip dirty files — the user has in-progress edits
      // in the SvgEditor that refetching would silently
      // discard. Matches the contract that refresh is for
      // syncing disk → viewer, not viewer → disk.
      if (this._isDirty(file)) continue;
      const fetched = await this._fetchFileContent(path);
      if (!fetched) continue;
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

  /**
   * Load arbitrary SVG content into one of the two
   * panes for visual side-by-side comparison. Mirrors
   * the diff viewer's `loadPanel` API — same
   * `(content, panel, label)` shape so the file
   * picker's "Open in left/right panel" actions route
   * symmetrically to either viewer based on file type.
   *
   * Two successive calls (one per panel) populate left
   * and right; the second call preserves whatever was
   * loaded into the other side. Opening a real file via
   * `openFile` clears this slot — the slots are
   * mutually exclusive.
   *
   * The `label` is kept for API symmetry with the diff
   * viewer but isn't currently rendered as a per-pane
   * caption (the SVG viewer's static "Original" /
   * "Modified" labels still show because the existing
   * pane DOM is reused). A future pass could swap them
   * for the per-call labels when a virtual comparison
   * is active; that's UI polish, not a correctness
   * concern.
   *
   * No-op when content isn't a string or the panel
   * value is unrecognised — same defensive-rejection
   * pattern as the diff viewer.
   */
  async loadPanel(content, panel, _label) {
    if (panel !== 'left' && panel !== 'right') return;
    if (typeof content !== 'string') return;
    // Switching from a real file to virtual content (or
    // vice versa) needs the active-file event to fire so
    // the shell flips viewer visibility. Determine
    // before-state up front.
    const hadActiveFile = this._activeIndex >= 0;
    if (this._virtualComparison === null) {
      this._virtualComparison = {
        leftContent: panel === 'left' ? content : '',
        leftLabel: panel === 'left' ? _label || '' : '',
        rightContent: panel === 'right' ? content : '',
        rightLabel: panel === 'right' ? _label || '' : '',
      };
    } else {
      const current = this._virtualComparison;
      this._virtualComparison = {
        leftContent:
          panel === 'left' ? content : current.leftContent,
        leftLabel:
          panel === 'left' ? _label || '' : current.leftLabel,
        rightContent:
          panel === 'right' ? content : current.rightContent,
        rightLabel:
          panel === 'right' ? _label || '' : current.rightLabel,
      };
    }
    // Real file (if any) gets cleared so the panes
    // render exclusively from the virtual slot. The
    // file's own dirty state is preserved in `_files[]`
    // — closing then reopening it would restore the
    // editor view; for now we just stop showing it.
    if (hadActiveFile) {
      this._activeIndex = -1;
    }
    // Force re-injection — content has changed and the
    // editors need fresh DOM references.
    this._lastLeftContent = null;
    this._lastRightContent = null;
    this._recomputeDirtyCount();
    if (hadActiveFile) {
      this._dispatchActiveFileChanged();
    } else {
      // First loadPanel call into an empty viewer also
      // needs the event so the shell knows to make the
      // SVG viewer foreground.
      this._dispatchActiveFileChanged();
    }
    this.requestUpdate();
  }

  /**
   * Handle `files-modified` window broadcasts. Fires after
   * backend-side writes (commits, resets, edit-pipeline
   * applies, collab writes, manual repo writes from the
   * files tab's rename/duplicate paths). Calls
   * `refreshOpenFiles` when any affected path is open in
   * this viewer — otherwise it's a cheap no-op.
   *
   * Dirty files are preserved by refreshOpenFiles's own
   * dirty-skip guard, so a user mid-edit in the SvgEditor
   * doesn't lose their work when some other file triggers
   * the broadcast.
   */
  _onFilesModified(event) {
    if (this._files.length === 0) return;
    const paths = event?.detail?.paths;
    if (!Array.isArray(paths) || paths.length === 0) {
      // Missing / empty paths list means "something
      // changed, but we don't know what". Refresh
      // defensively — cost is N fetches for N open
      // files, which in practice is 1–3.
      this.refreshOpenFiles().catch((err) => {
        console.warn('[svg-viewer] refresh failed', err);
      });
      return;
    }
    const open = new Set(this._files.map((f) => f.path));
    const affected = paths.some((p) => open.has(p));
    if (!affected) return;
    this.refreshOpenFiles().catch((err) => {
      console.warn('[svg-viewer] refresh failed', err);
    });
  }

  /**
   * Re-fit both panes' content to the current container
   * size. Called by the app shell on window resize and
   * during dialog resize drags.
   *
   * Both editors run with `preserveAspectRatio="none"`,
   * so the browser doesn't re-fit the SVG when the
   * container dimensions change. Without an explicit
   * `fitContent()` call, the viewBox stays at its prior
   * computation and the content appears stretched or
   * cropped after a resize.
   *
   * Held under `_syncingViewBox` so the mirror path
   * between the two editors doesn't cascade — each
   * side's fit write is silent (suppresses its own
   * `onViewChange`), and the mutex covers the whole
   * operation defensively. Mirrors the pattern in
   * `_onFitClick` but kept separate because fit is a
   * user-initiated re-frame while relayout is a
   * passive response to container changes.
   *
   * No-op when no file is open (both editors null).
   */
  relayout() {
    if (!this._editorLeft && !this._editorRight) return;
    this._syncingViewBox = true;
    try {
      if (this._editorLeft) {
        try {
          this._editorLeft.fitContent({ silent: true });
        } catch (err) {
          console.debug('[svg-viewer] left relayout failed', err);
        }
      }
      if (this._editorRight) {
        try {
          this._editorRight.fitContent({ silent: true });
        } catch (err) {
          console.debug('[svg-viewer] right relayout failed', err);
        }
      }
    } finally {
      this._syncingViewBox = false;
    }
    // Sync right→left so the two panes agree on the
    // final viewBox. Same rationale as `_onFitClick`:
    // each fit runs against its own container, and
    // sub-pixel differences would otherwise leave the
    // panes mismatched.
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
  // Public API — viewport state (for shell-driven restore)
  // ---------------------------------------------------------------

  /**
   * Current viewBox of the right (editable) editor, or
   * null when no file is open. Used by the app shell's
   * viewport persistence. The two editors mirror via the
   * sync mutex, so reading either returns the same
   * answer at rest — we read the right side because it's
   * the editable authority and exists in every mode
   * (presentation mode collapses the left pane).
   *
   * Wrapped in try/catch: SvgEditor's getViewBox can
   * throw when the root SVG is mid-detach (e.g., during
   * a file switch, between `_disposeEditors` and
   * `_initEditors`). Returning null on throw matches
   * the "no file open" contract and lets the shell
   * gracefully omit the svg block from persistence.
   */
  getActiveViewBox() {
    if (!this._editorRight) return null;
    try {
      return this._editorRight.getViewBox();
    } catch (_) {
      return null;
    }
  }

  /**
   * Write a viewBox to the right editor. The sync
   * callback mirrors to the left editor silently (via
   * the `_syncingViewBox` mutex and `silent: true`). Used
   * by the shell's restore flow — the viewer passes the
   * stored pan/zoom state here and the editors pick it
   * up. No-op when no editor exists (file not yet
   * loaded) or when the viewBox shape is malformed.
   *
   * Values are in SVG user units — same space as
   * `getActiveViewBox()` returns. Not clamped to the
   * authored viewBox; the user may have zoomed out
   * beyond the original extent and we want to restore
   * exactly where they were.
   */
  setActiveViewBox(vb) {
    if (!this._editorRight) return;
    if (!vb || typeof vb !== 'object') return;
    const { x, y, width, height } = vb;
    if (
      typeof x !== 'number' || typeof y !== 'number'
      || typeof width !== 'number' || typeof height !== 'number'
      || !Number.isFinite(x) || !Number.isFinite(y)
      || !Number.isFinite(width) || !Number.isFinite(height)
      || width <= 0 || height <= 0
    ) {
      return;
    }
    try {
      this._editorRight.setViewBox(x, y, width, height);
    } catch (err) {
      console.debug('[svg-viewer] setActiveViewBox failed', err);
    }
  }

  /**
   * Whether the viewer is currently in presentation
   * mode (left pane collapsed, right pane full-width).
   */
  isPresentation() {
    return this._mode === _MODE_PRESENT;
  }

  /**
   * Set presentation mode idempotently. Unlike
   * `_togglePresentation`, calling `setPresentation(true)`
   * twice leaves presentation on rather than flipping
   * off. Used by the shell's restore flow.
   *
   * No-op when no file is open (matches the toggle's
   * own guard) or when the requested state matches the
   * current state.
   */
  setPresentation(on) {
    if (this._activeIndex < 0) return;
    const target = !!on;
    if (target === this.isPresentation()) return;
    this._togglePresentation();
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
    // Empty state — neither a real file nor a virtual
    // comparison is active. Clear caches and tear down
    // editors so a subsequent open starts fresh.
    if (this._activeIndex < 0 && this._virtualComparison === null) {
      this._lastLeftContent = null;
      this._lastRightContent = null;
      this._disposeEditors();
      return;
    }
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
    // Read content from whichever slot is active. Real
    // file: HEAD on the left, working copy on the right.
    // Virtual comparison: per-pane content set by
    // `loadPanel` calls, with empty string falling back
    // to the placeholder so the pane renders rather than
    // collapsing.
    let leftContent;
    let rightContent;
    let file = null;
    let virtualPath = null;
    if (this._virtualComparison !== null) {
      leftContent = this._virtualComparison.leftContent || _EMPTY_SVG;
      rightContent = this._virtualComparison.rightContent || _EMPTY_SVG;
      // Synthesise a path-like identifier from whichever
      // label is non-empty so image-href resolution has
      // a base directory to anchor against. Both panes
      // sharing one path is a simplification — when the
      // two sides come from different directories,
      // relative `<image>` references on one side may
      // fail to resolve. Acceptable trade-off given that
      // ad-hoc visual comparison is the primary use
      // case and the labels are usually the basename
      // alone (no directory information to disagree on).
      virtualPath =
        this._virtualComparison.rightLabel
        || this._virtualComparison.leftLabel
        || null;
    } else {
      file = this._files[this._activeIndex];
      if (!file) return;
      leftContent = file.original || _EMPTY_SVG;
      rightContent = file.modified || _EMPTY_SVG;
    }
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
      //
      // Virtual comparison mode falls back to the label
      // string as the path — labels are usually basenames
      // alone, which produces an empty base directory
      // and resolves `<image>` hrefs against the repo
      // root. That's good enough for the typical "open
      // these two slide SVGs side by side" workflow;
      // perfect path-aware resolution would need each
      // virtual side to track its own source path.
      const resolvePath = file ? file.path : virtualPath;
      if (resolvePath) {
        if (leftContainer) {
          this._resolveImageHrefs(leftContainer, resolvePath);
        }
        this._resolveImageHrefs(rightContainer, resolvePath);
      }
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
   *
   * In virtual-comparison mode the right pane isn't
   * backed by an entry in `_files[]` — edits route to
   * the virtual slot's `rightContent` instead, and the
   * dirty LED tracks `rightContent` vs `rightSaved`.
   * The early-return below covers the empty state where
   * neither slot is active.
   */
  _onEditorChange() {
    const file =
      this._activeIndex >= 0 ? this._files[this._activeIndex] : null;
    if (!file && this._virtualComparison === null) return;
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
    // Swap inlined data-URI hrefs back to their original
    // externalised values before serialising. The image
    // resolver stashed the pre-rewrite href(s) on
    // `data-ac-dc-original-href` and
    // `data-ac-dc-original-xlink-href` when it inlined the
    // binary content (`_resolveOneImageHref`). Without
    // this, the multi-megabyte inlined payload ends up in
    // file.modified — which then flows into saves, the
    // `</>` text-diff handoff, and clipboard paste,
    // appearing as a massive spurious diff against the
    // clean externalised form on disk.
    //
    // Records what we changed so the finally block can
    // put the inlined values back afterwards. The SVG
    // viewer relies on the live DOM having data-URI hrefs
    // for rendering; only the serialised snapshot uses
    // the externalised form.
    const restoreSwaps = [];
    const inlinedImages = rightSvg.querySelectorAll('image');
    for (const img of inlinedImages) {
      const origHref = img.getAttribute('data-ac-dc-original-href');
      const origXlink = img.getAttribute(
        'data-ac-dc-original-xlink-href',
      );
      if (origHref === null && origXlink === null) continue;
      const swap = { img, origHref, origXlink };
      // Snapshot the current inlined values so they can
      // be restored byte-identically. Using the DOM's
      // returned strings rather than reconstructing from
      // any in-memory source — whatever the browser is
      // painting right now is what we must paint again.
      if (origHref !== null) {
        swap.inlinedHref = img.getAttribute('href');
        img.setAttribute('href', origHref);
      }
      if (origXlink !== null) {
        swap.inlinedXlink = img.getAttributeNS(
          'http://www.w3.org/1999/xlink',
          'href',
        );
        img.setAttributeNS(
          'http://www.w3.org/1999/xlink',
          'href',
          origXlink,
        );
      }
      // Strip the tracking attributes so they don't leak
      // into the saved content. Re-added by the resolver
      // on the next mount (since the file content on disk
      // doesn't carry them).
      img.removeAttribute('data-ac-dc-original-href');
      img.removeAttribute('data-ac-dc-original-xlink-href');
      restoreSwaps.push(swap);
    }
    let html;
    try {
      html = rightContainer.innerHTML;
    } finally {
      // Restore the inlined hrefs + tracking attributes.
      // The viewer keeps painting data URIs; the resolver
      // won't re-run for this file because the tracking
      // attributes are back in place (conceptually — the
      // resolver guards on href prefix, not on the data
      // attribute, so it'd re-run harmlessly on the next
      // mount anyway, but leaving the tracking attributes
      // preserves the "already inlined" signal).
      for (const swap of restoreSwaps) {
        if (swap.origHref !== null) {
          swap.img.setAttribute(
            'data-ac-dc-original-href',
            swap.origHref,
          );
          if (swap.inlinedHref !== null) {
            swap.img.setAttribute('href', swap.inlinedHref);
          }
        }
        if (swap.origXlink !== null) {
          swap.img.setAttribute(
            'data-ac-dc-original-xlink-href',
            swap.origXlink,
          );
          if (swap.inlinedXlink !== null && swap.inlinedXlink !== '') {
            swap.img.setAttributeNS(
              'http://www.w3.org/1999/xlink',
              'href',
              swap.inlinedXlink,
            );
          }
        }
      }
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
    if (file) {
      if (html !== file.modified) {
        file.modified = html;
        // Keep the injection cache in sync so a future
        // `_injectSvgContent` call (on file switch) doesn't
        // treat this content as changed and re-inject the
        // same bytes we just read.
        this._lastRightContent = html;
        this._recomputeDirtyCount();
      }
    } else {
      // Virtual-comparison mode. Route the serialised
      // edit to the virtual slot's right side. Initialise
      // `rightSaved` lazily on first edit so the dirty
      // comparison has a baseline — until then any edit
      // would always look dirty against an undefined
      // savedContent.
      const vc = this._virtualComparison;
      if (vc) {
        if (typeof vc.rightSaved !== 'string') {
          vc.rightSaved = vc.rightContent || '';
        }
        if (html !== vc.rightContent) {
          vc.rightContent = html;
          this._lastRightContent = html;
          this._recomputeDirtyCount();
          this.requestUpdate();
        }
      }
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
   *
   * Before overwriting, stash the original (externalised)
   * href on two data attributes — one per attribute form
   * we might have to restore. `_onEditorChange` reads
   * these back before serialising so saved content and
   * any downstream handoff (the `</>` text-diff toggle,
   * clipboard paste, copy-as-PNG) all see the on-disk
   * form rather than the multi-megabyte inlined form.
   *
   * The original values are preserved verbatim — we don't
   * parse, normalise, or canonicalise. A round-trip
   * through the resolver and back out must be byte-
   * identical to the source, or the file flips dirty on
   * every SVG viewer mount.
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
      // Snapshot the original externalised hrefs. An
      // element may have href, xlink:href, or both — we
      // track each form independently because restoration
      // must preserve exactly the attribute shape the
      // SVG generator produced (some generators use only
      // xlink:href for SVG 1.1 compatibility; others use
      // both).
      const originalHref = imgEl.getAttribute('href');
      if (originalHref !== null) {
        imgEl.setAttribute(
          'data-ac-dc-original-href',
          originalHref,
        );
      }
      const originalXlinkHref = imgEl.getAttributeNS(
        'http://www.w3.org/1999/xlink',
        'href',
      );
      if (originalXlinkHref !== null && originalXlinkHref !== '') {
        imgEl.setAttribute(
          'data-ac-dc-original-xlink-href',
          originalXlinkHref,
        );
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
    // Emit viewbox-changed regardless of mirror state —
    // the shell debounces on its end, and the mutex
    // only guards the left-editor write below. Skipping
    // emit under the mutex would silently drop saves
    // for any viewBox change that originated on the
    // left side and cascaded here (currently impossible
    // — fit and user gestures always hit the right
    // pane in editable mode — but defensive against
    // future paths that could flip which side
    // originates).
    this.dispatchEvent(
      new CustomEvent('viewbox-changed', {
        detail: {
          path: this._activeIndex >= 0
            ? this._files[this._activeIndex]?.path || null
            : null,
          viewBox: {
            x: vb.x,
            y: vb.y,
            width: vb.width,
            height: vb.height,
          },
        },
        bubbles: true,
        composed: true,
      }),
    );
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

  /**
   * Whether the virtual-comparison right pane has
   * unsaved edits. Returns false when no virtual
   * comparison is active or when `rightSaved` hasn't
   * been initialised (no edits since the slot was
   * populated). The right side is the only editable
   * pane — the left is read-only — so dirty tracking
   * only ever applies there.
   */
  _isVirtualDirty() {
    const vc = this._virtualComparison;
    if (!vc) return false;
    if (typeof vc.rightSaved !== 'string') return false;
    return vc.rightContent !== vc.rightSaved;
  }

  _recomputeDirtyCount() {
    let count = this._files.filter((f) => this._isDirty(f)).length;
    if (this._isVirtualDirty()) count += 1;
    this._dirtyCount = count;
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
    if (this._activeIndex >= 0) {
      const file = this._files[this._activeIndex];
      if (!file) return '';
      if (this._isDirty(file)) return 'dirty';
      if (file.isNew) return 'new-file';
      return 'clean';
    }
    // Virtual-comparison mode. The right pane is
    // editable; show dirty when its content has
    // diverged from the snapshot taken on the last
    // save click, otherwise show the new-file blue
    // (the virtual slot has no on-disk counterpart,
    // so "clean" green would be misleading).
    if (this._virtualComparison !== null) {
      if (this._isVirtualDirty()) return 'dirty';
      return 'new-file';
    }
    return '';
  }

  _statusLedTitle() {
    if (this._activeIndex >= 0) {
      const file = this._files[this._activeIndex];
      if (!file) return '';
      const klass = this._statusLedClass();
      if (klass === 'dirty') return `${file.path} — unsaved (click to save)`;
      if (klass === 'new-file') return `${file.path} — new file`;
      return file.path;
    }
    if (this._virtualComparison !== null) {
      const label =
        this._virtualComparison.rightLabel
        || this._virtualComparison.leftLabel
        || 'comparison panel';
      const klass = this._statusLedClass();
      if (klass === 'dirty') {
        return `${label} — unsaved (click to snapshot)`;
      }
      return `${label} — visual comparison (no save target)`;
    }
    return '';
  }

  _onStatusLedClick() {
    if (this._activeIndex >= 0) {
      const file = this._files[this._activeIndex];
      if (!file) return;
      if (this._isDirty(file)) {
        this._saveFile(file.path);
        return;
      }
      // Clean file — reveal in the file picker. Mirrors
      // the diff viewer's LED behaviour so the affordance
      // is consistent across viewers.
      this.dispatchEvent(
        new CustomEvent('reveal-file-in-picker', {
          detail: { path: file.path },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }
    // Virtual-comparison mode. There's no on-disk
    // target for the edited right pane, so "save"
    // means snapshot the current content as the new
    // baseline (clearing the dirty state) and emit a
    // `virtual-svg-save` event carrying the content
    // for any consumer that wants to capture it. The
    // toast confirms the user's edits were captured
    // even though no file was written.
    const vc = this._virtualComparison;
    if (!vc) return;
    if (!this._isVirtualDirty()) return;
    vc.rightSaved = vc.rightContent;
    this._recomputeDirtyCount();
    this.dispatchEvent(
      new CustomEvent('virtual-svg-save', {
        detail: {
          content: vc.rightContent,
          label: vc.rightLabel || vc.leftLabel || '',
        },
        bubbles: true,
        composed: true,
      }),
    );
    this._emitToast(
      'Visual edits snapshotted (no file target)',
      'info',
    );
  }

  // ---------------------------------------------------------------
  // Presentation mode
  // ---------------------------------------------------------------

  _togglePresentation() {
    if (this._activeIndex < 0) return;
    this._mode =
      this._mode === _MODE_PRESENT ? _MODE_SELECT : _MODE_PRESENT;
    this._contextMenu = null;
    // Fire the presentation-changed event so the shell
    // saves the new mode immediately. Matches the
    // preview-mode-changed pattern — a reload right
    // after a toggle-then-nothing restores the correct
    // layout rather than the stale pre-toggle one.
    this.dispatchEvent(
      new CustomEvent('svg-presentation-changed', {
        detail: {
          path: this._files[this._activeIndex]?.path || null,
          presentation: this._mode === _MODE_PRESENT,
        },
        bubbles: true,
        composed: true,
      }),
    );
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
  // Copy as SVG
  // ---------------------------------------------------------------

  /**
   * Copy the current modified SVG to the clipboard as a
   * multi-format payload — `image/png` (rendered raster)
   * plus `image/svg+xml` (source). Chat applications and
   * image-aware paste targets pick the PNG and render the
   * image inline; SVG-aware editors (Inkscape, browsers)
   * pick the SVG source. This matches the spec's intent
   * for "Copy as SVG" — the user wants an *image* on the
   * clipboard, not the XML text.
   *
   * The PNG side reuses the same render pipeline as
   * `_copyAsPng` (parse viewBox, scale for quality, draw
   * to canvas, blob). The SVG side uses the serialised
   * form `_onEditorChange` produces — handle overlay
   * stripped, pan-zoom viewport unwrapped, inlined data-
   * URI hrefs swapped back to their externalised on-disk
   * paths. So a paste into a code editor (which falls
   * through to text/plain when the target doesn't grok
   * either MIME type) still gives clean SVG source.
   *
   * Calling `_onEditorChange` first guarantees
   * `file.modified` is current — there may be
   * uncommitted edits in the SvgEditor that haven't been
   * serialised yet.
   *
   * Falls back to text-only `writeText` when
   * `ClipboardItem` is unavailable (older browsers, non-
   * secure contexts).
   */
  async _copyAsSvg() {
    this._contextMenu = null;
    if (this._activeIndex < 0) return;
    const file = this._files[this._activeIndex];
    if (!file) return;
    // Refresh file.modified from the live editor state.
    // Idempotent — re-reads the same bytes when nothing
    // has changed since the last commit.
    this._onEditorChange();
    const svgText = file.modified || '';
    if (!svgText) {
      this._emitToast('Nothing to copy', 'info');
      return;
    }
    if (!navigator.clipboard) {
      this._emitToast('Clipboard not available', 'error');
      return;
    }
    // Preferred path: ClipboardItem with both PNG and
    // SVG MIME types. Receiving app picks whichever it
    // understands.
    if (
      typeof navigator.clipboard.write === 'function' &&
      typeof ClipboardItem !== 'undefined'
    ) {
      try {
        const pngBlob = await this._renderSvgToPngBlob(svgText);
        const svgBlob = new Blob([svgText], {
          type: 'image/svg+xml',
        });
        const item = new ClipboardItem({
          'image/png': pngBlob,
          'image/svg+xml': svgBlob,
        });
        await navigator.clipboard.write([item]);
        this._emitToast('Image copied to clipboard', 'success');
        return;
      } catch (err) {
        // Fall through to text-only writeText. Common
        // failure modes: ClipboardItem MIME-type rejection
        // (some browsers gate non-image types behind a
        // flag), document not focused, render failure
        // (malformed SVG). Logging for diagnosis; user
        // gets a working text fallback.
        console.warn('[svg-viewer] image copy failed', err);
      }
    }
    // Fallback: text-only.
    if (typeof navigator.clipboard.writeText !== 'function') {
      this._emitToast('Clipboard not available', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(svgText);
      this._emitToast('SVG source copied as text', 'info');
    } catch (err) {
      this._emitToast(
        `Failed to copy: ${err?.message || 'unknown error'}`,
        'error',
      );
    }
  }

  /**
   * Render an SVG string to an `image/png` Blob. Shared
   * pipeline between `_copyAsSvg` (which combines this
   * with the SVG source for a multi-format clipboard
   * item) and any future raster export. Returns a Blob
   * ready to drop into a `ClipboardItem`.
   *
   * Frames the output to match the right editor's
   * current viewBox — what the user actually sees on
   * screen — rather than the SVG's authored
   * viewBox/width/height. After fit-to-content, pan/zoom,
   * or presentation toggle, the live viewBox can differ
   * substantially from the authored one; rendering against
   * the authored frame produces a PNG with mismatched
   * margins (extra whitespace, or content cropped). We
   * clone the parsed SVG, overwrite its viewBox with the
   * live one, force `preserveAspectRatio="xMidYMid meet"`
   * so the renderer doesn't stretch (the live editor uses
   * `none` for its own coordinate math, but a standalone
   * raster wants the natural aspect), and re-serialise
   * before handing to the Image loader.
   *
   * Throws on render failure — caller decides whether to
   * fall back to text-only or surface an error. The PNG
   * pipeline can fail when the SVG references resources
   * the renderer can't resolve (cross-origin images,
   * tainted canvas). The error message is opaque on
   * purpose; callers handle by falling through.
   */
  async _renderSvgToPngBlob(svgText) {
    // Parse the SVG into a fresh document so we can
    // mutate its root attributes without affecting the
    // live editor.
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    // Default frame from the authored SVG. Used when no
    // live editor is attached (defensive — `_copyAsSvg`
    // already gates on activeIndex, but the helper is
    // self-contained).
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
    // Determine the rendering frame. Priority order:
    //
    //   1. Content bbox of the live right-pane SVG. The
    //      editor's viewBox is sized to the container's
    //      aspect ratio (after fitContent), which means
    //      it carries letterbox padding around the
    //      actual content. Rendering against that
    //      viewBox produces a PNG with visible margins
    //      above/below or left/right of the content.
    //      Reading `getBBox()` on the live SVG root
    //      gives the tight content extent — which is
    //      what the user wants on the clipboard.
    //
    //   2. The editor's reported viewBox. Used when the
    //      bbox read fails (detached element, malformed
    //      SVG) but the editor is still alive. May
    //      include letterbox padding but at least
    //      reflects pan/zoom state.
    //
    //   3. The authored viewBox/width/height already
    //      parsed above. Fallback for the no-editor
    //      case.
    let liveVb = null;
    const rightContainer = this.shadowRoot?.querySelector(
      '.pane-right .svg-container',
    );
    const liveSvg = rightContainer
      ? rightContainer.querySelector('svg')
      : null;
    if (liveSvg && typeof liveSvg.getBBox === 'function') {
      try {
        const bbox = liveSvg.getBBox();
        if (
          bbox && Number.isFinite(bbox.width)
          && Number.isFinite(bbox.height)
          && bbox.width > 0 && bbox.height > 0
        ) {
          // Add a small margin so glyphs at the bbox
          // edge don't get clipped by sub-pixel
          // rendering rounding. 2% of the longer edge
          // is invisible on small content and adds at
          // most a few pixels on large.
          const pad = Math.max(bbox.width, bbox.height) * 0.02;
          liveVb = {
            x: bbox.x - pad,
            y: bbox.y - pad,
            width: bbox.width + pad * 2,
            height: bbox.height + pad * 2,
          };
        }
      } catch (_) {
        liveVb = null;
      }
    }
    if (!liveVb && this._editorRight) {
      try {
        liveVb = this._editorRight.getViewBox();
      } catch (_) {
        liveVb = null;
      }
    }
    if (
      liveVb
      && Number.isFinite(liveVb.x)
      && Number.isFinite(liveVb.y)
      && Number.isFinite(liveVb.width)
      && Number.isFinite(liveVb.height)
      && liveVb.width > 0
      && liveVb.height > 0
      && svgEl
    ) {
      svgEl.setAttribute(
        'viewBox',
        `${liveVb.x} ${liveVb.y} ${liveVb.width} ${liveVb.height}`,
      );
      // The live editor sets preserveAspectRatio="none" so
      // its viewBox writes drive coordinate math directly.
      // Standalone raster output should fit naturally —
      // override to "xMidYMid meet" so the renderer
      // letterboxes rather than stretching.
      svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      // Strip declared width/height so the browser uses
      // the viewBox as the intrinsic size. Without this,
      // the authored width/height would override and we'd
      // be back to the original mismatch.
      svgEl.removeAttribute('width');
      svgEl.removeAttribute('height');
      width = liveVb.width;
      height = liveVb.height;
    }
    // Re-serialise with the (possibly mutated) root.
    const serializer = new XMLSerializer();
    const renderText = serializer.serializeToString(doc);
    // Scale for quality. Same heuristic as `_copyAsPng`:
    // tiny SVGs get 4x oversampling for crisp text;
    // larger SVGs get 2x; clamp the long edge to 4096
    // so we don't allocate gigabyte canvases.
    const maxDim = Math.max(width, height);
    let scale = maxDim < 1024 ? 4 : 2;
    const maxPx = 4096;
    if (maxDim * scale > maxPx) {
      scale = maxPx / maxDim;
    }
    const canvasWidth = Math.round(width * scale);
    const canvasHeight = Math.round(height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    const blob = new Blob([renderText], {
      type: 'image/svg+xml;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });
      ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
    } finally {
      URL.revokeObjectURL(url);
    }
    return await new Promise((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error('canvas.toBlob returned null'));
      }, 'image/png');
    });
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
    // No content at all — neither a real file nor a
    // virtual comparison. Nothing to act on.
    if (this._activeIndex < 0 && this._virtualComparison === null) {
      return;
    }
    // Gate shortcuts on whether the SVG viewer is the
    // foreground viewer. Focus typically lives in the
    // chat textarea regardless of which viewer is
    // active, so a composedPath check would never
    // match and Ctrl+S would fall through to the
    // browser's default Save Page action.
    //
    // The app shell adds `viewer-visible` to whichever
    // of the diff / SVG viewers is currently front. We
    // use that as the authority for shortcut ownership:
    // when the SVG viewer is front, Ctrl+S saves the
    // active SVG; when it isn't, the diff viewer's own
    // shortcut handler (which lives inside Monaco) wins.
    const isForeground = this.classList.contains('viewer-visible');
    // F11 toggles presentation mode (no Ctrl needed).
    if (event.key === 'F11') {
      if (isForeground) {
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
      if (isForeground) {
        event.preventDefault();
        this._togglePresentation();
      }
      return;
    }
    const ctrl = event.ctrlKey || event.metaKey;
    if (!ctrl) return;
    if (!isForeground) return;
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
      if (this._activeIndex >= 0) {
        const file = this._files[this._activeIndex];
        if (file) this._saveFile(file.path);
      } else if (this._virtualComparison !== null) {
        // Virtual mode — route through the LED click
        // handler so Ctrl+S and the LED affordance share
        // one save semantics (snapshot + event + toast).
        this._onStatusLedClick();
      }
      return;
    }
    if (event.key === 'w' || event.key === 'W') {
      event.preventDefault();
      if (this._activeIndex >= 0) {
        const file = this._files[this._activeIndex];
        if (file) this.closeFile(file.path);
      } else if (this._virtualComparison !== null) {
        // Closing in virtual mode discards both panes'
        // content. The slot is cleared and the viewer
        // returns to empty state — same lifecycle as
        // closing the last real file.
        this._virtualComparison = null;
        this._lastLeftContent = null;
        this._lastRightContent = null;
        this._disposeEditors();
        this._mode = _MODE_SELECT;
        this._contextMenu = null;
        this._recomputeDirtyCount();
        this._dispatchActiveFileChanged();
        this.requestUpdate();
      }
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
    // Resolve the path to report. Real file: use its
    // path. Virtual comparison: synthesise a path-like
    // identifier from the labels so the shell's
    // `onActiveFileChanged` doesn't early-return on a
    // null path and skip foregrounding the SVG viewer.
    // The synthesised string starts with `virtual://`
    // so any consumer that wants to disambiguate real
    // vs virtual can check the prefix.
    let path = null;
    if (this._activeIndex >= 0) {
      const activeFile = this._files[this._activeIndex];
      path = activeFile ? activeFile.path : null;
    } else if (this._virtualComparison !== null) {
      const left = this._virtualComparison.leftLabel || '';
      const right = this._virtualComparison.rightLabel || '';
      const tag = right || left || 'panel';
      path = `virtual://svg-compare/${tag}`;
    }
    this.dispatchEvent(
      new CustomEvent('active-file-changed', {
        detail: { path },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  render() {
    // Empty state requires both no real file AND no
    // virtual comparison. The two slots are mutually
    // exclusive but either being populated is enough to
    // render the split layout.
    const hasRealFile =
      this._files.length > 0 && this._activeIndex >= 0;
    const hasVirtual = this._virtualComparison !== null;
    if (!hasRealFile && !hasVirtual) {
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
              <button
                class="context-menu-item"
                role="menuitem"
                @click=${this._copyAsSvg}
              >
                📄 Copy as SVG
              </button>
              ${this._canSnapToAxis()
                ? html`
                    <div class="context-menu-divider"></div>
                    <button
                      class="context-menu-item"
                      role="menuitem"
                      title="Snap line to horizontal"
                      @click=${() => this._onSnapToAxis('horizontal')}
                    >
                      ━ Make horizontal
                    </button>
                    <button
                      class="context-menu-item"
                      role="menuitem"
                      title="Snap line to vertical"
                      @click=${() => this._onSnapToAxis('vertical')}
                    >
                      ┃ Make vertical
                    </button>
                  `
                : ''}
              ${this._canAlign()
                ? html`
                    <div class="context-menu-divider"></div>
                    <div class="context-menu-section-label">
                      Align horizontal
                    </div>
                    <div class="align-grid" role="group" aria-label="Align horizontal">
                      <button
                        class="align-btn"
                        title="Align left edges"
                        aria-label="Align left edges"
                        @click=${() => this._onAlign('horizontal', 'left')}
                      >⇤</button>
                      <button
                        class="align-btn"
                        title="Align horizontal centers"
                        aria-label="Align horizontal centers"
                        @click=${() => this._onAlign('horizontal', 'center')}
                      >⇔</button>
                      <button
                        class="align-btn"
                        title="Align right edges"
                        aria-label="Align right edges"
                        @click=${() => this._onAlign('horizontal', 'right')}
                      >⇥</button>
                    </div>
                    <div class="context-menu-section-label">
                      Align vertical
                    </div>
                    <div class="align-grid" role="group" aria-label="Align vertical">
                      <button
                        class="align-btn"
                        title="Align top edges"
                        aria-label="Align top edges"
                        @click=${() => this._onAlign('vertical', 'top')}
                      >⤒</button>
                      <button
                        class="align-btn"
                        title="Align vertical middles"
                        aria-label="Align vertical middles"
                        @click=${() => this._onAlign('vertical', 'middle')}
                      >⇕</button>
                      <button
                        class="align-btn"
                        title="Align bottom edges"
                        aria-label="Align bottom edges"
                        @click=${() => this._onAlign('vertical', 'bottom')}
                      >⤓</button>
                    </div>
                  `
                : ''}
            </div>
          `
        : ''}
    `;
  }

  /**
   * Whether the alignment section should appear in the
   * context menu. Requires the right (editable) editor
   * to be live AND at least two selected elements —
   * single-element alignment has no group reference and
   * the editor itself no-ops on it, so we hide the UI
   * rather than show disabled buttons.
   */
  _canAlign() {
    if (!this._editorRight) return false;
    try {
      return this._editorRight.getSelectionSet().size >= 2;
    } catch (_) {
      return false;
    }
  }

  /**
   * Whether the snap-to-axis entries should appear.
   * The editor's own `canSnapSelectionToAxis` checks
   * for exactly-one selection of a snappable shape
   * (line, two-point polyline, or single-segment
   * straight path).
   */
  _canSnapToAxis() {
    if (!this._editorRight) return false;
    try {
      return this._editorRight.canSnapSelectionToAxis();
    } catch (_) {
      return false;
    }
  }

  /**
   * Context-menu snap-to-axis click. Delegates to the
   * editor and lets its onChange callback handle
   * dirty-tracking + re-render. Same dispatch shape as
   * `_onAlign`.
   */
  _onSnapToAxis(axis) {
    if (!this._editorRight) return;
    this._contextMenu = null;
    try {
      this._editorRight.snapSelectionToAxis(axis);
    } catch (err) {
      console.warn('[svg-viewer] snapSelectionToAxis failed', err);
    }
    this.requestUpdate();
  }

  /**
   * Context-menu alignment click. Dispatches to the
   * editor's `alignSelection`, dismisses the menu, and
   * lets the editor's own onChange callback handle
   * dirty-tracking and re-render — same path as drag,
   * delete, paste.
   */
  _onAlign(axis, mode) {
    if (!this._editorRight) return;
    this._contextMenu = null;
    try {
      this._editorRight.alignSelection(axis, mode);
    } catch (err) {
      console.warn('[svg-viewer] alignSelection failed', err);
    }
    this.requestUpdate();
  }
}

customElements.define('ac-svg-viewer', SvgViewer);