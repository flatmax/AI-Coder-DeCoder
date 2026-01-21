import { LitElement, html, css } from 'lit';

export class UserCard extends LitElement {
  static properties = {
    content: { type: String }
  };

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

    .label {
      font-size: 11px;
      color: #e94560;
      margin-bottom: 4px;
      font-weight: 600;
    }

    .content {
      white-space: pre-wrap;
      word-break: break-word;
    }
  `;

  render() {
    return html`
      <div class="card">
        <div class="label">You</div>
        <div class="content">${this.content}</div>
      </div>
    `;
  }
}

customElements.define('user-card', UserCard);
