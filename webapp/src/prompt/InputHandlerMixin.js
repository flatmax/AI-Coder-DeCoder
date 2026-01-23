/**
 * Mixin for input handling (keyboard, text input).
 */
export const InputHandlerMixin = (superClass) => class extends superClass {

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
  }

  toggleMinimize() {
    this.minimized = !this.minimized;
  }
};
