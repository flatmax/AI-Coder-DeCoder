import { LitElement, html, css, nothing } from 'lit';
import { RpcMixin } from '../rpc-mixin.js';

/**
 * Context Budget tab — token usage bar, category breakdown, expandable details.
 * Fetches data via LLM.get_context_breakdown RPC.
 */
class ContextTab extends RpcMixin(LitElement) {
  static properties = {
    _data: { type: Object, state: true },
    _loading: { type: Boolean, state: true },
    _error: { type: String, state: true },
    _expanded: { type: Object, state: true },
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

    .toolbar-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
      flex: 1;
    }

    .refresh-btn {
      background: none;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 3px 8px;
      cursor: pointer;
      font-size: 11px;
      color: var(--text-secondary);
      transition: background var(--transition-fast);
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

    /* ── Budget bar ── */
    .budget-section {
      margin-bottom: 16px;
    }

    .budget-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 6px;
    }

    .budget-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .budget-value {
      font-size: 11px;
      color: var(--text-secondary);
      font-family: var(--font-mono);
    }

    .budget-bar {
      height: 8px;
      background: var(--bg-surface);
      border-radius: 4px;
      overflow: hidden;
      display: flex;
    }

    .budget-segment {
      height: 100%;
      transition: width var(--transition-normal);
      min-width: 1px;
    }

    .seg-system { background: #7c4dff; }
    .seg-symbols { background: #00bcd4; }
    .seg-files { background: #4caf50; }
    .seg-urls { background: #ff9800; }
    .seg-history { background: #f44336; }
    .seg-free { background: transparent; }

    .budget-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 8px;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: var(--text-secondary);
    }

    .legend-dot {
      width: 8px;
      height: 8px;
      border-radius: 2px;
      flex-shrink: 0;
    }

    /* ── Category cards ── */
    .category {
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      margin-bottom: 8px;
      overflow: hidden;
      background: var(--bg-elevated);
    }

    .category-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      cursor: pointer;
      user-select: none;
      transition: background var(--transition-fast);
    }
    .category-header:hover { background: var(--bg-surface); }

    .category-icon { font-size: 14px; flex-shrink: 0; }

    .category-name {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
      flex: 1;
    }

    .category-tokens {
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--text-secondary);
    }

    .category-toggle {
      font-size: 10px;
      color: var(--text-muted);
      width: 14px;
      text-align: center;
    }

    .category-body {
      border-top: 1px solid var(--border-color);
      padding: 8px 12px;
    }

    .detail-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 3px 0;
      font-size: 11px;
    }

    .detail-path {
      font-family: var(--font-mono);
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
      flex: 1;
      margin-right: 8px;
    }

    .detail-tokens {
      font-family: var(--font-mono);
      color: var(--text-muted);
      flex-shrink: 0;
    }

    .detail-note {
      font-size: 11px;
      color: var(--text-muted);
      font-style: italic;
      padding: 2px 0;
    }

    /* ── Session totals ── */
    .session-section {
      margin-top: 16px;
      padding: 10px 12px;
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
    }

    .session-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 6px;
    }

    .session-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px 16px;
    }

    .session-stat {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
    }

    .stat-label { color: var(--text-secondary); }

    .stat-value {
      font-family: var(--font-mono);
      color: var(--text-primary);
    }

    /* ── Cache rate badge ── */
    .cache-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
    }
    .cache-badge.good { background: rgba(76,175,80,0.15); color: #4caf50; }
    .cache-badge.ok { background: rgba(255,152,0,0.15); color: #ff9800; }
    .cache-badge.low { background: rgba(244,67,54,0.15); color: #f44336; }
  `;

  constructor() {
    super();
    this._data = null;
    this._loading = false;
    this._error = '';
    this._expanded = new Set();
  }

  connectedCallback() {
    super.connectedCallback();
    this._boundRefresh = () => this._refresh();
    window.addEventListener('stream-complete', this._boundRefresh);
    window.addEventListener('compaction-event', this._boundRefresh);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('stream-complete', this._boundRefresh);
    window.removeEventListener('compaction-event', this._boundRefresh);
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

  _toggle(key) {
    const next = new Set(this._expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this._expanded = next;
  }

  _fmt(n) {
    if (n == null) return '0';
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  }

  _pct(part, total) {
    if (!total) return 0;
    return Math.max(0.5, (part / total) * 100);
  }

  _cacheClass(rate) {
    if (rate >= 60) return 'good';
    if (rate >= 30) return 'ok';
    return 'low';
  }

  render() {
    return html`
      <div class="toolbar">
        <span class="toolbar-title">Context Budget</span>
        ${this._data ? html`
          <span class="cache-badge ${this._cacheClass(this._data.cache_hit_rate)}">
            Cache ${this._data.cache_hit_rate}%
          </span>
        ` : nothing}
        <button class="refresh-btn" @click=${this._refresh} aria-label="Refresh context data">↻ Refresh</button>
      </div>
      <div class="content" role="region" aria-label="Context budget details">
        ${this._loading ? html`<div class="loading-state">Loading...</div>`
        : this._error ? html`<div class="error-state">⚠ ${this._error}</div>`
        : !this._data ? html`<div class="empty-state">No context data yet</div>`
        : this._renderData()}
      </div>
    `;
  }

  _renderData() {
    const d = this._data;
    const b = d.breakdown;
    const max = d.max_input_tokens || 1;
    const total = d.total_tokens || 0;

    const segments = [
      { key: 'system', tokens: b.system?.tokens || 0, cls: 'seg-system', label: 'System' },
      { key: 'symbols', tokens: b.symbol_map?.tokens || 0, cls: 'seg-symbols', label: 'Symbols' },
      { key: 'files', tokens: b.files?.tokens || 0, cls: 'seg-files', label: 'Files' },
      { key: 'urls', tokens: b.urls?.tokens || 0, cls: 'seg-urls', label: 'URLs' },
      { key: 'history', tokens: b.history?.tokens || 0, cls: 'seg-history', label: 'History' },
    ];

    return html`
      <div class="budget-section">
        <div class="budget-header">
          <span class="budget-label">Token Budget</span>
          <span class="budget-value">${this._fmt(total)} / ${this._fmt(max)}</span>
        </div>
        <div class="budget-bar" role="meter" aria-label="Token budget usage"
          aria-valuenow=${total} aria-valuemin="0" aria-valuemax=${max}>
          ${segments.map(s => html`
            <div class="budget-segment ${s.cls}"
              style="width:${this._pct(s.tokens, max)}%"
              title="${s.label}: ${this._fmt(s.tokens)}"
              aria-hidden="true"></div>
          `)}
        </div>
        <div class="budget-legend">
          ${segments.filter(s => s.tokens > 0).map(s => html`
            <span class="legend-item">
              <span class="legend-dot ${s.cls}"></span>
              ${s.label}: ${this._fmt(s.tokens)}
            </span>
          `)}
        </div>
      </div>

      ${this._renderCategory('system', '⚙️', 'System Prompt', b.system?.tokens, null)}
      ${this._renderCategory('symbols', '🗺️', 'Symbol Map', b.symbol_map?.tokens,
        () => html`
          <div class="detail-note">${b.symbol_map?.files || 0} files indexed</div>
        `
      )}
      ${this._renderCategory('files', '📄', 'Active Files', b.files?.tokens,
        () => (b.files?.items || []).map(f => html`
          <div class="detail-row">
            <span class="detail-path">${f.path}</span>
            <span class="detail-tokens">${this._fmt(f.tokens)}</span>
          </div>
        `)
      )}
      ${this._renderCategory('urls', '🔗', 'URL Context', b.urls?.tokens,
        () => (b.urls?.items || []).length === 0
          ? html`<div class="detail-note">No URLs fetched</div>`
          : (b.urls?.items || []).map(u => html`
            <div class="detail-row">
              <span class="detail-path" title="${u.url}">${u.display_name || u.url}</span>
              <span class="detail-tokens">${this._fmt(u.tokens)}</span>
            </div>
          `)
      )}
      ${this._renderCategory('history', '💬', 'History', b.history?.tokens,
        () => html`
          ${b.history?.needs_summary ? html`
            <div class="detail-note">⚠ Approaching compaction threshold</div>
          ` : nothing}
          <div class="detail-note">Max: ${this._fmt(b.history?.max_tokens)} tokens</div>
        `
      )}

      ${d.session_totals ? this._renderSessionTotals(d.session_totals) : nothing}
    `;
  }

  _renderCategory(key, icon, name, tokens, detailFn) {
    const expanded = this._expanded.has(key);
    const hasDetail = !!detailFn;

    return html`
      <div class="category">
        <div class="category-header"
          @click=${() => hasDetail && this._toggle(key)}
          role=${hasDetail ? 'button' : 'presentation'}
          tabindex=${hasDetail ? '0' : nothing}
          aria-expanded=${hasDetail ? expanded : nothing}
          @keydown=${(e) => { if (hasDetail && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this._toggle(key); } }}>
          <span class="category-icon" aria-hidden="true">${icon}</span>
          <span class="category-name">${name}</span>
          <span class="category-tokens">${this._fmt(tokens)}</span>
          ${hasDetail ? html`
            <span class="category-toggle" aria-hidden="true">${expanded ? '▾' : '▸'}</span>
          ` : nothing}
        </div>
        ${expanded && hasDetail ? html`
          <div class="category-body" role="region" aria-label="${name} details">${detailFn()}</div>
        ` : nothing}
      </div>
    `;
  }

  _renderSessionTotals(totals) {
    return html`
      <div class="session-section">
        <div class="session-title">Session Totals</div>
        <div class="session-grid">
          <div class="session-stat">
            <span class="stat-label">Prompt</span>
            <span class="stat-value">${this._fmt(totals.prompt)}</span>
          </div>
          <div class="session-stat">
            <span class="stat-label">Completion</span>
            <span class="stat-value">${this._fmt(totals.completion)}</span>
          </div>
          <div class="session-stat">
            <span class="stat-label">Cache Hit</span>
            <span class="stat-value">${this._fmt(totals.cache_hit)}</span>
          </div>
          <div class="session-stat">
            <span class="stat-label">Cache Write</span>
            <span class="stat-value">${this._fmt(totals.cache_write)}</span>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('context-tab', ContextTab);