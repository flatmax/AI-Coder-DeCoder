import { LitElement, html, css, nothing } from 'lit';
import { RpcMixin } from '../rpc-mixin.js';

const DEBOUNCE_MS = 300;

/**
 * Search tab — full-text search via git grep with result grouping,
 * keyboard navigation, and option toggles.
 */
class SearchTab extends RpcMixin(LitElement) {
  static properties = {
    _query: { type: String, state: true },
    _results: { type: Array, state: true },
    _loading: { type: Boolean, state: true },
    _error: { type: String, state: true },
    _ignoreCase: { type: Boolean, state: true },
    _useRegex: { type: Boolean, state: true },
    _wholeWord: { type: Boolean, state: true },
    _focusedIdx: { type: Number, state: true },
    _expandedFiles: { type: Object, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    /* ── Search bar ── */
    .search-bar {
      padding: 8px 12px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex-shrink: 0;
      background: var(--bg-secondary);
    }

    .search-row {
      display: flex;
      gap: 6px;
      align-items: center;
    }

    .search-input {
      flex: 1;
      padding: 6px 10px;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-size: 13px;
      font-family: var(--font-mono);
      outline: none;
    }
    .search-input:focus { border-color: var(--accent-primary); }
    .search-input::placeholder { color: var(--text-muted); }

    .option-row {
      display: flex;
      gap: 4px;
    }

    .option-btn {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 3px 8px;
      cursor: pointer;
      font-size: 11px;
      color: var(--text-secondary);
      transition: background var(--transition-fast), color var(--transition-fast);
      white-space: nowrap;
      font-family: var(--font-mono);
    }
    .option-btn:hover {
      background: var(--bg-elevated);
      color: var(--text-primary);
    }
    .option-btn.active {
      background: var(--accent-primary);
      color: var(--bg-primary);
      border-color: var(--accent-primary);
    }

    .result-count {
      font-size: 11px;
      color: var(--text-muted);
      padding: 0 2px;
      white-space: nowrap;
      flex-shrink: 0;
    }

    /* ── Results ── */
    .results-container {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }

    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 13px;
      padding: 20px;
      text-align: center;
    }

    .loading-state {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
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

    .error-state {
      padding: 12px 16px;
      color: var(--accent-error);
      font-size: 12px;
    }

    /* ── File group ── */
    .file-group {
      border-bottom: 1px solid var(--border-color);
    }

    .file-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      cursor: pointer;
      user-select: none;
      background: var(--bg-elevated);
      transition: background var(--transition-fast);
      font-size: 12px;
    }
    .file-header:hover { background: var(--bg-surface); }

    .file-toggle {
      font-size: 10px;
      color: var(--text-muted);
      width: 14px;
      text-align: center;
      flex-shrink: 0;
    }

    .file-path {
      flex: 1;
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--accent-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .file-path:hover { text-decoration: underline; }

    .match-count {
      font-size: 10px;
      color: var(--text-muted);
      flex-shrink: 0;
      padding: 1px 5px;
      background: var(--bg-surface);
      border-radius: 8px;
    }

    /* ── Match rows ── */
    .match-row {
      display: flex;
      align-items: flex-start;
      gap: 0;
      padding: 3px 12px 3px 32px;
      cursor: pointer;
      transition: background var(--transition-fast);
      font-size: 12px;
      font-family: var(--font-mono);
      line-height: 1.5;
      border-left: 2px solid transparent;
    }
    .match-row:hover { background: var(--bg-surface); }
    .match-row.focused {
      background: var(--bg-surface);
      border-left-color: var(--accent-primary);
    }

    .match-line-num {
      color: var(--text-muted);
      width: 40px;
      flex-shrink: 0;
      text-align: right;
      padding-right: 8px;
      font-size: 11px;
    }

    .match-content {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: pre;
      color: var(--text-secondary);
    }

    .match-highlight {
      background: rgba(79, 195, 247, 0.2);
      color: var(--accent-primary);
      font-weight: 600;
      border-radius: 2px;
    }

    /* ── Context lines ── */
    .context-row {
      display: flex;
      align-items: flex-start;
      padding: 1px 12px 1px 32px;
      font-size: 11px;
      font-family: var(--font-mono);
      line-height: 1.5;
      opacity: 0.5;
    }

    .context-line-num {
      color: var(--text-muted);
      width: 40px;
      flex-shrink: 0;
      text-align: right;
      padding-right: 8px;
      font-size: 10px;
    }

    .context-content {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: pre;
      color: var(--text-muted);
    }
  `;

  constructor() {
    super();
    this._query = '';
    this._results = [];
    this._loading = false;
    this._error = '';
    this._focusedIdx = -1;
    this._expandedFiles = new Set();
    this._debounceTimer = null;
    this._generation = 0;

    // Restore options from localStorage
    this._ignoreCase = localStorage.getItem('ac-dc-search-ignoreCase') !== 'false';
    this._useRegex = localStorage.getItem('ac-dc-search-useRegex') === 'true';
    this._wholeWord = localStorage.getItem('ac-dc-search-wholeWord') === 'true';
  }

  // ── Focus input on tab activation ──

  focus() {
    this.updateComplete.then(() => {
      this.shadowRoot.querySelector('.search-input')?.focus();
    });
  }

  /**
   * Focus the search input and pre-fill with the given text,
   * falling back to clipboard if no text is provided.
   */
  async focusWithSelection(preCapturedText) {
    await this.updateComplete;
    const input = this.shadowRoot.querySelector('.search-input');
    if (!input) return;

    // 1. Use pre-captured selection text (grabbed before focus steals it)
    const selected = (preCapturedText || '').trim();
    if (selected && !selected.includes('\n')) {
      this._query = selected;
      input.value = selected;
      input.focus();
      input.select();
      this._scheduleSearch();
      return;
    }

    // 2. Fallback to clipboard
    input.focus();
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = (text || '').trim();
      if (trimmed && !trimmed.includes('\n')) {
        this._query = trimmed;
        input.value = trimmed;
        input.select();
        this._scheduleSearch();
      }
    } catch {
      // Clipboard read denied or unavailable — just focus
    }
  }

  // ── Search execution ──

  _onInput(e) {
    this._query = e.target.value;
    this._scheduleSearch();
  }

  _scheduleSearch() {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    if (!this._query.trim()) {
      this._results = [];
      this._error = '';
      this._loading = false;
      this._focusedIdx = -1;
      return;
    }
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      this._executeSearch();
    }, DEBOUNCE_MS);
  }

  async _executeSearch() {
    if (!this.rpcConnected) return;
    const query = this._query.trim();
    if (!query) return;

    const gen = ++this._generation;
    this._loading = true;
    this._error = '';

    try {
      const results = await this.rpcExtract(
        'Repo.search_files',
        query,
        this._wholeWord,
        this._useRegex,
        this._ignoreCase,
        4, // context lines
      );

      // Discard stale responses
      if (gen !== this._generation) return;

      if (Array.isArray(results)) {
        this._results = results;
        // Auto-expand all file groups
        this._expandedFiles = new Set(results.map(r => r.file));
      } else {
        this._results = [];
      }
      this._focusedIdx = -1;
    } catch (e) {
      if (gen !== this._generation) return;
      this._error = String(e);
      this._results = [];
    } finally {
      if (gen === this._generation) {
        this._loading = false;
      }
    }
  }

  // ── Option toggles ──

  _toggleOption(key) {
    this[`_${key}`] = !this[`_${key}`];
    localStorage.setItem(`ac-dc-search-${key}`, String(this[`_${key}`]));
    // Re-run search with new options
    if (this._query.trim()) {
      this._executeSearch();
    }
  }

  // ── File group expand/collapse ──

  _toggleFileExpand(file) {
    const next = new Set(this._expandedFiles);
    if (next.has(file)) next.delete(file);
    else next.add(file);
    this._expandedFiles = next;
  }

  // ── Flat match list for keyboard nav ──

  _getFlatMatches() {
    const flat = [];
    for (const group of this._results) {
      if (!this._expandedFiles.has(group.file)) continue;
      for (const match of (group.matches || [])) {
        flat.push({ file: group.file, match });
      }
    }
    return flat;
  }

  // ── Total match count ──

  _getTotalMatches() {
    let total = 0;
    for (const group of this._results) {
      total += (group.matches || []).length;
    }
    return total;
  }

  // ── Keyboard navigation ──

  _onKeyDown(e) {
    if (e.key === 'Escape') {
      if (this._query) {
        this._query = '';
        this._results = [];
        this._error = '';
        this._focusedIdx = -1;
        const input = this.shadowRoot.querySelector('.search-input');
        if (input) input.value = '';
      }
      return;
    }

    const flat = this._getFlatMatches();
    if (flat.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._focusedIdx = Math.min(this._focusedIdx + 1, flat.length - 1);
      this._scrollFocusedIntoView();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._focusedIdx = Math.max(this._focusedIdx - 1, 0);
      this._scrollFocusedIntoView();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this._focusedIdx >= 0 && this._focusedIdx < flat.length) {
        this._selectMatch(flat[this._focusedIdx].file, flat[this._focusedIdx].match);
      } else if (flat.length > 0) {
        this._selectMatch(flat[0].file, flat[0].match);
      }
    }
  }

  _scrollFocusedIntoView() {
    this.updateComplete.then(() => {
      const el = this.shadowRoot.querySelector('.match-row.focused');
      if (el) el.scrollIntoView({ block: 'nearest' });
    });
  }

  // ── Selection / navigation ──

  _selectMatch(file, match) {
    this.dispatchEvent(new CustomEvent('search-navigate', {
      detail: { path: file, line: match.line_num },
      bubbles: true, composed: true,
    }));
  }

  _onFileHeaderClick(file) {
    this.dispatchEvent(new CustomEvent('search-navigate', {
      detail: { path: file, line: 1 },
      bubbles: true, composed: true,
    }));
  }

  // ── Highlight query in match text ──

  _highlightMatch(text, query) {
    if (!query || !text) return text;

    try {
      let pattern;
      if (this._useRegex) {
        pattern = new RegExp(`(${query})`, this._ignoreCase ? 'gi' : 'g');
      } else {
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wordBound = this._wholeWord ? `\\b${escaped}\\b` : escaped;
        pattern = new RegExp(`(${wordBound})`, this._ignoreCase ? 'gi' : 'g');
      }

      const parts = text.split(pattern);
      if (parts.length <= 1) return text;

      return parts.map((part, i) => {
        if (i % 2 === 1) {
          return `<span class="match-highlight">${this._escapeHtml(part)}</span>`;
        }
        return this._escapeHtml(part);
      }).join('');
    } catch {
      // Invalid regex — return plain text
      return this._escapeHtml(text);
    }
  }

  _escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ── Render ──

  render() {
    const totalMatches = this._getTotalMatches();
    const totalFiles = this._results.length;

    return html`
      <div class="search-bar">
        <div class="search-row">
          <input type="text"
            class="search-input"
            placeholder="Search files..."
            aria-label="Search repository files"
            .value=${this._query}
            @input=${this._onInput}
            @keydown=${this._onKeyDown}
          >
          ${totalMatches > 0 ? html`
            <span class="result-count" role="status" aria-live="polite">${totalMatches} match${totalMatches !== 1 ? 'es' : ''} in ${totalFiles} file${totalFiles !== 1 ? 's' : ''}</span>
          ` : nothing}
        </div>
        <div class="option-row" role="toolbar" aria-label="Search options">
          <button class="option-btn ${this._ignoreCase ? 'active' : ''}"
            @click=${() => this._toggleOption('ignoreCase')}
            title="Ignore case"
            aria-label="Ignore case"
            aria-pressed=${this._ignoreCase}>Aa</button>
          <button class="option-btn ${this._useRegex ? 'active' : ''}"
            @click=${() => this._toggleOption('useRegex')}
            title="Regular expression"
            aria-label="Use regular expression"
            aria-pressed=${this._useRegex}>.*</button>
          <button class="option-btn ${this._wholeWord ? 'active' : ''}"
            @click=${() => this._toggleOption('wholeWord')}
            title="Whole word"
            aria-label="Whole word match"
            aria-pressed=${this._wholeWord}>ab</button>
        </div>
      </div>

      <div class="results-container" @keydown=${this._onKeyDown} tabindex="-1"
        role="region" aria-label="Search results">
        ${this._loading ? html`
          <div class="loading-state"><span class="spinner"></span> Searching...</div>
        ` : this._error ? html`
          <div class="error-state">⚠ ${this._error}</div>
        ` : this._results.length === 0 && this._query.trim() ? html`
          <div class="empty-state">No results for "${this._query}"</div>
        ` : this._results.length === 0 ? html`
          <div class="empty-state">Type to search across the repository</div>
        ` : this._renderResults()}
      </div>
    `;
  }

  _renderResults() {
    let flatIdx = 0;
    return this._results.map(group => {
      const expanded = this._expandedFiles.has(group.file);
      const matchCount = (group.matches || []).length;
      const startIdx = flatIdx;

      const matchRows = expanded ? (group.matches || []).map(match => {
        const idx = flatIdx++;
        return this._renderMatch(group.file, match, idx);
      }) : (flatIdx += matchCount, nothing);

      return html`
        <div class="file-group">
          <div class="file-header" @click=${() => this._toggleFileExpand(group.file)}>
            <span class="file-toggle">${expanded ? '▾' : '▸'}</span>
            <span class="file-path" @click=${(e) => { e.stopPropagation(); this._onFileHeaderClick(group.file); }}>${group.file}</span>
            <span class="match-count">${matchCount}</span>
          </div>
          ${matchRows}
        </div>
      `;
    });
  }

  _renderMatch(file, match, flatIdx) {
    const isFocused = flatIdx === this._focusedIdx;
    const highlighted = this._highlightMatch(match.line, this._query);

    return html`
      ${(match.context_before || []).map(ctx => html`
        <div class="context-row">
          <span class="context-line-num">${ctx.line_num}</span>
          <span class="context-content">${ctx.line}</span>
        </div>
      `)}
      <div class="match-row ${isFocused ? 'focused' : ''}"
        @click=${() => this._selectMatch(file, match)}>
        <span class="match-line-num">${match.line_num}</span>
        <span class="match-content" .innerHTML=${highlighted}></span>
      </div>
      ${(match.context_after || []).map(ctx => html`
        <div class="context-row">
          <span class="context-line-num">${ctx.line_num}</span>
          <span class="context-content">${ctx.line}</span>
        </div>
      `)}
    `;
  }
}

customElements.define('search-tab', SearchTab);