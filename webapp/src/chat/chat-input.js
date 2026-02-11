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
    /** Array of user message strings from conversation history (most recent first, deduplicated) */
    userMessageHistory: { type: Array },
    _images: { type: Array, state: true },
    _showSnippets: { type: Boolean, state: true },
    _showHistorySearch: { type: Boolean, state: true },
    _historySearchQuery: { type: String, state: true },
    _historySearchResults: { type: Array, state: true },
    _historySearchIndex: { type: Number, state: true },
    _savedInputBeforeHistory: { type: String, state: true },
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

    .stop-btn {
      background: var(--accent-error, #ef5350);
      border: none;
      border-radius: var(--radius-sm);
      padding: 8px 14px;
      color: white;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      flex-shrink: 0;
      transition: opacity var(--transition-fast);
    }
    .stop-btn:hover { opacity: 0.85; }

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

    /* Input history search overlay */
    .history-overlay {
      position: absolute;
      bottom: 100%;
      left: 12px;
      right: 12px;
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      max-height: 340px;
      display: flex;
      flex-direction: column;
      z-index: 50;
    }

    .history-search-input {
      padding: 8px 10px;
      background: var(--bg-primary);
      border: none;
      border-bottom: 1px solid var(--border-color);
      border-radius: var(--radius-md) var(--radius-md) 0 0;
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 12.5px;
      outline: none;
    }
    .history-search-input::placeholder { color: var(--text-muted); }

    .history-results {
      overflow-y: auto;
      flex: 1;
      min-height: 0;
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
    this.userMessageHistory = [];
    this._images = [];
    this._showSnippets = false;
    this._showHistorySearch = false;
    this._historySearchQuery = '';
    this._historySearchResults = [];
    this._historySearchIndex = 0;
    this._savedInputBeforeHistory = undefined;
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

    // If history search is open, don't handle keys on the textarea
    // (the overlay input handles its own keys)
    if (this._showHistorySearch) return;

    // Enter to send (without shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this._send();
      return;
    }

    // Escape — close snippets or clear input
    if (e.key === 'Escape') {
      if (this._showSnippets) { this._showSnippets = false; return; }
      textarea.value = '';
      this._autoResize(textarea);
      return;
    }

    // Up arrow at position 0 — open history search
    if (e.key === 'ArrowUp' && textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
      this._openHistorySearch();
      e.preventDefault();
      return;
    }

    // Down arrow at end — restore saved input from before history search
    if (e.key === 'ArrowDown' && this._savedInputBeforeHistory !== undefined &&
        textarea.selectionStart === textarea.value.length) {
      textarea.value = this._savedInputBeforeHistory;
      this._savedInputBeforeHistory = undefined;
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
    this._showHistorySearch = false;
    this._savedInputBeforeHistory = undefined;
    this._lastDetectedText = '';
    if (this._urlDetectTimer) {
      clearTimeout(this._urlDetectTimer);
      this._urlDetectTimer = null;
    }
  }

  _stop() {
    this.dispatchEvent(new CustomEvent('stop-streaming', {
      bubbles: true, composed: true,
    }));
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

  // ── Input history search ──

  /** Get deduplicated user messages from conversation history, most recent first */
  _getUserMessageHistory() {
    if (!this.userMessageHistory || this.userMessageHistory.length === 0) return [];
    return this.userMessageHistory;
  }

  _openHistorySearch() {
    const history = this._getUserMessageHistory();
    if (history.length === 0) return;
    const textarea = this.shadowRoot.querySelector('textarea');
    this._savedInputBeforeHistory = textarea?.value || '';
    this._historySearchQuery = '';
    // Reverse so oldest is first (index 0 = top), newest is last (bottom)
    this._historySearchResults = [...history].reverse().slice(-20);
    this._historySearchIndex = this._historySearchResults.length - 1; // Select newest (bottom)
    this._showHistorySearch = true;
    this._showSnippets = false;
    // Focus the search input and scroll to bottom after render
    this.updateComplete.then(() => {
      this.shadowRoot.querySelector('.history-search-input')?.focus();
      this._scrollHistoryToBottom();
    });
  }

  _onHistorySearchInput(e) {
    const query = e.target.value;
    this._historySearchQuery = query;
    this._filterHistoryResults(query);
    // Select newest (bottom) after filtering
    this._historySearchIndex = this._historySearchResults.length - 1;
    this.updateComplete.then(() => this._scrollHistoryToBottom());
  }

  _filterHistoryResults(query) {
    const history = this._getUserMessageHistory();
    if (!query.trim()) {
      // Reverse so oldest first (top), newest last (bottom)
      this._historySearchResults = [...history].reverse().slice(-20);
      return;
    }

    const q = query.toLowerCase();

    // Score each message: exact substring first (scored by position), then fuzzy
    const scored = [];
    for (const msg of history) {
      const lower = msg.toLowerCase();
      const substringIdx = lower.indexOf(q);
      if (substringIdx !== -1) {
        // Exact substring match — score by position (earlier = better)
        scored.push({ msg, score: 1000 - substringIdx });
      } else if (this._fuzzyMatch(q, lower)) {
        // Fuzzy match — lower priority
        scored.push({ msg, score: 0 });
      }
    }

    // Sort: exact substring matches first (by score desc), then fuzzy
    // Then reverse so newest matches are at the bottom
    scored.sort((a, b) => b.score - a.score);
    this._historySearchResults = scored.slice(0, 20).map(s => s.msg).reverse();
  }

  /** Fuzzy match: all characters in query appear in order in text */
  _fuzzyMatch(query, text) {
    let qi = 0;
    for (let ti = 0; ti < text.length && qi < query.length; ti++) {
      if (text[ti] === query[qi]) qi++;
    }
    return qi === query.length;
  }

  _onHistorySearchKeyDown(e) {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this._historySearchIndex > 0) {
        this._historySearchIndex--;
      }
      this._scrollHistoryItemIntoView();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (this._historySearchIndex < this._historySearchResults.length - 1) {
        this._historySearchIndex++;
      } else {
        // Past the newest — restore saved input and close
        this._restoreAndClose();
        return;
      }
      this._scrollHistoryItemIntoView();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      this._selectHistoryResult();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      this._restoreAndClose();
      return;
    }
  }

  _scrollHistoryItemIntoView() {
    this.updateComplete.then(() => {
      this.shadowRoot.querySelector('.history-item.selected')
        ?.scrollIntoView({ block: 'nearest' });
    });
  }

  _scrollHistoryToBottom() {
    const container = this.shadowRoot.querySelector('.history-results');
    if (container) container.scrollTop = container.scrollHeight;
  }

  _restoreAndClose() {
    const textarea = this.shadowRoot.querySelector('textarea');
    if (textarea && this._savedInputBeforeHistory !== undefined) {
      textarea.value = this._savedInputBeforeHistory;
      this._autoResize(textarea);
    }
    this._savedInputBeforeHistory = undefined;
    this._showHistorySearch = false;
    this.updateComplete.then(() => {
      this.shadowRoot.querySelector('textarea')?.focus();
    });
  }

  _selectHistoryResult() {
    const results = this._historySearchResults;
    if (this._historySearchIndex >= 0 && this._historySearchIndex < results.length) {
      const textarea = this.shadowRoot.querySelector('textarea');
      if (textarea) {
        textarea.value = results[this._historySearchIndex];
        this._autoResize(textarea);
      }
    }
    this._showHistorySearch = false;
    // Focus textarea after closing
    this.updateComplete.then(() => {
      this.shadowRoot.querySelector('textarea')?.focus();
    });
  }

  _closeHistorySearch() {
    this._restoreAndClose();
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

        ${this._showHistorySearch ? html`
          <div class="history-overlay">
            <input class="history-search-input"
              type="text"
              placeholder="Search message history…"
              .value=${this._historySearchQuery}
              @input=${this._onHistorySearchInput}
              @keydown=${this._onHistorySearchKeyDown}
            >
            <div class="history-results">
              ${this._historySearchResults.length === 0 ? html`
                <div class="history-item" style="color:var(--text-muted); cursor:default;">
                  No matches
                </div>
              ` : this._historySearchResults.map((item, i) => html`
                <div class="history-item ${i === this._historySearchIndex ? 'selected' : ''}"
                  @click=${() => { this._historySearchIndex = i; this._selectHistoryResult(); }}>
                  ${item.length > 120 ? item.substring(0, 120) + '…' : item}
                </div>
              `)}
            </div>
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

          ${this.disabled ? html`
            <button class="stop-btn" @click=${this._stop}>
              ⏹ Stop
            </button>
          ` : html`
            <button class="send-btn" @click=${this._send}>
              Send
            </button>
          `}
        </div>
      </div>
    `;
  }
}

customElements.define('chat-input', ChatInput);