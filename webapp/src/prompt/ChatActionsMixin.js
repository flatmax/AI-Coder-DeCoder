/**
 * Mixin for chat actions (send, clear, token report, commit).
 *
 * @mixin ChatActionsMixin
 * @requires {Function} this.call - JRPC call object for RPC methods
 * @requires {Function} this.extractResponse - Extracts result from RPC response
 * @requires {Function} this.addMessage - Adds a message to chat (from MessageHandler)
 * @requires {Function} this.loadFileTree - Refreshes file tree (from FileHandlerMixin)
 * @requires {Function} this.clearAllUrlState - Clears URL detection state (from PromptView)
 * @requires {Function} this.getImagesForSend - Gets pasted images (from InputHandlerMixin)
 * @requires {Function} this.getFetchedUrlsForMessage - Gets fetched URLs (from PromptView)
 * @requires {Function} this.clearUrlState - Clears URL state after send (from PromptView)
 * @requires {Function} this._generateRequestId - Generates stream request ID (from StreamingMixin)
 * @requires {Array} this.selectedFiles - Currently selected file paths
 * @requires {String} this.inputValue - Current textarea input value
 * @requires {Boolean} this.isStreaming - Whether a stream is in progress
 * @provides {Function} handleResetHard - Git reset --hard
 * @provides {Function} clearContext - Clears conversation and URL state
 * @provides {Function} showTokenReport - Shows token usage report
 * @provides {Function} copyGitDiff - Copies git diff to clipboard
 * @provides {Function} handleCommit - Generates commit message and commits
 * @provides {Function} sendMessage - Sends user message to LLM
 */
export const ChatActionsMixin = (superClass) => class extends superClass {

  async handleResetHard() {
    if (!confirm('⚠️ This will discard ALL uncommitted changes!\n\nAre you sure you want to reset to HEAD?')) {
      return;
    }
    
    try {
      this.addMessage('assistant', '🔄 Resetting repository to HEAD...');
      const response = await this.call['Repo.reset_hard']();
      const result = this.extractResponse(response);
      
      if (result && result.error) {
        this.addMessage('assistant', `Error resetting: ${result.error}`);
        return;
      }
      
      this.addMessage('assistant', '✅ Repository reset to HEAD. All uncommitted changes have been discarded.');
      
      // Refresh the file tree to update status indicators
      await this.loadFileTree();
      
      // Clear the diff viewer
      this.dispatchEvent(new CustomEvent('edits-applied', {
        detail: { files: [] },
        bubbles: true,
        composed: true
      }));
      
    } catch (e) {
      console.error('Error during reset:', e);
      this.addMessage('assistant', `Error during reset: ${e.message}`);
    }
  }

  async clearContext() {
    try {
      const response = await this.call['LiteLLM.clear_history']();
      this.extractResponse(response);
      this.messageHistory = [];
      // Close history browser if open
      if (this.showHistoryBrowser) {
        this.showHistoryBrowser = false;
      }
      // Clear all URL state when clearing conversation
      if (this.clearAllUrlState) {
        this.clearAllUrlState();
      }
      // Reset history bar to reflect cleared history
      if (!this._hudData) {
        this._hudData = {};
      }
      this._hudData.history_tokens = 0;
      this.requestUpdate();
      this.addMessage('assistant', 'Context cleared. Starting fresh conversation.');
    } catch (e) {
      console.error('Error clearing context:', e);
      this.addMessage('assistant', `Error clearing context: ${e.message}`);
    }
  }

  async showTokenReport() {
    try {
      const filePaths = this.selectedFiles.length > 0 ? this.selectedFiles : null;
      const response = await this.call['LiteLLM.get_token_report'](filePaths, null);
      const report = this.extractResponse(response);
      this.addMessage('assistant', '```\n' + report + '\n```');
    } catch (e) {
      console.error('Error getting token report:', e);
      this.addMessage('assistant', `Error getting token report: ${e.message}`);
    }
  }

  async copyGitDiff() {
    try {
      // Get diff from HEAD (includes both staged and unstaged changes)
      const diffResponse = await this.call['Repo.get_unstaged_diff']();
      const stagedResponse = await this.call['Repo.get_staged_diff']();
      
      const unstagedDiff = this.extractResponse(diffResponse) || '';
      const stagedDiff = this.extractResponse(stagedResponse) || '';
      
      // Combine both diffs
      let fullDiff = '';
      if (stagedDiff && typeof stagedDiff === 'string') {
        fullDiff += stagedDiff;
      }
      if (unstagedDiff && typeof unstagedDiff === 'string') {
        if (fullDiff) fullDiff += '\n';
        fullDiff += unstagedDiff;
      }
      
      if (!fullDiff.trim()) {
        this.addMessage('assistant', 'No changes to copy (working tree is clean).');
        return;
      }
      
      await navigator.clipboard.writeText(fullDiff);
      this.addMessage('assistant', `📋 Copied diff to clipboard (${fullDiff.split('\n').length} lines)`);
      
    } catch (e) {
      console.error('Error copying git diff:', e);
      this.addMessage('assistant', `Error copying diff: ${e.message}`);
    }
  }

  async handleCommit() {
    try {
      // First, stage all changes
      this.addMessage('assistant', '📦 Staging all changes...');
      const stageResponse = await this.call['Repo.stage_all']();
      const stageResult = this.extractResponse(stageResponse);
      
      if (stageResult && stageResult.error) {
        this.addMessage('assistant', `Error staging changes: ${stageResult.error}`);
        return;
      }
      
      // Get the staged diff to show what will be committed
      const diffResponse = await this.call['Repo.get_staged_diff']();
      const diff = this.extractResponse(diffResponse);
      
      if (!diff || (typeof diff === 'object' && diff.error)) {
        this.addMessage('assistant', `Error getting diff: ${diff?.error || 'No staged changes'}`);
        return;
      }
      
      if (!diff.trim()) {
        this.addMessage('assistant', 'No changes to commit.');
        return;
      }
      
      // Generate commit message
      this.addMessage('assistant', '🤖 Generating commit message...');
      const commitMsgResponse = await this.call['LiteLLM.get_commit_message'](diff);
      const commitMsgResult = this.extractResponse(commitMsgResponse);
      
      if (commitMsgResult && commitMsgResult.error) {
        this.addMessage('assistant', `Error generating commit message: ${commitMsgResult.error}`);
        return;
      }
      
      const commitMessage = commitMsgResult.message;
      
      // Show the generated message and ask for confirmation
      this.addMessage('assistant', `📝 Generated commit message:\n\`\`\`\n${commitMessage}\n\`\`\`\n\nCommitting...`);
      
      // Perform the commit
      const commitResponse = await this.call['Repo.commit'](commitMessage);
      const commitResult = this.extractResponse(commitResponse);
      
      if (commitResult && commitResult.error) {
        this.addMessage('assistant', `Error committing: ${commitResult.error}`);
        return;
      }
      
      this.addMessage('assistant', `✅ Committed successfully!\n\nCommit: \`${commitResult.short_hash}\`\nMessage: ${commitMessage.split('\n')[0]}`);
      
      // Refresh the file tree to update status indicators
      await this.loadFileTree();
      
    } catch (e) {
      console.error('Error during commit:', e);
      this.addMessage('assistant', `Error during commit: ${e.message}`);
    }
  }

  async sendMessage() {
    if (!this.inputValue.trim() && this.pastedImages.length === 0) return;

    const userContent = this.inputValue;
    const imagesToSend = this.getImagesForSend();
    const imagesToStore = this.pastedImages.length > 0 ? [...this.pastedImages] : null;
    
    // Get fetched URL content to include in message
    const fetchedUrlContent = this.getFetchedUrlsForMessage ? this.getFetchedUrlsForMessage() : [];
    
    // Build message with URL context appended (sent to LLM but not shown in UI)
    let messageToSend = this.inputValue;
    if (fetchedUrlContent.length > 0) {
      const urlContext = fetchedUrlContent.map(result => {
        const title = result.title || result.url;
        const summary = result.summary || result.content || '';
        return `## ${title}\nSource: ${result.url}\n\n${summary}`;
      }).join('\n\n---\n\n');
      
      messageToSend = `${this.inputValue}\n\n---\n**Referenced URL Content:**\n\n${urlContext}`;
    }
    
    // Show original user content in UI (without URL dump)
    this.addMessage('user', userContent, imagesToStore);
    
    this.inputValue = '';
    this.pastedImages = [];
    
    // Clear detected URLs (not yet fetched) after sending
    // Keep fetchedUrls - they persist as context like selected files
    if (this.clearUrlState) {
      this.clearUrlState();
    }
    
    // Reset textarea height
    const textarea = this.shadowRoot?.querySelector('textarea');
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.overflowY = 'hidden';
    }
    
    try {
      // Generate request ID and track it
      const requestId = this._generateRequestId();
      this._streamingRequests.set(requestId, { message: messageToSend });
      this.isStreaming = true;
      this._startStreamingWatchdog();
      
      // Start streaming request - streamChunk will create the assistant message
      const response = await this.call['LiteLLM.chat_streaming'](
        requestId,
        messageToSend,
        this.selectedFiles.length > 0 ? this.selectedFiles : null,
        imagesToSend
      );
      const result = this.extractResponse(response);
      
      if (result.error) {
        this._streamingRequests.delete(requestId);
        this.isStreaming = false;
        // Update the empty message with error
        const lastMessage = this.messageHistory[this.messageHistory.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
          lastMessage.content = `Error: ${result.error}`;
          lastMessage.final = true;
          this.messageHistory = [...this.messageHistory];
        }
      }
      // Otherwise, streaming callbacks will handle the response
      
    } catch (e) {
      console.error('Error sending message:', e);
      this.addMessage('assistant', `Error: ${e.message}`);
    }
  }

  async _buildDiffFiles(result) {
    const newContents = result.content || {};
    
    const diffFilePromises = result.passed.map(async (edit) => {
      const [filePath, original, updated] = edit;
      
      let originalContent = '';
      try {
        if (original === '') {
          originalContent = '';
        } else {
          const fullContent = newContents[filePath] || '';
          originalContent = await this._getOriginalFileContent(filePath, fullContent, original, updated);
        }
      } catch (e) {
        console.error('Error getting original content:', e);
        originalContent = original;
      }
      
      // Get modified content: prefer result.content, then fetch from disk
      let modifiedContent = newContents[filePath];
      if (!modifiedContent) {
        try {
          const response = await this.call['Repo.get_file_content'](filePath);
          modifiedContent = this.extractResponse(response);
        } catch (e) {
          modifiedContent = updated;
        }
      }
      
      return {
        path: filePath,
        original: originalContent,
        modified: modifiedContent,
        isNew: original === ''
      };
    });
    
    return Promise.all(diffFilePromises);
  }

  async _getOriginalFileContent(filePath, newContent, searchBlock, replaceBlock) {
    // First, try to get the committed version from git HEAD
    // This is the most reliable source for the original content
    try {
      const response = await this.call['Repo.get_file_content'](filePath, 'HEAD');
      const content = this.extractResponse(response);
      if (content && typeof content === 'string') {
        return content;
      }
    } catch (e) {
      // File might be new (not yet committed)
    }
    
    // For new files, the original is empty
    if (searchBlock === '') {
      return '';
    }
    
    // Fallback: try to reconstruct from search/replace blocks
    if (searchBlock && replaceBlock && newContent) {
      return newContent.replace(replaceBlock, searchBlock);
    }
    
    return '';
  }
};
