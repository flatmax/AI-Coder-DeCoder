/**
 * Mixin for handling streaming responses from the server.
 */
export const StreamingMixin = (superClass) => class extends superClass {

  static get properties() {
    return {
      ...super.properties,
      isStreaming: { type: Boolean },
      _hudVisible: { type: Boolean },
      _hudData: { type: Object }
    };
  }

  initStreaming() {
    this._streamingRequests = new Map();
    this.isStreaming = false;
    this._hudVisible = false;
    this._hudData = null;
    this._hudTimeout = null;
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
    
    // Handle error case - may need to create assistant message if none exists yet
    if (result.error) {
      // Auto-deselect binary files and invalid files that caused the error
      const filesToDeselect = [
        ...(result.binary_files || []),
        ...(result.invalid_files || [])
      ];
      
      if (filesToDeselect.length > 0 && this.selectedFiles) {
        const deselectedSet = new Set(filesToDeselect);
        this.selectedFiles = this.selectedFiles.filter(f => !deselectedSet.has(f));
        
        // Also update the file picker's selection state
        const filePicker = this.shadowRoot?.querySelector('file-picker');
        if (filePicker && filePicker.selected) {
          const newSelected = { ...filePicker.selected };
          for (const file of filesToDeselect) {
            delete newSelected[file];
          }
          filePicker.selected = newSelected;
        }
      }
      
      let errorContent = `⚠️ **Error:** ${result.error}`;
      if (filesToDeselect.length > 0) {
        errorContent += `\n\n*The problematic files have been deselected. You can send your message again.*`;
      }
      
      if (lastMessage && lastMessage.role === 'assistant') {
        // Update existing assistant message with error
        const updatedMessage = {
          ...lastMessage,
          content: errorContent,
          final: true,
          editResults: []
        };
        this.messageHistory = [
          ...this.messageHistory.slice(0, -1),
          updatedMessage
        ];
      } else {
        // No assistant message yet - create one with the error
        this.addMessage('assistant', errorContent);
        // Mark it as final
        const newLastMessage = this.messageHistory[this.messageHistory.length - 1];
        if (newLastMessage && newLastMessage.role === 'assistant') {
          this.messageHistory = [
            ...this.messageHistory.slice(0, -1),
            { ...newLastMessage, final: true, editResults: [] }
          ];
        }
      }
      return;
    }
    
    if (lastMessage && lastMessage.role === 'assistant') {
      // Build edit results for inline display
      const editResults = this._buildEditResults(result);
      
      // Handle cancelled case
      let content = lastMessage.content;
      if (result.cancelled) {
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
    
    // Refresh file tree if edits were applied (but don't auto-load diff viewer)
    if (result.passed && result.passed.length > 0) {
      await this.loadFileTree();
    }
    
    // Show token usage HUD if available
    if (result.token_usage) {
      this._showHud(result.token_usage);
    }
  }

  /**
   * Show the token usage HUD overlay.
   * @param {object} tokenUsage - Token usage data from server
   */
  _showHud(tokenUsage) {
    // Clear any existing timeout
    if (this._hudTimeout) {
      clearTimeout(this._hudTimeout);
    }
    
    this._hudData = tokenUsage;
    this._hudVisible = true;
    
    // Auto-hide after 8 seconds
    this._hudTimeout = setTimeout(() => {
      this._hudVisible = false;
    }, 8000);
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
