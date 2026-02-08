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
    this._savedScrollRatio = 1;  // Saved scroll position for minimize/maximize
    this._savedWasAtBottom = true;
    this._historySearchQuery = '';     // Overlay search query
    this._historySearchResults = [];   // Fuzzy search results
    this._historySearchIndex = -1;     // Selected index in dropdown
    this._showHistorySearch = false;   // Whether overlay is visible
    
    // Image paste handling
    this._boundHandlePaste = this._handlePaste.bind(this);
    document.addEventListener('paste', this._boundHandlePaste);

    // Image drag-and-drop handling
    this._boundHandleDragOver = this._handleDragOver.bind(this);
    this._boundHandleDrop = this._handleDrop.bind(this);
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

  _handleDragOver(e) {
    // Check if the drag contains files
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  _handleDrop(e) {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    let hasImage = false;
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        hasImage = true;
        this.processImageFile(file);
      }
    }
    if (hasImage) {
      e.preventDefault();
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
    // Get all user messages from messageHistory (most recent first)
    const seen = new Set();
    const unique = [];
    const messages = this.messageHistory
      .filter(msg => msg.role === 'user')
      .map(msg => msg.content);
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg && msg.trim() && !seen.has(msg)) {
        seen.add(msg);
        unique.push(msg);
      }
    }
    return unique;
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

  _navigateHistory(direction) {
    const history = this._getUserMessageHistory();
    if (history.length === 0) return false;

    if (this._historyNavIndex === undefined || this._historyNavIndex === null) {
      if (direction === -1) {
        this._historyNavSaved = this.inputValue;
        this._historyNavIndex = 0;
        this.inputValue = history[0];
        return true;
      }
      return false;
    }

    const newIndex = this._historyNavIndex - direction;
    if (newIndex < 0) {
      this.inputValue = this._historyNavSaved || '';
      this._historyNavIndex = null;
      return true;
    }
    if (newIndex >= history.length) return false;

    this._historyNavIndex = newIndex;
    this.inputValue = history[newIndex];
    return true;
  }

  _openHistorySearch() {
    const history = this._getUserMessageHistory();
    if (history.length === 0) return;

    this._savedInputBeforeHistory = this.inputValue;
    this._historySearchQuery = '';
    this._showHistorySearch = true;
    this._historySearchIndex = 0;
    this._updateHistorySearchResults();

    this.updateComplete.then(() => {
      const input = this.shadowRoot?.querySelector('.history-overlay-input');
      if (input) {
        input.focus();
        input.selectionStart = input.selectionEnd = input.value.length;
      }
      // Scroll the results to show the selected item (bottom of reversed list)
      const results = this.shadowRoot?.querySelector('.history-search-results');
      if (results) {
        results.scrollTop = results.scrollHeight;
      }
    });
  }

  _closeHistorySearch() {
    this._showHistorySearch = false;
    this._historySearchQuery = '';
    this._historySearchResults = [];
    this._historySearchIndex = -1;
    this.requestUpdate();
  }

  _updateHistorySearchResults() {
    const query = this._historySearchQuery || '';
    const history = this._getUserMessageHistory();

    if (!query.trim()) {
      this._historySearchResults = history.slice(0, 20).map(msg => ({
        content: msg,
        preview: msg.length > 120 ? msg.substring(0, 120) + '…' : msg
      }));
    } else {
      this._historySearchResults = history
        .filter(msg => this._fuzzyMatch(query, msg))
        .sort((a, b) => this._fuzzyScore(query, a) - this._fuzzyScore(query, b))
        .slice(0, 20)
        .map(msg => ({
          content: msg,
          preview: msg.length > 120 ? msg.substring(0, 120) + '…' : msg
        }));
    }

    if (this._historySearchIndex >= this._historySearchResults.length) {
      this._historySearchIndex = Math.max(0, this._historySearchResults.length - 1);
    }
    this.requestUpdate();
  }

  _handleHistoryOverlayInput(e) {
    this._historySearchQuery = e.target.value;
    this._updateHistorySearchResults();
  }

  _handleHistoryOverlayKeydown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (this._historySearchIndex > 0) {
        this._historySearchIndex--;
        this.requestUpdate();
        this._scrollHistorySelectionIntoView();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this._historySearchIndex < this._historySearchResults.length - 1) {
        this._historySearchIndex++;
        this.requestUpdate();
        this._scrollHistorySelectionIntoView();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this._selectHistorySearchResult(this._historySearchIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this._closeHistorySearch();
      this.updateComplete.then(() => {
        const textarea = this.shadowRoot?.querySelector('textarea');
        if (textarea) textarea.focus();
      });
    }
  }

  _scrollHistorySelectionIntoView() {
    this.updateComplete.then(() => {
      const selected = this.shadowRoot?.querySelector('.history-search-item.selected');
      if (selected) {
        selected.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  _selectHistorySearchResult(index) {
    const result = this._historySearchResults[index];
    if (result) {
      this.inputValue = result.content;
    }
    this._closeHistorySearch();
    this.updateComplete.then(() => {
      const textarea = this.shadowRoot?.querySelector('textarea');
      if (textarea) {
        textarea.focus();
        this._autoResizeTextarea(textarea);
      }
    });
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

    // Close history overlay if open and user presses Enter/Escape in main textarea
    if (this._showHistorySearch) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this._closeHistorySearch();
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.sendMessage();
      this._closeHistorySearch();
      return;
    }

    if (e.key === 'Escape') {
      // Clear file picker filter if active
      const filePicker = this.shadowRoot?.querySelector('file-picker');
      if (filePicker && filePicker.filter) {
        filePicker.filter = '';
        return;
      }
      return;
    }

    const textarea = e.target;
    
    // Up arrow - open fuzzy history search
    if (e.key === 'ArrowUp') {
      if (textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
        e.preventDefault();
        this._openHistorySearch();
      }
    }

    // Down arrow - restore saved input if at end of text
    if (e.key === 'ArrowDown' && this._savedInputBeforeHistory !== undefined) {
      const len = textarea.value.length;
      const lastNewline = textarea.value.lastIndexOf('\n');
      const isOnLastLine = textarea.selectionStart > lastNewline && textarea.selectionEnd > lastNewline;

      if (textarea.selectionStart === len && textarea.selectionEnd === len) {
        // Already at end — restore saved input
        e.preventDefault();
        this.inputValue = this._savedInputBeforeHistory;
        this._savedInputBeforeHistory = undefined;
        this.updateComplete.then(() => {
          const ta = this.shadowRoot?.querySelector('textarea');
          if (ta) {
            ta.selectionStart = ta.selectionEnd = ta.value.length;
            this._autoResizeTextarea(ta);
          }
        });
      } else if (isOnLastLine) {
        // On last line but not at end — move cursor to end
        e.preventDefault();
        textarea.selectionStart = textarea.selectionEnd = len;
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
      
      // Double rAF to wait for content-visibility to fully lay out all messages
      this.updateComplete.then(() => {
        requestAnimationFrame(() => {
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
      });
    }
  }
};
