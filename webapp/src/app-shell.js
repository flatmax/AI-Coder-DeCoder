// AppShell — root component of the AC-DC webapp.
//
// Owns the single WebSocket connection (inherits from JRPCClient),
// publishes the RPC proxy to SharedRpc for child components, drives
// the startup overlay off progress events from the backend, and
// hosts the dialog + viewer background layers.
//
// Governing specs:
//   - specs4/5-webapp/shell.md
//   - specs4/1-foundation/rpc-transport.md
//
// Phase 1 scope — minimum viable shell:
//   - Connect to the WebSocket using ?port=N from the URL
//   - Publish the call proxy to SharedRpc on setupDone
//   - Render a startup overlay that dismisses on the "ready" stage
//   - Render a placeholder dialog with three tab buttons
//   - Show reconnect toast on WebSocket loss and recovery
//
// Phase 2 fills in the dialog's tab content. Phase 3 adds the
// viewer background, file navigation grid, token HUD, and the
// richer UX concerns.

import { LitElement, html, css } from 'lit';
import { JRPCClient } from '@flatmax/jrpc-oo/jrpc-client.js';

import { SharedRpc } from './rpc.js';
import './files-tab.js';
import './diff-viewer.js';
import './svg-viewer.js';
import { viewerForPath } from './viewer-routing.js';

/**
 * Read the WebSocket port from the URL, falling back to 18080.
 *
 * Duplicates the logic from main.js so AppShell is self-contained —
 * the shell should be testable without main.js having run.
 * specs4/1-foundation/rpc-transport.md pins the ?port=N contract
 * between the Python launcher and the webapp.
 */
function getWebSocketPort() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('port');
  if (!raw) return 18080;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0 || parsed > 65535) {
    return 18080;
  }
  return parsed;
}

/**
 * Reconnection backoff schedule (ms).
 *
 * specs4/1-foundation/rpc-transport.md calls for "exponential
 * backoff (1s, 2s, 4s, 8s, cap 15s)". The 0th entry is the
 * delay before the FIRST reconnect attempt; subsequent entries
 * apply to retry 2, 3, ...
 */
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

/**
 * Name of the custom event used by child components (or utility
 * modules) to request a toast message. The shell catches these
 * and displays them in its toast layer.
 *
 * specs4/5-webapp/shell.md#toast-system — "Components dispatch
 * toast events; the shell catches and renders them."
 */
const TOAST_EVENT = 'ac-toast';

/**
 * AppShell — root LitElement, inherits from JRPCClient.
 *
 * JRPCClient handles the WebSocket + handshake plumbing. We
 * override `setupDone`, `remoteIsUp`, `remoteDisconnected`, and
 * `serverChanged` to hook into the lifecycle.
 */
export class AppShell extends JRPCClient {
  static properties = {
    /** Connection state — drives overlay and reconnect banner. */
    connectionState: { type: String, state: true },
    /** Startup progress — populated from AcApp.startupProgress. */
    startupStage: { type: String, state: true },
    startupMessage: { type: String, state: true },
    startupPercent: { type: Number, state: true },
    /** Whether the startup overlay is visible. */
    overlayVisible: { type: Boolean, state: true },
    /** Active dialog tab. */
    activeTab: { type: String, state: true },
    /** Active toasts (array of {id, message, type}). */
    toasts: { type: Array, state: true },
    /** Number of reconnect attempts (display only). */
    reconnectAttempt: { type: Number, state: true },
    /**
     * Which viewer is currently visible — `'diff'` or
     * `'svg'`. The viewer that isn't active gets the
     * `viewer-hidden` class (CSS opacity + pointer-events
     * off). Defaults to diff since it's the common case.
     */
    _activeViewer: { type: String, state: true },
  };

  static styles = css`
    :host {
      display: block;
      position: fixed;
      inset: 0;
      overflow: hidden;
      background: var(--bg-primary, #0d1117);
      color: var(--text-primary, #c9d1d9);
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    }

    /* Viewer background -- the diff viewer and SVG viewer
     * are absolutely-positioned siblings filling the
     * background layer. Only one is visible at a time
     * (class viewer-visible vs viewer-hidden). Opacity +
     * pointer-events transition gives a smooth cross-fade
     * without rebuilding the inactive viewer's DOM --
     * matters for the diff viewer's Monaco instances,
     * which are expensive to construct. */
    .viewer-background {
      position: absolute;
      inset: 0;
      overflow: hidden;
    }
    ac-diff-viewer,
    ac-svg-viewer {
      position: absolute;
      inset: 0;
      transition: opacity 150ms ease;
    }
    .viewer-visible {
      opacity: 1;
      pointer-events: auto;
      z-index: 1;
    }
    .viewer-hidden {
      opacity: 0;
      pointer-events: none;
      z-index: 0;
    }

    /* Dialog — foreground panel. Phase 1 gives it a stub
     * placeholder; Phase 2 wires up the tabs. */
    .dialog {
      position: absolute;
      top: 0;
      left: 0;
      bottom: 0;
      width: 50%;
      min-width: 400px;
      background: rgba(22, 27, 34, 0.95);
      border-right: 1px solid rgba(240, 246, 252, 0.1);
      display: flex;
      flex-direction: column;
      backdrop-filter: blur(8px);
    }
    .dialog-header {
      display: flex;
      gap: 0.25rem;
      padding: 0.5rem;
      border-bottom: 1px solid rgba(240, 246, 252, 0.1);
      align-items: center;
    }
    .tab-button {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-primary, #c9d1d9);
      padding: 0.4rem 0.8rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.875rem;
    }
    .tab-button:hover {
      background: rgba(240, 246, 252, 0.05);
    }
    .tab-button.active {
      background: rgba(88, 166, 255, 0.12);
      border-color: rgba(88, 166, 255, 0.3);
      color: var(--accent-primary, #58a6ff);
    }
    .dialog-body {
      flex: 1;
      min-height: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .dialog-body > ac-files-tab {
      flex: 1;
      min-height: 0;
    }
    .tab-placeholder {
      opacity: 0.5;
      font-style: italic;
      padding: 2rem;
      text-align: center;
    }

    /* Startup overlay. */
    .startup-overlay {
      position: absolute;
      inset: 0;
      background: var(--bg-primary, #0d1117);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      transition: opacity 400ms ease-out;
    }
    .startup-overlay.fading {
      opacity: 0;
      pointer-events: none;
    }
    .startup-brand {
      font-size: 5rem;
      margin-bottom: 2rem;
      letter-spacing: -0.05em;
    }
    .startup-brand .bolt {
      color: var(--accent-primary, #58a6ff);
    }
    .startup-message {
      font-size: 1rem;
      margin-bottom: 1rem;
      opacity: 0.75;
    }
    .startup-progress {
      width: 300px;
      height: 4px;
      background: rgba(240, 246, 252, 0.1);
      border-radius: 2px;
      overflow: hidden;
    }
    .startup-progress-bar {
      height: 100%;
      background: var(--accent-primary, #58a6ff);
      transition: width 300ms ease;
    }

    /* Reconnect banner — sits below dialog header when
     * connection is lost. */
    .reconnect-banner {
      background: rgba(248, 81, 73, 0.15);
      color: #f85149;
      padding: 0.5rem 1rem;
      font-size: 0.85rem;
      text-align: center;
      border-bottom: 1px solid rgba(248, 81, 73, 0.3);
    }

    /* Toast layer. */
    .toast-layer {
      position: fixed;
      bottom: 1rem;
      right: 1rem;
      z-index: 2000;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .toast {
      background: rgba(22, 27, 34, 0.95);
      border: 1px solid rgba(240, 246, 252, 0.2);
      border-radius: 6px;
      padding: 0.75rem 1rem;
      font-size: 0.875rem;
      min-width: 200px;
      max-width: 400px;
      backdrop-filter: blur(8px);
      animation: toast-in 200ms ease-out;
    }
    .toast.info { border-left: 3px solid var(--accent-primary, #58a6ff); }
    .toast.success { border-left: 3px solid #7ee787; }
    .toast.error { border-left: 3px solid #f85149; }
    .toast.warning { border-left: 3px solid #d29922; }
    @keyframes toast-in {
      from { opacity: 0; transform: translateX(20px); }
      to { opacity: 1; transform: translateX(0); }
    }
  `;

  constructor() {
    super();
    // JRPCClient configuration — serverURI set in connectedCallback
    // so the port is read at the right time.
    this.remoteTimeout = 60;

    this.connectionState = 'connecting';
    this.startupStage = '';
    this.startupMessage = 'Connecting…';
    this.startupPercent = 0;
    this.overlayVisible = true;
    this.activeTab = 'files';
    this.toasts = [];
    this.reconnectAttempt = 0;
    // Default to diff viewer — most files route there.
    // Flipped to 'svg' on navigate-file to an .svg path.
    this._activeViewer = 'diff';

    // Whether we've ever connected successfully. Controls
    // whether disconnects show the startup overlay (first
    // connect) vs a reconnect banner (subsequent).
    this._wasConnected = false;
    // Pending reconnect timeout handle.
    this._reconnectTimer = null;
    // Global toast event listener binding.
    this._onToastEvent = this._onToastEvent.bind(this);
    // Navigate-file routing. Bound so add/remove match.
    this._onNavigateFile = this._onNavigateFile.bind(this);
    this._onActiveFileChanged = this._onActiveFileChanged.bind(this);
    this._onLoadDiffPanel = this._onLoadDiffPanel.bind(this);
    this._onToggleSvgMode = this._onToggleSvgMode.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    this.addClass(this, 'AcApp');
    const port = getWebSocketPort();
    const host = window.location.hostname || 'localhost';
    this.serverURI = `ws://${host}:${port}`;
    window.addEventListener(TOAST_EVENT, this._onToastEvent);
    // navigate-file is dispatched by the files tab (file
    // picker clicks), the chat panel (file mention clicks),
    // and the navigateFile server-push callback (when
    // another collaborator opens a file). Extension-based
    // routing picks the right viewer.
    window.addEventListener('navigate-file', this._onNavigateFile);
    // toggle-svg-mode is dispatched by the SVG viewer's
    // "</>" button (visual → text diff) and by the diff
    // viewer's "🎨 Visual" button (text → visual). The
    // app shell orchestrates the viewer swap.
    window.addEventListener(
      'toggle-svg-mode',
      this._onToggleSvgMode,
    );
    // load-diff-panel comes from the history browser's
    // context menu (Phase 2e.4). The diff viewer's
    // loadPanel method does the actual ad-hoc
    // comparison rendering; we route from here so the
    // history browser doesn't need a direct diff viewer
    // reference.
    window.addEventListener(
      'load-diff-panel',
      this._onLoadDiffPanel,
    );
  }

  disconnectedCallback() {
    window.removeEventListener(TOAST_EVENT, this._onToastEvent);
    window.removeEventListener(
      'navigate-file',
      this._onNavigateFile,
    );
    window.removeEventListener(
      'toggle-svg-mode',
      this._onToggleSvgMode,
    );
    window.removeEventListener(
      'load-diff-panel',
      this._onLoadDiffPanel,
    );
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    super.disconnectedCallback();
  }

  // ---------------------------------------------------------------
  // JRPCClient lifecycle hooks
  // ---------------------------------------------------------------

  setupDone() {
    super.setupDone();
    // Publish the call proxy to the shared singleton. Child
    // components using RpcMixin subscribe to this and wake up.
    SharedRpc.set(this.call);
    this.connectionState = 'connected';
    this.reconnectAttempt = 0;

    if (this._wasConnected) {
      // This is a reconnect, not the first connect. Skip the
      // startup overlay and show a success toast instead.
      this.overlayVisible = false;
      this._showToast('Reconnected', 'success');
    }
    this._wasConnected = true;
  }

  remoteDisconnected() {
    try {
      super.remoteDisconnected?.();
    } catch (err) {
      // Defensive — jrpc-oo API may not always expose the
      // parent hook. Swallow and continue.
    }
    SharedRpc.set(null);
    this.connectionState = 'disconnected';
    if (this._wasConnected) {
      this._scheduleReconnect();
    }
  }

  setupSkip() {
    // Connection attempt failed entirely — schedule retry.
    try {
      super.setupSkip?.();
    } catch (err) {
      // same defensive rationale
    }
    if (!this._wasConnected) {
      // First-connect failure — stay on the startup overlay
      // with an updated message so the user sees progress.
      this.startupMessage = 'Waiting for server…';
    }
    this._scheduleReconnect();
  }

  // ---------------------------------------------------------------
  // Server-push callbacks (registered via addClass(this, 'AcApp'))
  // ---------------------------------------------------------------

  /**
   * Startup progress event. Drives the overlay's message +
   * progress bar. When stage === 'ready', the overlay fades out.
   *
   * specs4/5-webapp/shell.md#startup-overlay pins the stage names
   * and message conventions; the backend's startup sequence fires
   * these in order during deferred init.
   */
  startupProgress(stage, message, percent) {
    this.startupStage = stage || '';
    this.startupMessage = message || '';
    this.startupPercent = Math.max(0, Math.min(100, percent || 0));
    if (stage === 'ready') {
      // Fade out shortly after ready so the user briefly sees
      // 100%. The CSS transition handles the actual fade.
      setTimeout(() => {
        this.overlayVisible = false;
      }, 400);
    }
    return true;
  }

  // Stubs for Phase 2/3 callbacks. Declared so the addClass
  // registration exposes them over RPC from day one — the
  // backend will call them even in Phase 1 and we want "method
  // not found" errors to surface in logs rather than silently
  // vanishing.

  streamChunk(requestId, content) {
    // Phase 2: chat panel listens via window event.
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

  userMessage(data) {
    window.dispatchEvent(new CustomEvent('user-message', { detail: data }));
    return true;
  }

  commitResult(result) {
    window.dispatchEvent(new CustomEvent('commit-result', { detail: result }));
    return true;
  }

  modeChanged(data) {
    window.dispatchEvent(new CustomEvent('mode-changed', { detail: data }));
    return true;
  }

  sessionChanged(data) {
    window.dispatchEvent(new CustomEvent('session-changed', { detail: data }));
    return true;
  }

  navigateFile(data) {
    // The `_remote: true` flag lets the frontend distinguish
    // broadcast-driven navigation from user-initiated, so
    // collaborators don't echo-broadcast.
    window.dispatchEvent(new CustomEvent('navigate-file', {
      detail: { ...data, _remote: true },
    }));
    return true;
  }

  docConvertProgress(data) {
    window.dispatchEvent(new CustomEvent('doc-convert-progress', {
      detail: data,
    }));
    return true;
  }

  // Collab callbacks — Phase 3.
  admissionRequest(data) {
    window.dispatchEvent(new CustomEvent('admission-request', { detail: data }));
    return true;
  }

  admissionResult(data) {
    window.dispatchEvent(new CustomEvent('admission-result', { detail: data }));
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

  // ---------------------------------------------------------------
  // Reconnection
  // ---------------------------------------------------------------

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    const attempt = this.reconnectAttempt;
    const delayIdx = Math.min(attempt, RECONNECT_DELAYS_MS.length - 1);
    const delay = RECONNECT_DELAYS_MS[delayIdx];
    this.reconnectAttempt = attempt + 1;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._attemptReconnect();
    }, delay);
  }

  _attemptReconnect() {
    // jrpc-oo's JRPCClient reconnects by re-assigning serverURI
    // to the same value — its internal setter tears down the
    // old socket and opens a new one. Force a re-set by
    // nulling and restoring.
    const uri = this.serverURI;
    try {
      this.serverURI = null;
      this.serverURI = uri;
    } catch (err) {
      // If the setter is unavailable, fall through to the next
      // scheduled retry.
      this._scheduleReconnect();
    }
  }

  // ---------------------------------------------------------------
  // Viewer routing
  // ---------------------------------------------------------------

  /**
   * Route a `navigate-file` event to the appropriate viewer
   * based on the file's extension. Dispatches `openFile` on
   * the target viewer. The viewer's `active-file-changed`
   * event then triggers visibility toggling.
   *
   * The `_remote` flag on broadcasts is consumed by the
   * chat panel / picker to suppress re-broadcasts — we
   * don't care about it here. Same routing applies
   * whether the event came from a local click or a
   * collaboration broadcast.
   */
  _onNavigateFile(event) {
    const detail = event.detail || {};
    const path = detail.path;
    if (typeof path !== 'string' || !path) return;
    const target = viewerForPath(path);
    if (!target) return;
    // Defer until the viewers exist in the DOM. Normally
    // they're rendered from the first template commit and
    // this is synchronous; the guard protects against
    // navigate-file firing before first render (rare,
    // but possible during startup).
    this.updateComplete.then(() => {
      const viewer =
        target === 'svg'
          ? this.shadowRoot?.querySelector('ac-svg-viewer')
          : this.shadowRoot?.querySelector('ac-diff-viewer');
      if (!viewer) return;
      viewer.openFile({
        path,
        line: detail.line,
        searchText: detail.searchText,
      });
    });
  }

  /**
   * Route a `load-diff-panel` event to the diff viewer's
   * loadPanel method. Dispatched by the history browser's
   * context menu for ad-hoc comparison. Shows the diff
   * viewer (switches active viewer if currently on SVG)
   * so the user sees the result immediately.
   */
  _onLoadDiffPanel(event) {
    const detail = event.detail || {};
    const { content, panel, label } = detail;
    if (typeof content !== 'string') return;
    if (panel !== 'left' && panel !== 'right') return;
    this._activeViewer = 'diff';
    this.updateComplete.then(() => {
      const viewer =
        this.shadowRoot?.querySelector('ac-diff-viewer');
      if (!viewer || typeof viewer.loadPanel !== 'function') {
        return;
      }
      viewer.loadPanel(content, panel, label);
    });
  }

  /**
   * Handle `toggle-svg-mode` from either viewer. Switches
   * between the visual SVG viewer and the Monaco text diff
   * editor for the same file, carrying content and dirty
   * state across.
   */
  _onToggleSvgMode(event) {
    const detail = event.detail || {};
    const { path, target, modified, savedContent } = detail;
    if (!path || !target) return;
    this.updateComplete.then(() => {
      const diffViewer =
        this.shadowRoot?.querySelector('ac-diff-viewer');
      const svgViewer =
        this.shadowRoot?.querySelector('ac-svg-viewer');
      if (target === 'diff') {
        // Visual → text diff.
        this._activeViewer = 'diff';
        if (diffViewer) {
          diffViewer.closeFile(path);
          diffViewer.openFile({
            path,
            virtualContent: undefined,
          }).then(() => {
            // If we have modified content from the SVG
            // editor, update the diff viewer's file so
            // visual edits appear as dirty in text mode.
            if (typeof modified === 'string') {
              const file = diffViewer._files?.find(
                (f) => f.path === path,
              );
              if (file) {
                file.modified = modified;
                if (typeof savedContent === 'string') {
                  file.savedContent = savedContent;
                }
                diffViewer._recomputeDirtyCount();
                diffViewer._showEditor?.();
              }
            }
          });
        }
      } else if (target === 'visual') {
        // Text diff → visual.
        this._activeViewer = 'svg';
        if (svgViewer && diffViewer) {
          // Read latest content from the diff viewer.
          const diffFile = diffViewer._files?.find(
            (f) => f.path === path,
          );
          const latestModified = diffFile?.modified;
          const latestSaved = diffFile?.savedContent;
          diffViewer.closeFile(path);
          svgViewer.closeFile(path);
          svgViewer.openFile({
            path,
            ...(typeof latestModified === 'string'
              ? { modified: latestModified }
              : {}),
          }).then(() => {
            if (typeof latestSaved === 'string') {
              const svgFile = svgViewer._files?.find(
                (f) => f.path === path,
              );
              if (svgFile) {
                svgFile.savedContent = latestSaved;
                svgViewer._recomputeDirtyCount();
              }
            }
          });
        }
      }
    });
  }

  /**
   * Handle `active-file-changed` bubbling up from either
   * viewer. When a viewer reports it has an active file,
   * that viewer becomes visible. When it reports null
   * (no files open), we keep the currently-visible viewer
   * as-is — flipping to the other one would just show
   * its empty state, which isn't what the user wants.
   *
   * Uses `event.composedPath()` to identify which viewer
   * emitted the event, so the handler is robust even if
   * additional viewers are added later.
   */
  _onActiveFileChanged(event) {
    const detail = event.detail || {};
    if (!detail.path) return;
    // Identify the source viewer by walking the composed
    // path — the event originates inside the viewer's
    // shadow root and bubbles up through the host element.
    const path = event.composedPath ? event.composedPath() : [];
    for (const el of path) {
      if (el && el.tagName === 'AC-SVG-VIEWER') {
        this._activeViewer = 'svg';
        return;
      }
      if (el && el.tagName === 'AC-DIFF-VIEWER') {
        this._activeViewer = 'diff';
        return;
      }
    }
  }

  // ---------------------------------------------------------------
  // Toast system
  // ---------------------------------------------------------------

  _onToastEvent(event) {
    const { message, type } = event.detail || {};
    if (!message) return;
    this._showToast(message, type || 'info');
  }

  _showToast(message, type = 'info') {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const toast = { id, message, type };
    this.toasts = [...this.toasts, toast];
    // Auto-dismiss after 3s, with a 300ms fade handled by CSS.
    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    }, 3000);
  }

  // ---------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------

  _switchTab(tab) {
    this.activeTab = tab;
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  render() {
    return html`
      <div class="viewer-background">
        <ac-diff-viewer
          class=${this._activeViewer === 'diff'
            ? 'viewer-visible'
            : 'viewer-hidden'}
          @active-file-changed=${this._onActiveFileChanged}
        ></ac-diff-viewer>
        <ac-svg-viewer
          class=${this._activeViewer === 'svg'
            ? 'viewer-visible'
            : 'viewer-hidden'}
          @active-file-changed=${this._onActiveFileChanged}
        ></ac-svg-viewer>
      </div>

      <div class="dialog">
        ${this.connectionState === 'disconnected' ? html`
          <div class="reconnect-banner">
            Reconnecting… (attempt ${this.reconnectAttempt})
          </div>
        ` : null}
        <div class="dialog-header">
          <button
            class="tab-button ${this.activeTab === 'files' ? 'active' : ''}"
            @click=${() => this._switchTab('files')}
          >🗨 Chat</button>
          <button
            class="tab-button ${this.activeTab === 'context' ? 'active' : ''}"
            @click=${() => this._switchTab('context')}
          >📊 Context</button>
          <button
            class="tab-button ${this.activeTab === 'settings' ? 'active' : ''}"
            @click=${() => this._switchTab('settings')}
          >⚙️ Settings</button>
        </div>
        <div class="dialog-body">
          ${this._renderTab()}
        </div>
      </div>

      ${this.overlayVisible ? html`
        <div class="startup-overlay ${this.startupPercent >= 100 ? 'fading' : ''}">
          <div class="startup-brand">
            <span>AC</span><span class="bolt">⚡</span><span>DC</span>
          </div>
          <div class="startup-message">${this.startupMessage}</div>
          <div class="startup-progress">
            <div
              class="startup-progress-bar"
              style="width: ${this.startupPercent}%"
            ></div>
          </div>
        </div>
      ` : null}

      <div class="toast-layer">
        ${this.toasts.map((toast) => html`
          <div class="toast ${toast.type}" data-toast-id=${toast.id}>
            ${toast.message}
          </div>
        `)}
      </div>
    `;
  }

  _renderTab() {
    // Phase 2c wires up the files tab. Context and settings
    // remain placeholders until Phase 3.
    if (this.activeTab === 'files') {
      return html`<ac-files-tab></ac-files-tab>`;
    }
    const labels = {
      context: 'Context',
      settings: 'Settings',
    };
    return html`
      <div class="tab-placeholder">
        ${labels[this.activeTab] || this.activeTab} tab — Phase 3 wires this up.
      </div>
    `;
  }
}

customElements.define('ac-app-shell', AppShell);