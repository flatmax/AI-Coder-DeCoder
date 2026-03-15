/**
 * AcDocConvertTab — document conversion dialog tab.
 *
 * Scans repo for convertible files, shows status badges,
 * allows selective conversion with clean-tree gate.
 */

import { LitElement, html, css } from 'lit';
import { RpcMixin } from '../utils/rpc-mixin.js';

export class AcDocConvertTab extends RpcMixin(LitElement) {
  static properties = {
    _files: { type: Array, state: true },
    _clean: { type: Boolean, state: true },
    _message: { type: String, state: true },
    _selected: { type: Object, state: true },
    _converting: { type: Boolean, state: true },
    _results: { type: Array, state: true },
    _filter: { type: String, state: true },
    _loading: { type: Boolean, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
      font-size: 0.82rem;
    }

    .status-banner {
      padding: 8px 12px;
      font-size: 0.8rem;
      border-bottom: 1px solid var(--border-primary);
      flex-shrink: 0;
    }
    .status-banner.clean { color: var(--accent-green); }
    .status-banner.dirty { color: var(--accent-orange); }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      border-bottom: 1px solid var(--border-primary);
      flex-shrink: 0;
    }
    .toolbar-btn {
      background: none;
      border: 1px solid var(--border-primary);
      border-radius: 4px;
      color: var(--text-secondary);
      cursor: pointer;
      padding: 3px 8px;
      font-size: 0.75rem;
    }
    .toolbar-btn:hover { color: var(--text-primary); background: var(--bg-tertiary); }
    .toolbar-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .toolbar-btn.primary {
      border-color: var(--accent-primary);
      color: var(--accent-primary);
    }
    .toolbar-btn.primary:hover { background: rgba(79, 195, 247, 0.1); }
    .toolbar-count {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-left: auto;
    }

    .filter-bar {
      padding: 4px 8px;
      border-bottom: 1px solid var(--border-primary);
      flex-shrink: 0;
    }
    .filter-input {
      width: 100%;
      background: var(--bg-input);
      border: 1px solid var(--border-secondary);
      border-radius: 4px;
      color: var(--text-primary);
      padding: 4px 8px;
      font-size: 0.78rem;
      outline: none;
    }
    .filter-input:focus { border-color: var(--accent-primary); }

    .file-list {
      flex: 1;
      overflow-y: auto;
      padding: 4px;
    }

    .file-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border-radius: 4px;
      cursor: default;
    }
    .file-row:hover { background: var(--bg-tertiary); }
    .file-row input[type="checkbox"] {
      width: 14px; height: 14px; margin: 0;
      accent-color: var(--accent-primary);
      cursor: pointer;
    }

    .file-path {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text-primary);
      font-size: 0.78rem;
    }
    .file-size {
      font-size: 0.7rem;
      color: var(--text-muted);
      min-width: 50px;
      text-align: right;
    }

    .badge {
      font-size: 0.65rem;
      font-weight: 600;
      padding: 1px 5px;
      border-radius: 3px;
    }
    .badge.new { color: var(--accent-green); }
    .badge.stale { color: var(--accent-orange); }
    .badge.current { color: var(--text-muted); }
    .badge.conflict { color: var(--accent-red); }
    .badge.oversize { color: var(--text-muted); }

    .file-row.current { opacity: 0.6; }

    /* Progress / results view */
    .progress-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }
    .progress-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 0;
      font-size: 0.78rem;
    }
    .progress-icon { width: 20px; text-align: center; }
    .progress-path { flex: 1; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .progress-status { font-size: 0.75rem; color: var(--text-secondary); }
    .progress-error { font-size: 0.72rem; color: var(--accent-red); }

    .summary {
      padding: 8px 12px;
      border-top: 1px solid var(--border-primary);
      font-size: 0.8rem;
      color: var(--text-secondary);
      flex-shrink: 0;
    }

    .empty-state {
      display: flex;
      flex: 1;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      padding: 40px;
      text-align: center;
    }
  `;

  constructor() {
    super();
    this._files = [];
    this._clean = true;
    this._message = '';
    this._selected = new Set();
    this._converting = false;
    this._results = null;
    this._filter = '';
    this._loading = false;
  }

  onRpcReady() {
    this._scan();
  }

  onTabVisible() {
    this._scan();
  }

  async _scan() {
    this._loading = true;
    this._results = null;
    try {
      const data = await this.rpcExtract('DocConvert.scan_convertible_files');
      this._files = data?.files || [];
      this._clean = data?.clean ?? true;
      this._message = data?.message || '';
    } catch (e) {
      console.warn('Doc convert scan failed:', e);
      this._files = [];
    }
    this._loading = false;
  }

  _filtered() {
    if (!this._filter) return this._files;
    const q = this._filter.toLowerCase();
    return this._files.filter(f => {
      const t = f.path.toLowerCase();
      let qi = 0;
      for (let ti = 0; ti < t.length && qi < q.length; ti++) {
        if (t[ti] === q[qi]) qi++;
      }
      return qi === q.length;
    });
  }

  _toggleFile(path) {
    const next = new Set(this._selected);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    this._selected = next;
  }

  _selectAll() {
    const filtered = this._filtered();
    this._selected = new Set(filtered.map(f => f.path));
  }

  _deselectAll() {
    this._selected = new Set();
  }

  async _convert() {
    if (!this._selected.size || !this._clean) return;
    this._converting = true;
    this._results = [...this._selected].map(p => ({ path: p, status: 'pending' }));

    try {
      const results = await this.rpcExtract('DocConvert.convert_files', [...this._selected]);
      this._results = results || [];
    } catch (e) {
      this._results = [...this._selected].map(p => ({
        path: p, status: 'error', message: String(e),
      }));
    }
    this._converting = false;
    // Refresh file tree
    window.dispatchEvent(new CustomEvent('files-modified', { detail: {} }));
  }

  _fmtSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  render() {
    if (this._loading && !this._files.length) {
      return html`<div class="empty-state">Scanning for convertible files...</div>`;
    }

    if (!this._files.length && !this._results) {
      return html`<div class="empty-state">No convertible documents found</div>`;
    }

    // Show results view during/after conversion
    if (this._results) {
      return this._renderResults();
    }

    const filtered = this._filtered();
    const selCount = [...this._selected].filter(p => filtered.some(f => f.path === p)).length;

    return html`
      <div class="status-banner ${this._clean ? 'clean' : 'dirty'}">
        ${this._clean ? '✅ Working tree clean' : `⚠️ ${this._message}`}
      </div>

      <div class="toolbar">
        <button class="toolbar-btn" @click=${this._selectAll}>Select All</button>
        <button class="toolbar-btn" @click=${this._deselectAll}>Deselect All</button>
        <span class="toolbar-count">${selCount} of ${filtered.length} selected</span>
        <button class="toolbar-btn primary"
                ?disabled=${!selCount || !this._clean || this._converting}
                @click=${this._convert}>
          Convert Selected (${selCount})
        </button>
      </div>

      <div class="filter-bar">
        <input class="filter-input"
               type="text"
               placeholder="Filter files..."
               .value=${this._filter}
               @input=${(e) => { this._filter = e.target.value; }}>
      </div>

      <div class="file-list">
        ${filtered.map(f => html`
          <div class="file-row ${f.status === 'current' ? 'current' : ''}"
               title="${f.path} → ${f.output_path || ''}">
            <input type="checkbox"
                   .checked=${this._selected.has(f.path)}
                   ?disabled=${!this._clean || f.over_size}
                   @change=${() => this._toggleFile(f.path)}>
            <span class="file-path">${f.path}</span>
            <span class="badge ${f.status}">${f.status}</span>
            ${f.over_size ? html`<span class="badge oversize" title="Exceeds size limit">📏</span>` : ''}
            <span class="file-size">${this._fmtSize(f.size)}</span>
          </div>
        `)}
      </div>
    `;
  }

  _renderResults() {
    const done = this._results.filter(r => r.status !== 'pending').length;
    const ok = this._results.filter(r => r.status === 'ok').length;
    const failed = this._results.filter(r => r.status === 'error').length;

    return html`
      <div class="progress-list">
        ${this._results.map(r => html`
          <div class="progress-item">
            <span class="progress-icon">
              ${r.status === 'pending' ? '⏳' :
                r.status === 'ok' ? '✅' : '❌'}
            </span>
            <span class="progress-path" title="${r.path}">${r.path}</span>
            ${r.output_path ? html`
              <span class="progress-status" title="${r.output_path}">→ ${r.output_path}</span>
            ` : ''}
            ${r.message ? html`
              <span class="progress-error" title="${r.message}">${r.message}</span>
            ` : ''}
          </div>
        `)}
      </div>

      <div class="summary">
        ${this._converting ? 'Converting...' :
          `Converted ${ok} file${ok !== 1 ? 's' : ''}. ${failed ? `${failed} failed.` : ''}`}
        <button class="toolbar-btn" style="margin-left:8px"
                ?disabled=${this._converting}
                @click=${() => this._scan()}>
          Back to file list
        </button>
      </div>
    `;
  }
}

customElements.define('ac-doc-convert-tab', AcDocConvertTab);