import { LitElement, html, css } from 'lit';
import { RpcMixin } from '../rpc-mixin.js';
import '../chat/files-tab.js';
import '../chat/search-tab.js';
import '../chat/context-tab.js';
import '../chat/cache-tab.js';
import '../chat/settings-tab.js';

// Tab definitions
const TABS = [
  { id: 'FILES', icon: '📁', label: 'Files & Chat' },
  { id: 'SEARCH', icon: '🔍', label: 'Search' },
  { id: 'CONTEXT', icon: '📊', label: 'Context Budget' },
  { id: 'CACHE', icon: '🗄️', label: 'Cache Tiers' },
  { id: 'SETTINGS', icon: '⚙️', label: 'Settings' },
];

class AcDialog extends RpcMixin(LitElement) {
  static properties = {
    connected: { type: Boolean },
    error: { type: String },
    activeTab: { type: String, state: true },
    minimized: { type: Boolean, state: true },
    _dragging: { type: Boolean, state: true },
    _positioned: { type: Boolean, state: true },
    _visitedTabs: { type: Object, state: true },
    _historyPercent: { type: Number, state: true },
  };

  static styles = css`
    :host {
      display: block;
      position: fixed;
      top: 0;
      left: 0;
      width: 50vw;
      min-width: 400px;
      height: 100vh;
      z-index: 10;
    }

    .dialog {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 0 var(--radius-lg) var(--radius-lg) 0;
      box-shadow: var(--shadow-lg);
      overflow: hidden;
    }

    :host(.positioned) {
      min-width: 300px;
      min-height: 200px;
    }

    :host(.minimized) {
      height: 48px !important;
      min-height: 48px;
    }

    :host(.minimized) .content,
    :host(.minimized) .history-bar {
      display: none;
    }

    /* Header */
    .header {
      display: flex;
      align-items: center;
      height: 48px;
      padding: 0 12px;
      background: var(--bg-elevated);
      border-bottom: 1px solid var(--border-color);
      cursor: default;
      user-select: none;
      flex-shrink: 0;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 120px;
      cursor: pointer;
    }

    .header-left .title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .connection-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent-error);
      flex-shrink: 0;
    }
    .connection-dot.connected { background: var(--accent-success); }

    .tabs {
      display: flex;
      gap: 2px;
      flex: 1;
      justify-content: center;
    }

    .tab-btn {
      background: none;
      border: none;
      padding: 6px 10px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      font-size: 16px;
      color: var(--text-secondary);
      transition: background var(--transition-fast), color var(--transition-fast);
      position: relative;
    }

    .tab-btn:hover {
      background: var(--bg-surface);
      color: var(--text-primary);
    }

    .tab-btn.active {
      background: var(--bg-surface);
      color: var(--accent-primary);
    }

    .tab-btn .tooltip {
      display: none;
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      padding: 4px 8px;
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      font-size: 11px;
      white-space: nowrap;
      z-index: 100;
      color: var(--text-secondary);
      pointer-events: none;
    }

    .tab-btn:hover .tooltip { display: block; }

    .header-right {
      display: flex;
      align-items: center;
      gap: 4px;
      min-width: 80px;
      justify-content: flex-end;
    }

    .header-btn {
      background: none;
      border: none;
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      font-size: 14px;
      color: var(--text-secondary);
      transition: background var(--transition-fast);
    }

    .header-btn:hover {
      background: var(--bg-surface);
      color: var(--text-primary);
    }

    /* Content area */
    .content {
      flex: 1;
      overflow: hidden;
      position: relative;
    }

    .tab-panel {
      width: 100%;
      height: 100%;
      overflow: auto;
    }

    .tab-panel[hidden] {
      display: none;
    }

    .tab-placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 14px;
    }

    /* History bar */
    .history-bar {
      height: 3px;
      background: var(--bg-elevated);
      flex-shrink: 0;
    }

    .history-fill {
      height: 100%;
      background: var(--accent-success);
      transition: width var(--transition-normal), background var(--transition-normal);
      border-radius: 0 2px 2px 0;
    }

    .history-fill.warning { background: var(--accent-warning); }
    .history-fill.critical { background: var(--accent-error); }

    /* Resize handles — always rendered, positioned within the dialog */
    .resize-handle {
      position: absolute;
      z-index: 10;
    }
    /* Right edge always available (primary handle for left-docked state) */
    .resize-e { top: 8px; right: 0; bottom: 8px; width: 4px; cursor: e-resize; }

    /* Other edges only available after undocking */
    .resize-n { top: 0; left: 8px; right: 8px; height: 4px; cursor: n-resize; }
    .resize-s { bottom: 0; left: 8px; right: 8px; height: 4px; cursor: s-resize; }
    .resize-w { top: 8px; left: 0; bottom: 8px; width: 4px; cursor: w-resize; }
    .resize-ne { top: 0; right: 0; width: 8px; height: 8px; cursor: ne-resize; }
    .resize-nw { top: 0; left: 0; width: 8px; height: 8px; cursor: nw-resize; }
    .resize-se { bottom: 0; right: 0; width: 8px; height: 8px; cursor: se-resize; }
    .resize-sw { bottom: 0; left: 0; width: 8px; height: 8px; cursor: sw-resize; }
  `;

  constructor() {
    super();
    this.activeTab = 'FILES';
    this.minimized = false;
    this._dragging = false;
    this._positioned = false;
    this._visitedTabs = new Set(['FILES']);
    this._dragStart = null;
    this._resizeDir = null;
    this._historyPercent = 0;

    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);

    this._boundOnStreamComplete = this._onStreamCompleteForBar.bind(this);
    this._boundOnCompactionEvent = this._onCompactionEventForBar.bind(this);
    this._boundOnStateLoaded = this._onStateLoadedForBar.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('search-navigate', this._onSearchNavigate.bind(this));
    window.addEventListener('stream-complete', this._boundOnStreamComplete);
    window.addEventListener('compaction-event', this._boundOnCompactionEvent);
    window.addEventListener('state-loaded', this._boundOnStateLoaded);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('stream-complete', this._boundOnStreamComplete);
    window.removeEventListener('compaction-event', this._boundOnCompactionEvent);
    window.removeEventListener('state-loaded', this._boundOnStateLoaded);
  }

  onRpcReady() {
    this._refreshHistoryBar();
  }

  // ── Tab switching ──

  _switchTab(tabId) {
    this.activeTab = tabId;
    this._visitedTabs = new Set([...this._visitedTabs, tabId]);

    // Focus search input when switching to search tab
    if (tabId === 'SEARCH') {
      this.updateComplete.then(() => {
        this.shadowRoot.querySelector('search-tab')?.focus();
      });
    }
  }

  // ── Search navigation ──

  _onSearchNavigate(e) {
    // Re-dispatch as navigate-file so it bubbles up to app-shell which owns the diff viewer
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent('navigate-file', {
      detail: e.detail,
      bubbles: true, composed: true,
    }));
  }

  // ── Minimize ──

  _toggleMinimize() {
    this.minimized = !this.minimized;
    if (this.minimized) {
      this.classList.add('minimized');
    } else {
      this.classList.remove('minimized');
    }
  }

  // ── Dragging ──

  _onHeaderMouseDown(e) {
    if (e.target.closest('button')) return; // Don't drag from buttons
    this._dragStart = { x: e.clientX, y: e.clientY, moved: false };
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);
  }

  _onMouseMove(e) {
    if (this._resizeDir) {
      this._handleResize(e);
      return;
    }
    if (!this._dragStart) return;

    const dx = e.clientX - this._dragStart.x;
    const dy = e.clientY - this._dragStart.y;

    if (!this._dragStart.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
    this._dragStart.moved = true;

    const host = this;
    if (!this._positioned) {
      // Switch from default docked to explicit positioning
      const rect = host.getBoundingClientRect();
      host.style.left = rect.left + 'px';
      host.style.top = rect.top + 'px';
      host.style.width = rect.width + 'px';
      host.style.height = rect.height + 'px';
      this._positioned = true;
      this.classList.add('positioned');
      this._dragStart.x = e.clientX;
      this._dragStart.y = e.clientY;
      return;
    }

    const left = parseFloat(host.style.left) + dx;
    const top = parseFloat(host.style.top) + dy;
    host.style.left = left + 'px';
    host.style.top = top + 'px';

    this._dragStart.x = e.clientX;
    this._dragStart.y = e.clientY;
  }

  _onMouseUp(e) {
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);

    if (this._resizeDir) {
      this._resizeDir = null;
      return;
    }

    if (this._dragStart && !this._dragStart.moved) {
      this._toggleMinimize();
    }
    this._dragStart = null;
  }

  // ── Resizing ──

  _onResizeStart(dir, e) {
    e.preventDefault();
    e.stopPropagation();

    const host = this;
    if (!this._positioned) {
      const rect = host.getBoundingClientRect();
      host.style.left = rect.left + 'px';
      host.style.top = rect.top + 'px';
      host.style.width = rect.width + 'px';
      host.style.height = rect.height + 'px';
      this._positioned = true;
      this.classList.add('positioned');
    }

    this._resizeDir = dir;
    this._resizeStart = {
      x: e.clientX,
      y: e.clientY,
      left: parseFloat(host.style.left),
      top: parseFloat(host.style.top),
      width: parseFloat(host.style.width),
      height: parseFloat(host.style.height),
    };

    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);
  }

  _handleResize(e) {
    const host = this;
    const s = this._resizeStart;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    const dir = this._resizeDir;

    let left = s.left, top = s.top, width = s.width, height = s.height;

    if (dir.includes('e')) width = Math.max(300, s.width + dx);
    if (dir.includes('w')) { width = Math.max(300, s.width - dx); left = s.left + s.width - width; }
    if (dir.includes('s')) height = Math.max(200, s.height + dy);
    if (dir.includes('n')) { height = Math.max(200, s.height - dy); top = s.top + s.height - height; }

    host.style.left = left + 'px';
    host.style.top = top + 'px';
    host.style.width = width + 'px';
    host.style.height = height + 'px';
  }

  // ── History bar ──

  _onStreamCompleteForBar() {
    this._refreshHistoryBar();
  }

  _onCompactionEventForBar(e) {
    const event = e.detail?.event;
    if (event?.type === 'compaction_complete' && event.case !== 'none') {
      this._refreshHistoryBar();
    }
  }

  _onStateLoadedForBar() {
    this._refreshHistoryBar();
  }

  async _refreshHistoryBar() {
    if (!this.rpcConnected) return;
    try {
      const status = await this.rpcExtract('LLM.get_history_status');
      if (status && typeof status.percent === 'number') {
        this._historyPercent = status.percent;
      }
    } catch (e) {
      // History bar is non-critical — silently ignore
    }
  }

  _historyBarClass() {
    if (this._historyPercent > 90) return 'critical';
    if (this._historyPercent > 75) return 'warning';
    return '';
  }

  // ── Render ──

  render() {
    const activeLabel = TABS.find(t => t.id === this.activeTab)?.label || '';

    return html`
      <div class="dialog">

        <!-- Right edge always available (primary handle for left-docked state) -->
        <div class="resize-handle resize-e" @mousedown=${(e) => this._onResizeStart('e', e)}></div>

        ${this._positioned ? html`
          <div class="resize-handle resize-n" @mousedown=${(e) => this._onResizeStart('n', e)}></div>
          <div class="resize-handle resize-s" @mousedown=${(e) => this._onResizeStart('s', e)}></div>
          <div class="resize-handle resize-w" @mousedown=${(e) => this._onResizeStart('w', e)}></div>
          <div class="resize-handle resize-ne" @mousedown=${(e) => this._onResizeStart('ne', e)}></div>
          <div class="resize-handle resize-nw" @mousedown=${(e) => this._onResizeStart('nw', e)}></div>
          <div class="resize-handle resize-se" @mousedown=${(e) => this._onResizeStart('se', e)}></div>
          <div class="resize-handle resize-sw" @mousedown=${(e) => this._onResizeStart('sw', e)}></div>
        ` : ''}

        <div class="header" @mousedown=${this._onHeaderMouseDown}>
          <div class="header-left" @click=${this._toggleMinimize}>
            <span class="connection-dot ${this.connected ? 'connected' : ''}"></span>
            <span class="title">${activeLabel}</span>
          </div>

          <div class="tabs">
            ${TABS.map(tab => html`
              <button
                class="tab-btn ${this.activeTab === tab.id ? 'active' : ''}"
                @click=${(e) => { e.stopPropagation(); this._switchTab(tab.id); }}
                title=${tab.label}
              >
                ${tab.icon}
                <span class="tooltip">${tab.label}</span>
              </button>
            `)}
          </div>

          <div class="header-right">
            <button class="header-btn" @click=${(e) => { e.stopPropagation(); this._toggleMinimize(); }}
              title=${this.minimized ? 'Maximize' : 'Minimize'}>
              ${this.minimized ? '□' : '─'}
            </button>
          </div>
        </div>

        <div class="content">
          ${this._renderTabPanel('FILES', () => html`
            <files-tab></files-tab>
          `)}
          ${this._renderTabPanel('SEARCH', () => html`
            <search-tab></search-tab>
          `)}
          ${this._renderTabPanel('CONTEXT', () => html`
            <context-tab></context-tab>
          `)}
          ${this._renderTabPanel('CACHE', () => html`
            <cache-tab></cache-tab>
          `)}
          ${this._renderTabPanel('SETTINGS', () => html`
            <settings-tab></settings-tab>
          `)}
        </div>

        <div class="history-bar">
          <div class="history-fill ${this._historyBarClass()}"
               style="width: ${this._historyPercent}%"></div>
        </div>
      </div>
    `;
  }

  _renderTabPanel(tabId, contentFn) {
    // Only render tabs that have been visited (lazy loading)
    if (!this._visitedTabs.has(tabId)) {
      return html`<div class="tab-panel" ?hidden=${this.activeTab !== tabId}></div>`;
    }
    return html`
      <div class="tab-panel" ?hidden=${this.activeTab !== tabId}>
        ${contentFn()}
      </div>
    `;
  }
}

customElements.define('ac-dialog', AcDialog);