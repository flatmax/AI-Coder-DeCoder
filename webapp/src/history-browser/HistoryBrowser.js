import { LitElement, html } from 'lit';
import { historyBrowserStyles } from './HistoryBrowserStyles.js';
import { renderHistoryBrowser } from './HistoryBrowserTemplate.js';
import { RpcMixin, debounce } from '../utils/rpc.js';

export class HistoryBrowser extends RpcMixin(LitElement) {
  static properties = {
    visible: { type: Boolean },
    sessions: { type: Array },
    selectedSessionId: { type: String },
    selectedSession: { type: Array },
    searchQuery: { type: String },
    searchResults: { type: Array },
    isSearching: { type: Boolean },
    isLoading: { type: Boolean }
  };

  static styles = historyBrowserStyles;

  constructor() {
    super();
    this.visible = false;
    this.sessions = [];
    this.selectedSessionId = null;
    this.selectedSession = [];
    this.searchQuery = '';
    this.searchResults = [];
    this.isSearching = false;
    this.isLoading = false;
    this._debouncedSearch = debounce(() => this.performSearch(), 300);
    this._messagesScrollTop = 0;
    this._sessionsScrollTop = 0;
    this._sessionsLoadedAt = 0;  // Timestamp of last session list fetch
    this._sessionsCacheTTL = 10000;  // 10 seconds before refetching
  }

  onRpcReady() {
    // Auto-load sessions when RPC becomes available and visible
    if (this.visible) {
      this.loadSessions();
    }
  }

  async show() {
    this.visible = true;
    await this.loadSessions();
    
    // Restore scroll positions after render
    await this.updateComplete;
    const messagesPanel = this.shadowRoot?.querySelector('.messages-panel');
    const sessionsPanel = this.shadowRoot?.querySelector('.sessions-panel');
    if (messagesPanel) messagesPanel.scrollTop = this._messagesScrollTop;
    if (sessionsPanel) sessionsPanel.scrollTop = this._sessionsScrollTop;
  }

  hide() {
    // Save scroll positions before hiding
    const messagesPanel = this.shadowRoot?.querySelector('.messages-panel');
    const sessionsPanel = this.shadowRoot?.querySelector('.sessions-panel');
    if (messagesPanel) this._messagesScrollTop = messagesPanel.scrollTop;
    if (sessionsPanel) this._sessionsScrollTop = sessionsPanel.scrollTop;
    
    this.visible = false;
    // Keep selectedSessionId, selectedSession, searchQuery, searchResults, isSearching
    // so reopening preserves state
  }

  async loadSessions(force = false) {
    // Skip refetch if sessions were loaded recently (within TTL)
    const now = Date.now();
    if (!force && this.sessions.length > 0 && (now - this._sessionsLoadedAt) < this._sessionsCacheTTL) {
      return;
    }
    const result = await this._rpcWithState('LiteLLM.history_list_sessions', {}, 50);
    this.sessions = result || [];
    this._sessionsLoadedAt = Date.now();
  }

  async selectSession(sessionId, messageId = null) {
    // Only reload if switching sessions
    if (this.selectedSessionId !== sessionId) {
      this.selectedSessionId = sessionId;
      const result = await this._rpcWithState('LiteLLM.history_get_session', {}, sessionId);
      this.selectedSession = result || [];
    }
    
    // Scroll to specific message if provided
    if (messageId) {
      this._scrollToMessage(messageId);
    }
  }

  _scrollToMessage(messageId) {
    // Wait for render, then scroll
    this.updateComplete.then(() => {
      const msgEl = this.shadowRoot?.querySelector(`[data-message-id="${messageId}"]`);
      if (msgEl) {
        msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        msgEl.classList.add('highlight');
        setTimeout(() => msgEl.classList.remove('highlight'), 2000);
      }
    });
  }

  handleSearchInput(e) {
    this.searchQuery = e.target.value;
    
    if (this.searchQuery.trim()) {
      this._debouncedSearch();
    } else {
      this._debouncedSearch.cancel();
      this.searchResults = [];
      this.isSearching = false;
    }
  }

  async performSearch() {
    if (!this.searchQuery.trim()) {
      this.searchResults = [];
      this.isSearching = false;
      return;
    }
    
    this.isSearching = true;
    const result = await this._rpcWithState('LiteLLM.history_search', {}, this.searchQuery, null, 100);
    this.searchResults = result || [];
  }

  copyToClipboard(content) {
    navigator.clipboard.writeText(content);
  }

  copyToPrompt(content) {
    this.dispatchEvent(new CustomEvent('copy-to-prompt', {
      detail: { content },
      bubbles: true,
      composed: true
    }));
  }

  loadSessionToChat() {
    if (!this.selectedSession || this.selectedSession.length === 0) {
      return;
    }
    // Invalidate session cache since loading a session means context changed
    this._sessionsLoadedAt = 0;
    this.dispatchEvent(new CustomEvent('load-session', {
      detail: { messages: this.selectedSession, sessionId: this.selectedSessionId },
      bubbles: true,
      composed: true
    }));
    this.hide();
  }

  render() {
    return renderHistoryBrowser(this);
  }
}

customElements.define('history-browser', HistoryBrowser);
