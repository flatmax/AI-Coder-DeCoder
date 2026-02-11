import { LitElement, html, css, nothing } from 'lit';
import { RpcMixin } from '../rpc-mixin.js';

/**
 * Token HUD — floating overlay in the top-right of the diff viewer background.
 * Shows full context breakdown: cache tiers, this-request stats, history budget,
 * tier promotions/demotions, and session cumulative totals.
 * Auto-hides after ~8 seconds, pauses on hover.
 */
class TokenHud extends RpcMixin(LitElement) {
  static properties = {
    _visible: { type: Boolean, state: true },
    _data: { type: Object, state: true },
    _breakdown: { type: Object, state: true },
    _fading: { type: Boolean, state: true },
    _hovered: { type: Boolean, state: true },
    _collapsed: { type: Object, state: true },
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
      background: rgba(30, 30, 30, 0.92);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 10px 14px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.5);
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-secondary);
      user-select: none;
      opacity: 1;
      transition: opacity 0.8s ease;
      min-width: 260px;
      max-width: 340px;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }

    .hud.fading {
      opacity: 0;
    }

    /* ── Header with cache badge ── */
    .hud-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
    }

    .hud-title {
      font-size: 10px;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.8px;
    }

    .cache-badge {
      font-size: 10px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 3px;
      color: white;
    }
    .cache-badge.excellent { background: #2e7d32; }
    .cache-badge.good { background: #558b2f; }
    .cache-badge.fair { background: #f9a825; color: #000; }
    .cache-badge.poor { background: #e65100; }
    .cache-badge.none { background: var(--text-muted); }

    .dismiss-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 12px;
      padding: 0 2px;
      line-height: 1;
      margin-left: 6px;
    }
    .dismiss-btn:hover { color: var(--text-primary); }

    /* ── Section ── */
    .section {
      margin-top: 6px;
    }

    .section-header {
      font-size: 9px;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.6px;
      padding-bottom: 2px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .section-header:hover { color: var(--text-secondary); }

    .section-toggle {
      font-size: 8px;
      transition: transform 0.15s ease;
    }
    .section-toggle.collapsed { transform: rotate(-90deg); }

    /* ── Tier blocks ── */
    .tier-block {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 0;
    }

    .tier-name {
      color: var(--text-muted);
      min-width: 52px;
      font-size: 10px;
    }

    .tier-bar-track {
      flex: 1;
      height: 6px;
      background: rgba(255,255,255,0.06);
      border-radius: 3px;
      overflow: hidden;
      position: relative;
    }

    .tier-bar-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.4s ease;
    }
    .tier-bar-fill.cached { background: var(--accent-success); opacity: 0.7; }
    .tier-bar-fill.active { background: var(--accent-warning); opacity: 0.7; }

    .tier-tokens {
      font-size: 10px;
      color: var(--text-muted);
      min-width: 36px;
      text-align: right;
    }

    .tier-detail {
      padding-left: 58px;
      font-size: 10px;
      color: var(--text-muted);
      opacity: 0.7;
    }

    /* ── Rows ── */
    .hud-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 1px 0;
    }

    .hud-label {
      color: var(--text-muted);
    }

    .hud-value {
      color: var(--text-primary);
      text-align: right;
    }

    .hud-value.success { color: var(--accent-success); }
    .hud-value.warning { color: var(--accent-warning); }
    .hud-value.error { color: var(--accent-error); }
    .hud-value.info { color: var(--accent-primary); }

    .hud-divider {
      border-top: 1px solid rgba(255,255,255,0.08);
      margin: 5px 0;
    }

    /* ── Changes ── */
    .change-row {
      font-size: 10px;
      padding: 1px 0;
      display: flex;
      gap: 4px;
    }
    .change-row.promotion { color: var(--accent-success); }
    .change-row.demotion { color: var(--accent-warning); }

    .change-icon { font-size: 10px; }

    .change-key {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .change-tiers {
      color: var(--text-muted);
      flex-shrink: 0;
    }

    /* ── History bar ── */
    .history-bar {
      margin-top: 2px;
    }

    .history-track {
      height: 4px;
      background: rgba(255,255,255,0.06);
      border-radius: 2px;
      overflow: hidden;
    }

    .history-fill {
      height: 100%;
      border-radius: 2px;
      transition: width 0.4s ease;
    }
    .history-fill.ok { background: var(--accent-success); }
    .history-fill.warn { background: var(--accent-warning); }
    .history-fill.danger { background: var(--accent-error); }
  `;

  constructor() {
    super();
    this._visible = false;
    this._data = null;
    this._breakdown = null;
    this._fading = false;
    this._hovered = false;
    this._collapsed = new Set();
    this._hideTimer = null;
    this._fadeTimer = null;
  }

  /**
   * Show the HUD with token usage data from stream-complete result.
   * Fetches full context breakdown via RPC.
   * @param {{ token_usage: Object }} result
   */
  show(result) {
    const usage = result.token_usage || {};
    if (!usage.total_tokens && !usage.prompt_tokens) return;

    this._data = {
      prompt: usage.prompt_tokens || 0,
      completion: usage.completion_tokens || 0,
      cacheRead: usage.cache_read_tokens || 0,
      cacheWrite: usage.cache_creation_tokens || 0,
      total: usage.total_tokens || 0,
    };

    this._visible = true;
    this._fading = false;
    this._hovered = false;

    // Clear existing timers
    this._clearTimers();
    this._startAutoHide();

    // Fetch full breakdown
    this._fetchBreakdown();
  }

  async _fetchBreakdown() {
    if (!this.rpcConnected) return;
    try {
      const bd = await this.rpcExtract('LLM.get_context_breakdown');
      if (bd && !bd.error) {
        this._breakdown = bd;
      }
    } catch (e) {
      // Breakdown is optional enhancement — don't fail the HUD
      console.debug('[token-hud] Breakdown fetch failed:', e);
    }
  }

  _startAutoHide() {
    this._fadeTimer = setTimeout(() => {
      if (!this._hovered) {
        this._fading = true;
        this._hideTimer = setTimeout(() => {
          this._visible = false;
          this._fading = false;
        }, 800);
      }
    }, 8000);
  }

  _clearTimers() {
    clearTimeout(this._hideTimer);
    clearTimeout(this._fadeTimer);
    this._hideTimer = null;
    this._fadeTimer = null;
  }

  _onMouseEnter() {
    this._hovered = true;
    // Pause auto-hide
    if (this._fading) {
      this._fading = false;
      this._clearTimers();
    } else {
      this._clearTimers();
    }
  }

  _onMouseLeave() {
    this._hovered = false;
    // Restart auto-hide (shorter delay after hover)
    this._clearTimers();
    this._startAutoHide();
  }

  _dismiss() {
    this._clearTimers();
    this._visible = false;
    this._fading = false;
  }

  _toggleSection(name) {
    const next = new Set(this._collapsed);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    this._collapsed = next;
  }

  _fmt(n) {
    if (n == null || n === 0) return '0';
    if (n >= 100000) return `${(n / 1000).toFixed(0)}k`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  }

  _pct(part, total) {
    if (!total || !part) return 0;
    return Math.round((part / total) * 100);
  }

  _cacheClass(pct) {
    if (pct >= 80) return 'excellent';
    if (pct >= 60) return 'good';
    if (pct >= 30) return 'fair';
    if (pct > 0) return 'poor';
    return 'none';
  }

  _stripPrefix(key) {
    if (key.startsWith('symbol:') || key.startsWith('file:') || key.startsWith('history:')) {
      return key.substring(key.indexOf(':') + 1);
    }
    return key;
  }

  render() {
    if (!this._visible || !this._data) return nothing;

    const d = this._data;
    const bd = this._breakdown;
    const cacheHitPct = this._pct(d.cacheRead, d.prompt);

    return html`
      <div class="hud ${this._fading ? 'fading' : ''}"
        @mouseenter=${this._onMouseEnter}
        @mouseleave=${this._onMouseLeave}
        role="status" aria-label="Token usage summary">

        <!-- Header -->
        <div class="hud-header">
          <span class="hud-title">${bd?.model || 'Token Usage'}</span>
          <span>
            <span class="cache-badge ${this._cacheClass(cacheHitPct)}">
              ${cacheHitPct}% cache
            </span>
            <button class="dismiss-btn" @click=${this._dismiss} title="Dismiss" aria-label="Dismiss">✕</button>
          </span>
        </div>

        <!-- Cache Tiers -->
        ${bd?.blocks?.length ? html`
          ${this._renderTiers(bd.blocks, bd.max_input_tokens)}
        ` : nothing}

        <div class="hud-divider"></div>

        <!-- This Request -->
        ${this._renderSection('request', 'This Request', html`
          <div class="hud-row">
            <span class="hud-label">Prompt</span>
            <span class="hud-value">${this._fmt(d.prompt)}</span>
          </div>
          <div class="hud-row">
            <span class="hud-label">Completion</span>
            <span class="hud-value">${this._fmt(d.completion)}</span>
          </div>
          ${d.cacheRead > 0 ? html`
            <div class="hud-row">
              <span class="hud-label">Cache read</span>
              <span class="hud-value success">${this._fmt(d.cacheRead)}</span>
            </div>
          ` : nothing}
          ${d.cacheWrite > 0 ? html`
            <div class="hud-row">
              <span class="hud-label">Cache write</span>
              <span class="hud-value info">${this._fmt(d.cacheWrite)}</span>
            </div>
          ` : nothing}
        `)}

        <!-- History Budget -->
        ${bd?.breakdown?.history ? this._renderHistoryBudget(bd.breakdown.history) : nothing}

        <!-- Tier Changes -->
        ${(bd?.promotions?.length || bd?.demotions?.length)
          ? this._renderChanges(bd.promotions, bd.demotions)
          : nothing}

        <!-- Session Totals -->
        ${bd?.session_totals ? html`
          <div class="hud-divider"></div>
          ${this._renderSection('session', 'Session Totals', html`
            <div class="hud-row">
              <span class="hud-label">Total tokens</span>
              <span class="hud-value">${this._fmt(bd.session_totals.total)}</span>
            </div>
            <div class="hud-row">
              <span class="hud-label">Cache saved</span>
              <span class="hud-value success">${this._fmt(bd.session_totals.cache_hit)}</span>
            </div>
          `)}
        ` : nothing}
      </div>
    `;
  }

  _renderSection(id, title, content) {
    const isCollapsed = this._collapsed.has(id);
    return html`
      <div class="section">
        <div class="section-header" @click=${() => this._toggleSection(id)}>
          <span class="section-toggle ${isCollapsed ? 'collapsed' : ''}">▼</span>
          ${title}
        </div>
        ${isCollapsed ? nothing : content}
      </div>
    `;
  }

  _renderTiers(blocks, maxTokens) {
    const totalTokens = blocks.reduce((s, b) => s + (b.tokens || 0), 0);
    const barMax = maxTokens || totalTokens || 1;

    return html`
      <div class="section">
        <div class="section-header" @click=${() => this._toggleSection('tiers')}>
          <span class="section-toggle ${this._collapsed.has('tiers') ? 'collapsed' : ''}">▼</span>
          Cache Tiers
          <span style="margin-left:auto; font-weight:400; font-size:10px; color:var(--text-muted)">
            ${this._fmt(totalTokens)} total
          </span>
        </div>
        ${this._collapsed.has('tiers') ? nothing : html`
          ${blocks.map(block => html`
            <div class="tier-block">
              <span class="tier-name">${block.name}</span>
              <div class="tier-bar-track">
                <div class="tier-bar-fill ${block.cached ? 'cached' : 'active'}"
                  style="width: ${Math.max(1, this._pct(block.tokens, barMax))}%">
                </div>
              </div>
              <span class="tier-tokens">${this._fmt(block.tokens)}</span>
            </div>
            ${block.contents?.length ? block.contents.map(c => html`
              <div class="tier-detail">
                ${c.type === 'system' ? '⚙ system' :
                  c.type === 'symbols' ? `◆ ${c.count} symbols` :
                  c.type === 'files' ? `📄 ${c.count} files` :
                  c.type === 'history' ? `💬 ${c.count} msgs` : c.type}
                (${this._fmt(c.tokens)})
              </div>
            `) : nothing}
          `)}
        `}
      </div>
    `;
  }

  _renderHistoryBudget(history) {
    const pct = history.max_tokens
      ? Math.min(100, Math.round((history.tokens / history.max_tokens) * 100))
      : 0;
    const barClass = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok';
    const needsSummary = history.needs_summary;

    return html`
      <div class="section">
        <div class="section-header" @click=${() => this._toggleSection('history')}>
          <span class="section-toggle ${this._collapsed.has('history') ? 'collapsed' : ''}">▼</span>
          History Budget
          ${needsSummary ? html`<span style="color:var(--accent-warning);font-size:9px;margin-left:4px">● compact</span>` : nothing}
        </div>
        ${this._collapsed.has('history') ? nothing : html`
          <div class="hud-row">
            <span class="hud-label">${this._fmt(history.tokens)} / ${this._fmt(history.max_tokens)}</span>
            <span class="hud-value ${barClass === 'danger' ? 'error' : barClass === 'warn' ? 'warning' : ''}">${pct}%</span>
          </div>
          <div class="history-bar">
            <div class="history-track">
              <div class="history-fill ${barClass}" style="width: ${pct}%"></div>
            </div>
          </div>
        `}
      </div>
    `;
  }

  _renderChanges(promotions = [], demotions = []) {
    const total = promotions.length + demotions.length;
    if (!total) return nothing;

    return html`
      <div class="section">
        <div class="section-header" @click=${() => this._toggleSection('changes')}>
          <span class="section-toggle ${this._collapsed.has('changes') ? 'collapsed' : ''}">▼</span>
          Tier Changes (${total})
        </div>
        ${this._collapsed.has('changes') ? nothing : html`
          ${promotions.map(p => html`
            <div class="change-row promotion">
              <span class="change-icon">📈</span>
              <span class="change-key" title=${p.key}>${this._stripPrefix(p.key)}</span>
              <span class="change-tiers">${p.from}→${p.to}</span>
            </div>
          `)}
          ${demotions.map(d => html`
            <div class="change-row demotion">
              <span class="change-icon">📉</span>
              <span class="change-key" title=${d.key}>${this._stripPrefix(d.key)}</span>
              <span class="change-tiers">${d.from}→${d.to}</span>
            </div>
          `)}
        `}
      </div>
    `;
  }
}

customElements.define('token-hud', TokenHud);