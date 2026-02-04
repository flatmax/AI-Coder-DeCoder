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
    this._userHasScrolledUp = false;
    this._showScrollButton = false;
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.port) {
      this.serverURI = `ws://localhost:${this.port}`;
    }
  }

  handleWheel(event) {
    // User scrolled up with mouse wheel - pause auto-scroll
    if (event.deltaY < 0) {
      this._userHasScrolledUp = true;
      this._showScrollButton = true;
    }
    
    // User scrolled down - check if at bottom
    if (event.deltaY > 0) {
      const container = this.shadowRoot?.querySelector('#messages-container');
      if (container) {
        // Small delay to let scroll complete
        setTimeout(() => {
          const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
          if (distanceFromBottom < 50) {
            this._userHasScrolledUp = false;
            this._showScrollButton = false;
          }
        }, 50);
      }
    }
  }

  scrollToBottomNow() {
    this._userHasScrolledUp = false;
    this._showScrollButton = false;
    const container = this.shadowRoot?.querySelector('#messages-container');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  addMessage(role, content, images = null, editResults = null) {
    const message = { id: this._messageId++, role, content, final: true };
    if (images) {
      message.images = images;
    }
    if (editResults) {
      message.editResults = editResults;
    }
    this.messageHistory = [...this.messageHistory, message];
    this._scrollToBottom();
  }

  streamWrite(chunk, final = false, role = 'assistant', editResults = null) {
    setTimeout(() => this._processStreamChunk(chunk, final, role, editResults), 0);
  }

  _processStreamChunk(chunk, final, role, editResults = null) {
    const lastMessage = this.messageHistory[this.messageHistory.length - 1];
    
    if (lastMessage && lastMessage.role === role && !lastMessage.final) {
      if (chunk) {
        lastMessage.content = chunk;
      }
      lastMessage.final = final;
      if (editResults && editResults.length > 0) {
        lastMessage.editResults = editResults;
      }
      this.messageHistory = [...this.messageHistory];
    } else {
      const newMessage = { id: this._messageId++, role, content: chunk, final };
      if (editResults && editResults.length > 0) {
        newMessage.editResults = editResults;
      }
      this.messageHistory = [...this.messageHistory, newMessage];
    }
    this._scrollToBottom();
  }

  _scrollToBottom() {
    if (this._userHasScrolledUp) return;
    
    this.updateComplete.then(() => {
      const container = this.shadowRoot?.querySelector('#messages-container');
      if (container) {
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight;
        });
      }
    });
  }

  clearHistory() {
    this.messageHistory = [];
    this._userHasScrolledUp = false;
    this._showScrollButton = false;
    this.requestUpdate();
  }

  setupScrollObserver() {
    const container = this.shadowRoot?.querySelector('#messages-container');
    if (!container || this._resizeObserver) return;

    this._resizeObserver = new ResizeObserver(() => {
      // When content resizes and user is at bottom, keep them there
      if (!this._userHasScrolledUp) {
        container.scrollTop = container.scrollHeight;
      }
    });

    this._resizeObserver.observe(container);
  }

  disconnectScrollObserver() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }
}
