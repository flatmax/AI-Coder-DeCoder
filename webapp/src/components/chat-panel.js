/**
 * Chat panel — message display, streaming, input area.
 */

import { LitElement, html, css, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { theme, scrollbarStyles } from '../styles/theme.js';
import { RpcMixin } from '../rpc-mixin.js';

// Simple markdown → HTML (basic: headers, code blocks, bold, italic, links)
function renderMarkdown(text) {
  if (!text) return '';
  let result = text
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Code blocks (``` ... ```)
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre class="code-block"><code>${code}</code></pre>`;
    })
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Headers
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    // Line breaks (but not inside pre blocks)
    .replace(/\n/g, '<br>');

  return result;
}

export class AcChatPanel extends RpcMixin(LitElement) {
  static properties = {
    messages: { type: Array },
    streamingActive: { type: Boolean },
    _streamingContent: { type: String, state: true },
    _inputValue: { type: String, state: true },
    _images: { type: Array, state: true },
    _autoScroll: { type: Boolean, state: true },
  };

  static styles = [theme, scrollbarStyles, css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    /* Action bar */
    .action-bar {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-primary);
      min-height: 36px;
    }

    .action-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 0.9rem;
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      cursor: pointer;
    }
    .action-btn:hover {
      background: var(--bg-secondary);
      color: var(--text-primary);
    }

    .action-spacer { flex: 1; }

    /* Messages area */
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      scroll-behavior: smooth;
    }

    .message-card {
      margin-bottom: 12px;
      padding: 12px 16px;
      border-radius: var(--radius-md);
      border: 1px solid transparent;
      line-height: 1.6;
      font-size: 0.9rem;
      position: relative;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    .message-card.user {
      background: var(--bg-tertiary);
      border-color: var(--border-primary);
    }

    .message-card.assistant {
      background: var(--bg-secondary);
    }

    .message-card .role-label {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 6px;
      letter-spacing: 0.05em;
    }

    .message-card.user .role-label { color: var(--accent-primary); }
    .message-card.assistant .role-label { color: var(--accent-green); }

    .md-content h2, .md-content h3, .md-content h4 {
      margin-top: 0.8em;
      margin-bottom: 0.4em;
      color: var(--text-primary);
    }
    .md-content h2 { font-size: 1.1rem; }
    .md-content h3 { font-size: 1rem; }
    .md-content h4 { font-size: 0.95rem; }

    .md-content pre.code-block {
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-sm);
      padding: 12px;
      overflow-x: auto;
      font-family: var(--font-mono);
      font-size: 0.85rem;
      margin: 8px 0;
      position: relative;
    }

    .md-content code {
      font-family: var(--font-mono);
      font-size: 0.85em;
      background: var(--bg-primary);
      padding: 0.15em 0.4em;
      border-radius: 3px;
    }

    .md-content pre.code-block code {
      background: none;
      padding: 0;
    }

    /* Copy button on code blocks */
    .md-content pre.code-block .copy-btn {
      position: absolute;
      top: 6px;
      right: 6px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      color: var(--text-muted);
      font-size: 0.75rem;
      padding: 2px 6px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .md-content pre.code-block:hover .copy-btn {
      opacity: 1;
    }
    .md-content pre.code-block .copy-btn:hover {
      color: var(--text-primary);
    }

    /* Streaming indicator */
    .streaming-indicator {
      display: inline-block;
      width: 8px;
      height: 8px;
      background: var(--accent-primary);
      border-radius: 50%;
      animation: pulse 1s ease-in-out infinite;
      margin-left: 4px;
      vertical-align: middle;
    }

    @keyframes pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }

    /* Scroll sentinel */
    .scroll-sentinel {
      height: 1px;
    }

    /* Scroll to bottom button */
    .scroll-bottom-btn {
      position: absolute;
      bottom: 80px;
      right: 24px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      color: var(--text-secondary);
      font-size: 1rem;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      cursor: pointer;
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 5;
      box-shadow: var(--shadow-md);
    }
    .scroll-bottom-btn.visible {
      display: flex;
    }
    .scroll-bottom-btn:hover {
      background: var(--bg-secondary);
      color: var(--text-primary);
    }

    /* Empty state */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      text-align: center;
      gap: 8px;
    }
    .empty-state .brand {
      font-size: 2rem;
      opacity: 0.3;
    }
    .empty-state .hint {
      font-size: 0.85rem;
    }

    /* Input area */
    .input-area {
      border-top: 1px solid var(--border-primary);
      padding: 8px 12px;
      background: var(--bg-secondary);
    }

    .input-row {
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }

    .input-textarea {
      flex: 1;
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 0.9rem;
      padding: 10px 12px;
      resize: none;
      min-height: 42px;
      max-height: 200px;
      line-height: 1.4;
      outline: none;
    }
    .input-textarea:focus {
      border-color: var(--accent-primary);
    }
    .input-textarea::placeholder {
      color: var(--text-muted);
    }

    .send-btn {
      background: var(--accent-primary);
      border: none;
      color: var(--bg-primary);
      font-size: 1rem;
      width: 42px;
      height: 42px;
      border-radius: var(--radius-md);
      cursor: pointer;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }
    .send-btn:hover { opacity: 0.9; }
    .send-btn.stop {
      background: var(--accent-red);
    }
    .send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Image previews */
    .image-previews {
      display: flex;
      gap: 8px;
      padding: 8px 0 4px;
      flex-wrap: wrap;
    }

    .image-preview {
      position: relative;
      width: 64px;
      height: 64px;
      border-radius: var(--radius-sm);
      overflow: hidden;
      border: 1px solid var(--border-primary);
    }

    .image-preview img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .image-preview .remove-btn {
      position: absolute;
      top: 2px;
      right: 2px;
      background: rgba(0, 0, 0, 0.6);
      color: white;
      border: none;
      font-size: 0.65rem;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  `];

  constructor() {
    super();
    this.messages = [];
    this.streamingActive = false;
    this._streamingContent = '';
    this._inputValue = '';
    this._images = [];
    this._autoScroll = true;
    this._observer = null;
    this._pendingChunk = null;
    this._rafId = null;

    // Bind event handlers
    this._onStreamChunk = this._onStreamChunk.bind(this);
    this._onStreamComplete = this._onStreamComplete.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('stream-chunk', this._onStreamChunk);
    window.addEventListener('stream-complete', this._onStreamComplete);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('stream-chunk', this._onStreamChunk);
    window.removeEventListener('stream-complete', this._onStreamComplete);
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._observer) this._observer.disconnect();
  }

  firstUpdated() {
    // Set up IntersectionObserver for auto-scroll
    const sentinel = this.shadowRoot.querySelector('.scroll-sentinel');
    const container = this.shadowRoot.querySelector('.messages');
    if (sentinel && container) {
      this._observer = new IntersectionObserver(
        ([entry]) => {
          this._autoScroll = entry.isIntersecting;
        },
        { root: container, threshold: 0.1 }
      );
      this._observer.observe(sentinel);
    }
  }

  // === Streaming ===

  _onStreamChunk(e) {
    const { content } = e.detail;
    // Coalesce per animation frame
    this._pendingChunk = content;
    if (!this._rafId) {
      this._rafId = requestAnimationFrame(() => {
        this._rafId = null;
        if (this._pendingChunk !== null) {
          this._streamingContent = this._pendingChunk;
          this._pendingChunk = null;
          if (this._autoScroll) {
            this._scrollToBottom();
          }
        }
      });
    }
  }

  _onStreamComplete(e) {
    this._streamingContent = '';
    this._pendingChunk = null;
    // Messages will be updated from parent
  }

  // === Scrolling ===

  _scrollToBottom() {
    const container = this.shadowRoot?.querySelector('.messages');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  _onScrollBtnClick() {
    this._autoScroll = true;
    this._scrollToBottom();
  }

  // === Input ===

  _onInput(e) {
    this._inputValue = e.target.value;
    this._autoResize(e.target);
  }

  _autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  }

  _onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this._send();
    }
  }

  _onPaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;

        // Check size (5MB)
        if (file.size > 5 * 1024 * 1024) {
          // TODO: show error toast
          console.warn('Image too large (max 5MB)');
          continue;
        }

        // Check count
        if (this._images.length >= 5) {
          console.warn('Max 5 images per message');
          continue;
        }

        const reader = new FileReader();
        reader.onload = () => {
          this._images = [...this._images, reader.result];
        };
        reader.readAsDataURL(file);
        break; // One image per paste event
      }
    }
  }

  _removeImage(index) {
    this._images = this._images.filter((_, i) => i !== index);
  }

  async _send() {
    const message = this._inputValue.trim();
    if (!message && this._images.length === 0) return;
    if (!this.rpcConnected) return;

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const images = this._images.length > 0 ? [...this._images] : null;

    // Clear input
    this._inputValue = '';
    this._images = [];
    const textarea = this.shadowRoot?.querySelector('.input-textarea');
    if (textarea) {
      textarea.value = '';
      textarea.style.height = 'auto';
    }

    // Auto-scroll on send
    this._autoScroll = true;

    try {
      // Get selected files from parent
      const files = []; // TODO: get from file picker

      await this.rpcExtract('LLMService.chat_streaming', requestId, message, files, images);
    } catch (e) {
      console.error('Failed to start stream:', e);
    }
  }

  _stop() {
    // TODO: implement cancel
  }

  // === Actions ===

  _newSession() {
    this.dispatchEvent(new CustomEvent('new-session', { bubbles: true, composed: true }));
  }

  // === Rendering ===

  _renderMessage(msg, index) {
    const isUser = msg.role === 'user';
    const content = msg.content || '';

    return html`
      <div class="message-card ${msg.role}" data-msg-index="${index}">
        <div class="role-label">${isUser ? 'You' : 'Assistant'}</div>
        <div class="md-content" @click=${this._onContentClick}>
          ${unsafeHTML(renderMarkdown(content))}
        </div>
      </div>
    `;
  }

  _onContentClick(e) {
    // Handle copy button clicks on code blocks
    const btn = e.target.closest('.copy-btn');
    if (btn) {
      const pre = btn.closest('pre');
      if (pre) {
        const code = pre.querySelector('code');
        if (code) {
          navigator.clipboard.writeText(code.textContent).then(() => {
            btn.textContent = '✓ Copied';
            setTimeout(() => { btn.textContent = '📋'; }, 1500);
          });
        }
      }
    }
  }

  render() {
    const hasMessages = this.messages.length > 0 || this._streamingContent;

    return html`
      <!-- Action Bar -->
      <div class="action-bar">
        <button class="action-btn" title="New session" @click=${this._newSession}>✨</button>
        <button class="action-btn" title="Browse history">📜</button>
        <div class="action-spacer"></div>
        <button class="action-btn" title="Copy diff">📋</button>
        <button class="action-btn" title="Commit">💾</button>
        <button class="action-btn" title="Reset to HEAD">⚠️</button>
      </div>

      <!-- Messages -->
      <div class="messages">
        ${!hasMessages ? html`
          <div class="empty-state">
            <div class="brand">AC⚡DC</div>
            <div class="hint">Select files and start chatting</div>
          </div>
        ` : html`
          ${this.messages.map((msg, i) => this._renderMessage(msg, i))}

          ${this._streamingContent ? html`
            <div class="message-card assistant">
              <div class="role-label">
                Assistant <span class="streaming-indicator"></span>
              </div>
              <div class="md-content">
                ${unsafeHTML(renderMarkdown(this._streamingContent))}
              </div>
            </div>
          ` : nothing}
        `}

        <div class="scroll-sentinel"></div>
      </div>

      <!-- Scroll to bottom -->
      <button
        class="scroll-bottom-btn ${!this._autoScroll && hasMessages ? 'visible' : ''}"
        @click=${this._onScrollBtnClick}
      >↓</button>

      <!-- Input Area -->
      <div class="input-area">
        ${this._images.length > 0 ? html`
          <div class="image-previews">
            ${this._images.map((img, i) => html`
              <div class="image-preview">
                <img src="${img}" alt="Pasted image">
                <button class="remove-btn" @click=${() => this._removeImage(i)}>✕</button>
              </div>
            `)}
          </div>
        ` : nothing}

        <div class="input-row">
          <textarea
            class="input-textarea"
            placeholder="Message AC⚡DC..."
            rows="1"
            .value=${this._inputValue}
            @input=${this._onInput}
            @keydown=${this._onKeyDown}
            @paste=${this._onPaste}
          ></textarea>

          ${this.streamingActive ? html`
            <button class="send-btn stop" @click=${this._stop} title="Stop">⏹</button>
          ` : html`
            <button
              class="send-btn"
              @click=${this._send}
              ?disabled=${!this.rpcConnected}
              title="Send (Enter)"
            >↑</button>
          `}
        </div>
      </div>
    `;
  }
}

customElements.define('ac-chat-panel', AcChatPanel);