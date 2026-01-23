export const ResizeHandlerMixin = (superClass) => class extends superClass {

  initResizeHandler() {
    this._isResizing = false;
    this._resizeDirection = null;
    this._resizeStartX = 0;
    this._resizeStartY = 0;
    this._resizeStartWidth = 0;
    this._resizeStartHeight = 0;
    this._dialogWidth = null;
    this._dialogHeight = null;
    
    this._boundHandleResizeMove = this._handleResizeMove.bind(this);
    this._boundHandleResizeEnd = this._handleResizeEnd.bind(this);
  }

  _handleResizeStart(e, direction) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    
    this._isResizing = true;
    this._resizeDirection = direction;
    this._resizeStartX = e.clientX;
    this._resizeStartY = e.clientY;
    
    const dialog = this.shadowRoot?.querySelector('.dialog');
    if (dialog) {
      const rect = dialog.getBoundingClientRect();
      this._resizeStartWidth = rect.width;
      this._resizeStartHeight = rect.height;
    }
    
    document.addEventListener('mousemove', this._boundHandleResizeMove);
    document.addEventListener('mouseup', this._boundHandleResizeEnd);
  }

  _handleResizeMove(e) {
    if (!this._isResizing) return;
    
    const deltaX = e.clientX - this._resizeStartX;
    const deltaY = e.clientY - this._resizeStartY;
    const dir = this._resizeDirection;
    
    let newWidth = this._resizeStartWidth;
    let newHeight = this._resizeStartHeight;
    
    // Handle horizontal resize
    if (dir.includes('e')) {
      newWidth = Math.max(300, this._resizeStartWidth + deltaX);
    } else if (dir.includes('w')) {
      newWidth = Math.max(300, this._resizeStartWidth - deltaX);
      if (this.dialogX !== null) {
        this.dialogX = this.dialogX + (this._resizeStartWidth - newWidth);
      }
    }
    
    // Handle vertical resize
    if (dir.includes('s')) {
      newHeight = Math.max(200, this._resizeStartHeight + deltaY);
    } else if (dir.includes('n')) {
      newHeight = Math.max(200, this._resizeStartHeight - deltaY);
      if (this.dialogY !== null) {
        this.dialogY = this.dialogY + (this._resizeStartHeight - newHeight);
      }
    }
    
    this._dialogWidth = newWidth;
    this._dialogHeight = newHeight;
    this.requestUpdate();
  }

  _handleResizeEnd() {
    this._isResizing = false;
    this._resizeDirection = null;
    document.removeEventListener('mousemove', this._boundHandleResizeMove);
    document.removeEventListener('mouseup', this._boundHandleResizeEnd);
  }

  destroyResizeHandler() {
    document.removeEventListener('mousemove', this._boundHandleResizeMove);
    document.removeEventListener('mouseup', this._boundHandleResizeEnd);
  }

  getResizeStyle() {
    const styles = [];
    if (this._dialogWidth) {
      styles.push(`width: ${this._dialogWidth}px`);
    }
    if (this._dialogHeight) {
      styles.push(`height: ${this._dialogHeight}px`);
    }
    return styles.join('; ');
  }
};
