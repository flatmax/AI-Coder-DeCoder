import { LitElement, html, css, nothing } from 'lit';
import { RpcMixin } from '../rpc-mixin.js';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_IMAGES = 5;
const URL_DETECT_DEBOUNCE_MS = 300;

/**
 * Chat input — auto-resize textarea, Enter to send, image paste, snippets, URL detection.
 */
class ChatInput extends RpcMixin(LitElement) {
  static properties = {
    disabled: { type: Boolean },
    snippets: { type: Array },
    _images: { type: Array, state: true },
    _showSnippets: { type: Boolean, state: true },
    _historyItems: { type: Array, state: true },
    _showHistory: { type: Boolean, state: true },
    _historyIndex: { type: Number, state: true },
    _savedInput: { type: String, state: true },
  };

  static styles = css`
    :host {
      display: block;
      border-top: 1px solid var(--border-color);
      background: var(--bg-secondary);
    }

    .input-area {
      display: flex;
      flex-direction: column;
      padding: 8px 12px;
      gap: 6px;
    }

    .images-row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .image-thumb {
      position: relative;
      width: 60px;
      height: 60px;
      border-radius: var(--radius-sm);
      overflow: hidden;
      border: 1px solid var(--border-color);
    }

    .image-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .image-remove {
      position: absolute;
      top: -4px;
      right: -4px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--accent-error);
      color: white;
      border: none;
      font-size: 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
    }

    .input-row {
      display: flex;
      gap: 6px;
      align-items: flex-end;
    }

    .snippet-toggle {
      background: none;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 6px 8px;
      cursor: pointer;
      color: var(--text-secondary);
      font-size: 14px;
      flex-shrink: 0;
      transition: background var(--transition-fast);
    }
    .snippet-toggle:hover { background: var(--bg-surface); }
    .snippet-toggle.active { background: var(--bg-surface); color: var(--accent-primary); }

    textarea {
      flex: 1;
      min-height: 38px;
      max-height: 200px;
      padding: 8px 10px;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 13.5px;
      line-height: 1.4;
      resize: none;
      outline: none;
      overflow-y: auto;
    }

    textarea:focus { border-color: var(--accent-primary); }
    textarea:disabled { opacity: 0.5; cursor: not-allowed; }

    textarea::placeholder { color: var(--text-muted); }

    .send-btn {
      background: var(--accent-primary);
      border: none;
      border-radius: var(--radius-sm);
      padding: 8px 14px;
      color: var(--bg-primary);
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      flex-shrink: 0;
      transition: opacity var(--transition-fast);
    }
    .send-btn:hover { opacity: 0.9; }
    .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    /* Snippet drawer */
    .snippet-drawer {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 6px 0;
    }

    .snippet-btn {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 4px 8px;
      cursor: pointer;
      font-size: 13px;
      color: var(--text-secondary);
      transition: background var(--transition-fast);
      white-space: nowrap;
    }
    .snippet-btn:hover { background: var(--bg-elevated); color: var(--text-primary); }

    /* Input history overlay */
    .history-overlay {
      position: absolute;
      bottom: 100%;
      left: 12px;
      right: 12px;
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      max-height: 300px;
      overflow-y: auto;
      z-index: 50;
    }

    .history-item {
      padding: 8px 12px;
      font-size: 12.5px;
      color: var(--text-secondary);
      cursor: pointer;
      border-bottom: 1px solid var(--border-color);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .history-item:last-child { border-bottom: none; }
    .history-item:hover { background: var(--bg-surface); }
    .history-item.selected { background: var(--bg-surface); color: var(--accent-primary); }
  `;

  constructor() {
    super();
    this.disabled = false;
    this.snippets = [];
    this._images = [];
    this._showSnippets = false;
    this._inputHistory = []; // deduplicated user messages, newest first
    this._historyItems = [];
    this._showHistory = false;
    this._historyIndex = -1;
    this._savedInput = '';
    this._urlDetectTimer = null;
    this._lastDetectedText = '';
  }

  // ── Auto-resize & URL detection ──

  _onInput(e) {
    this._autoResize(e.target);
    this._scheduleUrlDetection(e.target.value);
  }

  _scheduleUrlDetection(text) {
    if (this._urlDetectTimer) clearTimeout(this._urlDetectTimer);
    this._urlDetectTimer = setTimeout(() => {
      this._urlDetectTimer = null;
      this._detectUrls(text);
    }, URL_DETECT_DEBOUNCE_MS);
  }

  async _detectUrls(text) {
    if (!text || text === this._lastDetectedText) return;
    if (!this.rpcConnected) return;
    this._lastDetectedText = text;

    try {
      const urls = await this.rpcExtract('LLM.detect_urls', text);
      if (Array.isArray(urls)) {
        this.dispatchEvent(new CustomEvent('urls-detected', {
          detail: { urls },
          bubbles: true, composed: true,
        }));
      }
    } catch (e) {
      // URL detection is non-critical — silently ignore
    }
  }

  _autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  }

  // ── Send ──

  _onKeyDown(e) {
    const textarea = e.target;

    // Enter to send (without shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this._send();
      return;
    }

    // Escape — close history/snippets or clear input
    if (e.key === 'Escape') {
      if (this._showHistory) { this._showHistory = false; return; }
      if (this._showSnippets) { this._showSnippets = false; return; }
      textarea.value = '';
      this._autoResize(textarea);
      return;
    }

    // Up arrow at position 0 — open history
    if (e.key === 'ArrowUp' && textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
      this._openHistory(textarea);
      e.preventDefault();
      return;
    }

    // Navigation in history overlay
    if (this._showHistory) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._historyIndex = Math.min(this._historyIndex + 1, this._historyItems.length - 1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this._historyIndex = Math.max(this._historyIndex - 1, 0);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        this._selectHistory(textarea);
        return;
      }
    }

    // Down arrow at end — restore saved input
    if (e.key === 'ArrowDown' && this._savedInput !== '' &&
        textarea.selectionStart === textarea.value.length) {
      textarea.value = this._savedInput;
      this._savedInput = '';
      this._autoResize(textarea);
      e.preventDefault();
    }
  }

  _send() {
    const textarea = this.shadowRoot.querySelector('textarea');
    if (!textarea) return;
    const text = textarea.value.trim();
    if (!text && this._images.length === 0) return;
    if (this.disabled) return;

    // Record in input history
    if (text) {
      this._inputHistory = [text, ...this._inputHistory.filter(h => h !== text)].slice(0, 100);
    }

    this.dispatchEvent(new CustomEvent('send-message', {
      detail: {
        message: textarea.value,
        images: [...this._images],
      },
      bubbles: true, composed: true,
    }));

    textarea.value = '';
    this._images = [];
    this._autoResize(textarea);
    this._showSnippets = false;
    this._showHistory = false;
    this._lastDetectedText = '';
    if (this._urlDetectTimer) {
      clearTimeout(this._urlDetectTimer);
      this._urlDetectTimer = null;
    }
  }

  // ── Image paste ──

  _onPaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        if (file.size > MAX_IMAGE_SIZE) {
          console.warn('Image too large (>5MB)');
          continue;
        }
        if (this._images.length >= MAX_IMAGES) {
          console.warn('Maximum images reached');
          continue;
        }
        const reader = new FileReader();
        reader.onload = () => {
          this._images = [...this._images, reader.result];
        };
        reader.readAsDataURL(file);
        break; // One image per paste
      }
    }
  }

  _removeImage(index) {
    this._images = this._images.filter((_, i) => i !== index);
  }

  // ── Snippets ──

  _toggleSnippets() {
    this._showSnippets = !this._showSnippets;
    this._showHistory = false;
  }

  _insertSnippet(message) {
    const textarea = this.shadowRoot.querySelector('textarea');
    if (!textarea) return;
    const start = textarea.selectionStart;
    const before = textarea.value.substring(0, start);
    const after = textarea.value.substring(textarea.selectionEnd);
    textarea.value = before + message + after;
    textarea.selectionStart = textarea.selectionEnd = start + message.length;
    this._autoResize(textarea);
    this._showSnippets = false;
    textarea.focus();
  }

  // ── Input history ──

  _openHistory(textarea) {
    if (this._inputHistory.length === 0) return;
    this._savedInput = textarea.value;
    this._historyItems = [...this._inputHistory].slice(0, 20);
    this._historyIndex = 0;
    this._showHistory = true;
  }

  _selectHistory(textarea) {
    if (this._historyIndex >= 0 && this._historyIndex < this._historyItems.length) {
      textarea.value = this._historyItems[this._historyIndex];
      this._autoResize(textarea);
    }
    this._showHistory = false;
  }

  // ── Public API ──

  focus() {
    this.updateComplete.then(() => {
      this.shadowRoot.querySelector('textarea')?.focus();
    });
  }

  clear() {
    const textarea = this.shadowRoot.querySelector('textarea');
    if (textarea) {
      textarea.value = '';
      this._autoResize(textarea);
    }
    this._images = [];
    this._lastDetectedText = '';
    if (this._urlDetectTimer) {
      clearTimeout(this._urlDetectTimer);
      this._urlDetectTimer = null;
    }
  }

  // ── Render ──

  render() {
    return html`
      <div class="input-area" style="position:relative;">

        ${this._showHistory ? html`
          <div class="history-overlay">
            ${this._historyItems.map((item, i) => html`
              <div class="history-item ${i === this._historyIndex ? 'selected' : ''}"
                @click=${() => { this._historyIndex = i; this._selectHistory(this.shadowRoot.querySelector('textarea')); }}>
                ${item.length > 120 ? item.substring(0, 120) + '…' : item}
              </div>
            `)}
          </div>
        ` : nothing}

        ${this._images.length > 0 ? html`
          <div class="images-row">
            ${this._images.map((src, i) => html`
              <div class="image-thumb">
                <img src=${src} alt="Pasted image">
                <button class="image-remove" @click=${() => this._removeImage(i)}>×</button>
              </div>
            `)}
          </div>
        ` : nothing}

        ${this._showSnippets && this.snippets.length > 0 ? html`
          <div class="snippet-drawer">
            ${this.snippets.map(s => html`
              <button class="snippet-btn" title=${s.tooltip || s.message}
                @click=${() => this._insertSnippet(s.message)}>
                ${s.icon} ${s.tooltip || s.message.substring(0, 30)}
              </button>
            `)}
          </div>
        ` : nothing}

        <div class="input-row">
          ${this.snippets.length > 0 ? html`
            <button class="snippet-toggle ${this._showSnippets ? 'active' : ''}"
              @click=${this._toggleSnippets} title="Snippets">💡</button>
          ` : nothing}

          <textarea
            placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
            ?disabled=${this.disabled}
            @input=${this._onInput}
            @keydown=${this._onKeyDown}
            @paste=${this._onPaste}
            rows="1"
          ></textarea>

          <button class="send-btn" ?disabled=${this.disabled} @click=${this._send}>
            Send
          </button>
        </div>
      </div>
    `;
  }
}

customElements.define('chat-input', ChatInput);
