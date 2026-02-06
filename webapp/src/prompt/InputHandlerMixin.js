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
    this._historySearchResults = [];  // Fuzzy search results
    this._historySearchIndex = -1;    // Selected index in dropdown
    this._showHistorySearch = false;  // Whether dropdown is visible
    
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
    // Get all user messages from messageHistory (most recent last)
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

  // ============ Fuzzy History Search ============

  _fuzzyMatch(query, text) {
    // Simple fuzzy match — all query chars must appear in order
    const lowerQuery = query.toLowerCase();
    const lowerText = text.toLowerCase();
    let qi = 0;
    for (let ti = 0; ti < lowerText.length && qi < lowerQuery.length; ti++) {
      if (lowerText[ti] === lowerQuery[qi]) qi++;
    }
    return qi === lowerQuery.length;
  }

  _fuzzyScore(query, text) {
    // Score: lower is better. Prefers substring matches and earlier positions.
    const lowerQuery = query.toLowerCase();
    const lowerText = text.toLowerCase();
    const substringIdx = lowerText.indexOf(lowerQuery);
    if (substringIdx !== -1) return substringIdx;  // Exact substring: best
    // Fuzzy: sum of character positions (lower = tighter match)
    let score = 0;
    let qi = 0;
    for (let ti = 0; ti < lowerText.length && qi < lowerQuery.length; ti++) {
      if (lowerText[ti] === lowerQuery[qi]) {
        score += ti;
        qi++;
      }
    }
    return score + 1000;  // Fuzzy matches rank after substring matches
  }

  _searchHistory(query) {
    const userMessages = this._getUserMessageHistory();
    if (!query || userMessages.length === 0) return [];

    // Deduplicate (keep last occurrence), filter, score, sort
    const seen = new Set();
    const unique = [];
    for (let i = userMessages.length - 1; i >= 0; i--) {
      const msg = userMessages[i];
      if (!seen.has(msg)) {
        seen.add(msg);
        unique.push(msg);
      }
    }

    return unique
      .filter(msg => this._fuzzyMatch(query, msg))
      .sort((a, b) => this._fuzzyScore(query, a) - this._fuzzyScore(query, b))
      .slice(0, 8)
      .map(msg => ({
        content: msg,
        preview: msg.length > 120 ? msg.substring(0, 120) + '…' : msg
      }));
  }

  _openHistorySearch() {
    const query = this.inputValue.trim();
    const results = this._searchHistory(query);
    this._historySearchResults = results;
    this._historySearchIndex = results.length > 0 ? 0 : -1;
    this._showHistorySearch = results.length > 0;
    this.requestUpdate();
  }

  _closeHistorySearch() {
    this._showHistorySearch = false;
    this._historySearchResults = [];
    this._historySearchIndex = -1;
    this.requestUpdate();
  }

  _selectHistorySearchResult(index) {
    const result = this._historySearchResults[index];
    if (!result) return;

    this.inputValue = result.content;
    this._closeHistorySearch();

    this.updateComplete.then(() => {
      const textarea = this.shadowRoot?.querySelector('textarea');
      if (textarea) {
        textarea.value = this.inputValue;
        this._autoResizeTextarea(textarea);
        textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
        textarea.focus();
      }
    });
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

  _isFilePickerNavigating() {
    const filePicker = this.shadowRoot?.querySelector('file-picker');
    return filePicker && filePicker.filter && this.showFilePicker;
  }

  _getFilePicker() {
    return this.shadowRoot?.querySelector('file-picker');
  }

  handleKeyDown(e) {
    // Handle file picker keyboard navigation when @ filter is active
    if (this._isFilePickerNavigating()) {
      const filePicker = this._getFilePicker();
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        filePicker.navigateFocus(-1);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        filePicker.navigateFocus(1);
        return;
      }
      if (e.key === ' ') {
        // Space toggles the focused file's checkbox
        if (filePicker.focusedFile) {
          e.preventDefault();
          filePicker.toggleFocusedFile();
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        // Clear the @ filter and close picker
        this._clearAtMention();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        // Open focused file in diff viewer
        if (filePicker.focusedFile) {
          this.handleFileView({ detail: { path: filePicker.focusedFile } });
        }
        return;
      }
    }

    // Handle history search dropdown navigation
    if (this._showHistorySearch) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this._historySearchIndex = Math.max(0, this._historySearchIndex - 1);
        this.requestUpdate();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._historySearchIndex = Math.min(
          this._historySearchResults.length - 1,
          this._historySearchIndex + 1
        );
        this.requestUpdate();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this._historySearchIndex >= 0) {
          this._selectHistorySearchResult(this._historySearchIndex);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this._closeHistorySearch();
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.sendMessage();
      this._resetHistoryNavigation();
      this._closeHistorySearch();
      return;
    }

    if (e.key === 'Escape') {
      this._closeHistorySearch();
      // Clear file picker filter if active
      const filePicker = this.shadowRoot?.querySelector('file-picker');
      if (filePicker && filePicker.filter) {
        filePicker.filter = '';
        return;
      }
      return;
    }

    const textarea = e.target;
    
    // Up arrow - fuzzy search or cycle history
    if (e.key === 'ArrowUp') {
      if (textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
        if (this.inputValue.trim()) {
          // Text present: open fuzzy search
          e.preventDefault();
          this._openHistorySearch();
        } else {
          // Empty: cycle through history
          if (this._navigateHistory(-1)) {
            e.preventDefault();
          }
        }
      }
    }
    
    // Down arrow - navigate to newer messages (only when no search dropdown)
    if (e.key === 'ArrowDown') {
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
    
    // Live-update fuzzy search if dropdown is open
    if (this._showHistorySearch) {
      if (this.inputValue.trim()) {
        this._openHistorySearch();
      } else {
        this._closeHistorySearch();
      }
    }
    
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
