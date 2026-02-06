import { LitElement, html } from 'lit';
import { filePickerStyles } from './FilePickerStyles.js';
import { renderFilePicker } from './FilePickerTemplate.js';
import { FileSelectionMixin } from './FileSelectionMixin.js';
import { FileNodeRendererMixin } from './FileNodeRendererMixin.js';
import { FileContextMenuMixin } from './FileContextMenuMixin.js';

const MixedBase = FileContextMenuMixin(
  FileNodeRendererMixin(
    FileSelectionMixin(LitElement)
  )
);

export class FilePicker extends MixedBase {
  static properties = {
    tree: { type: Object },
    modified: { type: Array },
    staged: { type: Array },
    untracked: { type: Array },
    diffStats: { type: Object },
    selected: { type: Object },
    expanded: { type: Object },
    filter: { type: String },
    viewingFile: { type: String },
    focusedFile: { type: String }
  };

  static styles = filePickerStyles;

  constructor() {
    super();
    this.tree = null;
    this.modified = [];
    this.staged = [];
    this.untracked = [];
    this.diffStats = {};
    this.selected = {};
    this.expanded = {};
    this.filter = '';
    this.viewingFile = null;
    this.focusedFile = '';
    this._expandedInitialized = false;
  }

  willUpdate(changedProperties) {
    // Auto-expand directories containing changed files when data first loads
    // Only do this if the parent hasn't provided expanded state
    const hasParentExpanded = Object.keys(this.expanded || {}).length > 0;
    if (!this._expandedInitialized && this.tree && !hasParentExpanded &&
        (this.modified.length > 0 || this.staged.length > 0 || this.untracked.length > 0)) {
      this._expandedInitialized = true;
      this._expandChangedFileDirs();
      this._autoSelectChangedFiles();
    }
  }

  _autoSelectChangedFiles() {
    // Auto-select modified, staged, and untracked files
    const changedFiles = [...this.modified, ...this.staged, ...this.untracked];
    if (changedFiles.length === 0) return;
    
    const newSelected = { ...this.selected };
    for (const filePath of changedFiles) {
      newSelected[filePath] = true;
    }
    this.selected = newSelected;
    this.dispatchEvent(new CustomEvent('selection-change', { detail: this.selectedFiles }));
  }



  /**
   * Get current scroll position of the tree element.
   * @returns {number} The scrollTop value
   */
  getScrollTop() {
    const treeEl = this.shadowRoot?.querySelector('.tree');
    return treeEl?.scrollTop ?? 0;
  }

  /**
   * Set scroll position of the tree element.
   * @param {number} value - The scrollTop value to set
   */
  setScrollTop(value) {
    const treeEl = this.shadowRoot?.querySelector('.tree');
    if (treeEl && value >= 0) {
      treeEl.scrollTop = value;
    }
  }

  _expandChangedFileDirs() {
    const changedFiles = [...this.modified, ...this.staged, ...this.untracked];
    const dirsToExpand = new Set();
    
    // Get the root name to prefix paths
    const rootName = this.tree?.name || '';
    
    // Always expand the root
    if (rootName) {
      dirsToExpand.add(rootName);
    }
    
    for (const filePath of changedFiles) {
      const parts = filePath.split('/');
      // Start with the root name as the base path
      let currentPath = rootName;
      
      // Add all parent directories to the set (prefixed with root)
      for (let i = 0; i < parts.length - 1; i++) {
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
        dirsToExpand.add(currentPath);
      }
    }
    
    // Update expanded state
    const newExpanded = { ...this.expanded };
    for (const dir of dirsToExpand) {
      newExpanded[dir] = true;
    }
    this._updateExpanded(newExpanded);
  }

  /**
   * Update expanded state and notify parent
   */
  _updateExpanded(newExpanded) {
    this.expanded = newExpanded;
    // Use queueMicrotask to avoid synchronous parent re-render cascade
    queueMicrotask(() => {
      this.dispatchEvent(new CustomEvent('expanded-change', { detail: newExpanded }));
    });
  }

  /** Collect all visible file paths in tree order, respecting current filter */
  _collectVisibleFiles(node, path = '') {
    if (!node) return [];
    const files = [];
    const currentPath = path ? `${path}/${node.name}` : node.name;
    
    if (node.children) {
      const isExpanded = this.expanded[currentPath] ?? (this.filter ? true : false);
      if (this.filter || isExpanded) {
        for (const child of node.children) {
          files.push(...this._collectVisibleFiles(child, currentPath));
        }
      }
    } else if (node.path) {
      if (!this.filter || this.matchesFilter(node, this.filter)) {
        files.push(node.path);
      }
    }
    return files;
  }

  getVisibleFiles() {
    if (!this.tree) return [];
    return this._collectVisibleFiles(this.tree);
  }

  /** Move focus to the next/previous visible file. direction: 1=down, -1=up */
  navigateFocus(direction) {
    const visible = this.getVisibleFiles();
    if (visible.length === 0) return;
    const currentIdx = visible.indexOf(this.focusedFile);
    let nextIdx;
    if (currentIdx === -1) {
      nextIdx = direction === 1 ? 0 : visible.length - 1;
    } else {
      nextIdx = currentIdx + direction;
      if (nextIdx < 0) nextIdx = 0;
      if (nextIdx >= visible.length) nextIdx = visible.length - 1;
    }
    this.focusedFile = visible[nextIdx];
    this._scrollFocusedIntoView();
  }

  /** Toggle selection of the currently focused file */
  toggleFocusedFile() {
    if (!this.focusedFile) return;
    const e = { stopPropagation: () => {} };
    this.toggleSelect(this.focusedFile, e);
  }

  /** Ensure the focused file row is scrolled into view */
  _scrollFocusedIntoView() {
    this.updateComplete.then(() => {
      const row = this.shadowRoot?.querySelector('.row.focused');
      if (row) {
        row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  /**
   * Override shouldUpdate to skip costly tree re-renders when only
   * selection changed — native checkbox .checked binding handles it.
   */
  shouldUpdate(changedProperties) {
    // If only 'selected' changed (checkbox state), skip full re-render
    // when the tree structure hasn't changed. The .checked property binding
    // on checkboxes is handled by Lit's property update, but the tree
    // nodes themselves don't need to be re-diffed.
    if (changedProperties.size === 1 && changedProperties.has('selected')) {
      // Still need to update — but Lit's diffing will be fast since
      // only .checked bindings changed. This is a no-op guard for future
      // optimization if we move to a virtualized list.
      return true;
    }
    return true;
  }

  render() {
    return html`
      ${renderFilePicker(this)}
      ${this.renderContextMenu()}
    `;
  }
}

customElements.define('file-picker', FilePicker);
