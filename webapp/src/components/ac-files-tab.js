/**
 * AcFilesTab — orchestration hub for file picker and chat panel.
 *
 * Contains the file picker (left) and chat panel (right) in a
 * split layout with a draggable resizer.
 */

import { LitElement, html, css } from 'lit';
import { RpcMixin } from '../utils/rpc-mixin.js';

export class AcFilesTab extends RpcMixin(LitElement) {
  static properties = {
    _selectedFiles: { type: Array, state: true },
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
    this._messages = [];
    this._pickerWidth = parseInt(localStorage.getItem('ac-dc-picker-width') || '280', 10);
    this._pickerCollapsed = localStorage.getItem('ac-dc-picker-collapsed') === 'true';
  }

  connectedCallback() {
    super.connectedCallback();
    this._stateHandler = this._onStateLoaded.bind(this);
    window.addEventListener('state-loaded', this._stateHandler);
    this._filesChangedHandler = this._onFilesChanged.bind(this);
    window.addEventListener('files-changed', this._filesChangedHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('state-loaded', this._stateHandler);
    window.removeEventListener('files-changed', this._filesChangedHandler);
  }

  _onStateLoaded(e) {
    const state = e.detail;
    if (state?.selected_files) {
      this._selectedFiles = [...state.selected_files];
    }
    if (state?.messages) {
      this._messages = [...state.messages];
    }
  }

  _onFilesChanged(e) {
    if (e.detail?.selectedFiles) {
      this._selectedFiles = [...e.detail.selectedFiles];
    }
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
        <div class="placeholder">📁 File Picker (coming soon)</div>
      </div>

      <div class="resizer">
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