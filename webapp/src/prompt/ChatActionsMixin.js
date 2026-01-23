/**
 * Mixin for chat actions (send, clear, token report, commit).
 */
export const ChatActionsMixin = (superClass) => class extends superClass {

  async clearContext() {
    try {
      const response = await this.call['LiteLLM.clear_history']();
      this.extractResponse(response);
      this.messageHistory = [];
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
    
    this.addMessage('user', userContent, imagesToStore);
    
    const message = this.inputValue;
    this.inputValue = '';
    this.pastedImages = [];
    
    // Reset textarea height
    const textarea = this.shadowRoot?.querySelector('textarea');
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.overflowY = 'hidden';
    }
    
    try {
      // Generate request ID and track it
      const requestId = this._generateRequestId();
      this._streamingRequests.set(requestId, { message });
      
      // Add empty assistant message that will be filled by streaming
      this.addMessage('assistant', '');
      
      // Start streaming request
      const response = await this.call['LiteLLM.chat_streaming'](
        requestId,
        message,
        this.selectedFiles.length > 0 ? this.selectedFiles : null,
        imagesToSend
      );
      const result = this.extractResponse(response);
      
      if (result.error) {
        this._streamingRequests.delete(requestId);
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
    const diffFiles = [];
    const newContents = result.content || {};
    
    for (const edit of result.passed) {
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
      
      const modifiedContent = newContents[filePath] || updated;
      
      diffFiles.push({
        path: filePath,
        original: originalContent,
        modified: modifiedContent,
        isNew: original === ''
      });
    }
    
    return diffFiles;
  }

  async _getOriginalFileContent(filePath, newContent, searchBlock, replaceBlock) {
    if (searchBlock && replaceBlock && newContent) {
      return newContent.replace(replaceBlock, searchBlock);
    }
    
    try {
      const response = await this.call['Repo.get_file_content'](filePath, 'HEAD');
      const content = this.extractResponse(response);
      if (content && typeof content === 'string') {
        return content;
      }
    } catch (e) {
      console.error('Could not fetch original from git:', e);
    }
    
    return searchBlock || '';
  }
};
