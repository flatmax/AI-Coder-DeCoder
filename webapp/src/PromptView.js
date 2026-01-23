import { html } from 'lit';
import { MessageHandler } from './MessageHandler.js';
import { promptViewStyles } from './prompt/PromptViewStyles.js';
import { renderPromptView } from './prompt/PromptViewTemplate.js';
import './file-picker/FilePicker.js';

export class PromptView extends MessageHandler {
  static properties = {
    inputValue: { type: String },
    minimized: { type: Boolean },
    isConnected: { type: Boolean },
    fileTree: { type: Object },
    modifiedFiles: { type: Array },
    stagedFiles: { type: Array },
    untrackedFiles: { type: Array },
    selectedFiles: { type: Array },
    showFilePicker: { type: Boolean },
    pastedImages: { type: Array }
  };

  static styles = promptViewStyles;

  constructor() {
    super();
    this.inputValue = '';
    this.minimized = false;
    this.isConnected = false;
    this.fileTree = null;
    this.modifiedFiles = [];
    this.stagedFiles = [];
    this.untrackedFiles = [];
    this.selectedFiles = [];
    this.showFilePicker = false;
    this.pastedImages = [];
    
    const urlParams = new URLSearchParams(window.location.search);
    this.port = urlParams.get('port');
  }

  connectedCallback() {
    super.connectedCallback();
    this.addClass(this);
    document.addEventListener('paste', this.handlePaste.bind(this));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('paste', this.handlePaste.bind(this));
  }

  remoteIsUp() {}

  async setupDone() {
    this.isConnected = true;
    await this.loadFileTree();
  }

  remoteDisconnected(uuid) {
    this.isConnected = false;
  }

  extractResponse(response) {
    if (response && typeof response === 'object') {
      const keys = Object.keys(response);
      if (keys.length > 0) {
        return response[keys[0]];
      }
    }
    return response;
  }

  async loadFileTree() {
    try {
      const response = await this.call['Repo.get_file_tree']();
      const data = this.extractResponse(response);
      if (data && !data.error) {
        this.fileTree = data.tree;
        this.modifiedFiles = data.modified || [];
        this.stagedFiles = data.staged || [];
        this.untrackedFiles = data.untracked || [];
      }
    } catch (e) {
      console.error('Error loading file tree:', e);
    }
  }

  toggleFilePicker() {
    this.showFilePicker = !this.showFilePicker;
    if (this.showFilePicker && !this.fileTree) {
      this.loadFileTree();
    }
  }

  handleSelectionChange(e) {
    this.selectedFiles = e.detail;
  }

  async handleFileView(e) {
    const { path } = e.detail;
    try {
      const workingResponse = await this.call['Repo.get_file_content'](path, 'working');
      const workingContent = this.extractResponse(workingResponse);
      
      let headContent = '';
      try {
        const headResponse = await this.call['Repo.get_file_content'](path, 'HEAD');
        headContent = this.extractResponse(headResponse);
        if (typeof headContent !== 'string') headContent = '';
      } catch (e) {
        // File might be new/untracked
        headContent = '';
      }

      const isNew = headContent === '';
      const isModified = this.modifiedFiles.includes(path);
      
      this.dispatchEvent(new CustomEvent('edits-applied', {
        detail: {
          files: [{
            path,
            original: headContent,
            modified: typeof workingContent === 'string' ? workingContent : '',
            isNew: isNew && !isModified
          }]
        },
        bubbles: true,
        composed: true
      }));
    } catch (e) {
      console.error('Error viewing file:', e);
    }
  }

  handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          this.processImageFile(file);
        }
        break;
      }
    }
  }

  processImageFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64Data = e.target.result.split(',')[1];
      const mimeType = file.type;
      this.pastedImages = [
        ...this.pastedImages,
        {
          data: base64Data,
          mime_type: mimeType,
          preview: e.target.result,
          name: file.name || `image-${Date.now()}.${mimeType.split('/')[1]}`
        }
      ];
    };
    reader.readAsDataURL(file);
  }

  removeImage(index) {
    this.pastedImages = this.pastedImages.filter((_, i) => i !== index);
  }

  clearImages() {
    this.pastedImages = [];
  }

  async clearContext() {
    try {
      const response = await this.call['LiteLLM.clear_history']();
      this.extractResponse(response);
      // Clear local message history
      this.messageHistory = [];
      this.addMessage('assistant', 'Context cleared. Starting fresh conversation.');
    } catch (e) {
      console.error('Error clearing context:', e);
      this.addMessage('assistant', `Error clearing context: ${e.message}`);
    }
  }

  async sendMessage() {
    if (!this.inputValue.trim() && this.pastedImages.length === 0) return;
    
    const userContent = this.inputValue;
    const imagesToSend = this.pastedImages.length > 0 
      ? this.pastedImages.map(img => ({ data: img.data, mime_type: img.mime_type }))
      : null;
    
    if (this.pastedImages.length > 0) {
      this.addMessage('user', `${userContent}\n[${this.pastedImages.length} image(s) attached]`);
    } else {
      this.addMessage('user', userContent);
    }
    
    const message = this.inputValue;
    this.inputValue = '';
    const images = imagesToSend;
    this.pastedImages = [];
    
    try {
      const response = await this.call['LiteLLM.chat'](
        message,
        this.selectedFiles.length > 0 ? this.selectedFiles : null,
        images
      );
      const result = this.extractResponse(response);
      
      // Display the response text
      const responseText = result.response || result.error || 'No response';
      this.addMessage('assistant', responseText);
      
      // If edits were applied, emit event with diff data
      if (result.passed && result.passed.length > 0) {
        await this.loadFileTree();
        
        // Build diff files data for the diff viewer
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
    
    // Get the content from the result
    const newContents = result.content || {};
    
    for (const edit of result.passed) {
      const [filePath, original, updated] = edit;
      
      // Try to get the original file content
      let originalContent = '';
      try {
        // If original is empty, it's a new file
        if (original === '') {
          originalContent = '';
        } else {
          // The original content from the edit block
          // For a full file view, we'd need to fetch the previous version
          // For now, we'll reconstruct from the edit
          const fullContent = newContents[filePath] || '';
          // Simple approach: show the search block as original context
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
    // Try to reconstruct the original by reversing the edit
    // This is a simplified approach - ideally we'd fetch from git
    if (searchBlock && replaceBlock && newContent) {
      // Replace the new content back with the old to get original
      return newContent.replace(replaceBlock, searchBlock);
    }
    
    // Fallback: try to get from git HEAD
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

  handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.sendMessage();
    }
  }

  handleInput(e) {
    this.inputValue = e.target.value;
    this._handleAtMention(e.target.value);
  }

  _handleAtMention(value) {
    // Find the last @ symbol and extract filter text after it
    const lastAtIndex = value.lastIndexOf('@');
    
    if (lastAtIndex !== -1) {
      // Get text after @ until space or end of string
      const afterAt = value.substring(lastAtIndex + 1);
      const spaceIndex = afterAt.indexOf(' ');
      const filterText = spaceIndex === -1 ? afterAt : afterAt.substring(0, spaceIndex);
      
      // Only activate if @ is recent (no space after the filter text yet)
      if (spaceIndex === -1 && afterAt.length >= 0) {
        this.showFilePicker = true;
        this._setFilePickerFilter(filterText);
      }
    }
  }

  _setFilePickerFilter(filterText) {
    const filePicker = this.shadowRoot?.querySelector('file-picker');
    if (filePicker) {
      filePicker.filter = filterText;
    }
  }

  toggleMinimize() {
    this.minimized = !this.minimized;
  }

  render() {
    return renderPromptView(this);
  }
}

customElements.define('prompt-view', PromptView);
