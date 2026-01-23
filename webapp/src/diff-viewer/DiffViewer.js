import { LitElement } from 'lit';
import { diffViewerStyles } from './DiffViewerStyles.js';
import { renderDiffViewer } from './DiffViewerTemplate.js';
import { MonacoLoaderMixin } from './MonacoLoaderMixin.js';
import { DiffEditorMixin } from './DiffEditorMixin.js';

const MixedBase = DiffEditorMixin(
  MonacoLoaderMixin(LitElement)
);

export class DiffViewer extends MixedBase {
  static properties = {
    files: { type: Array },
    selectedFile: { type: String },
    visible: { type: Boolean }
  };

  static styles = diffViewerStyles;

  constructor() {
    super();
    this.files = [];
    this.selectedFile = null;
    this.visible = false;
    this.initDiffEditor();
  }

  connectedCallback() {
    super.connectedCallback();
    this.initMonaco();
  }

  firstUpdated() {
    this.injectMonacoStyles();
    this.waitForMonaco(() => this.createDiffEditor());
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
  }

  selectFile(filePath) {
    this.selectedFile = filePath;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.disposeDiffEditor();
  }

  render() {
    return renderDiffViewer(this);
  }
}

customElements.define('diff-viewer', DiffViewer);
