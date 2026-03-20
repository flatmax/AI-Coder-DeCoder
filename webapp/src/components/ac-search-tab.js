/**
 * Search tab — two-panel layout with file picker (left) and match context (right).
 *
 * Features: debounced search, file picker showing matching files with match counts,
 * match context panel with highlighted results, bidirectional scroll sync,
 * resizable divider, three toggles (ignore case, regex, whole word).
 */

import { LitElement, html, css, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { theme, scrollbarStyles } from '../styles/theme.js';
import { RpcMixin } from '../rpc-mixin.js';
import './file-picker.js';

const STORAGE_KEY_IGNORE_CASE = 'ac-dc-search-ignore-case';
const STORAGE_KEY_REGEX = 'ac-dc-search-regex';
const STORAGE_KEY_WHOLE_WORD = 'ac-dc-search-whole-word';
const STORAGE_KEY_DIVIDER = 'ac-dc-search-divider';

const MIN_PICKER_WIDTH = 80;
const DEFAULT_PICKER_PERCENT = 45;

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export class AcSearchTab extends RpcMixin(LitElement) {
  static properties = {
    _query: { type: String, state: true },
    _ignoreCase: { type: Boolean, state: true },
    _useRegex: { type: Boolean, state: true },
    _wholeWord: { type: Boolean, state: true },
    _results: { type: Array, state: true },
    _loading: { type: Boolean, state: true },
    _focusedIndex: { type: Number, state: true },
    _flatMatches: { type: Array, state: true },
    _activeFile: { type: String, state: true },
    _pickerWidth: { type: Number, state: true },
  };

  static styles = [theme, scrollbarStyles, css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    /* Search header */
    .search-header {
      padding: 8px 12px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-primary);
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex-shrink: 0;
    }

    .search-input-row {
      display: flex;
      gap: 6px;
      align-items: center;
    }

    .search-input {
      flex: 1;
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-family: var(--font-mono);
      font-size: 0.85rem;
      padding: 6px 10px;
      outline: none;
    }
    .search-input:focus {
      border-color: var(--accent-primary);
    }
    .search-input::placeholder {
      color: var(--text-muted);
    }

    .search-toggles {
      display: flex;
      gap: 4px;
    }

    .toggle-btn {
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      color: var(--text-muted);
      font-size: 0.7rem;
      font-family: var(--font-mono);
      padding: 2px 8px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      user-select: none;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .toggle-btn:hover {
      color: var(--text-secondary);
    }
    .toggle-btn.active {
      background: var(--accent-primary);
      border-color: var(--accent-primary);
      color: var(--bg-primary);
    }

    .result-count {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-left: auto;
      white-space: nowrap;
    }

    /* Two-panel body */
    .search-body {
      display: flex;
      flex: 1;
      overflow: hidden;
      min-height: 0;
    }

    .search-picker {
      overflow-y: auto;
      flex-shrink: 0;
      border-right: 1px solid var(--border-primary);
    }

    .panel-divider {
      width: 4px;
      cursor: col-resize;
      background: transparent;
      flex-shrink: 0;
      transition: background 0.15s;
    }
    .panel-divider:hover,
    .panel-divider.dragging {
      background: var(--accent-primary);
      opacity: 0.3;
    }

    .match-panel {
      flex: 1;
      overflow-y: auto;
      min-width: 0;
    }

    /* Match file sections */
    .match-file-section {
      border-bottom: 1px solid var(--border-primary);
    }

    .match-file-header {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      padding: 6px 12px;
      background: var(--bg-tertiary);
      cursor: pointer;
      user-select: none;
      gap: 8px;
      font-size: 0.8rem;
      border-bottom: 1px solid var(--border-primary);
    }
    .match-file-header:hover {
      background: var(--bg-secondary);
    }

    .match-file-path {
      font-family: var(--font-mono);
      color: var(--accent-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }

    .match-file-count {
      font-size: 0.7rem;
      color: var(--text-muted);
      flex-shrink: 0;
    }

    /* Match rows */
    .match-row {
      display: flex;
      padding: 3px 10px 3px 16px;
      cursor: pointer;
      font-family: var(--font-mono);
      font-size: 0.78rem;
      line-height: 1.6;
      gap: 8px;
      border-left: 2px solid transparent;
    }
    .match-row:hover {
      background: var(--bg-tertiary);
    }
    .match-row.focused {
      background: var(--bg-tertiary);
      border-left-color: var(--accent-primary);
    }

    .match-line-num {
      color: var(--text-muted);
      min-width: 4ch;
      text-align: right;
      flex-shrink: 0;
      user-select: none;
    }

    .match-text {
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .match-highlight {
      background: rgba(255, 200, 50, 0.25);
      color: var(--text-primary);
      border-radius: 2px;
      padding: 0 1px;
    }

    /* Context lines */
    .context-row {
      display: flex;
      padding: 1px 10px 1px 16px;
      font-family: var(--font-mono);
      font-size: 0.75rem;
      gap: 8px;
      opacity: 0.5;
    }
    .context-line-num {
      color: var(--text-muted);
      min-width: 4ch;
      text-align: right;
      flex-shrink: 0;
    }
    .context-text {
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Status messages */
    .no-results {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 0.85rem;
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      color: var(--text-muted);
      font-size: 0.85rem;
    }
  `];

  constructor() {
    super();
    this._query = '';
    this._ignoreCase = this._loadBool(STORAGE_KEY_IGNORE_CASE, true);
    this._useRegex = this._loadBool(STORAGE_KEY_REGEX, false);
    this._wholeWord = this._loadBool(STORAGE_KEY_WHOLE_WORD, false);
    this._results = [];
    this._loading = false;
    this._focusedIndex = -1;
    this._flatMatches = [];
    this._activeFile = '';
    this._debounceTimer = null;
    this._generation = 0;
    this._scrollSyncPaused = false;
    this._isDragging = false;
    this._scrollExpandedDirs = new Set(); // dirs expanded by scroll sync (not user)

    // Load persisted divider width
    try {
      const saved = parseInt(localStorage.getItem(STORAGE_KEY_DIVIDER));
      this._pickerWidth = (saved && saved >= MIN_PICKER_WIDTH) ? saved : 0;
    } catch {
      this._pickerWidth = 0; // 0 means use percentage default
    }

    this._onFileClicked = this._onFileClicked.bind(this);
  }

  _loadBool(key, defaultVal) {
    try {
      const v = localStorage.getItem(key);
      if (v === null) return defaultVal;
      return v === 'true';
    } catch { return defaultVal; }
  }

  _saveBool(key, val) {
    try { localStorage.setItem(key, String(val)); } catch {}
  }

  connectedCallback() {
    super.connectedCallback();
  }

  firstUpdated() {
    // Intercept file-clicked from the embedded picker
    this.shadowRoot.addEventListener('file-clicked', this._onFileClicked);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.shadowRoot.removeEventListener('file-clicked', this._onFileClicked);
  }

  // === Public API (called from dialog) ===

  focus() {
    requestAnimationFrame(() => {
      const input = this.shadowRoot?.querySelector('.search-input');
      if (input) {
        input.focus();
        input.select();
      }
    });
  }

  prefill(text) {
    if (text && typeof text === 'string') {
      this._query = text;
      this._runSearch();
      this.focus();
    }
  }

  // === Picker event handling ===

  _onFileClicked(e) {
    // Intercept file-clicked from picker: scroll match panel instead of opening file
    e.stopPropagation();
    const path = e.detail?.path;
    if (!path) return;
    this._scrollMatchPanelToFile(path);
  }

  _scrollMatchPanelToFile(path) {
    const panel = this.shadowRoot?.querySelector('.match-panel');
    const section = panel?.querySelector(`[data-file-section="${CSS.escape(path)}"]`);
    if (section && panel) {
      this._scrollSyncPaused = true;
      // User-initiated navigation — stop tracking scroll-expanded dirs
      this._scrollExpandedDirs.clear();
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => { this._scrollSyncPaused = false; }, 400);
    }
  }

  // === Search ===

  _onInput(e) {
    this._query = e.target.value;
    this._debounceSearch();
  }

  _debounceSearch() {
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._runSearch(), 300);
  }

  async _runSearch() {
    const query = this._query.trim();
    if (!query) {
      this._results = [];
      this._flatMatches = [];
      this._focusedIndex = -1;
      this._activeFile = '';
      return;
    }
    if (!this.rpcConnected) return;

    this._loading = true;
    const gen = ++this._generation;

    try {
      const result = await this.rpcExtract(
        'Repo.search_files',
        query,
        this._wholeWord,
        this._useRegex,
        this._ignoreCase,
        1 // context_lines
      );

      // Discard stale responses
      if (gen !== this._generation) return;

      if (Array.isArray(result)) {
        this._results = result;
      } else if (result?.results && Array.isArray(result.results)) {
        this._results = result.results;
      } else {
        this._results = [];
      }

      this._buildFlatMatches();
      this._focusedIndex = -1;

      // Set first file as active
      this._activeFile = this._results.length > 0 ? this._results[0].file : '';

      // Update picker with pruned search tree
      await this.updateComplete;
      this._updatePickerTree();

      // Highlight first file in picker
      if (this._activeFile) {
        this._syncPickerHighlight(this._activeFile);
      }
    } catch (e) {
      if (gen !== this._generation) return;
      console.warn('Search failed:', e);
      this._results = [];
      this._flatMatches = [];
    } finally {
      if (gen === this._generation) {
        this._loading = false;
      }
    }
  }

  _buildFlatMatches() {
    const flat = [];
    for (const fileResult of this._results) {
      for (const match of (fileResult.matches || [])) {
        flat.push({ file: fileResult.file, match });
      }
    }
    this._flatMatches = flat;
  }

  // === Tree building for picker ===

  _buildSearchTree(results) {
    const root = { name: '', type: 'dir', path: '', lines: 0, children: [] };
    for (const r of results) {
      const parts = r.file.split('/');
      let node = root;
      for (let i = 0; i < parts.length; i++) {
        const isFile = (i === parts.length - 1);
        const name = parts[i];
        const path = parts.slice(0, i + 1).join('/');
        if (isFile) {
          node.children.push({
            name,
            type: 'file',
            path,
            lines: (r.matches || []).length,
            mtime: 0,
            children: [],
          });
        } else {
          let dir = node.children.find(c => c.name === name && c.type === 'dir');
          if (!dir) {
            dir = { name, type: 'dir', path, lines: 0, children: [] };
            node.children.push(dir);
          }
          node = dir;
        }
      }
    }
    return root;
  }

  _updatePickerTree() {
    const picker = this.shadowRoot?.querySelector('.search-picker');
    if (!picker) return;
    if (this._results.length > 0) {
      const tree = this._buildSearchTree(this._results);
      picker.setTree(tree);
    } else {
      picker.setTree({ name: '', type: 'dir', path: '', lines: 0, children: [] });
    }
  }

  // === Toggles ===

  _toggleIgnoreCase() {
    this._ignoreCase = !this._ignoreCase;
    this._saveBool(STORAGE_KEY_IGNORE_CASE, this._ignoreCase);
    this._runSearch();
  }

  _toggleRegex() {
    this._useRegex = !this._useRegex;
    this._saveBool(STORAGE_KEY_REGEX, this._useRegex);
    this._runSearch();
  }

  _toggleWholeWord() {
    this._wholeWord = !this._wholeWord;
    this._saveBool(STORAGE_KEY_WHOLE_WORD, this._wholeWord);
    this._runSearch();
  }

  // === Keyboard Navigation ===

  _onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (this._flatMatches.length > 0) {
        this._focusedIndex = Math.min(this._focusedIndex + 1, this._flatMatches.length - 1);
        this._scrollToFocused();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this._flatMatches.length > 0) {
        this._focusedIndex = Math.max(this._focusedIndex - 1, 0);
        this._scrollToFocused();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this._focusedIndex >= 0 && this._focusedIndex < this._flatMatches.length) {
        this._navigateToMatch(this._flatMatches[this._focusedIndex]);
      } else if (this._flatMatches.length > 0) {
        this._focusedIndex = 0;
        this._navigateToMatch(this._flatMatches[0]);
      }
    } else if (e.key === 'Escape') {
      if (this._query) {
        this._query = '';
        this._results = [];
        this._flatMatches = [];
        this._focusedIndex = -1;
        this._activeFile = '';
        const input = this.shadowRoot?.querySelector('.search-input');
        if (input) input.value = '';
        this._updatePickerTree();
      }
    }
  }

  _scrollToFocused() {
    requestAnimationFrame(() => {
      const el = this.shadowRoot?.querySelector('.match-row.focused');
      if (el) {
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  _navigateToMatch(item) {
    if (!item) return;
    this.dispatchEvent(new CustomEvent('search-navigate', {
      detail: { path: item.file, line: item.match.line_num },
      bubbles: true, composed: true,
    }));
  }

  _onMatchClick(file, match) {
    const idx = this._flatMatches.findIndex(
      m => m.file === file && m.match.line_num === match.line_num
    );
    if (idx >= 0) this._focusedIndex = idx;
    this._navigateToMatch({ file, match });
  }

  _onFileHeaderClick(filePath) {
    this.dispatchEvent(new CustomEvent('search-navigate', {
      detail: { path: filePath },
      bubbles: true, composed: true,
    }));
  }

  // === Match panel scroll sync ===

  _onMatchPanelScroll() {
    if (this._scrollSyncPaused) return;
    const panel = this.shadowRoot?.querySelector('.match-panel');
    if (!panel) return;
    const sections = panel.querySelectorAll('.match-file-section');
    const panelTop = panel.scrollTop;
    let activeFile = '';
    for (const section of sections) {
      if (section.offsetTop <= panelTop + 10) {
        activeFile = section.dataset.fileSection || '';
      }
    }
    if (activeFile && activeFile !== this._activeFile) {
      this._activeFile = activeFile;
      this._syncPickerHighlight(activeFile);
    }
  }

  _syncPickerHighlight(filePath) {
    const picker = this.shadowRoot?.querySelector('.search-picker');
    if (!picker) return;
    picker._activeInViewer = filePath || '';
    picker._focusedPath = filePath || '';

    // Determine which ancestor dirs the new file needs expanded
    const neededDirs = new Set();
    if (filePath) {
      const parts = filePath.split('/');
      let current = '';
      for (let i = 0; i < parts.length - 1; i++) {
        current = current ? `${current}/${parts[i]}` : parts[i];
        neededDirs.add(current);
      }
    }

    // Collapse dirs that were expanded by previous scroll sync but aren't needed now
    let changed = false;
    for (const dir of this._scrollExpandedDirs) {
      if (!neededDirs.has(dir)) {
        picker._expanded.delete(dir);
        this._scrollExpandedDirs.delete(dir);
        changed = true;
      }
    }

    // Expand ancestor dirs for the new file, tracking which ones we expand
    if (filePath) {
      for (const dir of neededDirs) {
        if (!picker._expanded.has(dir)) {
          picker._expanded.add(dir);
          this._scrollExpandedDirs.add(dir);
          changed = true;
        }
      }
    }

    if (changed) {
      picker._expanded = new Set(picker._expanded);
    }
    picker.requestUpdate();
    // Scroll the picker to make the highlighted row visible
    requestAnimationFrame(() => {
      const row = picker.shadowRoot?.querySelector('.tree-row.active-in-viewer');
      if (row) row.scrollIntoView({ block: 'nearest' });
    });
  }

  // === Resizable divider ===

  _onDividerMouseDown(e) {
    e.preventDefault();
    this._isDragging = true;
    const startX = e.clientX;
    const startWidth = this._pickerWidth || this._getDefaultPickerWidth();

    const onMove = (moveEvent) => {
      const body = this.shadowRoot?.querySelector('.search-body');
      const maxWidth = body ? body.clientWidth * 0.7 : 500;
      const dx = moveEvent.clientX - startX;
      this._pickerWidth = Math.max(MIN_PICKER_WIDTH, Math.min(maxWidth, startWidth + dx));
    };

    const onUp = () => {
      this._isDragging = false;
      try { localStorage.setItem(STORAGE_KEY_DIVIDER, String(Math.round(this._pickerWidth))); } catch {}
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  _getDefaultPickerWidth() {
    const body = this.shadowRoot?.querySelector('.search-body');
    return body ? body.clientWidth * DEFAULT_PICKER_PERCENT / 100 : 200;
  }

  _getPickerWidthStyle() {
    if (this._pickerWidth > 0) return `${this._pickerWidth}px`;
    return `${DEFAULT_PICKER_PERCENT}%`;
  }

  // === Highlight ===

  _highlightMatch(text, query) {
    if (!query) return escapeHtml(text);
    try {
      let patternSrc;
      if (this._useRegex) {
        patternSrc = query;
      } else {
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        patternSrc = this._wholeWord ? `\\b${escaped}\\b` : escaped;
      }
      const flags = this._ignoreCase ? 'gi' : 'g';
      const regex = new RegExp(`(${patternSrc})`, flags);
      const parts = text.split(regex);
      return parts.map((part, i) =>
        i % 2 === 1
          ? `<span class="match-highlight">${escapeHtml(part)}</span>`
          : escapeHtml(part)
      ).join('');
    } catch {
      return escapeHtml(text);
    }
  }

  // === Total match count ===

  _totalMatches() {
    let total = 0;
    for (const r of this._results) {
      total += (r.matches || []).length;
    }
    return total;
  }

  // === Render ===

  _renderContextLines(lines) {
    if (!lines || lines.length === 0) return nothing;
    return lines.map(ctx => html`
      <div class="context-row">
        <span class="context-line-num">${ctx.line_num}</span>
        <span class="context-text">${ctx.line}</span>
      </div>
    `);
  }

  _renderFileSection(fileResult) {
    const matchCount = (fileResult.matches || []).length;

    return html`
      <div class="match-file-section" data-file-section="${fileResult.file}">
        <div class="match-file-header" @click=${() => this._onFileHeaderClick(fileResult.file)}>
          <span class="match-file-path">${fileResult.file}</span>
          <span class="match-file-count">${matchCount}</span>
        </div>
        ${(fileResult.matches || []).map(match => {
          const flatIdx = this._flatMatches.findIndex(
            m => m.file === fileResult.file && m.match.line_num === match.line_num
          );
          const isFocused = flatIdx === this._focusedIndex;

          return html`
            ${this._renderContextLines(match.context_before)}
            <div
              class="match-row ${isFocused ? 'focused' : ''}"
              @click=${() => this._onMatchClick(fileResult.file, match)}
            >
              <span class="match-line-num">${match.line_num}</span>
              <span class="match-text">${unsafeHTML(this._highlightMatch(match.line, this._query.trim()))}</span>
            </div>
            ${this._renderContextLines(match.context_after)}
          `;
        })}
      </div>
    `;
  }

  render() {
    const totalMatches = this._totalMatches();
    const totalFiles = this._results.length;
    const hasResults = this._results.length > 0;

    return html`
      <div class="search-header">
        <div class="search-input-row">
          <input
            class="search-input"
            type="text"
            placeholder="Search files..."
            aria-label="Search repository files"
            .value=${this._query}
            @input=${this._onInput}
            @keydown=${this._onKeyDown}
          >
          ${totalMatches > 0 ? html`
            <span class="result-count" aria-live="polite">${totalMatches} in ${totalFiles} files</span>
          ` : nothing}
        </div>
        <div class="search-toggles">
          <button
            class="toggle-btn ${this._ignoreCase ? 'active' : ''}"
            @click=${this._toggleIgnoreCase}
            title="Ignore case"
            aria-label="Toggle ignore case"
            aria-pressed="${this._ignoreCase}"
          >Aa</button>
          <button
            class="toggle-btn ${this._useRegex ? 'active' : ''}"
            @click=${this._toggleRegex}
            title="Use regex"
            aria-label="Toggle regex search"
            aria-pressed="${this._useRegex}"
          >.*</button>
          <button
            class="toggle-btn ${this._wholeWord ? 'active' : ''}"
            @click=${this._toggleWholeWord}
            title="Whole word"
            aria-label="Toggle whole word match"
            aria-pressed="${this._wholeWord}"
          >ab</button>
        </div>
      </div>

      ${this._loading ? html`
        <div class="loading">Searching...</div>
      ` : !hasResults ? html`
        <div class="no-results">
          ${this._query.trim() ? 'No results found' : 'Type to search across files'}
        </div>
      ` : html`
        <div class="search-body">
          <ac-file-picker
            class="search-picker"
            style="width: ${this._getPickerWidthStyle()}"
          ></ac-file-picker>
          <div
            class="panel-divider ${this._isDragging ? 'dragging' : ''}"
            @mousedown=${this._onDividerMouseDown}
          ></div>
          <div
            class="match-panel"
            role="region"
            aria-label="Search results"
            @keydown=${this._onKeyDown}
            @scroll=${this._onMatchPanelScroll}
            tabindex="-1"
          >
            ${this._results.map(r => this._renderFileSection(r))}
          </div>
        </div>
      `}
    `;
  }
}

customElements.define('ac-search-tab', AcSearchTab);