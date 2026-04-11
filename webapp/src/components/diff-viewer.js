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
import { renderMarkdown, renderMarkdownWithSourceMap } from '../utils/markdown.js';
import katex from 'katex';
import * as monaco from 'monaco-editor';

// === Register MATLAB language with Monarch tokenizer ===
monaco.languages.register({ id: 'matlab' });
monaco.languages.setMonarchTokensProvider('matlab', {
  defaultToken: '',
  tokenPostfix: '.matlab',

  keywords: [
    'break', 'case', 'catch', 'classdef', 'continue', 'else', 'elseif',
    'end', 'enumeration', 'events', 'for', 'function', 'global', 'if',
    'methods', 'otherwise', 'parfor', 'persistent', 'properties',
    'return', 'spmd', 'switch', 'try', 'while',
  ],

  builtins: [
    'abs', 'all', 'any', 'ceil', 'cell', 'char', 'class', 'clear',
    'close', 'deal', 'diag', 'disp', 'double', 'eig', 'eps', 'error',
    'eval', 'exist', 'eye', 'false', 'fclose', 'feval', 'fft', 'figure',
    'find', 'floor', 'fopen', 'fprintf', 'getfield', 'hold', 'ifft',
    'imag', 'inf', 'int32', 'inv', 'ischar', 'isempty', 'isequal',
    'isfield', 'isnan', 'isnumeric', 'length', 'linspace', 'logical',
    'max', 'mean', 'min', 'mod', 'nan', 'nargin', 'nargout', 'norm',
    'numel', 'ones', 'pi', 'plot', 'rand', 'randn', 'real', 'regexp',
    'repmat', 'reshape', 'round', 'set', 'setfield', 'single', 'size',
    'sort', 'sparse', 'sprintf', 'sqrt', 'squeeze', 'strcmp', 'struct',
    'subplot', 'sum', 'title', 'true', 'uint8', 'uint32', 'varargin',
    'varargout', 'warning', 'xlabel', 'ylabel', 'zeros',
  ],

  operators: [
    '=', '>', '<', '~', '==', '<=', '>=', '~=',
    '&', '|', '&&', '||',
    '+', '-', '*', '/', '\\', '^',
    '.*', './', '.\\', '.^', '.\'',
  ],

  symbols: /[=><!~?:&|+\-*\/\\^.]+/,

  escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4})/,

  tokenizer: {
    root: [
      // Comments — line comment starts with %
      [/%\{/, 'comment', '@blockComment'],
      [/%.*$/, 'comment'],

      // Strings — single-quoted
      [/'(?:[^'\\]|\\.)*'/, 'string'],

      // Strings — double-quoted
      [/"(?:[^"\\]|\\.)*"/, 'string'],

      // Numbers
      [/\d+\.?\d*(?:[eE][+-]?\d+)?[ij]?/, 'number'],
      [/\.\d+(?:[eE][+-]?\d+)?[ij]?/, 'number'],

      // Command-style function call (e.g. "cd dir")
      [/^(\s*)((?:[a-zA-Z_]\w*))\b/, {
        cases: {
          '$2@keywords': ['white', 'keyword'],
          '$2@builtins': ['white', 'type.identifier'],
          '@default': ['white', 'identifier'],
        },
      }],

      // Identifiers and keywords
      [/[a-zA-Z_]\w*/, {
        cases: {
          '@keywords': 'keyword',
          '@builtins': 'type.identifier',
          '@default': 'identifier',
        },
      }],

      // Transpose operator (after closing paren/bracket/identifier)
      [/'/, 'operator'],

      // Operators
      [/@symbols/, {
        cases: {
          '@operators': 'operator',
          '@default': '',
        },
      }],

      // Delimiters and brackets
      [/[{}()\[\]]/, '@brackets'],
      [/[;,]/, 'delimiter'],

      // Whitespace
      [/\s+/, 'white'],
    ],

    blockComment: [
      [/%\}/, 'comment', '@pop'],
      [/./, 'comment'],
    ],
  },
});

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
  '.m': 'matlab',
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

/**
 * Module-level helper — collects data-source-line anchors from a preview pane.
 * Defined outside the class so Monaco scroll callbacks can invoke it without
 * depending on `this` binding (Problem 3 fix).
 *
 * @param {HTMLElement} previewPane
 * @returns {Array<{line: number, offsetTop: number}>} sorted by source line
 */
function _getPreviewAnchors(previewPane) {
  if (!previewPane) return [];
  const els = previewPane.querySelectorAll('[data-source-line]');
  const anchors = [];
  for (const el of els) {
    const line = parseInt(el.getAttribute('data-source-line'), 10);
    if (!isNaN(line)) {
      anchors.push({ line, offsetTop: el.offsetTop });
    }
  }
  anchors.sort((a, b) => a.line - b.line);
  return anchors;
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
      height: 100dvh;
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

    /* Ensure Monaco's diff editor root fills the container */
    .editor-container > .monaco-diff-editor {
      width: 100% !important;
      height: 100% !important;
    }

    /* Empty state */
    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      padding-left: 50%;
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

    .visual-btn {
      position: absolute;
      top: 6px;
      right: 64px;
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
    .visual-btn:hover {
      background: var(--bg-tertiary, #2a2a2a);
      color: var(--text-primary, #e0e0e0);
      border-color: var(--text-muted, #666);
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

    /* Ensure Monaco's diff editor root fills the pane in split mode */
    .split-container .editor-pane > .monaco-diff-editor {
      width: 100% !important;
      height: 100% !important;
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
      position: relative;
    }
    .preview-pane > .preview-btn {
      position: sticky;
      top: 0;
      float: right;
      margin: -18px -20px 0 0;
      z-index: 10;
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

    /* TeX preview (make4ht) styles */
    .preview-pane .centerline { text-align: center; }
    .preview-pane .cmr-17 { font-size: 1.7em; }
    .preview-pane .cmr-12 { font-size: 1.2em; }
    .preview-pane .cmbx-12, .preview-pane .cmbx-10 { font-weight: bold; }
    .preview-pane .cmti-10, .preview-pane .cmti-12 { font-style: italic; }
    .preview-pane .cmtt-10 { font-family: var(--font-mono, monospace); }
    .preview-pane .sectionHead,
    .preview-pane .subsectionHead,
    .preview-pane .subsubsectionHead {
      color: var(--text-primary, #e0e0e0);
      margin-top: 1.2em;
      margin-bottom: 0.4em;
      border-bottom: 1px solid var(--border, #333);
      padding-bottom: 0.3em;
    }
    .preview-pane .likesectionHead {
      color: var(--text-primary, #e0e0e0);
      margin-top: 1.2em;
      margin-bottom: 0.4em;
    }
    .preview-pane .math-display { text-align: center; margin: 1em 0; }
    .preview-pane .equation { text-align: center; margin: 1em 0; }
    .preview-pane .verbatim {
      background: var(--bg-tertiary, #161b22);
      padding: 12px 16px;
      border-radius: 6px;
      overflow-x: auto;
      font-family: var(--font-mono, monospace);
    }
    .preview-pane .lstlisting {
      background: var(--bg-tertiary, #161b22);
      padding: 12px 16px;
      border-radius: 6px;
      overflow-x: auto;
      font-family: var(--font-mono, monospace);
      font-size: 0.88em;
    }
    .preview-pane .fbox, .preview-pane .framebox {
      border: 1px solid var(--border, #333);
      padding: 8px;
      border-radius: 4px;
    }
    .preview-pane .caption { font-size: 0.9em; color: var(--text-secondary, #8b949e); margin-top: 4px; }
    .preview-pane .footnotes { font-size: 0.85em; border-top: 1px solid var(--border, #333); margin-top: 2em; padding-top: 1em; }
    .preview-pane .tabular { border-collapse: collapse; margin: 0.8em 0; }
    .preview-pane .tabular td, .preview-pane .tabular th {
      border: 1px solid var(--border, #333);
      padding: 4px 10px;
    }
    .preview-pane .enumerate, .preview-pane .itemize { padding-left: 1.5em; }
    .preview-pane .description dt { font-weight: bold; }
    .preview-pane .maketitle { text-align: center; margin-bottom: 2em; }
    .preview-pane .titleHead { font-size: 1.8em; color: var(--text-primary); }
    .preview-pane .author { font-size: 1.1em; color: var(--text-secondary); }
    .preview-pane .date { font-size: 0.95em; color: var(--text-muted); }
    /* make4ht math SVGs — ensure they inherit text color */
    .preview-pane svg { fill: currentColor; }
    .preview-pane img[src*="preview"] { max-width: 100%; }

    /* KaTeX math rendering in TeX preview */
    .preview-pane .math-display {
      text-align: center;
      margin: 1.2em 0;
      overflow-x: auto;
    }
    .preview-pane .katex-display {
      margin: 0;
      padding: 0.8em 0;
    }
    .preview-pane .katex {
      font-size: 1.1em;
    }

    /* Floating file-name labels for left/right diff panels */
    .panel-label {
      position: absolute;
      top: 8px;
      z-index: 9;
      max-width: 45%;
      padding: 3px 10px;
      border-radius: 4px;
      background: rgba(22, 27, 34, 0.78);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      border: 1px solid var(--border-primary, #30363d);
      color: var(--text-secondary, #8b949e);
      font-size: 0.75rem;
      font-family: var(--font-mono, monospace);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      pointer-events: auto;
      user-select: none;
      transition: opacity 0.15s;
      opacity: 0.85;
    }
    .panel-label:hover {
      opacity: 1;
      background: rgba(22, 27, 34, 0.92);
    }
    .panel-label.left {
      right: calc(50% + 8px);
    }
    .panel-label.right {
      right: 120px;
    }
    /* In inline (non-side-by-side) mode, only show the right label */
    .panel-label.left.inline-mode {
      display: none;
    }
    .panel-label.right.inline-mode {
      right: 120px;
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
    this._viewportStates = new Map();  // path → { scrollTop, scrollLeft, lineNumber, column }
    this._scrollLock = null;       // Which side owns scroll: 'editor' | 'preview' | null
    this._scrollLockTimer = null;  // Timer to release the lock
    this._editorScrollDisposable = null; // Monaco scroll listener disposable
    this._texPreviewTimer = null;  // Debounce timer for TeX preview compilation

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onMarkdownLinkNav = this._onMarkdownLinkNav.bind(this);
    this._onPreviewClick = this._onPreviewClick.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('navigate-markdown-link', this._onMarkdownLinkNav);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('navigate-markdown-link', this._onMarkdownLinkNav);
    this._disposeEditor();
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._styleObserver) {
      this._styleObserver.disconnect();
      this._styleObserver = null;
    }
    if (this._scrollLockTimer) {
      clearTimeout(this._scrollLockTimer);
      this._scrollLockTimer = null;
    }
    if (this._texPreviewTimer) {
      clearTimeout(this._texPreviewTimer);
      this._texPreviewTimer = null;
    }
  }

  firstUpdated() {
    this._editorContainer = this.shadowRoot.querySelector('.editor-pane') ||
                             this.shadowRoot.querySelector('.editor-container');
    this._resizeObserver = new ResizeObserver(() => {
      if (this._editor) {
        this._editor.layout();
      }
    });
    // Observe the host element — its height: 100dvh ensures the callback
    // fires on vertical window resizes even when the inner flex child
    // doesn't trigger a ResizeObserver entry on its own.
    this._resizeObserver.observe(this);
    if (this._editorContainer) {
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
      const wasActive = this._activeIndex === existingIdx;
      // Save viewport of the file we're leaving
      if (!wasActive) {
        this._savePerFileViewport();
      }
      this._activeIndex = existingIdx;
      await this.updateComplete;
      // Only rebuild the editor if switching to a different tab;
      // if the file is already active, skip _showEditor to avoid
      // recreating models (which resets scroll and cancels Delayers).
      if (!wasActive) {
        this._showEditor();
      }
      if (line != null) {
        this._scrollToLine(line);
      } else if (searchText) {
        this._scrollToSearchText(searchText);
      } else if (!wasActive) {
        // Restore saved viewport when switching back to this file
        this._restorePerFileViewport(path);
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

    // Save viewport of the file we're leaving before adding the new tab
    this._savePerFileViewport();

    const fileObj = {
      path,
      original,
      modified,
      is_new,
      is_read_only: is_read_only ?? false,
      is_config: opts.is_config ?? false,
      config_type: opts.config_type ?? null,
      real_path: opts.real_path ?? null,
      savedContent: opts.savedContent ?? modified,
    };

    this._files = [...this._files, fileObj];
    this._activeIndex = this._files.length - 1;

    await this.updateComplete;
    this._showEditor();

    // Scroll after diff computation finishes — scrolling immediately gets
    // overwritten by the async diff layout that resets the viewport.
    if (line != null || searchText) {
      await this._waitForDiffReady();
      if (line != null) {
        this._scrollToLine(line);
      } else if (searchText) {
        this._scrollToSearchText(searchText);
      }
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

    // Capture scroll position before reloading content
    const savedViewport = this.getViewportState();

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
      // Restore scroll position after editor is rebuilt with new content
      if (savedViewport) {
        this.restoreViewportState(savedViewport);
      }
    }
  }

  /**
   * Close a file tab.
   */
  closeFile(path) {
    delete this._virtualContents[path];
    this._viewportStates.delete(path);
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

  /**
   * Load content into a specific panel (left or right) of the current diff.
   * If no file is open, creates a virtual comparison file.
   * @param {string} content - Text content to load
   * @param {'left'|'right'} panel - Which panel to update
   * @param {string} [label] - Source label for display
   */
  loadPanel(content, panel, label) {
    if (!this._editor || this._activeIndex < 0) {
      // No file open — create a virtual comparison
      const path = 'virtual://compare';
      const fileObj = {
        path,
        original: panel === 'left' ? content : '',
        modified: panel === 'right' ? content : '',
        is_new: false,
        is_read_only: true,
        is_config: false,
        config_type: null,
        real_path: null,
        savedContent: panel === 'right' ? content : '',
      };

      const existingIdx = this._files.findIndex(f => f.path === 'virtual://compare');
      if (existingIdx !== -1) {
        const existing = this._files[existingIdx];
        fileObj.original = panel === 'left' ? content : existing.original;
        fileObj.modified = panel === 'right' ? content : existing.modified;
        fileObj.savedContent = fileObj.modified;
        this._files = this._files.map((f, i) => i === existingIdx ? fileObj : f);
        this._activeIndex = existingIdx;
      } else {
        this._files = [...this._files, fileObj];
        this._activeIndex = this._files.length - 1;
      }

      this.updateComplete.then(() => this._showEditor());
      this._dispatchActiveFileChanged(fileObj.path);
      return;
    }

    // File is open — update the appropriate side
    const file = this._files[this._activeIndex];
    const model = this._editor.getModel();
    if (!model) return;

    if (panel === 'left') {
      const updated = { ...file, original: content };
      this._files = this._files.map((f, i) => i === this._activeIndex ? updated : f);
      const lang = detectLanguage(file.path);
      const oldOriginal = model.original;
      const newOriginalModel = monaco.editor.createModel(content, lang);
      this._editor.setModel({
        original: newOriginalModel,
        modified: model.modified,
      });
      if (oldOriginal) oldOriginal.dispose();
      this._leftLabel = label ? this._makePanelLabel(label) : null;
    } else {
      const updated = { ...file, modified: content, savedContent: content };
      this._files = this._files.map((f, i) => i === this._activeIndex ? updated : f);
      const lang = detectLanguage(file.path);
      const oldModified = model.modified;
      const newModifiedModel = monaco.editor.createModel(content, lang);
      this._editor.setModel({
        original: model.original,
        modified: newModifiedModel,
      });
      if (oldModified) oldModified.dispose();
      this._rightLabel = label ? this._makePanelLabel(label) : null;
    }

    const newDirty = new Set(this._dirtySet);
    newDirty.delete(file.path);
    this._dirtySet = newDirty;
    this.requestUpdate();
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

  /**
   * Save the current file's viewport state to the per-file map.
   * Called internally before switching away from a tab.
   */
  _savePerFileViewport() {
    if (this._activeIndex < 0 || this._activeIndex >= this._files.length) return;
    const file = this._files[this._activeIndex];
    const state = this.getViewportState();
    if (state) {
      this._viewportStates.set(file.path, state);
    }
  }

  /**
   * Restore a file's viewport state from the per-file map.
   * Waits for the diff editor to finish computing before scrolling.
   */
  _restorePerFileViewport(path) {
    const state = this._viewportStates.get(path);
    if (!state) return;
    this._waitForDiffReady().then(() => {
      this.restoreViewportState(state);
    });
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

    // Update floating panel labels
    this._updatePanelLabels(file);

    if (this._editor) {
      // Capture old models — they must be disposed AFTER setModel() detaches
      // the DiffEditorWidget from them. Disposing while still attached causes
      // "TextModel got disposed before DiffEditorWidget model got reset".
      const oldModel = this._editor.getModel();

      // Switch between side-by-side and inline mode
      this._editor.updateOptions({
        renderSideBySide,
        enableSplitViewResizing: renderSideBySide,
        readOnly: false,
      });

      // Create new models and set them — this detaches the old models
      const originalModel = monaco.editor.createModel(file.original, language);
      const modifiedModel = monaco.editor.createModel(file.modified, language);

      this._editor.setModel({
        original: originalModel,
        modified: modifiedModel,
      });

      // Now safe to dispose the old models
      if (oldModel) {
        if (oldModel.original) oldModel.original.dispose();
        if (oldModel.modified) oldModel.modified.dispose();
      }

      // Set read-only state on modified side — must come after setModel
      // so that inline diff mode doesn't override it
      this._editor.getModifiedEditor().updateOptions({
        readOnly: file.is_read_only,
        domReadOnly: false,
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
        links: true,
        hover: { enabled: true, above: false, sticky: true, delay: 600 },
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
        if (this._previewMode) {
          // For TeX files, don't compile on every keystroke — too expensive.
          // Instead, debounce with a longer delay.
          const activeFile = this._activeIndex >= 0 ? this._files[this._activeIndex] : null;
          if (activeFile && this._isTexFile(activeFile.path)) {
            clearTimeout(this._texPreviewTimer);
            this._texPreviewTimer = setTimeout(() => this._updatePreview(), 2000);
          } else {
            this._updatePreview();
          }
        }
      });
    }

    // Patch Monaco's editor service for cross-file Go-to-Definition.
    // Ctrl+Click on a symbol in another file triggers openCodeEditor —
    // we intercept it here to open the target in our tab system.
    if (!this._editorServicePatched) {
      this._editorServicePatched = true;
      try {
        const modifiedEditor = this._editor.getModifiedEditor();
        const svc = modifiedEditor?._codeEditorService;
        if (svc && typeof svc.openCodeEditor === 'function') {
          const origOpen = svc.openCodeEditor.bind(svc);
          svc.openCodeEditor = async (input, source, sideBySide) => {
            const resourcePath = input?.resource?.path;
            if (resourcePath) {
              const cleanPath = resourcePath.replace(/^\/+/, '');
              const line = input?.options?.selection?.startLineNumber;
              await this.openFile({ path: cleanPath, line });
              return source;
            }
            return origOpen(input, source, sideBySide);
          };
        }
      } catch (_) { /* best-effort — LSP nav is not critical */ }
    }

    // Problem 6 fix: listen on only the modified editor (not both) to
    // avoid double-firing scroll events in inline diff mode.
    if (this._editorScrollDisposable) {
      this._editorScrollDisposable.dispose();
      this._editorScrollDisposable = null;
    }
    if (this._previewMode) {
      const modifiedEditor = this._editor.getModifiedEditor();
      // Arrow function preserves `this` for the class, but calls the
      // module-level _getPreviewAnchors (Problem 3 fix).
      this._editorScrollDisposable = modifiedEditor.onDidScrollChange(() => {
        if (this._scrollLock === 'preview') return;
        this._scrollLock = 'editor';
        clearTimeout(this._scrollLockTimer);
        this._scrollLockTimer = setTimeout(() => { this._scrollLock = null; }, 120);
        this._scrollPreviewToEditorLine();
      });
    }

    this._editor.layout();

    if (this._previewMode) {
      this._updatePreview();
    }
  }

  _disposeEditor() {
    // Clear TeX preview debounce timer
    if (this._texPreviewTimer) {
      clearTimeout(this._texPreviewTimer);
      this._texPreviewTimer = null;
    }
    // Dispose the scroll listener first
    if (this._editorScrollDisposable) {
      this._editorScrollDisposable.dispose();
      this._editorScrollDisposable = null;
    }
    if (this._editor) {
      // Problem 2 fix: dispose the diff editor FIRST (releases its hold on
      // the models), then dispose the text models afterward.
      const model = this._editor.getModel();
      this._editor.dispose();
      this._editor = null;
      if (model) {
        if (model.original) model.original.dispose();
        if (model.modified) model.modified.dispose();
      }
    }
    this._highlightDecorations = [];
    this._leftLabel = null;
    this._rightLabel = null;
  }

  /**
   * Wait for the diff editor's async diff computation to finish.
   * Monaco resets scroll/layout when the diff result arrives, so any
   * scroll positioning must happen after this resolves.
   */
  _waitForDiffReady() {
    return new Promise((resolve) => {
      if (!this._editor) { resolve(); return; }
      const disposable = this._editor.onDidUpdateDiff(() => {
        disposable.dispose();
        // One extra frame to let Monaco finish its layout pass
        requestAnimationFrame(() => resolve());
      });
      // Safety timeout — if diff never fires (e.g. identical content)
      setTimeout(() => {
        try { disposable.dispose(); } catch (_) { /* already disposed */ }
        resolve();
      }, 2000);
    });
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
    const shadowRoot = this.shadowRoot;

    // Re-sync all styles every time an editor is created — Monaco may have
    // added new <style> elements synchronously during editor construction.
    this._syncAllStyles(shadowRoot);

    // The MutationObserver only needs to be set up once — it catches styles
    // that Monaco adds asynchronously after editor creation.
    if (this._monacoStylesInjected) return;
    this._monacoStylesInjected = true;

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
    // Remove previously-cloned styles to avoid duplicates
    const old = shadowRoot.querySelectorAll('[data-monaco-injected]');
    for (const el of old) {
      el.remove();
    }

    // Clone all current styles from document.head into the shadow root
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
        this._savePerFileViewport();
        const nextIndex = (this._activeIndex + 1) % this._files.length;
        this._activeIndex = nextIndex;
        this._showEditor();
        this._restorePerFileViewport(this._files[nextIndex].path);
        this._dispatchActiveFileChanged(this._files[nextIndex].path);
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'PageUp') {
      e.preventDefault();
      if (this._files.length > 1) {
        this._savePerFileViewport();
        const prevIndex = (this._activeIndex - 1 + this._files.length) % this._files.length;
        this._activeIndex = prevIndex;
        this._showEditor();
        this._restorePerFileViewport(this._files[prevIndex].path);
        this._dispatchActiveFileChanged(this._files[prevIndex].path);
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

    // Trigger TeX preview recompile on save
    if (this._previewMode && this._isTexFile(file.path)) {
      this._updateTexPreview();
    }
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

  /**
   * Handle Ctrl+click on a Markdown link in the Monaco editor.
   * Resolves the relative path against the current file's directory
   * and opens the target file.
   */
  _onMarkdownLinkNav(e) {
    const relativePath = e.detail?.relativePath;
    if (!relativePath) return;
    const resolved = this._resolveRelativePath(relativePath);
    if (resolved) {
      window.dispatchEvent(new CustomEvent('navigate-file', {
        detail: { path: resolved },
      }));
    }
  }

  /**
   * Handle clicks inside the Markdown preview pane.
   * Intercepts relative links and opens them in the editor.
   */
  _onPreviewClick(e) {
    const anchor = e.target.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href) return;
    // Let absolute URLs open normally
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) return;
    // Skip pure anchor links
    if (href.startsWith('#')) return;

    e.preventDefault();
    e.stopPropagation();

    const filePath = href.split('#')[0];
    if (!filePath) return;

    const resolved = this._resolveRelativePath(filePath);
    if (resolved) {
      window.dispatchEvent(new CustomEvent('navigate-file', {
        detail: { path: resolved },
      }));
    }
  }

  /**
   * Resolve a relative path against the current file's directory.
   * Returns a normalized repo-relative path.
   */
  _resolveRelativePath(relativePath) {
    const file = this._activeIndex >= 0 ? this._files[this._activeIndex] : null;
    if (!file) return relativePath;

    const filePath = file.path;
    const lastSlash = filePath.lastIndexOf('/');
    const fileDir = lastSlash >= 0 ? filePath.slice(0, lastSlash) : '';

    const combined = fileDir ? fileDir + '/' + relativePath : relativePath;
    return this._normalizePath(combined);
  }

  _dispatchActiveFileChanged(path) {
    window.dispatchEvent(new CustomEvent('active-file-changed', {
      detail: { path },
    }));
  }

  // === Panel Labels ===

  /**
   * Build a label object from a file path or descriptive string.
   * @param {string} pathOrLabel
   * @returns {{name: string, fullPath: string}}
   */
  _makePanelLabel(pathOrLabel) {
    if (!pathOrLabel) return null;
    const lastSlash = pathOrLabel.lastIndexOf('/');
    const name = lastSlash >= 0 ? pathOrLabel.slice(lastSlash + 1) : pathOrLabel;
    return { name, fullPath: pathOrLabel };
  }

  /**
   * Update left/right floating labels based on the active file.
   * For normal diffs (same file, HEAD vs working): show "HEAD" left, file name right.
   * For virtual compare or loadPanel: labels are set explicitly.
   */
  _updatePanelLabels(file) {
    if (!file) {
      this._leftLabel = null;
      this._rightLabel = null;
      this.requestUpdate();
      return;
    }
    // If this is a virtual compare created by loadPanel, keep existing labels
    if (file.path === 'virtual://compare') {
      this.requestUpdate();
      return;
    }
    // Normal file diff (same file, HEAD vs working) — no labels needed
    this._leftLabel = null;
    this._rightLabel = null;
    this.requestUpdate();
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
            position.lineNumber, position.column
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
          console.error('[LSP hover] error:', e);
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
            position.lineNumber, position.column
          );
          if (result?.file && result?.range) {
            return {
              uri: monaco.Uri.parse(`file:///${result.file}`),
              range: new monaco.Range(
                result.range.start_line + 1, result.range.start_col + 1,
                result.range.end_line + 1, result.range.end_col + 1
              ),
            };
          }
        } catch (e) {
          // Ignore — LSP is best-effort
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
            position.lineNumber, position.column
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
          console.error('[LSP references] error:', e);
        }
        return null;
      },
    });

    // Markdown link provider — makes [text](path) Ctrl+clickable
    monaco.languages.registerLinkProvider('markdown', {
      provideLinks: (model) => {
        const links = [];
        const lineCount = model.getLineCount();
        // Match [text](relative-path) but not [text](http://...) or [text](https://...)
        const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
        for (let i = 1; i <= lineCount; i++) {
          const lineContent = model.getLineContent(i);
          let match;
          linkRe.lastIndex = 0;
          while ((match = linkRe.exec(lineContent)) !== null) {
            const target = match[2];
            // Skip absolute URLs and anchors
            if (target.startsWith('http://') || target.startsWith('https://') || target.startsWith('#')) continue;
            // Strip any anchor fragment for file resolution
            const filePath = target.split('#')[0];
            if (!filePath) continue;
            const startCol = match.index + match[1].length + 3; // after "[text]("
            const endCol = startCol + match[2].length;
            links.push({
              range: new monaco.Range(i, startCol, i, endCol),
              url: monaco.Uri.parse(`ac-navigate:///${filePath}`),
            });
          }
        }
        return { links };
      },
    });

    // Intercept Go-to-Definition for cross-file navigation.
    // Monaco's ICodeEditorService.openCodeEditor is called when the user
    // Ctrl+clicks a symbol whose definition is in another file. We
    // override it so the diff viewer opens the target file in a new tab
    // instead of trying to create a new Monaco editor instance.
    const editorService = this._editor?._codeEditorService;
    if (editorService && !editorService._acPatched) {
      editorService._acPatched = true;
      const origOpen = editorService.openCodeEditor.bind(editorService);
      editorService.openCodeEditor = async (input, source, sideBySide) => {
        const targetPath = input?.resource?.path;
        if (targetPath) {
          const cleanPath = targetPath.replace(/^\/+/, '');
          const line = input.options?.selection?.startLineNumber;
          await this.openFile({ path: cleanPath, line });
          return source; // return current editor to satisfy Monaco
        }
        return origOpen(input, source, sideBySide);
      };
    }

    // Intercept ac-navigate: links to open files in the editor
    monaco.editor.registerLinkOpener({
      open(resource) {
        if (resource.scheme === 'ac-navigate') {
          // Monaco URI parsing varies — extract the path robustly
          const raw = decodeURIComponent(resource.toString());
          const relativePath = raw.replace(/^ac-navigate:\/?\/?/, '');
          window.dispatchEvent(new CustomEvent('navigate-markdown-link', {
            detail: { relativePath },
          }));
          return true; // handled
        }
        return false; // let Monaco handle other links
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
            position.lineNumber, position.column, prefix
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

  _isTexFile(path) {
    if (!path) return false;
    const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
    return ext === '.tex' || ext === '.latex';
  }

  _isPreviewableFile(path) {
    return this._isMarkdownFile(path) || this._isTexFile(path);
  }

  _isSvgFile(path) {
    if (!path) return false;
    return path.toLowerCase().endsWith('.svg');
  }

  _switchToVisualMode() {
    if (this._activeIndex < 0) return;
    const file = this._files[this._activeIndex];
    if (!file) return;
    // Capture latest text content from Monaco
    const modified = this._editor?.getModifiedEditor()?.getValue() ?? file.modified;
    window.dispatchEvent(new CustomEvent('toggle-svg-mode', {
      detail: {
        path: file.path,
        target: 'visual',
        modified,
        savedContent: file.savedContent,
      },
    }));
  }

  async _togglePreview() {
    // If enabling preview for a TeX file, check make4ht availability first
    if (!this._previewMode) {
      const file = this._activeIndex >= 0 ? this._files[this._activeIndex] : null;
      if (file && this._isTexFile(file.path)) {
        try {
          const check = await this.rpcExtract('LLMService.is_tex_preview_available');
          if (check && !check.available) {
            // Show install instructions in the preview pane instead of
            // blocking the toggle — user can see what's needed
            this._previewMode = true;
            this._previewContent = `<div style="padding: 20px;">
              <h3 style="color: var(--accent-orange);">⚠️ TeX Preview Unavailable</h3>
              <p style="color: var(--text-secondary);">
                <code>make4ht</code> is required for TeX preview but is not installed.
              </p>
              <pre style="color: var(--accent-green); background: var(--bg-tertiary); padding: 12px; border-radius: 6px; margin-top: 12px;">${check.install_hint || 'sudo apt install texlive-extra-utils'}</pre>
              <p style="color: var(--text-muted); margin-top: 12px; font-size: 0.85rem;">
                After installing, the preview will work automatically — no restart needed.
              </p>
            </div>`;
            // Still switch to preview layout so the message is visible
            this._disposeEditor();
            this.updateComplete.then(() => {
              this._editorContainer = this.shadowRoot.querySelector('.editor-pane') ||
                                       this.shadowRoot.querySelector('.editor-container');
              if (this._resizeObserver) this._resizeObserver.disconnect();
              this._resizeObserver = new ResizeObserver(() => {
                if (this._editor) this._editor.layout();
              });
              this._resizeObserver.observe(this);
              if (this._editorContainer) {
                this._resizeObserver.observe(this._editorContainer);
              }
              this._showEditor();
            });
            return;
          }
        } catch (e) {
          console.warn('TeX availability check failed:', e);
          // Proceed anyway — the compile call will surface the error
        }
      }
    }

    this._previewMode = !this._previewMode;
    if (this._previewMode) {
      this._updatePreview();
    }
    // Re-create editor with new layout mode
    this._disposeEditor();
    this.updateComplete.then(() => {
      this._editorContainer = this.shadowRoot.querySelector('.editor-pane') ||
                               this.shadowRoot.querySelector('.editor-container');
      if (this._resizeObserver) this._resizeObserver.disconnect();
      this._resizeObserver = new ResizeObserver(() => {
        if (this._editor) this._editor.layout();
      });
      this._resizeObserver.observe(this);
      if (this._editorContainer) {
        this._resizeObserver.observe(this._editorContainer);
      }
      this._showEditor();
    });
  }

  _updatePreview() {
    const file = this._activeIndex >= 0 ? this._files[this._activeIndex] : null;
    if (file && this._isTexFile(file.path)) {
      this._updateTexPreview();
      return;
    }
    if (!this._editor) {
      this._previewContent = file ? renderMarkdownWithSourceMap(file.modified) : '';
    } else {
      const content = this._editor.getModifiedEditor()?.getValue() ?? '';
      this._previewContent = renderMarkdownWithSourceMap(content);
    }
    this.requestUpdate();
    // After DOM update, resolve relative image paths
    this.updateComplete.then(() => this._resolvePreviewImages());
  }

  async _updateTexPreview() {
    const file = this._activeIndex >= 0 ? this._files[this._activeIndex] : null;
    if (!file) return;
    const content = this._editor?.getModifiedEditor()?.getValue() ?? file.modified;
    if (!content.trim()) {
      this._previewContent = '<p style="color: var(--text-muted);">Empty document</p>';
      this.requestUpdate();
      return;
    }
    // Show loading state
    this._previewContent = '<p style="color: var(--text-muted);">⏳ Compiling TeX…</p>';
    this.requestUpdate();

    try {
      const result = await this.rpcExtract(
        'LLMService.compile_tex_preview', content, file.path
      );
      if (!result) {
        this._previewContent = '<p style="color: var(--accent-red);">Preview failed: no response</p>';
        this.requestUpdate();
        return;
      }
      if (result.error) {
        let errorHtml = `<div style="color: var(--accent-red); margin-bottom: 12px;">
          <strong>⚠️ ${this._escapePreviewHtml(result.error)}</strong>
        </div>`;
        if (result.install_hint) {
          errorHtml += `<pre style="color: var(--text-secondary); font-size: 0.85rem; white-space: pre-wrap;">${this._escapePreviewHtml(result.install_hint)}</pre>`;
        }
        if (result.log) {
          errorHtml += `<details style="margin-top: 12px;">
            <summary style="cursor: pointer; color: var(--text-muted);">Compilation log</summary>
            <pre style="color: var(--text-secondary); font-size: 0.78rem; white-space: pre-wrap; max-height: 400px; overflow-y: auto; margin-top: 8px;">${this._escapePreviewHtml(result.log)}</pre>
          </details>`;
        }
        this._previewContent = errorHtml;
        this.requestUpdate();
        return;
      }
      // Success — render LaTeX math with KaTeX, then inject source lines for scroll sync
      let processed = this._renderTexMathWithKatex(result.html);
      processed = this._injectTexSourceLines(processed, content);
      this._previewContent = processed;
      this.requestUpdate();
    } catch (e) {
      console.error('TeX preview failed:', e);
      this._previewContent = `<p style="color: var(--accent-red);">Preview error: ${this._escapePreviewHtml(e.message || String(e))}</p>`;
      this.requestUpdate();
    }
  }

  _escapePreviewHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Render LaTeX math in make4ht output using KaTeX.
   *
   * When make4ht runs with the "mathjax" option, it emits raw LaTeX
   * math wrapped in \(...\) (inline) and \[...\] (display) delimiters
   * instead of generating SVG/PNG images.  This method finds those
   * delimiters and replaces them with KaTeX-rendered HTML.
   *
   * Also handles $$...$$ display math and $...$ inline math that
   * make4ht may pass through, as well as \begin{equation}...\end{equation}
   * environments.
   */
  /**
   * Strip LaTeX commands that KaTeX doesn't support or that leak as
   * visible text: \label{...}, \tag{...}, \nonumber, \notag.
   */
  _cleanTexForKatex(tex) {
    return tex
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/\\label\{[^}]*\}/g, '')
      .replace(/\\tag\{[^}]*\}/g, '')
      .replace(/\\nonumber/g, '')
      .replace(/\\notag/g, '')
      .trim();
  }

  _renderTexMathWithKatex(htmlStr) {
    if (!htmlStr) return htmlStr;
    try {
      // Phase 1: Remove make4ht alt-text spans/divs that duplicate
      // the math content as plain text BEFORE processing delimiters.
      htmlStr = htmlStr.replace(
        /<span\s+class="(?:math-display|MathJax_Preview)"[^>]*>[\s\S]*?<\/span>/g,
        ''
      );
      htmlStr = htmlStr.replace(
        /<div\s+class="(?:math-display|MathJax_Preview)"[^>]*>[\s\S]*?<\/div>/g,
        ''
      );

      // Phase 2: Render math delimiters with KaTeX.
      // Order matters: \begin{equation} before \[...\] because make4ht
      // sometimes wraps one inside the other.

      // Display math environments: \begin{equation}...\end{equation} etc.
      htmlStr = htmlStr.replace(/\\begin\{(equation|align|gather|multline|displaymath|eqnarray)\*?\}([\s\S]*?)\\end\{\1\*?\}/g, (_match, env, tex) => {
        try {
          let katexTex = this._cleanTexForKatex(tex);
          if (env === 'align' || env === 'align*') {
            katexTex = `\\begin{aligned}${katexTex}\\end{aligned}`;
          } else if (env === 'gather' || env === 'gather*') {
            katexTex = `\\begin{gathered}${katexTex}\\end{gathered}`;
          }
          return `<div class="math-display katex-rendered">${katex.renderToString(katexTex, { displayMode: true, throwOnError: false })}</div>`;
        } catch (_) {
          return `<div class="math-display"><code>${this._escapePreviewHtml(tex)}</code></div>`;
        }
      });

      // Display math: \[...\]
      htmlStr = htmlStr.replace(/\\\[([\s\S]*?)\\\]/g, (_match, tex) => {
        try {
          return `<div class="math-display katex-rendered">${katex.renderToString(this._cleanTexForKatex(tex), { displayMode: true, throwOnError: false })}</div>`;
        } catch (_) {
          return `<div class="math-display"><code>${this._escapePreviewHtml(tex)}</code></div>`;
        }
      });

      // Display math: $$...$$
      htmlStr = htmlStr.replace(/\$\$([\s\S]*?)\$\$/g, (_match, tex) => {
        try {
          return `<div class="math-display katex-rendered">${katex.renderToString(this._cleanTexForKatex(tex), { displayMode: true, throwOnError: false })}</div>`;
        } catch (_) {
          return `<div class="math-display"><code>${this._escapePreviewHtml(tex)}</code></div>`;
        }
      });

      // Inline math: \(...\)
      htmlStr = htmlStr.replace(/\\\(([\s\S]*?)\\\)/g, (_match, tex) => {
        try {
          return `<span class="katex-rendered">${katex.renderToString(this._cleanTexForKatex(tex), { displayMode: false, throwOnError: false })}</span>`;
        } catch (_) {
          return `<code>${this._escapePreviewHtml(tex)}</code>`;
        }
      });

      // Inline math: $...$  (single dollar, non-greedy, no spaces around $)
      htmlStr = htmlStr.replace(/(?<![\\$])\$([^\s$](?:[^$]*[^\s$])?)\$(?!\$)/g, (_match, tex) => {
        try {
          return `<span class="katex-rendered">${katex.renderToString(this._cleanTexForKatex(tex), { displayMode: false, throwOnError: false })}</span>`;
        } catch (_) {
          return `<code>${this._escapePreviewHtml(tex)}</code>`;
        }
      });

      // Phase 3: Remove alt-text fallbacks placed adjacent to rendered math.
      // After KaTeX rendering, orphan text between a closing katex-rendered
      // tag and the next HTML tag is likely a plain-text duplicate.
      htmlStr = htmlStr.replace(
        /(<\/(?:span|div)>)(\s*(?:<br\s*\/?>)?\s*)([^<]{2,}?)(\s*<)/g,
        (_match, closeTag, ws1, text, openTag) => {
          const looksLikeMath = /[=+\-−×÷<>≤≥|∣(){}^_,0-9]/.test(text)
            && !/\.\s+[A-Z]/.test(text);
          if (looksLikeMath) {
            return `${closeTag}${openTag}`;
          }
          return _match;
        }
      );

      // Strip text containing \label after rendered display math
      htmlStr = htmlStr.replace(
        /(<\/div>)\s*(?:<br\s*\/?>)?\s*([^<]{5,}\\label[^<]*)/g,
        '$1'
      );

      return htmlStr;
    } catch (e) {
      console.warn('KaTeX rendering failed:', e);
      return htmlStr;
    }
  }


  /**
   * Inject data-source-line attributes into make4ht HTML output for
   * scroll synchronization with the editor.
   *
   * Two-pass approach:
   *
   * Pass 1 — Build a sparse set of **anchor** mappings from TeX structural
   *   commands (\section, \begin, \item, etc.) to their source line numbers.
   *   Match these against HTML elements using class names and document order.
   *   This gives reliable, exact anchors at section heads, list items,
   *   environments, etc. — no text comparison involved.
   *
   * Pass 2 — **Interpolate** between anchors.  Every unmatched block-level
   *   element that falls between two anchors gets a linearly-interpolated
   *   source line number.  This ensures smooth, gap-free scrolling even
   *   through regions where text matching would fail (math, tables, etc.).
   *
   * The result: every block element gets a data-source-line attribute,
   * scroll sync is continuous, and no fragile text-matching heuristics
   * are needed.
   */
  _injectTexSourceLines(html, texSource) {
    if (!html || !texSource) return html;

    const totalSourceLines = texSource.split('\n').length;
    const sourceLines = texSource.split('\n');

    // ── Phase 1: Extract structural anchors from TeX source ──
    // Each anchor records: { kind, line (1-based), [text], [env] }
    const anchors = [];
    for (let i = 0; i < sourceLines.length; i++) {
      const raw = sourceLines[i].trim();
      if (!raw || raw.startsWith('%')) continue;
      const lineNum = i + 1;

      const secMatch = raw.match(/^\\(section|subsection|subsubsection|paragraph)\*?\{(.+?)\}?$/);
      if (secMatch) {
        const heading = secMatch[2].replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();
        anchors.push({ kind: secMatch[1], text: heading, line: lineNum });
        continue;
      }
      if (/^\\begin\{(\w+)\}/.test(raw)) {
        anchors.push({ kind: 'env', env: RegExp.$1, line: lineNum });
        continue;
      }
      if (/^\\end\{(\w+)\}/.test(raw)) {
        anchors.push({ kind: 'envend', env: RegExp.$1, line: lineNum });
        continue;
      }
      if (/^\\item\b/.test(raw)) {
        anchors.push({ kind: 'item', line: lineNum });
        continue;
      }
      if (/^\\(STATE|REQUIRE|ENSURE|IF|ELSIF|ELSE|ENDIF|WHILE|ENDWHILE|FOR|ENDFOR|REPEAT|UNTIL|RETURN|PRINT|COMMENT)\b/.test(raw)) {
        anchors.push({ kind: 'algo', line: lineNum });
        continue;
      }
      if (/^\\(caption)\{/.test(raw)) {
        anchors.push({ kind: 'caption', line: lineNum });
        continue;
      }
      if (/^\\maketitle/.test(raw)) {
        anchors.push({ kind: 'maketitle', line: lineNum });
        continue;
      }
    }

    // ── Phase 2: Find all block-level elements in the HTML ──
    const blockTags = ['h1','h2','h3','h4','h5','h6','p','div','li','dt','dd',
                       'td','th','tr','figcaption','caption','pre','table',
                       'section','article','blockquote','hr','ol','ul'];
    const tagPattern = new RegExp(
      `(<(?:${blockTags.join('|')}))([ \\t>])`, 'gi'
    );

    // Collect every block-element opening position in document order
    const elements = [];  // { offset, tagName, tagStartLen }
    let m;
    while ((m = tagPattern.exec(html)) !== null) {
      elements.push({
        offset: m.index,
        tagName: m[1].slice(1).toLowerCase(),
        tagStartLen: m[1].length,   // length of e.g. "<li"
      });
    }

    if (elements.length === 0) return html;

    // ── Phase 3: Match anchors to elements (sparse) ──
    // Walk anchors and elements together in document order.
    // Each anchor tries to claim the next suitable element.
    const assigned = new Array(elements.length).fill(0);  // 0 = unassigned
    let anchorIdx = 0;
    let elemIdx = 0;

    // Helper: read the class attribute from the opening tag at `offset`
    const getClass = (offset) => {
      const end = html.indexOf('>', offset);
      if (end === -1) return '';
      const tag = html.slice(offset, end + 1);
      const cm = tag.match(/class="([^"]*)"/);
      return cm ? cm[1] : '';
    };

    // Helper: get visible text of element (for heading verification)
    const getVisibleText = (offset, tagName) => {
      const end = html.indexOf('>', offset);
      if (end === -1) return '';
      const closeTag = `</${tagName}`;
      const closeIdx = html.indexOf(closeTag, end + 1);
      if (closeIdx === -1) return '';
      return html.slice(end + 1, closeIdx)
        .replace(/<[^>]*>/g, '')
        .replace(/&[a-z]+;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    while (anchorIdx < anchors.length && elemIdx < elements.length) {
      const anc = anchors[anchorIdx];
      const el = elements[elemIdx];

      let matched = false;

      if (anc.kind === 'section' || anc.kind === 'subsection' || anc.kind === 'subsubsection' || anc.kind === 'paragraph') {
        // Look for a heading element or div with sectionHead class
        for (let j = elemIdx; j < elements.length && j < elemIdx + 12; j++) {
          const ej = elements[j];
          const tn = ej.tagName;
          if (tn === 'h1' || tn === 'h2' || tn === 'h3' || tn === 'h4' || tn === 'h5' || tn === 'h6' || tn === 'div') {
            const cls = getClass(ej.offset);
            const isHeading = tn.startsWith('h') ||
              cls.includes('sectionHead') || cls.includes('subsectionHead') ||
              cls.includes('subsubsectionHead') || cls.includes('likesectionHead');
            if (isHeading && anc.text) {
              const vis = getVisibleText(ej.offset, tn);
              if (vis.includes(anc.text) || anc.text.includes(vis.slice(0, 40))) {
                assigned[j] = anc.line;
                elemIdx = j + 1;
                matched = true;
                break;
              }
            }
          }
        }
      } else if (anc.kind === 'item' || anc.kind === 'algo') {
        // Match to next <li>, <p>, or <div> element
        for (let j = elemIdx; j < elements.length && j < elemIdx + 8; j++) {
          const tn = elements[j].tagName;
          if (tn === 'li' || tn === 'p' || tn === 'div' || tn === 'dd' || tn === 'dt') {
            assigned[j] = anc.line;
            elemIdx = j + 1;
            matched = true;
            break;
          }
        }
      } else if (anc.kind === 'env') {
        // Match to next container-like element
        for (let j = elemIdx; j < elements.length && j < elemIdx + 6; j++) {
          const tn = elements[j].tagName;
          if (tn === 'div' || tn === 'table' || tn === 'ol' || tn === 'ul' ||
              tn === 'pre' || tn === 'blockquote' || tn === 'p') {
            assigned[j] = anc.line;
            elemIdx = j + 1;
            matched = true;
            break;
          }
        }
      } else if (anc.kind === 'envend') {
        // \end{} — skip, don't consume an element
        anchorIdx++;
        continue;
      } else if (anc.kind === 'caption') {
        for (let j = elemIdx; j < elements.length && j < elemIdx + 6; j++) {
          const tn = elements[j].tagName;
          if (tn === 'figcaption' || tn === 'caption' || tn === 'div' || tn === 'p') {
            assigned[j] = anc.line;
            elemIdx = j + 1;
            matched = true;
            break;
          }
        }
      } else if (anc.kind === 'maketitle') {
        for (let j = elemIdx; j < elements.length && j < elemIdx + 4; j++) {
          const tn = elements[j].tagName;
          if (tn === 'div' || tn === 'h1') {
            assigned[j] = anc.line;
            elemIdx = j + 1;
            matched = true;
            break;
          }
        }
      }

      anchorIdx++;
      if (!matched) {
        // Anchor didn't match — move on, don't advance elemIdx
      }
    }

    // ── Phase 4: Interpolate between assigned anchors ──
    // First and last elements get boundary values if unassigned
    if (assigned[0] === 0) assigned[0] = 1;
    if (assigned[assigned.length - 1] === 0) assigned[assigned.length - 1] = totalSourceLines;

    // Forward-fill: propagate last known line to unassigned elements
    // with linear interpolation between anchored points
    let prevIdx = 0;
    for (let i = 1; i < assigned.length; i++) {
      if (assigned[i] !== 0) {
        // Interpolate all unassigned elements between prevIdx and i
        if (i - prevIdx > 1) {
          const startLine = assigned[prevIdx];
          const endLine = assigned[i];
          for (let j = prevIdx + 1; j < i; j++) {
            const frac = (j - prevIdx) / (i - prevIdx);
            assigned[j] = Math.round(startLine + frac * (endLine - startLine));
          }
        }
        prevIdx = i;
      }
    }
    // Fill any trailing unassigned (shouldn't happen, but safety)
    for (let i = prevIdx + 1; i < assigned.length; i++) {
      assigned[i] = assigned[prevIdx];
    }

    // ── Phase 5: Inject data-source-line attributes back-to-front ──
    const chars = html.split('');
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      const attr = ` data-source-line="${assigned[i]}"`;
      chars.splice(el.offset + el.tagStartLen, 0, attr);
    }
    return chars.join('');
  }

  /**
   * Find <img> tags in the preview pane with relative src paths and
   * replace them with blob URLs fetched from the repo via RPC.
   */
  async _resolvePreviewImages() {
    const previewPane = this.shadowRoot?.querySelector('.preview-pane');
    if (!previewPane || !this.rpcConnected) return;

    const file = this._activeIndex >= 0 ? this._files[this._activeIndex] : null;
    if (!file) return;

    // Compute the directory of the current file for resolving relative paths
    const filePath = file.path;
    const lastSlash = filePath.lastIndexOf('/');
    const fileDir = lastSlash >= 0 ? filePath.slice(0, lastSlash) : '';

    const imgs = previewPane.querySelectorAll('img');
    for (const img of imgs) {
      const src = img.getAttribute('src');
      if (!src) continue;
      // Skip data URIs, blob URLs, and absolute URLs
      if (src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('http://') || src.startsWith('https://')) continue;

      // Decode percent-encoded characters (e.g. %20 for spaces) back to
      // real filesystem characters before building the repo path.
      const decodedSrc = decodeURIComponent(src);

      // Resolve relative path against the file's directory
      const resolvedPath = fileDir ? fileDir + '/' + decodedSrc : decodedSrc;
      // Normalize path segments (handle ../ and ./)
      const normalized = this._normalizePath(resolvedPath);

      try {
        const ext = decodedSrc.slice(decodedSrc.lastIndexOf('.')).toLowerCase();
        if (ext === '.svg') {
          // SVG is text — fetch as text content and build a data URI
          const result = await this.rpcExtract('Repo.get_file_content', normalized);
          if (result?.error) {
            img.alt = `[Image not found: ${decodedSrc}]`;
            img.style.opacity = '0.4';
            continue;
          }
          const content = result?.content ?? result ?? '';
          img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(content);
        } else {
          // Binary images — fetch as base64 data URI
          const result = await this.rpcExtract('Repo.get_file_base64', normalized);
          if (result?.error) {
            img.alt = `[Image not found: ${decodedSrc}]`;
            img.style.opacity = '0.4';
            continue;
          }
          if (result?.data_uri) {
            img.src = result.data_uri;
          }
        }
      } catch (e) {
        console.warn('Failed to load preview image:', normalized, e);
        img.alt = `[Failed to load: ${decodedSrc}]`;
        img.style.opacity = '0.4';
      }
    }
  }

  /**
   * Normalize a file path — resolve . and .. segments.
   */
  _normalizePath(path) {
    const parts = path.split('/');
    const resolved = [];
    for (const part of parts) {
      if (part === '.' || part === '') continue;
      if (part === '..') {
        resolved.pop();
      } else {
        resolved.push(part);
      }
    }
    return resolved.join('/');
  }

  // === Preview ↔ Editor Scroll Sync ===

  /**
   * Editor → Preview: find which source line is at the top of the editor
   * viewport and scroll the preview pane to the corresponding element.
   *
   * Problem 4 fix: no artificial offsets — symmetric in both directions.
   * Problem 5 fix: uses pixel-precise setScrollTop instead of revealLine.
   */
  _scrollPreviewToEditorLine() {
    const previewPane = this.shadowRoot?.querySelector('.preview-pane');
    if (!previewPane || !this._editor) return;

    const modifiedEditor = this._editor.getModifiedEditor();
    const scrollTop = modifiedEditor.getScrollTop();
    const lineHeight = modifiedEditor.getOption(monaco.editor.EditorOption.lineHeight);
    const topLine = Math.floor(scrollTop / lineHeight) + 1;

    const anchors = _getPreviewAnchors(previewPane);
    if (anchors.length === 0) return;

    // Find the anchor at or just before topLine
    let target = anchors[0];
    for (const a of anchors) {
      if (a.line <= topLine) target = a;
      else break;
    }

    // Interpolate between this anchor and the next for smooth scrolling
    const idx = anchors.indexOf(target);
    const next = anchors[idx + 1];
    let scrollTarget = target.offsetTop;
    if (next && next.line > target.line) {
      const fraction = (topLine - target.line) / (next.line - target.line);
      scrollTarget += fraction * (next.offsetTop - target.offsetTop);
    }

    previewPane.scrollTop = scrollTarget;
  }

  /**
   * Preview → Editor: find which data-source-line element is at the top of
   * the preview viewport and scroll the editor to that line.
   */
  _scrollEditorToPreviewLine() {
    if (!this._editor) return;
    const previewPane = this.shadowRoot?.querySelector('.preview-pane');
    if (!previewPane) return;

    if (this._scrollLock === 'editor') return;
    this._scrollLock = 'preview';
    clearTimeout(this._scrollLockTimer);
    this._scrollLockTimer = setTimeout(() => { this._scrollLock = null; }, 120);

    const scrollTop = previewPane.scrollTop;
    const anchors = _getPreviewAnchors(previewPane);
    if (anchors.length === 0) return;

    // Find the anchor at or just before current scroll position
    let target = anchors[0];
    for (const a of anchors) {
      if (a.offsetTop <= scrollTop) target = a;
      else break;
    }

    // Interpolate for sub-anchor precision
    const idx = anchors.indexOf(target);
    const next = anchors[idx + 1];
    let targetLine = target.line;
    if (next && next.offsetTop > target.offsetTop) {
      const fraction = (scrollTop - target.offsetTop) / (next.offsetTop - target.offsetTop);
      targetLine += fraction * (next.line - target.line);
    }

    // Problem 5 fix: pixel-precise positioning instead of revealLine
    const modifiedEditor = this._editor.getModifiedEditor();
    const lineHeight = modifiedEditor.getOption(monaco.editor.EditorOption.lineHeight);
    modifiedEditor.setScrollTop((targetLine - 1) * lineHeight);
  }

  // === Rendering ===

  render() {
    const hasFiles = this._files.length > 0;
    const file = hasFiles && this._activeIndex >= 0 ? this._files[this._activeIndex] : null;
    const isDirty = file ? this._dirtySet.has(file.path) : false;
    const showPreviewBtn = file && this._isPreviewableFile(file.path);

    if (this._previewMode && file) {
      return html`
        <div class="split-container">
          <div class="editor-pane">
            ${this._renderOverlayButtons(file, isDirty, false)}
            ${this._renderPanelLabels(true)}
          </div>
          <div class="preview-pane"
               @scroll=${() => this._scrollEditorToPreviewLine()}
               @click=${this._onPreviewClick}>
            <button
              class="preview-btn active"
              title="Toggle Markdown preview"
              @click=${() => this._togglePreview()}
            >
              <span class="preview-icon"></span>
              Preview
            </button>
            ${unsafeHTML(this._previewContent)}
          </div>
        </div>
      `;
    }

    return html`
      <div class="editor-container">
        ${this._renderOverlayButtons(file, isDirty, showPreviewBtn)}
        ${this._renderPanelLabels(false)}
        ${!hasFiles ? html`
          <div class="empty-state">
            <div class="watermark">AC⚡DC</div>
          </div>
        ` : nothing}
      </div>
    `;
  }

  _renderPanelLabels(inlineMode) {
    const file = this._activeIndex >= 0 ? this._files[this._activeIndex] : null;
    if (!file) return nothing;
    const inlineCls = inlineMode ? ' inline-mode' : '';
    return html`
      ${this._leftLabel ? html`
        <div class="panel-label left${inlineCls}" title="${this._leftLabel.fullPath}">
          ${this._leftLabel.name}
        </div>
      ` : nothing}
      ${this._rightLabel ? html`
        <div class="panel-label right${inlineCls}" title="${this._rightLabel.fullPath}">
          ${this._rightLabel.name}
        </div>
      ` : nothing}
    `;
  }

  _renderOverlayButtons(file, isDirty, showPreviewBtn) {
    if (!file) return nothing;
    const showVisualBtn = this._isSvgFile(file.path);
    return html`
      ${showVisualBtn ? html`
        <button
          class="visual-btn"
          title="Switch to visual SVG editor"
          @click=${() => this._switchToVisualMode()}
        >🎨 Visual</button>
      ` : nothing}
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