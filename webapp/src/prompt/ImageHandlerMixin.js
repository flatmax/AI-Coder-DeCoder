/**
 * Mixin for image paste and preview handling.
 */
export const ImageHandlerMixin = (superClass) => class extends superClass {
  
  initImageHandler() {
    this._boundHandlePaste = this.handlePaste.bind(this);
    document.addEventListener('paste', this._boundHandlePaste);
  }

  destroyImageHandler() {
    document.removeEventListener('paste', this._boundHandlePaste);
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

  getImagesForSend() {
    if (this.pastedImages.length === 0) return null;
    return this.pastedImages.map(img => ({ 
      data: img.data, 
      mime_type: img.mime_type 
    }));
  }
};
