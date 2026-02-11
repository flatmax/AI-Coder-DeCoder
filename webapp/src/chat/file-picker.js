import { LitElement, html, css, nothing } from 'lit';
import { RpcMixin } from '../rpc-mixin.js';

/**
 * File picker — tree view with checkboxes, git status, context menu.
 *
 * Events emitted:
 *   selection-changed  { selectedFiles: string[] }
 *   file-clicked       { path: string }
 *   git-operation       { operation, paths }
 */
class FilePicker extends RpcMixin(LitElement) {
  static properties = {
    /** Root tree node from Repo.get_file_tree */
    tree: { type: Object },
    /** Arrays of file paths by git status */
    modified: { type: Array },
    staged: { type: Array },
    untracked: { type: Array },
    /** Diff stats: path → {additions, deletions} */
    diffStats: { type: Object },
    /** Currently selected file paths */
    selectedFiles: { type: Object },
    /** Filter text */
    _filter: { type: String, state: true },
    /** Set of expanded directory paths */
    _expanded: { type: Object, state: true },
    /** Focused file path for keyboard nav */
    _focused: { type: String, state: true },
    /** Context menu state */
    _contextMenu: { type: Object, state: true },
    /** Whether initial auto-select has run */
    _autoSelected: { type: Boolean, state: true },
    /** Path of the file currently open in the diff viewer */
    viewerActiveFile: { type: String },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      font-size: 12.5px;
      --indent: 16px;
    }

    /* ── Filter bar ── */
    .filter-bar {
      padding: 6px 8px;
      border-bottom: 1px solid var(--border-color);
      flex-shrink: 0;
    }

    .filter-bar input {
      width: 100%;
      padding: 4px 8px;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-size: 12px;
      outline: none;
      font-family: var(--font-sans);
    }
    .filter-bar input:focus { border-color: var(--accent-primary); }
    .filter-bar input::placeholder { color: var(--text-muted); }

    /* ── Tree container ── */
    .tree-container {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 4px 0;
    }

    /* ── Tree node row ── */
    .node-row {
      display: flex;
      align-items: center;
      padding: 2px 8px 2px 0;
      cursor: default;
      user-select: none;
      white-space: nowrap;
      min-height: 24px;
      border-left: 2px solid transparent;
      transition: background var(--transition-fast);
    }
    .node-row:hover { background: var(--bg-surface); }
    .node-row.focused {
      background: var(--bg-surface);
      border-left-color: var(--accent-primary);
    }
    .node-row.active-in-viewer {
      background: rgba(100, 180, 255, 0.08);
      border-left-color: var(--accent-primary);
    }
    .node-row.active-in-viewer:hover {
      background: rgba(100, 180, 255, 0.14);
    }

    /* Indent spacer */
    .indent { flex-shrink: 0; }

    /* Expand toggle */
    .toggle {
      width: 18px;
      flex-shrink: 0;
      text-align: center;
      font-size: 10px;
      color: var(--text-muted);
      cursor: pointer;
      line-height: 1;
    }
    .toggle:hover { color: var(--text-primary); }

    /* Checkbox */
    .node-check {
      width: 14px;
      height: 14px;
      margin-right: 4px;
      flex-shrink: 0;
      cursor: pointer;
      accent-color: var(--accent-primary);
    }

    /* Name */
    .node-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--text-primary);
    }
    .node-name.dir { font-weight: 600; color: var(--text-secondary); }
    .node-name.file-click { cursor: pointer; }
    .node-name.file-click:hover { color: var(--accent-primary); text-decoration: underline; }

    /* Line count */
    .line-count {
      font-size: 10px;
      margin-left: 6px;
      flex-shrink: 0;
      font-family: var(--font-mono);
    }
    .line-count.green { color: var(--accent-success); }
    .line-count.orange { color: var(--accent-warning); }
    .line-count.red { color: var(--accent-error); }

    /* Git status badge */
    .git-badge {
      font-size: 9px;
      font-weight: 700;
      padding: 0 4px;
      border-radius: 3px;
      margin-left: 4px;
      flex-shrink: 0;
      line-height: 1.5;
    }
    .git-badge.modified { background: rgba(255,167,38,0.2); color: var(--accent-warning); }
    .git-badge.staged { background: rgba(102,187,106,0.2); color: var(--accent-success); }
    .git-badge.untracked { background: rgba(102,187,106,0.2); color: var(--accent-success); }

    /* Diff stats */
    .diff-stats {
      font-size: 10px;
      margin-left: 4px;
      flex-shrink: 0;
      font-family: var(--font-mono);
    }
    .diff-add { color: var(--accent-success); }
    .diff-del { color: var(--accent-error); }

    /* ── Context menu ── */
    .context-menu {
      position: fixed;
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      box-shadow: var(--shadow-lg);
      z-index: 200;
      min-width: 160px;
      padding: 4px 0;
      font-size: 12px;
    }
    .context-item {
      padding: 5px 14px;
      cursor: pointer;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .context-item:hover {
      background: var(--bg-surface);
      color: var(--text-primary);
    }
    .context-item.danger { color: var(--accent-error); }
    .context-item.danger:hover { background: rgba(239,83,80,0.1); }
    .context-sep {
      height: 1px;
      background: var(--border-color);
      margin: 4px 0;
    }

    /* ── Confirm/prompt overlay ── */
    .overlay-backdrop {
      position: fixed;
      inset: 0;
      z-index: 250;
    }
    .overlay-dialog {
      position: fixed;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      padding: 16px 20px;
      z-index: 260;
      min-width: 280px;
    }
    .overlay-dialog p {
      margin: 0 0 12px 0;
      color: var(--text-primary);
      font-size: 13px;
    }
    .overlay-dialog input {
      width: 100%;
      padding: 6px 8px;
      margin-bottom: 12px;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-size: 13px;
      outline: none;
      box-sizing: border-box;
    }
    .overlay-dialog input:focus { border-color: var(--accent-primary); }
    .overlay-btns {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .overlay-btns button {
      padding: 5px 14px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-primary);
      cursor: pointer;
      font-size: 12px;
    }
    .overlay-btns button.primary {
      background: var(--accent-primary);
      color: var(--bg-primary);
      border-color: var(--accent-primary);
    }
    .overlay-btns button.danger {
      background: var(--accent-error);
      color: white;
      border-color: var(--accent-error);
    }

    .empty-tree {
      padding: 20px;
      color: var(--text-muted);
      text-align: center;
      font-size: 13px;
    }
  `;

  constructor() {
    super();
    this.tree = null;
    this.modified = [];
    this.staged = [];
    this.untracked = [];
    this.diffStats = {};
    this.selectedFiles = new Set();
    this._filter = '';
    this._expanded = new Set();
    this._focused = '';
    this._contextMenu = null;
    this._autoSelected = false;
    this._overlayState = null; // {type:'confirm'|'prompt', ...}
    this.viewerActiveFile = '';
    this._flatVisibleCache = null;

    this._onDocClick = this._onDocClick.bind(this);
    this._onDocKeydown = this._onDocKeydown.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('click', this._onDocClick, true);
    document.addEventListener('keydown', this._onDocKeydown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this._onDocClick, true);
    document.removeEventListener('keydown', this._onDocKeydown);
  }

  // ── Property change tracking ──

  willUpdate(changed) {
    // Invalidate flat list cache on relevant changes
    if (changed.has('tree') || changed.has('_filter') || changed.has('_expanded')) {
      this._flatVisibleCache = null;
    }
    // Auto-select changed files on first tree load
    if (changed.has('tree') && this.tree && !this._autoSelected) {
      this._autoSelected = true;
      this._autoSelect();
    }
  }

  // ── Auto selection ──

  _autoSelect() {
    const changed = new Set([
      ...(this.modified || []),
      ...(this.staged || []),
      ...(this.untracked || []),
    ]);
    if (changed.size === 0) return;
    this.selectedFiles = new Set(changed);
    // Auto-expand directories containing changed files
    for (const fpath of changed) {
      this._expandParents(fpath);
    }
    this._emitSelection();
  }

  _expandParents(filePath) {
    const parts = filePath.split('/');
    for (let i = 1; i < parts.length; i++) {
      this._expanded.add(parts.slice(0, i).join('/'));
    }
    this._expanded = new Set(this._expanded);
  }

  // ── Filter ──

  _onFilterInput(e) {
    this._filter = e.target.value;
  }

  _matchesFilter(node) {
    if (!this._filter) return true;
    const q = this._filter.toLowerCase();
    if (node.path.toLowerCase().includes(q)) return true;
    if (node.type === 'dir') {
      return (node.children || []).some(c => this._matchesFilter(c));
    }
    return false;
  }

  // ── Selection ──

  _toggleSelect(path, isDir, children) {
    const next = new Set(this.selectedFiles);
    if (isDir) {
      const files = this._collectFiles(children);
      const allSelected = files.every(f => next.has(f));
      if (allSelected) {
        files.forEach(f => next.delete(f));
      } else {
        files.forEach(f => next.add(f));
      }
    } else {
      if (next.has(path)) next.delete(path);
      else next.add(path);
    }
    this.selectedFiles = next;
    this._emitSelection();
  }

  _collectFiles(children) {
    const result = [];
    const walk = (nodes) => {
      for (const n of nodes) {
        if (n.type === 'file') result.push(n.path);
        else if (n.children) walk(n.children);
      }
    };
    walk(children || []);
    return result;
  }

  _dirCheckState(children) {
    const files = this._collectFiles(children);
    if (files.length === 0) return 'none';
    const sel = files.filter(f => this.selectedFiles.has(f)).length;
    if (sel === 0) return 'none';
    if (sel === files.length) return 'all';
    return 'indeterminate';
  }

  _emitSelection() {
    this.dispatchEvent(new CustomEvent('selection-changed', {
      detail: { selectedFiles: [...this.selectedFiles] },
      bubbles: true, composed: true,
    }));
  }

  // ── Expand / Collapse ──

  _toggleExpand(path) {
    const next = new Set(this._expanded);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    this._expanded = next;
  }

  // ── File click ──

  _onFileNameClick(path) {
    this.dispatchEvent(new CustomEvent('file-clicked', {
      detail: { path },
      bubbles: true, composed: true,
    }));
  }

  // ── Middle-click to insert path into chat input ──

  _onMiddleClick(e, path) {
    // Middle mouse button = button 1
    if (e.button !== 1) return;
    e.preventDefault();
    e.stopPropagation();

    // Block all follow-up events that could trigger clipboard paste or autoscroll.
    // Different browsers use different events for middle-click paste:
    //   - auxclick (Chrome/Firefox)
    //   - mouseup with button=1 (some Linux environments)
    //   - paste event on the focused textarea
    const blockMid = (ev) => { if (ev.button === 1) { ev.preventDefault(); ev.stopPropagation(); } };
    const blockPaste = (ev) => { ev.preventDefault(); ev.stopPropagation(); };

    window.addEventListener('auxclick', blockMid, { once: true, capture: true });
    window.addEventListener('mouseup', blockMid, { once: true, capture: true });
    // Temporarily block paste on the target textarea
    const input = this.closest('files-tab')?.shadowRoot?.querySelector('chat-input');
    const textarea = input?.shadowRoot?.querySelector('textarea');
    if (textarea) {
      textarea.addEventListener('paste', blockPaste, { once: true, capture: true });
      // Clean up paste blocker after a short delay in case paste never fires
      setTimeout(() => textarea.removeEventListener('paste', blockPaste, true), 200);
    }

    this.dispatchEvent(new CustomEvent('path-to-input', {
      detail: { path },
      bubbles: true, composed: true,
    }));
  }

  // ── Git status helpers ──

  _gitStatus(path) {
    if (this.staged?.includes(path)) return 'staged';
    if (this.modified?.includes(path)) return 'modified';
    if (this.untracked?.includes(path)) return 'untracked';
    return '';
  }

  _gitBadge(status) {
    if (status === 'staged') return 'S';
    if (status === 'modified') return 'M';
    if (status === 'untracked') return 'U';
    return '';
  }

  _nameColor(path) {
    const s = this._gitStatus(path);
    if (s === 'modified') return 'color: var(--accent-warning)';
    if (s === 'staged' || s === 'untracked') return 'color: var(--accent-success)';
    return 'color: var(--text-muted)';
  }

  _lineCountClass(lines) {
    if (lines <= 0) return '';
    if (lines < 130) return 'green';
    if (lines <= 170) return 'orange';
    return 'red';
  }

  // ── Context menu ──

  _onContextMenu(e, node) {
    e.preventDefault();
    e.stopPropagation();
    this._contextMenu = {
      x: e.clientX,
      y: e.clientY,
      node,
    };
    this.requestUpdate();
  }

  _onDocClick() {
    if (this._contextMenu) {
      this._contextMenu = null;
      this.requestUpdate();
    }
  }

  _onDocKeydown(e) {
    if (e.key === 'Escape') {
      if (this._overlayState) {
        this._overlayState = null;
        this.requestUpdate();
        return;
      }
      if (this._contextMenu) {
        this._contextMenu = null;
        this.requestUpdate();
      }
    }
  }

  _contextItems(node) {
    const items = [];
    const path = node.path;

    if (node.type === 'file') {
      const status = this._gitStatus(path);
      if (status === 'modified' || status === 'untracked') {
        items.push({ label: 'Stage file', icon: '＋', op: 'stage', paths: [path] });
      }
      if (status === 'staged') {
        items.push({ label: 'Unstage file', icon: '−', op: 'unstage', paths: [path] });
      }
      if (status === 'modified') {
        items.push({ label: 'Discard changes', icon: '↩', op: 'discard', paths: [path], danger: true, confirm: true });
      }
      items.push({ sep: true });
      items.push({ label: 'Rename / Move', icon: '✏️', op: 'rename', paths: [path], prompt: true });
      items.push({ label: 'Delete file', icon: '🗑', op: 'delete', paths: [path], danger: true, confirm: true });
    } else {
      // Directory
      const dirFiles = this._collectFiles(node.children || []);
      const hasUnstaged = dirFiles.some(f => this._gitStatus(f) === 'modified' || this._gitStatus(f) === 'untracked');
      const hasStaged = dirFiles.some(f => this._gitStatus(f) === 'staged');

      if (hasUnstaged) {
        items.push({ label: 'Stage all in dir', icon: '＋', op: 'stage', paths: dirFiles.filter(f => {
          const s = this._gitStatus(f);
          return s === 'modified' || s === 'untracked';
        })});
      }
      if (hasStaged) {
        items.push({ label: 'Unstage all', icon: '−', op: 'unstage', paths: dirFiles.filter(f => this._gitStatus(f) === 'staged') });
      }
      if (items.length > 0) items.push({ sep: true });
      items.push({ label: 'Rename / Move', icon: '✏️', op: 'rename-dir', paths: [path], prompt: true });
      items.push({ label: 'New file', icon: '📄', op: 'create-file', paths: [path], prompt: true });
      items.push({ label: 'New directory', icon: '📁', op: 'create-dir', paths: [path], prompt: true });
    }
    return items;
  }

  _onContextItemClick(item) {
    this._contextMenu = null;
    if (item.confirm) {
      this._overlayState = { type: 'confirm', item };
      this.requestUpdate();
    } else if (item.prompt) {
      const defaultVal = item.op.startsWith('rename') ? item.paths[0] : '';
      this._overlayState = { type: 'prompt', item, value: defaultVal };
      this.requestUpdate();
    } else {
      this._executeGitOp(item.op, item.paths);
    }
  }

  _onOverlayConfirm() {
    const item = this._overlayState?.item;
    this._overlayState = null;
    if (item) this._executeGitOp(item.op, item.paths);
    this.requestUpdate();
  }

  _onOverlayPromptConfirm() {
    const { item, value } = this._overlayState || {};
    this._overlayState = null;
    this.requestUpdate();
    if (!item || !value?.trim()) return;
    this._executeGitOp(item.op, item.paths, value.trim());
  }

  async _executeGitOp(op, paths, extra) {
    try {
      let result;
      switch (op) {
        case 'stage':
          result = await this.rpcExtract('Repo.stage_files', paths);
          break;
        case 'unstage':
          result = await this.rpcExtract('Repo.unstage_files', paths);
          break;
        case 'discard':
          result = await this.rpcExtract('Repo.discard_changes', paths);
          break;
        case 'delete':
          result = await this.rpcExtract('Repo.delete_file', paths[0]);
          break;
        case 'rename':
        case 'rename-dir':
          result = await this.rpcExtract(
            op === 'rename-dir' ? 'Repo.rename_directory' : 'Repo.rename_file',
            paths[0], extra,
          );
          break;
        case 'create-file':
          result = await this.rpcExtract('Repo.create_file', paths[0] + '/' + extra, '');
          break;
        case 'create-dir': {
          // Create dir by creating a .gitkeep inside it
          const dirPath = paths[0] + '/' + extra + '/.gitkeep';
          result = await this.rpcExtract('Repo.create_file', dirPath, '');
          break;
        }
        default:
          console.warn('Unknown git op:', op);
          return;
      }
      if (result?.error) {
        console.error('Git operation failed:', result.error);
      }
      // Refresh tree
      this.dispatchEvent(new CustomEvent('git-operation', {
        detail: { operation: op, paths, result },
        bubbles: true, composed: true,
      }));
    } catch (e) {
      console.error('Git operation error:', e);
    }
  }

  // ── Keyboard navigation ──

  _getFlatVisible() {
    if (this._flatVisibleCache) return this._flatVisibleCache;
    const flat = [];
    const walk = (nodes, depth) => {
      for (const node of nodes) {
        if (!this._matchesFilter(node)) continue;
        flat.push({ path: node.path, type: node.type, depth });
        if (node.type === 'dir' && (this._expanded.has(node.path) || this._filter)) {
          walk(node.children || [], depth + 1);
        }
      }
    };
    if (this.tree?.children) walk(this.tree.children, 0);
    this._flatVisibleCache = flat;
    return flat;
  }

  _onTreeKeydown(e) {
    const flat = this._getFlatVisible();
    if (flat.length === 0) return;

    const idx = flat.findIndex(n => n.path === this._focused);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(idx + 1, flat.length - 1);
      this._focused = flat[next >= 0 ? next : 0].path;
      this._scrollFocusedIntoView();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.max(idx - 1, 0);
      this._focused = flat[next].path;
      this._scrollFocusedIntoView();
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (idx >= 0) {
        const item = flat[idx];
        if (item.type === 'dir') {
          this._toggleExpand(item.path);
        } else {
          this._toggleSelect(item.path, false, []);
        }
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (idx >= 0 && flat[idx].type === 'dir') {
        const next = new Set(this._expanded);
        next.add(flat[idx].path);
        this._expanded = next;
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (idx >= 0 && flat[idx].type === 'dir') {
        const next = new Set(this._expanded);
        next.delete(flat[idx].path);
        this._expanded = next;
      }
    }
  }

  _scrollFocusedIntoView() {
    this.updateComplete.then(() => {
      const el = this.shadowRoot.querySelector('.node-row.focused');
      if (el) el.scrollIntoView({ block: 'nearest' });
    });
  }

  // ── Public API ──

  setTree(data) {
    this.tree = data.tree || null;
    this.modified = data.modified || [];
    this.staged = data.staged || [];
    this.untracked = data.untracked || [];
    this.diffStats = data.diff_stats || {};
  }

  setSelectedFiles(files) {
    this.selectedFiles = new Set(files);
  }

  // ── Render ──

  render() {
    return html`
      <div class="filter-bar">
        <input type="text"
          placeholder="Filter files..."
          .value=${this._filter}
          @input=${this._onFilterInput}
        >
      </div>

      <div class="tree-container"
        tabindex="0"
        @keydown=${this._onTreeKeydown}
      >
        ${this.tree?.children?.length
          ? this._renderNodes(this.tree.children, 0)
          : html`<div class="empty-tree">No files</div>`
        }
      </div>

      ${this._contextMenu ? this._renderContextMenu() : nothing}
      ${this._overlayState ? this._renderOverlay() : nothing}
    `;
  }

  _renderNodes(nodes, depth) {
    if (!nodes) return nothing;
    return nodes
      .filter(n => this._matchesFilter(n))
      .map(n => n.type === 'dir'
        ? this._renderDir(n, depth)
        : this._renderFile(n, depth)
      );
  }

  _renderDir(node, depth) {
    const expanded = this._expanded.has(node.path) || !!this._filter;
    const checkState = this._dirCheckState(node.children || []);
    const isFocused = this._focused === node.path;

    return html`
      <div class="node-row ${isFocused ? 'focused' : ''}"
        style="padding-left: ${depth * 16 + 4}px"
        @contextmenu=${(e) => this._onContextMenu(e, node)}
        @click=${() => { this._focused = node.path; this._toggleExpand(node.path); }}
        @mousedown=${(e) => this._onMiddleClick(e, node.path)}
      >
        <span class="toggle" @click=${(e) => { e.stopPropagation(); this._toggleExpand(node.path); }}>
          ${expanded ? '▾' : '▸'}
        </span>
        <input type="checkbox"
          class="node-check"
          .checked=${checkState === 'all'}
          .indeterminate=${checkState === 'indeterminate'}
          @change=${() => this._toggleSelect(node.path, true, node.children || [])}
          @click=${(e) => e.stopPropagation()}
        >
        <span class="node-name dir">${node.name}</span>
      </div>
      ${expanded ? this._renderNodes(node.children || [], depth + 1) : nothing}
    `;
  }

  _renderFile(node, depth) {
    const selected = this.selectedFiles.has(node.path);
    const status = this._gitStatus(node.path);
    const badge = this._gitBadge(status);
    const stats = this.diffStats?.[node.path];
    const isFocused = this._focused === node.path;

    const isActiveInViewer = this.viewerActiveFile === node.path;

    return html`
      <div class="node-row ${isFocused ? 'focused' : ''} ${isActiveInViewer ? 'active-in-viewer' : ''}"
        style="padding-left: ${depth * 16 + 4}px"
        @contextmenu=${(e) => this._onContextMenu(e, node)}
        @click=${() => { this._focused = node.path; }}
        @mousedown=${(e) => this._onMiddleClick(e, node.path)}
      >
        <span class="toggle"></span>
        <input type="checkbox"
          class="node-check"
          .checked=${selected}
          @change=${() => this._toggleSelect(node.path, false, [])}
          @click=${(e) => e.stopPropagation()}
        >
        <span class="node-name file-click"
          style=${this._nameColor(node.path)}
          @click=${(e) => { e.stopPropagation(); this._onFileNameClick(node.path); }}>
          ${node.name}
        </span>
        ${node.lines > 0 ? html`
          <span class="line-count ${this._lineCountClass(node.lines)}">${node.lines}</span>
        ` : nothing}
        ${badge ? html`
          <span class="git-badge ${status}">${badge}</span>
        ` : nothing}
        ${stats ? html`
          <span class="diff-stats">
            ${stats.additions ? html`<span class="diff-add">+${stats.additions}</span>` : nothing}
            ${stats.deletions ? html`<span class="diff-del">-${stats.deletions}</span>` : nothing}
          </span>
        ` : nothing}
      </div>
    `;
  }

  _renderContextMenu() {
    const { x, y, node } = this._contextMenu;
    const items = this._contextItems(node);
    // Clamp position to viewport
    const clampedX = Math.min(x, window.innerWidth - 180);
    const clampedY = Math.min(y, window.innerHeight - items.length * 30 - 20);

    return html`
      <div class="context-menu"
        style="left:${clampedX}px; top:${clampedY}px"
        @click=${(e) => e.stopPropagation()}>
        ${items.map(item =>
          item.sep
            ? html`<div class="context-sep"></div>`
            : html`
              <div class="context-item ${item.danger ? 'danger' : ''}"
                @click=${() => this._onContextItemClick(item)}>
                <span>${item.icon}</span>
                <span>${item.label}</span>
              </div>`
        )}
      </div>
    `;
  }

  _renderOverlay() {
    const s = this._overlayState;
    if (s.type === 'confirm') {
      return html`
        <div class="overlay-backdrop" @click=${() => { this._overlayState = null; this.requestUpdate(); }}></div>
        <div class="overlay-dialog">
          <p>Are you sure you want to <b>${s.item.label.toLowerCase()}</b>?</p>
          <p style="font-size:12px; color:var(--text-secondary)">${s.item.paths.join(', ')}</p>
          <div class="overlay-btns">
            <button @click=${() => { this._overlayState = null; this.requestUpdate(); }}>Cancel</button>
            <button class="danger" @click=${this._onOverlayConfirm}>${s.item.label}</button>
          </div>
        </div>
      `;
    }
    if (s.type === 'prompt') {
      const placeholder = s.item.op.includes('create-file') ? 'filename.ext'
        : s.item.op.includes('create-dir') ? 'directory-name'
        : s.item.paths[0] || '';
      return html`
        <div class="overlay-backdrop" @click=${() => { this._overlayState = null; this.requestUpdate(); }}></div>
        <div class="overlay-dialog">
          <p>${s.item.label}</p>
          <input type="text"
            .value=${s.value}
            placeholder=${placeholder}
            @input=${(e) => { s.value = e.target.value; }}
            @keydown=${(e) => { if (e.key === 'Enter') this._onOverlayPromptConfirm(); }}
          >
          <div class="overlay-btns">
            <button @click=${() => { this._overlayState = null; this.requestUpdate(); }}>Cancel</button>
            <button class="primary" @click=${this._onOverlayPromptConfirm}>OK</button>
          </div>
        </div>
      `;
    }
    return nothing;
  }

  updated(changed) {
    super.updated(changed);
    // Auto-focus prompt input
    if (this._overlayState?.type === 'prompt') {
      const input = this.shadowRoot.querySelector('.overlay-dialog input');
      if (input) input.focus();
    }
  }
}

customElements.define('file-picker', FilePicker);