import { html } from 'lit';

/**
 * Mixin for file context menu operations.
 */
export const FileContextMenuMixin = (superClass) => class extends superClass {

  static get properties() {
    return {
      ...super.properties,
      _contextMenu: { type: Object, state: true }
    };
  }

  constructor() {
    super();
    this._contextMenu = null;
    this._boundCloseContextMenu = this._closeContextMenu.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('click', this._boundCloseContextMenu);
    document.addEventListener('contextmenu', this._boundCloseContextMenu);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this._boundCloseContextMenu);
    document.removeEventListener('contextmenu', this._boundCloseContextMenu);
  }

  _closeContextMenu() {
    if (this._contextMenu) {
      this._contextMenu = null;
    }
  }

  handleContextMenu(e, path, type, node = null) {
    e.preventDefault();
    e.stopPropagation();
    
    this._contextMenu = {
      x: e.clientX,
      y: e.clientY,
      path,
      type,
      node
    };
  }

  _getFileMenuItems(filePath) {
    const isModified = this.modified.includes(filePath);
    const isStaged = this.staged.includes(filePath);
    const isUntracked = this.untracked.includes(filePath);
    
    const items = [];
    
    // Stage option for modified or untracked files
    if (isModified || isUntracked) {
      items.push({ label: 'Stage file', action: () => this._stageFile(filePath) });
    }
    
    // Unstage option for staged files
    if (isStaged) {
      items.push({ label: 'Unstage file', action: () => this._unstageFile(filePath) });
    }
    
    // Discard changes for modified files
    if (isModified) {
      items.push({ label: 'Discard changes', action: () => this._discardChanges(filePath), danger: true });
    }
    
    // Delete option (always available, but dangerous for tracked files)
    items.push({ label: 'Delete file', action: () => this._deleteFile(filePath), danger: true });
    
    return items;
  }

  _getDirMenuItems(dirPath, node) {
    const items = [];
    
    // Check if any files in directory are modified/untracked/staged
    const filesInDir = this.collectFilesInDir(node, dirPath);
    const hasUnstagedChanges = filesInDir.some(f => 
      this.modified.includes(f) || this.untracked.includes(f)
    );
    const hasStagedFiles = filesInDir.some(f => this.staged.includes(f));
    
    if (hasUnstagedChanges) {
      items.push({ label: 'Stage all in directory', action: () => this._stageDirectory(dirPath) });
    }
    
    if (hasStagedFiles) {
      items.push({ label: 'Unstage all in directory', action: () => this._unstageDirectory(filesInDir) });
    }
    
    items.push({ label: 'New file...', action: () => this._createNewFile(dirPath) });
    items.push({ label: 'New directory...', action: () => this._createNewDirectory(dirPath) });
    
    return items;
  }

  async _stageFile(filePath) {
    this._closeContextMenu();
    this.dispatchEvent(new CustomEvent('git-operation', {
      detail: { operation: 'stage', paths: [filePath] },
      bubbles: true,
      composed: true
    }));
  }

  async _unstageFile(filePath) {
    this._closeContextMenu();
    this.dispatchEvent(new CustomEvent('git-operation', {
      detail: { operation: 'unstage', paths: [filePath] },
      bubbles: true,
      composed: true
    }));
  }

  async _discardChanges(filePath) {
    this._closeContextMenu();
    if (!confirm(`Discard all changes to "${filePath}"?\n\nThis cannot be undone.`)) {
      return;
    }
    this.dispatchEvent(new CustomEvent('git-operation', {
      detail: { operation: 'discard', paths: [filePath] },
      bubbles: true,
      composed: true
    }));
  }

  async _deleteFile(filePath) {
    this._closeContextMenu();
    if (!confirm(`Delete "${filePath}"?\n\nThis cannot be undone.`)) {
      return;
    }
    this.dispatchEvent(new CustomEvent('git-operation', {
      detail: { operation: 'delete', paths: [filePath] },
      bubbles: true,
      composed: true
    }));
  }

  async _stageDirectory(dirPath) {
    this._closeContextMenu();
    this.dispatchEvent(new CustomEvent('git-operation', {
      detail: { operation: 'stage-dir', paths: [dirPath] },
      bubbles: true,
      composed: true
    }));
  }

  async _unstageDirectory(filesInDir) {
    this._closeContextMenu();
    const stagedFiles = filesInDir.filter(f => this.staged.includes(f));
    this.dispatchEvent(new CustomEvent('git-operation', {
      detail: { operation: 'unstage', paths: stagedFiles },
      bubbles: true,
      composed: true
    }));
  }

  async _createNewFile(dirPath) {
    this._closeContextMenu();
    const fileName = prompt('Enter new file name:');
    if (!fileName) return;
    
    // Remove root prefix from dirPath if present
    const rootName = this.tree?.name || '';
    let relativePath = dirPath;
    if (rootName && dirPath.startsWith(rootName + '/')) {
      relativePath = dirPath.substring(rootName.length + 1);
    } else if (dirPath === rootName) {
      relativePath = '';
    }
    
    const filePath = relativePath ? `${relativePath}/${fileName}` : fileName;
    this.dispatchEvent(new CustomEvent('git-operation', {
      detail: { operation: 'create-file', paths: [filePath] },
      bubbles: true,
      composed: true
    }));
  }

  async _createNewDirectory(dirPath) {
    this._closeContextMenu();
    const dirName = prompt('Enter new directory name:');
    if (!dirName) return;
    
    // Remove root prefix from dirPath if present
    const rootName = this.tree?.name || '';
    let relativePath = dirPath;
    if (rootName && dirPath.startsWith(rootName + '/')) {
      relativePath = dirPath.substring(rootName.length + 1);
    } else if (dirPath === rootName) {
      relativePath = '';
    }
    
    const newDirPath = relativePath ? `${relativePath}/${dirName}` : dirName;
    this.dispatchEvent(new CustomEvent('git-operation', {
      detail: { operation: 'create-dir', paths: [newDirPath] },
      bubbles: true,
      composed: true
    }));
  }

  renderContextMenu() {
    if (!this._contextMenu) return '';
    
    const { x, y, path, type, node } = this._contextMenu;
    const items = type === 'file' 
      ? this._getFileMenuItems(path)
      : this._getDirMenuItems(path, node);
    
    if (items.length === 0) {
      return '';
    }
    
    return html`
      <div class="context-menu" style="left: ${x}px; top: ${y}px;">
        ${items.map(item => html`
          <div 
            class="context-menu-item ${item.danger ? 'danger' : ''}"
            @click=${item.action}
          >
            ${item.label}
          </div>
        `)}
      </div>
    `;
  }
};
