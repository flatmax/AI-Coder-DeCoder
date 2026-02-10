import { LitElement, html, css, nothing } from 'lit';
import { RpcMixin } from '../rpc-mixin.js';

/**
 * Settings tab — config file cards with edit/reload, toast feedback.
 *
 * Config types: litellm (JSON), app (JSON), snippets (JSON),
 * system (Markdown), system_extra (Markdown), compaction (Markdown).
 */

const CONFIG_CARDS = [
  { key: 'litellm', label: 'LLM Config', icon: '🤖', lang: 'json', reloadable: true },
  { key: 'app', label: 'App Config', icon: '⚙️', lang: 'json', reloadable: true },
  { key: 'system', label: 'System Prompt', icon: '📝', lang: 'markdown', reloadable: false },
  { key: 'system_extra', label: 'System Extra', icon: '📎', lang: 'markdown', reloadable: false },
  { key: 'compaction', label: 'Compaction Skill', icon: '🗜️', lang: 'markdown', reloadable: false },
  { key: 'snippets', label: 'Snippets', icon: '✂️', lang: 'json', reloadable: false },
];

class SettingsTab extends RpcMixin(LitElement) {
  static properties = {
    _editing: { type: String, state: true },
    _content: { type: String, state: true },
    _configPath: { type: String, state: true },
    _saving: { type: Boolean, state: true },
    _toast: { type: Object, state: true },
    _configInfo: { type: Object, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    .content {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }

    /* ── Info banner ── */
    .info-banner {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 10px 12px;
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      margin-bottom: 12px;
      font-size: 11px;
    }

    .info-row {
      display: flex;
      gap: 8px;
    }

    .info-label {
      color: var(--text-muted);
      min-width: 100px;
      flex-shrink: 0;
    }

    .info-value {
      color: var(--text-secondary);
      font-family: var(--font-mono);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ── Config cards ── */
    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 8px;
      margin-bottom: 12px;
    }

    .config-card {
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 12px;
      background: var(--bg-elevated);
      cursor: pointer;
      transition: background var(--transition-fast), border-color var(--transition-fast);
    }
    .config-card:hover {
      background: var(--bg-surface);
      border-color: var(--accent-primary);
    }
    .config-card.active {
      border-color: var(--accent-primary);
      background: var(--bg-surface);
    }

    .card-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }

    .card-icon { font-size: 18px; }

    .card-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .card-lang {
      font-size: 10px;
      color: var(--text-muted);
      text-transform: uppercase;
      padding: 1px 5px;
      background: var(--bg-surface);
      border-radius: 3px;
      margin-left: auto;
    }

    /* ── Editor area ── */
    .editor-area {
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      background: var(--bg-elevated);
    }

    .editor-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--border-color);
      background: var(--bg-secondary);
    }

    .editor-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
      flex: 1;
    }

    .editor-path {
      font-size: 10px;
      font-family: var(--font-mono);
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 200px;
    }

    .editor-btn {
      background: none;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 3px 10px;
      cursor: pointer;
      font-size: 11px;
      color: var(--text-secondary);
      transition: background var(--transition-fast), color var(--transition-fast);
    }
    .editor-btn:hover {
      background: var(--bg-surface);
      color: var(--text-primary);
    }
    .editor-btn.primary {
      background: var(--accent-primary);
      color: white;
      border-color: var(--accent-primary);
    }
    .editor-btn.primary:hover {
      opacity: 0.9;
    }
    .editor-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .editor-textarea {
      width: 100%;
      min-height: 300px;
      padding: 12px;
      background: var(--bg-primary);
      color: var(--text-primary);
      border: none;
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.5;
      resize: vertical;
      outline: none;
      tab-size: 2;
      box-sizing: border-box;
    }

    /* ── Toast ── */
    .toast {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      padding: 8px 16px;
      border-radius: var(--radius-md);
      font-size: 12px;
      font-weight: 500;
      z-index: 500;
      animation: toast-in 0.3s ease, toast-out 0.3s ease 2.7s;
      pointer-events: none;
    }
    .toast.success {
      background: rgba(76,175,80,0.9);
      color: white;
    }
    .toast.error {
      background: rgba(244,67,54,0.9);
      color: white;
    }
    .toast.info {
      background: rgba(33,150,243,0.9);
      color: white;
    }

    @keyframes toast-in {
      from { opacity: 0; transform: translateX(-50%) translateY(10px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
    @keyframes toast-out {
      from { opacity: 1; }
      to { opacity: 0; }
    }
  `;

  constructor() {
    super();
    this._editing = null;
    this._content = '';
    this._configPath = '';
    this._saving = false;
    this._toast = null;
    this._configInfo = null;
    this._toastTimer = null;
  }

  onRpcReady() {
    this._loadConfigInfo();
  }

  async _loadConfigInfo() {
    try {
      const info = await this.rpcExtract('Settings.get_config_info');
      this._configInfo = info;
    } catch (e) {
      console.warn('Failed to load config info:', e);
    }
  }

  async _openEditor(key) {
    try {
      const result = await this.rpcExtract('Settings.get_config_content', key);
      if (result?.error) {
        this._showToast(result.error, 'error');
        return;
      }
      this._editing = key;
      this._content = result.content || '';
      this._configPath = result.path || '';
    } catch (e) {
      this._showToast(String(e), 'error');
    }
  }

  async _save() {
    if (!this._editing || this._saving) return;
    this._saving = true;
    try {
      const result = await this.rpcExtract(
        'Settings.save_config_content', this._editing, this._content
      );
      if (result?.error) {
        this._showToast(`Save failed: ${result.error}`, 'error');
      } else {
        this._showToast('Saved successfully', 'success');
        // Auto-reload if applicable
        const card = CONFIG_CARDS.find(c => c.key === this._editing);
        if (card?.reloadable) {
          await this._reload(this._editing);
        }
      }
    } catch (e) {
      this._showToast(`Save failed: ${e}`, 'error');
    } finally {
      this._saving = false;
    }
  }

  async _reload(key) {
    try {
      let result;
      if (key === 'litellm') {
        result = await this.rpcExtract('Settings.reload_llm_config');
        this._showToast(
          `Reloaded: model=${result?.model || '?'}`,
          'info'
        );
      } else if (key === 'app') {
        result = await this.rpcExtract('Settings.reload_app_config');
        this._showToast('App config reloaded', 'info');
      }
    } catch (e) {
      this._showToast(`Reload failed: ${e}`, 'error');
    }
  }

  _closeEditor() {
    this._editing = null;
    this._content = '';
    this._configPath = '';
  }

  _showToast(message, type = 'info') {
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toast = { message, type };
    this._toastTimer = setTimeout(() => {
      this._toast = null;
    }, 3000);
  }

  render() {
    return html`
      <div class="content">
        ${this._configInfo ? this._renderInfo() : nothing}
        ${this._renderCardGrid()}
        ${this._editing ? this._renderEditor() : nothing}
      </div>
      ${this._toast ? html`
        <div class="toast ${this._toast.type}">${this._toast.message}</div>
      ` : nothing}
    `;
  }

  _renderInfo() {
    const info = this._configInfo;
    return html`
      <div class="info-banner">
        <div class="info-row">
          <span class="info-label">Model</span>
          <span class="info-value">${info.model || '—'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Smaller Model</span>
          <span class="info-value">${info.smaller_model || '—'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Config Dir</span>
          <span class="info-value" title="${info.config_dir || ''}">${info.config_dir || '—'}</span>
        </div>
      </div>
    `;
  }

  _renderCardGrid() {
    return html`
      <div class="card-grid">
        ${CONFIG_CARDS.map(card => html`
          <div class="config-card ${this._editing === card.key ? 'active' : ''}"
            @click=${() => this._openEditor(card.key)}>
            <div class="card-header">
              <span class="card-icon">${card.icon}</span>
              <span class="card-label">${card.label}</span>
              <span class="card-lang">${card.lang}</span>
            </div>
          </div>
        `)}
      </div>
    `;
  }

  _renderEditor() {
    const card = CONFIG_CARDS.find(c => c.key === this._editing);
    return html`
      <div class="editor-area">
        <div class="editor-toolbar">
          <span class="editor-title">${card?.icon || ''} ${card?.label || this._editing}</span>
          <span class="editor-path" title="${this._configPath}">${this._configPath}</span>
          ${card?.reloadable ? html`
            <button class="editor-btn" @click=${() => this._reload(this._editing)}>
              ↻ Reload
            </button>
          ` : nothing}
          <button class="editor-btn primary" @click=${this._save} ?disabled=${this._saving}>
            ${this._saving ? 'Saving...' : '💾 Save'}
          </button>
          <button class="editor-btn" @click=${this._closeEditor}>✕</button>
        </div>
        <textarea class="editor-textarea"
          .value=${this._content}
          @input=${(e) => this._content = e.target.value}
          spellcheck="false"
        ></textarea>
      </div>
    `;
  }
}

customElements.define('settings-tab', SettingsTab);
