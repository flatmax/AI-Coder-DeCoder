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
   * Called by server when a compaction event occurs.
   * @param {string} requestId - The request ID
   * @param {object} event - The compaction event data
   */
  compactionEvent(requestId, event) {
    if (event.type === 'compaction_start') {
      // Add a system message indicating compaction is starting
      this.addMessage('assistant', event.message);
    } else if (event.type === 'compaction_complete') {
      // Handle compaction completion by rebuilding the message history
      const tokensSaved = event.tokens_saved.toLocaleString();
      const tokensBefore = event.tokens_before.toLocaleString();
      const tokensAfter = event.tokens_after.toLocaleString();
      
      if (event.case === 'none') {
        // Compaction wasn't actually needed - just remove the "Compacting..." message
        const lastMessage = this.messageHistory[this.messageHistory.length - 1];
        if (lastMessage && lastMessage.role === 'assistant' && lastMessage.content.includes('Compacting')) {
          this.messageHistory = this.messageHistory.slice(0, -1);
        }
        return;
      }
      
      // Build the new message history from compacted messages
      const newHistory = [];
      
      // Add a system notification about compaction
      let compactionNotice;
      if (event.case === 'summarize') {
        compactionNotice = `📋 **History Compacted**\n\n${event.truncated_count} older messages were summarized to preserve context.\n\n---\n_${tokensBefore} → ${tokensAfter} tokens (saved ${tokensSaved})_`;
      } else if (event.case === 'truncate_only') {
        const topicInfo = event.topic_detected ? `\n\n**Topic change detected:** ${event.topic_detected}` : '';
        compactionNotice = `✂️ **History Truncated**\n\n${event.truncated_count} older messages from previous topic removed.${topicInfo}\n\n---\n_${tokensBefore} → ${tokensAfter} tokens (saved ${tokensSaved})_`;
      } else {
        compactionNotice = `🗜️ **History Compacted** (${event.case})\n\n${event.truncated_count} messages processed.\n\n---\n_${tokensBefore} → ${tokensAfter} tokens (saved ${tokensSaved})_`;
      }
      
      // Add the compaction notice as a system-style assistant message
      newHistory.push({
        role: 'assistant',
        content: compactionNotice,
        final: true,
        isCompactionNotice: true
      });
      
      // Add all the compacted messages from the backend
      if (event.compacted_messages && event.compacted_messages.length > 0) {
        for (const msg of event.compacted_messages) {
          newHistory.push({
            role: msg.role,
            content: msg.content,
            final: true
          });
        }
      }
      
      // Replace the entire message history
      this.messageHistory = newHistory;
      
      console.log(`📋 History compacted: ${event.case}, now showing ${newHistory.length} messages`);
    } else if (event.type === 'compaction_error') {
      // Handle compaction failure
      const lastMessage = this.messageHistory[this.messageHistory.length - 1];
      if (lastMessage && lastMessage.role === 'assistant' && lastMessage.content.includes('Compacting')) {
        const errorMessage = `⚠️ **Compaction Failed**\n\n${event.error}\n\n_Continuing without compaction..._`;
        const updatedMessage = {
          ...lastMessage,
          content: errorMessage,
          final: true
        };
        this.messageHistory = [
          ...this.messageHistory.slice(0, -1),
          updatedMessage
        ];
      }
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
        errorContent += `\n\n*The file(s) have been deselected. You can send your message again.*`;
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
    
    // Refresh file tree and show diffs if edits were applied
    if (result.passed && result.passed.length > 0) {
      await this.loadFileTree();
      
      // Build diff files and dispatch event to show them
      const diffFiles = await this._buildDiffFiles(result);
      if (diffFiles.length > 0) {
        this.dispatchEvent(new CustomEvent('edits-applied', {
          detail: { files: diffFiles },
          bubbles: true,
          composed: true
        }));
      }
    }
    
    // Show token usage HUD if available
    if (result.token_usage) {
      this._showHud(result.token_usage);
    }
    
    // Refresh prompt snippets in case they were modified
    if (typeof this.loadPromptSnippets === 'function') {
      this.loadPromptSnippets();
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
    this._hudHovered = false;
    
    // Auto-hide after 8 seconds (unless hovered)
    this._startHudTimeout();
  }

  _startHudTimeout() {
    if (this._hudTimeout) {
      clearTimeout(this._hudTimeout);
    }
    this._hudTimeout = setTimeout(() => {
      if (!this._hudHovered) {
        this._hudVisible = false;
      }
    }, 8000);
  }

  _onHudMouseEnter() {
    this._hudHovered = true;
    if (this._hudTimeout) {
      clearTimeout(this._hudTimeout);
      this._hudTimeout = null;
    }
  }

  _onHudMouseLeave() {
    this._hudHovered = false;
    // Start a shorter timeout after mouse leaves
    this._hudTimeout = setTimeout(() => {
      this._hudVisible = false;
    }, 2000);
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
