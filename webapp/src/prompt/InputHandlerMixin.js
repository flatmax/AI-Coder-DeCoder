/**
 * Mixin for input handling (keyboard, text input, image paste).
 */
/**
 * Mixin for input handling (keyboard, paste, images, history navigation, resize).
 *
 * @mixin InputHandlerMixin
 * @requires {Function} this.sendMessage - Sends current message (from ChatActionsMixin)
 * @requires {Function} this._handleAtMention - Handles @-mention detection (from FileHandlerMixin)
 * @requires {Function} this.detectUrlsInInput - Detects URLs in input text (from PromptView)
 * @requires {Array} this.messageHistory - Chat message history (from MessageHandler)
 * @requires {String} this.inputValue - Current textarea input value
 * @requires {Array} this.pastedImages - Pasted image data
 * @requires {Boolean} this.minimized - Whether the dialog is minimized
 * @provides {Function} initInputHandler - Sets up paste listener
 * @provides {Function} destroyInputHandler - Cleans up paste listener
 * @provides {Function} handleKeyDown - Keyboard event handler
 * @provides {Function} handleInput - Input event handler
 * @provides {Function} getImagesForSend - Returns images and clears them
 * @provides {Function} toggleMinimize - Toggles minimized state
 */
export const InputHandlerMixin = (superClass) => class extends superClass {

  initInputHandler() {
    this._historyIndex = -1;  // -1 means we're at the draft/current input
    this._inputDraft = '';     // Preserves unsent content when navigating history
    this._savedScrollRatio = 1;  // Saved scroll position for minimize/maximize
    this._savedWasAtBottom = true;
    
    // Image paste handling
    this._boundHandlePaste = this._handlePaste.bind(this);
    document.addEventListener('paste', this._boundHandlePaste);
  }

  destroyInputHandler() {
    document.removeEventListener('paste', this._boundHandlePaste);
  }

  // ============ Image Handling ============

  _handlePaste(e) {
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

  getImagesForSend() {
    if (this.pastedImages.length === 0) return null;
    return this.pastedImages.map(img => ({ 
      data: img.data, 
      mime_type: img.mime_type 
    }));
  }

  // ============ History Navigation ============

  _getUserMessageHistory() {
    // Get all user messages from messageHistory
    return this.messageHistory
      .filter(msg => msg.role === 'user')
      .map(msg => msg.content);
  }

  _navigateHistory(direction) {
    const userMessages = this._getUserMessageHistory();
    if (userMessages.length === 0) return false;

    const textarea = this.shadowRoot?.querySelector('textarea');
    if (!textarea) return false;

    // direction: -1 = up (older), 1 = down (newer)
    // _historyIndex: -1 = draft, 0 = most recent message, 1 = second most recent, etc.

    // If we're at the draft and trying to go down, do nothing
    if (direction === 1 && this._historyIndex === -1) {
      return false;
    }

    // If we're at the oldest message and trying to go up, do nothing
    if (direction === -1 && this._historyIndex === userMessages.length - 1) {
      return false;
    }

    // Save current input as draft if we're just starting to navigate
    if (this._historyIndex === -1 && direction === -1) {
      this._inputDraft = this.inputValue;
    }

    // Navigate: up arrow increases index (older), down arrow decreases (newer)
    this._historyIndex -= direction;

    // Update input value
    if (this._historyIndex === -1) {
      // Back to draft
      this.inputValue = this._inputDraft;
    } else {
      // Show historical message (index from the end)
      const historyPosition = userMessages.length - 1 - this._historyIndex;
      this.inputValue = userMessages[historyPosition];
    }

    // Update textarea and resize
    this.updateComplete.then(() => {
      if (textarea) {
        textarea.value = this.inputValue;
        this._autoResizeTextarea(textarea);
        // Move cursor to end
        textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
      }
    });

    return true;
  }

  _resetHistoryNavigation() {
    this._historyIndex = -1;
    this._inputDraft = '';
  }

  _autoResizeTextarea(textarea) {
    if (!textarea) return;
    
    // Cap at 100px to prevent textarea from dominating the chat panel
    const maxHeight = 100;
    
    // Set the CSS variable for max-height
    textarea.style.setProperty('--textarea-max-height', `${maxHeight}px`);
    
    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';
    
    // Calculate new height, capped at maxHeight
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;
    
    // Show/hide scrollbar based on content
    if (textarea.scrollHeight > maxHeight) {
      textarea.style.overflowY = 'auto';
    } else {
      textarea.style.overflowY = 'hidden';
    }
  }

  handleCopyToPrompt(e) {
    const { content } = e.detail;
    this.inputValue = content;
    // Focus the textarea
    this.updateComplete.then(() => {
      const textarea = this.shadowRoot?.querySelector('textarea');
      if (textarea) {
        textarea.focus();
      }
    });
  }

  handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.sendMessage();
      this._resetHistoryNavigation();
      return;
    }

    const textarea = e.target;
    
    // Up arrow - navigate to older messages
    if (e.key === 'ArrowUp') {
      // Only navigate if cursor is at the start of the textarea
      if (textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
        if (this._navigateHistory(-1)) {
          e.preventDefault();
        }
      }
    }
    
    // Down arrow - navigate to newer messages
    if (e.key === 'ArrowDown') {
      // Only navigate if cursor is at the end of the textarea
      if (textarea.selectionStart === textarea.value.length && 
          textarea.selectionEnd === textarea.value.length) {
        if (this._navigateHistory(1)) {
          e.preventDefault();
        }
      }
    }
  }

  handleInput(e) {
    this.inputValue = e.target.value;
    this._handleAtMention(e.target.value);
    this._autoResizeTextarea(e.target);
    
    // Detect URLs in input (if mixin is present)
    if (this.detectUrlsInInput) {
      this.detectUrlsInInput(e.target.value);
    }
  }

  handleSpeechTranscript(e) {
    const { text } = e.detail;
    if (!text) return;
    
    const transcript = text;
    
    // Append transcript to input (with space if needed)
    const needsSpace = this.inputValue && !this.inputValue.endsWith(' ') && !this.inputValue.endsWith('\n');
    this.inputValue = this.inputValue + (needsSpace ? ' ' : '') + transcript;
    
    // Update textarea and resize
    this.updateComplete.then(() => {
      const textarea = this.shadowRoot?.querySelector('textarea');
      if (textarea) {
        textarea.value = this.inputValue;
        this._autoResizeTextarea(textarea);
        // Move cursor to end
        textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
        textarea.focus();
      }
    });
    
    // Detect URLs in the new input
    if (this.detectUrlsInInput) {
      this.detectUrlsInInput(this.inputValue);
    }
  }

  toggleMinimize() {
    const container = this.shadowRoot?.querySelector('#messages-container');
    
    if (!this.minimized) {
      // About to minimize - save scroll position while maximized
      if (container) {
        const scrollTop = container.scrollTop;
        const scrollHeight = container.scrollHeight;
        const clientHeight = container.clientHeight;
        const maxScroll = scrollHeight - clientHeight;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
        this._savedWasAtBottom = distanceFromBottom < 50;
        this._savedScrollRatio = maxScroll > 0 ? scrollTop / maxScroll : 1;
      }
      this.minimized = true;
    } else {
      // About to maximize - restore saved scroll position
      this.minimized = false;
      
      this.updateComplete.then(() => {
        requestAnimationFrame(() => {
          const container = this.shadowRoot?.querySelector('#messages-container');
          if (!container) return;
          
          if (this._savedWasAtBottom) {
            container.scrollTop = container.scrollHeight;
          } else {
            const maxScroll = container.scrollHeight - container.clientHeight;
            container.scrollTop = maxScroll * this._savedScrollRatio;
          }
        });
      });
    }
  }
};
