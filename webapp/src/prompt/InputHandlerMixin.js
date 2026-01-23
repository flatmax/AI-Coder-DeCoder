/**
 * Mixin for input handling (keyboard, text input).
 */
export const InputHandlerMixin = (superClass) => class extends superClass {

  _autoResizeTextarea(textarea) {
    if (!textarea) return;
    
    // Get the chat panel height to calculate max height (50% of chat panel)
    const chatPanel = this.shadowRoot?.querySelector('.chat-panel');
    const maxHeight = chatPanel ? chatPanel.clientHeight * 0.5 : 200;
    
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
    }
  }

  handleInput(e) {
    this.inputValue = e.target.value;
    this._handleAtMention(e.target.value);
    this._autoResizeTextarea(e.target);
  }

  toggleMinimize() {
    this.minimized = !this.minimized;
  }
};
