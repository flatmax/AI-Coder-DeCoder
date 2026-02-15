/**
 * Token HUD — floating overlay showing token usage after each LLM response.
 *
 * Appears after streamComplete, auto-hides after 8 seconds with 800ms fade.
 * Hover pauses auto-hide. Click ✕ to dismiss.
 * Shows basic data from streamComplete immediately, fetches full breakdown async.
 */

import { LitElement, html, css, nothing } from 'lit';
import { theme } from '../styles/theme.js';
import { RpcMixin } from '../rpc-mixin.js';

function formatTokens(n) {
  if (n == null) return '—';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

export class AcTokenHud extends RpcMixin(LitElement) {
  static properties = {
    _visible: { type: Boolean, state: true },
    _fading: { type: Boolean, state: true },
    _data: { type: Object, state: true },
    _basicData: { type: Object, state: true },
    _collapsed: { type: Object, state: true },
  };

  static styles = [theme, css`
    :host {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: var(--z-hud, 10000);
      pointer-events: none;
    }

    .hud {
      pointer-events: auto;
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      width: 340px;
      max-height: 80vh;
      overflow-y: auto;
      font-size: 0.82rem;
      color: var(--text-secondary);
      opacity: 1;
      transition: opacity 0.8s ease;
    }

    .hud.hidden {
      display: none;
    }

    .hud.fading {
      opacity: 0;
    }

    /* Header */
    .hud-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-primary);
      border-radius: var(--radius-md) var(--radius-md) 0 0;
    }

    .hud-title {
      font-weight: 600;
      color: var(--text-primary);
      font-size: 0.82rem;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .cache-badge {
      font-size: 0.7rem;
      padding: 1px 6px;
      border-radius: 8px;
      font-weight: 600;
    }
    .cache-badge.good {
      background: rgba(126, 231, 135, 0.15);
      color: var(--accent-green);
    }
    .cache-badge.ok {
      background: rgba(210, 153, 34, 0.15);
      color: var(--accent-yellow);
    }
    .cache-badge.low {
      background: rgba(255, 161, 152, 0.15);
      color: var(--accent-red);
    }

    .dismiss-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 0.85rem;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: var(--radius-sm);
    }
    .section-header:focus-visible {
      outline: 1px solid var(--accent-primary);
      outline-offset: -1px;
    }
    .dismiss-btn:hover {
      color: var(--text-primary);
      background: var(--bg-secondary);
    }

    /* Sections */
    .section {
      border-bottom: 1px solid var(--border-primary);
    }
    .section:last-child {
      border-bottom: none;
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      cursor: pointer;
      user-select: none;
      font-weight: 600;
      color: var(--text-secondary);
      font-size: 0.75rem;
    }
    .section-header:hover,
    .section-header:focus-visible {
      background: var(--bg-tertiary);
    }

    .section-toggle {
      font-size: 0.55rem;
      color: var(--text-muted);
      width: 10px;
    }

    .section-body {
      padding: 0 12px 8px;
    }

    .section-body.collapsed {
      display: none;
    }

    /* Tier bars */
    .tier-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 3px 0;
    }

    .tier-label {
      font-family: var(--font-mono);
      font-size: 0.8rem;
      color: var(--text-secondary);
      min-width: 7ch;
      flex-shrink: 0;
    }

    .tier-bar {
      flex: 1;
      height: 8px;
      background: var(--bg-primary);
      border-radius: 4px;
      overflow: hidden;
    }

    .tier-bar-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.3s;
    }
    .tier-bar-fill.l0 { background: var(--accent-green); }
    .tier-bar-fill.l1 { background: #26a69a; }
    .tier-bar-fill.l2 { background: var(--accent-primary); }
    .tier-bar-fill.l3 { background: var(--accent-yellow); }
    .tier-bar-fill.active { background: var(--accent-orange); }

    .tier-tokens {
      font-family: var(--font-mono);
      font-size: 0.8rem;
      color: var(--accent-green);
      min-width: 5ch;
      text-align: right;
      flex-shrink: 0;
    }

    .tier-cached {
      font-size: 0.72rem;
      color: var(--text-muted);
      flex-shrink: 0;
    }

    /* Tier sub-items */
    .tier-sub {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 0 2px 20px;
      font-size: 0.76rem;
      color: var(--text-secondary);
    }
    .tier-sub-icon {
      flex-shrink: 0;
      width: 16px;
      text-align: center;
    }
    .tier-sub-label { flex: 1; }
    .tier-sub-n {
      font-family: var(--font-mono);
      font-size: 0.73rem;
      color: var(--text-secondary);
      flex-shrink: 0;
      min-width: 4ch;
      text-align: right;
    }
    .tier-sub-bar {
      width: 36px;
      height: 4px;
      background: var(--bg-primary);
      border-radius: 2px;
      overflow: hidden;
      flex-shrink: 0;
    }
    .tier-sub-bar-fill {
      height: 100%;
      border-radius: 2px;
    }
    .tier-sub-tokens {
      font-family: var(--font-mono);
      font-size: 0.76rem;
      color: var(--text-secondary);
      flex-shrink: 0;
    }

    /* Stat rows */
    .stat-row {
      display: flex;
      justify-content: space-between;
      padding: 3px 0;
    }

    .stat-label {
      color: var(--text-muted);
    }

    .stat-value {
      font-family: var(--font-mono);
      color: var(--text-primary);
    }

    .stat-value.green { color: var(--accent-green); }
    .stat-value.yellow { color: var(--accent-yellow); }
    .stat-value.red { color: var(--accent-red); }

    /* History budget bar */
    .budget-bar {
      height: 6px;
      background: var(--bg-primary);
      border-radius: 3px;
      overflow: hidden;
      margin: 4px 0;
    }

    .budget-bar-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.3s;
    }
    .budget-bar-fill.green { background: var(--accent-green); }
    .budget-bar-fill.yellow { background: #e5c07b; }
    .budget-bar-fill.red { background: var(--accent-red); }

    /* Tier changes */
    .change-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 0;
      font-size: 0.78rem;
    }
    .change-icon { flex-shrink: 0; }
    .change-text {
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Scrollbar */
    .hud::-webkit-scrollbar {
      width: 4px;
    }
    .hud::-webkit-scrollbar-track {
      background: transparent;
    }
    .hud::-webkit-scrollbar-thumb {
      background: var(--border-primary);
      border-radius: 2px;
    }
  `];

  constructor() {
    super();
    this._visible = false;
    this._fading = false;
    this._data = null;
    this._basicData = null;
    this._collapsed = this._loadCollapsedSections();
    this._hideTimer = null;
    this._fadeTimer = null;
    this._hovered = false;

    this._onStreamComplete = this._onStreamComplete.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('stream-complete', this._onStreamComplete);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('stream-complete', this._onStreamComplete);
    this._clearTimers();
  }

  _onStreamComplete(e) {
    const result = e.detail?.result;
    if (!result || result.error) return;

    // Extract basic data from streamComplete
    this._basicData = result.token_usage || null;
    this._data = null;
    this._visible = true;
    this._fading = false;
    this._startAutoHide();

    // Fetch full breakdown async
    this._fetchBreakdown();
  }

  async _fetchBreakdown() {
    if (!this.rpcConnected) return;
    try {
      const data = await this.rpcExtract('LLMService.get_context_breakdown');
      if (data) {
        this._data = data;
      }
    } catch (e) {
      console.warn('Token HUD: failed to fetch breakdown:', e);
    }
  }

  _startAutoHide() {
    this._clearTimers();
    this._hideTimer = setTimeout(() => {
      if (this._hovered) return;
      this._fading = true;
      this._fadeTimer = setTimeout(() => {
        this._visible = false;
        this._fading = false;
      }, 800);
    }, 8000);
  }

  _clearTimers() {
    if (this._hideTimer) { clearTimeout(this._hideTimer); this._hideTimer = null; }
    if (this._fadeTimer) { clearTimeout(this._fadeTimer); this._fadeTimer = null; }
  }

  _onMouseEnter() {
    this._hovered = true;
    this._fading = false;
    this._clearTimers();
  }

  _onMouseLeave() {
    this._hovered = false;
    this._startAutoHide();
  }

  _dismiss() {
    this._clearTimers();
    this._visible = false;
    this._fading = false;
  }

  _toggleSection(name) {
    const next = new Set(this._collapsed);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    this._collapsed = next;
    this._saveCollapsedSections(next);
  }

  _saveCollapsedSections(sections) {
    try { localStorage.setItem('ac-dc-hud-collapsed', JSON.stringify([...sections])); } catch {}
  }

  _loadCollapsedSections() {
    try {
      const v = localStorage.getItem('ac-dc-hud-collapsed');
      if (v) return new Set(JSON.parse(v));
    } catch {}
    return new Set();
  }

  _isExpanded(name) {
    return !this._collapsed.has(name);
  }

  // === Render helpers ===

  _getCacheBadge(rate) {
    if (rate == null) return nothing;
    const pct = (rate * 100).toFixed(0);
    let cls = 'low';
    if (rate >= 0.5) cls = 'good';
    else if (rate >= 0.2) cls = 'ok';
    return html`<span class="cache-badge ${cls}">${pct}% cache</span>`;
  }

  _getBudgetColor(percent) {
    if (percent > 90) return 'red';
    if (percent > 75) return 'yellow';
    return 'green';
  }

  _renderHeader() {
    const d = this._data;
    const model = d?.model || '—';
    const cacheRate = d?.cache_hit_rate;

    return html`
      <div class="hud-header">
        <span class="hud-title">
          ${model}
          ${this._getCacheBadge(cacheRate)}
        </span>
        <button class="dismiss-btn" @click=${this._dismiss} title="Dismiss" aria-label="Dismiss token usage overlay">✕</button>
      </div>
    `;
  }

  _getSubIcon(type) {
    switch (type) {
      case 'system': return '⚙️';
      case 'symbols': return '📦';
      case 'files': return '📄';
      case 'urls': return '🔗';
      case 'history': return '💬';
      default: return '•';
    }
  }

  _getSubLabel(item) {
    return item.name || item.path || item.type || '—';
  }

  _renderCacheTiers() {
    const d = this._data;
    if (!d?.blocks) return nothing;

    const maxTokens = Math.max(1, ...d.blocks.map(b => b.tokens || 0));

    return html`
      <div class="section">
        <div class="section-header" tabindex="0" role="button"
             aria-expanded="${this._isExpanded('tiers')}"
             @click=${() => this._toggleSection('tiers')}
             @keydown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._toggleSection('tiers'); }}}>
          <span class="section-toggle" aria-hidden="true">${this._isExpanded('tiers') ? '▼' : '▶'}</span>
          Cache Tiers
        </div>
        <div class="section-body ${this._isExpanded('tiers') ? '' : 'collapsed'}">
          ${d.blocks.map(block => {
            const pct = maxTokens > 0 ? (block.tokens / maxTokens) * 100 : 0;
            const tierClass = (block.tier || block.name || 'active').toLowerCase().replace(/[^a-z0-9]/g, '');
            const contents = block.contents || [];
            return html`
              <div class="tier-row">
                <span class="tier-label">${block.name || block.tier || '?'}</span>
                <div class="tier-bar">
                  <div class="tier-bar-fill ${tierClass}" style="width: ${pct}%"></div>
                </div>
                <span class="tier-tokens">${formatTokens(block.tokens)}</span>
                ${block.cached ? html`<span class="tier-cached">🔒</span>` : nothing}
              </div>
              ${contents.map(c => {
                const n = c.n != null ? c.n : null;
                const threshold = c.threshold;
                const barPct = (n != null && threshold) ? Math.min(100, (n / threshold) * 100) : 0;
                const tierColor = {L0:'var(--accent-green)',L1:'#26a69a',L2:'var(--accent-primary)',L3:'var(--accent-yellow)',active:'var(--accent-orange)'}[block.tier || block.name] || 'var(--text-muted)';
                return html`
                <div class="tier-sub">
                  <span class="tier-sub-icon">${this._getSubIcon(c.type)}</span>
                  <span class="tier-sub-label">${this._getSubLabel(c)}</span>
                  ${n != null ? html`
                    <span class="tier-sub-n" title="N=${n}/${threshold || '?'}">${n}/${threshold || '?'}</span>
                    <div class="tier-sub-bar" title="N=${n}/${threshold || '?'}">
                      <div class="tier-sub-bar-fill" style="width: ${barPct}%; background: ${tierColor}"></div>
                    </div>
                  ` : nothing}
                  <span class="tier-sub-tokens">${formatTokens(c.tokens)}</span>
                </div>
              `;})}
            `;
          })}
        </div>
      </div>
    `;
  }

  _renderThisRequest() {
    const usage = this._basicData || this._data?.token_usage;
    if (!usage) return nothing;

    const prompt = usage.input_tokens || usage.prompt_tokens || 0;
    const completion = usage.output_tokens || usage.completion_tokens || 0;
    const cacheRead = usage.cache_read_tokens || usage.cache_read_input_tokens || 0;
    const cacheWrite = usage.cache_write_tokens || usage.cache_creation_input_tokens || 0;

    return html`
      <div class="section">
        <div class="section-header" tabindex="0" role="button"
             aria-expanded="${this._isExpanded('request')}"
             @click=${() => this._toggleSection('request')}
             @keydown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._toggleSection('request'); }}}>
          <span class="section-toggle" aria-hidden="true">${this._isExpanded('request') ? '▼' : '▶'}</span>
          This Request
        </div>
        <div class="section-body ${this._isExpanded('request') ? '' : 'collapsed'}">
          <div class="stat-row">
            <span class="stat-label">Prompt</span>
            <span class="stat-value">${formatTokens(prompt)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Completion</span>
            <span class="stat-value">${formatTokens(completion)}</span>
          </div>
          ${cacheRead > 0 ? html`
            <div class="stat-row">
              <span class="stat-label">Cache Read</span>
              <span class="stat-value green">${formatTokens(cacheRead)}</span>
            </div>
          ` : nothing}
          ${cacheWrite > 0 ? html`
            <div class="stat-row">
              <span class="stat-label">Cache Write</span>
              <span class="stat-value yellow">${formatTokens(cacheWrite)}</span>
            </div>
          ` : nothing}
        </div>
      </div>
    `;
  }

  _renderHistoryBudget() {
    const d = this._data;
    if (!d) return nothing;

    const breakdown = d.breakdown;
    if (!breakdown) return nothing;

    const historyTokens = breakdown.history || 0;
    const totalTokens = d.total_tokens || 0;
    const maxTokens = d.max_input_tokens || 1;
    const percent = Math.min(100, (totalTokens / maxTokens) * 100);
    const color = this._getBudgetColor(percent);

    return html`
      <div class="section">
        <div class="section-header" tabindex="0" role="button"
             aria-expanded="${this._isExpanded('budget')}"
             @click=${() => this._toggleSection('budget')}
             @keydown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._toggleSection('budget'); }}}>
          <span class="section-toggle" aria-hidden="true">${this._isExpanded('budget') ? '▼' : '▶'}</span>
          History Budget
        </div>
        <div class="section-body ${this._isExpanded('budget') ? '' : 'collapsed'}">
          <div class="stat-row">
            <span class="stat-label">Total</span>
            <span class="stat-value">${formatTokens(totalTokens)} / ${formatTokens(maxTokens)}</span>
          </div>
          <div class="budget-bar">
            <div class="budget-bar-fill ${color}" style="width: ${percent}%"></div>
          </div>
          <div class="stat-row">
            <span class="stat-label">History</span>
            <span class="stat-value">${formatTokens(historyTokens)}</span>
          </div>
        </div>
      </div>
    `;
  }

  _renderTierChanges() {
    const d = this._data;
    const promotions = d?.promotions;
    const demotions = d?.demotions;
    if (!promotions?.length && !demotions?.length) return nothing;

    return html`
      <div class="section">
        <div class="section-header" tabindex="0" role="button"
             aria-expanded="${this._isExpanded('changes')}"
             @click=${() => this._toggleSection('changes')}
             @keydown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._toggleSection('changes'); }}}>
          <span class="section-toggle" aria-hidden="true">${this._isExpanded('changes') ? '▼' : '▶'}</span>
          Tier Changes
        </div>
        <div class="section-body ${this._isExpanded('changes') ? '' : 'collapsed'}">
          ${(promotions || []).map(p => html`
            <div class="change-item">
              <span class="change-icon">📈</span>
              <span class="change-text" title="${p}">${p}</span>
            </div>
          `)}
          ${(demotions || []).map(dem => html`
            <div class="change-item">
              <span class="change-icon">📉</span>
              <span class="change-text" title="${dem}">${dem}</span>
            </div>
          `)}
        </div>
      </div>
    `;
  }

  _renderSessionTotals() {
    const s = this._data?.session_totals;
    if (!s) return nothing;

    return html`
      <div class="section">
        <div class="section-header" tabindex="0" role="button"
             aria-expanded="${this._isExpanded('session')}"
             @click=${() => this._toggleSection('session')}
             @keydown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._toggleSection('session'); }}}>
          <span class="section-toggle" aria-hidden="true">${this._isExpanded('session') ? '▼' : '▶'}</span>
          Session Totals
        </div>
        <div class="section-body ${this._isExpanded('session') ? '' : 'collapsed'}">
          <div class="stat-row">
            <span class="stat-label">Prompt In</span>
            <span class="stat-value">${formatTokens(s.prompt)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Completion Out</span>
            <span class="stat-value">${formatTokens(s.completion)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Total</span>
            <span class="stat-value">${formatTokens(s.total)}</span>
          </div>
          ${s.cache_hit > 0 ? html`
            <div class="stat-row">
              <span class="stat-label">Cache Saved</span>
              <span class="stat-value green">${formatTokens(s.cache_hit)}</span>
            </div>
          ` : nothing}
          ${s.cache_write > 0 ? html`
            <div class="stat-row">
              <span class="stat-label">Cache Written</span>
              <span class="stat-value yellow">${formatTokens(s.cache_write)}</span>
            </div>
          ` : nothing}
        </div>
      </div>
    `;
  }

  render() {
    if (!this._visible) return nothing;

    return html`
      <div class="hud ${this._fading ? 'fading' : ''}"
        @mouseenter=${this._onMouseEnter}
        @mouseleave=${this._onMouseLeave}
      >
        ${this._renderHeader()}
        ${this._renderCacheTiers()}
        ${this._renderThisRequest()}
        ${this._renderHistoryBudget()}
        ${this._renderTierChanges()}
        ${this._renderSessionTotals()}
      </div>
    `;
  }
}

customElements.define('ac-token-hud', AcTokenHud);