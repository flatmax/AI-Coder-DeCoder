/**
 * Mixin for chat actions (send, clear, token report).
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

  async sendMessage() {
    if (!this.inputValue.trim() && this.pastedImages.length === 0) return;
    
    const userContent = this.inputValue;
    const imagesToSend = this.getImagesForSend();
    
    if (this.pastedImages.length > 0) {
      this.addMessage('user', `${userContent}\n[${this.pastedImages.length} image(s) attached]`);
    } else {
      this.addMessage('user', userContent);
    }
    
    const message = this.inputValue;
    this.inputValue = '';
    this.pastedImages = [];
    
    try {
      const response = await this.call['LiteLLM.chat'](
        message,
        this.selectedFiles.length > 0 ? this.selectedFiles : null,
        imagesToSend
      );
      const result = this.extractResponse(response);
      
      const responseText = result.response || result.error || 'No response';
      this.addMessage('assistant', responseText);
      
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
