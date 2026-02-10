import { html, css } from 'lit';
import { JRPCClient } from '@flatmax/jrpc-oo';
import { SharedRpc } from './rpc-mixin.js';
import './dialog/ac-dialog.js';
import './chat/diff-viewer.js';

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
    `;
  }

  constructor() {
    super();
    this.connected = false;
    this.error = '';
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

    // Publish the call proxy to all child components via the singleton
    SharedRpc.set(this.call);

    // Load initial state
    this._loadInitialState();
  }

  /**
   * Called by jrpc-oo when connection fails or is lost.
   */
  setupSkip() {
    console.warn('[ac-dc] Connection failed or skipped');
    this.connected = false;
    this.error = 'Connection failed';
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
    `;
  }
}

customElements.define('ac-app', AcApp);
