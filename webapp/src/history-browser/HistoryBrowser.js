import { LitElement, html } from 'lit';
import { historyBrowserStyles } from './HistoryBrowserStyles.js';
import { renderHistoryBrowser } from './HistoryBrowserTemplate.js';
import { formatTimestamp, truncateContent } from '../utils/formatters.js';
import { extractResponse } from '../utils/rpc.js';

export class HistoryBrowser extends LitElement {
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
    this._searchDebounceTimer = null;
  }

  async show() {
    this.visible = true;
    await this.loadSessions();
  }

  hide() {
    this.visible = false;
    this.selectedSessionId = null;
    this.selectedSession = [];
    this.searchQuery = '';
    this.searchResults = [];
    this.isSearching = false;
  }

  async loadSessions() {
    this.isLoading = true;
    try {
      const response = await this._call('LiteLLM.history_list_sessions', 50);
      this.sessions = extractResponse(response) || [];
    } catch (e) {
      console.error('Error loading sessions:', e);
      this.sessions = [];
    }
    this.isLoading = false;
  }

  async selectSession(sessionId) {
    this.selectedSessionId = sessionId;
    this.isLoading = true;
    try {
      const response = await this._call('LiteLLM.history_get_session', sessionId);
      this.selectedSession = extractResponse(response) || [];
    } catch (e) {
      console.error('Error loading session:', e);
      this.selectedSession = [];
    }
    this.isLoading = false;
  }

  handleSearchInput(e) {
    this.searchQuery = e.target.value;
    
    // Debounce search
    if (this._searchDebounceTimer) {
      clearTimeout(this._searchDebounceTimer);
    }
    
    if (this.searchQuery.trim()) {
      this._searchDebounceTimer = setTimeout(() => this.performSearch(), 300);
    } else {
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
    this.isLoading = true;
    
    try {
      const response = await this._call('LiteLLM.history_search', this.searchQuery, null, 100);
      this.searchResults = extractResponse(response) || [];
    } catch (e) {
      console.error('Error searching:', e);
      this.searchResults = [];
    }
    
    this.isLoading = false;
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
    this.dispatchEvent(new CustomEvent('load-session', {
      detail: { messages: this.selectedSession },
      bubbles: true,
      composed: true
    }));
    this.hide();
  }

  formatTimestamp(isoString) {
    return formatTimestamp(isoString);
  }

  truncateContent(content, maxLength = 200) {
    return truncateContent(content, maxLength);
  }

  _call(method, ...args) {
    // This will be set by the parent component
    if (this.rpcCall) {
      return this.rpcCall[method](...args);
    }
    return Promise.reject(new Error('RPC not available'));
  }

  render() {
    return renderHistoryBrowser(this);
  }
}

customElements.define('history-browser', HistoryBrowser);
