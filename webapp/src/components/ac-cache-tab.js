/**
 * AcCacheTab — cache tier viewer with stability bars, fuzzy search,
 * and per-item detail display.
 */

import { LitElement, html, css } from 'lit';
import { RpcMixin } from '../utils/rpc-mixin.js';

const TIER_COLORS = {
  L0: '#50c878',
  L1: '#2dd4bf',
  L2: '#60a5fa',
  L3: '#f59e0b',
  active: '#f97316',
};

const TYPE_ICONS = {
  system: '⚙️',
  legend: '📖',
  sym: '📦',
  doc: '📝',
  file: '📄',
  url: '🔗',
  history: '💬',
};

export class AcCacheTab extends RpcMixin(LitElement) {
  static properties = {
    _data: { type: Object, state: true },
    _loading: { type: Boolean, state: true },
    _stale: { type: Boolean, state: true },
    _expanded: { type: Object, state: true },
    _filter: { type: String, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      font-size: 0.82rem;
      gap: 8px;
    }

    .header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .title { font-weight: 600; color: var(--text-primary); font-size: 0.9rem; }
    .hit-rate { font-size: 0.78rem; color: var(--text-secondary); }
    .actions { display: flex; gap: 4px; align-items: center; }
    .stale-badge { color: var(--accent-orange); font-size: 0.7rem; }
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

    /* Hit rate bar */
    .hit-bar-track {
      height: 6px;
      background: var(--bg-input);
      border-radius: 3px;
      overflow: hidden;
      flex-shrink: 0;
    }
    .hit-bar-fill {
      height: 100%;
      background: var(--accent-green);
      border-radius: 3px;
      transition: width 0.3s;
    }

    /* Filter */
    .filter-input {
      width: 100%;
      background: var(--bg-input);
      border: 1px solid var(--border-secondary);
      border-radius: 4px;
      color: var(--text-primary);
      padding: 4px 8px;
      font-size: 0.78rem;
      outline: none;
      flex-shrink: 0;
    }
    .filter-input:focus { border-color: var(--accent-primary); }

    /* Changes section */
    .changes-section {
      padding: 4px 0;
      font-size: 0.75rem;
    }
    .changes-title {
      color: var(--text-muted);
      font-weight: 600;
      font-size: 0.72rem;
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .change-line {
      padding: 1px 0;
      color: var(--text-secondary);
    }

    hr {
      border: none;
      border-top: 1px solid var(--border-primary);
      margin: 2px 0;
    }

    /* Tier section */
    .tier-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 0;
      cursor: pointer;
    }
    .tier-header:hover { background: var(--bg-tertiary); border-radius: 4px; margin: 0 -4px; padding: 4px; }
    .tier-toggle {
      width: 14px;
      font-size: 0.65rem;
      color: var(--text-muted);
      text-align: center;
    }
    .tier-name {
      font-weight: 600;
      min-width: 80px;
    }
    .tier-tokens {
      font-family: monospace;
      font-size: 0.75rem;
      color: var(--accent-green);
    }
    .tier-cached {
      font-size: 0.65rem;
      color: var(--text-muted);
    }

    /* Tier items */
    .tier-items {
      padding-left: 20px;
      margin-bottom: 4px;
    }
    .tier-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 0;
      font-size: 0.75rem;
    }
    .item-icon { font-size: 0.7rem; width: 16px; text-align: center; }
    .item-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text-secondary);
      cursor: pointer;
    }
    .item-name:hover { color: var(--text-primary); }

    /* Stability bar */
    .stability {
      display: flex;
      align-items: center;
      gap: 3px;
      flex-shrink: 0;
    }
    .stability-label {
      font-size: 0.65rem;
      color: var(--text-muted);
      font-family: monospace;
      min-width: 28px;
      text-align: right;
    }
    .stability-bar {
      width: 40px;
      height: 4px;
      background: var(--bg-input);
      border-radius: 2px;
      overflow: hidden;
    }
    .stability-fill {
      height: 100%;
      border-radius: 2px;
    }

    .item-tokens {
      font-family: monospace;
      font-size: 0.72rem;
      color: var(--accent-green);
      min-width: 40px;
      text-align: right;
    }

    /* Footer */
    .footer {
      font-size: 0.72rem;
      color: var(--text-muted);
      padding-top: 4px;
      border-top: 1px solid var(--border-primary);
      display: flex;
      justify-content: space-between;
      flex-shrink: 0;
    }

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
    this._expanded = new Set(['L0', 'active']);
    this._filter = '';
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
      console.warn('Cache breakdown failed:', e);
    }
    this._loading = false;
  }

  _fmt(n) {
    if (n == null) return '0';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  _fmtFull(n) {
    if (n == null) return '0';
    return Number(n).toLocaleString('en-US');
  }

  _matchesFilter(name) {
    if (!this._filter) return true;
    const q = this._filter.toLowerCase();
    const t = (name || '').toLowerCase();
    let qi = 0;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
      if (t[ti] === q[qi]) qi++;
    }
    return qi === q.length;
  }

  _toggleTier(tier) {
    const next = new Set(this._expanded);
    if (next.has(tier)) next.delete(tier);
    else next.add(tier);
    this._expanded = next;
  }

  render() {
    if (this._loading && !this._data) {
      return html`<div class="loading">Loading cache data...</div>`;
    }
    if (!this._data) {
      return html`<div class="loading">No data available.</div>`;
    }

    const d = this._data;
    const blocks = d.blocks || [];
    const hitRate = ((d.cache_hit_rate || 0) * 100).toFixed(0);
    const totalTokens = blocks.reduce((s, b) => s + (b.tokens || 0), 0);

    const promotions = d.promotions || [];
    const demotions = d.demotions || [];
    const changes = [...promotions, ...demotions];

    return html`
      <div class="header-row">
        <div>
          <span class="title">Cache Performance</span>
          <span class="hit-rate">${hitRate}% hit rate</span>
        </div>
        <div class="actions">
          ${this._stale ? html`<span class="stale-badge">● stale</span>` : ''}
          <button class="refresh-btn" @click=${() => this._refresh()}>↻</button>
        </div>
      </div>

      <div class="hit-bar-track">
        <div class="hit-bar-fill" style="width: ${hitRate}%"></div>
      </div>

      <input class="filter-input"
             type="text"
             placeholder="Filter items..."
             .value=${this._filter}
             @input=${(e) => { this._filter = e.target.value; }}>

      ${changes.length ? html`
        <div class="changes-section">
          <div class="changes-title">Recent Changes</div>
          ${changes.map(c => html`<div class="change-line">${c}</div>`)}
        </div>
        <hr>
      ` : ''}

      ${blocks.map(block => this._renderTierBlock(block, totalTokens))}

      <div class="footer">
        <span>${d.model || 'unknown'}</span>
        <span>Total: ${this._fmtFull(totalTokens)}</span>
      </div>
    `;
  }

  _renderTierBlock(block, totalTokens) {
    const tierName = block.tier || block.name;
    const color = TIER_COLORS[tierName] || TIER_COLORS.active;
    const expanded = this._expanded.has(tierName);
    const items = (block.contents || []).filter(c => this._matchesFilter(c.name));

    if (this._filter && !items.length) return '';

    return html`
      <div>
        <div class="tier-header" @click=${() => this._toggleTier(tierName)}>
          <span class="tier-toggle">${expanded ? '▼' : '▶'}</span>
          <span class="tier-name" style="color: ${color}">${tierName}</span>
          <span class="tier-tokens">${this._fmt(block.tokens)}</span>
          ${block.cached ? html`<span class="tier-cached">🔒</span>` : ''}
        </div>
        ${expanded ? html`
          <div class="tier-items">
            ${items.map(item => this._renderItem(item, color))}
            ${!items.length ? html`<div style="color:var(--text-muted);font-size:0.72rem;padding:2px 0">No items</div>` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  _renderItem(item, tierColor) {
    const icon = TYPE_ICONS[item.type] || '•';
    const hasN = item.n != null && item.threshold != null;
    const nPct = hasN ? Math.min(100, (item.n / item.threshold) * 100) : 0;

    return html`
      <div class="tier-item">
        <span class="item-icon">${icon}</span>
        <span class="item-name" title="${item.path || item.name}">${item.name || item.path || '?'}</span>
        ${hasN ? html`
          <div class="stability" title="N=${item.n}/${item.threshold}">
            <span class="stability-label">${item.n}/${item.threshold}</span>
            <div class="stability-bar">
              <div class="stability-fill" style="width:${nPct}%;background:${tierColor}"></div>
            </div>
          </div>
        ` : ''}
        <span class="item-tokens">${this._fmt(item.tokens)}</span>
      </div>
    `;
  }
}

customElements.define('ac-cache-tab', AcCacheTab);