import { html } from 'lit';
import { MessageHandler } from './MessageHandler.js';
import { promptViewStyles } from './prompt/PromptViewStyles.js';
import { renderPromptView } from './prompt/PromptViewTemplate.js';
import { FileHandlerMixin } from './prompt/FileHandlerMixin.js';
import { ImageHandlerMixin } from './prompt/ImageHandlerMixin.js';
import { ChatActionsMixin } from './prompt/ChatActionsMixin.js';
import { InputHandlerMixin } from './prompt/InputHandlerMixin.js';
import { DragHandlerMixin } from './prompt/DragHandlerMixin.js';
import { StreamingMixin } from './prompt/StreamingMixin.js';
import './file-picker/FilePicker.js';

const MixedBase = StreamingMixin(
  DragHandlerMixin(
    InputHandlerMixin(
      ChatActionsMixin(
        ImageHandlerMixin(
          FileHandlerMixin(MessageHandler)
        )
      )
    )
  )
);

export class PromptView extends MixedBase {
  static properties = {
    inputValue: { type: String },
    minimized: { type: Boolean },
    isConnected: { type: Boolean },
    fileTree: { type: Object },
    modifiedFiles: { type: Array },
    stagedFiles: { type: Array },
    untrackedFiles: { type: Array },
    selectedFiles: { type: Array },
    showFilePicker: { type: Boolean },
    pastedImages: { type: Array },
    dialogX: { type: Number },
    dialogY: { type: Number }
  };

  static styles = promptViewStyles;

  constructor() {
    super();
    this.inputValue = '';
    this.minimized = false;
    this.isConnected = false;
    this.fileTree = null;
    this.modifiedFiles = [];
    this.stagedFiles = [];
    this.untrackedFiles = [];
    this.selectedFiles = [];
    this.showFilePicker = true;
    this.pastedImages = [];
    this.dialogX = null;
    this.dialogY = null;
    
    const urlParams = new URLSearchParams(window.location.search);
    this.port = urlParams.get('port');
  }

  connectedCallback() {
    super.connectedCallback();
    this.addClass(this);
    this.initImageHandler();
    this.initDragHandler();
    this.initStreaming();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.destroyImageHandler();
    this.destroyDragHandler();
  }

  remoteIsUp() {}

  async setupDone() {
    this.isConnected = true;
    await this.loadFileTree();
  }

  remoteDisconnected(uuid) {
    this.isConnected = false;
  }

  extractResponse(response) {
    if (response && typeof response === 'object') {
      const keys = Object.keys(response);
      if (keys.length > 0) {
        return response[keys[0]];
      }
    }
    return response;
  }

  /**
   * Called by server when a chunk of the response is available.
   * Explicitly defined here so JRPC-OO can find it.
   * Delegates to mixin implementation.
   */
  streamChunk(requestId, content) {
    super.streamChunk(requestId, content);
  }

  /**
   * Called by server when streaming is complete.
   * Explicitly defined here so JRPC-OO can find it.
   * Delegates to mixin implementation.
   */
  async streamComplete(requestId, result) {
    await super.streamComplete(requestId, result);
  }

  render() {
    return renderPromptView(this);
  }
}

customElements.define('prompt-view', PromptView);
