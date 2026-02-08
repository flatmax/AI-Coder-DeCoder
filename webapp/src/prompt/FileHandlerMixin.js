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
      this.addMessage('assistant', `⚠️ **Git operation failed:** ${operation}\n\n${err.message || err}`);
    }
  }

  async loadFileTree() {
    if (!this.call) {
      console.warn('loadFileTree called but RPC not ready');
      return;
    }
    
    try {
      const response = await this.call['Repo.get_file_tree']();
      const data = this.extractResponse(response);
      if (data && !data.error) {
        // Stabilize tree reference — only replace when content actually changed.
        // This avoids downstream O(n) tree walks and cache invalidation on every refresh.
        const treeJson = JSON.stringify(data.tree);
        if (treeJson !== this._lastTreeJson) {
          this._lastTreeJson = treeJson;
          this.fileTree = data.tree;
        }
        this.modifiedFiles = data.modified || [];
        this.stagedFiles = data.staged || [];
        this.untrackedFiles = data.untracked || [];
        this.diffStats = data.diffStats || {};
      }
    } catch (e) {
      console.error('Error loading file tree:', e);
      this.addMessage('assistant', `⚠️ **Failed to load file tree.** The server may be unavailable.`);
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

  handleCopyPathToPrompt(e) {
    const { path } = e.detail;
    if (!path) return;
    
    // Append the path to the current input value with a trailing space
    const separator = this.inputValue && !this.inputValue.endsWith(' ') ? ' ' : '';
    this.inputValue = this.inputValue + separator + path + ' ';
    
    // Focus the textarea
    this.updateComplete.then(() => {
      const textarea = this.shadowRoot?.querySelector('textarea');
      if (textarea) {
        textarea.focus();
        // Move cursor to end
        textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
      }
    });
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
      } else {
        this._clearFilePickerFilter();
      }
    } else {
      this._clearFilePickerFilter();
    }
  }

  _setFilePickerFilter(filterText) {
    const filePicker = this.shadowRoot?.querySelector('file-picker');
    if (filePicker) {
      filePicker.filter = filterText;
      // Auto-focus first visible file when filter changes
      filePicker.updateComplete.then(() => {
        const visible = filePicker.getVisibleFiles();
        filePicker.focusedFile = visible.length > 0 ? visible[0] : '';
      });
    }
  }

  _clearFilePickerFilter() {
    const filePicker = this.shadowRoot?.querySelector('file-picker');
    if (filePicker && filePicker.filter) {
      filePicker.filter = '';
      filePicker.focusedFile = '';
    }
  }

  /** Clear @mention from input and reset file picker filter */
  _clearAtMention() {
    this.inputValue = this.inputValue.replace(/@\S*$/, '').trimEnd();
    const filePicker = this.shadowRoot?.querySelector('file-picker');
    if (filePicker) {
      filePicker.filter = '';
      filePicker.focusedFile = '';
    }
    this.updateComplete.then(() => {
      const textarea = this.shadowRoot?.querySelector('textarea');
      if (textarea) {
        textarea.value = this.inputValue;
        this._autoResizeTextarea(textarea);
        textarea.focus();
      }
    });
  }

  handleFileMentionClick(e) {
    const { path } = e.detail;
    if (!path) return;
    
    const filePicker = this.shadowRoot?.querySelector('file-picker');
    if (filePicker) {
      const newSelected = { ...filePicker.selected };
      const fileName = path.split('/').pop();
      const isCurrentlySelected = newSelected[path];
      
      // Toggle the selection
      if (isCurrentlySelected) {
        delete newSelected[path];
      } else {
        newSelected[path] = true;
      }
      
      filePicker.selected = newSelected;
      this.selectedFiles = Object.keys(newSelected).filter(k => newSelected[k]);
      filePicker.dispatchEvent(new CustomEvent('selection-change', { detail: this.selectedFiles }));
      
      // Auto-populate input to indicate file was added/removed
      const questionSuffix = 'Do you want to see more files before you continue?';
      if (!isCurrentlySelected) {
        // File was added
        const addedMatch = this.inputValue.match(/^The files? (.+) added\. /);
        if (addedMatch) {
          this.inputValue = `The files ${addedMatch[1]}, ${fileName} added. ${questionSuffix}`;
        } else if (this.inputValue.trim() === '') {
          this.inputValue = `The file ${fileName} added. ${questionSuffix}`;
        } else {
          this.inputValue = this.inputValue.trimEnd() + ` (added ${fileName}) `;
        }
      } else {
        // File was removed - clear input if it was just the "added" message
        const addedMatch = this.inputValue.match(/^The files? (.+) added\. /);
        if (addedMatch) {
          // Remove this file from the list
          const files = addedMatch[1].split(', ').filter(f => f !== fileName);
          if (files.length === 0) {
            this.inputValue = '';
          } else if (files.length === 1) {
            this.inputValue = `The file ${files[0]} added. ${questionSuffix}`;
          } else {
            this.inputValue = `The files ${files.join(', ')} added. ${questionSuffix}`;
          }
        }
      }
      
      // Focus the textarea
      this.updateComplete.then(() => {
        const textarea = this.shadowRoot?.querySelector('textarea');
        if (textarea) {
          textarea.focus();
          textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
        }
      });
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
