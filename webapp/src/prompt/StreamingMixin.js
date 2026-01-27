/**
 * Mixin for handling streaming responses from the server.
 */
export const StreamingMixin = (superClass) => class extends superClass {

  static get properties() {
    return {
      ...super.properties,
      isStreaming: { type: Boolean }
    };
  }

  initStreaming() {
    this._streamingRequests = new Map();
    this.isStreaming = false;
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
   * Stop the current streaming request.
   */
  async stopStreaming() {
    if (this._streamingRequests.size === 0) return;
    
    // Get the first (and typically only) streaming request
    const [requestId] = this._streamingRequests.keys();
    
    try {
      await this.call['LiteLLM.cancel_streaming'](requestId);
    } catch (e) {
      console.error('Error cancelling stream:', e);
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
    this.isStreaming = false;
    
    // Mark the message as final and attach edit results
    const lastMessage = this.messageHistory[this.messageHistory.length - 1];
    
    if (lastMessage && lastMessage.role === 'assistant') {
      // Build edit results for inline display
      const editResults = this._buildEditResults(result);
      
      // Handle error case
      let content = lastMessage.content;
      if (result.error) {
        content = `⚠️ **Error:** ${result.error}`;
      } else if (result.cancelled) {
        content = content + '\n\n*[stopped]*';
      }
      
      // Create a new message object to ensure Lit detects the change
      const updatedMessage = {
        ...lastMessage,
        content,
        final: true,
        editResults
      };
      
      // Replace the last message with the updated one
      this.messageHistory = [
        ...this.messageHistory.slice(0, -1),
        updatedMessage
      ];
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
   * Build edit results array from streaming result.
   * 
   * Note: The backend sends two formats:
   * - Legacy: passed/failed as tuples [file_path, old_preview, new_preview]
   * - New: edit_results as objects {file_path, status, reason, estimated_line}
   */
  _buildEditResults(result) {
    // Prefer the new detailed edit_results format if available
    if (result.edit_results && result.edit_results.length > 0) {
      return result.edit_results.map(r => ({
        file_path: r.file_path,
        status: r.status === 'applied' ? 'applied' : 'failed',
        reason: r.reason || null,
        estimated_line: r.estimated_line || null
      }));
    }
    
    // Fall back to legacy tuple format
    const editResults = [];
    
    if (result.passed) {
      for (const edit of result.passed) {
        // Legacy format: [file_path, old_preview, new_preview]
        const filePath = Array.isArray(edit) ? edit[0] : (edit.file_path || edit.path);
        editResults.push({
          file_path: filePath,
          status: 'applied',
          reason: null,
          estimated_line: null
        });
      }
    }
    
    if (result.failed) {
      for (const edit of result.failed) {
        // Legacy format: [file_path, reason, ""]
        const filePath = Array.isArray(edit) ? edit[0] : (edit.file_path || edit.path);
        const reason = Array.isArray(edit) ? edit[1] : (edit.reason || edit.error);
        editResults.push({
          file_path: filePath,
          status: 'failed',
          reason: reason,
          estimated_line: null
        });
      }
    }
    
    return editResults;
  }

  /**
   * Generate a unique request ID.
   */
  _generateRequestId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
};
