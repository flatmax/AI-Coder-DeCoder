import { LitElement, html, css, nothing } from 'lit';
import { RpcMixin } from '../rpc-mixin.js';

/**
 * Cache Tiers tab — tier blocks with item lists, stability bars,
 * recent promotions/demotions, and fuzzy filter.
 */
class CacheTab extends RpcMixin(LitElement) {
  static properties = {
    _data: { type: Object, state: true },
    _loading: { type: Boolean, state: true },
    _error: { type: String, state: true },
    _filter: { type: String, state: true },
    _expandedTiers: { type: Object, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border-color);
      background: var(--bg-secondary);
      flex-shrink: 0;
    }

    .filter-input {
      flex: 1;
      padding: 5px 8px;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-size: 12px;
      font-family: var(--font-mono);
      outline: none;
    }
    .filter-input:focus { border-color: var(--accent-primary); }
    .filter-input::placeholder { color: var(--text-muted); }

    .refresh-btn {
      background: none;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 3px 8px;
      cursor: pointer;
      font-size: 11px;
      color: var(--text-secondary);
      transition: background var(--transition-fast);
      flex-shrink: 0;
    }
    .refresh-btn:hover {
      background: var(--bg-surface);
      color: var(--text-primary);
    }

    .content {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }

    .loading-state, .error-state, .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 13px;
    }
    .error-state { color: var(--accent-error); }

    /* ── Tier block ── */
    .tier-block {
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      margin-bottom: 10px;
      overflow: hidden;
      background: var(--bg-elevated);
    }

    .tier-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      cursor: pointer;
      user-select: none;
      transition: background var(--transition-fast);
    }
    .tier-header:hover { background: var(--bg-surface); }

    .tier-badge {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 3px;
      color: white;
      flex-shrink: 0;
    }
    .tier-badge.L0 { background: #7c4dff; }
    .tier-badge.L1 { background: #00bcd4; }
    .tier-badge.L2 { background: #4caf50; }
    .tier-badge.L3 { background: #ff9800; }
    .tier-badge.active { background: #78909c; }

    .tier-name {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
      flex: 1;
    }

    .tier-tokens {
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--text-secondary);
    }

    .tier-cached {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 8px;
      background: rgba(76,175,80,0.15);
      color: #4caf50;
    }
    .tier-cached.uncached {
      background: rgba(120,144,156,0.15);
      color: #78909c;
    }

    .tier-toggle {
      font-size: 10px;
      color: var(--text-muted);
      width: 14px;
      text-align: center;
    }

    .tier-body {
      border-top: 1px solid var(--border-color);
      padding: 8px 12px;
    }

    /* ── Content groups ── */
    .content-group {
      margin-bottom: 8px;
    }
    .content-group:last-child { margin-bottom: 0; }

    .group-header {
      font-size: 10px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }

    .item-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 0;
      font-size: 11px;
    }

    .item-key {
      font-family: var(--font-mono);
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
      flex: 1;
    }

    .item-tokens {
      font-family: var(--font-mono);
      color: var(--text-muted);
      flex-shrink: 0;
      font-size: 10px;
    }

    /* ── Stability bar (N progress) ── */
    .stability-bar {
      width: 40px;
      height: 6px;
      background: var(--bg-surface);
      border-radius: 3px;
      overflow: hidden;
      flex-shrink: 0;
    }

    .stability-fill {
      height: 100%;
      border-radius: 3px;
      transition: width var(--transition-normal);
    }
    .stability-fill.low { background: #ff9800; }
    .stability-fill.mid { background: #00bcd4; }
    .stability-fill.high { background: #4caf50; }

    /* ── Recent changes ── */
    .changes-section {
      margin-top: 16px;
    }

    .changes-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 8px;
    }

    .change-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 0;
      font-size: 11px;
    }

    .change-dir {
      font-size: 13px;
      flex-shrink: 0;
    }

    .change-key {
      font-family: var(--font-mono);
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }

    .change-tiers {
      font-size: 10px;
      color: var(--text-muted);
      flex-shrink: 0;
    }

    .no-changes {
      font-size: 11px;
      color: var(--text-muted);
      font-style: italic;
    }
  `;

  constructor() {
    super();
    this._data = null;
    this._loading = false;
    this._error = '';
    this._filter = '';
    this._expandedTiers = new Set();
  }

  onRpcReady() {
    this._refresh();
  }

  async _refresh() {
    if (!this.rpcConnected) return;
    this._loading = true;
    this._error = '';
    try {
      const data = await this.rpcExtract('LLM.get_context_breakdown');
      if (data && !data.error) {
        this._data = data;
      } else {
        this._error = data?.error || 'No data returned';
      }
    } catch (e) {
      this._error = String(e);
    } finally {
      this._loading = false;
    }
  }

  _toggleTier(name) {
    const next = new Set(this._expandedTiers);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    this._expandedTiers = next;
  }

  _fmt(n) {
    if (n == null) return '0';
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  }

  _matchesFilter(key) {
    if (!this._filter) return true;
    return key.toLowerCase().includes(this._filter.toLowerCase());
  }

  _stabilityClass(n, threshold) {
    if (!threshold || threshold <= 0) return 'high';
    const pct = n / threshold;
    if (pct >= 0.7) return 'high';
    if (pct >= 0.4) return 'mid';
    return 'low';
  }

  _stabilityPct(n, threshold) {
    if (!threshold || threshold <= 0) return 100;
    return Math.min(100, (n / threshold) * 100);
  }

  _stripPrefix(key) {
    if (key.startsWith('symbol:') || key.startsWith('file:') || key.startsWith('history:')) {
      return key.split(':', 1)[1] || key.substring(key.indexOf(':') + 1);
    }
    return key;
  }

  render() {
    return html`
      <div class="toolbar">
        <input type="text" class="filter-input"
          placeholder="Filter items..."
          .value=${this._filter}
          @input=${(e) => this._filter = e.target.value}>
        <button class="refresh-btn" @click=${this._refresh}>↻ Refresh</button>
      </div>
      <div class="content">
        ${this._loading ? html`<div class="loading-state">Loading...</div>`
        : this._error ? html`<div class="error-state">⚠ ${this._error}</div>`
        : !this._data ? html`<div class="empty-state">No cache data yet</div>`
        : this._renderData()}
      </div>
    `;
  }

  _renderData() {
    const blocks = this._data.blocks || [];
    const promotions = this._data.promotions || [];
    const demotions = this._data.demotions || [];

    return html`
      ${blocks.map(block => this._renderTierBlock(block))}
      ${(promotions.length > 0 || demotions.length > 0)
        ? this._renderChanges(promotions, demotions)
        : nothing}
    `;
  }

  _renderTierBlock(block) {
    const expanded = this._expandedTiers.has(block.name);
    const tierClass = block.name.replace(/\s+/g, '');

    // Filter items across all content groups
    const filteredContents = (block.contents || []).map(group => {
      if (!group.items) return group;
      const filtered = group.items.filter(it => this._matchesFilter(it.key));
      return { ...group, items: filtered, count: filtered.length };
    }).filter(g => g.count > 0 || g.type === 'history');

    if (this._filter && filteredContents.length === 0) return nothing;

    return html`
      <div class="tier-block">
        <div class="tier-header" @click=${() => this._toggleTier(block.name)}>
          <span class="tier-badge ${tierClass}">${block.name}</span>
          <span class="tier-name">${block.cached ? 'Cached' : 'Uncached'}</span>
          <span class="tier-tokens">${this._fmt(block.tokens)} tokens</span>
          <span class="tier-cached ${block.cached ? '' : 'uncached'}">
            ${block.cached ? '✓ cached' : '○ live'}
          </span>
          <span class="tier-toggle">${expanded ? '▾' : '▸'}</span>
        </div>
        ${expanded ? html`
          <div class="tier-body">
            ${filteredContents.length === 0 ? html`
              <span style="font-size:11px;color:var(--text-muted)">No items</span>
            ` : filteredContents.map(g => this._renderContentGroup(g))}
          </div>
        ` : nothing}
      </div>
    `;
  }

  _renderContentGroup(group) {
    return html`
      <div class="content-group">
        <div class="group-header">${group.type} (${group.count})</div>
        ${group.type === 'history' ? html`
          <div style="font-size:11px;color:var(--text-muted)">
            ${this._fmt(group.tokens)} tokens
          </div>
        ` : (group.items || []).map(it => html`
          <div class="item-row">
            <span class="item-key" title="${it.key}">${this._stripPrefix(it.key)}</span>
            <div class="stability-bar" title="N=${it.n}/${it.threshold || '?'}">
              <div class="stability-fill ${this._stabilityClass(it.n, it.threshold)}"
                style="width:${this._stabilityPct(it.n, it.threshold)}%"></div>
            </div>
            <span class="item-tokens">${this._fmt(it.tokens)}</span>
          </div>
        `)}
      </div>
    `;
  }

  _renderChanges(promotions, demotions) {
    return html`
      <div class="changes-section">
        <div class="changes-title">Recent Changes</div>
        ${promotions.length === 0 && demotions.length === 0 ? html`
          <div class="no-changes">No tier changes since last request</div>
        ` : nothing}
        ${promotions.map(c => html`
          <div class="change-row">
            <span class="change-dir">📈</span>
            <span class="change-key" title="${c.key}">${this._stripPrefix(c.key)}</span>
            <span class="change-tiers">${c.from} → ${c.to}</span>
          </div>
        `)}
        ${demotions.map(c => html`
          <div class="change-row">
            <span class="change-dir">📉</span>
            <span class="change-key" title="${c.key}">${this._stripPrefix(c.key)}</span>
            <span class="change-tiers">${c.from} → ${c.to}</span>
          </div>
        `)}
      </div>
    `;
  }
}

customElements.define('cache-tab', CacheTab);
