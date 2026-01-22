import { LitElement, html, css } from 'lit';
import './CardMarkdown.js';

export class AssistantCard extends LitElement {
  static properties = {
    content: { type: String }
  };

  static styles = css`
    :host {
      display: block;
    }

    .card {
      background: #1a1a2e;
      border-radius: 8px;
      padding: 12px;
      color: #eee;
      margin-right: 40px;
      border: 1px solid #0f3460;
    }

    .label {
      font-size: 11px;
      color: #e94560;
      margin-bottom: 4px;
      font-weight: 600;
    }
  `;

  render() {
    return html`
      <div class="card">
        <div class="label">Assistant</div>
        <card-markdown .content=${this.content} role="assistant"></card-markdown>
      </div>
    `;
  }
}

customElements.define('assistant-card', AssistantCard);
