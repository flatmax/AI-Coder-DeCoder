/**
 * Context Viewer tab — token budget bar, stacked category bar,
 * expandable per-item details, session totals.
 *
 * Shows: system prompt, symbol map (per-chunk), files (per-file),
 * URLs (per-URL), history token usage.
 * Calls LLM.get_context_breakdown for data.
 */

import { LitElement, html, css, nothing } from 'lit';
import { theme, scrollbarStyles } from '../styles/theme.js';
import { RpcMixin } from '../rpc-mixin.js';
import './url-content-dialog.js';

function formatTokens(n) {
  if (n == null) return '—';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

/** Category color palette */
const CAT_COLORS = {
  system:     { bar: '#50c878', text: '#50c878', label: 'System' },
  symbol_map: { bar: '#60a5fa', text: '#60a5fa', label: 'Symbols' },
  files:      { bar: '#f59e0b', text: '#f59e0b', label: 'Files' },
  urls:       { bar: '#a78bfa', text: '#a78bfa', label: 'URLs' },
  history:    { bar: '#f97316', text: '#f97316', label: 'History' },
};

export { formatTokens };

export class AcContextTab extends RpcMixin(LitElement) {
  static properties = {
    _data: { type: Object, state: true },
    _loading: { type: Boolean, state: true },
    _expandedSections: { type: Object, state: true },
    _stale: { type: Boolean, state: true },
  };

  static styles = [theme, scrollbarStyles, css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow-y: auto;
    }

    /* Budget section */
    .budget-section {
      padding: 12px 16px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-primary);
    }

    .budget-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }

    .budget-label {
      font-size: 0.85rem;
      color: var(--text-secondary);
      font-weight: 600;
    }

    .budget-values {
      font-family: var(--font-mono);
      font-size: 0.85rem;
      color: var(--text-primary);
    }

    .budget-bar {
      height: 8px;
      background: var(--bg-primary);
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 4px;
    }

    .budget-bar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.3s;
    }
    .budget-bar-fill.green { background: var(--accent-green); }
    .budget-bar-fill.yellow { background: #e5c07b; }
    .budget-bar-fill.red { background: var(--accent-red); }

    .budget-percent {
      font-size: 0.78rem;
      color: var(--text-muted);
      text-align: right;
    }

    /* Stacked category bar */
    .stacked-section {
      padding: 8px 16px 4px;
      border-bottom: 1px solid var(--border-primary);
    }

    .stacked-bar {
      display: flex;
      height: 14px;
      border-radius: 7px;
      overflow: hidden;
      background: var(--bg-primary);
      margin-bottom: 8px;
    }

    .stacked-segment {
      height: 100%;
      transition: width 0.3s;
      min-width: 0;
    }

    .stacked-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 14px;
      font-size: 0.78rem;
      color: var(--text-secondary);
      padding-bottom: 4px;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .legend-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .legend-label {
      font-family: var(--font-mono);
      font-size: 0.78rem;
    }

    /* Model info */
    .model-info {
      padding: 8px 16px;
      font-size: 0.82rem;
      color: var(--text-secondary);
      border-bottom: 1px solid var(--border-primary);
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
    }

    .model-info span {
      font-family: var(--font-mono);
    }

    /* Categories */
    .categories {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }

    .category {
      border-bottom: 1px solid var(--border-primary);
    }

    .category-header {
      display: flex;
      align-items: center;
      padding: 9px 16px;
      cursor: pointer;
      user-select: none;
      gap: 8px;
      font-size: 0.85rem;
      transition: background 0.15s;
    }
    .category-header:hover {
      background: var(--bg-tertiary);
    }
    .category-header.no-expand {
      cursor: default;
    }
    .category-header.no-expand:hover {
      background: transparent;
    }

    .category-toggle {
      font-size: 0.65rem;
      color: var(--text-muted);
      width: 12px;
      flex-shrink: 0;
    }

    .category-icon {
      flex-shrink: 0;
      width: 18px;
      text-align: center;
      font-size: 0.82rem;
    }

    .category-name {
      color: var(--text-secondary);
      flex: 1;
    }

    .category-bar {
      width: 80px;
      height: 4px;
      background: var(--bg-primary);
      border-radius: 2px;
      overflow: hidden;
      flex-shrink: 0;
    }

    .category-bar-fill {
      height: 100%;
      border-radius: 2px;
    }

    .category-tokens {
      font-family: var(--font-mono);
      font-size: 0.82rem;
      color: var(--accent-green);
      min-width: 5ch;
      text-align: right;
      flex-shrink: 0;
    }

    /* Category detail items */
    .category-detail {
      display: none;
      padding: 4px 16px 10px 52px;
    }
    .category-detail.expanded {
      display: block;
    }

    .detail-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
      font-size: 0.8rem;
      color: var(--text-secondary);
    }

    .detail-name {
      flex: 1;
      font-family: var(--font-mono);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .detail-bar {
      width: 56px;
      height: 5px;
      background: var(--bg-primary);
      border-radius: 3px;
      overflow: hidden;
      flex-shrink: 0;
    }

    .detail-bar-fill {
      height: 100%;
      border-radius: 3px;
      background: var(--text-muted);
      opacity: 0.5;
    }

    .detail-tokens {
      font-family: var(--font-mono);
      font-size: 0.8rem;
      color: var(--accent-green);
      min-width: 5ch;
      text-align: right;
      flex-shrink: 0;
    }

    .detail-item.clickable {
      cursor: pointer;
      border-radius: var(--radius-sm);
      padding-left: 4px;
      padding-right: 4px;
      margin: 0 -4px;
    }
    .detail-item.clickable:hover {
      background: rgba(79, 195, 247, 0.1);
    }
    .detail-item.clickable .detail-name {
      color: var(--accent-primary);
    }

    /* Session totals */
    .session-section {
      padding: 10px 16px;
      border-top: 1px solid var(--border-primary);
      background: var(--bg-tertiary);
      font-size: 0.82rem;
      color: var(--text-secondary);
    }

    .session-section .label {
      font-weight: 600;
      color: var(--text-secondary);
      margin-bottom: 4px;
    }

    .session-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2px 12px;
    }

    .session-item {
      display: flex;
      justify-content: space-between;
    }

    .session-value {
      font-family: var(--font-mono);
      color: var(--text-primary);
    }

    /* Loading / Refresh */
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 16px;
      border-bottom: 1px solid var(--border-primary);
      background: var(--bg-secondary);
    }

    .refresh-btn {
      background: none;
      border: 1px solid var(--border-primary);
      color: var(--text-muted);
      font-size: 0.75rem;
      padding: 2px 10px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      margin-left: auto;
    }
    .refresh-btn:hover {
      color: var(--text-primary);
      border-color: var(--accent-primary);
    }

    .loading-indicator {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      color: var(--text-muted);
      font-size: 0.85rem;
    }

    .stale-badge {
      font-size: 0.75rem;
      color: var(--accent-orange);
      margin-left: 4px;
    }
  `];

  constructor() {
    super();
    this._data = null;
    this._loading = false;
    this._expandedSections = this._loadExpandedSections();
    this._stale = false;

    this._onStreamComplete = this._onStreamComplete.bind(this);
    this._onFilesChanged = this._onFilesChanged.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('stream-complete', this._onStreamComplete);
    window.addEventListener('files-changed', this._onFilesChanged);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('stream-complete', this._onStreamComplete);
    window.removeEventListener('files-changed', this._onFilesChanged);
  }

  onRpcReady() {
    this._refresh();
  }

  _onStreamComplete() {
    if (this._isTabActive()) {
      this._refresh();
    } else {
      this._stale = true;
    }
  }

  _onFilesChanged() {
    if (this._isTabActive()) {
      this._refresh();
    } else {
      this._stale = true;
    }
  }

  _isTabActive() {
    // Check if our parent tab-panel has the 'active' class
    const panel = this.parentElement;
    if (panel && panel.classList.contains('tab-panel')) {
      return panel.classList.contains('active');
    }
    return this.offsetParent !== null;
  }

  /** Called by dialog when this tab becomes visible. */
  onTabVisible() {
    if (this._stale) {
      this._stale = false;
      this._refresh();
    }
  }

  async _refresh() {
    if (!this.rpcConnected || this._loading) return;
    this._loading = true;
    this._stale = false;

    try {
      const data = await this.rpcExtract('LLMService.get_context_breakdown');
      if (data) {
        this._data = data;
      }
    } catch (e) {
      console.warn('Failed to load context breakdown:', e);
    } finally {
      this._loading = false;
    }
  }

  _toggleSection(name) {
    const next = new Set(this._expandedSections);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    this._expandedSections = next;
    this._saveExpandedSections(next);
  }

  async _onUrlItemClick(url) {
    if (!url || !this.rpcConnected) return;
    try {
      const result = await this.rpcExtract('LLMService.get_url_content', url);
      if (!result) return;
      const dialog = this.shadowRoot?.querySelector('ac-url-content-dialog');
      if (dialog) {
        dialog.show(result);
      }
    } catch (e) {
      console.warn('Failed to load URL content:', e);
    }
  }

  _saveExpandedSections(sections) {
    try { localStorage.setItem('ac-dc-context-expanded', JSON.stringify([...sections])); } catch {}
  }

  _loadExpandedSections() {
    try {
      const v = localStorage.getItem('ac-dc-context-expanded');
      if (v) return new Set(JSON.parse(v));
    } catch {}
    return new Set();
  }

  /** Build category data from breakdown */
  _getCategories() {
    const b = this._data?.breakdown;
    if (!b) return [];

    return [
      {
        key: 'system',
        icon: '⚙️',
        name: 'System Prompt',
        tokens: (b.system || 0) + (b.legend || 0),
        details: null,
      },
      {
        key: 'symbol_map',
        icon: '📦',
        name: `Symbol Map${b.symbol_map_files ? ` (${b.symbol_map_files} files)` : ''}`,
        tokens: b.symbol_map || 0,
        details: b.symbol_map_chunks || null,
      },
      {
        key: 'files',
        icon: '📄',
        name: `Files${b.file_count ? ` (${b.file_count})` : ''}`,
        tokens: b.files || 0,
        details: b.file_details || null,
      },
      {
        key: 'urls',
        icon: '🔗',
        name: `URLs${b.url_details?.length ? ` (${b.url_details.length})` : ''}`,
        tokens: b.urls || 0,
        details: b.url_details || null,
      },
      {
        key: 'history',
        icon: '💬',
        name: `History${b.history_messages ? ` (${b.history_messages} msgs)` : ''}`,
        tokens: b.history || 0,
        details: null,
      },
    ];
  }

  // === Render ===

  _getBudgetColor(percent) {
    if (percent > 90) return 'red';
    if (percent > 75) return 'yellow';
    return 'green';
  }

  _renderBudget() {
    const d = this._data;
    if (!d) return nothing;

    const total = d.total_tokens || 0;
    const max = d.max_input_tokens || 1;
    const percent = Math.min(100, (total / max) * 100);
    const color = this._getBudgetColor(percent);

    return html`
      <div class="budget-section">
        <div class="budget-header">
          <span class="budget-label">Token Budget</span>
          <span class="budget-values">${formatTokens(total)} / ${formatTokens(max)}</span>
        </div>
        <div class="budget-bar">
          <div class="budget-bar-fill ${color}" style="width: ${percent}%"></div>
        </div>
        <div class="budget-percent">${percent.toFixed(1)}% used</div>
      </div>
    `;
  }

  _renderStackedBar() {
    const categories = this._getCategories();
    const total = this._data?.total_tokens || 1;
    if (!categories.length || total <= 0) return nothing;

    const segments = categories
      .filter(c => c.tokens > 0)
      .map(c => ({
        key: c.key,
        pct: (c.tokens / total) * 100,
        color: CAT_COLORS[c.key]?.bar || '#666',
        label: CAT_COLORS[c.key]?.label || c.key,
        tokens: c.tokens,
      }));

    return html`
      <div class="stacked-section">
        <div class="stacked-bar">
          ${segments.map(s => html`
            <div class="stacked-segment"
              style="width: ${s.pct}%; background: ${s.color}"
              title="${s.label}: ${formatTokens(s.tokens)}">
            </div>
          `)}
        </div>
        <div class="stacked-legend">
          ${segments.map(s => html`
            <span class="legend-item">
              <span class="legend-dot" style="background: ${s.color}"></span>
              <span class="legend-label">${s.label}: ${formatTokens(s.tokens)}</span>
            </span>
          `)}
        </div>
      </div>
    `;
  }

  _renderCategories() {
    const categories = this._getCategories();
    const total = this._data?.total_tokens || 1;
    if (!categories.length) return nothing;

    return html`
      <div class="categories">
        ${categories.map(cat => {
          const pct = total > 0 ? (cat.tokens / total) * 100 : 0;
          const expanded = this._expandedSections.has(cat.key);
          const hasDetails = cat.details && cat.details.length > 0;
          const color = CAT_COLORS[cat.key]?.bar || 'var(--accent-primary)';
          const maxDetail = hasDetails
            ? Math.max(1, ...cat.details.map(d => d.tokens || 0))
            : 1;

          return html`
            <div class="category">
              <div class="category-header ${hasDetails ? '' : 'no-expand'}"
                role="${hasDetails ? 'button' : nothing}"
                tabindex="${hasDetails ? '0' : nothing}"
                aria-expanded="${hasDetails ? String(expanded) : nothing}"
                aria-label="${cat.name}, ${formatTokens(cat.tokens)} tokens"
                @click=${() => hasDetails && this._toggleSection(cat.key)}
                @keydown=${(e) => { if (hasDetails && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this._toggleSection(cat.key); }}}>
                <span class="category-toggle" aria-hidden="true">${hasDetails ? (expanded ? '▼' : '▶') : ' '}</span>
                <span class="category-icon">${cat.icon}</span>
                <span class="category-name">${cat.name}</span>
                <div class="category-bar">
                  <div class="category-bar-fill" style="width: ${pct}%; background: ${color}"></div>
                </div>
                <span class="category-tokens">${formatTokens(cat.tokens)}</span>
              </div>
              ${hasDetails ? html`
                <div class="category-detail ${expanded ? 'expanded' : ''}">
                  ${cat.details.map(item => {
                    const itemPct = maxDetail > 0 ? ((item.tokens || 0) / maxDetail) * 100 : 0;
                    const isUrl = cat.key === 'urls' && item.url;
                    return html`
                      <div class="detail-item ${isUrl ? 'clickable' : ''}"
                        @click=${isUrl ? () => this._onUrlItemClick(item.url) : nothing}>
                        <span class="detail-name"
                          title="${item.name || item.path || item.url || '—'}"
                        >${item.name || item.path || item.url || '—'}</span>
                        <div class="detail-bar">
                          <div class="detail-bar-fill" style="width: ${itemPct}%; background: ${color}"></div>
                        </div>
                        <span class="detail-tokens">${formatTokens(item.tokens)}</span>
                      </div>
                    `;
                  })}
                </div>
              ` : nothing}
            </div>
          `;
        })}
      </div>
    `;
  }

  _renderSessionTotals() {
    const s = this._data?.session_totals;
    if (!s) return nothing;

    return html`
      <div class="session-section">
        <div class="label">Session Totals</div>
        <div class="session-grid">
          <div class="session-item">
            <span>Prompt In</span>
            <span class="session-value">${formatTokens(s.prompt)}</span>
          </div>
          <div class="session-item">
            <span>Completion Out</span>
            <span class="session-value">${formatTokens(s.completion)}</span>
          </div>
          <div class="session-item">
            <span>Total</span>
            <span class="session-value">${formatTokens(s.total)}</span>
          </div>
          <div class="session-item">
            <span>Cache Hit</span>
            <span class="session-value">${formatTokens(s.cache_hit)}</span>
          </div>
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <div class="toolbar">
        <span style="font-size: 0.8rem; color: var(--text-secondary); font-weight: 600;">
          Context Budget
          ${this._stale ? html`<span class="stale-badge">● stale</span>` : nothing}
        </span>
        <button class="refresh-btn" @click=${() => this._refresh()}
          ?disabled=${this._loading}
          aria-label="Refresh context breakdown">↻ Refresh</button>
      </div>

      ${this._loading && !this._data ? html`
        <div class="loading-indicator">Loading context breakdown...</div>
      ` : html`
        ${this._renderBudget()}
        ${this._data ? html`
          <div class="model-info">
            <span>Model: ${this._data.model || '—'}</span>
            ${this._data.cache_hit_rate != null ? html`
              <span>Cache: ${(this._data.cache_hit_rate * 100).toFixed(0)}% hit</span>
            ` : nothing}
          </div>
        ` : nothing}
        ${this._renderStackedBar()}
        ${this._renderCategories()}
        ${this._renderSessionTotals()}
      `}

      <ac-url-content-dialog></ac-url-content-dialog>
    `;
  }
}

customElements.define('ac-context-tab', AcContextTab);