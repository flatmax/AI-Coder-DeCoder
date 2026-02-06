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
    // Downward scroll resumption is handled by IntersectionObserver on #scroll-sentinel
  }

  scrollToBottomNow() {
    this._userHasScrolledUp = false;
    this._showScrollButton = false;
    const sentinel = this.shadowRoot?.querySelector('#scroll-sentinel');
    if (sentinel) {
      sentinel.scrollIntoView({ block: 'end' });
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
      // Mutate in place and only request update for the streaming message.
      // Lit's repeat/map will still diff the array, but since only the last
      // element's content changed (same object reference for all others),
      // the template diff is O(1) for prior messages.
      this.requestUpdate('messageHistory');
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
    if (this._userHasScrolledUp || this._scrollPending) return;
    this._scrollPending = true;
    
    // Single rAF per batch — no updateComplete needed since we only
    // need the sentinel element which is always in the DOM.
    requestAnimationFrame(() => {
      this._scrollPending = false;
      if (this._userHasScrolledUp) return;
      const sentinel = this.shadowRoot?.querySelector('#scroll-sentinel');
      if (sentinel) {
        sentinel.scrollIntoView({ block: 'end' });
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
    const sentinel = this.shadowRoot?.querySelector('#scroll-sentinel');
    if (!container || !sentinel || this._intersectionObserver) return;

    this._intersectionObserver = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        // Sentinel is visible — user is at the bottom
        this._userHasScrolledUp = false;
        this._showScrollButton = false;
      }
      // Note: we do NOT set _userHasScrolledUp=true when sentinel leaves viewport.
      // Only handleWheel() sets that flag (explicit user intent). This prevents
      // false positives when content above expands and pushes sentinel out of view.
    }, { root: container });

    this._intersectionObserver.observe(sentinel);
  }

  disconnectScrollObserver() {
    if (this._intersectionObserver) {
      this._intersectionObserver.disconnect();
      this._intersectionObserver = null;
    }
  }
}
