import { html } from 'lit';

/**
 * Mixin for diff editor operations.
 */
export const DiffEditorMixin = (superClass) => class extends superClass {

  initDiffEditor() {
    this._editor = null;
    this._models = new Map();
    this._dirtyFiles = new Set();
    this._contentListeners = new Map();
  }

  createDiffEditor() {
    const container = this.shadowRoot.querySelector('#editor-container');
    if (!container || this._editor) return;

    this._editor = window.monaco.editor.createDiffEditor(container, {
      theme: 'vs-dark',
      automaticLayout: true,
      readOnly: false,
      originalEditable: false,
      renderSideBySide: true,
      minimap: { enabled: false }
    });

    // Add Ctrl+S handler
    this._editor.getModifiedEditor().addCommand(
      window.monaco.KeyMod.CtrlCmd | window.monaco.KeyCode.KeyS,
      () => this.saveCurrentFile()
    );

    if (this.files.length > 0) {
      this.updateModels();
      this.showDiff(this.selectedFile || this.files[0].path);
    }
  }

  updateModels() {
    this._models.forEach(m => {
      m.original.dispose();
      m.modified.dispose();
    });
    this._models.clear();
    
    // Dispose content listeners
    this._contentListeners.forEach(listener => listener.dispose());
    this._contentListeners.clear();
    this._dirtyFiles.clear();
    this.isDirty = false;

    for (const file of this.files) {
      const lang = this.getLanguage(file.path);
      const original = window.monaco.editor.createModel(file.original || '', lang);
      const modified = window.monaco.editor.createModel(file.modified || '', lang);
      this._models.set(file.path, { original, modified, savedContent: file.modified || '' });
      
      // Listen for changes to track dirty state
      const listener = modified.onDidChangeContent(() => {
        const currentContent = modified.getValue();
        const models = this._models.get(file.path);
        const fileDirty = currentContent !== models.savedContent;
        
        if (fileDirty) {
          this._dirtyFiles.add(file.path);
        } else {
          this._dirtyFiles.delete(file.path);
        }
        
        // Update isDirty - true if any file is dirty
        this.isDirty = this._dirtyFiles.size > 0;
      });
      this._contentListeners.set(file.path, listener);
    }
  }

  showDiff(filePath) {
    if (!this._editor || !filePath) return;
    const models = this._models.get(filePath);
    if (models) {
      this._editor.setModel({ original: models.original, modified: models.modified });
    }
  }

  getLanguage(filePath) {
    const ext = filePath.split('.').pop().toLowerCase();
    const map = {
      js: 'javascript', mjs: 'javascript', jsx: 'javascript',
      ts: 'typescript', tsx: 'typescript',
      py: 'python', json: 'json', html: 'html', css: 'css',
      md: 'markdown', yaml: 'yaml', yml: 'yaml', sh: 'shell'
    };
    return map[ext] || 'plaintext';
  }

  disposeDiffEditor() {
    if (this._editor) {
      this._editor.dispose();
      this._editor = null;
    }
    this._models.forEach(m => {
      m.original.dispose();
      m.modified.dispose();
    });
    this._models.clear();
    this._contentListeners.forEach(listener => listener.dispose());
    this._contentListeners.clear();
    this._dirtyFiles.clear();
  }

  clearFiles() {
    this.files = [];
    this.selectedFile = null;
    this.isDirty = false;
    this._models.forEach(m => {
      m.original.dispose();
      m.modified.dispose();
    });
    this._models.clear();
    this._contentListeners.forEach(listener => listener.dispose());
    this._contentListeners.clear();
    this._dirtyFiles.clear();
  }

  saveCurrentFile() {
    if (!this.selectedFile || !this._editor) return;
    if (!this._dirtyFiles.has(this.selectedFile)) return;

    const modifiedEditor = this._editor.getModifiedEditor();
    const newContent = modifiedEditor.getValue();

    // Update saved content and clear dirty state for this file
    const models = this._models.get(this.selectedFile);
    if (models) {
      models.savedContent = newContent;
    }
    this._dirtyFiles.delete(this.selectedFile);
    this.isDirty = this._dirtyFiles.size > 0;

    this.dispatchEvent(new CustomEvent('file-save', {
      detail: { path: this.selectedFile, content: newContent },
      bubbles: true,
      composed: true
    }));
  }

  saveAllFiles() {
    if (this._dirtyFiles.size === 0) return;

    const filesToSave = [];
    
    for (const filePath of this._dirtyFiles) {
      const models = this._models.get(filePath);
      if (models) {
        const newContent = models.modified.getValue();
        models.savedContent = newContent;
        filesToSave.push({ path: filePath, content: newContent });
      }
    }
    
    this._dirtyFiles.clear();
    this.isDirty = false;

    this.dispatchEvent(new CustomEvent('files-save', {
      detail: { files: filesToSave },
      bubbles: true,
      composed: true
    }));
  }
};
