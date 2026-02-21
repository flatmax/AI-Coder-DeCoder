/**
 * Cache Viewer tab — tier blocks, stability bars, recent changes, fuzzy filter.
 *
 * Calls LLM.get_context_breakdown for data.
 */

import { LitElement, html, css, nothing } from 'lit';
import { theme, scrollbarStyles } from '../styles/theme.js';
import { RpcMixin } from '../rpc-mixin.js';
import '../components/url-content-dialog.js';

function formatTokens(n) {
  if (n == null) return '—';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

const TIER_COLORS = {
  L0: '#50c878',   // green
  L1: '#2dd4bf',   // teal
  L2: '#60a5fa',   // blue
  L3: '#f59e0b',   // amber
  active: '#f97316', // orange
};

const TIER_LABELS = {
  L0: 'L0 · Most Stable',
  L1: 'L1 · Very Stable',
  L2: 'L2 · Stable',
  L3: 'L3 · Entry',
  active: 'Active',
};

const TYPE_ICONS = {
  system: '⚙️',
  legend: '📖',
  symbols: '📦',
  doc_symbols: '📝',
  files: '📄',
  urls: '🔗',
  history: '💬',
};

export class AcCacheTab extends RpcMixin(LitElement) {
  static properties = {
    _data: { type: Object, state: true },
    _loading: { type: Boolean, state: true },
    _expandedTiers: { type: Object, state: true },
    _filter: { type: String, state: true },
    _stale: { type: Boolean, state: true },
  };

  static styles = [theme, scrollbarStyles, css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow-y: auto;
    }

    /* Performance header */
    .perf-section {
      padding: 12px 16px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-primary);
    }

    .perf-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }

    .perf-label {
      font-size: 0.85rem;
      color: var(--text-secondary);
      font-weight: 600;
    }

    .perf-value {
      font-family: var(--font-mono);
      font-size: 0.9rem;
      color: var(--accent-green);
    }

    .perf-bar {
      height: 8px;
      background: var(--bg-primary);
      border-radius: 4px;
      overflow: hidden;
    }

    .perf-bar-fill {
      height: 100%;
      background: var(--accent-green);
      border-radius: 3px;
      transition: width 0.3s;
    }

    /* Toolbar */
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--border-primary);
      background: var(--bg-secondary);
    }

    .filter-input {
      flex: 1;
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-family: var(--font-mono);
      font-size: 0.85rem;
      padding: 5px 10px;
      outline: none;
    }
    .filter-input:focus {
      border-color: var(--accent-primary);
    }
    .filter-input::placeholder {
      color: var(--text-muted);
    }

    .refresh-btn {
      background: none;
      border: 1px solid var(--border-primary);
      color: var(--text-muted);
      font-size: 0.75rem;
      padding: 3px 10px;
      border-radius: var(--radius-sm);
      cursor: pointer;
    }
    .refresh-btn:hover {
      color: var(--text-primary);
      border-color: var(--accent-primary);
    }

    .stale-badge {
      font-size: 0.75rem;
      color: var(--accent-orange);
    }

    /* Recent changes */
    .changes-section {
      padding: 10px 16px;
      border-bottom: 1px solid var(--border-primary);
      font-size: 0.82rem;
    }

    .changes-label {
      color: var(--text-muted);
      font-weight: 600;
      text-transform: uppercase;
      font-size: 0.72rem;
      letter-spacing: 0.05em;
      margin-bottom: 6px;
    }

    .change-item {
      padding: 3px 0;
      color: var(--text-secondary);
    }

    .change-icon { margin-right: 4px; }

    /* Tier blocks */
    .tiers {
      flex: 1;
      overflow-y: auto;
    }

    .tier-block {
      border-bottom: 1px solid var(--border-primary);
    }

    .tier-header {
      display: flex;
      align-items: center;
      padding: 8px 16px;
      cursor: pointer;
      user-select: none;
      gap: 8px;
      transition: background 0.15s;
    }
    .tier-header:hover {
      background: var(--bg-tertiary);
    }

    .tier-toggle {
      font-size: 0.6rem;
      color: var(--text-muted);
      width: 12px;
      flex-shrink: 0;
    }

    .tier-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .tier-name {
      font-size: 0.85rem;
      color: var(--text-secondary);
      flex: 1;
    }

    .tier-tokens {
      font-family: var(--font-mono);
      font-size: 0.82rem;
      color: var(--accent-green);
      flex-shrink: 0;
    }

    .tier-cached-badge {
      font-size: 0.7rem;
      padding: 2px 8px;
      border-radius: 8px;
      background: rgba(80, 200, 120, 0.15);
      color: var(--accent-green);
      flex-shrink: 0;
    }

    /* Tier contents */
    .tier-contents {
      display: none;
      padding: 4px 16px 10px 36px;
    }
    .tier-contents.expanded {
      display: block;
    }

    .tier-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 0;
      font-size: 0.82rem;
    }

    .item-icon {
      flex-shrink: 0;
      width: 18px;
      text-align: center;
    }

    .item-name {
      flex: 1;
      font-family: var(--font-mono);
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .item-name.clickable {
      cursor: pointer;
    }
    .item-name.clickable:hover {
      color: var(--accent-primary);
      text-decoration: underline;
    }

    .item-tokens {
      font-family: var(--font-mono);
      color: var(--accent-green);
      font-size: 0.8rem;
      flex-shrink: 0;
      min-width: 5ch;
      text-align: right;
    }

    /* Stability bar */
    .stability-bar {
      width: 48px;
      height: 6px;
      background: var(--bg-primary);
      border-radius: 3px;
      overflow: hidden;
      flex-shrink: 0;
    }

    .stability-bar-fill {
      height: 100%;
      border-radius: 3px;
    }

    .item-n {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--text-secondary);
      flex-shrink: 0;
      min-width: 5ch;
      text-align: right;
    }

    /* Footer */
    .footer {
      padding: 10px 16px;
      border-top: 1px solid var(--border-primary);
      background: var(--bg-tertiary);
      font-size: 0.8rem;
      color: var(--text-secondary);
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 4px;
    }

    .footer span {
      font-family: var(--font-mono);
    }

    /* Loading */
    .loading-indicator {
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
    this._data = null;
    this._loading = false;
    this._expandedTiers = this._loadExpandedTiers();
    this._filter = '';
    this._stale = false;

    this._onStreamComplete = this._onStreamComplete.bind(this);
    this._onFilesChanged = this._onFilesChanged.bind(this);
    this._onModeChanged = this._onModeChanged.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('stream-complete', this._onStreamComplete);
    window.addEventListener('files-changed', this._onFilesChanged);
    window.addEventListener('mode-changed', this._onModeChanged);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('stream-complete', this._onStreamComplete);
    window.removeEventListener('files-changed', this._onFilesChanged);
    window.removeEventListener('mode-changed', this._onModeChanged);
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

  _onModeChanged() {
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
      console.warn('Failed to load cache data:', e);
    } finally {
      this._loading = false;
    }
  }

  _toggleTier(tier) {
    const next = new Set(this._expandedTiers);
    if (next.has(tier)) {
      next.delete(tier);
    } else {
      next.add(tier);
    }
    this._expandedTiers = next;
    this._saveExpandedTiers(next);
  }

  _saveExpandedTiers(tiers) {
    try { localStorage.setItem('ac-dc-cache-expanded', JSON.stringify([...tiers])); } catch {}
  }

  _loadExpandedTiers() {
    try {
      const v = localStorage.getItem('ac-dc-cache-expanded');
      if (v) return new Set(JSON.parse(v));
    } catch {}
    return new Set(['L0', 'L1', 'L2', 'L3', 'active']);
  }

  _onFilterInput(e) {
    this._filter = e.target.value;
  }

  _fuzzyMatch(text, filter) {
    if (!filter) return true;
    const lower = text.toLowerCase();
    const f = filter.toLowerCase();
    let fi = 0;
    for (let i = 0; i < lower.length && fi < f.length; i++) {
      if (lower[i] === f[fi]) fi++;
    }
    return fi === f.length;
  }

  async _viewMapBlock(item) {
    const path = item.path;
    if (!path) return;

    try {
      const data = await this.rpcExtract('LLMService.get_file_map_block', path);
      if (!data || data.error) {
        console.warn('No map block:', data?.error);
        return;
      }

      const isSystem = path.startsWith('system:');
      const modeLabel = isSystem ? 'System'
        : data.mode === 'doc' ? 'Document Outline' : 'Symbol Map';
      const displayName = isSystem ? 'System Prompt + Legend' : path;
      const dialog = this.shadowRoot?.querySelector('ac-url-content-dialog');
      if (dialog) {
        dialog.show({
          url: path,
          title: `${modeLabel}: ${displayName}`,
          url_type: data.mode === 'doc' ? 'documentation' : 'generic',
          content: data.content,
          fetched_at: null,
        });
      }
    } catch (e) {
      console.warn('Failed to load map block:', e);
    }
  }

  // === Render ===

  _renderPerformance() {
    const d = this._data;
    if (!d) return nothing;

    const hitRate = d.provider_cache_rate ?? d.cache_hit_rate ?? 0;
    const pct = Math.min(100, Math.max(0, hitRate * 100)).toFixed(0);

    return html`
      <div class="perf-section">
        <div class="perf-header">
          <span class="perf-label">Cache Performance</span>
          <span class="perf-value">${pct}% hit rate</span>
        </div>
        <div class="perf-bar">
          <div class="perf-bar-fill" style="width: ${Math.min(100, Math.max(0, hitRate * 100))}%"></div>
        </div>
      </div>
    `;
  }

  _renderChanges() {
    const d = this._data;
    const promotions = d?.promotions || [];
    const demotions = d?.demotions || [];
    if (promotions.length === 0 && demotions.length === 0) return nothing;

    const changes = [
      ...promotions.map(p => ({ icon: '📈', text: p })),
      ...demotions.map(p => ({ icon: '📉', text: p })),
    ];

    return html`
      <div class="changes-section">
        <div class="changes-label">Recent Changes</div>
        ${changes.slice(0, 10).map(c => html`
          <div class="change-item">
            <span class="change-icon">${c.icon}</span>
            ${c.text}
          </div>
        `)}
      </div>
    `;
  }

  _renderTierBlock(block) {
    const tier = block.tier || block.name || 'unknown';
    const label = TIER_LABELS[tier] || tier;
    const color = TIER_COLORS[tier] || '#888';
    const expanded = this._expandedTiers.has(tier);
    const cached = block.cached;
    const tokens = block.tokens || 0;

    // Filter contents
    const contents = (block.contents || []).filter(item => {
      const name = item.name || item.path || item.type || '';
      return this._fuzzyMatch(name, this._filter);
    });

    // If filter active and no matching contents, hide tier
    if (this._filter && contents.length === 0) return nothing;

    return html`
      <div class="tier-block">
        <div class="tier-header" role="button" tabindex="0"
             aria-expanded="${expanded}" aria-label="${label}, ${formatTokens(tokens)} tokens"
             @click=${() => this._toggleTier(tier)}
             @keydown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._toggleTier(tier); }}}>
          <span class="tier-toggle" aria-hidden="true">${expanded ? '▼' : '▶'}</span>
          <span class="tier-dot" style="background: ${color}" aria-hidden="true"></span>
          <span class="tier-name">${label} (${contents.length})</span>
          <span class="tier-tokens">${formatTokens(tokens)}</span>
          ${cached ? html`<span class="tier-cached-badge" aria-label="Cached">🔒</span>` : nothing}
        </div>
        <div class="tier-contents ${expanded ? 'expanded' : ''}">
          ${(() => {
            const measured = contents.filter(i => i.tokens > 0);
            const unmeasured = contents.filter(i => !i.tokens);
            return html`
              ${measured.map(item => {
                const icon = TYPE_ICONS[item.type] || '📄';
                const name = item.name || item.path || '—';
                const itemTokens = item.tokens || 0;
                const n = item.n != null ? item.n : null;
                const threshold = item.threshold || block.threshold;
                const barPct = (n != null && threshold) ? Math.min(100, (n / threshold) * 100) : 0;

                return html`
                  <div class="tier-item">
                    <span class="item-icon">${icon}</span>
                    <span class="item-name ${item.path ? 'clickable' : ''}"
                          title="${name}"
                          @click=${item.path ? () => this._viewMapBlock(item) : null}>${name}</span>
                    <span class="item-tokens">${formatTokens(itemTokens)}</span>
                    ${n != null ? html`
                      <div class="stability-bar" title="N=${n}/${threshold || '?'}">
                        <div class="stability-bar-fill" style="width: ${barPct}%; background: ${color}"></div>
                      </div>
                      <span class="item-n" title="N=${n}/${threshold || '?'}">${n}/${threshold || '?'}</span>
                    ` : nothing}
                  </div>
                `;
              })}
              ${unmeasured.length > 0 ? html`
                <div class="tier-item">
                  <span class="item-icon">📦</span>
                  <span class="item-name" style="color: var(--text-muted); font-style: italic;"
                    >${unmeasured.length} pre-indexed ${(() => {
                      // Check if unmeasured items include doc_symbols type
                      const hasDoc = unmeasured.some(i => i.type === 'doc_symbols');
                      const hasSym = unmeasured.some(i => i.type === 'symbols');
                      if (hasDoc && hasSym) return 'symbols & documents';
                      if (hasDoc) return 'documents';
                      return this._data?.mode === 'doc' ? 'documents' : 'symbols';
                    })()} (awaiting measurement)</span>
                </div>
              ` : nothing}
              ${contents.length === 0 ? html`
                <div class="tier-item">
                  <span class="item-name" style="color: var(--text-muted); font-style: italic;">Empty</span>
                </div>
              ` : nothing}
            `;
          })()}
        </div>
      </div>
    `;
  }

  _renderTiers() {
    const blocks = this._data?.blocks;
    if (!blocks || blocks.length === 0) return nothing;

    return html`
      <div class="tiers">
        ${blocks.map(b => this._renderTierBlock(b))}
      </div>
    `;
  }

  _renderFooter() {
    const d = this._data;
    if (!d) return nothing;

    return html`
      <div class="footer">
        <span>Model: ${d.model || '—'}</span>
        <span>Total: ${formatTokens(d.total_tokens)}</span>
      </div>
    `;
  }

  render() {
    return html`
      ${this._renderPerformance()}

      <div class="toolbar">
        <input
          class="filter-input"
          type="text"
          placeholder="Filter items..."
          aria-label="Filter cache items"
          .value=${this._filter}
          @input=${this._onFilterInput}
        >
        ${this._stale ? html`<span class="stale-badge" aria-label="Data is stale">● stale</span>` : nothing}
        <button class="refresh-btn" @click=${() => this._refresh()}
          ?disabled=${this._loading}
          aria-label="Refresh cache data">↻</button>
      </div>

      ${this._loading && !this._data ? html`
        <div class="loading-indicator">Loading cache data...</div>
      ` : html`
        ${this._renderTiers()}
        ${this._renderChanges()}
        ${this._renderFooter()}
      `}

      <ac-url-content-dialog></ac-url-content-dialog>
    `;
  }
}

customElements.define('ac-cache-tab', AcCacheTab);