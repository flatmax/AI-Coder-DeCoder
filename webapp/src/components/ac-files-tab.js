/**
 * AcFilesTab — orchestration hub for file picker and chat panel.
 *
 * Contains the file picker (left) and chat panel (right) in a
 * split layout with a draggable resizer.
 */

import { LitElement, html, css } from 'lit';
import { RpcMixin } from '../utils/rpc-mixin.js';
import './ac-file-picker.js';

export class AcFilesTab extends RpcMixin(LitElement) {
  static properties = {
    _selectedFiles: { type: Array, state: true },
    _excludedFiles: { type: Array, state: true },
    _messages: { type: Array, state: true },
    _pickerWidth: { type: Number, state: true },
    _pickerCollapsed: { type: Boolean, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .picker-panel {
      flex-shrink: 0;
      overflow: hidden;
      border-right: 1px solid var(--border-primary);
      display: flex;
      flex-direction: column;
    }

    .picker-panel.collapsed {
      width: 0 !important;
      border-right: none;
    }

    .resizer {
      width: 4px;
      cursor: ew-resize;
      background: transparent;
      flex-shrink: 0;
      position: relative;
    }
    .resizer:hover { background: var(--accent-primary); opacity: 0.3; }

    .resizer-toggle {
      position: absolute;
      top: 50%;
      left: -8px;
      transform: translateY(-50%);
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      border-radius: 4px;
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 0.7rem;
      padding: 2px 4px;
      z-index: 5;
    }
    .resizer-toggle:hover { color: var(--text-primary); }

    .chat-panel {
      flex: 1;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    /* Placeholder content */
    .placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      color: var(--text-muted);
      font-size: 0.9rem;
    }
  `;

  constructor() {
    super();
    this._selectedFiles = [];
    this._excludedFiles = [];
    this._messages = [];
    this._pickerWidth = parseInt(localStorage.getItem('ac-dc-picker-width') || '280', 10);
    this._pickerCollapsed = localStorage.getItem('ac-dc-picker-collapsed') === 'true';
    this._resizing = false;
    // Cached Set instances to avoid re-creating on every render
    this._selectedSet = new Set();
    this._excludedSet = new Set();
  }

  connectedCallback() {
    super.connectedCallback();
    this._stateHandler = this._onStateLoaded.bind(this);
    window.addEventListener('state-loaded', this._stateHandler);
    this._filesChangedHandler = this._onFilesChanged.bind(this);
    window.addEventListener('files-changed', this._filesChangedHandler);
    this._filesModifiedHandler = this._onFilesModified.bind(this);
    window.addEventListener('files-modified', this._filesModifiedHandler);
    this._filterFromChatHandler = this._onFilterFromChat.bind(this);
    window.addEventListener('filter-from-chat', this._filterFromChatHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('state-loaded', this._stateHandler);
    window.removeEventListener('files-changed', this._filesChangedHandler);
    window.removeEventListener('files-modified', this._filesModifiedHandler);
    window.removeEventListener('filter-from-chat', this._filterFromChatHandler);
  }

  _onStateLoaded(e) {
    const state = e.detail;
    if (state?.selected_files) {
      this._selectedFiles = [...state.selected_files];
      this._updateSelectedSet();
    }
    if (state?.excluded_index_files) {
      this._excludedFiles = [...state.excluded_index_files];
      this._updateExcludedSet();
    }
    if (state?.messages) {
      this._messages = [...state.messages];
    }
    // Sync picker after tree loads
    requestAnimationFrame(() => {
      const picker = this.shadowRoot?.querySelector('ac-file-picker');
      if (picker) {
        picker.selectedFiles = this._selectedSet;
        picker.excludedFiles = this._excludedSet;
        picker.requestUpdate();
      }
    });
  }

  _onFilesChanged(e) {
    if (e.detail?.selectedFiles) {
      this._selectedFiles = [...e.detail.selectedFiles];
      this._updateSelectedSet();
      const picker = this.shadowRoot?.querySelector('ac-file-picker');
      if (picker) {
        picker.selectedFiles = this._selectedSet;
        picker.requestUpdate();
      }
    }
  }

  _onFilesModified(e) {
    const picker = this.shadowRoot?.querySelector('ac-file-picker');
    if (picker) picker.loadTree();
  }

  _onFilterFromChat(e) {
    const picker = this.shadowRoot?.querySelector('ac-file-picker');
    if (picker) picker.setFilter(e.detail?.query || '');
  }

  // ── Cached Set helpers ───────────────────────────────────────

  _updateSelectedSet() {
    this._selectedSet = new Set(this._selectedFiles);
  }

  _updateExcludedSet() {
    this._excludedSet = new Set(this._excludedFiles);
  }

  // ── Selection change from picker ─────────────────────────────

  async _onSelectionChanged(e) {
    const files = e.detail?.files || [];
    this._selectedFiles = files;
    this._updateSelectedSet();
    // Notify server
    try {
      await this.rpcExtract('LLMService.set_selected_files', files);
    } catch (err) {
      console.warn('Failed to set selected files:', err);
    }
  }

  async _onExclusionChanged(e) {
    const files = e.detail?.files || [];
    this._excludedFiles = files;
    this._updateExcludedSet();
    try {
      await this.rpcExtract('LLMService.set_excluded_index_files', files);
    } catch (err) {
      console.warn('Failed to set excluded files:', err);
    }
  }

  // ── File click from picker ───────────────────────────────────

  _onFileClicked(e) {
    const { path } = e.detail || {};
    if (!path) return;
    window.dispatchEvent(new CustomEvent('navigate-file', {
      detail: { path },
    }));
  }

  _onInsertPath(e) {
    // Relay to chat panel for middle-click path insertion
    // (Will be wired to chat panel in the next phase)
  }

  // ── Picker panel resize ──────────────────────────────────────

  _onResizerPointerDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    this._resizing = true;
    const startX = e.clientX;
    const startW = this._pickerWidth;

    const onMove = (me) => {
      const dx = me.clientX - startX;
      this._pickerWidth = Math.max(150, Math.min(500, startW + dx));
    };

    const onUp = () => {
      this._resizing = false;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      localStorage.setItem('ac-dc-picker-width', String(this._pickerWidth));
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  _togglePicker() {
    this._pickerCollapsed = !this._pickerCollapsed;
    localStorage.setItem('ac-dc-picker-collapsed', String(this._pickerCollapsed));
  }

  render() {
    const pw = this._pickerCollapsed ? 0 : this._pickerWidth;

    return html`
      <div class="picker-panel ${this._pickerCollapsed ? 'collapsed' : ''}"
           style="width: ${pw}px">
        <ac-file-picker
          .selectedFiles=${this._selectedSet}
          .excludedFiles=${this._excludedSet}
          @selection-changed=${this._onSelectionChanged}
          @exclusion-changed=${this._onExclusionChanged}
          @file-clicked=${this._onFileClicked}
          @insert-path=${this._onInsertPath}
        ></ac-file-picker>
      </div>

      <div class="resizer"
           @pointerdown=${this._onResizerPointerDown}>
        <button class="resizer-toggle"
                @click=${this._togglePicker}>
          ${this._pickerCollapsed ? '▶' : '◀'}
        </button>
      </div>

      <div class="chat-panel">
        <div class="placeholder">💬 Chat Panel (coming soon)</div>
      </div>
    `;
  }
}

customElements.define('ac-files-tab', AcFilesTab);