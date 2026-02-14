/**
 * App Shell — root component.
 *
 * Extends JRPCClient for WebSocket transport.
 * Manages connection lifecycle, routes events, hosts dialog and diff viewer.
 */

import { html, css } from 'lit';
import { SharedRpc } from './shared-rpc.js';
import { theme } from './styles/theme.js';
import { JRPCClient } from '@flatmax/jrpc-oo/dist/bundle.js';

// Import child components so custom elements are registered
import './components/ac-dialog.js';
import './components/diff-viewer.js';
import './components/token-hud.js';

/**
 * Extract WebSocket port from URL query parameter ?port=N
 */
function getPortFromURL() {
  const params = new URLSearchParams(window.location.search);
  const port = params.get('port');
  return port ? parseInt(port, 10) : 18080;
}

class AcApp extends JRPCClient {
  static styles = [theme, css`
    :host {
      display: block;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
    }

    .viewport {
      position: relative;
      width: 100%;
      height: 100%;
    }

    /* Diff viewer background */
    .diff-background {
      position: fixed;
      inset: 0;
      z-index: 0;
      background: var(--bg-primary);
    }

    .diff-background ac-diff-viewer {
      width: 100%;
      height: 100%;
    }

    /* Dialog container */
    .dialog-container {
      position: fixed;
      top: 0;
      left: 0;
      width: 50%;
      min-width: 400px;
      height: 100%;
      z-index: 100;
    }

    /* Status bar */
    .status-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      z-index: 10001;
      transition: opacity 0.3s;
    }
    .status-bar.ok { background: var(--accent-green); }
    .status-bar.error { background: var(--accent-red); }
    .status-bar.hidden { opacity: 0; pointer-events: none; }

    /* Reconnecting banner */
    .reconnect-banner {
      position: fixed;
      top: 8px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      padding: 8px 16px;
      font-size: 0.85rem;
      color: var(--text-secondary);
      z-index: 10001;
      display: none;
    }
    .reconnect-banner.visible { display: block; }
  `];

  constructor() {
    super();
    this._port = getPortFromURL();
    this._reconnectAttempt = 0;

    // Set jrpc-oo connection properties
    this.serverURI = `ws://localhost:${this._port}`;
    this.remoteTimeout = 60;

    // Bind event handlers
    this._onNavigateFile = this._onNavigateFile.bind(this);
    this._onFileSave = this._onFileSave.bind(this);
    this._onStreamCompleteForDiff = this._onStreamCompleteForDiff.bind(this);
    this._onFilesModified = this._onFilesModified.bind(this);
    this._onSearchNavigate = this._onSearchNavigate.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    console.log(`AC⚡DC connecting to ${this.serverURI}`);

    // Register methods the server can call on us
    this.addClass(this, 'AcApp');

    // Listen for events from child components
    window.addEventListener('navigate-file', this._onNavigateFile);
    window.addEventListener('file-save', this._onFileSave);
    window.addEventListener('stream-complete', this._onStreamCompleteForDiff);
    window.addEventListener('files-modified', this._onFilesModified);
    window.addEventListener('search-navigate', this._onSearchNavigate);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('navigate-file', this._onNavigateFile);
    window.removeEventListener('file-save', this._onFileSave);
    window.removeEventListener('stream-complete', this._onStreamCompleteForDiff);
    window.removeEventListener('files-modified', this._onFilesModified);
    window.removeEventListener('search-navigate', this._onSearchNavigate);
  }

  // === jrpc-oo lifecycle callbacks ===

  remoteIsUp() {
    console.log('WebSocket connected — remote is up');
    this._reconnectAttempt = 0;
  }

  setupDone() {
    console.log('jrpc-oo setup done — call proxy ready');

    // Publish the call proxy so all child components get RPC access
    SharedRpc.set(this.call);

    // Fetch initial state
    this._loadInitialState();
  }

  setupSkip() {
    console.warn('jrpc-oo setup skipped — connection failed');
  }

  remoteDisconnected() {
    console.log('WebSocket disconnected');
    SharedRpc.clear();

    // Notify children
    window.dispatchEvent(new CustomEvent('rpc-disconnected'));
  }

  // === Methods the server can call (registered via addClass) ===

  streamChunk(requestId, content) {
    window.dispatchEvent(new CustomEvent('stream-chunk', {
      detail: { requestId, content },
    }));
    return true;
  }

  streamComplete(requestId, result) {
    window.dispatchEvent(new CustomEvent('stream-complete', {
      detail: { requestId, result },
    }));
    return true;
  }

  compactionEvent(requestId, event) {
    window.dispatchEvent(new CustomEvent('compaction-event', {
      detail: { requestId, event },
    }));
    return true;
  }

  filesChanged(selectedFiles) {
    window.dispatchEvent(new CustomEvent('files-changed', {
      detail: { selectedFiles },
    }));
    return true;
  }

  // === Initial state ===

  async _loadInitialState() {
    try {
      const raw = await this.call['LLMService.get_current_state']();
      // Unwrap jrpc-oo envelope
      const state = this._extract(raw);
      console.log('Initial state loaded:', state);

      // Set browser tab title to ⚡ {repo_name}
      if (state?.repo_name) {
        document.title = `${state.repo_name}`;
      }

      window.dispatchEvent(new CustomEvent('state-loaded', { detail: state }));
    } catch (e) {
      console.error('Failed to load initial state:', e);
    }
  }

  /**
   * Unwrap jrpc-oo response envelope { "method_name": value } → value
   */
  _extract(result) {
    if (result && typeof result === 'object') {
      const keys = Object.keys(result);
      if (keys.length === 1) return result[keys[0]];
    }
    return result;
  }

  // === Event Routing ===

  /**
   * Route navigate-file events from file picker, chat edit blocks, and search
   * to the diff viewer.
   */
  _onNavigateFile(e) {
    const detail = e.detail;
    if (!detail?.path) return;

    const viewer = this.shadowRoot?.querySelector('ac-diff-viewer');
    if (!viewer) return;

    viewer.openFile({
      path: detail.path,
      original: detail.original,
      modified: detail.modified,
      is_new: detail.is_new,
      is_read_only: detail.is_read_only,
      is_config: detail.is_config,
      config_type: detail.config_type,
      real_path: detail.real_path,
      searchText: detail.searchText,
      line: detail.line,
    });
  }

  /**
   * Route search-navigate events to navigate-file format.
   */
  _onSearchNavigate(e) {
    const detail = e.detail;
    if (!detail?.path) return;
    this._onNavigateFile({
      detail: { path: detail.path, line: detail.line },
    });
  }

  /**
   * Route file-save events to Repo or Settings RPC.
   */
  async _onFileSave(e) {
    const { path, content, isConfig, configType } = e.detail;
    if (!path) return;

    try {
      if (isConfig && configType) {
        await this.call['Settings.save_config_content'](configType, content);
      } else {
        await this.call['Repo.write_file'](path, content);
      }
    } catch (err) {
      console.error('File save failed:', err);
    }
  }

  /**
   * After stream completes with edits, refresh only already-open files.
   */
  _onStreamCompleteForDiff(e) {
    const result = e.detail?.result;
    if (!result?.files_modified?.length) return;

    const viewer = this.shadowRoot?.querySelector('ac-diff-viewer');
    if (viewer) {
      viewer.refreshOpenFiles();
    }
  }

  /**
   * Handle files-modified events (e.g., from commit, reset).
   */
  _onFilesModified(e) {
    const viewer = this.shadowRoot?.querySelector('ac-diff-viewer');
    if (viewer && viewer._files.length > 0) {
      viewer.refreshOpenFiles();
    }
  }

  render() {
    return html`
      <div class="viewport">
        <div class="diff-background">
          <ac-diff-viewer></ac-diff-viewer>
        </div>

        <div class="dialog-container">
          <ac-dialog></ac-dialog>
        </div>
      </div>

      <ac-token-hud></ac-token-hud>

      <div class="status-bar hidden"></div>
      <div class="reconnect-banner">Reconnecting...</div>
    `;
  }
}

customElements.define('ac-app', AcApp);