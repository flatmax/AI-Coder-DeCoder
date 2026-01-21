import { JRPCClient } from '@flatmax/jrpc-oo';

export class MessageHandler extends JRPCClient {
  static properties = {
    serverURI: { type: String },
    messageHistory: { type: Array }
  };

  constructor() {
    super();
    console.log('MessageHandler::constructor');
    this.messageHistory = [];
    this._messageId = 0;
  }

  connectedCallback() {
    console.log('MessageHandler::connectedCallback');
    super.connectedCallback();
    if (this.port) {
      this.serverURI = `ws://localhost:${this.port}`;
      console.log('PromptView::constructor - serverURI:', this.serverURI);
    }
  }

  addMessage(role, content) {
    console.log('MessageHandler::addMessage', { role, content });
    this.messageHistory = [
      ...this.messageHistory,
      { id: this._messageId++, role, content }
    ];
  }

  streamWrite(chunk, final = false, role = 'assistant') {
    console.log('MessageHandler::streamWrite', { chunk, final, role });
    setTimeout(() => this._processStreamChunk(chunk, final, role), 0);
  }

  _processStreamChunk(chunk, final, role) {
    console.log('MessageHandler::_processStreamChunk', { chunk, final, role });
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
    console.log('MessageHandler::clearHistory');
    this.messageHistory = [];
  }
}
