/**
 * Settings tab — configuration editing and hot-reload.
 *
 * Layout: info banner, config card grid, inline textarea editor.
 */

import { LitElement, html, css, nothing } from 'lit';
import { theme, scrollbarStyles } from '../styles/theme.js';
import { RpcMixin } from '../rpc-mixin.js';

const CONFIG_CARDS = [
  { type: 'litellm', icon: '🤖', label: 'LLM Config', format: 'json', reloadable: true },
  { type: 'app', icon: '⚙️', label: 'App Config', format: 'json', reloadable: true },
  { type: 'system', icon: '📝', label: 'System Prompt', format: 'markdown', reloadable: false },
  { type: 'system_extra', icon: '📎', label: 'System Extra', format: 'markdown', reloadable: false },
  { type: 'compaction', icon: '🗜️', label: 'Compaction Skill', format: 'markdown', reloadable: false },
  { type: 'snippets', icon: '✂️', label: 'Snippets', format: 'json', reloadable: false },
];

export class AcSettingsTab extends RpcMixin(LitElement) {
  static properties = {
    _configInfo: { type: Object, state: true },
    _activeCard: { type: String, state: true },
    _editorContent: { type: String, state: true },
    _loading: { type: Boolean, state: true },
    _saving: { type: Boolean, state: true },
    _toast: { type: Object, state: true },
  };

  static styles = [theme, scrollbarStyles, css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow-y: auto;
    }

    /* Info banner */
    .info-banner {
      padding: 12px 16px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-primary);
      font-size: 0.8rem;
      color: var(--text-secondary);
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .info-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .info-label {
      color: var(--text-muted);
      min-width: 80px;
      flex-shrink: 0;
    }

    .info-value {
      font-family: var(--font-mono);
      color: var(--text-primary);
      font-size: 0.78rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Card grid */
    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 8px;
      padding: 12px 16px;
    }

    .config-card {
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      padding: 12px;
      cursor: pointer;
      text-align: center;
      transition: border-color 0.15s, background 0.15s;
      user-select: none;
    }
    .config-card:hover {
      border-color: var(--accent-primary);
      background: var(--bg-tertiary);
    }
    .config-card.active {
      border-color: var(--accent-primary);
      background: var(--bg-tertiary);
      box-shadow: 0 0 0 1px var(--accent-primary);
    }

    .card-icon {
      font-size: 1.5rem;
      margin-bottom: 4px;
    }

    .card-label {
      font-size: 0.75rem;
      color: var(--text-secondary);
    }

    .card-format {
      font-size: 0.65rem;
      color: var(--text-muted);
      text-transform: uppercase;
      margin-top: 2px;
    }

    /* Editor area */
    .editor-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
      border-top: 1px solid var(--border-primary);
    }

    .editor-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-primary);
      min-height: 36px;
    }

    .editor-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.8rem;
      color: var(--text-secondary);
      flex: 1;
      overflow: hidden;
    }

    .editor-title .icon {
      font-size: 1rem;
      flex-shrink: 0;
    }

    .editor-title .label {
      font-weight: 600;
      white-space: nowrap;
    }

    .editor-title .path {
      font-family: var(--font-mono);
      font-size: 0.7rem;
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .toolbar-btn {
      background: none;
      border: 1px solid var(--border-primary);
      color: var(--text-secondary);
      font-size: 0.75rem;
      padding: 3px 10px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .toolbar-btn:hover {
      background: var(--bg-secondary);
      color: var(--text-primary);
      border-color: var(--accent-primary);
    }
    .toolbar-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .toolbar-btn:disabled:hover {
      background: none;
      color: var(--text-secondary);
      border-color: var(--border-primary);
    }
    .toolbar-btn.primary {
      border-color: var(--accent-primary);
      color: var(--accent-primary);
    }
    .toolbar-btn.primary:hover {
      background: rgba(79, 195, 247, 0.1);
    }

    .editor-textarea {
      flex: 1;
      background: var(--bg-primary);
      color: var(--text-primary);
      font-family: var(--font-mono);
      font-size: 0.82rem;
      line-height: 1.5;
      padding: 12px 16px;
      border: none;
      outline: none;
      resize: none;
      tab-size: 2;
      min-height: 200px;
    }
    .editor-textarea::placeholder {
      color: var(--text-muted);
    }

    /* Loading */
    .editor-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      color: var(--text-muted);
      font-size: 0.85rem;
    }

    /* Toast */
    .toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      padding: 8px 16px;
      font-size: 0.85rem;
      color: var(--text-secondary);
      z-index: 10001;
      box-shadow: var(--shadow-md);
      transition: opacity 0.3s;
    }
    .toast.success { border-color: var(--accent-green); color: var(--accent-green); }
    .toast.error { border-color: var(--accent-red); color: var(--accent-red); }

    /* Empty state */
    .empty-editor {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      color: var(--text-muted);
      font-size: 0.85rem;
      padding: 24px;
    }
  `];

  constructor() {
    super();
    this._configInfo = null;
    this._activeCard = null;
    this._editorContent = '';
    this._loading = false;
    this._saving = false;
    this._toast = null;
    this._toastTimer = null;
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
    this._loadConfigInfo();
  }

  async _loadConfigInfo() {
    try {
      const info = await this.rpcExtract('Settings.get_config_info');
      if (info) {
        this._configInfo = info;
      }
    } catch (e) {
      console.warn('Failed to load config info:', e);
    }
  }

  _onKeyDown(e) {
    // Ctrl+S → save when editor is active
    if (e.ctrlKey && (e.key === 's' || e.key === 'S') && this._activeCard) {
      e.preventDefault();
      this._save();
    }
  }

  // === Card interaction ===

  async _openCard(type) {
    if (this._activeCard === type) return; // Already open

    this._activeCard = type;
    this._loading = true;
    this._editorContent = '';

    try {
      const content = await this.rpcExtract('Settings.get_config_content', type);
      if (typeof content === 'string') {
        this._editorContent = content;
      } else if (content?.content) {
        this._editorContent = content.content;
      } else {
        this._editorContent = JSON.stringify(content, null, 2);
      }
    } catch (e) {
      console.warn('Failed to load config:', e);
      this._editorContent = '';
      this._showToast(`Failed to load: ${e.message || 'Unknown error'}`, 'error');
    } finally {
      this._loading = false;
    }
  }

  _closeEditor() {
    this._activeCard = null;
    this._editorContent = '';
  }

  _onEditorInput(e) {
    this._editorContent = e.target.value;
  }

  // === Save & Reload ===

  async _save() {
    if (!this._activeCard || this._saving || !this.rpcConnected) return;

    const card = CONFIG_CARDS.find(c => c.type === this._activeCard);
    this._saving = true;

    try {
      await this.rpcExtract('Settings.save_config_content', this._activeCard, this._editorContent);
      this._showToast(`${card?.label || 'Config'} saved`, 'success');

      // Auto-reload for reloadable configs
      if (card?.reloadable) {
        await this._reload();
      }
    } catch (e) {
      console.warn('Failed to save config:', e);
      this._showToast(`Save failed: ${e.message || 'Unknown error'}`, 'error');
    } finally {
      this._saving = false;
    }
  }

  async _reload() {
    if (!this._activeCard || !this.rpcConnected) return;

    const card = CONFIG_CARDS.find(c => c.type === this._activeCard);
    if (!card?.reloadable) return;

    try {
      if (this._activeCard === 'litellm') {
        await this.rpcExtract('Settings.reload_llm_config');
      } else if (this._activeCard === 'app') {
        await this.rpcExtract('Settings.reload_app_config');
      }
      this._showToast(`${card.label} reloaded`, 'success');
      // Refresh info banner
      this._loadConfigInfo();
    } catch (e) {
      console.warn('Failed to reload config:', e);
      this._showToast(`Reload failed: ${e.message || 'Unknown error'}`, 'error');
    }
  }

  // === Toast ===

  _showToast(message, type = '') {
    this._toast = { message, type };
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this._toast = null;
    }, 3000);
    // Also dispatch global toast for visibility outside settings tab
    window.dispatchEvent(new CustomEvent('ac-toast', {
      detail: { message, type },
    }));
  }

  // === Render ===

  _renderInfoBanner() {
    if (!this._configInfo) {
      return html`
        <div class="info-banner">
          <div class="info-row">
            <span class="info-label">Status</span>
            <span class="info-value">Loading...</span>
          </div>
        </div>
      `;
    }

    return html`
      <div class="info-banner">
        ${this._configInfo.model ? html`
          <div class="info-row">
            <span class="info-label">Model</span>
            <span class="info-value">${this._configInfo.model}</span>
          </div>
        ` : nothing}
        ${this._configInfo.smaller_model ? html`
          <div class="info-row">
            <span class="info-label">Small Model</span>
            <span class="info-value">${this._configInfo.smaller_model}</span>
          </div>
        ` : nothing}
        ${this._configInfo.config_dir ? html`
          <div class="info-row">
            <span class="info-label">Config Dir</span>
            <span class="info-value" title="${this._configInfo.config_dir}">${this._configInfo.config_dir}</span>
          </div>
        ` : nothing}
      </div>
    `;
  }

  _renderEditor() {
    if (!this._activeCard) {
      return html`<div class="empty-editor">Select a config to edit</div>`;
    }

    const card = CONFIG_CARDS.find(c => c.type === this._activeCard);

    return html`
      <div class="editor-area">
        <div class="editor-toolbar">
          <div class="editor-title">
            <span class="icon">${card?.icon || '📄'}</span>
            <span class="label">${card?.label || this._activeCard}</span>
          </div>
          ${card?.reloadable ? html`
            <button class="toolbar-btn" @click=${this._reload}
              ?disabled=${!this.rpcConnected}
              title="Reload config">↻ Reload</button>
          ` : nothing}
          <button class="toolbar-btn primary" @click=${this._save}
            ?disabled=${this._saving || !this.rpcConnected}
            title="Save (Ctrl+S)">💾 Save</button>
          <button class="toolbar-btn" @click=${this._closeEditor}
            title="Close editor">✕</button>
        </div>
        ${this._loading ? html`
          <div class="editor-loading">Loading...</div>
        ` : html`
          <textarea
            class="editor-textarea"
            .value=${this._editorContent}
            @input=${this._onEditorInput}
            placeholder="Config content..."
            spellcheck="false"
          ></textarea>
        `}
      </div>
    `;
  }

  render() {
    return html`
      ${this._renderInfoBanner()}

      <div class="card-grid">
        ${CONFIG_CARDS.map(card => html`
          <div
            class="config-card ${this._activeCard === card.type ? 'active' : ''}"
            @click=${() => this._openCard(card.type)}
          >
            <div class="card-icon">${card.icon}</div>
            <div class="card-label">${card.label}</div>
            <div class="card-format">${card.format}</div>
          </div>
        `)}
      </div>

      ${this._renderEditor()}

      ${this._toast ? html`
        <div class="toast ${this._toast.type}">${this._toast.message}</div>
      ` : nothing}
    `;
  }
}

customElements.define('ac-settings-tab', AcSettingsTab);