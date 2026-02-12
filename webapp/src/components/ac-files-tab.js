/**
 * Files & Chat tab — the default tab.
 *
 * Left panel: file picker. Right panel: chat.
 * Separated by a draggable resizer.
 */

import { LitElement, html, css } from 'lit';
import { theme, scrollbarStyles } from '../styles/theme.js';
import { RpcMixin } from '../rpc-mixin.js';

// Import child components
import './chat-panel.js';
import './file-picker.js';

const DEFAULT_PICKER_WIDTH = 280;
const MIN_PICKER_WIDTH = 150;
const MAX_PICKER_WIDTH = 500;
const STORAGE_KEY_WIDTH = 'ac-dc-picker-width';
const STORAGE_KEY_COLLAPSED = 'ac-dc-picker-collapsed';

export class AcFilesTab extends RpcMixin(LitElement) {
  static properties = {
    _pickerWidth: { type: Number, state: true },
    _pickerCollapsed: { type: Boolean, state: true },
    _selectedFiles: { type: Array, state: true },
    _messages: { type: Array, state: true },
    _streamingActive: { type: Boolean, state: true },
  };

  static styles = [theme, scrollbarStyles, css`
    :host {
      display: flex;
      flex-direction: row;
      height: 100%;
      overflow: hidden;
    }

    /* File picker panel */
    .picker-panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      background: var(--bg-primary);
      border-right: 1px solid var(--border-primary);
      overflow: hidden;
      flex-shrink: 0;
    }
    .picker-panel.collapsed {
      width: 0 !important;
      border-right: none;
    }

    .picker-panel ac-file-picker {
      flex: 1;
      min-height: 0;
    }

    /* Resizer */
    .resizer {
      width: 4px;
      cursor: col-resize;
      background: transparent;
      flex-shrink: 0;
      position: relative;
    }
    .resizer:hover,
    .resizer.dragging {
      background: var(--accent-primary);
      opacity: 0.3;
    }

    .collapse-btn {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      color: var(--text-muted);
      font-size: 0.6rem;
      width: 16px;
      height: 32px;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .resizer:hover .collapse-btn,
    .collapse-btn:hover {
      opacity: 1;
    }

    /* Chat panel */
    .chat-panel {
      flex: 1;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .chat-panel > * {
      flex: 1;
      min-height: 0;
    }
  `];

  constructor() {
    super();
    this._pickerWidth = this._loadWidth();
    this._pickerCollapsed = this._loadCollapsed();
    this._selectedFiles = [];
    this._messages = [];
    this._streamingActive = false;
    this._isDragging = false;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('state-loaded', (e) => this._onStateLoaded(e));
    window.addEventListener('files-changed', (e) => this._onFilesChanged(e));
  }

  onRpcReady() {
    // State will be loaded via state-loaded event from app-shell
    // File picker loads its own tree via onRpcReady
  }

  _onFilesChanged(e) {
    const files = e.detail?.selectedFiles;
    if (Array.isArray(files)) {
      this._selectedFiles = files;
    }
  }

  _onSelectionChanged(e) {
    const files = e.detail?.selectedFiles || [];
    this._selectedFiles = files;
    // Notify server
    if (this.rpcConnected) {
      this.rpcCall('LLMService.set_selected_files', files).catch(() => {});
    }
    // Force chat panel to re-render file mentions with updated selection
    const chatPanel = this.shadowRoot?.querySelector('ac-chat-panel');
    if (chatPanel) {
      chatPanel.requestUpdate();
    }
  }

  _onFileClicked(e) {
    const path = e.detail?.path;
    if (path) {
      // Dispatch on window so app shell can route to diff viewer
      window.dispatchEvent(new CustomEvent('navigate-file', {
        detail: { path },
      }));
    }
  }

  _onInsertPath(e) {
    const path = e.detail?.path;
    if (!path) return;
    const chatPanel = this.shadowRoot?.querySelector('ac-chat-panel');
    if (chatPanel) {
      const textarea = chatPanel.shadowRoot?.querySelector('.input-textarea');
      if (textarea) {
        const start = textarea.selectionStart;
        const before = textarea.value.slice(0, start);
        const after = textarea.value.slice(textarea.selectionEnd);
        const pad = before.length > 0 && !before.endsWith(' ') ? ' ' : '';
        const padAfter = after.length > 0 && !after.startsWith(' ') ? ' ' : '';
        textarea.value = before + pad + path + padAfter + after;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        const newPos = start + pad.length + path.length + padAfter.length;
        textarea.setSelectionRange(newPos, newPos);
        textarea.focus();
      }
    }
  }

  _onFilterFromChat(e) {
    const filter = e.detail?.filter || '';
    const picker = this.shadowRoot?.querySelector('ac-file-picker');
    if (picker) {
      picker.setFilter(filter);
    }
  }

  _onFileMentionClick(e) {
    const path = e.detail?.path;
    if (!path) return;

    let newFiles;
    if (this._selectedFiles.includes(path)) {
      // Already selected → remove from selection
      newFiles = this._selectedFiles.filter(f => f !== path);
    } else {
      // Not selected → add to selection
      newFiles = [...this._selectedFiles, path];

      // Accumulate text in chat input (only on add)
      const chatPanel = this.shadowRoot?.querySelector('ac-chat-panel');
      if (chatPanel) {
        chatPanel.accumulateFileInInput(path);
      }
    }

    // Update selection state
    this._selectedFiles = newFiles;

    // Directly update picker's selectedFiles and force re-render
    const picker = this.shadowRoot?.querySelector('ac-file-picker');
    if (picker) {
      picker.selectedFiles = new Set(newFiles);
      picker.requestUpdate();
    }

    // Force chat panel to re-render file mentions with updated selection
    const chatPanel = this.shadowRoot?.querySelector('ac-chat-panel');
    if (chatPanel) {
      chatPanel.requestUpdate();
    }

    // Notify server
    if (this.rpcConnected) {
      this.rpcCall('LLMService.set_selected_files', newFiles).catch(() => {});
    }

    // Navigate to the file in diff viewer
    window.dispatchEvent(new CustomEvent('navigate-file', {
      detail: { path },
    }));
  }

  _onFilesModified(e) {
    const picker = this.shadowRoot?.querySelector('ac-file-picker');
    if (picker) {
      picker.loadTree();
    }
    // Re-dispatch on window so app shell can route to diff viewer
    window.dispatchEvent(new CustomEvent('files-modified', {
      detail: e.detail,
    }));
  }

  _onStateLoaded(e) {
    const state = e.detail;
    if (state) {
      this._messages = state.messages || [];
      this._selectedFiles = state.selected_files || [];
      this._streamingActive = state.streaming_active || false;

      // Sync file picker selection
      requestAnimationFrame(() => {
        const picker = this.shadowRoot?.querySelector('ac-file-picker');
        if (picker && this._selectedFiles.length > 0) {
          picker.selectedFiles = new Set(this._selectedFiles);
        }
      });
    }
  }

  // === Persistence ===

  _loadWidth() {
    try {
      const v = localStorage.getItem(STORAGE_KEY_WIDTH);
      return v ? Math.max(MIN_PICKER_WIDTH, Math.min(MAX_PICKER_WIDTH, parseInt(v))) : DEFAULT_PICKER_WIDTH;
    } catch { return DEFAULT_PICKER_WIDTH; }
  }

  _loadCollapsed() {
    try {
      return localStorage.getItem(STORAGE_KEY_COLLAPSED) === 'true';
    } catch { return false; }
  }

  _saveWidth(w) {
    try { localStorage.setItem(STORAGE_KEY_WIDTH, String(w)); } catch {}
  }

  _saveCollapsed(c) {
    try { localStorage.setItem(STORAGE_KEY_COLLAPSED, String(c)); } catch {}
  }

  // === Resize ===

  _onResizeStart(e) {
    e.preventDefault();
    this._isDragging = true;
    const startX = e.clientX;
    const startWidth = this._pickerWidth;

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const newWidth = Math.max(MIN_PICKER_WIDTH, Math.min(MAX_PICKER_WIDTH, startWidth + dx));
      this._pickerWidth = newWidth;
    };

    const onUp = () => {
      this._isDragging = false;
      this._saveWidth(this._pickerWidth);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  _toggleCollapse() {
    this._pickerCollapsed = !this._pickerCollapsed;
    this._saveCollapsed(this._pickerCollapsed);
  }

  render() {
    return html`
      <div
        class="picker-panel ${this._pickerCollapsed ? 'collapsed' : ''}"
        style="width: ${this._pickerCollapsed ? 0 : this._pickerWidth}px"
      >
        <ac-file-picker
          .selectedFiles=${new Set(this._selectedFiles)}
          @selection-changed=${this._onSelectionChanged}
          @file-clicked=${this._onFileClicked}
          @insert-path=${this._onInsertPath}
        ></ac-file-picker>
      </div>

      <div
        class="resizer ${this._isDragging ? 'dragging' : ''}"
        @mousedown=${this._onResizeStart}
      >
        <button class="collapse-btn" @click=${this._toggleCollapse}
          title="${this._pickerCollapsed ? 'Expand' : 'Collapse'} file picker">
          ${this._pickerCollapsed ? '▶' : '◀'}
        </button>
      </div>

      <div class="chat-panel">
        <ac-chat-panel
          .messages=${this._messages}
          .selectedFiles=${this._selectedFiles}
          .streamingActive=${this._streamingActive}
          @files-modified=${this._onFilesModified}
          @filter-from-chat=${this._onFilterFromChat}
          @file-mention-click=${this._onFileMentionClick}
        ></ac-chat-panel>
      </div>
    `;
  }
}

customElements.define('ac-files-tab', AcFilesTab);