/**
 * AcFilePicker — tree view of repository files with checkboxes,
 * git status badges, context menu, and fuzzy filtering.
 */

import { LitElement, html, css, nothing } from 'lit';
import { RpcMixin } from '../utils/rpc-mixin.js';
import { fuzzyMatch, nodeMatchesFilter, relPath, lineColor, sortChildren } from '../utils/file-picker-utils.js';

// Git status badge config
const STATUS_BADGES = {
  modified: { label: 'M', color: 'var(--accent-orange)' },
  staged: { label: 'S', color: 'var(--accent-green)' },
  untracked: { label: 'U', color: 'var(--accent-green)' },
  deleted: { label: 'D', color: 'var(--accent-red)' },
};

export class AcFilePicker extends RpcMixin(LitElement) {
  static properties = {
    selectedFiles: { type: Object },      // Set<string> — relative paths
    excludedFiles: { type: Object },      // Set<string> — excluded from index
    _tree: { type: Object, state: true },
    _modified: { type: Array, state: true },
    _staged: { type: Array, state: true },
    _untracked: { type: Array, state: true },
    _deleted: { type: Array, state: true },
    _diffStats: { type: Object, state: true },
    _expanded: { type: Object, state: true },
    _filter: { type: String, state: true },
    _focusIndex: { type: Number, state: true },
    _branchName: { type: String, state: true },
    _branchDetached: { type: Boolean, state: true },
    _contextMenu: { type: Object, state: true },
    _inlineInput: { type: Object, state: true },
    _activeFile: { type: String, state: true },
    _initialAutoSelect: { type: Boolean, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
      font-size: 0.8rem;
    }

    /* Filter bar */
    .filter-bar {
      padding: 4px 6px;
      border-bottom: 1px solid var(--border-primary);
      flex-shrink: 0;
    }
    .filter-bar input {
      width: 100%;
      background: var(--bg-input);
      border: 1px solid var(--border-secondary);
      border-radius: 4px;
      color: var(--text-primary);
      padding: 4px 8px;
      font-size: 0.78rem;
      outline: none;
    }
    .filter-bar input:focus {
      border-color: var(--accent-primary);
    }

    /* Tree container */
    .tree {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
    }

    /* Tree row */
    .row {
      display: flex;
      align-items: center;
      padding: 1px 4px;
      cursor: pointer;
      white-space: nowrap;
      height: 24px;
      gap: 3px;
      position: relative;
    }
    .row:hover { background: var(--bg-tertiary); }
    .row.focused { background: var(--bg-tertiary); outline: 1px solid var(--accent-primary); outline-offset: -1px; }
    .row.active-in-viewer { background: rgba(79, 195, 247, 0.08); border-left: 2px solid var(--accent-primary); }

    /* Checkbox */
    .row input[type="checkbox"] {
      width: 14px;
      height: 14px;
      margin: 0;
      flex-shrink: 0;
      accent-color: var(--accent-primary);
      cursor: pointer;
    }

    /* Expand toggle */
    .toggle {
      width: 16px;
      text-align: center;
      font-size: 0.7rem;
      color: var(--text-muted);
      flex-shrink: 0;
      user-select: none;
    }

    /* Name */
    .name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--text-primary);
    }
    .name.excluded {
      text-decoration: line-through;
      opacity: 0.45;
    }
    .name.dir { color: var(--accent-primary); font-weight: 500; }

    /* Badges area */
    .badges {
      display: flex;
      gap: 3px;
      align-items: center;
      flex-shrink: 0;
    }
    .badge {
      font-size: 0.65rem;
      font-weight: 600;
      padding: 0 3px;
      border-radius: 3px;
      line-height: 1.4;
    }
    .line-count {
      font-size: 0.65rem;
      font-variant-numeric: tabular-nums;
    }
    .diff-stat {
      font-size: 0.6rem;
      font-variant-numeric: tabular-nums;
    }
    .diff-add { color: var(--accent-green); }
    .diff-del { color: var(--accent-red); }

    /* Branch badge */
    .branch-badge {
      font-size: 0.7rem;
      padding: 1px 6px;
      border-radius: 8px;
      border: 1px solid var(--border-primary);
      color: var(--text-secondary);
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .branch-badge.detached {
      color: var(--accent-orange);
      border-color: var(--accent-orange);
    }

    /* Excluded badge */
    .excluded-badge {
      font-size: 0.65rem;
      color: var(--accent-red);
    }

    /* Context menu */
    .context-menu {
      position: fixed;
      z-index: 200;
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: 6px;
      padding: 4px 0;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      min-width: 160px;
    }
    .context-menu-item {
      padding: 5px 14px;
      cursor: pointer;
      font-size: 0.8rem;
      color: var(--text-primary);
    }
    .context-menu-item:hover { background: var(--bg-tertiary); }
    .context-menu-sep {
      height: 1px;
      background: var(--border-primary);
      margin: 3px 0;
    }

    /* Inline input for rename / new file */
    .inline-input {
      width: 100%;
      background: var(--bg-input);
      border: 1px solid var(--accent-primary);
      border-radius: 3px;
      color: var(--text-primary);
      padding: 2px 6px;
      font-size: 0.78rem;
      outline: none;
    }
  `;

  constructor() {
    super();
    this.selectedFiles = new Set();
    this.excludedFiles = new Set();
    this._tree = null;
    this._modified = [];
    this._staged = [];
    this._untracked = [];
    this._deleted = [];
    this._diffStats = {};
    this._expanded = new Set();
    this._filter = '';
    this._focusIndex = -1;
    this._branchName = '';
    this._branchDetached = false;
    this._contextMenu = null;
    this._inlineInput = null;
    this._activeFile = '';
    this._initialAutoSelect = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._clickOutsideHandler = (e) => {
      if (this._contextMenu) {
        // Check if click is inside our context menu (composed path crosses shadow DOM)
        const path = e.composedPath();
        const menu = this.shadowRoot?.querySelector('.context-menu');
        if (menu && path.includes(menu)) return;
        this._contextMenu = null;
      }
    };
    document.addEventListener('mousedown', this._clickOutsideHandler);

    this._activeFileHandler = (e) => {
      this._activeFile = e.detail?.path || '';
    };
    window.addEventListener('active-file-changed', this._activeFileHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('mousedown', this._clickOutsideHandler);
    window.removeEventListener('active-file-changed', this._activeFileHandler);
  }

  onRpcReady() {
    this.loadTree();
  }

  // ── Public API ───────────────────────────────────────────────

  async loadTree() {
    if (!this.rpcConnected) return;
    try {
      const data = await this.rpcExtract('Repo.get_file_tree');
      if (!data || !data.tree) return;
      this._tree = data.tree;
      this._modified = data.modified || [];
      this._staged = data.staged || [];
      this._untracked = data.untracked || [];
      this._deleted = data.deleted || [];
      this._diffStats = data.diff_stats || {};

      // Fetch branch info
      try {
        const branch = await this.rpcExtract('Repo.get_current_branch');
        if (branch) {
          this._branchName = branch.branch || '';
          this._branchDetached = branch.detached || false;
        }
      } catch (_) {}

      // Auto-select changed files on first load
      if (!this._initialAutoSelect) {
        this._initialAutoSelect = true;
        this._autoSelectChanged();
      }
    } catch (e) {
      console.error('Failed to load file tree:', e);
    }
  }

  setFilter(query) {
    this._filter = query || '';
  }

  // ── Auto-selection ───────────────────────────────────────────

  _autoSelectChanged() {
    const repoName = this._tree?.name || '';
    const changed = new Set([
      ...this._modified,
      ...this._staged,
      ...this._untracked,
      ...this._deleted,
    ]);
    if (!changed.size) return;

    const newSelected = new Set(this.selectedFiles);
    for (const path of changed) {
      newSelected.add(path);
      // Auto-expand parent directories
      const parts = path.split('/');
      for (let i = 1; i < parts.length; i++) {
        const dirPath = repoName + '/' + parts.slice(0, i).join('/');
        this._expanded.add(dirPath);
      }
    }
    this._expanded = new Set(this._expanded);
    this._fireSelectionChanged(newSelected);
  }

  // ── Git status helpers ───────────────────────────────────────

  _getFileStatus(relP) {
    if (this._staged.includes(relP)) return 'staged';
    if (this._modified.includes(relP)) return 'modified';
    if (this._untracked.includes(relP)) return 'untracked';
    if (this._deleted.includes(relP)) return 'deleted';
    return null;
  }

  _getDiffStat(relP) {
    return this._diffStats[relP] || null;
  }

  // ── Selection ────────────────────────────────────────────────

  _onCheckboxChange(relP, node, e) {
    e.stopPropagation();

    if (e.shiftKey) {
      // Shift+click: toggle exclusion
      e.preventDefault();
      this._toggleExclusion(relP, node);
      return;
    }

    if (node.type === 'dir') {
      this._toggleDirSelection(relP, node);
    } else {
      this._toggleFileSelection(relP);
    }
  }

  _toggleFileSelection(relP) {
    const newSelected = new Set(this.selectedFiles);
    const newExcluded = new Set(this.excludedFiles);

    if (newExcluded.has(relP)) {
      // Un-exclude and select
      newExcluded.delete(relP);
      newSelected.add(relP);
      this._fireExclusionChanged(newExcluded);
    } else if (newSelected.has(relP)) {
      newSelected.delete(relP);
    } else {
      newSelected.add(relP);
    }
    this._fireSelectionChanged(newSelected);
  }

  _toggleDirSelection(relP, node) {
    const repoName = this._tree?.name || '';
    const children = this._collectFileChildren(node, repoName);
    const allSelected = children.every(c => this.selectedFiles.has(c));

    const newSelected = new Set(this.selectedFiles);
    const newExcluded = new Set(this.excludedFiles);
    let exclusionChanged = false;

    for (const child of children) {
      if (allSelected) {
        newSelected.delete(child);
      } else {
        if (newExcluded.has(child)) {
          newExcluded.delete(child);
          exclusionChanged = true;
        }
        newSelected.add(child);
      }
    }

    if (exclusionChanged) this._fireExclusionChanged(newExcluded);
    this._fireSelectionChanged(newSelected);
  }

  _toggleExclusion(relP, node) {
    const repoName = this._tree?.name || '';
    const newExcluded = new Set(this.excludedFiles);
    const newSelected = new Set(this.selectedFiles);

    if (node.type === 'dir') {
      const children = this._collectFileChildren(node, repoName);
      const allExcluded = children.every(c => newExcluded.has(c));
      for (const child of children) {
        if (allExcluded) {
          newExcluded.delete(child);
        } else {
          newExcluded.add(child);
          newSelected.delete(child);
        }
      }
    } else {
      if (newExcluded.has(relP)) {
        newExcluded.delete(relP);
      } else {
        newExcluded.add(relP);
        newSelected.delete(relP);
      }
    }

    this._fireExclusionChanged(newExcluded);
    this._fireSelectionChanged(newSelected);
  }

  _collectFileChildren(node, repoName) {
    const files = [];
    const walk = (n) => {
      if (n.type === 'file') {
        files.push(relPath(n.path, repoName));
      } else if (n.children) {
        n.children.forEach(walk);
      }
    };
    if (node.children) node.children.forEach(walk);
    return files;
  }

  _getDirCheckState(node, repoName) {
    const children = this._collectFileChildren(node, repoName);
    if (!children.length) return 'unchecked';
    const selected = children.filter(c => this.selectedFiles.has(c)).length;
    if (selected === 0) return 'unchecked';
    if (selected === children.length) return 'checked';
    return 'indeterminate';
  }

  _fireSelectionChanged(newSet) {
    this.selectedFiles = newSet;
    this.dispatchEvent(new CustomEvent('selection-changed', {
      detail: { files: [...newSet] },
      bubbles: true, composed: true,
    }));
  }

  _fireExclusionChanged(newSet) {
    this.excludedFiles = newSet;
    this.dispatchEvent(new CustomEvent('exclusion-changed', {
      detail: { files: [...newSet] },
      bubbles: true, composed: true,
    }));
  }

  // ── Click handlers ───────────────────────────────────────────

  _onRowClick(relP, node, e) {
    if (e.target.tagName === 'INPUT') return; // checkbox handled separately

    if (node.type === 'dir') {
      this._toggleExpand(node.path);
    } else {
      // Open in diff viewer
      this.dispatchEvent(new CustomEvent('file-clicked', {
        detail: { path: relP },
        bubbles: true, composed: true,
      }));
    }
  }

  _onMiddleClick(relP, e) {
    if (e.button !== 1) return;
    e.preventDefault();
    this.dispatchEvent(new CustomEvent('insert-path', {
      detail: { path: relP },
      bubbles: true, composed: true,
    }));
  }

  _toggleExpand(treePath) {
    const next = new Set(this._expanded);
    if (next.has(treePath)) {
      next.delete(treePath);
    } else {
      next.add(treePath);
    }
    this._expanded = next;
  }

  // ── Context menu ─────────────────────────────────────────────

  _onContextMenu(relP, node, e) {
    e.preventDefault();
    e.stopPropagation();
    this._contextMenu = { x: e.clientX, y: e.clientY, path: relP, node };
  }

  _contextAction(action) {
    const { path: relP, node } = this._contextMenu || {};
    this._contextMenu = null;
    if (!relP) return;

    switch (action) {
      case 'stage': this._rpcAction('Repo.stage_files', [[relP]]); break;
      case 'unstage': this._rpcAction('Repo.unstage_files', [[relP]]); break;
      case 'discard':
        if (confirm(`Discard changes to ${relP}?`)) {
          this._rpcAction('Repo.discard_changes', [[relP]]);
        }
        break;
      case 'delete':
        if (confirm(`Delete ${relP}?`)) {
          this._rpcAction('Repo.delete_file', [relP]);
        }
        break;
      case 'rename':
        this._inlineInput = { type: 'rename', path: relP, node, value: node.name };
        break;
      case 'new-file':
        this._inlineInput = { type: 'new-file', path: relP, node, value: '' };
        if (!this._expanded.has(node.path)) this._toggleExpand(node.path);
        break;
      case 'new-dir':
        this._inlineInput = { type: 'new-dir', path: relP, node, value: '' };
        if (!this._expanded.has(node.path)) this._toggleExpand(node.path);
        break;
      case 'stage-all': this._stageAllInDir(relP, node); break;
      case 'unstage-all': this._unstageAllInDir(relP, node); break;
      case 'exclude':
        this._toggleExclusion(relP, node);
        break;
    }
  }

  async _rpcAction(method, args) {
    try {
      await this.rpcExtract(method, ...args);
      await this.loadTree();
    } catch (e) {
      this.showToast(`Action failed: ${e.message}`, 'error');
    }
  }

  async _stageAllInDir(relP, node) {
    const repoName = this._tree?.name || '';
    const files = this._collectFileChildren(node, repoName);
    if (files.length) await this._rpcAction('Repo.stage_files', [files]);
  }

  async _unstageAllInDir(relP, node) {
    const repoName = this._tree?.name || '';
    const files = this._collectFileChildren(node, repoName);
    if (files.length) await this._rpcAction('Repo.unstage_files', [files]);
  }

  // ── Inline input ─────────────────────────────────────────────

  _onInlineKeyDown(e) {
    if (e.key === 'Enter') {
      this._submitInlineInput();
    } else if (e.key === 'Escape') {
      this._inlineInput = null;
    }
  }

  _onInlineBlur() {
    // Slight delay to allow Enter to fire first
    setTimeout(() => { this._inlineInput = null; }, 100);
  }

  async _submitInlineInput() {
    const { type, path: relP, node, value } = this._inlineInput || {};
    const val = this.shadowRoot.querySelector('.inline-input')?.value?.trim();
    this._inlineInput = null;
    if (!val) return;

    const repoName = this._tree?.name || '';
    try {
      if (type === 'rename') {
        const dir = relP.includes('/') ? relP.substring(0, relP.lastIndexOf('/')) : '';
        const newPath = dir ? `${dir}/${val}` : val;
        await this.rpcExtract('Repo.rename_file', relP, newPath);
      } else if (type === 'new-file') {
        const newPath = `${relP}/${val}`;
        await this.rpcExtract('Repo.create_file', newPath, '');
      } else if (type === 'new-dir') {
        const newPath = `${relP}/${val}/.gitkeep`;
        await this.rpcExtract('Repo.create_file', newPath, '');
      }
      await this.loadTree();
    } catch (e) {
      this.showToast(`Failed: ${e.message}`, 'error');
    }
  }

  updated(changedProps) {
    super.updated(changedProps);
    // Auto-focus inline input
    if (this._inlineInput) {
      const input = this.shadowRoot.querySelector('.inline-input');
      if (input) {
        input.focus();
        if (this._inlineInput.type === 'rename') {
          input.select();
        }
      }
    }
  }

  // ── Keyboard navigation ──────────────────────────────────────

  _onTreeKeyDown(e) {
    if (this._inlineInput) return; // Don't navigate while editing
    const visibleRows = this._getVisibleRows();
    if (!visibleRows.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._focusIndex = Math.min(this._focusIndex + 1, visibleRows.length - 1);
      this._scrollToFocused();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._focusIndex = Math.max(this._focusIndex - 1, 0);
      this._scrollToFocused();
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (this._focusIndex >= 0 && this._focusIndex < visibleRows.length) {
        const row = visibleRows[this._focusIndex];
        if (e.key === ' ') {
          // Toggle selection
          if (row.node.type === 'dir') {
            this._toggleDirSelection(row.relP, row.node);
          } else {
            this._toggleFileSelection(row.relP);
          }
        } else {
          // Enter: open file or toggle dir
          this._onRowClick(row.relP, row.node, { target: {} });
        }
      }
    }
  }

  _scrollToFocused() {
    this.updateComplete.then(() => {
      const el = this.shadowRoot.querySelector('.row.focused');
      if (el) el.scrollIntoView({ block: 'nearest' });
    });
  }

  _getVisibleRows() {
    if (!this._tree) return [];
    const rows = [];
    const repoName = this._tree.name;
    const walk = (node, depth) => {
      if (!nodeMatchesFilter(node, this._filter)) return;
      const rp = relPath(node.path, repoName);
      rows.push({ relP: rp, node, depth });
      if (node.type === 'dir' && node.children &&
          (this._expanded.has(node.path) || this._filter)) {
        for (const child of node.children) {
          walk(child, depth + 1);
        }
      }
    };
    // Root node itself (root is always expanded)
    rows.push({ relP: '', node: this._tree, depth: 0 });
    if (this._tree.children) {
      for (const child of this._tree.children) {
        walk(child, 1);
      }
    }
    return rows;
  }

  // ── Filter ───────────────────────────────────────────────────

  _onFilterInput(e) {
    this._filter = e.target.value;
  }

  // ── Render ───────────────────────────────────────────────────

  render() {
    return html`
      <div class="filter-bar">
        <input type="text"
               placeholder="Filter files..."
               .value=${this._filter}
               @input=${this._onFilterInput}>
      </div>
      <div class="tree"
           tabindex="0"
           @keydown=${this._onTreeKeyDown}>
        ${this._tree ? this._renderTree() : html`<div style="padding:12px;color:var(--text-muted)">Loading...</div>`}
      </div>

      ${this._contextMenu ? this._renderContextMenu() : ''}
    `;
  }

  _renderTree() {
    const repoName = this._tree.name;
    const rows = [];
    let rowIndex = 0;

    // Root row
    rows.push(this._renderRootRow(rowIndex++));

    // Children
    if (this._tree.children) {
      const sorted = sortChildren(this._tree.children);
      for (const child of sorted) {
        this._renderNodeRows(child, 1, repoName, rows, rowIndex);
        rowIndex = rows.length;
      }
    }

    return rows;
  }

  _renderRootRow(index) {
    const node = this._tree;
    return html`
      <div class="row ${index === this._focusIndex ? 'focused' : ''}"
           @click=${() => this._toggleExpand(node.path)}>
        <span class="toggle">▼</span>
        <span class="name dir">${node.name}</span>
        ${this._branchName ? html`
          <span class="branch-badge ${this._branchDetached ? 'detached' : ''}"
                title="${this._branchName}">
            ⎇ ${this._branchName}
          </span>
        ` : ''}
      </div>
    `;
  }

  _renderNodeRows(node, depth, repoName, rows, startIndex) {
    if (!nodeMatchesFilter(node, this._filter)) return;

    const rp = relPath(node.path, repoName);
    const index = rows.length;
    const isExcluded = this.excludedFiles.has(rp);

    if (node.type === 'dir') {
      const expanded = this._expanded.has(node.path) || !!this._filter;
      const checkState = this._getDirCheckState(node, repoName);

      rows.push(html`
        <div class="row ${index === this._focusIndex ? 'focused' : ''}"
             style="padding-left: ${depth * 16 + 4}px"
             title="${rp} — ${node.name}"
             @click=${(e) => this._onRowClick(rp, node, e)}
             @auxclick=${(e) => this._onMiddleClick(rp, e)}
             @contextmenu=${(e) => this._onContextMenu(rp, node, e)}>
          <input type="checkbox"
                 .checked=${checkState === 'checked'}
                 .indeterminate=${checkState === 'indeterminate'}
                 title="Click to select · Shift+click to exclude from index"
                 @click=${(e) => this._onCheckboxChange(rp, node, e)}>
          <span class="toggle">${expanded ? '▼' : '▶'}</span>
          <span class="name dir ${isExcluded ? 'excluded' : ''}">${node.name}</span>
        </div>
        ${this._inlineInput && this._inlineInput.path === rp &&
          (this._inlineInput.type === 'new-file' || this._inlineInput.type === 'new-dir') ? html`
          <div class="row" style="padding-left: ${(depth + 1) * 16 + 4}px">
            <input class="inline-input"
                   .value=${this._inlineInput.value}
                   placeholder="${this._inlineInput.type === 'new-dir' ? 'New directory...' : 'New file...'}"
                   @keydown=${this._onInlineKeyDown}
                   @blur=${this._onInlineBlur}>
          </div>
        ` : ''}
      `);

      if (expanded && node.children) {
        const sorted = sortChildren(node.children);
        for (const child of sorted) {
          this._renderNodeRows(child, depth + 1, repoName, rows, rows.length);
        }
      }
    } else {
      // File
      const isSelected = this.selectedFiles.has(rp);
      const status = this._getFileStatus(rp);
      const diffStat = this._getDiffStat(rp);
      const isActive = this._activeFile === rp;

      // Inline rename
      if (this._inlineInput?.type === 'rename' && this._inlineInput?.path === rp) {
        rows.push(html`
          <div class="row" style="padding-left: ${depth * 16 + 4}px">
            <input class="inline-input"
                   .value=${this._inlineInput.value}
                   @keydown=${this._onInlineKeyDown}
                   @blur=${this._onInlineBlur}>
          </div>
        `);
        return;
      }

      rows.push(html`
        <div class="row ${index === this._focusIndex ? 'focused' : ''} ${isActive ? 'active-in-viewer' : ''}"
             style="padding-left: ${depth * 16 + 4}px"
             title="${rp} — ${node.name}"
             @click=${(e) => this._onRowClick(rp, node, e)}
             @auxclick=${(e) => this._onMiddleClick(rp, e)}
             @contextmenu=${(e) => this._onContextMenu(rp, node, e)}>
          <input type="checkbox"
                 .checked=${isSelected}
                 style="${isExcluded ? 'opacity:0.5' : ''}"
                 title="Click to select · Shift+click to exclude from index"
                 @click=${(e) => this._onCheckboxChange(rp, node, e)}>
          <span class="name ${isExcluded ? 'excluded' : ''}">${node.name}</span>
          <div class="badges">
            ${isExcluded ? html`<span class="excluded-badge" title="Excluded from index">✕</span>` : ''}
            ${status ? html`
              <span class="badge" style="color:${STATUS_BADGES[status]?.color || 'inherit'}">
                ${STATUS_BADGES[status]?.label || ''}
              </span>
            ` : ''}
            ${node.lines > 0 ? html`
              <span class="line-count" style="color:${lineColor(node.lines)}">${node.lines}</span>
            ` : ''}
            ${diffStat ? html`
              <span class="diff-stat">
                ${diffStat.additions ? html`<span class="diff-add">+${diffStat.additions}</span>` : ''}
                ${diffStat.deletions ? html`<span class="diff-del">-${diffStat.deletions}</span>` : ''}
              </span>
            ` : ''}
          </div>
        </div>
      `);
    }
  }

  _renderContextMenu() {
    const { x, y, path: relP, node } = this._contextMenu;
    const isExcluded = this.excludedFiles.has(relP);
    const items = [];

    if (node.type === 'dir') {
      items.push({ label: 'Stage All', action: 'stage-all' });
      items.push({ label: 'Unstage All', action: 'unstage-all' });
      items.push({ sep: true });
      items.push({ label: 'New File...', action: 'new-file' });
      items.push({ label: 'New Directory...', action: 'new-dir' });
      items.push({ label: 'Rename...', action: 'rename' });
      items.push({ sep: true });
      items.push({
        label: isExcluded ? 'Include in Index' : 'Exclude from Index',
        action: 'exclude',
      });
    } else {
      items.push({ label: 'Stage', action: 'stage' });
      items.push({ label: 'Unstage', action: 'unstage' });
      items.push({ label: 'Discard Changes', action: 'discard' });
      items.push({ sep: true });
      items.push({ label: 'Rename...', action: 'rename' });
      items.push({ label: 'Delete', action: 'delete' });
      items.push({ sep: true });
      items.push({
        label: isExcluded ? 'Include in Index' : 'Exclude from Index',
        action: 'exclude',
      });
    }

    return html`
      <div class="context-menu" style="left:${x}px;top:${y}px">
        ${items.map(item => item.sep
          ? html`<div class="context-menu-sep"></div>`
          : html`<div class="context-menu-item"
                      @click=${() => this._contextAction(item.action)}>
                   ${item.label}
                 </div>`
        )}
      </div>
    `;
  }

}

customElements.define('ac-file-picker', AcFilePicker);