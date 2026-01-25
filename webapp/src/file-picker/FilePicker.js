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
    filter: { type: String }
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
    this._expandedInitialized = false;
  }

  updated(changedProperties) {
    super.updated && super.updated(changedProperties);
    
    // Auto-expand directories containing changed files when data first loads
    if (!this._expandedInitialized && this.tree && 
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
    this.expanded = newExpanded;
  }

  render() {
    return html`
      ${renderFilePicker(this)}
      ${this.renderContextMenu()}
    `;
  }
}

customElements.define('file-picker', FilePicker);
