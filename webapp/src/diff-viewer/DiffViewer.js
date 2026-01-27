import { JRPCClient } from '@flatmax/jrpc-oo';
import { diffViewerStyles } from './DiffViewerStyles.js';
import { renderDiffViewer } from './DiffViewerTemplate.js';
import { MonacoLoaderMixin, onMonacoReady } from './MonacoLoaderMixin.js';
import { DiffEditorMixin } from './DiffEditorMixin.js';
import { registerSymbolProviders } from '../lsp/SymbolProvider.js';

const MixedBase = DiffEditorMixin(
  MonacoLoaderMixin(JRPCClient)
);

export class DiffViewer extends MixedBase {
  static properties = {
    files: { type: Array },
    selectedFile: { type: String },
    visible: { type: Boolean },
    isDirty: { type: Boolean },
    serverURI: { type: String },
    viewingFile: { type: String }
  };

  static styles = diffViewerStyles;

  constructor() {
    super();
    this.files = [];
    this.selectedFile = null;
    this.visible = false;
    this.isDirty = false;
    this.initDiffEditor();
  }

  connectedCallback() {
    super.connectedCallback();
    this.addClass(this, 'DiffViewer');
    this.initMonaco();
    
    // Listen for LSP navigation events
    this._handleLspNavigate = this._handleLspNavigate.bind(this);
    window.addEventListener('lsp-navigate-to-file', this._handleLspNavigate);
  }

  firstUpdated() {
    this.injectMonacoStyles();
    onMonacoReady(() => {
      this.createDiffEditor();
    });
  }

  _tryRegisterLspProviders() {
    if (this._lspProvidersRegistered) return;
    if (!this._editor || !this._remoteIsUp) return;
    
    try {
      registerSymbolProviders(this);
      this._lspProvidersRegistered = true;
    } catch (e) {
      console.error('Failed to register LSP providers:', e);
    }
  }

  remoteIsUp() {
    this._remoteIsUp = true;
    this._tryRegisterLspProviders();
  }

  setupDone() {}

  remoteDisconnected(uuid) {
    this._remoteIsUp = false;
    this._lspProvidersRegistered = false;
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    if (changedProperties.has('files') && this.files.length > 0 && this._editor) {
      this.updateModels();
      if (!this.selectedFile || !this.files.find(f => f.path === this.selectedFile)) {
        this.selectedFile = this.files[0].path;
      }
      this.showDiff(this.selectedFile);
      this._emitFileSelected(this.selectedFile);
    }
    
    if (changedProperties.has('selectedFile') && this.selectedFile && this._editor) {
      this.showDiff(this.selectedFile);
      this._emitFileSelected(this.selectedFile);
    }

    if (changedProperties.has('isDirty')) {
      this.dispatchEvent(new CustomEvent('isDirty-changed', {
        detail: { isDirty: this.isDirty },
        bubbles: true,
        composed: true
      }));
    }

    // Handle external file open requests (e.g., from find-in-files)
    if (changedProperties.has('viewingFile') && this.viewingFile) {
      this._openExternalFile(this.viewingFile);
    }
  }

  selectFile(filePath) {
    this.selectedFile = filePath;
    this._emitFileSelected(filePath);
  }

  _emitFileSelected(filePath) {
    if (filePath) {
      this.dispatchEvent(new CustomEvent('file-selected', {
        detail: { path: filePath },
        bubbles: true,
        composed: true
      }));
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.disposeDiffEditor();
    window.removeEventListener('lsp-navigate-to-file', this._handleLspNavigate);
  }

  async _handleLspNavigate(event) {
    const { file, line, column } = event.detail;
    
    // Check if file is already loaded
    const existingFile = this.files.find(f => f.path === file);
    if (existingFile) {
      this.selectedFile = file;
      this._revealPosition(line, column);
      return;
    }
    
    // Load the file content from server
    try {
      const response = await this.call['Repo.get_file_content'](file);
      const result = response ? Object.values(response)[0] : null;
      
      // Check if we got content - it might be result.content or just result as a string
      const content = typeof result === 'string' ? result : (result?.content ?? null);
      
      if (content !== null) {
        // Add as a read-only file (same content for original and modified)
        const newFile = {
          path: file,
          original: content,
          modified: content,
          isNew: false,
          isReadOnly: true
        };
        
        this.files = [...this.files, newFile];
        this.selectedFile = file;
        
        // Wait for update to complete, then reveal position
        await this.updateComplete;
        this._revealPosition(line, column);
      } else {
        console.error('Failed to load file for navigation:', file);
      }
    } catch (e) {
      console.error('Error loading file for navigation:', e);
    }
  }

  _revealPosition(line, column) {
    if (!this._editor || !line) return;
    
    // Use the modified editor for navigation
    const editor = this._editor.getModifiedEditor();
    if (editor) {
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: column || 1 });
      editor.focus();
      
      // Add highlight decoration that fades out
      this._highlightLine(editor, line);
    }
  }

  _highlightLine(editor, line) {
    // Remove any existing highlight
    if (this._highlightDecorations) {
      editor.deltaDecorations(this._highlightDecorations, []);
    }
    
    // Add new highlight decoration
    this._highlightDecorations = editor.deltaDecorations([], [
      {
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: 'line-highlight-decoration'
        }
      }
    ]);
    
    // Remove highlight after animation completes
    setTimeout(() => {
      if (this._highlightDecorations) {
        editor.deltaDecorations(this._highlightDecorations, []);
        this._highlightDecorations = null;
      }
    }, 1500);
  }

  /**
   * Find line number by searching for content in the current file.
   * @param {string} searchText - Text to search for
   * @returns {number|null} - Line number (1-based) or null if not found
   */
  _findLineByContent(searchText) {
    if (!this._editor || !searchText) return null;
    
    const editor = this._editor.getModifiedEditor();
    if (!editor) return null;
    
    const model = editor.getModel();
    if (!model) return null;
    
    const content = model.getValue();
    const lines = content.split('\n');
    
    // Search for the line containing the text
    const searchTrimmed = searchText.trim();
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(searchTrimmed) || lines[i].trim() === searchTrimmed) {
        return i + 1; // Convert to 1-based line number
      }
    }
    
    return null;
  }

  _openExternalFile(filePath) {
    if (!filePath) return;
    
    // Check if file is already loaded - just select it
    const existingFile = this.files.find(f => f.path === filePath);
    if (existingFile) {
      this.selectedFile = filePath;
    }
    // File loading is now handled by AppShell
  }

  render() {
    return renderDiffViewer(this);
  }
}

customElements.define('diff-viewer', DiffViewer);
