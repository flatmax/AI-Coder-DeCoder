import { LitElement, html, css, nothing } from 'lit';
import { RpcMixin } from '../rpc-mixin.js';

const DEBOUNCE_MS = 300;
const SESSION_CACHE_TTL = 10000; // 10s

/**
 * History Browser — modal overlay for browsing past conversations.
 * Left panel: session list or search results.
 * Right panel: messages for selected session.
 */
class HistoryBrowser extends RpcMixin(LitElement) {
  static properties = {
    open: { type: Boolean, reflect: true },
    _sessions: { type: Array, state: true },
    _selectedId: { type: String, state: true },
    _messages: { type: Array, state: true },
    _query: { type: String, state: true },
    _searchResults: { type: Array, state: true },
    _searching: { type: Boolean, state: true },
    _loadingSessions: { type: Boolean, state: true },
    _loadingMessages: { type: Boolean, state: true },
    _highlightMsgId: { type: String, state: true },
  };

  static styles = css`
    :host { display: contents; }

    .backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 200;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fade-in 0.15s ease;
    }

    @keyframes fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .modal {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      width: min(900px, 90vw);
      height: min(600px, 80vh);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: slide-up 0.15s ease;
    }

    @keyframes slide-up {
      from { transform: translateY(12px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    /* ── Header ── */
    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-color);
      background: var(--bg-elevated);
      flex-shrink: 0;
    }

    .header-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .header-search {
      flex: 1;
      margin: 0 12px;
    }

    .search-input {
      width: 100%;
      padding: 5px 10px;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-size: 12px;
      font-family: var(--font-mono);
      outline: none;
      box-sizing: border-box;
    }
    .search-input:focus { border-color: var(--accent-primary); }
    .search-input::placeholder { color: var(--text-muted); }

    .header-actions {
      display: flex;
      gap: 6px;
      flex-shrink: 0;
    }

    .header-btn {
      background: none;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 4px 10px;
      cursor: pointer;
      font-size: 11px;
      color: var(--text-secondary);
      transition: background var(--transition-fast), color var(--transition-fast);
      white-space: nowrap;
    }
    .header-btn:hover {
      background: var(--bg-surface);
      color: var(--text-primary);
    }
    .header-btn.primary {
      background: var(--accent-primary);
      color: white;
      border-color: var(--accent-primary);
    }
    .header-btn.primary:hover { opacity: 0.9; }
    .header-btn.primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .close-btn {
      background: none;
      border: none;
      padding: 4px 8px;
      cursor: pointer;
      font-size: 16px;
      color: var(--text-muted);
      border-radius: var(--radius-sm);
      transition: color var(--transition-fast);
      line-height: 1;
    }
    .close-btn:hover { color: var(--text-primary); }

    /* ── Body ── */
    .body {
      display: flex;
      flex: 1;
      overflow: hidden;
      min-height: 0;
    }

    /* ── Left panel (session list) ── */
    .left-panel {
      width: 280px;
      min-width: 200px;
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      flex-shrink: 0;
    }

    .session-list {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }

    .session-item {
      padding: 8px 12px;
      cursor: pointer;
      border-left: 3px solid transparent;
      transition: background var(--transition-fast);
    }
    .session-item:hover { background: var(--bg-surface); }
    .session-item.selected {
      background: var(--bg-surface);
      border-left-color: var(--accent-primary);
    }

    .session-time {
      font-size: 10px;
      color: var(--text-muted);
      margin-bottom: 2px;
    }

    .session-preview {
      font-size: 12px;
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .session-count {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    .list-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 12px;
      padding: 20px;
      text-align: center;
    }

    .list-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: var(--text-muted);
      font-size: 12px;
      gap: 6px;
    }

    .spinner {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid var(--border-color);
      border-top-color: var(--accent-primary);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Right panel (messages) ── */
    .right-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-width: 0;
    }

    .messages-container {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }

    .messages-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 12px;
    }

    .msg-card {
      margin-bottom: 10px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      overflow: hidden;
      background: var(--bg-elevated);
      transition: border-color 0.3s ease;
    }
    .msg-card.highlighted {
      border-color: var(--accent-primary);
      box-shadow: 0 0 0 1px var(--accent-primary);
    }

    .msg-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
    }

    .msg-role {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 1px 5px;
      border-radius: 3px;
      color: white;
    }
    .msg-role.user { background: var(--accent-primary); }
    .msg-role.assistant { background: #7c4dff; }

    .msg-meta {
      font-size: 10px;
      color: var(--text-muted);
      flex: 1;
    }

    .msg-actions {
      display: flex;
      gap: 2px;
    }

    .msg-action-btn {
      background: none;
      border: none;
      padding: 2px 5px;
      cursor: pointer;
      font-size: 12px;
      color: var(--text-muted);
      border-radius: var(--radius-sm);
      transition: color var(--transition-fast), background var(--transition-fast);
      line-height: 1;
    }
    .msg-action-btn:hover {
      color: var(--text-primary);
      background: var(--bg-surface);
    }

    .msg-content {
      padding: 8px 10px;
      font-size: 12px;
      color: var(--text-secondary);
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 300px;
      overflow-y: auto;
    }

    .msg-files {
      padding: 4px 10px 6px;
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .file-badge {
      font-size: 10px;
      font-family: var(--font-mono);
      padding: 1px 6px;
      background: var(--bg-surface);
      border-radius: 3px;
      color: var(--text-muted);
    }

    /* ── Search result items ── */
    .search-item {
      padding: 8px 12px;
      cursor: pointer;
      border-left: 3px solid transparent;
      transition: background var(--transition-fast);
    }
    .search-item:hover { background: var(--bg-surface); }

    .search-item-role {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--text-muted);
    }

    .search-item-preview {
      font-size: 12px;
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-top: 2px;
    }

    .search-item-session {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    .search-highlight {
      background: rgba(79, 195, 247, 0.2);
      color: var(--accent-primary);
      border-radius: 2px;
    }
  `;

  constructor() {
    super();
    this.open = false;
    this._sessions = [];
    this._selectedId = null;
    this._messages = [];
    this._query = '';
    this._searchResults = [];
    this._searching = false;
    this._loadingSessions = false;
    this._loadingMessages = false;
    this._highlightMsgId = null;
    this._debounceTimer = null;
    this._sessionsLoadedAt = 0;
  }

  // ── Lifecycle ──

  updated(changed) {
    if (changed.has('open') && this.open) {
      this._onOpen();
    }
  }

  _onOpen() {
    // Refresh sessions if stale or never loaded
    const now = Date.now();
    if (!this._sessions.length || now - this._sessionsLoadedAt > SESSION_CACHE_TTL) {
      this._loadSessions();
    }
    // Focus search input
    this.updateComplete.then(() => {
      this.shadowRoot.querySelector('.search-input')?.focus();
    });
  }

  // ── Data loading ──

  async _loadSessions() {
    if (!this.rpcConnected) return;
    this._loadingSessions = true;
    try {
      const sessions = await this.rpcExtract('LLM.history_list_sessions', 50);
      if (Array.isArray(sessions)) {
        this._sessions = sessions;
        this._sessionsLoadedAt = Date.now();
      }
    } catch (e) {
      console.warn('Failed to load sessions:', e);
    } finally {
      this._loadingSessions = false;
    }
  }

  async _selectSession(sessionId) {
    if (this._selectedId === sessionId) return;
    this._selectedId = sessionId;
    this._messages = [];
    this._highlightMsgId = null;
    this._loadingMessages = true;
    try {
      const messages = await this.rpcExtract('LLM.history_get_session', sessionId);
      if (Array.isArray(messages)) {
        this._messages = messages;
      }
    } catch (e) {
      console.warn('Failed to load session:', e);
    } finally {
      this._loadingMessages = false;
    }
  }

  // ── Search ──

  _onSearchInput(e) {
    this._query = e.target.value;
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    if (!this._query.trim()) {
      this._searchResults = [];
      this._searching = false;
      return;
    }
    this._debounceTimer = setTimeout(() => this._executeSearch(), DEBOUNCE_MS);
  }

  async _executeSearch() {
    const query = this._query.trim();
    if (!query || !this.rpcConnected) return;
    this._searching = true;
    try {
      const results = await this.rpcExtract('LLM.history_search', query, null, 50);
      if (Array.isArray(results)) {
        this._searchResults = results;
      }
    } catch (e) {
      console.warn('Search failed:', e);
    } finally {
      this._searching = false;
    }
  }

  _onSearchResultClick(result) {
    // Select the session and highlight the message
    this._highlightMsgId = result.id || null;
    if (result.session_id && result.session_id !== this._selectedId) {
      this._selectSession(result.session_id).then(() => {
        this._scrollToHighlighted();
      });
    } else {
      this._scrollToHighlighted();
    }
  }

  _scrollToHighlighted() {
    this.updateComplete.then(() => {
      const el = this.shadowRoot.querySelector('.msg-card.highlighted');
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  // ── Actions ──

  async _loadIntoContext() {
    if (!this._selectedId || !this.rpcConnected) return;
    try {
      const result = await this.rpcExtract(
        'LLM.load_session_into_context', this._selectedId
      );
      if (result?.error) {
        console.error('Load session failed:', result.error);
        return;
      }
      // Use server-returned messages which include reconstructed images
      const messages = result.messages || this._messages.map(m => ({
        role: m.role,
        content: m.content,
      }));
      // Dispatch event so files-tab rebuilds messages
      this.dispatchEvent(new CustomEvent('session-loaded', {
        detail: {
          sessionId: this._selectedId,
          messages,
        },
        bubbles: true, composed: true,
      }));
      this._close();
    } catch (e) {
      console.error('Load session failed:', e);
    }
  }

  async _copyMessage(msg) {
    try {
      await navigator.clipboard.writeText(msg.content);
    } catch (e) {
      console.warn('Copy failed:', e);
    }
  }

  _toPrompt(msg) {
    this.dispatchEvent(new CustomEvent('insert-to-prompt', {
      detail: { text: msg.content },
      bubbles: true, composed: true,
    }));
    this._close();
  }

  _close() {
    this.open = false;
    this.dispatchEvent(new CustomEvent('history-closed', {
      bubbles: true, composed: true,
    }));
  }

  _onBackdropClick(e) {
    if (e.target === e.currentTarget) this._close();
  }

  _onKeyDown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      this._close();
    }
  }

  // ── Formatting helpers ──

  _formatTime(timestamp) {
    if (!timestamp) return '';
    try {
      const d = new Date(timestamp);
      const now = new Date();
      const diffMs = now - d;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else if (diffDays === 1) {
        return 'Yesterday ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else if (diffDays < 7) {
        return d.toLocaleDateString([], { weekday: 'short' }) + ' ' +
          d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return String(timestamp).slice(0, 16);
    }
  }

  _truncate(text, len = 100) {
    if (!text) return '';
    const clean = text.replace(/\n/g, ' ').trim();
    if (clean.length <= len) return clean;
    return clean.slice(0, len) + '…';
  }

  _highlightQuery(text, query) {
    if (!query || !text) return text;
    const truncated = this._truncate(text, 120);
    try {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(${escaped})`, 'gi');
      const parts = truncated.split(pattern);
      if (parts.length <= 1) return truncated;
      return parts.map((part, i) =>
        i % 2 === 1
          ? html`<span class="search-highlight">${part}</span>`
          : part
      );
    } catch {
      return truncated;
    }
  }

  // ── Render ──

  render() {
    if (!this.open) return nothing;

    const isSearching = this._query.trim().length > 0;

    return html`
      <div class="backdrop" @click=${this._onBackdropClick} @keydown=${this._onKeyDown}
        role="dialog" aria-modal="true" aria-label="History browser">
        <div class="modal">
          <div class="header">
            <span class="header-title" id="history-dialog-title">📜 History</span>
            <div class="header-search">
              <input type="text"
                class="search-input"
                placeholder="Search messages..."
                aria-label="Search conversation history"
                .value=${this._query}
                @input=${this._onSearchInput}
                @keydown=${(e) => e.key === 'Escape' && this._close()}
              >
            </div>
            <div class="header-actions">
              <button class="header-btn primary"
                ?disabled=${!this._selectedId}
                @click=${this._loadIntoContext}
                title="Load selected session into active context"
                aria-label="Load selected session into active context">
                Load Session
              </button>
            </div>
            <button class="close-btn" @click=${this._close} title="Close" aria-label="Close history browser">✕</button>
          </div>
          <div class="body">
            <div class="left-panel" role="navigation" aria-label="Sessions">
              <div class="session-list" role="listbox" aria-label="Session list">
                ${isSearching
                  ? this._renderSearchResults()
                  : this._renderSessionList()}
              </div>
            </div>
            <div class="right-panel">
              ${this._loadingMessages ? html`
                <div class="messages-empty" role="status"><span class="spinner" aria-hidden="true"></span>&nbsp; Loading...</div>
              ` : this._messages.length === 0 ? html`
                <div class="messages-empty">
                  ${this._selectedId ? 'No messages in this session' : 'Select a session to view messages'}
                </div>
              ` : html`
                <div class="messages-container" role="log" aria-label="Session messages">
                  ${this._messages.map(msg => this._renderMessage(msg))}
                </div>
              `}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _renderSessionList() {
    if (this._loadingSessions) {
      return html`<div class="list-loading"><span class="spinner"></span> Loading sessions...</div>`;
    }
    if (this._sessions.length === 0) {
      return html`<div class="list-empty">No sessions yet</div>`;
    }
    return this._sessions.map(s => html`
      <div class="session-item ${this._selectedId === s.session_id ? 'selected' : ''}"
        role="option"
        aria-selected=${this._selectedId === s.session_id}
        @click=${() => this._selectSession(s.session_id)}>
        <div class="session-time">${this._formatTime(s.timestamp)}</div>
        <div class="session-preview">${this._truncate(s.preview, 80)}</div>
        <div class="session-count">${s.message_count || 0} messages</div>
      </div>
    `);
  }

  _renderSearchResults() {
    if (this._searching) {
      return html`<div class="list-loading"><span class="spinner"></span> Searching...</div>`;
    }
    if (this._searchResults.length === 0) {
      return html`<div class="list-empty">
        ${this._query.trim() ? `No results for "${this._query}"` : 'Type to search'}
      </div>`;
    }
    return this._searchResults.map(r => html`
      <div class="search-item" @click=${() => this._onSearchResultClick(r)}>
        <span class="search-item-role">${r.role || '?'}</span>
        <div class="search-item-preview">
          ${this._highlightQuery(r.content, this._query.trim())}
        </div>
        <div class="search-item-session">${this._formatTime(r.timestamp)}</div>
      </div>
    `);
  }

  _renderMessage(msg) {
    const isHighlighted = this._highlightMsgId && msg.id === this._highlightMsgId;
    return html`
      <div class="msg-card ${isHighlighted ? 'highlighted' : ''}" role="article"
        aria-label="${msg.role} message">
        <div class="msg-header">
          <span class="msg-role ${msg.role}">${msg.role}</span>
          <span class="msg-meta">${this._formatTime(msg.timestamp)}</span>
          <div class="msg-actions" role="toolbar" aria-label="Message actions">
            <button class="msg-action-btn" @click=${() => this._copyMessage(msg)}
              title="Copy to clipboard" aria-label="Copy to clipboard">📋</button>
            <button class="msg-action-btn" @click=${() => this._toPrompt(msg)}
              title="Insert into prompt" aria-label="Insert into prompt">📝</button>
          </div>
        </div>
        <div class="msg-content">${msg.content || ''}</div>
        ${msg.images?.length ? html`
          <div class="msg-files" style="gap:6px; padding:6px 10px;">
            ${msg.images.map(src => html`
              <img src=${src} style="max-width:80px; max-height:80px; border-radius:4px; border:1px solid var(--border-color);"
                alt="Attached image" title="Attached image">
            `)}
          </div>
        ` : nothing}
        ${msg.files?.length ? html`
          <div class="msg-files">
            ${msg.files.map(f => html`<span class="file-badge">${f}</span>`)}
          </div>
        ` : nothing}
        ${msg.files_modified?.length ? html`
          <div class="msg-files">
            ${msg.files_modified.map(f => html`<span class="file-badge">✏️ ${f}</span>`)}
          </div>
        ` : nothing}
      </div>
    `;
  }
}

customElements.define('history-browser', HistoryBrowser);