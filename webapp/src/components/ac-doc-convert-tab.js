/**
 * Doc Convert tab — convert non-markdown documents to markdown.
 *
 * Layout: status banner, file list with checkboxes and status badges,
 * toolbar with select all / convert button, progress view during conversion.
 */

import { LitElement, html, css, nothing } from 'lit';
import { theme, scrollbarStyles } from '../styles/theme.js';
import { RpcMixin } from '../rpc-mixin.js';

const STATUS_BADGES = {
  new: { label: 'new', color: 'var(--accent-green)', icon: '🆕' },
  stale: { label: 'stale', color: 'var(--accent-orange)', icon: '🔄' },
  current: { label: 'current', color: 'var(--text-muted)', icon: '✓' },
  conflict: { label: 'conflict', color: 'var(--accent-red)', icon: '⚠️' },
};

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export class AcDocConvertTab extends RpcMixin(LitElement) {
  static properties = {
    _files: { type: Array, state: true },
    _selected: { type: Object, state: true },
    _clean: { type: Boolean, state: true },
    _cleanMessage: { type: String, state: true },
    _available: { type: Boolean, state: true },
    _converting: { type: Boolean, state: true },
    _conversionResults: { type: Array, state: true },
    _loading: { type: Boolean, state: true },
  };

  static styles = [theme, scrollbarStyles, css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    /* Status banner */
    .status-banner {
      padding: 10px 16px;
      font-size: 0.8rem;
      border-bottom: 1px solid var(--border-primary);
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .status-banner.clean {
      background: var(--bg-tertiary);
      color: var(--accent-green);
    }
    .status-banner.dirty {
      background: rgba(240, 136, 62, 0.08);
      color: var(--accent-orange);
    }
    .status-banner .icon { font-size: 1rem; }
    .status-banner .msg {
      color: var(--text-secondary);
      font-size: 0.78rem;
    }

    /* Toolbar */
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-bottom: 1px solid var(--border-primary);
      background: var(--bg-tertiary);
      flex-shrink: 0;
    }
    .toolbar-btn {
      background: none;
      border: 1px solid var(--border-primary);
      color: var(--text-secondary);
      font-size: 0.75rem;
      padding: 3px 10px;
      border-radius: var(--radius-sm);
      cursor: pointer;
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
    .toolbar-summary {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-left: auto;
    }

    /* File list */
    .file-list {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
      min-height: 0;
    }

    .file-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 16px;
      font-size: 0.78rem;
      cursor: pointer;
      transition: background 0.1s;
    }
    .file-row:hover {
      background: var(--bg-tertiary);
    }
    .file-row.current {
      opacity: 0.5;
    }
    .file-row.over-size {
      opacity: 0.6;
    }

    .file-row input[type="checkbox"] {
      margin: 0;
      cursor: pointer;
      flex-shrink: 0;
    }

    .file-path {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text-primary);
      font-family: var(--font-mono);
      font-size: 0.76rem;
    }

    .file-size {
      color: var(--text-muted);
      font-size: 0.7rem;
      flex-shrink: 0;
      min-width: 60px;
      text-align: right;
    }

    .file-badge {
      font-size: 0.65rem;
      padding: 1px 6px;
      border-radius: 3px;
      text-transform: uppercase;
      font-weight: 600;
      flex-shrink: 0;
      min-width: 52px;
      text-align: center;
    }

    .file-warning {
      font-size: 0.7rem;
      color: var(--accent-orange);
      flex-shrink: 0;
    }

    /* Progress view */
    .progress-view {
      flex: 1;
      overflow-y: auto;
      padding: 12px 16px;
      min-height: 0;
    }

    .progress-header {
      font-size: 0.85rem;
      color: var(--text-secondary);
      margin-bottom: 12px;
    }

    .progress-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
      font-size: 0.78rem;
    }
    .progress-item .status-icon { flex-shrink: 0; }
    .progress-item .path {
      flex: 1;
      color: var(--text-primary);
      font-family: var(--font-mono);
      font-size: 0.76rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .progress-item .status-text {
      color: var(--text-muted);
      font-size: 0.72rem;
      flex-shrink: 0;
    }
    .progress-item .error-text {
      color: var(--accent-red);
      font-size: 0.72rem;
    }

    .progress-summary {
      margin-top: 16px;
      padding: 10px 12px;
      background: var(--bg-tertiary);
      border-radius: var(--radius-md);
      font-size: 0.8rem;
      color: var(--text-secondary);
    }

    .progress-actions {
      margin-top: 12px;
      display: flex;
      gap: 8px;
    }

    /* Empty / loading states */
    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      color: var(--text-muted);
      font-size: 0.85rem;
      padding: 24px;
      text-align: center;
    }
  `];

  constructor() {
    super();
    this._files = [];
    this._selected = new Set();
    this._clean = true;
    this._cleanMessage = null;
    this._available = false;
    this._converting = false;
    this._conversionResults = null;
    this._loading = false;
  }

  onRpcReady() {
    this._scan();
  }

  onTabVisible() {
    // Refresh when tab becomes visible
    if (!this._converting) {
      this._scan();
    }
  }

  async _scan() {
    this._loading = true;
    try {
      const result = await this.rpcExtract('DocConvert.scan_convertible_files');
      if (!result) return;
      if (result.error) {
        console.warn('Scan failed:', result.error);
        return;
      }
      this._files = result.files || [];
      this._clean = result.clean !== false;
      this._cleanMessage = result.clean_message || null;
      this._available = result.available !== false;
      // Clear selection for files that no longer exist
      const paths = new Set(this._files.map(f => f.path));
      this._selected = new Set([...this._selected].filter(p => paths.has(p)));
    } catch (e) {
      console.warn('Scan failed:', e);
    } finally {
      this._loading = false;
    }
  }

  _toggleFile(path) {
    const next = new Set(this._selected);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    this._selected = next;
  }

  _selectAll() {
    this._selected = new Set(
      this._files
        .filter(f => f.status !== 'current' && !f.over_size)
        .map(f => f.path)
    );
  }

  _deselectAll() {
    this._selected = new Set();
  }

  async _convert() {
    if (this._selected.size === 0) return;
    if (this._converting) return;

    this._converting = true;
    this._conversionResults = [...this._selected].map(p => ({
      path: p,
      status: 'pending',
    }));

    try {
      const paths = [...this._selected];
      const result = await this.rpcExtract('DocConvert.convert_files', paths);
      if (!result) {
        this._conversionResults = [{
          path: 'all',
          status: 'failed',
          error: 'No response from server',
        }];
        return;
      }
      if (result.error) {
        this._conversionResults = [{
          path: 'all',
          status: 'failed',
          error: result.error,
        }];
        return;
      }
      this._conversionResults = result.results || [];
      this._conversionSummary = result.summary;

      // Refresh file picker tree
      window.dispatchEvent(new CustomEvent('files-modified', {
        detail: { paths: paths },
      }));
    } catch (e) {
      this._conversionResults = [{
        path: 'all',
        status: 'failed',
        error: e.message || 'Conversion failed',
      }];
    }
  }

  _backToList() {
    this._converting = false;
    this._conversionResults = null;
    this._selected = new Set();
    this._scan();
  }

  // === Render helpers ===

  _renderBanner() {
    if (this._clean) {
      return html`
        <div class="status-banner clean">
          <span class="icon">✅</span>
          <span>Working tree is clean — ready to convert</span>
        </div>
      `;
    }
    return html`
      <div class="status-banner dirty">
        <span class="icon">⚠️</span>
        <span class="msg">${this._cleanMessage || 'Commit or stash your changes before converting documents.'}</span>
      </div>
    `;
  }

  _renderToolbar() {
    const selectedCount = this._selected.size;
    const totalConvertible = this._files.filter(f => f.status !== 'current').length;

    return html`
      <div class="toolbar">
        <button class="toolbar-btn" @click=${this._selectAll}
          ?disabled=${!this._clean || this._files.length === 0}
          title="Select all convertible files">Select All</button>
        <button class="toolbar-btn" @click=${this._deselectAll}
          ?disabled=${selectedCount === 0}
          title="Deselect all">Deselect All</button>
        <span class="toolbar-summary">
          ${selectedCount} of ${totalConvertible} selected
        </span>
        <button class="toolbar-btn primary" @click=${this._convert}
          ?disabled=${!this._clean || selectedCount === 0}
          title="Convert selected files to markdown">
          📄 Convert (${selectedCount})
        </button>
      </div>
    `;
  }

  _renderFileRow(file) {
    const badge = STATUS_BADGES[file.status] || STATUS_BADGES.new;
    const isSelected = this._selected.has(file.path);
    const isDisabled = !this._clean || file.over_size;
    const rowClass = [
      'file-row',
      file.status === 'current' ? 'current' : '',
      file.over_size ? 'over-size' : '',
    ].filter(Boolean).join(' ');

    return html`
      <div class="${rowClass}" @click=${() => !isDisabled && this._toggleFile(file.path)}>
        <input type="checkbox"
          .checked=${isSelected}
          ?disabled=${isDisabled}
          @click=${(e) => e.stopPropagation()}
          @change=${() => this._toggleFile(file.path)}>
        <span class="file-path" title="${file.path}">${file.path}</span>
        <span class="file-size">${formatSize(file.size)}</span>
        <span class="file-badge" style="color: ${badge.color}; border: 1px solid ${badge.color}33;">
          ${badge.label}
        </span>
        ${file.over_size ? html`<span class="file-warning" title="Exceeds size limit">📏</span>` : nothing}
      </div>
    `;
  }

  _renderProgressView() {
    const results = this._conversionResults || [];
    const summary = this._conversionSummary;

    return html`
      <div class="progress-view">
        <div class="progress-header">
          ${summary ? 'Conversion complete' : 'Converting…'}
        </div>

        ${results.map(r => html`
          <div class="progress-item">
            <span class="status-icon">${
              r.status === 'converted' ? '✅' :
              r.status === 'failed' ? '❌' :
              r.status === 'skipped' ? '⏭️' :
              '⏳'
            }</span>
            <span class="path">${r.path}</span>
            ${r.status === 'converted' ? html`
              <span class="status-text">→ ${r.output_path}</span>
            ` : r.error ? html`
              <span class="error-text">${r.error}</span>
            ` : html`
              <span class="status-text">${r.status}</span>
            `}
          </div>
        `)}

        ${summary ? html`
          <div class="progress-summary">
            Converted ${summary.converted} file${summary.converted !== 1 ? 's' : ''}.
            ${summary.failed ? ` ${summary.failed} failed.` : ''}
            ${summary.skipped ? ` ${summary.skipped} skipped.` : ''}
          </div>
          <div class="progress-actions">
            <button class="toolbar-btn primary" @click=${this._backToList}>
              ← Back to file list
            </button>
          </div>
        ` : nothing}
      </div>
    `;
  }

  render() {
    if (!this._available) {
      return html`
        <div class="empty-state">
          markitdown is not installed.<br>
          Install with: <code>pip install ac-dc[docs]</code>
        </div>
      `;
    }

    if (this._loading && this._files.length === 0) {
      return html`<div class="empty-state">Scanning for convertible files…</div>`;
    }

    if (this._converting || this._conversionResults) {
      return html`
        ${this._renderBanner()}
        ${this._renderProgressView()}
      `;
    }

    if (this._files.length === 0) {
      return html`
        ${this._renderBanner()}
        <div class="empty-state">No convertible documents found in the repository.</div>
      `;
    }

    return html`
      ${this._renderBanner()}
      ${this._renderToolbar()}
      <div class="file-list">
        ${this._files.map(f => this._renderFileRow(f))}
      </div>
    `;
  }
}

customElements.define('ac-doc-convert-tab', AcDocConvertTab);