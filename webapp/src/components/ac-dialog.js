/**
 * AcDialog — floating tabbed dialog hosting all tool panels.
 *
 * Default: left-docked, 50% viewport width, full height.
 * Supports dragging, resizing (right/bottom/corner), minimizing.
 * Tabs are lazy-loaded on first visit and preserved in DOM.
 */

import { LitElement, html, css } from 'lit';
import { RpcMixin } from '../utils/rpc-mixin.js';
import { loadBool, saveBool } from '../utils/helpers.js';

const TABS = [
  { id: 'files', icon: '📁', label: 'FILES', shortcut: 'Alt+1' },
  { id: 'search', icon: '🔍', label: 'SEARCH', shortcut: 'Alt+2' },
  { id: 'context', icon: '📊', label: 'CONTEXT', shortcut: 'Alt+3' },
  { id: 'cache', icon: '🗄️', label: 'CACHE', shortcut: 'Alt+4' },
  { id: 'settings', icon: '⚙️', label: 'SETTINGS', shortcut: 'Alt+5' },
];

// Lazy imports for non-default tabs.
// The 'files' tab is eagerly imported in app-shell.js (always rendered).
const lazyImports = {
  search: () => import('./ac-search-tab.js'),
  context: () => import('./ac-context-tab.js'),
  cache: () => import('./ac-cache-tab.js'),
  settings: () => import('./ac-settings-tab.js'),
};

export class AcDialog extends RpcMixin(LitElement) {
  static properties = {
    _activeTab: { type: String, state: true },
    _minimized: { type: Boolean, state: true },
    _undocked: { type: Boolean, state: true },
    _width: { type: Number, state: true },
    _pos: { type: Object, state: true },
    _visitedTabs: { type: Object, state: true },
    _historyPercent: { type: Number, state: true },
    _reviewActive: { type: Boolean, state: true },
    _crossRefEnabled: { type: Boolean, state: true },
  };

  static styles = css`
    :host {
      display: block;
      position: fixed;
      z-index: 100;
    }

    .dialog {
      display: flex;
      flex-direction: column;
      background: var(--bg-secondary);
      border-right: 1px solid var(--border-primary);
      height: 100%;
      overflow: hidden;
    }

    .dialog.minimized {
      height: 48px;
      overflow: hidden;
    }

    /* Header */
    .header {
      display: flex;
      align-items: center;
      height: 40px;
      min-height: 40px;
      padding: 0 8px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-primary);
      cursor: pointer;
      user-select: none;
      gap: 4px;
    }

    .header-label {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--accent-primary);
      margin-right: 8px;
      white-space: nowrap;
    }

    .tab-icons {
      display: flex;
      gap: 2px;
      flex: 1;
      justify-content: center;
    }

    .tab-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 1rem;
      padding: 4px 6px;
      border-radius: 4px;
      color: var(--text-secondary);
      transition: background 0.15s;
    }
    .tab-btn:hover { background: var(--bg-primary); }
    .tab-btn.active {
      background: var(--bg-primary);
      color: var(--accent-primary);
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .minimize-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-secondary);
      font-size: 0.9rem;
      padding: 4px 6px;
      border-radius: 4px;
    }
    .minimize-btn:hover { background: var(--bg-primary); color: var(--text-primary); }

    /* Content area */
    .content {
      flex: 1;
      overflow: hidden;
      position: relative;
    }

    .tab-panel {
      display: none;
      position: absolute;
      inset: 0;
      overflow: hidden;
    }
    .tab-panel.active {
      display: flex;
      flex-direction: column;
    }

    /* History bar */
    .history-bar {
      height: 3px;
      min-height: 3px;
      background: var(--bg-primary);
    }
    .history-bar-fill {
      height: 100%;
      transition: width 0.3s, background-color 0.3s;
      border-radius: 0 1px 1px 0;
    }
    .history-bar-fill.green { background: var(--accent-green); }
    .history-bar-fill.orange { background: var(--accent-orange); }
    .history-bar-fill.red { background: var(--accent-red); }

    /* Resize handles */
    .resize-right {
      position: absolute;
      top: 0;
      right: -4px;
      width: 8px;
      height: 100%;
      cursor: ew-resize;
      z-index: 10;
    }
    .resize-right:hover { background: var(--accent-primary); opacity: 0.3; }

    .resize-bottom {
      position: absolute;
      bottom: -4px;
      left: 0;
      width: 100%;
      height: 8px;
      cursor: ns-resize;
      z-index: 10;
    }
    .resize-bottom:hover { background: var(--accent-primary); opacity: 0.3; }

    .resize-corner {
      position: absolute;
      bottom: -4px;
      right: -4px;
      width: 14px;
      height: 14px;
      cursor: nwse-resize;
      z-index: 11;
    }
    .resize-corner:hover { background: var(--accent-primary); opacity: 0.3; border-radius: 2px; }
  `;

  constructor() {
    super();
    this._activeTab = 'files';
    this._minimized = loadBool('ac-dc-minimized', false);
    this._undocked = false;
    this._width = parseInt(localStorage.getItem('ac-dc-dialog-width') || '0', 10) || 0;
    this._pos = null;
    this._visitedTabs = new Set(['files']);
    this._historyPercent = 0;
    this._reviewActive = false;
    this._crossRefEnabled = false;

    // Restore undocked position
    try {
      const saved = localStorage.getItem('ac-dc-dialog-pos');
      if (saved) {
        this._pos = JSON.parse(saved);
        this._undocked = true;
      }
    } catch (_) {}

    // Drag/resize state
    this._dragState = null;
  }

  connectedCallback() {
    super.connectedCallback();

    // Keyboard shortcuts
    this._keyHandler = this._onKeyDown.bind(this);
    document.addEventListener('keydown', this._keyHandler);

    // Window events
    this._stateLoadedHandler = this._onStateLoaded.bind(this);
    window.addEventListener('state-loaded', this._stateLoadedHandler);
    this._streamCompleteHandler = this._onStreamComplete.bind(this);
    window.addEventListener('stream-complete', this._streamCompleteHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this._keyHandler);
    window.removeEventListener('state-loaded', this._stateLoadedHandler);
    window.removeEventListener('stream-complete', this._streamCompleteHandler);
  }

  onRpcReady() {
    // Restore last active tab
    const savedTab = localStorage.getItem('ac-dc-active-tab');
    if (savedTab && TABS.some(t => t.id === savedTab)) {
      this._switchTab(savedTab);
    }
    this._refreshHistoryBar();
  }

  // ── Tab switching ────────────────────────────────────────────

  _switchTab(tabId) {
    if (tabId === this._activeTab) return;

    // Lazy load if needed
    if (lazyImports[tabId] && !this._visitedTabs.has(tabId)) {
      lazyImports[tabId]().catch(e => console.warn(`Failed to load ${tabId} tab:`, e));
    }

    this._visitedTabs = new Set([...this._visitedTabs, tabId]);
    this._activeTab = tabId;
    localStorage.setItem('ac-dc-active-tab', tabId);

    // Notify the tab it's now visible
    this.updateComplete.then(() => {
      const panel = this.shadowRoot.querySelector(`.tab-panel[data-tab="${tabId}"]`);
      if (panel) {
        const child = panel.firstElementChild;
        if (child && typeof child.onTabVisible === 'function') {
          child.onTabVisible();
        }
      }
    });
  }

  // ── Minimize ─────────────────────────────────────────────────

  _toggleMinimize() {
    this._minimized = !this._minimized;
    saveBool('ac-dc-minimized', this._minimized);
  }

  // ── Drag ─────────────────────────────────────────────────────

  _onHeaderPointerDown(e) {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;

    const onMove = (me) => {
      const dx = me.clientX - startX;
      const dy = me.clientY - startY;
      if (!moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      moved = true;

      if (!this._undocked) {
        // Undock on first drag
        const rect = this.getBoundingClientRect();
        this._pos = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        this._undocked = true;
      }

      this._pos = {
        ...this._pos,
        left: this._pos.left + (me.clientX - (this._dragState?.lastX || startX)),
        top: this._pos.top + (me.clientY - (this._dragState?.lastY || startY)),
      };
      this._dragState = { lastX: me.clientX, lastY: me.clientY };
      this._applyPosition();
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      this._dragState = null;
      if (!moved) {
        this._toggleMinimize();
      } else {
        this._savePosition();
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  // ── Resize ───────────────────────────────────────────────────

  _onResizePointerDown(e, direction) {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const startRect = this.getBoundingClientRect();

    if (!this._undocked && (direction === 'bottom' || direction === 'corner')) {
      this._pos = { left: startRect.left, top: startRect.top, width: startRect.width, height: startRect.height };
      this._undocked = true;
    }

    const onMove = (me) => {
      const dx = me.clientX - startX;
      const dy = me.clientY - startY;

      if (direction === 'right' || direction === 'corner') {
        const newW = Math.max(300, startRect.width + dx);
        if (this._undocked) {
          this._pos = { ...this._pos, width: newW };
        } else {
          this._width = newW;
          localStorage.setItem('ac-dc-dialog-width', String(newW));
        }
      }

      if (direction === 'bottom' || direction === 'corner') {
        const newH = Math.max(200, startRect.height + dy);
        this._pos = { ...this._pos, height: newH };
      }

      this._applyPosition();
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      this._savePosition();
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  _applyPosition() {
    if (this._undocked && this._pos) {
      this.style.left = `${this._pos.left}px`;
      this.style.top = `${this._pos.top}px`;
      this.style.width = `${this._pos.width}px`;
      this.style.height = `${this._pos.height}px`;
      this.style.right = 'auto';
      this.style.bottom = 'auto';
    }
    this.requestUpdate();
  }

  _savePosition() {
    if (this._undocked && this._pos) {
      localStorage.setItem('ac-dc-dialog-pos', JSON.stringify(this._pos));
    }
  }

  // ── History bar ──────────────────────────────────────────────

  async _refreshHistoryBar() {
    if (!this.rpcConnected) return;
    try {
      const raw = await this.rpcExtract('LLMService.get_history_status');
      if (raw && typeof raw.percent === 'number') {
        this._historyPercent = raw.percent;
      }
    } catch (_) {}
  }

  _historyBarColor() {
    if (this._historyPercent > 90) return 'red';
    if (this._historyPercent > 75) return 'orange';
    return 'green';
  }

  // ── Keyboard shortcuts ───────────────────────────────────────

  _onKeyDown(e) {
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= TABS.length) {
        e.preventDefault();
        this._switchTab(TABS[n - 1].id);
        if (this._minimized) this._toggleMinimize();
        return;
      }
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        this._toggleMinimize();
        return;
      }
    }
    if (e.ctrlKey && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      this._switchTab('search');
      if (this._minimized) this._toggleMinimize();
    }
  }

  // ── Event handlers ───────────────────────────────────────────

  _onStateLoaded(e) {
    this._refreshHistoryBar();
  }

  _onStreamComplete(e) {
    this._refreshHistoryBar();
  }

  // ── Render ───────────────────────────────────────────────────

  _getHostStyles() {
    if (this._undocked && this._pos) {
      return ''; // Applied via _applyPosition
    }
    const w = this._width || (window.innerWidth * 0.5);
    return `left: 0; top: 0; width: ${Math.max(400, w)}px; height: 100vh;`;
  }

  firstUpdated() {
    // Apply initial positioning
    if (!this._undocked) {
      const w = this._width || (window.innerWidth * 0.5);
      this.style.left = '0';
      this.style.top = '0';
      this.style.width = `${Math.max(400, w)}px`;
      this.style.height = '100vh';
    } else if (this._pos) {
      this._applyPosition();
    }
  }

  render() {
    const activeLabel = TABS.find(t => t.id === this._activeTab)?.label || '';

    return html`
      <div class="dialog ${this._minimized ? 'minimized' : ''}">
        <!-- Header -->
        <div class="header" @pointerdown=${this._onHeaderPointerDown}>
          <span class="header-label">${activeLabel}</span>
          <div class="tab-icons">
            ${TABS.map(t => html`
              <button class="tab-btn ${t.id === this._activeTab ? 'active' : ''}"
                      title="${t.label} (${t.shortcut})"
                      @click=${(e) => { e.stopPropagation(); this._switchTab(t.id); }}>
                ${t.icon}
              </button>
            `)}
          </div>
          <div class="header-actions">
            <button class="minimize-btn"
                    title="Minimize (Alt+M)"
                    @click=${(e) => { e.stopPropagation(); this._toggleMinimize(); }}>
              ${this._minimized ? '▲' : '▼'}
            </button>
          </div>
        </div>

        <!-- Content area -->
        ${!this._minimized ? html`
          <div class="content">
            ${TABS.map(t => this._visitedTabs.has(t.id) ? html`
              <div class="tab-panel ${t.id === this._activeTab ? 'active' : ''}"
                   data-tab="${t.id}">
                ${this._renderTab(t.id)}
              </div>
            ` : '')}
          </div>

          <!-- History bar -->
          <div class="history-bar">
            <div class="history-bar-fill ${this._historyBarColor()}"
                 style="width: ${Math.min(100, this._historyPercent)}%"></div>
          </div>
        ` : ''}
      </div>

      <!-- Resize handles (hidden when minimized) -->
      ${!this._minimized ? html`
        <div class="resize-right"
             @pointerdown=${(e) => this._onResizePointerDown(e, 'right')}></div>
        <div class="resize-bottom"
             @pointerdown=${(e) => this._onResizePointerDown(e, 'bottom')}></div>
        <div class="resize-corner"
             @pointerdown=${(e) => this._onResizePointerDown(e, 'corner')}></div>
      ` : ''}
    `;
  }

  _renderTab(tabId) {
    switch (tabId) {
      case 'files':
        return html`<ac-files-tab></ac-files-tab>`;
      case 'search':
        return html`<ac-search-tab></ac-search-tab>`;
      case 'context':
        return html`<ac-context-tab></ac-context-tab>`;
      case 'cache':
        return html`<ac-cache-tab></ac-cache-tab>`;
      case 'settings':
        return html`<ac-settings-tab></ac-settings-tab>`;
      default:
        return html`<div>Unknown tab: ${tabId}</div>`;
    }
  }
}

customElements.define('ac-dialog', AcDialog);