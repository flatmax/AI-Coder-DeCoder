// CacheWarmupProgress — floating overlay during the
// cache-warmer's visible countdown and firing window.
//
// The cache warmer (src/ac_dc/llm/_cache_warmer.py)
// sleeps most of its idle interval silently, then
// surfaces a 30-second countdown before issuing the
// actual warm-up call. This component renders that
// countdown as a progress bar — same UX shape as the
// retry banner — so the user sees the warm-up coming
// and can interrupt by sending a real message.
//
// State machine:
//
//   idle      — no event yet, or last event was complete/cancelled
//   counting  — receiving cacheWarmupCountdown ticks; bar fills
//   firing    — countdown landed, warm-up call in flight
//   success   — brief flash of "Cache refreshed"
//   error     — brief flash with error reason
//
// Auto-dismisses after success/error; stays open
// during counting/firing.
//
// Governing spec: cache_warmup section of app.json.

import { LitElement, css, html } from 'lit';

/** How long the success/error flash stays visible. */
const _FLASH_MS = 1500;

/** Fade-out duration. Matches the CSS transition. */
const _FADE_MS = 400;

export class CacheWarmupProgress extends LitElement {
  static properties = {
    _state: { type: String, state: true },
    /** Seconds remaining on the countdown. */
    _remaining: { type: Number, state: true },
    /** Total countdown seconds (denominator for the bar). */
    _total: { type: Number, state: true },
    /** Caption shown in success/error states. */
    _caption: { type: String, state: true },
    /** True while CSS fade-out transition is running. */
    _fading: { type: Boolean, state: true },
  };

  static styles = css`
    :host {
      position: fixed;
      bottom: 1rem;
      left: 50%;
      transform: translateX(-50%);
      z-index: 500;
      pointer-events: none;
    }

    .overlay {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      min-width: 280px;
      background: rgba(22, 27, 34, 0.96);
      border: 1px solid rgba(240, 246, 252, 0.18);
      border-left: 3px solid var(--accent-primary, #58a6ff);
      border-radius: 6px;
      padding: 0.6rem 1rem;
      font-size: 0.875rem;
      color: var(--text-primary, #c9d1d9);
      backdrop-filter: blur(8px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      opacity: 1;
      transition: opacity ${_FADE_MS}ms ease-out;
    }

    .overlay.fading { opacity: 0; }
    .overlay.success { border-left-color: #7ee787; }
    .overlay.error { border-left-color: #f85149; }

    .row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .glyph {
      font-size: 1rem;
      line-height: 1;
      flex-shrink: 0;
    }

    .label { flex: 1; white-space: nowrap; }

    .countdown {
      font-variant-numeric: tabular-nums;
      opacity: 0.75;
      font-size: 0.8125rem;
      flex-shrink: 0;
    }

    .bar-track {
      height: 4px;
      background: rgba(240, 246, 252, 0.12);
      border-radius: 2px;
      overflow: hidden;
    }

    .bar-fill {
      height: 100%;
      background: var(--accent-primary, #58a6ff);
      transition: width 1s linear;
    }

    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(240, 246, 252, 0.2);
      border-top-color: var(--accent-primary, #58a6ff);
      border-radius: 50%;
      animation: spin 800ms linear infinite;
      flex-shrink: 0;
    }

    @keyframes spin { to { transform: rotate(360deg); } }
  `;

  constructor() {
    super();
    this._state = 'idle';
    this._remaining = 0;
    this._total = 30;
    this._caption = '';
    this._fading = false;
    // Timers for the flash-then-hide chain.
    this._exitTimer = null;
    this._fadeTimer = null;
    this._onCountdown = this._onCountdown.bind(this);
    this._onFiring = this._onFiring.bind(this);
    this._onComplete = this._onComplete.bind(this);
    this._onCancelled = this._onCancelled.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener(
      'cache-warmup-countdown', this._onCountdown,
    );
    window.addEventListener(
      'cache-warmup-firing', this._onFiring,
    );
    window.addEventListener(
      'cache-warmup-complete', this._onComplete,
    );
    window.addEventListener(
      'cache-warmup-cancelled', this._onCancelled,
    );
  }

  disconnectedCallback() {
    window.removeEventListener(
      'cache-warmup-countdown', this._onCountdown,
    );
    window.removeEventListener(
      'cache-warmup-firing', this._onFiring,
    );
    window.removeEventListener(
      'cache-warmup-complete', this._onComplete,
    );
    window.removeEventListener(
      'cache-warmup-cancelled', this._onCancelled,
    );
    this._clearTimers();
    super.disconnectedCallback();
  }

  // ---------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------

  _onCountdown(event) {
    const detail = event.detail || {};
    const remaining = Number(detail.seconds_remaining);
    const total = Number(detail.total);
    if (!Number.isFinite(remaining) || !Number.isFinite(total)) return;
    this._clearTimers();
    this._state = 'counting';
    this._remaining = remaining;
    this._total = total > 0 ? total : 30;
    this._fading = false;
  }

  _onFiring() {
    this._clearTimers();
    this._state = 'firing';
    this._fading = false;
  }

  _onComplete(event) {
    const detail = event.detail || {};
    this._clearTimers();
    if (detail.success) {
      this._state = 'success';
      this._caption = 'Cache refreshed';
    } else {
      this._state = 'error';
      const reason = detail.reason || 'unknown error';
      this._caption = `Cache warm-up failed: ${reason}`;
    }
    this._fading = false;
    this._scheduleExit();
  }

  _onCancelled() {
    // Cancelled — close the bar without a flash. The
    // user is doing something more interesting (sending
    // a real message), so getting out of their way is
    // the right move.
    this._clearTimers();
    this._state = 'idle';
    this._fading = false;
  }

  // ---------------------------------------------------------------
  // Exit chain
  // ---------------------------------------------------------------

  _scheduleExit() {
    this._exitTimer = setTimeout(() => {
      this._exitTimer = null;
      this._fading = true;
      this._fadeTimer = setTimeout(() => {
        this._fadeTimer = null;
        this._state = 'idle';
        this._fading = false;
      }, _FADE_MS);
    }, _FLASH_MS);
  }

  _clearTimers() {
    if (this._exitTimer != null) {
      clearTimeout(this._exitTimer);
      this._exitTimer = null;
    }
    if (this._fadeTimer != null) {
      clearTimeout(this._fadeTimer);
      this._fadeTimer = null;
    }
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  render() {
    if (this._state === 'idle') return html``;
    const classes = [
      'overlay',
      this._state === 'success' ? 'success' : '',
      this._state === 'error' ? 'error' : '',
      this._fading ? 'fading' : '',
    ].filter(Boolean).join(' ');
    return html`
      <div class=${classes} role="status" aria-live="polite">
        ${this._renderBody()}
      </div>
    `;
  }

  _renderBody() {
    if (this._state === 'counting') {
      const filled = this._total > 0
        ? ((this._total - this._remaining) / this._total) * 100
        : 0;
      return html`
        <div class="row">
          <span class="glyph" aria-hidden="true">🔥</span>
          <span class="label">Refreshing cache in…</span>
          <span class="countdown">${this._remaining}s</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width: ${filled}%;"></div>
        </div>
      `;
    }
    if (this._state === 'firing') {
      return html`
        <div class="row">
          <div class="spinner" aria-hidden="true"></div>
          <span class="label">Sending cache warm-up…</span>
        </div>
      `;
    }
    if (this._state === 'success') {
      return html`
        <div class="row">
          <span class="glyph" aria-hidden="true">✓</span>
          <span class="label">${this._caption}</span>
        </div>
      `;
    }
    if (this._state === 'error') {
      return html`
        <div class="row">
          <span class="glyph" aria-hidden="true">⚠</span>
          <span class="label">${this._caption}</span>
        </div>
      `;
    }
    return html``;
  }
}

customElements.define('ac-cache-warmup-progress', CacheWarmupProgress);