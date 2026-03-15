/**
 * AcSettingsTab — configuration editing and hot-reload.
 *
 * Shows config info banner, card grid of config types,
 * and an inline monospace textarea editor.
 */

import { LitElement, html, css } from 'lit';
import { RpcMixin } from '../utils/rpc-mixin.js';

const CONFIG_CARDS = [
  { type: 'litellm', icon: '🤖', label: 'LLM Config', format: 'json', reloadable: true },
  { type: 'app', icon: '⚙️', label: 'App Config', format: 'json', reloadable: true },
  { type: 'system', icon: '📝', label: 'System Prompt', format: 'md', reloadable: false },
  { type: 'system_extra', icon: '📎', label: 'System Extra', format: 'md', reloadable: false },
  { type: 'compaction', icon: '🗜️', label: 'Compaction Skill', format: 'md', reloadable: false },
  { type: 'review', icon: '👁️', label: 'Review Prompt', format: 'md', reloadable: false },
  { type: 'system_doc', icon: '📄', label: 'Doc System Prompt', format: 'md', reloadable: false },
  { type: 'snippets', icon: '✂️', label: 'Snippets', format: 'json', reloadable: false },
];

export class AcSettingsTab extends RpcMixin(LitElement) {
  static properties = {
    _info: { type: Object, state: true },
    _activeCard: { type: String, state: true },
    _editorContent: { type: String, state: true },
    _dirty: { type: Boolean, state: true },
    _saving: { type: Boolean, state: true },
    _toast: { type: Object, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      font-size: 0.82rem;
      gap: 12px;
    }

    /* Info banner */
    .info-banner {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 0.78rem;
    }
    .info-row {
      display: flex;
      gap: 8px;
      padding: 2px 0;
    }
    .info-label { color: var(--text-muted); min-width: 80px; }
    .info-value { color: var(--text-primary); word-break: break-all; }

    /* Card grid */
    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 8px;
    }
    .config-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      padding: 12px;
      cursor: pointer;
      text-align: center;
      transition: border-color 0.15s, background 0.15s;
    }
    .config-card:hover {
      border-color: var(--accent-primary);
      background: var(--bg-tertiary);
    }
    .config-card.active {
      border-color: var(--accent-primary);
      background: rgba(79, 195, 247, 0.08);
    }
    .card-icon { font-size: 1.4rem; margin-bottom: 4px; }
    .card-label { font-size: 0.78rem; color: var(--text-primary); }
    .card-format { font-size: 0.65rem; color: var(--text-muted); }

    /* Editor */
    .editor-section {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 200px;
    }
    .editor-toolbar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 0;
      border-bottom: 1px solid var(--border-primary);
      flex-shrink: 0;
    }
    .editor-title {
      flex: 1;
      font-weight: 600;
      color: var(--accent-primary);
      font-size: 0.85rem;
    }
    .editor-btn {
      background: none;
      border: 1px solid var(--border-primary);
      border-radius: 4px;
      color: var(--text-secondary);
      cursor: pointer;
      padding: 3px 10px;
      font-size: 0.78rem;
    }
    .editor-btn:hover { color: var(--text-primary); background: var(--bg-tertiary); }
    .editor-btn.primary {
      border-color: var(--accent-primary);
      color: var(--accent-primary);
    }
    .editor-btn.primary:hover {
      background: rgba(79, 195, 247, 0.12);
    }
    .editor-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .editor-textarea {
      flex: 1;
      background: var(--bg-input);
      border: 1px solid var(--border-secondary);
      border-radius: 6px;
      color: var(--text-primary);
      padding: 10px;
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 0.78rem;
      line-height: 1.5;
      resize: none;
      outline: none;
      margin-top: 6px;
      tab-size: 2;
    }
    .editor-textarea:focus { border-color: var(--accent-primary); }

    .dirty-indicator {
      color: var(--accent-orange);
      font-size: 0.72rem;
    }

    /* Toast */
    .settings-toast {
      position: fixed;
      bottom: 60px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      padding: 8px 16px;
      font-size: 0.8rem;
      z-index: 1000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    .settings-toast.error { border-color: var(--accent-red); color: var(--accent-red); }
    .settings-toast.success { border-color: var(--accent-green); color: var(--accent-green); }
  `;

  constructor() {
    super();
    this._info = null;
    this._activeCard = null;
    this._editorContent = '';
    this._dirty = false;
    this._saving = false;
    this._toast = null;
    this._originalContent = '';
  }

  onRpcReady() {
    this._loadInfo();
  }

  async _loadInfo() {
    try {
      this._info = await this.rpcExtract('Settings.get_config_info');
    } catch (e) {
      console.warn('Failed to load config info:', e);
    }
  }

  async _openCard(card) {
    if (this._dirty && this._activeCard) {
      if (!confirm('Unsaved changes will be lost. Continue?')) return;
    }
    this._activeCard = card.type;
    try {
      const content = await this.rpcExtract('Settings.get_config_content', card.type);
      this._editorContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
      this._originalContent = this._editorContent;
      this._dirty = false;
    } catch (e) {
      this._showToast(`Failed to load: ${e.message}`, 'error');
    }
  }

  _closeEditor() {
    if (this._dirty && !confirm('Unsaved changes will be lost. Continue?')) return;
    this._activeCard = null;
    this._editorContent = '';
    this._dirty = false;
  }

  _onEditorInput(e) {
    this._editorContent = e.target.value;
    this._dirty = this._editorContent !== this._originalContent;
  }

  _onEditorKeyDown(e) {
    // Ctrl+S to save
    if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      this._save();
    }
    // Tab to insert spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.target;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      this._editorContent = this._editorContent.substring(0, start) + '  ' + this._editorContent.substring(end);
      this.updateComplete.then(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  }

  async _save() {
    if (!this._activeCard || this._saving) return;
    this._saving = true;
    try {
      const result = await this.rpcExtract('Settings.save_config_content', this._activeCard, this._editorContent);
      if (result?.error) {
        this._showToast(result.error, 'error');
      } else {
        this._originalContent = this._editorContent;
        this._dirty = false;
        this._showToast('Saved', 'success');

        // Auto-reload for reloadable configs
        const card = CONFIG_CARDS.find(c => c.type === this._activeCard);
        if (card?.reloadable) {
          await this._reload(card.type);
        }
      }
    } catch (e) {
      this._showToast(`Save failed: ${e.message}`, 'error');
    }
    this._saving = false;
  }

  async _reload(type) {
    try {
      if (type === 'litellm') {
        await this.rpcExtract('Settings.reload_llm_config');
        this._showToast('LLM config reloaded', 'success');
        this._loadInfo(); // Refresh model name
      } else if (type === 'app') {
        await this.rpcExtract('Settings.reload_app_config');
        this._showToast('App config reloaded', 'success');
      }
    } catch (e) {
      this._showToast(`Reload failed: ${e.message}`, 'error');
    }
  }

  _showToast(message, type = 'info') {
    this._toast = { message, type };
    setTimeout(() => { this._toast = null; }, 3000);
    // Also dispatch global toast
    window.dispatchEvent(new CustomEvent('ac-toast', {
      detail: { message, type },
    }));
  }

  render() {
    return html`
      <!-- Info banner -->
      ${this._info ? html`
        <div class="info-banner">
          <div class="info-row">
            <span class="info-label">Model:</span>
            <span class="info-value">${this._info.model || 'unknown'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Smaller:</span>
            <span class="info-value">${this._info.smaller_model || 'unknown'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Config dir:</span>
            <span class="info-value">${this._info.config_dir || 'unknown'}</span>
          </div>
        </div>
      ` : ''}

      <!-- Card grid (hidden when editor is open) -->
      ${!this._activeCard ? html`
        <div class="card-grid">
          ${CONFIG_CARDS.map(card => html`
            <div class="config-card ${this._activeCard === card.type ? 'active' : ''}"
                 @click=${() => this._openCard(card)}>
              <div class="card-icon">${card.icon}</div>
              <div class="card-label">${card.label}</div>
              <div class="card-format">${card.format.toUpperCase()}</div>
            </div>
          `)}
        </div>
      ` : ''}

      <!-- Editor -->
      ${this._activeCard ? html`
        <div class="editor-section">
          <div class="editor-toolbar">
            ${(() => {
              const card = CONFIG_CARDS.find(c => c.type === this._activeCard);
              return html`
                <span style="font-size:1rem">${card?.icon}</span>
                <span class="editor-title">${card?.label}</span>
              `;
            })()}
            ${this._dirty ? html`<span class="dirty-indicator">● unsaved</span>` : ''}
            ${CONFIG_CARDS.find(c => c.type === this._activeCard)?.reloadable ? html`
              <button class="editor-btn" @click=${() => this._reload(this._activeCard)}>↻ Reload</button>
            ` : ''}
            <button class="editor-btn primary"
                    ?disabled=${!this._dirty || this._saving}
                    @click=${this._save}>💾 Save</button>
            <button class="editor-btn" @click=${this._closeEditor}>✕ Close</button>
          </div>
          <textarea class="editor-textarea"
                    .value=${this._editorContent}
                    @input=${this._onEditorInput}
                    @keydown=${this._onEditorKeyDown}
                    spellcheck="false"></textarea>
        </div>
      ` : ''}

      ${this._toast ? html`
        <div class="settings-toast ${this._toast.type}">${this._toast.message}</div>
      ` : ''}
    `;
  }
}

customElements.define('ac-settings-tab', AcSettingsTab);