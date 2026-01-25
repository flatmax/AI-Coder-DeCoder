import { JRPCClient } from '@flatmax/jrpc-oo';

export class MessageHandler extends JRPCClient {
  static properties = {
    serverURI: { type: String },
    messageHistory: { type: Array },
    _showScrollButton: { type: Boolean, state: true }
  };

  constructor() {
    super();
    this.messageHistory = [];
    this._messageId = 0;
    this._autoScrollPaused = false;
    this._showScrollButton = false;
    this._boundHandleScroll = this._handleScroll.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.port) {
      this.serverURI = `ws://localhost:${this.port}`;
    }
  }

  firstUpdated() {
    super.firstUpdated?.();
    const container = this.shadowRoot?.querySelector('#messages-container');
    if (container) {
      // Use capture: false to only handle scroll events from the container itself
      container.addEventListener('scroll', this._boundHandleScroll, { passive: true });
    }
  }

  _handleScroll(event) {
    // Ignore scroll events from child elements (like code blocks)
    const container = this.shadowRoot?.querySelector('#messages-container');
    if (!container || event.target !== container) return;
    
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const isAtBottom = distanceFromBottom < 50; // 50px threshold
    
    this._autoScrollPaused = !isAtBottom;
    this._showScrollButton = !isAtBottom;
  }

  scrollToBottomNow() {
    this._autoScrollPaused = false;
    this._showScrollButton = false;
    const container = this.shadowRoot?.querySelector('#messages-container');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  addMessage(role, content, images = null) {
    const message = { id: this._messageId++, role, content };
    if (images) {
      message.images = images;
    }
    this.messageHistory = [...this.messageHistory, message];
    this._scrollToBottom();
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
    if (this._autoScrollPaused) return;
    
    this.updateComplete.then(() => {
      const container = this.shadowRoot?.querySelector('#messages-container');
      if (container) {
        // Use requestAnimationFrame to ensure DOM has fully rendered
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight;
        });
      }
    });
  }

  clearHistory() {
    this.messageHistory = [];
  }
}
