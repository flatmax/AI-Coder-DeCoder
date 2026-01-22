import { LitElement, html, css } from 'lit';

let monacoLoading = false;
let monacoLoaded = false;

function loadMonaco() {
  if (monacoLoaded || monacoLoading) return;
  monacoLoading = true;
  
  const loaderScript = document.createElement('script');
  loaderScript.src = '/node_modules/monaco-editor/min/vs/loader.js';
  loaderScript.onload = () => {
    window.require.config({ 
      paths: { 'vs': '/node_modules/monaco-editor/min/vs' }
    });
    window.require(['vs/editor/editor.main'], () => {
      monacoLoaded = true;
    });
  };
  document.head.appendChild(loaderScript);
}

export class DiffViewer extends LitElement {
  static properties = {
    files: { type: Array },
    selectedFile: { type: String },
    visible: { type: Boolean }
  };

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    .container {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: #1e1e1e;
    }

    .file-tabs {
      display: flex;
      background: #252526;
      border-bottom: 1px solid #3c3c3c;
      overflow-x: auto;
      min-height: 35px;
    }

    .file-tab {
      padding: 8px 16px;
      background: transparent;
      border: none;
      color: #969696;
      cursor: pointer;
      font-size: 13px;
      white-space: nowrap;
      border-right: 1px solid #3c3c3c;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .file-tab:hover {
      background: #2a2d2e;
    }

    .file-tab.active {
      background: #1e1e1e;
      color: #fff;
      border-bottom: 2px solid #e94560;
    }

    .file-tab .status {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 3px;
    }

    .file-tab .status.modified {
      background: #f0a500;
      color: #000;
    }

    .file-tab .status.new {
      background: #7ec699;
      color: #000;
    }

    #editor-container {
      flex: 1;
      overflow: hidden;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #666;
      font-size: 16px;
      gap: 12px;
    }

    .empty-state .icon {
      font-size: 48px;
      opacity: 0.5;
    }

    .hidden {
      display: none;
    }
  `;

  constructor() {
    super();
    this.files = [];
    this.selectedFile = null;
    this.visible = false;
    this._editor = null;
    this._models = new Map();
  }

  connectedCallback() {
    super.connectedCallback();
    loadMonaco();
  }

  firstUpdated() {
    this._injectMonacoStyles();
    this._waitForMonaco();
  }

  _injectMonacoStyles() {
    const styleElement = document.createElement('style');
    styleElement.textContent = `@import url('/node_modules/monaco-editor/min/vs/editor/editor.main.css');`;
    this.shadowRoot.appendChild(styleElement);
  }

  _waitForMonaco() {
    if (monacoLoaded && window.monaco) {
      this._initEditor();
    } else {
      setTimeout(() => this._waitForMonaco(), 100);
    }
  }

  _initEditor() {
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
      this._updateModels();
      this._showDiff(this.selectedFile || this.files[0].path);
    }
  }

  updated(changedProperties) {
    if (changedProperties.has('files') && this.files.length > 0 && this._editor) {
      this._updateModels();
      if (!this.selectedFile || !this.files.find(f => f.path === this.selectedFile)) {
        this.selectedFile = this.files[0].path;
      }
      this._showDiff(this.selectedFile);
    }
    
    if (changedProperties.has('selectedFile') && this.selectedFile && this._editor) {
      this._showDiff(this.selectedFile);
    }
  }

  _updateModels() {
    this._models.forEach(m => {
      m.original.dispose();
      m.modified.dispose();
    });
    this._models.clear();

    for (const file of this.files) {
      const lang = this._getLanguage(file.path);
      const original = window.monaco.editor.createModel(file.original || '', lang);
      const modified = window.monaco.editor.createModel(file.modified || '', lang);
      this._models.set(file.path, { original, modified });
    }
  }

  _showDiff(filePath) {
    if (!this._editor || !filePath) return;
    const models = this._models.get(filePath);
    if (models) {
      this._editor.setModel({ original: models.original, modified: models.modified });
    }
  }

  _getLanguage(filePath) {
    const ext = filePath.split('.').pop().toLowerCase();
    const map = {
      js: 'javascript', mjs: 'javascript', jsx: 'javascript',
      ts: 'typescript', tsx: 'typescript',
      py: 'python', json: 'json', html: 'html', css: 'css',
      md: 'markdown', yaml: 'yaml', yml: 'yaml', sh: 'shell'
    };
    return map[ext] || 'plaintext';
  }

  selectFile(filePath) {
    this.selectedFile = filePath;
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

  disconnectedCallback() {
    super.disconnectedCallback();
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

  render() {
    const hasFiles = this.files.length > 0;

    return html`
      <div class="container ${!this.visible ? 'hidden' : ''}">
        ${hasFiles ? html`
          <div class="file-tabs">
            ${this.files.map(file => html`
              <button 
                class="file-tab ${this.selectedFile === file.path ? 'active' : ''}"
                @click=${() => this.selectFile(file.path)}
              >
                ${file.path}
                <span class="status ${file.isNew ? 'new' : 'modified'}">
                  ${file.isNew ? 'NEW' : 'MOD'}
                </span>
              </button>
            `)}
          </div>
        ` : html`
          <div class="empty-state">
            <div class="icon">📝</div>
            <div>No changes to display</div>
            <div style="font-size: 13px; color: #555;">
              Send a message to make code changes
            </div>
          </div>
        `}
        <div id="editor-container"></div>
      </div>
    `;
  }
}

customElements.define('diff-viewer', DiffViewer);
