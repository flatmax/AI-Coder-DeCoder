/**
 * Search tab — full-text search across the repository.
 *
 * Features: debounced search, result grouping by file, keyboard navigation,
 * three toggles (ignore case, regex, whole word), Ctrl+Shift+F shortcut.
 */

import { LitElement, html, css, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { theme, scrollbarStyles } from '../styles/theme.js';
import { RpcMixin } from '../rpc-mixin.js';

const STORAGE_KEY_IGNORE_CASE = 'ac-dc-search-ignore-case';
const STORAGE_KEY_REGEX = 'ac-dc-search-regex';
const STORAGE_KEY_WHOLE_WORD = 'ac-dc-search-whole-word';

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
    _expandedFiles: { type: Object, state: true },
    _focusedIndex: { type: Number, state: true },
    _flatMatches: { type: Array, state: true },
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

    /* Results */
    .results {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }

    .no-results {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 0.85rem;
    }

    /* File group */
    .file-group {
      border-bottom: 1px solid var(--border-primary);
    }

    .file-header {
      display: flex;
      align-items: center;
      padding: 6px 12px;
      cursor: pointer;
      user-select: none;
      gap: 6px;
      background: var(--bg-tertiary);
      font-size: 0.8rem;
    }
    .file-header:hover {
      background: var(--bg-secondary);
    }

    .file-toggle {
      font-size: 0.6rem;
      color: var(--text-muted);
      width: 12px;
      flex-shrink: 0;
    }

    .file-path {
      font-family: var(--font-mono);
      color: var(--accent-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }

    .match-count {
      font-size: 0.7rem;
      color: var(--text-muted);
      flex-shrink: 0;
    }

    /* Match rows */
    .match-list {
      display: none;
    }
    .match-list.expanded {
      display: block;
    }

    .match-row {
      display: flex;
      padding: 3px 12px 3px 30px;
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
      padding: 1px 12px 1px 30px;
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

    /* Loading */
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
    this._expandedFiles = new Set();
    this._focusedIndex = -1;
    this._flatMatches = [];
    this._debounceTimer = null;
    this._generation = 0;
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

      // Auto-expand all files
      this._expandedFiles = new Set(this._results.map(r => r.file));
      this._buildFlatMatches();
      this._focusedIndex = -1;
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
      if (!this._expandedFiles.has(fileResult.file)) continue;
      for (const match of (fileResult.matches || [])) {
        flat.push({ file: fileResult.file, match });
      }
    }
    this._flatMatches = flat;
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

  // === File expand/collapse ===

  _toggleFile(filePath) {
    const next = new Set(this._expandedFiles);
    if (next.has(filePath)) {
      next.delete(filePath);
    } else {
      next.add(filePath);
    }
    this._expandedFiles = next;
    this._buildFlatMatches();
  }

  // === Navigation ===

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
        const input = this.shadowRoot?.querySelector('.search-input');
        if (input) input.value = '';
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
    // Update focused index
    const idx = this._flatMatches.findIndex(
      m => m.file === file && m.match.line_num === match.line_num
    );
    if (idx >= 0) this._focusedIndex = idx;

    this._navigateToMatch({ file, match });
  }

  _onFileHeaderClick(filePath) {
    this._toggleFile(filePath);
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
      // Apply pattern to the raw text first, then escape for HTML
      const flags = this._ignoreCase ? 'gi' : 'g';
      const regex = new RegExp(`(${patternSrc})`, flags);
      // Split text on matches, escape each part, wrap matches
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

  _renderFileGroup(fileResult) {
    const expanded = this._expandedFiles.has(fileResult.file);
    const matchCount = (fileResult.matches || []).length;

    return html`
      <div class="file-group">
        <div class="file-header" @click=${() => this._onFileHeaderClick(fileResult.file)}>
          <span class="file-toggle">${expanded ? '▼' : '▶'}</span>
          <span class="file-path">${fileResult.file}</span>
          <span class="match-count">${matchCount}</span>
        </div>
        <div class="match-list ${expanded ? 'expanded' : ''}">
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
      </div>
    `;
  }

  render() {
    const totalMatches = this._totalMatches();
    const totalFiles = this._results.length;

    return html`
      <div class="search-header">
        <div class="search-input-row">
          <input
            class="search-input"
            type="text"
            placeholder="Search files..."
            .value=${this._query}
            @input=${this._onInput}
            @keydown=${this._onKeyDown}
          >
          ${totalMatches > 0 ? html`
            <span class="result-count">${totalMatches} in ${totalFiles} files</span>
          ` : nothing}
        </div>
        <div class="search-toggles">
          <button
            class="toggle-btn ${this._ignoreCase ? 'active' : ''}"
            @click=${this._toggleIgnoreCase}
            title="Ignore case"
          >Aa</button>
          <button
            class="toggle-btn ${this._useRegex ? 'active' : ''}"
            @click=${this._toggleRegex}
            title="Use regex"
          >.*</button>
          <button
            class="toggle-btn ${this._wholeWord ? 'active' : ''}"
            @click=${this._toggleWholeWord}
            title="Whole word"
          >ab</button>
        </div>
      </div>

      <div class="results" @keydown=${this._onKeyDown} tabindex="-1">
        ${this._loading ? html`
          <div class="loading">Searching...</div>
        ` : this._results.length === 0 ? html`
          ${this._query.trim() ? html`
            <div class="no-results">No results found</div>
          ` : html`
            <div class="no-results">Type to search across files</div>
          `}
        ` : html`
          ${this._results.map(r => this._renderFileGroup(r))}
        `}
      </div>
    `;
  }
}

customElements.define('ac-search-tab', AcSearchTab);