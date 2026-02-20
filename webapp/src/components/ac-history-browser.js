/**
 * History Browser — Modal overlay for browsing past conversations.
 *
 * Left panel: session list or search results.
 * Right panel: messages for selected session.
 * Search: debounced (300ms) full-text.
 * Actions: copy message, paste to prompt, load session.
 * State preserved on close/reopen.
 */

import { LitElement, html, css, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { theme, scrollbarStyles } from '../styles/theme.js';
import { RpcMixin } from '../rpc-mixin.js';

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderSimpleMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre class="code-block"><code>${code}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/\n/g, '<br>');
}

export class AcHistoryBrowser extends RpcMixin(LitElement) {
  static properties = {
    open: { type: Boolean, reflect: true },
    _sessions: { type: Array, state: true },
    _selectedSessionId: { type: String, state: true },
    _sessionMessages: { type: Array, state: true },
    _searchQuery: { type: String, state: true },
    _searchResults: { type: Array, state: true },
    _loading: { type: Boolean, state: true },
    _loadingMessages: { type: Boolean, state: true },
    _mode: { type: String, state: true }, // 'sessions' | 'search'
  };

  static styles = [theme, scrollbarStyles, css`
    :host {
      display: none;
    }
    :host([open]) {
      display: block;
    }

    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: var(--z-modal);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .modal {
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      width: 85vw;
      max-width: 1100px;
      height: 75vh;
      max-height: 700px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* Header */
    .modal-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-primary);
      flex-shrink: 0;
    }

    .modal-title {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--text-primary);
      white-space: nowrap;
    }

    .search-input {
      flex: 1;
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 0.85rem;
      padding: 6px 12px;
      outline: none;
    }
    .search-input:focus {
      border-color: var(--accent-primary);
    }
    .search-input::placeholder {
      color: var(--text-muted);
    }

    .close-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 1.1rem;
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      flex-shrink: 0;
    }
    .close-btn:hover {
      background: var(--bg-secondary);
      color: var(--text-primary);
    }

    /* Body — two-panel layout */
    .modal-body {
      display: flex;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }

    /* Left panel: sessions */
    .session-panel {
      width: 300px;
      min-width: 240px;
      border-right: 1px solid var(--border-primary);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .session-list {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }

    .session-item {
      padding: 10px 14px;
      cursor: pointer;
      border-left: 3px solid transparent;
      transition: background 0.1s;
    }
    .session-item:hover {
      background: var(--bg-tertiary);
    }
    .session-item.selected {
      background: var(--bg-tertiary);
      border-left-color: var(--accent-primary);
    }

    .session-preview {
      font-size: 0.8rem;
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      line-height: 1.4;
    }

    .session-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
      font-size: 0.7rem;
      color: var(--text-muted);
    }

    .session-meta .msg-count {
      background: var(--bg-primary);
      padding: 1px 6px;
      border-radius: 8px;
      font-size: 0.65rem;
    }

    /* Right panel: messages */
    .message-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-width: 0;
    }

    .message-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      border-bottom: 1px solid var(--border-primary);
      background: var(--bg-secondary);
      flex-shrink: 0;
      gap: 8px;
    }

    .session-info {
      font-size: 0.8rem;
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .load-session-btn {
      background: var(--accent-primary);
      color: var(--bg-primary);
      border: none;
      font-size: 0.8rem;
      font-weight: 600;
      padding: 5px 14px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .load-session-btn:hover {
      opacity: 0.9;
    }
    .load-session-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .message-list {
      flex: 1;
      overflow-y: auto;
      padding: 12px 16px;
    }

    .msg-card {
      margin-bottom: 10px;
      padding: 10px 14px;
      border-radius: var(--radius-md);
      font-size: 0.85rem;
      line-height: 1.5;
      position: relative;
    }

    .msg-card.user {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
    }
    .msg-card.assistant {
      background: var(--bg-primary);
    }

    .msg-role {
      font-size: 0.65rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
    }
    .msg-card.user .msg-role { color: var(--accent-primary); }
    .msg-card.assistant .msg-role { color: var(--accent-green); }

    .msg-content {
      color: var(--text-secondary);
      word-break: break-word;
    }
    .msg-content pre.code-block {
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-sm);
      padding: 8px;
      overflow-x: auto;
      font-family: var(--font-mono);
      font-size: 0.8rem;
      margin: 6px 0;
    }
    .msg-content code {
      font-family: var(--font-mono);
      font-size: 0.8em;
      background: var(--bg-secondary);
      padding: 0.1em 0.3em;
      border-radius: 3px;
    }
    .msg-content pre.code-block code {
      background: none;
      padding: 0;
    }

    /* Message action buttons */
    .msg-actions {
      position: absolute;
      top: 6px;
      right: 6px;
      display: flex;
      gap: 2px;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .msg-card:hover .msg-actions {
      opacity: 1;
    }

    .msg-action-btn {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      color: var(--text-muted);
      font-size: 0.7rem;
      padding: 2px 6px;
      border-radius: var(--radius-sm);
      cursor: pointer;
    }
    .msg-action-btn:hover {
      color: var(--text-primary);
      border-color: var(--accent-primary);
    }

    /* Empty/loading states */
    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 0.85rem;
      text-align: center;
      padding: 20px;
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: var(--text-muted);
      font-size: 0.85rem;
    }

    /* Image thumbnails in history messages */
    .msg-images {
      display: flex;
      gap: 6px;
      margin-top: 6px;
      flex-wrap: wrap;
    }
    .msg-images img {
      width: 48px;
      height: 48px;
      object-fit: cover;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-primary);
    }

    /* Toast */
    .toast {
      position: absolute;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--bg-tertiary);
      border: 1px solid var(--accent-green);
      border-radius: var(--radius-md);
      padding: 6px 14px;
      font-size: 0.8rem;
      color: var(--accent-green);
      z-index: 10;
      pointer-events: none;
    }

    /* Search result highlight */
    .search-highlight {
      background: rgba(79, 195, 247, 0.2);
      border-radius: 2px;
      padding: 0 1px;
    }
  `];

  constructor() {
    super();
    this.open = false;
    this._sessions = [];
    this._selectedSessionId = null;
    this._sessionMessages = [];
    this._searchQuery = '';
    this._searchResults = [];
    this._loading = false;
    this._loadingMessages = false;
    this._mode = 'sessions';
    this._debounceTimer = null;
    this._toast = null;
    this._toastTimer = null;
  }

  // === Public API ===

  show() {
    this.open = true;
    this._selectedSessionId = null;
    this._sessionMessages = [];
    this._searchQuery = '';
    this._searchResults = [];
    this._mode = 'sessions';
    this._loadSessions();
    this.updateComplete.then(() => {
      const input = this.shadowRoot?.querySelector('.search-input');
      if (input) {
        input.value = '';
        input.focus();
      }
    });
  }

  hide() {
    this.open = false;
  }

  // === Data Loading ===

  async _loadSessions() {
    if (!this.rpcConnected) return;
    this._loading = true;
    try {
      const sessions = await this.rpcExtract('LLMService.history_list_sessions', 50);
      if (Array.isArray(sessions)) {
        this._sessions = sessions;
      }
    } catch (e) {
      console.warn('Failed to load sessions:', e);
    } finally {
      this._loading = false;
    }
  }

  async _selectSession(sessionId) {
    this._selectedSessionId = sessionId;
    this._loadingMessages = true;
    this._sessionMessages = [];

    try {
      const messages = await this.rpcExtract('LLMService.history_get_session', sessionId);
      if (Array.isArray(messages)) {
        this._sessionMessages = messages;
      }
    } catch (e) {
      console.warn('Failed to load session messages:', e);
    } finally {
      this._loadingMessages = false;
    }
  }

  // === Search ===

  _onSearchInput(e) {
    this._searchQuery = e.target.value;
    clearTimeout(this._debounceTimer);

    if (!this._searchQuery.trim()) {
      this._mode = 'sessions';
      this._searchResults = [];
      return;
    }

    this._debounceTimer = setTimeout(() => this._runSearch(), 300);
  }

  async _runSearch() {
    const query = this._searchQuery.trim();
    if (!query || !this.rpcConnected) return;

    this._mode = 'search';
    this._loading = true;
    try {
      const results = await this.rpcExtract('LLMService.history_search', query, null, 50);
      if (Array.isArray(results)) {
        this._searchResults = results;
      }
    } catch (e) {
      console.warn('Search failed:', e);
    } finally {
      this._loading = false;
    }
  }

  _onSearchKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this._searchQuery) {
        this._searchQuery = '';
        this._mode = 'sessions';
        this._searchResults = [];
        const input = this.shadowRoot?.querySelector('.search-input');
        if (input) input.value = '';
      } else {
        this.hide();
      }
    }
  }

  // === Actions ===

  async _loadSessionIntoContext() {
    if (!this._selectedSessionId || !this.rpcConnected) return;

    try {
      const result = await this.rpcExtract(
        'LLMService.load_session_into_context',
        this._selectedSessionId
      );
      if (result?.error) {
        console.warn('Failed to load session:', result.error);
        return;
      }

      // Dispatch event so chat panel can update
      this.dispatchEvent(new CustomEvent('session-loaded', {
        detail: {
          sessionId: result.session_id,
          messages: result.messages || [],
          messageCount: result.message_count || 0,
        },
        bubbles: true, composed: true,
      }));

      this.hide();
    } catch (e) {
      console.warn('Failed to load session:', e);
    }
  }

  _copyMessage(msg) {
    const text = msg.content || '';
    navigator.clipboard.writeText(text).then(() => {
      this._showToast('Copied to clipboard');
    });
  }

  _pasteToPrompt(msg) {
    const text = msg.content || '';
    this.dispatchEvent(new CustomEvent('paste-to-prompt', {
      detail: { text },
      bubbles: true, composed: true,
    }));
    this.hide();
  }

  _showToast(message) {
    this._toast = message;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this._toast = null;
    }, 1500);
  }

  // === Event Handlers ===

  _onOverlayClick(e) {
    if (e.target === e.currentTarget) {
      this.hide();
    }
  }

  _onKeyDown(e) {
    if (e.key === 'Escape') {
      this.hide();
    }
  }

  // === Rendering ===

  _formatTimestamp(ts) {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      const now = new Date();
      const diffMs = now - d;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else if (diffDays === 1) {
        return 'Yesterday';
      } else if (diffDays < 7) {
        return d.toLocaleDateString([], { weekday: 'short' });
      } else {
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      }
    } catch {
      return '';
    }
  }

  _renderSessionItem(session) {
    const isSelected = session.session_id === this._selectedSessionId;
    const preview = session.preview || 'Empty session';
    const time = this._formatTimestamp(session.timestamp);
    const count = session.message_count || 0;

    return html`
      <div
        class="session-item ${isSelected ? 'selected' : ''}"
        @click=${() => this._selectSession(session.session_id)}
      >
        <div class="session-preview">${preview}</div>
        <div class="session-meta">
          <span>${time}</span>
          <span class="msg-count">${count} msg${count !== 1 ? 's' : ''}</span>
        </div>
      </div>
    `;
  }

  _renderSearchResultItem(result) {
    const preview = result.content?.slice(0, 100) || '';
    const role = result.role || 'user';
    const sessionId = result.session_id;

    return html`
      <div
        class="session-item ${sessionId === this._selectedSessionId ? 'selected' : ''}"
        @click=${() => {
          if (sessionId) this._selectSession(sessionId);
        }}
      >
        <div class="session-preview">
          <span style="color: ${role === 'user' ? 'var(--accent-primary)' : 'var(--accent-green)'}; font-size: 0.7rem; font-weight: 600;">
            ${role.toUpperCase()}
          </span>
          ${preview}
        </div>
        <div class="session-meta">
          <span>${this._formatTimestamp(result.timestamp)}</span>
        </div>
      </div>
    `;
  }

  _renderMessage(msg) {
    const isUser = msg.role === 'user';
    const content = msg.content || '';
    const images = msg.images;

    return html`
      <div class="msg-card ${isUser ? 'user' : 'assistant'}">
        <div class="msg-role">${isUser ? 'You' : 'Assistant'}</div>
        <div class="msg-content">
          ${unsafeHTML(renderSimpleMarkdown(content))}
        </div>
        ${Array.isArray(images) && images.length > 0 ? html`
          <div class="msg-images">
            ${images.map(img => html`<img src="${img}" alt="Image">`)}
          </div>
        ` : nothing}
        <div class="msg-actions">
          <button class="msg-action-btn" title="Copy" @click=${() => this._copyMessage(msg)}>📋</button>
          <button class="msg-action-btn" title="Paste to prompt" @click=${() => this._pasteToPrompt(msg)}>↩</button>
        </div>
      </div>
    `;
  }

  _renderLeftPanel() {
    if (this._loading && this._sessions.length === 0 && this._searchResults.length === 0) {
      return html`<div class="loading">Loading...</div>`;
    }

    if (this._mode === 'search') {
      if (this._searchResults.length === 0) {
        return html`<div class="empty-state">No results found</div>`;
      }
      return html`
        <div class="session-list">
          ${this._searchResults.map(r => this._renderSearchResultItem(r))}
        </div>
      `;
    }

    if (this._sessions.length === 0) {
      return html`<div class="empty-state">No sessions yet</div>`;
    }

    return html`
      <div class="session-list">
        ${this._sessions.map(s => this._renderSessionItem(s))}
      </div>
    `;
  }

  _renderRightPanel() {
    if (!this._selectedSessionId) {
      return html`<div class="empty-state">Select a session to view messages</div>`;
    }

    if (this._loadingMessages) {
      return html`<div class="loading">Loading messages...</div>`;
    }

    if (this._sessionMessages.length === 0) {
      return html`<div class="empty-state">No messages in this session</div>`;
    }

    return html`
      <div class="message-panel-header">
        <span class="session-info">
          ${this._sessionMessages.length} message${this._sessionMessages.length !== 1 ? 's' : ''}
        </span>
        <button
          class="load-session-btn"
          @click=${this._loadSessionIntoContext}
          ?disabled=${!this.rpcConnected}
          aria-label="Load this session into current context"
        >Load into context</button>
      </div>
      <div class="message-list">
        ${this._sessionMessages.map(m => this._renderMessage(m))}
      </div>
    `;
  }

  render() {
    if (!this.open) return nothing;

    return html`
      <div class="modal-overlay"
        @click=${this._onOverlayClick}
        @keydown=${this._onKeyDown}
      >
        <div class="modal" role="dialog" aria-modal="true" aria-label="History browser"
             @click=${(e) => e.stopPropagation()}>
          <div class="modal-header">
            <span class="modal-title" id="history-dialog-title">📜 History</span>
            <input
              class="search-input"
              type="text"
              placeholder="Search conversations..."
              aria-label="Search conversations"
              .value=${this._searchQuery}
              @input=${this._onSearchInput}
              @keydown=${this._onSearchKeyDown}
            >
            <button class="close-btn" @click=${this.hide} title="Close (Esc)" aria-label="Close history browser">✕</button>
          </div>

          <div class="modal-body">
            <div class="session-panel" role="region" aria-label="Session list">
              ${this._renderLeftPanel()}
            </div>
            <div class="message-panel" role="region" aria-label="Session messages">
              ${this._renderRightPanel()}
            </div>
          </div>
        </div>

        ${this._toast ? html`
          <div class="toast">${this._toast}</div>
        ` : nothing}
      </div>
    `;
  }
}

customElements.define('ac-history-browser', AcHistoryBrowser);