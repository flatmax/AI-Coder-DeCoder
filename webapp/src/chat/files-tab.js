import { LitElement, html, css } from 'lit';
import { RpcMixin } from '../rpc-mixin.js';
import './chat-panel.js';
import './chat-input.js';
import './url-chips.js';

/**
 * Files & Chat tab — left panel (file picker placeholder) + right panel (chat).
 * This orchestrates chat state, streaming, URL state, and message flow.
 */
class FilesTab extends RpcMixin(LitElement) {
  static properties = {
    messages: { type: Array, state: true },
    selectedFiles: { type: Array, state: true },
    streaming: { type: Boolean, state: true },
    snippets: { type: Array, state: true },
    _activeRequestId: { type: String, state: true },
    _detectedUrls: { type: Array, state: true },
    _fetchedUrls: { type: Array, state: true },
    _excludedUrls: { type: Object, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      height: 100%;
      overflow: hidden;
    }

    .file-picker-panel {
      width: 280px;
      min-width: 150px;
      max-width: 500px;
      border-right: 1px solid var(--border-color);
      background: var(--bg-secondary);
      overflow: auto;
      flex-shrink: 0;
    }

    .file-picker-placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 13px;
      padding: 12px;
      text-align: center;
    }

    .chat-panel-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-width: 0;
    }
  `;

  constructor() {
    super();
    this.messages = [];
    this.selectedFiles = [];
    this.streaming = false;
    this.snippets = [];
    this._activeRequestId = null;
    this._watchdogTimer = null;
    this._detectedUrls = [];
    this._fetchedUrls = [];
    this._excludedUrls = new Set();
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('state-loaded', this._onStateLoaded.bind(this));
    window.addEventListener('stream-complete', this._onStreamComplete.bind(this));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('state-loaded', this._onStateLoaded);
    window.removeEventListener('stream-complete', this._onStreamComplete);
    this._clearWatchdog();
  }

  onRpcReady() {
    this._loadSnippets();
  }

  async _loadSnippets() {
    try {
      const result = await this.rpcExtract('Settings.get_snippets');
      this.snippets = result?.snippets || [];
    } catch (e) {
      console.warn('Failed to load snippets:', e);
    }
  }

  _onStateLoaded(e) {
    const state = e.detail;
    if (state) {
      this.messages = state.messages || [];
      this.selectedFiles = state.selected_files || [];
      this.streaming = state.streaming_active || false;
    }
  }

  // ── URL events ──

  _onUrlsDetected(e) {
    const { urls } = e.detail;
    // Filter out URLs that are already fetched
    const fetchedSet = new Set(this._fetchedUrls.map(f => f.url));
    this._detectedUrls = urls.filter(u => !fetchedSet.has(u.url));
  }

  _onUrlFetched(e) {
    const { url, result } = e.detail;
    // Remove from detected
    this._detectedUrls = this._detectedUrls.filter(d => d.url !== url);
    // Add to / update fetched
    const existing = this._fetchedUrls.findIndex(f => f.url === url);
    const entry = {
      url,
      url_type: result.url_type || 'generic',
      title: result.title || '',
      display_name: result.display_name || url,
      error: result.error || '',
    };
    if (existing >= 0) {
      this._fetchedUrls = [
        ...this._fetchedUrls.slice(0, existing),
        entry,
        ...this._fetchedUrls.slice(existing + 1),
      ];
    } else {
      this._fetchedUrls = [...this._fetchedUrls, entry];
    }
  }

  _onUrlDismissed(e) {
    this._detectedUrls = this._detectedUrls.filter(d => d.url !== e.detail.url);
  }

  _onUrlRemoved(e) {
    const { url } = e.detail;
    this._fetchedUrls = this._fetchedUrls.filter(f => f.url !== url);
    const next = new Set(this._excludedUrls);
    next.delete(url);
    this._excludedUrls = next;
  }

  _onUrlToggleExclude(e) {
    const { url } = e.detail;
    const next = new Set(this._excludedUrls);
    if (next.has(url)) {
      next.delete(url);
    } else {
      next.add(url);
    }
    this._excludedUrls = next;
  }

  _onUrlViewContent(e) {
    // Future: open a modal to view fetched content
    // For now, log to console
    console.log('[url-chips] View content for:', e.detail.url);
  }

  _getIncludedUrls() {
    return this._fetchedUrls
      .filter(f => !f.error && !this._excludedUrls.has(f.url))
      .map(f => f.url);
  }

  // ── Sending ──

  async _onSendMessage(e) {
    const { message, images } = e.detail;
    if (this.streaming) return;

    // Show user message immediately
    this.messages = [...this.messages, { role: 'user', content: message }];

    // Clear detected URLs on send (fetched persist across messages)
    this._detectedUrls = [];

    // Generate request ID
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this._activeRequestId = requestId;
    this.streaming = true;

    // Start watchdog (5 minute timeout)
    this._startWatchdog();

    // Scroll chat to bottom
    this.shadowRoot.querySelector('chat-panel')?.scrollToBottom();

    try {
      await this.rpcCall(
        'LLM.chat_streaming',
        requestId,
        message,
        this.selectedFiles,
        images.length > 0 ? images : [],
      );
    } catch (e) {
      console.error('chat_streaming failed:', e);
      this.streaming = false;
      this._clearWatchdog();
    }
  }

  _onStreamComplete(e) {
    const { result } = e.detail;
    this._clearWatchdog();
    this.streaming = false;
    this._activeRequestId = null;

    // Add assistant message to our list
    if (result.response) {
      this.messages = [...this.messages, {
        role: 'assistant',
        content: result.response,
        editResults: result.edit_results || [],
      }];
    }

    // Focus input
    this.shadowRoot.querySelector('chat-input')?.focus();
  }

  // ── Watchdog ──

  _startWatchdog() {
    this._clearWatchdog();
    this._watchdogTimer = setTimeout(() => {
      console.warn('[ac-dc] Watchdog timeout — forcing stream recovery');
      this.streaming = false;
      this._activeRequestId = null;
    }, 5 * 60 * 1000); // 5 minutes
  }

  _clearWatchdog() {
    if (this._watchdogTimer) {
      clearTimeout(this._watchdogTimer);
      this._watchdogTimer = null;
    }
  }

  // ── Render ──

  render() {
    return html`
      <div class="file-picker-panel">
        <div class="file-picker-placeholder">
          File picker — Phase 8
        </div>
      </div>

      <div class="chat-panel-container">
        <chat-panel
          .messages=${this.messages}
          .streaming=${this.streaming}
        ></chat-panel>

        <url-chips
          .detected=${this._detectedUrls}
          .fetched=${this._fetchedUrls}
          .excluded=${this._excludedUrls}
          @urls-detected=${this._onUrlsDetected}
          @url-fetched=${this._onUrlFetched}
          @url-dismissed=${this._onUrlDismissed}
          @url-removed=${this._onUrlRemoved}
          @url-toggle-exclude=${this._onUrlToggleExclude}
          @url-view-content=${this._onUrlViewContent}
        ></url-chips>

        <chat-input
          .disabled=${this.streaming}
          .snippets=${this.snippets}
          @send-message=${this._onSendMessage}
          @urls-detected=${this._onUrlsDetected}
        ></chat-input>
      </div>
    `;
  }
}

customElements.define('files-tab', FilesTab);
