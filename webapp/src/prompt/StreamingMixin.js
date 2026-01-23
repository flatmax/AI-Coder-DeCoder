/**
 * Mixin for handling streaming responses from the server.
 */
export const StreamingMixin = (superClass) => class extends superClass {

  initStreaming() {
    this._streamingRequests = new Map();
  }

  /**
   * Called by server when a chunk of the response is available.
   * @param {string} requestId - The request ID
   * @param {string} content - Accumulated content so far
   */
  streamChunk(requestId, content) {
    const request = this._streamingRequests.get(requestId);
    if (request) {
      this.streamWrite(content, false, 'assistant');
    }
  }

  /**
   * Called by server when streaming is complete.
   * @param {string} requestId - The request ID
   * @param {object} result - The final result with edits
   */
  async streamComplete(requestId, result) {
    const request = this._streamingRequests.get(requestId);
    if (!request) return;
    
    this._streamingRequests.delete(requestId);
    
    // Mark the message as final
    const lastMessage = this.messageHistory[this.messageHistory.length - 1];
    if (lastMessage && lastMessage.role === 'assistant') {
      lastMessage.final = true;
      this.messageHistory = [...this.messageHistory];
    }
    
    // Handle edits if any
    if (result.passed && result.passed.length > 0) {
      await this.loadFileTree();
      const diffFiles = await this._buildDiffFiles(result);
      if (diffFiles.length > 0) {
        this.dispatchEvent(new CustomEvent('edits-applied', {
          detail: { files: diffFiles },
          bubbles: true,
          composed: true
        }));
      }
    }
  }

  /**
   * Generate a unique request ID.
   */
  _generateRequestId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
};
