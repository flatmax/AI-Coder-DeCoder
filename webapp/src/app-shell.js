import { html, css } from 'lit';
import { JRPCClient } from '@flatmax/jrpc-oo';
import { SharedRpc } from './rpc-mixin.js';
import './dialog/ac-dialog.js';
import './chat/diff-viewer.js';
import './chat/toast-container.js';

/**
 * Root application shell.
 * Extends JRPCClient (LitElement + WebSocket) from jrpc-oo.
 * Manages the RPC connection, hosts the dialog (foreground)
 * and diff viewer (background).
 */
class AcApp extends JRPCClient {
  static properties = {
    connected: { type: Boolean, state: true },
    error: { type: String, state: true },
    _reconnecting: { type: Boolean, state: true },
    _reconnectAttempt: { type: Number, state: true },
  };

  static get styles() {
    return css`
      :host {
        display: block;
        width: 100%;
        height: 100%;
        position: relative;
      }

      .diff-background {
        position: fixed;
        inset: 0;
        z-index: 0;
      }

      ac-dialog {
        position: fixed;
        top: 0;
        left: 0;
        width: 50vw;
        min-width: 400px;
        height: 100vh;
        z-index: 10;
      }

      .reconnect-banner {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: 32px;
        background: var(--accent-warning, #ff9800);
        color: #000;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 600;
        z-index: 9999;
        gap: 8px;
      }

      .reconnect-spinner {
        display: inline-block;
        width: 12px;
        height: 12px;
        border: 2px solid rgba(0,0,0,0.3);
        border-top-color: #000;
        border-radius: 50%;
        animation: rspin 0.8s linear infinite;
      }

      @keyframes rspin { to { transform: rotate(360deg); } }
    `;
  }

  constructor() {
    super();
    this.connected = false;
    this.error = '';
    this._reconnecting = false;
    this._reconnectAttempt = 0;
    this._reconnectTimer = null;
    this.remoteTimeout = 60;

    // Extract WebSocket port from URL ?port=N
    const params = new URLSearchParams(window.location.search);
    const port = params.get('port') || '18080';
    this.serverURI = `ws://localhost:${port}`;

    this._onNavigateFile = this._onNavigateFile.bind(this);
    this._onFileSave = this._onFileSave.bind(this);
    this._onStreamCompleteForDiff = this._onStreamCompleteForDiff.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    this.addClass(this, 'AcApp');
    this.addEventListener('navigate-file', this._onNavigateFile);
    this.addEventListener('file-save', this._onFileSave);
    window.addEventListener('stream-complete', this._onStreamCompleteForDiff);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('navigate-file', this._onNavigateFile);
    this.removeEventListener('file-save', this._onFileSave);
    window.removeEventListener('stream-complete', this._onStreamCompleteForDiff);
  }

  /**
   * Called by jrpc-oo when the WebSocket connection is established
   * and the remote method proxy (this.call) is populated.
   */
  setupDone() {
    console.log(`[ac-dc] Connected to ${this.serverURI}`);
    this.connected = true;
    this.error = '';
    this._reconnecting = false;
    this._reconnectAttempt = 0;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    // Publish the call proxy to all child components via the singleton
    SharedRpc.set(this.call);

    // Load initial state
    this._loadInitialState();

    // Show reconnection success toast if we were reconnecting
    if (this._wasDisconnected) {
      this._wasDisconnected = false;
      this._dispatchToast('Reconnected to server', 'success');
    }
  }

  /**
   * Called by jrpc-oo when connection fails or is lost.
   */
  setupSkip() {
    console.warn('[ac-dc] Connection failed or skipped');
    const wasConnected = this.connected;
    this.connected = false;
    this.error = 'Connection failed';

    if (wasConnected) {
      this._wasDisconnected = true;
      SharedRpc.reset();
      this._dispatchToast('Disconnected from server — reconnecting...', 'error');
    }

    this._scheduleReconnect();
  }

  /**
   * Called by jrpc-oo when remote disconnects.
   */
  remoteDisconnected() {
    console.warn('[ac-dc] Remote disconnected');
    const wasConnected = this.connected;
    this.connected = false;

    if (wasConnected) {
      this._wasDisconnected = true;
      SharedRpc.reset();
      this._dispatchToast('Server disconnected — reconnecting...', 'error');
    }

    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnecting = true;
    this._reconnectAttempt++;
    // Exponential backoff: 1s, 2s, 4s, 8s, max 15s
    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempt - 1), 15000);
    console.log(`[ac-dc] Reconnecting in ${delay}ms (attempt ${this._reconnectAttempt})`);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      try {
        this.open();
      } catch (e) {
        console.warn('[ac-dc] Reconnect attempt failed:', e);
        this._scheduleReconnect();
      }
    }, delay);
  }

  _dispatchToast(message, type = 'info') {
    window.dispatchEvent(new CustomEvent('ac-toast', {
      detail: { message, type },
      bubbles: true,
    }));
  }

  /**
   * Methods the server can call on the client.
   * These must be class methods (not late-assigned) so jrpc-oo
   * discovers them during connection setup.
   */
  streamChunk(requestId, content) {
    this._dispatch('stream-chunk', { requestId, content });
    return true;
  }

  streamComplete(requestId, result) {
    this._dispatch('stream-complete', { requestId, result });
    return true;
  }

  compactionEvent(requestId, event) {
    this._dispatch('compaction-event', { requestId, event });
    return true;
  }

  filesChanged(selectedFiles) {
    this._dispatch('files-changed', { selectedFiles });
    return true;
  }

  async _loadInitialState() {
    try {
      const state = await this._extract('LLM.get_current_state');
      this._dispatch('state-loaded', state);
    } catch (e) {
      console.error('[ac-dc] Failed to load initial state:', e);
    }
  }

  /**
   * Helper to call and unwrap jrpc-oo response envelope.
   */
  async _extract(method, ...args) {
    const result = await this.call[method](...args);
    if (result && typeof result === 'object') {
      const keys = Object.keys(result);
      if (keys.length === 1) return result[keys[0]];
    }
    return result;
  }

  _dispatch(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
  }

  // ── Diff viewer event routing ──

  _onNavigateFile(e) {
    const { path, line } = e.detail || {};
    if (!path) return;
    const diffViewer = this.shadowRoot.querySelector('diff-viewer');
    if (diffViewer) {
      diffViewer.openRepoFile(path, line || null);
    }
  }

  async _onFileSave(e) {
    e.stopPropagation();
    const { path, content, isConfig, configType } = e.detail || {};
    if (!path) return;

    if (isConfig && configType) {
      try {
        await this._extract('Settings.save_config_content', configType, content);
      } catch (err) {
        console.error('Config save failed:', err);
      }
    } else {
      try {
        await this._extract('Repo.write_file', path, content);
        try { await this._extract('Repo.stage_files', [path]); } catch {}
        try { await this._extract('LLM.invalidate_symbol_files', [path]); } catch {}
        // Notify file tree to refresh
        this._dispatch('files-changed', {});
      } catch (err) {
        console.error('File save failed:', err);
      }
    }
  }

  _onStreamCompleteForDiff(e) {
    const { result } = e.detail || {};
    if (!result?.files_modified?.length) return;
    const diffViewer = this.shadowRoot.querySelector('diff-viewer');
    if (diffViewer) {
      diffViewer.openEditResults(result.edit_results, result.files_modified);
    }
  }

  render() {
    return html`
      <div class="diff-background">
        <diff-viewer></diff-viewer>
      </div>
      <ac-dialog .connected=${this.connected} .error=${this.error}></ac-dialog>
      ${this._reconnecting ? html`
        <div class="reconnect-banner">
          <span class="reconnect-spinner"></span>
          Reconnecting${this._reconnectAttempt > 1 ? ` (attempt ${this._reconnectAttempt})` : ''}...
        </div>
      ` : ''}
      <toast-container></toast-container>
    `;
  }
}

customElements.define('ac-app', AcApp);
