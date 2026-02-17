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
import './components/svg-viewer.js';
import './components/token-hud.js';

const STORAGE_KEY_LAST_FILE = 'ac-last-open-file';
const STORAGE_KEY_LAST_VIEWPORT = 'ac-last-viewport';

/**
 * Extract WebSocket port from URL query parameter ?port=N
 */
function getPortFromURL() {
  const params = new URLSearchParams(window.location.search);
  const port = params.get('port');
  return port ? parseInt(port, 10) : 18080;
}

class AcApp extends JRPCClient {
  static properties = {
    _statusBar: { type: String, state: true },
    _reconnectVisible: { type: Boolean, state: true },
    _reconnectMsg: { type: String, state: true },
    _toasts: { type: Array, state: true },
  };

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

    /* Viewer background — diff and SVG viewers stacked */
    .diff-background {
      position: fixed;
      inset: 0;
      z-index: 0;
      background: var(--bg-primary);
    }

    .diff-background ac-diff-viewer,
    .diff-background ac-svg-viewer {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      transition: opacity 0.15s;
    }

    .diff-background .viewer-hidden {
      opacity: 0;
      pointer-events: none;
      z-index: 0;
    }
    .diff-background .viewer-visible {
      opacity: 1;
      pointer-events: auto;
      z-index: 1;
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
      pointer-events: none;
    }

    /* Status bar */
    .status-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      z-index: 10001;
      transition: opacity 0.5s;
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
      box-shadow: var(--shadow-md);
    }
    .reconnect-banner.visible { display: block; }

    /* Global toasts */
    .toast-container {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10002;
      display: flex;
      flex-direction: column-reverse;
      gap: 8px;
      pointer-events: none;
    }

    .global-toast {
      pointer-events: auto;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md, 8px);
      padding: 8px 16px;
      font-size: 0.85rem;
      color: var(--text-secondary);
      box-shadow: var(--shadow-md);
      animation: toast-in 0.25s ease;
      max-width: 420px;
      text-align: center;
    }
    .global-toast.success { border-color: var(--accent-green); color: var(--accent-green); }
    .global-toast.error { border-color: var(--accent-red); color: var(--accent-red); }
    .global-toast.warning { border-color: var(--accent-orange); color: var(--accent-orange); }
    .global-toast.fading { opacity: 0; transition: opacity 0.3s; }

    @keyframes toast-in {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `];

  constructor() {
    super();
    this._port = getPortFromURL();
    this._reconnectAttempt = 0;
    this._reconnectTimer = null;
    this._statusBar = 'hidden';
    this._reconnectVisible = false;
    this._reconnectMsg = '';
    this._toasts = [];
    this._toastIdCounter = 0;
    this._wasConnected = false;
    this._statusBarTimer = null;

    // Set jrpc-oo connection properties
    this.serverURI = `ws://localhost:${this._port}`;
    this.remoteTimeout = 60;

    // Bind event handlers
    this._onNavigateFile = this._onNavigateFile.bind(this);
    this._onFileSave = this._onFileSave.bind(this);
    this._onStreamCompleteForDiff = this._onStreamCompleteForDiff.bind(this);
    this._onFilesModified = this._onFilesModified.bind(this);
    this._onSearchNavigate = this._onSearchNavigate.bind(this);
    this._onGlobalKeyDown = this._onGlobalKeyDown.bind(this);
    this._onToastEvent = this._onToastEvent.bind(this);
    this._onActiveFileChanged = this._onActiveFileChanged.bind(this);
    this._onBeforeUnload = this._onBeforeUnload.bind(this);
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
    window.addEventListener('active-file-changed', this._onActiveFileChanged);

    // Intercept Ctrl+S globally to prevent browser Save dialog
    window.addEventListener('keydown', this._onGlobalKeyDown);

    // Global toast event listener
    window.addEventListener('ac-toast', this._onToastEvent);

    // Save viewport state before page unload
    window.addEventListener('beforeunload', this._onBeforeUnload);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('navigate-file', this._onNavigateFile);
    window.removeEventListener('file-save', this._onFileSave);
    window.removeEventListener('stream-complete', this._onStreamCompleteForDiff);
    window.removeEventListener('files-modified', this._onFilesModified);
    window.removeEventListener('search-navigate', this._onSearchNavigate);
    window.removeEventListener('active-file-changed', this._onActiveFileChanged);
    window.removeEventListener('keydown', this._onGlobalKeyDown);
    window.removeEventListener('ac-toast', this._onToastEvent);
    window.removeEventListener('beforeunload', this._onBeforeUnload);
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this._statusBarTimer) clearTimeout(this._statusBarTimer);
  }

  // === jrpc-oo lifecycle callbacks ===

  remoteIsUp() {
    console.log('WebSocket connected — remote is up');
    const wasReconnecting = this._reconnectAttempt > 0;
    this._reconnectAttempt = 0;
    this._reconnectVisible = false;
    this._reconnectMsg = '';
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    // Show green status bar briefly
    this._showStatusBar('ok');

    if (wasReconnecting) {
      this._showToast('Reconnected', 'success');
    }
  }

  setupDone() {
    console.log('jrpc-oo setup done — call proxy ready');
    this._wasConnected = true;

    // Publish the call proxy so all child components get RPC access
    SharedRpc.set(this.call);

    // Fetch initial state
    this._loadInitialState();
  }

  setupSkip() {
    console.warn('jrpc-oo setup skipped — connection failed');
    // Trigger reconnection if we were previously connected
    if (this._wasConnected) {
      this._scheduleReconnect();
    }
  }

  remoteDisconnected() {
    console.log('WebSocket disconnected');
    SharedRpc.clear();

    // Show red status bar
    this._showStatusBar('error', false); // Don't auto-hide while disconnected

    // Notify children
    window.dispatchEvent(new CustomEvent('rpc-disconnected'));

    // Schedule reconnection
    this._scheduleReconnect();
  }

  // === Reconnection with exponential backoff ===

  _scheduleReconnect() {
    if (this._reconnectTimer) return; // Already scheduled

    this._reconnectAttempt++;
    // Exponential backoff: 1s, 2s, 4s, 8s, capped at 15s
    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempt - 1), 15000);
    const delaySec = (delay / 1000).toFixed(0);

    this._reconnectMsg = `Reconnecting (attempt ${this._reconnectAttempt})... retry in ${delaySec}s`;
    this._reconnectVisible = true;

    console.log(`Scheduling reconnect attempt ${this._reconnectAttempt} in ${delay}ms`);

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._reconnectMsg = `Reconnecting (attempt ${this._reconnectAttempt})...`;
      this.requestUpdate();

      // jrpc-oo reconnect: re-open the WebSocket
      try {
        this.open(this.serverURI);
      } catch (e) {
        console.error('Reconnect failed:', e);
        this._scheduleReconnect();
      }
    }, delay);
  }

  // === Status bar ===

  _showStatusBar(state, autoHide = true) {
    this._statusBar = state;
    if (this._statusBarTimer) {
      clearTimeout(this._statusBarTimer);
      this._statusBarTimer = null;
    }
    if (autoHide) {
      this._statusBarTimer = setTimeout(() => {
        this._statusBar = 'hidden';
      }, 3000);
    }
  }

  // === Global Toast System ===

  _onToastEvent(e) {
    const { message, type } = e.detail || {};
    if (message) {
      this._showToast(message, type || '');
    }
  }

  _showToast(message, type = '') {
    const id = ++this._toastIdCounter;
    this._toasts = [...this._toasts, { id, message, type, fading: false }];

    // Auto-dismiss after 3s
    setTimeout(() => {
      // Start fade
      this._toasts = this._toasts.map(t =>
        t.id === id ? { ...t, fading: true } : t
      );
      // Remove after fade
      setTimeout(() => {
        this._toasts = this._toasts.filter(t => t.id !== id);
      }, 300);
    }, 3000);
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
      this._reopenLastFile();
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

  /**
   * Re-open the last viewed file after a page refresh.
   */
  _reopenLastFile() {
    try {
      const path = localStorage.getItem(STORAGE_KEY_LAST_FILE);
      if (!path) return;

      // Read saved viewport before navigating (navigation may overwrite it)
      const raw = localStorage.getItem(STORAGE_KEY_LAST_VIEWPORT);
      let viewport = null;
      if (raw) {
        viewport = JSON.parse(raw);
        if (viewport?.path !== path) viewport = null;
      }

      // For diff files, listen for active-file-changed then restore scroll position
      if (viewport && viewport.type === 'diff') {
        const handler = (e) => {
          if (e.detail?.path !== path) return;
          window.removeEventListener('active-file-changed', handler);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              this._restoreViewportState(path, viewport);
            });
          });
        };
        window.addEventListener('active-file-changed', handler);
        setTimeout(() => window.removeEventListener('active-file-changed', handler), 10000);
      }

      window.dispatchEvent(new CustomEvent('navigate-file', {
        detail: { path },
      }));
    } catch (_) {}
  }

  /**
   * Save the current viewer's viewport state to localStorage.
   */
  _saveViewportState() {
    try {
      const path = localStorage.getItem(STORAGE_KEY_LAST_FILE);
      if (!path) return;

      // Only save viewport for diff files (SVG zoom restore not yet supported)
      if (path.toLowerCase().endsWith('.svg')) return;

      const diffV = this.shadowRoot?.querySelector('ac-diff-viewer');
      if (diffV) {
        const diffState = diffV.getViewportState?.() ?? null;
        if (!diffState) return;
        const viewport = { path, type: 'diff', diff: diffState };
        localStorage.setItem(STORAGE_KEY_LAST_VIEWPORT, JSON.stringify(viewport));
      }
    } catch (_) {}
  }

  /**
   * Restore viewport state on a viewer after re-opening a file.
   */
  _restoreViewportState(path, viewport) {
    try {
      if (viewport.type === 'diff' && viewport.diff) {
        const diffV = this.shadowRoot?.querySelector('ac-diff-viewer');
        if (diffV) diffV.restoreViewportState?.(viewport.diff);
      }
    } catch (_) {}
  }

  // === Event Routing ===

  /**
   * Route navigate-file events from file picker, chat edit blocks, and search
   * to the appropriate viewer (SVG viewer for .svg files, diff viewer otherwise).
   */
  _onNavigateFile(e) {
    const detail = e.detail;
    if (!detail?.path) return;

    // Save viewport state of the currently-open file before navigating away
    this._saveViewportState();

    // Remember last opened file for restore on refresh
    try { localStorage.setItem(STORAGE_KEY_LAST_FILE, detail.path); } catch (_) {}

    const isSvg = detail.path.toLowerCase().endsWith('.svg');

    // Show the appropriate viewer layer
    const diffV = this.shadowRoot?.querySelector('ac-diff-viewer');
    const svgV = this.shadowRoot?.querySelector('ac-svg-viewer');
    if (diffV) {
      diffV.classList.toggle('viewer-visible', !isSvg);
      diffV.classList.toggle('viewer-hidden', isSvg);
    }
    if (svgV) {
      svgV.classList.toggle('viewer-visible', isSvg);
      svgV.classList.toggle('viewer-hidden', !isSvg);
    }

    if (isSvg) {
      if (!svgV) return;
      svgV.openFile({
        path: detail.path,
        original: detail.original,
        modified: detail.modified,
        is_new: detail.is_new,
      });
    } else {
      if (!diffV) return;
      diffV.openFile({
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
      this._showToast(`Save failed: ${err.message || 'Unknown error'}`, 'error');
    }
  }

  /**
   * After stream completes with edits, refresh only already-open files.
   */
  _onStreamCompleteForDiff(e) {
    const result = e.detail?.result;
    if (!result?.files_modified?.length) return;

    const diffViewer = this.shadowRoot?.querySelector('ac-diff-viewer');
    if (diffViewer) {
      diffViewer.refreshOpenFiles();
    }

    const svgViewer = this.shadowRoot?.querySelector('ac-svg-viewer');
    if (svgViewer) {
      svgViewer.refreshOpenFiles();
    }
  }

  /**
   * Handle files-modified events (e.g., from commit, reset).
   */
  _onFilesModified(e) {
    const diffViewer = this.shadowRoot?.querySelector('ac-diff-viewer');
    if (diffViewer && diffViewer._files.length > 0) {
      diffViewer.refreshOpenFiles();
    }

    const svgViewer = this.shadowRoot?.querySelector('ac-svg-viewer');
    if (svgViewer && svgViewer._files.length > 0) {
      svgViewer.refreshOpenFiles();
    }
  }

  /**
   * When either viewer switches active file, activate the correct viewer layer.
   */
  _onActiveFileChanged(e) {
    const path = e.detail?.path;
    if (path) {
      const isSvg = path.toLowerCase().endsWith('.svg');
      const diffViewer = this.shadowRoot?.querySelector('ac-diff-viewer');
      const svgViewer = this.shadowRoot?.querySelector('ac-svg-viewer');
      if (diffViewer) {
        diffViewer.classList.toggle('viewer-visible', !isSvg);
        diffViewer.classList.toggle('viewer-hidden', isSvg);
      }
      if (svgViewer) {
        svgViewer.classList.toggle('viewer-visible', isSvg);
        svgViewer.classList.toggle('viewer-hidden', !isSvg);
      }
    }
  }

  /**
   * Intercept Ctrl+S globally to prevent browser Save dialog.
   */
  _onGlobalKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
    }
  }

  _onBeforeUnload() {
    this._saveViewportState();
  }

  render() {
    return html`
      <div class="viewport">
        <div class="diff-background" role="region" aria-label="Code viewer">
          <ac-diff-viewer class="viewer-visible"></ac-diff-viewer>
          <ac-svg-viewer class="viewer-hidden"></ac-svg-viewer>
        </div>

        <div class="dialog-container" role="complementary" aria-label="Tools panel">
          <ac-dialog></ac-dialog>
        </div>
      </div>

      <ac-token-hud></ac-token-hud>

      <div class="status-bar ${this._statusBar}" role="status" aria-live="polite"
           aria-label="${this._statusBar === 'ok' ? 'Connected' : this._statusBar === 'error' ? 'Disconnected' : ''}"></div>
      <div class="reconnect-banner ${this._reconnectVisible ? 'visible' : ''}"
           role="alert" aria-live="assertive">${this._reconnectMsg}</div>

      <div class="toast-container" role="status" aria-live="polite" aria-relevant="additions">
        ${this._toasts.map(t => html`
          <div class="global-toast ${t.type} ${t.fading ? 'fading' : ''}" role="alert">${t.message}</div>
        `)}
      </div>
    `;
  }
}

customElements.define('ac-app', AcApp);