/**
 * Mixin for making elements draggable and resizable.
 *
 * @mixin WindowControlsMixin
 * @requires {Number} this.dialogX - Dialog X position
 * @requires {Number} this.dialogY - Dialog Y position
 * @requires {Function} this.toggleMinimize - Toggles minimized state (from InputHandlerMixin)
 * @requires {Function} this.requestUpdate - Triggers Lit re-render
 * @provides {Function} initWindowControls - Sets up drag/resize state
 * @provides {Function} destroyWindowControls - Cleans up global listeners
 * @provides {Function} getResizeStyle - Returns CSS style string for current size
 */
export const WindowControlsMixin = (superClass) => class extends superClass {

  initWindowControls() {
    // Drag state
    this._isDragging = false;
    this._didDrag = false;
    this._dragStartX = 0;
    this._dragStartY = 0;
    this._dialogStartX = 0;
    this._dialogStartY = 0;
    
    // Resize state
    this._isResizing = false;
    this._resizeDirection = null;
    this._resizeStartX = 0;
    this._resizeStartY = 0;
    this._resizeStartWidth = 0;
    this._resizeStartHeight = 0;
    this._dialogWidth = null;
    this._dialogHeight = null;
    
    // Bound handlers for cleanup
    this._boundHandleMouseMove = this._handleMouseMove.bind(this);
    this._boundHandleMouseUp = this._handleMouseUp.bind(this);
    this._boundHandleResizeMove = this._handleResizeMove.bind(this);
    this._boundHandleResizeEnd = this._handleResizeEnd.bind(this);
  }

  // ==================== Drag Handling ====================

  _handleDragStart(e) {
    // Only start drag on left mouse button
    if (e.button !== 0) return;
    
    // Don't drag if clicking on buttons
    if (e.target.tagName === 'BUTTON') return;
    
    this._isDragging = true;
    this._didDrag = false;
    this._dragStartX = e.clientX;
    this._dragStartY = e.clientY;
    this._dialogStartX = this.dialogX;
    this._dialogStartY = this.dialogY;
    
    document.addEventListener('mousemove', this._boundHandleMouseMove);
    document.addEventListener('mouseup', this._boundHandleMouseUp);
    
    e.preventDefault();
  }

  _handleMouseMove(e) {
    if (!this._isDragging) return;
    
    const deltaX = e.clientX - this._dragStartX;
    const deltaY = e.clientY - this._dragStartY;
    
    // Only count as drag if moved more than 5 pixels
    if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
      this._didDrag = true;
    }
    
    if (this._didDrag) {
      this.dialogX = this._dialogStartX + deltaX;
      this.dialogY = this._dialogStartY + deltaY;
    }
  }

  _handleMouseUp() {
    const wasDragging = this._isDragging;
    const didDrag = this._didDrag;
    
    this._isDragging = false;
    document.removeEventListener('mousemove', this._boundHandleMouseMove);
    document.removeEventListener('mouseup', this._boundHandleMouseUp);
    
    // If it was a click (no drag movement), toggle minimize
    if (wasDragging && !didDrag) {
      this.toggleMinimize();
    }
  }

  // ==================== Resize Handling ====================

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

  // ==================== Lifecycle ====================

  destroyWindowControls() {
    document.removeEventListener('mousemove', this._boundHandleMouseMove);
    document.removeEventListener('mouseup', this._boundHandleMouseUp);
    document.removeEventListener('mousemove', this._boundHandleResizeMove);
    document.removeEventListener('mouseup', this._boundHandleResizeEnd);
  }
};
