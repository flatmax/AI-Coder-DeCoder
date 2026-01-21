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
  }

  clearHistory() {
    this.messageHistory = [];
  }
}
