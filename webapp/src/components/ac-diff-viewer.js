/**
 * AcDiffViewer — side-by-side diff editor using Monaco.
 *
 * Lives in the background layer (fills viewport behind the dialog).
 * Supports: inline editing + save, LSP features, markdown preview,
 * multiple open files, status LED, and post-edit refresh.
 */

import { LitElement, html, css } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { RpcMixin } from '../utils/rpc-mixin.js';

// Language detection from extension
const LANG_MAP = {
  '.js': 'javascript', '.mjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript',
  '.py': 'python', '.pyi': 'python',
  '.json': 'json',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.html': 'html', '.htm': 'html',
  '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.md': 'markdown', '.markdown': 'markdown',
  '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hxx': 'cpp',
  '.sh': 'shell', '.bash': 'shell',
  '.xml': 'xml', '.svg': 'xml',
  '.toml': 'ini',
};

function _langFromPath(path) {
  if (!path) return 'plaintext';
  const dot = path.lastIndexOf('.');
  if (dot < 0) return 'plaintext';
  return LANG_MAP[path.substring(dot).toLowerCase()] || 'plaintext';
}

export class AcDiffViewer extends RpcMixin(LitElement) {
  static properties = {
    _files: { type: Array, state: true },
    _activeIndex: { type: Number, state: true },
    _dirtySet: { type: Object, state: true },
    _previewMode: { type: Boolean, state: true },
    _previewHtml: { type: String, state: true },
  };

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      position: relative;
    }

    .editor-container {
      width: 100%;
      height: 100%;
    }

    /* Empty state watermark */
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

    /* Preview mode */
    .preview-btn {
      position: absolute;
      top: 12px;
      right: 32px;
      z-index: 5;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      border-radius: 4px;
      color: var(--text-secondary);
      cursor: pointer;
      padding: 3px 8px;
      font-size: 0.75rem;
    }
    .preview-btn:hover { color: var(--text-primary); background: var(--bg-secondary); }
    .preview-btn.active {
      color: var(--accent-primary);
      border-color: var(--accent-primary);
      background: rgba(79, 195, 247, 0.08);
    }

    .preview-split {
      display: flex;
      width: 100%;
      height: 100%;
    }
    .preview-split .editor-half {
      flex: 1;
      min-width: 0;
      height: 100%;
      overflow: hidden;
    }
    .preview-split .preview-half {
      flex: 1;
      min-width: 0;
      height: 100%;
      overflow-y: auto;
      padding: 16px 20px;
      background: var(--bg-primary);
      border-left: 1px solid var(--border-primary);
    }

    /* Preview pane markdown styles */
    .preview-half h1, .preview-half h2, .preview-half h3,
    .preview-half h4, .preview-half h5, .preview-half h6 {
      color: var(--accent-primary);
      margin: 0.8em 0 0.4em;
    }
    .preview-half h1 { font-size: 1.4rem; border-bottom: 1px solid var(--border-primary); padding-bottom: 0.3em; }
    .preview-half h2 { font-size: 1.2rem; border-bottom: 1px solid var(--border-secondary); padding-bottom: 0.2em; }
    .preview-half h3 { font-size: 1.05rem; }
    .preview-half p { margin: 0.5em 0; line-height: 1.6; color: var(--text-primary); }
    .preview-half ul, .preview-half ol { padding-left: 1.5em; margin: 0.4em 0; }
    .preview-half li { margin: 0.2em 0; line-height: 1.5; }
    .preview-half blockquote {
      border-left: 3px solid var(--accent-primary);
      padding: 0.3em 0 0.3em 12px;
      margin: 0.5em 0;
      color: var(--text-secondary);
      background: var(--bg-secondary);
      border-radius: 0 4px 4px 0;
    }
    .preview-half table {
      border-collapse: collapse;
      margin: 0.5em 0;
      font-size: 0.85rem;
      width: auto;
    }
    .preview-half th, .preview-half td {
      border: 1px solid var(--border-primary);
      padding: 6px 10px;
    }
    .preview-half th { background: var(--bg-tertiary); font-weight: 600; }
    .preview-half code {
      background: var(--bg-input);
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 0.85rem;
    }
    .preview-half pre.code-block {
      background: var(--bg-input);
      border: 1px solid var(--border-secondary);
      border-radius: 6px;
      padding: 10px 14px;
      margin: 0.5em 0;
      overflow-x: auto;
      font-size: 0.82rem;
      line-height: 1.4;
    }
    .preview-half pre.code-block code {
      background: none;
      padding: 0;
      font-size: inherit;
    }
    .preview-half a { color: var(--accent-primary); }
    .preview-half a:hover { text-decoration: underline; }
    .preview-half img {
      max-width: 100%;
      height: auto;
      border-radius: 4px;
      margin: 0.5em 0;
    }
    .preview-half hr {
      border: none;
      border-top: 1px solid var(--border-primary);
      margin: 1em 0;
    }

    /* hljs in preview */
    .preview-half .hljs { color: var(--text-primary); }
    .preview-half .hljs-keyword { color: #c678dd; }
    .preview-half .hljs-string { color: #98c379; }
    .preview-half .hljs-number { color: #d19a66; }
    .preview-half .hljs-comment { color: #5c6370; font-style: italic; }
    .preview-half .hljs-title { color: #61afef; }
    .preview-half .hljs-type { color: #e5c07b; }
    .preview-half .hljs-built_in { color: #c678dd; }
    .preview-half .hljs-variable { color: #e06c75; }
    .preview-half .hljs-meta { color: #56b6c2; }
    .preview-half .hljs-addition { color: var(--accent-green); }
    .preview-half .hljs-deletion { color: var(--accent-red); }

    /* Preview button in preview pane (sticky) */
    .preview-pane-btn {
      position: sticky;
      top: 0;
      float: right;
      z-index: 2;
      background: var(--bg-tertiary);
      border: 1px solid var(--accent-primary);
      border-radius: 4px;
      color: var(--accent-primary);
      cursor: pointer;
      padding: 3px 8px;
      font-size: 0.75rem;
      margin: 0 0 8px 8px;
    }
    .preview-pane-btn:hover { background: rgba(79, 195, 247, 0.12); }
  `;

  constructor() {
    super();
    this._files = []; // Array of DiffFile objects
    this._activeIndex = -1;
    this._dirtySet = new Set();
    this._editor = null;
    this._monacoLoaded = false;
    this._resizeObserver = null;
    this._virtualContents = new Map();
    this._lspRegistered = false;
    this._contentChangeDisposable = null;
    this._previewMode = false;
    this._previewHtml = '';
    this._scrollLock = null;
    this._scrollLockTimer = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._viewerResizeHandler = () => {
      if (this._editor) {
        requestAnimationFrame(() => this._editor?.layout());
      }
    };
    window.addEventListener('viewer-resize', this._viewerResizeHandler);

    this._saveHandler = (e) => {
      if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
        if (this._activeIndex >= 0 && this._dirtySet.has(this._activeIndex)) {
          e.preventDefault();
          this._saveActive();
        }
      }
    };
    window.addEventListener('keydown', this._saveHandler);

    this._tabHandler = (e) => {
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
    window.addEventListener('keydown', this._tabHandler);

    // Save viewport on request
    this._saveViewportHandler = () => this._saveViewportState();
    window.addEventListener('save-viewport', this._saveViewportHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('viewer-resize', this._viewerResizeHandler);
    window.removeEventListener('keydown', this._saveHandler);
    window.removeEventListener('keydown', this._tabHandler);
    window.removeEventListener('save-viewport', this._saveViewportHandler);
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._editor) {
      this._editor.dispose();
      this._editor = null;
    }
  }

  // ── Public API ───────────────────────────────────────────────

  /**
   * Open or switch to a file.
   * opts: { path, original?, modified?, is_new?, is_read_only?,
   *         is_config?, config_type?, real_path?, virtualContent?, line?, searchText? }
   */
  async openFile(opts) {
    const { path } = opts;
    if (!path) return;

    // Check if already open
    const existingIdx = this._files.findIndex(f => f.path === path);
    if (existingIdx >= 0) {
      if (this._activeIndex !== existingIdx) {
        this._saveCurrentViewport();
        // Exit preview mode when switching files
        if (this._previewMode) {
          this._previewMode = false;
          this._previewHtml = '';
          this._disposeEditor();
        }
        this._activeIndex = existingIdx;
        this._showFile(existingIdx);
      }
      // Scroll to line or search text if requested
      if (opts.line) this._revealLine(opts.line);
      if (opts.searchText) this._searchAndHighlight(opts.searchText);
      return;
    }

    // Virtual content (URL viewer etc.)
    if (opts.virtualContent != null) {
      this._virtualContents.set(path, opts.virtualContent);
    }

    // Fetch content if not provided
    let original = opts.original ?? '';
    let modified = opts.modified ?? '';
    const isVirtual = path.startsWith('virtual://');

    if (!isVirtual && original === '' && modified === '') {
      try {
        [original, modified] = await this._fetchFileContent(path, opts.is_new);
      } catch (e) {
        console.warn('Failed to fetch file content:', e);
      }
    } else if (isVirtual) {
      modified = this._virtualContents.get(path) || '';
    }

    const file = {
      path,
      original,
      modified,
      is_new: opts.is_new || false,
      is_read_only: opts.is_read_only || isVirtual || false,
      is_config: opts.is_config || false,
      config_type: opts.config_type || null,
      real_path: opts.real_path || null,
      savedContent: modified,
    };

    this._saveCurrentViewport();
    this._files = [...this._files, file];
    this._activeIndex = this._files.length - 1;
    this._showFile(this._activeIndex);

    // Dispatch active-file-changed
    this._dispatchActiveFile(path);

    // Scroll to line/search after editor is ready
    if (opts.line || opts.searchText) {
      await this.updateComplete;
      requestAnimationFrame(() => {
        if (opts.line) this._revealLine(opts.line);
        if (opts.searchText) this._searchAndHighlight(opts.searchText);
      });
    }
  }

  closeFile(path) {
    const idx = this._files.findIndex(f => f.path === path);
    if (idx < 0) return;

    // Exit preview mode if closing the previewed file
    if (this._previewMode && idx === this._activeIndex) {
      this._previewMode = false;
      this._previewHtml = '';
    }

    this._virtualContents.delete(path);

    const newFiles = this._files.filter((_, i) => i !== idx);
    // Recalculate dirty set indices (must read old set before mutating)
    const newDirty = new Set();
    for (const di of this._dirtySet) {
      if (di === idx) continue; // removed file
      if (di < idx) newDirty.add(di);
      else newDirty.add(di - 1);
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

    if (this._activeIndex >= 0) {
      this._showFile(this._activeIndex);
      this._dispatchActiveFile(this._files[this._activeIndex].path);
    } else {
      this._disposeEditor();
      this._dispatchActiveFile('');
    }
  }

  async refreshOpenFiles() {
    for (let i = 0; i < this._files.length; i++) {
      const f = this._files[i];
      if (f.path.startsWith('virtual://')) continue;
      try {
        const [original, modified] = await this._fetchFileContent(f.path, f.is_new);
        f.original = original;
        f.modified = modified;
        f.savedContent = modified;
      } catch (_) {}
    }
    this._dirtySet = new Set();
    if (this._activeIndex >= 0) {
      this._showFile(this._activeIndex);
    }
  }

  getDirtyFiles() {
    return [...this._dirtySet].map(i => this._files[i]).filter(Boolean);
  }

  getViewportState() {
    if (!this._editor || this._activeIndex < 0) return null;
    const mod = this._editor.getModifiedEditor();
    return {
      path: this._files[this._activeIndex].path,
      type: 'diff',
      diff: {
        scrollTop: mod.getScrollTop(),
        scrollLeft: mod.getScrollLeft(),
        lineNumber: mod.getPosition()?.lineNumber || 1,
        column: mod.getPosition()?.column || 1,
      },
    };
  }

  restoreViewportState(state) {
    if (!state?.diff || this._activeIndex < 0) return;
    this._pollEditorReady(state.diff, 0);
  }

  _pollEditorReady(viewState, attempt) {
    if (attempt > 20) return;
    const mod = this._editor?.getModifiedEditor?.();
    if (!mod) {
      requestAnimationFrame(() => this._pollEditorReady(viewState, attempt + 1));
      return;
    }
    try {
      mod.setPosition({ lineNumber: viewState.lineNumber, column: viewState.column });
      mod.revealLineInCenter(viewState.lineNumber);
      mod.setScrollTop(viewState.scrollTop);
      mod.setScrollLeft(viewState.scrollLeft);
    } catch (_) {}
  }

  // ── Private ────────────────────────────────────────────────────

  async _fetchFileContent(path, isNew) {
    let original = '';
    let modified = '';

    // HEAD version
    if (!isNew) {
      try {
        const raw = await this.rpcExtract('Repo.get_file_content', path, 'HEAD');
        original = this._normalizeContent(raw);
      } catch (_) {}
    }

    // Working copy
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

  async _ensureMonaco() {
    if (this._monacoLoaded) return;
    // Dynamic import of Monaco
    const monaco = await import('monaco-editor');
    this._monaco = monaco;

    // Configure worker-safe environment (no-op workers for language services)
    self.MonacoEnvironment = {
      getWorker(_moduleId, label) {
        // Return editor worker for diff computation, no-op for languages
        const blob = new Blob(
          ['self.onmessage = function() {}'],
          { type: 'application/javascript' },
        );
        return new Worker(URL.createObjectURL(blob));
      },
    };

    // Define dark theme
    monaco.editor.defineTheme('ac-dc-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#1a1a2e',
        'editor.foreground': '#e0e0e0',
        'editorLineNumber.foreground': '#4a5a7c',
        'editor.selectionBackground': '#2a3a5c',
        'editor.lineHighlightBackground': '#1e2a45',
        'editorCursor.foreground': '#4fc3f7',
      },
    });

    this._monacoLoaded = true;
  }

  async _showFile(index) {
    if (index < 0 || index >= this._files.length) return;
    const file = this._files[index];

    await this._ensureMonaco();
    const monaco = this._monaco;
    const container = this.shadowRoot?.querySelector('.editor-container');
    if (!container) return;

    // Clone styles into shadow root for Monaco
    this._injectMonacoStyles();

    const lang = _langFromPath(file.path);

    if (!this._editor) {
      this._editor = monaco.editor.createDiffEditor(container, {
        theme: 'ac-dc-dark',
        automaticLayout: false,
        renderSideBySide: true,
        readOnly: false,
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        renderWhitespace: 'selection',
      });

      // Resize observer
      this._resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(() => this._editor?.layout());
      });
      this._resizeObserver.observe(container);
    }

    // Dispose old content change listener and models
    if (this._contentChangeDisposable) {
      this._contentChangeDisposable.dispose();
      this._contentChangeDisposable = null;
    }
    const oldModel = this._editor.getModel();
    if (oldModel) {
      if (oldModel.original) oldModel.original.dispose();
      if (oldModel.modified) oldModel.modified.dispose();
    }

    // Create models
    const origModel = monaco.editor.createModel(file.original, lang);
    const modModel = monaco.editor.createModel(file.modified, lang);

    // Set original side read-only
    this._editor.updateOptions({
      readOnly: file.is_read_only,
    });

    this._editor.setModel({
      original: origModel,
      modified: modModel,
    });

    // Track dirty state — look up current index by file identity each time
    const trackedFile = file;
    this._contentChangeDisposable = modModel.onDidChangeContent(() => {
      const currentIndex = this._files.indexOf(trackedFile);
      if (currentIndex < 0) return; // file was closed
      const currentContent = modModel.getValue();
      const isDirty = currentContent !== trackedFile.savedContent;
      const wasDirty = this._dirtySet.has(currentIndex);
      if (isDirty && !wasDirty) {
        this._dirtySet = new Set([...this._dirtySet, currentIndex]);
      } else if (!isDirty && wasDirty) {
        const next = new Set(this._dirtySet);
        next.delete(currentIndex);
        this._dirtySet = next;
      }
    });

    // Register LSP providers if not done
    if (!this._lspRegistered && this.rpcConnected) {
      this._registerLspProviders(monaco);
      this._lspRegistered = true;
    }
  }

  _disposeEditor() {
    if (this._contentChangeDisposable) {
      this._contentChangeDisposable.dispose();
      this._contentChangeDisposable = null;
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._editor) {
      const oldModel = this._editor.getModel();
      if (oldModel) {
        if (oldModel.original) oldModel.original.dispose();
        if (oldModel.modified) oldModel.modified.dispose();
      }
      this._editor.dispose();
      this._editor = null;
    }
    if (this._styleObserver) {
      this._styleObserver.disconnect();
      this._styleObserver = null;
    }
  }

  _injectMonacoStyles() {
    // Copy styles from document head into shadow root once
    if (this._stylesInjected) return;
    this._stylesInjected = true;
    const sr = this.shadowRoot;
    for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
      sr.appendChild(node.cloneNode(true));
    }
    // Watch for dynamically added styles
    this._styleObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const added of m.addedNodes) {
          if (added.tagName === 'STYLE' || (added.tagName === 'LINK' && added.rel === 'stylesheet')) {
            sr.appendChild(added.cloneNode(true));
          }
        }
      }
    });
    this._styleObserver.observe(document.head, { childList: true });
  }

  // ── Preview ──────────────────────────────────────────────────

  _isMarkdown() {
    const file = this._files[this._activeIndex];
    if (!file) return false;
    const ext = file.path.substring(file.path.lastIndexOf('.')).toLowerCase();
    return ext === '.md' || ext === '.markdown';
  }

  async _togglePreview() {
    if (this._activeIndex < 0) return;

    this._previewMode = !this._previewMode;

    if (this._previewMode) {
      // Switch to inline diff mode for half-width editor
      await this._recreateEditorForPreview();
      this._updatePreview();
    } else {
      // Switch back to side-by-side diff
      await this._recreateEditorForDiff();
    }
  }

  async _recreateEditorForPreview() {
    const file = this._activeIndex >= 0 ? this._files[this._activeIndex] : null;
    if (!file || !this._editor) {
      this._previewMode = false;
      return;
    }

    // Save current content
    const mod = this._editor.getModifiedEditor();
    if (mod) {
      file.modified = mod.getValue();
    }

    this._disposeEditor();
    await this.updateComplete;
    await this._ensureMonaco();

    const container = this.shadowRoot?.querySelector('.editor-half');
    if (!container) return;

    this._injectMonacoStyles();
    const monaco = this._monaco;
    const lang = _langFromPath(file.path);

    this._editor = monaco.editor.createDiffEditor(container, {
      theme: 'ac-dc-dark',
      automaticLayout: false,
      renderSideBySide: false, // Inline diff for preview mode
      readOnly: false,
      minimap: { enabled: false },
      fontSize: 13,
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      wordWrap: 'on', // Word wrap for half-width editing
      renderWhitespace: 'selection',
    });

    const origModel = monaco.editor.createModel(file.original, lang);
    const modModel = monaco.editor.createModel(file.modified, lang);
    this._editor.updateOptions({ readOnly: file.is_read_only });
    this._editor.setModel({ original: origModel, modified: modModel });

    // Track dirty + live preview update
    const trackedFile = file;
    this._contentChangeDisposable = modModel.onDidChangeContent(() => {
      const currentIndex = this._files.indexOf(trackedFile);
      if (currentIndex < 0) return;
      const currentContent = modModel.getValue();
      const isDirty = currentContent !== trackedFile.savedContent;
      const wasDirty = this._dirtySet.has(currentIndex);
      if (isDirty && !wasDirty) {
        this._dirtySet = new Set([...this._dirtySet, currentIndex]);
      } else if (!isDirty && wasDirty) {
        const next = new Set(this._dirtySet);
        next.delete(currentIndex);
        this._dirtySet = next;
      }
      // Live preview update
      this._updatePreview();
    });

    // Set up scroll sync (editor → preview)
    const modEditor = this._editor.getModifiedEditor();
    if (modEditor) {
      modEditor.onDidScrollChange(() => {
        if (this._scrollLock === 'preview') return;
        this._scrollLock = 'editor';
        clearTimeout(this._scrollLockTimer);
        this._scrollLockTimer = setTimeout(() => { this._scrollLock = null; }, 120);
        this._syncEditorToPreview();
      });
    }

    // Resize observer for preview mode
    if (this._resizeObserver) this._resizeObserver.disconnect();
    this._resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => this._editor?.layout());
    });
    this._resizeObserver.observe(container);
  }

  async _recreateEditorForDiff() {
    if (this._activeIndex < 0) return;
    const file = this._files[this._activeIndex];
    if (!file) return;

    // Save content from inline editor
    if (this._editor) {
      const mod = this._editor.getModifiedEditor();
      if (mod) file.modified = mod.getValue();
    }

    this._disposeEditor();
    this._previewHtml = '';
    await this.updateComplete;

    // Recreate side-by-side editor
    if (this._activeIndex >= 0) {
      this._showFile(this._activeIndex);
    }
  }

  _updatePreview() {
    if (!this._previewMode || !this._editor) return;
    const mod = this._editor.getModifiedEditor();
    if (!mod) return;

    const source = mod.getValue();
    import('../utils/markdown.js').then(({ renderMarkdownWithSourceMap }) => {
      this._previewHtml = renderMarkdownWithSourceMap(source);
      this.updateComplete.then(() => this._resolvePreviewImages());
    });
  }

  _syncEditorToPreview() {
    if (!this._previewMode || !this._editor) return;
    const mod = this._editor.getModifiedEditor();
    if (!mod) return;

    const lineHeight = mod.getOption(this._monaco.editor.EditorOption.lineHeight);
    const scrollTop = mod.getScrollTop();
    const topLine = Math.floor(scrollTop / lineHeight) + 1;

    const preview = this.shadowRoot?.querySelector('.preview-half');
    if (!preview) return;

    // Find the element with the closest data-source-line
    const anchors = preview.querySelectorAll('[data-source-line]');
    let bestEl = null;
    let bestLine = -1;
    for (const el of anchors) {
      const line = parseInt(el.dataset.sourceLine, 10);
      if (isNaN(line)) continue;
      if (line <= topLine && line > bestLine) {
        bestLine = line;
        bestEl = el;
      }
    }

    if (bestEl) {
      const elTop = bestEl.offsetTop;
      // Interpolate between this anchor and the next
      let nextEl = null;
      let nextLine = Infinity;
      for (const el of anchors) {
        const line = parseInt(el.dataset.sourceLine, 10);
        if (line > bestLine && line < nextLine) {
          nextLine = line;
          nextEl = el;
        }
      }

      let targetScroll = elTop;
      if (nextEl && nextLine !== Infinity) {
        const fraction = (topLine - bestLine) / (nextLine - bestLine);
        const nextTop = nextEl.offsetTop;
        targetScroll = elTop + fraction * (nextTop - elTop);
      }

      preview.scrollTop = Math.max(0, targetScroll - 20);
    }
  }

  _onPreviewScroll(e) {
    if (this._scrollLock === 'editor') return;
    this._scrollLock = 'preview';
    clearTimeout(this._scrollLockTimer);
    this._scrollLockTimer = setTimeout(() => { this._scrollLock = null; }, 120);

    if (!this._editor) return;
    const mod = this._editor.getModifiedEditor();
    if (!mod) return;

    const preview = e.target;
    const scrollTop = preview.scrollTop;

    // Find the anchor at or just before the scroll position
    const anchors = preview.querySelectorAll('[data-source-line]');
    let bestEl = null;
    let bestLine = -1;
    for (const el of anchors) {
      const line = parseInt(el.dataset.sourceLine, 10);
      if (isNaN(line)) continue;
      if (el.offsetTop <= scrollTop + 30 && line > bestLine) {
        bestLine = line;
        bestEl = el;
      }
    }

    if (bestLine >= 0) {
      const lineHeight = mod.getOption(this._monaco.editor.EditorOption.lineHeight);
      mod.setScrollTop((bestLine - 1) * lineHeight);
    }
  }

  async _resolvePreviewImages() {
    const preview = this.shadowRoot?.querySelector('.preview-half');
    if (!preview) return;

    const file = this._files[this._activeIndex];
    if (!file) return;

    const fileDir = file.path.includes('/')
      ? file.path.substring(0, file.path.lastIndexOf('/'))
      : '';

    const images = preview.querySelectorAll('img');
    for (const img of images) {
      let src = img.getAttribute('src') || '';
      // Skip data URIs and absolute URLs
      if (src.startsWith('data:') || src.startsWith('blob:') ||
          src.startsWith('http://') || src.startsWith('https://')) continue;

      // Decode percent-encoding
      try { src = decodeURIComponent(src); } catch (_) {}

      // Resolve relative path
      const resolved = this._normalizePath(fileDir, src);

      // Fetch from repo
      try {
        if (src.endsWith('.svg')) {
          const content = await this.rpcExtract('Repo.get_file_content', resolved);
          if (typeof content === 'string') {
            const encoded = encodeURIComponent(content);
            img.src = `data:image/svg+xml;charset=utf-8,${encoded}`;
          }
        } else {
          const result = await this.rpcExtract('Repo.get_file_base64', resolved);
          if (result?.data_uri) {
            img.src = result.data_uri;
          } else {
            img.alt = `[Failed: ${src}]`;
            img.style.opacity = '0.4';
          }
        }
      } catch (_) {
        img.alt = `[Failed: ${src}]`;
        img.style.opacity = '0.4';
      }
    }
  }

  _normalizePath(base, relative) {
    if (!relative) return relative;
    const parts = (base ? base + '/' + relative : relative).split('/');
    const normalized = [];
    for (const part of parts) {
      if (part === '.' || part === '') continue;
      if (part === '..') { normalized.pop(); continue; }
      normalized.push(part);
    }
    return normalized.join('/');
  }

  // ── Save ─────────────────────────────────────────────────────

  async _saveActive() {
    if (this._activeIndex < 0) return;
    const file = this._files[this._activeIndex];
    if (!file || file.is_read_only) return;

    const mod = this._editor?.getModifiedEditor();
    if (!mod) return;

    const content = mod.getValue();
    file.savedContent = content;
    file.modified = content;

    const next = new Set(this._dirtySet);
    next.delete(this._activeIndex);
    this._dirtySet = next;

    // Dispatch save event
    this.dispatchEvent(new CustomEvent('file-save', {
      detail: {
        path: file.real_path || file.path,
        content,
        isConfig: file.is_config,
        configType: file.config_type,
      },
      bubbles: true,
      composed: true,
    }));
  }

  // ── Navigation ───────────────────────────────────────────────

  _nextFile() {
    if (this._files.length <= 1) return;
    this._saveCurrentViewport();
    if (this._previewMode) {
      this._previewMode = false;
      this._previewHtml = '';
      this._disposeEditor();
    }
    this._activeIndex = (this._activeIndex + 1) % this._files.length;
    this._showFile(this._activeIndex);
    this._dispatchActiveFile(this._files[this._activeIndex].path);
  }

  _prevFile() {
    if (this._files.length <= 1) return;
    this._saveCurrentViewport();
    if (this._previewMode) {
      this._previewMode = false;
      this._previewHtml = '';
      this._disposeEditor();
    }
    this._activeIndex = (this._activeIndex - 1 + this._files.length) % this._files.length;
    this._showFile(this._activeIndex);
    this._dispatchActiveFile(this._files[this._activeIndex].path);
  }

  _revealLine(line) {
    const mod = this._editor?.getModifiedEditor();
    if (mod) {
      mod.revealLineInCenter(line);
      mod.setPosition({ lineNumber: line, column: 1 });
    }
  }

  _searchAndHighlight(text) {
    if (!text || !this._editor) return;
    const mod = this._editor.getModifiedEditor();
    if (!mod) return;
    const model = mod.getModel();
    if (!model) return;

    // Search progressively shorter prefixes
    const lines = text.split('\n');
    for (let len = lines.length; len >= 1; len--) {
      const searchStr = lines.slice(0, len).join('\n');
      const matches = model.findMatches(searchStr, false, false, true, null, false);
      if (matches.length > 0) {
        const range = matches[0].range;
        mod.revealRangeInCenter(range);
        mod.setSelection(range);

        // Highlight for 3 seconds
        const decorations = mod.deltaDecorations([], [{
          range,
          options: {
            className: 'search-highlight-decoration',
            isWholeLine: false,
          },
        }]);
        setTimeout(() => mod.deltaDecorations(decorations, []), 3000);
        return;
      }
    }
  }

  _saveCurrentViewport() {
    // No-op for now — viewport persistence handled at app shell level
  }

  _saveViewportState() {
    const state = this.getViewportState();
    if (state) {
      localStorage.setItem('ac-last-viewport', JSON.stringify(state));
    }
  }

  _dispatchActiveFile(path) {
    window.dispatchEvent(new CustomEvent('active-file-changed', {
      detail: { path },
    }));
  }

  // ── LSP ────────────────────────────────────────────────────────

  _registerLspProviders(monaco) {
    // Hover provider
    monaco.languages.registerHoverProvider('*', {
      provideHover: async (model, position) => {
        const file = this._files[this._activeIndex];
        if (!file) return null;
        try {
          const result = await this.rpcExtract(
            'LLMService.lsp_get_hover',
            file.real_path || file.path,
            position.lineNumber,
            position.column,
          );
          if (result?.contents) {
            return {
              contents: [{ value: result.contents }],
            };
          }
        } catch (_) {}
        return null;
      },
    });

    // Definition provider (Ctrl+Click / F12)
    monaco.languages.registerDefinitionProvider('*', {
      provideDefinition: async (model, position) => {
        const file = this._files[this._activeIndex];
        if (!file) return null;
        try {
          const result = await this.rpcExtract(
            'LLMService.lsp_get_definition',
            file.real_path || file.path,
            position.lineNumber,
            position.column,
          );
          if (result?.file && result?.range) {
            // Cross-file navigation: open target file at position
            if (result.file !== (file.real_path || file.path)) {
              window.dispatchEvent(new CustomEvent('navigate-file', {
                detail: { path: result.file, line: result.range.start_line },
              }));
              return null;
            }
            return {
              uri: model.uri,
              range: {
                startLineNumber: result.range.start_line || 1,
                startColumn: result.range.start_col || 1,
                endLineNumber: result.range.end_line || result.range.start_line || 1,
                endColumn: result.range.end_col || 1,
              },
            };
          }
        } catch (_) {}
        return null;
      },
    });

    // References provider
    monaco.languages.registerReferenceProvider('*', {
      provideReferences: async (model, position, context) => {
        const file = this._files[this._activeIndex];
        if (!file) return [];
        try {
          const results = await this.rpcExtract(
            'LLMService.lsp_get_references',
            file.real_path || file.path,
            position.lineNumber,
            position.column,
          );
          if (Array.isArray(results)) {
            return results.map(r => ({
              uri: monaco.Uri.parse(`file:///${r.file}`),
              range: {
                startLineNumber: r.range?.start_line || 1,
                startColumn: r.range?.start_col || 1,
                endLineNumber: r.range?.end_line || r.range?.start_line || 1,
                endColumn: r.range?.end_col || 1,
              },
            }));
          }
        } catch (_) {}
        return [];
      },
    });

    // Completion provider
    monaco.languages.registerCompletionItemProvider('*', {
      provideCompletionItems: async (model, position) => {
        const file = this._files[this._activeIndex];
        if (!file) return { suggestions: [] };
        const word = model.getWordUntilPosition(position);
        try {
          const items = await this.rpcExtract(
            'LLMService.lsp_get_completions',
            file.real_path || file.path,
            position.lineNumber,
            position.column,
            word.word,
          );
          if (Array.isArray(items)) {
            return {
              suggestions: items.map(item => ({
                label: item.label,
                kind: monaco.languages.CompletionItemKind.Variable,
                detail: item.detail || '',
                insertText: item.label,
                range: {
                  startLineNumber: position.lineNumber,
                  startColumn: word.startColumn,
                  endLineNumber: position.lineNumber,
                  endColumn: word.endColumn,
                },
              })),
            };
          }
        } catch (_) {}
        return { suggestions: [] };
      },
    });
  }

  // ── Render ─────────────────────────────────────────────────────

  render() {
    const hasFiles = this._files.length > 0;
    const file = hasFiles ? this._files[this._activeIndex] : null;
    const isDirty = this._activeIndex >= 0 && this._dirtySet.has(this._activeIndex);
    const showPreviewBtn = file && this._isMarkdown() && !file.is_read_only;

    if (this._previewMode && file) {
      // Preview split layout
      return html`
        <div class="preview-split">
          <div class="editor-half"></div>
          <div class="preview-half" @scroll=${this._onPreviewScroll}>
            <button class="preview-pane-btn" @click=${this._togglePreview}>Preview ✕</button>
            ${this._previewHtml ? unsafeHTML(this._previewHtml) : html`<p style="color:var(--text-muted)">Preview will appear here...</p>`}
          </div>
        </div>

        ${file ? html`
          <div class="status-led ${isDirty ? 'dirty' : file.is_new ? 'new-file' : 'clean'}"
               title="${file.path}${isDirty ? ' — click to save' : ''}"
               @click=${() => isDirty ? this._saveActive() : null}></div>
        ` : ''}
      `;
    }

    return html`
      ${!hasFiles ? html`<div class="watermark">AC⚡DC</div>` : ''}

      <div class="editor-container"
           style="${hasFiles ? '' : 'visibility:hidden'}"></div>

      ${showPreviewBtn ? html`
        <button class="preview-btn" @click=${this._togglePreview}>Preview</button>
      ` : ''}

      ${file ? html`
        <div class="status-led ${isDirty ? 'dirty' : file.is_new ? 'new-file' : 'clean'}"
             title="${file.path}${isDirty ? ' — click to save' : ''}"
             @click=${() => isDirty ? this._saveActive() : null}></div>
      ` : ''}
    `;
  }
}

customElements.define('ac-diff-viewer', AcDiffViewer);