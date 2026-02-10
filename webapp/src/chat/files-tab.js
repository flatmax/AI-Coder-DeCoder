import { LitElement, html, css } from 'lit';
import { RpcMixin } from '../rpc-mixin.js';
import './chat-panel.js';
import './chat-input.js';
import './url-chips.js';
import './file-picker.js';

/**
 * Files & Chat tab — left panel (file picker) + right panel (chat).
 * This orchestrates chat state, streaming, URL state, file selection, and message flow.
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
    _pickerCollapsed: { type: Boolean, state: true },
    _pickerWidth: { type: Number, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      height: 100%;
      overflow: hidden;
    }

    .file-picker-panel {
      border-right: 1px solid var(--border-color);
      background: var(--bg-secondary);
      overflow: hidden;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
    }

    .file-picker-panel.collapsed {
      width: 0 !important;
      min-width: 0 !important;
      border-right: none;
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
    // Picker panel state — restore from localStorage
    this._pickerCollapsed = localStorage.getItem('ac-dc-picker-collapsed') === 'true';
    this._pickerWidth = parseInt(localStorage.getItem('ac-dc-picker-width')) || 280;
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
    this._loadFileTree();
  }

  async _loadSnippets() {
    try {
      const result = await this.rpcExtract('Settings.get_snippets');
      this.snippets = result?.snippets || [];
    } catch (e) {
      console.warn('Failed to load snippets:', e);
    }
  }

  async _loadFileTree() {
    try {
      const result = await this.rpcExtract('Repo.get_file_tree');
      if (result && !result.error) {
        const picker = this.shadowRoot.querySelector('file-picker');
        if (picker) picker.setTree(result);
      }
    } catch (e) {
      console.warn('Failed to load file tree:', e);
    }
  }

  _onStateLoaded(e) {
    const state = e.detail;
    if (state) {
      this.messages = state.messages || [];
      this.selectedFiles = state.selected_files || [];
      this.streaming = state.streaming_active || false;
      // Sync selection to picker
      this.updateComplete.then(() => {
        const picker = this.shadowRoot.querySelector('file-picker');
        if (picker && this.selectedFiles.length) picker.setSelectedFiles(this.selectedFiles);
      });
    }
  }

  // ── File picker events ──

  _onSelectionChanged(e) {
    const { selectedFiles } = e.detail;
    this.selectedFiles = selectedFiles;
    // Notify server
    if (this.rpcConnected) {
      this.rpcCall('LLM.set_selected_files', selectedFiles).catch(() => {});
    }
  }

  _onFileClicked(e) {
    this.dispatchEvent(new CustomEvent('navigate-file', {
      detail: { path: e.detail.path },
      bubbles: true, composed: true,
    }));
  }

  async _onGitOperation() {
    // Refresh tree after any git operation
    await this._loadFileTree();
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

    // Refresh file tree if edits were applied
    if (result.files_modified?.length > 0) {
      this._loadFileTree();
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
    const pickerStyle = this._pickerCollapsed
      ? ''
      : `width:${this._pickerWidth}px; min-width:150px; max-width:500px;`;

    return html`
      <div class="file-picker-panel ${this._pickerCollapsed ? 'collapsed' : ''}"
        style=${pickerStyle}>
        <file-picker
          @selection-changed=${this._onSelectionChanged}
          @file-clicked=${this._onFileClicked}
          @git-operation=${this._onGitOperation}
        ></file-picker>
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
