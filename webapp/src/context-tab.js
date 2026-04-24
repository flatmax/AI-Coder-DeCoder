// ContextTab — token budget breakdown and cache tier viewer.
//
// Layer 5 Phase 3.4 — Context tab with Budget / Cache sub-views.
//
// Consumes LLMService.get_context_breakdown for both views.
// Budget shows category-level token allocation; Cache shows
// per-tier stability state. Active sub-view persisted to
// localStorage. Both auto-refresh on stream-complete and
// files-changed when visible; mark stale when hidden.
//
// Governing spec: specs4/5-webapp/viewers-hud.md

import { LitElement, css, html } from 'lit';
import { RpcMixin } from './rpc-mixin.js';

/** localStorage key for the active sub-view. */
const _SUBVIEW_KEY = 'ac-dc-context-subview';

/** Category colors for the stacked bar. */
const _COLORS = {
  system: '#50c878',
  symbol_map: '#60a5fa',
  files: '#f59e0b',
  urls: '#a78bfa',
  history: '#f97316',
};

/**
 * Format a token count for display. Uses K suffix for
 * thousands (e.g., 34,355 → "34.4K"). Values under 1000
 * render as-is.
 */
function _fmtTokens(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0';
  if (n < 1000) return String(Math.round(n));
  return `${(n / 1000).toFixed(1)}K`;
}

/**
 * Compute the budget bar color from a usage percentage.
 * Green ≤75%, amber 75–90%, red >90%.
 */
function _budgetColor(pct) {
  if (pct > 90) return '#f85149';
  if (pct > 75) return '#d29922';
  return '#7ee787';
}

export class ContextTab extends RpcMixin(LitElement) {
  static properties = {
    /** Active sub-view — 'budget' or 'cache'. */
    _subview: { type: String, state: true },
    /** Breakdown data from get_context_breakdown. */
    _data: { type: Object, state: true },
    /** Whether a fetch is in flight. */
    _loading: { type: Boolean, state: true },
    /** Whether the data is stale (hidden during an update). */
    _stale: { type: Boolean, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      background: var(--bg-primary, #0d1117);
      color: var(--text-primary, #c9d1d9);
      font-size: 0.875rem;
      overflow-y: auto;
    }

    .toolbar {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      border-bottom: 1px solid rgba(240, 246, 252, 0.1);
      background: rgba(22, 27, 34, 0.4);
    }
    .pill-toggle {
      display: flex;
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 4px;
      overflow: hidden;
    }
    .pill-btn {
      background: transparent;
      border: none;
      color: var(--text-secondary, #8b949e);
      padding: 0.3rem 0.75rem;
      font-size: 0.75rem;
      font-family: inherit;
      cursor: pointer;
    }
    .pill-btn:hover {
      background: rgba(240, 246, 252, 0.06);
    }
    .pill-btn.active {
      background: rgba(88, 166, 255, 0.15);
      color: var(--accent-primary, #58a6ff);
    }
    .toolbar-spacer {
      flex: 1;
    }
    .stale-badge {
      font-size: 0.7rem;
      color: #d29922;
    }
    .refresh-btn {
      background: transparent;
      border: 1px solid rgba(240, 246, 252, 0.15);
      color: var(--text-secondary, #8b949e);
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.75rem;
      font-family: inherit;
    }
    .refresh-btn:hover {
      background: rgba(240, 246, 252, 0.06);
      color: var(--text-primary, #c9d1d9);
    }
    .refresh-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .content {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 1rem;
    }
    .empty-state {
      padding: 2rem;
      text-align: center;
      color: var(--text-secondary, #8b949e);
      font-style: italic;
    }

    /* Budget sub-view */
    .budget-header {
      margin-bottom: 1rem;
    }
    .model-info {
      font-size: 0.8125rem;
      color: var(--text-secondary, #8b949e);
      margin-bottom: 0.5rem;
    }
    .model-info strong {
      color: var(--text-primary, #c9d1d9);
    }
    .budget-bar-container {
      background: rgba(240, 246, 252, 0.08);
      border-radius: 4px;
      height: 8px;
      overflow: hidden;
      margin-bottom: 0.25rem;
    }
    .budget-bar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 300ms ease;
    }
    .budget-label {
      font-size: 0.75rem;
      color: var(--text-secondary, #8b949e);
      display: flex;
      justify-content: space-between;
    }

    .stacked-bar {
      display: flex;
      height: 6px;
      border-radius: 3px;
      overflow: hidden;
      margin: 0.75rem 0 0.5rem;
      background: rgba(240, 246, 252, 0.06);
    }
    .stacked-segment {
      height: 100%;
      transition: width 300ms ease;
    }
    .legend-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-bottom: 1rem;
      font-size: 0.75rem;
      color: var(--text-secondary, #8b949e);
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 0.3rem;
    }
    .legend-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .category-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .category-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .category-name {
      min-width: 6rem;
      font-size: 0.8125rem;
    }
    .category-bar-track {
      flex: 1;
      height: 4px;
      background: rgba(240, 246, 252, 0.08);
      border-radius: 2px;
      overflow: hidden;
    }
    .category-bar-fill {
      height: 100%;
      border-radius: 2px;
    }
    .category-tokens {
      min-width: 4rem;
      text-align: right;
      font-size: 0.8125rem;
      font-family: 'SFMono-Regular', Consolas, monospace;
      color: #7ee787;
    }

    .session-totals {
      border-top: 1px solid rgba(240, 246, 252, 0.08);
      padding-top: 0.75rem;
      margin-top: 0.5rem;
    }
    .session-totals-title {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary, #8b949e);
      margin-bottom: 0.5rem;
    }
    .totals-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.35rem 1rem;
      font-size: 0.8125rem;
    }
    .totals-label {
      color: var(--text-secondary, #8b949e);
    }
    .totals-value {
      text-align: right;
      font-family: 'SFMono-Regular', Consolas, monospace;
    }
    .totals-value.cache-read {
      color: #7ee787;
    }
    .totals-value.cache-write {
      color: #f59e0b;
    }

    /* Cache sub-view placeholder */
    .cache-placeholder {
      padding: 2rem;
      text-align: center;
      color: var(--text-secondary, #8b949e);
      font-style: italic;
    }
  `;

  constructor() {
    super();
    this._subview = this._loadSubview();
    this._data = null;
    this._loading = false;
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
    window.removeEventListener('stream-complete', this._onStreamComplete);
    window.removeEventListener('files-changed', this._onFilesChanged);
    window.removeEventListener('mode-changed', this._onModeChanged);
    super.disconnectedCallback();
  }

  onRpcReady() {
    this._refresh();
  }

  /**
   * Called by the dialog when this tab becomes visible.
   * Refreshes if stale; otherwise no-op.
   */
  onTabVisible() {
    if (this._stale) {
      this._stale = false;
      this._refresh();
    }
  }

  // ---------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------

  _isTabActive() {
    const panel = this.parentElement;
    if (panel && panel.classList && panel.classList.contains('tab-panel')) {
      return panel.classList.contains('active');
    }
    return this.offsetParent !== null;
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

  async _refresh() {
    if (this._loading) return;
    if (!this.rpcConnected) return;
    this._loading = true;
    try {
      const result = await this.rpcExtract(
        'LLMService.get_context_breakdown',
      );
      this._data = result && typeof result === 'object' ? result : null;
      this._stale = false;
    } catch (err) {
      // Method may not exist on older/stripped backends.
      const msg = err?.message || '';
      if (!msg.includes('method not found')) {
        console.warn('[context-tab] get_context_breakdown failed', err);
      }
    } finally {
      this._loading = false;
    }
  }

  // ---------------------------------------------------------------
  // Sub-view toggle
  // ---------------------------------------------------------------

  _loadSubview() {
    try {
      const v = localStorage.getItem(_SUBVIEW_KEY);
      if (v === 'cache') return 'cache';
    } catch (_) {}
    return 'budget';
  }

  _setSubview(v) {
    this._subview = v;
    try {
      localStorage.setItem(_SUBVIEW_KEY, v);
    } catch (_) {}
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  render() {
    return html`
      <div class="toolbar">
        <div class="pill-toggle">
          <button
            class="pill-btn ${this._subview === 'budget' ? 'active' : ''}"
            @click=${() => this._setSubview('budget')}
          >Budget</button>
          <button
            class="pill-btn ${this._subview === 'cache' ? 'active' : ''}"
            @click=${() => this._setSubview('cache')}
          >Cache</button>
        </div>
        <div class="toolbar-spacer"></div>
        ${this._stale ? html`<span class="stale-badge">● stale</span>` : ''}
        <button
          class="refresh-btn"
          ?disabled=${this._loading || !this.rpcConnected}
          @click=${() => this._refresh()}
          title="Refresh"
        >↻</button>
      </div>
      <div class="content">
        ${this._subview === 'budget'
          ? this._renderBudget()
          : this._renderCache()}
      </div>
    `;
  }

  // ---------------------------------------------------------------
  // Budget sub-view
  // ---------------------------------------------------------------

  _renderBudget() {
    if (!this._data) {
      return html`<div class="empty-state">
        ${this._loading ? 'Loading…' : 'No data yet — send a message first'}
      </div>`;
    }
    const d = this._data;
    const bd = d.breakdown || {};
    const total = d.total_tokens || 0;
    const max = d.max_input_tokens || 1000000;
    const pct = max > 0 ? Math.min(100, (total / max) * 100) : 0;
    const cacheRate = d.provider_cache_rate ?? d.cache_hit_rate ?? 0;

    // Categories for the stacked bar and the detail list.
    const categories = [
      { key: 'system', label: 'System', tokens: bd.system || 0 },
      { key: 'symbol_map', label: d.mode === 'doc' ? 'Doc Map' : 'Symbol Map', tokens: bd.symbol_map || 0 },
      { key: 'files', label: `Files (${bd.file_count || 0})`, tokens: bd.files || 0 },
      { key: 'urls', label: 'URLs', tokens: bd.urls || 0 },
      { key: 'history', label: 'History', tokens: bd.history || 0 },
    ].filter((c) => c.tokens > 0);

    const maxCat = Math.max(1, ...categories.map((c) => c.tokens));

    return html`
      <div class="budget-header">
        <div class="model-info">
          <strong>${d.model || '—'}</strong>
          ${cacheRate > 0
            ? html` · Cache: ${Math.round(cacheRate * 100)}% hit`
            : ''}
          ${d.mode === 'doc' ? html` · 📝 Doc Mode` : ''}
        </div>
        <div class="budget-bar-container">
          <div
            class="budget-bar-fill"
            style="width: ${pct}%; background: ${_budgetColor(pct)}"
          ></div>
        </div>
        <div class="budget-label">
          <span>${_fmtTokens(total)} / ${_fmtTokens(max)}</span>
          <span>${pct.toFixed(1)}% used</span>
        </div>
      </div>

      ${categories.length > 0
        ? html`
            <div class="stacked-bar">
              ${categories.map(
                (c) => html`
                  <div
                    class="stacked-segment"
                    style="width: ${total > 0 ? (c.tokens / total) * 100 : 0}%; background: ${_COLORS[c.key] || '#8b949e'}"
                  ></div>
                `,
              )}
            </div>
            <div class="legend-row">
              ${categories.map(
                (c) => html`
                  <span class="legend-item">
                    <span class="legend-dot" style="background: ${_COLORS[c.key] || '#8b949e'}"></span>
                    ${c.label}: ${_fmtTokens(c.tokens)}
                  </span>
                `,
              )}
            </div>
          `
        : ''}

      <div class="category-list">
        ${categories.map(
          (c) => html`
            <div class="category-row">
              <span class="category-name">${c.label}</span>
              <div class="category-bar-track">
                <div
                  class="category-bar-fill"
                  style="width: ${(c.tokens / maxCat) * 100}%; background: ${_COLORS[c.key] || '#8b949e'}"
                ></div>
              </div>
              <span class="category-tokens">${_fmtTokens(c.tokens)}</span>
            </div>
          `,
        )}
      </div>

      ${this._renderSessionTotals()}
    `;
  }

  _renderSessionTotals() {
    const st = this._data?.session_totals;
    if (!st) return '';
    return html`
      <div class="session-totals">
        <div class="session-totals-title">Session Totals</div>
        <div class="totals-grid">
          <span class="totals-label">Prompt In</span>
          <span class="totals-value">${_fmtTokens(st.prompt || st.input_tokens || 0)}</span>
          <span class="totals-label">Completion Out</span>
          <span class="totals-value">${_fmtTokens(st.completion || st.output_tokens || 0)}</span>
          <span class="totals-label">Total</span>
          <span class="totals-value">${_fmtTokens(st.total || 0)}</span>
          ${(st.cache_hit || st.cache_read_tokens || 0) > 0
            ? html`
                <span class="totals-label">Cache Read</span>
                <span class="totals-value cache-read">${_fmtTokens(st.cache_hit || st.cache_read_tokens || 0)}</span>
              `
            : ''}
          ${(st.cache_write || st.cache_write_tokens || 0) > 0
            ? html`
                <span class="totals-label">Cache Write</span>
                <span class="totals-value cache-write">${_fmtTokens(st.cache_write || st.cache_write_tokens || 0)}</span>
              `
            : ''}
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------
  // Cache sub-view (placeholder for follow-up commit)
  // ---------------------------------------------------------------

  _renderCache() {
    return html`<div class="cache-placeholder">
      Cache tier viewer — coming in Phase 3.5
    </div>`;
  }
}

customElements.define('ac-context-tab', ContextTab);