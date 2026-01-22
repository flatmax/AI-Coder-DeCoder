import { html } from 'lit';
import { MessageHandler } from './MessageHandler.js';
import { promptViewStyles } from './prompt/PromptViewStyles.js';
import { renderPromptView } from './prompt/PromptViewTemplate.js';

export class PromptView extends MessageHandler {
  static properties = {
    inputValue: { type: String },
    minimized: { type: Boolean },
    isConnected: { type: Boolean }
  };

  static styles = promptViewStyles;

  constructor() {
    super();
    this.inputValue = '';
    this.minimized = false;
    this.isConnected = false;
    
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

  setupDone() {
    this.isConnected = true;
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

  async sendMessage() {
    if (!this.inputValue.trim()) return;
    
    this.addMessage('user', this.inputValue);
    const message = this.inputValue;
    this.inputValue = '';
    
    try {
      const response = await this.call['LiteLLM.chat'](message);
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
