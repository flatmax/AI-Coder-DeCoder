import { JRPCClient } from '@flatmax/jrpc-oo';

export class MessageHandler extends JRPCClient {
  static properties = {
    serverURI: { type: String },
    messageHistory: { type: Array }
  };

  constructor() {
    super();
    this.messageHistory = [];
    this._messageId = 0;
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.port) {
      this.serverURI = `ws://localhost:${this.port}`;
    }
  }

  addMessage(role, content) {
    this.messageHistory = [
      ...this.messageHistory,
      { id: this._messageId++, role, content }
    ];
  }

  streamWrite(chunk, final = false, role = 'assistant') {
    setTimeout(() => this._processStreamChunk(chunk, final, role), 0);
  }

  _processStreamChunk(chunk, final, role) {
    const lastMessage = this.messageHistory[this.messageHistory.length - 1];
    
    if (lastMessage && lastMessage.role === role && !lastMessage.final) {
      lastMessage.content = chunk;
      lastMessage.final = final;
      this.messageHistory = [...this.messageHistory];
    } else {
      this.messageHistory = [
        ...this.messageHistory,
        { id: this._messageId++, role, content: chunk, final }
      ];
    }
    this._scrollToBottom();
  }

  _scrollToBottom() {
    this.updateComplete.then(() => {
      const container = this.shadowRoot?.querySelector('#messages-container');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    });
  }

  clearHistory() {
    this.messageHistory = [];
  }
}
