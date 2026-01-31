import { html, css } from 'lit';
import { ModalBase, modalBaseStyles } from './ModalBase.js';
import { formatTokens, formatRelativeTime } from '../utils/formatters.js';

export class UrlContentModal extends ModalBase {
  static properties = {
    ...ModalBase.properties,
    url: { type: String },
    content: { type: Object },
    showFullContent: { type: Boolean },
  };

  static styles = [
    modalBaseStyles,
    css`
      .modal {
        width: 90%;
        max-width: 800px;
        max-height: 80vh;
      }

      .modal-meta {
        padding: 12px 20px;
        background: #16213e;
        display: flex;
        flex-wrap: wrap;
        gap: 12px 20px;
        font-size: 12px;
        color: #888;
      }

      .meta-item {
        display: flex;
        gap: 6px;
      }

      .meta-label {
        color: #666;
      }

      .meta-value {
        color: #aaa;
      }

      .content-section {
        margin-bottom: 20px;
      }

      .content-label {
        font-size: 11px;
        text-transform: uppercase;
        color: #666;
        margin-bottom: 8px;
      }

      .content-box {
        background: #0f3460;
        border-radius: 8px;
        padding: 16px;
        font-size: 13px;
        line-height: 1.6;
        color: #ccc;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 300px;
        overflow-y: auto;
      }

      .content-box.full {
        max-height: none;
      }
    `
  ];

  constructor() {
    super();
    this.url = '';
    this.content = null;
    this.showFullContent = false;
  }

  updated(changedProperties) {
    if (changedProperties.has('open') && this.open) {
      this.showFullContent = false;
    }
  }

  _toggleFullContent() {
    this.showFullContent = !this.showFullContent;
  }

  render() {
    if (!this.open) return html``;

    return html`
      <div class="overlay" @click=${this._handleOverlayClick}>
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title">URL Content</span>
            <button class="close-btn" @click=${this._close}>✕</button>
          </div>
          
          ${this._renderContent()}
        </div>
      </div>
    `;
  }

  _renderContent() {
    if (!this.content) {
      return html`<div class="loading">Loading...</div>`;
    }

    if (this.content.error) {
      return html`<div class="error">Error: ${this.content.error}</div>`;
    }

    const { title, type, fetched_at, content_tokens, readme_tokens, description, content, readme, symbol_map } = this.content;

    return html`
      <div class="modal-meta">
        <div class="meta-item">
          <span class="meta-label">URL:</span>
          <span class="meta-value">${this.url}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Type:</span>
          <span class="meta-value">${type || 'unknown'}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Fetched:</span>
          <span class="meta-value">${formatRelativeTime(fetched_at)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Tokens:</span>
          <span class="meta-value">${formatTokens(readme_tokens || content_tokens)}</span>
        </div>
      </div>
      
      <div class="modal-body">
        ${description ? html`
          <div class="content-section">
            <div class="content-label">Description</div>
            <div class="content-box">${description}</div>
          </div>
        ` : ''}
        
        ${readme ? html`
          <div class="content-section">
            <div class="content-label">README</div>
            <div class="content-box ${this.showFullContent ? 'full' : ''}">${readme}</div>
          </div>
        ` : ''}
        
        ${symbol_map ? html`
          <div class="content-section">
            <div class="content-label">Symbol Map</div>
            <div class="content-box ${this.showFullContent ? 'full' : ''}">${symbol_map}</div>
          </div>
        ` : ''}
        
        ${content && this.showFullContent ? html`
          <div class="content-section">
            <div class="content-label">Full Content</div>
            <div class="content-box full">${content}</div>
          </div>
        ` : ''}
      </div>
      
      <div class="modal-footer">
        ${content || symbol_map ? html`
          <button class="footer-btn" @click=${this._toggleFullContent}>
            ${this.showFullContent ? 'Hide Details' : 'Show Full Content'}
          </button>
        ` : ''}
      </div>
    `;
  }
}

customElements.define('url-content-modal', UrlContentModal);
