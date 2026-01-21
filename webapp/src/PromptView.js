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
    const port = urlParams.get('port');
    if (port) {
      this.serverURI = `ws://localhost:${port}`;
    }
  }

  connectedCallback() {
    super.connectedCallback();
    this.addClass(this);
  }

  remoteIsUp() {
    console.log('PromptView::remoteIsUp - WebSocket connected');
  }

  setupDone() {
    console.log('PromptView::setupDone - JRPC connection ready');
    this.isConnected = true;
  }

  remoteDisconnected(uuid) {
    console.log('PromptView::remoteDisconnected', uuid);
    this.isConnected = false;
  }

  async sendMessage() {
    if (!this.inputValue.trim()) return;
    
    this.addMessage('user', this.inputValue);
    const message = this.inputValue;
    this.inputValue = '';
    
    try {
      const response = await this.call['LiteLLM.ping']();
      this.addMessage('assistant', response);
    } catch (e) {
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
