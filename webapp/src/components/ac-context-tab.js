/**
 * AcContextTab — context budget viewer.
 *
 * Shows token budget bar, per-category breakdown with expandable
 * details, model info, and session totals.
 */

import { LitElement, html, css } from 'lit';
import { RpcMixin } from '../utils/rpc-mixin.js';

export class AcContextTab extends RpcMixin(LitElement) {
  static properties = {
    _data: { type: Object, state: true },
    _loading: { type: Boolean, state: true },
    _stale: { type: Boolean, state: true },
    _expanded: { type: Object, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      font-size: 0.82rem;
      gap: 12px;
    }

    .header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .title { font-weight: 600; font-size: 0.95rem; color: var(--text-primary); }
    .refresh-btn {
      background: none;
      border: 1px solid var(--border-primary);
      border-radius: 4px;
      color: var(--text-secondary);
      cursor: pointer;
      padding: 3px 8px;
      font-size: 0.75rem;
    }
    .refresh-btn:hover { color: var(--text-primary); background: var(--bg-tertiary); }
    .stale-badge {
      color: var(--accent-orange);
      font-size: 0.7rem;
      margin-left: 6px;
    }

    /* Budget bar */
    .budget-section { margin-bottom: 4px; }
    .budget-label {
      display: flex;
      justify-content: space-between;
      margin-bottom: 4px;
      color: var(--text-secondary);
      font-size: 0.78rem;
    }
    .budget-bar-track {
      height: 8px;
      background: var(--bg-input);
      border-radius: 4px;
      overflow: hidden;
    }
    .budget-bar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.3s;
    }
    .budget-bar-fill.green { background: var(--accent-green); }
    .budget-bar-fill.yellow { background: var(--accent-orange); }
    .budget-bar-fill.red { background: var(--accent-red); }

    .model-info {
      display: flex;
      gap: 12px;
      font-size: 0.75rem;
      color: var(--text-muted);
      flex-wrap: wrap;
    }

    /* Categories */
    .category {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 0;
      cursor: default;
    }
    .category.expandable { cursor: pointer; }
    .category:hover { background: var(--bg-tertiary); border-radius: 4px; margin: 0 -4px; padding: 4px; }
    .cat-toggle {
      width: 14px;
      font-size: 0.65rem;
      color: var(--text-muted);
      text-align: center;
    }
    .cat-name { flex: 1; color: var(--text-primary); }
    .cat-count { color: var(--text-muted); font-size: 0.72rem; }
    .cat-bar {
      width: 120px;
      height: 6px;
      background: var(--bg-input);
      border-radius: 3px;
      overflow: hidden;
      flex-shrink: 0;
    }
    .cat-bar-fill {
      height: 100%;
      background: var(--accent-primary);
      border-radius: 3px;
    }
    .cat-tokens {
      min-width: 50px;
      text-align: right;
      color: var(--accent-green);
      font-family: monospace;
      font-size: 0.75rem;
    }

    /* Detail items */
    .details {
      padding-left: 24px;
      margin-bottom: 4px;
    }
    .detail-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 0;
      font-size: 0.75rem;
      color: var(--text-secondary);
    }
    .detail-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .detail-tokens {
      font-family: monospace;
      color: var(--accent-green);
      font-size: 0.72rem;
    }

    hr {
      border: none;
      border-top: 1px solid var(--border-primary);
      margin: 4px 0;
    }

    /* Session totals */
    .session-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px 16px;
      font-size: 0.78rem;
    }
    .session-label { color: var(--text-secondary); }
    .session-value {
      text-align: right;
      font-family: monospace;
      color: var(--text-primary);
    }
    .session-value.cache-read { color: var(--accent-green); }
    .session-value.cache-write { color: var(--accent-orange); }

    .loading {
      display: flex;
      flex: 1;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
    }
  `;

  constructor() {
    super();
    this._data = null;
    this._loading = false;
    this._stale = false;
    this._expanded = new Set();
  }

  connectedCallback() {
    super.connectedCallback();
    this._streamHandler = () => { this._markStaleIfHidden(); };
    window.addEventListener('stream-complete', this._streamHandler);
    this._filesHandler = () => { this._markStaleIfHidden(); };
    window.addEventListener('files-changed', this._filesHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('stream-complete', this._streamHandler);
    window.removeEventListener('files-changed', this._filesHandler);
  }

  onRpcReady() {
    this._refresh();
  }

  onTabVisible() {
    if (this._stale) this._refresh();
  }

  _isTabActive() {
    const panel = this.parentElement;
    if (panel?.classList?.contains('tab-panel')) {
      return panel.classList.contains('active');
    }
    return this.offsetParent !== null;
  }

  _markStaleIfHidden() {
    if (this._isTabActive()) {
      this._refresh();
    } else {
      this._stale = true;
    }
  }

  async _refresh() {
    this._loading = true;
    this._stale = false;
    try {
      this._data = await this.rpcExtract('LLMService.get_context_breakdown');
    } catch (e) {
      console.warn('Context breakdown failed:', e);
    }
    this._loading = false;
  }

  _fmt(n) {
    if (n == null) return '0';
    return Number(n).toLocaleString('en-US');
  }

  _budgetColor(pct) {
    if (pct > 90) return 'red';
    if (pct > 75) return 'yellow';
    return 'green';
  }

  _toggleExpand(cat) {
    const next = new Set(this._expanded);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    this._expanded = next;
  }

  render() {
    if (this._loading && !this._data) {
      return html`<div class="loading">Loading context data...</div>`;
    }
    if (!this._data) {
      return html`<div class="loading">No data available. Send a message first.</div>`;
    }

    const d = this._data;
    const bd = d.breakdown || {};
    const maxInput = d.max_input_tokens || 200000;
    const usedPct = Math.min(100, (d.total_tokens / maxInput) * 100);

    const categories = [
      { key: 'system', name: 'System Prompt', tokens: bd.system || 0, expandable: false },
      { key: 'legend', name: 'Legend', tokens: bd.legend || 0, expandable: false },
      { key: 'symbol_map', name: d.mode === 'doc' ? 'Doc Map' : 'Symbol Map',
        tokens: bd.symbol_map || 0, count: bd.symbol_map_files,
        expandable: false },
      { key: 'files', name: 'Files', tokens: bd.files || 0, count: bd.file_count,
        expandable: !!(bd.file_details?.length), details: bd.file_details },
      { key: 'urls', name: 'URLs', tokens: bd.urls || 0,
        expandable: !!(bd.url_details?.length), details: bd.url_details },
      { key: 'history', name: 'History', tokens: bd.history || 0,
        count: bd.history_messages, expandable: false },
    ];

    const maxCatTokens = Math.max(...categories.map(c => c.tokens), 1);
    const st = d.session_totals || {};

    return html`
      <div class="header-row">
        <span class="title">Context Budget</span>
        <div>
          ${this._stale ? html`<span class="stale-badge">● stale</span>` : ''}
          <button class="refresh-btn" @click=${() => this._refresh()}>↻ Refresh</button>
        </div>
      </div>

      <div class="budget-section">
        <div class="budget-label">
          <span>Token Budget</span>
          <span>${this._fmt(d.total_tokens)} / ${this._fmt(maxInput)}</span>
        </div>
        <div class="budget-bar-track">
          <div class="budget-bar-fill ${this._budgetColor(usedPct)}"
               style="width: ${usedPct}%"></div>
        </div>
        <div class="budget-label">
          <span>${usedPct.toFixed(1)}% used</span>
        </div>
      </div>

      <div class="model-info">
        <span>Model: ${d.model || 'unknown'}</span>
        <span>Cache: ${((d.cache_hit_rate || 0) * 100).toFixed(0)}% hit</span>
        ${d.mode === 'doc' ? html`<span>📝 Doc Mode</span>` : ''}
        ${d.cross_ref_enabled ? html`<span>🔗 Cross-ref</span>` : ''}
      </div>

      <hr>

      ${categories.map(cat => html`
        <div class="category ${cat.expandable ? 'expandable' : ''}"
             @click=${() => cat.expandable && this._toggleExpand(cat.key)}>
          <span class="cat-toggle">
            ${cat.expandable ? (this._expanded.has(cat.key) ? '▼' : '▶') : ''}
          </span>
          <span class="cat-name">
            ${cat.name}${cat.count != null ? html` <span class="cat-count">(${cat.count})</span>` : ''}
          </span>
          <div class="cat-bar">
            <div class="cat-bar-fill" style="width: ${(cat.tokens / maxCatTokens) * 100}%"></div>
          </div>
          <span class="cat-tokens">${this._fmt(cat.tokens)}</span>
        </div>
        ${cat.expandable && this._expanded.has(cat.key) && cat.details?.length ? html`
          <div class="details">
            ${cat.details.map(item => html`
              <div class="detail-item">
                <span class="detail-name" title="${item.path || item.url || ''}">${item.name || item.path || item.url || ''}</span>
                <span class="detail-tokens">${this._fmt(item.tokens)}</span>
              </div>
            `)}
          </div>
        ` : ''}
      `)}

      <hr>

      <div class="title" style="font-size:0.85rem">Session Totals</div>
      <div class="session-grid">
        <span class="session-label">Prompt In</span>
        <span class="session-value">${this._fmt(st.prompt)}</span>
        <span class="session-label">Completion Out</span>
        <span class="session-value">${this._fmt(st.completion)}</span>
        <span class="session-label">Total</span>
        <span class="session-value">${this._fmt(st.total)}</span>
        ${st.cache_hit ? html`
          <span class="session-label">Cache Read</span>
          <span class="session-value cache-read">${this._fmt(st.cache_hit)}</span>
        ` : ''}
        ${st.cache_write ? html`
          <span class="session-label">Cache Write</span>
          <span class="session-value cache-write">${this._fmt(st.cache_write)}</span>
        ` : ''}
      </div>
    `;
  }
}

customElements.define('ac-context-tab', AcContextTab);