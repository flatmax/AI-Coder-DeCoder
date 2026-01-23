import { LitElement } from 'lit';
import { filePickerStyles } from './FilePickerStyles.js';
import { renderFilePicker } from './FilePickerTemplate.js';
import { FileSelectionMixin } from './FileSelectionMixin.js';
import { FileNodeRendererMixin } from './FileNodeRendererMixin.js';

const MixedBase = FileNodeRendererMixin(
  FileSelectionMixin(LitElement)
);

export class FilePicker extends MixedBase {
  static properties = {
    tree: { type: Object },
    modified: { type: Array },
    staged: { type: Array },
    untracked: { type: Array },
    selected: { type: Object },
    expanded: { type: Object },
    filter: { type: String }
  };

  static styles = filePickerStyles;

  constructor() {
    super();
    this.tree = null;
    this.modified = [];
    this.staged = [];
    this.untracked = [];
    this.selected = {};
    this.expanded = {};
    this.filter = '';
  }

  render() {
    return renderFilePicker(this);
  }
}

customElements.define('file-picker', FilePicker);
