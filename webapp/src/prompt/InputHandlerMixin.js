/**
 * Mixin for input handling (keyboard, text input).
 */
export const InputHandlerMixin = (superClass) => class extends superClass {

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
