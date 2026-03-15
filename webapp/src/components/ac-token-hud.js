/**
 * AcTokenHud — floating overlay on the diff viewer background,
 * appearing after each LLM response with token usage and cache tier data.
 *
 * Placement: fixed top-right. Auto-hides after 8s with fade.
 * Hover pauses auto-hide. Sections are collapsible.
 */

import { LitElement, html, css } from 'lit';
import { RpcMixin } from '../utils/rpc-mixin.js';
import { formatTokens, loadBool, saveBool } from '../utils/helpers.js';

const TIER_COLORS = {
  L0: '#50c878',
  L1: '#2dd4bf',
  L2: '#60a5fa',
  L3: '#f59e0b',
  active: '#f97316',
};

export class AcTokenHud extends RpcMixin(LitElement) {
  static properties = {
    _visible: { type: Boolean, state: true },
    _fading: { type: Boolean, state: true },
    _collapsed: { type: Boolean, state: true },
    _usage: { type: Object, state: true },
    _breakdown: { type: Object, state: true },
    _sections: { type: Object, state: true },
  };

  static styles = css`
    :host {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 10000;
      pointer-events: none;
    }

    .hud {
      pointer-events: auto;
      width: 320px;
      max-height: 80vh;
      overflow-y: auto;
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: 10px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      font-size: 0.78rem;
      transition: opacity 0.8s ease;
    }
    .hud.fade-out { opacity: 0; }
    .hud.hidden { display: none; }

    /* Header */
    .hud-header {
      display: flex;
      align-items: center;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border-primary);
      gap: 6px;
    }
    .hud-model {
      flex: 1;
      font-weight: 600;
      color: var(--text-primary);
      font-size: 0.72rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;
    }
    .cache-badge {
      font-size: 0.68rem;
      padding: 1px 6px;
      border-radius: 8px;
      font-weight: 600;
    }
    .cache-badge.good { background: rgba(126,231,135,0.15); color: var(--accent-green); }
    .cache-badge.mid { background: rgba(245,158,11,0.15); color: var(--accent-orange); }
    .cache-badge.low { background: rgba(249,117,131,0.15); color: var(--accent-red); }
    .dismiss-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-muted);
      font-size: 0.85rem;
      padding: 0 2px;
    }
    .dismiss-btn:hover { color: var(--text-primary); }

    /* Section */
    .section {
      border-bottom: 1px solid var(--border-secondary);
    }
    .section:last-child { border-bottom: none; }
    .section-header {
      display: flex;
      align-items: center;
      padding: 6px 12px;
      cursor: pointer;
      gap: 4px;
      color: var(--text-secondary);
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .section-header:hover { background: var(--bg-tertiary); }
    .section-toggle { width: 12px; font-size: 0.6rem; color: var(--text-muted); }
    .section-body { padding: 0 12px 8px; }

    /* Tier bars */
    .tier-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 0;
    }
    .tier-name {
      min-width: 44px;
      font-weight: 600;
      font-size: 0.72rem;
    }
    .tier-bar-track {
      flex: 1;
      height: 6px;
      background: var(--bg-input);
      border-radius: 3px;
      overflow: hidden;
    }
    .tier-bar-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.3s;
    }
    .tier-tokens {
      min-width: 40px;
      text-align: right;
      font-family: monospace;
      font-size: 0.7rem;
      color: var(--accent-green);
    }
    .tier-lock { font-size: 0.6rem; width: 14px; text-align: center; }

    /* Request info */
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 1px 0;
      color: var(--text-secondary);
      font-size: 0.72rem;
    }
    .info-value {
      font-family: monospace;
      color: var(--text-primary);
    }
    .info-value.green { color: var(--accent-green); }
    .info-value.yellow { color: var(--accent-orange); }

    /* Budget bar */
    .budget-track {
      height: 5px;
      background: var(--bg-input);
      border-radius: 3px;
      overflow: hidden;
      margin: 4px 0;
    }
    .budget-fill {
      height: 100%;
      border-radius: 3px;
    }
    .budget-fill.green { background: var(--accent-green); }
    .budget-fill.yellow { background: var(--accent-orange); }
    .budget-fill.red { background: var(--accent-red); }

    /* Changes */
    .change-line {
      font-size: 0.7rem;
      padding: 1px 0;
      color: var(--text-secondary);
    }
  `;

  constructor() {
    super();
    this._visible = false;
    this._fading = false;
    this._collapsed = loadBool('ac-dc-hud-collapsed', false);
    this._usage = null;
    this._breakdown = null;
    this._sections = {
      tiers: true,
      request: true,
      budget: true,
      changes: true,
      session: false,
    };
    this._autoHideTimer = null;
    this._fadeTimer = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._handler = this._onStreamComplete.bind(this);
    window.addEventListener('stream-complete', this._handler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('stream-complete', this._handler);
    this._clearTimers();
  }

  _onStreamComplete(e) {
    const { result } = e.detail || {};
    if (!result || result.error) return;

    this._usage = result.token_usage || {};
    this._visible = true;
    this._fading = false;

    // Fetch full breakdown
    if (this.rpcConnected) {
      this.rpcExtract('LLMService.get_context_breakdown').then(data => {
        this._breakdown = data;
      }).catch(() => {});
    }

    this._startAutoHide();
  }

  _startAutoHide() {
    this._clearTimers();
    this._autoHideTimer = setTimeout(() => {
      this._fading = true;
      this._fadeTimer = setTimeout(() => {
        this._visible = false;
        this._fading = false;
      }, 800);
    }, 8000);
  }

  _clearTimers() {
    if (this._autoHideTimer) { clearTimeout(this._autoHideTimer); this._autoHideTimer = null; }
    if (this._fadeTimer) { clearTimeout(this._fadeTimer); this._fadeTimer = null; }
  }

  _onMouseEnter() {
    this._clearTimers();
    this._fading = false;
  }

  _onMouseLeave() {
    this._startAutoHide();
  }

  _dismiss() {
    this._clearTimers();
    this._visible = false;
    this._fading = false;
  }

  _toggleCollapsed() {
    this._collapsed = !this._collapsed;
    saveBool('ac-dc-hud-collapsed', this._collapsed);
  }

  _toggleSection(key) {
    this._sections = { ...this._sections, [key]: !this._sections[key] };
  }

  _fmt(n) {
    if (n == null) return '0';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  render() {
    if (!this._visible) return '';

    const bd = this._breakdown || {};
    const u = this._usage || {};
    const blocks = bd.blocks || [];
    const maxTierTokens = Math.max(...blocks.map(b => b.tokens || 0), 1);
    const hitRate = ((bd.cache_hit_rate || 0) * 100).toFixed(0);
    const hitClass = hitRate >= 50 ? 'good' : hitRate >= 20 ? 'mid' : 'low';

    const promotions = bd.promotions || [];
    const demotions = bd.demotions || [];
    const changes = [...promotions, ...demotions];
    const st = bd.session_totals || {};

    const maxInput = bd.max_input_tokens || 200000;
    const totalTokens = bd.total_tokens || 0;
    const budgetPct = Math.min(100, (totalTokens / maxInput) * 100);
    const budgetColor = budgetPct > 90 ? 'red' : budgetPct > 75 ? 'yellow' : 'green';

    return html`
      <div class="hud ${this._fading ? 'fade-out' : ''}"
           @mouseenter=${this._onMouseEnter}
           @mouseleave=${this._onMouseLeave}>

        <!-- Header -->
        <div class="hud-header">
          <span class="hud-model" @click=${this._toggleCollapsed}>${bd.model || ''}</span>
          <span class="cache-badge ${hitClass}">${hitRate}% hit</span>
          <button class="dismiss-btn" @click=${this._dismiss}>✕</button>
        </div>

        ${this._collapsed ? '' : html`
        <!-- Cache Tiers -->
        ${this._renderSection('tiers', 'Cache Tiers', () => html`
          ${blocks.map(b => {
            const color = TIER_COLORS[b.tier] || TIER_COLORS.active;
            const pct = (b.tokens / maxTierTokens) * 100;
            return html`
              <div class="tier-row">
                <span class="tier-name" style="color:${color}">${b.tier}</span>
                <div class="tier-bar-track">
                  <div class="tier-bar-fill" style="width:${pct}%;background:${color}"></div>
                </div>
                <span class="tier-tokens">${this._fmt(b.tokens)}</span>
                <span class="tier-lock">${b.cached ? '🔒' : ''}</span>
              </div>
            `;
          })}
        `)}

        <!-- This Request -->
        ${this._renderSection('request', 'This Request', () => html`
          <div class="info-row">
            <span>Prompt</span>
            <span class="info-value">${formatTokens(u.prompt_tokens)}</span>
          </div>
          <div class="info-row">
            <span>Completion</span>
            <span class="info-value">${formatTokens(u.completion_tokens)}</span>
          </div>
          ${u.cache_read_tokens ? html`
            <div class="info-row">
              <span>Cache read</span>
              <span class="info-value green">${formatTokens(u.cache_read_tokens)}</span>
            </div>
          ` : ''}
          ${u.cache_write_tokens ? html`
            <div class="info-row">
              <span>Cache write</span>
              <span class="info-value yellow">${formatTokens(u.cache_write_tokens)}</span>
            </div>
          ` : ''}
        `)}

        <!-- History Budget -->
        ${this._renderSection('budget', 'History Budget', () => html`
          <div class="info-row">
            <span>Total</span>
            <span class="info-value">${formatTokens(totalTokens)} / ${formatTokens(maxInput)}</span>
          </div>
          <div class="budget-track">
            <div class="budget-fill ${budgetColor}" style="width:${budgetPct}%"></div>
          </div>
          ${bd.breakdown?.history ? html`
            <div class="info-row">
              <span>History</span>
              <span class="info-value">${formatTokens(bd.breakdown.history)}</span>
            </div>
          ` : ''}
        `)}

        <!-- Tier Changes -->
        ${changes.length ? this._renderSection('changes', 'Tier Changes', () => html`
          ${changes.map(c => html`<div class="change-line">${c}</div>`)}
        `) : ''}

        <!-- Session Totals -->
        ${this._renderSection('session', 'Session Totals', () => html`
          <div class="info-row">
            <span>Prompt in</span>
            <span class="info-value">${formatTokens(st.prompt)}</span>
          </div>
          <div class="info-row">
            <span>Completion out</span>
            <span class="info-value">${formatTokens(st.completion)}</span>
          </div>
          <div class="info-row">
            <span>Total</span>
            <span class="info-value">${formatTokens(st.total)}</span>
          </div>
          ${st.cache_hit ? html`
            <div class="info-row">
              <span>Cache saved</span>
              <span class="info-value green">${formatTokens(st.cache_hit)}</span>
            </div>
          ` : ''}
          ${st.cache_write ? html`
            <div class="info-row">
              <span>Cache written</span>
              <span class="info-value yellow">${formatTokens(st.cache_write)}</span>
            </div>
          ` : ''}
        `)}
        `}
      </div>
    `;
  }

  _renderSection(key, label, contentFn) {
    const open = this._sections[key];
    return html`
      <div class="section">
        <div class="section-header" @click=${() => this._toggleSection(key)}>
          <span class="section-toggle">${open ? '▼' : '▶'}</span>
          <span>${label}</span>
        </div>
        ${open ? html`<div class="section-body">${contentFn()}</div>` : ''}
      </div>
    `;
  }
}

customElements.define('ac-token-hud', AcTokenHud);