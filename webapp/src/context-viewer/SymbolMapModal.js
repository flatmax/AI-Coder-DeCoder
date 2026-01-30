import { html, css } from 'lit';
import { ModalBase, modalBaseStyles } from './ModalBase.js';

export class SymbolMapModal extends ModalBase {
  static properties = {
    ...ModalBase.properties,
    content: { type: String },
    isLoading: { type: Boolean },
  };

  static styles = [
    modalBaseStyles,
    css`
      .modal {
        width: 90%;
        max-width: 900px;
        max-height: 85vh;
      }

      .modal-body {
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

      .footer-info {
        font-size: 11px;
        color: #666;
      }
    `
  ];

  constructor() {
    super();
    this.content = null;
    this.isLoading = false;
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
