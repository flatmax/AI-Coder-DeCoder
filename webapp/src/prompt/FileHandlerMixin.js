/**
 * Mixin for file tree and selection handling.
 */
export const FileHandlerMixin = (superClass) => class extends superClass {
  
  async loadFileTree() {
    try {
      const response = await this.call['Repo.get_file_tree']();
      const data = this.extractResponse(response);
      if (data && !data.error) {
        this.fileTree = data.tree;
        this.modifiedFiles = data.modified || [];
        this.stagedFiles = data.staged || [];
        this.untrackedFiles = data.untracked || [];
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
};
