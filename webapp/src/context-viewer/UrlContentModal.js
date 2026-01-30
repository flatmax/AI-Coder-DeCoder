import { LitElement, html, css } from 'lit';
import { formatTokens, formatRelativeTime } from '../utils/formatters.js';

export class UrlContentModal extends LitElement {
  static properties = {
    open: { type: Boolean },
    url: { type: String },
    content: { type: Object },
    showFullContent: { type: Boolean },
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
      max-width: 800px;
      max-height: 80vh;
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

    .modal-meta {
      padding: 12px 20px;
      background: #16213e;
      display: flex;
      gap: 20px;
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

    .modal-body {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
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

    .modal-footer {
      padding: 12px 20px;
      border-top: 1px solid #0f3460;
      display: flex;
      gap: 8px;
    }

    .footer-btn {
      background: #0f3460;
      border: none;
      border-radius: 6px;
      color: #ccc;
      padding: 8px 16px;
      font-size: 12px;
      cursor: pointer;
    }

    .footer-btn:hover {
      background: #1a4a7a;
      color: #fff;
    }

    .loading {
      text-align: center;
      padding: 40px;
      color: #888;
    }

    .error {
      color: #e94560;
      padding: 20px;
    }
  `;

  constructor() {
    super();
    this.open = false;
    this.url = '';
    this.content = null;
    this.showFullContent = false;
  }

  updated(changedProperties) {
    if (changedProperties.has('open') && this.open) {
      this.showFullContent = false;
    }
  }

  _close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  _handleOverlayClick(e) {
    if (e.target === e.currentTarget) {
      this._close();
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
