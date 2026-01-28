import { LitElement, html, css } from 'lit';

export class SymbolMapModal extends LitElement {
  static properties = {
    open: { type: Boolean },
    content: { type: String },
    isLoading: { type: Boolean },
  };

  static styles = css`
    :host {
      display: block;
    }

    .overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      z-index: 2000;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .modal {
      background: #1a1a2e;
      border-radius: 12px;
      width: 90%;
      max-width: 900px;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      border: 1px solid #0f3460;
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid #0f3460;
    }

    .modal-title {
      font-weight: 600;
      color: #fff;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .close-btn {
      background: none;
      border: none;
      color: #888;
      font-size: 20px;
      cursor: pointer;
      padding: 0;
      line-height: 1;
    }

    .close-btn:hover {
      color: #fff;
    }

    .modal-body {
      flex: 1;
      overflow-y: auto;
      padding: 0;
    }

    .content-box {
      background: #0d0d0d;
      padding: 16px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Fira Code', monospace;
      font-size: 12px;
      line-height: 1.5;
      color: #ccc;
      white-space: pre;
      overflow-x: auto;
      min-height: 200px;
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px;
      color: #888;
      gap: 8px;
    }

    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid #333;
      border-top-color: #e94560;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .modal-footer {
      padding: 12px 20px;
      border-top: 1px solid #0f3460;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .footer-info {
      font-size: 11px;
      color: #666;
    }

    .copy-btn {
      background: #0f3460;
      border: none;
      border-radius: 6px;
      color: #ccc;
      padding: 8px 16px;
      font-size: 12px;
      cursor: pointer;
    }

    .copy-btn:hover {
      background: #1a4a7a;
      color: #fff;
    }
  `;

  constructor() {
    super();
    this.open = false;
    this.content = null;
    this.isLoading = false;
  }

  _close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  _handleOverlayClick(e) {
    if (e.target === e.currentTarget) {
      this._close();
    }
  }

  _copyToClipboard() {
    if (this.content) {
      navigator.clipboard.writeText(this.content);
    }
  }

  _getLineCount() {
    if (!this.content) return 0;
    return this.content.split('\n').length;
  }

  render() {
    if (!this.open) return html``;

    return html`
      <div class="overlay" @click=${this._handleOverlayClick}>
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title">
              <span>🗺️</span>
              <span>Symbol Map</span>
            </span>
            <button class="close-btn" @click=${this._close}>✕</button>
          </div>
          
          <div class="modal-body">
            ${this.isLoading ? html`
              <div class="loading">
                <div class="spinner"></div>
                <span>Loading symbol map...</span>
              </div>
            ` : html`
              <div class="content-box">${this.content || 'No content available'}</div>
            `}
          </div>
          
          <div class="modal-footer">
            <span class="footer-info">
              ${this.content ? `${this._getLineCount()} lines` : ''}
            </span>
            <button class="copy-btn" @click=${this._copyToClipboard} ?disabled=${!this.content}>
              📋 Copy to Clipboard
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('symbol-map-modal', SymbolMapModal);
