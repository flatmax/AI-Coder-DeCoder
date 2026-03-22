/**
 * Dialog component — draggable, resizable, collapsible container with tabs.
 *
 * Default: fixed left-docked, 50% viewport width, full height.
 */

import { LitElement, html, css } from 'lit';
import { theme, scrollbarStyles } from '../styles/theme.js';
import { RpcMixin, dispatchToast } from '../rpc-mixin.js';

// Import child components so custom elements are registered
import './ac-files-tab.js';

// Lazy-loaded tab imports
const lazyImports = {
  context: () => import('./ac-context-tab.js'),
  settings: () => import('./ac-settings-tab.js'),
  convert: () => import('./ac-doc-convert-tab.js'),
};

const TABS = [
  { id: 'files', icon: '🗨', label: 'Chat', shortcut: 'Alt+1' },
  { id: 'context', icon: '📊', label: 'Context', shortcut: 'Alt+2' },
  { id: 'settings', icon: '⚙️', label: 'Settings', shortcut: 'Alt+3' },
  { id: 'convert', icon: '📄', label: 'Doc Convert', shortcut: 'Alt+4', conditional: true, hidden: true },
];

export class AcDialog extends RpcMixin(LitElement) {
  static properties = {
    activeTab: { type: String, state: true },
    minimized: { type: Boolean, reflect: true },
    _historyPercent: { type: Number, state: true },
    _reviewActive: { type: Boolean, state: true },
    _mode: { type: String, state: true },
    _modeSwitching: { type: Boolean, state: true },
    _modeSwitchMessage: { type: String, state: true },
    _modeSwitchPercent: { type: Number, state: true },
    _docIndexReady: { type: Boolean, state: true },
    _docIndexBuilding: { type: Boolean, state: true },
    _crossRefReady: { type: Boolean, state: true },
    _crossRefEnabled: { type: Boolean, state: true },
    _enrichingDocs: { type: Boolean, state: true },
    _repoName: { type: String, state: true },
    _docConvertAvailable: { type: Boolean, state: true },
    _connectedClients: { type: Number, state: true },
    _collabPopoverOpen: { type: Boolean, state: true },
    _collabClients: { type: Array, state: true },
    _shareUrl: { type: String, state: true },
    _shareCopied: { type: Boolean, state: true },
    _collabDisabled: { type: Boolean, state: true },
    _committing: { type: Boolean, state: true },
    _streamingActive: { type: Boolean, state: true },
  };

  static styles = [theme, scrollbarStyles, css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--bg-secondary);
      border-right: 1px solid var(--border-primary);
      overflow: hidden;
      pointer-events: auto;
    }
    :host([minimized]) {
      height: auto;
    }

    /* Header bar */
    .header {
      display: flex;
      align-items: center;
      height: 40px;
      min-height: 40px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-primary);
      padding: 0 8px;
      cursor: grab;
      user-select: none;
    }
    .header:active {
      cursor: grabbing;
    }

    .header-label {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text-secondary);
      margin-right: 12px;
      white-space: nowrap;
      cursor: pointer;
    }

    .tab-buttons {
      display: flex;
      gap: 2px;
    }
    .git-actions {
      display: flex;
      gap: 2px;
      align-items: center;
      margin-left: auto;
      margin-right: auto;
    }

    .tab-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 1rem;
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .tab-btn:hover {
      background: var(--bg-secondary);
      color: var(--text-primary);
    }
    .tab-btn.active {
      background: var(--bg-primary);
      color: var(--accent-primary);
    }

    .header-actions {
      display: flex;
      gap: 2px;
      margin-left: auto;
      flex-shrink: 0;
      align-items: center;
    }

    .header-action {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 0.9rem;
      padding: 4px 6px;
      border-radius: var(--radius-sm);
      cursor: pointer;
    }
    .header-action:hover {
      background: var(--bg-secondary);
      color: var(--text-primary);
    }
    .header-action.review-active {
      color: var(--accent-primary);
    }
    .header-action.building {
      opacity: 0.6;
      animation: pulse-building 1.5s ease-in-out infinite;
      cursor: wait;
    }
    .header-action.committing {
      color: var(--accent-primary);
      animation: spin 1s linear infinite;
    }
    .header-action.danger:hover {
      color: var(--accent-red);
    }
    .header-action:disabled {
      pointer-events: none;
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .header-divider {
      width: 1px;
      height: 20px;
      background: var(--border-primary);
      opacity: 0.6;
      flex-shrink: 0;
    }
    @keyframes pulse-building {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 0.9; }
    }

    /* Header-inline progress bar (visible even when minimized) */
    .header-progress {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-right: 8px;
      flex-shrink: 10;
      min-width: 0;
      max-width: 240px;
      overflow: hidden;
    }
    .header-progress-label {
      font-size: 0.7rem;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 180px;
    }
    .header-progress-bar {
      width: 60px;
      min-width: 40px;
      height: 4px;
      background: var(--bg-secondary);
      border-radius: 2px;
      overflow: hidden;
    }
    .header-progress-fill {
      height: 100%;
      background: var(--accent-primary);
      border-radius: 2px;
      transition: width 0.4s ease;
    }

    /* Content area */
    .content {
      flex: 1;
      overflow: hidden;
      position: relative;
    }

    .content.minimized {
      display: none;
    }

    .tab-panel {
      position: absolute;
      inset: 0;
      overflow: hidden;
      display: none;
    }
    .tab-panel.active {
      display: flex;
      flex-direction: column;
    }
    .tab-panel > * {
      flex: 1;
      min-height: 0;
    }

    /* Placeholder for unimplemented tabs */
    .placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 0.9rem;
    }

    /* History bar */
    .history-bar {
      height: 3px;
      min-height: 3px;
      background: var(--bg-tertiary);
    }
    .history-bar-fill {
      height: 100%;
      transition: width 0.3s, background-color 0.3s;
    }
    .history-bar-fill.green { background: var(--accent-green); }
    .history-bar-fill.orange { background: var(--accent-orange); }
    .history-bar-fill.red { background: var(--accent-red); }

    /* Mode switch overlay */
    .mode-switch-overlay {
      position: absolute;
      inset: 0;
      z-index: 50;
      background: var(--bg-secondary);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      opacity: 0.95;
    }
    .mode-switch-overlay .mode-switch-msg {
      font-size: 0.85rem;
      color: var(--text-secondary);
    }
    .mode-switch-overlay .mode-switch-bar {
      width: 200px;
      height: 4px;
      background: var(--bg-tertiary);
      border-radius: 2px;
      overflow: hidden;
    }
    .mode-switch-overlay .mode-switch-fill {
      height: 100%;
      background: var(--accent-primary);
      border-radius: 2px;
      transition: width 0.4s ease;
    }

    /* Resize handle — right edge */
    .resize-handle {
      position: absolute;
      top: 0;
      right: -4px;
      width: 8px;
      height: 100%;
      cursor: col-resize;
      z-index: 10;
    }
    :host([minimized]) .resize-handle,
    :host([minimized]) .resize-handle-bottom,
    :host([minimized]) .resize-handle-corner {
      display: none;
    }
    .resize-handle:hover,
    .resize-handle:active {
      background: var(--accent-primary);
      opacity: 0.3;
    }

    /* Resize handle — bottom edge */
    .resize-handle-bottom {
      position: absolute;
      bottom: -4px;
      left: 0;
      width: 100%;
      height: 8px;
      cursor: row-resize;
      z-index: 10;
    }
    .resize-handle-bottom:hover,
    .resize-handle-bottom:active {
      background: var(--accent-primary);
      opacity: 0.3;
    }

    /* Resize handle — bottom-right corner */
    .resize-handle-corner {
      position: absolute;
      bottom: -4px;
      right: -4px;
      width: 14px;
      height: 14px;
      cursor: nwse-resize;
      z-index: 11;
    }
    .resize-handle-corner:hover,
    .resize-handle-corner:active {
      background: var(--accent-primary);
      opacity: 0.3;
      border-radius: 2px;
    }

    /* Collab popover */
    .collab-anchor {
      position: relative;
    }
    .collab-popover {
      position: absolute;
      top: 100%;
      left: 0;
      margin-top: 6px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      min-width: 260px;
      max-width: 340px;
      z-index: 200;
      padding: 12px;
      font-size: 0.82rem;
      color: var(--text-secondary);
    }
    .collab-popover-title {
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 8px;
      font-size: 0.85rem;
    }
    .collab-client-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .collab-client-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 6px;
      border-radius: var(--radius-sm);
      background: var(--bg-secondary);
    }
    .collab-client-role {
      font-size: 0.75rem;
      padding: 1px 6px;
      border-radius: var(--radius-sm);
      background: var(--bg-primary);
      color: var(--text-muted);
      white-space: nowrap;
    }
    .collab-client-role.host {
      color: var(--accent-green);
    }
    .collab-client-ip {
      font-family: var(--font-mono);
      font-size: 0.78rem;
      flex: 1;
    }
    .collab-client-local {
      font-size: 0.7rem;
      color: var(--text-muted);
    }
    .collab-divider {
      border: none;
      border-top: 1px solid var(--border-primary);
      margin: 10px 0;
    }
    .collab-share-section {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .collab-share-label {
      font-weight: 600;
      color: var(--text-primary);
      font-size: 0.82rem;
    }
    .collab-share-url {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .collab-share-url input {
      flex: 1;
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-family: var(--font-mono);
      font-size: 0.78rem;
      padding: 4px 8px;
      outline: none;
    }
    .collab-share-url input:focus {
      border-color: var(--accent-primary);
    }
    .collab-share-url button {
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-sm);
      color: var(--text-secondary);
      padding: 4px 10px;
      cursor: pointer;
      font-size: 0.78rem;
      white-space: nowrap;
    }
    .collab-share-url button:hover {
      background: var(--bg-primary);
      color: var(--text-primary);
    }
    .collab-share-url button.copied {
      color: var(--accent-green);
      border-color: var(--accent-green);
    }
    .collab-share-hint {
      font-size: 0.72rem;
      color: var(--text-muted);
      line-height: 1.4;
    }
    .collab-backdrop {
      position: fixed;
      inset: 0;
      z-index: 199;
    }
  `];

  constructor() {
    super();
    this.activeTab = 'files';
    this.minimized = this._loadBoolPref('ac-dc-minimized', false);
    this._historyPercent = 0;
    this._reviewActive = false;
    this._mode = 'code';
    this._modeSwitching = false;
    this._modeSwitchMessage = '';
    this._modeSwitchPercent = 0;
    this._docIndexReady = false;
    this._docIndexBuilding = false;
    this._crossRefReady = false;
    this._crossRefEnabled = false;
    this._enrichingDocs = false;
    this._repoName = null;
    this._docConvertAvailable = false;
    this._connectedClients = 1;
    this._collabPopoverOpen = false;
    this._collabClients = [];
    this._shareUrl = '';
    this._shareCopied = false;
    this._collabDisabled = false;
    this._visitedTabs = new Set(['files']);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._undocked = false;
    this._onClientEvent = this._onClientEvent.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this._onKeyDown);
    this._onStateLoaded = this._onStateLoaded.bind(this);
    window.addEventListener('state-loaded', this._onStateLoaded);
    window.addEventListener('collab-client-count', this._onClientEvent);
    // Restore dialog width if previously resized
    this._restoreDialogWidth();
    // Restore dialog position if previously undocked
    this._restoreDialogPosition();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('state-loaded', this._onStateLoaded);
    window.removeEventListener('collab-client-count', this._onClientEvent);
  }

  _onStateLoaded(e) {
    const state = e.detail;
    if (state?.repo_name && !this._repoName) {
      this._repoName = state.repo_name;
      // Migrate legacy bare key to repo-scoped key
      this._migrateModeKey();
    }
    // Sync cross-ref state from initial state load
    if (state) {
      if (typeof state.cross_ref_ready === 'boolean') this._crossRefReady = state.cross_ref_ready;
      if (typeof state.cross_ref_enabled === 'boolean') this._crossRefEnabled = state.cross_ref_enabled;
      if (typeof state.doc_convert_available === 'boolean') this._docConvertAvailable = state.doc_convert_available;
    }
  }

  _onClientEvent(e) {
    if (typeof e.detail?.count === 'number') {
      this._connectedClients = e.detail.count;
    }
  }

  async _toggleCollabPopover() {
    if (this._collabPopoverOpen) {
      this._collabPopoverOpen = false;
      return;
    }
    this._collabPopoverOpen = true;
    this._shareCopied = false;
    this._collabDisabled = false;
    // Fetch clients and share info in parallel
    try {
      const [clients, shareInfo] = await Promise.all([
        this.rpcExtract('Collab.get_connected_clients'),
        this.rpcExtract('Collab.get_share_info'),
      ]);
      if (Array.isArray(clients)) {
        this._collabClients = clients;
        this._connectedClients = clients.length;
      }
      if (shareInfo && shareInfo.port) {
        const ip = shareInfo.ips?.[0];
        if (ip) {
          // Build a share URL using the current page's URL structure
          // but replacing localhost with the LAN IP
          const currentUrl = new URL(window.location.href);
          currentUrl.hostname = ip;
          currentUrl.searchParams.set('port', String(shareInfo.port));
          this._shareUrl = currentUrl.toString();
        } else {
          this._shareUrl = '';
        }
      }
    } catch (e) {
      // If Collab class is not registered (single-user mode), RPC will fail
      this._collabDisabled = true;
      this._collabClients = [];
      this._shareUrl = '';
      console.debug('Collab not available (single-user mode):', e);
    }
  }

  _closeCollabPopover() {
    this._collabPopoverOpen = false;
  }

  _renderCollabPopover() {
    return html`
      <div class="collab-popover">
        ${this._collabDisabled ? html`
          <div class="collab-popover-title">Collaboration Disabled</div>
          <div style="color: var(--text-secondary); padding: 4px 0; line-height: 1.5;">
            Collaboration mode is not enabled. The server is listening on localhost only.
          </div>
          <div style="color: var(--text-muted); padding: 6px 0 2px; font-size: 0.78rem; line-height: 1.5;">
            To allow others on your network to connect, restart with:
          </div>
          <div style="background: var(--bg-primary); padding: 6px 10px; border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: 0.78rem; color: var(--accent-green); margin-top: 4px;">
            ac-dc --collab
          </div>
        ` : html`
          <div class="collab-popover-title">Connected Clients</div>
          ${this._collabClients.length > 0 ? html`
            <ul class="collab-client-list">
              ${this._collabClients.map(c => html`
                <li class="collab-client-item">
                  <span class="collab-client-role ${c.role === 'host' ? 'host' : ''}">${c.role}</span>
                  <span class="collab-client-ip">${c.ip}</span>
                  ${c.is_localhost ? html`<span class="collab-client-local">local</span>` : ''}
                </li>
              `)}
            </ul>
          ` : html`
            <div style="color: var(--text-muted); padding: 4px 0;">No clients connected</div>
          `}
          <hr class="collab-divider">
          <div class="collab-share-section">
            <div class="collab-share-label">Share Link</div>
            ${this._shareUrl ? html`
              <div class="collab-share-url">
                <input type="text" readonly .value=${this._shareUrl}
                  @click=${(e) => e.target.select()}>
                <button class="${this._shareCopied ? 'copied' : ''}"
                  @click=${() => this._copyShareUrl()}>
                  ${this._shareCopied ? '✓ Copied' : '📋 Copy'}
                </button>
              </div>
              <div class="collab-share-hint">
                Share this link with others on your network to collaborate.
              </div>
            ` : html`
              <div class="collab-share-hint">
                No routable network address detected.<br>
                Others can connect using ws://&lt;your-ip&gt;:${new URLSearchParams(window.location.search).get('port') || '18080'}
              </div>
            `}
          </div>
        `}
      </div>
    `;
  }

  async _copyShareUrl() {
    if (!this._shareUrl) return;
    try {
      await navigator.clipboard.writeText(this._shareUrl);
      this._shareCopied = true;
      setTimeout(() => { this._shareCopied = false; }, 2000);
    } catch (e) {
      // Fallback: select the input text
      const input = this.shadowRoot?.querySelector('.collab-share-url input');
      if (input) {
        input.select();
      }
    }
  }

  /**
   * Migrate legacy bare 'ac-dc-mode' key to repo-scoped key.
   * Only runs once when repo name first becomes available.
   */
  _migrateModeKey() {
    const repoKey = this._modeKey();
    const existing = this._loadPref(repoKey, null);
    if (existing) return; // already have a repo-scoped value
    const legacy = this._loadPref('ac-dc-mode', null);
    if (legacy) {
      this._savePref(repoKey, legacy);
    }
  }

  onRpcReady() {
    this._refreshHistoryBar();
    this._refreshReviewState();
    this._refreshMode();
    // Restore last-used tab now that RPC is connected and tabs can load data
    let savedTab = this._loadPref('ac-dc-active-tab', 'files');
    // Migrate stale tab preferences — search is now integrated into files,
    // cache is now a sub-view of context
    if (savedTab === 'search') savedTab = 'files';
    if (savedTab === 'cache') savedTab = 'context';
    if (savedTab !== this.activeTab) {
      this._switchTab(savedTab);
    }
    // Listen for events that should refresh the history bar and review state
    // (listeners added once; onRpcReady may fire on reconnect)
    if (!this._dialogEventsRegistered) {
      this._dialogEventsRegistered = true;
      window.addEventListener('stream-complete', () => { this._refreshHistoryBar(); this._refreshMode(); });
      window.addEventListener('compaction-event', () => this._refreshHistoryBar());
      window.addEventListener('state-loaded', () => { this._refreshHistoryBar(); this._refreshMode(); });
      window.addEventListener('mode-changed', () => this._refreshMode());
      window.addEventListener('session-loaded', () => this._refreshHistoryBar());
      window.addEventListener('review-started', () => { this._reviewActive = true; });
      window.addEventListener('review-ended', () => { this._reviewActive = false; });
      window.addEventListener('stream-chunk', () => { this._streamingActive = true; });
      window.addEventListener('stream-complete', () => { this._streamingActive = false; this._committing = false; });
      window.addEventListener('commit-result', () => { this._committing = false; });
      window.addEventListener('mode-switch-progress', (e) => {
        if (this._docIndexReady) return;
        const { message, percent } = e.detail || {};
        // Don't re-enable the overlay if percent indicates completion
        if (typeof percent === 'number' && percent >= 100) return;
        this._docIndexBuilding = true;
        this._modeSwitching = true;
        if (message !== undefined) this._modeSwitchMessage = message;
        if (typeof percent === 'number') this._modeSwitchPercent = percent;
      });
      window.addEventListener('compaction-event', (e) => {
        const data = e.detail?.event;
        if (!data) return;
        if (data.stage === 'doc_index_ready') {
          // Background doc index build complete — doc mode now available
          this._docIndexReady = true;
          this._docIndexBuilding = false;
          this._modeSwitching = false;
          this._modeSwitchMessage = '';
          this._modeSwitchPercent = 0;
          // In code mode, doc index ready means cross-ref is now available
          if (this._mode === 'code') {
            this._crossRefReady = true;
          }
          this.requestUpdate();
          // Also refresh from backend to ensure state is fully synced
          this._refreshMode();
          dispatchToast(data.message || '📝 Document index ready', 'info');
        } else if (data.stage === 'doc_index_failed') {
          this._docIndexBuilding = false;
          this._modeSwitching = false;
          this._modeSwitchMessage = '';
          this._modeSwitchPercent = 0;
          this.requestUpdate();
          dispatchToast(data.message || 'Document index build failed', 'error');
        } else if (data.stage === 'doc_index_progress') {
          if (this._docIndexReady) {
            // Enrichment phase — structural pass already done.
            // Show progress in the header bar (non-blocking indicator).
            // Set _enrichingDocs so the bar renders (needed after browser refresh
            // when doc_enrichment_queued was missed but progress events continue).
            this._enrichingDocs = true;
            if (data.message) this._modeSwitchMessage = data.message;
            if (typeof data.percent === 'number') this._modeSwitchPercent = data.percent;
            this._docIndexBuilding = false;  // not blocking — just enriching
            return;
          }
          // Structural extraction phase — show blocking overlay
          this._docIndexBuilding = true;
          this._modeSwitching = true;
          if (data.message) this._modeSwitchMessage = data.message;
          if (typeof data.percent === 'number') this._modeSwitchPercent = data.percent;
        } else if (data.stage === 'doc_enrichment_queued') {
          // Keyword enrichment starting in background
          this._enrichingDocs = true;
          this.requestUpdate();
        } else if (data.stage === 'doc_enrichment_file_done') {
          // One file enriched — update indicator
          this.requestUpdate();
        } else if (data.stage === 'doc_enrichment_complete') {
          this._enrichingDocs = false;
          this._modeSwitchMessage = '';
          this._modeSwitchPercent = 0;
          this.requestUpdate();
        }
      });
    }
  }

  async _refreshReviewState() {
    try {
      const state = await this.rpcExtract('LLMService.get_review_state');
      if (state) {
        this._reviewActive = !!state.active;
      }
    } catch (e) {
      // Ignore — RPC may not be ready
    }
  }

  // === Git action delegates ===

  _getFilesTab() {
    return this.shadowRoot?.querySelector('ac-files-tab');
  }

  _onCopyDiff() {
    this._getFilesTab()?.copyDiff();
  }

  _onCommit() {
    this._committing = true;
    this._getFilesTab()?.commitAll();
  }

  _onConfirmReset() {
    this._getFilesTab()?.confirmReset();
  }

  _onReviewClick() {
    // Switch to files tab first, then open the review selector
    this._switchTab('files');
    this.updateComplete.then(() => {
      const filesTab = this.shadowRoot?.querySelector('ac-files-tab');
      if (filesTab) {
        if (this._reviewActive) {
          filesTab._exitReview();
        } else {
          filesTab._openReviewSelector();
        }
      }
    });
  }

  /**
   * Return a repo-scoped localStorage key for mode persistence.
   * Falls back to a bare key if repo name is not yet known.
   */
  _modeKey() {
    return this._repoName ? `ac-dc-mode:${this._repoName}` : 'ac-dc-mode';
  }

  async _refreshMode() {
    // Don't refresh or auto-switch while a mode switch RPC is in flight —
    // the saved preference hasn't been updated yet, and _refreshMode would
    // read the stale pref and immediately switch back.
    if (this._modeSwitchInFlight) return;

    try {
      const result = await this.rpcExtract('LLMService.get_mode');
      if (this._modeSwitchInFlight) return;  // guard again after await
      if (result) {
        if (result.mode) this._mode = result.mode;
        this._docIndexReady = !!result.doc_index_ready;
        this._docIndexBuilding = !!result.doc_index_building;
        this._crossRefReady = !!result.cross_ref_ready;
        this._crossRefEnabled = !!result.cross_ref_enabled;
        // If backend says ready, clear any lingering switch overlay
        if (this._docIndexReady) {
          this._modeSwitching = false;
          this._modeSwitchMessage = '';
          this._modeSwitchPercent = 0;
          this._docIndexBuilding = false;
        }
        // Sync localStorage to match the server's authoritative mode.
        // This prevents non-localhost clients (who can't call switch_mode)
        // from fighting the server by reading a stale preference.
        if (result.mode) {
          this._savePref(this._modeKey(), result.mode);
        }
      }
    } catch (e) {
      // Ignore — RPC may not be ready
    }
    // Also restore persisted mode preference and sync if needed.
    // Only localhost clients should attempt to switch — non-localhost
    // clients just follow the server's mode (synced above).
    if (this._modeSwitchInFlight) return;
    if (this._canMutate === false) return;
    const saved = this._loadPref(this._modeKey(), null);
    if (saved && saved !== this._mode && this._docIndexReady) {
      await this._switchMode(saved);
    }
  }

  async _switchMode(mode) {
    if (mode === this._mode) return;
    if (this._modeSwitchInFlight) return;

    console.log('[ac-dialog] switching mode to', mode, 'from', this._mode);
    this._modeSwitchInFlight = true;
    try {
      const result = await this.rpcExtract('LLMService.switch_mode', mode);
      console.log('[ac-dialog] switch_mode result:', result);
      if (!result) return;

      if (result.building) {
        // Index still building — toast and stay in current mode
        dispatchToast('Document index is still building — please wait…', 'info');
        return;
      }

      if (result.error) {
        dispatchToast(result.error, 'error');
        return;
      }

      // Sync mode from backend (handles "already in this mode" case where
      // frontend and backend were out of sync)
      this._mode = result.mode || mode;
      this._crossRefEnabled = false;
      this._savePref(this._modeKey(), this._mode);
      window.dispatchEvent(new CustomEvent('mode-changed', {
        detail: { mode: this._mode },
      }));

      if (result.keywords_available === false) {
        dispatchToast(
          result.keywords_message ||
            'Keyword enrichment unavailable — headings shown without keywords. '
            + 'Install with: pip install keybert sentence-transformers',
          'warning',
        );
      }
    } catch (e) {
      dispatchToast(`Mode switch failed: ${e.message || e}`, 'error');
    } finally {
      this._modeSwitchInFlight = false;
    }
  }

  _onModeToggle() {
    const newMode = this._mode === 'code' ? 'doc' : 'code';
    this._switchMode(newMode);
  }

  async _onCrossRefToggle() {
    const newEnabled = !this._crossRefEnabled;
    try {
      const result = await this.rpcExtract('LLMService.set_cross_reference', newEnabled);
      if (!result) return;
      if (result.status === 'not_ready') {
        dispatchToast(result.message || 'Cross-reference index is not ready yet.', 'warning');
        return;
      }
      if (result.error) {
        dispatchToast(result.error, 'error');
        return;
      }
      this._crossRefEnabled = !!result.cross_ref_enabled;
      if (this._crossRefEnabled) {
        dispatchToast(
          result.message || 'Cross-reference enabled — additional tokens will be used.',
          'info',
        );
      } else {
        dispatchToast(
          result.message || 'Cross-reference disabled.',
          'info',
        );
      }
      // Notify tabs to refresh
      window.dispatchEvent(new CustomEvent('mode-changed', {
        detail: { mode: this._mode, crossRefEnabled: this._crossRefEnabled },
      }));
    } catch (e) {
      dispatchToast(`Cross-reference toggle failed: ${e.message || e}`, 'error');
    }
  }

  async _refreshHistoryBar() {
    try {
      const status = await this.rpcExtract('LLMService.get_history_status');
      if (status && typeof status.percent === 'number') {
        this._historyPercent = status.percent;
      }
    } catch (e) {
      // Ignore — RPC may not be ready
    }
  }

  _onKeyDown(e) {
    // Alt+1..4 tab switching
    if (e.altKey && e.key >= '1' && e.key <= '4') {
      e.preventDefault();
      const idx = parseInt(e.key) - 1;
      const tab = TABS[idx];
      if (tab && (!tab.conditional || this._docConvertAvailable)) {
        this._switchTab(tab.id);
      }
      return;
    }
    // Alt+M toggle minimize
    if (e.altKey && (e.key === 'm' || e.key === 'M')) {
      e.preventDefault();
      this._toggleMinimize();
      return;
    }
    // Ctrl+Shift+F → Activate file search in files tab
    if (e.ctrlKey && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      // Capture selection synchronously before focus change clears it
      const sel = window.getSelection()?.toString()?.trim() || '';
      this._switchTab('files');
      this.updateComplete.then(() => {
        const filesTab = this.shadowRoot?.querySelector('ac-files-tab');
        if (filesTab) {
          const chatPanel = filesTab.shadowRoot?.querySelector('ac-chat-panel');
          if (chatPanel) {
            chatPanel.activateFileSearch(sel && !sel.includes('\n') ? sel : '');
          }
        }
      });
      return;
    }
  }

  _switchTab(tabId) {
    this.activeTab = tabId;
    this._savePref('ac-dc-active-tab', tabId);
    this._visitedTabs.add(tabId);
    if (this.minimized) {
      this.minimized = false;
    }
    // Trigger lazy import for the tab (and capture the promise)
    const lazyReady = lazyImports[tabId] ? lazyImports[tabId]() : Promise.resolve();
    // Notify newly visible tab and handle focus
    this.updateComplete.then(async () => {
      const panel = this.shadowRoot?.querySelector(`.tab-panel.active`);
      if (panel) {
        const child = panel.firstElementChild;
        if (child && typeof child.onTabVisible === 'function') {
          child.onTabVisible();
        }
      }
    });
  }

  _toggleMinimize() {
    this.minimized = !this.minimized;
    this._saveBoolPref('ac-dc-minimized', this.minimized);
  }

  _getHistoryBarColor() {
    if (this._historyPercent > 90) return 'red';
    if (this._historyPercent > 75) return 'orange';
    return 'green';
  }

  // === Resize (right edge) ===

  _getContainer() {
    // <ac-dialog> sits inside <div class="dialog-container"> in app-shell's shadow DOM.
    // this.getRootNode() returns app-shell's shadow root (since ac-dialog is
    // a child element within that shadow root, not inside its own shadow root).
    // this.parentElement is the .dialog-container div.
    return this.parentElement;
  }

  _onResizeStart(e) {
    e.preventDefault();
    e.stopPropagation();
    this._isResizing = true;
    const container = this._getContainer();
    if (!container) return;

    const startX = e.clientX;
    const startWidth = container.offsetWidth;

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const newWidth = Math.max(300, startWidth + dx);
      container.style.width = `${newWidth}px`;
    };

    const onUp = () => {
      this._isResizing = false;
      this._savePref('ac-dc-dialog-width', String(container.offsetWidth));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // === Resize (bottom edge) ===

  _onResizeBottomStart(e) {
    e.preventDefault();
    e.stopPropagation();
    const container = this._getContainer();
    if (!container) return;

    if (!this._undocked) {
      this._undock(container);
    }

    const startY = e.clientY;
    const startHeight = container.offsetHeight;

    const onMove = (moveEvent) => {
      const dy = moveEvent.clientY - startY;
      const newHeight = Math.max(200, startHeight + dy);
      container.style.height = `${newHeight}px`;
    };

    const onUp = () => {
      this._persistPosition(container);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // === Resize (bottom-right corner) ===

  _onResizeCornerStart(e) {
    e.preventDefault();
    e.stopPropagation();
    const container = this._getContainer();
    if (!container) return;

    if (!this._undocked) {
      this._undock(container);
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = container.offsetWidth;
    const startHeight = container.offsetHeight;

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      container.style.width = `${Math.max(300, startWidth + dx)}px`;
      container.style.height = `${Math.max(200, startHeight + dy)}px`;
    };

    const onUp = () => {
      this._persistPosition(container);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // === Undock / persist helpers ===

  _undock(container) {
    const rect = container.getBoundingClientRect();
    this._undocked = true;
    container.style.position = 'fixed';
    container.style.top = `${rect.top}px`;
    container.style.left = `${rect.left}px`;
    container.style.width = `${rect.width}px`;
    container.style.height = `${rect.height}px`;
    container.style.right = 'auto';
    container.style.bottom = 'auto';
  }

  _persistPosition(container) {
    const r = container.getBoundingClientRect();
    this._savePref('ac-dc-dialog-pos', JSON.stringify({
      left: r.left, top: r.top, width: r.width, height: r.height,
    }));
  }

  // === Drag (header) ===

  _onHeaderMouseDown(e) {
    // Only handle left mouse button
    if (e.button !== 0) return;

    e.preventDefault();

    const container = this._getContainer();
    if (!container) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const rect = container.getBoundingClientRect();
    const startLeft = rect.left;
    const startTop = rect.top;
    const startWidth = rect.width;
    const startHeight = rect.height;
    let thresholdMet = false;

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      if (!thresholdMet) {
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        thresholdMet = true;

        // Undock: switch to explicit position so we can move freely
        if (!this._undocked) {
          this._undock(container);
        }
      }

      const newLeft = Math.max(0, startLeft + dx);
      const newTop = Math.max(0, startTop + dy);
      container.style.left = `${newLeft}px`;
      container.style.top = `${newTop}px`;
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);

      if (!thresholdMet) {
        // Click (under 5px threshold) → toggle minimize
        this._toggleMinimize();
      } else if (this._undocked) {
        this._persistPosition(container);
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // === Persistence Helpers ===

  _savePref(key, value) {
    try { localStorage.setItem(key, value); } catch {}
  }

  _loadPref(key, defaultVal) {
    try {
      const v = localStorage.getItem(key);
      return v !== null ? v : defaultVal;
    } catch { return defaultVal; }
  }

  _saveBoolPref(key, value) {
    this._savePref(key, String(value));
  }

  _loadBoolPref(key, defaultVal) {
    try {
      const v = localStorage.getItem(key);
      if (v === null) return defaultVal;
      return v === 'true';
    } catch { return defaultVal; }
  }

  _restoreDialogWidth() {
    const saved = this._loadPref('ac-dc-dialog-width', null);
    if (!saved) return;
    const width = parseInt(saved);
    if (isNaN(width) || width < 300) return;
    const container = this._getContainer();
    if (container) {
      container.style.width = `${Math.min(width, window.innerWidth - 50)}px`;
    }
  }

  _restoreDialogPosition() {
    const saved = this._loadPref('ac-dc-dialog-pos', null);
    if (!saved) return;
    try {
      const pos = JSON.parse(saved);
      if (!pos || typeof pos.left !== 'number') return;

      // Bounds-check: ensure at least 100px visible on screen
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(pos.width || 400, vw - 20);
      const height = Math.min(pos.height || vh, vh - 20);
      const left = Math.max(0, Math.min(pos.left, vw - 100));
      const top = Math.max(0, Math.min(pos.top, vh - 100));

      const container = this._getContainer();
      if (!container) return;

      this._undocked = true;
      container.style.position = 'fixed';
      container.style.left = `${left}px`;
      container.style.top = `${top}px`;
      container.style.width = `${width}px`;
      container.style.height = `${height}px`;
      container.style.right = 'auto';
      container.style.bottom = 'auto';
    } catch {}
  }

  render() {
    const currentTab = TABS.find(t => t.id === this.activeTab);

    return html`
      <div class="header" @mousedown=${this._onHeaderMouseDown}>
        <span class="header-label">${currentTab?.label || 'Files'}</span>

        <div class="tab-buttons" role="tablist" aria-label="Tool tabs">
          ${TABS.filter(tab => !tab.hidden && (!tab.conditional || this._docConvertAvailable)).map(tab => html`
            <button
              class="tab-btn ${tab.id === this.activeTab ? 'active' : ''}"
              role="tab"
              aria-selected="${tab.id === this.activeTab}"
              aria-controls="panel-${tab.id}"
              id="tab-${tab.id}"
              title="${tab.label} (${tab.shortcut})"
              @mousedown=${(e) => e.stopPropagation()}
              @click=${(e) => { e.stopPropagation(); this._switchTab(tab.id); }}
            >${tab.icon}</button>
          `)}
        </div>

        <div class="git-actions">
          <div class="collab-anchor">
            <button class="header-action" style="font-size: 0.8rem;"
              title="Collaboration — ${this._connectedClients} connected"
              @mousedown=${(e) => e.stopPropagation()}
              @click=${() => this._toggleCollabPopover()}>
              👥${this._connectedClients > 1 ? html` ${this._connectedClients}` : ''}
            </button>
            ${this._collabPopoverOpen ? html`
              <div class="collab-backdrop" @click=${() => this._closeCollabPopover()}></div>
              ${this._renderCollabPopover()}
            ` : ''}
          </div>
          <div class="header-divider"></div>
          <button class="header-action" title="Copy diff (staged)" aria-label="Copy diff to clipboard"
            @mousedown=${(e) => e.stopPropagation()}
            @click=${() => this._onCopyDiff()}
            ?disabled=${!this.rpcConnected}>📋</button>
          ${this._canMutate ? html`
            <button class="header-action ${this._committing ? 'committing' : ''}"
              title="${this._reviewActive ? 'Commit disabled during review' : 'Stage all & commit'}"
              aria-label="${this._reviewActive ? 'Commit disabled during review' : 'Stage all and commit'}"
              @mousedown=${(e) => e.stopPropagation()}
              @click=${() => this._onCommit()}
              ?disabled=${!this.rpcConnected || this._committing || this._streamingActive || this._reviewActive}>
              ${this._committing ? '⏳' : '💾'}
            </button>
            <button class="header-action danger" title="Reset to HEAD" aria-label="Reset all changes to HEAD"
              @mousedown=${(e) => e.stopPropagation()}
              @click=${() => this._onConfirmReset()}
              ?disabled=${!this.rpcConnected || this._streamingActive}>⚠️</button>
          ` : ''}
          <div class="header-divider"></div>
          <button class="header-action ${this._reviewActive ? 'review-active' : ''}"
            title="${this._reviewActive ? 'Exit Review' : 'Code Review'}"
            aria-label="${this._reviewActive ? 'Exit code review' : 'Start code review'}"
            ?disabled=${!this._canMutate}
            @mousedown=${(e) => e.stopPropagation()}
            @click=${() => this._onReviewClick()}>
            👁️
          </button>
        </div>

        ${this._modeSwitching && !this._docIndexReady ? html`
          <div class="header-progress">
            <span class="header-progress-label">${this._modeSwitchMessage || 'Building…'}</span>
            <div class="header-progress-bar">
              <div class="header-progress-fill" style="width: ${this._modeSwitchPercent}%"></div>
            </div>
          </div>
        ` : this._enrichingDocs && this._modeSwitchMessage ? html`
          <div class="header-progress">
            <span class="header-progress-label">${this._modeSwitchMessage}</span>
            <div class="header-progress-bar">
              <div class="header-progress-fill" style="width: ${this._modeSwitchPercent}%"></div>
            </div>
          </div>
        ` : ''}

        <div class="header-actions">
          <label class="header-action" style="display: flex; align-items: center; gap: 3px; font-size: 0.72rem; cursor: ${this._canMutate ? 'pointer' : 'not-allowed'}; opacity: ${this._canMutate ? 1 : 0.5};"
            title="${this._crossRefEnabled ? 'Disable cross-reference index' : 'Enable cross-reference index'}"
            @mousedown=${(e) => e.stopPropagation()}>
            <input type="checkbox"
              .checked=${this._crossRefEnabled}
              ?disabled=${!this._canMutate}
              @change=${() => this._onCrossRefToggle()}
              style="margin: 0; cursor: ${this._canMutate ? 'pointer' : 'not-allowed'};">
            <span style="color: var(--text-muted); white-space: nowrap;">
              ${this._mode === 'code' ? '+doc' : '+code'}
            </span>
          </label>
          <button class="header-action ${this._mode === 'doc' ? 'review-active' : ''} ${this._docIndexBuilding ? 'building' : ''}"
            title="${this._docIndexBuilding
              ? 'Document index building…'
              : this._mode === 'doc'
                ? 'Switch to Code mode'
                : 'Switch to Document mode'}"
            aria-label="${this._mode === 'code' ? 'Switch to document mode' : 'Switch to code mode'}"
            ?disabled=${this._docIndexBuilding || !this._canMutate}
            @mousedown=${(e) => e.stopPropagation()}
            @click=${() => this._onModeToggle()}>
            ${this._docIndexBuilding ? '⏳' : this._mode === 'doc' ? '📝' : '💻'}
          </button>
          ${this._docConvertAvailable ? html`
            <button class="header-action ${this.activeTab === 'convert' ? 'review-active' : ''}"
              title="Doc Convert (Alt+4)"
              aria-label="Document conversion"
              @mousedown=${(e) => e.stopPropagation()}
              @click=${() => this._switchTab('convert')}>
              📄
            </button>
          ` : ''}
          <button class="header-action" title="Minimize (Alt+M)"
            aria-label="${this.minimized ? 'Expand panel' : 'Minimize panel'}"
            aria-expanded="${!this.minimized}"
            @mousedown=${(e) => e.stopPropagation()}
            @click=${this._toggleMinimize}>
            ${this.minimized ? '▲' : '▼'}
          </button>
        </div>
      </div>

      <div class="content ${this.minimized ? 'minimized' : ''}">
        <!-- Files tab (always rendered) -->
        <div class="tab-panel ${this.activeTab === 'files' ? 'active' : ''}"
             role="tabpanel" id="panel-files" aria-labelledby="tab-files">
          <ac-files-tab></ac-files-tab>
        </div>

        <!-- Lazy-loaded tabs — only render once visited -->
        ${this._visitedTabs.has('context') ? html`
          <div class="tab-panel ${this.activeTab === 'context' ? 'active' : ''}"
               role="tabpanel" id="panel-context" aria-labelledby="tab-context">
            <ac-context-tab></ac-context-tab>
          </div>
        ` : ''}

        ${this._visitedTabs.has('settings') ? html`
          <div class="tab-panel ${this.activeTab === 'settings' ? 'active' : ''}"
               role="tabpanel" id="panel-settings" aria-labelledby="tab-settings">
            <ac-settings-tab></ac-settings-tab>
          </div>
        ` : ''}

        ${this._visitedTabs.has('convert') || this.activeTab === 'convert' ? html`
          <div class="tab-panel ${this.activeTab === 'convert' ? 'active' : ''}"
               role="tabpanel" id="panel-convert" aria-labelledby="tab-convert">
            <ac-doc-convert-tab></ac-doc-convert-tab>
          </div>
        ` : ''}
      </div>

      <div class="history-bar">
        <div
          class="history-bar-fill ${this._getHistoryBarColor()}"
          style="width: ${this._historyPercent}%"
        ></div>
      </div>

      <div class="resize-handle" @mousedown=${this._onResizeStart}></div>
      <div class="resize-handle-bottom" @mousedown=${this._onResizeBottomStart}></div>
      <div class="resize-handle-corner" @mousedown=${this._onResizeCornerStart}></div>
    `;
  }
}

customElements.define('ac-dialog', AcDialog);
