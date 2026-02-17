/**
 * Diff Viewer — Monaco-based side-by-side diff editor.
 *
 * Background layer filling the viewport. Supports:
 * - File tab bar with status badges and save buttons
 * - Side-by-side diff (original read-only, modified editable)
 * - Language detection from file extension
 * - Per-file dirty tracking (savedContent vs current)
 * - Single file save (Ctrl+S) and batch save
 * - Monaco shadow DOM style injection
 * - Worker-safe language handling
 * - LSP integration hooks (hover, definition, references, completions)
 * - Scroll-to-edit-anchor with progressive prefix search
 */

import { LitElement, html, css, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { theme, scrollbarStyles } from '../styles/theme.js';
import { RpcMixin } from '../rpc-mixin.js';
import { renderMarkdown } from '../utils/markdown.js';
import * as monaco from 'monaco-editor';

// Configure Monaco workers — use editor worker for diff computation,
// no-op workers for language services to avoid $loadForeignModule crashes.
self.MonacoEnvironment = {
  getWorker(workerId, label) {
    // The editor worker handles diff computation — it must be real
    if (label === 'editorWorkerService') {
      return new Worker(
        new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
        { type: 'module' }
      );
    }
    // All other workers (language services) — use no-op to avoid crashes
    const blob = new Blob(
      ['self.onmessage = function() {}'],
      { type: 'application/javascript' }
    );
    return new Worker(URL.createObjectURL(blob));
  },
};

// Extension → Monaco language ID
const LANG_MAP = {
  '.js': 'javascript', '.mjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript',
  '.py': 'python',
  '.json': 'json',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.html': 'html', '.htm': 'html',
  '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.md': 'markdown', '.markdown': 'markdown',
  '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hxx': 'cpp',
  '.sh': 'shell', '.bash': 'shell',
  '.xml': 'xml', '.svg': 'xml',
  '.java': 'java',
  '.rs': 'rust',
  '.go': 'go',
  '.rb': 'ruby',
  '.php': 'php',
  '.sql': 'sql',
  '.toml': 'ini',
  '.ini': 'ini',
  '.cfg': 'ini',
};

function detectLanguage(filePath) {
  if (!filePath) return 'plaintext';
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return 'plaintext';
  const ext = filePath.slice(lastDot).toLowerCase();
  return LANG_MAP[ext] || 'plaintext';
}

export class AcDiffViewer extends RpcMixin(LitElement) {
  static properties = {
    _files: { type: Array, state: true },
    _activeIndex: { type: Number, state: true },
    _dirtySet: { type: Object, state: true },
    _previewMode: { type: Boolean, state: true },
  };

  static styles = [theme, scrollbarStyles, css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      overflow: hidden;
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

    /* Editor container */
    .editor-container {
      flex: 1;
      min-height: 0;
      position: relative;
      overflow: hidden;
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

    /* Preview button — top-right, next to status LED */
    .preview-btn {
      position: absolute;
      top: 6px;
      right: 36px;
      z-index: 10;
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px;
      border: 1px solid var(--border, #444);
      border-radius: 4px;
      background: var(--bg-secondary, #1e1e1e);
      color: var(--text-muted, #999);
      font-size: 0.75rem;
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .preview-btn:hover {
      background: var(--bg-tertiary, #2a2a2a);
      color: var(--text-primary, #e0e0e0);
      border-color: var(--text-muted, #666);
    }
    .preview-btn.active {
      background: var(--accent-primary-dim, rgba(79, 195, 247, 0.15));
      color: var(--accent-primary, #4fc3f7);
      border-color: var(--accent-primary, #4fc3f7);
    }
    .preview-btn .preview-icon {
      width: 12px;
      height: 10px;
      border: 1.5px solid currentColor;
      border-radius: 2px;
    }

    /* Split layout for preview mode */
    .split-container {
      display: flex;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }
    .split-container .editor-pane {
      flex: 1;
      min-width: 0;
      position: relative;
      overflow: hidden;
    }
    .split-container .preview-pane {
      flex: 1;
      min-width: 0;
      overflow-y: auto;
      padding: 24px 32px;
      background: var(--bg-primary, #0d1117);
      border-left: 1px solid var(--border, #333);
      font-size: 0.9rem;
      line-height: 1.6;
      color: var(--text-primary, #e0e0e0);
    }

    /* Markdown preview content styling */
    .preview-pane h1, .preview-pane h2, .preview-pane h3,
    .preview-pane h4, .preview-pane h5, .preview-pane h6 {
      color: var(--text-primary, #e0e0e0);
      margin-top: 1.2em;
      margin-bottom: 0.4em;
      border-bottom: 1px solid var(--border, #333);
      padding-bottom: 0.3em;
    }
    .preview-pane h1 { font-size: 1.8em; }
    .preview-pane h2 { font-size: 1.4em; }
    .preview-pane h3 { font-size: 1.15em; }
    .preview-pane p { margin: 0.6em 0; }
    .preview-pane a { color: var(--accent-primary, #4fc3f7); }
    .preview-pane code {
      background: var(--bg-tertiary, #161b22);
      padding: 0.15em 0.4em;
      border-radius: 3px;
      font-size: 0.88em;
    }
    .preview-pane pre {
      background: var(--bg-tertiary, #161b22);
      padding: 12px 16px;
      border-radius: 6px;
      overflow-x: auto;
    }
    .preview-pane pre code {
      background: none;
      padding: 0;
    }
    .preview-pane blockquote {
      border-left: 3px solid var(--accent-primary, #4fc3f7);
      padding-left: 12px;
      margin-left: 0;
      color: var(--text-muted, #999);
    }
    .preview-pane ul, .preview-pane ol {
      padding-left: 1.5em;
    }
    .preview-pane li { margin: 0.25em 0; }
    .preview-pane table {
      border-collapse: collapse;
      width: 100%;
      margin: 0.8em 0;
    }
    .preview-pane th, .preview-pane td {
      border: 1px solid var(--border, #333);
      padding: 6px 12px;
      text-align: left;
    }
    .preview-pane th {
      background: var(--bg-secondary, #1e1e1e);
    }
    .preview-pane img {
      max-width: 100%;
    }
    .preview-pane hr {
      border: none;
      border-top: 1px solid var(--border, #333);
      margin: 1.5em 0;
    }

    /* Highlight animation for scroll-to-edit */
    .highlight-decoration {
      background: rgba(79, 195, 247, 0.2);
    }
  `];

  constructor() {
    super();
    /** @type {Array<{path: string, original: string, modified: string, is_new: boolean, is_read_only: boolean, is_config: boolean, config_type: string, real_path: string, savedContent: string}>} */
    this._files = [];
    this._activeIndex = -1;
    this._dirtySet = new Set();
    this._previewMode = false;
    this._previewContent = '';
    this._editor = null;
    this._editorContainer = null;
    this._resizeObserver = null;
    this._styleObserver = null;
    this._monacoStylesInjected = false;
    this._highlightTimer = null;
    this._highlightDecorations = [];
    this._lspRegistered = false;
    this._virtualContents = {};

    this._onKeyDown = this._onKeyDown.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this._onKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._onKeyDown);
    this._disposeEditor();
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._styleObserver) {
      this._styleObserver.disconnect();
      this._styleObserver = null;
    }
  }

  firstUpdated() {
    this._editorContainer = this.shadowRoot.querySelector('.editor-pane') ||
                             this.shadowRoot.querySelector('.editor-container');
    if (this._editorContainer) {
      this._resizeObserver = new ResizeObserver(() => {
        if (this._editor) {
          this._editor.layout();
        }
      });
      this._resizeObserver.observe(this._editorContainer);
    }
  }

  onRpcReady() {
    this._registerLspProviders();
  }

  // === Public API ===

  /**
   * Open or navigate to a file.
   * @param {object} opts - { path, original?, modified?, is_new?, is_read_only?, is_config?, config_type?, real_path?, searchText?, line? }
   */
  async openFile(opts) {
    const { path, searchText, line } = opts;
    if (!path) return;

    // Store virtual content if provided (for URL content viewing, etc.)
    if (opts.virtualContent != null) {
      this._virtualContents[path] = opts.virtualContent;
    }

    // Check if already open
    const existingIdx = this._files.findIndex(f => f.path === path);
    if (existingIdx !== -1) {
      this._activeIndex = existingIdx;
      await this.updateComplete;
      this._showEditor();
      if (line != null) {
        this._scrollToLine(line);
      } else if (searchText) {
        this._scrollToSearchText(searchText);
      }
      this._dispatchActiveFileChanged(path);
      return;
    }

    // Determine content — caller can provide, or we fetch
    let original = opts.original ?? '';
    let modified = opts.modified ?? '';
    let is_new = opts.is_new ?? false;
    let is_read_only = opts.is_read_only ?? false;

    if (opts.virtualContent != null) {
      // Virtual content provided directly — no fetch needed
      original = '';
      modified = opts.virtualContent;
      is_new = true;
      is_read_only = opts.readOnly ?? true;
    } else if (!opts.original && !opts.modified) {
      // Fetch from server
      const content = await this._fetchFileContent(path);
      if (content === null) return;
      original = content.original;
      modified = content.modified;
      is_new = content.is_new;
      is_read_only = content.is_read_only ?? false;
    }

    const fileObj = {
      path,
      original,
      modified,
      is_new,
      is_read_only: is_read_only ?? false,
      is_config: opts.is_config ?? false,
      config_type: opts.config_type ?? null,
      real_path: opts.real_path ?? null,
      savedContent: modified,
    };

    this._files = [...this._files, fileObj];
    this._activeIndex = this._files.length - 1;

    await this.updateComplete;
    this._showEditor();

    if (line != null) {
      this._scrollToLine(line);
    } else if (searchText) {
      this._scrollToSearchText(searchText);
    }

    this._dispatchActiveFileChanged(path);
  }

  /**
   * Refresh already-open files after edits are applied.
   * Only reloads files that are currently open. Does not open new tabs.
   */
  async refreshOpenFiles() {
    const updatedFiles = [];
    let changed = false;

    for (const file of this._files) {
      if (file.is_config) {
        updatedFiles.push(file);
        continue;
      }
      const content = await this._fetchFileContent(file.path);
      if (content === null) {
        updatedFiles.push(file);
        continue;
      }
      const updated = {
        ...file,
        original: content.original,
        modified: content.modified,
        is_new: content.is_new,
        savedContent: content.modified,
      };
      updatedFiles.push(updated);
      changed = true;
    }

    if (changed) {
      this._files = updatedFiles;
      this._dirtySet = new Set();
      await this.updateComplete;
      this._showEditor();
    }
  }

  /**
   * Close a file tab.
   */
  closeFile(path) {
    delete this._virtualContents[path];
    const idx = this._files.findIndex(f => f.path === path);
    if (idx === -1) return;

    this._dirtySet.delete(path);
    this._files = this._files.filter(f => f.path !== path);

    if (this._files.length === 0) {
      this._activeIndex = -1;
      this._disposeEditor();
      this._dispatchActiveFileChanged(null);
    } else if (this._activeIndex >= this._files.length) {
      this._activeIndex = this._files.length - 1;
      this._showEditor();
      this._dispatchActiveFileChanged(this._files[this._activeIndex].path);
    } else if (idx <= this._activeIndex) {
      this._activeIndex = Math.max(0, this._activeIndex - 1);
      this._showEditor();
      this._dispatchActiveFileChanged(this._files[this._activeIndex].path);
    }
  }

  /**
   * Get list of dirty file paths.
   */
  getDirtyFiles() {
    return [...this._dirtySet];
  }

  // === Viewport State (for restore on refresh) ===

  /**
   * Return the current scroll position and cursor for persistence.
   */
  getViewportState() {
    if (!this._editor) return null;
    const modified = this._editor.getModifiedEditor();
    if (!modified) return null;
    const pos = modified.getPosition();
    return {
      scrollTop: modified.getScrollTop(),
      scrollLeft: modified.getScrollLeft(),
      lineNumber: pos?.lineNumber ?? 1,
      column: pos?.column ?? 1,
    };
  }

  /**
   * Restore scroll position and cursor from saved state.
   */
  restoreViewportState(state) {
    if (!state) return;

    // Poll until the editor is ready (it's created asynchronously after file fetch)
    const tryRestore = (attempts = 0) => {
      const editor = this._editor;
      const modified = editor?.getModifiedEditor?.();
      if (modified) {
        requestAnimationFrame(() => {
          if (state.lineNumber) {
            modified.setPosition({ lineNumber: state.lineNumber, column: state.column ?? 1 });
            modified.revealLineInCenter(state.lineNumber);
          }
          if (state.scrollTop != null) {
            modified.setScrollTop(state.scrollTop);
          }
          if (state.scrollLeft != null) {
            modified.setScrollLeft(state.scrollLeft);
          }
        });
      } else if (attempts < 20) {
        requestAnimationFrame(() => tryRestore(attempts + 1));
      }
    };
    requestAnimationFrame(() => tryRestore());
  }

  // === File Fetching ===

  async _fetchFileContent(path) {
    // Virtual files (URL content, etc.) — use stored content, skip RPC
    if (path.startsWith('virtual://')) {
      const virtualContent = this._virtualContents[path] || '(no content)';
      return { original: '', modified: virtualContent };
    }

    if (!this.rpcConnected) return null;
    try {
      // Try to get HEAD version for diff
      let original = '';
      let modified = '';
      let is_new = false;
      let is_read_only = false;

      const headResult = await this.rpcExtract('Repo.get_file_content', path, 'HEAD');
      const workResult = await this.rpcExtract('Repo.get_file_content', path);

      if (headResult?.error && workResult?.error) {
        console.warn('File not found:', path);
        return null;
      }

      if (headResult?.error) {
        // New file — no HEAD version
        is_new = true;
        original = '';
        modified = workResult?.content ?? workResult ?? '';
      } else if (workResult?.error) {
        // Deleted file
        original = headResult?.content ?? headResult ?? '';
        modified = '';
        is_read_only = true;
      } else {
        original = headResult?.content ?? headResult ?? '';
        modified = workResult?.content ?? workResult ?? '';
      }

      return { original, modified, is_new, is_read_only };
    } catch (e) {
      console.warn('Failed to fetch file content:', path, e);
      return null;
    }
  }

  // === Editor Management ===

  _showEditor() {
    if (this._activeIndex < 0 || this._activeIndex >= this._files.length) {
      this._disposeEditor();
      return;
    }

    const file = this._files[this._activeIndex];
    const container = this._editorContainer;
    if (!container) return;

    this._injectMonacoStyles();

    const language = detectLanguage(file.path);

    const renderSideBySide = !this._previewMode;

    if (this._editor) {
      // Dispose old models before creating new ones to prevent leaks
      // that break diff computation
      const oldModel = this._editor.getModel();
      if (oldModel) {
        if (oldModel.original) oldModel.original.dispose();
        if (oldModel.modified) oldModel.modified.dispose();
      }

      // Switch between side-by-side and inline mode
      this._editor.updateOptions({ renderSideBySide });

      // Update models in existing editor
      const originalModel = monaco.editor.createModel(file.original, language);
      const modifiedModel = monaco.editor.createModel(file.modified, language);

      this._editor.setModel({
        original: originalModel,
        modified: modifiedModel,
      });

      // Set read-only state on modified side
      this._editor.getModifiedEditor().updateOptions({
        readOnly: file.is_read_only,
      });
    } else {
      // Create new diff editor
      this._editor = monaco.editor.createDiffEditor(container, {
        theme: 'vs-dark',
        automaticLayout: false,
        minimap: { enabled: false },
        renderSideBySide,
        readOnly: false,
        originalEditable: false,
        scrollBeyondLastLine: false,
        fontSize: 13,
        lineNumbers: 'on',
        glyphMargin: false,
        folding: true,
        wordWrap: this._previewMode ? 'on' : 'off',
        renderWhitespace: 'selection',
        contextmenu: true,
        scrollbar: {
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
        },
      });

      const originalModel = monaco.editor.createModel(file.original, language);
      const modifiedModel = monaco.editor.createModel(file.modified, language);

      this._editor.setModel({
        original: originalModel,
        modified: modifiedModel,
      });

      this._editor.getModifiedEditor().updateOptions({
        readOnly: file.is_read_only,
      });

      // Track dirty state on modified editor
      this._editor.getModifiedEditor().onDidChangeModelContent(() => {
        this._checkDirty();
        if (this._previewMode) this._updatePreview();
      });
    }

    this._editor.layout();

    if (this._previewMode) {
      this._updatePreview();
    }
  }

  _disposeEditor() {
    if (this._editor) {
      // Dispose models
      const model = this._editor.getModel();
      if (model) {
        if (model.original) model.original.dispose();
        if (model.modified) model.modified.dispose();
      }
      this._editor.dispose();
      this._editor = null;
    }
    this._highlightDecorations = [];
  }

  _checkDirty() {
    if (this._activeIndex < 0 || this._activeIndex >= this._files.length) return;
    const file = this._files[this._activeIndex];
    const currentContent = this._editor?.getModifiedEditor()?.getValue() ?? '';
    const isDirty = currentContent !== file.savedContent;

    const newSet = new Set(this._dirtySet);
    if (isDirty) {
      newSet.add(file.path);
    } else {
      newSet.delete(file.path);
    }
    this._dirtySet = newSet;
  }

  // === Monaco Shadow DOM Style Injection ===

  _injectMonacoStyles() {
    if (this._monacoStylesInjected) return;
    this._monacoStylesInjected = true;

    const shadowRoot = this.shadowRoot;

    // Clone existing Monaco styles from document.head into shadow root
    this._syncAllStyles(shadowRoot);

    // Watch for new styles being added/removed from document.head
    this._styleObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeName === 'STYLE' || node.nodeName === 'LINK') {
            const clone = node.cloneNode(true);
            clone.setAttribute('data-monaco-injected', 'true');
            shadowRoot.appendChild(clone);
          }
        }
        for (const node of mutation.removedNodes) {
          if (node.nodeName === 'STYLE' || node.nodeName === 'LINK') {
            // Find and remove the corresponding clone
            const injected = shadowRoot.querySelectorAll('[data-monaco-injected]');
            for (const el of injected) {
              if (el.textContent === node.textContent) {
                el.remove();
                break;
              }
            }
          }
        }
      }
    });
    this._styleObserver.observe(document.head, { childList: true });
  }

  _syncAllStyles(shadowRoot) {
    const styles = document.head.querySelectorAll('style, link[rel="stylesheet"]');
    for (const style of styles) {
      const clone = style.cloneNode(true);
      clone.setAttribute('data-monaco-injected', 'true');
      shadowRoot.appendChild(clone);
    }
  }

  // === Save ===

  _onKeyDown(e) {
    // Ctrl+S / Cmd+S to save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      this._saveActiveFile();
      return;
    }
    // Ctrl+PageUp / Ctrl+PageDown to switch open files
    if ((e.ctrlKey || e.metaKey) && e.key === 'PageDown') {
      e.preventDefault();
      if (this._files.length > 1) {
        this._activeIndex = (this._activeIndex + 1) % this._files.length;
        this._showEditor();
        this._dispatchActiveFileChanged(this._files[this._activeIndex].path);
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'PageUp') {
      e.preventDefault();
      if (this._files.length > 1) {
        this._activeIndex = (this._activeIndex - 1 + this._files.length) % this._files.length;
        this._showEditor();
        this._dispatchActiveFileChanged(this._files[this._activeIndex].path);
      }
      return;
    }
    // Ctrl+W to close active file
    if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
      e.preventDefault();
      if (this._files.length > 0 && this._activeIndex >= 0) {
        this.closeFile(this._files[this._activeIndex].path);
      }
    }
  }

  _saveActiveFile() {
    if (this._activeIndex < 0 || this._activeIndex >= this._files.length) return;
    const file = this._files[this._activeIndex];
    if (!this._dirtySet.has(file.path)) return;

    const content = this._editor?.getModifiedEditor()?.getValue() ?? '';
    this._doSave(file, content);
  }

  _saveFile(path) {
    const idx = this._files.findIndex(f => f.path === path);
    if (idx === -1) return;
    const file = this._files[idx];

    // If this is the active file, get content from editor
    let content;
    if (idx === this._activeIndex && this._editor) {
      content = this._editor.getModifiedEditor().getValue();
    } else {
      // File not currently in editor — use last known modified
      content = file.modified;
    }

    this._doSave(file, content);
  }

  _doSave(file, content) {
    // Update saved content
    const updatedFiles = this._files.map(f => {
      if (f.path === file.path) {
        return { ...f, modified: content, savedContent: content };
      }
      return f;
    });
    this._files = updatedFiles;

    // Clear dirty
    const newDirty = new Set(this._dirtySet);
    newDirty.delete(file.path);
    this._dirtySet = newDirty;

    // Dispatch save event on window so app shell can route it
    window.dispatchEvent(new CustomEvent('file-save', {
      detail: {
        path: file.path,
        content,
        isConfig: file.is_config,
        configType: file.config_type,
      },
    }));
  }

  /**
   * Save all dirty files.
   */
  saveAll() {
    for (const path of this._dirtySet) {
      this._saveFile(path);
    }
  }

  // === Navigation ===

  _scrollToLine(lineNumber) {
    if (!this._editor) return;
    const editor = this._editor.getModifiedEditor();
    requestAnimationFrame(() => {
      editor.revealLineInCenter(lineNumber);
      editor.setPosition({ lineNumber, column: 1 });
      editor.focus();
    });
  }

  _scrollToSearchText(searchText) {
    if (!this._editor || !searchText) return;
    const editor = this._editor.getModifiedEditor();
    const model = editor.getModel();
    if (!model) return;

    // Try progressively shorter prefixes of the search text
    const lines = searchText.split('\n');
    for (let len = lines.length; len >= 1; len--) {
      const prefix = lines.slice(0, len).join('\n').trim();
      if (!prefix) continue;

      const match = model.findNextMatch(prefix, { lineNumber: 1, column: 1 }, false, true, null, false);
      if (match) {
        requestAnimationFrame(() => {
          editor.revealLineInCenter(match.range.startLineNumber);
          editor.setSelection(match.range);
          editor.focus();

          // 3-second highlight
          this._applyHighlight(editor, match.range);
        });
        return;
      }
    }

    // Fallback: try first non-empty line
    const firstLine = lines.find(l => l.trim());
    if (firstLine) {
      const match = model.findNextMatch(firstLine.trim(), { lineNumber: 1, column: 1 }, false, true, null, false);
      if (match) {
        requestAnimationFrame(() => {
          editor.revealLineInCenter(match.range.startLineNumber);
          editor.setSelection(match.range);
          editor.focus();
          this._applyHighlight(editor, match.range);
        });
      }
    }
  }

  _applyHighlight(editor, range) {
    // Clear previous highlight timer
    if (this._highlightTimer) {
      clearTimeout(this._highlightTimer);
    }

    // Remove old decorations
    this._highlightDecorations = editor.deltaDecorations(this._highlightDecorations, [
      {
        range,
        options: {
          isWholeLine: true,
          className: 'highlight-decoration',
          overviewRuler: { color: '#4fc3f7', position: monaco.editor.OverviewRulerLane.Full },
        },
      },
    ]);

    // Remove after 3 seconds
    this._highlightTimer = setTimeout(() => {
      this._highlightDecorations = editor.deltaDecorations(this._highlightDecorations, []);
    }, 3000);
  }

  _dispatchActiveFileChanged(path) {
    window.dispatchEvent(new CustomEvent('active-file-changed', {
      detail: { path },
    }));
  }

  // === LSP Providers ===

  _registerLspProviders() {
    if (this._lspRegistered) return;
    this._lspRegistered = true;

    // Hover provider
    monaco.languages.registerHoverProvider('*', {
      provideHover: async (model, position) => {
        if (!this.rpcConnected) return null;
        const file = this._getFileForModel(model);
        if (!file) return null;
        try {
          const result = await this.rpcExtract(
            'LLMService.lsp_get_hover', file.path,
            position.lineNumber - 1, position.column - 1
          );
          if (result?.contents) {
            return {
              contents: [{ value: result.contents }],
              range: result.range ? new monaco.Range(
                result.range.start_line + 1, result.range.start_col + 1,
                result.range.end_line + 1, result.range.end_col + 1
              ) : undefined,
            };
          }
        } catch (e) {
          // Ignore
        }
        return null;
      },
    });

    // Definition provider
    monaco.languages.registerDefinitionProvider('*', {
      provideDefinition: async (model, position) => {
        if (!this.rpcConnected) return null;
        const file = this._getFileForModel(model);
        if (!file) return null;
        try {
          const result = await this.rpcExtract(
            'LLMService.lsp_get_definition', file.path,
            position.lineNumber - 1, position.column - 1
          );
          if (result?.file && result?.range) {
            // Open target file if needed
            await this.openFile({ path: result.file, line: result.range.start_line + 1 });
            return {
              uri: monaco.Uri.parse(`file:///${result.file}`),
              range: new monaco.Range(
                result.range.start_line + 1, result.range.start_col + 1,
                result.range.end_line + 1, result.range.end_col + 1
              ),
            };
          }
        } catch (e) {
          // Ignore
        }
        return null;
      },
    });

    // References provider
    monaco.languages.registerReferenceProvider('*', {
      provideReferences: async (model, position) => {
        if (!this.rpcConnected) return null;
        const file = this._getFileForModel(model);
        if (!file) return null;
        try {
          const result = await this.rpcExtract(
            'LLMService.lsp_get_references', file.path,
            position.lineNumber - 1, position.column - 1
          );
          if (Array.isArray(result)) {
            return result.map(ref => ({
              uri: monaco.Uri.parse(`file:///${ref.file}`),
              range: new monaco.Range(
                ref.range.start_line + 1, ref.range.start_col + 1,
                ref.range.end_line + 1, ref.range.end_col + 1
              ),
            }));
          }
        } catch (e) {
          // Ignore
        }
        return null;
      },
    });

    // Completion provider
    monaco.languages.registerCompletionItemProvider('*', {
      triggerCharacters: ['.'],
      provideCompletionItems: async (model, position) => {
        if (!this.rpcConnected) return { suggestions: [] };
        const file = this._getFileForModel(model);
        if (!file) return { suggestions: [] };

        // Get word at position for prefix
        const word = model.getWordUntilPosition(position);
        const prefix = word?.word || '';

        try {
          const result = await this.rpcExtract(
            'LLMService.lsp_get_completions', file.path,
            position.lineNumber - 1, position.column - 1, prefix
          );
          if (Array.isArray(result)) {
            const range = new monaco.Range(
              position.lineNumber, word.startColumn,
              position.lineNumber, word.endColumn
            );
            return {
              suggestions: result.map(item => ({
                label: item.label,
                kind: this._mapCompletionKind(item.kind),
                detail: item.detail || '',
                insertText: item.label,
                range,
              })),
            };
          }
        } catch (e) {
          // Ignore
        }
        return { suggestions: [] };
      },
    });
  }

  _getFileForModel(model) {
    // Match model content against active file
    if (this._activeIndex >= 0 && this._activeIndex < this._files.length) {
      return this._files[this._activeIndex];
    }
    return null;
  }

  _mapCompletionKind(kind) {
    const map = {
      class: monaco.languages.CompletionItemKind.Class,
      function: monaco.languages.CompletionItemKind.Function,
      method: monaco.languages.CompletionItemKind.Method,
      variable: monaco.languages.CompletionItemKind.Variable,
      property: monaco.languages.CompletionItemKind.Property,
      import: monaco.languages.CompletionItemKind.Module,
    };
    return map[kind] || monaco.languages.CompletionItemKind.Text;
  }

  // === Preview ===

  _isMarkdownFile(path) {
    if (!path) return false;
    const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
    return ext === '.md' || ext === '.markdown';
  }

  _togglePreview() {
    this._previewMode = !this._previewMode;
    if (this._previewMode) {
      this._updatePreview();
    }
    // Re-create editor with new layout mode
    this._disposeEditor();
    this.updateComplete.then(() => {
      this._editorContainer = this.shadowRoot.querySelector('.editor-pane') ||
                               this.shadowRoot.querySelector('.editor-container');
      if (this._editorContainer) {
        if (this._resizeObserver) this._resizeObserver.disconnect();
        this._resizeObserver = new ResizeObserver(() => {
          if (this._editor) this._editor.layout();
        });
        this._resizeObserver.observe(this._editorContainer);
      }
      this._showEditor();
    });
  }

  _updatePreview() {
    if (!this._editor) {
      const file = this._activeIndex >= 0 ? this._files[this._activeIndex] : null;
      this._previewContent = file ? renderMarkdown(file.modified) : '';
    } else {
      const content = this._editor.getModifiedEditor()?.getValue() ?? '';
      this._previewContent = renderMarkdown(content);
    }
    this.requestUpdate();
  }

  // === Rendering ===

  render() {
    const hasFiles = this._files.length > 0;
    const file = hasFiles && this._activeIndex >= 0 ? this._files[this._activeIndex] : null;
    const isDirty = file ? this._dirtySet.has(file.path) : false;
    const showPreviewBtn = file && this._isMarkdownFile(file.path);

    if (this._previewMode && file) {
      return html`
        <div class="split-container">
          <div class="editor-pane">
            ${this._renderOverlayButtons(file, isDirty, showPreviewBtn)}
          </div>
          <div class="preview-pane">
            ${unsafeHTML(this._previewContent)}
          </div>
        </div>
      `;
    }

    return html`
      <div class="editor-container">
        ${this._renderOverlayButtons(file, isDirty, showPreviewBtn)}
        ${!hasFiles ? html`
          <div class="empty-state">
            <div class="watermark">AC⚡DC</div>
          </div>
        ` : nothing}
      </div>
    `;
  }

  _renderOverlayButtons(file, isDirty, showPreviewBtn) {
    if (!file) return nothing;
    return html`
      ${showPreviewBtn ? html`
        <button
          class="preview-btn ${this._previewMode ? 'active' : ''}"
          title="Toggle Markdown preview"
          @click=${() => this._togglePreview()}
        >
          <span class="preview-icon"></span>
          Preview
        </button>
      ` : nothing}
      <button
        class="status-led ${isDirty ? 'dirty' : file.is_new ? 'new-file' : 'clean'}"
        title="${file.path}${isDirty ? ' — unsaved (Ctrl+S to save)' : file.is_new ? ' — new file' : ''}"
        aria-label="${file.path}${isDirty ? ', unsaved changes, press to save' : file.is_new ? ', new file' : ', no changes'}"
        @click=${() => isDirty ? this._saveActiveFile() : null}
      ></button>
    `;
  }
}

customElements.define('ac-diff-viewer', AcDiffViewer);