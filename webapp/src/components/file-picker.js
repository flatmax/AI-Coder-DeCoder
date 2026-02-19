/**
 * File Picker — tree view of repository files.
 *
 * Features: checkbox selection, git status badges, context menu,
 * text filter, keyboard navigation, auto-selection of changed files.
 */

import { LitElement, html, css, nothing } from 'lit';
import { theme, scrollbarStyles } from '../styles/theme.js';
import { RpcMixin } from '../rpc-mixin.js';

export class AcFilePicker extends RpcMixin(LitElement) {
  static properties = {
    selectedFiles: { type: Object, hasChanged: () => true },     // Set<string> — always re-render on set
    reviewState: { type: Object },
    _tree: { type: Object, state: true },
    _modified: { type: Array, state: true },
    _staged: { type: Array, state: true },
    _untracked: { type: Array, state: true },
    _diffStats: { type: Object, state: true },
    _expanded: { type: Object, state: true },   // Set<string>
    _filter: { type: String, state: true },
    _focusedPath: { type: String, state: true },
    _contextMenu: { type: Object, state: true }, // {x, y, node, isDir}
    _contextInput: { type: Object, state: true }, // {type, path, value}
    _activeInViewer: { type: String, state: true },
    _sortMode: { type: String, state: true },       // 'name' | 'mtime' | 'size'
    _sortAscending: { type: Boolean, state: true },
  };

  static styles = [theme, scrollbarStyles, css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      font-size: 0.8rem;
    }

    /* Filter bar */
    .filter-bar {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 8px;
      border-bottom: 1px solid var(--border-primary);
      background: var(--bg-secondary);
    }

    .filter-input {
      flex: 1;
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 0.8rem;
      padding: 4px 8px;
      outline: none;
    }
    .filter-input:focus {
      border-color: var(--accent-primary);
    }
    .filter-input::placeholder {
      color: var(--text-muted);
    }

    /* Sort buttons */
    .sort-buttons {
      display: flex;
      gap: 2px;
      flex-shrink: 0;
    }
    .sort-btn {
      background: none;
      border: 1px solid transparent;
      color: var(--text-muted);
      font-size: 0.7rem;
      padding: 2px 5px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      white-space: nowrap;
      line-height: 1;
    }
    .sort-btn:hover {
      color: var(--text-primary);
      background: var(--bg-tertiary);
    }
    .sort-btn.active {
      color: var(--accent-primary);
      border-color: var(--accent-primary);
    }

    /* Tree container */
    .tree-container {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 4px 0;
    }

    /* Tree row */
    .tree-row {
      display: flex;
      align-items: center;
      padding: 2px 8px 2px 0;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
      min-height: 26px;
      border-left: 2px solid transparent;
    }
    .tree-row:hover {
      background: var(--bg-tertiary);
    }
    .tree-row.focused {
      background: var(--bg-tertiary);
      outline: 1px solid var(--accent-primary);
      outline-offset: -1px;
    }
    .tree-row.active-in-viewer {
      background: rgba(79, 195, 247, 0.08);
      border-left-color: var(--accent-primary);
    }

    /* Indent spacer */
    .indent {
      flex-shrink: 0;
    }

    /* Toggle arrow for directories */
    .toggle {
      width: 16px;
      height: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.6rem;
      color: var(--text-muted);
      flex-shrink: 0;
    }

    /* Checkbox */
    .tree-checkbox {
      width: 14px;
      height: 14px;
      margin: 0 4px 0 0;
      accent-color: var(--accent-primary);
      flex-shrink: 0;
      cursor: pointer;
    }

    /* Name */
    .node-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--text-primary);
    }
    .node-name.dir {
      color: var(--text-secondary);
      font-weight: 500;
    }
    .node-name.modified {
      color: var(--accent-orange);
    }
    .node-name.staged {
      color: var(--accent-green);
    }
    .node-name.untracked {
      color: var(--accent-green);
    }

    /* Badges */
    .badges {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-left: auto;
      padding-left: 8px;
      flex-shrink: 0;
    }

    .line-count {
      font-size: 0.7rem;
      font-family: var(--font-mono);
      padding: 0 3px;
    }
    .line-count.green { color: var(--accent-green); }
    .line-count.orange { color: var(--accent-orange); }
    .line-count.red { color: var(--accent-red); }

    .git-badge {
      font-size: 0.65rem;
      font-weight: 700;
      padding: 0 4px;
      border-radius: 2px;
      line-height: 1.4;
    }
    .git-badge.modified {
      color: var(--accent-orange);
      background: rgba(240, 136, 62, 0.15);
    }
    .git-badge.staged {
      color: var(--accent-green);
      background: rgba(126, 231, 135, 0.15);
    }
    .git-badge.untracked {
      color: var(--accent-green);
      background: rgba(126, 231, 135, 0.15);
    }

    .diff-stat {
      font-size: 0.65rem;
      font-family: var(--font-mono);
    }
    .diff-add { color: var(--accent-green); }
    .diff-del { color: var(--accent-red); }

    /* Context menu */
    .context-menu {
      position: fixed;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      padding: 4px 0;
      min-width: 160px;
      box-shadow: var(--shadow-lg);
      z-index: var(--z-overlay);
      font-size: 0.8rem;
    }

    .context-menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      cursor: pointer;
      color: var(--text-primary);
    }
    .context-menu-item:hover {
      background: var(--bg-secondary);
    }
    .context-menu-item.danger {
      color: var(--accent-red);
    }

    .context-menu-separator {
      height: 1px;
      background: var(--border-primary);
      margin: 4px 0;
    }

    /* Inline prompt input for rename / new file */
    .inline-input {
      background: var(--bg-primary);
      border: 1px solid var(--accent-primary);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 0.8rem;
      padding: 2px 6px;
      outline: none;
      width: 100%;
      margin: 2px 0;
    }

    /* Review banner */
    .review-banner {
      padding: 8px 10px;
      background: rgba(79, 195, 247, 0.08);
      border-bottom: 1px solid var(--accent-primary);
      font-size: 0.75rem;
    }
    .review-banner-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .review-banner-title strong {
      color: var(--accent-primary);
    }
    .review-banner .review-stats {
      color: var(--text-muted);
      margin-top: 2px;
      font-size: 0.7rem;
    }
    .review-exit-btn {
      background: none;
      border: 1px solid var(--accent-red);
      color: var(--accent-red);
      font-size: 0.65rem;
      padding: 1px 8px;
      border-radius: 10px;
      cursor: pointer;
      white-space: nowrap;
    }
    .review-exit-btn:hover {
      background: rgba(255, 80, 80, 0.15);
    }
    /* Empty state */
    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 0.8rem;
    }
  `];

  constructor() {
    super();
    this.selectedFiles = new Set();
    this._tree = null;
    this._modified = [];
    this._staged = [];
    this._untracked = [];
    this._diffStats = {};
    this._expanded = new Set();
    this._filter = '';
    this._focusedPath = '';
    this._contextMenu = null;
    this._contextInput = null;
    this._activeInViewer = '';
    this._allFilePaths = [];
    this._flatVisible = [];
    this._initialAutoSelect = false;
    this._expanded.add('');  // Root node expanded by default

    // Sort state
    try {
      this._sortMode = localStorage.getItem('ac-dc-sort-mode') || 'name';
      this._sortAscending = localStorage.getItem('ac-dc-sort-asc') !== 'false';
    } catch {
      this._sortMode = 'name';
      this._sortAscending = true;
    }

    this._onDocClick = this._onDocClick.bind(this);
    this._onActiveFileChanged = this._onActiveFileChanged.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('click', this._onDocClick);
    window.addEventListener('active-file-changed', this._onActiveFileChanged);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this._onDocClick);
    window.removeEventListener('active-file-changed', this._onActiveFileChanged);
  }

  onRpcReady() {
    // Defer to next microtask so SharedRpc._call is fully propagated
    // to all children before we issue the first RPC call.
    Promise.resolve().then(() => this.loadTree());
  }

  _onActiveFileChanged(e) {
    this._activeInViewer = e.detail?.path || '';
    if (this._activeInViewer) {
      this._expandToPath(this._activeInViewer);
    }
  }

  /**
   * Expand all ancestor directories so the given file path is visible in the tree.
   */
  _expandToPath(filePath) {
    const parts = filePath.split('/');
    if (parts.length <= 1) return; // top-level file, root is always expanded

    let changed = false;
    let current = '';
    for (let i = 0; i < parts.length - 1; i++) {
      current = current ? `${current}/${parts[i]}` : parts[i];
      if (!this._expanded.has(current)) {
        this._expanded.add(current);
        changed = true;
      }
    }
    if (changed) {
      this._expanded = new Set(this._expanded);
    }
  }

  // === Data Loading ===

  async loadTree() {
    try {
      const result = await this.rpcExtract('Repo.get_file_tree');
      if (!result || result.error) {
        console.error('Failed to load tree:', result?.error);
        return;
      }

      this._tree = result.tree;
      this._modified = result.modified || [];
      this._staged = result.staged || [];
      this._untracked = result.untracked || [];
      this._diffStats = result.diff_stats || {};

      // Collect all file paths
      this._allFilePaths = [];
      this._collectPaths(this._tree, this._allFilePaths);

      // Auto-select changed files on first load
      if (!this._initialAutoSelect) {
        this._initialAutoSelect = true;
        const changed = new Set([...this._modified, ...this._staged, ...this._untracked]);
        if (changed.size > 0) {
          this.selectedFiles = new Set(changed);
          this._autoExpandChanged(changed);
          this._notifySelection();
        }
      }
    } catch (e) {
      console.error('Failed to load file tree:', e);
    }
  }

  _collectPaths(node, paths) {
    if (!node) return;
    if (node.type === 'file') {
      paths.push(node.path);
    }
    if (node.children) {
      for (const child of node.children) {
        this._collectPaths(child, paths);
      }
    }
  }

  _autoExpandChanged(changedPaths) {
    for (const path of changedPaths) {
      const parts = path.split('/');
      let current = '';
      for (let i = 0; i < parts.length - 1; i++) {
        current = current ? `${current}/${parts[i]}` : parts[i];
        this._expanded.add(current);
      }
    }
    this._expanded = new Set(this._expanded);
  }

  // === Tree Flattening & Filtering ===

  _flattenTree(node, depth = 0) {
    if (!node) return [];
    const items = [];

    // Root node (repo name) — show as expandable root directory
    if (node.path === '' && node.type === 'dir') {
      items.push({ node, depth: 0 });
      if (this._expanded.has('') || this._filter) {
        const children = this._sortChildren(node.children || []);
        for (const child of children) {
          items.push(...this._flattenTree(child, 1));
        }
      }
      return items;
    }

    const matchesFilter = this._matchesFilter(node);
    if (!matchesFilter) return items;

    items.push({ node, depth });

    if (node.type === 'dir' && (this._expanded.has(node.path) || this._filter)) {
      const children = this._sortChildren(node.children || []);
      for (const child of children) {
        items.push(...this._flattenTree(child, depth + 1));
      }
    }

    return items;
  }

  _sortChildren(children) {
    const dir = this._sortAscending ? 1 : -1;
    return [...children].sort((a, b) => {
      // Directories always first
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      // Both dirs → always alphabetical
      if (a.type === 'dir') return a.name.localeCompare(b.name);
      // Files: sort by active mode
      if (this._sortMode === 'mtime') {
        const am = a.mtime || 0;
        const bm = b.mtime || 0;
        if (am !== bm) return (bm - am) * dir;  // newest first when ascending
        return a.name.localeCompare(b.name);
      }
      if (this._sortMode === 'size') {
        const al = a.lines || 0;
        const bl = b.lines || 0;
        if (al !== bl) return (bl - al) * dir;  // largest first when ascending
        return a.name.localeCompare(b.name);
      }
      // Default: name
      return a.name.localeCompare(b.name) * dir;
    });
  }

  _setSort(mode) {
    if (this._sortMode === mode) {
      this._sortAscending = !this._sortAscending;
    } else {
      this._sortMode = mode;
      this._sortAscending = true;
    }
    try {
      localStorage.setItem('ac-dc-sort-mode', this._sortMode);
      localStorage.setItem('ac-dc-sort-asc', String(this._sortAscending));
    } catch {}
  }

  _matchesFilter(node) {
    if (!this._filter) return true;
    const f = this._filter.toLowerCase();
    // Check this node
    if (node.path.toLowerCase().includes(f)) return true;
    // Check descendants
    if (node.children) {
      return node.children.some(c => this._matchesFilter(c));
    }
    return false;
  }

  // === Selection ===

  _toggleSelect(node, e) {
    e.stopPropagation();
    if (node.type === 'file') {
      const next = new Set(this.selectedFiles);
      if (next.has(node.path)) {
        next.delete(node.path);
      } else {
        next.add(node.path);
      }
      this.selectedFiles = next;
    } else {
      // Directory: toggle all children
      const childPaths = [];
      this._collectPaths(node, childPaths);
      const allSelected = childPaths.every(p => this.selectedFiles.has(p));
      const next = new Set(this.selectedFiles);
      for (const p of childPaths) {
        if (allSelected) {
          next.delete(p);
        } else {
          next.add(p);
        }
      }
      this.selectedFiles = next;
    }
    this._notifySelection();
  }

  _getCheckState(node) {
    if (node.type === 'file') {
      return this.selectedFiles.has(node.path) ? 'checked' : 'unchecked';
    }
    const childPaths = [];
    this._collectPaths(node, childPaths);
    if (childPaths.length === 0) return 'unchecked';
    const selCount = childPaths.filter(p => this.selectedFiles.has(p)).length;
    if (selCount === 0) return 'unchecked';
    if (selCount === childPaths.length) return 'checked';
    return 'indeterminate';
  }

  _notifySelection() {
    this.dispatchEvent(new CustomEvent('selection-changed', {
      detail: { selectedFiles: [...this.selectedFiles] },
      bubbles: true, composed: true,
    }));
  }

  // === Expand/Collapse ===

  _toggleExpand(node) {
    const next = new Set(this._expanded);
    if (next.has(node.path)) {
      next.delete(node.path);
    } else {
      next.add(node.path);
    }
    this._expanded = next;
  }

  // === Click Handlers ===

  _onRowClick(node) {
    if (node.type === 'dir') {
      this._toggleExpand(node);
    } else {
      this.dispatchEvent(new CustomEvent('file-clicked', {
        detail: { path: node.path },
        bubbles: true, composed: true,
      }));
    }
    this._focusedPath = node.path;
  }

  _onRowMiddleClick(node, e) {
    if (e.button !== 1) return;
    e.preventDefault();
    this.dispatchEvent(new CustomEvent('insert-path', {
      detail: { path: node.path },
      bubbles: true, composed: true,
    }));
  }

  // === Context Menu ===

  _onContextMenu(node, e) {
    e.preventDefault();
    e.stopPropagation();
    this._contextMenu = {
      x: e.clientX,
      y: e.clientY,
      node,
      isDir: node.type === 'dir',
    };
  }

  _onDocClick() {
    if (this._contextMenu) {
      this._contextMenu = null;
    }
  }

  async _ctxStage(paths) {
    this._contextMenu = null;
    try {
      await this.rpcExtract('Repo.stage_files', paths);
      await this.loadTree();
    } catch (e) { console.error('Stage failed:', e); }
  }

  async _ctxUnstage(paths) {
    this._contextMenu = null;
    try {
      await this.rpcExtract('Repo.unstage_files', paths);
      await this.loadTree();
    } catch (e) { console.error('Unstage failed:', e); }
  }

  async _ctxDiscard(path) {
    this._contextMenu = null;
    if (!confirm(`Discard changes to ${path}?`)) return;
    try {
      await this.rpcExtract('Repo.discard_changes', [path]);
      await this.loadTree();
    } catch (e) { console.error('Discard failed:', e); }
  }

  _ctxRename(node) {
    this._contextMenu = null;
    this._contextInput = { type: 'rename', path: node.path, value: node.path };
  }

  async _ctxDelete(path) {
    this._contextMenu = null;
    if (!confirm(`Delete ${path}?`)) return;
    try {
      await this.rpcExtract('Repo.delete_file', path);
      // Remove from selection
      const next = new Set(this.selectedFiles);
      next.delete(path);
      this.selectedFiles = next;
      this._notifySelection();
      await this.loadTree();
    } catch (e) { console.error('Delete failed:', e); }
  }

  _ctxNewFile(dirPath) {
    this._contextMenu = null;
    this._contextInput = { type: 'new-file', path: dirPath, value: '' };
    // Ensure directory is expanded
    if (!this._expanded.has(dirPath)) {
      const next = new Set(this._expanded);
      next.add(dirPath);
      this._expanded = next;
    }
  }

  _ctxNewDir(dirPath) {
    this._contextMenu = null;
    this._contextInput = { type: 'new-dir', path: dirPath, value: '' };
    if (!this._expanded.has(dirPath)) {
      const next = new Set(this._expanded);
      next.add(dirPath);
      this._expanded = next;
    }
  }

  async _submitContextInput(e) {
    if (e.key !== 'Enter') return;
    const input = this._contextInput;
    if (!input) return;
    const value = e.target.value.trim();
    if (!value) {
      this._contextInput = null;
      return;
    }

    try {
      if (input.type === 'rename') {
        await this.rpcExtract('Repo.rename_file', input.path, value);
      } else if (input.type === 'new-file') {
        const newPath = input.path ? `${input.path}/${value}` : value;
        await this.rpcExtract('Repo.create_file', newPath, '');
      } else if (input.type === 'new-dir') {
        // Create directory by creating a .gitkeep
        const newPath = input.path ? `${input.path}/${value}/.gitkeep` : `${value}/.gitkeep`;
        await this.rpcExtract('Repo.create_file', newPath, '');
      }
    } catch (e) {
      console.error('Operation failed:', e);
    }

    this._contextInput = null;
    await this.loadTree();
  }

  _cancelContextInput(e) {
    if (e.key === 'Escape') {
      this._contextInput = null;
    }
  }

  // === Keyboard Navigation ===

  _onTreeKeyDown(e) {
    const items = this._flatVisible;
    if (!items.length) return;

    let idx = items.findIndex(i => i.node.path === this._focusedPath);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      idx = Math.min(items.length - 1, idx + 1);
      this._focusedPath = items[idx].node.path;
      this._scrollToFocused();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      idx = Math.max(0, idx - 1);
      this._focusedPath = items[idx].node.path;
      this._scrollToFocused();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const item = items[idx];
      if (item?.node.type === 'dir' && !this._expanded.has(item.node.path)) {
        this._toggleExpand(item.node);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const item = items[idx];
      if (item?.node.type === 'dir' && this._expanded.has(item.node.path)) {
        this._toggleExpand(item.node);
      }
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      const item = items[idx];
      if (item) {
        if (e.key === ' ') {
          this._toggleSelect(item.node, e);
        } else {
          this._onRowClick(item.node);
        }
      }
    } else if (e.key === 'F2') {
      e.preventDefault();
      const item = items[idx];
      if (item && item.node.type === 'file') {
        this._ctxRename(item.node);
      }
    }
  }

  _scrollToFocused() {
    requestAnimationFrame(() => {
      const el = this.shadowRoot?.querySelector(`.tree-row.focused`);
      if (el) el.scrollIntoView({ block: 'nearest' });
    });
  }

  // === Filter ===

  _onFilterInput(e) {
    this._filter = e.target.value;
  }

  setFilter(text) {
    this._filter = text || '';
  }

  // === Git Status Helpers ===

  _getGitStatus(path) {
    if (this._staged.includes(path)) return 'staged';
    if (this._modified.includes(path)) return 'modified';
    if (this._untracked.includes(path)) return 'untracked';
    return null;
  }

  _getLineCountColor(lines) {
    if (lines > 170) return 'red';
    if (lines >= 130) return 'orange';
    return 'green';
  }

  // === Rendering ===

  _renderRow(item) {
    const { node, depth } = item;
    const isDir = node.type === 'dir';
    const isExpanded = this._expanded.has(node.path);
    const checkState = this._getCheckState(node);
    const gitStatus = isDir ? null : this._getGitStatus(node.path);
    const diffStat = isDir ? null : this._diffStats[node.path];
    const isFocused = this._focusedPath === node.path;
    const isActive = this._activeInViewer === node.path;

    return html`
      <div
        class="tree-row ${isFocused ? 'focused' : ''} ${isActive ? 'active-in-viewer' : ''}"
        role="treeitem"
        aria-selected="${checkState === 'checked'}"
        aria-expanded="${isDir ? String(isExpanded) : nothing}"
        aria-level="${depth + 1}"
        aria-label="${node.name}${gitStatus ? `, ${gitStatus}` : ''}"
        style="padding-left: ${depth * 16 + 4}px"
        @click=${() => this._onRowClick(node)}
        @auxclick=${(e) => this._onRowMiddleClick(node, e)}
        @contextmenu=${(e) => this._onContextMenu(node, e)}
      >
        <span class="toggle" aria-hidden="true">
          ${isDir ? (isExpanded ? '▾' : '▸') : ''}
        </span>

        <input
          type="checkbox"
          class="tree-checkbox"
          aria-label="Select ${node.name}"
          .checked=${checkState === 'checked'}
          .indeterminate=${checkState === 'indeterminate'}
          @click=${(e) => this._toggleSelect(node, e)}
          @change=${(e) => e.stopPropagation()}
        />

        <span class="node-name ${isDir ? 'dir' : ''}${!isDir && gitStatus ? ` ${gitStatus}` : ''}">${node.name}</span>

        <span class="badges">
          ${!isDir && node.lines > 0 ? html`
            <span class="line-count ${this._getLineCountColor(node.lines)}">${node.lines}</span>
          ` : nothing}

          ${gitStatus ? html`
            <span class="git-badge ${gitStatus}">
              ${gitStatus === 'modified' ? 'M' : gitStatus === 'staged' ? 'S' : 'U'}
            </span>
          ` : nothing}

          ${diffStat ? html`
            <span class="diff-stat">
              ${diffStat.additions > 0 ? html`<span class="diff-add">+${diffStat.additions}</span>` : nothing}
              ${diffStat.deletions > 0 ? html` <span class="diff-del">-${diffStat.deletions}</span>` : nothing}
            </span>
          ` : nothing}
        </span>
      </div>

      ${this._contextInput && this._contextInput.path === node.path && this._contextInput.type === 'rename' ? html`
        <div style="padding-left: ${depth * 16 + 40}px; padding-right: 8px;">
          <input
            class="inline-input"
            .value=${this._contextInput.value}
            @keydown=${(e) => { e.stopPropagation(); this._submitContextInput(e); this._cancelContextInput(e); }}
            @blur=${() => { this._contextInput = null; }}
          />
        </div>
      ` : nothing}

      ${isDir && (this._contextInput?.path === node.path) &&
        (this._contextInput?.type === 'new-file' || this._contextInput?.type === 'new-dir') ? html`
        <div style="padding-left: ${(depth + 1) * 16 + 40}px; padding-right: 8px;">
          <input
            class="inline-input"
            placeholder="${this._contextInput.type === 'new-file' ? 'filename' : 'dirname'}"
            @keydown=${(e) => { e.stopPropagation(); this._submitContextInput(e); this._cancelContextInput(e); }}
            @blur=${() => { this._contextInput = null; }}
          />
        </div>
      ` : nothing}
    `;
  }

  _renderContextMenu() {
    if (!this._contextMenu) return nothing;
    const { x, y, node, isDir } = this._contextMenu;
    const path = node.path;

    return html`
      <div class="context-menu" role="menu" aria-label="File actions"
           style="left: ${x}px; top: ${y}px"
           @click=${(e) => e.stopPropagation()}>
        ${isDir ? html`
          <div class="context-menu-item" role="menuitem" @click=${() => this._ctxNewFile(path)}>📄 New File</div>
          <div class="context-menu-item" role="menuitem" @click=${() => this._ctxNewDir(path)}>📁 New Directory</div>
          <div class="context-menu-separator" role="separator"></div>
          <div class="context-menu-item" role="menuitem" @click=${() => { const paths = []; this._collectPaths(node, paths); this._ctxStage(paths); }}>
            ➕ Stage All
          </div>
          <div class="context-menu-item" role="menuitem" @click=${() => { const paths = []; this._collectPaths(node, paths); this._ctxUnstage(paths); }}>
            ➖ Unstage All
          </div>
          <div class="context-menu-separator" role="separator"></div>
          <div class="context-menu-item" role="menuitem" @click=${() => this._ctxRename(node)}>✏️ Rename</div>
        ` : html`
          <div class="context-menu-item" role="menuitem" @click=${() => this._ctxStage([path])}>➕ Stage</div>
          <div class="context-menu-item" role="menuitem" @click=${() => this._ctxUnstage([path])}>➖ Unstage</div>
          <div class="context-menu-separator" role="separator"></div>
          <div class="context-menu-item" role="menuitem" @click=${() => this._ctxRename(node)}>✏️ Rename</div>
          <div class="context-menu-item danger" role="menuitem" @click=${() => this._ctxDiscard(path)}>↩️ Discard Changes</div>
          <div class="context-menu-item danger" role="menuitem" @click=${() => this._ctxDelete(path)}>🗑️ Delete</div>
        `}
      </div>
    `;
  }

  updated() {
    // Auto-focus inline inputs
    const inp = this.shadowRoot?.querySelector('.inline-input');
    if (inp && this._contextInput) {
      inp.focus();
      if (this._contextInput.type === 'rename') {
        // Select just the filename portion so the user can quickly rename,
        // but the full path is visible and editable for moving files.
        const val = inp.value || '';
        const lastSlash = val.lastIndexOf('/');
        const nameStart = lastSlash + 1;
        const dotIdx = val.lastIndexOf('.');
        const nameEnd = dotIdx > nameStart ? dotIdx : val.length;
        inp.setSelectionRange(nameStart, nameEnd);
      }
    }
  }

  render() {
    if (!this._tree) {
      return html`<div class="empty-state">Loading file tree...</div>`;
    }

    const items = this._flattenTree(this._tree);
    this._flatVisible = items;

    const reviewActive = this.reviewState?.active;

    return html`
      ${reviewActive ? html`
        <div class="review-banner">
          <div class="review-banner-title">
            <span>📋 Reviewing: <strong>${this.reviewState.branch}</strong></span>
            <button class="review-exit-btn" @click=${() => this.dispatchEvent(new CustomEvent('exit-review', { bubbles: true, composed: true }))}>
              Exit ✕
            </button>
          </div>
          <div class="review-stats">
            ${this.reviewState.stats?.commit_count || 0} commits ·
            ${this.reviewState.stats?.files_changed || 0} files ·
            +${this.reviewState.stats?.additions || 0}
            -${this.reviewState.stats?.deletions || 0}
          </div>
        </div>
      ` : nothing}

      <div class="filter-bar">
        <input
          class="filter-input"
          type="text"
          placeholder="Filter files..."
          aria-label="Filter files"
          .value=${this._filter}
          @input=${this._onFilterInput}
        />
        <div class="sort-buttons">
          <button class="sort-btn ${this._sortMode === 'name' ? 'active' : ''}"
            title="Sort by name"
            @click=${() => this._setSort('name')}>
            A${this._sortMode === 'name' ? (this._sortAscending ? '↓' : '↑') : ''}
          </button>
          <button class="sort-btn ${this._sortMode === 'mtime' ? 'active' : ''}"
            title="Sort by modification time"
            @click=${() => this._setSort('mtime')}>
            🕐${this._sortMode === 'mtime' ? (this._sortAscending ? '↓' : '↑') : ''}
          </button>
          <button class="sort-btn ${this._sortMode === 'size' ? 'active' : ''}"
            title="Sort by size (line count)"
            @click=${() => this._setSort('size')}>
            #${this._sortMode === 'size' ? (this._sortAscending ? '↓' : '↑') : ''}
          </button>
        </div>
      </div>

      <div
        class="tree-container"
        role="tree"
        aria-label="Repository files"
        tabindex="0"
        @keydown=${this._onTreeKeyDown}
      >
        ${items.map(item => this._renderRow(item))}
      </div>

      ${this._renderContextMenu()}
    `;
  }
}

customElements.define('ac-file-picker', AcFilePicker);