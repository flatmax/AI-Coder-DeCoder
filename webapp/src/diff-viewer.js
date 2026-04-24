// DiffViewer — Monaco-based side-by-side diff editor.
//
// Layer 5 Phase 3.1a — the core viewer. Replaces Phase 3
// groundwork's stub with a real Monaco DiffEditor.
//
// Scope of this commit:
//   - Multi-file tracking (open/close/switch, internal tab
//     state with no visible tab bar per specs4)
//   - Same-file suppression and concurrent-openFile guard
//   - HEAD + working-copy content fetching via Repo RPCs
//   - Per-file dirty tracking with Ctrl+S / batch save
//   - Status LED floating overlay (clean / dirty / new)
//   - Per-file viewport state (scroll + cursor restoration)
//   - loadPanel() for ad-hoc comparisons via virtual://
//     paths (history browser's context menu, Phase 2e.4)
//   - Virtual file content (read-only, passed through
//     openFile's virtualContent option)
//   - Language detection via monaco-setup's languageForPath
//   - Shadow DOM style synchronization for Monaco's styles
//     (full re-sync on editor creation + MutationObserver
//     for dynamic additions; both needed per specs4)
//   - Keyboard shortcuts: Ctrl+S, Ctrl+W, Ctrl+PageUp/Down
//
// Deferred to follow-up sub-phases:
//   - 3.1b: Markdown preview with bidirectional scroll sync
//   - 3.1c: TeX preview via make4ht + KaTeX
//   - 3.1d: LSP integration (hover/definition/refs/completions)
//   - 3.1e: Markdown link provider for Ctrl+click navigation
//
// Governing spec: specs4/5-webapp/diff-viewer.md
//
// Architectural contracts pinned by this commit:
//
//   - **Worker configuration must install before editor
//     construction.** monaco-setup.js side-effect runs at
//     module load; importing it here before any
//     monaco-editor use ensures the global env is set up.
//
//   - **Editor reuse, not recreation.** A single DiffEditor
//     handles all open files. Switching files disposes old
//     models and creates new ones on the existing editor.
//     Prevents memory leaks and avoids the ~300ms cost of
//     recreating the editor on every tab switch. The editor
//     is only fully disposed when the last file closes.
//
//   - **Model disposal order: setModel first, then dispose.**
//     Disposing a model while it's still attached to the
//     editor throws "TextModel got disposed before
//     DiffEditorWidget model got reset". Capture refs →
//     setModel to new pair → dispose old pair.
//
//   - **Concurrent openFile guard.** openFile is async
//     (fetches content). Multiple rapid calls for the same
//     path must not interleave model construction. An
//     `_openingPath` field drops duplicate concurrent
//     invocations for the same path.
//
//   - **Content-addressed virtual files.** virtual://
//     paths (e.g., virtual://compare from loadPanel) have
//     no filesystem backing. Content is held in a Map and
//     short-circuited in the content-fetch path.
//
//   - **Viewport state survives tab switch.** Before
//     switching away from a file, capture {scrollTop,
//     scrollLeft, line, column}. On switch back, restore
//     after the diff computation settles (one-shot
//     onDidUpdateDiff listener + 2s fallback timeout for
//     identical-content case).

import { LitElement, css, html } from 'lit';

// Import monaco-setup first — its module-level side
// effects (worker env, MATLAB registration) must run
// before any editor construction.
import { languageForPath, monaco } from './monaco-setup.js';
import {
  renderMarkdownWithSourceMap,
  resolveRelativePath,
} from './markdown-preview.js';
import { SharedRpc } from './rpc.js';

// KaTeX CSS — imported as a raw string via Vite's ?raw
// loader. Injected into the shadow root (not document
// head) because Monaco's style-cloning loop only sees
// styles in document.head, and this one isn't. Without
// this, math in preview renders unstyled (fractions flat,
// superscripts inline).
//
// In environments where the ?raw import doesn't resolve
// to a string (vitest under some resolver configurations,
// or stripped-down bundles), we fall back to a minimal
// sentinel stylesheet. The injection mechanism still runs
// so test coverage and shadow-DOM integration work
// identically; math just renders unstyled in those
// environments, matching the no-CSS fallback the guard
// used to produce.
import _rawKatexCss from 'katex/dist/katex.min.css?raw';
const katexCssText =
  typeof _rawKatexCss === 'string' && _rawKatexCss
    ? _rawKatexCss
    : '/* ac-dc KaTeX CSS placeholder — raw import unavailable */';

/**
 * Virtual path prefix. Files with this prefix are
 * content-addressed (content passed via openFile's
 * virtualContent option) and are always read-only.
 */
const _VIRTUAL_PREFIX = 'virtual://';

/**
 * How long to wait for Monaco's async diff computation
 * before giving up on viewport restoration. Identical
 * content never fires onDidUpdateDiff, so the timeout
 * prevents the restore from hanging forever. Matches
 * specs4's 2 second recommendation.
 */
const _DIFF_READY_TIMEOUT_MS = 2000;

/**
 * How long to show the scroll-to-edit highlight decoration
 * after a search-text match is found.
 */
const _HIGHLIGHT_DURATION_MS = 3000;

/**
 * Dataset marker for shadow-DOM-cloned styles. Lets us
 * find and remove prior clones without touching styles
 * from other shadow-DOM consumers.
 */
const _CLONED_STYLE_MARKER = 'acDcMonacoClone';

/**
 * Dataset marker for the KaTeX stylesheet injected into
 * the shadow root when preview mode activates. Separate
 * from the Monaco-clone marker so the style-sync loop
 * doesn't touch it.
 */
const _KATEX_CSS_MARKER = 'acDcKatexCss';

/**
 * How long the scroll-sync lock stays held after one
 * side initiates a scroll. During this window the other
 * side's scroll handler skips (prevents feedback loops).
 * Long enough to cover Monaco's smooth-scroll animation,
 * short enough that genuine user scrolling isn't
 * suppressed.
 */
const _SCROLL_LOCK_MS = 120;

export class DiffViewer extends LitElement {
  static properties = {
    _files: { type: Array, state: true },
    _activeIndex: { type: Number, state: true },
    /** Dirty state per file — drives the status LED. */
    _dirtyCount: { type: Number, state: true },
    /**
     * Preview mode flag — when true AND the active file
     * is markdown, the layout switches from side-by-side
     * diff to split editor+preview. Toggled via the
     * Preview button in the overlay.
     */
    _previewMode: { type: Boolean, state: true },
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

    .editor-container {
      flex: 1;
      min-height: 0;
      width: 100%;
      position: relative;
    }

    /* Status LED — floating overlay in the top-right
     * corner. Click to save when dirty. */
    .status-led {
      position: absolute;
      top: 12px;
      right: 16px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      cursor: pointer;
      z-index: 10;
      transition: transform 120ms ease, box-shadow 120ms ease;
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

    /* Floating panel labels for loadPanel comparisons. */
    .panel-label {
      position: absolute;
      top: 12px;
      padding: 0.2rem 0.55rem;
      font-size: 0.75rem;
      font-family: 'SFMono-Regular', Consolas, monospace;
      background: rgba(22, 27, 34, 0.78);
      color: var(--text-secondary, #8b949e);
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 3px;
      backdrop-filter: blur(4px);
      z-index: 5;
      pointer-events: none;
      transition: opacity 120ms ease;
    }
    .panel-label.left {
      right: calc(50% + 8px);
    }
    .panel-label.right {
      right: 120px;
    }

    /* Preview button — floats near the status LED in
     * normal mode, moves to the preview pane's top-right
     * in split mode so the user can exit preview from
     * the panel they're reading. */
    .preview-button {
      position: absolute;
      top: 8px;
      right: 46px;
      z-index: 10;
      padding: 0.25rem 0.6rem;
      font-size: 0.75rem;
      font-family: inherit;
      background: rgba(22, 27, 34, 0.88);
      color: var(--text-primary, #c9d1d9);
      border: 1px solid rgba(240, 246, 252, 0.2);
      border-radius: 4px;
      cursor: pointer;
      backdrop-filter: blur(4px);
    }
    .preview-button:hover {
      background: rgba(240, 246, 252, 0.12);
      border-color: rgba(240, 246, 252, 0.35);
    }
    .preview-button-split {
      right: 46px;
    }

    /* Split layout for preview mode. Editor on the left,
     * preview on the right, equal width. */
    .split-root {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: row;
      width: 100%;
      position: relative;
    }
    .editor-pane {
      flex: 1 1 50%;
      min-width: 0;
      min-height: 0;
      display: flex;
      flex-direction: column;
      border-right: 1px solid rgba(240, 246, 252, 0.1);
    }
    .editor-pane .editor-container {
      flex: 1;
      min-height: 0;
    }
    .preview-pane {
      flex: 1 1 50%;
      min-width: 0;
      min-height: 0;
      overflow-y: auto;
      padding: 1rem 1.5rem;
      color: var(--text-primary, #c9d1d9);
      font-size: 0.9375rem;
      line-height: 1.55;
    }
    .preview-pane h1,
    .preview-pane h2,
    .preview-pane h3,
    .preview-pane h4,
    .preview-pane h5,
    .preview-pane h6 {
      margin-top: 1.5rem;
      margin-bottom: 0.5rem;
      font-weight: 600;
    }
    .preview-pane p {
      margin: 0.75rem 0;
    }
    .preview-pane code {
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 0.875em;
      background: rgba(13, 17, 23, 0.6);
      border-radius: 3px;
      padding: 0.1rem 0.35rem;
    }
    .preview-pane pre {
      background: rgba(13, 17, 23, 0.9);
      border: 1px solid rgba(240, 246, 252, 0.1);
      border-radius: 6px;
      padding: 0.75rem;
      overflow-x: auto;
      margin: 0.75rem 0;
    }
    .preview-pane pre code {
      background: transparent;
      padding: 0;
    }
    .preview-pane blockquote {
      border-left: 3px solid rgba(240, 246, 252, 0.2);
      padding-left: 0.75rem;
      margin: 0.75rem 0;
      color: var(--text-secondary, #8b949e);
    }
    .preview-pane table {
      border-collapse: collapse;
      margin: 0.75rem 0;
    }
    .preview-pane th,
    .preview-pane td {
      border: 1px solid rgba(240, 246, 252, 0.15);
      padding: 0.35rem 0.6rem;
    }

    /* Highlight decoration for scroll-to-edit anchor
     * matches. Applied via Monaco's deltaDecorations API
     * — the class here just defines the visual. */
    :host ::ng-deep .highlight-decoration,
    :host .highlight-decoration {
      background: rgba(79, 195, 247, 0.18);
      border-left: 2px solid var(--accent-primary, #58a6ff);
    }
  `;

  constructor() {
    super();
    this._files = [];
    this._activeIndex = -1;
    this._dirtyCount = 0;
    this._previewMode = false;

    // Monaco editor instance. Created on first openFile,
    // disposed on last closeFile.
    this._editor = null;
    // Element reference for the editor host div, read
    // from the shadow root after Lit renders.
    this._editorContainer = null;
    // Preview pane element — the right side of the split
    // layout in preview mode. Populated after Lit renders
    // the split template. Preview HTML is written to this
    // element's innerHTML directly (not via Lit) so every
    // keystroke doesn't re-render the whole component.
    this._previewPane = null;
    // Virtual-file content map. Keyed by path starting
    // with virtual://.
    this._virtualContents = new Map();
    // Per-file viewport state (scrollTop/scrollLeft/
    // lineNumber/column). Not persisted — session-only.
    this._viewportStates = new Map();
    // Per-file panel labels (from loadPanel's label
    // parameter). `{left, right}` entries.
    this._panelLabels = new Map();
    // Concurrent-openFile guard. Holds the path that is
    // currently being opened asynchronously; duplicate
    // calls for the same path drop silently.
    this._openingPath = null;
    // Current highlight decorations (cleared on next
    // highlight or on file switch).
    this._highlightDecorations = [];
    this._highlightTimer = null;
    // Content-change listener disposable. Attached per
    // editor instance lifetime.
    this._contentChangeDisposable = null;
    // Editor scroll listener disposable — only attached
    // in preview mode so we don't pay for scroll events
    // on every file, only markdown files under preview.
    this._editorScrollDisposable = null;
    // Scroll-sync lock. 'editor' or 'preview' identifies
    // which side initiated the scroll; the other side's
    // handler skips until the lock clears. null = free.
    this._scrollLock = null;
    this._scrollLockTimer = null;
    // Preview pane scroll listener, bound for add/remove
    // symmetry.
    this._onPreviewScroll = this._onPreviewScroll.bind(this);
    // MutationObserver for shadow-DOM style sync after
    // editor creation.
    this._styleObserver = null;
    // Whether we've patched the code-editor-service's
    // openCodeEditor method. Component-level flag (not
    // per-editor) to avoid chaining override closures
    // across editor recreations — specs4 calls this out
    // explicitly.
    this._editorServicePatched = false;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onContentChange = this._onContentChange.bind(this);
    this._onHeadMutation = this._onHeadMutation.bind(this);
    this._onEditorScroll = this._onEditorScroll.bind(this);
    this._onPreviewClick = this._onPreviewClick.bind(this);
    // Image-resolution generation counter. Bumped on
    // every _updatePreview call so in-flight fetches from
    // a previous render can detect they're stale and skip
    // DOM writes. Without this, rapid keystrokes produce
    // a race where a slow fetch from render N overwrites
    // the DOM populated by render N+1.
    this._imageResolveGeneration = 0;
  }

  // ---------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------

  connectedCallback() {
    super.connectedCallback();
    // Keyboard shortcuts on document so they work
    // regardless of which element has focus inside the
    // editor (Monaco captures most key events itself, but
    // Ctrl+S / Ctrl+W / Ctrl+PageDown we route ourselves).
    document.addEventListener('keydown', this._onKeyDown);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKeyDown);
    this._disposeStyleObserver();
    this._disposeEditor();
    if (this._highlightTimer) {
      clearTimeout(this._highlightTimer);
      this._highlightTimer = null;
    }
    super.disconnectedCallback();
  }

  updated(changedProps) {
    super.updated?.(changedProps);
    // When files go non-empty, the editor container
    // appears in the DOM; wire it up.
    if (
      this._files.length > 0 &&
      this._activeIndex >= 0 &&
      !this._editorContainer
    ) {
      this._editorContainer =
        this.shadowRoot?.querySelector('.editor-container') || null;
    }
    // When files go empty, drop the container ref so the
    // next open re-resolves it.
    if (this._files.length === 0 && this._editorContainer) {
      this._editorContainer = null;
    }
  }

  // ---------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------

  /**
   * Open or switch to a file. Fetches content if not
   * already provided.
   *
   * Options:
   *   path        — repo-relative or virtual:// path
   *   line        — optional, scroll to this line after open
   *   searchText  — optional, scroll to and highlight this text
   *   virtualContent — for virtual:// paths, the content to display
   *
   * Concurrent calls for the same path are dropped. Calls
   * for a different path while another open is in flight
   * proceed independently.
   */
  async openFile(opts) {
    if (!opts || typeof opts.path !== 'string' || !opts.path) {
      return;
    }
    const { path, virtualContent } = opts;
    // Same-file suppression — re-opening the current
    // active file is a no-op (preserves scroll, cursor,
    // dirty state).
    const existing = this._files.findIndex((f) => f.path === path);
    if (existing !== -1 && existing === this._activeIndex) {
      // But honour scroll/search requests on the same file.
      if (opts.line != null) this._scrollToLine(opts.line);
      if (opts.searchText) this._scrollToSearchText(opts.searchText);
      return;
    }
    // Concurrent-open guard for the same path.
    if (this._openingPath === path) return;
    this._openingPath = path;
    try {
      await this._openFileInner(opts);
    } finally {
      this._openingPath = null;
    }
    // Apply line/search after content is in place.
    if (opts.line != null) this._scrollToLine(opts.line);
    if (opts.searchText) this._scrollToSearchText(opts.searchText);
  }

  /**
   * Close a single file. Disposes its models. Switches to
   * the next file or clears the active state if empty.
   */
  closeFile(path) {
    const idx = this._files.findIndex((f) => f.path === path);
    if (idx === -1) return;
    const wasActive = idx === this._activeIndex;
    // Clean up virtual content if applicable.
    if (path.startsWith(_VIRTUAL_PREFIX)) {
      this._virtualContents.delete(path);
    }
    // Drop viewport and panel-label state for this file.
    this._viewportStates.delete(path);
    this._panelLabels.delete(path);

    const newFiles = [
      ...this._files.slice(0, idx),
      ...this._files.slice(idx + 1),
    ];
    this._files = newFiles;
    if (newFiles.length === 0) {
      this._activeIndex = -1;
      // Last file — dispose the editor entirely. Releases
      // Monaco's resources and lets the empty-state
      // watermark render cleanly.
      this._disposeEditor();
      this._recomputeDirtyCount();
      // Preview mode is per-file; reset so the next file
      // opened (if any) starts in normal diff view.
      this._previewMode = false;
      this._previewPane = null;
    } else if (wasActive) {
      // Clamp to remaining range; switch to adjacent file.
      this._activeIndex = Math.min(idx, newFiles.length - 1);
      // If the next active file isn't markdown, exit
      // preview mode so the layout falls back to side-by-
      // side diff. _showEditor below picks up the new
      // mode via the template re-render.
      const nextFile = this._files[this._activeIndex];
      if (this._previewMode && !this._isMarkdownFile(nextFile)) {
        this._previewMode = false;
        this._previewPane = null;
        this._disposeEditor();
        this._editorContainer = null;
      }
      this._showEditor();
    } else if (idx < this._activeIndex) {
      this._activeIndex -= 1;
    }
    this._recomputeDirtyCount();
    this._dispatchActiveFileChanged();
  }

  /**
   * Refresh all open non-virtual files by re-fetching
   * their HEAD + working copy. Preserves the active file
   * and its viewport. Used after edits land.
   */
  async refreshOpenFiles() {
    const paths = this._files
      .map((f) => f.path)
      .filter((p) => !p.startsWith(_VIRTUAL_PREFIX));
    for (const path of paths) {
      const fetched = await this._fetchFileContent(path);
      if (!fetched) continue;
      const file = this._files.find((f) => f.path === path);
      if (!file) continue; // closed during refetch
      file.original = fetched.original;
      file.modified = fetched.modified;
      file.savedContent = fetched.modified;
      file.isNew = fetched.isNew;
    }
    // Rebuild the active editor with refreshed content.
    if (this._activeIndex >= 0) {
      this._showEditor();
    }
    this._recomputeDirtyCount();
  }

  /** Paths of files with unsaved modifications. */
  getDirtyFiles() {
    return this._files.filter((f) => this._isDirty(f)).map((f) => f.path);
  }

  /** Save all dirty files. */
  async saveAll() {
    for (const file of [...this._files]) {
      if (this._isDirty(file)) {
        await this._saveFile(file.path);
      }
    }
  }

  /**
   * Load arbitrary content into one of the panels for
   * ad-hoc comparison. If no file is open, creates a
   * virtual file at virtual://compare. If a virtual
   * comparison already exists, updates only the specified
   * panel so both sides accumulate independently. If a
   * real file is open, updates that file's panel model.
   *
   * Used by the history browser's context menu
   * (specs4/5-webapp/chat.md#history-browser → load in
   * left/right panel).
   */
  async loadPanel(content, panel, label) {
    if (panel !== 'left' && panel !== 'right') return;
    const text = typeof content === 'string' ? content : '';
    // If no file is open, create a virtual comparison.
    if (this._files.length === 0) {
      const path = `${_VIRTUAL_PREFIX}compare`;
      const original = panel === 'left' ? text : '';
      const modified = panel === 'right' ? text : '';
      // Store content in the virtual map before openFile
      // reads it.
      this._virtualContents.set(path, { original, modified });
      this._setPanelLabel(path, panel, label);
      await this.openFile({ path });
      return;
    }
    // Existing active file.
    if (this._activeIndex < 0) return;
    const file = this._files[this._activeIndex];
    // Special case for an existing virtual comparison —
    // update only the target panel so both sides
    // accumulate across calls.
    if (file.path === `${_VIRTUAL_PREFIX}compare`) {
      if (panel === 'left') file.original = text;
      else file.modified = text;
      file.savedContent = file.modified;
      this._virtualContents.set(file.path, {
        original: file.original,
        modified: file.modified,
      });
    } else {
      // Real file — update the target side only. The
      // non-target side keeps its repo content.
      if (panel === 'left') file.original = text;
      else file.modified = text;
      file.savedContent = file.modified;
    }
    this._setPanelLabel(file.path, panel, label);
    this._showEditor();
    this._recomputeDirtyCount();
  }

  /** Whether any files are currently open. */
  get hasOpenFiles() {
    return this._files.length > 0;
  }

  // ---------------------------------------------------------------
  // Internals — file loading
  // ---------------------------------------------------------------

  async _openFileInner(opts) {
    const { path, virtualContent } = opts;
    const existing = this._files.findIndex((f) => f.path === path);
    if (existing !== -1) {
      // Open but not active — capture current file's
      // viewport, switch.
      this._captureViewport();
      this._activeIndex = existing;
      // If switching to a non-markdown file while preview
      // is on, exit preview so the layout reverts to the
      // normal side-by-side diff.
      this._maybeExitPreviewForActiveFile();
      this._showEditor();
      this._dispatchActiveFileChanged();
      return;
    }
    // New file. Capture the outgoing file's viewport
    // before we rebuild the editor for the new one.
    this._captureViewport();
    let file;
    if (path.startsWith(_VIRTUAL_PREFIX)) {
      // Virtual file — content either passed explicitly
      // or already staged by loadPanel.
      const staged = this._virtualContents.get(path) || {
        original: '',
        modified: virtualContent || '',
      };
      file = {
        path,
        original: staged.original,
        modified: staged.modified,
        savedContent: staged.modified,
        isNew: false,
        isVirtual: true,
      };
      // Ensure the map has current content for reads.
      this._virtualContents.set(path, {
        original: staged.original,
        modified: staged.modified,
      });
    } else {
      const fetched = await this._fetchFileContent(path);
      if (!fetched) return;
      file = {
        path,
        original: fetched.original,
        modified: fetched.modified,
        savedContent: fetched.modified,
        isNew: fetched.isNew,
        isVirtual: false,
      };
    }
    this._files = [...this._files, file];
    this._activeIndex = this._files.length - 1;
    this._maybeExitPreviewForActiveFile();
    this._showEditor();
    this._dispatchActiveFileChanged();
    this._recomputeDirtyCount();
  }

  /**
   * If preview is on but the active file isn't markdown,
   * flip it off and tear down the editor so _showEditor
   * rebuilds in the normal side-by-side layout. No-op
   * otherwise.
   */
  _maybeExitPreviewForActiveFile() {
    if (!this._previewMode) return;
    const file =
      this._activeIndex >= 0 ? this._files[this._activeIndex] : null;
    if (this._isMarkdownFile(file)) return;
    this._previewMode = false;
    this._previewPane = null;
    this._disposeEditor();
    this._editorContainer = null;
  }

  /**
   * Fetch HEAD and working copy content via Repo RPCs.
   * Returns {original, modified, isNew} or null if both
   * fetches fail. Each call is wrapped in its own try/
   * catch so a missing HEAD (new file) doesn't prevent
   * the working copy from loading.
   */
  async _fetchFileContent(path) {
    if (path.startsWith(_VIRTUAL_PREFIX)) {
      const staged = this._virtualContents.get(path);
      if (staged) {
        return {
          original: staged.original,
          modified: staged.modified,
          isNew: false,
        };
      }
      return {
        original: '',
        modified: '(no content)',
        isNew: true,
      };
    }
    // Defer to our RPC helper if the app shell has
    // published SharedRpc. DiffViewer is host-agnostic —
    // we read SharedRpc directly rather than extending
    // RpcMixin, because the viewer lives outside the
    // dialog and is constructed before the shell's
    // microtask-deferred hooks run in test scenarios.
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
      // File missing at HEAD — new file.
      isNew = true;
    }
    try {
      const workingResult = await call['Repo.get_file_content'](path);
      modified = this._extractRpcContent(workingResult);
    } catch (_) {
      // Working copy missing — deleted file or transient
      // error. Leave modified empty.
    }
    return { original, modified, isNew };
  }

  /**
   * Extract content from a Repo.get_file_content RPC
   * response. The RPC may return a plain string or an
   * object with a `content` field; handle both.
   */
  _extractRpcContent(result) {
    if (typeof result === 'string') return result;
    if (
      result &&
      typeof result === 'object' &&
      typeof result.content === 'string'
    ) {
      return result.content;
    }
    // jrpc-oo envelope — single key wrapping the response.
    if (result && typeof result === 'object') {
      const keys = Object.keys(result);
      if (keys.length === 1) {
        return this._extractRpcContent(result[keys[0]]);
      }
    }
    return '';
  }

  /**
   * Look up the SharedRpc call proxy. Returns null when
   * the proxy isn't published (pre-connection, or in
   * tests that don't bother with RPC). An optional
   * `__sharedRpcOverride` on globalThis lets tests
   * inject a proxy without touching the singleton.
   */
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
  // Internals — editor lifecycle
  // ---------------------------------------------------------------

  _showEditor() {
    if (this._activeIndex < 0) return;
    const file = this._files[this._activeIndex];
    // Wait for Lit to commit the template so the editor
    // container div exists.
    const build = () => {
      const container =
        this.shadowRoot?.querySelector('.editor-container');
      if (!container) {
        // Template hasn't settled — retry next frame.
        requestAnimationFrame(build);
        return;
      }
      this._editorContainer = container;
      this._syncAllStyles();
      this._ensureStyleObserver();
      if (!this._editor) {
        this._createEditor();
      } else {
        this._swapModel(file);
      }
      this._restoreViewport(file.path);
      this._setReadOnly(file);
    };
    this.updateComplete.then(build);
  }

  _createEditor() {
    if (!this._editorContainer) return;
    const file = this._files[this._activeIndex];
    if (!file) return;
    try {
      this._editor = monaco.editor.createDiffEditor(
        this._editorContainer,
        {
          theme: 'vs-dark',
          minimap: { enabled: false },
          automaticLayout: true,
          // Side-by-side for normal diff; inline when the
          // preview pane takes the right half of the
          // viewport.
          renderSideBySide: !this._previewMode,
          originalEditable: false,
          readOnly: false,
          scrollBeyondLastLine: false,
        },
      );
      const original = monaco.editor.createModel(
        file.original || '',
        languageForPath(file.path),
      );
      const modified = monaco.editor.createModel(
        file.modified || '',
        languageForPath(file.path),
      );
      this._editor.setModel({ original, modified });
      this._setReadOnly(file);
      this._attachContentChangeListener();
      this._patchCodeEditorService();
    } catch (err) {
      console.error('[diff-viewer] editor creation failed', err);
    }
  }

  _swapModel(file) {
    if (!this._editor) return;
    try {
      const oldModels = this._editor.getModel();
      const newOriginal = monaco.editor.createModel(
        file.original || '',
        languageForPath(file.path),
      );
      const newModified = monaco.editor.createModel(
        file.modified || '',
        languageForPath(file.path),
      );
      // Disposal order: setModel detaches old, then
      // dispose old. Disposing before setModel throws.
      this._editor.setModel({
        original: newOriginal,
        modified: newModified,
      });
      if (oldModels) {
        try { oldModels.original?.dispose(); } catch (_) {}
        try { oldModels.modified?.dispose(); } catch (_) {}
      }
      // Read-only state goes AFTER setModel — inline diff
      // mode can reset it otherwise.
      this._setReadOnly(file);
      this._attachContentChangeListener();
    } catch (err) {
      console.error('[diff-viewer] model swap failed', err);
    }
  }

  _setReadOnly(file) {
    if (!this._editor) return;
    const modifiedEditor = this._getModifiedEditor();
    if (!modifiedEditor) return;
    const readOnly = !!(file?.isVirtual || file?.isReadOnly);
    try {
      modifiedEditor.updateOptions({ readOnly });
    } catch (_) {
      // Older Monaco versions — harmless.
    }
  }

  _getModifiedEditor() {
    if (!this._editor) return null;
    try {
      return this._editor.getModifiedEditor?.() || null;
    } catch (_) {
      return null;
    }
  }

  _attachContentChangeListener() {
    // Dispose any prior listener (we re-attach on every
    // model swap since each model has its own event
    // stream).
    if (this._contentChangeDisposable) {
      try {
        this._contentChangeDisposable.dispose();
      } catch (_) {}
      this._contentChangeDisposable = null;
    }
    const modifiedEditor = this._getModifiedEditor();
    if (!modifiedEditor) return;
    try {
      this._contentChangeDisposable =
        modifiedEditor.onDidChangeModelContent(
          this._onContentChange,
        );
    } catch (_) {
      // Monaco mock without onDidChangeModelContent —
      // harmless in tests that don't exercise dirty
      // tracking.
    }
    // Scroll listener — only useful in preview mode,
    // only attached when preview is active. Otherwise
    // we'd pay for scroll events on every file.
    this._refreshEditorScrollListener();
  }

  /**
   * Attach the editor-scroll listener when preview is on;
   * detach when off. Called from _attachContentChangeListener
   * (new editor / model swap) and from _togglePreview
   * (entering / leaving preview without a swap).
   */
  _refreshEditorScrollListener() {
    if (this._editorScrollDisposable) {
      try {
        this._editorScrollDisposable.dispose();
      } catch (_) {}
      this._editorScrollDisposable = null;
    }
    if (!this._previewMode) return;
    const modifiedEditor = this._getModifiedEditor();
    if (!modifiedEditor) return;
    try {
      this._editorScrollDisposable =
        modifiedEditor.onDidScrollChange?.(
          this._onEditorScroll,
        ) || null;
    } catch (_) {
      // Mock without onDidScrollChange — scroll sync
      // silently unavailable in that environment.
    }
  }

  // ---------------------------------------------------------------
  // Internals — preview mode (markdown)
  // ---------------------------------------------------------------

  /**
   * Toggle preview mode. Re-renders the template (which
   * adds or removes the preview pane div), then rebuilds
   * the Monaco editor because `renderSideBySide` is a
   * construction-time option — can't be changed on an
   * existing editor, the editor must be recreated.
   */
  _togglePreview() {
    if (this._activeIndex < 0) return;
    const file = this._files[this._activeIndex];
    if (!this._isMarkdownFile(file)) return;
    // Detach any preview-pane scroll listener attached
    // to the OLD pane element before Lit replaces the
    // DOM. The old pane is about to be discarded; the
    // listener would leak otherwise.
    this._detachPreviewScrollListener();
    this._previewMode = !this._previewMode;
    // Preview pane reference will be re-acquired after
    // the next render commits. Drop it now so stale
    // references don't leak.
    this._previewPane = null;
    // Disposing the editor forces a fresh createDiffEditor
    // call with the new renderSideBySide option. The Lit
    // render committing `_previewMode` also moves the
    // editor container div to its new location in the
    // split layout.
    this._disposeEditor();
    this._editorContainer = null;
    // Schedule a rebuild after Lit commits the new
    // template. _showEditor handles container lookup + rAF
    // retries; we just need to trigger it once the DOM
    // reflects the new layout.
    this.updateComplete.then(() => {
      this._showEditor();
      // If entering preview, populate the pane with
      // current content and wire up scroll sync.
      // Leaving preview — no-op, the pane is gone.
      if (this._previewMode) {
        this._updatePreview(file.modified);
        this._attachPreviewScrollListener();
      }
    });
  }

  /**
   * Render markdown into the preview pane via direct DOM
   * write. Bypasses Lit because per-keystroke re-renders
   * of the whole component would be wasteful — the
   * preview pane's innerHTML is the only thing changing.
   */
  _updatePreview(content) {
    // Re-acquire the pane reference if Lit just
    // committed a new template (entering preview mode).
    if (!this._previewPane) {
      this._previewPane =
        this.shadowRoot?.querySelector('.preview-pane') || null;
    }
    if (!this._previewPane) return;
    try {
      const html = renderMarkdownWithSourceMap(content || '');
      this._previewPane.innerHTML = html;
    } catch (err) {
      // Should never fire — renderMarkdownWithSourceMap
      // catches internally and degrades to escaped text.
      // Defensive log in case something else throws.
      console.error('[diff-viewer] preview render failed', err);
    }
    // Bump generation and resolve relative image refs.
    // Image resolution is async (RPC fetches) and
    // fire-and-forget; the generation check inside the
    // resolver discards stale DOM writes from earlier
    // renders.
    this._imageResolveGeneration += 1;
    this._resolvePreviewImages(this._imageResolveGeneration);
  }

  /**
   * Wire up bidirectional scroll sync. The preview pane
   * emits scroll events we bind directly; the editor
   * side is wired in _refreshEditorScrollListener. Safe
   * to call when preview mode is off — it'll be a no-op
   * because the pane won't exist yet.
   */
  _attachPreviewScrollListener() {
    if (!this._previewPane) {
      this._previewPane =
        this.shadowRoot?.querySelector('.preview-pane') || null;
    }
    if (!this._previewPane) return;
    this._previewPane.addEventListener(
      'scroll',
      this._onPreviewScroll,
      { passive: true },
    );
    // Relative-link click interception — same lifecycle
    // as scroll sync (only relevant in preview mode).
    this._previewPane.addEventListener(
      'click',
      this._onPreviewClick,
    );
    // Scroll listener on the editor side too — scope this
    // attach to preview mode since the listener is only
    // meaningful here.
    this._refreshEditorScrollListener();
  }

  _detachPreviewScrollListener() {
    if (this._previewPane) {
      try {
        this._previewPane.removeEventListener(
          'scroll',
          this._onPreviewScroll,
        );
      } catch (_) {}
      try {
        this._previewPane.removeEventListener(
          'click',
          this._onPreviewClick,
        );
      } catch (_) {}
    }
  }

  /**
   * Acquire the scroll lock for `side` ('editor' or
   * 'preview') and auto-release after a short window.
   * During the lock the other side's scroll handler
   * skips, preventing feedback loops.
   */
  _acquireScrollLock(side) {
    this._scrollLock = side;
    if (this._scrollLockTimer) {
      clearTimeout(this._scrollLockTimer);
    }
    this._scrollLockTimer = setTimeout(() => {
      this._scrollLock = null;
      this._scrollLockTimer = null;
    }, _SCROLL_LOCK_MS);
  }

  /**
   * Collect scroll anchors from the preview pane — one
   * per block element carrying data-source-line. Returns
   * a deduped, monotonically-increasing list of
   * {line, offsetTop} pairs ready for binary search.
   *
   * Dedup — first element per source line wins. Some
   * nested block elements emit the same source-line
   * attribute; keeping the first is both cheapest and
   * visually correct (outermost block).
   *
   * Monotonicity — sort by offsetTop ascending and drop
   * any anchor whose offsetTop is less than the running
   * maximum. Nested containers can have inner children
   * with earlier offsetTop than an already-seen outer
   * block; including them would make the binary search
   * jumpy.
   */
  _collectPreviewAnchors() {
    if (!this._previewPane) return [];
    const raw = this._previewPane.querySelectorAll(
      '[data-source-line]',
    );
    const seen = new Set();
    const entries = [];
    for (const el of raw) {
      const line = parseInt(el.dataset.sourceLine, 10);
      if (!Number.isFinite(line)) continue;
      if (seen.has(line)) continue;
      seen.add(line);
      entries.push({ line, offsetTop: el.offsetTop });
    }
    entries.sort((a, b) => a.offsetTop - b.offsetTop);
    let lastTop = -Infinity;
    return entries.filter((e) => {
      if (e.offsetTop < lastTop) return false;
      lastTop = e.offsetTop;
      return true;
    });
  }

  /**
   * Editor scrolled — map the top visible line to an
   * anchor in the preview pane and scroll the preview to
   * match. Skips when the lock is held by the other side.
   */
  _onEditorScroll() {
    if (this._scrollLock === 'preview') return;
    if (!this._previewMode || !this._previewPane) return;
    const modifiedEditor = this._getModifiedEditor();
    if (!modifiedEditor) return;
    let topLine;
    try {
      const scrollTop = modifiedEditor.getScrollTop?.() ?? 0;
      const lineHeight = this._getLineHeight(modifiedEditor);
      topLine = Math.floor(scrollTop / lineHeight) + 1;
    } catch (_) {
      return;
    }
    const anchors = this._collectPreviewAnchors();
    if (anchors.length === 0) return;
    const targetTop = this._mapLineToOffsetTop(anchors, topLine);
    if (targetTop == null) return;
    this._acquireScrollLock('editor');
    this._previewPane.scrollTop = targetTop;
  }

  /**
   * Preview scrolled — find the anchor at/just before
   * the current scrollTop and scroll the editor to that
   * source line. Skips when the lock is held by the
   * editor side.
   */
  _onPreviewScroll() {
    if (this._scrollLock === 'editor') return;
    if (!this._previewMode || !this._previewPane) return;
    const modifiedEditor = this._getModifiedEditor();
    if (!modifiedEditor) return;
    const scrollTop = this._previewPane.scrollTop;
    const anchors = this._collectPreviewAnchors();
    if (anchors.length === 0) return;
    const targetLine = this._mapOffsetTopToLine(anchors, scrollTop);
    if (targetLine == null) return;
    this._acquireScrollLock('preview');
    try {
      const lineHeight = this._getLineHeight(modifiedEditor);
      const targetScroll = (targetLine - 1) * lineHeight;
      modifiedEditor.setScrollTop?.(targetScroll);
    } catch (_) {}
  }

  /**
   * Binary-search anchors by source line. Returns the
   * interpolated offsetTop between the matched anchor
   * and the next one. Past the last anchor, falls back
   * to proportional mapping so reaching the editor
   * bottom scrolls the preview to its bottom too.
   */
  _mapLineToOffsetTop(anchors, line) {
    if (anchors.length === 0) return null;
    // Below the first anchor — return its position.
    if (line <= anchors[0].line) return anchors[0].offsetTop;
    // Past the last — proportional fallback against
    // remaining preview scroll range.
    const last = anchors[anchors.length - 1];
    if (line >= last.line) {
      if (!this._previewPane) return last.offsetTop;
      const total = this._previewPane.scrollHeight -
        this._previewPane.clientHeight;
      const maxEditorLines = this._getEditorLineCount();
      if (!maxEditorLines || line >= maxEditorLines) {
        return total;
      }
      const frac = (line - last.line) /
        (maxEditorLines - last.line);
      return last.offsetTop +
        frac * (total - last.offsetTop);
    }
    // Interpolate between the two anchors straddling
    // `line`.
    let lo = 0;
    let hi = anchors.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (anchors[mid].line <= line) lo = mid;
      else hi = mid;
    }
    const a = anchors[lo];
    const b = anchors[hi];
    if (a.line === b.line) return a.offsetTop;
    const t = (line - a.line) / (b.line - a.line);
    return a.offsetTop + t * (b.offsetTop - a.offsetTop);
  }

  /**
   * Inverse of _mapLineToOffsetTop — find the source
   * line corresponding to a preview scroll position.
   */
  _mapOffsetTopToLine(anchors, offsetTop) {
    if (anchors.length === 0) return null;
    if (offsetTop <= anchors[0].offsetTop) return anchors[0].line;
    const last = anchors[anchors.length - 1];
    if (offsetTop >= last.offsetTop) {
      if (!this._previewPane) return last.line;
      const total = this._previewPane.scrollHeight -
        this._previewPane.clientHeight;
      const maxEditorLines = this._getEditorLineCount();
      if (!maxEditorLines || total <= last.offsetTop) {
        return last.line;
      }
      const frac = (offsetTop - last.offsetTop) /
        (total - last.offsetTop);
      return Math.round(
        last.line + frac * (maxEditorLines - last.line),
      );
    }
    let lo = 0;
    let hi = anchors.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (anchors[mid].offsetTop <= offsetTop) lo = mid;
      else hi = mid;
    }
    const a = anchors[lo];
    const b = anchors[hi];
    if (a.offsetTop === b.offsetTop) return a.line;
    const t = (offsetTop - a.offsetTop) /
      (b.offsetTop - a.offsetTop);
    return Math.round(a.line + t * (b.line - a.line));
  }

  _getLineHeight(modifiedEditor) {
    try {
      const opts = modifiedEditor.getOption?.(
        monaco.editor.EditorOption?.lineHeight,
      );
      if (typeof opts === 'number' && opts > 0) return opts;
    } catch (_) {}
    // Reasonable default — matches Monaco's dark theme.
    return 19;
  }

  _getEditorLineCount() {
    const modifiedEditor = this._getModifiedEditor();
    if (!modifiedEditor) return 0;
    try {
      const model = modifiedEditor.getModel?.();
      return model?.getLineCount?.() || 0;
    } catch (_) {
      return 0;
    }
  }

  /**
   * Resolve relative image refs in the rendered preview.
   * Runs as a post-processing step after _updatePreview;
   * the `generation` argument lets us discard stale
   * fetches when a newer render has already landed.
   *
   * Resolution rules (spec-mandated):
   *   - Skip absolute URLs (http, https, data, blob)
   *   - Decode percent-encoded characters (undoes
   *     encodeImagePaths that renderMarkdownWithSourceMap
   *     applied for marked compatibility)
   *   - Resolve relative path against the current file's
   *     directory
   *   - SVG files fetched as text via Repo.get_file_content
   *     and injected as data:image/svg+xml;charset=utf-8,…
   *   - Other images fetched via Repo.get_file_base64
   *     which already returns a data URI
   *   - Failed loads degrade gracefully: alt text
   *     indicates the problem, image dimmed via opacity
   */
  async _resolvePreviewImages(generation) {
    if (this._activeIndex < 0) return;
    const file = this._files[this._activeIndex];
    if (!file || !this._previewPane) return;
    const imgs = this._previewPane.querySelectorAll('img');
    if (imgs.length === 0) return;
    const call = this._getRpcCall();
    if (!call) return;
    // Resolve in parallel; each promise settles
    // independently so one failure doesn't block other
    // images.
    const tasks = [];
    for (const img of imgs) {
      const src = img.getAttribute('src') || '';
      if (!src) continue;
      if (this._isAbsoluteUrl(src)) continue;
      tasks.push(this._resolveOneImage(img, src, file, call, generation));
    }
    // No need to await Promise.all — fire-and-forget is
    // correct here, each task updates its own img when
    // ready.
    Promise.all(tasks).catch(() => {
      // Individual failures already handled inside
      // _resolveOneImage; this catch is purely defensive
      // in case the gather itself throws.
    });
  }

  async _resolveOneImage(img, src, file, call, generation) {
    let relPath;
    try {
      // Decode percent-encoding first — the preview
      // renderer encoded spaces as %20 for marked
      // compatibility, but Repo RPCs want the literal
      // filesystem path.
      relPath = decodeURIComponent(src);
    } catch (_) {
      relPath = src;
    }
    const resolved = resolveRelativePath(file.path, relPath);
    if (!resolved || this._isAbsoluteUrl(resolved)) return;
    const isSvg = resolved.toLowerCase().endsWith('.svg');
    try {
      let dataUri;
      if (isSvg) {
        const result = await call['Repo.get_file_content'](resolved);
        const text = this._extractRpcContent(result);
        if (!text) {
          this._markImageMissing(img, resolved, generation);
          return;
        }
        dataUri =
          'data:image/svg+xml;charset=utf-8,' +
          encodeURIComponent(text);
      } else {
        const result = await call['Repo.get_file_base64'](resolved);
        dataUri = this._extractBase64Uri(result);
        if (!dataUri) {
          this._markImageMissing(img, resolved, generation);
          return;
        }
      }
      if (generation !== this._imageResolveGeneration) return;
      img.setAttribute('src', dataUri);
    } catch (err) {
      this._markImageFailed(img, resolved, err, generation);
    }
  }

  /**
   * Extract the data URI from a Repo.get_file_base64
   * response. Handles the same three shapes as
   * _extractRpcContent — plain string, object with a
   * `data_uri` field, or jrpc-oo single-key envelope.
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

  _isAbsoluteUrl(url) {
    if (typeof url !== 'string') return false;
    return (
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      url.startsWith('http://') ||
      url.startsWith('https://')
    );
  }

  _markImageMissing(img, path, generation) {
    if (generation !== this._imageResolveGeneration) return;
    img.setAttribute('alt', `[Image not found: ${path}]`);
    img.style.opacity = '0.4';
  }

  _markImageFailed(img, path, err, generation) {
    if (generation !== this._imageResolveGeneration) return;
    const message = err?.message || 'unknown error';
    img.setAttribute(
      'alt',
      `[Failed to load: ${path} — ${message}]`,
    );
    img.style.opacity = '0.4';
  }

  /**
   * Intercept clicks on relative <a href> elements in
   * the preview pane. Absolute URLs (http, https, mailto,
   * file, etc.) and fragment-only refs pass through to
   * the browser's default behavior. Relative paths
   * resolve against the current file's directory and
   * dispatch navigate-file events for the app shell to
   * route.
   */
  _onPreviewClick(event) {
    const anchor = event.target?.closest?.('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href) return;
    if (this._isAbsoluteUrl(href)) return;
    if (href.startsWith('#')) return;
    // Absolute-path refs starting with / fall through to
    // the browser; the repo has no concept of root-anchored
    // links.
    if (href.startsWith('/')) return;
    // mailto:, tel:, etc. — anything with a scheme prefix.
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return;
    if (this._activeIndex < 0) return;
    const file = this._files[this._activeIndex];
    if (!file) return;
    let relPath;
    try {
      relPath = decodeURIComponent(href);
    } catch (_) {
      relPath = href;
    }
    // Strip fragment — navigate-file carries just the path.
    const hashIdx = relPath.indexOf('#');
    const pathPart =
      hashIdx >= 0 ? relPath.slice(0, hashIdx) : relPath;
    const resolved = resolveRelativePath(file.path, pathPart);
    if (!resolved || this._isAbsoluteUrl(resolved)) return;
    event.preventDefault();
    this.dispatchEvent(
      new CustomEvent('navigate-file', {
        detail: { path: resolved },
        bubbles: true,
        composed: true,
      }),
    );
  }

  _onContentChange() {
    if (this._activeIndex < 0) return;
    const file = this._files[this._activeIndex];
    if (!file) return;
    const modifiedEditor = this._getModifiedEditor();
    if (!modifiedEditor) return;
    try {
      const value = modifiedEditor.getValue();
      file.modified = value;
    } catch (_) {
      // Model disposed between events and handler — skip.
      return;
    }
    this._recomputeDirtyCount();
    // Live preview — when preview mode is on, re-render
    // on every keystroke. rendMarkdownWithSourceMap is
    // pure string work; no RPC, cheap enough per-key.
    if (this._previewMode && this._isMarkdownFile(file)) {
      this._updatePreview(file.modified);
    }
  }

  _patchCodeEditorService() {
    if (this._editorServicePatched) return;
    const modifiedEditor = this._getModifiedEditor();
    if (!modifiedEditor) return;
    const svc = modifiedEditor._codeEditorService;
    if (!svc || typeof svc.openCodeEditor !== 'function') return;
    this._editorServicePatched = true;
    const origOpen = svc.openCodeEditor.bind(svc);
    svc.openCodeEditor = async (input, source, sideBySide) => {
      try {
        const uri = input?.resource;
        if (uri) {
          // Strip leading slashes so repo-relative paths
          // resolve correctly.
          let path = uri.path || '';
          if (path.startsWith('/')) path = path.slice(1);
          const line =
            input.options?.selection?.startLineNumber;
          if (path) {
            await this.openFile({ path, line });
          }
        }
      } catch (err) {
        console.warn('[diff-viewer] cross-file nav failed', err);
      }
      return origOpen(input, source, sideBySide);
    };
  }

  _disposeEditor() {
    // Dispose order: editor first (releases model
    // references), then models.
    if (this._contentChangeDisposable) {
      try {
        this._contentChangeDisposable.dispose();
      } catch (_) {}
      this._contentChangeDisposable = null;
    }
    if (this._editorScrollDisposable) {
      try {
        this._editorScrollDisposable.dispose();
      } catch (_) {}
      this._editorScrollDisposable = null;
    }
    this._detachPreviewScrollListener();
    if (this._scrollLockTimer) {
      clearTimeout(this._scrollLockTimer);
      this._scrollLockTimer = null;
    }
    this._scrollLock = null;
    if (this._editor) {
      const models = this._editor.getModel?.();
      try {
        this._editor.dispose();
      } catch (_) {}
      this._editor = null;
      if (models) {
        try { models.original?.dispose(); } catch (_) {}
        try { models.modified?.dispose(); } catch (_) {}
      }
    }
    this._editorServicePatched = false;
  }

  // ---------------------------------------------------------------
  // Internals — shadow DOM style sync
  // ---------------------------------------------------------------

  /**
   * Clone all document.head styles into the shadow root.
   * Runs every editor creation; removes prior clones
   * first so the count doesn't grow across re-creations.
   */
  _syncAllStyles() {
    if (!this.shadowRoot) return;
    // Remove prior clones.
    const prior = this.shadowRoot.querySelectorAll(
      `[data-${_CLONED_STYLE_MARKER.replace(
        /([A-Z])/g,
        '-$1',
      ).toLowerCase()}]`,
    );
    for (const el of prior) el.remove();
    // Clone current head styles + linked stylesheets.
    const heads = document.head.querySelectorAll('style, link');
    for (const el of heads) {
      if (el.tagName === 'LINK') {
        const rel = (el.getAttribute('rel') || '').toLowerCase();
        if (rel !== 'stylesheet') continue;
      }
      const clone = el.cloneNode(true);
      clone.dataset[_CLONED_STYLE_MARKER] = 'true';
      this.shadowRoot.appendChild(clone);
    }
    this._ensureKatexCss();
  }

  /**
   * Inject the KaTeX stylesheet into the shadow root if
   * not already present. Idempotent — only one copy ever
   * lives in the shadow root regardless of how many
   * times _syncAllStyles runs. Content falls back to a
   * placeholder when the ?raw import didn't resolve (see
   * module-level import); the mechanism still runs so
   * tests can verify the injection path.
   */
  _ensureKatexCss() {
    if (!this.shadowRoot) return;
    // Convert camelCase marker to kebab-case for the
    // attribute selector.
    const attrName = _KATEX_CSS_MARKER.replace(
      /([A-Z])/g,
      '-$1',
    ).toLowerCase();
    const existing = this.shadowRoot.querySelector(
      `[data-${attrName}]`,
    );
    if (existing) return;
    const style = document.createElement('style');
    style.dataset[_KATEX_CSS_MARKER] = 'true';
    style.textContent = katexCssText;
    this.shadowRoot.appendChild(style);
  }

  _ensureStyleObserver() {
    if (this._styleObserver) return;
    if (typeof MutationObserver === 'undefined') return;
    try {
      this._styleObserver = new MutationObserver(
        this._onHeadMutation,
      );
      this._styleObserver.observe(document.head, {
        childList: true,
      });
    } catch (_) {
      // No MutationObserver — full re-sync on every
      // editor creation is the fallback.
    }
  }

  _disposeStyleObserver() {
    if (this._styleObserver) {
      try {
        this._styleObserver.disconnect();
      } catch (_) {}
      this._styleObserver = null;
    }
  }

  _onHeadMutation(mutations) {
    if (!this.shadowRoot) return;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (
          node.nodeType === 1 &&
          (node.tagName === 'STYLE' || node.tagName === 'LINK')
        ) {
          if (node.tagName === 'LINK') {
            const rel = (
              node.getAttribute('rel') || ''
            ).toLowerCase();
            if (rel !== 'stylesheet') continue;
          }
          const clone = node.cloneNode(true);
          clone.dataset[_CLONED_STYLE_MARKER] = 'true';
          this.shadowRoot.appendChild(clone);
        }
      }
      for (const node of m.removedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName !== 'STYLE' && node.tagName !== 'LINK') {
          continue;
        }
        // Find clones matching by textContent (styles)
        // or href (links) and remove them.
        const clones = this.shadowRoot.querySelectorAll(
          `[data-${_CLONED_STYLE_MARKER.replace(
            /([A-Z])/g,
            '-$1',
          ).toLowerCase()}]`,
        );
        for (const c of clones) {
          if (
            (node.tagName === 'STYLE' &&
              c.textContent === node.textContent) ||
            (node.tagName === 'LINK' &&
              c.getAttribute('href') === node.getAttribute('href'))
          ) {
            c.remove();
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------
  // Internals — viewport state
  // ---------------------------------------------------------------

  _captureViewport() {
    if (this._activeIndex < 0 || !this._editor) return;
    const file = this._files[this._activeIndex];
    if (!file) return;
    try {
      const modifiedEditor = this._getModifiedEditor();
      if (!modifiedEditor) return;
      const pos = modifiedEditor.getPosition?.();
      this._viewportStates.set(file.path, {
        scrollTop: modifiedEditor.getScrollTop?.() || 0,
        scrollLeft: modifiedEditor.getScrollLeft?.() || 0,
        lineNumber: pos?.lineNumber || 1,
        column: pos?.column || 1,
      });
    } catch (_) {
      // Mock editor without scroll methods — skip.
    }
  }

  _restoreViewport(path) {
    const state = this._viewportStates.get(path);
    if (!state) return;
    this._waitForDiffReady().then(() => {
      const modifiedEditor = this._getModifiedEditor();
      if (!modifiedEditor) return;
      try {
        modifiedEditor.setPosition?.({
          lineNumber: state.lineNumber,
          column: state.column,
        });
        modifiedEditor.setScrollTop?.(state.scrollTop);
        modifiedEditor.setScrollLeft?.(state.scrollLeft);
      } catch (_) {
        // Mock editor — skip.
      }
    });
  }

  /**
   * Resolve after Monaco's diff computation settles.
   * Registers a one-shot onDidUpdateDiff listener with a
   * fallback timeout for identical-content files (which
   * never fire the event). specs4 calls this out
   * explicitly.
   */
  _waitForDiffReady() {
    return new Promise((resolve) => {
      if (!this._editor) {
        resolve();
        return;
      }
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        requestAnimationFrame(resolve);
      };
      try {
        const disposable = this._editor.onDidUpdateDiff?.(() => {
          try { disposable?.dispose(); } catch (_) {}
          settle();
        });
        if (!disposable) {
          // Mock editor without the event — fall through
          // to timeout.
        }
      } catch (_) {
        // Same fallback.
      }
      setTimeout(settle, _DIFF_READY_TIMEOUT_MS);
    });
  }

  _scrollToLine(line) {
    this._waitForDiffReady().then(() => {
      const modifiedEditor = this._getModifiedEditor();
      if (!modifiedEditor) return;
      try {
        modifiedEditor.revealLineInCenter?.(line);
        modifiedEditor.setPosition?.({ lineNumber: line, column: 1 });
      } catch (_) {}
    });
  }

  _scrollToSearchText(text) {
    if (!text) return;
    this._waitForDiffReady().then(() => {
      const modifiedEditor = this._getModifiedEditor();
      if (!modifiedEditor) return;
      const model = modifiedEditor.getModel?.();
      if (!model) return;
      // Try progressively shorter prefixes to handle
      // whitespace drift between anchor text and file
      // content.
      const candidates = this._searchCandidates(text);
      for (const candidate of candidates) {
        try {
          const matches = model.findMatches?.(
            candidate,
            true, // searchOnlyEditableRange
            false, // isRegex
            false, // matchCase
            null, // wordSeparators
            false, // captureMatches
          );
          if (matches && matches.length > 0) {
            const range = matches[0].range;
            modifiedEditor.revealRangeInCenter?.(range);
            this._applyHighlight(modifiedEditor, range);
            return;
          }
        } catch (_) {
          // Mock findMatches — skip.
        }
      }
    });
  }

  _searchCandidates(text) {
    const lines = text.split('\n').filter((l) => l.trim());
    if (lines.length === 0) return [text];
    // Try full text, then first two lines, then first
    // line only — progressively shorter prefixes match
    // even when trailing lines drifted.
    const candidates = [text];
    if (lines.length > 2) candidates.push(lines.slice(0, 2).join('\n'));
    if (lines.length > 1) candidates.push(lines[0]);
    return candidates;
  }

  _applyHighlight(editor, range) {
    try {
      if (this._highlightTimer) {
        clearTimeout(this._highlightTimer);
        this._highlightTimer = null;
      }
      this._highlightDecorations =
        editor.deltaDecorations?.(
          this._highlightDecorations,
          [
            {
              range,
              options: {
                isWholeLine: true,
                className: 'highlight-decoration',
                overviewRuler: {
                  color: '#4fc3f7',
                  position: monaco.editor.OverviewRulerLane?.Full ?? 7,
                },
              },
            },
          ],
        ) || [];
      this._highlightTimer = setTimeout(() => {
        this._highlightTimer = null;
        try {
          this._highlightDecorations = editor.deltaDecorations?.(
            this._highlightDecorations,
            [],
          ) || [];
        } catch (_) {}
      }, _HIGHLIGHT_DURATION_MS);
    } catch (_) {}
  }

  // ---------------------------------------------------------------
  // Internals — dirty tracking & saving
  // ---------------------------------------------------------------

  _isDirty(file) {
    if (!file) return false;
    if (file.isVirtual || file.isReadOnly) return false;
    return file.modified !== file.savedContent;
  }

  /**
   * Whether the active file is markdown — the Preview
   * button is rendered only for these. Case-insensitive
   * extension match to catch `.MD`.
   */
  _isMarkdownFile(file) {
    if (!file || typeof file.path !== 'string') return false;
    const lower = file.path.toLowerCase();
    return lower.endsWith('.md') || lower.endsWith('.markdown');
  }

  _recomputeDirtyCount() {
    const count = this._files.filter((f) => this._isDirty(f)).length;
    this._dirtyCount = count;
  }

  async _saveFile(path) {
    const file = this._files.find((f) => f.path === path);
    if (!file) return;
    if (file.isVirtual || file.isReadOnly) return;
    // Read live content from editor if it's the active
    // file; otherwise use the stored modified value.
    let content = file.modified;
    if (
      this._editor &&
      path === this._files[this._activeIndex]?.path
    ) {
      const modifiedEditor = this._getModifiedEditor();
      try {
        content = modifiedEditor?.getValue?.() ?? file.modified;
      } catch (_) {}
    }
    file.modified = content;
    file.savedContent = content;
    this._recomputeDirtyCount();
    // Dispatch file-saved — parent routes to Repo write
    // or Settings save depending on the file's flags.
    this.dispatchEvent(
      new CustomEvent('file-saved', {
        detail: {
          path,
          content,
          isConfig: !!file.isConfig,
          configType: file.configType,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ---------------------------------------------------------------
  // Internals — status LED / panel labels
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

  _setPanelLabel(path, panel, label) {
    if (!label) return;
    const entry = this._panelLabels.get(path) || {};
    entry[panel] = label;
    this._panelLabels.set(path, entry);
  }

  _currentPanelLabels() {
    if (this._activeIndex < 0) return {};
    const file = this._files[this._activeIndex];
    if (!file) return {};
    return this._panelLabels.get(file.path) || {};
  }

  // ---------------------------------------------------------------
  // Internals — keyboard shortcuts
  // ---------------------------------------------------------------

  _onKeyDown(event) {
    if (!this.isConnected) return;
    if (this._activeIndex < 0) return;
    const ctrl = event.ctrlKey || event.metaKey;
    if (!ctrl) return;
    // Ctrl+S — save active file.
    if (event.key === 's' || event.key === 'S') {
      if (
        this._activeInEditorRoot(event.target) ||
        this._eventTargetInsideUs(event)
      ) {
        event.preventDefault();
        const file = this._files[this._activeIndex];
        if (file) this._saveFile(file.path);
      }
      return;
    }
    // Ctrl+W — close active file. Only when focus is
    // inside the viewer to avoid hijacking other tabs'
    // close-tab shortcut.
    if (event.key === 'w' || event.key === 'W') {
      if (this._eventTargetInsideUs(event)) {
        event.preventDefault();
        const file = this._files[this._activeIndex];
        if (file) this.closeFile(file.path);
      }
      return;
    }
    // Ctrl+PageDown / Ctrl+PageUp — next/previous file.
    if (event.key === 'PageDown') {
      if (this._eventTargetInsideUs(event)) {
        event.preventDefault();
        this._cycleFile(1);
      }
      return;
    }
    if (event.key === 'PageUp') {
      if (this._eventTargetInsideUs(event)) {
        event.preventDefault();
        this._cycleFile(-1);
      }
      return;
    }
  }

  _activeInEditorRoot(target) {
    // Monaco's textarea lives inside our shadow root; the
    // event target from a keydown inside Monaco is the
    // composed path's first shadow-crossing element.
    return this._eventTargetInsideUs({ target });
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
    this._captureViewport();
    this._activeIndex = next;
    this._showEditor();
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
    const labels = this._currentPanelLabels();
    const activeFile =
      this._activeIndex >= 0 ? this._files[this._activeIndex] : null;
    const showPreviewButton = this._isMarkdownFile(activeFile);
    if (this._previewMode && showPreviewButton) {
      return html`
        <div class="split-root">
          <div class="editor-pane">
            <div class="editor-container" role="region"
              aria-label="Diff editor"></div>
          </div>
          <div
            class="preview-pane"
            role="region"
            aria-label="Markdown preview"
          ></div>
          <button
            class="preview-button preview-button-split"
            @click=${this._togglePreview}
            title="Exit preview"
            aria-label="Exit preview"
          >✕ Preview</button>
          <div
            class="status-led ${ledClass}"
            title=${this._statusLedTitle()}
            aria-label=${this._statusLedTitle()}
            @click=${this._onStatusLedClick}
          ></div>
        </div>
      `;
    }
    return html`
      <div class="editor-container" role="region"
        aria-label="Diff editor"></div>
      ${labels.left
        ? html`<div class="panel-label left">${labels.left}</div>`
        : ''}
      ${labels.right
        ? html`<div class="panel-label right">${labels.right}</div>`
        : ''}
      ${showPreviewButton
        ? html`<button
            class="preview-button"
            @click=${this._togglePreview}
            title="Toggle markdown preview"
            aria-label="Toggle markdown preview"
          >👁 Preview</button>`
        : ''}
      <div
        class="status-led ${ledClass}"
        title=${this._statusLedTitle()}
        aria-label=${this._statusLedTitle()}
        @click=${this._onStatusLedClick}
      ></div>
    `;
  }
}

customElements.define('ac-diff-viewer', DiffViewer);