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
    console.log('PromptView::constructor');
    this.inputValue = '';
    this.minimized = false;
    this.isConnected = false;
    
    // Check if port is specified in URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    this.port = urlParams.get('port');
    console.log('PromptView::constructor - port from URL:', this.port);
  }

  connectedCallback() {
    console.log('PromptView::connectedCallback');
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
    console.log('PromptView::sendMessage', { inputValue: this.inputValue });
    if (!this.inputValue.trim()) return;
    
    this.addMessage('user', this.inputValue);
    const message = this.inputValue;
    this.inputValue = '';
    
    try {
      console.log('PromptView::sendMessage - calling LiteLLM.ping');
      const response = await this.call['LiteLLM.ping']();
      console.log('PromptView::sendMessage - response:', response);
      this.addMessage('assistant', response);
    } catch (e) {
      console.error('PromptView::sendMessage - error:', e);
      this.addMessage('assistant', `Error: ${e.message}`);
    }
  }

  handleKeyDown(e) {
    console.log('PromptView::handleKeyDown', { key: e.key, shiftKey: e.shiftKey });
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.sendMessage();
    }
  }

  handleInput(e) {
    console.log('PromptView::handleInput', { value: e.target.value });
    this.inputValue = e.target.value;
  }

  toggleMinimize() {
    console.log('PromptView::toggleMinimize', { minimized: this.minimized });
    this.minimized = !this.minimized;
  }

  render() {
    console.log('PromptView::render');
    return renderPromptView(this);
  }
}
