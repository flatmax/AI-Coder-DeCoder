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
    this.initDiffEditor();
  }

  connectedCallback() {
    super.connectedCallback();
    this.addClass(this, 'DiffViewer');
    this.initMonaco();
    console.log('DiffViewer: connectedCallback, serverURI =', this.serverURI);
    console.log('DiffViewer: prototype chain:', Object.getPrototypeOf(this).constructor.name);
    console.log('DiffViewer: has open?', typeof this.open);
    console.log('DiffViewer: has isOpen?', typeof this.isOpen, this.isOpen);
    console.log('DiffViewer: has addClass?', typeof this.addClass);
  }

  firstUpdated() {
    this.injectMonacoStyles();
    onMonacoReady(() => {
      this.createDiffEditor();
      this._tryRegisterLspProviders();
    });
  }

  _tryRegisterLspProviders() {
    if (this._lspProvidersRegistered) return;
    if (!this._editor) {
      console.log('DiffViewer: Editor not ready for LSP');
      return;
    }
    if (!this.isOpen) {
      console.log('DiffViewer: RPC not connected for LSP');
      return;
    }
    
    // Create RPC caller that works with JRPCClient's proxy pattern
    const self = this;
    const rpcCall = new Proxy({}, {
      get: (target, methodPath) => {
        return async (...args) => {
          // methodPath is like "LiteLLM.lsp_get_hover"
          const [className, methodName] = methodPath.split('.');
          // JRPCClient proxies method calls directly
          return self[className][methodName](...args);
        };
      }
    });
    
    try {
      registerSymbolProviders(rpcCall);
      this._lspProvidersRegistered = true;
      console.log('LSP providers registered successfully');
    } catch (e) {
      console.error('Failed to register LSP providers:', e);
    }
  }

  remoteIsUp() {
    console.log('DiffViewer: remoteIsUp called, serverURI =', this.serverURI, 'isOpen =', this.isOpen);
  }

  setupDone() {
    console.log('DiffViewer: setupDone called, serverURI =', this.serverURI, 'isOpen =', this.isOpen);
    this._tryRegisterLspProviders();
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    if (changedProperties.has('serverURI') && this.serverURI) {
      console.log('DiffViewer: serverURI changed to', this.serverURI);
      // Pass to JRPCClient parent - typically done via open() or setting directly
      if (!this.isOpen) {
        this.open(this.serverURI);
      }
    }
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
