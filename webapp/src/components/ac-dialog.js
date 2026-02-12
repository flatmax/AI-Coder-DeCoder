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
    minimized: { type: Boolean, state: true },
    _historyPercent: { type: Number, state: true },
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

    /* Header bar */
    .header {
      display: flex;
      align-items: center;
      height: 40px;
      min-height: 40px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-primary);
      padding: 0 8px;
      cursor: default;
      user-select: none;
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

    /* Resize handle */
    .resize-handle {
      position: absolute;
      top: 0;
      right: -3px;
      width: 6px;
      height: 100%;
      cursor: col-resize;
      z-index: 10;
    }
    .resize-handle:hover {
      background: var(--accent-primary);
      opacity: 0.3;
    }
  `];

  constructor() {
    super();
    this.activeTab = 'files';
    this.minimized = false;
    this._historyPercent = 0;
    this._visitedTabs = new Set(['files']);
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this._onKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._onKeyDown);
  }

  onRpcReady() {
    this._refreshHistoryBar();
    // Listen for events that should refresh the history bar
    window.addEventListener('stream-complete', () => this._refreshHistoryBar());
    window.addEventListener('compaction-event', () => this._refreshHistoryBar());
    window.addEventListener('state-loaded', () => this._refreshHistoryBar());
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
      this.minimized = !this.minimized;
      return;
    }
    // Ctrl+Shift+F → Search tab
    if (e.ctrlKey && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      this._switchTab('search');
      return;
    }
  }

  _switchTab(tabId) {
    this.activeTab = tabId;
    this._visitedTabs.add(tabId);
    if (this.minimized) {
      this.minimized = false;
    }
  }

  _toggleMinimize() {
    this.minimized = !this.minimized;
  }

  _getHistoryBarColor() {
    if (this._historyPercent > 90) return 'red';
    if (this._historyPercent > 75) return 'orange';
    return 'green';
  }

  render() {
    const currentTab = TABS.find(t => t.id === this.activeTab);

    return html`
      <div class="header" @click=${this._toggleMinimize}>
        <span class="header-label">${currentTab?.label || 'Files'}</span>

        <div class="tab-buttons" @click=${(e) => e.stopPropagation()}>
          ${TABS.map(tab => html`
            <button
              class="tab-btn ${tab.id === this.activeTab ? 'active' : ''}"
              title="${tab.label} (${tab.shortcut})"
              @click=${() => this._switchTab(tab.id)}
            >${tab.icon}</button>
          `)}
        </div>

        <div class="header-actions" @click=${(e) => e.stopPropagation()}>
          <button class="header-action" title="Minimize (Alt+M)"
            @click=${this._toggleMinimize}>
            ${this.minimized ? '▲' : '▼'}
          </button>
        </div>
      </div>

      <div class="content ${this.minimized ? 'minimized' : ''}">
        <!-- Files tab (always rendered) -->
        <div class="tab-panel ${this.activeTab === 'files' ? 'active' : ''}">
          <ac-files-tab></ac-files-tab>
        </div>

        <!-- Lazy-loaded tabs — only render once visited -->
        ${this._visitedTabs.has('search') ? html`
          <div class="tab-panel ${this.activeTab === 'search' ? 'active' : ''}">
            <div class="placeholder">Search — coming soon</div>
          </div>
        ` : ''}

        ${this._visitedTabs.has('context') ? html`
          <div class="tab-panel ${this.activeTab === 'context' ? 'active' : ''}">
            <div class="placeholder">Context Budget — coming soon</div>
          </div>
        ` : ''}

        ${this._visitedTabs.has('cache') ? html`
          <div class="tab-panel ${this.activeTab === 'cache' ? 'active' : ''}">
            <div class="placeholder">Cache Tiers — coming soon</div>
          </div>
        ` : ''}

        ${this._visitedTabs.has('settings') ? html`
          <div class="tab-panel ${this.activeTab === 'settings' ? 'active' : ''}">
            <div class="placeholder">Settings — coming soon</div>
          </div>
        ` : ''}
      </div>

      <div class="history-bar">
        <div
          class="history-bar-fill ${this._getHistoryBarColor()}"
          style="width: ${this._historyPercent}%"
        ></div>
      </div>

      <div class="resize-handle"></div>
    `;
  }
}

customElements.define('ac-dialog', AcDialog);