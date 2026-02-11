import { LitElement, html, css, nothing } from 'lit';

/**
 * Token HUD — floating overlay showing token usage after each LLM response.
 * Auto-hides after a timeout. Click to dismiss early.
 */
class TokenHud extends LitElement {
  static properties = {
    _visible: { type: Boolean, state: true },
    _data: { type: Object, state: true },
    _fading: { type: Boolean, state: true },
  };

  static styles = css`
    :host {
      position: absolute;
      bottom: 80px;
      right: 16px;
      z-index: 50;
      pointer-events: none;
    }

    .hud {
      pointer-events: auto;
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 8px 12px;
      box-shadow: var(--shadow-md);
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-secondary);
      cursor: pointer;
      user-select: none;
      opacity: 1;
      transition: opacity 0.6s ease;
      min-width: 200px;
    }

    .hud.fading {
      opacity: 0;
    }

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

    .hud-value.cache-hit {
      color: var(--accent-success);
    }

    .hud-value.cache-write {
      color: var(--accent-primary);
    }

    .hud-divider {
      border-top: 1px solid var(--border-color);
      margin: 3px 0;
    }

    .hud-title {
      font-size: 10px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }
  `;

  constructor() {
    super();
    this._visible = false;
    this._data = null;
    this._fading = false;
    this._hideTimer = null;
    this._fadeTimer = null;
  }

  /**
   * Show the HUD with token usage data.
   * @param {{ token_usage: Object, session_totals?: Object }} result
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

    // Clear existing timers
    clearTimeout(this._hideTimer);
    clearTimeout(this._fadeTimer);

    // Start fade after 4 seconds
    this._fadeTimer = setTimeout(() => {
      this._fading = true;
    }, 4000);

    // Remove after fade completes
    this._hideTimer = setTimeout(() => {
      this._visible = false;
      this._fading = false;
    }, 4600);
  }

  _dismiss() {
    clearTimeout(this._hideTimer);
    clearTimeout(this._fadeTimer);
    this._visible = false;
    this._fading = false;
  }

  _fmt(n) {
    if (n == null || n === 0) return '0';
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  }

  render() {
    if (!this._visible || !this._data) return nothing;

    const d = this._data;
    const cacheHitPct = d.prompt > 0
      ? Math.round((d.cacheRead / d.prompt) * 100)
      : 0;

    return html`
      <div class="hud ${this._fading ? 'fading' : ''}" @click=${this._dismiss}
        role="status" aria-label="Token usage summary">
        <div class="hud-title">Token Usage</div>
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
            <span class="hud-label">Cache hit</span>
            <span class="hud-value cache-hit">${this._fmt(d.cacheRead)} (${cacheHitPct}%)</span>
          </div>
        ` : nothing}
        ${d.cacheWrite > 0 ? html`
          <div class="hud-row">
            <span class="hud-label">Cache write</span>
            <span class="hud-value cache-write">${this._fmt(d.cacheWrite)}</span>
          </div>
        ` : nothing}
        <div class="hud-divider"></div>
        <div class="hud-row">
          <span class="hud-label">Total</span>
          <span class="hud-value">${this._fmt(d.total)}</span>
        </div>
      </div>
    `;
  }
}

customElements.define('token-hud', TokenHud);