import { LitElement, html, css } from 'lit';

export class UserCard extends LitElement {
  static properties = {
    content: { type: String },
    images: { type: Array }
  };

  constructor() {
    super();
    this.content = '';
    this.images = [];
  }

  static styles = css`
    :host {
      display: block;
    }

    .card {
      background: #0f3460;
      border-radius: 8px;
      padding: 12px;
      color: #eee;
      margin-left: 40px;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }

    .label {
      font-size: 11px;
      color: #e94560;
      font-weight: 600;
    }

    .actions {
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.2s;
    }

    .card:hover .actions {
      opacity: 1;
    }

    .action-btn {
      background: #1a1a2e;
      border: none;
      border-radius: 4px;
      padding: 2px 6px;
      cursor: pointer;
      font-size: 11px;
      color: #888;
      transition: color 0.2s, background 0.2s;
    }

    .action-btn:hover {
      background: #0f3460;
      color: #e94560;
    }

    .content {
      white-space: pre-wrap;
      word-break: break-word;
    }

    .images {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }

    .thumbnail {
      width: 60px;
      height: 60px;
      object-fit: cover;
      border-radius: 4px;
      cursor: pointer;
      border: 1px solid #1a1a2e;
      transition: border-color 0.2s;
    }

    .thumbnail:hover {
      border-color: #e94560;
    }

    dialog {
      padding: 16px;
      border: none;
      border-radius: 8px;
      background: #1a1a2e;
      max-width: 90vw;
      max-height: 90vh;
      position: fixed;
    }

    dialog::backdrop {
      background: rgba(0, 0, 0, 0.85);
    }

    dialog img {
      display: block;
      max-width: calc(90vw - 32px);
      max-height: calc(90vh - 32px);
      object-fit: contain;
    }

    .footer-actions {
      display: flex;
      gap: 4px;
      justify-content: flex-end;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #1a1a2e;
    }
  `;

  copyToClipboard() {
    navigator.clipboard.writeText(this.content);
  }

  copyToPrompt() {
    this.dispatchEvent(new CustomEvent('copy-to-prompt', {
      detail: { content: this.content },
      bubbles: true,
      composed: true
    }));
  }

  openLightbox(imageSrc) {
    const dialog = this.shadowRoot.querySelector('dialog');
    const img = dialog.querySelector('img');
    img.src = imageSrc;
    dialog.showModal();
  }

  handleDialogClick(e) {
    const dialog = this.shadowRoot.querySelector('dialog');
    const rect = dialog.getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    ) {
      dialog.close();
    }
  }

  render() {
    return html`
      <div class="card">
        <div class="header">
          <div class="label">You</div>
          <div class="actions">
            <button class="action-btn" @click=${this.copyToClipboard} title="Copy to clipboard">📋</button>
            <button class="action-btn" @click=${this.copyToPrompt} title="Copy to prompt">↩️</button>
          </div>
        </div>
        <div class="content">${this.content}</div>
        ${this.images && this.images.length > 0 ? html`
          <div class="images">
            ${this.images.map(img => html`
              <img 
                class="thumbnail" 
                src=${img.preview}
                @click=${() => this.openLightbox(img.preview)}
                alt="Attached image"
              >
            `)}
          </div>
        ` : ''}
        <div class="footer-actions">
          <button class="action-btn" @click=${this.copyToClipboard} title="Copy to clipboard">📋</button>
          <button class="action-btn" @click=${this.copyToPrompt} title="Copy to prompt">↩️</button>
        </div>
      </div>
      <dialog @click=${(e) => this.handleDialogClick(e)}>
        <img src="" alt="Full size image" @click=${(e) => e.stopPropagation()}>
      </dialog>
    `;
  }
}

customElements.define('user-card', UserCard);
