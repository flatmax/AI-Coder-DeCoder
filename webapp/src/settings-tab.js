// SettingsTab — config editing and hot-reload.
//
// Layer 5 Phase 3.3 — Settings tab.
//
// Renders a card grid of whitelisted config types. Clicking
// a card opens its content in an inline monospace textarea.
// Save writes via Settings.save_config_content; reloadable
// configs (LLM, App) auto-trigger their reload RPC on save.
//
// Governing spec: specs4/5-webapp/settings.md

import { LitElement, css, html } from 'lit';
import { RpcMixin } from './rpc-mixin.js';

/**
 * Config cards — one per whitelisted type. The `key` field
 * matches the backend's CONFIG_TYPES keys. `reloadable`
 * controls whether save auto-triggers a reload RPC.
 *
 * Cards with `renderer: 'toggle'` render a boolean switch
 * inline instead of opening the textarea editor. The
 * `toggleConfigKey` names the config type whose JSON holds
 * the boolean, and `togglePath` is a dot-separated path
 * into that JSON. Toggle cards are inherently reloadable
 * (they're always backed by app.json, which is a JSON
 * config type that triggers reload on save).
 */
const CONFIG_CARDS = [
  {
    key: 'agents',
    icon: '🤖',
    label: 'Agentic coding',
    description: (
      'Allow the assistant to decompose complex requests into ' +
      'parallel agent conversations. Uses more tokens per turn ' +
      'but finishes large refactors faster.'
    ),
    renderer: 'toggle',
    toggleConfigKey: 'app',
    togglePath: 'agents.enabled',
    toggleDefault: false,
  },
  { key: 'litellm', icon: '🤖', label: 'LLM Config', format: 'json', reloadable: true },
  { key: 'app', icon: '⚙️', label: 'App Config', format: 'json', reloadable: true },
  { key: 'system', icon: '📝', label: 'System Prompt', format: 'md', reloadable: false },
  { key: 'system_extra', icon: '📎', label: 'System Extra', format: 'md', reloadable: false },
  { key: 'compaction', icon: '🗜️', label: 'Compaction Skill', format: 'md', reloadable: false },
  { key: 'snippets', icon: '✂️', label: 'Snippets', format: 'json', reloadable: false },
  { key: 'review', icon: '👁', label: 'Review Prompt', format: 'md', reloadable: false },
  { key: 'system_doc', icon: '📄', label: 'Doc Prompt', format: 'md', reloadable: false },
];

export class SettingsTab extends RpcMixin(LitElement) {
  static properties = {
    /** Info banner data from get_config_info. */
    _info: { type: Object, state: true },
    /** Currently-open card key, or null. */
    _activeKey: { type: String, state: true },
    /** Content loaded into the editor textarea. */
    _editorContent: { type: String, state: true },
    /** Whether the editor is loading content. */
    _loading: { type: Boolean, state: true },
    /** Whether a save is in flight. */
    _saving: { type: Boolean, state: true },
    /**
     * Toggle-card state, keyed by card.key. Populated by
     * _loadToggles() which reads the underlying config file
     * and extracts the value at togglePath. Undefined means
     * "not yet loaded"; the switch renders in a muted state
     * until the first load completes.
     */
    _toggles: { type: Object, state: true },
    /**
     * Whether the current client is a localhost caller. When
     * false (remote collab participant), toggle switches
     * render read-only. Matches the mutation-allowed pattern
     * used elsewhere in the webapp.
     *
     * Set to true by default — the localhost check is a
     * defensive read that downgrades to read-only on failure.
     */
    _localhost: { type: Boolean, state: true },
    /**
     * Per-toggle-card in-flight flag. Prevents rapid-click
     * double-writes while a save/reload is still pending.
     */
    _togglingKey: { type: String, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      background: var(--bg-primary, #0d1117);
      color: var(--text-primary, #c9d1d9);
      font-size: 0.9375rem;
      overflow-y: auto;
      padding: 1rem;
    }

    .info-banner {
      background: rgba(22, 27, 34, 0.6);
      border: 1px solid rgba(240, 246, 252, 0.1);
      border-radius: 6px;
      padding: 0.75rem 1rem;
      margin-bottom: 1rem;
      font-size: 0.8125rem;
      color: var(--text-secondary, #8b949e);
    }
    .info-banner strong {
      color: var(--text-primary, #c9d1d9);
    }
    .info-row {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.25rem;
    }
    .info-label {
      opacity: 0.7;
      min-width: 5rem;
    }

    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    .card {
      background: rgba(22, 27, 34, 0.6);
      border: 1px solid rgba(240, 246, 252, 0.1);
      border-radius: 6px;
      padding: 0.75rem;
      cursor: pointer;
      text-align: center;
      transition: border-color 120ms ease, background 120ms ease;
    }
    .card:hover {
      background: rgba(240, 246, 252, 0.04);
      border-color: rgba(240, 246, 252, 0.2);
    }
    .card.active {
      border-color: var(--accent-primary, #58a6ff);
      background: rgba(88, 166, 255, 0.08);
    }
    .card-icon {
      font-size: 1.5rem;
      display: block;
      margin-bottom: 0.35rem;
    }
    .card-label {
      font-size: 0.8125rem;
      color: var(--text-secondary, #8b949e);
    }

    /* Toggle card — renders a switch inline rather than
       opening the editor. Matches the regular card's
       centered layout so the grid stays visually uniform.
       Description text lives in the title tooltip. */
    .card.toggle-card {
      cursor: default;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.4rem;
    }
    .card.toggle-card:hover {
      background: rgba(22, 27, 34, 0.6);
      border-color: rgba(240, 246, 252, 0.1);
    }
    .card.toggle-card.toggle-on {
      border-color: rgba(88, 166, 255, 0.4);
      background: rgba(88, 166, 255, 0.04);
    }
    .toggle-switch {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: transparent;
      border: none;
      color: var(--text-primary, #c9d1d9);
      cursor: pointer;
      padding: 0.25rem 0;
      font-family: inherit;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.05em;
    }
    .toggle-switch:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
    .toggle-track {
      position: relative;
      width: 2.2rem;
      height: 1.1rem;
      background: rgba(240, 246, 252, 0.15);
      border-radius: 0.55rem;
      transition: background 120ms ease;
    }
    .toggle-switch.on .toggle-track {
      background: var(--accent-primary, #58a6ff);
    }
    .toggle-thumb {
      position: absolute;
      top: 0.125rem;
      left: 0.125rem;
      width: 0.85rem;
      height: 0.85rem;
      background: #ffffff;
      border-radius: 50%;
      transition: transform 120ms ease;
    }
    .toggle-switch.on .toggle-thumb {
      transform: translateX(1.1rem);
    }
    .toggle-state-label {
      color: var(--text-secondary, #8b949e);
    }
    .toggle-switch.on .toggle-state-label {
      color: var(--accent-primary, #58a6ff);
    }
    .toggle-readonly-note {
      font-size: 0.6875rem;
      color: var(--text-secondary, #8b949e);
      font-style: italic;
    }

    .editor-area {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      border: 1px solid rgba(240, 246, 252, 0.1);
      border-radius: 6px;
      overflow: hidden;
    }
    .editor-toolbar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      background: rgba(22, 27, 34, 0.6);
      border-bottom: 1px solid rgba(240, 246, 252, 0.08);
    }
    .editor-toolbar .toolbar-label {
      font-size: 0.8125rem;
      font-weight: 600;
      flex: 1;
    }
    .toolbar-button {
      background: transparent;
      border: 1px solid rgba(240, 246, 252, 0.15);
      color: var(--text-primary, #c9d1d9);
      padding: 0.3rem 0.6rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.75rem;
      font-family: inherit;
    }
    .toolbar-button:hover {
      background: rgba(240, 246, 252, 0.06);
      border-color: rgba(240, 246, 252, 0.3);
    }
    .toolbar-button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .toolbar-button.primary {
      background: var(--accent-primary, #58a6ff);
      border-color: var(--accent-primary, #58a6ff);
      color: #0d1117;
    }
    .toolbar-button.primary:hover {
      filter: brightness(1.1);
    }
    .editor-textarea {
      flex: 1;
      min-height: 200px;
      width: 100%;
      box-sizing: border-box;
      resize: none;
      padding: 0.75rem;
      background: rgba(13, 17, 23, 0.8);
      border: none;
      color: var(--text-primary, #c9d1d9);
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 0.8125rem;
      line-height: 1.5;
    }
    .editor-textarea:focus {
      outline: none;
    }
    .loading-note {
      padding: 2rem;
      text-align: center;
      color: var(--text-secondary, #8b949e);
      font-style: italic;
    }
  `;

  constructor() {
    super();
    this._info = null;
    this._activeKey = null;
    this._editorContent = '';
    this._loading = false;
    this._saving = false;
    this._toggles = {};
    this._localhost = true;
    this._togglingKey = null;
  }

  onRpcReady() {
    this._loadInfo();
    this._loadToggles();
    this._loadLocalhostFlag();
  }

  async _loadInfo() {
    if (!this.rpcConnected) return;
    try {
      const result = await this.rpcExtract('Settings.get_config_info');
      this._info = result && typeof result === 'object' ? result : null;
    } catch (err) {
      console.warn('[settings] get_config_info failed', err);
    }
  }

  /**
   * Read every toggle-card's underlying config content
   * and extract the boolean at togglePath. Called on
   * onRpcReady and after every successful toggle write.
   *
   * Cards with malformed JSON or missing fields fall back
   * to their toggleDefault. This keeps the switch in a
   * defined state even when the config file is partial
   * or corrupt — matches the backend's defensive coercion
   * of non-bool `enabled` values.
   */
  async _loadToggles() {
    if (!this.rpcConnected) return;
    const toggleCards = CONFIG_CARDS.filter(
      (c) => c.renderer === 'toggle',
    );
    if (toggleCards.length === 0) return;
    const next = {};
    // Group by toggleConfigKey so we only fetch each
    // underlying config file once, even when multiple
    // toggle cards share one file.
    const byConfigKey = new Map();
    for (const card of toggleCards) {
      if (!byConfigKey.has(card.toggleConfigKey)) {
        byConfigKey.set(card.toggleConfigKey, []);
      }
      byConfigKey.get(card.toggleConfigKey).push(card);
    }
    for (const [configKey, cards] of byConfigKey) {
      let parsed;
      try {
        const result = await this.rpcExtract(
          'Settings.get_config_content',
          configKey,
        );
        const content =
          typeof result === 'object' && result !== null
            ? result.content ?? ''
            : typeof result === 'string'
              ? result
              : '';
        parsed = content.trim() ? JSON.parse(content) : {};
      } catch (err) {
        console.warn(
          `[settings] toggle load failed for ${configKey}`,
          err,
        );
        parsed = {};
      }
      for (const card of cards) {
        next[card.key] = this._readTogglePath(
          parsed,
          card.togglePath,
          card.toggleDefault,
        );
      }
    }
    this._toggles = next;
  }

  /**
   * Read the client's localhost flag. When false, toggle
   * switches render disabled so remote participants can
   * see state but not change it. Defensive — if the RPC
   * is unavailable or returns an unexpected shape, we
   * leave _localhost at its True default (the backend
   * rejects the write anyway, so the worst case is a
   * disabled-toast response rather than a silent drop).
   */
  async _loadLocalhostFlag() {
    if (!this.rpcConnected) return;
    try {
      // LLMService.get_mode returns a dict; participants
      // can read it. The frontend has no dedicated
      // "am I localhost" RPC today, but get_mode is
      // universally callable and not relevant here — we
      // just want to detect if we're participants. The
      // collab popover surfaces the same info; reusing
      // its shape avoids a new RPC for this one card.
      //
      // For now we assume localhost=true. A future pass
      // can wire this to Collab.get_collab_role's shape
      // when the collab UI lands.
      this._localhost = true;
    } catch (err) {
      this._localhost = true;
    }
  }

  /**
   * Walk `obj` down a dot-separated path and return the
   * final value, or `fallback` when any segment is
   * missing or not an object.
   */
  _readTogglePath(obj, path, fallback) {
    if (!obj || typeof obj !== 'object') return fallback;
    const segments = String(path).split('.');
    let cursor = obj;
    for (const seg of segments) {
      if (
        cursor === null ||
        typeof cursor !== 'object' ||
        !(seg in cursor)
      ) {
        return fallback;
      }
      cursor = cursor[seg];
    }
    // Coerce to bool — matches backend semantics where
    // any truthy value flips the flag on.
    return Boolean(cursor);
  }

  /**
   * Write the new value into `obj` at `path`, creating
   * intermediate objects as needed. Returns the modified
   * obj (same reference — mutates in place).
   */
  _writeTogglePath(obj, path, value) {
    const segments = String(path).split('.');
    const leaf = segments.pop();
    let cursor = obj;
    for (const seg of segments) {
      if (
        cursor[seg] === null ||
        typeof cursor[seg] !== 'object' ||
        Array.isArray(cursor[seg])
      ) {
        cursor[seg] = {};
      }
      cursor = cursor[seg];
    }
    cursor[leaf] = value;
    return obj;
  }

  /**
   * Toggle click handler. Reads the current config JSON,
   * flips the value at togglePath, writes back via
   * save_config_content (which auto-triggers
   * reload_app_config for reloadable types — covers the
   * agents.enabled case where refresh_system_prompt has
   * to fire for the next turn to see the change).
   */
  async _onToggleClick(card) {
    if (!card || card.renderer !== 'toggle') return;
    if (!this._localhost) return;
    if (this._togglingKey) return;
    this._togglingKey = card.key;
    try {
      // Read current state of the underlying config.
      const readResult = await this.rpcExtract(
        'Settings.get_config_content',
        card.toggleConfigKey,
      );
      if (
        readResult &&
        typeof readResult === 'object' &&
        readResult.error
      ) {
        this._emitToast(readResult.error, 'error');
        return;
      }
      const content =
        typeof readResult === 'object' && readResult !== null
          ? readResult.content ?? ''
          : typeof readResult === 'string'
            ? readResult
            : '';
      let parsed;
      try {
        parsed = content.trim() ? JSON.parse(content) : {};
      } catch (err) {
        this._emitToast(
          `Cannot toggle: ${card.toggleConfigKey}.json ` +
            `is not valid JSON. Edit it directly to fix.`,
          'error',
        );
        return;
      }
      // Flip the value.
      const current = this._readTogglePath(
        parsed,
        card.togglePath,
        card.toggleDefault,
      );
      const next = !current;
      this._writeTogglePath(parsed, card.togglePath, next);
      // Write back.
      const newContent = JSON.stringify(parsed, null, 2) + '\n';
      const saveResult = await this.rpcExtract(
        'Settings.save_config_content',
        card.toggleConfigKey,
        newContent,
      );
      if (
        saveResult &&
        typeof saveResult === 'object' &&
        saveResult.error
      ) {
        this._emitToast(saveResult.error, 'error');
        return;
      }
      // Update local state (optimistic) — the reload below
      // refreshes the context manager's system prompt so the
      // agentic appendix takes effect on the NEXT turn rather
      // than being deferred two turns (one for the tracker to
      // notice the hash change, one for the prompt itself to
      // reach the LLM).
      this._toggles = { ...this._toggles, [card.key]: next };
      // Trigger the backend reload for the underlying config
      // type. For app.json this calls reload_app_config,
      // which invokes refresh_system_prompt on the LLM
      // service so the agents.enabled flag takes effect
      // immediately. save_config_content alone writes the
      // file but does not touch the runtime prompt cache.
      try {
        const reloadMethod =
          card.toggleConfigKey === 'litellm'
            ? 'Settings.reload_llm_config'
            : 'Settings.reload_app_config';
        const reloadResult = await this.rpcExtract(reloadMethod);
        if (
          reloadResult &&
          typeof reloadResult === 'object' &&
          reloadResult.error
        ) {
          this._emitToast(
            `Reload failed: ${reloadResult.error}`,
            'error',
          );
          return;
        }
      } catch (err) {
        this._emitToast(
          `Reload failed: ${err?.message || err}`,
          'error',
        );
        return;
      }
      this._emitToast(
        next ? `${card.label}: on` : `${card.label}: off`,
        'success',
      );
    } catch (err) {
      this._emitToast(
        `Toggle failed: ${err?.message || err}`,
        'error',
      );
    } finally {
      this._togglingKey = null;
    }
  }

  async _openCard(key) {
    // Toggle cards don't open an editor — their click
    // handler fires inline from the render path. A stray
    // _openCard call for a toggle card is a no-op.
    const card = CONFIG_CARDS.find((c) => c.key === key);
    if (card && card.renderer === 'toggle') return;
    if (this._activeKey === key) return;
    this._activeKey = key;
    this._editorContent = '';
    this._loading = true;
    try {
      const result = await this.rpcExtract(
        'Settings.get_config_content',
        key,
      );
      if (result && typeof result === 'object' && result.error) {
        this._emitToast(result.error, 'error');
        this._activeKey = null;
        return;
      }
      const content =
        typeof result === 'object' && result !== null
          ? result.content ?? ''
          : typeof result === 'string'
            ? result
            : '';
      this._editorContent = content;
    } catch (err) {
      this._emitToast(`Load failed: ${err?.message || err}`, 'error');
      this._activeKey = null;
    } finally {
      this._loading = false;
    }
  }

  _closeEditor() {
    this._activeKey = null;
    this._editorContent = '';
  }

  async _save() {
    if (!this._activeKey || this._saving) return;
    this._saving = true;
    try {
      const textarea = this.shadowRoot?.querySelector('.editor-textarea');
      const content = textarea ? textarea.value : this._editorContent;
      const result = await this.rpcExtract(
        'Settings.save_config_content',
        this._activeKey,
        content,
      );
      if (result && typeof result === 'object' && result.error) {
        this._emitToast(result.error, 'error');
        return;
      }
      // Advisory JSON warning from save.
      if (result && result.warning) {
        this._emitToast(result.warning, 'warning');
      } else {
        this._emitToast('Saved', 'success');
      }
      // Auto-reload for reloadable configs.
      const card = CONFIG_CARDS.find((c) => c.key === this._activeKey);
      if (card && card.reloadable) {
        await this._reload();
      }
    } catch (err) {
      this._emitToast(`Save failed: ${err?.message || err}`, 'error');
    } finally {
      this._saving = false;
    }
  }

  async _reload() {
    if (!this._activeKey) return;
    const card = CONFIG_CARDS.find((c) => c.key === this._activeKey);
    if (!card || !card.reloadable) return;
    const method =
      this._activeKey === 'litellm'
        ? 'Settings.reload_llm_config'
        : 'Settings.reload_app_config';
    try {
      const result = await this.rpcExtract(method);
      if (result && typeof result === 'object' && result.error) {
        this._emitToast(`Reload failed: ${result.error}`, 'error');
      } else {
        this._emitToast('Config reloaded', 'success');
      }
    } catch (err) {
      this._emitToast(`Reload failed: ${err?.message || err}`, 'error');
    }
  }

  _onEditorKeyDown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault();
      this._save();
    }
  }

  _emitToast(message, type = 'info') {
    window.dispatchEvent(
      new CustomEvent('ac-toast', {
        detail: { message, type },
        bubbles: false,
      }),
    );
  }

  render() {
    return html`
      ${this._info
        ? html`
            <div class="info-banner">
              <div class="info-row">
                <span class="info-label">Model:</span>
                <strong>${this._info.model || '—'}</strong>
              </div>
              ${this._info.smaller_model
                ? html`
                    <div class="info-row">
                      <span class="info-label">Smaller:</span>
                      <strong>${this._info.smaller_model}</strong>
                    </div>
                  `
                : ''}
              ${this._info.config_dir
                ? html`
                    <div class="info-row">
                      <span class="info-label">Config:</span>
                      <span>${this._info.config_dir}</span>
                    </div>
                  `
                : ''}
            </div>
          `
        : ''}

      <div class="card-grid">
        ${CONFIG_CARDS.map(
          (card) =>
            card.renderer === 'toggle'
              ? this._renderToggleCard(card)
              : html`
                  <div
                    class="card ${this._activeKey === card.key ? 'active' : ''}"
                    @click=${() => this._openCard(card.key)}
                    title="${card.label} (${card.format})"
                  >
                    <span class="card-icon">${card.icon}</span>
                    <span class="card-label">${card.label}</span>
                  </div>
                `,
        )}
      </div>

      ${this._activeKey ? this._renderEditor() : ''}
    `;
  }

  _renderToggleCard(card) {
    const state = this._toggles[card.key];
    const isLoaded = state !== undefined;
    const value = isLoaded ? state : Boolean(card.toggleDefault);
    const isDisabled =
      !this._localhost || this._togglingKey === card.key;
    const ariaLabel = `${card.label}: ${value ? 'on' : 'off'}`;
    const tooltip = card.description
      ? `${card.label} — ${card.description}`
      : card.label;
    return html`
      <div
        class="card toggle-card ${value ? 'toggle-on' : ''} ${
          isDisabled ? 'toggle-disabled' : ''
        }"
        title=${tooltip}
      >
        <span class="card-icon">${card.icon}</span>
        <span class="card-label">${card.label}</span>
        <button
          class="toggle-switch ${value ? 'on' : 'off'}"
          role="switch"
          aria-checked=${value ? 'true' : 'false'}
          aria-label=${ariaLabel}
          ?disabled=${isDisabled}
          title=${tooltip}
          @click=${(e) => {
            e.stopPropagation();
            this._onToggleClick(card);
          }}
        >
          <span class="toggle-track">
            <span class="toggle-thumb"></span>
          </span>
          <span class="toggle-state-label">
            ${value ? 'ON' : 'OFF'}
          </span>
        </button>
        ${!this._localhost
          ? html`<span class="toggle-readonly-note">
              Host controls this setting
            </span>`
          : ''}
      </div>
    `;
  }

  _renderEditor() {
    const card = CONFIG_CARDS.find((c) => c.key === this._activeKey);
    if (!card) return '';
    return html`
      <div class="editor-area">
        <div class="editor-toolbar">
          <span class="toolbar-label">
            ${card.icon} ${card.label}
          </span>
          ${card.reloadable
            ? html`
                <button
                  class="toolbar-button"
                  @click=${this._reload}
                  ?disabled=${!this.rpcConnected}
                  title="Reload config from disk"
                >
                  ↻ Reload
                </button>
              `
            : ''}
          <button
            class="toolbar-button primary"
            @click=${this._save}
            ?disabled=${this._saving || !this.rpcConnected}
            title="Save (Ctrl+S)"
          >
            💾 Save
          </button>
          <button
            class="toolbar-button"
            @click=${this._closeEditor}
            title="Close editor"
          >
            ✕
          </button>
        </div>
        ${this._loading
          ? html`<div class="loading-note">Loading…</div>`
          : html`
              <textarea
                class="editor-textarea"
                .value=${this._editorContent}
                @keydown=${this._onEditorKeyDown}
                spellcheck="false"
              ></textarea>
            `}
      </div>
    `;
  }
}

customElements.define('ac-settings-tab', SettingsTab);