/**
 * Mixin for making elements draggable.
 */
export const DragHandlerMixin = (superClass) => class extends superClass {

  initDragHandler() {
    this._isDragging = false;
    this._dragStartX = 0;
    this._dragStartY = 0;
    this._dialogStartX = 0;
    this._dialogStartY = 0;
    
    this._boundHandleMouseMove = this._handleMouseMove.bind(this);
    this._boundHandleMouseUp = this._handleMouseUp.bind(this);
  }

  _handleDragStart(e) {
    // Only start drag on left mouse button
    if (e.button !== 0) return;
    
    // Don't drag if clicking on buttons
    if (e.target.tagName === 'BUTTON') return;
    
    this._isDragging = true;
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
    
    this.dialogX = this._dialogStartX + deltaX;
    this.dialogY = this._dialogStartY + deltaY;
  }

  _handleMouseUp() {
    this._isDragging = false;
    document.removeEventListener('mousemove', this._boundHandleMouseMove);
    document.removeEventListener('mouseup', this._boundHandleMouseUp);
  }

  destroyDragHandler() {
    document.removeEventListener('mousemove', this._boundHandleMouseMove);
    document.removeEventListener('mouseup', this._boundHandleMouseUp);
  }
};
