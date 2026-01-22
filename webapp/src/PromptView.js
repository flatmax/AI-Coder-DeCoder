import { html } from 'lit';
import { MessageHandler } from './MessageHandler.js';
import { promptViewStyles } from './prompt/PromptViewStyles.js';
import { renderPromptView } from './prompt/PromptViewTemplate.js';
import './file-picker/FilePicker.js';

export class PromptView extends MessageHandler {
  static properties = {
    inputValue: { type: String },
    minimized: { type: Boolean },
    isConnected: { type: Boolean },
    fileTree: { type: Object },
    modifiedFiles: { type: Array },
    stagedFiles: { type: Array },
    selectedFiles: { type: Array },
    showFilePicker: { type: Boolean }
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
    this.selectedFiles = [];
    this.showFilePicker = false;
    
    // Check if port is specified in URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    this.port = urlParams.get('port');
  }

  connectedCallback() {
    super.connectedCallback();
    this.addClass(this);
  }

  remoteIsUp() {
    // WebSocket connected
  }

  async setupDone() {
    this.isConnected = true;
    await this.loadFileTree();
  }

  remoteDisconnected(uuid) {
    this.isConnected = false;
  }

  extractResponse(response) {
    // Response is in format {uuid: data}
    // Extract the data from the first (and typically only) uuid key
    if (response && typeof response === 'object') {
      const keys = Object.keys(response);
      if (keys.length > 0) {
        return response[keys[0]];
      }
    }
    return response;
  }

  async loadFileTree() {
    try {
      const response = await this.call['Repo.get_file_tree']();
      const data = this.extractResponse(response);
      if (data && !data.error) {
        this.fileTree = data.tree;
        this.modifiedFiles = data.modified || [];
        this.stagedFiles = data.staged || [];
      }
    } catch (e) {
      console.error('Error loading file tree:', e);
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

  async sendMessage() {
    if (!this.inputValue.trim()) return;
    
    this.addMessage('user', this.inputValue);
    const message = this.inputValue;
    this.inputValue = '';
    
    try {
      const response = await this.call['LiteLLM.chat'](
        message,
        this.selectedFiles.length > 0 ? this.selectedFiles : null
      );
      const responseText = this.extractResponse(response);
      this.addMessage('assistant', responseText);
    } catch (e) {
      console.error('Error sending message:', e);
      this.addMessage('assistant', `Error: ${e.message}`);
    }
  }

  handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.sendMessage();
    }
  }

  handleInput(e) {
    this.inputValue = e.target.value;
  }

  toggleMinimize() {
    this.minimized = !this.minimized;
  }

  render() {
    return renderPromptView(this);
  }
}
