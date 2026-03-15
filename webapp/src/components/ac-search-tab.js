/**
 * AcSearchTab — full-text search across the repository via git grep.
 *
 * Features: debounced search, toggleable options (case, regex, word),
 * grouped results by file, keyboard navigation, click-to-navigate.
 */

import { LitElement, html, css } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { RpcMixin } from '../utils/rpc-mixin.js';

export class AcSearchTab extends RpcMixin(LitElement) {
  static properties = {
    _query: { type: String, state: true },
    _results: { type: Array, state: true },
    _loading: { type: Boolean, state: true },
    _ignoreCase: { type: Boolean, state: true },
    _useRegex: { type: Boolean, state: true },
    _wholeWord: { type: Boolean, state: true },
    _focusIndex: { type: Number, state: true },
    _expandedFiles: { type: Object, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
      font-size: 0.82rem;
    }

    .search-bar {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px;
      border-bottom: 1px solid var(--border-primary);
      flex-shrink: 0;
    }

    .search-input {
      width: 100%;
      background: var(--bg-input);
      border: 1px solid var(--border-secondary);
      border-radius: 6px;
      color: var(--text-primary);
      padding: 6px 10px;
      font-size: 0.85rem;
      outline: none;
      font-family: inherit;
    }
    .search-input:focus { border-color: var(--accent-primary); }

    .search-options {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }

    .opt-toggle {
      display: flex;
      align-items: center;
      gap: 3px;
      cursor: pointer;
      font-size: 0.75rem;
      color: var(--text-secondary);
      padding: 2px 6px;
      border-radius: 3px;
      border: 1px solid transparent;
      user-select: none;
    }
    .opt-toggle:hover { background: var(--bg-tertiary); }
    .opt-toggle.active {
      color: var(--accent-primary);
      border-color: var(--accent-primary);
      background: rgba(79, 195, 247, 0.08);
    }
    .opt-toggle input { display: none; }

    .result-count {
      font-size: 0.72rem;
      color: var(--text-muted);
      margin-left: auto;
    }

    /* Results */
    .results {
      flex: 1;
      overflow-y: auto;
      padding: 4px;
    }

    .file-group {
      margin-bottom: 4px;
    }
    .file-header {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 6px;
      cursor: pointer;
      border-radius: 4px;
      font-weight: 500;
      color: var(--accent-primary);
    }
    .file-header:hover { background: var(--bg-tertiary); }
    .file-toggle {
      font-size: 0.65rem;
      width: 12px;
      color: var(--text-muted);
    }
    .file-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .match-count {
      font-size: 0.7rem;
      color: var(--text-muted);
      font-weight: normal;
    }

    .match-row {
      display: flex;
      gap: 6px;
      padding: 2px 6px 2px 22px;
      cursor: pointer;
      border-radius: 3px;
      font-size: 0.78rem;
      font-family: monospace;
    }
    .match-row:hover { background: var(--bg-tertiary); }
    .match-row.focused { background: var(--bg-tertiary); outline: 1px solid var(--accent-primary); outline-offset: -1px; }
    .line-num {
      color: var(--text-muted);
      min-width: 32px;
      text-align: right;
      flex-shrink: 0;
    }
    .match-text {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text-primary);
    }
    .match-text mark {
      background: rgba(79, 195, 247, 0.25);
      color: var(--accent-primary);
      border-radius: 2px;
      padding: 0 1px;
    }

    .context-line {
      padding: 1px 6px 1px 22px;
      font-size: 0.72rem;
      font-family: monospace;
      color: var(--text-muted);
    }

    .empty-state {
      display: flex;
      flex: 1;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      padding: 40px;
      text-align: center;
    }
  `;

  constructor() {
    super();
    this._query = '';
    this._results = [];
    this._loading = false;
    this._ignoreCase = localStorage.getItem('ac-dc-search-ignore-case') !== 'false';
    this._useRegex = localStorage.getItem('ac-dc-search-regex') === 'true';
    this._wholeWord = localStorage.getItem('ac-dc-search-whole-word') === 'true';
    this._focusIndex = -1;
    this._expandedFiles = new Set();
    this._debounceTimer = null;
    this._generation = 0;
  }

  connectedCallback() {
    super.connectedCallback();
    this._globalKeyHandler = (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        // Focus search input — handled by dialog tab switch
        this.updateComplete.then(() => {
          const input = this.shadowRoot?.querySelector('.search-input');
          if (input) input.focus();
        });
      }
    };
    window.addEventListener('keydown', this._globalKeyHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._globalKeyHandler);
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
  }

  onTabVisible() {
    this.updateComplete.then(() => {
      const input = this.shadowRoot?.querySelector('.search-input');
      if (input) input.focus();
    });
  }

  _onInput(e) {
    this._query = e.target.value;
    this._scheduleSearch();
  }

  _onKeyDown(e) {
    if (e.key === 'Escape') {
      if (this._query) {
        this._query = '';
        this._results = [];
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      this._navigateToFocused();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._moveFocus(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._moveFocus(-1);
    }
  }

  _toggleOption(opt) {
    if (opt === 'case') {
      this._ignoreCase = !this._ignoreCase;
      localStorage.setItem('ac-dc-search-ignore-case', String(this._ignoreCase));
    } else if (opt === 'regex') {
      this._useRegex = !this._useRegex;
      localStorage.setItem('ac-dc-search-regex', String(this._useRegex));
    } else if (opt === 'word') {
      this._wholeWord = !this._wholeWord;
      localStorage.setItem('ac-dc-search-whole-word', String(this._wholeWord));
    }
    this._scheduleSearch();
  }

  _scheduleSearch() {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._doSearch(), 300);
  }

  async _doSearch() {
    const query = this._query.trim();
    if (!query) {
      this._results = [];
      return;
    }
    if (!this.rpcConnected) return;

    const gen = ++this._generation;
    this._loading = true;

    try {
      const results = await this.rpcExtract(
        'Repo.search_files', query,
        this._wholeWord, this._useRegex, this._ignoreCase, 2,
      );
      if (gen !== this._generation) return; // stale
      this._results = results || [];
      this._focusIndex = -1;
      // Auto-expand all
      this._expandedFiles = new Set(this._results.map(r => r.file));
    } catch (e) {
      if (gen === this._generation) this._results = [];
    }
    this._loading = false;
  }

  _getFlatMatches() {
    const flat = [];
    for (const group of this._results) {
      if (!this._expandedFiles.has(group.file)) continue;
      for (const match of (group.matches || [])) {
        flat.push({ file: group.file, ...match });
      }
    }
    return flat;
  }

  _moveFocus(delta) {
    const flat = this._getFlatMatches();
    if (!flat.length) return;
    this._focusIndex = Math.max(0, Math.min(flat.length - 1, this._focusIndex + delta));
  }

  _navigateToFocused() {
    const flat = this._getFlatMatches();
    const match = flat[this._focusIndex] || flat[0];
    if (match) this._navigateTo(match.file, match.line_num);
  }

  _navigateTo(file, line) {
    window.dispatchEvent(new CustomEvent('navigate-file', {
      detail: { path: file, line },
    }));
  }

  _toggleFile(file) {
    const next = new Set(this._expandedFiles);
    if (next.has(file)) next.delete(file);
    else next.add(file);
    this._expandedFiles = next;
  }

  _totalMatches() {
    return this._results.reduce((sum, g) => sum + (g.matches?.length || 0), 0);
  }

  _escHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  render() {
    const totalMatches = this._totalMatches();

    return html`
      <div class="search-bar">
        <input class="search-input"
               type="text"
               placeholder="Search files... (git grep)"
               .value=${this._query}
               @input=${this._onInput}
               @keydown=${this._onKeyDown}>
        <div class="search-options">
          <label class="opt-toggle ${this._ignoreCase ? 'active' : ''}"
                 @click=${() => this._toggleOption('case')}>
            <input type="checkbox" .checked=${this._ignoreCase}>Aa
          </label>
          <label class="opt-toggle ${this._useRegex ? 'active' : ''}"
                 @click=${() => this._toggleOption('regex')}>
            <input type="checkbox" .checked=${this._useRegex}>.*
          </label>
          <label class="opt-toggle ${this._wholeWord ? 'active' : ''}"
                 @click=${() => this._toggleOption('word')}>
            <input type="checkbox" .checked=${this._wholeWord}>W
          </label>
          ${totalMatches > 0 ? html`
            <span class="result-count">${totalMatches} matches in ${this._results.length} files</span>
          ` : ''}
        </div>
      </div>

      <div class="results">
        ${this._loading && !this._results.length ? html`
          <div class="empty-state">Searching...</div>
        ` : ''}

        ${!this._loading && this._query && !this._results.length ? html`
          <div class="empty-state">No results found</div>
        ` : ''}

        ${!this._query ? html`
          <div class="empty-state">Type to search across repository files</div>
        ` : ''}

        ${this._results.map(group => this._renderGroup(group))}
      </div>
    `;
  }

  _renderGroup(group) {
    const expanded = this._expandedFiles.has(group.file);
    const matches = group.matches || [];

    return html`
      <div class="file-group">
        <div class="file-header" @click=${() => this._toggleFile(group.file)}>
          <span class="file-toggle">${expanded ? '▼' : '▶'}</span>
          <span class="file-name" title="${group.file}">${group.file}</span>
          <span class="match-count">${matches.length}</span>
        </div>
        ${expanded ? matches.map(m => this._renderMatch(group.file, m)) : ''}
      </div>
    `;
  }

  _renderMatch(file, match) {
    const flat = this._getFlatMatches();
    const matchIdx = flat.findIndex(
      f => f.file === file && f.line_num === match.line_num
    );
    const isFocused = matchIdx === this._focusIndex;

    return html`
      ${(match.context_before || []).map(ctx => html`
        <div class="context-line">
          <span style="display:inline-block;min-width:32px;text-align:right;margin-right:6px">${ctx.line_num}</span>${this._escHtml(ctx.line)}
        </div>
      `)}
      <div class="match-row ${isFocused ? 'focused' : ''}"
           @click=${() => this._navigateTo(file, match.line_num)}>
        <span class="line-num">${match.line_num}</span>
        <span class="match-text">${unsafeHTML(this._highlightMatch(match.line))}</span>
      </div>
      ${(match.context_after || []).map(ctx => html`
        <div class="context-line">
          <span style="display:inline-block;min-width:32px;text-align:right;margin-right:6px">${ctx.line_num}</span>${this._escHtml(ctx.line)}
        </div>
      `)}
    `;
  }

  _highlightMatch(text) {
    if (!this._query || !text) return text;
    try {
      const flags = this._ignoreCase ? 'gi' : 'g';
      let pattern;
      if (this._useRegex) {
        pattern = new RegExp(this._query, flags);
      } else {
        const escaped = this._query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        pattern = new RegExp(escaped, flags);
      }
      // Apply regex to raw text first, then escape each segment
      const parts = [];
      let lastIndex = 0;
      let match;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
          parts.push(this._escHtml(text.slice(lastIndex, match.index)));
        }
        parts.push(`<mark>${this._escHtml(match[0])}</mark>`);
        lastIndex = pattern.lastIndex;
        if (!pattern.global) break;
        if (match[0].length === 0) {
          pattern.lastIndex++;
          if (pattern.lastIndex > text.length) break;
        }
      }
      if (lastIndex < text.length) {
        parts.push(this._escHtml(text.slice(lastIndex)));
      }
      return parts.join('');
    } catch (_) {
      return this._escHtml(text);
    }
  }
}

customElements.define('ac-search-tab', AcSearchTab);