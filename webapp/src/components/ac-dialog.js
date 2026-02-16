/**
 * Dialog component — draggable, resizable, collapsible container with tabs.
 *
 * Default: fixed left-docked, 50% viewport width, full height.
 */

import { LitElement, html, css } from 'lit';
import { theme, scrollbarStyles } from '../styles/theme.js';
import { RpcMixin } from '../rpc-mixin.js';

// Import child components so custom elements are registered
import './ac-files-tab.js';

// Lazy-loaded tab imports
const lazyImports = {
  search: () => import('./ac-search-tab.js'),
  context: () => import('./ac-context-tab.js'),
  cache: () => import('./ac-cache-tab.js'),
  settings: () => import('./ac-settings-tab.js'),
};

const TABS = [
  { id: 'files', icon: '📁', label: 'Files', shortcut: 'Alt+1' },
  { id: 'search', icon: '🔍', label: 'Search', shortcut: 'Alt+2' },
  { id: 'context', icon: '📊', label: 'Context', shortcut: 'Alt+3' },
  { id: 'cache', icon: '🗄️', label: 'Cache', shortcut: 'Alt+4' },
  { id: 'settings', icon: '⚙️', label: 'Settings', shortcut: 'Alt+5' },
];

export class AcDialog extends RpcMixin(LitElement) {
  static properties = {
    activeTab: { type: String, state: true },
    minimized: { type: Boolean, reflect: true },
    _historyPercent: { type: Number, state: true },
    _reviewActive: { type: Boolean, state: true },
  };

  static styles = [theme, scrollbarStyles, css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--bg-secondary);
      border-right: 1px solid var(--border-primary);
      overflow: hidden;
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
      flex: 1;
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
      gap: 4px;
      margin-left: auto;
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
  `];

  constructor() {
    super();
    this.activeTab = 'files';
    this.minimized = this._loadBoolPref('ac-dc-minimized', false);
    this._historyPercent = 0;
    this._reviewActive = false;
    this._visitedTabs = new Set(['files']);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._undocked = false;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this._onKeyDown);
    // Restore dialog width if previously resized
    this._restoreDialogWidth();
    // Restore dialog position if previously undocked
    this._restoreDialogPosition();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._onKeyDown);
  }

  onRpcReady() {
    this._refreshHistoryBar();
    this._refreshReviewState();
    // Restore last-used tab now that RPC is connected and tabs can load data
    const savedTab = this._loadPref('ac-dc-active-tab', 'files');
    if (savedTab !== this.activeTab) {
      this._switchTab(savedTab);
    }
    // Listen for events that should refresh the history bar and review state
    // (listeners added once; onRpcReady may fire on reconnect)
    if (!this._dialogEventsRegistered) {
      this._dialogEventsRegistered = true;
      window.addEventListener('stream-complete', () => this._refreshHistoryBar());
      window.addEventListener('compaction-event', () => this._refreshHistoryBar());
      window.addEventListener('state-loaded', () => this._refreshHistoryBar());
      window.addEventListener('review-started', () => { this._reviewActive = true; });
      window.addEventListener('review-ended', () => { this._reviewActive = false; });
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
    // Alt+1..5 tab switching
    if (e.altKey && e.key >= '1' && e.key <= '5') {
      e.preventDefault();
      const idx = parseInt(e.key) - 1;
      if (TABS[idx]) {
        this._switchTab(TABS[idx].id);
      }
      return;
    }
    // Alt+M toggle minimize
    if (e.altKey && (e.key === 'm' || e.key === 'M')) {
      e.preventDefault();
      this._toggleMinimize();
      return;
    }
    // Ctrl+Shift+F → Search tab with selection/clipboard prefill
    if (e.ctrlKey && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      // Capture selection synchronously before focus change clears it
      const sel = window.getSelection()?.toString()?.trim() || '';
      this._switchTab('search');
      if (sel && !sel.includes('\n')) {
        this.updateComplete.then(() => {
          const searchTab = this.shadowRoot?.querySelector('ac-search-tab');
          if (searchTab) searchTab.prefill(sel);
        });
      }
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
    // Trigger lazy import for the tab
    if (lazyImports[tabId]) {
      lazyImports[tabId]();
    }
    // Notify newly visible tab and handle focus
    this.updateComplete.then(() => {
      const panel = this.shadowRoot?.querySelector(`.tab-panel.active`);
      if (panel) {
        const child = panel.firstElementChild;
        if (child && typeof child.onTabVisible === 'function') {
          child.onTabVisible();
        }
      }
      if (tabId === 'search') {
        const searchTab = this.shadowRoot?.querySelector('ac-search-tab');
        if (searchTab) searchTab.focus();
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
          ${TABS.map(tab => html`
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

        <div class="header-actions">
          <button class="header-action ${this._reviewActive ? 'review-active' : ''}"
            title="${this._reviewActive ? 'Exit Review' : 'Code Review'}"
            aria-label="${this._reviewActive ? 'Exit code review' : 'Start code review'}"
            @mousedown=${(e) => e.stopPropagation()}
            @click=${() => this._onReviewClick()}>
            👁️
          </button>
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
        ${this._visitedTabs.has('search') ? html`
          <div class="tab-panel ${this.activeTab === 'search' ? 'active' : ''}"
               role="tabpanel" id="panel-search" aria-labelledby="tab-search">
            <ac-search-tab></ac-search-tab>
          </div>
        ` : ''}

        ${this._visitedTabs.has('context') ? html`
          <div class="tab-panel ${this.activeTab === 'context' ? 'active' : ''}"
               role="tabpanel" id="panel-context" aria-labelledby="tab-context">
            <ac-context-tab></ac-context-tab>
          </div>
        ` : ''}

        ${this._visitedTabs.has('cache') ? html`
          <div class="tab-panel ${this.activeTab === 'cache' ? 'active' : ''}"
               role="tabpanel" id="panel-cache" aria-labelledby="tab-cache">
            <ac-cache-tab></ac-cache-tab>
          </div>
        ` : ''}

        ${this._visitedTabs.has('settings') ? html`
          <div class="tab-panel ${this.activeTab === 'settings' ? 'active' : ''}"
               role="tabpanel" id="panel-settings" aria-labelledby="tab-settings">
            <ac-settings-tab></ac-settings-tab>
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