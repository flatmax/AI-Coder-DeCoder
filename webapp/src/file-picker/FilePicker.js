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
    viewingFile: { type: String }
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
    this._expandedInitialized = false;
    this._savedScrollTop = 0;
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

  disconnectedCallback() {
    super.disconnectedCallback?.();
    // Save scroll position when component is disconnected (tab switch)
    const treeEl = this.shadowRoot?.querySelector('.tree');
    if (treeEl) {
      this._savedScrollTop = treeEl.scrollTop;
    }
  }

  updated(changedProperties) {
    super.updated?.(changedProperties);
    // Restore scroll position after render
    if (this._savedScrollTop > 0) {
      const treeEl = this.shadowRoot?.querySelector('.tree');
      if (treeEl) {
        treeEl.scrollTop = this._savedScrollTop;
      }
    }
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
    this.dispatchEvent(new CustomEvent('expanded-change', { detail: newExpanded }));
  }

  render() {
    return html`
      ${renderFilePicker(this)}
      ${this.renderContextMenu()}
    `;
  }
}

customElements.define('file-picker', FilePicker);
