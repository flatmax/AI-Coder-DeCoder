import { html } from 'lit';

/**
 * Mixin for diff editor operations.
 */
export const DiffEditorMixin = (superClass) => class extends superClass {

  initDiffEditor() {
    this._editor = null;
    this._models = new Map();
  }

  createDiffEditor() {
    const container = this.shadowRoot.querySelector('#editor-container');
    if (!container || this._editor) return;

    this._editor = window.monaco.editor.createDiffEditor(container, {
      theme: 'vs-dark',
      automaticLayout: true,
      readOnly: true,
      renderSideBySide: true,
      minimap: { enabled: false }
    });

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

    for (const file of this.files) {
      const lang = this.getLanguage(file.path);
      const original = window.monaco.editor.createModel(file.original || '', lang);
      const modified = window.monaco.editor.createModel(file.modified || '', lang);
      this._models.set(file.path, { original, modified });
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
  }

  clearFiles() {
    this.files = [];
    this.selectedFile = null;
    this._models.forEach(m => {
      m.original.dispose();
      m.modified.dispose();
    });
    this._models.clear();
  }
};
