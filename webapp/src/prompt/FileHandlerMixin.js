/**
 * Mixin for file tree and selection handling.
 */
export const FileHandlerMixin = (superClass) => class extends superClass {
  
  connectedCallback() {
    super.connectedCallback();
    this._boundHandleGitOperation = this.handleGitOperation.bind(this);
    this.addEventListener('git-operation', this._boundHandleGitOperation);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('git-operation', this._boundHandleGitOperation);
  }

  async handleGitOperation(e) {
    const { operation, paths } = e.detail;
    
    try {
      switch (operation) {
        case 'stage':
          await this.call['Repo.stage_files'](paths);
          break;
        case 'stage-dir':
          await this.call['Repo.stage_files'](paths);
          break;
        case 'unstage':
          await this.call['Repo.unstage_files'](paths);
          break;
        case 'discard':
          await this.call['Repo.discard_changes'](paths);
          break;
        case 'delete':
          await this.call['Repo.delete_file'](paths[0]);
          break;
        case 'create-file':
          await this.call['Repo.create_file'](paths[0], '');
          break;
        case 'create-dir':
          await this.call['Repo.create_directory'](paths[0]);
          break;
        default:
          console.warn('Unknown git operation:', operation);
          return;
      }
      
      // Reload the file tree to reflect changes
      await this.loadFileTree();
    } catch (err) {
      console.error(`Git operation "${operation}" failed:`, err);
    }
  }

  async loadFileTree() {
    try {
      const response = await this.call['Repo.get_file_tree']();
      const data = this.extractResponse(response);
      if (data && !data.error) {
        this.fileTree = data.tree;
        this.modifiedFiles = data.modified || [];
        this.stagedFiles = data.staged || [];
        this.untrackedFiles = data.untracked || [];
        this.diffStats = data.diffStats || {};
      }
    } catch (e) {
      console.error('Error loading file tree:', e);
    }
  }

  toggleFilePicker() {
    this.showFilePicker = !this.showFilePicker;
    if (this.showFilePicker && !this.fileTree) {
      this.loadFileTree();
    }
  }

  handleSelectionChange(e) {
    this.selectedFiles = e.detail;
  }

  async handleFileView(e) {
    const { path } = e.detail;
    try {
      const workingResponse = await this.call['Repo.get_file_content'](path, 'working');
      const workingContent = this.extractResponse(workingResponse);
      
      let headContent = '';
      try {
        const headResponse = await this.call['Repo.get_file_content'](path, 'HEAD');
        headContent = this.extractResponse(headResponse);
        if (typeof headContent !== 'string') headContent = '';
      } catch (e) {
        headContent = '';
      }

      const isNew = headContent === '';
      const isModified = this.modifiedFiles.includes(path);
      
      this.dispatchEvent(new CustomEvent('edits-applied', {
        detail: {
          files: [{
            path,
            original: headContent,
            modified: typeof workingContent === 'string' ? workingContent : '',
            isNew: isNew && !isModified
          }]
        },
        bubbles: true,
        composed: true
      }));
    } catch (e) {
      console.error('Error viewing file:', e);
    }
  }

  _handleAtMention(value) {
    const lastAtIndex = value.lastIndexOf('@');
    
    if (lastAtIndex !== -1) {
      const afterAt = value.substring(lastAtIndex + 1);
      const spaceIndex = afterAt.indexOf(' ');
      const filterText = spaceIndex === -1 ? afterAt : afterAt.substring(0, spaceIndex);
      
      if (spaceIndex === -1 && afterAt.length >= 0) {
        this.showFilePicker = true;
        this._setFilePickerFilter(filterText);
      }
    }
  }

  _setFilePickerFilter(filterText) {
    const filePicker = this.shadowRoot?.querySelector('file-picker');
    if (filePicker) {
      filePicker.filter = filterText;
    }
  }

  handleFileMentionClick(e) {
    const { path } = e.detail;
    if (!path) return;
    
    // Toggle the file selection in the file picker
    const filePicker = this.shadowRoot?.querySelector('file-picker');
    if (filePicker) {
      // Toggle the selection
      const newSelected = { ...filePicker.selected };
      newSelected[path] = !newSelected[path];
      filePicker.selected = newSelected;
      
      // Update our selectedFiles to match
      this.selectedFiles = Object.keys(newSelected).filter(k => newSelected[k]);
      
      // Dispatch the selection change event
      filePicker.dispatchEvent(new CustomEvent('selection-change', { detail: this.selectedFiles }));
    }
  }

  getAddableFiles() {
    // Return all files in the tree that could be added
    if (!this.fileTree) return [];
    
    const files = [];
    const collectFiles = (node) => {
      if (node.path) {
        files.push(node.path);
      }
      if (node.children) {
        node.children.forEach(collectFiles);
      }
    };
    collectFiles(this.fileTree);
    return files;
  }
};
