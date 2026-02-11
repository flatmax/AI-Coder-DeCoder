import { LitElement, html, css, nothing } from 'lit';
import { RpcMixin } from '../rpc-mixin.js';

/**
 * Diff Viewer — side-by-side Monaco diff editor with file tabs,
 * dirty tracking, language detection, and save flow.
 */

// Extension → Monaco language ID
const LANG_MAP = {
  '.py': 'python',
  '.js': 'javascript', '.mjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript',
  '.json': 'json',
  '.html': 'html', '.htm': 'html',
  '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.md': 'markdown', '.markdown': 'markdown',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.xml': 'xml', '.svg': 'xml',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
  '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hxx': 'cpp',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.rb': 'ruby',
  '.sql': 'sql',
  '.toml': 'ini',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.txt': 'plaintext',
};

function detectLanguage(filePath) {
  if (!filePath) return 'plaintext';
  const dot = filePath.lastIndexOf('.');
  if (dot < 0) return 'plaintext';
  const ext = filePath.substring(dot).toLowerCase();
  return LANG_MAP[ext] || 'plaintext';
}

/**
 * Map Monaco language IDs to languages the backend symbol index supports.
 * Returns null for unsupported languages (no LSP features).
 */
function isLspSupported(langId) {
  const supported = new Set([
    'python', 'javascript', 'typescript', 'c', 'cpp',
  ]);
  return supported.has(langId);
}

/** @typedef {{ path: string, original: string, modified: string, is_new: boolean, is_read_only?: boolean, is_config?: boolean, config_type?: string, real_path?: string, savedContent: string }} DiffFile */

class DiffViewer extends RpcMixin(LitElement) {
  static properties = {
    _files: { type: Array, state: true },
    _activeIndex: { type: Number, state: true },
    _dirtyPaths: { type: Object, state: true },
    _monacoReady: { type: Boolean, state: true },
  };

  /** The path of the currently active file (read-only, for external consumers). */
  get activePath() {
    if (this._activeIndex >= 0 && this._activeIndex < this._files.length) {
      return this._files[this._activeIndex].path;
    }
    return '';
  }

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      position: relative;
    }

    .container {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      background: var(--bg-primary);
    }

    /* ── Tab bar ── */
    .tab-bar {
      display: flex;
      align-items: center;
      gap: 0;
      padding: 0 4px;
      height: 34px;
      background: var(--bg-elevated);
      border-bottom: 1px solid var(--border-color);
      flex-shrink: 0;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .tab-bar::-webkit-scrollbar { display: none; }

    .tab {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      font-size: 12px;
      font-family: var(--font-mono);
      color: var(--text-secondary);
      cursor: pointer;
      border-right: 1px solid var(--border-color);
      white-space: nowrap;
      transition: background var(--transition-fast), color var(--transition-fast);
      flex-shrink: 0;
      user-select: none;
    }
    .tab:hover {
      background: var(--bg-surface);
      color: var(--text-primary);
    }
    .tab.active {
      background: var(--bg-primary);
      color: var(--text-primary);
      border-bottom: 2px solid var(--accent-primary);
    }

    .tab-badge {
      font-size: 9px;
      font-weight: 700;
      padding: 0px 4px;
      border-radius: 3px;
      color: white;
    }
    .tab-badge.new { background: var(--accent-success); }
    .tab-badge.mod { background: var(--accent-warning); }

    .tab-dirty {
      color: var(--accent-warning);
      font-size: 14px;
      line-height: 1;
    }

    .tab-close {
      font-size: 12px;
      color: var(--text-muted);
      cursor: pointer;
      padding: 0 2px;
      border-radius: 2px;
      line-height: 1;
    }
    .tab-close:hover {
      color: var(--accent-error);
      background: rgba(239,83,80,0.15);
    }

    .tab-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 0 8px;
      margin-left: auto;
      flex-shrink: 0;
    }

    .tab-action-btn {
      background: none;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 2px 8px;
      cursor: pointer;
      font-size: 11px;
      color: var(--text-secondary);
      transition: background var(--transition-fast), color var(--transition-fast);
      white-space: nowrap;
    }
    .tab-action-btn:hover {
      background: var(--bg-surface);
      color: var(--text-primary);
    }
    .tab-action-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .close-all-btn {
      background: none;
      border: none;
      padding: 2px 6px;
      cursor: pointer;
      font-size: 12px;
      color: var(--text-muted);
      border-radius: var(--radius-sm);
      transition: color var(--transition-fast);
    }
    .close-all-btn:hover { color: var(--accent-error); }

    /* ── Editor container ── */
    .editor-wrapper {
      flex: 1;
      position: relative;
      overflow: hidden;
      min-height: 0;
    }

    .editor-container {
      width: 100%;
      height: 100%;
      position: relative;
    }

    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 13px;
    }

    .loading-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 13px;
      gap: 8px;
    }

    .spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid var(--border-color);
      border-top-color: var(--accent-primary);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;

  constructor() {
    super();
    /** @type {DiffFile[]} */
    this._files = [];
    this._activeIndex = -1;
    this._dirtyPaths = new Set();
    this._monacoReady = false;

    this._monaco = null;
    this._editor = null;
    this._styleObserver = null;
    this._lspRegistered = false;
    this._lspDisposables = [];

    this._onKeyDown = this._onKeyDown.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('keydown', this._onKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this._onKeyDown);
    this._disposeLspProviders();
    this._disposeEditor();
    if (this._styleObserver) {
      this._styleObserver.disconnect();
      this._styleObserver = null;
    }
  }

  onRpcReady() {
    this._tryRegisterLsp();
  }

  // ── Public API ──

  get isDirty() {
    return this._dirtyPaths.size > 0;
  }

  get fileCount() {
    return this._files.length;
  }

  /**
   * Open a file in the diff viewer.
   * @param {{ path: string, original?: string, modified?: string, is_new?: boolean, is_read_only?: boolean, is_config?: boolean, config_type?: string, real_path?: string, line?: number }} opts
   */
  async openFile(opts) {
    const { path, original = '', modified = '', is_new = false,
            is_read_only = false, is_config = false, config_type = '',
            real_path = '', line = null } = opts;

    // Check if already open
    const existingIdx = this._files.findIndex(f => f.path === path);
    if (existingIdx >= 0) {
      this._activeIndex = existingIdx;
      await this._ensureMonaco();
      this._showActiveFile();
      if (line) this._revealLine(line);
      this._emitActiveFileChanged();
      return;
    }

    // Add new file
    const file = {
      path,
      original,
      modified,
      is_new,
      is_read_only: !!is_read_only,
      is_config: !!is_config,
      config_type: config_type || '',
      real_path: real_path || '',
      savedContent: modified,
    };

    this._files = [...this._files, file];
    this._activeIndex = this._files.length - 1;

    await this._ensureMonaco();
    this._showActiveFile();
    if (line) this._revealLine(line);
    this._emitActiveFileChanged();
  }

  /**
   * Open a repo file with HEAD vs working copy diff.
   */
  async openRepoFile(path, line = null) {
    if (!this.rpcConnected) return;

    let original = '';
    let modified = '';
    let is_new = false;

    try {
      // Fetch HEAD version
      const headResult = await this.rpcExtract('Repo.get_file_content', path, 'HEAD');
      original = headResult?.content || '';
    } catch {
      // New file — no HEAD version
    }

    try {
      // Fetch working copy
      const workResult = await this.rpcExtract('Repo.get_file_content', path);
      modified = workResult?.content || '';
      if (!original && modified) is_new = true;
    } catch {
      // File doesn't exist in working copy
    }

    await this.openFile({
      path,
      original,
      modified,
      is_new,
      is_read_only: false,
      line,
    });
  }

  /**
   * Open a config file for editing.
   */
  async openConfigFile(configType, label) {
    if (!this.rpcConnected) return;
    try {
      const result = await this.rpcExtract('Settings.get_config_content', configType);
      if (result?.error) {
        console.error('Failed to load config:', result.error);
        return;
      }
      const content = result.content || '';
      const displayPath = `[config] ${label || configType}`;

      await this.openFile({
        path: displayPath,
        original: content,
        modified: content,
        is_config: true,
        config_type: configType,
        real_path: result.path || '',
      });
    } catch (e) {
      console.error('Failed to open config:', e);
    }
  }

  /**
   * Open files from edit results (post-edit refresh).
   */
  async openEditResults(editResults, filesModified) {
    if (!this.rpcConnected || !filesModified?.length) return;

    for (const fpath of filesModified) {
      let original = '';
      let modified = '';
      let is_new = false;

      try {
        const headResult = await this.rpcExtract('Repo.get_file_content', fpath, 'HEAD');
        original = headResult?.content || '';
      } catch {
        // New file
      }

      try {
        const workResult = await this.rpcExtract('Repo.get_file_content', fpath);
        modified = workResult?.content || '';
        if (!original && modified) is_new = true;
      } catch {
        continue;
      }

      // Update if already open, else add
      const existingIdx = this._files.findIndex(f => f.path === fpath);
      if (existingIdx >= 0) {
        const updated = [...this._files];
        updated[existingIdx] = {
          ...updated[existingIdx],
          original,
          modified,
          is_new,
          savedContent: modified,
        };
        this._files = updated;
        this._dirtyPaths = new Set([...this._dirtyPaths].filter(p => p !== fpath));
      } else {
        this._files = [...this._files, {
          path: fpath,
          original,
          modified,
          is_new,
          is_read_only: false,
          is_config: false,
          config_type: '',
          real_path: '',
          savedContent: modified,
        }];
      }
    }

    this._activeIndex = this._files.findIndex(f => filesModified.includes(f.path));
    if (this._activeIndex < 0 && this._files.length > 0) this._activeIndex = 0;
    await this._ensureMonaco();
    this._showActiveFile();
    this._emitActiveFileChanged();
  }

  /**
   * Close all files.
   */
  closeAll() {
    this._files = [];
    this._activeIndex = -1;
    this._dirtyPaths = new Set();
    this._disposeEditor();
    this._emitActiveFileChanged();
  }

  // ── Monaco setup ──

  async _ensureMonaco() {
    if (this._monacoReady) return;

    try {
      // Dynamic import — lazy load Monaco
      // Workers are configured by vite-plugin-monaco-editor automatically
      const monaco = await import('monaco-editor');
      this._monaco = monaco;

      this._monacoReady = true;
      this._tryRegisterLsp();
    } catch (e) {
      console.error('Failed to load Monaco:', e);
    }
  }

  _createEditor() {
    if (!this._monaco || this._editor) return;

    const container = this.shadowRoot.querySelector('.editor-container');
    if (!container) return;

    // Copy Monaco styles into shadow root BEFORE creating the editor,
    // so all CSS (including diff decorations) is available from the start.
    this._injectMonacoStyles();

    this._editor = this._monaco.editor.createDiffEditor(container, {
      theme: 'vs-dark',
      automaticLayout: true,
      readOnly: false,
      originalEditable: false,
      renderSideBySide: true,
      enableSplitViewResizing: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      fontFamily: "var(--font-mono), 'Fira Code', 'Cascadia Code', monospace",
      fixedOverflowWidgets: true,
    });

    // Watch for content changes on the modified editor
    const modifiedEditor = this._editor.getModifiedEditor();
    modifiedEditor.onDidChangeModelContent(() => {
      this._onContentChanged();
    });
  }

  _injectMonacoStyles() {
    const root = this.shadowRoot;
    if (!root) return;

    // Initial sync
    this._syncAllStyles();

    // Monaco dynamically injects <style> tags into document.head (and
    // possibly document.body) for decorations, diff highlighting,
    // colorization, etc. These don't penetrate Shadow DOM.
    // Watch both head and body for changes.
    if (!this._styleObserver) {
      this._styleObserver = new MutationObserver(() => this._syncAllStyles());
      this._styleObserver.observe(document.head, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      this._styleObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
  }

  _syncAllStyles() {
    const root = this.shadowRoot;
    if (!root) return;

    // Strategy: clone all <style> and <link> from document.head into shadow root.
    // Monaco injects its CSS there at runtime. We remove old clones and re-clone
    // everything to catch both new tags and mutations to existing ones.
    root.querySelectorAll('[data-monaco-styles]').forEach(el => el.remove());

    for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
      const clone = node.cloneNode(true);
      clone.setAttribute('data-monaco-styles', 'true');
      root.appendChild(clone);
    }

    // Monaco may also inject <style> tags into document.body or other locations
    for (const node of document.body.querySelectorAll('style')) {
      const clone = node.cloneNode(true);
      clone.setAttribute('data-monaco-styles', 'true');
      root.appendChild(clone);
    }

    // Adopt any constructed stylesheets (CSSStyleSheet objects)
    if (document.adoptedStyleSheets?.length > 0) {
      root.adoptedStyleSheets = [...document.adoptedStyleSheets];
    }

    // Minimal Shadow DOM fixes for Monaco widgets that may not
    // receive proper styling from the cloned stylesheets.
    if (!root.querySelector('#monaco-shadow-fixes')) {
      const fixes = document.createElement('style');
      fixes.id = 'monaco-shadow-fixes';
      fixes.textContent = `
        /* Find widget z-index within shadow root */
        .monaco-editor .find-widget {
          z-index: 100;
        }

        /* Ensure both editor panes receive pointer events for scrolling */
        .monaco-diff-editor .editor.original,
        .monaco-diff-editor .editor.modified {
          pointer-events: auto;
        }

        /* Highlight line decoration (used by _revealLine) */
        .highlight-line {
          background: rgba(79, 195, 247, 0.15) !important;
        }
      `;
      root.appendChild(fixes);
    }
  }

  _disposeEditor() {
    if (this._editor) {
      this._editor.dispose();
      this._editor = null;
    }
  }

  _showActiveFile() {
    if (!this._monaco || this._activeIndex < 0 || this._activeIndex >= this._files.length) return;

    const file = this._files[this._activeIndex];
    const lang = detectLanguage(file.real_path || file.path);

    if (!this._editor) {
      this._createEditor();
    }

    if (!this._editor) return;

    const originalModel = this._monaco.editor.createModel(file.original, lang);
    const modifiedModel = this._monaco.editor.createModel(file.modified, lang);

    // Capture old models before replacing
    const oldModel = this._editor.getModel();

    // Set new model FIRST — editor must release old models before we dispose them
    this._editor.setModel({
      original: originalModel,
      modified: modifiedModel,
    });

    // Now safe to dispose old models
    if (oldModel) {
      if (oldModel.original) oldModel.original.dispose();
      if (oldModel.modified) oldModel.modified.dispose();
    }

    // Set read-only state
    this._editor.getModifiedEditor().updateOptions({
      readOnly: !!file.is_read_only,
    });

    // Layout after model change
    requestAnimationFrame(() => {
      if (this._editor) this._editor.layout();
    });

    // Monaco computes diffs asynchronously — decoration styles may
    // be injected after the diff worker returns. One delayed re-sync
    // as a safety net alongside the MutationObserver.
    setTimeout(() => this._syncAllStyles(), 500);
  }

  _revealLine(line) {
    if (!this._editor || !line) return;
    requestAnimationFrame(() => {
      const modifiedEditor = this._editor.getModifiedEditor();
      modifiedEditor.revealLineInCenter(line);
      modifiedEditor.setPosition({ lineNumber: line, column: 1 });

      // Temporary highlight
      const decorations = modifiedEditor.deltaDecorations([], [{
        range: new this._monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: 'highlight-line',
          overviewRuler: {
            color: '#4fc3f7',
            position: this._monaco.editor.OverviewRulerLane.Full,
          },
        },
      }]);

      // Remove highlight after 2 seconds
      setTimeout(() => {
        if (this._editor) {
          modifiedEditor.deltaDecorations(decorations, []);
        }
      }, 2000);
    });
  }

  // ── Content change tracking ──

  _onContentChanged() {
    if (this._activeIndex < 0 || this._activeIndex >= this._files.length) return;
    const file = this._files[this._activeIndex];
    if (file.is_read_only) return;

    const modifiedEditor = this._editor.getModifiedEditor();
    const currentContent = modifiedEditor.getValue();
    const next = new Set(this._dirtyPaths);

    if (currentContent !== file.savedContent) {
      next.add(file.path);
    } else {
      next.delete(file.path);
    }

    if (next.size !== this._dirtyPaths.size || [...next].some(p => !this._dirtyPaths.has(p))) {
      this._dirtyPaths = next;
      this._emitDirtyChanged();
    }
  }

  _emitDirtyChanged() {
    this.dispatchEvent(new CustomEvent('dirty-changed', {
      detail: { isDirty: this.isDirty, dirtyPaths: [...this._dirtyPaths] },
      bubbles: true, composed: true,
    }));
  }

  _emitActiveFileChanged() {
    this.dispatchEvent(new CustomEvent('active-file-changed', {
      detail: { path: this.activePath },
      bubbles: true, composed: true,
    }));
  }

  // ── Save ──

  async _saveActive() {
    if (this._activeIndex < 0) return;
    await this._saveFile(this._activeIndex);
  }

  async _saveFile(index) {
    const file = this._files[index];
    if (!file || file.is_read_only) return;
    if (!this._editor || this._activeIndex !== index) return;

    const modifiedEditor = this._editor.getModifiedEditor();
    const content = modifiedEditor.getValue();

    // Update saved content
    const updated = [...this._files];
    updated[index] = { ...updated[index], modified: content, savedContent: content };
    this._files = updated;

    // Clear dirty
    const next = new Set(this._dirtyPaths);
    next.delete(file.path);
    this._dirtyPaths = next;
    this._emitDirtyChanged();

    // Dispatch save event for parent to handle
    this.dispatchEvent(new CustomEvent('file-save', {
      detail: {
        path: file.path,
        content,
        isConfig: file.is_config,
        configType: file.config_type,
        realPath: file.real_path,
      },
      bubbles: true, composed: true,
    }));
  }

  async _saveAll() {
    for (let i = 0; i < this._files.length; i++) {
      if (this._dirtyPaths.has(this._files[i].path)) {
        // Switch to file, get content, save
        if (this._activeIndex !== i) {
          this._activeIndex = i;
          this._showActiveFile();
          // Wait for model to update
          await new Promise(r => requestAnimationFrame(r));
        }
        await this._saveFile(i);
      }
    }
  }

  // ── Tab actions ──

  _selectTab(index) {
    if (index === this._activeIndex) return;

    // Before switching: sync current editor content to file state
    this._syncCurrentContent();

    this._activeIndex = index;
    this._showActiveFile();
    this._emitActiveFileChanged();
  }

  _closeTab(index, e) {
    if (e) e.stopPropagation();

    const file = this._files[index];
    const updated = this._files.filter((_, i) => i !== index);
    const next = new Set(this._dirtyPaths);
    next.delete(file.path);
    this._dirtyPaths = next;

    this._files = updated;

    if (updated.length === 0) {
      this._activeIndex = -1;
      this._disposeEditor();
    } else if (this._activeIndex >= updated.length) {
      this._activeIndex = updated.length - 1;
      this._showActiveFile();
    } else if (index <= this._activeIndex) {
      this._activeIndex = Math.max(0, this._activeIndex - 1);
      this._showActiveFile();
    }

    this._emitDirtyChanged();
    this._emitActiveFileChanged();
  }

  _closeAll() {
    this.closeAll();
    this._emitDirtyChanged();
  }

  _syncCurrentContent() {
    if (!this._editor || this._activeIndex < 0 || this._activeIndex >= this._files.length) return;
    const file = this._files[this._activeIndex];
    if (file.is_read_only) return;

    const modifiedEditor = this._editor.getModifiedEditor();
    const content = modifiedEditor.getValue();
    if (content !== file.modified) {
      const updated = [...this._files];
      updated[this._activeIndex] = { ...updated[this._activeIndex], modified: content };
      this._files = updated;
    }
  }

  // ── Keyboard ──

  _onKeyDown(e) {
    if (this._files.length === 0) return;

    // Ctrl+S / Cmd+S — save active file
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      this._saveActive();
      return;
    }

    // Ctrl+W / Cmd+W — close active tab
    if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
      if (this._files.length > 0 && this._activeIndex >= 0) {
        e.preventDefault();
        this._closeTab(this._activeIndex);
      }
    }
  }

  // ── Render ──

  render() {
    return html`
      <div class="container">
        ${this._files.length > 0 ? html`
          ${this._renderTabBar()}
          <div class="editor-wrapper">
            ${this._monacoReady ? html`
              <div class="editor-container"></div>
            ` : html`
              <div class="loading-state"><span class="spinner"></span> Loading editor...</div>
            `}
          </div>
        ` : html`
          <div class="empty-state">No files open</div>
        `}
      </div>
    `;
  }

  _renderTabBar() {
    const hasDirty = this._dirtyPaths.size > 0;

    return html`
      <div class="tab-bar">
        ${this._files.map((file, i) => {
          const isDirty = this._dirtyPaths.has(file.path);
          const isActive = i === this._activeIndex;
          const displayPath = file.path.length > 40
            ? '…' + file.path.slice(-38)
            : file.path;

          return html`
            <div class="tab ${isActive ? 'active' : ''}" @click=${() => this._selectTab(i)}>
              ${file.is_new ? html`<span class="tab-badge new">NEW</span>` : nothing}
              ${!file.is_new && file.original !== file.savedContent ? html`<span class="tab-badge mod">MOD</span>` : nothing}
              <span>${displayPath}</span>
              ${isDirty ? html`<span class="tab-dirty">●</span>` : nothing}
              <span class="tab-close" @click=${(e) => this._closeTab(i, e)}>✕</span>
            </div>
          `;
        })}
        <div class="tab-actions">
          ${hasDirty ? html`
            <button class="tab-action-btn" @click=${this._saveAll}>💾 Save All</button>
          ` : nothing}
          <button class="close-all-btn" @click=${this._closeAll} title="Close all files">✕ All</button>
        </div>
      </div>
    `;
  }

  updated(changedProps) {
    super.updated(changedProps);
    // Ensure editor is created when container becomes available
    if (this._monacoReady && !this._editor && this._files.length > 0) {
      this.updateComplete.then(() => {
        this._createEditor();
        this._showActiveFile();
      });
    }
  }

  // ── LSP Integration ──

  /**
   * Register Monaco language providers once both Monaco and RPC are ready.
   */
  _tryRegisterLsp() {
    if (this._lspRegistered || !this._monacoReady || !this.rpcConnected || !this._monaco) return;
    this._lspRegistered = true;
    console.log('[lsp] Registering Monaco language providers');

    const monaco = this._monaco;
    const viewer = this;

    // Register for all supported languages
    const languages = ['python', 'javascript', 'typescript', 'c', 'cpp'];

    for (const langId of languages) {
      // Hover provider
      this._lspDisposables.push(
        monaco.languages.registerHoverProvider(langId, {
          provideHover: (model, position) => viewer._provideHover(model, position),
        })
      );

      // Definition provider
      this._lspDisposables.push(
        monaco.languages.registerDefinitionProvider(langId, {
          provideDefinition: (model, position) => viewer._provideDefinition(model, position),
        })
      );

      // Reference provider
      this._lspDisposables.push(
        monaco.languages.registerReferenceProvider(langId, {
          provideReferences: (model, position, _ctx) => viewer._provideReferences(model, position),
        })
      );

      // Completion provider
      this._lspDisposables.push(
        monaco.languages.registerCompletionItemProvider(langId, {
          triggerCharacters: ['.', '_'],
          provideCompletionItems: (model, position) => viewer._provideCompletions(model, position),
        })
      );
    }
  }

  _disposeLspProviders() {
    for (const d of this._lspDisposables) {
      try { d.dispose(); } catch {}
    }
    this._lspDisposables = [];
    this._lspRegistered = false;
  }

  /**
   * Get the file path for the model being queried.
   * Compares by URI string since Monaco providers may receive model references
   * that are not identity-equal to the editor's current models.
   */
  _getPathForModel(model) {
    if (!this._editor || this._activeIndex < 0) return null;
    const file = this._files[this._activeIndex];
    if (!file || file.is_config) return null;

    const modelUri = model.uri.toString();

    // Check modified editor's model
    const modifiedModel = this._editor.getModifiedEditor().getModel();
    if (modifiedModel && modifiedModel.uri.toString() === modelUri) {
      return file.real_path || file.path;
    }

    // Also allow original side (read-only, but hover/refs still useful)
    const originalModel = this._editor.getOriginalEditor().getModel();
    if (originalModel && originalModel.uri.toString() === modelUri) {
      return file.real_path || file.path;
    }

    return null;
  }

  async _provideHover(model, position) {
    const path = this._getPathForModel(model);
    if (!path) return null;

    try {
      const result = await this.rpcExtract(
        'LLM.lsp_get_hover', path, position.lineNumber, position.column
      );
      if (!result) return null;
      return {
        contents: [{ value: result, isTrusted: true }],
      };
    } catch (e) {
      console.warn('[lsp] hover error:', e);
      return null;
    }
  }

  async _provideDefinition(model, position) {
    const path = this._getPathForModel(model);
    if (!path) return null;

    try {
      const result = await this.rpcExtract(
        'LLM.lsp_get_definition', path, position.lineNumber, position.column
      );
      if (!result || !result.file) return null;

      const targetFile = result.file;
      const range = result.range || {};
      const targetLine = range.start_line || 1;
      const targetCol = Math.max(1, range.start_col || 1);

      // If definition is in a different file, open it in the diff viewer
      if (targetFile !== path) {
        setTimeout(() => this.openRepoFile(targetFile, targetLine), 0);
        return null;
      }

      // Same file — return location for Monaco to navigate to
      return [{
        uri: model.uri,
        range: new this._monaco.Range(
          targetLine, targetCol,
          range.end_line || targetLine, Math.max(1, range.end_col || targetCol)
        ),
      }];
    } catch (e) {
      console.warn('[lsp] definition error:', e);
      return null;
    }
  }

  async _provideReferences(model, position) {
    const path = this._getPathForModel(model);
    if (!path) return null;

    try {
      const results = await this.rpcExtract(
        'LLM.lsp_get_references', path, position.lineNumber, position.column
      );
      if (!results || !results.length) return null;

      const monaco = this._monaco;
      // For same-file references, use the model's URI so Monaco can display them.
      // For cross-file references, use a file URI (Monaco will show them in peek).
      return results.map(ref => {
        const range = ref.range || {};
        const refFile = ref.file || path;
        const uri = refFile === path ? model.uri : monaco.Uri.parse(`file:///${refFile}`);
        const startLine = range.start_line || ref.line || 1;
        const startCol = Math.max(1, range.start_col || 1);
        return {
          uri,
          range: new monaco.Range(
            startLine,
            startCol,
            range.end_line || startLine,
            Math.max(1, range.end_col || startCol)
          ),
        };
      });
    } catch (e) {
      console.warn('[lsp] references error:', e);
      return null;
    }
  }

  async _provideCompletions(model, position) {
    const path = this._getPathForModel(model);
    if (!path) return null;

    try {
      const word = model.getWordUntilPosition(position);

      const results = await this.rpcExtract(
        'LLM.lsp_get_completions', path, position.lineNumber, position.column
      );
      if (!results || !results.length) return { suggestions: [] };

      const monaco = this._monaco;
      const range = new monaco.Range(
        position.lineNumber, word.startColumn,
        position.lineNumber, word.endColumn
      );

      const KIND_MAP = {
        class: monaco.languages.CompletionItemKind.Class,
        function: monaco.languages.CompletionItemKind.Function,
        method: monaco.languages.CompletionItemKind.Method,
        variable: monaco.languages.CompletionItemKind.Variable,
        property: monaco.languages.CompletionItemKind.Property,
        module: monaco.languages.CompletionItemKind.Module,
        import: monaco.languages.CompletionItemKind.Reference,
      };

      const suggestions = results.map((item, i) => ({
        label: item.label,
        kind: KIND_MAP[item.kind] || monaco.languages.CompletionItemKind.Text,
        detail: item.detail || '',
        insertText: item.label,
        range,
        sortText: String(i).padStart(5, '0'),
      }));

      return { suggestions };
    } catch (e) {
      console.warn('[lsp] completions error:', e);
      return { suggestions: [] };
    }
  }
}

customElements.define('diff-viewer', DiffViewer);