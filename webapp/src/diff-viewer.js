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
import { SharedRpc } from './rpc.js';

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

export class DiffViewer extends LitElement {
  static properties = {
    _files: { type: Array, state: true },
    _activeIndex: { type: Number, state: true },
    /** Dirty state per file — drives the status LED. */
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

    // Monaco editor instance. Created on first openFile,
    // disposed on last closeFile.
    this._editor = null;
    // Element reference for the editor host div, read
    // from the shadow root after Lit renders.
    this._editorContainer = null;
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
    } else if (wasActive) {
      // Clamp to remaining range; switch to adjacent file.
      this._activeIndex = Math.min(idx, newFiles.length - 1);
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
    this._showEditor();
    this._dispatchActiveFileChanged();
    this._recomputeDirtyCount();
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
          renderSideBySide: true,
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
    return html`
      <div class="editor-container" role="region"
        aria-label="Diff editor"></div>
      ${labels.left
        ? html`<div class="panel-label left">${labels.left}</div>`
        : ''}
      ${labels.right
        ? html`<div class="panel-label right">${labels.right}</div>`
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