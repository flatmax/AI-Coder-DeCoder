/**
 * AcApp — root application shell.
 *
 * Extends JRPCClient (from jrpc-oo) to hold the WebSocket connection.
 * Routes events between dialog, diff viewer, and SVG viewer.
 * Publishes SharedRpc on connection for child components.
 */

import { html, css } from 'lit';
import { SharedRpc } from './utils/shared-rpc.js';
import { getServerPort, getServerURI } from './utils/helpers.js';

// jrpc-oo client — loaded from node_modules
import { JRPCClient } from '@flatmax/jrpc-oo/dist/bundle.js';

// Eagerly import the files tab (default tab, always rendered)
import './components/ac-dialog.js';
import './components/ac-files-tab.js';
import './components/ac-diff-viewer.js';
import './components/ac-svg-viewer.js';
import './components/ac-file-nav.js';
import './components/ac-token-hud.js';

const SERVER_PORT = getServerPort();

export class AcApp extends JRPCClient {
  static properties = {
    serverURI: { type: String },
    _connected: { type: Boolean, state: true },
    _startupVisible: { type: Boolean, state: true },
    _startupMessage: { type: String, state: true },
    _startupPercent: { type: Number, state: true },
    _wasConnected: { type: Boolean, state: true },
    _reconnectAttempt: { type: Number, state: true },
    _toasts: { type: Array, state: true },
    _activeViewer: { type: String, state: true },
    _admissionPending: { type: Boolean, state: true },
    _admissionDenied: { type: Boolean, state: true },
    _admissionRequests: { type: Array, state: true },
  };

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      position: relative;
    }

    .viewer-background {
      position: fixed;
      inset: 0;
      z-index: 0;
      background: var(--bg-primary);
    }

    /* Startup overlay */
    .startup-overlay {
      position: fixed;
      inset: 0;
      z-index: 10000;
      background: var(--bg-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      transition: opacity 0.4s ease;
    }
    .startup-overlay.fade-out {
      opacity: 0;
      pointer-events: none;
    }
    .startup-brand {
      font-size: 3rem;
      margin-bottom: 1.5rem;
      color: var(--accent-primary);
    }
    .startup-status {
      color: var(--text-secondary);
      margin-bottom: 1rem;
      font-size: 0.9rem;
    }
    .startup-bar-track {
      width: 300px;
      height: 4px;
      background: var(--bg-tertiary);
      border-radius: 2px;
      overflow: hidden;
    }
    .startup-bar-fill {
      height: 100%;
      background: var(--accent-primary);
      border-radius: 2px;
      transition: width 0.3s ease;
    }

    /* Reconnect banner */
    .reconnect-banner {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 9999;
      background: var(--accent-orange);
      color: #000;
      text-align: center;
      padding: 6px 12px;
      font-size: 0.85rem;
      font-weight: 500;
    }

    /* Admission pending screen */
    .admission-pending {
      position: fixed;
      inset: 0;
      z-index: 10002;
      background: var(--bg-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 16px;
    }
    .admission-pending .title {
      font-size: 1.5rem;
      color: var(--accent-primary);
    }
    .admission-pending .subtitle {
      color: var(--text-secondary);
      font-size: 0.9rem;
    }
    .admission-pending .cancel-btn {
      background: none;
      border: 1px solid var(--border-primary);
      border-radius: 6px;
      color: var(--text-secondary);
      cursor: pointer;
      padding: 6px 16px;
      font-size: 0.85rem;
    }
    .admission-pending .cancel-btn:hover {
      color: var(--text-primary);
      border-color: var(--accent-primary);
    }

    .admission-denied {
      position: fixed;
      inset: 0;
      z-index: 10002;
      background: var(--bg-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 12px;
    }
    .admission-denied .title {
      font-size: 1.3rem;
      color: var(--accent-red);
    }

    /* Admission request toasts */
    .admission-toasts {
      position: fixed;
      top: 60px;
      right: 16px;
      z-index: 10001;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .admission-toast {
      background: var(--bg-secondary);
      border: 1px solid var(--accent-orange);
      border-radius: 8px;
      padding: 12px 16px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 260px;
    }
    .admission-toast .info {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.85rem;
      color: var(--text-primary);
    }
    .admission-toast .actions {
      display: flex;
      gap: 8px;
    }
    .admission-toast .admit-btn {
      background: var(--accent-green);
      color: #000;
      border: none;
      border-radius: 4px;
      padding: 4px 12px;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.8rem;
    }
    .admission-toast .deny-btn {
      background: var(--accent-red);
      color: #fff;
      border: none;
      border-radius: 4px;
      padding: 4px 12px;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.8rem;
    }

    /* Global toasts */
    .toast-container {
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 10001;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    }
    .toast {
      pointer-events: auto;
      background: var(--bg-secondary);
      color: var(--text-primary);
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      padding: 10px 16px;
      font-size: 0.85rem;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      transition: opacity 0.3s ease;
    }
    .toast.fade-out { opacity: 0; }
    .toast.error { border-color: var(--accent-red); }
    .toast.success { border-color: var(--accent-green); }
  `;

  constructor() {
    super();
    this.remoteTimeout = 120;

    this._connected = false;
    this._startupVisible = true;
    this._startupMessage = 'Connecting...';
    this._startupPercent = 0;
    this._wasConnected = false;
    this._reconnectAttempt = 0;
    this._toasts = [];
    this._resizeRAF = null;
    this._pendingReopen = false;
    this._admissionPending = false;
    this._rawWsListener = null;
    this._activeViewer = 'diff';
  }

  connectedCallback() {
    super.connectedCallback();

    // Set serverURI to trigger jrpc-oo connection via Lit's updated() → serverChanged()
    this.serverURI = getServerURI(SERVER_PORT);

    // Register methods the server can call
    this.addClass(this, 'AcApp');

    // Window-level event listeners
    window.addEventListener('navigate-file', this._onNavigateFile.bind(this));
    window.addEventListener('active-file-changed', this._onActiveFileChanged.bind(this));
    window.addEventListener('file-save', this._onFileSave.bind(this));
    window.addEventListener('files-modified', this._onFilesModified.bind(this));
    window.addEventListener('ac-toast', this._onGlobalToast.bind(this));
    window.addEventListener('resize', this._onWindowResize.bind(this));
    window.addEventListener('beforeunload', this._onBeforeUnload.bind(this));

    // Collaboration role
    this._isLocalhost = true;
    this._collabRole = 'host';
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._resizeRAF) {
      cancelAnimationFrame(this._resizeRAF);
      this._resizeRAF = null;
    }
  }

  // ── jrpc-oo lifecycle ────────────────────────────────────────

  /** Called when WebSocket is created — hook for raw message interception. */
  serverChanged() {
    super.serverChanged();
    // Intercept raw WebSocket messages for collaboration admission
    const ws = this.ws;
    if (ws && ws.addEventListener) {
      if (this._rawWsListener) {
        ws.removeEventListener('message', this._rawWsListener);
      }
      this._rawWsListener = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data?.type === 'admission_pending') {
            this._admissionPending = true;
            event.stopImmediatePropagation();
            return;
          }
          if (data?.type === 'admission_granted') {
            this._admissionPending = false;
            event.stopImmediatePropagation();
            return;
          }
          if (data?.type === 'admission_denied') {
            this._admissionPending = false;
            event.stopImmediatePropagation();
            return;
          }
        } catch (_) { /* not JSON — let jrpc-oo handle it */ }
      };
      ws.addEventListener('message', this._rawWsListener);
    }
  }

  /** Connection confirmed — remote is ready. */
  remoteIsUp() {
    this._connected = true;
    this._reconnectAttempt = 0;
  }

  /** JRPC setup complete — call proxy populated. */
  setupDone() {
    this._connected = true;

    // Publish the call proxy for child components via RpcMixin.
    // this.call broadcasts to all connected remotes — from the browser
    // there is only one remote (the server), so the envelope has one key.
    SharedRpc.set(this.call);

    // Fetch initial state
    this._loadInitialState();

    // On reconnect (not first connect), show toast instead of startup overlay
    if (this._wasConnected) {
      this._startupVisible = false;
      window.dispatchEvent(new CustomEvent('ac-toast', {
        detail: { message: 'Reconnected', type: 'success' },
      }));
    }
  }

  /** Connection failed. */
  setupSkip() {
    this._connected = false;
  }

  /** WebSocket closed. */
  remoteDisconnected() {
    this._connected = false;
    SharedRpc.clear();

    if (this._wasConnected) {
      this._reconnectAttempt++;
      this._scheduleReconnect();
    }
  }

  // ── Server → Client callbacks ────────────────────────────────

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
    // Refresh open files in both viewers if files were modified
    if (result?.files_modified?.length) {
      const viewer = this.shadowRoot?.querySelector('ac-diff-viewer');
      if (viewer) viewer.refreshOpenFiles();
      const svgViewer = this.shadowRoot?.querySelector('ac-svg-viewer');
      if (svgViewer) svgViewer.refreshOpenFiles();
    }
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

  startupProgress(stage, message, percent) {
    this._startupMessage = message;
    this._startupPercent = percent;
    if (stage === 'ready') {
      this._dismissStartup();
    }
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

  admissionRequest(data) {
    // Show admission toast for this pending client
    // Replace existing toast from same IP
    const filtered = this._admissionRequests.filter(
      r => r.ip !== data.ip
    );
    this._admissionRequests = [...filtered, data];

    window.dispatchEvent(new CustomEvent('admission-request', {
      detail: data,
    }));
    return true;
  }

  admissionResult(data) {
    // Remove the resolved request from admission toasts
    this._admissionRequests = this._admissionRequests.filter(
      r => r.client_id !== data.client_id
    );

    window.dispatchEvent(new CustomEvent('admission-result', {
      detail: data,
    }));
    return true;
  }

  clientJoined(data) {
    window.dispatchEvent(new CustomEvent('client-joined', { detail: data }));
    return true;
  }

  clientLeft(data) {
    window.dispatchEvent(new CustomEvent('client-left', { detail: data }));
    return true;
  }

  roleChanged(data) {
    window.dispatchEvent(new CustomEvent('role-changed', { detail: data }));
    return true;
  }

  navigateFile(data) {
    window.dispatchEvent(new CustomEvent('navigate-file', {
      detail: { path: data.path, _remote: true },
    }));
    return true;
  }

  modeChanged(data) {
    window.dispatchEvent(new CustomEvent('mode-changed', {
      detail: data,
    }));
    return true;
  }

  sessionChanged(data) {
    window.dispatchEvent(new CustomEvent('session-loaded', {
      detail: { sessionId: data?.session_id, messages: data?.messages || [] },
    }));
    return true;
  }

  docConvertProgress(data) {
    window.dispatchEvent(new CustomEvent('doc-convert-progress', {
      detail: data,
    }));
    return true;
  }

  // ── State loading ────────────────────────────────────────────

  /**
   * Extract the actual return value from a jrpc-oo response envelope.
   * jrpc-oo wraps return values as { method_name: value } or { uuid: value }.
   */
  _extract(raw) {
    if (raw && typeof raw === 'object') {
      const keys = Object.keys(raw);
      if (keys.length === 1) return raw[keys[0]];
    }
    return raw;
  }

  async _loadInitialState() {
    try {
      const raw = await this.call['LLMService.get_current_state']();
      const state = this._extract(raw);

      // Set browser tab title
      if (state?.repo_name) {
        document.title = state.repo_name;
      }

      this._wasConnected = true;

      // Query collab role (best-effort — fails silently in non-collab mode)
      try {
        const roleRaw = await this.call['Collab.get_collab_role']();
        const role = this._extract(roleRaw);
        if (role) {
          this._isLocalhost = role.is_localhost !== false;
          this._collabRole = role.role || 'host';
        }
      } catch (_) {
        // Not in collab mode — default to localhost/host
        this._isLocalhost = true;
        this._collabRole = 'host';
      }

      // Dispatch state-loaded event with collab info
      window.dispatchEvent(new CustomEvent('state-loaded', {
        detail: { ...state, _isLocalhost: this._isLocalhost, _collabRole: this._collabRole },
      }));

      // If init already complete, dismiss startup and reopen file
      if (state?.init_complete) {
        this._dismissStartup();
      }
    } catch (e) {
      console.error('Failed to load initial state:', e);
    }
  }

  _dismissStartup() {
    if (!this._startupVisible) return;
    // Fade out after brief delay
    setTimeout(() => {
      this._startupVisible = false;
      // Reopen last file if pending
      if (this._pendingReopen) {
        this._pendingReopen = false;
        this._reopenLastFile();
      }
    }, 400);
  }

  _reopenLastFile() {
    const path = localStorage.getItem('ac-last-open-file');
    if (!path) return;

    window.dispatchEvent(new CustomEvent('navigate-file', {
      detail: { path },
    }));

    // Restore viewport state
    try {
      const raw = localStorage.getItem('ac-last-viewport');
      if (raw) {
        const state = JSON.parse(raw);
        if (state?.path === path && state?.type === 'diff') {
          // Wait for file to open then restore viewport
          const handler = (e) => {
            if (e.detail?.path === path) {
              window.removeEventListener('active-file-changed', handler);
              requestAnimationFrame(() => requestAnimationFrame(() => {
                const viewer = this.shadowRoot?.querySelector('ac-diff-viewer');
                if (viewer) viewer.restoreViewportState(state);
              }));
            }
          };
          window.addEventListener('active-file-changed', handler);
          // Safety timeout
          setTimeout(() => window.removeEventListener('active-file-changed', handler), 10000);
        }
      }
    } catch (_) {}
  }

  // ── Reconnection ─────────────────────────────────────────────

  _scheduleReconnect() {
    const delays = [1000, 2000, 4000, 8000, 15000];
    const delay = delays[Math.min(this._reconnectAttempt - 1, delays.length - 1)];
    setTimeout(() => {
      if (!this._connected) {
        // Trigger reconnection via jrpc-oo's serverChanged() mechanism.
        // Setting serverURI to the same value won't trigger Lit's updated(),
        // so we briefly clear it then set it back.
        const uri = getServerURI(SERVER_PORT);
        this.serverURI = '';
        requestAnimationFrame(() => { this.serverURI = uri; });
      }
    }, delay);
  }

  // ── Admission actions ────────────────────────────────────────

  async _admitClient(clientId) {
    try {
      await this.call['Collab.admit_client'](clientId);
    } catch (e) {
      console.warn('Admit failed:', e);
    }
  }

  async _denyClient(clientId) {
    try {
      await this.call['Collab.deny_client'](clientId);
    } catch (e) {
      console.warn('Deny failed:', e);
    }
  }

  _cancelAdmission() {
    // Close WebSocket to cancel pending admission
    const ws = this.ws;
    if (ws) {
      try { ws.close(); } catch (_) {}
    }
    this._admissionPending = false;
  }

  // ── Viewer switching ─────────────────────────────────────────

  _setActiveViewer(type) {
    if (this._activeViewer === type) return;
    this._activeViewer = type;
    // CSS classes toggle visibility with opacity transition
    const diffViewer = this.shadowRoot?.querySelector('ac-diff-viewer');
    const svgViewer = this.shadowRoot?.querySelector('ac-svg-viewer');
    if (diffViewer) {
      diffViewer.style.opacity = type === 'diff' ? '1' : '0';
      diffViewer.style.pointerEvents = type === 'diff' ? 'auto' : 'none';
    }
    if (svgViewer) {
      svgViewer.style.opacity = type === 'svg' ? '1' : '0';
      svgViewer.style.pointerEvents = type === 'svg' ? 'auto' : 'none';
    }
  }

  // ── Event handlers ───────────────────────────────────────────

  _onNavigateFile(e) {
    const { path, line, searchText, _remote } = e.detail || {};
    if (!path) return;

    // Save last opened file
    localStorage.setItem('ac-last-open-file', path);

    // If startup overlay still showing, defer
    if (this._startupVisible) {
      this._pendingReopen = true;
      return;
    }

    // Register with file navigation grid (unless this came from the grid itself)
    const fileNav = this.shadowRoot?.querySelector('ac-file-nav');
    if (fileNav && !e.detail?._fromNav) {
      fileNav.openFile(path);
    }

    // Route based on file extension
    const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
    if (ext === '.svg') {
      const svgViewer = this.shadowRoot?.querySelector('ac-svg-viewer');
      if (svgViewer) {
        svgViewer.openFile({ path });
        this._setActiveViewer('svg');
      }
      return;
    }

    const viewer = this.shadowRoot?.querySelector('ac-diff-viewer');
    if (viewer) {
      viewer.openFile({ path, line, searchText });
      this._setActiveViewer('diff');
    }
  }

  _onGlobalToast(e) {
    const { message, type } = e.detail || {};
    if (!message) return;
    const id = Date.now() + Math.random();
    this._toasts = [...this._toasts, { id, message, type: type || 'info' }];

    // Auto-dismiss after 3s
    setTimeout(() => {
      this._toasts = this._toasts.map(t =>
        t.id === id ? { ...t, fading: true } : t
      );
      setTimeout(() => {
        this._toasts = this._toasts.filter(t => t.id !== id);
      }, 300);
    }, 3000);
  }

  _onWindowResize() {
    if (this._resizeRAF) return;
    this._resizeRAF = requestAnimationFrame(() => {
      this._resizeRAF = null;
      // Notify viewers to relayout (Monaco, svg-pan-zoom)
      window.dispatchEvent(new CustomEvent('viewer-resize'));
    });
  }

  _onBeforeUnload() {
    // Save viewport state for the diff viewer
    window.dispatchEvent(new CustomEvent('save-viewport'));
  }

  _onActiveFileChanged(e) {
    const path = e.detail?.path || '';
    if (!path) return;
    const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
    this._setActiveViewer(ext === '.svg' ? 'svg' : 'diff');
  }

  _onFilesModified() {
    const viewer = this.shadowRoot?.querySelector('ac-diff-viewer');
    if (viewer && viewer._files?.length) {
      viewer.refreshOpenFiles();
    }
    const svgViewer = this.shadowRoot?.querySelector('ac-svg-viewer');
    if (svgViewer && svgViewer._files?.length) {
      svgViewer.refreshOpenFiles();
    }
  }

  async _onFileSave(e) {
    const { path, content, isConfig, configType } = e.detail || {};
    if (!path || content == null) return;

    try {
      if (isConfig && configType) {
        await this.call['Settings.save_config_content'](configType, content);
      } else {
        await this.call['Repo.write_file'](path, content);
      }
      // Refresh file tree
      window.dispatchEvent(new CustomEvent('files-modified', { detail: {} }));
    } catch (err) {
      window.dispatchEvent(new CustomEvent('ac-toast', {
        detail: { message: `Save failed: ${err.message || err}`, type: 'error' },
      }));
    }
  }

  // ── Render ───────────────────────────────────────────────────

  render() {
    return html`
      <!-- Background viewer layer -->
      <div class="viewer-background">
        <ac-diff-viewer style="position:absolute;inset:0;transition:opacity 0.15s"></ac-diff-viewer>
        <ac-svg-viewer style="position:absolute;inset:0;opacity:0;pointer-events:none;transition:opacity 0.15s"></ac-svg-viewer>
      </div>

      <!-- Token HUD (floating overlay on viewer) -->
      <ac-token-hud></ac-token-hud>

      <!-- File navigation grid (HUD overlay) -->
      <ac-file-nav></ac-file-nav>

      <!-- Dialog (foreground) -->
      <ac-dialog></ac-dialog>

      <!-- Startup overlay -->
      ${this._startupVisible ? html`
        <div class="startup-overlay ${this._startupPercent >= 100 ? 'fade-out' : ''}">
          <div class="startup-brand">AC⚡DC</div>
          <div class="startup-status">${this._startupMessage}</div>
          <div class="startup-bar-track">
            <div class="startup-bar-fill"
                 style="width: ${this._startupPercent}%"></div>
          </div>
        </div>
      ` : ''}

      <!-- Reconnect banner -->
      ${!this._connected && this._wasConnected ? html`
        <div class="reconnect-banner">
          Reconnecting... (attempt ${this._reconnectAttempt})
        </div>
      ` : ''}

      <!-- Admission pending screen (pre-JRPC) -->
      ${this._admissionPending ? html`
        <div class="admission-pending">
          <div class="title">AC⚡DC</div>
          <div class="subtitle">Waiting for admission...</div>
          <div class="subtitle">Requesting access to the session</div>
          <button class="cancel-btn" @click=${this._cancelAdmission}>Cancel</button>
        </div>
      ` : ''}

      <!-- Admission denied screen -->
      ${this._admissionDenied ? html`
        <div class="admission-denied">
          <div class="title">Access Denied</div>
          <div style="color:var(--text-secondary)">Your connection request was denied.</div>
        </div>
      ` : ''}

      <!-- Admission request toasts (for admitted clients) -->
      ${this._admissionRequests.length ? html`
        <div class="admission-toasts">
          ${this._admissionRequests.map(r => html`
            <div class="admission-toast">
              <div class="info">🔔 ${r.ip} wants to connect</div>
              <div class="actions">
                <button class="admit-btn" @click=${() => this._admitClient(r.client_id)}>Admit</button>
                <button class="deny-btn" @click=${() => this._denyClient(r.client_id)}>Deny</button>
              </div>
            </div>
          `)}
        </div>
      ` : ''}

      <!-- Global toasts -->
      ${this._toasts.length ? html`
        <div class="toast-container">
          ${this._toasts.map(t => html`
            <div class="toast ${t.type} ${t.fading ? 'fade-out' : ''}">
              ${t.message}
            </div>
          `)}
        </div>
      ` : ''}
    `;
  }
}

customElements.define('ac-app', AcApp);