import { LitElement, html, css, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { RpcMixin } from '../rpc-mixin.js';
import { renderMarkdown } from '../utils/markdown.js';
import { segmentResponse, computeDiff } from '../utils/edit-blocks.js';

/**
 * Chat panel — renders messages, handles streaming display, manages scrolling.
 */
class ChatPanel extends RpcMixin(LitElement) {
  static properties = {
    messages: { type: Array },
    streaming: { type: Boolean },
    streamContent: { type: String },
    editResults: { type: Array },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    .messages-wrapper {
      flex: 1;
      overflow: hidden;
      position: relative;
    }

    .messages {
      height: 100%;
      overflow-y: auto;
      padding: 12px 16px;
      scroll-behavior: smooth;
    }

    .message-card {
      margin-bottom: 12px;
      padding: 10px 14px;
      border-radius: var(--radius-md);
      line-height: 1.5;
      max-width: 100%;
      overflow-wrap: break-word;
      content-visibility: auto;
      contain-intrinsic-size: auto 120px;
    }

    .message-card.force-visible {
      content-visibility: visible;
    }

    .message-card.user {
      background: var(--bg-elevated);
      border-left: 3px solid var(--accent-primary);
    }

    .message-card.assistant {
      background: var(--bg-surface);
      border-left: 3px solid var(--accent-success);
    }

    .message-card.assistant.streaming {
      border-left-color: var(--accent-warning);
    }

    .role-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 6px;
      letter-spacing: 0.5px;
    }

    /* Markdown content styles */
    .md-content {
      font-size: 13.5px;
      color: var(--text-primary);
    }

    .md-content p { margin: 0.4em 0; }
    .md-content p:first-child { margin-top: 0; }
    .md-content p:last-child { margin-bottom: 0; }

    .md-content code {
      font-family: var(--font-mono);
      font-size: 12.5px;
      background: var(--bg-primary);
      padding: 1px 5px;
      border-radius: 3px;
      color: var(--accent-primary);
    }

    .md-content pre.code-block {
      position: relative;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 10px 12px;
      margin: 8px 0;
      overflow-x: auto;
    }

    .md-content pre.code-block code {
      background: none;
      padding: 0;
      color: var(--text-primary);
      font-size: 12px;
      line-height: 1.5;
    }

    .md-content pre .code-lang {
      position: absolute;
      top: 4px;
      right: 8px;
      font-size: 10px;
      color: var(--text-muted);
      font-family: var(--font-sans);
    }

    .md-content ul, .md-content ol { margin: 0.4em 0; padding-left: 1.5em; }
    .md-content li { margin: 0.2em 0; }
    .md-content blockquote {
      border-left: 3px solid var(--border-light);
      padding-left: 12px;
      color: var(--text-secondary);
      margin: 0.4em 0;
    }
    .md-content h1, .md-content h2, .md-content h3,
    .md-content h4, .md-content h5, .md-content h6 {
      margin: 0.6em 0 0.3em;
      color: var(--text-primary);
    }
    .md-content h1 { font-size: 1.3em; }
    .md-content h2 { font-size: 1.15em; }
    .md-content h3 { font-size: 1.05em; }
    .md-content a { color: var(--accent-primary); text-decoration: none; }
    .md-content a:hover { text-decoration: underline; }
    .md-content table {
      border-collapse: collapse;
      margin: 8px 0;
      font-size: 12.5px;
    }
    .md-content th, .md-content td {
      border: 1px solid var(--border-color);
      padding: 4px 8px;
    }
    .md-content th { background: var(--bg-elevated); font-weight: 600; }

    /* highlight.js dark theme overrides */
    .md-content .hljs-keyword { color: #c792ea; }
    .md-content .hljs-string { color: #c3e88d; }
    .md-content .hljs-number { color: #f78c6c; }
    .md-content .hljs-comment { color: #546e7a; font-style: italic; }
    .md-content .hljs-function { color: #82aaff; }
    .md-content .hljs-built_in { color: #ffcb6b; }
    .md-content .hljs-title { color: #82aaff; }
    .md-content .hljs-params { color: var(--text-primary); }
    .md-content .hljs-attr { color: #ffcb6b; }
    .md-content .hljs-literal { color: #f78c6c; }
    .md-content .hljs-type { color: #ffcb6b; }

    /* Edit block display */
    .edit-block {
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      margin: 8px 0;
      overflow: hidden;
    }

    .edit-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      background: var(--bg-elevated);
      border-bottom: 1px solid var(--border-color);
      font-size: 12px;
    }

    .edit-file-path {
      font-family: var(--font-mono);
      color: var(--accent-primary);
      cursor: pointer;
    }
    .edit-file-path:hover { text-decoration: underline; }

    .edit-badge {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 3px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .edit-badge.applied { background: #1b5e20; color: #a5d6a7; }
    .edit-badge.failed { background: #b71c1c; color: #ef9a9a; }
    .edit-badge.skipped { background: #4e342e; color: #bcaaa4; }
    .edit-badge.pending { background: #e65100; color: #ffcc80; }
    .edit-badge.new { background: #1a237e; color: #9fa8da; }

    .edit-diff {
      padding: 6px 0;
      font-family: var(--font-mono);
      font-size: 11.5px;
      line-height: 1.5;
      overflow-x: auto;
    }

    .diff-line { padding: 0 10px; white-space: pre; }
    .diff-line.context { color: var(--text-secondary); }
    .diff-line.remove { background: rgba(239,83,80,0.12); color: #ef9a9a; }
    .diff-line.add { background: rgba(102,187,106,0.12); color: #a5d6a7; }

    .edit-error {
      padding: 6px 10px;
      font-size: 11px;
      color: var(--accent-error);
      border-top: 1px solid var(--border-color);
    }

    /* Edit summary banner */
    .edit-summary {
      margin: 8px 0;
      padding: 8px 12px;
      border-radius: var(--radius-sm);
      font-size: 12px;
    }
    .edit-summary.success { background: rgba(102,187,106,0.1); border: 1px solid rgba(102,187,106,0.3); }
    .edit-summary.has-failures { background: rgba(239,83,80,0.1); border: 1px solid rgba(239,83,80,0.3); }

    .edit-summary-counts {
      display: flex;
      gap: 12px;
      margin-bottom: 4px;
    }
    .edit-summary-counts span { font-weight: 600; }
    .count-applied { color: var(--accent-success); }
    .count-failed { color: var(--accent-error); }
    .count-skipped { color: var(--text-muted); }

    /* Scroll to bottom button */
    .scroll-to-bottom {
      position: absolute;
      bottom: 12px;
      right: 20px;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
      font-size: 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: var(--shadow-md);
      transition: opacity var(--transition-fast);
      z-index: 5;
    }
    .scroll-to-bottom:hover { color: var(--text-primary); background: var(--bg-surface); }

    #scroll-sentinel { height: 0; overflow: hidden; }

    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 14px;
    }
  `;

  constructor() {
    super();
    this.messages = [];
    this.streaming = false;
    this.streamContent = '';
    this.editResults = [];
    this._userScrolledUp = false;
    this._pendingScroll = false;
    this._observer = null;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('stream-chunk', this._onStreamChunk.bind(this));
    window.addEventListener('stream-complete', this._onStreamComplete.bind(this));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('stream-chunk', this._onStreamChunk);
    window.removeEventListener('stream-complete', this._onStreamComplete);
    if (this._observer) this._observer.disconnect();
  }

  firstUpdated() {
    // Set up IntersectionObserver on scroll sentinel
    const sentinel = this.shadowRoot.getElementById('scroll-sentinel');
    const container = this.shadowRoot.querySelector('.messages');
    if (sentinel && container) {
      this._observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            this._userScrolledUp = false;
          }
        },
        { root: container, threshold: 0.1 }
      );
      this._observer.observe(sentinel);

      // Detect user scrolling up via wheel
      container.addEventListener('wheel', (e) => {
        if (e.deltaY < 0) {
          this._userScrolledUp = true;
          this.requestUpdate();
        }
      });
    }
  }

  // ── Streaming events ──

  _onStreamChunk(e) {
    const { content } = e.detail;
    this.streamContent = content;
    this.streaming = true;
    this._scrollToBottom();
  }

  _onStreamComplete(e) {
    const { result } = e.detail;
    this.streaming = false;
    this.editResults = result.edit_results || [];

    // The parent should add the exchange to messages
    this.dispatchEvent(new CustomEvent('stream-finished', {
      detail: result,
      bubbles: true, composed: true,
    }));

    this.streamContent = '';
    this._scrollToBottom();
  }

  // ── Scrolling ──

  _scrollToBottom() {
    if (this._userScrolledUp) return;
    if (this._pendingScroll) return;
    this._pendingScroll = true;

    this.updateComplete.then(() => {
      requestAnimationFrame(() => {
        const sentinel = this.shadowRoot.getElementById('scroll-sentinel');
        if (sentinel) {
          sentinel.scrollIntoView({ behavior: 'auto', block: 'end' });
        }
        this._pendingScroll = false;
      });
    });
  }

  _onScrollToBottomClick() {
    this._userScrolledUp = false;
    const sentinel = this.shadowRoot.getElementById('scroll-sentinel');
    if (sentinel) sentinel.scrollIntoView({ behavior: 'smooth', block: 'end' });
    this.requestUpdate();
  }

  // ── Edit result lookup ──

  _getEditResult(filePath) {
    if (!this.editResults) return null;
    return this.editResults.find(r => r.file_path === filePath);
  }

  // ── Render ──

  render() {
    const allMessages = this.messages || [];
    const hasContent = allMessages.length > 0 || this.streaming;

    return html`
      <div class="messages-wrapper">
        <div class="messages">
          ${!hasContent ? html`
            <div class="empty-state">Send a message to start</div>
          ` : nothing}

          ${allMessages.map((msg, idx) => this._renderMessage(msg, idx, allMessages.length))}

          ${this.streaming ? this._renderStreamingMessage() : nothing}

          <div id="scroll-sentinel"></div>
        </div>

        ${this._userScrolledUp ? html`
          <button class="scroll-to-bottom" @click=${this._onScrollToBottomClick}>↓</button>
        ` : nothing}
      </div>
    `;
  }

  _renderMessage(msg, idx, total) {
    const isUser = msg.role === 'user';
    const isLast = idx === (this.messages || []).length - 1;
    const forceVisible = total - idx <= 15;

    return html`
      <div class="message-card ${msg.role} ${forceVisible ? 'force-visible' : ''}">
        <div class="role-label">${isUser ? 'You' : 'Assistant'}</div>
        ${isUser
          ? html`<div class="md-content">${unsafeHTML(this._renderUserContent(msg.content))}</div>`
          : this._renderAssistantContent(msg.content, isLast)
        }
      </div>
    `;
  }

  _renderUserContent(content) {
    if (typeof content === 'string') {
      // Simple escape for user messages — render as plain text with line breaks
      return content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
    }
    // Multimodal content
    if (Array.isArray(content)) {
      return content.map(block => {
        if (block.type === 'text') return block.text.replace(/</g, '&lt;').replace(/\n/g, '<br>');
        if (block.type === 'image_url') return `<img src="${block.image_url.url}" style="max-width:200px;max-height:200px;border-radius:4px;margin:4px 0;">`;
        return '';
      }).join('');
    }
    return String(content);
  }

  _renderAssistantContent(content, showEditResults) {
    const segments = segmentResponse(content);
    const resultMap = showEditResults ? this.editResults : [];

    return html`
      <div class="md-content">
        ${segments.map(seg => {
          if (seg.type === 'text') {
            return html`${unsafeHTML(renderMarkdown(seg.content))}`;
          }
          if (seg.type === 'edit') {
            const result = resultMap.find(r => r.file_path === seg.filePath);
            return this._renderEditBlock(seg, result);
          }
          if (seg.type === 'edit-pending') {
            return this._renderEditBlock(seg, { status: 'pending' });
          }
          return nothing;
        })}
        ${showEditResults && resultMap.length > 0 ? this._renderEditSummary(resultMap) : nothing}
      </div>
    `;
  }

  _renderEditBlock(seg, result) {
    const diff = computeDiff(seg.oldLines || [], seg.newLines || []);
    const status = result?.status || (seg.isCreate ? 'new' : '');

    return html`
      <div class="edit-block">
        <div class="edit-header">
          <span class="edit-file-path"
            @click=${() => this._onEditFileClick(seg.filePath)}>
            ${seg.filePath}
          </span>
          ${status ? html`<span class="edit-badge ${status}">${status}</span>` : nothing}
        </div>
        <div class="edit-diff">
          ${diff.map(line => html`
            <div class="diff-line ${line.type}">${line.type === 'remove' ? '-' : line.type === 'add' ? '+' : ' '} ${line.text}</div>
          `)}
        </div>
        ${result?.error ? html`<div class="edit-error">⚠ ${result.error}</div>` : nothing}
      </div>
    `;
  }

  _renderEditSummary(results) {
    const applied = results.filter(r => r.status === 'applied').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    if (applied === 0 && failed === 0 && skipped === 0) return nothing;

    return html`
      <div class="edit-summary ${failed > 0 ? 'has-failures' : 'success'}">
        <div class="edit-summary-counts">
          ${applied ? html`<span class="count-applied">✓ ${applied} applied</span>` : nothing}
          ${failed ? html`<span class="count-failed">✗ ${failed} failed</span>` : nothing}
          ${skipped ? html`<span class="count-skipped">⊘ ${skipped} skipped</span>` : nothing}
        </div>
      </div>
    `;
  }

  _renderStreamingMessage() {
    return html`
      <div class="message-card assistant streaming">
        <div class="role-label">Assistant</div>
        <div class="md-content">
          ${unsafeHTML(renderMarkdown(this.streamContent))}
        </div>
      </div>
    `;
  }

  _onEditFileClick(filePath) {
    this.dispatchEvent(new CustomEvent('navigate-file', {
      detail: { path: filePath },
      bubbles: true, composed: true,
    }));
  }

  // ── Public API ──

  scrollToBottom() {
    this._userScrolledUp = false;
    this._scrollToBottom();
  }
}

customElements.define('chat-panel', ChatPanel);
