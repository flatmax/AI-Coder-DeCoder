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
    serverURI: { type: String }
  };

  static styles = diffViewerStyles;

  constructor() {
    super();
    this.files = [];
    this.selectedFile = null;
    this.visible = false;
    this.isDirty = false;
    this.serverURI = null;
    this.initDiffEditor();
  }

  connectedCallback() {
    super.connectedCallback();
    this.initMonaco();
    this._connectToServer();
  }

  _connectToServer() {
    if (this.serverURI && !this.isOpen) {
      this.open(this.serverURI);
    }
  }

  firstUpdated() {
    this.injectMonacoStyles();
    onMonacoReady(() => {
      this.createDiffEditor();
      this._registerLspProviders();
    });
  }

  _registerLspProviders() {
    if (this._lspProvidersRegistered) return;
    
    try {
      registerSymbolProviders(this.call);
      this._lspProvidersRegistered = true;
    } catch (e) {
      console.error('Failed to register LSP providers:', e);
    }
  }

  remoteIsUp() {
    // Called when JSON-RPC connection is established
    console.log('DiffViewer: JSON-RPC connection established');
  }

  updated(changedProperties) {
    if (changedProperties.has('files') && this.files.length > 0 && this._editor) {
      this.updateModels();
      if (!this.selectedFile || !this.files.find(f => f.path === this.selectedFile)) {
        this.selectedFile = this.files[0].path;
      }
      this.showDiff(this.selectedFile);
    }
    
    if (changedProperties.has('selectedFile') && this.selectedFile && this._editor) {
      this.showDiff(this.selectedFile);
    }

    if (changedProperties.has('isDirty')) {
      this.dispatchEvent(new CustomEvent('isDirty-changed', {
        detail: { isDirty: this.isDirty },
        bubbles: true,
        composed: true
      }));
    }
  }

  selectFile(filePath) {
    this.selectedFile = filePath;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.disposeDiffEditor();
    if (this.isOpen) {
      this.close();
    }
  }

  render() {
    return renderDiffViewer(this);
  }
}

customElements.define('diff-viewer', DiffViewer);
