import { LitElement, html, css } from 'lit';
import './CardMarkdown.js';

export class AssistantCard extends LitElement {
  static properties = {
    content: { type: String },
    mentionedFiles: { type: Array },
    selectedFiles: { type: Array },  // Files currently in context
    editResults: { type: Array },  // Results from edit operations (passed from message or loaded from history)
    final: { type: Boolean }  // Whether the message is complete (not still streaming)
  };

  shouldUpdate(changedProperties) {
    // Skip re-render when all "changed" properties have identical references.
    // Combined with stable empty-array fallbacks (EMPTY_ARRAY in PromptViewTemplate),
    // this prevents re-rendering all cards when file selection changes or during streaming.
    for (const [key, oldVal] of changedProperties) {
      const newVal = this[key];
      if (newVal !== oldVal) {
        // For arrays, compare by length + elements to avoid spurious re-renders
        // from new array references with identical content
        if (Array.isArray(newVal) && Array.isArray(oldVal)) {
          if (newVal.length !== oldVal.length || newVal.some((v, i) => v !== oldVal[i])) return true;
        } else {
          return true;
        }
      }
    }
    return false;
  }

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
      background: #0f3460;
      border: none;
      border-radius: 4px;
      padding: 2px 6px;
      cursor: pointer;
      font-size: 11px;
      color: #888;
      transition: color 0.2s, background 0.2s;
    }

    .action-btn:hover {
      background: #1a3a6e;
      color: #e94560;
    }

    .footer-actions {
      display: flex;
      gap: 4px;
      justify-content: flex-end;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #0f3460;
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

  render() {
    return html`
      <div class="card">
        <div class="header">
          <div class="label">Assistant</div>
          <div class="actions">
            <button class="action-btn" @click=${this.copyToClipboard} title="Copy to clipboard">📋</button>
            <button class="action-btn" @click=${this.copyToPrompt} title="Copy to prompt">↩️</button>
          </div>
        </div>
        <card-markdown .content=${this.content} role="assistant" .final=${this.final !== false} .mentionedFiles=${this.mentionedFiles || []} .selectedFiles=${this.selectedFiles || []} .editResults=${this.editResults || []}></card-markdown>
        <div class="footer-actions">
          <button class="action-btn" @click=${this.copyToClipboard} title="Copy to clipboard">📋</button>
          <button class="action-btn" @click=${this.copyToPrompt} title="Copy to prompt">↩️</button>
        </div>
      </div>
    `;
  }
}

customElements.define('assistant-card', AssistantCard);
