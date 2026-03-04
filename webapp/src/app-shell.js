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
import './components/file-nav.js';

const STORAGE_KEY_LAST_FILE = 'ac-last-open-file';
const STORAGE_KEY_LAST_VIEWPORT = 'ac-last-viewport';

/**
 * Return a repo-scoped localStorage key.
 * Falls back to the bare key if repo name is unknown.
 */
function _repoKey(key, repoName) {
  return repoName ? `${key}:${repoName}` : key;
}

/**
 * Extract WebSocket port from URL query parameter ?port=N
 */
function getPortFromURL() {
  const params = new URLSearchParams(window.location.search);
  const port = params.get('port');
  return port ? parseInt(port, 10) : 18080;
}

/**
 * Build the WebSocket URI using the page's hostname so remote clients
 * connect back to the actual server host instead of their own localhost.
 */
function getServerURI(port) {
  const host = window.location.hostname || 'localhost';
  return `ws://${host}:${port}`;
}

class AcApp extends JRPCClient {
  static properties = {
    _statusBar: { type: String, state: true },
    _reconnectVisible: { type: Boolean, state: true },
    _reconnectMsg: { type: String, state: true },
    _toasts: { type: Array, state: true },
    _startupVisible: { type: Boolean, state: true },
    _startupMessage: { type: String, state: true },
    _startupPercent: { type: Number, state: true },
    _admissionPending: { type: Boolean, state: true },
    _admissionClientId: { type: String, state: true },
    _admissionDenied: { type: Boolean, state: true },
    _admissionRequests: { type: Array, state: true },
    _connectedClients: { type: Number, state: true },
  };

  static styles = [theme, css`
    :host {
      display: block;
      width: 100vw;
      height: 100vh;
      height: 100dvh;
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

    /* Admission pending overlay */
    .admission-overlay {
      position: fixed;
      inset: 0;
      z-index: 20001;
      background: var(--bg-primary, #0d1117);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
    }
    .admission-brand {
      font-size: 3rem;
      opacity: 0.25;
      margin-bottom: 1rem;
      user-select: none;
    }
    .admission-message {
      font-size: 1.1rem;
      color: var(--text-secondary, #8b949e);
    }
    .admission-sub {
      font-size: 0.85rem;
      color: var(--text-muted, #6e7681);
    }
    .admission-denied-msg {
      font-size: 1.1rem;
      color: var(--accent-red, #f85149);
    }
    .admission-btn {
      background: var(--bg-tertiary, #21262d);
      border: 1px solid var(--border-primary, #30363d);
      color: var(--text-secondary, #8b949e);
      padding: 8px 24px;
      border-radius: var(--radius-md, 8px);
      cursor: pointer;
      font-size: 0.9rem;
      margin-top: 8px;
    }
    .admission-btn:hover {
      background: var(--bg-secondary, #161b22);
      color: var(--text-primary, #c9d1d9);
    }

    /* Admission request toast (persistent) */
    .admission-toast {
      pointer-events: auto;
      background: var(--bg-tertiary);
      border: 1px solid var(--accent-orange);
      border-radius: var(--radius-md, 8px);
      padding: 12px 16px;
      font-size: 0.85rem;
      color: var(--text-secondary);
      box-shadow: var(--shadow-md);
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: 360px;
    }
    .admission-toast-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    .admission-toast-actions button {
      padding: 4px 16px;
      border-radius: var(--radius-sm, 4px);
      border: 1px solid var(--border-primary);
      cursor: pointer;
      font-size: 0.8rem;
    }
    .admission-toast-actions .admit-btn {
      background: var(--accent-green, #3fb950);
      color: #000;
      border-color: var(--accent-green);
    }
    .admission-toast-actions .deny-btn {
      background: var(--bg-secondary);
      color: var(--text-secondary);
    }

    /* Startup overlay */
    .startup-overlay {
      position: fixed;
      inset: 0;
      z-index: 20000;
      background: var(--bg-primary, #0d1117);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      transition: opacity 0.4s ease;
    }
    .startup-overlay.hidden {
      opacity: 0;
      pointer-events: none;
    }
    .startup-brand {
      font-size: 3rem;
      opacity: 0.25;
      margin-bottom: 2rem;
      user-select: none;
    }
    .startup-message {
      font-size: 0.95rem;
      color: var(--text-secondary, #8b949e);
      margin-bottom: 1.2rem;
      min-height: 1.4em;
    }
    .startup-bar-track {
      width: 280px;
      height: 4px;
      background: var(--bg-tertiary, #21262d);
      border-radius: 2px;
      overflow: hidden;
    }
    .startup-bar-fill {
      height: 100%;
      background: var(--accent-blue, #58a6ff);
      border-radius: 2px;
      transition: width 0.4s ease;
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
    this._startupVisible = true;
    this._startupMessage = 'Connecting...';
    this._startupPercent = 0;
    this._repoName = null;
    this._admissionPending = false;
    this._admissionClientId = null;
    this._admissionDenied = false;
    this._admissionRequests = [];
    this._connectedClients = 1;
    this._rawWsListener = null;

    // Set jrpc-oo connection properties — use page hostname so remote
    // collab clients connect back to the actual server, not their own localhost.
    this.serverURI = getServerURI(this._port);
    this.remoteTimeout = 60;

    // Bind event handlers
    this._onAdmissionCancel = this._cancelAdmission.bind(this);
    this._onNavigateFile = this._onNavigateFile.bind(this);
    this._onFileSave = this._onFileSave.bind(this);
    this._onStreamCompleteForDiff = this._onStreamCompleteForDiff.bind(this);
    this._onFilesModified = this._onFilesModified.bind(this);
    this._onSearchNavigate = this._onSearchNavigate.bind(this);
    this._onGlobalKeyDown = this._onGlobalKeyDown.bind(this);
    this._onGlobalKeyUp = this._onGlobalKeyUp.bind(this);
    this._onToastEvent = this._onToastEvent.bind(this);
    this._onActiveFileChanged = this._onActiveFileChanged.bind(this);
    this._onBeforeUnload = this._onBeforeUnload.bind(this);
    this._onWindowResize = this._onWindowResize.bind(this);
    this._resizeRAF = null;
  }

  connectedCallback() {
    super.connectedCallback();
    // Register methods the server can call on us
    this.addClass(this, 'AcApp');

    // Listen for events from child components
    window.addEventListener('navigate-file', this._onNavigateFile);
    window.addEventListener('file-save', this._onFileSave);
    window.addEventListener('stream-complete', this._onStreamCompleteForDiff);
    window.addEventListener('files-modified', this._onFilesModified);
    window.addEventListener('search-navigate', this._onSearchNavigate);
    window.addEventListener('active-file-changed', this._onActiveFileChanged);

    // Intercept Ctrl+S globally and Alt+Arrow for file navigation
    window.addEventListener('keydown', this._onGlobalKeyDown, true);
    window.addEventListener('keyup', this._onGlobalKeyUp);

    // Global toast event listener
    window.addEventListener('ac-toast', this._onToastEvent);

    // Save viewport state before page unload
    window.addEventListener('beforeunload', this._onBeforeUnload);

    // Re-layout on window resize (display change, maximize, etc.)
    window.addEventListener('resize', this._onWindowResize);

    // Track viewport width for proportional dialog resizing
    this._lastViewportWidth = window.innerWidth;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('navigate-file', this._onNavigateFile);
    window.removeEventListener('file-save', this._onFileSave);
    window.removeEventListener('stream-complete', this._onStreamCompleteForDiff);
    window.removeEventListener('files-modified', this._onFilesModified);
    window.removeEventListener('search-navigate', this._onSearchNavigate);
    window.removeEventListener('active-file-changed', this._onActiveFileChanged);
    window.removeEventListener('keydown', this._onGlobalKeyDown, true);
    window.removeEventListener('keyup', this._onGlobalKeyUp);
    window.removeEventListener('ac-toast', this._onToastEvent);
    window.removeEventListener('beforeunload', this._onBeforeUnload);
    window.removeEventListener('resize', this._onWindowResize);
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this._statusBarTimer) clearTimeout(this._statusBarTimer);
    if (this._resizeRAF) { cancelAnimationFrame(this._resizeRAF); this._resizeRAF = null; }
  }

  // === jrpc-oo lifecycle callbacks ===

  remoteIsUp() {
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

    // Update startup overlay — connected, waiting for init
    if (this._startupVisible) {
      this._startupMessage = 'Connected — initializing...';
      this._startupPercent = 5;
    }

    if (wasReconnecting) {
      this._showToast('Reconnected', 'success');
      // Hide startup overlay on reconnect (init already done)
      this._startupVisible = false;
    }
  }

  /**
   * Override serverChanged to intercept raw WebSocket messages
   * for the admission flow before jrpc-oo processes them.
   */
  serverChanged() {
    // Call parent to establish WebSocket connection
    super.serverChanged();

    // After super creates the WebSocket, add our raw message interceptor.
    // jrpc-oo may use addEventListener('message') rather than ws.onmessage,
    // so we use a capturing event listener that fires first and can suppress
    // non-JRPC admission messages before jrpc-oo sees them.
    const ws = this._ws || this.ws;
    if (ws && ws.addEventListener) {
      // Remove any previous listener (in case serverChanged fires twice)
      if (this._rawWsListener) {
        ws.removeEventListener('message', this._rawWsListener);
      }
      this._rawWsListener = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && data.type === 'admission_pending') {
            this._admissionPending = true;
            this._admissionClientId = data.client_id;
            this._admissionDenied = false;
            event.stopImmediatePropagation();
            return;
          }
          if (data && data.type === 'admission_granted') {
            this._admissionPending = false;
            this._admissionDenied = false;
            event.stopImmediatePropagation();
            return;
          }
          if (data && data.type === 'admission_denied') {
            this._admissionPending = false;
            this._admissionDenied = true;
            event.stopImmediatePropagation();
            return;
          }
        } catch (_) {
          // Not JSON or not an admission message — let jrpc-oo handle it
        }
      };
      // Use capture phase so we fire before jrpc-oo's listener
      ws.addEventListener('message', this._rawWsListener);
    }
  }

  setupDone() {
    this._wasConnected = true;

    // Publish the call proxy so all child components get RPC access
    SharedRpc.set(this.call);

    // Fetch initial state
    this._loadInitialState();
  }

  setupSkip() {
    // Trigger reconnection if we were previously connected
    if (this._wasConnected) {
      this._scheduleReconnect();
    }
  }

  remoteDisconnected() {
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

  commitResult(result) {
    window.dispatchEvent(new CustomEvent('commit-result', {
      detail: result,
    }));
    return true;
  }

  userMessage(data) {
    window.dispatchEvent(new CustomEvent('user-message', {
      detail: data,
    }));
    return true;
  }

  filesChanged(selectedFiles) {
    window.dispatchEvent(new CustomEvent('files-changed', {
      detail: { selectedFiles },
    }));
    return true;
  }

  /**
   * Receive file navigation broadcast from server.
   * Called via RPC: AcApp.navigateFile(data)
   */
  navigateFile(data) {
    if (!data?.path) return true;
    // Dispatch locally so diff-viewer/svg-viewer open the file.
    // Use a flag to prevent re-broadcasting back to the server.
    window.dispatchEvent(new CustomEvent('navigate-file', {
      detail: { path: data.path, _remote: true },
    }));
    return true;
  }

  /**
   * Receive mode change notification from server.
   * Called via RPC: AcApp.modeChanged(data)
   */
  modeChanged(data) {
    window.dispatchEvent(new CustomEvent('mode-changed', {
      detail: data,
    }));
    return true;
  }

  /**
   * Receive session change notification (new session or loaded session).
   * Called via RPC: AcApp.sessionChanged(data)
   */
  sessionChanged(data) {
    window.dispatchEvent(new CustomEvent('session-loaded', {
      detail: data,
    }));
    return true;
  }

  /**
   * Receive admission request notification (another client wants to connect).
   * Called via RPC: AcApp.admissionRequest(data)
   *
   * jrpc-oo server.call['AcApp.admissionRequest'](data) sends params=[data].
   * The class-method dispatch calls this as admissionRequest(data).
   */
  admissionRequest(data) {
    if (!data?.client_id) return true;
    // Avoid duplicates by client_id
    if (this._admissionRequests.find(r => r.client_id === data.client_id)) return true;
    // Replace any existing request from the same IP (e.g. browser refresh)
    this._admissionRequests = [
      ...this._admissionRequests.filter(r => r.ip !== data.ip),
      data,
    ];
    return true;
  }

  /**
   * Receive admission result (a pending client was admitted or denied).
   * Called via RPC: AcApp.admissionResult(data)
   */
  admissionResult(data) {
    if (!data?.client_id) return true;
    // Remove from pending requests list
    this._admissionRequests = this._admissionRequests.filter(
      r => r.client_id !== data.client_id
    );
    return true;
  }

  /**
   * Receive notification that a client joined.
   * Called via RPC: AcApp.clientJoined(data)
   */
  clientJoined(data) {
    this._fetchConnectedClients();
    return true;
  }

  /**
   * Receive notification that a client left.
   * Called via RPC: AcApp.clientLeft(data)
   */
  clientLeft(data) {
    this._fetchConnectedClients();
    return true;
  }

  /**
   * Receive notification that our role changed (e.g. promoted to host).
   * Called via RPC: AcApp.roleChanged(data)
   */
  roleChanged(data) {
    this._fetchCollabRole();
    if (data?.role === 'host') {
      this._showToast('You are now the host', 'success');
    }
    return true;
  }

  /**
   * Receive startup progress from server during deferred initialization.
   * Called via RPC: AcApp.startupProgress(stage, message, percent)
   */
  startupProgress(stage, message, percent) {
    // doc_index is a background task — don't let it stall the startup overlay.
    // Forward its progress to the dialog header bar only.
    if (stage === 'doc_index') {
      // Only forward in-progress updates; the completion signal comes
      // via compaction-event (doc_index_ready) which the dialog handles.
      if (percent < 100) {
        window.dispatchEvent(new CustomEvent('mode-switch-progress', {
          detail: { message: message || '', percent: percent || 0 },
        }));
      }
      return true;
    }

    this._startupMessage = message || '';
    if (typeof percent === 'number') {
      this._startupPercent = Math.min(100, Math.max(0, percent));
    }
    if (stage === 'ready') {
      // Dismiss overlay with a short delay for the animation
      setTimeout(() => {
        this._startupVisible = false;
      }, 400);
    }

    return true;
  }

  // === Admission Actions ===

  async _admitClient(clientId) {
    try {
      await this.call['Collab.admit_client'](clientId);
    } catch (e) {
      console.warn('admit_client failed:', e);
    }
  }

  async _denyClient(clientId) {
    try {
      await this.call['Collab.deny_client'](clientId);
    } catch (e) {
      console.warn('deny_client failed:', e);
    }
  }

  async _fetchCollabRole() {
    try {
      const raw = await this.call['Collab.get_collab_role']();
      const role = this._extract(raw);
      if (role) {
        SharedRpc.setCollabRole(role);
      }
    } catch (e) {
      console.warn('Failed to fetch collab role:', e);
    }
  }

  async _fetchConnectedClients() {
    try {
      const raw = await this.call['Collab.get_connected_clients']();
      const clients = this._extract(raw);
      if (Array.isArray(clients)) {
        this._connectedClients = clients.length;
        window.dispatchEvent(new CustomEvent('collab-client-count', {
          detail: { count: this._connectedClients },
        }));
      }
    } catch (e) {
      console.warn('Failed to fetch connected clients:', e);
    }
  }

  _cancelAdmission() {
    // User cancelled while waiting for admission — close the WebSocket
    this._admissionPending = false;
    try {
      if (this._ws) this._ws.close();
    } catch (_) {}
  }

  // === Initial state ===

  async _loadInitialState() {
    try {
      const raw = await this.call['LLMService.get_current_state']();
      // Unwrap jrpc-oo envelope
      const state = this._extract(raw);

      // Set browser tab title to ⚡ {repo_name}
      if (state?.repo_name) {
        document.title = `${state.repo_name}`;
        this._repoName = state.repo_name;
      }

      // If server already finished initialization (e.g. browser connected
      // after suspend/resume or slow page load), dismiss the startup overlay.
      // The startupProgress("ready") RPC may have been sent while disconnected.
      if (state?.init_complete) {
        this._startupVisible = false;
      }

      // Broadcast mode from server state
      if (state?.mode) {
        window.dispatchEvent(new CustomEvent('mode-changed', {
          detail: { mode: state.mode },
        }));
      }

      window.dispatchEvent(new CustomEvent('state-loaded', { detail: state }));
      this._reopenLastFile();

      // Fetch collaboration role and connected clients count
      await this._fetchCollabRole();
      await this._fetchConnectedClients();
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
      const path = localStorage.getItem(_repoKey(STORAGE_KEY_LAST_FILE, this._repoName));
      if (!path) return;

      // Read saved viewport before navigating (navigation may overwrite it)
      const raw = localStorage.getItem(_repoKey(STORAGE_KEY_LAST_VIEWPORT, this._repoName));
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
      const path = localStorage.getItem(_repoKey(STORAGE_KEY_LAST_FILE, this._repoName));
      if (!path) return;

      // Only save viewport for diff files (SVG zoom restore not yet supported)
      if (path.toLowerCase().endsWith('.svg')) return;

      const diffV = this.shadowRoot?.querySelector('ac-diff-viewer');
      if (diffV) {
        const diffState = diffV.getViewportState?.() ?? null;
        if (!diffState) return;
        const viewport = { path, type: 'diff', diff: diffState };
        localStorage.setItem(_repoKey(STORAGE_KEY_LAST_VIEWPORT, this._repoName), JSON.stringify(viewport));
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
   *
   * Also registers each file-open in the navigation graph (unless it came from
   * the graph itself via _fromNav flag).
   */
  _onNavigateFile(e) {
    const detail = e.detail;
    if (!detail?.path) return;

    // Register in navigation graph (unless this event came from the nav graph
    // itself — _fromNav — or from a programmatic refresh)
    if (!detail._fromNav && !detail._refresh) {
      const fileNav = this.shadowRoot?.querySelector('ac-file-nav');
      if (fileNav) {
        fileNav.openFile(detail.path);
      }
    }

    // Broadcast to collaborators (skip if this event originated from a remote)
    if (!detail._remote && this.call) {
      try {
        this.call['LLMService.navigate_file'](detail.path);
      } catch (_) {}
    }

    // Save viewport state of the currently-open file before navigating away
    // (non-blocking — avoid synchronous layout queries during navigation)
    try { this._saveViewportState(); } catch (_) {}

    // Remember last opened file for restore on refresh
    try { localStorage.setItem(_repoKey(STORAGE_KEY_LAST_FILE, this._repoName), detail.path); } catch (_) {}

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
   * Intercept global keyboard shortcuts:
   * - Ctrl+S: prevent browser Save dialog
   * - Alt+Arrow: file navigation graph traversal
   * - Escape: dismiss file nav HUD
   */
  _onGlobalKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      return;
    }

    // Alt+Arrow — file navigation grid
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      const dirMap = {
        ArrowRight: 'right',
        ArrowLeft: 'left',
        ArrowUp: 'up',
        ArrowDown: 'down',
      };
      const dir = dirMap[e.key];
      if (dir) {
        const fileNav = this.shadowRoot?.querySelector('ac-file-nav');
        if (!fileNav || !fileNav.hasNodes) return;

        fileNav.show();

        const targetPath = fileNav.navigateDirection(dir);
        if (targetPath) {
          e.preventDefault();
          e.stopPropagation();
          window.dispatchEvent(new CustomEvent('navigate-file', {
            detail: { path: targetPath, _fromNav: true },
          }));
        } else {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
    }

    // Escape — dismiss file nav HUD
    if (e.key === 'Escape') {
      const fileNav = this.shadowRoot?.querySelector('ac-file-nav');
      if (fileNav?.visible) {
        fileNav.hideImmediate();
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }

  _onGlobalKeyUp(e) {
    if (e.key === 'Alt') {
      const fileNav = this.shadowRoot?.querySelector('ac-file-nav');
      if (fileNav?.visible) {
        fileNav.hide();
      }
    }
  }

  _onBeforeUnload() {
    this._saveViewportState();
  }

  /**
   * Force viewers to re-layout when the window is resized
   * (e.g. laptop lid reopen, maximize, display change).
   * Throttled to one layout per animation frame to avoid jank.
   *
   * Also scales the dialog container proportionally so the
   * dialog / editor split ratio is preserved across window sizes.
   */
  _onWindowResize() {
    if (this._resizeRAF) return;
    this._resizeRAF = requestAnimationFrame(() => {
      this._resizeRAF = null;

      // Scale dialog container proportionally
      const container = this.shadowRoot?.querySelector('.dialog-container');
      if (container && this._lastViewportWidth) {
        const oldWidth = container.offsetWidth;
        const newVW = window.innerWidth;
        if (oldWidth && newVW !== this._lastViewportWidth) {
          const ratio = oldWidth / this._lastViewportWidth;
          const newWidth = Math.max(300, Math.round(ratio * newVW));
          container.style.width = `${newWidth}px`;
          try { localStorage.setItem('ac-dc-dialog-width', String(newWidth)); } catch (_) {}
        }
      }
      this._lastViewportWidth = window.innerWidth;

      const diffV = this.shadowRoot?.querySelector('ac-diff-viewer');
      if (diffV?._editor) {
        diffV._editor.layout();
      }
    });
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
      <ac-file-nav></ac-file-nav>

      ${this._admissionPending ? html`
        <div class="admission-overlay" role="status" aria-live="polite">
          <div class="admission-brand">AC⚡DC</div>
          <div class="admission-message">Waiting for admission...</div>
          <div class="admission-sub">Requesting access to ac-dc</div>
          <button class="admission-btn" @click=${this._onAdmissionCancel}>Cancel</button>
        </div>
      ` : this._admissionDenied ? html`
        <div class="admission-overlay" role="alert">
          <div class="admission-brand">AC⚡DC</div>
          <div class="admission-denied-msg">Access denied</div>
          <div class="admission-sub">Your connection was not admitted.</div>
        </div>
      ` : ''}

      ${this._startupVisible ? html`
        <div class="startup-overlay" role="status" aria-live="polite" aria-label="Loading">
          <div class="startup-brand">AC⚡DC</div>
          <div class="startup-message">${this._startupMessage}</div>
          <div class="startup-bar-track">
            <div class="startup-bar-fill" style="width: ${this._startupPercent}%"></div>
          </div>
        </div>
      ` : ''}

      <div class="status-bar ${this._statusBar}" role="status" aria-live="polite"
           aria-label="${this._statusBar === 'ok' ? 'Connected' : this._statusBar === 'error' ? 'Disconnected' : ''}"></div>
      <div class="reconnect-banner ${this._reconnectVisible ? 'visible' : ''}"
           role="alert" aria-live="assertive">${this._reconnectMsg}</div>

      <div class="toast-container" role="status" aria-live="polite" aria-relevant="additions">
        ${this._admissionRequests.map(req => html`
          <div class="admission-toast" role="alert">
            <div>🔔 ${req.ip} wants to connect</div>
            <div class="admission-toast-actions">
              <button class="admit-btn" @click=${() => this._admitClient(req.client_id)}>Admit</button>
              <button class="deny-btn" @click=${() => this._denyClient(req.client_id)}>Deny</button>
            </div>
          </div>
        `)}
        ${this._toasts.map(t => html`
          <div class="global-toast ${t.type} ${t.fading ? 'fading' : ''}" role="alert">${t.message}</div>
        `)}
      </div>
    `;
  }
}

customElements.define('ac-app', AcApp);