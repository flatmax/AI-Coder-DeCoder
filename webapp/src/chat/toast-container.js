import { LitElement, html, css, nothing } from 'lit';

/**
 * Toast notification container — listens for 'ac-toast' events on window
 * and displays auto-dismissing messages.
 */
class ToastContainer extends LitElement {
  static properties = {
    _toasts: { type: Array, state: true },
  };

  static styles = css`
    :host {
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 10000;
      display: flex;
      flex-direction: column-reverse;
      gap: 8px;
      pointer-events: none;
    }

    .toast {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      border-radius: var(--radius-md, 8px);
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary, #e0e0e0);
      background: var(--bg-elevated, #2a2a2a);
      border: 1px solid var(--border-color, #444);
      box-shadow: var(--shadow-lg, 0 4px 12px rgba(0,0,0,0.3));
      pointer-events: auto;
      max-width: 380px;
      animation: toast-in 0.25s ease-out;
      transition: opacity 0.3s ease, transform 0.3s ease;
    }

    .toast.fading {
      opacity: 0;
      transform: translateX(20px);
    }

    .toast.success { border-left: 3px solid var(--accent-success, #66bb6a); }
    .toast.error { border-left: 3px solid var(--accent-error, #ef5350); }
    .toast.warning { border-left: 3px solid var(--accent-warning, #ff9800); }
    .toast.info { border-left: 3px solid var(--accent-primary, #4fc3f7); }

    .toast-icon {
      font-size: 16px;
      flex-shrink: 0;
    }

    .toast-message {
      flex: 1;
      min-width: 0;
    }

    .toast-close {
      background: none;
      border: none;
      color: var(--text-muted, #888);
      cursor: pointer;
      font-size: 14px;
      padding: 0 2px;
      flex-shrink: 0;
      line-height: 1;
    }
    .toast-close:hover { color: var(--text-primary, #e0e0e0); }

    @keyframes toast-in {
      from {
        opacity: 0;
        transform: translateX(20px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }
  `;

  static ICONS = {
    success: '✓',
    error: '✗',
    warning: '⚠',
    info: 'ℹ',
  };

  constructor() {
    super();
    this._toasts = [];
    this._idCounter = 0;
    this._onToast = this._onToast.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('ac-toast', this._onToast);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('ac-toast', this._onToast);
    // Clear all timers
    for (const toast of this._toasts) {
      if (toast._timer) clearTimeout(toast._timer);
      if (toast._fadeTimer) clearTimeout(toast._fadeTimer);
    }
  }

  _onToast(e) {
    const { message, type = 'info', duration = 5000 } = e.detail || {};
    if (!message) return;

    const id = ++this._idCounter;
    const toast = { id, message, type, fading: false };

    // Auto-dismiss
    toast._fadeTimer = setTimeout(() => this._startFade(id), duration);

    this._toasts = [...this._toasts, toast];

    // Cap at 5 visible toasts
    if (this._toasts.length > 5) {
      const oldest = this._toasts[0];
      this._dismiss(oldest.id);
    }
  }

  _startFade(id) {
    this._toasts = this._toasts.map(t =>
      t.id === id ? { ...t, fading: true } : t
    );
    // Remove after fade animation
    setTimeout(() => this._remove(id), 300);
  }

  _dismiss(id) {
    const toast = this._toasts.find(t => t.id === id);
    if (toast) {
      if (toast._fadeTimer) clearTimeout(toast._fadeTimer);
      if (toast._timer) clearTimeout(toast._timer);
    }
    this._startFade(id);
  }

  _remove(id) {
    this._toasts = this._toasts.filter(t => t.id !== id);
  }

  render() {
    if (this._toasts.length === 0) return nothing;

    return html`
      ${this._toasts.map(toast => html`
        <div class="toast ${toast.type} ${toast.fading ? 'fading' : ''}" role="alert" aria-live="assertive">
          <span class="toast-icon" aria-hidden="true">${ToastContainer.ICONS[toast.type] || 'ℹ'}</span>
          <span class="toast-message">${toast.message}</span>
          <button class="toast-close" @click=${() => this._dismiss(toast.id)} aria-label="Dismiss notification">×</button>
        </div>
      `)}
    `;
  }
}

customElements.define('toast-container', ToastContainer);